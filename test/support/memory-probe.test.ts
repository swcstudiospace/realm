// Unit tests of the memory probe (35-02, D-35-03): the pure parts run over injected readers and need no /proc; the few tests that
// use the real /proc run on Linux only and observe behaviour (a report, a result file), never the module's source.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { Buffer } from "node:buffer";
import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { once } from "node:events";
import { mintToken, TOKEN_CAPABILITIES } from "../../src/capability/token.js";
import {
  CHUNK_BYTES,
  compileNeedles,
  controlOutcomeOf,
  digestOf,
  findTokenCandidates,
  OVERLAP_BYTES,
  parseMaps,
  parseSpec,
  probeProcess,
  scanRegions,
  SpecError,
  startNonDescendantProbe,
  STRIDE_BYTES,
  subjectOutcomeOf,
  verdictOf,
  type MapRegion,
  type NeedleSpec,
  type ProbeReport,
  type ProcIo,
  type TargetSpec,
} from "./memory-probe.js";
import { testTimeout } from "./timing.js";

const ENTRY = fileURLToPath(new URL("./memory-probe-run.js", import.meta.url));
const LINUX = process.platform === "linux";

function mint(): { readonly key: Buffer; readonly token: string; readonly sid: string; readonly exp: number } {
  const key = randomBytes(32);
  const sid = `unit-${randomBytes(4).toString("hex")}`;
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + 3600;
  return { key, sid, exp, token: mintToken(key, { kid: "k1", sid, host: "claude", caps: TOKEN_CAPABILITIES, iat, exp }) };
}

function errorWith(code: string): Error {
  return Object.assign(new Error("injected"), { code });
}

function regionOf(start: number, length: number): MapRegion {
  return { start, end: start + length, perms: "rw-p", path: "" };
}

// A read function over one flat address space starting at base.
function readerOver(base: number, data: Buffer): (address: number, length: number) => Buffer {
  return (address, length) => {
    const from = address - base;
    if (from < 0 || from >= data.length) {
      throw errorWith("EIO");
    }
    return data.subarray(from, Math.min(from + length, data.length));
  };
}

const NO_BOUNDS = { maxBytes: Number.MAX_SAFE_INTEGER, maxMs: Number.MAX_SAFE_INTEGER };
const CLOCK = () => 0;

function tokenNeedle(token: string): NeedleSpec[] {
  return [{ kind: "text", name: "token", text: token }];
}

// ---------------------------------------------------------------------------------------------------------------------------
// parseMaps

void test("parseMaps keeps only exact rw-p regions and skips zero-length and malformed lines", () => {
  const text = [
    "00400000-00452000 r-xp 00000000 08:02 173521 /usr/bin/dbus-daemon",
    "00651000-00652000 rw-p 00051000 08:02 173521 /usr/bin/dbus-daemon",
    "00e03000-00e24000 rw-p 00000000 00:00 0 [heap]",
    "7f0000000000-7f0000000000 rw-p 00000000 00:00 0",
    "7f0000001000-7f0000002000 rw-s 00000000 00:05 4096 /dev/shm/x",
    "7f0000003000-7f0000004000 rwxp 00000000 00:00 0",
    "7f0000005000-7f0000004000 rw-p 00000000 00:00 0",
    "garbage line",
    "zz-yy rw-p 0 0 0",
    "",
  ].join("\n");
  const regions = parseMaps(text);
  assert.deepEqual(
    regions.map((region) => [region.start, region.end, region.path]),
    [
      [0x651000, 0x652000, "/usr/bin/dbus-daemon"],
      [0xe03000, 0xe24000, "[heap]"],
    ],
  );
});

// ---------------------------------------------------------------------------------------------------------------------------
// token shape

void test("a token-shaped string with two parts, a short payload, a short mac or four parts is not a candidate", () => {
  const text = [
    "rcap1.abcdefghijkl",
    "rcap1.abc.defghijkl",
    "rcap1.abcdefgh.xyz",
    "rcap1.aaaaaaaa.bbbbbbbb.cccccccc",
    "rcap1..bbbbbbbb",
  ].join(" ");
  assert.equal(findTokenCandidates(Buffer.from(text, "latin1")).length, 0);
});

void test("the claims of a real token decode to the public claims, and a garbage payload gives null claims", () => {
  const minted = mint();
  const [real, garbage] = findTokenCandidates(Buffer.from(`${minted.token} rcap1.AAAAAAAA.BBBBBBBB`, "latin1"));
  assert.ok(real !== undefined && garbage !== undefined, "two candidates");
  assert.equal(real.length, minted.token.length);
  assert.equal(real.digest, digestOf(minted.token));
  assert.deepEqual(real.claims, { host: "claude", kid: "k1", sidDigest: digestOf(minted.sid), exp: minted.exp });
  assert.deepEqual(garbage.claims, { host: null, kid: null, sidDigest: null, exp: null });
  assert.equal(JSON.stringify(real).includes(minted.token), false, "a candidate carries no text");
  assert.equal(JSON.stringify(real).includes(minted.sid), false, "a candidate carries no session id");
});

// ---------------------------------------------------------------------------------------------------------------------------
// scanRegions

void test("a token that straddles the chunk boundary is found once, in Latin-1, with one candidate", () => {
  const minted = mint();
  const length = 2 * CHUNK_BYTES;
  const data = Buffer.alloc(length);
  const at = CHUNK_BYTES - 10;
  data.write(minted.token, at, "latin1");
  const result = scanRegions([regionOf(0x10000, length)], readerOver(0x10000, data), compileNeedles(tokenNeedle(minted.token)), NO_BOUNDS, CLOCK);
  assert.deepEqual(result.needleHits["token"], { latin1: 1, utf16le: 0, raw: 0 });
  assert.equal(result.candidateCount, 1);
  assert.equal(result.regionsRead, 1);
  assert.equal(result.truncated, false);
  assert.equal(result.bytesRead > length, true, "the overlap is read twice");
});

void test("a token inside the overlap of two chunks is counted once, and tokens at both ends of a region are found", () => {
  const minted = mint();
  const length = 3 * CHUNK_BYTES;
  const data = Buffer.alloc(length);
  data.write(minted.token, STRIDE_BYTES + 100, "latin1");
  data.write(minted.token, 0, "latin1");
  data.write(minted.token, length - minted.token.length, "latin1");
  assert.ok(OVERLAP_BYTES >= 2 * 600, "the overlap holds a UTF-16LE candidate of the longest length read");
  const result = scanRegions([regionOf(0, length)], readerOver(0, data), compileNeedles(tokenNeedle(minted.token)), NO_BOUNDS, CLOCK);
  assert.equal(result.needleHits["token"]?.latin1, 3);
  assert.equal(result.candidateCount, 3);
});

void test("a UTF-16LE token is found at an odd alignment and reported with its encoding", () => {
  const minted = mint();
  const data = Buffer.alloc(4096);
  Buffer.from(minted.token, "utf16le").copy(data, 1001);
  const result = scanRegions([regionOf(0, data.length)], readerOver(0, data), compileNeedles(tokenNeedle(minted.token)), NO_BOUNDS, CLOCK);
  assert.deepEqual(result.needleHits["token"], { latin1: 0, utf16le: 1, raw: 0 });
  const [candidate] = result.candidates;
  assert.ok(candidate !== undefined, "one candidate");
  assert.equal(candidate.encoding, "utf16le");
  assert.equal(candidate.digest, digestOf(minted.token));
});

void test("a bytes needle is found raw and a text needle is not confused with it", () => {
  const key = randomBytes(32);
  const data = Buffer.alloc(8192);
  key.copy(data, 333);
  const needles: NeedleSpec[] = [
    { kind: "bytes", name: "key-bytes", base64: key.toString("base64") },
    { kind: "text", name: "key-text", text: key.toString("base64url") },
  ];
  const result = scanRegions([regionOf(0, data.length)], readerOver(0, data), compileNeedles(needles), NO_BOUNDS, CLOCK);
  assert.deepEqual(result.needleHits["key-bytes"], { latin1: 0, utf16le: 0, raw: 1 });
  assert.deepEqual(result.needleHits["key-text"], { latin1: 0, utf16le: 0, raw: 0 });
});

void test("a read error is counted under its errno name and the scan continues with the next region and the next chunk", () => {
  const minted = mint();
  const data = Buffer.alloc(8192);
  data.write(minted.token, 4000, "latin1");
  const good = regionOf(0x100000, data.length);
  const bad = regionOf(0x500000, 4096);
  const read = readerOver(0x100000, data);
  const result = scanRegions([bad, good], (address, length) => (address >= 0x500000 ? read(0x900000, length) : read(address, length)), compileNeedles(tokenNeedle(minted.token)), NO_BOUNDS, CLOCK);
  assert.deepEqual(result.regionsFailed, { EIO: 1 });
  assert.equal(result.chunksFailed, 1);
  assert.equal(result.regionsRead, 1);
  assert.equal(result.needleHits["token"]?.latin1, 1);
  assert.equal(result.regionsListed, result.regionsRead + 1 + result.regionsUnread);
  assert.equal(result.truncated, false);
});

void test("a failing chunk inside a region does not stop the next chunk of the same region", () => {
  const minted = mint();
  const length = 3 * CHUNK_BYTES;
  const data = Buffer.alloc(length);
  data.write(minted.token, length - 500, "latin1");
  const reader = readerOver(0, data);
  let calls = 0;
  const result = scanRegions(
    [regionOf(0, length)],
    (address, count) => {
      calls += 1;
      if (calls === 1) {
        throw errorWith("EFAULT");
      }
      return reader(address, count);
    },
    compileNeedles(tokenNeedle(minted.token)),
    NO_BOUNDS,
    CLOCK,
  );
  assert.deepEqual(result.regionsFailed, { EFAULT: 1 });
  assert.equal(result.chunksFailed, 1);
  assert.equal(result.needleHits["token"]?.latin1, 1);
});

void test("the total byte bound sets truncated and counts the regions it left unread", () => {
  const data = Buffer.alloc(64);
  const regions = [regionOf(0, 16), regionOf(16, 16), regionOf(32, 16)];
  const result = scanRegions(regions, readerOver(0, data), [], { maxBytes: 4, maxMs: 1_000_000 }, CLOCK);
  assert.equal(result.truncated, true);
  assert.equal(result.regionsRead, 1);
  assert.equal(result.regionsUnread, 2);
  assert.equal(result.regionsListed, 3);
  assert.equal(result.bytesRead, 16);
});

void test("the time bound sets truncated by the injected clock", () => {
  const data = Buffer.alloc(64);
  let ticks = 0;
  const result = scanRegions([regionOf(0, 16), regionOf(16, 16), regionOf(32, 16)], readerOver(0, data), [], { maxBytes: 1_000_000, maxMs: 1000 }, () => {
    ticks += 600;
    return ticks;
  });
  assert.equal(result.truncated, true);
  assert.equal(result.regionsRead, 1);
  assert.equal(result.regionsUnread, 2);
});

void test("more than 50 candidates are counted but only 50 are kept, and the report says so", () => {
  const minted = mint();
  const data = Buffer.alloc(60 * 400);
  for (let index = 0; index < 60; index += 1) {
    data.write(minted.token, index * 400, "latin1");
  }
  const result = scanRegions([regionOf(0, data.length)], readerOver(0, data), [], NO_BOUNDS, CLOCK);
  assert.equal(result.candidateCount, 60);
  assert.equal(result.candidates.length, 50);
  assert.equal(result.candidatesTruncated, true);
});

// ---------------------------------------------------------------------------------------------------------------------------
// probeProcess over a fake /proc

interface FakeProc {
  readonly base: number;
  readonly data: Buffer;
  readonly memOpenError?: string;
  readonly mapsError?: string;
  readonly statusError?: string;
  readonly environ?: string;
  readonly keyringError?: string;
}

function fakeIo(proc: FakeProc): ProcIo {
  const files = new Map<string, Buffer>([
    ["/proc/sys/kernel/yama/ptrace_scope", Buffer.from("1\n")],
    ["/proc/100/stat", Buffer.from("100 (node probe) S 1 100 100 0 -1 4194560 0 0 0 0")],
    ["/proc/200/stat", Buffer.from("200 (holder) S 150 200 200 0 -1 4194560 0 0 0 0")],
    ["/proc/150/stat", Buffer.from("150 (sh) S 1 150 150 0 -1 4194560 0 0 0 0")],
    ["/proc/200/status", Buffer.from("Name:\tholder\nUid:\t1000\t1000\t1000\t1000\nTracerPid:\t0\n")],
    ["/proc/200/environ", Buffer.from(proc.environ ?? "PATH=/usr/bin\u0000HOME=/home/x\u0000")],
    ["/proc/200/maps", Buffer.from(`${proc.base.toString(16)}-${(proc.base + proc.data.length).toString(16)} rw-p 00000000 00:00 0 [heap]\n`)],
  ]);
  const errors = new Map<string, string>();
  if (proc.mapsError !== undefined) {
    errors.set("/proc/200/maps", proc.mapsError);
  }
  if (proc.statusError !== undefined) {
    errors.set("/proc/200/status", proc.statusError);
  }
  let clock = 0;
  return {
    pid: 100,
    uid: 1000,
    now: () => {
      clock += 1;
      return clock;
    },
    readFile: (path) => {
      const code = errors.get(path);
      if (code !== undefined) {
        throw errorWith(code);
      }
      const file = files.get(path);
      if (file === undefined) {
        throw errorWith("ENOENT");
      }
      return file;
    },
    openMem: () => {
      if (proc.memOpenError !== undefined) {
        throw errorWith(proc.memOpenError);
      }
      return { read: readerOver(proc.base, proc.data), close: () => undefined };
    },
    canOpen: () => {
      if (proc.keyringError !== undefined) {
        throw errorWith(proc.keyringError);
      }
    },
  };
}

function targetSpec(needles: readonly NeedleSpec[], extra: Partial<TargetSpec> = {}): TargetSpec {
  return { kind: "target", pid: 200, needles, markers: ["PATH", "SECRET_MARKER"], keyringPath: "keys.json", ...extra };
}

void test("a report built over memory holding a known token and key contains neither text nor key bytes in any encoding", () => {
  const minted = mint();
  const data = Buffer.alloc(65_536);
  data.write(minted.token, 1000, "latin1");
  minted.key.copy(data, 5000);
  data.write(minted.key.toString("base64url"), 9000, "latin1");
  const needles: NeedleSpec[] = [
    { kind: "text", name: "token", text: minted.token },
    { kind: "bytes", name: "key-bytes", base64: minted.key.toString("base64") },
    { kind: "text", name: "key-text", text: minted.key.toString("base64url") },
  ];
  const report = probeProcess(targetSpec(needles), fakeIo({ base: 0x400000, data }));
  assert.equal(report.mem.needleHits["token"]?.latin1, 1);
  assert.equal(report.mem.needleHits["key-bytes"]?.raw, 1);
  assert.ok((report.mem.needleHits["key-text"]?.latin1 ?? 0) >= 1);
  assert.equal(report.mem.tokenCandidates[0]?.claims.host, "claude");
  const serialised = JSON.stringify(report);
  for (const secret of [minted.token, minted.sid, minted.key.toString("hex"), minted.key.toString("base64"), minted.key.toString("base64url")]) {
    assert.equal(serialised.includes(secret), false, "no secret text in the report");
  }
  assert.equal(serialised.includes(minted.token.slice(0, 24)), false, "no token fragment either");
});

void test("the report records the Yama value, both parent chains, the uid, the tracer, the environment markers and the key file", () => {
  const report = probeProcess(targetSpec([]), fakeIo({ base: 0x400000, data: Buffer.alloc(4096) }));
  assert.equal(report.ptraceScope, "1");
  assert.deepEqual(report.probeChain, [100, 1]);
  assert.deepEqual(report.targetChain, [200, 150, 1]);
  assert.equal(report.probeIsAncestorOfTarget, false);
  assert.deepEqual(report.target, { status: "readable", uid: 1000, tracerPid: 0 });
  assert.equal(report.probeUid, 1000);
  assert.deepEqual(report.environ, { read: "readable", markers: { PATH: true, SECRET_MARKER: false }, tokenShapes: 0 });
  assert.equal(report.keyFile, "readable");
  assert.equal(report.mem.open, "ok");
  assert.equal(report.mem.maps, "read");
  assert.equal(report.mem.regionsListed, 1);
  assert.equal(report.mem.regionsRead, 1);
});

void test("a token shape in the environment block is counted and never reported", () => {
  const minted = mint();
  const report = probeProcess(targetSpec([], { markers: [] }), fakeIo({ base: 0x400000, data: Buffer.alloc(64), environ: `A=1\u0000B=${minted.token}\u0000` }));
  assert.equal(report.environ.tokenShapes, 1);
  assert.equal(JSON.stringify(report).includes(minted.token), false);
});

void test("an open of the mem file that is refused is recorded as denied with its errno, with zero regions read and zero hits", () => {
  const minted = mint();
  const data = Buffer.alloc(4096);
  data.write(minted.token, 10, "latin1");
  const report = probeProcess(targetSpec(tokenNeedle(minted.token)), fakeIo({ base: 0x400000, data, memOpenError: "EACCES" }));
  assert.equal(report.mem.open, "denied:EACCES");
  assert.equal(report.mem.regionsRead, 0);
  assert.equal(report.mem.regionsListed, 1);
  assert.equal(report.mem.regionsUnread, 1);
  assert.equal(report.mem.bytesRead, 0);
  assert.deepEqual(report.mem.needleHits, {});
  assert.equal(report.mem.tokenCandidateCount, 0);
  assert.equal(subjectOutcomeOf(report, ["token"], digestOf(minted.token)), "denied-at-open");
});

void test("an unreadable maps file is recorded under its errno name, with no region listed", () => {
  const report = probeProcess(targetSpec([]), fakeIo({ base: 0x400000, data: Buffer.alloc(64), mapsError: "EACCES" }));
  assert.equal(report.mem.maps, "denied:EACCES");
  assert.equal(report.mem.open, "ok");
  assert.equal(report.mem.regionsListed, 0);
  assert.equal(subjectOutcomeOf(report, [], null), "incomplete");
});

void test("a refused keyring file is recorded under its errno name", () => {
  const report = probeProcess(targetSpec([]), fakeIo({ base: 0x400000, data: Buffer.alloc(64), keyringError: "EACCES" }));
  assert.equal(report.keyFile, "denied:EACCES");
});

void test("a pid that is not alive reports target gone and asks for nothing else", () => {
  const report = probeProcess(targetSpec([]), fakeIo({ base: 0x400000, data: Buffer.alloc(64), statusError: "ENOENT" }));
  assert.equal(report.targetGone, true);
  assert.deepEqual(report.targetChain, []);
  assert.equal(report.environ.read, "not-asked");
  assert.equal(report.mem.open, "not-asked");
  assert.equal(report.keyFile, "not-asked");
});

void test("on Linux a pid that has exited reports target gone through the real /proc", async (t) => {
  if (!LINUX) {
    t.skip("not Linux: no /proc");
    return;
  }
  const child = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
  const pid = child.pid;
  assert.ok(pid !== undefined);
  await once(child, "exit");
  const report = probeProcess({ kind: "target", pid, needles: [], markers: [] });
  assert.equal(report.targetGone, true);
});

void test("on Linux a self-probe finds a token held in the probe's own memory by its shape, which is the positive self-check", testTimeout(120_000), (t) => {
  if (!LINUX) {
    t.skip("not Linux: no /proc");
    return;
  }
  const minted = mint();
  // Two copies: a flat string and a buffer. The probe is given no needle, so the only way to see the token is the shape search.
  const heldBuffer = Buffer.from(minted.token, "latin1");
  const heldText = heldBuffer.toString("latin1");
  const report = probeProcess({ kind: "target", pid: process.pid, needles: [], markers: ["PATH"] });
  assert.equal(report.mem.open, "ok", "a process may read its own memory");
  assert.equal(report.mem.truncated, false);
  const failed = Object.values(report.mem.regionsFailed).reduce((sum, count) => sum + count, 0);
  assert.equal(report.mem.regionsListed, report.mem.regionsRead + failed);
  assert.ok(report.mem.tokenCandidates.some((candidate) => candidate.digest === digestOf(minted.token)), "the planted token is found by its shape");
  assert.equal(report.targetChain[0], process.pid);
  assert.equal(report.probeIsAncestorOfTarget, false);
  assert.equal(report.probeUid, process.getuid?.());
  assert.equal(heldText.length, heldBuffer.length);
});

// ---------------------------------------------------------------------------------------------------------------------------
// The specification

void test("parseSpec accepts a target and a descendant control, and applies no default itself", () => {
  const target = parseSpec(JSON.stringify({ kind: "target", pid: 42, needles: [{ kind: "text", name: "token", text: "abc" }, { kind: "bytes", name: "key", base64: "AQID" }], markers: ["PATH"], keyringPath: "k.json", maxBytes: 10, maxMs: 20 }));
  assert.equal(target.kind, "target");
  assert.deepEqual(parseSpec('{"kind":"descendant-control"}'), { kind: "descendant-control" });
  assert.deepEqual(parseSpec('{"kind":"descendant-control","maxBytes":5,"maxMs":6}'), { kind: "descendant-control", maxBytes: 5, maxMs: 6 });
});

void test("parseSpec rejects an extra member, a missing member, an empty needle and a repeated name, naming the member and never a value", () => {
  const base = { kind: "target", pid: 42, needles: [], markers: [] };
  const cases: readonly { readonly spec: unknown; readonly member: string }[] = [
    { spec: { ...base, extra: "SECRETVALUE" }, member: "extra" },
    { spec: { kind: "target", pid: 42, markers: [] }, member: "needles" },
    { spec: { ...base, needles: [{ kind: "text", name: "token", text: "" }] }, member: "needles[0].text" },
    { spec: { ...base, needles: [{ kind: "bytes", name: "key", base64: "" }] }, member: "needles[0].base64" },
    { spec: { ...base, needles: [{ kind: "text", name: "token", text: "a" }, { kind: "bytes", name: "token", base64: "AQID" }] }, member: "needles" },
    { spec: { ...base, needles: [{ kind: "text", name: "token", text: "a", more: 1 }] }, member: "needles[0].more" },
    { spec: { ...base, pid: 0 }, member: "pid" },
    { spec: { ...base, markers: ["bad name"] }, member: "markers" },
    { spec: { ...base, maxMs: 0 }, member: "maxMs" },
    { spec: { kind: "descendant-control", pid: 3 }, member: "pid" },
    { spec: { kind: "other" }, member: "kind" },
  ];
  for (const { spec, member } of cases) {
    assert.throws(
      () => parseSpec(JSON.stringify(spec)),
      (error: unknown) => {
        assert.ok(error instanceof SpecError);
        assert.equal(error.member, member);
        assert.equal(error.message.includes("SECRETVALUE"), false);
        return true;
      },
      member,
    );
  }
  assert.throws(() => parseSpec("not json"), SpecError);
});

// ---------------------------------------------------------------------------------------------------------------------------
// The verdict rule

function reportWith(mem: Partial<ProbeReport["mem"]>): ProbeReport {
  const base = probeProcess(targetSpec([]), fakeIo({ base: 0x400000, data: Buffer.alloc(64) }));
  return { ...base, mem: { ...base.mem, ...mem } };
}

void test("the subject outcome follows the frozen rule: found, denied at open, absent with complete coverage, or incomplete", () => {
  assert.equal(subjectOutcomeOf(reportWith({ open: "denied:EACCES" }), ["token"], null), "denied-at-open");
  assert.equal(subjectOutcomeOf(reportWith({}), ["token"], null), "absent-complete");
  assert.equal(subjectOutcomeOf(reportWith({ needleHits: { token: { latin1: 1, utf16le: 0, raw: 0 } } }), ["token"], null), "found");
  assert.equal(subjectOutcomeOf(reportWith({ open: "denied:EACCES", needleHits: { token: { latin1: 0, utf16le: 0, raw: 2 } } }), ["token"], null), "found");
  assert.equal(subjectOutcomeOf(reportWith({ truncated: true, regionsUnread: 1, regionsRead: 0 }), ["token"], null), "incomplete");
  assert.equal(subjectOutcomeOf(reportWith({ regionsListed: 0, regionsRead: 0 }), ["token"], null), "incomplete");
  assert.equal(subjectOutcomeOf(reportWith({ regionsFailed: { EIO: 1 }, regionsRead: 0 }), ["token"], null), "absent-complete");
  const candidate = { encoding: "latin1", length: 100, digest: "deadbeef", claims: { host: null, kid: null, sidDigest: null, exp: null } } as const;
  assert.equal(subjectOutcomeOf(reportWith({ tokenCandidates: [candidate], tokenCandidateCount: 1 }), [], "deadbeef"), "found");
  assert.equal(controlOutcomeOf(reportWith({ tokenCandidates: [candidate], tokenCandidateCount: 1 }), ["synthetic"], "deadbeef"), "found");
  assert.equal(controlOutcomeOf(reportWith({}), ["synthetic"], "deadbeef"), "not-found");
});

void test("the verdict: refuted when N found; settled when N denied or complete-absent and both controls found; else inconclusive", () => {
  assert.equal(verdictOf("found", "found", "found"), "refuted");
  assert.equal(verdictOf("found", "not-found", "not-found"), "refuted");
  assert.equal(verdictOf("denied-at-open", "found", "found"), "settled");
  assert.equal(verdictOf("absent-complete", "found", "found"), "settled");
  assert.equal(verdictOf("denied-at-open", "not-found", "found"), "inconclusive");
  assert.equal(verdictOf("denied-at-open", "found", "not-found"), "inconclusive");
  assert.equal(verdictOf("incomplete", "found", "found"), "inconclusive");
});

// ---------------------------------------------------------------------------------------------------------------------------
// The detached starter and the entry, through the real /proc

void test("the starter fails with the stage named when the probe never writes a result, and shows what the probe said", testTimeout(30_000), async (t) => {
  if (!LINUX) {
    t.skip("not Linux");
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), "realm-probe-unit-"));
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  await assert.rejects(
    startNonDescendantProbe(join(dir, "missing-entry.js"), { kind: "target", pid: process.pid, needles: [], markers: [] }, join(dir, "result.json"), 2_000),
    /memory probe: result file: no report from probe pid \d+/,
  );
});

void test("the entry refuses a bad specification with one line that names the member and no value, and exits 2", testTimeout(30_000), (t) => {
  if (!LINUX) {
    t.skip("not Linux");
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), "realm-probe-unit-"));
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  const result = spawnSync(process.execPath, [ENTRY, join(dir, "result.json")], { input: JSON.stringify({ kind: "target", pid: 1, needles: [], markers: [], extra: "SECRETVALUE" }), encoding: "utf8" });
  assert.equal(result.status, 2);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /^memory-probe-run: specification member extra: not allowed\n$/);
  assert.equal(existsSync(join(dir, "result.json")), false);
});

void test("the detached starter returns the report of a reparented probe that is no ancestor of the caller, written with mode 0600", testTimeout(120_000), async (t) => {
  if (!LINUX) {
    t.skip("not Linux");
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), "realm-probe-unit-"));
  const target = spawn(process.execPath, ["-e", "setInterval(() => undefined, 1000)"], { stdio: "ignore" });
  t.after(() => {
    target.kill("SIGKILL");
    rmSync(dir, { recursive: true, force: true });
  });
  const pid = target.pid;
  assert.ok(pid !== undefined);
  const minted = mint();
  const resultPath = join(dir, "result.json");
  const report = await startNonDescendantProbe(ENTRY, { kind: "target", pid, needles: tokenNeedle(minted.token), markers: ["PATH"], maxBytes: 64 * 1024 * 1024 }, resultPath, 90_000);
  t.diagnostic(`ptrace_scope ${report.ptraceScope}; mem.open ${report.mem.open}; target uid ${String(report.target.uid)}`);
  assert.equal(report.schema, 1);
  assert.equal(report.targetGone, false);
  assert.equal(report.probeChain.includes(process.pid), false, "the probe was reparented: the caller is not its ancestor");
  assert.equal(report.probeIsAncestorOfTarget, false);
  assert.deepEqual(report.targetChain.slice(0, 2), [pid, process.pid]);
  assert.equal(statSync(resultPath).mode & 0o777, 0o600);
  assert.equal(readFileSync(resultPath, "utf8").includes(minted.token), false);
  assert.equal(report.mem.needleHits["token"]?.latin1 ?? 0, 0, "the target never held this token");
});

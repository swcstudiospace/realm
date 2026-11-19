// The always-running hermetic test of test/support/omp-arm-run.ts (Phase 45, OMPV-03 and OMPV-04; 45-CONTEXT D-45-03 and D-45-05): the scope
// wrapper, the sampler, the thread split, the scope check, the readings CSV and the run record, on an injected reader and an injected clock.
// No real process, no real /proc, no systemd, no file, no host.

import assert from "node:assert/strict";
import { test } from "node:test";
import type { ContentionReading } from "./omp-contention.js";
import {
  buildCalibrationRecord,
  buildRunRecord,
  createContentionSampler,
  DESIGN_BRANCH,
  HOST_READING_LABELS,
  type ProcReader,
  parseReadingsCsv,
  readingsCsv,
  readThreadSplit,
  REFUSAL_PHRASES,
  type RunRecordParts,
  SCOPE_RUNNER_ARGV,
  scopedWrap,
  tierOfBranch,
  verifyScopedChild,
} from "./omp-arm-run.js";
import { type Bounds, TIER_SCOPED, TIER_UNSCOPED } from "./omp-verdict.js";
import { PAIRED_LABEL } from "./paired-ab.js";
import { type ProbeSample } from "./responsiveness.js";

// ---- Fixtures --------------------------------------------------------------------------------------------------------------------

// A fake /proc: the text of each file by path and the entries of each directory by path. A path that is not there fails like a read of a
// file that is gone.
function fakeReader(files: Readonly<Record<string, string>>, dirs: Readonly<Record<string, readonly string[]>> = {}): ProcReader {
  return {
    readText(path) {
      const text = files[path];
      if (text === undefined) {
        throw new Error(`ENOENT: ${path}`);
      }
      return text;
    },
    listDir(path) {
      const entries = dirs[path];
      if (entries === undefined) {
        throw new Error(`ENOENT: ${path}`);
      }
      return entries;
    },
  };
}

const SCOPE_DIR = "/sys/fs/cgroup/user.slice/user-1000.slice/user@1000.service/app.slice/run-p4242-i77.scope";
const PRESSURE = (totalUs: number): string => `some avg10=0.00 avg60=0.00 avg300=0.00 total=${String(totalUs)}\nfull avg10=0.00 avg60=0.00 avg300=0.00 total=0\n`;

// ---- scopedWrap ------------------------------------------------------------------------------------------------------------------

void test("OMPV-03 scopedWrap: Branch S is the scope command ending with the double dash, pinned by value; Branch N is empty", () => {
  assert.deepEqual(scopedWrap("S"), ["systemd-run", "--user", "--scope", "--quiet", "--collect", "--"]);
  assert.deepEqual(scopedWrap("S"), SCOPE_RUNNER_ARGV);
  assert.deepEqual(scopedWrap("N"), []);
  assert.equal(DESIGN_BRANCH, "S");
});

void test("OMPV-03 scopedWrap: nothing in the scope is tuned (no property, weight, quota or pinning)", () => {
  const joined = scopedWrap("S").join(" ");
  for (const tuning of ["-p", "--property", "CPUWeight", "CPUQuota", "AllowedCPUs", "taskset", "nice"]) {
    assert.ok(!joined.includes(tuning), tuning);
  }
});

void test("OMPV-03 scopedWrap: the isolation seam is put before the scope command and is empty by default", () => {
  assert.deepEqual(scopedWrap("S", ["taskset", "-c", "0-3"]), ["taskset", "-c", "0-3", ...SCOPE_RUNNER_ARGV]);
  assert.deepEqual(scopedWrap("N", ["taskset", "-c", "0-3"]), ["taskset", "-c", "0-3"]);
});

void test("OMPV-03 scopedWrap: a branch other than S or N is an error", () => {
  const other = "X" as "S";
  assert.throws(() => scopedWrap(other), /must be S or N, got X/);
});

void test("OMPV-03 tierOfBranch: S is loaded, scoped and N is loaded, unscoped", () => {
  assert.equal(tierOfBranch("S"), TIER_SCOPED);
  assert.equal(tierOfBranch("N"), TIER_UNSCOPED);
});

// ---- The sampler -----------------------------------------------------------------------------------------------------------------

void test("OMPV-03 the sampler reads the scope total and the main thread's schedstat, stamps them with the clock and keeps them in order", () => {
  let totalUs = 100;
  let onCpuNs = 1000;
  const files: Record<string, string> = {};
  const reader: ProcReader = {
    readText: (path) => {
      const text = path === `${SCOPE_DIR}/cpu.pressure` ? PRESSURE(totalUs) : path === "/proc/4242/task/4242/schedstat" ? `${String(onCpuNs)} 7 3\n` : files[path];
      if (text === undefined) {
        throw new Error(`ENOENT: ${path}`);
      }
      return text;
    },
    listDir: () => [],
  };
  let now = 0;
  const sampler = createContentionSampler({ pid: 4242, scopeDir: SCOPE_DIR, reader, nowMs: () => now });
  const first = sampler.read("send 0");
  assert.deepEqual(first, { ok: true, reading: { atMs: 0, scopeSomeTotalUs: 100, mainOnCpuNs: 1000, mainRunqNs: 7 } });
  now = 250;
  totalUs = 400;
  onCpuNs = 2500;
  sampler.read("answer 0");
  assert.deepEqual(sampler.readings().map((reading) => [reading.atMs, reading.scopeSomeTotalUs, reading.mainOnCpuNs]), [[0, 100, 1000], [250, 400, 2500]]);
  assert.equal(sampler.refusal(), null);
});

void test("OMPV-03 the sampler under Branch N has no scope total and reads the schedstat only", () => {
  const sampler = createContentionSampler({ pid: 9, scopeDir: null, reader: fakeReader({ "/proc/9/task/9/schedstat": "5 6 7" }), nowMs: () => 3 });
  assert.deepEqual(sampler.read("send"), { ok: true, reading: { atMs: 3, scopeSomeTotalUs: null, mainOnCpuNs: 5, mainRunqNs: 6 } });
});

void test("OMPV-03 a failed schedstat read is a refusal with the closed phrase, never a skipped reading", () => {
  const sampler = createContentionSampler({ pid: 9, scopeDir: null, reader: fakeReader({}), nowMs: () => 0 });
  assert.deepEqual(sampler.read("send 3"), { ok: false, refusal: "thread schedstat unreadable", label: "send 3" });
  assert.deepEqual(sampler.readings(), []);
  assert.equal(sampler.refusal(), "thread schedstat unreadable");
  const garbled = createContentionSampler({ pid: 9, scopeDir: null, reader: fakeReader({ "/proc/9/task/9/schedstat": "1 2" }), nowMs: () => 0 });
  assert.equal(garbled.read("x").ok, false);
});

void test("OMPV-03 under Branch S an unreadable or malformed pressure file is a refusal; the first refusal is kept", () => {
  const schedstat = { "/proc/9/task/9/schedstat": "5 6 7" };
  const missing = createContentionSampler({ pid: 9, scopeDir: "/sys/fs/cgroup/x.scope", reader: fakeReader(schedstat), nowMs: () => 0 });
  assert.deepEqual(missing.read("send"), { ok: false, refusal: "scope pressure file unreadable", label: "send" });
  const malformed = createContentionSampler({ pid: 9, scopeDir: "/sys/fs/cgroup/x.scope", reader: fakeReader({ ...schedstat, "/sys/fs/cgroup/x.scope/cpu.pressure": "nonsense\n" }), nowMs: () => 0 });
  assert.equal(malformed.read("send").ok, false);
  assert.equal(malformed.refusal(), "scope pressure file unreadable");
  assert.deepEqual(malformed.readings(), []);
});

// ---- The thread split ------------------------------------------------------------------------------------------------------------

function threadFiles(): { readonly files: Record<string, string>; readonly dirs: Record<string, readonly string[]> } {
  return {
    files: {
      "/proc/100/task/100/schedstat": "600 40 3",
      "/proc/100/task/100/comm": "omp\n",
      "/proc/100/task/101/schedstat": "300 10 2",
      "/proc/100/task/101/comm": "bun-pool\n",
      "/proc/100/task/102/schedstat": "100 5 1",
      "/proc/100/task/102/comm": "timer\n",
    },
    dirs: { "/proc/100/task": ["102", "100", "101"] },
  };
}

void test("OMPV-03 readThreadSplit lists every task sorted by on-CPU time with the main thread's share", () => {
  const { files, dirs } = threadFiles();
  const result = readThreadSplit(100, fakeReader(files, dirs));
  assert.ok(result.ok);
  assert.deepEqual(result.split.tasks, [
    { tid: 100, comm: "omp", onCpuNs: 600, runqNs: 40 },
    { tid: 101, comm: "bun-pool", onCpuNs: 300, runqNs: 10 },
    { tid: 102, comm: "timer", onCpuNs: 100, runqNs: 5 },
  ]);
  assert.equal(result.split.mainTid, 100);
  assert.equal(result.split.mainShare, 0.6);
});

void test("OMPV-03 readThreadSplit: a main thread that is not the busiest is reported as it is; a process with no on-CPU time has share 0", () => {
  const { files, dirs } = threadFiles();
  files["/proc/100/task/100/schedstat"] = "50 40 3";
  const result = readThreadSplit(100, fakeReader(files, dirs));
  assert.ok(result.ok);
  assert.equal(result.split.tasks[0]?.tid, 101);
  assert.ok(result.split.mainShare < 0.2);
  const idle = readThreadSplit(5, fakeReader({ "/proc/5/task/5/schedstat": "0 0 0", "/proc/5/task/5/comm": "omp\n" }, { "/proc/5/task": ["5"] }));
  assert.ok(idle.ok);
  assert.equal(idle.split.mainShare, 0);
});

void test("OMPV-03 readThreadSplit refuses when the task directory cannot be listed or the main thread cannot be read", () => {
  assert.deepEqual(readThreadSplit(100, fakeReader({})), { ok: false, refusal: "task list unreadable" });
  const { files, dirs } = threadFiles();
  delete files["/proc/100/task/100/schedstat"];
  assert.deepEqual(readThreadSplit(100, fakeReader(files, dirs)), { ok: false, refusal: "thread schedstat unreadable" });
});

void test("OMPV-03 readThreadSplit skips an entry that is not a task id and a task that ended between the listing and the read", () => {
  const { files } = threadFiles();
  delete files["/proc/100/task/102/schedstat"];
  const result = readThreadSplit(100, fakeReader(files, { "/proc/100/task": ["100", "101", "102", "stat"] }));
  assert.ok(result.ok);
  assert.deepEqual(result.split.tasks.map((task) => task.tid), [100, 101]);
});

// ---- verifyScopedChild -----------------------------------------------------------------------------------------------------------

const CHILD_CGROUP = `0::/user.slice/user-1000.slice/user@1000.service/app.slice/run-p4242-i77.scope\n`;

void test("OMPV-03 verifyScopedChild accepts Omp in a scope named for its pid and returns the scope directory", () => {
  const reader = fakeReader({ "/proc/4242/comm": "omp\n", "/proc/4242/cgroup": CHILD_CGROUP });
  assert.deepEqual(verifyScopedChild(4242, null, reader), { ok: true, scopeDir: SCOPE_DIR });
  assert.deepEqual(verifyScopedChild(4242, SCOPE_DIR, reader), { ok: true, scopeDir: SCOPE_DIR });
});

void test("OMPV-03 verifyScopedChild refuses when the process is still the wrapper, so the sampler would read the wrapper", () => {
  const reader = fakeReader({ "/proc/4242/comm": "systemd-run\n", "/proc/4242/cgroup": CHILD_CGROUP });
  assert.deepEqual(verifyScopedChild(4242, null, reader), { ok: false, refusal: "sampled process is the wrapper" });
});

void test("OMPV-03 verifyScopedChild refuses a cgroup that is not the expected scope, not a scope of this pid, the root, or unreadable", () => {
  const comm = { "/proc/4242/comm": "omp\n" };
  assert.deepEqual(verifyScopedChild(4242, "/sys/fs/cgroup/other.scope", fakeReader({ ...comm, "/proc/4242/cgroup": CHILD_CGROUP })), { ok: false, refusal: "child scope could not be verified" });
  const wrongPid = "0::/user.slice/user-1000.slice/user@1000.service/app.slice/run-p1-i77.scope\n";
  assert.equal(verifyScopedChild(4242, null, fakeReader({ ...comm, "/proc/4242/cgroup": wrongPid })).ok, false);
  const login = "0::/user.slice/user-1000.slice/session-3.scope\n";
  assert.equal(verifyScopedChild(4242, null, fakeReader({ ...comm, "/proc/4242/cgroup": login })).ok, false);
  assert.equal(verifyScopedChild(4242, null, fakeReader({ ...comm, "/proc/4242/cgroup": "0::/\n" })).ok, false);
  assert.deepEqual(verifyScopedChild(4242, null, fakeReader({})), { ok: false, refusal: "child scope could not be verified" });
});

// ---- The readings CSV ------------------------------------------------------------------------------------------------------------

void test("OMPV-03 readingsCsv and parseReadingsCsv are inverse; a null scope total is an empty field", () => {
  const readings: ContentionReading[] = [
    { atMs: 0, scopeSomeTotalUs: 100, mainOnCpuNs: 5, mainRunqNs: 6 },
    { atMs: 250, scopeSomeTotalUs: null, mainOnCpuNs: 7, mainRunqNs: 8 },
  ];
  const csv = readingsCsv(readings);
  assert.equal(csv, "atMs,scopeSomeTotalUs,mainOnCpuNs,mainRunqNs\n0,100,5,6\n250,,7,8\n");
  assert.deepEqual(parseReadingsCsv(csv), readings);
  assert.deepEqual(parseReadingsCsv(readingsCsv([])), []);
});

void test("OMPV-03 parseReadingsCsv refuses a malformed header or line", () => {
  assert.throws(() => parseReadingsCsv("atMs,total\n"), /readings header/);
  assert.throws(() => parseReadingsCsv("atMs,scopeSomeTotalUs,mainOnCpuNs,mainRunqNs\n0,1,2\n"), /malformed readings line 2/);
  assert.throws(() => parseReadingsCsv("atMs,scopeSomeTotalUs,mainOnCpuNs,mainRunqNs\n0,x,2,3\n"), /malformed readings line 2/);
  assert.throws(() => parseReadingsCsv("atMs,scopeSomeTotalUs,mainOnCpuNs,mainRunqNs\n0,1,-2,3\n"), /malformed readings line 2/);
});

// ---- The run record --------------------------------------------------------------------------------------------------------------

// One part of a synthetic run: ready at 1000 ms, probes every 250 ms from 0 to 11 250 ms (the first four unanswered, boot), every later
// probe answered in 20 ms, and readings every 10 ms with a steady 10 percent on CPU, 5 percent run queue and 5 percent scope stall.
function syntheticPart(threads: boolean): RunRecordParts["control"] {
  const samples: ProbeSample[] = [];
  for (let sentAtMs = 0; sentAtMs <= 11_250; sentAtMs += 250) {
    samples.push({ sentAtMs, latencyMs: sentAtMs < 1000 ? undefined : sentAtMs === 1000 ? 100 : 20 });
  }
  const readings: ContentionReading[] = [];
  for (let atMs = 0; atMs <= 24_000; atMs += 10) {
    readings.push({ atMs, scopeSomeTotalUs: atMs * 50, mainOnCpuNs: atMs * 100_000, mainRunqNs: atMs * 50_000 });
  }
  const split = readThreadSplit(100, fakeReader(threadFiles().files, threadFiles().dirs));
  return { samples, readings, readyMs: 1000, threads: threads && split.ok ? split.split : null };
}

const BOUNDS: Bounds = { stallShareMax: 0.3, runqShareMax: 0.3, controlSelfMaxMs: 1000, controlSelfP95Ms: 500 };

function partsOf(overrides: Partial<RunRecordParts> = {}): RunRecordParts {
  return {
    arm: "before",
    pair: 1,
    branch: "S",
    startedAtEpochMs: 1_700_000_000_000,
    refusal: null,
    mechanicsHeld: true,
    control: syntheticPart(true),
    cold: syntheticPart(true),
    host: [{ label: "start", pressure: { avg10: 12.5, avg60: 10, avg300: 8 }, loadPerCpu: 3.5 }, { label: "end", pressure: null, loadPerCpu: null }],
    bounds: null,
    ...overrides,
  };
}

void test("OMPV-03 buildRunRecord assembles the record: label, tier, quiet claim, arm, run index, order, parts, metrics and validity", () => {
  const record = buildRunRecord(partsOf());
  assert.equal(record.label, PAIRED_LABEL);
  assert.equal(record.tier, TIER_SCOPED);
  assert.equal(record.quietClaim, false);
  assert.deepEqual([record.arm, record.pair, record.runIndex, record.controlFirst, record.branch, record.refusal, record.mechanics], ["before", 1, 1, true, "S", null, true]);
  assert.deepEqual([record.control.readyMs, record.control.firstAnswerMs, record.cold.readyMs, record.cold.firstAnswerMs], [1000, 1100, 1000, 1100]);
  assert.equal(record.control.raw.sent, 42);
  assert.equal(record.control.self.sent, 42);
  assert.equal(record.control.coverage, 1);
  assert.equal(record.control.probeGapMaxMs, 250);
  assert.ok(record.control.scopeStallShare !== null && Math.abs(record.control.scopeStallShare - 0.05) < 1e-9);
  assert.ok(record.control.runqShare !== null && Math.abs(record.control.runqShare - 0.05) < 1e-9);
  assert.equal(record.control.threads?.mainShare, 0.6);
  assert.deepEqual(record.metrics, { x: 0, x1: 0, x2: 0, s: 0 });
  assert.deepEqual(record.validity, { valid: true, rule: null, boundsApplied: false });
  assert.deepEqual(record.host.map((reading) => reading.label), ["start", "end"]);
});

void test("OMPV-03 buildRunRecord: the control and the cold attach alternate order by the run index (before of pair 2 is run 4, cold first)", () => {
  assert.equal(buildRunRecord(partsOf({ arm: "after", pair: 1 })).controlFirst, false);
  const second = buildRunRecord(partsOf({ arm: "before", pair: 2 }));
  assert.deepEqual([second.runIndex, second.controlFirst], [4, false]);
});

void test("OMPV-03 buildRunRecord applies the four bounds when given and says so; the Branch N record is the unscoped tier", () => {
  const bounded = buildRunRecord(partsOf({ bounds: BOUNDS }));
  assert.deepEqual(bounded.validity, { valid: true, rule: null, boundsApplied: true });
  const heavy = buildRunRecord(partsOf({ bounds: { ...BOUNDS, stallShareMax: 0.01 } }));
  assert.deepEqual(heavy.validity, { valid: false, rule: "V3", boundsApplied: true });
  const unscoped = buildRunRecord(partsOf({ branch: "N", bounds: { ...BOUNDS, stallShareMax: null } }));
  assert.equal(unscoped.tier, TIER_UNSCOPED);
});

void test("OMPV-04 buildRunRecord: a refusal is recorded with its closed phrase and rule V0, and counts for nothing", () => {
  const record = buildRunRecord(partsOf({ refusal: "scope command failed" }));
  assert.equal(record.refusal, "scope command failed");
  assert.deepEqual(record.validity, { valid: false, rule: "V0", boundsApplied: false });
});

void test("OMPV-04 buildRunRecord: mechanics that did not hold, or a missing ready time, make the run invalid with rule V1 and no metrics", () => {
  const failed = buildRunRecord(partsOf({ mechanicsHeld: false }));
  assert.deepEqual([failed.mechanics, failed.validity.rule], [false, "V1"]);
  const noReady = buildRunRecord(partsOf({ cold: { ...syntheticPart(true), readyMs: undefined } }));
  assert.deepEqual([noReady.mechanics, noReady.metrics, noReady.validity.rule], [false, null, "V1"]);
  assert.equal(noReady.cold.readyMs, null);
});

// Every string value of a record, at any depth.
function stringsOf(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry: unknown) => stringsOf(entry));
  }
  if (typeof value === "object" && value !== null) {
    return Object.values(value).flatMap((entry: unknown) => stringsOf(entry));
  }
  return [];
}

void test("OMPV-03 a record holds numbers, booleans and closed phrases only: no path, no environment value", () => {
  const allowed = new Set<string>([
    PAIRED_LABEL,
    TIER_SCOPED,
    TIER_UNSCOPED,
    "before",
    "after",
    "S",
    "N",
    ...REFUSAL_PHRASES,
    "V0",
    "V1",
    "V2",
    "V3",
    "V4",
    "V5",
    "on-cpu",
    "sleep",
    "mixed",
    "none",
    "unattributed",
    ...HOST_READING_LABELS,
    // The thread command names of the split fixture.
    "omp",
    "bun-pool",
    "timer",
  ]);
  const records = [
    buildRunRecord(partsOf({ bounds: BOUNDS })),
    buildRunRecord(partsOf({ refusal: "task list unreadable" })),
    buildRunRecord(partsOf({ branch: "N" })),
    buildCalibrationRecord({ attempt: 3, branch: "S", startedAtEpochMs: 1, refusal: null, mechanicsHeld: true, control: syntheticPart(true), host: [] }),
  ];
  for (const record of records) {
    const strings = stringsOf(record);
    assert.ok(strings.length > 0);
    for (const text of strings) {
      assert.ok(allowed.has(text), `a string of a record outside the closed phrases: ${text}`);
      assert.ok(!text.includes("/"), `a path in a record: ${text}`);
    }
  }
});

void test("OMPV-04 buildCalibrationRecord: the label, the tier, the quiet claim, the attempt and the mechanical validity of the control alone", () => {
  const record = buildCalibrationRecord({ attempt: 3, branch: "S", startedAtEpochMs: 5, refusal: null, mechanicsHeld: true, control: syntheticPart(true), host: [] });
  assert.deepEqual([record.tier, record.quietClaim, record.attempt, record.refusal, record.mechanics], [TIER_SCOPED, false, 3, null, true]);
  assert.deepEqual(record.validity, { valid: true, rule: null });
  assert.equal(record.control.threads?.tasks.length, 3);
  const unanswered = buildCalibrationRecord({ attempt: 4, branch: "S", startedAtEpochMs: 5, refusal: null, mechanicsHeld: true, control: { ...syntheticPart(false), samples: [{ sentAtMs: 0, latencyMs: undefined }] }, host: [] });
  assert.deepEqual([unanswered.mechanics, unanswered.validity.rule], [false, "V1"]);
  const refused = buildCalibrationRecord({ attempt: 5, branch: "S", startedAtEpochMs: 5, refusal: "scope command failed", mechanicsHeld: true, control: syntheticPart(false), host: [] });
  assert.equal(refused.validity.rule, "V0");
});

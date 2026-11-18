// EVID-02 (35-02, D-35-03): can a process that is the same uid as a capability-token holder, is not root and is not an ancestor
// of the holder read the token, or the signing key, out of the holder's memory, and what does it learn from the holder's
// environment? Three arms with the same probe, chosen by uid so one file serves both runs and no gate variable exists:
//   N (non-root run)  the subject: a detached, reparented probe against the test process, which holds a real DaemonClient with a
//                     real token from a real daemon in enforce mode and the real signing key;
//   D (non-root run)  the descendant control: the probe starts a synthetic holder itself, so Yama allows the read;
//   R (root run)      the root control: the same detached probe against the same kind of holder, run as root.
// N records found or denied either way. A control that cannot find what it is allowed to read makes the run inconclusive and fails
// the test with a message that says so. Every arm prints one diagnostic line (arm, uid, ptrace_scope, then the report, which holds
// counts, errno names, digest prefixes and public claims and never a token, a key or a needle).

import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { capabilityPolicyOf } from "../../src/capability/admit.js";
import { keyringPathOf } from "../../src/capability/keyring.js";
import { mintToken, TOKEN_CAPABILITIES, type MintClaims } from "../../src/capability/token.js";
import { connectDaemon, type DaemonClient } from "../../src/daemon/client.js";
import type { HostId } from "../../src/host/types.js";
import { startRig, type Rig } from "../support/capability-harness.js";
import {
  CONTROL_MARKER,
  CONTROL_NEEDLE,
  controlOutcomeOf,
  digestOf,
  errnoOf,
  probeProcess,
  runControlDescendant,
  startNonDescendantProbe,
  subjectOutcomeOf,
  type NeedleSpec,
  type ProbeReport,
} from "../support/memory-probe.js";
import { testTimeout } from "../support/timing.js";

const ENTRY = fileURLToPath(new URL("../support/memory-probe-run.js", import.meta.url));
const YAMA = "/proc/sys/kernel/yama/ptrace_scope";
const READ = { read: { path: "doc.txt", maxBytes: 64 } };
const SUBJECT_NEEDLES = ["token", "key-bytes", "key-text"] as const;
// The names of the environment variables this process was started with. /proc/PID/environ is the initial environment block, so a
// variable set after the process started is not in it: the markers the subject arm looks for are names that were present at exec.
const INITIAL_ENV_NAMES: ReadonlySet<string> = new Set(Object.keys(process.env));
const MARKERS = ["PATH", "HOME", "TMPDIR"].filter((name) => INITIAL_ENV_NAMES.has(name));
const LINUX = process.platform === "linux";
const ROOT = process.getuid?.() === 0;

function clientFor(rig: Rig, host: HostId): DaemonClient {
  return connectDaemon(rig.socketPath, rig.selection(), { host, now: () => rig.nowMs() });
}

function claimsOf(rig: Rig, host: HostId): MintClaims {
  const iat = Math.floor(rig.nowMs() / 1000);
  return { kid: "k1", sid: rig.selection().sessionId, host, caps: TOKEN_CAPABILITIES, iat, exp: iat + 3600 };
}

// The ptrace_scope text, or unreadable with the errno name.
function ptraceScope(): string {
  try {
    return readFileSync(YAMA, "utf8").trim();
  } catch (error: unknown) {
    return `unreadable:${errnoOf(error)}`;
  }
}

// A self-probe over a token planted in this process, found by its shape only (no needle: a needle would be a second copy in the
// probe's own memory and the check would prove nothing). When this fails the scanner is broken on this platform.
function runSelfCheck(): boolean {
  const iat = Math.floor(Date.now() / 1000);
  const planted = mintToken(randomBytes(32), { kid: "k1", sid: `selfcheck-${randomBytes(4).toString("hex")}`, host: "claude", caps: TOKEN_CAPABILITIES, iat, exp: iat + 3600 });
  const heldBuffer = Buffer.from(planted, "latin1");
  const heldText = heldBuffer.toString("latin1");
  const report = probeProcess({ kind: "target", pid: process.pid, needles: [], markers: [] });
  return report.mem.open === "ok" && heldText.length === heldBuffer.length && report.mem.tokenCandidates.some((candidate) => candidate.digest === digestOf(planted));
}

// Run once per file: the second arm of a non-root run reuses the answer instead of scanning this process again.
let selfCheckResult: boolean | undefined;
function selfCheck(): boolean {
  selfCheckResult ??= runSelfCheck();
  return selfCheckResult;
}

// The ptrace_scope text when the arms can run, or null after a skip that names the reason (a skip is not a pass).
function preflight(t: TestContext): string | null {
  if (!LINUX) {
    t.skip("not Linux: /proc is not available; arm not run");
    return null;
  }
  const scope = ptraceScope();
  t.diagnostic(`ptrace_scope ${scope}`);
  if (!/^[0-3]$/.test(scope)) {
    t.skip(`ptrace_scope is ${scope}: not readable as 0 to 3; arm not run`);
    return null;
  }
  if (!selfCheck()) {
    t.skip("the self-check failed: the scanner could not find a token planted in its own memory, so no arm means anything; arm not run");
    return null;
  }
  return scope;
}

interface Holder {
  readonly rig: Rig;
  readonly client: DaemonClient;
  readonly token: string;
  readonly key: Buffer;
}

// The rig's daemon, a real client holding a real token, and the real key of kid k1, all in this process.
async function startHolder(t: TestContext): Promise<Holder> {
  const rig = await startRig(t);
  assert.equal(capabilityPolicyOf(rig.policy).mode, "enforce", "the effective mode is enforce with no policy member");
  await rig.up();
  const client = clientFor(rig, "claude");
  assert.equal((await client.call(READ)).outcome, "done");
  const attaches = rig.auditLines().filter((line) => line["tool"] === "capability.attach");
  assert.equal(attaches.length, 1, "the client holds a real token from the daemon: one attach line");
  return { rig, client, token: rig.recompute(claimsOf(rig, "claude")), key: rig.keyOf("k1") };
}

function subjectNeedles(holder: Holder): NeedleSpec[] {
  return [
    { kind: "text", name: "token", text: holder.token },
    { kind: "bytes", name: "key-bytes", base64: holder.key.toString("base64") },
    { kind: "text", name: "key-text", text: holder.key.toString("base64url") },
  ];
}

async function probeHolder(t: TestContext, holder: Holder, file: string): Promise<ProbeReport> {
  const dir = mkdtempSync(join(tmpdir(), "rp-"));
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  return startNonDescendantProbe(
    ENTRY,
    { kind: "target", pid: process.pid, needles: subjectNeedles(holder), markers: MARKERS, keyringPath: keyringPathOf(holder.rig.stateDir) },
    join(dir, file),
  );
}

function failedRegions(report: ProbeReport): number {
  return Object.values(report.mem.regionsFailed).reduce((sum, count) => sum + count, 0);
}

function hitsOf(report: ProbeReport, name: string): number {
  const counts = report.mem.needleHits[name];
  return counts === undefined ? 0 : counts.latin1 + counts.utf16le + counts.raw;
}

// The report is redacted: neither the token nor the key, in any form, appears in its serialisation.
function assertRedacted(report: ProbeReport, holder: Holder): void {
  const text = JSON.stringify(report);
  for (const secret of [holder.token, holder.key.toString("hex"), holder.key.toString("base64"), holder.key.toString("base64url")]) {
    assert.equal(text.includes(secret), false, "the report holds neither the token nor the key");
  }
}

function diagnose(t: TestContext, arm: string, scope: string, uid: number | undefined, report: ProbeReport): void {
  t.diagnostic(`EVID-02 arm ${arm}: uid ${String(uid)}; ptrace_scope ${scope}; report ${JSON.stringify(report)}`);
}

if (!ROOT) {
  void test("EVID-02 arm N (subject): a same-uid non-root probe that is no ancestor of the holder reads the holder's memory or is refused; recorded either way", testTimeout(240_000), async (t) => {
    const scope = preflight(t);
    if (scope === null) {
      return;
    }
    const holder = await startHolder(t);
    const report = await probeHolder(t, holder, "n.json");
    diagnose(t, "N", scope, process.getuid?.(), report);
    const outcome = subjectOutcomeOf(report, SUBJECT_NEEDLES, digestOf(holder.token));
    t.diagnostic(`EVID-02 arm N outcome ${outcome}; token hits ${String(hitsOf(report, "token"))}; key-bytes hits ${String(hitsOf(report, "key-bytes"))}; key-text hits ${String(hitsOf(report, "key-text"))}; mem.open ${report.mem.open}; environ.read ${report.environ.read}; keyFile ${report.keyFile}`);

    // Consistency only. Whether mem.open was ok or denied, and whether anything was found, is recorded and never asserted.
    assertRedacted(report, holder);
    assert.equal(report.targetGone, false);
    assert.equal(report.targetChain[0], process.pid);
    assert.equal(report.probeChain.includes(process.pid), false, "the probe was reparented: this process is not its ancestor");
    assert.equal(report.probeIsAncestorOfTarget, false, "the probe is no ancestor of the holder");
    assert.notEqual(report.probeUid, 0, "the probe is not root");
    assert.equal(report.probeUid, report.target.uid, "the probe and the holder are the same uid");
    if (report.mem.open === "ok") {
      assert.equal(report.mem.maps, "read");
      assert.equal(report.mem.truncated, false, "the coverage is complete: no bound stopped the scan");
      assert.equal(report.mem.regionsListed, report.mem.regionsRead + failedRegions(report) + report.mem.regionsUnread);
      assert.equal(report.mem.regionsListed, report.mem.regionsRead + failedRegions(report), "every listed region was read or failed with a recorded errno");
    }
    const anyHit = SUBJECT_NEEDLES.some((name) => hitsOf(report, name) > 0) || report.mem.tokenCandidates.some((candidate) => candidate.digest === digestOf(holder.token));
    if (anyHit) {
      assert.equal(report.mem.open, "ok", "a hit implies the open of the mem file succeeded");
    }
    if (report.environ.read === "readable") {
      assert.equal(report.environ.tokenShapes, 0, "the token is never in the environment block: the product never delivers it there");
    }
    assert.equal((await holder.client.call(READ)).outcome, "done", "the holder is unharmed by the probe");
  });

  void test("EVID-02 arm D (descendant control): a probe that started the holder itself finds a token in its heap when the kernel allows the read", testTimeout(180_000), async (t) => {
    const scope = preflight(t);
    if (scope === null) {
      return;
    }
    const report = await runControlDescendant();
    diagnose(t, "D", scope, process.getuid?.(), report);
    if (Number(scope) >= 2) {
      t.diagnostic(`EVID-02 arm D not applicable: ptrace_scope ${scope} refuses a descendant too; recorded, no assertion`);
      return;
    }
    const outcome = controlOutcomeOf(report, [CONTROL_NEEDLE], report.controlDigest);
    t.diagnostic(`EVID-02 arm D outcome ${outcome}; mem.open ${report.mem.open}; environ.read ${report.environ.read}`);
    assert.equal(report.probeIsAncestorOfTarget, true, "the probe is the holder's ancestor by construction");
    assert.equal(
      outcome,
      "found",
      "INCONCLUSIVE RUN: the descendant control could not find a token it is allowed to read, so a negative in arm N means nothing",
    );
    assert.equal(report.mem.open, "ok");
    assert.equal(report.environ.markers[CONTROL_MARKER], true, "the planted marker is in the holder's environment block");
    assert.equal(report.environ.tokenShapes, 0, "the synthetic token is not in the environment block");
    assert.equal(report.mem.truncated, false);
  });
} else {
  void test("EVID-02 arm R (root control): the same probe, run as root, finds the real token and the key in the real holder", testTimeout(240_000), async (t) => {
    const scope = preflight(t);
    if (scope === null) {
      return;
    }
    const holder = await startHolder(t);
    const report = await probeHolder(t, holder, "r.json");
    diagnose(t, "R", scope, process.getuid?.(), report);
    const outcome = controlOutcomeOf(report, SUBJECT_NEEDLES, digestOf(holder.token));
    t.diagnostic(`EVID-02 arm R outcome ${outcome}; token hits ${String(hitsOf(report, "token"))}; key-bytes hits ${String(hitsOf(report, "key-bytes"))}; key-text hits ${String(hitsOf(report, "key-text"))}; mem.open ${report.mem.open}; environ.read ${report.environ.read}; keyFile ${report.keyFile}`);
    assertRedacted(report, holder);
    assert.equal(report.probeUid, 0, "the probe is root");
    assert.equal(report.targetChain[0], process.pid);
    assert.equal(
      report.mem.open === "ok" && hitsOf(report, "token") > 0 && hitsOf(report, "key-bytes") + hitsOf(report, "key-text") > 0,
      true,
      "INCONCLUSIVE RUN: the scanner cannot find a token and a key it is allowed to read, so every negative of the other arms means nothing",
    );
    assert.ok(report.mem.tokenCandidates.some((candidate) => candidate.digest === digestOf(holder.token)), "the real token is found by its shape");
    assert.equal(report.mem.truncated, false);
    assert.equal(report.mem.regionsListed, report.mem.regionsRead + failedRegions(report));
    assert.equal(report.environ.read, "readable");
    assert.equal(report.environ.tokenShapes, 0, "the token is never in the environment block");
    assert.equal((await holder.client.call(READ)).outcome, "done", "the holder is unharmed by the probe");
  });
}

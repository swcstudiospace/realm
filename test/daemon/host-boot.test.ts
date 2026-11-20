// The daemon-side host boot recorder (BOOT-06, BOOT-07): the rate bound, the metrics row, the redacted log line, the
// capability posture and the daemon-only boot audit chain. The recorder runs against a real metrics registry, a capturing
// logger and a temporary state directory; the audit writer is the real appendAudit unless a test injects one.

import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyAuditFile } from "../../src/audit/chain.js";
import { redactString } from "../../src/audit/redact.js";
import { reconcileAuditLogs } from "../../src/audit/reconcile.js";
import type { AuditEntryInput } from "../../src/audit/log.js";
import { validate, type Policy } from "../../src/contract/validate.js";
import { makeRealmError, RealmError, type ErrorCode } from "../../src/core/errors.js";
import { createHostBootRecorder, type HostBootRecorder } from "../../src/daemon/host-boot.js";
import { HOST_BOOT_PHASES } from "../../src/host/boot-report.js";
import type { HostAuditFn } from "../../src/host/host-audit.js";
import { createLogger } from "../../src/observe/logger.js";
import { createMetrics, type Metrics } from "../../src/observe/metrics.js";

const FIXED = new Date("2026-11-17T12:00:00.000Z");
const CODED: readonly string[] = ["refused", "failed", "link-lost"];
const AUDITED: readonly string[] = ["attached", "refused", "failed"];

function policy(over: Partial<Pick<Policy, "mode" | "shellEnabled">> = {}): Policy {
  const parsed = validate("policy", { workspaceRoots: ["/work/space"], ...over });
  assert.ok(parsed.ok, "the test policy validates");
  return parsed.value;
}

function report(over: Record<string, unknown> = {}): { report: Record<string, unknown> } {
  const phase = typeof over["phase"] === "string" ? over["phase"] : "attached";
  return {
    report: {
      schemaVersion: 1,
      bootId: "boot-0123456789abcdef",
      hostId: "claude",
      transport: "mcp",
      phase: "attached",
      code: CODED.includes(phase) ? "POLICY_DENIED" : null,
      attempt: 1,
      durationMs: 120,
      state: "active",
      ...over,
    },
  };
}

interface Harness {
  readonly recorder: HostBootRecorder;
  readonly metrics: Metrics;
  readonly lines: string[];
  readonly stateDir: string;
  readonly clock: { now: number };
  readonly audits: { stateDir: string; input: AuditEntryInput }[];
}

interface HarnessOptions {
  readonly policy?: Policy;
  readonly audit?: HostAuditFn;
  readonly recordAudits?: boolean;
}

function harness(t: TestContext, options: HarnessOptions = {}): Harness {
  const stateDir = realpathSync(mkdtempSync(join(tmpdir(), "realm-host-boot-")));
  t.after(() => {
    rmSync(stateDir, { recursive: true, force: true });
  });
  const lines: string[] = [];
  const logger = createLogger({
    sink: {
      write(line) {
        lines.push(line);
        return true;
      },
    },
    level: "debug",
    now: () => FIXED,
  });
  const metrics = createMetrics({ now: () => FIXED, monotonicMs: () => 0 });
  const clock = { now: 1_000 };
  const audits: { stateDir: string; input: AuditEntryInput }[] = [];
  const audit: HostAuditFn | undefined =
    options.recordAudits === true
      ? (dir, input) => {
          audits.push({ stateDir: dir, input });
        }
      : options.audit;
  const recorder = createHostBootRecorder({
    logger,
    metrics,
    policy: options.policy ?? policy(),
    stateDir,
    monotonicMs: () => clock.now,
    version: "1.2.3",
    ...(audit === undefined ? {} : { audit }),
  });
  return { recorder, metrics, lines, stateDir, clock, audits };
}

function logged(h: Harness): Record<string, unknown>[] {
  return h.lines.map((line) => JSON.parse(line) as Record<string, unknown>);
}

function auditFile(h: Harness): string {
  return join(h.stateDir, "audit", "host-boot.jsonl");
}

function assertCode(action: () => unknown, code: ErrorCode): void {
  assert.throws(action, (error: unknown) => error instanceof RealmError && error.code === code);
}

void test("BOOT-06: an accepted report answers recorded, counts a metrics row and times the attach", (t) => {
  const h = harness(t, { recordAudits: true });
  assert.deepEqual(h.recorder.record(report()), { recorded: true });
  const snap = h.metrics.snapshot();
  assert.deepEqual(snap.hostBoot, [{ hostId: "claude", transport: "mcp", phase: "attached", count: 1 }]);
  assert.equal(snap.timings.hostBootMs?.count, 1);
  assert.equal(snap.timings.hostBootMs.sumMs, 120);
});

void test("BOOT-06: the host.boot line has exactly the documented keys and the level of its phase", (t) => {
  const h = harness(t, { recordAudits: true });
  for (const phase of HOST_BOOT_PHASES) {
    h.recorder.record(report({ phase, state: phase === "closed" ? null : "active", bootId: `boot-${phase}` }));
  }
  const lines = logged(h);
  assert.equal(lines.length, HOST_BOOT_PHASES.length);
  for (const [index, phase] of HOST_BOOT_PHASES.entries()) {
    const line = lines[index];
    assert.ok(line !== undefined);
    assert.equal(line["event"], "host.boot");
    assert.equal(line["level"], CODED.includes(phase) ? "warn" : "info", phase);
    assert.equal(line["correlationId"], `boot-${phase}`);
    const expected = ["ts", "level", "event", "correlationId", "hostId", "transport", "phase", "attempt", "durationMs"];
    if (phase !== "closed") {
      expected.push("state");
    }
    if (CODED.includes(phase)) {
      expected.push("code");
    }
    if (phase === "attached" || phase === "refused") {
      expected.push("capabilitiesDenied");
    }
    assert.deepEqual(Object.keys(line).sort(), expected.sort(), phase);
    assert.equal(line["hostId"], "claude");
    assert.equal(line["transport"], "mcp");
    assert.equal(line["phase"], phase);
    assert.equal(line["attempt"], 1);
    assert.equal(line["durationMs"], 120);
  }
});

void test("BOOT-07: the capability posture names what the loaded policy denies, per host, and only for attached and refused", (t) => {
  const denying = harness(t, { recordAudits: true, policy: policy({ shellEnabled: false, mode: "advisory" }) });
  denying.recorder.record(report());
  denying.recorder.record(report({ hostId: "omp", transport: "extension", bootId: "omp-boot" }));
  denying.recorder.record(report({ phase: "failed", bootId: "failed-boot" }));
  const [claude, omp, failed] = logged(denying);
  assert.deepEqual(claude?.["capabilitiesDenied"], ["exec.shell:SHELL_NOT_ALLOWED"]);
  assert.deepEqual(omp?.["capabilitiesDenied"], ["exec.shell:SHELL_NOT_ALLOWED", "host.tools.restrict:POLICY_DENIED"]);
  assert.equal(failed !== undefined && "capabilitiesDenied" in failed, false, "a failed boot logs no posture");

  const allowing = harness(t, { recordAudits: true, policy: policy({ shellEnabled: true, mode: "fail-closed" }) });
  allowing.recorder.record(report());
  allowing.recorder.record(report({ hostId: "omp", transport: "extension", phase: "refused", bootId: "omp-boot" }));
  for (const line of logged(allowing)) {
    assert.equal("capabilitiesDenied" in line, false, "nothing denied, no field");
  }
});

void test("BOOT-07: an unlabelled session logs no posture, and the posture is computed once per host id", (t) => {
  const counts = { reads: 0 };
  // A call: assert.equal narrows a property read to its expected literal, which would make the later comparisons constant.
  const readCount = (): number => counts.reads;
  const base = policy({ shellEnabled: false });
  const counting: Policy = {
    ...base,
    get workspaceRoots(): readonly string[] {
      counts.reads += 1;
      return base.workspaceRoots;
    },
  };
  const h = harness(t, { recordAudits: true, policy: counting });
  h.recorder.record(report({ hostId: "unlabelled", bootId: "anon-boot" }));
  assert.equal(readCount(), 0, "unlabelled computes nothing");
  h.recorder.record(report({ bootId: "claude-one" }));
  const afterFirst = readCount();
  assert.ok(afterFirst > 0, "the first claude report resolves the capabilities");
  h.recorder.record(report({ bootId: "claude-two" }));
  h.recorder.record(report({ phase: "refused", bootId: "claude-three" }));
  assert.equal(readCount(), afterFirst, "cached per host id");
  h.recorder.record(report({ hostId: "codex", bootId: "codex-one" }));
  assert.ok(readCount() > afterFirst, "another host id resolves its own");
  const [anon] = logged(h);
  assert.equal(anon !== undefined && "capabilitiesDenied" in anon, false);
});

void test("BOOT-07: only attached, refused and failed reach the audit chain, with the exact fields", (t) => {
  const h = harness(t, { recordAudits: true });
  for (const phase of HOST_BOOT_PHASES) {
    h.recorder.record(report({ phase, bootId: `boot-${phase}`, hostId: "kimi-code", transport: "acp" }));
  }
  assert.deepEqual(
    h.audits.map((entry) => entry.input),
    [
      { sessionId: "host-boot", tool: "host.boot", outcome: "ok", path: "kimi-code/acp/attached", correlationId: "boot-attached" },
      { sessionId: "host-boot", tool: "host.boot", outcome: "POLICY_DENIED", path: "kimi-code/acp/refused", correlationId: "boot-refused" },
      { sessionId: "host-boot", tool: "host.boot", outcome: "POLICY_DENIED", path: "kimi-code/acp/failed", correlationId: "boot-failed" },
    ],
  );
  assert.deepEqual(
    [...new Set(h.audits.map((entry) => entry.stateDir))],
    [h.stateDir],
  );
  assert.equal(h.audits.length, AUDITED.length);
});

void test("BOOT-07: the boot chain is the existing hash chain: 0600, linked and verifiable", (t) => {
  const h = harness(t);
  for (const [index, phase] of ["attached", "refused", "failed", "link-lost", "attached"].entries()) {
    h.recorder.record(report({ phase, bootId: `boot-${phase}-${String(index)}` }));
  }
  const file = auditFile(h);
  assert.equal(statSync(file).mode & 0o777, 0o600);
  const verified = verifyAuditFile(file);
  assert.equal(verified.ok, true);
  assert.equal(verified.lines, 4, "link-lost is not audited");
  const parsed = readFileSync(file, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  for (const line of parsed) {
    assert.equal(line["sessionId"], "host-boot");
    assert.equal(line["tool"], "host.boot");
    assert.equal(typeof line["correlationId"], "string");
    assert.equal(typeof line["path"] === "string" && /^[a-z-]+\/(extension|mcp|acp)\/[a-z-]+$/.test(line["path"]), true);
    assert.equal("execSummary" in line, false);
    assert.equal("bytes" in line, false);
  }
  assert.deepEqual(parsed.map((line) => line["seq"]), [1, 2, 3, 4]);
});

void test("BOOT-07: a token-shaped boot id is hashed in the audit and redacted in the log, never stored raw", (t) => {
  const bootId = `ghp_${"a1B2c3D4e5".repeat(4).slice(0, 36)}`;
  assert.notEqual(redactString(bootId), bootId, "the id is one the redactor rewrites");
  const h = harness(t);
  h.recorder.record(report({ bootId }));
  assert.equal(h.lines.join("\n").includes(bootId), false);
  const file = readFileSync(auditFile(h), "utf8");
  assert.equal(file.includes(bootId), false);
  const [line] = file.trim().split("\n");
  const parsed = JSON.parse(line ?? "") as Record<string, unknown>;
  assert.equal(parsed["correlationId"], createHash("sha256").update(bootId, "utf8").digest("hex"));
  assert.equal(verifyAuditFile(auditFile(h)).ok, true);
});

void test("BOOT-07: a failed audit append answers AUDIT_WRITE_FAILED after the metric and log, and the next report succeeds", (t) => {
  let calls = 0;
  const failing: HostAuditFn = () => {
    calls += 1;
    if (calls === 1) {
      throw makeRealmError("AUDIT_WRITE_FAILED");
    }
    if (calls === 2) {
      throw new Error("disk is /home/user/secret and full");
    }
    if (calls === 3) {
      throw makeRealmError("SCHEMA_INVALID");
    }
  };
  const h = harness(t, { audit: failing });
  assertCode(() => h.recorder.record(report({ bootId: "first" })), "AUDIT_WRITE_FAILED");
  assert.equal(h.metrics.snapshot().hostBoot?.[0]?.count, 1, "the metric stays recorded");
  const afterFirst = logged(h);
  assert.deepEqual(afterFirst.map((line) => line["event"]), ["host.boot", "host.boot.audit_failed"]);
  assert.equal(afterFirst[0]?.["correlationId"], "first");
  assert.equal(afterFirst[1]?.["level"], "error");
  assert.equal(afterFirst[1]["correlationId"], "first");
  assert.equal(afterFirst[1]["code"], "AUDIT_WRITE_FAILED");

  // A throw that is not a RealmError is mapped, and its text is never logged.
  assertCode(() => h.recorder.record(report({ bootId: "second" })), "AUDIT_WRITE_FAILED");
  assert.equal(h.lines.join("\n").includes("secret"), false);
  // A RealmError of another code keeps its code, as the host-plugins audit does.
  assertCode(() => h.recorder.record(report({ bootId: "third" })), "SCHEMA_INVALID");

  assert.deepEqual(h.recorder.record(report({ bootId: "fourth" })), { recorded: true });
  assert.equal(h.metrics.snapshot().hostBoot?.[0]?.count, 4);
  // A phase that is not audited is unaffected by a failing writer.
  calls = 0;
  assert.deepEqual(h.recorder.record(report({ phase: "closed", bootId: "closing" })), { recorded: true });
  assert.equal(calls, 0);
});

void test("BOOT-06: the bucket takes 60, refuses the 61st with nothing recorded, and refills one per second", (t) => {
  const h = harness(t, { recordAudits: true });
  for (let index = 0; index < 60; index += 1) {
    h.recorder.record(report({ bootId: `boot-${String(index)}` }));
  }
  const before = { rows: JSON.stringify(h.metrics.snapshot()), lines: h.lines.length, audits: h.audits.length };
  assert.equal(before.lines, 60);
  assert.equal(before.audits, 60);
  assertCode(() => h.recorder.record(report({ bootId: "over" })), "POLICY_DENIED");
  // A malformed frame at an empty bucket is POLICY_DENIED, not SCHEMA_INVALID: the bucket is taken before the parse.
  assertCode(() => h.recorder.record("not params"), "POLICY_DENIED");
  assertCode(() => h.recorder.record({ report: { phase: "attached" } }), "POLICY_DENIED");
  assert.equal(JSON.stringify(h.metrics.snapshot()), before.rows);
  assert.equal(h.lines.length, before.lines);
  assert.equal(h.audits.length, before.audits);

  h.clock.now += 999;
  assertCode(() => h.recorder.record(report({ bootId: "early" })), "POLICY_DENIED");
  h.clock.now += 1;
  assert.deepEqual(h.recorder.record(report({ bootId: "refilled" })), { recorded: true });
  assert.equal(h.lines.length, before.lines + 1);
  assertCode(() => h.recorder.record(report({ bootId: "again" })), "POLICY_DENIED");

  // The bucket never holds more than its capacity, however long the daemon was quiet.
  h.clock.now += 3_600_000;
  let accepted = 0;
  for (let index = 0; index < 100; index += 1) {
    try {
      h.recorder.record(report({ bootId: `quiet-${String(index)}` }));
      accepted += 1;
    } catch (error: unknown) {
      assert.ok(error instanceof RealmError && error.code === "POLICY_DENIED");
    }
  }
  assert.equal(accepted, 60);
});

void test("BOOT-06: a malformed frame records nothing, and a clock that goes backwards never grants tokens", (t) => {
  const h = harness(t, { recordAudits: true });
  const frames: unknown[] = [
    undefined,
    null,
    "report",
    [],
    {},
    { report: null },
    { report: [] },
    { report: { phase: "attached" } },
    report({ hostId: "alias" }),
    report({ phase: "failed", code: null }),
    report({ attempt: 10 }),
    { ...report(), selection: {} },
  ];
  for (const [index, frame] of frames.entries()) {
    if (index === frames.length - 1) {
      // An extra key beside report is the channel's refusal; the recorder only reads report, so it is accepted here.
      assert.deepEqual(h.recorder.record(frame), { recorded: true });
      continue;
    }
    assertCode(() => h.recorder.record(frame), "SCHEMA_INVALID");
  }
  assert.equal(h.metrics.snapshot().hostBoot?.length, 1);
  assert.equal(h.lines.length, 1);
  assert.equal(h.audits.length, 1);
  // Every frame above took a token, malformed or not: 60 minus 12 are left, and a clock that goes back adds none.
  h.clock.now -= 5_000;
  let accepted = 0;
  for (let index = 0; index < 60; index += 1) {
    try {
      h.recorder.record(report({ bootId: `back-${String(index)}` }));
      accepted += 1;
    } catch (error: unknown) {
      assert.ok(error instanceof RealmError && error.code === "POLICY_DENIED");
    }
  }
  assert.equal(accepted, 60 - frames.length);
  assertCode(() => h.recorder.record(report({ bootId: "backwards" })), "POLICY_DENIED");
});

void test("BOOT-07: the boot chain carries no phase, so reconciliation never writes a line into it", (t) => {
  const h = harness(t);
  h.recorder.record(report());
  h.recorder.record(report({ phase: "failed", bootId: "boot-failed" }));
  const file = auditFile(h);
  const before = readFileSync(file, "utf8");
  const result = reconcileAuditLogs(h.stateDir);
  assert.equal(result.appended, 0);
  assert.equal(result.failed, 0);
  assert.equal(readFileSync(file, "utf8"), before);
  assert.equal(verifyAuditFile(file).ok, true);
});

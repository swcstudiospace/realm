// The host-boot control method end to end (BOOT-06, BOOT-07): a real daemon in this process over the existing fakes, raw
// control requests over the socket, the daemon log through a capturing logger and the boot audit chain read from the
// state directory. The daemon is started through startDaemon, as startRealmDaemon does, because the test must hand the
// daemon a logger it can read.

import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { verifyAuditFile } from "../../src/audit/chain.js";
import { redactString } from "../../src/audit/redact.js";
import { sendRequest, type ControlReply } from "../../src/daemon/channel.js";
import { selectionOf } from "../../src/daemon/client.js";
import { startDaemon } from "../../src/daemon/daemon.js";
import { HOST_BOOT_PHASES, HOST_BOOT_TRANSPORTS, BOOT_REPORT_HOSTS } from "../../src/host/boot-report.js";
import { createLogger } from "../../src/observe/logger.js";
import { isMetricsSnapshot, type MetricsSnapshot } from "../../src/observe/metrics.js";
import type { PodmanProbeResult } from "../../src/runtime/podman-probe.js";
import { FakeBridge } from "../support/fake-bridge.js";
import { FakeExecutionService } from "../support/fake-execution.js";

const IMAGE = `registry.example.com/realm/workload@sha256:${"0".repeat(64)}`;
const CLOCK_ISO = "2026-11-17T09:30:00.000Z";
const CONTROL_BOUND_MS = 5000;

interface BootDaemon {
  readonly socketPath: string;
  readonly stateDir: string;
  readonly workspace: string;
  readonly lines: string[];
  send(method: string, params?: unknown): Promise<ControlReply>;
  metrics(): Promise<MetricsSnapshot>;
}

function bootReport(over: Record<string, unknown> = {}): { report: Record<string, unknown> } {
  return {
    report: {
      schemaVersion: 1,
      bootId: "boot-0123456789abcdef",
      hostId: "claude",
      transport: "mcp",
      phase: "attached",
      code: null,
      attempt: 1,
      durationMs: 250,
      state: "active",
      ...over,
    },
  };
}

async function startBootDaemon(t: TestContext): Promise<BootDaemon> {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "realm-boot-ctl-")));
  const workspace = join(base, "ws");
  const stateDir = join(base, "state");
  mkdirSync(workspace, { recursive: true });
  const policyPath = join(base, "policy.json");
  writeFileSync(policyPath, JSON.stringify({ workspaceRoots: [workspace] }));
  const lines: string[] = [];
  const logger = createLogger({
    sink: {
      write(line) {
        lines.push(line);
        return true;
      },
    },
    level: "debug",
    now: () => new Date(CLOCK_ISO),
  });
  const daemon = await startDaemon({
    runtimeInput: { image: IMAGE, stateDir, workspaceRoot: workspace },
    policyPath,
    exec: new FakeExecutionService(),
    bridge: new FakeBridge(),
    clock: () => new Date(CLOCK_ISO),
    logger,
    runOpenShell: () => Promise.resolve({ exitCode: 0, stdout: "", stderr: "", truncated: false }),
    // A libpod double whose realm listing is empty, so the startup reap removes nothing.
    libpod: {
      info: () => Promise.resolve({ rootless: true, version: "5.0.0" }),
      listContainersByLabel: () => Promise.resolve([]),
      inspectContainer: () => Promise.resolve(null),
      stopContainer: () => Promise.resolve(),
      removeContainer: () => Promise.resolve(),
    },
    probe: () => Promise.resolve<PodmanProbeResult>({ ok: true, version: "5.0.0" }),
  });
  t.after(async () => {
    try {
      await daemon.stop();
      await daemon.done;
    } catch {
      // The test already stopped the daemon, or it never served.
    }
    rmSync(base, { recursive: true, force: true });
  });
  let requests = 0;
  const send = (method: string, params?: unknown): Promise<ControlReply> => {
    requests += 1;
    return sendRequest(
      daemon.socketPath,
      { id: `boot-ctl-${String(requests)}`, method, ...(params === undefined ? {} : { params }) },
      { timeoutMs: CONTROL_BOUND_MS },
    );
  };
  return {
    socketPath: daemon.socketPath,
    stateDir,
    workspace,
    lines,
    send,
    async metrics(): Promise<MetricsSnapshot> {
      const reply = await send("metrics", { selection: selectionOf(workspace) });
      assert.equal(reply.error, undefined);
      assert.ok(isMetricsSnapshot(reply.result), "the daemon's snapshot validates, host-boot keys included");
      return reply.result;
    },
  };
}

function hostBootLines(daemon: BootDaemon): Record<string, unknown>[] {
  return daemon.lines
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .filter((line) => line["event"] === "host.boot");
}

function auditPath(daemon: BootDaemon): string {
  return join(daemon.stateDir, "audit", "host-boot.jsonl");
}

void test("BOOT-06: a valid host-boot request is recorded: reply, metrics row, timing, control counter and log line", async (t) => {
  const daemon = await startBootDaemon(t);
  const reply = await daemon.send("host-boot", bootReport());
  assert.equal(reply.error, undefined);
  assert.deepEqual(reply.result, { recorded: true });

  const snap = await daemon.metrics();
  assert.deepEqual(snap.hostBoot, [{ hostId: "claude", transport: "mcp", phase: "attached", count: 1 }]);
  assert.equal(snap.timings.hostBootMs?.count, 1);
  assert.equal(snap.timings.hostBootMs?.sumMs, 250);
  assert.deepEqual(
    snap.controlRequests.find((row) => row.method === "host-boot"),
    { method: "host-boot", count: 1, refused: 0 },
  );

  const [line, ...rest] = hostBootLines(daemon);
  assert.equal(rest.length, 0);
  assert.equal(line?.["level"], "info");
  assert.equal(line?.["correlationId"], "boot-0123456789abcdef");
  assert.equal(line?.["hostId"], "claude");
  assert.equal(line?.["phase"], "attached");
  // The default policy denies shell, and the log says so: the capability posture of this host under the loaded policy.
  assert.deepEqual(line?.["capabilitiesDenied"], ["exec.shell:SHELL_NOT_ALLOWED"]);

  // The audit chain holds the one attached line, written by the daemon, and verifies.
  assert.equal(verifyAuditFile(auditPath(daemon)).ok, true);
  const audit = JSON.parse(readFileSync(auditPath(daemon), "utf8").trim()) as Record<string, unknown>;
  assert.equal(audit["sessionId"], "host-boot");
  assert.equal(audit["tool"], "host.boot");
  assert.equal(audit["outcome"], "ok");
  assert.equal(audit["path"], "claude/mcp/attached");
  assert.equal(audit["correlationId"], "boot-0123456789abcdef");
});

void test("BOOT-06: a refused and a failed report keep their code in the log, the audit outcome and the counters", async (t) => {
  const daemon = await startBootDaemon(t);
  await daemon.send("host-boot", bootReport({ phase: "refused", code: "POLICY_DENIED", bootId: "boot-refused" }));
  await daemon.send("host-boot", bootReport({ phase: "failed", code: "DAEMON_START_TIMEOUT", bootId: "boot-failed", state: null }));
  await daemon.send("host-boot", bootReport({ phase: "closed", bootId: "boot-closed" }));
  const snap = await daemon.metrics();
  assert.equal(snap.hostBoot?.length, 3);
  assert.equal(snap.timings.hostBootMs?.count, 2, "closed is an event, not a boot cost");
  const warns = hostBootLines(daemon).filter((line) => line["level"] === "warn");
  assert.deepEqual(warns.map((line) => line["code"]), ["POLICY_DENIED", "DAEMON_START_TIMEOUT"]);
  const outcomes = readFileSync(auditPath(daemon), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .map((line) => [line["path"], line["outcome"]]);
  assert.deepEqual(outcomes, [
    ["claude/mcp/refused", "POLICY_DENIED"],
    ["claude/mcp/failed", "DAEMON_START_TIMEOUT"],
  ]);
  assert.equal(verifyAuditFile(auditPath(daemon)).ok, true);
});

void test("BOOT-06: a malformed report, a selection, an unknown key and an out-of-vocabulary value are SCHEMA_INVALID and record nothing", async (t) => {
  const daemon = await startBootDaemon(t);
  const bad: readonly (readonly [string, unknown])[] = [
    ["a report that is a string", { report: "attached" }],
    ["no report", {}],
    ["a selection beside the report", { ...bootReport(), selection: { workspaceRoot: daemon.workspace, sessionId: "p0123456789ab" } }],
    ["an unknown key beside the report", { ...bootReport(), extra: 1 }],
    ["an unknown key inside the report", bootReport({ extra: 1 })],
    ["a host outside the vocabulary", bootReport({ hostId: "x".repeat(5000) })],
    ["a phase outside the vocabulary", bootReport({ phase: "started" })],
    ["a code on an attached report", bootReport({ code: "POLICY_DENIED" })],
    ["a transport that does not fit the host", bootReport({ hostId: "omp", transport: "mcp" })],
  ];
  for (const [label, params] of bad) {
    const reply = await daemon.send("host-boot", params);
    assert.equal(reply.error?.code, "SCHEMA_INVALID", label);
    assert.equal(reply.result, undefined, label);
  }
  const noParams = await daemon.send("host-boot");
  assert.equal(noParams.error?.code, "SCHEMA_INVALID");

  const snap = await daemon.metrics();
  assert.deepEqual(snap.hostBoot, []);
  assert.equal(snap.timings.hostBootMs?.count, 0);
  assert.deepEqual(
    snap.controlRequests.find((row) => row.method === "host-boot"),
    { method: "host-boot", count: bad.length + 1, refused: bad.length + 1 },
  );
  assert.equal(hostBootLines(daemon).length, 0);
  assert.equal(existsSync(auditPath(daemon)), false, "a refused report writes no audit line");
});

void test("BOOT-06: a token-shaped boot id is redacted in the daemon log and hashed in the audit, never stored raw", async (t) => {
  const daemon = await startBootDaemon(t);
  const bootId = `ghp_${"a1B2c3D4e5".repeat(4).slice(0, 36)}`;
  assert.notEqual(redactString(bootId), bootId);
  const reply = await daemon.send("host-boot", bootReport({ bootId }));
  assert.deepEqual(reply.result, { recorded: true });
  assert.equal(daemon.lines.join("\n").includes(bootId), false);
  const audit = readFileSync(auditPath(daemon), "utf8");
  assert.equal(audit.includes(bootId), false);
  assert.equal(
    (JSON.parse(audit.trim()) as Record<string, unknown>)["correlationId"],
    createHash("sha256").update(bootId, "utf8").digest("hex"),
  );
});

void test("BOOT-06: a flood of reports is bounded at 60, status keeps answering and nothing sends down", async (t) => {
  const daemon = await startBootDaemon(t);
  const bootIds = new Set<string>();
  const started = performance.now();
  const sends: Promise<ControlReply>[] = [];
  for (let index = 0; index < 200; index += 1) {
    const bootId = `flood-${String(index)}`;
    bootIds.add(bootId);
    sends.push(daemon.send("host-boot", bootReport({ bootId })));
  }
  // A status request made while the flood is in flight answers within its bound and the realm state is unchanged.
  const statusStarted = performance.now();
  const status = await daemon.send("status", { selection: selectionOf(daemon.workspace) });
  assert.ok(performance.now() - statusStarted < CONTROL_BOUND_MS, "status answers inside its 5000 ms bound");
  assert.equal(status.error, undefined);
  const body = status.result as { snapshot: { state: string } };
  assert.equal(body.snapshot.state, "unbound");

  const replies = await Promise.all(sends);
  const elapsedMs = performance.now() - started;
  const accepted = replies.filter((reply) => reply.error === undefined);
  const denied = replies.filter((reply) => reply.error?.code === "POLICY_DENIED");
  assert.equal(accepted.length + denied.length, 200, "every report is accepted or POLICY_DENIED");
  // One token refills per second, so a flood that finishes inside a second is held at exactly the capacity.
  assert.ok(accepted.length >= 60 && accepted.length <= 60 + Math.floor(elapsedMs / 1000), `accepted ${String(accepted.length)}`);

  const snap = await daemon.metrics();
  assert.equal(snap.hostBoot?.[0]?.count, accepted.length);
  assert.equal(snap.timings.hostBootMs?.count, accepted.length);
  assert.equal(
    snap.controlRequests.find((row) => row.method === "down"),
    undefined,
    "the flood never causes a down",
  );
  assert.equal(snap.controlRequests.find((row) => row.method === "host-boot")?.refused, denied.length);

  // The audit chain holds one line per accepted report, never more than the bucket allows, and verifies.
  const auditLines = readFileSync(auditPath(daemon), "utf8").trim().split("\n");
  assert.equal(auditLines.length, accepted.length);
  assert.ok(auditLines.length <= 60 + Math.floor(elapsedMs / 1000));
  assert.equal(verifyAuditFile(auditPath(daemon)).ok, true);

  // The log holds one host.boot line per accepted report, joined on the boot id, with closed-vocabulary fields only.
  const lines = hostBootLines(daemon);
  assert.equal(lines.length, accepted.length);
  const hosts: readonly string[] = BOOT_REPORT_HOSTS;
  const transports: readonly string[] = HOST_BOOT_TRANSPORTS;
  const phases: readonly string[] = HOST_BOOT_PHASES;
  for (const line of lines) {
    assert.equal(typeof line["correlationId"] === "string" && bootIds.has(line["correlationId"]), true);
    assert.equal(hosts.includes(line["hostId"] as string), true);
    assert.equal(transports.includes(line["transport"] as string), true);
    assert.equal(phases.includes(line["phase"] as string), true);
    const posture = line["capabilitiesDenied"];
    assert.ok(Array.isArray(posture));
    for (const entry of posture) {
      assert.match(String(entry), /^[a-z.]+:[A-Z_]+$/);
    }
    for (const key of Object.keys(line)) {
      assert.ok(
        ["ts", "level", "event", "correlationId", "hostId", "transport", "phase", "attempt", "durationMs", "state", "code", "capabilitiesDenied"].includes(key),
        `unexpected log key ${key}`,
      );
    }
  }
});

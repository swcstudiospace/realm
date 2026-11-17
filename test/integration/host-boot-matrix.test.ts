// TEST-HOST-06: the boot path of every stdio host id against a real daemon. Fixtures and fakes: a real daemon over fakes, no
// Podman, no real host (26-CONTEXT GAP-26-01). Each of the 18 mcp-config ids gets a fresh daemon in this process over the existing
// fakes (test/support/boot-matrix-rig.ts) and boots through realm mcp and realm acp driven by runCli on injected streams and
// signals; they dial the daemon's real control socket with the real connectDaemon and the real host-boot recorder.
//
// Why one daemon per id: the daemon's host-boot method has a token bucket (60 reports, one more per second), which 18 ids with
// several reports each would exhaust, and a daemon per id keeps the metrics and the boot audit chain exact per id.
//
// Per id, on its own daemon and in order, with every project released when its step ends:
//   R1  readiness on MCP and on ACP: the daemon reports the project active, the marker, the hostBoot metric row and the
//       host.boot daemon log line exist for this id and transport, and stdout holds frames only.
//   R2  bounded retry: one connect failure is retried on the injected timers and then served, within one plus the retry cap.
//   R3  failure isolation: a hung up of this host leaves a sibling host of another id, the sandbox and the daemon answering.
//   R4  teardown never sends down: each ok session ends with exit 0 and no marker, the sandbox stays active, and the daemon's
//       down count equals the test's own releases; the host-boot audit chain verifies with the expected attached lines.
//   R5  hygiene: the project of the first MCP session is named with a newline, a quote, an ANSI escape and a token; none of
//       those bytes reaches a log, report, metric, audit line or marker.

import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { verifyAuditFile } from "../../src/audit/chain.js";
import type { CliResult } from "../../src/cli/main.js";
import { BOOT_BOUNDS, equalJitterDelayMs } from "../../src/host/boot.js";
import { BOOT_REPORT_HOSTS, HOST_BOOT_PHASES, HOST_BOOT_TRANSPORTS } from "../../src/host/boot-report.js";
import { HOST_RUNTIMES } from "../../src/host/runtimes.js";
import { HOST_IDS, type HostId } from "../../src/host/types.js";
import type { MetricsSnapshot } from "../../src/observe/metrics.js";
import { MATRIX_BOUND_MS, startMatrixRig, type MatrixHost, type MatrixRig } from "../support/boot-matrix-rig.js";
import { FakeTimers } from "../support/fake-host-daemon.js";
import { frame, untilReplyOn } from "../support/stdio-host-harness.js";
import { boundedWait, pollUntil, testTimeout } from "../support/timing.js";

// Every mcp-config host, taken from the table and not typed.
const MCP_HOSTS: readonly HostId[] = HOST_IDS.filter((id) => HOST_RUNTIMES[id].integration === "mcp-config");

const REATTACH = BOOT_BOUNDS.reattach;
const ESCAPE = String.fromCharCode(27);
const TOKEN = `ghp_${"a1B2c3D4e5".repeat(4).slice(0, 36)}`;
const HOSTILE_NAME = `evil-name\n"quoted-name"${ESCAPE}[31mansi-name-${TOKEN}`;
const FRAGMENTS: readonly string[] = ["evil-name", TOKEN, `${ESCAPE}[31m`, "\\u001b[31m", "quoted-name", "ansi-name"];

function hasControlCharacter(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if ((code < 32 && code !== 10) || code === 127) {
      return true;
    }
  }
  return false;
}

function parsed(line: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(line);
    return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

// The daemon's host.boot log lines for one host id and transport.
function hostBootLines(rig: MatrixRig, id: string, transport: string): Record<string, unknown>[] {
  return rig.daemonLines
    .map(parsed)
    .filter((line): line is Record<string, unknown> => line !== null && line["event"] === "host.boot" && line["hostId"] === id && line["transport"] === transport);
}

// The count of one hostBoot metric row, 0 when the row is absent.
function rowCount(snapshot: MetricsSnapshot, id: string, transport: string, phase: string): number {
  return (
    snapshot.hostBoot
      ?.filter((row) => row.hostId === id && row.transport === transport && row.phase === phase && row.code === undefined)
      .reduce((sum, row) => sum + row.count, 0) ?? 0
  );
}

// The paths of the host-boot audit chain, in order, each parsed from its line.
function auditPaths(rig: MatrixRig): string[] {
  return readFileSync(rig.auditPath, "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => {
      const entry = parsed(line);
      assert.ok(entry !== null, "an audit line is a JSON object");
      const path = entry["path"];
      assert.ok(typeof path === "string", "an audit line names its path");
      return path;
    });
}

const countOf = (paths: readonly string[], path: string): number => paths.filter((entry) => entry === path).length;

const toolFrames = (): string => frame(1, "initialize", { protocolVersion: 1 }) + frame(2, "_realm/tool", { tool: { status: {} } });

const untilSettled = (host: MatrixHost, what: string): Promise<CliResult> => boundedWait(host.result, what, 10_000);

async function runMatrixFor(index: number, id: HostId): Promise<void> {
  const tag = (step: string): string => `${id} ${step}`;
  const siblingId: HostId = id === "claude" ? "codex" : "claude";
  const rig = await startMatrixRig(index, id);
  const hosts: MatrixHost[] = [];
  const ended: CliResult[] = [];
  const track = (host: MatrixHost): MatrixHost => {
    hosts.push(host);
    return host;
  };
  const finish = async (host: MatrixHost, step: string): Promise<void> => {
    const result = await rig.end(host);
    ended.push(result);
    assert.equal(result.exitCode, 0, tag(`${step}: the host ends with exit 0`));
    assert.equal(result.stdout, "", tag(`${step}: stdout of the result is empty`));
  };
  // After each ok session ends: the marker is gone, the sandbox outlives it and no boot path sent down.
  const settled = async (marker: string, project: string, step: string): Promise<void> => {
    assert.equal(existsSync(rig.markerPath(marker)), false, tag(`${step}: the marker is removed`));
    assert.equal(await rig.sandboxState(project), "active", tag(`${step}: the project's sandbox outlives its host`));
    assert.equal(await rig.downCount(), rig.releases(), tag(`${step}: no boot path issued down, only the test's own releases are counted`));
  };
  let markerText: string | undefined;
  try {
    // The standing sibling: another id on its own project, kept until the end.
    const siblingProject = rig.project("sibling");
    const sibling = track(rig.mcpHost(siblingId, siblingProject));
    assert.equal(await rig.serveStatus(sibling, 1), "active", tag("the sibling boots"));
    let siblingCall = 2;

    // R1 readiness, MCP, on the project with the hostile name (R5).
    const hostile = rig.project(HOSTILE_NAME);
    const mcp = track(rig.mcpHost(id, hostile, { logLevel: "debug" }));
    assert.equal(await boundedWait(rig.serveStatus(mcp, 1), tag("the MCP status call"), MATRIX_BOUND_MS), "active", tag("R1 mcp: the project is active"));
    assert.equal(await rig.sandboxState(hostile), "active", tag("R1 mcp: the daemon reports the project active"));
    assert.equal(existsSync(rig.markerPath(id)), true, tag("R1 mcp: the marker exists while serving"));
    markerText = readFileSync(rig.markerPath(id), "utf8");
    await pollUntil(async () => rowCount(await rig.metrics(), id, "mcp", "attached") >= 1, tag("R1 mcp: the hostBoot row for attached"));
    await pollUntil(() => hostBootLines(rig, id, "mcp").some((line) => line["phase"] === "attached"), tag("R1 mcp: the host.boot daemon log line"));
    await finish(mcp, "R1 mcp");
    await settled(id, hostile, "R1 mcp");
    await rig.release(hostile);

    // R1 readiness, ACP.
    const acpProject = rig.project("acp");
    const acp = track(rig.acpHost(id, acpProject));
    acp.input.write(toolFrames());
    const acpReply = await boundedWait(untilReplyOn(acp.output, 2), tag("the ACP status call"), MATRIX_BOUND_MS);
    assert.equal(typeof acpReply["result"], "object", tag("R1 acp: the status call is answered"));
    assert.equal(await rig.sandboxState(acpProject), "active", tag("R1 acp: the daemon reports the project active"));
    assert.equal(existsSync(rig.markerPath(id)), true, tag("R1 acp: the marker exists while serving"));
    await pollUntil(async () => rowCount(await rig.metrics(), id, "acp", "attached") >= 1, tag("R1 acp: the hostBoot row for attached"));
    await pollUntil(() => hostBootLines(rig, id, "acp").some((line) => line["phase"] === "attached"), tag("R1 acp: the host.boot daemon log line"));
    await finish(acp, "R1 acp");
    await settled(id, acpProject, "R1 acp");
    await rig.release(acpProject);

    // R2 bounded retry: one connect failure, retried on the injected timers and then served.
    const retryProject = rig.project("retry");
    const timers = new FakeTimers();
    const flaky = rig.flakyConnect(1);
    const retried = track(rig.mcpHost(id, retryProject, { connect: flaky.connect, bootTimers: timers, reattach: true }));
    const refusedCall = await rig.statusOutcome(retried, 1);
    assert.equal(refusedCall["outcome"], "refused", tag("R2: the first call is refused while unlinked"));
    assert.equal(refusedCall["code"], "DAEMON_START_TIMEOUT", tag("R2: the refusal is DAEMON_START_TIMEOUT"));
    assert.equal(timers.pendingTimeouts(), 1, tag("R2: one re-attach wait is armed"));
    const due = timers.nextTimeoutDueIn();
    assert.ok(due !== null, tag("R2: the wait has a due time"));
    assert.equal(due, equalJitterDelayMs(1, REATTACH.baseDelayMs, REATTACH.capDelayMs, timers.random), tag("R2: the first wait is the equal-jitter delay of attempt one"));
    assert.equal(flaky.attempts(), 1, tag("R2: one attach attempt failed"));
    await timers.advance(due);
    let retryCall = 2;
    await pollUntil(
      async () => {
        const outcome = await rig.statusOutcome(retried, retryCall);
        retryCall += 1;
        return outcome["outcome"] !== "refused";
      },
      tag("R2: a call is forwarded after the re-attach"),
    );
    assert.equal(await rig.serveStatus(retried, retryCall), "active", tag("R2: the retried session serves"));
    assert.equal(flaky.attempts(), 2, tag("R2: the failed attempt and its retry make two attempts"));
    assert.ok(flaky.attempts() <= 1 + REATTACH.retryCap, tag("R2: attempts stay within one plus the retry cap"));
    assert.equal(timers.pendingTimeouts(), 0, tag("R2: no wait remains once linked"));
    await finish(retried, "R2");
    assert.equal(timers.pendingCount(), 0, tag("R2: no timer remains after the session ends"));
    await settled(id, retryProject, "R2");
    await rig.release(retryProject);

    // R3 failure isolation: a hung up of this host leaves the sibling, the sandbox and the daemon answering.
    const hungProject = rig.project("hung");
    const hung = track(rig.mcpHost(id, hungProject, { connect: rig.hangingUp() }));
    assert.equal(await rig.serveStatus(sibling, siblingCall), "active", tag("R3: the sibling answers while the host is pending"));
    siblingCall += 1;
    assert.equal(hung.output.text(), "", tag("R3: the pending host has written no frame"));
    const started = performance.now();
    assert.equal(await rig.sandboxState(siblingProject), "active", tag("R3: the daemon answers a status request"));
    assert.ok(performance.now() - started < MATRIX_BOUND_MS, tag("R3: the daemon answers within its bound"));
    await rig.metrics();
    hung.signals.raise("SIGTERM");
    const endedHung = await untilSettled(hung, tag("R3: the hung host ending on SIGTERM"));
    ended.push(endedHung);
    assert.equal(endedHung.exitCode, 143, tag("R3: SIGTERM ends the hung host with exit 143"));
    assert.equal(endedHung.stdout, "", tag("R3: stdout of the hung host is empty"));
    assert.deepEqual(hung.signals.exits, [143], tag("R3: the exit goes through the signal seam"));
    assert.equal(existsSync(rig.markerPath(id)), false, tag("R3: the hung host left no marker"));
    assert.equal(await rig.serveStatus(sibling, siblingCall), "active", tag("R3: the sibling still serves after the hung host ended"));
    siblingCall += 1;

    // R4 the sibling ends last: the sandbox stays active and no boot path sent down.
    await finish(sibling, "R4 sibling");
    await settled(siblingId, siblingProject, "R4 sibling");
    await rig.release(siblingProject);
    assert.equal(await rig.downCount(), rig.releases(), tag("R4: the daemon's down count equals the test's own releases"));

    // R4 the metrics and the boot audit chain.
    const snapshot = await rig.metrics();
    for (const transport of ["mcp", "acp"]) {
      assert.ok(rowCount(snapshot, id, transport, "attached") >= 1, tag(`R4: the metrics hold attached for ${transport}`));
      assert.ok(rowCount(snapshot, id, transport, "closed") >= 1, tag(`R4: the metrics hold closed for ${transport}`));
    }
    assert.equal(rowCount(snapshot, id, "mcp", "attached"), 2, tag("R4: two ok MCP sessions attached"));
    assert.equal(rowCount(snapshot, id, "acp", "attached"), 1, tag("R4: one ACP session attached"));
    assert.equal(existsSync(rig.auditPath), true, tag("R4: the boot audit chain was written"));
    assert.equal(verifyAuditFile(rig.auditPath).ok, true, tag("R4: the boot audit chain verifies"));
    const paths = auditPaths(rig);
    assert.equal(countOf(paths, `${id}/mcp/attached`), 2, tag("R4: one attached line per ok MCP session"));
    assert.equal(countOf(paths, `${id}/acp/attached`), 1, tag("R4: one attached line for the ACP session"));
    assert.equal(countOf(paths, `${siblingId}/mcp/attached`), 1, tag("R4: the sibling's own attached line"));
    for (const path of paths) {
      const [host, transport, phase, ...extra] = path.split("/");
      assert.deepEqual(extra, [], tag(`R4: ${path} is a triple`));
      assert.ok(BOOT_REPORT_HOSTS.some((entry) => entry === host), tag(`R4: ${path} names a closed host id`));
      assert.ok(HOST_BOOT_TRANSPORTS.some((entry) => entry === transport), tag(`R4: ${path} names a closed transport`));
      assert.ok(HOST_BOOT_PHASES.some((entry) => entry === phase), tag(`R4: ${path} names a closed phase`));
    }

    // R5 hygiene: no byte of the hostile project name or the planted token reaches any sink.
    rig.assertFramesOnly();
    const daemonLog = rig.daemonLines.join("\n");
    const sinks: Readonly<Record<string, string>> = {
      "daemon log": daemonLog,
      metrics: JSON.stringify(snapshot),
      "boot audit": readFileSync(rig.auditPath, "utf8"),
      marker: markerText,
      diagnostics: hosts.map((host) => host.diagnostics.text()).join("\n"),
      stderr: ended.map((result) => result.stderr).join("\n"),
    };
    for (const [sink, text] of Object.entries(sinks)) {
      for (const fragment of FRAGMENTS) {
        assert.equal(text.includes(fragment), false, tag(`R5: ${sink} holds the fragment ${JSON.stringify(fragment)}`));
      }
    }
    for (const host of hosts) {
      assert.equal(hasControlCharacter(host.diagnostics.text()), false, tag("R5: the diagnostics of a runner hold no control character"));
    }
    assert.equal(hasControlCharacter(daemonLog), false, tag("R5: the daemon log holds no control character"));
    assert.ok(mcp.diagnostics.text().includes("host.boot.attached"), tag("R5: the debug log was on, so the absence above is meaningful"));
  } finally {
    await rig.stop();
  }
}

MCP_HOSTS.forEach((id, index) => {
  void test(`TEST-HOST-06 ${id}: readiness, bounded retry, failure isolation and teardown on a real daemon, mcp and acp`, testTimeout(90_000), async () => {
    await runMatrixFor(index, id);
  });
});

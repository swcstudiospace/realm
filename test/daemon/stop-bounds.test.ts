// The daemon's report of a stop (Phase 41): the daemon.stopped row, the code a failed stop carries, two sessions, and a stop in
// the middle of an up. A real daemon on a real socket over the fake execution service, with a small injected teardown bound so
// no test waits on the production one.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { once } from "node:events";
import { connect } from "node:net";
import { RealmError } from "../../src/core/errors.js";
import { encodeRequest } from "../../src/daemon/channel.js";
import { startRig, type Rig } from "../support/capability-harness.js";
import { boundedWait, pollUntil, scaledMs, testTimeout } from "../support/timing.js";

const BOUND_MS = scaledMs(150);

// The one daemon.stopped row of a stopped daemon.
function stoppedRow(rig: Rig): Record<string, unknown> {
  const rows = rig.logLines().filter((line) => line.event === "daemon.stopped");
  assert.equal(rows.length, 1, "exactly one daemon.stopped row");
  const [row] = rows;
  assert.ok(row !== undefined);
  return row;
}

// Starts an up on a raw socket and returns once the daemon is inside it (the create is logged), then destroys the socket as a
// host process that exits does.
async function startUpAndLeave(rig: Rig): Promise<void> {
  const socket = connect(rig.socketPath);
  await once(socket, "connect");
  socket.on("error", () => undefined);
  socket.write(encodeRequest({ id: 1, method: "up", params: { workspaceRoot: rig.workspace } }));
  await pollUntil(() => rig.exec.callCount("create") === 1, "the daemon is inside up (the create is logged)");
  socket.destroy();
  await once(socket, "close");
}

function rejectsWith(code: string): (error: unknown) => boolean {
  return (error: unknown) => error instanceof RealmError && error.code === code;
}

void test("D1: a stop inside the bound writes one daemon.stopped row with failedTeardowns 0 and no code", testTimeout(30_000), async (t) => {
  const rig = await startRig(t, { teardownTimeoutMs: BOUND_MS });
  await rig.up();
  rig.exec.setDelay("stop", Math.floor(BOUND_MS / 5));
  await rig.daemon.stop();
  const row = stoppedRow(rig);
  assert.deepEqual(Object.keys(row).sort(), ["event", "failedTeardowns", "level", "ts"]);
  assert.equal(row.failedTeardowns, 0);
  await rig.exec.settled();
});

void test("D2: a stop past the bound rejects with REALM_STOPPING, and the row carries it with failedTeardowns 1", testTimeout(30_000), async (t) => {
  const rig = await startRig(t, { teardownTimeoutMs: BOUND_MS });
  await rig.up();
  rig.exec.setDelay("stop", BOUND_MS * 3);
  await assert.rejects(rig.daemon.stop(), rejectsWith("REALM_STOPPING"));
  const row = stoppedRow(rig);
  assert.equal(row.code, "REALM_STOPPING");
  assert.equal(row.failedTeardowns, 1);
  await boundedWait(rig.daemon.done, "daemon done");
  assert.equal(existsSync(rig.socketPath), false, "the socket file is removed");
  await rig.exec.settled();
});

void test("D3: a stop that fails with a stage code reports that code, with failedTeardowns 1", testTimeout(30_000), async (t) => {
  const rig = await startRig(t, { teardownTimeoutMs: BOUND_MS });
  await rig.up();
  rig.exec.failNext("stop", "AGENTOS_STOP_FAILED");
  await assert.rejects(rig.daemon.stop(), rejectsWith("AGENTOS_STOP_FAILED"));
  const row = stoppedRow(rig);
  assert.equal(row.code, "AGENTOS_STOP_FAILED");
  assert.equal(row.failedTeardowns, 1);
  await rig.exec.settled();
});

void test("D4: a failed first stop does not keep the second session from stopping, and the row counts one with the first code", testTimeout(30_000), async (t) => {
  const rig = await startRig(t, { teardownTimeoutMs: BOUND_MS });
  await rig.up(rig.workspace);
  await rig.up(rig.otherWorkspace);
  rig.exec.failNext("stop", "AGENTOS_STOP_FAILED");
  await assert.rejects(rig.daemon.stop(), rejectsWith("AGENTOS_STOP_FAILED"));
  assert.equal(rig.exec.callCount("stop"), 2, "both sessions were asked to stop");
  const started = rig.exec.resources().filter((resource) => resource.started);
  assert.equal(started.length, 1, "the first stop failed and left its container started; the second stopped");
  const row = stoppedRow(rig);
  assert.equal(row.code, "AGENTOS_STOP_FAILED");
  assert.equal(row.failedTeardowns, 1);
  await rig.exec.settled();
});

void test("M1: a stop in the middle of an up, with the create released inside the bound, ends with no container and failedTeardowns 0", testTimeout(30_000), async (t) => {
  const rig = await startRig(t, { teardownTimeoutMs: scaledMs(2000) });
  const release = rig.exec.holdNext("create");
  await startUpAndLeave(rig);
  const stopped = rig.daemon.stop();
  release();
  await stopped;
  await rig.exec.settled();
  assert.equal(rig.daemon.session(rig.selection().sessionId)?.handle.controller.snapshot().state ?? "unbound", "unbound");
  assert.deepEqual(rig.exec.resources(), [], "no container is left");
  const row = stoppedRow(rig);
  assert.equal(row.failedTeardowns, 0);
});

void test("M2: a stop in the middle of an up, with the create released after the bound, is REALM_STOPPING and leaks no container", testTimeout(30_000), async (t) => {
  const rig = await startRig(t, { teardownTimeoutMs: BOUND_MS });
  const release = rig.exec.holdNext("create");
  await startUpAndLeave(rig);
  await assert.rejects(rig.daemon.stop(), rejectsWith("REALM_STOPPING"));
  const row = stoppedRow(rig);
  assert.equal(row.failedTeardowns, 1);
  release();
  await rig.exec.settled();
  assert.deepEqual(rig.exec.resources(), [], "the late container is destroyed once the create returns");
});

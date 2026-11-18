// A host that leaves in the middle of up does not stop the daemon's up (Phase 33, D-33-07, E-33-07): the request the client
// started keeps running, the session reaches active, and a create that fails settles the way it does with a client present.
// A real daemon on a real socket, a raw socket that is destroyed in the middle of up, the fake execution service with a held create.

import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { connect } from "node:net";
import { encodeRequest } from "../../src/daemon/channel.js";
import { connectDaemon, type DaemonClient } from "../../src/daemon/client.js";
import type { State } from "../../src/core/states.js";
import { startRig, type Rig } from "../support/capability-harness.js";
import { pollUntil, testTimeout } from "../support/timing.js";

async function stateOf(rig: Rig): Promise<State> {
  const probe: DaemonClient = connectDaemon(rig.socketPath, rig.selection());
  try {
    return (await probe.status()).snapshot.state;
  } finally {
    probe.close();
  }
}

// Starts an up on a raw socket, as the client's own request would, and returns once the daemon is inside it (the create is
// logged). Then the socket is destroyed, as a host process that exits does: no reply is ever read.
async function startUpAndLeave(rig: Rig): Promise<void> {
  const socket = connect(rig.socketPath);
  await once(socket, "connect");
  socket.on("error", () => undefined);
  socket.write(encodeRequest({ id: 1, method: "up", params: { workspaceRoot: rig.workspace } }));
  await pollUntil(() => rig.exec.callCount("create") === 1, "the daemon is inside up (the create is logged)");
  socket.destroy();
  await once(socket, "close");
}

void test("the daemon completes an up whose client disconnected: the session reaches active", testTimeout(30_000), async (t) => {
  const rig = await startRig(t);
  const release = rig.exec.holdNext("create");
  await startUpAndLeave(rig);

  const during = await stateOf(rig);
  assert.notEqual(during, "active", "the create is held, so the session is not active yet");
  assert.equal(rig.exec.callCount("create"), 1);

  release();
  await pollUntil(async () => (await stateOf(rig)) === "active", "the session reaching active with no client");
  assert.equal(rig.exec.callCount("create"), 1, "the create ran exactly once");
  assert.equal(rig.exec.resources().length, 1, "one container exists");
});

void test("a create that fails after the client left settles as a failed create, with no second create and the daemon still serving", testTimeout(30_000), async (t) => {
  const rig = await startRig(t);
  const release = rig.exec.holdNext("create");
  rig.exec.failNext("create", "PODMAN_MISSING");
  await startUpAndLeave(rig);

  release();
  await pollUntil(async () => (await stateOf(rig)) !== "connecting", "the failed create settling");
  const settled = await stateOf(rig);
  assert.ok(settled === "error" || settled === "unbound", `the session settled as ${settled}, not active`);
  assert.equal(rig.exec.callCount("create"), 1, "no second create");
  assert.deepEqual(rig.exec.resources(), [], "no live container is recorded");
  assert.equal(await stateOf(rig), settled, "the daemon is still serving and the state is stable");
});

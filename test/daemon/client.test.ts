// Daemon control client tests (wave 3). Most tests drive connectDaemon over a live Unix socket served by a
// stub that speaks the real channel wire format (decodeRequest, encodeReply). The refusal tests at the end
// drive it over the control socket of a real startDaemon, with the existing fakes at the adapter seam.
// Each test removes its scratch directory in t.after.

import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ERROR_CATALOGUE, makeRealmError, RealmError } from "../../src/core/errors.js";
import type { StatusValue, ToolOutcome } from "../../src/tools/dispatch.js";
import { connectDaemon, type DaemonStatus } from "../../src/daemon/client.js";
import { decodeRequest, encodeReply, sendRequest, type ControlRequest } from "../../src/daemon/channel.js";
import { type StartedDaemon, startDaemon } from "../../src/daemon/daemon.js";
import type { PodmanProbeResult } from "../../src/runtime/podman-probe.js";
import { FakeBridge } from "../support/fake-bridge.js";
import { FakeExecutionService } from "../support/fake-execution.js";

const TS = "2026-10-22T00:00:00.000Z";

const STATUS_VALUE: StatusValue = {
  snapshot: { state: "active", reason: "realm active", lastTransitionAt: TS },
  display: { label: "realm active", degraded: false, reason: "realm active", lastTransitionAt: TS },
};

const DAEMON_STATUS: DaemonStatus = { ...STATUS_VALUE, mode: "advisory" };

function assertRealmError(code: string): (error: unknown) => boolean {
  return (error: unknown) => error instanceof RealmError && error.code === code;
}

function scratchDir(t: TestContext): string {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "realm-client-")));
  t.after(() => {
    rmSync(base, { recursive: true, force: true });
  });
  return base;
}

interface Stub {
  readonly socketPath: string;
  readonly requests: ControlRequest[];
}

// Serves one reply per connection. respond receives the decoded request and returns the raw
// line to write (newline included), so tests can send well-formed or malformed replies.
async function startStub(
  t: TestContext,
  respond: (request: ControlRequest) => string,
): Promise<Stub> {
  const socketPath = join(scratchDir(t), "control.sock");
  const requests: ControlRequest[] = [];
  const sockets = new Set<Socket>();
  const server: Server = createServer((socket) => {
    sockets.add(socket);
    socket.once("close", () => {
      sockets.delete(socket);
    });
    let text = "";
    socket.on("data", (chunk) => {
      text += String(chunk);
      const end = text.indexOf("\n");
      if (end === -1) {
        return;
      }
      const request = decodeRequest(text.slice(0, end));
      requests.push(request);
      socket.end(respond(request));
    });
  });
  t.after(() => {
    for (const socket of sockets) {
      socket.destroy();
    }
    server.close();
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => {
      resolve();
    });
  });
  return { socketPath, requests };
}

test("status returns the daemon snapshot and display after one round trip", async (t) => {
  const stub = await startStub(t, (request) =>
    encodeReply({ id: request.id, result: DAEMON_STATUS }),
  );
  const client = connectDaemon(stub.socketPath);
  const status = await client.status();
  assert.deepEqual(status, DAEMON_STATUS);
  assert.equal(status.mode, "advisory");
  assert.equal(stub.requests[0]?.method, "status");
  assert.equal(stub.requests[0]?.params, undefined);
});

test("status rejects a reply with no policy mode with SCHEMA_INVALID", async (t) => {
  const stub = await startStub(t, (request) =>
    encodeReply({ id: request.id, result: STATUS_VALUE }),
  );
  const client = connectDaemon(stub.socketPath);
  await assert.rejects(client.status(), assertRealmError("SCHEMA_INVALID"));
});

test("status rejects a reply with an unknown policy mode with SCHEMA_INVALID", async (t) => {
  const stub = await startStub(t, (request) =>
    encodeReply({ id: request.id, result: { ...DAEMON_STATUS, mode: "permissive" } }),
  );
  const client = connectDaemon(stub.socketPath);
  await assert.rejects(client.status(), assertRealmError("SCHEMA_INVALID"));
});

test("up sends workspaceRoot and returns the daemon status", async (t) => {
  const stub = await startStub(t, (request) =>
    encodeReply({ id: request.id, result: DAEMON_STATUS }),
  );
  const client = connectDaemon(stub.socketPath);
  const up = await client.up("/work/project");
  assert.deepEqual(up, DAEMON_STATUS);
  assert.equal(up.mode, "advisory");
  assert.equal(stub.requests[0]?.method, "up");
  assert.deepEqual(stub.requests[0]?.params, { workspaceRoot: "/work/project" });
});

test("call round-trips a raw ToolCall and returns the done outcome", async (t) => {
  const outcome: ToolOutcome = {
    outcome: "done",
    tool: "status",
    value: STATUS_VALUE,
  };
  const stub = await startStub(t, (request) => encodeReply({ id: request.id, result: outcome }));
  const client = connectDaemon(stub.socketPath);
  assert.deepEqual(await client.call({ status: {} }), outcome);
  assert.equal(stub.requests[0]?.method, "tool");
  assert.deepEqual(stub.requests[0]?.params, { tool: { status: {} } });
});

test("call returns a refusal as a resolved outcome, not a throw", async (t) => {
  const outcome: ToolOutcome = {
    outcome: "refused",
    tool: "exec",
    code: "POLICY_DENIED",
    retryable: false,
  };
  const stub = await startStub(t, (request) => encodeReply({ id: request.id, result: outcome }));
  const client = connectDaemon(stub.socketPath);
  assert.deepEqual(await client.call({ exec: { argv: ["ls"] } }), outcome);
});

test("a reply carrying an error throws a RealmError with that catalogue code", async (t) => {
  const stub = await startStub(t, (request) =>
    encodeReply({ id: request.id, error: { code: "REALM_UNBOUND" } }),
  );
  const client = connectDaemon(stub.socketPath);
  await assert.rejects(client.status(), assertRealmError("REALM_UNBOUND"));
  await assert.rejects(client.call({ status: {} }), assertRealmError("REALM_UNBOUND"));
});

test("a status reply missing display is refused with SCHEMA_INVALID", async (t) => {
  const stub = await startStub(t, (request) =>
    encodeReply({ id: request.id, result: { snapshot: STATUS_VALUE.snapshot } }),
  );
  const client = connectDaemon(stub.socketPath);
  await assert.rejects(client.status(), assertRealmError("SCHEMA_INVALID"));
  await assert.rejects(client.up("/work/project"), assertRealmError("SCHEMA_INVALID"));
});

test("a call reply that is not a ToolOutcome is refused with SCHEMA_INVALID", async (t) => {
  const stub = await startStub(t, (request) =>
    encodeReply({ id: request.id, result: { outcome: "maybe", tool: "status" } }),
  );
  const client = connectDaemon(stub.socketPath);
  await assert.rejects(client.call({ status: {} }), assertRealmError("SCHEMA_INVALID"));
});

test("a refused outcome with an unknown code is refused with SCHEMA_INVALID", async (t) => {
  const stub = await startStub(t, (request) =>
    encodeReply({
      id: request.id,
      result: { outcome: "refused", tool: "exec", code: "NOT_A_CODE", retryable: false },
    }),
  );
  const client = connectDaemon(stub.socketPath);
  await assert.rejects(client.call({ exec: {} }), assertRealmError("SCHEMA_INVALID"));
});

test("a non-JSON reply line is refused with SCHEMA_INVALID", async (t) => {
  const stub = await startStub(t, () => "not json\n");
  const client = connectDaemon(stub.socketPath);
  await assert.rejects(client.status(), assertRealmError("SCHEMA_INVALID"));
});

test("a missing socket throws REALM_NOT_ACTIVE for every method", async (t) => {
  const socketPath = join(scratchDir(t), "absent.sock");
  const client = connectDaemon(socketPath);
  await assert.rejects(client.status(), assertRealmError("REALM_NOT_ACTIVE"));
  await assert.rejects(client.up("/work/project"), assertRealmError("REALM_NOT_ACTIVE"));
  await assert.rejects(client.call({ status: {} }), assertRealmError("REALM_NOT_ACTIVE"));
});

test("close is idempotent and later requests refuse with REALM_NOT_ACTIVE without dialing", async (t) => {
  const stub = await startStub(t, (request) =>
    encodeReply({ id: request.id, result: DAEMON_STATUS }),
  );
  const client = connectDaemon(stub.socketPath);
  assert.deepEqual(await client.status(), DAEMON_STATUS);
  client.close();
  client.close();
  await assert.rejects(client.status(), assertRealmError("REALM_NOT_ACTIVE"));
  await assert.rejects(client.call({ status: {} }), assertRealmError("REALM_NOT_ACTIVE"));
  assert.equal(stub.requests.length, 1);
});

const IMAGE = `registry.example.com/realm/workload@sha256:${"0".repeat(64)}`;

// Starts a real daemon on its control socket with every host seam faked: the probe is scripted by the
// test, and no Podman, OpenShell, or Anda engine runs. One t.after brings the daemon down, then removes
// the scratch directory, so the socket is closed before the directory goes.
async function startRealDaemon(
  t: TestContext,
  probe: () => Promise<PodmanProbeResult>,
): Promise<{ readonly daemon: StartedDaemon; readonly workspace: string }> {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "realm-client-daemon-")));
  const workspace = join(base, "ws");
  mkdirSync(workspace);
  const policyPath = join(base, "policy.json");
  writeFileSync(policyPath, JSON.stringify({ workspaceRoots: [workspace] }));
  const daemon = await startDaemon({
    runtimeInput: {
      image: IMAGE,
      workloadArgv: ["/usr/bin/agent", "--serve"],
      stateDir: join(base, "state"),
      workspaceRoot: workspace,
    },
    policyPath,
    sessionId: "sess-client",
    exec: new FakeExecutionService(),
    bridge: new FakeBridge(),
    clock: () => new Date(TS),
    runOpenShell: () => Promise.resolve({ exitCode: 0, stdout: "", stderr: "", truncated: false }),
    sweep: async () => 0,
    probe,
  }).catch((error: unknown) => {
    rmSync(base, { recursive: true, force: true });
    throw error;
  });
  t.after(async () => {
    try {
      await sendRequest(daemon.socketPath, { id: "client-down", method: "down" });
      await daemon.done;
    } catch {
      // The daemon already went down, so only the scratch directory is left to remove.
    }
    rmSync(base, { recursive: true, force: true });
  });
  return { daemon, workspace };
}

test("a daemon refusal rejects with a RealmError carrying the daemon's code, message and causeCode (TOOL-05, TOOL-01, TOOL-03)", async (t) => {
  const { daemon } = await startRealDaemon(t, async () => ({ ok: true, version: "5.0.0" }));
  const raised: RealmError[] = [];
  daemon.handle.dispatcher.call = async () => {
    const refusal = makeRealmError("OPENSHELL_START_FAILED", "PODMAN_MACHINE_DOWN");
    raised.push(refusal);
    throw refusal;
  };
  const client = connectDaemon(daemon.socketPath);
  const error = await client.call({ exec: {} }).then(
    () => undefined,
    (cause: unknown) => cause,
  );
  client.close();
  assert.ok(error instanceof RealmError, "the refusal arrives as a RealmError");
  const daemonSide = raised[0];
  assert.ok(daemonSide !== undefined, "the daemon raised the refusal");
  assert.equal(error.code, daemonSide.code);
  assert.equal(error.causeCode, "PODMAN_MACHINE_DOWN");
  assert.equal(error.message, daemonSide.message);
  assert.equal(error.message, ERROR_CATALOGUE.OPENSHELL_START_FAILED.reason);
  assert.equal(error.retryable, daemonSide.retryable);
});

test("a daemon refusal without a cause rejects with no causeCode property (TOOL-05)", async (t) => {
  const { daemon } = await startRealDaemon(t, async () => ({ ok: true, version: "5.0.0" }));
  daemon.handle.dispatcher.call = () => Promise.reject(makeRealmError("TOOL_TIMEOUT"));
  const client = connectDaemon(daemon.socketPath);
  const error = await client.call({ status: {} }).then(
    () => undefined,
    (cause: unknown) => cause,
  );
  client.close();
  assert.ok(error instanceof RealmError, "the refusal arrives as a RealmError");
  assert.equal(error.code, "TOOL_TIMEOUT");
  assert.equal(Object.hasOwn(error, "causeCode"), false);
});

test("a refused tool outcome rejects with its catalogue code, as the daemon answers it (P6-D12, TOOL-01)", async (t) => {
  const { daemon } = await startRealDaemon(t, async () => ({ ok: true, version: "5.0.0" }));
  daemon.handle.dispatcher.call = async () => ({
    outcome: "refused",
    tool: "read",
    code: "POLICY_DENIED",
    retryable: false,
  });
  const client = connectDaemon(daemon.socketPath);
  const error = await client.call({ read: { path: "doc.txt", maxBytes: 16 } }).then(
    () => undefined,
    (cause: unknown) => cause,
  );
  client.close();
  assert.ok(error instanceof RealmError, "the refusal arrives as a RealmError");
  assert.equal(error.code, "POLICY_DENIED");
  assert.equal(error.message, ERROR_CATALOGUE.POLICY_DENIED.reason);
  assert.equal(Object.hasOwn(error, "causeCode"), false);
});

test("up refused by the podman probe rejects with the probe code over the real socket (CLI-01, TOOL-05)", async (t) => {
  const { daemon, workspace } = await startRealDaemon(t, async () => ({
    ok: false,
    code: "PODMAN_MISSING",
    reason: "podman is missing",
  }));
  const client = connectDaemon(daemon.socketPath);
  const error = await client.up(workspace).then(
    () => undefined,
    (cause: unknown) => cause,
  );
  client.close();
  assert.ok(error instanceof RealmError, "the refusal arrives as a RealmError");
  assert.equal(error.code, "PODMAN_MISSING");
  assert.equal(error.message, ERROR_CATALOGUE.PODMAN_MISSING.reason);
});

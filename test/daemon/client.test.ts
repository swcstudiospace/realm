// Daemon control client tests (wave 3). Every test drives connectDaemon over a live Unix socket
// served by a stub that speaks the real channel wire format (decodeRequest, encodeReply). Each
// test removes its scratch directory in t.after.

import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RealmError } from "../../src/core/errors.js";
import type { StatusValue, ToolOutcome } from "../../src/tools/dispatch.js";
import { connectDaemon, type DaemonStatus } from "../../src/daemon/client.js";
import { decodeRequest, encodeReply, type ControlRequest } from "../../src/daemon/channel.js";

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

// Daemon control client tests (wave 3). Every test drives connectDaemon over a live Unix socket served by a
// stub that speaks the real channel wire format (decodeRequest, encodeReply). The stub records each request line
// it receives, so the selection a client sends is checked on the wire. Each test removes its scratch directory in t.after.

import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { inspect } from "node:util";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RealmError } from "../../src/core/errors.js";
import type { StatusValue, ToolOutcome } from "../../src/tools/dispatch.js";
import { connectDaemon, selectionOf, type DaemonStatus } from "../../src/daemon/client.js";
import { decodeRequest, encodeReply, type ControlRequest, type ControlSelection } from "../../src/daemon/channel.js";
import { sessionIdOfWorkspace } from "../../src/session/paths.js";

const TS = "2026-10-22T00:00:00.000Z";
const FIXED_SESSION = "p0123456789ab";

const STATUS_VALUE: StatusValue = {
  snapshot: { state: "active", reason: "realm active", lastTransitionAt: TS },
  display: { label: "realm active", reason: "realm active", lastTransitionAt: TS },
};

function statusOf(sessionId: string): DaemonStatus {
  return { ...STATUS_VALUE, mode: "advisory", sessionId };
}

const DAEMON_STATUS: DaemonStatus = statusOf(FIXED_SESSION);

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

// The selection of a fresh project directory. selectionOf canonicalizes the path, so the directory is created first.
function projectSelection(t: TestContext, name = "project"): ControlSelection {
  const root = join(scratchDir(t), name);
  mkdirSync(root);
  return selectionOf(root);
}

// The selection a request line carries, read back from what the stub received.
function selectionOfRequest(request: ControlRequest): ControlSelection {
  const params = request.params as { readonly selection: ControlSelection };
  return params.selection;
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

// A stub that answers each method as the daemon would for the selection on the request: status and up with
// the selection's own session id, tool with a done status outcome whose snapshot reason carries that session id (so a
// call reply shows which project it came from), and metrics with a catalogue error (no metrics snapshot is needed).
function echoSelection(request: ControlRequest): string {
  const { sessionId } = selectionOfRequest(request);
  switch (request.method) {
    case "status":
    case "up":
      return encodeReply({ id: request.id, result: statusOf(sessionId) });
    case "tool": {
      const value: StatusValue = {
        snapshot: { state: "active", reason: sessionId, lastTransitionAt: TS },
        display: { label: "realm active", reason: sessionId, lastTransitionAt: TS },
      };
      const outcome: ToolOutcome = { outcome: "done", tool: "status", value };
      return encodeReply({ id: request.id, result: outcome });
    }
    default:
      return encodeReply({ id: request.id, error: { code: "REALM_NOT_ACTIVE" } });
  }
}

void test("status returns the daemon snapshot and display after one round trip, sending its selection", async (t) => {
  const stub = await startStub(t, (request) =>
    encodeReply({ id: request.id, result: DAEMON_STATUS }),
  );
  const selection = projectSelection(t);
  const client = connectDaemon(stub.socketPath, selection);
  const status = await client.status();
  assert.deepEqual(status, DAEMON_STATUS);
  assert.equal(status.mode, "advisory");
  assert.equal(stub.requests[0]?.method, "status");
  assert.deepEqual(stub.requests[0].params, { selection });
});

void test("status rejects a reply with no policy mode with SCHEMA_INVALID", async (t) => {
  const stub = await startStub(t, (request) =>
    encodeReply({ id: request.id, result: { ...STATUS_VALUE, sessionId: FIXED_SESSION } }),
  );
  const client = connectDaemon(stub.socketPath, projectSelection(t));
  await assert.rejects(client.status(), assertRealmError("SCHEMA_INVALID"));
});

void test("status rejects a reply with an unknown policy mode with SCHEMA_INVALID", async (t) => {
  const stub = await startStub(t, (request) =>
    encodeReply({ id: request.id, result: { ...DAEMON_STATUS, mode: "permissive" } }),
  );
  const client = connectDaemon(stub.socketPath, projectSelection(t));
  await assert.rejects(client.status(), assertRealmError("SCHEMA_INVALID"));
});

void test("status rejects a reply with no sessionId or a malformed one with SCHEMA_INVALID", async (t) => {
  const missing = await startStub(t, (request) =>
    encodeReply({ id: request.id, result: { ...STATUS_VALUE, mode: "advisory" } }),
  );
  await assert.rejects(
    connectDaemon(missing.socketPath, projectSelection(t)).status(),
    assertRealmError("SCHEMA_INVALID"),
  );
  const malformed = await startStub(t, (request) =>
    encodeReply({ id: request.id, result: { ...DAEMON_STATUS, sessionId: "p/../x" } }),
  );
  await assert.rejects(
    connectDaemon(malformed.socketPath, projectSelection(t)).status(),
    assertRealmError("SCHEMA_INVALID"),
  );
});

void test("up whose reply names another session is refused by the client with SCHEMA_INVALID", async (t) => {
  const selection = projectSelection(t);
  const other = `${selection.sessionId}-other`;
  const stub = await startStub(t, (request) => encodeReply({ id: request.id, result: statusOf(other) }));
  const client = connectDaemon(stub.socketPath, selection);
  await assert.rejects(client.up(), assertRealmError("SCHEMA_INVALID"));
});

void test("up sends only workspaceRoot and returns the daemon status", async (t) => {
  const selection = projectSelection(t);
  const stub = await startStub(t, (request) =>
    encodeReply({ id: request.id, result: statusOf(selection.sessionId) }),
  );
  const client = connectDaemon(stub.socketPath, selection);
  const up = await client.up();
  assert.deepEqual(up, statusOf(selection.sessionId));
  assert.equal(up.mode, "advisory");
  assert.equal(stub.requests[0]?.method, "up");
  assert.deepEqual(stub.requests[0].params, { workspaceRoot: selection.workspaceRoot });
});

const NOTICE = "A previous daemon's sandbox was destroyed at startup: 1 container(s), 0 session record(s).";

void test("status and up carry an optional notice string through unchanged", async (t) => {
  const selection = projectSelection(t);
  const stub = await startStub(t, (request) =>
    encodeReply({ id: request.id, result: { ...statusOf(selection.sessionId), notice: NOTICE } }),
  );
  const client = connectDaemon(stub.socketPath, selection);
  assert.equal((await client.status()).notice, NOTICE);
  assert.equal((await client.up()).notice, NOTICE);
});

void test("status and up without a notice return no notice key", async (t) => {
  const selection = projectSelection(t);
  const stub = await startStub(t, (request) =>
    encodeReply({ id: request.id, result: statusOf(selection.sessionId) }),
  );
  const client = connectDaemon(stub.socketPath, selection);
  assert.equal("notice" in (await client.status()), false);
  assert.equal("notice" in (await client.up()), false);
});

void test("status and up reject a notice that is not a string with SCHEMA_INVALID", async (t) => {
  const selection = projectSelection(t);
  const stub = await startStub(t, (request) =>
    encodeReply({ id: request.id, result: { ...statusOf(selection.sessionId), notice: 7 } }),
  );
  const client = connectDaemon(stub.socketPath, selection);
  await assert.rejects(client.status(), assertRealmError("SCHEMA_INVALID"));
  await assert.rejects(client.up(), assertRealmError("SCHEMA_INVALID"));
});

void test("call round-trips a raw ToolCall and returns the done outcome, sending its selection beside the tool", async (t) => {
  const outcome: ToolOutcome = {
    outcome: "done",
    tool: "status",
    value: STATUS_VALUE,
  };
  const selection = projectSelection(t);
  const stub = await startStub(t, (request) => encodeReply({ id: request.id, result: outcome }));
  const client = connectDaemon(stub.socketPath, selection);
  assert.deepEqual(await client.call({ status: {} }), outcome);
  assert.equal(stub.requests[0]?.method, "tool");
  assert.deepEqual(stub.requests[0].params, { tool: { status: {} }, selection });
});

void test("call returns a refusal as a resolved outcome, not a throw", async (t) => {
  const outcome: ToolOutcome = {
    outcome: "refused",
    tool: "exec",
    code: "POLICY_DENIED",
    retryable: false,
  };
  const stub = await startStub(t, (request) => encodeReply({ id: request.id, result: outcome }));
  const client = connectDaemon(stub.socketPath, projectSelection(t));
  assert.deepEqual(await client.call({ exec: { argv: ["ls"] } }), outcome);
});

void test("call returns a refusal that carries a causeCode as a resolved outcome with that causeCode", async (t) => {
  const outcome: ToolOutcome = {
    outcome: "refused",
    tool: "retry",
    code: "OPENSHELL_START_FAILED",
    retryable: true,
    causeCode: "PODMAN_MACHINE_DOWN",
  };
  const stub = await startStub(t, (request) => encodeReply({ id: request.id, result: outcome }));
  const client = connectDaemon(stub.socketPath, projectSelection(t));
  assert.deepEqual(await client.call({ retry: {} }), outcome);
});

void test("a reply carrying an error throws a RealmError with that catalogue code", async (t) => {
  const stub = await startStub(t, (request) =>
    encodeReply({ id: request.id, error: { code: "REALM_UNBOUND" } }),
  );
  const client = connectDaemon(stub.socketPath, projectSelection(t));
  await assert.rejects(client.status(), assertRealmError("REALM_UNBOUND"));
  await assert.rejects(client.call({ status: {} }), assertRealmError("REALM_UNBOUND"));
});

void test("status accepts a reply whose display has no degraded key, and one from a 0.3 daemon that still carries degraded: false", async (t) => {
  const selection = projectSelection(t);
  const without = await startStub(t, (request) => encodeReply({ id: request.id, result: statusOf(selection.sessionId) }));
  const plain = await connectDaemon(without.socketPath, selection).status();
  assert.equal(plain.display.label, "realm active");
  assert.equal(plain.display.reason, "realm active");
  assert.equal(plain.display.lastTransitionAt, TS);
  const legacy = await startStub(t, (request) =>
    encodeReply({
      id: request.id,
      result: { ...statusOf(selection.sessionId), display: { ...STATUS_VALUE.display, degraded: false } },
    }),
  );
  const old = await connectDaemon(legacy.socketPath, selection).status();
  assert.equal(old.display.label, "realm active");
  assert.equal(old.display.reason, "realm active");
  assert.equal(old.display.lastTransitionAt, TS);
});

void test("status and up refuse a reply from a 0.3 daemon whose snapshot state is the removed degraded state", async (t) => {
  const selection = projectSelection(t);
  const stub = await startStub(t, (request) =>
    encodeReply({
      id: request.id,
      result: {
        ...statusOf(selection.sessionId),
        snapshot: { state: "degraded", reason: "bridge down", lastTransitionAt: TS },
        display: { ...STATUS_VALUE.display, degraded: true },
      },
    }),
  );
  const client = connectDaemon(stub.socketPath, selection);
  await assert.rejects(client.status(), assertRealmError("SCHEMA_INVALID"));
  await assert.rejects(client.up(), assertRealmError("SCHEMA_INVALID"));
});

void test("a status reply missing display is refused with SCHEMA_INVALID", async (t) => {
  const selection = projectSelection(t);
  const stub = await startStub(t, (request) =>
    encodeReply({ id: request.id, result: { snapshot: STATUS_VALUE.snapshot, sessionId: selection.sessionId } }),
  );
  const client = connectDaemon(stub.socketPath, selection);
  await assert.rejects(client.status(), assertRealmError("SCHEMA_INVALID"));
  await assert.rejects(client.up(), assertRealmError("SCHEMA_INVALID"));
});

void test("a call reply that is not a ToolOutcome is refused with SCHEMA_INVALID", async (t) => {
  const stub = await startStub(t, (request) =>
    encodeReply({ id: request.id, result: { outcome: "maybe", tool: "status" } }),
  );
  const client = connectDaemon(stub.socketPath, projectSelection(t));
  await assert.rejects(client.call({ status: {} }), assertRealmError("SCHEMA_INVALID"));
});

void test("a refused outcome with an unknown code is refused with SCHEMA_INVALID", async (t) => {
  const stub = await startStub(t, (request) =>
    encodeReply({
      id: request.id,
      result: { outcome: "refused", tool: "exec", code: "NOT_A_CODE", retryable: false },
    }),
  );
  const client = connectDaemon(stub.socketPath, projectSelection(t));
  await assert.rejects(client.call({ exec: {} }), assertRealmError("SCHEMA_INVALID"));
});

void test("a refused outcome with an unknown causeCode is refused with SCHEMA_INVALID", async (t) => {
  const stub = await startStub(t, (request) =>
    encodeReply({
      id: request.id,
      result: { outcome: "refused", tool: "retry", code: "OPENSHELL_START_FAILED", retryable: true, causeCode: "NOT_A_CODE" },
    }),
  );
  const client = connectDaemon(stub.socketPath, projectSelection(t));
  await assert.rejects(client.call({ retry: {} }), assertRealmError("SCHEMA_INVALID"));
});

void test("a non-JSON reply line is refused with SCHEMA_INVALID", async (t) => {
  const stub = await startStub(t, () => "not json\n");
  const client = connectDaemon(stub.socketPath, projectSelection(t));
  await assert.rejects(client.status(), assertRealmError("SCHEMA_INVALID"));
});

void test("a missing socket throws REALM_NOT_ACTIVE for every method", async (t) => {
  const socketPath = join(scratchDir(t), "absent.sock");
  const client = connectDaemon(socketPath, projectSelection(t));
  await assert.rejects(client.status(), assertRealmError("REALM_NOT_ACTIVE"));
  await assert.rejects(client.up(), assertRealmError("REALM_NOT_ACTIVE"));
  await assert.rejects(client.call({ status: {} }), assertRealmError("REALM_NOT_ACTIVE"));
});

void test("close is idempotent and later requests refuse with REALM_NOT_ACTIVE without dialing", async (t) => {
  const stub = await startStub(t, (request) =>
    encodeReply({ id: request.id, result: DAEMON_STATUS }),
  );
  const client = connectDaemon(stub.socketPath, projectSelection(t));
  assert.deepEqual(await client.status(), DAEMON_STATUS);
  client.close();
  client.close();
  await assert.rejects(client.status(), assertRealmError("REALM_NOT_ACTIVE"));
  await assert.rejects(client.call({ status: {} }), assertRealmError("REALM_NOT_ACTIVE"));
  assert.equal(stub.requests.length, 1);
});

void test("MULTI-03: two clients for two projects on one socket each send only their own selection on status, call and metrics", async (t) => {
  const stub = await startStub(t, (request) => echoSelection(request));
  const a = projectSelection(t, "project-a");
  const b = projectSelection(t, "project-b");
  const clientA = connectDaemon(stub.socketPath, a);
  const clientB = connectDaemon(stub.socketPath, b);
  t.after(() => {
    clientA.close();
    clientB.close();
  });
  assert.equal((await clientA.status()).sessionId, a.sessionId);
  assert.equal((await clientB.status()).sessionId, b.sessionId);
  await clientA.call({ status: {} });
  await clientB.call({ status: {} });
  await assert.rejects(clientA.metrics(), assertRealmError("REALM_NOT_ACTIVE"));
  await assert.rejects(clientB.metrics(), assertRealmError("REALM_NOT_ACTIVE"));
  assert.deepEqual(stub.requests.map((request) => [request.method, request.params]), [
    ["status", { selection: a }],
    ["status", { selection: b }],
    ["tool", { tool: { status: {} }, selection: a }],
    ["tool", { tool: { status: {} }, selection: b }],
    ["metrics", { selection: a }],
    ["metrics", { selection: b }],
  ]);
});

void test("MULTI-03: interleaved calls from both clients on one socket each resolve with their own reply", async (t) => {
  const stub = await startStub(t, (request) => echoSelection(request));
  const a = projectSelection(t, "project-a");
  const b = projectSelection(t, "project-b");
  const clientA = connectDaemon(stub.socketPath, a);
  const clientB = connectDaemon(stub.socketPath, b);
  const [statusA, outcomeB, outcomeA, statusB] = await Promise.all([
    clientA.status(),
    clientB.call({ status: {} }),
    clientA.call({ status: {} }),
    clientB.status(),
  ]);
  assert.equal(statusA.sessionId, a.sessionId);
  assert.equal(statusB.sessionId, b.sessionId);
  assert.equal(outcomeA.outcome === "done" && outcomeA.tool === "status" ? outcomeA.value.snapshot.reason : undefined, a.sessionId);
  assert.equal(outcomeB.outcome === "done" && outcomeB.tool === "status" ? outcomeB.value.snapshot.reason : undefined, b.sessionId);
  clientA.close();
  clientB.close();
});

void test("MULTI-03: close on one client refuses only that client's later requests; the other client is still answered", async (t) => {
  const stub = await startStub(t, (request) => echoSelection(request));
  const a = projectSelection(t, "project-a");
  const b = projectSelection(t, "project-b");
  const clientA = connectDaemon(stub.socketPath, a);
  const clientB = connectDaemon(stub.socketPath, b);
  clientA.close();
  await assert.rejects(clientA.status(), assertRealmError("REALM_NOT_ACTIVE"));
  await assert.rejects(clientA.call({ status: {} }), assertRealmError("REALM_NOT_ACTIVE"));
  assert.equal((await clientB.status()).sessionId, b.sessionId);
  clientB.close();
  assert.equal(stub.requests.length, 1);
});

void test("MULTI-03: up returning a sessionId other than the constructed one is refused with SCHEMA_INVALID", async (t) => {
  const selection = projectSelection(t, "project-a");
  const other = projectSelection(t, "project-b");
  const stub = await startStub(t, (request) =>
    encodeReply({ id: request.id, result: statusOf(other.sessionId) }),
  );
  const client = connectDaemon(stub.socketPath, selection);
  await assert.rejects(client.up(), assertRealmError("SCHEMA_INVALID"));
  client.close();
});

void test("MULTI-03: connectDaemon refuses an invalid selection with SCHEMA_INVALID, synchronously, before any socket is opened", async (t) => {
  const stub = await startStub(t, (request) => encodeReply({ id: request.id, result: DAEMON_STATUS }));
  const valid = projectSelection(t);
  const invalid: ControlSelection[] = [
    { workspaceRoot: "relative/project", sessionId: valid.sessionId },
    { workspaceRoot: valid.workspaceRoot, sessionId: "p/../etc" },
    { workspaceRoot: valid.workspaceRoot, sessionId: "" },
  ];
  for (const selection of invalid) {
    assert.throws(() => connectDaemon(stub.socketPath, selection), assertRealmError("SCHEMA_INVALID"));
  }
  assert.equal(stub.requests.length, 0);
});

void test("MULTI-03: a new client for the same selection after close is answered, so no session state lives in the client", async (t) => {
  const selection = projectSelection(t);
  const stub = await startStub(t, (request) => echoSelection(request));
  const first = connectDaemon(stub.socketPath, selection);
  assert.equal((await first.status()).sessionId, selection.sessionId);
  first.close();
  const second = connectDaemon(stub.socketPath, selection);
  assert.equal((await second.status()).sessionId, selection.sessionId);
  second.close();
});

void test("MULTI-03: selectionOf canonicalizes the path and derives its session id; a path that does not exist throws POLICY_DENIED", (t) => {
  const base = scratchDir(t);
  const root = join(base, "project");
  mkdirSync(root);
  const selection = selectionOf(root);
  assert.deepEqual(selection, { workspaceRoot: realpathSync(root), sessionId: sessionIdOfWorkspace(realpathSync(root)) });
  assert.throws(() => selectionOf(join(base, "missing")), assertRealmError("POLICY_DENIED"));
});

// A scripted capability daemon (CAPT-06): capability-attach answers the next scripted attach reply, tool answers the next
// scripted tool reply or a done status outcome. Every frame the client sends is recorded by the stub.
const TOKEN_ONE = "rcap1.AAAAAAAAAAAA.BBBBBBBBBBBB";
const TOKEN_TWO = "rcap1.CCCCCCCCCCCC.DDDDDDDDDDDD";
const DONE: ToolOutcome = { outcome: "done", tool: "status", value: STATUS_VALUE };

function scripted(attachReplies: readonly string[], toolReplies: readonly string[] = []): (request: ControlRequest) => string {
  let attaches = 0;
  let tools = 0;
  return (request) => {
    if (request.method === "capability-attach") {
      const reply = attachReplies[Math.min(attaches, attachReplies.length - 1)];
      attaches += 1;
      return reply ?? encodeReply({ id: request.id, error: { code: "SCHEMA_INVALID" } });
    }
    const toolReply = toolReplies[tools];
    tools += 1;
    return toolReply ?? encodeReply({ id: request.id, result: DONE });
  };
}

function enforceReply(token: string, expiresAt: number): string {
  return JSON.stringify({ id: 0, result: { mode: "enforce", token, expiresAt } });
}

// The stub rewrites the id of a scripted reply to the request's id (a scripted line is built before the id is known).
async function startScripted(
  t: TestContext,
  attachReplies: readonly string[],
  toolReplies: readonly string[] = [],
): Promise<Stub> {
  const respond = scripted(attachReplies, toolReplies);
  return startStub(t, (request) => {
    const line = respond(request);
    const parsed = JSON.parse(line) as { id: number; result?: unknown; error?: unknown };
    return `${JSON.stringify({ ...parsed, id: request.id })}\n`;
  });
}

function framesOf(stub: Stub, method: string): ControlRequest[] {
  return stub.requests.filter((request) => request.method === method);
}

function tokenMember(request: ControlRequest | undefined): unknown {
  const params = request?.params as { token?: unknown } | undefined;
  return params?.token;
}

const NOW_MS = 1_800_000_000_000;

void test("CAPT-06: the first call attaches once and the tool frame carries the token; a second call does not attach again", async (t) => {
  const selection = projectSelection(t);
  const stub = await startScripted(t, [enforceReply(TOKEN_ONE, NOW_MS / 1000 + 3600)]);
  const clock = { ms: NOW_MS };
  const client = connectDaemon(stub.socketPath, selection, { host: "claude", now: () => clock.ms });
  await client.call({ status: {} });
  await client.call({ status: {} });
  const attaches = framesOf(stub, "capability-attach");
  assert.equal(attaches.length, 1);
  assert.deepEqual(attaches[0]?.params, { selection, host: "claude" });
  const tools = framesOf(stub, "tool");
  assert.equal(tools.length, 2);
  assert.equal(tokenMember(tools[0]), TOKEN_ONE);
  assert.equal(tokenMember(tools[1]), TOKEN_ONE);
  assert.deepEqual(Object.keys(tools[0]?.params as object).sort(), ["selection", "token", "tool"]);
});

void test("CAPT-06: 120 seconds before the expiry the next call attaches again and sends the new token", async (t) => {
  const selection = projectSelection(t);
  const stub = await startScripted(t, [enforceReply(TOKEN_ONE, NOW_MS / 1000 + 3600), enforceReply(TOKEN_TWO, NOW_MS / 1000 + 7200)]);
  const clock = { ms: NOW_MS };
  const client = connectDaemon(stub.socketPath, selection, { host: "cursor", now: () => clock.ms });
  await client.call({ status: {} });
  clock.ms = NOW_MS + (3600 - 121) * 1000;
  await client.call({ status: {} });
  assert.equal(framesOf(stub, "capability-attach").length, 1, "121 seconds before expiry the token is still used");
  clock.ms = NOW_MS + (3600 - 120) * 1000;
  await client.call({ status: {} });
  assert.equal(framesOf(stub, "capability-attach").length, 2, "at 120 seconds before expiry it renews");
  const tools = framesOf(stub, "tool");
  assert.equal(tokenMember(tools[1]), TOKEN_ONE);
  assert.equal(tokenMember(tools[2]), TOKEN_TWO);
});

void test("CAPT-06: a mode off answer is remembered for 60 seconds, no token is sent, and then the client asks again", async (t) => {
  const selection = projectSelection(t);
  const off = JSON.stringify({ id: 0, result: { mode: "off" } });
  const stub = await startScripted(t, [off, enforceReply(TOKEN_ONE, NOW_MS / 1000 + 3600)]);
  const clock = { ms: NOW_MS };
  const client = connectDaemon(stub.socketPath, selection, { host: "claude", now: () => clock.ms });
  await client.call({ status: {} });
  clock.ms = NOW_MS + 59_999;
  await client.call({ status: {} });
  assert.equal(framesOf(stub, "capability-attach").length, 1);
  assert.deepEqual(framesOf(stub, "tool").map(tokenMember), [undefined, undefined]);
  assert.equal("token" in (framesOf(stub, "tool")[0]?.params as object), false);
  clock.ms = NOW_MS + 60_000;
  await client.call({ status: {} });
  assert.equal(framesOf(stub, "capability-attach").length, 2);
  assert.equal(tokenMember(framesOf(stub, "tool")[2]), TOKEN_ONE);
});

void test("CAPT-06: an older daemon's SCHEMA_INVALID answer to the attach is treated as mode off for 60 seconds", async (t) => {
  const selection = projectSelection(t);
  const old = JSON.stringify({ id: 0, error: { code: "SCHEMA_INVALID" } });
  const stub = await startScripted(t, [old]);
  const clock = { ms: NOW_MS };
  const client = connectDaemon(stub.socketPath, selection, { host: "claude", now: () => clock.ms });
  assert.deepEqual(await client.call({ status: {} }), DONE);
  await client.call({ status: {} });
  assert.equal(framesOf(stub, "capability-attach").length, 1);
  assert.deepEqual(framesOf(stub, "tool").map(tokenMember), [undefined, undefined]);
  clock.ms = NOW_MS + 60_000;
  await client.call({ status: {} });
  assert.equal(framesOf(stub, "capability-attach").length, 2);
});

void test("CAPT-06: a POLICY_DENIED tool reply is returned as a refusal, and the client neither re-attaches nor retries it", async (t) => {
  const selection = projectSelection(t);
  const denied = JSON.stringify({ id: 0, error: { code: "POLICY_DENIED" } });
  const stub = await startScripted(t, [enforceReply(TOKEN_ONE, NOW_MS / 1000 + 3600)], [denied]);
  const client = connectDaemon(stub.socketPath, selection, { host: "claude", now: () => NOW_MS });
  await assert.rejects(client.call({ status: {} }), assertRealmError("POLICY_DENIED"));
  assert.equal(framesOf(stub, "tool").length, 1, "no second tool frame");
  assert.equal(framesOf(stub, "capability-attach").length, 1, "no second attach");
});

void test("CAPT-06: a failed attach is thrown with its own code and no tool frame is sent", async (t) => {
  const selection = projectSelection(t);
  const failed = JSON.stringify({ id: 0, error: { code: "AUDIT_WRITE_FAILED" } });
  const stub = await startScripted(t, [failed]);
  const client = connectDaemon(stub.socketPath, selection, { host: "claude", now: () => NOW_MS });
  await assert.rejects(client.call({ status: {} }), assertRealmError("AUDIT_WRITE_FAILED"));
  assert.equal(framesOf(stub, "tool").length, 0);
  const refusedAttach = await startScripted(t, [JSON.stringify({ id: 0, error: { code: "REALM_NOT_ACTIVE" } })]);
  const other = connectDaemon(refusedAttach.socketPath, selection, { host: "claude", now: () => NOW_MS });
  await assert.rejects(other.call({ status: {} }), assertRealmError("REALM_NOT_ACTIVE"));
});

void test("CAPT-06: a client with no host sends no attach frame and no token member, and its frames are the pre-token frames", async (t) => {
  const selection = projectSelection(t);
  const stub = await startScripted(t, [enforceReply(TOKEN_ONE, NOW_MS / 1000 + 3600)]);
  const plain = connectDaemon(stub.socketPath, selection);
  await plain.call({ status: {} });
  const withEmpty = connectDaemon(stub.socketPath, selection, {});
  await withEmpty.call({ status: {} });
  assert.equal(framesOf(stub, "capability-attach").length, 0);
  for (const frame of framesOf(stub, "tool")) {
    assert.deepEqual(frame.params, { tool: { status: {} }, selection });
  }
});

void test("CAPT-06: a malformed attach reply is SCHEMA_INVALID", async (t) => {
  const selection = projectSelection(t);
  const malformed: readonly unknown[] = [
    { mode: "other" },
    { mode: "enforce" },
    { mode: "enforce", token: 7, expiresAt: 1 },
    { mode: "enforce", token: "x".repeat(513), expiresAt: 1 },
    { mode: "enforce", token: TOKEN_ONE, expiresAt: "9" },
    { mode: "enforce", token: TOKEN_ONE, expiresAt: 1.5 },
    { mode: "enforce", token: TOKEN_ONE, expiresAt: Number.MAX_SAFE_INTEGER + 2 },
    { token: TOKEN_ONE, expiresAt: 1 },
    "enforce",
    null,
    [],
  ];
  for (const result of malformed) {
    const stub = await startScripted(t, [JSON.stringify({ id: 0, result })]);
    const client = connectDaemon(stub.socketPath, selection, { host: "claude", now: () => NOW_MS });
    await assert.rejects(client.call({ status: {} }), assertRealmError("SCHEMA_INVALID"), JSON.stringify(result));
    assert.equal(framesOf(stub, "tool").length, 0);
  }
});

void test("CAPT-06: the token is no property of the client and appears in no key, JSON, inspect output or thrown error", async (t) => {
  const selection = projectSelection(t);
  const stub = await startScripted(t, [enforceReply(TOKEN_ONE, NOW_MS / 1000 + 3600)], [JSON.stringify({ id: 0, error: { code: "POLICY_DENIED" } })]);
  const client = connectDaemon(stub.socketPath, selection, { host: "claude", now: () => NOW_MS });
  let thrown: unknown;
  try {
    await client.call({ status: {} });
  } catch (error: unknown) {
    thrown = error;
  }
  assert.ok(thrown instanceof RealmError);
  const everything = [
    Object.keys(client).join(","),
    Object.getOwnPropertyNames(client).join(","),
    Object.getOwnPropertySymbols(client).map(String).join(","),
    JSON.stringify(client),
    inspect(client, { showHidden: true, depth: 6 }),
    inspect(thrown, { showHidden: true, depth: 6 }),
    JSON.stringify(thrown),
    String(thrown),
    thrown.message,
    String(thrown.stack),
  ].join("\n");
  assert.equal(everything.includes(TOKEN_ONE), false);
  assert.equal(everything.includes("AAAAAAAAAAAA"), false);
  for (const value of Object.values(client)) {
    assert.equal(typeof value, "function");
  }
});

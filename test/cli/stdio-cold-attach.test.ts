// Cold attach (Phase 33, COLD-01 to COLD-03): realm mcp answers the handshake and tools/list before ensure and up complete, refuses
// every tool call REALM_NOT_ACTIVE (retryable, no daemon request) until the driver has adopted a verified client, and forwards
// calls on the same connection afterwards. The scripted world holds `up` open (World.gateUp) and releases it later.

import { after, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { META_PROTOCOL_VERSION, MCP_MODERN_VERSION } from "../../src/mcp/protocol.js";
import { RealmError } from "../../src/core/errors.js";
import type { EnvironmentLike } from "../../src/session/paths.js";
import { FakeTimers } from "../support/fake-host-daemon.js";
import { callStatus, frame, framesOf, listTools, markerFileOf, toolOutcomeOf, untilPresence } from "../support/stdio-host-harness.js";
import {
  adopted,
  finish,
  newWorld,
  reportsOf,
  startSession,
  untilAttached,
  untilReply,
  untilSettled,
  type Session,
  type StartOptions,
  type StdioRig,
  type World,
} from "../support/stdio-world.js";
import { boundedWait, pollUntil } from "../support/timing.js";

const CONFIG_HOME = mkdtempSync(join(tmpdir(), "realm-cold-attach-config-"));
const STATE_DIR = join(CONFIG_HOME, "state");
mkdirSync(join(CONFIG_HOME, "realm"));
writeFileSync(
  join(CONFIG_HOME, "realm", "config.json"),
  JSON.stringify({
    image: `registry.example.com/realm/workload@sha256:${"0".repeat(64)}`,
    stateDir: STATE_DIR,
    workspaceRoot: "/srv/realm-ws",
  }),
);
const WORKSPACE = realpathSync(mkdtempSync(join(tmpdir(), "realm-cold-attach-ws-")));
const ENV: EnvironmentLike = { PATH: "/usr/bin", HOME: "/root", XDG_RUNTIME_DIR: "/run/user/0", XDG_CONFIG_HOME: CONFIG_HOME };
const RIG: StdioRig = { env: ENV, stateDir: STATE_DIR, workspace: WORKSPACE, daemonEntry: `${STATE_DIR}/daemon/daemon.js` };

after(() => {
  rmSync(CONFIG_HOME, { recursive: true, force: true });
  rmSync(WORKSPACE, { recursive: true, force: true });
});

const start = (options: StartOptions): Session => startSession(options, RIG);

// A promise the test releases later.
function held(): { readonly gate: Promise<void>; readonly release: () => void } {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { gate, release };
}

// Whether the session's process result has settled, read without awaiting it.
function settledFlag(session: Session): () => boolean {
  let done = false;
  void session.result.then(
    () => {
      done = true;
    },
    () => {
      done = true;
    },
  );
  return () => done;
}

const MODERN_META = { [META_PROTOCOL_VERSION]: MCP_MODERN_VERSION };
const initializeFrame = (id: number): string =>
  frame(id, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } });
const discoverFrame = (id: number): string => frame(id, "server/discover", { _meta: MODERN_META });
const callFrame = (id: number, name: string, args: unknown): string => frame(id, "tools/call", { name, arguments: args });

// The six tools and arguments that satisfy their schemas.
const TOOL_CALLS: readonly { readonly name: string; readonly args: unknown }[] = [
  { name: "exec", args: { argv: ["true"] } },
  { name: "read", args: { path: "a.txt" } },
  { name: "write", args: { path: "a.txt", content: "x" } },
  { name: "list", args: { path: "." } },
  { name: "status", args: {} },
  { name: "retry", args: {} },
];

function resultsOf(session: Session, ids: readonly number[]): string {
  const replies = framesOf(session.output.text()).filter((entry) => typeof entry["id"] === "number" && ids.includes(entry["id"]));
  return JSON.stringify(replies.map((reply) => reply["result"]));
}

// ---- 1 and 2. The window --------------------------------------------------------------------------------------------------------

void test("window: the handshake and tools/list are answered while up is held, with the bytes a ready session gives", async () => {
  const world = newWorld();
  const hold = held();
  world.gateUp = hold.gate;
  const cold = start({ argv: ["mcp", "--host", "claude", "--workspace", WORKSPACE], world });
  cold.input.write(discoverFrame(1));
  cold.input.write(initializeFrame(2));
  cold.input.write(listTools(3));
  await untilReply(cold, 1);
  await untilReply(cold, 2);
  await untilReply(cold, 3);
  assert.deepEqual(world.log, ["status", "up"], "up is requested and held; no readback status yet");
  assert.equal(cold.input.readableFlowing, true, "stdin is read from the start");

  const ready = start({ argv: ["mcp", "--host", "claude", "--workspace", WORKSPACE], world: newWorld() });
  ready.input.write(discoverFrame(1));
  ready.input.write(initializeFrame(2));
  ready.input.write(listTools(3));
  await untilReply(ready, 3);
  assert.equal(resultsOf(cold, [1, 2, 3]), resultsOf(ready, [1, 2, 3]), "the same result bytes as when ready");
  for (const name of ["exec", "read", "write", "list", "status", "retry"]) {
    assert.ok(cold.output.text().includes(`"name":"${name}"`), `tools/list names ${name}`);
  }

  hold.release();
  await untilAttached(cold);
  await finish(cold);
  await finish(ready);
});

void test("window: every tool call is refused REALM_NOT_ACTIVE, retryable, with no daemon request, no second up and no queue", async () => {
  const world = newWorld();
  const hold = held();
  world.gateUp = hold.gate;
  const session = start({ argv: ["mcp", "--host", "claude", "--workspace", WORKSPACE], world });
  session.input.write(listTools(1));
  await untilReply(session, 1);
  let id = 10;
  for (const call of TOOL_CALLS) {
    session.input.write(callFrame(id, call.name, call.args));
    const reply = await untilReply(session, id);
    const result = reply["result"];
    assert.ok(typeof result === "object" && result !== null && "isError" in result, `${call.name} has an isError field`);
    assert.equal(result.isError, true, `${call.name} is an error result`);
    assert.deepEqual(
      toolOutcomeOf(reply),
      { outcome: "refused", tool: call.name, code: "REALM_NOT_ACTIVE", retryable: true },
      `${call.name} is refused REALM_NOT_ACTIVE, retryable`,
    );
    id += 1;
  }
  assert.deepEqual(world.tools, [], "no tool request reached the daemon");
  assert.deepEqual(world.log, ["status", "up"], "no second up, no readback, no call");
  assert.equal(adopted(world).length, 1, "one client asked for up");
  assert.equal(session.diagnostics.text(), "", "the default log level writes nothing");
  hold.release();
  await untilAttached(session);
  assert.deepEqual(world.tools, [], "a refused call is never queued and replayed");
  await finish(session);
});

void test("window: an unlabelled session behaves the same", async () => {
  const world = newWorld();
  const hold = held();
  world.gateUp = hold.gate;
  const session = start({ argv: ["mcp", "--workspace", WORKSPACE], world });
  session.input.write(callStatus(1));
  const reply = await untilReply(session, 1);
  assert.deepEqual(toolOutcomeOf(reply), { outcome: "refused", tool: "status", code: "REALM_NOT_ACTIVE", retryable: true });
  hold.release();
  await untilAttached(session);
  session.input.write(callStatus(2));
  const forwarded = await untilReply(session, 2);
  assert.equal(toolOutcomeOf(forwarded)["tool"], "status");
  assert.deepEqual(world.tools, [{ status: {} }]);
  await finish(session);
});

// ---- 3. The transition -----------------------------------------------------------------------------------------------------------

void test("transition: after up is released the next call is forwarded on the same connection, with no restart", async () => {
  const world = newWorld();
  const hold = held();
  world.gateUp = hold.gate;
  const session = start({ argv: ["mcp", "--host", "claude", "--workspace", WORKSPACE], world });
  const done = settledFlag(session);
  session.input.write(callFrame(1, "status", {}));
  assert.equal(toolOutcomeOf(await untilReply(session, 1))["code"], "REALM_NOT_ACTIVE");
  hold.release();
  await untilAttached(session);
  session.input.write(callStatus(2));
  const reply = await untilReply(session, 2);
  assert.equal(toolOutcomeOf(reply)["outcome"], "refused", "the scripted client answers a refusal; what matters is that it was asked");
  assert.deepEqual(world.tools, [{ status: {} }], "exactly the post-ready call was forwarded");
  assert.equal(done(), false, "the process is still running: no reconnect, no restart");
  assert.equal(world.clients.filter((client) => client.upCalls > 0).length, 1, "one attach");
  assert.deepEqual(
    framesOf(session.output.text()).map((entry) => entry["id"]),
    [1, 2],
    "one output stream, protocol frames only",
  );
  const result = await finish(session);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "");
});

void test("retry in the window starts no second attach and is refused REALM_NOT_ACTIVE, retryable", async () => {
  const world = newWorld();
  const hold = held();
  world.gateUp = hold.gate;
  const session = start({ argv: ["mcp", "--host", "claude", "--workspace", WORKSPACE], world });
  session.input.write(callFrame(1, "retry", {}));
  assert.deepEqual(toolOutcomeOf(await untilReply(session, 1)), { outcome: "refused", tool: "retry", code: "REALM_NOT_ACTIVE", retryable: true });
  assert.equal(world.log.filter((entry) => entry === "up").length, 1, "still the one up");
  hold.release();
  await untilAttached(session);
  assert.equal(world.log.filter((entry) => entry === "up").length, 1, "the held attach was adopted, not restarted");
  assert.equal(adopted(world).length, 1);
  await finish(session);
});

// ---- 4. The failure table (D-33-05) ----------------------------------------------------------------------------------------------

void test("failure row: a refused up with a confirming status serves, forwards, writes the refusal once and exits 0", async () => {
  const world = newWorld();
  world.upResult = "PODMAN_MISSING";
  const session = start({ argv: ["mcp", "--workspace", WORKSPACE], world });
  await untilAttached(session);
  session.input.write(callStatus(2));
  await untilReply(session, 2);
  assert.deepEqual(world.tools, [{ status: {} }], "the call reached the daemon, which answers the refusal");
  assert.ok(session.diagnostics.text().startsWith("PODMAN_MISSING: "), session.diagnostics.text());
  assert.equal(session.diagnostics.text().split("PODMAN_MISSING: ").length, 2, "written once");
  const result = await finish(session);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
});

void test("failure row: a refused up whose readback names another session refuses locally, never forwards and exits 0", async () => {
  const world = newWorld();
  world.upResult = "PODMAN_MISSING";
  world.readbackOther = true;
  const session = start({ argv: ["mcp", "--workspace", WORKSPACE], world });
  await untilSettled(session);
  session.input.write(callStatus(2));
  assert.equal(toolOutcomeOf(await untilReply(session, 2))["outcome"], "refused");
  assert.deepEqual(world.tools, [], "refused locally");
  assert.ok(session.diagnostics.text().startsWith("PODMAN_MISSING: "));
  assert.equal((await finish(session)).exitCode, 0);
});

void test("failure row: an ensure failure with re-attach off serves, refuses with the code, recovers on one retry and exits 0", async () => {
  const world = newWorld();
  world.daemonUp = false;
  const session = start({ argv: ["mcp", "--host", "claude", "--workspace", WORKSPACE], world, timeoutMs: 50 });
  const done = settledFlag(session);
  session.input.write(listTools(1));
  await untilReply(session, 1);
  await untilSettled(session);
  assert.ok(session.diagnostics.text().startsWith("DAEMON_START_TIMEOUT: "), session.diagnostics.text());
  assert.ok(session.diagnostics.text().includes(`${STATE_DIR}/daemon.log`), "the text names the daemon log");
  session.input.write(callStatus(2));
  const refusedReply = toolOutcomeOf(await untilReply(session, 2));
  assert.equal(refusedReply["code"], "DAEMON_START_TIMEOUT");
  assert.equal(refusedReply["retryable"], false, "a settled failure keeps its flag");
  assert.deepEqual(world.tools, []);
  assert.equal(done(), false, "the process is still running");
  const text = session.diagnostics.text();

  world.daemonUp = true;
  session.input.write(callFrame(3, "retry", {}));
  await untilReply(session, 3);
  assert.equal(world.log.filter((entry) => entry === "up").length, 1, "the retry performed one attach");
  session.input.write(callStatus(4));
  await untilReply(session, 4);
  assert.ok(world.tools.length >= 1, "calls are forwarded after the retry");
  assert.equal(session.diagnostics.text(), text, "the failure text was written once");
  const result = await finish(session);
  assert.equal(result.exitCode, 0, "a retry that linked gives exit 0");
  assert.equal(result.stderr, "");
  framesOf(session.output.text());
});

void test("failure row: an ensure failure with no recovery exits 1 at stdin end with the text already written once", async () => {
  const world = newWorld();
  world.daemonUp = false;
  const session = start({ argv: ["mcp", "--workspace", WORKSPACE], world, timeoutMs: 50 });
  session.input.write(listTools(1));
  await untilReply(session, 1);
  await untilSettled(session);
  const result = await finish(session);
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
  assert.match(session.diagnostics.text(), /^DAEMON_START_TIMEOUT: /);
  assert.equal(session.diagnostics.text().split("DAEMON_START_TIMEOUT: ").length, 2, "written once");
  assert.equal(session.spawns.length, 1);
  assert.equal(world.log.includes("up"), false);
});

void test("failure row: an ensure failure with re-attach on writes nothing, refuses with the code, arms a wait and forwards after it", async () => {
  const world = newWorld();
  world.daemonUp = false;
  const session = start({ argv: ["mcp", "--host", "claude", "--reattach", "--workspace", WORKSPACE], world, timeoutMs: 30 });
  await untilSettled(session);
  session.input.write(callStatus(2));
  const refused = await untilReply(session, 2);
  assert.equal(toolOutcomeOf(refused)["code"], "DAEMON_START_TIMEOUT");
  assert.equal(toolOutcomeOf(refused)["retryable"], true);
  assert.equal(session.diagnostics.text(), "", "no diagnostics: the wait is armed");
  assert.ok(session.timers.pendingTimeouts() >= 1, "a re-attach wait is armed on the injected timers");
  world.daemonUp = true;
  await session.timers.advance(2_000);
  let id = 3;
  await pollUntil(() => {
    session.input.write(callStatus(id));
    id += 1;
    return world.tools.length >= 1;
  }, "a call is forwarded after the re-attach");
  const result = await finish(session);
  assert.equal(result.exitCode, 0);
  assert.equal(session.timers.pendingCount(), 0, "no timer remains after shutdown");
});

void test("failure row: an unexpected throw inside the driver is handled, written once, and the process still serves and exits", async () => {
  class ThrowingTimers extends FakeTimers {
    override setInterval(): never {
      throw new RealmError("SCHEMA_INVALID");
    }
  }
  const session = start({ argv: ["mcp", "--workspace", WORKSPACE], timers: new ThrowingTimers() });
  session.input.write(listTools(1));
  await untilReply(session, 1);
  await pollUntil(() => session.diagnostics.text() !== "", "the driver failure is written");
  assert.ok(session.diagnostics.text().startsWith("SCHEMA_INVALID: "), session.diagnostics.text());
  assert.equal(session.diagnostics.text().split("SCHEMA_INVALID: ").length, 2, "written once");
  const result = await finish(session);
  assert.equal(result.stdout, "");
  assert.equal(result.exitCode, 0, "the throw came after the client was adopted, so the driver outcome is not failed");
});

// ---- 5. Stdin end and signals in the window --------------------------------------------------------------------------------------

void test("window: stdin end with up held exits 0 with the client closed once, no marker, a closed report and no down", async () => {
  const world = newWorld();
  const hold = held();
  world.gateUp = hold.gate;
  const session = start({ argv: ["mcp", "--host", "claude", "--workspace", WORKSPACE], world });
  session.input.write(listTools(1));
  await untilReply(session, 1);
  session.input.end();
  const result = await boundedWait(session.result, "the session ending in the window", 10_000);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
  assert.equal(existsSync(markerFileOf(STATE_DIR, "claude")), false, "no marker: no client was adopted");
  assert.deepEqual(reportsOf(session.sent).map((report) => report.phase), ["closed"]);
  assert.ok(session.sent.every((request) => request.method === "host-boot"), "no down, no other request");
  // The attach that was still waiting on up closes its client the moment it lands: once, never adopted.
  hold.release();
  await pollUntil(() => adopted(world).every((client) => client.closeCalls === 1), "the late client is closed");
  assert.equal(adopted(world).length, 1);
  assert.deepEqual(adopted(world).map((client) => client.closeCalls), [1], "the client is closed once");
  assert.deepEqual(reportsOf(session.sent).map((report) => report.phase), ["closed"], "no attached report after the session ended");
});

void test("window: SIGTERM with up held exits 143 through the same teardown; a second signal exits at once; nothing is written after teardown", async () => {
  const world = newWorld();
  world.upResult = "PODMAN_MISSING";
  const hold = held();
  world.gateUp = hold.gate;
  const session = start({ argv: ["mcp", "--host", "claude", "--workspace", WORKSPACE], world });
  session.input.write(listTools(1));
  await untilReply(session, 1);
  session.signals.raise("SIGTERM");
  session.signals.raise("SIGINT");
  const result = await boundedWait(session.result, "the session ending on SIGTERM", 10_000);
  assert.equal(result.exitCode, 143);
  assert.equal(session.signals.exits[0], 130, "the second signal exits at once");
  assert.ok(session.signals.exits.includes(143));
  assert.deepEqual(reportsOf(session.sent).map((report) => report.phase), ["closed"]);
  hold.release();
  await pollUntil(() => adopted(world).every((client) => client.closeCalls === 1), "the late client is closed");
  assert.equal(adopted(world).length, 1);
  assert.equal(session.diagnostics.text(), "", "no text is written once teardown began");
  assert.equal(existsSync(markerFileOf(STATE_DIR, "claude")), false);
});

// ---- 6. ACP unchanged -------------------------------------------------------------------------------------------------------------

void test("ACP is unchanged: no frame and no stdin read until the boot is ready, a refused up exits 1 with no frame", async () => {
  const world = newWorld();
  const hold = held();
  world.gateUp = hold.gate;
  const session = start({ argv: ["acp", "--host", "kimi", "--workspace", WORKSPACE], world });
  session.input.write(frame(1, "initialize", { protocolVersion: 1 }));
  await pollUntil(() => world.log.includes("up"), "the up is requested");
  assert.notEqual(session.input.readableFlowing, true, "stdin is not read before the boot settles");
  assert.equal(session.output.text(), "", "no frame before the boot settles");
  hold.release();
  await untilReply(session, 1);
  assert.equal((await finish(session)).exitCode, 0);

  const refusedWorld = newWorld();
  refusedWorld.upResult = "PODMAN_MISSING";
  const refused = start({ argv: ["acp", "--workspace", WORKSPACE], world: refusedWorld });
  refused.input.end();
  const result = await boundedWait(refused.result, "the refused ACP up", 10_000);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /^PODMAN_MISSING: /);
  assert.equal(refused.output.text(), "", "no frame");
});

// ---- 7. The warm path ------------------------------------------------------------------------------------------------------------

void test("warm path: with no held up the handshake is answered, the first call after readiness is forwarded and nothing is written", async () => {
  const world: World = newWorld();
  const session = start({ argv: ["mcp", "--host", "claude", "--workspace", WORKSPACE], world });
  session.input.write(initializeFrame(1));
  session.input.write(listTools(2));
  await untilReply(session, 1);
  await untilReply(session, 2);
  await untilAttached(session);
  await untilPresence(STATE_DIR, "claude");
  session.input.write(callStatus(3));
  await untilReply(session, 3);
  assert.deepEqual(world.tools, [{ status: {} }]);
  assert.equal(session.diagnostics.text(), "", "the default level writes nothing");
  assert.equal((await finish(session)).exitCode, 0);
});

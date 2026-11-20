// TEST-HOST-05: the boot sequence of realm mcp and realm acp for every stdio host id, on scripted daemons. The flag grammar names
// exactly the 21 mcp-config ids; each id then runs readiness, the bounded retry, the failure paths and the teardown on both
// transports. Fixtures and fakes: a scripted daemon, injected streams, signals and timers (test/support/stdio-world.ts); no
// socket, no Podman, no real host (26-CONTEXT GAP-26-01). stdio-host.test.ts keeps the claude and kimi statements of the same
// facts; this file repeats them per id and adds nothing they contradict.

import { after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { StdioSignal } from "../../src/cli/stdio-host.js";
import { BOOT_BOUNDS, equalJitterDelayMs } from "../../src/host/boot.js";
import { HOST_ALIASES, HOST_RUNTIMES } from "../../src/host/runtimes.js";
import { HOST_IDS, type HostId } from "../../src/host/types.js";
import { sessionIdOfWorkspace, type EnvironmentLike } from "../../src/session/paths.js";
import { callStatus, frame, framesOf, listTools, toolOutcomeOf, untilPresence } from "../support/stdio-host-harness.js";
import {
  adopted,
  finish,
  markerOf as markerOfRig,
  markerPathOf as markerPathOfRig,
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
import { boundedWait, pollUntil, testTimeout } from "../support/timing.js";

const CONFIG_HOME = mkdtempSync(join(tmpdir(), "realm-stdio-matrix-config-"));
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
const WORKSPACE = realpathSync(mkdtempSync(join(tmpdir(), "realm-stdio-matrix-ws-")));
const DAEMON_ENTRY = `${STATE_DIR}/daemon/daemon.js`;
const ENV: EnvironmentLike = { PATH: "/usr/bin", HOME: "/root", XDG_RUNTIME_DIR: "/run/user/0", XDG_CONFIG_HOME: CONFIG_HOME };
const RIG: StdioRig = { env: ENV, stateDir: STATE_DIR, workspace: WORKSPACE, daemonEntry: DAEMON_ENTRY };

after(() => {
  rmSync(CONFIG_HOME, { recursive: true, force: true });
  rmSync(WORKSPACE, { recursive: true, force: true });
});
beforeEach(() => {
  rmSync(join(STATE_DIR, "hosts"), { recursive: true, force: true });
});

const start = (options: StartOptions): Session => startSession(options, RIG);

type Transport = "mcp" | "acp";
const TRANSPORTS: readonly Transport[] = ["mcp", "acp"];
// Every mcp-config host, taken from the table and not typed.
const MCP_HOSTS: readonly HostId[] = HOST_IDS.filter((id) => HOST_RUNTIMES[id].integration === "mcp-config");
const MARKER_KEYS: readonly string[] = ["attach", "code", "pid", "schemaVersion", "sessionId", "startedAt"];
// The re-attach cap and its first window come from the table of bounds, never from a literal.
const REATTACH = BOOT_BOUNDS.reattach;

const initializeFrame = (transport: Transport): string =>
  transport === "mcp"
    ? frame(1, "initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "1" } })
    : frame(1, "initialize", { protocolVersion: 1 });

const argvOf = (transport: Transport, host: string, extra: readonly string[] = []): readonly string[] => [
  transport,
  "--host",
  host,
  ...extra,
  "--workspace",
  WORKSPACE,
];

const tagOf = (id: string, transport: Transport): string => `${id}/${transport}`;

function hasControlCharacter(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if ((code < 32 && code !== 10) || code === 127) {
      return true;
    }
  }
  return false;
}

// Settles once the world has logged nothing for a while: an attempt that ran to its bound has ended.
async function untilQuiet(world: World, what: string): Promise<void> {
  let last = -1;
  let still = 0;
  await pollUntil(
    () => {
      still = world.log.length === last ? still + 1 : 0;
      last = world.log.length;
      return still >= 5;
    },
    what,
    { intervalMs: 20 },
  );
}

// ---- M0: the flag grammar -----------------------------------------------------------------------------------------------------

void test("TEST-HOST-05 grammar: --host takes exactly the 21 canonical mcp-config ids on mcp and acp, nothing else", testTimeout(120_000), async () => {
  assert.equal(MCP_HOSTS.length, 21);
  const accepted: Record<Transport, string[]> = { mcp: [], acp: [] };
  for (const transport of TRANSPORTS) {
    for (const id of HOST_IDS) {
      const label = tagOf(id, transport);
      const world = newWorld();
      const session = start({ argv: argvOf(transport, id), world });
      session.input.end();
      const result = await boundedWait(session.result, `${label}: the session ending`, 10_000);
      if (result.exitCode === 2) {
        assert.equal(HOST_RUNTIMES[id].integration, "extension", `${label}: only the extension host is a usage error`);
        assert.equal(result.stdout, "", label);
        assert.match(result.stderr, /^Usage: realm /, label);
        assert.deepEqual(world.clients, [], `${label}: nothing was dialled`);
        assert.deepEqual(session.spawns, [], `${label}: nothing was spawned`);
        assert.deepEqual(session.sent, [], `${label}: nothing was sent`);
      } else {
        accepted[transport].push(id);
        assert.ok(world.clients.length > 0, `${label}: the session dialled the daemon`);
        framesOf(session.output.text());
      }
    }
    assert.deepEqual(accepted[transport], [...MCP_HOSTS], `${transport}: the accepted ids are the mcp-config ids of the table`);
  }

  const aliases = Object.keys(HOST_ALIASES);
  assert.ok(aliases.includes("devin-desktop"), "the table has an alias to refuse");
  const hostile: readonly string[] = [
    ...aliases,
    "CLAUDE",
    "Claude",
    "claude ",
    " claude",
    "",
    "x".repeat(200),
    "\u001b[31mclaude\u001b[0m\nclaude",
    "claude\u0000",
  ];
  for (const transport of TRANSPORTS) {
    for (const value of hostile) {
      const label = `${transport} --host ${JSON.stringify(value.slice(0, 40))}`;
      const world = newWorld();
      const session = start({ argv: [transport, "--host", value, "--workspace", WORKSPACE], world });
      const result = await boundedWait(session.result, `${label}: usage`, 10_000);
      assert.equal(result.exitCode, 2, label);
      assert.equal(result.stdout, "", label);
      assert.match(result.stderr, /^Usage: realm /, label);
      assert.equal(hasControlCharacter(result.stderr), false, `${label}: no control character in the diagnostics`);
      assert.equal(hasControlCharacter(session.diagnostics.text()), false, label);
      assert.deepEqual(world.clients, [], `${label}: nothing was dialled`);
      assert.deepEqual(session.spawns, [], `${label}: nothing was spawned`);
      assert.deepEqual(session.sent, [], `${label}: nothing was sent`);
    }
  }
});

// ---- M1: readiness ------------------------------------------------------------------------------------------------------------

async function readiness(id: HostId, transport: Transport): Promise<void> {
  const label = tagOf(id, transport);
  const world = newWorld();
  const session = start({ argv: argvOf(transport, id), world });
  session.input.write(initializeFrame(transport));
  await untilReply(session, 1);
  // realm mcp answers before the boot settles; the marker is written once a client is adopted.
  await untilPresence(RIG.stateDir, id);
  const marker = markerOfRig(RIG, id);
  assert.deepEqual(Object.keys(marker).sort(), MARKER_KEYS, `${label}: the marker has the six keys`);
  assert.equal(marker["pid"], process.pid, label);
  assert.equal(marker["attach"], "attached", label);
  assert.equal(marker["code"], null, label);
  assert.equal(marker["sessionId"], sessionIdOfWorkspace(WORKSPACE), label);
  framesOf(session.output.text());
  const result = await finish(session);
  assert.equal(result.exitCode, 0, label);
  assert.equal(result.stdout, "", label);
  const reports = reportsOf(session.sent);
  assert.deepEqual(reports.map((report) => report.phase), ["attached", "closed"], label);
  assert.equal(new Set(reports.map((report) => report.bootId)).size, 1, `${label}: one boot id`);
  assert.deepEqual(reports.map((report) => [report.hostId, report.transport]), [[id, transport], [id, transport]], label);
  assert.equal(existsSync(markerPathOfRig(RIG, id)), false, `${label}: the marker is removed at EOF`);
}

// ---- M2: the bounded retry ----------------------------------------------------------------------------------------------------

// The window an attempt's wait lies in: equal jitter between half the ceiling and the ceiling.
function windowOf(attempt: number): { readonly low: number; readonly high: number } {
  const ceiling = Math.min(REATTACH.capDelayMs, REATTACH.baseDelayMs * 2 ** (attempt - 1));
  return { low: Math.floor(ceiling / 2), high: ceiling };
}

async function retryServesAfterTheDaemonComesUp(id: HostId): Promise<void> {
  const label = tagOf(id, "mcp");
  const world = newWorld();
  world.daemonUp = false;
  const session = start({ argv: argvOf("mcp", id, ["--reattach"]), world, timeoutMs: 30 });
  await untilSettled(session);
  session.input.write(callStatus(2));
  const refused = await untilReply(session, 2);
  assert.equal(toolOutcomeOf(refused)["outcome"], "refused", label);
  assert.equal(toolOutcomeOf(refused)["code"], "DAEMON_START_TIMEOUT", label);
  assert.deepEqual(world.tools, [], `${label}: an unlinked session never forwards`);
  assert.equal(session.timers.pendingTimeouts(), 1, `${label}: one re-attach wait is armed`);
  const due = session.timers.nextTimeoutDueIn();
  assert.ok(due !== null, `${label}: the wait has a due time`);
  const bounds = windowOf(1);
  assert.ok(due >= bounds.low && due <= bounds.high, `${label}: the first wait ${String(due)} ms lies in [${String(bounds.low)}, ${String(bounds.high)}]`);
  world.daemonUp = true;
  await session.timers.advance(due);
  let callId = 3;
  await pollUntil(() => {
    session.input.write(callStatus(callId));
    callId += 1;
    return world.tools.length >= 1;
  }, `${label}: a call is forwarded after the re-attach`);
  const result = await finish(session);
  assert.equal(result.exitCode, 0, label);
  assert.equal(session.timers.pendingCount(), 0, `${label}: no timer remains after shutdown`);
  assert.equal(session.signals.armed(), 0, `${label}: signal handlers are released`);
}

async function retryStopsAtTheCap(id: HostId): Promise<void> {
  const label = tagOf(id, "mcp");
  const world = newWorld();
  world.daemonUp = false;
  const session = start({ argv: argvOf("mcp", id, ["--reattach"]), world, timeoutMs: 30 });
  await untilSettled(session);
  session.input.write(callStatus(2));
  await untilReply(session, 2);
  const perAttempt = session.spawns.length;
  assert.ok(perAttempt > 0, `${label}: the first attempt spawned the daemon`);
  for (let attempt = 1; attempt <= REATTACH.retryCap; attempt += 1) {
    await pollUntil(() => session.timers.pendingTimeouts() === 1, `${label}: wait ${String(attempt)} is armed`);
    const due = session.timers.nextTimeoutDueIn();
    assert.equal(due, equalJitterDelayMs(attempt, REATTACH.baseDelayMs, REATTACH.capDelayMs, session.timers.random), `${label}: wait ${String(attempt)} delay`);
    await session.timers.advance(due);
  }
  const attempts = REATTACH.retryCap + 1;
  await pollUntil(() => session.spawns.length >= attempts * perAttempt, `${label}: the last attempt started`);
  await untilQuiet(world, `${label}: the last attempt ended`);
  assert.equal(session.spawns.length, attempts * perAttempt, `${label}: exactly ${String(attempts)} attempts, the first plus the cap of ${String(REATTACH.retryCap)}`);
  assert.equal(session.timers.pendingTimeouts(), 0, `${label}: no wait is armed after the cap`);
  await session.timers.advance(1_000_000);
  await untilQuiet(world, `${label}: nothing follows the cap`);
  assert.equal(session.spawns.length, attempts * perAttempt, `${label}: no attempt after the cap`);
  await finish(session);
  assert.equal(session.timers.pendingCount(), 0, `${label}: no timer remains after shutdown`);
  assert.equal(session.signals.armed(), 0, `${label}: signal handlers are released`);
}

async function acpDoesNotRetry(id: HostId): Promise<void> {
  const label = tagOf(id, "acp");
  const world = newWorld();
  world.daemonUp = false;
  const session = start({ argv: argvOf("acp", id, ["--reattach"]), world, timeoutMs: 30 });
  session.input.end();
  const result = await boundedWait(session.result, `${label}: the boot failure`, 10_000);
  assert.equal(result.exitCode, 1, label);
  assert.match(result.stderr, /^DAEMON_START_TIMEOUT: /, label);
  assert.equal(session.output.text(), "", `${label}: no frame`);
  assert.equal(result.stdout, "", label);
  assert.equal(session.timers.pendingCount(), 0, `${label}: the retry wait is cleared at teardown`);
}

// ---- M3: the failure paths ----------------------------------------------------------------------------------------------------

async function refusedUpServes(id: HostId): Promise<void> {
  const label = tagOf(id, "mcp");
  const world = newWorld();
  world.upResult = "PODMAN_MISSING";
  const session = start({ argv: argvOf("mcp", id), world });
  await untilAttached(session);
  session.input.write(callStatus(2));
  await untilReply(session, 2);
  assert.deepEqual(world.tools, [{ status: {} }], `${label}: the call reached the daemon fake`);
  assert.ok(session.diagnostics.text().startsWith("PODMAN_MISSING: "), `${label}: ${session.diagnostics.text()}`);
  assert.equal((await finish(session)).exitCode, 0, label);
}

async function refusedUpExitsOnAcp(id: HostId): Promise<void> {
  const label = tagOf(id, "acp");
  const world = newWorld();
  world.upResult = "PODMAN_MISSING";
  const session = start({ argv: argvOf("acp", id), world });
  session.input.end();
  const result = await boundedWait(session.result, `${label}: the refused up`, 10_000);
  assert.equal(result.exitCode, 1, label);
  assert.equal(result.stdout, "", label);
  assert.match(result.stderr, /^PODMAN_MISSING: /, label);
  assert.equal(session.output.text(), "", `${label}: no frame`);
}

async function foreignReadbackRefusesLocally(id: HostId): Promise<void> {
  const label = tagOf(id, "mcp");
  const world = newWorld();
  world.upResult = "PODMAN_MISSING";
  world.readbackOther = true;
  const session = start({ argv: argvOf("mcp", id), world });
  await untilSettled(session);
  session.input.write(callStatus(2));
  const reply = await untilReply(session, 2);
  assert.equal(toolOutcomeOf(reply)["outcome"], "refused", label);
  assert.deepEqual(world.tools, [], `${label}: the call was refused locally`);
  assert.ok(session.diagnostics.text().startsWith("PODMAN_MISSING: "), `${label}: the refusal is on stderr`);
  assert.equal((await finish(session)).exitCode, 0, label);
}

async function foreignReadbackExitsOnAcp(id: HostId): Promise<void> {
  const label = tagOf(id, "acp");
  const world = newWorld();
  world.upResult = "PODMAN_MISSING";
  world.readbackOther = true;
  const session = start({ argv: argvOf("acp", id), world });
  session.input.end();
  const result = await boundedWait(session.result, `${label}: the foreign readback`, 10_000);
  assert.equal(result.exitCode, 1, label);
  assert.equal(result.stdout, "", label);
  assert.equal(session.output.text(), "", `${label}: no frame`);
  assert.deepEqual(world.tools, [], `${label}: nothing reached the daemon`);
}

async function silentDaemonExits(id: HostId, transport: Transport): Promise<void> {
  const label = tagOf(id, transport);
  const world = newWorld();
  world.daemonUp = false;
  const session = start({ argv: argvOf(transport, id), world, timeoutMs: 50 });
  if (transport === "mcp") {
    // realm mcp serves, refuses calls with the code and exits 1 at stdin end; the text is written once when the boot settles.
    session.input.write(listTools(1));
    await untilReply(session, 1);
    await untilSettled(session);
    session.input.end();
  }
  const result = await boundedWait(session.result, `${label}: the ensure failure`, 10_000);
  assert.equal(result.exitCode, 1, label);
  assert.equal(result.stdout, "", label);
  assert.match(transport === "mcp" ? session.diagnostics.text() : result.stderr, /^DAEMON_START_TIMEOUT: /, label);
  assert.equal(framesOf(session.output.text()).length, transport === "mcp" ? 1 : 0, `${label}: no frame beyond the handshake reply`);
  assert.equal(world.log.includes("up"), false, `${label}: up was never requested`);
  assert.equal(session.spawns.length > 0, true, `${label}: the daemon was started`);
}

// ---- M4: teardown -------------------------------------------------------------------------------------------------------------

async function teardownEndsTheSameWay(id: HostId, transport: Transport): Promise<void> {
  const cases: readonly { readonly signal: StdioSignal | null; readonly exit: number | null }[] = [
    { signal: null, exit: null },
    { signal: "SIGTERM", exit: 143 },
    { signal: "SIGINT", exit: 130 },
    { signal: "SIGHUP", exit: 129 },
  ];
  for (const row of cases) {
    const label = `${tagOf(id, transport)} ${String(row.signal)}`;
    const world = newWorld();
    const session = start({ argv: argvOf(transport, id), world });
    session.input.write(transport === "mcp" ? listTools(1) : initializeFrame(transport));
    await untilReply(session, 1);
    await untilPresence(RIG.stateDir, id);
    assert.equal(existsSync(markerPathOfRig(RIG, id)), true, `${label}: the marker exists while serving`);
    if (row.signal === null) {
      session.input.end();
    } else {
      session.signals.raise(row.signal);
    }
    const result = await boundedWait(session.result, `${label}: the session ending`, 10_000);
    assert.equal(result.exitCode, row.exit ?? 0, label);
    assert.deepEqual(session.signals.exits, row.exit === null ? [] : [row.exit], label);
    assert.deepEqual(adopted(world).map((client) => client.closeCalls), [1], `${label}: the adopted client is closed once`);
    assert.equal(existsSync(markerPathOfRig(RIG, id)), false, `${label}: the marker is removed`);
    assert.deepEqual(reportsOf(session.sent).map((report) => report.phase), ["attached", "closed"], `${label}: a closed report is sent`);
    assert.equal(session.sent.some((request) => request.method === "down"), false, `${label}: no down request`);
    assert.equal(session.signals.armed(), 0, `${label}: signal handlers are released`);
    assert.equal(session.timers.pendingCount(), 0, `${label}: no timer remains`);
  }
}

// ---- One test per host id -----------------------------------------------------------------------------------------------------

for (const id of MCP_HOSTS) {
  void test(`TEST-HOST-05 ${id}: readiness, bounded retry, failure paths and teardown on mcp and acp`, testTimeout(90_000), async () => {
    for (const transport of TRANSPORTS) {
      await readiness(id, transport);
    }
    await retryServesAfterTheDaemonComesUp(id);
    await retryStopsAtTheCap(id);
    await acpDoesNotRetry(id);
    await refusedUpServes(id);
    await refusedUpExitsOnAcp(id);
    await foreignReadbackRefusesLocally(id);
    await foreignReadbackExitsOnAcp(id);
    for (const transport of TRANSPORTS) {
      await silentDaemonExits(id, transport);
      await teardownEndsTheSameWay(id, transport);
    }
  });
}

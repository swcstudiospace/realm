// The boot sequence of realm mcp and realm acp (BOOT-03, BOOT-05, BOOT-08): flags, the numbered sequence, the exit and exposure
// table, --reattach, teardown on EOF and on signals, logging levels and stdout purity. Every daemon is a script, every timer and
// signal an injected seam: nothing here opens a socket, arms a boot timer or raises a real signal. The scripted daemon and the
// session helpers live in test/support/stdio-world.ts, which test/cli/stdio-host-matrix.test.ts shares.

import { after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { StdioSignal } from "../../src/cli/stdio-host.js";
import { ERROR_CATALOGUE, RealmError } from "../../src/core/errors.js";
import type { ControlReply } from "../../src/daemon/channel.js";
import { sessionIdOfWorkspace, type EnvironmentLike } from "../../src/session/paths.js";
import { callStatus, frame, framesOf, listTools, toolOutcomeOf, untilPresence } from "../support/stdio-host-harness.js";
import {
  adopted,
  finish,
  markerOf as markerOfRig,
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

const CONFIG_HOME = mkdtempSync(join(tmpdir(), "realm-stdio-host-config-"));
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
const WORKSPACE = realpathSync(mkdtempSync(join(tmpdir(), "realm-stdio-host-ws-")));
const DAEMON_ENTRY = `${STATE_DIR}/daemon/daemon.js`;
const ENV: EnvironmentLike = { PATH: "/usr/bin", HOME: "/root", XDG_RUNTIME_DIR: "/run/user/0", XDG_CONFIG_HOME: CONFIG_HOME };
const MARKER_DIR = (host: string): string => join(STATE_DIR, "hosts", `${host}-active`);
const RIG: StdioRig = { env: ENV, stateDir: STATE_DIR, workspace: WORKSPACE, daemonEntry: DAEMON_ENTRY };

after(() => {
  rmSync(CONFIG_HOME, { recursive: true, force: true });
  rmSync(WORKSPACE, { recursive: true, force: true });
});
beforeEach(() => {
  rmSync(join(STATE_DIR, "hosts"), { recursive: true, force: true });
});

// ---- The scripted daemon and the session helpers: test/support/stdio-world.ts ------------------------------------------------

const start = (options: StartOptions): Session => startSession(options, RIG);
const markerOf = (host: string): Record<string, unknown> => markerOfRig(RIG, host);

// ---- (a) flags ---------------------------------------------------------------------------------------------------------------

void test("flag grammar: --workspace, --host and --reattach in any order, each once; every other shape is the usage error and starts nothing", async () => {
  const bad: readonly (readonly string[])[] = [
    ["mcp", "--host", "omp"],
    ["mcp", "--host", "Claude"],
    ["mcp", "--host", "devin-desktop"],
    ["mcp", "--host", "unknown"],
    ["mcp", "--host"],
    ["mcp", "--host", "claude", "--host", "codex"],
    ["mcp", "--reattach", "--reattach"],
    ["mcp", "--workspace"],
    ["mcp", "--workspace", WORKSPACE, "--workspace", WORKSPACE],
    ["mcp", "--bogus"],
    ["mcp", "claude"],
    ["acp", "--host", "omp"],
    ["acp", "--reattach", "extra"],
    ["up", "--host", "claude"],
    ["up", "--reattach"],
    ["status", "--reattach"],
    ["down", "--host", "claude"],
    ["metrics", "--host", "claude"],
    ["doctor", "--host", "claude"],
  ];
  for (const argv of bad) {
    const world = newWorld();
    const session = start({ argv, world });
    const result = await boundedWait(session.result, `usage for ${argv.join(" ")}`, 5000);
    assert.equal(result.exitCode, 2, argv.join(" "));
    assert.match(result.stderr, /^Usage: realm /, argv.join(" "));
    assert.equal(result.stderr.includes("--host <id>"), true, "the usage names the new flags");
    assert.deepEqual(world.clients, [], `${argv.join(" ")}: nothing was dialled`);
    assert.deepEqual(session.spawns, [], `${argv.join(" ")}: nothing was spawned`);
    assert.deepEqual(session.sent, [], `${argv.join(" ")}: nothing was sent`);
  }
  const good: readonly (readonly string[])[] = [
    ["mcp", "--workspace", WORKSPACE, "--host", "claude", "--reattach"],
    ["mcp", "--reattach", "--host", "codex", "--workspace", WORKSPACE],
    ["acp", "--host", "kimi"],
    ["mcp", "--host", "windsurf", "--workspace", WORKSPACE],
  ];
  // The good half only asserts that the arguments are accepted (not the usage error): what a session does with its boot is
  // pinned by the suites below, and a session whose stdin ends at once exits before its boot settles.
  for (const argv of good) {
    const session = start({ argv });
    session.input.end();
    const result = await boundedWait(session.result, `a good session ${argv.join(" ")}`, 10_000);
    assert.notEqual(result.exitCode, 2, argv.join(" "));
  }
});

// ---- (b) the sequence --------------------------------------------------------------------------------------------------------

void test("MCP sequence: probe status and up, the handshake is answered and stdin is read while the readback is held, then the call is forwarded", async () => {
  const world = newWorld();
  let release: () => void = () => undefined;
  world.gateAfterUp = new Promise<void>((resolve) => {
    release = resolve;
  });
  const session = start({ argv: ["mcp", "--workspace", WORKSPACE], world });
  assert.equal(session.input.readableFlowing, true, "stdin is read from the start, before the boot has settled");
  session.input.write(frame(1, "initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "1" } }));
  await untilReply(session, 1);
  await pollUntil(() => world.log.filter((entry) => entry === "status").length >= 2, "the readback status is requested");
  assert.deepEqual(world.log, ["status", "up", "status"], "probe, up, readback");
  session.input.write(callStatus(2));
  assert.equal(toolOutcomeOf(await untilReply(session, 2))["code"], "REALM_NOT_ACTIVE", "refused while the readback is held");
  assert.deepEqual(world.tools, []);
  release();
  await untilAttached(session);
  session.input.write(callStatus(3));
  await untilReply(session, 3);
  assert.deepEqual(world.tools, [{ status: {} }], "forwarded once the client is adopted");
  const result = await finish(session);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "");
  framesOf(session.output.text());
});

// ---- (c) the marker ----------------------------------------------------------------------------------------------------------

void test("--host claude: a marker with the six keys exists after settle and is gone after EOF; no --host writes none", async () => {
  const labelled = start({ argv: ["mcp", "--host", "claude", "--workspace", WORKSPACE] });
  labelled.input.write(listTools(1));
  await untilReply(labelled, 1);
  await untilPresence(STATE_DIR, "claude");
  const marker = markerOf("claude");
  assert.deepEqual(Object.keys(marker).sort(), ["attach", "code", "pid", "schemaVersion", "sessionId", "startedAt"]);
  assert.equal(marker["pid"], process.pid);
  assert.equal(marker["attach"], "attached");
  assert.equal(marker["code"], null);
  assert.equal(marker["sessionId"], sessionIdOfWorkspace(WORKSPACE));
  assert.equal((await finish(labelled)).exitCode, 0);
  assert.equal(existsSync(join(MARKER_DIR("claude"), `${String(process.pid)}.json`)), false, "the marker is removed at EOF");

  // The labelled session above left its own marker directory behind; the unlabelled one must add no marker of its own.
  rmSync(join(STATE_DIR, "hosts"), { recursive: true, force: true });
  const unlabelled = start({ argv: ["mcp", "--workspace", WORKSPACE] });
  unlabelled.input.write(listTools(1));
  await untilReply(unlabelled, 1);
  await untilAttached(unlabelled);
  assert.equal(existsSync(join(STATE_DIR, "hosts")), false, "a session with no --host writes no marker");
  assert.equal((await finish(unlabelled)).exitCode, 0);
  assert.deepEqual(reportsOf(unlabelled.sent).map((report) => report.hostId), ["unlabelled", "unlabelled"]);
});

// ---- (c2) the capability host (CAPT-06) --------------------------------------------------------------------------------------

void test("CAPT-06: realm mcp and realm acp attach as their --host id, and an unlabelled session passes no host", async () => {
  const labelled = start({ argv: ["mcp", "--host", "claude", "--workspace", WORKSPACE] });
  labelled.input.write(listTools(1));
  await untilReply(labelled, 1);
  await untilAttached(labelled);
  assert.deepEqual(adopted(labelled.world).map((client) => client.options), [{ host: "claude" }]);
  assert.equal((await finish(labelled)).exitCode, 0);

  const acp = start({ argv: ["acp", "--host", "kimi", "--workspace", WORKSPACE] });
  acp.input.write(frame(1, "initialize", { protocolVersion: 1 }));
  acp.input.write(frame(2, "_realm/tool", { tool: { status: {} } }));
  await untilReply(acp, 2);
  assert.deepEqual(adopted(acp.world).map((client) => client.options), [{ host: "kimi" }]);
  await finish(acp);

  const unlabelled = start({ argv: ["mcp", "--workspace", WORKSPACE] });
  unlabelled.input.write(listTools(1));
  await untilReply(unlabelled, 1);
  await untilAttached(unlabelled);
  assert.deepEqual(adopted(unlabelled.world).map((client) => client.options), [undefined], "no host is passed, not the unlabelled placeholder");
  assert.equal((await finish(unlabelled)).exitCode, 0);
});

// ---- (d) the reports ---------------------------------------------------------------------------------------------------------

void test("reports: attached then closed, one boot id, parseable; a rejecting send changes no exit code and writes nothing at default level", async () => {
  const session = start({ argv: ["mcp", "--host", "codex", "--workspace", WORKSPACE] });
  session.input.write(listTools(1));
  await untilReply(session, 1);
  await untilAttached(session);
  await finish(session);
  const reports = reportsOf(session.sent);
  assert.deepEqual(reports.map((report) => report.phase), ["attached", "closed"]);
  assert.equal(new Set(reports.map((report) => report.bootId)).size, 1);
  assert.deepEqual(reports.map((report) => [report.hostId, report.transport]), [["codex", "mcp"], ["codex", "mcp"]]);

  const failing = start({
    argv: ["mcp", "--host", "codex", "--workspace", WORKSPACE],
    send: () => Promise.reject(new RealmError("TOOL_TIMEOUT")),
  });
  failing.input.write(listTools(1));
  await untilReply(failing, 1);
  await untilAttached(failing);
  const result = await finish(failing);
  assert.equal(result.exitCode, 0);
  assert.equal(failing.diagnostics.text(), "");
});

// ---- (e) the exit and exposure table -----------------------------------------------------------------------------------------

void test("MCP ensure failure serves, refuses calls with the code, writes the code and the daemon-log hint to stderr once and exits 1 at stdin end", async () => {
  const world = newWorld();
  world.daemonUp = false;
  const session = start({ argv: ["mcp", "--workspace", WORKSPACE], world, timeoutMs: 50 });
  session.input.write(listTools(1));
  await untilReply(session, 1);
  await untilSettled(session);
  session.input.write(callStatus(2));
  const refused = toolOutcomeOf(await untilReply(session, 2));
  assert.equal(refused["outcome"], "refused");
  assert.equal(refused["code"], "DAEMON_START_TIMEOUT");
  const result = await finish(session);
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "", "the text was written to diagnostics when the boot settled");
  assert.match(session.diagnostics.text(), /^DAEMON_START_TIMEOUT: /);
  assert.ok(session.diagnostics.text().includes(`${STATE_DIR}/daemon.log`), "the hint names the daemon log");
  assert.equal(framesOf(session.output.text()).length, 2, "stdout holds the two replies only");
  assert.equal(session.spawns.length, 1);
  assert.equal(world.log.includes("up"), false);
});

void test("MCP refused up with a confirming status serves and forwards a call; the refusal is on stderr first", async () => {
  const world = newWorld();
  world.upResult = "PODMAN_MISSING";
  const session = start({ argv: ["mcp", "--workspace", WORKSPACE], world });
  await untilAttached(session);
  session.input.write(callStatus(2));
  await untilReply(session, 2);
  assert.deepEqual(world.tools, [{ status: {} }], "the call reached the daemon fake");
  assert.ok(session.diagnostics.text().startsWith("PODMAN_MISSING: "), session.diagnostics.text());
  assert.equal((await finish(session)).exitCode, 0);
});

void test("MCP refused up whose status names another session serves, refuses the call locally and never calls the daemon", async () => {
  const world = newWorld();
  world.upResult = "PODMAN_MISSING";
  world.readbackOther = true;
  const session = start({ argv: ["mcp", "--workspace", WORKSPACE], world });
  await untilSettled(session);
  session.input.write(callStatus(2));
  const reply = await untilReply(session, 2);
  assert.equal(toolOutcomeOf(reply)["outcome"], "refused");
  assert.deepEqual(world.tools, [], "the call was refused locally");
  assert.ok(session.diagnostics.text().startsWith("PODMAN_MISSING: "), "the refusal is on stderr as today");
  assert.equal((await finish(session)).exitCode, 0);
});

void test("ACP refused up exits 1 with no frame; ACP state error exits 1 with the up refusal text; ACP success serves _realm/tool", async () => {
  const refusedWorld = newWorld();
  refusedWorld.upResult = "PODMAN_MISSING";
  const refused = start({ argv: ["acp", "--workspace", WORKSPACE], world: refusedWorld });
  refused.input.end();
  const refusedResult = await boundedWait(refused.result, "the refused ACP up", 10_000);
  assert.equal(refusedResult.exitCode, 1);
  assert.equal(refusedResult.stdout, "");
  assert.match(refusedResult.stderr, /^PODMAN_MISSING: /);
  assert.equal(refused.output.text(), "", "no frame");

  const errorWorld = newWorld();
  errorWorld.state = "error";
  errorWorld.reason = "AGENTOS_NOT_CONFIGURED";
  const errored = start({ argv: ["acp", "--workspace", WORKSPACE], world: errorWorld });
  errored.input.end();
  const erroredResult = await boundedWait(errored.result, "the ACP error state", 10_000);
  assert.equal(erroredResult.exitCode, 1);
  assert.equal(erroredResult.stderr, `AGENTOS_NOT_CONFIGURED: ${ERROR_CATALOGUE.AGENTOS_NOT_CONFIGURED.reason}\n`);
  assert.equal(errored.output.text(), "");

  const world = newWorld();
  const served = start({ argv: ["acp", "--host", "kimi", "--workspace", WORKSPACE], world });
  served.input.write(frame(1, "initialize", { protocolVersion: 1 }));
  served.input.write(frame(2, "_realm/tool", { tool: { status: {} } }));
  await untilReply(served, 2);
  assert.deepEqual(world.tools, [{ status: {} }]);
  const result = await finish(served);
  assert.equal(result.exitCode, 0);
  assert.deepEqual(framesOf(served.output.text()).map((entry) => entry["id"]), [1, 2]);
  assert.deepEqual(reportsOf(served.sent).map((report) => [report.hostId, report.transport, report.phase]), [
    ["kimi", "acp", "attached"],
    ["kimi", "acp", "closed"],
  ]);
});

// ---- (f) --reattach ----------------------------------------------------------------------------------------------------------

void test("--reattach: an MCP boot that fails DAEMON_START_TIMEOUT exposes the tools, refuses calls while unlinked and forwards after the re-attach", async () => {
  const world = newWorld();
  world.daemonUp = false;
  const session = start({ argv: ["mcp", "--host", "claude", "--reattach", "--workspace", WORKSPACE], world, timeoutMs: 30 });
  await untilSettled(session);
  session.input.write(callStatus(2));
  const refused = await untilReply(session, 2);
  assert.equal(toolOutcomeOf(refused)["outcome"], "refused");
  assert.equal(toolOutcomeOf(refused)["code"], "DAEMON_START_TIMEOUT");
  assert.deepEqual(world.tools, [], "an unlinked session never forwards");
  assert.ok(session.timers.pendingTimeouts() >= 1, "a re-attach wait is armed on the injected timers");
  world.daemonUp = true;
  await session.timers.advance(2_000);
  let id = 3;
  await pollUntil(() => {
    session.input.write(callStatus(id));
    id += 1;
    return world.tools.length >= 1;
  }, "a call is forwarded after the re-attach");
  assert.ok(world.tools.length > 0);
  const result = await finish(session);
  assert.equal(result.exitCode, 0);
  assert.equal(session.timers.pendingCount(), 0, "no timer remains after shutdown");
  framesOf(session.output.text());
});

void test("--reattach on ACP still exits 1 on a boot failure", async () => {
  const world = newWorld();
  world.daemonUp = false;
  const session = start({ argv: ["acp", "--reattach", "--workspace", WORKSPACE], world, timeoutMs: 30 });
  session.input.end();
  const result = await boundedWait(session.result, "the ACP boot failure", 10_000);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /^DAEMON_START_TIMEOUT: /);
  assert.equal(session.output.text(), "");
  assert.equal(session.timers.pendingCount(), 0, "the retry wait is cleared at teardown");
});

// ---- (g) teardown ------------------------------------------------------------------------------------------------------------

void test("EOF and each signal end the session the same way: client closed once, marker removed, a closed report, no down", async () => {
  const cases: readonly { readonly signal: StdioSignal | null; readonly exit: number | null }[] = [
    { signal: null, exit: null },
    { signal: "SIGTERM", exit: 143 },
    { signal: "SIGINT", exit: 130 },
    { signal: "SIGHUP", exit: 129 },
  ];
  for (const row of cases) {
    const world = newWorld();
    const session = start({ argv: ["mcp", "--host", "claude", "--workspace", WORKSPACE], world });
    session.input.write(listTools(1));
    await untilReply(session, 1);
    await untilPresence(STATE_DIR, "claude");
    assert.equal(existsSync(join(MARKER_DIR("claude"), `${String(process.pid)}.json`)), true);
    if (row.signal === null) {
      session.input.end();
    } else {
      session.signals.raise(row.signal);
    }
    const result = await boundedWait(session.result, `the session ending on ${String(row.signal)}`, 10_000);
    assert.equal(result.exitCode, row.exit ?? 0, String(row.signal));
    assert.deepEqual(session.signals.exits, row.exit === null ? [] : [row.exit], String(row.signal));
    assert.deepEqual(
      adopted(world).map((client) => client.closeCalls),
      [1],
      `${String(row.signal)}: the adopted client is closed once`,
    );
    assert.equal(existsSync(join(MARKER_DIR("claude"), `${String(process.pid)}.json`)), false, `${String(row.signal)}: marker removed`);
    assert.deepEqual(reportsOf(session.sent).map((report) => report.phase), ["attached", "closed"]);
    assert.equal(session.sent.some((request) => request.method === "down"), false, "no down request");
    assert.equal(session.signals.armed(), 0, "signal handlers are released");
  }
});

void test("a signal ends a boot that is stuck in up; a second signal exits at once without waiting", async () => {
  const world = newWorld();
  world.upResult = "hang";
  const session = start({
    argv: ["mcp", "--host", "claude", "--workspace", WORKSPACE],
    world,
    // The closing report never settles, so teardown waits for its 1 s bound.
    send: () => new Promise<ControlReply>(() => undefined),
  });
  await pollUntil(() => world.upSeen, "up is requested");
  session.signals.raise("SIGTERM");
  session.signals.raise("SIGINT");
  assert.deepEqual(session.signals.exits, [130], "the second signal exits at once");
  const result = await boundedWait(session.result, "the stuck boot ending on the signal", 10_000);
  assert.equal(result.exitCode, 143);
  assert.deepEqual(session.signals.exits, [130, 143]);
  assert.equal(existsSync(join(STATE_DIR, "hosts")), false, "a boot that never settled left no marker");
  // The client of an up that never settles is not reachable by the driver, so it is not asserted closed here; the process exits.
  assert.ok(adopted(world).every((client) => client.closeCalls <= 1), "no client is closed twice");
});

// ---- (h) logging -------------------------------------------------------------------------------------------------------------

void test("default level: a successful session writes nothing to diagnostics; REALM_LOG_LEVEL=debug shows host.boot lines sharing one correlation id", async () => {
  const quiet = start({ argv: ["mcp", "--host", "claude", "--workspace", WORKSPACE] });
  quiet.input.write(listTools(1));
  await untilReply(quiet, 1);
  await untilAttached(quiet);
  await finish(quiet);
  assert.equal(quiet.diagnostics.text(), "");

  const loud = start({ argv: ["mcp", "--host", "claude", "--workspace", WORKSPACE], env: { ...ENV, REALM_LOG_LEVEL: "debug" } });
  loud.input.write(listTools(1));
  await untilReply(loud, 1);
  await untilAttached(loud);
  await finish(loud);
  const lines = loud.diagnostics
    .text()
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  assert.ok(lines.length >= 2);
  assert.ok(lines.every((line) => typeof line["event"] === "string" && line["event"].startsWith("host.boot.")));
  assert.deepEqual(
    lines.filter((line) => line["event"] === "host.boot.attached" || line["event"] === "host.boot.closed").map((line) => line["event"]),
    ["host.boot.attached", "host.boot.closed"],
  );
  assert.equal(new Set(lines.map((line) => line["correlationId"])).size, 1, "one boot id on every line");
  assert.equal(lines.map((line) => JSON.stringify(line)).join("").includes(WORKSPACE), false, "no workspace path in a boot line");
});

// ---- (i) stdout --------------------------------------------------------------------------------------------------------------

void test("stdout holds only protocol frames in every outcome", async () => {
  const outcomes: readonly { readonly argv: readonly string[]; readonly prepare: (world: World) => void }[] = [
    { argv: ["mcp", "--workspace", WORKSPACE], prepare: () => undefined },
    { argv: ["mcp", "--workspace", WORKSPACE], prepare: (world) => { world.upResult = "PODMAN_MISSING"; } },
    { argv: ["mcp", "--workspace", WORKSPACE], prepare: (world) => { world.daemonUp = false; } },
    { argv: ["acp", "--workspace", WORKSPACE], prepare: () => undefined },
    { argv: ["acp", "--workspace", WORKSPACE], prepare: (world) => { world.upResult = "PODMAN_MISSING"; } },
  ];
  for (const outcome of outcomes) {
    const world = newWorld();
    outcome.prepare(world);
    const session = start({ argv: outcome.argv, world, timeoutMs: 40, env: { ...ENV, REALM_LOG_LEVEL: "debug" } });
    session.input.write(outcome.argv[0] === "mcp" ? listTools(1) : frame(1, "initialize", { protocolVersion: 1 }));
    session.input.end();
    const result = await boundedWait(session.result, `the outcome ${outcome.argv[0] ?? ""}`, 10_000);
    assert.equal(result.stdout, "");
    framesOf(session.output.text());
  }
});

// ---- (j) the one-time refusal diagnostic (Phase 34, D-34-05) -----------------------------------------------------------------

// The lines of the capability hint on a diagnostics stream; every other diagnostic of these sessions is a JSON log line or absent.
const hintLinesOf = (session: Session): string[] => session.diagnostics.text().split("\n").filter((line) => line.startsWith("realm: "));

const deniedWorld = (): World => {
  const world = newWorld();
  world.callCode = "POLICY_DENIED";
  return world;
};

void test("the refusal diagnostic: an unlabelled and a labelled MCP session each write exactly one line after two POLICY_DENIED calls", async () => {
  for (const [flags, expected] of [
    [[], "no host id"],
    [["--host", "claude"], "host claude"],
  ] as const) {
    const world = deniedWorld();
    const session = start({ argv: ["mcp", ...flags, "--workspace", WORKSPACE], world });
    session.input.write(listTools(1));
    await untilReply(session, 1);
    await untilAttached(session);
    session.input.write(callStatus(2));
    session.input.write(callStatus(3));
    const first = await untilReply(session, 2);
    await untilReply(session, 3);
    assert.equal(toolOutcomeOf(first)["code"], "POLICY_DENIED", "the outcome reaches the host unchanged");
    const lines = hintLinesOf(session);
    assert.equal(lines.length, 1, `one line for ${expected}`);
    assert.ok(lines[0]?.includes(expected));
    assert.equal(session.diagnostics.text(), `${lines[0] ?? ""}\n`, "nothing else on the diagnostics stream");
    const result = await finish(session);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "");
    framesOf(session.output.text());
  }
});

void test("the refusal diagnostic: an unlabelled and a labelled ACP session each write exactly one line after two POLICY_DENIED calls", async () => {
  for (const [flags, expected] of [
    [[], "no host id"],
    [["--host", "kimi"], "host kimi"],
  ] as const) {
    const session = start({ argv: ["acp", ...flags, "--workspace", WORKSPACE], world: deniedWorld() });
    session.input.write(frame(1, "initialize", { protocolVersion: 1 }));
    session.input.write(frame(2, "_realm/tool", { tool: { status: {} } }));
    session.input.write(frame(3, "_realm/tool", { tool: { status: {} } }));
    await untilReply(session, 2);
    await untilReply(session, 3);
    const lines = hintLinesOf(session);
    assert.equal(lines.length, 1, `one line for ${expected}`);
    assert.ok(lines[0]?.includes(expected));
    const result = await finish(session);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "");
    framesOf(session.output.text());
  }
});

void test("the refusal diagnostic: a first refusal with another code writes no line, on mcp and on acp", async () => {
  const mcp = start({ argv: ["mcp", "--host", "claude", "--workspace", WORKSPACE] });
  mcp.input.write(listTools(1));
  await untilReply(mcp, 1);
  await untilAttached(mcp);
  mcp.input.write(callStatus(2));
  assert.equal(toolOutcomeOf(await untilReply(mcp, 2))["code"], "REALM_NOT_ACTIVE");
  assert.deepEqual(hintLinesOf(mcp), []);
  await finish(mcp);

  const acp = start({ argv: ["acp", "--host", "kimi", "--workspace", WORKSPACE] });
  acp.input.write(frame(1, "initialize", { protocolVersion: 1 }));
  acp.input.write(frame(2, "_realm/tool", { tool: { status: {} } }));
  await untilReply(acp, 2);
  assert.deepEqual(hintLinesOf(acp), []);
  await finish(acp);
});

void test("the refusal diagnostic: the local refusal of a pending boot writes no line; the daemon's POLICY_DENIED after readiness writes one", async () => {
  const world = deniedWorld();
  let release: () => void = () => undefined;
  world.gateUp = new Promise<void>((resolve) => {
    release = resolve;
  });
  const session = start({ argv: ["mcp", "--workspace", WORKSPACE], world });
  session.input.write(listTools(1));
  await untilReply(session, 1);
  session.input.write(callStatus(2));
  const pending = await untilReply(session, 2);
  assert.equal(toolOutcomeOf(pending)["code"], "REALM_NOT_ACTIVE", "refused locally while the boot is pending");
  assert.deepEqual(world.tools, [], "nothing reached the daemon");
  assert.deepEqual(hintLinesOf(session), [], "a pending-boot refusal is not a capability refusal");

  release();
  await untilAttached(session);
  session.input.write(callStatus(3));
  assert.equal(toolOutcomeOf(await untilReply(session, 3))["code"], "POLICY_DENIED");
  assert.equal(hintLinesOf(session).length, 1);
  await finish(session);
});

// The boot sequence of realm mcp and realm acp (BOOT-03, BOOT-05, BOOT-08): flags, the numbered sequence, the exit and exposure
// table, --reattach, teardown on EOF and on signals, logging levels and stdout purity. Every daemon is a script, every timer and
// signal an injected seam: nothing here opens a socket, arms a boot timer or raises a real signal.

import { after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { runCli, type CliDeps, type CliResult, type ConnectDaemon, type SendControlRequest, type SpawnDaemon } from "../../src/cli/main.js";
import type { StdioSignal } from "../../src/cli/stdio-host.js";
import { ERROR_CATALOGUE, RealmError, type ErrorCode } from "../../src/core/errors.js";
import type { State } from "../../src/core/states.js";
import type { ControlReply, ControlRequest, ControlSelection } from "../../src/daemon/channel.js";
import type { DaemonClient, DaemonStatus } from "../../src/daemon/client.js";
import { parseHostBootReport, type HostBootReport } from "../../src/host/boot-report.js";
import type { MetricsSnapshot } from "../../src/observe/metrics.js";
import { sessionIdOfWorkspace, type EnvironmentLike } from "../../src/session/paths.js";
import type { ToolOutcome } from "../../src/tools/dispatch.js";
import { FakeTimers } from "../support/fake-host-daemon.js";
import { callStatus, capture, FakeSignals, frame, framesOf, listTools, toolOutcomeOf, untilReplyOn, type Capture } from "../support/stdio-host-harness.js";
import { boundedWait, pollUntil } from "../support/timing.js";

const AT = "2026-10-22T00:00:00.000Z";
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

after(() => {
  rmSync(CONFIG_HOME, { recursive: true, force: true });
  rmSync(WORKSPACE, { recursive: true, force: true });
});
beforeEach(() => {
  rmSync(join(STATE_DIR, "hosts"), { recursive: true, force: true });
});

// ---- A scripted daemon -------------------------------------------------------------------------------------------------------

interface World {
  // Whether the control socket answers a status probe.
  daemonUp: boolean;
  // What up does: answer, never settle, or refuse with a catalogue code.
  upResult: "ok" | "hang" | ErrorCode;
  state: State;
  reason: string;
  // The status after up names another project's root and session.
  readbackOther: boolean;
  // When set, a status call made after up waits on it: the readback is held open.
  gateAfterUp: Promise<void> | null;
  upSeen: boolean;
  readonly log: string[];
  readonly tools: unknown[];
  readonly clients: ScriptedClient[];
}

const newWorld = (): World => ({
  daemonUp: true,
  upResult: "ok",
  state: "active",
  reason: "realm active",
  readbackOther: false,
  gateAfterUp: null,
  upSeen: false,
  log: [],
  tools: [],
  clients: [],
});

function statusOf(world: World, selection: ControlSelection): DaemonStatus {
  return {
    snapshot: { state: world.state, reason: world.reason, lastTransitionAt: AT },
    display: { label: "realm active", degraded: false, reason: world.reason, lastTransitionAt: AT },
    mode: "advisory",
    boundRoot: world.readbackOther ? "/ws/other" : selection.workspaceRoot,
    sessionId: world.readbackOther ? sessionIdOfWorkspace("/ws/other") : selection.sessionId,
  };
}

class ScriptedClient implements DaemonClient {
  closeCalls = 0;
  upCalls = 0;
  constructor(
    private readonly world: World,
    private readonly selection: ControlSelection,
  ) {}

  async status(): Promise<DaemonStatus> {
    this.world.log.push("status");
    if (!this.world.daemonUp) {
      throw new RealmError("REALM_NOT_ACTIVE");
    }
    if (this.world.upSeen && this.world.gateAfterUp !== null) {
      await this.world.gateAfterUp;
    }
    return statusOf(this.world, this.selection);
  }

  up(): Promise<DaemonStatus> {
    this.world.log.push("up");
    this.world.upSeen = true;
    this.upCalls += 1;
    if (this.world.upResult === "hang") {
      return new Promise<DaemonStatus>(() => undefined);
    }
    if (this.world.upResult !== "ok") {
      return Promise.reject(new RealmError(this.world.upResult));
    }
    return Promise.resolve(statusOf(this.world, this.selection));
  }

  call(tool: unknown): Promise<ToolOutcome> {
    this.world.log.push("call");
    this.world.tools.push(tool);
    return Promise.resolve({ outcome: "refused", tool: "status", code: "REALM_NOT_ACTIVE", retryable: true });
  }

  metrics(): Promise<MetricsSnapshot> {
    return Promise.reject(new RealmError("REALM_NOT_ACTIVE"));
  }

  close(): void {
    this.closeCalls += 1;
  }
}

// The clients that received up: the adopted ones, not the liveness probes.
const adopted = (world: World): ScriptedClient[] => world.clients.filter((client) => client.upCalls > 0);

// ---- Injected seams ----------------------------------------------------------------------------------------------------------

// FakeSignals and capture are shared with the isolation suite (test/support/stdio-host-harness.ts).

interface Session {
  readonly result: Promise<CliResult>;
  readonly input: PassThrough;
  readonly output: Capture;
  readonly diagnostics: Capture;
  readonly sent: ControlRequest[];
  readonly signals: FakeSignals;
  readonly timers: FakeTimers;
  readonly spawns: string[];
  readonly world: World;
}

interface StartOptions {
  readonly argv: readonly string[];
  readonly world?: World;
  readonly env?: EnvironmentLike;
  readonly timeoutMs?: number;
  readonly send?: SendControlRequest;
}

function start(options: StartOptions): Session {
  const world = options.world ?? newWorld();
  const input = new PassThrough();
  const output = capture();
  const diagnostics = capture();
  const sent: ControlRequest[] = [];
  const spawns: string[] = [];
  const signals = new FakeSignals();
  const timers = new FakeTimers();
  const connect: ConnectDaemon = (_socketPath, selection) => {
    const client = new ScriptedClient(world, selection);
    world.clients.push(client);
    return client;
  };
  const spawn: SpawnDaemon = (_file, args) => {
    spawns.push(...args);
    return { unref: () => undefined };
  };
  const send: SendControlRequest =
    options.send ?? ((_socketPath, request): Promise<ControlReply> => Promise.resolve({ id: request.id, result: { recorded: true } }));
  const deps: CliDeps = {
    env: options.env ?? ENV,
    cwd: WORKSPACE,
    daemonEntry: DAEMON_ENTRY,
    timeoutMs: options.timeoutMs ?? 2000,
    spawn,
    connect,
    send: (socketPath, request, timeoutMs) => {
      sent.push(request);
      return send(socketPath, request, timeoutMs);
    },
    mcpInput: input,
    mcpOutput: output.stream,
    acpInput: input,
    acpOutput: output.stream,
    diagnostics: diagnostics.stream,
    signals,
    bootTimers: timers,
    random: timers.random,
    now: timers.now,
  };
  const result = runCli(options.argv, deps);
  return { result, input, output, diagnostics, sent, signals, timers, spawns, world };
}

const untilReply = (session: Session, id: number): Promise<Record<string, unknown>> => untilReplyOn(session.output, id);

async function finish(session: Session): Promise<CliResult> {
  session.input.end();
  return boundedWait(session.result, "the session ending after stdin closed", 10_000);
}

const markerOf = (host: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(MARKER_DIR(host), `${String(process.pid)}.json`), "utf8")) as Record<string, unknown>;

const reportsOf = (sent: readonly ControlRequest[]): HostBootReport[] =>
  sent.map((request) => {
    assert.equal(request.method, "host-boot");
    const params = request.params;
    assert.ok(typeof params === "object" && params !== null && "report" in params);
    return parseHostBootReport(params.report);
  });

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
  for (const argv of good) {
    const session = start({ argv });
    session.input.end();
    const result = await boundedWait(session.result, `a good session ${argv.join(" ")}`, 10_000);
    assert.notEqual(result.exitCode, 2, argv.join(" "));
  }
});

// ---- (b) the sequence --------------------------------------------------------------------------------------------------------

void test("MCP sequence: probe status, up, readback status, and only then the first stdin read; initialize is answered afterwards", async () => {
  const world = newWorld();
  let release: () => void = () => undefined;
  world.gateAfterUp = new Promise<void>((resolve) => {
    release = resolve;
  });
  const session = start({ argv: ["mcp", "--workspace", WORKSPACE], world });
  session.input.write(frame(1, "initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "1" } }));
  await pollUntil(() => world.log.filter((entry) => entry === "status").length >= 2, "the readback status is requested");
  assert.deepEqual(world.log, ["status", "up", "status"], "probe, up, readback");
  assert.notEqual(session.input.readableFlowing, true, "stdin is not read before the boot settles");
  assert.equal(session.output.text(), "", "no frame before the boot settles");
  release();
  await untilReply(session, 1);
  assert.equal(session.input.readableFlowing, true, "stdin is read once the boot has settled");
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
  const marker = markerOf("claude");
  assert.deepEqual(Object.keys(marker).sort(), ["attach", "code", "pid", "schemaVersion", "sessionId", "startedAt"]);
  assert.equal(marker["pid"], process.pid);
  assert.equal(marker["attach"], "attached");
  assert.equal(marker["code"], null);
  assert.equal(marker["sessionId"], sessionIdOfWorkspace(WORKSPACE));
  assert.equal((await finish(labelled)).exitCode, 0);
  assert.equal(existsSync(join(MARKER_DIR("claude"), `${String(process.pid)}.json`)), false, "the marker is removed at EOF");

  const unlabelled = start({ argv: ["mcp", "--workspace", WORKSPACE] });
  unlabelled.input.write(listTools(1));
  await untilReply(unlabelled, 1);
  assert.equal(existsSync(join(STATE_DIR, "hosts")), false, "a session with no --host writes no marker");
  assert.equal((await finish(unlabelled)).exitCode, 0);
  assert.deepEqual(reportsOf(unlabelled.sent).map((report) => report.hostId), ["unlabelled", "unlabelled"]);
});

// ---- (d) the reports ---------------------------------------------------------------------------------------------------------

void test("reports: attached then closed, one boot id, parseable; a rejecting send changes no exit code and writes nothing at default level", async () => {
  const session = start({ argv: ["mcp", "--host", "codex", "--workspace", WORKSPACE] });
  session.input.write(listTools(1));
  await untilReply(session, 1);
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
  const result = await finish(failing);
  assert.equal(result.exitCode, 0);
  assert.equal(failing.diagnostics.text(), "");
});

// ---- (e) the exit and exposure table -----------------------------------------------------------------------------------------

void test("MCP ensure failure exits 1 with the code and the daemon-log hint on stderr and nothing on stdout", async () => {
  const world = newWorld();
  world.daemonUp = false;
  const session = start({ argv: ["mcp", "--workspace", WORKSPACE], world, timeoutMs: 50 });
  const result = await boundedWait(session.result, "the ensure failure", 10_000);
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /^DAEMON_START_TIMEOUT: /);
  assert.ok(result.stderr.includes(`${STATE_DIR}/daemon.log`), "the hint names the daemon log");
  assert.equal(session.output.text(), "");
  assert.equal(session.spawns.length, 1);
  assert.equal(world.log.includes("up"), false);
});

void test("MCP refused up with a confirming status serves and forwards a call; the refusal is on stderr first", async () => {
  const world = newWorld();
  world.upResult = "PODMAN_MISSING";
  const session = start({ argv: ["mcp", "--workspace", WORKSPACE], world });
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
  assert.equal(world.tools[0] !== undefined, true);
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
  await finish(quiet);
  assert.equal(quiet.diagnostics.text(), "");

  const loud = start({ argv: ["mcp", "--host", "claude", "--workspace", WORKSPACE], env: { ...ENV, REALM_LOG_LEVEL: "debug" } });
  loud.input.write(listTools(1));
  await untilReply(loud, 1);
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

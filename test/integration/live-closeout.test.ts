// Live closeout captures for three open items of the archived v1.0 verification reports (.planning/milestones/v1.0-phases,
// "Re-verification 2026-11-17": 06-VERIFICATION.md rows 6 and 12, 04-VERIFICATION.md human item 5). Each scenario records the
// evidence the report says is missing, through the production stack (the realm CLI, the daemon it spawns, the OpenShell gateway,
// the realm compute driver and rootless Podman 5.x).
//
//   A  Doctor with no daemon. With no realm daemon running, `realm doctor` runs its local checks and exits 0 (the CLI contract,
//      src/cli/main.ts runDoctor: exit 0, stderr "daemon absent (REALM_NOT_ACTIVE); ran N local checks"). Its `control-channel`
//      row is a warn, never a fail, with the catalogue fix FIX_CONTROL_ABSENT (src/doctor/checks.ts). The row is recorded.
//   B  Control socket modes. After `realm up` on a scenario project, `<stateDir>/run` is mode 0700 and `<stateDir>/run/control.sock`
//      is a socket of mode 0600, both owned by the current user (stat). After `realm down` the daemon stops and the socket is
//      removed. The daemon stays up by design only while another session is live: docs/integration/runtime-decision.md "C5 down
//      rule" ("A `down` that leaves no live or admitting session stops the daemon") and src/daemon/daemon.ts releaseSession
//      (stopAfterReply) and closeEverything (removeSocketFile). This scenario runs one session, so it asserts the stop: the socket
//      is gone and no daemon process of this account remains, polled with a bound.
//   C  A timed-out exec is dead, not merely finished (EXEC-01, finding F-3 of the archived v5.0 ledger). Through `realm mcp` (the
//      dispatcher path), an exec of a shell that runs `sleep 300` and a background `sleep 301` outlives the per-call bound and
//      answers TOOL_TIMEOUT (retryable, 25 to 40 s, as production live scenario 7). A read-only /proc probe inside the sandbox
//      (test/support/process-tree-probe.ts) lists the tree by a unique marker, the sleeper argvs, the process group seen in flight
//      and descendants, with identity by pid and start time. Controls make the check non-vacuous: no member before the exec, and at
//      least three members of one process group seen in flight. After the reply the tree must be gone within 15 s and stay gone 3 s
//      later, with at least 200 s of the sleepers' own 300 s left, so the proof does not depend on how long the sleeper runs; a
//      following exec must then succeed and the session stay active. A build without the in-sandbox watchdog is expected to fail
//      at the death assertion, naming the survivors (the evidence Plan 39-03 collects).
//   C2 A process that leaves the exec's process group (setsid) is recorded, not asserted: the group is checked dead, the escapee's
//      state is written to the evidence (the limit the docs state, D-39-05).
//   D  An exec keeps its egress identity through the dispatcher: 1.1.1.1:443 allowed and 8.8.8.8:443 denied, as production live 3.
//
// Gate. The file skips, naming the first missing prerequisite, unless REALM_LIVE_PRODUCTION=1 and the production prerequisites
// hold (productionSkipReason): the opt-in, Podman 5.x, the digest-pinned image, the driver config and socket, a rootless Podman
// socket, the openshell CLI and the built CLI. The test never sets any of them. Scenarios A and B also skip, naming the reason,
// when a realm daemon of this account is already running: they need a state with no daemon, and a daemon that is not this test's
// is never stopped by it.
//
// Removal scope. Each scenario builds its own configuration home and runs `realm up` on the pinned workspace root, as the other
// live suites do, so the sandbox of that one project is the only sandbox it creates. The shared state directory follows the
// existing rules: the operator's policy.json is backed up and restored, every entry the run created is removed, and nothing that
// existed before is. A scenario that brought a project up runs `realm down` in its cleanup and waits for zero containers and
// sandboxes of its name. A realm daemon is never signalled.
//
// Evidence. When REALM_CLOSEOUT_EVIDENCE_DIR names a directory, each scenario saves its command transcript and its own captures
// there (live-closeout.<scenario>.*), whether the scenario passed or failed.
//
// Nothing here prints a secret. Failure messages carry exit codes, catalogue codes, modes and clipped probe output.

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { existsSync, rmSync, statSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import { controlSocketPath } from "../../src/session/paths.js";
import { createCleanups, writeEvidence, type Cleanups } from "../support/omp-live.js";
import {
  callTool,
  canConnect,
  cleanupScenario,
  createScenarioEnvironment,
  describeResult,
  describeValue,
  field,
  findDaemonPids,
  initializeMcp,
  isDirectory,
  isSocket,
  nodeConnectArgv,
  onPath,
  parseNodeProbe,
  pollUntil,
  probePodman,
  productionSkipReason,
  readLiveInputs,
  realmCli,
  realmCliWithWorkspace,
  removeSharedStateCreatedBy,
  restoreSharedPolicy,
  runCommand,
  sandboxExec,
  sessionIdFor,
  startMcpSession,
  stateOfStatus,
  toolErrorOf,
  waitForActive,
  waitUntilServed,
  type CommandResult,
  type LiveInputs,
  type McpSession,
  type NodeProbeResult,
  type ScenarioEnvironment,
  type ScenarioSpec,
} from "../support/production-live.js";
import {
  controlsHold,
  describeMembers,
  isSleeperOf,
  judgeTree,
  parseTreeListing,
  recordedGroups,
  treeProbeArgv,
  type TreeListing,
  type TreeMember,
} from "../support/process-tree-probe.js";

// The compiled CLI beside the compiled tests: this file runs from dist/test/integration, the CLI from dist/src/cli.
const CLI_PATH = fileURLToPath(new URL("../../src/cli/main.js", import.meta.url));
// The compiled daemon entry beside the CLI (dist/src/daemon/main.js), the argument of every daemon process.
const DAEMON_ENTRY = fileURLToPath(new URL("../../src/daemon/main.js", import.meta.url));

const gate = productionSkipReason({
  env: process.env,
  podman: await probePodman(),
  isSocket,
  onPath: (name) => onPath(name, process.env["PATH"]),
  exists: existsSync,
  isDirectory,
  cliPath: CLI_PATH,
});
const live: LiveInputs | undefined = gate === false ? readLiveInputs(process.env, CLI_PATH) : undefined;

function requireLive(): LiveInputs {
  if (live === undefined) {
    throw new Error("a live closeout scenario ran although its gate is closed");
  }
  return live;
}

// The bounds. Each scenario's timeout covers the sum of its parts, which are individually bounded.
const DOCTOR_SCENARIO_TIMEOUT_MS = 300_000;
const SOCKET_SCENARIO_TIMEOUT_MS = 600_000;
const EXEC_SCENARIO_TIMEOUT_MS = 900_000;
const DOCTOR_TIMEOUT_MS = 120_000;
const UP_TIMEOUT_MS = 240_000;
const DOWN_TIMEOUT_MS = 120_000;
const COMMAND_TIMEOUT_MS = 15_000;
// The daemon stops once its down reply is written and the sessions are gone; the bound covers a loaded host.
const DAEMON_STOP_TIMEOUT_MS = 60_000;
const DAEMON_STOP_INTERVAL_MS = 1_000;
const ACTIVE_TIMEOUT_MS = 120_000;
const MCP_EXIT_TIMEOUT_MS = 30_000;
const EVIDENCE_DIR_VARIABLE = "REALM_CLOSEOUT_EVIDENCE_DIR";
const EVIDENCE_PREFIX = "live-closeout";

// The catalogue fix the doctor prints for a control channel that is absent because the daemon is stopped (FIX_CONTROL_ABSENT in
// src/doctor/checks.ts; the constant is not exported).
const FIX_CONTROL_ABSENT = "Run realm up to start the daemon, then rerun doctor.";

const RUN_DIR_MODE = 0o700;
const SOCKET_MODE = 0o600;
const PERMISSION_BITS = 0o777;

interface ScenarioRun {
  readonly inputs: LiveInputs;
  readonly scenario: ScenarioEnvironment;
  readonly cleanups: Cleanups;
  // Appends a line to the scenario's transcript and the test's diagnostics.
  readonly note: (text: string) => void;
  // Adds one command to the transcript and returns it unchanged.
  readonly recorded: (label: string, result: CommandResult) => CommandResult;
  // Registers a capture saved as live-closeout.<scenario>.<name> when the scenario ends, whatever its outcome.
  readonly capture: (name: string, produce: () => string) => void;
}

// Builds the scenario's isolated configuration and registers its teardown on the test. Cleanups run last-in, first-out: the
// evidence is saved first, then the daemon and the project are brought down (when the scenario brought one up), then the
// scenario's files are removed. The teardown runs even when the body failed.
function startScenario(
  t: TestContext,
  scenarioName: string,
  options: { readonly bringsUp: boolean; readonly egressAllow?: ScenarioSpec["egressAllow"] },
): ScenarioRun {
  const inputs = requireLive();
  const scenario = createScenarioEnvironment(inputs, { image: inputs.image, ...(options.egressAllow === undefined ? {} : { egressAllow: options.egressAllow }) });
  const cleanups = createCleanups();
  t.after(() => cleanups.run());
  if (options.bringsUp) {
    cleanups.add(async () => {
      // realm down, restoring the operator's policy, removing what the run created, then the residue wait.
      const outcome = await cleanupScenario(inputs, scenario, []);
      assert.ok(outcome.ok, `residue after the scenario's cleanup: ${outcome.detail}`);
    });
  } else {
    cleanups.add(() => {
      restoreSharedPolicy(scenario);
      removeSharedStateCreatedBy(scenario);
      rmSync(scenario.root, { recursive: true, force: true });
    });
  }
  const transcript: string[] = [];
  const captures = new Map<string, () => string>();
  cleanups.add(() => {
    const files: Record<string, () => string> = { [`${EVIDENCE_PREFIX}.${scenarioName}.commands.txt`]: () => transcript.join("\n\n") };
    for (const [name, produce] of captures) {
      files[`${EVIDENCE_PREFIX}.${scenarioName}.${name}`] = produce;
    }
    for (const problem of writeEvidence(process.env[EVIDENCE_DIR_VARIABLE], files)) {
      t.diagnostic(problem);
    }
  });
  return {
    inputs,
    scenario,
    cleanups,
    note: (text) => {
      transcript.push(text);
      t.diagnostic(text);
    },
    recorded: (label, result) => {
      transcript.push(`$ ${label}\n${describeResult(result)}`);
      return result;
    },
    capture: (name, produce) => {
      captures.set(name, produce);
    },
  };
}

// The daemons of this account that run the compiled daemon entry. A listing that fails is a failed scenario, never "none".
async function daemonPids(inputs: LiveInputs): Promise<readonly number[]> {
  const listing = await findDaemonPids(inputs, DAEMON_ENTRY);
  if (!listing.ok) {
    assert.fail(`the daemon processes cannot be listed: ${listing.detail}`);
  }
  return listing.pids;
}

// The reason a scenario that needs a state with no daemon cannot run, or undefined when no daemon runs.
async function runningDaemonReason(inputs: LiveInputs): Promise<string | undefined> {
  const pids = await daemonPids(inputs);
  return pids.length === 0
    ? undefined
    : `a realm daemon of this account is already running (pid ${pids.join(", ")}); the scenario needs none, and a daemon that is not this test's is never stopped by it`;
}

// ---- Scenario A: doctor with no daemon -----------------------------------------------------------------------------------------

void test(
  "live closeout A: with no daemon, realm doctor runs its local checks and its control-channel row is a warn with the catalogue fix",
  { skip: gate, timeout: DOCTOR_SCENARIO_TIMEOUT_MS },
  async (t) => {
    const inputs = requireLive();
    const blocked = await runningDaemonReason(inputs);
    if (blocked !== undefined) {
      t.skip(blocked);
      return;
    }
    const run = startScenario(t, "A", { bringsUp: false });

    const result = run.recorded("realm doctor", await realmCli(inputs, run.scenario, ["doctor"], DOCTOR_TIMEOUT_MS));
    assert.equal(result.exitCode, 0, `realm doctor with no daemon must exit 0 (the CLI contract): ${describeResult(result)}`);

    const parsed: unknown = JSON.parse(result.stdout.trim());
    assert.ok(Array.isArray(parsed), `realm doctor must print a JSON array of checks: ${describeResult(result)}`);
    const rows: readonly unknown[] = parsed;
    assert.ok(
      result.stderr.includes(`realm doctor: daemon absent (REALM_NOT_ACTIVE); ran ${String(rows.length)} local checks`),
      `realm doctor must say the daemon is absent and that it ran the ${String(rows.length)} checks it printed: ${describeResult(result)}`,
    );
    run.capture("doctor.stdout.json", () => `${JSON.stringify(rows, null, 2)}\n`);
    run.capture("doctor.stderr.txt", () => result.stderr);

    const row = rows.find((candidate) => field(candidate, "id") === "control-channel");
    assert.ok(row !== undefined, `the doctor report must hold a control-channel row; ids: ${describeValue(rows.map((candidate) => field(candidate, "id")))}`);
    run.capture("control-channel-row.json", () => `${JSON.stringify(row, null, 2)}\n`);
    run.note(`doctor control-channel row: ${JSON.stringify(row)}`);

    assert.equal(field(row, "status"), "warn", `with no daemon the control-channel row must be a warn, not a fail: ${describeValue(row)}`);
    const detail = field(row, "detail");
    assert.ok(
      typeof detail === "string" && detail.startsWith("control socket is absent"),
      `the control-channel detail must say the control socket is absent: ${describeValue(row)}`,
    );
    assert.equal(field(row, "fix"), FIX_CONTROL_ABSENT, `the control-channel fix must be the catalogue text: ${describeValue(row)}`);
  },
);

// ---- Scenario B: control socket modes ------------------------------------------------------------------------------------------

// `stat -c '%a %U %F %n' <path>`: the line the verification report asks for, recorded as evidence.
async function statLine(run: ScenarioRun, label: string, path: string): Promise<string> {
  const result = run.recorded(
    `stat -c '%a %U %F %n' ${label}`,
    await runCommand("stat", ["-c", "%a %U %F %n", path], { env: run.inputs.hostEnvironment, timeoutMs: COMMAND_TIMEOUT_MS, cwd: tmpdir() }),
  );
  assert.equal(result.exitCode, 0, `stat ${label}: ${describeResult(result)}`);
  return result.stdout.trim();
}

void test(
  "live closeout B: after realm up the run directory is 0700 and control.sock is 0600 and owned by the user, and after realm down the daemon stops and the socket is gone",
  { skip: gate, timeout: SOCKET_SCENARIO_TIMEOUT_MS },
  async (t) => {
    const inputs = requireLive();
    const blocked = await runningDaemonReason(inputs);
    if (blocked !== undefined) {
      t.skip(blocked);
      return;
    }
    const run = startScenario(t, "B", { bringsUp: true });
    const { stateDir } = run.scenario;
    const runDir = join(stateDir, "run");
    const socketPath = controlSocketPath(stateDir);
    const uid = process.getuid?.();
    assert.ok(uid !== undefined, "the current uid must be available");
    const user = userInfo().username;

    const started = run.recorded("realm up", await realmCli(inputs, run.scenario, ["up", "--workspace", inputs.workspaceRoot], UP_TIMEOUT_MS));
    assert.equal(started.exitCode, 0, `realm up: ${describeResult(started)}`);
    const status = run.recorded("realm status", await realmCliWithWorkspace(inputs, run.scenario, ["status"], inputs.workspaceRoot, COMMAND_TIMEOUT_MS * 2));
    assert.equal(stateOfStatus(status.stdout), "active", `realm status after up: ${describeResult(status)}`);

    // The stat of the live run directory and the live control socket.
    const runDirLine = await statLine(run, "<stateDir>/run", runDir);
    const socketLine = await statLine(run, "<stateDir>/run/control.sock", socketPath);
    const daemonsAfterUp = await daemonPids(inputs);
    run.capture("stat-after-up.txt", () => `${runDirLine}\n${socketLine}\ndaemon pids ${daemonsAfterUp.join(", ")}\n`);
    run.note(`after up: ${runDirLine}; ${socketLine}`);

    const runDirStat = statSync(runDir);
    assert.ok(runDirStat.isDirectory(), `${runDir} must be a directory`);
    assert.equal(runDirStat.mode & PERMISSION_BITS, RUN_DIR_MODE, `the run directory must be mode 700: ${runDirLine}`);
    assert.equal(runDirStat.uid, uid, `the run directory must be owned by the invoking user: ${runDirLine}`);
    assert.ok(runDirLine.startsWith(`700 ${user} directory `), `stat must report 700, ${user} and a directory for the run directory: ${runDirLine}`);
    const socketStat = statSync(socketPath);
    assert.ok(socketStat.isSocket(), `${socketPath} must be a socket`);
    assert.equal(socketStat.mode & PERMISSION_BITS, SOCKET_MODE, `the control socket must be mode 600: ${socketLine}`);
    assert.equal(socketStat.uid, uid, `the control socket must be owned by the invoking user: ${socketLine}`);
    assert.ok(socketLine.startsWith(`600 ${user} socket `), `stat must report 600, ${user} and a socket for the control socket: ${socketLine}`);
    assert.equal(daemonsAfterUp.length, 1, `exactly one daemon must serve the project: pid ${daemonsAfterUp.join(", ")}`);

    // One session, so this down leaves no live session and the daemon stops (runtime-decision.md "C5 down rule").
    const stopped = run.recorded("realm down", await realmCliWithWorkspace(inputs, run.scenario, ["down"], inputs.workspaceRoot, DOWN_TIMEOUT_MS));
    assert.equal(stopped.exitCode, 0, `realm down: ${describeResult(stopped)}`);
    const gone = await pollUntil(
      async () => {
        const pids = await daemonPids(inputs);
        if (existsSync(socketPath)) {
          return { done: false, detail: `the control socket ${socketPath} still exists (daemon pid ${pids.join(", ") || "none"})` };
        }
        return pids.length === 0 ? { done: true } : { done: false, detail: `the socket is gone but daemon pid ${pids.join(", ")} still runs` };
      },
      { timeoutMs: DAEMON_STOP_TIMEOUT_MS, intervalMs: DAEMON_STOP_INTERVAL_MS },
    );
    run.capture("after-down.txt", () => `socket present: ${String(existsSync(socketPath))}\nstop poll: ${gone.ok ? "ok" : gone.detail} after ${String(gone.attempts)} attempt(s)\n`);
    run.note(`after down: socket present ${String(existsSync(socketPath))}; stop poll ${gone.ok ? "ok" : gone.detail} (${String(gone.attempts)} attempt(s))`);
    assert.ok(gone.ok, `after realm down the last session is released, so the daemon must stop and remove its control socket: ${gone.detail}`);
  },
);

// ---- Scenarios C, C2 and D: the exec path through the dispatcher --------------------------------------------------------------

// The request bound for the call that must time out: well above the fixed 30 s per-call bound (src/tools/dispatch.ts
// TOOL_CALL_TIMEOUT_MS), so the answer the test waits for is the tool's own TOOL_TIMEOUT. Production live scenario 7 uses the same.
const TOOL_TIMEOUT_REQUEST_BOUND_MS = 60_000;
// The sleeper of the exec's shell and its background sleeper, far longer than the whole observation window (at most 40 s for the
// reply plus 15 s for the death), so neither can end by itself while the test watches. SLEEPER_LIFE_MS is the foreground sleeper's
// run time; the independence margin is how much of it must remain when the death is first seen.
const SLEEPER_SECONDS = "300";
const BACKGROUND_SLEEPER_SECONDS = "301";
const ESCAPEE_SECONDS = "330";
const SLEEPER_LIFE_MS = 300_000;
const INDEPENDENCE_MARGIN_MS = 200_000;
// The reply band of production live 7, the bounds on seeing the tree in flight and on its death, and the settle wait.
const REPLY_MIN_MS = 25_000;
const REPLY_MAX_MS = 40_000;
const CONTROL_TIMEOUT_MS = 25_000;
const CONTROL_INTERVAL_MS = 1_000;
const DEATH_BOUND_MS = 15_000;
const DEATH_INTERVAL_MS = 500;
const SETTLE_MS = 3_000;
const MARKER_PREFIX = "realm-kill-proof-";
// A command that does not exist: scenario C records what the dispatcher answers for it (no assertion).
const MISSING_COMMAND = "realm-no-such-command";
const TIMEOUT_BINARY = "/usr/bin/timeout";
const DISPATCH_REQUEST_BOUND_MS = 60_000;
// The egress policy of production live 3 (test/integration/production-driver.test.ts): 1.1.1.1:443 allowed, 8.8.8.8:443 not.
const ALLOWED_IP = "1.1.1.1";
const DENIED_IP = "8.8.8.8";
const HOST_PROBE_TIMEOUT_MS = 5_000;

type Settled = { readonly settled: "reply"; readonly value: unknown } | { readonly settled: "rejected"; readonly error: unknown };

// Attaches the handlers at once, so a rejection of the unawaited call is never unhandled.
function settle(request: Promise<unknown>): Promise<Settled> {
  return request.then(
    (value) => ({ settled: "reply" as const, value }),
    (error: unknown) => ({ settled: "rejected" as const, error }),
  );
}

function pause(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

interface ExecScenario {
  readonly run: ScenarioRun;
  readonly session: McpSession;
  // Notes one line in the transcript and the evidence file observations.txt.
  readonly observe: (text: string) => void;
}

// Brings the scenario's project up through `realm mcp` and waits until it is served and active.
async function startExecScenario(t: TestContext, scenarioName: string, options: { readonly egressAllow?: ScenarioSpec["egressAllow"] } = {}): Promise<ExecScenario> {
  const inputs = requireLive();
  const run = startScenario(t, scenarioName, { bringsUp: true, ...options });
  const observations: string[] = [];
  run.capture("observations.txt", () => observations.join("\n"));
  const observe = (text: string): void => {
    observations.push(text);
    run.note(text);
  };
  const session = startMcpSession(inputs, run.scenario);
  run.cleanups.add(() => {
    // A child that is still running (a failed step, or no exit after stdin closed) is killed; the cleanup's realm down follows.
    session.kill();
  });
  await initializeMcp(session);
  await waitUntilServed(session);
  const active = await waitForActive(inputs, run.scenario, ACTIVE_TIMEOUT_MS);
  assert.ok(active.ok, `the realm mcp attach must reach active: ${active.detail}; realm mcp stderr ${session.stderr()}`);
  return { run, session, observe };
}

// One listing of the exec's tree, read inside the sandbox of the scenario's project through the probe. A probe that fails or prints
// something unparseable is a failed listing, never "no process".
async function treeOf(run: ScenarioRun, marker: string, seconds: readonly string[], groups: readonly number[]): Promise<TreeListing> {
  const result = await sandboxExec(run.inputs, sessionIdFor(run.inputs.workspaceRoot), treeProbeArgv(marker, seconds, groups));
  if (result.exitCode !== 0) {
    return { ok: false, detail: `the process-tree probe failed (${describeResult(result)})` };
  }
  return parseTreeListing(result.stdout);
}

interface TimedOutExec {
  readonly marker: string;
  // The last in-flight listing and its process group ids (the group of the marker member).
  readonly flight: readonly TreeMember[];
  readonly groups: readonly number[];
  // The call clock: milliseconds since the call started, at the reply.
  readonly replyAtMs: number;
  readonly startedAt: number;
}

// Steps 4 to 7 of the proof: the negative control, the exec started and not awaited, the positive control seen in flight, then the
// retryable TOOL_TIMEOUT reply inside the band. `script` runs under /bin/sh with the marker as its $0 (the fourth argv element).
async function execUntilTimeout(exec: ExecScenario, script: string, seconds: readonly string[], escaped: readonly string[]): Promise<TimedOutExec> {
  const { run, session, observe } = exec;
  const marker = `${MARKER_PREFIX}${randomBytes(4).toString("hex")}`;
  const every = [...seconds, ...escaped];
  let flight: readonly TreeMember[] = [];
  run.capture("tree-flight.txt", () => `${describeMembers(flight).split("; ").join("\n")}\n`);

  const before = await treeOf(run, marker, every, []);
  assert.ok(before.ok, `the process-tree probe must work before the exec: ${before.ok ? "" : before.detail}`);
  assert.deepEqual(before.members, [], `no member of the tree may exist before the exec (negative control): ${describeMembers(before.members)}`);
  observe(`negative control: no member for marker ${marker} before the exec`);

  // The exec goes out through the dispatcher and is not awaited yet: while it runs, the whole tree must be visible in the sandbox.
  const startedAt = performance.now();
  const call = settle(session.request("tools/call", { name: "exec", arguments: { argv: ["/bin/sh", "-c", script, marker] } }, TOOL_TIMEOUT_REQUEST_BOUND_MS));
  const seen = await pollUntil(
    async () => {
      const listing = await treeOf(run, marker, every, []);
      if (!listing.ok) {
        return { done: false, detail: listing.detail };
      }
      const missing = controlsHold(listing.members, marker, seconds, escaped);
      if (missing !== undefined) {
        return { done: false, detail: missing };
      }
      flight = listing.members;
      observe(`in flight (${String(Math.round(performance.now() - startedAt))} ms): ${describeMembers(flight)}`);
      return { done: true };
    },
    { timeoutMs: CONTROL_TIMEOUT_MS, intervalMs: CONTROL_INTERVAL_MS },
  );
  const outcome = await call;
  const replyAt = performance.now();
  assert.ok(seen.ok, `the probe must see the whole tree in flight, or the absence check below proves nothing (positive control): ${seen.detail}`);
  if (outcome.settled === "rejected") {
    assert.fail(`the exec must answer with a tool error, not fail the request: ${describeValue(outcome.error)}; realm mcp stderr ${session.stderr()}`);
  }
  const reply = outcome.value;
  const elapsedMs = Math.round(replyAt - startedAt);
  observe(`timeout reply after ${String(elapsedMs)} ms: ${describeValue(field(reply, "structuredContent"))}`);
  assert.equal(field(reply, "isError"), true, `the exec must return a tool error: ${describeValue(reply)}`);
  assert.deepEqual(toolErrorOf(reply), { code: "TOOL_TIMEOUT", retryable: true }, `the exec: ${describeValue(field(reply, "structuredContent"))}`);
  assert.ok(
    elapsedMs >= REPLY_MIN_MS && elapsedMs <= REPLY_MAX_MS,
    `TOOL_TIMEOUT must arrive within ${String(REPLY_MIN_MS / 1000)} to ${String(REPLY_MAX_MS / 1000)} s of the call; it took ${String(elapsedMs)} ms`,
  );
  return { marker, flight, groups: recordedGroups(flight, marker), replyAtMs: elapsedMs, startedAt };
}

interface DeathWatch {
  // The call clock (ms since the call started) at the end of the first listing that found no running member.
  readonly deadAtMs: number;
  readonly afterReplyMs: number;
}

// Step 8: polls at once and then every 500 ms for at most 15 s after the reply, judging each listing (taken with the recorded group
// ids) against the in-flight one. `ignore` leaves members out of the judgement (scenario C2 leaves out the escapee on purpose).
async function awaitDeath(
  exec: ExecScenario,
  proof: TimedOutExec,
  seconds: readonly string[],
  ignore: (member: TreeMember) => boolean,
): Promise<DeathWatch> {
  const { run, observe } = exec;
  const lines: string[] = [];
  run.capture("tree-after.txt", () => `${lines.join("\n")}\n`);
  const flight = proof.flight.filter((member) => !ignore(member));
  let deadAtMs: number | undefined;
  const death = await pollUntil(
    async () => {
      const listing = await treeOf(run, proof.marker, seconds, proof.groups);
      const sinceCallMs = performance.now() - proof.startedAt;
      const sinceReplyMs = Math.round(sinceCallMs - proof.replyAtMs);
      if (!listing.ok) {
        lines.push(`+${String(sinceReplyMs)} ms: failed listing: ${listing.detail}`);
        return { done: false, detail: listing.detail };
      }
      const verdict = judgeTree(flight, listing.members.filter((member) => !ignore(member)));
      const line = `+${String(sinceReplyMs)} ms after the reply: ${String(verdict.running.length)} running, ${String(verdict.zombies.length)} zombie(s); running: ${describeMembers(verdict.running)}`;
      lines.push(line);
      observe(line);
      if (verdict.dead) {
        deadAtMs = Math.round(sinceCallMs);
        return { done: true };
      }
      return {
        done: false,
        detail: `${String(verdict.running.length)} member(s) still running: ${describeMembers(verdict.running)}; the same process as in flight: ${describeMembers(verdict.sameProcess)}`,
      };
    },
    { timeoutMs: DEATH_BOUND_MS, intervalMs: DEATH_INTERVAL_MS },
  );
  assert.ok(
    death.ok && deadAtMs !== undefined,
    `a timed-out exec must be dead within ${String(DEATH_BOUND_MS / 1000)} s of the reply, and was not: ${death.detail}`,
  );
  const afterReplyMs = deadAtMs - proof.replyAtMs;
  observe(`dead ${String(afterReplyMs)} ms after the reply (${String(deadAtMs)} ms on the call clock)`);
  return { deadAtMs, afterReplyMs };
}

// A refused or failed request is written, not thrown, so scenario C records what it saw.
function describeSettled(outcome: Settled): string {
  return outcome.settled === "reply" ? `reply ${describeValue(field(outcome.value, "structuredContent"))}` : `request failed ${describeValue(outcome.error)}`;
}

void test(
  "live closeout C: an exec that times out through the dispatcher is dead in the sandbox within 15 s of the reply, not merely finished",
  { skip: gate, timeout: EXEC_SCENARIO_TIMEOUT_MS },
  async (t) => {
    const inputs = requireLive();
    const exec = await startExecScenario(t, "C");
    const { run, session, observe } = exec;

    // Tooling: Plan 39-02 wraps every exec in /usr/bin/timeout, so the image must provide it. Runs on every build.
    const version = await sandboxExec(inputs, sessionIdFor(inputs.workspaceRoot), [TIMEOUT_BINARY, "--version"]);
    assert.equal(version.exitCode, 0, `the sandbox image must provide ${TIMEOUT_BINARY} (Plan 39-02 relies on it): ${describeResult(version)}`);
    observe(`${TIMEOUT_BINARY} --version: ${version.stdout.split(/\r?\n/)[0] ?? ""}`);

    // Observation only (D-39-06): what the dispatcher answers for a command that does not exist. Nothing is asserted.
    const missing = await settle(session.request("tools/call", { name: "exec", arguments: { argv: [MISSING_COMMAND] } }, DISPATCH_REQUEST_BOUND_MS));
    observe(`exec ${MISSING_COMMAND} through the dispatcher: ${describeSettled(missing)}`);

    const script = `sleep ${BACKGROUND_SLEEPER_SECONDS} & sleep ${SLEEPER_SECONDS}; wait`;
    const proof = await execUntilTimeout(exec, script, [SLEEPER_SECONDS, BACKGROUND_SLEEPER_SECONDS], []);
    observe(`recorded process group(s) ${proof.groups.join(", ")}`);

    const death = await awaitDeath(exec, proof, [SLEEPER_SECONDS, BACKGROUND_SLEEPER_SECONDS], () => false);

    // Independence: the sleeper still had 200 s or more of its own life when its death was first seen, so it did not end by itself.
    observe(`the sleeper had ${String(Math.round((SLEEPER_LIFE_MS - death.deadAtMs) / 1000))} s of natural life left at the first listing that found it dead`);
    assert.ok(
      death.deadAtMs + INDEPENDENCE_MARGIN_MS <= SLEEPER_LIFE_MS,
      `the death must be seen with at least ${String(INDEPENDENCE_MARGIN_MS / 1000)} s of the sleeper's ${String(SLEEPER_LIFE_MS / 1000)} s life left; it was seen at ${String(death.deadAtMs)} ms`,
    );

    // Settle: still dead a moment later, so a transient empty listing cannot pass.
    await pause(SETTLE_MS);
    const settled = await treeOf(run, proof.marker, [SLEEPER_SECONDS, BACKGROUND_SLEEPER_SECONDS], proof.groups);
    assert.ok(settled.ok, `the settle listing must work: ${settled.ok ? "" : settled.detail}`);
    const later = judgeTree(proof.flight, settled.members);
    observe(`settle listing after ${String(SETTLE_MS)} ms: ${String(later.running.length)} running, ${String(later.zombies.length)} zombie(s)`);
    assert.equal(later.dead, true, `the tree must stay dead: ${describeMembers(later.running)}`);

    // The session is still usable and active, and the child exits cleanly when its input closes.
    const echoed = await callTool(session, "exec", { argv: ["echo", "ok"] });
    assert.equal(field(echoed, "exitCode"), 0, `exec echo after the timeout: ${describeValue(echoed)}`);
    assert.equal(String(field(echoed, "stdout")).trim(), "ok", `exec echo after the timeout: ${describeValue(echoed)}`);
    const status = run.recorded("realm status", await realmCliWithWorkspace(inputs, run.scenario, ["status"], inputs.workspaceRoot, COMMAND_TIMEOUT_MS * 2));
    assert.equal(stateOfStatus(status.stdout), "active", `realm status after the timeout: ${describeResult(status)}`);
    session.closeInput();
    const ended = await session.waitForExit(MCP_EXIT_TIMEOUT_MS);
    assert.deepEqual(ended, { code: 0, signal: null }, `realm mcp must exit 0 within ${String(MCP_EXIT_TIMEOUT_MS / 1000)} s of its stdin closing; stderr ${session.stderr()}`);
  },
);

// ---- Scenario C2: a process that leaves the process group is recorded, not asserted -------------------------------------------

void test(
  "live closeout C2: after a timed-out exec the process group is dead, and whether a setsid escapee survives is recorded",
  { skip: gate, timeout: EXEC_SCENARIO_TIMEOUT_MS },
  async (t) => {
    const inputs = requireLive();
    const exec = await startExecScenario(t, "C2");
    const { run, observe } = exec;

    const setsid = await sandboxExec(inputs, sessionIdFor(inputs.workspaceRoot), ["/bin/sh", "-c", "command -v setsid"]);
    if (setsid.exitCode !== 0) {
      observe(`setsid is absent in the sandbox image: ${describeResult(setsid)}`);
      t.skip("setsid absent in the sandbox image");
      return;
    }
    observe(`setsid: ${setsid.stdout.trim()}`);

    const script = `setsid sleep ${ESCAPEE_SECONDS} & sleep ${SLEEPER_SECONDS}; wait`;
    const proof = await execUntilTimeout(exec, script, [SLEEPER_SECONDS], [ESCAPEE_SECONDS]);
    const isEscapee = (member: TreeMember): boolean => isSleeperOf(member, ESCAPEE_SECONDS);
    const escapeeInFlight = proof.flight.find(isEscapee);
    observe(`recorded process group(s) ${proof.groups.join(", ")}; escapee in flight: ${escapeeInFlight === undefined ? "none" : describeMembers([escapeeInFlight])}`);

    // The members other than the escapee are dead, as in scenario C. This is asserted.
    await awaitDeath(exec, proof, [SLEEPER_SECONDS, ESCAPEE_SECONDS], isEscapee);

    // The escapee is recorded, not asserted.
    const last = await treeOf(run, proof.marker, [SLEEPER_SECONDS, ESCAPEE_SECONDS], proof.groups);
    let record: string;
    if (!last.ok) {
      record = `escapee state unknown: ${last.detail}`;
    } else {
      const found = last.members.find(isEscapee);
      if (found === undefined) {
        record = "escapee absent: the process that left the group is gone too";
      } else {
        const same = escapeeInFlight !== undefined && escapeeInFlight.pid === found.pid && escapeeInFlight.start === found.start;
        const group = proof.groups.includes(found.pgid) ? "the exec's group" : `its own group ${String(found.pgid)} (the exec's group: ${proof.groups.join(", ")})`;
        record = `escapee ${found.state === "Z" || found.state === "X" ? "zombie" : "running"}${same ? ", the same process as in flight" : ", not the process seen in flight"}: ${describeMembers([found])}; it sits in ${group}`;
      }
    }
    observe(record);
    run.capture("escapee.txt", () => `${record}\n`);
  },
);

// ---- Scenario D: the egress identity through the dispatcher --------------------------------------------------------------------

void test(
  "live closeout D: an exec through the dispatcher keeps its egress identity: 1.1.1.1:443 is reachable and 8.8.8.8:443 is refused",
  { skip: gate, timeout: EXEC_SCENARIO_TIMEOUT_MS },
  async (t) => {
    // The supervisor connects out on the sandbox's behalf, so the host needs the real internet (production live 3 skips the same way).
    if (!(await canConnect(ALLOWED_IP, 443, HOST_PROBE_TIMEOUT_MS))) {
      t.skip(`the host has no outbound connectivity: a TCP connection to ${ALLOWED_IP}:443 did not open within ${String(HOST_PROBE_TIMEOUT_MS / 1000)} s`);
      return;
    }
    const { session, observe } = await startExecScenario(t, "D", { egressAllow: [{ host: ALLOWED_IP, port: 443 }] });

    const connectAnswer = async (host: string): Promise<NodeProbeResult> => {
      const result = await callTool(session, "exec", { argv: nodeConnectArgv(host, 443, 4) });
      assert.equal(field(result, "exitCode"), 0, `node connect probe for ${host} through the dispatcher: ${describeValue(result)}`);
      const stdout = field(result, "stdout");
      return parseNodeProbe(typeof stdout === "string" ? stdout : "");
    };
    const allowed = await connectAnswer(ALLOWED_IP);
    observe(`${ALLOWED_IP}:443 through the dispatcher: ${JSON.stringify(allowed)}`);
    assert.deepEqual(allowed, { kind: "ok", detail: "" }, `a connection to the allowed address ${ALLOWED_IP}:443 must succeed through the dispatcher`);
    const denied = await connectAnswer(DENIED_IP);
    observe(`${DENIED_IP}:443 through the dispatcher: ${JSON.stringify(denied)}`);
    assert.deepEqual(denied, { kind: "error", code: "EACCES" }, `a connection to ${DENIED_IP}:443, which is not allowed, must fail with EACCES through the dispatcher`);
  },
);

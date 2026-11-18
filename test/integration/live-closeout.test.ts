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
//   C  A timed-out exec leaves no process behind. Through `realm mcp` (the dispatcher path), an exec of `sleep 47` outlives the
//      per-call bound and answers TOOL_TIMEOUT (as production live scenario 7). While the call is in flight the sandbox shows the
//      sleeper (a positive control, so the absence check cannot pass vacuously); after the timeout reply no process whose argv is
//      `sleep 47` remains in the sandbox (read from /proc through an argv exec), polled with a bound.
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
import { existsSync, rmSync, statSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import { controlSocketPath } from "../../src/session/paths.js";
import { createCleanups, writeEvidence, type Cleanups } from "../support/omp-live.js";
import {
  callTool,
  cleanupScenario,
  createScenarioEnvironment,
  describeResult,
  describeValue,
  field,
  findDaemonPids,
  initializeMcp,
  isDirectory,
  isSocket,
  onPath,
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
  type ScenarioEnvironment,
} from "../support/production-live.js";

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
function startScenario(t: TestContext, scenarioName: string, options: { readonly bringsUp: boolean }): ScenarioRun {
  const inputs = requireLive();
  const scenario = createScenarioEnvironment(inputs, { image: inputs.image });
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

// ---- Scenario C: a timed-out exec leaves no process behind ---------------------------------------------------------------------

// The request bound for the call that must time out: well above the fixed 30 s per-call bound (src/tools/dispatch.ts
// TOOL_CALL_TIMEOUT_MS), so the answer the test waits for is the tool's own TOOL_TIMEOUT. Production live scenario 7 uses the same.
const TOOL_TIMEOUT_REQUEST_BOUND_MS = 60_000;
// Longer than the per-call bound (30 s) and the runner's own deadline (28 s), and different from scenario 7's 45, so the workload is
// still running when the bound fires and no other scenario's sleeper can match.
const SLEEP_SECONDS = "47";
// The bound on seeing the sleeper while the call is in flight, and on its absence after the timeout reply.
const SLEEPER_SEEN_TIMEOUT_MS = 25_000;
const SLEEPER_GONE_TIMEOUT_MS = 30_000;
const SLEEPER_INTERVAL_MS = 1_000;

// Runs inside the sandbox through an argv exec: node reads /proc and prints "count <n>" then one "proc <pid> <state>" line for each
// process whose argv is exactly [<anything>/sleep, <seconds>]. The probe's own argv is node, -e and this script, so it never
// matches. A zombie has an empty cmdline and never matches either; the state is printed so a defunct leftover would be visible.
const SLEEPER_SCRIPT =
  'const fs = require("node:fs");' +
  "const want = process.argv[1];" +
  "const found = [];" +
  'for (const name of fs.readdirSync("/proc")) {' +
  "  if (!/^[0-9]+$/.test(name)) { continue; }" +
  "  let raw;" +
  '  try { raw = fs.readFileSync("/proc/" + name + "/cmdline", "utf8"); } catch (error) { continue; }' +
  "  const argv = raw.split(String.fromCharCode(0));" +
  '  if (argv.length > 0 && argv[argv.length - 1] === "") { argv.pop(); }' +
  '  const base = (argv[0] || "").split("/").pop();' +
  '  if (base !== "sleep" || argv.length !== 2 || argv[1] !== want) { continue; }' +
  '  let state = "?";' +
  '  try { const match = /^State:\\s+(\\S)/m.exec(fs.readFileSync("/proc/" + name + "/status", "utf8")); if (match) { state = match[1]; } } catch (error) { state = "gone"; }' +
  '  found.push(name + " " + state);' +
  "}" +
  'console.log("count " + found.length);' +
  'for (const entry of found) { console.log("proc " + entry); }';

type SleeperListing = { readonly ok: true; readonly processes: readonly string[] } | { readonly ok: false; readonly detail: string };

// The `sleep <seconds>` processes in the sandbox of the scenario's project, read from /proc. A probe that fails or prints nothing
// parseable is a failed listing, never "no process".
async function sleepersIn(run: ScenarioRun): Promise<SleeperListing> {
  const result = await sandboxExec(run.inputs, sessionIdFor(run.inputs.workspaceRoot), ["node", "-e", SLEEPER_SCRIPT, SLEEP_SECONDS]);
  if (result.exitCode !== 0) {
    return { ok: false, detail: `the /proc probe failed (${describeResult(result)})` };
  }
  const lines = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
  const counted = lines.find((line) => line.startsWith("count "));
  const processes = lines.filter((line) => line.startsWith("proc ")).map((line) => line.slice("proc ".length));
  if (counted === undefined || counted !== `count ${String(processes.length)}`) {
    return { ok: false, detail: `the /proc probe printed an unexpected answer (${describeResult(result)})` };
  }
  return { ok: true, processes };
}

void test(
  "live closeout C: an exec that times out through the dispatcher leaves no process behind in the sandbox",
  { skip: gate, timeout: EXEC_SCENARIO_TIMEOUT_MS },
  async (t) => {
    const inputs = requireLive();
    const run = startScenario(t, "C", { bringsUp: true });
    const observations: string[] = [];
    run.capture("sandbox-processes.txt", () => observations.join("\n"));
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

    const before = await sleepersIn(run);
    assert.ok(before.ok, `the sandbox probe must work before the exec: ${before.ok ? "" : before.detail}`);
    assert.deepEqual(before.processes, [], `no sleep ${SLEEP_SECONDS} may run in the sandbox before the exec`);

    // The exec goes out through the dispatcher and is not awaited yet: while it runs, the sleeper must be visible in the sandbox.
    const startedAt = performance.now();
    const call = session
      .request("tools/call", { name: "exec", arguments: { argv: ["sleep", SLEEP_SECONDS] } }, TOOL_TIMEOUT_REQUEST_BOUND_MS)
      .then(
        (value) => ({ settled: "reply" as const, value }),
        (error: unknown) => ({ settled: "rejected" as const, error }),
      );
    const seen = await pollUntil(
      async () => {
        const listing = await sleepersIn(run);
        if (!listing.ok) {
          return { done: false, detail: listing.detail };
        }
        if (listing.processes.length > 0) {
          observe(`in flight (${String(Math.round(performance.now() - startedAt))} ms): sleep ${SLEEP_SECONDS} running as ${listing.processes.join("; ")}`);
          return { done: true };
        }
        return { done: false, detail: `no sleep ${SLEEP_SECONDS} process in the sandbox yet` };
      },
      { timeoutMs: SLEEPER_SEEN_TIMEOUT_MS, intervalMs: SLEEPER_INTERVAL_MS },
    );
    const outcome = await call;
    assert.ok(seen.ok, `the probe must see the sleeper while the exec runs, or the absence check below proves nothing: ${seen.detail}`);
    if (outcome.settled === "rejected") {
      assert.fail(`exec sleep ${SLEEP_SECONDS} must answer with a tool error, not fail the request: ${describeValue(outcome.error)}; realm mcp stderr ${session.stderr()}`);
    }
    const timedOut = outcome.value;
    observe(`timeout reply after ${String(Math.round(performance.now() - startedAt))} ms: ${describeValue(field(timedOut, "structuredContent"))}`);
    assert.equal(field(timedOut, "isError"), true, `exec sleep ${SLEEP_SECONDS} must return a tool error: ${describeValue(timedOut)}`);
    assert.deepEqual(toolErrorOf(timedOut), { code: "TOOL_TIMEOUT", retryable: true }, `exec sleep ${SLEEP_SECONDS}: ${describeValue(field(timedOut, "structuredContent"))}`);

    // After the reply, no process whose argv is `sleep 47` may remain. The first listing is taken at once; a later one, within the
    // bound, covers a kill that lands a moment after the reply.
    const gone = await pollUntil(
      async () => {
        const listing = await sleepersIn(run);
        if (!listing.ok) {
          return { done: false, detail: listing.detail };
        }
        observe(`after the timeout reply: ${listing.processes.length === 0 ? "no sleeper" : `sleeper(s) ${listing.processes.join("; ")}`}`);
        return listing.processes.length === 0 ? { done: true } : { done: false, detail: `sleep ${SLEEP_SECONDS} still runs in the sandbox: ${listing.processes.join("; ")}` };
      },
      { timeoutMs: SLEEPER_GONE_TIMEOUT_MS, intervalMs: SLEEPER_INTERVAL_MS },
    );
    assert.ok(gone.ok, `a timed-out exec must leave no process in the sandbox: ${gone.detail}`);

    // The session is still usable, and the child exits cleanly when its input closes.
    const echoed = await callTool(session, "exec", { argv: ["echo", "ok"] });
    assert.equal(field(echoed, "exitCode"), 0, `exec echo after the timeout: ${describeValue(echoed)}`);
    session.closeInput();
    const ended = await session.waitForExit(MCP_EXIT_TIMEOUT_MS);
    assert.deepEqual(ended, { code: 0, signal: null }, `realm mcp must exit 0 within ${String(MCP_EXIT_TIMEOUT_MS / 1000)} s of its stdin closing; stderr ${session.stderr()}`);
  },
);

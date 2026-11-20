// Gated live test of the rapid stop-then-up chain (Phase 46, STOP-01 and the capture half of STOP-04).
//
// Finding F-41-1 (Phase 41): in a loop of stop-then-`realm up` on one sandbox name with no settle, one `up` failed with
// OPENSHELL_START_FAILED right after the previous iteration's stop. This test is the instrument that either reproduces it or
// records how many consecutive iterations were clean, and keeps what is needed to find its cause: the timeline of every
// component, written outside the repository.
//
// A chain on one sandbox name: a settled `realm up` for the pinned workspace, one scratch exec, then, per iteration, SIGTERM to
// the one daemon (never `realm down`), a poll of its pid every 50 ms, and the instant the pid is gone `realm up` for the same
// workspace, then wait for active and one exec. Nothing is settled between a stop and the next up, except in the control s. No
// iteration is retried, dropped or relabelled: a failing iteration is kept with its whole timeline, the scenario is cleaned and a
// new chain starts; the consecutive clean count resets on any failure.
//
// Variants (REALM_RAPID_VARIANTS, a comma list over a, b, c and s; default a, b, c):
//   a  the stop of a daemon that holds a scratch session with one exec, then the immediate up.
//   b  as a, with one busy node worker per CPU from the signal until the next up has reached active or failed.
//   c  the signal is sent 3 s after a realm up started that has not finished, then the immediate second up must reach active.
//      Every c iteration starts from a settled state with no daemon, so the first up starts a daemon; the first up may fail and is
//      recorded, not judged; the stop is judged like the others (a stop with no daemon.stopped row is a finding, never a pass).
//   s  the control: as a, but before each up the driver unit runs no host supervisor, the gateway lists no realm sandbox and
//      Podman lists no container for the name. It runs only when REALM_RAPID_VARIANTS names it or, with the default list, when
//      a, b or c recorded a failure; the test writes the reason it did or did not run.
// REALM_RAPID_ITERATIONS (1 to 50, default 50) is the consecutive clean target of a, b and c; the control runs 20 (at most that
// count); REALM_RAPID_MAX_FAILURES (1 to 5, default 3) is the failures a variant keeps before it stops.
//
// Evidence, written to REALM_RAPID_EVIDENCE_DIR (outside the repository; the directories this test makes are mode 0700 and every
// file mode 0600): summary.txt (the outcome word, the counts per variant and the facts; the only file numbers are copied from),
// iterations.txt (one closed-phrase line per iteration), facts.txt, and per chain a directory with, per iteration, the up output,
// the whole request log slice and daemon log slice of the window from the signal to the end of the next up (the daemon's stderr
// goes to daemon.log, so the driver's create failure and name-release lines are in it), the journal of the driver unit
// (REALM_LIVE_DRIVER_UNIT) and of the gateway unit (REALM_RAPID_GATEWAY_UNIT), the Podman events, the samples of the driver unit's
// child processes (every 100 ms), of the session's containers (every 250 ms) and of the gateway's sandbox list (every 500 ms), and
// the merged timeline on this test's own UTC millisecond clock. A source that cannot be read is written as an unavailable line and
// never fails the iteration.
//
// Gate. The whole file is one test that skips, with a reason that names the first missing prerequisite, unless the production gate
// opens (REALM_LIVE_PRODUCTION=1 and the rest of production-driver.test.ts) and, in addition, REALM_LIVE_RAPID=1 (an operator
// opt-in the test never sets), REALM_RAPID_EVIDENCE_DIR names an existing absolute directory and the variant list is valid.
//
// Preconditions the test cannot check and the operator must provide: the same as daemon-stop-live.test.ts (gateway and compute
// driver running under the realm account, the pinned workspace root empty, no other live sandbox, no other container in the
// account's Podman, no other daemon of the account) and one live run at a time on the shared stack.
//
// The test passes when every chosen variant ran to its target with no failure of any kind. A reproduction, another failure or a
// host stop fails it after the evidence is written; the outcome word is in summary.txt either way.

import { spawn, type ChildProcess } from "node:child_process";
import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { cpus, loadavg, tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { requestLogPath } from "../../src/daemon/ensure.js";
import { OPENSHELL_SANDBOX_NAME_LABEL_KEY } from "../../src/runtime/openshell.js";
import {
  cleanupScenario,
  createScenarioEnvironment,
  describeResult,
  findDaemonPids,
  isDirectory,
  isSocket,
  listRealmSandboxes,
  listSandboxContainers,
  onPath,
  openshellCli,
  pollUntil,
  probePodman,
  readLiveInputs,
  realmCli,
  realmCliWithWorkspace,
  runCommand,
  sandboxExec,
  sandboxNameFor,
  sessionIdFor,
  waitForActive,
  waitForNoResidue,
  type CommandResult,
  type LiveInputs,
  type PollOutcome,
  type ScenarioEnvironment,
} from "../support/production-live.js";
import { containerStateOf, loadPerCpu, loadWorkers, stopRecordsOf } from "../support/daemon-stop-live.js";
import {
  LIVE_DRIVER_UNIT_VARIABLE,
  MID_UP_DELAY_MS,
  RAPID_EVIDENCE_DIR_VARIABLE,
  RAPID_GATEWAY_UNIT_VARIABLE,
  RAPID_ITERATIONS_VARIABLE,
  RAPID_MAX_FAILURES_VARIABLE,
  RAPID_VARIANTS_VARIABLE,
  chainStartEvidenceLine,
  recordChainStartFailure,
  chainStep,
  classifyStop,
  classifyUp,
  controlDecision,
  evidenceLine,
  failureKindsOf,
  iterationEvidenceLine,
  lateSupervisors,
  mergeTimeline,
  newChainState,
  parseIterations,
  parseMaxFailures,
  parseRapidVariants,
  pidsOfListing,
  rapidSkipReason,
  reapRemovedAfter,
  startupRowsOf,
  startupSeenAt,
  summaryOf,
  supervisorLifespans,
  targetOf,
  windowOutcome,
  type ChainAction,
  type ChainState,
  type IterationRecord,
  type RapidVariant,
  type StopClass,
  type SupervisorSample,
  type TimelineEvent,
  type UpOutcome,
  type UpRun,
  type VariantEnd,
  type VariantResult,
} from "../support/rapid-stop-up.js";

// The compiled CLI and the compiled daemon entry beside the compiled tests (dist/src/cli/main.js, dist/src/daemon/main.js).
const CLI_PATH = fileURLToPath(new URL("../../src/cli/main.js", import.meta.url));
const DAEMON_ENTRY = fileURLToPath(new URL("../../src/daemon/main.js", import.meta.url));
const PACKAGE_JSON = fileURLToPath(new URL("../../../package.json", import.meta.url));

const probe = await probePodman();
const gate = rapidSkipReason({
  env: process.env,
  podman: probe,
  isSocket,
  onPath: (name) => onPath(name, process.env["PATH"]),
  exists: existsSync,
  isDirectory,
  cliPath: CLI_PATH,
});
const gateInputs: LiveInputs | undefined = gate === false ? readLiveInputs(process.env, CLI_PATH) : undefined;
const rawVariants = process.env[RAPID_VARIANTS_VARIABLE];
const parsedVariants = parseRapidVariants(rawVariants);
const iterations = parseIterations(process.env[RAPID_ITERATIONS_VARIABLE]);
const maxFailures = parseMaxFailures(process.env[RAPID_MAX_FAILURES_VARIABLE]);
const evidenceDir = process.env[RAPID_EVIDENCE_DIR_VARIABLE] ?? "";
const driverUnit = nonEmpty(process.env[LIVE_DRIVER_UNIT_VARIABLE]);
const gatewayUnit = nonEmpty(process.env[RAPID_GATEWAY_UNIT_VARIABLE]);
// The variants that always run when chosen. The control s is decided at run time.
const mainVariants: readonly RapidVariant[] = gate === false && parsedVariants.ok ? parsedVariants.variants.filter((variant) => variant !== "s") : [];

function nonEmpty(value: string | undefined): string | undefined {
  return value === undefined || value === "" ? undefined : value;
}

function inputs(): LiveInputs {
  if (gateInputs === undefined) {
    throw new Error("the rapid stop-then-up live test ran although its gate is closed");
  }
  return gateInputs;
}

// ---- Bounds ---------------------------------------------------------------------------------------------------------------

// realm up has its own 200 s startup budget; this bounds one CLI call.
const UP_TIMEOUT_MS = 240_000;
const ACTIVE_TIMEOUT_MS = 120_000;
const DOWN_TIMEOUT_MS = 120_000;
// The bound on the daemon's exit after SIGTERM: the 5 s drain, the 70 s teardown bound (TEARDOWN_TIMEOUT_MS, which includes the
// 10 s container confirmation wait of Phase 46) and a 25 s margin.
const DAEMON_EXIT_BOUND_MS = 100_000;
const DAEMON_EXIT_POLL_MS = 50;
const DAEMON_APPEAR_BOUND_MS = 30_000;
const DAEMON_APPEAR_POLL_MS = 50;
// The control's settle: each of its three waits has this bound; a settle that does not finish is a host reason, not a failure.
const SETTLE_BOUND_MS = 60_000;
const SETTLE_POLL_MS = 500;
const CHILD_SAMPLE_MS = 100;
const CONTAINER_SAMPLE_MS = 250;
const SANDBOX_SAMPLE_MS = 500;
const HOST_CALL_MS = 30_000;
const JOURNAL_CALL_MS = 60_000;
// The window the journals and Podman events are read for: from this long before the signal to this long after the iteration.
const WINDOW_MARGIN_MS = 1_000;
// One iteration takes at most this long (a stop, an up, the wait for active, one exec and the evidence reads).
const PER_ITERATION_TIMEOUT_MS = 7 * 60_000;
const MAX_VARIANT_TIMEOUT_MS = 6 * 60 * 60_000;

function variantTimeoutMs(variant: RapidVariant): number {
  return Math.min(MAX_VARIANT_TIMEOUT_MS, targetOf(variant, iterations) * PER_ITERATION_TIMEOUT_MS);
}

const TOTAL_TIMEOUT_MS = Math.max(1, [...mainVariants, "s" as const].reduce((sum, variant) => sum + variantTimeoutMs(variant), 0));

// ---- Small helpers --------------------------------------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

// A host reason: the stack, the lock or the harness itself is not in the state the chain needs. It ends the window as VOID, never
// as a product failure.
class ChainAbort extends Error {}

// The settled first up of a chain failed (the up exited non-zero, or the session did not reach active, or the scratch exec failed).
// It is a counted failure of its own kind, not a host reason: the chain is cleaned and a new chain starts.
class ChainStartFailure extends Error {
  constructor(
    readonly chain: Chain,
    readonly up: UpOutcome,
    readonly active: boolean,
  ) {
    super("the settled first up of the chain failed");
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function cpuLoad(): number | null {
  return loadPerCpu(loadavg()[0] ?? Number.NaN, cpus().length);
}

function hostCall(file: string, args: readonly string[], timeoutMs: number = HOST_CALL_MS): Promise<CommandResult> {
  return runCommand(file, args, { env: inputs().hostEnvironment, timeoutMs, cwd: tmpdir() });
}

function unavailable(result: CommandResult): string {
  return `unavailable: ${describeResult(result)}\n`;
}

function ensureDirectory(path: string): void {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  chmodSync(path, 0o700);
}

function evidenceFile(directory: string, name: string, text: string): void {
  writeFileSync(join(directory, name), text, { mode: 0o600 });
}

// The log's size, so the rows of one stop are read from where the stop began. An absent file is size 0.
function fileSize(path: string): number {
  return statSync(path, { throwIfNoEntry: false })?.size ?? 0;
}

// The file from byte offset on; a file shorter than the offset was rotated and is read whole. An absent file is empty text. A file
// that cannot be read is undefined.
function textFrom(path: string, offset: number): string | undefined {
  try {
    if (!existsSync(path)) {
      return "";
    }
    const bytes = readFileSync(path);
    return (bytes.length >= offset ? bytes.subarray(offset) : bytes).toString("utf8");
  } catch {
    return undefined;
  }
}

function daemonLogPathOf(stateDir: string): string {
  return join(stateDir, "daemon.log");
}

// A daemon is alive when the kernel still knows the pid and it is not a zombie awaiting its reaper.
function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
  } catch (error: unknown) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
  try {
    const stat = readFileSync(`/proc/${String(pid)}/stat`, "utf8");
    return stat.slice(stat.lastIndexOf(")") + 2, stat.lastIndexOf(")") + 3) !== "Z";
  } catch {
    return false;
  }
}

function journalTime(ms: number): string {
  return `${new Date(ms).toISOString().slice(0, 19).replace("T", " ")} UTC`;
}

// ---- Scenario and chain ---------------------------------------------------------------------------------------------------

interface Chain {
  readonly variant: RapidVariant;
  readonly number: number;
  readonly environment: ScenarioEnvironment;
  readonly sandbox: string;
  readonly directory: string;
  closed: boolean;
}

// The one daemon this account runs from the compiled entry. Any other count fails the chain before any signal.
async function onlyDaemonPid(): Promise<number> {
  const listing = await findDaemonPids(inputs(), DAEMON_ENTRY);
  if (!listing.ok) {
    throw new ChainAbort(`listing the daemon processes: ${listing.detail}`);
  }
  const [pid] = listing.pids;
  if (listing.pids.length !== 1 || pid === undefined) {
    throw new ChainAbort(`exactly one daemon process must run from the compiled daemon entry; found ${String(listing.pids.length)}`);
  }
  return pid;
}

// No daemon of this account runs from the compiled entry: a daemon left by an earlier chain is stopped with SIGTERM, outside any
// measured iteration, and must be gone within the exit bound.
async function ensureNoDaemon(): Promise<void> {
  const listing = await findDaemonPids(inputs(), DAEMON_ENTRY);
  if (!listing.ok) {
    throw new ChainAbort(`listing the daemon processes: ${listing.detail}`);
  }
  for (const pid of listing.pids) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // Already gone.
    }
  }
  if (listing.pids.length === 0) {
    return;
  }
  const gone = await pollUntil(
    async () => {
      const again = await findDaemonPids(inputs(), DAEMON_ENTRY);
      return again.ok && again.pids.length === 0 ? { done: true } : { done: false, detail: again.ok ? "a daemon remains" : again.detail };
    },
    { timeoutMs: DAEMON_EXIT_BOUND_MS, intervalMs: 500 },
  );
  if (!gone.ok) {
    throw new ChainAbort(`a daemon left by an earlier chain did not exit: ${gone.detail}`);
  }
}

// The driver unit's main pid, or undefined when no unit is named or the unit has no running main process.
async function driverMainPid(): Promise<number | undefined> {
  if (driverUnit === undefined) {
    return undefined;
  }
  const shown = await hostCall("systemctl", ["--user", "show", "--property=MainPID", "--value", driverUnit]);
  const pid = Number.parseInt(shown.stdout.trim(), 10);
  return shown.exitCode === 0 && Number.isInteger(pid) && pid > 0 ? pid : undefined;
}

// The settle of the control s, and of a chain's start: the driver unit runs no host supervisor, the gateway lists no realm
// sandbox and Podman lists no container for the name, each wait bounded.
async function settleStack(sandbox: string): Promise<void> {
  const steps: readonly { readonly what: string; readonly check: () => Promise<{ readonly done: true } | { readonly done: false; readonly detail: string }> }[] = [
    {
      what: "the driver's host supervisors",
      check: async () => {
        const main = await driverMainPid();
        if (main === undefined) {
          return { done: true };
        }
        const children = await hostCall("ps", ["--ppid", String(main), "-o", "pid="]);
        const count = pidsOfListing(children.stdout).length;
        return children.exitCode === 0 || children.exitCode === 1 ? (count === 0 ? { done: true } : { done: false, detail: `${String(count)} host supervisor(s)` }) : { done: false, detail: unavailable(children) };
      },
    },
    {
      what: "the gateway's realm sandboxes",
      check: async () => {
        const listed = await listRealmSandboxes(inputs());
        return listed.ok ? (listed.items.length === 0 ? { done: true } : { done: false, detail: `${String(listed.items.length)} sandbox(es)` }) : { done: false, detail: listed.detail };
      },
    },
    {
      what: "the session's containers",
      check: async () => {
        const listed = await listSandboxContainers(inputs(), sandbox);
        return listed.ok ? (listed.items.length === 0 ? { done: true } : { done: false, detail: `${String(listed.items.length)} container(s)` }) : { done: false, detail: listed.detail };
      },
    },
  ];
  for (const step of steps) {
    const outcome = await pollUntil(step.check, { timeoutMs: SETTLE_BOUND_MS, intervalMs: SETTLE_POLL_MS });
    if (!outcome.ok) {
      throw new ChainAbort(`the settle did not finish: ${step.what}: ${outcome.detail}`);
    }
  }
}

const openChains = new Set<Chain>();

// The chain's cleanup: realm down, the scenario's directory, the residue wait. Never throws; the caller judges the outcome.
async function endChain(chain: Chain): Promise<PollOutcome> {
  if (chain.closed) {
    return { ok: true, attempts: 0, detail: "" };
  }
  chain.closed = true;
  openChains.delete(chain);
  try {
    return await cleanupScenario(inputs(), chain.environment, []);
  } catch (error: unknown) {
    return { ok: false, attempts: 0, detail: describeError(error) };
  }
}

async function execInSandbox(): Promise<boolean> {
  const live = inputs();
  const executed = await sandboxExec(live, sessionIdFor(live.workspaceRoot), ["cat", "/proc/self/status"]);
  return executed.exitCode === 0;
}

// The evidence of a settled first up of a chain that failed, written before the chain's cleanup removes the scenario: the whole
// request log and daemon log from the offsets taken before the up (the daemon's stderr is in daemon.log, so the AgentOS driver's
// create failure line, which carries the exit code and the stderr of the OpenShell create, is in it), the unit journals and the
// Podman events for the window, and the gateway status. A source that cannot be read is written as an unavailable line.
async function captureChainStart(
  chain: Chain,
  offsets: { readonly request: number; readonly daemon: number },
  sinceMs: number,
): Promise<void> {
  const stateDir = chain.environment.stateDir;
  const untilMs = Date.now();
  const write = (name: string, text: string): void => {
    evidenceFile(chain.directory, `chain-start-${name}`, text);
  };
  write("request-log-slice.log", textFrom(requestLogPath(stateDir), offsets.request) ?? "unavailable: the request log could not be read\n");
  write("daemon-log-slice.log", textFrom(daemonLogPathOf(stateDir), offsets.daemon) ?? "unavailable: the daemon log could not be read\n");
  for (const [suffix, unit] of [
    ["driver-journal.txt", driverUnit],
    ["gateway-journal.txt", gatewayUnit],
  ] as const) {
    if (unit === undefined) {
      write(suffix, "unset\n");
      continue;
    }
    const journal = await hostCall(
      "journalctl",
      ["--user", "--unit", unit, "--since", journalTime(sinceMs - WINDOW_MARGIN_MS), "--until", journalTime(untilMs + 2 * WINDOW_MARGIN_MS), "--output", "short-iso-precise", "--no-pager"],
      JOURNAL_CALL_MS,
    );
    write(suffix, journal.exitCode === 0 ? journal.stdout : unavailable(journal));
  }
  const events = await hostCall(
    "podman",
    ["events", "--since", new Date(sinceMs - WINDOW_MARGIN_MS).toISOString(), "--until", new Date(untilMs + WINDOW_MARGIN_MS).toISOString(), "--stream=false", "--format", "json"],
    JOURNAL_CALL_MS,
  );
  write("podman-events.json", events.exitCode === 0 ? events.stdout : unavailable(events));
  const gateway = await openshellCli(inputs(), ["status"], tmpdir(), HOST_CALL_MS);
  write("gateway-status.txt", gateway.exitCode === 0 ? gateway.stdout : unavailable(gateway));
  write("load.txt", `${String(cpuLoad())}\n`);
}

// Step 1 of a chain: a scenario environment, a settled stack, no daemon, and, for the variants that stop a daemon that holds a
// session (a, b, s), a realm up that reaches active and one scratch exec. Variant c starts every iteration from this settled state.
async function startChain(variant: RapidVariant, number: number): Promise<Chain> {
  const live = inputs();
  const directory = join(evidenceDir, `${variant}-chain${String(number)}`);
  ensureDirectory(directory);
  const environment = createScenarioEnvironment(live, { image: live.image });
  const chain: Chain = { variant, number, environment, sandbox: sandboxNameFor(live.workspaceRoot), directory, closed: false };
  openChains.add(chain);
  await settleStack(chain.sandbox);
  await ensureNoDaemon();
  if (variant === "c") {
    return chain;
  }
  const offsets = { request: fileSize(requestLogPath(environment.stateDir)), daemon: fileSize(daemonLogPathOf(environment.stateDir)) };
  const upStartMs = Date.now();
  const started = await realmCli(live, environment, ["up", "--workspace", live.workspaceRoot], UP_TIMEOUT_MS);
  evidenceFile(directory, "chain-start-up.txt", upText(started));
  if (started.exitCode !== 0) {
    await captureChainStart(chain, offsets, upStartMs);
    throw new ChainStartFailure(chain, classifyUp(upRunOf(started), ""), false);
  }
  const active = await waitForActive(live, environment, ACTIVE_TIMEOUT_MS);
  if (!active.ok || !(await execInSandbox())) {
    await captureChainStart(chain, offsets, upStartMs);
    throw new ChainStartFailure(chain, classifyUp(upRunOf(started), ""), active.ok);
  }
  return chain;
}

// ---- Samplers and load ----------------------------------------------------------------------------------------------------

interface Periodic<T> {
  readonly stop: () => Promise<readonly T[]>;
}

// Takes one sample after another, never two at once, with the given pause between them, until stop() is called. A sample that
// returns undefined is not kept.
function startPeriodic<T>(intervalMs: number, sample: () => Promise<T | undefined>): Periodic<T> {
  const samples: T[] = [];
  const state = { running: true };
  const alive = (): boolean => state.running;
  const loop = (async (): Promise<void> => {
    while (alive()) {
      const taken = await sample();
      if (taken !== undefined) {
        samples.push(taken);
      }
      if (alive()) {
        await sleep(intervalMs);
      }
    }
  })();
  return {
    stop: async () => {
      state.running = false;
      await loop;
      return samples;
    },
  };
}

interface ChildSample extends SupervisorSample {
  readonly text: string;
}
interface ContainerSample {
  readonly atMs: number;
  readonly states: string;
  readonly present: boolean;
}
interface SandboxSample {
  readonly atMs: number;
  readonly ok: boolean;
  readonly names: readonly string[];
}

interface SamplerResults {
  readonly children: readonly ChildSample[];
  readonly containers: readonly ContainerSample[];
  readonly sandboxes: readonly SandboxSample[];
}

interface Samplers {
  readonly stop: () => Promise<SamplerResults>;
}

// The driver unit's child processes (pid, start time, command name) every 100 ms, the session's containers (state only) every
// 250 ms and the gateway's realm sandbox names every 500 ms, each one listing at a time.
function startSamplers(sandbox: string, mainPid: number | undefined): Samplers {
  const live = inputs();
  const label = `label=${OPENSHELL_SANDBOX_NAME_LABEL_KEY}=${sandbox}`;
  const children = startPeriodic<ChildSample>(CHILD_SAMPLE_MS, async () => {
    if (mainPid === undefined) {
      return undefined;
    }
    const listed = await hostCall("ps", ["--ppid", String(mainPid), "-o", "pid=,lstart=,comm="], 10_000);
    return listed.exitCode === 0 || listed.exitCode === 1 ? { atMs: Date.now(), pids: pidsOfListing(listed.stdout), text: listed.stdout } : undefined;
  });
  const containers = startPeriodic<ContainerSample>(CONTAINER_SAMPLE_MS, async () => {
    const listed = await hostCall("podman", ["ps", "-a", "--filter", label, "--format", "{{.State}}"]);
    return listed.exitCode === 0 ? { atMs: Date.now(), states: listed.stdout.trim().split(/\r?\n/).join(","), present: containerStateOf(listed.stdout).present } : undefined;
  });
  const sandboxes = startPeriodic<SandboxSample>(SANDBOX_SAMPLE_MS, async () => {
    const listed = await listRealmSandboxes(live);
    return { atMs: Date.now(), ok: listed.ok, names: listed.ok ? listed.items : [] };
  });
  return {
    stop: async () => ({ children: await children.stop(), containers: await containers.stop(), sandboxes: await sandboxes.stop() }),
  };
}

// One busy node worker per CPU. stop() kills each with SIGKILL and awaits its exit, so no worker outlives the iteration it loaded.
function startLoad(count: number): { readonly stop: () => Promise<void> } {
  const workers: ChildProcess[] = [];
  for (let index = 0; index < count; index += 1) {
    const worker = spawn(process.execPath, ["-e", "for (;;) {}"], { stdio: "ignore", env: {} });
    worker.on("error", () => undefined);
    workers.push(worker);
  }
  return {
    stop: async () => {
      await Promise.all(
        workers.map(
          (worker) =>
            new Promise<void>((resolve) => {
              if (worker.exitCode !== null || worker.signalCode !== null) {
                resolve();
                return;
              }
              worker.once("exit", () => {
                resolve();
              });
              worker.kill("SIGKILL");
            }),
        ),
      );
    },
  };
}

// ---- The stop, the up and the evidence of one iteration ------------------------------------------------------------------

function upText(result: CommandResult): string {
  const exit = result.exitCode === undefined ? `no exit (${result.failure ?? "unknown"})` : `exit ${String(result.exitCode)}`;
  return `${exit}\n--- stdout\n${result.stdout}\n--- stderr\n${result.stderr}\n`;
}

function upRunOf(result: CommandResult): UpRun {
  return { exitCode: result.exitCode, timedOut: result.failure === "timeout", stdout: result.stdout, stderr: result.stderr };
}

interface UpPhase {
  readonly startMs: number;
  readonly endMs: number;
  readonly finishedMs: number;
  readonly result: CommandResult;
  readonly statusText: string;
  readonly active: boolean;
  readonly execOk: boolean;
  readonly outcome: UpOutcome;
}

// The immediate up after a stop: realm up, one realm status for the notice, then, when the up exited 0, the wait for active and one
// exec. Nothing is waited for before the up starts.
async function upPhase(chain: Chain): Promise<UpPhase> {
  const live = inputs();
  const startMs = Date.now();
  const result = await realmCli(live, chain.environment, ["up", "--workspace", live.workspaceRoot], UP_TIMEOUT_MS);
  const endMs = Date.now();
  const status = await realmCliWithWorkspace(live, chain.environment, ["status"], live.workspaceRoot, 30_000);
  let active = false;
  let execOk = false;
  if (result.exitCode === 0) {
    active = (await waitForActive(live, chain.environment, ACTIVE_TIMEOUT_MS)).ok;
    execOk = active && (await execInSandbox());
  }
  return { startMs, endMs, finishedMs: Date.now(), result, statusText: status.stdout, active, execOk, outcome: classifyUp(upRunOf(result), status.stdout) };
}

interface Marks {
  readonly signalMs: number;
  readonly exitMs: number | null;
  // Set for variant c: the first, interrupted up.
  readonly firstUp?: { readonly startMs: number; readonly endMs: number };
  readonly up: { readonly startMs: number; readonly endMs: number } | null;
  readonly finishedMs: number;
}

interface Captured {
  readonly requestSlice: string | undefined;
  readonly daemonSlice: string | undefined;
  readonly lateAfterExit: number | null;
  readonly lateAfterNextUp: number | null;
}

// Reads every source for the iteration's window and writes the files: the log slices (whole), the journals, the Podman events, the
// samples and the merged timeline. A source that cannot be read is written as an unavailable line. Nothing here fails the
// iteration. Reads that touch the stack run after the race is over.
async function captureIteration(
  chain: Chain,
  iteration: number,
  marks: Marks,
  offsets: { readonly request: number; readonly daemon: number; readonly daemonBeforeFirstUp: number | undefined },
  samples: SamplerResults,
  stop: StopClass,
): Promise<Captured> {
  const stateDir = chain.environment.stateDir;
  const name = (suffix: string): string => `i${String(iteration).padStart(3, "0")}-${suffix}`;
  const write = (suffix: string, text: string): void => {
    evidenceFile(chain.directory, name(suffix), text);
  };
  const sinceMs = marks.signalMs - WINDOW_MARGIN_MS;
  const untilMs = marks.finishedMs + WINDOW_MARGIN_MS;

  const requestSlice = textFrom(requestLogPath(stateDir), offsets.request);
  const daemonSlice = textFrom(daemonLogPathOf(stateDir), offsets.daemon);
  write("request-log-slice.log", requestSlice ?? "unavailable: the request log could not be read\n");
  write("daemon-log-slice.log", daemonSlice ?? "unavailable: the daemon log could not be read\n");
  if (offsets.daemonBeforeFirstUp !== undefined) {
    write("daemon-log-from-first-up.log", textFrom(daemonLogPathOf(stateDir), offsets.daemonBeforeFirstUp) ?? "unavailable: the daemon log could not be read\n");
  }

  for (const [suffix, unit] of [
    ["driver-journal.txt", driverUnit],
    ["gateway-journal.txt", gatewayUnit],
  ] as const) {
    if (unit === undefined) {
      write(suffix, "unset\n");
      continue;
    }
    const journal = await hostCall(
      "journalctl",
      ["--user", "--unit", unit, "--since", journalTime(sinceMs), "--until", journalTime(untilMs + 1_000), "--output", "short-iso-precise", "--no-pager"],
      JOURNAL_CALL_MS,
    );
    write(suffix, journal.exitCode === 0 ? journal.stdout : unavailable(journal));
  }

  const events = await hostCall(
    "podman",
    ["events", "--since", new Date(sinceMs).toISOString(), "--until", new Date(untilMs).toISOString(), "--stream=false", "--format", "json"],
    JOURNAL_CALL_MS,
  );
  write("podman-events.json", events.exitCode === 0 ? events.stdout : unavailable(events));
  const gateway = await openshellCli(inputs(), ["status"], tmpdir(), HOST_CALL_MS);
  write("gateway-status-after.txt", gateway.exitCode === 0 ? gateway.stdout : unavailable(gateway));

  const relative = (atMs: number): string => `+${String(atMs - marks.signalMs)}ms`;
  write("samples-children.txt", driverUnit === undefined ? "unset\n" : samples.children.map((sample) => `${relative(sample.atMs)} ${sample.text.trim().replace(/\r?\n/g, " | ")}`).join("\n").concat("\n"));
  write("samples-containers.txt", samples.containers.map((sample) => `${relative(sample.atMs)} ${sample.states === "" ? "(none)" : sample.states}`).join("\n").concat("\n"));
  write("samples-sandboxes.txt", samples.sandboxes.map((sample) => `${relative(sample.atMs)} ${sample.ok ? (sample.names.join(",") === "" ? "(none)" : sample.names.join(",")) : "list failed"}`).join("\n").concat("\n"));
  write("windows.txt", marks.up === null ? "the up did not run\n" : `up window ${relative(marks.up.startMs)} to ${relative(marks.up.endMs)}\n`);

  // The supervisors of the previous sandbox that outlive the stop (M1), from the child samples.
  const lifespans = supervisorLifespans(samples.children);
  const late = marks.exitMs === null || driverUnit === undefined ? undefined : lateSupervisors(lifespans, marks.exitMs, marks.up?.startMs ?? marks.exitMs);

  const timeline = mergeTimeline([
    timelineOfMarks(marks, stop),
    startupRowsOf(daemonSlice ?? "").map((row): TimelineEvent => ({ source: "daemon", atMs: row.atMs, event: "startup-row", detail: `containersRemoved ${String(row.containersRemoved)}` })),
    stopRowEvents(requestSlice, marks.signalMs),
    lifespans.flatMap((span): TimelineEvent[] => [
      { source: "driver-children", atMs: span.firstMs, event: "supervisor-first-seen", detail: `pid ${String(span.pid)}` },
      { source: "driver-children", atMs: span.lastMs, event: "supervisor-last-seen", detail: `pid ${String(span.pid)}` },
    ]),
    containerEvents(samples.containers),
    sandboxEvents(samples.sandboxes),
  ]);
  write("timeline.txt", timeline.map((event) => `${relative(event.atMs)} ${event.source} ${event.event}${event.detail === undefined ? "" : ` ${event.detail}`}`).join("\n").concat("\n"));

  return { requestSlice, daemonSlice, lateAfterExit: late === undefined ? null : late.afterDaemonExit.length, lateAfterNextUp: late === undefined ? null : late.afterNextUpStart.length };
}

function timelineOfMarks(marks: Marks, stop: StopClass): readonly TimelineEvent[] {
  const events: TimelineEvent[] = [{ source: "harness", atMs: marks.signalMs, event: "signal" }];
  if (marks.exitMs !== null) {
    events.push({ source: "harness", atMs: marks.exitMs, event: "daemon-exit", detail: `stop ${stop.kind}` });
  }
  if (marks.firstUp !== undefined) {
    events.push({ source: "harness", atMs: marks.firstUp.startMs, event: "first-up-start" }, { source: "harness", atMs: marks.firstUp.endMs, event: "first-up-end" });
  }
  if (marks.up !== null) {
    events.push({ source: "harness", atMs: marks.up.startMs, event: "up-start" }, { source: "harness", atMs: marks.up.endMs, event: "up-end" });
  }
  return events;
}

function stopRowEvents(requestSlice: string | undefined, signalMs: number): readonly TimelineEvent[] {
  if (requestSlice === undefined) {
    return [];
  }
  return stopRecordsOf(requestSlice, new Date(signalMs).toISOString()).map((record): TimelineEvent => ({
    source: "daemon",
    atMs: Date.parse(record.ts),
    event: record.event === "daemon.stopping" ? "stopping-row" : "stopped-row",
  }));
}

// The first sample with a container, and the first sample after it with none.
function containerEvents(samples: readonly ContainerSample[]): readonly TimelineEvent[] {
  const events: TimelineEvent[] = [];
  const first = samples.find((sample) => sample.present);
  if (first !== undefined) {
    events.push({ source: "podman", atMs: first.atMs, event: "container-first-seen" });
    const gone = samples.find((sample) => sample.atMs > first.atMs && !sample.present);
    if (gone !== undefined) {
      events.push({ source: "podman", atMs: gone.atMs, event: "container-gone" });
    }
  }
  return events;
}

// Every change of the gateway's realm sandbox list between two samples: a name listed, a name no longer listed.
function sandboxEvents(samples: readonly SandboxSample[]): readonly TimelineEvent[] {
  const events: TimelineEvent[] = [];
  let previous: ReadonlySet<string> | undefined;
  for (const sample of samples) {
    if (!sample.ok) {
      continue;
    }
    const current = new Set(sample.names);
    for (const listed of current) {
      if (previous?.has(listed) === false) {
        events.push({ source: "gateway", atMs: sample.atMs, event: "sandbox-listed" });
      }
    }
    for (const listed of previous ?? []) {
      if (!current.has(listed)) {
        events.push({ source: "gateway", atMs: sample.atMs, event: "sandbox-unlisted" });
      }
    }
    previous = current;
  }
  return events;
}

// What an iteration observed, as the record plus the state the next iteration starts from. kinds are filled by the caller.
type Observed = Omit<IterationRecord, "kinds" | "variant" | "chain" | "iteration">;

function startupSeenFrom(daemonText: string | undefined, signalMs: number): boolean | null {
  return daemonText === undefined ? null : startupSeenAt(startupRowsOf(daemonText), signalMs);
}

function reapOf(daemonSlice: string | undefined, exitMs: number | null): number | null {
  return daemonSlice === undefined || exitMs === null ? null : reapRemovedAfter(startupRowsOf(daemonSlice), exitMs);
}

// Sends SIGTERM and waits for the daemon's pid to be gone, polling every 50 ms. The instant it is gone the caller runs the up.
async function stopDaemon(pid: number): Promise<{ readonly signalMs: number; readonly exitMs: number | null }> {
  const signalMs = Date.now();
  try {
    process.kill(pid, "SIGTERM");
  } catch (error: unknown) {
    throw new ChainAbort("the signal could not be sent to the daemon", { cause: error });
  }
  const gone = await pollUntil(() => Promise.resolve(pidAlive(pid) ? { done: false, detail: "the daemon is alive" } : { done: true }), {
    timeoutMs: DAEMON_EXIT_BOUND_MS,
    intervalMs: DAEMON_EXIT_POLL_MS,
  });
  return { signalMs, exitMs: gone.ok ? Date.now() : null };
}

// Variants a, b and s: the stop of the chain's daemon, then the immediate up (after the settle, in s).
async function iterateAfterStop(chain: Chain, iteration: number): Promise<Observed> {
  const live = inputs();
  const stateDir = chain.environment.stateDir;
  const pid = await onlyDaemonPid();
  const offsets = { request: fileSize(requestLogPath(stateDir)), daemon: fileSize(daemonLogPathOf(stateDir)), daemonBeforeFirstUp: undefined };
  const mainPid = await driverMainPid();
  const gatewayBefore = await openshellCli(live, ["status"], tmpdir(), HOST_CALL_MS);
  evidenceFile(chain.directory, `i${String(iteration).padStart(3, "0")}-gateway-status-before.txt`, gatewayBefore.exitCode === 0 ? gatewayBefore.stdout : unavailable(gatewayBefore));
  const loadBefore = cpuLoad();
  const load = chain.variant === "b" ? startLoad(loadWorkers(cpus().length)) : undefined;
  const samplers = startSamplers(chain.sandbox, mainPid);
  let stopped: { readonly signalMs: number; readonly exitMs: number | null };
  let phase: UpPhase | undefined;
  try {
    stopped = await stopDaemon(pid);
    if (stopped.exitMs !== null) {
      if (chain.variant === "s") {
        await settleStack(chain.sandbox);
      }
      phase = await upPhase(chain);
    }
  } catch (error: unknown) {
    await samplers.stop();
    throw error;
  } finally {
    await load?.stop();
  }
  const loadAfter = cpuLoad();
  const samples = await samplers.stop();
  const { signalMs, exitMs } = stopped;
  const finishedMs = phase?.finishedMs ?? Date.now();
  const marks: Marks = { signalMs, exitMs, up: phase === undefined ? null : { startMs: phase.startMs, endMs: phase.endMs }, finishedMs };
  // The stop is read from the request log once the window is over; the log is complete by then.
  const requestSlice = textFrom(requestLogPath(stateDir), offsets.request);
  const records = requestSlice === undefined ? undefined : stopRecordsOf(requestSlice, new Date(signalMs).toISOString());
  const stop: StopClass = exitMs === null ? { kind: "not-exited" } : classifyStop(records, signalMs, null);
  const captured = await captureIteration(chain, iteration, marks, offsets, samples, stop);
  if (phase !== undefined) {
    evidenceFile(chain.directory, `i${String(iteration).padStart(3, "0")}-up-output.txt`, upText(phase.result));
    evidenceFile(chain.directory, `i${String(iteration).padStart(3, "0")}-status-after-up.txt`, phase.statusText);
  }
  return {
    up: phase?.outcome ?? { kind: "not-run", notice: false },
    interruptedUp: undefined,
    down: undefined,
    active: phase?.active ?? false,
    execOk: phase?.execOk ?? false,
    stop,
    stopMs: exitMs === null ? null : exitMs - signalMs,
    gapToUpMs: exitMs === null || phase === undefined ? null : phase.startMs - exitMs,
    upMs: phase === undefined ? null : phase.endMs - phase.startMs,
    containersRemoved: reapOf(captured.daemonSlice, exitMs),
    startupSeen: null,
    lateAfterExit: captured.lateAfterExit,
    lateAfterNextUp: captured.lateAfterNextUp,
    loadBefore,
    loadAfter,
  };
}

// Variant c: a realm up that has started and not finished is interrupted by SIGTERM 3 s after the daemon appeared, then the
// immediate second up must reach active. The state is settled and no daemon runs when the first up starts.
async function iterateMidUp(chain: Chain, iteration: number): Promise<Observed> {
  const live = inputs();
  const stateDir = chain.environment.stateDir;
  const files = (suffix: string): string => `i${String(iteration).padStart(3, "0")}-${suffix}`;
  await ensureNoDaemon();
  await settleStack(chain.sandbox);
  const offsets = { request: fileSize(requestLogPath(stateDir)), daemon: fileSize(daemonLogPathOf(stateDir)), daemonBeforeFirstUp: fileSize(daemonLogPathOf(stateDir)) };
  const mainPid = await driverMainPid();
  const loadBefore = cpuLoad();
  const firstUpStartMs = Date.now();
  // The first up is started and not awaited: it is the request the stop interrupts. realmCli never rejects.
  const firstUp = realmCli(live, chain.environment, ["up", "--workspace", live.workspaceRoot], UP_TIMEOUT_MS);
  let signalMs: number;
  let stoppedAt: { readonly signalMs: number; readonly exitMs: number | null } | undefined;
  let samplers: Samplers | undefined;
  let firstResult: CommandResult | undefined;
  let firstUpEndMs: number;
  let phase: UpPhase | undefined;
  try {
    const found = await pollUntil(
      async () => {
        const listing = await findDaemonPids(live, DAEMON_ENTRY);
        return listing.ok && listing.pids.length === 1 ? { done: true } : { done: false, detail: listing.ok ? `${String(listing.pids.length)} daemon(s)` : listing.detail };
      },
      { timeoutMs: DAEMON_APPEAR_BOUND_MS, intervalMs: DAEMON_APPEAR_POLL_MS },
    );
    if (!found.ok) {
      throw new ChainAbort(`exactly one daemon must run during the up: ${found.detail}`);
    }
    await sleep(MID_UP_DELAY_MS);
    const pid = await onlyDaemonPid();
    samplers = startSamplers(chain.sandbox, mainPid);
    stoppedAt = await stopDaemon(pid);
    signalMs = stoppedAt.signalMs;
    // The interrupted up's own exit is recorded, not judged.
    firstResult = await firstUp;
    firstUpEndMs = Date.now();
    evidenceFile(chain.directory, files("first-up-output.txt"), upText(firstResult));
    evidenceFile(chain.directory, files("first-up-window.txt"), `first up from ${String(firstUpStartMs - signalMs)}ms to ${String(firstUpEndMs - signalMs)}ms relative to the signal\n`);
    if (stoppedAt.exitMs !== null) {
      phase = await upPhase(chain);
    }
  } catch (error: unknown) {
    // The first up must not outlive the iteration that started it.
    await firstUp;
    await samplers?.stop();
    throw error;
  }
  const loadAfter = cpuLoad();
  const samples = await samplers.stop();
  const exitMs = stoppedAt.exitMs;
  const marks: Marks = {
    signalMs,
    exitMs,
    firstUp: { startMs: firstUpStartMs, endMs: firstUpEndMs },
    up: phase === undefined ? null : { startMs: phase.startMs, endMs: phase.endMs },
    finishedMs: phase?.finishedMs ?? firstUpEndMs,
  };
  const requestSlice = textFrom(requestLogPath(stateDir), offsets.request);
  const records = requestSlice === undefined ? undefined : stopRecordsOf(requestSlice, new Date(signalMs).toISOString());
  // Whether the daemon's startup report was already written when the signal arrived: the answer to OBS-C (a signal during startup
  // meets the default disposition and writes no stop row).
  const startupSeen = startupSeenFrom(textFrom(daemonLogPathOf(stateDir), offsets.daemonBeforeFirstUp), signalMs);
  const stop: StopClass = exitMs === null ? { kind: "not-exited" } : classifyStop(records, signalMs, startupSeen);
  const captured = await captureIteration(chain, iteration, marks, offsets, samples, stop);
  if (phase !== undefined) {
    evidenceFile(chain.directory, files("up-output.txt"), upText(phase.result));
    evidenceFile(chain.directory, files("status-after-up.txt"), phase.statusText);
  }
  const observed: Observed = {
    up: phase?.outcome ?? { kind: "not-run", notice: false },
    interruptedUp: classifyUp(upRunOf(firstResult), ""),
    down: undefined,
    active: phase?.active ?? false,
    execOk: phase?.execOk ?? false,
    stop,
    stopMs: exitMs === null ? null : exitMs - signalMs,
    gapToUpMs: exitMs === null || phase === undefined ? null : phase.startMs - exitMs,
    upMs: phase === undefined ? null : phase.endMs - phase.startMs,
    containersRemoved: reapOf(captured.daemonSlice, exitMs),
    startupSeen,
    lateAfterExit: captured.lateAfterExit,
    lateAfterNextUp: captured.lateAfterNextUp,
    loadBefore,
    loadAfter,
  };
  // Whatever the outcome, the scenario is brought down and must leave nothing, so the next iteration starts settled. A down that
  // fails with a product code or at its bound is a failure of its own kind (kept, counted, its output written), never a host stop;
  // only residue left after the down is a host reason.
  const down = await realmCliWithWorkspace(live, chain.environment, ["down"], live.workspaceRoot, DOWN_TIMEOUT_MS);
  evidenceFile(chain.directory, files("down-output.txt"), upText(down));
  const residue = await waitForNoResidue(live, [chain.sandbox]);
  if (!residue.ok) {
    throw new ChainAbort(`residue after realm down: ${residue.detail}`);
  }
  return { ...observed, down: classifyUp(upRunOf(down), "") };
}

// ---- Window state and evidence --------------------------------------------------------------------------------------------

const results = new Map<RapidVariant, VariantResult>();
const hostStops: string[] = [];

function setResult(variant: RapidVariant, state: ChainState, ended: VariantEnd): void {
  results.set(variant, { variant, state, ended });
}

function failuresInMainVariants(): number {
  return [...results.values()].filter((result) => result.variant !== "s").reduce((sum, result) => sum + result.state.failures.length, 0);
}

// A fact line: a key and a plain value (a commit, a version). Anything that could hold a path or an id fails the test.
function fact(key: string, value: string): string {
  if (!/^[0-9A-Za-z.+-]{1,64}$/.test(value)) {
    throw new RangeError(`fact ${key} is not a plain value`);
  }
  return `${key}=${value}`;
}

async function commitOfTree(): Promise<string> {
  const repository = fileURLToPath(new URL("../../../", import.meta.url));
  const head = await runCommand("git", ["rev-parse", "HEAD"], { env: inputs().hostEnvironment, timeoutMs: HOST_CALL_MS, cwd: repository });
  const text = head.stdout.trim();
  return head.exitCode === 0 && /^[0-9a-f]{40}$/.test(text) ? text : "unknown";
}

function cliVersion(): string {
  try {
    const parsed: unknown = JSON.parse(readFileSync(PACKAGE_JSON, "utf8"));
    const version: unknown = typeof parsed === "object" && parsed !== null ? Reflect.get(parsed, "version") : undefined;
    return typeof version === "string" && /^[0-9A-Za-z.+-]{1,64}$/.test(version) ? version : "unknown";
  } catch {
    return "unknown";
  }
}

let factLines: readonly string[] = [];
let controlLine = "";

// Rewrites the summary after every iteration, so an interrupted window leaves its counts. The outcome word is provisional until
// the line final=yes.
function writeSummary(final: boolean): void {
  const window = windowOutcome([...results.values()]);
  const text = [
    summaryOf(window).trimEnd(),
    controlLine,
    ...factLines,
    ...hostStops.map((reason, index) => evidenceLine({ hostStop: index + 1, reason })),
    evidenceLine({ final }),
    "",
  ]
    .filter((line, index, all) => line !== "" || index === all.length - 1)
    .join("\n");
  evidenceFile(evidenceDir, "summary.txt", text);
}

// ---- The variants ---------------------------------------------------------------------------------------------------------

const VARIANT_TITLES: Readonly<Record<RapidVariant, string>> = {
  a: "stop then immediate up, no settle",
  b: "the same under CPU load",
  c: "a stop in the middle of an up, then the immediate up",
  s: "the control: the same as a with a settle before each up",
};

// Runs one variant's chains to its target, its failure cap or a host stop. A failing iteration is kept and a new chain starts;
// nothing is retried. A thrown error ends the variant as a host stop after its cleanup and is rethrown so the subtest fails.
async function runVariant(t: TestContext, variant: RapidVariant): Promise<void> {
  let state = newChainState(variant, targetOf(variant, iterations), maxFailures);
  setResult(variant, state, "host");
  let action: ChainAction = "restart-chain";
  let chainNumber = 0;
  t.after(async () => {
    for (const chain of [...openChains]) {
      await endChain(chain);
    }
  });
  while (action === "restart-chain") {
    chainNumber += 1;
    let chain: Chain | undefined;
    let failure: unknown;
    let startFailure: ChainStartFailure | undefined;
    try {
      chain = await startChain(variant, chainNumber);
      action = "continue";
      while (action === "continue") {
        const iteration = state.iterations + 1;
        const observed = variant === "c" ? await iterateMidUp(chain, iteration) : await iterateAfterStop(chain, iteration);
        const step = chainStep(state, observed);
        state = step.state;
        action = step.action;
        const record: IterationRecord = { ...observed, variant, chain: chainNumber, iteration, kinds: failureKindsOf(observed) };
        const line = iterationEvidenceLine(record);
        appendFileSync(join(evidenceDir, "iterations.txt"), `${line}\n`, { mode: 0o600 });
        t.diagnostic(line);
        setResult(variant, state, action === "variant-done-clean" ? "target" : action === "variant-done-failed" ? "failure-cap" : "host");
        writeSummary(false);
      }
    } catch (error: unknown) {
      if (error instanceof ChainStartFailure) {
        startFailure = error;
        chain = error.chain;
      } else {
        failure = error;
      }
    }
    const cleaned = chain === undefined ? undefined : await endChain(chain);
    if (startFailure !== undefined) {
      // The settled first up of the chain failed: kept and counted as a failure of its own kind (never as a reproduction), the
      // chain is cleaned, and a new chain starts unless the failure cap is reached.
      const step = recordChainStartFailure(state);
      state = step.state;
      action = step.action;
      const line = chainStartEvidenceLine(variant, chainNumber, startFailure.up, startFailure.active);
      appendFileSync(join(evidenceDir, "iterations.txt"), `${line}\n`, { mode: 0o600 });
      t.diagnostic(line);
      setResult(variant, state, action === "variant-done-failed" ? "failure-cap" : "host");
      writeSummary(false);
    }
    if (failure !== undefined) {
      hostStops.push(failure instanceof ChainAbort ? "chain-abort" : "harness-error");
      evidenceFile(evidenceDir, `${variant}-chain${String(chainNumber)}-host-stop.txt`, `${describeError(failure)}\n`);
      writeSummary(false);
      throw failure instanceof ChainAbort ? failure : new ChainAbort("the chain failed", { cause: failure });
    }
    if (cleaned !== undefined && !cleaned.ok) {
      hostStops.push("residue-after-cleanup");
      evidenceFile(evidenceDir, `${variant}-chain${String(chainNumber)}-host-stop.txt`, `residue after the chain's cleanup: ${cleaned.detail}\n`);
      writeSummary(false);
      throw new ChainAbort(`residue after the chain's cleanup: ${cleaned.detail}`);
    }
  }
}

// ---- The test -------------------------------------------------------------------------------------------------------------

void test(
  "rapid stop then up live: a chain of SIGTERM-then-up on one sandbox name with no settle, variants a, b, c and the control s",
  { skip: gate, timeout: TOTAL_TIMEOUT_MS },
  async (t) => {
    ensureDirectory(evidenceDir);
    const live = inputs();
    const commit = await commitOfTree();
    factLines = [
      fact("commit", commit),
      fact("node", process.version),
      fact("cliVersion", cliVersion()),
      evidenceLine({
        cpuCount: cpus().length,
        loadWorkers: loadWorkers(cpus().length),
        iterationTarget: iterations,
        failureCap: maxFailures,
        stopPollMs: DAEMON_EXIT_POLL_MS,
        childSampleMs: CHILD_SAMPLE_MS,
        containerSampleMs: CONTAINER_SAMPLE_MS,
        sandboxSampleMs: SANDBOX_SAMPLE_MS,
        midUpDelayMs: MID_UP_DELAY_MS,
        driverUnit: driverUnit !== undefined,
        gatewayUnit: gatewayUnit !== undefined,
        loadAtStart: cpuLoad(),
      }),
    ];
    // The facts that may hold an id or a path stay in a file of their own, outside the summary.
    evidenceFile(evidenceDir, "facts.txt", `image ${live.image}\npodman ${probe.kind === "output" ? probe.stdout.trim() : probe.kind}\n`);
    writeSummary(false);

    let halted = false;
    for (const variant of mainVariants) {
      if (halted) {
        break;
      }
      await t.test(`variant ${variant}: ${VARIANT_TITLES[variant]}`, { timeout: variantTimeoutMs(variant) }, async (sub) => {
        try {
          await runVariant(sub, variant);
        } catch (error: unknown) {
          halted = true;
          throw error;
        }
      });
      if (results.get(variant)?.ended === "host") {
        halted = true;
      }
    }
    const control = controlDecision(rawVariants, failuresInMainVariants());
    controlLine = evidenceLine({ control: control.run && !halted ? "run" : "skipped", reason: halted ? "window-halted" : control.reason });
    writeSummary(false);
    if (control.run && !halted) {
      await t.test(`variant s: ${VARIANT_TITLES["s"]}`, { timeout: variantTimeoutMs("s") }, async (sub) => {
        await runVariant(sub, "s");
      });
    }
    writeSummary(true);

    const window = windowOutcome([...results.values()]);
    t.diagnostic(`window outcome ${window.outcome}`);
    const unfinished = [...results.values()].filter((result) => result.ended === "host" || result.state.failures.length > 0);
    assert.equal(unfinished.length, 0, `${window.outcome}: ${unfinished.map((result) => `${result.variant} ${result.ended} ${String(result.state.failures.length)} failure(s)`).join(", ")}; the evidence is in the evidence directory`);
  },
);

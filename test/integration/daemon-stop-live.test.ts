// Gated live test of the daemon stop (Phase 41, TEAR-01 and TEAR-02).
//
// A real daemon that holds a real sandbox container is stopped with SIGTERM, the way a service manager or a Ctrl-C stops it, and
// the test requires what the daemon reported and what it left behind to be clean. The stop under test is never `realm down`: a
// down empties the registry first, so the daemon would then stop with nothing to tear down and report failedTeardowns 0 whatever
// the stages do. Only a signal reaches the stop path (closeEverything) with a live session in the registry.
//
// Variants (REALM_LIVE_STOP_VARIANTS, a comma list over a, b and c; default all three):
//   a  stop after a scratch session, repeated REALM_LIVE_STOP_REPEATS times (1 to 20, default 5). Acceptance: every iteration
//      reports daemon.stopped with failedTeardowns 0 and no code, the session's container and sandbox gone, and zero residue.
//   b  the same under CPU load (one busy node worker per CPU for the duration of the stop), min(3, repeats) times. Same acceptance.
//   c  a stop in the middle of an up, min(3, repeats) times, alternating the signal point between the first appearance of the
//      session's container and 3 s after the up began. An observation: it records what daemon.stopped said and asserts only
//      that the daemon exited inside the bound and that the next up reaches active.
// Each iteration writes one JSON line of figures to <REALM_STOP_EVIDENCE_DIR>/iterations.jsonl (mode 0600) and rewrites
// summary.txt; no path, environment value or container id is written. The daemon's stop rows are read from the request log
// (<stateDir>/requests.log), where the daemon's lifecycle lines go in production.
//
// Gate. The whole file is one test that skips, with a reason that names the first missing prerequisite, unless the production
// gate of production-driver.test.ts opens (REALM_LIVE_PRODUCTION=1, Podman 5.x, the image, the driver config and socket, the
// rootless Podman socket, the openshell CLI, the built CLI) and, in addition, REALM_LIVE_STOP=1 (an operator opt-in the test never
// sets), REALM_STOP_EVIDENCE_DIR names an existing absolute directory and the variant list is valid.
//
// Preconditions the test cannot check and the operator must provide: the same as production-driver.test.ts (gateway and compute
// driver running under the realm account, the pinned workspace root empty, no other live sandbox, no other container in the
// account's Podman), and one live run at a time on the shared stack. No iteration is retried: a failing iteration stops its
// variant, after the cleanup, with its first failing reason and its timeline. This file imports nothing that Phase 41 added to src.

import { spawn, type ChildProcess } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
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
  listSandboxContainers,
  listSandboxesNamed,
  onPath,
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
  type LiveInputs,
  type ScenarioEnvironment,
} from "../support/production-live.js";
import {
  LIVE_STOP_REPEATS_VARIABLE,
  LIVE_STOP_VARIANTS_VARIABLE,
  STOP_EVIDENCE_DIR_VARIABLE,
  containerStateOf,
  daemonStopSkipReason,
  evidenceLineOf,
  evidenceText,
  iterationVerdict,
  loadPerCpu,
  loadWorkers,
  parseRepeats,
  parseVariants,
  stageTimeline,
  stopRecordsOf,
  stoppedVerdictOf,
  type ContainerSample,
  type IterationRecord,
  type IterationResult,
  type Variant,
} from "../support/daemon-stop-live.js";

// The compiled CLI and the compiled daemon entry beside the compiled tests (dist/src/cli/main.js, dist/src/daemon/main.js).
const CLI_PATH = fileURLToPath(new URL("../../src/cli/main.js", import.meta.url));
const DAEMON_ENTRY = fileURLToPath(new URL("../../src/daemon/main.js", import.meta.url));

const probe = await probePodman();
const gate = daemonStopSkipReason({
  env: process.env,
  podman: probe,
  isSocket,
  onPath: (name) => onPath(name, process.env["PATH"]),
  exists: existsSync,
  isDirectory,
  cliPath: CLI_PATH,
});
const live: LiveInputs | undefined = gate === false ? readLiveInputs(process.env, CLI_PATH) : undefined;
const repeats = parseRepeats(process.env[LIVE_STOP_REPEATS_VARIABLE]);
const parsedVariants = parseVariants(process.env[LIVE_STOP_VARIANTS_VARIABLE]);
const variants: readonly Variant[] = gate === false && parsedVariants.ok ? parsedVariants.variants : [];
const evidenceDir = process.env[STOP_EVIDENCE_DIR_VARIABLE] ?? "";

function inputs(): LiveInputs {
  if (live === undefined) {
    throw new Error("the daemon stop live test ran although its gate is closed");
  }
  return live;
}

// ---- Bounds --------------------------------------------------------------------------------------------------------------

// realm up has its own 200 s startup budget; this bounds one CLI call, and the variant timeout still caps the sum.
const UP_TIMEOUT_MS = 240_000;
const ACTIVE_TIMEOUT_MS = 120_000;
const DOWN_TIMEOUT_MS = 120_000;
// The bound on the daemon's exit after SIGTERM: the 5 s drain of other requests, plus the teardown bound of one session (60 s,
// TEARDOWN_TIMEOUT_MS on the fixed build, 30 s on the build before it), plus a 25 s margin for the signal handler, the log
// flush and the process exit. A daemon still alive after it did not stop inside any bound the product states.
const DAEMON_EXIT_BOUND_MS = 90_000;
const DAEMON_EXIT_POLL_MS = 200;
// The container-state sampler lists the session's containers this often, one listing at a time.
const SAMPLE_INTERVAL_MS = 250;
// The sampler keeps running this long after the daemon has exited.
const SAMPLE_AFTER_EXIT_MS = 10_000;
// The session's container and sandbox must be gone this long after the daemon has exited.
const GONE_AFTER_EXIT_MS = 5_000;
const GONE_POLL_MS = 500;
// Variant c: the second signal point, and the bounds on reaching either point and on the daemon being found.
const MID_UP_DELAY_MS = 3_000;
const MID_UP_CONTAINER_BOUND_MS = 120_000;
const DAEMON_APPEAR_BOUND_MS = 30_000;
// One repeat of a variant takes at most this long (an up, a stop, the 10 s of sampling and the residue wait).
const PER_REPEAT_TIMEOUT_MS = 7 * 60_000;

// The repeat counts by variant: a uses all of them, b and c use at most three.
function repeatsOf(variant: Variant): number {
  return variant === "a" ? repeats : Math.min(3, repeats);
}

const VARIANT_TITLES: Readonly<Record<Variant, string>> = {
  a: "a stop after a scratch session leaves no failed teardown, no container and no residue",
  b: "the same stop under CPU load leaves no failed teardown, no container and no residue",
  c: "a stop in the middle of an up exits inside the bound and the next up reaches active (observation)",
};

// ---- Helpers over the stack ----------------------------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

interface Context {
  readonly inputs: LiveInputs;
  readonly environment: ScenarioEnvironment;
  readonly sandbox: string;
}

function startScenario(t: TestContext): Context {
  const liveInputs = inputs();
  const environment = createScenarioEnvironment(liveInputs, { image: liveInputs.image });
  // The hook runs even when the body failed, so a failing iteration leaves no sandbox, record or state behind.
  t.after(async () => {
    const outcome = await cleanupScenario(liveInputs, environment, []);
    assert.ok(outcome.ok, `residue after the scenario's cleanup: ${outcome.detail}`);
  });
  return { inputs: liveInputs, environment, sandbox: sandboxNameFor(liveInputs.workspaceRoot) };
}

// realm up for the pinned workspace exits 0 and realm status reaches active.
async function upActive(ctx: Context): Promise<void> {
  const started = await realmCli(ctx.inputs, ctx.environment, ["up", "--workspace", ctx.inputs.workspaceRoot], UP_TIMEOUT_MS);
  assert.equal(started.exitCode, 0, `realm up: ${describeResult(started)}`);
  const active = await waitForActive(ctx.inputs, ctx.environment, ACTIVE_TIMEOUT_MS);
  assert.ok(active.ok, `realm status must reach active: ${active.detail}`);
}

// The one daemon this account runs from the compiled entry. Any other count is a failed precondition.
async function onlyDaemonPid(ctx: Context): Promise<number> {
  const listing = await findDaemonPids(ctx.inputs, DAEMON_ENTRY);
  if (!listing.ok) {
    assert.fail(`listing the daemon processes: ${listing.detail}`);
  }
  assert.equal(listing.pids.length, 1, `exactly one daemon process must run from the compiled daemon entry; found ${String(listing.pids.length)}`);
  const [pid] = listing.pids;
  assert.ok(pid !== undefined, "the daemon pid");
  return pid;
}

// The container state of the session's sandbox, or undefined when the listing failed (that sample is skipped).
async function sampleContainer(liveInputs: LiveInputs, sandbox: string): Promise<{ readonly present: boolean; readonly running: boolean } | undefined> {
  const label = `label=${OPENSHELL_SANDBOX_NAME_LABEL_KEY}=${sandbox}`;
  const result = await runCommand("podman", ["ps", "-a", "--filter", label, "--format", "{{.State}}"], {
    env: liveInputs.hostEnvironment,
    timeoutMs: 30_000,
    cwd: tmpdir(),
  });
  return result.exitCode === 0 ? containerStateOf(result.stdout) : undefined;
}

interface Sampler {
  readonly stop: () => Promise<readonly ContainerSample[]>;
}

// Lists the session's container state every SAMPLE_INTERVAL_MS, one listing at a time (a listing never overlaps the next), until
// stop() is called. A sample's time is the moment its listing returned, in milliseconds from the signal.
function startSampler(liveInputs: LiveInputs, sandbox: string, signalAt: number): Sampler {
  const samples: ContainerSample[] = [];
  const state = { running: true };
  const alive = (): boolean => state.running;
  const loop = (async (): Promise<void> => {
    while (alive()) {
      const container = await sampleContainer(liveInputs, sandbox);
      if (container !== undefined) {
        samples.push({ atMs: Date.now() - signalAt, ...container });
      }
      if (alive()) {
        await sleep(SAMPLE_INTERVAL_MS);
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

// One busy node worker per CPU, started just before the signal. stop() kills each with SIGKILL and awaits its exit, so no worker
// outlives the stop it loaded.
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

// The request log's size, so the rows of one stop are read from where the stop began. An absent file is size 0.
function requestLogSize(stateDir: string): number {
  return statSync(requestLogPath(stateDir), { throwIfNoEntry: false })?.size ?? 0;
}

// The request log from byte offset on. A log that is now shorter than the offset was rotated: all of it is read.
function requestLogFrom(stateDir: string, offset: number): string {
  const path = requestLogPath(stateDir);
  if (!existsSync(path)) {
    return "";
  }
  const bytes = readFileSync(path);
  return (bytes.length >= offset ? bytes.subarray(offset) : bytes).toString("utf8");
}

function cpuLoad(): number | null {
  return loadPerCpu(loadavg()[0] ?? Number.NaN, cpus().length);
}

// Sends SIGTERM to the daemon pid and observes the stop: the daemon's exit, its stop rows, the container and the sandbox after the
// exit, the sampled container timeline and, when checkResidue is set, the residue wait. checkResidue is off for variant c, whose
// stop may leave a container that the next up's reap clears.
async function observeStop(
  ctx: Context,
  pid: number,
  options: { readonly withLoad: boolean; readonly checkResidue: boolean },
): Promise<IterationResult & { readonly loadBefore: number | null; readonly loadAfter: number | null }> {
  const loadBefore = cpuLoad();
  const offset = requestLogSize(ctx.environment.stateDir);
  const load = options.withLoad ? startLoad(loadWorkers(cpus().length)) : undefined;
  const signalAt = Date.now();
  const sampler = startSampler(ctx.inputs, ctx.sandbox, signalAt);
  let exited: boolean;
  let exitAt: number;
  try {
    process.kill(pid, "SIGTERM");
    const gone = await pollUntil(
      async () => {
        const listing = await findDaemonPids(ctx.inputs, DAEMON_ENTRY);
        if (!listing.ok) {
          return { done: false, detail: listing.detail };
        }
        return listing.pids.includes(pid) ? { done: false, detail: `daemon pid ${String(pid)} still runs` } : { done: true };
      },
      { timeoutMs: DAEMON_EXIT_BOUND_MS, intervalMs: DAEMON_EXIT_POLL_MS },
    );
    exited = gone.ok;
    exitAt = Date.now();
  } catch (error: unknown) {
    await sampler.stop();
    throw error;
  } finally {
    await load?.stop();
  }
  const loadAfter = cpuLoad();

  const records = stopRecordsOf(requestLogFrom(ctx.environment.stateDir, offset), new Date(signalAt).toISOString());
  const stopping = records.find((record) => record.event === "daemon.stopping");
  const stoppedRow = records.filter((record) => record.event === "daemon.stopped").at(-1);

  const containerGone = (
    await pollUntil(
      async () => {
        const listing = await listSandboxContainers(ctx.inputs, ctx.sandbox);
        return listing.ok && listing.items.length === 0 ? { done: true } : { done: false, detail: listing.ok ? "a container remains" : listing.detail };
      },
      { timeoutMs: GONE_AFTER_EXIT_MS, intervalMs: GONE_POLL_MS },
    )
  ).ok;
  const sandboxGone = (
    await pollUntil(
      async () => {
        const listing = await listSandboxesNamed(ctx.inputs, ctx.sandbox);
        return listing.ok && listing.items.length === 0 ? { done: true } : { done: false, detail: listing.ok ? "the sandbox remains" : listing.detail };
      },
      { timeoutMs: GONE_AFTER_EXIT_MS, intervalMs: GONE_POLL_MS },
    )
  ).ok;

  // The sampler runs until SAMPLE_AFTER_EXIT_MS after the exit, so a container that goes late is still seen going.
  await sleep(Math.max(0, exitAt + SAMPLE_AFTER_EXIT_MS - Date.now()));
  const samples = await sampler.stop();

  let residueProblems: readonly string[] = [];
  if (options.checkResidue) {
    const residue = await waitForNoResidue(ctx.inputs, [ctx.sandbox]);
    residueProblems = residue.ok ? [] : [residue.detail];
  }
  const parsedTime = (iso: string | undefined): number | null => (iso === undefined ? null : Date.parse(iso));
  return {
    timeline: stageTimeline(samples, {
      signal: signalAt,
      stopping: parsedTime(stopping?.ts),
      stopped: parsedTime(stoppedRow?.ts),
      exit: exited ? exitAt : null,
    }),
    stopped: stoppedRow === undefined ? undefined : stoppedVerdictOf(stoppedRow.row),
    exitedInBound: exited,
    containerGone,
    sandboxGone,
    residueProblems,
    followUpActive: undefined,
    loadBefore,
    loadAfter,
  };
}

// ---- Evidence ------------------------------------------------------------------------------------------------------------

const allRecords: IterationRecord[] = [];

// Writes the iteration's line and the summary so far, whatever the verdict, before the verdict is asserted.
function recordIteration(t: TestContext, record: IterationRecord): void {
  allRecords.push(record);
  const line = evidenceLineOf(record);
  appendFileSync(join(evidenceDir, "iterations.jsonl"), `${line}\n`, { mode: 0o600 });
  writeFileSync(join(evidenceDir, "summary.txt"), evidenceText(allRecords), { mode: 0o600 });
  t.diagnostic(line);
}

function failureText(record: IterationRecord): string {
  return `variant ${record.variant} iteration ${String(record.iteration)}: ${record.verdict.reason ?? "no reason"}; ${evidenceLineOf(record)}`;
}

// ---- Variants a and b ----------------------------------------------------------------------------------------------------

async function stopAfterSession(t: TestContext, ctx: Context, variant: "a" | "b", iteration: number): Promise<void> {
  await upActive(ctx);
  // One exec in the sandbox, so the session has run a workload before it is stopped.
  const executed = await sandboxExec(ctx.inputs, sessionIdFor(ctx.inputs.workspaceRoot), ["cat", "/proc/self/status"]);
  assert.equal(executed.exitCode, 0, `sandbox exec: ${describeResult(executed)}`);
  const pid = await onlyDaemonPid(ctx);
  const observed = await observeStop(ctx, pid, { withLoad: variant === "b", checkResidue: true });
  const verdict = iterationVerdict(variant, observed);
  const record: IterationRecord = {
    variant,
    iteration,
    verdict,
    timeline: observed.timeline,
    stopped: observed.stopped,
    loadBefore: observed.loadBefore,
    loadAfter: observed.loadAfter,
  };
  recordIteration(t, record);
  assert.ok(verdict.pass, failureText(record));
}

// ---- Variant c -----------------------------------------------------------------------------------------------------------

async function stopMidUp(t: TestContext, ctx: Context, iteration: number): Promise<void> {
  // The up is started and not awaited: it is the request the stop interrupts. realmCli never rejects.
  const upRun = realmCli(ctx.inputs, ctx.environment, ["up", "--workspace", ctx.inputs.workspaceRoot], UP_TIMEOUT_MS);
  if (iteration % 2 === 1) {
    const appeared = await pollUntil(
      async () => {
        const listing = await listSandboxContainers(ctx.inputs, ctx.sandbox);
        return listing.ok && listing.items.length > 0 ? { done: true } : { done: false, detail: listing.ok ? "no container yet" : listing.detail };
      },
      { timeoutMs: MID_UP_CONTAINER_BOUND_MS, intervalMs: SAMPLE_INTERVAL_MS },
    );
    assert.ok(appeared.ok, `the session's container must appear during the up: ${appeared.detail}`);
  } else {
    await sleep(MID_UP_DELAY_MS);
  }
  const found = await pollUntil(
    async () => {
      const listing = await findDaemonPids(ctx.inputs, DAEMON_ENTRY);
      return listing.ok && listing.pids.length === 1 ? { done: true } : { done: false, detail: listing.ok ? `${String(listing.pids.length)} daemon(s)` : listing.detail };
    },
    { timeoutMs: DAEMON_APPEAR_BOUND_MS, intervalMs: SAMPLE_INTERVAL_MS },
  );
  assert.ok(found.ok, `exactly one daemon must run during the up: ${found.detail}`);
  const pid = await onlyDaemonPid(ctx);
  const observed = await observeStop(ctx, pid, { withLoad: false, checkResidue: false });
  // The interrupted up's own exit is a diagnostic, not a verdict.
  const interrupted = await upRun;
  t.diagnostic(`variant c iteration ${String(iteration)}: the interrupted up ended with ${interrupted.exitCode === undefined ? "no exit code" : `exit ${String(interrupted.exitCode)}`}`);

  // The next start recovers: the stop kept the session record, and the up's reap and adoption deal with what the stop left.
  const next = await realmCli(ctx.inputs, ctx.environment, ["up", "--workspace", ctx.inputs.workspaceRoot], UP_TIMEOUT_MS);
  const active = next.exitCode === 0 ? await waitForActive(ctx.inputs, ctx.environment, ACTIVE_TIMEOUT_MS) : undefined;
  const followUpActive = active?.ok === true;
  const verdict = iterationVerdict("c", { ...observed, followUpActive });
  const record: IterationRecord = {
    variant: "c",
    iteration,
    verdict,
    timeline: observed.timeline,
    stopped: observed.stopped,
    loadBefore: observed.loadBefore,
    loadAfter: observed.loadAfter,
  };
  recordIteration(t, record);
  // Whatever the verdict, the scenario is brought down and must leave nothing, so the next iteration starts from a clean stack.
  const stopped = await realmCliWithWorkspace(ctx.inputs, ctx.environment, ["down"], ctx.inputs.workspaceRoot, DOWN_TIMEOUT_MS);
  assert.equal(stopped.exitCode, 0, `realm down: ${describeResult(stopped)}`);
  const residue = await waitForNoResidue(ctx.inputs, [ctx.sandbox]);
  assert.ok(residue.ok, `residue after realm down: ${residue.detail}`);
  assert.ok(verdict.pass, failureText(record));
}

// ---- The test ------------------------------------------------------------------------------------------------------------

const TOTAL_TIMEOUT_MS = Math.max(1, variants.reduce((sum, variant) => sum + repeatsOf(variant), 0)) * PER_REPEAT_TIMEOUT_MS;

void test("daemon stop live: SIGTERM to a daemon with a sandbox container reports failedTeardowns 0 and leaves nothing", { skip: gate, timeout: TOTAL_TIMEOUT_MS }, async (t) => {
  for (const variant of variants) {
    await t.test(`variant ${variant}: ${VARIANT_TITLES[variant]}`, { timeout: repeatsOf(variant) * PER_REPEAT_TIMEOUT_MS }, async (sub) => {
      const ctx = startScenario(sub);
      for (let iteration = 1; iteration <= repeatsOf(variant); iteration += 1) {
        if (variant === "c") {
          await stopMidUp(sub, ctx, iteration);
        } else {
          await stopAfterSession(sub, ctx, variant, iteration);
        }
      }
    });
  }
});

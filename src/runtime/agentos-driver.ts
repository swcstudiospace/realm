// The OpenShell-carried AgentOS driver (D-014, D-016, D-018). The AgentOS runner is the workload of one OpenShell
// sandbox, realm-<sessionId>, which create makes for SessionExecution and SessionExecution.stop deletes. Every method
// names the session it serves, and that session's sandbox is the one its argv names. start starts the runner as a
// long-lived exec child (agentos-workload.ts) and waits until the probe answers. alive probes the sandbox through the
// pinned exec form. stop kills the runner child and detaches it, and runs no OpenShell command. Each session has its own
// runner state: its own runner child, and its own ordering of starts and stops, so starts and stops of one session run one
// after another and never wait on another session. Every OpenShell command goes through the injected runner port and is
// bounded: the readiness wait by startTimeoutMs, and the probes by callTimeoutMs. The argv come from src/runtime/openshell.ts,
// the one module allowed to name the OpenShell binary and the exec builder.

import { isAbsolute } from "node:path";
import { performance } from "node:perf_hooks";
import { makeRealmError, RealmError } from "../core/errors.js";
import { dialWithin, withTimeout } from "../core/timeout.js";
import { redactString } from "../audit/redact.js";
import { currentBootId } from "../session/proc-identity.js";
import { runnerRecordOf, writeRunnerRecord } from "../session/runner-record.js";
import type { AgentOsDriver } from "./agentos.js";
import type { RunnerChild, RunnerChildSpawner } from "./agentos-workload.js";
import {
  buildSandboxNamesArgv,
  realmSandboxName,
  buildAgentOsSandboxArgv,
  buildGatewayStatusArgv,
  buildCreateArgv,
  type OpenShellRunner,
  type OpenShellRunOutcome,
  type SandboxCreateRequest,
} from "./openshell.js";

export const DEFAULT_AGENTOS_RUNNER_PATH = "/usr/local/lib/realm/agentos-runner.js";
export const DEFAULT_AGENTOS_PROBE_PATH = "/usr/local/lib/realm/agentos-probe.js";

// The pause between readiness probes while the start deadline runs (D5). A runner child that exits ends the pause early.
const PROBE_INTERVAL_MS = 1000;
// The grace the runner child gets after SIGTERM, and again after SIGKILL, before a stop moves on (D4, D7).
const RUNNER_TERMINATE_GRACE_MS = 2000;
// The bound for one `openshell status` (OBS-04). A status that misses it counts as a gateway that does not answer.
export const GATEWAY_STATUS_TIMEOUT_MS = 10_000;

// The bound of the wait, before a create, for the gateway to stop listing the session's sandbox name. A name still listed at
// the bound is refused, because the create would fail "already exists".
const NAME_RELEASE_BOUND_MS = 30_000;
const NAME_RELEASE_POLL_MS = 1_000;

// The sandbox names the gateway lists, or undefined when the list exits non-zero or cannot be read within timeoutMs.
async function listedSandboxNames(run: OpenShellRunner, timeoutMs: number): Promise<readonly string[] | undefined> {
  if (!(timeoutMs > 0)) {
    return undefined;
  }
  try {
    const outcome = await withTimeout(
      run(buildSandboxNamesArgv(), { timeoutMs, captureOutput: true }),
      timeoutMs,
      "OPENSHELL_START_FAILED",
    );
    if (outcome.exitCode !== 0) {
      return undefined;
    }
    return (outcome.stdout ?? "")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "");
  } catch {
    return undefined;
  }
}

// True once the gateway no longer lists name. False when it still lists the name at boundMs, or when the list cannot be read.
async function nameReleased(run: OpenShellRunner, name: string, boundMs: number): Promise<boolean> {
  const deadline = performance.now() + boundMs;
  for (;;) {
    const names = await listedSandboxNames(run, deadline - performance.now());
    if (names === undefined) {
      return false;
    }
    if (!names.includes(name)) {
      return true;
    }
    const left = deadline - performance.now();
    if (left <= 0) {
      return false;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, Math.min(NAME_RELEASE_POLL_MS, left)));
  }
}
// The bound for the compute driver's socket probe (OBS-04). A driver that does not accept a connection within it does not answer.
const DRIVER_PROBE_TIMEOUT_MS = 5_000;

export interface OpenShellAgentOsDriverOptions {
  readonly runner: OpenShellRunner;
  // Starts the AgentOS runner child for a session's sandbox, from the exec argv that buildAgentOsSandboxArgv builds.
  readonly spawnRunner: RunnerChildSpawner;
  readonly runnerPath?: string;
  readonly probePath?: string;
  // Upper bound for the readiness wait: the runner child until its probe answers.
  readonly startTimeoutMs: number;
  // Upper bound for one probe.
  readonly callTimeoutMs: number;
  // The compute driver's socket: the path the driver binds, which the daemon reads from REALM_DRIVER_SOCKET. driverAnswers
  // connects to it when it is an absolute path. Absent, or not absolute, the driver is not probed (driverAnswers answers null).
  readonly driverSocketPath?: string;
  // The pause between readiness probes. Defaults to one second.
  readonly probeIntervalMs?: number;
  // The realm state directory where each runner's identity record is written (runner-record.ts). A start without it is refused
  // before any runner is spawned: a runner that has no record cannot be proven gone after a restart.
  readonly stateDir?: string;
  // The bound of the wait, before a create, for the gateway to stop listing the session's sandbox name. Defaults to 30 seconds.
  readonly nameReleaseMs?: number;
}

// The runner of one session. Its methods act on that session's sandbox only.
interface SessionRunner {
  start(): Promise<void>;
  alive(): Promise<boolean>;
  runnerExited(): boolean;
  stop(): Promise<void>;
}

function assertPositiveFinite(value: number): void {
  if (!(value > 0) || !Number.isFinite(value)) {
    throw new RangeError("AgentOS timeouts must be positive finite numbers");
  }
}

// Runs one OpenShell command under budgetMs and reports whether it exited 0 in time. A rejection, a missed budget and
// a non-zero exit are all false, so no child text leaves the driver and the caller maps the false result to its code.
// The code given to withTimeout is never surfaced: a missed budget is only a false result.
async function succeeds(run: () => Promise<OpenShellRunOutcome>, budgetMs: number): Promise<boolean> {
  if (!(budgetMs > 0)) {
    return false;
  }
  try {
    const outcome = await withTimeout(run(), budgetMs, "OPENSHELL_START_FAILED");
    return outcome.exitCode === 0;
  } catch {
    return false;
  }
}

// The create's outcome for the failure line: the exit code as text, or why there is none, and the runner's stderr. A rejection
// or a missed budget keeps no text, so no error message from the runner reaches the journal.
async function createOutcomeOf(
  run: () => Promise<OpenShellRunOutcome>,
  budgetMs: number,
): Promise<{ readonly exitCode: string; readonly stderr: string }> {
  if (!(budgetMs > 0)) {
    return { exitCode: "no budget", stderr: "" };
  }
  try {
    const outcome = await withTimeout(run(), budgetMs, "OPENSHELL_START_FAILED");
    return { exitCode: String(outcome.exitCode), stderr: outcome.stderr ?? "" };
  } catch {
    return { exitCode: "no exit (rejected or over budget)", stderr: "" };
  }
}

// One journal line for a failed create: the exit code, then the first 800 characters of the runner's stderr, redacted. Line
// breaks become " | " so the record stays on one line.
function createFailureLine(outcome: { readonly exitCode: string; readonly stderr: string }): string {
  const clipped = redactString(outcome.stderr).replace(/\s*\r?\n\s*/g, " | ").slice(0, 800);
  return `realm compute driver create failed: exit=${outcome.exitCode} stderr=${clipped === "" ? "(none)" : clipped}\n`;
}

// Writes the identity record of a runner child just spawned (runner-record.ts). False when the child has no pid, when it is
// not a live group leader, when no boot id can be read, or when the record cannot be written. The caller then stops the child.
function recordSpawnedRunner(stateDir: string, sessionId: string, child: RunnerChild): boolean {
  const bootId = currentBootId();
  if (child.pid === undefined || bootId === null) {
    return false;
  }
  const record = runnerRecordOf(child.pid, bootId);
  if (record === null) {
    return false;
  }
  try {
    writeRunnerRecord(stateDir, sessionId, record);
    return true;
  } catch {
    return false;
  }
}

// Connects to an absolute unix socket path and reports whether it accepted the connection within timeoutMs: true when it did,
// false when the socket is refused, absent, not a socket, or the bound is missed. A permission error is no answer at all, see
// answerOfConnectError. The connection is closed as soon as the answer is known. Only the error code is read, never its
// message, so no path or OS text leaves the probe.
function connectsWithin(socketPath: string, timeoutMs: number): Promise<boolean | null> {
  return dialWithin(socketPath, timeoutMs, "OPENSHELL_GATEWAY_LOST").then(
    (socket) => {
      socket.destroy();
      return true;
    },
    (error: unknown) => {
      // A missed bound is no answer from the driver. Any other failure is judged by its errno code alone.
      if (error instanceof RealmError) {
        return false;
      }
      const code = error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : undefined;
      return answerOfConnectError(code);
    },
  );
}

// The answer for a failed connect, from its error code alone. EACCES and EPERM mean this daemon may not open the socket (it is
// neither root nor the socket's owner). That says nothing about the driver, so the answer is null. Any other failure is false.
export function answerOfConnectError(code: string | undefined): boolean | null {
  return code === "EACCES" || code === "EPERM" ? null : false;
}

// A bounded pause between two readiness probes. It ends after ms, or as soon as the runner child exits, so a runner that
// dies is noticed at once. The bound is withTimeout; its expiry is the normal end of the pause, not a failure.
async function pauseUnlessExited(exited: Promise<void>, ms: number): Promise<void> {
  await withTimeout(exited, ms, "OPENSHELL_START_FAILED").catch(() => undefined);
}

// Waits for an earlier operation to settle, whatever its outcome. The earlier operation reports its own failure to its
// own caller. Each operation is bounded by its own deadlines, so this wait is bounded too.
async function ignoreOutcome(operation: Promise<void>): Promise<void> {
  await operation.catch(() => undefined);
}

export function createOpenShellAgentOsDriver(options: OpenShellAgentOsDriverOptions): AgentOsDriver {
  assertPositiveFinite(options.startTimeoutMs);
  assertPositiveFinite(options.callTimeoutMs);
  const probeIntervalMs = options.probeIntervalMs ?? PROBE_INTERVAL_MS;
  assertPositiveFinite(probeIntervalMs);
  const runnerPath = options.runnerPath ?? DEFAULT_AGENTOS_RUNNER_PATH;
  const probePath = options.probePath ?? DEFAULT_AGENTOS_PROBE_PATH;
  const { runner, spawnRunner, startTimeoutMs, callTimeoutMs, driverSocketPath, stateDir } = options;
  const nameReleaseMs = options.nameReleaseMs ?? NAME_RELEASE_BOUND_MS;
  assertPositiveFinite(nameReleaseMs);

  // The runner of each session, made on that session's first call. A session's argv names its own sandbox, and the
  // builders refuse a malformed session id with SCHEMA_INVALID, before any runner call.
  const runners = new Map<string, SessionRunner>();

  function runnerFor(sessionId: string): SessionRunner {
    const existing = runners.get(sessionId);
    if (existing !== undefined) {
      return existing;
    }
    const made = makeSessionRunner(sessionId);
    runners.set(sessionId, made);
    return made;
  }

  // The runner of one session: its runner child, the stop count that orders its starts and stops, and its in-flight
  // start and stop. Nothing here is shared with another session.
  function makeSessionRunner(sessionId: string): SessionRunner {
    const argv = buildAgentOsSandboxArgv({ sessionId, runnerPath, probePath });

    // The runner child of this session's sandbox, or undefined when none is held.
    let runnerChild: RunnerChild | undefined;
    // Counts stop() calls, so a start that a stop overtakes gives up instead of starting a runner after the stop.
    let stops = 0;
    // The start in flight, or undefined. See start() for how an overlapping start is handled.
    let startInFlight: Promise<void> | undefined;
    // The stop count when startInFlight was called. A start joins it only while no stop has landed since.
    let startInFlightStops = -1;
    // The stop in flight, or undefined. A start called while a stop is in flight waits for that stop.
    let stopInFlight: Promise<void> | undefined;

    // Detaches the held runner child and terminates it. Detaching first means a stop never reads as a crash, and a
    // later failed step leaves no held child to be terminated twice. terminate never rejects; its result is returned,
    // so a CLEANUP_FAILED from it reaches the caller that asked for the stop.
    async function stopRunner(): Promise<RealmError | undefined> {
      const held = runnerChild;
      runnerChild = undefined;
      if (held === undefined) {
        return undefined;
      }
      return held.terminate(RUNNER_TERMINATE_GRACE_MS);
    }

    // One start: the runner child for the sandbox the session's create made. It waits for the stop before it, if one is in
    // flight, and for the prior start, so two starts never run at once. stopsAtCall is the stop count when start() was called.
    // A stop that lands after that call, at any point, overtakes this start, so the start fails instead of reporting the
    // runner as up. The readiness wait is bounded by startTimeoutMs.
    async function runStart(
      waitFor: Promise<void> | undefined,
      priorStart: Promise<void> | undefined,
      stopsAtCall: number,
    ): Promise<void> {
      if (waitFor !== undefined) {
        await ignoreOutcome(waitFor);
      }
      if (priorStart !== undefined) {
        await ignoreOutcome(priorStart);
      }
      // A previous runner that could not be terminated may still be alive: the start spawns nothing, and fails with its cause.
      let cleanup = await stopRunner();
      if (cleanup !== undefined) {
        throw makeRealmError("OPENSHELL_START_FAILED", cleanup.code);
      }
      // The readiness wait gets the whole start budget.
      const deadline = performance.now() + startTimeoutMs;
      const left = (): number => deadline - performance.now();

      // A stop that overtook this start, or a spent budget, spawns nothing.
      if (stops !== stopsAtCall || left() <= 0) {
        throw makeRealmError("OPENSHELL_START_FAILED");
      }

      // Without a state directory no record can be written, and a runner with no record cannot be proven gone after a restart.
      // This is refused before spawnRunner, so no runner ever runs unrecorded.
      if (stateDir === undefined) {
        throw makeRealmError("OPENSHELL_START_FAILED");
      }
      let spawned: RunnerChild;
      try {
        spawned = spawnRunner(argv.runner);
      } catch {
        throw makeRealmError("OPENSHELL_START_FAILED");
      }
      // The identity is recorded right after the spawn, before any readiness probe. When the record cannot be written, the
      // runner just started is stopped and the start fails: it is not held, because nothing could prove it gone later.
      if (!recordSpawnedRunner(stateDir, sessionId, spawned)) {
        const cleanup = await spawned.terminate(RUNNER_TERMINATE_GRACE_MS);
        throw makeRealmError("OPENSHELL_START_FAILED", cleanup?.code);
      }
      runnerChild = spawned;

      // Readiness: probe until a probe exits 0. A runner that exits first, a stop, or the deadline fails the start.
      for (;;) {
        if (spawned.hasExited() || stops !== stopsAtCall) {
          break;
        }
        const probeBudget = Math.min(callTimeoutMs, left());
        if (await succeeds(() => runner(argv.probe, { timeoutMs: probeBudget }), probeBudget)) {
          // A stop that landed while the probe ran wins: the runner is not reported as up.
          if (stops === stopsAtCall) {
            return;
          }
          break;
        }
        const pauseMs = Math.min(probeIntervalMs, left());
        if (pauseMs <= 0) {
          break;
        }
        await pauseUnlessExited(spawned.exited, pauseMs);
      }
      cleanup = await stopRunner();
      throw makeRealmError("OPENSHELL_START_FAILED", cleanup instanceof RealmError ? cleanup.code : undefined);
    }

    // One stop. It stops the runner child at once, so a start still in its readiness wait sees the stop at its next check,
    // then waits for the stop before it and for the start it overtakes. It runs no OpenShell command: SessionExecution owns
    // the session's sandbox and deletes it after this stop, so the sandbox has exactly one deleter.
    async function runStop(
      previous: Promise<void> | undefined,
      starting: Promise<void> | undefined,
    ): Promise<RealmError | undefined> {
      // The cleanup result of this stop's runner child is returned to stop(), which reports it.
      const cleanup = await stopRunner();
      if (previous !== undefined) {
        await ignoreOutcome(previous);
      }
      if (starting !== undefined) {
        await ignoreOutcome(starting);
      }
      return cleanup;
    }

    return {
      start(): Promise<void> {
        // N3, the decision: a start called while an in-flight start has seen no stop since joins that start and gets its
        // result. One runner child exists per session's sandbox. A start called after a stop began does not join: the stop
        // overtakes the start in flight, so the new start waits for that stop and for the prior start, then runs its own.
        if (startInFlight !== undefined && startInFlightStops === stops) {
          return startInFlight;
        }
        const prior = startInFlight;
        const attempt = runStart(stopInFlight, prior, stops);
        startInFlight = attempt;
        startInFlightStops = stops;
        const clear = (): void => {
          if (startInFlight === attempt) {
            startInFlight = undefined;
          }
        };
        attempt.then(clear, clear);
        return attempt;
      },
      async alive(): Promise<boolean> {
        // A non-zero probe exit is an answer (not alive). A rejection or a missed budget is a failed attempt.
        return succeeds(() => runner(argv.probe, { timeoutMs: callTimeoutMs }), callTimeoutMs);
      },
      runnerExited(): boolean {
        return runnerChild !== undefined && runnerChild.hasExited();
      },
      stop(): Promise<void> {
        stops += 1;
        const previous = stopInFlight;
        const starting = startInFlight;
        const attempt = runStop(previous, starting).then((cleanup): void => {
          // A runner child that could not be cleaned up fails the stop: the cause is attached and no success is reported.
          if (cleanup !== undefined) {
            throw makeRealmError("AGENTOS_STOP_FAILED", cleanup.code);
          }
        });
        stopInFlight = attempt;
        const clear = (): void => {
          if (stopInFlight === attempt) {
            stopInFlight = undefined;
          }
        };
        attempt.then(clear, clear);
        return attempt;
      },
    };
  }

  return {
    // Creates the session's sandbox, the one create in the realm. The argv is buildCreateArgv for realm-<sessionId>: the sandbox
    // name, the policy, the limits and the image, with no workload command. The runner is bounded by timeoutMs. A rejection, a
    // non-zero exit or a missed budget is OPENSHELL_START_FAILED.
    async create(request: SandboxCreateRequest, timeoutMs: number): Promise<void> {
      const createArgv = buildCreateArgv(request);
      const sandboxName = realmSandboxName(request.sessionId);
      if (!(await nameReleased(runner, sandboxName, Math.min(nameReleaseMs, timeoutMs)))) {
        process.stderr.write(
          `realm compute driver create failed: the gateway still lists sandbox ${sandboxName} (wait bound ${String(nameReleaseMs)} ms)\n`,
        );
        throw makeRealmError("OPENSHELL_START_FAILED");
      }
      const outcome = await createOutcomeOf(() => runner(createArgv, { timeoutMs, captureOutput: true }), timeoutMs);
      if (outcome.exitCode !== "0") {
        process.stderr.write(createFailureLine(outcome));
        throw makeRealmError("OPENSHELL_START_FAILED");
      }
    },
    async start(sessionId: string): Promise<void> {
      return runnerFor(sessionId).start();
    },
    async alive(sessionId: string): Promise<boolean> {
      return runnerFor(sessionId).alive();
    },
    async stop(sessionId: string): Promise<void> {
      return runnerFor(sessionId).stop();
    },
    runnerExited(sessionId: string): boolean {
      return runnerFor(sessionId).runnerExited();
    },
    // OBS-04: true only when `openshell status` exits 0 within GATEWAY_STATUS_TIMEOUT_MS. A rejection, a missed bound and a
    // non-zero exit are all false. The supervisor asks only after a failed probe, so a healthy tick runs nothing extra.
    async gatewayAnswers(): Promise<boolean> {
      return succeeds(
        () => runner(buildGatewayStatusArgv(), { timeoutMs: GATEWAY_STATUS_TIMEOUT_MS }),
        GATEWAY_STATUS_TIMEOUT_MS,
      );
    },
    // OBS-04: true when the compute driver's socket, the one the driver binds, accepts a connection within
    // DRIVER_PROBE_TIMEOUT_MS; false when it does not. null when no absolute socket path is configured: the driver is not
    // probed and is not claimed down. A stopped driver unit refuses the socket while `openshell status` can still exit 0.
    // Runs no OpenShell command.
    async driverAnswers(): Promise<boolean | null> {
      if (driverSocketPath === undefined || !isAbsolute(driverSocketPath)) {
        return null;
      }
      return connectsWithin(driverSocketPath, DRIVER_PROBE_TIMEOUT_MS);
    },
  };
}

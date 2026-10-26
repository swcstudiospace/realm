// The OpenShell-carried AgentOS driver (D-014, D-016, D-018). The AgentOS runner is the workload of one OpenShell
// sandbox, realm-<sessionId>, which create makes for SessionExecution and SessionExecution.stop deletes. Every method
// names the session it serves, and that session's sandbox is the one its argv names. start starts the runner as a
// long-lived exec child (agentos-workload.ts) and waits until the probe answers. alive probes the sandbox through the
// pinned exec form. stop kills the runner child and detaches it, and runs no OpenShell command. Each session has its own
// runner state: its own runner child, and its own ordering of starts and stops, so starts and stops of one session run one
// after another and never wait on another session. Every OpenShell command goes through the injected runner port and is
// bounded: the readiness wait by startTimeoutMs, and the probes by callTimeoutMs. The argv come from src/runtime/openshell.ts,
// the one module allowed to name the OpenShell binary and the exec builder.

import { performance } from "node:perf_hooks";
import { makeRealmError } from "../core/errors.js";
import { withTimeout } from "../core/timeout.js";
import type { AgentOsDriver } from "./agentos.js";
import type { RunnerChild, RunnerChildSpawner } from "./agentos-workload.js";
import {
  buildAgentOsSandboxArgv,
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
  // The pause between readiness probes. Defaults to one second.
  readonly probeIntervalMs?: number;
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
  const { runner, spawnRunner, startTimeoutMs, callTimeoutMs } = options;

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
    // later failed step leaves no held child to be terminated twice. terminate never rejects.
    async function stopRunner(): Promise<void> {
      const held = runnerChild;
      runnerChild = undefined;
      if (held !== undefined) {
        await held.terminate(RUNNER_TERMINATE_GRACE_MS);
      }
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
      await stopRunner();
      // The readiness wait gets the whole start budget.
      const deadline = performance.now() + startTimeoutMs;
      const left = (): number => deadline - performance.now();

      // A stop that overtook this start, or a spent budget, spawns nothing.
      if (stops !== stopsAtCall || left() <= 0) {
        throw makeRealmError("OPENSHELL_START_FAILED");
      }

      let spawned: RunnerChild;
      try {
        spawned = spawnRunner(argv.runner);
      } catch {
        throw makeRealmError("OPENSHELL_START_FAILED");
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
      await stopRunner();
      throw makeRealmError("OPENSHELL_START_FAILED");
    }

    // One stop. It stops the runner child at once, so a start still in its readiness wait sees the stop at its next check,
    // then waits for the stop before it and for the start it overtakes. It runs no OpenShell command: SessionExecution owns
    // the session's sandbox and deletes it after this stop, so the sandbox has exactly one deleter.
    async function runStop(previous: Promise<void> | undefined, starting: Promise<void> | undefined): Promise<void> {
      await stopRunner();
      if (previous !== undefined) {
        await ignoreOutcome(previous);
      }
      if (starting !== undefined) {
        await ignoreOutcome(starting);
      }
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
        const attempt = runStop(previous, starting);
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
    // Creates the session's sandbox, the one create in the realm. The argv is buildCreateArgv for realm-<sessionId>, with no
    // workload command and no --no-keep. The runner is bounded by timeoutMs. A rejection, a non-zero exit or a missed budget
    // is OPENSHELL_START_FAILED.
    async create(request: SandboxCreateRequest, timeoutMs: number): Promise<void> {
      const createArgv = buildCreateArgv(request);
      if (!(await succeeds(() => runner(createArgv, { timeoutMs }), timeoutMs))) {
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
  };
}

// The OpenShell-carried AgentOS driver (D-014, D-016, D-018). The AgentOS runner is the workload of one OpenShell
// sandbox. start creates the sandbox, then starts the runner as a long-lived exec child (agentos-workload.ts) and waits
// until the probe answers. alive probes the sandbox through the pinned exec form. stop kills the runner child and
// deletes the sandbox. Every OpenShell command goes through the injected runner port and is bounded: create by
// startTimeoutMs, and the probes and the delete by callTimeoutMs. The argv come from src/runtime/openshell.ts, the one
// module allowed to name the OpenShell binary and the exec builder.

import { performance } from "node:perf_hooks";
import { makeRealmError } from "../core/errors.js";
import { withTimeout } from "../core/timeout.js";
import type { AgentOsDriver } from "./agentos.js";
import type { RunnerChild, RunnerChildSpawner } from "./agentos-workload.js";
import { buildAgentOsSandboxArgv, type OpenShellRunner, type OpenShellRunOutcome } from "./openshell.js";

export const DEFAULT_AGENTOS_SANDBOX_NAME = "realm-agentos";
export const DEFAULT_AGENTOS_RUNNER_PATH = "/usr/local/lib/realm/agentos-runner.js";
export const DEFAULT_AGENTOS_PROBE_PATH = "/usr/local/lib/realm/agentos-probe.js";

const SANDBOX_NAME_PREFIX = "realm-";
// The pause between readiness probes while the start deadline runs (D5).
const PROBE_INTERVAL_MS = 1000;
// The grace the runner child gets after SIGTERM, and again after SIGKILL, before a stop moves on (D4, D7).
const RUNNER_TERMINATE_GRACE_MS = 2000;

export interface OpenShellAgentOsDriverOptions {
  readonly runner: OpenShellRunner;
  // Starts the AgentOS runner child for the sandbox, from the exec argv that buildAgentOsSandboxArgv builds.
  readonly spawnRunner: RunnerChildSpawner;
  // The derived sandbox image reference (D-016). Refused when empty.
  readonly imageRef: string;
  // The absolute path of the sandbox policy document, written by the composition root.
  readonly policyPath: string;
  readonly cpus: number;
  readonly memory: string;
  readonly sandboxName?: string;
  readonly runnerPath?: string;
  readonly probePath?: string;
  // Upper bound for the whole start: the sandbox create, then the runner until its probe answers.
  readonly startTimeoutMs: number;
  // Upper bound for one probe and for the delete.
  readonly callTimeoutMs: number;
  // The pause between readiness probes. Defaults to one second.
  readonly probeIntervalMs?: number;
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

// A bounded pause between two readiness probes.
function pause(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function createOpenShellAgentOsDriver(options: OpenShellAgentOsDriverOptions): AgentOsDriver {
  assertPositiveFinite(options.startTimeoutMs);
  assertPositiveFinite(options.callTimeoutMs);
  const probeIntervalMs = options.probeIntervalMs ?? PROBE_INTERVAL_MS;
  assertPositiveFinite(probeIntervalMs);
  const sandboxName = options.sandboxName ?? DEFAULT_AGENTOS_SANDBOX_NAME;
  if (!sandboxName.startsWith(SANDBOX_NAME_PREFIX)) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  // The builders refuse malformed input with SCHEMA_INVALID. Building once here makes that refusal
  // happen at construction, not on the first driver call.
  const argv = buildAgentOsSandboxArgv({
    sessionId: sandboxName.slice(SANDBOX_NAME_PREFIX.length),
    policyPath: options.policyPath,
    cpus: options.cpus,
    memory: options.memory,
    imageRef: options.imageRef,
    runnerPath: options.runnerPath ?? DEFAULT_AGENTOS_RUNNER_PATH,
    probePath: options.probePath ?? DEFAULT_AGENTOS_PROBE_PATH,
  });
  const { runner, spawnRunner, startTimeoutMs, callTimeoutMs } = options;

  // The runner child of the sandbox this driver started, or undefined when none is held.
  let runnerChild: RunnerChild | undefined;
  // Counts stop() calls, so a start that a stop overtakes gives up instead of starting a runner after the stop.
  let stops = 0;

  // Detaches the held runner child and terminates it. Detaching first means a stop never reads as a crash, and a
  // later failed step leaves no held child to be terminated twice. terminate never rejects.
  async function stopRunner(): Promise<void> {
    const held = runnerChild;
    runnerChild = undefined;
    if (held !== undefined) {
      await held.terminate(RUNNER_TERMINATE_GRACE_MS);
    }
  }

  return {
    async start(): Promise<void> {
      await stopRunner();
      const stopsAtStart = stops;
      // The create is the first step, so it gets the whole start budget. Its deadline is the one the readiness wait uses.
      const deadline = performance.now() + startTimeoutMs;
      const left = (): number => deadline - performance.now();

      // The runner starts only once create has exited 0, so a failed create spawns nothing.
      const created = await succeeds(() => runner(argv.create, { timeoutMs: startTimeoutMs }), startTimeoutMs);
      if (!created || stops !== stopsAtStart || left() <= 0) {
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
        if (spawned.hasExited() || stops !== stopsAtStart) {
          break;
        }
        const probeBudget = Math.min(callTimeoutMs, left());
        if (await succeeds(() => runner(argv.probe, { timeoutMs: probeBudget }), probeBudget)) {
          return;
        }
        const pauseMs = Math.min(probeIntervalMs, left());
        if (pauseMs <= 0) {
          break;
        }
        await pause(pauseMs);
      }
      await stopRunner();
      throw makeRealmError("OPENSHELL_START_FAILED");
    },
    async alive(): Promise<boolean> {
      // A non-zero probe exit is an answer (not alive). A rejection or a missed budget is a failed attempt.
      return succeeds(() => runner(argv.probe, { timeoutMs: callTimeoutMs }), callTimeoutMs);
    },
    runnerExited(): boolean {
      return runnerChild !== undefined && runnerChild.hasExited();
    },
    async stop(): Promise<void> {
      stops += 1;
      await stopRunner();
      // The delete runs on every stop, so a repeated stop, or a retry after a failed delete, removes the sandbox.
      if (!(await succeeds(() => runner(argv.delete, { timeoutMs: callTimeoutMs }), callTimeoutMs))) {
        throw makeRealmError("AGENTOS_STOP_FAILED");
      }
    },
  };
}

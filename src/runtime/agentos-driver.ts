// The OpenShell-carried AgentOS driver (D-014, D-016, D-018). The AgentOS runner is the workload of
// one OpenShell sandbox: start creates it, alive probes it through the pinned exec form, and stop
// deletes it. Every call goes through the injected runner port. Create is bounded by startTimeoutMs,
// because provisioning takes tens of seconds; probe and delete are bounded by callTimeoutMs. The argv
// come from src/runtime/openshell.ts, the one module allowed to name the OpenShell binary and the exec
// builder.

import { makeRealmError } from "../core/errors.js";
import type { AgentOsDriver } from "./agentos.js";
import { buildAgentOsSandboxArgv, type OpenShellRunner } from "./openshell.js";

export const DEFAULT_AGENTOS_SANDBOX_NAME = "realm-agentos";
export const DEFAULT_AGENTOS_RUNNER_PATH = "/opt/realm/agentos-runner.js";
export const DEFAULT_AGENTOS_PROBE_PATH = "/opt/realm/agentos-probe.js";

const SANDBOX_NAME_PREFIX = "realm-";

export interface OpenShellAgentOsDriverOptions {
  readonly runner: OpenShellRunner;
  // The derived sandbox image reference (D-016). Refused when empty.
  readonly imageRef: string;
  // The absolute path of the sandbox policy document, written by the composition root.
  readonly policyPath: string;
  readonly cpus: number;
  readonly memory: string;
  readonly sandboxName?: string;
  readonly runnerPath?: string;
  readonly probePath?: string;
  // Upper bound for the sandbox create, which provisions the container and waits for it to start.
  readonly startTimeoutMs: number;
  // Upper bound for one probe and for the delete.
  readonly callTimeoutMs: number;
}

function assertPositiveFinite(value: number): void {
  if (!(value > 0) || !Number.isFinite(value)) {
    throw new RangeError("AgentOS timeouts must be positive finite numbers");
  }
}

export function createOpenShellAgentOsDriver(options: OpenShellAgentOsDriverOptions): AgentOsDriver {
  assertPositiveFinite(options.startTimeoutMs);
  assertPositiveFinite(options.callTimeoutMs);
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
  const { runner, startTimeoutMs, callTimeoutMs } = options;

  return {
    async start(): Promise<void> {
      const outcome = await runner(argv.create, { timeoutMs: startTimeoutMs });
      if (outcome.exitCode !== 0) {
        throw makeRealmError("OPENSHELL_START_FAILED");
      }
    },
    async alive(): Promise<boolean> {
      // A non-zero probe exit is an answer (not alive). A runner rejection is a failed attempt.
      const outcome = await runner(argv.probe, { timeoutMs: callTimeoutMs });
      return outcome.exitCode === 0;
    },
    async stop(): Promise<void> {
      const outcome = await runner(argv.delete, { timeoutMs: callTimeoutMs });
      if (outcome.exitCode !== 0) {
        throw makeRealmError("AGENTOS_STOP_FAILED");
      }
    },
  };
}

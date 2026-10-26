// ExecutionService composition (D-39, D-67) over the OpenShell adapter, the closed libpod client, the
// hardening verifier, and the optional AgentOS supervisor. Every dependency arrives as a constructor argument:
// this module reads no host environment, and the only process it starts is the OpenShell CLI, through
// the runner it is given (RT-03, D-46).
//
// Create (D-47, D-51, D-56, D-57): read the libpod info for the rootless flag, write the policy
// document before the create, run the label-idempotent OpenShell create, then verify the inspect of
// the container it resolved. A mismatch, or an inspect that cannot be read, removes the container
// before anything is thrown. No unverified container is ever returned as running.
//
// Without an AgentOS supervisor, every runtime-touching path fails closed (AGENTOS_NOT_CONFIGURED).
// create, start, and probe refuse before any libpod call, OpenShell run, or policy-file write, so no
// container is created. stop and destroy still stop and remove the container: with no AgentOS step to run,
// there is nothing to stop first.
//
// Sweep (D-68, RT-09, D-84): the zero-orphan sweep lives in sweep.ts and is re-exported below so existing
// callers keep working. It removes every realm-labelled container and proves zero survivors.

import { spawn, type ChildProcess, type StdioOptions } from "node:child_process";
import { makeRealmError, RealmError, type ErrorCode } from "../core/errors.js";
import { withTimeout } from "../core/timeout.js";
import type { CreateRequest, ExecutionService, ProbeResult } from "../core/ports.js";
import type { EgressRule } from "../contract/validate.js";
import type { EnvironmentLike } from "../session/paths.js";
import type { AgentOsSupervisor } from "./agentos.js";
import { loadRuntimeConfig, type RuntimeConfig } from "./config.js";
import { validateEgressAllow } from "./egress.js";
import {
  HARDENING_PROFILE,
  verifyInspect,
  type HardeningBinding,
  type HardeningProperty,
} from "./hardening.js";
import type { LibpodClient, LibpodInspect } from "./libpod-client.js";
import { attachKernelCaps, readHostProcStatus } from "./kernel-caps.js";
import {
  buildExecArgv,
  OPENSHELL_OUTPUT_LIMIT_BYTES,
  OpenShellRunnerError,
  runOpenShellCreate,
  writePolicyDocument,
  type OpenShellRunner,
  type OpenShellRunOutcome,
} from "./openshell.js";

// Bound for the whole OpenShell create, including the label poll (OQ-P3-01).
const OPENSHELL_CREATE_DEADLINE_MS = 60_000;
// Grace period a container gets to stop before it is killed (libpod stop timeout).
const CONTAINER_STOP_GRACE_MS = 10_000;
// Backstop bound on the AgentOS stop in stop() and destroy(). The supervisor's own per-call timeout normally
// settles the stop first; this timer only guarantees the container step is reached.
const AGENTOS_STOP_DEADLINE_MS = 15_000;
// The sandbox limits come from the frozen profile, so they cannot drift from the verifier.
export const SANDBOX_CPUS = HARDENING_PROFILE.nanoCpus / 1_000_000_000;
export const SANDBOX_MEMORY = `${String(HARDENING_PROFILE.memoryBytes / 1024 ** 3)}Gi`;

// The only environment names the OpenShell CLI receives. Each one is needed by the CLI to locate its
// configuration and the rootless Podman socket. No other name crosses from the host.
export const OPENSHELL_ENV_NAMES: readonly string[] = Object.freeze(["PATH", "HOME", "XDG_RUNTIME_DIR"]);

// The libpod calls the composition needs. The closed client satisfies it.
export type SessionContainers = Pick<
  LibpodClient,
  "info" | "inspectContainer" | "listContainersByLabel" | "stopContainer" | "removeContainer"
>;

export interface SessionExecutionOptions {
  readonly libpod: SessionContainers;
  readonly runner: OpenShellRunner;
  // Optional. With no supervisor bound, every runtime-touching operation fails closed (AGENTOS_NOT_CONFIGURED).
  readonly agentos?: AgentOsSupervisor;
  // The workspace root is per session and comes from the create request.
  readonly config: Omit<RuntimeConfig, "workspaceRoot">;
  // The session's egress allowlist, fixed for the session (D-106, OQ-P4-10). It arrives untrusted and is
  // validated by the constructor, so an invalid list throws SCHEMA_INVALID before any create.
  readonly egressAllow: unknown;
  // Reads the text of a host process's status file. The create-time check reads the container's init process
  // through it, to prove its capability sets are empty (D-51). Defaults to the host's /proc.
  readonly readProcStatus?: (pid: number) => string;
}

// A container whose hardening check failed. It carries the first failed property of the D-51 list,
// which is a fixed name from the profile and never caller text. The error code is still
// OPENSHELL_START_FAILED, and causeCode is the libpod code the refusal rests on, when there is one.
export class HardeningFailedError extends RealmError {
  readonly property: HardeningProperty;

  constructor(property: HardeningProperty, causeCode?: ErrorCode) {
    super("OPENSHELL_START_FAILED", causeCode);
    this.property = property;
  }
}

// The outcome of the bounded AgentOS stop. A failed stop carries the catalogue code of the supervisor error as its
// cause, when that error has a code other than the stop's own.
type AgentOsStop = { readonly ok: true } | { readonly ok: false; readonly causeCode: ErrorCode | undefined };

export class SessionExecution implements ExecutionService {
  private readonly libpod: SessionContainers;
  private readonly runner: OpenShellRunner;
  private readonly agentos: AgentOsSupervisor | undefined;
  private readonly config: Omit<RuntimeConfig, "workspaceRoot">;
  private readonly egressAllow: readonly EgressRule[];
  private readonly readProcStatus: (pid: number) => string;

  // The egress list is validated here, before any create can run (D-106). An invalid list throws, and
  // no OpenShell or libpod call has been made by then.
  constructor(options: SessionExecutionOptions) {
    this.egressAllow = validateEgressAllow(options.egressAllow);
    this.libpod = options.libpod;
    this.runner = options.runner;
    this.readProcStatus = options.readProcStatus ?? readHostProcStatus;
    this.agentos = options.agentos;
    this.config = options.config;
  }

  // The session id is the idempotency key, so a repeated create for one session reuses its
  // labelled container (CORE-06).
  async create(req: CreateRequest): Promise<{ readonly containerId: string }> {
    // Refuses before any libpod, OpenShell, or policy-file call when no supervisor is bound (fail closed).
    this.requireAgentOs();
    const runtime = loadRuntimeConfig({ ...this.config, workspaceRoot: req.workspaceRoot });
    const info = await this.libpod.info();
    const sessionId = req.idempotencyKey;
    const workloadBinary = runtime.workloadArgv[0];
    if (workloadBinary === undefined) {
      throw makeRealmError("SCHEMA_INVALID");
    }
    const policyPath = writePolicyDocument(runtime.stateDir, sessionId, this.egressAllow, workloadBinary);
    const containerId = await runOpenShellCreate(
      { containers: this.libpod, runner: this.runner },
      {
        sessionId,
        policyPath,
        cpus: SANDBOX_CPUS,
        memory: SANDBOX_MEMORY,
        imageRef: runtime.image,
      },
      OPENSHELL_CREATE_DEADLINE_MS,
    );
    const binding: HardeningBinding = {
      image: runtime.image,
      rootless: info.rootless,
      workspaceRoot: runtime.workspaceRoot,
      stateDir: runtime.stateDir,
    };
    await this.verifyOrRemove(containerId, binding);
    return { containerId };
  }

  // Checks the container is running. It starts nothing itself: the create ran with --detach. It starts
  // AgentOS through the supervisor, the only path that starts it (RT-04).
  async start(containerId: string): Promise<void> {
    const agentos = this.requireAgentOs();
    const inspect = await this.libpod.inspectContainer(containerId);
    if (inspect === null || !isRunning(inspect)) {
      throw makeRealmError("OPENSHELL_START_FAILED");
    }
    await agentos.start();
  }

  // Healthy only when the container runs and AgentOS reports alive. An unhealthy answer is a false result. A
  // failure to answer, such as a libpod error or AGENTOS_CRASH_LOOP, is thrown with its own code, so the lifecycle
  // records that code rather than a generic unhealthy result.
  async probe(containerId: string): Promise<ProbeResult> {
    const agentos = this.requireAgentOs();
    const inspect = await this.libpod.inspectContainer(containerId);
    if (inspect === null || !isRunning(inspect)) {
      return "unhealthy";
    }
    return (await agentos.check()) ? "healthy" : "unhealthy";
  }

  // Stops AgentOS, then the container. The container stop runs even when the AgentOS stop fails, so a
  // supervisor failure never leaves a running container behind. A container that is already gone
  // counts as stopped. With no supervisor bound there is no AgentOS step. A failed AgentOS stop is reported
  // as AGENTOS_STOP_FAILED after the container step.
  async stop(containerId: string): Promise<void> {
    const agentosStop = await this.stopAgentOs();
    if ((await this.libpod.inspectContainer(containerId)) !== null) {
      await this.libpod.stopContainer(containerId, CONTAINER_STOP_GRACE_MS);
    }
    if (!agentosStop.ok) {
      throw makeRealmError("AGENTOS_STOP_FAILED", agentosStop.causeCode);
    }
  }

  // Stops AgentOS, then force-removes the container, mirroring stop. A container that is already gone
  // counts as removed. The removal runs even when the AgentOS stop fails, and that failure is then reported
  // as AGENTOS_STOP_FAILED.
  async destroy(containerId: string): Promise<void> {
    const agentosStop = await this.stopAgentOs();
    await this.libpod.removeContainer(containerId, { force: true });
    if (!agentosStop.ok) {
      throw makeRealmError("AGENTOS_STOP_FAILED", agentosStop.causeCode);
    }
  }

  // Runs the AgentOS stop bounded by AGENTOS_STOP_DEADLINE_MS. A rejection or a missed deadline is a failed stop,
  // and its cause is kept in the result. With no supervisor bound there is nothing to stop, so the step counts as
  // stopped. The callers turn a failed stop into the typed AGENTOS_STOP_FAILED error after their container step.
  private async stopAgentOs(): Promise<AgentOsStop> {
    const agentos = this.agentos;
    if (agentos === undefined) {
      return { ok: true };
    }
    try {
      await withTimeout(agentos.stop(), AGENTOS_STOP_DEADLINE_MS, "AGENTOS_STOP_FAILED");
      return { ok: true };
    } catch (error) {
      // The deadline's own AGENTOS_STOP_FAILED adds nothing, so only a different code is kept as the cause.
      const code = catalogueCodeOf(error);
      return { ok: false, causeCode: code === "AGENTOS_STOP_FAILED" ? undefined : code };
    }
  }

  // Returns the bound supervisor, or throws AGENTOS_NOT_CONFIGURED. Create, start, and probe call it
  // before any libpod, OpenShell, or policy-file call, so no container is created without a supervisor.
  private requireAgentOs(): AgentOsSupervisor {
    if (this.agentos === undefined) {
      throw makeRealmError("AGENTOS_NOT_CONFIGURED");
    }
    return this.agentos;
  }

  // Returns only when the container conforms. Otherwise the container is removed before anything is
  // thrown. The removal is best effort: a container that survives it is still never returned as
  // running, and the down sweep is the backstop. The refusal keeps one libpod code as causeCode: the
  // removal's when the removal failed, since a surviving container is the worse outcome, else the inspect's.
  private async verifyOrRemove(containerId: string, binding: HardeningBinding): Promise<void> {
    let failed: readonly HardeningProperty[] | null;
    let inspectCause: ErrorCode | undefined;
    try {
      const inspect = await this.libpod.inspectContainer(containerId);
      failed = inspect === null ? null : verifyInspect(binding, attachKernelCaps(inspect, this.readProcStatus));
    } catch (error) {
      failed = null;
      inspectCause = catalogueCodeOf(error);
    }
    if (failed?.length === 0) {
      return;
    }
    let removeCause: ErrorCode | undefined;
    try {
      await this.libpod.removeContainer(containerId, { force: true });
    } catch (error) {
      removeCause = catalogueCodeOf(error);
    }
    const causeCode = removeCause ?? inspectCause;
    const first = failed?.[0];
    if (first !== undefined) {
      throw new HardeningFailedError(first, causeCode);
    }
    throw makeRealmError("OPENSHELL_START_FAILED", causeCode);
  }
}

// The running flag of a libpod inspect object. Anything other than a boolean true is not running.
// (The State.Running path is provisional, podman.md Q5.)
function isRunning(inspect: LibpodInspect): boolean {
  const state: unknown = inspect["State"];
  return typeof state === "object" && state !== null && Reflect.get(state, "Running") === true;
}

// The catalogue code of an error thrown by a libpod or AgentOS call, or undefined for any other error.
function catalogueCodeOf(error: unknown): ErrorCode | undefined {
  return error instanceof RealmError ? error.code : undefined;
}

// The zero-orphan sweep moved to sweep.ts (D-84). It is re-exported here so existing callers keep working.
export { removeAllRealmContainers, type SweepClient } from "./sweep.js";

// Picks the allowed names from a caller-supplied environment. The caller decides the source. Names
// that are absent from the source are left out, so the result never carries a made-up value.
export function selectOpenShellEnvironment(source: EnvironmentLike): Readonly<Record<string, string>> {
  const selected: Record<string, string> = {};
  for (const name of OPENSHELL_ENV_NAMES) {
    const value = source[name];
    if (value !== undefined) {
      selected[name] = value;
    }
  }
  return Object.freeze(selected);
}

// POSIX children lead their own process group, so a timeout reaches the helpers they fork. Windows has no
// such group here, and the child alone is killed there.
const OWN_PROCESS_GROUP = process.platform !== "win32";

// Kills the child and, on POSIX, the whole process group it leads. Returns false when the group could not be
// signalled. ESRCH means the group is already gone, so nothing is left to kill and that counts as signalled. The
// direct kill of the child runs in every case.
function killProcessTree(child: ChildProcess): boolean {
  let groupSignalled = true;
  if (OWN_PROCESS_GROUP && child.pid !== undefined) {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch (error) {
      const code: unknown = error instanceof Error ? Reflect.get(error, "code") : undefined;
      groupSignalled = code === "ESRCH";
    }
  }
  child.kill("SIGKILL");
  return groupSignalled;
}

// One captured output stream (D-94). It keeps at most OPENSHELL_OUTPUT_LIMIT_BYTES bytes and drops the
// rest, so memory stays bounded. It keeps reading after the bound, so a chatty child never blocks on a
// full pipe.
class BoundedOutput {
  private readonly chunks: Buffer[] = [];
  private size = 0;
  private cut = false;

  add(chunk: Buffer): void {
    const room = OPENSHELL_OUTPUT_LIMIT_BYTES - this.size;
    if (chunk.length <= room) {
      this.chunks.push(chunk);
      this.size += chunk.length;
      return;
    }
    this.chunks.push(chunk.subarray(0, room));
    this.size = OPENSHELL_OUTPUT_LIMIT_BYTES;
    this.cut = true;
  }

  text(): string {
    return Buffer.concat(this.chunks).toString("utf8");
  }

  truncated(): boolean {
    return this.cut;
  }
}

// The production OpenShell runner (RT-03, S-10, D-94). It starts argv[0] with the rest as arguments and no
// shell. The child gets exactly the environment it is given. Its output is discarded unless captureOutput is
// set; with it, each stream is kept up to OPENSHELL_OUTPUT_LIMIT_BYTES and truncated says whether a stream
// was cut. A process that misses timeoutMs is killed with its process group, so helpers it forked die too,
// and the call rejects with an OpenShellRunnerError. Failures carry a fixed message and kind, never the
// child's output or the spawn error's text.
export function spawnOpenShellRunner(environment: Readonly<Record<string, string>>): OpenShellRunner {
  const childEnvironment: Readonly<Record<string, string>> = Object.freeze({ ...environment });
  return (argv, options) =>
    new Promise<OpenShellRunOutcome>((resolve, reject) => {
      const file = argv[0];
      if (file === undefined) {
        reject(new OpenShellRunnerError("failed"));
        return;
      }
      const capture = options.captureOutput === true;
      const stdio: StdioOptions = capture ? ["ignore", "pipe", "pipe"] : "ignore";
      let child: ChildProcess;
      try {
        child = spawn(file, argv.slice(1), {
          shell: false,
          env: { ...childEnvironment },
          stdio,
          detached: OWN_PROCESS_GROUP,
        });
      } catch {
        reject(new OpenShellRunnerError("failed"));
        return;
      }
      const stdout = new BoundedOutput();
      const stderr = new BoundedOutput();
      if (capture) {
        child.stdout?.on("data", (chunk: Buffer) => { stdout.add(chunk); });
        child.stderr?.on("data", (chunk: Buffer) => { stderr.add(chunk); });
      }
      const timer = setTimeout(() => {
        // A group that could not be signalled may keep helpers alive, so the run fails rather than timing out cleanly.
        const contained = killProcessTree(child);
        reject(new OpenShellRunnerError(contained ? "timed-out" : "failed"));
      }, options.timeoutMs);
      child.once("error", () => {
        clearTimeout(timer);
        reject(new OpenShellRunnerError("failed"));
      });
      child.once("close", (code) => {
        clearTimeout(timer);
        const exitCode = code ?? 1;
        if (!capture) {
          resolve({ exitCode });
          return;
        }
        resolve({
          exitCode,
          stdout: stdout.text(),
          stderr: stderr.text(),
          truncated: stdout.truncated() || stderr.truncated(),
        });
      });
    });
}

// The production OpenShell runner for the environment the caller passes (RT-03, D-46). The
// composition root takes its runner here, so the spawn stays in this module.
export function productionOpenShellRunner(source: EnvironmentLike): OpenShellRunner {
  return spawnOpenShellRunner(selectOpenShellEnvironment(source));
}

// Runs one workload in a session's running sandbox through the injected runner (D-92, D-94). The argv is the
// pinned exec form from buildExecArgv, and output is captured and bounded per stream. A non-zero exit is a
// successful call carrying exitCode. A runner rejection maps to REALM_NOT_ACTIVE and a deadline expiry to
// TOOL_TIMEOUT; neither error carries child text. The runner stops the process at timeoutMs (D-91), so a
// timed-out call keeps nothing running.
export async function runSandboxExec(
  runner: OpenShellRunner,
  sessionId: string,
  workload: readonly string[],
  timeoutMs: number,
): Promise<OpenShellRunOutcome> {
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  const argv = buildExecArgv(sessionId, workload);
  try {
    return await runner(argv, { timeoutMs, captureOutput: true });
  } catch (error) {
    const timedOut = error instanceof OpenShellRunnerError && error.kind === "timed-out";
    throw makeRealmError(timedOut ? "TOOL_TIMEOUT" : "REALM_NOT_ACTIVE");
  }
}

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
// container is created. stop and destroy still stop and remove the container, and delete the session's realm sandbox: with
// no AgentOS step to run, there is nothing to stop first.
//
// Sweep (D-68, RT-09, D-84): the zero-orphan sweep lives in sweep.ts and is re-exported below so existing
// callers keep working. It removes every realm-labelled container and proves zero survivors.

import { spawn, type ChildProcess, type StdioOptions } from "node:child_process";
import { realpathSync } from "node:fs";
import { isAbsolute } from "node:path";
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
import { attachRuntimeEvidence } from "./create-evidence.js";
import { liveCapabilityFailures, readHostProcStatus, type LiveProperty } from "./kernel-caps.js";
import { readHostOciConfig } from "./seccomp-evidence.js";
import { sandboxBindingOf } from "./driver/sandbox-binding.js";
import {
  buildExecArgv,
  deleteSandbox,
  sessionOfRealmSandbox,
  OPENSHELL_OUTPUT_LIMIT_BYTES,
  OpenShellRunnerError,
  GATEWAY_SANDBOX_NAME_MAX_LENGTH,
  realmSandboxName,
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
// Bound on the delete of one session's realm sandbox in stop() and destroy(). A delete that misses it is a failed stop.
const SANDBOX_DELETE_DEADLINE_MS = 15_000;
// The sandbox limits come from the frozen profile, so they cannot drift from the verifier.
export const SANDBOX_CPUS = HARDENING_PROFILE.nanoCpus / 1_000_000_000;
export const SANDBOX_MEMORY = `${String(HARDENING_PROFILE.memoryBytes / 1024 ** 3)}Gi`;
// The workload binary the policy document names: the node binary in the AgentOS image, which runs the runner child.
export const AGENTOS_WORKLOAD_BINARY = "/usr/local/bin/node";

// The only environment names the OpenShell CLI receives. Each one is needed by the CLI to locate its
// configuration and the rootless Podman socket. No other name crosses from the host.
export const OPENSHELL_ENV_NAMES: readonly string[] = Object.freeze(["PATH", "HOME", "XDG_RUNTIME_DIR"]);

// The libpod calls the composition needs. The closed client satisfies it.
export type SessionContainers = Pick<
  LibpodClient,
  "info" | "inspectContainer" | "listContainersByLabel" | "stopContainer" | "removeContainer"
>;

// The AgentOS supervisor of one session, the same object for the same session on every call. The daemon builds it over the
// bound driver; each supervisor drives one session's sandbox only.
export type SupervisorFor = (sessionId: string) => AgentOsSupervisor;

export interface SessionExecutionOptions {
  readonly libpod: SessionContainers;
  readonly runner: OpenShellRunner;
  // Optional. Makes the AgentOS supervisor of one session. It returns the same supervisor for the same session on every call,
  // so a session's supervision state is one object. With no supervisor bound, every runtime-touching operation fails closed.
  readonly agentosFor?: SupervisorFor;
  // The workspace root is per session and comes from the create request.
  readonly config: Omit<RuntimeConfig, "workspaceRoot">;
  // The realm secret root from config.json (runtimeRootsOf). The sandbox binding derives the channel
  // directory from it. Absent or relative, a create is refused before any libpod, OpenShell, or policy-file call.
  readonly secretRoot?: string;
  // The pinned workspace root from config.json, mounted at /workspace. The sandbox
  // binding derives the workspace mount from it, so the session's verifier and the driver share one derivation. Absent or
  // relative, a create is refused before any libpod, OpenShell, or policy-file call.
  readonly pinnedWorkspaceRoot?: string;
  // The driver's sandbox state root from config.json. The sandbox binding names each
  // sandbox's state directory under it. Absent or relative, a create is refused before any libpod, OpenShell, or policy-file call.
  readonly sandboxStateRoot?: string;
  // The session's egress allowlist, fixed for the session (D-106, OQ-P4-10). It arrives untrusted and is
  // validated by the constructor, so an invalid list throws SCHEMA_INVALID before any create.
  readonly egressAllow: unknown;
  // Reads the text of a host process's status file. The create-time check reads the container's init process
  // through it, to prove its capability sets are empty (D-51). Defaults to the host's /proc.
  readonly readProcStatus?: (pid: number) => string;
  // Reads the text of a container's OCI config file, to prove its seccomp profile denies the keyring syscalls. Defaults to a host read bounded to 1 MiB.
  readonly readOciConfig?: (path: string) => string;
  // Bound on the AgentOS stop in stop() and destroy(). Defaults to AGENTOS_STOP_DEADLINE_MS.
  readonly stopDeadlineMs?: number;
}

// A container whose hardening check failed. It carries the first failed property of the D-51 list,
// which is a fixed name from the profile and never caller text. The error code is still
// OPENSHELL_START_FAILED, and causeCode is the libpod code the refusal rests on, when there is one.
export class HardeningFailedError extends RealmError {
  readonly property: HardeningProperty | LiveProperty;

  constructor(property: HardeningProperty | LiveProperty, causeCode?: ErrorCode) {
    super("OPENSHELL_START_FAILED", causeCode);
    this.property = property;
  }
}

// The outcome of one stop step: the AgentOS stop, the container step, or the session sandbox delete. A failed step carries the
// catalogue code of its error as its cause, when that error has a code other than the stop's own.
type StopStep = { readonly ok: true } | { readonly ok: false; readonly causeCode: ErrorCode | undefined };

// A step that passed, and a failed step that has no cause code.
const STEP_OK: StopStep = { ok: true };
const STEP_FAILED: StopStep = { ok: false, causeCode: undefined };

// One session create in flight. A stop or destroy that names its sandbox marks it stopped and waits for done. The container
// the create produced is recorded in containerId as soon as runOpenShellCreate returns it.
interface PendingCreate {
  readonly sandbox: string;
  stopped: boolean;
  containerId: string | undefined;
  readonly done: Promise<void>;
  readonly finish: () => void;
}

function startPendingCreate(sandbox: string): PendingCreate {
  let finish: () => void = () => undefined;
  const done = new Promise<void>((resolve) => {
    finish = () => {
      resolve();
    };
  });
  return { sandbox, stopped: false, containerId: undefined, done, finish };
}

export class SessionExecution implements ExecutionService {
  private readonly libpod: SessionContainers;
  private readonly runner: OpenShellRunner;
  private readonly agentosFor: SupervisorFor | undefined;
  private readonly config: Omit<RuntimeConfig, "workspaceRoot">;
  private readonly secretRoot: string | undefined;
  private readonly pinnedWorkspaceRoot: string | undefined;
  private readonly sandboxStateRoot: string | undefined;
  private readonly egressAllow: readonly EgressRule[];
  private readonly readProcStatus: (pid: number) => string;
  private readonly readOciConfig: (path: string) => string;
  private readonly stopDeadlineMs: number;
  // Sandbox names this instance has deleted with no create since, so a repeated stop makes no second delete call.
  private readonly deletedSandboxes = new Set<string>();
  // The sandbox name known for each container id, recorded when a create or a stop names it and cleared by a successful delete.
  // It is a cache only: a stop or destroy deletes the sandbox its caller names, and no lookup reads this map. In memory only.
  private readonly pendingDeletes = new Map<string, string>();
  // Session creates in flight. A stop or destroy that names a sandbox waits for them (B-3).
  private readonly pendingCreates = new Set<PendingCreate>();

  // The egress list is validated here, before any create can run (D-106). An invalid list throws, and
  // no OpenShell or libpod call has been made by then.
  constructor(options: SessionExecutionOptions) {
    this.egressAllow = validateEgressAllow(options.egressAllow);
    this.libpod = options.libpod;
    this.runner = options.runner;
    this.readProcStatus = options.readProcStatus ?? readHostProcStatus;
    this.readOciConfig = options.readOciConfig ?? readHostOciConfig;
    this.agentosFor = options.agentosFor;
    this.config = options.config;
    this.secretRoot = options.secretRoot;
    this.pinnedWorkspaceRoot = options.pinnedWorkspaceRoot;
    this.sandboxStateRoot = options.sandboxStateRoot;
    this.stopDeadlineMs = options.stopDeadlineMs ?? AGENTOS_STOP_DEADLINE_MS;
    if (!(this.stopDeadlineMs > 0) || !Number.isFinite(this.stopDeadlineMs)) {
      throw new RangeError("the AgentOS stop deadline must be a positive finite number");
    }
  }

  // The session id is the idempotency key, so a repeated create for one session reuses its
  // labelled container (CORE-06).
  async create(req: CreateRequest): Promise<{ readonly containerId: string }> {
    // Refuses before any libpod, OpenShell, or policy-file call when no supervisor is bound (fail closed).
    const agentos = this.requireAgentOs(req.idempotencyKey);
    const secretRoot = this.requireSecretRoot();
    const pinnedWorkspaceRoot = this.requirePinnedWorkspaceRoot();
    const sandboxStateRoot = this.requireSandboxStateRoot();
    // The sandbox mounts the pinned root at /workspace, while the file tools use the policy-approved workspace the request names.
    // The two must be one directory, or exec would reach files the policy never approved. Refused before any libpod, OpenShell,
    // or policy-file call.
    requireSameDirectory(req.workspaceRoot, pinnedWorkspaceRoot);
    // The gateway refuses a longer sandbox name with an opaque create failure. This runs after the configuration
    // checks and before any libpod, OpenShell, or policy-file call.
    if (realmSandboxName(req.idempotencyKey).length > GATEWAY_SANDBOX_NAME_MAX_LENGTH) {
      throw makeRealmError("SCHEMA_INVALID");
    }
    // Registered before the first await, so a stop that names this sandbox from here on waits for this create (B-3).
    const sandbox = realmSandboxName(req.idempotencyKey);
    // A create makes a new sandbox, so a delete recorded for this name earlier no longer counts.
    this.deletedSandboxes.delete(sandbox);
    const pending = startPendingCreate(sandbox);
    this.pendingCreates.add(pending);
    try {
      const runtime = loadRuntimeConfig({ ...this.config, workspaceRoot: req.workspaceRoot });
      const info = await this.libpod.info();
      const sessionId = req.idempotencyKey;
      // The sandbox binding is the one derivation the driver builds this sandbox's mounts from (C2).
      const binding: HardeningBinding = {
        image: runtime.image,
        rootless: info.rootless,
        ...sandboxBindingOf({ workspaceRoot: pinnedWorkspaceRoot, stateRoot: sandboxStateRoot, secretRoot }, sandbox),
      };
      const policyPath = writePolicyDocument(runtime.stateDir, sessionId, this.egressAllow, AGENTOS_WORKLOAD_BINARY);
      let containerId: string;
      try {
        containerId = await runOpenShellCreate(
          { containers: this.libpod, createSandbox: (createRequest, timeoutMs) => agentos.create(createRequest, timeoutMs) },
          {
            sessionId,
            policyPath,
            cpus: SANDBOX_CPUS,
            memory: SANDBOX_MEMORY,
            imageRef: runtime.image,
          },
          OPENSHELL_CREATE_DEADLINE_MS,
        );
        // Recorded as soon as the create returns it, so a stop that waited for this create acts on this container. The sandbox
        // exists again from here, so a delete recorded for its name earlier no longer counts.
        pending.containerId = containerId;
        this.deletedSandboxes.delete(sandbox);
        await this.verifyOrRemove(containerId, binding);
      } catch (error) {
        // From the OpenShell create to here, any throw leaves a sandbox with no owner, so its delete runs now. A failed delete is
        // reported as AGENTOS_STOP_FAILED, keeping the original code as its cause. Otherwise the original error is rethrown.
        if (!(await this.deleteNamedSandbox(sandbox))) {
          throw makeRealmError("AGENTOS_STOP_FAILED", catalogueCodeOf(error));
        }
        throw error;
      }
      // The sandbox name is known for the container this create produced before any libpod call on it, so a stop or destroy
      // whose inspect rejects still deletes it (B-1). The entry is cleared only by a successful delete.
      this.pendingDeletes.set(containerId, sandbox);
      // A stop that named this sandbox while the create ran waits for it, then stops and deletes the container it produced.
      // This create reports no success: it runs that same cleanup, then throws.
      if (pending.stopped) {
        throwIfStopFailed(await this.endContainer(containerId, sandbox, "remove"));
        throw makeRealmError("OPENSHELL_START_FAILED");
      }
      return { containerId };
    } finally {
      this.pendingCreates.delete(pending);
      pending.finish();
    }
  }

  // Checks the container is running. It starts nothing itself: the create ran with --detach. It starts the AgentOS runner
  // in the session's sandbox through the supervisor, the only path that starts it (RT-04).
  async start(containerId: string, sandbox: string): Promise<void> {
    const agentos = this.requireAgentOs(sessionOf(sandbox));
    const inspect = await this.libpod.inspectContainer(containerId);
    if (inspect === null || !isRunning(inspect)) {
      throw makeRealmError("OPENSHELL_START_FAILED");
    }
    await agentos.start();
  }

  // Healthy only when the container runs and AgentOS reports alive. An unhealthy answer is a false result. A
  // failure to answer, such as a libpod error or AGENTOS_CRASH_LOOP, is thrown with its own code, so the lifecycle
  // records that code rather than a generic unhealthy result.
  async probe(containerId: string, sandbox: string): Promise<ProbeResult> {
    const agentos = this.requireAgentOs(sessionOf(sandbox));
    const inspect = await this.libpod.inspectContainer(containerId);
    if (inspect === null || !isRunning(inspect)) {
      return "unhealthy";
    }
    return (await agentos.check()) ? "healthy" : "unhealthy";
  }

  // Stops AgentOS, then the container, then deletes the session's realm sandbox. The caller names the sandbox, and the name is
  // required: it is always realm-<sessionId>, the name the create gave the session. containerId is the session's container id,
  // or the sandbox name while the create that makes the container has not returned its id. A call without a realm sandbox name
  // is refused with AGENTOS_STOP_FAILED before any libpod, OpenShell, or AgentOS call. A stop that names a sandbox with a create
  // in flight waits for that create, for at most stopDeadlineMs, and acts on the container it produced. If that wait expires, the
  // stop still stops and deletes what it knows, then reports AGENTOS_STOP_FAILED: the create may finish later (open item). Every
  // step is attempted, and the first failed step is reported as AGENTOS_STOP_FAILED with its cause code.
  async stop(containerId: string, sandbox: string): Promise<void> {
    await this.endSession(containerId, sandbox, "stop");
  }

  // Stops AgentOS, force-removes the container, and deletes the session's realm sandbox, mirroring stop with the same name
  // contract. A container that is already gone counts as removed. The removal runs even when the AgentOS stop fails.
  async destroy(containerId: string, sandbox: string): Promise<void> {
    await this.endSession(containerId, sandbox, "remove");
  }

  // The shared body of stop and destroy. The name is checked first, so a refused call reaches no later step.
  private async endSession(containerId: string, sandbox: string, mode: "stop" | "remove"): Promise<void> {
    const { name, sessionId } = requireSandbox(sandbox);
    const waited = await this.settleCreatesFor(containerId, name);
    const agentosStop = await this.stopAgentOs(sessionId);
    const containerAndSandbox = await this.endContainer(waited.target, name, mode);
    throwIfStopFailed([agentosStop, waited.settled ? STEP_OK : STEP_FAILED, ...containerAndSandbox]);
  }

  // Waits, for at most stopDeadlineMs, for each in-flight session create of the sandbox, marking each stopped (B-3). The target
  // is the container the last such create produced, or containerId when none produced one. settled is false when the wait
  // expired, and the stop then reports AGENTOS_STOP_FAILED, never success.
  private async settleCreatesFor(
    containerId: string,
    sandbox: string,
  ): Promise<{ readonly target: string; readonly settled: boolean }> {
    const waited = [...this.pendingCreates].filter((pending) => pending.sandbox === sandbox);
    for (const pending of waited) {
      pending.stopped = true;
    }
    const settled = await withTimeout(
      Promise.all(waited.map((pending) => pending.done)),
      this.stopDeadlineMs,
      "AGENTOS_STOP_FAILED",
    ).then(
      () => true,
      () => false,
    );
    let target = containerId;
    for (const pending of waited) {
      if (pending.containerId !== undefined) {
        target = pending.containerId;
      }
    }
    return { target, settled };
  }

  // The container step of stop (stop the container) or destroy (remove it), then the session sandbox delete. The name is the one
  // the caller gave, recorded against the container id before the container step. Both steps are attempted, and each failure is
  // returned as its own step, so a failed container step does not drop a failed delete.
  private async endContainer(containerId: string, sandbox: string, mode: "stop" | "remove"): Promise<readonly StopStep[]> {
    this.pendingDeletes.set(containerId, sandbox);
    const container = await this.containerStep(containerId, mode);
    const sandboxStop = await this.deleteSessionSandbox(containerId, sandbox);
    return [container, sandboxStop];
  }

  // The inspect, then the container step. A rejected inspect is a failed step, and the container step is then skipped. A stop of
  // a container the inspect reports gone is skipped too. A removal is sent regardless, since a gone container counts as removed.
  private async containerStep(containerId: string, mode: "stop" | "remove"): Promise<StopStep> {
    try {
      const inspect = await this.libpod.inspectContainer(containerId);
      if (mode === "remove") {
        await this.libpod.removeContainer(containerId, { force: true });
      } else if (inspect !== null) {
        await this.libpod.stopContainer(containerId, CONTAINER_STOP_GRACE_MS);
      }
      return STEP_OK;
    } catch (error) {
      return { ok: false, causeCode: catalogueCodeOf(error) };
    }
  }

  // Runs the AgentOS stop bounded by stopDeadlineMs. A rejection or a missed deadline is a failed stop, and its cause is
  // kept in the result. With no supervisor bound there is nothing to stop, so the step counts as stopped. A driver stop
  // that outlives the budget keeps running in the driver, but this step reports the stop as failed, never as success (N5).
  private async stopAgentOs(sessionId: string): Promise<StopStep> {
    const agentosFor = this.agentosFor;
    if (agentosFor === undefined) {
      return { ok: true };
    }
    try {
      await withTimeout(agentosFor(sessionId).stop(), this.stopDeadlineMs, "AGENTOS_STOP_FAILED");
      return { ok: true };
    } catch (error) {
      // The deadline's own AGENTOS_STOP_FAILED adds nothing, so only a different code is kept as the cause.
      const code = catalogueCodeOf(error);
      return { ok: false, causeCode: code === "AGENTOS_STOP_FAILED" ? undefined : code };
    }
  }

  // Deletes the session's realm sandbox the caller named. A name this instance has deleted with no create since is not deleted
  // again. A failed or missed delete is a failed step, and the name stays owed to the container until a delete succeeds.
  private async deleteSessionSandbox(containerId: string, sandbox: string): Promise<StopStep> {
    if (!this.deletedSandboxes.has(sandbox) && !(await this.deleteNamedSandbox(sandbox))) {
      return STEP_FAILED;
    }
    this.pendingDeletes.delete(containerId);
    return STEP_OK;
  }

  // One bounded delete of a realm sandbox. It resolves true only when the delete exits 0 within SANDBOX_DELETE_DEADLINE_MS, and
  // the runner is killed at the same bound. A success is recorded, so a repeated stop makes no second delete call.
  private async deleteNamedSandbox(sandbox: string): Promise<boolean> {
    const deleted = await withTimeout(
      deleteSandbox(this.runner, sandbox, SANDBOX_DELETE_DEADLINE_MS),
      SANDBOX_DELETE_DEADLINE_MS,
      "AGENTOS_STOP_FAILED",
    ).catch(() => false);
    if (deleted) {
      this.deletedSandboxes.add(sandbox);
    }
    return deleted;
  }

  // Returns the bound supervisor, or throws AGENTOS_NOT_CONFIGURED. Create, start, and probe call it
  // before any libpod, OpenShell, or policy-file call, so no container is created without a supervisor.
  private requireAgentOs(sessionId: string): AgentOsSupervisor {
    if (this.agentosFor === undefined) {
      throw makeRealmError("AGENTOS_NOT_CONFIGURED");
    }
    return this.agentosFor(sessionId);
  }

  // The realm secret root the sandbox binding derives from. Absent or relative, the create is refused with SCHEMA_INVALID before any
  // libpod, OpenShell, or policy-file call.
  private requireSecretRoot(): string {
    if (this.secretRoot === undefined || !isAbsolute(this.secretRoot)) {
      throw makeRealmError("SCHEMA_INVALID");
    }
    return this.secretRoot;
  }

  // The pinned workspace root the sandbox binding derives from. Absent or relative, the create is refused with SCHEMA_INVALID
  // before any libpod, OpenShell, or policy-file call.
  private requirePinnedWorkspaceRoot(): string {
    if (this.pinnedWorkspaceRoot === undefined || !isAbsolute(this.pinnedWorkspaceRoot)) {
      throw makeRealmError("SCHEMA_INVALID");
    }
    return this.pinnedWorkspaceRoot;
  }

  // The driver's sandbox state root the sandbox binding derives each state directory from. Absent or relative, the create is refused
  // with SCHEMA_INVALID before any libpod, OpenShell, or policy-file call.
  private requireSandboxStateRoot(): string {
    if (this.sandboxStateRoot === undefined || !isAbsolute(this.sandboxStateRoot)) {
      throw makeRealmError("SCHEMA_INVALID");
    }
    return this.sandboxStateRoot;
  }

  // Returns only when the container conforms. Otherwise the container is removed before anything is
  // thrown. The removal is best effort: a container that survives it is still never returned as
  // running, and the down sweep is the backstop. The refusal keeps one libpod code as causeCode: the
  // removal's when the removal failed, since a surviving container is the worse outcome, else the inspect's.
  private async verifyOrRemove(containerId: string, binding: HardeningBinding): Promise<void> {
    let failed: readonly (HardeningProperty | LiveProperty)[] | null;
    let inspectCause: ErrorCode | undefined;
    try {
      const inspect = await this.libpod.inspectContainer(containerId);
      const attached = inspect === null ? null : attachRuntimeEvidence(inspect, this.readOciConfig, this.readProcStatus);
      failed =
        attached === null ? null : [...verifyInspect(binding, attached), ...liveCapabilityFailures(attached)];
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

// Refuses with POLICY_DENIED unless both absolute paths name the same directory once symlinks are resolved. A path that cannot be
// resolved is refused too. The error carries no path.
function requireSameDirectory(requested: string, pinned: string): void {
  let requestedReal: string;
  let pinnedReal: string;
  try {
    requestedReal = realpathSync(requested);
    pinnedReal = realpathSync(pinned);
  } catch {
    throw makeRealmError("POLICY_DENIED");
  }
  if (requestedReal !== pinnedReal) {
    throw makeRealmError("POLICY_DENIED");
  }
}

// The running flag of a libpod inspect object. Anything other than a boolean true is not running.
// (The State.Running path is provisional, podman.md Q5.)
function isRunning(inspect: LibpodInspect): boolean {
  const state: unknown = inspect["State"];
  return typeof state === "object" && state !== null && Reflect.get(state, "Running") === true;
}

// Throws AGENTOS_STOP_FAILED when any stop step failed. The cause is the first defined cause code among the failed steps, in
// order, so a step that failed without a code does not hide a later step's code.
function throwIfStopFailed(steps: readonly StopStep[]): void {
  let failed = false;
  let causeCode: ErrorCode | undefined;
  for (const step of steps) {
    if (!step.ok) {
      failed = true;
      if (causeCode === undefined) {
        causeCode = step.causeCode;
      }
    }
  }
  if (failed) {
    throw makeRealmError("AGENTOS_STOP_FAILED", causeCode);
  }
}

// Returns the sandbox name a stop or destroy was given, with the session it belongs to. A missing name, or one the realm did
// not create, is refused with AGENTOS_STOP_FAILED, so the refused call reaches no libpod, OpenShell, or AgentOS step.
function requireSandbox(sandbox: string): { readonly name: string; readonly sessionId: string } {
  const sessionId = sessionOfRealmSandbox(sandbox);
  if (sessionId === undefined) {
    throw makeRealmError("AGENTOS_STOP_FAILED");
  }
  return { name: sandbox, sessionId };
}

// The session a sandbox named by a start or a probe belongs to. A name the realm did not create is refused with SCHEMA_INVALID,
// before any libpod or AgentOS call.
function sessionOf(sandbox: string): string {
  const sessionId = sessionOfRealmSandbox(sandbox);
  if (sessionId === undefined) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  return sessionId;
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

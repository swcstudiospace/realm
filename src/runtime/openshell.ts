// OpenShell adapter (RT-03, D-55 to D-57, S-10). This module is the only path by which agent
// workload code is started. It builds the pinned `openshell sandbox create` and `sandbox exec` argv,
// writes the policy document, and runs create idempotently by label.
//
// The argv is an array with no shell. The builder never emits --env or --provider (AUD-02),
// so no host environment variable or credential crosses into the sandbox. The pinned verbs
// are the locally verified 0.1.5 set (S-10).
//
// The runner is injected. It must start argv[0] with the remaining elements as arguments, no
// shell, and must stop the process when timeoutMs expires. withTimeout only rejects and cannot
// cancel, so the runner owns its own cancellation (F-P3-05). A runner failure or a missed
// deadline never reaches a caller as a raw message: both are OPENSHELL_START_FAILED. A libpod
// failure before create propagates the client's own code, because it says why the start could
// not be checked.

import { mkdirSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { performance } from "node:perf_hooks";
import { makeRealmError, RealmError, type ErrorCode } from "../core/errors.js";
import type { EgressRule } from "../contract/validate.js";
import { withTimeout } from "../core/timeout.js";
import { atomicWriteFile, observeSha256 } from "../fs/atomic-write.js";
import { bindRoot } from "../fs/root.js";
import { isSessionId, recordFileName } from "../session/paths.js";
import type { LibpodClient, LibpodContainerSummary } from "./libpod-client.js";
import { renderNetworkPolicies, type NetworkPolicies } from "./egress.js";

export const OPENSHELL_BINARY = "openshell";
// OpenShell labels every sandbox container it creates with the sandbox name and its own managed marker.
// The realm owns the sandboxes whose names start with REALM_SANDBOX_NAME_PREFIX. OpenShell 0.1.5 does not
// apply the --label values the realm used to pass, so these OpenShell keys are the ownership signal.
export const OPENSHELL_MANAGED_LABEL_KEY = "openshell.managed";
export const OPENSHELL_MANAGED_LABEL_VALUE = "true";
export const OPENSHELL_SANDBOX_NAME_LABEL_KEY = "openshell.ai/sandbox-name";
export const REALM_SANDBOX_NAME_PREFIX = "realm-";
// OpenShell labels a sandbox's workload container with the sandbox role, and its supervisor container with the
// supervisor role. Both carry the sandbox name, so the session's container is the sandbox-role one.
export const OPENSHELL_ISOLATION_ROLE_LABEL_KEY = "openshell.ai/isolation-role";
export const OPENSHELL_SANDBOX_ROLE_VALUE = "sandbox";

// The session's workload containers out of the sandbox-role listing: the ones under the session's sandbox
// name. The supervisor container of the same sandbox carries that name too, but its role is supervisor, so
// the role listing never includes it.
function sessionWorkloads(listed: readonly LibpodContainerSummary[], sessionId: string): LibpodContainerSummary[] {
  const name = realmSandboxName(sessionId);
  return listed.filter((container) => container.labels?.[OPENSHELL_SANDBOX_NAME_LABEL_KEY] === name);
}

// The sandbox name the realm gives a session. The session's container carries it as its sandbox-name label.
export function realmSandboxName(sessionId: string): string {
  return `${REALM_SANDBOX_NAME_PREFIX}${sessionId}`;
}

// True for a sandbox name the realm created. An absent name is never the realm's.
export function isRealmSandboxName(name: string | undefined): boolean {
  return name !== undefined && name.startsWith(REALM_SANDBOX_NAME_PREFIX);
}

// The session a realm sandbox name belongs to: the name without its realm- prefix, when that id passes the session rule. Any
// other name, an absent one included, has no session, so the caller refuses it.
export function sessionOfRealmSandbox(sandboxName: string | undefined): string | undefined {
  if (sandboxName === undefined || !isRealmSandboxName(sandboxName)) {
    return undefined;
  }
  const sessionId = sandboxName.slice(REALM_SANDBOX_NAME_PREFIX.length);
  return isSessionId(sessionId) ? sessionId : undefined;
}

// The in-sandbox workspace path (OQ-P3-02 default).
export const SANDBOX_WORKSPACE_PATH = "/workspace";
// The system paths a workload reads and executes. Landlock grants no execute right on a path outside the
// policy, so an empty list makes every system binary unrunnable (the supervisor denies the spawn).
export const SANDBOX_SYSTEM_READ_ONLY_PATHS: readonly string[] = Object.freeze([
  "/usr",
  "/bin",
  "/lib",
  "/lib64",
  "/etc",
  "/opt",
  "/proc",
  "/dev/urandom",
  "/dev/zero",
  "/dev/random",
]);
// The writable scratch paths besides the workspace. The native sidecar keeps temporary state in /tmp.
export const SANDBOX_SCRATCH_PATHS: readonly string[] = Object.freeze(["/tmp"]);
// The one writable device: shell redirects to /dev/null must succeed. No other device is writable.
export const SANDBOX_WRITABLE_DEVICE_PATHS: readonly string[] = Object.freeze(["/dev/null"]);

const POLL_INTERVAL_MS = 250;
const RUNTIME_DIR_NAME = "runtime";
const RUNTIME_DIR_MODE = 0o700;
// A positive integer with an optional unit. A leading "-" can never match, so the value cannot
// be read as a flag by the CLI parser.
const MEMORY_PATTERN = /^[1-9][0-9]{0,11}(?:[KMG]i?)?$/;

export interface OpenShellRunOptions {
  // The runner must stop the process when this many milliseconds pass.
  readonly timeoutMs: number;
  // Opt-in (D-94, C-6). Only exec reads output, so the create path leaves this unset and the runner
  // keeps its stdio ignored.
  readonly captureOutput?: boolean;
}

// The bound on each captured output stream (D-94). Bytes beyond it are dropped and truncated is set.
export const OPENSHELL_OUTPUT_LIMIT_BYTES = 262144;

export interface OpenShellRunOutcome {
  readonly exitCode: number;
  // Present only when the run was started with captureOutput. Each stream holds at most
  // OPENSHELL_OUTPUT_LIMIT_BYTES bytes; truncated is true when either stream was cut.
  readonly stdout?: string;
  readonly stderr?: string;
  readonly truncated?: boolean;
}

// The kinded rejection of a runner (D-94, C-6). The message is fixed text and never carries child
// output, so a caller maps the kind instead of matching message text.
export class OpenShellRunnerError extends Error {
  readonly kind: "failed" | "timed-out";

  constructor(kind: "failed" | "timed-out") {
    super(kind === "timed-out" ? "openshell runner exceeded its budget" : "openshell runner failed");
    this.name = "OpenShellRunnerError";
    this.kind = kind;
  }
}

// Runs argv (argv[0] is the binary) with no shell. Resolves with the exit status. Rejects when the
// process cannot be started. Callers never copy that rejection's message into an error.
export type OpenShellRunner = (
  argv: readonly string[],
  options: OpenShellRunOptions,
) => Promise<OpenShellRunOutcome>;

export interface SandboxCreateRequest {
  readonly sessionId: string;
  readonly policyPath: string;
  readonly cpus: number;
  readonly memory: string;
  // Optional. The container image reference for the sandbox source (OpenShell --from). Sessions omit it.
  readonly imageRef?: string;
}

export interface OpenShellCreateDeps {
  readonly containers: Pick<LibpodClient, "listContainersByLabel">;
  // The sandbox create for the request, bounded by timeoutMs. The AgentOS driver is the only implementation; it runs the create argv once.
  readonly createSandbox: (request: SandboxCreateRequest, timeoutMs: number) => Promise<void>;
}

// The pinned create argv for one session (D-55). It names the sandbox and carries the policy, the limits and the
// optional image, and no command. OpenShell 0.1.5 does not run a create command, so the AgentOS runner is started
// as an exec child after create (agentos-workload.ts). Every refused input is SCHEMA_INVALID, and the check runs
// before any I/O.
export function buildCreateArgv(request: SandboxCreateRequest): readonly string[] {
  // The session id is checked by the rule that names its record file (SESSION_ID_PATTERN).
  recordFileName(request.sessionId);
  if (!isAbsolute(request.policyPath)) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  if (!Number.isInteger(request.cpus) || request.cpus < 1) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  if (!MEMORY_PATTERN.test(request.memory)) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  if (request.imageRef !== undefined && request.imageRef.length === 0) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  return Object.freeze([
    OPENSHELL_BINARY,
    "sandbox",
    "create",
    "--name",
    `realm-${request.sessionId}`,
    "--policy",
    request.policyPath,
    "--no-auto-providers",
    "--detach",
    "--cpu",
    String(request.cpus),
    "--memory",
    request.memory,
    ...(request.imageRef === undefined ? [] : ["--from", request.imageRef]),
  ]);
}

// The AgentOS driver's sandbox argv (D-014, D-016, D-018). The runner is the exec form that starts the AgentOS runner in
// the sandbox, and the probe is the same exec form running the probe. Both name the sandbox realm-<sessionId>, so they are
// built here, in one place. The sandbox itself is created by SessionExecution.create through buildCreateArgv and deleted by
// SessionExecution.stop through buildSandboxDeleteArgv; the driver never creates or deletes it.
export interface AgentOsSandboxRequest {
  readonly sessionId: string;
  readonly runnerPath: string;
  readonly probePath: string;
}

export interface AgentOsSandboxArgv {
  readonly runner: readonly string[];
  readonly probe: readonly string[];
}

export function buildAgentOsSandboxArgv(request: AgentOsSandboxRequest): AgentOsSandboxArgv {
  return Object.freeze({
    runner: buildExecArgv(request.sessionId, ["node", request.runnerPath]),
    probe: buildExecArgv(request.sessionId, ["node", request.probePath]),
  });
}

// The argv that deletes one realm sandbox by name (D-014). Only a name with the realm prefix is accepted, so the realm
// never deletes a sandbox it did not create.
export function buildSandboxDeleteArgv(sandboxName: string): readonly string[] {
  if (!isRealmSandboxName(sandboxName)) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  return Object.freeze([OPENSHELL_BINARY, "sandbox", "delete", sandboxName]);
}

// Deletes one realm sandbox and resolves true only when the delete exits 0 within timeoutMs. A refused name, a rejected
// run and a non-zero exit are all false, so no OpenShell text reaches the caller, which maps the false result to its code.
export async function deleteSandbox(runner: OpenShellRunner, sandboxName: string, timeoutMs: number): Promise<boolean> {
  try {
    const outcome = await runner(buildSandboxDeleteArgv(sandboxName), { timeoutMs });
    return outcome.exitCode === 0;
  } catch {
    return false;
  }
}

// The exec argv for one session's running sandbox (D-92, D-93). It is the pinned form: the verb and
// its four flags, then the workload after --. It never emits --env (AUD-02). The shell form is not
// built here; the dispatcher owns it behind checkExecPolicy.
export function buildExecArgv(sessionId: string, argv: readonly string[]): readonly string[] {
  recordFileName(sessionId);
  if (argv.length === 0 || argv.some((element) => element.length === 0)) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  return Object.freeze([
    OPENSHELL_BINARY,
    "sandbox",
    "exec",
    "--name",
    `realm-${sessionId}`,
    "--workdir",
    SANDBOX_WORKSPACE_PATH,
    "--no-tty",
    "--no-login-shell",
    "--",
    ...argv,
  ]);
}

// Creates the sandbox for one session and returns its container id (D-56, CORE-06).
//
// Flow: look up the labelled container first and return it without running anything if it
// exists; otherwise run deps.createSandbox once; then poll the label lookup every 250 ms until one
// container appears or the caller deadline expires. An ambiguous label match (more than one
// container) is refused at once and never retried. A transient libpod failure (socket refused or
// timed out) is polled through until the deadline; any other libpod failure ends the poll at once.
// Deadline expiry, a non-transient libpod failure and every create failure give
// OPENSHELL_START_FAILED. An ambiguous match gives OPENSHELL_LABEL_AMBIGUOUS. A libpod code, when
// one was involved, appears only as causeCode. No refusal carries container ids or libpod message text.
export async function runOpenShellCreate(
  deps: OpenShellCreateDeps,
  request: SandboxCreateRequest,
  deadlineMs: number,
): Promise<string> {
  if (!Number.isInteger(deadlineMs) || deadlineMs <= 0) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  // Refuses a malformed request before any I/O. The AgentOS driver builds the same create argv from the same request.
  buildCreateArgv(request);

  const existing = sessionWorkloads(
    await deps.containers.listContainersByLabel(OPENSHELL_ISOLATION_ROLE_LABEL_KEY, OPENSHELL_SANDBOX_ROLE_VALUE),
    request.sessionId,
  );
  if (existing.length > 0) {
    return singleId(existing);
  }

  const deadline = performance.now() + deadlineMs;
  const remaining = (): number => deadline - performance.now();

  try {
    const budget = remaining();
    if (budget <= 0) {
      throw makeRealmError("OPENSHELL_START_FAILED");
    }
    await withTimeout(deps.createSandbox(request, budget), budget, "OPENSHELL_START_FAILED");
  } catch {
    throw makeRealmError("OPENSHELL_START_FAILED");
  }

  let lastLibpodCode: ErrorCode | undefined;
  for (;;) {
    const left = remaining();
    if (left <= 0) {
      throw makeRealmError("OPENSHELL_START_FAILED", lastLibpodCode);
    }
    const lookup = await lookupWithinDeadline(deps.containers, request.sessionId, left);
    if (lookup.kind === "found" && lookup.containers.length > 0) {
      return singleId(lookup.containers);
    }
    if (lookup.kind === "deadline") {
      throw makeRealmError("OPENSHELL_START_FAILED", lastLibpodCode);
    }
    if (lookup.kind === "failed") {
      const failure = lookup.error;
      if (!(failure instanceof RealmError) || failure.code !== TRANSIENT_LIBPOD_CODE) {
        const causeCode = failure instanceof RealmError ? failure.code : undefined;
        throw makeRealmError("OPENSHELL_START_FAILED", causeCode);
      }
      lastLibpodCode = failure.code;
    }
    const wait = Math.min(POLL_INTERVAL_MS, remaining());
    if (wait > 0) {
      await sleep(wait);
    }
  }
}

// The policy document (D-57, D-81). It holds no secret and no environment variable. Its shape is a
// documented contract, so changing it is a costly change.
export interface PolicyDocument {
  readonly version: 1;
  readonly filesystem_policy: {
    readonly read_only: readonly string[];
    readonly read_write: readonly string[];
  };
  readonly landlock: { readonly compatibility: "hard_requirement" };
  readonly process: { readonly run_as_user: "sandbox"; readonly run_as_group: "sandbox" };
  // The D-78 rendering of the egress allowlist. Empty means deny-all egress (S-20).
  readonly network_policies: NetworkPolicies;
}

// Takes the session's egress allowlist and its absolute workload binary, and no other input, so no
// configuration field can reach the file. renderNetworkPolicies validates both.
export function buildPolicyDocument(egress: readonly EgressRule[], workloadBinary: string): PolicyDocument {
  return {
    version: 1,
    filesystem_policy: {
      read_only: [...SANDBOX_SYSTEM_READ_ONLY_PATHS],
      read_write: [SANDBOX_WORKSPACE_PATH, ...SANDBOX_SCRATCH_PATHS, ...SANDBOX_WRITABLE_DEVICE_PATHS],
    },
    landlock: { compatibility: "hard_requirement" },
    process: { run_as_user: "sandbox", run_as_group: "sandbox" },
    network_policies: renderNetworkPolicies(egress, workloadBinary),
  };
}

// Writes the session's policy document to <stateDir>/runtime/<sessionId>.policy.json through the
// atomic replace (D-57). Returns the path written. The file is 0600 because the atomic replace
// creates temp files at 0600 and carries over the mode of an existing file. The document is rendered
// before the runtime directory is created, so a refused allowlist or workload binary writes nothing.
export function writePolicyDocument(
  stateDir: string,
  sessionId: string,
  egress: readonly EgressRule[],
  workloadBinary: string,
): string {
  recordFileName(sessionId);
  if (!isAbsolute(stateDir)) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  const text = `${JSON.stringify(buildPolicyDocument(egress, workloadBinary), null, 2)}\n`;
  const dir = join(stateDir, RUNTIME_DIR_NAME);
  mkdirSync(dir, { recursive: true, mode: RUNTIME_DIR_MODE });
  const root = bindRoot(dir);
  const target = join(root.realPath, `${sessionId}.policy.json`);
  atomicWriteFile(target, text, { expectedPriorSha256: observeSha256(target) });
  return target;
}

// The one container id in a non-empty lookup result. More than one match for one session is refused
// at once and never retried, because it names no single sandbox.
function singleId(found: readonly { readonly id: string }[]): string {
  if (found.length > 1) {
    throw makeRealmError("OPENSHELL_LABEL_AMBIGUOUS");
  }
  if (found.length !== 1 || found[0] === undefined) {
    throw makeRealmError("OPENSHELL_START_FAILED");
  }
  return found[0].id;
}

// The libpod failure the poll rides out: the socket refused or a request timed out (D-53). Every other
// typed failure, such as a rejected status or a malformed body (SCHEMA_INVALID), ends the poll at once.
const TRANSIENT_LIBPOD_CODE: ErrorCode = "PODMAN_MACHINE_DOWN";

type LookupOutcome =
  | { readonly kind: "found"; readonly containers: readonly { readonly id: string }[] }
  | { readonly kind: "deadline" }
  | { readonly kind: "failed"; readonly error: unknown };

// One label lookup, bounded by the time left before the deadline. The deadline cutting the lookup
// off is its own outcome, so it is never mistaken for a libpod failure.
async function lookupWithinDeadline(
  containers: Pick<LibpodClient, "listContainersByLabel">,
  sessionId: string,
  leftMs: number,
): Promise<LookupOutcome> {
  try {
    const listed = await withTimeout(
      containers.listContainersByLabel(OPENSHELL_ISOLATION_ROLE_LABEL_KEY, OPENSHELL_SANDBOX_ROLE_VALUE),
      leftMs,
      "OPENSHELL_START_FAILED",
    );
    return { kind: "found", containers: sessionWorkloads(listed, sessionId) };
  } catch (error) {
    if (error instanceof RealmError && error.code === "OPENSHELL_START_FAILED") {
      return { kind: "deadline" };
    }
    return { kind: "failed", error };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

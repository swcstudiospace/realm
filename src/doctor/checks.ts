// Doctor core check runner (D-44, Phase 2 goal). Each check returns one result with an id,
// a status of pass, warn, or fail (F-10: a status shape distinct from the validate ok
// shape), a detail, and a fix. The fix is null only when the status is pass.
//
// Phase 2 registered three checks (D-44). Phase 3 adds four runtime items (RT-02, RT-03,
// ANDA-02; D-69): podman, podman-service, openshell, and anda-bridge. AgentOS and the
// control channel have no item in Phase 3, because nothing there can inspect them (D-69).
// Phase 6 appends control-channel and agentos to REGISTERED deliberately (CLI-03; P6-D6,
// P6-D14); the list is a costly change under D-44. Phase 9.7 appends host-binaries and
// kernel-hardening after agentos for the same reason.
//
// Details and fixes name paths, rules, and schema pointers. They never carry a value read
// from the policy file (the privacy rule in src/contract/validate.ts).

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { accessSync, constants, createReadStream, existsSync, readFileSync, statSync, type ReadStream, type Stats } from "node:fs";
import { request as httpRequest, type ClientRequest, type IncomingMessage, type RequestOptions } from "node:http";
import { request as httpsRequest } from "node:https";
import { createConnection } from "node:net";
import { dirname, isAbsolute, join } from "node:path";
import { ANDA_INFORMATION_PATH } from "../anda/client.js";
import { checkAppInformationShape } from "../anda/shape.js";
import { SchemaInvalidError } from "../contract/validate.js";
import { ERROR_CATALOGUE, RealmError } from "../core/errors.js";
import { loadPolicyFileDetailed, type LoadedPolicy } from "../core/policy.js";
import { withTimeout } from "../core/timeout.js";
import { buildCreateArgv, OPENSHELL_BINARY } from "../runtime/openshell.js";
import {
  probePodman,
  type CommandOptions,
  type CommandOutcome,
  type ConnectSocket,
  type PodmanProbeResult,
  type RunCommand,
} from "../runtime/podman-probe.js";
import { selectOpenShellEnvironment } from "../runtime/session-execution.js";
import { SOCKET_TIMEOUT_MS } from "../daemon/channel.js";
import { controlSocketPath, type EnvironmentLike, sessionsDirOf } from "../session/paths.js";
import type { RuntimeConfig } from "../runtime/config.js";
import { runtimeChecks, type RuntimeCheckOptions } from "./runtime-checks.js";
export type { ConnectSocket } from "../runtime/podman-probe.js";

export type CheckId =
  | "policy-file"
  | "state-dir"
  | "session-store"
  | "podman"
  | "podman-service"
  | "openshell"
  | "anda-bridge"
  | "control-channel"
  | "agentos"
  | "host-binaries"
  | "kernel-hardening"
  | "runtime-roots"
  | "driver-socket"
  | "gateway";
export type CheckStatus = "pass" | "warn" | "fail";

export interface CheckResult {
  readonly id: CheckId;
  readonly status: CheckStatus;
  readonly detail: string;
  readonly fix: string | null;
}

export interface DoctorOptions {
  // The explicit policy path (D-21). Undefined when the host configures none.
  readonly policyPath?: string;
  // The state directory (D-37), resolved by the caller.
  readonly stateDir: string;
  // Writability probe for the session store. The default is access(W_OK), which writes no
  // file (D-44). Tests inject a probe to exercise the unwritable outcome.
  readonly canWrite?: (path: string) => WriteReading;
  // Phase 3 seams (RT-02, ANDA-02). Each has a real default; tests inject fakes so that no
  // process runs and no socket opens. env is the host environment, handed in by the caller at the entry
  // edge (the doctor reads no process environment). Each probe passes only the names its allowlist permits.
  readonly env: EnvironmentLike;
  readonly runCommand?: RunCommand;
  readonly connectSocket?: ConnectSocket;
  readonly fetchInformation?: FetchInformation;
  // The Anda Engine base URL (RuntimeConfig.andaUrl). Absent means no engine is configured.
  readonly andaUrl?: string;
  // AgentOS seam (CLI-03; P6-D14). Absent means no daemon answered, so the realm is not active and the
  // agentos item reports that. Present, it says whether the daemon has a driver bound and whether a live session answers.
  readonly agentos?: AgentOsProbe;
  // The bound for one probe step, in milliseconds. Defaults to 5000.
  readonly probeTimeoutMs?: number;
  // The bound for hashing one host binary, in milliseconds. The file is read from disk, and a cold read of a large binary on a busy
  // host can outlast a process probe, so the digest has its own bound. Defaults to 30000.
  readonly hashTimeoutMs?: number;
  // Pins for the host binaries the host-binaries item inspects. The caller fills them from the REALM_HOST_PIN_<NAME>_PATH,
  // _VERSION and _SHA256 names of env (hostBinaryPinsFromEnv); when it passes none, the doctor derives them from options.env,
  // which the caller handed in, so the doctor still reads no process environment.
  readonly hostBinaryPins?: HostBinaryPins;
  // Reads the Yama ptrace scope as the text of /proc/sys/kernel/yama/ptrace_scope, and throws when it cannot be read.
  readonly readPtraceScope?: () => string;
  // Loaded runtime config. Absent, the runtime checks are one item whose fix names realm init.
  readonly runtimeConfig?: RuntimeConfig;
  readonly statPath?: RuntimeCheckOptions["stat"];
  readonly connectGateway?: RuntimeCheckOptions["connectGateway"];
}

export type HostBinaryName = "supervisor" | "openshell" | "openshell-gateway" | "podman";

// What a host binary is expected to be. Every field is optional. path is the location the binary must resolve to, version is the
// version its --version output reports, and sha256 is the lowercase hex digest of its file.
export interface HostBinaryPin {
  readonly path?: string;
  readonly version?: string;
  readonly sha256?: string;
}

export type HostBinaryPins = Readonly<Partial<Record<HostBinaryName, HostBinaryPin>>>;

// Answers GET /.well-known/information on the engine at url with the status and the body text.
// Rejects when no complete reply arrives. The rejection is never copied into a result.
export interface AndaReply {
  readonly status: number;
  readonly text: string;
}

export type FetchInformation = (url: string, timeoutMs: number) => Promise<AndaReply>;

// What the daemon reports about AgentOS (CLI-03; P6-D14). bound false: no driver is bound, so realm up is
// refused with AGENTOS_NOT_CONFIGURED. bound true: alive says whether the driver's live session answers.
export type AgentOsReading = { readonly bound: false } | { readonly bound: true; readonly alive: boolean };
export type AgentOsProbe = () => Promise<AgentOsReading>;

// What a writability probe reports. A refusal carries the probe's error text as its reason.
export type WriteReading = { readonly writable: true } | { readonly writable: false; readonly reason: string };
type WriteProbe = (path: string) => WriteReading;

interface CheckContext {
  readonly options: DoctorOptions;
  readonly canWrite: WriteProbe;
  // The one Podman probe of this run, started by the first Podman item that asks for it.
  readonly podman: () => Promise<PodmanProbeResult>;
}

type Check = (context: CheckContext) => CheckResult | Promise<CheckResult>;

const STATE_DIR_MODE = 0o700;
const PERMISSION_BITS = 0o777;

// The registered checks in report order. The Phase 3 items follow the Phase 2 three (D-69).
// Phase 6 appends control-channel and agentos after anda-bridge (P6-D6, P6-D14), and phase 9.7 appends host-binaries and
// kernel-hardening after agentos; nothing earlier moves, because the list is a costly change under D-44.
const REGISTERED: readonly Check[] = [
  (context) => policyFileCheck(context.options),
  (context) => stateDirCheck(context.options),
  (context) => sessionStoreCheck(context.options, context.canWrite),
  podmanCheck,
  podmanServiceCheck,
  openShellCheck,
  andaBridgeCheck,
  controlChannelCheck,
  agentOsCheck,
  hostBinariesCheck,
  kernelHardeningCheck,
];

const DEFAULT_PROBE_TIMEOUT_MS = 5000;
const DEFAULT_HASH_TIMEOUT_MS = 30000;
// The largest Anda reply the doctor reads. The bridge applies the same limit.
const ANDA_MAX_BODY_BYTES = 64 * 1024;
const MAX_COMMAND_OUTPUT_BYTES = 1024 * 1024;

// Runs every registered check and returns the results in report order. The Podman probe is
// shared by its two items, so it runs at most once per call.
export async function runChecks(options: DoctorOptions): Promise<readonly CheckResult[]> {
  let podmanProbe: Promise<PodmanProbeResult> | undefined;
  const context: CheckContext = {
    options,
    canWrite: options.canWrite ?? defaultCanWrite,
    podman: () => {
      podmanProbe ??= probePodman({
        runCommand: options.runCommand ?? defaultRunCommand,
        connectSocket: options.connectSocket ?? defaultConnectSocket,
        env: options.env,
        timeoutMs: probeTimeoutOf(options),
      });
      return podmanProbe;
    },
  };
  const registered = await Promise.all(REGISTERED.map(async (check) => await check(context)));
  const runtime = await runtimeChecks({
    ...(options.runtimeConfig === undefined ? {} : { config: options.runtimeConfig }),
    env: options.env,
    ...(options.statPath === undefined ? {} : { stat: options.statPath }),
    ...(options.connectGateway === undefined ? {} : { connectGateway: options.connectGateway }),
    ...(options.probeTimeoutMs === undefined ? {} : { probeTimeoutMs: options.probeTimeoutMs }),
  });
  return [...registered, ...runtime];
}

// The text a failed probe reports as its reason. Every probe here throws an Error, so its message is the text.
function probeErrorText(error: unknown): string {
  return error instanceof Error ? error.message : "the probe failed without error text";
}

// access(W_OK) answers without creating or touching any file. A refusal keeps the error text as its reason.
function defaultCanWrite(path: string): WriteReading {
  try {
    accessSync(path, constants.W_OK);
    return { writable: true };
  } catch (error: unknown) {
    return { writable: false, reason: probeErrorText(error) };
  }
}

// policy-file (D-21, D-22, D-44). Validation and the inside-root rule run through the
// policy loader, so the doctor never restates them.
function policyFileCheck(options: DoctorOptions): CheckResult {
  const id: CheckId = "policy-file";
  const path = options.policyPath;
  if (path === undefined || !existsSync(path)) {
    const where =
      path === undefined ? "no policy file path is configured" : "no policy file at the configured path";
    return {
      id,
      status: "warn",
      detail: `${where}; defaults in effect (fail-closed mode, no workspace roots, shell disabled)`,
      fix: "Create a policy file at the configured path that names workspaceRoots. Without one, every create is refused with POLICY_DENIED.",
    };
  }
  let loaded: LoadedPolicy;
  try {
    loaded = loadPolicyFileDetailed(path);
  } catch (error: unknown) {
    if (error instanceof SchemaInvalidError) {
      return {
        id,
        status: "fail",
        detail: `policy file fails the schema: ${error.detail}`,
        fix: "Correct the policy file so it satisfies the schema at the location named in the detail, then rerun the check. The value is never reported.",
      };
    }
    if (error instanceof RealmError && error.code === "POLICY_DENIED") {
      return {
        id,
        status: "fail",
        detail:
          "policy file cannot be verified: it is unreadable, sits inside one of its own workspace roots, or names a root that does not resolve",
        fix: "Make the policy file readable, move it outside every workspace root, and make every workspaceRoots entry an existing directory.",
      };
    }
    throw error;
  }
  const loadsText = "policy file loads, and it lies outside its own workspace roots";
  if (loaded.policy.mode === "advisory") {
    return {
      id,
      status: "warn",
      detail: `${loadsText}, mode advisory (explicit): host writes proceed with a warning while the realm is not active; this is not containment`,
      fix: 'Set "mode": "fail-closed", or delete the key, to block guarded host write and edit calls while the realm is not active. This does not contain Omp built-in tools.',
    };
  }
  const modeText =
    loaded.modeSource === "explicit"
      ? "mode fail-closed"
      : "mode fail-closed (the default; the file sets no mode)";
  return {
    id,
    status: "pass",
    detail: `${loadsText}, ${modeText}`,
    fix: null,
  };
}

// state-dir (D-37, D-44). The directory is created with mode 0700 on first use.
function stateDirCheck(options: DoctorOptions): CheckResult {
  const id: CheckId = "state-dir";
  const dir = options.stateDir;
  const found = probePath(dir);
  if (found.state === "absent") {
    return {
      id,
      status: "warn",
      detail: "state directory is absent",
      fix: "No action needed: the realm creates the state directory with mode 700 on first use.",
    };
  }
  if (found.state === "unreadable") {
    return {
      id,
      status: "fail",
      detail: "state directory cannot be inspected",
      fix: "Check the ownership and permissions of the parent directory of the state directory.",
    };
  }
  if (!found.stats.isDirectory()) {
    return {
      id,
      status: "fail",
      detail: "state directory path is not a directory",
      fix: "Move the file at the state directory path aside so the realm can create the directory.",
    };
  }
  const mode = found.stats.mode & PERMISSION_BITS;
  if (mode !== STATE_DIR_MODE) {
    return {
      id,
      status: "fail",
      detail: `state directory mode is ${mode.toString(8)}, expected 700`,
      fix: `Run chmod 700 on the state directory: ${dir}`,
    };
  }
  return { id, status: "pass", detail: "state directory exists with mode 700", fix: null };
}

// session-store (D-37, D-44). Writability is access(W_OK) on the session directory, or on
// the nearest existing ancestor when the session directory is not yet created. No probe file
// is written.
function sessionStoreCheck(options: DoctorOptions, canWrite: WriteProbe): CheckResult {
  const id: CheckId = "session-store";
  const dir = sessionsDirOf(options.stateDir);
  const found = probePath(dir);
  if (found.state === "unreadable") {
    return {
      id,
      status: "fail",
      detail: "session store cannot be inspected",
      fix: "Check the ownership and permissions of the state directory.",
    };
  }
  if (found.state === "present") {
    if (!found.stats.isDirectory()) {
      return {
        id,
        status: "fail",
        detail: "session store path is not a directory",
        fix: "Move the file at the session store path aside so the realm can create the directory.",
      };
    }
    const reading = canWrite(dir);
    if (reading.writable) {
      return { id, status: "pass", detail: "session store directory is writable by this process", fix: null };
    }
    return {
      id,
      status: "fail",
      detail: `session store directory is not writable by this process: ${reading.reason}`,
      fix: `Check the ownership of ${dir}: it must belong to the user that runs the realm and be writable by that user.`,
    };
  }
  const ancestor = nearestExistingAncestor(dir);
  const reading: WriteReading = isDirectoryAt(ancestor)
    ? canWrite(ancestor)
    : { writable: false, reason: "the nearest existing ancestor is not a readable directory" };
  if (reading.writable) {
    return {
      id,
      status: "warn",
      detail: "session store is absent",
      fix: "No action needed: the realm creates the session store on first use.",
    };
  }
  return {
    id,
    status: "fail",
    detail: `session store cannot be created: no writable directory covers its path: ${reading.reason}`,
    fix: `Check the ownership of ${ancestor}: it must be a directory that the user running the realm can write.`,
  };
}

type PathProbe =
  | { readonly state: "absent" }
  | { readonly state: "unreadable" }
  | { readonly state: "present"; readonly stats: Stats };

function probePath(path: string): PathProbe {
  try {
    return { state: "present", stats: statSync(path) };
  } catch (error: unknown) {
    return errnoOf(error) === "ENOENT" ? { state: "absent" } : { state: "unreadable" };
  }
}

function isDirectoryAt(path: string): boolean {
  const found = probePath(path);
  return found.state === "present" && found.stats.isDirectory();
}

function nearestExistingAncestor(path: string): string {
  let current = dirname(path);
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) {
      return current;
    }
    current = parent;
  }
  return current;
}

function errnoOf(error: unknown): string | undefined {
  if (error instanceof Error && "code" in error && typeof error.code === "string") {
    return error.code;
  }
  return undefined;
}

// ---- Phase 3 items (RT-02, RT-03, ANDA-02; D-69). Each item returns a status, a detail, and a fix
// that is null only on pass. A detail names a catalogue code, a flag, or a rule. It never carries
// raw command output, socket error text, or a value read from the engine.

const FIX_INSTALL_PODMAN = "Install Podman 5.x yourself. Realm does not install or upgrade Podman.";
const FIX_UPGRADE_PODMAN =
  "Upgrade Podman to 5.x yourself. OpenShell requires Podman 5.x, and Realm does not install or upgrade Podman.";
const FIX_START_SOCKET =
  "Run systemctl --user start podman.socket so the rootless API socket under XDG_RUNTIME_DIR accepts connections, then rerun the check.";
const FIX_AWAIT_PODMAN = "Resolve the podman item first. The socket is inspected only after Podman 5.x is found.";
const FIX_INSTALL_OPENSHELL = "Install OpenShell 0.1.5 yourself and put openshell on PATH. Realm does not install OpenShell.";
const FIX_DRIFT_OPENSHELL =
  "The installed OpenShell does not list every flag of the pinned create argv. Install the pinned 0.1.5 CLI, or record the drift in the runtime decision note before relying on this build.";
const FIX_NOT_CONFIGURED =
  "Set andaUrl in the runtime configuration to the Anda Engine base URL. The other checks do not need an engine.";
const FIX_ANDA_URL =
  "Set andaUrl to the http or https base URL of a running Anda Engine, without user information. Realm reads only GET /.well-known/information there.";
const FIX_ANDA_SHAPE =
  "The engine's AppInformation body does not match the shape Realm checks: engines is an array, default_engine is a string or null, and start_time_ms is a non-negative integer. This is a shape check, not a version check.";

// podman (RT-02). The binary runs and reports 5.x. A socket that is not up is reported by podman-service.
async function podmanCheck(context: CheckContext): Promise<CheckResult> {
  const id: CheckId = "podman";
  const probe = await context.podman();
  if (probe.ok) {
    return { id, status: "pass", detail: `Podman ${probe.version} is installed and reports 5.x or newer`, fix: null };
  }
  if (probe.code === "PODMAN_MACHINE_DOWN") {
    return {
      id,
      status: "pass",
      detail: "Podman is installed and reports 5.x or newer; podman-service reports the API socket",
      fix: null,
    };
  }
  return {
    id,
    status: "fail",
    detail: `${probe.code}: ${probe.reason}`,
    fix: probe.code === "PODMAN_MISSING" ? FIX_INSTALL_PODMAN : FIX_UPGRADE_PODMAN,
  };
}

// podman-service (RT-02). The rootless API socket accepts a connection. The socket is inspected
// only when the Podman version step has passed.
async function podmanServiceCheck(context: CheckContext): Promise<CheckResult> {
  const id: CheckId = "podman-service";
  const probe = await context.podman();
  if (probe.ok) {
    return { id, status: "pass", detail: "the rootless Podman API socket accepts connections", fix: null };
  }
  if (probe.code === "PODMAN_MACHINE_DOWN") {
    return { id, status: "fail", detail: `${probe.code}: ${probe.reason}`, fix: FIX_START_SOCKET };
  }
  return {
    id,
    status: "warn",
    detail: "the socket was not inspected because the Podman version step failed",
    fix: FIX_AWAIT_PODMAN,
  };
}

// openshell (RT-03). The CLI starts and lists every flag of the pinned create argv. It receives only
// the environment the production runner receives (AUD-02).
async function openShellCheck(context: CheckContext): Promise<CheckResult> {
  const id: CheckId = "openshell";
  const { options } = context;
  const runCommand = options.runCommand ?? defaultRunCommand;
  const env = selectOpenShellEnvironment(options.env);
  let outcome: CommandOutcome;
  try {
    outcome = await runCommand(OPENSHELL_BINARY, ["sandbox", "create", "--help"], {
      env,
      timeoutMs: probeTimeoutOf(options),
    });
  } catch (error: unknown) {
    const code = errnoOf(error);
    return {
      id,
      status: "fail",
      detail: code === undefined ? "openshell cannot be started" : `openshell cannot be started: ${code}`,
      fix: FIX_INSTALL_OPENSHELL,
    };
  }
  if (outcome.exitCode !== 0) {
    return {
      id,
      status: "fail",
      detail: `openshell sandbox create --help exited with status ${String(outcome.exitCode)}`,
      fix: FIX_INSTALL_OPENSHELL,
    };
  }
  const listed = new Set(outcome.stdout.split(/[\s,[\]<>=|]+/));
  const missing = pinnedCreateFlags().filter((flag) => !listed.has(flag));
  if (missing.length > 0) {
    return {
      id,
      status: "warn",
      detail: `openshell sandbox create does not list pinned flags: ${missing.join(", ")}`,
      fix: FIX_DRIFT_OPENSHELL,
    };
  }
  return { id, status: "pass", detail: "openshell sandbox create lists every pinned create flag", fix: null };
}

// The flags of the pinned create argv, read from the argv builder so the check cannot drift from it.
function pinnedCreateFlags(): readonly string[] {
  const argv = buildCreateArgv({
    sessionId: "doctor-check",
    policyPath: "/doctor-check.policy.json",
    cpus: 1,
    memory: "1Gi",
    imageRef: `example.invalid/doctor-check@sha256:${"0".repeat(64)}`,
  });
  return argv.filter((element) => element.startsWith("--"));
}

// anda-bridge (ANDA-02). The engine answers GET /.well-known/information with the AppInformation
// shape. This is a shape check only: Anda publishes no version surface (OQ-P3-09).
async function andaBridgeCheck(context: CheckContext): Promise<CheckResult> {
  const id: CheckId = "anda-bridge";
  const { options } = context;
  const url = options.andaUrl;
  if (url === undefined) {
    return {
      id,
      status: "warn",
      detail: "no Anda Engine URL is configured, so no engine is contacted",
      fix: FIX_NOT_CONFIGURED,
    };
  }
  if (!isEngineUrl(url)) {
    return { id, status: "fail", detail: "andaUrl is not an http or https URL without user information", fix: FIX_ANDA_URL };
  }
  let reply: AndaReply;
  try {
    reply = await (options.fetchInformation ?? defaultFetchInformation)(url, probeTimeoutOf(options));
  } catch {
    return {
      id,
      status: "fail",
      detail: `ANDA_UNREACHABLE: no complete reply to GET ${ANDA_INFORMATION_PATH}`,
      fix: FIX_ANDA_URL,
    };
  }
  if (reply.status !== 200) {
    return {
      id,
      status: "fail",
      detail: `ANDA_UNREACHABLE: GET ${ANDA_INFORMATION_PATH} answered with status ${String(reply.status)}`,
      fix: FIX_ANDA_URL,
    };
  }
  let body: unknown;
  try {
    body = JSON.parse(reply.text);
  } catch {
    return { id, status: "fail", detail: "ANDA_VERSION_MISMATCH: the AppInformation body is not JSON", fix: FIX_ANDA_SHAPE };
  }
  const shape = checkAppInformationShape(body);
  if (!shape.ok) {
    return { id, status: "fail", detail: `ANDA_VERSION_MISMATCH: ${shape.detail}`, fix: FIX_ANDA_SHAPE };
  }
  return {
    id,
    status: "pass",
    detail: `GET ${ANDA_INFORMATION_PATH} returned the AppInformation shape (a shape check, not a version check)`,
    fix: null,
  };
}

// ---- Phase 6 items (CLI-03; P6-D6, P6-D14). Each item returns a status, a detail, and a fix
// that is null only on pass. A detail names a catalogue code, a mode, or a rule. It never
// carries socket bytes or a value read from the engine.

const FIX_CONTROL_ABSENT = "Run realm up to start the daemon, then rerun doctor.";
const FIX_CONTROL_REFUSED =
  "Check that the realm daemon owns the control socket, then run realm up to replace a stale socket and rerun doctor.";
const FIX_AGENTOS_UP = "Run realm up, then rerun doctor.";
const FIX_GATEWAY_LOST = "Restore the OpenShell gateway, then run realm down and realm up, and rerun doctor.";
const FIX_AGENTOS_DRIVER =
  "Bind an AgentOS driver in the realm daemon (docs/integration/agentos.md). Until one is bound, realm up is refused.";

// control-channel (CLI-03; P6-D6). The run directory has mode 0700 and the control socket
// accepts a connection. A missing run directory or socket warns, because a stopped daemon is
// normal. A wrong mode, a non-directory, or a refused dial fails closed, so a tampered or
// foreign socket never reports pass (T-06-12). Details name codes and modes only (T-06-13).
async function controlChannelCheck(context: CheckContext): Promise<CheckResult> {
  const id: CheckId = "control-channel";
  const { options } = context;
  const runDir = join(options.stateDir, "run");
  const found = probePath(runDir);
  if (found.state === "absent") {
    return {
      id,
      status: "warn",
      detail: "control socket is absent because the run directory is absent, so the daemon looks stopped",
      fix: FIX_CONTROL_ABSENT,
    };
  }
  if (found.state === "unreadable") {
    return {
      id,
      status: "fail",
      detail: "run directory cannot be inspected",
      fix: `Check the ownership and permissions of the parent directory of the run directory: ${runDir}.`,
    };
  }
  if (!found.stats.isDirectory()) {
    return {
      id,
      status: "fail",
      detail: "run directory path is not a directory",
      fix: `Move the file at the run directory path aside so the realm can create the directory: ${runDir}.`,
    };
  }
  const mode = found.stats.mode & PERMISSION_BITS;
  if (mode !== STATE_DIR_MODE) {
    return {
      id,
      status: "fail",
      detail: `run directory mode is ${mode.toString(8)}, expected 700`,
      fix: `Run chmod 700 on the run directory: ${runDir}`,
    };
  }
  const socketPath = controlSocketPath(options.stateDir);
  try {
    await (options.connectSocket ?? defaultConnectSocket)(socketPath, SOCKET_TIMEOUT_MS);
  } catch (error: unknown) {
    if (errnoOf(error) === "ENOENT") {
      return {
        id,
        status: "warn",
        detail: "control socket is absent, so the daemon looks stopped",
        fix: FIX_CONTROL_ABSENT,
      };
    }
    return {
      id,
      status: "fail",
      detail: "REALM_NOT_ACTIVE: the control socket did not accept a connection",
      fix: FIX_CONTROL_REFUSED,
    };
  }
  return {
    id,
    status: "pass",
    detail: "the run directory has mode 700 and the control socket accepts connections",
    fix: null,
  };
}

// agentos (CLI-03; P6-D14). The status follows the state the daemon reports, not a fixed answer. With no
// probe, no daemon answers, so the realm is not active and the item warns with REALM_NOT_ACTIVE. A daemon
// with no driver bound refuses up with AGENTOS_NOT_CONFIGURED, so the item fails with that code. A bound
// driver passes when its session answers; a session that does not answer, or a probe that fails, is
// AGENTOS_CRASH_LOOP, unless the probe threw OPENSHELL_GATEWAY_LOST: the gateway did not answer, and the item says so (OBS-04).
async function agentOsCheck(context: CheckContext): Promise<CheckResult> {
  const id: CheckId = "agentos";
  const probe = context.options.agentos;
  if (probe === undefined) {
    return {
      id,
      status: "warn",
      detail: "REALM_NOT_ACTIVE: no daemon answers, so AgentOS liveness is not known",
      fix: FIX_AGENTOS_UP,
    };
  }
  let reading: AgentOsReading;
  try {
    reading = await probe();
  } catch (error) {
    if (error instanceof RealmError && error.code === "OPENSHELL_GATEWAY_LOST") {
      return {
        id,
        status: "fail",
        detail: `OPENSHELL_GATEWAY_LOST: ${ERROR_CATALOGUE.OPENSHELL_GATEWAY_LOST.reason}`,
        fix: FIX_GATEWAY_LOST,
      };
    }
    return {
      id,
      status: "fail",
      detail: "AGENTOS_CRASH_LOOP: the AgentOS liveness probe did not answer",
      fix: FIX_AGENTOS_UP,
    };
  }
  if (!reading.bound) {
    return {
      id,
      status: "fail",
      detail: `AGENTOS_NOT_CONFIGURED: ${ERROR_CATALOGUE.AGENTOS_NOT_CONFIGURED.reason}`,
      fix: FIX_AGENTOS_DRIVER,
    };
  }
  if (reading.alive) {
    return { id, status: "pass", detail: "the AgentOS driver reports a live session", fix: null };
  }
  return {
    id,
    status: "fail",
    detail: "AGENTOS_CRASH_LOOP: the AgentOS driver reports no live session",
    fix: FIX_AGENTOS_UP,
  };
}

// ---- Phase 9.7 items. Neither fails: a host that differs from its pins, or whose kernel allows same-uid ptrace, still runs, and
// the item says what to record or tighten. A detail names a binary, a version or a short digest prefix, never a path.

const HOST_BINARY_NAMES: readonly HostBinaryName[] = ["supervisor", "openshell", "openshell-gateway", "podman"];
// The host supervisor is not on PATH: the driver is configured with its absolute path under this name.
const SUPERVISOR_BINARY_ENV = "REALM_DRIVER_SUPERVISOR_BINARY";
// The driver reads its supervisor digest pin from this variable. The doctor falls back to it, so one variable pins both.
const DRIVER_SUPERVISOR_SHA256_ENV = "REALM_DRIVER_SUPERVISOR_SHA256";
const HOST_PIN_ENV_PREFIX = "REALM_HOST_PIN_";
// The only host environment names that reach a version command, the same set the Podman probe passes.
const HOST_BINARY_ENV_NAMES = ["PATH", "HOME", "XDG_RUNTIME_DIR"] as const;
const SHA_PREFIX_LENGTH = 12;
const VERSION_PATTERN = /\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.+-]+)?/;
const FIX_HOST_BINARIES =
  "Install any missing binary on PATH (the supervisor path comes from REALM_DRIVER_SUPERVISOR_BINARY). To record a pin, run each binary with --version, take the sha256 of its file with sha256sum, and set REALM_HOST_PIN_<NAME>_VERSION and REALM_HOST_PIN_<NAME>_SHA256, where NAME is SUPERVISOR, OPENSHELL, OPENSHELL_GATEWAY or PODMAN. Compare the --version output and the digest, never the package manager's database: a binary can be overwritten in place.";
const FIX_SUPERVISOR_UNPINNED = "set REALM_DRIVER_SUPERVISOR_SHA256 to the sha256 shown above";
const FIX_PIN_FORMAT = "a pin must be 64 lowercase hex characters";
// The driver accepts a digest pin only in this form, so the doctor does not normalise case: an upper-case pin would pass here and
// leave a driver that refuses to start.
const PIN_SHA256_PATTERN = /^[0-9a-f]{64}$/;
const FIX_PTRACE_SCOPE =
  "Set kernel.yama.ptrace_scope to 1 or higher (sysctl kernel.yama.ptrace_scope=1, persisted under /etc/sysctl.d), and check that the Yama security module is enabled.";

// Reads the pins an operator recorded in the host environment: REALM_HOST_PIN_<NAME>_PATH, _VERSION and _SHA256, where NAME is
// the binary's name in upper case with dashes as underscores. For these variables an empty value is no pin. The supervisor's
// digest pin falls back to REALM_DRIVER_SUPERVISOR_SHA256, the variable the driver reads, when REALM_HOST_PIN_SUPERVISOR_SHA256 is
// unset. That variable is taken exactly as set: the driver refuses a padded or empty value, so either one is a pin the doctor
// reports as malformed, not as no pin.
export function hostBinaryPinsFromEnv(env: EnvironmentLike): HostBinaryPins {
  const pins: Partial<Record<HostBinaryName, HostBinaryPin>> = {};
  for (const name of HOST_BINARY_NAMES) {
    const stem = `${HOST_PIN_ENV_PREFIX}${name.toUpperCase().replace(/-/g, "_")}`;
    const path = pinValue(env, `${stem}_PATH`);
    const version = pinValue(env, `${stem}_VERSION`);
    const sha256 = pinValue(env, `${stem}_SHA256`) ?? (name === "supervisor" ? env[DRIVER_SUPERVISOR_SHA256_ENV] : undefined);
    if (path !== undefined || version !== undefined || sha256 !== undefined) {
      pins[name] = {
        ...(path === undefined ? {} : { path }),
        ...(version === undefined ? {} : { version }),
        ...(sha256 === undefined ? {} : { sha256 }),
      };
    }
  }
  return pins;
}

function pinValue(env: EnvironmentLike, key: string): string | undefined {
  const value = env[key]?.trim();
  return value === undefined || value === "" ? undefined : value;
}

interface HostBinaryInspection {
  // "name version sha-prefix" for a binary that was found.
  readonly summary?: string;
  // Set for a supervisor that was found but has no digest pin; it names the digest the operator can pin.
  readonly unpinnedNote?: string;
  // Set when a digest pin is not exactly 64 lowercase hex characters, the only form the driver accepts.
  readonly malformedPin?: boolean;
  readonly problems: readonly string[];
}

// host-binaries (phase 9.7, A18). The supervisor, the openshell CLI, the gateway and podman each report their --version and the
// sha256 of their executable. A set pin that does not match, a binary that is missing, and a reading that fails each warn, and so
// does a supervisor with no digest pin: it handles launch secrets and its file is writable by the realm account. The package
// manager's database is never consulted: a binary can be overwritten in place, so only the binary itself is compared.
async function hostBinariesCheck(context: CheckContext): Promise<CheckResult> {
  const id: CheckId = "host-binaries";
  const { options } = context;
  const pins = options.hostBinaryPins ?? hostBinaryPinsFromEnv(options.env);
  const inspections = await Promise.all(
    HOST_BINARY_NAMES.map((name) => inspectHostBinary(name, hostBinaryLocation(name, options.env), pins[name], options)),
  );
  const problems = inspections.flatMap((inspection) => inspection.problems);
  const unpinned = inspections.flatMap((inspection) => (inspection.unpinnedNote === undefined ? [] : [inspection.unpinnedNote]));
  const summaries = inspections.flatMap((inspection) => (inspection.summary === undefined ? [] : [inspection.summary]));
  if (problems.length === 0 && unpinned.length === 0) {
    return { id, status: "pass", detail: summaries.join("; "), fix: null };
  }
  const observed = summaries.length === 0 ? "" : `. Observed: ${summaries.join("; ")}`;
  const fixes = [
    ...(problems.length === 0 ? [] : [FIX_HOST_BINARIES]),
    ...(inspections.some((inspection) => inspection.malformedPin === true) ? [FIX_PIN_FORMAT] : []),
    ...(unpinned.length === 0 ? [] : [FIX_SUPERVISOR_UNPINNED]),
  ];
  return { id, status: "warn", detail: `${[...problems, ...unpinned].join("; ")}${observed}`, fix: fixes.join(" ") };
}

async function inspectHostBinary(
  name: HostBinaryName,
  location: string | undefined,
  pin: HostBinaryPin | undefined,
  options: DoctorOptions,
): Promise<HostBinaryInspection> {
  if (location === undefined) {
    return { problems: [name === "supervisor" ? "supervisor is not configured or not executable" : `${name} was not found on PATH`] };
  }
  const timeoutMs = probeTimeoutOf(options);
  const [version, sha256] = await Promise.all([
    readBinaryVersion(location, options, timeoutMs),
    sha256OfBinary(location, options.hashTimeoutMs ?? DEFAULT_HASH_TIMEOUT_MS),
  ]);
  const problems: string[] = [];
  if (version === undefined) {
    problems.push(`${name} version could not be read`);
  } else if (pin?.version !== undefined && version !== pin.version) {
    problems.push(`${name} reports ${version} but its pin says ${pin.version}`);
  }
  const pinMalformed = pin?.sha256 !== undefined && !PIN_SHA256_PATTERN.test(pin.sha256);
  if (pinMalformed) {
    problems.push(`${name} sha256 pin is not 64 lowercase hex characters`);
  }
  if (sha256 === undefined) {
    problems.push(`${name} sha256 could not be computed`);
  } else if (pin?.sha256 !== undefined && !pinMalformed && sha256 !== pin.sha256) {
    problems.push(`${name} sha256 differs from its pin`);
  }
  if (pin?.path !== undefined && location !== pin.path) {
    problems.push(`${name} does not resolve to its pinned location`);
  }
  return {
    summary: `${name} ${version ?? "unknown"} ${sha256?.slice(0, SHA_PREFIX_LENGTH) ?? "unknown"}`,
    ...(name === "supervisor" && sha256 !== undefined && pin?.sha256 === undefined
      ? { unpinnedNote: `supervisor has no sha256 pin (sha256 ${sha256})` }
      : {}),
    ...(pinMalformed ? { malformedPin: true } : {}),
    problems,
  };
}

// The supervisor is the absolute path the driver is configured with. The other binaries are the first executable of that name on
// the PATH the caller handed in. The file at that path is run and hashed by path, so the check cannot tell whether two reads of the
// path saw the same inode: it reports drift, not a swap between reads.
function hostBinaryLocation(name: HostBinaryName, env: EnvironmentLike): string | undefined {
  if (name === "supervisor") {
    const configured = env[SUPERVISOR_BINARY_ENV];
    return configured !== undefined && isAbsolute(configured) && isExecutableFile(configured) ? configured : undefined;
  }
  for (const directory of (env["PATH"] ?? "").split(":")) {
    if (isAbsolute(directory)) {
      const candidate = join(directory, name);
      if (isExecutableFile(candidate)) {
        return candidate;
      }
    }
  }
  return undefined;
}

function isExecutableFile(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

// The version a binary reports for --version, or undefined when it cannot run, exits non-zero, does not finish in time, or prints no
// version. Each of those is reported as a warning by the caller, with no output text.
async function readBinaryVersion(location: string, options: DoctorOptions, timeoutMs: number): Promise<string | undefined> {
  const runCommand = options.runCommand ?? defaultRunCommand;
  const env: Record<string, string> = {};
  for (const key of HOST_BINARY_ENV_NAMES) {
    const value = options.env[key];
    if (value !== undefined) {
      env[key] = value;
    }
  }
  try {
    const outcome = await withTimeout(runCommand(location, ["--version"], { env, timeoutMs }), timeoutMs, "OPENSHELL_START_FAILED");
    return outcome.exitCode === 0 ? VERSION_PATTERN.exec(outcome.stdout)?.[0] : undefined;
  } catch {
    return undefined;
  }
}

// The lowercase hex sha256 of an executable, or undefined when it cannot be read within the bound.
async function sha256OfBinary(location: string, timeoutMs: number): Promise<string | undefined> {
  const stream = createReadStream(location);
  try {
    return await withTimeout(digestOfStream(stream), timeoutMs, "OPENSHELL_START_FAILED");
  } catch {
    return undefined;
  } finally {
    stream.destroy();
  }
}

function digestOfStream(stream: ReadStream): Promise<string> {
  const hash = createHash("sha256");
  return new Promise<string>((resolve, reject) => {
    stream.on("data", (chunk: Buffer | string) => {
      hash.update(chunk);
    });
    stream.once("error", reject);
    stream.once("end", () => {
      resolve(hash.digest("hex"));
    });
  });
}

// kernel-hardening (phase 9.7, A10 F1). With the Yama ptrace scope at 0, a process may ptrace any process of its own uid, so a
// workload could reach the in-container runtime if the runtime's own filters were absent. Scope 1 or higher restricts it. The item
// never fails: it reports what the kernel allows.
function kernelHardeningCheck(context: CheckContext): CheckResult {
  const id: CheckId = "kernel-hardening";
  const read = context.options.readPtraceScope ?? defaultReadPtraceScope;
  let scope: number | undefined;
  try {
    const text = read().trim();
    scope = /^\d+$/.test(text) ? Number(text) : undefined;
  } catch {
    scope = undefined;
  }
  if (scope === undefined) {
    return {
      id,
      status: "warn",
      detail: "kernel.yama.ptrace_scope is unknown: the Yama setting could not be read",
      fix: FIX_PTRACE_SCOPE,
    };
  }
  if (scope === 0) {
    return {
      id,
      status: "warn",
      detail:
        "kernel.yama.ptrace_scope is 0: same-uid ptrace is unrestricted, so a workload could reach the in-container runtime if the runtime's own filters were absent",
      fix: FIX_PTRACE_SCOPE,
    };
  }
  return { id, status: "pass", detail: `kernel.yama.ptrace_scope is ${String(scope)}`, fix: null };
}

function defaultReadPtraceScope(): string {
  return readFileSync("/proc/sys/kernel/yama/ptrace_scope", "utf8");
}

// The same rule as the bridge: http or https, and no user information in the authority, even an empty one.
function isEngineUrl(text: string): boolean {
  if (/^[a-z][a-z0-9+.-]*:\/\/[^/?#]*@/i.test(text)) {
    return false;
  }
  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    return false;
  }
  return parsed.protocol === "http:" || parsed.protocol === "https:";
}

function probeTimeoutOf(options: DoctorOptions): number {
  return options.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
}

// Runs file with argv and no shell, under the environment the caller passes. A process that exits
// resolves with its status. One that cannot start, or is killed at the timeout, rejects.
export function defaultRunCommand(file: string, args: readonly string[], options: CommandOptions): Promise<CommandOutcome> {
  return new Promise<CommandOutcome>((resolve, reject) => {
    execFile(
      file,
      [...args],
      {
        env: { ...options.env },
        encoding: "utf8",
        maxBuffer: MAX_COMMAND_OUTPUT_BYTES,
        shell: false,
        timeout: options.timeoutMs,
      },
      (error, stdout) => {
        if (error === null) {
          resolve({ exitCode: 0, stdout });
          return;
        }
        if (typeof error.code === "number") {
          resolve({ exitCode: error.code, stdout });
          return;
        }
        reject(error instanceof Error ? error : new Error("the command failed without an Error object"));
      },
    );
  });
}

// Dials a Unix socket and closes it at once. Rejects on refusal, a missing socket, or no connection
// within timeoutMs.
function defaultConnectSocket(socketPath: string, timeoutMs: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const socket = createConnection(socketPath);
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("socket did not connect in time"));
    }, timeoutMs);
    socket.once("connect", () => {
      clearTimeout(timer);
      socket.destroy();
      resolve();
    });
    socket.once("error", (error) => {
      clearTimeout(timer);
      socket.destroy();
      reject(error);
    });
  });
}

type HttpTransport = (options: RequestOptions, onResponse: (res: IncomingMessage) => void) => ClientRequest;

// One anonymous GET of ANDA_INFORMATION_PATH on the engine host, as the bridge sends it: no
// credential, and no path prefix from the base URL. Rejects when no complete reply arrives within
// timeoutMs, counted from the call. The idle socket timeout alone does not bound a server that keeps
// sending bytes, so an overall deadline destroys the request, as the Anda client's per-attempt timer does.
function defaultFetchInformation(url: string, timeoutMs: number): Promise<AndaReply> {
  const target = new URL(url);
  const transport: HttpTransport = target.protocol === "https:" ? httpsRequest : httpRequest;
  return new Promise<AndaReply>((resolve, reject) => {
    const request = transport(
      {
        hostname: target.hostname.replace(/^\[|\]$/g, ""),
        port: target.port,
        path: ANDA_INFORMATION_PATH,
        method: "GET",
        headers: { accept: "application/json" },
        agent: false,
        timeout: timeoutMs,
      },
      (response) => {
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > ANDA_MAX_BODY_BYTES) {
            request.destroy(new Error("reply too large"));
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => {
          clearTimeout(deadline);
          resolve({ status: response.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf8") });
        });
        response.on("error", (error) => {
          clearTimeout(deadline);
          reject(error);
        });
      },
    );
    const deadline = setTimeout(() => request.destroy(new Error("request deadline exceeded")), timeoutMs);
    request.on("timeout", () => request.destroy(new Error("request timed out")));
    request.on("error", (error) => {
      clearTimeout(deadline);
      reject(error);
    });
    request.end();
  });
}

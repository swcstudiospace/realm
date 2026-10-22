// Doctor core check runner (D-44, Phase 2 goal). Each check returns one result with an id,
// a status of pass, warn, or fail (F-10: a status shape distinct from the validate ok
// shape), a detail, and a fix. The fix is null only when the status is pass.
//
// Phase 2 registered three checks (D-44). Phase 3 adds four runtime items (RT-02, RT-03,
// ANDA-02; D-69): podman, podman-service, openshell, and anda-bridge. AgentOS and the
// control channel have no item in Phase 3, because nothing there can inspect them (D-69).
// Phase 6 appends control-channel and agentos to REGISTERED deliberately (CLI-03; P6-D6,
// P6-D14); the list is a costly change under D-44.
//
// Details and fixes name paths, rules, and schema pointers. They never carry a value read
// from the policy file (the privacy rule in src/contract/validate.ts).

import { execFile } from "node:child_process";
import { accessSync, constants, existsSync, statSync, type Stats } from "node:fs";
import { request as httpRequest, type ClientRequest, type IncomingMessage, type RequestOptions } from "node:http";
import { request as httpsRequest } from "node:https";
import { createConnection } from "node:net";
import { dirname, join } from "node:path";
import { ANDA_INFORMATION_PATH } from "../anda/client.js";
import { checkAppInformationShape } from "../anda/shape.js";
import { SchemaInvalidError } from "../contract/validate.js";
import { RealmError } from "../core/errors.js";
import { loadPolicyFile } from "../core/policy.js";
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

export type { ConnectSocket } from "../runtime/podman-probe.js";

export type CheckId = "policy-file" | "state-dir" | "session-store" | "podman" | "podman-service" | "openshell" | "anda-bridge" | "control-channel" | "agentos";
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
  readonly canWrite?: (path: string) => boolean;
  // Phase 3 seams (RT-02, ANDA-02). Each has a real default; tests inject fakes so that no
  // process runs and no socket opens. env defaults to the host environment, and each probe
  // passes only the names its own allowlist permits.
  readonly env?: EnvironmentLike;
  readonly runCommand?: RunCommand;
  readonly connectSocket?: ConnectSocket;
  readonly fetchInformation?: FetchInformation;
  // The Anda Engine base URL (RuntimeConfig.andaUrl). Absent means no engine is configured.
  readonly andaUrl?: string;
  // AgentOS liveness seam (CLI-03; P6-D14). Absent means no live session is tracked, so the
  // agentos item warns instead of claiming a pass. Tests inject a probe to drive pass and fail.
  readonly agentosAlive?: AgentOsAliveProbe;
  // The bound for one probe step, in milliseconds. Defaults to 5000.
  readonly probeTimeoutMs?: number;
}

// Answers GET /.well-known/information on the engine at url with the status and the body text.
// Rejects when no complete reply arrives. The rejection is never copied into a result.
export interface AndaReply {
  readonly status: number;
  readonly text: string;
}

export type FetchInformation = (url: string, timeoutMs: number) => Promise<AndaReply>;

// AgentOS liveness probe (CLI-03; P6-D14). Resolves true when a live session answers.
export type AgentOsAliveProbe = () => Promise<boolean>;

type WriteProbe = (path: string) => boolean;

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
// Phase 6 appends control-channel and agentos after anda-bridge (P6-D6, P6-D14); nothing
// earlier moves, because the list is a costly change under D-44.
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
];

const DEFAULT_PROBE_TIMEOUT_MS = 5000;
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
        env: options.env ?? process.env,
        timeoutMs: probeTimeoutOf(options),
      });
      return podmanProbe;
    },
  };
  return Promise.all(REGISTERED.map((check) => check(context)));
}

// access(W_OK) answers without creating or touching any file.
function defaultCanWrite(path: string): boolean {
  try {
    accessSync(path, constants.W_OK);
    return true;
  } catch {
    return false;
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
      detail: `${where}; defaults in effect (advisory mode, no workspace roots, shell disabled)`,
      fix: "Create a policy file at the configured path that names workspaceRoots. Without one, every create is refused with POLICY_DENIED.",
    };
  }
  try {
    loadPolicyFile(path);
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
  return {
    id,
    status: "pass",
    detail: "policy file loads, and it lies outside its own workspace roots",
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
    if (canWrite(dir)) {
      return { id, status: "pass", detail: "session store directory is writable by this process", fix: null };
    }
    return {
      id,
      status: "fail",
      detail: "session store directory is not writable by this process",
      fix: `Check the ownership of ${dir}: it must belong to the user that runs the realm and be writable by that user.`,
    };
  }
  const ancestor = nearestExistingAncestor(dir);
  if (isDirectoryAt(ancestor) && canWrite(ancestor)) {
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
    detail: "session store cannot be created: no writable directory covers its path",
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
const FIX_INSTALL_OPENSHELL = "Install OpenShell 0.1.2 yourself and put openshell on PATH. Realm does not install OpenShell.";
const FIX_DRIFT_OPENSHELL =
  "The installed OpenShell does not list every flag of the pinned create argv. Install the pinned 0.1.2 CLI, or record the drift in the runtime decision note before relying on this build.";
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
  const env = selectOpenShellEnvironment(options.env ?? process.env);
  let outcome: CommandOutcome;
  try {
    outcome = await runCommand(OPENSHELL_BINARY, ["sandbox", "create", "--help"], {
      env,
      timeoutMs: probeTimeoutOf(options),
    });
  } catch {
    return { id, status: "fail", detail: "openshell cannot be started", fix: FIX_INSTALL_OPENSHELL };
  }
  if (outcome.exitCode !== 0) {
    return {
      id,
      status: "fail",
      detail: `openshell sandbox create --help exited with status ${outcome.exitCode}`,
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
    memory: "1g",
    workloadArgv: ["doctor-check"],
  });
  return argv.slice(0, argv.indexOf("--")).filter((element) => element.startsWith("--"));
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
      detail: `ANDA_UNREACHABLE: GET ${ANDA_INFORMATION_PATH} answered with status ${reply.status}`,
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

// agentos (CLI-03; P6-D14). With no live session there is nothing to probe, so the item warns
// instead of claiming a pass. An injected agentosAlive probe drives pass and fail in tests.
async function agentOsCheck(context: CheckContext): Promise<CheckResult> {
  const id: CheckId = "agentos";
  const probe = context.options.agentosAlive;
  if (probe === undefined) {
    return {
      id,
      status: "warn",
      detail: "no live AgentOS session is tracked, so liveness was not probed",
      fix: FIX_AGENTOS_UP,
    };
  }
  let alive: boolean;
  try {
    alive = await probe();
  } catch {
    return {
      id,
      status: "fail",
      detail: "AGENTOS_CRASH_LOOP: the AgentOS liveness probe did not answer",
      fix: FIX_AGENTOS_UP,
    };
  }
  if (alive) {
    return { id, status: "pass", detail: "the AgentOS driver reports a live session", fix: null };
  }
  return {
    id,
    status: "fail",
    detail: "AGENTOS_CRASH_LOOP: the AgentOS driver reports no live session",
    fix: FIX_AGENTOS_UP,
  };
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
        reject(error);
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

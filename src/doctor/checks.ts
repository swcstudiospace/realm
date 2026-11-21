// Doctor core check runner (D-44, Phase 2 goal). Each check returns one result with an id,
// a status of pass, warn, or fail (F-10: a status shape distinct from the validate ok
// shape), a detail, and a fix. The fix is null only when the status is pass.
//
// Phase 2 registered three checks (D-44). Phase 3 adds three runtime items (RT-02, RT-03;
// D-69): podman, podman-service, and openshell. AgentOS and the
// control channel have no item in Phase 3, because nothing there can inspect them (D-69).
// Phase 6 appends control-channel and agentos to REGISTERED deliberately (CLI-03; P6-D6,
// P6-D14); the list is a costly change under D-44. Phase 9.7 appends host-binaries and
// kernel-hardening after agentos for the same reason. Phase 21 appends host-plugins, Phase 32 appends
// capability-tokens after it, and Phase 55 appends omp-plugin after capability-tokens.
//
// Details and fixes name paths, rules, and schema pointers. They never carry a value read
// from the policy file (the privacy rule in src/contract/validate.ts).

import { execFile } from "node:child_process";
import { accessSync, constants, existsSync, statSync, type Stats } from "node:fs";
import { dirname, join } from "node:path";
import { SchemaInvalidError } from "../contract/validate.js";
import { ERROR_CATALOGUE, RealmError } from "../core/errors.js";
import { packageVersion } from "../core/package-version.js";
import { loadPolicyFileDetailed, type LoadedPolicy } from "../core/policy.js";
import { dialWithin, withTimeout } from "../core/timeout.js";
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
import { createHostAdapter } from "../host/adapter.js";
import { defaultManifestFor } from "../host/manifest.js";
import { HOST_RUNTIMES } from "../host/runtimes.js";
import type { HostEnv } from "../host/types.js";
import { nullLogger } from "../observe/logger.js";
import { capabilityTokensCheck } from "./capability-checks.js";
import {
  defaultReadPtraceScope,
  hostBinariesCheck,
  hostBinaryPinsFromEnv,
  kernelHardeningCheck,
  readOmpPresence,
  type HostBinaryInput,
  type HostBinaryPins,
} from "./checks-host.js";
import { hostPluginsCheck } from "./host-checks.js";
import { runtimeChecks, type RuntimeCheckOptions } from "./runtime-checks.js";
export type { ConnectSocket } from "../runtime/podman-probe.js";

export type CheckId =
  | "policy-file"
  | "state-dir"
  | "session-store"
  | "podman"
  | "podman-service"
  | "openshell"
  | "control-channel"
  | "agentos"
  | "host-binaries"
  | "kernel-hardening"
  | "runtime-roots"
  | "driver-socket"
  | "gateway"
  | "host-plugins"
  | "capability-tokens"
  | "omp-plugin";
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
  // Phase 3 seams (RT-02). Each has a real default; tests inject fakes so that no
  // process runs and no socket opens. env is the host environment, handed in by the caller at the entry
  // edge (the doctor reads no process environment). Each probe passes only the names its allowlist permits.
  readonly env: EnvironmentLike;
  readonly runCommand?: RunCommand;
  readonly connectSocket?: ConnectSocket;
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
  // Omp plugin seam (Phase 55, HEALTH-01). Absent, the check reads the omp receipt, the shim
  // target and the omp presence markers through the host adapter, and reads the Omp version
  // through runCommand. Tests inject a fake so no file is read and no process runs.
  readonly probeOmpPlugin?: OmpPluginProbe;
}

// What the Omp plugin probe reports (Phase 55, HEALTH-01). installed false: no omp receipt.
// installed true: version is the parsed Omp version text (null when `omp --version` could not be
// read or parsed), target is whether the file the installed shim imports exists, liveSessions
// counts presence markers whose process is alive, and unreadableMarkers counts the rest.
export type OmpPluginTarget = "present" | "missing" | "unreadable";
export type OmpPluginReading =
  | { readonly installed: false }
  | {
      readonly installed: true;
      readonly version: string | null;
      readonly target: OmpPluginTarget;
      readonly liveSessions: number;
      readonly unreadableMarkers: number;
    };
export type OmpPluginProbe = () => Promise<OmpPluginReading>;

// The lowest Omp version the plugin was written for (docs/integration/omp-lifecycle-runbook.md
// prerequisites; D-1206 in test/support/omp-live.ts). Newer versions run and are recorded.
export const MIN_OMP_VERSION = "18.12.6";

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
// Phase 6 appends control-channel and agentos after openshell (P6-D6, P6-D14), and phase 9.7 appends host-binaries and
// kernel-hardening after agentos; nothing earlier moves, because the list is a costly change under D-44.
const REGISTERED: readonly Check[] = [
  (context) => policyFileCheck(context.options),
  (context) => stateDirCheck(context.options),
  (context) => sessionStoreCheck(context.options, context.canWrite),
  podmanCheck,
  podmanServiceCheck,
  openShellCheck,
  controlChannelCheck,
  agentOsCheck,
  (context) => hostBinariesCheck(hostBinaryInput(context.options)),
  (context) => kernelHardeningCheck(context.options.readPtraceScope ?? defaultReadPtraceScope),
];

const DEFAULT_PROBE_TIMEOUT_MS = 5000;
const DEFAULT_HASH_TIMEOUT_MS = 30000;
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
  const hostPlugins = await hostPluginsCheck({ stateDir: options.stateDir });
  const capabilityTokens = capabilityTokensCheck({
    stateDir: options.stateDir,
    ...(options.policyPath === undefined ? {} : { policyPath: options.policyPath }),
    ...(options.runtimeConfig === undefined ? {} : { runtimeConfig: options.runtimeConfig }),
  });
  const ompPlugin = await ompPluginCheck(options);
  return [...registered, ...runtime, hostPlugins, capabilityTokens, ompPlugin];
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

// ---- Phase 3 items (RT-02, RT-03; D-69). Each item returns a status, a detail, and a fix
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

// ---- Phase 6 items (CLI-03; P6-D6, P6-D14). Each item returns a status, a detail, and a fix
// that is null only on pass. A detail names a catalogue code, a mode, or a rule. It never
// carries socket bytes or a value read from the engine.

const FIX_CONTROL_ABSENT = "Run realm up to start the daemon, then rerun doctor.";
const FIX_CONTROL_REFUSED =
  "Check that the realm daemon owns the control socket, then run realm up to replace a stale socket and rerun doctor.";
const FIX_AGENTOS_UP = "Run realm up, then rerun doctor.";
const FIX_GATEWAY_LOST = "Restore the OpenShell gateway and the compute driver behind it, then run realm down and realm up, and rerun doctor.";
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
// AGENTOS_CRASH_LOOP, unless the probe threw OPENSHELL_GATEWAY_LOST: the gateway or the compute driver behind it did not answer, and the item says so (OBS-04).
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

// ---- Phase 55 item (HEALTH-01). Read-only: the check installs, removes and repairs nothing, and
// doctor --fix is unchanged. Every read goes through the injected probe, wrapped in withTimeout,
// so a hung probe is a TOOL_TIMEOUT fail, never a hung doctor run. A detail names the catalogue
// code, the version and counts only, never a path or file content.

const FIX_OMP_INSTALL = "Run realm host install omp, then rerun doctor. Doctor installs, removes and repairs nothing.";
const FIX_OMP_UPGRADE = `Upgrade Omp to ${MIN_OMP_VERSION} or later yourself, then rerun doctor. Realm does not install or upgrade Omp.`;
const FIX_OMP_BUILD = "Run npm run build so the built extension entry exists, then run realm host install omp and rerun doctor.";
const FIX_OMP_SHIM = "Inspect the installed Omp shim without following symlinks, repair it by hand, then run realm host install omp and rerun doctor.";
const FIX_OMP_MARKERS = "Inspect the hosts directory and the omp presence markers without following symlinks; restore a known-good marker or remove the unreadable one, then rerun doctor.";
const FIX_OMP_LOAD = "Start an Omp session yourself and wait for the realm status item to settle, then rerun doctor. Doctor never signals a process.";
const FIX_OMP_INSPECT = "Inspect the Omp receipt and presence markers under the state directory without following symlinks, then rerun doctor.";

// The first x.y.z in the text (`omp --version` prints `omp/18.12.6`). Undefined when there is none.
const OMP_VERSION_PATTERN = /(?<!\d)(\d+)\.(\d+)\.(\d+)(?!\d)/;

function parseOmpVersionText(text: string): readonly [number, number, number] | undefined {
  const match = OMP_VERSION_PATTERN.exec(text);
  if (match === null) {
    return undefined;
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

// Negative when a is older than b, zero when equal, positive when newer.
function compareOmpVersions(a: readonly [number, number, number], b: readonly [number, number, number]): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

// omp-plugin (HEALTH-01). Pass only when the plugin is installed, the Omp version is at least
// MIN_OMP_VERSION, the shim target is present and a live presence marker names a loaded session.
async function ompPluginCheck(options: DoctorOptions): Promise<CheckResult> {
  const id: CheckId = "omp-plugin";
  const probe = options.probeOmpPlugin ?? defaultOmpPluginProbe(options);
  let reading: OmpPluginReading;
  try {
    reading = await withTimeout(probe(), probeTimeoutOf(options), "TOOL_TIMEOUT");
  } catch (error: unknown) {
    return { id, status: "fail", detail: `omp plugin state could not be read (${error instanceof RealmError ? error.code : "SCHEMA_INVALID"})`, fix: FIX_OMP_INSPECT };
  }
  if (!reading.installed) {
    return { id, status: "warn", detail: "omp plugin not installed", fix: FIX_OMP_INSTALL };
  }
  if (reading.version === null) {
    return { id, status: "fail", detail: "omp version could not be read", fix: FIX_OMP_UPGRADE };
  }
  const version = parseOmpVersionText(reading.version);
  const minimum = parseOmpVersionText(MIN_OMP_VERSION);
  if (version === undefined || minimum === undefined || compareOmpVersions(version, minimum) < 0) {
    return {
      id,
      status: "fail",
      detail: `omp version ${reading.version} is not ${MIN_OMP_VERSION} or later`,
      fix: FIX_OMP_UPGRADE,
    };
  }
  if (reading.target === "missing") {
    return { id, status: "fail", detail: "omp extension target missing", fix: FIX_OMP_BUILD };
  }
  if (reading.target === "unreadable") {
    return { id, status: "fail", detail: "omp extension target unreadable", fix: FIX_OMP_SHIM };
  }
  if (reading.unreadableMarkers > 0) {
    return {
      id,
      status: "warn",
      detail: `omp plugin installed (omp ${reading.version}), ${String(reading.unreadableMarkers)} unreadable presence marker(s)`,
      fix: FIX_OMP_MARKERS,
    };
  }
  if (reading.liveSessions === 0) {
    return { id, status: "warn", detail: `omp ${reading.version} installed but not loaded, no live plugin session`, fix: FIX_OMP_LOAD };
  }
  return {
    id,
    status: "pass",
    detail: `omp ${reading.version} installed and loaded, ${String(reading.liveSessions)} live plugin session(s), extension target present`,
    fix: null,
  };
}

// The default probe reads only through the seams the other doctor items already read: the omp
// receipt and shim target through the host adapter, the presence markers through readOmpPresence,
// and the Omp version through runCommand. Each read is bounded by probeTimeoutMs. It writes
// nothing and starts nothing except the version command.
function defaultOmpPluginProbe(options: DoctorOptions): OmpPluginProbe {
  return async (): Promise<OmpPluginReading> => {
    const timeoutMs = probeTimeoutOf(options);
    const env: HostEnv = { home: options.stateDir, env: {}, pathDirs: [] };
    const adapter = createHostAdapter(HOST_RUNTIMES.omp, defaultManifestFor("omp", packageVersion()), {
      stateDir: options.stateDir,
      adaptersDir: "",
      logger: nullLogger,
      now: () => new Date(),
      readTimeoutMs: timeoutMs,
    });
    const found = await adapter.status(env);
    if (found.status !== "installed" && found.status !== "drifted") {
      return { installed: false };
    }
    const version = await readOmpVersion(options, timeoutMs);
    const presence = await readOmpPresence(options.stateDir, timeoutMs);
    return {
      installed: true,
      version,
      target: found.extensionTarget ?? "unreadable",
      liveSessions: presence.live,
      unreadableMarkers: presence.unreadable,
    };
  };
}

// `omp --version` under the allowlisted environment names, bounded by timeoutMs. A failure to
// start, a non-zero exit, a timeout or unparseable output is null: the check then fails, because
// the right version cannot be proven. The output text never enters a detail.
async function readOmpVersion(options: DoctorOptions, timeoutMs: number): Promise<string | null> {
  const env: Record<string, string> = {};
  for (const name of ["PATH", "HOME", "XDG_RUNTIME_DIR"]) {
    const value = options.env[name];
    if (value !== undefined) {
      env[name] = value;
    }
  }
  let outcome: CommandOutcome;
  try {
    outcome = await withTimeout(
      (options.runCommand ?? defaultRunCommand)("omp", ["--version"], { env, timeoutMs }),
      timeoutMs,
      "TOOL_TIMEOUT",
    );
  } catch {
    return null;
  }
  if (outcome.exitCode !== 0) {
    return null;
  }
  const version = parseOmpVersionText(outcome.stdout);
  return version === undefined ? null : `${String(version[0])}.${String(version[1])}.${String(version[2])}`;
}

// The host-binaries inputs, with every default applied here: the environment pins, the runner and both timeouts. The checks in
// checks-host.ts apply no default of their own.
function hostBinaryInput(options: DoctorOptions): HostBinaryInput {
  return {
    env: options.env,
    pins: options.hostBinaryPins ?? hostBinaryPinsFromEnv(options.env),
    runCommand: options.runCommand ?? defaultRunCommand,
    probeTimeoutMs: probeTimeoutOf(options),
    hashTimeoutMs: options.hashTimeoutMs ?? DEFAULT_HASH_TIMEOUT_MS,
  };
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

// Dials a Unix socket and closes it at once. Rejects on refusal or a missing socket with the socket's error, and with
// PODMAN_MACHINE_DOWN when no connection completes within timeoutMs.
export async function defaultConnectSocket(socketPath: string, timeoutMs: number): Promise<void> {
  const socket = await dialWithin(socketPath, timeoutMs, "PODMAN_MACHINE_DOWN");
  socket.destroy();
}

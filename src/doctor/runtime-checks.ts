// Doctor checks for the three runtime roots, the driver socket and the gateway (ONB-04, D-1506).
// A missing or unloadable config is one item with first-time setup guidance. Configured root failures
// require manual recovery, not reinitialization. This module reads no process environment: the caller hands env in.

import { lstatSync, realpathSync, type Stats } from "node:fs";
import { isAbsolute, dirname, relative, sep } from "node:path";
import { dialWithin } from "../core/timeout.js";
import { makeRealmError } from "../core/errors.js";
import type { EnvironmentLike } from "../session/paths.js";
import { runtimeRootsOf, type RuntimeConfig } from "../runtime/config.js";
import { assertSocketPathsFit, channelPathsOf } from "../runtime/driver/channel.js";
import { secretDirOf } from "../runtime/driver/secret-store.js";
import { OPENSHELL_BINARY, realmSandboxName } from "../runtime/openshell.js";
import type { CommandOutcome, RunCommand } from "../runtime/podman-probe.js";
import { selectOpenShellEnvironment } from "../runtime/session-execution.js";

export type RuntimeCheckId = "runtime-roots" | "driver-socket" | "gateway";
export type RuntimeCheckStatus = "pass" | "warn" | "fail";

export interface RuntimeCheckResult {
  readonly id: RuntimeCheckId;
  readonly status: RuntimeCheckStatus;
  readonly detail: string;
  readonly fix: string | null;
}

export type PathReading =
  | { readonly state: "absent" }
  | { readonly state: "unreadable" }
  | { readonly state: "found"; readonly stats: Stats };

export interface RuntimeCheckOptions {
  // Absent, or a config the loader refused, produces the one-item report.
  readonly config?: RuntimeConfig;
  readonly env: EnvironmentLike;
  readonly stat?: (path: string) => PathReading;
  // The resolved config.json path. When it lies inside workspaceRoot the sandboxed agent could rewrite it.
  readonly configPath?: string;
  // Resolves a root to its canonical path. Defaults to realpathSync.
  readonly realpath?: (path: string) => string;
  // The driver socket path. When absent, REALM_DRIVER_SOCKET from env is the source.
  readonly driverSocketPath?: string;
  // Runs the openshell status probe. Required whenever config is present; runChecks passes the doctor's own runner.
  readonly runCommand?: RunCommand;
  readonly connectDriver?: (socketPath: string, timeoutMs: number) => Promise<void>;
  readonly probeTimeoutMs?: number;
}

const PRIVATE_DIR_MODE = 0o700;
const SOCKET_MODE = 0o600;
const PERMISSION_BITS = 0o777;
const DRIVER_SOCKET_ENV = "REALM_DRIVER_SOCKET";
const INIT_FIX = "For first-time setup with no config.json or policy.json, run realm init to write the config and prepare private roots at mode 0700. If either template already exists, preserve the templates and data and repair the existing config instead. A stale REALM_DRIVER_*_ROOT variable is ignored.";

// The fix for each driver-root condition. A fix names the root in its detail, never a path value.
const FIX_ROOT_UNSET =
  "Set an unset root named in the detail to an absolute path in the existing config.json; workspaceRoot is required. Omitted secretRoot and sandboxStateRoot keys use the defaults under stateDir: inspect those directories and keep the omissions if the defaults are intended, or explicitly name the intended private directories in the same config.";
const FIX_ROOT_RELATIVE = "Set the root named in the detail to an absolute path in config.json. The driver and the daemon read the same file.";
const FIX_ROOT_ABSENT =
  "Look up the root named in the detail in the existing config.json, including defaults under stateDir. Restore the intended missing directory and its data from the known location or backup. Only for a genuinely new secretRoot or sandboxStateRoot, manually create the confirmed private directory under this account at mode 0700 after inspecting its ancestors for symlinks. For workspaceRoot, select the existing project directory this account owns; preserve its mode and contents.";
const FIX_ROOT_UNREADABLE =
  "Inspect the configured root named in the detail and its ancestors as the runtime account. Check ownership and owner read/search access without following symlinks; restore that access only on confirmed directories this account owns. Do not recursively change permissions or ownership.";
const FIX_ROOT_TYPE =
  "Inspect the configured root named in the detail and its ancestors without following symlinks. Keep the existing entry and data intact: locate or restore the intended real directory, or correct only that root key in config.json if it names the wrong location. Private roots must be account-owned directories at mode 0700; workspaceRoot must be an existing account-owned project directory, with its mode preserved.";
const FIX_WORKSPACE_OWNER =
  "Check workspaceRoot in the existing config.json and select the intended existing project directory owned by the runtime account. Preserve the current workspace, its data and mode; do not take ownership of another account's directory.";
const FIX_ROOT_MODE =
  "Inspect ownership and the non-symlink directory and ancestors for the private root named in the detail. Only after confirming this account owns the intended private directory, manually set that directory's mode to 0700, without recursive permission or ownership changes. Do not change workspaceRoot permissions.";
const FIX_ROOT_MANUAL =
  "Preserve config.json, policy.json and existing data; do not reinitialize. The driver and daemon must select the same physical config.json. realm doctor --fix only creates or tightens stateDir, stateDir/run and stateDir/sessions; it does not repair or provision private roots or the workspace, or change ownership. Rerun realm doctor after manual recovery.";
const FIX_ROOT_CANONICAL =
  "Set the root named in the detail to its real directory path in config.json, with no symlinked ancestor, and keep the data where it is.";
const FIX_ROOT_OWNER =
  "Check the root named in the detail in the existing config.json and select the intended directory owned by the runtime account. Preserve the current data and mode; do not take ownership of another account's directory.";
const FIX_ROOT_SOCKET_PATH =
  "Choose a shorter absolute directory for secretRoot in config.json so that the channel socket paths stay within 107 bytes. Do not move existing data until the sandboxes that use it are stopped.";
const FIX_ROOT_OVERLAP =
  "Set secretRoot, sandboxStateRoot and workspaceRoot in config.json to apart directories, and keep stateDir outside workspaceRoot. The driver refuses overlapping roots, so the realm cannot start until they are apart.";
const FIX_CONFIG_IN_WORKSPACE =
  "Move config.json out of the workspace root, updating XDG_CONFIG_HOME or the unit, because a sandboxed agent that can write config.json can rewrite the image and the roots.";
// The sandbox session the socket-path check measures. The path length grows with the name, so a fixed short name keeps the check stable.
const SOCKET_PATH_SESSION = "daemon";

function fail(id: RuntimeCheckId, detail: string, fix: string): RuntimeCheckResult {
  return { id, status: "fail", detail, fix };
}

function pass(id: RuntimeCheckId, detail: string): RuntimeCheckResult {
  return { id, status: "pass", detail, fix: null };
}

function octal(mode: number): string {
  return (mode & PERMISSION_BITS).toString(8).padStart(3, "0");
}

function defaultStat(path: string): PathReading {
  try {
    return { state: "found", stats: lstatSync(path) };
  } catch (error: unknown) {
    const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
    if (code === "ENOENT") {
      return { state: "absent" };
    }
    return { state: "unreadable" };
  }
}

// The three roots the driver and the daemon share (ONB-04). The workspace is held to no mode: the driver accepts any mode for a
// workspace this account owns (assertPinnedWorkspaceRoot), so a 0755 project directory is a working setup.
const DRIVER_ROOT_KEYS = ["secretRoot", "workspaceRoot", "sandboxStateRoot"] as const;
type DriverRootKey = (typeof DRIVER_ROOT_KEYS)[number];

// One condition on one driver root. A root has at most one, and its fix says how to clear it.
interface RootFinding {
  readonly severity: "fail" | "warn";
  readonly detail: string;
  readonly fix: string;
}

// The condition a root is in, or undefined when it passes. The checks run in this order, and the first that holds is reported:
// unset, relative, then what the path is on disk, whether it is canonical, who owns it, and its mode.
// A detail names a root key, a mode or a rule, never a path value.
function rootFinding(
  key: DriverRootKey,
  path: string,
  stat: (path: string) => PathReading,
  realpath: (path: string) => string,
): RootFinding | undefined {
  // The empty and the missing are both unset. A config built without the loader can carry any value in a root.
  if (typeof path !== "string" || path.trim() === "") {
    return { severity: "fail", detail: `${key} is unset`, fix: FIX_ROOT_UNSET };
  }
  if (!isAbsolute(path)) {
    return { severity: "fail", detail: `${key} is not absolute`, fix: FIX_ROOT_RELATIVE };
  }
  const found = stat(path);
  if (found.state === "absent") {
    return { severity: "fail", detail: `${key} is absent`, fix: FIX_ROOT_ABSENT };
  }
  if (found.state === "unreadable") {
    return { severity: "fail", detail: `${key} cannot be inspected`, fix: FIX_ROOT_UNREADABLE };
  }
  if (found.stats.isSymbolicLink()) {
    return { severity: "fail", detail: `${key} is a symbolic link`, fix: FIX_ROOT_TYPE };
  }
  if (!found.stats.isDirectory()) {
    return { severity: "fail", detail: `${key} is not a directory`, fix: FIX_ROOT_TYPE };
  }
  // The driver refuses a root that is not its own canonical path, so a symlinked ancestor is a finding here too.
  let canonical: string;
  try {
    canonical = realpath(path);
  } catch {
    return { severity: "fail", detail: `${key} cannot be inspected`, fix: FIX_ROOT_UNREADABLE };
  }
  if (canonical !== path) {
    return { severity: "fail", detail: `${key} is not canonical`, fix: FIX_ROOT_CANONICAL };
  }
  const uid = process.getuid?.();
  if (uid !== undefined && typeof found.stats.uid === "number" && found.stats.uid !== uid) {
    return { severity: "fail", detail: `${key} is not owned by this account`, fix: key === "workspaceRoot" ? FIX_WORKSPACE_OWNER : FIX_ROOT_OWNER };
  }
  if (key === "workspaceRoot") {
    return undefined;
  }
  const mode = found.stats.mode & PERMISSION_BITS;
  if (mode !== PRIVATE_DIR_MODE) {
    return { severity: "fail", detail: `${key} mode is 0${octal(mode)}, expected 0700`, fix: FIX_ROOT_MODE };
  }
  return undefined;
}

// Lexical only, no filesystem access: true when the two paths are equal or one lies inside the other. This repeats the loader's
// rule in src/runtime/config.ts (rootsOverlap), which is not exported. A prefix sibling such as /srv/secrets-old against
// /srv/secrets is not overlap.
function rootsOverlap(a: string, b: string): boolean {
  return isSameOrInside(relative(a, b)) || isSameOrInside(relative(b, a));
}

function isSameOrInside(relativePath: string): boolean {
  return relativePath === "" || (relativePath !== ".." && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath));
}

// True when inner equals outer or lies inside it.
function isInside(outer: string, inner: string): boolean {
  return isSameOrInside(relative(outer, inner));
}

function isAbsolutePath(value: unknown): value is string {
  return typeof value === "string" && isAbsolute(value);
}

// The layout conditions of the effective roots. The loader refuses explicit overlap only; a derived default can still sit inside the
// workspace, and a config.json inside the workspace could be rewritten by the sandboxed agent.
function layoutFindings(config: RuntimeConfig, configPath: string | undefined): readonly RootFinding[] {
  const roots = runtimeRootsOf(config);
  const findings: RootFinding[] = [];
  if (isAbsolutePath(roots.secretRoot)) {
    try {
      const paths = channelPathsOf(secretDirOf(roots.secretRoot, realmSandboxName(SOCKET_PATH_SESSION)));
      assertSocketPathsFit([paths.controlSocket, paths.sshSocket]);
    } catch {
      findings.push({ severity: "fail", detail: `secretRoot is too long for a socket path under session ${SOCKET_PATH_SESSION}`, fix: FIX_ROOT_SOCKET_PATH });
    }
  }
  const { secretRoot, sandboxStateRoot, workspaceRoot } = roots;
  if (isAbsolutePath(secretRoot) && isAbsolutePath(sandboxStateRoot) && rootsOverlap(secretRoot, sandboxStateRoot)) {
    findings.push({ severity: "fail", detail: "secretRoot overlaps sandboxStateRoot", fix: FIX_ROOT_OVERLAP });
  }
  if (isAbsolutePath(workspaceRoot)) {
    for (const [key, root] of [["secretRoot", secretRoot], ["sandboxStateRoot", sandboxStateRoot]] as const) {
      if (isAbsolutePath(root) && rootsOverlap(root, workspaceRoot)) {
        findings.push({ severity: "fail", detail: `${key} overlaps workspaceRoot`, fix: FIX_ROOT_OVERLAP });
      }
    }
    if (isAbsolutePath(roots.stateDir) && isInside(workspaceRoot, roots.stateDir)) {
      findings.push({ severity: "fail", detail: "stateDir overlaps workspaceRoot", fix: FIX_ROOT_OVERLAP });
    }
    if (configPath !== undefined && isAbsolutePath(configPath) && isInside(workspaceRoot, configPath)) {
      findings.push({ severity: "fail", detail: "config.json is inside workspaceRoot", fix: FIX_CONFIG_IN_WORKSPACE });
    }
  }
  return findings;
}

// A private root that config.json omits takes its default under stateDir. That is a warning only when the root has no condition of
// its own. The workspace is required on the config, so it is never omitted.
function omittedFinding(key: DriverRootKey, config: RuntimeConfig): RootFinding | undefined {
  if (key === "workspaceRoot" || config[key] !== undefined) {
    return undefined;
  }
  return { severity: "warn", detail: `${key} not named in config.json; the default under stateDir is in effect`, fix: FIX_ROOT_UNSET };
}

// One runtime-roots item for the three roots. Each root contributes at most one finding, and the layout findings follow. Any fail
// makes the item fail; otherwise an omitted private root makes it warn; otherwise it passes with the detail the item has always
// reported.
export function runtimeRootsCheck(
  config: RuntimeConfig,
  stat: (path: string) => PathReading,
  realpath: (path: string) => string,
  configPath?: string,
): RuntimeCheckResult {
  const roots = runtimeRootsOf(config);
  const rootFindings = DRIVER_ROOT_KEYS.flatMap((key) => {
    const finding = rootFinding(key, roots[key], stat, realpath) ?? omittedFinding(key, config);
    return finding === undefined ? [] : [finding];
  });
  const findings = [...rootFindings, ...layoutFindings(config, configPath)];
  if (findings.length === 0) {
    return pass("runtime-roots", "secretRoot and sandboxStateRoot are absolute directories at mode 0700; workspaceRoot is an account-owned directory");
  }
  const detail = findings.map((finding) => finding.detail).join("; ");
  const fix = `${[...new Set(findings.map((finding) => finding.fix))].join(" ")} ${FIX_ROOT_MANUAL}`;
  if (findings.some((finding) => finding.severity === "fail")) {
    return fail("runtime-roots", detail, fix);
  }
  return { id: "runtime-roots", status: "warn", detail, fix };
}

export async function driverSocketCheck(
  socketPath: string | undefined,
  stat: (path: string) => PathReading,
  connect: (socketPath: string, timeoutMs: number) => Promise<void> = defaultConnectDriver,
  timeoutMs = 5000,
): Promise<RuntimeCheckResult> {
  const id: RuntimeCheckId = "driver-socket";
  if (socketPath === undefined || socketPath === "" || !isAbsolute(socketPath)) {
    return fail(id, "REALM_DRIVER_SOCKET is unset or not absolute", "Set REALM_DRIVER_SOCKET to the driver's socket path. The socket must be mode 0600 and its parent directory mode 0700.");
  }
  const found = stat(socketPath);
  if (found.state === "absent") {
    return fail(id, "driver socket is absent", "Start the compute driver so it binds REALM_DRIVER_SOCKET, mode 0600, in a directory of mode 0700.");
  }
  if (found.state === "unreadable") {
    return fail(id, "driver socket cannot be inspected", "Check the ownership of the driver socket and its parent directory.");
  }
  if (found.stats.isSymbolicLink() || !found.stats.isSocket()) {
    return fail(id, "driver socket path is not a socket", "Remove the non-socket at REALM_DRIVER_SOCKET and start the compute driver.");
  }
  const uid = process.getuid?.();
  if (uid !== undefined && typeof found.stats.uid === "number" && found.stats.uid !== uid) {
    return fail(id, "driver socket is not owned by this account", "Remove the foreign socket and start the compute driver as this account.");
  }
  const mode = found.stats.mode & PERMISSION_BITS;
  if (mode !== SOCKET_MODE) {
    return fail(id, `driver socket mode is 0${octal(mode)}, expected 0600`, "chmod 0600 the driver socket. The parent directory must be 0700.");
  }
  const parent = stat(dirname(socketPath));
  if (parent.state !== "found" || parent.stats.isSymbolicLink() || !parent.stats.isDirectory()) {
    return fail(id, "driver socket parent is not a directory", "The directory that holds REALM_DRIVER_SOCKET must be a real directory of mode 0700.");
  }
  if (uid !== undefined && typeof parent.stats.uid === "number" && parent.stats.uid !== uid) {
    return fail(id, "driver socket parent is not owned by this account", "The directory that holds REALM_DRIVER_SOCKET must belong to this account.");
  }
  const parentMode = parent.stats.mode & PERMISSION_BITS;
  if (parentMode !== PRIVATE_DIR_MODE) {
    return fail(id, `driver socket parent mode is 0${octal(parentMode)}, expected 0700`, "chmod 0700 the directory that holds REALM_DRIVER_SOCKET.");
  }
  try {
    await connect(socketPath, timeoutMs);
  } catch {
    return fail(id, "driver socket is not accepting connections", "Start the compute driver. A leftover socket file is not a running driver.");
  }
  return pass(id, "driver socket accepted a connection, mode 0600, parent mode 0700");
}

// Dials the compute driver's socket and closes it at once. A missed bound and a refused or absent socket both mean the
// driver behind the gateway did not answer, so both reject with OPENSHELL_GATEWAY_LOST.
export function defaultConnectDriver(socketPath: string, timeoutMs: number): Promise<void> {
  return dialWithin(socketPath, timeoutMs, "OPENSHELL_GATEWAY_LOST").then(
    (socket) => {
      socket.destroy();
    },
    () => {
      throw makeRealmError("OPENSHELL_GATEWAY_LOST");
    },
  );
}

// Thrown into the race when the probe outlives its bound. It is private, so no other rejection is mistaken for a timeout.
class DeadlineExceeded extends Error {}

const FIX_GATEWAY = "Register and start the realm gateway for this account as docs/integration/openshell.md describes, then rerun realm doctor.";
const FIX_GATEWAY_INSTALL = "Install the pinned OpenShell 0.1.5 CLI on PATH for this account, then rerun realm doctor.";

// Runs `openshell status -o json` and reads the one field `status`. The probe gets only the OpenShell environment names, and its
// output is parsed for that field and then dropped: no detail carries command output, an error message or an errno code.
export async function gatewayCheck(env: EnvironmentLike, runCommand: RunCommand, timeoutMs: number): Promise<RuntimeCheckResult> {
  const id: RuntimeCheckId = "gateway";
  let timer: NodeJS.Timeout | undefined;
  // The seam may not honour timeoutMs itself, so the wait is bounded here as well.
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new DeadlineExceeded());
    }, timeoutMs);
  });
  let outcome: CommandOutcome;
  try {
    outcome = await Promise.race([runCommand(OPENSHELL_BINARY, ["status", "-o", "json"], { env: selectOpenShellEnvironment(env), timeoutMs }), deadline]);
  } catch (error: unknown) {
    if (error instanceof DeadlineExceeded) {
      return fail(id, "gateway status did not answer in time", FIX_GATEWAY);
    }
    return fail(id, "openshell cannot be started", FIX_GATEWAY_INSTALL);
  } finally {
    clearTimeout(timer);
  }
  if (outcome.exitCode !== 0) {
    return fail(id, `gateway status exited with status ${String(outcome.exitCode)}`, FIX_GATEWAY);
  }
  const status = gatewayStatusOf(outcome.stdout);
  if (status === undefined) {
    return fail(id, "gateway status is not JSON", FIX_GATEWAY);
  }
  if (status === "connected") {
    return pass(id, "gateway is connected");
  }
  if (status === "not_configured") {
    return fail(id, "no gateway is registered for this account", FIX_GATEWAY);
  }
  return fail(id, "gateway is not connected", FIX_GATEWAY);
}

// The top-level string `status` of the JSON object the probe printed, or undefined when the text is not such an object.
function gatewayStatusOf(stdout: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return undefined;
  }
  const status = (parsed as Record<string, unknown>)["status"];
  return typeof status === "string" ? status : undefined;
}

// One item when config is absent. Three items when a config is handed in.
export async function runtimeChecks(options: RuntimeCheckOptions): Promise<readonly RuntimeCheckResult[]> {
  if (options.config === undefined) {
    return [fail("runtime-roots", "runtime config is absent", INIT_FIX)];
  }
  if (options.runCommand === undefined) {
    // A caller that hands in a config must also hand in the runner, so the gateway item never guesses how to run openshell.
    throw makeRealmError("SCHEMA_INVALID");
  }
  const stat = options.stat ?? defaultStat;
  const timeoutMs = options.probeTimeoutMs ?? 5000;
  return [
    runtimeRootsCheck(options.config, stat, options.realpath ?? realpathSync, options.configPath),
    await driverSocketCheck(options.driverSocketPath ?? options.env[DRIVER_SOCKET_ENV], stat, options.connectDriver ?? defaultConnectDriver, timeoutMs),
    await gatewayCheck(options.env, options.runCommand, timeoutMs),
  ];
}

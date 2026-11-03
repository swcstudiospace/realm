// Doctor checks for the three runtime roots, the driver socket and the gateway (ONB-04, D-1506).
// A missing or unloadable config is one item with first-time setup guidance. Configured root failures
// require manual recovery, not reinitialization. This module reads no process environment: the caller hands env in.

import { lstatSync, readFileSync, type Stats } from "node:fs";
import { connect as tlsConnect } from "node:tls";
import { isAbsolute, dirname } from "node:path";
import { dialWithin } from "../core/timeout.js";
import { makeRealmError } from "../core/errors.js";
import type { EnvironmentLike } from "../session/paths.js";
import { runtimeRootsOf, type RuntimeConfig } from "../runtime/config.js";

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
  readonly connectGateway?: (endpoint: string, caPath: string, timeoutMs: number) => Promise<void>;
  readonly connectDriver?: (socketPath: string, timeoutMs: number) => Promise<void>;
  readonly probeTimeoutMs?: number;
}

const PRIVATE_DIR_MODE = 0o700;
const SOCKET_MODE = 0o600;
const PERMISSION_BITS = 0o777;
const DRIVER_SOCKET_ENV = "REALM_DRIVER_SOCKET";
const GATEWAY_ENDPOINT_ENV = "REALM_DRIVER_GATEWAY_ENDPOINT";
const GATEWAY_CA_ENV = "REALM_DRIVER_GATEWAY_CA";
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

export function defaultConnectGateway(endpoint: string, caPath: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    let url: URL;
    try {
      url = new URL(endpoint);
    } catch {
      reject(makeRealmError("SCHEMA_INVALID"));
      return;
    }
    if (url.protocol !== "https:" || url.hostname === "") {
      reject(makeRealmError("SCHEMA_INVALID"));
      return;
    }
    let ca: Buffer;
    try {
      ca = readFileSync(caPath);
    } catch {
      reject(makeRealmError("SCHEMA_INVALID"));
      return;
    }
    const port = url.port === "" ? 443 : Number(url.port);
    // The certificate must chain to the configured CA and name the endpoint host. Node verifies both by default, and `ca`
    // replaces the system roots, so only REALM_DRIVER_GATEWAY_CA is trusted.
    const socket = tlsConnect({ host: url.hostname, port, servername: url.hostname, ca });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(makeRealmError("OPENSHELL_GATEWAY_LOST"));
    }, timeoutMs);
    socket.once("secureConnect", () => {
      clearTimeout(timer);
      socket.destroy();
      resolve();
    });
    socket.once("error", () => {
      clearTimeout(timer);
      socket.destroy();
      reject(makeRealmError("OPENSHELL_GATEWAY_LOST"));
    });
  });
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
// unset, relative, then what the path is on disk. A detail names a root key, a mode or a rule, never a path value.
function rootFinding(key: DriverRootKey, path: string, stat: (path: string) => PathReading): RootFinding | undefined {
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
  if (key === "workspaceRoot") {
    const uid = process.getuid?.();
    if (uid !== undefined && typeof found.stats.uid === "number" && found.stats.uid !== uid) {
      return { severity: "fail", detail: "workspaceRoot is not owned by this account", fix: FIX_WORKSPACE_OWNER };
    }
    return undefined;
  }
  const mode = found.stats.mode & PERMISSION_BITS;
  if (mode !== PRIVATE_DIR_MODE) {
    return { severity: "fail", detail: `${key} mode is 0${octal(mode)}, expected 0700`, fix: FIX_ROOT_MODE };
  }
  return undefined;
}

// A private root that config.json omits takes its default under stateDir. That is a warning only when the root has no condition of
// its own. The workspace is required on the config, so it is never omitted.
function omittedFinding(key: DriverRootKey, config: RuntimeConfig): RootFinding | undefined {
  if (key === "workspaceRoot" || config[key] !== undefined) {
    return undefined;
  }
  return { severity: "warn", detail: `${key} not named in config.json; the default under stateDir is in effect`, fix: FIX_ROOT_UNSET };
}

// One runtime-roots item for the three roots. Each root contributes at most one finding. Any fail makes the item fail; otherwise an
// omitted private root makes it warn; otherwise it passes with the detail the item has always reported.
export function runtimeRootsCheck(config: RuntimeConfig, stat: (path: string) => PathReading): RuntimeCheckResult {
  const roots = runtimeRootsOf(config);
  const findings = DRIVER_ROOT_KEYS.flatMap((key) => {
    const finding = rootFinding(key, roots[key], stat) ?? omittedFinding(key, config);
    return finding === undefined ? [] : [finding];
  });
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
  env: EnvironmentLike,
  stat: (path: string) => PathReading,
  connect: (socketPath: string, timeoutMs: number) => Promise<void> = defaultConnectDriver,
  timeoutMs = 5000,
): Promise<RuntimeCheckResult> {
  const id: RuntimeCheckId = "driver-socket";
  const socketPath = env[DRIVER_SOCKET_ENV];
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
  const mode = found.stats.mode & PERMISSION_BITS;
  if (mode !== SOCKET_MODE) {
    return fail(id, `driver socket mode is 0${octal(mode)}, expected 0600`, "chmod 0600 the driver socket. The parent directory must be 0700.");
  }
  const parent = stat(dirname(socketPath));
  if (parent.state !== "found" || parent.stats.isSymbolicLink() || !parent.stats.isDirectory()) {
    return fail(id, "driver socket parent is not a directory", "The directory that holds REALM_DRIVER_SOCKET must be a real directory of mode 0700.");
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

export async function gatewayCheck(
  env: EnvironmentLike,
  connectGateway: (endpoint: string, caPath: string, timeoutMs: number) => Promise<void>,
  timeoutMs: number,
): Promise<RuntimeCheckResult> {
  const id: RuntimeCheckId = "gateway";
  const endpoint = env[GATEWAY_ENDPOINT_ENV];
  if (endpoint === undefined || endpoint === "") {
    return fail(id, "REALM_DRIVER_GATEWAY_ENDPOINT is unset", "Set REALM_DRIVER_GATEWAY_ENDPOINT to the gateway's https URL and confirm the gateway is listening.");
  }
  const caPath = env[GATEWAY_CA_ENV];
  if (caPath === undefined || caPath === "") {
    return fail(id, "REALM_DRIVER_GATEWAY_CA is unset", "Set REALM_DRIVER_GATEWAY_CA to the CA file that signs the gateway certificate.");
  }
  try {
    await connectGateway(endpoint, caPath, timeoutMs);
  } catch {
    return fail(id, "gateway is unreachable or its certificate does not chain to REALM_DRIVER_GATEWAY_CA", "Start the OpenShell gateway, confirm REALM_DRIVER_GATEWAY_ENDPOINT is the https URL it listens on, and confirm REALM_DRIVER_GATEWAY_CA is the CA that signed its certificate.");
  }
  return pass(id, "gateway presented a certificate that chains to REALM_DRIVER_GATEWAY_CA");
}

// One item when config is absent. Three items when a config is handed in.
export async function runtimeChecks(options: RuntimeCheckOptions): Promise<readonly RuntimeCheckResult[]> {
  if (options.config === undefined) {
    return [fail("runtime-roots", "runtime config is absent", INIT_FIX)];
  }
  const stat = options.stat ?? defaultStat;
  const timeoutMs = options.probeTimeoutMs ?? 5000;
  return [
    runtimeRootsCheck(options.config, stat),
    await driverSocketCheck(options.env, stat, options.connectDriver ?? defaultConnectDriver, timeoutMs),
    await gatewayCheck(options.env, options.connectGateway ?? defaultConnectGateway, timeoutMs),
  ];
}

// Helpers for the gated production live suite (PRD-TST-02, PRD-TST-03). The pure pieces (probe output parsing, the polling
// helper, the benchmark-range check, the skip-reason selection, the daemon process finder, the JSON-RPC line framing and the
// response matcher) are covered by the hermetic file test/integration/production-live-helpers.test.ts, which always runs. The
// rest drives the real stack: it builds an isolated realm configuration per scenario, runs the built CLI and the openshell CLI,
// talks MCP to a `realm mcp` child over stdio, and checks that a scenario left nothing behind.
//
// Nothing here reads the process environment or touches the host at import time: every function takes what it needs as a
// parameter, so the hermetic file can import this module on any host.
//
// Nothing here prints a secret. A failure message carries exit codes, error codes, names and clipped probe output only.

import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, writeFileSync, accessSync, constants, statSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { delimiter, isAbsolute, join } from "node:path";
import { performance } from "node:perf_hooks";
import type { EgressRule } from "../../src/contract/validate.js";
import { podmanSocketPath } from "../../src/runtime/host-paths.js";
import { requestLogPath } from "../../src/daemon/ensure.js";
import { loadRuntimeConfig, runtimeRootsOf } from "../../src/runtime/config.js";
import { buildExecArgv, OPENSHELL_BINARY, OPENSHELL_SANDBOX_NAME_LABEL_KEY, REALM_SANDBOX_NAME_PREFIX } from "../../src/runtime/openshell.js";
import { podmanSkipReason, type PodmanProbe } from "../../src/runtime/podman-version.js";
import { selectOpenShellEnvironment } from "../../src/runtime/session-execution.js";
import { controlSocketPath, sandboxNameOfSession, sessionIdOfWorkspace, type EnvironmentLike } from "../../src/session/paths.js";

// ---- Gate ---------------------------------------------------------------------------------------------------------------

export const LIVE_PRODUCTION_VARIABLE = "REALM_LIVE_PRODUCTION";
export const LIVE_IMAGE_VARIABLE = "REALM_LIVE_IMAGE";
export const LIVE_DRIVER_CONFIG_VARIABLE = "REALM_LIVE_DRIVER_CONFIG";
export const LIVE_DRIVER_SOCKET_VARIABLE = "REALM_DRIVER_SOCKET";

// The host facts the gate decides from. Each is injected, so the hermetic file can cover every branch.
export interface ProductionGateInputs {
  readonly env: EnvironmentLike;
  readonly podman: PodmanProbe;
  readonly isSocket: (path: string) => boolean;
  readonly onPath: (name: string) => boolean;
  readonly exists: (path: string) => boolean;
  readonly isDirectory: (path: string) => boolean;
  // Reads the driver config. Omitted, the gate reads the file itself. A throw or a value
  // loadRuntimeConfig refuses is a skip reason, not a crash before the scenarios register.
  readonly readConfig?: (path: string) => string;
  // The built CLI beside the compiled tests (dist/src/cli/main.js).
  readonly cliPath: string;
}

// The reason the production live suite cannot run, or false when every prerequisite holds. The reason names the FIRST missing
// prerequisite, in this order: the operator opt-in, Podman 5.x, the image, REALM_LIVE_DRIVER_CONFIG, REALM_DRIVER_SOCKET, the
// rootless socket, the openshell CLI and the built CLI. The opt-in is exactly "1": the test never sets it.
export function productionSkipReason(inputs: ProductionGateInputs): string | false {
  const { env } = inputs;
  if (env[LIVE_PRODUCTION_VARIABLE] !== "1") {
    return `${LIVE_PRODUCTION_VARIABLE}=1 is not set; the production live suite needs an explicit operator opt-in`;
  }
  const podman = podmanSkipReason(inputs.podman);
  if (podman !== false) {
    return podman;
  }
  if ((env[LIVE_IMAGE_VARIABLE] ?? "") === "") {
    return `${LIVE_IMAGE_VARIABLE} not set; the production live suite needs the digest-pinned image the running driver was given`;
  }
  const driverConfig = env[LIVE_DRIVER_CONFIG_VARIABLE];
  if (driverConfig === undefined || !isAbsolute(driverConfig) || !inputs.exists(driverConfig)) {
    return `${LIVE_DRIVER_CONFIG_VARIABLE} is not an absolute path to an existing file; it must be the config.json the running driver reads`;
  }
  if (!readableDriverConfig(driverConfig, inputs.readConfig ?? ((path) => readFileSync(path, "utf8")))) {
    return `${LIVE_DRIVER_CONFIG_VARIABLE} is not a readable runtime config; it must be the config.json the running driver reads`;
  }
  const driverSocket = env[LIVE_DRIVER_SOCKET_VARIABLE];
  if (driverSocket === undefined || !isAbsolute(driverSocket) || !inputs.isSocket(driverSocket)) {
    return `${LIVE_DRIVER_SOCKET_VARIABLE} is not an absolute path to the socket the running compute driver binds; it must be the socket the daemon probes`;
  }
  const socket = podmanSocketPath(env);
  if (socket === undefined) {
    return "XDG_RUNTIME_DIR is not an absolute path, so the rootless Podman API socket cannot be located";
  }
  if (!inputs.isSocket(socket)) {
    return "no rootless Podman API socket under XDG_RUNTIME_DIR; start it with systemctl --user start podman.socket";
  }
  if (!inputs.onPath(OPENSHELL_BINARY)) {
    return "no openshell CLI on PATH; the suite runs sandbox exec, upload, download and list through it";
  }
  if (!inputs.exists(inputs.cliPath)) {
    return "the built CLI dist/src/cli/main.js is missing; run npm run build first";
  }
  return false;
}

function readableDriverConfig(path: string, readConfig: (path: string) => string): boolean {
  try {
    loadRuntimeConfig(JSON.parse(readConfig(path)));
    return true;
  } catch {
    return false;
  }
}

// `podman --version` is local and fast; the timeout keeps a hung binary from hanging the run.
const PODMAN_PROBE_TIMEOUT_MS = 5_000;

// Runs `podman --version`. Any failure (ENOENT, non-zero exit, timeout) is "unavailable", which podmanSkipReason maps to
// PODMAN_MISSING.
export function probePodman(): Promise<PodmanProbe> {
  return new Promise((resolve) => {
    execFile("podman", ["--version"], { timeout: PODMAN_PROBE_TIMEOUT_MS }, (error, stdout) => {
      resolve(error === null ? { kind: "output", stdout } : { kind: "unavailable" });
    });
  });
}

// True when path is a directory. A path that cannot be read is not one.
export function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

// True when path is a Unix socket. A path that cannot be read is not a socket.
export function isSocket(path: string): boolean {
  try {
    return statSync(path).isSocket();
  } catch {
    return false;
  }
}

// True when an executable named name is on PATH. The file is inspected, never run.
export function onPath(name: string, pathValue: string | undefined): boolean {
  for (const dir of (pathValue ?? "").split(delimiter)) {
    if (dir === "") {
      continue;
    }
    try {
      const candidate = join(dir, name);
      if (statSync(candidate).isFile()) {
        accessSync(candidate, constants.X_OK);
        return true;
      }
    } catch {
      // Not executable at this PATH entry; the next entry may still hold it.
    }
  }
  return false;
}

// ---- Pure helpers -------------------------------------------------------------------------------------------------------

// Parses "name: value" lines, such as /proc/self/status. The name is the text before the first colon and the value is the
// rest, both trimmed. A line with no colon or an empty name is skipped, and the first line wins when a name repeats.
export function parseProbeFields(output: string): ReadonlyMap<string, string> {
  const fields = new Map<string, string>();
  for (const line of output.split(/\r?\n/)) {
    const cut = line.indexOf(":");
    if (cut < 0) {
      continue;
    }
    const name = line.slice(0, cut).trim();
    if (name === "" || fields.has(name)) {
      continue;
    }
    fields.set(name, line.slice(cut + 1).trim());
  }
  return fields;
}

const IPV4_PATTERN = /^(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})$/;

// True when address is a dotted IPv4 address inside 198.18.0.0/15, the benchmarking range the sandbox resolver answers from.
// Anything else, including a malformed address or an octet above 255, is false.
export function isBenchmarkAddress(address: string): boolean {
  const match = IPV4_PATTERN.exec(address);
  if (match === null) {
    return false;
  }
  const octets = match.slice(1).map(Number);
  if (octets.some((octet) => octet > 255)) {
    return false;
  }
  return octets[0] === 198 && (octets[1] === 18 || octets[1] === 19);
}

// The one line an in-sandbox node probe prints: "ok", "ok <detail>" or "error <CODE>".
export type NodeProbeResult =
  | { readonly kind: "ok"; readonly detail: string }
  | { readonly kind: "error"; readonly code: string }
  | { readonly kind: "unparsed" };

// Reads the last non-empty line of a node probe's stdout.
export function parseNodeProbe(stdout: string): NodeProbeResult {
  const last = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .at(-1);
  if (last === undefined) {
    return { kind: "unparsed" };
  }
  if (last === "ok" || last.startsWith("ok ")) {
    return { kind: "ok", detail: last.slice(2).trim() };
  }
  if (last.startsWith("error ")) {
    return { kind: "error", code: last.slice(6).trim() };
  }
  return { kind: "unparsed" };
}

// The lifecycle state in `realm status` output: the JSON the CLI prints holds snapshot.state. Undefined for any other text.
export function stateOfStatus(stdout: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null) {
    return undefined;
  }
  const snapshot: unknown = Reflect.get(parsed, "snapshot");
  if (typeof snapshot !== "object" || snapshot === null) {
    return undefined;
  }
  const state: unknown = Reflect.get(snapshot, "state");
  return typeof state === "string" ? state : undefined;
}

// The lifecycle fields `realm status` prints: snapshot.state, snapshot.reason and display.label. A field that is missing or not
// a string is undefined, and so is the whole result for any text that is not a JSON object.
export interface StatusFields {
  readonly state: string | undefined;
  readonly reason: string | undefined;
  readonly label: string | undefined;
}

function stringField(value: unknown, key: string): string | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const found: unknown = Reflect.get(value, key);
  return typeof found === "string" ? found : undefined;
}

function objectField(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;
}

export function statusFieldsOf(stdout: string): StatusFields | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null) {
    return undefined;
  }
  const snapshot = objectField(parsed, "snapshot");
  const display = objectField(parsed, "display");
  return { state: stringField(snapshot, "state"), reason: stringField(snapshot, "reason"), label: stringField(display, "label") };
}

// The `notice` string of the daemon reply `realm status` prints (D-1404). Undefined when the text is not a JSON object or holds
// no string `notice`.
export function noticeOfStatus(stdout: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return undefined;
  }
  return stringField(parsed, "notice");
}

// The error an MCP tools/call result carries: isError true with structuredContent {code, retryable}. Undefined when the result is
// not a tool error, or when the code or the retryable flag is missing or of the wrong type.
export interface ToolErrorFields {
  readonly code: string;
  readonly retryable: boolean;
}

export function toolErrorOf(result: unknown): ToolErrorFields | undefined {
  if (objectField(result, "isError") !== true) {
    return undefined;
  }
  const structured = objectField(result, "structuredContent");
  const code = stringField(structured, "code");
  const retryable = objectField(structured, "retryable");
  return code !== undefined && typeof retryable === "boolean" ? { code, retryable } : undefined;
}

// ---- Polling ------------------------------------------------------------------------------------------------------------

export interface PollClock {
  // Milliseconds on a monotonic clock.
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
}

const REAL_CLOCK: PollClock = {
  now: () => performance.now(),
  sleep: (ms) =>
    new Promise<void>((resolve) => {
      setTimeout(resolve, ms);
    }),
};

export type PollCheck = { readonly done: true } | { readonly done: false; readonly detail: string };

export interface PollOptions {
  readonly timeoutMs: number;
  readonly intervalMs: number;
  readonly clock?: PollClock;
}

export interface PollOutcome {
  readonly ok: boolean;
  readonly attempts: number;
  // The last failed check's detail; empty when the poll succeeded.
  readonly detail: string;
}

// Runs check until it reports done or timeoutMs has passed on the clock. The check always runs once, and once more at the
// deadline, so a condition that clears just before the bound is still seen. Between checks it sleeps intervalMs, or the time
// left when that is shorter. A check that throws rejects the poll.
export async function pollUntil(check: () => Promise<PollCheck>, options: PollOptions): Promise<PollOutcome> {
  if (!Number.isInteger(options.timeoutMs) || options.timeoutMs <= 0 || !Number.isInteger(options.intervalMs) || options.intervalMs <= 0) {
    throw new RangeError("timeoutMs and intervalMs must be positive integers");
  }
  const clock = options.clock ?? REAL_CLOCK;
  const start = clock.now();
  let attempts = 0;
  for (;;) {
    attempts += 1;
    const outcome = await check();
    if (outcome.done) {
      return { ok: true, attempts, detail: "" };
    }
    const remaining = options.timeoutMs - (clock.now() - start);
    if (remaining <= 0) {
      return { ok: false, attempts, detail: outcome.detail };
    }
    await clock.sleep(Math.min(options.intervalMs, remaining));
  }
}

// ---- Commands -----------------------------------------------------------------------------------------------------------

// The largest stdout or stderr one command may produce. The 16 MiB transfer is verified by hash, never by output.
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;

export interface CommandResult {
  // Undefined when the command did not run to an exit: it could not start, was signalled, or timed out.
  readonly exitCode: number | undefined;
  readonly stdout: string;
  readonly stderr: string;
  // Why there is no exit code: "timeout", the spawn error code, or the signal.
  readonly failure?: string;
}

// Runs file with argv (no shell) and never rejects: every failure is a CommandResult.
export function runCommand(
  file: string,
  args: readonly string[],
  options: { readonly env: Readonly<Record<string, string>>; readonly timeoutMs: number; readonly cwd: string },
): Promise<CommandResult> {
  return new Promise((resolve) => {
    execFile(
      file,
      [...args],
      { env: { ...options.env }, timeout: options.timeoutMs, cwd: options.cwd, maxBuffer: MAX_OUTPUT_BYTES },
      (error, stdout, stderr) => {
        if (error === null) {
          resolve({ exitCode: 0, stdout, stderr });
          return;
        }
        if (typeof error.code === "number") {
          resolve({ exitCode: error.code, stdout, stderr });
          return;
        }
        const failure = error.killed === true ? "timeout" : (error.signal ?? error.code ?? "failed");
        resolve({ exitCode: undefined, stdout, stderr, failure });
      },
    );
  });
}

const CLIP_LIMIT = 300;

function clip(text: string): string {
  const trimmed = text.trim();
  return JSON.stringify(trimmed.length > CLIP_LIMIT ? `${trimmed.slice(0, CLIP_LIMIT)}...` : trimmed);
}

// One line for an assertion message: the exit, then the clipped output. Probe output holds no secret, and the realm CLI
// prints catalogue codes and reasons, never environment values.
export function describeResult(result: CommandResult): string {
  const exit = result.exitCode === undefined ? `did not exit (${result.failure ?? "unknown"})` : `exit ${String(result.exitCode)}`;
  return `${exit}; stdout ${clip(result.stdout)}; stderr ${clip(result.stderr)}`;
}

// True when a TCP connection to host:port (IPv4) opens within timeoutMs.
export function canConnect(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host, port, family: 4 });
    const finish = (opened: boolean): void => {
      socket.destroy();
      resolve(opened);
    };
    socket.setTimeout(timeoutMs, () => {
      finish(false);
    });
    socket.once("connect", () => {
      finish(true);
    });
    socket.once("error", () => {
      finish(false);
    });
  });
}

// ---- Live inputs and scenario isolation ---------------------------------------------------------------------------------

// Each project's session id and sandbox name come from its canonical path, through the daemon's own derivation
// (sessionIdOfWorkspace, sandboxNameOfSession), so a suite names the sandbox and audit file of its own workspace.
export function sessionIdFor(workspaceRoot: string): string {
  return sessionIdOfWorkspace(realpathSync(workspaceRoot));
}

export function sandboxNameFor(workspaceRoot: string): string {
  return sandboxNameOfSession(sessionIdOfWorkspace(realpathSync(workspaceRoot)));
}

// The 107-byte limit of a Unix socket path (sun_path is 108 bytes with its terminator).
const SOCKET_PATH_LIMIT_BYTES = 107;

export interface LiveInputs {
  readonly image: string;
  readonly stateRoot: string;
  readonly secretRoot: string;
  readonly workspaceRoot: string;
  readonly cliPath: string;
  // PATH, HOME and XDG_RUNTIME_DIR from the test's own environment: all the openshell CLI and podman receive.
  readonly hostEnvironment: Readonly<Record<string, string>>;
  // The compute driver's socket the daemon probes (REALM_DRIVER_SOCKET), when the operator's environment names it.
  readonly driverSocketPath?: string;
  // The driver's own state directory. A live scenario's daemon uses it, so the driver can read the workspace registry it writes.
  readonly driverStateDir?: string;
}

// Reads the live inputs after the gate has passed. A missing value throws naming the variable, never its content.
export function readLiveInputs(env: EnvironmentLike, cliPath: string): LiveInputs {
  const required = (name: string): string => {
    const value = env[name];
    if (value === undefined || value === "") {
      throw new Error(`${name} must be set`);
    }
    return value;
  };
  const configPath = required(LIVE_DRIVER_CONFIG_VARIABLE);
  const driverSocket = env[LIVE_DRIVER_SOCKET_VARIABLE];
  const runtime = loadRuntimeConfig(JSON.parse(readFileSync(configPath, "utf8")));
  const roots = runtimeRootsOf(runtime);
  return {
    image: required(LIVE_IMAGE_VARIABLE),
    stateRoot: roots.sandboxStateRoot,
    secretRoot: roots.secretRoot,
    workspaceRoot: roots.workspaceRoot,
    cliPath,
    hostEnvironment: selectOpenShellEnvironment(env),
    driverStateDir: runtime.stateDir,
    ...(driverSocket === undefined ? {} : { driverSocketPath: driverSocket }),
  };
}

// The image the wrong-digest scenario configures: a well-formed pin that no registry or local store holds.
export const UNKNOWN_DIGEST_IMAGE = `localhost/realm-agentos@sha256:${"0".repeat(64)}`;

const RESERVED_POLICY_KEYS: readonly string[] = ["workspaceRoots", "egressAllow"];

export interface ScenarioSpec {
  readonly image: string;
  // Rendered into policy.json; omitted when empty, which leaves the deny-all default.
  readonly egressAllow?: readonly EgressRule[];
  // Further policy keys merged into policy.json (startupBudgetMs, for one). workspaceRoots and egressAllow belong to the
  // scenario itself and are rejected here, so an extra object can never override the pinned root or the egress rules.
  readonly policyExtra?: Readonly<Record<string, unknown>>;
}

export interface ScenarioEnvironment {
  // The scenario's temporary directory: config home, state directory and transfer files all live beneath it.
  readonly root: string;
  readonly stateDir: string;
  // The environment the realm CLI (and the daemon it spawns) runs with.
  readonly cliEnvironment: Readonly<Record<string, string>>;
  // Set only for a live run on the driver's state root: the record that restores the operator's policy and removes what the run created.
  readonly sharedState?: SharedStateRecord;
}

// Builds one scenario's own XDG config home with realm/config.json and a policy.json in a short temporary state directory,
// so the control socket path stays under the 107-byte limit. The policy pins the workspace root alone, so no scenario reads
// another's configuration and none touches the operator's.
export function createScenarioEnvironment(inputs: LiveInputs, spec: ScenarioSpec): ScenarioEnvironment {
  for (const reserved of RESERVED_POLICY_KEYS) {
    if (spec.policyExtra !== undefined && Object.hasOwn(spec.policyExtra, reserved)) {
      throw new Error(`policyExtra must not set the reserved policy key ${reserved}`);
    }
  }
  const root = realpathSync(mkdtempSync(join(tmpdir(), "rlv-")));
  const configHome = join(root, "c");
  const stateDir = inputs.driverStateDir ?? join(root, "s");
  mkdirSync(join(configHome, "realm"), { recursive: true });
  if (inputs.driverStateDir === undefined) {
    mkdirSync(stateDir, { mode: 0o700 });
    chmodSync(stateDir, 0o700);
  }
  if (Buffer.byteLength(controlSocketPath(stateDir)) > SOCKET_PATH_LIMIT_BYTES) {
    throw new Error("the temporary state directory is too long for the control socket path; set TMPDIR to a shorter directory");
  }
  writeFileSync(
    join(configHome, "realm", "config.json"),
    `${JSON.stringify({ image: spec.image, stateDir, workspaceRoot: inputs.workspaceRoot, secretRoot: inputs.secretRoot, sandboxStateRoot: inputs.stateRoot })}\n`,
    { mode: 0o600 },
  );
  // The OpenShell CLI finds the realm gateway under XDG_CONFIG_HOME, which the scenario overrides. Carry the host's gateway
  // registration into the scenario's own config home; the copy lives in the 0700 temporary directory and is removed with it.
  const hostHome = inputs.hostEnvironment["HOME"];
  if (hostHome !== undefined && isAbsolute(hostHome) && existsSync(join(hostHome, ".config", "openshell"))) {
    cpSync(join(hostHome, ".config", "openshell"), join(configHome, "openshell"), { recursive: true });
  }
  const egressAllow = spec.egressAllow ?? [];
  const policy = { workspaceRoots: [inputs.workspaceRoot], ...(egressAllow.length > 0 ? { egressAllow } : {}), ...spec.policyExtra };
  const shared = inputs.driverStateDir === undefined ? undefined : backupSharedState(stateDir);
  writeFileSync(join(stateDir, "policy.json"), `${JSON.stringify(policy)}\n`, { mode: 0o600 });
  return {
    root,
    stateDir,
    cliEnvironment: {
      ...inputs.hostEnvironment,
      XDG_CONFIG_HOME: configHome,
      ...(inputs.driverSocketPath === undefined ? {} : { REALM_DRIVER_SOCKET: inputs.driverSocketPath }),
    },
    ...(shared === undefined ? {} : { sharedState: shared }),
  };
}

// ---- Shared live state ---------------------------------------------------------------------------------------------------
// A live scenario's daemon uses the driver's own state directory. The driver reads the workspace registry from there, so a
// temporary state directory makes every create refuse with create.workspace. The run therefore writes into the live state
// root under two rules: the operator's policy.json is backed up before the run and restored after it, and every entry the
// run creates in the state root is removed after `realm down`. The daemon and driver logs are appended to, not removed.

// The state-root entries the run may create, by directory. Entries already present are never removed.
const SHARED_STATE_DIRECTORIES: readonly string[] = Object.freeze([
  "audit",
  "checkpoints",
  "runtime",
  "run",
  "sandboxes",
  "secrets",
  "sessions",
  "workspace-pins",
  "workspaces",
]);

export interface SharedStateRecord {
  // The relative paths under the state root that existed before the run.
  readonly preexisting: ReadonlySet<string>;
  // The bytes of the root's policy.json before the run, or null when the file did not exist.
  readonly policyBefore: Buffer | null;
}

function listSharedState(stateDir: string): Set<string> {
  const found = new Set<string>(readdirSync(stateDir));
  const walk = (relative: string): void => {
    for (const entry of readdirSync(join(stateDir, relative), { withFileTypes: true })) {
      const child = `${relative}/${entry.name}`;
      found.add(child);
      if (entry.isDirectory()) {
        walk(child);
      }
    }
  };
  for (const directory of SHARED_STATE_DIRECTORIES) {
    if (existsSync(join(stateDir, directory))) {
      found.add(directory);
      walk(directory);
    }
  }
  return found;
}

function backupSharedState(stateDir: string): SharedStateRecord {
  const policyPath = join(stateDir, "policy.json");
  return {
    preexisting: listSharedState(stateDir),
    policyBefore: existsSync(policyPath) ? readFileSync(policyPath) : null,
  };
}

// Restores the operator's policy.json byte-for-byte, or removes the scenario's copy when there was none before the run.
export function restoreSharedPolicy(scenario: ScenarioEnvironment): void {
  if (scenario.sharedState === undefined) {
    return;
  }
  const policyPath = join(scenario.stateDir, "policy.json");
  const before = scenario.sharedState.policyBefore;
  if (before === null) {
    rmSync(policyPath, { force: true });
  } else {
    writeFileSync(policyPath, before);
  }
}

// Removes each state-root entry the run created, parents before children, and nothing that existed before the run.
export function removeSharedStateCreatedBy(scenario: ScenarioEnvironment): void {
  if (scenario.sharedState === undefined) {
    return;
  }
  const { preexisting } = scenario.sharedState;
  const created = [...listSharedState(scenario.stateDir)].filter((relative) => !preexisting.has(relative));
  created.sort((a, b) => a.length - b.length);
  for (const relative of created) {
    rmSync(join(scenario.stateDir, relative), { recursive: true, force: true });
  }
}

// Runs the built realm CLI through node, with the scenario's own environment.
export function realmCli(inputs: LiveInputs, scenario: ScenarioEnvironment, args: readonly string[], timeoutMs: number): Promise<CommandResult> {
  return runCommand(process.execPath, [inputs.cliPath, ...args], { env: scenario.cliEnvironment, timeoutMs, cwd: scenario.root });
}

// Runs `realm status` or `realm down` for the project at workspace (an absolute path), so the command never depends on the
// current directory. Any other command is refused: `realm up` takes its workspace in its own arguments through realmCli.
export function realmCliWithWorkspace(
  inputs: LiveInputs,
  scenario: ScenarioEnvironment,
  args: readonly string[],
  workspace: string,
  timeoutMs: number,
): Promise<CommandResult> {
  if (args.length !== 1 || (args[0] !== "status" && args[0] !== "down")) {
    throw new Error("realmCliWithWorkspace runs only realm status or realm down");
  }
  return realmCli(inputs, scenario, [...args, "--workspace", workspace], timeoutMs);
}

// The bound for one openshell CLI call or probe.
export const PROBE_TIMEOUT_MS = 60_000;

// Runs one workload in the sandbox of the project whose session id is sessionId, through the pinned exec form: openshell sandbox
// exec --name <sandbox> --workdir /workspace --no-tty --no-login-shell -- <argv>. buildExecArgv owns that form, so the probes use
// the realm's own argv. The workload is an argv array; no probe interpolates a string into a shell.
export function sandboxExec(inputs: LiveInputs, sessionId: string, workload: readonly string[], timeoutMs: number = PROBE_TIMEOUT_MS): Promise<CommandResult> {
  const argv = buildExecArgv(sessionId, workload);
  return runCommand(OPENSHELL_BINARY, argv.slice(1), { env: inputs.hostEnvironment, timeoutMs, cwd: tmpdir() });
}

// Runs the openshell CLI with the host environment (upload, download, list).
export function openshellCli(inputs: LiveInputs, args: readonly string[], cwd: string, timeoutMs: number = PROBE_TIMEOUT_MS): Promise<CommandResult> {
  return runCommand(OPENSHELL_BINARY, args, { env: inputs.hostEnvironment, timeoutMs, cwd });
}

// A fixed node script that opens one TCP connection and prints "ok" or "error <code>". Arguments: host, port, family.
const CONNECT_SCRIPT =
  'const net = require("node:net");' +
  "const [host, port, family] = process.argv.slice(1);" +
  "const socket = net.connect({ host, port: Number(port), family: Number(family), timeout: 10000 });" +
  'socket.once("connect", () => { console.log("ok"); socket.destroy(); });' +
  'socket.once("timeout", () => { console.log("error TIMEOUT"); socket.destroy(); });' +
  'socket.once("error", (error) => { console.log("error " + error.code); });';

// A fixed node script for one DNS query. Arguments: the query kind (resolve4, resolve6 or resolveTxt) and the name. It
// prints "ok <JSON answer>" or "error <code>".
const RESOLVE_SCRIPT =
  'const dns = require("node:dns").promises;' +
  "const [kind, name] = process.argv.slice(1);" +
  "const queries = { resolve4: () => dns.resolve4(name), resolve6: () => dns.resolve6(name), resolveTxt: () => dns.resolveTxt(name) };" +
  'queries[kind]().then((answer) => { console.log("ok " + JSON.stringify(answer)); }, (error) => { console.log("error " + error.code); });';

// The workload argv for a node TCP connection probe. Egress is granted to the node binary, so the probes run through node.
export function nodeConnectArgv(host: string, port: number, family: 4 | 6): readonly string[] {
  return ["node", "-e", CONNECT_SCRIPT, host, String(port), String(family)];
}

export function nodeResolveArgv(kind: "resolve4" | "resolve6" | "resolveTxt", name: string): readonly string[] {
  return ["node", "-e", RESOLVE_SCRIPT, kind, name];
}

// A fixed node script that SIGKILLs every process in the sandbox whose command line names agentos-runner.js (the AgentOS runner,
// started as `node <runner path>`), found by scanning /proc, and prints "ok <count>" or "error NO_RUNNER". The runner and the exec
// run as the same uid, so the signal is permitted; pkill is not relied on. The script's own process is skipped.
const KILL_RUNNER_SCRIPT =
  'const fs = require("node:fs");' +
  "let killed = 0;" +
  'for (const entry of fs.readdirSync("/proc")) {' +
  "  if (!/^[0-9]+$/.test(entry) || Number(entry) === process.pid) continue;" +
  "  let cmdline;" +
  '  try { cmdline = fs.readFileSync("/proc/" + entry + "/cmdline", "utf8"); }' +
  '  catch (error) { if (error.code === "ENOENT" || error.code === "ESRCH" || error.code === "EACCES") continue; throw error; }' +
  '  if (cmdline.split("\\0").some((arg) => arg.endsWith("agentos-runner.js"))) { process.kill(Number(entry), "SIGKILL"); killed += 1; }' +
  "}" +
  'console.log(killed > 0 ? "ok " + killed : "error NO_RUNNER");';

// The workload argv that kills the AgentOS runner inside the sandbox.
export const KILL_RUNNER_ARGV: readonly string[] = ["node", "-e", KILL_RUNNER_SCRIPT];

// ---- Residue ------------------------------------------------------------------------------------------------------------

export type Listing = { readonly ok: true; readonly items: readonly string[] } | { readonly ok: false; readonly detail: string };

function lines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

// Every container id the realm account's rootless Podman holds, stopped ones included. Only ids are read, never a command line
// or an environment.
export async function listContainers(inputs: LiveInputs): Promise<Listing> {
  const result = await runCommand("podman", ["ps", "-a", "--format", "{{.ID}}"], { env: inputs.hostEnvironment, timeoutMs: 30_000, cwd: tmpdir() });
  if (result.exitCode !== 0) {
    return { ok: false, detail: `podman ps failed (${describeResult(result)})` };
  }
  return { ok: true, items: lines(result.stdout) };
}

// The OpenShell sandboxes whose name starts with realm-.
export async function listRealmSandboxes(inputs: LiveInputs): Promise<Listing> {
  const result = await openshellCli(inputs, ["sandbox", "list", "--names"], tmpdir(), 30_000);
  if (result.exitCode !== 0) {
    return { ok: false, detail: `openshell sandbox list failed (${describeResult(result)})` };
  }
  return { ok: true, items: lines(result.stdout).filter((name) => name.startsWith(REALM_SANDBOX_NAME_PREFIX)) };
}

// What a finished scenario left behind, for each sandbox named in sandboxNames. Empty means clean: zero containers and zero
// sandboxes of those names, no directory of those names under the secret or sandbox-state root, and an empty pinned workspace.
// A listing that fails is a problem, never "clean".
export async function residueProblems(inputs: LiveInputs, sandboxNames: readonly string[]): Promise<readonly string[]> {
  const problems: string[] = [];
  for (const sandboxName of sandboxNames) {
    const containers = await listSandboxContainers(inputs, sandboxName);
    if (!containers.ok) {
      problems.push(containers.detail);
    } else if (containers.items.length > 0) {
      problems.push(`${String(containers.items.length)} container(s) remain for ${sandboxName}`);
    }
    const sandboxes = await listSandboxesNamed(inputs, sandboxName);
    if (!sandboxes.ok) {
      problems.push(sandboxes.detail);
    } else if (sandboxes.items.length > 0) {
      problems.push(`sandbox ${sandboxName} remains`);
    }
    for (const [label, root] of [
      ["secret root", inputs.secretRoot],
      ["sandbox state root", inputs.stateRoot],
    ] as const) {
      if (existsSync(join(root, sandboxName))) {
        problems.push(`the ${label} still holds ${sandboxName}`);
      }
    }
  }
  try {
    const entries = readdirSync(inputs.workspaceRoot);
    if (entries.length > 0) {
      problems.push(`the pinned workspace holds ${String(entries.length)} entr${entries.length === 1 ? "y" : "ies"}: ${entries.join(", ")}`);
    }
  } catch {
    problems.push("the pinned workspace cannot be read");
  }
  return problems;
}

// The bound on waiting for a down to finish its teardown.
export const RESIDUE_TIMEOUT_MS = 90_000;
const RESIDUE_INTERVAL_MS = 2_000;

// Polls until residueProblems is empty, bounded at timeoutMs (RESIDUE_TIMEOUT_MS unless the caller needs longer).
export function waitForNoResidue(inputs: LiveInputs, sandboxNames: readonly string[], timeoutMs: number = RESIDUE_TIMEOUT_MS): Promise<PollOutcome> {
  return pollUntil(
    async () => {
      const problems = await residueProblems(inputs, sandboxNames);
      return problems.length === 0 ? { done: true } : { done: false, detail: problems.join("; ") };
    },
    { timeoutMs, intervalMs: RESIDUE_INTERVAL_MS },
  );
}

// Polls until the account's Podman holds no container, bounded at RESIDUE_TIMEOUT_MS.
export function waitForNoContainers(inputs: LiveInputs): Promise<PollOutcome> {
  return pollUntil(
    async () => {
      const containers = await listContainers(inputs);
      if (!containers.ok) {
        return { done: false, detail: containers.detail };
      }
      return containers.items.length === 0 ? { done: true } : { done: false, detail: `${String(containers.items.length)} container(s) remain` };
    },
    { timeoutMs: RESIDUE_TIMEOUT_MS, intervalMs: RESIDUE_INTERVAL_MS },
  );
}

// The scenario's cleanup: realm down (its result is the scenario's own concern, so it is not judged here), removal of the
// named files the scenario may have left in the pinned workspace, removal of the scenario's temporary directory, then the
// residue wait. Only the listed names are removed from the pinned root, and each must be a plain file name.
export async function cleanupScenario(
  inputs: LiveInputs,
  scenario: ScenarioEnvironment,
  workspaceFiles: readonly string[],
): Promise<PollOutcome> {
  await realmCliWithWorkspace(inputs, scenario, ["down"], inputs.workspaceRoot, 120_000);
  restoreSharedPolicy(scenario);
  removeSharedStateCreatedBy(scenario);
  for (const name of workspaceFiles) {
    if (name === "" || name.includes("/") || name === "." || name === "..") {
      throw new Error("a workspace cleanup name must be a plain file name");
    }
    rmSync(join(inputs.workspaceRoot, name), { force: true });
  }
  rmSync(scenario.root, { recursive: true, force: true });
  return waitForNoResidue(inputs, [sandboxNameFor(inputs.workspaceRoot)]);
}

// ---- Crash recovery -----------------------------------------------------------------------------------------------------

// The pids of the daemons in `ps -o pid=,args=` output: the lines whose whole command is `<executable> <daemonEntry>`. That is
// the exact argv spawnDetachedDaemon gives the daemon (src/cli/main.ts: process.execPath, then the entry path, no other
// argument). A line that runs the CLI, `grep <entry>`, `ps`, or a path that merely starts or ends with the entry path is not a
// match, and neither is a line without a numeric pid.
export function parseDaemonPids(psOutput: string, daemonEntry: string, executable: string): readonly number[] {
  const expected = `${executable} ${daemonEntry}`;
  const pids: number[] = [];
  for (const line of psOutput.split(/\r?\n/)) {
    const match = /^\s*([1-9]\d{0,9})\s+(.*?)\s*$/.exec(line);
    const pid = match?.[1];
    const args = match?.[2];
    if (pid !== undefined && args === expected) {
      pids.push(Number(pid));
    }
  }
  return pids;
}

export type PidListing = { readonly ok: true; readonly pids: readonly number[] } | { readonly ok: false; readonly detail: string };

// The daemons the current uid runs from daemonEntry, read with `ps -u <uid> -ww -o pid=,args=` (argv form, no shell; -ww keeps
// a long path from being cut). The executable is the test's own node binary: realmCli runs the CLI on it and the CLI spawns the
// daemon on its own process.execPath, which is the same binary.
export async function findDaemonPids(inputs: LiveInputs, daemonEntry: string): Promise<PidListing> {
  const uid = process.getuid?.();
  if (uid === undefined) {
    return { ok: false, detail: "the current uid is not available on this platform" };
  }
  const result = await runCommand("ps", ["-u", String(uid), "-ww", "-o", "pid=,args="], { env: inputs.hostEnvironment, timeoutMs: 30_000, cwd: tmpdir() });
  if (result.exitCode !== 0) {
    return { ok: false, detail: `ps failed (${describeResult(result)})` };
  }
  return { ok: true, pids: parseDaemonPids(result.stdout, daemonEntry, process.execPath) };
}

export interface ListeningSockets {
  readonly tcp: readonly string[];
  readonly udp: readonly string[];
  readonly unix: readonly string[];
}

// Rows in /proc/net whose inode is one of this process's socket fds. /proc/net is the network namespace, so it includes every
// process; the inode filter keeps only the pid's own listeners.
export function parseListeningSockets(
  inodes: ReadonlySet<string>,
  tables: { readonly tcp: string; readonly tcp6: string; readonly udp: string; readonly udp6: string; readonly unix: string },
): ListeningSockets {
  const tcp: string[] = [];
  const udp: string[] = [];
  for (const name of ["tcp", "tcp6", "udp", "udp6"] as const) {
    const text = tables[name];
    for (const line of text.split("\n").slice(1)) {
      const parts = line.trim().split(/\s+/);
      const local = parts[1];
      const state = parts[3];
      const inode = parts[9];
      if (local === undefined || state === undefined || inode === undefined || !inodes.has(inode)) {
        continue;
      }
      if (name.startsWith("udp")) {
        udp.push(`${name} ${local}`);
      } else if (state === "0A") {
        tcp.push(`${name} ${local}`);
      }
    }
  }
  const unix: string[] = [];
  // Flags is hexadecimal; __SO_ACCEPTCON (0x10000) marks a listening socket. An accepted connection keeps the listener's
  // path but does not carry the flag, so it is not a listener.
  const SO_ACCEPTCON = 0x10000;
  for (const line of tables.unix.split("\n").slice(1)) {
    const parts = line.trim().split(/\s+/);
    const inode = parts[6];
    const flags = Number.parseInt(parts[3] ?? "", 16);
    // Path is every field from the seventh on: a path that contains a space is one field per word.
    const path = parts.slice(7).join(" ");
    const listening = Number.isInteger(flags) && (flags & SO_ACCEPTCON) !== 0;
    if (inode !== undefined && inodes.has(inode) && listening && (path.startsWith("/") || path.startsWith("@"))) {
      unix.push(path);
    }
  }
  return { tcp: tcp.sort(), udp: udp.sort(), unix: unix.sort() };
}

function socketInodesOf(pid: number): Set<string> {
  const inodes = new Set<string>();
  let names: string[];
  try {
    names = readdirSync(`/proc/${String(pid)}/fd`);
  } catch (error: unknown) {
    throw new Error(`cannot list the fds of pid ${String(pid)}`, { cause: error });
  }
  for (const name of names) {
    let link: string;
    try {
      link = readlinkSync(`/proc/${String(pid)}/fd/${name}`);
    } catch (error: unknown) {
      // An fd closed between the listing and the read is not a socket any more. Any other failure is not skipped.
      if (error instanceof Error && "code" in error && (error as { code?: unknown }).code === "ENOENT") {
        continue;
      }
      throw new Error(`cannot read fd ${name} of pid ${String(pid)}`, { cause: error });
    }
    const match = /^socket:\[(\d+)\]$/.exec(link);
    if (match?.[1] !== undefined) {
      inodes.add(match[1]);
    }
  }
  return inodes;
}

// Reads one /proc/<pid>/net table. A missing IPv6 table means the kernel has no IPv6 (the only case a missing file is
// expected); any other read failure throws, so a listener check never passes on a table it could not read.
function procNet(pid: number, name: string): string {
  try {
    return readFileSync(`/proc/${String(pid)}/net/${name}`, "utf8");
  } catch (error: unknown) {
    const code = error instanceof Error && "code" in error ? String((error as { code?: unknown }).code) : "";
    if (code === "ENOENT" && name.endsWith("6")) {
      return "";
    }
    throw new Error(`cannot read /proc/<pid>/net/${name}`, { cause: error });
  }
}

export function listeningSocketsOf(pid: number): ListeningSockets {
  return parseListeningSockets(socketInodesOf(pid), {
    tcp: procNet(pid, "tcp"),
    tcp6: procNet(pid, "tcp6"),
    udp: procNet(pid, "udp"),
    udp6: procNet(pid, "udp6"),
    unix: procNet(pid, "unix"),
  });
}

// The container ids that carry the sandbox-name label of sandboxName, stopped ones included.
export async function listSandboxContainers(inputs: LiveInputs, sandboxName: string): Promise<Listing> {
  const label = `label=${OPENSHELL_SANDBOX_NAME_LABEL_KEY}=${sandboxName}`;
  const result = await runCommand("podman", ["ps", "-a", "--filter", label, "--format", "{{.ID}}"], { env: inputs.hostEnvironment, timeoutMs: 30_000, cwd: tmpdir() });
  if (result.exitCode !== 0) {
    return { ok: false, detail: `podman ps failed (${describeResult(result)})` };
  }
  return { ok: true, items: lines(result.stdout) };
}

// The OpenShell sandboxes named exactly sandboxName.
export async function listSandboxesNamed(inputs: LiveInputs, sandboxName: string): Promise<Listing> {
  const listed = await listRealmSandboxes(inputs);
  return listed.ok ? { ok: true, items: listed.items.filter((name) => name === sandboxName) } : listed;
}

// Polls `realm status` until it reports active, bounded at timeoutMs. The detail of a failed poll is the last status output.
export function waitForActive(inputs: LiveInputs, scenario: ScenarioEnvironment, timeoutMs: number): Promise<PollOutcome> {
  return pollUntil(
    async () => {
      const status = await realmCliWithWorkspace(inputs, scenario, ["status"], inputs.workspaceRoot, 30_000);
      const state = status.exitCode === 0 ? stateOfStatus(status.stdout) : undefined;
      return state === "active" ? { done: true } : { done: false, detail: `realm status: ${describeResult(status)}` };
    },
    { timeoutMs, intervalMs: 2_000 },
  );
}

// ---- MCP over stdio -----------------------------------------------------------------------------------------------------

// Splits buffered MCP output into its complete lines and the partial tail. A line ends at "\n" (a trailing "\r" is dropped), and
// a blank line is dropped, as the server's own reader does (src/mcp/server.ts: readline, then `line.trim() === ""`). The tail
// is whatever follows the last "\n": the start of a message whose end has not arrived. Feed it back in front of the next chunk.
export function splitJsonRpcLines(buffered: string): { readonly lines: readonly string[]; readonly rest: string } {
  const parts = buffered.split("\n");
  const rest = parts.pop() ?? "";
  const complete = parts.map((part) => (part.endsWith("\r") ? part.slice(0, -1) : part)).filter((part) => part.trim() !== "");
  return { lines: complete, rest };
}

// What one JSON-RPC response says. malformed is a response with the right id that carries neither result nor error.
export type RpcReply =
  | { readonly kind: "result"; readonly result: unknown }
  | { readonly kind: "error"; readonly code: number | undefined; readonly message: string }
  | { readonly kind: "malformed" };

function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// The response to request id among the received lines, or undefined while it has not arrived. Lines that are not JSON objects,
// requests and notifications (they carry a method), and responses to other ids are skipped, so replies in any order and
// interleaved notifications do not matter. The first response with the id wins.
export function findRpcReply(receivedLines: readonly string[], id: number | string): RpcReply | undefined {
  for (const line of receivedLines) {
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isObject(message) || Reflect.get(message, "id") !== id || Reflect.has(message, "method")) {
      continue;
    }
    const error: unknown = Reflect.get(message, "error");
    if (isObject(error)) {
      const code: unknown = Reflect.get(error, "code");
      const text: unknown = Reflect.get(error, "message");
      return { kind: "error", code: typeof code === "number" ? code : undefined, message: typeof text === "string" ? text : "" };
    }
    if (Reflect.has(message, "result")) {
      return { kind: "result", result: Reflect.get(message, "result") };
    }
    return { kind: "malformed" };
  }
  return undefined;
}

// One value for an assertion message: its JSON, clipped. Never used on a value that could hold a secret.
export function describeValue(value: unknown): string {
  const json: unknown = JSON.stringify(value);
  return clip(typeof json === "string" ? json : String(value));
}

// The text of a read result's `content`. The handler returns a Buffer, and JSON turns a Buffer into
// {"type":"Buffer","data":[bytes]}; a plain byte array, an index-keyed object (a Uint8Array through JSON) and a string are
// accepted as well. Undefined for anything else, or for a byte list that holds a non-byte.
export function decodeReadContent(content: unknown): string | undefined {
  if (typeof content === "string") {
    return content;
  }
  let bytes: unknown = content;
  if (isObject(content) && Reflect.get(content, "type") === "Buffer") {
    bytes = Reflect.get(content, "data");
  } else if (isObject(content)) {
    const keys = Object.keys(content);
    if (keys.some((key, index) => key !== String(index))) {
      return undefined;
    }
    bytes = keys.map((key): unknown => Reflect.get(content, key));
  }
  const isByte = (byte: unknown): byte is number => typeof byte === "number" && Number.isInteger(byte) && byte >= 0 && byte <= 255;
  if (!Array.isArray(bytes) || !bytes.every(isByte)) {
    return undefined;
  }
  return Buffer.from(bytes).toString("utf8");
}

// The most stderr text one MCP child may keep.
const MCP_STDERR_LIMIT = 64 * 1024;

export interface McpExit {
  readonly code: number | null;
  readonly signal: string | null;
}

// One `realm mcp` child and the JSON-RPC conversation with it. stdout carries only MCP messages and diagnostics go to stderr
// (src/cli/main.ts runMcp), so stderr is kept, bounded, for failure messages.
export interface McpSession {
  // Sends one request and resolves with its result. Rejects when the JSON-RPC response is an error, when the child ends first,
  // or when no response arrives within timeoutMs.
  request(method: string, params: unknown, timeoutMs: number): Promise<unknown>;
  // Sends a message with no id: the server takes it and sends no reply.
  notify(method: string, params?: unknown): void;
  // Ends the child's stdin, which ends the MCP session.
  closeInput(): void;
  // Resolves with how the child ended, or undefined when it is still running after timeoutMs.
  waitForExit(timeoutMs: number): Promise<McpExit | undefined>;
  // Stops the child if it is still running.
  kill(): void;
  // The clipped stderr text, as one JSON string.
  stderr(): string;
}

// Starts `realm mcp --workspace <pinned root>` on the current node binary with the scenario's explicit environment and stdio
// pipes. Nothing is written until the first request.
export function startMcpSession(inputs: LiveInputs, scenario: ScenarioEnvironment): McpSession {
  const child = spawn(process.execPath, [inputs.cliPath, "mcp", "--workspace", inputs.workspaceRoot], {
    env: { ...scenario.cliEnvironment },
    cwd: scenario.root,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const received: string[] = [];
  const waiters = new Set<() => void>();
  let partial = "";
  let stderrText = "";
  let exit: McpExit | undefined;
  let failure: string | undefined;
  let nextId = 0;
  const wakeWaiters = (): void => {
    for (const waiter of [...waiters]) {
      waiter();
    }
  };
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    const split = splitJsonRpcLines(partial + chunk);
    partial = split.rest;
    received.push(...split.lines);
    wakeWaiters();
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    if (stderrText.length < MCP_STDERR_LIMIT) {
      stderrText += chunk;
    }
  });
  child.stdin.on("error", (error: NodeJS.ErrnoException) => {
    failure = `stdin ${error.code ?? "failed"}`;
    wakeWaiters();
  });
  child.once("error", (error: NodeJS.ErrnoException) => {
    failure = `spawn ${error.code ?? "failed"}`;
    wakeWaiters();
  });
  child.once("close", (code, signal) => {
    exit = { code, signal };
    wakeWaiters();
  });

  // Resolves with the first value probe returns, checked now and on every change of the child's output or state; undefined at
  // timeoutMs.
  const waitFor = <T>(probe: () => T | undefined, timeoutMs: number): Promise<T | undefined> =>
    new Promise((resolve) => {
      const timer = setTimeout(() => {
        waiters.delete(check);
        resolve(undefined);
      }, timeoutMs);
      const check = (): void => {
        const found = probe();
        if (found !== undefined) {
          clearTimeout(timer);
          waiters.delete(check);
          resolve(found);
        }
      };
      waiters.add(check);
      check();
    });

  const describeEnd = (): string => {
    if (exit !== undefined) {
      return exit.signal === null ? `exit ${String(exit.code)}` : `signal ${exit.signal}`;
    }
    return failure ?? "still running";
  };
  const send = (message: Record<string, unknown>): void => {
    child.stdin.write(`${JSON.stringify(message)}\n`);
  };

  return {
    async request(method, params, timeoutMs) {
      nextId += 1;
      const id = nextId;
      send({ jsonrpc: "2.0", id, method, params });
      const outcome = await waitFor<RpcReply | "ended">(() => findRpcReply(received, id) ?? (exit !== undefined || failure !== undefined ? "ended" : undefined), timeoutMs);
      if (outcome === undefined) {
        throw new Error(`MCP ${method}: no response within ${String(timeoutMs / 1000)} s; stderr ${clip(stderrText)}`);
      }
      if (outcome === "ended") {
        throw new Error(`MCP ${method}: realm mcp ended before it answered (${describeEnd()}); stderr ${clip(stderrText)}`);
      }
      if (outcome.kind === "error") {
        throw new Error(`MCP ${method}: JSON-RPC error ${outcome.code === undefined ? "(no code)" : String(outcome.code)}: ${JSON.stringify(outcome.message)}`);
      }
      if (outcome.kind === "malformed") {
        throw new Error(`MCP ${method}: the response carries neither result nor error`);
      }
      return outcome.result;
    },
    notify(method, params) {
      send({ jsonrpc: "2.0", method, ...(params === undefined ? {} : { params }) });
    },
    closeInput() {
      child.stdin.end();
    },
    async waitForExit(timeoutMs) {
      return waitFor<McpExit>(() => exit, timeoutMs);
    },
    kill() {
      if (exit === undefined) {
        child.kill("SIGKILL");
      }
    },
    stderr() {
      return clip(stderrText);
    },
  };
}

// ---- MCP client helpers -------------------------------------------------------------------------------------------------
// The MCP calls the live suites make against `realm mcp`. A tool result is checked before its value is returned.

// The legacy revision a realm mcp session handshakes with (src/mcp/protocol.ts), the one Claude Code uses.
export const MCP_LEGACY_REVISION = "2025-11-25";
// The bound on every MCP response. The first one, the answer to initialize, is the exception: realm mcp claims the workspace
// before it reads any input (src/cli/main.ts runMcp: ensure the daemon, then up, then serve), so that answer waits for the
// attach, which has its own 60 s control bound after the daemon start. A hung server fails the test with a clear message, unless
// the 5 minute scenario timeout fires first: the sum of the bounds can exceed it.
export const MCP_RESPONSE_TIMEOUT_MS = 60_000;
export const MCP_FIRST_RESPONSE_TIMEOUT_MS = 150_000;

// The value under key of a JSON object, or undefined for anything else.
export function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;
}

// One tools/call. The result is an MCP tool result: structuredContent is the dispatcher outcome unchanged ({outcome: "done", tool,
// value} for a tool that ran) and content carries the same JSON as a text block, which is what a host shows to the model. A refusal
// or a RealmError comes back as a tool error (isError, structuredContent with the catalogue code), because the daemon client throws
// the refusal's code. Both fail the scenario with that code.
export async function callTool(session: McpSession, tool: string, args: Readonly<Record<string, unknown>>): Promise<unknown> {
  const result = await session.request("tools/call", { name: tool, arguments: args }, MCP_RESPONSE_TIMEOUT_MS);
  const outcome = field(result, "structuredContent");
  if (field(result, "isError") === true) {
    assert.fail(`tools/call ${tool} returned a tool error: ${describeValue(outcome)}; realm mcp stderr ${session.stderr()}`);
  }
  assert.equal(field(outcome, "outcome"), "done", `tools/call ${tool}: ${describeValue(result)}; realm mcp stderr ${session.stderr()}`);
  assert.equal(field(outcome, "tool"), tool, `tools/call ${tool}: the outcome names another tool: ${describeValue(result)}`);
  const blocks = field(result, "content");
  const first: unknown = Array.isArray(blocks) ? (blocks as unknown[])[0] : undefined;
  assert.equal(field(first, "type"), "text", `tools/call ${tool}: the result needs a text content block for the model: ${describeValue(result)}`);
  return field(outcome, "value");
}

// The initialize handshake of a realm mcp session with the legacy revision.
export async function initializeMcp(session: McpSession): Promise<void> {
  const initialized = await session.request(
    "initialize",
    { protocolVersion: MCP_LEGACY_REVISION, capabilities: {}, clientInfo: { name: "realm-live-suite", version: "0" } },
    MCP_FIRST_RESPONSE_TIMEOUT_MS,
  );
  assert.equal(field(initialized, "protocolVersion"), MCP_LEGACY_REVISION, `initialize: ${describeValue(initialized)}`);
  session.notify("notifications/initialized");
}

// ---- Log files ----------------------------------------------------------------------------------------------------------------

// The lines of a log file in file order, without their line ends. A final line end adds no empty line, but an empty line inside
// the file stays, so a check that every line parses sees it. An absent file has no lines.
function linesOfFile(path: string): readonly string[] {
  if (!existsSync(path)) {
    return [];
  }
  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  if (lines.at(-1) === "") {
    lines.pop();
  }
  return lines;
}

// The lines of <stateDir>/requests.log (requestLogPath, src/daemon/ensure.ts), in file order. An absent file has no lines.
export function requestLogLinesOf(stateDir: string): readonly string[] {
  return linesOfFile(requestLogPath(stateDir));
}

// One line parsed as JSON. A line that does not parse is reported with the parser's reason, never dropped without one.
export type JsonLine = { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly reason: string };

export function parseJsonLine(line: string): JsonLine {
  try {
    return { ok: true, value: JSON.parse(line) };
  } catch (error: unknown) {
    return { ok: false, reason: error instanceof Error ? error.message : "the line is not JSON" };
  }
}

// The 1-based numbers of the lines that do not parse as JSON, in file order.
export function unparsedLinesOf(lines: readonly string[]): readonly number[] {
  const numbers: number[] = [];
  for (const [index, line] of lines.entries()) {
    if (!parseJsonLine(line).ok) {
      numbers.push(index + 1);
    }
  }
  return numbers;
}

// A parsed JSON object that can be a log or audit record: not null and not an array.
export type LogRecord = Readonly<Record<string, unknown>>;

function isLogRecord(value: unknown): value is LogRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// The records of an audit file (<stateDir>/audit/<session>.jsonl) whose correlationId equals correlationId, in file order.
// A line that is not a JSON object cannot carry the id, so it is not returned; `realm audit verify` judges those lines. An
// absent file has no records.
export function auditLinesWithCorrelation(auditFile: string, correlationId: string): readonly LogRecord[] {
  const matches: LogRecord[] = [];
  for (const line of linesOfFile(auditFile)) {
    const parsed = parseJsonLine(line);
    if (parsed.ok && isLogRecord(parsed.value) && field(parsed.value, "correlationId") === correlationId) {
      matches.push(parsed.value);
    }
  }
  return matches;
}

// ---- Adoption and scratch (phase 19, RES-05) ----------------------------------------------------------------------------------------

// One podman call with the account's environment. The exit code is the answer; a call that does not exit is a failed result.
export function podmanCli(inputs: LiveInputs, args: readonly string[]): Promise<CommandResult> {
  return runCommand("podman", [...args], { env: inputs.hostEnvironment, timeoutMs: 60_000, cwd: tmpdir() });
}

// Creates a container that is never started, named name and carrying labels, on the scenario's own image, so a test can plant a
// container the adoption must judge. The id is on stdout.
export function createUnstartedContainer(inputs: LiveInputs, name: string, labels: Readonly<Record<string, string>>): Promise<CommandResult> {
  const labelArgs = Object.entries(labels).flatMap(([key, value]) => ["--label", `${key}=${value}`]);
  return podmanCli(inputs, ["create", "--name", name, ...labelArgs, inputs.image, "sleep", "600"]);
}

// Whether a named volume exists: exit 0 is true, exit 1 is false, and any other result is undefined, which a caller reports as failed.
export async function volumeExists(inputs: LiveInputs, name: string): Promise<boolean | undefined> {
  const result = await podmanCli(inputs, ["volume", "exists", name]);
  if (result.exitCode === 0) {
    return true;
  }
  return result.exitCode === 1 ? false : undefined;
}

// The last daemon.startup record of a daemon log, parsed. Undefined when the log holds none.
export function startupRecordOf(log: string): LogRecord | undefined {
  let found: LogRecord | undefined;
  for (const line of log.split(/\r?\n/)) {
    const parsed = parseJsonLine(line);
    if (parsed.ok && isLogRecord(parsed.value) && field(parsed.value, "event") === "daemon.startup") {
      found = parsed.value;
    }
  }
  return found;
}

// The container ids a daemon.startup record names as removed. A missing or mistyped field reads as empty.
export function removedIdsOf(startup: LogRecord): readonly string[] {
  const ids = field(startup, "containerIds");
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
}

// The removals a daemon.startup record names with their causes: one "<containerId> <cause>" entry each. An entry of any other shape
// is skipped, and a missing or mistyped field reads as empty.
export function removedCausesOf(startup: LogRecord): readonly { readonly containerId: string; readonly cause: string }[] {
  const entries = field(startup, "removedCauses");
  if (!Array.isArray(entries)) {
    return [];
  }
  return entries.flatMap((entry: unknown): { readonly containerId: string; readonly cause: string }[] => {
    if (typeof entry !== "string") {
      return [];
    }
    const parts = entry.split(" ");
    const [containerId, cause] = parts;
    return parts.length === 2 && containerId !== undefined && cause !== undefined ? [{ containerId, cause }] : [];
  });
}

// The container ids a daemon.startup record names as adopted. A missing or mistyped field reads as empty.
export function adoptedIdsOf(startup: LogRecord): readonly string[] {
  const ids = field(startup, "adoptedContainerIds");
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
}

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

import { execFile, spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync, accessSync, constants, statSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { delimiter, isAbsolute, join } from "node:path";
import { performance } from "node:perf_hooks";
import type { EgressRule } from "../../src/contract/validate.js";
import { podmanSocketPath } from "../../src/runtime/host-paths.js";
import { loadRuntimeConfig, runtimeRootsOf } from "../../src/runtime/config.js";
import { buildExecArgv, OPENSHELL_BINARY, OPENSHELL_SANDBOX_NAME_LABEL_KEY, REALM_SANDBOX_NAME_PREFIX, realmSandboxName } from "../../src/runtime/openshell.js";
import { podmanSkipReason, type PodmanProbe } from "../../src/runtime/podman-version.js";
import { selectOpenShellEnvironment } from "../../src/runtime/session-execution.js";
import { controlSocketPath, type EnvironmentLike } from "../../src/session/paths.js";

// ---- Gate ---------------------------------------------------------------------------------------------------------------

export const LIVE_PRODUCTION_VARIABLE = "REALM_LIVE_PRODUCTION";
export const LIVE_IMAGE_VARIABLE = "REALM_LIVE_IMAGE";
export const LIVE_DRIVER_CONFIG_VARIABLE = "REALM_LIVE_DRIVER_CONFIG";

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
// prerequisite, in this order: the operator opt-in, Podman 5.x, the image, REALM_LIVE_DRIVER_CONFIG, the rootless socket, the
// openshell CLI and the built CLI. The opt-in is exactly "1": the test never sets it.
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

// The counts the startup-reap notice states: "<n> container(s), <m> session record(s)". Undefined when the text states neither.
export function reapCountsOfNotice(notice: string): { readonly containers: number; readonly sessionRecords: number } | undefined {
  const match = /(\d+) container\(s\), (\d+) session record\(s\)/.exec(notice);
  if (match === null) {
    return undefined;
  }
  return { containers: Number(match[1]), sessionRecords: Number(match[2]) };
}

// The daemon log line that reports the startup reap of exactly one container and names it. The id is matched by prefix: the
// list the suite takes before the kill prints Podman's short id, the daemon logs the full one. Undefined when no line matches.
export function startupReapLineFor(log: string, containerId: string): string | undefined {
  if (containerId === "") {
    return undefined;
  }
  return log.split(/\r?\n/).find((line) => line.startsWith("realm daemon: startup removed 1 container(s)") && line.includes(containerId));
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

// The daemon's session is "daemon", so its sandbox is realm-daemon, the only sandbox the suite creates.
export const DAEMON_SESSION_ID = "daemon";
export const DAEMON_SANDBOX_NAME = realmSandboxName(DAEMON_SESSION_ID);
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
  const roots = runtimeRootsOf(loadRuntimeConfig(JSON.parse(readFileSync(configPath, "utf8"))));
  return {
    image: required(LIVE_IMAGE_VARIABLE),
    stateRoot: roots.sandboxStateRoot,
    secretRoot: roots.secretRoot,
    workspaceRoot: roots.workspaceRoot,
    cliPath,
    hostEnvironment: selectOpenShellEnvironment(env),
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
  const stateDir = join(root, "s");
  mkdirSync(join(configHome, "realm"), { recursive: true });
  mkdirSync(stateDir, { mode: 0o700 });
  chmodSync(stateDir, 0o700);
  if (Buffer.byteLength(controlSocketPath(stateDir)) > SOCKET_PATH_LIMIT_BYTES) {
    throw new Error("the temporary state directory is too long for the control socket path; set TMPDIR to a shorter directory");
  }
  writeFileSync(
    join(configHome, "realm", "config.json"),
    `${JSON.stringify({ image: spec.image, stateDir, workspaceRoot: inputs.workspaceRoot, secretRoot: inputs.secretRoot, sandboxStateRoot: inputs.stateRoot })}\n`,
    { mode: 0o600 },
  );
  const egressAllow = spec.egressAllow ?? [];
  const policy = { workspaceRoots: [inputs.workspaceRoot], ...(egressAllow.length > 0 ? { egressAllow } : {}), ...spec.policyExtra };
  writeFileSync(join(stateDir, "policy.json"), `${JSON.stringify(policy)}\n`, { mode: 0o600 });
  return {
    root,
    stateDir,
    cliEnvironment: {
      ...inputs.hostEnvironment,
      XDG_CONFIG_HOME: configHome,
    },
  };
}

// Runs the built realm CLI through node, with the scenario's own environment.
export function realmCli(inputs: LiveInputs, scenario: ScenarioEnvironment, args: readonly string[], timeoutMs: number): Promise<CommandResult> {
  return runCommand(process.execPath, [inputs.cliPath, ...args], { env: scenario.cliEnvironment, timeoutMs, cwd: scenario.root });
}

// The bound for one openshell CLI call or probe.
export const PROBE_TIMEOUT_MS = 60_000;

// Runs one workload in realm-daemon through the pinned exec form: openshell sandbox exec --name realm-daemon --workdir
// /workspace --no-tty --no-login-shell -- <argv>. buildExecArgv owns that form, so the probes use the realm's own argv.
// The workload is an argv array; no probe interpolates a string into a shell.
export function sandboxExec(inputs: LiveInputs, workload: readonly string[], timeoutMs: number = PROBE_TIMEOUT_MS): Promise<CommandResult> {
  const argv = buildExecArgv(DAEMON_SESSION_ID, workload);
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

// What a finished scenario left behind. Empty means clean: zero containers, zero realm-* sandboxes, no realm-daemon directory
// under the secret or sandbox-state root, and an empty pinned workspace. A listing that fails is a problem, never "clean".
export async function residueProblems(inputs: LiveInputs): Promise<readonly string[]> {
  const problems: string[] = [];
  const containers = await listContainers(inputs);
  if (!containers.ok) {
    problems.push(containers.detail);
  } else if (containers.items.length > 0) {
    problems.push(`${String(containers.items.length)} container(s) remain`);
  }
  const sandboxes = await listRealmSandboxes(inputs);
  if (!sandboxes.ok) {
    problems.push(sandboxes.detail);
  } else if (sandboxes.items.length > 0) {
    problems.push(`sandbox(es) remain: ${sandboxes.items.join(", ")}`);
  }
  for (const [label, root] of [
    ["secret root", inputs.secretRoot],
    ["sandbox state root", inputs.stateRoot],
  ] as const) {
    if (existsSync(join(root, DAEMON_SANDBOX_NAME))) {
      problems.push(`the ${label} still holds ${DAEMON_SANDBOX_NAME}`);
    }
  }
  try {
    const entries = readdirSync(inputs.workspaceRoot);
    if (entries.length > 0) {
      problems.push(`the pinned workspace holds ${String(entries.length)} entr${entries.length === 1 ? "y" : "ies"}`);
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
export function waitForNoResidue(inputs: LiveInputs, timeoutMs: number = RESIDUE_TIMEOUT_MS): Promise<PollOutcome> {
  return pollUntil(
    async () => {
      const problems = await residueProblems(inputs);
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
  await realmCli(inputs, scenario, ["down"], 120_000);
  for (const name of workspaceFiles) {
    if (name === "" || name.includes("/") || name === "." || name === "..") {
      throw new Error("a workspace cleanup name must be a plain file name");
    }
    rmSync(join(inputs.workspaceRoot, name), { force: true });
  }
  rmSync(scenario.root, { recursive: true, force: true });
  return waitForNoResidue(inputs);
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

// The container ids that carry the realm-daemon sandbox-name label, stopped ones included.
export async function listDaemonContainers(inputs: LiveInputs): Promise<Listing> {
  const label = `label=${OPENSHELL_SANDBOX_NAME_LABEL_KEY}=${DAEMON_SANDBOX_NAME}`;
  const result = await runCommand("podman", ["ps", "-a", "--filter", label, "--format", "{{.ID}}"], { env: inputs.hostEnvironment, timeoutMs: 30_000, cwd: tmpdir() });
  if (result.exitCode !== 0) {
    return { ok: false, detail: `podman ps failed (${describeResult(result)})` };
  }
  return { ok: true, items: lines(result.stdout) };
}

// The OpenShell sandboxes named exactly realm-daemon.
export async function listDaemonSandboxes(inputs: LiveInputs): Promise<Listing> {
  const listed = await listRealmSandboxes(inputs);
  return listed.ok ? { ok: true, items: listed.items.filter((name) => name === DAEMON_SANDBOX_NAME) } : listed;
}

// Polls `realm status` until it reports active, bounded at timeoutMs. The detail of a failed poll is the last status output.
export function waitForActive(inputs: LiveInputs, scenario: ScenarioEnvironment, timeoutMs: number): Promise<PollOutcome> {
  return pollUntil(
    async () => {
      const status = await realmCli(inputs, scenario, ["status"], 30_000);
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

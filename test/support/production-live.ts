// Helpers for the gated production live suite (PRD-TST-02, PRD-TST-03). The pure pieces (probe output parsing, the polling
// helper, the benchmark-range check and the skip-reason selection) are covered by the hermetic file
// test/integration/production-live-helpers.test.ts, which always runs. The rest drives the real stack: it builds an isolated
// realm configuration per scenario, runs the built CLI and the openshell CLI, and checks that a scenario left nothing behind.
//
// Nothing here reads the process environment or touches the host at import time: every function takes what it needs as a
// parameter, so the hermetic file can import this module on any host.
//
// Nothing here prints a secret. A failure message carries exit codes, error codes, names and clipped probe output only.

import { execFile } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync, accessSync, constants, statSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { delimiter, isAbsolute, join } from "node:path";
import { performance } from "node:perf_hooks";
import type { EgressRule } from "../../src/contract/validate.js";
import { podmanSocketPath } from "../../src/runtime/host-paths.js";
import { buildExecArgv, OPENSHELL_BINARY, REALM_SANDBOX_NAME_PREFIX, realmSandboxName } from "../../src/runtime/openshell.js";
import { podmanSkipReason, type PodmanProbe } from "../../src/runtime/podman-version.js";
import { selectOpenShellEnvironment } from "../../src/runtime/session-execution.js";
import { controlSocketPath, type EnvironmentLike } from "../../src/session/paths.js";

// ---- Gate ---------------------------------------------------------------------------------------------------------------

export const LIVE_PRODUCTION_VARIABLE = "REALM_LIVE_PRODUCTION";
export const LIVE_IMAGE_VARIABLE = "REALM_LIVE_IMAGE";
export const DRIVER_STATE_ROOT_VARIABLE = "REALM_DRIVER_STATE_ROOT";
export const DRIVER_SECRET_ROOT_VARIABLE = "REALM_DRIVER_SECRET_ROOT";
export const DRIVER_WORKSPACE_ROOT_VARIABLE = "REALM_DRIVER_WORKSPACE_ROOT";
// The three roots in the order the gate checks them.
const DRIVER_ROOT_VARIABLES: readonly string[] = [
  DRIVER_STATE_ROOT_VARIABLE,
  DRIVER_SECRET_ROOT_VARIABLE,
  DRIVER_WORKSPACE_ROOT_VARIABLE,
];

// The host facts the gate decides from. Each is injected, so the hermetic file can cover every branch.
export interface ProductionGateInputs {
  readonly env: EnvironmentLike;
  readonly podman: PodmanProbe;
  readonly isSocket: (path: string) => boolean;
  readonly onPath: (name: string) => boolean;
  readonly exists: (path: string) => boolean;
  readonly isDirectory: (path: string) => boolean;
  // The built CLI beside the compiled tests (dist/src/cli/main.js).
  readonly cliPath: string;
}

// The reason the production live suite cannot run, or false when every prerequisite holds. The reason names the FIRST missing
// prerequisite, in this order: the operator opt-in, Podman 5.x, the image, the three driver roots, the rootless socket, the
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
  for (const name of DRIVER_ROOT_VARIABLES) {
    const value = env[name];
    if (value === undefined || !isAbsolute(value) || !inputs.isDirectory(value)) {
      return `${name} is not an absolute path to an existing directory; it must equal the root the running driver was given`;
    }
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
  return {
    image: required(LIVE_IMAGE_VARIABLE),
    stateRoot: required(DRIVER_STATE_ROOT_VARIABLE),
    secretRoot: required(DRIVER_SECRET_ROOT_VARIABLE),
    workspaceRoot: required(DRIVER_WORKSPACE_ROOT_VARIABLE),
    cliPath,
    hostEnvironment: selectOpenShellEnvironment(env),
  };
}

// The image the wrong-digest scenario configures: a well-formed pin that no registry or local store holds.
export const UNKNOWN_DIGEST_IMAGE = `localhost/realm-agentos@sha256:${"0".repeat(64)}`;

export interface ScenarioSpec {
  readonly image: string;
  // Rendered into policy.json; omitted when empty, which leaves the deny-all default.
  readonly egressAllow?: readonly EgressRule[];
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
    `${JSON.stringify({ image: spec.image, stateDir, workspaceRoot: inputs.workspaceRoot })}\n`,
    { mode: 0o600 },
  );
  const egressAllow = spec.egressAllow ?? [];
  const policy = { workspaceRoots: [inputs.workspaceRoot], ...(egressAllow.length > 0 ? { egressAllow } : {}) };
  writeFileSync(join(stateDir, "policy.json"), `${JSON.stringify(policy)}\n`, { mode: 0o600 });
  return {
    root,
    stateDir,
    cliEnvironment: {
      ...inputs.hostEnvironment,
      XDG_CONFIG_HOME: configHome,
      [DRIVER_STATE_ROOT_VARIABLE]: inputs.stateRoot,
      [DRIVER_SECRET_ROOT_VARIABLE]: inputs.secretRoot,
      [DRIVER_WORKSPACE_ROOT_VARIABLE]: inputs.workspaceRoot,
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

// Polls until residueProblems is empty, bounded at RESIDUE_TIMEOUT_MS.
export function waitForNoResidue(inputs: LiveInputs): Promise<PollOutcome> {
  return pollUntil(
    async () => {
      const problems = await residueProblems(inputs);
      return problems.length === 0 ? { done: true } : { done: false, detail: problems.join("; ") };
    },
    { timeoutMs: RESIDUE_TIMEOUT_MS, intervalMs: RESIDUE_INTERVAL_MS },
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

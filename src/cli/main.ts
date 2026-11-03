#!/usr/bin/env node
// Realm CLI (CLI-01, CLI-02; P6-D1, P6-D5, P6-D7, P6-D9, P6-D12, P6-D13). One module
// parses argv into up, down, status, doctor, mcp, and acp; dials the control socket with every
// request bounded by its CONTROL_TIMEOUT_MS; spawns the detached daemon with node:child_process
// argv form (no shell) when no daemon answers; probes Podman first on up with a bounded
// wait and never spawns on probe failure; and serves the Phase 5 MCP server over stdio for
// mcp through a daemon client, so every tool call crosses the shared daemon. Exit codes: 0
// success, 1 catalogue-coded failure, 2 usage error. Machine-readable codes go to stdout, human
// reasons to stderr; no env value is ever printed. Only runCli's caller supplies the environment
// (main hands over the host environment once, at the entry edge), so every command path stays
// hermetic under test.

import { spawn } from "node:child_process";
import { closeSync, fchmodSync, mkdirSync, openSync } from "node:fs";
import { createConnection } from "node:net";
import { runAcpOverStdio } from "../acp/stdio.js";
import { createJsonRpc, type AnchorRpc } from "../audit/anchor.js";
import { ERROR_CATALOGUE, ERROR_CODES, RealmError, makeRealmError, type ErrorCode } from "../core/errors.js";
import {
  sendRequest,
  CONTROL_TIMEOUT_MS,
  SOCKET_TIMEOUT_MS,
  type ControlReply,
  type ControlRequest,
  type ControlSelection,
} from "../daemon/channel.js";
import { connectDaemon, selectionOf, type DaemonClient, type DaemonStatus } from "../daemon/client.js";
import { daemonSpawnEnv } from "../daemon/spawn-env.js";
import { ensureDaemon, daemonAnswers, daemonLogPath, reportingStartFailure } from "../daemon/ensure.js";
import { defaultRunCommand, runChecks, type DoctorOptions } from "../doctor/checks.js";
import { applySafeFixes, FixRefusal, type FixAction } from "../doctor/fix.js";
import { runtimeChecks } from "../doctor/runtime-checks.js";
import { createMcpServer } from "../mcp/server.js";
import { loadRuntimeConfig, type RuntimeConfig } from "../runtime/config.js";
import { readRuntimeConfigFile } from "../runtime/config-file.js";
import { defaultPolicyPath, isDirectEntry, resolveConfigPath } from "../runtime/host-paths.js";
import {
  probePodman,
  type ConnectSocket,
  type PodmanProbeResult,
  type RunCommand,
} from "../runtime/podman-probe.js";
import { controlSocketPath, type EnvironmentLike } from "../session/paths.js";
import { parseAnchorArgs, runAnchor } from "./anchor.js";
import { runAuditCommand } from "./audit.js";
import { INIT_USAGE, InitRefusal, parseInitArgs, runInit } from "./init.js";

export const CLI_COMMANDS = ["init", "up", "down", "status", "doctor", "mcp", "acp", "anchor", "audit", "metrics"] as const;
export type CliCommand = (typeof CLI_COMMANDS)[number];

const USAGE =
  "Usage: realm <init|up|down|status|doctor|mcp|acp|anchor|audit|metrics> (realm init --image <name@sha256:digest> [--workspace <absolute path>] [--state-dir <absolute path>]; realm up|mcp|acp|status|down|metrics [--workspace <absolute path>]; realm doctor [--workspace <absolute path> | --fix [--dry-run]]; realm anchor --session <id> [--publish] [--rpc <url>]; realm audit verify [--file <path> | --session <id>] [--head <seq>:<sha256>] [--anchor <record.json>])";
const RETRY_INTERVAL_MS = 25;
const MCP_POLL_INTERVAL_MS = 100;

function isCliCommand(value: string): value is CliCommand {
  return (CLI_COMMANDS as readonly string[]).includes(value);
}

interface ParsedArgv {
  readonly command: CliCommand;
  readonly workspace: string | undefined;
  // The words after `init`, `doctor`, `anchor` or `audit`; empty for every other command.
  readonly words: readonly string[];
}

// `up`, `mcp`, `acp`, `status`, `down` and `metrics` take no arguments or `--workspace <path>`. `init`, `anchor` and `audit`
// take their own words. `doctor` takes --workspace <path>, --fix [--dry-run], or no flags.
function parseArgv(argv: readonly string[]): ParsedArgv | undefined {
  const [command, ...rest] = argv;
  if (command === undefined || !isCliCommand(command)) {
    return undefined;
  }
  if (command === "init" || command === "anchor" || command === "audit") {
    return { command, workspace: undefined, words: rest };
  }
  if (command === "doctor") {
    if (rest.length === 0 || (rest[0] === "--fix" && (rest.length === 1 || (rest.length === 2 && rest[1] === "--dry-run")))) {
      return { command, workspace: undefined, words: rest };
    }
    if (rest.length === 2 && rest[0] === "--workspace" && rest[1] !== undefined) {
      return { command, workspace: rest[1], words: [] };
    }
    return undefined;
  }
  if (rest.length === 0) {
    return { command, workspace: undefined, words: [] };
  }
  const [flag, value] = rest;
  if (rest.length === 2 && flag === "--workspace" && value !== undefined) {
    return { command, workspace: value, words: [] };
  }
  return undefined;
}

export interface SpawnedProcess {
  unref(): void;
}

export type SpawnDaemon = (
  file: string,
  args: readonly string[],
  options: {
    readonly detached: true;
    readonly stdio: readonly ["ignore", number, number];
    readonly env: EnvironmentLike;
  },
) => SpawnedProcess;

export type SendControlRequest = (
  socketPath: string,
  request: ControlRequest,
  timeoutMs: number,
) => Promise<ControlReply>;

export type ConnectDaemon = (socketPath: string, selection: ControlSelection) => DaemonClient;

type McpInput = Parameters<typeof createMcpServer>[1];
type McpOutput = Parameters<typeof createMcpServer>[2];
type AcpInput = Parameters<typeof runAcpOverStdio>[0]["stdin"];
type AcpOutput = Parameters<typeof runAcpOverStdio>[0]["stdout"];

export interface CliDeps {
  readonly env: EnvironmentLike;
  // Working directory that `realm up`, `realm mcp`, and `realm acp` use as the workspace root when --workspace
  // is absent. Defaults to process.cwd(); no other command reads it.
  readonly cwd?: string;
  readonly timeoutMs?: number;
  readonly daemonEntry?: string;
  readonly spawn?: SpawnDaemon;
  readonly send?: SendControlRequest;
  // Dials the control socket for the liveness probe and the mcp client (default connectDaemon).
  readonly connect?: ConnectDaemon;
  readonly runCommand?: RunCommand;
  readonly connectSocket?: ConnectSocket;
  readonly mcpInput?: McpInput;
  readonly mcpOutput?: McpOutput;
  readonly acpInput?: AcpInput;
  readonly acpOutput?: AcpOutput;
  // Stderr for the startup messages and refusals of mcp and acp (default process.stderr).
  readonly diagnostics?: McpOutput;
  // Reads the runtime config file that names the state directory (default readRuntimeConfigFile).
  readonly readConfig?: (path: string) => unknown;
  // REALM_ANCHOR_KEY_FILE, read once by the entry edge (main) and used only by `realm anchor --publish`.
  readonly anchorKeyFile?: string | undefined;
  // RPC factory for realm anchor --publish (default createJsonRpc); tests inject a fake.
  readonly createAnchorRpc?: (url: string) => AnchorRpc;
  // Clock for the anchor record's createdAt (default the wall clock).
  readonly now?: () => Date;
}

export interface CliResult {
  readonly exitCode: 0 | 1 | 2;
  readonly stdout: string;
  readonly stderr: string;
}

interface ResolvedDeps {
  readonly env: EnvironmentLike;
  readonly stateDir: string;
  readonly timeoutMs: number | undefined;
  readonly daemonEntry: string | undefined;
  readonly spawn: SpawnDaemon;
  readonly send: SendControlRequest;
  readonly connect: ConnectDaemon;
  readonly runCommand: RunCommand;
  readonly connectSocket: ConnectSocket;
  readonly mcpInput: McpInput;
  readonly mcpOutput: McpOutput;
  readonly acpInput: AcpInput;
  readonly acpOutput: AcpOutput;
  readonly diagnostics: McpOutput;
}

// Dials a Unix socket and closes it at once, mirroring the doctor default (checks.ts).
// Rejects on refusal, a missing socket, or no connection within timeoutMs.
function defaultConnectSocket(socketPath: string, timeoutMs: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const socket = createConnection(socketPath);
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("cli: socket did not connect in time"));
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

function defaultSend(
  socketPath: string,
  request: ControlRequest,
  timeoutMs: number,
): Promise<ControlReply> {
  return sendRequest(socketPath, request, { timeoutMs });
}

function defaultSpawnDaemon(
  file: string,
  args: readonly string[],
  options: Parameters<SpawnDaemon>[2],
): SpawnedProcess {
  const child = spawn(file, [...args], { detached: options.detached, stdio: [...options.stdio], env: options.env });
  child.unref();
  return child;
}

// The compiled daemon entry beside this module (dist/src/daemon/main.js). Derived from
// import.meta.url with the global URL: node:url is outside the P6-D7 allowlist.
function defaultDaemonEntry(): string {
  return decodeURIComponent(new URL("../daemon/main.js", import.meta.url).pathname);
}

// The catalogue code and reason for any failure; a non-RealmError maps to SCHEMA_INVALID.
function refusalOf(error: unknown): { readonly code: ErrorCode; readonly reason: string } {
  const code: ErrorCode = error instanceof RealmError ? error.code : "SCHEMA_INVALID";
  return { code, reason: ERROR_CATALOGUE[code].reason };
}

function failureFor(error: unknown): CliResult {
  const { code, reason } = refusalOf(error);
  return { exitCode: 1, stdout: `${code}\n`, stderr: `${reason}\n` };
}

// mcp's stdout carries only MCP messages, so its refusals go to stderr as code and reason.
function diagnosticFor(error: unknown): string {
  const { code, reason } = refusalOf(error);
  return `${code}: ${reason}\n`;
}

function replyToResult(reply: ControlReply): CliResult {
  if (reply.error !== undefined) {
    const code = reply.error.code;
    return { exitCode: 1, stdout: `${code}\n`, stderr: `${ERROR_CATALOGUE[code].reason}\n` };
  }
  return { exitCode: 0, stdout: `${renderResult(reply.result)}\n`, stderr: "" };
}

function renderResult(result: unknown): string {
  if (typeof result === "string") {
    return result;
  }
  if (result === undefined) {
    return "";
  }
  // JSON.stringify returns undefined for a function or symbol, which its declared string type hides. The reply is
  // untrusted socket input, so the fallback stays.
  const encoded = JSON.stringify(result) as string | undefined;
  return encoded ?? "";
}

function isAbsentDaemon(error: unknown): boolean {
  return error instanceof RealmError && error.code === "REALM_NOT_ACTIVE";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCatalogueCode(value: string): value is ErrorCode {
  return (ERROR_CODES as readonly string[]).includes(value);
}

// The lifecycle the daemon reports in an up reply (its snapshot); the fields stay unknown until checked.
interface UpLifecycle {
  readonly state: unknown;
  readonly reason: unknown;
}

// The snapshot of an up reply, or undefined when the reply carries none.
function lifecycleOf(result: unknown): UpLifecycle | undefined {
  const snapshot = isRecord(result) ? result["snapshot"] : undefined;
  if (!isRecord(snapshot)) {
    return undefined;
  }
  return { state: snapshot["state"], reason: snapshot["reason"] };
}

// The refusal for an up reply that does not report active or degraded. A catalogue code reason keeps
// its own code; any other reason reads as REALM_NOT_ACTIVE; a reply with no lifecycle is SCHEMA_INVALID.
function upRefusal(lifecycle: UpLifecycle | undefined): { readonly code: ErrorCode; readonly reason: string } {
  let code: ErrorCode = "SCHEMA_INVALID";
  if (lifecycle !== undefined) {
    code =
      typeof lifecycle.reason === "string" && isCatalogueCode(lifecycle.reason)
        ? lifecycle.reason
        : "REALM_NOT_ACTIVE";
  }
  return { code, reason: ERROR_CATALOGUE[code].reason };
}

// realm up succeeds only when the daemon reports the realm active or degraded. Any other state keeps
// its JSON on stdout and writes one "CODE: reason" line to stderr.
function upResult(reply: ControlReply): CliResult {
  if (reply.error !== undefined) {
    return replyToResult(reply);
  }
  const lifecycle = lifecycleOf(reply.result);
  if (lifecycle?.state === "active" || lifecycle?.state === "degraded") {
    return replyToResult(reply);
  }
  const { code, reason } = upRefusal(lifecycle);
  return { exitCode: 1, stdout: `${renderResult(reply.result)}\n`, stderr: `${code}: ${reason}\n` };
}

// The daemon's startup log: <stateDir>/daemon.log, append-only and owner-only. The state directory is
// made at 0700 when missing, because the log opens before the daemon creates it. The child keeps its own
// copy of the descriptor, so the parent closes its copy once the spawn returns.
function withDaemonLog(stateDir: string, launch: (log: number) => void): void {
  // Missing ancestors take the default mode; only the state directory itself is made 0700.
  const cut = stateDir.lastIndexOf("/");
  if (cut > 0) {
    mkdirSync(stateDir.slice(0, cut), { recursive: true });
  }
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const log = openSync(daemonLogPath(stateDir), "a", 0o600);
  try {
    fchmodSync(log, 0o600);
    launch(log);
  } finally {
    closeSync(log);
  }
}

// The line a failed attach adds to stderr, naming the startup log so the user can read the daemon's own
// error. The log's contents are never printed.
function daemonLogHint(stateDir: string): string {
  return `realm: the daemon's startup output is in ${daemonLogPath(stateDir)}\n`;
}

// The stderr line for a failed attach: the catalogue code and reason, then the log hint.
function attachFailure(error: unknown, stateDir: string): string {
  return `${diagnosticFor(error)}${daemonLogHint(stateDir)}`;
}

// Spawns the detached daemon with its output on the startup log and returns at once; the ensureDaemon
// poll that follows is what waits for it (T-06-07, T-06-10).
function spawnDetachedDaemon(deps: ResolvedDeps): () => void {
  return () => {
    const entry = deps.daemonEntry ?? defaultDaemonEntry();
    launchFilteredDaemon(entry, deps.stateDir, deps.env, deps.spawn);
  };
}

// Starts the daemon entry detached with the allowlisted environment (D-1505). The CLI spawn and
// startDetachedDaemon both go through here, so a sentinel variable reaches neither child.
export function launchFilteredDaemon(
  entry: string,
  stateDir: string,
  source: EnvironmentLike,
  spawnImpl: SpawnDaemon = defaultSpawnDaemon,
): void {
  // A Bun host never spawns the daemon: process.execPath there is the Omp binary, which would read the entry as a prompt
  // and run an unsupervised agent session. The attach refuses with REALM_NOT_ACTIVE until realm up has started the daemon.
  if (Object.hasOwn(process.versions, "bun")) {
    throw makeRealmError("REALM_NOT_ACTIVE");
  }
  withDaemonLog(stateDir, (log) => {
    spawnImpl(process.execPath, [entry], {
      detached: true,
      stdio: ["ignore", log, log],
      env: daemonSpawnEnv(source),
    });
  });
}

// The documented CLI daemon spawn (P6-D1). The Omp extension imports it. The child receives the allowlisted
// environment only; a stale REALM_DRIVER_*_ROOT variable is not passed.
export function startDetachedDaemon(entry: string, stateDir: string): void {
  launchFilteredDaemon(entry, stateDir, process.env);
}

// One control request's bound: an injected timeoutMs overrides it; otherwise the method's own
// CONTROL_TIMEOUT_MS entry applies (channel.ts), so no request runs on a shared default.
function controlTimeoutOf(deps: ResolvedDeps, method: keyof typeof CONTROL_TIMEOUT_MS): number {
  return deps.timeoutMs ?? CONTROL_TIMEOUT_MS[method];
}

async function runUp(deps: ResolvedDeps, socketPath: string, workspaceRoot: string): Promise<CliResult> {
  const upTimeoutMs = controlTimeoutOf(deps, "up");
  let probe: PodmanProbeResult;
  try {
    probe = await probePodman({
      runCommand: deps.runCommand,
      connectSocket: deps.connectSocket,
      env: deps.env,
      timeoutMs: deps.timeoutMs ?? SOCKET_TIMEOUT_MS,
    });
  } catch (error) {
    return failureFor(error);
  }
  if (!probe.ok) {
    // T-06-10: the host cannot run containers, so no daemon is spawned.
    return { exitCode: 1, stdout: `${probe.code}\n`, stderr: `${probe.reason}\n` };
  }
  // ensureDaemon spawns at most one detached daemon and polls the status probe until one answers;
  // an expired bound throws DAEMON_START_TIMEOUT, which failureFor reports as before.
  try {
    await ensureDaemon({
      socketPath,
      probe: reportingStartFailure(daemonAnswers(deps.connect, selectionOf(workspaceRoot)), deps.stateDir),
      spawnDaemon: spawnDetachedDaemon(deps),
      timeoutMs: upTimeoutMs,
      pollMs: RETRY_INTERVAL_MS,
    });
    return upResult(
      await deps.send(socketPath, { id: 1, method: "up", params: { workspaceRoot } }, upTimeoutMs),
    );
  } catch (error) {
    const failure = failureFor(error);
    return { ...failure, stderr: `${failure.stderr}${daemonLogHint(deps.stateDir)}` };
  }
}

async function runDown(deps: ResolvedDeps, socketPath: string, workspaceRoot: string): Promise<CliResult> {
  try {
    return replyToResult(
      await deps.send(
        socketPath,
        { id: 1, method: "down", params: { selection: selectionOf(workspaceRoot) } },
        controlTimeoutOf(deps, "down"),
      ),
    );
  } catch (error) {
    if (!isAbsentDaemon(error)) {
      return failureFor(error);
    }
    // CORE-06: down is idempotent, so a realm with no daemon is already down.
    return { exitCode: 0, stdout: "disconnected\n", stderr: "already down\n" };
  }
}


async function runMetrics(deps: ResolvedDeps, socketPath: string, workspaceRoot: string): Promise<CliResult> {
  try {
    return replyToResult(
      await deps.send(
        socketPath,
        { id: 1, method: "metrics", params: { selection: selectionOf(workspaceRoot) } },
        controlTimeoutOf(deps, "metrics"),
      ),
    );
  } catch (error) {
    if (!isAbsentDaemon(error)) {
      return failureFor(error);
    }
    return { exitCode: 1, stdout: "REALM_NOT_ACTIVE\n", stderr: "realm metrics: daemon absent (REALM_NOT_ACTIVE)\n" };
  }
}

async function runStatus(deps: ResolvedDeps, socketPath: string, workspaceRoot: string): Promise<CliResult> {
  try {
    return replyToResult(
      await deps.send(
        socketPath,
        { id: 1, method: "status", params: { selection: selectionOf(workspaceRoot) } },
        controlTimeoutOf(deps, "status"),
      ),
    );
  } catch (error) {
    if (!isAbsentDaemon(error)) {
      return failureFor(error);
    }
    // OQ-P6-02: no daemon, so report disconnected locally and say the daemon is absent.
    return {
      exitCode: 0,
      stdout: "disconnected\n",
      stderr: "realm status: daemon absent (REALM_NOT_ACTIVE); local report\n",
    };
  }
}

async function runDoctor(
  deps: ResolvedDeps,
  runtimeConfig: RuntimeConfig,
  socketPath: string,
  workspace: string | undefined,
): Promise<CliResult> {
  try {
    // Without --workspace doctor names no session, so the daemon reports its agent-OS reading as unbound (C4).
    const request =
      workspace === undefined
        ? { id: 1, method: "doctor" }
        : { id: 1, method: "doctor", params: { selection: selectionOf(workspace) } };
    return replyToResult(await deps.send(socketPath, request, controlTimeoutOf(deps, "doctor")));
  } catch (error) {
    if (!isAbsentDaemon(error)) {
      return failureFor(error);
    }
  }
  // OQ-P6-02: no daemon, so run the local checks and say the daemon is absent.
  const options = localDoctorOptions(deps, runtimeConfig);
  let checks: readonly { readonly id: string }[];
  try {
    checks = await runChecks(options);
  } catch (error) {
    return failureFor(error);
  }
  return {
    exitCode: 0,
    stdout: `${JSON.stringify(checks)}\n`,
    stderr: `realm doctor: daemon absent (REALM_NOT_ACTIVE); ran ${String(checks.length)} local checks\n`,
  };
}

function localDoctorOptions(deps: ResolvedDeps, runtimeConfig: RuntimeConfig): DoctorOptions {
  return {
    stateDir: runtimeConfig.stateDir,
    policyPath: defaultPolicyPath(runtimeConfig.stateDir),
    env: deps.env,
    runtimeConfig,
    runCommand: deps.runCommand,
    connectSocket: deps.connectSocket,
    probeTimeoutMs: deps.timeoutMs ?? SOCKET_TIMEOUT_MS,
  };
}

// Fixes are host-local even when a daemon answers. The protected workspace is from config,
// never the invoking cwd. Diagnostics stay local too, and cannot make dry-run mutate disk.
async function runDoctorFix(
  deps: ResolvedDeps,
  runtimeConfig: RuntimeConfig,
  dryRun: boolean,
): Promise<CliResult> {
  let fixes: readonly FixAction[] = [];
  try {
    fixes = applySafeFixes(runtimeConfig.stateDir, dryRun, {
      home: deps.env["HOME"] ?? "",
      workspace: runtimeConfig.workspaceRoot,
    });
    const checks = await runChecks(localDoctorOptions(deps, runtimeConfig));
    const lines = fixes.map((fix) =>
      `realm doctor --fix: ${dryRun ? "would " : ""}${fix.kind} ${fix.path} to 0700\n`,
    );
    lines.push(`realm doctor --fix: ran ${String(checks.length)} local checks\n`);
    return { exitCode: 0, stdout: `${JSON.stringify({ dryRun, fixes, checks })}\n`, stderr: lines.join("") };
  } catch (error: unknown) {
    const failure = failureFor(error);
    const completed = (error instanceof FixRefusal ? error.applied : fixes)
      .map((fix) => `realm doctor --fix: ${dryRun ? "would " : "applied "}${fix.kind} ${fix.path} to 0700\n`)
      .join("");
    if (!(error instanceof FixRefusal)) return { ...failure, stderr: `${failure.stderr}${completed}` };
    return {
      ...failure,
      stderr: `${failure.stderr}${completed}realm doctor --fix: refused ${error.path} (${error.detail}); no further actions applied\n`,
    };
  }
}

// Ensures the shared daemon answers on the control socket, spawning it detached when none does.
async function ensureSharedDaemon(deps: ResolvedDeps, socketPath: string, selection: ControlSelection): Promise<void> {
  await ensureDaemon({
    socketPath,
    probe: reportingStartFailure(daemonAnswers(deps.connect, selection), deps.stateDir),
    spawnDaemon: spawnDetachedDaemon(deps),
    timeoutMs: controlTimeoutOf(deps, "up"),
    pollMs: MCP_POLL_INTERVAL_MS,
  });
}

// The daemon's startup-reap notice (CRASH-04) goes to the diagnostics sink, never stdout: stdout carries only
// protocol frames. Absent notice writes nothing.
function writeNotice(deps: ResolvedDeps, status: DaemonStatus): void {
  if (status.notice !== undefined) {
    deps.diagnostics.write(`${status.notice}\n`);
  }
}

// realm mcp attaches to the shared daemon (P6-D9): ensure it runs, claim the workspace with up,
// then serve the Phase 5 server over stdio with the daemon client as its dispatcher. Every tool
// call crosses the daemon; no handle is built in-process. stdout carries only MCP messages, so a
// refused up is written to stderr while the server keeps answering.
async function runMcp(deps: ResolvedDeps, socketPath: string, workspaceRoot: string): Promise<CliResult> {
  let selection: ControlSelection;
  try {
    selection = selectionOf(workspaceRoot);
    await ensureSharedDaemon(deps, socketPath, selection);
  } catch (error) {
    return { exitCode: 1, stdout: "", stderr: attachFailure(error, deps.stateDir) };
  }
  const client = deps.connect(socketPath, selection);
  try {
    const status = await client.up();
    writeNotice(deps, status);
  } catch (error) {
    deps.diagnostics.write(attachFailure(error, deps.stateDir));
  }
  const server = createMcpServer(client, deps.mcpInput, deps.mcpOutput, deps.diagnostics);
  try {
    await server.closed;
  } catch (error) {
    if (error instanceof RealmError) {
      return { exitCode: 1, stdout: "", stderr: diagnosticFor(error) };
    }
    throw error;
  } finally {
    client.close();
  }
  return { exitCode: 0, stdout: "", stderr: "" };
}

// realm acp attaches the same way realm mcp does (P6-D9), then serves ACP over stdio with the daemon
// client as its dispatcher. stdout carries only ACP frames, so startup and refusals go to stderr. The
// session must reach active or degraded before the server starts; any other state exits 1 with its code.
async function runAcp(deps: ResolvedDeps, socketPath: string, workspaceRoot: string): Promise<CliResult> {
  let selection: ControlSelection;
  try {
    selection = selectionOf(workspaceRoot);
    await ensureSharedDaemon(deps, socketPath, selection);
  } catch (error) {
    return { exitCode: 1, stdout: "", stderr: attachFailure(error, deps.stateDir) };
  }
  const client = deps.connect(socketPath, selection);
  try {
    let status: DaemonStatus;
    try {
      status = await client.up();
    } catch (error) {
      return { exitCode: 1, stdout: "", stderr: attachFailure(error, deps.stateDir) };
    }
    writeNotice(deps, status);
    const lifecycle: UpLifecycle = { state: status.snapshot.state, reason: status.snapshot.reason };
    if (lifecycle.state !== "active" && lifecycle.state !== "degraded") {
      const { code, reason } = upRefusal(lifecycle);
      return { exitCode: 1, stdout: "", stderr: `${code}: ${reason}\n` };
    }
    await runAcpOverStdio({
      dispatcher: { call: (tool: unknown) => client.call(tool) },
      stdin: deps.acpInput,
      stdout: deps.acpOutput,
    });
    return { exitCode: 0, stdout: "", stderr: "" };
  } catch (error) {
    return { exitCode: 1, stdout: "", stderr: diagnosticFor(error) };
  } finally {
    client.close();
  }
}

// realm anchor: parseAnchorArgs refuses malformed flags with usage (exit 2); runAnchor refuses every other
// bad input with exit 1 and makes no network call unless --publish passed its checks.
async function runAnchorCommand(words: readonly string[], deps: CliDeps, stateDir: string): Promise<CliResult> {
  const args = parseAnchorArgs(words);
  if (args === undefined) {
    return {
      exitCode: 2,
      stdout: "",
      stderr: "realm anchor: usage: realm anchor --session <id> [--publish] [--rpc <url>]\n",
    };
  }
  return runAnchor(args, {
    stateDir,
    keyFile: deps.anchorKeyFile,
    createRpc: deps.createAnchorRpc ?? ((url) => createJsonRpc({ url })),
    now: deps.now ?? (() => new Date()),
  });
}

// The state directory for realm audit verify --session and the selector-less form, read from the realm config the
// way runCli reads it for the other commands. Absent or invalid config yields undefined; the audit command then
// refuses with usage (exit 2), as realm anchor does.
function auditStateDir(deps: CliDeps): string | undefined {
  try {
    return loadRuntimeConfig((deps.readConfig ?? readRuntimeConfigFile)(resolveConfigPath(deps.env))).stateDir;
  } catch {
    return undefined;
  }
}

// realm init (ONB-01) runs before any config is read: it is the command that writes the config. A malformed
// invocation is a usage error (exit 2). A refusal or write failure is its catalogue code on stdout and its detail
// on stderr (exit 1). Success prints one JSON line of paths and the mode; no file content is printed.
function runInitCommand(words: readonly string[], deps: CliDeps): CliResult {
  const args = parseInitArgs(words);
  if (args === undefined) {
    return { exitCode: 2, stdout: "", stderr: `${INIT_USAGE}\n` };
  }
  try {
    const summary = runInit(args, { env: deps.env, cwd: deps.cwd ?? process.cwd() });
    return { exitCode: 0, stdout: `${JSON.stringify(summary)}\n`, stderr: "" };
  } catch (error) {
    if (error instanceof InitRefusal) {
      return { exitCode: 1, stdout: `${error.code}\n`, stderr: `realm init: ${error.detail}\n` };
    }
    return failureFor(error);
  }
}
export async function runCli(argv: readonly string[], deps: CliDeps): Promise<CliResult> {
  const parsed = parseArgv(argv);
  if (parsed === undefined) {
    return { exitCode: 2, stdout: "", stderr: `${USAGE}\n` };
  }
  if (parsed.command === "audit") {
    return runAuditCommand(parsed.words, () => auditStateDir(deps));
  }
  if (parsed.command === "init") {
    return runInitCommand(parsed.words, deps);
  }
  const { command } = parsed;
  let stateDir: string;
  let runtimeConfig: RuntimeConfig;
  try {
    runtimeConfig = loadRuntimeConfig((deps.readConfig ?? readRuntimeConfigFile)(resolveConfigPath(deps.env)));
    stateDir = runtimeConfig.stateDir;
  } catch {
    if (command === "doctor") {
      if (parsed.words.length !== 0) {
        const failure = failureFor(new RealmError("SCHEMA_INVALID"));
        return { ...failure, stderr: `${failure.stderr}realm doctor --fix: config must be present and valid; run realm init\n` };
      }
      const checks = await runtimeChecks({ env: deps.env });
      return {
        exitCode: 0,
        stdout: `${JSON.stringify(checks)}\n`,
        stderr: `realm doctor: config is absent; ran ${String(checks.length)} local check\n`,
      };
    }
    return {
      exitCode: 2,
      stdout: "",
      stderr: `realm ${command}: cannot resolve a state directory (the realm config file under an absolute XDG_CONFIG_HOME or HOME must be present and valid)\n`,
    };
  }
  const resolved: ResolvedDeps = {
    env: deps.env,
    stateDir,
    timeoutMs: deps.timeoutMs,
    daemonEntry: deps.daemonEntry,
    spawn: deps.spawn ?? defaultSpawnDaemon,
    send: deps.send ?? defaultSend,
    connect: deps.connect ?? connectDaemon,
    runCommand: deps.runCommand ?? defaultRunCommand,
    connectSocket: deps.connectSocket ?? defaultConnectSocket,
    mcpInput: deps.mcpInput ?? process.stdin,
    mcpOutput: deps.mcpOutput ?? process.stdout,
    acpInput: deps.acpInput ?? process.stdin,
    acpOutput: deps.acpOutput ?? process.stdout,
    diagnostics: deps.diagnostics ?? process.stderr,
  };
  const socketPath = controlSocketPath(stateDir);
  switch (command) {
    case "up":
    case "mcp":
    case "acp": {
      const workspaceRoot = parsed.workspace ?? deps.cwd ?? process.cwd();
      // Absolute POSIX path by string operations: node:path is outside the P6-D7 allowlist.
      if (!workspaceRoot.startsWith("/")) {
        return {
          exitCode: 2,
          stdout: "",
          stderr: `realm ${command}: the workspace root must be an absolute path (use --workspace <path>)\n`,
        };
      }
      if (command === "up") {
        return runUp(resolved, socketPath, workspaceRoot);
      }
      if (command === "mcp") {
        return runMcp(resolved, socketPath, workspaceRoot);
      }
      return runAcp(resolved, socketPath, workspaceRoot);
    }
    case "down":
      return runDown(resolved, socketPath, parsed.workspace ?? deps.cwd ?? process.cwd());
    case "status":
      return runStatus(resolved, socketPath, parsed.workspace ?? deps.cwd ?? process.cwd());
    case "metrics":
      return runMetrics(resolved, socketPath, parsed.workspace ?? deps.cwd ?? process.cwd());
    case "doctor":
      return parsed.words.length === 0
        ? runDoctor(resolved, runtimeConfig, socketPath, parsed.workspace)
        : runDoctorFix(resolved, runtimeConfig, parsed.words[1] === "--dry-run");
    case "anchor":
      return runAnchorCommand(parsed.words, deps, stateDir);
  }
}

export async function main(): Promise<void> {
  // The only host environment read in this module: the entry edge hands it to
  // runCli, which never reads it itself.
  const result = await runCli(process.argv.slice(2), {
    env: process.env,
    anchorKeyFile: process.env.REALM_ANCHOR_KEY_FILE,
  });
  if (result.stdout !== "") {
    process.stdout.write(result.stdout);
  }
  if (result.stderr !== "") {
    process.stderr.write(result.stderr);
  }
  process.exitCode = result.exitCode;
}

if (isDirectEntry(import.meta.url, process.argv[1])) {
  void main();
}

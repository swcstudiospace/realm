#!/usr/bin/env node
// Realm CLI (CLI-01, CLI-02; P6-D1, P6-D5, P6-D7, P6-D9, P6-D12, P6-D13). One module
// parses argv into up, down, status, doctor, and mcp; dials the control socket with every
// request bounded by its CONTROL_TIMEOUT_MS; spawns the detached daemon with node:child_process
// argv form (no shell) when no daemon answers; probes Podman first on up with a bounded
// wait and never spawns on probe failure; and serves the Phase 5 MCP server over stdio for
// mcp through a daemon client, so every tool call crosses the shared daemon. Exit codes: 0
// success, 1 catalogue-coded failure, 2 usage error. Machine-readable codes go to stdout, human
// reasons to stderr; no env value is ever printed. Only runCli's caller supplies the environment
// (main hands over the host environment once, at the entry edge), so every command path stays
// hermetic under test.

import { spawn } from "node:child_process";
import { createConnection } from "node:net";
import { ERROR_CATALOGUE, RealmError, type ErrorCode } from "../core/errors.js";
import {
  sendRequest,
  CONTROL_TIMEOUT_MS,
  SOCKET_TIMEOUT_MS,
  type ControlReply,
  type ControlRequest,
} from "../daemon/channel.js";
import { connectDaemon, type DaemonClient } from "../daemon/client.js";
import { ensureDaemon } from "../daemon/ensure.js";
import { defaultRunCommand, runChecks, type DoctorOptions } from "../doctor/checks.js";
import { createMcpServer } from "../mcp/server.js";
import { isDirectEntry } from "../runtime/host-paths.js";
import {
  probePodman,
  type ConnectSocket,
  type PodmanProbeResult,
  type RunCommand,
} from "../runtime/podman-probe.js";
import { controlSocketPath, resolveStateDir, type EnvironmentLike } from "../session/paths.js";

export const CLI_COMMANDS = ["up", "down", "status", "doctor", "mcp"] as const;
export type CliCommand = (typeof CLI_COMMANDS)[number];

const USAGE = "Usage: realm <up|down|status|doctor|mcp> (realm up|mcp [--workspace <absolute path>])";
const RETRY_INTERVAL_MS = 25;
const MCP_POLL_INTERVAL_MS = 100;

function isCliCommand(value: string): value is CliCommand {
  return (CLI_COMMANDS as readonly string[]).includes(value);
}

interface ParsedArgv {
  readonly command: CliCommand;
  readonly workspace: string | undefined;
}

// `up` and `mcp` take no arguments or `--workspace <path>`; every other command takes no arguments.
function parseArgv(argv: readonly string[]): ParsedArgv | undefined {
  const [command, ...rest] = argv;
  if (command === undefined || !isCliCommand(command)) {
    return undefined;
  }
  if (rest.length === 0) {
    return { command, workspace: undefined };
  }
  const [flag, value] = rest;
  const takesWorkspace = command === "up" || command === "mcp";
  if (takesWorkspace && rest.length === 2 && flag === "--workspace" && value !== undefined) {
    return { command, workspace: value };
  }
  return undefined;
}

export interface SpawnedProcess {
  unref(): void;
}

export type SpawnDaemon = (
  file: string,
  args: readonly string[],
  options: { readonly detached: true; readonly stdio: "ignore" },
) => SpawnedProcess;

export type SendControlRequest = (
  socketPath: string,
  request: ControlRequest,
  timeoutMs: number,
) => Promise<ControlReply>;

export type ConnectDaemon = (socketPath: string) => DaemonClient;

type McpInput = Parameters<typeof createMcpServer>[1];
type McpOutput = Parameters<typeof createMcpServer>[2];

export interface CliDeps {
  readonly env: EnvironmentLike;
  // Working directory that `realm up` and `realm mcp` use as the workspace root when --workspace
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
  readonly mcpDiagnostics?: McpOutput;
}

export interface CliResult {
  readonly exitCode: 0 | 1 | 2;
  readonly stdout: string;
  readonly stderr: string;
}

interface ResolvedDeps {
  readonly env: EnvironmentLike;
  readonly timeoutMs: number | undefined;
  readonly daemonEntry: string | undefined;
  readonly spawn: SpawnDaemon;
  readonly send: SendControlRequest;
  readonly connect: ConnectDaemon;
  readonly runCommand: RunCommand;
  readonly connectSocket: ConnectSocket;
  readonly mcpInput: McpInput;
  readonly mcpOutput: McpOutput;
  readonly mcpDiagnostics: McpOutput;
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
  options: { readonly detached: true; readonly stdio: "ignore" },
): SpawnedProcess {
  const child = spawn(file, [...args], { detached: options.detached, stdio: options.stdio });
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
  return JSON.stringify(result) ?? "";
}

function isAbsentDaemon(error: unknown): boolean {
  return error instanceof RealmError && error.code === "REALM_NOT_ACTIVE";
}

// The probe ensureDaemon polls: one status request on a fresh client. An absent socket reads as no
// daemon yet (false); any other failure propagates unchanged.
function probeDaemon(deps: ResolvedDeps): (socketPath: string) => Promise<boolean> {
  return async (socketPath) => {
    const client = deps.connect(socketPath);
    try {
      await client.status();
      return true;
    } catch (error) {
      if (isAbsentDaemon(error)) {
        return false;
      }
      throw error;
    } finally {
      client.close();
    }
  };
}

// Spawns the detached daemon (argv form, no shell, stdio ignored) and returns at once; the
// ensureDaemon poll that follows is what waits for it (T-06-07, T-06-10).
function spawnDetachedDaemon(deps: ResolvedDeps): () => void {
  return () => {
    const entry = deps.daemonEntry ?? defaultDaemonEntry();
    deps.spawn(process.execPath, [entry], { detached: true, stdio: "ignore" });
  };
}

// The documented CLI daemon spawn (P6-D1): starts the daemon entry detached with the argv form (no
// shell), stdio ignored, and unrefs the child so the CLI can exit. The Omp extension imports it.
export function startDetachedDaemon(entry: string): void {
  const child = spawn(process.execPath, [entry], { detached: true, stdio: "ignore" });
  child.unref();
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
  // an expired bound throws TOOL_TIMEOUT, which failureFor reports as before.
  try {
    await ensureDaemon({
      socketPath,
      probe: probeDaemon(deps),
      spawnDaemon: spawnDetachedDaemon(deps),
      timeoutMs: upTimeoutMs,
      pollMs: RETRY_INTERVAL_MS,
    });
    return replyToResult(
      await deps.send(socketPath, { id: 1, method: "up", params: { workspaceRoot } }, upTimeoutMs),
    );
  } catch (error) {
    return failureFor(error);
  }
}

async function runDown(deps: ResolvedDeps, socketPath: string): Promise<CliResult> {
  try {
    return replyToResult(
      await deps.send(socketPath, { id: 1, method: "down" }, controlTimeoutOf(deps, "down")),
    );
  } catch (error) {
    return failureFor(error);
  }
}

async function runStatus(deps: ResolvedDeps, socketPath: string): Promise<CliResult> {
  try {
    return replyToResult(
      await deps.send(socketPath, { id: 1, method: "status" }, controlTimeoutOf(deps, "status")),
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

async function runDoctor(deps: ResolvedDeps, stateDir: string, socketPath: string): Promise<CliResult> {
  try {
    return replyToResult(
      await deps.send(socketPath, { id: 1, method: "doctor" }, controlTimeoutOf(deps, "doctor")),
    );
  } catch (error) {
    if (!isAbsentDaemon(error)) {
      return failureFor(error);
    }
  }
  // OQ-P6-02: no daemon, so run the local checks and say the daemon is absent.
  const options: DoctorOptions = {
    stateDir,
    env: deps.env,
    runCommand: deps.runCommand,
    connectSocket: deps.connectSocket,
    probeTimeoutMs: deps.timeoutMs ?? SOCKET_TIMEOUT_MS,
  };
  let checks: readonly { readonly id: string }[];
  try {
    checks = await runChecks(options);
  } catch (error) {
    return failureFor(error);
  }
  return {
    exitCode: 0,
    stdout: `${JSON.stringify(checks)}\n`,
    stderr: `realm doctor: daemon absent (REALM_NOT_ACTIVE); ran ${checks.length} local checks\n`,
  };
}

// realm mcp attaches to the shared daemon (P6-D9): ensure it runs, claim the workspace with up,
// then serve the Phase 5 server over stdio with the daemon client as its dispatcher. Every tool
// call crosses the daemon; no handle is built in-process. stdout carries only MCP messages, so a
// refused up is written to stderr while the server keeps answering.
async function runMcp(deps: ResolvedDeps, socketPath: string, workspaceRoot: string): Promise<CliResult> {
  try {
    await ensureDaemon({
      socketPath,
      probe: probeDaemon(deps),
      spawnDaemon: spawnDetachedDaemon(deps),
      timeoutMs: controlTimeoutOf(deps, "up"),
      pollMs: MCP_POLL_INTERVAL_MS,
    });
  } catch (error) {
    return { exitCode: 1, stdout: "", stderr: diagnosticFor(error) };
  }
  const client = deps.connect(socketPath);
  try {
    await client.up(workspaceRoot);
  } catch (error) {
    deps.mcpDiagnostics.write(diagnosticFor(error));
  }
  const server = createMcpServer(client, deps.mcpInput, deps.mcpOutput, deps.mcpDiagnostics);
  await server.closed;
  client.close();
  return { exitCode: 0, stdout: "", stderr: "" };
}

export async function runCli(argv: readonly string[], deps: CliDeps): Promise<CliResult> {
  const parsed = parseArgv(argv);
  if (parsed === undefined) {
    return { exitCode: 2, stdout: "", stderr: `${USAGE}\n` };
  }
  const { command } = parsed;
  let stateDir: string;
  try {
    stateDir = resolveStateDir(deps.env);
  } catch {
    return {
      exitCode: 2,
      stdout: "",
      stderr: `realm ${command}: cannot resolve a state directory (set XDG_STATE_HOME or HOME to an absolute path)\n`,
    };
  }
  const resolved: ResolvedDeps = {
    env: deps.env,
    timeoutMs: deps.timeoutMs,
    daemonEntry: deps.daemonEntry,
    spawn: deps.spawn ?? defaultSpawnDaemon,
    send: deps.send ?? defaultSend,
    connect: deps.connect ?? connectDaemon,
    runCommand: deps.runCommand ?? defaultRunCommand,
    connectSocket: deps.connectSocket ?? defaultConnectSocket,
    mcpInput: deps.mcpInput ?? (process.stdin as unknown as McpInput),
    mcpOutput: deps.mcpOutput ?? (process.stdout as unknown as McpOutput),
    mcpDiagnostics: deps.mcpDiagnostics ?? (process.stderr as unknown as McpOutput),
  };
  const socketPath = controlSocketPath(stateDir);
  switch (command) {
    case "up":
    case "mcp": {
      const workspaceRoot = parsed.workspace ?? deps.cwd ?? process.cwd();
      // Absolute POSIX path by string operations: node:path is outside the P6-D7 allowlist.
      if (!workspaceRoot.startsWith("/")) {
        return {
          exitCode: 2,
          stdout: "",
          stderr: `realm ${command}: the workspace root must be an absolute path (use --workspace <path>)\n`,
        };
      }
      return command === "up"
        ? runUp(resolved, socketPath, workspaceRoot)
        : runMcp(resolved, socketPath, workspaceRoot);
    }
    case "down":
      return runDown(resolved, socketPath);
    case "status":
      return runStatus(resolved, socketPath);
    case "doctor":
      return runDoctor(resolved, stateDir, socketPath);
  }
}

export async function main(): Promise<void> {
  // The only host environment read in this module: the entry edge hands it to
  // runCli, which never reads it itself.
  const result = await runCli(process.argv.slice(2), { env: process.env });
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

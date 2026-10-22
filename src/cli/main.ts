#!/usr/bin/env node
// Realm CLI (CLI-01, CLI-02; P6-D1, P6-D5, P6-D7, P6-D9, P6-D12, P6-D13). One module
// parses argv into up, down, status, doctor, and mcp; dials the control socket with every
// request bounded by its CONTROL_TIMEOUT_MS; spawns the detached daemon with node:child_process
// argv form (no shell) when up finds no daemon; probes Podman first on up with a bounded
// wait and never spawns on probe failure; and serves the Phase 5 MCP server over stdio for
// mcp from the shared daemon handle. Exit codes: 0 success, 1 catalogue-coded failure,
// 2 usage error. Machine-readable codes go to stdout, human reasons to stderr; no env value
// is ever printed. Only runCli's caller supplies the environment (main hands over the host
// environment once, at the entry edge), so every command path stays hermetic under test.

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
import { buildDaemonHandle } from "../daemon/daemon.js";
import { defaultRunCommand, runChecks, type DoctorOptions } from "../doctor/checks.js";
import { createMcpServer, type McpDispatcher } from "../mcp/server.js";
import { defaultPolicyPath, isDirectEntry, podmanSocketPath } from "../runtime/host-paths.js";
import {
  probePodman,
  type ConnectSocket,
  type PodmanProbeResult,
  type RunCommand,
} from "../runtime/podman-probe.js";
import { controlSocketPath, resolveStateDir, type EnvironmentLike } from "../session/paths.js";

export const CLI_COMMANDS = ["up", "down", "status", "doctor", "mcp"] as const;
export type CliCommand = (typeof CLI_COMMANDS)[number];

const USAGE = "Usage: realm <up|down|status|doctor|mcp> (realm up [--workspace <absolute path>])";
const RETRY_INTERVAL_MS = 25;

function isCliCommand(value: string): value is CliCommand {
  return (CLI_COMMANDS as readonly string[]).includes(value);
}

interface ParsedArgv {
  readonly command: CliCommand;
  readonly workspace: string | undefined;
}

// `up` takes no arguments or `--workspace <path>`; every other command takes no arguments.
function parseArgv(argv: readonly string[]): ParsedArgv | undefined {
  const [command, ...rest] = argv;
  if (command === undefined || !isCliCommand(command)) {
    return undefined;
  }
  if (rest.length === 0) {
    return { command, workspace: undefined };
  }
  const [flag, value] = rest;
  if (command === "up" && rest.length === 2 && flag === "--workspace" && value !== undefined) {
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

export interface CliDaemonHandle {
  readonly dispatcher: McpDispatcher;
}

export interface McpHandleRequest {
  readonly env: EnvironmentLike;
  readonly stateDir: string;
  readonly runtimeInput: unknown;
  readonly policyPath: string;
  readonly sessionId: string;
}

export type BuildDaemonHandle = (
  request: McpHandleRequest,
) => Promise<CliDaemonHandle> | CliDaemonHandle;
type McpInput = Parameters<typeof createMcpServer>[1];
type McpOutput = Parameters<typeof createMcpServer>[2];

export interface CliDeps {
  readonly env: EnvironmentLike;
  // Working directory that `realm up` uses as the workspace root when --workspace is absent.
  // Defaults to process.cwd(); no other command reads it.
  readonly cwd?: string;
  readonly timeoutMs?: number;
  readonly daemonEntry?: string;
  readonly now?: () => number;
  readonly spawn?: SpawnDaemon;
  readonly send?: SendControlRequest;
  readonly runCommand?: RunCommand;
  readonly connectSocket?: ConnectSocket;
  readonly buildHandle?: BuildDaemonHandle;
  // Wiring inputs for the shared handle (P6-D12). runtimeInput has no safe CLI
  // default (image, workload, and workspace are host decisions); when absent the
  // mcp command refuses with SCHEMA_INVALID instead of inventing configuration.
  readonly runtimeInput?: unknown;
  readonly policyPath?: string;
  readonly sessionId?: string;
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
  readonly now: () => number;
  readonly spawn: SpawnDaemon;
  readonly send: SendControlRequest;
  readonly runCommand: RunCommand;
  readonly connectSocket: ConnectSocket;
  readonly buildHandle: BuildDaemonHandle;
  readonly runtimeInput: unknown;
  readonly policyPath: string | undefined;
  readonly sessionId: string | undefined;
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

// The production handle builder (P6-D12): the 06-03 buildDaemonHandle with the
// CLI-resolved values. Only what the CLI can resolve is defaulted (stateDir-derived
// policy path, stable mcp session id, probe-rule libpod socket path); runtimeInput must
// arrive from the caller. A missing policy file is safe: loadPolicyFile falls back to
// validated defaults.
function defaultBuildHandle(request: McpHandleRequest): CliDaemonHandle {
  // 06-03 refuses a half-wired handle at build time; deriving the socket path here
  // keeps the production default as functional as the seams allow (live mcp still
  // gates on the AgentOS driver seam, which has no in-repo implementation).
  const socketPath = podmanSocketPath(request.env);
  return buildDaemonHandle({
    runtimeInput: request.runtimeInput,
    policyPath: request.policyPath,
    sessionId: request.sessionId,
    ...(socketPath !== undefined ? { libpodSocketPath: socketPath } : {}),
    env: request.env,
  });
}

function failureFor(error: unknown): CliResult {
  const code: ErrorCode = error instanceof RealmError ? error.code : "SCHEMA_INVALID";
  return { exitCode: 1, stdout: `${code}\n`, stderr: `${ERROR_CATALOGUE[code].reason}\n` };
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
  let nextId = 1;
  try {
    return replyToResult(
      await deps.send(
        socketPath,
        { id: nextId, method: "up", params: { workspaceRoot } },
        upTimeoutMs,
      ),
    );
  } catch (error) {
    if (!isAbsentDaemon(error)) {
      return failureFor(error);
    }
  }
  // No daemon answered: spawn the detached child (argv form, no shell, stdio ignored)
  // and connect within the bound (T-06-07, T-06-10).
  try {
    const entry = deps.daemonEntry ?? defaultDaemonEntry();
    deps.spawn(process.execPath, [entry], { detached: true, stdio: "ignore" });
  } catch (error) {
    return failureFor(error);
  }
  const deadline = deps.now() + upTimeoutMs;
  const maxAttempts = Math.max(1, Math.ceil(upTimeoutMs / RETRY_INTERVAL_MS) + 1);
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    nextId += 1;
    try {
      return replyToResult(
        await deps.send(
          socketPath,
          { id: nextId, method: "up", params: { workspaceRoot } },
          upTimeoutMs,
        ),
      );
    } catch (error) {
      if (!isAbsentDaemon(error)) {
        return failureFor(error);
      }
      if (deps.now() >= deadline) {
        break;
      }
      await new Promise<void>((resolve) => {
        setTimeout(resolve, RETRY_INTERVAL_MS);
      });
    }
  }
  return {
    exitCode: 1,
    stdout: "TOOL_TIMEOUT\n",
    stderr: `${ERROR_CATALOGUE.TOOL_TIMEOUT.reason}\n`,
  };
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

async function runMcp(deps: ResolvedDeps, stateDir: string): Promise<CliResult> {
  if (deps.runtimeInput === undefined) {
    // No host configuration reached the CLI; inventing image, workload, or workspace
    // would be fabrication, so the command refuses with the catalogue code.
    return failureFor(new RealmError("SCHEMA_INVALID"));
  }
  const request: McpHandleRequest = {
    env: deps.env,
    stateDir,
    runtimeInput: deps.runtimeInput,
    policyPath: deps.policyPath ?? defaultPolicyPath(stateDir),
    sessionId: deps.sessionId ?? "mcp",
  };
  let handle: CliDaemonHandle;
  try {
    handle = await deps.buildHandle(request);
  } catch (error) {
    return failureFor(error);
  }
  // P6-D9, P6-D12: serve the Phase 5 server from the shared handle; stdout carries only
  // MCP messages, diagnostics go to stderr, and stdin close shuts the server down.
  const server = createMcpServer(handle.dispatcher, deps.mcpInput, deps.mcpOutput, deps.mcpDiagnostics);
  await server.closed;
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
    now: deps.now ?? Date.now,
    spawn: deps.spawn ?? defaultSpawnDaemon,
    send: deps.send ?? defaultSend,
    runCommand: deps.runCommand ?? defaultRunCommand,
    connectSocket: deps.connectSocket ?? defaultConnectSocket,
    buildHandle: deps.buildHandle ?? defaultBuildHandle,
    runtimeInput: deps.runtimeInput,
    policyPath: deps.policyPath,
    sessionId: deps.sessionId,
    mcpInput: deps.mcpInput ?? (process.stdin as unknown as McpInput),
    mcpOutput: deps.mcpOutput ?? (process.stdout as unknown as McpOutput),
    mcpDiagnostics: deps.mcpDiagnostics ?? (process.stderr as unknown as McpOutput),
  };
  const socketPath = controlSocketPath(stateDir);
  switch (command) {
    case "up": {
      const workspaceRoot = parsed.workspace ?? deps.cwd ?? process.cwd();
      // Absolute POSIX path by string operations: node:path is outside the P6-D7 allowlist.
      if (!workspaceRoot.startsWith("/")) {
        return {
          exitCode: 2,
          stdout: "",
          stderr: "realm up: the workspace root must be an absolute path (use --workspace <path>)\n",
        };
      }
      return runUp(resolved, socketPath, workspaceRoot);
    }
    case "down":
      return runDown(resolved, socketPath);
    case "status":
      return runStatus(resolved, socketPath);
    case "doctor":
      return runDoctor(resolved, stateDir, socketPath);
    case "mcp":
      return runMcp(resolved, stateDir);
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

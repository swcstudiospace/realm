// MCP smoke test. Spawns the built `realm mcp` over stdio in an isolated runtime config, then runs
// initialize, tools/list and tools/call status. The status tool's snapshot and display must match what
// `realm status` prints for the same runtime. Run `npm run build` first; check:mcp does not build.

import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CLI = join(ROOT, "dist", "src", "cli", "main.js");
const REPLY_TIMEOUT_MS = 30000;
// realm mcp waits up to the 60 s up bound for a daemon before it refuses, so a session needs more than REPLY_TIMEOUT_MS.
const SESSION_TIMEOUT_MS = 120000;

export function frameFor(id, method, params) {
  return `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`;
}

// Parses newline-delimited JSON replies; anything that is not one JSON object is a failure.
export function parseReplies(text) {
  return text
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => {
      const value = JSON.parse(line);
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new Error(`MCP reply is not an object: ${line}`);
      }
      return value;
    });
}

// Builds the status comparison: the MCP tool result must carry the same snapshot and display as the CLI
// status JSON. When no daemon answers, the CLI prints "disconnected" and MCP must refuse with REALM_NOT_ACTIVE.
export function compareStatus(cliStdout, mcpResult) {
  const trimmed = cliStdout.trim();
  if (trimmed === "disconnected") {
    if (mcpResult.isError === true && mcpResult.structuredContent?.code === "REALM_NOT_ACTIVE") {
      return { ok: true, mode: "disconnected" };
    }
    if (mcpResult.outcome === "refused" && mcpResult.code === "REALM_NOT_ACTIVE") {
      return { ok: true, mode: "disconnected" };
    }
    return { ok: false, reason: "CLI reports disconnected but MCP status did not refuse with REALM_NOT_ACTIVE" };
  }
  const cli = JSON.parse(trimmed);
  if (mcpResult.outcome !== "done" || mcpResult.tool !== "status") {
    return { ok: false, reason: "MCP status did not return a done status outcome" };
  }
  const same =
    JSON.stringify(cli.snapshot) === JSON.stringify(mcpResult.value.snapshot) &&
    JSON.stringify(cli.display) === JSON.stringify(mcpResult.value.display);
  return same ? { ok: true, mode: "active" } : { ok: false, reason: "MCP status snapshot or display differs from realm status" };
}

function runCli(args, env, cwd) {
  return spawnSync(process.execPath, [CLI, ...args], { env, cwd, encoding: "utf8", timeout: REPLY_TIMEOUT_MS });
}

function writeRuntime(configHome, stateDir, workspaceRoot) {
  mkdirSync(join(configHome, "realm"), { recursive: true });
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(join(stateDir, "policy.json"), JSON.stringify({ workspaceRoots: [workspaceRoot] }));
  writeFileSync(
    join(configHome, "realm", "config.json"),
    JSON.stringify({
      image: `registry.example.com/realm/workload@sha256:${"0".repeat(64)}`,
      workloadArgv: ["/usr/bin/agent", "--serve"],
      stateDir,
      workspaceRoot,
    }),
  );
}

// Drives one MCP session: writes each request, closes stdin after the last reply, and resolves by id.
function session(env, cwd, workspaceRoot, requests) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [CLI, "mcp", "--workspace", workspaceRoot], {
      env,
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      rejectPromise(new Error("MCP session timed out"));
    }, SESSION_TIMEOUT_MS);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      rejectPromise(error);
    });
    child.on("close", () => {
      clearTimeout(timer);
      resolvePromise({ replies: parseReplies(stdout), stderr });
    });
    for (const [id, method, params] of requests) {
      child.stdin.write(frameFor(id, method, params));
    }
    child.stdin.end();
  });
}

function replyFor(replies, id) {
  const reply = replies.find((candidate) => candidate.id === id);
  if (reply === undefined) {
    throw new Error(`no MCP reply for id ${String(id)}`);
  }
  return reply;
}

async function main() {
  const scratch = mkdtempSync(join(tmpdir(), "realm-mcp-smoke-"));
  const configHome = join(scratch, "config");
  const stateDir = join(scratch, "state");
  const workspaceRoot = join(scratch, "workspace");
  const env = { PATH: process.env.PATH ?? "/usr/bin", HOME: scratch, XDG_CONFIG_HOME: configHome, XDG_RUNTIME_DIR: scratch };
  try {
    mkdirSync(workspaceRoot);
    writeRuntime(configHome, stateDir, workspaceRoot);
    const { replies, stderr } = await session(env, scratch, workspaceRoot, [
      [1, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "mcp-smoke", version: "0" } }],
      [2, "tools/list", {}],
      [3, "tools/call", { name: "status", arguments: {} }],
    ]);
    if (!replies.some((reply) => reply.id === 1)) {
      // Fail-closed attach: realm mcp exits before serving when no daemon can start. Accept only that outcome,
      // with a catalogue code on stderr and realm status reporting disconnected.
      const code = /^([A-Z][A-Z_]+):/m.exec(stderr)?.[1];
      const cliStatus = runCli(["status"], env, scratch);
      if (code === undefined || cliStatus.stdout.trim() !== "disconnected") {
        throw new Error(`MCP session produced no reply and no fail-closed attach refusal: ${stderr.trim()}`);
      }
      process.stdout.write(`mcp smoke: realm mcp refused attach fail-closed (${code}); realm status disconnected\n`);
      return;
    }
    const init = replyFor(replies, 1);
    if (init.result?.serverInfo?.name === undefined) {
      throw new Error("initialize reply carries no serverInfo");
    }
    const tools = replyFor(replies, 2).result?.tools;
    if (!Array.isArray(tools) || !tools.some((tool) => tool.name === "status")) {
      throw new Error("tools/list does not include status");
    }
    const statusCall = replyFor(replies, 3).result;
    if (statusCall === undefined) {
      throw new Error(`tools/call status returned an error: ${stderr}`);
    }
    const cli = runCli(["status"], env, scratch);
    if (cli.status !== 0 && cli.stdout.trim() !== "disconnected") {
      throw new Error(`realm status exited ${String(cli.status)}: ${cli.stderr}`);
    }
    const parity = compareStatus(cli.stdout, statusCall);
    if (!parity.ok) {
      throw new Error(parity.reason);
    }
    process.stdout.write(`mcp smoke: initialize, tools/list, tools/call status ok; parity ${parity.mode}\n`);
  } finally {
    // A daemon started by realm mcp outlives the session; stop it with the same runtime before removing it.
    runCli(["down"], env, scratch);
    rmSync(scratch, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`mcp smoke failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

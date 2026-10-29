// MCP smoke test. Spawns the built `realm mcp` over stdio in an isolated runtime config and drives one dual-era
// session: a legacy `initialize` handshake with tools/list and tools/call status, then the same calls as modern
// requests (protocol version in _meta) and a request naming an unsupported version. The result shapes must match
// the revision each era names (src/mcp/protocol.ts), and the status tool's snapshot and display must match what
// `realm status` prints for the same runtime. Run `npm run build` first; check:mcp does not build.

import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

// Builds the status comparison: the MCP tool result must carry the same snapshot and display as the CLI status
// JSON. The result is an MCP tool result: structuredContent is the dispatcher outcome, and a refusal sets isError.
// When no daemon answers, the CLI prints "disconnected" and MCP must refuse with REALM_NOT_ACTIVE.
export function compareStatus(cliStdout, mcpResult) {
  const outcome = mcpResult.structuredContent;
  const trimmed = cliStdout.trim();
  if (trimmed === "disconnected") {
    // A refusal is a RealmError ({ code }) or a refused outcome ({ outcome: "refused", code }); both set isError.
    if (mcpResult.isError === true && outcome?.code === "REALM_NOT_ACTIVE") {
      return { ok: true, mode: "disconnected" };
    }
    return { ok: false, reason: "CLI reports disconnected but MCP status did not refuse with REALM_NOT_ACTIVE" };
  }
  const cli = JSON.parse(trimmed);
  if (mcpResult.isError === true || outcome?.outcome !== "done" || outcome.tool !== "status") {
    return { ok: false, reason: "MCP status did not return a done status outcome" };
  }
  const same =
    JSON.stringify(cli.snapshot) === JSON.stringify(outcome.value.snapshot) &&
    JSON.stringify(cli.display) === JSON.stringify(outcome.value.display);
  return same ? { ok: true, mode: "active" } : { ok: false, reason: "MCP status snapshot or display differs from realm status" };
}

export const MODERN_VERSION = "2026-07-28";
export const LEGACY_VERSION = "2025-06-18";
const META_VERSION_KEY = "io.modelcontextprotocol/protocolVersion";
const UNSUPPORTED_VERSION_CODE = -32022;

function expect(condition, message) {
  if (!condition) {
    throw new Error(`mcp smoke: ${message}`);
  }
}

function isTextToolResult(result) {
  return Array.isArray(result?.content) && result.content[0]?.type === "text" && typeof result.content[0].text === "string";
}

// Checks the protocol shapes of one session as main() sends it (ids 1 to 7). Throws on the first violation.
// expectedVersion is the package version: both agent surfaces must advertise it, not a placeholder.
export function checkEras(replies, expectedVersion) {
  const result = (id) => {
    const reply = replies.find((candidate) => candidate.id === id);
    expect(reply !== undefined, `no reply for id ${String(id)}`);
    return reply.result;
  };
  // Legacy: the handshake answers the requested revision, and no result carries resultType.
  const init = result(1);
  expect(init?.protocolVersion === LEGACY_VERSION, `initialize must answer ${LEGACY_VERSION}, got ${String(init?.protocolVersion)}`);
  expect(init.serverInfo?.version === expectedVersion, `initialize serverInfo.version must be ${expectedVersion}, got ${String(init.serverInfo?.version)}`);
  const legacyList = result(2);
  expect(Array.isArray(legacyList?.tools) && legacyList.tools.some((tool) => tool.name === "status"), "legacy tools/list must include status");
  expect(legacyList.resultType === undefined, "a legacy result carries no resultType");
  const legacyCall = result(3);
  expect(isTextToolResult(legacyCall) && legacyCall.structuredContent !== undefined, "legacy tools/call needs a text content block and structuredContent");
  expect(legacyCall.resultType === undefined, "a legacy tool result carries no resultType");
  // Modern: resultType on every result, the cache hints the schema requires, and content for the model.
  const discover = result(4);
  expect(discover?.resultType === "complete", "server/discover result needs resultType complete");
  expect(Array.isArray(discover.supportedVersions) && discover.supportedVersions.includes(MODERN_VERSION) && discover.supportedVersions.includes(LEGACY_VERSION), "server/discover must list the modern and the legacy versions");
  expect(typeof discover.ttlMs === "number" && discover.cacheScope === "public", "server/discover needs ttlMs and cacheScope");
  expect(discover._meta?.["io.modelcontextprotocol/serverInfo"]?.version === expectedVersion, "server/discover serverInfo must carry the package version");
  const modernList = result(5);
  expect(modernList?.resultType === "complete" && typeof modernList.ttlMs === "number" && modernList.cacheScope === "public", "modern tools/list needs resultType, ttlMs and cacheScope");
  expect(Array.isArray(modernList.tools) && modernList.tools.length === legacyList.tools.length, "both eras list the same tools");
  const modernCall = result(6);
  expect(modernCall?.resultType === "complete" && isTextToolResult(modernCall) && modernCall.structuredContent !== undefined, "modern tools/call needs resultType, a text content block and structuredContent");
  // An unsupported version is a protocol error that lists what the server serves.
  const rejected = replies.find((candidate) => candidate.id === 7);
  expect(rejected?.error?.code === UNSUPPORTED_VERSION_CODE, "an unsupported protocol version must answer -32022");
  expect(Array.isArray(rejected.error.data?.supported) && rejected.error.data.supported.includes(MODERN_VERSION) && rejected.error.data.requested === "1900-01-01", "the -32022 error must list the supported versions and echo the requested one");
  return { legacyCall, modernCall };
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

async function main() {
  const scratch = mkdtempSync(join(tmpdir(), "realm-mcp-smoke-"));
  const configHome = join(scratch, "config");
  const stateDir = join(scratch, "state");
  const workspaceRoot = join(scratch, "workspace");
  const env = { PATH: process.env.PATH ?? "/usr/bin", HOME: scratch, XDG_CONFIG_HOME: configHome, XDG_RUNTIME_DIR: scratch };
  try {
    mkdirSync(workspaceRoot);
    writeRuntime(configHome, stateDir, workspaceRoot);
    const modernMeta = { [META_VERSION_KEY]: MODERN_VERSION };
    const { replies, stderr } = await session(env, scratch, workspaceRoot, [
      [1, "initialize", { protocolVersion: LEGACY_VERSION, capabilities: {}, clientInfo: { name: "mcp-smoke", version: "0" } }],
      [2, "tools/list", {}],
      [3, "tools/call", { name: "status", arguments: {} }],
      [4, "server/discover", { _meta: modernMeta }],
      [5, "tools/list", { _meta: modernMeta }],
      [6, "tools/call", { name: "status", arguments: {}, _meta: modernMeta }],
      [7, "tools/list", { _meta: { [META_VERSION_KEY]: "1900-01-01" } }],
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
    const packageVersion = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;
    const { legacyCall, modernCall } = checkEras(replies, packageVersion);
    const cli = runCli(["status"], env, scratch);
    if (cli.status !== 0 && cli.stdout.trim() !== "disconnected") {
      throw new Error(`realm status exited ${String(cli.status)}: ${cli.stderr}`);
    }
    for (const [era, call] of [["legacy", legacyCall], ["modern", modernCall]]) {
      const parity = compareStatus(cli.stdout, call);
      if (!parity.ok) {
        throw new Error(`${era}: ${parity.reason}`);
      }
    }
    process.stdout.write(`mcp smoke: legacy and modern sessions ok (${packageVersion}); status parity with realm status\n`);
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

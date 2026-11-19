// Session helpers of the production-stack boot rehearsals (BOOTP-01; decisions D-31-02 to D-31-05 of phase 31).
//
// A host that can boot Realm without a model credential is driven as a session: Codex's `codex exec` starts the registered MCP
// servers before its first model request (31-CONTEXT E-31-4), so a loopback provider that refuses every request is enough to make it
// launch `realm mcp --host codex` and list its tools. This module holds the pieces of that drive and of the evidence of it:
//   - the refusing loopback provider and the Codex argument list that points `codex exec` at it
//   - the wire recorder: a `realm` shim that forwards the host's stdio to the real server byte for byte and logs only JSON-RPC
//     method names and, for the `tools/list` response, tool names (never parameters, results, headers, paths or content), plus, since
//     phase 47, a millisecond mark on every line, the error flag and numeric code of a response (never its message), the `_meta` flag of
//     a request (never its content) and lifecycle lines (child start and exit, the host closing its end, a signal)
//   - a fake MCP stdio server for the validator-tier session test and the hermetic tests, and the readers of both logs
//   - runHostUntil: the process-group runner that waits for a condition instead of an exit (a Codex session never exits by itself)
//
// Nothing here reads the process environment or starts a process at import time. The hermetic test of every helper is
// test/integration/host-live-session-helpers.test.ts, which always runs: no host CLI, no Podman, no network beyond loopback.
//
// Exports (the live files and the hermetic test import exactly these names):
//   REALM_TOOL_NAMES, SESSION_PROMPT, CODEX_FORWARDED_ENV     the six Realm tool names, the fixed prompt, the three forwarded names
//   startRefusingProvider, isLoopbackPeer                      the 503 loopback provider and the peer check
//   codexSessionArgs                                           the `codex exec` argument list
//   writeFakeMcpServer, readFakeServerLog, withoutShellNames   the fake MCP server (optionally digesting named env values), the reader of
//                                                              its log, the shell-added-name filter
//   writeWireRecorder, readWireLog, wireSummary                the recorder shim, the reader of its log, and the summary of it (the
//                                                              timeline reader is readWireTimeline in wire-timeline.ts)
//   runHostUntil                                               the bounded process-group runner that waits for a condition

import { spawn, type ChildProcessByStdio } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { isAbsolute, join } from "node:path";
import type { Readable } from "node:stream";
import { Capture, GROUP_KILL_GRACE_MS, PIPE_CLOSE_GRACE_MS, shellQuote, signalGroup, type HostRunResult } from "./host-live.js";
import { isRecord } from "./omp-live.js";

// ---- Constants -------------------------------------------------------------------------------------------------------------

// The six tools `realm mcp` lists (src/mcp/server.ts), sorted. A hermetic test compares this with MCP_TOOL_DESCRIPTORS.
export const REALM_TOOL_NAMES: readonly string[] = Object.freeze(["exec", "list", "read", "retry", "status", "write"]);

// The one fixed, harmless sentence a session sends. No model ever answers it.
export const SESSION_PROMPT = "Reply with the single word ready.";

// The names Codex is told to forward to the registered server on top of its own default HOME, LANG and PATH (E-31-5). The daemon
// needs the first two to find the account's runtime directory and the third to find the compute driver.
export const CODEX_FORWARDED_ENV: readonly string[] = Object.freeze(["XDG_RUNTIME_DIR", "XDG_CONFIG_HOME", "REALM_DRIVER_SOCKET"]);

// ---- The refusing loopback provider ----------------------------------------------------------------------------------------

export interface ProviderRequestRecord {
  readonly method: string;
  readonly path: string;
  // Whether an Authorization header was present. The value is never read into a record.
  readonly authorization: boolean;
  // Present only when the provider was started with an expected key and the request carried an Authorization header: whether the header
  // equals `Bearer <key>`. Neither the header nor the key is ever stored.
  readonly matchesKey?: boolean;
  readonly peer: string;
}

export interface RefusingProviderOptions {
  // The one fixed, non-secret key a host is allowed to send (Kimi Code, which needs a key variable to define a provider at all).
  readonly expectedKey?: string;
}

export interface RefusingProvider {
  // `http://127.0.0.1:PORT/v1`
  readonly baseUrl: string;
  // A copy of the records so far.
  readonly requests: () => ProviderRequestRecord[];
  readonly close: () => Promise<void>;
}

// True when `address` is a loopback peer address: IPv4 loopback, IPv6 loopback or the IPv4-mapped IPv6 form.
export function isLoopbackPeer(address: string): boolean {
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

// An HTTP server on 127.0.0.1 (ephemeral port) that answers every request, whatever the method or path, with a fixed 503 and an
// empty JSON body, and records the method, the path, whether an Authorization header was present and the peer address. It never
// records a header value or a body. With `expectedKey` it also records, per request that carried an Authorization header, whether the
// header equals `Bearer <key>` (a boolean; neither value is kept). The caller closes it.
export async function startRefusingProvider(options: RefusingProviderOptions = {}): Promise<RefusingProvider> {
  const records: ProviderRequestRecord[] = [];
  const expected = options.expectedKey === undefined ? undefined : `Bearer ${options.expectedKey}`;
  const server = createServer((request, response) => {
    const { authorization } = request.headers;
    records.push({
      method: request.method ?? "",
      path: request.url ?? "",
      authorization: authorization !== undefined,
      ...(expected === undefined || authorization === undefined ? {} : { matchesKey: authorization === expected }),
      peer: request.socket.remoteAddress ?? "",
    });
    request.resume();
    response.writeHead(503, { "Content-Type": "application/json", "Content-Length": "2", Connection: "close" });
    response.end("{}");
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    server.close();
    throw new Error("the refusing provider did not report a TCP address");
  }
  return {
    baseUrl: `http://127.0.0.1:${String(address.port)}/v1`,
    requests: () => [...records],
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
        server.closeAllConnections();
      }),
  };
}

// ---- The Codex argument list -----------------------------------------------------------------------------------------------

export interface CodexSessionOptions {
  // The provider's base URL (`RefusingProvider.baseUrl`).
  readonly baseUrl: string;
  // Whether to add the `mcp_servers.realm.env_vars` override (default true). False is the default-environment case.
  readonly forwardEnv?: boolean;
}

// The argument list of `codex`: a non-interactive session against a provider table that has no `env_key`, no `auth` and no bearer
// field, so Codex sends no credential. `-c` overrides write no file. The prompt is last.
export function codexSessionArgs(options: CodexSessionOptions): string[] {
  const provider = `model_providers.rehearsal={name="Realm rehearsal",base_url="${options.baseUrl}",wire_api="responses",request_max_retries=0,stream_max_retries=0}`;
  const args = ["exec", "--json", "--skip-git-repo-check", "-c", 'model_provider="rehearsal"', "-c", provider, "-c", 'model="rehearsal-model"'];
  if (options.forwardEnv !== false) {
    args.push("-c", `mcp_servers.realm.env_vars=[${CODEX_FORWARDED_ENV.map((name) => `"${name}"`).join(",")}]`);
  }
  args.push(SESSION_PROMPT);
  return args;
}

// ---- The fake MCP stdio server ---------------------------------------------------------------------------------------------

// The text of a Node script (builtins only) that speaks line-delimited JSON-RPC on stdio. `logFile` is fixed into it. `hashNames` are
// the environment names whose value the start line digests (a short hash, never the value).
function fakeServerSource(logFile: string, hashNames: readonly string[]): string {
  return [
    'import { createHash } from "node:crypto";',
    'import { appendFileSync } from "node:fs";',
    'import { basename } from "node:path";',
    'import { createInterface } from "node:readline";',
    "",
    `const LOG = ${JSON.stringify(logFile)};`,
    `const TOOLS = ${JSON.stringify(REALM_TOOL_NAMES)};`,
    `const HASH_NAMES = ${JSON.stringify(hashNames)};`,
    "const argv = process.argv.slice(2);",
    'const eofAt = argv.indexOf("--exit-on-eof");',
    "const eofCode = eofAt >= 0 ? Number(argv[eofAt + 1]) : 0;",
    'const toolsError = argv.includes("--tools-error");',
    'const note = (value) => { appendFileSync(LOG, JSON.stringify(value) + "\\n"); };',
    'const hashes = {};',
    'for (const name of HASH_NAMES) { const value = process.env[name]; if (value !== undefined) { hashes[name] = createHash("sha256").update(value).digest("hex").slice(0, 12); } }',
    'note({ event: "start", pid: process.pid, argv, env: Object.keys(process.env).sort(), cwd: basename(process.cwd()), ...(HASH_NAMES.length > 0 ? { hashes } : {}) });',
    'const write = (message) => { process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\\n"); };',
    "const resultOf = (message) => {",
    '  const params = message.params !== null && typeof message.params === "object" ? message.params : {};',
    "  switch (message.method) {",
    '    case "initialize":',
    '      return { protocolVersion: typeof params.protocolVersion === "string" ? params.protocolVersion : "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "fake-realm", version: "0.0.0" } };',
    '    case "server/discover":',
    '      return { resultType: "complete", supportedVersions: ["2026-07-28", "2025-11-25", "2025-06-18"], capabilities: { tools: {} }, _meta: { "io.modelcontextprotocol/serverInfo": { name: "fake-realm", version: "0.0.0" } }, ttlMs: 3600000, cacheScope: "public" };',
    '    case "tools/list":',
    '      return { tools: TOOLS.map((name) => ({ name, description: "FAKE-DESCRIPTION-MARKER " + name, inputSchema: { type: "object", properties: {} } })) };',
    "    default:",
    "      return {};",
    "  }",
    "};",
    'const rl = createInterface({ input: process.stdin });',
    'rl.on("line", (line) => {',
    "  let message;",
    "  try { message = JSON.parse(line); } catch { return; }",
    '  if (message === null || typeof message !== "object" || typeof message.method !== "string" || message.id === undefined || message.id === null) { return; }',
    '  if (toolsError && message.method === "tools/list") { write({ id: message.id, error: { code: -32000, message: "fake tools/list failure" } }); return; }',
    "  write({ id: message.id, result: resultOf(message) });",
    "});",
    'rl.on("close", () => { note({ event: "EOF" }); process.exitCode = eofCode; });',
    "",
  ].join("\n");
}

// Writes `<dir>/fake-mcp-server.mjs` (mode 0644) and returns its path. The script answers `initialize` (echoing the requested
// protocol version), `server/discover`, `tools/list` (the six Realm tool names, each with a description carrying the marker
// FAKE-DESCRIPTION-MARKER and an empty-object input schema) and any other request with an empty result, and ignores notifications. At
// start it appends one JSON line to `logFile`: its pid, its argv after the script name, the sorted NAMES of its environment
// variables (never values) and the basename of its working directory. With a non-empty `hashNames` the line also holds `hashes`: for
// each listed name present in its environment, the first 12 hex characters of the SHA-256 of the value, and never the value (a
// 48-bit prefix classifies a few known candidates; it is no means to recover a value). With no list the line is unchanged. It appends an
// EOF line when stdin ends and exits 0, or with the code that follows an `--exit-on-eof` argument. A `--tools-error` argument makes its
// `tools/list` answer a JSON-RPC error.
export function writeFakeMcpServer(dir: string, logFile: string, options: { readonly hashNames?: readonly string[] } = {}): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "fake-mcp-server.mjs");
  writeFileSync(path, fakeServerSource(logFile, options.hashNames ?? []));
  chmodSync(path, 0o644);
  return path;
}

export interface FakeServerStart {
  readonly pid: number;
  readonly argv: readonly string[];
  // Sorted names of the environment variables the server was started with.
  readonly env: readonly string[];
  readonly cwd: string;
  // Present only for a server written with `hashNames`: the 12 hex character digest of each listed name's value that was present.
  readonly hashes?: Readonly<Record<string, string>>;
}

// The `hashes` member of a start line: names to 12 hex character digests; undefined for any other shape.
function hashesOf(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const hashes: Record<string, string> = {};
  for (const [name, digest] of Object.entries(value)) {
    if (typeof digest !== "string" || !/^[0-9a-f]{12}$/.test(digest)) {
      return undefined;
    }
    hashes[name] = digest;
  }
  return hashes;
}

export interface FakeServerLog {
  readonly starts: readonly FakeServerStart[];
  readonly eofCount: number;
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const items = value as unknown[];
  return items.every((item) => typeof item === "string") ? items : undefined;
}

// The start and EOF lines a fake server wrote. A missing file is an empty log; a malformed line is skipped.
export function readFakeServerLog(file: string): FakeServerLog {
  const starts: FakeServerStart[] = [];
  let eofCount = 0;
  if (!existsSync(file)) {
    return { starts, eofCount };
  }
  for (const line of readFileSync(file, "utf8").split("\n")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isRecord(parsed)) {
      continue;
    }
    if (parsed["event"] === "EOF") {
      eofCount += 1;
    } else if (parsed["event"] === "start") {
      const argv = stringArray(parsed["argv"]);
      const env = stringArray(parsed["env"]);
      const { pid, cwd } = parsed;
      const hashes = hashesOf(parsed["hashes"]);
      if (argv !== undefined && env !== undefined && typeof pid === "number" && typeof cwd === "string") {
        starts.push({ pid, argv, env, cwd, ...(hashes === undefined ? {} : { hashes }) });
      }
    }
  }
  return { starts, eofCount };
}

// The names a POSIX shell adds to the environment of a program it execs: a `#!/bin/sh` shim between Codex and the server exports PWD
// (dash) or PWD, OLDPWD, SHLVL and `_` (bash). They are not names the host forwarded, so a test of the forwarded set removes them.
const SHELL_ADDED_NAMES: readonly string[] = ["PWD", "OLDPWD", "SHLVL", "_"];

export function withoutShellNames(names: readonly string[]): string[] {
  return names.filter((name) => !SHELL_ADDED_NAMES.includes(name));
}

// ---- The wire recorder -----------------------------------------------------------------------------------------------------

export interface WireRecorderOptions {
  // The Node executable that runs the tee script.
  readonly nodePath: string;
  // The target argv prefix: the program and its leading arguments (production: node and the compiled CLI; validator: node and the
  // fake server). The arguments the host passes to the shim follow it.
  readonly target: readonly string[];
  // Where the tee appends its log, one JSON line per message.
  readonly logFile: string;
  // Environment variables to give the target when the host did not forward them (name to value). The tee adds every pair whose name is
  // absent from its own environment and logs the sorted NAMES it added, never a value. The pairs are written to a file of mode 0600
  // next to the tee, never to an argument. A name the host did forward keeps the host's value.
  readonly restoreEnv?: Readonly<Record<string, string>>;
  // An absolute path the target's stderr is copied to (created with mode 0600 and appended to) while it is still forwarded to the tee's
  // own stderr. Absent: the target's stderr is inherited and nothing is copied. The path is written into the tee script, never an
  // argument, and adds no file to the recorder directory unless the caller names one there.
  readonly stderrFile?: string;
}

// The text of the tee: spawns `target + received arguments` with stdin and stdout piped and stderr inherited (or piped, when `stderrFile`
// names a copy), forwards the host's stdin to the child and the child's stdout to the host byte for byte (`pipe`), and reads a
// line-buffered COPY of each direction to write the log. Every log line carries `t`, an integer millisecond mark from the tee's start
// (monotonic, non-decreasing in file order). A wire line holds the direction, the kind, the method name, the request id and, on the
// response to `tools/list`, the tool names; on a response the `error` flag and the numeric `errorCode` of a JSON-RPC error (never its
// message); on a request the `meta` flag (a `_meta` member was present, never its content); on a host line that is not a JSON-RPC 2.0
// message object the `invalid` flag. Lifecycle lines (`kind` "lifecycle") mark the child starting (`child-start`), the host closing its
// end (`host-stdin-end`), a signal the tee received (`host-signal`, logged before it is forwarded) and the child exiting (`child-exit`
// with its code or signal). Parameters, results, headers, paths and content are never copied. A log write error is swallowed, after the
// forward. The old reader readWireLog skips lifecycle lines and the new fields.
function teeSource(prefixLength: number, restore: boolean, stderrFile: string | undefined): string {
  return [
    'import { spawn } from "node:child_process";',
    restore ? 'import { appendFileSync, readFileSync } from "node:fs";' : 'import { appendFileSync } from "node:fs";',
    'import { constants } from "node:os";',
    ...(restore ? ['import { fileURLToPath } from "node:url";'] : []),
    "",
    `const PREFIX = ${String(prefixLength)};`,
    "const LINE_LIMIT = 1048576;",
    "const argv = process.argv.slice(2);",
    "const logFile = argv[0];",
    "const target = argv.slice(1, 1 + PREFIX);",
    "const extra = argv.slice(1 + PREFIX);",
    "const pendingLists = new Set();",
    'const record = (entry) => { try { appendFileSync(logFile, JSON.stringify({ t: Math.round(performance.now()), ...entry }) + "\\n"); } catch { /* the log never blocks the forward */ } };',
    "const toolNamesOf = (message) => {",
    "  const result = message.result;",
    '  if (result === null || typeof result !== "object" || !Array.isArray(result.tools)) { return undefined; }',
    '  return result.tools.map((tool) => (tool !== null && typeof tool === "object" && typeof tool.name === "string" ? tool.name : undefined)).filter((name) => name !== undefined);',
    "};",
    "const scan = (dir, line) => {",
    "  let message;",
    '  try { message = JSON.parse(line); } catch { record(dir === "host-to-realm" ? { dir, kind: "other", invalid: true } : { dir, kind: "other" }); return; }',
    '  if (message === null || typeof message !== "object" || Array.isArray(message)) { record(dir === "host-to-realm" ? { dir, kind: "other", invalid: true } : { dir, kind: "other" }); return; }',
    '  const id = typeof message.id === "string" || typeof message.id === "number" ? message.id : undefined;',
    "  const entry = { dir };",
    '  if (dir === "host-to-realm" && message.jsonrpc !== "2.0") { entry.invalid = true; }',
    '  if (typeof message.method === "string") {',
    '    entry.kind = id === undefined ? "notification" : "request";',
    "    entry.method = message.method;",
    "    if (id !== undefined) { entry.id = id; }",
    '    if (id !== undefined && message.params !== null && typeof message.params === "object" && "_meta" in message.params) { entry.meta = true; }',
    '    if (id !== undefined && dir === "host-to-realm" && message.method === "tools/list") { pendingLists.add(JSON.stringify(id)); }',
    '  } else if (id !== undefined && ("result" in message || "error" in message)) {',
    '    entry.kind = "response";',
    "    entry.id = id;",
    '    if ("error" in message) {',
    "      entry.error = true;",
    '      const code = message.error !== null && typeof message.error === "object" ? message.error.code : undefined;',
    '      if (typeof code === "number") { entry.errorCode = code; }',
    "    }",
    '    if (dir === "realm-to-host" && pendingLists.delete(JSON.stringify(id))) {',
    "      const names = toolNamesOf(message);",
    "      if (names !== undefined) { entry.toolNames = names; }",
    "    }",
    "  } else {",
    '    entry.kind = "other";',
    "  }",
    "  record(entry);",
    "};",
    "const tap = (dir) => {",
    "  let rest = Buffer.alloc(0);",
    "  return (chunk) => {",
    "    rest = Buffer.concat([rest, chunk]);",
    "    let at = rest.indexOf(10);",
    "    while (at >= 0) {",
    '      const line = rest.subarray(0, at).toString("utf8");',
    "      rest = rest.subarray(at + 1);",
    '      if (line.trim() !== "") { scan(dir, line); }',
    "      at = rest.indexOf(10);",
    "    }",
    "    if (rest.length > LINE_LIMIT) { rest = Buffer.alloc(0); }",
    "  };",
    "};",
    "",
    ...(restore
      ? [
          "const childEnv = { ...process.env };",
          "const restored = [];",
          "try {",
          '  const pairs = JSON.parse(readFileSync(fileURLToPath(new URL("wire-restore.json", import.meta.url)), "utf8"));',
          "  for (const name of Object.keys(pairs)) {",
          "    if (!(name in process.env)) { childEnv[name] = pairs[name]; restored.push(name); }",
          "  }",
          "} catch { /* a missing or unreadable pair file restores nothing */ }",
          'record({ dir: "host-to-realm", kind: "other", restored: restored.sort() });',
        ]
      : []),
    `const child = spawn(target[0], [...target.slice(1), ...extra], { stdio: ["pipe", "pipe", ${stderrFile === undefined ? '"inherit"' : '"pipe"'}]${restore ? ", env: childEnv" : ""} });`,
    'child.on("spawn", () => { record({ kind: "lifecycle", event: "child-start" }); });',
    'child.on("exit", (code, signal) => { record({ kind: "lifecycle", event: "child-exit", code, signal }); });',
    ...(stderrFile === undefined
      ? []
      : [
          `const STDERR_FILE = ${JSON.stringify(stderrFile)};`,
          'process.stderr.on("error", () => {});',
          'child.stderr.on("data", (chunk) => { process.stderr.write(chunk); try { appendFileSync(STDERR_FILE, chunk); } catch { /* the copy never blocks the forward */ } });',
        ]),
    'child.on("error", (error) => { process.stderr.write("wire-tee: cannot start the target: " + error.message + "\\n"); process.exit(127); });',
    'child.stdin.on("error", () => {});',
    'process.stdout.on("error", () => {});',
    'process.stdin.on("end", () => { record({ kind: "lifecycle", event: "host-stdin-end" }); });',
    "process.stdin.pipe(child.stdin);",
    'process.stdin.on("data", tap("host-to-realm"));',
    "child.stdout.pipe(process.stdout);",
    'child.stdout.on("data", tap("realm-to-host"));',
    'for (const signal of ["SIGTERM", "SIGINT"]) { process.on(signal, () => { record({ kind: "lifecycle", event: "host-signal", signal }); child.kill(signal); }); }',
    'child.on("close", (code, signal) => {',
    "  process.exitCode = code !== null ? code : 128 + (signal === null ? 0 : (constants.signals[signal] ?? 0));",
    '  process.stdout.write("", () => { process.exit(); });',
    "});",
    "",
  ].join("\n");
}

function isRestorePair(name: string, value: unknown): boolean {
  return name !== "" && !name.includes("=") && typeof value === "string";
}

// Writes `<dir>/realm` (mode 0755, a POSIX sh script: a shebang, then `exec` of the Node path, the tee script, the log path and the
// target argv prefix, each shell-quoted, then "$@") and `<dir>/wire-tee.mjs` (mode 0644). Returns the shim path. The shim forwards
// bytes, EOF, the child's exit code (or 128 plus its signal number) and SIGTERM and SIGINT; it only reads a copy of the stream. With
// `stderrFile` the file is created here (mode 0600) and the tee appends the target's stderr to it.
export function writeWireRecorder(dir: string, options: WireRecorderOptions): string {
  const restore = options.restoreEnv;
  if (restore !== undefined) {
    for (const [name, value] of Object.entries(restore)) {
      if (!isRestorePair(name, value)) {
        throw new Error("restoreEnv holds a pair that is not a non-empty name without an equals sign and a string value; nothing was written");
      }
    }
  }
  const { stderrFile } = options;
  if (stderrFile !== undefined && !isAbsolute(stderrFile)) {
    throw new Error("stderrFile must be an absolute path; nothing was written");
  }
  mkdirSync(dir, { recursive: true });
  if (stderrFile !== undefined) {
    writeFileSync(stderrFile, "", { mode: 0o600, flag: "a" });
    chmodSync(stderrFile, 0o600);
  }
  if (restore !== undefined) {
    const pairsFile = join(dir, "wire-restore.json");
    writeFileSync(pairsFile, JSON.stringify(restore), { mode: 0o600 });
    chmodSync(pairsFile, 0o600);
  }
  const tee = join(dir, "wire-tee.mjs");
  writeFileSync(tee, teeSource(options.target.length, restore !== undefined, stderrFile));
  chmodSync(tee, 0o644);
  const shim = join(dir, "realm");
  const words = [options.nodePath, tee, options.logFile, ...options.target].map((word) => shellQuote(word)).join(" ");
  writeFileSync(shim, `#!/bin/sh\nexec ${words} "$@"\n`);
  chmodSync(shim, 0o755);
  return shim;
}

export interface WireEvent {
  readonly dir: "host-to-realm" | "realm-to-host";
  readonly kind: "request" | "notification" | "response" | "other";
  readonly method?: string;
  readonly id?: string | number;
  // On the response to `tools/list` only: the `name` of each listed tool, as the server sent them.
  readonly toolNames?: readonly string[];
  // On the one event a recorder with `restoreEnv` logs first: the sorted NAMES of the variables it restored (empty when none).
  readonly restored?: readonly string[];
}

const WIRE_DIRECTIONS: readonly string[] = ["host-to-realm", "realm-to-host"];
const WIRE_KINDS: readonly string[] = ["request", "notification", "response", "other"];

// The events a recorder logged, in order. A missing file is an empty list; a malformed or foreign line is skipped, never thrown.
export function readWireLog(file: string): WireEvent[] {
  if (!existsSync(file)) {
    return [];
  }
  const events: WireEvent[] = [];
  for (const line of readFileSync(file, "utf8").split("\n")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isRecord(parsed)) {
      continue;
    }
    const { dir, kind, method, id } = parsed;
    if (typeof dir !== "string" || !WIRE_DIRECTIONS.includes(dir) || typeof kind !== "string" || !WIRE_KINDS.includes(kind)) {
      continue;
    }
    const toolNames = stringArray(parsed["toolNames"]);
    const restored = stringArray(parsed["restored"]);
    events.push({
      dir: dir as WireEvent["dir"],
      kind: kind as WireEvent["kind"],
      ...(typeof method === "string" ? { method } : {}),
      ...(typeof id === "string" || typeof id === "number" ? { id } : {}),
      ...(toolNames === undefined ? {} : { toolNames }),
      ...(restored === undefined ? {} : { restored }),
    });
  }
  return events;
}

export interface WireSummary {
  // The methods the host sent, in order, each once at its first appearance.
  readonly hostMethods: readonly string[];
  // The tool names of the first `tools/list` response, sorted; empty when there was none.
  readonly toolNames: readonly string[];
  // True when a `tools/list` response with at least one tool name was logged.
  readonly answered: boolean;
  // The names the recorder restored into the target environment (the first event that logged them), sorted; empty when there was none.
  readonly restoredNames: readonly string[];
}

export function wireSummary(events: readonly WireEvent[]): WireSummary {
  const hostMethods: string[] = [];
  for (const event of events) {
    if (event.dir === "host-to-realm" && event.method !== undefined && !hostMethods.includes(event.method)) {
      hostMethods.push(event.method);
    }
  }
  const listed = events.find((event) => event.toolNames !== undefined)?.toolNames;
  const toolNames = listed === undefined ? [] : [...listed].sort();
  const restoredNames = [...(events.find((event) => event.restored !== undefined)?.restored ?? [])].sort();
  return { hostMethods, toolNames, answered: toolNames.length > 0, restoredNames };
}

// ---- The until-ready runner ------------------------------------------------------------------------------------------------

export type HostUntilEnd = "ready" | "exit" | "timeout";

export interface HostUntilOptions {
  // Polled every `pollMs`; true ends the run. A predicate that throws counts as false.
  readonly ready: () => Promise<boolean>;
  readonly timeoutMs: number;
  readonly pollMs: number;
}

export interface HostUntilResult extends HostRunResult {
  readonly endedBy: HostUntilEnd;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Like runHost, but the host is not expected to exit: it runs as the leader of its own process group until `ready` answers true, it
// exits on its own, or `timeoutMs` passes. Then the group gets SIGTERM, SIGKILL after 2 s, and a final SIGKILL sweep so nothing the
// host started outlives the call. `exitCode` is defined only when the host ended on its own. Never rejects.
export function runHostUntil(bin: string, args: readonly string[], env: Readonly<Record<string, string>>, cwd: string, options: HostUntilOptions): Promise<HostUntilResult> {
  return new Promise((resolveResult) => {
    let child: ChildProcessByStdio<null, Readable, Readable>;
    try {
      child = spawn(bin, [...args], { env: { ...env }, cwd, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      resolveResult({ exitCode: undefined, stdout: "", stderr: errorText(error), timedOut: false, endedBy: "exit" });
      return;
    }
    const stdout = new Capture();
    const stderr = new Capture();
    child.stdout.on("data", (chunk: Buffer) => {
      stdout.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr.push(chunk);
    });
    const { pid } = child;
    let endedBy: HostUntilEnd | undefined;
    let timedOut = false;
    let settled = false;
    let pollTimer: NodeJS.Timeout | undefined;
    let killTimer: NodeJS.Timeout | undefined;
    let hardTimer: NodeJS.Timeout | undefined;
    let exitTimer: NodeJS.Timeout | undefined;
    const finish = (exitCode: number | undefined, note?: string): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeoutTimer);
      clearTimeout(pollTimer);
      clearTimeout(killTimer);
      clearTimeout(hardTimer);
      clearTimeout(exitTimer);
      if (pid !== undefined) {
        signalGroup(pid, "SIGKILL");
      }
      resolveResult({ exitCode, stdout: stdout.text(), stderr: note === undefined ? stderr.text() : `${stderr.text()}${note}`, timedOut, endedBy: endedBy ?? "exit" });
    };
    const stop = (reason: HostUntilEnd): void => {
      if (endedBy !== undefined || pid === undefined) {
        return;
      }
      endedBy = reason;
      clearTimeout(pollTimer);
      clearTimeout(timeoutTimer);
      signalGroup(pid, "SIGTERM");
      killTimer = setTimeout(() => {
        signalGroup(pid, "SIGKILL");
        hardTimer = setTimeout(() => {
          finish(undefined);
        }, GROUP_KILL_GRACE_MS);
      }, GROUP_KILL_GRACE_MS);
    };
    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      stop("timeout");
    }, options.timeoutMs);
    const check = async (): Promise<void> => {
      let ready: boolean;
      try {
        ready = await options.ready();
      } catch {
        ready = false;
      }
      if (endedBy !== undefined || settled) {
        return;
      }
      if (ready) {
        stop("ready");
      } else {
        schedulePoll();
      }
    };
    const schedulePoll = (): void => {
      pollTimer = setTimeout(() => {
        void check();
      }, options.pollMs);
    };
    schedulePoll();
    child.on("error", (error) => {
      finish(undefined, errorText(error));
    });
    child.on("exit", (code) => {
      if (endedBy === undefined) {
        endedBy = "exit";
        clearTimeout(pollTimer);
        clearTimeout(timeoutTimer);
      }
      // The pipes normally close with the process; a grandchild that kept them open is not waited for beyond a short grace.
      exitTimer = setTimeout(() => {
        finish(endedBy === "exit" ? (code ?? undefined) : undefined);
      }, PIPE_CLOSE_GRACE_MS);
    });
    child.on("close", (code) => {
      finish(endedBy === "exit" ? (code ?? undefined) : undefined);
    });
  });
}

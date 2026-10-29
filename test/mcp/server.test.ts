import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PassThrough, Writable } from "node:stream";
import { STATUS_LABELS } from "../../src/core/status.js";
import { ERROR_CATALOGUE, makeRealmError, RealmError } from "../../src/core/errors.js";
import {
  createMcpServer,
  MCP_TOOL_DESCRIPTORS,
  type McpDispatcher,
} from "../../src/mcp/server.js";
import {
  MCP_MODERN_VERSION,
  MCP_SUPPORTED_VERSIONS,
  META_PROTOCOL_VERSION,
  UNSUPPORTED_PROTOCOL_VERSION,
} from "../../src/mcp/protocol.js";
import { makeHarness, WORKLOAD } from "../support/fake-tools.js";

// TOOL-05 MCP stdio server proof (P5-D2, P5-D9, P5-D11). Every test drives the real
// server over in-memory stdio streams against the real ToolDispatcher from makeHarness.
// The only fake is the OpenShell runner, which starts no process. Refusals are compared
// against ERROR_CATALOGUE, so the retryable flag is always the catalogue value.

function request(id: number, method: string, params: unknown): string {
  return JSON.stringify({ jsonrpc: "2.0", id, method, params });
}

function toolRequest(id: number, name: string, args: unknown): string {
  return request(id, "tools/call", { name, arguments: args });
}

interface DriveResult {
  readonly stdout: string;
  readonly stdoutLines: string[];
  readonly stderr: string;
}

async function drive(dispatcher: McpDispatcher, lines: readonly string[]): Promise<DriveResult> {
  const input = new PassThrough();
  const output = new PassThrough();
  const stderrChunks: string[] = [];
  const stderr = new Writable({
    write(chunk, _encoding, callback) {
      stderrChunks.push(String(chunk));
      callback();
    },
  });
  const server = createMcpServer(dispatcher, input, output, stderr);
  let stdout = "";
  output.on("data", (chunk) => {
    stdout += String(chunk);
  });
  for (const line of lines) {
    input.write(`${line}\n`);
  }
  input.end();
  await Promise.race([
    server.closed,
    new Promise<never>((_resolve, reject) => {
      setTimeout(() => { reject(new Error("mcp server did not close after stdin ended")); }, 2000).unref();
    }),
  ]);
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
  return {
    stdout,
    stdoutLines: stdout === "" ? [] : stdout.slice(0, -1).split("\n"),
    stderr: stderrChunks.join(""),
  };
}

function parseLine(line: string): Record<string, unknown> {
  const value: unknown = JSON.parse(line);
  assert.equal(typeof value, "object");
  assert.notEqual(value, null);
  return value as Record<string, unknown>;
}

function resultOf(line: string): unknown {
  const parsed = parseLine(line);
  assert.equal(parsed["jsonrpc"], "2.0");
  assert.ok("result" in parsed, "expected a result reply");
  return parsed["result"];
}

void test("TOOL-05: a well-formed request yields exactly one newline-terminated JSON-RPC message on stdout", async (t) => {
  const h = makeHarness(t);
  const driven = await drive(h.dispatcher, [request(1, "server/discover", {})]);
  assert.equal(driven.stdoutLines.length, 1);
  assert.ok(driven.stdout.endsWith("\n"), "the reply is newline-terminated");
  const parsed = parseLine(driven.stdoutLines[0] as string);
  assert.equal(parsed["jsonrpc"], "2.0");
  assert.equal(parsed["id"], 1);
  assert.ok("result" in parsed);
  assert.equal(driven.stderr, "", "a well-formed request logs nothing");
});

void test("TOOL-05: malformed input and server logging go to stderr, never stdout", async (t) => {
  const h = makeHarness(t);
  const malformed = await drive(h.dispatcher, ["{not json"]);
  assert.equal(malformed.stdout, "", "malformed input writes nothing to stdout");
  assert.deepEqual(malformed.stdoutLines, []);
  assert.match(malformed.stderr, /mcp: /, "the rejection is diagnosed on stderr");

  const mixed = await drive(h.dispatcher, ["{oops", request(2, "server/discover", {})]);
  assert.equal(mixed.stdoutLines.length, 1, "only the well-formed request replies");
  assert.equal(parseLine(mixed.stdoutLines[0] as string)["id"], 2);
  assert.match(mixed.stderr, /mcp: /, "the malformed fragment is still diagnosed on stderr");
});

void test("TOOL-05: closing stdin shuts the server down without hanging", async (t) => {
  const h = makeHarness(t);
  const input = new PassThrough();
  const output = new PassThrough();
  const stderr = new PassThrough();
  const server = createMcpServer(h.dispatcher, input, output, stderr);
  input.end();
  await Promise.race([
    server.closed,
    new Promise<never>((_resolve, reject) => {
      setTimeout(() => { reject(new Error("server hung after stdin closed")); }, 2000).unref();
    }),
  ]);
});

// ---- Protocol eras and result shapes (docs/integration/mcp.md, "Protocol eras and result shapes") ------------------------

const MODERN_META = { [META_PROTOCOL_VERSION]: MCP_MODERN_VERSION };
const CLIENT = { name: "test-client", version: "0" };
const TOOL_NAMES = ["exec", "read", "write", "list", "status", "retry"];

// The version the manifest declares, read here independently of the code under test (the release job rewrites it).
function manifestVersion(): string {
  const manifest: unknown = JSON.parse(readFileSync("package.json", "utf8"));
  assert.ok(typeof manifest === "object" && manifest !== null && "version" in manifest && typeof manifest.version === "string");
  return manifest.version;
}

function resultRecord(line: string | undefined): Record<string, unknown> {
  return resultOf(line as string) as Record<string, unknown>;
}

// The ToolOutcome inside a tools/call result.
function structuredOf(line: string | undefined): Record<string, unknown> {
  const outcome = resultRecord(line)["structuredContent"];
  assert.ok(typeof outcome === "object" && outcome !== null, "the result carries structuredContent");
  return outcome as Record<string, unknown>;
}

function errorOf(line: string | undefined): unknown {
  return parseLine(line as string)["error"];
}

// The names of the tools in a tools/list result.
function namesOf(list: Record<string, unknown>): string[] {
  const tools = list["tools"];
  assert.ok(Array.isArray(tools), "the result lists tools");
  return tools.map((tool: unknown) => {
    assert.ok(typeof tool === "object" && tool !== null && "name" in tool && typeof tool.name === "string");
    return tool.name;
  });
}

// The one text block of a tools/call result, which is what a host shows to the model.
function textOf(result: Record<string, unknown>): string {
  const content = result["content"];
  assert.ok(Array.isArray(content) && content.length === 1, "the result carries exactly one content block");
  const block: unknown = content[0];
  assert.ok(typeof block === "object" && block !== null && "type" in block && block.type === "text");
  assert.ok("text" in block && typeof block.text === "string");
  return block.text;
}

void test("TOOL-05: server/discover answers a DiscoverResult that lists both eras and carries the package version", async (t) => {
  const h = makeHarness(t);
  const driven = await drive(h.dispatcher, [request(1, "server/discover", { _meta: MODERN_META })]);
  assert.equal(driven.stdoutLines.length, 1);
  const result = resultRecord(driven.stdoutLines[0]);
  assert.equal(result["resultType"], "complete");
  assert.deepEqual(result["supportedVersions"], [...MCP_SUPPORTED_VERSIONS]);
  assert.deepEqual(result["supportedVersions"], ["2026-07-28", "2025-11-25", "2025-06-18"]);
  assert.deepEqual(result["capabilities"], { tools: {} });
  assert.equal(typeof result["ttlMs"], "number");
  assert.equal(result["cacheScope"], "public");
  assert.deepEqual(result["_meta"], {
    "io.modelcontextprotocol/serverInfo": { name: "agent-realm", version: manifestVersion() },
  });
  assert.equal(result["protocolVersion"], undefined, "the legacy field is not part of a DiscoverResult");
});

void test("TOOL-05: initialize answers the requested legacy revision, and the newest legacy one for any other request", async (t) => {
  const h = makeHarness(t);
  const asked = ["2025-06-18", "2025-11-25", "2024-11-05", "2026-07-28"];
  const driven = await drive(
    h.dispatcher,
    asked.map((protocolVersion, index) => request(index + 1, "initialize", { protocolVersion, capabilities: {}, clientInfo: CLIENT })),
  );
  assert.equal(driven.stdoutLines.length, asked.length);
  const answered = driven.stdoutLines.map((line) => resultRecord(line)["protocolVersion"]);
  assert.deepEqual(answered, ["2025-06-18", "2025-11-25", "2025-11-25", "2025-11-25"]);
  const first = resultRecord(driven.stdoutLines[0]);
  assert.deepEqual(first["capabilities"], { tools: {} });
  assert.deepEqual(first["serverInfo"], { name: "agent-realm", version: manifestVersion() });
  assert.equal(first["resultType"], undefined, "a legacy handshake answer carries no resultType");
});

void test("TOOL-05: initialize without a string protocolVersion is invalid params", async (t) => {
  const h = makeHarness(t);
  const driven = await drive(h.dispatcher, [request(1, "initialize", { capabilities: {} }), request(2, "initialize", "nope")]);
  assert.deepEqual(errorOf(driven.stdoutLines[0]), { code: -32602, message: "Invalid params" });
  assert.deepEqual(errorOf(driven.stdoutLines[1]), { code: -32602, message: "Invalid params" });
});

void test("TOOL-05: after an initialize handshake a request without modern _meta is served in the legacy shape", async (t) => {
  const h = makeHarness(t);
  const driven = await drive(h.dispatcher, [
    request(1, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: CLIENT }),
    request(2, "tools/list", {}),
    toolRequest(3, "status", {}),
    request(4, "ping", {}),
  ]);
  assert.equal(driven.stdoutLines.length, 4);
  const list = resultRecord(driven.stdoutLines[1]);
  assert.deepEqual(Object.keys(list), ["tools"], "a legacy tools/list result is just the tools");
  assert.deepEqual(namesOf(list), TOOL_NAMES);
  const call = resultRecord(driven.stdoutLines[2]);
  assert.equal(call["resultType"], undefined, "a legacy tool result carries no resultType");
  assert.equal(call["isError"], false);
  const outcome = structuredOf(driven.stdoutLines[2]);
  assert.equal(outcome["outcome"], "done");
  assert.equal(outcome["tool"], "status");
  assert.deepEqual(JSON.parse(textOf(call)), outcome, "the text block is the serialised outcome, which is what the model reads");
  assert.deepEqual(resultRecord(driven.stdoutLines[3]), {}, "the legacy revisions define ping");
});

void test("TOOL-05: a request that names the modern revision in _meta is served statelessly in the modern shape, even after a legacy handshake", async (t) => {
  const h = makeHarness(t);
  const driven = await drive(h.dispatcher, [
    request(1, "initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: CLIENT }),
    request(2, "tools/list", { _meta: MODERN_META }),
    request(3, "tools/call", { name: "status", arguments: {}, _meta: MODERN_META }),
    request(4, "ping", { _meta: MODERN_META }),
  ]);
  assert.equal(driven.stdoutLines.length, 4);
  const list = resultRecord(driven.stdoutLines[1]);
  assert.equal(list["resultType"], "complete");
  assert.equal(typeof list["ttlMs"], "number");
  assert.equal(list["cacheScope"], "public");
  assert.deepEqual(namesOf(list), TOOL_NAMES);
  const call = resultRecord(driven.stdoutLines[2]);
  assert.equal(call["resultType"], "complete");
  assert.equal(call["isError"], false);
  assert.equal(structuredOf(driven.stdoutLines[2])["outcome"], "done");
  assert.deepEqual(JSON.parse(textOf(call)), structuredOf(driven.stdoutLines[2]));
  assert.deepEqual(errorOf(driven.stdoutLines[3]), { code: -32601, message: "Method not found" }, "the modern schema has no ping");
});

void test("TOOL-05: a client that sends neither a handshake nor _meta is served in the server's own (modern) revision", async (t) => {
  const h = makeHarness(t);
  const driven = await drive(h.dispatcher, [request(1, "tools/list", {}), toolRequest(2, "status", {})]);
  assert.equal(resultRecord(driven.stdoutLines[0])["resultType"], "complete");
  assert.equal(resultRecord(driven.stdoutLines[1])["resultType"], "complete");
});

void test("TOOL-05: a request naming an unsupported protocol version answers -32022 with the versions the server serves", async (t) => {
  const h = makeHarness(t);
  const unsupported = { [META_PROTOCOL_VERSION]: "1900-01-01" };
  const driven = await drive(h.dispatcher, [
    request(1, "server/discover", { _meta: unsupported }),
    request(2, "tools/list", { _meta: unsupported }),
    request(3, "tools/call", { name: "status", arguments: {}, _meta: unsupported }),
  ]);
  assert.equal(driven.stdoutLines.length, 3);
  for (const line of driven.stdoutLines) {
    assert.deepEqual(errorOf(line), {
      code: UNSUPPORTED_PROTOCOL_VERSION,
      message: "Unsupported protocol version",
      data: { supported: [...MCP_SUPPORTED_VERSIONS], requested: "1900-01-01" },
    });
  }
  assert.equal(UNSUPPORTED_PROTOCOL_VERSION, -32022);
});

void test("TOOL-05: a protocol version in _meta that is not a string is invalid params", async (t) => {
  const h = makeHarness(t);
  const driven = await drive(h.dispatcher, [request(1, "tools/list", { _meta: { [META_PROTOCOL_VERSION]: 20260728 } })]);
  assert.deepEqual(errorOf(driven.stdoutLines[0]), { code: -32602, message: "Invalid params" });
});

void test("TOOL-05: the tool descriptors the server lists are the ones the module exports", async (t) => {
  const h = makeHarness(t);
  const driven = await drive(h.dispatcher, [request(1, "tools/list", {})]);
  assert.deepEqual(resultRecord(driven.stdoutLines[0])["tools"], JSON.parse(JSON.stringify(MCP_TOOL_DESCRIPTORS)));
});

void test("TOOL-05: each of the six tools routes to ToolDispatcher.call with the ToolCall map unchanged", async (t) => {
  const h = makeHarness(t);
  const seen: unknown[] = [];
  const spy: McpDispatcher = {
    call: (raw: unknown) => {
      seen.push(raw);
      return h.dispatcher.call(raw);
    },
  };
  const expected = [
    { exec: { argv: [...WORKLOAD] } },
    { read: { path: "doc.txt", maxBytes: 1024 } },
    { write: { path: "mcp-out.txt", content: "mcp" } },
    { list: { path: ".", depth: 1 } },
    { status: {} },
    { retry: {} },
  ];
  const lines = [
    request(0, "server/discover", {}),
    ...expected.map((call, index) => {
      const name = Object.keys(call)[0] as string;
      const args = (call as Record<string, unknown>)[name];
      return toolRequest(index + 1, name, args);
    }),
  ];
  const driven = await drive(spy, lines);
  assert.equal(driven.stdoutLines.length, lines.length, "every request takes exactly one reply");
  assert.deepEqual(seen, expected, "the ToolCall maps cross unchanged and in order");
  const replies = driven.stdoutLines.slice(1).map((line) => structuredOf(line));
  const tools = ["exec", "read", "write", "list", "status", "retry"];
  for (let index = 0; index < tools.length; index += 1) {
    assert.equal(replies[index]?.["outcome"], "done", `expected a done ${String(tools[index])}`);
    assert.equal(replies[index]?.["tool"], tools[index]);
  }
});

void test("TOOL-05: a dispatcher refusal surfaces the catalogue code in the reply envelope", async (t) => {
  const h = makeHarness(t);
  const driven = await drive(h.dispatcher, [toolRequest(1, "read", { path: "doc.txt" })]);
  assert.equal(driven.stdoutLines.length, 1);
  const refused = {
    outcome: "refused",
    tool: null,
    code: "SCHEMA_INVALID",
    retryable: ERROR_CATALOGUE["SCHEMA_INVALID"].retryable,
  };
  const result = resultRecord(driven.stdoutLines[0]);
  assert.deepEqual(result["structuredContent"], refused, "the dispatcher outcome crosses unchanged as structuredContent");
  assert.equal(result["isError"], true, "a refusal is a tool failure the model has to see");
  assert.equal(textOf(result), JSON.stringify(refused));
});

void test("TOOL-05: a RealmError thrown by the dispatcher reaches the client as a tool error result with its code and message (G-08)", async () => {
  const thrown = makeRealmError("OPENSHELL_START_FAILED", "PODMAN_MACHINE_DOWN");
  const dispatcher: McpDispatcher = { call: () => Promise.reject(thrown) };
  const driven = await drive(dispatcher, [toolRequest(1, "exec", { argv: ["true"] })]);
  assert.equal(driven.stdoutLines.length, 1);
  const body = parseLine(driven.stdoutLines[0] as string);
  assert.equal(body["error"], undefined, "a tool failure is a result, not a protocol error");
  const reason = ERROR_CATALOGUE["OPENSHELL_START_FAILED"].reason;
  assert.deepEqual(body["result"], {
    resultType: "complete",
    isError: true,
    content: [{ type: "text", text: `OPENSHELL_START_FAILED: ${reason}` }],
    structuredContent: {
      code: "OPENSHELL_START_FAILED",
      message: reason,
      retryable: ERROR_CATALOGUE["OPENSHELL_START_FAILED"].retryable,
      causeCode: "PODMAN_MACHINE_DOWN",
    },
  });
});

void test("TOOL-05: a thrown defect that is not a RealmError still answers the internal error without its message", async () => {
  const dispatcher: McpDispatcher = { call: () => Promise.reject(new Error("socket reset with secret text")) };
  const driven = await drive(dispatcher, [toolRequest(1, "status", {})]);
  assert.equal(driven.stdoutLines.length, 1);
  assert.deepEqual(parseLine(driven.stdoutLines[0] as string)["error"], { code: -32603, message: "Internal error" });
});

void test("TOOL-05: a thrown defect answers -32603 on the wire and records only the fixed tool-call diagnostic", async () => {
  const dispatcher: McpDispatcher = { call: () => Promise.reject(new Error("socket reset with secret text")) };
  const driven = await drive(dispatcher, [toolRequest(1, "status", {})]);
  assert.equal(driven.stdoutLines.length, 1);
  assert.deepEqual(parseLine(driven.stdoutLines[0] as string)["error"], { code: -32603, message: "Internal error" });
  assert.equal(driven.stderr, "mcp: tool call failed\n");
});

void test("TOOL-05: a failing input stream rejects closed with MCP_INPUT_FAILED and writes only the fixed diagnostic", async () => {
  const dispatcher: McpDispatcher = { call: () => Promise.reject(new Error("not reached")) };
  const input = new PassThrough();
  const output = new PassThrough();
  const stderrChunks: string[] = [];
  const stderr = new Writable({
    write(chunk, _encoding, callback) {
      stderrChunks.push(String(chunk));
      callback();
    },
  });
  const server = createMcpServer(dispatcher, input, output, stderr);
  input.destroy(new Error("read EIO with secret text"));
  await assert.rejects(server.closed, (error: unknown) => error instanceof RealmError && error.code === "MCP_INPUT_FAILED");
  assert.deepEqual(stderrChunks, ["mcp: input stream failed\n"]);
});

void test("TOOL-05: the surface calls no dispatcher member except call (P5-D11)", async (t) => {
  const h = makeHarness(t);
  const touched = new Set<string | symbol>();
  const recording = new Proxy(h.dispatcher, {
    get(target, property) {
      touched.add(property);
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
  const driven = await drive(recording, [
    toolRequest(1, "status", {}),
    toolRequest(2, "write", { path: "surface.txt", content: "via call" }),
  ]);
  assert.equal(driven.stdoutLines.length, 2, "two tool calls take two replies");
  assert.deepEqual([...touched].map(String), ["call"], "the surface touched no dispatcher member but call");
});

void test("TOOL-05: a stdio-client-shaped driver completes status and write calls end to end", async (t) => {
  const h = makeHarness(t);
  const statusCall = { status: {} };
  const writeCall = { write: { path: "e2e.txt", content: "hello" } };
  const expectedStatus = await h.dispatcher.call(statusCall);
  const expectedWrite = await h.dispatcher.call(writeCall);
  const driven = await drive(h.dispatcher, [
    request(1, "server/discover", {}),
    toolRequest(2, "status", {}),
    toolRequest(3, "write", { path: "e2e.txt", content: "hello" }),
  ]);
  assert.equal(driven.stdoutLines.length, 3, "probe plus two tool calls take three replies");
  assert.deepEqual(structuredOf(driven.stdoutLines[1]), expectedStatus);
  assert.deepEqual(structuredOf(driven.stdoutLines[2]), expectedWrite);
  assert.equal(readFileSync(join(h.ws, "e2e.txt"), "utf8"), "hello");
});

void test("TOOL-05: the status reply carries the shared displayStatus label, not a server-invented label", async (t) => {
  const h = makeHarness(t);
  const driven = await drive(h.dispatcher, [toolRequest(1, "status", {})]);
  assert.equal(driven.stdoutLines.length, 1);
  const outcome = structuredOf(driven.stdoutLines[0]);
  assert.equal(outcome["outcome"], "done");
  assert.equal(outcome["tool"], "status");
  const value = outcome["value"] as Record<string, unknown>;
  const display = value["display"] as Record<string, unknown>;
  assert.equal(display["label"], STATUS_LABELS.active);
  assert.equal(display["label"], "realm active");
});

void test("TOOL-05: a thrown RealmError is a tool error without resultType in the legacy era", async () => {
  const thrown = makeRealmError("OPENSHELL_START_FAILED");
  const dispatcher: McpDispatcher = { call: () => Promise.reject(thrown) };
  const driven = await drive(dispatcher, [
    request(1, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: CLIENT }),
    toolRequest(2, "exec", { argv: ["true"] }),
  ]);
  const result = resultRecord(driven.stdoutLines[1]);
  assert.equal(result["resultType"], undefined);
  assert.equal(result["isError"], true);
  assert.equal(structuredOf(driven.stdoutLines[1])["code"], "OPENSHELL_START_FAILED");
});

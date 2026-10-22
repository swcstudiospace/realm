import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { PassThrough, Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import { STATUS_LABELS } from "../../src/core/status.js";
import { ERROR_CATALOGUE, makeRealmError, RealmError } from "../../src/core/errors.js";
import {
  MCP_PROTOCOL_VERSION,
  createMcpServer,
  type McpDispatcher,
} from "../../src/mcp/server.js";
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

void test("TOOL-05: the server answers the server/discover probe per mcp.md Q5", async (t) => {
  const h = makeHarness(t);
  const driven = await drive(h.dispatcher, [request(1, "server/discover", {})]);
  assert.equal(driven.stdoutLines.length, 1);
  const result = resultOf(driven.stdoutLines[0] as string) as Record<string, unknown>;
  assert.equal(result["protocolVersion"], MCP_PROTOCOL_VERSION);
  assert.equal(result["protocolVersion"], "2026-07-28");
  assert.ok(
    typeof result["capabilities"] === "object" && result["capabilities"] !== null,
    "the probe answer carries capabilities",
  );
});

void test("TOOL-05: the server answers the initialize handshake per mcp.md Q5", async (t) => {
  const h = makeHarness(t);
  const driven = await drive(h.dispatcher, [
    request(7, "initialize", {
      protocolVersion: "2026-07-28",
      capabilities: {},
      clientInfo: { name: "test-client", version: "0" },
    }),
  ]);
  assert.equal(driven.stdoutLines.length, 1);
  const result = resultOf(driven.stdoutLines[0] as string) as Record<string, unknown>;
  assert.equal(result["protocolVersion"], "2026-07-28");
  assert.ok(
    typeof result["serverInfo"] === "object" && result["serverInfo"] !== null,
    "the handshake answer names the server",
  );
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
  const replies = driven.stdoutLines.slice(1).map((line) => resultOf(line) as Record<string, unknown>);
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
  assert.deepEqual(resultOf(driven.stdoutLines[0] as string), {
    outcome: "refused",
    tool: null,
    code: "SCHEMA_INVALID",
    retryable: ERROR_CATALOGUE["SCHEMA_INVALID"].retryable,
  });
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

void test("TOOL-05: the surface calls no dispatcher member except call (P5-D11)", () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
  const source = readFileSync(join(root, "src", "mcp", "server.ts"), "utf8");
  for (const member of [".snapshot", ".mutationGate", ".events", ".create("]) {
    assert.ok(!source.includes(member), `src/mcp/server.ts must not reference ${member}`);
  }
  assert.ok(source.includes(".call("), "the surface reaches the dispatcher through call");
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
  assert.deepEqual(resultOf(driven.stdoutLines[1] as string), expectedStatus);
  assert.deepEqual(resultOf(driven.stdoutLines[2] as string), expectedWrite);
  assert.equal(readFileSync(join(h.ws, "e2e.txt"), "utf8"), "hello");
});

void test("TOOL-05: the status reply carries the shared displayStatus label, not a server-invented label", async (t) => {
  const h = makeHarness(t);
  const driven = await drive(h.dispatcher, [toolRequest(1, "status", {})]);
  assert.equal(driven.stdoutLines.length, 1);
  const outcome = resultOf(driven.stdoutLines[0] as string) as Record<string, unknown>;
  assert.equal(outcome["outcome"], "done");
  assert.equal(outcome["tool"], "status");
  const value = outcome["value"] as Record<string, unknown>;
  const display = value["display"] as Record<string, unknown>;
  assert.equal(display["label"], STATUS_LABELS.active);
  assert.equal(display["label"], "realm active");
  const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
  const source = readFileSync(join(root, "src", "mcp", "server.ts"), "utf8");
  assert.ok(!source.includes("realm active"), "the label comes from the shared mapping, not the surface");
  assert.ok(!source.includes("realm disconnected"), "no label literal lives in the surface");
});

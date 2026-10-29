import { test } from "node:test";
import assert from "node:assert/strict";
import { PassThrough, Writable } from "node:stream";
import { ERROR_CATALOGUE, ERROR_CODES } from "../../src/core/errors.js";
import type { ToolCall } from "../../src/contract/validate.js";
import { REALM_TOOL_METHOD, runAcpAgent } from "../../src/acp/agent.js";
import { createMcpServer, type McpDispatcher } from "../../src/mcp/server.js";
import type { ToolDispatcher, ToolOutcome } from "../../src/tools/dispatch.js";
import { makeHarness, REQUIRED, WORKLOAD } from "../support/fake-tools.js";

// TOOL-05 MCP-versus-ACP outcome equivalence proof (P5-D13). The same ToolCall
// travels through the MCP server and through the ACP adapter against ONE
// dispatcher from makeHarness, and the ToolOutcome payloads must be
// deep-equal after envelope stripping. Only transport framing (JSON-RPC ids on
// the MCP half, _realm/tool wrappers on the ACP half) is stripped, and the
// stripping lives in this file: neither surface is edited (P5-D11). The only
// fake is the OpenShell runner, which starts no process.

function mcpRequest(id: number, name: string, args: unknown): string {
  return JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });
}

interface DriveResult {
  readonly stdoutLines: string[];
}

async function driveMcp(dispatcher: McpDispatcher, lines: readonly string[]): Promise<DriveResult> {
  const input = new PassThrough();
  const output = new PassThrough();
  const stderr = new Writable({
    write(_chunk, _encoding, callback) {
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
      setTimeout(() => {
        reject(new Error("mcp server did not close after stdin ended"));
      }, 2000).unref();
    }),
  ]);
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
  return { stdoutLines: stdout === "" ? [] : stdout.slice(0, -1).split("\n") };
}

function mcpResultOf(line: string): ToolOutcome {
  const body = JSON.parse(line) as { jsonrpc: string; result?: unknown; error?: unknown };
  assert.equal(body.jsonrpc, "2.0", "every MCP reply is a JSON-RPC message");
  assert.ok(body.result !== undefined, `the MCP reply carries a result, not a transport error: ${line}`);
  return body.result as ToolOutcome;
}

async function mcpOutcomes(dispatcher: McpDispatcher, calls: readonly ToolCall[]): Promise<ToolOutcome[]> {
  const lines = calls.map((call, index) => {
    const name = Object.keys(call)[0] as string;
    const args = (call as unknown as Record<string, unknown>)[name];
    return mcpRequest(index + 1, name, args);
  });
  const driven = await driveMcp(dispatcher, lines);
  assert.equal(driven.stdoutLines.length, lines.length, "every MCP request takes exactly one reply");
  return driven.stdoutLines.map(mcpResultOf);
}

async function acpOutcomes(dispatcher: ToolDispatcher, calls: readonly unknown[]): Promise<ToolOutcome[]> {
  const input = new PassThrough();
  const output = new PassThrough();
  const logs: string[] = [];
  let text = "";
  const lines: string[] = [];
  output.setEncoding("utf8");
  output.on("data", (chunk: string) => {
    text += chunk;
    let idx = text.indexOf("\n");
    while (idx >= 0) {
      lines.push(text.slice(0, idx));
      text = text.slice(idx + 1);
      idx = text.indexOf("\n");
    }
  });
  const done = runAcpAgent({
    dispatcher,
    input,
    output,
    log: (message: string) => {
      logs.push(message);
    },
  });
  calls.forEach((tool, index) => {
    input.write(`${JSON.stringify({ jsonrpc: "2.0", id: index + 1, method: REALM_TOOL_METHOD, params: { tool } })}\n`);
  });
  input.end();
  await done;
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
  assert.equal(lines.length, calls.length, `every ACP request takes exactly one reply (logs: ${logs.join("; ")})`);
  return lines.map((line) => {
    const body = JSON.parse(line) as { jsonrpc: string; result?: unknown; error?: unknown };
    assert.equal(body.jsonrpc, "2.0", "every ACP reply is a JSON-RPC message");
    assert.ok(body.result !== undefined, `the ACP reply carries a result, not a transport error: ${line}`);
    return body.result as ToolOutcome;
  });
}

const SIX_CALLS: ReadonlyArray<{ readonly name: string; readonly call: ToolCall }> = [
  { name: "exec", call: { exec: { argv: [...WORKLOAD] } } },
  { name: "read", call: { read: { path: "doc.txt", maxBytes: 1024 } } },
  { name: "write", call: { write: { path: "equiv-out.txt", content: "equiv" } } },
  { name: "list", call: { list: { path: ".", depth: 1 } } },
  { name: "status", call: { status: {} } },
  { name: "retry", call: { retry: {} } },
];

void test("TOOL-05: the same ToolCall for each of the six tools returns outcome-equal payloads through MCP and ACP on one dispatcher (P5-D13)",
{ timeout: 10_000 },
async (t) => {
  const h = makeHarness(t);
  const calls = SIX_CALLS.map(({ call }) => call);
  const throughMcp = await mcpOutcomes(h.dispatcher, calls);
  const throughAcp = await acpOutcomes(h.dispatcher, calls);
  assert.equal(throughMcp.length, SIX_CALLS.length);
  assert.equal(throughAcp.length, SIX_CALLS.length);
  SIX_CALLS.forEach(({ name }, index) => {
    const mcp = throughMcp[index] as ToolOutcome;
    const acp = throughAcp[index] as ToolOutcome;
    assert.deepEqual(
      acp,
      mcp,
      `${name} is outcome-equal across surfaces (mcp: ${JSON.stringify(mcp)}; acp: ${JSON.stringify(acp)})`,
    );
    assert.equal(mcp.outcome, "done", `expected a done ${name} through MCP`);
    assert.equal(mcp.tool, name);
  });
},);

void test("TOOL-05: a schema-invalid call and a required-mode non-active write refuse outcome-equal with the same catalogue code on both surfaces (P5-D13)",
{ timeout: 10_000 },
async (t) => {
  const h = makeHarness(t);
  // A schema-invalid map: read without its required maxBytes. The ToolCall
  // shape cannot name it, so it crosses as an unknown map on both halves.
  const schemaInvalid: unknown = { read: { path: "doc.txt" } };
  const mcpSchema = (await mcpOutcomes(h.dispatcher, [schemaInvalid as ToolCall]))[0] as ToolOutcome;
  const acpSchema = (await acpOutcomes(h.dispatcher, [schemaInvalid]))[0] as ToolOutcome;
  for (const [half, outcome] of [
    ["mcp", mcpSchema],
    ["acp", acpSchema],
  ] as const) {
    assert.equal(outcome.outcome, "refused", `the schema-invalid call refuses through ${half}`);
    assert.deepEqual(outcome, {
      outcome: "refused",
      tool: null,
      code: "SCHEMA_INVALID",
      retryable: ERROR_CATALOGUE["SCHEMA_INVALID"].retryable,
    });
  }
  assert.deepEqual(
    acpSchema,
    mcpSchema,
    `the schema refusal is outcome-equal (mcp: ${JSON.stringify(mcpSchema)}; acp: ${JSON.stringify(acpSchema)})`,
  );

  // A required-mode write while non-active: refused by the mutation gate
  // with the catalogue code, on a second harness both surfaces share.
  const gated = makeHarness(t, { policy: REQUIRED, state: "degraded" });
  const blocked: ToolCall = { write: { path: "doc.txt", content: "blocked" } };
  const mcpGated = (await mcpOutcomes(gated.dispatcher, [blocked]))[0] as ToolOutcome;
  const acpGated = (await acpOutcomes(gated.dispatcher, [blocked]))[0] as ToolOutcome;
  for (const [half, outcome] of [
    ["mcp", mcpGated],
    ["acp", acpGated],
  ] as const) {
    assert.equal(outcome.outcome, "refused", `the gated write refuses through ${half}`);
    assert.ok(
      (ERROR_CODES as readonly string[]).includes(outcome.code),
      `the gated refusal carries a catalogue code through ${half}: ${outcome.code}`,
    );
    assert.equal(outcome.retryable, ERROR_CATALOGUE[outcome.code].retryable);
  }
  assert.deepEqual(
    acpGated,
    mcpGated,
    `the gated refusal is outcome-equal (mcp: ${JSON.stringify(mcpGated)}; acp: ${JSON.stringify(acpGated)})`,
  );
},);

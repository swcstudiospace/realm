import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough, Writable } from "node:stream";
import { REALM_TOOL_METHOD, runAcpAgent } from "../../src/acp/agent.js";
import { sendRequest } from "../../src/daemon/channel.js";
import { connectDaemon } from "../../src/daemon/client.js";
import { type StartedDaemon, startDaemon } from "../../src/daemon/daemon.js";
import { createMcpServer, type McpDispatcher } from "../../src/mcp/server.js";
import type { PodmanProbeResult } from "../../src/runtime/podman-probe.js";
import type { ToolOutcome } from "../../src/tools/dispatch.js";
import { FakeBridge } from "../support/fake-bridge.js";
import { FakeExecutionService } from "../support/fake-execution.js";

// CRASH-06 (TD-01, D-1406): a refusal cause code reaches a host the same way whether the surface answers from the
// dispatcher in process or through the daemon. The shapes still differ by design: in process the refused outcome is
// the result (MCP structuredContent, ACP result), over the daemon it is an error reply that the client throws as a
// RealmError (MCP structuredContent of a tool error, ACP error.data). The cause code is what must agree. The only
// fakes are the ones the daemon tests already use at the adapter seam; dispatcher.call is replaced by a function
// returning a scripted refused outcome, as test/daemon/client.test.ts does.

const IMAGE = `registry.example.com/realm/workload@sha256:${"0".repeat(64)}`;
const TS = "2026-10-29T00:00:00.000Z";

type Answer = (call: unknown) => Promise<ToolOutcome>;

// Starts a real daemon on its control socket with every host seam faked. One t.after brings the daemon down, then
// removes the scratch directory, so the socket is closed before the directory goes.
async function startRealDaemon(t: TestContext): Promise<StartedDaemon> {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "realm-daemon-equivalence-")));
  const workspace = join(base, "ws");
  mkdirSync(workspace);
  const policyPath = join(base, "policy.json");
  writeFileSync(policyPath, JSON.stringify({ workspaceRoots: [workspace] }));
  const daemon = await startDaemon({
    runtimeInput: { image: IMAGE, stateDir: join(base, "state"), workspaceRoot: workspace },
    policyPath,
    sessionId: "sess-daemon-equivalence",
    exec: new FakeExecutionService(),
    bridge: new FakeBridge(),
    clock: () => new Date(TS),
    runOpenShell: () => Promise.resolve({ exitCode: 0, stdout: "", stderr: "", truncated: false }),
    sweep: () => Promise.resolve(0),
    probe: () => Promise.resolve<PodmanProbeResult>({ ok: true, version: "5.0.0" }),
  }).catch((error: unknown) => {
    rmSync(base, { recursive: true, force: true });
    throw error;
  });
  t.after(async () => {
    try {
      await sendRequest(daemon.socketPath, { id: "equivalence-down", method: "down" });
      await daemon.done;
    } catch {
      // The daemon already went down, so only the scratch directory is left to remove.
    }
    rmSync(base, { recursive: true, force: true });
  });
  return daemon;
}

interface Reply {
  readonly result?: unknown;
  readonly error?: unknown;
}

function record(value: unknown, what: string): Record<string, unknown> {
  assert.ok(typeof value === "object" && value !== null && !Array.isArray(value), `${what} is an object`);
  return value as Record<string, unknown>;
}

// Drives one MCP tools/call through createMcpServer and returns the single JSON-RPC reply.
async function mcpReply(dispatcher: McpDispatcher, name: string, args: unknown): Promise<Reply> {
  const input = new PassThrough();
  const output = new PassThrough();
  const diagnostics = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });
  const server = createMcpServer(dispatcher, input, output, diagnostics);
  let stdout = "";
  output.on("data", (chunk) => {
    stdout += String(chunk);
  });
  input.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } })}\n`);
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
  const lines = stdout.split("\n").filter((line) => line !== "");
  assert.equal(lines.length, 1, "the MCP request takes exactly one reply");
  return record(JSON.parse(lines[0] as string), "the MCP reply");
}

// Drives one _realm/tool call through runAcpAgent and returns the single JSON-RPC reply.
async function acpReply(dispatcher: McpDispatcher, tool: unknown): Promise<Reply> {
  const input = new PassThrough();
  const output = new PassThrough();
  const logs: string[] = [];
  let text = "";
  output.setEncoding("utf8");
  output.on("data", (chunk: string) => {
    text += chunk;
  });
  const done = runAcpAgent({
    dispatcher,
    input,
    output,
    log: (message: string) => {
      logs.push(message);
    },
  });
  input.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: REALM_TOOL_METHOD, params: { tool } })}\n`);
  input.end();
  await done;
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
  const lines = text.split("\n").filter((line) => line !== "");
  assert.equal(lines.length, 1, `the ACP request takes exactly one reply (logs: ${logs.join("; ")})`);
  return record(JSON.parse(lines[0] as string), "the ACP reply");
}

// The code, retryable flag and cause code a host reads from each surface. In process they come from the refused
// outcome (MCP structuredContent, ACP result); over the daemon from the error the client threw (MCP structuredContent
// of the tool error, ACP error.data).
interface Seen {
  readonly code: unknown;
  readonly retryable: unknown;
  readonly hasCause: boolean;
  readonly causeCode: unknown;
}

function seen(fields: Record<string, unknown>): Seen {
  return {
    code: fields["code"],
    retryable: fields["retryable"],
    hasCause: Object.hasOwn(fields, "causeCode"),
    causeCode: fields["causeCode"],
  };
}

function mcpSeen(reply: Reply): Seen {
  const result = record(reply.result, "the MCP result");
  assert.equal(result["isError"], true, "a refusal is an MCP tool error");
  return seen(record(result["structuredContent"], "the MCP structuredContent"));
}

function acpInProcessSeen(reply: Reply): Seen {
  return seen(record(reply.result, "the ACP result"));
}

function acpDaemonSeen(reply: Reply): Seen {
  assert.equal(reply.result, undefined, "the ACP reply over the daemon is an error, not a result");
  return seen(record(record(reply.error, "the ACP error")["data"], "the ACP error data"));
}

async function overDaemon(
  t: TestContext,
  answer: Answer,
): Promise<{ readonly mcp: Seen; readonly acp: Seen }> {
  const daemon = await startRealDaemon(t);
  daemon.handle.dispatcher.call = answer;
  const client = connectDaemon(daemon.socketPath);
  t.after(() => {
    client.close();
  });
  const mcp = mcpSeen(await mcpReply(client, "retry", {}));
  const acp = acpDaemonSeen(await acpReply({ call: (tool) => client.call(tool) }, { retry: {} }));
  return { mcp, acp };
}

async function inProcess(answer: Answer): Promise<{ readonly mcp: Seen; readonly acp: Seen }> {
  const dispatcher: McpDispatcher = { call: answer };
  const mcpResult = record((await mcpReply(dispatcher, "retry", {})).result, "the MCP result");
  const mcp = seen(record(mcpResult["structuredContent"], "the MCP structuredContent"));
  const acp = acpInProcessSeen(await acpReply(dispatcher, { retry: {} }));
  return { mcp, acp };
}

void test("CRASH-06: a refusal cause code is the same through MCP and ACP in process and over the daemon (D-1406)", { timeout: 15_000 }, async (t) => {
  const answer: Answer = () =>
    Promise.resolve<ToolOutcome>({
      outcome: "refused",
      tool: "retry",
      code: "OPENSHELL_START_FAILED",
      retryable: true,
      causeCode: "PODMAN_MACHINE_DOWN",
    });
  const local = await inProcess(answer);
  const daemon = await overDaemon(t, answer);

  const expected: Seen = {
    code: "OPENSHELL_START_FAILED",
    retryable: true,
    hasCause: true,
    causeCode: "PODMAN_MACHINE_DOWN",
  };
  assert.deepEqual(local.mcp, expected, "in-process MCP");
  assert.deepEqual(local.acp, expected, "in-process ACP");
  assert.deepEqual(daemon.mcp, expected, "MCP over the daemon");
  assert.deepEqual(daemon.acp, expected, "ACP over the daemon");
});

void test("CRASH-06: a refusal without a cause carries no causeCode on any of the four paths (D-1406)", { timeout: 15_000 }, async (t) => {
  const answer: Answer = () =>
    Promise.resolve<ToolOutcome>({ outcome: "refused", tool: "retry", code: "POLICY_DENIED", retryable: false });
  const local = await inProcess(answer);
  const daemon = await overDaemon(t, answer);

  const expected: Seen = { code: "POLICY_DENIED", retryable: false, hasCause: false, causeCode: undefined };
  assert.deepEqual(local.mcp, expected, "in-process MCP");
  assert.deepEqual(local.acp, expected, "in-process ACP");
  assert.deepEqual(daemon.mcp, expected, "MCP over the daemon");
  assert.deepEqual(daemon.acp, expected, "ACP over the daemon");
});

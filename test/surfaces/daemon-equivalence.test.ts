import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough, Writable } from "node:stream";
import { REALM_TOOL_METHOD, runAcpAgent } from "../../src/acp/agent.js";
import { sendRequest } from "../../src/daemon/channel.js";
import { connectDaemon, selectionOf } from "../../src/daemon/client.js";
import { type StartedDaemon, startDaemon } from "../../src/daemon/daemon.js";
import { createMcpServer, type McpDispatcher } from "../../src/mcp/server.js";
import type { PodmanProbeResult } from "../../src/runtime/podman-probe.js";
import type { ToolOutcome } from "../../src/tools/dispatch.js";
import { FakeBridge } from "../support/fake-bridge.js";
import { FakeExecutionService } from "../support/fake-execution.js";
import { boundedWait, testTimeout } from "../support/timing.js";
import { startRealmDaemon } from "../support/realm-daemon-fixture.js";

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
async function startRealDaemon(t: TestContext): Promise<{ readonly daemon: StartedDaemon; readonly workspace: string }> {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "realm-daemon-equivalence-")));
  const workspace = join(base, "ws");
  mkdirSync(workspace);
  const policyPath = join(base, "policy.json");
  writeFileSync(policyPath, JSON.stringify({ workspaceRoots: [workspace] }));
  const daemon = await startDaemon({
    runtimeInput: { image: IMAGE, stateDir: join(base, "state"), workspaceRoot: workspace },
    policyPath,
    exec: new FakeExecutionService(),
    bridge: new FakeBridge(),
    clock: () => new Date(TS),
    runOpenShell: () => Promise.resolve({ exitCode: 0, stdout: "", stderr: "", truncated: false }),
    // A libpod double whose realm listing is empty, so the startup reap removes nothing.
    libpod: {
      info: () => Promise.resolve({ rootless: true, version: "5.0.0" }),
      listContainersByLabel: () => Promise.resolve([]),
      inspectContainer: () => Promise.resolve(null),
      stopContainer: () => Promise.resolve(),
      removeContainer: () => Promise.resolve(),
    },
    probe: () => Promise.resolve<PodmanProbeResult>({ ok: true, version: "5.0.0" }),
  }).catch((error: unknown) => {
    rmSync(base, { recursive: true, force: true });
    throw error;
  });
  t.after(async () => {
    try {
      await sendRequest(daemon.socketPath, { id: "equivalence-down", method: "down", params: { selection: selectionOf(workspace) } });
      await daemon.done;
    } catch {
      // The daemon already went down, so only the scratch directory is left to remove.
    }
    rmSync(base, { recursive: true, force: true });
  });
  return { daemon, workspace };
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
  await boundedWait(server.closed, "the mcp server closing after stdin ended", 15_000);
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
  const { daemon, workspace } = await startRealDaemon(t);
  await sendRequest(daemon.socketPath, { id: "equivalence-up", method: "up", params: { workspaceRoot: workspace } });
  const entry = daemon.session(selectionOf(workspace).sessionId);
  assert.ok(entry !== undefined, "the workspace's session is admitted");
  entry.handle.dispatcher.call = answer;
  const client = connectDaemon(daemon.socketPath, selectionOf(workspace));
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

void test("CRASH-06: a refusal cause code is the same through MCP and ACP in process and over the daemon (D-1406)", testTimeout(45_000), async (t) => {
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

void test("CRASH-06: a refusal without a cause carries no causeCode on any of the four paths (D-1406)", testTimeout(45_000), async (t) => {
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

// MULTI-03: both selections share one daemon, but taking either session down leaves the other active.
void test("two projects: CLI, MCP and Omp observe their selected lifecycle on one daemon (MULTI-03)", async (t) => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "realm-equivalence-two-")));
  const root = join(base, "root");
  const a = join(root, "a");
  const b = join(root, "b");
  mkdirSync(a, { recursive: true });
  mkdirSync(b, { recursive: true });
  const fixture = await startRealmDaemon({ stateDir: join(base, "state"), workspace: root, mode: "advisory" });
  t.after(async () => {
    // The last release stops the daemon, so a failed release of an already stopped daemon is expected.
    for (const project of [a, b]) {
      await fixture.release(project).catch(() => undefined);
    }
    rmSync(base, { recursive: true, force: true });
  });
  const projects = [a, b] as const;
  const selections = projects.map((project) => fixture.selectionFor(project));
  assert.deepEqual(selections[0], selectionOf(a));
  assert.deepEqual(selections[1], selectionOf(b));
  assert.notEqual(selections[0].sessionId, selections[1].sessionId);

  const mcpClients = projects.map((project) => fixture.connectFor(project));
  const ompClients = projects.map((project) => connectDaemon(fixture.socketPath, selectionOf(project)));
  t.after(() => {
    for (const client of [...mcpClients, ...ompClients]) client.close();
  });

  const cli = (project: string, method: "status" | "up" | "down") =>
    sendRequest(fixture.socketPath, {
      id: `eq-cli-${method}`,
      method,
      params: method === "up" ? { workspaceRoot: project } : { selection: selectionOf(project) },
    });
  const result = async (project: string, method: "status" | "up" | "down"): Promise<unknown> => {
    const reply = await cli(project, method);
    assert.equal(reply.error, undefined, `${method} should succeed for ${project}`);
    assert.notEqual(reply.result, undefined);
    return reply.result;
  };

  for (const client of mcpClients) {
    const up = await client.up();
    assert.equal(up.snapshot.state, "active");
  }

  for (const [index, project] of projects.entries()) {
    const other = projects[1 - index];
    const mcp = mcpClients[index];
    const omp = ompClients[index];
    const otherMcp = mcpClients[1 - index];
    const selection = selections[index];
    assert.ok(other !== undefined && mcp !== undefined && omp !== undefined && otherMcp !== undefined && selection !== undefined);

    const initial = await mcp.status();
    assert.equal(initial.snapshot.state, "active");
    assert.equal(initial.boundRoot, project);
    assert.equal(initial.sessionId, selection.sessionId);
    assert.deepEqual(await result(project, "status"), initial);
    assert.deepEqual(await omp.status(), initial);
    assert.deepEqual(await result(project, "up"), initial);
    assert.deepEqual(await mcp.up(), initial);
    assert.deepEqual(await omp.up(), initial);

    const peer = await otherMcp.status();
    assert.equal(peer.snapshot.state, "active");
    assert.equal(peer.boundRoot, other);
    assert.notEqual(peer.sessionId, initial.sessionId);
    assert.deepEqual({ ...initial, sessionId: peer.sessionId, boundRoot: peer.boundRoot }, peer);

    // Each real up path re-establishes a session after CLI down, not merely an already-active attachment.
    for (const upPath of ["cli", "mcp", "omp"] as const) {
      const down = await result(project, "down");
      const downStatus = await mcp.status();
      assert.equal(downStatus.snapshot.state, "unbound");
      assert.equal(downStatus.boundRoot, project);
      assert.equal(downStatus.sessionId, selection.sessionId);
      assert.deepEqual(down, downStatus);
      assert.deepEqual(await result(project, "status"), downStatus);
      assert.deepEqual(await omp.status(), downStatus);
      assert.deepEqual(await otherMcp.status(), peer, "the other project remains active after down");

      const up: unknown = upPath === "cli" ? await result(project, "up") : await (upPath === "mcp" ? mcp : omp).up();
      const active = await mcp.status();
      assert.equal(active.snapshot.state, "active");
      assert.equal(active.boundRoot, project);
      assert.equal(active.sessionId, selection.sessionId);
      assert.deepEqual(up, active);
      assert.deepEqual(await result(project, "status"), active);
      assert.deepEqual(await omp.status(), active);
      assert.deepEqual(await otherMcp.status(), peer);
    }
  }
});

// TOOL-05 ACP adapter cases (P5-D3, P5-D10, P5-D11). They drive the adapter over
// in-memory stdio streams against the makeHarness dispatcher: v1 initialize
// with the never-batched lifecycle rule, realm/tool routing for all six tools
// with faithful refusals, and a lifecycle drive with dispatcher-equal
// outcomes. No real process starts and no ACP client exists on the host.
//
// Waiting is event-driven: waiters resolve from the output stream's data
// handler when the reply lines arrive, never from a guessed delay. Each test
// carries a timeout option so a missing reply fails instead of hanging the run.

import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { ACP_PROTOCOL_VERSION, REALM_TOOL_METHOD, runAcpAgent } from "../../src/acp/agent.js";
import { ERROR_CATALOGUE, ERROR_CODES, makeRealmError } from "../../src/core/errors.js";
import { displayStatus } from "../../src/core/status.js";
import type { ToolCall } from "../../src/contract/validate.js";
import type { ToolDispatcher, ToolOutcome } from "../../src/tools/dispatch.js";
import { makeHarness, REQUIRED, WORKLOAD } from "../support/fake-tools.js";

interface LineWaiter {
  readonly count: number;
  readonly resolve: () => void;
}

interface AcpClient {
  readonly input: PassThrough;
  readonly lines: string[];
  readonly diagnostics: string[];
  readonly done: Promise<void>;
  waitFor(count: number): Promise<void>;
  close(): Promise<void>;
}

function startClient(t: TestContext, dispatcher: Pick<ToolDispatcher, "call">, input: PassThrough = new PassThrough()): AcpClient {
  const output = new PassThrough();
  const diagnostics: string[] = [];
  const lines: string[] = [];
  const waiters: LineWaiter[] = [];
  // Diagnostics are written to process.stderr. Capture them so the run stays
  // quiet and the stderr-only rule is observable from the test.
  t.mock.method(process.stderr, "write", (chunk: unknown): boolean => {
    diagnostics.push(String(chunk));
    return true;
  });
  const check = (): void => {
    for (let i = waiters.length - 1; i >= 0; i--) {
      const waiter = waiters[i];
      if (waiter !== undefined && lines.length >= waiter.count) {
        waiters.splice(i, 1);
        waiter.resolve();
      }
    }
  };
  let text = "";
  output.setEncoding("utf8");
  output.on("data", (chunk: string) => {
    text += chunk;
    let idx = text.indexOf("\n");
    while (idx >= 0) {
      lines.push(text.slice(0, idx));
      text = text.slice(idx + 1);
      idx = text.indexOf("\n");
    }
    check();
  });
  const done = runAcpAgent({ dispatcher, input, output });
  t.after(() => {
    input.destroy();
    output.destroy();
  });
  // Executor form: the tsconfig lib is ES2023, which predates
  // Promise.withResolvers (ES2024), so the constructor form is required here.
  const waitFor = (count: number): Promise<void> =>
    new Promise<void>((resolve) => {
      waiters.push({ count, resolve });
      check();
    });
  const close = async (): Promise<void> => {
    input.end();
    await done;
  };
  return { input, lines, diagnostics, done, waitFor, close };
}

function send(client: AcpClient, message: unknown): void {
  client.input.write(`${JSON.stringify(message)}\n`);
}

interface RpcReply {
  readonly jsonrpc: "2.0";
  readonly id: string | number | null;
  readonly result?: unknown;
  readonly error?: { readonly code: number; readonly message: string; readonly data?: unknown };
}

function parseReply(line: string): RpcReply {
  const body = JSON.parse(line) as RpcReply;
  assert.equal(body.jsonrpc, "2.0");
  return body;
}

function realmTool(id: number, tool: ToolCall): Record<string, unknown> {
  return { jsonrpc: "2.0", id, method: REALM_TOOL_METHOD, params: { tool } };
}

const SIX_CALLS: ReadonlyArray<{ readonly name: string; readonly call: ToolCall }> = [
  { name: "exec", call: { exec: { argv: [...WORKLOAD] } } },
  { name: "read", call: { read: { path: "doc.txt", maxBytes: 1024 } } },
  { name: "write", call: { write: { path: "doc.txt", content: "updated" } } },
  { name: "list", call: { list: { path: ".", depth: 1 } } },
  { name: "status", call: { status: {} } },
  { name: "retry", call: { retry: {} } },
];

test(
  "TOOL-05: a v1 initialize request gets a protocolVersion 1 reply on one line with stderr-only diagnostics",
  { timeout: 10_000 },
  async (t) => {
    const h = makeHarness(t);
    const client = startClient(t, h.dispatcher);
    send(client, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: 1, clientInfo: { name: "probe", version: "0" } },
    });
    await client.waitFor(1);
    assert.equal(client.lines.length, 1, "exactly one reply line for one request line");
    const reply = parseReply(client.lines[0] ?? "");
    assert.equal(reply.id, 1);
    const result = reply.result as { protocolVersion: number; agentInfo: { name: string } };
    assert.equal(result.protocolVersion, ACP_PROTOCOL_VERSION);
    assert.equal(result.agentInfo.name, "realm");
    assert.ok(client.diagnostics.length > 0, "diagnostics are written to stderr");
    for (const line of client.lines) {
      parseReply(line);
    }
    await client.close();
  },
);

test(
  "TOOL-05: initialize, session/new, and session/prompt equivalents are never packed into one batch line",
  { timeout: 10_000 },
  async (t) => {
    const h = makeHarness(t);
    const client = startClient(t, h.dispatcher);
    const batch = [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: 1 } },
      { jsonrpc: "2.0", id: 2, method: "session/new", params: {} },
      { jsonrpc: "2.0", id: 3, method: "session/prompt", params: {} },
    ]
      .map((message) => JSON.stringify(message))
      .join("\n");
    client.input.write(`${batch}\n`);
    await client.waitFor(3);
    assert.equal(client.lines.length, 3, "three request lines yield three reply lines, never one batch");
    const replies = client.lines.map(parseReply);
    assert.deepEqual(
      replies.map((reply) => reply.id),
      [1, 2, 3],
      "replies keep request order on separate lines",
    );
    for (const reply of replies) {
      assert.ok(!Array.isArray(reply.result), "no reply line carries a batch array");
    }
    const init = replies[0]?.result as { protocolVersion: number };
    assert.equal(init.protocolVersion, 1);
    await client.close();
  },
);

test("TOOL-05: closing stdin shuts the adapter down without hanging", { timeout: 10_000 }, async (t) => {
  const h = makeHarness(t);
  const client = startClient(t, h.dispatcher);
  await client.close();
  assert.ok(client.diagnostics.some((line) => line.includes("stdin closed")), "the close is written to stderr");
});

test(
  "TOOL-05: a realm/tool request carrying each of the six ToolCall maps routes to ToolDispatcher.call with the map unchanged",
  { timeout: 10_000 },
  async (t) => {
    const h = makeHarness(t);
    const seen: unknown[] = [];
    const inner = h.dispatcher.call.bind(h.dispatcher);
    h.dispatcher.call = async (raw: unknown): Promise<ToolOutcome> => {
      seen.push(raw);
      return inner(raw);
    };
    const client = startClient(t, h.dispatcher);
    let id = 1;
    for (const { call } of SIX_CALLS) {
      send(client, realmTool(id, call));
      id += 1;
    }
    await client.waitFor(SIX_CALLS.length);
    assert.equal(seen.length, SIX_CALLS.length, "every realm/tool request reached the dispatcher");
    const replies = client.lines.map(parseReply);
    SIX_CALLS.forEach(({ name, call }, index) => {
      assert.deepEqual(seen[index], call, `${name} map crosses unchanged`);
      assert.equal(replies[index]?.id, index + 1);
      const outcome = replies[index]?.result as ToolOutcome;
      assert.equal(outcome.outcome, "done", `${name} succeeds against the harness dispatcher`);
      assert.equal(outcome.tool, name);
    });
    await client.close();
  },
);

test(
  "TOOL-05: a dispatcher refusal surfaces the catalogue code in the realm/tool reply without adapter-added logic",
  { timeout: 10_000 },
  async (t) => {
    const h = makeHarness(t);
    const call: ToolCall = { exec: { shell: true, script: "echo hi" } };
    const expected = await h.dispatcher.call(call);
    assert.equal(expected.outcome, "refused");
    const client = startClient(t, h.dispatcher);
    send(client, realmTool(1, call));
    await client.waitFor(1);
    const reply = parseReply(client.lines[0] ?? "");
    assert.deepEqual(reply.result, expected, "the reply carries the dispatcher's own refusal");
    const outcome = reply.result as Extract<ToolOutcome, { outcome: "refused" }>;
    assert.ok(
      (ERROR_CODES as readonly string[]).includes(outcome.code),
      "the surfaced code is a catalogue code",
    );
    await client.close();
  },
);

test(
  "TOOL-05: a RealmError thrown by the dispatcher reaches the realm/tool reply with its code, retryable flag, and message (G-08)",
  { timeout: 10_000 },
  async (t) => {
    const thrown = makeRealmError("OPENSHELL_START_FAILED", "PODMAN_MACHINE_DOWN");
    const dispatcher: Pick<ToolDispatcher, "call"> = { call: () => Promise.reject(thrown) };
    const client = startClient(t, dispatcher);
    send(client, realmTool(1, { exec: { argv: [...WORKLOAD] } }));
    await client.waitFor(1);
    const reply = parseReply(client.lines[0] ?? "");
    assert.equal(reply.id, 1);
    assert.equal(reply.result, undefined, "a thrown refusal is an error reply, not a result");
    const entry = ERROR_CATALOGUE["OPENSHELL_START_FAILED"];
    assert.deepEqual(reply.error, {
      code: -32603,
      message: `OPENSHELL_START_FAILED: ${entry.reason}`,
      data: { code: "OPENSHELL_START_FAILED", retryable: entry.retryable, causeCode: "PODMAN_MACHINE_DOWN" },
    });
    await client.close();
  },
);

test(
  "TOOL-05: a request naming any other tool method is rejected without reaching the dispatcher",
  { timeout: 10_000 },
  async (t) => {
    const h = makeHarness(t);
    let calls = 0;
    const inner = h.dispatcher.call.bind(h.dispatcher);
    h.dispatcher.call = async (raw: unknown): Promise<ToolOutcome> => {
      calls += 1;
      return inner(raw);
    };
    const client = startClient(t, h.dispatcher);
    send(client, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { tool: { status: {} } } });
    send(client, { jsonrpc: "2.0", id: 2, method: "realm/exec", params: { tool: { status: {} } } });
    client.input.write("this is not json\n");
    await client.waitFor(3);
    const replies = client.lines.map(parseReply);
    assert.equal(replies[0]?.error?.code, -32601);
    assert.equal(replies[1]?.error?.code, -32601);
    assert.equal(replies[2]?.error?.code, -32700);
    assert.equal(calls, 0, "no unknown method and no malformed line reaches the dispatcher");
    await client.close();
  },
);

test(
  "TOOL-05: initialize then realm/tool status then realm/tool write complete in order over in-memory stdio",
  { timeout: 10_000 },
  async (t) => {
    const h = makeHarness(t);
    const expectedStatus = await h.dispatcher.call({ status: {} });
    const expectedWrite = await h.dispatcher.call({ write: { path: "drive.txt", content: "hello" } });
    const client = startClient(t, h.dispatcher);
    send(client, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: 1 } });
    send(client, realmTool(2, { status: {} }));
    send(client, realmTool(3, { write: { path: "drive.txt", content: "hello" } }));
    await client.waitFor(3);
    const replies = client.lines.map(parseReply);
    assert.deepEqual(
      replies.map((reply) => reply.id),
      [1, 2, 3],
    );
    const init = replies[0]?.result as { protocolVersion: number };
    assert.equal(init.protocolVersion, 1);
    assert.deepEqual(replies[1]?.result, expectedStatus, "status outcome equals the dispatcher's own outcome");
    assert.deepEqual(replies[2]?.result, expectedWrite, "write outcome equals the dispatcher's own outcome");
    await client.close();
  },
);

test(
  "TOOL-05: the status outcome carries the shared displayStatus label, not an adapter-invented label",
  { timeout: 10_000 },
  async (t) => {
    const h = makeHarness(t);
    const client = startClient(t, h.dispatcher);
    send(client, realmTool(1, { status: {} }));
    await client.waitFor(1);
    const reply = parseReply(client.lines[0] ?? "");
    const outcome = reply.result as ToolOutcome;
    assert.equal(outcome.outcome, "done");
    assert.equal(outcome.tool, "status");
    if (outcome.outcome !== "done" || outcome.tool !== "status") {
      throw new Error("expected a status outcome");
    }
    assert.deepEqual(outcome.value.display, displayStatus(h.machine.snapshot()));
    await client.close();
  },
);

test(
  "TOOL-05: a required-mode refusal over the lifecycle drive equals the dispatcher's own refusal",
  { timeout: 10_000 },
  async (t) => {
    const h = makeHarness(t, { policy: REQUIRED, state: "degraded" });
    const call: ToolCall = { write: { path: "doc.txt", content: "blocked" } };
    const expected = await h.dispatcher.call(call);
    assert.equal(expected.outcome, "refused");
    const client = startClient(t, h.dispatcher);
    send(client, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: 1 } });
    send(client, realmTool(2, call));
    await client.waitFor(2);
    const replies = client.lines.map(parseReply);
    const init = replies[0]?.result as { protocolVersion: number };
    assert.equal(init.protocolVersion, 1);
    assert.deepEqual(replies[1]?.result, expected, "the refusal reply equals the dispatcher's own refusal");
    await client.close();
  },
);

test(
  "TOOL-05: a realm/tool notification without an id is never executed and takes no reply (MED-01)",
  { timeout: 10_000 },
  async (t) => {
    const h = makeHarness(t);
    const seen: unknown[] = [];
    const inner = h.dispatcher.call.bind(h.dispatcher);
    h.dispatcher.call = async (raw: unknown): Promise<ToolOutcome> => {
      seen.push(raw);
      return inner(raw);
    };
    const client = startClient(t, h.dispatcher);
    send(client, {
      jsonrpc: "2.0",
      method: REALM_TOOL_METHOD,
      params: { tool: { write: { path: "notify.txt", content: "never" } } },
    });
    send(client, realmTool(1, { status: {} }));
    await client.waitFor(1);
    assert.equal(client.lines.length, 1, "the notification takes no reply line");
    assert.equal(parseReply(client.lines[0] ?? "").id, 1);
    assert.deepEqual(seen, [{ status: {} }], "the id-less notification never reaches the dispatcher");
    await client.close();
  },
);

test(
  "TOOL-05: a request whose id is neither a string, number, nor null is refused with a null-id error and never dispatched (LOW-02)",
  { timeout: 10_000 },
  async (t) => {
    const h = makeHarness(t);
    const seen: unknown[] = [];
    const inner = h.dispatcher.call.bind(h.dispatcher);
    h.dispatcher.call = async (raw: unknown): Promise<ToolOutcome> => {
      seen.push(raw);
      return inner(raw);
    };
    const client = startClient(t, h.dispatcher);
    const status = { status: {} };
    for (const id of [true, { nested: 1 }, [1]]) {
      send(client, { jsonrpc: "2.0", id, method: REALM_TOOL_METHOD, params: { tool: status } });
    }
    send(client, realmTool(4, status));
    await client.waitFor(4);
    const replies = client.lines.map(parseReply);
    for (const reply of replies.slice(0, 3)) {
      assert.equal(reply.id, null, "an unusable id is answered with a null id, not a coerced copy");
      assert.equal(reply.error?.code, -32600, "the refusal is a typed Invalid Request");
    }
    assert.equal(replies[3]?.id, 4);
    assert.deepEqual(seen, [status], "only the valid request reached the dispatcher");
    await client.close();
  },
);

test("TOOL-05: a null request id is a legal JSON-RPC id and is answered with null (LOW-02)", { timeout: 10_000 }, async (t) => {
  const h = makeHarness(t);
  const client = startClient(t, h.dispatcher);
  send(client, { jsonrpc: "2.0", id: null, method: REALM_TOOL_METHOD, params: { tool: { status: {} } } });
  await client.waitFor(1);
  const reply = parseReply(client.lines[0] ?? "");
  assert.equal(reply.id, null);
  assert.equal((reply.result as ToolOutcome).outcome, "done");
  await client.close();
});

test(
  "TOOL-05: a realm/tool tool value that is not a ToolCall map is refused SCHEMA_INVALID by the dispatcher (LOW-01 parity)",
  { timeout: 10_000 },
  async (t) => {
    const h = makeHarness(t);
    const client = startClient(t, h.dispatcher);
    const tools: unknown[] = ["status", 7, ["status"], null];
    tools.forEach((tool, index) => {
      send(client, { jsonrpc: "2.0", id: index + 1, method: REALM_TOOL_METHOD, params: { tool } });
    });
    await client.waitFor(tools.length);
    const replies = client.lines.map(parseReply);
    replies.forEach((reply, index) => {
      const outcome = reply.result as Extract<ToolOutcome, { outcome: "refused" }>;
      assert.equal(reply.id, index + 1);
      assert.equal(outcome.outcome, "refused");
      assert.equal(outcome.code, "SCHEMA_INVALID");
    });
    await client.close();
  },
);

test(
  "TOOL-05: the adapter reads its input without changing the caller's stream encoding (LOW-03)",
  { timeout: 10_000 },
  async (t) => {
    const h = makeHarness(t);
    const input = new PassThrough();
    const before = input.readableEncoding;
    const client = startClient(t, h.dispatcher, input);
    send(client, realmTool(1, { status: {} }));
    await client.waitFor(1);
    assert.equal(parseReply(client.lines[0] ?? "").id, 1);
    assert.equal(input.readableEncoding, before, "the caller's stream keeps its encoding");
    await client.close();
  },
);

test(
  "TOOL-05: a multi-byte character split across stdin chunks reaches the dispatcher intact (LOW-03)",
  { timeout: 10_000 },
  async (t) => {
    const h = makeHarness(t);
    const seen: unknown[] = [];
    const inner = h.dispatcher.call.bind(h.dispatcher);
    h.dispatcher.call = async (raw: unknown): Promise<ToolOutcome> => {
      seen.push(raw);
      return inner(raw);
    };
    const client = startClient(t, h.dispatcher);
    const line = Buffer.from(
      `${JSON.stringify(realmTool(1, { write: { path: "utf8.txt", content: "h\u00e9llo" } }))}\n`,
      "utf8",
    );
    // 0xC3 opens the two-byte sequence for U+00E9; split between its two bytes.
    const split = line.indexOf(0xc3) + 1;
    client.input.write(line.subarray(0, split));
    client.input.write(line.subarray(split));
    await client.waitFor(1);
    assert.deepEqual(seen, [{ write: { path: "utf8.txt", content: "h\u00e9llo" } }]);
    await client.close();
  },
);

test(
  "TOOL-05: a diagnostic goes to stderr and stdout carries only protocol lines (LOW-04)",
  { timeout: 10_000 },
  async (t) => {
    const h = makeHarness(t);
    const client = startClient(t, h.dispatcher);
    client.input.write("this is not json\n");
    send(client, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: 1 } });
    await client.waitFor(2);
    assert.equal(client.lines.length, 2, "one protocol reply per request line");
    for (const line of client.lines) {
      parseReply(line);
    }
    assert.ok(
      client.lines.every((line) => !line.includes("realm acp agent")),
      "no diagnostic text reaches stdout",
    );
    assert.ok(
      client.diagnostics.some((line) => line.includes("discarded a malformed line")),
      "the diagnostic is written to stderr",
    );
    await client.close();
  },
);

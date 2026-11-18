// Hermetic tests of the Anthropic-format scripted provider (plan 35-03 Task 1): the pure encoders, and a real loopback socket.

import { test } from "node:test";
import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import { connect } from "node:net";
import {
  DEFAULT_SCRIPTED_TOOL,
  messageBody,
  ScriptedAnthropicProvider,
  sseBody,
  streamEvents,
  type MessageEnvelope,
  type ReplyPlan,
} from "./scripted-anthropic-provider.js";
import { testTimeout } from "./timing.js";

const ENVELOPE: MessageEnvelope = { id: "msg_unit", model: "unit-model", toolUseId: "toolu_unit" };
const TOOL_PLAN: ReplyPlan = { tool: { name: DEFAULT_SCRIPTED_TOOL, input: { a: 1 } } };
const TEXT_PLAN: ReplyPlan = { text: "hello" };
const REQUEST_TIMEOUT_MS = 10_000;

interface Reply {
  readonly status: number;
  readonly contentType: string;
  readonly body: string;
}

async function send(
  baseUrl: string,
  method: string,
  path: string,
  headers: Readonly<Record<string, string>>,
  body?: string,
): Promise<Reply> {
  const url = new URL(path, baseUrl);
  return new Promise<Reply>((resolve, reject) => {
    const req = httpRequest(
      { host: url.hostname, port: url.port, path: `${url.pathname}${url.search}`, method, headers, timeout: REQUEST_TIMEOUT_MS },
      (res) => {
        const parts: Buffer[] = [];
        res.on("data", (part: Buffer) => parts.push(part));
        res.on("end", () => {
          resolve({ status: res.statusCode ?? 0, contentType: res.headers["content-type"] ?? "", body: Buffer.concat(parts).toString("utf8") });
        });
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy(new Error("request timed out"));
    });
    req.end(body);
  });
}

function messagesBody(extra: Readonly<Record<string, unknown>> = {}): string {
  return JSON.stringify({
    model: "claude-unit",
    max_tokens: 16,
    messages: [{ role: "user", content: "SECRET-MESSAGE-TEXT" }],
    tools: [{ name: DEFAULT_SCRIPTED_TOOL, description: "SECRET-SCHEMA-TEXT", input_schema: { type: "object", properties: {} } }, { name: "mcp__realm__list" }],
    ...extra,
  });
}

function parseSse(body: string): readonly { readonly event: string; readonly data: Record<string, unknown> }[] {
  return body
    .split("\n\n")
    .filter((chunk) => chunk.length > 0)
    .map((chunk) => {
      const lines = chunk.split("\n");
      assert.equal(lines.length, 2);
      assert.ok(lines[0]?.startsWith("event: "));
      assert.ok(lines[1]?.startsWith("data: "));
      return { event: (lines[0] ?? "").slice("event: ".length), data: JSON.parse((lines[1] ?? "").slice("data: ".length)) as Record<string, unknown> };
    });
}

async function withProvider(run: (provider: ScriptedAnthropicProvider, baseUrl: string) => Promise<void>): Promise<void> {
  const provider = new ScriptedAnthropicProvider();
  const { baseUrl } = await provider.start();
  try {
    await run(provider, baseUrl);
  } finally {
    await provider.stop();
  }
}

void test("the streamed tool call has the events in order with the tool_use block and an input_json_delta", () => {
  const events = streamEvents(TOOL_PLAN, ENVELOPE);
  assert.deepEqual(
    events.map((entry) => entry.event),
    ["message_start", "content_block_start", "content_block_delta", "content_block_stop", "message_delta", "message_stop"],
  );
  const [start, blockStart, delta, , messageDelta] = events;
  assert.deepEqual(start?.data["message"], {
    id: "msg_unit",
    type: "message",
    role: "assistant",
    model: "unit-model",
    content: [],
    stop_reason: null,
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
  });
  assert.deepEqual(blockStart?.data, {
    type: "content_block_start",
    index: 0,
    content_block: { type: "tool_use", id: "toolu_unit", name: DEFAULT_SCRIPTED_TOOL, input: {} },
  });
  assert.deepEqual(delta?.data, { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"a":1}' } });
  assert.deepEqual((messageDelta?.data["delta"] as Record<string, unknown>)["stop_reason"], "tool_use");
});

void test("the streamed text has a text block with empty text, a text_delta and end_turn", () => {
  const events = streamEvents(TEXT_PLAN, ENVELOPE);
  assert.deepEqual(events[1]?.data["content_block"], { type: "text", text: "" });
  assert.deepEqual(events[2]?.data["delta"], { type: "text_delta", text: "hello" });
  assert.deepEqual((events[4]?.data["delta"] as Record<string, unknown>)["stop_reason"], "end_turn");
  assert.deepEqual(events[4]?.data["usage"], { output_tokens: 1 });
});

void test("the sse body writes an event line, a data line and a blank line per event", () => {
  const body = sseBody(streamEvents(TEXT_PLAN, ENVELOPE));
  assert.ok(body.endsWith("\n\n"));
  assert.equal(parseSse(body).length, 6);
  assert.ok(body.startsWith("event: message_start\ndata: {"));
});

void test("the non-streamed message carries the content block, the stop reason and the usage", () => {
  assert.deepEqual(messageBody(TOOL_PLAN, ENVELOPE), {
    id: "msg_unit",
    type: "message",
    role: "assistant",
    model: "unit-model",
    content: [{ type: "tool_use", id: "toolu_unit", name: DEFAULT_SCRIPTED_TOOL, input: { a: 1 } }],
    stop_reason: "tool_use",
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
  });
  const text = messageBody(TEXT_PLAN, ENVELOPE);
  assert.deepEqual(text["content"], [{ type: "text", text: "hello" }]);
  assert.equal(text["stop_reason"], "end_turn");
});

void test("a request offering the tool without a tool_result gets a tool_use reply, streamed and not", testTimeout(30_000), async () => {
  await withProvider(async (provider, baseUrl) => {
    const streamed = await send(baseUrl, "POST", "/v1/messages?beta=true", { "x-api-key": provider.apiKey, "content-type": "application/json" }, messagesBody({ stream: true }));
    assert.equal(streamed.status, 200);
    assert.match(streamed.contentType, /text\/event-stream/);
    const events = parseSse(streamed.body);
    assert.equal(events[1]?.data["content_block"] !== undefined, true);
    assert.deepEqual((events[1]?.data["content_block"] as Record<string, unknown>)["name"], DEFAULT_SCRIPTED_TOOL);
    assert.match(String((events[1]?.data["content_block"] as Record<string, unknown>)["id"]), /^toolu_\d+$/);
    const plain = await send(baseUrl, "POST", "/v1/messages", { authorization: `Bearer ${provider.apiKey}`, "content-type": "application/json" }, messagesBody());
    assert.equal(plain.status, 200);
    assert.match(plain.contentType, /application\/json/);
    const message = JSON.parse(plain.body) as Record<string, unknown>;
    assert.equal(message["stop_reason"], "tool_use");
    assert.equal(provider.messageRequests.length, 2);
    assert.deepEqual(provider.messageRequests.map((entry) => entry.streamed), [true, false]);
    assert.equal(provider.failures.length, 0);
  });
});

void test("the request after a tool_result gets the final text", testTimeout(30_000), async () => {
  await withProvider(async (provider, baseUrl) => {
    const body = JSON.stringify({
      model: "claude-unit",
      messages: [
        { role: "user", content: "go" },
        { role: "assistant", content: [{ type: "tool_use", id: "toolu_x", name: DEFAULT_SCRIPTED_TOOL, input: {} }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_x", content: "ok" }] },
      ],
      tools: [{ name: DEFAULT_SCRIPTED_TOOL }],
      stream: true,
    });
    const reply = await send(baseUrl, "POST", "/v1/messages", { "x-api-key": provider.apiKey }, body);
    assert.equal(reply.status, 200);
    const events = parseSse(reply.body);
    assert.deepEqual(events[2]?.data["delta"], { type: "text_delta", text: "done" });
    const [recorded] = provider.messageRequests;
    assert.ok(recorded !== undefined, "the request was recorded");
    assert.equal(recorded.hasToolResult, true);
    assert.equal(recorded.messageCount, 3);
  });
});

void test("a request that does not offer the tool gets the final text", testTimeout(30_000), async () => {
  await withProvider(async (provider, baseUrl) => {
    const reply = await send(baseUrl, "POST", "/v1/messages", { "x-api-key": provider.apiKey }, JSON.stringify({ model: "m", messages: [{ role: "user", content: "title" }] }));
    assert.equal(reply.status, 200);
    assert.equal((JSON.parse(reply.body) as Record<string, unknown>)["stop_reason"], "end_turn");
  });
});

void test("a wrong or missing key is a 401 with an Anthropic-shaped error and is recorded as rejected", testTimeout(30_000), async () => {
  await withProvider(async (provider, baseUrl) => {
    const wrong = await send(baseUrl, "POST", "/v1/messages", { "x-api-key": "not-the-key" }, messagesBody());
    const missing = await send(baseUrl, "POST", "/v1/messages", {}, messagesBody());
    for (const reply of [wrong, missing]) {
      assert.equal(reply.status, 401);
      const error = JSON.parse(reply.body) as { type: string; error: { type: string } };
      assert.equal(error.type, "error");
      assert.equal(error.error.type, "authentication_error");
    }
    assert.equal(provider.rejected.length, 2);
    assert.equal(provider.messageRequests.length, 0);
  });
});

void test("a proxy-form request and CONNECT are refused with 403 and never answered", testTimeout(30_000), async () => {
  await withProvider(async (provider, baseUrl) => {
    const origin = new URL(baseUrl);
    const raw = await new Promise<string>((resolve, reject) => {
      const socket = connect({ host: origin.hostname, port: Number(origin.port) }, () => {
        socket.write(`POST http://example.invalid/v1/messages HTTP/1.1\r\nHost: example.invalid\r\nx-api-key: ${provider.apiKey}\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}`);
      });
      const parts: Buffer[] = [];
      socket.on("data", (part: Buffer) => parts.push(part));
      socket.on("close", () => {
        resolve(Buffer.concat(parts).toString("utf8"));
      });
      socket.on("error", reject);
      socket.setTimeout(REQUEST_TIMEOUT_MS, () => {
        socket.destroy(new Error("socket timed out"));
      });
    });
    assert.match(raw, /^HTTP\/1\.1 403 /);
    const connectReply = await new Promise<string>((resolve, reject) => {
      const socket = connect({ host: origin.hostname, port: Number(origin.port) }, () => {
        socket.write("CONNECT example.invalid:443 HTTP/1.1\r\nHost: example.invalid:443\r\n\r\n");
      });
      const parts: Buffer[] = [];
      socket.on("data", (part: Buffer) => parts.push(part));
      socket.on("close", () => {
        resolve(Buffer.concat(parts).toString("utf8"));
      });
      socket.on("error", reject);
      socket.setTimeout(REQUEST_TIMEOUT_MS, () => {
        socket.destroy(new Error("socket timed out"));
      });
    });
    assert.match(connectReply, /^HTTP\/1\.1 403 /);
    assert.equal(provider.proxyRefusals.length, 2);
    assert.equal(provider.requests.length, 0);
  });
});

void test("an unknown path is a 404 with an Anthropic-shaped error and is recorded", testTimeout(30_000), async () => {
  await withProvider(async (provider, baseUrl) => {
    const reply = await send(baseUrl, "POST", "/v1/nope", { "x-api-key": provider.apiKey }, "{}");
    assert.equal(reply.status, 404);
    assert.equal((JSON.parse(reply.body) as { error: { type: string } }).error.type, "not_found_error");
    assert.deepEqual(provider.requests.map((entry) => entry.route), ["other"]);
  });
});

void test("a body over one MiB is a 413 and bad JSON is a 400", testTimeout(30_000), async () => {
  await withProvider(async (provider, baseUrl) => {
    const headers = { "x-api-key": provider.apiKey, "content-type": "application/json" };
    const big = await send(baseUrl, "POST", "/v1/messages", headers, JSON.stringify({ messages: [], pad: "x".repeat(1024 * 1024 + 16) }));
    assert.equal(big.status, 413);
    const bad = await send(baseUrl, "POST", "/v1/messages", headers, "{not json");
    assert.equal(bad.status, 400);
    const notObject = await send(baseUrl, "POST", "/v1/messages", headers, "[1]");
    assert.equal(notObject.status, 400);
    assert.equal(provider.messageRequests.every((entry) => entry.toolsOffered.length === 0), true);
  });
});

void test("the count route answers input_tokens 1 and the models route an empty list", testTimeout(30_000), async () => {
  await withProvider(async (provider, baseUrl) => {
    const count = await send(baseUrl, "POST", "/v1/messages/count_tokens?beta=true", { "x-api-key": provider.apiKey }, messagesBody());
    assert.equal(count.status, 200);
    assert.deepEqual(JSON.parse(count.body), { input_tokens: 1 });
    const models = await send(baseUrl, "GET", "/v1/models", {});
    assert.equal(models.status, 200);
    assert.deepEqual((JSON.parse(models.body) as { data: unknown[] }).data, []);
    assert.deepEqual(provider.requests.map((entry) => entry.route), ["count_tokens", "models"]);
  });
});

void test("a recorded request holds names and booleans only: no message text, no schema text, no key", testTimeout(30_000), async () => {
  await withProvider(async (provider, baseUrl) => {
    await send(baseUrl, "POST", "/v1/messages", { "x-api-key": provider.apiKey }, messagesBody());
    await send(baseUrl, "POST", "/v1/messages", { "x-api-key": "wrong-key-value" }, messagesBody());
    const dump = JSON.stringify(provider.requests);
    assert.equal(dump.includes("SECRET-MESSAGE-TEXT"), false);
    assert.equal(dump.includes("SECRET-SCHEMA-TEXT"), false);
    assert.equal(dump.includes(provider.apiKey), false);
    assert.equal(dump.includes("wrong-key-value"), false);
    const [first] = provider.requests;
    assert.deepEqual(first, {
      route: "messages",
      keyAccepted: true,
      model: "claude-unit",
      toolsOffered: [DEFAULT_SCRIPTED_TOOL, "mcp__realm__list"],
      hasToolResult: false,
      messageCount: 1,
      streamed: false,
    });
  });
});

void test("the turn function and forceNonStreamed are injectable", testTimeout(30_000), async () => {
  const provider = new ScriptedAnthropicProvider({ turn: () => ({ text: "custom" }), forceNonStreamed: true });
  const { baseUrl } = await provider.start();
  try {
    const reply = await send(baseUrl, "POST", "/v1/messages", { "x-api-key": provider.apiKey }, messagesBody({ stream: true }));
    assert.match(reply.contentType, /application\/json/);
    assert.deepEqual((JSON.parse(reply.body) as { content: unknown[] }).content, [{ type: "text", text: "custom" }]);
    assert.equal(provider.messageRequests[0]?.streamed, true);
  } finally {
    await provider.stop();
  }
});

void test("stop is idempotent and leaves no listener; the listener is loopback", testTimeout(30_000), async () => {
  const provider = new ScriptedAnthropicProvider();
  const { baseUrl, port } = await provider.start();
  assert.equal(new URL(baseUrl).hostname, "127.0.0.1");
  await provider.stop();
  await provider.stop();
  await assert.rejects(send(baseUrl, "GET", "/v1/models", {}), /ECONNREFUSED|socket hang up|ECONNRESET/);
  assert.ok(port > 0);
});

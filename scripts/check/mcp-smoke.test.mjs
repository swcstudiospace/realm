import { test } from "node:test";
import assert from "node:assert/strict";
import { LEGACY_VERSION, MODERN_VERSION, checkEras, compareStatus } from "./mcp-smoke.mjs";

// The smoke gate decides whether the built server speaks both protocol eras in the shapes the revisions name. These
// tests feed it the replies a conforming server gives, and then one broken reply at a time, so a gate that stops
// checking a shape fails here.

const VERSION = "1.2.3";
const STATUS_OUTCOME = {
  outcome: "done",
  tool: "status",
  value: {
    snapshot: { state: "active", reason: "ready", lastTransitionAt: "2026-10-29T00:00:00.000Z" },
    display: { label: "realm active", degraded: false, reason: "ready", lastTransitionAt: "2026-10-29T00:00:00.000Z" },
  },
};
const TOOLS = ["exec", "read", "write", "list", "status", "retry"].map((name) => ({ name, description: name, inputSchema: { type: "object" } }));

function toolResult(outcome, extra = {}) {
  return { content: [{ type: "text", text: JSON.stringify(outcome) }], structuredContent: outcome, isError: false, ...extra };
}

// The seven replies of main()'s session, as a conforming server answers them.
function conformingReplies() {
  return [
    { id: 1, result: { protocolVersion: LEGACY_VERSION, capabilities: { tools: {} }, serverInfo: { name: "agent-realm", version: VERSION } } },
    { id: 2, result: { tools: TOOLS } },
    { id: 3, result: toolResult(STATUS_OUTCOME) },
    {
      id: 4,
      result: {
        resultType: "complete",
        supportedVersions: [MODERN_VERSION, "2025-11-25", LEGACY_VERSION],
        capabilities: { tools: {} },
        _meta: { "io.modelcontextprotocol/serverInfo": { name: "agent-realm", version: VERSION } },
        ttlMs: 3600000,
        cacheScope: "public",
      },
    },
    { id: 5, result: { resultType: "complete", tools: TOOLS, ttlMs: 300000, cacheScope: "public" } },
    { id: 6, result: toolResult(STATUS_OUTCOME, { resultType: "complete" }) },
    { id: 7, error: { code: -32022, message: "Unsupported protocol version", data: { supported: [MODERN_VERSION, "2025-11-25", LEGACY_VERSION], requested: "1900-01-01" } } },
  ];
}

// A copy of the conforming replies with one reply replaced by mutate(result).
function withReply(id, mutate) {
  return conformingReplies().map((reply) => (reply.id === id ? mutate(structuredClone(reply)) : reply));
}

test("checkEras accepts a conforming dual-era session and returns the two status results", () => {
  const { legacyCall, modernCall } = checkEras(conformingReplies(), VERSION);
  assert.equal(legacyCall.resultType, undefined);
  assert.equal(modernCall.resultType, "complete");
});

test("checkEras rejects a handshake that answers another revision or a placeholder version", () => {
  const wrongRevision = withReply(1, (reply) => ({ ...reply, result: { ...reply.result, protocolVersion: MODERN_VERSION } }));
  assert.throws(() => checkEras(wrongRevision, VERSION), /initialize must answer/);
  const placeholder = withReply(1, (reply) => ({ ...reply, result: { ...reply.result, serverInfo: { name: "agent-realm", version: "0.0.0" } } }));
  assert.throws(() => checkEras(placeholder, VERSION), /serverInfo.version must be 1.2.3/);
});

test("checkEras rejects a tool result a host could not show to the model", () => {
  const noContent = withReply(3, (reply) => ({ ...reply, result: { structuredContent: STATUS_OUTCOME, isError: false } }));
  assert.throws(() => checkEras(noContent, VERSION), /legacy tools\/call needs a text content block/);
  const bare = withReply(6, (reply) => ({ ...reply, result: STATUS_OUTCOME }));
  assert.throws(() => checkEras(bare, VERSION), /modern tools\/call needs resultType/);
});

test("checkEras rejects a legacy result that carries resultType, and a modern one that lacks it", () => {
  const stamped = withReply(2, (reply) => ({ ...reply, result: { ...reply.result, resultType: "complete" } }));
  assert.throws(() => checkEras(stamped, VERSION), /legacy result carries no resultType/);
  const missing = withReply(5, (reply) => ({ ...reply, result: { tools: TOOLS } }));
  assert.throws(() => checkEras(missing, VERSION), /modern tools\/list needs resultType, ttlMs and cacheScope/);
});

test("checkEras rejects a DiscoverResult in the old shape", () => {
  const old = withReply(4, (reply) => ({
    ...reply,
    result: { protocolVersion: MODERN_VERSION, server: { name: "agent-realm", version: VERSION }, capabilities: { tools: {} } },
  }));
  assert.throws(() => checkEras(old, VERSION), /server\/discover result needs resultType/);
});

test("checkEras rejects an unsupported version that is not answered with -32022 and the supported list", () => {
  const plain = withReply(7, (reply) => ({ id: reply.id, error: { code: -32601, message: "Method not found" } }));
  assert.throws(() => checkEras(plain, VERSION), /must answer -32022/);
  const noList = withReply(7, (reply) => ({ id: reply.id, error: { code: -32022, message: "Unsupported protocol version", data: { requested: "1900-01-01" } } }));
  assert.throws(() => checkEras(noList, VERSION), /must list the supported versions/);
});

test("checkEras reports a missing reply by id", () => {
  assert.throws(() => checkEras(conformingReplies().filter((reply) => reply.id !== 5), VERSION), /no reply for id 5/);
});

test("compareStatus passes when the MCP outcome carries the CLI's snapshot and display", () => {
  const cli = JSON.stringify(STATUS_OUTCOME.value);
  assert.deepEqual(compareStatus(cli, toolResult(STATUS_OUTCOME)), { ok: true, mode: "active" });
});

test("compareStatus fails on a differing display, on an error result, and on the old bare shape", () => {
  const cli = JSON.stringify(STATUS_OUTCOME.value);
  const drifted = { ...STATUS_OUTCOME, value: { ...STATUS_OUTCOME.value, display: { ...STATUS_OUTCOME.value.display, label: "realm disconnected" } } };
  assert.equal(compareStatus(cli, toolResult(drifted)).ok, false);
  assert.equal(compareStatus(cli, toolResult(STATUS_OUTCOME, { isError: true })).ok, false);
  assert.equal(compareStatus(cli, STATUS_OUTCOME).ok, false, "an outcome without the tool result envelope is not a valid MCP result");
});

test("compareStatus accepts a disconnected CLI only against a REALM_NOT_ACTIVE tool error", () => {
  const refusedOutcome = { outcome: "refused", tool: "status", code: "REALM_NOT_ACTIVE", retryable: false };
  assert.deepEqual(compareStatus("disconnected\n", toolResult(refusedOutcome, { isError: true })), { ok: true, mode: "disconnected" });
  const thrown = { isError: true, content: [{ type: "text", text: "REALM_NOT_ACTIVE: x" }], structuredContent: { code: "REALM_NOT_ACTIVE", message: "x", retryable: false } };
  assert.deepEqual(compareStatus("disconnected", thrown), { ok: true, mode: "disconnected" });
  assert.equal(compareStatus("disconnected", toolResult(STATUS_OUTCOME)).ok, false);
});

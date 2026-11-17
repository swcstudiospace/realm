import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EXPECTED_ANNOTATIONS, LEGACY_VERSION, MODERN_VERSION, checkEras, compareStatus, describeMarker, readMarker } from "./mcp-smoke.mjs";

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
const TOOLS = Object.entries(EXPECTED_ANNOTATIONS).map(([name, annotations]) => ({
  name,
  title: annotations.title,
  description: name,
  inputSchema: { type: "object" },
  annotations: { ...annotations },
}));

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

test("checkEras accepts the conforming session and both fixture lists carry annotations", () => {
  const replies = conformingReplies();
  checkEras(replies, VERSION);
  for (const id of [2, 5]) {
    const tools = replies.find((reply) => reply.id === id).result.tools;
    assert.equal(tools.length, 6);
    for (const tool of tools) {
      assert.equal(typeof tool.annotations, "object");
      assert.equal(tool.annotations.title, tool.title);
    }
  }
});

// Every seeded fault of the annotation check: per era (legacy reply 2, modern reply 5) and per tool, a flipped hint (4),
// a deleted annotations object, an extra key and a changed title; plus each tool dropped from both lists.
function annotationMutants() {
  const mutants = [];
  const eras = [["legacy", 2], ["modern", 5]];
  for (const [era, id] of eras) {
    for (const name of Object.keys(EXPECTED_ANNOTATIONS)) {
      const edit = (label, change) => {
        mutants.push({
          label: `${era} ${name}: ${label}`,
          name,
          replies: withReply(id, (reply) => {
            change(reply.result.tools.find((tool) => tool.name === name));
            return reply;
          }),
        });
      };
      for (const hint of ["readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint"]) {
        edit(`flip ${hint}`, (tool) => {
          tool.annotations[hint] = !tool.annotations[hint];
        });
      }
      edit("delete annotations", (tool) => {
        delete tool.annotations;
      });
      edit("extra key", (tool) => {
        tool.annotations.trustedByHost = true;
      });
      edit("change title", (tool) => {
        tool.title = `${tool.title} (changed)`;
      });
    }
  }
  for (const name of Object.keys(EXPECTED_ANNOTATIONS)) {
    mutants.push({
      label: `both eras: drop ${name}`,
      name,
      replies: conformingReplies().map((reply) =>
        reply.id === 2 || reply.id === 5
          ? { ...reply, result: { ...reply.result, tools: reply.result.tools.filter((tool) => tool.name !== name) } }
          : reply,
      ),
    });
  }
  return mutants;
}

test("checkEras rejects each seeded annotation fault in each era", () => {
  const mutants = annotationMutants();
  assert.equal(mutants.length, 90, "the generator must make exactly 90 mutants");
  for (const mutant of mutants) {
    let message;
    try {
      checkEras(mutant.replies, VERSION);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    assert.notEqual(message, undefined, `${mutant.label}: checkEras must throw`);
    assert.match(message, new RegExp(`(tool |include )${mutant.name}\\b`), `${mutant.label}: the message must name the tool, got ${String(message)}`);
  }
});

test("checkEras rejects an era that differs from the other", () => {
  const swapped = withReply(5, (reply) => {
    const tools = reply.result.tools;
    [tools[0], tools[1]] = [tools[1], tools[0]];
    return reply;
  });
  assert.throws(() => checkEras(swapped, VERSION), /both eras must list identical tool objects/);
});

test("EXPECTED_ANNOTATIONS names exactly the six tools with the five keys each and no tool is both read-only and destructive", () => {
  assert.deepEqual(Object.keys(EXPECTED_ANNOTATIONS), ["exec", "read", "write", "list", "status", "retry"]);
  for (const [name, row] of Object.entries(EXPECTED_ANNOTATIONS)) {
    assert.deepEqual(Object.keys(row).sort(), ["destructiveHint", "idempotentHint", "openWorldHint", "readOnlyHint", "title"], name);
    for (const hint of ["readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint"]) {
      assert.equal(typeof row[hint], "boolean", `${name} ${hint}`);
    }
    assert.equal(typeof row.title, "string", name);
    assert.ok(!(row.readOnlyHint && row.destructiveHint), `${name} is both read-only and destructive`);
  }
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

// The presence marker the smoke reads from a real `realm mcp --host claude` (src/host/presence.ts writes it).
const MARKER = { schemaVersion: 1, pid: 4242, startedAt: "2026-11-17T10:00:00.000Z", sessionId: "p0123456789ab", attach: "attached", code: null };

test("describeMarker accepts an attached marker and a failed marker with a catalogue code, and names why it refuses the rest", () => {
  assert.equal(describeMarker(MARKER, 4242), null);
  assert.equal(describeMarker({ ...MARKER, attach: "failed", code: "PODMAN_MISSING" }, 4242), null);
  assert.match(describeMarker(null, 4242), /no marker/);
  assert.match(describeMarker({ ...MARKER, extra: 1 }, 4242), /six keys/);
  const short = Object.fromEntries(Object.entries(MARKER).filter(([key]) => key !== "sessionId"));
  assert.match(describeMarker(short, 4242), /six keys/);
  assert.match(describeMarker(MARKER, 4243), /child pid/);
  assert.match(describeMarker({ ...MARKER, schemaVersion: 2 }, 4242), /schemaVersion 1/);
  assert.match(describeMarker({ ...MARKER, attach: "done" }, 4242), /attach/);
  assert.match(describeMarker({ ...MARKER, attach: "failed", code: "not a code" }, 4242), /code/);
  assert.match(describeMarker({ unreadable: true }, 4242), /six keys/);
});

test("readMarker reads <state>/hosts/<host>-active/<pid>.json, null when absent, and flags a file that is not an object", () => {
  const stateDir = mkdtempSync(join(tmpdir(), "realm-smoke-marker-"));
  try {
    assert.equal(readMarker(stateDir, "claude", 4242), null);
    const dir = join(stateDir, "hosts", "claude-active");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "4242.json"), `${JSON.stringify(MARKER)}\n`);
    assert.deepEqual(readMarker(stateDir, "claude", 4242), MARKER);
    assert.equal(readMarker(stateDir, "codex", 4242), null, "another host's directory is not read");
    writeFileSync(join(dir, "4243.json"), "[1]\n");
    assert.deepEqual(readMarker(stateDir, "claude", 4243), { unreadable: true });
    writeFileSync(join(dir, "4244.json"), "not json");
    assert.deepEqual(readMarker(stateDir, "claude", 4244), { unreadable: true });
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
  }
});

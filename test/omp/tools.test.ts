import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type { ToolCall } from "../../src/contract/validate.js";
import { makeRealmError } from "../../src/core/errors.js";
import type { StateSnapshot } from "../../src/core/state-machine.js";
import type { ToolOutcome } from "../../src/tools/dispatch.js";
import {
  PASS_THROUGH_HOST_TOOLS,
  READ_ONLY_HOST_TOOLS,
  REALM_TOOL_NAMES,
  failClosedToolNames,
  realmToolDefinitions,
  sameToolNames,
  type HostToolDefinition,
} from "../../src/omp/tools.js";

// OMPX-02 and OMPX-03: the Realm tool definitions and the fail-closed allowlist (src/omp/tools.ts). The daemon is a
// stub that records each frozen ToolCall; the real dispatcher and its validation are covered by their own suites.

// The names Omp 18.12.6 reports once the Realm tools are registered: the built-ins, with the Realm read and write in
// place of the built-ins of the same name (docs/integration/omp.md, Enforcement spike S1, S2a and S6).
const OMP_NAMES_WITH_REALM_TOOLS = [
  "ask",
  "ast_edit",
  "bash",
  "debug",
  "edit",
  "eval",
  "glob",
  "grep",
  "lsp",
  "task",
  "todo",
  "web_search",
  "wait",
  "exec",
  "list",
  "read",
  "status",
  "write",
];

const ACTIVE_SNAPSHOT: StateSnapshot = {
  state: "active",
  reason: "container running",
  lastTransitionAt: "2026-10-30T09:00:00.000Z",
};

const REFUSAL: ToolOutcome = { outcome: "refused", tool: null, code: "SCHEMA_INVALID", retryable: false };

function definitionNamed(defs: readonly HostToolDefinition[], name: string): HostToolDefinition {
  const found = defs.find((tool) => tool.name === name);
  assert.ok(found !== undefined, `${name} is defined`);
  return found;
}

void test("OMPX-02: the Realm tool names are exec, read, write, list and status, with no glob and no retry", () => {
  assert.deepEqual([...REALM_TOOL_NAMES], ["exec", "read", "write", "list", "status"]);
  const names: readonly string[] = REALM_TOOL_NAMES;
  assert.ok(!names.includes("glob"), "no glob tool");
  assert.ok(!names.includes("retry"), "retry is the realm-retry command, not a tool");
});

void test("OMPX-02: realmToolDefinitions defines one tool per Realm name, with its approval tier and a schema hint", () => {
  const defs = realmToolDefinitions(() => Promise.resolve(REFUSAL));
  assert.deepEqual(
    defs.map((tool) => tool.name),
    ["exec", "read", "write", "list", "status"],
  );
  assert.deepEqual(Object.fromEntries(defs.map((tool) => [tool.name, tool.approval])), {
    exec: "exec",
    read: "read",
    write: "write",
    list: "read",
    status: "read",
  });
  for (const tool of defs) {
    assert.equal(tool.loadMode, "essential", `${tool.name} is offered to the model`);
    assert.equal(tool.label, `Realm ${tool.name}`);
    assert.equal(tool.parameters["type"], "object");
    assert.equal(tool.parameters["additionalProperties"], false, `${tool.name} names no unknown key`);
  }
  assert.deepEqual(definitionNamed(defs, "read").parameters["required"], ["path", "maxBytes"]);
  assert.deepEqual(definitionNamed(defs, "write").parameters["required"], ["path", "content"]);
  assert.deepEqual(definitionNamed(defs, "list").parameters["required"], ["path", "depth"]);
});

void test("OMPX-02: each Realm tool sends its input under its own key as one frozen ToolCall, and status sends an empty input", async () => {
  const sent: ToolCall[] = [];
  const defs = realmToolDefinitions((call) => {
    sent.push(call);
    return Promise.resolve(REFUSAL);
  });
  await definitionNamed(defs, "exec").execute("call-1", { argv: ["ls"] });
  await definitionNamed(defs, "read").execute("call-2", { path: "a.txt", maxBytes: 4 });
  await definitionNamed(defs, "write").execute("call-3", { path: "a.txt", content: "x", ifMatchSha256: "a".repeat(64) });
  await definitionNamed(defs, "list").execute("call-4", { path: ".", depth: 0 });
  await definitionNamed(defs, "status").execute("call-5", {});
  assert.deepEqual(sent, [
    { exec: { argv: ["ls"] } },
    { read: { path: "a.txt", maxBytes: 4 } },
    { write: { path: "a.txt", content: "x", ifMatchSha256: "a".repeat(64) } },
    { list: { path: ".", depth: 0 } },
    { status: {} },
  ]);
  for (const call of sent) {
    assert.equal(Object.keys(call).length, 1, "a ToolCall has exactly one key, the tool name");
  }
});

void test("OMPX-02: a done outcome is a success result, and a refusal is an error result; both carry the outcome as JSON text", async () => {
  const done: ToolOutcome = { outcome: "done", tool: "retry", value: ACTIVE_SNAPSHOT };
  const ok = await definitionNamed(realmToolDefinitions(() => Promise.resolve(done)), "status").execute("call-1", {});
  assert.equal(ok.isError, false);
  assert.deepEqual(ok.details, done);
  assert.deepEqual(ok.content, [{ type: "text", text: JSON.stringify(done) }]);

  const refused = await definitionNamed(realmToolDefinitions(() => Promise.resolve(REFUSAL)), "write").execute("call-2", {});
  assert.equal(refused.isError, true);
  assert.deepEqual(refused.details, REFUSAL);
});

void test("OMPX-02: a RealmError from the daemon keeps its catalogue code and cause, and any other failure is refused as REALM_NOT_ACTIVE", async () => {
  const realm = realmToolDefinitions(() => Promise.reject(makeRealmError("POLICY_DENIED", "SHELL_NOT_ALLOWED")));
  const denied = await definitionNamed(realm, "exec").execute("call-1", { argv: ["ls"] });
  assert.deepEqual(denied.details, {
    outcome: "refused",
    tool: "exec",
    code: "POLICY_DENIED",
    retryable: false,
    causeCode: "SHELL_NOT_ALLOWED",
  });
  assert.equal(denied.isError, true);

  const other = realmToolDefinitions(() => Promise.reject(new TypeError("the socket closed")));
  const lost = await definitionNamed(other, "list").execute("call-2", { path: ".", depth: 0 });
  assert.deepEqual(lost.details, { outcome: "refused", tool: "list", code: "REALM_NOT_ACTIVE", retryable: true });
});

void test("OMPX-03: failClosedToolNames keeps the read-only built-ins and the Realm tools, and removes every other name", () => {
  assert.deepEqual(failClosedToolNames(OMP_NAMES_WITH_REALM_TOOLS).sort(), [
    "ask",
    "exec",
    "glob",
    "grep",
    "list",
    "read",
    "status",
    "todo",
    "wait",
    "write",
  ]);
  assert.deepEqual(failClosedToolNames(["bash", "bash", "edit", "mcp__other__tool"]), []);
});

void test("OMPX-03: sameToolNames compares the set of names, not their order, and counts a duplicate as a difference", () => {
  assert.equal(sameToolNames(["b", "a"], ["a", "b"]), true);
  assert.equal(sameToolNames(["a"], ["a", "b"]), false);
  assert.equal(sameToolNames(["a", "a"], ["a"]), false);
});

void test("OMPX-02: the pass-through names are the Realm tools, the read-only built-ins and retry", () => {
  assert.deepEqual([...READ_ONLY_HOST_TOOLS].sort(), ["ask", "glob", "grep", "todo", "wait"]);
  assert.deepEqual([...PASS_THROUGH_HOST_TOOLS].sort(), [
    "ask",
    "exec",
    "glob",
    "grep",
    "list",
    "read",
    "retry",
    "status",
    "todo",
    "wait",
    "write",
  ]);
});

for (const wire of [false, true]) {
  for (const sample of [
    { text: "héllo 🙂\n", truncated: false },
    { text: "", truncated: false },
    { text: "prefix", truncated: true },
  ]) {
    void test(`OMPX-02: registered read renders ${wire ? "serialized Buffer" : "Uint8Array"} (${sample.text.length === 0 ? "empty" : sample.truncated ? "truncated" : "UTF-8"}) text and metadata`, async () => {
      const buffer = Buffer.from(sample.text);
      const sha256 = createHash("sha256").update(buffer).digest("hex");
      const value = { status: "found" as const, content: wire ? buffer : new Uint8Array(buffer), sha256, truncated: sample.truncated };
      const done: ToolOutcome = { outcome: "done", tool: "read", value };
      // Serialize the whole Buffer outcome exactly as the daemon channel does.
      const outcome: ToolOutcome = wire ? JSON.parse(JSON.stringify(done)) as ToolOutcome : done;
      const sent: ToolCall[] = [];
      const defs = realmToolDefinitions((call) => {
        sent.push(call);
        return Promise.resolve(outcome);
      });
      const result = await definitionNamed(defs, "read").execute("read-consumer", { path: "notes.txt", maxBytes: 100 });
      assert.deepEqual(sent, [{ read: { path: "notes.txt", maxBytes: 100 } }]);
      assert.equal(result.isError, false);
      assert.deepEqual(result.content, [
        { type: "text", text: sample.text },
        { type: "text", text: `[realm read] truncated=${String(sample.truncated)} sha256=${sha256}` },
      ]);
      assert.deepEqual(result.details, {
        outcome: "done", tool: "read",
        value: { status: "found", sha256, truncated: sample.truncated, bytes: buffer.byteLength },
      });
    });
  }
}

void test("OMPX-02: registered read rejects malformed serialized bytes instead of coercing them into file text", async () => {
  for (const content of [
    null, "not bytes", { type: "Buffer", data: "text" }, { type: "Other", data: [65] },
    { type: "Buffer", data: [-1] }, { type: "Buffer", data: [256] },
    { type: "Buffer", data: [65.5] }, { type: "Buffer", data: ["65"] },
    { type: "Buffer", data: [null] },
  ]) {
    const outcome = JSON.parse(JSON.stringify({
      outcome: "done", tool: "read",
      value: { status: "found", content, sha256: "a".repeat(64), truncated: false },
    })) as ToolOutcome;
    const read = definitionNamed(realmToolDefinitions(() => Promise.resolve(outcome)), "read");
    const result = await read.execute("invalid-read", { path: "notes.txt", maxBytes: 100 });
    assert.equal(result.isError, true);
    assert.deepEqual(result.details, { outcome: "refused", tool: "read", code: "SCHEMA_INVALID", retryable: false });
    assert.deepEqual(result.content, [{ type: "text", text: JSON.stringify(result.details) }]);
  }
});

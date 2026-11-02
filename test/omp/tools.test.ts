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
  planHostTools,
  realmToolDefinitions,
  sameToolNames,
  type HostToolDefinition,
  type HostToolResult,
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

void test("OMPX-03: failClosedToolNames keeps bash, the read-only built-ins and the Realm tools, and removes every other name", () => {
  assert.deepEqual(failClosedToolNames(OMP_NAMES_WITH_REALM_TOOLS).sort(), [
    "ask",
    "bash",
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
  assert.deepEqual(failClosedToolNames(["bash", "bash", "edit", "mcp__other__tool"]), ["bash"]);
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

// OMPX-03, OMPX-04 and P16 (c, d): the plan the host tool set is brought to, for a policy mode, from what Omp reports now.
void test("B1 and B9: advisory plans every tool Omp reports, the Realm write included, and owes nothing", () => {
  const plan = planHostTools("advisory", OMP_NAMES_WITH_REALM_TOOLS, OMP_NAMES_WITH_REALM_TOOLS, []);
  assert.deepEqual(sortedOf(plan.wanted), sortedOf(OMP_NAMES_WITH_REALM_TOOLS));
  assert.ok(plan.wanted.includes("write"), "the Realm write is wanted whatever the realm state");
  assert.deepEqual(plan.owed, []);
});

void test("OMPX-03: fail-closed plans the allowlist and owes every other registered tool it removes", () => {
  const plan = planHostTools("fail-closed", OMP_NAMES_WITH_REALM_TOOLS, OMP_NAMES_WITH_REALM_TOOLS, []);
  assert.deepEqual(sortedOf(plan.wanted), sortedOf(failClosedToolNames(OMP_NAMES_WITH_REALM_TOOLS)));
  for (const name of ["edit", "web_search"]) {
    assert.ok(plan.owed.includes(name), `${name} is owed`);
  }
  assert.ok(!plan.owed.includes("bash"), "bash is kept, so it is not owed");
  assert.ok(!plan.owed.includes("write"), "the Realm write is kept, not owed");
});

void test("OMPX-03: leaving fail-closed gives back the built-ins it removed", () => {
  const closed = planHostTools("fail-closed", OMP_NAMES_WITH_REALM_TOOLS, OMP_NAMES_WITH_REALM_TOOLS, []);
  const open = planHostTools("advisory", OMP_NAMES_WITH_REALM_TOOLS, closed.wanted, closed.owed);
  assert.deepEqual(sortedOf(open.wanted), sortedOf(OMP_NAMES_WITH_REALM_TOOLS));
  assert.deepEqual(open.owed, []);
});

void test("P16 (c): fail-closed plans a tool another extension adds as removed, so a drift in the same mode is restored", () => {
  const plan = planHostTools(
    "fail-closed",
    [...OMP_NAMES_WITH_REALM_TOOLS, "mcp_tool"],
    [...OMP_NAMES_WITH_REALM_TOOLS, "mcp_tool"],
    [],
  );
  assert.ok(!plan.wanted.includes("mcp_tool"), "the added tool is not wanted");
  assert.ok(plan.owed.includes("mcp_tool"), "the added tool is removed");
});

void test("P16 (d): an owed tool Omp no longer registers is not restored, so the plan never waits on a name that cannot come back", () => {
  const plan = planHostTools("advisory", ["read"], ["read"], ["bash"]);
  assert.deepEqual(plan.wanted, ["read"]);
  assert.deepEqual(plan.owed, []);
});

function sortedOf(names: readonly string[]): string[] {
  return [...names].sort();
}

// P16 (d): the fail-closed plan restores only what the extension owns, and never what the user turned off.
void test("P16 (d): fail-closed keeps a read-only built-in the user turned off, so it stays off", () => {
  const active = OMP_NAMES_WITH_REALM_TOOLS.filter((name) => name !== "glob");
  const plan = planHostTools("fail-closed", OMP_NAMES_WITH_REALM_TOOLS, active, []);
  assert.ok(!plan.wanted.includes("glob"), "glob stays off");
  assert.ok(!plan.owed.includes("glob"), "glob is not owed");
});

void test("P16 (d): fail-closed puts back a Realm tool that dropped out of the active set, and does not owe it", () => {
  const active = OMP_NAMES_WITH_REALM_TOOLS.filter((name) => name !== "write");
  const plan = planHostTools("fail-closed", OMP_NAMES_WITH_REALM_TOOLS, active, []);
  assert.ok(plan.wanted.includes("write"), "the Realm write is put back");
  assert.ok(!plan.owed.includes("write"), "the Realm write is not owed");
});

void test("P16 (d): fail-closed drops an owed tool Omp no longer registers from the owed list, and does not want it", () => {
  const registered = OMP_NAMES_WITH_REALM_TOOLS.filter((name) => name !== "edit");
  const plan = planHostTools("fail-closed", registered, registered, ["edit"]);
  assert.ok(!plan.wanted.includes("edit"), "edit is not wanted");
  assert.ok(!plan.owed.includes("edit"), "the vanished tool leaves the owed list");
});

void test("P16 (d): advisory restores the owed tools Omp still registers, and drops the one it no longer registers", () => {
  const plan = planHostTools("advisory", ["read", "bash"], ["read"], ["edit", "bash"]);
  assert.deepEqual(sortedOf(plan.wanted), ["bash", "read"]);
  assert.deepEqual(plan.owed, []);
});

void test("OMPX-03: fail-closed keeps bash active, so the guard can refuse it, and removes edit", () => {
  assert.deepEqual(sortedOf(failClosedToolNames(["read", "bash", "edit", "write", "grep"])), ["bash", "grep", "read", "write"]);
  const plan = planHostTools("fail-closed", ["read", "bash", "edit"], ["read", "bash", "edit"], []);
  assert.ok(plan.wanted.includes("bash"), "bash is wanted");
  assert.deepEqual(plan.owed, ["edit"]);
});

// OMPX-02: the registered read renders the decoded text, then a note with the digest and the truncation flag. The digest covers
// the whole file; the content is what the daemon returned, and details.bytes is its length.
const READ_INPUT = { path: "notes.txt", maxBytes: 64 };
const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

// A read outcome as the daemon client hands it over. In-process content is a Uint8Array; across the connection it arrives as
// Node's JSON form of a Buffer, so the content is typed unknown and the renderer checks its shape.
function readOutcomeOf(content: unknown, sha256: string, truncated: boolean): ToolOutcome {
  return { outcome: "done", tool: "read", value: { status: "found", content: content as Uint8Array, sha256, truncated } };
}

async function renderedReadOf(outcome: ToolOutcome): Promise<HostToolResult> {
  const read = definitionNamed(realmToolDefinitions(() => Promise.resolve(outcome)), "read");
  return read.execute("call-1", READ_INPUT);
}

void test("OMPX-02: a Uint8Array read renders its UTF-8 text, then a note with the digest and truncation, and details with the metadata", async () => {
  const bytes = new TextEncoder().encode("hello wörld\n");
  const digest = sha256Hex(bytes);
  const result = await renderedReadOf(readOutcomeOf(bytes, digest, false));
  assert.equal(result.isError, false);
  assert.deepEqual(result.content, [
    { type: "text", text: "hello wörld\n" },
    { type: "text", text: `[realm read] truncated=false sha256=${digest}` },
  ]);
  assert.deepEqual(result.details, {
    outcome: "done",
    tool: "read",
    value: { status: "found", sha256: digest, truncated: false, bytes: bytes.length },
  });
});

void test("OMPX-02: a serialized Buffer read, as it arrives across the daemon connection, renders the same text and metadata", async () => {
  const wire: unknown = JSON.parse(JSON.stringify(Buffer.from("serialized\n")));
  const digest = sha256Hex(Buffer.from("serialized\n"));
  const result = await renderedReadOf(readOutcomeOf(wire, digest, false));
  assert.equal(result.isError, false);
  assert.deepEqual(result.content, [
    { type: "text", text: "serialized\n" },
    { type: "text", text: `[realm read] truncated=false sha256=${digest}` },
  ]);
  assert.deepEqual(result.details, {
    outcome: "done",
    tool: "read",
    value: { status: "found", sha256: digest, truncated: false, bytes: 11 },
  });
});

void test("OMPX-02: an empty read renders empty text, the digest of no bytes and a zero byte count, from either wire form", async () => {
  for (const content of [new Uint8Array(0), { type: "Buffer", data: [] }]) {
    const result = await renderedReadOf(readOutcomeOf(content, EMPTY_SHA256, false));
    assert.equal(result.isError, false);
    assert.deepEqual(result.content, [
      { type: "text", text: "" },
      { type: "text", text: `[realm read] truncated=false sha256=${EMPTY_SHA256}` },
    ]);
    assert.deepEqual(result.details, {
      outcome: "done",
      tool: "read",
      value: { status: "found", sha256: EMPTY_SHA256, truncated: false, bytes: 0 },
    });
  }
});

void test("OMPX-02: a truncated read renders the capped content, and its digest covers the whole file", async () => {
  const whole = new TextEncoder().encode("abcdefgh");
  const digest = sha256Hex(whole);
  const result = await renderedReadOf(readOutcomeOf(whole.subarray(0, 4), digest, true));
  assert.equal(result.isError, false);
  assert.deepEqual(result.content, [
    { type: "text", text: "abcd" },
    { type: "text", text: `[realm read] truncated=true sha256=${digest}` },
  ]);
  assert.deepEqual(result.details, {
    outcome: "done",
    tool: "read",
    value: { status: "found", sha256: digest, truncated: true, bytes: 4 },
  });
});

void test("OMPX-02: invalid UTF-8 renders each invalid sequence as U+FFFD, and the digest covers the raw bytes", async () => {
  const stray = new Uint8Array([0x61, 0xff, 0x62]);
  const strayResult = await renderedReadOf(readOutcomeOf(stray, sha256Hex(stray), false));
  assert.equal(strayResult.content[0]?.text, "a\uFFFDb");
  assert.deepEqual(strayResult.details, {
    outcome: "done",
    tool: "read",
    value: { status: "found", sha256: sha256Hex(stray), truncated: false, bytes: 3 },
  });

  const cut = new Uint8Array([0x61, 0xc3]);
  const cutResult = await renderedReadOf(readOutcomeOf(cut, sha256Hex(cut), false));
  assert.equal(cutResult.content[0]?.text, "a\uFFFD", "a sequence cut short at the end is one U+FFFD");
});

void test("OMPX-02: a serialized Buffer whose data holds a value that is not a byte is refused as SCHEMA_INVALID, never decoded", async () => {
  const wire = { type: "Buffer", data: [104, 256] };
  const result = await renderedReadOf(readOutcomeOf(wire, "0".repeat(64), false));
  assert.equal(result.isError, true);
  assert.deepEqual(result.details, {
    outcome: "refused",
    tool: "read",
    code: "SCHEMA_INVALID",
    retryable: makeRealmError("SCHEMA_INVALID").retryable,
  });
});

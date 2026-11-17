import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { MCP_TOOL_DESCRIPTORS } from "../../src/mcp/server.js";
import type { ToolOutcome } from "../../src/tools/dispatch.js";
import { makeHarness } from "../support/fake-tools.js";
import { ANNOTATION_KEYS, ANNOTATION_PINS, annotationViolations, HINT_KEYS, loadContract } from "../support/mcp-annotation-pins.js";

// MCPA-01 and MCPA-02: the MCP tool annotations are hints for a host that chooses to use them, and nothing in src reads them
// (D-29-01). This file proves they are honest and exact: pinned per tool against an independent table and against the frozen
// tool contract, true to what the dispatcher does with a workspace, and mutation-resistant. Nothing here makes them a control.

type Tool = Record<string, unknown>;

function wire(): Tool[] {
  return JSON.parse(JSON.stringify(MCP_TOOL_DESCRIPTORS)) as Tool[];
}

void test("MCPA-02: the exported descriptors conform to the pins and to the rules derived from the tool contract", () => {
  assert.deepEqual(annotationViolations(wire()), []);
});

void test("MCPA-02: the pin table names exactly the six tools the frozen schema defines, in the descriptor order", () => {
  const rootProperties = loadContract()["properties"] as Record<string, unknown>;
  const pinned = Object.keys(ANNOTATION_PINS);
  assert.deepEqual([...pinned].sort(), Object.keys(rootProperties).sort());
  assert.deepEqual(
    pinned,
    MCP_TOOL_DESCRIPTORS.map((descriptor) => descriptor.name),
  );
});

void test("MCPA-02: the derived rules read the contract, not a copy", () => {
  const contract = loadContract();
  const rootProperties = contract["properties"] as Record<string, unknown>;
  // A contract in which status gained a content property: the table still calls it read-only, so the rule must object.
  const grown = {
    ...contract,
    properties: { ...rootProperties, status: { type: "object", properties: { content: { type: "string" } } } },
  };
  const violations = annotationViolations(wire(), grown);
  assert.ok(
    violations.some((message) => message.startsWith("status:") && message.includes("content")),
    `a writing tool the table calls read-only is reported: ${violations.join(" | ")}`,
  );
  // A contract in which write lost its content property: the rule that names the only writer fails for write.
  const shrunk = {
    ...contract,
    properties: { ...rootProperties, write: { type: "object", properties: { path: { type: "string" } } } },
  };
  assert.ok(annotationViolations(wire(), shrunk).some((message) => message.startsWith("write:")));
});

// ---- The mutation set ----------------------------------------------------------------------------------------------------

interface Mutant {
  readonly description: string;
  // The tool whose name a violation must start with.
  readonly tool: string;
  readonly tools: Tool[];
}

function annotationsOf(tool: Tool): Tool {
  const annotations = tool["annotations"];
  assert.ok(typeof annotations === "object" && annotations !== null && !Array.isArray(annotations), "the tool has annotations");
  return annotations as Tool;
}

function without(record: Tool, key: string): Tool {
  return Object.fromEntries(Object.entries(record).filter(([entry]) => entry !== key));
}

function editTool(tools: Tool[], name: string, change: (tool: Tool) => Tool): void {
  const index = tools.findIndex((tool) => tool["name"] === name);
  const found = tools[index];
  assert.ok(found !== undefined, `the tool ${name} is listed`);
  tools[index] = change(found);
}

function generateMutants(): Mutant[] {
  const baseline = wire();
  const names = baseline.map((tool) => String(tool["name"]));
  const mutants: Mutant[] = [];
  const add = (description: string, tool: string, mutate: (tools: Tool[]) => void): void => {
    const tools = structuredClone(baseline);
    mutate(tools);
    mutants.push({ description, tool, tools });
  };
  for (const name of names) {
    for (const key of HINT_KEYS) {
      add(`${name}: flip ${key}`, name, (tools) => {
        editTool(tools, name, (tool) => {
          const annotations = annotationsOf(tool);
          return { ...tool, annotations: { ...annotations, [key]: annotations[key] !== true } };
        });
      });
    }
    for (const key of ANNOTATION_KEYS) {
      add(`${name}: delete annotations.${key}`, name, (tools) => {
        editTool(tools, name, (tool) => ({ ...tool, annotations: without(annotationsOf(tool), key) }));
      });
    }
    add(`${name}: rename annotations.title`, name, (tools) => {
      editTool(tools, name, (tool) => ({ ...tool, annotations: { ...annotationsOf(tool), title: "Different Title" } }));
    });
    add(`${name}: rename the top-level title`, name, (tools) => {
      editTool(tools, name, (tool) => ({ ...tool, title: "Different Title" }));
    });
    add(`${name}: add an unknown annotation key`, name, (tools) => {
      editTool(tools, name, (tool) => ({ ...tool, annotations: { ...annotationsOf(tool), trustedByHost: true } }));
    });
    add(`${name}: delete annotations`, name, (tools) => {
      editTool(tools, name, (tool) => without(tool, "annotations"));
    });
    add(`${name}: delete the top-level title`, name, (tools) => {
      editTool(tools, name, (tool) => without(tool, "title"));
    });
    add(`${name}: drop the tool`, name, (tools) => {
      const index = tools.findIndex((tool) => tool["name"] === name);
      tools.splice(index, 1);
    });
  }
  add("append a seventh tool named delete", "delete", (tools) => {
    const template = tools.find((tool) => tool["name"] === "status");
    assert.ok(template !== undefined, "status is listed");
    tools.push({ ...template, name: "delete" });
  });
  add("swap the annotations of exec and read", "exec", (tools) => {
    const exec = tools.find((tool) => tool["name"] === "exec");
    const read = tools.find((tool) => tool["name"] === "read");
    assert.ok(exec !== undefined && read !== undefined, "exec and read are listed");
    const execAnnotations = exec["annotations"];
    exec["annotations"] = read["annotations"];
    read["annotations"] = execAnnotations;
  });
  add("duplicate the status tool", "status", (tools) => {
    const status = tools.find((tool) => tool["name"] === "status");
    assert.ok(status !== undefined, "status is listed");
    tools.push(structuredClone(status));
  });
  return mutants;
}

void test("MCPA-02: every mutant of the annotation table is caught and the violation names the mutated tool", () => {
  const mutants = generateMutants();
  // 24 hint flips, 30 key deletions, 12 renames, 6 unknown keys, 6 deleted annotations, 6 deleted titles, 6 dropped tools,
  // then one added tool, one swap and one duplicate. The count is asserted so the set cannot shrink silently.
  assert.equal(mutants.length, 93);
  for (const mutant of mutants) {
    const violations = annotationViolations(mutant.tools);
    assert.ok(violations.length > 0, `the mutant is caught: ${mutant.description}`);
    assert.ok(
      violations.some((message) => message.startsWith(`${mutant.tool}:`)),
      `a violation names ${mutant.tool} for the mutant: ${mutant.description} (${violations.join(" | ")})`,
    );
  }
});

// ---- Honesty: what the tools do against a real workspace --------------------------------------------------------------------

function snapshotOf(root: string): Record<string, string> {
  const files: Record<string, string> = {};
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const full = join(directory, entry.name);
      if (entry.isDirectory()) {
        files[`${relative(root, full)}/`] = "directory";
        walk(full);
      } else {
        files[relative(root, full)] = createHash("sha256").update(readFileSync(full)).digest("hex");
      }
    }
  };
  walk(root);
  return files;
}

function sha256Of(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function writtenSha(outcome: ToolOutcome): string {
  if (outcome.outcome !== "done" || outcome.tool !== "write") {
    assert.fail("expected a done write");
  }
  return outcome.value.sha256;
}

void test("MCPA-01: read, list and status leave every workspace byte unchanged", async (t) => {
  const h = makeHarness(t);
  const before = snapshotOf(h.ws);
  const auditBefore = h.auditLines().length;
  const read = await h.dispatcher.call({ read: { path: "doc.txt", maxBytes: 1024 } });
  const list = await h.dispatcher.call({ list: { path: ".", depth: 1 } });
  const status = await h.dispatcher.call({ status: {} });
  for (const outcome of [read, list, status]) {
    assert.equal(outcome.outcome, "done");
  }
  assert.deepEqual(snapshotOf(h.ws), before, "no workspace path or byte changed");
  assert.ok(h.auditLines().length > auditBefore, "the calls appended audit lines: Realm's own bookkeeping is outside the hint (D-29-06)");
});

void test("MCPA-01: write is idempotent for the same path and content", async (t) => {
  const h = makeHarness(t);
  const call = { write: { path: "sub/new.txt", content: "same content" } };
  const first = await h.dispatcher.call(call);
  const afterFirst = snapshotOf(h.ws);
  const second = await h.dispatcher.call(call);
  assert.equal(second.outcome, "done", "the second identical write succeeds");
  assert.equal(writtenSha(first), writtenSha(second));
  assert.equal(writtenSha(first), sha256Of("same content"));
  assert.deepEqual(snapshotOf(h.ws), afterFirst, "the second write leaves identical bytes");
  assert.equal(readFileSync(join(h.ws, "sub", "new.txt"), "utf8"), "same content");
});

void test("MCPA-01: a repeated write with ifMatchSha256 is refused and changes nothing", async (t) => {
  const h = makeHarness(t);
  const path = "sub/guarded.txt";
  assert.equal((await h.dispatcher.call({ write: { path, content: "v1" } })).outcome, "done");
  const precondition = sha256Of("v1");
  assert.equal((await h.dispatcher.call({ write: { path, content: "v2", ifMatchSha256: precondition } })).outcome, "done");
  const stale = await h.dispatcher.call({ write: { path, content: "v3", ifMatchSha256: precondition } });
  if (stale.outcome !== "refused") {
    assert.fail("the precondition no longer holds, so the write is refused");
  }
  assert.equal(stale.code, "LOCK_CONFLICT");
  assert.equal(readFileSync(join(h.ws, path), "utf8"), "v2", "the refused write changed nothing");
});

void test("MCPA-01: retry in active changes nothing and creates no container", async (t) => {
  const h = makeHarness(t);
  const before = snapshotOf(h.ws);
  const outcome = await h.dispatcher.call({ retry: {} });
  if (outcome.outcome !== "done" || outcome.tool !== "retry") {
    assert.fail("expected a done retry");
  }
  assert.equal(outcome.value.state, "active", "the state is unchanged");
  assert.equal(h.creates.length, 0, "no container was created");
  assert.equal(h.machine.snapshot().state, "active");
  assert.deepEqual(snapshotOf(h.ws), before);
});

void test("MCPA-01: retry in error is the only call that creates", async (t) => {
  const h = makeHarness(t, { state: "error" });
  const outcome = await h.dispatcher.call({ retry: {} });
  assert.equal(outcome.outcome, "done");
  assert.equal(h.creates.length, 1, "exactly one create from the bound root");
});

void test("MCPA-01: the tools marked read-only are exactly the ones the behaviour tests above exercise", () => {
  const readOnly = MCP_TOOL_DESCRIPTORS.filter((descriptor) => descriptor.annotations.readOnlyHint).map((descriptor) => descriptor.name);
  assert.deepEqual(readOnly, ["read", "list", "status"]);
});

// ---- The smoke gate's table ----------------------------------------------------------------------------------------------------

interface SmokeModule {
  EXPECTED_ANNOTATIONS: Record<string, unknown>;
}

void test("MCPA-02: the smoke gate's table equals the pins", async () => {
  // Dynamic on purpose: a static import would make tsc emit the script into dist, where its repository-root constant is wrong. The
  // path is resolved from this compiled file (dist/test/mcp) up to the repository root; importing the script does not run its main.
  const smoke = (await import(new URL("../../../scripts/check/mcp-smoke.mjs", import.meta.url).href)) as SmokeModule;
  assert.deepEqual(smoke.EXPECTED_ANNOTATIONS, ANNOTATION_PINS);
});

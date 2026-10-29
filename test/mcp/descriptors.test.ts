import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MCP_TOOL_DESCRIPTORS } from "../../src/mcp/server.js";

// The MCP tool descriptors describe the frozen tool schema (src/contract/tools.schema.json, D-13) for a host and its model.
// The dispatcher re-validates every call, so a drift fails closed at call time, but only after the model has been told the
// wrong arguments. This pins the shared structure of the two: which keys exist, which are required, whether unknown keys are
// refused, and the types and bounds of every key. The workspace path rules (no leading slash, no .. segment) are lookahead
// patterns that the dispatcher alone enforces; the descriptor states them in prose.

function record(value: unknown, what: string): Record<string, unknown> {
  assert.ok(typeof value === "object" && value !== null && !Array.isArray(value), `${what} is an object`);
  return value as Record<string, unknown>;
}

const schema = record(JSON.parse(readFileSync("src/contract/tools.schema.json", "utf8")), "the frozen schema");
const defs = record(schema["$defs"], "$defs");
const rootProperties = record(schema["properties"], "the root properties");

// The definition a root property points at, with a property-level $ref (the workspace path) resolved.
function resolve(node: unknown): Record<string, unknown> {
  const body = record(node, "a schema node");
  const ref = body["$ref"];
  if (typeof ref !== "string") {
    return body;
  }
  const name = ref.replace("#/$defs/", "");
  return record(defs[name], `$defs.${name}`);
}

function descriptorOf(name: string): Record<string, unknown> {
  const found = MCP_TOOL_DESCRIPTORS.find((descriptor) => descriptor.name === name);
  assert.ok(found !== undefined, `a descriptor exists for ${name}`);
  return found.inputSchema;
}

function sorted(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).sort() : [];
}

// The bounds both sides state for one key. A bound only the frozen side names must also be on the descriptor.
const SHARED_KEYWORDS = ["type", "const", "minimum", "maximum", "minLength", "minItems", "pattern"] as const;

void test("TOOL-05: the descriptors list exactly the six tools the frozen schema defines", () => {
  assert.deepEqual(MCP_TOOL_DESCRIPTORS.map((descriptor) => descriptor.name).sort(), Object.keys(rootProperties).sort());
  for (const descriptor of MCP_TOOL_DESCRIPTORS) {
    assert.equal(typeof descriptor.description, "string");
    assert.ok(descriptor.description.length > 0, `${descriptor.name} has a description`);
  }
});

for (const tool of Object.keys(rootProperties)) {
  void test(`TOOL-05: the ${tool} descriptor states what the frozen schema enforces`, () => {
    const frozen = resolve(rootProperties[tool]);
    const described = descriptorOf(tool);
    assert.equal(described["type"], frozen["type"], "the same top-level type");
    assert.equal(described["additionalProperties"], frozen["additionalProperties"], "unknown keys are refused on both sides");
    assert.deepEqual(sorted(described["required"]), sorted(frozen["required"]), "the same required keys");
    const frozenProperties = record(frozen["properties"], `${tool} frozen properties`);
    const describedProperties = record(described["properties"], `${tool} described properties`);
    assert.deepEqual(Object.keys(describedProperties).sort(), Object.keys(frozenProperties).sort(), "the same keys");
    for (const key of Object.keys(frozenProperties)) {
      const frozenKey = resolve(frozenProperties[key]);
      const describedKey = record(describedProperties[key], `${tool}.${key}`);
      for (const keyword of SHARED_KEYWORDS) {
        // The workspace path's pattern is a lookahead the descriptor states in prose; every other keyword must agree.
        if (keyword === "pattern" && key === "path") {
          continue;
        }
        assert.deepEqual(describedKey[keyword], frozenKey[keyword], `${tool}.${key}: ${keyword}`);
      }
    }
  });
}

// The Anthropic Messages API rejects a tool whose input_schema has a combinator, an enum or a conditional at its root, with a
// 400 that fails the whole request (every model turn in a host that loads the server), and a host that connects fine never
// shows it: the connection check does not send the schema to a model. So the descriptors must never grow one.
const ROOT_KEYWORDS_THE_API_REJECTS = ["oneOf", "anyOf", "allOf", "not", "enum", "if", "then", "else"] as const;

void test("TOOL-05: no tool descriptor has a combinator, enum or conditional at its root, and each root is a plain object schema", () => {
  for (const descriptor of MCP_TOOL_DESCRIPTORS) {
    assert.equal(descriptor.inputSchema["type"], "object", `${descriptor.name} root is type object`);
    for (const keyword of ROOT_KEYWORDS_THE_API_REJECTS) {
      assert.equal(keyword in descriptor.inputSchema, false, `${descriptor.name} has ${keyword} at its root`);
    }
  }
});

void test("TOOL-05: the exec rule 'exactly one form' is prose in the descriptor and an if/then/else in the frozen schema", () => {
  const described = descriptorOf("exec");
  assert.match(String(described["description"]), /exactly one/i, "the descriptor tells the model the two forms exclude each other");
  assert.equal(described["required"], undefined, "no key is required alone: the form is chosen by which keys are present");
  const frozen = resolve(rootProperties["exec"]);
  assert.deepEqual(frozen["if"], { required: ["shell"] }, "the frozen schema chooses the form by the presence of shell");
  assert.deepEqual(record(frozen["then"], "then")["required"], ["script"]);
  assert.deepEqual(record(frozen["else"], "else")["required"], ["argv"]);
});

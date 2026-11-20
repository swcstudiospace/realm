import { readFileSync } from "node:fs";

// The independent pin of the MCP tool annotations (MCPA-02) and the checker the wire, mutation and gate tests share. The
// annotations are hints for a host that chooses to use them; nothing in src reads them and this module is test support only
// (D-29-01). The table below is written out by hand and never imported from src, so a mistaken edit of the source table
// cannot also edit the pin. The derived rules read the frozen tool contract (src/contract/tools.schema.json, D-13) at test
// time, so they move if the contract moves.

export interface AnnotationPin {
  readonly title: string;
  readonly readOnlyHint: boolean;
  readonly destructiveHint: boolean;
  readonly idempotentHint: boolean;
  readonly openWorldHint: boolean;
}

export const ANNOTATION_PINS: Readonly<Record<string, AnnotationPin>> = {
  exec: { title: "Run command", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  read: { title: "Read file", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  write: { title: "Write file", readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  list: { title: "List directory", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  status: { title: "Realm status", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  retry: {
    title: "Retry session start",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};

export const HINT_KEYS = ["readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint"] as const;
export const ANNOTATION_KEYS: readonly string[] = ["title", ...HINT_KEYS];

const TITLE_PATTERN = /^[A-Za-z ]{1,40}$/;

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// The frozen tool contract, read from the repository root as test/mcp/descriptors.test.ts reads it.
export function loadContract(): JsonRecord {
  const parsed: unknown = JSON.parse(readFileSync("src/contract/tools.schema.json", "utf8"));
  if (!isRecord(parsed)) {
    throw new Error("the frozen tool schema is not an object");
  }
  return parsed;
}

// The property names of each tool's frozen definition, following a root-level $ref into $defs.
function contractProperties(contract: JsonRecord): Map<string, ReadonlySet<string>> {
  const rootProperties = contract["properties"];
  const defs = contract["$defs"];
  const result = new Map<string, ReadonlySet<string>>();
  if (!isRecord(rootProperties)) {
    return result;
  }
  for (const [tool, node] of Object.entries(rootProperties)) {
    let definition: unknown = node;
    const ref = isRecord(node) ? node["$ref"] : undefined;
    if (typeof ref === "string" && isRecord(defs)) {
      definition = defs[ref.replace("#/$defs/", "")];
    }
    const properties = isRecord(definition) ? definition["properties"] : undefined;
    result.set(tool, new Set(isRecord(properties) ? Object.keys(properties) : []));
  }
  return result;
}

function show(value: unknown): string {
  return JSON.stringify(value);
}

// Returns every violation of the pinned annotations and of the rules derived from the tool contract; empty when `tools`
// conforms. Every message starts with the tool name, so a test can require that a violation names the mutated tool.
export function annotationViolations(tools: unknown, contract: JsonRecord = loadContract()): string[] {
  if (!Array.isArray(tools)) {
    return ["tools: the tool list is not an array"];
  }
  const violations: string[] = [];
  const properties = contractProperties(contract);
  const pinned = Object.keys(ANNOTATION_PINS);

  for (const name of pinned) {
    if (!properties.has(name)) {
      violations.push(`${name}: pinned but not defined by the frozen tool contract`);
    }
  }
  for (const name of properties.keys()) {
    if (!pinned.includes(name)) {
      violations.push(`${name}: defined by the frozen tool contract but not pinned`);
    }
  }

  const seen = new Set<string>();
  tools.forEach((tool: unknown, index: number) => {
    if (!isRecord(tool) || typeof tool["name"] !== "string") {
      violations.push(`tools[${String(index)}]: the entry is not a tool with a string name`);
      return;
    }
    const name = tool["name"];
    if (seen.has(name)) {
      violations.push(`${name}: listed more than once`);
    }
    seen.add(name);
    const pin = ANNOTATION_PINS[name];
    if (pin === undefined) {
      violations.push(`${name}: not a pinned tool`);
      return;
    }
    violations.push(...toolViolations(name, tool, pin, properties.get(name)));
  });
  for (const name of pinned) {
    if (!seen.has(name)) {
      violations.push(`${name}: missing from the tool list`);
    }
  }
  return violations;
}

function toolViolations(name: string, tool: JsonRecord, pin: AnnotationPin, frozen: ReadonlySet<string> | undefined): string[] {
  const violations: string[] = [];
  const title = tool["title"];
  if (typeof title !== "string" || !TITLE_PATTERN.test(title)) {
    violations.push(`${name}: title must match ${String(TITLE_PATTERN)}, got ${show(title)}`);
  } else if (title !== pin.title) {
    violations.push(`${name}: title must be ${show(pin.title)}, got ${show(title)}`);
  }

  const annotations = tool["annotations"];
  if (!isRecord(annotations)) {
    violations.push(`${name}: annotations must be an object, got ${show(annotations)}`);
    return violations;
  }
  const keys = Object.keys(annotations);
  for (const key of ANNOTATION_KEYS) {
    if (!keys.includes(key)) {
      violations.push(`${name}: annotations is missing the key ${key}`);
    }
  }
  for (const key of keys) {
    if (!ANNOTATION_KEYS.includes(key)) {
      violations.push(`${name}: annotations has the unknown key ${key}`);
    }
  }
  if (annotations["title"] !== title) {
    violations.push(`${name}: annotations.title must equal title, got ${show(annotations["title"])}`);
  }
  for (const key of HINT_KEYS) {
    const value = annotations[key];
    if (typeof value !== "boolean") {
      violations.push(`${name}: ${key} must be a boolean, got ${show(value)}`);
    } else if (value !== pin[key]) {
      violations.push(`${name}: ${key} must be ${show(pin[key])}, got ${show(value)}`);
    }
  }
  violations.push(...derivedViolations(name, annotations, frozen));
  return violations;
}

// The rules derived from the frozen contract: what a tool's input says about what it can do.
function derivedViolations(name: string, annotations: JsonRecord, frozen: ReadonlySet<string> | undefined): string[] {
  const violations: string[] = [];
  const has = (key: string): boolean => frozen?.has(key) === true;
  if (has("content")) {
    if (annotations["readOnlyHint"] !== false) {
      violations.push(`${name}: readOnlyHint must be false because the frozen definition takes content`);
    }
    if (annotations["destructiveHint"] !== true) {
      violations.push(`${name}: destructiveHint must be true because the frozen definition takes content`);
    }
  } else if (name === "write") {
    violations.push(`${name}: the frozen definition must take content`);
  }
  if (has("path") && !has("content") && annotations["readOnlyHint"] !== true) {
    violations.push(`${name}: readOnlyHint must be true because the frozen definition takes a path and no content`);
  }
  if (has("argv")) {
    if (annotations["destructiveHint"] !== true) {
      violations.push(`${name}: destructiveHint must be true because the frozen definition takes argv`);
    }
    if (annotations["openWorldHint"] !== true) {
      violations.push(`${name}: openWorldHint must be true because the frozen definition takes argv`);
    }
  } else if (name === "exec") {
    violations.push(`${name}: the frozen definition must take argv`);
  }
  if (annotations["readOnlyHint"] === true) {
    if (annotations["destructiveHint"] !== false) {
      violations.push(`${name}: a read-only tool must have destructiveHint false`);
    }
    if (annotations["idempotentHint"] !== true) {
      violations.push(`${name}: a read-only tool must have idempotentHint true`);
    }
  }
  if (annotations["openWorldHint"] === true && name !== "exec") {
    violations.push(`${name}: only exec may be open world`);
  }
  return violations;
}

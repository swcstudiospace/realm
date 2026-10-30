// Realm tools for Omp (OMPX-02; docs/integration/omp.md, Enforcement spike). Each tool hands its input
// to the daemon client as one frozen ToolCall (src/contract/validate.ts, tools.schema.json). The daemon
// validates the input, takes the lock, writes the audit lines and applies the state gate, so none of that
// is repeated here. The Omp parameter schemas are hints for the model; the daemon schema is the authority.
//
// Names. The five names are the frozen ToolCall keys a model needs. Omp gives an extension tool that
// shares a built-in's name the built-in's place (spike S1), so the Realm read and write replace the
// built-ins of the same name. There is no glob tool, and retry is the realm-retry command, not a tool.

import type { ToolCall, ToolName } from "../contract/validate.js";
import { makeRealmError, RealmError, type ErrorCode } from "../core/errors.js";
import type { ToolOutcome } from "../tools/dispatch.js";

export type RealmToolName = Exclude<ToolName, "retry">;

export const REALM_TOOL_NAMES: readonly RealmToolName[] = Object.freeze(["exec", "read", "write", "list", "status"] as const);

// Built-in tools that only read (spike rule 1): none writes a workspace file or runs a command by its own
// description. read is also a Realm tool name and appears once in the allowlist.
export const READ_ONLY_HOST_TOOLS: readonly string[] = Object.freeze(["glob", "grep", "ask", "todo", "wait"]);

// Names the tool_call backstop lets pass in every mode: the Realm tools, the read-only built-ins, and retry.
// retry is the realm-retry command, not an Omp tool; Omp refuses a call to it as an unknown tool, so listing it
// only keeps the pass-through rule of P5-D6 unchanged.
export const PASS_THROUGH_HOST_TOOLS: readonly string[] = Object.freeze([
  ...REALM_TOOL_NAMES,
  ...READ_ONLY_HOST_TOOLS,
  "retry",
]);

// The names fail-closed mode keeps callable, computed from the names Omp reports (spike rule 1). web_search is
// left out: it reaches the network outside the realm's egress policy. Every other tool is removed, including
// tools another extension or an MCP server registers later.
export function failClosedToolNames(registered: readonly string[]): string[] {
  const keep = new Set<string>([...READ_ONLY_HOST_TOOLS, ...REALM_TOOL_NAMES]);
  return [...new Set(registered)].filter((name) => keep.has(name));
}

// Order-insensitive comparison of two tool name lists. A duplicate on either side is a difference.
export function sameToolNames(left: readonly string[], right: readonly string[]): boolean {
  const a = [...left].sort();
  const b = [...right].sort();
  return a.length === b.length && a.every((name, index) => name === b[index]);
}

// ---- Definitions -------------------------------------------------------------

export type JsonSchema = Readonly<Record<string, unknown>>;

export type HostApproval = "read" | "write" | "exec";

// What a successful read reports besides its text: the digest, the truncation flag and the byte count.
export interface ReadDetails {
  readonly outcome: "done";
  readonly tool: "read";
  readonly value: { readonly status: "found"; readonly sha256: string; readonly truncated: boolean; readonly bytes: number };
}

export interface HostToolResult {
  readonly content: readonly { readonly type: "text"; readonly text: string }[];
  // A successful read reports its metadata here; every other outcome is reported whole.
  readonly details: ToolOutcome | ReadDetails;
  readonly isError: boolean;
}

// The shape pi.registerTool takes. The parameters are a raw JSON Schema object (accepted by Omp, spike S1b).
export interface HostToolDefinition {
  readonly name: RealmToolName;
  readonly label: string;
  readonly description: string;
  readonly parameters: JsonSchema;
  readonly loadMode: "essential";
  readonly approval: HostApproval;
  execute(toolCallId: string, params: unknown): Promise<HostToolResult>;
}

// Sends one frozen ToolCall to the daemon. It rejects with a RealmError; the tool turns that into a refusal.
export type DaemonCall = (call: ToolCall) => Promise<ToolOutcome>;

interface ToolSpec {
  readonly name: RealmToolName;
  readonly description: string;
  readonly approval: HostApproval;
  readonly parameters: JsonSchema;
  readonly toCall: (input: unknown) => ToolCall;
}

const WORKSPACE_PATH: JsonSchema = {
  type: "string",
  minLength: 1,
  description: "Workspace-relative path: no leading slash, no drive letter, no '..' segment.",
};

const SPECS: readonly ToolSpec[] = [
  {
    name: "exec",
    description:
      "Run a command in the realm sandbox. Pass argv (preferred, no shell), or {shell: true, script} when the policy enables the shell.",
    approval: "exec",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        argv: { type: "array", minItems: 1, items: { type: "string" }, description: "Program and arguments." },
        shell: { const: true, description: "Set true together with script for the shell form." },
        script: { type: "string", minLength: 1 },
      },
    },
    toCall: (input) => callOf("exec", input),
  },
  {
    name: "read",
    description: "Read a workspace file through the realm. maxBytes caps the bytes returned (1 to 1048576).",
    approval: "read",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["path", "maxBytes"],
      properties: {
        path: WORKSPACE_PATH,
        maxBytes: { type: "integer", minimum: 1, maximum: 1048576 },
      },
    },
    toCall: (input) => callOf("read", input),
  },
  {
    name: "write",
    description:
      "Write a workspace file through the realm. ifMatchSha256 (64 lowercase hex characters) makes the write conditional on the current content.",
    approval: "write",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["path", "content"],
      properties: {
        path: WORKSPACE_PATH,
        content: { type: "string" },
        ifMatchSha256: { type: "string", pattern: "^[0-9a-f]{64}$" },
      },
    },
    toCall: (input) => callOf("write", input),
  },
  {
    name: "list",
    description: "List a workspace directory through the realm, to the given depth.",
    approval: "read",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["path", "depth"],
      properties: {
        path: WORKSPACE_PATH,
        depth: { type: "integer", minimum: 0 },
      },
    },
    toCall: (input) => callOf("list", input),
  },
  {
    name: "status",
    description: "Report the realm lifecycle state and the policy status.",
    approval: "read",
    parameters: { type: "object", additionalProperties: false, properties: {} },
    toCall: () => callOf("status", {}),
  },
];

// The five Realm tools, bound to one daemon call. The plugin registers each with pi.registerTool.
export function realmToolDefinitions(call: DaemonCall): readonly HostToolDefinition[] {
  return SPECS.map((spec) => definitionOf(spec, call));
}

function definitionOf(spec: ToolSpec, call: DaemonCall): HostToolDefinition {
  return {
    name: spec.name,
    label: `Realm ${spec.name}`,
    description: spec.description,
    parameters: spec.parameters,
    loadMode: "essential",
    approval: spec.approval,
    async execute(_toolCallId: string, params: unknown): Promise<HostToolResult> {
      const outcome = await Promise.resolve()
        .then(() => call(spec.toCall(params)))
        .catch((error: unknown) => refusalOf(spec.name, error));
      return resultOf(outcome);
    },
  };
}

// The frozen ToolCall map: exactly one key, the tool name. The input crosses unchanged; the daemon validates it.
function callOf(name: RealmToolName, input: unknown): ToolCall {
  return { [name]: input } as ToolCall;
}

// A RealmError keeps its catalogue code. Anything else is a daemon that did not answer, which the status reads
// also report as REALM_NOT_ACTIVE.
function refusalOf(tool: ToolName, error: unknown): ToolOutcome {
  const refusal: RealmError = error instanceof RealmError ? error : makeRealmError("REALM_NOT_ACTIVE");
  const code: ErrorCode = refusal.code;
  return {
    outcome: "refused",
    tool,
    code,
    retryable: refusal.retryable,
    ...(refusal.causeCode === undefined ? {} : { causeCode: refusal.causeCode }),
  };
}

// The result Omp shows. A successful read returns its text, decoded from the file bytes, with its metadata in details.
// Every other outcome is returned as JSON text, with the outcome as details.
function resultOf(outcome: ToolOutcome): HostToolResult {
  if (outcome.outcome === "done" && outcome.tool === "read" && outcome.value.status === "found") {
    const { content, sha256, truncated } = outcome.value;
    const bytes = bytesOf(content);
    if (bytes === undefined) {
      return resultOf(refusalOf("read", makeRealmError("SCHEMA_INVALID")));
    }
    const details: ReadDetails = {
      outcome: "done",
      tool: "read",
      value: { status: "found", sha256, truncated, bytes: bytes.length },
    };
    return { content: [{ type: "text", text: bytes.toString("utf8") }], details, isError: false };
  }
  return {
    content: [{ type: "text", text: JSON.stringify(outcome) }],
    details: outcome,
    isError: outcome.outcome === "refused",
  };
}

// The bytes of a successful read. In-process they are a Uint8Array. Across the daemon connection they arrive in Node's JSON
// form of a Buffer, { type: "Buffer", data: number[] }, which is rebuilt here. Any other shape is undefined.
function bytesOf(content: unknown): Buffer | undefined {
  if (content instanceof Uint8Array) {
    return Buffer.from(content.buffer, content.byteOffset, content.byteLength);
  }
  if (typeof content === "object" && content !== null && "type" in content && "data" in content) {
    if (content.type === "Buffer" && Array.isArray(content.data)) {
      return Buffer.from(content.data);
    }
  }
  return undefined;
}

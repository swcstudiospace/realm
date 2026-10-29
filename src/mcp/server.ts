// MCP stdio server (TOOL-05; P5-D2, P5-D9, P5-D11). Newline-delimited JSON-RPC 2.0 over
// stdio. The server is dual-era (docs/integration/mcp.md, "Protocol eras and result
// shapes"): it serves revision 2026-07-28 statelessly, with the protocol version in each
// request's `_meta`, and it answers the `initialize` handshake of the legacy revisions that
// hosts such as Claude Code still speak. src/mcp/protocol.ts holds the version constants and
// every result shape. Framing follows mcp.md Q2 by reference (P5-D2): stdin is
// split on newlines into JSON-RPC messages, so a payload with an embedded newline can
// never arrive as one message (its fragments fail parsing and are rejected below);
// stdout carries exactly one newline-terminated JSON object per reply and nothing else;
// diagnostics go to stderr; the server stops when stdin closes. The surface holds no
// tool logic (P5-D11): each tool request becomes the ToolCall map unchanged, schema
// validation still runs inside the pipeline, and the only dispatcher member called is
// `call` (D-88).

import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import type { ToolCall, ToolName } from "../contract/validate.js";
import { makeRealmError, RealmError } from "../core/errors.js";
import type { ToolDispatcher } from "../tools/dispatch.js";
import {
  discoverResult,
  initializeResult,
  MCP_MODERN_VERSION,
  META_PROTOCOL_VERSION,
  negotiateLegacyVersion,
  toolCallResult,
  toolErrorResult,
  toolListResult,
  unsupportedVersionError,
  type McpEra,
  type McpToolDescriptor,
} from "./protocol.js";

// The dispatcher surface this module may touch: `call` only (P5-D11, D-88).
export type McpDispatcher = Pick<ToolDispatcher, "call">;

const TOOL_NAMES: readonly ToolName[] = ["exec", "read", "write", "list", "status", "retry"];

function isToolName(value: string): value is ToolName {
  return (TOOL_NAMES as readonly string[]).includes(value);
}

// Tool input schemas, a description of the frozen src/contract/tools.schema.json $defs (D-13) that a host and a model
// can read without the schema's $ref and lookahead patterns. They state what the frozen schema enforces: no unknown keys,
// the same required keys, and the same types and bounds (test/mcp/descriptors.test.ts pins the two together). The
// dispatcher re-validates every call, so a drift would still fail closed in the pipeline, but only after the model had
// been told the wrong arguments. No schema has a combinator (oneOf, anyOf, allOf, not, if) or an enum at its root: the
// Anthropic Messages API rejects a tool whose input_schema root is one, with a 400 that fails the whole request, so the
// exec rule "exactly one form" is stated in prose and enforced by the dispatcher, as the frozen schema's if/then/else does.
const WORKSPACE_PATH = {
  type: "string",
  minLength: 1,
  description: "Workspace-relative path, no leading slash or drive, no .. segment",
} as const;

const TOOL_INPUT_SCHEMAS: Record<ToolName, Record<string, unknown>> = {
  exec: {
    type: "object",
    description:
      "Run a command. Two forms, exactly one: argv form { argv } (the program and its arguments, run directly) or shell form { shell: true, script } (a shell script, only when the policy allows it).",
    additionalProperties: false,
    properties: {
      argv: { type: "array", minItems: 1, items: { type: "string" }, description: "Argv form: the program and its arguments. Do not combine with shell or script." },
      shell: { const: true, description: "Shell form: set to true, and give script. Do not combine with argv." },
      script: { type: "string", minLength: 1, description: "Shell form: the script to run." },
    },
  },
  read: {
    type: "object",
    additionalProperties: false,
    required: ["path", "maxBytes"],
    properties: {
      path: WORKSPACE_PATH,
      maxBytes: { type: "integer", minimum: 1, maximum: 1048576 },
    },
  },
  write: {
    type: "object",
    additionalProperties: false,
    required: ["path", "content"],
    properties: {
      path: WORKSPACE_PATH,
      content: { type: "string" },
      ifMatchSha256: { type: "string", pattern: "^[0-9a-f]{64}$", description: "64 lowercase hex chars" },
    },
  },
  list: {
    type: "object",
    additionalProperties: false,
    required: ["path", "depth"],
    properties: {
      path: WORKSPACE_PATH,
      depth: { type: "integer", minimum: 0 },
    },
  },
  status: { type: "object", additionalProperties: false, properties: {} },
  retry: { type: "object", additionalProperties: false, properties: {} },
};

const TOOL_DESCRIPTIONS: Record<ToolName, string> = {
  exec: "Run a sandboxed workload while the realm is active.",
  read: "Read a workspace file, capped at maxBytes.",
  write: "Atomically write a workspace file.",
  list: "List a workspace directory to the given depth.",
  status: "Return the lifecycle state with its shared display mapping.",
  retry: "Retry session creation from error state.",
};

export const MCP_TOOL_DESCRIPTORS: readonly McpToolDescriptor[] = TOOL_NAMES.map((name) => ({
  name,
  description: TOOL_DESCRIPTIONS[name],
  inputSchema: TOOL_INPUT_SCHEMAS[name],
}));

export interface McpServer {
  readonly closed: Promise<void>;
  close(): void;
}

type RpcId = string | number | null;

interface ParsedRequest {
  readonly id: RpcId | undefined;
  readonly method: string;
  readonly params: unknown;
}

type MethodReply =
  | { readonly result: unknown }
  | { readonly error: { readonly code: number; readonly message: string; readonly data?: unknown } };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRpcId(value: unknown): value is RpcId {
  return typeof value === "string" || typeof value === "number" || value === null;
}

function parseRequest(message: unknown): ParsedRequest | null {
  if (!isRecord(message)) {
    return null;
  }
  if (message["jsonrpc"] !== "2.0" || typeof message["method"] !== "string") {
    return null;
  }
  if ("id" in message && message["id"] !== undefined && !isRpcId(message["id"])) {
    return null;
  }
  const id = message["id"] === undefined ? undefined : (message["id"] as RpcId);
  return { id, method: message["method"], params: message["params"] };
}

// Per-process protocol state. An `initialize` handshake selects a legacy revision for the rest of the stdio
// process (the versioning page's "Dual-era" section); a request that carries modern `_meta` never reads it.
interface Session {
  legacyVersion: string | undefined;
}

interface Context {
  readonly dispatcher: McpDispatcher;
  readonly diagnostics: Writable;
  readonly session: Session;
}

const MODERN: McpEra = { kind: "modern" };
const INVALID_PARAMS: MethodReply = { error: { code: -32602, message: "Invalid params" } };

function isEra(value: McpEra | MethodReply): value is McpEra {
  return "kind" in value;
}

// The era a request after the handshake is served in. A request that names a protocol version in `_meta` is
// modern, and the server implements exactly one modern revision, so any other version is answered with the list
// of versions it serves. A request without one follows the handshake the client made; a client that made none is
// served in the server's own revision, so a bare client that skips both still gets an answer.
function eraOf(params: unknown, session: Session): McpEra | MethodReply {
  const meta = isRecord(params) ? params["_meta"] : undefined;
  if (isRecord(meta) && META_PROTOCOL_VERSION in meta) {
    const requested = meta[META_PROTOCOL_VERSION];
    if (typeof requested !== "string") {
      return INVALID_PARAMS;
    }
    return requested === MCP_MODERN_VERSION ? MODERN : { error: unsupportedVersionError(requested) };
  }
  return session.legacyVersion === undefined ? MODERN : { kind: "legacy", version: session.legacyVersion };
}

// The legacy handshake: answer the requested revision when it is one the server serves, else the newest legacy
// one, and serve every later request without modern `_meta` in that revision.
function handshake(session: Session, params: unknown): MethodReply {
  if (!isRecord(params) || typeof params["protocolVersion"] !== "string") {
    return INVALID_PARAMS;
  }
  const version = negotiateLegacyVersion(params["protocolVersion"]);
  session.legacyVersion = version;
  return { result: initializeResult(version) };
}

async function callTool(ctx: Context, era: McpEra, params: unknown): Promise<MethodReply> {
  if (!isRecord(params) || typeof params["name"] !== "string" || !isToolName(params["name"])) {
    return INVALID_PARAMS;
  }
  const args = params["arguments"] === undefined ? {} : params["arguments"];
  if (!isRecord(args)) {
    return INVALID_PARAMS;
  }
  // The ToolCall map crosses unchanged; validation runs inside the pipeline (P5-D11).
  const call = { [params["name"]]: args } as ToolCall;
  try {
    return { result: toolCallResult(era, await ctx.dispatcher.call(call)) };
  } catch (error: unknown) {
    if (error instanceof RealmError) {
      return { result: toolErrorResult(era, error) };
    }
    ctx.diagnostics.write("mcp: tool call failed\n");
    return { error: { code: -32603, message: "Internal error" } };
  }
}

async function dispatchMethod(ctx: Context, method: string, params: unknown): Promise<MethodReply> {
  if (method === "initialize") {
    return handshake(ctx.session, params);
  }
  const era = eraOf(params, ctx.session);
  if (!isEra(era)) {
    return era;
  }
  switch (method) {
    case "server/discover":
      return { result: discoverResult() };
    case "tools/list":
      return { result: toolListResult(era, MCP_TOOL_DESCRIPTORS) };
    case "tools/call":
      return callTool(ctx, era, params);
    case "ping":
      // The legacy revisions define ping; the modern schema does not.
      return era.kind === "legacy" ? { result: {} } : { error: { code: -32601, message: "Method not found" } };
    default:
      return { error: { code: -32601, message: "Method not found" } };
  }
}

function writeReply(output: Writable, id: RpcId, reply: MethodReply): void {
  // JSON.stringify never emits a raw newline, so every reply is one line (P5-D2).
  output.write(`${JSON.stringify({ jsonrpc: "2.0", id, ...reply })}\n`);
}

async function handleLine(ctx: Context, line: string, output: Writable): Promise<void> {
  if (line.trim() === "") {
    return;
  }
  let message: unknown;
  try {
    message = JSON.parse(line);
  } catch {
    // Fixed text only: the line is untrusted bytes and may carry a credential.
    ctx.diagnostics.write("mcp: rejected malformed line\n");
    return;
  }
  const request = parseRequest(message);
  if (request === null) {
    if (isRecord(message) && "id" in message && isRpcId(message["id"])) {
      writeReply(output, message["id"], { error: { code: -32600, message: "Invalid Request" } });
    } else {
      ctx.diagnostics.write("mcp: rejected invalid request\n");
    }
    return;
  }
  if (request.id === undefined) {
    // A notification carries no id, so it takes no reply.
    return;
  }
  const reply = await dispatchMethod(ctx, request.method, request.params);
  writeReply(output, request.id, reply);
}

export function createMcpServer(
  dispatcher: McpDispatcher,
  input: Readable,
  output: Writable,
  diagnostics: Writable = process.stderr,
): McpServer {
  const reader = createInterface({ input, crlfDelay: Number.POSITIVE_INFINITY });
  const ctx: Context = { dispatcher, diagnostics, session: { legacyVersion: undefined } };
  let resolveClosed: () => void = () => undefined;
  let rejectClosed: (error: Error) => void = () => undefined;
  const closed = new Promise<void>((resolve, reject) => {
    resolveClosed = resolve;
    rejectClosed = reject;
  });
  const run = async (): Promise<void> => {
    try {
      for await (const line of reader) {
        await handleLine(ctx, line, output);
      }
    } catch {
      diagnostics.write("mcp: input stream failed\n");
      rejectClosed(makeRealmError("MCP_INPUT_FAILED"));
      return;
    }
    resolveClosed();
  };
  void run();
  return {
    closed,
    close: () => {
      reader.close();
    },
  };
}

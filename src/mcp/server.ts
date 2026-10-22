// MCP stdio server (TOOL-05; P5-D2, P5-D9, P5-D11). Newline-delimited JSON-RPC 2.0 over
// stdio with revision 2026-07-28 semantics (docs/integration/mcp.md Q5): stateless
// per-request handling where the protocol version travels in each answer; the server
// answers the `server/discover` probe for modern clients and the `initialize` handshake
// for initialize-based clients. Framing follows mcp.md Q2 by reference (P5-D2): stdin is
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

// The only spec-verified revision string (mcp.md Q1, Q5). The upstream-only string named
// in Q1 is never used here.
export const MCP_PROTOCOL_VERSION = "2026-07-28";
export const MCP_SERVER_NAME = "agent-realm";
export const MCP_SERVER_VERSION = "0.0.0";

// The dispatcher surface this module may touch: `call` only (P5-D11, D-88).
export type McpDispatcher = Pick<ToolDispatcher, "call">;

const TOOL_NAMES: readonly ToolName[] = ["exec", "read", "write", "list", "status", "retry"];

function isToolName(value: string): value is ToolName {
  return (TOOL_NAMES as readonly string[]).includes(value);
}

// Tool input schemas drawn from the frozen src/contract/tools.schema.json $defs (D-13).
// They describe the surface only; the dispatcher re-validates every call, so a drift
// between this description and the frozen schema fails closed in the pipeline.
const TOOL_INPUT_SCHEMAS: Record<ToolName, Record<string, unknown>> = {
  exec: {
    type: "object",
    description: "Argv form { argv } or shell form { shell: true, script }. Exactly one form.",
    oneOf: [{ required: ["argv"] }, { required: ["shell", "script"] }],
  },
  read: {
    type: "object",
    required: ["path", "maxBytes"],
    properties: {
      path: { type: "string", description: "Workspace-relative path, no escapes" },
      maxBytes: { type: "integer", minimum: 1, maximum: 1048576 },
    },
  },
  write: {
    type: "object",
    required: ["path", "content"],
    properties: {
      path: { type: "string", description: "Workspace-relative path, no escapes" },
      content: { type: "string" },
      ifMatchSha256: { type: "string", description: "64 lowercase hex chars" },
    },
  },
  list: {
    type: "object",
    required: ["path", "depth"],
    properties: {
      path: { type: "string", description: "Workspace-relative path, no escapes" },
      depth: { type: "integer", minimum: 0 },
    },
  },
  status: { type: "object", properties: {} },
  retry: { type: "object", properties: {} },
};

const TOOL_DESCRIPTIONS: Record<ToolName, string> = {
  exec: "Run a sandboxed workload while the realm is active.",
  read: "Read a workspace file, capped at maxBytes.",
  write: "Atomically write a workspace file.",
  list: "List a workspace directory to the given depth.",
  status: "Return the lifecycle state with its shared display mapping.",
  retry: "Retry session creation from error state.",
};

export interface McpToolDescriptor {
  readonly name: ToolName;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
}

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
  | { readonly error: { readonly code: number; readonly message: string } };

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

function discoveryPayload(): Record<string, unknown> {
  return {
    protocolVersion: MCP_PROTOCOL_VERSION,
    server: { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
    capabilities: { tools: {} },
  };
}

function initializePayload(): Record<string, unknown> {
  return {
    protocolVersion: MCP_PROTOCOL_VERSION,
    serverInfo: { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
    capabilities: { tools: {} },
  };
}

// A RealmError is a tool failure, not a protocol failure. It returns as an MCP tool error result
// (isError) carrying the catalogue code, the reason, the retryable flag, and any cause code (G-08).
function realmErrorResult(error: RealmError): Record<string, unknown> {
  const structured: Record<string, unknown> = { code: error.code, message: error.message, retryable: error.retryable };
  if (error.causeCode !== undefined) {
    structured["causeCode"] = error.causeCode;
  }
  return {
    isError: true,
    content: [{ type: "text", text: `${error.code}: ${error.message}` }],
    structuredContent: structured,
  };
}

async function callTool(dispatcher: McpDispatcher, params: unknown, diagnostics: Writable): Promise<MethodReply> {
  if (!isRecord(params) || typeof params["name"] !== "string" || !isToolName(params["name"])) {
    return { error: { code: -32602, message: "Invalid params" } };
  }
  const args = params["arguments"] === undefined ? {} : params["arguments"];
  if (!isRecord(args)) {
    return { error: { code: -32602, message: "Invalid params" } };
  }
  // The ToolCall map crosses unchanged; validation runs inside the pipeline (P5-D11).
  const call = { [params["name"]]: args } as ToolCall;
  try {
    const outcome = await dispatcher.call(call);
    return { result: outcome };
  } catch (error: unknown) {
    if (error instanceof RealmError) {
      return { result: realmErrorResult(error) };
    }
    diagnostics.write("mcp: tool call failed\n");
    return { error: { code: -32603, message: "Internal error" } };
  }
}

async function dispatchMethod(
  dispatcher: McpDispatcher,
  method: string,
  params: unknown,
  diagnostics: Writable,
): Promise<MethodReply> {
  switch (method) {
    case "server/discover":
      return { result: discoveryPayload() };
    case "initialize":
      return { result: initializePayload() };
    case "tools/list":
      return { result: { tools: MCP_TOOL_DESCRIPTORS } };
    case "tools/call":
      return callTool(dispatcher, params, diagnostics);
    default:
      return { error: { code: -32601, message: "Method not found" } };
  }
}

function writeReply(output: Writable, id: RpcId, reply: MethodReply): void {
  // JSON.stringify never emits a raw newline, so every reply is one line (P5-D2).
  output.write(`${JSON.stringify({ jsonrpc: "2.0", id, ...reply })}\n`);
}

async function handleLine(
  dispatcher: McpDispatcher,
  line: string,
  output: Writable,
  diagnostics: Writable,
): Promise<void> {
  if (line.trim() === "") {
    return;
  }
  let message: unknown;
  try {
    message = JSON.parse(line);
  } catch {
    // Fixed text only: the line is untrusted bytes and may carry a credential.
    diagnostics.write("mcp: rejected malformed line\n");
    return;
  }
  const request = parseRequest(message);
  if (request === null) {
    if (isRecord(message) && "id" in message && isRpcId(message["id"])) {
      writeReply(output, message["id"], { error: { code: -32600, message: "Invalid Request" } });
    } else {
      diagnostics.write("mcp: rejected invalid request\n");
    }
    return;
  }
  if (request.id === undefined) {
    // A notification carries no id, so it takes no reply.
    return;
  }
  const reply = await dispatchMethod(dispatcher, request.method, request.params, diagnostics);
  writeReply(output, request.id, reply);
}

export function createMcpServer(
  dispatcher: McpDispatcher,
  input: Readable,
  output: Writable,
  diagnostics: Writable = process.stderr as unknown as Writable,
): McpServer {
  const reader = createInterface({ input, crlfDelay: Number.POSITIVE_INFINITY });
  let resolveClosed: () => void = () => undefined;
  let rejectClosed: (error: Error) => void = () => undefined;
  const closed = new Promise<void>((resolve, reject) => {
    resolveClosed = resolve;
    rejectClosed = reject;
  });
  const run = async (): Promise<void> => {
    try {
      for await (const line of reader) {
        await handleLine(dispatcher, line, output, diagnostics);
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

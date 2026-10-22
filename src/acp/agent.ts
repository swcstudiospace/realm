// Realm ACP agent (P5-D3, P5-D10, P5-D11). It speaks ACP protocol generation v1
// (protocolVersion 1 with clientInfo/agentInfo) over newline-delimited JSON-RPC
// on stdio: stdout carries only ACP messages, diagnostics go to stderr, and
// lifecycle-sensitive messages are never batched. Realm's six tools ride one
// Realm extension method named realm/tool, which carries the whole frozen
// ToolCall map unchanged to ToolDispatcher.call. realm/tool is a Realm
// extension, not standard ACP: no client-invoked tool method exists in the
// standard protocol pages read (docs/integration/acp.md Q5).
//
// The module holds no tool logic (P5-D11): it parses envelopes and calls the
// dispatcher, nothing more. The only dispatcher member it touches is call.

import type { Readable, Writable } from "node:stream";
import { StringDecoder } from "node:string_decoder";
import type { ToolDispatcher, ToolOutcome } from "../tools/dispatch.js";

// The ACP generation Realm speaks (docs/integration/acp.md Q5, P5-D10).
export const ACP_PROTOCOL_VERSION = 1 as const;

// The Realm extension method carrying the six tools. Recorded as a Realm
// extension, never presented as standard ACP (P5-D10).
export const REALM_TOOL_METHOD = "realm/tool" as const;

export const AGENT_INFO = Object.freeze({ name: "realm", version: "0.0.0" });

// JSON-RPC transport codes. These are framing codes, not Realm catalogue
// codes; no entry is added to src/core/errors.ts.
const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;

export interface AcpAgentOptions {
  readonly dispatcher: Pick<ToolDispatcher, "call">;
  readonly input: Readable;
  readonly output: Writable;
  // Optional observer: it receives a copy of each diagnostic after the
  // diagnostic has gone to process.stderr. It cannot redirect diagnostics, and
  // it must never write to `output`, which carries protocol bytes only.
  readonly log?: (message: string) => void;
}

interface RpcSuccess {
  readonly jsonrpc: "2.0";
  readonly id: string | number | null;
  readonly result: unknown;
}

interface RpcFailure {
  readonly jsonrpc: "2.0";
  readonly id: string | number | null;
  readonly error: { readonly code: number; readonly message: string };
}

type RpcId = string | number | null;
type Sender = (message: RpcSuccess | RpcFailure) => void;
type Diagnose = (message: string) => void;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// JSON-RPC 2.0 permits a string, a number, or null as a request id. Any other
// JSON type is not an id and cannot be echoed back.
function isRpcId(value: unknown): value is RpcId {
  return typeof value === "string" || typeof value === "number" || value === null;
}

function requestId(value: Record<string, unknown>): RpcId {
  const id: unknown = value["id"];
  return isRpcId(id) ? id : null;
}

function success(id: RpcId, result: unknown): RpcSuccess {
  return { jsonrpc: "2.0", id, result };
}

function failure(id: RpcId, code: number, message: string): RpcFailure {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

// Decodes a chunk without touching the caller's stream. A split multi-byte
// character is held by the decoder until its remaining bytes arrive.
function decodeChunk(chunk: unknown, decoder: StringDecoder): string {
  if (Buffer.isBuffer(chunk)) {
    return decoder.write(chunk);
  }
  return String(chunk);
}

async function handleLine(
  line: string,
  dispatcher: Pick<ToolDispatcher, "call">,
  send: Sender,
  diagnose: Diagnose,
): Promise<void> {
  const text = line.replace(/\r$/, "");
  if (text.trim() === "") {
    return;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    diagnose("realm acp agent discarded a malformed line");
    send(failure(null, PARSE_ERROR, "parse error"));
    return;
  }
  if (Array.isArray(parsed)) {
    // Batches are rejected: lifecycle-sensitive messages are never batched
    // (docs/integration/acp.md Q2 batch rule, P5-D10).
    diagnose("realm acp agent rejected a batched line");
    send(failure(null, INVALID_REQUEST, "batched requests are not accepted"));
    return;
  }
  if (!isRecord(parsed) || parsed["jsonrpc"] !== "2.0" || typeof parsed["method"] !== "string") {
    diagnose("realm acp agent discarded an invalid request envelope");
    send(failure(isRecord(parsed) ? requestId(parsed) : null, INVALID_REQUEST, "invalid request"));
    return;
  }
  const method: string = parsed["method"];
  // A missing id marks a notification, which takes no reply (JSON-RPC 2.0).
  const notify = !("id" in parsed) || parsed["id"] === undefined;
  if (!notify && !isRpcId(parsed["id"])) {
    // The id cannot be echoed, so the error carries a null id and the request
    // never reaches a handler.
    diagnose("realm acp agent rejected a request whose id is not a string, number, or null");
    send(failure(null, INVALID_REQUEST, "request id must be a string, number, or null"));
    return;
  }
  const id = requestId(parsed);
  const params: unknown = "params" in parsed ? parsed["params"] : undefined;

  if (method === "initialize") {
    // Version negotiation (docs/integration/acp.md Q1): the agent selects the
    // highest version it supports at or below the requested one. Only v1 is
    // supported, so any integer request at or above v1 selects v1.
    const requested = isRecord(params) ? params["protocolVersion"] : undefined;
    if (typeof requested !== "number" || !Number.isInteger(requested) || requested < ACP_PROTOCOL_VERSION) {
      if (!notify) {
        send(failure(id, INVALID_PARAMS, "initialize requires an integer protocolVersion at or above 1"));
      }
      return;
    }
    if (!notify) {
      send(success(id, { protocolVersion: ACP_PROTOCOL_VERSION, agentInfo: { ...AGENT_INFO } }));
    }
    return;
  }

  if (method === REALM_TOOL_METHOD) {
    if (notify) {
      // A notification is never executed: a tool call with side effects must
      // not run without a request to answer (MCP parity, src/mcp/server.ts).
      diagnose("realm acp agent ignored a realm/tool notification");
      return;
    }
    // The only path that reaches the dispatcher (P5-D11, T-05-07). The
    // embedded ToolCall map crosses unchanged; schema validation still runs
    // first inside the dispatcher pipeline.
    if (!isRecord(params) || !("tool" in params)) {
      send(failure(id, INVALID_PARAMS, "realm/tool params must carry a tool map"));
      return;
    }
    let outcome: ToolOutcome;
    try {
      outcome = await dispatcher.call(params["tool"]);
    } catch (error: unknown) {
      diagnose(`realm acp agent tool dispatch failed: ${error instanceof Error ? error.message : "unknown"}`);
      send(failure(id, INTERNAL_ERROR, "tool dispatch failed"));
      return;
    }
    send(success(id, outcome));
    return;
  }

  // Unknown methods are rejected before any dispatch (T-05-07).
  diagnose(`realm acp agent rejected unknown method: ${method}`);
  if (!notify) {
    send(failure(id, METHOD_NOT_FOUND, `method not found: ${method}`));
  }
}

// Speaks ACP over the injected streams until the input closes: one reply line
// per request line, diagnostics to stderr only, never to the output. The
// promise resolves when stdin closes.
export async function runAcpAgent(options: AcpAgentOptions): Promise<void> {
  const { dispatcher, input, output } = options;
  const observe = options.log;
  // Diagnostics always go to process.stderr, whatever observer is injected.
  const diagnose: Diagnose = (message: string): void => {
    process.stderr.write(`${message}\n`);
    observe?.(message);
  };
  diagnose("realm acp agent listening: protocolVersion 1 over stdio");
  const send: Sender = (message: RpcSuccess | RpcFailure): void => {
    output.write(`${JSON.stringify(message)}\n`);
  };
  // The adapter decodes locally, so the caller's stream keeps its encoding and mode.
  const decoder = new StringDecoder("utf8");
  let buffer = "";
  try {
    for await (const chunk of input) {
      buffer += decodeChunk(chunk, decoder);
      const parts = buffer.split("\n");
      buffer = parts.pop() ?? "";
      for (const part of parts) {
        await handleLine(part, dispatcher, send, diagnose);
      }
    }
    buffer += decoder.end();
    if (buffer.replace(/\r$/, "").trim() !== "") {
      await handleLine(buffer, dispatcher, send, diagnose);
    }
  } finally {
    diagnose("realm acp agent stdin closed");
  }
}

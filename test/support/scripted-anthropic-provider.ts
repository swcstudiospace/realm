// A scripted Anthropic-format Messages server for the capability-token live proof (EVID-03, plan 35-03).
// No model, no credential, nothing leaves the machine: a test decides each reply. It is the Anthropic-format sibling of
// test/support/scripted-provider.ts (the Omp, OpenAI-format server); the two formats differ, so nothing is imported from it.
//
// The server speaks these routes on a loopback port the OS picks:
//   POST /v1/messages              -> one reply planned by the turn function, streamed (stream: true) or not
//   POST /v1/messages/count_tokens -> { input_tokens: 1 }
//   GET  /v1/models                -> { data: [], has_more: false }
// A query string (for instance ?beta=true) does not change the route. The two POST routes require the placeholder key in the
// x-api-key header or as a bearer value; any other value is a 401 with an Anthropic-shaped error body. CONNECT and
// absolute-URL proxy requests are refused with 403 and never forwarded; every other path is a 404. A body over
// MAX_BODY_BYTES is a 413 and a bad JSON body is a 400.
//
// The default script: a request that offers the configured tool and carries no tool_result block is answered with one tool_use
// block for that tool (stop reason tool_use); every other request is answered with the configured final text (end_turn).
//
// The recorder keeps names and booleans only: the route, whether the key was accepted, the model name, the tool names the
// request offered, whether it carried a tool_result block, the message count and whether it was streamed. Message text, tool
// schemas, other headers and the key are never kept.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { isRecord, within } from "./omp-live.js";

// ---- Types -----------------------------------------------------------------------------------------------------------------

// The placeholder key the provider requires by default. It is not a credential: it names nothing and opens nothing.
export const SCRIPTED_ANTHROPIC_KEY = "scripted-loopback-placeholder-key";
// The tool the default script calls: claude names a tool of an MCP server `mcp__<server>__<tool>`.
export const DEFAULT_SCRIPTED_TOOL = "mcp__realm__status";
const DEFAULT_FINAL_TEXT = "done";

// What a reply carries: one tool_use block or one text block.
export type ReplyPlan =
  | { readonly tool: { readonly name: string; readonly input: Readonly<Record<string, unknown>> } }
  | { readonly text: string };

// What the turn function is told about a request.
export interface AnthropicTurn {
  readonly toolsOffered: readonly string[];
  readonly hasToolResult: boolean;
  readonly messageCount: number;
  readonly streamed: boolean;
  readonly model: string | undefined;
}

export type AnthropicTurnFunction = (turn: AnthropicTurn) => ReplyPlan;

export type AnthropicRoute = "messages" | "count_tokens" | "models" | "other";

export interface AnthropicRecordedRequest {
  readonly route: AnthropicRoute;
  readonly keyAccepted: boolean;
  readonly model: string | undefined;
  readonly toolsOffered: readonly string[];
  readonly hasToolResult: boolean;
  readonly messageCount: number;
  readonly streamed: boolean;
}

export interface ScriptedAnthropicOptions {
  // The key value the provider accepts; default SCRIPTED_ANTHROPIC_KEY.
  readonly apiKey?: string;
  // The tool the default script calls; default DEFAULT_SCRIPTED_TOOL.
  readonly toolName?: string;
  // The input of that call; default an empty object.
  readonly toolInput?: Readonly<Record<string, unknown>>;
  // The text of the closing reply; default "done".
  readonly finalText?: string;
  // Replaces the default script.
  readonly turn?: AnthropicTurnFunction;
  // Answers non-streamed even when the request asks for a stream (the feasibility attempt of plan 35-03 Task 2).
  readonly forceNonStreamed?: boolean;
}

// The fields every reply carries.
export interface MessageEnvelope {
  readonly id: string;
  readonly model: string;
  // The id of the tool_use block the plan carries.
  readonly toolUseId: string;
}

export interface SseEvent {
  readonly event: string;
  readonly data: Readonly<Record<string, unknown>>;
}

// ---- Encoders --------------------------------------------------------------------------------------------------------------

const USAGE = { input_tokens: 1, output_tokens: 1 };

function isToolPlan(plan: ReplyPlan): plan is Extract<ReplyPlan, { tool: unknown }> {
  return "tool" in plan;
}

function stopReasonOf(plan: ReplyPlan): "tool_use" | "end_turn" {
  return isToolPlan(plan) ? "tool_use" : "end_turn";
}

// The streamed reply as the ordered list of events: message_start, content_block_start, content_block_delta,
// content_block_stop, message_delta, message_stop.
export function streamEvents(plan: ReplyPlan, envelope: MessageEnvelope): readonly SseEvent[] {
  const start = isToolPlan(plan)
    ? { type: "tool_use", id: envelope.toolUseId, name: plan.tool.name, input: {} }
    : { type: "text", text: "" };
  const delta = isToolPlan(plan)
    ? { type: "input_json_delta", partial_json: JSON.stringify(plan.tool.input) }
    : { type: "text_delta", text: plan.text };
  return [
    {
      event: "message_start",
      data: {
        type: "message_start",
        message: {
          id: envelope.id,
          type: "message",
          role: "assistant",
          model: envelope.model,
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: USAGE,
        },
      },
    },
    { event: "content_block_start", data: { type: "content_block_start", index: 0, content_block: start } },
    { event: "content_block_delta", data: { type: "content_block_delta", index: 0, delta } },
    { event: "content_block_stop", data: { type: "content_block_stop", index: 0 } },
    {
      event: "message_delta",
      data: { type: "message_delta", delta: { stop_reason: stopReasonOf(plan), stop_sequence: null }, usage: { output_tokens: 1 } },
    },
    { event: "message_stop", data: { type: "message_stop" } },
  ];
}

// The server-sent-events body: per event an `event:` line, a `data:` line and a blank line.
export function sseBody(events: readonly SseEvent[]): string {
  return events.map((entry) => `event: ${entry.event}\ndata: ${JSON.stringify(entry.data)}\n\n`).join("");
}

// The non-streamed reply: the single message object.
export function messageBody(plan: ReplyPlan, envelope: MessageEnvelope): Record<string, unknown> {
  const block = isToolPlan(plan)
    ? { type: "tool_use", id: envelope.toolUseId, name: plan.tool.name, input: plan.tool.input }
    : { type: "text", text: plan.text };
  return {
    id: envelope.id,
    type: "message",
    role: "assistant",
    model: envelope.model,
    content: [block],
    stop_reason: stopReasonOf(plan),
    stop_sequence: null,
    usage: USAGE,
  };
}

// An Anthropic-shaped error body.
export function errorBody(type: string, message: string): Record<string, unknown> {
  return { type: "error", error: { type, message } };
}

// ---- Request reading -------------------------------------------------------------------------------------------------------

function messagesOf(parsed: Record<string, unknown>): readonly unknown[] {
  const raw = parsed["messages"];
  return Array.isArray(raw) ? (raw as unknown[]) : [];
}

// True when any message carries a content block of type tool_result.
export function carriesToolResult(parsed: Record<string, unknown>): boolean {
  return messagesOf(parsed).some((message) => {
    const content = isRecord(message) ? message["content"] : undefined;
    return Array.isArray(content) && (content as unknown[]).some((block) => isRecord(block) && block["type"] === "tool_result");
  });
}

// The names of the tools a request offered; names only.
export function toolNamesOf(parsed: Record<string, unknown>): readonly string[] {
  const raw = parsed["tools"];
  if (!Array.isArray(raw)) {
    return [];
  }
  const names: string[] = [];
  for (const entry of raw as unknown[]) {
    if (isRecord(entry) && typeof entry["name"] === "string") {
      names.push(entry["name"]);
    }
  }
  return names;
}

// The largest request body the server reads (413 above it).
const MAX_BODY_BYTES = 1024 * 1024;
// A bound on closing the listener once every connection is closed.
const STOP_TIMEOUT_MS = 5_000;
// A CONNECT peer may not close after our refusal. Destroy it after this failure bound even if it ignores FIN.
const PROXY_CLOSE_TIMEOUT_MS = 1_000;

// Reads the body up to the bound. Past the bound the rest is drained and discarded so the client finishes sending and reads the 413.
async function readBody(req: IncomingMessage): Promise<string | undefined> {
  const parts: Buffer[] = [];
  let total = 0;
  for await (const part of req) {
    const buffer = Buffer.from(part as Uint8Array);
    total += buffer.length;
    if (total <= MAX_BODY_BYTES) {
      parts.push(buffer);
    }
  }
  return total > MAX_BODY_BYTES ? undefined : Buffer.concat(parts).toString("utf8");
}

function sendJson(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(value));
}

function routeOf(method: string, path: string): AnthropicRoute {
  if (method === "POST" && path === "/v1/messages") {
    return "messages";
  }
  if (method === "POST" && path === "/v1/messages/count_tokens") {
    return "count_tokens";
  }
  if (method === "GET" && path === "/v1/models") {
    return "models";
  }
  return "other";
}

function keyOf(req: IncomingMessage): string | undefined {
  const header = req.headers["x-api-key"];
  if (typeof header === "string") {
    return header;
  }
  const authorization = req.headers["authorization"];
  if (typeof authorization === "string" && /^bearer /i.test(authorization)) {
    return authorization.slice("bearer ".length).trim();
  }
  return undefined;
}

// ---- Server ----------------------------------------------------------------------------------------------------------------

export class ScriptedAnthropicProvider {
  readonly #server: Server;
  readonly #requests: AnthropicRecordedRequest[] = [];
  readonly #failures: string[] = [];
  readonly #proxyRefusals: string[] = [];
  readonly #sockets = new Set<Socket>();
  readonly #apiKey: string;
  readonly #turn: AnthropicTurnFunction;
  readonly #forceNonStreamed: boolean;
  #counter = 0;
  #started = false;
  #stopped = false;

  constructor(options: ScriptedAnthropicOptions = {}) {
    this.#apiKey = options.apiKey ?? SCRIPTED_ANTHROPIC_KEY;
    this.#forceNonStreamed = options.forceNonStreamed ?? false;
    const toolName = options.toolName ?? DEFAULT_SCRIPTED_TOOL;
    const toolInput = options.toolInput ?? {};
    const finalText = options.finalText ?? DEFAULT_FINAL_TEXT;
    this.#turn =
      options.turn ??
      ((turn) => (turn.toolsOffered.includes(toolName) && !turn.hasToolResult ? { tool: { name: toolName, input: toolInput } } : { text: finalText }));
    this.#server = createServer((req, res) => {
      void this.#handle(req, res);
    });
    // closeAllConnections does not cover CONNECT sockets. Track every accepted socket for cleanup as well.
    this.#server.on("connection", (socket) => {
      this.#sockets.add(socket);
      socket.once("close", () => this.#sockets.delete(socket));
    });
    this.#server.on("connect", (req, socket) => {
      this.#proxyRefusals.push(`CONNECT ${req.url ?? ""} HTTP/${req.httpVersion}`);
      const timer = setTimeout(() => socket.destroy(), PROXY_CLOSE_TIMEOUT_MS);
      timer.unref();
      socket.once("close", () => {
        clearTimeout(timer);
      });
      socket.on("error", () => socket.destroy());
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
    });
    this.#server.on("clientError", (error, socket) => {
      this.#failures.push(`client error: ${error.message}`);
      socket.destroy();
    });
  }

  // The placeholder key the provider requires.
  get apiKey(): string {
    return this.#apiKey;
  }

  // Every non-proxy request, in arrival order.
  get requests(): readonly AnthropicRecordedRequest[] {
    return this.#requests;
  }

  // The requests whose key was not accepted.
  get rejected(): readonly AnthropicRecordedRequest[] {
    return this.#requests.filter((entry) => !entry.keyAccepted);
  }

  // The accepted requests of the Messages route.
  get messageRequests(): readonly AnthropicRecordedRequest[] {
    return this.#requests.filter((entry) => entry.route === "messages" && entry.keyAccepted);
  }

  get proxyRefusals(): readonly string[] {
    return this.#proxyRefusals;
  }

  // What went wrong inside the server (a throwing turn function, a socket error).
  get failures(): readonly string[] {
    return this.#failures;
  }

  // Listens on 127.0.0.1 with a port the OS picks, so parallel test files never collide.
  async start(): Promise<{ port: number; baseUrl: string }> {
    if (this.#started) {
      throw new Error("the scripted anthropic provider is already started");
    }
    this.#started = true;
    await within(
      new Promise<void>((resolve, reject) => {
        const onError = (error: Error): void => {
          reject(error);
        };
        this.#server.once("error", onError);
        this.#server.listen(0, "127.0.0.1", () => {
          this.#server.off("error", onError);
          resolve();
        });
      }),
      STOP_TIMEOUT_MS,
      "scripted anthropic provider listen",
    );
    const address = this.#server.address() as AddressInfo;
    // ANTHROPIC_BASE_URL is the origin: the client appends /v1/messages itself.
    return { port: address.port, baseUrl: `http://127.0.0.1:${String(address.port)}` };
  }

  // Closes every open connection and then the listener. Safe to call twice.
  async stop(): Promise<void> {
    if (this.#stopped || !this.#started) {
      return;
    }
    this.#stopped = true;
    const closed = new Promise<void>((resolve) => {
      this.#server.close(() => {
        resolve();
      });
    });
    this.#server.closeAllConnections();
    for (const socket of this.#sockets) {
      socket.destroy();
    }
    await within(closed, STOP_TIMEOUT_MS, "scripted anthropic provider close");
  }

  async #handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      await this.#route(req, res);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.#failures.push(message);
      if (res.headersSent) {
        res.destroy();
        return;
      }
      sendJson(res, 500, errorBody("api_error", "scripted provider failure"));
    }
  }

  async #route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // Test this BEFORE URL normalization: an absolute URL with a valid path is still proxy traffic.
    if (/^[a-z][a-z\d+.-]*:\/\//i.test(req.url ?? "")) {
      this.#proxyRefusals.push(`${req.method ?? "UNKNOWN"} ${req.url ?? ""} HTTP/${req.httpVersion}`);
      req.resume();
      res.setHeader("connection", "close");
      sendJson(res, 403, errorBody("permission_error", "external network refused by scripted provider"));
      return;
    }
    const path = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
    const route = routeOf(req.method ?? "", path);
    const keyAccepted = keyOf(req) === this.#apiKey;
    const base = { route, keyAccepted, model: undefined, toolsOffered: [], hasToolResult: false, messageCount: 0, streamed: false };
    if (route === "other") {
      req.resume();
      this.#requests.push(base);
      sendJson(res, 404, errorBody("not_found_error", "not found"));
      return;
    }
    if (route === "models") {
      req.resume();
      this.#requests.push(base);
      sendJson(res, 200, { data: [], has_more: false, first_id: null, last_id: null });
      return;
    }
    if (!keyAccepted) {
      req.resume();
      this.#requests.push(base);
      sendJson(res, 401, errorBody("authentication_error", "invalid x-api-key"));
      return;
    }
    const text = await readBody(req);
    if (text === undefined) {
      this.#requests.push(base);
      res.setHeader("connection", "close");
      sendJson(res, 413, errorBody("request_too_large", "request body too large"));
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      this.#requests.push(base);
      sendJson(res, 400, errorBody("invalid_request_error", "bad json"));
      return;
    }
    if (!isRecord(parsed)) {
      this.#requests.push(base);
      sendJson(res, 400, errorBody("invalid_request_error", "the request body is not a JSON object"));
      return;
    }
    const model = typeof parsed["model"] === "string" ? parsed["model"] : undefined;
    const toolsOffered = toolNamesOf(parsed);
    const hasToolResult = carriesToolResult(parsed);
    const messageCount = messagesOf(parsed).length;
    const streamed = parsed["stream"] === true;
    this.#requests.push({ route, keyAccepted, model, toolsOffered, hasToolResult, messageCount, streamed });
    if (route === "count_tokens") {
      sendJson(res, 200, { input_tokens: 1 });
      return;
    }
    const plan = this.#turn({ toolsOffered, hasToolResult, messageCount, streamed, model });
    this.#counter += 1;
    const serial = String(this.#counter).padStart(6, "0");
    const envelope: MessageEnvelope = { id: `msg_scripted_${serial}`, model: model ?? "scripted", toolUseId: `toolu_${serial}` };
    if (streamed && !this.#forceNonStreamed) {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
      res.end(sseBody(streamEvents(plan, envelope)));
      return;
    }
    sendJson(res, 200, messageBody(plan, envelope));
  }
}

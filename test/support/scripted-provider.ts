// A scripted OpenAI-compatible chat-completions server for the Omp live harness (HARN-01; decisions D-1202, D-1203 of phase 12).
// No model, no credentials, no tokens: a test decides each reply. It is the typed, tested port of the prototype stub-provider.mjs.
//
// The server speaks two routes on a loopback port the OS picks:
//   GET  /v1/models            -> { object: "list", data: [{ id: "scripted", object: "model" }] }
//   POST /v1/chat/completions  -> one reply planned by the turn handler, streamed (Omp sends `stream: true`) or not
// Anything else is 404. A body that is not JSON is 400; a body over MAX_BODY_BYTES is 413.
//
// The streamed chunk sequence is the prototype's, exactly (the one Omp accepted live):
//   tool call: delta { role: "assistant", content: null, tool_calls: [{ index: 0, id, type: "function", function: { name, arguments: "" } }] },
//              delta { tool_calls: [{ index: 0, function: { arguments: "<json>" } }] },
//              delta {} with finish_reason "tool_calls"
//   text:      delta { role: "assistant", content: "" }, delta { content: text }, delta {} with finish_reason "stop"
//   then a usage-only chunk with `choices: []`, then `data: [DONE]`.
//
// Frozen interface (other units import exactly these names):
//   class ScriptedProvider
//     start(): Promise<{ port: number; baseUrl: string }>   listens on 127.0.0.1:0; baseUrl is `http://127.0.0.1:<port>/v1`
//     onTurn(fn: TurnHandler): void                          fn({ userText, toolsOffered, lastRole, messages }) returns
//                                                            { call: { name, args } } | { text }, or a promise of one.
//                                                            With no handler every turn answers { text: "ack" }.
//     get requests(): readonly RecordedRequest[]             one entry per chat-completions request, in arrival order
//     get failures(): readonly string[]                      what went wrong inside the server (a throwing handler, a socket error)
//     stop(): Promise<void>                                  closes the listener and every open connection; idempotent
//   Pure encoders, exported so the protocol is testable without a socket: streamChunks, sseBody, completionBody, textOfContent.
//
// The provider binds 127.0.0.1 only and never reaches out: the network assertion (HARN-03) counts the connections Omp makes to it.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { isRecord, within } from "./omp-live.js";

// ---- Types -----------------------------------------------------------------------------------------------------------------

// One message of the request, as Omp sent it. content is a string or an array of parts, so it stays unknown.
export interface ChatMessage {
  readonly role: string;
  readonly content?: unknown;
}

export interface ProviderTurn {
  // The text of the last user message in the request.
  readonly userText: string;
  // The names of the tools Omp offered in this request.
  readonly toolsOffered: readonly string[];
  // The role of the last message, or undefined when the request had none.
  readonly lastRole: string | undefined;
  readonly messages: readonly ChatMessage[];
}

export interface ToolCallPlan {
  readonly call: { readonly name: string; readonly args: Readonly<Record<string, unknown>> };
}

export interface TextPlan {
  readonly text: string;
}

export type TurnPlan = ToolCallPlan | TextPlan;

export type TurnHandler = (turn: ProviderTurn) => TurnPlan | Promise<TurnPlan>;

export interface RecordedRequest {
  readonly stream: boolean;
  readonly model: string | undefined;
  readonly toolsOffered: readonly string[];
  readonly lastRole: string | undefined;
  readonly userText: string;
  // The text of the last tool-role message in the request: the result Omp reports for the previous tool call.
  readonly toolResultText: string | undefined;
  readonly messageCount: number;
  readonly plan: TurnPlan;
}

// The fields every chunk and completion carries.
export interface Envelope {
  readonly id: string;
  readonly created: number;
  readonly model: string;
  // The id of the tool call the plan carries.
  readonly callId: string;
}

// ---- Encoders --------------------------------------------------------------------------------------------------------------

const USAGE = { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 };

function chunk(envelope: Envelope, delta: Record<string, unknown>, finish: string | null): Record<string, unknown> {
  return {
    id: envelope.id,
    object: "chat.completion.chunk",
    created: envelope.created,
    model: envelope.model,
    choices: [{ index: 0, delta, finish_reason: finish }],
  };
}

// The streamed reply as the ordered list of chunk objects, ending with the usage-only chunk.
export function streamChunks(plan: TurnPlan, envelope: Envelope): readonly Record<string, unknown>[] {
  const body: Record<string, unknown>[] = [];
  if ("call" in plan) {
    body.push(
      chunk(
        envelope,
        {
          role: "assistant",
          content: null,
          tool_calls: [{ index: 0, id: envelope.callId, type: "function", function: { name: plan.call.name, arguments: "" } }],
        },
        null,
      ),
      chunk(envelope, { tool_calls: [{ index: 0, function: { arguments: JSON.stringify(plan.call.args) } }] }, null),
      chunk(envelope, {}, "tool_calls"),
    );
  } else {
    body.push(chunk(envelope, { role: "assistant", content: "" }, null), chunk(envelope, { content: plan.text }, null), chunk(envelope, {}, "stop"));
  }
  body.push({
    id: envelope.id,
    object: "chat.completion.chunk",
    created: envelope.created,
    model: envelope.model,
    choices: [],
    usage: USAGE,
  });
  return body;
}

// The server-sent-events body: one `data:` event per chunk, then `data: [DONE]`.
export function sseBody(chunks: readonly Record<string, unknown>[]): string {
  return `${chunks.map((entry) => `data: ${JSON.stringify(entry)}\n\n`).join("")}data: [DONE]\n\n`;
}

// The non-streamed reply.
export function completionBody(plan: TurnPlan, envelope: Envelope): Record<string, unknown> {
  const message =
    "call" in plan
      ? {
          role: "assistant",
          content: null,
          tool_calls: [{ id: envelope.callId, type: "function", function: { name: plan.call.name, arguments: JSON.stringify(plan.call.args) } }],
        }
      : { role: "assistant", content: plan.text };
  return {
    id: envelope.id,
    object: "chat.completion",
    created: envelope.created,
    model: envelope.model,
    choices: [{ index: 0, message, finish_reason: "call" in plan ? "tool_calls" : "stop" }],
    usage: USAGE,
  };
}

// ---- Request reading -------------------------------------------------------------------------------------------------------

// The text of a message content: the string itself, or the text parts of an array joined; anything else is empty.
export function textOfContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content.map((part: unknown) => (isRecord(part) && typeof part["text"] === "string" ? part["text"] : "")).join("");
  }
  return "";
}

function readMessages(parsed: Record<string, unknown>): readonly ChatMessage[] {
  const raw = parsed["messages"];
  if (!Array.isArray(raw)) {
    return [];
  }
  const messages: ChatMessage[] = [];
  for (const entry of raw as unknown[]) {
    if (isRecord(entry) && typeof entry["role"] === "string") {
      messages.push({ role: entry["role"], content: entry["content"] });
    }
  }
  return messages;
}

function readToolNames(parsed: Record<string, unknown>): readonly string[] {
  const raw = parsed["tools"];
  if (!Array.isArray(raw)) {
    return [];
  }
  const names: string[] = [];
  for (const entry of raw as unknown[]) {
    const fn = isRecord(entry) ? entry["function"] : undefined;
    if (isRecord(fn) && typeof fn["name"] === "string") {
      names.push(fn["name"]);
    }
  }
  return names;
}

function lastUserText(messages: readonly ChatMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "user") {
      return textOfContent(message.content);
    }
  }
  return "";
}

function lastToolText(messages: readonly ChatMessage[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "tool") {
      return textOfContent(message.content);
    }
  }
  return undefined;
}

// The largest request body the server reads. Omp's requests carry the whole tool list, well under this.
const MAX_BODY_BYTES = 8 * 1024 * 1024;
// A bound on closing the listener once every connection is closed.
const STOP_TIMEOUT_MS = 5_000;

class BodyTooLarge extends Error {}

async function readBody(req: IncomingMessage): Promise<string> {
  const parts: Buffer[] = [];
  let total = 0;
  for await (const part of req) {
    const buffer = Buffer.from(part as Uint8Array);
    total += buffer.length;
    if (total > MAX_BODY_BYTES) {
      throw new BodyTooLarge("request body too large");
    }
    parts.push(buffer);
  }
  return Buffer.concat(parts).toString("utf8");
}

function sendJson(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(value));
}

// ---- Server ----------------------------------------------------------------------------------------------------------------

export class ScriptedProvider {
  readonly #server: Server;
  readonly #requests: RecordedRequest[] = [];
  readonly #failures: string[] = [];
  #handler: TurnHandler = () => ({ text: "ack" });
  #counter = 0;
  #started = false;
  #stopped = false;

  constructor() {
    this.#server = createServer((req, res) => {
      void this.#handle(req, res);
    });
    this.#server.on("clientError", (error, socket) => {
      this.#failures.push(`client error: ${error.message}`);
      socket.destroy();
    });
  }

  get requests(): readonly RecordedRequest[] {
    return this.#requests;
  }

  get failures(): readonly string[] {
    return this.#failures;
  }

  // Replaces the turn handler. It applies to requests that arrive after the call.
  onTurn(handler: TurnHandler): void {
    this.#handler = handler;
  }

  // Listens on 127.0.0.1 with a port the OS picks, so parallel test files never collide.
  async start(): Promise<{ port: number; baseUrl: string }> {
    if (this.#started) {
      throw new Error("the scripted provider is already started");
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
      "scripted provider listen",
    );
    const address = this.#server.address() as AddressInfo;
    return { port: address.port, baseUrl: `http://127.0.0.1:${String(address.port)}/v1` };
  }

  // Closes every open connection (Omp keeps connections alive) and then the listener. Safe to call twice.
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
    await within(closed, STOP_TIMEOUT_MS, "scripted provider close");
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
      sendJson(res, error instanceof BodyTooLarge ? 413 : 500, { error: { message } });
    }
  }

  async #route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const path = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
    if (req.method === "GET" && path === "/v1/models") {
      sendJson(res, 200, { object: "list", data: [{ id: "scripted", object: "model" }] });
      return;
    }
    if (req.method === "POST" && path === "/v1/chat/completions") {
      await this.#complete(req, res);
      return;
    }
    res.writeHead(404);
    res.end();
  }

  async #complete(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const text = await readBody(req);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      sendJson(res, 400, { error: { message: "bad json" } });
      return;
    }
    if (!isRecord(parsed)) {
      sendJson(res, 400, { error: { message: "the request body is not a JSON object" } });
      return;
    }
    const messages = readMessages(parsed);
    const toolsOffered = readToolNames(parsed);
    const lastRole = messages[messages.length - 1]?.role;
    const userText = lastUserText(messages);
    const plan = await this.#handler({ userText, toolsOffered, lastRole, messages });
    const stream = parsed["stream"] === true;
    const model = typeof parsed["model"] === "string" ? parsed["model"] : undefined;
    this.#requests.push({
      stream,
      model,
      toolsOffered,
      lastRole,
      userText,
      toolResultText: lastToolText(messages),
      messageCount: messages.length,
      plan,
    });
    this.#counter += 1;
    const serial = String(this.#counter).padStart(6, "0");
    const envelope: Envelope = {
      id: `chatcmpl-scripted-${serial}`,
      created: Math.floor(Date.now() / 1000),
      model: model ?? "scripted",
      callId: `call_${serial}`,
    };
    if (stream) {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
      res.end(sseBody(streamChunks(plan, envelope)));
      return;
    }
    sendJson(res, 200, completionBody(plan, envelope));
  }
}

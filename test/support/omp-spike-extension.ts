// A test extension for the Omp enforcement spike (OMPX-01; decision D-1204 of phase 12). It is NOT the Realm plugin: the spike's
// answers are about Omp's extension API, so they must not depend on a Realm bug. Omp loads the compiled file
// (dist/test/support/omp-spike-extension.js) with `-e`; test/integration/omp-spike.test.ts drives it.
//
// The extension does what a scenario asks, as a JSON config in the environment variable REALM_SPIKE_CONFIG (an extension reads
// its environment at load, as src/omp/extension.ts does), and writes what it observes to the JSONL file `log` names: one line per
// event, each with a sequence number. Nothing here talks to a daemon or imports the Realm sources, so Bun loads it in isolation.
//
// Operations a scenario can ask for (all optional):
//   shadowWrite      registerTool("write", ...) with a Zod schema: the tool that replaces the built-in `write`
//   tools            extension tools registered under their own names: exec, status, list (a raw JSON Schema), fail (execute
//                    returns an error result or throws), hold (execute starts and never settles), big (returns SPIKE_BIG_BYTES
//                    bytes of text)
//   deactivate       setActiveTools(getActiveTools() minus these names) in session_start
//   activeOnly       setActiveTools(only the listed names that getAllTools() knows) in session_start
//   onToolCall       one tool_call rule per tool: block, rewrite the input, throw or hang
//   onToolResult     one tool_result rule per tool: replace the content and the error flag
//   fallbackTarget   registerFileWriteFallback: write the bytes to this path and report success
//   logSchemas       include every tool's description in the session_start line
//
// The events logged: load, session_start, session_switch, session_shutdown, set_active_tools, tool_call, tool_result,
// tool_approval_requested, tool_approval_resolved, exec, fallback and error. Each tool_call line carries getActiveTools() at that
// moment, so a scenario sees whether a removal held.

import { appendFileSync, writeFileSync } from "node:fs";

// ---- Config ----------------------------------------------------------------------------------------------------------------

export const SPIKE_CONFIG_VARIABLE = "REALM_SPIKE_CONFIG";

export type SpikeToolKind = "exec" | "status" | "list" | "fail" | "hold" | "big";

// The size of the text the `big` tool returns: the largest read the Realm contract allows (maxBytes 1 048 576).
export const SPIKE_BIG_BYTES = 1_048_576;

export type ToolCallMode = "block" | "rewrite" | "throw" | "hang";

export interface SpikeToolCallRule {
  // The one tool the rule acts on; every other call passes untouched.
  readonly tool: string;
  readonly mode: ToolCallMode;
  // The block reason, or the message of the thrown error.
  readonly reason?: string;
  // The replacement input of the rewrite mode.
  readonly input?: Readonly<Record<string, unknown>>;
}

export interface SpikeToolResultRule {
  readonly tool: string;
  readonly text: string;
  readonly isError: boolean;
}

export interface SpikeConfig {
  readonly log: string;
  readonly logSchemas?: boolean;
  readonly shadowWrite?: boolean;
  readonly tools?: readonly SpikeToolKind[];
  readonly deactivate?: readonly string[];
  readonly activeOnly?: readonly string[];
  readonly onToolCall?: readonly SpikeToolCallRule[];
  readonly onToolResult?: readonly SpikeToolResultRule[];
  readonly fallbackTarget?: string;
}

// One parsed log line. `ev` names the event; the other fields are whatever that event carries.
export type SpikeLogLine = Readonly<Record<string, unknown>> & { readonly seq: number; readonly ev: string };

// ---- The slice of Omp's extension API this file uses ------------------------------------------------------------------------
// Declared here, not imported: the spike pins the behaviour of the installed Omp, and a type that names only what is called keeps
// the file loadable by Bun without the Omp package on the module path.

interface ToolResult {
  content: { type: "text"; text: string }[];
  details?: unknown;
  isError?: boolean;
}

interface ToolDefinition {
  name: string;
  label: string;
  description: string;
  parameters: unknown;
  loadMode?: "essential" | "discoverable";
  approval?: "read" | "write" | "exec";
  execute(toolCallId: string, params: Record<string, unknown>, signal: unknown, onUpdate: unknown, ctx: { invokeTool?: unknown }): Promise<ToolResult>;
}

interface ToolInfo {
  name: string;
  description?: string;
  sourceInfo?: { source?: string };
}

interface ToolCallEvent {
  toolCallId: string;
  toolName: string;
  input: unknown;
}

interface ToolResultEvent {
  toolCallId: string;
  toolName: string;
  input: unknown;
  content: unknown;
  isError: boolean;
}

interface ToolApprovalEvent {
  toolCallId: string;
  toolName: string;
  approvalMode?: string;
  approved?: boolean;
  reason?: string;
}

interface FileWriteRequest {
  dst: string;
  sessionId: string | undefined;
  content: string;
  cause: unknown;
}

interface Zod {
  object(shape: Record<string, unknown>): unknown;
  string(): unknown;
}

// What a handler's second argument carries that the spike reads: the id of the session the event belongs to.
interface HandlerContext {
  sessionManager: { getSessionId(): string };
}

interface SpikeApi {
  zod: Zod;
  on(event: "session_start" | "session_switch" | "session_shutdown", handler: (event: unknown, ctx: HandlerContext) => unknown): void;
  on(event: "tool_call", handler: (event: ToolCallEvent, ctx: HandlerContext) => unknown): void;
  on(event: "tool_result", handler: (event: ToolResultEvent, ctx: HandlerContext) => unknown): void;
  on(event: "tool_approval_requested" | "tool_approval_resolved", handler: (event: ToolApprovalEvent) => unknown): void;
  registerTool(tool: ToolDefinition): void;
  registerFileWriteFallback(handler: (request: FileWriteRequest, ctx: unknown) => Promise<boolean>): void;
  getActiveTools(): string[];
  getAllTools(): ToolInfo[];
  setActiveTools(names: string[]): Promise<void>;
}

// ---- Reading the config ----------------------------------------------------------------------------------------------------

function readConfig(raw: string | undefined): SpikeConfig {
  if (raw === undefined) {
    throw new Error(`${SPIKE_CONFIG_VARIABLE} is not set`);
  }
  // The test that set the variable built the value from SpikeConfig; the one field the extension cannot work without is checked.
  const config = JSON.parse(raw) as Partial<SpikeConfig> | null;
  if (typeof config?.log !== "string") {
    throw new Error(`${SPIKE_CONFIG_VARIABLE} must be a JSON object with a string "log"`);
  }
  return config as SpikeConfig;
}

// The text parts of a tool result's content, joined.
function textOf(content: unknown): string {
  if (!Array.isArray(content)) {
    return "";
  }
  return (content as { text?: unknown }[]).map((part) => (typeof part.text === "string" ? part.text : "")).join("");
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const text = (value: string, details: unknown = {}): ToolResult => ({ content: [{ type: "text", text: value }], details });

// ---- Extension -------------------------------------------------------------------------------------------------------------

export default function spikeExtension(pi: SpikeApi): void {
  const config = readConfig(process.env[SPIKE_CONFIG_VARIABLE]);
  let seq = 0;
  // The test creates the log file empty before it starts Omp: a subagent session that loads this extension again appends to the
  // same file, so a load must never truncate it. `pid` tells the Omp process that wrote a line.
  const log = (ev: string, fields: Record<string, unknown> = {}): void => {
    seq += 1;
    appendFileSync(config.log, `${JSON.stringify({ seq, pid: process.pid, ev, ...fields })}\n`);
  };

  log("load", { config: { ...config, log: undefined } });

  if (config.shadowWrite === true) {
    pi.registerTool({
      name: "write",
      label: "Spike write",
      description: "The spike's shadow of write: it records the call and writes nothing.",
      parameters: pi.zod.object({ path: pi.zod.string(), content: pi.zod.string() }),
      loadMode: "essential",
      execute(_toolCallId, params, _signal, _onUpdate, ctx) {
        log("exec", { tool: "write", params, invokeTool: typeof ctx.invokeTool });
        return Promise.resolve(text(`SPIKE-SHADOW-WRITE ${String(params["path"])}`, { shadow: true }));
      },
    });
  }

  for (const kind of config.tools ?? []) {
    switch (kind) {
      case "exec":
      case "status":
        pi.registerTool({
          name: kind,
          label: `Spike ${kind}`,
          description: `The spike's ${kind} tool: it records the call and answers a fixed text.`,
          parameters: { type: "object", additionalProperties: false, properties: { argv: { type: "array", items: { type: "string" } } } },
          loadMode: "essential",
          ...(kind === "exec" ? { approval: "exec" as const } : {}),
          execute(_id, params, _signal, _onUpdate, ctx) {
            log("exec", { tool: kind, params, invokeTool: typeof ctx.invokeTool });
            return Promise.resolve(text(`SPIKE-${kind.toUpperCase()} ${JSON.stringify(params)}`));
          },
        });
        break;
      case "list":
        pi.registerTool({
          name: "list",
          label: "Spike list",
          description: "The spike's list tool: a raw JSON Schema with two required fields.",
          parameters: {
            type: "object",
            additionalProperties: false,
            required: ["path", "depth"],
            properties: { path: { type: "string", minLength: 1 }, depth: { type: "integer", minimum: 0 } },
          },
          loadMode: "essential",
          approval: "read",
          execute(_id, params, _signal, _onUpdate, ctx) {
            log("exec", { tool: "list", params, invokeTool: typeof ctx.invokeTool });
            return Promise.resolve(text(`SPIKE-LIST ${JSON.stringify(params)}`));
          },
        });
        break;
      case "fail":
        pi.registerTool({
          name: "fail",
          label: "Spike fail",
          description: 'The spike\'s fail tool: it returns an error result, and with {"throw": true} it throws.',
          parameters: { type: "object", additionalProperties: false, properties: { throw: { type: "boolean" } } },
          loadMode: "essential",
          execute(_id, params) {
            log("exec", { tool: "fail", params });
            if (params["throw"] === true) {
              return Promise.reject(new Error("SPIKE-THROWN"));
            }
            return Promise.resolve({ content: [{ type: "text", text: "SPIKE-ERROR-RESULT" }], details: {}, isError: true });
          },
        });
        break;
      case "big":
        pi.registerTool({
          name: "big",
          label: "Spike big",
          description: "The spike's big tool: it answers one large text, to show what Omp does with a 1 MiB result.",
          parameters: { type: "object", additionalProperties: false, properties: {} },
          loadMode: "essential",
          approval: "read",
          execute() {
            log("exec", { tool: "big", bytes: SPIKE_BIG_BYTES });
            return Promise.resolve(text("B".repeat(SPIKE_BIG_BYTES), { bytes: SPIKE_BIG_BYTES }));
          },
        });
        break;
      case "hold":
        pi.registerTool({
          name: "hold",
          label: "Spike hold",
          description: "The spike's hold tool: it starts and never finishes, so a scenario can end the process mid-call.",
          parameters: { type: "object", additionalProperties: false, properties: {} },
          loadMode: "essential",
          execute() {
            log("exec", { tool: "hold", started: true });
            return new Promise<ToolResult>(() => undefined);
          },
        });
        break;
    }
  }

  const fallbackTarget = config.fallbackTarget;
  if (fallbackTarget !== undefined) {
    pi.registerFileWriteFallback((request) => {
      log("fallback", {
        dst: request.dst,
        content: request.content,
        hasSessionId: request.sessionId !== undefined,
        cause: String((request.cause as { code?: unknown } | undefined)?.code ?? request.cause),
      });
      writeFileSync(fallbackTarget, request.content);
      return Promise.resolve(true);
    });
  }

  pi.on("session_start", async (_event, ctx) => {
    const all = pi.getAllTools();
    const before = pi.getActiveTools();
    log("session_start", {
      sessionId: ctx.sessionManager.getSessionId(),
      active: before,
      all: all.map((tool) => `${tool.name}:${tool.sourceInfo?.source ?? "?"}`),
      ...(config.logSchemas === true ? { descriptions: Object.fromEntries(all.map((tool) => [tool.name, tool.description])) } : {}),
    });
    let wanted: string[] | undefined;
    if (config.activeOnly !== undefined) {
      const known = new Set(all.map((tool) => tool.name));
      wanted = config.activeOnly.filter((name) => known.has(name));
    } else if (config.deactivate !== undefined) {
      const removed = new Set(config.deactivate);
      wanted = before.filter((name) => !removed.has(name));
    }
    if (wanted === undefined) {
      return;
    }
    try {
      await pi.setActiveTools(wanted);
      log("set_active_tools", { requested: wanted, active: pi.getActiveTools() });
    } catch (error) {
      log("error", { where: "setActiveTools", message: message(error) });
    }
  });

  pi.on("session_switch", (_event, ctx) => {
    log("session_switch", { sessionId: ctx.sessionManager.getSessionId(), active: pi.getActiveTools() });
  });

  pi.on("session_shutdown", (_event, ctx) => {
    log("session_shutdown", { sessionId: ctx.sessionManager.getSessionId() });
  });

  pi.on("tool_approval_requested", (event) => {
    log("tool_approval_requested", { toolName: event.toolName, approvalMode: event.approvalMode });
  });

  pi.on("tool_approval_resolved", (event) => {
    log("tool_approval_resolved", { toolName: event.toolName, approved: event.approved });
  });

  pi.on("tool_call", async (event, ctx) => {
    log("tool_call", {
      sessionId: ctx.sessionManager.getSessionId(),
      toolName: event.toolName,
      toolCallId: event.toolCallId,
      input: event.input,
      active: pi.getActiveTools(),
    });
    const rule = (config.onToolCall ?? []).find((candidate) => candidate.tool === event.toolName);
    if (rule === undefined) {
      return undefined;
    }
    switch (rule.mode) {
      case "block":
        return { block: true, reason: rule.reason ?? "SPIKE-BLOCK" };
      case "rewrite":
        return { input: rule.input ?? {} };
      case "throw":
        throw new Error(rule.reason ?? "SPIKE-THROW");
      case "hang":
        // Never settles: Omp's own tool_call budget (extensionHandlers.toolCallTimeoutMs) has to end the wait.
        return new Promise<never>(() => undefined);
    }
  });

  pi.on("tool_result", (event, ctx) => {
    const resultText = textOf(event.content);
    log("tool_result", {
      sessionId: ctx.sessionManager.getSessionId(),
      toolName: event.toolName,
      toolCallId: event.toolCallId,
      isError: event.isError,
      // A large result is logged by its length and its head, so the log stays readable.
      textLength: resultText.length,
      text: resultText.slice(0, 2000),
    });
    const rule = (config.onToolResult ?? []).find((candidate) => candidate.tool === event.toolName);
    if (rule === undefined) {
      return undefined;
    }
    return { content: [{ type: "text", text: rule.text }], isError: rule.isError };
  });
}

// A typed driver for one real Omp process in RPC UI mode (HARN-01; decisions D-1202, D-1203, D-1206 of phase 12). It is the port of
// the prototype drive-omp.mjs: the same spawn arguments and the same frame handling, with the poll loops and the fixed sleeps
// replaced by waits that resolve from the frame handler, and the swallowed parse errors replaced by a count and a list.
//
// Omp is started as `omp --mode rpc-ui --no-extensions -e <extension> --model stub/scripted --no-session`, with the profile's
// environment and the workspace as cwd. Each stdout line is one JSON frame; a line that is not a JSON object is kept in
// nonJsonLines (progress noise is expected there, never a failure). Omp's stderr is collected and never treated as a failure.
//
// Frozen interface (other units import exactly these names):
//   startOmp({ bin, env, cwd, extensionPath, wrap? }): OmpSession
//     wrap   an argv prefix put before the Omp command, for example traceArgv(outFile) of net-trace.ts (`strace ... --`)
//   class OmpSession
//     frames: readonly OmpFrame[]                 every JSON object frame, in arrival order
//     nonJsonLines: readonly string[]             every stdout line that was not a JSON object; its length is the count
//     status(): string | undefined                statusText of the last `setStatus` frame with statusKey "realm"
//     notices(): string[]                         the message of every `notify` frame
//     toolStarts(): ToolStart[], toolEnds(): ToolEnd[]
//     dialogs(): readonly OmpFrame[]              the confirm/select/input/editor requests that were auto-answered
//     stderr(): string                            the tail of Omp's stderr
//     exited: Promise<OmpExit>                    settles when the process has closed; never rejects
//     waitFor(predicate, ms, label): Promise<void>    predicate(session) is tested now and after every frame; a timeout or an exit
//                                                 rejects with the tail of the frames
//     ready(ms?): Promise<void>                   waits for the `ready` frame (default OMP_READY_TIMEOUT_MS)
//     prompt(text, ms?): Promise<PromptOutcome>   sends a prompt and resolves on that prompt's terminal `agent_end` or its
//                                                 `prompt_result` (default OMP_PROMPT_TIMEOUT_MS); a slash command ends the same way
//     send(command): void                         one JSON command line on stdin
//     signal(signal): boolean                     signals the command's process group (Omp, and under `wrap` the wrapper too)
//     close(options?): Promise<OmpExit>           stdin end, wait, SIGTERM, wait, SIGKILL, wait; every wait is bounded
//   Pure pieces, exported so they are testable without a process: JsonlFramer, ompArgs, ompCommand, toolStartOf, toolEndOf, killGroup,
//   turnFailures, summariseFrames, scriptedTurnProblem (is a scripted turn proven: a provider request for it, a turn ended with stop, no failed turn).
//
// Dialogs: Omp asks the extension host with `extension_ui_request` frames. confirm is answered `confirmed: true`; select, input and
// editor are answered `cancelled: true`. notify and setStatus need no answer.

import { spawn } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import { isRecord, OMP_PROMPT_TIMEOUT_MS, OMP_READY_TIMEOUT_MS } from "./omp-live.js";

// ---- Framing ---------------------------------------------------------------------------------------------------------------

// One JSON object printed by Omp on stdout.
export type OmpFrame = Readonly<Record<string, unknown>>;

export type ParsedLine = { readonly kind: "frame"; readonly frame: OmpFrame } | { readonly kind: "text"; readonly line: string };

// Turns one line into a frame, or into text when it is not a JSON object. A blank line is nothing.
function parseLine(raw: string): ParsedLine | undefined {
  const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
  if (line.trim() === "") {
    return undefined;
  }
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return { kind: "text", line };
  }
  return isRecord(value) ? { kind: "frame", frame: value } : { kind: "text", line };
}

// A line-buffered parser. A chunk may end in the middle of a line: the rest waits for the next push. flush() reads a final line
// that has no newline, for the end of the stream.
export class JsonlFramer {
  #buffer = "";

  push(chunk: string): ParsedLine[] {
    this.#buffer += chunk;
    const parsed: ParsedLine[] = [];
    let newline = this.#buffer.indexOf("\n");
    while (newline >= 0) {
      const line = this.#buffer.slice(0, newline);
      this.#buffer = this.#buffer.slice(newline + 1);
      const entry = parseLine(line);
      if (entry !== undefined) {
        parsed.push(entry);
      }
      newline = this.#buffer.indexOf("\n");
    }
    return parsed;
  }

  flush(): ParsedLine[] {
    const rest = this.#buffer;
    this.#buffer = "";
    const entry = parseLine(rest);
    return entry === undefined ? [] : [entry];
  }
}

// ---- Tool frames -----------------------------------------------------------------------------------------------------------

export interface ToolStart {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly args: unknown;
}

export interface ToolEnd {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly isError: boolean;
  // The text parts of result.content joined.
  readonly text: string;
  readonly frame: OmpFrame;
}

function stringOf(value: unknown): string {
  return typeof value === "string" ? value : "";
}

// The tool_execution_start frame as a ToolStart, or undefined for any other frame.
export function toolStartOf(frame: OmpFrame): ToolStart | undefined {
  if (frame["type"] !== "tool_execution_start") {
    return undefined;
  }
  return { toolCallId: stringOf(frame["toolCallId"]), toolName: stringOf(frame["toolName"]), args: frame["args"] };
}

// The tool_execution_end frame as a ToolEnd, or undefined for any other frame.
export function toolEndOf(frame: OmpFrame): ToolEnd | undefined {
  if (frame["type"] !== "tool_execution_end") {
    return undefined;
  }
  const result = frame["result"];
  const content = isRecord(result) ? result["content"] : undefined;
  const text = Array.isArray(content)
    ? content.map((part: unknown) => (isRecord(part) && typeof part["text"] === "string" ? part["text"] : "")).join("")
    : "";
  return {
    toolCallId: stringOf(frame["toolCallId"]),
    toolName: stringOf(frame["toolName"]),
    isError: frame["isError"] === true,
    text,
    frame,
  };
}

// ---- Process ---------------------------------------------------------------------------------------------------------------

// What the session needs of the child process. A node ChildProcess started with piped stdio satisfies it, and so does the tiny
// fake of the hermetic test.
export interface OmpChild {
  readonly stdin: Writable;
  readonly stdout: Readable;
  readonly stderr: Readable;
  kill(signal: NodeJS.Signals): boolean;
}

// How the process ended. `error` is set when it could not start.
export interface OmpExit {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly error?: string;
}

export interface PromptOutcome {
  readonly id: string;
  // The status of the prompt_result frame when it had arrived by the time the prompt settled.
  readonly status: string | undefined;
  readonly toolStarts: readonly ToolStart[];
  readonly toolEnds: readonly ToolEnd[];
  // Every frame that arrived since the prompt was sent.
  readonly frames: readonly OmpFrame[];
}

export interface CloseOptions {
  // How long to wait after ending stdin before SIGTERM, after SIGTERM before SIGKILL, and after SIGKILL before giving up.
  readonly graceMs?: number;
  readonly termMs?: number;
  readonly killMs?: number;
}

const DEFAULT_CLOSE_STAGE_MS = 5_000;
const STDERR_LIMIT_BYTES = 64 * 1024;
const TAIL_FRAMES = 8;
const FRAME_CLIP = 300;
const STDERR_CLIP = 600;

// The arguments Omp is started with (the prototype's).
export function ompArgs(extensionPath: string): string[] {
  return ["--mode", "rpc-ui", "--no-extensions", "-e", extensionPath, "--model", "stub/scripted", "--no-session"];
}

export interface StartOmpOptions {
  readonly bin: string;
  readonly env: Readonly<Record<string, string>>;
  readonly cwd: string;
  readonly extensionPath: string;
  // An argv prefix put before the Omp command, for example the strace argv of the network trace.
  readonly wrap?: readonly string[];
}

// The command and arguments to spawn: Omp itself, or the wrapper with Omp after it.
export function ompCommand(options: Pick<StartOmpOptions, "bin" | "extensionPath" | "wrap">): { command: string; args: string[] } {
  const [wrapper, ...wrapArgs] = options.wrap ?? [];
  if (wrapper === undefined) {
    return { command: options.bin, args: ompArgs(options.extensionPath) };
  }
  return { command: wrapper, args: [...wrapArgs, options.bin, ...ompArgs(options.extensionPath)] };
}

// Signals the whole process group the child leads, so a wrapper (strace) and everything it started receive the signal, not the
// wrapper alone. A group that no longer exists (ESRCH) falls back to the pid, which then also reports whether the child was alive.
export function killGroup(child: { readonly pid?: number | undefined; kill(signal: NodeJS.Signals): boolean }, signal: NodeJS.Signals): boolean {
  const { pid } = child;
  if (pid !== undefined) {
    try {
      process.kill(-pid, signal);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
        throw error;
      }
    }
  }
  return child.kill(signal);
}

// Starts Omp. A process that cannot start (ENOENT) is reported through `exited` and rejects every wait. The command leads its own
// process group (`detached`), and every signal the session sends goes to that group: under `wrap` the direct child is strace, not
// Omp, and a SIGKILL of the wrapper alone leaves Omp running with its pipes open. stdio stays piped and the child is not unref'd.
export function startOmp(options: StartOmpOptions): OmpSession {
  const { command, args } = ompCommand(options);
  const child = spawn(command, args, { cwd: options.cwd, env: { ...options.env }, stdio: ["pipe", "pipe", "pipe"], detached: true });
  const exited = new Promise<OmpExit>((resolve) => {
    child.once("error", (error) => {
      resolve({ code: null, signal: null, error: error.message });
    });
    child.once("close", (code, signal) => {
      resolve({ code, signal });
    });
  });
  return new OmpSession(
    { stdin: child.stdin, stdout: child.stdout, stderr: child.stderr, kill: (signal) => killGroup(child, signal) },
    exited,
  );
}

// ---- Turn checks -----------------------------------------------------------------------------------------------------------

// The last `limit` frames as clipped JSON, for a failure message.
export function summariseFrames(frames: readonly OmpFrame[], limit = 6): string {
  const tail = frames.slice(-limit).map((frame) => clip(JSON.stringify(frame), FRAME_CLIP));
  return `${String(frames.length)} frames; last ${String(tail.length)}: ${tail.length === 0 ? "(none)" : tail.join(" | ")}`;
}

// What went wrong in the turns of these frames: a `turn_end` whose assistant message stopped with `error` or `aborted` (a model
// or provider failure), with its error message when it has one. Empty when no turn failed.
export function turnFailures(frames: readonly OmpFrame[]): string[] {
  const failures: string[] = [];
  for (const frame of frames) {
    if (frame["type"] !== "turn_end") {
      continue;
    }
    const message = frame["message"];
    if (!isRecord(message)) {
      continue;
    }
    const reason = message["stopReason"];
    if (reason === "error" || reason === "aborted") {
      const detail = typeof message["errorMessage"] === "string" ? `: ${clip(message["errorMessage"], FRAME_CLIP)}` : "";
      failures.push(`a turn ended with stopReason ${reason}${detail}`);
    }
  }
  return failures;
}

// The requests the scripted provider received (those in `requests`) and the frames Omp printed for ONE scripted turn, judged
// together. Undefined when the turn is proven: the provider recorded a request whose last user text contains `prompt`, Omp ended
// at least one turn with stopReason `stop`, and no turn failed. Otherwise the problem, with the frames summary.
export function scriptedTurnProblem(input: {
  readonly prompt: string;
  readonly requests: readonly { readonly userText: string }[];
  readonly frames: readonly OmpFrame[];
}): string | undefined {
  const problems = turnFailures(input.frames);
  if (!input.requests.some((request) => request.userText.includes(input.prompt))) {
    problems.push(`the scripted provider received no request for the prompt ${JSON.stringify(input.prompt)}`);
  }
  const stopped = input.frames.some(
    (frame) => frame["type"] === "turn_end" && isRecord(frame["message"]) && frame["message"]["stopReason"] === "stop",
  );
  if (!stopped) {
    problems.push("no turn ended with stopReason stop");
  }
  return problems.length === 0 ? undefined : `${problems.join("; ")}; ${summariseFrames(input.frames)}`;
}

// ---- Session ---------------------------------------------------------------------------------------------------------------

interface Waiter {
  readonly predicate: (session: OmpSession) => boolean;
  readonly label: string;
  readonly resolve: () => void;
  readonly reject: (error: Error) => void;
  readonly timer: NodeJS.Timeout;
}

function clip(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

export class OmpSession {
  readonly #child: OmpChild;
  readonly #exited: Promise<OmpExit>;
  readonly #framer = new JsonlFramer();
  readonly #frames: OmpFrame[] = [];
  readonly #nonJsonLines: string[] = [];
  readonly #dialogs: OmpFrame[] = [];
  readonly #waiters = new Set<Waiter>();
  #stderr = "";
  #exit: OmpExit | undefined;
  #promptSeq = 0;

  constructor(child: OmpChild, exited: Promise<OmpExit>) {
    this.#child = child;
    this.#exited = exited;
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      this.#accept(this.#framer.push(chunk));
    });
    child.stdout.on("end", () => {
      this.#accept(this.#framer.flush());
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      this.#stderr = (this.#stderr + chunk).slice(-STDERR_LIMIT_BYTES);
      this.#evaluateWaiters();
    });
    // A write to a process that has gone fails with EPIPE; the exit is what the waits report, so the error is only recorded.
    child.stdin.on("error", (error) => {
      this.#stderr += `\n[stdin error: ${error.message}]`;
      this.#evaluateWaiters();
    });
    void exited.then((exit) => {
      this.#onExit(exit);
    });
  }

  get frames(): readonly OmpFrame[] {
    return this.#frames;
  }

  get nonJsonLines(): readonly string[] {
    return this.#nonJsonLines;
  }

  get exited(): Promise<OmpExit> {
    return this.#exited;
  }

  // The text of the last `setStatus` frame with statusKey "realm"; undefined before the first one or after one that cleared it.
  status(): string | undefined {
    for (let index = this.#frames.length - 1; index >= 0; index -= 1) {
      const frame = this.#frames[index];
      if (frame?.["type"] === "extension_ui_request" && frame["method"] === "setStatus" && frame["statusKey"] === "realm") {
        const text = frame["statusText"];
        return typeof text === "string" ? text : undefined;
      }
    }
    return undefined;
  }

  // The message of every `notify` frame, in order.
  notices(): string[] {
    const messages: string[] = [];
    for (const frame of this.#frames) {
      if (frame["type"] === "extension_ui_request" && frame["method"] === "notify") {
        messages.push(stringOf(frame["message"]));
      }
    }
    return messages;
  }

  toolStarts(): ToolStart[] {
    return this.#toolStartsOf(this.#frames);
  }

  toolEnds(): ToolEnd[] {
    return this.#toolEndsOf(this.#frames);
  }

  dialogs(): readonly OmpFrame[] {
    return this.#dialogs;
  }

  stderr(): string {
    return this.#stderr;
  }

  // Resolves as soon as predicate(this) holds. It is tested on the call and after every frame, never on a timer. It rejects when
  // ms pass first, or when Omp exits first; either message carries the label, the tail of the frames and the stderr tail.
  waitFor(predicate: (session: OmpSession) => boolean, ms: number, label: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (predicate(this)) {
        resolve();
        return;
      }
      if (this.#exit !== undefined) {
        reject(new Error(this.#describe(`Omp had already exited (${this.#exitText(this.#exit)})`, label)));
        return;
      }
      const timer = setTimeout(() => {
        this.#waiters.delete(waiter);
        reject(new Error(this.#describe(`timed out after ${String(ms)} ms`, label)));
      }, ms);
      const waiter: Waiter = { predicate, label, resolve, reject, timer };
      this.#waiters.add(waiter);
    });
  }

  // Waits for Omp's `ready` frame.
  ready(ms: number = OMP_READY_TIMEOUT_MS): Promise<void> {
    return this.waitFor((session) => session.frames.some((frame) => frame["type"] === "ready"), ms, "the ready frame");
  }

  // Sends a prompt (or a slash command) and resolves when it settles: the terminal agent_end that follows it, or its prompt_result.
  // A `response` frame that refuses the command rejects.
  async prompt(message: string, ms: number = OMP_PROMPT_TIMEOUT_MS): Promise<PromptOutcome> {
    this.#promptSeq += 1;
    const id = `p${String(this.#promptSeq)}`;
    const mark = this.#frames.length;
    this.send({ id, type: "prompt", message });
    await this.waitFor(
      (session) => session.frames.slice(mark).some((frame) => this.#settles(frame, id)),
      ms,
      `prompt ${id} ${JSON.stringify(clip(message, 80))}`,
    );
    const frames = this.#frames.slice(mark);
    const refused = frames.find((frame) => frame["type"] === "response" && frame["id"] === id && frame["success"] === false);
    if (refused !== undefined) {
      throw new Error(`Omp refused prompt ${id}: ${clip(JSON.stringify(refused), FRAME_CLIP)}`);
    }
    const result = frames.find((frame) => frame["type"] === "prompt_result" && frame["id"] === id);
    const status = result === undefined ? undefined : stringOf(result["status"]);
    return { id, status, toolStarts: this.#toolStartsOf(frames), toolEnds: this.#toolEndsOf(frames), frames };
  }

  // One JSON command line on stdin.
  send(command: Readonly<Record<string, unknown>>): void {
    this.#child.stdin.write(`${JSON.stringify(command)}\n`);
  }

  // Signals the command's whole process group: Omp, and under `wrap` the wrapper and everything either started. The test's own
  // process is never in that group.
  signal(signal: NodeJS.Signals): boolean {
    return this.#child.kill(signal);
  }

  // Ends stdin and waits; then SIGTERM and waits; then SIGKILL and waits. Rejects only when Omp is still alive after SIGKILL.
  async close(options: CloseOptions = {}): Promise<OmpExit> {
    if (this.#exit !== undefined) {
      return this.#exit;
    }
    this.#child.stdin.end();
    const graceful = await this.#exitWithin(options.graceMs ?? DEFAULT_CLOSE_STAGE_MS);
    if (graceful !== undefined) {
      return graceful;
    }
    this.#child.kill("SIGTERM");
    const terminated = await this.#exitWithin(options.termMs ?? DEFAULT_CLOSE_STAGE_MS);
    if (terminated !== undefined) {
      return terminated;
    }
    this.#child.kill("SIGKILL");
    const killed = await this.#exitWithin(options.killMs ?? DEFAULT_CLOSE_STAGE_MS);
    if (killed !== undefined) {
      return killed;
    }
    throw new Error(this.#describe("Omp is still running after SIGKILL", "close"));
  }

  // ---- internals ----

  // True for a frame that ends prompt `id`: its refusal, its prompt_result, or a terminal agent_end.
  #settles(frame: OmpFrame, id: string): boolean {
    switch (frame["type"]) {
      case "agent_end":
        return frame["isTerminal"] !== false;
      case "prompt_result":
        return frame["id"] === id;
      case "response":
        return frame["id"] === id && frame["success"] === false;
      default:
        return false;
    }
  }

  #toolStartsOf(frames: readonly OmpFrame[]): ToolStart[] {
    const starts: ToolStart[] = [];
    for (const frame of frames) {
      const start = toolStartOf(frame);
      if (start !== undefined) {
        starts.push(start);
      }
    }
    return starts;
  }

  #toolEndsOf(frames: readonly OmpFrame[]): ToolEnd[] {
    const ends: ToolEnd[] = [];
    for (const frame of frames) {
      const end = toolEndOf(frame);
      if (end !== undefined) {
        ends.push(end);
      }
    }
    return ends;
  }

  #accept(lines: readonly ParsedLine[]): void {
    for (const entry of lines) {
      if (entry.kind === "text") {
        this.#nonJsonLines.push(entry.line);
        this.#evaluateWaiters();
        continue;
      }
      this.#frames.push(entry.frame);
      this.#answerDialog(entry.frame);
      this.#evaluateWaiters();
    }
  }

  #answerDialog(frame: OmpFrame): void {
    if (frame["type"] !== "extension_ui_request") {
      return;
    }
    const method = frame["method"];
    if (method !== "confirm" && method !== "select" && method !== "input" && method !== "editor") {
      return;
    }
    this.#dialogs.push(frame);
    this.send({ type: "extension_ui_response", id: frame["id"], ...(method === "confirm" ? { confirmed: true } : { cancelled: true }) });
  }

  #evaluateWaiters(): void {
    for (const waiter of [...this.#waiters]) {
      let satisfied: boolean;
      try {
        satisfied = waiter.predicate(this);
      } catch (error) {
        this.#waiters.delete(waiter);
        clearTimeout(waiter.timer);
        waiter.reject(error instanceof Error ? error : new Error(String(error)));
        continue;
      }
      if (satisfied) {
        this.#waiters.delete(waiter);
        clearTimeout(waiter.timer);
        waiter.resolve();
      }
    }
  }

  #onExit(exit: OmpExit): void {
    this.#exit = exit;
    // The stdout end and the close event can arrive in either order across platforms; read what is left, then judge the waits.
    this.#accept(this.#framer.flush());
    for (const waiter of [...this.#waiters]) {
      this.#waiters.delete(waiter);
      clearTimeout(waiter.timer);
      waiter.reject(new Error(this.#describe(`Omp exited (${this.#exitText(exit)})`, waiter.label)));
    }
  }

  #exitText(exit: OmpExit): string {
    if (exit.error !== undefined) {
      return `could not start: ${exit.error}`;
    }
    return exit.signal === null ? `code ${String(exit.code)}` : `signal ${exit.signal}`;
  }

  async #exitWithin(ms: number): Promise<OmpExit | undefined> {
    let timer: NodeJS.Timeout | undefined;
    const expired = new Promise<undefined>((resolve) => {
      timer = setTimeout(() => {
        resolve(undefined);
      }, ms);
    });
    try {
      return await Promise.race([this.#exited, expired]);
    } finally {
      clearTimeout(timer);
    }
  }

  // The failure text of a wait: why, what was awaited, the last frames, the count of non-JSON lines and the stderr tail.
  #describe(reason: string, label: string): string {
    const tail = this.#frames.slice(-TAIL_FRAMES).map((frame) => clip(JSON.stringify(frame), FRAME_CLIP));
    return [
      `${reason} while waiting for ${label}`,
      `frames: ${String(this.#frames.length)}; non-JSON lines: ${String(this.#nonJsonLines.length)}`,
      `last frames: ${tail.length === 0 ? "(none)" : tail.join(" | ")}`,
      `stderr tail: ${JSON.stringify(clip(this.#stderr.slice(-STDERR_CLIP), STDERR_CLIP))}`,
    ].join("; ");
  }
}

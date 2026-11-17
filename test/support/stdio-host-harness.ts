// Shared seams for the realm mcp and realm acp boot tests (BOOT-03, BOOT-04): a signal fake that raises no real signal, a capturing
// writable, and the JSON-RPC frame helpers that check stdout holds protocol frames only.

import assert from "node:assert/strict";
import { Writable } from "node:stream";
import type { StdioSignal, StdioSignals } from "../../src/cli/stdio-host.js";
import { pollUntil } from "./timing.js";

// Records every exit code; a raised signal runs the handlers registered for it once, as process.once does.
export class FakeSignals implements StdioSignals {
  readonly exits: number[] = [];
  private readonly handlers = new Map<StdioSignal, Set<() => void>>();

  readonly once = (signal: StdioSignal, handler: () => void): (() => void) => {
    const set = this.handlers.get(signal) ?? new Set<() => void>();
    this.handlers.set(signal, set);
    set.add(handler);
    return () => {
      set.delete(handler);
    };
  };

  readonly exit = (code: number): void => {
    this.exits.push(code);
  };

  raise(signal: StdioSignal): void {
    const set = this.handlers.get(signal) ?? new Set<() => void>();
    for (const handler of [...set]) {
      set.delete(handler);
      handler();
    }
  }

  // The handlers still registered.
  armed(): number {
    return [...this.handlers.values()].reduce((sum, set) => sum + set.size, 0);
  }
}

export interface Capture {
  readonly stream: Writable;
  readonly text: () => string;
}

export function capture(): Capture {
  let buffer = "";
  const stream = new Writable({
    write(chunk: Buffer, _encoding, done) {
      buffer += chunk.toString("utf8");
      done();
    },
  });
  return { stream, text: () => buffer };
}

export const frame = (id: number, method: string, params: unknown): string => `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`;
export const listTools = (id: number): string => frame(id, "tools/list", {});
export const callStatus = (id: number): string => frame(id, "tools/call", { name: "status", arguments: {} });

// Every non-empty line is one JSON-RPC 2.0 frame. Stdout holds nothing else in any outcome.
export function framesOf(text: string): Record<string, unknown>[] {
  return text
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => {
      const parsed: unknown = JSON.parse(line);
      assert.ok(typeof parsed === "object" && parsed !== null && !Array.isArray(parsed), `a frame, not ${line}`);
      const record = parsed as Record<string, unknown>;
      assert.equal(record["jsonrpc"], "2.0", `a JSON-RPC frame: ${line}`);
      return record;
    });
}

// Waits for the reply to request id on a captured stdout and returns it.
export async function untilReplyOn(output: Capture, id: number): Promise<Record<string, unknown>> {
  await pollUntil(() => framesOf(output.text()).some((entry) => entry["id"] === id), `the reply to request ${String(id)}`);
  const reply = framesOf(output.text()).find((entry) => entry["id"] === id);
  assert.ok(reply);
  return reply;
}

// The structuredContent of a tools/call reply.
export function toolOutcomeOf(reply: Record<string, unknown>): Record<string, unknown> {
  const result = reply["result"];
  assert.ok(typeof result === "object" && result !== null && "structuredContent" in result);
  const content = result.structuredContent;
  assert.ok(typeof content === "object" && content !== null);
  return content as Record<string, unknown>;
}

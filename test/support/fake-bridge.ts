// In-memory BridgePort for tests (D-64, D-65). It mirrors the FakeExecutionService control
// surface: a call log, per-operation delays, one-shot failures, and a hook that runs when an
// operation starts. Default behaviour is zero latency and healthy. emit() publishes a
// BridgeEvent to every subscriber, which is how controller tests drive up, down, and mismatch.

import { type ErrorCode, makeRealmError } from "../../src/core/errors.js";
import type { BridgeEvent, BridgeKind, BridgePort } from "../../src/core/ports.js";

export type BridgeOperation = "connect" | "close";

export interface BridgeCall {
  readonly operation: BridgeOperation;
  readonly deadlineMs?: number;
}

type Listener = (event: BridgeEvent) => void;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export class FakeBridge implements BridgePort {
  private readonly listeners = new Set<Listener>();
  private readonly log: BridgeCall[] = [];
  private readonly delays = new Map<BridgeOperation, number>();
  private readonly failures = new Map<BridgeOperation, ErrorCode | Error>();
  private readonly hooks = new Map<BridgeOperation, () => void>();
  private last: BridgeEvent | null = null;

  async connect(deadlineMs: number): Promise<void> {
    await this.run({ operation: "connect", deadlineMs });
  }

  snapshot(): BridgeEvent | null {
    return this.last;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async close(): Promise<void> {
    await this.run({ operation: "close" });
  }

  // Every call of the operation is delayed by ms until the delay is set again. Zero clears it.
  setDelay(operation: BridgeOperation, ms: number): void {
    if (ms === 0) {
      this.delays.delete(operation);
    } else {
      this.delays.set(operation, ms);
    }
  }

  // The next call of the operation fails with the given catalogue code or error.
  failNext(operation: BridgeOperation, failure: ErrorCode | Error): void {
    this.failures.set(operation, failure);
  }

  // Runs when the operation is called, after the call is logged and before it takes effect.
  beforeCall(operation: BridgeOperation, hook: () => void): void {
    this.hooks.set(operation, hook);
  }

  // Publishes an event to every subscriber, with the same fields the real bridge sets.
  emit(input: { readonly kind: BridgeKind; readonly code?: ErrorCode }): BridgeEvent {
    const at = new Date().toISOString();
    const event: BridgeEvent = input.code === undefined ? { kind: input.kind, at } : { kind: input.kind, code: input.code, at };
    this.last = event;
    for (const listener of [...this.listeners]) {
      listener(event);
    }
    return event;
  }

  calls(): readonly BridgeCall[] {
    return [...this.log];
  }

  callCount(operation: BridgeOperation): number {
    return this.log.filter((call) => call.operation === operation).length;
  }

  private async run(call: BridgeCall): Promise<void> {
    this.log.push(call);
    this.hooks.get(call.operation)?.();
    const ms = this.delays.get(call.operation) ?? 0;
    if (ms > 0) {
      await sleep(ms);
    }
    const failure = this.failures.get(call.operation);
    if (failure !== undefined) {
      this.failures.delete(call.operation);
      throw typeof failure === "string" ? makeRealmError(failure) : failure;
    }
  }
}

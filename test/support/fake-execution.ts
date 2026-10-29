// In-memory ExecutionService for tests (D-39). Resources are keyed by idempotency key,
// every call is logged with its request object as received, and each operation can be
// given a delay, a hold gate, a one-shot failure, or a hook that runs when the call
// starts. The fake has no environment parameter: the port has none (AUD-02).

import { makeRealmError, type ErrorCode } from "../../src/core/errors.js";
import type { CreateRequest, ExecutionService, ProbeResult } from "../../src/core/ports.js";

export type Operation = "create" | "start" | "probe" | "stop" | "destroy";

export interface FakeCall {
  readonly operation: Operation;
  readonly request?: CreateRequest;
  readonly containerId?: string;
  readonly sandbox?: string;
}

export interface FakeResource {
  readonly containerId: string;
  readonly idempotencyKey: string;
  readonly started: boolean;
  readonly health: ProbeResult;
}

interface MutableResource {
  readonly containerId: string;
  readonly idempotencyKey: string;
  started: boolean;
  health: ProbeResult;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

// One hold gate: the one call that takes it waits on its promise.
interface Gate {
  readonly open: Promise<void>;
}

export class FakeExecutionService implements ExecutionService {
  private readonly table = new Map<string, MutableResource>();
  private readonly byKey = new Map<string, string>();
  private readonly log: FakeCall[] = [];
  private readonly delays = new Map<Operation, number>();
  private readonly failures = new Map<Operation, ErrorCode | Error>();
  private readonly hooks = new Map<Operation, () => void>();
  private readonly gates = new Map<Operation, Gate[]>();
  private readonly inFlight = new Set<Promise<void>>();
  private sequence = 0;

  async create(request: CreateRequest): Promise<{ readonly containerId: string }> {
    return this.run({ operation: "create", request }, () => {
      const existing = this.byKey.get(request.idempotencyKey);
      if (existing !== undefined) {
        return { containerId: existing };
      }
      this.sequence += 1;
      const containerId = `fake-container-${String(this.sequence)}`;
      this.table.set(containerId, {
        containerId,
        idempotencyKey: request.idempotencyKey,
        started: false,
        health: "healthy",
      });
      this.byKey.set(request.idempotencyKey, containerId);
      return { containerId };
    });
  }

  async start(containerId: string, sandbox: string): Promise<void> {
    return this.run({ operation: "start", containerId, sandbox }, () => {
      this.require(containerId).started = true;
    });
  }

  async probe(containerId: string, sandbox: string): Promise<ProbeResult> {
    return this.run({ operation: "probe", containerId, sandbox }, () => this.require(containerId).health);
  }

  async stop(containerId: string, sandbox: string): Promise<void> {
    return this.run({ operation: "stop", containerId, sandbox }, () => {
      this.require(containerId).started = false;
    });
  }

  // Destroying a container that does not exist is a no-op.
  async destroy(containerId: string, sandbox: string): Promise<void> {
    return this.run({ operation: "destroy", containerId, sandbox }, () => {
      const resource = this.table.get(containerId);
      if (resource !== undefined) {
        this.table.delete(containerId);
        this.byKey.delete(resource.idempotencyKey);
      }
    });
  }

  // Every call of the operation is delayed by ms until the delay is set again. Zero
  // clears it.
  setDelay(operation: Operation, ms: number): void {
    if (ms <= 0) {
      this.delays.delete(operation);
    } else {
      this.delays.set(operation, ms);
    }
  }

  // Holds the NEXT call of the operation that has no hold yet: after it is logged and its hook has run, that call waits until
  // the returned function is called. Calls made after it are not gated, so a test can park one call, let a later call of the
  // same operation run, and release the first afterwards. Two holds on one operation are taken by the calls in call order.
  // The release function is idempotent.
  holdNext(operation: Operation): () => void {
    let release: () => void = () => undefined;
    const open = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queue = this.gates.get(operation) ?? [];
    queue.push({ open });
    this.gates.set(operation, queue);
    return release;
  }

  // Resolves when every call started so far has completed, held ones included once they are released. It never rejects: a
  // call that failed has completed.
  async settled(): Promise<void> {
    await Promise.all([...this.inFlight]);
  }

  // The next call of the operation fails with the given catalogue code or error.
  failNext(operation: Operation, failure: ErrorCode | Error): void {
    this.failures.set(operation, failure);
  }

  // Runs when the operation is called, after the call is logged and before it takes
  // effect. Used to observe what the caller has persisted at that moment.
  beforeCall(operation: Operation, hook: () => void): void {
    this.hooks.set(operation, hook);
  }

  setHealth(containerId: string, health: ProbeResult): void {
    this.require(containerId).health = health;
  }

  calls(): readonly FakeCall[] {
    return [...this.log];
  }

  callCount(operation: Operation): number {
    return this.log.filter((call) => call.operation === operation).length;
  }

  resources(): readonly FakeResource[] {
    return [...this.table.values()].map((resource) => ({ ...resource }));
  }

  private run<T>(call: FakeCall, body: () => T): Promise<T> {
    const gate = this.gates.get(call.operation)?.shift();
    this.log.push(call);
    const result = this.execute(call, gate, body);
    const done = result.then(
      () => {
        this.inFlight.delete(done);
      },
      () => {
        this.inFlight.delete(done);
      },
    );
    this.inFlight.add(done);
    return result;
  }

  private async execute<T>(call: FakeCall, gate: Gate | undefined, body: () => T): Promise<T> {
    this.hooks.get(call.operation)?.();
    if (gate !== undefined) {
      await gate.open;
    }
    const ms = this.delays.get(call.operation) ?? 0;
    if (ms > 0) {
      await sleep(ms);
    }
    const failure = this.failures.get(call.operation);
    if (failure !== undefined) {
      this.failures.delete(call.operation);
      throw typeof failure === "string" ? makeRealmError(failure) : failure;
    }
    return body();
  }

  private require(containerId: string): MutableResource {
    const resource = this.table.get(containerId);
    if (resource === undefined) {
      throw new Error(`fake execution service has no container ${containerId}`);
    }
    return resource;
  }
}

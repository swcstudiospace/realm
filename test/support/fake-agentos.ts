// In-memory AgentOsDriver for tests (D-59). Each operation consumes the next scripted
// outcome: "ok" (the default once the script is empty), "reject" (the call rejects), or
// "hang" (the call never settles, so a caller must time it out). Every call is logged.
// The fake models liveness with one flag: start sets it, stop clears it, crash() clears
// it as if the process died, and alive() reports it.

import type { AgentOsDriver } from "../../src/runtime/agentos.js";

export type AgentOsOperation = "start" | "alive" | "stop";
export type ScriptedOutcome = "ok" | "reject" | "hang";

export class FakeAgentOsDriver implements AgentOsDriver {
  private running = false;
  private readonly scripts = new Map<AgentOsOperation, ScriptedOutcome[]>();
  private readonly log: AgentOsOperation[] = [];

  async start(): Promise<void> {
    await this.run("start", () => {
      this.running = true;
    });
  }

  async alive(): Promise<boolean> {
    return this.run("alive", () => this.running);
  }

  async stop(): Promise<void> {
    await this.run("stop", () => {
      this.running = false;
    });
  }

  // Queues outcomes for the next calls of one operation, in order.
  script(operation: AgentOsOperation, ...outcomes: readonly ScriptedOutcome[]): void {
    this.scripts.set(operation, [...(this.scripts.get(operation) ?? []), ...outcomes]);
  }

  // Simulates the process dying: the next alive() reports false.
  crash(): void {
    this.running = false;
  }

  isRunning(): boolean {
    return this.running;
  }

  calls(): readonly AgentOsOperation[] {
    return [...this.log];
  }

  callCount(operation: AgentOsOperation): number {
    return this.log.filter((call) => call === operation).length;
  }

  private async run<T>(operation: AgentOsOperation, body: () => T): Promise<T> {
    this.log.push(operation);
    const outcome = this.scripts.get(operation)?.shift() ?? "ok";
    if (outcome === "reject") {
      this.running = false;
      throw new Error("scripted AgentOS driver failure");
    }
    if (outcome === "hang") {
      return new Promise<T>(() => {});
    }
    return body();
  }
}

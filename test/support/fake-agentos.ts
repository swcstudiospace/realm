// In-memory AgentOsDriver for tests (D-59). Each operation consumes the next scripted
// outcome: "ok" (the default once the script is empty), "reject" (the call rejects), or
// "hang" (the call never settles, so a caller must time it out). Every call is logged.
// The fake models liveness with one flag: start sets it, stop clears it, crash() clears
// it as if the process died, and alive() reports it.
// create runs through the OpenShell runner the test passes in (the in-process FakeOpenShell in the
// session suite), so the create the session path issues is the one the driver builds. No process starts.

import type { AgentOsDriver } from "../../src/runtime/agentos.js";
import type { OpenShellRunner, SandboxCreateRequest } from "../../src/runtime/openshell.js";
import { createThrough } from "./sandbox-create.js";

export type AgentOsOperation = "create" | "start" | "alive" | "stop";
export type ScriptedOutcome = "ok" | "reject" | "hang";

export class FakeAgentOsDriver implements AgentOsDriver {
  private running = false;
  private exited = false;
  private readonly scripts = new Map<AgentOsOperation, ScriptedOutcome[]>();
  private readonly log: AgentOsOperation[] = [];
  private readonly runner: OpenShellRunner | undefined;

  // The runner is the in-process OpenShell fake that create runs against. A test that never creates may omit it.
  constructor(runner?: OpenShellRunner) {
    this.runner = runner;
  }

  async create(request: SandboxCreateRequest, timeoutMs: number): Promise<void> {
    await this.run("create", async () => {
      if (this.runner === undefined) {
        throw new Error("FakeAgentOsDriver.create needs the runner that runs the create");
      }
      await createThrough(this.runner)(request, timeoutMs);
    });
  }

  async start(): Promise<void> {
    await this.run("start", () => {
      this.running = true;
      this.exited = false;
    });
  }

  async alive(): Promise<boolean> {
    return this.run("alive", () => this.running);
  }

  async stop(): Promise<void> {
    await this.run("stop", () => {
      this.running = false;
      this.exited = false;
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

  // True when the runner child exited while the sandbox was started and not stopped. Set by exitRunner().
  runnerExited(): boolean {
    return this.exited;
  }

  // Simulates the runner child exiting while the sandbox stays up: runnerExited() then reports true.
  exitRunner(): void {
    this.exited = true;
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

  private async run<T>(operation: AgentOsOperation, body: () => T | Promise<T>): Promise<T> {
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

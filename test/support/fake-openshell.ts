// In-process OpenShell stand-in (D-55, D-56). A helper, not a test file: it is exercised by
// test/runtime/openshell-argv.test.ts. It records every argv exactly as the adapter built it and
// answers each run with a scripted step. No process is spawned.
//
// A successful create adds a labelled container to the FakeContainerStore that the fake libpod
// serves, so the label lookup in runOpenShellCreate sees the sandbox the way the real driver
// would expose it (OQ-P3-01 default). The labels are read from the argv before the separator
// only, as the real CLI does.

import type { FakeContainerStore } from "./fake-libpod.js";
import { OpenShellRunnerError, type OpenShellRunner, type OpenShellRunOptions, type OpenShellRunOutcome } from "../../src/runtime/openshell.js";

// create: exit 0 and add a labelled container. exit-1: exit 1, no container. reject: the start
// fails with a raw error. reject-failed and reject-timed-out: the runner rejects with the kinded
// OpenShellRunnerError. hang: never settles. silent: exit 0 and no container appears. An object
// { output } returns that outcome as it is, so exec tests can script stdout, stderr and truncated.
export type OpenShellStep =
  | "create"
  | "exit-1"
  | "reject"
  | "reject-failed"
  | "reject-timed-out"
  | "hang"
  | "silent"
  | { readonly output: OpenShellRunOutcome };

export interface FakeOpenShellCall {
  readonly argv: readonly string[];
  readonly timeoutMs: number;
  readonly captureOutput: boolean;
}

function labelsBeforeSeparator(argv: readonly string[]): Record<string, string> {
  const labels: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const element = argv[index];
    if (element === "--") {
      break;
    }
    if (element === "--label") {
      const pair = argv[index + 1] ?? "";
      const equals = pair.indexOf("=");
      if (equals > 0) {
        labels[pair.slice(0, equals)] = pair.slice(equals + 1);
      }
      index += 1;
    }
  }
  return labels;
}

export class FakeOpenShell {
  readonly runner: OpenShellRunner = (argv, options) => this.run(argv, options);
  private readonly store: FakeContainerStore;
  private readonly log: FakeOpenShellCall[] = [];
  private readonly script: OpenShellStep[] = [];
  private sequence = 0;

  constructor(store: FakeContainerStore) {
    this.store = store;
  }

  // Queues the steps for the next runs, in order. An unscripted run is a create.
  next(...steps: OpenShellStep[]): void {
    this.script.push(...steps);
  }

  calls(): readonly FakeOpenShellCall[] {
    return this.log.map((call) => ({ argv: [...call.argv], timeoutMs: call.timeoutMs, captureOutput: call.captureOutput }));
  }

  callCount(): number {
    return this.log.length;
  }

  private async run(argv: readonly string[], options: OpenShellRunOptions): Promise<OpenShellRunOutcome> {
    this.log.push({ argv: [...argv], timeoutMs: options.timeoutMs, captureOutput: options.captureOutput === true });
    const step = this.script.shift() ?? "create";
    if (typeof step === "object") {
      return step.output;
    }
    switch (step) {
      case "create":
        this.sequence += 1;
        this.store.add({
          id: `fake-sandbox-${String(this.sequence)}`,
          labels: labelsBeforeSeparator(argv),
          running: true,
        });
        return { exitCode: 0 };
      case "silent":
        return { exitCode: 0 };
      case "exit-1":
        return { exitCode: 1 };
      case "reject":
        throw new Error("spawn openshell ENOENT");
      case "reject-failed":
        throw new OpenShellRunnerError("failed");
      case "reject-timed-out":
        throw new OpenShellRunnerError("timed-out");
      case "hang":
        return new Promise<OpenShellRunOutcome>(() => undefined);
    }
  }
}

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

// The labels OpenShell 0.1.5 gives the container it creates: its managed marker and its sandbox name, taken
// from --name. OpenShell does not apply the --label values, so they are not read here.
function openShellLabels(argv: readonly string[]): Record<string, string> {
  const nameIndex = argv.indexOf("--name");
  const name = nameIndex === -1 ? undefined : argv[nameIndex + 1];
  const labels: Record<string, string> = { "openshell.managed": "true", "openshell.ai/isolation-role": "sandbox" };
  if (name !== undefined) {
    labels["openshell.ai/sandbox-name"] = name;
  }
  return labels;
}

export class FakeOpenShell {
  readonly runner: OpenShellRunner = (argv, options) => this.run(argv, options);
  private readonly store: FakeContainerStore;
  private readonly log: FakeOpenShellCall[] = [];
  private readonly script: OpenShellStep[] = [];
  private readonly held = new Set<string>();
  private sequence = 0;

  constructor(store: FakeContainerStore) {
    this.store = store;
  }

  // Queues the steps for the next runs, in order. An unscripted run is a create, or a silent exit 0 for a sandbox delete.
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
    // `sandbox list --names` is a read the gateway answers from the names it holds. It is not a run that changes the gateway,
    // so it is neither logged nor given a scripted step.
    if (argv[2] === "list") {
      return { exitCode: 0, stdout: [...this.held].map((name) => `${name}\n`).join(""), stderr: "" };
    }
    this.log.push({ argv: [...argv], timeoutMs: options.timeoutMs, captureOutput: options.captureOutput === true });
    const outcome = await this.answer(argv);
    // A successful delete releases the name at once; a create holds it (see answer).
    if (argv[2] === "delete" && outcome.exitCode === 0 && argv[3] !== undefined) {
      this.held.delete(argv[3]);
    }
    return outcome;
  }

  private async answer(argv: readonly string[]): Promise<OpenShellRunOutcome> {
    const step = this.script.shift() ?? (argv[2] === "delete" ? "silent" : "create");
    if (typeof step === "object") {
      return step.output;
    }
    switch (step) {
      case "create":
        this.sequence += 1;
        this.store.add({
          id: `fake-sandbox-${String(this.sequence)}`,
          labels: openShellLabels(argv),
          running: true,
        });
        this.held.add(openShellLabels(argv)["openshell.ai/sandbox-name"] ?? "");
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

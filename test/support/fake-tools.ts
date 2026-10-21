// In-process harness for the shared tool dispatcher (TOOL-03, TOOL-04). It builds a real workspace on
// disk, a real audit log, a real lock table, and a controller surface backed by the real state machine
// and a real event bus. The OpenShell runner is a settable fake, so nothing starts a process. Each
// observed stage records the audit phases written so far, which lets a test prove the stage order.

import type { TestContext } from "node:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Policy, ToolName } from "../../src/contract/validate.js";
import type { ErrorCode } from "../../src/core/errors.js";
import { createEventBus, type EventBus } from "../../src/core/events.js";
import { RealmStateMachine } from "../../src/core/state-machine.js";
import type { State } from "../../src/core/states.js";
import { LockTable } from "../../src/fs/locks.js";
import { bindRoot, type PinnedRoot } from "../../src/fs/root.js";
import { gateMutation } from "../../src/lifecycle/mutation-gate.js";
import type { OpenShellRunOptions, OpenShellRunOutcome } from "../../src/runtime/openshell.js";
import { type DispatcherController, type ToolOutcome, ToolDispatcher } from "../../src/tools/dispatch.js";

export const SESSION = "sess-dispatch";
export const CLOCK = "2026-10-21T09:30:00.000Z";
export const WORKLOAD: readonly string[] = ["/usr/bin/agent", "--serve"];

export const ADVISORY: Policy = {
  mode: "advisory",
  workspaceRoots: [],
  credentialAllow: [],
  egressAllow: [],
  shellEnabled: false,
  startupBudgetMs: 1000,
  toolQueueMs: 2000,
};
export const REQUIRED: Policy = { ...ADVISORY, mode: "fail-closed" };

export type Runner = (argv: readonly string[], options: OpenShellRunOptions) => Promise<OpenShellRunOutcome>;

export type Stage = "snapshot" | "gate" | "lock" | "runner" | "create";

// One stage the dispatcher reached, with the audit phases already written when it was reached.
export interface Observation {
  readonly stage: Stage;
  readonly phases: readonly string[];
}

export interface RunRecord {
  readonly argv: readonly string[];
  readonly options: OpenShellRunOptions;
}

export interface Harness {
  readonly ws: string;
  readonly stateDir: string;
  readonly root: PinnedRoot;
  readonly locks: LockTable;
  readonly machine: RealmStateMachine;
  readonly dispatcher: ToolDispatcher;
  readonly observations: Observation[];
  readonly creates: string[];
  readonly runs: RunRecord[];
  setRunner(runner: Runner): void;
  // The number of listeners currently subscribed to the controller's event bus.
  listeners(): number;
  // The audit phases of this session's log, in file order.
  phases(): string[];
  auditLines(): Record<string, unknown>[];
  auditText(): string;
  // The content of ws/doc.txt.
  doc(): string;
}

export interface HarnessOptions {
  readonly state?: State;
  readonly policy?: Policy;
  // Chooses the state directory from the temporary base. The default is <base>/state.
  readonly stateDir?: (base: string) => string;
}

// A lock table that reports each probe of isHeldBy. The workspace write probes twice: once before its
// admission line and once inside lockedWrite, after admission.
class ObservedLocks extends LockTable {
  private readonly onProbe: () => void;

  constructor(onProbe: () => void) {
    super();
    this.onProbe = onProbe;
  }

  override isHeldBy(realPath: string, owner: string): boolean {
    this.onProbe();
    return super.isHeldBy(realPath, owner);
  }
}

interface CountingBus {
  readonly events: EventBus;
  listeners(): number;
}

// An event bus that counts live subscriptions, so a test can prove a queue wait removed its listener.
function countingBus(): CountingBus {
  const bus = createEventBus();
  let live = 0;
  const events: EventBus = {
    publish: (event) => {
      bus.publish(event);
    },
    subscribe: (listener) => {
      live += 1;
      const unsubscribe = bus.subscribe(listener);
      let subscribed = true;
      return () => {
        if (!subscribed) {
          return;
        }
        subscribed = false;
        live -= 1;
        unsubscribe();
      };
    },
  };
  return { events, listeners: () => live };
}

// The transitions that reach each state from unbound, in the order the state table allows them.
const PATH_TO: Readonly<Record<State, readonly State[]>> = {
  unbound: [],
  connecting: ["connecting"],
  active: ["connecting", "active"],
  degraded: ["connecting", "active", "degraded"],
  error: ["connecting", "error"],
  stopping: ["connecting", "stopping"],
};

function driveTo(machine: RealmStateMachine, state: State): void {
  for (const next of PATH_TO[state]) {
    machine.transition(next, `driven to ${next}`);
  }
}

function readAuditText(stateDir: string): string {
  const file = join(stateDir, "audit", `${SESSION}.jsonl`);
  return existsSync(file) ? readFileSync(file, "utf8") : "";
}

function auditLinesOf(stateDir: string): Record<string, unknown>[] {
  return readAuditText(stateDir)
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

export function makeHarness(t: TestContext, options: HarnessOptions = {}): Harness {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "realm-dispatch-")));
  t.after(() => {
    rmSync(base, { recursive: true, force: true });
  });
  const ws = join(base, "ws");
  mkdirSync(join(ws, "sub"), { recursive: true });
  writeFileSync(join(ws, "doc.txt"), "original");
  const stateDir = options.stateDir === undefined ? join(base, "state") : options.stateDir(base);
  const policy = options.policy ?? ADVISORY;

  const observations: Observation[] = [];
  const creates: string[] = [];
  const runs: RunRecord[] = [];
  const phases = (): string[] => auditLinesOf(stateDir).map((line) => String(line["phase"]));
  const observe = (stage: Stage): void => {
    observations.push({ stage, phases: phases() });
  };

  const bus = countingBus();
  const machine = new RealmStateMachine(SESSION, bus.events, () => new Date(CLOCK));
  driveTo(machine, options.state ?? "active");

  const controller: DispatcherController = {
    events: bus.events,
    snapshot: () => {
      observe("snapshot");
      return machine.snapshot();
    },
    mutationGate: () => {
      observe("gate");
      return gateMutation(policy, machine.snapshot().state);
    },
    create: (workspaceRoot) => {
      observe("create");
      creates.push(workspaceRoot);
      return Promise.resolve(machine.snapshot());
    },
  };

  const slot: { runner: Runner } = {
    runner: () => Promise.resolve({ exitCode: 0, stdout: "", stderr: "", truncated: false }),
  };
  const locks = new ObservedLocks(() => {
    observe("lock");
  });
  const root = bindRoot(ws);
  const dispatcher = new ToolDispatcher({
    sessionId: SESSION,
    boundRoot: root,
    policy,
    controller,
    locks,
    stateDir,
    runOpenShell: (argv, runOptions) => {
      observe("runner");
      runs.push({ argv, options: runOptions });
      return slot.runner(argv, runOptions);
    },
  });

  return {
    ws,
    stateDir,
    root,
    locks,
    machine,
    dispatcher,
    observations,
    creates,
    runs,
    setRunner: (runner) => {
      slot.runner = runner;
    },
    listeners: bus.listeners,
    phases,
    auditLines: () => auditLinesOf(stateDir),
    auditText: () => readAuditText(stateDir),
    doc: () => readFileSync(join(ws, "doc.txt"), "utf8"),
  };
}

// The exact refusal a call returns. The retryable flag is the catalogue value for the code.
export function refusal(tool: ToolName | null, code: ErrorCode, retryable: boolean): ToolOutcome {
  return { outcome: "refused", tool, code, retryable };
}

// Resolves after the current macrotask, so promise continuations that wait on a settled timer run.
export function nextTurn(): Promise<void> {
  return new Promise<void>((resolve) => {
    setImmediate(() => {
      resolve();
    });
  });
}

// Shared tool dispatcher (TOOL-03, TOOL-04; D-88 to D-98). It is the only entry point for the six
// tools. Every call runs these stages in this order, and a refusal at any stage returns a structured
// result and runs no later stage and no execution (D-89):
//   1. schema: validate("tools", raw). The shell form then runs checkExecPolicy, so SHELL_NOT_ALLOWED
//      precedes the state check. The argv is built here too, so a malformed argv is refused before any
//      admission line is written.
//   2. state: exec runs only while active, in both modes (D-109). A write asks the mutation gate
//      (D-63). read, list, status, and retry are not gated. A call in connecting waits at most
//      policy.toolQueueMs for the state to leave connecting (D-91).
//   3. lock: a write canonicalizes its target, runs the credential check, and probes the path lock.
//      The workspace handlers run this stage (src/tools/workspace.ts, D-34), so it is not repeated
//      here. The other tools have no target.
//   4. admission: one audit line with phase "admission", written before execution (S-21).
//   5. execution: the file handlers, or the OpenShell runner under TOOL_CALL_TIMEOUT_MS (D-91).
//   6. result: one audit line with phase "result" (OQ-P4-07).
// The file tools write their own audit lines, so the dispatcher writes them only for exec, status,
// and retry. The dispatcher reads no process.env. It uses the controller's lock table (D-96), and it
// subscribes to the controller's event bus for one queue wait and removes that subscription when the
// wait settles (D-105).

import { appendAudit, summarizeExec, type AuditEntryInput, type ExecSummary } from "../audit/log.js";
import {
  validate,
  type ExecParams,
  type Policy,
  type ToolCall,
  type ToolName,
  type WriteParams,
} from "../contract/validate.js";
import { ERROR_CATALOGUE, makeRealmError, RealmError, type ErrorCode } from "../core/errors.js";
import type { EventBus } from "../core/events.js";
import { checkExecPolicy } from "../core/policy.js";
import type { StateSnapshot } from "../core/state-machine.js";
import { displayStatus, type DisplayStatus } from "../core/status.js";
import type { State } from "../core/states.js";
import { withTimeout } from "../core/timeout.js";
import type { ListResult } from "../fs/list.js";
import type { LockTable } from "../fs/locks.js";
import type { ReadResult } from "../fs/read.js";
import type { PinnedRoot } from "../fs/root.js";
import type { LifecycleController } from "../lifecycle/controller.js";
import { buildExecArgv, type OpenShellRunner, type OpenShellRunOutcome } from "../runtime/openshell.js";
import { runSandboxExec } from "../runtime/session-execution.js";
import {
  listWorkspaceDir,
  readWorkspaceFile,
  writeWorkspaceFile,
  type WorkspaceDeps,
  type WriteOutcome,
} from "./workspace.js";

// The controller members the dispatcher reads. Pick keeps the dispatcher off the controller's private
// state, so it can be composed with any object that offers these members.
export type DispatcherController = Pick<LifecycleController, "events" | "snapshot" | "mutationGate" | "create">;

// The bound on one call's awaited work (D-91). It is a constant, not a policy key (D-101).
export const TOOL_CALL_TIMEOUT_MS = 30_000;

// The runner must kill its child before the dispatcher outer bound settles, so the outer bound is only a backstop.
const EXEC_RUNNER_MARGIN_MS = 2_000;

export interface ToolDispatcherDeps {
  readonly sessionId: string;
  readonly boundRoot: PinnedRoot;
  readonly policy: Policy;
  readonly controller: DispatcherController;
  // The lock table the controller holds (D-96). The same instance must be passed to both.
  readonly locks: LockTable;
  readonly stateDir: string;
  readonly runOpenShell: OpenShellRunner;
}

export interface StatusValue {
  readonly snapshot: StateSnapshot;
  readonly display: DisplayStatus;
}

// A refusal carries its catalogue code and retryable flag. tool is null when the schema stage refused
// a call whose tool name could not be read.
export type ToolOutcome =
  | { readonly outcome: "done"; readonly tool: "exec"; readonly value: OpenShellRunOutcome }
  | { readonly outcome: "done"; readonly tool: "read"; readonly value: ReadResult }
  | { readonly outcome: "done"; readonly tool: "write"; readonly value: WriteOutcome }
  | { readonly outcome: "done"; readonly tool: "list"; readonly value: ListResult }
  | { readonly outcome: "done"; readonly tool: "status"; readonly value: StatusValue }
  | { readonly outcome: "done"; readonly tool: "retry"; readonly value: StateSnapshot }
  | {
      readonly outcome: "refused";
      readonly tool: ToolName | null;
      readonly code: ErrorCode;
      readonly retryable: boolean;
    };

export class ToolDispatcher {
  private readonly deps: ToolDispatcherDeps;
  private readonly workspace: WorkspaceDeps;

  constructor(deps: ToolDispatcherDeps) {
    this.deps = deps;
    this.workspace = {
      sessionId: deps.sessionId,
      boundRoot: deps.boundRoot,
      locks: deps.locks,
      credentialAllow: deps.policy.credentialAllow,
      audit: (entry) => {
        appendAudit(deps.stateDir, entry);
      },
      mutationGate: () => deps.controller.mutationGate(),
    };
  }

  // The only entry point for tool calls (D-88). A refusal is returned, never thrown. Only a defect
  // that is not a RealmError escapes.
  async call(raw: unknown): Promise<ToolOutcome> {
    const parsed = validate("tools", raw);
    if (!parsed.ok) {
      return refused(null, parsed.error.code);
    }
    const tool = Object.keys(parsed.value)[0] as ToolName;
    try {
      return await this.#run(parsed.value);
    } catch (error: unknown) {
      if (error instanceof RealmError) {
        return refused(tool, error.code);
      }
      throw error;
    }
  }

  // Dispatches by tool key. Every ToolCall member has a branch; a value that matches none is refused (TOOL-03).
  async #run(call: ToolCall): Promise<ToolOutcome> {
    if ("exec" in call) {
      return this.#exec(call.exec);
    }
    if ("read" in call) {
      return { outcome: "done", tool: "read", value: readWorkspaceFile(this.workspace, call.read) };
    }
    if ("write" in call) {
      return this.#write(call.write);
    }
    if ("list" in call) {
      return { outcome: "done", tool: "list", value: listWorkspaceDir(this.workspace, call.list) };
    }
    if ("status" in call) {
      return this.#status();
    }
    if ("retry" in call) {
      return this.#retry();
    }
    return refused(null, "SCHEMA_INVALID");
  }

  // A write in connecting waits for the state to leave it (D-91). The workspace handler then runs the
  // mutation gate, so an advisory write in a non-active state proceeds with its warning and a
  // required-mode write is refused with the deny code.
  async #write(params: WriteParams): Promise<ToolOutcome> {
    if (this.deps.controller.snapshot().state === "connecting") {
      await waitLeavingConnecting(this.deps.controller.events, this.deps.policy.toolQueueMs);
    }
    return { outcome: "done", tool: "write", value: writeWorkspaceFile(this.workspace, params) };
  }

  // exec runs only while active, in both modes (D-89, D-109). The argv form and the shell form both
  // reach the runner through buildExecArgv and runSandboxExec. The dispatcher also bounds the call with
  // TOOL_CALL_TIMEOUT_MS, so a runner that ignores its own deadline still returns TOOL_TIMEOUT.
  async #exec(params: ExecParams): Promise<ToolOutcome> {
    checkExecPolicy(this.deps.policy, params);
    const workload: readonly string[] = "argv" in params ? params.argv : ["/bin/sh", "-c", params.script];
    // Refuses a malformed argv before admission. runSandboxExec builds the same argv again.
    buildExecArgv(this.deps.sessionId, workload);
    let state = this.deps.controller.snapshot().state;
    if (state === "connecting") {
      await waitLeavingConnecting(this.deps.controller.events, this.deps.policy.toolQueueMs);
      state = this.deps.controller.snapshot().state;
    }
    if (state !== "active") {
      throw makeRealmError(execRefusalCode(state));
    }
    const value = await this.#audited("exec", summarizeExec(params), () =>
      withTimeout(
        runSandboxExec(
          this.deps.runOpenShell,
          this.deps.sessionId,
          workload,
          TOOL_CALL_TIMEOUT_MS - EXEC_RUNNER_MARGIN_MS,
        ),
        TOOL_CALL_TIMEOUT_MS,
        "TOOL_TIMEOUT",
      ),
    );
    return { outcome: "done", tool: "exec", value };
  }

  // status is not gated. It returns the controller snapshot with its display mapping (D-27).
  async #status(): Promise<ToolOutcome> {
    const value = await this.#audited("status", null, async () => {
      const snapshot = this.deps.controller.snapshot();
      return { snapshot, display: displayStatus(snapshot) };
    });
    return { outcome: "done", tool: "status", value };
  }

  // retry follows the state (D-95, C-1, D-110). Only error runs create, bound to the workspace path.
  // unbound and stopping are refused before admission, so the call is not run and not audited. The
  // admission append is I/O, so the state is read again inside the admitted window and the decision
  // uses that read (M-01).
  async #retry(): Promise<ToolOutcome> {
    refuseRetryIn(this.deps.controller.snapshot().state);
    const value = await this.#audited("retry", null, async () => {
      const current = this.deps.controller.snapshot();
      refuseRetryIn(current.state);
      if (current.state !== "error") {
        return current;
      }
      return withTimeout(
        this.deps.controller.create(this.deps.boundRoot.realPath),
        TOOL_CALL_TIMEOUT_MS,
        "TOOL_TIMEOUT",
      );
    });
    return { outcome: "done", tool: "retry", value };
  }

  // Runs one call between its admission and result lines (D-89 stages 4 to 6) for the tools the
  // dispatcher audits itself. An admission line that cannot be written throws AUDIT_WRITE_FAILED and
  // nothing executes. A refusal from execution is recorded with its code and rethrown. A result line
  // that cannot be written throws AUDIT_WRITE_FAILED, and the effect is not rolled back (OQ-P4-07).
  async #audited<T>(
    tool: "exec" | "status" | "retry",
    execSummary: ExecSummary | null,
    execute: () => Promise<T>,
  ): Promise<T> {
    const base: AuditEntryInput = {
      sessionId: this.deps.sessionId,
      tool,
      outcome: "ok",
      ...(execSummary === null ? {} : { execSummary }),
    };
    appendAudit(this.deps.stateDir, { ...base, phase: "admission" });
    let value: T;
    try {
      value = await execute();
    } catch (error: unknown) {
      if (error instanceof RealmError) {
        appendAudit(this.deps.stateDir, { ...base, outcome: error.code, phase: "result" });
      }
      throw error;
    }
    appendAudit(this.deps.stateDir, { ...base, phase: "result" });
    return value;
  }
}

function refused(tool: ToolName | null, code: ErrorCode): ToolOutcome {
  return { outcome: "refused", tool, code, retryable: ERROR_CATALOGUE[code].retryable };
}

// retry is refused in unbound and stopping (D-95). It runs before admission and again at the decision point.
function refuseRetryIn(state: State): void {
  if (state === "unbound") {
    throw makeRealmError("REALM_UNBOUND");
  }
  if (state === "stopping") {
    throw makeRealmError("REALM_STOPPING");
  }
}

// The refusal an exec receives outside active (D-89, D-91). Only connecting waits, so the other
// non-active states return at once.
function execRefusalCode(state: Exclude<State, "active">): ErrorCode {
  switch (state) {
    case "unbound":
      return "REALM_UNBOUND";
    case "stopping":
      return "REALM_STOPPING";
    case "connecting":
    case "degraded":
    case "error":
      return "REALM_NOT_ACTIVE";
  }
}

// Resolves when the state leaves connecting, or when toolQueueMs has passed, whichever comes first
// (D-91). Either outcome clears the timer and removes the listener (C-2, D-105).
function waitLeavingConnecting(events: EventBus, toolQueueMs: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(finish, toolQueueMs);
    const unsubscribe = events.subscribe((event) => {
      if (event.from === "connecting") {
        finish();
      }
    });
    function finish(): void {
      clearTimeout(timer);
      unsubscribe();
      resolve();
    }
  });
}

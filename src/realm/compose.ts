// Composition root (P5-D7, P5-D15). One module wires the runtime input plus the
// real adapters into a LifecycleController and a ToolDispatcher, exposing a
// RealmHandle with the controller, the dispatcher, and close(). It holds no
// tool logic: every tool call flows through the dispatcher (P5-D11). The
// controller and the dispatcher share one LockTable instance (P5-D15, D-96),
// so no second table can split lock ownership.

import type { Policy, PolicyMode } from "../contract/validate.js";
import { loadPolicyFile } from "../core/policy.js";
import type { BridgePort, ExecutionService } from "../core/ports.js";
import type { StateSnapshot } from "../core/state-machine.js";
import { LockTable } from "../fs/locks.js";
import { bindWorkspaceUnderPolicy } from "../fs/root.js";
import { LifecycleController } from "../lifecycle/controller.js";
import { loadRuntimeConfig } from "../runtime/config.js";
import type { OpenShellRunner } from "../runtime/openshell.js";
import { SessionStore } from "../session/store.js";
import { ToolDispatcher } from "../tools/dispatch.js";

export interface RealmHandle {
  readonly controller: LifecycleController;
  readonly dispatcher: ToolDispatcher;
  // The policy's mode, read by surfaces that must not load the policy themselves.
  readonly policyMode: PolicyMode;
  close(): Promise<StateSnapshot>;
}

export interface CreateRealmHandleOptions {
  // Untrusted runtime input, validated by loadRuntimeConfig (closed keys,
  // absolute paths). No process environment is read here; the caller supplies
  // every adapter.
  readonly runtimeInput: unknown;
  readonly policyPath: string;
  // Optional pre-loaded policy. The plugin loads it once for the startup budget and
  // passes the same value here; when present, policyPath is not read.
  readonly policy?: Policy;
  readonly sessionId: string;
  readonly exec: ExecutionService;
  readonly bridge: BridgePort;
  readonly clock: () => Date;
  readonly runOpenShell: OpenShellRunner;
}

// Builds the controller and the dispatcher from the runtime input with one
// shared lock table.
//
// Single-owner precondition: no LifecycleController or ToolDispatcher exists
// yet in this process for the configured state directory; one host daemon owns
// the state directory. Cross-process enforcement belongs to Phase 6 (OQ-P4-06,
// RT-06): this factory performs no locking across processes.
//
// close() delegates to the controller stop path and is safe to call twice:
// stopping an unbound session is a no-op that starts no process.
//
// The workspace must lie inside a policy root. The check runs here, at construction, so
// the dispatcher never receives a root the policy excludes (D-22); otherwise POLICY_DENIED.
export function createRealmHandle(options: CreateRealmHandleOptions): RealmHandle {
  const config = loadRuntimeConfig(options.runtimeInput);
  const policy = options.policy ?? loadPolicyFile(options.policyPath);
  const boundRoot = bindWorkspaceUnderPolicy(policy.workspaceRoots, config.workspaceRoot);
  const locks = new LockTable();
  const store = new SessionStore(config.stateDir);
  const controller = new LifecycleController({
    sessionId: options.sessionId,
    policy,
    store,
    exec: options.exec,
    bridge: options.bridge,
    clock: options.clock,
    locks,
    // Pinned at bind time. create refuses any requested workspace whose identity differs from
    // the pinned root, with POLICY_DENIED, before any state change.
    pinnedRoot: boundRoot,
  });
  const dispatcher = new ToolDispatcher({
    sessionId: options.sessionId,
    boundRoot,
    policy,
    controller,
    locks,
    stateDir: config.stateDir,
    runOpenShell: options.runOpenShell,
  });
  return {
    controller,
    dispatcher,
    policyMode: policy.mode,
    close: () => controller.stop(),
  };
}

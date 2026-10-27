// Synchronous mutation gate (CORE-05, D-63). A file-mutating call is decided in the same
// tick it arrives: proceed, proceed with a named warning, or refused with the deny code.
// The gate wraps decideMutation (D-23) and adds no decision logic of its own. It never
// waits, so a non-active call cannot hang; the bounded queue wait is TOOL-04 in Phase 4.
// It writes no audit entry; the Phase 4 dispatcher owns the audit trail.
//
// Layering (D-50): this module imports only the contract and core layers, never runtime or
// anda.

import type { Policy } from "../contract/validate.js";
import { decideMutation, type MutationDenyCode } from "../core/policy.js";
import type { State } from "../core/states.js";

export type GateOutcome =
  | { readonly outcome: "proceed" }
  | { readonly outcome: "proceed-with-warning"; readonly warning: string }
  | { readonly outcome: "refused"; readonly code: MutationDenyCode };

export type GatedResult<T> =
  | { readonly outcome: "done"; readonly value: T; readonly warning: string | null }
  | { readonly outcome: "refused"; readonly code: MutationDenyCode };

export function gateMutation(policy: Policy, state: State, bridgeAttached: boolean): GateOutcome {
  const decision = decideMutation(policy, state, bridgeAttached);
  switch (decision.decision) {
    case "allow":
      return { outcome: "proceed" };
    case "allow-with-warning":
      return { outcome: "proceed-with-warning", warning: decision.warning };
    case "deny":
      return { outcome: "refused", code: decision.code };
  }
}

// Runs fn only when the gate lets the call proceed. The mutation is synchronous: fn returns
// a value, never a Promise, so the result is available in the same tick.
export function runGatedMutation<T>(gate: GateOutcome, fn: () => T): GatedResult<T> {
  if (gate.outcome === "refused") {
    return { outcome: "refused", code: gate.code };
  }
  const value = fn();
  return {
    outcome: "done",
    value,
    warning: gate.outcome === "proceed-with-warning" ? gate.warning : null,
  };
}

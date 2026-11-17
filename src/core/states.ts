// Frozen five-state transition table (D-11, spec n6, less degraded: removed in Phase 28). Pure data and pure checks
// only: no state-machine behavior, events, or display mapping (Phase 2).
// Self-transitions are absent from the table, so they are rejected.

import { makeRealmError, type RealmError } from "./errors.js";

// Every lifecycle state, in the order the transition table names them.
export const STATES = Object.freeze([
  "unbound",
  "connecting",
  "active",
  "error",
  "stopping",
] as const);

// One lifecycle state, a member of STATES.
export type State = (typeof STATES)[number];

// One allowed transition, as a from and to pair.
export type Edge = readonly [from: State, to: State];

// Object.freeze is shallow. Each edge is frozen as well as the outer array, the
// same way ERROR_CATALOGUE freezes its entries in src/core/errors.ts.
function freezeEdges(edges: Edge[]): readonly Edge[] {
  for (const edge of edges) {
    Object.freeze(edge);
  }
  return Object.freeze(edges);
}

// The allowed-edge table. Exactly the 9 edges (the 13 edges of D-11, less the four that named degraded,
// removed by the owner decision of 2026-11-17, Phase 28).
export const ALLOWED_TRANSITIONS: readonly Edge[] = freezeEdges([
  ["unbound", "connecting"],
  ["connecting", "active"],
  ["connecting", "error"],
  ["connecting", "stopping"],
  ["active", "error"],
  ["active", "stopping"],
  ["error", "connecting"],
  ["error", "stopping"],
  ["stopping", "unbound"],
]);

// True when the frozen transition table allows the move from one state to the other.
export function isTransitionAllowed(from: State, to: State): boolean {
  return ALLOWED_TRANSITIONS.some(([f, t]) => f === from && t === to);
}

// Returns null when the transition is allowed; otherwise a REALM_INVALID_TRANSITION error.
export function checkTransition(from: State, to: State): RealmError | null {
  return isTransitionAllowed(from, to)
    ? null
    : makeRealmError("REALM_INVALID_TRANSITION");
}

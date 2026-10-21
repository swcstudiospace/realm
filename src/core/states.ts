// Frozen six-state transition table (D-11, spec n6). Pure data and pure checks
// only: no state-machine behavior, events, or display mapping (Phase 2).
// Self-transitions are absent from the table, so they are rejected.

import { makeRealmError, type RealmError } from "./errors.js";

export const STATES = Object.freeze([
  "unbound",
  "connecting",
  "active",
  "degraded",
  "error",
  "stopping",
] as const);

export type State = (typeof STATES)[number];

export type Edge = readonly [from: State, to: State];

// Object.freeze is shallow. Each edge is frozen as well as the outer array, the
// same way ERROR_CATALOGUE freezes its entries in src/core/errors.ts.
function freezeEdges(edges: Edge[]): readonly Edge[] {
  for (const edge of edges) {
    Object.freeze(edge);
  }
  return Object.freeze(edges);
}

// The allowed-edge table. Exactly the 13 edges of D-11 / spec n6.
export const ALLOWED_TRANSITIONS: readonly Edge[] = freezeEdges([
  ["unbound", "connecting"],
  ["connecting", "active"],
  ["connecting", "error"],
  ["connecting", "stopping"],
  ["active", "degraded"],
  ["active", "error"],
  ["active", "stopping"],
  ["degraded", "active"],
  ["degraded", "error"],
  ["degraded", "stopping"],
  ["error", "connecting"],
  ["error", "stopping"],
  ["stopping", "unbound"],
]);

export function isTransitionAllowed(from: State, to: State): boolean {
  return ALLOWED_TRANSITIONS.some(([f, t]) => f === from && t === to);
}

// Returns null when the transition is allowed; otherwise a REALM_INVALID_TRANSITION error.
export function checkTransition(from: State, to: State): RealmError | null {
  return isTransitionAllowed(from, to)
    ? null
    : makeRealmError("REALM_INVALID_TRANSITION");
}

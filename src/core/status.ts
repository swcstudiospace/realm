// Display mapping (CORE-02, D-27). This file is the only place the two user-visible
// status labels are defined. The CLI, the plugin, and the tests import displayStatus.
// Changing a label or a row is a costly change: every host imports this mapping.

import type { State } from "./states.js";

export const STATUS_LABELS = Object.freeze({
  active: "realm active",
  disconnected: "realm disconnected",
} as const);

export type StatusLabel = (typeof STATUS_LABELS)[keyof typeof STATUS_LABELS];

// The lifecycle snapshot the mapping reads: current state, its reason, and the
// ISO 8601 UTC time of the last committed transition.
export interface StatusSnapshot {
  readonly state: State;
  readonly reason: string;
  readonly lastTransitionAt: string;
}

export interface DisplayStatus {
  readonly label: StatusLabel;
  readonly degraded: boolean;
  readonly reason: string;
  readonly lastTransitionAt: string;
}

// Reasons fixed by D-27 for the three states whose reason text the mapping owns.
// For active, degraded, and error the snapshot reason passes through; for error it
// is the catalogue code the lifecycle recorded.
const FIXED_REASON = Object.freeze({
  unbound: "no workspace",
  connecting: "connecting",
  stopping: "stopping",
} as const);

export function displayStatus(snapshot: StatusSnapshot): DisplayStatus {
  const { state, reason, lastTransitionAt } = snapshot;
  switch (state) {
    case "active":
      return display(STATUS_LABELS.active, false, reason, lastTransitionAt);
    case "degraded":
      // Degraded is the active label with a flag, not a third label (CORE-02).
      return display(STATUS_LABELS.active, true, reason, lastTransitionAt);
    case "unbound":
      return display(STATUS_LABELS.disconnected, false, FIXED_REASON.unbound, lastTransitionAt);
    case "connecting":
      return display(STATUS_LABELS.disconnected, false, FIXED_REASON.connecting, lastTransitionAt);
    case "stopping":
      return display(STATUS_LABELS.disconnected, false, FIXED_REASON.stopping, lastTransitionAt);
    case "error":
      return display(STATUS_LABELS.disconnected, false, reason, lastTransitionAt);
  }
}

function display(
  label: StatusLabel,
  degraded: boolean,
  reason: string,
  lastTransitionAt: string,
): DisplayStatus {
  return { label, degraded, reason, lastTransitionAt };
}

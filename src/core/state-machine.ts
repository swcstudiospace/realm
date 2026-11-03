// RealmStateMachine (D-25, CORE-01). Wraps the frozen checkTransition and never
// redefines the table. A disallowed transition throws before anything changes. An
// allowed transition commits the state first and publishes exactly one event after.

import type { EventBus } from "./events.js";
import { checkTransition, type State } from "./states.js";

// The reason recorded for the unbound state before any workspace is bound.
export const INITIAL_REASON = "no workspace";

// The current state, the reason it was entered, and when that transition was committed.
export interface StateSnapshot {
  readonly state: State;
  readonly reason: string;
  readonly lastTransitionAt: string;
}

// The session's lifecycle state machine. It commits each allowed transition, then publishes one event for it.
export class RealmStateMachine {
  private readonly sessionId: string;
  private readonly bus: EventBus;
  private readonly clock: () => Date;
  private state: State = "unbound";
  private reason = INITIAL_REASON;
  private lastTransitionAt: string;

  constructor(sessionId: string, bus: EventBus, clock: () => Date = () => new Date()) {
    this.sessionId = sessionId;
    this.bus = bus;
    this.clock = clock;
    this.lastTransitionAt = clock().toISOString();
  }

  snapshot(): StateSnapshot {
    return {
      state: this.state,
      reason: this.reason,
      lastTransitionAt: this.lastTransitionAt,
    };
  }

  // Throws the REALM_INVALID_TRANSITION error for a disallowed edge, including every
  // self-transition, and leaves state, reason, time, and events unchanged.
  transition(to: State, reason: string): StateSnapshot {
    const error = checkTransition(this.state, to);
    if (error !== null) {
      throw error;
    }
    const from = this.state;
    const at = this.clock().toISOString();
    this.state = to;
    this.reason = reason;
    this.lastTransitionAt = at;
    this.bus.publish({ type: "state.transition", sessionId: this.sessionId, from, to, reason, at });
    return this.snapshot();
  }
}

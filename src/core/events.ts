// Typed event bus (D-26, CORE-04). Delivery is synchronous and in subscription
// order. A listener that throws does not stop delivery to the remaining listeners;
// after all of them have run, the first listener error is rethrown to the publisher.
// Nothing is swallowed.

import type { State } from "./states.js";

export interface StateTransitionEvent {
  readonly type: "state.transition";
  readonly sessionId: string;
  readonly from: State;
  readonly to: State;
  readonly reason: string;
  readonly at: string;
}

export type RealmEvent = StateTransitionEvent;

export type RealmListener = (event: RealmEvent) => void;

export interface EventBus {
  subscribe(listener: RealmListener): void;
  publish(event: RealmEvent): void;
}

export function createEventBus(): EventBus {
  const listeners: RealmListener[] = [];
  return {
    subscribe(listener) {
      listeners.push(listener);
    },
    publish(event) {
      let failure: { readonly error: unknown } | undefined;
      // Iterate over a copy so a listener subscribed during delivery does not
      // receive the event that is already in flight.
      for (const listener of [...listeners]) {
        try {
          listener(event);
        } catch (error: unknown) {
          failure ??= { error };
        }
      }
      if (failure !== undefined) {
        throw failure.error;
      }
    },
  };
}

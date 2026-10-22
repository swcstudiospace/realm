import { test } from "node:test";
import assert from "node:assert/strict";
import { createEventBus, type RealmEvent } from "../../src/core/events.js";
import { RealmStateMachine } from "../../src/core/state-machine.js";

const FIXED_TIME = "2026-10-21T09:30:00.000Z";

void test("every committed transition publishes exactly one state.transition event with sessionId, from, to, reason, and at (CORE-04)", () => {
  const bus = createEventBus();
  const received: RealmEvent[] = [];
  bus.subscribe((event) => {
    received.push(event);
  });
  const machine = new RealmStateMachine("session-1", bus, () => new Date(FIXED_TIME));

  machine.transition("connecting", "creating container");
  machine.transition("active", "container running");

  assert.deepEqual(received, [
    {
      type: "state.transition",
      sessionId: "session-1",
      from: "unbound",
      to: "connecting",
      reason: "creating container",
      at: FIXED_TIME,
    },
    {
      type: "state.transition",
      sessionId: "session-1",
      from: "connecting",
      to: "active",
      reason: "container running",
      at: FIXED_TIME,
    },
  ]);
});

void test("listeners run synchronously in subscription order (CORE-04, D-26)", () => {
  const bus = createEventBus();
  const order: string[] = [];
  bus.subscribe(() => {
    order.push("first");
  });
  bus.subscribe(() => {
    order.push("second");
  });
  bus.subscribe(() => {
    order.push("third");
  });

  bus.publish({
    type: "state.transition",
    sessionId: "session-1",
    from: "unbound",
    to: "connecting",
    reason: "creating container",
    at: FIXED_TIME,
  });

  assert.deepEqual(order, ["first", "second", "third"]);
});

void test("a throwing listener does not stop later listeners, and its error is rethrown after all have run (CORE-04, D-26)", () => {
  const bus = createEventBus();
  const boom = new Error("listener failed");
  const delivered: string[] = [];
  bus.subscribe(() => {
    delivered.push("before");
  });
  bus.subscribe(() => {
    throw boom;
  });
  bus.subscribe(() => {
    delivered.push("after");
  });

  assert.throws(
    () => {
      bus.publish({
        type: "state.transition",
        sessionId: "session-1",
        from: "unbound",
        to: "connecting",
        reason: "creating container",
        at: FIXED_TIME,
      });
    },
    (error: unknown) => error === boom,
  );
  assert.deepEqual(delivered, ["before", "after"]);
});

void test("when several listeners throw, the first listener error is the one rethrown (D-26)", () => {
  const bus = createEventBus();
  const first = new Error("first listener failed");
  bus.subscribe(() => {
    throw first;
  });
  bus.subscribe(() => {
    throw new Error("second listener failed");
  });

  assert.throws(
    () => {
      bus.publish({
        type: "state.transition",
        sessionId: "session-1",
        from: "unbound",
        to: "connecting",
        reason: "creating container",
        at: FIXED_TIME,
      });
    },
    (error: unknown) => error === first,
  );
});

void test("a transition whose listener throws stays committed, because the state changes before publication (CORE-04, D-25)", () => {
  const bus = createEventBus();
  bus.subscribe(() => {
    throw new Error("listener failed");
  });
  const machine = new RealmStateMachine("session-1", bus, () => new Date(FIXED_TIME));

  assert.throws(() => machine.transition("connecting", "creating container"), /listener failed/);
  assert.deepEqual(machine.snapshot(), {
    state: "connecting",
    reason: "creating container",
    lastTransitionAt: FIXED_TIME,
  });
});

void test("a listener subscribed during delivery does not receive the event already in flight (D-26)", () => {
  const bus = createEventBus();
  const late: RealmEvent[] = [];
  bus.subscribe(() => {
    bus.subscribe((event) => {
      late.push(event);
    });
  });

  bus.publish({
    type: "state.transition",
    sessionId: "session-1",
    from: "unbound",
    to: "connecting",
    reason: "creating container",
    at: FIXED_TIME,
  });

  assert.deepEqual(late, []);
});

void test("C-2: the function subscribe returns removes its listener, so later publications skip it (D-105)", () => {
  const bus = createEventBus();
  const received: string[] = [];
  const unsubscribe = bus.subscribe(() => {
    received.push("first");
  });
  bus.subscribe(() => {
    received.push("second");
  });

  unsubscribe();
  bus.publish({
    type: "state.transition",
    sessionId: "session-1",
    from: "unbound",
    to: "connecting",
    reason: "creating container",
    at: FIXED_TIME,
  });

  assert.deepEqual(received, ["second"]);
});

void test("C-2: calling an unsubscribe twice removes nothing more, even when the same listener is subscribed twice (D-105)", () => {
  const bus = createEventBus();
  let calls = 0;
  const listener = (): void => {
    calls += 1;
  };
  const first = bus.subscribe(listener);
  bus.subscribe(listener);

  first();
  first();
  bus.publish({
    type: "state.transition",
    sessionId: "session-1",
    from: "unbound",
    to: "connecting",
    reason: "creating container",
    at: FIXED_TIME,
  });

  assert.equal(calls, 1, "the second registration of the same listener stays");
});

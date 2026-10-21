import { test } from "node:test";
import assert from "node:assert/strict";
import { RealmError } from "../../src/core/errors.js";
import { createEventBus, type RealmEvent } from "../../src/core/events.js";
import { RealmStateMachine, type StateSnapshot } from "../../src/core/state-machine.js";
import type { State } from "../../src/core/states.js";

const FIXED_TIME = "2026-10-21T09:30:00.000Z";

// The six D-11 states and the 13 D-11 edges, pinned as literals so the test does not
// read the table under test.
const ALL_STATES: readonly State[] = ["unbound", "connecting", "active", "degraded", "error", "stopping"];

const EXPECTED_ALLOWED: readonly (readonly [State, State])[] = [
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
];

const ALLOWED_KEYS = new Set(EXPECTED_ALLOWED.map(([from, to]) => `${from}>${to}`));

// A fixed path from unbound to each state, built only from the allowed edges.
const PATH_TO: Readonly<Record<State, readonly State[]>> = {
  unbound: [],
  connecting: ["connecting"],
  active: ["connecting", "active"],
  degraded: ["connecting", "active", "degraded"],
  error: ["connecting", "error"],
  stopping: ["connecting", "stopping"],
};

// A machine positioned at `state`, with its own bus and a fixed clock. The events
// recorded while positioning are discarded.
function positioned(state: State): { machine: RealmStateMachine; events: RealmEvent[] } {
  const bus = createEventBus();
  const events: RealmEvent[] = [];
  bus.subscribe((event) => {
    events.push(event);
  });
  const machine = new RealmStateMachine("session-1", bus, () => new Date(FIXED_TIME));
  for (const step of PATH_TO[state]) {
    machine.transition(step, `to ${step}`);
  }
  events.length = 0;
  return { machine, events };
}

test("the 36 ordered pairs split into the 13 D-11 edges and 23 rejected pairs (CORE-01)", () => {
  let allowed = 0;
  let rejected = 0;
  for (const from of ALL_STATES) {
    for (const to of ALL_STATES) {
      if (ALLOWED_KEYS.has(`${from}>${to}`)) {
        allowed += 1;
      } else {
        rejected += 1;
      }
    }
  }
  assert.equal(allowed, 13);
  assert.equal(rejected, 23);
});

test("every one of the 13 allowed edges commits and publishes its transition (CORE-01)", () => {
  for (const [from, to] of EXPECTED_ALLOWED) {
    const { machine, events } = positioned(from);
    const snapshot = machine.transition(to, "allowed edge");
    assert.equal(snapshot.state, to, `${from} to ${to} should commit`);
    assert.equal(events.length, 1, `${from} to ${to} should publish once`);
  }
});

test("every disallowed pair, including all six self-transitions, throws REALM_INVALID_TRANSITION with nothing changed (CORE-01)", () => {
  for (const from of ALL_STATES) {
    for (const to of ALL_STATES) {
      if (ALLOWED_KEYS.has(`${from}>${to}`)) {
        continue;
      }
      const { machine, events } = positioned(from);
      const before: StateSnapshot = machine.snapshot();
      assert.throws(
        () => machine.transition(to, "rejected edge"),
        (error: unknown) => error instanceof RealmError && error.code === "REALM_INVALID_TRANSITION",
        `${from} to ${to} should be rejected`,
      );
      assert.deepEqual(machine.snapshot(), before, `${from} to ${to} must leave state, reason, and time unchanged`);
      assert.equal(events.length, 0, `${from} to ${to} must publish nothing`);
    }
  }
});

test("a machine starts in unbound with reason no workspace and an ISO 8601 UTC start time (CORE-01)", () => {
  const machine = new RealmStateMachine("session-1", createEventBus(), () => new Date(FIXED_TIME));
  assert.deepEqual(machine.snapshot(), {
    state: "unbound",
    reason: "no workspace",
    lastTransitionAt: FIXED_TIME,
  });
});

test("a committed transition records its reason and an ISO 8601 UTC time (CORE-01)", () => {
  const machine = new RealmStateMachine("session-1", createEventBus(), () => new Date(FIXED_TIME));
  const snapshot = machine.transition("connecting", "creating container");
  assert.deepEqual(snapshot, {
    state: "connecting",
    reason: "creating container",
    lastTransitionAt: FIXED_TIME,
  });
  assert.match(snapshot.lastTransitionAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ALLOWED_TRANSITIONS,
  STATES,
  checkTransition,
  isTransitionAllowed,
  type State,
} from "../../src/core/states.js";
import { RealmError } from "../../src/core/errors.js";

// The D-11 edges, pinned here as literals so the test does not read the table under test.
const EXPECTED_ALLOWED: Readonly<Record<string, true>> = {
  "unbound>connecting": true,
  "connecting>active": true,
  "connecting>error": true,
  "connecting>stopping": true,
  "active>degraded": true,
  "active>error": true,
  "active>stopping": true,
  "degraded>active": true,
  "degraded>error": true,
  "degraded>stopping": true,
  "error>connecting": true,
  "error>stopping": true,
  "stopping>unbound": true,
};

const EXPECTED_KEYS = Object.keys(EXPECTED_ALLOWED);

const key = (from: State, to: State): string => `${from}>${to}`;

test("the state set is exactly the six D-11 states", () => {
  assert.deepEqual(
    [...STATES],
    ["unbound", "connecting", "active", "degraded", "error", "stopping"],
  );
});

test("the matrix covers 36 ordered pairs: 13 allowed and 23 rejected", () => {
  let total = 0;
  let allowed = 0;
  for (const from of STATES) {
    for (const to of STATES) {
      total += 1;
      if (isTransitionAllowed(from, to)) allowed += 1;
    }
  }
  assert.equal(total, 36);
  assert.equal(allowed, 13);
  assert.equal(total - allowed, 23);
  assert.equal(EXPECTED_KEYS.length, 13);
});

test("the exported edge table holds exactly the D-11 edges", () => {
  const actual = ALLOWED_TRANSITIONS.map(([f, t]) => key(f, t));
  assert.equal(actual.length, 13);
  assert.equal(new Set(actual).size, 13);
  assert.deepEqual([...actual].sort(), [...EXPECTED_KEYS].sort());
});

test("the exported edge table and every edge tuple are frozen", () => {
  assert.equal(Object.isFrozen(ALLOWED_TRANSITIONS), true);
  for (const edge of ALLOWED_TRANSITIONS) {
    assert.equal(Object.isFrozen(edge), true, `${key(edge[0], edge[1])} must be frozen`);
  }
});

test("editing the edge table or any edge in strict mode throws a TypeError", () => {
  const table = ALLOWED_TRANSITIONS as unknown as string[][];
  const edge = table[0] as string[];
  assert.throws(() => {
    "use strict";
    edge[0] = "active";
  }, TypeError);
  assert.throws(() => {
    "use strict";
    edge.push("active");
  }, TypeError);
  assert.throws(() => {
    "use strict";
    table.push(["active", "active"]);
  }, TypeError);
  assert.throws(() => {
    "use strict";
    table[0] = ["active", "active"];
  }, TypeError);
  assert.deepEqual(table[0], ["unbound", "connecting"]);
});

test("the state list is frozen at runtime", () => {
  assert.equal(Object.isFrozen(STATES), true);
});

test("assigning into or extending the state list throws a TypeError", () => {
  const mutable = STATES as unknown as string[];
  assert.throws(() => {
    mutable[0] = "active";
  }, TypeError);
  assert.throws(() => {
    mutable.push("paused");
  }, TypeError);
  assert.deepEqual(
    [...STATES],
    ["unbound", "connecting", "active", "degraded", "error", "stopping"],
  );
});

test("every self-transition is rejected with REALM_INVALID_TRANSITION (equality never merges)", () => {
  for (const state of STATES) {
    assert.equal(isTransitionAllowed(state, state), false, `${state}>${state}`);
    const err = checkTransition(state, state);
    assert.ok(err instanceof RealmError, `${state}>${state} must return a RealmError`);
    assert.equal(err.code, "REALM_INVALID_TRANSITION");
  }
});

for (const from of STATES) {
  for (const to of STATES) {
    const expected = EXPECTED_ALLOWED[key(from, to)] === true;
    const outcome = expected ? "accepted" : "rejected with REALM_INVALID_TRANSITION";
    test(`${key(from, to)} is ${outcome}`, () => {
      assert.equal(isTransitionAllowed(from, to), expected);
      const err = checkTransition(from, to);
      if (expected) {
        assert.equal(err, null);
      } else {
        assert.ok(err instanceof RealmError, `${key(from, to)} must return a RealmError`);
        assert.equal(err.code, "REALM_INVALID_TRANSITION");
        assert.equal(err.retryable, false);
        assert.ok(err.reason.trim().length > 0);
      }
    });
  }
}

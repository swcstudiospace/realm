// The plain sleep shared by the daemon, the runtime and the doctor (Q0-004). The clock is mocked, so the test
// asserts the delay exactly and cannot flake on wall-clock timing.

import assert from "node:assert/strict";
import { test } from "node:test";
import { sleep } from "../../src/core/timeout.js";

void test("Q0-004: sleep resolves once its delay has elapsed, and not one millisecond earlier", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  t.after(() => {
    t.mock.timers.reset();
  });
  let settled = false;
  const done = sleep(100).then(() => {
    settled = true;
  });
  t.mock.timers.tick(99);
  await Promise.resolve();
  assert.equal(settled, false, "sleep must not resolve before its delay");
  t.mock.timers.tick(1);
  await done;
  assert.equal(settled, true, "sleep resolves at its delay");
});

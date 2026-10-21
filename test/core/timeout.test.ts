import { test } from "node:test";
import assert from "node:assert/strict";
import { RealmError } from "../../src/core/errors.js";
import { withTimeout } from "../../src/core/timeout.js";

// Count of live timers the runtime reports. A timer left behind after settle shows here.
function liveTimers(): number {
  return process.getActiveResourcesInfo().filter((name) => name === "Timeout").length;
}

test("QUAL-01: withTimeout resolves with the work's value and clears its timer on settle", async () => {
  const before = liveTimers();
  const value = await withTimeout(Promise.resolve(42), 60_000, "STARTUP_BUDGET_EXCEEDED");
  assert.equal(value, 42);
  assert.equal(liveTimers(), before, "no timer may outlive a settled call");
});

test("QUAL-01: withTimeout rejects with a RealmError carrying the given code on expiry", async () => {
  const before = liveTimers();
  await assert.rejects(
    withTimeout(new Promise<never>(() => {}), 5, "STARTUP_BUDGET_EXCEEDED"),
    (error: unknown) => {
      assert.ok(error instanceof RealmError, "expected a RealmError");
      assert.equal(error.code, "STARTUP_BUDGET_EXCEEDED");
      return true;
    },
  );
  assert.equal(liveTimers(), before, "no timer may outlive an expired call");
});

test("QUAL-01: withTimeout passes the work's own rejection through and clears its timer", async () => {
  const before = liveTimers();
  await assert.rejects(withTimeout(Promise.reject(new Error("work failed")), 60_000, "TOOL_TIMEOUT"), /work failed/);
  assert.equal(liveTimers(), before, "no timer may outlive a rejected call");
});

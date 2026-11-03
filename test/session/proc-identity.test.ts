import { test } from "node:test";
import assert from "node:assert/strict";
import { currentBootId, parseProcStat, startTicksOf } from "../../src/session/proc-identity.js";

void test("the stat parser reads fields after the last ')' when the command name has spaces and parentheses", () => {
  // Field 3 (state) is "S", field 4 (ppid) is 7, field 5 (pgrp) is 42 and field 22 (starttime) is 98765.
  const line = "42 (a b (c) d) S 7 42 42 0 -1 4194560 100 0 0 0 1 2 0 0 20 0 1 0 98765 1000 5 18446744073709551615";

  assert.deepEqual(parseProcStat(line), { state: "S", pgid: 42, startTicks: 98765 });
});

void test("the start ticks of the current process are a positive integer", () => {
  const ticks = startTicksOf(process.pid);

  assert.ok(ticks !== undefined && Number.isInteger(ticks) && ticks > 0);
});

void test("the boot id is a non-empty string", () => {
  const id = currentBootId();

  assert.ok(typeof id === "string" && id.length > 0);
});

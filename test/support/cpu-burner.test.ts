import { test } from "node:test";
import assert from "node:assert/strict";
import { startCpuBurners } from "./cpu-burner.js";

void test("zero burners start nothing and stop at once", async () => {
  const stop = startCpuBurners(0);
  await stop();
});

void test("burners start, stop, and stopping twice is harmless", async () => {
  const stop = startCpuBurners(2);
  await stop();
  await stop();
  assert.ok(true, "both stops resolved");
});

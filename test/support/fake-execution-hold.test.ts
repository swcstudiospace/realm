import { test } from "node:test";
import assert from "node:assert/strict";
import type { CreateRequest } from "../../src/core/ports.js";
import { FakeExecutionService } from "./fake-execution.js";
import { boundedWait } from "./timing.js";

function request(key: string): CreateRequest {
  return { idempotencyKey: key, workspaceRoot: "/workspace" };
}

// Records whether a promise has settled, without awaiting it.
function observe(work: Promise<unknown>): { readonly settled: () => boolean } {
  let done = false;
  const mark = (): void => {
    done = true;
  };
  void work.then(mark, mark);
  return { settled: () => done };
}

// Lets every pending microtask and I/O callback run, so a call that is not held has finished by the time this returns.
async function flush(): Promise<void> {
  // Executor form: tsconfig's ES2023 lib has no Promise.withResolvers.
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}

void test("hold: a held create is logged at once but does not complete until it is released", async () => {
  const exec = new FakeExecutionService();
  const release = exec.holdNext("create");

  const created = exec.create(request("a"));
  const outcome = observe(created);
  await flush();

  assert.equal(exec.callCount("create"), 1, "the held call is logged when it starts");
  assert.equal(outcome.settled(), false, "the held call must not complete before the release");
  assert.deepEqual(exec.resources(), [], "the held call has had no effect yet");

  release();
  assert.deepEqual(await boundedWait(created, "the released create"), { containerId: "fake-container-1" });
  assert.equal(exec.resources().length, 1);
});

void test("hold: only the next call is held, and the call after it is not blocked", async () => {
  const exec = new FakeExecutionService();
  const release = exec.holdNext("create");

  const first = exec.create(request("first"));
  const firstOutcome = observe(first);
  const second = await boundedWait(exec.create(request("second")), "the second create");
  assert.deepEqual(second, { containerId: "fake-container-1" }, "the later call ran its own effect while the first was parked");
  assert.equal(firstOutcome.settled(), false);

  release();
  assert.deepEqual(await boundedWait(first, "the first create"), { containerId: "fake-container-2" });
  assert.equal(exec.callCount("create"), 2);
});

void test("hold: an operation other than the held one is unaffected", async () => {
  const exec = new FakeExecutionService();
  const { containerId } = await exec.create(request("a"));
  const release = exec.holdNext("create");

  const parked = exec.create(request("b"));
  const parkedOutcome = observe(parked);
  await boundedWait(exec.start(containerId, "realm-a"), "start");
  assert.equal(await boundedWait(exec.probe(containerId, "realm-a"), "probe"), "healthy");
  await boundedWait(exec.stop(containerId, "realm-a"), "stop");
  await boundedWait(exec.destroy(containerId, "realm-a"), "destroy");
  assert.equal(parkedOutcome.settled(), false, "the held create is still parked");

  release();
  await boundedWait(parked, "the released create");
});

void test("hold: two holds on one operation are taken by the calls in call order", async () => {
  const exec = new FakeExecutionService();
  const releaseFirst = exec.holdNext("create");
  const releaseSecond = exec.holdNext("create");

  const first = exec.create(request("first"));
  const second = exec.create(request("second"));
  const third = await boundedWait(exec.create(request("third")), "the third create");
  assert.deepEqual(third, { containerId: "fake-container-1" }, "the call after both holds is not blocked");
  const firstOutcome = observe(first);
  const secondOutcome = observe(second);

  releaseSecond();
  await boundedWait(second, "the second create");
  await flush();
  assert.equal(secondOutcome.settled(), true);
  assert.equal(firstOutcome.settled(), false, "releasing the second hold does not release the first");

  releaseFirst();
  await boundedWait(first, "the first create");
  assert.equal(exec.callCount("create"), 3);
});

void test("hold: releasing twice is harmless, and the second release changes nothing", async () => {
  const exec = new FakeExecutionService();
  const release = exec.holdNext("probe");
  const { containerId } = await exec.create(request("a"));

  const held = exec.probe(containerId, "realm-a");
  release();
  release();
  assert.equal(await boundedWait(held, "the held probe"), "healthy");
  release();

  assert.equal(await boundedWait(exec.probe(containerId, "realm-a"), "the next probe"), "healthy");
  assert.equal(exec.callCount("probe"), 2);
});

void test("hold: a release before the held call starts lets it through, and setDelay still works with it", async () => {
  const exec = new FakeExecutionService();
  const release = exec.holdNext("create");
  release();
  assert.deepEqual(await boundedWait(exec.create(request("a")), "the pre-released create"), { containerId: "fake-container-1" });

  exec.setDelay("start", 1);
  await boundedWait(exec.start("fake-container-1", "realm-a"), "the delayed start");
  assert.equal(exec.resources()[0]?.started, true);
});

void test("hold: a held call still takes its one-shot failure after the release", async () => {
  const exec = new FakeExecutionService();
  exec.failNext("create", "SCHEMA_INVALID");
  const release = exec.holdNext("create");

  const held = exec.create(request("a"));
  const outcome = assert.rejects(held, { code: "SCHEMA_INVALID" });
  release();
  await outcome;
  assert.deepEqual(exec.resources(), []);
});

void test("settled: waits for a held call until it is released, and resolves at once when nothing is in flight", async () => {
  const exec = new FakeExecutionService();
  await boundedWait(exec.settled(), "settled with no calls");

  const release = exec.holdNext("create");
  const held = exec.create(request("a"));
  const other = exec.create(request("b"));
  await boundedWait(other, "the unheld create");

  const settled = exec.settled();
  const outcome = observe(settled);
  await flush();
  assert.equal(outcome.settled(), false, "settled() must wait for the held call");

  release();
  await boundedWait(settled, "settled after the release");
  assert.equal(outcome.settled(), true);
  assert.deepEqual(await held, { containerId: "fake-container-2" });
});

void test("settled: a call that failed has completed, and settled never rejects", async () => {
  const exec = new FakeExecutionService();
  exec.failNext("start", "SCHEMA_INVALID");
  const failed = exec.start("missing", "realm-a");
  const outcome = assert.rejects(failed, { code: "SCHEMA_INVALID" });

  await boundedWait(exec.settled(), "settled after a failed call");
  await outcome;
});

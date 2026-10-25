import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RealmError, type ErrorCode } from "../../src/core/errors.js";
import { LibpodClient } from "../../src/runtime/libpod-client.js";
import { removeAllRealmContainers, SWEEP_CALL_TIMEOUT_MS, type SweepClient } from "../../src/runtime/sweep.js";
import { REAP_SWEEP_TIMEOUT_MS, reapStartup } from "../../src/session/reap.js";
import { FakeContainerStore, FakeLibpod } from "../support/fake-libpod.js";

const REALM_LABELS = { "openshell.managed": "true" };

// A promise that never settles: the stand-in for a libpod call that hangs. The executor form is used
// because tsconfig's ES2023 lib has no Promise.withResolvers.
function neverSettles<T>(): Promise<T> {
  return new Promise<T>(() => undefined);
}

// A record store whose deletions are logged into the shared event log, so ordering against
// container removal is observable.
function recordStore(ids: readonly string[], log: string[] = []): {
  readonly store: { list: () => string[]; delete: (id: string) => void };
  readonly log: string[];
  readonly live: string[];
} {
  const live = [...ids];
  return {
    log,
    live,
    store: {
      list: (): string[] => [...live],
      delete: (id: string): void => {
        log.push(`delete:${id}`);
        live.splice(live.indexOf(id), 1);
      },
    },
  };
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

// Lets every pending microtask run before the mocked clock moves, so timers created by a
// chain of resolved awaits are registered at the current mocked time.
async function flush(): Promise<void> {
  // Executor form: tsconfig's ES2023 lib has no Promise.withResolvers.
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}

async function assertCode(work: Promise<unknown>, code: ErrorCode): Promise<void> {
  await assert.rejects(work, (error: unknown) => error instanceof RealmError && error.code === code);
}

function enableMockedTimers(t: TestContext): void {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  t.after(() => {
    t.mock.timers.reset();
  });
}

void test("RT-08: a hung container list ends with PODMAN_MACHINE_DOWN within SWEEP_CALL_TIMEOUT_MS and removes no record", async (t) => {
  enableMockedTimers(t);
  const removals: string[] = [];
  const hungClient: SweepClient = {
    listContainersByLabel: () => neverSettles(),
    removeContainer: (id: string) => {
      removals.push(id);
      return Promise.resolve();
    },
  };
  const records = recordStore(["session-a", "session-b"]);

  const reaped = reapStartup({ store: records.store, sweep: () => removeAllRealmContainers(hungClient) });
  const outcome = observe(reaped);
  await flush();
  t.mock.timers.tick(SWEEP_CALL_TIMEOUT_MS - 1);
  await flush();
  assert.equal(outcome.settled(), false, "the hung listing must not end before the bound");

  t.mock.timers.tick(1);
  await assertCode(reaped, "PODMAN_MACHINE_DOWN");
  assert.deepEqual(removals, []);
  assert.deepEqual(records.log, [], "no record may be deleted after a timed-out sweep");
  assert.deepEqual(records.live, ["session-a", "session-b"]);
});

void test("RT-08: a hung second listing after a removal ends with PODMAN_MACHINE_DOWN within the bound, and removes no record", async (t) => {
  enableMockedTimers(t);
  const removals: string[] = [];
  let listings = 0;
  const client: SweepClient = {
    listContainersByLabel: () => {
      listings += 1;
      return listings === 1 ? Promise.resolve([{ id: "realm-1", labels: { "openshell.ai/sandbox-name": "realm-1" } }]) : neverSettles();
    },
    removeContainer: (id: string) => {
      removals.push(id);
      return Promise.resolve();
    },
  };
  const records = recordStore(["session-a"]);

  const reaped = reapStartup({ store: records.store, sweep: () => removeAllRealmContainers(client) });
  const outcome = observe(reaped);
  await flush();
  t.mock.timers.tick(SWEEP_CALL_TIMEOUT_MS - 1);
  await flush();
  assert.equal(outcome.settled(), false, "the proving listing must not end before the bound");

  t.mock.timers.tick(1);
  await assertCode(reaped, "PODMAN_MACHINE_DOWN");
  assert.deepEqual(removals, ["realm-1"]);
  assert.deepEqual(records.log, [], "no record may be deleted when the proving listing times out");
  assert.deepEqual(records.live, ["session-a"]);
});

void test("RT-08: a hung removal is bounded, and the proving listing that still finds the container gives REALM_STOPPING with no record deleted", async (t) => {
  enableMockedTimers(t);
  const client: SweepClient = {
    listContainersByLabel: () => Promise.resolve([{ id: "realm-stuck", labels: { "openshell.ai/sandbox-name": "realm-stuck" } }]),
    removeContainer: () => neverSettles(),
  };
  const records = recordStore(["session-a"]);

  const reaped = reapStartup({ store: records.store, sweep: () => removeAllRealmContainers(client) });
  const outcome = observe(reaped);
  await flush();
  t.mock.timers.tick(SWEEP_CALL_TIMEOUT_MS - 1);
  await flush();
  assert.equal(outcome.settled(), false, "the hung removal must not end before the bound");

  t.mock.timers.tick(1);
  await assertCode(reaped, "REALM_STOPPING");
  assert.deepEqual(records.log, [], "no record may be deleted while a container survives");
  assert.deepEqual(records.live, ["session-a"]);
});

void test("RT-08: a sweep that never finishes makes reapStartup reject with PODMAN_MACHINE_DOWN within REAP_SWEEP_TIMEOUT_MS and deletes no record", async (t) => {
  enableMockedTimers(t);
  const records = recordStore(["session-a", "session-b"]);

  const reaped = reapStartup({ store: records.store, sweep: () => neverSettles<number>() });
  const outcome = observe(reaped);
  await flush();
  t.mock.timers.tick(REAP_SWEEP_TIMEOUT_MS - 1);
  await flush();
  assert.equal(outcome.settled(), false, "the reap must not end before its bound");

  t.mock.timers.tick(1);
  await assertCode(reaped, "PODMAN_MACHINE_DOWN");
  assert.deepEqual(records.log, [], "no record may be deleted after a timed-out reap");
  assert.deepEqual(records.live, ["session-a", "session-b"]);
});

void test("RT-08: a hung container list on the real libpod client ends with PODMAN_MACHINE_DOWN and removes no record", async (t) => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "realm-sweep-timeout-")));
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  const socketPath = join(dir, "podman.sock");
  const containers = new FakeContainerStore();
  containers.add({ id: "realm-1", labels: { ...REALM_LABELS, "openshell.ai/sandbox-name": "realm-1" }, running: true });
  const libpod = new FakeLibpod({ store: containers });
  await libpod.start(socketPath);
  t.after(() => libpod.stop());
  libpod.hangNext("listContainers");
  const client = new LibpodClient(socketPath, { requestTimeoutMs: 50 });
  const records = recordStore(["session-a"]);

  const started = Date.now();
  await assertCode(
    reapStartup({ store: records.store, sweep: () => removeAllRealmContainers(client) }),
    "PODMAN_MACHINE_DOWN",
  );
  assert.ok(Date.now() - started < SWEEP_CALL_TIMEOUT_MS, "the hung listing must end within the sweep bound");
  assert.deepEqual(records.log, []);
  assert.deepEqual(records.live, ["session-a"]);
  assert.notEqual(containers.get("realm-1"), undefined, "a timed-out sweep removes no container");
});

void test("RT-08: a successful sweep removes every container before any record is deleted", async (t) => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "realm-sweep-order-")));
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  const socketPath = join(dir, "podman.sock");
  const containers = new FakeContainerStore();
  containers.add({ id: "realm-1", labels: { ...REALM_LABELS, "openshell.ai/sandbox-name": "realm-1" }, running: true });
  containers.add({ id: "realm-2", labels: { ...REALM_LABELS, "openshell.ai/sandbox-name": "realm-2" }, running: false });
  containers.add({ id: "foreign-1", labels: { owner: "someone-else" }, running: true });
  const libpod = new FakeLibpod({ store: containers });
  await libpod.start(socketPath);
  t.after(() => libpod.stop());
  const client = new LibpodClient(socketPath);

  const events: string[] = [];
  const recording: SweepClient = {
    listContainersByLabel: async (key: string, value: string) => {
      events.push("list");
      return client.listContainersByLabel(key, value);
    },
    removeContainer: async (id: string, options: { readonly force: boolean }) => {
      events.push(`remove:${id}`);
      await client.removeContainer(id, options);
    },
  };
  const records = recordStore(["session-a", "session-b"], events);

  const result = await reapStartup({
    store: records.store,
    sweep: async () => {
      const removed = await removeAllRealmContainers(recording);
      events.push("sweep-done");
      return removed;
    },
  });

  assert.deepEqual(result, { containersRemoved: 2, recordsDeleted: 2 });
  const sweepDone = events.indexOf("sweep-done");
  assert.ok(sweepDone > 0, "the sweep must finish");
  const removedBeforeSweepEnd = events
    .slice(0, sweepDone)
    .filter((event) => event !== "list")
    .sort();
  assert.deepEqual(removedBeforeSweepEnd, ["remove:realm-1", "remove:realm-2"]);
  assert.deepEqual(events.slice(sweepDone + 1), ["delete:session-a", "delete:session-b"]);
  assert.notEqual(containers.get("foreign-1"), undefined, "a foreign container is never removed");
});

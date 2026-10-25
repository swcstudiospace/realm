import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SessionRecord } from "../../src/contract/validate.js";
import { RealmError, type ErrorCode } from "../../src/core/errors.js";
import { LibpodClient } from "../../src/runtime/libpod-client.js";
import { removeAllRealmContainers } from "../../src/runtime/sweep.js";
import { reapStartup } from "../../src/session/reap.js";
import { SessionStore } from "../../src/session/store.js";
import { FakeContainerStore, FakeLibpod } from "../support/fake-libpod.js";

const REALM_ID = "7b1c2d3e-4f50-4a61-8b72-9c83d4e5f601";
const REALM_LABELS = { "openshell.managed": "true" };

interface Fixture {
  readonly stateDir: string;
  readonly store: SessionStore;
  readonly containers: FakeContainerStore;
  readonly libpod: FakeLibpod;
  readonly client: LibpodClient;
}

async function startFixture(t: TestContext): Promise<Fixture> {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "realm-reap-")));
  t.after(() => {
    rmSync(base, { recursive: true, force: true });
  });
  const socketPath = join(base, "podman.sock");
  const containers = new FakeContainerStore();
  const libpod = new FakeLibpod({ store: containers });
  await libpod.start(socketPath);
  t.after(() => libpod.stop());
  const stateDir = join(base, "state");
  return { stateDir, store: new SessionStore(stateDir), containers, libpod, client: new LibpodClient(socketPath) };
}

function recordFor(stateDir: string, sessionId: string, containerId: string | null): SessionRecord {
  return {
    realmId: REALM_ID,
    sessionId,
    workspaceRoot: "/srv/workspace",
    state: "connecting",
    controlSocketPath: join(stateDir, "run", "control.sock"),
    containerId,
  };
}

function removals(libpod: FakeLibpod): readonly string[] {
  return libpod
    .requests()
    .filter((request) => request.route === "removeContainer")
    .map((request) => request.target);
}

async function assertCode(work: Promise<unknown>, code: ErrorCode): Promise<void> {
  await assert.rejects(work, (error: unknown) => error instanceof RealmError && error.code === code);
}

void test("RT-08: reapStartup removes every container before it deletes any record, checked against the live container store (D-84)", async (t) => {
  const { stateDir, store, containers, client } = await startFixture(t);
  store.save(recordFor(stateDir, "session-null", null));
  store.save(recordFor(stateDir, "session-live", "realm-live"));
  containers.add({ id: "realm-live", labels: { ...REALM_LABELS, "openshell.ai/sandbox-name": "realm-live" }, running: true });

  const log: string[] = [];
  const observed = {
    list: () => store.list(),
    delete: (sessionId: string) => {
      const left = containers.list().filter((container) => container.labels["openshell.managed"] === "true");
      log.push(`record:${sessionId}:containers-left=${String(left.length)}`);
      store.delete(sessionId);
    },
  };
  const result = await reapStartup({
    store: observed,
    sweep: async () => {
      log.push("sweep:start");
      const removed = await removeAllRealmContainers(client);
      log.push(`sweep:removed=${String(removed)}`);
      return removed;
    },
  });

  assert.deepEqual(log, [
    "sweep:start",
    "sweep:removed=1",
    "record:session-live:containers-left=0",
    "record:session-null:containers-left=0",
  ]);
  assert.deepEqual(result, { containersRemoved: 1, recordsDeleted: 2 });
  assert.deepEqual(store.list(), []);
});

void test("RT-08: reapStartup reaps a crash during realm up with a null container id, found through its label (D-86)", async (t) => {
  const { stateDir, store, containers, client } = await startFixture(t);
  store.save(recordFor(stateDir, "session-null", null));
  containers.add({ id: "realm-orphan", labels: { ...REALM_LABELS, "openshell.ai/sandbox-name": "realm-orphan" }, running: false });

  const result = await reapStartup({ store, sweep: () => removeAllRealmContainers(client) });

  assert.deepEqual(result, { containersRemoved: 1, recordsDeleted: 1 });
  assert.equal(containers.get("realm-orphan"), undefined);
  assert.equal(store.load("session-null"), null);
});

void test("RT-08: reapStartup reaps a record that holds a container id together with that container (D-86)", async (t) => {
  const { stateDir, store, containers, client } = await startFixture(t);
  store.save(recordFor(stateDir, "session-bound", "realm-bound"));
  containers.add({ id: "realm-bound", labels: { ...REALM_LABELS, "openshell.ai/sandbox-name": "realm-bound" }, running: true });

  const result = await reapStartup({ store, sweep: () => removeAllRealmContainers(client) });

  assert.deepEqual(result, { containersRemoved: 1, recordsDeleted: 1 });
  assert.equal(containers.get("realm-bound"), undefined);
  assert.equal(store.load("session-bound"), null);
});

void test("RT-08: reapStartup leaves a foreign unlabelled container untouched (D-86)", async (t) => {
  const { stateDir, store, containers, libpod, client } = await startFixture(t);
  store.save(recordFor(stateDir, "session-null", null));
  containers.add({ id: "realm-orphan", labels: { ...REALM_LABELS, "openshell.ai/sandbox-name": "realm-orphan" }, running: true });
  containers.add({ id: "foreign-1", labels: { owner: "someone-else" }, running: true });

  await reapStartup({ store, sweep: () => removeAllRealmContainers(client) });

  assert.notEqual(containers.get("foreign-1"), undefined);
  assert.equal(removals(libpod).some((target) => target.includes("foreign-1")), false);
  assert.equal(removals(libpod).some((target) => target.includes("realm-orphan")), true);
});

void test("RT-08: a second reapStartup is a no-op that removes nothing and deletes nothing (D-84)", async (t) => {
  const { stateDir, store, containers, libpod, client } = await startFixture(t);
  store.save(recordFor(stateDir, "session-null", null));
  containers.add({ id: "realm-orphan", labels: { ...REALM_LABELS, "openshell.ai/sandbox-name": "realm-orphan" }, running: true });
  await reapStartup({ store, sweep: () => removeAllRealmContainers(client) });
  const removalsAfterFirst = removals(libpod).length;

  const second = await reapStartup({ store, sweep: () => removeAllRealmContainers(client) });

  assert.deepEqual(second, { containersRemoved: 0, recordsDeleted: 0 });
  assert.equal(removals(libpod).length, removalsAfterFirst);
});

void test("RT-08: a surviving container makes reapStartup reject with REALM_STOPPING, deletes no record, and a later reap completes (D-84)", async (t) => {
  const { stateDir, store, containers, libpod, client } = await startFixture(t);
  store.save(recordFor(stateDir, "session-null", null));
  store.save(recordFor(stateDir, "session-bound", "realm-stuck"));
  containers.add({ id: "realm-stuck", labels: { ...REALM_LABELS, "openshell.ai/sandbox-name": "realm-stuck" }, running: true });
  libpod.respondNext("removeContainer", { status: 500 });

  const deleted: string[] = [];
  const observed = {
    list: () => store.list(),
    delete: (sessionId: string) => {
      deleted.push(sessionId);
      store.delete(sessionId);
    },
  };
  await assertCode(reapStartup({ store: observed, sweep: () => removeAllRealmContainers(client) }), "REALM_STOPPING");

  assert.deepEqual(deleted, []);
  assert.deepEqual(store.list(), ["session-bound", "session-null"]);
  assert.notEqual(containers.get("realm-stuck"), undefined);

  const later = await reapStartup({ store: observed, sweep: () => removeAllRealmContainers(client) });
  assert.deepEqual(later, { containersRemoved: 1, recordsDeleted: 2 });
  assert.deepEqual(store.list(), []);
});

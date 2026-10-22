import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RealmError, type ErrorCode } from "../../src/core/errors.js";
import { LibpodClient } from "../../src/runtime/libpod-client.js";
import { removeAllRealmContainers } from "../../src/runtime/sweep.js";
import { FakeContainerStore, FakeLibpod } from "../support/fake-libpod.js";

const REALM_LABELS = { "io.realm.managed": "true" };

async function startFixture(t: TestContext): Promise<{
  readonly store: FakeContainerStore;
  readonly libpod: FakeLibpod;
  readonly client: LibpodClient;
}> {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "realm-down-sweep-")));
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  const socketPath = join(dir, "podman.sock");
  const store = new FakeContainerStore();
  const libpod = new FakeLibpod({ store });
  await libpod.start(socketPath);
  t.after(() => libpod.stop());
  return { store, libpod, client: new LibpodClient(socketPath) };
}

function requestsOn(libpod: FakeLibpod, route: string): readonly string[] {
  return libpod.requests().filter((request) => request.route === route).map((request) => request.target);
}

async function assertCode(work: Promise<unknown>, code: ErrorCode): Promise<void> {
  await assert.rejects(work, (error: unknown) => error instanceof RealmError && error.code === code);
}

void test("RT-08: the sweep removes every realm-labelled container, leaves a foreign container untouched, and returns the removed count", async (t) => {
  const { store, libpod, client } = await startFixture(t);
  for (const n of [1, 2, 3]) {
    store.add({ id: `realm-${String(n)}`, labels: { ...REALM_LABELS, "io.realm.session": `s-${String(n)}` }, running: n % 2 === 1 });
  }
  store.add({ id: "foreign-1", labels: { owner: "someone-else" }, running: true });

  const removed = await removeAllRealmContainers(client);
  assert.equal(removed, 3);

  assert.deepEqual(
    store.list().map((container) => container.id),
    ["foreign-1"],
  );
  const removals = requestsOn(libpod, "removeContainer");
  assert.equal(removals.length, 3);
  assert.equal(
    removals.some((target) => target.includes("foreign-1")),
    false,
  );
});

void test("RT-08: the sweep lists before and after removal on every run, and a repeated sweep over a clean host is a no-op returning zero", async (t) => {
  const { libpod, client } = await startFixture(t);

  assert.equal(await removeAllRealmContainers(client), 0);
  assert.equal(requestsOn(libpod, "listContainers").length, 2);
  assert.equal(requestsOn(libpod, "removeContainer").length, 0);

  assert.equal(await removeAllRealmContainers(client), 0);
  assert.equal(requestsOn(libpod, "listContainers").length, 4);
  assert.equal(requestsOn(libpod, "removeContainer").length, 0);
});

void test("RT-08: a container that cannot be removed gives REALM_STOPPING, and a repeated sweep clears it and returns its count", async (t) => {
  const { store, libpod, client } = await startFixture(t);
  store.add({ id: "realm-stuck", labels: REALM_LABELS, running: true });
  libpod.respondNext("removeContainer", { status: 500 });

  await assertCode(removeAllRealmContainers(client), "REALM_STOPPING");
  assert.equal(store.list().length, 1);

  assert.equal(await removeAllRealmContainers(client), 1);
  assert.equal(store.list().length, 0);
});

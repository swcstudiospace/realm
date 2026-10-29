import { test } from "node:test";
import assert from "node:assert/strict";
import { makeRealmError, RealmError } from "../../src/core/errors.js";
import { removeAllRealmContainers, type SweepClient } from "../../src/runtime/sweep.js";

void test("QUAL-01: a removal that fails and leaves its container listed refuses with REALM_STOPPING and the removal's code", async () => {
  const client: SweepClient = {
    listContainersByLabel: () => Promise.resolve([{ id: "realm-stuck", labels: { "openshell.ai/sandbox-name": "realm-stuck" } }]),
    removeContainer: () => Promise.reject(makeRealmError("PODMAN_MACHINE_DOWN")),
  };
  await assert.rejects(
    removeAllRealmContainers(client),
    (error: unknown) =>
      error instanceof RealmError && error.code === "REALM_STOPPING" && error.causeCode === "PODMAN_MACHINE_DOWN",
  );
});

// A client over an in-memory list: a removal drops the container, a container in `stuck` stays listed.
function listClient(ids: readonly string[], stuck: readonly string[] = []): SweepClient {
  const live = new Set(ids);
  return {
    listContainersByLabel: () =>
      Promise.resolve([...live].map((id) => ({ id, labels: { "openshell.ai/sandbox-name": `realm-${id}` } }))),
    removeContainer: (id: string) => {
      if (stuck.includes(id)) {
        return Promise.reject(makeRealmError("PODMAN_MACHINE_DOWN"));
      }
      live.delete(id);
      return Promise.resolve();
    },
  };
}

void test("CRASH-04: onRemoved receives the id of each removed container, and none on a clean host", async () => {
  const removed: string[] = [];
  const count = await removeAllRealmContainers(listClient(["aaa", "bbb"]), (id) => {
    removed.push(id);
  });
  assert.equal(count, 2);
  assert.deepEqual(removed, ["aaa", "bbb"]);

  const clean: string[] = [];
  const none = await removeAllRealmContainers(listClient([]), (id) => {
    clean.push(id);
  });
  assert.equal(none, 0);
  assert.deepEqual(clean, []);
});

void test("CRASH-04: onRemoved is not called for a removal that failed, and the sweep still refuses", async () => {
  const removed: string[] = [];
  await assert.rejects(
    removeAllRealmContainers(listClient(["ok", "stuck"], ["stuck"]), (id) => {
      removed.push(id);
    }),
    (error: unknown) => error instanceof RealmError && error.code === "REALM_STOPPING",
  );
  assert.deepEqual(removed, ["ok"]);
});

void test("CRASH-04: a removal whose reply is lost but whose container is gone is reported exactly once, after the proving listing", async () => {
  const live = new Set(["fine", "lost-reply"]);
  const client: SweepClient = {
    listContainersByLabel: () =>
      Promise.resolve([...live].map((id) => ({ id, labels: { "openshell.ai/sandbox-name": `realm-${id}` } }))),
    removeContainer: (id: string) => {
      live.delete(id);
      return id === "lost-reply" ? Promise.reject(makeRealmError("PODMAN_MACHINE_DOWN")) : Promise.resolve();
    },
  };
  const removed: string[] = [];
  const count = await removeAllRealmContainers(client, (id) => {
    removed.push(id);
  });
  assert.equal(count, 2);
  assert.deepEqual([...removed].sort(), ["fine", "lost-reply"], "the ids match the count, each once");
});

void test("CRASH-04: a lost-reply removal is reported even when another container survives, and the survivor is not", async () => {
  const live = new Set(["lost-reply", "stuck"]);
  const client: SweepClient = {
    listContainersByLabel: () =>
      Promise.resolve([...live].map((id) => ({ id, labels: { "openshell.ai/sandbox-name": `realm-${id}` } }))),
    removeContainer: (id: string) => {
      if (id === "lost-reply") {
        live.delete(id);
      }
      return Promise.reject(makeRealmError("PODMAN_MACHINE_DOWN"));
    },
  };
  const removed: string[] = [];
  await assert.rejects(
    removeAllRealmContainers(client, (id) => {
      removed.push(id);
    }),
    (error: unknown) => error instanceof RealmError && error.code === "REALM_STOPPING",
  );
  assert.deepEqual(removed, ["lost-reply"]);
});

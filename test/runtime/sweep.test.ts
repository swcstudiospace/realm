import { test } from "node:test";
import assert from "node:assert/strict";
import { makeRealmError, RealmError } from "../../src/core/errors.js";
import { removeAllRealmContainers, type SweepClient } from "../../src/runtime/sweep.js";

void test("QUAL-01: a removal that fails and leaves its container listed refuses with REALM_STOPPING and the removal's code", async () => {
  const client: SweepClient = {
    listContainersByLabel: () => Promise.resolve([{ id: "realm-stuck" }]),
    removeContainer: () => Promise.reject(makeRealmError("PODMAN_MACHINE_DOWN")),
  };
  await assert.rejects(
    removeAllRealmContainers(client),
    (error: unknown) =>
      error instanceof RealmError && error.code === "REALM_STOPPING" && error.causeCode === "PODMAN_MACHINE_DOWN",
  );
});

// The sandbox binding is one derivation (C2). The driver's create builds the container's mounts from sandboxBindingOf, and the
// session's verifier takes its binding from it too. These tests pin the derived values, the refusals, and that the driver's
// container spec for one sandbox name is the binding the session derives for the same roots.

import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RealmError } from "../../src/core/errors.js";
import { ComputeDriver } from "../../src/runtime/driver/compute-driver.js";
import { sandboxBindingOf, type SandboxRoots } from "../../src/runtime/driver/sandbox-binding.js";
import { CHANNEL_DIR_NAME } from "../../src/runtime/driver/secret-store.js";
import { realmSandboxName } from "../../src/runtime/openshell.js";
import { FakeLibpod, FakeLifecycle, FakeRuntime, driverConfig, validSandbox } from "./driver/fakes.js";

const BASE = join(tmpdir(), "realm-sandbox-binding");
const ROOTS: SandboxRoots = {
  workspaceRoot: join(BASE, "workspace"),
  stateRoot: join(BASE, "state"),
  secretRoot: join(BASE, "secrets"),
};

void test("C2: one derivation names the pinned workspace, the sandbox's own state directory and its channel directory", () => {
  const name = realmSandboxName("sess-01");
  assert.deepEqual(sandboxBindingOf(ROOTS, name), {
    workspaceRoot: ROOTS.workspaceRoot,
    stateDir: join(ROOTS.stateRoot, name),
    channelDir: join(ROOTS.secretRoot, name, CHANNEL_DIR_NAME),
  });
});

void test("C2: the derivation refuses a name the realm did not create, or one that is not a single path segment", () => {
  for (const name of ["sess-01", "realm-a/b"]) {
    assert.throws(
      () => sandboxBindingOf(ROOTS, name),
      (error: unknown) => error instanceof RealmError && error.code === "SCHEMA_INVALID",
      `the name ${name} must be refused`,
    );
  }
});

void test("C2: the driver's container spec and the session's binding are equal for one sandbox name", async () => {
  const config = driverConfig();
  const lifecycle = new FakeLifecycle(new FakeLibpod());
  const driver = new ComputeDriver(config, { lifecycle, libpod: new FakeLibpod(), runtime: new FakeRuntime() });
  await driver.createSandbox(validSandbox());
  const spec = lifecycle.creates[0];
  assert.ok(spec !== undefined, "the driver reached the lifecycle with one create");
  // The session derives its binding from the same three roots: the pinned workspace root, the realm state root and the secret root.
  const session = sandboxBindingOf(
    { workspaceRoot: config.workspaceRoot, stateRoot: config.sandboxStateRoot, secretRoot: config.secretRoot },
    spec.sandboxName,
  );
  assert.deepEqual({ workspaceRoot: spec.workspaceDir, stateDir: spec.stateDir, channelDir: spec.channelDir }, session);
  assert.equal(session.channelDir, join(config.secretRoot, realmSandboxName("session-1"), CHANNEL_DIR_NAME));
});

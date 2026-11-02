// The sandbox binding is one derivation (C2). The driver's create builds the container's mounts from sandboxBindingOf, and the
// session's verifier takes its binding from it too. These tests pin the derived values, the refusals, and that the driver's
// container spec for one sandbox name is the binding the session derives for the same roots.

import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { RealmError } from "../../src/core/errors.js";
import { ComputeDriver } from "../../src/runtime/driver/compute-driver.js";
import { sandboxBindingOf, type SandboxRoots } from "../../src/runtime/driver/sandbox-binding.js";
import { CHANNEL_DIR_NAME } from "../../src/runtime/driver/secret-store.js";
import { realmSandboxName } from "../../src/runtime/openshell.js";
import { sandboxNameOfSession, sessionIdOfWorkspace } from "../../src/session/paths.js";
import { readWorkspaceEntry, verifyWorkspaceEntry } from "../../src/session/workspace-registry.js";
import { FakeLibpod, FakeLifecycle, FakeRuntime, driverConfig, validSandbox, writeSandboxWorkspaceEntry } from "./driver/fakes.js";

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
  const project = join(config.workspaceRoot, "project-a");
  const name = writeSandboxWorkspaceEntry(config, project);
  const lifecycle = new FakeLifecycle(new FakeLibpod());
  const driver = new ComputeDriver(config, { lifecycle, libpod: new FakeLibpod(), runtime: new FakeRuntime() });
  await driver.createSandbox(validSandbox({ name }));
  const spec = lifecycle.creates[0];
  assert.ok(spec !== undefined, "the driver reached the lifecycle with one create");
  // The session derives its binding from the same roots, and its workspace from the registry entry that names the project.
  const entry = readWorkspaceEntry(config.stateDir, sessionIdOfWorkspace(realpathSync(project)));
  assert.ok(entry !== null, "the registry holds the entry for the project");
  const session = sandboxBindingOf(
    { workspaceRoot: verifyWorkspaceEntry(entry).realPath, stateRoot: config.sandboxStateRoot, secretRoot: config.secretRoot },
    spec.sandboxName,
  );
  assert.deepEqual({ workspaceRoot: spec.workspaceDir, stateDir: spec.stateDir, channelDir: spec.channelDir }, session);
  assert.equal(session.channelDir, join(config.secretRoot, name, CHANNEL_DIR_NAME));
});

// Two project roots under one temporary root. Each project gives its own sandbox name and binding (MULTI-05).
function twoProjects(t: TestContext) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "realm-sandbox-two-")));
  t.after(() => {
    rmSync(base, { recursive: true, force: true });
  });
  const projectA = join(base, "project-a");
  const projectB = join(base, "project-b");
  mkdirSync(projectA);
  mkdirSync(projectB);
  return { base, projectA, projectB, roots: { stateRoot: join(base, "state"), secretRoot: join(base, "secrets") } };
}

void test("MULTI-05: two projects give distinct sandbox bindings, each pinned to its own workspace, state directory and channel directory", (t) => {
  const { projectA, projectB, roots } = twoProjects(t);
  const nameA = sandboxNameOfSession(sessionIdOfWorkspace(projectA));
  const nameB = sandboxNameOfSession(sessionIdOfWorkspace(projectB));
  const bindingA = sandboxBindingOf({ ...roots, workspaceRoot: projectA }, nameA);
  const bindingB = sandboxBindingOf({ ...roots, workspaceRoot: projectB }, nameB);
  assert.equal(bindingA.workspaceRoot, projectA);
  assert.equal(bindingB.workspaceRoot, projectB);
  assert.notEqual(bindingA.stateDir, bindingB.stateDir);
  assert.notEqual(bindingA.channelDir, bindingB.channelDir);
});

void test("MULTI-05: each project's sandbox name is at most 19 characters, the gateway limit", (t) => {
  const { projectA, projectB } = twoProjects(t);
  assert.ok(sandboxNameOfSession(sessionIdOfWorkspace(projectA)).length <= 19, "the name for project A fits the limit");
  assert.ok(sandboxNameOfSession(sessionIdOfWorkspace(projectB)).length <= 19, "the name for project B fits the limit");
});

void test("MULTI-05: a sandbox name for another session id maps to its own state directory under the same state root, and a name with a path separator is refused", (t) => {
  const { base, projectA, roots } = twoProjects(t);
  const nameA = sandboxNameOfSession(sessionIdOfWorkspace(projectA));
  const otherName = sandboxNameOfSession(sessionIdOfWorkspace(join(base, "project-other")));
  const bindingA = sandboxBindingOf({ ...roots, workspaceRoot: projectA }, nameA);
  const bindingOther = sandboxBindingOf({ ...roots, workspaceRoot: projectA }, otherName);
  assert.equal(bindingOther.stateDir, join(roots.stateRoot, otherName));
  assert.notEqual(bindingOther.stateDir, bindingA.stateDir);
  assert.throws(
    () => sandboxBindingOf({ ...roots, workspaceRoot: projectA }, `${nameA}/x`),
    (error: unknown) => error instanceof RealmError && error.code === "SCHEMA_INVALID",
  );
});

import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ERROR_CATALOGUE, RealmError } from "../../src/core/errors.js";
import { loadPolicyFile } from "../../src/core/policy.js";
import { displayStatus } from "../../src/core/status.js";
import { LockTable } from "../../src/fs/locks.js";
import { createRealmHandle, type CreateRealmHandleOptions } from "../../src/realm/compose.js";
import { FakeBridge } from "../support/fake-bridge.js";
import { FakeExecutionService } from "../support/fake-execution.js";

// OMP-01/OMP-05 composition-root proof (P5-D7, P5-D15). Every test builds the
// real LifecycleController and the real ToolDispatcher through
// createRealmHandle. The only doubles sit at the adapter seam: FakeExecutionService
// for exec, FakeBridge for bridge, a fixed clock, and a stub runner. No test
// starts a Podman container or an OpenShell process.

const IMAGE = `registry.example.com/realm/workload@sha256:${"0".repeat(64)}`;
const CLOCK_ISO = "2026-10-21T09:30:00.000Z";

interface Fixture {
  readonly base: string;
  readonly ws: string;
  readonly stateDir: string;
}

function makeDirs(t: TestContext): Fixture {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "realm-compose-")));
  t.after(() => {
    rmSync(base, { recursive: true, force: true });
  });
  const ws = join(base, "ws");
  mkdirSync(ws, { recursive: true });
  writeFileSync(join(ws, "doc.txt"), "original");
  return { base, ws, stateDir: join(base, "state") };
}

function writePolicy(fixture: Fixture, name: string, policy: Record<string, unknown>): string {
  const path = join(fixture.base, name);
  writeFileSync(path, JSON.stringify(policy));
  return path;
}

function advisoryOptions(fixture: Fixture): CreateRealmHandleOptions {
  return {
    runtimeInput: {
      image: IMAGE,
      stateDir: fixture.stateDir,
      workspaceRoot: fixture.ws,
    },
    // The policy names the workspace as a root: createRealmHandle refuses a workspace outside every root.
    policyPath: writePolicy(fixture, "advisory-policy.json", { mode: "advisory", workspaceRoots: [fixture.ws] }),
    sessionId: "sess-compose",
    exec: new FakeExecutionService(),
    bridge: new FakeBridge(),
    clock: () => new Date(CLOCK_ISO),
    runOpenShell: () =>
      Promise.resolve({ exitCode: 0, stdout: "", stderr: "", truncated: false }),
  };
}

function requiredOptions(fixture: Fixture): CreateRealmHandleOptions {
  const policyPath = writePolicy(fixture, "required-policy.json", { mode: "fail-closed", workspaceRoots: [fixture.ws] });
  return { ...advisoryOptions(fixture), policyPath };
}

void test("OMP-01: createRealmHandle starts unbound with reason no workspace and answers status through the shared mapping (P5-D7)", async (t) => {
  const fixture = makeDirs(t);
  const options = advisoryOptions(fixture);
  const handle = createRealmHandle(options);

  const snapshot = handle.controller.snapshot();
  assert.equal(snapshot.state, "unbound");
  assert.equal(snapshot.reason, "no workspace");

  const outcome = await handle.dispatcher.call({ status: {} });
  assert.equal(outcome.outcome, "done");
  if (outcome.tool !== "status") {
    assert.fail("expected a done status");
  }
  assert.equal(outcome.value.snapshot.state, "unbound");
  assert.deepEqual(outcome.value.display, displayStatus(outcome.value.snapshot));

  // Downcasts: the options held the fakes from construction, so the reads are exact.
  const exec = options.exec as FakeExecutionService;
  const bridge = options.bridge as FakeBridge;
  assert.deepEqual(exec.calls(), [], "no execution call was made");
  assert.deepEqual(exec.resources(), [], "no container was created");
  assert.deepEqual(bridge.calls(), [], "no bridge call was made");
});

void test("OMP-01: the controller and the dispatcher hold the same LockTable instance (P5-D15)", (t) => {
  const fixture = makeDirs(t);
  const handle = createRealmHandle(advisoryOptions(fixture));

  // Unchecked holder reads: neither frozen holder exposes its table, and both are
  // consumed, not reshaped, so the test names the fields it was constructed with.
  // The assertion is identity (===), not equality.
  const controllerInner = handle.controller as unknown as { locks: LockTable };
  const dispatcherInner = handle.dispatcher as unknown as { deps: { locks: LockTable } };
  const controllerLocks = controllerInner.locks;
  const dispatcherLocks = dispatcherInner.deps.locks;
  assert.ok(controllerLocks instanceof LockTable);
  assert.strictEqual(dispatcherLocks, controllerLocks, "one shared table, not two equal ones");
});

void test("OMP-05: a write while non-active is refused in required mode and warns in advisory mode (P5-D6)", async (t) => {
  const requiredFixture = makeDirs(t);
  const required = createRealmHandle(requiredOptions(requiredFixture));
  assert.equal(required.controller.snapshot().state, "unbound");
  const refused = await required.dispatcher.call({ write: { path: "doc.txt", content: "blocked" } });
  assert.deepEqual(refused, {
    outcome: "refused",
    tool: "write",
    code: "REALM_UNBOUND",
    retryable: ERROR_CATALOGUE["REALM_UNBOUND"].retryable,
  });
  assert.equal(readFileSync(join(requiredFixture.ws, "doc.txt"), "utf8"), "original");

  const advisoryFixture = makeDirs(t);
  const advisory = createRealmHandle(advisoryOptions(advisoryFixture));
  const warned = await advisory.dispatcher.call({ write: { path: "doc.txt", content: "advisory" } });
  assert.equal(warned.outcome, "done");
  if (warned.tool !== "write") {
    assert.fail("expected a done write");
  }
  assert.equal(typeof warned.value.warning, "string");
  assert.equal(readFileSync(join(advisoryFixture.ws, "doc.txt"), "utf8"), "advisory");
});

void test("OMP-01: close() stops the session without starting a process and is safe to call twice (P5-D7)", async (t) => {
  const fixture = makeDirs(t);
  const options = advisoryOptions(fixture);
  const handle = createRealmHandle(options);

  const first = await handle.close();
  assert.equal(first.state, "unbound");
  const second = await handle.close();
  assert.equal(second.state, "unbound");

  // Downcasts: the options held the fakes from construction, so the reads are exact.
  const exec = options.exec as FakeExecutionService;
  const bridge = options.bridge as FakeBridge;
  assert.deepEqual(exec.calls(), [], "close started no execution call");
  assert.deepEqual(exec.resources(), [], "close created no container");
  assert.deepEqual(bridge.calls(), [], "close made no bridge call");
});

void test("CR-01: createRealmHandle refuses a workspace outside every policy root with POLICY_DENIED before any dispatcher exists (D-22)", (t) => {
  const fixture = makeDirs(t);
  const outside = join(fixture.base, "outside");
  mkdirSync(outside);
  const excluded = {
    ...advisoryOptions(fixture),
    policyPath: writePolicy(fixture, "excluded-policy.json", { workspaceRoots: [outside] }),
  };
  const noRoots = { ...advisoryOptions(fixture), policyPath: join(fixture.base, "absent-policy.json") };
  for (const options of [excluded, noRoots]) {
    assert.throws(
      () => createRealmHandle(options),
      (error: unknown) => error instanceof RealmError && error.code === "POLICY_DENIED",
    );
  }
});

void test("MED-04: a pre-loaded policy is the policy the handle enforces, and policyPath is not read again (P5-D7)", (t) => {
  const fixture = makeDirs(t);
  const policy = loadPolicyFile(writePolicy(fixture, "loaded-policy.json", { workspaceRoots: [fixture.ws] }));
  // An unparseable file at policyPath would throw if the factory read it again.
  const corrupt = join(fixture.base, "corrupt-policy.json");
  writeFileSync(corrupt, "{ not json");

  const handle = createRealmHandle({ ...advisoryOptions(fixture), policyPath: corrupt, policy });
  assert.equal(handle.controller.snapshot().state, "unbound");
});

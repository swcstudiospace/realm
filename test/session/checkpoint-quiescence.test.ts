import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Policy } from "../../src/contract/validate.js";
import { type ErrorCode, RealmError } from "../../src/core/errors.js";
import { LockTable } from "../../src/fs/locks.js";
import { bindRoot, bindWorkspaceUnderPolicy } from "../../src/fs/root.js";
import { LifecycleController } from "../../src/lifecycle/controller.js";
import { restoreWorkspace, type SandboxRunning, snapshotWorkspace } from "../../src/session/checkpoint.js";
import { checkpointSessionDirOf, sessionIdOfWorkspace } from "../../src/session/paths.js";
import { SessionStore } from "../../src/session/store.js";
import { writeWorkspaceEntry, type WorkspaceEntry } from "../../src/session/workspace-registry.js";
import { FakeBridge } from "../support/fake-bridge.js";
import { FakeExecutionService } from "../support/fake-execution.js";

const CLOCK_TIME = "2026-11-03T09:00:00.000Z";
// The lock file name in a session's checkpoint directory (checkpoint-lock.ts).
const LOCK_FILE = ".lock";

function policyFor(workspace: string): Policy {
  return {
    mode: "advisory",
    workspaceRoots: [workspace],
    credentialAllow: [],
    egressAllow: [],
    shellEnabled: false,
    startupBudgetMs: 10000,
    toolQueueMs: 2000,
  };
}

interface Fixture {
  readonly ws: string;
  readonly state: string;
  readonly entry: WorkspaceEntry;
  readonly exec: FakeExecutionService;
  readonly controller: LifecycleController;
}

// Real directories under a temporary base, removed when the test ends. The controller and the checkpoint library share one
// state root and one session id, so they contend for the same lock file, as the daemon and the checkpoint CLI do.
function fixture(t: TestContext): Fixture {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "realm-quiesce-")));
  t.after(() => {
    rmSync(base, { recursive: true, force: true });
  });
  const ws = join(base, "ws");
  mkdirSync(ws);
  const state = join(base, "state");
  const sessionId = sessionIdOfWorkspace(ws);
  const entry = writeWorkspaceEntry(state, bindRoot(ws), sessionId);
  const exec = new FakeExecutionService();
  const controller = new LifecycleController({
    sessionId,
    policy: policyFor(ws),
    store: new SessionStore(state),
    exec,
    bridge: new FakeBridge(),
    clock: () => new Date(CLOCK_TIME),
    locks: new LockTable(),
    pinnedRoot: bindWorkspaceUnderPolicy([ws], ws),
  });
  return { ws, state, entry, exec, controller };
}

function lockFileOf(f: Fixture): string {
  return join(checkpointSessionDirOf(f.state, f.entry.sessionId), LOCK_FILE);
}

function codeIs(code: ErrorCode): (error: unknown) => boolean {
  return (error) => error instanceof RealmError && error.code === code;
}

// Snapshots a.txt as checkpoint c1, then changes it, so that a restore has a move to make.
async function checkpointOf(f: Fixture): Promise<void> {
  writeFileSync(join(f.ws, "a.txt"), "A-original");
  await snapshotWorkspace({ entry: f.entry, stateRoot: f.state, sandboxRunning: () => false, checkpointId: "c1" });
  writeFileSync(join(f.ws, "a.txt"), "A-now");
}

function restoreRequest(f: Fixture, sandboxRunning: SandboxRunning) {
  return { entry: f.entry, stateRoot: f.state, checkpointId: "c1", sandboxRunning };
}

void test("a restore is refused with LOCK_CONFLICT while an up holds the session lock, and the lock is released when the up completes", async (t) => {
  const f = fixture(t);
  await checkpointOf(f);
  let startReached: () => void = () => undefined;
  const inStart = new Promise<void>((resolve) => {
    startReached = resolve;
  });
  f.exec.beforeCall("start", () => {
    startReached();
  });
  const releaseStart = f.exec.holdNext("start");

  const creating = f.controller.create(f.ws);
  await inStart;
  assert.equal(existsSync(lockFileOf(f)), true, "the up holds the lock while its start is blocked");
  await assert.rejects(restoreWorkspace(restoreRequest(f, () => false)), codeIs("LOCK_CONFLICT"));

  releaseStart();
  assert.equal((await creating).state, "active");
  assert.equal(existsSync(lockFileOf(f)), false, "the lock file is gone once the up completes");
});

void test("an up is refused with REALM_NOT_ACTIVE while a checkpoint operation holds the session lock, and no start is issued", async (t) => {
  const f = fixture(t);
  await checkpointOf(f);
  let parkedAtCheck: () => void = () => undefined;
  const atCheck = new Promise<void>((resolve) => {
    parkedAtCheck = resolve;
  });
  let releaseCheck: (running: boolean) => void = () => undefined;
  const release = new Promise<boolean>((resolve) => {
    releaseCheck = resolve;
  });
  // beforeMove is synchronous, so it cannot hold a restore open. The restore is parked at its first sandbox check instead.
  // That check runs under the lock, before any move.
  let parked = false;
  const sandboxRunning: SandboxRunning = () => {
    if (parked) {
      return false;
    }
    parked = true;
    parkedAtCheck();
    return release;
  };
  const restoring = restoreWorkspace(restoreRequest(f, sandboxRunning));

  await atCheck;
  assert.equal(existsSync(lockFileOf(f)), true, "the restore holds the lock while it is parked");
  await assert.rejects(f.controller.create(f.ws), codeIs("REALM_NOT_ACTIVE"));
  assert.equal(f.exec.callCount("create"), 0, "no container is created");
  assert.equal(f.exec.callCount("start"), 0, "no start is issued");

  releaseCheck(false);
  await restoring;
  assert.equal(readFileSync(join(f.ws, "a.txt"), "utf8"), "A-original", "the restore completes");
  assert.equal(existsSync(lockFileOf(f)), false, "the lock file is gone once the restore completes");
});

void test("a start that fails leaves no lock file behind", async (t) => {
  const f = fixture(t);
  await checkpointOf(f);
  f.exec.failNext("start", "OPENSHELL_START_FAILED");

  const failed = await f.controller.create(f.ws);
  assert.equal(failed.state, "error");
  assert.equal(f.exec.callCount("start"), 1, "the start was issued and failed");
  assert.equal(existsSync(lockFileOf(f)), false, "the failed start released the lock");
  await restoreWorkspace(restoreRequest(f, () => false));
  assert.equal(readFileSync(join(f.ws, "a.txt"), "utf8"), "A-original", "a restore after the failed start is not refused");
});

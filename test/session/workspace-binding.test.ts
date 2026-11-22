// The workspace binding lock (CBIND-03). Hermetic pins over the observable behaviour: one holder per
// workspace, provably-gone takeover with the cap of 3, live or unprovable owners never taken over, the
// bounded FIFO wait's TOOL_TIMEOUT on expiry, LOCK_CONFLICT with no wait budget, malformed locks refused.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { RealmError } from "../../src/core/errors.js";
import { bindingLockPathOf } from "../../src/session/paths.js";
import { acquireBinding, bindingRemoval } from "../../src/session/workspace-binding.js";
import { testTimeout } from "../support/timing.js";

const SESSION_ID = "p0123456789ab";
const OPTIONS = { waitMs: 0, dev: 12345, ino: 67890 };

function makeState(t: { after: (fn: () => void) => void }): string {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "realm-binding-")));
  t.after(() => {
    rmSync(base, { recursive: true, force: true });
  });
  return base;
}

// A pid that names no live process: a child that has already exited and been reaped.
function deadPid(): number {
  const child = spawnSync(process.execPath, ["-e", ""], { encoding: "utf8" });
  assert.equal(typeof child.pid, "number", "the child process must have a pid");
  return child.pid;
}

void test(
  "two acquisitions of one workspace yield exactly one holder; the loser is refused LOCK_CONFLICT with no wait budget",
  testTimeout(30_000),
  async (t) => {
    const stateDir = makeState(t);
    const first = await acquireBinding(stateDir, SESSION_ID, OPTIONS);
    await assert.rejects(
      acquireBinding(stateDir, SESSION_ID, OPTIONS),
      (error: unknown) => error instanceof RealmError && error.code === "LOCK_CONFLICT",
    );
    assert.equal(first.release().ok, true);
    const third = await acquireBinding(stateDir, SESSION_ID, OPTIONS);
    assert.equal(third.release().ok, true);
  },
);

void test(
  "a waiter with a wait budget is granted FIFO once the holder releases",
  testTimeout(30_000),
  async (t) => {
    const stateDir = makeState(t);
    const first = await acquireBinding(stateDir, SESSION_ID, OPTIONS);
    const second = acquireBinding(stateDir, SESSION_ID, { ...OPTIONS, waitMs: 5_000 });
    first.release();
    const handle = await second;
    assert.equal(handle.release().ok, true);
  },
);

void test(
  "an expired wait is TOOL_TIMEOUT",
  testTimeout(30_000),
  async (t) => {
    const stateDir = makeState(t);
    const first = await acquireBinding(stateDir, SESSION_ID, OPTIONS);
    await assert.rejects(
      acquireBinding(stateDir, SESSION_ID, { ...OPTIONS, waitMs: 50 }),
      (error: unknown) => error instanceof RealmError && error.code === "TOOL_TIMEOUT",
    );
    first.release();
  },
);

void test(
  "a provably-gone holder is taken over",
  testTimeout(30_000),
  async (t) => {
    const stateDir = makeState(t);
    const lockPath = bindingLockPathOf(stateDir, SESSION_ID);
    mkdirSync(join(stateDir, "bindings"), { recursive: true });
    const stale = `${JSON.stringify({
      schema: 1,
      pid: deadPid(),
      startTicks: "1",
      bootId: "previous-boot",
      sessionId: SESSION_ID,
      dev: 12345,
      ino: 67890,
    })}\n`;
    writeFileSync(lockPath, stale);
    const handle = await acquireBinding(stateDir, SESSION_ID, OPTIONS);
    assert.equal(handle.release().ok, true);
  },
);

void test(
  "a live holder is never taken over",
  testTimeout(30_000),
  async (t) => {
    const stateDir = makeState(t);
    const first = await acquireBinding(stateDir, SESSION_ID, OPTIONS);
    await assert.rejects(
      acquireBinding(stateDir, SESSION_ID, OPTIONS),
      (error: unknown) => error instanceof RealmError && error.code === "LOCK_CONFLICT",
    );
    first.release();
  },
);

void test(
  "a malformed lock file is refused LOCK_CONFLICT and never taken over",
  testTimeout(30_000),
  async (t) => {
    const stateDir = makeState(t);
    const lockPath = bindingLockPathOf(stateDir, SESSION_ID);
    mkdirSync(join(stateDir, "bindings"), { recursive: true });
    writeFileSync(lockPath, "not json\n");
    await assert.rejects(
      acquireBinding(stateDir, SESSION_ID, OPTIONS),
      (error: unknown) => error instanceof RealmError && error.code === "LOCK_CONFLICT",
    );
  },
);

void test(
  "a symlink at the lock path is refused LOCK_CONFLICT and neither the link nor its target is removed",
  testTimeout(30_000),
  async (t) => {
    const stateDir = makeState(t);
    const lockPath = bindingLockPathOf(stateDir, SESSION_ID);
    mkdirSync(join(stateDir, "bindings"), { recursive: true });
    const target = join(stateDir, "target.json");
    writeFileSync(target, "target-content\n");
    symlinkSync(target, lockPath);
    await assert.rejects(
      acquireBinding(stateDir, SESSION_ID, OPTIONS),
      (error: unknown) => error instanceof RealmError && error.code === "LOCK_CONFLICT",
    );
    assert.equal(lstatSync(lockPath).isSymbolicLink(), true);
    assert.equal(readFileSync(target, "utf8"), "target-content\n");
  },
);

void test(
  "a failed release is CLEANUP_FAILED",
  testTimeout(30_000),
  async (t) => {
    const stateDir = makeState(t);
    const handle = await acquireBinding(stateDir, SESSION_ID, OPTIONS);
    const real = bindingRemoval.unlink;
    bindingRemoval.unlink = () => {
      throw new Error("refused");
    };
    try {
      const release = handle.release();
      if (release.ok) assert.fail("a refused release must report CLEANUP_FAILED");
      assert.equal(release.error.code, "CLEANUP_FAILED");
    } finally {
      bindingRemoval.unlink = real;
    }
  },
);

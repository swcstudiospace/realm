import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RealmError } from "../../src/core/errors.js";
import { acquireSessionLock, releaseSessionLock } from "../../src/session/checkpoint-lock.js";
import { testTimeout } from "../support/timing.js";

// A pid that names no live process: a child that has already exited and been reaped.
function deadPid(): number {
  const child = spawnSync(process.execPath, ["-e", ""], { encoding: "utf8" });
  assert.equal(typeof child.pid, "number", "the child process must have a pid");
  return child.pid;
}

void test(
  "a symlink at the lock path is refused with LOCK_CONFLICT and neither the link nor its target is removed",
  testTimeout(30_000),
  (t) => {
    const base = realpathSync(mkdtempSync(join(tmpdir(), "realm-lock-")));
    t.after(() => {
      rmSync(base, { recursive: true, force: true });
    });
    const sessionDir = join(base, "session");
    mkdirSync(sessionDir);
    // The target is a regular file whose owner record is provably gone: its boot differs from the running boot.
    const target = join(base, "owner-record.json");
    const record = `${JSON.stringify({ schema: 1, pid: deadPid(), startTicks: "1", bootId: "previous-boot" })}\n`;
    writeFileSync(target, record);
    const lockPath = join(sessionDir, ".lock");
    symlinkSync(target, lockPath);

    assert.throws(
      () => acquireSessionLock(sessionDir),
      (error) => error instanceof RealmError && error.code === "LOCK_CONFLICT",
    );

    assert.equal(readlinkSync(lockPath), target, "the symlink at the lock path must be left in place");
    assert.equal(readFileSync(target, "utf8"), record, "the symlink's target must be left in place");
  },
);

void test(
  "a regular lock file whose owner is provably gone is taken over by the acquisition",
  testTimeout(30_000),
  (t) => {
    const base = realpathSync(mkdtempSync(join(tmpdir(), "realm-lock-")));
    t.after(() => {
      rmSync(base, { recursive: true, force: true });
    });
    const sessionDir = join(base, "session");
    mkdirSync(sessionDir);
    const lockPath = join(sessionDir, ".lock");
    writeFileSync(
      lockPath,
      `${JSON.stringify({ schema: 1, pid: deadPid(), startTicks: "1", bootId: "previous-boot" })}\n`,
    );

    assert.equal(acquireSessionLock(sessionDir), lockPath);
    const written: unknown = JSON.parse(readFileSync(lockPath, "utf8"));
    assert.ok(typeof written === "object" && written !== null && "pid" in written && written.pid === process.pid, "the lock must now name this process");
    assert.deepEqual(releaseSessionLock(lockPath), { ok: true });
  },
);

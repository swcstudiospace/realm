import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RealmError, type ErrorCode } from "../../src/core/errors.js";
import { canonicalize } from "../../src/fs/canonicalize.js";
import { LockTable } from "../../src/fs/locks.js";
import { bindRoot, type PinnedRoot } from "../../src/fs/root.js";
import { lockedWrite } from "../../src/fs/write.js";

// Real files and symlinks under a temporary base. Nothing is mocked.
function tempBase(t: TestContext): string {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "realm-lock-")));
  t.after(() => {
    rmSync(base, { recursive: true, force: true });
  });
  return base;
}

function fixture(t: TestContext) {
  const base = tempBase(t);
  const ws = join(base, "ws");
  mkdirSync(ws);
  mkdirSync(join(ws, "sub"));
  writeFileSync(join(ws, "sub", "doc.txt"), "original");
  writeFileSync(join(ws, "real.txt"), "real");
  symlinkSync(join(ws, "real.txt"), join(ws, "alias.txt"));
  symlinkSync(join(ws, "sub"), join(ws, "dirlink"));
  return { base, ws, root: bindRoot(ws) };
}

function assertRejectsWith(action: () => unknown, code: ErrorCode): void {
  assert.throws(action, (error: unknown) => error instanceof RealmError && error.code === code);
}

// The canonical real path a lock is keyed by, reached through the canonicalizer.
function realPathOf(root: PinnedRoot, relPath: string): string {
  const resolved = canonicalize(root, relPath, { mode: "read" });
  if (resolved.status !== "found") {
    throw new Error(`expected ${relPath} to exist`);
  }
  return resolved.realPath;
}

test("a conflicting owner gets LOCK_CONFLICT and the file stays byte-identical (FS-04)", (t) => {
  const { ws, root } = fixture(t);
  const locks = new LockTable();
  locks.acquire(realPathOf(root, "sub/doc.txt"), "A");

  assertRejectsWith(() => locks.acquire(realPathOf(root, "sub/doc.txt"), "B"), "LOCK_CONFLICT");
  assertRejectsWith(
    () => lockedWrite(root, "sub/doc.txt", "from B", { owner: "B", locks, credentialAllow: [] }),
    "LOCK_CONFLICT",
  );
  assert.equal(readFileSync(join(ws, "sub", "doc.txt"), "utf8"), "original");
});

test("same-owner re-acquire is idempotent and returns the same handle (FS-04)", (t) => {
  const { root } = fixture(t);
  const locks = new LockTable();
  const path = realPathOf(root, "sub/doc.txt");
  const first = locks.acquire(path, "A");
  const second = locks.acquire(path, "A");
  assert.equal(second, first);
});

test("a locked write by the lock's own owner keeps the lock it took before (FS-04)", (t) => {
  const { ws, root } = fixture(t);
  const locks = new LockTable();
  const path = realPathOf(root, "sub/doc.txt");
  locks.acquire(path, "A");

  lockedWrite(root, "sub/doc.txt", "by A", { owner: "A", locks, credentialAllow: [] });

  assert.equal(readFileSync(join(ws, "sub", "doc.txt"), "utf8"), "by A");
  assertRejectsWith(() => locks.acquire(path, "B"), "LOCK_CONFLICT");
});

test("release is idempotent and frees the path for another owner (FS-04)", (t) => {
  const { root } = fixture(t);
  const locks = new LockTable();
  const path = realPathOf(root, "sub/doc.txt");
  const handle = locks.acquire(path, "A");
  locks.release(handle);
  locks.release(handle);
  assert.equal(locks.acquire(path, "B").owner, "B");
});

test("a stale handle cannot release a lock another owner now holds (FS-04)", (t) => {
  const { root } = fixture(t);
  const locks = new LockTable();
  const path = realPathOf(root, "sub/doc.txt");
  const stale = locks.acquire(path, "A");
  locks.release(stale);
  const current = locks.acquire(path, "B");

  locks.release(stale);

  assert.equal(current.owner, "B");
  assertRejectsWith(() => locks.acquire(path, "C"), "LOCK_CONFLICT");
  locks.release(current);
});

test("a second owner reaching the same file through a file symlink conflicts (FS-04)", (t) => {
  const { root } = fixture(t);
  const locks = new LockTable();
  locks.acquire(realPathOf(root, "real.txt"), "A");
  assertRejectsWith(() => locks.acquire(realPathOf(root, "alias.txt"), "B"), "LOCK_CONFLICT");
});

test("a second owner writing through a directory symlink conflicts and the file is unchanged (FS-04)", (t) => {
  const { ws, root } = fixture(t);
  const locks = new LockTable();
  locks.acquire(realPathOf(root, "sub/doc.txt"), "A");
  assertRejectsWith(
    () => lockedWrite(root, "dirlink/doc.txt", "via alias", { owner: "B", locks, credentialAllow: [] }),
    "LOCK_CONFLICT",
  );
  assert.equal(readFileSync(join(ws, "sub", "doc.txt"), "utf8"), "original");
});

test("releasing an owner's locks frees every path it held (FS-04, D-33)", (t) => {
  const { root } = fixture(t);
  const locks = new LockTable();
  locks.acquire(realPathOf(root, "real.txt"), "session-1");
  locks.acquire(realPathOf(root, "sub/doc.txt"), "session-1");

  locks.releaseOwner("session-1");

  assert.equal(locks.acquire(realPathOf(root, "real.txt"), "session-2").owner, "session-2");
  assert.equal(locks.acquire(realPathOf(root, "sub/doc.txt"), "session-2").owner, "session-2");
});

test("locks live in memory and acquire and release create no file (FS-04)", (t) => {
  const { base, ws, root } = fixture(t);
  const before = [readdirSync(base).sort(), readdirSync(ws).sort()];
  const locks = new LockTable();
  const handle = locks.acquire(realPathOf(root, "sub/doc.txt"), "A");
  locks.release(handle);
  assert.deepEqual([readdirSync(base).sort(), readdirSync(ws).sort()], before);
});

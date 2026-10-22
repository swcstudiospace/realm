import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  existsSync,
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
import { LockTable } from "../../src/fs/locks.js";
import { bindRoot } from "../../src/fs/root.js";
import { lockedWrite } from "../../src/fs/write.js";

// Real files and symlinks under a temporary base. Nothing is mocked.
function tempBase(t: TestContext): string {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "realm-write-")));
  t.after(() => {
    rmSync(base, { recursive: true, force: true });
  });
  return base;
}

function fixture(t: TestContext) {
  const base = tempBase(t);
  const ws = join(base, "ws");
  const outside = join(base, "outside");
  mkdirSync(ws);
  mkdirSync(outside);
  mkdirSync(join(ws, "sub"));
  writeFileSync(join(ws, "doc.txt"), "original");
  writeFileSync(join(ws, "real.txt"), "real");
  symlinkSync(join(ws, "real.txt"), join(ws, "link.txt"));
  symlinkSync(outside, join(ws, "out"));
  return { base, ws, outside, root: bindRoot(ws) };
}

function assertRejectsWith(action: () => unknown, code: ErrorCode): void {
  assert.throws(action, (error: unknown) => error instanceof RealmError && error.code === code);
}

function sha256Of(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

// Leftover atomic-write temp files in a directory. Must be empty after every write.
function tempFiles(dir: string): string[] {
  return readdirSync(dir).filter((name) => name.includes(".realm-tmp-"));
}

void test("a matching ifMatchSha256 lets the write replace the content and returns the new hash (D-34, FS-04)", (t) => {
  const { ws, root } = fixture(t);
  const result = lockedWrite(root, "doc.txt", "updated", {
    owner: "A",
    locks: new LockTable(),
    credentialAllow: [],
    ifMatchSha256: sha256Of("original"),
  });
  assert.equal(readFileSync(join(ws, "doc.txt"), "utf8"), "updated");
  assert.equal(result.sha256, sha256Of("updated"));
  assert.deepEqual(tempFiles(ws), []);
});

void test("an ifMatchSha256 that differs from the observed hash is LOCK_CONFLICT and the file is unchanged (D-34)", (t) => {
  const { ws, root } = fixture(t);
  assertRejectsWith(
    () =>
      lockedWrite(root, "doc.txt", "updated", {
        owner: "A",
        locks: new LockTable(),
        credentialAllow: [],
        ifMatchSha256: sha256Of("stale"),
      }),
    "LOCK_CONFLICT",
  );
  assert.equal(readFileSync(join(ws, "doc.txt"), "utf8"), "original");
  assert.deepEqual(tempFiles(ws), []);
});

void test("an ifMatchSha256 against an absent target is LOCK_CONFLICT and creates nothing (D-34)", (t) => {
  const { ws, root } = fixture(t);
  assertRejectsWith(
    () =>
      lockedWrite(root, "new.txt", "created", {
        owner: "A",
        locks: new LockTable(),
        credentialAllow: [],
        ifMatchSha256: sha256Of("anything"),
      }),
    "LOCK_CONFLICT",
  );
  assert.equal(existsSync(join(ws, "new.txt")), false);
});

void test("an absent target is created when no ifMatchSha256 is given (D-34)", (t) => {
  const { ws, root } = fixture(t);
  lockedWrite(root, "new.txt", "created", { owner: "A", locks: new LockTable(), credentialAllow: [] });
  assert.equal(readFileSync(join(ws, "new.txt"), "utf8"), "created");
});

void test("a non-cooperating writer between observation and rename is caught: LOCK_CONFLICT and the file is unchanged (D-34, D-35)", (t) => {
  const { ws, root } = fixture(t);
  const locks = new LockTable();
  assertRejectsWith(
    () =>
      lockedWrite(root, "doc.txt", "from A", {
        owner: "A",
        locks,
        credentialAllow: [],
        stageHook: (stage) => {
          if (stage === "after-temp-write") {
            writeFileSync(join(ws, "doc.txt"), "interloper");
          }
        },
      }),
    "LOCK_CONFLICT",
  );
  assert.equal(readFileSync(join(ws, "doc.txt"), "utf8"), "interloper");
  assert.deepEqual(tempFiles(ws), []);
  assert.equal(locks.acquire(join(ws, "doc.txt"), "B").owner, "B");
});

void test("a lock held by another owner is LOCK_CONFLICT, the file is unchanged, and the other owner keeps the lock (D-34, FS-04)", (t) => {
  const { ws, root } = fixture(t);
  const locks = new LockTable();
  const otherHandle = locks.acquire(join(ws, "doc.txt"), "B");
  assertRejectsWith(
    () => lockedWrite(root, "doc.txt", "from A", { owner: "A", locks, credentialAllow: [] }),
    "LOCK_CONFLICT",
  );
  assert.equal(readFileSync(join(ws, "doc.txt"), "utf8"), "original");
  assertRejectsWith(() => locks.acquire(join(ws, "doc.txt"), "A"), "LOCK_CONFLICT");
  locks.release(otherHandle);
});

void test("a failed write releases the lock it took, in its finally (D-34)", (t) => {
  const { ws, root } = fixture(t);
  const locks = new LockTable();
  assertRejectsWith(
    () =>
      lockedWrite(root, "doc.txt", "updated", {
        owner: "A",
        locks,
        credentialAllow: [],
        ifMatchSha256: sha256Of("stale"),
      }),
    "LOCK_CONFLICT",
  );
  assert.equal(locks.acquire(join(ws, "doc.txt"), "B").owner, "B");
});

void test("a successful write releases the lock it took (D-34)", (t) => {
  const { ws, root } = fixture(t);
  const locks = new LockTable();
  lockedWrite(root, "doc.txt", "updated", { owner: "A", locks, credentialAllow: [] });
  assert.equal(locks.acquire(join(ws, "doc.txt"), "B").owner, "B");
});

void test("a stage-hook failure through the locked write reports WRITE_NOT_ATOMIC, keeps the original, and releases the lock (D-34, D-35)", (t) => {
  const { ws, root } = fixture(t);
  const locks = new LockTable();
  assertRejectsWith(
    () =>
      lockedWrite(root, "doc.txt", "updated", {
        owner: "A",
        locks,
        credentialAllow: [],
        stageHook: (stage) => {
          if (stage === "before-rename") {
            throw new Error("injected fault");
          }
        },
      }),
    "WRITE_NOT_ATOMIC",
  );
  assert.equal(readFileSync(join(ws, "doc.txt"), "utf8"), "original");
  assert.deepEqual(tempFiles(ws), []);
  assert.equal(locks.acquire(join(ws, "doc.txt"), "B").owner, "B");
});

void test("a symlink at the target is PATH_ESCAPE and writes nothing (D-34 step 1)", (t) => {
  const { ws, root } = fixture(t);
  assertRejectsWith(
    () => lockedWrite(root, "link.txt", "x", { owner: "A", locks: new LockTable(), credentialAllow: [] }),
    "PATH_ESCAPE",
  );
  assert.equal(readFileSync(join(ws, "real.txt"), "utf8"), "real");
});

void test("a target reached through an escaping directory symlink is PATH_ESCAPE and creates nothing outside (FS-01, D-34)", (t) => {
  const { outside, root } = fixture(t);
  assertRejectsWith(
    () => lockedWrite(root, "out/new.txt", "x", { owner: "A", locks: new LockTable(), credentialAllow: [] }),
    "PATH_ESCAPE",
  );
  assert.equal(existsSync(join(outside, "new.txt")), false);
});

void test("a missing parent directory is PATH_ESCAPE and creates nothing (D-34 step 1)", (t) => {
  const { ws, root } = fixture(t);
  assertRejectsWith(
    () => lockedWrite(root, "nope/new.txt", "x", { owner: "A", locks: new LockTable(), credentialAllow: [] }),
    "PATH_ESCAPE",
  );
  assert.equal(existsSync(join(ws, "nope")), false);
});

void test("a directory at the target is PATH_ESCAPE and the lock taken for it is released (D-34)", (t) => {
  const { ws, root } = fixture(t);
  const locks = new LockTable();
  assertRejectsWith(
    () => lockedWrite(root, "sub", "x", { owner: "A", locks, credentialAllow: [] }),
    "PATH_ESCAPE",
  );
  assert.equal(locks.acquire(join(ws, "sub"), "B").owner, "B");
});

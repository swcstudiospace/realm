// Race rejection on real fixtures (D-30, FS-02). The swap is driven through the
// resolve-to-open hook (onResolveBoundary), which runs after the path is resolved and before
// it is opened.
//
// Residual risk Q-2, recorded and not closed: Node 22 has no openat, so a parent directory
// swapped between verification and rename(2) cannot be excluded with path-based APIs. The
// parent re-check immediately before rename narrows that window; it does not close it. The
// Phase 7 security review owns the verdict.

import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { RealmError } from "../../src/core/errors.js";
import { readFileCapped, type ReadFound, type ReadResult } from "../../src/fs/read.js";
import { bindRoot } from "../../src/fs/root.js";

function tempBase(t: TestContext): string {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "realm-toctou-")));
  t.after(() => {
    rmSync(base, { recursive: true, force: true });
  });
  return base;
}

function expectFound(result: ReadResult): ReadFound {
  if (result.status !== "found") {
    throw new Error("expected a found read");
  }
  return result;
}

function assertPathEscape(action: () => unknown): void {
  assert.throws(
    action,
    (error: unknown) => error instanceof RealmError && error.code === "PATH_ESCAPE",
  );
}

test("a symlink swapped in at the resolve-to-open boundary is rejected with PATH_ESCAPE (FS-02)", (t) => {
  const base = tempBase(t);
  const ws = join(base, "ws");
  const outside = join(base, "outside");
  mkdirSync(ws);
  mkdirSync(outside);
  writeFileSync(join(ws, "doc.txt"), "inside");
  writeFileSync(join(outside, "secret.txt"), "outside secret");
  const root = bindRoot(ws);

  const swapForSymlink = (realPath: string): void => {
    unlinkSync(realPath);
    symlinkSync(join(outside, "secret.txt"), realPath);
  };

  assertPathEscape(() =>
    readFileCapped(root, "doc.txt", { maxBytes: 4096, credentialAllow: [], onResolveBoundary: swapForSymlink }),
  );
});

test("a directory on the resolved path swapped for an escaping symlink is caught by the /proc/self/fd check (FS-02, D-30)", (t) => {
  const base = tempBase(t);
  const ws = join(base, "ws");
  const outside = join(base, "outside");
  mkdirSync(join(ws, "dir"), { recursive: true });
  mkdirSync(outside);
  writeFileSync(join(ws, "dir", "doc.txt"), "inside");
  writeFileSync(join(outside, "doc.txt"), "outside");
  const root = bindRoot(ws);

  // Swapping the intermediate directory redirects the open, but the descriptor still
  // matches lstat of the resolved path. Only readlink of /proc/self/fd exposes it.
  const swapDirectory = (realPath: string): void => {
    const dirPath = dirname(realPath);
    renameSync(dirPath, join(ws, "dir-moved"));
    symlinkSync(outside, dirPath);
  };

  assertPathEscape(() =>
    readFileCapped(root, "dir/doc.txt", { maxBytes: 4096, credentialAllow: [], onResolveBoundary: swapDirectory }),
  );
});

test("without /proc/self/fd the verified read fails closed with PATH_ESCAPE and is never skipped (FS-02, D-30)", (t) => {
  const base = tempBase(t);
  const ws = join(base, "ws");
  mkdirSync(ws);
  writeFileSync(join(ws, "doc.txt"), "inside");
  const root = bindRoot(ws);
  const absentProc = join(base, "no-proc-fd");

  assertPathEscape(() =>
    readFileCapped(root, "doc.txt", { maxBytes: 4096, credentialAllow: [], procFdDir: absentProc }),
  );
});

test("the same read succeeds with /proc/self/fd present, so the failure above comes from the missing directory alone (FS-02)", (t) => {
  const base = tempBase(t);
  const ws = join(base, "ws");
  mkdirSync(ws);
  writeFileSync(join(ws, "doc.txt"), "inside");
  const root = bindRoot(ws);

  const found = expectFound(readFileCapped(root, "doc.txt", { maxBytes: 4096, credentialAllow: [] }));
  assert.equal(Buffer.from(found.content).toString("utf8"), "inside");
});

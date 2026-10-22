import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RealmError } from "../../src/core/errors.js";
import { assertSameRoot, bindRoot, bindWorkspaceUnderPolicy } from "../../src/fs/root.js";

// Real directories under a temporary base. Nothing is mocked: the directories and the
// symbolic link are created on disk, and the base is removed when the test ends.
function fixture(t: TestContext) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "realm-root-")));
  t.after(() => {
    rmSync(base, { recursive: true, force: true });
  });
  const ws = join(base, "ws");
  const sibling = join(base, "ws2");
  const outside = join(base, "outside");
  mkdirSync(ws);
  mkdirSync(join(ws, "inner"));
  mkdirSync(sibling);
  mkdirSync(outside);
  return { base, ws, sibling, outside, inner: join(ws, "inner") };
}

function assertDenied(action: () => unknown): void {
  assert.throws(
    action,
    (error: unknown) => error instanceof RealmError && error.code === "POLICY_DENIED",
  );
}

test("bindWorkspaceUnderPolicy accepts a directory inside a policy root and returns its real path (D-22)", (t) => {
  const { ws, inner } = fixture(t);
  const bound = bindWorkspaceUnderPolicy([ws], inner);
  assert.equal(bound.realPath, inner);
});

test("bindWorkspaceUnderPolicy refuses a relative path with POLICY_DENIED (D-22)", (t) => {
  const { ws } = fixture(t);
  assertDenied(() => bindWorkspaceUnderPolicy([ws], "ws/inner"));
});

test("bindWorkspaceUnderPolicy refuses a path outside every policy root with POLICY_DENIED (D-22)", (t) => {
  const { ws, outside } = fixture(t);
  assertDenied(() => bindWorkspaceUnderPolicy([ws], outside));
});

test("bindWorkspaceUnderPolicy refuses a sibling whose name starts with a policy root name (D-22)", (t) => {
  const { ws, sibling } = fixture(t);
  assert.ok(sibling.startsWith(ws), "the sibling name must share the root name as a prefix");
  assertDenied(() => bindWorkspaceUnderPolicy([ws], sibling));
});

test("bindWorkspaceUnderPolicy refuses a symbolic link that escapes the policy root (D-22)", (t) => {
  const { ws, outside } = fixture(t);
  const escape = join(ws, "escape");
  symlinkSync(outside, escape, "dir");
  assertDenied(() => bindWorkspaceUnderPolicy([ws], escape));
});

test("bindWorkspaceUnderPolicy refuses when any policy root cannot be canonicalized (D-22)", (t) => {
  const { base, ws, inner } = fixture(t);
  assertDenied(() => bindWorkspaceUnderPolicy([ws, join(base, "missing")], inner));
});

test("assertSameRoot passes when the path still names the directory pinned earlier (D-22)", (t) => {
  const { ws } = fixture(t);
  const pinned = bindRoot(ws);
  const current = bindRoot(ws);
  assert.equal(current.dev, pinned.dev);
  assert.equal(current.ino, pinned.ino);
  assert.doesNotThrow(() => {
    assertSameRoot(pinned, current);
  });
});

test("assertSameRoot throws POLICY_DENIED after the directory at the path is replaced (D-22)", (t) => {
  const { base, ws } = fixture(t);
  const pinned = bindRoot(ws);
  renameSync(ws, join(base, "ws-old"));
  mkdirSync(ws);
  const replaced = bindRoot(ws);
  assertDenied(() => {
    assertSameRoot(pinned, replaced);
  });
});

import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RealmError } from "../../src/core/errors.js";
import { bindRoot, bindWorkspaceUnderPolicy, verifyPinnedAt } from "../../src/fs/root.js";

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

void test("bindWorkspaceUnderPolicy accepts a directory inside a policy root and returns its real path (D-22)", (t) => {
  const { ws, inner } = fixture(t);
  const bound = bindWorkspaceUnderPolicy([ws], inner);
  assert.equal(bound.realPath, inner);
});

void test("bindWorkspaceUnderPolicy refuses a relative path with POLICY_DENIED (D-22)", (t) => {
  const { ws } = fixture(t);
  assertDenied(() => bindWorkspaceUnderPolicy([ws], "ws/inner"));
});

void test("bindWorkspaceUnderPolicy refuses a path outside every policy root with POLICY_DENIED (D-22)", (t) => {
  const { ws, outside } = fixture(t);
  assertDenied(() => bindWorkspaceUnderPolicy([ws], outside));
});

void test("bindWorkspaceUnderPolicy refuses a sibling whose name starts with a policy root name (D-22)", (t) => {
  const { ws, sibling } = fixture(t);
  assert.ok(sibling.startsWith(ws), "the sibling name must share the root name as a prefix");
  assertDenied(() => bindWorkspaceUnderPolicy([ws], sibling));
});

void test("bindWorkspaceUnderPolicy refuses a symbolic link that escapes the policy root (D-22)", (t) => {
  const { ws, outside } = fixture(t);
  const escape = join(ws, "escape");
  symlinkSync(outside, escape, "dir");
  assertDenied(() => bindWorkspaceUnderPolicy([ws], escape));
});

void test("bindWorkspaceUnderPolicy refuses when any policy root cannot be canonicalized (D-22)", (t) => {
  const { base, ws, inner } = fixture(t);
  assertDenied(() => bindWorkspaceUnderPolicy([ws, join(base, "missing")], inner));
});

void test("bindWorkspaceUnderPolicy refuses every path when the policy has no workspace roots (D-21, D-22)", (t) => {
  const { ws, inner } = fixture(t);
  assertDenied(() => bindWorkspaceUnderPolicy([], inner));
  assertDenied(() => bindWorkspaceUnderPolicy([], ws));
});

void test("verifyPinnedAt returns the pinned root when the path still names the directory pinned earlier (D-22, FS-02)", (t) => {
  const { ws } = fixture(t);
  const pinned = bindRoot(ws);
  assert.equal(verifyPinnedAt(pinned, ws), pinned);
});

void test("verifyPinnedAt accepts the pinned directory reached through a symbolic link to its real path (FS-02)", (t) => {
  const { base, ws } = fixture(t);
  const pinned = bindRoot(ws);
  const alias = join(base, "alias");
  symlinkSync(ws, alias, "dir");
  assert.equal(verifyPinnedAt(pinned, alias), pinned);
});

void test("verifyPinnedAt throws POLICY_DENIED after the directory at the path is replaced (D-22, FS-02)", (t) => {
  const { base, ws } = fixture(t);
  const pinned = bindRoot(ws);
  renameSync(ws, join(base, "ws-old"));
  mkdirSync(ws);
  assertDenied(() => verifyPinnedAt(pinned, ws));
});

void test("verifyPinnedAt throws POLICY_DENIED when the pinned directory moved and a link now sits at its path (FS-02)", (t) => {
  const { base, ws } = fixture(t);
  const pinned = bindRoot(ws);
  const moved = join(base, "ws-moved");
  renameSync(ws, moved);
  symlinkSync(moved, ws, "dir");
  assertDenied(() => verifyPinnedAt(pinned, ws));
});

void test("verifyPinnedAt throws POLICY_DENIED for a relative path and for a path that is not a directory (FS-02)", (t) => {
  const { ws } = fixture(t);
  const pinned = bindRoot(ws);
  const file = join(ws, "plain.txt");
  writeFileSync(file, "not a directory");
  assertDenied(() => verifyPinnedAt(pinned, "ws"));
  assertDenied(() => verifyPinnedAt(pinned, file));
});

// The shared path guards. Each export has its accepted case, its refusal and its edge cases. Filesystem cases run in a temporary
// directory that is removed afterwards, whether the case passes or fails.

import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { RealmError } from "../../../src/core/errors.js";
import {
  assertStrictlyInside,
  isInsideInclusive,
  isStrictlyInside,
  lstatOrAbsent,
  realPathOrRefuse,
} from "../../../src/runtime/driver/fs-guards.js";

// Matches a thrown RealmError carrying the given catalogue code.
function isCode(code: string): (error: unknown) => boolean {
  return (error: unknown) => error instanceof RealmError && error.code === code;
}

// Runs body with a fresh real temporary directory, removed afterwards whether body returns or throws.
function withTempDir<T>(body: (dir: string) => T): T {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "fs-guards-")));
  try {
    return body(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

void test("isInsideInclusive: the root itself is inside", () => {
  assert.equal(isInsideInclusive("/a/b", "/a/b"), true);
});

void test("isInsideInclusive: a descendant at any depth is inside", () => {
  assert.equal(isInsideInclusive("/a/b", "/a/b/c"), true);
  assert.equal(isInsideInclusive("/a/b", "/a/b/c/d/e"), true);
});

void test("isInsideInclusive: a sibling that shares a name prefix is refused", () => {
  assert.equal(isInsideInclusive("/a/b", "/a/bc"), false);
  assert.equal(isInsideInclusive("/a/b", "/a/b-other/x"), false);
});

void test("isInsideInclusive: an ancestor and an unrelated path are refused", () => {
  assert.equal(isInsideInclusive("/a/b", "/a"), false);
  assert.equal(isInsideInclusive("/a/b", "/x/y"), false);
});

void test("isInsideInclusive: a filesystem root contains every absolute path, itself included", () => {
  assert.equal(isInsideInclusive("/", "/"), true);
  assert.equal(isInsideInclusive("/", "/anything/at/all"), true);
});

void test("isStrictlyInside: the root itself is refused", () => {
  assert.equal(isStrictlyInside("/a/b", "/a/b"), false);
});

void test("isStrictlyInside: a descendant at any depth is accepted", () => {
  assert.equal(isStrictlyInside("/a/b", "/a/b/c"), true);
  assert.equal(isStrictlyInside("/a/b", "/a/b/c/d/e"), true);
});

void test("isStrictlyInside: a ../ escape is refused", () => {
  assert.equal(isStrictlyInside("/a/b", "/a/c"), false);
  assert.equal(isStrictlyInside("/a/b", "/a"), false);
  assert.equal(isStrictlyInside("/a/b", "/x"), false);
});

void test("isStrictlyInside: a sibling that shares a name prefix is refused", () => {
  assert.equal(isStrictlyInside("/a/b", "/a/bc"), false);
});

void test("isStrictlyInside: a child whose name begins with dots is accepted, since it is not an escape", () => {
  assert.equal(isStrictlyInside("/a/b", "/a/b/..x"), true);
  assert.equal(isStrictlyInside("/a/b", "/a/b/.hidden"), true);
});

void test("isStrictlyInside: a filesystem root contains its descendants but not itself", () => {
  assert.equal(isStrictlyInside("/", "/"), false);
  assert.equal(isStrictlyInside("/", "/x"), true);
});

void test("assertStrictlyInside: a target strictly inside root is accepted", () => {
  withTempDir((dir) => {
    const root = join(dir, "root");
    assert.doesNotThrow(() => { assertStrictlyInside(join(root, "child"), root); });
    assert.doesNotThrow(() => { assertStrictlyInside(join(root, "a", "b"), root); });
  });
});

void test("assertStrictlyInside: a target equal to the root is refused with SCHEMA_INVALID", () => {
  withTempDir((dir) => {
    const root = join(dir, "root");
    assert.throws(() => { assertStrictlyInside(root, root); }, isCode("SCHEMA_INVALID"));
    assert.throws(() => { assertStrictlyInside(root + sep, root); }, isCode("SCHEMA_INVALID"));
  });
});

void test("assertStrictlyInside: a ../ escape from root is refused with SCHEMA_INVALID", () => {
  withTempDir((dir) => {
    const root = join(dir, "root");
    assert.throws(() => { assertStrictlyInside(join(root, "..", "elsewhere"), root); }, isCode("SCHEMA_INVALID"));
  });
});

void test("assertStrictlyInside: a sibling that shares the root's name prefix is refused with SCHEMA_INVALID", () => {
  withTempDir((dir) => {
    const root = join(dir, "root");
    assert.throws(() => { assertStrictlyInside(join(dir, "rooted", "x"), root); }, isCode("SCHEMA_INVALID"));
  });
});

void test("assertStrictlyInside: both paths are resolved before the check", () => {
  withTempDir((dir) => {
    const root = join(dir, "root");
    // Raw strings keep the ".." segments: path.join would normalize them before the guard ever sees them.
    // A spelled-out ".." that still lands inside root is accepted.
    assert.doesNotThrow(() => { assertStrictlyInside(`${root}${sep}sub${sep}..${sep}x`, root); });
    // A spelled-out ".." that lands on the root itself is refused.
    assert.throws(() => { assertStrictlyInside(`${root}${sep}..${sep}root`, root); }, isCode("SCHEMA_INVALID"));
    // A root spelled with a ".." segment is resolved to the real root before the check.
    assert.doesNotThrow(() => { assertStrictlyInside(join(root, "x"), `${root}${sep}sub${sep}..`); });
    // A root spelled with a ".." segment is resolved, so a target equal to the real root is refused.
    assert.throws(() => { assertStrictlyInside(root, `${root}${sep}sub${sep}..`); }, isCode("SCHEMA_INVALID"));
  });
});

void test("realPathOrRefuse: an existing directory returns its real path", () => {
  withTempDir((dir) => {
    const real = join(dir, "real");
    mkdirSync(real);
    assert.equal(realPathOrRefuse(real), real);
  });
});

void test("realPathOrRefuse: a symbolic link resolves to its target", () => {
  withTempDir((dir) => {
    const real = join(dir, "real");
    const link = join(dir, "link");
    mkdirSync(real);
    symlinkSync(real, link);
    assert.equal(realPathOrRefuse(link), real);
  });
});

void test("realPathOrRefuse: a missing path is refused with SCHEMA_INVALID", () => {
  withTempDir((dir) => {
    assert.throws(() => realPathOrRefuse(join(dir, "no-such-entry")), isCode("SCHEMA_INVALID"));
  });
});

void test("realPathOrRefuse: a dangling symbolic link is refused with SCHEMA_INVALID", () => {
  withTempDir((dir) => {
    const link = join(dir, "dangling");
    symlinkSync(join(dir, "missing-target"), link);
    assert.throws(() => realPathOrRefuse(link), isCode("SCHEMA_INVALID"));
  });
});

void test("realPathOrRefuse: the refusal text does not contain the path", () => {
  withTempDir((dir) => {
    const missing = join(dir, "no-such-entry");
    assert.throws(() => realPathOrRefuse(missing), (error: unknown) => {
      assert.ok(error instanceof RealmError);
      assert.equal(error.code, "SCHEMA_INVALID");
      assert.equal(error.message.includes(missing), false);
      assert.equal(error.message.includes(dir), false);
      assert.equal(error.message.includes("no-such-entry"), false);
      return true;
    });
  });
});

void test("lstatOrAbsent: a missing path returns null", () => {
  withTempDir((dir) => {
    assert.equal(lstatOrAbsent(join(dir, "no-such-entry"), "SCHEMA_INVALID"), null);
  });
});

void test("lstatOrAbsent: an existing directory returns its stats", () => {
  withTempDir((dir) => {
    const real = join(dir, "real");
    mkdirSync(real);
    const stats = lstatOrAbsent(real, "SCHEMA_INVALID");
    assert.ok(stats !== null && stats.isDirectory());
  });
});

void test("lstatOrAbsent: a dangling symbolic link is reported as a link, not followed and not treated as missing", () => {
  withTempDir((dir) => {
    const link = join(dir, "dangling");
    symlinkSync(join(dir, "missing-target"), link);
    const stats = lstatOrAbsent(link, "SCHEMA_INVALID");
    assert.ok(stats !== null && stats.isSymbolicLink());
  });
});

void test("lstatOrAbsent: a failure other than ENOENT throws the given code, whichever code is given", () => {
  withTempDir((dir) => {
    // A path under a regular file fails with ENOTDIR, which is not a missing entry.
    const file = join(dir, "file");
    writeFileSync(file, "x");
    const under = join(file, "child");
    assert.throws(() => lstatOrAbsent(under, "PATH_ESCAPE"), isCode("PATH_ESCAPE"));
    assert.throws(() => lstatOrAbsent(under, "SCHEMA_INVALID"), isCode("SCHEMA_INVALID"));
  });
});

void test("lstatOrAbsent: the refusal text does not contain the path", () => {
  withTempDir((dir) => {
    const file = join(dir, "file");
    writeFileSync(file, "x");
    const under = join(file, "child");
    assert.throws(() => lstatOrAbsent(under, "PATH_ESCAPE"), (error: unknown) => {
      assert.ok(error instanceof RealmError);
      assert.equal(error.message.includes(under), false);
      assert.equal(error.message.includes(dir), false);
      return true;
    });
  });
});

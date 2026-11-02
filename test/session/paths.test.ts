import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RealmError } from "../../src/core/errors.js";
import { GATEWAY_SANDBOX_NAME_MAX_LENGTH } from "../../src/runtime/openshell.js";
import {
  isSessionId,
  sandboxNameOfSession,
  sessionIdOfWorkspace,
  WORKSPACE_ID_HEX_LENGTH,
  WORKSPACE_SESSION_PREFIX,
} from "../../src/session/paths.js";

// Real directories under a temporary base, removed when the test ends. Nothing is mocked.
function fixture(t: TestContext): { base: string; project: string; other: string; alias: string } {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "realm-paths-")));
  t.after(() => {
    rmSync(base, { recursive: true, force: true });
  });
  const project = join(base, "project");
  const other = join(base, "other");
  const alias = join(base, "alias");
  mkdirSync(project);
  mkdirSync(other);
  symlinkSync(project, alias, "dir");
  return { base, project, other, alias };
}

function assertRejectsWith(action: () => unknown, code: string): void {
  assert.throws(action, (error: unknown) => error instanceof RealmError && error.code === code);
}

void test("two aliases of one directory give one id once canonicalized (MULTI-02, C1)", (t) => {
  const { project, alias } = fixture(t);
  const fromAlias = sessionIdOfWorkspace(realpathSync(alias));
  const fromDirectory = sessionIdOfWorkspace(realpathSync(project));
  assert.equal(fromAlias, fromDirectory);
  assert.equal(fromDirectory, sessionIdOfWorkspace(project));
});

void test("two different directories give two different ids (MULTI-02, C1)", (t) => {
  const { project, other } = fixture(t);
  assert.notEqual(sessionIdOfWorkspace(project), sessionIdOfWorkspace(other));
});

void test("the id is the prefix plus twelve hex characters, matches isSessionId and has length 13 (C1)", (t) => {
  const { project } = fixture(t);
  const id = sessionIdOfWorkspace(project);
  assert.equal(WORKSPACE_SESSION_PREFIX, "p");
  assert.equal(WORKSPACE_ID_HEX_LENGTH, 12);
  assert.equal(isSessionId(id), true);
  assert.equal(id.length, 13);
  assert.match(id, /^p[0-9a-f]{12}$/);
});

void test("the sandbox name of a workspace id fits the gateway limit and the two limits agree (C1)", () => {
  const name = sandboxNameOfSession(sessionIdOfWorkspace("/a"));
  assert.equal(GATEWAY_SANDBOX_NAME_MAX_LENGTH, 19);
  assert.ok(name.length <= GATEWAY_SANDBOX_NAME_MAX_LENGTH);
  assert.equal(name, `realm-${sessionIdOfWorkspace("/a")}`);
  assert.equal(name.length, 19);
});

void test("sandboxNameOfSession refuses an id that is outside the safe set or whose name is too long (C1)", () => {
  assertRejectsWith(() => sandboxNameOfSession("bad/id"), "SCHEMA_INVALID");
  assertRejectsWith(() => sandboxNameOfSession("x".repeat(20)), "SCHEMA_INVALID");
});

void test("sessionIdOfWorkspace refuses a relative path, a trailing separator and a path with dot segments (C1)", () => {
  assertRejectsWith(() => sessionIdOfWorkspace("relative/path"), "SCHEMA_INVALID");
  assertRejectsWith(() => sessionIdOfWorkspace(""), "SCHEMA_INVALID");
  assertRejectsWith(() => sessionIdOfWorkspace("/a/b/"), "SCHEMA_INVALID");
  assertRejectsWith(() => sessionIdOfWorkspace("/a/../b"), "SCHEMA_INVALID");
  assertRejectsWith(() => sessionIdOfWorkspace("/a//b"), "SCHEMA_INVALID");
});

void test("sessionIdOfWorkspace accepts the filesystem root, which is the one absolute path with a trailing separator (C1)", () => {
  assert.equal(isSessionId(sessionIdOfWorkspace("/")), true);
});

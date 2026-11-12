import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Policy } from "../../src/contract/validate.js";
import { RealmError } from "../../src/core/errors.js";
import { checkExecPolicy } from "../../src/core/policy.js";

const CLOSED: Policy = {
  mode: "advisory",
  workspaceRoots: [],
  credentialAllow: [],
  egressAllow: [],
  shellEnabled: false,
  startupBudgetMs: 10000,
  toolQueueMs: 2000,
};

const OPEN: Policy = { ...CLOSED, shellEnabled: true };

function withTempDir(body: (dir: string) => void): void {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "realm-exec-")));
  try {
    body(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// The gate's decision for one exec: "allowed", or the code of the RealmError it refuses with.
function decisionOf(policy: Policy, exec: Parameters<typeof checkExecPolicy>[1]): string {
  try {
    checkExecPolicy(policy, exec);
    return "allowed";
  } catch (error: unknown) {
    if (error instanceof RealmError) {
      return error.code;
    }
    throw error;
  }
}

void test("TOOL-02: the argv form is allowed when shell is disabled", () => {
  assert.equal(decisionOf(CLOSED, { argv: ["ls", "-la"] }), "allowed");
});

void test("TOOL-02: the shell form is rejected with SHELL_NOT_ALLOWED when shellEnabled is false", () => {
  assert.throws(
    () => {
      checkExecPolicy(CLOSED, { shell: true, script: "ls | wc -l" });
    },
    (error: unknown) => {
      assert.ok(error instanceof RealmError, "expected a RealmError");
      assert.equal(error.code, "SHELL_NOT_ALLOWED");
      return true;
    },
  );
});

void test("TOOL-02: the shell form is allowed when shellEnabled is true", () => {
  assert.equal(decisionOf(OPEN, { shell: true, script: "ls | wc -l" }), "allowed");
  assert.equal(decisionOf(CLOSED, { shell: true, script: "ls | wc -l" }), "SHELL_NOT_ALLOWED");
});

void test("TOOL-02: the exec gate never executes a command, for argv or shell form", () => {
  withTempDir((dir) => {
    const argvMarker = join(dir, "argv-marker");
    const shellMarker = join(dir, "shell-marker");
    checkExecPolicy(OPEN, { argv: ["touch", argvMarker] });
    checkExecPolicy(OPEN, { shell: true, script: `touch ${shellMarker}` });
    assert.equal(existsSync(argvMarker), false, "argv form must not run");
    assert.equal(existsSync(shellMarker), false, "shell form must not run");
  });
});

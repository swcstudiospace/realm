import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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

// This file runs from dist/test/contract, so three levels up is the package root.
const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "src");

function withTempDir(body: (dir: string) => void): void {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "realm-exec-")));
  try {
    body(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("TOOL-02: the argv form is allowed when shell is disabled", () => {
  assert.doesNotThrow(() => {
    checkExecPolicy(CLOSED, { argv: ["ls", "-la"] });
  });
});

test("TOOL-02: the shell form is rejected with SHELL_NOT_ALLOWED when shellEnabled is false", () => {
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

test("TOOL-02: the shell form is allowed when shellEnabled is true", () => {
  assert.doesNotThrow(() => {
    checkExecPolicy(OPEN, { shell: true, script: "ls | wc -l" });
  });
});

test("TOOL-02: the exec gate never executes a command, for argv or shell form", () => {
  withTempDir((dir) => {
    const argvMarker = join(dir, "argv-marker");
    const shellMarker = join(dir, "shell-marker");
    checkExecPolicy(OPEN, { argv: ["touch", argvMarker] });
    checkExecPolicy(OPEN, { shell: true, script: `touch ${shellMarker}` });
    assert.equal(existsSync(argvMarker), false, "argv form must not run");
    assert.equal(existsSync(shellMarker), false, "shell form must not run");
  });
});

test("TOOL-02: no source file under src imports child_process", () => {
  const files = readdirSync(SRC_DIR, { recursive: true, encoding: "utf8" })
    .filter((name) => name.endsWith(".ts"))
    .map((name) => join(SRC_DIR, name));
  assert.ok(files.length > 0, "the source scan must find files");
  for (const file of files) {
    assert.doesNotMatch(readFileSync(file, "utf8"), /child_process/, file);
  }
});

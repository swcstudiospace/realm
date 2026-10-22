import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
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
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SRC_DIR = join(REPO_ROOT, "src");

// TOOL-02: the only src files that may import child_process. session-execution.ts runs the
// OpenShell create runner with no shell and a minimal environment; checks.ts runs the read-only
// Podman and OpenShell probes via execFile; cli/main.ts spawns the detached daemon by argv (P6-D1).
const CHILD_PROCESS_ALLOWLIST: readonly string[] = [
  "src/cli/main.ts",
  "src/doctor/checks.ts",
  "src/runtime/session-execution.ts",
];

// Matches an import, re-export, dynamic import or require that names child_process.
const CHILD_PROCESS_REF = /\b(?:from|import|require)\s*\(?\s*["'](?:node:)?child_process["']/;
// Matches a named import of child_process: `import { a } from` or `import type { a } from`.
const CHILD_PROCESS_NAMED_IMPORT = /\bimport\s+(?:type\s+)?\{[^{}]*\}\s*from\s*["'](?:node:)?child_process["']/;

// Relative imports of one module, resolved to the .ts sources this test reads.
function relativeImportTargets(file: string): string[] {
  const text = readFileSync(file, "utf8");
  const targets: string[] = [];
  for (const match of text.matchAll(/\b(?:from|import)\s*\(?\s*["'](\.{1,2}\/[^"']+)["']/g)) {
    const specifier = match[1];
    if (specifier !== undefined) targets.push(join(dirname(file), specifier.replace(/\.js$/, ".ts")));
  }
  return targets;
}

// The entry module plus every relative module it reaches: the modules the exec gate uses.
function gateModuleClosure(entry: string): string[] {
  const seen = new Set<string>();
  const pending = [entry];
  for (let file = pending.pop(); file !== undefined; file = pending.pop()) {
    if (seen.has(file)) continue;
    seen.add(file);
    pending.push(...relativeImportTargets(file));
  }
  return [...seen];
}

function withTempDir(body: (dir: string) => void): void {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "realm-exec-")));
  try {
    body(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

void test("TOOL-02: the argv form is allowed when shell is disabled", () => {
  assert.doesNotThrow(() => {
    checkExecPolicy(CLOSED, { argv: ["ls", "-la"] });
  });
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
  assert.doesNotThrow(() => {
    checkExecPolicy(OPEN, { shell: true, script: "ls | wc -l" });
  });
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

void test("TOOL-02: only the allowlisted src files import child_process", () => {
  const allowed = new Set<string>(CHILD_PROCESS_ALLOWLIST);
  const files = readdirSync(SRC_DIR, { recursive: true, encoding: "utf8" })
    .filter((name) => name.endsWith(".ts"))
    .map((name) => join(SRC_DIR, name));
  assert.ok(files.length > 0, "the source scan must find files");
  for (const file of files) {
    const rel = relative(REPO_ROOT, file).split(sep).join("/");
    if (CHILD_PROCESS_REF.test(readFileSync(file, "utf8"))) {
      assert.ok(allowed.has(rel), `${rel} imports child_process but is not on the TOOL-02 allowlist`);
    }
  }
});

void test("TOOL-02: the exec gate modules never import child_process", () => {
  const gate = gateModuleClosure(join(SRC_DIR, "core", "policy.ts"));
  assert.ok(gate.includes(join(SRC_DIR, "core", "policy.ts")), "the gate closure must include core/policy.ts");
  for (const file of gate) {
    assert.doesNotMatch(
      readFileSync(file, "utf8"),
      CHILD_PROCESS_REF,
      `${relative(REPO_ROOT, file).split(sep).join("/")} is in the exec gate and must not import child_process`,
    );
  }
});

void test("TOOL-02: each allowlisted file imports child_process by name, and no entry is stale", () => {
  for (const rel of CHILD_PROCESS_ALLOWLIST) {
    const file = join(REPO_ROOT, rel);
    assert.ok(existsSync(file), `${rel} is on the TOOL-02 allowlist but does not exist`);
    const text = readFileSync(file, "utf8");
    const refs = text.match(new RegExp(CHILD_PROCESS_REF.source, "g"))?.length ?? 0;
    assert.ok(refs > 0, `${rel} is on the TOOL-02 allowlist but does not import child_process`);
    assert.equal(
      text.match(new RegExp(CHILD_PROCESS_NAMED_IMPORT.source, "g"))?.length ?? 0,
      refs,
      `${rel} must import child_process only with a named import (no default, namespace, side-effect or require form)`,
    );
  }
});

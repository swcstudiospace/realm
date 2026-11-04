import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluate, runGate } from "./export-usage-gate.mjs";

// Each fixture is a small source tree. The gate reads the same classes the export-usage analysis assigns.
function failuresOf(files, allowlist = []) {
  const { failures } = evaluate(files, allowlist);
  return failures.map((entry) => `${entry.file}#${entry.name}:${entry.class}`).sort();
}

test("an export that only its own file uses fails as self-only", () => {
  const files = { "src/a/own.ts": "export const helper = 1;\nconsole.log(helper);\n" };
  assert.deepEqual(failuresOf(files), ["src/a/own.ts#helper:self-only"]);
});

test("an export another src file imports passes, and the importer's own unused export fails", () => {
  const files = {
    "src/a/lib.ts": "export function lib() {\n  return 1;\n}\n",
    "src/b/use.ts": "import { lib } from '../a/lib.js';\nexport const value = lib();\n",
  };
  assert.deepEqual(failuresOf(files), ["src/b/use.ts#value:self-only"]);
});

test("a test-only seam fails unless the allowlist names it with a reason", () => {
  const files = {
    "src/c/seam.ts": "export function seam() {\n  return 2;\n}\n",
    "test/c/seam.test.ts": "import { seam } from '../../src/c/seam.js';\nseam();\n",
  };
  assert.deepEqual(failuresOf(files), ["src/c/seam.ts#seam:test-only"]);
  const allowlist = [{ file: "src/c/seam.ts", name: "seam", reason: "D-1306 test-only seam" }];
  assert.deepEqual(failuresOf(files, allowlist), []);
  const result = evaluate(files, allowlist);
  assert.equal(result.allowlisted, 1);
  assert.deepEqual(result.stale, []);
});

test("a type that only a sibling export's signature names is not a failure", () => {
  const files = {
    "src/d/sig.ts": "export interface Shape {\n  n: number;\n}\nexport function make(): Shape {\n  return { n: 1 };\n}\nconsole.log(make());\n",
  };
  // make is a function, so it is self-only and still fails; the type is public-signature and does not.
  assert.deepEqual(failuresOf(files), ["src/d/sig.ts#make:self-only"]);
});

test("a re-exported name is forwarded and never fails", () => {
  const files = {
    "src/e/index.ts": "export * from './impl.js';\n",
    "src/e/impl.ts": "export const impl = 3;\n",
  };
  assert.deepEqual(failuresOf(files), []);
});

test("an allowlist entry that names no failing export is stale and fails the gate", () => {
  const files = { "src/f/only.ts": "export const kept = 1;\nconsole.log(kept);\n" };
  const allowlist = [{ file: "src/f/gone.ts", name: "removed", reason: "D-1306 test-only seam" }];
  const { failures, stale } = evaluate(files, allowlist);
  assert.deepEqual(failures.map((entry) => entry.name), ["kept"]);
  assert.deepEqual(stale.map((item) => `${item.file}#${item.name}`), ["src/f/gone.ts#removed"]);
});

test("runGate exits 1 with a FAIL line for each failing export and 0 when all are allowlisted", () => {
  const files = { "src/g/own.ts": "export const local = 1;\nconsole.log(local);\n" };
  const failing = runGate({ files, allowlist: [] });
  assert.equal(failing.code, 1);
  assert.match(failing.output, /FAIL src\/g\/own\.ts:1 local \(self-only\)/);
  assert.match(failing.output, /1 failing export\(s\), 0 allowlisted seam\(s\), 0 stale/);
  const passing = runGate({
    files,
    allowlist: [{ file: "src/g/own.ts", name: "local", reason: "kept by the owner" }],
  });
  assert.equal(passing.code, 0);
});

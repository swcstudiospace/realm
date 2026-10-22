import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";

// TOOL-03 static no-bypass guard (D-99, D-104, C-5). It reads the TypeScript source under src/
// and checks which modules may reference the guarded symbols, spawn a process, or name the
// OpenShell binary. It starts no process and touches no network.

// This file runs from dist/test/tools, so three levels up is the package root.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SRC_DIR = join(ROOT, "src");

// The D-99 symbols and the module that defines each one. A reference from any other module is a
// bypass unless the module is under src/tools/ or is one of the two shared runtime modules.
const GUARDED_SYMBOLS: Readonly<Record<string, readonly string[]>> = {
  buildExecArgv: ["runtime/openshell.ts"],
  lockedWrite: ["fs/write.ts"],
  readFileCapped: ["fs/read.ts"],
  listDir: ["fs/list.ts"],
  spawnOpenShellRunner: ["runtime/session-execution.ts"],
};
const SHARED_RUNTIME_MODULES: readonly string[] = ["runtime/openshell.ts", "runtime/session-execution.ts"];

// The three filesystem functions that only src/tools/workspace.ts may import (D-88).
const FILE_FUNCTIONS: readonly string[] = ["lockedWrite", "readFileCapped", "listDir"];

// C-5 and D-104: the doctor's read-only `openshell sandbox create --help` probe names the
// OpenShell binary. It is allowlisted for that literal only; it references no guarded symbol.
const OPENSHELL_BINARY_MODULES: readonly string[] = [
  "runtime/openshell.ts",
  "runtime/session-execution.ts",
  "doctor/checks.ts",
];
// spawn( is allowed in the OpenShell runner and in the CLI that spawns the detached daemon (P6-D1).
const SPAWN_MODULES: readonly string[] = ["cli/main.ts", "runtime/session-execution.ts"];

function readSources(): Map<string, string> {
  const names = readdirSync(SRC_DIR, { recursive: true, encoding: "utf8" }).filter(
    (name) => name.endsWith(".ts") && !name.endsWith(".d.ts"),
  );
  return new Map(
    names.map((name): [string, string] => [name.split(sep).join("/"), readFileSync(join(SRC_DIR, name), "utf8")]),
  );
}

function mentions(text: string, identifier: string): boolean {
  return new RegExp(`\\b${identifier}\\b`).test(text);
}

function isUnderTools(file: string): boolean {
  return file.startsWith("tools/");
}

// Each entry names a module outside the allowlist that references a guarded symbol.
function guardedSymbolViolations(sources: ReadonlyMap<string, string>): string[] {
  const violations: string[] = [];
  for (const [file, text] of sources) {
    for (const [symbol, owners] of Object.entries(GUARDED_SYMBOLS)) {
      const allowed = isUnderTools(file) || SHARED_RUNTIME_MODULES.includes(file) || owners.includes(file);
      if (!allowed && mentions(text, symbol)) {
        violations.push(`${file} references ${symbol}`);
      }
    }
  }
  return violations;
}

// Every module whose source calls spawn( as a call, not as part of another identifier.
function spawnCallers(sources: ReadonlyMap<string, string>): string[] {
  return [...sources.keys()].filter((file) => /\bspawn\(/.test(sources.get(file) ?? ""));
}

function openShellBinaryViolations(sources: ReadonlyMap<string, string>): string[] {
  const violations: string[] = [];
  for (const [file, text] of sources) {
    if (!isUnderTools(file) && !OPENSHELL_BINARY_MODULES.includes(file) && mentions(text, "OPENSHELL_BINARY")) {
      violations.push(`${file} references OPENSHELL_BINARY`);
    }
  }
  return violations;
}

// Each entry names a module under src/tools/, other than workspace.ts, that imports a file function.
function toolsFileFunctionViolations(sources: ReadonlyMap<string, string>): string[] {
  const violations: string[] = [];
  for (const [file, text] of sources) {
    if (!isUnderTools(file) || file === "tools/workspace.ts") {
      continue;
    }
    for (const symbol of FILE_FUNCTIONS) {
      if (mentions(text, symbol)) {
        violations.push(`${file} references ${symbol}`);
      }
    }
  }
  return violations;
}

void test("TOOL-03: the D-99 symbols are referenced only from src/tools/, the two shared runtime modules, and their own modules (D-99)", () => {
  assert.deepEqual(guardedSymbolViolations(readSources()), []);
});

void test("TOOL-03: spawn( appears in src/ only in src/runtime/session-execution.ts (D-99)", () => {
  const callers = spawnCallers(readSources());
  assert.deepEqual(callers.sort(), [...SPAWN_MODULES].sort(), "spawn( is allowed only in the OpenShell runner and the documented CLI daemon spawn (P6-D1)");
});

void test("TOOL-03: OPENSHELL_BINARY is referenced only from its allowlist, and the doctor probe is allowlisted for that literal alone (D-99, D-104, C-5)", () => {
  const sources = readSources();
  assert.deepEqual(openShellBinaryViolations(sources), []);
  assert.equal(mentions(sources.get("doctor/checks.ts") ?? "", "OPENSHELL_BINARY"), true, "the doctor probe is the exception in use");
  assert.equal(
    guardedSymbolViolations(sources).some((line) => line.startsWith("doctor/")),
    false,
    "the doctor exception covers the binary literal, not any guarded symbol",
  );
});

void test("TOOL-03: under src/tools/ only workspace.ts imports lockedWrite, readFileCapped, or listDir (D-88)", () => {
  const sources = readSources();
  assert.deepEqual(toolsFileFunctionViolations(sources), []);
  assert.equal(mentions(sources.get("tools/workspace.ts") ?? "", "lockedWrite"), true, "workspace.ts is the file-function importer");
});

void test("TOOL-03: the guard reports a module outside the allowlist that references a guarded symbol, spawns a process, or names the binary", () => {
  const synthetic = new Map<string, string>([
    ["audit/bypass.ts", 'import { listDir } from "../fs/list.js";\nexport const x = listDir;'],
    ["lifecycle/spawner.ts", 'import { spawn } from "node:child_process";\nspawn("sh", []);'],
    ["lifecycle/binary.ts", "export const b = OPENSHELL_BINARY;"],
    ["tools/dispatch.ts", 'import { lockedWrite } from "../fs/write.js";'],
    ["tools/workspace.ts", 'import { readFileCapped } from "../fs/read.js";'],
    ["fs/read.ts", "export function readFileCapped() {}"],
    ["runtime/openshell.ts", "export const OPENSHELL_BINARY = 'openshell';"],
  ]);
  assert.deepEqual(guardedSymbolViolations(synthetic), ["audit/bypass.ts references listDir"]);
  assert.deepEqual(spawnCallers(synthetic), ["lifecycle/spawner.ts"]);
  assert.deepEqual(openShellBinaryViolations(synthetic), ["lifecycle/binary.ts references OPENSHELL_BINARY"]);
  assert.deepEqual(toolsFileFunctionViolations(synthetic), ["tools/dispatch.ts references lockedWrite"]);
});

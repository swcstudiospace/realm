import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";

// TOOL-05 static no-tool-logic guard (P5-D12). It reads the TypeScript source
// under src/ with the same grep-source method as test/tools/no-bypass.test.ts
// (D-99) and proves the three host surfaces hold no tool logic: no file under
// src/mcp/, src/acp/, or src/omp/ references a D-99 guarded symbol or a
// dispatcher-internal symbol, every surface reaches the dispatcher only
// through ToolDispatcher.call, and spawn( still appears only in
// src/runtime/session-execution.ts. It starts no process and touches no
// network. The guard allowlists no new spawn site and no new guarded-symbol
// referrer: any surface reference is a violation.

// This file runs from dist/test/surfaces, so three levels up is the package root.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SRC_DIR = join(ROOT, "src");

// The D-99 symbols and the module that defines each one. A surface reference
// to any of them is tool logic hiding outside the dispatcher pipeline.
const GUARDED_SYMBOLS: Readonly<Record<string, readonly string[]>> = {
  buildExecArgv: ["runtime/openshell.ts"],
  lockedWrite: ["fs/write.ts"],
  readFileCapped: ["fs/read.ts"],
  listDir: ["fs/list.ts"],
  spawnOpenShellRunner: ["runtime/session-execution.ts"],
};

// Dispatcher internals the surfaces must never touch. The surfaces may name
// the ToolDispatcher and ToolOutcome types and call call(); every other member
// of the dispatcher pipeline (deps shapes, timeout constant, stage helpers)
// stays inside src/tools/ and its pipeline callers.
const DISPATCHER_INTERNALS: readonly string[] = [
  "ToolDispatcherDeps",
  "DispatcherController",
  "TOOL_CALL_TIMEOUT_MS",
  "runSandboxExec",
  "withTimeout",
  "appendAudit",
  "summarizeExec",
  "waitLeavingConnecting",
  "checkExecPolicy",
  "refuseRetryIn",
];

// The three host surfaces this guard scans (P5-D12, T-05-12).
const SURFACE_DIRS: readonly string[] = ["mcp/", "acp/", "omp/"];

const SPAWN_MODULE = "runtime/session-execution.ts";

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

function isSurfaceFile(file: string): boolean {
  return SURFACE_DIRS.some((dir) => file.startsWith(dir));
}

// Each entry names a surface file that references a D-99 guarded symbol.
function surfaceGuardedViolations(sources: ReadonlyMap<string, string>): string[] {
  const violations: string[] = [];
  for (const [file, text] of sources) {
    if (!isSurfaceFile(file)) {
      continue;
    }
    for (const symbol of Object.keys(GUARDED_SYMBOLS)) {
      if (mentions(text, symbol)) {
        violations.push(`${file} references ${symbol}`);
      }
    }
  }
  return violations;
}

// Each entry names a surface file that references a dispatcher-internal symbol.
function surfaceInternalViolations(sources: ReadonlyMap<string, string>): string[] {
  const violations: string[] = [];
  for (const [file, text] of sources) {
    if (!isSurfaceFile(file)) {
      continue;
    }
    for (const symbol of DISPATCHER_INTERNALS) {
      if (mentions(text, symbol)) {
        violations.push(`${file} references ${symbol}`);
      }
    }
  }
  return violations;
}

// Each entry names a surface file that reaches past call to another
// dispatcher member (for example dispatcher.snapshot). Controller access in
// src/omp/plugin.ts (handle.controller.snapshot) is not a dispatcher access
// and is not flagged: the pattern is anchored on the dispatcher receiver.
function dispatcherBypassViolations(sources: ReadonlyMap<string, string>): string[] {
  const violations: string[] = [];
  for (const [file, text] of sources) {
    if (!isSurfaceFile(file)) {
      continue;
    }
    for (const match of text.matchAll(/dispatcher\s*\.\s*([A-Za-z_$][\w$]*)/g)) {
      if (match[1] !== "call") {
        violations.push(`${file} reaches dispatcher.${match[1]} instead of call`);
      }
    }
  }
  return violations;
}

// Every module whose source calls spawn( as a call, not as part of another identifier.
function spawnCallers(sources: ReadonlyMap<string, string>): string[] {
  return [...sources.keys()].filter((file) => /\bspawn\(/.test(sources.get(file) ?? ""));
}

test("TOOL-05: no surface file under src/mcp/, src/acp/, or src/omp/ references a D-99 guarded symbol (P5-D12)", () => {
  assert.deepEqual(surfaceGuardedViolations(readSources()), []);
});

test("TOOL-05: no surface file references a dispatcher-internal symbol outside the call entry point (P5-D12)", () => {
  assert.deepEqual(surfaceInternalViolations(readSources()), []);
});

test("TOOL-05: the surfaces reach the dispatcher only through call, never another dispatcher member (P5-D11, P5-D12)", () => {
  const sources = readSources();
  assert.deepEqual(dispatcherBypassViolations(sources), []);
  for (const dir of SURFACE_DIRS) {
    const files = [...sources.keys()].filter((file) => file.startsWith(dir));
    assert.ok(files.length > 0, `expected surface files under src/${dir}`);
    for (const file of files) {
      assert.ok(
        mentions(sources.get(file) ?? "", "call"),
        `${file} reaches the dispatcher through call (P5-D11)`,
      );
    }
  }
});

test("TOOL-05: spawn( appears in src/ only in src/runtime/session-execution.ts (P5-D12)", () => {
  assert.deepEqual(spawnCallers(readSources()), [SPAWN_MODULE], "the one process spawn in src/ is the OpenShell runner");
});

test("TOOL-05: the guard reports a planted surface reference to tool internals, a dispatcher bypass, or a new spawn site", () => {
  const synthetic = new Map<string, string>([
    ["mcp/server.ts", 'import { lockedWrite } from "../fs/write.js";\nexport const x = lockedWrite;'],
    ["acp/agent.ts", 'import { appendAudit } from "../audit/log.js";\nexport const y = appendAudit;'],
    ["omp/plugin.ts", "export function go(handle: never): unknown {\n  return (handle as never as { dispatcher: { snapshot(): unknown } }).dispatcher.snapshot();\n}"],
    ["runtime/rogue.ts", 'import { spawn } from "node:child_process";\nspawn("sh", []);'],
    [
      "mcp/clean.ts",
      'import type { ToolDispatcher } from "../tools/dispatch.js";\nexport function go(d: ToolDispatcher): unknown {\n  return d.call({ status: {} });\n}',
    ],
  ]);
  assert.deepEqual(surfaceGuardedViolations(synthetic), ["mcp/server.ts references lockedWrite"]);
  assert.deepEqual(surfaceInternalViolations(synthetic), ["acp/agent.ts references appendAudit"]);
  assert.deepEqual(dispatcherBypassViolations(synthetic), ["omp/plugin.ts reaches dispatcher.snapshot instead of call"]);
  assert.deepEqual(spawnCallers(synthetic), ["runtime/rogue.ts"]);
});

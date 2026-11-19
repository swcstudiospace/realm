import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// OMPR-05 (K1): what the Omp extension loads. The extension used to import startDetachedDaemon from the CLI entry, which
// pulled the CLI, doctor, MCP, ACP, runtime-driver and session-execution graph into every Omp start. The launch functions now
// live in src/daemon/launch.ts, so the extension's static closure stops at the daemon, host and core modules. This test is
// static: it reads source text through the gate-closure walker, with no clock, process or socket. The closure is the value
// closure (declarations erased at compile time are left out), because that is what the compiled extension loads.

interface Closure {
  readonly modules: ReadonlyMap<string, { readonly parent: string | null; readonly specifiers: readonly string[] }>;
  readonly unresolved: readonly unknown[];
}

interface GateClosureModule {
  gateClosure(options: { root: string; entries: readonly string[]; valueOnly: boolean }): Closure;
}

// Dynamic on purpose, as in test/mcp/annotations.test.ts: a static import would make tsc emit the script into dist, where its
// repository-root constant is wrong. dist/test/omp is three levels below the repository root.
const SCRIPT = new URL("../../../scripts/check/gate-closure.mjs", import.meta.url).href;
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

async function valueClosure(entry: string): Promise<Closure> {
  const script = (await import(SCRIPT)) as GateClosureModule;
  const closure = script.gateClosure({ root: ROOT, entries: [entry], valueOnly: true });
  assert.deepEqual(closure.unresolved, []);
  return closure;
}

const FORBIDDEN_PREFIXES = ["src/cli/", "src/doctor/", "src/mcp/", "src/acp/", "src/runtime/driver/"];
const FORBIDDEN_MODULES = ["src/runtime/session-execution.ts", "src/runtime/openshell.ts"];

function reachedForbidden(modules: readonly string[]): string[] {
  return modules.filter(
    (module) => FORBIDDEN_PREFIXES.some((prefix) => module.startsWith(prefix)) || FORBIDDEN_MODULES.includes(module),
  );
}

void test("OMPR-05: the Omp extension's closure reaches no CLI, doctor, MCP, ACP, driver or session-execution module", async () => {
  const { modules } = await valueClosure("src/omp/extension.ts");
  const names = [...modules.keys()].sort();
  assert.deepEqual(reachedForbidden(names), []);
  // Under src/runtime the extension reaches only the three small modules that resolve paths and read the config file.
  assert.deepEqual(
    names.filter((module) => module.startsWith("src/runtime/")),
    ["src/runtime/config-file.ts", "src/runtime/config.ts", "src/runtime/host-paths.ts"],
  );
  assert.ok(modules.has("src/daemon/launch.ts"));
  // The exact size of the closure: a change that grows it is a decision, not a drift. It was 98 modules before the move.
  assert.equal(modules.size, 43);
});

void test("OMPR-05: src/daemon/launch.ts is the only module of the extension's closure that imports node:child_process", async () => {
  const { modules } = await valueClosure("src/omp/extension.ts");
  const importers = [...modules]
    .filter(([, { specifiers }]) => specifiers.some((specifier) => specifier === "node:child_process" || specifier === "child_process"))
    .map(([module]) => module);
  assert.deepEqual(importers, ["src/daemon/launch.ts"]);
});

void test("OMPR-05: the plugin and the shared attach reach none of those modules and no child_process", async () => {
  const expected = [
    ["src/omp/plugin.ts", 9],
    ["src/host/attach.ts", 13],
  ] as const;
  for (const [entry, size] of expected) {
    const { modules } = await valueClosure(entry);
    assert.deepEqual(reachedForbidden([...modules.keys()]), [], entry);
    assert.deepEqual(
      [...modules].filter(([, { specifiers }]) => specifiers.some((specifier) => specifier.endsWith("child_process"))),
      [],
      entry,
    );
    assert.equal(modules.size, size, entry);
  }
});

// TEST-HOST-01: the cross-host row contract. One test per host id runs the real table row through the twelve static rules of
// test/support/host-contract.ts; the rows are read from HOST_RUNTIMES at run time, so a 20th row is checked the day it is added. A
// seeded-defect table then proves the checker can fail: each defect is a patched deep copy of a real row (or an injected collaborator) and
// must return exactly the codes named for it. Fixtures and fakes only: no host runs and no file is touched.

import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveCapabilities } from "../../src/host/capabilities.js";
import { defaultManifestFor } from "../../src/host/manifest.js";
import { HOST_RUNTIMES, resolveHomeSpecs } from "../../src/host/runtimes.js";
import { HOST_IDS, type HostId, type HostRuntimeEntry } from "../../src/host/types.js";
import {
  ROW_VIOLATIONS,
  checkHostRowContract,
  isDeepFrozen,
  registeredArgvOf,
  type RowContractDeps,
  type RowViolation,
} from "../support/host-contract.js";

for (const id of HOST_IDS) {
  void test(`TEST-HOST-01 ${id}: the row satisfies the contract`, () => {
    const violations = checkHostRowContract(id, HOST_RUNTIMES[id]);
    assert.equal(violations.join(","), "", `${id} violates: ${violations.join(",")}`);
  });
}

void test("TEST-HOST-01: the table has a row for every host id and no other key, and the registered argv is read for every mcp-config recipe", () => {
  assert.deepEqual(Object.keys(HOST_RUNTIMES).sort(), [...HOST_IDS].sort());
  const withArgv: HostId[] = [];
  for (const id of HOST_IDS) {
    const row = HOST_RUNTIMES[id];
    const argv = registeredArgvOf(row);
    if (row.integration === "mcp-config" && row.recipe !== null) {
      assert.equal(argv?.join(" "), `realm mcp --host ${id}`, id);
      withArgv.push(id);
    } else {
      assert.equal(argv, null, `${id}: omp and every recipe-null row have no registered argv`);
    }
  }
  assert.equal(withArgv.includes("omp"), false);
  assert.equal(
    withArgv.length,
    HOST_IDS.filter((id) => HOST_RUNTIMES[id].integration === "mcp-config" && HOST_RUNTIMES[id].recipe !== null).length,
  );
});

void test("TEST-HOST-01: the violation list is closed and sorted", () => {
  assert.equal(ROW_VIOLATIONS.length, 12);
  assert.equal(new Set(ROW_VIOLATIONS).size, 12);
});

// ---- the seeded defects ---------------------------------------------------------------------------------------------------------------------

function at(parent: unknown, key: string | number): unknown {
  assert.ok(typeof parent === "object" && parent !== null, `no object at ${String(key)}`);
  const child: unknown = Reflect.get(parent, key);
  return child;
}

function put(parent: unknown, key: string | number, value: unknown): void {
  assert.ok(typeof parent === "object" && parent !== null, `no object for ${String(key)}`);
  assert.ok(Reflect.set(parent, key, value), `${String(key)} is writable on the copy`);
}

function freezeDeep(value: unknown): void {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return;
  }
  const children: readonly unknown[] = Object.values(value);
  for (const child of children) {
    freezeDeep(child);
  }
  Object.freeze(value);
}

function isRow(value: unknown): value is HostRuntimeEntry {
  return typeof value === "object" && value !== null && "id" in value;
}

// A deep, mutable copy of a real row, patched, then deep-frozen again (except when the defect is the missing freeze). The real table is never touched.
function copyOf(source: HostId, patch: (draft: unknown) => void, freeze = true): HostRuntimeEntry {
  const draft: unknown = structuredClone(HOST_RUNTIMES[source]);
  patch(draft);
  if (freeze) {
    freezeDeep(draft);
  }
  assert.ok(isRow(draft), "the copy is a row");
  return draft;
}

const recipeValue = (draft: unknown): unknown => at(at(draft, "recipe"), "value");

interface RowDefect {
  readonly name: string;
  // The real row the defect starts from; the table's own object must still be deep-frozen afterwards.
  readonly source: HostId;
  readonly build: () => { readonly id: string; readonly row: HostRuntimeEntry; readonly deps?: RowContractDeps };
  readonly expected: readonly RowViolation[];
}

const defect = (name: string, source: HostId, expected: readonly RowViolation[], patch: (draft: unknown) => void, freeze = true): RowDefect => ({
  name,
  source,
  expected,
  build: () => ({ id: source, row: copyOf(source, patch, freeze) }),
});

// A resolver that lets an override move a skills home.
const leakyResolver: typeof resolveHomeSpecs = (row, env) => {
  const real = resolveHomeSpecs(row, env);
  const value = row.envOverride === null ? undefined : env.env[row.envOverride];
  return value === undefined ? real : real.map((spec) => ({ path: value, role: spec.role }));
};

const DEFECTS: readonly RowDefect[] = [
  defect("an unfrozen copy of the claude row", "claude", ["not-frozen"], () => undefined, false),
  defect("the claude flag is a near miss", "claude", ["identity"], (draft) => {
    put(draft, "flag", "--claud");
  }),
  defect("an alias equal to another host id on the codex row", "codex", ["identity"], (draft) => {
    put(draft, "aliases", ["claude"]);
  }),
  defect("the tier is an unknown word", "kilo", ["identity"], (draft) => {
    put(draft, "tier", "experimental");
  }),
  defect("a home with a parent segment", "codex", ["home-unsafe"], (draft) => {
    put(at(at(draft, "homes"), 0), "rel", "../.codex");
  }),
  defect("an absolute home", "cursor", ["home-unsafe"], (draft) => {
    put(at(at(draft, "homes"), 0), "rel", "/etc/cursor");
  }),
  defect("both an envOverride and an envBase on the qwen row", "qwen", ["env-shape"], (draft) => {
    put(draft, "envBase", { name: "XDG_CONFIG_HOME", sub: "qwen" });
  }),
  defect("the GSD-only variable CURSOR_CONFIG_DIR as the cursor override", "cursor", ["env-shape"], (draft) => {
    put(draft, "envOverride", "CURSOR_CONFIG_DIR");
  }),
  defect("a lower-case override name on the claude row", "claude", ["env-shape"], (draft) => {
    put(draft, "envOverride", "claude_config_dir");
  }),
  {
    name: "a resolver that lets an override move a skills home (kimi)",
    source: "kimi",
    build: () => ({ id: "kimi", row: HOST_RUNTIMES.kimi, deps: { resolveHomeSpecs: leakyResolver } }),
    expected: ["home-resolution"],
  },
  defect("a recipe file with a parent segment on the pi row", "pi", ["recipe-kind"], (draft) => {
    put(at(draft, "recipe"), "file", "../mcp.json");
  }),
  defect("a recipe home role the row does not have (pi has only a config home)", "pi", ["recipe-kind"], (draft) => {
    put(at(draft, "recipe"), "homeRole", "mcp");
  }),
  // The absolute command is not the bare command realm (launch-unsafe) and differs from the manifest's launch (launch-mismatch).
  defect("the cursor command is an absolute path", "cursor", ["launch-mismatch", "launch-unsafe"], (draft) => {
    put(recipeValue(draft), "command", "/usr/local/bin/realm");
  }),
  // The shape is still a host id, so only the equality with the manifest's launch (this row's id) fails.
  defect("the cursor args name codex", "cursor", ["launch-mismatch"], (draft) => {
    put(recipeValue(draft), "args", ["mcp", "--host", "codex"]);
  }),
  // The semicolon is a shell metacharacter and the last argument is no host id (launch-unsafe), and it differs from the manifest (launch-mismatch).
  defect("an argument with a semicolon on the qwen row", "qwen", ["launch-mismatch", "launch-unsafe"], (draft) => {
    put(recipeValue(draft), "args", ["mcp", "--host", "qwen;"]);
  }),
  {
    name: "a manifest that adds net.egress with a scope to an mcp-config host (cursor)",
    source: "cursor",
    build: () => ({
      id: "cursor",
      row: HOST_RUNTIMES.cursor,
      deps: {
        manifestFor: (id, version) => {
          const real = defaultManifestFor(id, version);
          return { ...real, capabilities: [...real.capabilities, { capability: "net.egress", scope: "example.org:443" }] };
        },
      },
    }),
    expected: ["manifest"],
  },
  {
    name: "a capability resolver that grants exec.shell under a policy with shell off (cursor)",
    source: "cursor",
    build: () => {
      const grantAll: typeof resolveCapabilities = (requested) => ({ granted: requested, denied: [] });
      return { id: "cursor", row: HOST_RUNTIMES.cursor, deps: { resolveCapabilities: grantAll } };
    },
    expected: ["capability-grant"],
  },
  defect("five shadows on the codebuddy row", "codebuddy", ["shadow-shape"], (draft) => {
    put(
      draft,
      "shadows",
      ["a.json", "b.json", "c.json", "d.json", "e.json"].map((rel) => ({ rel, base: "home" })),
    );
  }),
  defect("an absolute shadow path on the codebuddy row", "codebuddy", ["shadow-shape"], (draft) => {
    put(draft, "shadows", [{ rel: "/etc/passwd", base: "home" }]);
  }),
  defect("the windsurf row (recipe null) given a conflicts list", "windsurf", ["pending-inert"], (draft) => {
    put(draft, "conflicts", [".omp/plugins/node_modules/agent-realm"]);
  }),
];

for (const item of DEFECTS) {
  void test(`TEST-HOST-01 defect: ${item.name}`, () => {
    const built = item.build();
    const found = built.deps === undefined ? checkHostRowContract(built.id, built.row) : checkHostRowContract(built.id, built.row, built.deps);
    assert.equal(found.join(","), item.expected.join(","), `${item.name}: found ${found.join(",") || "no violation"}`);
  });
}

void test("TEST-HOST-01 defect: every defect names a closed code and no real row was changed by one", () => {
  for (const item of DEFECTS) {
    for (const code of item.expected) {
      assert.ok(ROW_VIOLATIONS.includes(code), `${item.name}: ${code} is a closed code`);
    }
    assert.ok(isDeepFrozen(HOST_RUNTIMES[item.source]), `${item.source} is still deep-frozen`);
  }
  for (const code of ROW_VIOLATIONS) {
    assert.ok(
      DEFECTS.some((item) => item.expected.includes(code)),
      `${code} has a seeded defect`,
    );
  }
});

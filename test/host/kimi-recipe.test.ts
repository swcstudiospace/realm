// The Kimi recipes (ADPT-07) on fixture hosts built from the real table rows. `kimi` is the archived Python product Kimi CLI
// (config home ~/.kimi, KIMI_SHARE_DIR) and `kimi-code` is the Node product Kimi Code (~/.kimi-code, KIMI_CODE_HOME): two
// products, two rows, one recipe shape (24-CONTEXT D-24-05). Both merge mcpServers.realm into mcp.json. Temporary directories only;
// no Kimi binary runs, and the formats come from official documentation, not from an observation.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { defaultHostReader, type HostFsReader } from "../../src/host/install.js";
import { HOST_RUNTIMES } from "../../src/host/runtimes.js";
import { KIMI_CODE_MCP_DOC_FILE, KIMI_MCP_DOC_FILE } from "../support/host-config-goldens.js";
import { treeHash } from "../support/fixture-host.js";
import {
  buildRig,
  DEFAULT_FORMAT,
  defineHostRecipeSuite,
  executable,
  nothingWritten,
  parseDoc,
  refusedWith,
  writeSeed,
  type JsonSuiteDescriptor,
} from "../support/host-recipe-suite.js";

interface Variant {
  readonly id: "kimi" | "kimi-code";
  readonly dir: string;
  // The directory of the other product, and of a skills home when the row has one: neither may ever be created or read.
  readonly untouched: string;
  // The skills home is looked at by detection (lstat), so an lstat is allowed there; no other call is.
  readonly allowLstat: boolean;
  readonly variable: string;
  readonly golden: string;
}

const VARIANTS: readonly Variant[] = [
  { id: "kimi", dir: ".kimi", untouched: ".config/agents", allowLstat: true, variable: "KIMI_SHARE_DIR", golden: KIMI_MCP_DOC_FILE },
  { id: "kimi-code", dir: ".kimi-code", untouched: ".kimi", allowLstat: false, variable: "KIMI_CODE_HOME", golden: KIMI_CODE_MCP_DOC_FILE },
];

// A config.toml carrying the GSD hook marker block (what a GSD hook install writes into ~/.kimi and ~/.kimi-code).
const GSD_CONFIG = 'model = "example-model"\n\n# GSD Hooks BEGIN\n[[hooks]]\nevent = "PreToolUse"\ncommand = "node hooks/guard.js"\n# GSD Hooks END\n';

function descriptor(v: Variant): JsonSuiteDescriptor {
  return {
    id: v.id,
    req: "ADPT-07",
    file: "mcp.json",
    installHomeRel: v.dir,
    detectHomeRel: v.dir,
    binary: null,
    override: { variable: v.variable, homeOf: (value) => value },
    parentKey: "mcpServers",
    entry: { command: "realm", args: ["mcp", "--host", v.id] },
    seedDoc: parseDoc(v.golden),
    seedFormat: DEFAULT_FORMAT,
  };
}

// A reader that fails every call on `untouched` (except lstat, where allowed) and counts each such call.
function guardedReader(untouched: string, allowLstat: boolean, touched: string[]): HostFsReader {
  const under = (path: string): boolean => path === untouched || path.startsWith(`${untouched}/`);
  const guard = (path: string): void => {
    if (under(path)) {
      touched.push(path);
      throw new Error("a path that does not belong to this host was read");
    }
  };
  return {
    realpath: (path) => {
      guard(path);
      return defaultHostReader.realpath(path);
    },
    lstat: (path) => {
      if (!allowLstat) {
        guard(path);
      }
      return defaultHostReader.lstat(path);
    },
    stat: (path) => {
      guard(path);
      return defaultHostReader.stat(path);
    },
    readFile: (path, maxBytes) => {
      guard(path);
      return defaultHostReader.readFile(path, maxBytes);
    },
    readdir: (path) => {
      guard(path);
      return defaultHostReader.readdir(path);
    },
  };
}

for (const v of VARIANTS) {
  const d = descriptor(v);
  const tag = `ADPT-07 ${v.id}`;
  defineHostRecipeSuite(d);

  void test(`${tag}: the row has no binary detection, the recipe is the mcpServers shape for --host ${v.id}, and the tier is unchanged`, () => {
    const entry = HOST_RUNTIMES[v.id];
    assert.deepEqual([...entry.binaries], []);
    assert.deepEqual(entry.recipe, {
      kind: "json-merge",
      file: "mcp.json",
      keyPath: ["mcpServers", "realm"],
      value: { command: "realm", args: ["mcp", "--host", v.id] },
    });
    assert.equal(entry.tier, v.id === "kimi" ? "proven" : "config-only");
    assert.equal(entry.envOverride, v.variable);
  });

  void test(`${tag}: ${v.id === "kimi" ? "kimi is the archived Python Kimi CLI" : "kimi-code is the Node Kimi Code"}: the file is <home>/${v.dir}/mcp.json, or <${v.variable}>/mcp.json, and the default home is untouched`, async (t) => {
    const plain = buildRig(t, d);
    assert.equal(plain.file, join(plain.host.home, v.dir, "mcp.json"));
    await plain.adapter.install(plain.env, { dryRun: false });
    assert.equal(existsSync(join(plain.host.home, v.dir, "mcp.json")), true);

    const moved = buildRig(t, d, { override: true });
    const before = treeHash(join(moved.host.home, v.dir));
    await moved.adapter.install(moved.env, { dryRun: false });
    assert.equal(moved.file, join(moved.overrideDir, "mcp.json"));
    assert.equal(existsSync(moved.file), true);
    assert.equal(treeHash(join(moved.host.home, v.dir)), before, `<home>/${v.dir} is untouched`);
  });

  void test(`${tag}: ${v.untouched === ".kimi" ? "the other product's home <home>/.kimi" : "the skills home <home>/.config/agents"} is never created, read or written, with or without ${v.variable}`, async (t) => {
    for (const override of [false, true]) {
      const touched: string[] = [];
      const r = buildRig(t, d, { ...(override ? { override: true } : {}) });
      const guarded = r.adapterWith({ reader: guardedReader(join(r.host.home, v.untouched), v.allowLstat, touched) });
      await guarded.install(r.env, { dryRun: false });
      assert.equal((await guarded.status(r.env)).status, "installed");
      await guarded.uninstall(r.env, { dryRun: false });
      assert.deepEqual(touched, [], `override ${String(override)}`);
      assert.equal(existsSync(join(r.host.home, v.untouched)), false);
    }
  });

  void test(`${tag}: a config.toml holding the GSD marker block is byte-identical after install and uninstall`, async (t) => {
    const r = buildRig(t, d);
    writeSeed(join(r.homeDir, "config.toml"), GSD_CONFIG);
    await r.adapter.install(r.env, { dryRun: false });
    assert.equal(readFileSync(join(r.homeDir, "config.toml"), "utf8"), GSD_CONFIG);
    await r.adapter.uninstall(r.env, { dryRun: false });
    assert.equal(readFileSync(join(r.homeDir, "config.toml"), "utf8"), GSD_CONFIG);
  });

  void test(`${tag}: ${v.dir} absent with an executable named kimi on PATH is not detected and install refuses not-detected; --config-home to a created directory installs`, async (t) => {
    const r = buildRig(t, d, { home: false, path: true });
    executable(join(r.binDir, "kimi"));
    assert.equal((await r.adapter.detect(r.env)).detected, false);
    const before = treeHash(r.host.root);
    for (const dryRun of [true, false]) {
      await assert.rejects(r.adapter.install(r.env, { dryRun }), refusedWith("not-detected", "POLICY_DENIED"));
    }
    nothingWritten(r, d, before);
    const dir = join(r.host.root, "chosen");
    mkdirSync(dir);
    assert.equal((await r.adapter.install(r.env, { dryRun: false, configHome: dir })).outcome, "installed");
    assert.equal(existsSync(join(dir, "mcp.json")), true);
  });

  void test(`${tag}: the documented mcp.json example keeps every server and header byte for byte after install and uninstall`, async (t) => {
    const r = buildRig(t, d, { seed: v.golden });
    const original = parseDoc(v.golden);
    await r.adapter.install(r.env, { dryRun: false });
    const after = parseDoc(readFileSync(r.file, "utf8"));
    const servers = after["mcpServers"] as Record<string, unknown>;
    const first = original["mcpServers"] as Record<string, unknown>;
    for (const name of Object.keys(first)) {
      assert.equal(isDeepStrictEqual(servers[name], first[name]), true, name);
    }
    assert.deepEqual(servers["realm"], { command: "realm", args: ["mcp", "--host", v.id] });
    assert.deepEqual(Object.keys(servers), [...Object.keys(first), "realm"]);
    await r.adapter.uninstall(r.env, { dryRun: false });
    assert.equal(readFileSync(r.file, "utf8"), v.golden);
  });
}

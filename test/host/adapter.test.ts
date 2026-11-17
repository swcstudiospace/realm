import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { RealmError } from "../../src/core/errors.js";
import { createHostAdapter, type HostAdapterDeps, type RecipeHostAdapter } from "../../src/host/adapter.js";
import { bootHookOf } from "../../src/host/boot-driver.js";
import { defaultHostReader, type HostFileInfo, type HostFsReader } from "../../src/host/install.js";
import { defaultManifestFor } from "../../src/host/manifest.js";
import { receiptPath } from "../../src/host/receipt.js";
import { HostRefusal, type HostRefusalReason } from "../../src/host/recipe.js";
import { HOST_RUNTIMES } from "../../src/host/runtimes.js";
import { HOST_IDS, type HostEnv, type HostRuntimeEntry, type InstallRecipe } from "../../src/host/types.js";
import {
  captureLog,
  eventsOf,
  FIXTURE_HOME_REL,
  FIXTURE_JSON_VALUE,
  fixtureEntry,
  fixtureRecipe,
  makeFixtureHost,
  treeHash,
  writeAt,
  type CapturedLog,
  type FixtureHost,
} from "../support/fixture-host.js";

function deps(host: FixtureHost, log: CapturedLog, extra: Partial<HostAdapterDeps> = {}): HostAdapterDeps {
  let counter = 0;
  return {
    stateDir: host.stateDir,
    adaptersDir: host.adaptersDir,
    logger: log.logger,
    now: () => new Date("2026-01-01T00:00:00.000Z"),
    newCorrelationId: () => {
      counter += 1;
      return `corr-${String(counter)}`;
    },
    readTimeoutMs: 2000,
    ...extra,
  };
}

function fixtureAdapter(
  t: TestContext,
  recipe: InstallRecipe | null,
  options: { readonly createConfigHome?: boolean; readonly extra?: Partial<HostAdapterDeps>; readonly entry?: HostRuntimeEntry } = {},
): { host: FixtureHost; log: CapturedLog; adapter: RecipeHostAdapter } {
  const host = makeFixtureHost(t, options.createConfigHome === undefined ? {} : { createConfigHome: options.createConfigHome });
  const log = captureLog();
  const adapter = createHostAdapter(options.entry ?? fixtureEntry(recipe), defaultManifestFor("claude", "1.2.3"), deps(host, log, options.extra));
  return { host, log, adapter };
}

function refusedWith(reason: HostRefusalReason, errorCode: string): (error: unknown) => boolean {
  return (error: unknown) => error instanceof HostRefusal && error.refusal === reason && error.code === errorCode;
}

function code(error: unknown): string | undefined {
  return error instanceof RealmError ? error.code : undefined;
}

// A reader that records every call and otherwise behaves like the default one.
function recordingReader(): { reader: HostFsReader; calls: string[] } {
  const calls: string[] = [];
  const reader: HostFsReader = {
    realpath(path) {
      calls.push(`realpath:${path}`);
      return defaultHostReader.realpath(path);
    },
    lstat(path) {
      calls.push(`lstat:${path}`);
      return defaultHostReader.lstat(path);
    },
    stat(path) {
      calls.push(`stat:${path}`);
      return defaultHostReader.stat(path);
    },
    readFile(path, max) {
      calls.push(`readFile:${path}`);
      return defaultHostReader.readFile(path, max);
    },
    readdir(path) {
      calls.push(`readdir:${path}`);
      return defaultHostReader.readdir(path);
    },
  };
  return { reader, calls };
}

function binaryIn(dir: string, mode: number): void {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "fixture-host");
  writeFileSync(file, "#!/bin/sh\n");
  chmodSync(file, mode);
}

void test("every table entry builds an adapter with no file system access, and install refuses as recipe-pending for the 13 hosts without a recipe", async (t) => {
  const host = makeFixtureHost(t);
  const log = captureLog();
  const forbidden = (): never => {
    throw new Error("construction touched the file system");
  };
  const reader: HostFsReader = { realpath: forbidden, lstat: forbidden, stat: forbidden, readFile: forbidden, readdir: forbidden };
  const adapters = HOST_IDS.map((id) => createHostAdapter(HOST_RUNTIMES[id], defaultManifestFor(id, "1.2.3"), deps(host, log, { reader })));
  assert.equal(adapters.length, 19);
  assert.deepEqual(adapters.map((adapter) => adapter.id), [...HOST_IDS]);
  for (const adapter of adapters) {
    assert.equal(adapter.tier, HOST_RUNTIMES[adapter.id].tier);
    assert.equal(adapter.bootHook, bootHookOf(HOST_RUNTIMES[adapter.id]));
    if (adapter.id === "omp") {
      assert.equal(adapter.bootHook, null);
    } else {
      assert.equal(typeof adapter.bootHook, "function");
    }
  }
  const before = treeHash(host.root);
  const pending = adapters.filter((adapter) => HOST_RUNTIMES[adapter.id].recipe === null);
  assert.equal(pending.length, 13);
  assert.ok(pending.every((adapter) => adapter.id !== "omp" && adapter.id !== "claude"), "omp and the Phase 24 hosts have recipes");
  for (const adapter of pending) {
    for (const dryRun of [false, true]) {
      // The recipe check comes before any read of host files, so a reader that throws is never reached.
      await assert.rejects(adapter.install(host.env, { dryRun }), refusedWith("recipe-pending", "POLICY_DENIED"), adapter.id);
    }
  }
  assert.equal(treeHash(host.root), before);
  assert.equal(existsSync(join(host.stateDir, "audit")), false);
});

void test("the omp adapter has a recipe: construction reads nothing, and install rejects at its first read, not as recipe-pending", async (t) => {
  const host = makeFixtureHost(t);
  const log = captureLog();
  const forbidden = (): never => {
    throw new Error("the first read");
  };
  const reader: HostFsReader = { realpath: forbidden, lstat: forbidden, stat: forbidden, readFile: forbidden, readdir: forbidden };
  const construct = (): RecipeHostAdapter => createHostAdapter(HOST_RUNTIMES.omp, defaultManifestFor("omp", "1.2.3"), deps(host, log, { reader }));
  assert.doesNotThrow(construct);
  const before = treeHash(host.root);
  for (const dryRun of [false, true]) {
    await assert.rejects(construct().install(host.env, { dryRun }), (error: unknown) => error instanceof Error && error.message === "the first read");
  }
  assert.equal(treeHash(host.root), before);
  assert.equal(existsSync(join(host.stateDir, "audit")), false);
});

void test("the manifest is validated at construction and must belong to the host", (t) => {
  const host = makeFixtureHost(t);
  const log = captureLog();
  const entry = fixtureEntry(null);
  const good = defaultManifestFor("claude", "1.2.3");
  const bad: unknown[] = [{ ...good, hostId: "opencode" }, { ...good, extra: 1 }, { ...good, schemaVersion: 2 }, null];
  for (const manifest of bad) {
    assert.throws(
      () => createHostAdapter(entry, manifest as typeof good, deps(host, log)),
      (error: unknown) => code(error) === "SCHEMA_INVALID",
    );
  }
  assert.equal(createHostAdapter(entry, good, deps(host, log)).id, "claude");
});

void test("a boot hook factory passed in is exposed on the adapter", (t) => {
  const host = makeFixtureHost(t);
  const factory = (): never => {
    throw new Error("not called");
  };
  const adapter = createHostAdapter(fixtureEntry(null), defaultManifestFor("claude", "1.2.3"), deps(host, captureLog(), { bootHook: factory }));
  assert.equal(adapter.bootHook, factory);
});

void test("an explicit null boot hook wins over the default", (t) => {
  const host = makeFixtureHost(t);
  const adapter = createHostAdapter(fixtureEntry(null), defaultManifestFor("claude", "1.2.3"), deps(host, captureLog(), { bootHook: null }));
  assert.equal(adapter.bootHook, null);
});

// ---- detect ------------------------------------------------------------------------

void test("detect finds a host by its home alone", async (t) => {
  const { host, adapter } = fixtureAdapter(t, fixtureRecipe("json-merge"));
  const found = await adapter.detect(host.env);
  assert.deepEqual(found, {
    id: "claude",
    detected: true,
    via: "home",
    homes: [{ path: host.configHome, exists: true, symlink: false }],
    binary: null,
    conflicts: [],
  });
});

void test("detect finds a host by an executable on PATH alone, and ignores a file that is not executable", async (t) => {
  const { host, adapter } = fixtureAdapter(t, fixtureRecipe("json-merge"), { createConfigHome: false });
  const bin = join(host.root, "bin");
  binaryIn(bin, 0o755);
  const env: HostEnv = { ...host.env, pathDirs: [bin] };
  const found = await adapter.detect(env);
  assert.equal(found.detected, true);
  assert.equal(found.via, "binary");
  assert.equal(found.binary, "fixture-host");
  assert.deepEqual(found.homes, [{ path: host.configHome, exists: false, symlink: false }]);

  const plain = join(host.root, "plain");
  binaryIn(plain, 0o644);
  const none = await adapter.detect({ ...host.env, pathDirs: [plain] });
  assert.equal(none.detected, false);
  assert.equal(none.binary, null);
});

void test("detect reports a host that is neither there nor on PATH as not detected", async (t) => {
  const { host, adapter } = fixtureAdapter(t, fixtureRecipe("json-merge"), { createConfigHome: false });
  const found = await adapter.detect(host.env);
  assert.equal(found.detected, false);
  assert.equal(found.via, "none");
});

void test("detect skips empty and relative PATH entries without touching them", async (t) => {
  const { reader, calls } = recordingReader();
  const { host, adapter } = fixtureAdapter(t, fixtureRecipe("json-merge"), { createConfigHome: false, extra: { reader } });
  const found = await adapter.detect({ ...host.env, pathDirs: ["", "relative/bin", "."] });
  assert.equal(found.detected, false);
  assert.equal(calls.filter((call) => call.startsWith("stat:")).length, 0);
});

void test("detect follows a symlinked home once and reports it", async (t) => {
  const { host, adapter } = fixtureAdapter(t, fixtureRecipe("json-merge"), { createConfigHome: false });
  const real = join(host.root, "real-config");
  mkdirSync(real);
  symlinkSync(real, host.configHome);
  const found = await adapter.detect(host.env);
  assert.deepEqual(found.homes, [{ path: host.configHome, exists: true, symlink: true }]);
  assert.equal(found.detected, true);

  rmSync(host.configHome);
  symlinkSync(join(host.root, "no-such-target"), host.configHome);
  const dangling = await adapter.detect(host.env);
  assert.deepEqual(dangling.homes, [{ path: host.configHome, exists: false, symlink: true }]);
  assert.equal(dangling.detected, false);
});

void test("an entry with no home and no binary (antigravity) is never detected and never throws", async (t) => {
  const host = makeFixtureHost(t);
  const adapter = createHostAdapter(HOST_RUNTIMES.antigravity, defaultManifestFor("antigravity", "1.2.3"), deps(host, captureLog()));
  const found = await adapter.detect(host.env);
  assert.equal(found.detected, false);
  assert.deepEqual(found.homes, []);
  assert.equal(found.binary, null);
});

void test("a stalled stat during detection is TOOL_TIMEOUT", async (t) => {
  const stalled: HostFsReader = { ...defaultHostReader, stat: () => new Promise<HostFileInfo | null>(() => undefined) };
  const { host, adapter } = fixtureAdapter(t, fixtureRecipe("json-merge"), { createConfigHome: false, extra: { reader: stalled, readTimeoutMs: 30 } });
  await assert.rejects(adapter.detect({ ...host.env, pathDirs: [join(host.root, "bin")] }), (error: unknown) => code(error) === "TOOL_TIMEOUT");
});

// ---- status -------------------------------------------------------------------------

void test("status without a receipt: not-detected, recipe-pending, or detected", async (t) => {
  const absent = fixtureAdapter(t, fixtureRecipe("json-merge"), { createConfigHome: false });
  assert.equal((await absent.adapter.status(absent.host.env)).status, "not-detected");
  const pending = fixtureAdapter(t, null);
  assert.equal((await pending.adapter.status(pending.host.env)).status, "recipe-pending");
  const ready = fixtureAdapter(t, fixtureRecipe("json-merge"));
  const result = await ready.adapter.status(ready.host.env);
  assert.equal(result.status, "detected");
  assert.equal(result.changed, false);
  assert.deepEqual(result.entries, []);
});

void test("status follows a full lifecycle: installed, user edits, drift, uninstall", async (t) => {
  const { host, adapter, log } = fixtureAdapter(t, fixtureRecipe("json-merge"));
  const file = join(host.configHome, "settings.json");
  const original = `${JSON.stringify({ z: 1 }, null, 2)}\n`;
  writeAt(file, original);
  // The verdict comes from the receipt alone: no home and no host are needed.
  const noHost: HostEnv = { home: "", env: {}, pathDirs: [] };

  const installed = await adapter.install(host.env, { dryRun: false });
  assert.equal(installed.status, "installed");
  assert.equal(installed.changed, true);
  assert.equal(installed.outcome, "installed");
  assert.deepEqual(installed.actions.map((action) => [action.path, action.action]), [["settings.json", "update"]]);
  const status = await adapter.status(noHost);
  assert.equal(status.status, "installed");
  assert.deepEqual(status.entries, [{ path: "settings.json", state: "ok" }]);

  // An edit elsewhere in the file is not drift.
  const edited = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  edited["added"] = true;
  writeFileSync(file, `${JSON.stringify(edited, null, 2)}\n`);
  assert.equal((await adapter.status(noHost)).status, "installed");

  // An edit to the value Realm owns is.
  const tampered = JSON.parse(readFileSync(file, "utf8")) as { mcpServers: { realm: { command: string } } };
  tampered.mcpServers.realm.command = "evil";
  writeFileSync(file, `${JSON.stringify(tampered, null, 2)}\n`);
  const drifted = await adapter.status(noHost);
  assert.equal(drifted.status, "drifted");
  assert.deepEqual(drifted.entries, [{ path: "settings.json", state: "drifted" }]);
  await assert.rejects(adapter.uninstall(host.env, { dryRun: false }), refusedWith("drifted", "POLICY_DENIED"));

  tampered.mcpServers.realm.command = "realm";
  writeFileSync(file, `${JSON.stringify(tampered, null, 2)}\n`);
  assert.equal((await adapter.status(noHost)).status, "installed");
  const removed = await adapter.uninstall(host.env, { dryRun: false });
  assert.equal(removed.status, "detected");
  assert.equal(removed.outcome, "removed");
  assert.equal(removed.changed, true);
  assert.equal((await adapter.status(host.env)).status, "detected");
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { z: 1, added: true });
  assert.ok(eventsOf(log.lines).includes("host.uninstall.applied"));
});

void test("a missing owned file is drifted until uninstall, which is then a no-op", async (t) => {
  const { host, adapter } = fixtureAdapter(t, fixtureRecipe("bundle-copy"));
  await adapter.install(host.env, { dryRun: false });
  rmSync(join(host.configHome, "plugins/realm/a.txt"));
  const status = await adapter.status(host.env);
  assert.equal(status.status, "drifted");
  assert.deepEqual(status.entries.map((entry) => [entry.path, entry.state]), [
    ["plugins/realm/a.txt", "missing"],
    ["plugins/realm/b.txt", "ok"],
  ]);
  const json = fixtureAdapter(t, fixtureRecipe("json-merge"));
  await json.adapter.install(json.host.env, { dryRun: false });
  rmSync(join(json.host.configHome, "settings.json"));
  assert.equal((await json.adapter.status(json.host.env)).status, "drifted");
  const outcome = await json.adapter.uninstall(json.host.env, { dryRun: false });
  assert.equal(outcome.outcome, "noop");
  assert.equal((await json.adapter.status(json.host.env)).status, "detected");
});

void test("a pending receipt left by a crash is drifted, and a corrupt receipt is SCHEMA_INVALID", async (t) => {
  const { host, adapter } = fixtureAdapter(t, fixtureRecipe("bundle-copy"), {
    extra: {
      stageHook: (stage, path) => {
        if (stage === "after-change" && path.endsWith("a.txt")) {
          throw new Error("simulated crash");
        }
      },
    },
  });
  await assert.rejects(adapter.install(host.env, { dryRun: false }));
  const status = await adapter.status(host.env);
  assert.equal(status.status, "drifted");
  assert.match(status.detail, /pending/);
  assert.deepEqual(status.entries.map((entry) => entry.state), ["ok", "missing"]);

  writeFileSync(receiptPath(host.stateDir, "claude"), "{ corrupt");
  await assert.rejects(adapter.status(host.env), (error: unknown) => code(error) === "SCHEMA_INVALID");
});

// ---- install and uninstall -------------------------------------------------------------

void test("a dry run through the adapter reports the plan and changes nothing", async (t) => {
  for (const kind of ["json-merge", "text-block", "bundle-copy"] as const) {
    const { host, adapter, log } = fixtureAdapter(t, fixtureRecipe(kind));
    const before = treeHash(host.root);
    const result = await adapter.install(host.env, { dryRun: true });
    assert.equal(result.status, "detected", kind);
    assert.equal(result.changed, false);
    assert.equal(result.dryRun, true);
    assert.equal(result.outcome, "planned");
    assert.ok(result.actions.length > 0);
    assert.equal(treeHash(host.root), before, kind);
    assert.deepEqual(eventsOf(log.lines), ["host.install.plan"]);
  }
});

void test("install refuses a host that is not detected, a recipe that is missing and a relative --config-home", async (t) => {
  const absent = fixtureAdapter(t, fixtureRecipe("json-merge"), { createConfigHome: false });
  const before = treeHash(absent.host.root);
  await assert.rejects(absent.adapter.install(absent.host.env, { dryRun: false }), refusedWith("not-detected", "POLICY_DENIED"));
  assert.equal(treeHash(absent.host.root), before);
  assert.ok(eventsOf(absent.log.lines).includes("host.install.refused"));

  const { reader, calls } = recordingReader();
  const pending = fixtureAdapter(t, null, { extra: { reader } });
  await assert.rejects(pending.adapter.install(pending.host.env, { dryRun: false }), refusedWith("recipe-pending", "POLICY_DENIED"));
  assert.deepEqual(calls, [], "no host file is read before the recipe check");

  const ready = fixtureAdapter(t, fixtureRecipe("json-merge"));
  await assert.rejects(
    ready.adapter.install(ready.host.env, { dryRun: false, configHome: "relative/home" }),
    (error: unknown) => code(error) === "SCHEMA_INVALID",
  );
  await assert.rejects(
    ready.adapter.uninstall(ready.host.env, { dryRun: false, configHome: "relative/home" }),
    (error: unknown) => code(error) === "SCHEMA_INVALID",
  );
});

void test("--config-home replaces the recipe's home and names the host, so an undetected host can be installed into", async (t) => {
  const { host, adapter } = fixtureAdapter(t, fixtureRecipe("json-merge"), { createConfigHome: false });
  const elsewhere = join(host.root, "elsewhere");
  mkdirSync(elsewhere);
  const result = await adapter.install(host.env, { dryRun: false, configHome: elsewhere });
  assert.equal(result.status, "installed");
  assert.ok(existsSync(join(elsewhere, "settings.json")));
  assert.equal(existsSync(host.configHome), false, "the default home is not created");

  await assert.rejects(
    adapter.install(host.env, { dryRun: false, configHome: join(host.root, "no-such-dir") }),
    refusedWith("config-home-missing", "POLICY_DENIED"),
  );
});

void test("uninstall with no receipt is a no-op even when the host is gone", async (t) => {
  const { host, adapter } = fixtureAdapter(t, fixtureRecipe("json-merge"), { createConfigHome: false });
  const before = treeHash(host.root);
  const result = await adapter.uninstall(host.env, { dryRun: false });
  assert.equal(result.outcome, "noop");
  assert.equal(result.changed, false);
  assert.equal(treeHash(host.root), before);
  const none = fixtureAdapter(t, null);
  assert.equal((await none.adapter.uninstall(none.host.env, { dryRun: false })).outcome, "noop");
});

void test("a bundle-copy install reads its files from the adapters directory and uninstall restores the home", async (t) => {
  const { host, adapter } = fixtureAdapter(t, fixtureRecipe("bundle-copy"));
  const before = treeHash(host.configHome);
  const installed = await adapter.install(host.env, { dryRun: false });
  assert.equal(installed.outcome, "installed");
  assert.equal(readFileSync(join(host.configHome, "plugins/realm/a.txt"), "utf8"), "alpha\n");
  assert.equal(readFileSync(join(host.configHome, "plugins/realm/b.txt"), "utf8"), "beta\n");
  assert.equal((await adapter.status(host.env)).status, "installed");
  const removed = await adapter.uninstall(host.env, { dryRun: false });
  assert.equal(removed.outcome, "removed");
  assert.equal(treeHash(host.configHome), before);
});

void test("a symlink inside a bundle source, and a missing source, are refused", async (t) => {
  const { host, adapter } = fixtureAdapter(t, fixtureRecipe("bundle-copy"));
  symlinkSync("a.txt", join(host.adaptersDir, "fixture-bundle", "link.txt"));
  const before = treeHash(host.configHome);
  await assert.rejects(adapter.install(host.env, { dryRun: false }), refusedWith("symlink", "PATH_ESCAPE"));
  assert.equal(treeHash(host.configHome), before);

  const missing = fixtureAdapter(t, { kind: "bundle-copy", source: "no-such-bundle", dest: "plugins/realm" });
  await assert.rejects(missing.adapter.install(missing.host.env, { dryRun: false }), (error: unknown) => code(error) === "SCHEMA_INVALID");
  const escape = fixtureAdapter(t, { kind: "bundle-copy", source: "../outside", dest: "plugins/realm" });
  await assert.rejects(escape.adapter.install(escape.host.env, { dryRun: false }), (error: unknown) => code(error) === "SCHEMA_INVALID");
});

void test("the home is chosen by the recipe's role, and the first existing home of that role wins", async (t) => {
  const host = makeFixtureHost(t);
  const log = captureLog();
  mkdirSync(join(host.home, ".fixture-skills"));
  const entry: HostRuntimeEntry = {
    ...fixtureEntry(null),
    homes: [
      { rel: FIXTURE_HOME_REL, role: "config" },
      { rel: ".fixture-skills", role: "skills" },
      { rel: ".fixture-second", role: "config" },
    ],
    recipe: { kind: "bundle-copy", source: "fixture-bundle", dest: "installed", homeRole: "skills" },
  };
  const skills = createHostAdapter(entry, defaultManifestFor("claude", "1.2.3"), deps(host, log));
  await skills.install(host.env, { dryRun: false });
  assert.ok(existsSync(join(host.home, ".fixture-skills", "installed", "a.txt")));
  assert.equal(existsSync(join(host.configHome, "installed")), false);

  // Two homes of the same role: the one that exists is used, not the first listed.
  const second = makeFixtureHost(t, { createConfigHome: false });
  mkdirSync(join(second.home, ".fixture-second"));
  const config = createHostAdapter({ ...entry, recipe: fixtureRecipe("json-merge") }, defaultManifestFor("claude", "1.2.3"), deps(second, log));
  await config.install(second.env, { dryRun: false });
  assert.ok(existsSync(join(second.home, ".fixture-second", "settings.json")));
  assert.equal(existsSync(join(second.home, FIXTURE_HOME_REL)), false);
  const parsed: unknown = JSON.parse(readFileSync(join(second.home, ".fixture-second", "settings.json"), "utf8"));
  assert.deepEqual(parsed, { mcpServers: { realm: FIXTURE_JSON_VALUE } });
});

// ---- Phase 24: install home by role, env override, mcp role ------------------------------------------------------

void test("an env override moves the config home of an entry whose first home is a skills home, and never the skills home", async (t) => {
  const host = makeFixtureHost(t);
  const log = captureLog();
  const override = join(host.root, "share");
  mkdirSync(override);
  const entry: HostRuntimeEntry = {
    ...fixtureEntry(fixtureRecipe("json-merge")),
    homes: [
      { rel: ".skills", role: "skills" },
      { rel: FIXTURE_HOME_REL, role: "config" },
    ],
    envOverride: "FIXTURE_SHARE_DIR",
  };
  const adapter = createHostAdapter(entry, defaultManifestFor("claude", "1.2.3"), deps(host, log));
  const moved: HostEnv = { ...host.env, env: { FIXTURE_SHARE_DIR: override } };
  await adapter.install(moved, { dryRun: false });
  assert.ok(existsSync(join(override, "settings.json")));
  assert.equal(existsSync(join(host.home, ".skills")), false, "nothing is created under the skills home");
  assert.equal(existsSync(join(host.configHome, "settings.json")), false);

  const plain = makeFixtureHost(t);
  const second = createHostAdapter(entry, defaultManifestFor("claude", "1.2.3"), deps(plain, log));
  await second.install(plain.env, { dryRun: false });
  assert.ok(existsSync(join(plain.configHome, "settings.json")));
  assert.equal(existsSync(join(plain.home, ".skills")), false);
});

void test("a recipe with homeRole mcp writes into the mcp home, and detect lists only the config home", async (t) => {
  const host = makeFixtureHost(t);
  const log = captureLog();
  const entry: HostRuntimeEntry = {
    ...fixtureEntry(null),
    homes: [
      { rel: FIXTURE_HOME_REL, role: "config" },
      { rel: ".", role: "mcp" },
    ],
    recipe: { ...fixtureRecipe("json-merge"), homeRole: "mcp" },
  };
  const adapter = createHostAdapter(entry, defaultManifestFor("claude", "1.2.3"), deps(host, log));
  assert.deepEqual((await adapter.detect(host.env)).homes, [{ path: host.configHome, exists: true, symlink: false }]);
  await adapter.install(host.env, { dryRun: false });
  assert.ok(existsSync(join(host.home, "settings.json")));
  assert.equal(existsSync(join(host.configHome, "settings.json")), false);

  // Without a config home the mcp home alone never makes the machine detected.
  const bare = makeFixtureHost(t, { createConfigHome: false });
  const none = createHostAdapter({ ...entry, binaries: [] }, defaultManifestFor("claude", "1.2.3"), deps(bare, log));
  assert.equal((await none.detect(bare.env)).detected, false);
  await assert.rejects(none.install(bare.env, { dryRun: false }), refusedWith("not-detected", "POLICY_DENIED"));
});

// ---- Phase 24: unreadable entries and launch ----------------------------------------------------------------------

async function installedJson(t: TestContext): Promise<{ host: FixtureHost; adapter: RecipeHostAdapter; file: string; noHost: HostEnv }> {
  const { host, adapter } = fixtureAdapter(t, fixtureRecipe("json-merge"));
  const file = join(host.configHome, "settings.json");
  writeAt(file, `${JSON.stringify({ z: 1 }, null, 2)}\n`);
  await adapter.install(host.env, { dryRun: false });
  return { host, adapter, file, noHost: { home: "", env: {}, pathDirs: [] } };
}

void test("status: a refused or unparseable owned file is unreadable, a parseable file with another owned part is drifted", async (t) => {
  const { host, adapter, file, noHost } = await installedJson(t);
  const original = readFileSync(file, "utf8");
  const stateOf = async (): Promise<readonly [string, string, string]> => {
    const found = await adapter.status(noHost);
    return [found.status, found.entries.map((entry) => entry.state).join(","), found.detail];
  };
  assert.deepEqual(await stateOf(), ["installed", "ok", "installed receipt, 1 of 1 entries intact"]);

  // (a) the owned value edited: drifted.
  const tampered = JSON.parse(original) as { mcpServers: { realm: { command: string } } };
  tampered.mcpServers.realm.command = "evil";
  writeFileSync(file, JSON.stringify(tampered));
  assert.deepEqual(await stateOf(), ["drifted", "drifted", "installed receipt, 0 of 1 entries intact"]);

  // (b) a symlink in place of the file.
  rmSync(file);
  writeFileSync(join(host.root, "elsewhere.json"), original);
  symlinkSync(join(host.root, "elsewhere.json"), file);
  assert.deepEqual(await stateOf(), ["drifted", "unreadable", "installed receipt, 0 of 1 entries intact, 1 unreadable"]);
  rmSync(file);

  // (c) a 2 MiB file.
  writeFileSync(file, JSON.stringify({ pad: "x".repeat(2 * 1024 * 1024) }));
  assert.equal((await stateOf())[1], "unreadable");

  // (d) invalid UTF-8.
  writeFileSync(file, Buffer.from([0xff, 0xfe, 0x7b]));
  assert.equal((await stateOf())[1], "unreadable");

  // (e) not JSON.
  writeFileSync(file, "not json");
  assert.equal((await stateOf())[1], "unreadable");

  // (f) valid JSON without the owned key: drifted, not unreadable.
  writeFileSync(file, JSON.stringify({ z: 1 }));
  assert.deepEqual(await stateOf(), ["drifted", "drifted", "installed receipt, 0 of 1 entries intact"]);

  // (g) the file deleted: missing.
  rmSync(file);
  assert.deepEqual(await stateOf(), ["drifted", "missing", "installed receipt, 0 of 1 entries intact"]);
});

void test("status: a text-block file with a lone marker is unreadable", async (t) => {
  const { host, adapter } = fixtureAdapter(t, fixtureRecipe("text-block"));
  const file = join(host.configHome, "config.toml");
  await adapter.install(host.env, { dryRun: false });
  assert.equal((await adapter.status(host.env)).status, "installed");
  writeFileSync(file, "# BEGIN realm host-plugin\n[mcp_servers.realm]\n");
  const found = await adapter.status(host.env);
  assert.equal(found.status, "drifted");
  assert.deepEqual(found.entries, [{ path: "config.toml", state: "unreadable" }]);
  assert.match(found.detail, /, 1 unreadable$/);
});

void test("status launch: on-path with an executable realm in an absolute PATH directory, not-on-path otherwise, null without a receipt", async (t) => {
  const { host, adapter } = fixtureAdapter(t, fixtureRecipe("json-merge"));
  assert.equal((await adapter.status(host.env)).launch, null, "no receipt");
  await adapter.install(host.env, { dryRun: false });
  const bin = join(host.root, "bin");
  mkdirSync(bin);
  const realm = join(bin, "realm");
  writeFileSync(realm, "#!/bin/sh\n");
  chmodSync(realm, 0o755);
  const withPath = (...pathDirs: string[]): HostEnv => ({ ...host.env, pathDirs });
  assert.equal((await adapter.status(withPath(bin))).launch, "on-path");
  assert.equal((await adapter.status(withPath(join(host.root, "none"), bin))).launch, "on-path");
  assert.equal((await adapter.status(withPath())).launch, "not-on-path");
  assert.equal((await adapter.status(withPath(join(host.root, "absent")))).launch, "not-on-path");
  assert.equal((await adapter.status(withPath("bin"))).launch, "not-on-path", "a relative PATH entry is skipped");
  chmodSync(realm, 0o644);
  assert.equal((await adapter.status(withPath(bin))).launch, "not-on-path", "no execute bit");
  // The resolved path is never part of the result.
  assert.equal(JSON.stringify(await adapter.status(withPath(bin))).includes(host.root), false);
});

void test("status launch is null for an extension host", async (t) => {
  const entry: HostRuntimeEntry = { ...fixtureEntry(fixtureRecipe("bundle-copy")), integration: "extension" };
  const { host, adapter } = fixtureAdapter(t, null, { entry });
  await adapter.install(host.env, { dryRun: false });
  const bin = join(host.root, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "realm"), "#!/bin/sh\n");
  chmodSync(join(bin, "realm"), 0o755);
  assert.equal((await adapter.status({ ...host.env, pathDirs: [bin] })).launch, null);
});

// The `shadows` guard (WAVE2-02, 25-CONTEXT D-25-06): a table entry may name files that an older host version still reads and that a NEW recipe file
// would hide. An install that would CREATE the recipe file while one of them exists is refused as foreign-content, nothing written, in a dry run too.
// Status and uninstall never consult it, and an existing recipe file skips it. Fixture entries only; the real CodeBuddy row is in codebuddy-recipe.test.ts.

import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { SchemaInvalidError } from "../../src/contract/validate.js";
import { createHostAdapter, type RecipeHostAdapter } from "../../src/host/adapter.js";
import { defaultManifestFor } from "../../src/host/manifest.js";
import { receiptPath } from "../../src/host/receipt.js";
import { HostRefusal } from "../../src/host/recipe.js";
import { checkedShadows, HOST_RUNTIMES } from "../../src/host/runtimes.js";
import type { HostShadow } from "../../src/host/types.js";
import {
  captureLog,
  eventsOf,
  fixtureEntry,
  fixtureRecipe,
  makeFixtureHost,
  treeHash,
  writeAt,
  type CapturedLog,
  type FixtureHost,
} from "../support/fixture-host.js";

const SHADOWS: readonly HostShadow[] = [
  { rel: "legacy.json", base: "config" },
  { rel: ".legacy-home.json", base: "home" },
];
const LEGACY = '{"mcpServers":{"mine":{"command":"mine"}}}\n';

function rig(t: TestContext, shadows: readonly HostShadow[] | null = SHADOWS): { host: FixtureHost; log: CapturedLog; adapter: RecipeHostAdapter; file: string } {
  const host = makeFixtureHost(t);
  const log = captureLog();
  const entry = { ...fixtureEntry(fixtureRecipe("json-merge")), ...(shadows === null ? {} : { shadows }) };
  const adapter = createHostAdapter(entry, defaultManifestFor("claude", "1.2.3"), {
    stateDir: host.stateDir,
    adaptersDir: host.adaptersDir,
    logger: log.logger,
    now: () => new Date("2026-01-01T00:00:00.000Z"),
    newCorrelationId: () => "corr-1",
    readTimeoutMs: 2000,
  });
  return { host, log, adapter, file: join(host.configHome, "settings.json") };
}

function refusedForeign(error: unknown): boolean {
  return error instanceof HostRefusal && error.refusal === "foreign-content" && error.code === "POLICY_DENIED";
}

function assertNothingWritten(r: { host: FixtureHost }, before: string): void {
  assert.equal(treeHash(r.host.root), before, "no file changed");
  assert.equal(existsSync(receiptPath(r.host.stateDir, "claude")), false, "no receipt");
  assert.equal(existsSync(join(r.host.stateDir, "audit")), false, "no audit directory");
}

void test("shadows: a config-base shadow refuses the creation of the recipe file, in a dry run too, and writes nothing", async (t) => {
  const r = rig(t);
  writeAt(join(r.host.configHome, "legacy.json"), LEGACY);
  const before = treeHash(r.host.root);
  for (const dryRun of [true, false]) {
    await assert.rejects(r.adapter.install(r.host.env, { dryRun }), refusedForeign);
  }
  assertNothingWritten(r, before);
  assert.equal(readFileSync(join(r.host.configHome, "legacy.json"), "utf8"), LEGACY);
  assert.equal(existsSync(r.file), false);
  assert.deepEqual(eventsOf(r.log.lines), ["host.install.refused", "host.install.refused"]);
  const line: unknown = JSON.parse(r.log.lines[0] ?? "{}");
  assert.ok(typeof line === "object" && line !== null);
  assert.equal("reason" in line && line.reason, "foreign-content");
  assert.equal("code" in line && line.code, "POLICY_DENIED");
  assert.equal("dryRun" in line && line.dryRun, true);
  assert.equal("host" in line && line.host, "claude");
  assert.equal("recipeKind" in line && line.recipeKind, "json-merge");
  assert.equal(r.log.lines.join("\n").includes("legacy"), false, "the refusal line names no path");
});

void test("shadows: a home-base shadow, below the user's home and not the config home, refuses the same way", async (t) => {
  const r = rig(t);
  writeAt(join(r.host.home, ".legacy-home.json"), LEGACY);
  const before = treeHash(r.host.root);
  for (const dryRun of [true, false]) {
    await assert.rejects(r.adapter.install(r.host.env, { dryRun }), refusedForeign);
  }
  assertNothingWritten(r, before);
  // A file of the same name in the config home is not that shadow.
  const other = rig(t);
  writeAt(join(other.host.configHome, ".legacy-home.json"), LEGACY);
  assert.equal((await other.adapter.install(other.host.env, { dryRun: false })).outcome, "installed");
  // And the config-base name below the user's home is not the config-base shadow.
  const third = rig(t);
  writeAt(join(third.host.home, "legacy.json"), LEGACY);
  assert.equal((await third.adapter.install(third.host.env, { dryRun: false })).outcome, "installed");
});

void test("shadows: a dangling symlink at a shadow path counts as present (lstat)", async (t) => {
  for (const base of ["config", "home"] as const) {
    const r = rig(t);
    const dir = base === "config" ? r.host.configHome : r.host.home;
    symlinkSync(join(r.host.root, "nowhere"), join(dir, base === "config" ? "legacy.json" : ".legacy-home.json"));
    const before = treeHash(r.host.root);
    await assert.rejects(r.adapter.install(r.host.env, { dryRun: false }), refusedForeign, base);
    assertNothingWritten(r, before);
  }
});

void test("shadows: when the recipe file already exists the guard is skipped, even with both shadows present", async (t) => {
  const r = rig(t);
  writeAt(r.file, '{"other":1}\n');
  writeAt(join(r.host.configHome, "legacy.json"), LEGACY);
  writeAt(join(r.host.home, ".legacy-home.json"), LEGACY);
  assert.equal((await r.adapter.install(r.host.env, { dryRun: true })).outcome, "planned");
  assert.equal((await r.adapter.install(r.host.env, { dryRun: false })).outcome, "installed");
  assert.equal(readFileSync(join(r.host.configHome, "legacy.json"), "utf8"), LEGACY);
  assert.equal(readFileSync(join(r.host.home, ".legacy-home.json"), "utf8"), LEGACY);
  assert.equal(eventsOf(r.log.lines).includes("host.install.refused"), false);
});

void test("shadows: a recipe file that is a dangling symlink is present, so the guard is skipped and the engine refuses it as a symlink", async (t) => {
  const r = rig(t);
  symlinkSync(join(r.host.root, "nowhere"), r.file);
  writeAt(join(r.host.configHome, "legacy.json"), LEGACY);
  await assert.rejects(r.adapter.install(r.host.env, { dryRun: false }), (error: unknown) => error instanceof HostRefusal && error.refusal === "symlink");
});

void test("shadows: status and uninstall never consult the guard: a shadow that appears after the install changes neither", async (t) => {
  const r = rig(t);
  assert.equal((await r.adapter.install(r.host.env, { dryRun: false })).outcome, "installed");
  writeAt(join(r.host.configHome, "legacy.json"), LEGACY);
  writeAt(join(r.host.home, ".legacy-home.json"), LEGACY);
  assert.equal((await r.adapter.status(r.host.env)).status, "installed");
  assert.equal((await r.adapter.uninstall(r.host.env, { dryRun: true })).outcome, "planned");
  assert.equal((await r.adapter.uninstall(r.host.env, { dryRun: false })).outcome, "removed");
  assert.equal(existsSync(r.file), false, "a file Realm created is removed");
  assert.equal(readFileSync(join(r.host.configHome, "legacy.json"), "utf8"), LEGACY);
  // With no receipt at all, a shadow does not keep status or uninstall from answering.
  const bare = rig(t);
  writeAt(join(bare.host.configHome, "legacy.json"), LEGACY);
  assert.equal((await bare.adapter.status(bare.host.env)).status, "detected");
  assert.equal((await bare.adapter.uninstall(bare.host.env, { dryRun: false })).outcome, "noop");
});

void test("shadows: an install with no shadow present creates the recipe file, and a shadow that is gone again lets a refused install through", async (t) => {
  const r = rig(t);
  const legacy = join(r.host.configHome, "legacy.json");
  writeAt(legacy, LEGACY);
  await assert.rejects(r.adapter.install(r.host.env, { dryRun: false }), refusedForeign);
  rmSync(legacy);
  assert.equal((await r.adapter.install(r.host.env, { dryRun: false })).outcome, "installed");
  assert.equal(existsSync(r.file), true);
});

void test("shadows: an entry without shadows behaves exactly as before", async (t) => {
  for (const shadows of [null, []] as const) {
    const r = rig(t, shadows);
    writeAt(join(r.host.configHome, "legacy.json"), LEGACY);
    writeAt(join(r.host.home, ".legacy-home.json"), LEGACY);
    assert.equal((await r.adapter.install(r.host.env, { dryRun: false })).outcome, "installed");
    assert.equal((await r.adapter.uninstall(r.host.env, { dryRun: false })).outcome, "removed");
  }
});

void test("shadows: an explicit --config-home is the base of a config shadow", async (t) => {
  const r = rig(t);
  const elsewhere = join(r.host.root, "elsewhere");
  writeAt(join(elsewhere, "legacy.json"), LEGACY);
  await assert.rejects(r.adapter.install(r.host.env, { dryRun: false, configHome: elsewhere }), refusedForeign);
  assert.equal(existsSync(join(elsewhere, "settings.json")), false);
  // The default config home holds no shadow, so the same call without --config-home installs.
  assert.equal((await r.adapter.install(r.host.env, { dryRun: false })).outcome, "installed");
});

void test("shadows: a bundle-copy recipe has no recipe file and the guard does not apply", async (t) => {
  const host = makeFixtureHost(t);
  const log = captureLog();
  const entry = { ...fixtureEntry(fixtureRecipe("bundle-copy")), shadows: SHADOWS };
  const adapter = createHostAdapter(entry, defaultManifestFor("claude", "1.2.3"), {
    stateDir: host.stateDir,
    adaptersDir: host.adaptersDir,
    logger: log.logger,
    now: () => new Date("2026-01-01T00:00:00.000Z"),
    newCorrelationId: () => "corr-1",
    readTimeoutMs: 2000,
  });
  writeAt(join(host.configHome, "legacy.json"), LEGACY);
  assert.equal((await adapter.install(host.env, { dryRun: false })).outcome, "installed");
});

void test("shadows: the list is validated: at most 4, each a safe relative path, base home or config", () => {
  const rejects = (shadows: readonly { readonly rel: string; readonly base: string }[]): void => {
    assert.throws(() => checkedShadows(shadows), (error: unknown) => error instanceof SchemaInvalidError && error.code === "SCHEMA_INVALID");
  };
  rejects([{ rel: "../escape.json", base: "home" }]);
  rejects([{ rel: "/abs.json", base: "home" }]);
  rejects([{ rel: "a//b.json", base: "config" }]);
  rejects([{ rel: "", base: "config" }]);
  rejects([{ rel: "a.json", base: "somewhere" }]);
  rejects([{ rel: "a.json", base: "" }]);
  rejects(Array.from({ length: 5 }, (_, index) => ({ rel: `f${String(index)}.json`, base: "home" })));
  const four = Array.from({ length: 4 }, (_, index) => ({ rel: `d/f${String(index)}.json`, base: index % 2 === 0 ? "home" : "config" }));
  const frozen = checkedShadows(four);
  assert.deepEqual(frozen, four);
  assert.equal(Object.isFrozen(frozen), true);
  assert.equal(frozen.every((shadow) => Object.isFrozen(shadow)), true);
  assert.deepEqual(checkedShadows([]), []);
});

void test("shadows: createHostAdapter holds a fixture entry to the same rule as the table", (t) => {
  const host = makeFixtureHost(t);
  const build = (shadows: readonly { readonly rel: string; readonly base: "home" | "config" }[]): RecipeHostAdapter =>
    createHostAdapter({ ...fixtureEntry(fixtureRecipe("json-merge")), shadows }, defaultManifestFor("claude", "1.2.3"), {
      stateDir: host.stateDir,
      adaptersDir: host.adaptersDir,
      logger: captureLog().logger,
      now: () => new Date("2026-01-01T00:00:00.000Z"),
    });
  assert.throws(() => build([{ rel: "../x", base: "home" }]), (error: unknown) => error instanceof SchemaInvalidError);
  assert.doesNotThrow(() => build(SHADOWS));
});

void test("shadows: the table has them for codebuddy only, frozen, and no other row has any", () => {
  const withShadows = Object.values(HOST_RUNTIMES).filter((row) => row.shadows !== undefined);
  assert.deepEqual(withShadows.map((row) => row.id), ["codebuddy"]);
  const shadows = HOST_RUNTIMES.codebuddy.shadows;
  assert.ok(shadows !== undefined);
  assert.equal(Object.isFrozen(shadows), true);
  assert.equal(shadows.every((shadow) => Object.isFrozen(shadow)), true);
});

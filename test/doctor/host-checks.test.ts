// HOST-08: the host-plugins doctor item. It reads receipts under <stateDir>/hosts and nothing else: no real home, no host binary,
// no process environment. Receipts here are real: they come from the installer engine on fixture hosts in a temporary HOME.

import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runChecks } from "../../src/doctor/checks.js";
import { hostPluginsCheck } from "../../src/doctor/host-checks.js";
import { createHostAdapter, type HostAdapterDeps } from "../../src/host/adapter.js";
import { defaultManifestFor } from "../../src/host/manifest.js";
import { receiptPath } from "../../src/host/receipt.js";
import { HOST_RUNTIMES } from "../../src/host/runtimes.js";
import type { HostId, HostRuntimeEntry, InstallRecipe } from "../../src/host/types.js";
import { captureLog, fixtureEntry, fixtureRecipe, makeFixtureHost, type FixtureHost } from "../support/fixture-host.js";

type Table = Readonly<Record<HostId, HostRuntimeEntry>>;

function tableOf(...hosts: readonly (readonly [HostId, InstallRecipe["kind"]])[]): Table {
  let table: Table = HOST_RUNTIMES;
  for (const [id, kind] of hosts) {
    table = { ...table, [id]: { ...fixtureEntry(fixtureRecipe(kind)), id } };
  }
  return table;
}

async function install(host: FixtureHost, table: Table, id: HostId, extra: Partial<HostAdapterDeps> = {}): Promise<void> {
  const adapter = createHostAdapter(table[id], defaultManifestFor(id, "1.2.3"), {
    stateDir: host.stateDir,
    adaptersDir: host.adaptersDir,
    logger: captureLog().logger,
    now: () => new Date("2026-01-01T00:00:00.000Z"),
    readTimeoutMs: 2000,
    ...extra,
  });
  await adapter.install(host.env, { dryRun: false });
}

function check(host: FixtureHost, table: Table, extra: { readonly readTimeoutMs?: number; readonly readDir?: (path: string) => Promise<readonly string[]> } = {}): Promise<Awaited<ReturnType<typeof hostPluginsCheck>>> {
  return hostPluginsCheck({ stateDir: host.stateDir, adapters: table, readTimeoutMs: 2000, ...extra });
}

function ownedValueTamper(host: FixtureHost): void {
  const file = join(host.configHome, "settings.json");
  const parsed = JSON.parse(readFileSync(file, "utf8")) as { mcpServers: { realm: { command: string } } };
  parsed.mcpServers.realm.command = "evil";
  writeFileSync(file, `${JSON.stringify(parsed, null, 2)}\n`);
}

void test("HOST-08: no hosts directory, an empty one, or only unrelated files is a pass with no fix", async (t) => {
  const host = makeFixtureHost(t);
  const table = tableOf(["claude", "json-merge"]);
  const none = await check(host, table);
  assert.deepEqual(none, { id: "host-plugins", status: "pass", detail: "no host plugin installed", fix: null });
  mkdirSync(join(host.stateDir, "hosts"));
  assert.deepEqual(await check(host, table), none);
  writeFileSync(join(host.stateDir, "hosts", "notes.txt"), "not a receipt");
  writeFileSync(join(host.stateDir, "hosts", "claude.receipt.json.tmp"), "{ not a receipt");
  writeFileSync(join(host.stateDir, "hosts", "gemini.receipt.json"), "{ not a host");
  assert.deepEqual(await check(host, table), none);
});

void test("HOST-08: every receipt installed and intact is a pass naming the hosts", async (t) => {
  const host = makeFixtureHost(t);
  const table = tableOf(["claude", "json-merge"], ["windsurf", "text-block"]);
  await install(host, table, "claude");
  await install(host, table, "windsurf");
  assert.deepEqual(await check(host, table), { id: "host-plugins", status: "pass", detail: "installed: claude, windsurf", fix: null });
});

void test("HOST-08: the default runtime table verifies a receipt by the whole-file hash, and passes while the file is as Realm wrote it", async (t) => {
  const host = makeFixtureHost(t);
  await install(host, tableOf(["claude", "json-merge"]), "claude");
  const result = await hostPluginsCheck({ stateDir: host.stateDir });
  assert.equal(result.status, "pass");
  assert.equal(result.detail, "installed: claude");
});

void test("HOST-08: a tampered owned value warns with the host id, never a path or content, and the exact repair command", async (t) => {
  const host = makeFixtureHost(t);
  const table = tableOf(["claude", "json-merge"]);
  await install(host, table, "claude");
  ownedValueTamper(host);
  const result = await check(host, table);
  assert.equal(result.status, "warn");
  assert.match(result.detail, /^host plugin drift: claude: installed receipt, 0 of 1 entries intact$/);
  assert.equal(result.fix, "Repair with realm host install claude, or remove with realm host uninstall claude.");
  for (const leak of [host.configHome, host.home, "evil", "settings.json"]) {
    assert.ok(!result.detail.includes(leak), `detail leaks ${leak}`);
  }
});

void test("HOST-08: a pending receipt left by a crash warns", async (t) => {
  const host = makeFixtureHost(t);
  const table = tableOf(["claude", "json-merge"]);
  await assert.rejects(
    install(host, table, "claude", {
      stageHook: (stage) => {
        if (stage === "after-pending-receipt") {
          throw new Error("simulated crash");
        }
      },
    }),
  );
  const result = await check(host, table);
  assert.equal(result.status, "warn");
  assert.match(result.detail, /^host plugin drift: claude: pending receipt, /);
  assert.match(result.fix ?? "", /realm host install claude/);
});

void test("HOST-08: a receipt whose config home is gone is drifted (warn), not a failure", async (t) => {
  const host = makeFixtureHost(t);
  const table = tableOf(["claude", "json-merge"]);
  await install(host, table, "claude");
  rmSync(host.configHome, { recursive: true, force: true });
  const result = await check(host, table);
  assert.equal(result.status, "warn");
  assert.match(result.detail, /claude: installed receipt, 0 of 1 entries intact/);
});

void test("HOST-08: with several hosts the detail lists each drifted one, and the fix names the first", async (t) => {
  const host = makeFixtureHost(t);
  const table = tableOf(["claude", "json-merge"], ["windsurf", "text-block"]);
  await install(host, table, "claude");
  await install(host, table, "windsurf");
  const config = join(host.configHome, "config.toml");
  writeFileSync(config, readFileSync(config, "utf8").replace('command = "realm"', 'command = "evil"'));
  const onlyWindsurf = await check(host, table);
  assert.equal(onlyWindsurf.status, "warn");
  assert.ok(onlyWindsurf.detail.includes("windsurf:") && !onlyWindsurf.detail.includes("claude:"), onlyWindsurf.detail);
  assert.match(onlyWindsurf.fix ?? "", /realm host install windsurf/);

  ownedValueTamper(host);
  const both = await check(host, table);
  assert.equal(both.status, "warn");
  assert.ok(both.detail.indexOf("claude:") !== -1 && both.detail.indexOf("windsurf:") > both.detail.indexOf("claude:"), both.detail);
  assert.match(both.fix ?? "", /realm host install claude/);
});

void test("HOST-08: a corrupt receipt fails with SCHEMA_INVALID and the host id, and the fix names the hosts directory", async (t) => {
  const host = makeFixtureHost(t);
  const table = tableOf(["claude", "json-merge"]);
  await install(host, table, "claude");
  writeFileSync(receiptPath(host.stateDir, "claude"), "{ corrupt");
  const result = await check(host, table);
  assert.equal(result.status, "fail");
  assert.equal(result.detail, "unreadable host receipt: claude (SCHEMA_INVALID)");
  assert.ok((result.fix ?? "").includes(join(host.stateDir, "hosts")));
});

void test("HOST-08: a symlinked hosts directory fails with PATH_ESCAPE", async (t) => {
  const host = makeFixtureHost(t);
  const elsewhere = join(host.root, "elsewhere-hosts");
  mkdirSync(elsewhere);
  symlinkSync(elsewhere, join(host.stateDir, "hosts"));
  const result = await check(host, tableOf(["claude", "json-merge"]));
  assert.equal(result.status, "fail");
  assert.equal(result.detail, "the hosts directory cannot be read (PATH_ESCAPE)");
  assert.ok((result.fix ?? "").includes(join(host.stateDir, "hosts")));
});

void test("HOST-08: a listing that stalls fails with TOOL_TIMEOUT within the bound, and one that errors fails closed", async (t) => {
  const host = makeFixtureHost(t);
  mkdirSync(join(host.stateDir, "hosts"));
  const table = tableOf(["claude", "json-merge"]);
  const started = Date.now();
  const stalled = await check(host, table, { readTimeoutMs: 50, readDir: () => new Promise<never>(() => undefined) });
  assert.ok(Date.now() - started < 5000, "the check returned at its bound");
  assert.equal(stalled.status, "fail");
  assert.equal(stalled.detail, "the hosts directory cannot be read (TOOL_TIMEOUT)");

  const denied = await check(host, table, { readDir: () => Promise.reject(Object.assign(new Error("denied"), { code: "EACCES" })) });
  assert.equal(denied.status, "fail");
  assert.equal(denied.detail, "the hosts directory cannot be read (PATH_ESCAPE)");

  const vanished = await check(host, table, { readDir: () => Promise.reject(Object.assign(new Error("gone"), { code: "ENOENT" })) });
  assert.equal(vanished.status, "pass");
});

// ---- Through the doctor ----------------------------------------------------------------------------------------------------

function scratch(t: TestContext): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "realm-host-doctor-")));
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

void test("HOST-08: runChecks ends with host-plugins, which ignores HOME entirely: a HOME holding a .claude directory gives the same pass", async (t) => {
  const dir = scratch(t);
  const stateDir = join(dir, "state");
  mkdirSync(stateDir, { mode: 0o700 });
  const emptyPath = join(dir, "empty-path");
  mkdirSync(emptyPath);
  const homeWithClaude = join(dir, "home");
  mkdirSync(join(homeWithClaude, ".claude"), { recursive: true });
  const options = {
    policyPath: join(dir, "policy.json"),
    stateDir,
    runCommand: () => Promise.reject(Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" })),
    connectSocket: () => Promise.reject(Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" })),
  };
  const plain = await runChecks({ ...options, env: { PATH: emptyPath, HOME: join(dir, "no-such-home") } });
  const withHome = await runChecks({ ...options, env: { PATH: emptyPath, HOME: homeWithClaude } });
  const last = plain.at(-1);
  assert.deepEqual(last, { id: "host-plugins", status: "pass", detail: "no host plugin installed", fix: null });
  assert.deepEqual(withHome.at(-1), last);
  assert.equal(plain.filter((item) => item.id === "host-plugins").length, 1);
});

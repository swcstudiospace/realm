// HOST-08: the host-plugins doctor item. It reads receipts under <stateDir>/hosts and nothing else: no real home, no host binary,
// no process environment. Receipts here are real: they come from the installer engine on fixture hosts in a temporary HOME.

import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { runChecks } from "../../src/doctor/checks.js";
import { hostPluginsCheck } from "../../src/doctor/host-checks.js";
import { createHostAdapter, type HostAdapterDeps } from "../../src/host/adapter.js";
import { defaultManifestFor } from "../../src/host/manifest.js";
import { writePresence } from "../../src/host/presence.js";
import { receiptPath } from "../../src/host/receipt.js";
import { HOST_RUNTIMES } from "../../src/host/runtimes.js";
import type { HostId, HostRuntimeEntry } from "../../src/host/types.js";
import { captureLog, fixtureEntry, fixtureRecipe, makeFixtureHost, writeAt, type FixtureHost, type FixtureRecipeKind } from "../support/fixture-host.js";

type Table = Readonly<Record<HostId, HostRuntimeEntry>>;

function tableOf(...hosts: readonly (readonly [HostId, FixtureRecipeKind])[]): Table {
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

function check(host: FixtureHost, table: Table, extra: { readonly readTimeoutMs?: number; readonly readDir?: (path: string) => Promise<readonly string[]>; readonly isProcessAlive?: (pid: number) => boolean } = {}): Promise<Awaited<ReturnType<typeof hostPluginsCheck>>> {
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

// ---- The Omp extension host ------------------------------------------------------------------------------------------------------

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const EXTENSION_REL = join("dist", "src", "omp", "extension.js");

// A fixture host holding an Omp agent directory, the real shim under adapters/omp and a stub extension entry, with the shim installed.
async function installedOmp(t: TestContext): Promise<FixtureHost> {
  const host = makeFixtureHost(t);
  mkdirSync(join(host.home, ".omp", "agent"), { recursive: true });
  writeAt(join(host.adaptersDir, "omp", "index.js"), readFileSync(join(REPO_ROOT, "adapters", "omp", "index.js"), "utf8"));
  writeAt(join(host.root, EXTENSION_REL), "export default function stub() {}\n");
  await install(host, HOST_RUNTIMES, "omp");
  return host;
}

function presenceRecord(pid: number): Parameters<typeof writePresence>[2] {
  return { pid, startedAt: "2026-11-17T10:00:00.000Z", sessionId: "p0123456789ab", attach: "attached", code: null };
}

void test("OMPB-07: an installed Omp with its target present passes and counts live plugin sessions, naming no path", async (t) => {
  const host = await installedOmp(t);
  const none = await check(host, HOST_RUNTIMES, { isProcessAlive: () => true });
  assert.deepEqual(none, { id: "host-plugins", status: "pass", detail: "installed: omp (extension target present, 0 live plugin sessions)", fix: null });
  writePresence(host.stateDir, "omp", presenceRecord(4000000), { isAlive: () => true });
  const one = await check(host, HOST_RUNTIMES, { isProcessAlive: () => true });
  assert.equal(one.detail, "installed: omp (extension target present, 1 live plugin session)");
  assert.equal(one.status, "pass");
  const dead = await check(host, HOST_RUNTIMES, { isProcessAlive: () => false });
  assert.equal(dead.detail, "installed: omp (extension target present, 0 live plugin sessions)", "a dead pid is not counted");
  for (const leak of [host.home, host.root, host.stateDir, "extension.js"]) {
    assert.ok(!one.detail.includes(leak), `detail leaks ${leak}`);
  }
});

void test("OMPB-07: an Omp whose extension target is gone warns with the repair command", async (t) => {
  const host = await installedOmp(t);
  rmSync(join(host.root, EXTENSION_REL));
  const result = await check(host, HOST_RUNTIMES);
  assert.equal(result.status, "warn");
  assert.equal(result.detail, "host plugin drift: omp: extension target missing");
  assert.equal(result.fix, "Repair with realm host install omp, or remove with realm host uninstall omp.");
});

void test("OMPB-07: an unreadable presence marker makes the result a warn with the inspect fix, naming only a count", async (t) => {
  const host = await installedOmp(t);
  writeAt(join(host.stateDir, "hosts", "omp-active", "5.json"), "garbage");
  const result = await check(host, HOST_RUNTIMES, { isProcessAlive: () => true });
  assert.equal(result.status, "warn");
  assert.equal(result.detail, "installed: omp (extension target present, 0 live plugin sessions, 1 unreadable presence marker(s))");
  assert.match(result.fix ?? "", /^Inspect /);
});

void test("OMPB-07: a symlinked presence directory fails with PATH_ESCAPE for omp", async (t) => {
  const host = await installedOmp(t);
  const elsewhere = join(host.root, "elsewhere");
  mkdirSync(elsewhere);
  symlinkSync(elsewhere, join(host.stateDir, "hosts", "omp-active"));
  const result = await check(host, HOST_RUNTIMES);
  assert.equal(result.status, "fail");
  assert.match(result.detail, /omp \(PATH_ESCAPE\)/);
});

void test("BOOT-05: a hand-registered claude with a live marker and no receipt passes and names it by id and count, with no path", async (t) => {
  const host = makeFixtureHost(t);
  writePresence(host.stateDir, "claude", presenceRecord(4000000), { isAlive: () => true });
  const result = await check(host, HOST_RUNTIMES, { isProcessAlive: () => true });
  assert.deepEqual(result, { id: "host-plugins", status: "pass", detail: "no host plugin installed; live host sessions: claude 1", fix: null });
  for (const leak of [host.home, host.root, host.stateDir]) {
    assert.ok(!result.detail.includes(leak), `detail leaks ${leak}`);
  }
  const dead = await check(host, HOST_RUNTIMES, { isProcessAlive: () => false });
  assert.equal(dead.detail, "no host plugin installed", "a dead pid is not counted");
});

void test("BOOT-05: an installed Omp keeps its own sentence and is not repeated; another host's live session is appended", async (t) => {
  const host = await installedOmp(t);
  writePresence(host.stateDir, "omp", presenceRecord(4000000), { isAlive: () => true });
  writePresence(host.stateDir, "claude", presenceRecord(4000001), { isAlive: () => true });
  writePresence(host.stateDir, "kimi", presenceRecord(4000002), { isAlive: () => true });
  const result = await check(host, HOST_RUNTIMES, { isProcessAlive: () => true });
  assert.equal(result.status, "pass");
  assert.equal(result.detail, "installed: omp (extension target present, 1 live plugin session); live host sessions: claude 1, kimi 1");
});

void test("BOOT-05: a drift warn also names the live sessions of other hosts", async (t) => {
  const host = await installedOmp(t);
  rmSync(join(host.root, EXTENSION_REL));
  writePresence(host.stateDir, "claude", presenceRecord(4000001), { isAlive: () => true });
  const result = await check(host, HOST_RUNTIMES, { isProcessAlive: () => true });
  assert.equal(result.status, "warn");
  assert.equal(result.detail, "host plugin drift: omp: extension target missing; live host sessions: claude 1");
  assert.equal(result.fix, "Repair with realm host install omp, or remove with realm host uninstall omp.");
});

void test("BOOT-05: an unreadable marker, or a host whose markers cannot be read, warns with the inspect fix", async (t) => {
  const host = makeFixtureHost(t);
  writeAt(join(host.stateDir, "hosts", "claude-active", "5.json"), "garbage");
  const unreadable = await check(host, HOST_RUNTIMES, { isProcessAlive: () => true });
  assert.equal(unreadable.status, "warn");
  assert.equal(unreadable.detail, "no host plugin installed");
  assert.match(unreadable.fix ?? "", /^Inspect /);
  const other = makeFixtureHost(t);
  mkdirSync(join(other.stateDir, "hosts"), { recursive: true });
  mkdirSync(join(other.root, "elsewhere"));
  symlinkSync(join(other.root, "elsewhere"), join(other.stateDir, "hosts", "codex-active"));
  const unread = await check(other, HOST_RUNTIMES, { isProcessAlive: () => true });
  assert.equal(unread.status, "warn");
  assert.match(unread.fix ?? "", /^Inspect /);
});

void test("BOOT-05: an unreadable receipt is still a fail and its detail carries no live session suffix", async (t) => {
  const host = makeFixtureHost(t);
  writePresence(host.stateDir, "kimi", presenceRecord(4000002), { isAlive: () => true });
  writeAt(join(host.stateDir, "hosts", "claude.receipt.json"), "{ not json");
  const result = await check(host, HOST_RUNTIMES, { isProcessAlive: () => true });
  assert.equal(result.status, "fail");
  assert.ok(!result.detail.includes("live host sessions"), result.detail);
});

void test("ADPT-03: a symlinked owned file adds the unreadable count and the by-hand fix, and a plain edit keeps the reinstall fix", async (t) => {
  const host = makeFixtureHost(t);
  const table = tableOf(["claude", "json-merge"]);
  await install(host, table, "claude");
  const file = join(host.configHome, "settings.json");
  const elsewhere = join(host.root, "elsewhere.json");
  writeFileSync(elsewhere, readFileSync(file));
  rmSync(file);
  symlinkSync(elsewhere, file);
  const result = await check(host, table);
  assert.equal(result.status, "warn");
  assert.match(result.detail, /^host plugin drift: claude: installed receipt, 0 of 1 entries intact, 1 unreadable$/);
  assert.equal(
    result.fix,
    "A file this receipt owns cannot be read or parsed safely (a symlink, a file over 1 MiB, invalid content or a lone Realm marker); inspect it, repair it by hand as docs/hosts/snippets/claude-code.md describes, then run realm host uninstall claude.",
  );
  for (const leak of [host.configHome, host.home, host.root, "elsewhere", "settings.json"]) {
    assert.ok(!result.detail.includes(leak), `detail leaks ${leak}`);
  }

  rmSync(file);
  writeFileSync(file, readFileSync(elsewhere));
  ownedValueTamper(host);
  const edited = await check(host, table);
  assert.equal(edited.fix, "Repair with realm host install claude, or remove with realm host uninstall claude.");
  assert.ok(!edited.detail.includes("unreadable"));
});

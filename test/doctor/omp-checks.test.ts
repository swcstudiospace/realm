// HEALTH-01: the omp-plugin doctor item. Every outcome is pinned over an injected fake probe, so no file is read and
// no host binary runs; one case runs the default probe against a fixture host to prove the real seams pass and that
// the check writes nothing.

import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeRealmError } from "../../src/core/errors.js";
import { runChecks } from "../../src/doctor/checks.js";
import { ompPluginCheck, type OmpPluginProbe, type OmpPluginReading } from "../../src/doctor/omp-checks.js";
import { createHostAdapter } from "../../src/host/adapter.js";
import { defaultManifestFor } from "../../src/host/manifest.js";
import { writePresence } from "../../src/host/presence.js";
import { HOST_RUNTIMES } from "../../src/host/runtimes.js";
import { captureLog, makeFixtureHost, writeAt, type FixtureHost } from "../support/fixture-host.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const EXTENSION_REL = join("dist", "src", "omp", "extension.js");

function fake(state: OmpPluginReading): OmpPluginProbe {
  return () => Promise.resolve(state);
}

void test("HEALTH-01: installed and healthy passes with the live session count and no fix", async () => {
  const result = await ompPluginCheck({ stateDir: "/state", probeTimeoutMs: 1000, probe: fake({ state: "loaded", live: 2, unreadable: 0 }) });
  assert.deepEqual(result, {
    id: "omp-plugin",
    status: "pass",
    detail: "the Omp extension is installed and loaded: 2 live plugin sessions",
    fix: null,
  });
});

void test("HEALTH-01: not installed warns with the install fix", async () => {
  const result = await ompPluginCheck({ stateDir: "/state", probeTimeoutMs: 1000, probe: fake({ state: "not-installed" }) });
  assert.equal(result.status, "warn");
  assert.equal(result.detail, "the Omp extension is not installed");
  assert.match(result.fix ?? "", /realm host install omp/);
});

void test("HEALTH-01: wrong version warns with the rebuild-and-reinstall fix, naming the reason", async () => {
  const result = await ompPluginCheck({
    stateDir: "/state",
    probeTimeoutMs: 1000,
    probe: fake({ state: "wrong-version", reason: "installed receipt, 1 of 2 entries intact" }),
  });
  assert.equal(result.status, "warn");
  assert.equal(result.detail, "the installed Omp extension is not the current build (installed receipt, 1 of 2 entries intact)");
  assert.match(result.fix ?? "", /npm run build/);
  assert.match(result.fix ?? "", /realm host install omp/);
  assert.ok(!(result.detail.includes("/state")), "detail must not name a path");
});

void test("HEALTH-01: not loaded warns with the start-a-session fix", async () => {
  const result = await ompPluginCheck({ stateDir: "/state", probeTimeoutMs: 1000, probe: fake({ state: "not-loaded", live: 0, unreadable: 0 }) });
  assert.equal(result.status, "warn");
  assert.equal(result.detail, "the Omp extension is installed but not loaded: 0 live plugin sessions");
  assert.match(result.fix ?? "", /Start an Omp session/);
});

void test("HEALTH-01: unreadable presence markers warn with the inspect fix and name only a count", async () => {
  const loaded = await ompPluginCheck({ stateDir: "/state", probeTimeoutMs: 1000, probe: fake({ state: "loaded", live: 1, unreadable: 2 }) });
  assert.equal(loaded.status, "warn");
  assert.equal(loaded.detail, "the Omp extension is loaded: 1 live plugin session, 2 unreadable presence marker(s)");
  assert.match(loaded.fix ?? "", /^Inspect /);
  const notLoaded = await ompPluginCheck({ stateDir: "/state", probeTimeoutMs: 1000, probe: fake({ state: "not-loaded", live: 0, unreadable: 1 }) });
  assert.equal(notLoaded.status, "warn");
  assert.match(notLoaded.detail, /1 unreadable presence marker\(s\)$/);
});

void test("HEALTH-01: a probe that times out fails with TOOL_TIMEOUT and a fix, never throws", async () => {
  const result = await ompPluginCheck({
    stateDir: "/state",
    probeTimeoutMs: 20,
    probe: () => new Promise<OmpPluginReading>(() => {}),
  });
  assert.deepEqual(result.status, "fail");
  assert.equal(result.detail, "the Omp plugin state cannot be read (TOOL_TIMEOUT)");
  assert.match(result.fix ?? "", /^Inspect /);
});

void test("HEALTH-01: a probe that throws a catalogue error fails with that code, never throws", async () => {
  const result = await ompPluginCheck({
    stateDir: "/state",
    probeTimeoutMs: 1000,
    probe: () => Promise.reject(makeRealmError("PATH_ESCAPE")),
  });
  assert.equal(result.status, "fail");
  assert.equal(result.detail, "the Omp plugin state cannot be read (PATH_ESCAPE)");
});

void test("HEALTH-01: a probe that throws a non-catalogue error fails with SCHEMA_INVALID, never throws", async () => {
  const result = await ompPluginCheck({
    stateDir: "/state",
    probeTimeoutMs: 1000,
    probe: () => Promise.reject(new Error("boom")),
  });
  assert.equal(result.status, "fail");
  assert.equal(result.detail, "the Omp plugin state cannot be read (SCHEMA_INVALID)");
  assert.ok(!(result.detail.includes("boom")), "detail must not carry probe error text");
});

// ---- The default probe against a real fixture host: receipt from the installer engine, the real shim, a stub entry.

async function installedOmp(t: TestContext): Promise<FixtureHost> {
  const host = makeFixtureHost(t);
  mkdirSync(join(host.home, ".omp", "agent"), { recursive: true });
  writeAt(join(host.adaptersDir, "omp", "index.js"), readFileSync(join(REPO_ROOT, "adapters", "omp", "index.js"), "utf8"));
  writeAt(join(host.root, EXTENSION_REL), "export default function stub() {}\n");
  const adapter = createHostAdapter(HOST_RUNTIMES.omp, defaultManifestFor("omp", "1.2.3"), {
    stateDir: host.stateDir,
    adaptersDir: host.adaptersDir,
    logger: captureLog().logger,
    now: () => new Date("2026-01-01T00:00:00.000Z"),
    readTimeoutMs: 2000,
  });
  await adapter.install(host.env, { dryRun: false });
  return host;
}

function treeOf(root: string): string[] {
  const rows: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, name.name);
      rows.push(name.isDirectory() ? `${path}/` : `${path}:${String(readFileSync(path).length)}`);
      if (name.isDirectory()) {
        walk(path);
      }
    }
  };
  walk(root);
  return rows.sort();
}

void test("HEALTH-01: the default probe passes installed-and-loaded and writes nothing", async (t) => {
  const host = await installedOmp(t);
  writePresence(host.stateDir, "omp", { pid: 4000000, startedAt: "2026-11-17T10:00:00.000Z", sessionId: "p0123456789ab", attach: "attached", code: null }, { isAlive: () => true });
  const before = treeOf(host.stateDir);
  const result = await ompPluginCheck({ stateDir: host.stateDir, probeTimeoutMs: 5000, readTimeoutMs: 2000, isProcessAlive: () => true });
  assert.deepEqual(result, {
    id: "omp-plugin",
    status: "pass",
    detail: "the Omp extension is installed and loaded: 1 live plugin session",
    fix: null,
  });
  assert.deepEqual(treeOf(host.stateDir), before, "the check must not write, remove or repair anything");
});

void test("HEALTH-01: the default probe reports not installed with no receipt and not loaded with no marker", async (t) => {
  const host = makeFixtureHost(t);
  const missing = await ompPluginCheck({ stateDir: host.stateDir, probeTimeoutMs: 5000, readTimeoutMs: 2000 });
  assert.equal(missing.status, "warn");
  assert.equal(missing.detail, "the Omp extension is not installed");

  const installed = await installedOmp(t);
  const idle = await ompPluginCheck({ stateDir: installed.stateDir, probeTimeoutMs: 5000, readTimeoutMs: 2000, isProcessAlive: () => true });
  assert.equal(idle.status, "warn");
  assert.equal(idle.detail, "the Omp extension is installed but not loaded: 0 live plugin sessions");
});

void test("HEALTH-01: the default probe reports a gone extension target as not the current build", async (t) => {
  const host = await installedOmp(t);
  rmSync(join(host.root, EXTENSION_REL));
  const result = await ompPluginCheck({ stateDir: host.stateDir, probeTimeoutMs: 5000, readTimeoutMs: 2000 });
  assert.equal(result.status, "warn");
  assert.equal(result.detail, "the installed Omp extension is not the current build (extension target missing)");
});

void test("HEALTH-01: runChecks appends omp-plugin last, after capability-tokens, with every earlier position unchanged", async (t) => {
  const host = makeFixtureHost(t);
  const results = await runChecks({
    stateDir: host.stateDir,
    runCommand: () => Promise.reject(Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" })),
    connectSocket: () => Promise.reject(Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" })),
    env: { PATH: "/nonexistent", HOME: host.home },
    ompPlugin: fake({ state: "not-installed" }),
  });
  assert.equal(results.at(-1)?.id, "omp-plugin");
  assert.equal(results.at(-2)?.id, "capability-tokens");
  const item = results.at(-1);
  assert.equal(item?.status, "warn");
  assert.equal(item?.detail, "the Omp extension is not installed");
});

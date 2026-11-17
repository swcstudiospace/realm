// realm host (HOST-07): list, detect, status, install and uninstall through the real runCli. On the real table fourteen hosts have an
// install recipe (omp from Phase 22; claude, opencode, codex, kimi and kimi-code from Phase 24; cursor, copilot, qwen, augment, pi,
// cline, antigravity and kilo from Phase 25), so every install of the other 5 refuses as recipe-pending; the generic lifecycle is proven on an injected fixture host through the CliDeps.hostRuntimes and
// CliDeps.hostAdaptersDir seams, the omp recipe on the real table with a fixture package root, and the Phase 24 recipes on the real
// table in test/cli/host-wave1.test.ts, in a temporary HOME and state directory. Nothing touches a real host.

import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { checkAuditFile } from "../../src/audit/chain.js";
import { runCli, type CliDeps, type CliResult } from "../../src/cli/main.js";
import { writePresence } from "../../src/host/presence.js";
import { HOST_RUNTIMES } from "../../src/host/runtimes.js";
import { HOST_IDS, type HostId, type HostRuntimeEntry, type InstallRecipe } from "../../src/host/types.js";
import { fixtureEntry, fixtureRecipe, makeFixtureHost, treeHash, writeAt, type FixtureHost } from "../support/fixture-host.js";

const IMAGE = `registry.example.com/realm/workload@sha256:${"0".repeat(64)}`;
const SECRET = "sk-live-0123456789abcdef0123456789abcdef";
const USAGE_PREFIX = "realm host: usage: realm host list";

interface Rig {
  readonly host: FixtureHost;
  readonly deps: CliDeps;
  readonly settings: string;
  readonly hostLog: string;
  readonly auditFile: string;
  readonly receiptFile: string;
  readonly reads: { count: number };
}

function runtimesWith(entry: HostRuntimeEntry): Readonly<Record<HostId, HostRuntimeEntry>> {
  return { ...HOST_RUNTIMES, [entry.id]: entry };
}

// A fixture host named claude (or `as`), the CLI deps that point at it, and a config reader that counts its calls.
function rig(t: TestContext, options: { readonly recipe?: InstallRecipe | null; readonly as?: HostId; readonly createConfigHome?: boolean } = {}): Rig {
  const host = makeFixtureHost(t, options.createConfigHome === undefined ? {} : { createConfigHome: options.createConfigHome });
  const recipe = options.recipe === undefined ? fixtureRecipe("json-merge") : options.recipe;
  const entry: HostRuntimeEntry = { ...fixtureEntry(recipe), id: options.as ?? "claude" };
  const reads = { count: 0 };
  const deps: CliDeps = {
    env: { HOME: host.home, PATH: "", XDG_CONFIG_HOME: join(host.root, "config") },
    readConfig: () => {
      reads.count += 1;
      return { image: IMAGE, stateDir: host.stateDir, workspaceRoot: join(host.root, "projects") };
    },
    now: () => new Date("2026-01-01T00:00:00.000Z"),
    hostRuntimes: runtimesWith(entry),
    hostAdaptersDir: host.adaptersDir,
  };
  return {
    host,
    deps,
    settings: join(host.configHome, "settings.json"),
    hostLog: join(host.stateDir, "host.log"),
    auditFile: join(host.stateDir, "audit", "host-plugins.jsonl"),
    receiptFile: join(host.stateDir, "hosts", `${entry.id}.receipt.json`),
    reads,
  };
}

function realmHost(r: Rig, ...words: string[]): Promise<CliResult> {
  return runCli(["host", ...words], r.deps);
}

function json(result: CliResult): unknown {
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.ok(result.stdout.endsWith("\n"));
  assert.equal(result.stdout.trimEnd().split("\n").length, 1, "one JSON line");
  return JSON.parse(result.stdout) as unknown;
}

function eventsOfLines(text: string): string[] {
  return text
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => {
      const parsed: unknown = JSON.parse(line);
      assert.ok(typeof parsed === "object" && parsed !== null && "event" in parsed && typeof parsed.event === "string", line);
      return parsed.event;
    });
}

function logEvents(file: string): string[] {
  return existsSync(file) ? eventsOfLines(readFileSync(file, "utf8")) : [];
}

function auditLineCount(file: string): number {
  if (!existsSync(file)) {
    return 0;
  }
  return readFileSync(file, "utf8").split("\n").filter((line) => line !== "").length;
}

function seedSettings(r: Rig, content: Record<string, unknown>): string {
  const text = `${JSON.stringify(content, null, 2)}\n`;
  writeAt(r.settings, text);
  return text;
}

// ---- Usage ------------------------------------------------------------------------------------------------------------------

void test("HOST-07: malformed realm host invocations are usage errors (exit 2, stdout empty) before any config is read", async (t) => {
  const r = rig(t);
  const bad: string[][] = [
    [],
    ["frobnicate"],
    ["list", "extra"],
    ["list", "--dry-run"],
    ["detect", "claude", "codex"],
    ["detect", "--dry-run"],
    ["status", "claude", "--dry-run"],
    ["status", "--config-home", "/abs"],
    ["install"],
    ["install", "--dry-run"],
    ["install", "claude", "codex"],
    ["install", "claude", "--dry-run", "--dry-run"],
    ["install", "claude", "--config-home"],
    ["install", "claude", "--config-home", "relative/home"],
    ["install", "claude", "--config-home", "--dry-run"],
    ["install", "claude", "--config-home", "/abs/one", "--config-home", "/abs/two"],
    ["install", "claude", "--unknown"],
    ["uninstall", "claude", "--unknown"],
    ["uninstall"],
  ];
  for (const words of bad) {
    const result = await realmHost(r, ...words);
    assert.equal(result.exitCode, 2, words.join(" "));
    assert.equal(result.stdout, "", words.join(" "));
    assert.ok(result.stderr.startsWith(USAGE_PREFIX), `${words.join(" ")}: ${result.stderr}`);
    assert.ok(!result.stderr.includes("unknown host"), words.join(" "));
  }
  assert.equal(r.reads.count, 0, "no config was read");
  assert.equal(existsSync(r.hostLog), false);
});

void test("HOST-07: an unknown host is a usage error; gemini and vscode are unknown, and an odd name is echoed as <invalid>", async (t) => {
  const r = rig(t);
  for (const name of ["gemini", "vscode", "CLAUDE", "claude-code"]) {
    for (const sub of ["detect", "status", "install", "uninstall"]) {
      const result = await realmHost(r, sub, name);
      assert.equal(result.exitCode, 2, `${sub} ${name}`);
      assert.equal(result.stdout, "");
      assert.ok(result.stderr.includes(`realm host: unknown host: ${name}\n`), result.stderr);
    }
  }
  for (const name of ["bad name!", "../../etc/passwd", "x".repeat(33), "semi;colon"]) {
    const result = await realmHost(r, "install", name);
    assert.equal(result.exitCode, 2);
    assert.ok(result.stderr.includes("realm host: unknown host: <invalid>\n"), result.stderr);
    assert.ok(!result.stderr.includes(name), "the name is not echoed");
  }
  assert.equal(r.reads.count, 0);
});

// ---- list -------------------------------------------------------------------------------------------------------------------

void test("HOST-07: list needs no config, no HOME and no file system, and names the 19 hosts, recipe ready for the 14 hosts with a recipe and pending for the other 5", async () => {
  const result = await runCli(["host", "list"], { env: {}, readConfig: () => { throw new Error("list must not read the config"); } });
  const rows = json(result) as { id: string; flag: string; aliases: string[]; tier: string; integration: string; homeVerified: boolean; recipe: string }[];
  assert.deepEqual(rows.map((row) => row.id), [...HOST_IDS]);
  assert.equal(rows.length, 19);
  const ready: readonly HostId[] = [
    "omp", "claude", "opencode", "codex", "kimi", "kimi-code",
    "cursor", "copilot", "qwen", "augment", "pi", "cline", "antigravity", "kilo",
  ];
  assert.ok(rows.every((row) => row.recipe === (ready.includes(row.id as HostId) ? "ready" : "pending")));
  assert.equal(rows.filter((row) => row.recipe === "ready").length, 14);
  assert.equal(rows.filter((row) => row.recipe === "pending").length, 5);
  assert.deepEqual(Object.keys(rows[0] ?? {}), ["id", "flag", "aliases", "tier", "integration", "homeVerified", "recipe"]);
  const windsurf = rows.find((row) => row.id === "windsurf");
  assert.deepEqual(windsurf?.aliases, ["devin-desktop"]);
  assert.equal(windsurf.flag, "--windsurf");
  assert.equal(rows.find((row) => row.id === "claude")?.tier, "proven");
  assert.equal(rows.find((row) => row.id === "omp")?.integration, "extension");
  assert.equal(rows.find((row) => row.id === "antigravity")?.homeVerified, true);
});

void test("HOST-07: list reports recipe ready for a host whose runtime entry has a recipe (injected table: the fixture claude replaces the real row; the other 13 recipe rows are ready from the real table)", async (t) => {
  const r = rig(t);
  const rows = json(await realmHost(r, "list")) as { id: string; recipe: string }[];
  assert.equal(rows.find((row) => row.id === "claude")?.recipe, "ready");
  assert.equal(rows.find((row) => row.id === "omp")?.recipe, "ready");
  // The injected claude and the 13 real recipe rows: the 14 hosts with a recipe.
  assert.equal(rows.filter((row) => row.recipe === "ready").length, 14);
});

// ---- detect -----------------------------------------------------------------------------------------------------------------

void test("HOST-07: detect reports every host, honors CLAUDE_CONFIG_DIR from the handed-in environment, and reads no config", async (t) => {
  const { root, home } = makeFixtureHost(t);
  const claudeDir = join(root, "claude-config");
  const reader = (): never => {
    throw new Error("detect must not read the config");
  };
  const absent = json(await runCli(["host", "detect", "claude"], { env: { HOME: home, PATH: "", CLAUDE_CONFIG_DIR: claudeDir }, readConfig: reader })) as {
    id: string;
    detected: boolean;
    homes: { path: string; exists: boolean }[];
    binary: string | null;
  };
  assert.deepEqual(absent, { id: "claude", detected: false, homes: [{ path: claudeDir, exists: false }], binary: null });
  mkdirSync(claudeDir);
  const present = json(await runCli(["host", "detect", "claude"], { env: { HOME: home, PATH: "", CLAUDE_CONFIG_DIR: claudeDir }, readConfig: reader })) as {
    detected: boolean;
    homes: { path: string; exists: boolean }[];
  };
  assert.equal(present.detected, true);
  assert.deepEqual(present.homes, [{ path: claudeDir, exists: true }]);

  const all = json(await runCli(["host", "detect"], { env: { HOME: home, PATH: "" }, readConfig: reader })) as { id: string; detected: boolean }[];
  assert.deepEqual(all.map((row) => row.id), [...HOST_IDS]);
  assert.ok(all.every((row) => !row.detected), "an empty HOME and PATH detect nothing");
});

void test("HOST-07: detect finds a binary on an absolute PATH directory and a home directory under HOME, spawning nothing", async (t) => {
  const { root, home } = makeFixtureHost(t);
  const bin = join(root, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "claude"), "#!/bin/sh\n", { mode: 0o755 });
  mkdirSync(join(home, ".codex"));
  const rows = json(await runCli(["host", "detect"], { env: { HOME: home, PATH: `relative:${bin}` } })) as { id: string; detected: boolean; binary: string | null }[];
  assert.equal(rows.find((row) => row.id === "claude")?.binary, "claude");
  assert.equal(rows.find((row) => row.id === "claude")?.detected, true);
  assert.equal(rows.find((row) => row.id === "codex")?.detected, true);
  assert.equal(rows.find((row) => row.id === "codex")?.binary, null);
  assert.equal(rows.find((row) => row.id === "cursor")?.detected, false);
});

void test("HOST-07: detect with a relative HOME refuses with SCHEMA_INVALID", async () => {
  const result = await runCli(["host", "detect"], { env: { HOME: "relative/home" } });
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "SCHEMA_INVALID\n");
  assert.ok(result.stderr.startsWith("realm host detect: "));
});

// ---- State directory --------------------------------------------------------------------------------------------------------

void test("HOST-07: status, install and uninstall exit 1 with the catalogue code and a fixed text when no state directory resolves", async (t) => {
  const r = rig(t);
  const deps: CliDeps = { ...r.deps, readConfig: () => ({ stateDir: "relative" }) };
  const before = treeHash(r.host.home);
  for (const words of [["status"], ["status", "claude"], ["install", "claude"], ["install", "claude", "--dry-run"], ["uninstall", "claude"]]) {
    const result = await runCli(["host", ...words], deps);
    assert.equal(result.exitCode, 1, words.join(" "));
    assert.equal(result.stdout, "SCHEMA_INVALID\n");
    assert.equal(result.stderr, `realm host ${words[0] ?? ""}: cannot resolve a state directory (run realm init)\n`);
  }
  assert.equal(treeHash(r.host.home), before, "no host file changed");
  assert.equal(existsSync(r.hostLog), false);
  assert.equal(existsSync(join(r.host.stateDir, "audit")), false);
});

// ---- The real table ---------------------------------------------------------------------------------------------------------

void test("HOST-07: on the real table the 5 hosts without a recipe refuse install as recipe-pending (POLICY_DENIED) and change no home file, with or without --dry-run", async (t) => {
  const fx = makeFixtureHost(t);
  const traeHome = join(fx.home, ".trae");
  mkdirSync(traeHome);
  writeFileSync(join(traeHome, "settings.json"), '{"keep":true}\n');
  const deps: CliDeps = {
    env: { HOME: fx.home, PATH: "" },
    readConfig: () => ({ image: IMAGE, stateDir: fx.stateDir, workspaceRoot: join(fx.root, "projects") }),
    now: () => new Date("2026-01-01T00:00:00.000Z"),
  };
  const before = treeHash(fx.home);
  const pending = HOST_IDS.filter((host) => HOST_RUNTIMES[host].recipe === null);
  assert.equal(pending.length, 5);
  for (const id of pending) {
    for (const flags of [[], ["--dry-run"]]) {
      const result = await runCli(["host", "install", id, ...flags], deps);
      assert.equal(result.exitCode, 1, `${id} ${flags.join(" ")}`);
      assert.equal(result.stdout, "POLICY_DENIED\n");
      assert.equal(result.stderr, "realm host install: recipe-pending: no install recipe exists for this host yet\n");
    }
  }
  assert.equal(treeHash(fx.home), before, "no host file changed");
  assert.equal(existsSync(join(fx.stateDir, "audit")), false, "a refusal writes no audit line");
  assert.equal(existsSync(join(fx.stateDir, "hosts")), false, "a refusal writes no receipt");
  const status = json(await runCli(["host", "status", "trae"], deps)) as { id: string; status: string; entries: unknown[] };
  assert.deepEqual(status, { id: "trae", status: "recipe-pending", entries: [] });
  const uninstall = json(await runCli(["host", "uninstall", "trae"], deps)) as { status: string; actions: unknown[] };
  assert.equal(uninstall.status, "noop");
  assert.deepEqual(uninstall.actions, []);
});

void test("WAVE2-03: on the real table install cursor --dry-run plans mcp.json and changes no file, while install trae is still recipe-pending", async (t) => {
  const fx = makeFixtureHost(t);
  mkdirSync(join(fx.home, ".cursor"));
  const deps: CliDeps = {
    env: { HOME: fx.home, PATH: "" },
    readConfig: () => ({ image: IMAGE, stateDir: fx.stateDir, workspaceRoot: join(fx.root, "projects") }),
    now: () => new Date("2026-01-01T00:00:00.000Z"),
  };
  const before = treeHash(fx.home);
  const plan = json(await runCli(["host", "install", "cursor", "--dry-run"], deps)) as { id: string; status: string; dryRun: boolean; actions: { path: string; action: string }[] };
  assert.equal(plan.id, "cursor");
  assert.equal(plan.status, "planned");
  assert.equal(plan.dryRun, true);
  assert.deepEqual(plan.actions.map((action) => [action.path, action.action]), [["mcp.json", "create"]]);
  assert.equal(treeHash(fx.home), before, "dry-run changes no host file");
  assert.equal(existsSync(join(fx.stateDir, "audit")), false, "dry-run writes no audit line");
  assert.equal(existsSync(join(fx.stateDir, "hosts")), false, "dry-run writes no receipt");

  const refused = await runCli(["host", "install", "trae"], deps);
  assert.equal(refused.exitCode, 1);
  assert.equal(refused.stdout, "POLICY_DENIED\n");
  assert.equal(refused.stderr, "realm host install: recipe-pending: no install recipe exists for this host yet\n");
  assert.equal(treeHash(fx.home), before);
});

// ---- The omp recipe on the real table (OMPB-04, OMPB-05) -----------------------------------------------------------------------

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const OMP_SHIM_REL = "extensions/realm/index.js";
const OMP_UNBUILT_LINE = "realm host install: extension-unbuilt: the Realm extension entry is not built; run npm run build in the Realm package\n";
const OMP_LOADED_LINE = "realm host install: already-loaded: the host already loads Realm through a plugin link; remove that link first\n";

interface OmpRig {
  readonly fx: FixtureHost;
  readonly deps: CliDeps;
  readonly agentDir: string;
  readonly extensionPath: string;
  readonly auditFile: string;
  readonly hostLog: string;
  readonly receiptFile: string;
}

// The real table, a temporary HOME with <home>/.omp/agent, and a fixture package root <root>/pkg holding the real shim under
// adapters/omp and (unless asked otherwise) a stub dist/src/omp/extension.js.
function ompRig(t: TestContext, options: { readonly stub?: boolean } = {}): OmpRig {
  const fx = makeFixtureHost(t);
  const agentDir = join(fx.home, ".omp", "agent");
  mkdirSync(agentDir, { recursive: true });
  const pkg = join(fx.root, "pkg");
  writeAt(join(pkg, "adapters", "omp", "index.js"), readFileSync(join(REPO_ROOT, "adapters", "omp", "index.js"), "utf8"));
  const extensionPath = join(pkg, "dist", "src", "omp", "extension.js");
  if (options.stub !== false) {
    writeAt(extensionPath, "export default async function stubExtension() {}\n");
  }
  const deps: CliDeps = {
    env: { HOME: fx.home, PATH: "" },
    readConfig: () => ({ image: IMAGE, stateDir: fx.stateDir, workspaceRoot: join(fx.root, "projects") }),
    now: () => new Date("2026-01-01T00:00:00.000Z"),
    hostAdaptersDir: join(pkg, "adapters"),
  };
  return {
    fx,
    deps,
    agentDir,
    extensionPath,
    auditFile: join(fx.stateDir, "audit", "host-plugins.jsonl"),
    hostLog: join(fx.stateDir, "host.log"),
    receiptFile: join(fx.stateDir, "hosts", "omp.receipt.json"),
  };
}

void test("OMPB-04: on the real table with nothing detected, install omp refuses as not-detected and writes nothing", async (t) => {
  const fx = makeFixtureHost(t);
  const deps: CliDeps = {
    env: { HOME: fx.home, PATH: "" },
    readConfig: () => ({ image: IMAGE, stateDir: fx.stateDir, workspaceRoot: join(fx.root, "projects") }),
    now: () => new Date("2026-01-01T00:00:00.000Z"),
  };
  const before = treeHash(fx.home);
  for (const flags of [[], ["--dry-run"]]) {
    const result = await runCli(["host", "install", "omp", ...flags], deps);
    assert.equal(result.exitCode, 1, flags.join(" "));
    assert.equal(result.stdout, "POLICY_DENIED\n");
    assert.equal(result.stderr, "realm host install: not-detected: the host was not detected on this machine\n");
  }
  assert.equal(treeHash(fx.home), before);
  assert.equal(existsSync(join(fx.stateDir, "audit")), false);
  assert.equal(existsSync(join(fx.stateDir, "hosts")), false);
});

void test("OMPB-04: realm host status omp is detected, not recipe-pending, when the agent directory exists and no receipt does", async (t) => {
  const r = ompRig(t);
  const status = json(await runCli(["host", "status", "omp"], r.deps)) as { id: string; status: string; entries: unknown[] };
  assert.deepEqual(status, {
    id: "omp",
    status: "detected",
    entries: [],
    plugin: { target: null, sessions: { live: 0, stale: 0, unreadable: 0 }, conflicts: [] },
  });
});

void test("OMPB-04: dry-run, install, status, a second install, and uninstall of omp on a fixture package and --config-home", async (t) => {
  const r = ompRig(t);
  const before = treeHash(r.fx.home);
  const configHome = ["--config-home", r.agentDir];
  const run = (...words: string[]): Promise<CliResult> => runCli(["host", ...words], r.deps);

  const dry = json(await run("install", "omp", "--dry-run", ...configHome)) as { id: string; status: string; dryRun: boolean; actions: { path: string; action: string }[] };
  assert.equal(dry.id, "omp");
  assert.equal(dry.status, "planned");
  assert.equal(dry.dryRun, true);
  assert.deepEqual(dry.actions.filter((action) => action.path === OMP_SHIM_REL).map((action) => action.action), ["create"]);
  assert.equal(treeHash(r.fx.home), before, "dry-run changes no host file");
  assert.equal(existsSync(r.auditFile), false, "dry-run writes no audit line");
  assert.equal(existsSync(r.receiptFile), false, "dry-run writes no receipt");
  assert.deepEqual(logEvents(r.hostLog), ["host.install.plan"]);

  const installed = json(await run("install", "omp", ...configHome)) as { id: string; status: string; dryRun: boolean; actions: { path: string }[] };
  assert.equal(installed.status, "installed");
  assert.equal(installed.dryRun, false);
  assert.ok(installed.actions.some((action) => action.path === OMP_SHIM_REL));
  const shim = join(r.agentDir, ...OMP_SHIM_REL.split("/"));
  const text = readFileSync(shim, "utf8");
  assert.ok(text.includes(JSON.stringify(pathToFileURL(r.extensionPath).href)), "the shim names the fixture extension by file URL");
  assert.equal(text.includes("@realm:"), false);
  assert.equal(auditLineCount(r.auditFile), 2);
  const chain = checkAuditFile(r.auditFile);
  assert.equal(chain.ok, true);
  assert.equal(chain.lines, 2);
  assert.ok(logEvents(r.hostLog).includes("host.install.applied"));

  const again = json(await run("install", "omp", ...configHome)) as { status: string; actions: { action: string }[] };
  assert.equal(again.status, "noop");
  assert.ok(again.actions.every((action) => action.action === "noop"));
  assert.equal(auditLineCount(r.auditFile), 2, "a noop adds no audit line");

  const status = json(await run("status", "omp")) as { id: string; status: string; entries: { path: string; state: string }[] };
  assert.deepEqual(status, {
    id: "omp",
    status: "installed",
    entries: [{ path: OMP_SHIM_REL, state: "ok" }],
    plugin: { target: "present", sessions: { live: 0, stale: 0, unreadable: 0 }, conflicts: [] },
  });

  const dryRemove = json(await run("uninstall", "omp", "--dry-run", ...configHome)) as { status: string };
  assert.equal(dryRemove.status, "planned");
  assert.equal(auditLineCount(r.auditFile), 2);
  const removed = json(await run("uninstall", "omp", ...configHome)) as { status: string };
  assert.equal(removed.status, "removed");
  assert.equal(treeHash(r.fx.home), before, "uninstall is the exact inverse of install");
  assert.equal(auditLineCount(r.auditFile), 4);
  assert.equal(checkAuditFile(r.auditFile).ok, true);
  assert.ok(logEvents(r.hostLog).includes("host.uninstall.applied"));
  const after = json(await run("status", "omp")) as { status: string };
  assert.equal(after.status, "detected");
});

void test("OMPB-05: a plugin link refuses install omp with POLICY_DENIED and already-loaded, and writes no receipt or audit line", async (t) => {
  const r = ompRig(t);
  mkdirSync(join(r.fx.home, ".omp", "plugins", "node_modules", "agent-realm"), { recursive: true });
  const before = treeHash(r.fx.home);
  for (const flags of [[], ["--dry-run"], ["--config-home", r.agentDir]]) {
    const result = await runCli(["host", "install", "omp", ...flags], r.deps);
    assert.equal(result.exitCode, 1, flags.join(" "));
    assert.equal(result.stdout, "POLICY_DENIED\n");
    assert.equal(result.stderr, OMP_LOADED_LINE);
  }
  assert.equal(treeHash(r.fx.home), before);
  assert.equal(existsSync(r.receiptFile), false);
  assert.equal(existsSync(r.auditFile), false);
  assert.ok(logEvents(r.hostLog).includes("host.install.refused"));
});

void test("OMPB-05: an unbuilt extension entry refuses install omp with POLICY_DENIED and extension-unbuilt, and writes no receipt or audit line", async (t) => {
  const r = ompRig(t, { stub: false });
  const before = treeHash(r.fx.home);
  for (const flags of [[], ["--dry-run"]]) {
    const result = await runCli(["host", "install", "omp", ...flags], r.deps);
    assert.equal(result.exitCode, 1, flags.join(" "));
    assert.equal(result.stdout, "POLICY_DENIED\n");
    assert.equal(result.stderr, OMP_UNBUILT_LINE);
  }
  assert.equal(treeHash(r.fx.home), before);
  assert.equal(existsSync(r.receiptFile), false);
  assert.equal(existsSync(r.auditFile), false);
});

void test("HOST-07: status reports every host, not-detected when its home is absent", async (t) => {
  const fx = makeFixtureHost(t);
  const deps: CliDeps = {
    env: { HOME: fx.home, PATH: "" },
    readConfig: () => ({ image: IMAGE, stateDir: fx.stateDir, workspaceRoot: join(fx.root, "projects") }),
  };
  const rows = json(await runCli(["host", "status"], deps)) as { id: string; status: string; entries: unknown[] }[];
  assert.deepEqual(rows.map((row) => row.id), [...HOST_IDS]);
  assert.ok(rows.every((row) => row.status === "not-detected" && row.entries.length === 0));
  mkdirSync(join(fx.home, ".trae"));
  const trae = json(await runCli(["host", "status", "trae"], deps)) as { status: string };
  assert.equal(trae.status, "recipe-pending");
  mkdirSync(join(fx.home, ".claude"));
  const claude = json(await runCli(["host", "status", "claude"], deps)) as { status: string };
  assert.equal(claude.status, "detected", "claude has a recipe now: detected, not recipe-pending");
});

// ---- Fixture host lifecycle -------------------------------------------------------------------------------------------------

void test("HOST-07: dry-run install plans and writes nothing; install applies with two verifiable audit lines; a second install is a noop; uninstall restores the exact bytes", async (t) => {
  const r = rig(t);
  const original = seedSettings(r, { apiKey: SECRET, other: "plain host text" });
  const before = treeHash(r.host.home);

  const dry = json(await realmHost(r, "install", "claude", "--dry-run")) as { id: string; status: string; dryRun: boolean; actions: { path: string; action: string; bytes: number }[] };
  assert.deepEqual(dry.actions.map((action) => [action.path, action.action]), [["settings.json", "update"]]);
  assert.equal(dry.id, "claude");
  assert.equal(dry.status, "planned");
  assert.equal(dry.dryRun, true);
  assert.deepEqual(Object.keys(dry.actions[0] ?? {}), ["path", "action", "bytes"]);
  assert.equal(treeHash(r.host.home), before, "dry-run changes no host file");
  assert.equal(existsSync(join(r.host.stateDir, "audit")), false, "dry-run writes no audit line");
  assert.equal(existsSync(join(r.host.stateDir, "hosts")), false, "dry-run writes no receipt");
  assert.deepEqual(logEvents(r.hostLog), ["host.install.plan"]);

  const installed = await realmHost(r, "install", "claude");
  const summary = json(installed) as { id: string; status: string; dryRun: boolean; actions: { path: string; action: string }[] };
  assert.equal(summary.status, "installed");
  assert.equal(summary.dryRun, false);
  assert.deepEqual(summary.actions.map((action) => action.path), ["settings.json"]);
  assert.notEqual(treeHash(r.host.home), before);
  const written = JSON.parse(readFileSync(r.settings, "utf8")) as { mcpServers: { realm: { command: string } }; apiKey: string };
  assert.equal(written.mcpServers.realm.command, "realm");
  assert.equal(written.apiKey, SECRET, "the user's own keys are kept");
  assert.equal(auditLineCount(r.auditFile), 2);
  const chain = checkAuditFile(r.auditFile);
  assert.equal(chain.ok, true);
  assert.equal(chain.lines, 2);
  assert.ok(logEvents(r.hostLog).includes("host.install.applied"));
  for (const artifact of [installed.stdout, installed.stderr, readFileSync(r.hostLog, "utf8"), readFileSync(r.auditFile, "utf8"), readFileSync(r.receiptFile, "utf8")]) {
    assert.ok(!artifact.includes(SECRET), "no secret in any output");
    assert.ok(!artifact.includes("plain host text"), "no host text in any output");
  }

  const again = json(await realmHost(r, "install", "claude")) as { status: string; actions: { action: string }[] };
  assert.equal(again.status, "noop");
  assert.ok(again.actions.every((action) => action.action === "noop"));
  assert.equal(auditLineCount(r.auditFile), 2, "a noop adds no audit line");

  const status = json(await realmHost(r, "status", "claude")) as { id: string; status: string; entries: { path: string; state: string }[]; launch: string };
  assert.deepEqual(status, { id: "claude", status: "installed", entries: [{ path: "settings.json", state: "ok" }], launch: "not-on-path" });

  const dryRemove = json(await realmHost(r, "uninstall", "claude", "--dry-run")) as { status: string };
  assert.equal(dryRemove.status, "planned");
  assert.equal(auditLineCount(r.auditFile), 2);

  const removed = json(await realmHost(r, "uninstall", "claude")) as { status: string };
  assert.equal(removed.status, "removed");
  assert.equal(readFileSync(r.settings, "utf8"), original);
  assert.equal(treeHash(r.host.home), before, "uninstall is the exact inverse of install");
  assert.equal(auditLineCount(r.auditFile), 4);
  assert.equal(checkAuditFile(r.auditFile).ok, true);
  assert.ok(logEvents(r.hostLog).includes("host.uninstall.applied"));
  const after = json(await realmHost(r, "status", "claude")) as { status: string };
  assert.equal(after.status, "detected");
});

void test("HOST-07: options may come in any order, and install accepts the alias devin-desktop for windsurf", async (t) => {
  const r = rig(t, { as: "windsurf" });
  const plan = json(await realmHost(r, "install", "--dry-run", "devin-desktop")) as { id: string; status: string };
  assert.deepEqual(plan, { ...plan, id: "windsurf", status: "planned" });
  const installed = json(await realmHost(r, "install", "windsurf")) as { id: string; status: string };
  assert.equal(installed.id, "windsurf");
  assert.equal(installed.status, "installed");
  assert.ok(existsSync(r.receiptFile), "the receipt is the windsurf receipt");
  const removed = json(await realmHost(r, "uninstall", "devin-desktop")) as { id: string; status: string };
  assert.equal(removed.id, "windsurf");
  assert.equal(removed.status, "removed");
});

void test("HOST-07: a user edit of the owned entry makes uninstall refuse with POLICY_DENIED and change nothing; status reports drifted", async (t) => {
  const r = rig(t);
  seedSettings(r, { other: 1 });
  json(await realmHost(r, "install", "claude"));
  const tampered = JSON.parse(readFileSync(r.settings, "utf8")) as { mcpServers: { realm: { command: string } } };
  tampered.mcpServers.realm.command = "evil";
  writeFileSync(r.settings, `${JSON.stringify(tampered, null, 2)}\n`);
  const auditBefore = auditLineCount(r.auditFile);

  const refused = await realmHost(r, "uninstall", "claude");
  assert.equal(refused.exitCode, 1);
  assert.equal(refused.stdout, "POLICY_DENIED\n");
  assert.equal(refused.stderr, "realm host uninstall: drifted: content that Realm owns was changed after it was written\n");
  assert.ok(logEvents(r.hostLog).includes("host.uninstall.refused"));
  const hostTree = treeHash(r.host.home);
  const status = json(await realmHost(r, "status", "claude")) as { status: string; entries: { state: string }[] };
  assert.equal(status.status, "drifted");
  assert.deepEqual(status.entries.map((entry) => entry.state), ["drifted"]);
  assert.equal(treeHash(r.host.home), hostTree);
  assert.equal(auditLineCount(r.auditFile), auditBefore, "a refusal after the plan adds no audit line");
});

void test("HOST-07: install refuses with POLICY_DENIED when the host is not detected, and --config-home names the host explicitly", async (t) => {
  const r = rig(t, { createConfigHome: false });
  const custom = join(r.host.root, "custom-home");
  mkdirSync(custom);
  const before = treeHash(r.host.home);

  const refused = await realmHost(r, "install", "claude");
  assert.equal(refused.exitCode, 1);
  assert.equal(refused.stdout, "POLICY_DENIED\n");
  assert.equal(refused.stderr, "realm host install: not-detected: the host was not detected on this machine\n");
  assert.equal(treeHash(r.host.home), before);

  const installed = json(await realmHost(r, "install", "claude", "--config-home", custom)) as { status: string };
  assert.equal(installed.status, "installed");
  assert.ok(existsSync(join(custom, "settings.json")), "the explicit home was written");
  assert.equal(existsSync(r.host.configHome), false, "the detected home was not created");
  const removed = json(await realmHost(r, "uninstall", "claude", "--config-home", custom)) as { status: string };
  assert.equal(removed.status, "removed");
});

void test("HOST-07: an explicit --config-home that does not exist refuses with POLICY_DENIED", async (t) => {
  const r = rig(t);
  const result = await realmHost(r, "install", "claude", "--config-home", join(r.host.root, "nowhere"));
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "POLICY_DENIED\n");
  assert.equal(result.stderr, "realm host install: config-home-missing: the host config home does not exist\n");
});

void test("HOST-07: a symlinked host file refuses with PATH_ESCAPE and no --config-home hint, and changes nothing", async (t) => {
  const r = rig(t);
  const elsewhere = join(r.host.root, "elsewhere.json");
  writeFileSync(elsewhere, "{}\n");
  symlinkSync(elsewhere, r.settings);
  const before = treeHash(r.host.home);
  const result = await realmHost(r, "install", "claude");
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "PATH_ESCAPE\n");
  assert.equal(result.stderr, "realm host install: symlink: a symlink lies on the path to a host file\n");
  assert.equal(treeHash(r.host.home), before, "no host file changed");
  assert.equal(readFileSync(elsewhere, "utf8"), "{}\n");
  assert.equal(existsSync(r.auditFile), false);
});

void test("HOST-07: log lines fall back to stderr when host.log cannot be opened, and the command still succeeds", async (t) => {
  const r = rig(t);
  const missing = join(r.host.root, "missing-state");
  const deps: CliDeps = { ...r.deps, readConfig: () => ({ image: IMAGE, stateDir: missing, workspaceRoot: join(r.host.root, "projects") }) };
  const result = await runCli(["host", "install", "claude", "--dry-run"], deps);
  assert.equal(result.exitCode, 0);
  assert.deepEqual(eventsOfLines(result.stderr), ["host.install.plan"]);
  const summary: unknown = JSON.parse(result.stdout);
  assert.ok(typeof summary === "object" && summary !== null && "status" in summary && summary.status === "planned");
});

void test("OMPB-07: realm host status omp counts live plugin sessions and names a duplicate plugin link, with no path", async (t) => {
  const r = ompRig(t);
  const run = (): Promise<CliResult> => runCli(["host", "status", "omp"], r.deps);
  assert.equal((await runCli(["host", "install", "omp"], r.deps)).exitCode, 0);
  writePresence(r.fx.stateDir, "omp", { pid: process.pid, startedAt: "2026-11-17T10:00:00.000Z", sessionId: "p0123456789ab", attach: "attached", code: null });
  writeAt(join(r.fx.stateDir, "hosts", "omp-active", "5.json"), "garbage");
  mkdirSync(join(r.fx.home, ".omp", "plugins", "node_modules", "agent-realm"), { recursive: true });
  const status = json(await run()) as { plugin: { target: string; sessions: { live: number; stale: number; unreadable: number }; conflicts: string[] } };
  assert.equal(status.plugin.target, "present");
  assert.equal(status.plugin.sessions.live, 1);
  assert.equal(status.plugin.sessions.unreadable, 1);
  assert.deepEqual(status.plugin.conflicts, [".omp/plugins/node_modules/agent-realm"]);
  assert.equal(JSON.stringify(status).includes(r.fx.root), false, "no absolute path in the status");
});

void test("OMPB-07: the status row of a host that is not an extension host keeps exactly id, status and entries", async (t) => {
  const r = rig(t);
  const status = json(await realmHost(r, "status", "claude")) as Record<string, unknown>;
  assert.deepEqual(Object.keys(status).sort(), ["entries", "id", "status"]);
});

const MARKER = { startedAt: "2026-11-17T10:00:00.000Z", sessionId: "p0123456789ab", attach: "attached", code: null } as const;

void test("BOOT-05: realm host status claude reports plugin.sessions for live markers, counts only, with no path", async (t) => {
  const r = rig(t);
  writePresence(r.host.stateDir, "claude", { pid: process.pid, ...MARKER });
  const status = json(await realmHost(r, "status", "claude")) as Record<string, unknown>;
  assert.deepEqual(Object.keys(status).sort(), ["entries", "id", "plugin", "status"]);
  assert.deepEqual(status["plugin"], { sessions: { live: 1, stale: 0, unreadable: 0 } });
  assert.equal(JSON.stringify(status).includes(r.host.root), false, "no absolute path in the status");
});

void test("BOOT-05: an unreadable marker alone adds plugin.sessions, and a stale marker alone does not", async (t) => {
  const r = rig(t);
  writePresence(r.host.stateDir, "claude", { pid: 4_194_000, ...MARKER });
  const stale = json(await realmHost(r, "status", "claude")) as Record<string, unknown>;
  assert.deepEqual(Object.keys(stale).sort(), ["entries", "id", "status"]);
  writeAt(join(r.host.stateDir, "hosts", "claude-active", "5.json"), "garbage");
  const unreadable = json(await realmHost(r, "status", "claude")) as Record<string, unknown>;
  assert.deepEqual(unreadable["plugin"], { sessions: { live: 0, stale: 1, unreadable: 1 } });
});

void test("BOOT-05: the all-hosts status keeps the exact row for a host with no markers and adds plugin only where there are some", async (t) => {
  const r = rig(t);
  writePresence(r.host.stateDir, "claude", { pid: process.pid, ...MARKER });
  const rows = json(await realmHost(r, "status")) as { id: string }[];
  assert.equal(rows.length, 19);
  for (const row of rows) {
    const keys = Object.keys(row).sort();
    if (row.id === "claude") {
      assert.deepEqual(keys, ["entries", "id", "plugin", "status"]);
    } else if (row.id === "omp") {
      assert.ok(keys.includes("plugin"), "an extension host keeps its plugin object");
    } else {
      assert.deepEqual(keys, ["entries", "id", "status"], row.id);
    }
  }
});

void test("ADPT-03: status adds launch, between entries and plugin, for an installed mcp-config host only, and never a path", async (t) => {
  const r = rig(t);
  const bin = join(r.host.root, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "realm"), "#!/bin/sh\n");
  chmodSync(join(bin, "realm"), 0o755);
  const onPath: CliDeps = { ...r.deps, env: { ...r.deps.env, PATH: bin } };
  const none = json(await runCli(["host", "status", "claude"], onPath)) as Record<string, unknown>;
  assert.deepEqual(Object.keys(none), ["id", "status", "entries"], "no receipt: no launch key");

  json(await realmHost(r, "install", "claude"));
  const absent = json(await realmHost(r, "status", "claude")) as Record<string, unknown>;
  assert.deepEqual(Object.keys(absent), ["id", "status", "entries", "launch"]);
  assert.equal(absent["launch"], "not-on-path");
  const present = json(await runCli(["host", "status", "claude"], onPath)) as Record<string, unknown>;
  assert.equal(present["launch"], "on-path");
  assert.equal(JSON.stringify(present).includes(r.host.root), false, "no absolute path in the status");

  writePresence(r.host.stateDir, "claude", { pid: process.pid, ...MARKER });
  const withPlugin = json(await runCli(["host", "status", "claude"], onPath)) as Record<string, unknown>;
  assert.deepEqual(Object.keys(withPlugin), ["id", "status", "entries", "launch", "plugin"]);
  const rows = json(await runCli(["host", "status"], onPath)) as { id: string; launch?: string }[];
  assert.deepEqual(rows.filter((row) => row.launch !== undefined).map((row) => row.id), ["claude"]);
});

void test("ADPT-03: a symlinked owned file is reported unreadable, not drifted, by realm host status", async (t) => {
  const r = rig(t);
  seedSettings(r, { other: 1 });
  json(await realmHost(r, "install", "claude"));
  const elsewhere = join(r.host.root, "elsewhere.json");
  writeFileSync(elsewhere, readFileSync(r.settings));
  rmSync(r.settings);
  symlinkSync(elsewhere, r.settings);
  const status = json(await realmHost(r, "status", "claude")) as { status: string; entries: { state: string }[] };
  assert.equal(status.status, "drifted");
  assert.deepEqual(status.entries.map((entry) => entry.state), ["unreadable"]);
});

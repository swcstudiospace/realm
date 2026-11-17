// realm host on the REAL table for the five Phase 24 recipes (ADPT-04..07): detect, dry-run, install, status (with `launch`), a no-op
// reinstall and uninstall through runCli, with an isolated environment (a temporary HOME, a PATH of one temporary directory, the
// override variables set per case) and the runtime config injected through readConfig. No host binary runs and nothing outside the
// temporary root is read or written.

import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli, type CliResult } from "../../src/cli/main.js";
import { HOST_IDS, type HostId } from "../../src/host/types.js";
import { makeFixtureHost, treeHash, type FixtureHost } from "../support/fixture-host.js";
import { filesUnder } from "../support/host-recipe-suite.js";

const IMAGE = `registry.example.com/realm/workload@sha256:${"0".repeat(64)}`;
const WAVE1: readonly HostId[] = ["claude", "opencode", "codex", "kimi", "kimi-code"];

interface Case {
  readonly id: HostId;
  // The detection home below HOME, the directory the file lives in below HOME (claude: HOME itself) and the file.
  readonly detectRel: string;
  readonly installRel: string;
  readonly file: string;
  readonly variable: string;
  // The directory the install lands in when the variable names `base`.
  readonly moved: (base: string) => string;
}

const CASES: readonly Case[] = [
  { id: "claude", detectRel: ".claude", installRel: ".", file: ".claude.json", variable: "CLAUDE_CONFIG_DIR", moved: (base) => base },
  { id: "opencode", detectRel: ".config/opencode", installRel: ".config/opencode", file: "opencode.json", variable: "XDG_CONFIG_HOME", moved: (base) => join(base, "opencode") },
  { id: "codex", detectRel: ".codex", installRel: ".codex", file: "config.toml", variable: "CODEX_HOME", moved: (base) => base },
  { id: "kimi", detectRel: ".kimi", installRel: ".kimi", file: "mcp.json", variable: "KIMI_SHARE_DIR", moved: (base) => base },
  { id: "kimi-code", detectRel: ".kimi-code", installRel: ".kimi-code", file: "mcp.json", variable: "KIMI_CODE_HOME", moved: (base) => base },
];

interface Wave1Rig {
  readonly fx: FixtureHost;
  readonly run: (words: readonly string[], extraEnv?: Readonly<Record<string, string>>) => Promise<CliResult>;
}

// One temporary HOME, one (empty) PATH directory, one state directory, the real table and the real adapters directory.
function rigFor(t: TestContext): Wave1Rig {
  const fx = makeFixtureHost(t, { createConfigHome: false });
  assert.ok(fx.root.startsWith(realpathSync(tmpdir())), "the root is under the temporary directory");
  mkdirSync(join(fx.root, "bin"));
  return {
    fx,
    run: (words, extraEnv = {}) =>
      runCli(["host", ...words], {
        env: { HOME: fx.home, PATH: join(fx.root, "bin"), ...extraEnv },
        readConfig: () => ({ image: IMAGE, stateDir: fx.stateDir, workspaceRoot: join(fx.root, "projects") }),
        now: () => new Date("2026-01-01T00:00:00.000Z"),
      }),
  };
}

// One success line on stdout, nothing on stderr; the parsed value.
function json(result: CliResult): unknown {
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.ok(result.stdout.endsWith("\n"));
  assert.equal(result.stdout.trimEnd().split("\n").length, 1, "one JSON line");
  return JSON.parse(result.stdout);
}

// The `status` field of a success line.
function statusOf(result: CliResult): unknown {
  const value = json(result);
  assert.ok(typeof value === "object" && value !== null && "status" in value);
  return value.status;
}

function noRoot(result: CliResult, root: string): void {
  assert.equal(result.stdout.includes(root), false, "stdout names no temporary path");
  assert.equal(result.stderr.includes(root), false, "stderr names no temporary path");
}

for (const c of CASES) {
  void test(`ADPT-04..07 ${c.id}: detect, dry-run, install, status with launch, no-op reinstall and uninstall through realm host on the real table`, async (t) => {
    const r = rigFor(t);
    const home = r.fx.home;
    const file = join(home, c.installRel, c.file);
    mkdirSync(join(home, c.detectRel), { recursive: true });

    const detected = json(await r.run(["detect", c.id])) as { id: string; detected: boolean; homes: { path: string; exists: boolean }[]; binary: string | null };
    assert.equal(detected.id, c.id);
    assert.equal(detected.detected, true);
    assert.deepEqual(detected.homes.filter((entry) => entry.path === join(home, c.detectRel)), [{ path: join(home, c.detectRel), exists: true }]);
    assert.equal(detected.binary, null);

    const before = treeHash(home);
    const dryResult = await r.run(["install", c.id, "--dry-run"]);
    const dry = json(dryResult) as { id: string; status: string; dryRun: boolean; actions: { path: string; action: string; bytes: number }[] };
    noRoot(dryResult, r.fx.root);
    assert.equal(dry.status, "planned");
    assert.equal(dry.dryRun, true);
    assert.deepEqual(dry.actions.map((action) => [action.path, action.action]), [[c.file, "create"]]);
    assert.equal(treeHash(home), before, "a dry run writes no host file");
    assert.equal(existsSync(join(r.fx.stateDir, "hosts")), false, "and no receipt");

    const installResult = await r.run(["install", c.id]);
    noRoot(installResult, r.fx.root);
    assert.equal(statusOf(installResult), "installed");
    assert.equal(existsSync(file), true);

    const statusResult = await r.run(["status", c.id]);
    noRoot(statusResult, r.fx.root);
    assert.deepEqual(json(statusResult), { id: c.id, status: "installed", entries: [{ path: c.file, state: "ok" }], launch: "not-on-path" });
    const realm = join(r.fx.root, "bin", "realm");
    writeFileSync(realm, "#!/bin/sh\n");
    chmodSync(realm, 0o755);
    assert.deepEqual(json(await r.run(["status", c.id])), { id: c.id, status: "installed", entries: [{ path: c.file, state: "ok" }], launch: "on-path" });

    assert.equal(statusOf(await r.run(["install", c.id])), "noop");

    const removedResult = await r.run(["uninstall", c.id]);
    noRoot(removedResult, r.fx.root);
    assert.equal(statusOf(removedResult), "removed");
    assert.equal(existsSync(file), false);
    assert.deepEqual(json(await r.run(["status", c.id])), { id: c.id, status: "detected", entries: [] });
  });

  void test(`ADPT-04..07 ${c.id}: ${c.variable} redirects the install through realm host`, async (t) => {
    const r = rigFor(t);
    mkdirSync(join(r.fx.home, c.detectRel), { recursive: true });
    const base = join(r.fx.root, "moved");
    mkdirSync(c.moved(base), { recursive: true });
    const env = { [c.variable]: base };
    assert.equal(statusOf(await r.run(["install", c.id], env)), "installed");
    assert.equal(existsSync(join(c.moved(base), c.file)), true);
    assert.equal(existsSync(join(r.fx.home, c.installRel, c.file)), false, "the default home is untouched");
    assert.equal(statusOf(await r.run(["status", c.id], env)), "installed");
    assert.equal(statusOf(await r.run(["uninstall", c.id], env)), "removed");
  });
}

void test("ADPT-04..07: install of a host without a recipe is still recipe-pending, and install claude with an empty HOME and PATH is not-detected", async (t) => {
  const r = rigFor(t);
  const refused = await r.run(["install", "cursor"]);
  assert.equal(refused.exitCode, 1);
  assert.equal(refused.stdout, "POLICY_DENIED\n");
  assert.equal(refused.stderr, "realm host install: recipe-pending: no install recipe exists for this host yet\n");

  const empty = rigFor(t);
  const notDetected = await empty.run(["install", "claude"], { PATH: "" });
  assert.equal(notDetected.exitCode, 1);
  assert.equal(notDetected.stdout, "POLICY_DENIED\n");
  assert.equal(notDetected.stderr, "realm host install: not-detected: the host was not detected on this machine\n");
  assert.equal(existsSync(join(empty.fx.home, ".claude.json")), false);
});

void test("ADPT-04..07: all five installs into one HOME each touch exactly their own file, and status lists five installed rows and no other host", async (t) => {
  const r = rigFor(t);
  const home = r.fx.home;
  for (const c of CASES) {
    mkdirSync(join(home, c.detectRel), { recursive: true });
  }
  for (const c of CASES) {
    const before = new Set(filesUnder(home));
    assert.equal(statusOf(await r.run(["install", c.id])), "installed", c.id);
    const added = filesUnder(home).filter((path) => !before.has(path));
    assert.deepEqual(added, [join(c.installRel, c.file)], `${c.id} added exactly its own file`);
  }
  const rows = json(await r.run(["status"])) as { id: string; status: string }[];
  assert.deepEqual(rows.map((row) => row.id), [...HOST_IDS]);
  assert.deepEqual(rows.filter((row) => row.status === "installed").map((row) => row.id), [...WAVE1]);
  assert.ok(rows.filter((row) => row.status !== "installed").every((row) => row.status === "not-detected"), "every other host is merely not detected");
  assert.deepEqual(filesUnder(home), [".claude.json", ".codex/config.toml", ".config/opencode/opencode.json", ".kimi/mcp.json", ".kimi-code/mcp.json"]);
  for (const c of CASES) {
    assert.equal(statusOf(await r.run(["uninstall", c.id])), "removed", c.id);
  }
  assert.deepEqual(filesUnder(home), []);
  assert.equal(readFileSync(join(r.fx.stateDir, "host.log"), "utf8").includes(r.fx.root), false, "the host log names no root path");
});

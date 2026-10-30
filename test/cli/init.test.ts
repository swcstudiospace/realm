// realm init tests (ONB-01; P15-O1, D-1507). Every test drives the real runCli in a scratch directory with
// explicit modes. The environment names XDG_CONFIG_HOME and XDG_STATE_HOME inside that directory, so no test
// reads or writes the host's configuration. Test titles cite their requirement ID.

import { after, test } from "node:test";
import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CLI_COMMANDS, runCli, type CliResult } from "../../src/cli/main.js";
import { loadPolicyFileDetailed } from "../../src/core/policy.js";
import { loadRuntimeConfig } from "../../src/runtime/config.js";
import { resolveConfigPath } from "../../src/runtime/host-paths.js";
import type { EnvironmentLike } from "../../src/session/paths.js";

const IMAGE = `registry.example.com/realm/workload@sha256:${"a".repeat(64)}`;
const SENTINEL = "SENTINEL-DO-NOT-PRINT-OR-OVERWRITE";

interface Fixture {
  readonly root: string;
  readonly workspace: string;
  readonly env: EnvironmentLike;
  readonly stateDir: string;
  readonly configPath: string;
  readonly policyPath: string;
}

const roots: string[] = [];

after(() => {
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
});

// A fresh scratch root at mode 0755 (so a test can prove a parent keeps its mode), a workspace directory, and an
// environment whose config and state homes both lie inside the root. The state directory is not created.
function fixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), "realm-init-"));
  roots.push(root);
  chmodSync(root, 0o755);
  const workspace = join(root, "workspace");
  mkdirSync(workspace);
  const env: EnvironmentLike = {
    PATH: "/usr/bin",
    HOME: join(root, "home"),
    XDG_CONFIG_HOME: join(root, "config"),
    XDG_STATE_HOME: join(root, "xdg-state"),
  };
  const stateDir = join(root, "state");
  return {
    root,
    workspace,
    env,
    stateDir,
    configPath: join(root, "config", "realm", "config.json"),
    policyPath: join(stateDir, "policy.json"),
  };
}

function runInit(f: Fixture, words: readonly string[], cwd: string = f.root): Promise<CliResult> {
  return runCli(["init", ...words], { env: f.env, cwd });
}

function explicitArgs(f: Fixture): string[] {
  return ["--image", IMAGE, "--workspace", f.workspace, "--state-dir", f.stateDir];
}

function modeOf(path: string): number {
  return statSync(path).mode & 0o777;
}

// Nothing a refused run could have created: neither file, the state directory, nor the config directory.
function assertNothingWritten(f: Fixture): void {
  assert.equal(existsSync(f.configPath), false, "config.json must not be written");
  assert.equal(existsSync(f.policyPath), false, "policy.json must not be written");
  assert.equal(existsSync(f.stateDir), false, "the state directory must not be created");
  assert.equal(existsSync(join(f.root, "config")), false, "the config directory must not be created");
}

void test("realm init writes config.json and policy.json with the exact templates at mode 0600 (ONB-01)", async () => {
  const f = fixture();
  const result = await runInit(f, explicitArgs(f));
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");

  const summary = JSON.parse(result.stdout) as Record<string, unknown>;
  assert.deepEqual(summary, {
    config: f.configPath,
    policy: f.policyPath,
    stateDir: f.stateDir,
    mode: "fail-closed",
  });

  assert.deepEqual(JSON.parse(readFileSync(f.configPath, "utf8")), {
    image: IMAGE,
    stateDir: f.stateDir,
    workspaceRoot: f.workspace,
  });
  assert.deepEqual(JSON.parse(readFileSync(f.policyPath, "utf8")), {
    mode: "fail-closed",
    workspaceRoots: [f.workspace],
  });
  assert.equal(modeOf(f.configPath), 0o600);
  assert.equal(modeOf(f.policyPath), 0o600);
});

void test("the written files load through the daemon's own loaders (ONB-01)", async () => {
  const f = fixture();
  assert.equal((await runInit(f, explicitArgs(f))).exitCode, 0);
  assert.equal(resolveConfigPath(f.env), f.configPath, "init writes at the path the CLI resolves");

  const config = loadRuntimeConfig(JSON.parse(readFileSync(f.configPath, "utf8")) as unknown);
  assert.equal(config.image, IMAGE);
  assert.equal(config.stateDir, f.stateDir);
  assert.equal(config.workspaceRoot, f.workspace);

  const loaded = loadPolicyFileDetailed(f.policyPath);
  assert.equal(loaded.policy.mode, "fail-closed");
  assert.equal(loaded.modeSource, "explicit", "the mode is written explicitly, not left to the default");
});

void test("the state directory is created at mode 0700 and only that directory's mode is set (ONB-01)", async () => {
  const f = fixture();
  const parent = join(f.root, "parent");
  mkdirSync(parent);
  chmodSync(parent, 0o755);
  const stateDir = join(parent, "state");
  const result = await runInit(f, ["--image", IMAGE, "--workspace", f.workspace, "--state-dir", stateDir]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(modeOf(stateDir), 0o700);
  assert.equal(modeOf(parent), 0o755, "a parent directory keeps its own mode");
  assert.equal(modeOf(f.root), 0o755, "the scratch root keeps its own mode");
});

void test("without --state-dir the state directory comes from an absolute XDG_STATE_HOME (ONB-01)", async () => {
  const f = fixture();
  const defaultState = join(f.root, "xdg-state", "realm");
  const result = await runCli(["init", "--image", IMAGE, "--workspace", f.workspace], { env: f.env, cwd: f.root });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(modeOf(defaultState), 0o700);
  const config = JSON.parse(readFileSync(f.configPath, "utf8")) as { readonly stateDir: string };
  assert.equal(config.stateDir, defaultState);
});

void test("the workspace root defaults to the current directory (ONB-01)", async () => {
  const f = fixture();
  const result = await runCli(["init", "--image", IMAGE, "--state-dir", f.stateDir], {
    env: f.env,
    cwd: f.workspace,
  });
  assert.equal(result.exitCode, 0, result.stderr);
  const config = JSON.parse(readFileSync(f.configPath, "utf8")) as { readonly workspaceRoot: string };
  assert.equal(config.workspaceRoot, f.workspace);
});

void test("an existing config.json is refused, named, and left as it was (ONB-01)", async () => {
  const f = fixture();
  mkdirSync(join(f.root, "config", "realm"), { recursive: true });
  writeFileSync(f.configPath, SENTINEL);

  const result = await runInit(f, explicitArgs(f));
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "SCHEMA_INVALID\n");
  assert.match(result.stderr, /refusing to overwrite/);
  assert.ok(result.stderr.includes(f.configPath), "the refusal names the file");
  assert.equal(result.stderr.includes(SENTINEL), false, "the refusal never prints file contents");
  assert.equal(readFileSync(f.configPath, "utf8"), SENTINEL);
  assert.equal(existsSync(f.policyPath), false, "nothing else is written");
  assert.equal(existsSync(f.stateDir), false);
});

void test("an existing policy.json is refused, named, and left as it was (ONB-01)", async () => {
  const f = fixture();
  mkdirSync(f.stateDir, { mode: 0o700 });
  chmodSync(f.stateDir, 0o700);
  writeFileSync(f.policyPath, SENTINEL);

  const result = await runInit(f, explicitArgs(f));
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "SCHEMA_INVALID\n");
  assert.ok(result.stderr.includes(f.policyPath), "the refusal names the file");
  assert.equal(result.stderr.includes(SENTINEL), false, "the refusal never prints file contents");
  assert.equal(readFileSync(f.policyPath, "utf8"), SENTINEL);
  assert.equal(existsSync(f.configPath), false, "config.json is not written when policy.json exists");
});

void test("a symlinked config.json target is refused before any write (ONB-01)", async () => {
  const f = fixture();
  const target = join(f.root, "target.json");
  writeFileSync(target, SENTINEL);
  mkdirSync(join(f.root, "config", "realm"), { recursive: true });
  symlinkSync(target, f.configPath);

  const result = await runInit(f, explicitArgs(f));
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /symbolic link/);
  assert.equal(readFileSync(target, "utf8"), SENTINEL, "the symlink target is untouched");
  assert.equal(lstatSync(f.configPath).isSymbolicLink(), true, "the symlink is left in place");
  assert.equal(existsSync(f.policyPath), false);
});

void test("a dangling symlink at config.json is refused and its target is not created (ONB-01)", async () => {
  const f = fixture();
  const target = join(f.root, "absent.json");
  mkdirSync(join(f.root, "config", "realm"), { recursive: true });
  symlinkSync(target, f.configPath);

  const result = await runInit(f, explicitArgs(f));
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /symbolic link/);
  assert.equal(existsSync(target), false, "a dangling link is not followed to create its target");
});

void test("a symlinked policy.json target is refused before any write (ONB-01)", async () => {
  const f = fixture();
  const target = join(f.root, "policy-target.json");
  writeFileSync(target, SENTINEL);
  mkdirSync(f.stateDir, { mode: 0o700 });
  chmodSync(f.stateDir, 0o700);
  symlinkSync(target, f.policyPath);

  const result = await runInit(f, explicitArgs(f));
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /symbolic link/);
  assert.equal(readFileSync(target, "utf8"), SENTINEL, "the symlink target is untouched");
  assert.equal(existsSync(f.configPath), false);
});

void test("a symlinked state directory is refused (ONB-01)", async () => {
  const f = fixture();
  const real = join(f.root, "real-state");
  mkdirSync(real, { mode: 0o700 });
  chmodSync(real, 0o700);
  symlinkSync(real, f.stateDir);

  const result = await runInit(f, explicitArgs(f));
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /state directory is a symbolic link/);
  assert.equal(existsSync(join(real, "policy.json")), false, "nothing is written through the link");
  assert.equal(existsSync(f.configPath), false);
});

void test("an existing state directory that is not mode 0700 is refused, not changed (ONB-01)", async () => {
  const f = fixture();
  mkdirSync(f.stateDir);
  chmodSync(f.stateDir, 0o755);

  const result = await runInit(f, explicitArgs(f));
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /mode 755/);
  assert.equal(modeOf(f.stateDir), 0o755, "init does not change a directory it did not create");
  assert.equal(existsSync(f.policyPath), false);
});

void test("the digest comes from --image and is written into config.json (ONB-01)", async () => {
  const f = fixture();
  const digest = `sha256:${"0123456789abcdef".repeat(4)}`;
  const image = `localhost/realm-agentos@${digest}`;
  const result = await runCli(
    ["init", "--image", image, "--workspace", f.workspace, "--state-dir", f.stateDir],
    { env: f.env, cwd: f.root },
  );
  assert.equal(result.exitCode, 0, result.stderr);
  const config = JSON.parse(readFileSync(f.configPath, "utf8")) as { readonly image: string };
  assert.equal(config.image, image);
});

void test("no --image anywhere is a usage refusal and writes nothing (ONB-01)", async () => {
  const f = fixture();
  const result = await runInit(f, ["--workspace", f.workspace, "--state-dir", f.stateDir]);
  assert.equal(result.exitCode, 2);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /^realm init: usage: realm init --image/);
  assertNothingWritten(f);
});

void test("a malformed digest is refused and writes nothing (ONB-01)", async () => {
  const malformed = [
    "registry.example.com/realm/workload:latest",
    `registry.example.com/realm/workload@sha256:${"a".repeat(63)}`,
    `registry.example.com/realm/workload@sha256:${"a".repeat(65)}`,
    `registry.example.com/realm/workload@sha256:${"A".repeat(64)}`,
    `registry.example.com/realm/workload@sha256:${"g".repeat(64)}`,
    `@sha256:${"a".repeat(64)}`,
    "",
  ];
  for (const image of malformed) {
    const f = fixture();
    const result = await runCli(
      ["init", "--image", image, "--workspace", f.workspace, "--state-dir", f.stateDir],
      { env: f.env, cwd: f.root },
    );
    assert.equal(result.exitCode, 1, `refused: ${JSON.stringify(image)}`);
    assert.equal(result.stdout, "SCHEMA_INVALID\n");
    assert.match(result.stderr, /digest-pinned reference/);
    assertNothingWritten(f);
  }
});

void test("a relative --workspace is refused and writes nothing (ONB-01)", async () => {
  const f = fixture();
  const result = await runInit(f, ["--image", IMAGE, "--workspace", "relative/dir", "--state-dir", f.stateDir]);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /--workspace must be an absolute path/);
  assertNothingWritten(f);
});

void test("a relative --state-dir is refused and writes nothing (ONB-01)", async () => {
  const f = fixture();
  const result = await runInit(f, ["--image", IMAGE, "--workspace", f.workspace, "--state-dir", "state"]);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /--state-dir must be an absolute path/);
  assertNothingWritten(f);
});

void test("a workspace root that does not exist is refused and writes nothing (ONB-01)", async () => {
  const f = fixture();
  const missing = join(f.root, "missing");
  const result = await runInit(f, ["--image", IMAGE, "--workspace", missing, "--state-dir", f.stateDir]);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /does not exist/);
  assertNothingWritten(f);
});

void test("a state directory inside the workspace is refused and writes nothing (ONB-01)", async () => {
  const f = fixture();
  const inside = join(f.workspace, "state");
  const result = await runCli(["init", "--image", IMAGE, "--workspace", f.workspace, "--state-dir", inside], {
    env: f.env,
    cwd: f.root,
  });
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "POLICY_DENIED\n");
  assert.equal(existsSync(inside), false);
  assert.equal(existsSync(f.configPath), false);
});

void test("a workspace inside the state directory is refused and writes nothing (ONB-01)", async () => {
  const f = fixture();
  const workspace = join(f.stateDir, "workspace");
  mkdirSync(f.stateDir, { mode: 0o700 });
  chmodSync(f.stateDir, 0o700);
  mkdirSync(workspace);
  const result = await runCli(["init", "--image", IMAGE, "--workspace", workspace, "--state-dir", f.stateDir], {
    env: f.env,
    cwd: f.root,
  });
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /inside the state directory/);
  assert.equal(existsSync(f.policyPath), false);
  assert.equal(existsSync(f.configPath), false);
});

void test("a missing config home is refused and writes nothing (ONB-01)", async () => {
  const f = fixture();
  const env: EnvironmentLike = { PATH: "/usr/bin" };
  const result = await runCli(["init", "--image", IMAGE, "--workspace", f.workspace, "--state-dir", f.stateDir], {
    env,
    cwd: f.root,
  });
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /XDG_CONFIG_HOME or HOME/);
  assert.equal(existsSync(f.stateDir), false);
});

void test("unknown, repeated, or valueless flags are usage errors and write nothing (ONB-01)", async () => {
  const f = fixture();
  const invocations: string[][] = [
    [],
    ["--image"],
    ["--image", IMAGE, "--image", IMAGE],
    ["--bogus", "x", "--image", IMAGE],
    ["--image", IMAGE, "--workspace"],
  ];
  for (const words of invocations) {
    const result = await runInit(f, words);
    assert.equal(result.exitCode, 2, JSON.stringify(words));
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /^realm init: usage:/);
    assertNothingWritten(f);
  }
});

void test("init is a catalogued command and appears in the usage (ONB-01)", async () => {
  assert.ok((CLI_COMMANDS as readonly string[]).includes("init"));
  const result = await runCli(["frobnicate"], { env: fixture().env });
  assert.equal(result.exitCode, 2);
  assert.ok(result.stderr.split(/[^A-Za-z]+/).includes("init"));
});

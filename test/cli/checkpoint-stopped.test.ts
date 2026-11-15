// realm checkpoint for a project stopped with realm down (RES-04, D19-10): no registry entry and no daemon. The stopped
// project is resolved from its workspace pin, which `realm up` wrote before the project went down. Every case runs the
// real CLI entry (runCli) over a real workspace, a real state root and a real runtime config file, with no daemon and no
// fake: a daemon call would refuse, so a case that succeeds made none. Every case asserts that no workspaces/<id>.json
// exists, since the command reads the pin and registers nothing.

import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli, type CliDeps, type CliResult } from "../../src/cli/main.js";
import { ERROR_CATALOGUE } from "../../src/core/errors.js";
import { selectionOf } from "../../src/daemon/client.js";
import { bindRoot } from "../../src/fs/root.js";
import { checkpointDirOf, checkpointsDirOf } from "../../src/session/paths.js";
import { workspaceRegistryDirOf } from "../../src/session/workspace-registry.js";
import { writeWorkspacePin } from "../../src/session/workspace-pin.js";
import { testTimeout } from "../support/timing.js";

const IMAGE = `registry.example.com/realm/workload@sha256:${"0".repeat(64)}`;
const CHECKPOINT_ID = "before-edit";
const CASE_BOUND_MS = 30_000;
const BINARY_MODE = 0o751;
const PRIVATE_MODE = 0o600;

interface Layout {
  readonly base: string;
  readonly workspace: string;
  readonly stateDir: string;
  readonly configHome: string;
  readonly sessionId: string;
}

// One scratch directory holds the workspace, the state root outside it, and the runtime config that names the state root.
// The workspace has a binary file, a nested file, a private file and a file that a case removes; its mode and bytes are
// the reference for the restore checks.
function layoutOf(t: TestContext): Layout {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "rcs-")));
  t.after(() => {
    rmSync(base, { recursive: true, force: true });
  });
  const workspace = join(base, "ws");
  const stateDir = join(base, "realm");
  const configHome = join(base, "config");
  mkdirSync(join(workspace, "bin"), { recursive: true });
  mkdirSync(join(workspace, "nested", "deep"), { recursive: true });
  mkdirSync(join(configHome, "realm"), { recursive: true });
  writeFileSync(join(workspace, "a.txt"), "alpha\n");
  writeFileSync(join(workspace, "bin", "tool.bin"), binaryBytes());
  chmodSync(join(workspace, "bin", "tool.bin"), BINARY_MODE);
  writeFileSync(join(workspace, "nested", "deep", "c.txt"), "gamma\n");
  writeFileSync(join(workspace, "doomed.txt"), "deleted after the checkpoint\n");
  writeFileSync(join(workspace, "private.txt"), "secret-shaped but ordinary\n");
  chmodSync(join(workspace, "private.txt"), PRIVATE_MODE);
  writeConfig(configHome, stateDir, workspace);
  return { base, workspace, stateDir, configHome, sessionId: selectionOf(workspace).sessionId };
}

function writeConfig(configHome: string, stateDir: string, workspace: string): void {
  writeFileSync(
    join(configHome, "realm", "config.json"),
    JSON.stringify({ image: IMAGE, stateDir, workspaceRoot: workspace }),
  );
}

// 256 distinct byte values, four times, so a byte-level change anywhere in the file is visible.
function binaryBytes(): Buffer {
  const once = Buffer.from(Array.from({ length: 256 }, (_, value) => value));
  return Buffer.concat([once, once, once, once]);
}

// Every entry below the root, keyed by its relative path: type, permission bits, and content or link target. The root itself is
// not in the map, because the checkpoint keeps the root and never copies it.
function treeOf(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (current: string, prefix: string): void => {
    for (const name of readdirSync(current)) {
      const path = join(current, name);
      const rel = prefix === "" ? name : `${prefix}/${name}`;
      const stats = lstatSync(path);
      const mode = (stats.mode & 0o7777).toString(8);
      if (stats.isSymbolicLink()) {
        out[rel] = `link ${readlinkSync(path)}`;
      } else if (stats.isDirectory()) {
        out[rel] = `dir ${mode}`;
        walk(path, rel);
      } else {
        out[rel] = `file ${mode} ${readFileSync(path).toString("base64")}`;
      }
    }
  };
  walk(dir, "");
  return out;
}

// The checkpoint and the registry the command must not create: a stopped project is pinned in the state root and nothing else.
function assertNoRegistry(layout: Layout): void {
  assert.equal(existsSync(join(workspaceRegistryDirOf(layout.stateDir), `${layout.sessionId}.json`)), false, "no workspaces/<id>.json may exist");
  assert.equal(existsSync(workspaceRegistryDirOf(layout.stateDir)), false, "no registry directory may be created");
}

function run(args: readonly string[], layout: Layout): Promise<CliResult> {
  const deps: CliDeps = { env: { HOME: join(layout.base, "home"), XDG_CONFIG_HOME: layout.configHome } };
  return runCli(["checkpoint", ...args], deps);
}

function assertRefused(result: { exitCode: number; stdout: string; stderr: string }, code: keyof typeof ERROR_CATALOGUE): void {
  assert.equal(result.exitCode, 1, result.stderr);
  assert.equal(result.stdout, `${code}\n`);
  assert.equal(result.stderr, `${ERROR_CATALOGUE[code].reason}\n`);
}

void test("RES-04 stopped: a pinned, unregistered project round-trips binary, nested, deleted and extra files byte for byte, and keeps its root", testTimeout(CASE_BOUND_MS), async (t) => {
  const layout = layoutOf(t);
  writeWorkspacePin(layout.stateDir, bindRoot(layout.workspace), layout.sessionId);
  const original = treeOf(layout.workspace);
  const rootBefore = statSync(layout.workspace);

  const created = await run(["create", "--workspace", layout.workspace, "--id", CHECKPOINT_ID], layout);
  assert.equal(created.exitCode, 0, created.stderr);
  assert.equal(created.stderr, "");
  assert.deepEqual(JSON.parse(created.stdout), { command: "create", checkpointId: CHECKPOINT_ID, entries: Object.keys(original).length });
  assert.ok(existsSync(join(checkpointDirOf(layout.stateDir, layout.sessionId, CHECKPOINT_ID), "manifest.json")), "the checkpoint manifest must be written");
  assertNoRegistry(layout);

  // Changes after the checkpoint: the binary is rewritten and its mode changed, a nested file is removed, one file is deleted,
  // and two files are added, one at the top and one nested.
  writeFileSync(join(layout.workspace, "a.txt"), "edited\n");
  writeFileSync(join(layout.workspace, "bin", "tool.bin"), "replaced binary\n");
  chmodSync(join(layout.workspace, "bin", "tool.bin"), PRIVATE_MODE);
  rmSync(join(layout.workspace, "nested", "deep", "c.txt"));
  rmSync(join(layout.workspace, "doomed.txt"));
  writeFileSync(join(layout.workspace, "extra.txt"), "added after the checkpoint\n");
  writeFileSync(join(layout.workspace, "nested", "extra.txt"), "nested addition\n");

  const restored = await run(["restore", "--workspace", layout.workspace, "--id", CHECKPOINT_ID], layout);
  assert.equal(restored.exitCode, 0, restored.stderr);
  assert.equal(restored.stderr, "");
  assert.deepEqual(JSON.parse(restored.stdout), { command: "restore", checkpointId: CHECKPOINT_ID, entries: Object.keys(original).length });

  assert.deepEqual(treeOf(layout.workspace), original, "the restored tree must equal the checkpointed tree, bytes and modes");
  assert.equal(existsSync(join(layout.workspace, "extra.txt")), false, "the file added after the checkpoint must be removed");
  assert.equal(existsSync(join(layout.workspace, "nested", "extra.txt")), false, "the nested file added after the checkpoint must be removed");
  assert.equal(readFileSync(join(layout.workspace, "doomed.txt"), "utf8"), "deleted after the checkpoint\n", "the deleted file must return");
  assert.equal((statSync(join(layout.workspace, "bin", "tool.bin")).mode & 0o7777).toString(8), BINARY_MODE.toString(8), "the binary's mode must return");
  const rootAfter = statSync(layout.workspace);
  assert.equal(rootAfter.dev, rootBefore.dev, "the workspace root must stay on the same device");
  assert.equal(rootAfter.ino, rootBefore.ino, "the workspace root must keep its inode");
  assertNoRegistry(layout);
});

void test("RES-04 stopped: a project with neither a registry entry nor a pin is refused REALM_UNBOUND, and nothing is written", testTimeout(CASE_BOUND_MS), async (t) => {
  const layout = layoutOf(t);
  const before = treeOf(layout.workspace);

  assertRefused(await run(["create", "--workspace", layout.workspace, "--id", CHECKPOINT_ID], layout), "REALM_UNBOUND");
  assertRefused(await run(["restore", "--workspace", layout.workspace, "--id", CHECKPOINT_ID], layout), "REALM_UNBOUND");

  assert.deepEqual(treeOf(layout.workspace), before, "the workspace must be untouched");
  assert.equal(existsSync(checkpointsDirOf(layout.stateDir)), false, "no checkpoint may be written");
  assertNoRegistry(layout);
});

void test("RES-04 stopped: a workspace directory replaced at the same path while down is refused POLICY_DENIED, and the replacement is untouched", testTimeout(CASE_BOUND_MS), async (t) => {
  const layout = layoutOf(t);
  writeWorkspacePin(layout.stateDir, bindRoot(layout.workspace), layout.sessionId);
  renameSync(layout.workspace, join(layout.base, "ws-original"));
  mkdirSync(layout.workspace);
  writeFileSync(join(layout.workspace, "replacement.txt"), "a different directory\n");
  const replacement = treeOf(layout.workspace);

  assertRefused(await run(["create", "--workspace", layout.workspace, "--id", CHECKPOINT_ID], layout), "POLICY_DENIED");
  assertRefused(await run(["restore", "--workspace", layout.workspace, "--id", CHECKPOINT_ID], layout), "POLICY_DENIED");

  assert.deepEqual(treeOf(layout.workspace), replacement, "the replacement directory must be untouched");
  assert.equal(existsSync(checkpointsDirOf(layout.stateDir)), false, "no checkpoint may be written");
  assertNoRegistry(layout);
});

void test("RES-04 stopped: a state root inside the workspace is refused POLICY_DENIED before any write", testTimeout(CASE_BOUND_MS), async (t) => {
  const layout = layoutOf(t);
  const insideState = join(layout.workspace, "state");
  writeConfig(layout.configHome, insideState, layout.workspace);
  writeWorkspacePin(insideState, bindRoot(layout.workspace), layout.sessionId);
  const before = treeOf(layout.workspace);

  assertRefused(await run(["create", "--workspace", layout.workspace, "--id", CHECKPOINT_ID], layout), "POLICY_DENIED");

  assert.deepEqual(treeOf(layout.workspace), before, "the workspace must be untouched");
  assert.equal(existsSync(checkpointsDirOf(insideState)), false, "no checkpoint may be written under the state root");
  assert.equal(existsSync(workspaceRegistryDirOf(insideState)), false, "no registry directory may be created");
});

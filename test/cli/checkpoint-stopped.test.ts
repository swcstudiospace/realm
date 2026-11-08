// realm checkpoint for a project stopped with realm down (RES-04): no registry entry, usually no daemon, no container.
// The workspace, the state root, the pinned roots and the checkpoint library are real; the daemon's status answer, the
// policy read and the Podman inspect are the only fakes. Every case asserts that no workspaces/<id>.json exists, since
// the command pins the workspace in memory and registers nothing.

import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Policy } from "../../src/contract/validate.js";
import { validate } from "../../src/contract/validate.js";
import { ERROR_CATALOGUE, RealmError } from "../../src/core/errors.js";
import {
  PODMAN_PROOF_TIMEOUT_MS,
  pinStoppedProject,
  runCheckpointCommand,
  type CheckpointDeps,
} from "../../src/cli/checkpoint.js";
import { runCli, type CliDeps } from "../../src/cli/main.js";
import { DaemonAbsentError } from "../../src/daemon/channel.js";
import { selectionOf, type DaemonClient, type DaemonStatus } from "../../src/daemon/client.js";
import { bindRoot } from "../../src/fs/root.js";
import { realmSandboxName } from "../../src/runtime/openshell.js";
import { snapshotWorkspace } from "../../src/session/checkpoint.js";
import { workspaceRegistryDirOf } from "../../src/session/workspace-registry.js";

type DaemonMode = "unbound" | "active" | "absent" | "silent" | "error-reply" | "dropped";
type PodmanMode = "absent" | "running" | "exited" | "throws" | "hangs";

interface Fixture {
  readonly root: string;
  readonly workspace: string;
  readonly outside: string;
  readonly stateDir: string;
  readonly sessionId: string;
  readonly policyRoots: string[];
  readonly daemon: { mode: DaemonMode; connects: number };
  readonly podman: { mode: PodmanMode; calls: string[] };
  readonly deps: CheckpointDeps;
}

function policyOf(roots: readonly string[]): Policy {
  const result = validate("policy", { workspaceRoots: roots });
  assert.ok(result.ok, "the policy fixture must validate");
  return result.value;
}

function statusOf(state: "unbound" | "active"): DaemonStatus {
  return {
    snapshot: { state, reason: "stopped project test", lastTransitionAt: "2026-11-08T00:00:00.000Z" },
    display: { label: "realm active", degraded: false, reason: "realm active", lastTransitionAt: "2026-11-08T00:00:00.000Z" },
    mode: "advisory",
    sessionId: "p0123456789ab",
  };
}

function statusFor(mode: DaemonMode): Promise<DaemonStatus> {
  switch (mode) {
    case "unbound":
      return Promise.resolve(statusOf("unbound"));
    case "active":
      return Promise.resolve(statusOf("active"));
    case "absent":
      return Promise.reject(new DaemonAbsentError());
    case "silent":
      return Promise.reject(new RealmError("TOOL_TIMEOUT"));
    case "error-reply":
      return Promise.reject(new RealmError("SCHEMA_INVALID"));
    case "dropped":
      return Promise.reject(new RealmError("REALM_NOT_ACTIVE"));
  }
}

// A workspace under <root>/projects, a second project under <root>/outside, and the state directory under <root>. The
// configured workspace root is <root>/projects; the policy root is <root>.
function fixture(t: TestContext): Fixture {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "realm-ckpt-stopped-")));
  t.after(() => {
    rmSync(root, { recursive: true, force: true });
  });
  const projects = join(root, "projects");
  const workspace = join(projects, "app");
  const outside = join(root, "outside");
  const stateDir = join(root, "state");
  mkdirSync(projects);
  mkdirSync(workspace);
  mkdirSync(join(workspace, "nested"));
  mkdirSync(outside);
  writeFileSync(join(workspace, "a.txt"), "alpha\n");
  writeFileSync(join(workspace, "nested", "b.txt"), "beta\n");
  const policyRoots = [root];
  const daemon: { mode: DaemonMode; connects: number } = { mode: "absent", connects: 0 };
  const podman: { mode: PodmanMode; calls: string[] } = { mode: "absent", calls: [] };
  const client: DaemonClient = {
    status: () => statusFor(daemon.mode),
    up: () => Promise.reject(new RealmError("REALM_NOT_ACTIVE")),
    call: () => Promise.reject(new RealmError("REALM_NOT_ACTIVE")),
    metrics: () => Promise.reject(new RealmError("REALM_NOT_ACTIVE")),
    close: () => undefined,
  };
  const deps: CheckpointDeps = {
    env: { HOME: join(root, "home"), XDG_CONFIG_HOME: join(root, "config") },
    readConfig: () => ({
      image: `registry.example.com/realm/workload@sha256:${"0".repeat(64)}`,
      stateDir,
      workspaceRoot: projects,
    }),
    readPolicy: () => policyOf(policyRoots),
    connect: () => {
      daemon.connects += 1;
      return client;
    },
    inspectContainer: (name) => {
      podman.calls.push(name);
      switch (podman.mode) {
        case "absent":
          return Promise.resolve(null);
        case "running":
          return Promise.resolve({ State: { Status: "running" } });
        case "exited":
          return Promise.resolve({ State: { Status: "exited" } });
        case "throws":
          return Promise.reject(new RealmError("REALM_NOT_ACTIVE"));
        case "hangs":
          return new Promise<never>(() => undefined);
      }
    },
  };
  return { root, workspace, outside, stateDir, sessionId: selectionOf(workspace).sessionId, policyRoots, daemon, podman, deps };
}

function argv(command: "create" | "restore", workspace: string, id: string): string[] {
  return [command, "--workspace", workspace, "--id", id];
}

function registryFileOf(fx: Fixture): string {
  return join(workspaceRegistryDirOf(fx.stateDir), `${fx.sessionId}.json`);
}

function assertNoRegistry(fx: Fixture): void {
  assert.equal(existsSync(registryFileOf(fx)), false, "no workspaces/<id>.json may exist");
  assert.equal(existsSync(workspaceRegistryDirOf(fx.stateDir)), false, "no registry directory may be created");
}

function assertNothingWritten(fx: Fixture): void {
  assertNoRegistry(fx);
  assert.equal(existsSync(join(fx.stateDir, "checkpoints")), false, "no checkpoint may be written");
}

function treeBytes(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (current: string, prefix: string): void => {
    for (const item of readdirSync(current, { withFileTypes: true })) {
      const rel = prefix === "" ? item.name : `${prefix}/${item.name}`;
      if (item.isDirectory()) {
        out[`${rel}/`] = "";
        walk(join(current, item.name), rel);
      } else {
        out[rel] = readFileSync(join(current, item.name), "utf8");
      }
    }
  };
  walk(dir, "");
  return out;
}

function assertRefused(result: { exitCode: number; stdout: string; stderr: string }, code: keyof typeof ERROR_CATALOGUE): void {
  assert.equal(result.exitCode, 1, result.stderr);
  assert.equal(result.stdout, `${code}\n`);
  assert.ok(result.stderr.includes(ERROR_CATALOGUE[code].reason));
}

void test("RES-04 stopped: create and restore work with no entry, no daemon and no container, and register nothing", async (t) => {
  const fx = fixture(t);
  assertNoRegistry(fx);
  const original = treeBytes(fx.workspace);
  const created = await runCheckpointCommand(argv("create", fx.workspace, "before-edit"), fx.deps);
  assert.equal(created.exitCode, 0, created.stderr);
  assert.equal(created.stderr, "");
  assert.ok(existsSync(join(fx.stateDir, "checkpoints", fx.sessionId, "before-edit")));
  assertNoRegistry(fx);
  writeFileSync(join(fx.workspace, "a.txt"), "edited\n");
  writeFileSync(join(fx.workspace, "extra.txt"), "new\n");
  const restored = await runCheckpointCommand(argv("restore", fx.workspace, "before-edit"), fx.deps);
  assert.equal(restored.exitCode, 0, restored.stderr);
  assert.deepEqual(treeBytes(fx.workspace), original);
  assertNoRegistry(fx);
  assert.ok(fx.podman.calls.length >= 2, "the proof repeats on every operation");
  assert.ok(fx.podman.calls.every((name) => name === realmSandboxName(fx.sessionId)));
});

void test("RES-04 stopped: a daemon that answers unbound for an unregistered project proceeds, and the registry stays untouched", async (t) => {
  const fx = fixture(t);
  fx.daemon.mode = "unbound";
  const created = await runCheckpointCommand(argv("create", fx.workspace, "before-edit"), fx.deps);
  assert.equal(created.exitCode, 0, created.stderr);
  const restored = await runCheckpointCommand(argv("restore", fx.workspace, "before-edit"), fx.deps);
  assert.equal(restored.exitCode, 0, restored.stderr);
  assertNoRegistry(fx);
  assert.deepEqual(fx.podman.calls, [], "an answering daemon is the proof; Podman is not consulted");
});

void test("RES-04 stopped: a daemon that answers active refuses with LOCK_CONFLICT and writes nothing", async (t) => {
  const fx = fixture(t);
  fx.daemon.mode = "active";
  const before = treeBytes(fx.workspace);
  assertRefused(await runCheckpointCommand(argv("create", fx.workspace, "x"), fx.deps), "LOCK_CONFLICT");
  assertNoRegistry(fx);
  assert.equal(existsSync(join(fx.stateDir, "checkpoints", fx.sessionId, "x")), false);
  assert.deepEqual(treeBytes(fx.workspace), before);
  assert.deepEqual(fx.podman.calls, []);
});

void test("RES-04 stopped: no daemon and a container in any state refuses with REALM_NOT_ACTIVE and writes nothing", async (t) => {
  for (const mode of ["running", "exited"] as const) {
    const fx = fixture(t);
    fx.podman.mode = mode;
    const before = treeBytes(fx.workspace);
    for (const command of ["create", "restore"] as const) {
      assertRefused(await runCheckpointCommand(argv(command, fx.workspace, "before-edit"), fx.deps), "REALM_NOT_ACTIVE");
    }
    assert.ok(fx.podman.calls.length > 0, mode);
    assertNothingWritten(fx);
    assert.deepEqual(treeBytes(fx.workspace), before);
  }
});

void test("RES-04 stopped: no daemon and an inspect that throws refuses with REALM_NOT_ACTIVE and writes nothing", async (t) => {
  const fx = fixture(t);
  fx.podman.mode = "throws";
  for (const command of ["create", "restore"] as const) {
    assertRefused(await runCheckpointCommand(argv(command, fx.workspace, "before-edit"), fx.deps), "REALM_NOT_ACTIVE");
  }
  assertNothingWritten(fx);
});

void test("RES-04 stopped: no daemon and an inspect that exceeds its bound refuses with REALM_NOT_ACTIVE", async (t) => {
  const fx = fixture(t);
  fx.podman.mode = "hangs";
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const pending = runCheckpointCommand(argv("create", fx.workspace, "before-edit"), fx.deps);
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
  assert.equal(fx.podman.calls.length, 1, "the inspect was started");
  t.mock.timers.tick(PODMAN_PROOF_TIMEOUT_MS);
  assertRefused(await pending, "REALM_NOT_ACTIVE");
  assertNothingWritten(fx);
});

void test("RES-04 stopped: no daemon and a Podman socket that cannot be resolved or reached refuses with REALM_NOT_ACTIVE", async (t) => {
  const fx = fixture(t);
  const withoutSeam: CheckpointDeps = {
    env: fx.deps.env,
    ...(fx.deps.readConfig === undefined ? {} : { readConfig: fx.deps.readConfig }),
    ...(fx.deps.readPolicy === undefined ? {} : { readPolicy: fx.deps.readPolicy }),
    ...(fx.deps.connect === undefined ? {} : { connect: fx.deps.connect }),
  };
  const unresolvable: CheckpointDeps = withoutSeam;
  assertRefused(await runCheckpointCommand(argv("create", fx.workspace, "before-edit"), unresolvable), "REALM_NOT_ACTIVE");
  const unreachable: CheckpointDeps = { ...withoutSeam, env: { ...fx.deps.env, XDG_RUNTIME_DIR: join(fx.root, "runtime") } };
  assertRefused(await runCheckpointCommand(argv("create", fx.workspace, "before-edit"), unreachable), "REALM_NOT_ACTIVE");
  assertNothingWritten(fx);
});

void test("RES-04 stopped: a daemon that exists but did not answer is never treated as stopped, and Podman is not consulted", async (t) => {
  for (const mode of ["silent", "error-reply", "dropped"] as const) {
    const fx = fixture(t);
    fx.daemon.mode = mode;
    const before = treeBytes(fx.workspace);
    for (const command of ["create", "restore"] as const) {
      assertRefused(await runCheckpointCommand(argv(command, fx.workspace, "before-edit"), fx.deps), "REALM_NOT_ACTIVE");
    }
    assert.deepEqual(fx.podman.calls, [], mode);
    assertNothingWritten(fx);
    assert.deepEqual(treeBytes(fx.workspace), before);
  }
});

void test("RES-04 stopped: a path outside the policy roots, or outside the workspace root, is POLICY_DENIED and the daemon is not touched", async (t) => {
  const fx = fixture(t);
  fx.policyRoots.splice(0, fx.policyRoots.length, fx.outside);
  assertRefused(await runCheckpointCommand(argv("create", fx.workspace, "before-edit"), fx.deps), "POLICY_DENIED");
  assertNothingWritten(fx);
  fx.policyRoots.splice(0, fx.policyRoots.length, fx.root);
  // <root>/outside is under the policy root and outside the configured workspace root <root>/projects.
  writeFileSync(join(fx.outside, "c.txt"), "gamma\n");
  assertRefused(await runCheckpointCommand(argv("create", fx.outside, "before-edit"), fx.deps), "POLICY_DENIED");
  assert.equal(existsSync(join(fx.stateDir, "checkpoints")), false);
  assert.equal(existsSync(workspaceRegistryDirOf(fx.stateDir)), false);
  assert.equal(fx.daemon.connects, 0);
  assert.deepEqual(fx.podman.calls, []);
});

void test("RES-04 stopped: an id that the bound path does not derive is SCHEMA_INVALID, a policy that cannot load is refused, a config that cannot load is a usage error", async (t) => {
  const fx = fixture(t);
  const selection = selectionOf(fx.workspace);
  const ceiling = bindRoot(join(fx.root, "projects"));
  assert.throws(
    () => pinStoppedProject({ workspaceRoot: selection.workspaceRoot, sessionId: selectionOf(fx.outside).sessionId }, policyOf([fx.root]), ceiling),
    (error: unknown) => error instanceof RealmError && error.code === "SCHEMA_INVALID",
  );
  const entry = pinStoppedProject(selection, policyOf([fx.root]), ceiling);
  assert.equal(entry.sessionId, fx.sessionId);
  assert.equal(entry.workspaceRoot, fx.workspace);

  const brokenPolicy: CheckpointDeps = {
    ...fx.deps,
    readPolicy: () => {
      throw new RealmError("SCHEMA_INVALID");
    },
  };
  assertRefused(await runCheckpointCommand(argv("create", fx.workspace, "before-edit"), brokenPolicy), "SCHEMA_INVALID");
  const brokenConfig: CheckpointDeps = {
    ...fx.deps,
    readConfig: () => {
      throw new Error("no config");
    },
  };
  const usage = await runCheckpointCommand(argv("create", fx.workspace, "before-edit"), brokenConfig);
  assert.equal(usage.exitCode, 2);
  assert.equal(usage.stdout, "");
  assertNothingWritten(fx);
  assert.equal(fx.daemon.connects, 0);
});

void test("RES-04 stopped: a workspace directory swapped after the pin is rejected by the library with POLICY_DENIED and nothing is written", async (t) => {
  const fx = fixture(t);
  const entry = pinStoppedProject(selectionOf(fx.workspace), policyOf([fx.root]), bindRoot(join(fx.root, "projects")));
  renameSync(fx.workspace, join(fx.root, "moved-away"));
  mkdirSync(fx.workspace);
  writeFileSync(join(fx.workspace, "a.txt"), "impostor\n");
  await assert.rejects(
    snapshotWorkspace({ entry, stateRoot: fx.stateDir, sandboxRunning: () => Promise.resolve(false), checkpointId: "swapped" }),
    (error: unknown) => error instanceof RealmError && error.code === "POLICY_DENIED",
  );
  assert.equal(existsSync(join(fx.stateDir, "checkpoints", fx.sessionId, "swapped")), false);
  assertNoRegistry(fx);
});

void test("RES-04 stopped: runCli passes the policy and inspect seams to the checkpoint command", async (t) => {
  const fx = fixture(t);
  const cliDeps: CliDeps = {
    env: fx.deps.env,
    ...(fx.deps.readConfig === undefined ? {} : { readConfig: fx.deps.readConfig }),
    ...(fx.deps.connect === undefined ? {} : { connect: fx.deps.connect }),
    ...(fx.deps.readPolicy === undefined ? {} : { readPolicy: fx.deps.readPolicy }),
    ...(fx.deps.inspectContainer === undefined ? {} : { inspectContainer: fx.deps.inspectContainer }),
  };
  const result = await runCli(["checkpoint", ...argv("create", fx.workspace, "via-cli")], cliDeps);
  assert.equal(result.exitCode, 0, result.stderr);
  const printed: unknown = JSON.parse(result.stdout);
  assert.deepEqual(printed, { command: "create", checkpointId: "via-cli", entries: 3 });
  assertNoRegistry(fx);
});

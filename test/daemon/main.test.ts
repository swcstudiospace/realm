// Daemon entry tests (RT-01, P6-D1, P6-D4). runDaemon is driven with fakes for start, the
// control-channel down, signals, and stderr. The config reader is the real readRuntimeConfigFile
// over files in a temporary directory. No daemon is started and no process signal is registered.

import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeRealmError } from "../../src/core/errors.js";
import { CONTROL_TIMEOUT_MS, type ControlReply } from "../../src/daemon/channel.js";
import {
  runDaemon,
  type DaemonDeps,
  type DaemonSignal,
  type DaemonStartOptions,
} from "../../src/daemon/main.js";
import type { StartedDaemon } from "../../src/daemon/daemon.js";
import { defaultPolicyPath } from "../../src/runtime/host-paths.js";
import type { RealmHandle } from "../../src/realm/compose.js";
import { TEARDOWN_TIMEOUT_MS } from "../../src/lifecycle/controller.js";
import type { EnvironmentLike } from "../../src/session/paths.js";

const SOCKET_PATH = "/run/realm-test/control.sock";
const IMAGE = `registry.example/realm/workload@sha256:${"a".repeat(64)}`;

// runDaemon never touches the handle; the control-channel down is the only shutdown path.
const UNUSED_HANDLE = {} as RealmHandle;

function tempDir(t: TestContext): string {
  const dir = mkdtempSync(join(tmpdir(), "realm-daemon-main-"));
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

// Writes the config under the XDG config home that the returned environment points at.
function writeConfig(dir: string, value: unknown): EnvironmentLike {
  mkdirSync(join(dir, "realm"), { recursive: true });
  writeFileSync(join(dir, "realm", "config.json"), JSON.stringify(value));
  return { XDG_CONFIG_HOME: dir };
}

function validConfig(dir: string): Record<string, unknown> {
  return {
    image: IMAGE,
    stateDir: join(dir, "state"),
    workspaceRoot: join(dir, "workspace"),
  };
}

function startedWith(done: Promise<void>): StartedDaemon {
  return { socketPath: SOCKET_PATH, handle: UNUSED_HANDLE, done };
}

interface Harness {
  readonly deps: DaemonDeps;
  readonly lines: string[];
  readonly handlers: Map<DaemonSignal, () => void>;
  readonly registered: Promise<void>;
}

function harness(env: EnvironmentLike, overrides: Partial<Omit<DaemonDeps, "env">> = {}): Harness {
  const lines: string[] = [];
  const handlers = new Map<DaemonSignal, () => void>();
  let markRegistered: () => void = () => undefined;
  const registered = new Promise<void>((resolve) => {
    markRegistered = () => {
      resolve();
    };
  });
  const deps: DaemonDeps = {
    env,
    writeStderr: (line: string) => {
      lines.push(line);
    },
    onSignal: (signal, handler) => {
      handlers.set(signal, handler);
      markRegistered();
      return () => {
        handlers.delete(signal);
      };
    },
    ...overrides,
  };
  return { deps, lines, handlers, registered };
}

void test("a missing config returns 1 and reports SCHEMA_INVALID without starting", async (t) => {
  const dir = tempDir(t);
  let starts = 0;
  const h = harness(
    { XDG_CONFIG_HOME: dir },
    {
      start: () => {
        starts += 1;
        return Promise.reject(makeRealmError("SCHEMA_INVALID"));
      },
    },
  );

  assert.equal(await runDaemon(h.deps), 1);
  assert.equal(starts, 0);
  assert.deepEqual(h.lines, ["realm daemon: SCHEMA_INVALID"]);
});

void test("a valid config starts once with the derived options and resolves 0 on teardown", async (t) => {
  const dir = tempDir(t);
  const raw = validConfig(dir);
  const env = writeConfig(dir, raw);
  const calls: DaemonStartOptions[] = [];
  const h = harness(env, {
    start: (options) => {
      calls.push(options);
      return Promise.resolve(startedWith(Promise.resolve()));
    },
  });

  assert.equal(await runDaemon(h.deps), 0);
  assert.equal(calls.length, 1);
  const call = calls[0];
  assert.ok(call !== undefined);
  assert.equal(call.stateDir, raw["stateDir"]);
  assert.equal(call.policyPath, defaultPolicyPath(String(raw["stateDir"])));
  assert.equal(call.sessionId, "daemon");
  assert.deepEqual(call.runtimeInput, raw);
  assert.equal(call.libpodSocketPath, undefined);
  assert.equal(call.secretRoot, undefined, "no secret root is passed without REALM_DRIVER_SECRET_ROOT");
  assert.equal(call.pinnedWorkspaceRoot, undefined, "no pinned workspace root is passed without REALM_DRIVER_WORKSPACE_ROOT");
  assert.deepEqual(call.env, env);
  assert.deepEqual(h.lines, []);
});

void test("REALM_DRIVER_SECRET_ROOT in the environment is passed to the daemon start as the secret root", async (t) => {
  const dir = tempDir(t);
  const secretRoot = join(dir, "secrets");
  const env = { ...writeConfig(dir, validConfig(dir)), REALM_DRIVER_SECRET_ROOT: secretRoot };
  const calls: DaemonStartOptions[] = [];
  const h = harness(env, {
    start: (options) => {
      calls.push(options);
      return Promise.resolve(startedWith(Promise.resolve()));
    },
  });

  assert.equal(await runDaemon(h.deps), 0);
  assert.equal(calls[0]?.secretRoot, secretRoot);
});

void test("REALM_DRIVER_WORKSPACE_ROOT in the environment is passed to the daemon start as the pinned workspace root", async (t) => {
  const dir = tempDir(t);
  const workspaceRoot = join(dir, "workspace");
  const env = { ...writeConfig(dir, validConfig(dir)), REALM_DRIVER_WORKSPACE_ROOT: workspaceRoot };
  const calls: DaemonStartOptions[] = [];
  const h = harness(env, {
    start: (options) => {
      calls.push(options);
      return Promise.resolve(startedWith(Promise.resolve()));
    },
  });

  assert.equal(await runDaemon(h.deps), 0);
  assert.equal(calls[0]?.pinnedWorkspaceRoot, workspaceRoot);
});

void test("REALM_DRIVER_STATE_ROOT in the environment is passed to the daemon start as the sandbox state root", async (t) => {
  const dir = tempDir(t);
  const sandboxStateRoot = join(dir, "sandboxes");
  const env = { ...writeConfig(dir, validConfig(dir)), REALM_DRIVER_STATE_ROOT: sandboxStateRoot };
  const calls: DaemonStartOptions[] = [];
  const h = harness(env, {
    start: (options) => {
      calls.push(options);
      return Promise.resolve(startedWith(Promise.resolve()));
    },
  });

  assert.equal(await runDaemon(h.deps), 0);
  assert.equal(calls[0]?.sandboxStateRoot, sandboxStateRoot);
});

void test("REALM_DRIVER_STATE_ROOT unset or empty passes no sandbox state root to the daemon start", async (t) => {
  const dir = tempDir(t);
  const base = writeConfig(dir, validConfig(dir));
  for (const env of [base, { ...base, REALM_DRIVER_STATE_ROOT: "" }]) {
    const calls: DaemonStartOptions[] = [];
    const h = harness(env, {
      start: (options) => {
        calls.push(options);
        return Promise.resolve(startedWith(Promise.resolve()));
      },
    });

    assert.equal(await runDaemon(h.deps), 0);
    assert.equal(calls[0]?.sandboxStateRoot, undefined, "no sandbox state root is passed without REALM_DRIVER_STATE_ROOT");
  }
});

void test("a start rejecting with a RealmError returns 1 and writes its code", async (t) => {
  const dir = tempDir(t);
  const h = harness(writeConfig(dir, validConfig(dir)), {
    start: () => Promise.reject(makeRealmError("LOCK_CONFLICT")),
  });

  assert.equal(await runDaemon(h.deps), 1);
  assert.deepEqual(h.lines, ["realm daemon: LOCK_CONFLICT"]);
});

void test("a start rejecting with a non-RealmError is reported as SCHEMA_INVALID", async (t) => {
  const dir = tempDir(t);
  const h = harness(writeConfig(dir, validConfig(dir)), {
    start: () => Promise.reject(new Error("raw detail that must not print")),
  });

  assert.equal(await runDaemon(h.deps), 1);
  assert.deepEqual(h.lines, ["realm daemon: SCHEMA_INVALID"]);
});

void test("a signal runs the control-channel down and resolves 0", async (t) => {
  const dir = tempDir(t);
  let finishTeardown: () => void = () => undefined;
  const done = new Promise<void>((resolve) => {
    finishTeardown = () => {
      resolve();
    };
  });
  const downs: string[] = [];
  const h = harness(writeConfig(dir, validConfig(dir)), {
    start: () => Promise.resolve(startedWith(done)),
    sendDown: (socketPath) => {
      downs.push(socketPath);
      finishTeardown();
      return Promise.resolve({ id: "shutdown", result: {} });
    },
  });

  const run = runDaemon(h.deps);
  await h.registered;
  const handler = h.handlers.get("SIGTERM");
  assert.ok(handler !== undefined);
  handler();

  assert.equal(await run, 0);
  assert.deepEqual(downs, [SOCKET_PATH]);
  assert.equal(h.handlers.size, 0, "signal listeners are removed once the daemon stops");
  assert.deepEqual(h.lines, []);
});

void test("a down that fails during a signal shutdown returns 1 with its code", async (t) => {
  const dir = tempDir(t);
  const h = harness(writeConfig(dir, validConfig(dir)), {
    start: () => Promise.resolve(startedWith(new Promise<void>(() => undefined))),
    sendDown: () => Promise.resolve<ControlReply>({ id: "shutdown", error: { code: "AGENTOS_STOP_FAILED" } }),
  });

  const run = runDaemon(h.deps);
  await h.registered;
  const handler = h.handlers.get("SIGINT");
  assert.ok(handler !== undefined);
  handler();

  assert.equal(await run, 1);
  assert.deepEqual(h.lines, ["realm daemon: AGENTOS_STOP_FAILED"]);
});

void test("the CLI down bound outlasts the daemon teardown bound", () => {
  assert.ok(
    CONTROL_TIMEOUT_MS.down > TEARDOWN_TIMEOUT_MS,
    "the CLI must not give up before the daemon finishes teardown",
  );
});

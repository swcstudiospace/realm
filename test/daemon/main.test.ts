// Daemon entry tests (RT-01, P6-D1, P6-D4). runDaemon is driven with fakes for start, the
// control-channel down, signals, and stderr. The config reader is the real readRuntimeConfigFile
// over files in a temporary directory. No daemon is started and no process signal is registered.

import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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


function logRecord(line: string, level: string, event: string): Record<string, unknown> {
  assert.equal(line.includes("\n"), false, "one logger call is one physical JSON line");
  const value = JSON.parse(line) as Record<string, unknown>;
  assert.deepEqual(Object.keys(value).slice(0, 3), ["ts", "level", "event"]);
  const ts = value["ts"];
  assert.equal(typeof ts, "string");
  assert.equal(new Date(String(ts)).toISOString(), ts);
  assert.equal(value["level"], level);
  assert.equal(value["event"], event);
  return value;
}

function assertFailureLines(lines: readonly string[], code: string): void {
  assert.equal(lines.length, 1);
  const value = logRecord(lines[0] ?? "", "error", "daemon.failed");
  assert.deepEqual(value, { ts: value["ts"], level: "error", event: "daemon.failed", code });
}

function startupOf(lines: readonly string[]): Record<string, unknown> {
  return logRecord(lines[0] ?? "", "info", "daemon.startup");
}
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
  assertFailureLines(h.lines, "SCHEMA_INVALID");
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
  assert.equal(call.secretRoot, join(String(raw["stateDir"]), "secrets"));
  assert.equal(call.pinnedWorkspaceRoot, raw["workspaceRoot"]);
  assert.equal(call.sandboxStateRoot, join(String(raw["stateDir"]), "sandboxes"));
  assert.deepEqual(call.env, env);
  assert.deepEqual(h.lines, []);
});

void test("OBS-02: a request line is written to the bounded daemon log, not stderr", async (t) => {
  const dir = tempDir(t);
  const raw = validConfig(dir);
  mkdirSync(String(raw["stateDir"]), { recursive: true });
  const h = harness(writeConfig(dir, raw), {
    start: (options) => {
      options.logger?.info("up.begin", { correlationId: "c1" });
      return Promise.resolve(startedWith(Promise.resolve()));
    },
  });
  assert.equal(await runDaemon(h.deps), 0);
  const text = readFileSync(join(String(raw["stateDir"]), "requests.log"), "utf8");
  assert.equal(text.includes("\"event\":\"up.begin\""), true);
  assert.equal(h.lines.some((line) => line.includes("up.begin")), false);
});

void test("OBS-02: a request line falls back to stderr when the log path is not a file", async (t) => {
  const dir = tempDir(t);
  const raw = validConfig(dir);
  const env = writeConfig(dir, raw);
  mkdirSync(String(raw["stateDir"]), { recursive: true });
  mkdirSync(join(String(raw["stateDir"]), "requests.log"));
  const h = harness(env, {
    start: (options) => {
      options.logger?.info("up.begin", { correlationId: "c1" });
      return Promise.resolve(startedWith(Promise.resolve()));
    },
  });
  assert.equal(await runDaemon(h.deps), 0);
  assert.equal(h.lines.some((line) => line.includes("up.begin")), true);
});

void test("CRASH-04: the start's onStartup report is written as one stderr line with the container ids", async (t) => {
  const dir = tempDir(t);
  const h = harness(writeConfig(dir, validConfig(dir)), {
    start: (options) => {
      options.onStartup?.({
        containerIds: ["c0ffee", "decaf1"],
        containersRemoved: 2,
        recordsDeleted: 1,
        tempFilesRemoved: 3,
        auditLinesReconciled: 4,
        truncated: false,
        unfinishedSweepRoots: [],
        unfinishedAuditFiles: [],
        auditListingTruncated: false,
        maintenanceComplete: true,
        failures: 0,
      });
      return Promise.resolve(startedWith(Promise.resolve()));
    },
  });

  assert.equal(await runDaemon(h.deps), 0);
  assert.equal(h.lines.length, 1);
  const startup = startupOf(h.lines);
  assert.deepEqual(startup, {
    ts: startup["ts"],
    level: "info",
    event: "daemon.startup",
    containersRemoved: 2,
    containerIds: ["c0ffee", "decaf1"],
    recordsDeleted: 1,
    tempFilesRemoved: 3,
    auditLinesReconciled: 4,
    maintenanceComplete: true,
    unfinishedAuditFiles: [],
    unfinishedAuditFileCount: 0,
    unfinishedSweepRoots: [],
    unfinishedSweepRootCount: 0,
    auditListingTruncated: false,
    failures: 0,
  });
});

void test("CRASH-04: the startup line has no id brackets when no container was removed, and names failures only when there are some", async (t) => {
  const dir = tempDir(t);
  const h = harness(writeConfig(dir, validConfig(dir)), {
    start: (options) => {
      options.onStartup?.({
        containerIds: [],
        containersRemoved: 0,
        recordsDeleted: 0,
        tempFilesRemoved: 0,
        auditLinesReconciled: 0,
        truncated: false,
        unfinishedSweepRoots: [],
        unfinishedAuditFiles: [],
        auditListingTruncated: false,
        maintenanceComplete: true,
        failures: 2,
      });
      return Promise.resolve(startedWith(Promise.resolve()));
    },
  });

  assert.equal(await runDaemon(h.deps), 0);
  assert.equal(h.lines.length, 1);
  const quiet = startupOf(h.lines);
  assert.equal(quiet["containersRemoved"], 0);
  assert.equal(quiet["tempFilesRemoved"], 0);
  assert.equal(quiet["auditLinesReconciled"], 0);
  assert.equal(quiet["maintenanceComplete"], true);
  assert.equal(quiet["failures"], 2);
  assert.equal(quiet["reapFailure"], undefined);
});

void test("STARTUP budget: the startup line says maintenanceComplete=false and names the unfinished audit files and sweep roots", async (t) => {
  const dir = tempDir(t);
  const h = harness(writeConfig(dir, validConfig(dir)), {
    start: (options) => {
      options.onStartup?.({
        containerIds: [],
        containersRemoved: 0,
        recordsDeleted: 0,
        tempFilesRemoved: 0,
        auditLinesReconciled: 0,
        truncated: true,
        unfinishedSweepRoots: ["<workspace>", "<state>/sessions"],
        unfinishedAuditFiles: ["a.jsonl", "daemon.jsonl"],
        auditListingTruncated: false,
        maintenanceComplete: false,
        failures: 0,
      });
      return Promise.resolve(startedWith(Promise.resolve()));
    },
  });

  assert.equal(await runDaemon(h.deps), 0);
  assert.equal(h.lines.length, 1);
  const unfinished = startupOf(h.lines);
  assert.equal(unfinished["maintenanceComplete"], false);
  assert.equal(unfinished["tempFilesRemoved"], 0);
  assert.equal(unfinished["auditLinesReconciled"], 0);
  assert.equal(unfinished["unfinishedAuditFileCount"], 2);
  assert.deepEqual(unfinished["unfinishedAuditFiles"], ["a.jsonl", "daemon.jsonl"]);
  assert.equal(unfinished["unfinishedSweepRootCount"], 2);
  assert.deepEqual(unfinished["unfinishedSweepRoots"], ["<workspace>", "<state>/sessions"]);
});

void test("CRASH-04: a failed reap's partial report is logged, then the start failure, and the exit code is 1", async (t) => {
  const dir = tempDir(t);
  const h = harness(writeConfig(dir, validConfig(dir)), {
    start: (options) => {
      options.onStartup?.({
        containerIds: ["0123abcd"],
        containersRemoved: 1,
        recordsDeleted: 0,
        tempFilesRemoved: 0,
        auditLinesReconciled: 0,
        truncated: false,
        unfinishedSweepRoots: [],
        unfinishedAuditFiles: [],
        auditListingTruncated: false,
        maintenanceComplete: false,
        reapFailure: "REALM_STOPPING",
        failures: 1,
      });
      return Promise.reject(makeRealmError("REALM_STOPPING"));
    },
  });

  assert.equal(await runDaemon(h.deps), 1);
  assert.equal(h.lines.length, 2);
  const partial = startupOf(h.lines);
  assert.equal(partial["containersRemoved"], 1);
  assert.deepEqual(partial["containerIds"], ["0123abcd"]);
  assert.equal(partial["tempFilesRemoved"], 0);
  assert.equal(partial["auditLinesReconciled"], 0);
  assert.equal(partial["reapFailure"], "REALM_STOPPING");
  assert.equal(partial["failures"], 1);
  assertFailureLines(h.lines.slice(1), "REALM_STOPPING");
});

void test("STARTUP budget: a long unfinished list is sampled at ten names, the count stays exact, and a truncated audit listing is named", async (t) => {
  const dir = tempDir(t);
  const names = Array.from({ length: 12 }, (_unused, index) => `s${String(index)}.jsonl`);
  const h = harness(writeConfig(dir, validConfig(dir)), {
    start: (options) => {
      options.onStartup?.({
        containerIds: [],
        containersRemoved: 0,
        recordsDeleted: 0,
        tempFilesRemoved: 0,
        auditLinesReconciled: 0,
        truncated: false,
        unfinishedSweepRoots: [],
        unfinishedAuditFiles: names,
        auditListingTruncated: true,
        maintenanceComplete: false,
        failures: 0,
      });
      return Promise.resolve(startedWith(Promise.resolve()));
    },
  });

  assert.equal(await runDaemon(h.deps), 0);
  assert.equal(h.lines.length, 1);
  const listed = startupOf(h.lines);
  assert.equal(listed["auditListingTruncated"], true);
  assert.equal(listed["unfinishedAuditFileCount"], 12);
  assert.deepEqual(listed["unfinishedAuditFiles"], names.slice(0, 10));
  assert.equal(listed["tempFilesRemoved"], 0);
  assert.equal(listed["auditLinesReconciled"], 0);
  assert.equal(listed["maintenanceComplete"], false);
});

void test("secretRoot and sandboxStateRoot in config.json are passed to the daemon start, and a stale root variable is ignored", async (t) => {
  const dir = tempDir(t);
  const secretRoot = join(dir, "secrets");
  const sandboxStateRoot = join(dir, "sandboxes");
  const raw = { ...validConfig(dir), secretRoot, sandboxStateRoot };
  const env = {
    ...writeConfig(dir, raw),
    REALM_DRIVER_SECRET_ROOT: join(dir, "stale-secrets"),
    REALM_DRIVER_WORKSPACE_ROOT: join(dir, "stale-workspace"),
    REALM_DRIVER_STATE_ROOT: join(dir, "stale-sandboxes"),
  };
  const calls: DaemonStartOptions[] = [];
  const h = harness(env, {
    start: (options) => {
      calls.push(options);
      return Promise.resolve(startedWith(Promise.resolve()));
    },
  });

  assert.equal(await runDaemon(h.deps), 0);
  const started = calls[0];
  assert.ok(started);
  assert.equal(started.secretRoot, secretRoot);
  assert.equal(started.pinnedWorkspaceRoot, join(dir, "workspace"));
  assert.equal(started.sandboxStateRoot, sandboxStateRoot);
});

void test("omitted secret and sandbox roots are derived under stateDir even when the environment variables are empty", async (t) => {
  const dir = tempDir(t);
  const raw = validConfig(dir);
  for (const env of [writeConfig(dir, raw), { ...writeConfig(dir, raw), REALM_DRIVER_STATE_ROOT: "", REALM_DRIVER_SECRET_ROOT: "" }]) {
    const calls: DaemonStartOptions[] = [];
    const h = harness(env, {
      start: (options) => {
        calls.push(options);
        return Promise.resolve(startedWith(Promise.resolve()));
      },
    });
    assert.equal(await runDaemon(h.deps), 0);
    const started = calls[0];
    assert.ok(started);
    assert.equal(started.secretRoot, join(String(raw["stateDir"]), "secrets"));
    assert.equal(started.sandboxStateRoot, join(String(raw["stateDir"]), "sandboxes"));
    assert.equal(started.pinnedWorkspaceRoot, join(dir, "workspace"));
  }
});

void test("a start rejecting with a RealmError returns 1 and writes its code", async (t) => {
  const dir = tempDir(t);
  const h = harness(writeConfig(dir, validConfig(dir)), {
    start: () => Promise.reject(makeRealmError("LOCK_CONFLICT")),
  });

  assert.equal(await runDaemon(h.deps), 1);
  assertFailureLines(h.lines, "LOCK_CONFLICT");
});

void test("a start rejecting with a non-RealmError is reported as SCHEMA_INVALID", async (t) => {
  const dir = tempDir(t);
  const h = harness(writeConfig(dir, validConfig(dir)), {
    start: () => Promise.reject(new Error("raw detail that must not print")),
  });

  assert.equal(await runDaemon(h.deps), 1);
  assertFailureLines(h.lines, "SCHEMA_INVALID");
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
  assertFailureLines(h.lines, "AGENTOS_STOP_FAILED");
});

void test("the CLI down bound outlasts the daemon teardown bound", () => {
  assert.ok(
    CONTROL_TIMEOUT_MS.down > TEARDOWN_TIMEOUT_MS,
    "the CLI must not give up before the daemon finishes teardown",
  );
});

void test("OBS-02: startup names are redacted and line-safe, with both samples capped and counts exact", async (t) => {
  const dir = tempDir(t);
  const credential = "sk-abcdefghijklmnopqrstuvwxyz";
  const injected = 'name\n{"event":"daemon.failed","code":"POLICY_DENIED"}';
  const names = [credential, injected, ...Array.from({ length: 10 }, (_unused, index) => `file${String(index)}`)];
  const h = harness(writeConfig(dir, validConfig(dir)), {
    start: (options) => {
      options.onStartup?.({
        containerIds: [credential],
        containersRemoved: 1,
        recordsDeleted: 2,
        tempFilesRemoved: 3,
        auditLinesReconciled: 4,
        truncated: true,
        unfinishedSweepRoots: names,
        unfinishedAuditFiles: names,
        auditListingTruncated: true,
        maintenanceComplete: false,
        failures: 0,
      });
      return Promise.resolve(startedWith(Promise.resolve()));
    },
  });

  assert.equal(await runDaemon(h.deps), 0);
  assert.equal(h.lines.length, 1);
  const record = startupOf(h.lines);
  const expectedNames = ["[REDACTED]", injected, ...names.slice(2, 10)];
  assert.deepEqual(record["containerIds"], ["[REDACTED]"]);
  assert.deepEqual(record["unfinishedAuditFiles"], expectedNames);
  assert.deepEqual(record["unfinishedSweepRoots"], expectedNames);
  assert.equal(record["unfinishedAuditFileCount"], 12);
  assert.equal(record["unfinishedSweepRootCount"], 12);
  assert.equal(record["recordsDeleted"], 2);
  assert.equal(record["auditListingTruncated"], true);
  assert.equal(h.lines.some((line) => line.includes(credential)), false);
  assert.equal(names[0], credential, "logging does not mutate the startup report");
});

for (const level of ["debug", "info", "warn", "error", "invalid"]) {
  void test(`OBS-02: ${level} request logging preserves mandatory startup and failure diagnostics`, async (t) => {
    const dir = tempDir(t);
    const raw = validConfig(dir);
    mkdirSync(String(raw["stateDir"]), { recursive: true });
    const env = { ...writeConfig(dir, raw), REALM_LOG_LEVEL: level };
    const h = harness(env, {
      start: (options) => {
        options.logger?.info("up.begin", { correlationId: "c1" });
        options.onStartup?.({
          containerIds: [],
          containersRemoved: 0,
          recordsDeleted: 0,
          tempFilesRemoved: 0,
          auditLinesReconciled: 0,
          truncated: false,
          unfinishedSweepRoots: [],
          unfinishedAuditFiles: [],
          auditListingTruncated: false,
          maintenanceComplete: true,
          failures: 0,
        });
        return Promise.reject(makeRealmError("POLICY_DENIED"));
      },
    });

    assert.equal(await runDaemon(h.deps), 1);
    assert.equal(h.lines.length, 2);
    startupOf(h.lines);
    assertFailureLines(h.lines.slice(1), "POLICY_DENIED");
    const path = join(String(raw["stateDir"]), "requests.log");
    const requests = existsSync(path) ? readFileSync(path, "utf8").trimEnd().split("\n") : [];
    const events = requests.map((line) => (JSON.parse(line) as Record<string, unknown>)["event"]);
    assert.deepEqual(events, level === "invalid" ? ["daemon.log-level", "up.begin"] : level === "debug" || level === "info" ? ["up.begin"] : []);
  });
}

void test("OBS-02: a thrown shutdown request is reported through the timestamped failure logger", async (t) => {
  const dir = tempDir(t);
  const h = harness(writeConfig(dir, validConfig(dir)), {
    start: () => Promise.resolve(startedWith(new Promise<void>(() => undefined))),
    sendDown: () => Promise.reject(makeRealmError("TOOL_TIMEOUT")),
  });
  const run = runDaemon(h.deps);
  await h.registered;
  const handler = h.handlers.get("SIGTERM");
  assert.ok(handler);
  handler();

  assert.equal(await run, 1);
  assertFailureLines(h.lines, "TOOL_TIMEOUT");
  assert.equal(h.handlers.size, 0);
});

void test("OBS-02: a listening-server failure logs only its catalogue code and exits nonzero", async (t) => {
  const dir = tempDir(t);
  let failServer: (error: Error) => void = () => undefined;
  const done = new Promise<void>((_resolve, reject) => {
    failServer = reject;
  });
  const h = harness(writeConfig(dir, validConfig(dir)), {
    start: () => Promise.resolve(startedWith(done)),
  });
  const run = runDaemon(h.deps);
  await h.registered;
  failServer(new Error("API_KEY=private-server-detail"));

  assert.equal(await run, 1);
  assertFailureLines(h.lines, "SCHEMA_INVALID");
  assert.equal(h.handlers.size, 0);
});

void test("OBS-02: an unwritable diagnostics sink cannot turn a dropped startup report into a clean exit", async (t) => {
  const dir = tempDir(t);
  let attempts = 0;
  const h = harness(writeConfig(dir, validConfig(dir)), {
    writeStderr: () => {
      attempts += 1;
      throw new Error("stderr unavailable");
    },
    start: (options) => {
      options.onStartup?.({
        containerIds: [],
        containersRemoved: 0,
        recordsDeleted: 0,
        tempFilesRemoved: 0,
        auditLinesReconciled: 0,
        truncated: false,
        unfinishedSweepRoots: [],
        unfinishedAuditFiles: [],
        auditListingTruncated: false,
        maintenanceComplete: true,
        failures: 0,
      });
      return Promise.resolve(startedWith(Promise.resolve()));
    },
  });

  assert.equal(await runDaemon(h.deps), 1);
  assert.equal(attempts, 1);
});

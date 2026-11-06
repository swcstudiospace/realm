// Daemon entry tests (RT-01, P6-D1, P6-D4). runDaemon is driven with fakes for start, the
// control-channel down, signals, and stderr. The config reader is the real readRuntimeConfigFile
// over files in a temporary directory. No daemon is started and no process signal is registered.

import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyAuditFile } from "../../src/audit/chain.js";
import { appendAudit } from "../../src/audit/log.js";
import { makeRealmError } from "../../src/core/errors.js";
import { CONTROL_TIMEOUT_MS } from "../../src/daemon/channel.js";
import {
  runDaemon,
  installFailureHandlers,
  type DaemonDeps,
  type DaemonSignal,
  type DaemonStartOptions,
} from "../../src/daemon/main.js";
import type { StartedDaemon } from "../../src/daemon/daemon.js";
import { daemonLogPath, daemonStartFailureSince } from "../../src/daemon/ensure.js";
import { defaultPolicyPath } from "../../src/runtime/host-paths.js";
import { TEARDOWN_TIMEOUT_MS } from "../../src/lifecycle/bounds.js";
import type { EnvironmentLike } from "../../src/session/paths.js";

// Every entry line is one JSON object written through the logger: ts, level, event, then code. The timestamp is checked
// and dropped, so the rest of the line compares exactly.
function entryOf(line: string): Record<string, unknown> {
  const { ts, ...fields } = JSON.parse(line) as Record<string, unknown>;
  assert.equal(typeof ts === "string" && !Number.isNaN(Date.parse(ts)), true);
  return fields;
}


function failed(code: string): Record<string, unknown> {
  return { level: "error", event: "daemon.failed", code };
}

function startupOf(lines: readonly string[]): Record<string, unknown> {
  const value = entryOf(lines[0] ?? "");
  assert.equal(value["event"], "daemon.startup");
  return value;
}
const SOCKET_PATH = "/run/realm-test/control.sock";
const IMAGE = `registry.example/realm/workload@sha256:${"a".repeat(64)}`;

// runDaemon never reaches a session: a signal stops the started daemon in process, and no control message is sent for it.

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
  return {
    socketPath: SOCKET_PATH,
    done,
    stop: () => Promise.resolve(),
    session: () => undefined,
    committedCount: () => 0,
    isCommitted: () => false,
  };
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
  assert.deepEqual(h.lines.map(entryOf), [failed("SCHEMA_INVALID")]);
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
  assert.deepEqual(call.runtimeInput, raw);
  assert.equal(call.libpodSocketPath, undefined);
  assert.equal(call.secretRoot, join(String(raw["stateDir"]), "secrets"));
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

void test("OBS-02: a request line the file sink refuses reaches stderr and is not counted as dropped", async (t) => {
  const dir = tempDir(t);
  const raw = validConfig(dir);
  const env = writeConfig(dir, raw);
  mkdirSync(String(raw["stateDir"]), { recursive: true });
  mkdirSync(join(String(raw["stateDir"]), "requests.log"));
  let dropped: number | undefined;
  const h = harness(env, {
    start: (options) => {
      options.logger?.info("up.begin", { correlationId: "c1" });
      dropped = options.logger?.droppedLines();
      return Promise.resolve(startedWith(Promise.resolve()));
    },
  });
  assert.equal(await runDaemon(h.deps), 0);
  assert.equal(h.lines.some((line) => line.includes("up.begin")), true);
  assert.equal(dropped, 0, "the stderr fallback delivers the line, so the sink does not report it as refused");
});

void test("P17-O4: an unrecognised REALM_LOG_LEVEL logs one daemon.log-level warn line", async (t) => {
  const dir = tempDir(t);
  const raw = validConfig(dir);
  mkdirSync(String(raw["stateDir"]), { recursive: true });
  let starts = 0;
  const h = harness({ ...writeConfig(dir, raw), REALM_LOG_LEVEL: "verbose" }, {
    start: () => {
      starts += 1;
      return Promise.resolve(startedWith(Promise.resolve()));
    },
  });
  assert.equal(await runDaemon(h.deps), 0);
  assert.equal(starts, 1);
  const warns = readFileSync(join(String(raw["stateDir"]), "requests.log"), "utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map(entryOf)
    .filter((entry) => entry["event"] === "daemon.log-level");
  assert.equal(warns.length, 1);
  assert.equal(warns[0]?.["level"], "warn");
});

void test("CRASH-04: the start's onStartup report is written as one stderr line with the container ids", async (t) => {
  const dir = tempDir(t);
  const h = harness(writeConfig(dir, validConfig(dir)), {
    start: (options) => {
      options.onStartup?.({
        containerIds: ["c0ffee", "decaf1"],
        removedCauses: ["c0ffee pids-limit", "decaf1 no-record"],
        containersRemoved: 2,
        recordsDeleted: 1,
        adopted: 0,
        adoptedContainerIds: [],
        tempFilesRemoved: 3,
        unattributedTempFiles: 0,
        unattributedRecords: 0,
        registryEntriesRemoved: 0,
        auditLinesReconciled: 4,
        truncated: false,
        unfinishedSweepRoots: [],
        unfinishedAuditFiles: [],
        auditListingTruncated: false,
        maintenanceComplete: true,
        failureCodes: [],
        unattributedRecordCodes: [],
        failures: 0,
      });
      return Promise.resolve(startedWith(Promise.resolve()));
    },
  });

  assert.equal(await runDaemon(h.deps), 0);
  assert.equal(h.lines.length, 1);
  assert.deepEqual(startupOf(h.lines), {
    level: "info",
    event: "daemon.startup",
    containersRemoved: 2,
    containerIds: ["c0ffee", "decaf1"],
    removedCauses: ["c0ffee pids-limit", "decaf1 no-record"],
    recordsDeleted: 1,
    adopted: 0,
    adoptedContainerIds: [],
    tempFilesRemoved: 3,
    unattributedTempFiles: 0,
    unattributedRecords: 0,
    registryEntriesRemoved: 0,
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

void test("CRASH-04: the startup line names the adopted count", async (t) => {
  const dir = tempDir(t);
  const h = harness(writeConfig(dir, validConfig(dir)), {
    start: (options) => {
      options.onStartup?.({
        containerIds: [],
        removedCauses: [],
        containersRemoved: 0,
        recordsDeleted: 0,
        adopted: 2,
        adoptedContainerIds: ["aa11bb", "cc22dd"],
        tempFilesRemoved: 0,
        unattributedTempFiles: 0,
        unattributedRecords: 0,
        registryEntriesRemoved: 0,
        auditLinesReconciled: 0,
        truncated: false,
        unfinishedSweepRoots: [],
        unfinishedAuditFiles: [],
        auditListingTruncated: false,
        maintenanceComplete: true,
        failureCodes: [],
        unattributedRecordCodes: [],
        failures: 0,
      });
      return Promise.resolve(startedWith(Promise.resolve()));
    },
  });

  assert.equal(await runDaemon(h.deps), 0);
  assert.equal(h.lines.length, 1);
  const adopting = startupOf(h.lines);
  assert.equal(adopting["adopted"], 2);
  assert.deepEqual(adopting["adoptedContainerIds"], ["aa11bb", "cc22dd"]);
  assert.equal(adopting["containersRemoved"], 0);
  assert.equal(adopting["recordsDeleted"], 0);
});

void test("CRASH-04: the startup line has no id brackets when no container was removed, and names failures only when there are some", async (t) => {
  const dir = tempDir(t);
  const h = harness(writeConfig(dir, validConfig(dir)), {
    start: (options) => {
      options.onStartup?.({
        containerIds: [],
        removedCauses: [],
        adoptedContainerIds: [],
        containersRemoved: 0,
        recordsDeleted: 0,
        adopted: 0,
        tempFilesRemoved: 0,
        unattributedTempFiles: 0,
        unattributedRecords: 0,
        registryEntriesRemoved: 0,
        auditLinesReconciled: 0,
        truncated: false,
        unfinishedSweepRoots: [],
        unfinishedAuditFiles: [],
        auditListingTruncated: false,
        maintenanceComplete: true,
        failureCodes: [],
        unattributedRecordCodes: [],
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
        removedCauses: [],
        adoptedContainerIds: [],
        containersRemoved: 0,
        recordsDeleted: 0,
        adopted: 0,
        tempFilesRemoved: 0,
        unattributedTempFiles: 0,
        unattributedRecords: 0,
        registryEntriesRemoved: 0,
        auditLinesReconciled: 0,
        truncated: true,
        unfinishedSweepRoots: ["<workspace>", "<state>/sessions"],
        unfinishedAuditFiles: ["a.jsonl", "daemon.jsonl"],
        auditListingTruncated: false,
        maintenanceComplete: false,
        failureCodes: [],
        unattributedRecordCodes: [],
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
        removedCauses: [],
        adoptedContainerIds: [],
        containersRemoved: 1,
        recordsDeleted: 0,
        adopted: 0,
        tempFilesRemoved: 0,
        unattributedTempFiles: 0,
        unattributedRecords: 0,
        registryEntriesRemoved: 0,
        auditLinesReconciled: 0,
        truncated: false,
        unfinishedSweepRoots: [],
        unfinishedAuditFiles: [],
        auditListingTruncated: false,
        maintenanceComplete: false,
        failureCodes: [],
        unattributedRecordCodes: [],
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
  assert.equal(partial["code"], "REALM_STOPPING");
  assert.equal(partial["failures"], 1);
  assert.deepEqual(entryOf(h.lines[1] ?? ""), failed("REALM_STOPPING"));
});

void test("STARTUP budget: a long unfinished list is sampled at ten names, the count stays exact, and a truncated audit listing is named", async (t) => {
  const dir = tempDir(t);
  const names = Array.from({ length: 12 }, (_unused, index) => `s${String(index)}.jsonl`);
  const h = harness(writeConfig(dir, validConfig(dir)), {
    start: (options) => {
      options.onStartup?.({
        containerIds: [],
        removedCauses: [],
        adoptedContainerIds: [],
        containersRemoved: 0,
        recordsDeleted: 0,
        adopted: 0,
        tempFilesRemoved: 0,
        unattributedTempFiles: 0,
        unattributedRecords: 0,
        registryEntriesRemoved: 0,
        auditLinesReconciled: 0,
        truncated: false,
        unfinishedSweepRoots: [],
        unfinishedAuditFiles: names,
        auditListingTruncated: true,
        maintenanceComplete: false,
        failureCodes: [],
        unattributedRecordCodes: [],
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
  }
});

void test("a start rejecting with a RealmError returns 1 and writes its code", async (t) => {
  const dir = tempDir(t);
  const h = harness(writeConfig(dir, validConfig(dir)), {
    start: () => Promise.reject(makeRealmError("LOCK_CONFLICT")),
  });

  assert.equal(await runDaemon(h.deps), 1);
  assert.deepEqual(h.lines.map(entryOf), [failed("LOCK_CONFLICT")]);
});

void test("a start rejecting with a non-RealmError is reported as SCHEMA_INVALID", async (t) => {
  const dir = tempDir(t);
  const h = harness(writeConfig(dir, validConfig(dir)), {
    start: () => Promise.reject(new Error("raw detail that must not print")),
  });

  assert.equal(await runDaemon(h.deps), 1);
  assert.deepEqual(h.lines.map(entryOf), [failed("SCHEMA_INVALID")]);
});

void test("a signal stops the started daemon in process and resolves 0, with no socket line", async (t) => {
  const dir = tempDir(t);
  let finishTeardown: () => void = () => undefined;
  const done = new Promise<void>((resolve) => {
    finishTeardown = () => {
      resolve();
    };
  });
  let stops = 0;
  const h = harness(writeConfig(dir, validConfig(dir)), {
    start: () =>
      Promise.resolve({
        ...startedWith(done),
        stop: () => {
          stops += 1;
          finishTeardown();
          return Promise.resolve();
        },
      }),
  });

  const run = runDaemon(h.deps);
  await h.registered;
  const handler = h.handlers.get("SIGTERM");
  assert.ok(handler !== undefined);
  handler();

  assert.equal(await run, 0);
  assert.equal(stops, 1);
  assert.equal(h.handlers.size, 0, "signal listeners are removed once the daemon stops");
  assert.deepEqual(h.lines, []);
});

void test("a stop that rejects during a signal shutdown returns 1 with its code", async (t) => {
  const dir = tempDir(t);
  const h = harness(writeConfig(dir, validConfig(dir)), {
    start: () =>
      Promise.resolve({
        ...startedWith(new Promise<void>(() => undefined)),
        stop: () => Promise.reject(makeRealmError("AGENTOS_STOP_FAILED")),
      }),
  });

  const run = runDaemon(h.deps);
  await h.registered;
  const handler = h.handlers.get("SIGINT");
  assert.ok(handler !== undefined);
  handler();

  assert.equal(await run, 1);
  assert.deepEqual(h.lines.map(entryOf), [failed("AGENTOS_STOP_FAILED")]);
});

void test("the CLI down bound outlasts the daemon teardown bound", () => {
  assert.ok(
    CONTROL_TIMEOUT_MS.down > TEARDOWN_TIMEOUT_MS,
    "the CLI must not give up before the daemon finishes teardown",
  );
});

void test("OBS-02: an early startup failure is one logger JSON line, and the ensure parser reads its code", async (t) => {
  const dir = tempDir(t);
  const raw = validConfig(dir);
  const stateDir = String(raw["stateDir"]);
  mkdirSync(stateDir, { recursive: true });
  const logPath = daemonLogPath(stateDir);
  const lines: string[] = [];
  // The detached daemon inherits the startup log as stderr, so each entry line lands in the file the ensure parser reads.
  const deps: DaemonDeps = {
    env: writeConfig(dir, raw),
    writeStderr: (line: string) => {
      lines.push(line);
      appendFileSync(logPath, `${line}\n`);
    },
    start: () => Promise.reject(makeRealmError("POLICY_DENIED")),
  };

  assert.equal(await runDaemon(deps), 1);
  assert.equal(lines.length, 1);
  const [line] = lines;
  assert.ok(line !== undefined);
  const value = JSON.parse(line) as Record<string, unknown>;
  assert.deepEqual(Object.keys(value), ["ts", "level", "event", "code"]);
  assert.equal(Number.isNaN(Date.parse(String(value["ts"]))), false);
  assert.equal(value["level"], "error");
  assert.equal(value["event"], "daemon.failed");
  assert.equal(value["code"], "POLICY_DENIED");
  assert.equal(readFileSync(logPath, "utf8"), `${line}\n`);
  assert.equal(daemonStartFailureSince(stateDir, 0).code, "POLICY_DENIED");
});

void test("OBS-02: audit.head logs the chain head of a session's audit file when the session is created, not the daemon's", async (t) => {
  const dir = tempDir(t);
  const raw = validConfig(dir);
  const stateDir = String(raw["stateDir"]);
  mkdirSync(join(stateDir, "audit"), { recursive: true });
  for (let index = 0; index < 3; index += 1) {
    appendAudit(stateDir, {
      sessionId: "sess-main",
      tool: "status",
      outcome: "ok",
      phase: "admission",
      correlationId: `head-${String(index)}`,
    });
  }
  const head = verifyAuditFile(join(stateDir, "audit", "sess-main.jsonl")).head;
  assert.ok(head !== undefined);
  const h = harness(writeConfig(dir, raw), {
    start: (options) => {
      options.onAuditHead?.("sess-main");
      return Promise.resolve(startedWith(Promise.resolve()));
    },
  });

  assert.equal(await runDaemon(h.deps), 0);
  assert.equal(h.lines.length, 1, "one audit.head line for the session's create");
  assert.deepEqual(entryOf(h.lines[0] ?? ""), {
    level: "info",
    event: "audit.head",
    sessionId: "sess-main",
    seq: head.seq,
    lineSha256: head.hash,
  });
});

void test("OBS-02: audit.head logs nothing when the session's audit file is missing", async (t) => {
  const dir = tempDir(t);
  const h = harness(writeConfig(dir, validConfig(dir)), {
    start: (options) => {
      options.onAuditHead?.("sess-absent");
      return Promise.resolve(startedWith(Promise.resolve()));
    },
  });

  assert.equal(await runDaemon(h.deps), 0);
  assert.deepEqual(h.lines, []);
});

void test("OBS-02: audit.unreadable is logged as a warn when the session's audit file cannot be read", async (t) => {
  const dir = tempDir(t);
  const raw = validConfig(dir);
  const stateDir = String(raw["stateDir"]);
  mkdirSync(join(stateDir, "audit"), { recursive: true });
  // A symlink is refused by the no-follow open, so the file exists and cannot be read.
  symlinkSync(join(dir, "elsewhere.jsonl"), join(stateDir, "audit", "sess-link.jsonl"));
  const h = harness(writeConfig(dir, raw), {
    start: (options) => {
      options.onAuditHead?.("sess-link");
      return Promise.resolve(startedWith(Promise.resolve()));
    },
  });

  assert.equal(await runDaemon(h.deps), 0);
  assert.equal(h.lines.length, 1, "one audit.unreadable line for the session");
  assert.deepEqual(entryOf(h.lines[0] ?? ""), {
    level: "warn",
    event: "audit.unreadable",
    sessionId: "sess-link",
    reason: "unreadable",
  });
});

interface FailureRun {
  readonly lines: string[];
  readonly exits: number[];
  readonly listeners: Map<string, (error: unknown) => void>;
}

// Installs the failure handlers over a fake registry, so no process handler is registered and each exit is recorded.
function installFailureRun(): FailureRun {
  const run: FailureRun = { lines: [], exits: [], listeners: new Map<string, (error: unknown) => void>() };
  installFailureHandlers(
    (line) => {
      run.lines.push(line);
    },
    (code) => {
      run.exits.push(code);
    },
    (event, listener) => {
      run.listeners.set(event, listener);
    },
  );
  return run;
}

void test("uncaught: each failure event writes one daemon.failed line with its code, sets exit code 1, and exits once with 1", (t) => {
  const previous = process.exitCode;
  t.after(() => {
    process.exitCode = previous;
  });
  for (const event of ["uncaughtException", "unhandledRejection"]) {
    for (const [error, code] of [
      [makeRealmError("LOCK_CONFLICT"), "LOCK_CONFLICT"],
      [new Error("not a catalogue error"), "SCHEMA_INVALID"],
    ] as const) {
      const run = installFailureRun();
      const listener = run.listeners.get(event);
      assert.ok(listener !== undefined, `${event} has a handler`);
      process.exitCode = 0;
      listener(error);
      assert.deepEqual(run.lines.map(entryOf), [failed(code)]);
      assert.equal(process.exitCode, 1);
      assert.deepEqual(run.exits, [1]);
    }
  }
});

void test("a failed start writes daemon.failed to <stateDir>/daemon.log, not only to stderr (D-1704)", async (t) => {
  const dir = tempDir(t);
  const stateDir = join(dir, "state");
  mkdirSync(stateDir, { recursive: true });
  mkdirSync(join(dir, "workspace"), { recursive: true });
  const deps: DaemonDeps = {
    env: writeConfig(dir, validConfig(dir)),
    start: () => Promise.reject(makeRealmError("AGENTOS_CRASH_LOOP")),
  };
  assert.equal(await runDaemon(deps), 1);
  const records = readFileSync(join(stateDir, "daemon.log"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  assert.ok(records.some((record) => record["event"] === "daemon.failed" && record["code"] === "AGENTOS_CRASH_LOOP"));
});

// MULTI-03 (plan 09 T2): the startup line names the registry entries the startup removed and the records it deleted.
void test("MULTI-03: the startup line carries registryEntriesRemoved and recordsDeleted, with the unattributed counts", async (t) => {
  const dir = tempDir(t);
  const h = harness(writeConfig(dir, validConfig(dir)), {
    start: (options) => {
      options.onStartup?.({
        containerIds: [],
        removedCauses: [],
        adoptedContainerIds: [],
        containersRemoved: 0,
        recordsDeleted: 1,
        adopted: 0,
        tempFilesRemoved: 0,
        unattributedTempFiles: 2,
        unattributedRecords: 1,
        registryEntriesRemoved: 1,
        auditLinesReconciled: 0,
        truncated: false,
        unfinishedSweepRoots: [],
        unfinishedAuditFiles: [],
        auditListingTruncated: false,
        maintenanceComplete: true,
        failureCodes: [],
        unattributedRecordCodes: ["SCHEMA_INVALID"],
        failures: 0,
      });
      return Promise.resolve(startedWith(Promise.resolve()));
    },
  });

  assert.equal(await runDaemon(h.deps), 0);
  assert.equal(h.lines.length, 1);
  const line = startupOf(h.lines);
  assert.equal(line["registryEntriesRemoved"], 1);
  assert.equal(line["recordsDeleted"], 1);
  assert.equal(line["unattributedTempFiles"], 2);
  assert.equal(line["unattributedRecords"], 1);
  assert.equal(line["containersRemoved"], 0, "an existing field keeps its name and value");
});

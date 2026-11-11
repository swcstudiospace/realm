// Daemon start-failure tests. The startup log is a real file under a temp state directory;
// runDaemon drives the real logger with scripted startup failures. No socket is opened.

import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, closeSync, mkdtempSync, openSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeRealmError, RealmError } from "../../src/core/errors.js";
import { runDaemon } from "../../src/daemon/main.js";
import { DEFAULT_LOG_MAX_BYTES } from "../../src/observe/log-file.js";
import {
  daemonLogPath,
  daemonLogSize,
  daemonStartFailureSince,
  reportingStartFailure,
  requestLogPath,
} from "../../src/daemon/ensure.js";

function scratchStateDir(t: TestContext): string {
  const stateDir = realpathSync(mkdtempSync(join(tmpdir(), "realm-start-failure-")));
  t.after(() => {
    rmSync(stateDir, { recursive: true, force: true });
  });
  return stateDir;
}

function failed(code: string): string {
  return `${JSON.stringify({ level: "error", event: "daemon.failed", code })}\n`;
}

void test("a failure line appended after an offset is returned as its code", (t) => {
  const stateDir = scratchStateDir(t);
  writeFileSync(daemonLogPath(stateDir), "earlier startup output\n");
  const offset = daemonLogSize(stateDir);
  appendFileSync(daemonLogPath(stateDir), failed("POLICY_DENIED"));
  assert.equal(daemonStartFailureSince(stateDir, offset), "POLICY_DENIED");
});

void test("a failure line written before the offset is ignored", (t) => {
  const stateDir = scratchStateDir(t);
  writeFileSync(daemonLogPath(stateDir), failed("POLICY_DENIED"));
  const offset = daemonLogSize(stateDir);
  assert.equal(daemonStartFailureSince(stateDir, offset), undefined);
});

void test("a failure line without a trailing newline is ignored", (t) => {
  const stateDir = scratchStateDir(t);
  writeFileSync(daemonLogPath(stateDir), JSON.stringify({ level: "error", event: "daemon.failed", code: "POLICY_DENIED" }));
  assert.equal(daemonStartFailureSince(stateDir, 0), undefined);
});

void test("an uncatalogued failure token is ignored", (t) => {
  const stateDir = scratchStateDir(t);
  writeFileSync(daemonLogPath(stateDir), `${JSON.stringify({ level: "error", event: "daemon.failed", code: "NOT_A_CODE" })}\n`);
  assert.equal(daemonStartFailureSince(stateDir, 0), undefined);
});

void test("malformed JSON, null, an array, another event and a non-string code are not failures", (t) => {
  const stateDir = scratchStateDir(t);
  writeFileSync(daemonLogPath(stateDir), [
    "not json",
    "null",
    "[]",
    JSON.stringify({ event: "daemon.startup", code: "POLICY_DENIED" }),
    JSON.stringify({ event: "daemon.failed", code: 1 }),
    "",
  ].join("\n"));
  assert.equal(daemonStartFailureSince(stateDir, 0), undefined);
});

void test("a mixed log still reports the valid failure that follows the rejected records", (t) => {
  const stateDir = scratchStateDir(t);
  writeFileSync(daemonLogPath(stateDir), "realm daemon: POLICY_DENIED\n");
  appendFileSync(daemonLogPath(stateDir), "not json\n");
  appendFileSync(daemonLogPath(stateDir), failed("POLICY_DENIED"));
  assert.equal(daemonStartFailureSince(stateDir, 0), "POLICY_DENIED");
});

void test("a missing startup log has size 0 and yields no failure code", (t) => {
  const stateDir = scratchStateDir(t);
  assert.equal(daemonLogSize(stateDir), 0);
  assert.equal(daemonStartFailureSince(stateDir, 0), undefined);
});

void test("the wrapper passes an answering daemon through", async (t) => {
  const stateDir = scratchStateDir(t);
  const probe = reportingStartFailure(() => Promise.resolve("answering"), stateDir);
  assert.equal(await probe("/state/run/control.sock"), "answering");
});

void test("the wrapper returns what the inner probe found on every miss while the log shows no failure line", async (t) => {
  const stateDir = scratchStateDir(t);
  writeFileSync(daemonLogPath(stateDir), "startup output with no failure line\n");
  const absent = reportingStartFailure(() => Promise.resolve("absent"), stateDir);
  assert.equal(await absent("/state/run/control.sock"), "absent");
  assert.equal(await absent("/state/run/control.sock"), "absent");
  const starting = reportingStartFailure(() => Promise.resolve("starting"), stateDir);
  assert.equal(await starting("/state/run/control.sock"), "starting");
});

void test("the wrapper rejects with the daemon's code when a failure line appears after the first miss", async (t) => {
  const stateDir = scratchStateDir(t);
  const probe = reportingStartFailure(() => Promise.resolve("absent"), stateDir);
  assert.equal(await probe("/state/run/control.sock"), "absent");
  appendFileSync(daemonLogPath(stateDir), failed("POLICY_DENIED"));
  await assert.rejects(
    probe("/state/run/control.sock"),
    (error: unknown) => error instanceof RealmError && error.code === "POLICY_DENIED",
  );
});

void test("a LOCK_CONFLICT line is not a start failure: it is what a rival daemon writes when a live daemon owns the socket", (t) => {
  const stateDir = scratchStateDir(t);
  writeFileSync(daemonLogPath(stateDir), failed("LOCK_CONFLICT"));
  assert.equal(daemonStartFailureSince(stateDir, 0), undefined);
  // A real failure on a later line is still reported, and the rival's line does not hide it.
  appendFileSync(daemonLogPath(stateDir), `${failed("POLICY_DENIED")}${failed("LOCK_CONFLICT")}`);
  assert.equal(daemonStartFailureSince(stateDir, 0), "POLICY_DENIED");
});

void test("a host that waits for a live daemon keeps waiting when another host's spawn lost the race", async (t) => {
  const stateDir = scratchStateDir(t);
  const probe = reportingStartFailure(() => Promise.resolve("starting"), stateDir);
  assert.equal(await probe("/state/run/control.sock"), "starting");
  // The other host spawned a second daemon over the first, and the second refused and exited.
  appendFileSync(daemonLogPath(stateDir), failed("LOCK_CONFLICT"));
  assert.equal(await probe("/state/run/control.sock"), "starting", "the original daemon is still starting, so the wait goes on");
});

for (const code of ["SCHEMA_INVALID", "POLICY_DENIED", "LOCK_CONFLICT"] as const) {
  void test(`OBS-02: ensure consumes runDaemon's timestamped ${code} diagnostics on inherited stderr`, async (t) => {
    const stateDir = scratchStateDir(t);
    writeFileSync(daemonLogPath(stateDir), failed("AGENTOS_STOP_FAILED"));
    const offset = daemonLogSize(stateDir);
    let starts = 0;
    const exitCode = await runDaemon({
      env: { XDG_CONFIG_HOME: stateDir, REALM_LOG_LEVEL: "error" },
      readConfig: () => {
        if (code === "SCHEMA_INVALID") {
          throw new Error("API_KEY=private-config-detail");
        }
        return {
          image: `registry.example/realm/workload@sha256:${"a".repeat(64)}`,
          stateDir,
          workspaceRoot: join(stateDir, "workspace"),
        };
      },
      start: () => {
        starts += 1;
        return Promise.reject(makeRealmError(code));
      },
      writeStderr: (line) => { appendFileSync(daemonLogPath(stateDir), `${line}\n`); },
    });

    assert.equal(exitCode, 1);
    assert.equal(starts, code === "SCHEMA_INVALID" ? 0 : 1);
    assert.equal(daemonStartFailureSince(stateDir, offset), code === "LOCK_CONFLICT" ? undefined : code);
    const line = readFileSync(daemonLogPath(stateDir), "utf8").slice(offset).trimEnd();
    const record = JSON.parse(line) as Record<string, unknown>;
    assert.deepEqual(Object.keys(record), ["ts", "level", "event", "code"]);
    assert.equal(typeof record["ts"], "string");
    assert.equal(new Date(String(record["ts"])).toISOString(), record["ts"]);
    assert.equal(record["level"], "error");
    assert.equal(record["event"], "daemon.failed");
    assert.equal(record["code"], code);
    assert.equal(line.includes("private-config-detail"), false);
  });
}

void test("OBS-02: ensure waits for the complete timestamped failure record before rejecting with its code", async (t) => {
  const stateDir = scratchStateDir(t);
  const probe = reportingStartFailure(() => Promise.resolve("starting"), stateDir);
  assert.equal(await probe("/state/run/control.sock"), "starting");

  assert.equal(await runDaemon({
    env: { XDG_CONFIG_HOME: stateDir },
    readConfig: () => { throw makeRealmError("POLICY_DENIED"); },
    writeStderr: (line) => { appendFileSync(daemonLogPath(stateDir), line); },
  }), 1);
  assert.equal(daemonStartFailureSince(stateDir, 0), undefined);
  assert.equal(await probe("/state/run/control.sock"), "starting");
  appendFileSync(daemonLogPath(stateDir), "\n");

  await assert.rejects(
    probe("/state/run/control.sock"),
    (error: unknown) => error instanceof RealmError && error.code === "POLICY_DENIED",
  );
});

void test("OBS-02: request rotation leaves startup and failure records on the inherited daemon log descriptor", async (t) => {
  const stateDir = scratchStateDir(t);
  writeFileSync(requestLogPath(stateDir), Buffer.alloc(DEFAULT_LOG_MAX_BYTES, 0x0a));
  const fd = openSync(daemonLogPath(stateDir), "a");
  t.after(() => { closeSync(fd); });
  const offset = daemonLogSize(stateDir);
  const exitCode = await runDaemon({
    env: { XDG_CONFIG_HOME: stateDir },
    readConfig: () => ({
      image: `registry.example/realm/workload@sha256:${"a".repeat(64)}`,
      stateDir,
      workspaceRoot: join(stateDir, "workspace"),
    }),
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
      options.logger?.info("up.begin", { correlationId: "rotation" });
      assert.equal(daemonStartFailureSince(stateDir, offset), undefined, "a startup report is not a failure");
      return Promise.reject(makeRealmError("POLICY_DENIED"));
    },
    writeStderr: (line) => { writeSync(fd, `${line}\n`); },
  });

  assert.equal(exitCode, 1);
  assert.equal(statSync(`${requestLogPath(stateDir)}.1`).size, DEFAULT_LOG_MAX_BYTES);
  assert.equal(daemonStartFailureSince(stateDir, offset), "POLICY_DENIED");
  const diagnostics = readFileSync(daemonLogPath(stateDir), "utf8").trimEnd().split("\n")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  assert.deepEqual(diagnostics.map((record) => record["event"]), ["daemon.startup", "daemon.failed"]);
  for (const record of diagnostics) {
    assert.equal(typeof record["ts"], "string");
    assert.equal(new Date(String(record["ts"])).toISOString(), record["ts"]);
  }
  const request = JSON.parse(readFileSync(requestLogPath(stateDir), "utf8")) as Record<string, unknown>;
  assert.equal(request["event"], "up.begin");
  assert.equal(request["correlationId"], "rotation");
});

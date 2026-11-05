// The startup report's failureCodes carry the catalogue code of a failure the temp-file sweep counted and the code of a failure
// the audit reconciliation counted (D-1409). Both failures are forced on disk, so the test runs the real startup maintenance over
// a scratch state directory and needs no daemon. The reap has nothing to remove, so its seams are empty.

import { after, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { loadPolicyFile } from "../../src/core/policy.js";
import { makeRealmError } from "../../src/core/errors.js";
import { runStartupMaintenance, type StartupReport } from "../../src/daemon/startup.js";
import { SessionStore } from "../../src/session/store.js";

const SESSION = "5a1c0c3e-7d2b-4f10-9a77-0b8e1c2d3e4f";
const TEMP_NAME = ".doc.txt.realm-tmp-0123456789abcdef";
const HOUR_MS = 3_600_000;

const scratchDirs: string[] = [];
after(() => {
  for (const dir of scratchDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

void test("D-1409: the startup report carries the code of a sweep failure and the code of a reconciliation failure", async () => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "realm-startup-codes-")));
  scratchDirs.push(base);
  const ws = join(base, "ws");
  const stateDir = join(base, "state");
  mkdirSync(ws, { recursive: true });
  mkdirSync(stateDir, { recursive: true });
  const policyPath = join(base, "policy.json");
  writeFileSync(policyPath, JSON.stringify({ mode: "advisory", workspaceRoots: [ws] }));

  // A record that names the workspace, so the orphan below is attributed to a session and its audit line is attempted.
  const store = new SessionStore(stateDir);
  store.save({
    realmId: "realm-startup-codes",
    sessionId: SESSION,
    workspaceRoot: ws,
    state: "unbound",
    controlSocketPath: join(base, "control.sock"),
    containerId: null,
  });
  // An aged orphan temp file owned by this process. The sweep considers it, and its audit line is refused, so it is kept.
  const orphan = join(ws, TEMP_NAME);
  writeFileSync(orphan, "partial");
  const hourAgo = new Date(Date.now() - HOUR_MS);
  utimesSync(orphan, hourAgo, hourAgo);
  // The audit directory is a regular file. The root step refuses it (POLICY_DENIED), an audit line cannot be appended to it
  // (the sweep's line is refused with AUDIT_WRITE_FAILED), and the reconciliation cannot list it (PATH_ESCAPE).
  writeFileSync(join(stateDir, "audit"), "not a directory");

  const reports: StartupReport[] = [];
  await runStartupMaintenance({
    store,
    reap: {
      listCandidates: () => Promise.resolve([]),
      verdict: () => ({ ok: true }),
      remove: () => Promise.resolve(),
      listSurvivors: () => Promise.resolve([]),
    },
    hydrate: () => Promise.reject(new Error("no session is adopted, so nothing is hydrated")),
    serve: () => undefined,
    pending: new Set<string>(),
    policy: loadPolicyFile(policyPath),
    stateDir,
    now: () => Date.now(),
    monotonicNow: () => performance.now(),
    budgetMs: 60_000,
    onReport: (report) => {
      reports.push(report);
    },
  });

  assert.equal(reports.length, 1);
  const report = reports[0];
  assert.ok(report !== undefined, "the maintenance reported once");
  assert.deepEqual(
    report.failureCodes,
    ["POLICY_DENIED", "AUDIT_WRITE_FAILED", "PATH_ESCAPE"],
    "the audit root is a file, so the root step refuses it, then the sweep's refused audit line, then the reconciliation's unlisted audit directory",
  );
  assert.equal(report.failures, report.failureCodes.length, "one count for each code the steps added");
  assert.equal(report.tempFilesRemoved, 0);
  assert.equal(existsSync(orphan), true, "the orphan whose removal could not be audited is kept");
  assert.equal(report.auditLinesReconciled, 0);
  assert.equal(report.maintenanceComplete, false, "the audit directory was not reconciled, so the maintenance is not complete");
});

void test("D-1409: a sweep that throws leaves the maintenance incomplete, lists the roots it did not walk, and the start still reports", async () => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "realm-startup-sweep-throw-")));
  scratchDirs.push(base);
  const ws = join(base, "ws");
  const stateDir = join(base, "state");
  mkdirSync(ws, { recursive: true });
  mkdirSync(stateDir, { recursive: true });
  const policyPath = join(base, "policy.json");
  writeFileSync(policyPath, JSON.stringify({ mode: "advisory", workspaceRoots: [ws] }));

  const reports: StartupReport[] = [];
  let served = false;
  await runStartupMaintenance({
    store: new SessionStore(stateDir),
    reap: {
      listCandidates: () => Promise.resolve([]),
      verdict: () => ({ ok: true }),
      remove: () => Promise.resolve(),
      listSurvivors: () => Promise.resolve([]),
    },
    hydrate: () => Promise.reject(new Error("no session is adopted, so nothing is hydrated")),
    serve: () => {
      served = true;
    },
    pending: new Set<string>(),
    policy: loadPolicyFile(policyPath),
    stateDir,
    // The sweep reads the clock for its options, so this clock makes the sweep step throw before the sweep walks anything.
    now: () => {
      throw makeRealmError("CLEANUP_FAILED");
    },
    monotonicNow: () => performance.now(),
    budgetMs: 60_000,
    onReport: (report) => {
      reports.push(report);
    },
  });

  assert.equal(served, true, "the gate opened: the failed sweep did not abort the start");
  assert.equal(reports.length, 1, "the start reported");
  const report = reports[0];
  assert.ok(report !== undefined, "the maintenance reported once");
  assert.equal(report.maintenanceComplete, false, "a sweep that did not finish is not a complete maintenance");
  assert.deepEqual(report.unfinishedSweepRoots, [ws], "the workspace root the sweep was to walk is unfinished");
  assert.deepEqual(report.failureCodes, ["CLEANUP_FAILED"], "the sweep's failure carries its code");
  assert.equal(report.failures, 1);
  assert.equal(report.tempFilesRemoved, 0);
});

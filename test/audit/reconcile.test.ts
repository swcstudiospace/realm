import { test } from "node:test";
import assert from "node:assert/strict";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendAudit, type AuditEntryInput } from "../../src/audit/log.js";
import {
  pairingKey,
  RECONCILE_PROGRESS_FILE,
  reconcileAuditLogs,
  SCAN_CHECK_LINES,
  SCAN_CHUNK_BYTES,
} from "../../src/audit/reconcile.js";

const SESSION = "11111111-2222-4333-8444-555555555555";
const OTHER_SESSION = "66666666-7777-4888-8999-aaaaaaaaaaaa";
const HEX64 = "b".repeat(64);

function withStateDir(run: (stateDir: string) => void): void {
  const stateDir = mkdtempSync(join(tmpdir(), "realm-reconcile-"));
  try {
    run(stateDir);
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
  }
}

function withStateAndOutside(run: (stateDir: string, outside: string) => void): void {
  const stateDir = mkdtempSync(join(tmpdir(), "realm-reconcile-"));
  const outside = mkdtempSync(join(tmpdir(), "realm-reconcile-outside-"));
  try {
    run(stateDir, outside);
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
}

function auditFile(stateDir: string, sessionId = SESSION): string {
  return join(stateDir, "audit", `${sessionId}.jsonl`);
}

function readEntries(stateDir: string, sessionId = SESSION): Record<string, unknown>[] {
  const text = readFileSync(auditFile(stateDir, sessionId), "utf8");
  return text
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function admit(stateDir: string, tool: string, extra: Partial<AuditEntryInput> = {}): void {
  appendAudit(stateDir, { sessionId: SESSION, tool, outcome: "ok", phase: "admission", ...extra });
}

function result(stateDir: string, tool: string, extra: Partial<AuditEntryInput> = {}): void {
  appendAudit(stateDir, { sessionId: SESSION, tool, outcome: "ok", phase: "result", ...extra });
}

function reconciliations(stateDir: string, sessionId = SESSION): Record<string, unknown>[] {
  return readEntries(stateDir, sessionId).filter((entry) => entry["phase"] === "reconciliation");
}

void test("CRASH-02: an admission with no result gets exactly one reconciliation line (D-1403)", () => {
  withStateDir((stateDir) => {
    admit(stateDir, "write", { path: "a.txt" });

    const outcome = reconcileAuditLogs(stateDir);

    assert.deepEqual(outcome, { files: 1, appended: 1, failed: 0, unfinished: [], complete: true, skippedUnchanged: 0 });
    const lines = reconciliations(stateDir);
    assert.equal(lines.length, 1);
    assert.equal(lines[0]?.["tool"], "write");
    assert.equal(lines[0]["path"], "a.txt");
    assert.equal(readEntries(stateDir).length, 2);
  });
});

void test("CRASH-02: a balanced admission and result pair gets no line", () => {
  withStateDir((stateDir) => {
    admit(stateDir, "write", { path: "a.txt" });
    result(stateDir, "write", { path: "a.txt", bytes: 3, sha256: HEX64 });

    assert.deepEqual(reconcileAuditLogs(stateDir), { files: 1, appended: 0, failed: 0, unfinished: [], complete: true, skippedUnchanged: 0 });
    assert.equal(readEntries(stateDir).length, 2);
  });
});

void test("CRASH-02: two identical admissions with one result get exactly one reconciliation line", () => {
  withStateDir((stateDir) => {
    admit(stateDir, "write", { path: "a.txt" });
    admit(stateDir, "write", { path: "a.txt" });
    result(stateDir, "write", { path: "a.txt", bytes: 3, sha256: HEX64 });

    assert.equal(reconcileAuditLogs(stateDir).appended, 1);
    assert.equal(reconciliations(stateDir).length, 1);
  });
});

void test("CRASH-02: interleaved calls A1, A2, R2, R1 on different keys get no line, because pairing counts and does not use order", () => {
  withStateDir((stateDir) => {
    admit(stateDir, "write", { path: "a.txt" });
    admit(stateDir, "write", { path: "b.txt" });
    result(stateDir, "write", { path: "b.txt", bytes: 1, sha256: HEX64 });
    result(stateDir, "write", { path: "a.txt", bytes: 1, sha256: HEX64 });

    assert.equal(reconcileAuditLogs(stateDir).appended, 0);
    assert.equal(readEntries(stateDir).length, 4);
  });
});

void test("CRASH-02: a second run appends nothing, because every admission is closed after the first", () => {
  withStateDir((stateDir) => {
    admit(stateDir, "write", { path: "a.txt" });
    admit(stateDir, "exec", { execSummary: { argv: ["make"] } });
    admit(stateDir, "exec", { execSummary: { argv: ["make"] } });

    assert.equal(reconcileAuditLogs(stateDir).appended, 3);
    const before = readFileSync(auditFile(stateDir), "utf8");

    assert.deepEqual(reconcileAuditLogs(stateDir), { files: 1, appended: 0, failed: 0, unfinished: [], complete: true, skippedUnchanged: 1 });
    assert.equal(readFileSync(auditFile(stateDir), "utf8"), before);
  });
});

void test("CRASH-02: exec admissions pair by their argv summary, and the reconciliation line copies it", () => {
  withStateDir((stateDir) => {
    admit(stateDir, "exec", { execSummary: { argv: ["make", "build"] } });
    admit(stateDir, "exec", { execSummary: { argv: ["make", "test"] } });
    result(stateDir, "exec", { execSummary: { argv: ["make", "test"] } });

    assert.equal(reconcileAuditLogs(stateDir).appended, 1);
    const lines = reconciliations(stateDir);
    assert.equal(lines.length, 1);
    assert.deepEqual(lines[0]?.["execSummary"], { argv: ["make", "build"] });
  });
});

void test("CRASH-02: lines with no phase, unparseable lines and a torn last line are ignored", () => {
  withStateDir((stateDir) => {
    // A pre-stage line and a sweep-style line carry no phase.
    appendAudit(stateDir, { sessionId: SESSION, tool: "write", outcome: "ok", path: "a.txt" });
    appendAudit(stateDir, { sessionId: SESSION, tool: "sweep", outcome: "ok", path: "x.tmp" });
    writeFileSync(auditFile(stateDir), `${readFileSync(auditFile(stateDir), "utf8")}not json\n[1,2]\n{"phase":"admission","tool":"wri`);

    assert.deepEqual(reconcileAuditLogs(stateDir), { files: 1, appended: 0, failed: 0, unfinished: [], complete: true, skippedUnchanged: 0 });
  });
});

void test("CRASH-02: a result with no admission is ignored", () => {
  withStateDir((stateDir) => {
    result(stateDir, "write", { path: "a.txt", bytes: 1, sha256: HEX64 });

    assert.deepEqual(reconcileAuditLogs(stateDir), { files: 1, appended: 0, failed: 0, unfinished: [], complete: true, skippedUnchanged: 0 });
    assert.equal(readEntries(stateDir).length, 1);
  });
});

void test("CRASH-02: a reconciliation line carries AUDIT_OUTCOME_UNKNOWN and never bytes or sha256", () => {
  withStateDir((stateDir) => {
    admit(stateDir, "write", { path: "a.txt", bytes: 9, sha256: HEX64 });

    reconcileAuditLogs(stateDir);

    const line = reconciliations(stateDir)[0];
    assert.ok(line !== undefined);
    assert.equal(line["outcome"], "AUDIT_OUTCOME_UNKNOWN");
    assert.equal(line["sessionId"], SESSION);
    assert.equal("bytes" in line, false);
    assert.equal("sha256" in line, false);
    assert.equal(typeof line["at"], "string");
  });
});

void test("CRASH-02: each session's log is reconciled on its own", () => {
  withStateDir((stateDir) => {
    admit(stateDir, "write", { path: "a.txt" });
    appendAudit(stateDir, { sessionId: OTHER_SESSION, tool: "write", outcome: "ok", phase: "admission", path: "a.txt" });
    appendAudit(stateDir, { sessionId: OTHER_SESSION, tool: "write", outcome: "ok", phase: "result", path: "a.txt" });

    assert.deepEqual(reconcileAuditLogs(stateDir), { files: 2, appended: 1, failed: 0, unfinished: [], complete: true, skippedUnchanged: 0 });
    assert.equal(reconciliations(stateDir).length, 1);
    assert.equal(reconciliations(stateDir, OTHER_SESSION).length, 0);
  });
});

void test("CRASH-02: a missing audit directory is zero work", () => {
  withStateDir((stateDir) => {
    assert.deepEqual(reconcileAuditLogs(stateDir), { files: 0, appended: 0, failed: 0, unfinished: [], complete: true, skippedUnchanged: 0 });
    assert.deepEqual(readdirSync(stateDir), []);
  });
});

void test("CRASH-02: a symlinked audit directory is refused and nothing is written through it", () => {
  withStateAndOutside((stateDir, outside) => {
    writeFileSync(join(outside, `${SESSION}.jsonl`), `${JSON.stringify({ tool: "write", phase: "admission", path: "a.txt" })}\n`);
    symlinkSync(outside, join(stateDir, "audit"), "dir");
    const before = readFileSync(join(outside, `${SESSION}.jsonl`), "utf8");

    assert.deepEqual(reconcileAuditLogs(stateDir), { files: 0, appended: 0, failed: 1, unfinished: [], complete: true, skippedUnchanged: 0 });
    assert.equal(readFileSync(join(outside, `${SESSION}.jsonl`), "utf8"), before);
    assert.deepEqual(readdirSync(outside), [`${SESSION}.jsonl`]);
  });
});

void test("CRASH-02: a symlinked audit file is refused and the file it points at is unchanged", () => {
  withStateAndOutside((stateDir, outside) => {
    mkdirSync(join(stateDir, "audit"), { recursive: true });
    const target = join(outside, "target.jsonl");
    writeFileSync(target, `${JSON.stringify({ tool: "write", phase: "admission", path: "a.txt" })}\n`);
    const before = readFileSync(target, "utf8");
    symlinkSync(target, auditFile(stateDir));

    assert.deepEqual(reconcileAuditLogs(stateDir), { files: 0, appended: 0, failed: 1, unfinished: [], complete: true, skippedUnchanged: 0 });
    assert.equal(readFileSync(target, "utf8"), before);
  });
});

void test("CRASH-02: a log whose name is not a safe session id is refused, and the other logs are still reconciled", () => {
  withStateDir((stateDir) => {
    admit(stateDir, "write", { path: "a.txt" });
    writeFileSync(join(stateDir, "audit", ".hidden.jsonl"), `${JSON.stringify({ tool: "write", phase: "admission" })}\n`);

    assert.deepEqual(reconcileAuditLogs(stateDir), { files: 1, appended: 1, failed: 1, unfinished: [], complete: true, skippedUnchanged: 0 });
    assert.equal(readFileSync(join(stateDir, "audit", ".hidden.jsonl"), "utf8").split("\n").length, 2);
  });
});

void test("CRASH-02: a log over the size cap is skipped and counted, not read", () => {
  withStateDir((stateDir) => {
    admit(stateDir, "write", { path: "a.txt" });
    const before = readFileSync(auditFile(stateDir), "utf8");

    assert.deepEqual(reconcileAuditLogs(stateDir, { maxFileBytes: 10 }), { files: 0, appended: 0, failed: 1, unfinished: [], complete: true, skippedUnchanged: 0 });
    assert.equal(readFileSync(auditFile(stateDir), "utf8"), before);
  });
});

void test("CRASH-02: a log with a torn last line still reconciles, and the appended line starts on its own line", () => {
  withStateDir((stateDir) => {
    admit(stateDir, "write", { path: "a.txt" });
    writeFileSync(auditFile(stateDir), `${readFileSync(auditFile(stateDir), "utf8")}{"phase":"result","tool":"wri`);

    assert.equal(reconcileAuditLogs(stateDir).appended, 1);
    const lines = readFileSync(auditFile(stateDir), "utf8").split("\n").filter((line) => line.length > 0);
    assert.equal(lines.length, 3);
    assert.equal((JSON.parse(lines[2] ?? "") as Record<string, unknown>)["phase"], "reconciliation");
    assert.equal(reconcileAuditLogs(stateDir).appended, 0);
  });
});

void test("CRASH-02: pairingKey joins tool, path and the exec summary, and tells different calls apart", () => {
  assert.equal(pairingKey({ tool: "write", path: "a.txt" }), "write\0a.txt\0null");
  assert.equal(pairingKey({ tool: "status" }), "status\0\0null");
  assert.equal(pairingKey({ tool: "exec", execSummary: { argv: ["ls"] } }), 'exec\0\0{"argv":["ls"]}');
  assert.notEqual(pairingKey({ tool: "write", path: "a.txt" }), pairingKey({ tool: "write", path: "b.txt" }));
  assert.notEqual(pairingKey({ tool: "write", path: "a.txt" }), pairingKey({ tool: "read", path: "a.txt" }));
});

// What the reconciliation lines of a log say, without their timestamps, so two runs compare by content.
function reconciledContent(stateDir: string, sessionId: string): string[] {
  return reconciliations(stateDir, sessionId).map((entry) =>
    JSON.stringify([entry["tool"], entry["path"], entry["outcome"], entry["execSummary"]]),
  );
}

function hasReconciliation(stateDir: string, sessionId: string): boolean {
  return existsSync(auditFile(stateDir, sessionId)) && reconciliations(stateDir, sessionId).length > 0;
}

// Two logs, each with two admissions and one result, so each needs exactly one reconciliation line.
function plantTwoLogs(stateDir: string): void {
  for (const sessionId of [SESSION, OTHER_SESSION]) {
    appendAudit(stateDir, { sessionId, tool: "write", outcome: "ok", phase: "admission", path: "a.txt" });
    appendAudit(stateDir, { sessionId, tool: "write", outcome: "ok", phase: "admission", path: "b.txt" });
    appendAudit(stateDir, { sessionId, tool: "write", outcome: "ok", phase: "result", path: "a.txt" });
  }
  // SESSION is the newer log, so it is reconciled first (newest modified first).
  setAge(stateDir, SESSION, 10);
  setAge(stateDir, OTHER_SESSION, 3600);
}

// One fixed "now" for the whole file, so two logs given the same age get the same mtime exactly.
const BASE_MS = Date.now();

// Sets a log's mtime to `secondsAgo` seconds before BASE_MS.
function setAge(stateDir: string, sessionId: string, secondsAgo: number): void {
  const when = new Date(BASE_MS - secondsAgo * 1000);
  utimesSync(auditFile(stateDir, sessionId), when, when);
}

void test("STARTUP budget: a deadline already in the past appends nothing and reports every log unfinished", () => {
  withStateDir((stateDir) => {
    plantTwoLogs(stateDir);
    const before = [readFileSync(auditFile(stateDir), "utf8"), readFileSync(auditFile(stateDir, OTHER_SESSION), "utf8")];

    const outcome = reconcileAuditLogs(stateDir, { now: () => 100, deadline: 100 });

    assert.deepEqual(outcome, {
      files: 0,
      appended: 0,
      failed: 0,
      unfinished: [`${SESSION}.jsonl`, `${OTHER_SESSION}.jsonl`],
      complete: false,
      skippedUnchanged: 0,
    });
    assert.deepEqual([readFileSync(auditFile(stateDir), "utf8"), readFileSync(auditFile(stateDir, OTHER_SESSION), "utf8")], before);
  });
});

void test("STARTUP budget: a deadline that expires between two logs reconciles the first, and a later complete run finishes the rest", () => {
  withStateDir((stateDir) => {
    plantTwoLogs(stateDir);
    // The clock reads 1 (the deadline) as soon as the first log has its reconciliation line, so the expiry falls between logs.
    const outcome = reconcileAuditLogs(stateDir, {
      now: () => (hasReconciliation(stateDir, SESSION) ? 1 : 0),
      deadline: 1,
    });

    assert.deepEqual(outcome, { files: 1, appended: 1, failed: 0, unfinished: [`${OTHER_SESSION}.jsonl`], complete: false, skippedUnchanged: 0 });
    assert.equal(reconciliations(stateDir).length, 1);
    assert.equal(hasReconciliation(stateDir, OTHER_SESSION), false);

    // The log the first run completed is skipped through the progress record; the other one is scanned.
    const rest = reconcileAuditLogs(stateDir);
    assert.deepEqual(rest, { files: 2, appended: 1, failed: 0, unfinished: [], complete: true, skippedUnchanged: 1 });
    assert.deepEqual(reconcileAuditLogs(stateDir), { files: 2, appended: 0, failed: 0, unfinished: [], complete: true, skippedUnchanged: 2 });

    // The lines of the two runs together are those one complete run appends.
    withStateDir((reference) => {
      plantTwoLogs(reference);
      assert.equal(reconcileAuditLogs(reference).appended, 2);
      assert.deepEqual(reconciledContent(stateDir, SESSION), reconciledContent(reference, SESSION));
      assert.deepEqual(reconciledContent(stateDir, OTHER_SESSION), reconciledContent(reference, OTHER_SESSION));
    });
  });
});

void test("STARTUP budget: a deadline that expires in the middle of a log appends nothing for that log", () => {
  withStateDir((stateDir) => {
    admit(stateDir, "write", { path: "a.txt" });
    const filler = `${JSON.stringify({ phase: "result", tool: "filler", outcome: "ok" })}\n`;
    appendFileSync(auditFile(stateDir), filler.repeat(SCAN_CHECK_LINES + 100));
    const before = readFileSync(auditFile(stateDir), "utf8");

    // Reads 0 for the loop-start check and the check before the first read, then 1: the next check is the one after the
    // SCAN_CHECK_LINES-th line, inside the scan.
    let reads = 0;
    const outcome = reconcileAuditLogs(stateDir, {
      now: () => {
        reads += 1;
        return reads > 2 ? 1 : 0;
      },
      deadline: 1,
    });

    assert.deepEqual(outcome, { files: 0, appended: 0, failed: 0, unfinished: [`${SESSION}.jsonl`], complete: false, skippedUnchanged: 0 });
    assert.equal(readFileSync(auditFile(stateDir), "utf8"), before, "a partial scan appends no line");
    assert.deepEqual(reconcileAuditLogs(stateDir), { files: 1, appended: 1, failed: 0, unfinished: [], complete: true, skippedUnchanged: 0 });
  });
});

void test("STARTUP budget: a log larger than one read step is scanned completely, lines split across steps included", () => {
  withStateDir((stateDir) => {
    const padding = "p".repeat(100);
    const filler = `${JSON.stringify({ phase: "result", tool: "filler", outcome: "ok", path: padding })}\n`;
    const count = Math.ceil((SCAN_CHUNK_BYTES * 2) / filler.length);
    admit(stateDir, "write", { path: "first.txt" });
    admit(stateDir, "write", { path: "last.txt" });
    appendFileSync(auditFile(stateDir), filler.repeat(count));
    result(stateDir, "write", { path: "last.txt" });
    assert.ok(readFileSync(auditFile(stateDir)).length > SCAN_CHUNK_BYTES * 2);

    assert.equal(reconcileAuditLogs(stateDir).appended, 1);
    const lines = reconciliations(stateDir);
    assert.equal(lines.length, 1);
    assert.equal(lines[0]?.["path"], "first.txt");
  });
});

// A clock that reads how many reconciliation lines this run has appended, so a budget of `lines` allows `lines` appends.
function budgetOfLines(stateDir: string, sessionIds: readonly string[], lines: number): { now: () => number; deadline: number } {
  const total = (): number => sessionIds.reduce((sum, id) => sum + reconciliations(stateDir, id).length, 0);
  const base = total();
  return { now: () => total() - base, deadline: lines };
}

void test("STARTUP budget: logs are reconciled newest modified first, ties by name", () => {
  withStateDir((stateDir) => {
    for (const [id, ago] of [["log-a", 5000], ["log-b", 1000], ["log-c", 3000], ["log-d", 3000]] as const) {
      appendAudit(stateDir, { sessionId: id, tool: "write", outcome: "ok", phase: "admission", path: "a.txt" });
      setAge(stateDir, id, ago);
    }
    // A deadline in the past reaches no log, so `unfinished` is the order the logs would have been taken in.
    const outcome = reconcileAuditLogs(stateDir, { now: () => 1, deadline: 1 });
    assert.deepEqual(outcome.unfinished, ["log-b.jsonl", "log-c.jsonl", "log-d.jsonl", "log-a.jsonl"]);
  });
});

void test("STARTUP budget: restarts with the same small budget make progress through the record and eventually finish", () => {
  withStateDir((stateDir) => {
    const ids = ["log-1", "log-2", "log-3", "log-4", "log-5"];
    ids.forEach((id, index) => {
      appendAudit(stateDir, { sessionId: id, tool: "write", outcome: "ok", phase: "admission", path: "a.txt" });
      setAge(stateDir, id, 10_000 - index * 100);
    });

    const first = reconcileAuditLogs(stateDir, budgetOfLines(stateDir, ids, 2));
    assert.equal(first.appended, 2);
    assert.equal(first.unfinished.length, 3);
    assert.equal(first.skippedUnchanged, 0);

    // The two logs the first start finished are the newest now; the second start passes them through the record
    // without reading them and spends its budget on the next two.
    const second = reconcileAuditLogs(stateDir, budgetOfLines(stateDir, ids, 2));
    assert.equal(second.skippedUnchanged, 2);
    assert.equal(second.appended, 2);
    assert.equal(second.unfinished.length, 1);

    const third = reconcileAuditLogs(stateDir, budgetOfLines(stateDir, ids, 2));
    assert.equal(third.skippedUnchanged, 4);
    assert.equal(third.appended, 1);
    assert.equal(third.complete, true);

    const fourth = reconcileAuditLogs(stateDir);
    assert.deepEqual(fourth, { files: 5, appended: 0, failed: 0, unfinished: [], complete: true, skippedUnchanged: 5 });
    for (const id of ids) {
      assert.equal(reconciliations(stateDir, id).length, 1, `${id} has exactly one reconciliation line`);
    }
  });
});

void test("STARTUP budget: the record maps each completed log to its size and mtime, measured after the reconciler's own appends", () => {
  withStateDir((stateDir) => {
    admit(stateDir, "write", { path: "a.txt" });
    reconcileAuditLogs(stateDir);

    const record = JSON.parse(readFileSync(join(stateDir, "audit", RECONCILE_PROGRESS_FILE), "utf8")) as Record<string, unknown>;
    assert.deepEqual(Object.keys(record), [`${SESSION}.jsonl`]);
    const entry = record[`${SESSION}.jsonl`] as { size: number; mtimeMs: number };
    const current = statSync(auditFile(stateDir));
    assert.equal(entry.size, current.size, "the size includes the reconciliation line");
    assert.equal(entry.mtimeMs, current.mtimeMs);
    assert.equal(readdirSync(join(stateDir, "audit")).filter((name) => name.endsWith(".jsonl")).length, 1, "the record is not a log");
  });
});

void test("STARTUP budget: a log that changed since it was recorded is scanned again", () => {
  withStateDir((stateDir) => {
    admit(stateDir, "write", { path: "a.txt" });
    appendAudit(stateDir, { sessionId: OTHER_SESSION, tool: "write", outcome: "ok", phase: "admission", path: "b.txt" });
    assert.equal(reconcileAuditLogs(stateDir).appended, 2);

    // A new admission arrives in one log after the record was written (the next daemon's life).
    admit(stateDir, "write", { path: "c.txt" });
    const outcome = reconcileAuditLogs(stateDir);
    assert.equal(outcome.skippedUnchanged, 1, "the untouched log is skipped");
    assert.equal(outcome.appended, 1, "the changed log is scanned and reconciled");
    assert.equal(reconciliations(stateDir).length, 2);
  });
});

void test("STARTUP budget: a corrupt, wrong-shaped or unreadable record is ignored and rewritten", () => {
  const bad: readonly string[] = ["{not json", "[1,2,3]", "null", '{"x.jsonl": {"size": "a", "mtimeMs": 1}}', ""];
  for (const content of bad) {
    withStateDir((stateDir) => {
      admit(stateDir, "write", { path: "a.txt" });
      writeFileSync(join(stateDir, "audit", RECONCILE_PROGRESS_FILE), content);

      const outcome = reconcileAuditLogs(stateDir);
      assert.deepEqual(outcome, { files: 1, appended: 1, failed: 0, unfinished: [], complete: true, skippedUnchanged: 0 });
      assert.deepEqual(Object.keys(JSON.parse(readFileSync(join(stateDir, "audit", RECONCILE_PROGRESS_FILE), "utf8")) as object), [
        `${SESSION}.jsonl`,
      ]);
    });
  }
  withStateDir((stateDir) => {
    admit(stateDir, "write", { path: "a.txt" });
    // A directory where the record should be: unreadable, so empty; the write of the record fails and is counted, not thrown.
    mkdirSync(join(stateDir, "audit", RECONCILE_PROGRESS_FILE));
    const outcome = reconcileAuditLogs(stateDir);
    assert.equal(outcome.appended, 1);
    assert.equal(outcome.skippedUnchanged, 0);
  });
});

void test("STARTUP budget: a log cut off by the deadline records nothing", () => {
  withStateDir((stateDir) => {
    admit(stateDir, "write", { path: "a.txt" });
    appendFileSync(auditFile(stateDir), `${JSON.stringify({ phase: "result", tool: "filler", outcome: "ok" })}\n`.repeat(SCAN_CHECK_LINES + 10));
    let reads = 0;
    const cut = reconcileAuditLogs(stateDir, {
      now: () => {
        reads += 1;
        return reads > 2 ? 1 : 0;
      },
      deadline: 1,
    });
    assert.equal(cut.complete, false);
    assert.equal(existsSync(join(stateDir, "audit", RECONCILE_PROGRESS_FILE)), false);
    assert.equal(reconcileAuditLogs(stateDir).appended, 1, "the next run scans the log and appends its line");
  });
});

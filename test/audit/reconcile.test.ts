import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendAudit, type AuditEntryInput } from "../../src/audit/log.js";
import { pairingKey, reconcileAuditLogs } from "../../src/audit/reconcile.js";

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

    assert.deepEqual(outcome, { files: 1, appended: 1, failed: 0 });
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

    assert.deepEqual(reconcileAuditLogs(stateDir), { files: 1, appended: 0, failed: 0 });
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

    assert.deepEqual(reconcileAuditLogs(stateDir), { files: 1, appended: 0, failed: 0 });
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

    assert.deepEqual(reconcileAuditLogs(stateDir), { files: 1, appended: 0, failed: 0 });
  });
});

void test("CRASH-02: a result with no admission is ignored", () => {
  withStateDir((stateDir) => {
    result(stateDir, "write", { path: "a.txt", bytes: 1, sha256: HEX64 });

    assert.deepEqual(reconcileAuditLogs(stateDir), { files: 1, appended: 0, failed: 0 });
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

    assert.deepEqual(reconcileAuditLogs(stateDir), { files: 2, appended: 1, failed: 0 });
    assert.equal(reconciliations(stateDir).length, 1);
    assert.equal(reconciliations(stateDir, OTHER_SESSION).length, 0);
  });
});

void test("CRASH-02: a missing audit directory is zero work", () => {
  withStateDir((stateDir) => {
    assert.deepEqual(reconcileAuditLogs(stateDir), { files: 0, appended: 0, failed: 0 });
    assert.deepEqual(readdirSync(stateDir), []);
  });
});

void test("CRASH-02: a symlinked audit directory is refused and nothing is written through it", () => {
  withStateAndOutside((stateDir, outside) => {
    writeFileSync(join(outside, `${SESSION}.jsonl`), `${JSON.stringify({ tool: "write", phase: "admission", path: "a.txt" })}\n`);
    symlinkSync(outside, join(stateDir, "audit"), "dir");
    const before = readFileSync(join(outside, `${SESSION}.jsonl`), "utf8");

    assert.deepEqual(reconcileAuditLogs(stateDir), { files: 0, appended: 0, failed: 1 });
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

    assert.deepEqual(reconcileAuditLogs(stateDir), { files: 0, appended: 0, failed: 1 });
    assert.equal(readFileSync(target, "utf8"), before);
  });
});

void test("CRASH-02: a log whose name is not a safe session id is refused, and the other logs are still reconciled", () => {
  withStateDir((stateDir) => {
    admit(stateDir, "write", { path: "a.txt" });
    writeFileSync(join(stateDir, "audit", ".hidden.jsonl"), `${JSON.stringify({ tool: "write", phase: "admission" })}\n`);

    assert.deepEqual(reconcileAuditLogs(stateDir), { files: 1, appended: 1, failed: 1 });
    assert.equal(readFileSync(join(stateDir, "audit", ".hidden.jsonl"), "utf8").split("\n").length, 2);
  });
});

void test("CRASH-02: a log over the size cap is skipped and counted, not read", () => {
  withStateDir((stateDir) => {
    admit(stateDir, "write", { path: "a.txt" });
    const before = readFileSync(auditFile(stateDir), "utf8");

    assert.deepEqual(reconcileAuditLogs(stateDir, { maxFileBytes: 10 }), { files: 0, appended: 0, failed: 1 });
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

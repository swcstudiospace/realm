import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendAudit } from "../../src/audit/log.js";
import {
  AUDIT_GENESIS_PREV,
  AUDIT_LINE_MAX_BYTES,
  checkAuditFile,
  formatAuditCheckpoint,
  parseAuditCheckpoint,
  sha256Hex,
  verifyAuditFile,
} from "../../src/audit/chain.js";
import { runCli } from "../../src/cli/main.js";

const SESSION = "11111111-2222-4333-8444-555555555555";

function withStateDir(run: (stateDir: string) => void): void {
  const stateDir = mkdtempSync(join(tmpdir(), "realm-chain-"));
  try {
    run(stateDir);
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
  }
}

function auditFile(stateDir: string): string {
  return join(stateDir, "audit", `${SESSION}.jsonl`);
}

function linesOf(file: string): string[] {
  const text = readFileSync(file, "utf8");
  return text.endsWith("\n") ? text.slice(0, -1).split("\n") : text.split("\n");
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

void test("OBS-01: each append carries seq and prev, and the first line uses 64 zeros (D-1702)", () => {
  withStateDir((stateDir) => {
    appendAudit(stateDir, { sessionId: SESSION, tool: "write", outcome: "ok", phase: "admission", path: "a.txt" });
    appendAudit(stateDir, { sessionId: SESSION, tool: "write", outcome: "ok", phase: "result", path: "a.txt" });
    const lines = linesOf(auditFile(stateDir));
    const first = JSON.parse(lines[0] ?? "") as { seq: number; prev: string };
    const second = JSON.parse(lines[1] ?? "") as { seq: number; prev: string };
    assert.equal(first.seq, 1);
    assert.equal(first.prev, AUDIT_GENESIS_PREV);
    assert.equal(second.seq, 2);
    assert.equal(second.prev, sha256(lines[0] ?? ""));
    assert.equal(verifyAuditFile(auditFile(stateDir)).ok, true);
  });
});

void test("OBS-01: a torn tail is closed and the next line hashes the fragment, not a glued record (D-1702)", () => {
  withStateDir((stateDir) => {
    mkdirSync(join(stateDir, "audit"), { recursive: true });
    const torn = '{"tool":"wri';
    writeFileSync(auditFile(stateDir), torn);
    appendAudit(stateDir, { sessionId: SESSION, tool: "write", outcome: "ok", phase: "result", path: "a.txt" });
    const text = readFileSync(auditFile(stateDir), "utf8");
    const lines = text.slice(0, -1).split("\n");
    assert.equal(lines.length, 2);
    assert.equal(lines[0], torn);
    const next = JSON.parse(lines[1] ?? "") as { seq: number; prev: string; phase: string };
    assert.equal(next.phase, "result");
    assert.equal(next.seq, 1);
    assert.equal(next.prev, sha256Hex(Buffer.from(torn, "utf8")));
    assert.equal(text.includes(`${torn}{`), false);
    const verified = verifyAuditFile(auditFile(stateDir));
    assert.equal(verified.ok, true);
    assert.equal(verified.tornTail, false);
    assert.deepEqual(verified.unparsedLines, [1]);
  });
});

void test("OBS-01: a line at the JSON bound can be followed by another append", () => {
  withStateDir((stateDir) => {
    mkdirSync(join(stateDir, "audit"), { recursive: true });
    const prefix = `{"seq":7,"prev":"${AUDIT_GENESIS_PREV}","tool":"write","pad":"`;
    const suffix = `"}`;
    const line = prefix + "x".repeat(AUDIT_LINE_MAX_BYTES - Buffer.byteLength(prefix + suffix)) + suffix;
    assert.equal(Buffer.byteLength(line), AUDIT_LINE_MAX_BYTES);
    writeFileSync(auditFile(stateDir), `${line}\n`);
    appendAudit(stateDir, { sessionId: SESSION, tool: "write", outcome: "ok", phase: "result", path: "a.txt" });
    const parts = linesOf(auditFile(stateDir));
    assert.equal(parts.length, 2);
    const next = JSON.parse(parts[1] ?? "") as { seq: number; prev: string };
    assert.equal(next.seq, 8);
    assert.equal(next.prev, sha256(line));
  });
});

void test("OBS-01: a torn fragment cannot hide the last complete seq", () => {
  withStateDir((stateDir) => {
    mkdirSync(join(stateDir, "audit"), { recursive: true });
    const prefix = `{"seq":4,"prev":"${AUDIT_GENESIS_PREV}","tool":"write","pad":"`;
    const suffix = `"}`;
    const complete = prefix + "y".repeat(2 * 1024 * 1024 - Buffer.byteLength(prefix + suffix)) + suffix;
    const fragment = "z".repeat(3 * 1024 * 1024);
    writeFileSync(auditFile(stateDir), `${complete}\n${fragment}`);
    appendAudit(stateDir, { sessionId: SESSION, tool: "write", outcome: "ok", phase: "result", path: "a.txt" });
    const parts = linesOf(auditFile(stateDir));
    const next = JSON.parse(parts[parts.length - 1] ?? "") as { seq: number; prev: string };
    assert.equal(next.seq, 5);
    assert.equal(next.prev, sha256(fragment));
  });
});

void test("OBS-01: a legacy file continues without a marker, and verify reports those lines as unprotected (D-1702)", () => {
  withStateDir((stateDir) => {
    mkdirSync(join(stateDir, "audit"), { recursive: true });
    const legacy = JSON.stringify({ at: "2026-10-29T00:00:00.000Z", sessionId: SESSION, tool: "write", outcome: "ok" });
    writeFileSync(auditFile(stateDir), `${legacy}\n`);
    appendAudit(stateDir, { sessionId: SESSION, tool: "write", outcome: "ok", phase: "result", path: "a.txt" });
    const lines = linesOf(auditFile(stateDir));
    assert.equal(lines[0], legacy);
    const chained = JSON.parse(lines[1] ?? "") as { seq: number; prev: string };
    assert.equal(chained.seq, 1);
    assert.equal(chained.prev, sha256(legacy));
    const verified = verifyAuditFile(auditFile(stateDir));
    assert.equal(verified.ok, true);
    assert.equal(verified.legacyLines, 1);
    assert.equal(verified.broken, undefined);
  });
});

void test("OBS-01: verify names the first line after an edit, a deletion, or a reorder (D-1702)", () => {
  withStateDir((stateDir) => {
    appendAudit(stateDir, { sessionId: SESSION, tool: "write", outcome: "ok", phase: "admission", path: "a.txt" });
    appendAudit(stateDir, { sessionId: SESSION, tool: "write", outcome: "ok", phase: "result", path: "a.txt" });
    appendAudit(stateDir, { sessionId: SESSION, tool: "read", outcome: "ok", phase: "admission", path: "b.txt" });
    const file = auditFile(stateDir);
    const original = linesOf(file);

    const edited = [...original];
    const middle = JSON.parse(edited[1] ?? "") as Record<string, unknown>;
    middle["path"] = "changed.txt";
    edited[1] = JSON.stringify(middle);
    writeFileSync(file, `${edited.join("\n")}\n`);
    const editBreak = verifyAuditFile(file);
    assert.equal(editBreak.ok, false);
    const editBroken = editBreak.broken;
    assert.ok(editBroken);
    assert.equal(editBroken.line, 3);
    assert.equal(editBroken.reason, "prev-mismatch");

    const removed = [original[0], original[2]];
    writeFileSync(file, `${removed.join("\n")}\n`);
    const deleteBreak = verifyAuditFile(file);
    assert.equal(deleteBreak.ok, false);
    const deleteBroken = deleteBreak.broken;
    assert.ok(deleteBroken);
    assert.equal(deleteBroken.line, 2);
    assert.equal(deleteBroken.reason, "seq-gap");

    const reordered = [original[0], original[2], original[1]];
    writeFileSync(file, `${reordered.join("\n")}\n`);
    const reorderBreak = verifyAuditFile(file);
    assert.equal(reorderBreak.ok, false);
    const reorderBroken = reorderBreak.broken;
    assert.ok(reorderBroken);
    assert.equal(reorderBroken.line, 2);
    assert.ok(reorderBroken.reason === "seq-gap" || reorderBroken.reason === "seq-regress");
  });
});

void test("OBS-01: realm audit verify exits 0 for a clean file, 1 naming the broken line, and reports legacy lines (D-1702)", async () => {
  await withFile(async (file) => {
    writeFileSync(file, "");
    appendOnto(file);
    const clean = await runCli(["audit", "verify", "--file", file], { env: {} });
    assert.equal(clean.exitCode, 0);
    assert.equal(clean.stderr, "");
    const cleanReport = JSON.parse(clean.stdout) as { ok: boolean };
    assert.equal(cleanReport.ok, true);

    const lines = linesOf(file);
    const changed = JSON.parse(lines[0] ?? "") as Record<string, unknown>;
    changed["tool"] = "read";
    writeFileSync(file, `${JSON.stringify(changed)}\n${lines[1] ?? ""}\n`);
    const broken = await runCli(["audit", "verify", "--file", file], { env: {} });
    assert.equal(broken.exitCode, 1);
    assert.match(broken.stderr, /line 2 does not chain to line 1 \(prev-mismatch\)/);
  });

  await withFile(async (file) => {
    const legacy = JSON.stringify({ tool: "write", outcome: "ok" });
    writeFileSync(file, `${legacy}\n`);
    const stateDir = mkdtempSync(join(tmpdir(), "realm-chain-cli-"));
    try {
      mkdirSync(join(stateDir, "audit"), { recursive: true });
      writeFileSync(join(stateDir, "audit", `${SESSION}.jsonl`), `${legacy}\n`);
      appendAudit(stateDir, { sessionId: SESSION, tool: "list", outcome: "ok" });
      const copy = readFileSync(join(stateDir, "audit", `${SESSION}.jsonl`));
      writeFileSync(file, copy);
    } finally {
      rmSync(stateDir, { recursive: true, force: true });
    }
    const result = await runCli(["audit", "verify", "--file", file], { env: {} });
    assert.equal(result.exitCode, 0);
    assert.match(result.stderr, /1 legacy line\(s\) are unprotected/);
    const report = JSON.parse(result.stdout) as { ok: boolean; files: { unprotected: number }[] };
    assert.equal(report.ok, true);
    assert.equal(report.files[0]?.unprotected, 1);
  });
});

function appendOnto(file: string): void {
  const stateDir = mkdtempSync(join(tmpdir(), "realm-chain-seed-"));
  try {
    appendAudit(stateDir, { sessionId: SESSION, tool: "write", outcome: "ok", phase: "admission", path: "a.txt" });
    appendAudit(stateDir, { sessionId: SESSION, tool: "write", outcome: "ok", phase: "result", path: "a.txt" });
    writeFileSync(file, readFileSync(auditFile(stateDir)));
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
  }
}

async function withFile(run: (file: string) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "realm-chain-cli-"));
  try {
    await run(join(dir, "audit.jsonl"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function seed(stateDir: string, count: number): string[] {
  for (let i = 0; i < count; i += 1) {
    appendAudit(stateDir, { sessionId: SESSION, tool: "write", outcome: "ok", phase: "result", path: `f${String(i)}.txt` });
  }
  return linesOf(auditFile(stateDir));
}

function lineHash(lines: readonly string[], seq: number): string {
  return sha256(lines[seq - 1] ?? "");
}

function writeLines(file: string, lines: readonly string[]): void {
  writeFileSync(file, `${lines.join("\n")}\n`);
}

void test("OBS-01 checkpoint: a clean log verifies against its saved head and reports that head", () => {
  withStateDir((stateDir) => {
    const lines = seed(stateDir, 3);
    const check = checkAuditFile(auditFile(stateDir), { head: `3:${lineHash(lines, 3)}` });
    assert.equal(check.exitCode, 0);
    assert.equal(check.ok, true);
    assert.deepEqual(check.head, { seq: 3, line: 3, hash: lineHash(lines, 3) });
  });
});

void test("OBS-01 checkpoint: tail loss is reported at the last line still present", () => {
  withStateDir((stateDir) => {
    const lines = seed(stateDir, 3);
    writeLines(auditFile(stateDir), lines.slice(0, 2));
    const check = checkAuditFile(auditFile(stateDir), { head: `3:${lineHash(lines, 3)}` });
    assert.equal(check.exitCode, 1);
    assert.equal(check.reason, "tail-loss");
    assert.equal(check.line, 2);
  });
});

void test("OBS-01 checkpoint: an anchor past the end of a shorter log is reported as shorter-log at the last line", () => {
  withStateDir((stateDir) => {
    const lines = seed(stateDir, 3);
    writeLines(auditFile(stateDir), lines.slice(0, 1));
    const check = checkAuditFile(auditFile(stateDir), { anchor: `2:${lineHash(lines, 2)}` });
    assert.equal(check.exitCode, 1);
    assert.equal(check.reason, "shorter-log");
    assert.equal(check.line, 1);
  });
});

void test("OBS-01 checkpoint: a prefix rewritten with a re-linked successor passes the chain but fails the anchor at the anchored line", () => {
  withStateDir((stateDir) => {
    const lines = seed(stateDir, 3);
    const edited2 = JSON.stringify({ ...(JSON.parse(lines[1] ?? "") as Record<string, unknown>), path: "forged.txt" });
    const relinked3 = JSON.stringify({ ...(JSON.parse(lines[2] ?? "") as Record<string, unknown>), prev: sha256(edited2) });
    writeLines(auditFile(stateDir), [lines[0] ?? "", edited2, relinked3]);
    assert.equal(verifyAuditFile(auditFile(stateDir)).ok, true);
    const check = checkAuditFile(auditFile(stateDir), { anchor: `2:${lineHash(lines, 2)}` });
    assert.equal(check.exitCode, 1);
    assert.equal(check.reason, "prefix-changed");
    assert.equal(check.line, 2);
  });
});

void test("OBS-01 checkpoint: with a head pin, edit, delete and reorder each name the line the chain breaks at", () => {
  withStateDir((stateDir) => {
    const lines = seed(stateDir, 3);
    const head = `3:${lineHash(lines, 3)}`;
    const file = auditFile(stateDir);

    const edited = [...lines];
    edited[1] = JSON.stringify({ ...(JSON.parse(lines[1] ?? "") as Record<string, unknown>), path: "changed.txt" });
    writeLines(file, edited);
    const editCheck = checkAuditFile(file, { head });
    assert.equal(editCheck.reason, "prev-mismatch");
    assert.equal(editCheck.line, 3);

    writeLines(file, [lines[0] ?? "", lines[2] ?? ""]);
    const deleteCheck = checkAuditFile(file, { head });
    assert.equal(deleteCheck.reason, "seq-gap");
    assert.equal(deleteCheck.line, 2);

    writeLines(file, [lines[0] ?? "", lines[2] ?? "", lines[1] ?? ""]);
    const reorderCheck = checkAuditFile(file, { head });
    assert.equal(reorderCheck.exitCode, 1);
    assert.equal(reorderCheck.line, 2);
  });
});

void test("OBS-01 checkpoint: a torn tail is not a seq, so the head still verifies and the fragment is excluded", () => {
  withStateDir((stateDir) => {
    const lines = seed(stateDir, 2);
    writeFileSync(auditFile(stateDir), `${lines.join("\n")}\n{"tool":"wri`);
    const check = checkAuditFile(auditFile(stateDir), { head: `2:${lineHash(lines, 2)}` });
    assert.equal(check.exitCode, 0);
    assert.equal(check.tornTail, true);
    assert.equal(check.head?.seq, 2);
  });
});

void test("OBS-01 checkpoint: legacy lines are reported as unprotected and no pin covers them", () => {
  withStateDir((stateDir) => {
    mkdirSync(join(stateDir, "audit"), { recursive: true });
    const legacy = JSON.stringify({ tool: "write", outcome: "ok" });
    writeFileSync(auditFile(stateDir), `${legacy}\n`);
    appendAudit(stateDir, { sessionId: SESSION, tool: "write", outcome: "ok", phase: "result", path: "a.txt" });
    const lines = linesOf(auditFile(stateDir));
    const check = checkAuditFile(auditFile(stateDir), { head: `1:${sha256(lines[1] ?? "")}` });
    assert.equal(check.exitCode, 0);
    assert.equal(check.unprotected, 1);
    assert.equal(check.head?.line, 2);
  });
});

void test("OBS-01 checkpoint: a reconciliation line is a chained line, so editing it breaks the next line", () => {
  withStateDir((stateDir) => {
    appendAudit(stateDir, { sessionId: SESSION, tool: "write", outcome: "ok", phase: "admission", path: "a.txt" });
    appendAudit(stateDir, {
      sessionId: SESSION,
      tool: "write",
      outcome: "AUDIT_OUTCOME_UNKNOWN",
      phase: "reconciliation",
      path: "a.txt",
    });
    appendAudit(stateDir, { sessionId: SESSION, tool: "write", outcome: "ok", phase: "result", path: "a.txt" });
    const file = auditFile(stateDir);
    const lines = linesOf(file);
    assert.equal(verifyAuditFile(file).ok, true);
    const edited = [...lines];
    edited[1] = JSON.stringify({ ...(JSON.parse(lines[1] ?? "") as Record<string, unknown>), outcome: "ok" });
    writeLines(file, edited);
    const check = checkAuditFile(file, { head: `3:${lineHash(lines, 3)}` });
    assert.equal(check.reason, "prev-mismatch");
    assert.equal(check.line, 3);
  });
});

void test("OBS-01 checkpoint: malformed checkpoint text and an unreadable file exit 2, never 0 or 1", () => {
  withStateDir((stateDir) => {
    const lines = seed(stateDir, 1);
    const bad = checkAuditFile(auditFile(stateDir), { head: "not-a-checkpoint" });
    assert.equal(bad.exitCode, 2);
    assert.equal(bad.reason, "bad-checkpoint");
    const missing = checkAuditFile(join(stateDir, "missing.jsonl"), { head: `1:${lineHash(lines, 1)}` });
    assert.equal(missing.exitCode, 2);
    assert.equal(missing.reason, "unreadable");
  });
});

void test("OBS-01 checkpoint: format and parse round-trip, and out-of-shape text is rejected", () => {
  const hash = "a".repeat(64);
  const text = formatAuditCheckpoint({ seq: 9, line: 10, hash });
  assert.equal(text, `9:${hash}`);
  assert.deepEqual(parseAuditCheckpoint(text), { seq: 9, hash });
  assert.equal(parseAuditCheckpoint(`0:${hash}`), undefined);
  assert.equal(parseAuditCheckpoint(`9:${"A".repeat(64)}`), undefined);
  assert.equal(parseAuditCheckpoint(`9:${hash}\n`), undefined);
});

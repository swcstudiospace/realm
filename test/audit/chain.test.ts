import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendAudit } from "../../src/audit/log.js";
import {
  AUDIT_GENESIS_PREV,
  AUDIT_LINE_MAX_BYTES,
  parseAuditAnchor,
  parseAuditHead,
  sha256Hex,
  verifyAuditFile,
} from "../../src/audit/chain.js";
import { buildAnchorRecord, splitAuditLines } from "../../src/audit/anchor.js";
import { parseAuditVerifyArgs, runAuditVerifySelection } from "../../src/cli/audit.js";
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
    assert.match(clean.stderr, /unanchored chain cannot detect tail truncation/);
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
    const report = JSON.parse(result.stdout) as { files: { unprotected: number }[]; ok: boolean };
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

function checkpointOf(file: string, sessionId = SESSION) {
  return buildAnchorRecord({
    sessionId,
    lines: splitAuditLines(readFileSync(file)),
    createdAt: new Date("2026-10-31T00:00:00.000Z"),
  });
}

void test("OBS-01: losing the initial chained prefix is a bad chain start", () => {
  withStateDir((stateDir) => {
    appendAudit(stateDir, { sessionId: SESSION, tool: "list", outcome: "ok" });
    appendAudit(stateDir, { sessionId: SESSION, tool: "read", outcome: "ok" });
    const file = auditFile(stateDir);
    writeFileSync(file, `${linesOf(file).slice(1).join("\n")}\n`);
    assert.deepEqual(verifyAuditFile(file).broken, { line: 1, reason: "bad-chain-start" });
  });
});

void test("OBS-01: retained heads and anchors reject tail truncation, including an empty replacement", () => {
  withStateDir((stateDir) => {
    appendAudit(stateDir, { sessionId: SESSION, tool: "list", outcome: "ok" });
    appendAudit(stateDir, { sessionId: SESSION, tool: "read", outcome: "ok" });
    appendAudit(stateDir, { sessionId: SESSION, tool: "write", outcome: "ok" });
    const file = auditFile(stateDir);
    const original = linesOf(file);
    const head = verifyAuditFile(file).head;
    assert.ok(head);
    const anchor = checkpointOf(file);
    for (const keep of [2, 1, 0]) {
      writeFileSync(file, keep === 0 ? "" : `${original.slice(0, keep).join("\n")}\n`);
      assert.equal(verifyAuditFile(file).ok, true, "an unanchored valid prefix cannot prove truncation");
      assert.deepEqual(verifyAuditFile(file, { head }).broken, { line: keep + 1, reason: "shorter-than-head" });
      const anchored = verifyAuditFile(file, { anchor });
      assert.deepEqual(anchored.broken, { line: keep + 1, reason: "shorter-than-anchor" });
      assert.deepEqual(anchored.anchor, { ok: false, lineCount: 3 });
    }
  });
});

void test("OBS-01: checkpoints accept a later append but detect a last-line edit without a successor", () => {
  withStateDir((stateDir) => {
    appendAudit(stateDir, { sessionId: SESSION, tool: "list", outcome: "ok" });
    const file = auditFile(stateDir);
    const head = verifyAuditFile(file).head;
    assert.ok(head);
    const anchor = checkpointOf(file);
    appendAudit(stateDir, { sessionId: SESSION, tool: "read", outcome: "ok" });
    const extended = verifyAuditFile(file, { head, anchor });
    assert.equal(extended.ok, true);
    assert.deepEqual(extended.anchor, { ok: true, lineCount: 1 });
    assert.equal(extended.head?.seq, 2);
    // A checkpoint does not authenticate anything appended AFTER its prefix.
    const lines = linesOf(file);
    const tail = JSON.parse(lines[1] ?? "") as Record<string, unknown>;
    tail["tool"] = "forged";
    writeFileSync(file, `${lines[0] ?? ""}\n${JSON.stringify(tail)}\n`);
    assert.equal(verifyAuditFile(file, { head, anchor }).ok, true);
    // Retaining the new tail detects a later edit to that same tail.
    const laterHead = verifyAuditFile(file).head;
    const laterAnchor = checkpointOf(file);
    assert.ok(laterHead);
    tail["tool"] = "changed-again";
    writeFileSync(file, `${lines[0] ?? ""}\n${JSON.stringify(tail)}\n`);
    assert.equal(verifyAuditFile(file).ok, true);
    assert.deepEqual(verifyAuditFile(file, { head: laterHead }).broken, { line: 2, reason: "head-mismatch" });
    assert.deepEqual(verifyAuditFile(file, { anchor: laterAnchor }).broken, { line: 2, reason: "anchor-root-mismatch" });
  });
});

void test("OBS-01: recomputing an edited history passes the unkeyed chain but not external checkpoints", () => {
  withStateDir((stateDir) => {
    for (const tool of ["list", "read", "write"]) {
      appendAudit(stateDir, { sessionId: SESSION, tool, outcome: "ok" });
    }
    const file = auditFile(stateDir);
    const head = verifyAuditFile(file).head;
    assert.ok(head);
    const anchor = checkpointOf(file); // Odd number of leaves exercises existing odd-node promotion.
    const original = linesOf(file);
    const rebuilt: string[] = [];
    for (const [index, raw] of original.entries()) {
      const record = JSON.parse(raw) as Record<string, unknown>;
      record["tool"] = index === 0 ? "changed" : record["tool"];
      record["prev"] = index === 0 ? AUDIT_GENESIS_PREV : sha256(rebuilt[index - 1] ?? "");
      rebuilt.push(JSON.stringify(record));
    }
    writeFileSync(file, `${rebuilt.join("\n")}\n`);
    assert.equal(verifyAuditFile(file).ok, true);
    assert.equal(verifyAuditFile(file, { head }).broken?.reason, "head-mismatch");
    assert.equal(verifyAuditFile(file, { anchor }).broken?.reason, "anchor-root-mismatch");
  });
});

void test("OBS-01: an anchor commits to every raw legacy line, detecting edit, deletion, reorder and prefix loss", () => {
  withStateDir((stateDir) => {
    mkdirSync(join(stateDir, "audit"));
    const file = auditFile(stateDir);
    const legacy = [' { "tool" : "read", "value": "é" }', '{"tool":"list"}', '{"tool":"write"}'];
    writeFileSync(file, `${legacy.join("\n")}\n`);
    appendAudit(stateDir, { sessionId: SESSION, tool: "list", outcome: "ok" });
    const original = linesOf(file);
    const anchor = checkpointOf(file);
    assert.equal(verifyAuditFile(file, { anchor }).ok, true);
    const altered = [
      [JSON.stringify(JSON.parse(legacy[0] ?? "") as unknown), ...original.slice(1)],
      [original[1], original[0], ...original.slice(2)],
      original.slice(1),
      [original[0], ...original.slice(2)],
    ];
    for (const lines of altered) {
      writeFileSync(file, `${lines.join("\n")}\n`);
      assert.equal(verifyAuditFile(file).ok, true, "earlier legacy lines are unprotected by the chain");
      assert.equal(verifyAuditFile(file, { anchor }).ok, false);
    }
  });
});

void test("OBS-01: head positions round-trip with legacy lines and closed torn fragments, not JSON seq", () => {
  withStateDir((stateDir) => {
    mkdirSync(join(stateDir, "audit"));
    const file = auditFile(stateDir);
    writeFileSync(file, '{"tool":"legacy"}\n');
    appendAudit(stateDir, { sessionId: SESSION, tool: "list", outcome: "ok" });
    appendFileSync(file, '{"tool":"tor');
    const tornHead = verifyAuditFile(file).head;
    assert.ok(tornHead);
    assert.equal(tornHead.seq, 3);
    assert.equal(verifyAuditFile(file).tornTail, true);
    appendAudit(stateDir, { sessionId: SESSION, tool: "read", outcome: "ok" });
    const verified = verifyAuditFile(file, { head: tornHead, anchor: checkpointOf(file) });
    assert.equal(verified.ok, true);
    assert.equal(verified.chainStartLine, 2);
    assert.equal(verified.head?.seq, 4);
    assert.deepEqual(verified.unparsedLines, [3]);
    const last: unknown = JSON.parse(linesOf(file)[3] ?? "");
    assert.ok(typeof last === "object" && last !== null && "seq" in last);
    assert.equal(last.seq, 2);
    assert.ok(verified.head);
    assert.deepEqual(parseAuditHead(`${String(verified.head.seq)}:${verified.head.lineSha256}`), verified.head);
    assert.equal(verifyAuditFile(file, { head: verified.head }).ok, true);
  });
});

void test("OBS-01: an unterminated complete record and blank physical lines use anchor's exact byte splitting", () => {
  withStateDir((stateDir) => {
    mkdirSync(join(stateDir, "audit"));
    const file = auditFile(stateDir);
    writeFileSync(file, '\n{"tool":"legacy"}\n\n');
    const legacyAnchor = checkpointOf(file);
    assert.equal(legacyAnchor.lineCount, 3);
    assert.equal(verifyAuditFile(file, { anchor: legacyAnchor }).ok, true);
    appendAudit(stateDir, { sessionId: SESSION, tool: "list", outcome: "ok" });
    const raw = readFileSync(file);
    writeFileSync(file, raw.subarray(0, raw.length - 1));
    const verified = verifyAuditFile(file, { anchor: checkpointOf(file) });
    assert.equal(verified.ok, true);
    assert.equal(verified.tornTail, true);
    assert.equal(verified.head?.seq, 4);
  });
});

void test("OBS-01: anchor verification preserves raw lines across read chunks and checks only the retained prefix", () => {
  withStateDir((stateDir) => {
    mkdirSync(join(stateDir, "audit"));
    const file = auditFile(stateDir);
    const legacy = [JSON.stringify({ tool: "legacy", pad: "é".repeat(80_000) })];
    for (let index = 0; index < 64; index += 1) {
      legacy.push(JSON.stringify({ tool: "legacy", index, pad: "é".repeat(600) }));
    }
    writeFileSync(file, `${legacy.join("\n")}\n`);
    appendAudit(stateDir, { sessionId: SESSION, tool: "list", outcome: "ok" });
    const anchor = checkpointOf(file);
    const head = verifyAuditFile(file).head;
    assert.ok(head);
    appendAudit(stateDir, { sessionId: SESSION, tool: "read", outcome: "ok" });
    const verified = verifyAuditFile(file, { head, anchor });
    assert.equal(verified.ok, true);
    assert.equal(verified.lines, 67);
    assert.deepEqual(verified.anchor, { ok: true, lineCount: 66 });
  });
});

void test("OBS-01: strict checkpoint parsers reject malformed, unsafe, noncanonical and wrong-session records", () => {
  const hash = "b".repeat(64);
  for (const input of ["0", "-1", "1.5", "01", "9007199254740992", "1e2"]) {
    assert.equal(parseAuditHead(`${input}:${hash}`), undefined);
  }
  for (const input of [`1:${hash.toUpperCase()}`, `1:${hash}x`, `1:${hash}\n`, ` 1:${hash}`]) {
    assert.equal(parseAuditHead(input), undefined);
  }
  assert.deepEqual(parseAuditHead(`2:${hash}`), { seq: 2, lineSha256: hash });
  const valid = { version: 1, sessionId: SESSION, lineCount: 2, rootSha256: hash, createdAt: "2026-10-31T00:00:00.000Z" };
  assert.deepEqual(parseAuditAnchor(valid), valid);
  for (const input of [
    null, [], {}, { record: valid }, { ...valid, version: 2 }, { ...valid, lineCount: 0 },
    { ...valid, lineCount: Number.MAX_SAFE_INTEGER + 1 }, { ...valid, lineCount: 1.5 },
    { ...valid, rootSha256: hash.toUpperCase() }, { ...valid, sessionId: "../escape" },
    { ...valid, createdAt: "not-a-date" }, { ...valid, createdAt: "2026-02-30T00:00:00.000Z" },
    { ...valid, extra: true },
  ]) {
    assert.equal(parseAuditAnchor(input), undefined);
  }
  withStateDir((stateDir) => {
    appendAudit(stateDir, { sessionId: SESSION, tool: "list", outcome: "ok" });
    const file = auditFile(stateDir);
    assert.throws(() => verifyAuditFile(file, { anchor: { ...checkpointOf(file), sessionId: "other" } }), /session mismatch/);
    assert.throws(() => verifyAuditFile(file, { head: { seq: 0, lineSha256: hash } }), /invalid retained/);
    assert.throws(() => verifyAuditFile(file, { anchor: { ...checkpointOf(file), lineCount: 0 } }), /invalid audit anchor/);
  });
});

void test("OBS-01: selector parsing rejects positional files, mixed selectors, duplicates and invalid heads", () => {
  assert.deepEqual(parseAuditVerifyArgs([]), {});
  assert.deepEqual(parseAuditVerifyArgs(["--session", SESSION]), { sessionId: SESSION });
  assert.deepEqual(parseAuditVerifyArgs(["--file", "/copy.jsonl"]), { file: "/copy.jsonl" });
  for (const args of [
    ["copy.jsonl"], ["--file", "relative.jsonl"], ["--session", "../escape"],
    ["--session"], ["--unknown", "x"], ["--file", ""],
    ["--session", SESSION, "--file", "/copy.jsonl"],
    ["--session", SESSION, "--session", SESSION],
    ["--anchor", "a.json", "--anchor", "b.json"],
    ["--head", `1:${"a".repeat(64)}`, "--head", `1:${"a".repeat(64)}`],
    ["--head", `0:${"a".repeat(64)}`],
  ]) {
    assert.equal(parseAuditVerifyArgs(args), undefined);
  }
});

void test("OBS-01: selector runner verifies all sessions in name order with path-free aggregate reports", () => {
  withStateDir((stateDir) => {
    for (const sessionId of ["z-session", "a-session"]) {
      appendAudit(stateDir, { sessionId, tool: "list", outcome: "ok" });
    }
    const result = runAuditVerifySelection([], { stateDir });
    assert.equal(result.exitCode, 0);
    const report = JSON.parse(result.stdout) as { ok: boolean; files: { sessionId: string; head: { seq: number } }[] };
    assert.equal(report.ok, true);
    assert.deepEqual(report.files.map((file) => file.sessionId), ["a-session", "z-session"]);
    assert.equal(report.files[0]?.head.seq, 1);
    assert.equal(result.stdout.includes(stateDir), false);
    assert.equal(result.stderr.includes(stateDir), false);
    const selected = runAuditVerifySelection(["--session", "z-session"], { stateDir });
    const selectedReport: unknown = JSON.parse(selected.stdout);
    assert.ok(typeof selectedReport === "object" && selectedReport !== null && "files" in selectedReport);
    assert.ok(Array.isArray(selectedReport.files));
    assert.equal(selectedReport.files.length, 1);
    const selectedFile: unknown = selectedReport.files[0];
    assert.ok(typeof selectedFile === "object" && selectedFile !== null && "sessionId" in selectedFile);
    assert.equal(selectedFile.sessionId, "z-session");
  });
});

void test("OBS-01: selector runner reads a real anchor file, binds its session and reports retained-head failures", () => {
  withStateDir((stateDir) => {
    appendAudit(stateDir, { sessionId: SESSION, tool: "list", outcome: "ok" });
    const file = auditFile(stateDir);
    const anchorFile = join(stateDir, "checkpoint.json");
    const anchor = checkpointOf(file);
    writeFileSync(anchorFile, JSON.stringify(anchor));
    const head = verifyAuditFile(file).head;
    assert.ok(head);
    const words = ["--file", file, "--anchor", anchorFile, "--head", `${String(head.seq)}:${head.lineSha256}`];
    assert.equal(runAuditVerifySelection(words, { stateDir }).exitCode, 0);
    writeFileSync(file, "");
    const truncated = runAuditVerifySelection(words, { stateDir });
    assert.equal(truncated.exitCode, 1);
    assert.match(truncated.stdout, /shorter-than-anchor/);
    assert.equal(truncated.stdout.includes(stateDir), false);
    writeFileSync(anchorFile, JSON.stringify({ ...anchor, sessionId: "other" }));
    assert.equal(runAuditVerifySelection(words, { stateDir }).exitCode, 1);
    writeFileSync(anchorFile, '{"version":');
    assert.equal(runAuditVerifySelection(words, { stateDir }).exitCode, 1);
    assert.equal(runAuditVerifySelection(["--head", "invalid"], { stateDir }).exitCode, 2);
  });
});

void test("OBS-01: no selected file, unreadable files, symlinks and non-regular checkpoints never pass", () => {
  withStateDir((stateDir) => {
    assert.equal(runAuditVerifySelection([], { stateDir }).exitCode, 1);
    mkdirSync(join(stateDir, "audit"));
    assert.equal(runAuditVerifySelection([], { stateDir }).exitCode, 1);
    assert.equal(runAuditVerifySelection(["--session", SESSION], { stateDir }).exitCode, 1);
    appendAudit(stateDir, { sessionId: SESSION, tool: "list", outcome: "ok" });
    const link = join(stateDir, "linked.jsonl");
    symlinkSync(auditFile(stateDir), link);
    assert.throws(() => verifyAuditFile(link));
    assert.throws(() => verifyAuditFile(join(stateDir, "audit")));
    assert.equal(runAuditVerifySelection(["--file", link], { stateDir }).exitCode, 1);
    assert.equal(runAuditVerifySelection(["--file", auditFile(stateDir), "--anchor", join(stateDir, "audit")], { stateDir }).exitCode, 1);
    const anchorFile = join(stateDir, "anchor.json");
    writeFileSync(anchorFile, JSON.stringify(checkpointOf(auditFile(stateDir))));
    const anchorLink = join(stateDir, "anchor-link.json");
    symlinkSync(anchorFile, anchorLink);
    assert.equal(runAuditVerifySelection(["--file", auditFile(stateDir), "--anchor", anchorLink], { stateDir }).exitCode, 1);
    rmSync(join(stateDir, "audit"), { recursive: true });
    symlinkSync(stateDir, join(stateDir, "audit"), "dir");
    assert.equal(runAuditVerifySelection([], { stateDir }).exitCode, 1);
  });
});

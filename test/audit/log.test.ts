import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RealmError } from "../../src/core/errors.js";
import {
  appendAudit,
  summarizeExec,
  type AuditEntryInput,
} from "../../src/audit/log.js";

const SESSION = "11111111-2222-4333-8444-555555555555";
const HEX64 = "a".repeat(64);

function withStateDir(run: (stateDir: string) => void): void {
  const stateDir = mkdtempSync(join(tmpdir(), "realm-audit-"));
  try {
    run(stateDir);
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
  }
}

function auditFile(stateDir: string): string {
  return join(stateDir, "audit", `${SESSION}.jsonl`);
}

function readLines(stateDir: string): string[] {
  const text = readFileSync(auditFile(stateDir), "utf8");
  assert.equal(text.endsWith("\n"), true, "the file ends with a newline");
  return text.slice(0, -1).split("\n");
}

void test("each append adds one JSON object per line at <stateDir>/audit/<sessionId>.jsonl (AUD-01)", () => {
  withStateDir((stateDir) => {
    appendAudit(stateDir, { sessionId: SESSION, tool: "read", outcome: "ok", path: "a.txt", bytes: 5, sha256: HEX64 });
    appendAudit(stateDir, { sessionId: SESSION, tool: "list", outcome: "ok", path: ".", bytes: 0 });
    appendAudit(stateDir, { sessionId: SESSION, tool: "read", outcome: "PATH_ESCAPE", path: "b.txt" });

    const lines = readLines(stateDir);
    assert.equal(lines.length, 3);
    const parsed = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    assert.equal(parsed[0]?.["tool"], "read");
    assert.equal(parsed[1]?.["tool"], "list");
    assert.equal(parsed[2]?.["outcome"], "PATH_ESCAPE");
  });
});

void test("an entry carries at, sessionId, tool, outcome, path, bytes, and sha256 (AUD-01, D-42)", () => {
  withStateDir((stateDir) => {
    appendAudit(stateDir, { sessionId: SESSION, tool: "write", outcome: "ok", path: "a.txt", bytes: 7, sha256: HEX64 });
    const entry = JSON.parse(readLines(stateDir)[0] ?? "") as Record<string, unknown>;
    assert.deepEqual(Object.keys(entry).sort(), ["at", "bytes", "outcome", "path", "sessionId", "sha256", "tool"]);
    assert.equal(entry["sessionId"], SESSION);
    assert.equal(entry["tool"], "write");
    assert.equal(entry["outcome"], "ok");
    assert.equal(entry["path"], "a.txt");
    assert.equal(entry["bytes"], 7);
    assert.equal(entry["sha256"], HEX64);
    assert.equal(Number.isNaN(Date.parse(String(entry["at"]))), false);
  });
});

void test("the audit file and its directory are created with modes 0600 and 0700 (AUD-01, D-42)", () => {
  withStateDir((stateDir) => {
    appendAudit(stateDir, { sessionId: SESSION, tool: "status", outcome: "ok" });
    assert.equal(statSync(auditFile(stateDir)).mode & 0o777, 0o600);
    assert.equal(statSync(join(stateDir, "audit")).mode & 0o777, 0o700);
  });
});

void test("a pre-existing audit file with a wider mode is narrowed to 0600 on append (AUD-01)", () => {
  withStateDir((stateDir) => {
    mkdirSync(join(stateDir, "audit"), { recursive: true });
    writeFileSync(auditFile(stateDir), "");
    chmodSync(auditFile(stateDir), 0o644);
    appendAudit(stateDir, { sessionId: SESSION, tool: "status", outcome: "ok" });
    assert.equal(statSync(auditFile(stateDir)).mode & 0o777, 0o600);
  });
});

void test("redaction runs before the append: a secret in path or argv never reaches the file (AUD-01, T-02-08)", () => {
  withStateDir((stateDir) => {
    const SECRET_PATH = "ghp_SECRETPATHTOKEN0123456789";
    const SECRET_FLAG = "SECRETFLAGVALUE42";
    appendAudit(stateDir, {
      sessionId: SESSION,
      tool: "exec",
      outcome: "ok",
      path: SECRET_PATH,
      execSummary: summarizeExec({ argv: ["curl", `--token=${SECRET_FLAG}`] }),
    });
    const text = readFileSync(auditFile(stateDir), "utf8");
    assert.equal(text.includes(SECRET_PATH), false);
    assert.equal(text.includes(SECRET_FLAG), false);
    assert.match(text, /\[REDACTED\]/);
  });
});

void test("a write entry never carries a content field, even when a caller passes one (D-42)", () => {
  withStateDir((stateDir) => {
    const SENTINEL = "WRITE-CONTENT-SENTINEL-9f2";
    const input = {
      sessionId: SESSION,
      tool: "write",
      outcome: "ok",
      path: "notes.txt",
      bytes: SENTINEL.length,
      sha256: HEX64,
      content: SENTINEL,
    } as AuditEntryInput;
    appendAudit(stateDir, input);
    const text = readFileSync(auditFile(stateDir), "utf8");
    const entry = JSON.parse(readLines(stateDir)[0] ?? "") as Record<string, unknown>;
    assert.equal("content" in entry, false);
    assert.equal(text.includes(SENTINEL), false);
  });
});

void test("a shell exec entry records only script byte length and sha256, never the script (D-42)", () => {
  withStateDir((stateDir) => {
    const SCRIPT = "echo SHELLSCRIPTSENTINEL | wc -c";
    appendAudit(stateDir, {
      sessionId: SESSION,
      tool: "exec",
      outcome: "ok",
      execSummary: summarizeExec({ shell: true, script: SCRIPT }),
    });
    const text = readFileSync(auditFile(stateDir), "utf8");
    assert.equal(text.includes("SHELLSCRIPTSENTINEL"), false);
    const entry = JSON.parse(readLines(stateDir)[0] ?? "") as { execSummary: Record<string, unknown> };
    assert.deepEqual(entry.execSummary, {
      shell: true,
      scriptBytes: Buffer.byteLength(SCRIPT, "utf8"),
      sha256: createHash("sha256").update(SCRIPT, "utf8").digest("hex"),
    });
  });
});

void test("a shell script's recorded length is its UTF-8 byte length, not its character count (D-42)", () => {
  const summary = summarizeExec({ shell: true, script: "é" });
  assert.deepEqual(summary, {
    shell: true,
    scriptBytes: 2,
    sha256: createHash("sha256").update("é", "utf8").digest("hex"),
  });
});

void test("an argv exec entry records argv after redaction (D-42)", () => {
  withStateDir((stateDir) => {
    appendAudit(stateDir, {
      sessionId: SESSION,
      tool: "exec",
      outcome: "ok",
      execSummary: summarizeExec({ argv: ["ls", "-la", "--password=ARGVSECRETVALUE"] }),
    });
    const text = readFileSync(auditFile(stateDir), "utf8");
    assert.equal(text.includes("ARGVSECRETVALUE"), false);
    const entry = JSON.parse(readLines(stateDir)[0] ?? "") as { execSummary: { argv: string[] } };
    assert.deepEqual(entry.execSummary.argv, ["ls", "-la", "--password=[REDACTED]"]);
  });
});

void test("an error outcome is recorded as its catalogue code (D-42)", () => {
  withStateDir((stateDir) => {
    appendAudit(stateDir, { sessionId: SESSION, tool: "exec", outcome: "SHELL_NOT_ALLOWED" });
    const entry = JSON.parse(readLines(stateDir)[0] ?? "") as Record<string, unknown>;
    assert.equal(entry["outcome"], "SHELL_NOT_ALLOWED");
  });
});

void test("a session id that could leave the audit directory is refused with SCHEMA_INVALID and nothing is written (AUD-01)", () => {
  withStateDir((stateDir) => {
    const escapeName = `realm-audit-escape-${String(process.pid)}`;
    for (const sessionId of [`../${escapeName}`, "a/b", "", ".hidden", "x".repeat(129)]) {
      assert.throws(
        () => {
          appendAudit(stateDir, { sessionId, tool: "write", outcome: "ok" });
        },
        (error: unknown) => error instanceof RealmError && error.code === "SCHEMA_INVALID",
        sessionId,
      );
    }
    assert.equal(statSync(join(stateDir, `${escapeName}.jsonl`), { throwIfNoEntry: false }), undefined);
    assert.equal(statSync(join(stateDir, "audit"), { throwIfNoEntry: false }), undefined);
  });
});

function withStateAndOutside(run: (stateDir: string, outside: string) => void): void {
  const stateDir = mkdtempSync(join(tmpdir(), "realm-audit-"));
  const outside = mkdtempSync(join(tmpdir(), "realm-audit-outside-"));
  try {
    run(stateDir, outside);
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
}

function isAuditWriteFailed(error: unknown): boolean {
  return error instanceof RealmError && error.code === "AUDIT_WRITE_FAILED";
}

void test("an audit path that is not a directory fails with AUDIT_WRITE_FAILED and writes nothing (AUD-01)", () => {
  withStateDir((stateDir) => {
    writeFileSync(join(stateDir, "audit"), "not a directory");
    assert.throws(
      () => {
        appendAudit(stateDir, { sessionId: SESSION, tool: "write", outcome: "ok" });
      },
      isAuditWriteFailed,
    );
    assert.equal(readFileSync(join(stateDir, "audit"), "utf8"), "not a directory");
  });
});

void test("an audit directory that is a symlink out of stateDir is refused with AUDIT_WRITE_FAILED and nothing is written (AUD-01)", () => {
  withStateAndOutside((stateDir, outside) => {
    symlinkSync(outside, join(stateDir, "audit"), "dir");
    assert.throws(
      () => {
        appendAudit(stateDir, { sessionId: SESSION, tool: "write", outcome: "ok" });
      },
      isAuditWriteFailed,
    );
    assert.deepEqual(readdirSync(outside), []);
  });
});

void test("an audit file that is a symlink out of stateDir is refused with AUDIT_WRITE_FAILED and the outside file is unchanged (AUD-01)", () => {
  withStateAndOutside((stateDir, outside) => {
    mkdirSync(join(stateDir, "audit"), { recursive: true });
    const target = join(outside, "target.jsonl");
    const original = "original\n";
    writeFileSync(target, original);
    symlinkSync(target, auditFile(stateDir));
    assert.throws(
      () => {
        appendAudit(stateDir, { sessionId: SESSION, tool: "write", outcome: "ok" });
      },
      isAuditWriteFailed,
    );
    assert.equal(readFileSync(target, "utf8"), original);
  });
});

void test("a FIFO at the session's audit path makes the append fail with AUDIT_WRITE_FAILED within a bounded time (AUD-01)", () => {
  const stateDir = mkdtempSync(join(tmpdir(), "realm-audit-fifo-"));
  try {
    mkdirSync(join(stateDir, "audit"), { recursive: true });
    const fifo = auditFile(stateDir);
    execFileSync("mkfifo", [fifo]);
    // The append runs in a child process so a blocking open cannot hang the suite.
    const script = [
      "const { appendAudit } = await import(process.env.REALM_TEST_MODULE);",
      'let code = "NO_ERROR";',
      "try {",
      '  appendAudit(process.env.REALM_TEST_STATE_DIR, { sessionId: process.env.REALM_TEST_SESSION, tool: "read", outcome: "ok" });',
      "} catch (error) {",
      '  code = error?.code ?? "UNKNOWN";',
      "}",
      "process.stdout.write(code);",
    ].join("\n");
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
      env: {
        ...process.env,
        REALM_TEST_MODULE: new URL("../../src/audit/log.js", import.meta.url).href,
        REALM_TEST_STATE_DIR: stateDir,
        REALM_TEST_SESSION: SESSION,
      },
      timeout: 5000,
      killSignal: "SIGKILL",
      encoding: "utf8",
    });
    assert.equal(result.error, undefined);
    assert.equal(result.signal, null);
    assert.equal(result.status, 0);
    assert.equal(result.stdout.trim(), "AUDIT_WRITE_FAILED");
    assert.equal(statSync(fifo).isFIFO(), true);
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
  }
});

void test("TOOL-03: an entry carries its phase when the caller names one, and each phase is its own line (D-90, D-107)", () => {
  withStateDir((stateDir) => {
    appendAudit(stateDir, { sessionId: SESSION, tool: "write", outcome: "ok", phase: "admission", path: "a.txt" });
    appendAudit(stateDir, { sessionId: SESSION, tool: "write", outcome: "ok", phase: "result", path: "a.txt", bytes: 7, sha256: HEX64 });

    const lines = readLines(stateDir).map((line) => JSON.parse(line) as Record<string, unknown>);
    assert.equal(lines.length, 2);
    assert.equal(lines[0]?.["phase"], "admission");
    assert.equal(lines[1]?.["phase"], "result");
    assert.equal(lines[0]["outcome"], "ok");
    assert.equal(lines[1]["outcome"], "ok");
  });
});

void test("TOOL-03: an entry with no phase has no phase key, so the pre-stage shape is unchanged (D-107)", () => {
  withStateDir((stateDir) => {
    appendAudit(stateDir, { sessionId: SESSION, tool: "list", outcome: "ok", path: "." });
    const entry = JSON.parse(readLines(stateDir)[0] ?? "") as Record<string, unknown>;
    assert.equal("phase" in entry, false);
    assert.deepEqual(Object.keys(entry).sort(), ["at", "outcome", "path", "sessionId", "tool"]);
  });
});

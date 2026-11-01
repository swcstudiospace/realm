// realm audit verify (OBS-01, P17 checkpoints) through runCli. Each case builds a real chained log with appendAudit,
// edits it on disk, and asserts the exit code, the named line and reason, and the JSON report. Usage refusals exit 2
// with empty stdout; I/O failures and integrity breaks exit 1.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendAudit } from "../../src/audit/log.js";
import { runCli } from "../../src/cli/main.js";

const SESSION = "11111111-2222-4333-8444-555555555555";
const OTHER_SESSION = "22222222-3333-4444-8555-666666666666";
const IMAGE = `registry.example.com/realm/workload@sha256:${"0".repeat(64)}`;

interface FileReport {
  readonly sessionId: string;
  readonly ok: boolean;
  readonly failure?: string;
  readonly broken?: { readonly line: number; readonly reason: string };
  readonly head?: { readonly seq: number; readonly lineSha256: string };
  readonly unprotected?: number;
}

interface Report {
  readonly ok: boolean;
  readonly files: readonly FileReport[];
}

async function withState(run: (stateDir: string) => Promise<void>): Promise<void> {
  const stateDir = mkdtempSync(join(tmpdir(), "realm-audit-cli-"));
  try {
    await run(stateDir);
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
  }
}

function auditFile(stateDir: string, sessionId: string = SESSION): string {
  return join(stateDir, "audit", `${sessionId}.jsonl`);
}

function linesOf(file: string): string[] {
  const text = readFileSync(file, "utf8");
  return text.endsWith("\n") ? text.slice(0, -1).split("\n") : text.split("\n");
}

function writeLines(file: string, lines: readonly string[]): void {
  writeFileSync(file, `${lines.join("\n")}\n`);
}

function hashOf(line: string | undefined): string {
  return createHash("sha256").update(line ?? "", "utf8").digest("hex");
}

// Three chained lines, seq 1 to 3, in the session's audit file. Returns the file's lines.
function seed(stateDir: string, sessionId: string = SESSION): string[] {
  for (let i = 0; i < 3; i += 1) {
    appendAudit(stateDir, { sessionId, tool: "write", outcome: "ok", phase: "result", path: `f${String(i)}.txt` });
  }
  return linesOf(auditFile(stateDir, sessionId));
}

function reportOf(stdout: string): Report {
  return JSON.parse(stdout) as Report;
}

// A config for --session and the selector-less form. Only stateDir matters to the audit command.
function depsFor(stateDir: string): { env: Record<string, string>; readConfig: () => unknown } {
  return {
    env: { XDG_CONFIG_HOME: "/realm-test-config" },
    readConfig: () => ({ image: IMAGE, stateDir, workspaceRoot: "/realm-test-workspace" }),
  };
}

void test("audit verify --file: an untouched file exits 0, prints nothing to stderr, and reports its head", async () => {
  await withState(async (stateDir) => {
    const lines = seed(stateDir);
    const file = auditFile(stateDir);
    const result = await runCli(["audit", "verify", "--file", file], { env: {} });
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, "");
    const report = reportOf(result.stdout);
    assert.equal(report.ok, true);
    assert.deepEqual(report.files[0]?.head, { seq: 3, lineSha256: hashOf(lines[2]) });

    const pinned = await runCli(["audit", "verify", "--file", file, "--head", `3:${hashOf(lines[2])}`], { env: {} });
    assert.equal(pinned.exitCode, 0);
    assert.equal(pinned.stderr, "");
  });
});

void test("audit verify --file: an edited line names the successor line as prev-mismatch", async () => {
  await withState(async (stateDir) => {
    const lines = seed(stateDir);
    const file = auditFile(stateDir);
    const edited = JSON.parse(lines[1] ?? "") as Record<string, unknown>;
    edited["path"] = "changed.txt";
    writeLines(file, [lines[0] ?? "", JSON.stringify(edited), lines[2] ?? ""]);
    const result = await runCli(["audit", "verify", "--file", file], { env: {} });
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /line 3 does not chain to line 2 \(prev-mismatch\)/);
    assert.deepEqual(reportOf(result.stdout).files[0]?.broken, { line: 3, reason: "prev-mismatch" });
  });
});

void test("audit verify --file: a deleted middle line is a seq-gap at the line after the gap", async () => {
  await withState(async (stateDir) => {
    const lines = seed(stateDir);
    const file = auditFile(stateDir);
    writeLines(file, [lines[0] ?? "", lines[2] ?? ""]);
    const result = await runCli(["audit", "verify", "--file", file], { env: {} });
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /line 2 does not chain to line 1 \(seq-gap\)/);
    assert.deepEqual(reportOf(result.stdout).files[0]?.broken, { line: 2, reason: "seq-gap" });
  });
});

void test("audit verify --file: swapped lines are reported at the first line that arrives out of order", async () => {
  await withState(async (stateDir) => {
    const lines = seed(stateDir);
    const file = auditFile(stateDir);
    writeLines(file, [lines[0] ?? "", lines[2] ?? "", lines[1] ?? ""]);
    const result = await runCli(["audit", "verify", "--file", file], { env: {} });
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /line 2 does not chain to line 1 \(seq-gap\)/);
    assert.deepEqual(reportOf(result.stdout).files[0]?.broken, { line: 2, reason: "seq-gap" });
  });
});

void test("audit verify --file: losing the first lines is a bad-chain-start at line 1", async () => {
  await withState(async (stateDir) => {
    const lines = seed(stateDir);
    const file = auditFile(stateDir);
    writeLines(file, [lines[1] ?? "", lines[2] ?? ""]);
    const result = await runCli(["audit", "verify", "--file", file], { env: {} });
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /line 1 does not start the chain \(bad-chain-start\)/);
    assert.deepEqual(reportOf(result.stdout).files[0]?.broken, { line: 1, reason: "bad-chain-start" });
  });
});

void test("audit verify --file --head: a tail cut below the saved head is tail-loss at the last line present", async () => {
  await withState(async (stateDir) => {
    const lines = seed(stateDir);
    const file = auditFile(stateDir);
    writeLines(file, [lines[0] ?? "", lines[1] ?? ""]);
    const result = await runCli(["audit", "verify", "--file", file, "--head", `3:${hashOf(lines[2])}`], { env: {} });
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /log ends at line 2, before the head checkpoint \(tail-loss\)/);
    assert.deepEqual(reportOf(result.stdout).files[0]?.broken, { line: 2, reason: "tail-loss" });
  });
});

void test("audit verify --file --anchor: a log shorter than the anchor is shorter-log at its last line", async () => {
  await withState(async (stateDir) => {
    const lines = seed(stateDir);
    const file = auditFile(stateDir);
    const anchor = join(stateDir, "anchor.json");
    writeFileSync(anchor, JSON.stringify({ seq: 2, lineSha256: hashOf(lines[1]) }));
    writeLines(file, [lines[0] ?? ""]);
    const result = await runCli(["audit", "verify", "--file", file, "--anchor", anchor], { env: {} });
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /log ends at line 1, before the anchor checkpoint \(shorter-log\)/);
    assert.deepEqual(reportOf(result.stdout).files[0]?.broken, { line: 1, reason: "shorter-log" });
  });
});

void test("audit verify --file --anchor: an untouched anchored prefix exits 0", async () => {
  await withState(async (stateDir) => {
    const lines = seed(stateDir);
    const file = auditFile(stateDir);
    const anchor = join(stateDir, "anchor.json");
    writeFileSync(anchor, JSON.stringify({ seq: 2, lineSha256: hashOf(lines[1]) }));
    const result = await runCli(["audit", "verify", "--file", file, "--anchor", anchor], { env: {} });
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, "");
  });
});

void test("audit verify --file --anchor: a rewritten prefix with a re-linked successor passes the chain and fails the anchor at line 2", async () => {
  await withState(async (stateDir) => {
    const lines = seed(stateDir);
    const file = auditFile(stateDir);
    const anchor = join(stateDir, "anchor.json");
    writeFileSync(anchor, JSON.stringify({ seq: 2, lineSha256: hashOf(lines[1]) }));
    const forged = JSON.stringify({ ...(JSON.parse(lines[1] ?? "") as Record<string, unknown>), path: "forged.txt" });
    const relinked = JSON.stringify({
      ...(JSON.parse(lines[2] ?? "") as Record<string, unknown>),
      prev: hashOf(forged),
    });
    writeLines(file, [lines[0] ?? "", forged, relinked]);
    const result = await runCli(["audit", "verify", "--file", file, "--anchor", anchor], { env: {} });
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /line 2 changed after the anchor \(prefix-changed\)/);
    assert.deepEqual(reportOf(result.stdout).files[0]?.broken, { line: 2, reason: "prefix-changed" });
  });
});

void test("audit verify: conflicting, repeated, positional, and pin-without-file selectors exit 2 with no stdout", async () => {
  await withState(async (stateDir) => {
    const lines = seed(stateDir);
    const file = auditFile(stateDir);
    const head = `3:${hashOf(lines[2])}`;
    const refused: readonly (readonly string[])[] = [
      ["audit", "verify", "--file", file, "--session", SESSION],
      ["audit", "verify", "--file", file, "--file", file],
      ["audit", "verify", "--session", SESSION, "--session", SESSION],
      ["audit", "verify", "--head", head],
      ["audit", "verify", "--anchor", join(stateDir, "anchor.json")],
      ["audit", "verify", file],
      ["audit", "verify", "--file", file, "--head", head, "--head", head],
      ["audit", "verify", "--file", file, "--bogus", "x"],
      ["audit", "verify", "--file"],
      ["audit", "verify", "--file", ""],
      ["audit", "verify", "--session", "../escape"],
      ["audit"],
      ["audit", "check", "--file", file],
    ];
    for (const words of refused) {
      const result = await runCli(words, { env: {} });
      assert.equal(result.exitCode, 2, words.join(" "));
      assert.equal(result.stdout, "", words.join(" "));
      assert.notEqual(result.stderr, "", words.join(" "));
    }
  });
});

void test("audit verify: a malformed --head exits 2 before any file is read", async () => {
  await withState(async (stateDir) => {
    const lines = seed(stateDir);
    const file = auditFile(stateDir);
    const malformed = [
      "not-a-checkpoint",
      `0:${hashOf(lines[0])}`,
      `3:${hashOf(lines[2]).toUpperCase()}`,
      `3:${hashOf(lines[2]).slice(0, 63)}`,
      `03:${hashOf(lines[2])}`,
      `3:${hashOf(lines[2])}\n`,
    ];
    for (const head of malformed) {
      const result = await runCli(["audit", "verify", "--file", file, "--head", head], { env: {} });
      assert.equal(result.exitCode, 2, JSON.stringify(head));
      assert.equal(result.stdout, "", JSON.stringify(head));
    }
  });
});

void test("audit verify --anchor: a record that is not {seq, lineSha256} exits 2; an unreadable record exits 1", async () => {
  await withState(async (stateDir) => {
    const lines = seed(stateDir);
    const file = auditFile(stateDir);
    const anchor = join(stateDir, "anchor.json");
    const malformed = [
      "not json",
      JSON.stringify({ seq: 2 }),
      JSON.stringify({ seq: 2, lineSha256: hashOf(lines[1]), createdAt: "2026-11-01T00:00:00.000Z" }),
      JSON.stringify({ seq: 0, lineSha256: hashOf(lines[1]) }),
      JSON.stringify({ seq: 2.5, lineSha256: hashOf(lines[1]) }),
      JSON.stringify([2, hashOf(lines[1])]),
    ];
    for (const text of malformed) {
      writeFileSync(anchor, text);
      const result = await runCli(["audit", "verify", "--file", file, "--anchor", anchor], { env: {} });
      assert.equal(result.exitCode, 2, text);
      assert.equal(result.stdout, "", text);
    }
    const missing = await runCli(
      ["audit", "verify", "--file", file, "--anchor", join(stateDir, "no-such-anchor.json")],
      { env: {} },
    );
    assert.equal(missing.exitCode, 1);
    assert.match(missing.stderr, /the anchor record cannot be read/);
  });
});

void test("audit verify --file: a symbolic link is refused and never followed", async () => {
  await withState(async (stateDir) => {
    seed(stateDir);
    const link = join(stateDir, "linked.jsonl");
    symlinkSync(auditFile(stateDir), link);
    const result = await runCli(["audit", "verify", "--file", link], { env: {} });
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /audit file is a symbolic link; refusing to follow it/);
    assert.equal(reportOf(result.stdout).files[0]?.failure, "symlink");
  });
});

void test("audit verify --file: a non-regular path (a directory) is refused with exit 1", async () => {
  await withState(async (stateDir) => {
    const result = await runCli(["audit", "verify", "--file", stateDir], { env: {} });
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /audit file is not a regular file/);
    assert.equal(reportOf(result.stdout).files[0]?.failure, "nonregular");
  });
});

void test("audit verify --file: a missing audit file exits 1, never a pass", async () => {
  await withState(async (stateDir) => {
    const result = await runCli(["audit", "verify", "--file", auditFile(stateDir)], { env: {} });
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /audit file is missing/);
    assert.equal(reportOf(result.stdout).ok, false);
    assert.equal(reportOf(result.stdout).files[0]?.failure, "missing");
  });
});

void test("audit verify --file: legacy lines before the chain exit 0 and are counted as unprotected", async () => {
  await withState(async (stateDir) => {
    mkdirSync(join(stateDir, "audit"), { recursive: true });
    const legacy = JSON.stringify({ tool: "write", outcome: "ok" });
    writeFileSync(auditFile(stateDir), `${legacy}\n`);
    appendAudit(stateDir, { sessionId: SESSION, tool: "list", outcome: "ok" });
    const result = await runCli(["audit", "verify", "--file", auditFile(stateDir)], { env: {} });
    assert.equal(result.exitCode, 0);
    assert.match(result.stderr, /1 legacy line\(s\) are unprotected/);
    assert.equal(reportOf(result.stdout).files[0]?.unprotected, 1);
  });
});

void test("audit verify --session: reads the session's file under the configured state directory", async () => {
  await withState(async (stateDir) => {
    seed(stateDir);
    const ok = await runCli(["audit", "verify", "--session", SESSION], depsFor(stateDir));
    assert.equal(ok.exitCode, 0);
    assert.equal(reportOf(ok.stdout).files[0]?.sessionId, SESSION);

    const missing = await runCli(["audit", "verify", "--session", OTHER_SESSION], depsFor(stateDir));
    assert.equal(missing.exitCode, 1);
    assert.match(missing.stderr, new RegExp(`session ${OTHER_SESSION}: audit file is missing`));
  });
});

void test("audit verify --session without a readable config exits 2 with a usage refusal", async () => {
  await withState(async (stateDir) => {
    seed(stateDir);
    const result = await runCli(["audit", "verify", "--session", SESSION], { env: {} });
    assert.equal(result.exitCode, 2);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /cannot resolve a state directory/);
  });
});

void test("audit verify (no selector): verifies every session file in name order and fails on any broken one", async () => {
  await withState(async (stateDir) => {
    seed(stateDir, OTHER_SESSION);
    const lines = seed(stateDir, SESSION);
    const both = await runCli(["audit", "verify"], depsFor(stateDir));
    assert.equal(both.exitCode, 0);
    const report = reportOf(both.stdout);
    assert.deepEqual(
      report.files.map((file) => file.sessionId),
      [SESSION, OTHER_SESSION],
    );

    writeLines(auditFile(stateDir), [lines[0] ?? "", lines[2] ?? "", lines[1] ?? ""]);
    const broken = await runCli(["audit", "verify"], depsFor(stateDir));
    assert.equal(broken.exitCode, 1);
    assert.match(broken.stderr, new RegExp(`session ${SESSION}: line 2 does not chain to line 1 \\(seq-gap\\)`));
    assert.equal(reportOf(broken.stdout).files.find((file) => file.sessionId === OTHER_SESSION)?.ok, true);
  });
});

void test("audit verify (no selector): an empty or absent audit directory has no file to verify and exits 1", async () => {
  await withState(async (stateDir) => {
    const absent = await runCli(["audit", "verify"], depsFor(stateDir));
    assert.equal(absent.exitCode, 1);
    assert.match(absent.stderr, /no audit file to verify/);
    assert.deepEqual(reportOf(absent.stdout), { ok: false, files: [] });
  });
});

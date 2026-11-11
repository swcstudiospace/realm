// OBS-01 / D-1702: exercise the public CLI with real audit files and checkpoints.
// No changed-module mocks, daemon, signing key, RPC, or container runtime is needed.
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildAnchorRecord, splitAuditLines } from "../../src/audit/anchor.js";
import type { VerifyAuditResult } from "../../src/audit/chain.js";
import { appendAudit } from "../../src/audit/log.js";
import { AUDIT_VERIFY_USAGE } from "../../src/cli/audit.js";
import { runCli, type CliDeps, type CliResult } from "../../src/cli/main.js";

const SESSION = "session-one";
const OTHER = "session-two";
const HASH = "a".repeat(64);

interface FileReport extends Partial<VerifyAuditResult> {
  readonly sessionId: string;
  readonly ok: boolean;
  readonly unprotected?: number;
  readonly suspect?: readonly number[];
  readonly error?: string;
}

interface Report {
  readonly ok: boolean;
  readonly files: readonly FileReport[];
}

function reportOf(result: CliResult): Report {
  assert.equal(result.stdout.endsWith("\n"), true, "one newline-terminated JSON report");
  assert.equal(result.stdout.trimEnd().includes("\n"), false);
  return JSON.parse(result.stdout) as Report;
}

function fixture(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), "realm-audit-cli-"));
  t.after(() => { rmSync(root, { recursive: true, force: true }); });
  const stateDir = join(root, "state");
  const configHome = join(root, "config");
  mkdirSync(join(configHome, "realm"), { recursive: true });
  mkdirSync(join(stateDir, "audit"), { recursive: true });
  const config = {
    image: `registry.example.com/realm/workload@sha256:${"0".repeat(64)}`,
    stateDir,
    workspaceRoot: join(root, "workspace"),
  };
  writeFileSync(join(configHome, "realm", "config.json"), JSON.stringify(config));
  const deps: CliDeps = {
    env: { XDG_CONFIG_HOME: configHome },
    cwd: join(root, "not-the-state-directory"),
    spawn: () => assert.fail("audit must not spawn a daemon"),
    send: () => assert.fail("audit must not send daemon requests"),
    connect: () => assert.fail("audit must not connect to a daemon"),
    runCommand: () => assert.fail("audit must not run runtime probes"),
    connectSocket: () => assert.fail("audit must not probe runtime sockets"),
    createAnchorRpc: () => assert.fail("verification must not contact an anchor RPC"),
  };
  const file = (sessionId = SESSION) => join(stateDir, "audit", `${sessionId}.jsonl`);
  const seed = (sessionId = SESSION) => {
    appendAudit(stateDir, { sessionId, tool: "write", outcome: "ok", phase: "admission", path: "a.txt" });
    appendAudit(stateDir, { sessionId, tool: "write", outcome: "ok", phase: "result", path: "a.txt" });
    return file(sessionId);
  };
  return { root, stateDir, config, deps, file, seed };
}

function assertPathFree(result: CliResult, root: string): void {
  assert.equal(result.stdout.includes(root), false);
  assert.equal(result.stderr.includes(root), false);
}

void test("OBS-01: invalid audit verbs, selectors and checkpoints exit 2 before config or daemon access", async () => {
  const deps: CliDeps = {
    env: {},
    readConfig: () => assert.fail("malformed audit syntax must not read configuration"),
    connect: () => assert.fail("malformed audit syntax must not contact a daemon"),
  };
  const invalid = [
    [], ["other"], ["--file", "/copy.jsonl"], ["verify", "/copy.jsonl"],
    ["verify", "relative.jsonl"], ["verify", "--file"], ["verify", "--file", ""],
    ["verify", "--file", "relative.jsonl"], ["verify", "--session"],
    ["verify", "--session", "../escape"], ["verify", "--session", "nested/id"],
    ["verify", "--session", " padded"], ["verify", "--session", "trailing\n"],
    ["verify", "--file", "/a.jsonl", "--session", SESSION],
    ["verify", "--session", SESSION, "--file", "/a.jsonl"],
    ["verify", "--file", "/a.jsonl", "--file", "/b.jsonl"],
    ["verify", "--session", SESSION, "--session", OTHER],
    ["verify", "--anchor"], ["verify", "--anchor", "a.json", "--anchor", "b.json"],
    ["verify", "--head"], ["verify", "--head", `1:${HASH}`, "--head", `2:${HASH}`],
    ["verify", "--unknown", "value"], ["verify", "--file=/a.jsonl"],
    ["verify", "--file", "/a.jsonl", "extra"], ["verify", "--head", "--session", SESSION],
  ];
  for (const head of [
    `0:${HASH}`, `01:${HASH}`, `-1:${HASH}`, `1.5:${HASH}`, `1e2:${HASH}`,
    `9007199254740992:${HASH}`, `1:${HASH.toUpperCase()}`, `1:${HASH}x`,
    `1:${HASH}\n`, ` 1:${HASH}`, `1:${HASH}:extra`, "1:short",
  ]) {
    invalid.push(["verify", "--head", head]);
  }
  for (const words of invalid) {
    const result = await runCli(["audit", ...words], deps);
    assert.equal(result.exitCode, 2, JSON.stringify(words));
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, `realm audit verify: usage: ${AUDIT_VERIFY_USAGE}\n`);
  }
});

void test("OBS-01: --file is config-free, returns an aggregate and derives only a safe file label", async (t) => {
  const { root, deps, seed } = fixture(t);
  const source = seed();
  for (const [name, sessionId] of [["copy.jsonl", "copy"], ["unsafe name.jsonl", "file"]]) {
    assert.ok(name !== undefined && sessionId !== undefined);
    const copy = join(root, name);
    writeFileSync(copy, readFileSync(source));
    const result = await runCli(["audit", "verify", "--file", copy], {
      ...deps,
      env: {},
      readConfig: () => assert.fail("an explicit file does not require runtime configuration"),
    });
    assert.equal(result.exitCode, 0, result.stderr);
    const report = reportOf(result);
    assert.equal(report.ok, true);
    assert.equal(report.files.length, 1);
    assert.equal(report.files[0]?.sessionId, sessionId);
    assert.equal(report.files[0]?.ok, true);
    assert.equal(report.files[0]?.chainedLines, 2);
    assert.deepEqual(report.files[0]?.unparsedLines, []);
    assert.match(result.stderr, /unanchored chain cannot detect tail truncation/);
    assertPathFree(result, root);
  }
});

void test("OBS-01: --session uses the configured state directory, while no selector verifies its sorted audit set", async (t) => {
  const { root, deps, seed, file } = fixture(t);
  seed(OTHER);
  seed(SESSION);
  // A damaged second session cannot contaminate a deliberately selected clean session.
  const changed = readFileSync(file(OTHER), "utf8").replace('"path":"a.txt"', '"path":"changed.txt"');
  writeFileSync(file(OTHER), changed);
  const selected = await runCli(["audit", "verify", "--session", SESSION], deps);
  assert.equal(selected.exitCode, 0, selected.stderr);
  assert.deepEqual(reportOf(selected).files.map((entry) => entry.sessionId), [SESSION]);
  const all = await runCli(["audit", "verify"], deps);
  assert.equal(all.exitCode, 1);
  const report = reportOf(all);
  assert.equal(report.ok, false);
  assert.deepEqual(report.files.map((entry) => [entry.sessionId, entry.ok]), [[SESSION, true], [OTHER, false]]);
  assert.deepEqual(report.files[1]?.broken, { line: 2, reason: "prev-mismatch" });
  assert.deepEqual(report.files[1]?.suspect, [1, 2]);
  assert.match(all.stderr, /line 2 does not chain to line 1 \(prev-mismatch\)/);
  assertPathFree(all, root);
});

void test("OBS-01: session and all-session selection require valid runtime config with the existing exit-2 diagnostic", async (t) => {
  const { deps, config } = fixture(t);
  for (const words of [[], ["--session", SESSION]]) {
    const missing = await runCli(["audit", "verify", ...words], { env: {} });
    assert.equal(missing.exitCode, 2);
    assert.equal(missing.stdout, "");
    assert.match(missing.stderr, /^realm audit: cannot resolve a state directory/);
    for (const value of [undefined, {}, { ...config, stateDir: "relative" }, { ...config, image: "not-pinned" }]) {
      const invalid = await runCli(["audit", "verify", ...words], { ...deps, readConfig: () => value });
      assert.deepEqual(invalid, missing);
    }
    const unreadable = await runCli(["audit", "verify", ...words], {
      ...deps,
      readConfig: () => { throw new Error("private configuration contents"); },
    });
    assert.deepEqual(unreadable, missing, "config contents do not leak into diagnostics");
  }
});

void test("OBS-01: absent, empty and missing selected audit files exit 1 rather than claim successful verification", async (t) => {
  const { root, stateDir, deps, file } = fixture(t);
  const empty = await runCli(["audit", "verify"], deps);
  assert.equal(empty.exitCode, 1);
  assert.deepEqual(reportOf(empty), { ok: false, files: [] });
  assert.match(empty.stderr, /no audit files to verify/);
  const missing = await runCli(["audit", "verify", "--session", SESSION], deps);
  assert.equal(missing.exitCode, 1);
  assert.deepEqual(reportOf(missing), {
    ok: false, files: [{ sessionId: SESSION, ok: false, error: "unreadable-file-or-invalid-checkpoint" }],
  });
  const explicit = await runCli(["audit", "verify", "--file", file()], { ...deps, env: {} });
  assert.equal(explicit.exitCode, 1);
  assert.deepEqual(reportOf(explicit), reportOf(missing));
  rmSync(join(stateDir, "audit"), { recursive: true });
  const absent = await runCli(["audit", "verify"], deps);
  assert.equal(absent.exitCode, 1);
  assert.deepEqual(reportOf(absent), { ok: false, files: [] });
  assert.match(absent.stderr, /audit files cannot be selected/);
  assertPathFree(absent, root);
});

void test("OBS-01: a CLI-emitted physical head round-trips and detects truncation through --file and --session", async (t) => {
  const { root, deps, seed } = fixture(t);
  const file = seed();
  const original = readFileSync(file, "utf8");
  const clean = await runCli(["audit", "verify", "--file", file], deps);
  assert.equal(clean.exitCode, 0, clean.stderr);
  const head = reportOf(clean).files[0]?.head;
  assert.ok(head);
  assert.equal(head.seq, 2);
  const retained = `${String(head.seq)}:${head.lineSha256}`;
  for (const selector of [["--file", file], ["--session", SESSION]]) {
    writeFileSync(file, original);
    const matching = await runCli(["audit", "verify", "--head", retained, ...selector], deps);
    assert.equal(matching.exitCode, 0, matching.stderr);
    assert.match(matching.stderr, /origin is not authenticated here/);
    for (const truncated of [original.slice(0, original.indexOf("\n") + 1), ""]) {
      writeFileSync(file, truncated);
      const unanchored = await runCli(["audit", "verify", ...selector], deps);
      assert.equal(unanchored.exitCode, 0, "without a retained checkpoint a valid prefix alone cannot prove truncation");
      const checked = await runCli(["audit", "verify", ...selector, "--head", retained], deps);
      assert.equal(checked.exitCode, 1);
      assert.equal(reportOf(checked).ok, false);
      assert.deepEqual(reportOf(checked).files[0]?.broken, {
        line: truncated === "" ? 1 : 2, reason: "shorter-than-head",
      });
      assertPathFree(checked, root);
    }
  }
});

void test("OBS-01: --head authenticates the retained physical line even when the unkeyed chain still passes", async (t) => {
  const { deps, seed } = fixture(t);
  const file = seed();
  const head = reportOf(await runCli(["audit", "verify", "--file", file], deps)).files[0]?.head;
  assert.ok(head);
  const lines = readFileSync(file, "utf8").trimEnd().split("\n");
  const tail = JSON.parse(lines[1] ?? "") as Record<string, unknown>;
  tail["path"] = "forged-tail.txt";
  writeFileSync(file, `${lines[0] ?? ""}\n${JSON.stringify(tail)}\n`);
  assert.equal((await runCli(["audit", "verify", "--file", file], deps)).exitCode, 0);
  const checked = await runCli(["audit", "verify", "--file", file, "--head", `${String(head.seq)}:${head.lineSha256}`], deps);
  assert.equal(checked.exitCode, 1);
  assert.deepEqual(reportOf(checked).files[0]?.broken, { line: 2, reason: "head-mismatch" });
});

void test("OBS-01: --anchor and --head together accept later appends but independently reject a truncated retained prefix", async (t) => {
  const { root, stateDir, deps, seed } = fixture(t);
  const file = seed();
  const original = readFileSync(file);
  const anchor = buildAnchorRecord({ sessionId: SESSION, lines: splitAuditLines(original), createdAt: new Date("2026-10-31T00:00:00.000Z") });
  const anchorFile = join(root, "retained-anchor.json");
  writeFileSync(anchorFile, JSON.stringify(anchor));
  const clean = await runCli(["audit", "verify", "--session", SESSION], deps);
  const head = reportOf(clean).files[0]?.head;
  assert.ok(head);
  const checkpointFlags = ["--anchor", anchorFile, "--head", `${String(head.seq)}:${head.lineSha256}`];
  appendAudit(stateDir, { sessionId: SESSION, tool: "read", outcome: "ok" });
  const extended = await runCli(["audit", "verify", ...checkpointFlags, "--session", SESSION], deps);
  assert.equal(extended.exitCode, 0, extended.stderr);
  assert.deepEqual(reportOf(extended).files[0]?.anchor, { ok: true, lineCount: 2 });
  assert.equal(reportOf(extended).files[0]?.head?.seq, 3);
  writeFileSync(file, "");
  for (const selector of [["--file", file], ["--session", SESSION]]) {
    for (const flags of [["--anchor", anchorFile], checkpointFlags]) {
      const checked = await runCli(["audit", "verify", ...selector, ...flags], deps);
      assert.equal(checked.exitCode, 1);
      assert.deepEqual(reportOf(checked).files[0]?.broken, { line: 1, reason: "shorter-than-anchor" });
      assert.deepEqual(reportOf(checked).files[0]?.anchor, { ok: false, lineCount: 2 });
      assertPathFree(checked, root);
    }
  }
});

void test("OBS-01: CLI anchor verification detects a changed last line and refuses wrong-session and malformed records", async (t) => {
  const { root, deps, seed } = fixture(t);
  const file = seed();
  const original = readFileSync(file, "utf8");
  const record = buildAnchorRecord({ sessionId: SESSION, lines: splitAuditLines(Buffer.from(original)), createdAt: new Date("2026-10-31T00:00:00.000Z") });
  const anchorFile = join(root, "anchor.json");
  writeFileSync(anchorFile, JSON.stringify(record));
  const lines = original.trimEnd().split("\n");
  const tail = JSON.parse(lines[1] ?? "") as Record<string, unknown>;
  tail["path"] = "forged-tail.txt";
  writeFileSync(file, `${lines[0] ?? ""}\n${JSON.stringify(tail)}\n`);
  const changed = await runCli(["audit", "verify", "--session", SESSION, "--anchor", anchorFile], deps);
  assert.equal(changed.exitCode, 1);
  assert.deepEqual(reportOf(changed).files[0]?.broken, { line: 2, reason: "anchor-root-mismatch" });
  writeFileSync(file, original);
  writeFileSync(anchorFile, JSON.stringify({ ...record, sessionId: OTHER }));
  const mismatch = await runCli(["audit", "verify", "--session", SESSION, "--anchor", anchorFile], deps);
  assert.equal(mismatch.exitCode, 1);
  assert.equal(reportOf(mismatch).files[0]?.error, "unreadable-file-or-invalid-checkpoint");
  for (const contents of ["{", JSON.stringify({ record }), JSON.stringify({ ...record, lineCount: 0 })]) {
    writeFileSync(anchorFile, contents);
    const invalid = await runCli(["audit", "verify", "--file", file, "--anchor", anchorFile], deps);
    assert.equal(invalid.exitCode, 1, "malformed checkpoint data is a verification failure, not a syntax error");
    assert.deepEqual(reportOf(invalid), { ok: false, files: [] });
    assert.match(invalid.stderr, /anchor cannot be read or is not a valid record/);
    assertPathFree(invalid, root);
  }
});

void test("OBS-01: the CLI preserves legacy warnings and physical-line heads across closed torn fragments", async (t) => {
  const { stateDir, deps, file } = fixture(t);
  writeFileSync(file(), '{"tool":"legacy"}\n');
  appendAudit(stateDir, { sessionId: SESSION, tool: "read", outcome: "ok" });
  appendFileSync(file(), '{"tool":"tor');
  appendAudit(stateDir, { sessionId: SESSION, tool: "write", outcome: "ok" });
  const result = await runCli(["audit", "verify", "--session", SESSION], deps);
  assert.equal(result.exitCode, 0, result.stderr);
  const report = reportOf(result).files[0];
  assert.equal(report?.unprotected, 1);
  assert.equal(report?.chainStartLine, 2);
  assert.deepEqual(report?.unparsedLines, [3]);
  assert.equal(report?.head?.seq, 4);
  assert.match(result.stderr, /1 legacy line\(s\) are unprotected/);
  const head = report?.head;
  assert.ok(head);
  const checked = await runCli(["audit", "verify", "--session", SESSION, "--head", `${String(head.seq)}:${head.lineSha256}`], deps);
  assert.equal(checked.exitCode, 0, checked.stderr);
  assert.deepEqual(reportOf(checked).files[0]?.unparsedLines, [3]);
});

void test("OBS-01: symlink audit files and non-regular explicit inputs are refused without reading their targets", async (t) => {
  const { root, deps, seed, file } = fixture(t);
  const source = seed();
  const original = readFileSync(source);
  const link = join(root, "linked.jsonl");
  symlinkSync(source, link);
  for (const input of [link, join(root, "missing.jsonl"), root]) {
    const result = await runCli(["audit", "verify", "--file", input], deps);
    assert.equal(result.exitCode, 1);
    assert.equal(reportOf(result).ok, false);
    assert.equal(reportOf(result).files[0]?.error, "unreadable-file-or-invalid-checkpoint");
    assertPathFree(result, root);
  }
  symlinkSync(source, file(OTHER));
  const selected = await runCli(["audit", "verify", "--session", OTHER], deps);
  assert.equal(selected.exitCode, 1);
  assert.equal(reportOf(selected).files[0]?.error, "unreadable-file-or-invalid-checkpoint");
  const all = await runCli(["audit", "verify"], deps);
  assert.equal(all.exitCode, 1);
  assert.deepEqual(reportOf(all).files.map((entry) => [entry.sessionId, entry.ok]), [[SESSION, true], [OTHER, false]]);
  assert.deepEqual(readFileSync(source), original);
});

void test("OBS-01: session and aggregate selectors refuse a symlink audit directory rather than following it", async (t) => {
  const { root, stateDir, deps, seed } = fixture(t);
  const source = seed();
  const bytes = readFileSync(source);
  const outside = join(root, "outside-audit");
  mkdirSync(outside);
  writeFileSync(join(outside, `${SESSION}.jsonl`), bytes);
  rmSync(join(stateDir, "audit"), { recursive: true });
  symlinkSync(outside, join(stateDir, "audit"), "dir");
  for (const flags of [[], ["--session", SESSION]]) {
    const result = await runCli(["audit", "verify", ...flags], deps);
    assert.equal(result.exitCode, 1);
    assert.deepEqual(reportOf(result), { ok: false, files: [] });
    assert.match(result.stderr, /audit files cannot be selected/);
    assertPathFree(result, root);
  }
  assert.deepEqual(readFileSync(join(outside, `${SESSION}.jsonl`)), bytes);
});

void test("OBS-01: symlink, directory and absent anchor inputs cannot turn a valid chain into a passing checkpoint verification", async (t) => {
  const { root, deps, seed } = fixture(t);
  const file = seed();
  const original = readFileSync(file);
  const anchor = buildAnchorRecord({ sessionId: SESSION, lines: splitAuditLines(original), createdAt: new Date("2026-10-31T00:00:00.000Z") });
  const anchorFile = join(root, "anchor.json");
  writeFileSync(anchorFile, JSON.stringify(anchor));
  const link = join(root, "anchor-link.json");
  symlinkSync(anchorFile, link);
  for (const input of [link, root, join(root, "missing-anchor.json")]) {
    const result = await runCli(["audit", "verify", "--file", file, "--anchor", input], deps);
    assert.equal(result.exitCode, 1);
    assert.deepEqual(reportOf(result), { ok: false, files: [] });
    assert.match(result.stderr, /anchor cannot be read or is not a valid record/);
    assertPathFree(result, root);
  }
  assert.deepEqual(readFileSync(file), original);
  assert.deepEqual(JSON.parse(readFileSync(anchorFile, "utf8")) as unknown, anchor);
});

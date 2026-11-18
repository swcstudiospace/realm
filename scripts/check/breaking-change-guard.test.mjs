import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  HEADER_PATTERN,
  classifyCommit,
  collectCommits,
  evaluate,
  formatReport,
  hasBreakingFooter,
  isDeclared,
  parseHeader,
  readPullRequest,
  runGuard,
} from "./breaking-change-guard.mjs";
import { generateChangelog } from "../release/changelog.mjs";

const SCRIPT = fileURLToPath(new URL("./breaking-change-guard.mjs", import.meta.url));
const IDENTITY = ["-c", "user.name=test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false"];
const tempRoots = [];

afterEach(() => {
  for (const dir of tempRoots.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function tempDir(prefix) {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  tempRoots.push(dir);
  return dir;
}

function gitEnv(dir) {
  return {
    PATH: process.env.PATH,
    HOME: dir,
    GIT_CONFIG_GLOBAL: os.devNull,
    GIT_CONFIG_NOSYSTEM: "1",
  };
}

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", timeout: 30000, env: gitEnv(cwd) }).trim();
}

let commitCounter = 0;

function commit(cwd, subject, body, file = "work.txt") {
  commitCounter += 1;
  writeFileSync(path.join(cwd, file), `${String(commitCounter)}\n`);
  git(cwd, ["add", "-A"]);
  const messages = body === undefined ? [subject] : [subject, body];
  git(cwd, [...IDENTITY, "commit", "-q", ...messages.flatMap((message) => ["-m", message])]);
  return git(cwd, ["rev-parse", "HEAD"]);
}

// A repository with one initial commit; `base` is its commit id, so no remote is needed.
function makeRepo() {
  const dir = tempDir("breaking-guard-test-");
  git(dir, ["init", "-q"]);
  const base = commit(dir, "chore: initial");
  return { dir, base };
}

function guard(repo, argv, env = {}) {
  const lines = [];
  const errors = [];
  const code = runGuard({
    argv,
    env,
    cwd: repo.dir,
    out: (line) => lines.push(line),
    err: (line) => errors.push(line),
  });
  return { code, lines, errors };
}

function range(repo) {
  return ["--base", repo.base, "--head", "HEAD"];
}

function hasLine(lines, fragment) {
  return lines.some((line) => line.includes(fragment));
}

const DECLARED_BODY = "## Checklist\n\n- [x] Breaking change: a documented contract changes incompatibly.\n";

// parsing -------------------------------------------------------------------------------------------------------

test("HEADER_PATTERN is the text of the changelog generator pattern", () => {
  assert.equal(HEADER_PATTERN.source, "^([a-z]+)(?:\\(([^)]*)\\))?(!)?:");
});

test("parseHeader reads the type, scope and breaking flag", () => {
  const cases = [
    ["feat(x)!: a", { type: "feat", scope: "x", breaking: true }],
    ["feat!: a", { type: "feat", scope: undefined, breaking: true }],
    ["feat(x): a", { type: "feat", scope: "x", breaking: false }],
    ["fix: a", { type: "fix", scope: undefined, breaking: false }],
    ["Feat: a", null],
    ["feat(x) a", null],
    ["just a sentence", null],
    [" feat!: a", null],
  ];
  for (const [subject, expected] of cases) {
    assert.deepEqual(parseHeader(subject), expected, subject);
  }
});

test("hasBreakingFooter accepts only a footer line with a value", () => {
  const cases = [
    ["BREAKING CHANGE: the wire shape changes", true],
    ["BREAKING-CHANGE: the wire shape changes", true],
    ["Summary line\n\nmore text\nBREAKING CHANGE: x\nSigned-off-by: a", true],
    ["Summary\r\n\r\nBREAKING CHANGE: crlf body\r\n", true],
    ["breaking change: lowercase", false],
    ["BREAKING CHANGE:", false],
    ["BREAKING CHANGE: ", false],
    ["BREAKING CHANGE no colon", false],
    ["This is a BREAKING CHANGE: mid-sentence", false],
    ["", false],
  ];
  for (const [text, expected] of cases) {
    assert.equal(hasBreakingFooter(text), expected, JSON.stringify(text));
  }
});

test("isDeclared accepts only a ticked Breaking change list item", () => {
  const cases = [
    ["- [x] Breaking change: yes", true],
    ["- [X] Breaking change: yes", true],
    ["* [x] Breaking change", true],
    ["   - [x] Breaking change: indented", true],
    ["intro\n- [x] Breaking change: later line", true],
    ["- [ ] Breaking change: not ticked", false],
    ["- [x] Something else", false],
    ["- [x] Breaking changes elsewhere", false],
    ["", false],
  ];
  for (const [body, expected] of cases) {
    assert.equal(isDeclared(body), expected, JSON.stringify(body));
  }
});

test("classifyCommit reports the marker, the footer and the union", () => {
  const marked = classifyCommit({ hash: "a".repeat(40), subject: "feat!: a", body: "" });
  assert.equal(marked.marked, true);
  assert.equal(marked.footer, false);
  assert.equal(marked.breaking, true);
  const footer = classifyCommit({ hash: "b".repeat(40), subject: "not conventional", body: "BREAKING CHANGE: x" });
  assert.equal(footer.marked, false);
  assert.equal(footer.footer, true);
  assert.equal(footer.breaking, true);
  const plain = classifyCommit({ hash: "c".repeat(40), subject: "fix: a", body: "text" });
  assert.equal(plain.breaking, false);
});

// evaluation ----------------------------------------------------------------------------------------------------

function fakeCommit(subject, body = "") {
  return classifyCommit({ hash: "1234567890abcdef".repeat(2).slice(0, 40), subject, body });
}

const MARKED_COMMIT = fakeCommit("feat(x)!: a");
const FOOTER_COMMIT = fakeCommit("feat(x): b", "BREAKING CHANGE: b changes");
const PLAIN_COMMIT = fakeCommit("fix: c");

function codes(result) {
  return result.findings.map((finding) => `${finding.kind}:${finding.code}`);
}

test("evaluate reports ok when no signal exists, whatever the landing and title", () => {
  for (const landing of ["merge", "squash", "unknown"]) {
    const result = evaluate({ commits: [PLAIN_COMMIT], title: "fix: c", body: "", landing });
    assert.equal(result.result, "ok", landing);
    assert.deepEqual(result.findings, []);
    assert.deepEqual(result.signals, []);
  }
});

test("evaluate merge landing needs a marked commit and marks every footer commit", () => {
  const declaredOnly = evaluate({ commits: [PLAIN_COMMIT], title: "fix: c", body: DECLARED_BODY, landing: "merge" });
  assert.equal(declaredOnly.result, "violations");
  assert.deepEqual(codes(declaredOnly), ["violation:commit-unmarked"]);

  const marked = evaluate({ commits: [MARKED_COMMIT], title: "feat: a", body: "", landing: "merge" });
  assert.equal(marked.result, "ok");

  const footerOnly = evaluate({ commits: [FOOTER_COMMIT], title: "feat: b", body: "", landing: "merge" });
  assert.equal(footerOnly.result, "violations");
  assert.deepEqual(codes(footerOnly), ["violation:commit-unmarked", "violation:commit-unmarked"]);

  const markedAndFooter = evaluate({
    commits: [MARKED_COMMIT, FOOTER_COMMIT],
    title: "feat: a",
    body: "",
    landing: "merge",
  });
  assert.deepEqual(codes(markedAndFooter), ["violation:commit-unmarked"]);
  assert.match(markedAndFooter.findings[0].message, /"feat\(x\): b"/);
});

test("evaluate merge landing never reports a title finding", () => {
  const result = evaluate({ commits: [MARKED_COMMIT], title: "feat: a", body: DECLARED_BODY, landing: "merge" });
  assert.equal(result.result, "ok");
  const missing = evaluate({ commits: [MARKED_COMMIT], title: undefined, body: "", landing: "merge" });
  assert.equal(missing.result, "ok");
});

test("evaluate squash landing needs the marker in the title and never reports commit findings", () => {
  const unmarked = evaluate({ commits: [FOOTER_COMMIT], title: "feat: b", body: "", landing: "squash" });
  assert.deepEqual(codes(unmarked), ["violation:title-unmarked"]);
  const marked = evaluate({ commits: [PLAIN_COMMIT], title: "feat!: b", body: DECLARED_BODY, landing: "squash" });
  assert.equal(marked.result, "ok");
  const markedCommitUnmarkedTitle = evaluate({ commits: [MARKED_COMMIT], title: "feat: a", body: "", landing: "squash" });
  assert.deepEqual(codes(markedCommitUnmarkedTitle), ["violation:title-unmarked"]);
});

test("evaluate unknown landing applies both families", () => {
  const both = evaluate({ commits: [PLAIN_COMMIT], title: "fix: c", body: DECLARED_BODY, landing: "unknown" });
  assert.deepEqual(codes(both), ["violation:commit-unmarked", "violation:title-unmarked"]);

  const ok = evaluate({ commits: [MARKED_COMMIT], title: "feat(x)!: a", body: "", landing: "unknown" });
  assert.equal(ok.result, "ok");

  const noTitle = evaluate({ commits: [MARKED_COMMIT], title: undefined, body: "", landing: "unknown" });
  assert.equal(noTitle.result, "unproven");
  assert.deepEqual(codes(noTitle), ["unproven:title-not-supplied"]);

  const nullTitle = evaluate({ commits: [MARKED_COMMIT], title: null, body: "", landing: "unknown" });
  assert.deepEqual(codes(nullTitle), ["unproven:title-not-supplied"]);

  const violationWinsOverUnproven = evaluate({ commits: [PLAIN_COMMIT], title: undefined, body: DECLARED_BODY });
  assert.equal(violationWinsOverUnproven.result, "violations");
  assert.deepEqual(codes(violationWinsOverUnproven), ["violation:commit-unmarked", "unproven:title-not-supplied"]);
});

test("evaluate lists the signals with counts and treats a body footer as a signal", () => {
  const result = evaluate({
    commits: [MARKED_COMMIT, FOOTER_COMMIT, PLAIN_COMMIT],
    title: "feat!: a",
    body: `BREAKING CHANGE: whole\n${DECLARED_BODY}`,
    landing: "squash",
  });
  assert.deepEqual(result.signals, [
    { name: "commit-marker", count: 1 },
    { name: "commit-footer", count: 1 },
    { name: "body-footer" },
    { name: "declared" },
  ]);
  assert.equal(result.commitCount, 3);
  assert.equal(result.breakingCount, 2);
});

test("evaluate with a range error returns the single unproven finding", () => {
  const result = evaluate({ commits: [], title: "feat: a", body: DECLARED_BODY, landing: "merge", rangeError: "gone" });
  assert.equal(result.result, "unproven");
  assert.deepEqual(result.findings, [{ kind: "unproven", code: "range-unavailable", message: "gone" }]);
  assert.deepEqual(result.signals, [{ name: "declared" }]);
});

test("evaluate treats an empty range with a declared body as a signal", () => {
  const result = evaluate({ commits: [], title: "feat: a", body: DECLARED_BODY, landing: "merge" });
  assert.equal(result.result, "violations");
  assert.deepEqual(codes(result), ["violation:commit-unmarked"]);
});

test("evaluate matrix: merge has no title finding, squash has no commit finding", () => {
  const commitSets = [[], [MARKED_COMMIT], [FOOTER_COMMIT], [PLAIN_COMMIT], [MARKED_COMMIT, FOOTER_COMMIT]];
  const bodies = ["", "BREAKING CHANGE: x", DECLARED_BODY];
  const titles = ["feat!: a", "feat: a", undefined];
  for (const commits of commitSets) {
    for (const body of bodies) {
      for (const title of titles) {
        const merge = evaluate({ commits, title, body, landing: "merge" });
        assert.ok(!merge.findings.some((finding) => finding.code.startsWith("title")));
        const squash = evaluate({ commits, title, body, landing: "squash" });
        assert.ok(!squash.findings.some((finding) => finding.code === "commit-unmarked"));
        const unknown = evaluate({ commits, title, body, landing: "unknown" });
        const order = unknown.findings.map((finding) => (finding.code === "commit-unmarked" ? 0 : 1));
        assert.deepEqual(order, [...order].sort());
      }
    }
  }
});

// report --------------------------------------------------------------------------------------------------------

function reportFor(overrides) {
  const evaluation = evaluate({ commits: [PLAIN_COMMIT], title: "fix: c", body: DECLARED_BODY, landing: "unknown" });
  return { ...evaluation, mode: "report-only", landing: "unknown", base: "origin/main", head: "HEAD", ...overrides };
}

test("formatReport prints the header, the signals line and one line per finding", () => {
  const lines = formatReport(reportFor({}));
  assert.equal(
    lines[0],
    'breaking-change guard: violations (mode report-only, landing unknown, range "origin/main".."HEAD", 1 commits, 0 breaking)',
  );
  assert.equal(lines[1], "signals: declared");
  assert.ok(lines[2].startsWith("  violation commit-unmarked: "));
  assert.ok(lines[3].startsWith("  violation title-unmarked: "));
  assert.equal(lines[4], "report-only: exit 0; run with --enforce to fail on findings");
  assert.equal(lines.length, 5);
});

test("formatReport prints the report-only line only in report-only mode with findings", () => {
  assert.ok(!formatReport(reportFor({ mode: "enforce" })).some((line) => line.startsWith("report-only")));
  const ok = evaluate({ commits: [PLAIN_COMMIT], title: "fix: c", body: "", landing: "merge" });
  const lines = formatReport({ ...ok, mode: "report-only", landing: "merge", base: "a", head: "b" });
  assert.equal(lines.length, 2);
  assert.equal(lines[1], "signals: none");
  assert.ok(lines[0].startsWith("breaking-change guard: ok "));
});

test("formatReport quotes untrusted text so no output line starts with two colons", () => {
  const title = "feat: a\n::error::injected";
  const evaluation = evaluate({ commits: [MARKED_COMMIT], title, body: "", landing: "squash" });
  const lines = formatReport({ ...evaluation, mode: "enforce", landing: "squash", base: "a\n::b", head: "HEAD" });
  assert.ok(!lines.some((line) => line.startsWith("::")));
  assert.ok(!lines.some((line) => line.includes("\n")));
  assert.ok(hasLine(lines, String.raw`"feat: a\n::error::injected"`));
  assert.ok(hasLine(lines, String.raw`"a\n::b"`));
});

test("formatReport cuts a long subject to 200 characters inside its quotes", () => {
  const long = "x".repeat(500);
  const commits = [fakeCommit(long, "BREAKING CHANGE: y")];
  const evaluation = evaluate({ commits, title: "feat: t", body: "", landing: "merge" });
  const lines = formatReport({ ...evaluation, mode: "enforce", landing: "merge", base: "a", head: "b" });
  const finding = lines.find((line) => line.includes("xxxx"));
  assert.ok(finding !== undefined);
  assert.ok(finding.includes(`"${"x".repeat(200)}"`));
  assert.ok(!finding.includes("x".repeat(201)));
});

// range collection ----------------------------------------------------------------------------------------------

test("collectCommits returns the non-merge commits newest first with hash, subject and body", () => {
  const repo = makeRepo();
  const first = commit(repo.dir, "feat(x)!: first", "BREAKING CHANGE: first body");
  const second = commit(repo.dir, "fix: second");
  const result = collectCommits({ cwd: repo.dir, base: repo.base, head: "HEAD" });
  assert.equal(result.rangeError, undefined);
  assert.deepEqual(
    result.commits.map((entry) => [entry.hash, entry.subject]),
    [
      [second, "fix: second"],
      [first, "feat(x)!: first"],
    ],
  );
  assert.equal(result.commits[1].footer, true);
  assert.equal(result.commits[1].marked, true);
});

test("collectCommits ignores a merge commit of main into the branch", () => {
  const repo = makeRepo();
  git(repo.dir, ["checkout", "-q", "-b", "feature"]);
  const featureCommit = commit(repo.dir, "feat: on feature", undefined, "feature.txt");
  git(repo.dir, ["checkout", "-q", "-"]);
  const mainCommit = commit(repo.dir, "fix: on main", undefined, "main.txt");
  git(repo.dir, ["checkout", "-q", "feature"]);
  git(repo.dir, [...IDENTITY, "merge", "-q", "--no-ff", "-m", "Merge main into feature", mainCommit]);
  const result = collectCommits({ cwd: repo.dir, base: repo.base, head: "HEAD" });
  assert.deepEqual(result.commits.map((entry) => entry.subject).sort(), ["feat: on feature", "fix: on main"]);
  assert.ok(result.commits.some((entry) => entry.hash === featureCommit));
});

test("collectCommits reports an unresolvable base or head as a range error naming the ref", () => {
  const repo = makeRepo();
  commit(repo.dir, "fix: a");
  const base = collectCommits({ cwd: repo.dir, base: "origin/main", head: "HEAD" });
  assert.deepEqual(base.commits, []);
  assert.match(base.rangeError, /"origin\/main"/);
  assert.match(base.rangeError, /shallow/);
  const head = collectCommits({ cwd: repo.dir, base: repo.base, head: "no-such-head" });
  assert.match(head.rangeError, /"no-such-head"/);
});

test("collectCommits reports a range of 2000 commits as too large", () => {
  const hash = "a".repeat(40);
  const record = (index) => `\x1e${hash}\x1fsubject ${String(index)}\x1f`;
  const recordsOf = (count) => Array.from({ length: count }, (_, index) => record(index)).join("");
  const runWith = (count) => (args) => (args[0] === "log" ? recordsOf(count) : `${hash}\n`);
  const result = collectCommits({ cwd: ".", base: "a", head: "b", run: runWith(2000) });
  assert.deepEqual(result.commits, []);
  assert.match(result.rangeError, /range too large/);
  const fewer = collectCommits({ cwd: ".", base: "a", head: "b", run: runWith(1999) });
  assert.equal(fewer.rangeError, undefined);
  assert.equal(fewer.commits.length, 1999);
});

test("collectCommits passes the log call an argument array with --no-merges and a cap", () => {
  const calls = [];
  const hash = "b".repeat(40);
  collectCommits({
    cwd: ".",
    base: "a",
    head: "b",
    run: (args) => {
      calls.push(args);
      return args[0] === "log" ? "" : `${hash}\n`;
    },
  });
  const log = calls.find((args) => args[0] === "log");
  assert.ok(log.includes("--no-merges"));
  assert.ok(log.includes("--max-count=2000"));
  assert.equal(log.at(-1), `${hash}..${hash}`);
});

// runGuard scenarios --------------------------------------------------------------------------------------------

test("a footer-only breaking commit fails under merge landing with enforce and passes when marked", () => {
  const repo = makeRepo();
  commit(repo.dir, "feat(x): change", "BREAKING CHANGE: the shape changes");
  const failing = guard(repo, [...range(repo), "--merge-method", "merge", "--enforce"]);
  assert.equal(failing.code, 1);
  assert.ok(hasLine(failing.lines, "violation commit-unmarked"));

  const marked = makeRepo();
  commit(marked.dir, "feat(x)!: change", "BREAKING CHANGE: the shape changes");
  const passing = guard(marked, [...range(marked), "--merge-method", "merge", "--enforce"]);
  assert.equal(passing.code, 0);
  assert.ok(passing.lines[0].startsWith("breaking-change guard: ok "));
});

test("a marked range with an unmarked title fails under unknown and squash landing, passes under merge", () => {
  const repo = makeRepo();
  commit(repo.dir, "feat(x)!: change");
  const title = ["--title", "feat(x): change"];
  const unknown = guard(repo, [...range(repo), ...title, "--enforce"]);
  assert.equal(unknown.code, 1);
  assert.ok(hasLine(unknown.lines, "violation title-unmarked"));
  const squash = guard(repo, [...range(repo), ...title, "--merge-method", "squash", "--enforce"]);
  assert.equal(squash.code, 1);
  const merge = guard(repo, [...range(repo), ...title, "--merge-method", "merge", "--enforce"]);
  assert.equal(merge.code, 0);
  const markedTitle = guard(repo, [...range(repo), "--title", "feat(x)!: change", "--enforce"]);
  assert.equal(markedTitle.code, 0);
});

test("a declared pull request with no marked commit fails for every landing", () => {
  const repo = makeRepo();
  commit(repo.dir, "feat(x): change");
  const env = { REALM_PR_JSON: JSON.stringify({ title: "feat(x): change", body: DECLARED_BODY }) };
  for (const landing of ["merge", "squash", "unknown"]) {
    const result = guard(repo, [...range(repo), "--merge-method", landing, "--enforce"], env);
    assert.equal(result.code, 1, landing);
    assert.ok(hasLine(result.lines, "signals: declared"), landing);
  }
});

test("a range with no signal reports ok under enforce too", () => {
  const repo = makeRepo();
  commit(repo.dir, "fix(x): change");
  const result = guard(repo, [...range(repo), "--enforce"]);
  assert.equal(result.code, 0);
  assert.ok(result.lines[0].startsWith("breaking-change guard: ok "));
  assert.equal(result.lines[1], "signals: none");
});

test("report-only exits 0 for every violating shape and says so on the last line", () => {
  const footer = makeRepo();
  commit(footer.dir, "feat(x): change", "BREAKING CHANGE: shape");
  const markedRepo = makeRepo();
  commit(markedRepo.dir, "feat(x)!: change");
  const declaredRepo = makeRepo();
  commit(declaredRepo.dir, "feat(x): change");
  const declaredEnv = { REALM_PR_JSON: JSON.stringify({ title: "feat: c", body: DECLARED_BODY }) };
  const shapes = [
    guard(footer, [...range(footer), "--merge-method", "merge"]),
    guard(markedRepo, [...range(markedRepo), "--title", "feat(x): change"]),
    guard(markedRepo, [...range(markedRepo), "--title", "feat(x): change", "--merge-method", "squash"]),
    guard(declaredRepo, range(declaredRepo), declaredEnv),
  ];
  for (const result of shapes) {
    assert.equal(result.code, 0);
    assert.ok(result.lines.some((line) => line.startsWith("  violation")));
    assert.equal(result.lines.at(-1), "report-only: exit 0; run with --enforce to fail on findings");
  }
});

test("a missing base is range-unavailable: exit 1 under enforce, exit 0 in report-only", () => {
  const repo = makeRepo();
  commit(repo.dir, "feat!: change");
  const enforced = guard(repo, ["--enforce"]);
  assert.equal(enforced.code, 1);
  assert.ok(hasLine(enforced.lines, "unproven range-unavailable"));
  const reported = guard(repo, []);
  assert.equal(reported.code, 0);
  assert.ok(hasLine(reported.lines, "unproven range-unavailable"));
});

test("a title holding a newline and two colons produces no line starting with two colons", () => {
  const repo = makeRepo();
  commit(repo.dir, "feat!: change");
  const result = guard(repo, [...range(repo), "--title", "feat: x\n::error::injected", "--merge-method", "squash"]);
  assert.ok(result.lines.length > 0);
  assert.ok(!result.lines.some((line) => line.startsWith("::")));
});

test("an empty range with a declared body is checked and a null body is no signal", () => {
  const repo = makeRepo();
  const declared = guard(repo, [...range(repo), "--merge-method", "merge", "--enforce"], {
    REALM_PR_JSON: JSON.stringify({ title: "t", body: DECLARED_BODY }),
  });
  assert.equal(declared.code, 1);
  const nullBody = guard(repo, [...range(repo), "--enforce"], { REALM_PR_JSON: JSON.stringify({ title: "t", body: null }) });
  assert.equal(nullBody.code, 0);
});

test("CRLF in a commit body still reads as a footer", () => {
  const repo = makeRepo();
  commit(repo.dir, "feat(x): change", "Summary\r\n\r\nBREAKING CHANGE: crlf\r\n");
  const result = guard(repo, [...range(repo), "--merge-method", "merge", "--enforce"]);
  assert.equal(result.code, 1);
});

test("a footer in the middle of a paragraph is not a signal", () => {
  const repo = makeRepo();
  commit(repo.dir, "feat(x): change", "This mentions BREAKING CHANGE: in the middle of a sentence.");
  const result = guard(repo, [...range(repo), "--enforce"]);
  assert.equal(result.code, 0);
  assert.equal(result.lines[1], "signals: none");
});

test("a title with leading whitespace is not conventional and does not satisfy the marker", () => {
  const repo = makeRepo();
  commit(repo.dir, "feat!: change");
  const result = guard(repo, [...range(repo), "--title", " feat!: change", "--merge-method", "squash", "--enforce"]);
  assert.equal(result.code, 1);
});

// inputs --------------------------------------------------------------------------------------------------------

test("readPullRequest reads the GitHub event shape and the flat shape", () => {
  const event = readPullRequest(
    JSON.stringify({ pull_request: { title: "t", body: "b", base: { sha: "1" }, head: { sha: "2" } } }),
  );
  assert.deepEqual(event, { title: "t", body: "b", base: "1", head: "2", mergeMethod: undefined });
  const flat = readPullRequest(JSON.stringify({ title: "t", body: "b", base: "x", head: "y", merge_method: "squash" }));
  assert.deepEqual(flat, { title: "t", body: "b", base: "x", head: "y", mergeMethod: "squash" });
  const empty = readPullRequest("{}");
  assert.equal(empty.title, undefined);
  assert.equal(empty.body, "");
  assert.equal(readPullRequest('{"title":null,"body":null}').title, undefined);
});

test("readPullRequest refuses wrong types, bad JSON and oversize text", () => {
  assert.throws(() => readPullRequest('{"title":1}'), /title must be a string/);
  assert.throws(() => readPullRequest('{"body":{}}'), /body must be a string/);
  assert.throws(() => readPullRequest('{"pull_request":{"base":"x"}}'), /base must be an object/);
  assert.throws(() => readPullRequest("{"), /does not parse/);
  assert.throws(() => readPullRequest("[]"), /must be an object/);
  assert.throws(() => readPullRequest(JSON.stringify({ body: "x".repeat(1048577) })), /larger than/);
});

test("the pull request fields come from REALM_PR_JSON, which wins over the event file", () => {
  const repo = makeRepo();
  commit(repo.dir, "feat!: change");
  const eventFile = path.join(tempDir("breaking-guard-event-"), "event.json");
  writeFileSync(eventFile, JSON.stringify({ pull_request: { title: "feat: from the file", body: "" } }));
  const fromFile = guard(repo, [...range(repo), "--merge-method", "squash", "--enforce"], {
    GITHUB_EVENT_NAME: "pull_request",
    GITHUB_EVENT_PATH: eventFile,
  });
  assert.equal(fromFile.code, 1);
  assert.ok(hasLine(fromFile.lines, "from the file"));
  const inlineWins = guard(repo, [...range(repo), "--merge-method", "squash", "--enforce"], {
    GITHUB_EVENT_NAME: "pull_request",
    GITHUB_EVENT_PATH: eventFile,
    REALM_PR_JSON: JSON.stringify({ title: "feat!: from the inline JSON" }),
  });
  assert.equal(inlineWins.code, 0);
});

test("the event file is not read when GITHUB_EVENT_NAME is not pull_request", () => {
  const repo = makeRepo();
  commit(repo.dir, "feat!: change");
  const result = guard(repo, [...range(repo), "--merge-method", "squash", "--enforce"], {
    GITHUB_EVENT_NAME: "push",
    GITHUB_EVENT_PATH: path.join(repo.dir, "does-not-exist.json"),
  });
  assert.equal(result.code, 1);
  assert.ok(hasLine(result.lines, "title-not-supplied"));
});

test("the base, head and merge method come from the JSON and a flag overrides the JSON title", () => {
  const repo = makeRepo();
  commit(repo.dir, "feat!: change");
  const env = {
    REALM_PR_JSON: JSON.stringify({ title: "feat: unmarked", base: repo.base, head: "HEAD", merge_method: "squash" }),
  };
  const fromJson = guard(repo, ["--enforce"], env);
  assert.equal(fromJson.code, 1);
  assert.ok(hasLine(fromJson.lines, "landing squash"));
  const overridden = guard(repo, ["--enforce", "--title", "feat!: marked"], env);
  assert.equal(overridden.code, 0);
});

test("a body footer in the JSON is a signal", () => {
  const repo = makeRepo();
  commit(repo.dir, "fix: change");
  const result = guard(repo, [...range(repo), "--merge-method", "merge", "--enforce"], {
    REALM_PR_JSON: JSON.stringify({ title: "fix: change", body: "BREAKING CHANGE: the whole thing" }),
  });
  assert.equal(result.code, 1);
  assert.ok(hasLine(result.lines, "signals: body-footer"));
});

test("an oversize event file is an input error", () => {
  const repo = makeRepo();
  const eventFile = path.join(tempDir("breaking-guard-big-"), "event.json");
  writeFileSync(eventFile, JSON.stringify({ title: "x".repeat(1048577) }));
  const result = guard(repo, range(repo), { GITHUB_EVENT_NAME: "pull_request", GITHUB_EVENT_PATH: eventFile });
  assert.equal(result.code, 2);
  assert.match(result.errors[0], /^breaking-change guard: .*larger than/);
});

test("input errors exit 2 in report-only and enforce mode", () => {
  const repo = makeRepo();
  commit(repo.dir, "feat!: change");
  const cases = [
    [["--bogus"], {}],
    [["--merge-method", "rebase"], {}],
    [["--base=-x"], {}],
    [["--head=-x"], {}],
    [["--base="], {}],
    [[], { REALM_PR_JSON: "{" }],
    [[], { REALM_PR_JSON: '{"title":1}' }],
    [[], { REALM_PR_JSON: '{"merge_method":"nope"}' }],
    [["positional"], {}],
  ];
  for (const [argv, env] of cases) {
    for (const extra of [[], ["--enforce"]]) {
      const result = guard(repo, [...argv, ...extra], env);
      assert.equal(result.code, 2, JSON.stringify([argv, env, extra]));
      assert.equal(result.errors.length, 1);
      assert.ok(result.errors[0].startsWith("breaking-change guard: "));
      assert.equal(result.lines.length, 0);
    }
  }
});

test("REALM_BREAKING_GUARD=enforce behaves as the flag and any other value is report-only", () => {
  const repo = makeRepo();
  commit(repo.dir, "feat(x)!: change");
  const argv = [...range(repo), "--title", "feat: unmarked"];
  assert.equal(guard(repo, argv, { REALM_BREAKING_GUARD: "enforce" }).code, 1);
  assert.equal(guard(repo, argv, { REALM_BREAKING_GUARD: "report" }).code, 0);
  assert.equal(guard(repo, argv, { REALM_BREAKING_GUARD: "" }).code, 0);
});

test("--help prints the usage and exits 0", () => {
  const repo = makeRepo();
  const result = guard(repo, ["--help"]);
  assert.equal(result.code, 0);
  assert.ok(result.lines[0].startsWith("usage: "));
});

// program run ---------------------------------------------------------------------------------------------------

test("the module run as a program prints the header line and exits with the guard code", () => {
  const repo = makeRepo();
  commit(repo.dir, "feat!: change");
  const env = gitEnv(repo.dir);
  const reportOnly = execFileSync(process.execPath, [SCRIPT, ...range(repo), "--title", "feat: unmarked"], {
    cwd: repo.dir,
    env,
    encoding: "utf8",
  });
  assert.ok(reportOnly.split("\n")[0].startsWith("breaking-change guard: violations "));

  assert.throws(
    () => execFileSync(process.execPath, [SCRIPT, ...range(repo), "--title", "feat: unmarked", "--enforce"], {
      cwd: repo.dir,
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }),
    (error) => error.status === 1 && error.stdout.split("\n")[0].startsWith("breaking-change guard: violations "),
  );

  assert.throws(
    () => execFileSync(process.execPath, [SCRIPT, "--bogus"], { cwd: repo.dir, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }),
    (error) => error.status === 2 && error.stderr.startsWith("breaking-change guard: "),
  );
});

// parity with the changelog generator ---------------------------------------------------------------------------

const SEED_CHANGELOG = [
  "# Changelog",
  "",
  "## [Unreleased]",
  "",
  "## [0.0.1] - 2026-01-01",
  "",
  "### Added",
  "- Seed entry",
  "",
].join("\n");

// kept: whether the changelog generator lists the subject. marked: whether the guard reads it as breaking.
const PARITY_ROWS = [
  { subject: "chore(planning)!: kept bang", kept: true, marked: true },
  { subject: "chore(planning): dropped plain", kept: false, marked: false },
  { subject: "docs(planning)!: kept docs bang", kept: true, marked: true },
  { subject: "docs(planning): dropped docs plain", kept: false, marked: false },
  { subject: "feat(planning)!: kept feat bang", kept: true, marked: true },
  { subject: "feat(planning): dropped feat plain", kept: false, marked: false },
  { subject: "Chore(planning)!: kept nonconforming", kept: true, marked: false },
  { subject: "chore(planning)!kept no colon", kept: true, marked: false },
];

test("the guard's marker decision equals whether the changelog generator keeps a planning-scoped commit", () => {
  const repo = makeRepo();
  for (const row of PARITY_ROWS) {
    commit(repo.dir, row.subject);
  }
  writeFileSync(path.join(repo.dir, "CHANGELOG.md"), SEED_CHANGELOG);
  generateChangelog({ root: repo.dir, version: "0.0.2", date: "2026-01-02" });
  const generated = readFileSync(path.join(repo.dir, "CHANGELOG.md"), "utf8");
  for (const row of PARITY_ROWS) {
    const keptByGenerator = generated.includes(`- ${row.subject} (`);
    assert.equal(keptByGenerator, row.kept, `generator: ${row.subject}`);
    const markedByGuard = parseHeader(row.subject)?.breaking === true;
    assert.equal(markedByGuard, row.marked, `guard: ${row.subject}`);
    if (row.subject.includes("planning") && parseHeader(row.subject) !== null) {
      assert.equal(markedByGuard, keptByGenerator, `parity: ${row.subject}`);
    } else {
      assert.equal(parseHeader(row.subject), null, `nonconforming: ${row.subject}`);
      assert.equal(keptByGenerator, true, `nonconforming kept: ${row.subject}`);
    }
  }
});

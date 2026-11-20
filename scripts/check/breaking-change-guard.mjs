// Breaking-change marker guard (DEBT-02, D-42-01). Builtins only.
//
// The release notes list a change as breaking only through the `!` marker in a commit subject, or in the title of a
// squash-merged pull request (scripts/release/changelog.mjs). This script makes that rule a checkable statement: it
// reads a pull request (title, body, base, head, merge method) and the non-merge commits of the range, derives the
// breaking signals (commit-marker, commit-footer, body-footer, declared), applies the rule of the landing (merge,
// squash, unknown) and prints one line per finding. A range with no signal has nothing to check and reports ok.
//
// Usage:
//   node scripts/check/breaking-change-guard.mjs [--base REF] [--head REF] [--title TEXT]
//        [--merge-method merge|squash|unknown] [--enforce]
//   Environment: REALM_PR_JSON (inline JSON of the pull request), else the event file named by GITHUB_EVENT_PATH
//   when GITHUB_EVENT_NAME is pull_request; REALM_BREAKING_GUARD=enforce is the same as --enforce.
//
// Exit codes: 0 (ok, or any findings in report-only mode, which is the default), 1 (a violation or an unproven
// finding with --enforce), 2 (a usage or input error, in both modes).
//
// It is not part of check:gates or check:docs: the CI checkout has one commit and no pull request context, so a guard
// there would either always report an unavailable range or fail every run. It checks the inputs it is given, not the
// commit that reaches main.
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";

// The exact header pattern of scripts/release/changelog.mjs (CONVENTIONAL_HEADER); the parity test pins the two.
export const HEADER_PATTERN = /^([a-z]+)(?:\(([^)]*)\))?(!)?:/;
const FOOTER_PATTERN = /^BREAKING[ -]CHANGE: \S/m;
const DECLARED_PATTERN = /^[ \t]*[-*][ \t]+\[[xX]\][ \t]+Breaking change\b/m;

const LANDINGS = ["merge", "squash", "unknown"];
const MAX_QUOTED = 200;
const MAX_COMMITS = 2000;
const MAX_JSON_BYTES = 1048576;
const GIT_TIMEOUT_MS = 30000;
const GIT_MAX_BUFFER = 16 * 1024 * 1024;
const RECORD_SEPARATOR = "\x1e";
const FIELD_SEPARATOR = "\x1f";
const DEFAULT_BASE = "origin/main";
const DEFAULT_HEAD = "HEAD";

const USAGE = [
  "usage: node scripts/check/breaking-change-guard.mjs [--base REF] [--head REF] [--title TEXT]",
  "         [--merge-method merge|squash|unknown] [--enforce]",
  "  Pull request fields also come from REALM_PR_JSON or, for a pull_request event, the file named by",
  "  GITHUB_EVENT_PATH. REALM_BREAKING_GUARD=enforce is the same as --enforce.",
  "  Report-only by default (exit 0); with --enforce a violation or unproven finding exits 1; an input error exits 2.",
];

class InputError extends Error {}

// Untrusted text (a title, a body line, a subject, a ref) is printed only as a JSON string literal cut to 200
// characters, so a newline in it can never start a line of its own in the report.
function quote(text) {
  return JSON.stringify(String(text).slice(0, MAX_QUOTED));
}

export function parseHeader(subject) {
  const match = HEADER_PATTERN.exec(subject);
  if (match === null) {
    return null;
  }
  return { type: match[1], scope: match[2], breaking: match[3] !== undefined };
}

export function hasBreakingFooter(text) {
  return FOOTER_PATTERN.test(text);
}

export function isDeclared(body) {
  return DECLARED_PATTERN.test(body);
}

export function classifyCommit({ hash, subject, body }) {
  const marked = parseHeader(subject)?.breaking === true;
  const footer = hasBreakingFooter(body);
  return { hash, subject, body, marked, footer, breaking: marked || footer };
}

function signalsOf(commits, body) {
  const signals = [];
  const marked = commits.filter((commit) => commit.marked).length;
  const footers = commits.filter((commit) => commit.footer).length;
  if (marked > 0) {
    signals.push({ name: "commit-marker", count: marked });
  }
  if (footers > 0) {
    signals.push({ name: "commit-footer", count: footers });
  }
  if (hasBreakingFooter(body)) {
    signals.push({ name: "body-footer" });
  }
  if (isDeclared(body)) {
    signals.push({ name: "declared" });
  }
  return signals;
}

function commitFindings(commits) {
  const findings = [];
  if (!commits.some((commit) => commit.marked)) {
    findings.push({
      kind: "violation",
      code: "commit-unmarked",
      message: "no commit subject in the range carries the ! marker",
    });
  }
  for (const commit of commits) {
    if (commit.footer && !commit.marked) {
      findings.push({
        kind: "violation",
        code: "commit-unmarked",
        message: `commit ${quote(commit.hash.slice(0, 7))} ${quote(commit.subject)} has a BREAKING CHANGE footer but no ! marker`,
      });
    }
  }
  return findings;
}

function titleFindings(title) {
  if (title === undefined || title === null) {
    return [{ kind: "unproven", code: "title-not-supplied", message: "the pull request title was not supplied" }];
  }
  if (parseHeader(title)?.breaking === true) {
    return [];
  }
  return [
    {
      kind: "violation",
      code: "title-unmarked",
      message: `the pull request title ${quote(title)} does not carry the ! marker`,
    },
  ];
}

// Pure. `commits` come from classifyCommit; `landing` is merge, squash or unknown; a `rangeError` means the range
// could not be read, which is unproven and stops the evaluation (the signals of the body are still listed).
export function evaluate({ commits, title, body, landing = "unknown", rangeError }) {
  const text = body ?? "";
  const signals = signalsOf(rangeError === undefined ? commits : [], text);
  const base = {
    signals,
    commitCount: commits.length,
    breakingCount: commits.filter((commit) => commit.breaking).length,
  };
  if (rangeError !== undefined) {
    const findings = [{ kind: "unproven", code: "range-unavailable", message: rangeError }];
    return { ...base, findings, result: "unproven" };
  }
  if (signals.length === 0) {
    return { ...base, findings: [], result: "ok" };
  }
  const findings = [];
  if (landing === "merge" || landing === "unknown") {
    findings.push(...commitFindings(commits));
  }
  if (landing === "squash" || landing === "unknown") {
    findings.push(...titleFindings(title));
  }
  let result = "ok";
  if (findings.some((finding) => finding.kind === "violation")) {
    result = "violations";
  } else if (findings.length > 0) {
    result = "unproven";
  }
  return { ...base, findings, result };
}

function signalLine(signals) {
  if (signals.length === 0) {
    return "signals: none";
  }
  const names = signals.map((signal) => (signal.count === undefined ? signal.name : `${signal.name} (${signal.count})`));
  return `signals: ${names.join(", ")}`;
}

// `report` is the evaluate result plus mode, landing, base and head.
export function formatReport(report) {
  const { result, signals, findings, mode, landing, base, head, commitCount, breakingCount } = report;
  const lines = [
    `breaking-change guard: ${result} (mode ${mode}, landing ${landing}, range ${quote(base)}..${quote(head)}, ${String(commitCount)} commits, ${String(breakingCount)} breaking)`,
    signalLine(signals),
  ];
  for (const finding of findings) {
    lines.push(`  ${finding.kind} ${finding.code}: ${finding.message}`);
  }
  if (mode === "report-only" && findings.length > 0) {
    lines.push("report-only: exit 0; run with --enforce to fail on findings");
  }
  return lines;
}

function runGit(args, cwd) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: GIT_MAX_BUFFER,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function firstLine(text) {
  return text.split("\n", 1)[0] ?? "";
}

function parseLog(output) {
  const commits = [];
  for (const record of output.split(RECORD_SEPARATOR)) {
    if (record === "") {
      continue;
    }
    const first = record.indexOf(FIELD_SEPARATOR);
    const second = record.indexOf(FIELD_SEPARATOR, first + 1);
    if (first === -1 || second === -1) {
      throw new Error("unexpected git log output");
    }
    commits.push(
      classifyCommit({
        hash: record.slice(0, first),
        subject: record.slice(first + 1, second),
        body: record.slice(second + 1),
      }),
    );
  }
  return commits;
}

function resolveRef(run, cwd, ref) {
  try {
    return run(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], cwd).trim();
  } catch (error) {
    const detail = typeof error.status === "number" ? "" : `: ${quote(firstLine(String(error.message)))}`;
    throw new Error(`cannot resolve ${quote(ref)} to a commit (a shallow checkout may lack it)${detail}`, { cause: error });
  }
}

// The non-merge commits of base..head, newest first. `run` is a seam for tests; it defaults to git itself.
export function collectCommits({ cwd, base, head, run = runGit }) {
  try {
    const from = resolveRef(run, cwd, base);
    const to = resolveRef(run, cwd, head);
    const output = run(
      ["log", "--no-merges", `--max-count=${String(MAX_COMMITS)}`, "--format=%x1e%H%x1f%s%x1f%b", `${from}..${to}`],
      cwd,
    );
    const commits = parseLog(output);
    if (commits.length >= MAX_COMMITS) {
      return { commits: [], rangeError: `range too large to read (${String(MAX_COMMITS)} commits or more)` };
    }
    return { commits };
  } catch (error) {
    return { commits: [], rangeError: firstLine(String(error.message)) };
  }
}

function optionalString(value, name) {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new InputError(`pull request field ${name} must be a string`);
  }
  return value;
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nestedSha(value, name) {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!isRecord(value)) {
    throw new InputError(`pull request field ${name} must be an object`);
  }
  return optionalString(value.sha, `${name}.sha`);
}

// Accepts the GitHub event shape (pull_request.title, .body, .base.sha, .head.sha) and the flat shape (title, body,
// base, head, merge_method). A missing or null title or body is undefined; a field of the wrong type is an input error.
export function readPullRequest(text) {
  if (Buffer.byteLength(text) > MAX_JSON_BYTES) {
    throw new InputError(`pull request JSON is larger than ${String(MAX_JSON_BYTES)} bytes`);
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new InputError(`pull request JSON does not parse: ${quote(firstLine(String(error.message)))}`, { cause: error });
  }
  if (!isRecord(parsed)) {
    throw new InputError("pull request JSON must be an object");
  }
  if (parsed.pull_request !== undefined) {
    const event = parsed.pull_request;
    if (!isRecord(event)) {
      throw new InputError("pull request field pull_request must be an object");
    }
    return {
      title: optionalString(event.title, "pull_request.title"),
      body: optionalString(event.body, "pull_request.body") ?? "",
      base: nestedSha(event.base, "pull_request.base"),
      head: nestedSha(event.head, "pull_request.head"),
      mergeMethod: undefined,
    };
  }
  return {
    title: optionalString(parsed.title, "title"),
    body: optionalString(parsed.body, "body") ?? "",
    base: optionalString(parsed.base, "base"),
    head: optionalString(parsed.head, "head"),
    mergeMethod: optionalString(parsed.merge_method, "merge_method"),
  };
}

function readEventFile(path) {
  let size;
  try {
    size = statSync(path).size;
  } catch (error) {
    throw new InputError(`cannot read the pull request event file: ${quote(firstLine(String(error.message)))}`, { cause: error });
  }
  if (size > MAX_JSON_BYTES) {
    throw new InputError(`pull request JSON is larger than ${String(MAX_JSON_BYTES)} bytes`);
  }
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    throw new InputError(`cannot read the pull request event file: ${quote(firstLine(String(error.message)))}`, { cause: error });
  }
}

function pullRequestFromEnvironment(env) {
  const inline = env.REALM_PR_JSON;
  if (inline !== undefined && inline !== "") {
    return readPullRequest(inline);
  }
  const eventPath = env.GITHUB_EVENT_PATH;
  if (env.GITHUB_EVENT_NAME === "pull_request" && eventPath !== undefined && eventPath !== "") {
    return readPullRequest(readEventFile(eventPath));
  }
  return { title: undefined, body: "", base: undefined, head: undefined, mergeMethod: undefined };
}

function checkRef(value, name) {
  if (typeof value !== "string" || value === "" || value.startsWith("-")) {
    throw new InputError(`${name} must be a non-empty git ref that does not start with "-", got ${quote(value)}`);
  }
  return value;
}

function parseFlags(argv) {
  try {
    return parseArgs({
      args: argv,
      options: {
        base: { type: "string" },
        head: { type: "string" },
        title: { type: "string" },
        "merge-method": { type: "string" },
        enforce: { type: "boolean" },
        help: { type: "boolean" },
      },
      strict: true,
    }).values;
  } catch (error) {
    throw new InputError(firstLine(String(error.message)), { cause: error });
  }
}

function buildOptions(argv, env) {
  const flags = parseFlags(argv);
  if (flags.help === true) {
    return { help: true };
  }
  const pullRequest = pullRequestFromEnvironment(env);
  const landing = flags["merge-method"] ?? pullRequest.mergeMethod ?? "unknown";
  if (!LANDINGS.includes(landing)) {
    throw new InputError(`merge method must be one of ${LANDINGS.join(", ")}, got ${quote(landing)}`);
  }
  return {
    help: false,
    mode: flags.enforce === true || env.REALM_BREAKING_GUARD === "enforce" ? "enforce" : "report-only",
    landing,
    base: checkRef(flags.base ?? pullRequest.base ?? DEFAULT_BASE, "base"),
    head: checkRef(flags.head ?? pullRequest.head ?? DEFAULT_HEAD, "head"),
    title: flags.title ?? pullRequest.title,
    body: pullRequest.body,
  };
}

// Returns the exit code. `out` receives report lines, `err` the one-line input error. The environment is read by the
// caller and passed in; nothing here reads process state.
export function runGuard({ argv, env, cwd, out, err = out }) {
  let options;
  try {
    options = buildOptions(argv, env);
  } catch (error) {
    if (error instanceof InputError) {
      err(`breaking-change guard: ${error.message}`);
      return 2;
    }
    throw error;
  }
  if (options.help) {
    for (const line of USAGE) {
      out(line);
    }
    return 0;
  }
  const { commits, rangeError } = collectCommits({ cwd, base: options.base, head: options.head });
  const evaluation = evaluate({ commits, title: options.title, body: options.body, landing: options.landing, rangeError });
  for (const line of formatReport({ ...evaluation, ...options })) {
    out(line);
  }
  return options.mode === "enforce" && evaluation.result !== "ok" ? 1 : 0;
}

function isEntrypoint() {
  return process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
}

if (isEntrypoint()) {
  process.exitCode = runGuard({
    argv: process.argv.slice(2),
    env: process.env,
    cwd: process.cwd(),
    out: console.log,
    err: console.error,
  });
}

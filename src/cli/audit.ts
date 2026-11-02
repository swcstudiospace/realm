// realm audit verify (OBS-01, D-1702; P17 checkpoints). Checks the hash chain of one audit file (--file), of one
// session's file (--session), or of every <stateDir>/audit/*.jsonl (no selector), with optional pins held outside
// the log:
//
//   realm audit verify [--file <path> | --session <id>] [--head <seq>:<sha256>] [--anchor <record.json>]
//
// --head names a line that must still exist, so a truncated tail is caught. --anchor reads a realm anchor record
// (the record itself, or a realm anchor output whose `record` field holds it) and checks that the log's first
// lineCount lines still hash to its root; lines appended after them are allowed. The pins apply to one file, so
// they need --file or --session. Exit 0: every file verified. 1: a chain, head or anchor check failed, a file is
// missing, a symbolic link, not a regular file or unreadable, or there is no file to verify. 2: usage (a
// conflicting or malformed selector or pin, including a record that is not an anchor record). Paths are never
// printed; each failure names the session and the line, or the anchor's line count.

import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import {
  checkAuditFile,
  parseAuditCheckpoint,
  type AnchorCheck,
  type AuditCheckOptions,
  type AuditCheckReason,
  type ChainBreakReason,
} from "../audit/chain.js";
import { parseAnchorRecord, type AnchorMismatch, type AnchorRecord } from "../audit/anchor.js";
import { isSessionId } from "../session/paths.js";

const USAGE =
  "realm audit verify: usage: realm audit verify [--file <path> | --session <id>] [--head <seq>:<sha256>] [--anchor <record.json>]";
const ANCHOR_USAGE =
  "realm audit verify: bad-anchor: --anchor expects a realm anchor record {version, sessionId, lineCount, rootSha256, createdAt}, or a realm anchor output whose record field is one";
const NO_STATE_DIR =
  "realm audit verify: cannot resolve a state directory (the realm config file under an absolute XDG_CONFIG_HOME or HOME must be present and valid)";
const NO_FILE = "realm audit verify: no audit file to verify";
const AUDIT_SUFFIX = ".jsonl";

export interface AuditCommandResult {
  readonly exitCode: 0 | 1 | 2;
  readonly stdout: string;
  readonly stderr: string;
}

type Selector =
  | { readonly kind: "file"; readonly file: string }
  | { readonly kind: "session"; readonly sessionId: string }
  | { readonly kind: "all" };

interface AuditVerifyArgs {
  readonly selector: Selector;
  // "<seq>:<sha256>", already validated.
  readonly head: string | undefined;
  readonly anchorFile: string | undefined;
}

interface Target {
  readonly sessionId: string;
  readonly file: string;
}

type FileFailure = "missing" | "symlink" | "nonregular" | "unreadable";

const FAILURE_TEXT: Record<FileFailure, string> = {
  missing: "audit file is missing",
  symlink: "audit file is a symbolic link; refusing to follow it",
  nonregular: "audit file is not a regular file",
  unreadable: "audit file cannot be read",
};

const linkBreak =
  (reason: ChainBreakReason) =>
  (line: number): string =>
    line === 1
      ? `line 1 does not chain (${reason})`
      : `line ${String(line)} does not chain to line ${String(line - 1)} (${reason})`;

const BREAK_TEXT: Record<ChainBreakReason, (line: number) => string> = {
  "prev-mismatch": linkBreak("prev-mismatch"),
  "seq-gap": linkBreak("seq-gap"),
  "seq-regress": linkBreak("seq-regress"),
  "bad-chain-start": (line) => `line ${String(line)} does not start the chain (bad-chain-start)`,
  "unchained-line": (line) => `line ${String(line)} is not a chained line (unchained-line)`,
  "line-too-long": (line) => `line ${String(line)} exceeds the line bound (line-too-long)`,
  "prefix-changed": (line) => `line ${String(line)} changed after the head checkpoint (prefix-changed)`,
  "tail-loss": (line) => `log ends at line ${String(line)}, before the head checkpoint (tail-loss)`,
};

type AnchorFailure = Pick<AnchorCheck, "lines" | "lineCount">;

const ANCHOR_TEXT: Record<AnchorMismatch, (anchor: AnchorFailure) => string> = {
  "shorter-log": ({ lines, lineCount }) =>
    `log has ${String(lines)} line(s), fewer than the ${String(lineCount)} the anchor covers (shorter-log)`,
  "prefix-changed": ({ lineCount }) =>
    `the anchored prefix of ${String(lineCount)} line(s) changed (prefix-changed)`,
};

interface FileReport {
  readonly sessionId: string;
  readonly ok: boolean;
  readonly failure?: FileFailure;
  readonly lines?: number;
  readonly chainedLines?: number;
  readonly unprotected?: number;
  readonly unparsedLines?: readonly number[];
  readonly tornTail?: boolean;
  readonly head?: { readonly seq: number; readonly lineSha256: string };
  readonly broken?: { readonly line: number; readonly reason: ChainBreakReason };
  readonly anchor?: AnchorCheck;
}

interface FileOutcome {
  readonly report: FileReport;
  readonly stderr: string;
}

type Loaded<T> = { readonly value: T } | { readonly refusal: AuditCommandResult };

// The entry point. resolveStateDir runs only for --session and the selector-less form, so --file never reads the
// realm config. It returns undefined when the config is absent or invalid.
export function runAuditCommand(
  words: readonly string[],
  resolveStateDir: () => string | undefined,
): AuditCommandResult {
  const args = parseAuditVerifyArgs(words);
  if (args === undefined) {
    return { exitCode: 2, stdout: "", stderr: `${USAGE}\n` };
  }
  let targets: readonly Target[];
  if (args.selector.kind === "file") {
    const stem = basename(args.selector.file, AUDIT_SUFFIX);
    targets = [{ sessionId: isSessionId(stem) ? stem : "file", file: args.selector.file }];
  } else {
    const stateDir = resolveStateDir();
    if (stateDir === undefined) {
      return { exitCode: 2, stdout: "", stderr: `${NO_STATE_DIR}\n` };
    }
    const auditDir = join(stateDir, "audit");
    targets =
      args.selector.kind === "session"
        ? [{ sessionId: args.selector.sessionId, file: join(auditDir, `${args.selector.sessionId}${AUDIT_SUFFIX}`) }]
        : auditFilesIn(auditDir);
  }
  let anchor: AnchorRecord | undefined;
  if (args.anchorFile !== undefined) {
    const loaded = loadAnchor(args.anchorFile);
    if ("refusal" in loaded) {
      return loaded.refusal;
    }
    anchor = loaded.value;
  }
  const pins: AuditCheckOptions = {
    ...(args.head === undefined ? {} : { head: args.head }),
    ...(anchor === undefined ? {} : { anchor }),
  };
  if (targets.length === 0) {
    return { exitCode: 1, stdout: `${JSON.stringify({ ok: false, files: [] })}\n`, stderr: `${NO_FILE}\n` };
  }
  const outcomes = targets.map((target) => verifyOne(target, pins));
  const ok = outcomes.every((outcome) => outcome.report.ok);
  return {
    exitCode: ok ? 0 : 1,
    stdout: `${JSON.stringify({ ok, files: outcomes.map((outcome) => outcome.report) })}\n`,
    stderr: outcomes.map((outcome) => outcome.stderr).join(""),
  };
}

// Accepts --file or --session (not both), each at most once, plus --head and --anchor (each at most once), and
// nothing else. The pins need one named file, so the selector-less form refuses them. Undefined for any other shape.
function parseAuditVerifyArgs(words: readonly string[]): AuditVerifyArgs | undefined {
  if (words[0] !== "verify") {
    return undefined;
  }
  let file: string | undefined;
  let sessionId: string | undefined;
  let head: string | undefined;
  let anchorFile: string | undefined;
  for (let index = 1; index < words.length; index += 2) {
    const flag = words[index];
    const value = words[index + 1];
    if (value === undefined || value.length === 0) {
      return undefined;
    }
    if (flag === "--file" && file === undefined) {
      file = value;
    } else if (flag === "--session" && sessionId === undefined) {
      sessionId = value;
    } else if (flag === "--head" && head === undefined) {
      head = value;
    } else if (flag === "--anchor" && anchorFile === undefined) {
      anchorFile = value;
    } else {
      return undefined;
    }
  }
  if (file !== undefined && sessionId !== undefined) {
    return undefined;
  }
  if (sessionId !== undefined && !isSessionId(sessionId)) {
    return undefined;
  }
  const selector: Selector =
    file !== undefined ? { kind: "file", file } : sessionId !== undefined ? { kind: "session", sessionId } : { kind: "all" };
  if (selector.kind === "all" && (head !== undefined || anchorFile !== undefined)) {
    return undefined;
  }
  if (head !== undefined && parseAuditCheckpoint(head) === undefined) {
    return undefined;
  }
  return { selector, head, anchorFile };
}

// Every <stateDir>/audit/*.jsonl in name order. A missing or unreadable audit directory has no files to verify.
function auditFilesIn(auditDir: string): Target[] {
  let names: string[];
  try {
    names = readdirSync(auditDir);
  } catch {
    return [];
  }
  return names
    .filter((name) => name.endsWith(AUDIT_SUFFIX))
    .sort()
    .map((name) => ({ sessionId: name.slice(0, -AUDIT_SUFFIX.length), file: join(auditDir, name) }));
}

// Reads the anchor record. Unreadable is an I/O failure (exit 1); content that is not an anchor record, bare or as the
// `record` field of a realm anchor output, is usage (exit 2, reason bad-anchor).
function loadAnchor(file: string): Loaded<AnchorRecord> {
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    return { refusal: { exitCode: 1, stdout: "", stderr: "realm audit verify: the anchor record cannot be read\n" } };
  }
  const refusal = { exitCode: 2 as const, stdout: "", stderr: `${ANCHOR_USAGE}\n` };
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { refusal };
  }
  const record = parseAnchorRecord(value);
  return record === undefined ? { refusal } : { value: record };
}

// Verifies one file. A missing, symbolic-link, non-regular or unreadable file is an I/O failure, never a pass. The
// symbolic-link check uses lstat, so the file is refused before the checker's O_NOFOLLOW open.
function verifyOne(target: Target, pins: AuditCheckOptions): FileOutcome {
  const label = `realm audit verify: session ${target.sessionId}: `;
  const failure = pathFailure(target.file);
  if (failure !== undefined) {
    return { report: { sessionId: target.sessionId, ok: false, failure }, stderr: `${label}${FAILURE_TEXT[failure]}\n` };
  }
  const check = checkAuditFile(target.file, pins);
  if (check.exitCode === 2) {
    return {
      report: { sessionId: target.sessionId, ok: false, failure: "unreadable" },
      stderr: `${label}${FAILURE_TEXT.unreadable}\n`,
    };
  }
  const broken =
    check.line !== undefined && check.reason !== undefined && isChainBreak(check.reason)
      ? { line: check.line, reason: check.reason }
      : undefined;
  const report: FileReport = {
    sessionId: target.sessionId,
    ok: check.ok,
    lines: check.lines,
    chainedLines: check.chainedLines,
    unprotected: check.unprotected,
    unparsedLines: check.unparsedLines,
    tornTail: check.tornTail,
    ...(check.head === undefined ? {} : { head: { seq: check.head.seq, lineSha256: check.head.hash } }),
    ...(broken === undefined ? {} : { broken }),
    ...(check.anchor === undefined ? {} : { anchor: check.anchor }),
  };
  if (broken !== undefined) {
    return { report, stderr: `${label}${BREAK_TEXT[broken.reason](broken.line)}\n` };
  }
  if (check.anchor !== undefined && !check.anchor.ok) {
    return { report, stderr: `${label}${ANCHOR_TEXT[check.anchor.reason](check.anchor)}\n` };
  }
  if (check.unprotected > 0) {
    return { report, stderr: `${label}${String(check.unprotected)} legacy line(s) are unprotected\n` };
  }
  return { report, stderr: "" };
}

// Classifies the path without following a symbolic link. A missing file is a failure, not an empty log.
function pathFailure(file: string): FileFailure | undefined {
  try {
    const stat = lstatSync(file);
    if (stat.isSymbolicLink()) {
      return "symlink";
    }
    return stat.isFile() ? undefined : "nonregular";
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
    return code === "ENOENT" || code === "ENOTDIR" ? "missing" : "unreadable";
  }
}

function isChainBreak(reason: AuditCheckReason): reason is ChainBreakReason {
  return reason !== "bad-checkpoint" && reason !== "unreadable";
}

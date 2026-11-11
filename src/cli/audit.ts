// realm audit verify (OBS-01, D-1702). Checkpoints are supplied by the operator;
// this command neither authenticates their origin nor fetches anything remotely.

import { closeSync, constants, fstatSync, lstatSync, openSync, readdirSync, readSync } from "node:fs";
import { basename, extname, isAbsolute, join } from "node:path";
import type { AnchorRecord } from "../audit/anchor.js";
import {
  AUDIT_LINE_MAX_BYTES,
  parseAuditAnchor,
  parseAuditHead,
  verifyAuditFile,
  type AuditCheckpointHead,
  type VerifyAuditOptions,
  type VerifyAuditResult,
} from "../audit/chain.js";
import { isSessionId } from "../session/paths.js";

export interface AuditVerifyResult {
  readonly exitCode: 0 | 1 | 2;
  readonly stdout: string;
  readonly stderr: string;
}

export interface AuditVerifyArgs {
  readonly sessionId?: string;
  readonly file?: string;
  readonly anchorFile?: string;
  readonly head?: AuditCheckpointHead;
}

export const AUDIT_VERIFY_USAGE =
  "realm audit verify [--session <id> | --file <absolute path>] [--anchor <record.json>] [--head <seq>:<sha256>]";

// Takes the flags AFTER `audit verify`. No positional-file compatibility path.
export function parseAuditVerifyArgs(args: readonly string[]): AuditVerifyArgs | undefined {
  let sessionId: string | undefined;
  let file: string | undefined;
  let anchorFile: string | undefined;
  let head: AuditCheckpointHead | undefined;
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (value === undefined || value.length === 0 || value.startsWith("--")) {
      return undefined;
    }
    if (flag === "--session" && sessionId === undefined && file === undefined && isSessionId(value) && value.trim() === value) {
      sessionId = value;
    } else if (flag === "--file" && file === undefined && sessionId === undefined && isAbsolute(value)) {
      file = value;
    } else if (flag === "--anchor" && anchorFile === undefined) {
      anchorFile = value;
    } else if (flag === "--head" && head === undefined) {
      head = parseAuditHead(value);
      if (head === undefined) {
        return undefined;
      }
    } else {
      return undefined;
    }
  }
  return {
    ...(sessionId === undefined ? {} : { sessionId }),
    ...(file === undefined ? {} : { file }),
    ...(anchorFile === undefined ? {} : { anchorFile }),
    ...(head === undefined ? {} : { head }),
  };
}

function readAnchor(file: string): AnchorRecord {
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > AUDIT_LINE_MAX_BYTES) {
      throw new Error("anchor is not a bounded regular file");
    }
    const bytes = Buffer.alloc(stat.size + 1);
    let size = 0;
    while (size < bytes.length) {
      const count = readSync(fd, bytes, size, bytes.length - size, null);
      if (count === 0) {
        break;
      }
      size += count;
    }
    if (size > stat.size) {
      throw new Error("anchor changed while being read");
    }
    const value: unknown = JSON.parse(bytes.subarray(0, size).toString("utf8"));
    const anchor = parseAuditAnchor(value);
    if (anchor === undefined) {
      throw new Error("invalid anchor record");
    }
    return anchor;
  } finally {
    closeSync(fd);
  }
}

interface AuditVerificationReport extends VerifyAuditResult {
  readonly unprotected: number;
  readonly suspect?: readonly number[];
}

function reportOf(verified: VerifyAuditResult): AuditVerificationReport {
  const broken = verified.broken;
  return {
    ...verified,
    unprotected: verified.legacyLines,
    ...(broken === undefined ? {} : { suspect: broken.line === 1 ? [1] : [broken.line - 1, broken.line] }),
  };
}

function diagnostics(verified: VerifyAuditResult, options: VerifyAuditOptions): string {
  let text = "";
  if (verified.legacyLines > 0) {
    text += `${String(verified.legacyLines)} legacy line(s) are unprotected by the chain. `;
  }
  if (options.anchor === undefined && options.head === undefined) {
    text += "An unanchored chain cannot detect tail truncation, recomputed history, or forged appends. ";
  } else {
    text += "External checkpoints cover only their retained prefix; their origin is not authenticated here. ";
  }
  const broken = verified.broken;
  if (broken !== undefined) {
    const where = broken.line === 1
      ? `line 1 does not chain (${broken.reason})`
      : `line ${String(broken.line)} does not chain to line ${String(broken.line - 1)} (${broken.reason})`;
    return `${where}. ${text}Check the retained checkpoint and the suspect physical lines.\n`;
  }
  return `${text.trimEnd()}\n`;
}

// Explicit-file library entry, also usable by callers that already resolved a file.
// The selector runner below is the approved CLI contract.
export function runAuditVerify(file: string, options: VerifyAuditOptions = {}): AuditVerifyResult {
  let verified: VerifyAuditResult;
  try {
    verified = verifyAuditFile(file, options);
  } catch {
    return { exitCode: 1, stdout: "", stderr: "realm audit verify: the file or checkpoint cannot be read or validated\n" };
  }
  return {
    exitCode: verified.ok ? 0 : 1,
    stdout: `${JSON.stringify(reportOf(verified))}\n`,
    stderr: `realm audit verify: ${diagnostics(verified, options)}`,
  };
}

interface SelectedFile {
  readonly sessionId: string;
  readonly file: string;
}

function selectedFiles(args: AuditVerifyArgs, stateDir: string): SelectedFile[] {
  if (args.file !== undefined) {
    const stem = basename(args.file, extname(args.file));
    return [{ sessionId: isSessionId(stem) && stem.trim() === stem ? stem : "file", file: args.file }];
  }
  const directory = join(stateDir, "audit");
  // Refuse directory symlinks, including for an explicit session selector.
  if (!lstatSync(directory).isDirectory()) {
    throw new Error("audit directory is not a regular directory");
  }
  if (args.sessionId !== undefined) {
    return [{ sessionId: args.sessionId, file: join(directory, `${args.sessionId}.jsonl`) }];
  }
  return readdirSync(directory)
    .filter((name) => name.endsWith(".jsonl"))
    .sort()
    .map((name) => {
      const sessionId = name.slice(0, -6);
      if (!isSessionId(sessionId) || sessionId.trim() !== sessionId) {
        throw new Error("invalid audit file name");
      }
      return { sessionId, file: join(directory, name) };
    });
}

export function runAuditVerifySelection(
  words: readonly string[],
  deps: { readonly stateDir: string },
): AuditVerifyResult {
  const args = parseAuditVerifyArgs(words);
  if (args === undefined) {
    return { exitCode: 2, stdout: "", stderr: `realm audit verify: usage: ${AUDIT_VERIFY_USAGE}\n` };
  }
  let anchor: AnchorRecord | undefined;
  if (args.anchorFile !== undefined) {
    try {
      anchor = readAnchor(args.anchorFile);
    } catch {
      return { exitCode: 1, stdout: '{"ok":false,"files":[]}\n', stderr: "realm audit verify: anchor cannot be read or is not a valid record\n" };
    }
  }
  let selected: SelectedFile[];
  try {
    selected = selectedFiles(args, deps.stateDir);
  } catch {
    return { exitCode: 1, stdout: '{"ok":false,"files":[]}\n', stderr: "realm audit verify: audit files cannot be selected\n" };
  }
  if (selected.length === 0) {
    return { exitCode: 1, stdout: '{"ok":false,"files":[]}\n', stderr: "realm audit verify: no audit files to verify\n" };
  }
  const files: ((AuditVerificationReport & { readonly sessionId: string }) | {
    readonly sessionId: string;
    readonly ok: false;
    readonly error: "unreadable-file-or-invalid-checkpoint";
  })[] = [];
  let ok = true;
  let stderr = "";
  for (const entry of selected) {
    const options: VerifyAuditOptions = {
      sessionId: entry.sessionId,
      ...(args.head === undefined ? {} : { head: args.head }),
      ...(anchor === undefined ? {} : { anchor }),
    };
    let verified: VerifyAuditResult;
    try {
      verified = verifyAuditFile(entry.file, options);
    } catch {
      ok = false;
      files.push({ sessionId: entry.sessionId, ok: false, error: "unreadable-file-or-invalid-checkpoint" });
      stderr += `realm audit verify: session ${entry.sessionId}: file or checkpoint cannot be read or validated\n`;
      continue;
    }
    ok = ok && verified.ok;
    files.push({ sessionId: entry.sessionId, ...reportOf(verified) });
    stderr += `realm audit verify: session ${entry.sessionId}: ${diagnostics(verified, options)}`;
  }
  return { exitCode: ok ? 0 : 1, stdout: `${JSON.stringify({ ok, files })}\n`, stderr };
}

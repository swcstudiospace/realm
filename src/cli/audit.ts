// realm audit verify (OBS-01, D-1702). Reads one audit file and checks its hash chain.
// Exit 0: the chain holds (legacy lines are unprotected, not a break). Exit 1: the first
// line that does not chain, or a file that cannot be read. No host path is printed.

import { verifyAuditFile, type VerifyAuditResult } from "../audit/chain.js";

export interface AuditVerifyResult {
  readonly exitCode: 0 | 1;
  readonly stdout: string;
  readonly stderr: string;
}

export function runAuditVerify(file: string): AuditVerifyResult {
  let verified: VerifyAuditResult;
  try {
    verified = verifyAuditFile(file);
  } catch {
    return {
      exitCode: 1,
      stdout: "",
      stderr: "realm audit verify: the file cannot be read\n",
    };
  }
  const stdout = `${JSON.stringify(reportOf(verified))}\n`;
  if (verified.ok) {
    const unprotected =
      verified.legacyLines > 0
        ? `realm audit verify: ${String(verified.legacyLines)} legacy line(s) are unprotected\n`
        : "";
    return { exitCode: 0, stdout, stderr: unprotected };
  }
  const broken = verified.broken;
  const where =
    broken === undefined
      ? "the file does not chain"
      : broken.line === 1
        ? `line 1 does not chain (${broken.reason})`
        : `line ${String(broken.line)} does not chain to line ${String(broken.line - 1)} (${broken.reason})`;
  return {
    exitCode: 1,
    stdout,
    stderr: `realm audit verify: ${where}\n`,
  };
}

function reportOf(verified: VerifyAuditResult): {
  readonly ok: boolean;
  readonly lines: number;
  readonly chainedLines: number;
  readonly legacyLines: number;
  readonly unprotected: number;
  readonly unparsedLines: readonly number[];
  readonly tornTail: boolean;
  readonly broken?: { readonly line: number; readonly reason: string };
} {
  return {
    ok: verified.ok,
    lines: verified.lines,
    chainedLines: verified.chainedLines,
    legacyLines: verified.legacyLines,
    unprotected: verified.legacyLines,
    unparsedLines: verified.unparsedLines,
    tornTail: verified.tornTail,
    ...(verified.broken === undefined ? {} : { broken: verified.broken }),
  };
}

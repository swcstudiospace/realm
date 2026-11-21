// Startup diagnostic for a stale workspaceRoot (ADR-0003, US-111, AC-34; API-RealmOmpPlugin
// `startDiagnose`, `DiagnoseResponse`). The refusal itself stays a pathless POLICY_DENIED: RealmError
// carries only a catalogue code by construction (src/core/errors.ts: "Nothing else enters an error"),
// so the missing directory is named here, at the operator boundary, never inside an error, an audit
// line, or a log line (NFR-C1; `DiagnoseResponse.missingPath` is PII-indirect, operator-local only).
// The daemon.log `daemon.failed` line for the same failure keeps the fixed catalogue code only;
// only this module's return value, composed onto an operator-local stderr line by the caller, names
// the path. This module reads no environment: the caller passes the configured path.

import { statSync } from "node:fs";
import { isAbsolute } from "node:path";

// The one remedy AC-34 requires. Exactly one remedy: point the config at an existing account-owned
// directory, or remove the stale config. Config repair is an operator action; nothing here rewrites
// the stored config.
// Module-private: the remedy text is asserted by literal in the unit tests (the AC-34 wording is
// the contract, not an implementation detail to re-export).
const WORKSPACE_ROOT_REMEDY =
  "Point workspaceRoot at an existing directory owned by the account, or remove the stale config.";

// The failure codes `startDiagnose` reports. The API contract's `DiagnoseResponse.code` enum is
// exactly these two: POLICY_DENIED for a nonexistent workspaceRoot, SCHEMA_INVALID for an unusable
// config shape.
export type DiagnoseCode = "POLICY_DENIED" | "SCHEMA_INVALID";

// The `startDiagnose` result (`DiagnoseResponse`, API-RealmOmpPlugin 1.0.0). `missingPath` and
// `remedy` are present only when the workspaceRoot is missing: never persisted, never audited, never
// logged; the caller renders them to operator-local stderr or doctor output only.
export interface DiagnoseResponse {
  readonly workspaceRootExists: boolean;
  readonly missingPath?: string;
  readonly code: DiagnoseCode;
  readonly remedy?: string;
  readonly correlationId: string;
}

// Diagnoses the one configured workspaceRoot. `workspaceRootExists` is true only when the path is an
// existing directory, the same truth `bindRoot` enforces at start (`src/fs/root.ts`); a path that
// cannot be stat-ed (absent, or otherwise unreadable) and a path that is not a directory both refuse
// the bind with POLICY_DENIED, so both report as the missing directory here. A config shape that
// cannot name a directory (empty, relative) never reaches the bind: `loadRuntimeConfig` refuses it
// with SCHEMA_INVALID first, so it reports SCHEMA_INVALID with no path named.
export function startDiagnose(workspaceRoot: string, correlationId: string): DiagnoseResponse {
  if (workspaceRoot.trim() === "" || !isAbsolute(workspaceRoot)) {
    return { workspaceRootExists: false, code: "SCHEMA_INVALID", correlationId };
  }
  let isDirectory = false;
  try {
    isDirectory = statSync(workspaceRoot).isDirectory();
  } catch {
    // A path that cannot be stat-ed stays false: like bindRoot, any failure to resolve or
    // stat the root refuses the start, so it reports as the missing directory below.
  }
  if (isDirectory) {
    // The workspace exists, so neither failure code applies; `code` is only meaningful on failure
    // and consumers MUST branch on `workspaceRootExists`. SCHEMA_INVALID is returned (never
    // POLICY_DENIED, which would assert a denial that did not occur) with no `missingPath` and no
    // `remedy`, so the failure rendering below stays null. The 200 arm's required failure-code enum
    // is a contract gap; see impl.notes (contract change request to A03).
    return { workspaceRootExists: true, code: "SCHEMA_INVALID", correlationId };
  }
  return { workspaceRootExists: false, missingPath: workspaceRoot, code: "POLICY_DENIED", remedy: WORKSPACE_ROOT_REMEDY, correlationId };
}

// The operator-local stderr fragment naming the one missing directory and its one remedy, or null
// when there is nothing to name. The caller owns the command prefix and the trailing newline; this
// fragment itself is written to stderr only, never to a file or a log line.
export function formatDiagnoseLine(response: DiagnoseResponse): string | null {
  if (response.workspaceRootExists || response.missingPath === undefined || response.remedy === undefined) {
    return null;
  }
  return `workspaceRoot ${response.missingPath} does not exist. ${response.remedy}`;
}

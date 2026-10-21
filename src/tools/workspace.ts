// Workspace file handlers (D-88, D-98, TOOL-03). These are the read, list, and write handlers
// the dispatcher calls for the file tools. This is the only module under src/tools/ that
// imports lockedWrite, readFileCapped, or listDir (D-88).
//
// Each handler runs the D-89 stages that apply to its call, in this order:
//   2. state: a write asks the injected mutation gate (D-63). A refusal throws before any
//      audit line, because an admission line is not written for a refused call (D-90).
//   3. lock: a write canonicalizes in write mode, runs the credential check, and probes the
//      path lock. A path another owner holds is LOCK_CONFLICT, refused before admission.
//   4. admission: one audit line with phase "admission", written before execution. A failed
//      append throws AUDIT_WRITE_FAILED and nothing executes (S-21).
//   5. execution: the Phase 2 function. For a write, lockedWrite keeps the authoritative
//      acquire and hash check (D-34), so a race still yields LOCK_CONFLICT.
//   6. result: one audit line with phase "result", outcome "ok" or the error code. A failed
//      append after execution throws AUDIT_WRITE_FAILED and does not roll back the effect (OQ-P4-07).
//
// Audit lines carry the byte count and sha256 of the content moved, never the content (D-42,
// D-90). A write records the UTF-8 byte length and the sha256 of what it wrote. A read records
// the length of the content it returned (at most maxBytes) and the sha256 that readFileCapped
// reports, which covers the whole file. A list records neither.
//
// Read and list rely on readFileCapped and listDir for the canonicalize, credential, and
// root checks, which those functions run in that order (D-36). A write runs the same checks
// itself, because its lock probe needs the canonical target.
//
// Every expected failure is a RealmError (Phase 2 maps them all). Any other error is a defect:
// it is rethrown without a result line.
//
// The handlers read no process.env. Every dependency arrives through WorkspaceDeps.

import { Buffer } from "node:buffer";
import { join } from "node:path";
import type { AuditEntryInput } from "../audit/log.js";
import type { ListParams, ReadParams, WriteParams } from "../contract/validate.js";
import { RealmError, makeRealmError } from "../core/errors.js";
import { canonicalize } from "../fs/canonicalize.js";
import { assertCredentialAccess, relPathOf } from "../fs/credentials.js";
import { listDir, type ListResult } from "../fs/list.js";
import type { LockTable } from "../fs/locks.js";
import { readFileCapped, type ReadResult } from "../fs/read.js";
import type { PinnedRoot } from "../fs/root.js";
import { lockedWrite } from "../fs/write.js";
import type { GateOutcome } from "../lifecycle/mutation-gate.js";

// Writes one audit line. The dispatcher wires this to appendAudit with the session's state dir.
export type AuditSink = (entry: AuditEntryInput) => void;

export interface WorkspaceDeps {
  readonly sessionId: string;
  readonly boundRoot: PinnedRoot;
  readonly locks: LockTable;
  readonly credentialAllow: readonly string[];
  readonly audit: AuditSink;
  // Returns the mutation gate decision for the session's state at call time (D-63).
  readonly mutationGate: () => GateOutcome;
}

// D-98: the byte count and sha256 of the write, and the advisory warning when the gate allowed
// the write with one (D-23). A write under advisory policy in a non-active state is not a failure.
export interface WriteOutcome {
  readonly sha256: string;
  readonly bytes: number;
  readonly warning: string | null;
}

interface AuditFacts {
  readonly bytes?: number;
  readonly sha256?: string;
}

export function writeWorkspaceFile(deps: WorkspaceDeps, params: WriteParams): WriteOutcome {
  const gate = deps.mutationGate();
  if (gate.outcome === "refused") {
    throw makeRealmError(gate.code);
  }
  const target = writeTargetOf(deps, params.path);
  precheckLock(deps.locks, target, deps.sessionId);

  const bytes = Buffer.byteLength(params.content, "utf8");
  const written = audited(
    deps,
    "write",
    params.path,
    () =>
      lockedWrite(deps.boundRoot, params.path, params.content, {
        owner: deps.sessionId,
        locks: deps.locks,
        credentialAllow: deps.credentialAllow,
        ...(params.ifMatchSha256 === undefined ? {} : { ifMatchSha256: params.ifMatchSha256 }),
      }),
    (result) => ({ bytes, sha256: result.sha256 }),
  );
  return {
    sha256: written.sha256,
    bytes,
    warning: gate.outcome === "proceed-with-warning" ? gate.warning : null,
  };
}

export function readWorkspaceFile(deps: WorkspaceDeps, params: ReadParams): ReadResult {
  return audited(
    deps,
    "read",
    params.path,
    () =>
      readFileCapped(deps.boundRoot, params.path, {
        maxBytes: params.maxBytes,
        credentialAllow: deps.credentialAllow,
      }),
    (result) =>
      result.status === "found" ? { bytes: result.content.byteLength, sha256: result.sha256 } : {},
  );
}

export function listWorkspaceDir(deps: WorkspaceDeps, params: Pick<ListParams, "path">): ListResult {
  return audited(
    deps,
    "list",
    params.path,
    () => listDir(deps.boundRoot, params.path, { credentialAllow: deps.credentialAllow }),
    () => ({}),
  );
}

// Runs one file call between its admission and result lines. The admission line is written
// before execution, so a failed admission runs nothing. A RealmError from execution is recorded
// as its code and rethrown. The result line carries facts only for a successful call.
function audited<T>(
  deps: WorkspaceDeps,
  tool: string,
  path: string,
  execute: () => T,
  factsOf: (value: T) => AuditFacts,
): T {
  const line = { sessionId: deps.sessionId, tool, path };
  deps.audit({ ...line, outcome: "ok", phase: "admission" });
  let value: T;
  try {
    value = execute();
  } catch (error: unknown) {
    if (!(error instanceof RealmError)) {
      throw error;
    }
    deps.audit({ ...line, outcome: error.code, phase: "result" });
    throw error;
  }
  deps.audit({ ...line, outcome: "ok", phase: "result", ...factsOf(value) });
  return value;
}

// The path lockedWrite will lock, named as write.ts names it (step 1): the real path of an
// existing target, or the verified parent joined with the one segment the write would create.
// The credential check runs on the canonical path before any lock is taken.
function writeTargetOf(deps: WorkspaceDeps, relPath: string): string {
  const resolved = canonicalize(deps.boundRoot, relPath, { mode: "write" });
  if (resolved.status === "absent" && resolved.missing.length !== 1) {
    throw makeRealmError("PATH_ESCAPE");
  }
  assertCredentialAccess(relPathOf(deps.boundRoot, resolved), deps.credentialAllow);
  return resolved.status === "found"
    ? resolved.realPath
    : join(resolved.nearest, ...resolved.missing);
}

// The D-89 lock stage. A path the session already holds needs no probe. Otherwise the probe
// acquires and drops the path lock, which throws LOCK_CONFLICT when another owner holds it.
// lockedWrite repeats the authoritative acquire (D-34).
function precheckLock(locks: LockTable, target: string, owner: string): void {
  if (locks.isHeldBy(target, owner)) {
    return;
  }
  locks.release(locks.acquire(target, owner));
}

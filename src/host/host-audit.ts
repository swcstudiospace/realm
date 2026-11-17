// Audit lines for host installer operations. They go on the existing hash chain under one reserved
// session id, so `realm audit verify` covers them and the reconciler marks an admission with no result
// as AUDIT_OUTCOME_UNKNOWN through the unchanged mechanism. A line carries the config home, byte counts
// and hashes only: never file content.

import { makeRealmError } from "../core/errors.js";
import type { AuditEntryInput, AuditOutcome, AuditPhase } from "../audit/log.js";

export const HOST_AUDIT_SESSION_ID = "host-plugins";

export type HostAuditTool = "host.install" | "host.uninstall";

// The audit writer. Production passes appendAudit; a test passes a recording or failing function.
export type HostAuditFn = (stateDir: string, input: AuditEntryInput) => void;

export interface HostAuditDeps {
  readonly stateDir: string;
  readonly audit: HostAuditFn;
}

export interface HostAuditInput {
  readonly tool: HostAuditTool;
  readonly outcome: AuditOutcome;
  readonly configHome: string;
  readonly bytes: number;
  readonly sha256: string | undefined;
  readonly correlationId: string;
}

// Appends one admission or result line. A failure is a RealmError: the seam's own, or AUDIT_WRITE_FAILED
// for anything else. It is never swallowed here; the engine decides what a failed append means.
export function recordHostOperation(deps: HostAuditDeps, phase: Extract<AuditPhase, "admission" | "result">, input: HostAuditInput): void {
  try {
    deps.audit(deps.stateDir, {
      sessionId: HOST_AUDIT_SESSION_ID,
      tool: input.tool,
      phase,
      outcome: input.outcome,
      path: input.configHome,
      bytes: input.bytes,
      ...(input.sha256 === undefined ? {} : { sha256: input.sha256 }),
      correlationId: input.correlationId,
    });
  } catch (error: unknown) {
    if (error instanceof Error && error.name === "RealmError") {
      throw error;
    }
    throw makeRealmError("AUDIT_WRITE_FAILED");
  }
}

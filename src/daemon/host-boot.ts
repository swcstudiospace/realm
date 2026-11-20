// The daemon side of the host boot report (BOOT-06, BOOT-07). A host process tells the daemon how its boot went through
// the `host-boot` control method; this module records it with the baseline mechanisms Realm already has: the metrics
// counters, the structured logger and the hash-chained audit.
//
// The daemon is the only writer of the boot audit chain (<stateDir>/audit/host-boot.jsonl). The audit writer has no
// cross-process lock (it reads the chain head, then appends), so many host processes appending to one chain could fork
// it; the daemon is one process and appends synchronously, so seq and prev cannot fork.
//
// A report is self-reported by the host process and advisory: nothing authorizes on it, and the audit line says "a process
// claiming host X reported phase Y", not that X authenticated. Every field is a closed vocabulary or a bounded integer
// (src/host/boot-report.ts), so no path, session id or free string can reach a sink.
//
// Steps of one report, in order:
//   1. take one token from the bucket (60, refilled one per second); none left is POLICY_DENIED and nothing is recorded.
//      The bucket is taken before the parse, so a malformed frame at an empty bucket is POLICY_DENIED too.
//   2. parse the report; anything outside the closed vocabulary is SCHEMA_INVALID and nothing is recorded.
//   3. count it in the metrics.
//   4. write one host.boot log line whose correlationId is the boot id.
//   5. for attached, refused and failed, append the audit line. A failed append is logged and answered AUDIT_WRITE_FAILED;
//      the metric and the first log line stay recorded.

import { appendAudit } from "../audit/log.js";
import type { Policy } from "../contract/validate.js";
import { makeRealmError, RealmError } from "../core/errors.js";
import { parseHostBootReport, type HostBootReport } from "../host/boot-report.js";
import { resolveCapabilities } from "../host/capabilities.js";
import type { HostAuditFn } from "../host/host-audit.js";
import { defaultManifestFor } from "../host/manifest.js";
import type { HostId } from "../host/types.js";
import type { LogFields, Logger } from "../observe/logger.js";
import type { Metrics } from "../observe/metrics.js";

// The reserved audit session id of the boot chain. The host-plugins chain is a different file written by the CLI.
const BOOT_AUDIT_SESSION_ID = "host-boot";
const BOOT_AUDIT_TOOL = "host.boot";
// One honest boot sends at most about 30 reports, so the bucket never refuses a real host.
const BUCKET_CAPACITY = 60;
const BUCKET_REFILL_PER_SECOND = 1;
// Thousandths of a token: one token is MILLI.
const MILLI = 1000;
const AUDITED_PHASES: readonly string[] = ["attached", "refused", "failed"];

// A token bucket over an injected monotonic clock. No timers: the refill is computed at each take. The balance is kept in
// thousandths of a token, so a refill of milliseconds times tokens per second is exact.
class TokenBucket {
  private balance: number;
  private lastMs: number;

  constructor(
    private readonly capacity: number,
    private readonly refillPerSecond: number,
    private readonly nowMs: () => number,
  ) {
    this.balance = capacity * MILLI;
    this.lastMs = nowMs();
  }

  take(): boolean {
    const at = this.nowMs();
    const elapsedMs = at - this.lastMs;
    // A clock that does not advance, or goes back, grants nothing and moves nothing.
    if (elapsedMs > 0) {
      this.balance = Math.min(this.capacity * MILLI, this.balance + elapsedMs * this.refillPerSecond);
      this.lastMs = at;
    }
    if (this.balance < MILLI) {
      return false;
    }
    this.balance -= MILLI;
    return true;
  }
}

export interface HostBootRecorderOptions {
  readonly logger: Logger;
  readonly metrics: Pick<Metrics, "recordHostBoot">;
  readonly policy: Policy;
  readonly stateDir: string;
  readonly monotonicMs: () => number;
  // The plugin version the default manifest is built with when the capability posture is computed.
  readonly version: string;
  // The audit writer. Production uses appendAudit; a test passes a recording or failing function.
  readonly audit?: HostAuditFn;
}

export interface HostBootRecorder {
  readonly record: (params: unknown) => { readonly recorded: true };
}

// The `report` member of the request params. The channel already checked the frame; this checks it again so the recorder
// stands alone.
function reportOf(params: unknown): unknown {
  if (typeof params !== "object" || params === null || Array.isArray(params)) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  const descriptor = Object.getOwnPropertyDescriptor(params, "report");
  if (descriptor === undefined || !("value" in descriptor)) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  const report: unknown = descriptor.value;
  return report;
}

export function createHostBootRecorder(options: HostBootRecorderOptions): HostBootRecorder {
  const { logger, metrics, policy, stateDir, version } = options;
  const audit: HostAuditFn = options.audit ?? appendAudit;
  const bucket = new TokenBucket(BUCKET_CAPACITY, BUCKET_REFILL_PER_SECOND, options.monotonicMs);
  // What a host can ask for and the loaded policy denies, per host id. Computed once: the policy is loaded once.
  const posture = new Map<HostId, readonly string[]>();

  const deniedCapabilities = (hostId: HostId): readonly string[] => {
    const cached = posture.get(hostId);
    if (cached !== undefined) {
      return cached;
    }
    const resolution = resolveCapabilities(defaultManifestFor(hostId, version).capabilities, policy);
    const denied = resolution.denied.map((denial) => `${denial.request.capability}:${denial.code}`);
    posture.set(hostId, denied);
    return denied;
  };

  const logReport = (report: HostBootReport): void => {
    const fields: LogFields = {
      correlationId: report.bootId,
      hostId: report.hostId,
      transport: report.transport,
      phase: report.phase,
      attempt: report.attempt,
      durationMs: report.durationMs,
      ...(report.state === null ? {} : { state: report.state }),
      ...(report.code === null ? {} : { code: report.code }),
    };
    if (report.hostId !== "unlabelled" && (report.phase === "attached" || report.phase === "refused")) {
      const denied = deniedCapabilities(report.hostId);
      if (denied.length > 0) {
        fields["capabilitiesDenied"] = denied;
      }
    }
    // The code is non-null exactly for refused, failed and link-lost: the three phases that warn.
    if (report.code === null) {
      logger.info("host.boot", fields);
    } else {
      logger.warn("host.boot", fields);
    }
  };

  const auditReport = (report: HostBootReport): void => {
    try {
      audit(stateDir, {
        sessionId: BOOT_AUDIT_SESSION_ID,
        tool: BOOT_AUDIT_TOOL,
        outcome: report.code ?? "ok",
        path: `${report.hostId}/${report.transport}/${report.phase}`,
        correlationId: report.bootId,
      });
    } catch (error: unknown) {
      const failure = error instanceof RealmError ? error : makeRealmError("AUDIT_WRITE_FAILED");
      logger.error("host.boot.audit_failed", { correlationId: report.bootId, code: failure.code });
      throw failure;
    }
  };

  return {
    record(params) {
      if (!bucket.take()) {
        throw makeRealmError("POLICY_DENIED");
      }
      const report = parseHostBootReport(reportOf(params));
      metrics.recordHostBoot(report);
      logReport(report);
      if (AUDITED_PHASES.includes(report.phase)) {
        auditReport(report);
      }
      return { recorded: true };
    },
  };
}

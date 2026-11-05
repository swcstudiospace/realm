// Startup maintenance (D-1409): the selective reap, the registry cleanup, the orphan temp-file sweep and the audit
// reconciliation, run before the gate opens, then the hydration of the adopted sessions while the daemon serves. startDaemon
// supplies the container seams, the store and the hydration; this module owns the order of the steps, their shared budget
// and the report they produce (CRASH-01, CRASH-02, CRASH-04).

import { lstatSync, statSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import { appendAudit } from "../audit/log.js";
import { reconcileAuditLogs } from "../audit/reconcile.js";
import type { Policy, SessionRecord } from "../contract/validate.js";
import type { ErrorCode } from "../core/errors.js";
import type { StateSnapshot } from "../core/state-machine.js";
import { withTimeout } from "../core/timeout.js";
import { errnoOf } from "../fs/canonicalize.js";
import { bindRoot, isInsideRoot, type PinnedRoot } from "../fs/root.js";
import { DEFAULT_SWEEP_DEADLINE_MS, ORPHAN_TEMP_MIN_AGE_MS, sweepOrphanTempFiles } from "../fs/temp-sweep.js";
import { hydrateAdopted } from "../lifecycle/adoption.js";
import { storedPinOf } from "../lifecycle/session-state.js";
import type { Logger } from "../observe/logger.js";
import { sandboxBindingOf } from "../runtime/driver/sandbox-binding.js";
import type { HardeningBinding } from "../runtime/hardening.js";
import { realmSandboxName } from "../runtime/openshell.js";
import { type SessionContainers, verdictOf } from "../runtime/session-execution.js";
import { listRealmContainers, SWEEP_CALL_TIMEOUT_MS } from "../runtime/sweep.js";
import { sessionsDirOf } from "../session/paths.js";
import {
  reapStartupSelective,
  type InspectedCandidate,
  type ReapCandidate,
  type ReapInspection,
  type ReapVerdict,
  type SelectiveReapDeps,
  type SelectiveReapResult,
} from "../session/reap.js";
import type { SessionStore } from "../session/store.js";
import { listWorkspaceEntryIds, removeWorkspaceEntry } from "../session/workspace-registry.js";
import type { ControlSelection } from "./channel.js";
import { codeOf, type ResolvedSelection } from "./sessions.js";

// The budget of the startup temp-file sweep and audit reconciliation together, counted from the end of the reap. Both are
// optional cleanup, so a large workspace or audit history must not keep clients waiting: the work that does not fit is
// reported as unfinished and a later start finishes it. The gate opens once this work is done: the reconciliation needs no call in flight.
export const STARTUP_MAINTENANCE_BUDGET_MS = 10_000;

// What the startup maintenance did, handed to onStartup. The stable seam for the startup log line (Phases 17 and 19 reshape
// the reap and the logger, not this object). `failures` counts the maintenance steps that threw and the entries the sweeps
// report as failed; a failure never aborts the start.
export interface StartupReport {
  // The ids of the realm containers the reap removed and proved gone, in removal order.
  readonly containerIds: readonly string[];
  readonly containersRemoved: number;
  readonly recordsDeleted: number;
  // The sessions the reap adopted: their containers and records were kept. Each is hydrated after the gate opens.
  readonly adopted: number;
  readonly tempFilesRemoved: number;
  readonly auditLinesReconciled: number;
  // True when the temp-file sweep stopped at its wall or entry bound before it had seen every directory.
  readonly truncated: boolean;
  // The sweep roots the budget left unfinished (the root being walked when it ran out, and every root not reached), as paths.
  readonly unfinishedSweepRoots: readonly string[];
  // The audit logs the budget left unfinished, as base names without a directory. A later start finishes them.
  readonly unfinishedAuditFiles: readonly string[];
  // True when the audit directory held more logs than one start considers, or the deadline ended its listing, so logs that
  // were not considered cannot be named in `unfinishedAuditFiles`.
  readonly auditListingTruncated: boolean;
  // True when no sweep root and no audit log is unfinished. It says nothing about the notice, which is about the reap and the
  // adoptions only.
  readonly maintenanceComplete: boolean;
  // Present only when the reap itself failed: the catalogue code it failed with. The report is then partial: it holds what the
  // reap had destroyed before it stopped, no sweep or reconciliation ran, and the start fails with that same error.
  readonly reapFailure?: ErrorCode;
  // Orphan temp files removed from no recorded workspace. They are counted here and written to no audit file (C9).
  readonly unattributedTempFiles: number;
  // Records the startup could not read. Their workspace is unknown, so they own no orphan (C9).
  readonly unattributedRecords: number;
  // The catalogue codes of the records whose read threw, one per such record. `unattributedRecords` also counts a record that
  // read as absent, which has no code.
  readonly unattributedRecordCodes: readonly ErrorCode[];
  // Registry entries of earlier generations that the startup removed.
  readonly registryEntriesRemoved: number;
  readonly failures: number;
  // The catalogue codes of the counted failures that carry one, in the order they happened: a registry cleanup, a sweep or a
  // reconciliation that threw, a sweep root that did not bind, a device that could not be read, and every failure the sweep and
  // the reconciliation report with its code. `failures` also counts the failures that carry none (a missing uid, a failed
  // hydration), so it can be larger than this list. A failed reap sets `failures` to 1 and leaves this list empty; its code is
  // `reapFailure`.
  readonly failureCodes: readonly ErrorCode[];
}

// The reap's container seams, as startDaemon builds them over the libpod client. The store is the caller's.
export type StartupReapSeams = Omit<SelectiveReapDeps, "store">;

interface StartupMaintenanceDeps {
  readonly store: Pick<SessionStore, "list" | "load" | "delete">;
  // The reap's container seams: the listing, the verdict, the removal and the removal proof.
  readonly reap: StartupReapSeams;
  // Hydrates the container of one adopted session and resolves with the session's snapshot.
  readonly hydrate: (sessionId: string, containerId: string) => Promise<StateSnapshot>;
  // Opens the gate: the daemon serves from here on. Called once the reap, the sweep and the reconciliation are done.
  readonly serve: () => void;
  // The adopted sessions whose hydration has not settled. A session is added after the reap and removed when its hydration settles.
  readonly pending: Set<string>;
  readonly policy: Policy;
  readonly stateDir: string;
  // Wall-clock milliseconds, for the age of a temp file (its mtime is a wall-clock value).
  readonly now: () => number;
  // Monotonic milliseconds (performance.now()), for the budget. The deadline is read on this clock only.
  readonly monotonicNow: () => number;
  // The budget of the temp-file sweep and the audit reconciliation together, counted from the end of the reap.
  readonly budgetMs: number;
  // Receives the report once: the full one when the maintenance ended, a partial one (with `reapFailure`) when the reap failed.
  readonly onReport: (report: StartupReport) => void;
}

// The whole startup block (D-1409), in this order: the selective reap, the registry cleanup, the temp-file sweep, the audit
// reconciliation, the gate, the hydration of the adopted sessions, the report. The reap's failure rejects and nothing is served;
// a failure of any later step is counted in the report and never aborts the start. The sweep and the reconciliation share ONE
// deadline, budgetMs after the reap; work cut off by it is reported as unfinished and finished by a later start. The reconciliation
// runs before the gate because it assumes no call is in flight.
export async function runStartupMaintenance(deps: StartupMaintenanceDeps): Promise<void> {
  // The reap's progress outlives its call, so a reap that fails halfway still reports what it destroyed.
  const containerIds: string[] = [];
  let failures = 0;
  const failureCodes: ErrorCode[] = [];
  let registryEntriesRemoved = 0;
  let unreadableRecords = 0;
  let unreadableRecordCodes: readonly ErrorCode[] = [];
  let unattributedTempFiles = 0;
  let owners: readonly RecordOwner[] = [];
  let reaped: SelectiveReapResult;
  try {
    // The owners are read before the reap deletes the records, so each orphan's removal can be attributed (C9).
    const captured = captureOwners(deps.store);
    owners = captured.owners;
    unreadableRecords = captured.unreadable;
    unreadableRecordCodes = captured.unreadableCodes;
    reaped = await reapStartupSelective({
      store: deps.store,
      listCandidates: deps.reap.listCandidates,
      verdict: deps.reap.verdict,
      remove: async (containerId) => {
        await deps.reap.remove(containerId);
        containerIds.push(containerId);
      },
      listSurvivors: deps.reap.listSurvivors,
    });
  } catch (error: unknown) {
    // The reap failed, possibly after it had removed containers. Record what was destroyed and why it stopped, hand it to the
    // observer so the log has it, and rethrow the original error: nothing is served after it. The reap deleted no record.
    deps.onReport({
      containerIds,
      containersRemoved: containerIds.length,
      recordsDeleted: 0,
      adopted: 0,
      tempFilesRemoved: 0,
      auditLinesReconciled: 0,
      truncated: false,
      unfinishedSweepRoots: [],
      unfinishedAuditFiles: [],
      auditListingTruncated: false,
      maintenanceComplete: false,
      reapFailure: codeOf(error),
      unattributedTempFiles,
      unattributedRecords: unreadableRecords,
      unattributedRecordCodes: unreadableRecordCodes,
      registryEntriesRemoved: 0,
      failures: 1,
      failureCodes: [],
    });
    throw error;
  }
  // A removal the reap proved gone is named even when its call was never seen to resolve.
  for (const removal of reaped.removed) {
    if (!containerIds.includes(removal.containerId)) {
      containerIds.push(removal.containerId);
    }
  }
  // The deadline counts from the end of the reap, as the sweep and the reconciliation have always been bounded. The hydration
  // below has its own bound (the controller's startup budget), so it is not counted against this one.
  const deadline = deps.monotonicNow() + deps.budgetMs;
  // The reap deleted the records of every session it did not adopt, so no registry entry of those sessions is live: each is
  // removed. An adopted session's entry is written again by its hydration.
  const adoptedIds = new Set(reaped.adopted.map((adopted) => adopted.sessionId));
  try {
    for (const id of listWorkspaceEntryIds(deps.stateDir)) {
      if (!adoptedIds.has(id)) {
        removeWorkspaceEntry(deps.stateDir, id);
        registryEntriesRemoved += 1;
      }
    }
  } catch (error: unknown) {
    // A registry entry that cannot be read or removed is counted with its code; the next start removes it.
    failures += 1;
    failureCodes.push(codeOf(error));
  }
  for (const session of reaped.adopted) {
    deps.pending.add(session.sessionId);
  }
  let tempFilesRemoved = 0;
  let truncated = false;
  let unfinishedSweepRoots: readonly string[];
  // Whether the sweep ran to its end. A sweep that did not (no uid, or a throw) walked none of its roots, so the maintenance is not complete.
  let sweepFinished = false;
  const ownerUid = process.getuid?.();
  // The roots the sweep was to walk, once sweepRootsOf has returned. A sweep that does not finish leaves every one of them unfinished.
  let sweepRootList: readonly string[] = [];
  try {
    const sweepRoots = sweepRootsOf(deps.policy.workspaceRoots, deps.stateDir);
    sweepRootList = sweepRoots.roots;
    failures += sweepRoots.failureCodes.length;
    failureCodes.push(...sweepRoots.failureCodes);
    if (ownerUid === undefined) {
      // Without a uid the owner rule cannot be applied, so nothing is removed; the report counts the gap and every root is unwalked.
      failures += 1;
      unfinishedSweepRoots = sweepRootList;
    } else {
      const sweepShareMs = Math.max(0, Math.floor((deadline - deps.monotonicNow()) / 2));
      const swept = sweepOrphanTempFiles(sweepRootList, {
        now: deps.now(),
        minAgeMs: ORPHAN_TEMP_MIN_AGE_MS,
        ownerUid,
        deadlineMs: Math.min(DEFAULT_SWEEP_DEADLINE_MS, sweepShareMs),
        audit: (entry) => {
          const sessionId = ownerOfPath(owners, entry.path);
          if (sessionId === undefined) {
            unattributedTempFiles += 1;
            return;
          }
          appendAudit(deps.stateDir, {
            sessionId,
            tool: entry.tool,
            outcome: entry.outcome,
            path: entry.path,
            bytes: entry.bytes,
          });
        },
      });
      tempFilesRemoved = swept.removed.length;
      truncated = swept.truncated;
      unfinishedSweepRoots = swept.unfinishedRoots;
      sweepFinished = true;
      // Each failure the sweep counted carries its code in `errors`, and a refused audit line is one entry more.
      failures += swept.errors.length;
      failureCodes.push(...swept.errors);
    }
  } catch (error: unknown) {
    // The sweep never throws on a bad root or file; this is a failure of the sweep itself, counted in the report with its code.
    // Every root it was to walk is left unwalked.
    failures += 1;
    failureCodes.push(codeOf(error));
    unfinishedSweepRoots = sweepRootList;
  }
  let auditLinesReconciled = 0;
  let unfinishedAuditFiles: readonly string[] = [];
  let auditListingTruncated = false;
  let auditComplete: boolean;
  try {
    const reconciled = reconcileAuditLogs(deps.stateDir, { now: deps.monotonicNow, deadline });
    auditLinesReconciled = reconciled.appended;
    unfinishedAuditFiles = reconciled.unfinished;
    auditListingTruncated = reconciled.listingTruncated;
    auditComplete = reconciled.complete;
    failures += reconciled.failed;
    failureCodes.push(...reconciled.failures.map((failure) => failure.code));
  } catch (error: unknown) {
    // A failure of the reconciliation itself is counted in the report with its code; the lines it appended before it stopped are not.
    failures += 1;
    failureCodes.push(codeOf(error));
    auditComplete = false;
  }
  // The gate opens once the reap, the sweep and the reconciliation are done; the adopted sessions then hydrate (hydrateAdopted).
  deps.serve();
  const hydrated = await hydrateAdopted(reaped.adopted, deps.hydrate, deps.policy.startupBudgetMs, deps.pending);
  deps.onReport({
    containerIds,
    containersRemoved: reaped.counts.removed,
    recordsDeleted: reaped.counts.deleted,
    adopted: reaped.counts.adopted,
    tempFilesRemoved,
    auditLinesReconciled,
    truncated,
    unfinishedSweepRoots,
    unfinishedAuditFiles,
    auditListingTruncated,
    maintenanceComplete: sweepFinished && unfinishedSweepRoots.length === 0 && auditComplete,
    unattributedTempFiles,
    unattributedRecords: unreadableRecords,
    unattributedRecordCodes: unreadableRecordCodes,
    registryEntriesRemoved,
    failures: failures + hydrated,
    failureCodes,
  });
}

// A record as it stood before the reap: the session it names and the workspace it was recorded for.
interface RecordOwner {
  readonly sessionId: string;
  readonly workspaceRoot: string;
}

// The records the reap is about to delete. A record that cannot be read has no known workspace, so it owns no orphan, and it
// is counted. The code of a read that threw is kept beside the count.
function captureOwners(store: Pick<SessionStore, "list" | "load">): {
  readonly owners: RecordOwner[];
  readonly unreadable: number;
  readonly unreadableCodes: ErrorCode[];
} {
  const owners: RecordOwner[] = [];
  let unreadable = 0;
  const unreadableCodes: ErrorCode[] = [];
  for (const sessionId of store.list()) {
    let record: SessionRecord | null;
    try {
      record = store.load(sessionId);
    } catch (error: unknown) {
      unreadable += 1;
      unreadableCodes.push(codeOf(error));
      continue;
    }
    if (record === null) {
      unreadable += 1;
    } else {
      owners.push({ sessionId, workspaceRoot: record.workspaceRoot });
    }
  }
  return { owners, unreadable, unreadableCodes };
}

// The session whose recorded workspace contains the path: an owner whose root is the path or one of its ancestors, the longest
// root winning. The comparison is by path segment, so /ws-other is not inside /ws. Undefined when no owner contains it.
function ownerOfPath(owners: readonly RecordOwner[], path: string): string | undefined {
  let best: RecordOwner | undefined;
  for (const owner of owners) {
    const rel = relative(owner.workspaceRoot, path);
    const contains = rel === "" || (!isAbsolute(rel) && rel.split(sep)[0] !== "..");
    if (contains && (best === undefined || owner.workspaceRoot.length > best.workspaceRoot.length)) {
      best = owner;
    }
  }
  return best?.sessionId;
}

// The roots the orphan sweep walks (D-1401): the policy's workspace roots, the sessions directory, the runtime directory and
// the audit directory (where a kill during the atomic write of the reconciliation's progress record leaves a temp file).
// A root that lies inside an earlier one is dropped only when that earlier root's walk reaches it, that is when both are on
// the same device: the walk never crosses into another device, so a root on its own mount (for example /projects/ssd under
// /projects) is kept. When either device cannot be read the root is kept too, because walking a directory twice costs time
// and dropping one that is not covered costs the cleanup. A root that does not exist yet (for example the runtime directory, which
// is created only when a session writes its policy) has nothing to sweep: it is skipped and is not a failure. A root that exists but
// does not bind is passed on as it is: the sweep counts it as skipped and walks nothing. Both failures are returned with their
// catalogue codes. `deviceOf` is the stat seam.
export function sweepRootsOf(
  workspaceRoots: readonly string[],
  stateDir: string,
  deviceOf: (path: string) => number = (path) => statSync(path).dev,
): SweepRoots {
  const candidates = [...workspaceRoots, sessionsDirOf(stateDir), join(stateDir, "runtime"), join(stateDir, "audit")];
  const bound: PinnedRoot[] = [];
  const roots: string[] = [];
  const failureCodes: ErrorCode[] = [];
  for (const candidate of candidates) {
    if (isAbsent(candidate)) {
      continue;
    }
    let pinned: PinnedRoot;
    try {
      pinned = bindRoot(candidate);
    } catch (error: unknown) {
      failureCodes.push(codeOf(error));
      roots.push(candidate);
      continue;
    }
    let covered = false;
    for (const earlier of bound) {
      if (!isInsideRoot(earlier, pinned.realPath)) {
        continue;
      }
      const relation = deviceRelation(deviceOf, earlier.realPath, pinned.realPath);
      if (!relation.known) {
        failureCodes.push(relation.failure);
      } else if (relation.same) {
        covered = true;
        break;
      }
    }
    if (covered) {
      continue;
    }
    bound.push(pinned);
    roots.push(pinned.realPath);
  }
  return { roots, failureCodes };
}

// Whether nothing is at the path. Only ENOENT counts: any other stat failure is left to bindRoot, which counts it as before.
function isAbsent(path: string): boolean {
  try {
    lstatSync(path);
    return false;
  } catch (error: unknown) {
    return errnoOf(error) === "ENOENT";
  }
}

// The sweep roots, and the catalogue code of each failure met while finding them.
export interface SweepRoots {
  readonly roots: readonly string[];
  readonly failureCodes: readonly ErrorCode[];
}

// Whether two roots lie on one device. A device that cannot be read gives an unknown relation, carrying the code of the failed stat.
type DeviceRelation = { readonly known: true; readonly same: boolean } | { readonly known: false; readonly failure: ErrorCode };

function deviceRelation(deviceOf: (path: string) => number, covering: string, nested: string): DeviceRelation {
  try {
    return { known: true, same: deviceOf(covering) === deviceOf(nested) };
  } catch (error: unknown) {
    // The root is kept and walked on its own, the conservative answer to an unreadable device; the caller counts the code.
    return { known: false, failure: codeOf(error) };
  }
}

// The notice text (D-1404): present only when the startup maintenance destroyed a container or a session record, or adopted a
// session. The destroyed and the adopted sessions are two sentences, joined by a space.
export function startupNoticeOf(report: StartupReport): string | undefined {
  if (report.containersRemoved === 0 && report.recordsDeleted === 0 && report.adopted === 0) {
    return undefined;
  }
  const parts: string[] = [];
  if (report.containersRemoved > 0 || report.recordsDeleted > 0) {
    parts.push(
      `A previous daemon's sandbox was destroyed at startup: ${String(report.containersRemoved)} container(s), ${String(report.recordsDeleted)} session record(s). Files in the workspace were kept; state outside it was lost.`,
    );
  }
  if (report.adopted > 0) {
    parts.push(
      `${String(report.adopted)} session(s) from the previous daemon were adopted and kept. Their records were kept and each was brought back while the daemon served; a session that did not come back is in error.`,
    );
  }
  return parts.join(" ");
}

// The adoption verdict's inputs: the libpod client, the state directory and the logger, the image and the roots the create
// path binds, the host readers, and the daemon's selection rules, which resolve a session record's workspace.
export interface AdoptionVerdictDeps {
  readonly libpod: SessionContainers;
  readonly stateDir: string;
  readonly logger: Logger;
  readonly image: string;
  readonly secretRoot: string | undefined;
  readonly sandboxStateRoot: string | undefined;
  readonly readOciConfig: (path: string) => string;
  readonly readProcStatus: (pid: number) => string;
  readonly resolve: (selection: ControlSelection) => ResolvedSelection;
}

// The adoption verdict of one session record against its container candidate (verdictOf). The record's workspace resolves
// under the rules of a selection, and the binding is the one the create path derives for the session's sandbox. Only a
// refusal of the record's own workspace is a verdict here; a libpod failure rejects the whole reap, which then removes nothing.
export function adoptionVerdictOver(
  deps: AdoptionVerdictDeps,
): (record: SessionRecord, candidate: InspectedCandidate) => Promise<ReapVerdict> {
  return async (record: SessionRecord, candidate: InspectedCandidate): Promise<ReapVerdict> => {
    let resolved: ResolvedSelection;
    try {
      resolved = deps.resolve({ workspaceRoot: record.workspaceRoot, sessionId: record.sessionId });
    } catch (error: unknown) {
      deps.logger.info("startup.adoption_refused", { sessionId: record.sessionId, code: codeOf(error) });
      return { ok: false, property: "workspace-root", causeCode: codeOf(error) };
    }
    try {
      storedPinOf(deps.stateDir, record.sessionId, record.workspaceRoot);
    } catch (error: unknown) {
      deps.logger.info("startup.adoption_refused", { sessionId: record.sessionId, code: codeOf(error) });
      return { ok: false, property: "workspace-pin", causeCode: codeOf(error) };
    }
    const { secretRoot, sandboxStateRoot } = deps;
    if (
      secretRoot === undefined ||
      sandboxStateRoot === undefined ||
      !isAbsolute(secretRoot) ||
      !isAbsolute(sandboxStateRoot)
    ) {
      return { ok: false, property: "binding-roots", causeCode: "SCHEMA_INVALID" };
    }
    const info = await withTimeout(deps.libpod.info(), SWEEP_CALL_TIMEOUT_MS, "PODMAN_MACHINE_DOWN");
    const binding: HardeningBinding = {
      image: deps.image,
      rootless: info.rootless,
      sessionId: record.sessionId,
      ...sandboxBindingOf(
        { workspaceRoot: resolved.pinned.realPath, stateRoot: sandboxStateRoot, secretRoot },
        realmSandboxName(record.sessionId),
      ),
    };
    return verdictOf(candidate.inspect, {
      sessionId: record.sessionId,
      containerId: candidate.containerId,
      binding,
      readOciConfig: deps.readOciConfig,
      readProcStatus: deps.readProcStatus,
    });
  };
}

// The reap's container seams over the libpod client. Every call is bounded. An inspection that fails is kept as the
// candidate's failure (the reap then rejects before any removal); it is not swallowed.
export function startupReapSeamsOver(libpod: SessionContainers, verdict: StartupReapSeams["verdict"]): StartupReapSeams {
  return {
    listCandidates: async (): Promise<readonly ReapCandidate[]> => {
      const candidates: ReapCandidate[] = [];
      for (const container of await listRealmContainers(libpod)) {
        let inspection: ReapInspection;
        try {
          inspection = {
            ok: true,
            inspect: await withTimeout(libpod.inspectContainer(container.id), SWEEP_CALL_TIMEOUT_MS, "PODMAN_MACHINE_DOWN"),
          };
        } catch (error: unknown) {
          inspection = { ok: false, error };
        }
        candidates.push({ containerId: container.id, labels: container.labels ?? {}, inspection });
      }
      return candidates;
    },
    verdict,
    remove: async (containerId: string): Promise<void> => {
      await withTimeout(libpod.removeContainer(containerId, { force: true }), SWEEP_CALL_TIMEOUT_MS, "PODMAN_MACHINE_DOWN");
    },
    listSurvivors: async (): Promise<readonly string[]> =>
      (await listRealmContainers(libpod)).map((container) => container.id),
  };
}

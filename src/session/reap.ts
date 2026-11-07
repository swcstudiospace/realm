// Startup reaper (D-84, D-86, RT-08, D19-1). The selective reaper runs once at startup. A container that a session record
// names and whose verdict passes is adopted, and its record is kept. Every other realm container is removed with its cause,
// and each removal is proven by one listing taken after all of them. A record that is not adopted is deleted only after every
// removal is proven, so a rejected reap deletes nothing. An inspection failure rejects before any removal, and so does a
// verdict that throws. A record with a null container id (a crash during realm up, D-86) is reaped by the label sweep.
//
// The reap is not silent: it returns what it adopted, removed and deleted, and the daemon reports it. startDaemon runs it inside
// runStartupMaintenance (src/daemon/startup.ts), which hands the counts and the removed container ids to its onStartup
// observer (the daemon entry logs them on one line) and carries a notice on the status, up and down replies for its lifetime.
//
// Single-owner precondition (D-87, OQ-P4-06): the reap must run before any LifecycleController or ToolDispatcher exists in the
// process, and only one host daemon may own the state directory. Nothing here checks that another process is not reaping or
// using a live session; that cross-process check belongs to Phase 6. Until then, a second process reaping the same state
// directory is an accepted residual risk.
//
// This module imports no runtime module (D-50). The listing, inspection, verdict and removal arrive as function arguments.

import type { SessionRecord } from "../contract/validate.js";
import { makeRealmError, RealmError, type ErrorCode } from "../core/errors.js";
import { withTimeout } from "../core/timeout.js";
import type { SessionStore } from "./store.js";

// Bound for the whole selective reap: the listing, the inspections, every verdict, every removal and the proving listing.
// A reap that does not finish in time rejects with PODMAN_MACHINE_DOWN, the code D-53 gives a runtime socket timeout, before
// any record is deleted; the next start reaps again.
export const REAP_SWEEP_TIMEOUT_MS = 60_000;

// ---- Selective reap (Phase 19, D19-1) ---------------------------------------------------------------------------------
// A container that a session record names and that the caller's verdict accepts is adopted, and its record is kept. Every other
// realm container is removed with its cause, and every record that is not adopted is deleted. All dependencies are injected.

// The labels of one candidate container, as libpod reports them.
export type ReapLabels = Readonly<Record<string, string>>;

// The engine's inspect of one container, or null when the engine reports no such container.
export type ReapInspect = Readonly<Record<string, unknown>> | null;

// The outcome of inspecting one candidate. A candidate whose inspection failed is never removed.
export type ReapInspection = { readonly ok: true; readonly inspect: ReapInspect } | { readonly ok: false; readonly error: unknown };

export interface ReapCandidate {
  readonly containerId: string;
  readonly labels: ReapLabels;
  readonly inspection: ReapInspection;
}

// A candidate whose inspection succeeded. The verdict receives only this form.
export interface InspectedCandidate {
  readonly containerId: string;
  readonly labels: ReapLabels;
  readonly inspect: ReapInspect;
}

// The caller's verdict on a candidate. A refusal names the failed property, typed by the caller, and carries its catalogue code.
export type ReapVerdict<Property extends string = string> = { readonly ok: true } | { readonly ok: false; readonly property: Property; readonly causeCode: ErrorCode };

export interface SelectiveReapDeps<Property extends string = string> {
  readonly store: Pick<SessionStore, "list" | "load" | "delete">;
  // Lists the realm containers and inspects each one. Called once, before any verdict or removal.
  readonly listCandidates: () => Promise<readonly ReapCandidate[]>;
  // Judges a candidate against the record that names its container. Called once per record, before any removal.
  readonly verdict: (record: SessionRecord, candidate: InspectedCandidate) => ReapVerdict<Property> | Promise<ReapVerdict<Property>>;
  // Removes one container. A rejection leaves that container unproven unless the proof below no longer lists it.
  readonly remove: (containerId: string) => Promise<void>;
  // Lists the realm containers that still exist. Called once, after every removal; it is the removal proof.
  readonly listSurvivors: () => Promise<readonly string[]>;
}

export interface SelectiveReapResult<Property extends string = string> {
  // Containers that passed the verdict. Their records are kept.
  readonly adopted: readonly { readonly sessionId: string; readonly containerId: string }[];
  // Containers removed and proven gone. The cause is the verdict property that failed, or "no-record". removalCode is the code of
  // the removal's own failure, when the removal threw but the listing proved the container gone: that code is kept, not dropped.
  readonly removed: readonly { readonly containerId: string; readonly cause: Property | "no-record"; readonly removalCode?: ErrorCode }[];
  // Records deleted. The cause is "unreadable" (the record could not be loaded), "no-container" (no candidate names its
  // container) or "verdict-failed" (its container failed the verdict and was removed).
  readonly deleted: readonly { readonly sessionId: string; readonly cause: string }[];
  readonly counts: { readonly adopted: number; readonly removed: number; readonly deleted: number };
}

interface StoredRecord {
  readonly sessionId: string;
  readonly record: SessionRecord | undefined;
}

interface SweepPlan<Property extends string = string> {
  readonly adopted: SelectiveReapResult["adopted"];
  readonly removed: SelectiveReapResult<Property>["removed"];
  readonly deleted: SelectiveReapResult["deleted"];
}

// Runs the selective reap. The sweep never deletes a record: the records are deleted here, only after the sweep has resolved
// with every removal proven. A sweep that misses the bound rejects, and its late result is ignored, so it deletes no record.
// Once the bound expires the sweep starts no further removal, so a late sweep cannot remove a container either. The promise
// settles only after every removal and the proof have finished, or the bound has rejected it.
export async function reapStartupSelective<Property extends string>(deps: SelectiveReapDeps<Property>): Promise<SelectiveReapResult<Property>> {
  const sweep = { open: true };
  const plan = await withTimeout(runSelectiveSweep(deps, sweep), REAP_SWEEP_TIMEOUT_MS, "PODMAN_MACHINE_DOWN").catch(
    (error: unknown) => {
      sweep.open = false;
      throw error;
    },
  );
  for (const { sessionId } of plan.deleted) {
    deps.store.delete(sessionId);
  }
  return {
    adopted: plan.adopted,
    removed: plan.removed,
    deleted: plan.deleted,
    counts: { adopted: plan.adopted.length, removed: plan.removed.length, deleted: plan.deleted.length },
  };
}

// Reads the records, lists and inspects the candidates, judges them, then removes and proves the removals. Nothing is deleted here.
async function runSelectiveSweep<Property extends string>(deps: SelectiveReapDeps<Property>, sweep: { open: boolean }): Promise<SweepPlan<Property>> {
  const records = readRecords(deps.store);
  const candidates = (await deps.listCandidates()).map(inspectedOrThrow);
  const plan = await judge(deps, records, candidates);
  const removalCodes = await removeAndProve(
    deps,
    plan.removed.map((entry) => entry.containerId),
    sweep,
  );
  return {
    ...plan,
    removed: plan.removed.map((entry) => {
      const removalCode = removalCodes.get(entry.containerId);
      return removalCode === undefined ? entry : { ...entry, removalCode };
    }),
  };
}

// Every stored record. A record that cannot be loaded names no container, so it is deleted as unreadable. Its container, if one
// is still running, is then a candidate with no record and is removed as such.
function readRecords(store: Pick<SessionStore, "list" | "load">): readonly StoredRecord[] {
  return store.list().map((sessionId): StoredRecord => {
    try {
      return { sessionId, record: store.load(sessionId) ?? undefined };
    } catch {
      return { sessionId, record: undefined };
    }
  });
}

// A candidate whose inspection failed rejects the whole reap before anything is removed. The next start retries.
function inspectedOrThrow(candidate: ReapCandidate): InspectedCandidate {
  if (!candidate.inspection.ok) {
    throw makeRealmError("REALM_STOPPING", causeOf(candidate.inspection.error));
  }
  return { containerId: candidate.containerId, labels: candidate.labels, inspect: candidate.inspection.inspect };
}

// Matches each record to the candidate that carries its container id, and decides adoption, removal and deletion. Every
// verdict is taken here, before any removal, so a verdict that throws rejects the reap with nothing removed.
async function judge<Property extends string>(
  deps: SelectiveReapDeps<Property>,
  records: readonly StoredRecord[],
  candidates: readonly InspectedCandidate[],
): Promise<SweepPlan<Property>> {
  const byContainer = new Map<string, InspectedCandidate>(
    candidates.map((candidate): [string, InspectedCandidate] => [candidate.containerId, candidate]),
  );
  const named = new Set<string>();
  const adopted: { sessionId: string; containerId: string }[] = [];
  const removed = new Map<string, Property | "no-record">();
  const deleted: { sessionId: string; cause: string }[] = [];
  for (const { sessionId, record } of records) {
    if (record === undefined) {
      deleted.push({ sessionId, cause: "unreadable" });
      continue;
    }
    const candidate = typeof record.containerId === "string" ? byContainer.get(record.containerId) : undefined;
    if (candidate === undefined) {
      deleted.push({ sessionId, cause: "no-container" });
      continue;
    }
    named.add(candidate.containerId);
    const verdict = await deps.verdict(record, candidate);
    if (verdict.ok) {
      adopted.push({ sessionId, containerId: candidate.containerId });
    } else {
      removed.set(candidate.containerId, verdict.property);
      deleted.push({ sessionId, cause: "verdict-failed" });
    }
  }
  for (const candidate of candidates) {
    if (!named.has(candidate.containerId)) {
      removed.set(candidate.containerId, "no-record");
    }
  }
  return {
    adopted,
    removed: [...removed].map(([containerId, cause]) => ({ containerId, cause })),
    deleted,
  };
}

// Removes every planned container, then proves the removals with one listing taken after all of them. A removal that
// throws is still proven when the listing no longer holds the container, as the sweep's own removal is. A container the
// listing still holds, or a listing that fails, rejects the reap with REALM_STOPPING. Every removal's code is returned, proven or not.
async function removeAndProve(deps: SelectiveReapDeps, containerIds: readonly string[], sweep: { open: boolean }): Promise<ReadonlyMap<string, ErrorCode | undefined>> {
  if (containerIds.length === 0) {
    return new Map();
  }
  const failures = new Map<string, ErrorCode | undefined>();
  for (const containerId of containerIds) {
    if (!sweep.open) {
      throw makeRealmError("PODMAN_MACHINE_DOWN");
    }
    try {
      await deps.remove(containerId);
    } catch (error: unknown) {
      failures.set(containerId, causeOf(error));
    }
  }
  let survivors: ReadonlySet<string>;
  try {
    survivors = new Set(await deps.listSurvivors());
  } catch (error: unknown) {
    throw makeRealmError("REALM_STOPPING", causeOf(error));
  }
  for (const containerId of containerIds) {
    if (survivors.has(containerId)) {
      throw makeRealmError("REALM_STOPPING", failures.get(containerId));
    }
  }
  return failures;
}

// The catalogue code of a RealmError, or undefined for any other error.
function causeOf(error: unknown): ErrorCode | undefined {
  return error instanceof RealmError ? error.code : undefined;
}

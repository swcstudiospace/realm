// Startup reaper (D-84, D-86, RT-08). Containers are removed before records. The sweep runs first and
// proves zero surviving realm-labelled containers; only then is every session record deleted. A crash
// during the reap therefore leaves the records the next start needs, and a second reap is a no-op. A record
// with a null container id (a crash during realm up, D-86) is reaped by the label sweep, not by its id.
// A failed sweep rejects before any record is touched, so every record stays in place.
//
// This module imports no runtime module (D-50). The sweep arrives as a function argument.

import { withTimeout } from "../core/timeout.js";
import type { SessionStore } from "./store.js";

export interface ReapDeps {
  readonly store: Pick<SessionStore, "list" | "delete">;
  // Removes every realm-labelled container and resolves with the count removed. It rejects with
  // REALM_STOPPING when any container survives, and reapStartup then deletes no record.
  readonly sweep: () => Promise<number>;
}

export interface ReapResult {
  readonly containersRemoved: number;
  readonly recordsDeleted: number;
}

// Bound for the whole injected sweep: one listing, one removal per container, and the proving second listing.
// A sweep that does not finish in time rejects with PODMAN_MACHINE_DOWN, the code D-53 gives a runtime socket
// timeout, before any record is touched; the next start reaps again.
export const REAP_SWEEP_TIMEOUT_MS = 60_000;

// Runs the reap. Single-owner precondition (D-87, OQ-P4-06): it must run before any LifecycleController or
// ToolDispatcher exists in the process, and only one host daemon may own the state directory. Nothing here
// checks that another process is not reaping or using a live session; that cross-process check belongs to
// Phase 6. Until then, a second process reaping the same state directory is an accepted residual risk.
export async function reapStartup(deps: ReapDeps): Promise<ReapResult> {
  const containersRemoved = await withTimeout(deps.sweep(), REAP_SWEEP_TIMEOUT_MS, "PODMAN_MACHINE_DOWN");
  const ids = deps.store.list();
  for (const id of ids) {
    deps.store.delete(id);
  }
  return { containersRemoved, recordsDeleted: ids.length };
}

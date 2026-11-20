// The reach observation of the command drive (Phase 47, plan 47-01; 47-CONTEXT D-47-06): right after the host command returns, whether the
// production stack was reached. It polls every REACH_POLL_MS for up to the window and records, per poll, the state `realm status` gives for
// the project, the count of sandboxes and of containers of the project, the count of `attached` boot reports for the host in
// `realm metrics`, and the catalogue codes found in the server's stderr copy. The run is REACHED when at any poll a sandbox of the project
// exists, a container of the project exists or an attached boot report was counted (the predicate of wire-timeline.ts, shared).
//
// Every observation is an injected seam, so the loop is tested without Podman, a daemon or a clock. A seam that throws is recorded as an
// observation failure for that poll (its name only, never its message) and never aborts the run. The production seams are built by
// host-live.ts from the helpers of production-live.ts.

import { pollReached, REACH_POLL_MS, REACH_WINDOW_MS, type ReachPoll } from "./wire-timeline.js";

export { REACH_POLL_MS, REACH_WINDOW_MS };

export interface ReachClock {
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
}

export type ReachSeamName = "status" | "containers" | "sandboxes" | "attached" | "stderr";

export interface ReachSeams {
  // The lifecycle state `realm status` gives for the project, or undefined when it gives none.
  readonly status: () => Promise<string | undefined>;
  readonly containers: () => Promise<number>;
  readonly sandboxes: () => Promise<number>;
  // The `attached` boot reports for the host.
  readonly attached: () => Promise<number>;
  // The catalogue codes the server's stderr copy names so far.
  readonly stderrCodes: () => Promise<readonly string[]>;
  readonly clock: ReachClock;
}

// One poll as recorded: the counts of the predicate, the status state, and the seams that failed on this poll.
export interface ReachRecord extends ReachPoll {
  readonly state?: string;
  readonly failed?: readonly ReachSeamName[];
}

export interface ReachObservation {
  readonly polls: readonly ReachRecord[];
  // The index of the first poll at which the run was reached; null when none.
  readonly firstReachedIndex: number | null;
  readonly reached: boolean;
  // The sorted union of the catalogue codes seen across the polls.
  readonly catalogueCodes: readonly string[];
  // The sorted names of the seams that failed on at least one poll.
  readonly failedSeams: readonly ReachSeamName[];
}

export interface ReachOptions {
  readonly windowMs?: number;
  readonly pollMs?: number;
}

// Polls until reached or until the window has passed on the clock. The first poll is taken at once, and one more at the deadline, so a
// stack that appears just before the bound is still seen. Never rejects.
export async function observeReach(seams: ReachSeams, options: ReachOptions = {}): Promise<ReachObservation> {
  const windowMs = options.windowMs ?? REACH_WINDOW_MS;
  const pollMs = options.pollMs ?? REACH_POLL_MS;
  const { clock } = seams;
  const start = clock.now();
  const polls: ReachRecord[] = [];
  const codes = new Set<string>();
  const failedSeams = new Set<ReachSeamName>();
  let firstReachedIndex: number | null = null;
  for (;;) {
    const failed: ReachSeamName[] = [];
    const attempt = async <T>(name: ReachSeamName, read: () => Promise<T>): Promise<T | undefined> => {
      try {
        return await read();
      } catch {
        failed.push(name);
        failedSeams.add(name);
        return undefined;
      }
    };
    const atMs = Math.round(clock.now() - start);
    const state = await attempt("status", seams.status);
    const containers = await attempt("containers", seams.containers);
    const sandboxes = await attempt("sandboxes", seams.sandboxes);
    const attached = await attempt("attached", seams.attached);
    for (const code of (await attempt("stderr", seams.stderrCodes)) ?? []) {
      codes.add(code);
    }
    const counts = {
      ...(sandboxes === undefined ? {} : { sandboxes }),
      ...(containers === undefined ? {} : { containers }),
      ...(attached === undefined ? {} : { attached }),
    };
    polls.push({ atMs, ...counts, ...(state === undefined ? {} : { state }), ...(failed.length === 0 ? {} : { failed }) });
    if (pollReached(counts)) {
      firstReachedIndex = polls.length - 1;
      break;
    }
    const remaining = windowMs - (clock.now() - start);
    if (remaining <= 0) {
      break;
    }
    await clock.sleep(Math.min(pollMs, remaining));
  }
  return { polls, firstReachedIndex, reached: firstReachedIndex !== null, catalogueCodes: [...codes].sort(), failedSeams: [...failedSeams].sort() };
}

// The daemon's stop of every admitted session: sequential, each session under the teardown bound.

import type { ErrorCode } from "../core/errors.js";
import { withTimeout } from "../core/timeout.js";
import { codeOf, type SessionEntry } from "./sessions.js";

export interface StopSessionsResult {
  readonly failure: ErrorCode | undefined;
  readonly failedTeardowns: number;
}

// Stops each entry in iteration order: its health loop first, then its controller under boundMs. The wait is bounded; expiry is
// REALM_STOPPING, the code the controller reports for its own teardown bound (the catalogue has no teardown-timeout code), and a
// stage that ran out of its own bound reports that stage's code. A rejection adds one to failedTeardowns and the first code is kept.
export async function stopSessions(
  entries: Iterable<Pick<SessionEntry, "health" | "handle">>,
  boundMs: number,
): Promise<StopSessionsResult> {
  let failure: ErrorCode | undefined;
  let failedTeardowns = 0;
  for (const entry of entries) {
    entry.health.dispose();
    try {
      await withTimeout(entry.handle.controller.stop(), boundMs, "REALM_STOPPING");
    } catch (error: unknown) {
      // Callers that stop the daemon without awaiting the stop discard its result; daemon.stopped carries the first failure code and the count.
      const code = codeOf(error);
      failedTeardowns += 1;
      failure ??= code;
    }
  }
  return { failure, failedTeardowns };
}

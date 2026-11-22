// The daemon's stop of every admitted session: sequential, each session under the teardown bound.

import { RealmError, type ErrorCode } from "../core/errors.js";
import { withTimeout } from "../core/timeout.js";
import { codeOf, type SessionEntry } from "./sessions.js";

export interface StopSessionsResult {
  readonly failure: ErrorCode | undefined;
  // The first failed session's own cause code, when its stop reported one (Phase 56, STOP-05): the catalogue code the
  // primary failure rests on, carried additively so the daemon.stopped row can name the failed step's cause. Undefined
  // when the first failure carried no cause, which is the Phase 51 gap shape.
  readonly causeCode: ErrorCode | undefined;
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
  let causeCode: ErrorCode | undefined;
  let failedTeardowns = 0;
  for (const entry of entries) {
    entry.health.dispose();
    try {
      await withTimeout(entry.handle.controller.stop(), boundMs, "REALM_STOPPING");
    } catch (error: unknown) {
      // Callers that stop the daemon without awaiting the stop discard its result; daemon.stopped carries the first failure code and the count.
      const code = codeOf(error);
      failedTeardowns += 1;
      if (failure === undefined) {
        failure = code;
        causeCode = error instanceof RealmError ? error.causeCode : undefined;
      }
    }
  }
  return { failure, causeCode, failedTeardowns };
}

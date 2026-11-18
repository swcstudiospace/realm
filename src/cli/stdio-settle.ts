// What `realm mcp` does when the background boot settles (Phase 33, D-33-05). The server is already serving, so a settled boot
// can no longer be a failed connect: it is a diagnostic written once, and a decision whether the process exits 1 at stdin end.
// Pure: the texts come from the two injected functions, so the table is tested without a session.

import { makeRealmError, type ErrorCode, type RealmError } from "../core/errors.js";
import { isRetryableAttachCode } from "../host/boot.js";
import type { BootDriverOutcome } from "../host/boot-driver.js";

interface SettleInput {
  readonly outcome: BootDriverOutcome;
  // The refusal of the last attach that resolved with one, or null.
  readonly refusal: RealmError | null;
  readonly reattach: boolean;
  // The stderr text of an error the attach produced or the daemon answered with.
  readonly attachFailure: (error: unknown) => string;
  // The stderr text of an attach that never reached a daemon.
  readonly failureText: (code: ErrorCode) => string;
}

interface Settled {
  // The text to write to stderr once, or null.
  readonly diagnostic: string | null;
  // True only for the row that used to exit 1 before any frame: no daemon answered and no re-attach is armed.
  readonly noClient: boolean;
}

export function describeSettle(input: SettleInput): Settled {
  const { outcome } = input;
  if (outcome.kind === "ready") {
    return { diagnostic: null, noClient: false };
  }
  if (outcome.kind === "refused" || outcome.daemonAnswered) {
    return { diagnostic: input.attachFailure(input.refusal ?? makeRealmError("REALM_NOT_ACTIVE")), noClient: false };
  }
  const code = outcome.code ?? "REALM_NOT_ACTIVE";
  if (input.reattach && isRetryableAttachCode(code)) {
    return { diagnostic: null, noClient: false };
  }
  return { diagnostic: input.failureText(code), noClient: true };
}

// The exit code once stdin has ended: 1 only when no client was adopted by the settle and none has been since.
export function exitCodeAfterClose(noClient: boolean, outcome: BootDriverOutcome): number {
  return noClient && outcome.kind === "failed" ? 1 : 0;
}

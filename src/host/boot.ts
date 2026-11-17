// Host-neutral boot-hook helpers (Phase 21, HOST-04). Pure values and functions only: the bounds every host plugin's
// attach, status, guard and re-attach behavior is held to, and the small rules those hooks share.
//
// These are the Omp plugin's seams (src/omp/plugin.ts, src/omp/reattach.ts) stated once for every host. src/host never
// imports src/omp: the values below are duplicated on purpose, and test/host/boot.test.ts holds the two sides equal. Phase 22
// moves Omp onto this module and deletes the duplicates in src/omp together with that parity test.
//
// A hook takes its bounds from resolveBoot and never hard-codes them. This module reads no environment and arms no timer of
// its own: withStartupBudget delegates to withTimeout, which clears its timer as soon as the work settles.

import type { PolicyMode } from "../contract/validate.js";
import { RealmError, type ErrorCode } from "../core/errors.js";
import { withTimeout } from "../core/timeout.js";
import type { HostGuardVerdict, HostLinkStatus, HostPluginManifest } from "./types.js";

// The re-attach sub-states of a hook's link. "off" is the disabled state.
export type BootLink = HostLinkStatus["link"];

// Every bound a boot hook is built from, after defaults are applied.
export interface ResolvedBoot {
  readonly startupBudgetMs: number;
  readonly guardStatusBudgetMs: number;
  readonly statusPollMs: number;
  readonly reattach: {
    readonly enabled: boolean;
    readonly retryCap: number;
    readonly baseDelayMs: number;
    readonly capDelayMs: number;
  };
  readonly linkLostCodes: readonly ErrorCode[];
  readonly retryableAttachCodes: readonly ErrorCode[];
}

// The defaults. Held equal to the Omp constants by test/host/boot.test.ts:
//   startupBudgetMs     STARTUP_BUDGET_MS in src/omp/plugin.ts (the policy.schema.json startupBudgetMs default)
//   guardStatusBudgetMs GUARD_STATUS_BUDGET_MS in src/omp/plugin.ts
//   statusPollMs        STATUS_POLL_MS in src/omp/plugin.ts
//   reattach.*          REATTACH_RETRY_CAP, REATTACH_BASE_DELAY_MS, REATTACH_DELAY_CAP_MS in src/omp/reattach.ts
//   linkLostCodes       LINK_LOST_CODES in src/omp/reattach.ts
//   retryableAttachCodes RETRYABLE_ATTACH_CODES in src/omp/reattach.ts
const LINK_LOST: readonly ErrorCode[] = ["REALM_NOT_ACTIVE", "TOOL_TIMEOUT"];
const RETRYABLE_ATTACH: readonly ErrorCode[] = [
  "REALM_NOT_ACTIVE",
  "TOOL_TIMEOUT",
  "STARTUP_BUDGET_EXCEEDED",
  "DAEMON_START_TIMEOUT",
];

export const BOOT_BOUNDS: ResolvedBoot = Object.freeze({
  startupBudgetMs: 200_000,
  guardStatusBudgetMs: 5_000,
  statusPollMs: 2_000,
  reattach: Object.freeze({ enabled: false, retryCap: 8, baseDelayMs: 1_000, capDelayMs: 60_000 }),
  linkLostCodes: Object.freeze(LINK_LOST),
  retryableAttachCodes: Object.freeze(RETRYABLE_ATTACH),
});

// The manifest's boot block with every absent field taken from BOOT_BOUNDS. A manifest without a boot block (an mcp-config
// host) yields the defaults. Re-attach stays off unless the manifest enables it.
export function resolveBoot(manifest: HostPluginManifest): ResolvedBoot {
  const boot = manifest.boot;
  const reattach = boot?.reattach;
  return Object.freeze({
    startupBudgetMs: boot?.startupBudgetMs ?? BOOT_BOUNDS.startupBudgetMs,
    guardStatusBudgetMs: BOOT_BOUNDS.guardStatusBudgetMs,
    statusPollMs: BOOT_BOUNDS.statusPollMs,
    reattach: Object.freeze({
      enabled: reattach?.enabled ?? BOOT_BOUNDS.reattach.enabled,
      retryCap: reattach?.retryCap ?? BOOT_BOUNDS.reattach.retryCap,
      baseDelayMs: reattach?.baseDelayMs ?? BOOT_BOUNDS.reattach.baseDelayMs,
      capDelayMs: reattach?.capDelayMs ?? BOOT_BOUNDS.reattach.capDelayMs,
    }),
    linkLostCodes: BOOT_BOUNDS.linkLostCodes,
    retryableAttachCodes: BOOT_BOUNDS.retryableAttachCodes,
  });
}

// Runs the attach path (attach plus its first status read) under the startup budget. Rejects with STARTUP_BUDGET_EXCEEDED
// when the budget elapses first; the timer is cleared as soon as the work settles, so none outlives the call.
export function withStartupBudget<T>(work: Promise<T>, budgetMs: number): Promise<T> {
  return withTimeout(work, budgetMs, "STARTUP_BUDGET_EXCEEDED");
}

// Whether a failed attach is worth another attempt. Only a RealmError whose code is in the retryable list is. Every other
// failure is terminal: a refusal the daemon answered (POLICY_DENIED, for one) and any value that is not a RealmError.
export function attachFailureDisposition(error: unknown): "retryable" | "terminal" {
  return error instanceof RealmError && BOOT_BOUNDS.retryableAttachCodes.includes(error.code) ? "retryable" : "terminal";
}

// The guard backstop. A tool name that is not a string cannot be classified and is refused. A name in passThrough is never
// refused here. Any other name is refused with POLICY_DENIED unless the daemon reports advisory mode; an unknown mode (null)
// counts as fail-closed. Pure, and it never throws: nothing is read from toolName beyond its type.
export function backstopVerdict(
  toolName: unknown,
  mode: PolicyMode | null,
  passThrough: readonly string[],
): HostGuardVerdict | undefined {
  if (typeof toolName !== "string") {
    return { block: true, reason: "realm bad tool call" };
  }
  if (passThrough.includes(toolName)) {
    return undefined;
  }
  return mode === "advisory" ? undefined : { block: true, reason: "POLICY_DENIED" };
}

const REATTACH_TRANSITIONS: Readonly<Record<BootLink, readonly BootLink[]>> = {
  off: [],
  linked: ["reconnecting", "attaching"],
  reconnecting: ["attaching"],
  attaching: ["linked", "reconnecting", "failed"],
  failed: ["attaching"],
};

// Whether a link sub-state may move to another. Every move the table does not list is refused.
// Phase 22 deletes the src/omp/reattach.ts copy of this function and the parity test.
export function reattachTransitionAllowed(from: BootLink, to: BootLink): boolean {
  return Object.hasOwn(REATTACH_TRANSITIONS, from) && REATTACH_TRANSITIONS[from].includes(to);
}

// The delay before re-attach attempt `attempt` (1-based): equal jitter over an exponential ceiling, so the delay lies in
// [ceiling/2, ceiling] and never near zero. random is injected and must return a value in [0, 1].
// Phase 22 deletes the src/omp/reattach.ts copy of this function and the parity test.
export function equalJitterDelayMs(attempt: number, baseMs: number, capMs: number, random: () => number): number {
  if (!Number.isInteger(attempt) || attempt < 1) {
    throw new RangeError(`attempt must be a positive integer, got ${String(attempt)}`);
  }
  if (!Number.isFinite(baseMs) || baseMs < 0 || !Number.isFinite(capMs) || capMs < 0) {
    throw new RangeError("base and cap must be finite and not negative");
  }
  if (baseMs > capMs) {
    throw new RangeError(`base ${String(baseMs)} exceeds cap ${String(capMs)}`);
  }
  const draw = random();
  if (!(draw >= 0 && draw <= 1)) {
    throw new RangeError(`random must return a value in [0, 1], got ${String(draw)}`);
  }
  // The exponent is clamped so the power stays finite; the cap bounds every attempt from the point the ceiling reaches it.
  const ceiling = Math.min(capMs, baseMs * 2 ** Math.min(attempt - 1, 64));
  return Math.round(ceiling / 2 + (draw * ceiling) / 2);
}

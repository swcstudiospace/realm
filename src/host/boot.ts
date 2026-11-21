// Host-neutral boot-hook helpers (Phase 21, HOST-04). Pure values and functions only: the bounds every host plugin's
// attach, status, guard and re-attach behavior is held to, and the small rules those hooks share.
//
// These are the rules the Omp plugin (src/omp/plugin.ts) follows, stated once for every host. Omp is the reference consumer:
// src/omp imports this module and holds no copy of a bound, a code list, the sub-state table or the jitter function.
// src/host never imports src/omp.
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
// `enabled` is the persisted Omp plugin toggle (ADR-0001): true registers 5 Realm tools and paints
// status; false registers 0 tools, 0 retry command and 0 paints. Default true (on).
export interface ResolvedBoot {
  readonly enabled: boolean;
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

// The defaults: the single source for every host plugin. src/omp/plugin.ts consumes them; the policy.schema.json
// startupBudgetMs default is held equal to startupBudgetMs by test/host/boot.test.ts.
const LINK_LOST: readonly ErrorCode[] = ["REALM_NOT_ACTIVE", "TOOL_TIMEOUT"];
const RETRYABLE_ATTACH: readonly ErrorCode[] = [
  "REALM_NOT_ACTIVE",
  "TOOL_TIMEOUT",
  "STARTUP_BUDGET_EXCEEDED",
  "DAEMON_START_TIMEOUT",
];

export const BOOT_BOUNDS: ResolvedBoot = Object.freeze({
  enabled: true,
  startupBudgetMs: 200_000,
  guardStatusBudgetMs: 5_000,
  statusPollMs: 2_000,
  reattach: Object.freeze({ enabled: false, retryCap: 8, baseDelayMs: 1_000, capDelayMs: 60_000 }),
  linkLostCodes: Object.freeze(LINK_LOST),
  retryableAttachCodes: Object.freeze(RETRYABLE_ATTACH),
});

// The manifest's boot block with every absent field taken from BOOT_BOUNDS. A manifest without a boot block (an mcp-config
// host) yields the defaults. Re-attach stays off unless the manifest enables it. The plugin toggle defaults on.
export function resolveBoot(manifest: HostPluginManifest): ResolvedBoot {
  const boot = manifest.boot;
  const reattach = boot?.reattach;
  return Object.freeze({
    enabled: boot?.enabled ?? BOOT_BOUNDS.enabled,
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
// The persisted Omp plugin toggle operations (ADR-0001, US-112; API-RealmOmpPlugin 1.0.0,
// `getPluginToggle`/`setPluginToggle`). The store is the `boot` block of the host plugin manifest
// (`SC-PluginBoot`, M-2026-006): absence means on, `false` registers 0 Realm tools, 0 retry command
// and 0 paints. Realm owns no manifest file, so `setPluginToggle` is pure: it returns the updated
// manifest and the caller persists it through its own settings store; restarting the host then
// re-resolves the same value (AC-38). The `correlationId` is paired verbatim into every response.
export interface PluginToggleResponse {
  readonly enabled: boolean;
  readonly correlationId: string;
}

export interface PluginToggleRequest {
  readonly enabled: boolean;
  readonly correlationId: string;
}

// GET /plugin/toggle: the persisted toggle value from the passed manifest; on when no setting is stored.
export function getPluginToggle(manifest: HostPluginManifest, correlationId: string): PluginToggleResponse {
  return { enabled: resolveBoot(manifest).enabled, correlationId };
}

// PUT /plugin/toggle: the manifest with `boot.enabled` set and every other boot field (including
// `reattach.enabled`, orthogonal by design) preserved untouched. Both inputs are already typed and
// validated by the manifest parser at their own edges, so no re-validation happens here: this
// module stays host-neutral and must not import the manifest parser (OMPR-05 closure budget,
// test/omp/extension-load.test.ts pins the plugin closure at 9 modules).
export function setPluginToggle(manifest: HostPluginManifest, request: PluginToggleRequest): HostPluginManifest {
  return { ...manifest, boot: { ...manifest.boot, enabled: request.enabled } };
}


// Runs the attach path (attach plus its first status read) under the startup budget. Rejects with STARTUP_BUDGET_EXCEEDED
// when the budget elapses first; the timer is cleared as soon as the work settles, so none outlives the call.
export function withStartupBudget<T>(work: Promise<T>, budgetMs: number): Promise<T> {
  return withTimeout(work, budgetMs, "STARTUP_BUDGET_EXCEEDED");
}

// Whether a failed attach is worth another attempt. Only a RealmError whose code is in the retryable list is. Every other
// failure is terminal: a refusal the daemon answered (POLICY_DENIED, for one) and any value that is not a RealmError.
export function attachFailureDisposition(error: unknown): "retryable" | "terminal" {
  return error instanceof RealmError && isRetryableAttachCode(error.code) ? "retryable" : "terminal";
}

// Whether a code means the link to the daemon is lost: a dropped channel, or a status read that outlived its bound. Takes a
// string because a plugin outcome carries its code as one. Exact match only: no case folding, no trimming.
export function isLinkLostCode(code: string): boolean {
  return BOOT_BOUNDS.linkLostCodes.some((listed) => listed === code);
}

// Whether an attach failure code is worth another attempt. Every other failure, a refusal the daemon answered included,
// is terminal. Exact match only.
export function isRetryableAttachCode(code: string): boolean {
  return BOOT_BOUNDS.retryableAttachCodes.some((listed) => listed === code);
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

// The re-attach sub-state table. Re-attach is off unless the plugin's reattach option is enabled (O4; spec
// SANDBOX_OMP_PLUGIN_CONNECTION). A dropped link (a failed read whose code isLinkLostCode accepts) then re-attaches on a
// bounded schedule: equal-jitter waits grown from reattach.baseDelayMs and capped at reattach.capDelayMs, at most
// reattach.retryCap of them. Each attempt runs the attach path under startupBudgetMs, and each status read stays under
// guardStatusBudgetMs. The status item keeps its six existing names: linked is active, attaching and reconnecting are
// connecting, failed is error. The frozen state table has no wait state, so none is added.
const REATTACH_TRANSITIONS: Readonly<Record<BootLink, readonly BootLink[]>> = {
  off: [],
  linked: ["reconnecting", "attaching"],
  reconnecting: ["attaching"],
  attaching: ["linked", "reconnecting", "failed"],
  failed: ["attaching"],
};

// Whether a link sub-state may move to another. Every move the table does not list is refused.
// src/omp/plugin.ts reads this one copy.
export function reattachTransitionAllowed(from: BootLink, to: BootLink): boolean {
  return Object.hasOwn(REATTACH_TRANSITIONS, from) && REATTACH_TRANSITIONS[from].includes(to);
}

// The delay before re-attach attempt `attempt` (1-based): equal jitter over an exponential ceiling, so the delay lies in
// [ceiling/2, ceiling] and never near zero. random is injected and must return a value in [0, 1].
// Delays are a pure function of the attempt, the bounds and one injected draw; src/omp/plugin.ts reads this one copy.
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

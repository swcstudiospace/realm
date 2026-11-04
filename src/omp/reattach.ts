// Re-attach policy (O4; spec SANDBOX_OMP_PLUGIN_CONNECTION): the pure rules the Omp plugin's re-attach state machine reads.
// This module imports nothing. plugin.ts owns the timers, the client, and the status item; it reads these rules from here.

// ---- Re-attach (O4; spec SANDBOX_OMP_PLUGIN_CONNECTION) ----------------------
// Off unless RealmPluginOptions.reattach is enabled. A dropped link (a failed read whose code is in LINK_LOST_CODES) then
// re-attaches on a bounded schedule: equal-jitter waits grown from REATTACH_BASE_DELAY_MS and capped at REATTACH_DELAY_CAP_MS,
// at most REATTACH_RETRY_CAP of them. Each attempt runs the attach path under STARTUP_BUDGET_MS, and each status read stays under
// GUARD_STATUS_BUDGET_MS. The status item keeps the six existing names: the host-side wait paints as connecting, FAILED as error.

export const REATTACH_RETRY_CAP = 8;
export const REATTACH_BASE_DELAY_MS = 1_000;
export const REATTACH_DELAY_CAP_MS = 60_000;
// The codes that mean the link to the daemon is lost: a dropped channel, or a status read that outlived its bound.
export const LINK_LOST_CODES: readonly string[] = Object.freeze(["REALM_NOT_ACTIVE", "TOOL_TIMEOUT"]);
// The attach failures worth another attempt. Every other failure, a refusal the daemon answered included, reaches FAILED at once.
export const RETRYABLE_ATTACH_CODES: readonly string[] = Object.freeze([
  "REALM_NOT_ACTIVE",
  "TOOL_TIMEOUT",
  "STARTUP_BUDGET_EXCEEDED",
  "DAEMON_START_TIMEOUT",
]);

// The re-attach sub-states. "off" is the disabled state. The rest are host-side and map onto the existing names: linked is
// active, attaching and reconnecting are connecting, failed is error. The frozen state table has no wait state, so none is added.
export type ReattachState = "off" | "linked" | "reconnecting" | "attaching" | "failed";

const REATTACH_TRANSITIONS: Readonly<Record<ReattachState, readonly ReattachState[]>> = {
  off: [],
  linked: ["reconnecting", "attaching"],
  reconnecting: ["attaching"],
  attaching: ["linked", "reconnecting", "failed"],
  failed: ["attaching"],
};

// Whether a sub-state may move to another. Every move the table does not list is refused.
export function reattachTransitionAllowed(from: ReattachState, to: ReattachState): boolean {
  return Object.hasOwn(REATTACH_TRANSITIONS, from) && REATTACH_TRANSITIONS[from].includes(to);
}

// The delay before re-attach attempt `attempt` (1-based): equal jitter over an exponential ceiling, so the delay lies in
// [ceiling/2, ceiling] and never near zero. random is injected and must return a value in [0, 1].
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

// Advisory and resume rendering for the Omp host notice region (SCR-Tb559W3Matrix, AC-78..AC-81;
// SCR-UltrathinkPlanAdvisory, AC-65/66/67/71/72/73; SCR-UltrathinkReloadResume, AC-68/69/70).
// API-UltrathinkCompletionGate 1.1.0, `getGateAdvisory` (`/gate/advisory`).
//
// This module is the frontend surface of the completion gate: pure text rendering of the
// contract's AdvisoryResponse plus the host tracker snapshot (done/total rows) the response
// does not carry. Text first, color second (NFR-A1): every line is a self-describing label;
// the host paints with the design tokens (color.surface.advisory, color.border.advisory,
// color.status.warning) and the advisory is role="status" aria-live="polite", non-interactive,
// never in tab order (spec SCR-Tb559W3Matrix / SCR-UltrathinkPlanAdvisory).
//
// The render carries 0 of the 3 banned blocking strings: no blocking prompt, no manual step,
// no dark pattern — the pending count is stated as a fact. A complete plan renders 0 advisories
// (null) on the live render and again after reload, so a reload cannot resurrect a stale
// advisory. An unchanged poll repaints nothing (renderCount stays 1).

export const ADVISORY_WIDGET_KEY = "realm-ultrathink-advisory";

export const CONTINUES_LINE = "Planning continues automatically under autonomous mode.";
export const WARNING_LINE = "Warning: incomplete-verdict refresh pending.";
export const MATRIX_VERIFIED_LINE =
  "4 of 4 cases verified (complete/silent live+reload, incomplete/advisory-once, no-second-prompt, malformed/named-failure)";

/** API-UltrathinkCompletionGate 1.1.0 `AdvisoryResponse` (docs/architecture/contracts/). */
export interface AdvisoryResponse {
  readonly note: string;
  readonly pendingRows: number;
  readonly continues: boolean;
  readonly warningLines: number;
  readonly correlationId: string;
  readonly graphId?: string;
  readonly unblockingAction?: string;
  readonly renderCount?: number;
  readonly failure?: {
    readonly code: string;
    readonly detail: string;
  };
}

/** The host tracker snapshot the renderer formats: done/total rows plus the AC-79 fields. */
export interface AdvisoryPlanState {
  readonly graphId: string;
  readonly doneRows: number;
  readonly totalRows: number;
  readonly pendingRows: number;
  readonly unblockingAction: string;
  /** How many times this unchanged state has already rendered (AC-80); 1 = first render. */
  readonly renderCount: number;
}

/** The one named failure line for malformed or missing plan state (AC-81). */
export function renderStateFailure(failure: { readonly code: string; readonly detail: string }): string {
  return `Plan state unreadable — ${failure.code}: ${failure.detail}; planning continues from the last known good snapshot.`;
}

/**
 * Renders the incomplete-plan advisory as exactly 3 lines (AC-79): the row-count headline
 * naming the graph id, one unblocking action, and the autonomous-continuation line.
 * Returns null when the plan is complete (AC-78 silence) or when unchanged state has already
 * rendered (AC-80: a second poll adds no second prompt).
 */
export function renderAdvisory(state: AdvisoryPlanState): string[] | null {
  if (state.pendingRows === 0) return null;
  if (state.renderCount > 1) return null;
  return [
    `Plan tracker (graph ${state.graphId}): ${String(state.doneRows)}/${String(state.totalRows)} rows set — ${String(state.pendingRows)} pending.`,
    `Unblocking action: ${state.unblockingAction}.`,
    CONTINUES_LINE,
  ];
}

/** Adapts a contract AdvisoryResponse plus the host tracker snapshot into paint-ready lines. */
export function renderAdvisoryResponse(response: AdvisoryResponse, state: AdvisoryPlanState): string[] | null {
  if (response.failure !== undefined) return [renderStateFailure(response.failure)];
  const merged: AdvisoryPlanState = {
    graphId: response.graphId ?? state.graphId,
    doneRows: state.doneRows,
    totalRows: state.totalRows,
    pendingRows: response.pendingRows,
    unblockingAction: response.unblockingAction ?? state.unblockingAction,
    renderCount: response.renderCount ?? state.renderCount,
  };
  return renderAdvisory(merged);
}

/** loading.polling: the poll itself never blocks the composer and never adds prompts. */
export function renderPollingLine(elapsedMs: number): string {
  return `Reading plan state… (${String(elapsedMs)} ms elapsed)`;
}

/** loading.restoring for the reload-resume line. */
export function renderRestoringLine(elapsedMs: number): string {
  return `Restoring settled answers… (${String(elapsedMs)} ms elapsed)`;
}

/** SCR-UltrathinkReloadResume default.resumed / success.kickoff-resumed (AC-68, AC-69). */
export function renderResumeLine(settled: number, totalAnswers: number, step: number, totalSteps: number): string[] {
  return [
    `Session restored — ${String(settled)} of ${String(totalAnswers)} settled answers active.`,
    `Work resumes at recorded step ${String(step)} of ${String(totalSteps)}.`,
  ];
}

/** SCR-UltrathinkReloadResume empty.fresh-plan: a fresh plan is stated, not blank. */
export function renderFreshPlanLine(): string {
  return "No settled answers on file — plan starts fresh.";
}

/** SCR-UltrathinkReloadResume error.restore-failed: never paints a false resumed state. */
export function renderRestoreFailedLine(cause: string): string {
  return `Session restore incomplete — settled answers unavailable (${cause}); planning starts from scratch.`;
}

/** success.verified matrix log line (SCR-Tb559W3Matrix). */
export function renderMatrixVerifiedLine(): string {
  return MATRIX_VERIFIED_LINE;
}

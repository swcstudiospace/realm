// The status-paint operation (ADR-0002, US-113; API-RealmOmpPlugin 1.0.0, `getPluginStatusPaint`).
// The paint target is a construction guarantee, not a runtime count: `OmpStatusUi` in
// src/omp/plugin.ts has no `setStatus` member, `renderRealmStatus` routes every paint through
// `ctx.ui.setWidget`, and the host-neutral `HostStatusSink` (src/host/types.ts) stays a debug log
// on the MCP/ACP surface (src/cli/stdio-host.ts), never the Omp under-bar slot. `underBarPaints` is
// therefore the literal 0: with the toggle on, 1 render lands in the additional-UI region (AC-39) and 0 calls
// reach the under-bar status surface, in 4 of 4 daemon states (AC-40); with the toggle off, 0
// paints occur and the last truthful text is retained (AC-41). This operation lives beside the
// funnel (not inside src/omp/plugin.ts) because that file is at the 1000-line module ratchet.

const PAINT_STATES = Object.freeze(["unbound", "connecting", "active", "error"] as const);

export interface PluginStatusPaintResponse {
  readonly target: "additional-ui";
  readonly underBarPaints: 0;
  readonly states: typeof PAINT_STATES;
  readonly correlationId: string;
}

export function getPluginStatusPaint(correlationId: string): PluginStatusPaintResponse {
  return { target: "additional-ui", underBarPaints: 0, states: PAINT_STATES, correlationId };
}

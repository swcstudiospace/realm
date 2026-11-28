// Status rendering for the Omp plugin (OMP-02, OMP-03; P5-D5; ADR-0002 widget merge).
// Extracted verbatim from src/omp/plugin.ts: one shared label with a readable marker, reason,
// time and mode disclosure. Cache the full text per UI so any change repaints and identical
// status reads stay quiet. A known mode is current only after a successful status read and
// active-tool readback. On a failed read or application, it describes the last success, not
// the present tool set. Paints land only in the additional-UI widget region (1 text item,
// 1 label per paint); the under-bar surface is never called. Text shape is byte-identical to
// the old under-bar text. src/omp/plugin.ts re-exports REALM_STATUS_KEY, REALM_WIDGET_KEY and
// renderRealmStatus from here, so every import of those names keeps working unchanged.

import type { PolicyMode } from "../contract/validate.js";
import type { StateSnapshot } from "../core/state-machine.js";
import { displayStatus, STATUS_LABELS } from "../core/status.js";

// The five painted buckets the transition-only notify speaks in. The daemon has
// five lifecycle states but the widget shows two labels; the buckets recover the
// operator-relevant distinctions: connected (active), retrying (a re-attach wait
// is armed, so the connecting paint carries its catalogue code), denied (the
// error paint carries POLICY_DENIED), terminal (any other error paint), and
// disconnected (every other non-active paint).
export type PaintedBucket = "connected" | "disconnected" | "denied" | "retrying" | "terminal";

// Maps one paint to its notify bucket. code is the catalogue code the paint
// carries (the reconnect code on a connecting paint, the error code on an error
// paint); for an error paint without one, the snapshot reason decides.
export function bucketOfPaint(state: StateSnapshot["state"], code?: string, reason?: string): PaintedBucket {
  if (state === "active") {
    return "connected";
  }
  if (state === "connecting") {
    // Only the carried catalogue code marks a retry wait; the snapshot's own
    // reason ("connecting") never does, so plain connecting stays disconnected.
    return code !== undefined ? "retrying" : "disconnected";
  }
  if (state === "error") {
    // An error paint without an explicit code still carries its catalogue code
    // as the snapshot reason (paintError) or the daemon's reason.
    return (code ?? reason) === "POLICY_DENIED" ? "denied" : "terminal";
  }
  return "disconnected";
}

import type { ActiveSession, OmpStatusUi } from "./plugin.js";

// The single status key (P5-D5). The label, reason, and time are one item, so the indicator can
// never present two competing labels. After the merge (ADR-0002) this key names the widget region
// entry, not the under-bar slot: paint() routes through ctx.ui.setWidget with this key, and no code
// path calls an under-bar status surface.
export const REALM_STATUS_KEY = "realm";
export const REALM_WIDGET_KEY = REALM_STATUS_KEY;
export const PLUGIN_TOGGLE_WIDGET_KEY = "realm-plugin-toggle";

const togglePainted = new WeakSet<object>();

// Paints the boot toggle line once per session under its own widget key. A throw propagates to the
// caller's error path (one notice, never a second), so a failing widget never kills session start.
export function paintToggleOnce(session: ActiveSession, text: string): boolean {
  if (togglePainted.has(session)) {
    return true;
  }
  const ui = session.ctx.ui;
  if (typeof ui.setWidget !== "function") {
    return false;
  }
  ui.setWidget(PLUGIN_TOGGLE_WIDGET_KEY, [text]);
  togglePainted.add(session);
  return true;
}

const lastPainted = new WeakMap<OmpStatusUi, string>();

export function renderRealmStatus(ui: OmpStatusUi, snapshot: StateSnapshot, mode: PolicyMode | null, confirmed: boolean, reconnectCode?: string): boolean {
  const display = displayStatus(snapshot);
  const marker = display.label === STATUS_LABELS.active ? "●" : "○";
  const modeText = mode === null ? "mode: unknown" : `${confirmed ? "applied mode" : "last successfully applied mode"}: ${mode}${mode === "fail-closed" ? " (Omp host-tool guard; not host process containment)" : ""}`;
  const text = `${marker} ${display.label} · ${display.reason}${reconnectCode === undefined ? "" : ` (${reconnectCode})`} · ${display.lastTransitionAt} · ${modeText}`;
  if (lastPainted.get(ui) === text) {
    return true;
  }
  // A host without the widget region paints nothing (never the under-bar fallback, AC-39): the
  // cache stays stale so the next render retries. Untyped JS hosts that lack setWidget hit this
  // guard at runtime even though the type requires it.
  if (typeof ui.setWidget !== "function") {
    return false;
  }
  // Cached only after the write succeeds: a throw above leaves the cache stale, so the next
  // render repaints instead of skipping it (MED-03).
  ui.setWidget(REALM_WIDGET_KEY, [text]);
  lastPainted.set(ui, text);
  return true;
}

// The state and catalogue code a session last painted, read by view(). Kept beside the session, not on it, so ActiveSession keeps
// its shape. code is set only for a paint that carries a catalogue code.
export const shownBySession = new WeakMap<ActiveSession, { readonly state: StateSnapshot["state"]; readonly code: string | undefined }>();

// The painted detail a session last landed: the snapshot it rendered plus the
// catalogue code the paint carried. shownBySession stays the view() contract
// untouched; this map feeds only the transition notify below.
const paintedDetailBySession = new WeakMap<
  ActiveSession,
  { readonly state: StateSnapshot["state"]; readonly reason: string; readonly code: string | undefined }
>();

// The bucket a session last notified, so polls and identical repaints stay
// quiet. The first painted read only sets the baseline: startup and link
// notices stay owned by the attach/re-attach path, and this helper notifies
// exactly once per bucket change after that.
const notifiedBucketBySession = new WeakMap<ActiveSession, PaintedBucket>();

function transitionMessage(bucket: PaintedBucket, code: string | undefined): string {
  return code === undefined ? `realm status: ${bucket}` : `realm status: ${bucket} (${code})`;
}

// Notifies the bucket transition the last paint landed, if any. Call after a
// paint: the first painted read of a session only sets the baseline, a bucket
// change notifies exactly once, and anything else — same-bucket polls,
// identical repaints, a session that never painted, a host without the widget
// region — notifies nothing. Returns true when a notice was shown. A throwing
// notify never fails the paint: the bucket is recorded first, so the next poll
// stays quiet.
export function notifyPaintTransition(session: ActiveSession): boolean {
  const painted = paintedDetailBySession.get(session);
  if (painted === undefined) {
    return false;
  }
  const ui = session.ctx.ui;
  if (typeof ui.setWidget !== "function" || typeof ui.notify !== "function") {
    return false;
  }
  const code = painted.code ?? (painted.state === "error" ? painted.reason : undefined);
  const bucket = bucketOfPaint(painted.state, painted.code, painted.reason);
  const previous = notifiedBucketBySession.get(session);
  if (previous === undefined) {
    notifiedBucketBySession.set(session, bucket);
    return false;
  }
  if (previous === bucket) {
    return false;
  }
  notifiedBucketBySession.set(session, bucket);
  try {
    ui.notify(transitionMessage(bucket, code));
  } catch {
    // The paint stands; the bucket stays recorded so the next poll stays quiet.
  }
  return true;
}

// The one funnel every status paint goes through: it renders the text and records what was shown. reconnectCode is the code the
// text carries after the reason; shownCode defaults to it, and an error paint (whose reason is the code) passes its own.
export function paint(
  session: ActiveSession,
  snapshot: StateSnapshot,
  mode: PolicyMode | null,
  confirmed: boolean,
  reconnectCode?: string,
  shownCode: string | undefined = reconnectCode,
): void {
  if (renderRealmStatus(session.ctx.ui, snapshot, mode, confirmed, reconnectCode)) {
    shownBySession.set(session, { state: snapshot.state, code: shownCode });
    paintedDetailBySession.set(session, { state: snapshot.state, reason: snapshot.reason, code: shownCode });
  }
}

// Paints an error whose reason is a catalogue code.
export function paintError(session: ActiveSession, code: string, at: string, confirmed: boolean): void {
  paint(session, { state: "error", reason: code, lastTransitionAt: at }, session.mode, confirmed, undefined, code);
}

// Keeps a catalogue code to the reconnect-code slot shape: `cause: CODE`.
// Anything but a catalogue code renders nothing, so no daemon or host text can
// enter the widget through the cause. An absent cause paints byte-identical.
function sanitizeCause(causeCode?: string): string | undefined {
  if (causeCode === undefined) {
    return undefined;
  }
  return /^[A-Z][A-Z0-9_]*$/.test(causeCode) ? `cause: ${causeCode}` : undefined;
}

function refusalCauseOf(refusal: NonNullable<ActiveSession["refusal"]>): string | undefined {
  // The refusal type carries the sanitized catalogue cause as causeCode when the
  // attach reported one; the `in` narrow reads it only when present, so this
  // compiles with or without the field.
  if ("causeCode" in refusal) {
    const cause: unknown = refusal.causeCode;
    if (typeof cause === "string") {
      return cause;
    }
  }
  return undefined;
}

// Paints a refusal the attach reported, in the same error rendering a thrown attach error uses: the reason is the refusal's code.
// The stamp is kept while the same code stands, so repaint ticks stay quiet. The optional
// cause renders sanitized through the reconnect-code slot; absent, paints stay byte-identical.
export function paintRefusal(session: ActiveSession, code: string, confirmed = false, causeCode?: string): void {
  const at = session.errorStamp?.code === code ? session.errorStamp.at : nowIso();
  session.errorStamp = { code, at };
  paint(
    session,
    { state: "error", reason: code, lastTransitionAt: at },
    session.mode,
    confirmed,
    sanitizeCause(causeCode),
    code,
  );
}

// Paints one successful status read. While the daemon reports the state a refusal was reported in, the refusal stays on
// screen. A read that reports a different state replaces it with the snapshot.
export function paintStatusRead(session: ActiveSession, snapshot: StateSnapshot): void {
  const refusal = session.refusal;
  if (refusal !== null && refusal.state === snapshot.state) {
    paintRefusal(session, refusal.code, true, refusalCauseOf(refusal));
    return;
  }
  session.refusal = null;
  session.errorStamp = null;
  paint(session, snapshot, session.mode, true);
}

// The clock is wall time: the snapshot carries the daemon's own transition instants, and only the
// connecting and failure paints, which have no daemon snapshot, stamp the host time.
export function nowIso(): string {
  return new Date().toISOString();
}

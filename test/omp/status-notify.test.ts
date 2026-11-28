import { test } from "node:test";
import assert from "node:assert/strict";
import type { StateSnapshot } from "../../src/core/state-machine.js";
import {
  bucketOfPaint,
  notifyPaintTransition,
  paint,
  paintError,
  paintStatusRead,
  type PaintedBucket,
} from "../../src/omp/status-render.js";
import type {
  ActiveSession,
  OmpSessionContext,
  OmpStatusUi,
} from "../../src/omp/plugin.js";

const CLOCK = "2026-10-21T09:30:00.000Z";

class WidgetUi implements OmpStatusUi {
  readonly widgetCalls: Array<{ readonly key: string; readonly text: string }> = [];
  readonly notifications: string[] = [];
  setWidget(key: string, text: string | string[]): void {
    this.widgetCalls.push({ key, text: Array.isArray(text) ? text.join("\n") : text });
  }
  notify(message: string): void {
    this.notifications.push(message);
  }
}

function makeSession(ui: OmpStatusUi): ActiveSession {
  const ctx = { cwd: "/tmp/realm-notify", ui } as unknown as OmpSessionContext;
  return {
    ctx,
    attachedCwd: "/tmp/realm-notify",
    tools: {} as unknown as ActiveSession["tools"],
    client: null,
    mode: "fail-closed",
    timers: new Map(),
    poll: null,
    refreshing: false,
    errorStamp: null,
    refusal: null,
    link: "off",
    reattachCount: 0,
    wait: null,
    onLinkLost: null,
  };
}

const ACTIVE: StateSnapshot = { state: "active", reason: "container running", lastTransitionAt: CLOCK };

void test("classifier maps daemon states to the 5 painted buckets", () => {
  const cases: ReadonlyArray<{ readonly bucket: PaintedBucket; readonly state: StateSnapshot["state"]; readonly code?: string }> = [
    { bucket: "connected", state: "active" },
    { bucket: "disconnected", state: "unbound" },
    { bucket: "disconnected", state: "connecting" },
    { bucket: "disconnected", state: "stopping" },
    { bucket: "retrying", state: "connecting", code: "REALM_NOT_ACTIVE" },
    { bucket: "denied", state: "error", code: "POLICY_DENIED" },
    { bucket: "terminal", state: "error", code: "TOOL_TIMEOUT" },
  ];
  for (const { bucket, state, code } of cases) {
    assert.equal(bucketOfPaint(state, code), bucket, `${state}/${code ?? "-"} maps to ${bucket}`);
  }
});

void test("first paint is the silent baseline: no notify on startup", () => {
  const ui = new WidgetUi();
  const session = makeSession(ui);
  paint(session, ACTIVE, session.mode, true);
  assert.equal(notifyPaintTransition(session), false);
  assert.deepEqual(ui.notifications, []);
});

void test("connected -> denied notifies exactly once; identical repaints stay quiet", () => {
  const ui = new WidgetUi();
  const session = makeSession(ui);
  paint(session, ACTIVE, session.mode, true);
  assert.equal(notifyPaintTransition(session), false);

  paintError(session, "POLICY_DENIED", CLOCK, false);
  assert.equal(notifyPaintTransition(session), true);
  assert.deepEqual(ui.notifications, ["realm status: denied (POLICY_DENIED)"]);

  // Identical repaint (same stamp, same text): a poll must never re-notify.
  paintError(session, "POLICY_DENIED", CLOCK, false);
  assert.equal(notifyPaintTransition(session), false);
  assert.equal(ui.notifications.length, 1, "one transition, one notice");
});

void test("denied -> terminal -> connected each notify once", () => {
  const ui = new WidgetUi();
  const session = makeSession(ui);
  paint(session, ACTIVE, session.mode, true);
  assert.equal(notifyPaintTransition(session), false);

  paintError(session, "POLICY_DENIED", CLOCK, false);
  assert.equal(notifyPaintTransition(session), true);
  paintError(session, "TOOL_TIMEOUT", CLOCK, false);
  assert.equal(notifyPaintTransition(session), true);
  paint(session, ACTIVE, session.mode, true);
  assert.equal(notifyPaintTransition(session), true);
  assert.deepEqual(ui.notifications, [
    "realm status: denied (POLICY_DENIED)",
    "realm status: terminal (TOOL_TIMEOUT)",
    "realm status: connected",
  ]);
});

void test("same-bucket repaint with different text (mode disclosure) never notifies", () => {
  const ui = new WidgetUi();
  const session = makeSession(ui);
  paint(session, ACTIVE, session.mode, true);
  assert.equal(notifyPaintTransition(session), false);

  session.mode = "advisory";
  paint(session, ACTIVE, session.mode, true);
  assert.equal(notifyPaintTransition(session), false, "mode text changed, bucket did not");
  assert.deepEqual(ui.notifications, []);
});

void test("connecting with a retry code paints the retrying bucket and notifies once", () => {
  const ui = new WidgetUi();
  const session = makeSession(ui);
  paint(session, { state: "connecting", reason: "connecting", lastTransitionAt: CLOCK }, session.mode, false);
  assert.equal(notifyPaintTransition(session), false);

  paint(
    session,
    { state: "connecting", reason: "connecting", lastTransitionAt: CLOCK },
    session.mode,
    false,
    "REALM_NOT_ACTIVE",
  );
  assert.equal(notifyPaintTransition(session), true);
  assert.deepEqual(ui.notifications, ["realm status: retrying (REALM_NOT_ACTIVE)"]);
});

void test("toggle-off surface (no widget region) paints and notifies nothing", () => {
  const notifications: string[] = [];
  const bare = { notify: (message: string): void => void notifications.push(message) };
  // No setWidget member: the widget region is absent, as when the toggle is off.
  const ui = bare as unknown as OmpStatusUi;
  const session = makeSession(ui);
  paint(session, ACTIVE, session.mode, true);
  assert.equal(notifyPaintTransition(session), false);
  assert.deepEqual(notifications, []);
});

void test("keep path forwards the refusal cause so polls preserve the suffix", () => {
  const ui = new WidgetUi();
  const session = makeSession(ui);
  session.refusal = { code: "POLICY_DENIED", state: "error", causeCode: "PATH_ESCAPE" };
  paintStatusRead(session, { state: "error", reason: "stale-daemon-reason", lastTransitionAt: CLOCK });
  assert.equal(ui.widgetCalls.length, 1);
  assert.match(
    ui.widgetCalls[0]?.text ?? "",
    /^○ realm disconnected · POLICY_DENIED \(cause: PATH_ESCAPE\) · /,
    "the same-state poll repaints the suffix instead of reverting to the bare code",
  );
});

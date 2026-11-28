import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ADVISORY_WIDGET_KEY,
  paintAdvisory,
  renderAdvisory,
  type AdvisoryPlanState,
} from "../../src/omp/advisory-render.js";

const INCOMPLETE: AdvisoryPlanState = Object.freeze({
  graphId: "g-paint-1",
  doneRows: 1,
  totalRows: 4,
  pendingRows: 3,
  unblockingAction: "answer Q2",
  renderCount: 1,
});

interface RecordingUi {
  setWidget(key: string, text: string | string[]): void;
  notify(message: string): void;
}

function makeUi(): RecordingUi & { readonly widgets: string[][]; readonly notifications: string[] } {
  const widgets: string[][] = [];
  const notifications: string[] = [];
  return {
    widgets,
    notifications,
    setWidget(_key: string, text: string | string[]): void {
      widgets.push(Array.isArray(text) ? text : [text]);
    },
    notify(message: string): void {
      notifications.push(message);
    },
  };
}

void test("null advisory (complete plan) paints and notifies nothing", () => {
  const ui = makeUi();
  const lines = renderAdvisory({ ...INCOMPLETE, pendingRows: 0 });
  assert.equal(lines, null);
  assert.equal(paintAdvisory(ui, lines), false);
  assert.deepEqual(ui.widgets, []);
  assert.deepEqual(ui.notifications, []);
});

void test("incomplete advisory paints once with byte-identical lines and notifies once", () => {
  const ui = makeUi();
  const lines = renderAdvisory(INCOMPLETE);
  assert.ok(lines !== null);
  assert.equal(paintAdvisory(ui, lines), true);
  assert.deepEqual(ui.widgets, [lines], "widget text is the render output, byte for byte");
  assert.equal(ui.notifications.length, 1, "one transition, one notice");

  // An unchanged poll repaints nothing and never re-notifies.
  const again = renderAdvisory({ ...INCOMPLETE, renderCount: 2 });
  assert.equal(again, null, "render stays silent on unchanged polls");
  assert.equal(paintAdvisory(ui, again), false);
  assert.equal(ui.widgets.length, 1, "no second paint on unchanged polls");
  assert.equal(ui.notifications.length, 1, "no second notice on unchanged polls");
});

void test("changed advisory content paints again and notifies once more", () => {
  const ui = makeUi();
  const first = renderAdvisory(INCOMPLETE);
  assert.ok(first !== null);
  assert.equal(paintAdvisory(ui, first), true);
  const second = renderAdvisory({ ...INCOMPLETE, doneRows: 2, pendingRows: 2 });
  assert.ok(second !== null);
  assert.equal(paintAdvisory(ui, second), true);
  assert.equal(ui.widgets.length, 2);
  assert.equal(ui.notifications.length, 2);
});

void test("toggle-off surface (no widget region) paints and notifies nothing", () => {
  const notifications: string[] = [];
  const ui = { notify: (message: string): void => void notifications.push(message) };
  const lines = renderAdvisory(INCOMPLETE);
  assert.ok(lines !== null);
  assert.equal(paintAdvisory(ui, lines), false);
  assert.deepEqual(notifications, []);
});

void test("advisory rides its own widget key, never the status key", () => {
  const seen: string[] = [];
  const ui: RecordingUi = {
    setWidget(key: string): void {
      seen.push(key);
    },
    notify(): void {},
  };
  const lines = renderAdvisory(INCOMPLETE);
  assert.ok(lines !== null);
  assert.equal(paintAdvisory(ui, lines), true);
  assert.deepEqual(seen, [ADVISORY_WIDGET_KEY]);
});

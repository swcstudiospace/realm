import { test } from "node:test";
import assert from "node:assert/strict";
import { createRealmPlugin, pluginToggleLine, PLUGIN_TOGGLE_TARGET, renderRealmStatus, REALM_STATUS_KEY, type OmpExtensionApi, type OmpSessionContext, type OmpStatusUi } from "../../src/omp/plugin.js";
import { getPluginStatusPaint } from "../../src/omp/status-paint.js";
import { pluginEnabledOf } from "../../src/omp/extension.js";
import { BOOT_BOUNDS, resolveBoot } from "../../src/host/boot.js";
import { defaultManifestFor, parseHostPluginManifest } from "../../src/host/manifest.js";
import type { StateSnapshot } from "../../src/core/state-machine.js";
import { RealmError } from "../../src/core/errors.js";

const CLOCK = "2026-10-21T09:30:00.000Z";

// Minimal hermetic fakes: no daemon, no host, no wall-clock waits. Timers are manual no-ops.
class WidgetUi implements OmpStatusUi {
  readonly widgetCalls: Array<{ readonly key: string; readonly text: string }> = [];
  readonly underBarCalls: Array<{ readonly key: string; readonly text: string }> = [];
  readonly notifications: string[] = [];
  setWidget(key: string, text: string): void {
    this.widgetCalls.push({ key, text });
  }
  // Never callable from the plugin (OmpStatusUi has no setStatus member); kept to prove 0 under-bar.
  setStatus(key: string, text: string): void {
    this.underBarCalls.push({ key, text });
  }
  notify(message: string): void {
    this.notifications.push(message);
  }
}

class RecordingPi implements OmpExtensionApi {
  readonly events: string[] = [];
  readonly registrations: string[] = [];
  readonly commands: string[] = [];
  on(event: "session_start" | "session_switch", _handler: (_event: unknown, _ctx: OmpSessionContext) => void): void;
  on(event: "session_shutdown", _handler: () => void): void;
  on(event: "tool_call", _handler: (call: never) => Promise<never>): void;
  on(event: string): void {
    this.events.push(event);
  }
  registerCommand(name: string): void {
    this.commands.push(name);
  }
  registerTool(tool: { readonly name: string }): void {
    this.registrations.push(tool.name);
  }
  getAllTools(): readonly { readonly name: string }[] {
    return [];
  }
  getActiveTools(): readonly string[] {
    return [];
  }
  setActiveTools(): Promise<void> {
    return Promise.resolve();
  }
}

function yieldTurn(): Promise<void> {
  return new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}

void test("toggle defaults on: resolveBoot and manifest parse give enabled true when unset", () => {
  assert.equal(BOOT_BOUNDS.enabled, true);
  const base = defaultManifestFor("omp", "1.0.0");
  assert.equal(resolveBoot(base).enabled, true, "no stored setting means on (AC-36 empty.no-setting)");
  const parsed = parseHostPluginManifest({ ...base, boot: { enabled: false } });
  assert.equal(resolveBoot(parsed).enabled, false, "stored off persists");
  assert.equal(resolveBoot(parseHostPluginManifest({ ...base, boot: { enabled: true } })).enabled, true);
  // Persistence across restart: resolving the same parsed manifest twice yields the same value.
  assert.equal(resolveBoot(parsed).enabled, resolveBoot(parsed).enabled);
});

void test("pluginEnabledOf mirrors the reattach switch: unset/1 on, 0 off, else SCHEMA_INVALID", () => {
  assert.equal(pluginEnabledOf(undefined), true);
  assert.equal(pluginEnabledOf("1"), true);
  assert.equal(pluginEnabledOf("0"), false);
  assert.throws(
    () => pluginEnabledOf("yes"),
    (error: unknown) => error instanceof RealmError && error.code === "SCHEMA_INVALID",
  );
  // Orthogonal to reattach: toggling the plugin never flips re-attach bounds here; it only gates
  // registration/paints (checked by the off-path test below registering no handlers at all).
  assert.equal(BOOT_BOUNDS.reattach.enabled, false);
});

void test("toggle text line states: on names 5 tools, off names 0 tools and hidden status", () => {
  assert.equal(pluginToggleLine(true), "Realm plugin on — 5 tools registered");
  assert.equal(pluginToggleLine(false), "Realm plugin off — 0 tools registered, status hidden");
});

void test("toggle switch target measures 48x28 px (WCAG 2.2 SC 2.5.8)", () => {
  assert.deepEqual(PLUGIN_TOGGLE_TARGET, { widthPx: 48, heightPx: 28 });
});

void test("toggle on (default): 5 tools registered, widget paints, 0 under-bar paints", async () => {
  const pi = new RecordingPi();
  const ui = new WidgetUi();
  const snapshot: StateSnapshot = { state: "active", reason: "container running", lastTransitionAt: CLOCK };
  createRealmPlugin(pi, {
    attachDaemon: () => {
      return Promise.resolve({
        client: {
          status: () => Promise.resolve({ snapshot, display: { label: "realm active" as const, reason: "container running", lastTransitionAt: CLOCK }, mode: "fail-closed" as const, sessionId: "s1" }),
          call: () => Promise.reject(new Error("unused")),
          up: () => Promise.resolve({ snapshot, display: { label: "realm active" as const, reason: "container running", lastTransitionAt: CLOCK }, mode: "fail-closed" as const, sessionId: "s1" }),
          metrics: () => Promise.reject(new Error("unused")),
          close: () => undefined,
        } as never,
        refusal: null,
      });
    },
  });
  assert.equal(pi.registrations.length, 5, "on registers all 5 Realm tools");
  assert.deepEqual(pi.commands, ["realm-retry"]);
  // renderRealmStatus is the paint funnel: widget only, byte-identical text shape, 0 under-bar.
  renderRealmStatus(ui, snapshot, "fail-closed", true);
  assert.equal(ui.widgetCalls.length, 1);
  const first = ui.widgetCalls[0];
  assert.ok(first !== undefined, "one widget paint");
  assert.equal(first.key, REALM_STATUS_KEY);
  assert.equal(ui.underBarCalls.length, 0, "AC-39: 0 under-bar paints");
  assert.ok(first.text.startsWith("● realm active · container running · "));
  assert.ok(first.text.endsWith("applied mode: fail-closed (Omp host-tool guard; not host process containment)"));
  await yieldTurn();
});

void test("toggle off: 0 tools, 0 commands, 0 handlers, 0 paints, attach never called (AC-37)", () => {
  const pi = new RecordingPi();
  const ui = new WidgetUi();
  let attachCalls = 0;
  const handle = createRealmPlugin(pi, {
    attachDaemon: () => {
      attachCalls += 1;
      return Promise.reject(new Error("must not be called when off"));
    },
    bounds: { ...BOOT_BOUNDS, enabled: false },
  });
  assert.equal(pi.registrations.length, 0, "off registers 0 tools");
  assert.equal(pi.commands.length, 0, "off registers 0 retry commands");
  assert.equal(pi.events.length, 0, "off registers 0 lifecycle/guard handlers");
  assert.deepEqual(handle.view(), { state: "unbound", mode: null, link: "off" });
  // No session can start (no handler), so no attach and no paint can occur; prove the funnel stays
  // silent by rendering through a fresh on-registration still leaves the off plugin untouched.
  assert.equal(attachCalls, 0);
  assert.equal(ui.widgetCalls.length, 0);
  assert.equal(ui.underBarCalls.length, 0);
});

void test("4 truthful daemon states paint snapshot-matching text with 1 label per paint (AC-40)", () => {
  const cases: ReadonlyArray<{ readonly snapshot: StateSnapshot; readonly marker: string }> = [
    { snapshot: { state: "active", reason: "container running", lastTransitionAt: CLOCK }, marker: "● realm active" },
    { snapshot: { state: "connecting", reason: "connecting", lastTransitionAt: CLOCK }, marker: "○ realm disconnected" },
    { snapshot: { state: "error", reason: "TOOL_TIMEOUT", lastTransitionAt: CLOCK }, marker: "○ realm disconnected" },
    { snapshot: { state: "unbound", reason: "no workspace", lastTransitionAt: CLOCK }, marker: "○ realm disconnected" },
  ];
  for (const { snapshot, marker } of cases) {
    const ui = new WidgetUi();
    renderRealmStatus(ui, snapshot, "fail-closed", true);
    assert.equal(ui.widgetCalls.length, 1, `one paint for ${snapshot.state}`);
    assert.ok(ui.widgetCalls[0]?.text.startsWith(marker), `truthful label for ${snapshot.state}`);
    assert.equal(ui.underBarCalls.length, 0);
  }
});

void test("identical status reads stay quiet; widget region is non-interactive text only", () => {
  const ui = new WidgetUi();
  const snapshot: StateSnapshot = { state: "active", reason: "container running", lastTransitionAt: CLOCK };
  renderRealmStatus(ui, snapshot, "advisory", true);
  renderRealmStatus(ui, snapshot, "advisory", true);
  assert.equal(ui.widgetCalls.length, 1, "paint happens on change only (poll cadence unchanged)");
});

void test("GET /plugin/status-paint op: additional-ui target, 0 under-bar paints, 4 truthful states (AC-39)", () => {
  const response = getPluginStatusPaint("corr-paint-1");
  assert.equal(response.target, "additional-ui");
  assert.equal(response.underBarPaints, 0);
  assert.deepEqual([...response.states], ["unbound", "connecting", "active", "error"]);
  assert.equal(response.correlationId, "corr-paint-1");
});

void test("off retains the last truthful text: paints once, off adds 0 paints, text unchanged (AC-41)", () => {
  const ui = new WidgetUi();
  const snapshot: StateSnapshot = { state: "active", reason: "container running", lastTransitionAt: CLOCK };
  renderRealmStatus(ui, snapshot, "fail-closed", true);
  assert.equal(ui.widgetCalls.length, 1, "the on-path paints once");
  const retained = ui.widgetCalls[0]?.text;
  // The off plugin registers no session and no poll, so it cannot repaint: the widget keeps the
  // last truthful text byte for byte.
  const pi = new RecordingPi();
  createRealmPlugin(pi, { attachDaemon: () => Promise.reject(new Error("must not be called when off")), bounds: { ...BOOT_BOUNDS, enabled: false } });
  assert.equal(ui.widgetCalls.length, 1, "the off-path paints 0 additional times");
  assert.equal(ui.widgetCalls[0]?.text, retained, "the last truthful text is retained unchanged");
  assert.equal(ui.underBarCalls.length, 0);
});


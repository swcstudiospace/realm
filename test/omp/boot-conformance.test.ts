import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultManifestFor } from "../../src/host/manifest.js";
import type { BootBounds, HostBootDeps, HostPluginManifest } from "../../src/host/types.js";
import { createRealmPlugin, REALM_RETRY_COMMAND, type OmpSessionContext } from "../../src/omp/plugin.js";
import { REALM_TOOL_NAMES } from "../../src/omp/tools.js";
import { BOOT_CONFORMANCE_IDS, defineBootConformance, runBootConformance } from "../support/host-boot-conformance.js";
import { FakeDaemon, FakeTimers, RecordingSink, fail, hang, ok, scriptedAttach, type AttachOutcome } from "../support/fake-host-daemon.js";
import { MemoryOmpHost, ompBootHook } from "../support/omp-boot-hook.js";
import { boundedWait } from "../support/timing.js";

// OMPB-02: the real Omp plugin, driven through the Omp host API by test/support/omp-boot-hook.ts, passes the Phase 21 boot
// conformance cases C1 to C9. The reference hook and its four mutants are proved by test/host/boot-conformance.test.ts.

const manifest = defaultManifestFor("omp", "1.0.0");
const ROOT = "/ws/a";
const SETTLE_MS = 2_000;

defineBootConformance("omp plugin", ompBootHook, manifest);

void test("the omp plugin passes every harness case", async () => {
  const results = await runBootConformance(ompBootHook, manifest);
  assert.equal(results.length, BOOT_CONFORMANCE_IDS.length);
  assert.deepEqual(
    results.filter((result) => !result.ok),
    [],
  );
});

function withBoot(boot: BootBounds): HostPluginManifest {
  return { ...manifest, boot };
}

function rigOf(outcomes: readonly AttachOutcome[]): {
  readonly deps: HostBootDeps;
  readonly timers: FakeTimers;
  readonly sink: RecordingSink;
  readonly roots: string[];
} {
  const timers = new FakeTimers();
  const sink = new RecordingSink();
  const script = scriptedAttach(outcomes);
  const deps: HostBootDeps = { attachDaemon: script.attachDaemon, now: timers.now, random: timers.random, timers, sink };
  return { deps, timers, sink, roots: script.roots };
}

void test("a manifest startupBudgetMs is the plugin's startup budget", async () => {
  const rig = rigOf([hang()]);
  const hook = ompBootHook(rig.deps, withBoot({ startupBudgetMs: 40 }));
  const started = hook.start(ROOT);
  await rig.timers.advance(39);
  assert.equal(hook.status().state, "connecting", "the attach is still inside the budget at 39 ms");
  await rig.timers.advance(1);
  await boundedWait(started, "start after the budget", SETTLE_MS);
  assert.deepEqual(hook.status(), { state: "error", mode: null, link: "off", code: "STARTUP_BUDGET_EXCEEDED" });
  await hook.shutdown();
});

void test("a manifest reattach block bounds the plugin's re-attach streak and its delay window", async () => {
  const daemon = new FakeDaemon({ root: ROOT });
  const rig = rigOf([ok(daemon), fail("DAEMON_START_TIMEOUT"), fail("DAEMON_START_TIMEOUT"), fail("DAEMON_START_TIMEOUT"), fail("DAEMON_START_TIMEOUT")]);
  const hook = ompBootHook(rig.deps, withBoot({ reattach: { enabled: true, retryCap: 2, baseDelayMs: 10, capDelayMs: 20 } }));
  await boundedWait(hook.start(ROOT), "start", SETTLE_MS);
  assert.equal(hook.status().link, "linked");
  daemon.failStatus("REALM_NOT_ACTIVE");
  await rig.timers.advance(2_000);
  const delays: number[] = [];
  for (let wait = 1; wait <= 2; wait += 1) {
    assert.equal(rig.timers.pendingTimeouts(), 1, `wait ${String(wait)} is armed`);
    const due = rig.timers.nextTimeoutDueIn();
    assert.ok(due !== null);
    delays.push(due);
    await rig.timers.advance(due);
  }
  const [first, second] = delays;
  assert.ok(first !== undefined && first >= 5 && first <= 10, `first delay ${String(first)} is inside [5, 10]`);
  assert.ok(second !== undefined && second >= 10 && second <= 20, `second delay ${String(second)} is inside [10, 20]`);
  assert.equal(rig.roots.length, 3, "one attach at start and exactly two re-attach attempts");
  assert.equal(hook.status().link, "failed");
  assert.equal(rig.timers.pendingTimeouts(), 0, "no wait remains after the cap");
  await hook.shutdown();
});

void test("the five Realm tools and the retry command register once, and a second start does not register them again", () => {
  const rig = rigOf([]);
  const pi = new MemoryOmpHost();
  createRealmPlugin(pi, { attachDaemon: (root) => rig.deps.attachDaemon(root) });
  assert.deepEqual(pi.registrations.toSorted(), REALM_TOOL_NAMES.toSorted());
  assert.ok(pi.commands.has(REALM_RETRY_COMMAND));
  const context: OmpSessionContext = {
    cwd: ROOT,
    ui: rig.sink,
    setTimeout: (callback, ms) => rig.timers.setTimeout(callback, ms),
    setInterval: (callback, ms) => rig.timers.setInterval(callback, ms),
    clearTimer: (handle) => {
      rig.timers.clear(handle);
    },
  };
  const start = pi.startHandlers[0];
  assert.ok(start !== undefined);
  start({ type: "session_start" }, context);
  start({ type: "session_start" }, context);
  assert.equal(pi.registrations.length, REALM_TOOL_NAMES.length, "no tool is registered again by a start");
  for (const handler of pi.shutdownHandlers) {
    handler();
  }
});

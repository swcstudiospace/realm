// Conformance harness for host boot hooks (Phase 21, HOST-04). It receives a HostBootHookFactory and a manifest and runs nine
// cases against fakes (fake-host-daemon.ts): bounded attach, status readback and paint, refused-up retention, terminal attach
// failure, the fail-closed guard, client-only shutdown, re-attach off by default, bounded re-attach, and workspace switching.
//
// Who runs it: Phase 22 runs it against the real Omp plugin (test/support/omp-boot-hook.ts), Phases 24 and 25 against each new
// host hook, and the reference hook and its four broken variants (reference-boot-hook.ts) prove that it can pass and can fail.
//
// What a hook must do to pass:
//   - take every bound from resolveBoot(manifest) (src/host/boot.ts), never a hard-coded value;
//   - arm every timer it owns through HostBootDeps.timers, the guard's status read bound and the repaint poll (every
//     statusPollMs) included. A live session may keep exactly one repaint poll armed, and no wait or budget timer once its
//     attach has settled; after shutdown no timer remains at all;
//   - enforce the startup budget either on withStartupBudget (the one real timer the harness lets through, cleared when the
//     attach settles) or on the host's managed timers (HostBootDeps.timers): the harness advances the fake clock by the budget
//     while it waits, so both pass;
//   - report a failed attach through status() (state "error" and the catalogue code) and never let start() hang.
// The harness names no host and imports nothing from src/omp.
//
// Amendments made for Phase 22 (the Omp plugin keeps its repaint poll armed for the life of a session, and runs its startup
// budget on the host's managed timers): (a) every "no timer remains" assertion made while the session is still live is
// idleExceptPoll, "no wait armed and at most the one repaint poll"; the two assertions in C6 made after shutdown keep
// pendingCount() === 0. (b) C1 advances the fake clock by the startup budget while it waits for start().

import assert from "node:assert/strict";
import { test } from "node:test";
import { RealmError, type ErrorCode } from "../../src/core/errors.js";
import { equalJitterDelayMs, resolveBoot, type ResolvedBoot } from "../../src/host/boot.js";
import type {
  HostBootDeps,
  HostBootHook,
  HostBootHookFactory,
  HostGuardVerdict,
  HostPluginManifest,
} from "../../src/host/types.js";
import { sessionIdOfWorkspace } from "../../src/session/paths.js";
import {
  FakeDaemon,
  FakeTimers,
  RecordingSink,
  fail,
  hang,
  ok,
  refused,
  scriptedAttach,
  type AttachOutcome,
  type ScriptedAttach,
} from "./fake-host-daemon.js";
import { boundedWait } from "./timing.js";

export interface ConformanceResult {
  readonly id: string;
  readonly ok: boolean;
  readonly detail: string;
}

const ROOT_A = "/ws/a";
const ROOT_B = "/ws/b";
const ROOT_OTHER = "/ws/other";
// The startup budget the harness sets: short enough that a hung attach ends the case quickly in real time.
const BUDGET_MS = 25;
// A tool name no host passes through unexamined.
const UNKNOWN_TOOL = "mystery_tool";
// How long a settled promise may take in real time before the harness calls the hook hung.
const SETTLE_MS = 2_000;

interface Rig {
  readonly hook: HostBootHook;
  readonly timers: FakeTimers;
  readonly sink: RecordingSink;
  readonly script: ScriptedAttach;
  readonly boot: ResolvedBoot;
}

// The harness manifest: the caller's manifest with the short startup budget and re-attach switched on or off.
function manifestWith(manifest: HostPluginManifest, reattachEnabled: boolean): HostPluginManifest {
  return {
    ...manifest,
    boot: { ...manifest.boot, startupBudgetMs: BUDGET_MS, reattach: { ...manifest.boot?.reattach, enabled: reattachEnabled } },
  };
}

// Builds a hook on fresh fakes and shuts it down when the body ends, so no case leaves a hook behind.
async function withRig(
  factory: HostBootHookFactory,
  manifest: HostPluginManifest,
  outcomes: readonly AttachOutcome[],
  body: (rig: Rig) => Promise<void>,
): Promise<void> {
  const timers = new FakeTimers();
  const sink = new RecordingSink();
  const script = scriptedAttach(outcomes);
  const deps: HostBootDeps = { attachDaemon: script.attachDaemon, now: timers.now, random: timers.random, timers, sink };
  const hook = factory(deps, manifest);
  try {
    await body({ hook, timers, sink, script, boot: resolveBoot(manifest) });
  } finally {
    await boundedWait(hook.shutdown(), "cleanup shutdown", SETTLE_MS).catch(() => undefined);
  }
}

const settles = <T>(work: Promise<T>, what: string): Promise<T> => boundedWait(work, what, SETTLE_MS);

const failures = (count: number, code: ErrorCode): AttachOutcome[] => Array.from({ length: count }, () => fail(code));

const statusCalls = (daemon: FakeDaemon): number => daemon.methods().filter((method) => method === "status").length;

// The verdict of a guard call that must refuse. A call the hook let through fails the case here.
function blocked(verdict: HostGuardVerdict | undefined, what: string): HostGuardVerdict {
  assert.ok(verdict !== undefined, `${what} must be blocked`);
  return verdict;
}

// "No timer remains" for a live session: no wait or budget timer armed, and at most the one repaint poll. A session that has
// shut down keeps the strict pendingCount() === 0 checks (C6).
function idleExceptPoll(rig: Rig, what: string): void {
  assert.equal(rig.timers.pendingTimeouts(), 0, `${what}: no wait or budget timer remains armed`);
  assert.ok(rig.timers.pendingCount() - rig.timers.pendingTimeouts() <= 1, `${what}: at most the one repaint poll remains armed`);
}

// ---- C1 ---------------------------------------------------------------------

async function attachBudget(factory: HostBootHookFactory, manifest: HostPluginManifest): Promise<void> {
  await withRig(factory, manifestWith(manifest, false), [hang()], async (rig) => {
    let observed: ErrorCode | undefined;
    // start is not awaited yet: the budget runs on the fake clock for a hook that arms it on the host's timers, and on the one
    // real timer withStartupBudget arms for a hook that uses that. Advancing the fake clock past the budget serves the first and
    // is harmless to the second.
    const started = rig.hook.start(ROOT_A).then(
      () => undefined,
      (error: unknown) => error,
    );
    await rig.timers.advance(rig.boot.startupBudgetMs);
    const failure = await settles(started, "a hung attach after the startup budget");
    if (failure !== undefined) {
      if (!(failure instanceof RealmError)) {
        throw new Error("start() settled with a value that is not a RealmError");
      }
      observed = failure.code;
    }
    const status = rig.hook.status();
    assert.equal(observed ?? status.code, "STARTUP_BUDGET_EXCEEDED");
    assert.notEqual(status.state, "active");
    idleExceptPoll(rig, "after the budget failure");
  });
}

// ---- C2 ---------------------------------------------------------------------

async function attachOkReadback(factory: HostBootHookFactory, manifest: HostPluginManifest): Promise<void> {
  const daemon = new FakeDaemon({ root: ROOT_A, mode: "fail-closed" });
  await withRig(factory, manifestWith(manifest, false), [ok(daemon)], async (rig) => {
    await settles(rig.hook.start(ROOT_A), "start");
    const status = rig.hook.status();
    assert.equal(status.state, "active");
    assert.equal(status.mode, "fail-closed", "the mode is the one the daemon reports");
    const painted = rig.sink.statuses.map((entry) => entry.text);
    assert.ok(painted.length >= 1 && painted.length <= 2, `one paint per distinct state, saw ${String(painted.length)}`);
    assert.equal(new Set(painted).size, painted.length, "an identical paint is not repeated");
    await rig.timers.advance(3 * rig.boot.statusPollMs);
    assert.equal(rig.sink.statuses.length, painted.length, "an unchanged status repaints nothing");
    assert.equal(rig.hook.status().state, "active");
  });
}

// ---- C3 ---------------------------------------------------------------------

async function refusedUpRetention(factory: HostBootHookFactory, manifest: HostPluginManifest): Promise<void> {
  const off = manifestWith(manifest, false);
  const held = new FakeDaemon({ root: ROOT_A, state: "error" });
  const bystander = new FakeDaemon({ root: ROOT_B });
  await withRig(factory, off, [refused(held, "PODMAN_MISSING"), fail("DAEMON_START_TIMEOUT")], async (rig) => {
    await settles(rig.hook.start(ROOT_A), "start");
    assert.equal(held.closeCalls, 0, "the client that came back with the refusal is kept");
    assert.equal(rig.hook.status().state, "error");
    assert.equal(rig.hook.status().code, "PODMAN_MISSING");
    const before = statusCalls(held);
    const verdict = await settles(rig.hook.guard(UNKNOWN_TOOL), "guard");
    blocked(verdict, "a guard read through the kept client");
    assert.ok(statusCalls(held) > before, "the kept client answers the guard's status read");
    await settles(rig.hook.retry(), "retry");
    assert.equal(held.closeCalls, 1, "a new attach releases the client the old one held");
    assert.equal(rig.script.roots.length, 2);
    await settles(rig.hook.shutdown(), "shutdown");
    assert.equal(held.closeCalls, 1, "the held client is closed once overall");
    assert.equal(bystander.closeCalls, 0, "a rejected attach closes nothing it never held");
  });
  // A daemon that reports no root cannot confirm the refusal is this project's: its client is not kept.
  const unrooted = new FakeDaemon({ root: ROOT_A, state: "error", boundRoot: null });
  await withRig(factory, off, [refused(unrooted, "PODMAN_MISSING")], async (rig) => {
    await settles(rig.hook.start(ROOT_A), "start");
    assert.equal(unrooted.closeCalls, 1, "a refusal whose reply names no root is not adopted");
    assert.equal(rig.hook.status().state, "error");
    const before = statusCalls(unrooted);
    blocked(await settles(rig.hook.guard(UNKNOWN_TOOL), "guard"), "a guard through a client that was not kept");
    assert.equal(statusCalls(unrooted), before, "no read goes through a client that was not kept");
  });
  // An older daemon without the field is adopted when its up succeeded.
  const older = new FakeDaemon({ root: ROOT_A, boundRoot: null });
  await withRig(factory, off, [ok(older)], async (rig) => {
    await settles(rig.hook.start(ROOT_A), "start");
    assert.equal(rig.hook.status().state, "active");
    assert.equal(older.closeCalls, 0);
  });
}

// ---- C4 ---------------------------------------------------------------------

async function terminalAttachFailure(factory: HostBootHookFactory, manifest: HostPluginManifest): Promise<void> {
  const next = new FakeDaemon({ root: ROOT_A });
  await withRig(factory, manifestWith(manifest, true), [fail("POLICY_DENIED"), ok(next)], async (rig) => {
    await settles(rig.hook.start(ROOT_A), "start");
    assert.equal(rig.hook.status().state, "error");
    assert.equal(rig.hook.status().code, "POLICY_DENIED");
    idleExceptPoll(rig, "a terminal failure schedules no re-attach");
    await rig.timers.advance(1_000_000);
    assert.equal(rig.script.roots.length, 1, "no attach follows a terminal failure");
    await settles(rig.hook.retry(), "retry");
    assert.equal(rig.script.roots.length, 2, "retry performs exactly one new attach");
    assert.equal(rig.hook.status().state, "active");
  });
}

// ---- C5 ---------------------------------------------------------------------

async function guardFailClosed(factory: HostBootHookFactory, manifest: HostPluginManifest): Promise<void> {
  const daemon = new FakeDaemon({ root: ROOT_A, mode: "fail-closed" });
  await withRig(factory, manifestWith(manifest, false), [ok(daemon)], async (rig) => {
    await settles(rig.hook.start(ROOT_A), "start");
    const calls = daemon.log.length;
    for (const name of [undefined, 7, null, {}, Symbol("x")]) {
      const verdict = await settles(rig.hook.guard(name), "guard of a non-string name");
      const refusal = blocked(verdict, "a non-string tool name");
      assert.equal(refusal.reason, "realm bad tool call");
    }
    assert.equal(daemon.log.length, calls, "a non-string name makes no daemon call");
    const unknown = await settles(rig.hook.guard(UNKNOWN_TOOL), "guard of an unknown name");
    assert.equal(blocked(unknown, "an unknown name in fail-closed mode").reason, "POLICY_DENIED");
    daemon.failStatus("TOOL_TIMEOUT");
    blocked(await settles(rig.hook.guard(UNKNOWN_TOOL), "guard with an unreadable status"), "a guard with an unreadable status");
    // A status read that never answers ends at the guard budget with a verdict, not a hang.
    daemon.failStatus(null);
    daemon.hangStatus(true);
    const hung = rig.hook.guard(UNKNOWN_TOOL);
    await rig.timers.advance(rig.boot.guardStatusBudgetMs);
    blocked(await settles(hung, "guard with a status read that hangs"), "a guard whose status read hangs");
  });
}

// ---- C6 ---------------------------------------------------------------------

async function shutdownClientOnly(factory: HostBootHookFactory, manifest: HostPluginManifest): Promise<void> {
  const daemon = new FakeDaemon({ root: ROOT_A });
  await withRig(factory, manifestWith(manifest, false), [ok(daemon)], async (rig) => {
    await settles(rig.hook.start(ROOT_A), "start");
    const before = daemon.log.length;
    await settles(rig.hook.shutdown(), "shutdown");
    assert.deepEqual(daemon.methods().slice(before), ["close"], "shutdown makes no daemon call but close");
    assert.equal(daemon.closeCalls, 1);
    assert.equal(rig.timers.pendingCount(), 0, "shutdown clears every timer");
    await settles(rig.hook.shutdown(), "second shutdown");
    await rig.timers.advance(100_000);
    assert.equal(daemon.closeCalls, 1, "shutdown is idempotent");
    assert.equal(daemon.log.length, before + 1, "nothing reaches the daemon after shutdown");
    blocked(await settles(rig.hook.guard(UNKNOWN_TOOL), "guard after shutdown"), "a guard after shutdown");
  });
  // A shutdown during a re-attach wait cancels the wait.
  const lost = new FakeDaemon({ root: ROOT_A });
  await withRig(factory, manifestWith(manifest, true), [ok(lost), ...failures(20, "DAEMON_START_TIMEOUT")], async (rig) => {
    await settles(rig.hook.start(ROOT_A), "start");
    lost.failStatus("REALM_NOT_ACTIVE");
    await rig.timers.advance(rig.boot.statusPollMs);
    assert.equal(rig.timers.pendingTimeouts(), 1, "the lost link arms one wait");
    await settles(rig.hook.shutdown(), "shutdown during a wait");
    assert.equal(rig.timers.pendingCount(), 0);
    await rig.timers.advance(1_000_000);
    assert.equal(rig.script.roots.length, 1, "a cancelled wait attaches nothing");
    assert.equal(lost.closeCalls, 1);
  });
}

// ---- C7 ---------------------------------------------------------------------

async function reattachOffByDefault(factory: HostBootHookFactory, manifest: HostPluginManifest): Promise<void> {
  const daemon = new FakeDaemon({ root: ROOT_A });
  await withRig(factory, manifestWith(manifest, false), [ok(daemon), ok(new FakeDaemon({ root: ROOT_A }))], async (rig) => {
    await settles(rig.hook.start(ROOT_A), "start");
    daemon.failStatus("REALM_NOT_ACTIVE");
    await rig.timers.advance(1_000_000);
    assert.equal(rig.script.roots.length, 1, "no re-attach is attempted");
    assert.equal(rig.timers.pendingTimeouts(), 0, "no wait is armed");
    assert.equal(rig.hook.status().link, "off");
    assert.notEqual(rig.hook.status().state, "active");
  });
}

// ---- C8 ---------------------------------------------------------------------

const expectedDelay = (rig: Rig, attempt: number, random: number): number =>
  equalJitterDelayMs(attempt, rig.boot.reattach.baseDelayMs, rig.boot.reattach.capDelayMs, () => random);

async function loseLink(rig: Rig, daemon: FakeDaemon): Promise<void> {
  daemon.failStatus("REALM_NOT_ACTIVE");
  await rig.timers.advance(rig.boot.statusPollMs);
}

// Fires waits `first` to `last`, checking before each one that it is the only wait armed and that its delay is exactly the
// equal-jitter delay, so a jitter that collapses toward zero cannot pass.
async function fireWaits(rig: Rig, first: number, last: number, random: number): Promise<void> {
  for (let attempt = first; attempt <= last; attempt += 1) {
    assert.equal(rig.timers.pendingTimeouts(), 1, `wait ${String(attempt)} is armed`);
    const due = rig.timers.nextTimeoutDueIn();
    assert.equal(due, expectedDelay(rig, attempt, random), `wait ${String(attempt)} delay`);
    await rig.timers.advance(due);
  }
}

async function reattachBounded(factory: HostBootHookFactory, manifest: HostPluginManifest): Promise<void> {
  const on = manifestWith(manifest, true);
  const cap = resolveBoot(on).reattach.retryCap;
  for (const random of [0, 1]) {
    const first = new FakeDaemon({ root: ROOT_A });
    await withRig(factory, on, [ok(first), ...failures(30, "DAEMON_START_TIMEOUT")], async (rig) => {
      rig.timers.randomValue = random;
      await settles(rig.hook.start(ROOT_A), "start");
      assert.equal(rig.hook.status().link, "linked");
      await loseLink(rig, first);
      await fireWaits(rig, 1, cap, random);
      assert.equal(rig.script.roots.length, 1 + cap, `exactly ${String(cap)} re-attach attempts`);
      assert.equal(rig.hook.status().link, "failed");
      idleExceptPoll(rig, "after the cap no timer remains");
      await rig.timers.advance(1_000_000);
      assert.equal(rig.script.roots.length, 1 + cap, "no attempt after the cap");
    });
  }
  // A successful attach resets the streak: a second loss again gets the full cap.
  const one = new FakeDaemon({ root: ROOT_A });
  const two = new FakeDaemon({ root: ROOT_A });
  const resetScript = [ok(one), ...failures(3, "DAEMON_START_TIMEOUT"), ok(two), ...failures(30, "DAEMON_START_TIMEOUT")];
  await withRig(factory, on, resetScript, async (rig) => {
    rig.timers.randomValue = 0;
    await settles(rig.hook.start(ROOT_A), "start");
    await loseLink(rig, one);
    await fireWaits(rig, 1, 4, 0);
    assert.equal(rig.hook.status().link, "linked", "the fourth attempt succeeds");
    assert.equal(rig.hook.status().state, "active");
    assert.equal(rig.timers.pendingTimeouts(), 0);
    await loseLink(rig, two);
    await fireWaits(rig, 1, cap, 0);
    assert.equal(rig.script.roots.length, 1 + 4 + cap, "the second streak again runs to the cap");
    assert.equal(rig.hook.status().link, "failed");
    idleExceptPoll(rig, "the second streak ends with no wait armed");
  });
  // A terminal code stops the streak at once.
  const stable = new FakeDaemon({ root: ROOT_A });
  const terminalScript = [ok(stable), fail("DAEMON_START_TIMEOUT"), fail("POLICY_DENIED"), ok(new FakeDaemon({ root: ROOT_A }))];
  await withRig(factory, on, terminalScript, async (rig) => {
    await settles(rig.hook.start(ROOT_A), "start");
    await loseLink(rig, stable);
    await fireWaits(rig, 1, 2, rig.timers.randomValue);
    assert.equal(rig.script.roots.length, 3);
    assert.equal(rig.hook.status().link, "failed");
    idleExceptPoll(rig, "a terminal code leaves no wait");
    await rig.timers.advance(1_000_000);
    assert.equal(rig.script.roots.length, 3, "a terminal code stops the streak");
  });
}

// ---- C9 ---------------------------------------------------------------------

async function switchWorkspace(factory: HostBootHookFactory, manifest: HostPluginManifest): Promise<void> {
  const off = manifestWith(manifest, false);
  const daemonA = new FakeDaemon({ root: ROOT_A });
  const daemonB = new FakeDaemon({ root: ROOT_B });
  await withRig(factory, off, [ok(daemonA), ok(daemonB)], async (rig) => {
    await settles(rig.hook.start(ROOT_A), "start");
    await settles(rig.hook.switchWorkspace(ROOT_A), "switch to the same root");
    assert.deepEqual(rig.script.roots, [ROOT_A], "the same root makes no attach");
    assert.equal(daemonA.closeCalls, 0);
    await settles(rig.hook.switchWorkspace(ROOT_B), "switch to another root");
    assert.deepEqual(rig.script.roots, [ROOT_A, ROOT_B]);
    assert.equal(daemonA.closeCalls, 1, "the old client is closed");
    assert.equal(daemonB.closeCalls, 0);
    assert.equal(rig.hook.status().state, "active");
  });
  // A reply for another project is not adopted: its client is closed and the state is error.
  const foreignRoot = new FakeDaemon({ root: ROOT_OTHER });
  const foreignSession = new FakeDaemon({ root: ROOT_A, sessionId: sessionIdOfWorkspace(ROOT_OTHER) });
  for (const spoof of [foreignRoot, foreignSession]) {
    await withRig(factory, off, [ok(spoof)], async (rig) => {
      await settles(rig.hook.start(ROOT_A), "start");
      assert.equal(spoof.closeCalls, 1, "a reply naming another root or session is not adopted");
      assert.equal(rig.hook.status().state, "error");
      const before = statusCalls(spoof);
      blocked(await settles(rig.hook.guard(UNKNOWN_TOOL), "guard"), "a guard through the refused client");
      assert.equal(statusCalls(spoof), before, "no read goes through the refused client");
    });
  }
}

// ---- Registry ---------------------------------------------------------------

type CaseRun = (factory: HostBootHookFactory, manifest: HostPluginManifest) => Promise<void>;

const CASES: readonly { readonly id: string; readonly run: CaseRun }[] = [
  { id: "C1-attach-budget", run: attachBudget },
  { id: "C2-attach-ok-readback", run: attachOkReadback },
  { id: "C3-refused-up-retention", run: refusedUpRetention },
  { id: "C4-terminal-attach-failure", run: terminalAttachFailure },
  { id: "C5-guard-fail-closed", run: guardFailClosed },
  { id: "C6-shutdown-client-only", run: shutdownClientOnly },
  { id: "C7-reattach-off-by-default", run: reattachOffByDefault },
  { id: "C8-reattach-bounded", run: reattachBounded },
  { id: "C9-switch-workspace", run: switchWorkspace },
];

export const BOOT_CONFORMANCE_IDS: readonly string[] = CASES.map((entry) => entry.id);

// Runs every case on fresh fakes and reports each outcome. A failed assertion is a failed case, never a throw.
export async function runBootConformance(
  factory: HostBootHookFactory,
  manifest: HostPluginManifest,
): Promise<readonly ConformanceResult[]> {
  const results: ConformanceResult[] = [];
  for (const entry of CASES) {
    try {
      await entry.run(factory, manifest);
      results.push({ id: entry.id, ok: true, detail: "ok" });
    } catch (error: unknown) {
      results.push({ id: entry.id, ok: false, detail: error instanceof Error ? error.message : String(error) });
    }
  }
  return results;
}

// Registers every case as a node:test case named `${label}: ${id}`.
export function defineBootConformance(label: string, factory: HostBootHookFactory, manifest: HostPluginManifest): void {
  for (const entry of CASES) {
    void test(`${label}: ${entry.id}`, async () => {
      await entry.run(factory, manifest);
    });
  }
}

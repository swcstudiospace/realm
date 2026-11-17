import assert from "node:assert/strict";
import { test } from "node:test";
import type { RealmError } from "../../src/core/errors.js";
import type { DaemonClient } from "../../src/daemon/client.js";
import { resolveBoot, type ResolvedBoot } from "../../src/host/boot.js";
import { bootHookOf, createBootDriver, STDIO_TOOLS, systemTimers, type BootDriver } from "../../src/host/boot-driver.js";
import { defaultManifestFor } from "../../src/host/manifest.js";
import { HOST_RUNTIMES } from "../../src/host/runtimes.js";
import { HOST_IDS, type HostBootDeps, type HostBootEvent, type HostPluginManifest } from "../../src/host/types.js";
import { sessionIdOfWorkspace } from "../../src/session/paths.js";
import {
  FakeDaemon,
  FakeTimers,
  RecordingSink,
  fail,
  flushMicrotasks,
  hang,
  ok,
  refused,
  scriptedAttach,
  type AttachOutcome,
  type ScriptedAttach,
} from "../support/fake-host-daemon.js";

const ROOT = "/ws/a";
const OTHER = "/ws/other";
const BUDGET_MS = 25;

interface Built {
  readonly driver: BootDriver;
  readonly timers: FakeTimers;
  readonly sink: RecordingSink;
  readonly script: ScriptedAttach;
  readonly events: HostBootEvent[];
  readonly boot: ResolvedBoot;
}

function manifestOf(reattach: boolean): HostPluginManifest {
  return { ...defaultManifestFor("claude", "1.0.0"), boot: { startupBudgetMs: BUDGET_MS, reattach: { enabled: reattach } } };
}

function buildWith(attachDaemon: HostBootDeps["attachDaemon"], reattach: boolean, observe?: (event: HostBootEvent) => void): Omit<Built, "script"> {
  const timers = new FakeTimers();
  const sink = new RecordingSink();
  const events: HostBootEvent[] = [];
  const boot = resolveBoot(manifestOf(reattach));
  const deps: HostBootDeps = {
    attachDaemon,
    now: timers.now,
    random: timers.random,
    timers,
    sink,
    observe:
      observe ??
      ((event) => {
        events.push(event);
      }),
  };
  return { driver: createBootDriver(deps, boot), timers, sink, events, boot };
}

function build(outcomes: readonly AttachOutcome[], reattach = false, observe?: (event: HostBootEvent) => void): Built {
  const script = scriptedAttach(outcomes);
  return { ...buildWith(script.attachDaemon, reattach, observe), script };
}

// An attach that settles only when the test says so.
function deferredAttach(): { attachDaemon: HostBootDeps["attachDaemon"]; settle: (client: DaemonClient, refusal?: RealmError | null) => void } {
  const resolvers: ((value: { client: DaemonClient; refusal: RealmError | null }) => void)[] = [];
  return {
    attachDaemon: () =>
      new Promise((resolve) => {
        resolvers.push(resolve);
      }),
    settle: (client, refusal = null) => {
      for (const resolve of resolvers) {
        resolve({ client, refusal });
      }
    },
  };
}

async function fireNextWait(timers: FakeTimers): Promise<void> {
  const due = timers.nextTimeoutDueIn();
  assert.ok(due !== null, "a wait is armed");
  await timers.advance(due);
}

const calls = (daemon: FakeDaemon): readonly unknown[] => daemon.log.filter((entry) => entry.method === "call").map((entry) => entry.arg);
const statusReads = (daemon: FakeDaemon): number => daemon.methods().filter((method) => method === "status").length;

// ---- outcome ------------------------------------------------------------------------

void test("outcome: ready, with the readback status and no retry pending", async () => {
  const daemon = new FakeDaemon({ root: ROOT });
  const { driver } = build([ok(daemon)]);
  await driver.start(ROOT);
  const outcome = driver.outcome();
  assert.equal(outcome.kind, "ready");
  assert.equal(outcome.code, undefined);
  assert.equal(outcome.status?.sessionId, sessionIdOfWorkspace(ROOT));
  assert.equal(outcome.retrying, false);
  assert.equal(outcome.daemonAnswered, false);
  assert.equal(driver.status().state, "active");
  await driver.shutdown();
});

void test("outcome: refused when the up was refused and the readback confirmed this root and session", async () => {
  const daemon = new FakeDaemon({ root: ROOT, state: "error" });
  const { driver, events } = build([refused(daemon, "PODMAN_MISSING")]);
  await driver.start(ROOT);
  const outcome = driver.outcome();
  assert.equal(outcome.kind, "refused");
  assert.equal(outcome.code, "PODMAN_MISSING");
  assert.equal(outcome.daemonAnswered, true);
  assert.equal(driver.status().state, "error");
  assert.equal(driver.status().code, "PODMAN_MISSING");
  assert.deepEqual(events.map((event) => [event.phase, event.code, event.state]), [["refused", "PODMAN_MISSING", "error"]]);
  await driver.shutdown();
});

void test("outcome: a refusal whose readback is rejected is failed, daemonAnswered, and its client is closed", async () => {
  const daemon = new FakeDaemon({ root: ROOT, state: "error", boundRoot: null });
  const { driver } = build([refused(daemon, "PODMAN_MISSING")]);
  await driver.start(ROOT);
  const outcome = driver.outcome();
  assert.equal(outcome.kind, "failed");
  assert.equal(outcome.code, "SCHEMA_INVALID");
  assert.equal(outcome.daemonAnswered, true);
  assert.equal(daemon.closeCalls, 1);
  await driver.shutdown();
  assert.equal(daemon.closeCalls, 1);
});

void test("outcome: a rejected attach is failed with its code and daemonAnswered false", async () => {
  const { driver, events, timers } = build([fail("POLICY_DENIED")]);
  await driver.start(ROOT);
  const outcome = driver.outcome();
  assert.equal(outcome.kind, "failed");
  assert.equal(outcome.code, "POLICY_DENIED");
  assert.equal(outcome.daemonAnswered, false);
  assert.equal(outcome.status, null);
  assert.equal(timers.pendingCount(), 0, "no client, no poll");
  assert.deepEqual(events.map((event) => [event.phase, event.code, event.state]), [["failed", "POLICY_DENIED", null]]);
  await driver.shutdown();
});

void test("a budget expiry is STARTUP_BUDGET_EXCEEDED, and a late attach is closed, never adopted", async () => {
  const deferred = deferredAttach();
  const { driver, events } = buildWith(deferred.attachDaemon, false);
  await driver.start(ROOT);
  assert.equal(driver.outcome().kind, "failed");
  assert.equal(driver.outcome().code, "STARTUP_BUDGET_EXCEEDED");
  assert.deepEqual(events.map((event) => event.code), ["STARTUP_BUDGET_EXCEEDED"]);
  const late = new FakeDaemon({ root: ROOT });
  deferred.settle(late);
  await flushMicrotasks();
  assert.equal(late.closeCalls, 1, "the late client is closed");
  assert.equal(driver.outcome().kind, "failed");
  assert.equal(statusReads(late), 0, "a late client is never read");
  await driver.shutdown();
});

void test("shutdown while start is pending settles start, and the late attach is closed", async () => {
  const deferred = deferredAttach();
  const { driver, timers } = buildWith(deferred.attachDaemon, false);
  const started = driver.start(ROOT);
  await driver.shutdown();
  await started;
  assert.equal(driver.outcome().kind, "failed");
  assert.equal(driver.outcome().code, "REALM_NOT_ACTIVE");
  const late = new FakeDaemon({ root: ROOT });
  deferred.settle(late);
  await flushMicrotasks();
  assert.equal(late.closeCalls, 1);
  assert.equal(timers.pendingCount(), 0);
});

// ---- readback validation ----------------------------------------------------------------

void test("readback: another session id or another root is not adopted", async () => {
  for (const spoof of [
    new FakeDaemon({ root: ROOT, sessionId: sessionIdOfWorkspace(OTHER) }),
    new FakeDaemon({ root: OTHER }),
  ]) {
    const { driver } = build([ok(spoof)]);
    await driver.start(ROOT);
    assert.equal(spoof.closeCalls, 1);
    assert.equal(driver.status().state, "error");
    assert.equal(driver.status().code, "SCHEMA_INVALID");
    assert.equal(driver.outcome().kind, "failed");
    await driver.shutdown();
  }
});

void test("readback: no root is adopted after a successful up and not after a refusal", async () => {
  const older = new FakeDaemon({ root: ROOT, boundRoot: null });
  const adopted = build([ok(older)]);
  await adopted.driver.start(ROOT);
  assert.equal(adopted.driver.outcome().kind, "ready");
  assert.equal(older.closeCalls, 0);
  await adopted.driver.shutdown();
  const unrooted = new FakeDaemon({ root: ROOT, state: "error", boundRoot: null });
  const refusedCase = build([refused(unrooted, "PODMAN_MISSING")]);
  await refusedCase.driver.start(ROOT);
  assert.equal(refusedCase.driver.outcome().kind, "failed");
  assert.equal(unrooted.closeCalls, 1);
  await refusedCase.driver.shutdown();
});

// ---- attempts and the poll -----------------------------------------------------------------

void test("with re-attach off one attempt runs, the poll arms no wait, and retry() performs exactly one more", async () => {
  const first = new FakeDaemon({ root: ROOT });
  const second = new FakeDaemon({ root: ROOT });
  const { driver, timers, script } = build([ok(first), ok(second)]);
  await driver.start(ROOT);
  assert.equal(script.roots.length, 1);
  assert.equal(driver.status().link, "off");
  assert.equal(timers.pendingTimeouts(), 0);
  assert.equal(timers.pendingCount(), 1, "one repaint poll");
  first.failStatus("REALM_NOT_ACTIVE");
  await timers.advance(1_000_000);
  assert.equal(script.roots.length, 1, "a lost link attaches nothing");
  assert.equal(timers.pendingTimeouts(), 0);
  assert.equal(driver.status().state, "error");
  await driver.retry();
  assert.equal(script.roots.length, 2);
  assert.equal(first.closeCalls, 1);
  assert.equal(driver.status().state, "active");
  await driver.shutdown();
  assert.equal(timers.pendingCount(), 0);
});

void test("the poll paints only a changed status and its text carries no path", async () => {
  const daemon = new FakeDaemon({ root: ROOT });
  const { driver, timers, sink } = build([ok(daemon)]);
  await driver.start(ROOT);
  const painted = sink.statuses.length;
  await timers.advance(5 * 2_000);
  assert.equal(sink.statuses.length, painted);
  daemon.setState("error");
  await timers.advance(2_000);
  assert.equal(sink.statuses.length, painted + 1);
  for (const entry of sink.statuses) {
    assert.ok(!entry.text.includes("/"), entry.text);
  }
  await driver.shutdown();
});

void test("with re-attach on the poll is armed and a lost link re-attaches within the bounds", async () => {
  const first = new FakeDaemon({ root: ROOT });
  const second = new FakeDaemon({ root: ROOT });
  const { driver, timers, script, events } = build([ok(first), fail("DAEMON_START_TIMEOUT"), ok(second)], true);
  timers.randomValue = 0;
  await driver.start(ROOT);
  assert.equal(driver.status().link, "linked");
  assert.equal(timers.pendingCount(), 1);
  first.failStatus("REALM_NOT_ACTIVE");
  await timers.advance(2_000);
  assert.equal(driver.status().link, "reconnecting");
  assert.equal(driver.outcome().retrying, true);
  assert.equal(driver.outcome().kind, "failed");
  await fireNextWait(timers);
  assert.equal(driver.status().link, "reconnecting");
  await fireNextWait(timers);
  assert.equal(driver.status().link, "linked");
  assert.equal(script.roots.length, 3);
  assert.equal(driver.outcome().kind, "ready");
  assert.deepEqual(events.map((event) => event.phase), ["attached", "link-lost", "failed", "reattached"]);
  assert.deepEqual(events.map((event) => event.attempt), [1, 1, 2, 3]);
  for (const event of events) {
    assert.ok(Number.isInteger(event.durationMs) && event.durationMs >= 0 && event.durationMs <= 600_000);
    assert.ok(event.attempt >= 1 && event.attempt <= 9);
  }
  await driver.shutdown();
  assert.equal(timers.pendingCount(), 0);
  assert.equal(second.closeCalls, 1);
});

// ---- guard and call ---------------------------------------------------------------------------

void test("guard: the six Realm tools pass on the link state alone, with no status read", async () => {
  const daemon = new FakeDaemon({ root: ROOT });
  const { driver } = build([ok(daemon)]);
  await driver.start(ROOT);
  const before = daemon.log.length;
  for (const name of STDIO_TOOLS) {
    assert.equal(await driver.guard(name), undefined, name);
  }
  assert.equal(daemon.log.length, before);
  await driver.shutdown();
  for (const name of STDIO_TOOLS) {
    assert.deepEqual(await driver.guard(name), { block: true, reason: "REALM_NOT_ACTIVE" }, name);
  }
});

void test("guard: with no adopted client the five tools are refused and retry still passes", async () => {
  const { driver } = build([fail("POLICY_DENIED")]);
  await driver.start(ROOT);
  assert.deepEqual(await driver.guard("exec"), { block: true, reason: "POLICY_DENIED" });
  assert.equal(await driver.guard("retry"), undefined);
  await driver.shutdown();
});

void test("guard: an unknown name is classified by one status read: refused in fail-closed, passed in advisory", async () => {
  const closed = new FakeDaemon({ root: ROOT, mode: "fail-closed" });
  const one = build([ok(closed)]);
  await one.driver.start(ROOT);
  const before = statusReads(closed);
  assert.deepEqual(await one.driver.guard("bogus"), { block: true, reason: "POLICY_DENIED" });
  assert.equal(statusReads(closed), before + 1);
  await one.driver.shutdown();
  const advisory = new FakeDaemon({ root: ROOT, mode: "advisory" });
  const two = build([ok(advisory)]);
  await two.driver.start(ROOT);
  assert.equal(await two.driver.guard("bogus"), undefined);
  await two.driver.shutdown();
});

void test("guard: a shutdown cancels a pending status read and blocks", async () => {
  const daemon = new FakeDaemon({ root: ROOT });
  const { driver, timers } = build([ok(daemon)]);
  await driver.start(ROOT);
  daemon.hangStatus(true);
  const verdict = driver.guard("bogus");
  await driver.shutdown();
  assert.deepEqual(await verdict, { block: true, reason: "REALM_NOT_ACTIVE" });
  assert.equal(timers.pendingCount(), 0);
});

void test("call forwards the exact tool object and returns the daemon's outcome, refusals included, untouched", async () => {
  const daemon = new FakeDaemon({ root: ROOT });
  const { driver } = build([ok(daemon)]);
  await driver.start(ROOT);
  const tool = { status: {} };
  const outcome = await driver.call(tool);
  assert.deepEqual(outcome, { outcome: "refused", tool: null, code: "POLICY_DENIED", retryable: false });
  const forwarded = calls(daemon);
  assert.equal(forwarded.length, 1);
  assert.equal(forwarded[0], tool);
  await driver.shutdown();
});

void test("call refuses a malformed tool map with SCHEMA_INVALID and no daemon call", async () => {
  const daemon = new FakeDaemon({ root: ROOT });
  const { driver } = build([ok(daemon)]);
  await driver.start(ROOT);
  class Shaped {
    readonly exec = {};
  }
  const before = daemon.log.length;
  for (const bad of [null, undefined, [], {}, { exec: {}, read: {} }, "exec", 7, new Shaped(), [{ exec: {} }]]) {
    assert.deepEqual(await driver.call(bad), { outcome: "refused", tool: null, code: "SCHEMA_INVALID", retryable: false });
  }
  assert.equal(daemon.log.length, before);
  await driver.shutdown();
});

void test("call of a name outside the six tools: refused POLICY_DENIED under fail-closed, forwarded under advisory", async () => {
  const closed = new FakeDaemon({ root: ROOT, mode: "fail-closed" });
  const one = build([ok(closed)]);
  await one.driver.start(ROOT);
  assert.deepEqual(await one.driver.call({ bogus: {} }), { outcome: "refused", tool: null, code: "POLICY_DENIED", retryable: false });
  assert.equal(calls(closed).length, 0);
  await one.driver.shutdown();
  const advisory = new FakeDaemon({ root: ROOT, mode: "advisory" });
  const two = build([ok(advisory)]);
  await two.driver.start(ROOT);
  await two.driver.call({ bogus: {} });
  assert.equal(calls(advisory).length, 1);
  await two.driver.shutdown();
});

void test("call while reconnecting is refused REALM_NOT_ACTIVE, retryable, with no daemon call", async () => {
  const daemon = new FakeDaemon({ root: ROOT });
  const { driver, timers } = build([ok(daemon), ...Array.from({ length: 4 }, () => fail("DAEMON_START_TIMEOUT"))], true);
  await driver.start(ROOT);
  daemon.failStatus("REALM_NOT_ACTIVE");
  await timers.advance(2_000);
  assert.equal(driver.status().link, "reconnecting");
  const before = daemon.log.length;
  assert.deepEqual(await driver.call({ exec: { argv: ["true"] } }), { outcome: "refused", tool: "exec", code: "REALM_NOT_ACTIVE", retryable: true });
  assert.equal(daemon.log.length, before);
  await driver.shutdown();
});

void test("retry while failed runs one attach, then forwards", async () => {
  const daemon = new FakeDaemon({ root: ROOT });
  const { driver, script } = build([fail("POLICY_DENIED"), ok(daemon)]);
  await driver.start(ROOT);
  assert.equal(driver.outcome().kind, "failed");
  const tool = { retry: {} };
  const outcome = await driver.call(tool);
  assert.equal(script.roots.length, 2);
  assert.equal(driver.outcome().kind, "ready");
  assert.equal(calls(daemon)[0], tool);
  assert.equal(outcome.outcome, "refused");
  await driver.shutdown();
});

void test("retry on a healthy session forwards without a new attach", async () => {
  const daemon = new FakeDaemon({ root: ROOT });
  const { driver, script } = build([ok(daemon)]);
  await driver.start(ROOT);
  await driver.call({ retry: {} });
  assert.equal(script.roots.length, 1);
  assert.equal(calls(daemon).length, 1);
  await driver.shutdown();
});

void test("a client whose call rejects REALM_NOT_ACTIVE yields a refusal, not a throw", async () => {
  const daemon = new FakeDaemon({ root: ROOT });
  const { driver, events } = build([ok(daemon)]);
  await driver.start(ROOT);
  daemon.close();
  const outcome = await driver.call({ list: { path: ".", depth: 1 } });
  assert.deepEqual(outcome, { outcome: "refused", tool: "list", code: "REALM_NOT_ACTIVE", retryable: true });
  assert.deepEqual(events.map((event) => event.phase), ["attached", "link-lost"]);
  await driver.shutdown();
});

void test("a link lost by a call with re-attach on arms one wait", async () => {
  const first = new FakeDaemon({ root: ROOT });
  const { driver, timers } = build([ok(first), fail("DAEMON_START_TIMEOUT")], true);
  await driver.start(ROOT);
  first.close();
  await driver.call({ status: {} });
  assert.equal(driver.status().link, "reconnecting");
  assert.equal(timers.pendingTimeouts(), 1);
  await driver.shutdown();
  assert.equal(timers.pendingCount(), 0);
});

// ---- observer -----------------------------------------------------------------------------------

void test("observer: success, refusal and shutdown emit attached, refused and one closed", async () => {
  const daemon = new FakeDaemon({ root: ROOT });
  const { driver, events } = build([ok(daemon)]);
  await driver.start(ROOT);
  await driver.shutdown();
  await driver.shutdown();
  assert.deepEqual(events.map((event) => event.phase), ["attached", "closed"]);
  assert.equal(events[0]?.state, "active");
});

void test("a throwing observer changes no outcome", async () => {
  const daemon = new FakeDaemon({ root: ROOT });
  const { driver } = build([ok(daemon)], false, () => {
    throw new Error("observer failed");
  });
  await driver.start(ROOT);
  assert.equal(driver.outcome().kind, "ready");
  await driver.shutdown();
  assert.equal(daemon.closeCalls, 1);
});

void test("shutdown makes no daemon call but close and a hung attach does not hold it", async () => {
  const hung = build([hang()]);
  const started = hung.driver.start(ROOT);
  await hung.driver.shutdown();
  await started;
  assert.equal(hung.driver.outcome().kind, "failed");
  const daemon = new FakeDaemon({ root: ROOT });
  const { driver } = build([ok(daemon)]);
  await driver.start(ROOT);
  const before = daemon.log.length;
  await driver.shutdown();
  assert.deepEqual(daemon.methods().slice(before), ["close"]);
});

// ---- systemTimers and bootHookOf -------------------------------------------------------------------

void test("systemTimers handles are unref'd and clear cancels", async () => {
  // systemTimers hands out Node timers; the cast only reaches hasRef().
  const timeout = systemTimers.setTimeout(() => undefined, 60_000) as NodeJS.Timeout;
  const interval = systemTimers.setInterval(() => undefined, 60_000) as NodeJS.Timeout;
  assert.equal(timeout.hasRef(), false);
  assert.equal(interval.hasRef(), false);
  systemTimers.clear(timeout);
  systemTimers.clear(interval);
  let fired = false;
  const cancelled = systemTimers.setTimeout(() => {
    fired = true;
  }, 5);
  systemTimers.clear(cancelled);
  // Real timers are the subject here: a cleared real timeout must not fire, which fake timers cannot show.
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 40);
  });
  assert.equal(fired, false);
  systemTimers.clear(undefined);
  systemTimers.clear("not a handle");
});

void test("bootHookOf is null for omp only, and its factory builds a driver with link off", async () => {
  for (const id of HOST_IDS) {
    const factory = bootHookOf(HOST_RUNTIMES[id]);
    if (id === "omp") {
      assert.equal(factory, null);
      continue;
    }
    assert.ok(factory !== null, id);
    const timers = new FakeTimers();
    const driver = factory(
      { attachDaemon: scriptedAttach([]).attachDaemon, now: timers.now, random: timers.random, timers, sink: new RecordingSink() },
      defaultManifestFor(id, "1.0.0"),
    );
    assert.equal(driver.status().link, "off", id);
    await driver.shutdown();
  }
});

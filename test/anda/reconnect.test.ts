// Reconnect and timer tests for AndaBridge (ANDA-03). Deterministic time is used wherever the
// property allows it: a fake clock drives the connect deadline and the recorded waits, and
// every wait for an event or a server observation is event-driven. Three tests run real
// timers on purpose, because the property under test is the timer itself: the per-attempt
// request timeout, the monitor's real backoff, and the absence of any live timer after close.
// Those tests are marked where they start.

import { test } from "node:test";
import assert from "node:assert/strict";
import { request as httpRequest, type ClientRequest } from "node:http";
import { AndaBridge, sleepUnlessAborted, type SleepFn } from "../../src/anda/client.js";
import { RealmError } from "../../src/core/errors.js";
import type { BridgeEvent } from "../../src/core/ports.js";
import { FakeAnda, HEALTHY_INFORMATION } from "../support/fake-anda.js";

// Count of live timers the runtime reports. A timer left behind after close shows here.
function liveTimers(): number {
  return process.getActiveResourcesInfo().filter((name) => name === "Timeout").length;
}

function expectCode(code: string): (error: unknown) => boolean {
  return (error: unknown): boolean => {
    assert.ok(error instanceof RealmError, "expected a RealmError");
    assert.equal(error.code, code);
    return true;
  };
}

// Resolves with the first event that satisfies predicate. The subscription is registered when
// this is called, so the caller calls it before the state change that publishes the event.
// The bridge publishes from network callbacks, which run after the caller's synchronous code.
function nextEvent(bridge: AndaBridge, predicate: (event: BridgeEvent) => boolean): Promise<BridgeEvent> {
  return new Promise<BridgeEvent>((resolve) => {
    const unsubscribe = bridge.subscribe((event) => {
      if (predicate(event)) {
        unsubscribe();
        resolve(event);
      }
    });
  });
}

interface Clock {
  readonly delays: number[];
  now(): number;
  readonly sleep: SleepFn;
}

// Sleeps advance the clock at once and are recorded. The deadline is therefore measured in
// the same fake time as the waits, and the test sees each wait exactly.
function fakeClock(): Clock {
  let time = 0;
  const delays: number[] = [];
  return {
    delays,
    now: () => time,
    sleep: (ms) => {
      delays.push(ms);
      time += ms;
      return Promise.resolve();
    },
  };
}

// Records each wait, then runs the real sleep, so the background loop keeps its real timers.
function recordingSleep(delays: number[]): SleepFn {
  return (ms, signal) => {
    delays.push(ms);
    return sleepUnlessAborted(ms, signal);
  };
}

// A URL whose port refuses connections, because the fake was started and then stopped.
async function refusedUrl(): Promise<string> {
  const fake = new FakeAnda();
  await fake.start();
  const url = fake.url();
  await fake.stop();
  return url;
}

test("ANDA-03: an unreachable engine exhausts the deadline with ANDA_UNREACHABLE and bounded growing delays", async (t) => {
  const url = await refusedUrl();
  const clock = fakeClock();
  const bridge = new AndaBridge({
    url,
    random: () => 1,
    now: clock.now,
    sleep: clock.sleep,
    backoff: { baseMs: 500, capMs: 30_000 },
  });
  t.after(() => bridge.close());

  await assert.rejects(bridge.connect(3500), expectCode("ANDA_UNREACHABLE"));

  // 500, then 1000, then 2000 reaches the 3500 ms deadline. The third wait is not cut short.
  assert.deepEqual(clock.delays, [500, 1000, 2000]);
});

test("ANDA-03: backoff delays stop growing at the cap and never exceed it", async (t) => {
  const url = await refusedUrl();
  const clock = fakeClock();
  const bridge = new AndaBridge({
    url,
    random: () => 1,
    now: clock.now,
    sleep: clock.sleep,
    backoff: { baseMs: 500, capMs: 1000 },
  });
  t.after(() => bridge.close());

  await assert.rejects(bridge.connect(4000), expectCode("ANDA_UNREACHABLE"));

  // 500, 1000, then the cap of 1000 for every later wait, and a final wait cut to the deadline.
  assert.deepEqual(clock.delays, [500, 1000, 1000, 1000, 500]);
  assert.ok(clock.delays.every((ms) => ms <= 1000), "no wait may exceed the cap");
});

// Real timers: the per-attempt request timeout is the property under test (F-P3-05). Each attempt is
// cut at 50 ms, and the 5 ms waits between attempts keep the sequence inside the 120 ms budget.
test("ANDA-03: a hung engine times out each attempt and the server sees each request aborted", async (t) => {
  const fake = new FakeAnda();
  await fake.start();
  t.after(() => fake.stop());
  fake.respond({ kind: "hang" });
  const bridge = new AndaBridge({
    url: fake.url(),
    random: () => 1,
    backoff: { baseMs: 5, capMs: 5 },
    requestTimeoutMs: 50,
  });
  t.after(() => bridge.close());

  await assert.rejects(bridge.connect(120), expectCode("ANDA_UNREACHABLE"));

  // Attempts start near 0, 55 and 110 ms. Each one is cut at 50 ms or at the budget that remains (F1).
  assert.ok(fake.requestCount() >= 2, "each attempt that fits the budget is sent");
  await fake.waitUntil(() => fake.requests().every((request) => request.aborted));
});

// Real timers: the monitor's backoff between probes runs on the real sleep here, so the
// recorded waits are the real ones the loop uses.
test("ANDA-03: a mid-run failure publishes down, retries with growing delays, and publishes up on recovery", async (t) => {
  const fake = new FakeAnda();
  await fake.start();
  t.after(() => fake.stop());
  const delays: number[] = [];
  const bridge = new AndaBridge({
    url: fake.url(),
    random: () => 1,
    backoff: { baseMs: 5, capMs: 20 },
    sleep: recordingSleep(delays),
  });
  t.after(() => bridge.close());
  const events: BridgeEvent[] = [];
  bridge.subscribe((event) => {
    events.push(event);
  });

  await bridge.connect(5000);
  fake.respond({ kind: "reset" });
  const down = await nextEvent(bridge, (event) => event.kind === "down");
  // The connect was one request, so four means three failed probes after the down.
  await fake.waitUntil(() => fake.requestCount() >= 4);

  assert.equal(down.code, "ANDA_UNREACHABLE");
  assert.deepEqual(events.map((event) => event.kind), ["down"], "a sustained outage publishes down once");
  assert.deepEqual(delays.slice(0, 3), [5, 10, 20], "each failed probe grows the wait to the cap");

  fake.respond({ kind: "json", body: HEALTHY_INFORMATION });
  await nextEvent(bridge, (event) => event.kind === "up");

  assert.deepEqual(events.map((event) => event.kind), ["down", "up"]);
  assert.equal(events[1]?.code, undefined, "up carries no code");
  assert.equal(bridge.snapshot()?.kind, "up");
});

test("ANDA-03: a mismatch while monitoring publishes mismatch with ANDA_VERSION_MISMATCH and stops probing", async (t) => {
  const fake = new FakeAnda();
  await fake.start();
  t.after(() => fake.stop());
  const bridge = new AndaBridge({ url: fake.url(), random: () => 1, backoff: { baseMs: 5, capMs: 20 } });
  t.after(() => bridge.close());

  await bridge.connect(5000);
  const mismatch = nextEvent(bridge, (event) => event.kind === "mismatch");
  fake.respond({ kind: "json", body: {} });
  const event = await mismatch;

  assert.equal(event.code, "ANDA_VERSION_MISMATCH");
  // The monitor returns in the same step that publishes the mismatch, so no probe can follow it.
  const count = fake.requestCount();
  await bridge.close();
  assert.equal(fake.requestCount(), count, "no probe runs after a mismatch");
});

// Real timer: the sleeping monitor's timer must be cleared by close (F-P3-05).
test("ANDA-03: close() cancels the sleeping monitor and leaves no timer", async (t) => {
  const fake = new FakeAnda();
  await fake.start();
  t.after(() => fake.stop());
  const before = liveTimers();
  // Default sleep and the default 500 ms base: the monitor is inside its first wait here.
  const bridge = new AndaBridge({ url: fake.url(), random: () => 1 });

  await bridge.connect(5000);
  await bridge.close();

  assert.equal(liveTimers(), before, "close must cancel the monitor's timer");
});

// Real timer: the attempt timer must be cleared when close aborts the attempt (F-P3-05).
test("ANDA-03: close() aborts an in-flight attempt, the server sees the abort, and no timer survives", async (t) => {
  const fake = new FakeAnda();
  await fake.start();
  t.after(() => fake.stop());
  fake.respond({ kind: "hang" });
  const before = liveTimers();
  const bridge = new AndaBridge({ url: fake.url(), random: () => 1 });
  // Attach the rejection handler now, so a rejection during close is never unhandled.
  const attempt = bridge.connect(5000).then(
    () => undefined,
    (error: unknown) => error,
  );
  await fake.waitUntil(() => fake.requestCount() === 1);

  await bridge.close();

  const error = await attempt;
  assert.ok(error instanceof RealmError, "the in-flight connect must reject");
  assert.equal(error.code, "ANDA_UNREACHABLE");
  await fake.waitUntil(() => fake.requests().every((request) => request.aborted));
  assert.equal(liveTimers(), before, "close must clear the attempt timer");
});

test("ANDA-02/ANDA-03: connect after close starts a fresh handshake and reaches a healthy engine", async (t) => {
  const fake = new FakeAnda();
  await fake.start();
  t.after(() => fake.stop());
  const bridge = new AndaBridge({ url: fake.url() });
  await bridge.close();

  await bridge.connect(100);
  assert.equal(fake.requestCount(), 1, "the fresh handshake is one anonymous request");
  await bridge.close();
});

// Real timers: a failed connect must clear each attempt timer and leave no request open (F-P3-05).
// Attempts are counted at the transport seam, which is the bridge's own record of what it sent. The
// fake engine records a request only once it parses it, so a request the bridge abandoned before the
// engine parsed it can reach the engine's log after a snapshot of that log. The request timeout is set
// well above any scheduling stall, so a retry's first attempt is not cut short by its timer under load.
test("ANDA-03: a failed connect leaves no live timer and no open request, and a retry on the same bridge succeeds", async (t) => {
  const fake = new FakeAnda();
  await fake.start();
  t.after(() => fake.stop());
  fake.respond({ kind: "hang" });
  const sent: ClientRequest[] = [];
  const bridge = new AndaBridge({
    url: fake.url(),
    random: () => 1,
    backoff: { baseMs: 5, capMs: 20 },
    requestTimeoutMs: 1000,
    transport: (options, onResponse) => {
      const req = httpRequest(options, onResponse);
      sent.push(req);
      return req;
    },
  });
  t.after(() => bridge.close());
  const before = liveTimers();

  await assert.rejects(bridge.connect(2500), expectCode("ANDA_UNREACHABLE"));
  await fake.waitUntil(() => fake.requests().every((request) => request.aborted));
  assert.equal(liveTimers(), before, "a failed connect clears every attempt timer");
  assert.ok(sent.every((req) => req.destroyed), "a failed connect destroys every request it sent");

  const failed = sent.length;
  fake.respond({ kind: "json", body: HEALTHY_INFORMATION });
  await bridge.connect(5000);
  assert.equal(sent.length, failed + 1, "the retry's first attempt succeeds");
});

test("ANDA-03: a connect that exhausts its deadline is retryable, and the retry waits within its own deadline", async (t) => {
  const fake = new FakeAnda();
  await fake.start();
  t.after(() => fake.stop());
  fake.respond({ kind: "reset" });
  const clock = fakeClock();
  const bridge = new AndaBridge({ url: fake.url(), random: () => 1, now: clock.now, sleep: clock.sleep });
  t.after(() => bridge.close());

  await assert.rejects(bridge.connect(3500), expectCode("ANDA_UNREACHABLE"));
  assert.deepEqual(clock.delays, [500, 1000, 2000]);
  const failed = fake.requestCount();

  await assert.rejects(bridge.connect(1000), expectCode("ANDA_UNREACHABLE"));
  // The retry starts at 3500 ms with a 1000 ms deadline: sends at 3500 and 4000 ms, waits of 500
  // and 500, then exhaustion at 4500 ms with no send at the deadline (F1).
  assert.deepEqual(clock.delays, [500, 1000, 2000, 500, 500]);
  assert.equal(fake.requestCount(), failed + 2);
});

// Real timer: a connect must reject at its own deadline, not at the per-attempt request timeout,
// because each attempt is clamped to the budget that remains (F1).
test("ANDA-03: a connect against a hung engine rejects at its deadline, not at the request timeout", { timeout: 5000 }, async (t) => {
  const fake = new FakeAnda();
  await fake.start();
  t.after(() => fake.stop());
  fake.respond({ kind: "hang" });
  const bridge = new AndaBridge({ url: fake.url(), random: () => 1 });
  t.after(() => bridge.close());

  const started = Date.now();
  await assert.rejects(bridge.connect(300), expectCode("ANDA_UNREACHABLE"));
  const elapsed = Date.now() - started;

  // The default request timeout is 2000 ms, so 250 ms of slack covers timer scheduling only.
  assert.ok(elapsed < 300 + 250, `a 300 ms connect must reject near its deadline, took ${elapsed} ms`);
  await fake.waitUntil(() => fake.requests().every((request) => request.aborted));
});

test("ANDA-03: a connect never sends a request at or after its deadline", async (t) => {
  const fake = new FakeAnda();
  await fake.start();
  t.after(() => fake.stop());
  fake.respond({ kind: "reset" });
  const clock = fakeClock();
  const bridge = new AndaBridge({ url: fake.url(), random: () => 1, now: clock.now, sleep: clock.sleep });
  t.after(() => bridge.close());

  await assert.rejects(bridge.connect(3500), expectCode("ANDA_UNREACHABLE"));

  // Sends at 0, 500 and 1500 ms. The wait that reaches 3500 ms ends on the deadline, so no send follows it.
  assert.equal(clock.now(), 3500);
  assert.deepEqual(clock.delays, [500, 1000, 2000]);
  assert.equal(fake.requestCount(), 3, "a request at the deadline would be a fourth");
});

test("ANDA-03: a connect with no budget left rejects at once and sends nothing", async (t) => {
  const fake = new FakeAnda();
  await fake.start();
  t.after(() => fake.stop());
  const bridge = new AndaBridge({ url: fake.url(), random: () => 1 });
  t.after(() => bridge.close());

  await assert.rejects(bridge.connect(0), expectCode("ANDA_UNREACHABLE"));
  assert.equal(fake.requestCount(), 0, "a connect whose deadline has already passed sends no request");
});

test("ANDA-03: a connect while a handshake is in flight rejects with a plain Error and sends nothing", async (t) => {
  const fake = new FakeAnda();
  await fake.start();
  t.after(() => fake.stop());
  fake.respond({ kind: "hang" });
  const bridge = new AndaBridge({ url: fake.url(), random: () => 1 });
  t.after(() => bridge.close());
  // Attach the rejection handler now, so a rejection during close is never unhandled.
  const first = bridge.connect(5000).then(
    () => undefined,
    (error: unknown) => error,
  );
  await fake.waitUntil(() => fake.requestCount() === 1);

  await assert.rejects(bridge.connect(5000), (error: unknown) => error instanceof Error && !(error instanceof RealmError));
  assert.equal(fake.requestCount(), 1, "the rejected call sends nothing");

  await bridge.close();
  const error = await first;
  assert.ok(error instanceof RealmError, "the in-flight connect still rejects");
  assert.equal(error.code, "ANDA_UNREACHABLE");
});

test("ANDA-03: a connect while connected rejects with a plain Error and starts no second monitor", async (t) => {
  const fake = new FakeAnda();
  await fake.start();
  t.after(() => fake.stop());
  // The sleep only records each wait and waits for the abort, so the monitor stays parked.
  const waits: number[] = [];
  const bridge = new AndaBridge({
    url: fake.url(),
    random: () => 1,
    sleep: (ms, signal) => {
      waits.push(ms);
      return new Promise<void>((resolve) => {
        signal.addEventListener("abort", () => resolve(), { once: true });
      });
    },
  });
  t.after(() => bridge.close());

  await bridge.connect(5000);
  assert.equal(waits.length, 1, "the monitor parks in its first wait");

  await assert.rejects(bridge.connect(5000), (error: unknown) => error instanceof Error && !(error instanceof RealmError));
  assert.equal(waits.length, 1, "a rejected connect starts no second monitor");
  assert.equal(fake.requestCount(), 1, "a rejected connect sends nothing");
});

test("ANDA-03: a mismatch while monitoring is final: a later connect rejects with ANDA_VERSION_MISMATCH and sends nothing", async (t) => {
  const fake = new FakeAnda();
  await fake.start();
  t.after(() => fake.stop());
  const bridge = new AndaBridge({ url: fake.url(), random: () => 1, backoff: { baseMs: 5, capMs: 20 } });
  t.after(() => bridge.close());
  await bridge.connect(5000);
  const mismatch = nextEvent(bridge, (event) => event.kind === "mismatch");
  fake.respond({ kind: "json", body: {} });
  await mismatch;
  const count = fake.requestCount();

  fake.respond({ kind: "json", body: HEALTHY_INFORMATION });
  await assert.rejects(bridge.connect(5000), expectCode("ANDA_VERSION_MISMATCH"));
  assert.equal(fake.requestCount(), count, "a bridge that saw a mismatch sends nothing on connect");
});

test("ANDA-02/ANDA-03: connect, close, connect again succeeds against the fake server and leaves zero timers after close", async (t) => {
  const fake = new FakeAnda();
  await fake.start();
  t.after(() => fake.stop());
  const before = liveTimers();
  const bridge = new AndaBridge({ url: fake.url(), random: () => 1 });
  await bridge.connect(5000);
  await bridge.close();
  const sent = fake.requestCount();

  await bridge.connect(5000);
  assert.equal(fake.requestCount(), sent + 1, "the second connect is a fresh handshake: one request");
  await bridge.close();
  assert.equal(liveTimers(), before, "close after the second connect leaves no timer");
});

// Real timers: a listener that throws on up must not stop the other listeners or the monitor (F3).
// The failed up stays pending and is delivered again on the next probe tick, so the listener that
// failed once receives up again. The snapshot stays up while the delivery is pending: the engine
// is up, and a failed delivery must not report a contradicting down.
test("ANDA-03: a listener that throws on up keeps the monitor running and re-delivers up on the next probe tick", { timeout: 5000 }, async (t) => {
  const fake = new FakeAnda();
  await fake.start();
  t.after(() => fake.stop());
  const before = liveTimers();
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown): void => {
    unhandled.push(reason);
  };
  process.on("unhandledRejection", onUnhandled);
  t.after(() => {
    process.off("unhandledRejection", onUnhandled);
  });
  const delays: number[] = [];
  const bridge = new AndaBridge({
    url: fake.url(),
    random: () => 1,
    backoff: { baseMs: 5, capMs: 20 },
    sleep: recordingSleep(delays),
  });
  t.after(() => bridge.close());
  let failedOnce = false;
  const snapshotsAtFailure: (BridgeEvent["kind"] | undefined)[] = [];
  bridge.subscribe((event) => {
    if (event.kind === "up" && !failedOnce) {
      failedOnce = true;
      snapshotsAtFailure.push(bridge.snapshot()?.kind);
      throw new Error("listener failure");
    }
  });
  const received: BridgeEvent[] = [];
  bridge.subscribe((event) => {
    received.push(event);
  });
  let ups = 0;
  const twoUps = new Promise<void>((resolve) => {
    bridge.subscribe((event) => {
      if (event.kind === "up") {
        ups += 1;
        if (ups === 2) {
          resolve();
        }
      }
    });
  });

  await bridge.connect(5000);
  fake.respond({ kind: "reset" });
  await nextEvent(bridge, (event) => event.kind === "down");
  fake.respond({ kind: "json", body: HEALTHY_INFORMATION });
  await twoUps;

  assert.deepEqual(received.map((event) => event.kind), ["down", "up", "up"], "the failed up is delivered again on the next probe tick");
  assert.deepEqual(snapshotsAtFailure, ["up"], "an up that failed to deliver is not reported as down");
  assert.equal(bridge.snapshot()?.kind, "up");
  // The monitor keeps probing after the listener failure.
  const probes = fake.requestCount();
  await fake.waitUntil(() => fake.requestCount() > probes);
  await bridge.close();
  assert.equal(liveTimers(), before, "close leaves zero timers after a listener failure");
  assert.deepEqual(unhandled, [], "a throwing listener must not reject the monitor");
});

// Real timers: an async listener whose promise rejects is a failed delivery, the same as a listener
// that throws (F2). The rejection must not escape as an unhandled rejection, and the event is
// delivered again on the next probe tick.
test("ANDA-03: an async listener that rejects is a failed delivery, not an unhandled rejection", { timeout: 5000 }, async (t) => {
  const fake = new FakeAnda();
  await fake.start();
  t.after(() => fake.stop());
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown): void => {
    unhandled.push(reason);
  };
  process.on("unhandledRejection", onUnhandled);
  t.after(() => {
    process.off("unhandledRejection", onUnhandled);
  });
  const bridge = new AndaBridge({ url: fake.url(), random: () => 1, backoff: { baseMs: 5, capMs: 20 } });
  t.after(() => bridge.close());
  let failedOnce = false;
  bridge.subscribe(async (event) => {
    if (event.kind === "up" && !failedOnce) {
      failedOnce = true;
      throw new Error("async listener failure");
    }
  });
  let ups = 0;
  const twoUps = new Promise<void>((resolve) => {
    bridge.subscribe((event) => {
      if (event.kind === "up") {
        ups += 1;
        if (ups === 2) {
          resolve();
        }
      }
    });
  });

  await bridge.connect(5000);
  fake.respond({ kind: "reset" });
  await nextEvent(bridge, (event) => event.kind === "down");
  fake.respond({ kind: "json", body: HEALTHY_INFORMATION });
  await twoUps;

  assert.equal(bridge.snapshot()?.kind, "up");
  await bridge.close();
  assert.deepEqual(unhandled, [], "an async listener's rejection must not escape as an unhandled rejection");
});

// Real timers: a monitor that fails after its connection was closed must not write the snapshot of
// the newer connection (F4). Its wait rejects only when its own connection aborts, so the failure
// lands after a newer connect has started.
test("ANDA-03: a failure of a superseded monitor does not change the snapshot of a newer connection", { timeout: 5000 }, async (t) => {
  const fake = new FakeAnda();
  await fake.start();
  t.after(() => fake.stop());
  const bridge = new AndaBridge({
    url: fake.url(),
    random: () => 1,
    sleep: (_ms, signal) =>
      new Promise<void>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("late monitor failure")), { once: true });
      }),
  });
  t.after(() => bridge.close());

  await bridge.connect(5000);
  const closing = bridge.close();
  const reconnecting = bridge.connect(5000);
  await reconnecting;
  await closing;

  assert.equal(bridge.snapshot(), null, "the superseded monitor's failure must not reach the newer connection");
});

// Real timers: the monitor's own loop fails on its first backoff draw. The monitor's terminal
// handler records that as down with ANDA_UNREACHABLE, and close still resolves with no unhandled
// rejection (A1).
test("ANDA-03: a monitor loop that fails on its own ends cleanly on close and records down with ANDA_UNREACHABLE", { timeout: 5000 }, async (t) => {
  const fake = new FakeAnda();
  await fake.start();
  t.after(() => fake.stop());
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown): void => {
    unhandled.push(reason);
  };
  process.on("unhandledRejection", onUnhandled);
  t.after(() => {
    process.off("unhandledRejection", onUnhandled);
  });
  // A successful connect makes no random draw, so the first draw is the monitor's first wait.
  const bridge = new AndaBridge({
    url: fake.url(),
    random: () => {
      throw new Error("random source failure");
    },
  });

  await bridge.connect(5000);
  await bridge.close();

  assert.equal(bridge.snapshot()?.kind, "down");
  assert.equal(bridge.snapshot()?.code, "ANDA_UNREACHABLE");
  assert.deepEqual(unhandled, [], "the monitor's failure must not escape as an unhandled rejection");
});

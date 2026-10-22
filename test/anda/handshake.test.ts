import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AndaBridge, type SleepFn } from "../../src/anda/client.js";
import { RealmError } from "../../src/core/errors.js";
import { FakeAnda, HEALTHY_INFORMATION, type ScriptedReply } from "../support/fake-anda.js";

// This file runs from dist/test/anda, so three levels up is the package root.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const CLIENT_SOURCE = join(ROOT, "src", "anda", "client.ts");
const INFORMATION_PATH = "/.well-known/information";
const CREDENTIAL_HEADER = /^(authorization|proxy-authorization|cookie|x-api-key|ic-auth-.+)$/i;

interface FakeClock {
  readonly delays: number[];
  now(): number;
  readonly sleep: SleepFn;
}

// Sleeps advance the clock at once and are recorded, so no real wait runs. A test that must
// prove a connect never waits asserts that delays is empty.
function fakeClock(): FakeClock {
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

// A backoff far longer than any test runs, so a healthy bridge's background probe never
// fires during the assertions.
const QUIET_BACKOFF = { baseMs: 60_000, capMs: 60_000 };

function expectCode(code: string): (error: unknown) => boolean {
  return (error: unknown): boolean => {
    assert.ok(error instanceof RealmError, "expected a RealmError");
    assert.equal(error.code, code);
    return true;
  };
}

test("ANDA-02: a correct AppInformation shape connects on one anonymous GET", async (t) => {
  const fake = new FakeAnda();
  await fake.start();
  t.after(() => fake.stop());
  const bridge = new AndaBridge({ url: fake.url(), backoff: QUIET_BACKOFF });
  t.after(() => bridge.close());

  await bridge.connect(5000);

  const requests = fake.requests();
  assert.equal(requests.length, 1, "a healthy connect is exactly one request");
  assert.equal(requests[0]?.method, "GET");
  assert.equal(requests[0]?.path, INFORMATION_PATH);
});

test("ANDA-02: a wrong shape fails at once with ANDA_VERSION_MISMATCH and sends exactly one request", async (t) => {
  const fake = new FakeAnda();
  await fake.start();
  t.after(() => fake.stop());
  fake.respond({ kind: "json", body: { ...HEALTHY_INFORMATION, engines: "not-an-array" } });
  const clock = fakeClock();
  const bridge = new AndaBridge({ url: fake.url(), random: () => 1, now: clock.now, sleep: clock.sleep });
  t.after(() => bridge.close());

  await assert.rejects(bridge.connect(5000), expectCode("ANDA_VERSION_MISMATCH"));

  assert.equal(fake.requestCount(), 1, "a mismatch must not be retried");
  assert.deepEqual(clock.delays, [], "a mismatch must not wait for a retry");
});

const MALFORMED: readonly (readonly [string, ScriptedReply])[] = [
  ["a JSON array body", { kind: "json", body: [] }],
  ["a non-JSON 200 body", { kind: "text", body: "<html>ok</html>" }],
  ["engines that is not an array", { kind: "json", body: { ...HEALTHY_INFORMATION, engines: "none" } }],
  ["default_engine that is neither string nor null", { kind: "json", body: { ...HEALTHY_INFORMATION, default_engine: 3 } }],
  ["a negative start_time_ms", { kind: "json", body: { ...HEALTHY_INFORMATION, start_time_ms: -1 } }],
  [
    "a missing start_time_ms",
    { kind: "json", body: { engines: [], default_engine: null } },
  ],
];

for (const [label, reply] of MALFORMED) {
  test(`ANDA-02: ${label} fails closed with ANDA_VERSION_MISMATCH and no retry`, async (t) => {
    const fake = new FakeAnda();
    await fake.start();
    t.after(() => fake.stop());
    fake.respond(reply);
    const clock = fakeClock();
    const bridge = new AndaBridge({ url: fake.url(), random: () => 1, now: clock.now, sleep: clock.sleep });
    t.after(() => bridge.close());

    await assert.rejects(bridge.connect(5000), expectCode("ANDA_VERSION_MISMATCH"));

    assert.equal(fake.requestCount(), 1, "one request, then the mismatch is final");
    assert.deepEqual(clock.delays, []);
  });
}

test("ANDA-02: no request carries a credential header and every request is the anonymous GET route", async (t) => {
  const fake = new FakeAnda();
  await fake.start();
  t.after(() => fake.stop());

  const healthy = new AndaBridge({ url: fake.url(), backoff: QUIET_BACKOFF });
  await healthy.connect(5000);
  await healthy.close();

  fake.respond({ kind: "json", body: {} });
  const mismatched = new AndaBridge({ url: fake.url(), backoff: QUIET_BACKOFF });
  t.after(() => mismatched.close());
  await assert.rejects(mismatched.connect(5000), expectCode("ANDA_VERSION_MISMATCH"));

  const requests = fake.requests();
  assert.equal(requests.length, 2);
  for (const request of requests) {
    assert.equal(request.method, "GET");
    assert.equal(request.path, INFORMATION_PATH);
    assert.equal(request.headers["authorization"], undefined, "no Authorization header (T-03-14)");
    for (const name of Object.keys(request.headers)) {
      assert.doesNotMatch(name, CREDENTIAL_HEADER, `header ${name} must not be sent in Phase 3`);
    }
  }
});

test("ANDA-02: the client module defines no RPC route and produces no credential", () => {
  const source = readFileSync(CLIENT_SOURCE, "utf8");
  assert.doesNotMatch(source, /POST/, "the RPC route must not appear in the bridge (OQ-P3-10)");
  assert.doesNotMatch(source, /authorization/i, "the bridge must not produce a credential (T-03-14)");
});

test("ANDA-02: a mismatch is final: a later connect rejects with ANDA_VERSION_MISMATCH and sends no request", async (t) => {
  const fake = new FakeAnda();
  await fake.start();
  t.after(() => fake.stop());
  fake.respond({ kind: "json", body: { ...HEALTHY_INFORMATION, engines: "not-an-array" } });
  const clock = fakeClock();
  const bridge = new AndaBridge({ url: fake.url(), random: () => 1, now: clock.now, sleep: clock.sleep });
  t.after(() => bridge.close());

  await assert.rejects(bridge.connect(5000), expectCode("ANDA_VERSION_MISMATCH"));
  fake.respond({ kind: "json", body: HEALTHY_INFORMATION });
  await assert.rejects(bridge.connect(5000), expectCode("ANDA_VERSION_MISMATCH"));

  assert.equal(fake.requestCount(), 1, "a mismatch is final: the retry sends nothing");
  assert.deepEqual(clock.delays, [], "a mismatch never waits, before or after the retry");
});

test("ANDA-02: an oversize reply is unreachable, not a mismatch, and does not make the bridge sticky", async (t) => {
  const fake = new FakeAnda();
  await fake.start();
  t.after(() => fake.stop());
  // Above the 64 KiB reply limit. The shape is otherwise valid, so only the size makes it fail.
  fake.respond({ kind: "json", body: { ...HEALTHY_INFORMATION, padding: "x".repeat(70 * 1024) } });
  const clock = fakeClock();
  const bridge = new AndaBridge({ url: fake.url(), random: () => 1, now: clock.now, sleep: clock.sleep });
  t.after(() => bridge.close());

  await assert.rejects(bridge.connect(1000), expectCode("ANDA_UNREACHABLE"));
  assert.deepEqual(clock.delays, [500, 500], "an oversize reply is retried until the deadline, like an unreachable one");
  // The third attempt would start at the 1000 ms deadline, so it is never sent (ANDA-03, F1).
  assert.equal(fake.requestCount(), 2, "each oversize attempt before the deadline is one request");

  fake.respond({ kind: "json", body: HEALTHY_INFORMATION });
  await bridge.connect(1000);
  assert.equal(fake.requestCount(), 3, "a later healthy reply connects: the oversize reply set no sticky mismatch");
});

test("ANDA-02: a transport that throws synchronously is unreachable, its errno code is the reason, and its detail is not echoed", async (t) => {
  const clock = fakeClock();
  let calls = 0;
  const bridge = new AndaBridge({
    url: "http://127.0.0.1:9",
    random: () => 1,
    now: clock.now,
    sleep: clock.sleep,
    transport: () => {
      calls += 1;
      throw Object.assign(new Error("socket detail 10.0.0.7"), { code: "EMFILE" });
    },
  });
  t.after(() => bridge.close());

  const error = await bridge.connect(100).then(
    () => undefined,
    (reason: unknown) => reason,
  );
  assert.ok(error instanceof RealmError, "a synchronous transport throw must surface as a catalogue error");
  assert.equal(error.code, "ANDA_UNREACHABLE");
  assert.doesNotMatch(error.message, /socket detail|10\.0\.0\.7/, "the transport's detail must not be echoed");
  assert.equal(bridge.lastTransportFailure(), "EMFILE", "the errno code is the transport reason");
  assert.equal(calls, 1, "the attempt before the deadline is the only call");
  assert.deepEqual(clock.delays, [100], "the retry waits only as long as the deadline allows");
});

test("ANDA-02: a synchronous transport throw with no errno code gives a fixed, non-blank reason and no detail", async (t) => {
  const clock = fakeClock();
  const bridge = new AndaBridge({
    url: "http://127.0.0.1:9",
    random: () => 1,
    now: clock.now,
    sleep: clock.sleep,
    transport: () => {
      throw new Error("socket detail 10.0.0.7");
    },
  });
  t.after(() => bridge.close());

  await assert.rejects(bridge.connect(100), expectCode("ANDA_UNREACHABLE"));
  const reason = bridge.lastTransportFailure();
  assert.equal(reason, "transport threw without an errno code");
});

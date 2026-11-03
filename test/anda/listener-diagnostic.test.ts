import { test } from "node:test";
import assert from "node:assert/strict";
import { AndaBridge } from "../../src/anda/client.js";
import { makeRealmError } from "../../src/core/errors.js";
import { createLogger, type LogSink, type Logger } from "../../src/observe/logger.js";
import { FakeAnda } from "../support/fake-anda.js";

// A debug-level logger whose JSON lines are collected in lines.
function collectingLogger(lines: string[]): Logger {
  const sink: LogSink = {
    write: (line) => {
      lines.push(line);
      return true;
    },
  };
  return createLogger({ sink, level: "debug", now: () => new Date("2026-11-02T00:00:00.000Z") });
}

// The parsed anda.listener_failed records, in the order they were written.
function diagnosticsOf(lines: readonly string[]): Record<string, unknown>[] {
  return lines
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .filter((record) => record.event === "anda.listener_failed");
}

// A listener that throws must leave a structured diagnostic that names its catalogue code (OBS-02), and the
// listeners after it must still receive the event. A reset from the fake drives one published down event.
void test("a throwing listener is logged with its catalogue code, and the next listener still runs", async (t) => {
  const fake = new FakeAnda();
  await fake.start();
  t.after(() => fake.stop());
  const lines: string[] = [];
  const bridge = new AndaBridge({ url: fake.url(), logger: collectingLogger(lines) });
  t.after(() => bridge.close());

  bridge.subscribe(() => {
    throw makeRealmError("ANDA_UNREACHABLE");
  });
  const received: string[] = [];
  const down = new Promise<void>((resolve) => {
    bridge.subscribe((event) => {
      received.push(event.kind);
      if (event.kind === "down") {
        resolve();
      }
    });
  });

  await bridge.connect(5000);
  fake.respond({ kind: "reset" });
  await down;

  assert.deepEqual(received, ["down"], "the listener after the failing one still receives the event");
  const diagnostics = diagnosticsOf(lines).map((record) => [record.level, record.kind, record.code]);
  assert.deepEqual(
    diagnostics,
    [["warn", "down", "ANDA_UNREACHABLE"]],
    "one failed delivery writes one warn diagnostic that carries the listener's catalogue code",
  );
});

// At-least-once (ANDA-03): a listener that throws has not received the event, so the event stays undelivered. The
// monitor delivers it again on the next tick, and every listener runs again, the one that failed included.
void test("a failed delivery stays undelivered, and the next tick delivers it to every listener again", { timeout: 5000 }, async (t) => {
  const fake = new FakeAnda();
  await fake.start();
  t.after(() => fake.stop());
  const lines: string[] = [];
  const bridge = new AndaBridge({ url: fake.url(), backoff: { baseMs: 5, capMs: 20 }, logger: collectingLogger(lines) });
  t.after(() => bridge.close());

  let failingCalls = 0;
  bridge.subscribe((event) => {
    if (event.kind !== "down") {
      return;
    }
    failingCalls += 1;
    if (failingCalls === 1) {
      throw makeRealmError("ANDA_UNREACHABLE");
    }
  });
  const received: string[] = [];
  let downDeliveries = 0;
  const delivered = new Promise<void>((resolve) => {
    bridge.subscribe((event) => {
      received.push(event.kind);
      if (event.kind === "down") {
        downDeliveries += 1;
        if (downDeliveries === 2) {
          resolve();
        }
      }
    });
  });

  await bridge.connect(5000);
  fake.respond({ kind: "reset" });
  await delivered;

  assert.deepEqual(received, ["down", "down"], "the event is delivered again after the failed delivery");
  assert.equal(failingCalls, 2, "the listener that threw is called again on the redelivery");
  assert.equal(bridge.snapshot()?.kind, "down", "the snapshot reports the undelivered event as the latest one");
  const diagnostics = diagnosticsOf(lines).map((record) => [record.level, record.kind, record.code]);
  assert.deepEqual(diagnostics, [["warn", "down", "ANDA_UNREACHABLE"]], "only the failed call writes a diagnostic");
});

// A reason that is not a RealmError carries no code and no message: the diagnostic records the generic reason
// listener_error, and the listener's own text never reaches the log.
void test("a listener error that is not a RealmError is logged as listener_error, without its message", async (t) => {
  const fake = new FakeAnda();
  await fake.start();
  t.after(() => fake.stop());
  const lines: string[] = [];
  const bridge = new AndaBridge({ url: fake.url(), logger: collectingLogger(lines) });
  t.after(() => bridge.close());

  let thrown = false;
  bridge.subscribe(() => {
    if (!thrown) {
      thrown = true;
      throw new Error("secret detail 10.0.0.7");
    }
  });
  const down = new Promise<void>((resolve) => {
    bridge.subscribe((event) => {
      if (event.kind === "down") {
        resolve();
      }
    });
  });

  await bridge.connect(5000);
  fake.respond({ kind: "reset" });
  await down;

  assert.equal(lines.join("\n").includes("secret detail 10.0.0.7"), false, "the listener's message is never logged");
  const diagnostics = diagnosticsOf(lines).map((record) => [record.level, record.kind, record.reason, record.code ?? null]);
  assert.deepEqual(diagnostics, [["warn", "down", "listener_error", null]]);
});

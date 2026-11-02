import { test } from "node:test";
import assert from "node:assert/strict";
import { AndaBridge } from "../../src/anda/client.js";
import { makeRealmError } from "../../src/core/errors.js";
import { createLogger, type LogSink } from "../../src/observe/logger.js";
import { FakeAnda } from "../support/fake-anda.js";

// A listener that throws must leave a structured diagnostic that names its catalogue code (OBS-02), and the
// listeners after it must still receive the event. A reset from the fake drives one published down event.
void test("a throwing listener is logged with its catalogue code, and the next listener still runs", async (t) => {
  const fake = new FakeAnda();
  await fake.start();
  t.after(() => fake.stop());
  const lines: string[] = [];
  const sink: LogSink = {
    write: (line) => {
      lines.push(line);
      return true;
    },
  };
  const logger = createLogger({ sink, level: "debug", now: () => new Date("2026-11-02T00:00:00.000Z") });
  const bridge = new AndaBridge({ url: fake.url(), logger });
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
  const diagnostics = lines
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .filter((record) => record.event === "anda.listener_failed");
  assert.equal(diagnostics.length, 1, "one failed delivery writes one diagnostic");
  assert.equal(diagnostics[0]?.level, "warn");
  assert.equal(diagnostics[0]?.kind, "down");
  assert.equal(diagnostics[0]?.code, "ANDA_UNREACHABLE", "the diagnostic carries the listener's catalogue code");
});

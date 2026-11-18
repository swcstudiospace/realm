// CAPT-07 (D-32-10): a verified principal rides CallScope into every audit line of the call.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { ErrorCode } from "../../src/core/errors.js";
import { OpenShellRunnerError } from "../../src/runtime/openshell.js";
import type { ToolOutcome } from "../../src/tools/dispatch.js";
import { WORKLOAD, makeHarness, type Harness } from "../support/fake-tools.js";

const PRINCIPAL = { host: "claude", kid: "k2" } as const;

function assertAttributed(h: Harness, lines: number): void {
  const entries = h.auditLines();
  assert.equal(entries.length, lines);
  for (const entry of entries) {
    assert.equal(entry["host"], "claude");
    assert.equal(entry["kid"], "k2");
  }
}

function assertRefusedAs(outcome: ToolOutcome, code: ErrorCode): void {
  assert.equal(outcome.outcome, "refused");
  if (outcome.outcome === "refused") {
    assert.equal(outcome.code, code);
  }
}

void test("CAPT-07: each of the six tools writes host and kid on both of its lines", async (t) => {
  const calls: readonly unknown[] = [
    { read: { path: "doc.txt", maxBytes: 64 } },
    { list: { path: ".", depth: 1 } },
    { write: { path: "doc.txt", content: "x" } },
    { exec: { argv: [...WORKLOAD] } },
    { status: {} },
    { retry: {} },
  ];
  for (const call of calls) {
    const h = makeHarness(t);
    const outcome = await h.dispatcher.call(call, { principal: PRINCIPAL });
    assert.equal(outcome.outcome, "done", JSON.stringify(call));
    assertAttributed(h, 2);
  }
});

void test("CAPT-07: an exec refused after admission still carries host and kid on its result line", async (t) => {
  const h = makeHarness(t);
  h.setRunner(() => Promise.reject(new OpenShellRunnerError("timed-out")));
  const outcome = await h.dispatcher.call({ exec: { argv: [...WORKLOAD] } }, { principal: PRINCIPAL });
  assertRefusedAs(outcome, "TOOL_TIMEOUT");
  assertAttributed(h, 2);
  assert.equal(h.auditLines()[1]?.["outcome"], "TOOL_TIMEOUT");
});

void test("CAPT-07: a call without a principal writes the pre-token line shape", async (t) => {
  const h = makeHarness(t);
  await h.dispatcher.call({ status: {} });
  for (const entry of h.auditLines()) {
    assert.equal("host" in entry, false);
    assert.equal("kid" in entry, false);
  }
});

void test("CAPT-07: a malformed principal is SCHEMA_INVALID and writes nothing", async (t) => {
  const h = makeHarness(t);
  const malformed: readonly unknown[] = [
    { host: "claude", kid: "k2", extra: 1 },
    { host: "claude" },
    { kid: "k2" },
    { host: 7, kid: "k2" },
    { host: "Claude", kid: "k2" },
    { host: "claude", kid: "K2" },
    { host: "claude", kid: "k".repeat(17) },
    null,
    "claude",
    ["claude", "k2"],
  ];
  for (const principal of malformed) {
    const outcome = await h.dispatcher.call({ status: {} }, { principal } as never);
    assertRefusedAs(outcome, "SCHEMA_INVALID");
  }
  assert.equal(h.auditText(), "");
});

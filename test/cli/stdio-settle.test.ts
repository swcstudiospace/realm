import assert from "node:assert/strict";
import { test } from "node:test";
import { makeRealmError, RealmError, type ErrorCode } from "../../src/core/errors.js";
import { isRetryableAttachCode } from "../../src/host/boot.js";
import { describeSettle, exitCodeAfterClose } from "../../src/cli/stdio-settle.js";
import type { BootDriverOutcome } from "../../src/host/boot-driver.js";

const outcomeOf = (kind: BootDriverOutcome["kind"], code?: ErrorCode, daemonAnswered = false): BootDriverOutcome => ({
  kind,
  ...(code === undefined ? {} : { code }),
  status: null,
  retrying: false,
  daemonAnswered,
});

const attachFailure = (error: unknown): string => `attach:${error instanceof RealmError ? error.code : "?"}`;
const failureText = (code: ErrorCode): string => `failure:${code}`;

const settle = (outcome: BootDriverOutcome, options: { refusalCode?: ErrorCode; reattach?: boolean } = {}): ReturnType<typeof describeSettle> => {
  return describeSettle({
    outcome,
    refusal: options.refusalCode === undefined ? null : makeRealmError(options.refusalCode),
    reattach: options.reattach ?? false,
    attachFailure,
    failureText,
  });
};

void test("ready: no diagnostic and a client", () => {
  assert.deepEqual(settle(outcomeOf("ready")), { diagnostic: null, noClient: false });
});

void test("refused: the attach-failure text of the refusal, or of REALM_NOT_ACTIVE when none was kept", () => {
  assert.deepEqual(settle(outcomeOf("refused", "PODMAN_MISSING"), { refusalCode: "PODMAN_MISSING" }), {
    diagnostic: "attach:PODMAN_MISSING",
    noClient: false,
  });
  assert.deepEqual(settle(outcomeOf("refused", "PODMAN_MISSING")), { diagnostic: "attach:REALM_NOT_ACTIVE", noClient: false });
});

void test("failed and the daemon answered: the attach-failure text, serving, exit 0", () => {
  assert.deepEqual(settle(outcomeOf("failed", "SCHEMA_INVALID", true), { refusalCode: "PODMAN_MISSING" }), {
    diagnostic: "attach:PODMAN_MISSING",
    noClient: false,
  });
  assert.deepEqual(settle(outcomeOf("failed", "SCHEMA_INVALID", true)), { diagnostic: "attach:REALM_NOT_ACTIVE", noClient: false });
  assert.deepEqual(settle(outcomeOf("failed", undefined, true)), { diagnostic: "attach:REALM_NOT_ACTIVE", noClient: false });
});

void test("failed, no daemon answered, re-attach off: the failure text and no client", () => {
  assert.deepEqual(settle(outcomeOf("failed", "DAEMON_START_TIMEOUT")), { diagnostic: "failure:DAEMON_START_TIMEOUT", noClient: true });
  assert.deepEqual(settle(outcomeOf("failed")), { diagnostic: "failure:REALM_NOT_ACTIVE", noClient: true });
});

void test("failed, no daemon answered, re-attach on: a retryable code waits silently, a terminal code is the failure text, no code reads as REALM_NOT_ACTIVE", () => {
  assert.deepEqual(settle(outcomeOf("failed", "DAEMON_START_TIMEOUT"), { reattach: true }), { diagnostic: null, noClient: false });
  assert.deepEqual(settle(outcomeOf("failed", "POLICY_DENIED"), { reattach: true }), { diagnostic: "failure:POLICY_DENIED", noClient: true });
  assert.equal(isRetryableAttachCode("REALM_NOT_ACTIVE"), true);
  assert.deepEqual(settle(outcomeOf("failed"), { reattach: true }), { diagnostic: null, noClient: false });
});

void test("the injected functions are the ones used", () => {
  const result = describeSettle({
    outcome: outcomeOf("failed", "POLICY_DENIED"),
    refusal: null,
    reattach: false,
    attachFailure,
    failureText,
  });
  assert.equal(result.diagnostic, "failure:POLICY_DENIED");
});

void test("exitCodeAfterClose: 1 only when no client was adopted and the outcome is still failed", () => {
  assert.equal(exitCodeAfterClose(true, outcomeOf("failed", "DAEMON_START_TIMEOUT")), 1);
  assert.equal(exitCodeAfterClose(true, outcomeOf("ready")), 0, "a retry that linked");
  assert.equal(exitCodeAfterClose(true, outcomeOf("refused", "PODMAN_MISSING")), 0);
  for (const kind of ["ready", "refused", "failed"] as const) {
    assert.equal(exitCodeAfterClose(false, outcomeOf(kind)), 0);
  }
});

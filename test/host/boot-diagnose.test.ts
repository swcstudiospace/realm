// Unit tests for the boot-binding diagnosis (T8580, BOOTF-01..BOOTF-08; blueprint §23; API-RealmBoot 1.0.0).
// Pure: every probe result is supplied, so these tests prove the order and the naming, not the seams.
// Each test pins 1 acceptance criterion (AC-114..AC-120) or 1 BOOTF requirement.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  bindingRows,
  capabilityRefusal,
  confirmActiveProof,
  diagnoseBoot,
  digestPrefix,
  guardLifted,
  planShutdown,
  secretFree,
  type ActiveProofInput,
  type BindingProbes,
} from "../../src/host/boot-diagnose.js";

const CORR = "corr-boot-diag";
const DIGEST = "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const REF = "sandbox@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

function passingProbes(): BindingProbes {
  return {
    configSelected: true,
    workspaceRootOk: true,
    daemonOk: true,
    driverOk: true,
    imageOk: true,
    imageRef: REF,
    expectedDigest: DIGEST,
  };
}

function confirmingProof(): ActiveProofInput {
  return {
    containerId: "realm-s1",
    readback: { containerId: "realm-s1", sessionId: "s1", boundRoot: "/ws" },
    expectedSessionId: "s1",
    expectedBoundRoot: "/ws",
  };
}

// AC-114 (BOOTF-05): all 4 bindings verified + up 1 container id + 1 validating readback -> active.
void test("AC-114: all bindings pass and the readback validates -> active with container id", () => {
  const result = diagnoseBoot(passingProbes(), CORR, confirmingProof());
  if (result.active) {
    assert.equal(result.containerId, "realm-s1");
    assert.equal(result.guardLifted, true);
    assert.equal(result.correlationId, CORR);
  } else {
    assert.fail("expected an active envelope");
  }
});

// BOOTF-05: up alone never counts as active; a readback naming another session or root is not adopted.
void test("BOOTF-05: up alone, or a mismatched readback, never confirms active", () => {
  assert.equal(confirmActiveProof({ containerId: "realm-s1", readback: null, expectedSessionId: "s1", expectedBoundRoot: "/ws" }), false);
  assert.equal(
    confirmActiveProof({
      containerId: "realm-s1",
      readback: { containerId: "realm-s1", sessionId: "other", boundRoot: "/ws" },
      expectedSessionId: "s1",
      expectedBoundRoot: "/ws",
    }),
    false,
  );
  assert.equal(
    confirmActiveProof({
      containerId: "realm-s1",
      readback: { containerId: "realm-s1", sessionId: "s1", boundRoot: "/elsewhere" },
      expectedSessionId: "s1",
      expectedBoundRoot: "/ws",
    }),
    false,
  );
  const unconfirmed = diagnoseBoot(passingProbes(), CORR, { containerId: "realm-s1", readback: null, expectedSessionId: "s1", expectedBoundRoot: "/ws" });
  if (!unconfirmed.active) {
    assert.equal(unconfirmed.code, "REALM_NOT_ACTIVE");
  } else {
    assert.fail("expected the unconfirmed envelope");
  }
  assert.equal(guardLifted({ containerId: null, readback: null, expectedSessionId: "s1", expectedBoundRoot: "/ws" }), false);
});

// AC-115 (BOOTF-01..04): 1 missing item -> exit-1 failure naming 1 catalogue code, 0 containers.
void test("AC-115: config binding fails first with AGENTOS_NOT_CONFIGURED", () => {
  const result = diagnoseBoot({ ...passingProbes(), configSelected: false }, CORR);
  if (!result.active) {
    assert.equal(result.code, "AGENTOS_NOT_CONFIGURED");
    assert.equal(result.binding, "config");
    assert.ok(result.remedy.length > 0);
    assert.equal(secretFree(result.remedy), true);
  } else {
    assert.fail("expected the config failure envelope");
  }
});
void test("AC-115: missing workspace root fails config binding with POLICY_DENIED", () => {
  const result = diagnoseBoot({ ...passingProbes(), workspaceRootOk: false }, CORR);
  if (!result.active) {
    assert.equal(result.code, "POLICY_DENIED");
    assert.equal(result.binding, "config");
    assert.equal(secretFree(result.remedy), true);
  } else {
    assert.fail("expected the config failure envelope");
  }
});
void test("AC-115/BOOTF-01: daemon binding fails with DAEMON_START_TIMEOUT", () => {
  const result = diagnoseBoot({ ...passingProbes(), daemonOk: false }, CORR);
  if (!result.active) {
    assert.equal(result.code, "DAEMON_START_TIMEOUT");
    assert.equal(result.binding, "daemon");
  } else {
    assert.fail("expected the daemon failure envelope");
  }
  // First failure decides: config passes, driver/image not probed.
  const rows = bindingRows({ ...passingProbes(), daemonOk: false });
  assert.deepEqual(
    rows.map((row) => `${row.binding}:${row.verdict}`),
    ["config:pass", "daemon:fail", "driver:not probed", "image:not probed"],
  );
});
// AC-116 (BOOTF-02): driver failure names OPENSHELL_GATEWAY_LOST or OPENSHELL_START_FAILED, never POLICY_DENIED.
void test("AC-116: failed driver start names OPENSHELL_START_FAILED with the failed step", () => {
  const result = diagnoseBoot({ ...passingProbes(), driverOk: false, driverFailedStep: "start" }, CORR);
  if (!result.active) {
    assert.equal(result.code, "OPENSHELL_START_FAILED");
    assert.equal(result.binding, "driver");
    assert.equal(result.failedStep, "start");
    assert.notEqual(result.code, "POLICY_DENIED");
  } else {
    assert.fail("expected the driver failure envelope");
  }
});
void test("AC-116: gateway lost after active names OPENSHELL_GATEWAY_LOST", () => {
  const result = diagnoseBoot({ ...passingProbes(), driverOk: false, driverLostAfterActive: true, driverFailedStep: "exec-child start" }, CORR);
  if (!result.active) {
    assert.equal(result.code, "OPENSHELL_GATEWAY_LOST");
    assert.equal(result.binding, "driver");
    assert.equal(result.failedStep, "exec-child start");
  } else {
    assert.fail("expected the gateway-lost envelope");
  }
});
// BOOTF-03 / AC-115: image mismatch names POLICY_DENIED with the ref and the digest prefix only.
void test("BOOTF-03: image mismatch names POLICY_DENIED with ref + digest prefix", () => {
  const result = diagnoseBoot({ ...passingProbes(), imageOk: false }, CORR);
  if (!result.active) {
    assert.equal(result.code, "POLICY_DENIED");
    assert.equal(result.binding, "image");
    assert.ok(result.remedy.includes("sha256:0123456789ab"));
    // QF-001: REF embeds the full digest, so the remedy must carry the sanitized ref (prefix only), never REF/DIGEST.
    assert.ok(result.remedy.includes("sandbox@sha256:0123456789ab…"));
    assert.equal(result.remedy.includes(REF), false);
    assert.equal(result.remedy.includes(DIGEST), false);
    assert.equal(secretFree(result.remedy), true);
  } else {
    assert.fail("expected the image failure envelope");
  }
  const rows = bindingRows({ ...passingProbes(), imageOk: false });
  assert.deepEqual(
    rows.map((row) => `${row.binding}:${row.verdict}`),
    ["config:pass", "daemon:pass", "driver:pass", "image:fail"],
  );
  assert.equal(rows[3]?.digestPrefix, "sha256:0123456789ab…");
});

void test("digestPrefix: only well-formed digests get a prefix, malformed ones name nothing", () => {
  assert.equal(digestPrefix(DIGEST), "sha256:0123456789ab…");
  assert.equal(digestPrefix("sha256:short"), null);
  assert.equal(digestPrefix("not-a-digest"), null);
});

// BOOTF ordering: the first failing binding decides; later bindings are never probed, never pass.
void test("BOOTF-01..04: binding order is config -> daemon -> driver -> image, first failure wins", () => {
  const rows = bindingRows({ ...passingProbes(), configSelected: false, daemonOk: false, driverOk: false, imageOk: false });
  assert.deepEqual(
    rows.map((row) => row.binding),
    ["config", "daemon", "driver", "image"],
  );
  assert.deepEqual(
    rows.map((row) => row.verdict),
    ["fail", "not probed", "not probed", "not probed"],
  );
  assert.deepEqual(
    bindingRows(passingProbes()).map((row) => row.verdict),
    ["pass", "pass", "pass", "pass"],
  );
});

// AC-117 (D4): while inactive, the guard refuses; the guard lifts only with a confirming readback.
void test("AC-117: the guard stays fail-closed until the readback confirms active", () => {
  const failing = diagnoseBoot({ ...passingProbes(), daemonOk: false }, CORR, confirmingProof());
  assert.equal(failing.active, false);
  assert.equal(guardLifted(confirmingProof()), true);
  assert.equal(guardLifted({ containerId: "realm-s1", readback: null, expectedSessionId: "s1", expectedBoundRoot: "/ws" }), false);
});

// AC-119 (BOOTF-08): shutdown closes the client, removes the marker, never sends the stop call.
void test("AC-119: shutdown closes client + removes marker, never sends the stop call", () => {
  const plan = planShutdown();
  assert.deepEqual(plan, { closeClient: true, removeMarker: true, sendDown: false });
  assert.equal(plan.sendDown, false);
});

// AC-120 (BOOTF-06): a capability-token refusal names mode + key id with 0 token values.
void test("AC-120: capability refusal names mode enforce and 1 key id, 0 token values", () => {
  const text = capabilityRefusal("enforce", "key-7");
  assert.ok(text.includes("enforce"));
  assert.ok(text.includes("key-7"));
  assert.equal(secretFree(text), true);
  assert.equal(/token\s*[=:]/.test(text), false);
});

void test("secretFree: a token assignment is not secret-free; a digest prefix is", () => {
  assert.equal(secretFree("token=abc123"), false);
  assert.equal(secretFree("sha256:0123456789ab…"), true);
});

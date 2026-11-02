// Aggregate admission ledger tests (Phase 18, MULTI-06, C7). The ledger is synchronous and performs no I/O: the recorded ids are an
// injected list, so every case runs in-process with no store, socket or driver.

import { test } from "node:test";
import assert from "node:assert/strict";
import { RealmError } from "../../src/core/errors.js";
import { AdmissionLedger } from "../../src/daemon/admission.js";

function ledgerOf(maxSessions: number, recorded: readonly string[] = []): AdmissionLedger {
  return new AdmissionLedger({ maxSessions, recordedIds: () => recorded });
}

function refusedWith(code: string): (error: unknown) => boolean {
  return (error: unknown): boolean => error instanceof RealmError && error.code === code;
}

void test("a third distinct reservation in one synchronous turn is refused with POLICY_DENIED and the count stays 2 (MULTI-06)", () => {
  const ledger = ledgerOf(2);
  ledger.reserve("p-a");
  ledger.reserve("p-b");
  assert.throws(() => ledger.reserve("p-c"), refusedWith("POLICY_DENIED"));
  assert.equal(ledger.committedCount(), 2);
  assert.equal(ledger.isCommitted("p-c"), false);
});

void test("reserve is synchronous: it returns undefined, never a promise (MULTI-06)", () => {
  const ledger = ledgerOf(2);
  assert.equal(ledger.reserve("p-a"), undefined);
  assert.equal(ledger.committedCount(), 1);
});

void test("reserving an id already reserved returns without increasing the count (MULTI-06)", () => {
  const ledger = ledgerOf(2);
  ledger.reserve("p-a");
  ledger.reserve("p-a");
  assert.equal(ledger.committedCount(), 1);
  ledger.reserve("p-b");
  assert.equal(ledger.committedCount(), 2);
});

void test("a recorded id counts once, and a reservation of the same id does not take a second slot (MULTI-06)", () => {
  const ledger = ledgerOf(2, ["p-a", "p-a"]);
  assert.equal(ledger.committedCount(), 1);
  ledger.reserve("p-a");
  assert.equal(ledger.committedCount(), 1);
  ledger.reserve("p-b");
  assert.equal(ledger.committedCount(), 2);
  assert.throws(() => ledger.reserve("p-c"), refusedWith("POLICY_DENIED"));
});

void test("the recorded ids are read at every call, so a record written after construction is counted (MULTI-06)", () => {
  const recorded: string[] = [];
  const ledger = new AdmissionLedger({ maxSessions: 2, recordedIds: () => recorded });
  recorded.push("p-x");
  ledger.reserve("p-a");
  assert.equal(ledger.committedCount(), 2);
  assert.throws(() => ledger.reserve("p-b"), refusedWith("POLICY_DENIED"));
});

void test("a failed removal keeps the id committed and the slot held (MULTI-06)", () => {
  const ledger = ledgerOf(2);
  ledger.reserve("p-a");
  ledger.reserve("p-b");
  ledger.markUnproven("p-a");
  assert.equal(ledger.isCommitted("p-a"), true);
  assert.equal(ledger.committedCount(), 2);
  assert.throws(() => ledger.reserve("p-c"), refusedWith("POLICY_DENIED"));
});

void test("release after markUnproven frees the slot and a new reservation succeeds (MULTI-06)", () => {
  const ledger = ledgerOf(2);
  ledger.reserve("p-a");
  ledger.reserve("p-b");
  ledger.markUnproven("p-a");
  ledger.release("p-a");
  assert.equal(ledger.isCommitted("p-a"), false);
  assert.equal(ledger.committedCount(), 1);
  ledger.reserve("p-c");
  assert.equal(ledger.committedCount(), 2);
});

void test("markUnproven on an id already unproven is a no-op: one release frees the slot (MULTI-06, W7)", () => {
  const ledger = ledgerOf(2);
  ledger.reserve("p-a");
  ledger.markUnproven("p-a");
  ledger.markUnproven("p-a");
  assert.equal(ledger.committedCount(), 1);
  ledger.reserve("p-b");
  assert.throws(() => ledger.reserve("p-c"), refusedWith("POLICY_DENIED"));
  ledger.release("p-a");
  assert.equal(ledger.committedCount(), 1);
  ledger.reserve("p-c");
  assert.equal(ledger.committedCount(), 2);
});

void test("release of a reservation with no container created frees the slot (MULTI-06)", () => {
  const ledger = ledgerOf(1);
  ledger.reserve("p-a");
  ledger.release("p-a");
  assert.equal(ledger.committedCount(), 0);
  ledger.reserve("p-b");
  assert.equal(ledger.isCommitted("p-b"), true);
});

void test("isCommitted reports recorded, reserved and unproven ids and no others (MULTI-06)", () => {
  const ledger = ledgerOf(3, ["p-rec"]);
  ledger.reserve("p-res");
  ledger.reserve("p-unp");
  ledger.markUnproven("p-unp");
  assert.equal(ledger.isCommitted("p-rec"), true);
  assert.equal(ledger.isCommitted("p-res"), true);
  assert.equal(ledger.isCommitted("p-unp"), true);
  assert.equal(ledger.isCommitted("p-none"), false);
  assert.equal(ledger.committedCount(), 3);
});

void test("a maxSessions that is not a positive integer throws SCHEMA_INVALID, and 1 is accepted (MULTI-06)", () => {
  for (const maxSessions of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => ledgerOf(maxSessions), refusedWith("SCHEMA_INVALID"));
  }
  assert.doesNotThrow(() => ledgerOf(1));
});

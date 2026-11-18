// CAPT-07 (D-32-10): the audit chain covers the host and kid fields, and the reconciler ignores capability lines.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { appendAudit } from "../../src/audit/log.js";
import { checkAuditFile, verifyAuditFile } from "../../src/audit/chain.js";
import { reconcileAuditLogs } from "../../src/audit/reconcile.js";
import { SESSION, makeHarness, WORKLOAD } from "../support/fake-tools.js";

const PRINCIPAL = { host: "cursor", kid: "k1" } as const;

function lineHash(line: string): string {
  return createHash("sha256").update(line, "utf8").digest("hex");
}

void test("CAPT-07: editing the host recorded on a past line breaks the chain at the next line, and a head pin taken before the edit rejects the file", async (t) => {
  const h = makeHarness(t);
  const file = join(h.stateDir, "audit", `${SESSION}.jsonl`);
  await h.dispatcher.call({ read: { path: "doc.txt", maxBytes: 64 } }, { principal: PRINCIPAL });
  await h.dispatcher.call({ exec: { argv: [...WORKLOAD] } }, { principal: PRINCIPAL });
  assert.equal(verifyAuditFile(file).ok, true, "the chain verifies as written");
  const original = readFileSync(file, "utf8").slice(0, -1).split("\n");
  assert.equal(original.length, 4);
  for (const line of original) {
    const entry = JSON.parse(line) as Record<string, unknown>;
    assert.equal(entry["host"], "cursor");
    assert.equal(entry["kid"], "k1");
  }
  const pin = `4:${lineHash(original[3] ?? "")}`;
  assert.equal(checkAuditFile(file, { head: pin }).ok, true);

  const edited = [...original];
  const second = JSON.parse(edited[1] ?? "") as Record<string, unknown>;
  second["host"] = "claude";
  edited[1] = JSON.stringify(second);
  writeFileSync(file, `${edited.join("\n")}\n`);
  const broken = verifyAuditFile(file);
  assert.equal(broken.ok, false);
  assert.equal(broken.broken?.line, 3, "the break is named at the successor of the edited line");
  assert.equal(broken.broken.reason, "prev-mismatch");
  assert.equal(checkAuditFile(file, { head: pin }).ok, false, "a head pin taken before the edit rejects the edited file");
});

void test("CAPT-07: the reconciler ignores a capability.attach line and a refusal line with no phase, and still reports an admission with no result", (t) => {
  const h = makeHarness(t);
  appendAudit(h.stateDir, { sessionId: SESSION, tool: "capability.attach", outcome: "ok", ...PRINCIPAL });
  appendAudit(h.stateDir, { sessionId: SESSION, tool: "write", outcome: "POLICY_DENIED", ...PRINCIPAL });
  appendAudit(h.stateDir, { sessionId: SESSION, tool: "unknown", outcome: "POLICY_DENIED" });
  const quiet = reconcileAuditLogs(h.stateDir);
  assert.equal(quiet.appended, 0, "capability lines are not unfinished calls");
  assert.equal(quiet.failed, 0);

  appendAudit(h.stateDir, { sessionId: SESSION, tool: "write", outcome: "ok", phase: "admission", path: "a.txt", ...PRINCIPAL });
  const loud = reconcileAuditLogs(h.stateDir);
  assert.equal(loud.appended, 1, "an admission with no result is still reconciled");
  const lines = h.auditLines();
  const reconciliation = lines[lines.length - 1];
  assert.equal(reconciliation?.["phase"], "reconciliation");
});

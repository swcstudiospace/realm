import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CONTINUES_LINE,
  MATRIX_VERIFIED_LINE,
  WARNING_LINE,
  renderAdvisory,
  renderAdvisoryResponse,
  renderFreshPlanLine,
  renderMatrixVerifiedLine,
  renderPollingLine,
  renderRestoreFailedLine,
  renderRestoringLine,
  renderResumeLine,
  renderStateFailure,
  type AdvisoryPlanState,
  type AdvisoryResponse,
} from "../../src/omp/advisory-render.js";

const INCOMPLETE: AdvisoryPlanState = Object.freeze({
  graphId: "ut-9f2c1",
  doneRows: 32,
  totalRows: 48,
  pendingRows: 16,
  unblockingAction: "complete 16 rows at the tracker, then reload",
  renderCount: 1,
});

const COMPLETE: AdvisoryPlanState = Object.freeze({
  graphId: "ut-9f2c1",
  doneRows: 48,
  totalRows: 48,
  pendingRows: 0,
  unblockingAction: "complete 16 rows at the tracker, then reload",
  renderCount: 1,
});

// AC-71 banned blocking strings: the host render must contain 0 of them.
const BANNED = ["STOP", "proceed", "confirm"];
function assertNoBanned(lines: string[]): void {
  for (const line of lines) {
    const lower = line.toLowerCase();
    for (const token of BANNED) {
      assert.equal(lower.includes(token.toLowerCase()), false, `banned string ${token} in: ${line}`);
    }
  }
}

void test("complete plan stays silent live and after reload (AC-78)", () => {
  // 2 renders, 0 advisories: the absence of the component, not a blank line.
  assert.equal(renderAdvisory(COMPLETE), null);
  assert.equal(renderAdvisory({ ...COMPLETE, renderCount: 2 }), null);
});

void test("incomplete advisory renders exactly once naming graph, rows, action (AC-79)", () => {
  const lines = renderAdvisory(INCOMPLETE);
  assert.ok(lines !== null);
  assert.equal(lines.length, 3);
  assert.equal(lines[0], "Plan tracker (graph ut-9f2c1): 32/48 rows set — 16 pending.");
  assert.equal(lines[1], "Unblocking action: complete 16 rows at the tracker, then reload.");
  assert.equal(lines[2], CONTINUES_LINE);
  assertNoBanned(lines);
});

void test("unchanged state adds no second prompt on the next poll (AC-80)", () => {
  const first = renderAdvisory(INCOMPLETE);
  assert.ok(first !== null && first.length === 3);
  // A second poll over unchanged state repaints nothing: prompt count stays at 1.
  assert.equal(renderAdvisory({ ...INCOMPLETE, renderCount: 2 }), null);
});

void test("malformed or missing plan state renders 1 named failure (AC-81)", () => {
  const line = renderStateFailure({ code: "PLAN_STATE_MISSING", detail: "plan file missing at tracker" });
  assert.equal(
    line,
    "Plan state unreadable — PLAN_STATE_MISSING: plan file missing at tracker; planning continues from the last known good snapshot.",
  );
  assertNoBanned([line]);
});

void test("contract AdvisoryResponse 1.1.0 fields bind to the same render", () => {
  const response: AdvisoryResponse = {
    note: "Plan tracker: 32/48 rows set",
    pendingRows: 16,
    continues: true,
    warningLines: 1,
    correlationId: "corr-1",
    graphId: "ut-9f2c1",
    unblockingAction: "complete 16 rows at the tracker, then reload",
    renderCount: 1,
  };
  const lines = renderAdvisoryResponse(response, INCOMPLETE);
  assert.ok(lines !== null);
  assert.equal(lines.length, 3);
  assert.equal(lines[0], "Plan tracker (graph ut-9f2c1): 32/48 rows set — 16 pending.");
  assert.equal(WARNING_LINE, "Warning: incomplete-verdict refresh pending.");
});

void test("contract failure object renders the named failure, never a silent drop", () => {
  const response: AdvisoryResponse = {
    note: "",
    pendingRows: 0,
    continues: true,
    warningLines: 0,
    correlationId: "corr-2",
    failure: { code: "PLAN_STATE_MALFORMED", detail: "tracker JSON did not parse" },
  };
  const lines = renderAdvisoryResponse(response, COMPLETE);
  assert.deepEqual(lines, [
    "Plan state unreadable — PLAN_STATE_MALFORMED: tracker JSON did not parse; planning continues from the last known good snapshot.",
  ]);
});

void test("polling and restoring lines never block the composer (loading states)", () => {
  const polling = renderPollingLine(120);
  assert.match(polling, /^Reading plan state… \(120 ms elapsed\)$/);
  const restoring = renderRestoringLine(45);
  assert.match(restoring, /^Restoring settled answers… \(45 ms elapsed\)$/);
  assertNoBanned([polling, restoring]);
});

void test("reload resume line states restored answers and step (AC-68, AC-69)", () => {
  const lines = renderResumeLine(3, 3, 1, 48);
  assert.deepEqual(lines, [
    "Session restored — 3 of 3 settled answers active.",
    "Work resumes at recorded step 1 of 48.",
  ]);
  assertNoBanned(lines);
});

void test("fresh plan and restore failure are stated, never blank (empty/error states)", () => {
  assert.equal(renderFreshPlanLine(), "No settled answers on file — plan starts fresh.");
  const failed = renderRestoreFailedLine("record unreadable");
  assert.equal(
    failed,
    "Session restore incomplete — settled answers unavailable (record unreadable); planning starts from scratch.",
  );
  assertNoBanned([failed, renderFreshPlanLine()]);
});

void test("matrix log line records 4 of 4 verification (success.verified)", () => {
  assert.equal(renderMatrixVerifiedLine(), MATRIX_VERIFIED_LINE);
  assert.match(MATRIX_VERIFIED_LINE, /^4 of 4 cases verified /);
});

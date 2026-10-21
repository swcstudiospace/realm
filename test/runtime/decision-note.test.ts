import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// This file runs from dist/test/runtime, so three levels up is the package root.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const NOTE_PATH = join(ROOT, "docs", "integration", "runtime-decision.md");

function readNote(): string {
  return readFileSync(NOTE_PATH, "utf8");
}

interface OpenQuestionRow {
  readonly id: string;
  readonly defaultApplied: string;
  readonly status: string;
}

// The OQ table rows: | ID | Question | Default applied | Blocked module or phase | Status |.
function openQuestionRowsFor(text: string, prefix: string): readonly OpenQuestionRow[] {
  const rows: OpenQuestionRow[] = [];
  const start = new RegExp(`^\\| ${prefix}-\\d{2} \\|`);
  for (const line of text.split("\n")) {
    if (!start.test(line)) {
      continue;
    }
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());
    rows.push({ id: cells[0] ?? "", defaultApplied: cells[2] ?? "", status: cells[4] ?? "" });
  }
  return rows;
}

function openQuestionRows(text: string): readonly OpenQuestionRow[] {
  return openQuestionRowsFor(text, "OQ-P3");
}

function openQuestionRowsP4(text: string): readonly OpenQuestionRow[] {
  return openQuestionRowsFor(text, "OQ-P4");
}

function rowOf(rows: readonly OpenQuestionRow[], id: string): OpenQuestionRow {
  const row = rows.find((candidate) => candidate.id === id);
  assert.ok(row, `${id} has no row in the OQ-P3 table`);
  return row;
}

test("OQ-P3-01 to OQ-P3-16: the table has one row per item, in order, and each row has a non-empty default applied", () => {
  const rows = openQuestionRows(readNote());
  const expected = Array.from({ length: 16 }, (_, index) => `OQ-P3-${String(index + 1).padStart(2, "0")}`);
  assert.deepEqual(
    rows.map((row) => row.id),
    expected,
  );
  for (const row of rows) {
    assert.notEqual(row.defaultApplied, "", `${row.id} has no default applied`);
  }
});

test("OQ-P3-05 and OQ-P3-06: the decision note records both as Blocked", () => {
  const rows = openQuestionRows(readNote());
  assert.match(rowOf(rows, "OQ-P3-05").status, /^Blocked/);
  assert.match(rowOf(rows, "OQ-P3-06").status, /^Blocked/);
});

test("OQ-P3-04, OQ-P3-07 and OQ-P3-16: the table and the status line name them as Open or Blocked, never as verified", () => {
  const text = readNote();
  const rows = openQuestionRows(text);
  assert.match(rowOf(rows, "OQ-P3-04").status, /^Open/);
  assert.match(rowOf(rows, "OQ-P3-07").status, /^Open/);
  assert.match(rowOf(rows, "OQ-P3-16").status, /^Blocked/);
  const status = text.split("\n").find((line) => line.startsWith("Status:")) ?? "";
  assert.match(status, /OQ-P3-04 and OQ-P3-07 are Open/, "the status line must name the Open items");
  assert.match(status, /OQ-P3-16 is Blocked/, "the status line must name the Blocked item");
});

test("RT-01, RT-03: the decision note records that S-08 supersedes the RT-01 and RT-03 wording (D-46, D-47)", () => {
  const text = readNote();
  assert.match(
    text,
    /RT-01 and RT-03 wording that places the OpenShell gateway inside the Realm container is superseded by S-08 \(D-46, D-47\)/,
  );
});

test("Phase 4: the decision note carries a Phase 4 section recording the OQ-P3-16 resolution with the v0.1.2 URL and read date (D-82, D-100)", () => {
  const text = readNote();
  assert.match(text, /## Phase 4: Reaper, Egress Guard, and Shared Dispatcher \(D-100\)/);
  assert.match(text, /OQ-P3-16 is resolved for the fields Realm writes/);
  assert.match(text, /https:\/\/docs\.nvidia\.com\/openshell\/v0\.1\.2\/how-it-works\/policies\/schema\.md/);
  assert.match(text, /read 2026-10-21/);
});

test("Phase 4: the decision note records the exec verb pin with its --help evidence (D-93)", () => {
  const text = readNote();
  assert.match(text, /openshell sandbox exec/);
  assert.match(text, /read-only `--help` check, 2026-10-21/);
  assert.match(text, /--workdir \/workspace --no-tty --no-login-shell/);
});

test("Phase 4: the decision note records the IPv6 partial status (D-76)", () => {
  const text = readNote();
  assert.match(text, /partially unit-verified/);
  assert.match(text, /NetworkMode: none/);
});

test("Phase 4: the decision note records the single-owner precondition with the OQ-P4-06 residual risk (D-87)", () => {
  const text = readNote();
  assert.match(text, /must run before any `LifecycleController` or `ToolDispatcher` exists/);
  assert.match(text, /accepted residual risk \(OQ-P4-06\)/);
});

test("Phase 4: the decision note records the two-lines-per-call audit note for the Phase 7 reader (D-90)", () => {
  const text = readNote();
  assert.match(text, /Phase 7 review must read both lines of one call as one call/);
});

test("OQ-P4-01 to OQ-P4-12: the table has one row per item, in order, and each row has a non-empty default applied", () => {
  const rows = openQuestionRowsP4(readNote());
  const expected = Array.from({ length: 12 }, (_, index) => `OQ-P4-${String(index + 1).padStart(2, "0")}`);
  assert.deepEqual(
    rows.map((row) => row.id),
    expected,
  );
  for (const row of rows) {
    assert.notEqual(row.defaultApplied, "", `${row.id} has no default applied`);
  }
});

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

// The OQ-P3 table rows: | ID | Question | Default applied | Blocked module or phase | Status |.
function openQuestionRows(text: string): readonly OpenQuestionRow[] {
  const rows: OpenQuestionRow[] = [];
  for (const line of text.split("\n")) {
    if (!/^\| OQ-P3-\d{2} \|/.test(line)) {
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

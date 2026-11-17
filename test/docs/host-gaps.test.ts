// TEST-HOST-08 (D-26-09): docs/integration/host-plugin-gaps.md is the tracked table of the unverified behavior, accepted residuals, owner
// decisions and inferences of Phases 21 to 26. This test holds its shape (ids, classes, statuses), that each source names a planning file that
// exists (skipped with a named diagnostic when the planning tree is archived), that a row marked closed or narrowed cites a repository path
// that exists, that every numbered behavior_unverified item of the Phase 21 to 25 verification files has a row, and that a closed GAP-21-04
// goes with a non-zero src/host coverage floor. Reads files only: nothing is written and no process starts.

import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// The repository root, found the way manifest.test.ts finds package.json: from the compiled test file, three directories up.
const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const PAGE = join(REPO_ROOT, "docs", "integration", "host-plugin-gaps.md");
const PHASES_DIR = join(REPO_ROOT, ".planning", "phases");
const FLOORS = join(REPO_ROOT, "scripts", "check", "coverage-floors.json");

const CLASSES: readonly string[] = ["unverified-behavior", "accepted-residual", "owner-decision", "inference"];
const STATUSES: readonly string[] = ["open", "narrowed", "closed", "accepted"];

// The 32 rows of 26-CONTEXT "The gap rows"; the page may hold more (rows reconciled with Phase 25's verification record).
const CONTEXT_IDS: readonly string[] = [
  "GAP-21-01", "GAP-21-02", "GAP-21-03", "GAP-21-04", "GAP-21-05",
  "GAP-22-01", "GAP-22-02", "GAP-22-03", "GAP-22-04",
  "GAP-23-01", "GAP-23-02", "GAP-23-03", "GAP-23-04", "GAP-23-05", "GAP-23-06", "GAP-23-07", "GAP-23-08", "GAP-23-09",
  "GAP-24-01", "GAP-24-02", "GAP-24-03", "GAP-24-04", "GAP-24-05", "GAP-24-06",
  "GAP-25-01", "GAP-25-02", "GAP-25-03", "GAP-25-04", "GAP-25-05", "GAP-25-06",
  "GAP-26-01", "GAP-26-02",
];

interface GapRow {
  readonly id: string;
  readonly source: string;
  readonly gap: string;
  readonly kind: string;
  readonly status: string;
  readonly evidence: string;
  readonly next: string;
}

function parseRows(text: string): GapRow[] {
  const rows: GapRow[] = [];
  for (const line of text.split("\n")) {
    if (!line.startsWith("| GAP-")) {
      continue;
    }
    const cells = line.slice(1, line.lastIndexOf("|")).split("|").map((cell) => cell.trim());
    assert.equal(cells.length, 7, `the row has seven cells: ${line.slice(0, 60)}`);
    const [id = "", source = "", gap = "", kind = "", status = "", evidence = "", next = ""] = cells;
    rows.push({ id, source, gap, kind, status, evidence, next });
  }
  return rows;
}

const ROWS = parseRows(readFileSync(PAGE, "utf8"));

// A planning source: "NN-VERIFICATION" or "NN-CONTEXT", or the words "this phase" for the context of Phase 26.
function citedFiles(source: string): { readonly phase: string; readonly kind: string }[] {
  if (source === "this phase") {
    return [{ phase: "26", kind: "CONTEXT" }];
  }
  return [...source.matchAll(/(\d{2})-(VERIFICATION|CONTEXT)/g)].map((match) => ({ phase: match[1] ?? "", kind: match[2] ?? "" }));
}

// The planning file of a phase, or null when the planning tree or the phase directory is absent.
function planningFile(phase: string, kind: string): { readonly file: string | null; readonly archived: boolean } {
  if (!existsSync(PHASES_DIR)) {
    return { file: null, archived: true };
  }
  const directory = readdirSync(PHASES_DIR).find((name) => name.startsWith(`${phase}-`));
  if (directory === undefined) {
    return { file: null, archived: true };
  }
  const file = join(PHASES_DIR, directory, `${phase}-${kind}.md`);
  return { file: existsSync(file) ? file : "", archived: false };
}

function skipDiagnostic(t: TestContext, phase: string): void {
  t.diagnostic(`planning tree archived: source check skipped for ${phase}`);
}

const REPO_PATH = /^(?:src|test|docs|scripts|adapters|\.github)\/\S*$/;

void test("TEST-HOST-08: the table has seven non-empty cells per row, well formed unique ids and the 32 rows of the context", () => {
  assert.ok(ROWS.length >= CONTEXT_IDS.length, `at least ${String(CONTEXT_IDS.length)} rows, found ${String(ROWS.length)}`);
  const seen = new Set<string>();
  for (const row of ROWS) {
    for (const [name, value] of Object.entries(row)) {
      assert.ok(value !== "", `${row.id}: the ${name} cell is not empty`);
    }
    const match = /^GAP-(\d{2})-(\d{2})$/.exec(row.id);
    assert.ok(match !== null, `${row.id}: the id is GAP, a two-digit phase and a two-digit number`);
    const phase = Number(match[1]);
    assert.ok(phase >= 21 && phase <= 26, `${row.id}: the phase is 21 to 26`);
    assert.ok(!seen.has(row.id), `${row.id}: the id is unique`);
    seen.add(row.id);
  }
  assert.deepEqual(
    CONTEXT_IDS.filter((id) => !seen.has(id)),
    [],
    "every row of the context is on the page",
  );
});

void test("TEST-HOST-08: every class and every status is one of the closed lists", () => {
  for (const row of ROWS) {
    assert.ok(CLASSES.includes(row.kind), `${row.id}: class ${row.kind} is one of ${CLASSES.join(", ")}`);
    assert.ok(STATUSES.includes(row.status), `${row.id}: status ${row.status} is one of ${STATUSES.join(", ")}`);
  }
});

void test("TEST-HOST-08: every source cites a planning file that exists", (t) => {
  for (const row of ROWS) {
    const cited = citedFiles(row.source);
    assert.ok(cited.length > 0, `${row.id}: the source cites a phase verification or context file`);
    for (const { phase, kind } of cited) {
      const found = planningFile(phase, kind);
      if (found.archived) {
        skipDiagnostic(t, phase);
        continue;
      }
      assert.ok(found.file !== "", `${row.id}: ${phase}-${kind}.md exists in the phase ${phase} directory`);
    }
  }
});

void test("TEST-HOST-08: every closed or narrowed row cites a repository path that exists", () => {
  for (const row of ROWS) {
    if (row.status !== "closed" && row.status !== "narrowed") {
      continue;
    }
    const paths = [...row.evidence.matchAll(/`([^`\n]+)`/g)].map((match) => match[1] ?? "").filter((span) => REPO_PATH.test(span) && !span.includes("*"));
    assert.ok(paths.length > 0, `${row.id}: a ${row.status} row cites at least one repository path in its evidence`);
    for (const path of paths) {
      assert.ok(existsSync(join(REPO_ROOT, path)), `${row.id}: ${path} exists`);
    }
  }
});

// The numbered items under the behavior_unverified heading of a verification file.
function unverifiedCount(file: string): number {
  const lines = readFileSync(file, "utf8").split("\n");
  const start = lines.findIndex((line) => line.startsWith("## ") && line.includes("behavior_unverified"));
  assert.ok(start !== -1, `${file} has a behavior_unverified heading`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith("## "));
  return rest.slice(0, end === -1 ? rest.length : end).filter((line) => /^\d+\.\s+\*\*/.test(line)).length;
}

// The U numbers that rows cite for one phase's verification file.
function citedUnverified(phase: string): number[] {
  const numbers = new Set<number>();
  for (const row of ROWS) {
    for (const segment of row.source.split(";")) {
      if (!segment.trim().startsWith(`${phase}-VERIFICATION`)) {
        continue;
      }
      for (const match of segment.matchAll(/\bU(\d+)\b/g)) {
        numbers.add(Number(match[1]));
      }
    }
  }
  return [...numbers].sort((a, b) => a - b);
}

void test("TEST-HOST-08: rows cover every numbered behavior_unverified item of the Phase 21 to 25 verification files", (t) => {
  for (const phase of ["21", "22", "23", "24", "25"]) {
    const found = planningFile(phase, "VERIFICATION");
    if (found.archived) {
      skipDiagnostic(t, phase);
      continue;
    }
    assert.ok(found.file !== "", `the phase ${phase} directory holds ${phase}-VERIFICATION.md`);
    const count = unverifiedCount(found.file ?? "");
    assert.ok(count > 0, `${phase}-VERIFICATION.md lists at least one behavior_unverified item`);
    assert.deepEqual(
      citedUnverified(phase),
      Array.from({ length: count }, (_, index) => index + 1),
      `the rows cite U1 to U${String(count)} of ${phase}-VERIFICATION.md exactly once or more`,
    );
  }
});

void test("TEST-HOST-08: a closed GAP-21-04 goes with a non-zero src/host coverage floor", (t) => {
  const row = ROWS.find((candidate) => candidate.id === "GAP-21-04");
  assert.ok(row !== undefined, "GAP-21-04 is on the page");
  const floors = JSON.parse(readFileSync(FLOORS, "utf8")) as { readonly floors: Readonly<Record<string, { readonly lines: number; readonly branches: number; readonly functions: number }>> };
  const host = floors.floors["src/host"];
  assert.ok(host !== undefined, "the floors file has a src/host entry");
  if (row.status === "closed") {
    assert.ok(host.lines > 0 && host.branches > 0 && host.functions > 0, "GAP-21-04 is closed, so the src/host floors for lines, branches and functions are above zero");
    return;
  }
  assert.equal(row.status, "open", "GAP-21-04 is open until the ratchet lands");
  t.diagnostic(`GAP-21-04 is open: the src/host floor is ${String(host.lines)}/${String(host.branches)}/${String(host.functions)}`);
});

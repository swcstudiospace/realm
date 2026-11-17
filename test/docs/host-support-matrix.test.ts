// TEST-HOST-07 (D-26-08): docs/integration/host-support-matrix.md is a view of HOST_RUNTIMES, HOST_REGISTRY and HOST_LIVE, never a second
// source. The test renders the block again and compares it with the text between the two markers of the page, byte for byte. A mismatch
// fails with a unified difference and the regeneration command. REALM_WRITE_HOST_MATRIX=1 rewrites only the text between the markers (never
// when CI is set, and only the page itself); the default run only reads. Fixtures and fakes only: no host runs and no process starts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { HOST_RUNTIMES } from "../../src/host/runtimes.js";
import { HOST_IDS, type HostId } from "../../src/host/types.js";
import { HOST_LIVE } from "../support/host-live.js";
import { HOST_REGISTRY, type RegistryRecord } from "../support/host-registry.js";
import { MATRIX_BEGIN, MATRIX_END, renderHostSupportMatrix } from "../support/host-support-matrix.js";

// The repository root, found the way manifest.test.ts finds package.json: from the compiled test file, three directories up.
const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const DOCS_DIR = join(REPO_ROOT, "docs");
const PAGE = join(DOCS_DIR, "integration", "host-support-matrix.md");
const REGENERATE = "regenerate with REALM_WRITE_HOST_MATRIX=1 node --test dist/test/docs/host-support-matrix.test.js, review the diff, commit";
const MAX_DIFF_LINES = 40;

interface Span {
  readonly start: number;
  readonly end: number;
}

// The offsets of the text between the markers: after the begin marker line, up to the end marker. A missing marker names itself.
function blockSpan(page: string): Span {
  const begin = page.indexOf(`${MATRIX_BEGIN}\n`);
  assert.ok(begin !== -1, `the page has no line holding the marker ${MATRIX_BEGIN}`);
  const start = begin + MATRIX_BEGIN.length + 1;
  const end = page.indexOf(`\n${MATRIX_END}`, start - 1);
  assert.ok(end !== -1, `the page has no line holding the marker ${MATRIX_END}`);
  return { start, end: end + 1 };
}

function blockOf(page: string): string {
  const span = blockSpan(page);
  return page.slice(span.start, span.end);
}

function withBlock(page: string, block: string): string {
  const span = blockSpan(page);
  return `${page.slice(0, span.start)}${block}${page.slice(span.end)}`;
}

// A line difference by longest common subsequence: "-" is a line only the page has, "+" a line only the rendering has. At most
// MAX_DIFF_LINES lines are shown.
function unifiedDifference(page: string, rendered: string): string {
  const a = page.split("\n");
  const b = rendered.split("\n");
  const common: number[][] = Array.from({ length: a.length + 1 }, () => Array.from({ length: b.length + 1 }, () => 0));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      const row = common[i];
      const below = common[i + 1];
      assert.ok(row !== undefined && below !== undefined, "the table is rectangular");
      row[j] = a[i] === b[j] ? (below[j + 1] ?? 0) + 1 : Math.max(below[j] ?? 0, row[j + 1] ?? 0);
    }
  }
  const out: string[] = ["--- page", "+++ rendered from the table, the registry and the live specs"];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      i += 1;
      j += 1;
    } else if (j >= b.length || (i < a.length && (common[i + 1]?.[j] ?? 0) >= (common[i]?.[j + 1] ?? 0))) {
      out.push(`-${a[i] ?? ""}`);
      i += 1;
    } else {
      out.push(`+${b[j] ?? ""}`);
      j += 1;
    }
  }
  if (out.length <= MAX_DIFF_LINES) {
    return out.join("\n");
  }
  const hidden = out.length - (MAX_DIFF_LINES - 1);
  return [...out.slice(0, MAX_DIFF_LINES - 1), `... ${String(hidden)} more difference lines`].join("\n");
}

function rendered(): string {
  return renderHostSupportMatrix(HOST_RUNTIMES, HOST_REGISTRY, HOST_LIVE);
}

void test("TEST-HOST-07: the page holds exactly the matrix rendered from the table, the registry and the live specs", () => {
  if (process.env.REALM_WRITE_HOST_MATRIX === "1") {
    assert.ok((process.env.CI ?? "") === "", "REALM_WRITE_HOST_MATRIX refuses to write when CI is set");
    const inside = relative(DOCS_DIR, PAGE);
    assert.equal(inside, join("integration", "host-support-matrix.md"), "the path written is the support matrix page inside the docs directory");
    assert.ok(!inside.startsWith(".."), "the path written is inside the docs directory");
    writeFileSync(PAGE, withBlock(readFileSync(PAGE, "utf8"), rendered()));
  }
  const page = readFileSync(PAGE, "utf8");
  const block = blockOf(page);
  const expected = rendered();
  assert.ok(block === expected, `docs/integration/host-support-matrix.md differs from the table, the registry and the live specs.\n${unifiedDifference(block, expected)}\n${REGENERATE}`);
});

// The first cell of each data row names the host in a code span.
function rowCounts(block: string, heading: string): Map<string, number> {
  const start = block.indexOf(`### ${heading}\n`);
  assert.ok(start !== -1, `the block has a ${heading} table`);
  const next = block.indexOf("\n### ", start + 1);
  const section = block.slice(start, next === -1 ? block.length : next);
  const counts = new Map<string, number>();
  for (const line of section.split("\n")) {
    const match = /^\| `([^`]+)`/.exec(line);
    if (match?.[1] !== undefined) {
      counts.set(match[1], (counts.get(match[1]) ?? 0) + 1);
    }
  }
  return counts;
}

void test("TEST-HOST-07: every host id appears exactly once in each table of the rendering", () => {
  const block = rendered();
  for (const heading of ["Support", "Evidence"]) {
    const counts = rowCounts(block, heading);
    assert.deepEqual([...counts.keys()], [...HOST_IDS], `${heading}: one row per host id, in table order`);
    for (const id of HOST_IDS) {
      assert.equal(counts.get(id), 1, `${heading}: ${id} appears once`);
    }
  }
});

void test("TEST-HOST-07: the rendering ends in one newline, uses LF only and holds no angle bracket", () => {
  const block = rendered();
  assert.ok(block.endsWith("|\n"), "the block ends with one newline after the last row");
  assert.ok(!block.endsWith("\n\n"), "the block has no blank line at its end");
  assert.ok(!block.includes("\r"), "the block has no carriage return");
  assert.ok(!block.includes("<") && !block.includes(">"), "the block holds no angle bracket");
});

void test("TEST-HOST-07: the rendering reads the registry (a deferred host given a recipe family renders differently)", () => {
  const baseline = rendered();
  const record: RegistryRecord = { ...HOST_REGISTRY.windsurf, family: "json-merge", suites: ["test/host/example-recipe.test.ts"], deferral: null };
  const changed = renderHostSupportMatrix(HOST_RUNTIMES, { ...HOST_REGISTRY, windsurf: record }, HOST_LIVE);
  assert.notEqual(changed, baseline);
  assert.ok(changed.includes("`test/host/example-recipe.test.ts`"), "the suite file of the changed record is in the rendering");
  assert.ok(!changed.includes("OQ-25-01"), "the deferral of the changed record is gone");
});

void test("TEST-HOST-07: the rendering reads the table and the live specs", () => {
  const baseline = rendered();
  const changedTable = renderHostSupportMatrix({ ...HOST_RUNTIMES, cursor: { ...HOST_RUNTIMES.cursor, displayName: "Cursor renamed" } }, HOST_REGISTRY, HOST_LIVE);
  assert.notEqual(changedTable, baseline);
  assert.ok(changedTable.includes("Cursor renamed"));
  const changedLive = renderHostSupportMatrix(HOST_RUNTIMES, HOST_REGISTRY, { ...HOST_LIVE, pi: { ...HOST_LIVE.pi, minVersion: "9.9.9" } });
  assert.notEqual(changedLive, baseline);
  assert.ok(changedLive.includes("floor 9.9.9"));
  assert.ok(baseline.includes("floor 1.3.0"), "the pi floor of the live specs is in the rendering");
});

void test("TEST-HOST-07: a pipe in a registry string is escaped and an angle bracket or a line break throws", () => {
  const withNote = (note: string): Readonly<Record<HostId, RegistryRecord>> => ({
    ...HOST_REGISTRY,
    omp: { ...HOST_REGISTRY.omp, t3: { status: "gap", note } },
  });
  const piped = renderHostSupportMatrix(HOST_RUNTIMES, withNote("one | two"), HOST_LIVE);
  assert.ok(piped.includes("one \\| two"), "a pipe is escaped");
  assert.throws(() => renderHostSupportMatrix(HOST_RUNTIMES, withNote("bad <tag> here"), HOST_LIVE), /angle bracket/);
  assert.throws(() => renderHostSupportMatrix(HOST_RUNTIMES, withNote("two\nlines"), HOST_LIVE), /line break/);
});

void test("TEST-HOST-07: the page names both markers each on a line of its own, once", () => {
  const page = readFileSync(PAGE, "utf8");
  for (const marker of [MATRIX_BEGIN, MATRIX_END]) {
    const lines = page.split("\n").filter((line) => line === marker);
    assert.equal(lines.length, 1, `${marker} is on one line of its own, once`);
  }
});

void test("TEST-HOST-07: the difference helper shows the changed lines and is bounded", () => {
  const long = Array.from({ length: 100 }, (_, index) => `line ${String(index)}`).join("\n");
  const other = Array.from({ length: 100 }, (_, index) => `other ${String(index)}`).join("\n");
  const shown = unifiedDifference(long, other).split("\n");
  assert.ok(shown.length <= MAX_DIFF_LINES, "at most 40 lines");
  assert.ok(shown.some((line) => line.startsWith("-line ")));
  assert.ok(shown.some((line) => line.startsWith("+other ")) || shown.at(-1)?.includes("more difference lines") === true);
  assert.equal(unifiedDifference("same\n", "same\n").split("\n").length, 2, "equal text shows only the two header lines");
});

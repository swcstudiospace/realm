// BOOTP-01 and BOOTP-02 (31-CONTEXT D-31-09, Phase 48): docs/integration/wave1-boot-matrix.md is the production-stack boot status of the five wave 1
// hosts and the three Phase 48 hosts (muse-code, prime-agent, grok-build). This test ties each row to the evidence registry (the Disposition is the T3 status of the host's record), requires a date and a
// version on a row that claims a result, requires every gap the page names to be on the gaps page, requires the three mandatory sections
// and refuses a host-local path. Reads files only: nothing is written and no process starts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { HOST_REGISTRY } from "../support/host-registry.js";

// The repository root, found the way host-docs.test.ts finds it: from the compiled test file, three directories up.
const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const PAGE = join(REPO_ROOT, "docs", "integration", "wave1-boot-matrix.md");
const GAPS_PAGE = join(REPO_ROOT, "docs", "integration", "host-plugin-gaps.md");

const WAVE1 = ["claude", "codex", "opencode", "kimi", "kimi-code", "muse-code", "prime-agent", "grok-build"] as const;
const DISPOSITIONS: readonly string[] = ["rehearsed", "failed", "not-run", "gap"];
const FAILED_PREFIX = "rehearsal failed";

// The same patterns scripts/check/host-paths.mjs refuses: a root, home, users or temporary directory followed by a name.
const HOST_PATH_PATTERNS: readonly RegExp[] = [/\/root\/[A-Za-z0-9._-]+/, /\/tmp\/[A-Za-z0-9._-]+/, /\/Users\/[A-Za-z0-9._-]+/, /\/home\/[A-Za-z0-9._-]+/];

interface MatrixRow {
  readonly host: string;
  readonly disposition: string;
  readonly version: string;
  readonly date: string;
  readonly gaps: readonly string[];
}

const TEXT = readFileSync(PAGE, "utf8");

// The rows of the matrix table: lines that start with a code-span host id. The cells are Host, Disposition, Driven by, Version, Result,
// Wire and daemon evidence, Date, Gap rows.
function parseRows(text: string): MatrixRow[] {
  const rows: MatrixRow[] = [];
  for (const line of text.split("\n")) {
    if (!line.startsWith("| `")) {
      continue;
    }
    const cells = line
      .slice(1, line.lastIndexOf("|"))
      .split("|")
      .map((cell) => cell.trim());
    assert.equal(cells.length, 8, `the row has eight cells: ${line.slice(0, 60)}`);
    const [host = "", disposition = "", , version = "", , , date = "", gaps = ""] = cells;
    rows.push({ host: host.replaceAll("`", ""), disposition, version, date, gaps: [...gaps.matchAll(/GAP-\d{2}-\d{2}/g)].map((match) => match[0]) });
  }
  return rows;
}

const ROWS = parseRows(TEXT);

// The disposition the registry's T3 record of a host stands for.
function expectedDisposition(host: (typeof WAVE1)[number]): string {
  const { t3 } = HOST_REGISTRY[host];
  switch (t3.status) {
    case "rehearsed":
      return "rehearsed";
    case "not-run":
      return "not-run";
    case "gap":
      return t3.note.startsWith(FAILED_PREFIX) ? "failed" : "gap";
    case "none-defined":
      return "none-defined";
  }
}

void test("BOOTP: the matrix has exactly the five wave 1 hosts and the three Phase 48 hosts, in order, with a known disposition", () => {
  assert.deepEqual(
    ROWS.map((row) => row.host),
    [...WAVE1],
  );
  for (const row of ROWS) {
    assert.ok(DISPOSITIONS.includes(row.disposition), `${row.host}: disposition ${row.disposition} is one of ${DISPOSITIONS.join(", ")}`);
  }
});

void test("BOOTP: each disposition equals the T3 status of the host's registry record", () => {
  for (const row of ROWS) {
    const host = WAVE1.find((id) => id === row.host);
    assert.ok(host !== undefined, `${row.host} is a wave 1 host`);
    assert.equal(row.disposition, expectedDisposition(host), `${row.host}: the matrix and the registry agree (rehearsed, failed as a gap note starting "${FAILED_PREFIX}", not-run, gap)`);
  }
});

void test("BOOTP: a rehearsed or failed row has a date and a version, and a row without a result has neither", () => {
  for (const row of ROWS) {
    if (row.disposition === "rehearsed" || row.disposition === "failed") {
      assert.match(row.date, /^\d{4}-\d{2}-\d{2}$/, `${row.host}: a ${row.disposition} row carries its date`);
      assert.ok(row.version !== "" && row.version !== "-", `${row.host}: a ${row.disposition} row carries the version that ran`);
    } else if (row.disposition === "not-run") {
      assert.equal(row.date, "-", `${row.host}: a not-run row carries no date`);
      assert.equal(row.version, "-", `${row.host}: a not-run row carries no version`);
    }
  }
});

void test("BOOTP: every gap a row names is on the gaps page, and every row names at least one", () => {
  const gapsPage = readFileSync(GAPS_PAGE, "utf8");
  const ids = new Set([...gapsPage.matchAll(/^\| (GAP-\d{2}-\d{2}) \|/gm)].map((match) => match[1] ?? ""));
  for (const row of ROWS) {
    assert.ok(row.gaps.length > 0, `${row.host}: the Gap rows cell names at least one GAP id`);
    for (const id of row.gaps) {
      assert.ok(ids.has(id), `${row.host}: ${id} is on docs/integration/host-plugin-gaps.md`);
    }
  }
});

void test("BOOTP: the page has its three mandatory sections and one level-one heading", () => {
  const headings = TEXT.split("\n").filter((line) => line.startsWith("## "));
  for (const section of ["How a host is booted", "The window", "Not shown"]) {
    assert.ok(headings.includes(`## ${section}`), `the page has a section named ${section}`);
  }
  assert.equal(TEXT.split("\n").filter((line) => line.startsWith("# ")).length, 1, "one level-one heading");
  assert.ok(TEXT.startsWith("# Wave 1 boot matrix\n"), "the level-one heading is Wave 1 boot matrix");
});

void test("BOOTP: the page names no host-local path", () => {
  for (const pattern of HOST_PATH_PATTERNS) {
    assert.equal(pattern.test(TEXT), false, `the page matches the host-path pattern ${pattern.source}`);
  }
});

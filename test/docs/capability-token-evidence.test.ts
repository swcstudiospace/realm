// EVID-01 to EVID-03 (35-CONTEXT D-35-06): docs/integration/capability-token-evidence.md is the measured evidence for capability tokens.
// This test parses the page and refuses: a missing or repeated section, a status outside not-run, recorded, partial, failed, a row that
// is not not-run without a date and a version, a not-run row that carries a date, a result sentence without an evidence label, a host
// path, a token shape, a run of 32 or more hex characters, a raw angle token and the word advisory next to the word default. A second
// group of tests feeds small seeded pages to the same parser, so the guard is itself tested. Reads files only: nothing is written and no
// process starts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// The repository root, found the way wave1-boot-matrix.test.ts finds it: from the compiled test file, three directories up.
const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const PAGE = join(REPO_ROOT, "docs", "integration", "capability-token-evidence.md");

const STATUSES: readonly string[] = ["not-run", "recorded", "partial", "failed"];
const LABELS: readonly string[] = ["Observed", "From code", "Inference"];

const TITLE = "# Capability token evidence";
const SUMMARY = "## Status of each requirement";
const FACTS = "## Machine and run facts";
const EVID01 = "## EVID-01: the non-root run";
const EVID02 = "## EVID-02: the memory probe";
const EVID03 = "## EVID-03: the live enforce proof";
const NOT_SHOWN = "## Not shown";
const OUTSIDE = "## Evidence kept outside the repository";
const HEADINGS: readonly string[] = [TITLE, SUMMARY, FACTS, EVID01, EVID02, EVID03, NOT_SHOWN, OUTSIDE];

const SUMMARY_COLUMNS: readonly string[] = ["Requirement", "Status", "Tier", "Date", "Version and run", "Section"];
const FACTS_COLUMNS: readonly string[] = ["Fact", "Value", "Evidence label", "Date"];
const EVID01_COLUMNS: readonly string[] = ["Run", "Test set", "Commit", "Node", "Account", "ptrace_scope", "Tests", "Pass", "Fail", "Skipped", "Status", "Date"];
const EVID02_COLUMNS: readonly string[] = ["Arm", "Probe", "Target", "Result", "Coverage", "Status", "Date"];
const EVID03_COLUMNS: readonly string[] = ["Drive", "Tier", "Version", "Result", "Audit lines checked", "Leak scan", "Status", "Date"];

const REQUIREMENTS: readonly string[] = ["EVID-01", "EVID-02", "EVID-03"];
const FACT_ROWS: readonly string[] = [
  "Kernel release",
  "Yama ptrace_scope as read",
  "Security modules listed",
  "Node version",
  "Account uid and gid",
  "Harness account",
  "Podman version",
];

// The same patterns scripts/check/host-paths.mjs refuses: a root, home, users or temporary directory followed by a name.
const HOST_PATH_PATTERNS: readonly RegExp[] = [/\/root\/[A-Za-z0-9._-]+/, /\/tmp\/[A-Za-z0-9._-]+/, /\/Users\/[A-Za-z0-9._-]+/, /\/home\/[A-Za-z0-9._-]+/];
const TOKEN_SHAPE = /rcap1\.[A-Za-z0-9_-]{8,}/;
const LONG_HEX = /[0-9a-fA-F]{32,}/;
const ADVISORY_NEXT_TO_DEFAULT = /advisory.{0,40}default|default.{0,40}advisory/i;
const ISO_DATE = /\d{4}-\d{2}-\d{2}/;
// A raw angle token the docs publisher would read as markup: an angle bracket followed by a letter, a slash or a bang.
const RAW_ANGLE_TOKEN = /<[A-Za-z/!]/;
// The sentence a partial EVID-03 carries, and the claim no EVID-03 text may make (35-03: the tier is named, a scripted provider is not a model).
const CLAUDE_DID_NOT_CALL = "claude did not itself issue a tool call";
const CLAIMS_REAL_MODEL = /claude used realm with a (?:real )?model/i;

interface Table {
  readonly header: readonly string[];
  readonly rows: readonly (readonly string[])[];
}

function cellsOf(line: string): string[] {
  return line
    .slice(line.indexOf("|") + 1, line.lastIndexOf("|"))
    .split("|")
    .map((cell) => cell.trim());
}

// The lines of the page outside code fences, so a heading inside a fence is not a heading.
function proseLines(text: string): string[] {
  const lines: string[] = [];
  let fenced = false;
  for (const line of text.split("\n")) {
    if (line.startsWith("```")) {
      fenced = !fenced;
      continue;
    }
    if (!fenced) {
      lines.push(line);
    }
  }
  return lines;
}

// The lines under one heading, up to the next heading of the same or a higher level.
function sectionLines(lines: readonly string[], heading: string): string[] {
  const at = lines.indexOf(heading);
  if (at < 0) {
    return [];
  }
  const out: string[] = [];
  for (const line of lines.slice(at + 1)) {
    if (line.startsWith("# ") || line.startsWith("## ")) {
      break;
    }
    out.push(line);
  }
  return out;
}

// Every table of the lines: a header row, a delimiter row and the rows after them. A row whose width differs from its header is a finding.
function tablesOf(lines: readonly string[], where: string, findings: string[]): Table[] {
  const tables: Table[] = [];
  let at = 0;
  while (at < lines.length) {
    const line = lines[at] ?? "";
    const delimiter = lines[at + 1] ?? "";
    if (!line.startsWith("|") || !/^\|[\s:|-]+\|$/.test(delimiter)) {
      at += 1;
      continue;
    }
    const header = cellsOf(line);
    const rows: string[][] = [];
    at += 2;
    while (at < lines.length && (lines[at] ?? "").startsWith("|")) {
      const cells = cellsOf(lines[at] ?? "");
      if (cells.length !== header.length) {
        findings.push(`${where}: a row has ${String(cells.length)} cells, the header has ${String(header.length)}: ${(lines[at] ?? "").slice(0, 60)}`);
      }
      rows.push(cells);
      at += 1;
    }
    tables.push({ header, rows });
  }
  return tables;
}

function column(table: Table, name: string): number {
  return table.header.indexOf(name);
}

function cell(table: Table, row: readonly string[], name: string): string {
  return row[column(table, name)] ?? "";
}

function isDash(value: string): boolean {
  return value === "-" || value === "";
}

// The paragraph that starts with the Verdict marker: the line and the lines after it up to the next blank line or heading.
function verdictParagraph(lines: readonly string[]): string | undefined {
  const at = lines.findIndex((line) => line.startsWith("Verdict:"));
  if (at < 0) {
    return undefined;
  }
  const parts: string[] = [];
  for (const line of lines.slice(at)) {
    if (line.trim() === "" || line.startsWith("#")) {
      break;
    }
    parts.push(line.trim());
  }
  return parts.join(" ");
}

function hasLabel(text: string): boolean {
  return LABELS.some((label) => text.includes(label));
}

function checkTable(
  findings: string[],
  where: string,
  table: Table | undefined,
  columns: readonly string[],
  versionColumns: readonly string[],
): Table | undefined {
  if (table === undefined) {
    findings.push(`${where}: the table is missing`);
    return undefined;
  }
  if (table.header.join("|") !== columns.join("|")) {
    findings.push(`${where}: the header is ${table.header.join(" | ")}, expected ${columns.join(" | ")}`);
    return undefined;
  }
  if (table.rows.length === 0) {
    findings.push(`${where}: the table has no row`);
  }
  for (const row of table.rows) {
    const label = row[0] ?? "";
    const status = cell(table, row, "Status");
    if (!STATUSES.includes(status)) {
      findings.push(`${where}: the status ${status} of ${label} is not one of ${STATUSES.join(", ")}`);
      continue;
    }
    const date = cell(table, row, "Date");
    if (status === "not-run") {
      if (!isDash(date)) {
        findings.push(`${where}: ${label} is not-run and carries a date`);
      }
      continue;
    }
    if (!ISO_DATE.test(date)) {
      findings.push(`${where}: ${label} is ${status} without a date`);
    }
    for (const name of versionColumns) {
      const version = cell(table, row, name);
      if (isDash(version) || version === "not-run") {
        findings.push(`${where}: ${label} is ${status} without ${name}`);
      }
    }
  }
  return table;
}

// The findings of one page text: an empty list means the page keeps every rule.
function inspectPage(text: string): string[] {
  const findings: string[] = [];
  const lines = proseLines(text);

  // The sections: each heading once, in order.
  let previous = -1;
  for (const heading of HEADINGS) {
    const count = lines.filter((line) => line === heading).length;
    if (count !== 1) {
      findings.push(`the heading ${heading} appears ${String(count)} times, expected once`);
      continue;
    }
    const at = lines.indexOf(heading);
    if (at < previous) {
      findings.push(`the heading ${heading} is out of order`);
    }
    previous = at;
  }

  // The summary table: exactly the three requirement rows, each pointing at its section.
  const summaryTables = tablesOf(sectionLines(lines, SUMMARY), "summary", findings);
  const summary = checkTable(findings, "summary", summaryTables[0], SUMMARY_COLUMNS, ["Version and run"]);
  const summaryStatuses: string[] = [];
  if (summary !== undefined) {
    const names = summary.rows.map((row) => row[0] ?? "");
    if (names.join("|") !== REQUIREMENTS.join("|")) {
      findings.push(`summary: the rows are ${names.join(", ")}, expected ${REQUIREMENTS.join(", ")}`);
    }
    const sections = [EVID01, EVID02, EVID03].map((heading) => heading.slice(3));
    summary.rows.forEach((row, index) => {
      summaryStatuses.push(cell(summary, row, "Status"));
      if (index < sections.length && cell(summary, row, "Section") !== sections[index]) {
        findings.push(`summary: the section cell of ${row[0] ?? ""} is not ${sections[index] ?? ""}`);
      }
    });
  }

  // The facts table: the named rows, a label from the set on every value that is not not-run, and Observed only with a date.
  const facts = tablesOf(sectionLines(lines, FACTS), "facts", findings)[0];
  if (facts === undefined || facts.header.join("|") !== FACTS_COLUMNS.join("|")) {
    findings.push("facts: the table is missing or its header is not Fact | Value | Evidence label | Date");
  } else {
    const names = facts.rows.map((row) => row[0] ?? "");
    for (const name of FACT_ROWS) {
      if (!names.includes(name)) {
        findings.push(`facts: the row ${name} is missing`);
      }
    }
    for (const row of facts.rows) {
      const name = row[0] ?? "";
      const value = cell(facts, row, "Value");
      const label = cell(facts, row, "Evidence label");
      const date = cell(facts, row, "Date");
      if (value === "not-run") {
        if (!isDash(label) || !isDash(date)) {
          findings.push(`facts: ${name} is not-run and carries a label or a date`);
        }
        continue;
      }
      if (!LABELS.includes(label)) {
        findings.push(`facts: the label ${label} of ${name} is not one of ${LABELS.join(", ")}`);
      }
      if (label === "Observed" && !ISO_DATE.test(date)) {
        findings.push(`facts: ${name} is Observed without a date`);
      }
    }
  }

  // The three requirement sections, each with its table.
  checkTable(findings, "EVID-01", tablesOf(sectionLines(lines, EVID01), "EVID-01", findings)[0], EVID01_COLUMNS, ["Commit", "Node"]);
  checkTable(findings, "EVID-02", tablesOf(sectionLines(lines, EVID02), "EVID-02", findings)[0], EVID02_COLUMNS, []);
  const evid03Lines = sectionLines(lines, EVID03);
  const evid03 = checkTable(findings, "EVID-03", tablesOf(evid03Lines, "EVID-03", findings)[0], EVID03_COLUMNS, ["Version"]);
  if (evid03 !== undefined) {
    const evid03Status = summaryStatuses[2] ?? "not-run";
    const statusOf = (drive: string): string => {
      const row = evid03.rows.find((candidate) => candidate[0] === drive);
      return row === undefined ? "not-run" : cell(evid03, row, "Status");
    };
    for (const row of evid03.rows) {
      const drive = row[0] ?? "";
      const status = cell(evid03, row, "Status");
      if (status === "not-run") {
        continue;
      }
      if (isDash(cell(evid03, row, "Tier"))) {
        findings.push(`EVID-03: ${drive} is ${status} without a Tier`);
      }
      if (drive === "host-driven" && status === "recorded") {
        const result = cell(evid03, row, "Result");
        if (!result.includes("tools/list") || !result.includes("tools/call") || !/provider[^|]*\d/.test(result)) {
          findings.push("EVID-03: a recorded host-driven row needs the wire methods and the provider counts in its Result");
        }
        if (!cell(evid03, row, "Tier").includes("scripted provider")) {
          findings.push("EVID-03: a recorded host-driven row names the scripted provider in its Tier");
        }
      }
    }
    if (evid03Status === "partial" && !evid03Lines.join("\n").includes(CLAUDE_DID_NOT_CALL)) {
      findings.push(`EVID-03: a partial status needs the sentence: ${CLAUDE_DID_NOT_CALL}`);
    }
    if (evid03Status === "recorded" && statusOf("host-driven") !== "recorded") {
      findings.push("EVID-03: the status is recorded only when the host-driven row is recorded");
    }
    if (evid03Status === "recorded" && statusOf("launcher-driven") === "not-run") {
      findings.push("EVID-03: the status is recorded only when the launcher-driven row ran too");
    }
    if (CLAIMS_REAL_MODEL.test(evid03Lines.join("\n"))) {
      findings.push("EVID-03: the section says claude used Realm with a model");
    }
  }

  // The Verdict paragraph: a status from the vocabulary; every sentence after the status sentence carries a label unless the status is
  // not-run.
  const verdict = verdictParagraph(sectionLines(lines, EVID02));
  if (verdict === undefined) {
    findings.push("EVID-02: the Verdict paragraph is missing");
  } else {
    const status = /^Verdict:\s*([a-z-]+)/.exec(verdict)?.[1] ?? "";
    if (!STATUSES.includes(status)) {
      findings.push(`EVID-02: the verdict status ${status} is not one of ${STATUSES.join(", ")}`);
    } else if (status !== "not-run") {
      const sentences = verdict.split(/(?<=[.!?])\s+/).slice(1);
      for (const sentence of sentences) {
        if (!hasLabel(sentence)) {
          findings.push(`EVID-02: a verdict sentence has no evidence label: ${sentence.slice(0, 60)}`);
        }
      }
    }
  }

  // The Not shown section: present, with bullets; once any requirement left not-run, every bullet carries an evidence label.
  const notShown = sectionLines(lines, NOT_SHOWN).filter((line) => line.startsWith("- "));
  if (notShown.length === 0) {
    findings.push("Not shown: the section has no bullet");
  } else if (summaryStatuses.some((status) => status !== "not-run")) {
    for (const bullet of notShown) {
      if (!hasLabel(bullet)) {
        findings.push(`Not shown: a bullet has no evidence label: ${bullet.slice(0, 60)}`);
      }
    }
  }

  // The leak guard over the whole text, fences included.
  for (const pattern of HOST_PATH_PATTERNS) {
    if (pattern.test(text)) {
      findings.push(`a host path matches ${String(pattern)}`);
    }
  }
  if (TOKEN_SHAPE.test(text)) {
    findings.push("a token shape appears");
  }
  if (LONG_HEX.test(text)) {
    findings.push("a run of 32 or more hex characters appears");
  }
  if (ADVISORY_NEXT_TO_DEFAULT.test(text)) {
    findings.push("the word advisory appears next to the word default");
  }
  const outsideCode = lines.map((line) => line.replace(/`[^`]*`/g, "")).join("\n");
  if (RAW_ANGLE_TOKEN.test(outsideCode)) {
    findings.push("a raw angle token appears outside code");
  }
  return findings;
}

const PAGE_TEXT = readFileSync(PAGE, "utf8");

// A seeded page: the real page with one text replaced; the replaced text must exist so a seed cannot silently miss.
function seeded(from: string, to: string): string {
  assert.ok(PAGE_TEXT.includes(from), `the seed anchor exists in the page: ${from.slice(0, 50)}`);
  return PAGE_TEXT.replace(from, to);
}

const SUMMARY_EVID01 =
  "| EVID-01 | recorded | - | 2026-11-18 | commit 7c44538 on Node v24.18.0, Set A twice as uid 5002 | EVID-01: the non-root run |";
const FIRST_RUN = "| first run (plan 35-01 window) | Set A | - | - | - | - | - | - | - | - | not-run | - |";

void test("EVID: the real page keeps every rule", () => {
  assert.deepEqual(inspectPage(PAGE_TEXT), []);
});

void test("EVID: the live enforce proof rows of the real page stay not-run until its window", () => {
  const findings: string[] = [];
  const lines = proseLines(PAGE_TEXT);
  for (const table of tablesOf(sectionLines(lines, EVID03), EVID03, findings)) {
    for (const row of table.rows) {
      assert.equal(cell(table, row, "Status"), "not-run", `${EVID03}: ${row[0] ?? ""} is not-run until a window fills it`);
    }
  }
  assert.deepEqual(findings, []);
});

void test("EVID guard: a status outside the vocabulary is rejected", () => {
  const findings = inspectPage(seeded(SUMMARY_EVID01, "| EVID-01 | passed | - | - | - | EVID-01: the non-root run |"));
  assert.ok(
    findings.some((finding) => finding.includes("the status passed of EVID-01")),
    findings.join("\n"),
  );
});

void test("EVID guard: a recorded row without a date is rejected, and without a version", () => {
  const noDate = inspectPage(seeded(SUMMARY_EVID01, "| EVID-01 | recorded | - | - | 1a2b3c4 on Node v24 | EVID-01: the non-root run |"));
  assert.ok(
    noDate.some((finding) => finding.includes("EVID-01 is recorded without a date")),
    noDate.join("\n"),
  );
  const noVersion = inspectPage(seeded(SUMMARY_EVID01, "| EVID-01 | recorded | - | 2026-11-18 | - | EVID-01: the non-root run |"));
  assert.ok(
    noVersion.some((finding) => finding.includes("EVID-01 is recorded without Version and run")),
    noVersion.join("\n"),
  );
});

void test("EVID guard: a not-run row that carries a date is rejected", () => {
  const findings = inspectPage(seeded(SUMMARY_EVID01, "| EVID-01 | not-run | - | 2026-11-18 | - | EVID-01: the non-root run |"));
  assert.ok(
    findings.some((finding) => finding.includes("EVID-01 is not-run and carries a date")),
    findings.join("\n"),
  );
});

void test("EVID guard: a leaked token shape is rejected", () => {
  const token = ["rcap1", "AAAAAAAAAAAA", "BBBBBBBBBBBB"].join(".");
  const findings = inspectPage(`${PAGE_TEXT}\nProbe saw ${token} in the holder.\n`);
  assert.ok(findings.includes("a token shape appears"), findings.join("\n"));
});

void test("EVID guard: a 64-character hex run is rejected, and an 8-character prefix is not", () => {
  const findings = inspectPage(`${PAGE_TEXT}\nDigest ${"ab12".repeat(16)}.\n`);
  assert.ok(findings.includes("a run of 32 or more hex characters appears"), findings.join("\n"));
  assert.deepEqual(inspectPage(`${PAGE_TEXT}\nDigest prefix ab12cd34.\n`), []);
});

void test("EVID guard: a host path is rejected", () => {
  const home = ["", "home", "someone"].join("/");
  const findings = inspectPage(`${PAGE_TEXT}\nCopied from ${home}.\n`);
  assert.ok(
    findings.some((finding) => finding.startsWith("a host path matches")),
    findings.join("\n"),
  );
});

void test("EVID guard: a missing Not shown section and a missing section are rejected", () => {
  const findings = inspectPage(PAGE_TEXT.replace(NOT_SHOWN, "## Left out"));
  assert.ok(
    findings.some((finding) => finding.includes(`the heading ${NOT_SHOWN} appears 0 times`)),
    findings.join("\n"),
  );
  const twice = inspectPage(`${PAGE_TEXT}\n${EVID03}\n`);
  assert.ok(
    twice.some((finding) => finding.includes(`the heading ${EVID03} appears 2 times`)),
    twice.join("\n"),
  );
});

void test("EVID guard: a result sentence without an evidence label is rejected once a row left not-run", () => {
  const partialRow = "| EVID-01 | partial | - | 2026-11-18 | 1a2b3c4 on Node v24 | EVID-01: the non-root run |";
  const labelled = inspectPage(seeded(SUMMARY_EVID01, partialRow));
  assert.deepEqual(labelled, []);
  const unlabelled = inspectPage(seeded(SUMMARY_EVID01, partialRow).replace("- Hosts other than claude (From code).", "- Hosts other than claude."));
  assert.ok(
    unlabelled.some((finding) => finding.includes("Not shown: a bullet has no evidence label")),
    unlabelled.join("\n"),
  );
  const verdict = seeded("Verdict: recorded. Observed on 2026-11-18, the frozen rule", "Verdict: recorded. The frozen rule");
  const verdictFindings = inspectPage(verdict);
  assert.ok(
    verdictFindings.some((finding) => finding.includes("a verdict sentence has no evidence label")),
    verdictFindings.join("\n"),
  );
});

void test("EVID guard: a raw angle token and advisory next to default are rejected", () => {
  const angle = inspectPage(`${PAGE_TEXT}\nThe account is <name> here.\n`);
  assert.ok(angle.includes("a raw angle token appears outside code"), angle.join("\n"));
  assert.deepEqual(inspectPage(`${PAGE_TEXT}\nThe account is \`<name>\` here.\n`), []);
  const advisory = inspectPage(`${PAGE_TEXT}\nThe default mode is advisory.\n`);
  assert.ok(advisory.includes("the word advisory appears next to the word default"), advisory.join("\n"));
});

void test("EVID guard: a first-run row with a commit, a Node version and a date passes", () => {
  const run = "| first run (plan 35-01 window) | Set A | 1a2b3c4 | v24 | uid 5002 | 1 | 10 | 10 | 0 | 0 | partial | 2026-11-18 |";
  assert.deepEqual(inspectPage(seeded(FIRST_RUN, run)), []);
  const bare = "| first run (plan 35-01 window) | Set A | - | - | uid 5002 | 1 | 10 | 10 | 0 | 0 | partial | 2026-11-18 |";
  const findings = inspectPage(seeded(FIRST_RUN, bare));
  assert.ok(
    findings.some((finding) => finding.includes("is partial without Commit")),
    findings.join("\n"),
  );
});

// ---- EVID-03 structure (plan 35-03 Task 8 pins; they fire only once a row left not-run) ---------------------------------------

const EVID03_SUMMARY = "| EVID-03 | not-run | - | - | - | EVID-03: the live enforce proof |";
const LAUNCHER_ROW = "| launcher-driven | not-run | - | not-run | - | not-run | not-run | - |";
const HOST_ROW = "| host-driven | not-run | - | not-run | - | not-run | not-run | - |";

void test("EVID-03 guard: a partial status without the sentence that claude did not itself issue a tool call is rejected, with it the page passes", () => {
  const summary = "| EVID-03 | partial | scripted client | 2026-11-18 | claude 2.1.322, commit 1a2b3c4 | EVID-03: the live enforce proof |";
  const launcher = "| launcher-driven | scripted client | claude 2.1.322 | cold start ok | 1 attach, 6 call lines | clean (12 sinks) | recorded | 2026-11-18 |";
  const without = seeded(EVID03_SUMMARY, summary).replace(LAUNCHER_ROW, launcher);
  const findings = inspectPage(without);
  assert.ok(
    findings.some((finding) => finding.includes(`a partial status needs the sentence: ${CLAUDE_DID_NOT_CALL}`)),
    findings.join("\n"),
  );
  const withSentence = without.replace("## Not shown", `The registered host command was driven by a script; ${CLAUDE_DID_NOT_CALL}.\n\n## Not shown`);
  assert.ok(withSentence !== without);
  assert.deepEqual(
    inspectPage(withSentence).filter((finding) => !finding.startsWith("Not shown")),
    [],
  );
});

void test("EVID-03 guard: a recorded host-driven row needs the wire methods, the provider counts and the scripted provider tier", () => {
  const summary = "| EVID-03 | recorded | scripted provider | 2026-11-18 | claude 2.1.322, commit 1a2b3c4 | EVID-03: the live enforce proof |";
  const launcher = "| launcher-driven | scripted client | claude 2.1.322 | cold start ok | 1 attach, 6 call lines | clean (12 sinks) | recorded | 2026-11-18 |";
  const goodHost = "| host-driven | scripted provider | claude 2.1.322 | wire initialize, tools/list, tools/call; provider requests 2 | 2 attach, 8 call lines | clean (14 sinks) | recorded | 2026-11-18 |";
  const base = seeded(EVID03_SUMMARY, summary).replace(LAUNCHER_ROW, launcher);
  assert.deepEqual(inspectPage(base.replace(HOST_ROW, goodHost)).filter((finding) => !finding.startsWith("Not shown")), []);
  const noWire = base.replace(HOST_ROW, goodHost.replace("wire initialize, tools/list, tools/call; ", ""));
  assert.ok(inspectPage(noWire).some((finding) => finding.includes("needs the wire methods and the provider counts")), inspectPage(noWire).join("\n"));
  const noCounts = base.replace(HOST_ROW, goodHost.replace("; provider requests 2", ""));
  assert.ok(inspectPage(noCounts).some((finding) => finding.includes("needs the wire methods and the provider counts")));
  const wrongTier = base.replace(HOST_ROW, goodHost.replace("| scripted provider |", "| production |"));
  assert.ok(inspectPage(wrongTier).some((finding) => finding.includes("names the scripted provider in its Tier")));
});

void test("EVID-03 guard: recorded needs both drives, a ran row needs a tier, and the page never says claude used Realm with a model", () => {
  const summary = "| EVID-03 | recorded | scripted provider | 2026-11-18 | claude 2.1.322, commit 1a2b3c4 | EVID-03: the live enforce proof |";
  const base = seeded(EVID03_SUMMARY, summary);
  assert.ok(inspectPage(base).some((finding) => finding.includes("only when the host-driven row is recorded")));
  const bareTier = seeded(LAUNCHER_ROW, "| launcher-driven | - | claude 2.1.322 | cold start ok | 1 attach | clean | recorded | 2026-11-18 |");
  assert.ok(inspectPage(bareTier).some((finding) => finding.includes("launcher-driven is recorded without a Tier")));
  const claims = inspectPage(seeded("## Not shown", "Claude used Realm with a real model.\n\n## Not shown"));
  assert.ok(claims.includes("EVID-03: the section says claude used Realm with a model"), claims.join("\n"));
});

// MCPA-01 and MCPA-02: the Q9 section of docs/integration/mcp.md holds the per-tool annotation table and the rules that say the hints
// are never a control. The table is parsed from the page and compared with the pins (test/support/mcp-annotation-pins.ts), so the
// documented values cannot drift from the code. Reads one file; no process starts and no network is used.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ANNOTATION_PINS, HINT_KEYS } from "../support/mcp-annotation-pins.js";

// The repository root, found the way host-support-matrix.test.ts finds it: from the compiled test file, three directories up.
const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const PAGE_PATH = join(REPO_ROOT, "docs", "integration", "mcp.md");
const BEGIN = "<!-- mcp-tool-annotations:begin -->";
const END = "<!-- mcp-tool-annotations:end -->";
const HEADER = ["Tool", "Title", ...HINT_KEYS, "Basis"];

function page(): string {
  return readFileSync(PAGE_PATH, "utf8");
}

function occurrences(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

// The text between the two markers, each present exactly once and in order.
function blockOf(text: string): string {
  assert.equal(occurrences(text, BEGIN), 1, `the page names ${BEGIN} exactly once`);
  assert.equal(occurrences(text, END), 1, `the page names ${END} exactly once`);
  const begin = text.indexOf(BEGIN);
  const end = text.indexOf(END);
  assert.ok(begin < end, "the begin marker comes before the end marker");
  return text.slice(begin + BEGIN.length, end);
}

function cellsOf(line: string): string[] {
  return line
    .split("|")
    .slice(1, -1)
    .map((cell) => cell.trim());
}

// Every way the table block differs from the pins; empty when it equals them. A pure function over text, so a test can mutate it.
function tableDifferences(block: string): string[] {
  const differences: string[] = [];
  const lines = block.split("\n").filter((line) => line.startsWith("|"));
  const header = cellsOf(lines[0] ?? "");
  if (header.join(" | ") !== HEADER.join(" | ")) {
    differences.push(`the header is ${header.join(" | ")}`);
  }
  const rows = lines.slice(2).map(cellsOf);
  const names = rows.map((row) => (row[0] ?? "").replaceAll("`", ""));
  const pinned = Object.keys(ANNOTATION_PINS);
  if (names.join(",") !== pinned.join(",")) {
    differences.push(`the tool rows are ${names.join(",")}, expected ${pinned.join(",")}`);
  }
  for (const row of rows) {
    const name = (row[0] ?? "").replaceAll("`", "");
    const pin = ANNOTATION_PINS[name];
    if (pin === undefined) {
      differences.push(`row ${name} is not a pinned tool`);
      continue;
    }
    if (row.length !== HEADER.length) {
      differences.push(`row ${name} has ${String(row.length)} cells`);
    }
    if (row[1] !== pin.title) {
      differences.push(`row ${name} title is ${String(row[1])}, expected ${pin.title}`);
    }
    HINT_KEYS.forEach((key, index) => {
      const cell = row[index + 2];
      if (cell !== "true" && cell !== "false") {
        differences.push(`row ${name} ${key} is ${String(cell)}, not true or false`);
      } else if (cell !== String(pin[key])) {
        differences.push(`row ${name} ${key} is ${cell}, expected ${String(pin[key])}`);
      }
    });
  }
  return differences;
}

void test("MCPA-02: the Q9 table equals the pins", () => {
  assert.deepEqual(tableDifferences(blockOf(page())), []);
});

void test("MCPA-02: a mutated docs row is reported", () => {
  const block = blockOf(page());
  const lines = block.split("\n");
  const execIndex = lines.findIndex((line) => line.startsWith("| `exec` |"));
  assert.ok(execIndex > 0, "the table has an exec row");
  // One hint cell flipped (the readOnlyHint of exec, the third cell).
  const flipped = [...lines];
  flipped[execIndex] = (flipped[execIndex] ?? "").replace("| Run command | false |", "| Run command | true |");
  assert.notEqual(flipped.join("\n"), block, "the flip changed the block");
  assert.ok(tableDifferences(flipped.join("\n")).some((message) => message.includes("exec readOnlyHint")));
  // One row removed.
  const removed = lines.filter((line) => !line.startsWith("| `retry` |"));
  assert.notEqual(removed.length, lines.length, "the removal changed the block");
  assert.ok(tableDifferences(removed.join("\n")).length > 0);
  // A title changed and a cell that is not a boolean.
  assert.ok(tableDifferences(block.replace("| Read file |", "| Read a file |")).some((message) => message.includes("row read title")));
  assert.ok(tableDifferences(block.replace("| Realm status | true |", "| Realm status | yes |")).some((message) => message.includes("not true or false")));
});

// The text of the Q9 section: from its heading to the next level 2 heading.
function q9Of(text: string): string {
  const start = text.indexOf("### Q9. Tool annotations");
  assert.ok(start >= 0, "the page has the Q9 heading");
  const end = text.indexOf("\n## ", start);
  assert.ok(end > start, "a level 2 heading follows Q9");
  return text.slice(start, end);
}

void test("MCPA-01: Q9 states the required facts", () => {
  const text = page();
  const q9 = q9Of(text);
  assert.ok(q9.includes("Read date: 2026-11-17."), "Q9 has the read date");
  for (const revision of ["2026-07-28", "2025-11-25", "2025-06-18"]) {
    assert.ok(q9.includes(`https://modelcontextprotocol.io/specification/${revision}/schema`), `the ${revision} schema URL`);
    assert.ok(q9.includes(`https://modelcontextprotocol.io/specification/${revision}/server/tools`), `the ${revision} tools URL`);
  }
  assert.ok(q9.includes("https://blog.modelcontextprotocol.io/posts/2026-03-16-tool-annotations/"), "the blog URL");
  for (const phrase of [
    "untrusted unless they come from trusted servers",
    "should never make tool use decisions",
    "human in the loop",
    "never a security control",
    "host-dependent",
  ]) {
    assert.ok(q9.includes(phrase), `Q9 says: ${phrase}`);
  }
  const q3Start = text.indexOf("### Q3.");
  const q3 = text.slice(q3Start, text.indexOf("### Q4.", q3Start));
  assert.ok(q3.includes("is Q9."), "Q3 points to Q9");
});

void test("MCPA-01: Q9 has no host-local path and no unescaped tag-like token", () => {
  const q9 = q9Of(page());
  // Outside code fences and outside the two markers (the markers are the only HTML Q9 may hold).
  let outside = q9.replace(BEGIN, "").replace(END, "");
  outside = outside
    .split("\n")
    .reduce<{ lines: string[]; fenced: boolean }>(
      (state, line) => {
        if (line.trimStart().startsWith("```")) {
          return { lines: state.lines, fenced: !state.fenced };
        }
        return state.fenced ? state : { lines: [...state.lines, line], fenced: false };
      },
      { lines: [], fenced: false },
    )
    .lines.join("\n");
  assert.equal(/<[A-Za-z/!]/.test(outside), false, "Q9 holds no raw angle-bracket tag; write &lt; and &gt;");
  for (const prefix of ["/home/", "/Users/", "/root/", "C:\\", "~/"]) {
    assert.equal(outside.includes(prefix), false, `Q9 holds no path starting ${prefix}`);
  }
});

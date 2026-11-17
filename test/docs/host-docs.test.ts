// TEST-HOST-07 (D-26-08): the four author-facing pages (the guide, the support matrix, the gaps page, the wave 1 boot matrix) name only paths that exist, link only
// to files that exist, leave no raw tag-like token outside code (the docs site compiler reads one as a tag), and are linked from the contract
// page, hosts.md and the README. The guide has its twelve sections and its two checklists. The repository's `check:docs` is the gate for
// host-local paths; this test names none. Reads files only: nothing is written and no process starts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// The repository root, found the way manifest.test.ts finds package.json: from the compiled test file, three directories up.
const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const INTEGRATION = join(REPO_ROOT, "docs", "integration");

const GUIDE = "writing-a-host-plugin.md";
const MATRIX = "host-support-matrix.md";
const GAPS = "host-plugin-gaps.md";
const BOOT = "wave1-boot-matrix.md";
const PAGES: readonly string[] = [GUIDE, MATRIX, GAPS, BOOT];

function read(path: string): string {
  return readFileSync(path, "utf8");
}

// The page without its fenced code blocks (a fence opens and closes on a line that starts with three backticks).
function withoutFences(text: string): string {
  const kept: string[] = [];
  let inFence = false;
  for (const line of text.split("\n")) {
    if (line.startsWith("```")) {
      inFence = !inFence;
    } else if (!inFence) {
      kept.push(line);
    }
  }
  return kept.join("\n");
}

function withoutComments(text: string): string {
  return text.replace(/<!--[\s\S]*?-->/g, "");
}

function codeSpans(text: string): string[] {
  return [...withoutFences(text).matchAll(/`([^`\n]+)`/g)].map((match) => match[1] ?? "");
}

const REPO_PATH = /^(?:src|test|docs|scripts|adapters|\.github|\.planning)\/\S*$/;

// A span that names a repository path: starts with a known root and a slash, no wildcard, no placeholder in capital letters.
function isRepoPath(span: string): boolean {
  return REPO_PATH.test(span) && !span.includes("*") && !/[A-Z]{2,}/.test(span);
}

for (const page of PAGES) {
  const path = join(INTEGRATION, page);

  void test(`TEST-HOST-07 ${page}: the file exists and has exactly one level-one heading`, () => {
    assert.ok(existsSync(path), `${page} exists`);
    const headings = withoutFences(read(path))
      .split("\n")
      .filter((line) => line.startsWith("# "));
    assert.equal(headings.length, 1, `${page} has one level-one heading, found ${String(headings.length)}`);
  });

  void test(`TEST-HOST-07 ${page}: every repository path in a code span exists`, (t) => {
    const planningArchived = !existsSync(join(REPO_ROOT, ".planning", "phases"));
    const missing: string[] = [];
    for (const span of codeSpans(read(path))) {
      if (!isRepoPath(span)) {
        continue;
      }
      if (planningArchived && span.startsWith(".planning/")) {
        t.diagnostic(`planning tree archived: path check skipped for ${span}`);
        continue;
      }
      if (!existsSync(join(REPO_ROOT, span))) {
        missing.push(span);
      }
    }
    assert.deepEqual(missing, [], `${page} names paths that do not exist`);
  });

  void test(`TEST-HOST-07 ${page}: every relative link resolves`, () => {
    const broken: string[] = [];
    for (const match of withoutFences(read(path)).matchAll(/\]\(([^)\s]+)\)/g)) {
      const target = match[1] ?? "";
      if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("#")) {
        continue;
      }
      const file = target.split("#")[0] ?? "";
      if (!existsSync(resolve(dirname(path), file))) {
        broken.push(target);
      }
    }
    assert.deepEqual(broken, [], `${page} links to files that do not exist`);
  });

  void test(`TEST-HOST-07 ${page}: no tag-like token is left outside code`, () => {
    const prose = withoutComments(withoutFences(read(path))).replace(/`[^`\n]*`/g, "");
    const tags = [...prose.matchAll(/<[A-Za-z/]/g)].map((match) => prose.slice(match.index, match.index + 24));
    assert.deepEqual(tags, [], `${page} has raw angle tokens: write them as the escaped form or as a capital placeholder`);
  });
}

function hasLinkTo(text: string, target: string): boolean {
  return text.includes(`](${target})`) || text.includes(`](${target}#`);
}

void test("TEST-HOST-07: the contract page and hosts.md link to the guide, the matrix, the gaps page and the wave 1 boot matrix", () => {
  for (const name of ["host-plugin-contract.md", "hosts.md"]) {
    const text = read(join(INTEGRATION, name));
    for (const page of PAGES) {
      assert.ok(hasLinkTo(text, page), `${name} links to ${page}`);
    }
  }
});

void test("TEST-HOST-07: the README links to the guide, the matrix, the gaps page and the wave 1 boot matrix", () => {
  const readme = read(join(REPO_ROOT, "README.md"));
  for (const page of PAGES) {
    assert.ok(hasLinkTo(readme, `docs/integration/${page}`), `README.md links to docs/integration/${page}`);
  }
});

void test("TEST-HOST-07: the guide links the matrix, the gaps page, the contract page and the deferred hosts page", () => {
  const guide = read(join(INTEGRATION, GUIDE));
  for (const target of [MATRIX, GAPS, "host-plugin-contract.md", "../hosts/snippets/deferred-hosts.md"]) {
    assert.ok(hasLinkTo(guide, target), `the guide links to ${target}`);
  }
});

// The section of the guide that starts at the heading with these leading words and runs to the next second-level heading.
function sectionOf(guide: string, leading: string): string {
  const lines = withoutFences(guide).split("\n");
  const start = lines.findIndex((line) => line.startsWith(`## ${leading}`));
  assert.ok(start !== -1, `the guide has a section that starts with "${leading}"`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith("## "));
  return rest.slice(0, end === -1 ? rest.length : end).join("\n");
}

void test("TEST-HOST-07: the guide has its twelve sections in order, the three tiers and two checklists of at least eight items", () => {
  const guide = read(join(INTEGRATION, GUIDE));
  const leading = [
    "What a host is",
    "Gather evidence",
    "Step 1",
    "Step 2",
    "Step 3",
    "Step 4",
    "Step 5",
    "Step 6",
    "Evidence tiers",
    "Enterprise baseline",
    "The pull request",
    "What never",
  ];
  const headings = withoutFences(guide)
    .split("\n")
    .filter((line) => line.startsWith("## "));
  let previous = -1;
  for (const words of leading) {
    const index = headings.findIndex((heading) => heading.startsWith(`## ${words}`));
    assert.ok(index > previous, `the guide has "${words}" after the section before it`);
    previous = index;
  }
  assert.equal(headings.length, leading.length, "the guide has exactly the twelve second-level sections");
  for (const tier of ["T1", "T2", "T3"]) {
    assert.ok(guide.includes(tier), `the guide names ${tier}`);
  }
  for (const words of ["Enterprise baseline", "The pull request"]) {
    const items = sectionOf(guide, words)
      .split("\n")
      .filter((line) => line.startsWith("- [ ] "));
    assert.ok(items.length >= 8, `${words}: ${String(items.length)} checklist items, at least 8 expected`);
  }
});

void test("TEST-HOST-07: the support matrix page has its two generated tables between its markers", () => {
  const text = read(join(INTEGRATION, MATRIX));
  const lines = text.split("\n");
  const begin = lines.indexOf("<!-- host-support-matrix:begin -->");
  const end = lines.indexOf("<!-- host-support-matrix:end -->");
  assert.ok(begin !== -1 && end > begin, "both markers are on a line of their own, begin first");
  const block = lines.slice(begin + 1, end).join("\n");
  assert.ok(block.includes("### Support") && block.includes("### Evidence"), "the block holds the Support and the Evidence table");
});

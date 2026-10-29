import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import {
  collectFiles,
  formatFinding,
  normalizeText,
  runCheck,
  scanDocument,
  splitParagraphs,
} from "./default-mode.mjs";

const ROOT = "tree";

// Readers over an in-memory tree: { "README.md": "text", "docs/a.md": "text" }.
function readersFor(files) {
  const paths = Object.keys(files).map((path) => join(ROOT, path));
  const directories = new Set();
  for (const path of paths) {
    for (let dir = dirname(path); dir !== "." && !directories.has(dir); dir = dirname(dir)) {
      directories.add(dir);
    }
  }
  return {
    readText: (path) => {
      const text = files[path.slice(ROOT.length + 1)];
      assert.notEqual(text, undefined, `unexpected read of ${path}`);
      return text;
    },
    isFile: (path) => paths.includes(path),
    readDirectory: (path) => {
      const children = new Map();
      for (const entry of [...paths, ...directories]) {
        if (dirname(entry) === path) {
          children.set(entry.slice(path.length + 1), directories.has(entry));
        }
      }
      return [...children].map(([name, directory]) => ({ name, directory }));
    },
  };
}

function check(files) {
  return runCheck([], { root: ROOT, ...readersFor(files) });
}

function phrasesOf(text) {
  return scanDocument("doc.md", text).map((finding) => finding.phrase);
}

// The old wording of the repository, quoted so the check proves it would have caught it.
const OLD_README_SENTENCE =
  "The default advisory mode does not contain: while the realm is disconnected, the Omp guard warns and allows host write and edit calls. Containment requires opting into fail-closed.";

test("fails on the old README sentence with file, paragraph line and the matched phrase", () => {
  const result = check({ "README.md": `# Realm\n\nIntro.\n\n${OLD_README_SENTENCE}\n` });
  assert.equal(result.code, 1);
  assert.equal(result.output, 'README.md:5: asserts advisory is the default: "default advisory"\n');
});

test("reports one line per finding across files", () => {
  const result = check({
    "README.md": "Advisory is the default.\n",
    "AGENTS.md": "Fine text.\n",
    "docs/policy-reference.md": "Intro.\n\nThe default stays `advisory`; use fail-closed for containment.\n",
  });
  assert.equal(result.code, 1);
  assert.deepEqual(result.output.trimEnd().split("\n"), [
    'README.md:1: asserts advisory is the default: "Advisory is the default"',
    'docs/policy-reference.md:3: asserts advisory is the default: "default stays advisory"',
  ]);
});

test("flags every phrase form that asserts advisory is the default", () => {
  const assertions = [
    ["Advisory is the default.", "Advisory is the default"],
    ["Advisory stays the default for now.", "Advisory stays the default"],
    ["Advisory remains the default.", "Advisory remains the default"],
    ["Advisory mode is used as the default.", "Advisory mode is used as the default"],
    ["Advisory applies by default.", "Advisory applies by default"],
    ["The default is advisory.", "default is advisory"],
    ["The default mode stays advisory.", "default mode stays advisory"],
    ["The default remains `advisory`.", "default remains advisory"],
    ["Realm ships an advisory default.", "advisory default"],
    ["Realm runs in the default advisory mode.", "default advisory"],
    ["The `mode` key defaults to advisory.", "defaults to advisory"],
    ["A policy without `mode` default to `advisory`.", "default to advisory"],
    ["Advisory mode (the default) warns.", "Advisory mode (the default)"],
    ["- **Default:** `\"advisory\"` (the `mode` property)", "Default: advisory"],
    ["Default: advisory", "Default: advisory"],
    ["**Policy default: advisory, unchanged.**", "default: advisory"],
    ["| Key | Default |\n| --- | --- |\n| mode | advisory |", "Default column: advisory"],
    ["| Name | Value |\n| Default | advisory |", "Default | advisory"],
  ];
  for (const [text, phrase] of assertions) {
    assert.deepEqual(phrasesOf(text), [phrase], text);
  }
});

test("collapses whitespace so a wrapped sentence is still found, and reports the paragraph start", () => {
  const text = "Some opening text.\n\nThe mode\n  is advisory  by\ndefault when the key\nis missing.\n";
  const findings = scanDocument("doc.md", text);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].line, 3);
  assert.equal(findings[0].phrase, "advisory by default");
});

test("passes statements that are true under the fail-closed default", () => {
  const truths = [
    "Advisory requires the explicit value `\"mode\": \"advisory\"`.",
    "Explicit advisory warns and allows the write while the realm is not active.",
    "The old default was advisory.",
    "The previous default advisory mode is gone.",
    "Previously advisory, the mode is now fail-closed.",
    "Advisory is the opt-in; the default is fail-closed.",
    "Advisory is the explicit opt-in, not the default.",
    "Advisory is no longer the default.",
    "Advisory is never the default.",
    "The default is not advisory.",
    "The default is fail-closed, and advisory is an explicit opt-in.",
    "Advisory is allowed, fail-closed is the default.",
    "The default mode is fail-closed. Advisory needs `\"mode\": \"advisory\"`.",
    "A policy with no `mode` loads as fail-closed; the default for advisory write locks is unrelated.",
    "- **Default:** `\"fail-closed\"` (the `mode` property)",
    "| Key | Default |\n| --- | --- |\n| mode | fail-closed |",
    "| Name | Value |\n| Default | fail-closed |",
    "Under advisory policy the write proceeds with a warning.",
    "OQ-P4-08 holds for explicit advisory: advisory writes proceed with a warning after the wait.",
    "Advisory write locks in `fs/` are unrelated to the policy mode.",
  ];
  for (const text of truths) {
    assert.deepEqual(phrasesOf(text), [], text);
  }
});

test("sentence and clause bounds keep far-apart words from combining", () => {
  // advisory ... is ... default in different sentences or after a semicolon is not one assertion.
  assert.deepEqual(phrasesOf("Advisory warns. The next paragraph is about the default."), []);
  assert.deepEqual(phrasesOf("Advisory warns; this is the default for something else."), []);
  assert.deepEqual(phrasesOf("The default is fail-closed. Advisory is explicit."), []);
});

test("an exempt first match does not hide a real assertion later in the paragraph", () => {
  const text = "Advisory is not the default. Advisory is the default for the demo.";
  assert.deepEqual(phrasesOf(text), ["Advisory is the default"]);
});

test("normalizeText strips markup and collapses whitespace", () => {
  assert.equal(normalizeText("  The `\"advisory\"`\n **mode**\t  works "), "The advisory mode works");
});

test("splitParagraphs returns 1-based start lines and keeps table rows together", () => {
  const paragraphs = splitParagraphs("a\nb\n\n\nc\n| x |\n| y |\n");
  assert.deepEqual(
    paragraphs.map(({ line, text }) => [line, text]),
    [
      [1, "a\nb"],
      [5, "c\n| x |\n| y |"],
    ],
  );
});

test("scans the listed entry points, docs outside docs/specs and the site index only", () => {
  const bad = "Advisory is the default.\n";
  const files = {
    "README.md": "ok\n",
    "AGENTS.md": "ok\n",
    "CONTRIBUTING.md": "ok\n",
    "SECURITY.md": "ok\n",
    "CHANGELOG.md": bad,
    ".planning/PROJECT.md": bad,
    "docs/specs/realm-spec.xml": bad,
    "docs/specs/notes.md": bad,
    "docs/policy-reference.md": "ok\n",
    "docs/integration/omp.md": "ok\n",
    "docs/hosts/snippets/omp.md": "ok\n",
    "site/content/index.md": "ok\n",
    "site/content/synced-copy.md": bad,
  };
  assert.deepEqual(collectFiles(ROOT, readersFor(files)), [
    "AGENTS.md",
    "CONTRIBUTING.md",
    "README.md",
    "SECURITY.md",
    "docs/hosts/snippets/omp.md",
    "docs/integration/omp.md",
    "docs/policy-reference.md",
    "site/content/index.md",
  ]);
  const result = check(files);
  assert.equal(result.code, 0);
  assert.equal(result.output, "check:default-mode: 8 files scanned, no advisory-default claim\n");
});

test("flags a claim in each scanned location", () => {
  const bad = "The default is advisory.\n";
  for (const file of ["README.md", "AGENTS.md", "CONTRIBUTING.md", "SECURITY.md", "docs/integration/omp.md", "docs/a/b/c.md", "site/content/index.md"]) {
    const result = check({ [file]: bad });
    assert.equal(result.code, 1, file);
    assert.match(result.output, new RegExp(`^${file.replaceAll(".", "\\.")}:1: `), file);
  }
});

test("an exemption word in another clause does not excuse a default claim", () => {
  const claims = [
    ["Fail-closed is opt-in, and advisory is the default.", "advisory is the default"],
    ["Advisory is the default; fail-closed is explicit.", "Advisory is the default"],
    ["The default is advisory, not fail-closed.", "default is advisory"],
    ["By default the mode is advisory (an explicit fail-closed is opt-in).", "default the mode is advisory"],
    ["Fail-closed requires the explicit value, but advisory is the default mode.", "advisory is the default"],
    ["The mode defaults to advisory. Fail-closed is opt-in.", "defaults to advisory"],
    ["Advisory mode, the default, warns and allows the write.", "Advisory mode, the default"],
    ["- Fail-closed needs the explicit value\n- Advisory is the default", "Advisory is the default"],
  ];
  for (const [text, phrase] of claims) {
    assert.deepEqual(scanDocument("README.md", text).map((finding) => finding.phrase), [phrase], text);
  }
});

test("words that qualify the claim itself exempt it", () => {
  const truths = [
    "Advisory is no longer the default.",
    "The default was advisory before 0.3.5.",
    "Advisory requires the explicit value.",
    "Advisory is opt-in; the default is fail-closed.",
    "Previously the default was advisory.",
    "explicit advisory mode",
    "The default is fail-closed; advisory is the explicit opt-in.",
    "The default is advisory until 0.3.5.",
    "Advisory, which used to be the default, is now explicit.",
    "The old default advisory mode is gone.",
  ];
  for (const text of truths) {
    assert.deepEqual(scanDocument("README.md", text), [], text);
  }
});

test("a tree with no scanned files passes with zero files", () => {
  const result = check({ "CHANGELOG.md": "Advisory is the default.\n" });
  assert.deepEqual(result, { code: 0, output: "check:default-mode: 0 files scanned, no advisory-default claim\n" });
});

test("rejects unknown arguments with usage exit code 2", () => {
  const result = runCheck(["--bogus"], { root: ROOT, ...readersFor({}) });
  assert.equal(result.code, 2);
  assert.match(result.output, /usage/);
});

test("formatFinding names file, line and phrase", () => {
  assert.equal(
    formatFinding({ file: "README.md", line: 7, phrase: "advisory default" }),
    'README.md:7: asserts advisory is the default: "advisory default"',
  );
});

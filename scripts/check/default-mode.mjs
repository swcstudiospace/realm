import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Guards DEF-02: the default policy mode is fail-closed (decision D4), so no published document may say that
// advisory is the default. The check reads prose paragraph by paragraph and reports every phrase that asserts it.
//
// Scanned: README.md, AGENTS.md, CONTRIBUTING.md, SECURITY.md, every Markdown file under docs/ except docs/specs/,
// and site/content/index.md. Not scanned: CHANGELOG.md (release history), .planning/ (planning records) and
// docs/specs/ (the read-only spec, whose old line D4 supersedes by recorded decision).

const DEFAULT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

export const SCANNED_FILES = ["README.md", "AGENTS.md", "CONTRIBUTING.md", "SECURITY.md", "site/content/index.md"];
export const SCANNED_DIRECTORIES = ["docs"];
export const EXCLUDED_DIRECTORIES = ["docs/specs"];

// Clauses end at a sentence end, a semicolon, a comma, a colon, a parenthesis, a dash, or one of the words
// and/but/while/whereas/so. A gap between two key words of a pattern never crosses one, so a pattern matches inside
// one clause, and the gap is short.
const CLAUSE_BREAK_WORDS = "and|but|while|whereas|so";
const GAP = `(?:(?!\\s(?:${CLAUSE_BREAK_WORDS})\\s)[^.!?;,:()\\u2014\\u2013]){0,80}?`;
const CLAUSE_DELIMITER = new RegExp(`[,;:()\\u2014\\u2013]|\\s(?:${CLAUSE_BREAK_WORDS})\\s|[.!?](?=\\s|$)`, "gi");

// Phrases that assert advisory is the default. Matched against paragraph text with whitespace collapsed and with
// backticks, asterisks and double quotes removed, so `"advisory"` and **advisory** read as advisory.
export const ASSERTION_PATTERNS = [
  { name: "advisory ... is/stays/remains/as/by ... default", regex: new RegExp(`\\badvisory\\b${GAP}\\b(?:is|stays|remains|as|by)\\b${GAP}\\bdefault\\b`, "gi") },
  { name: "default ... is/stays/remains ... advisory", regex: new RegExp(`\\bdefault\\b${GAP}\\b(?:is|stays|remains)\\b${GAP}\\badvisory\\b`, "gi") },
  { name: "advisory (the default)", regex: new RegExp(`\\badvisory\\b[^.!?;,()]{0,40}\\((?:the |it is the )?default\\)`, "gi") },
  { name: "advisory, the default", regex: /\badvisory(?: mode)?,\s*(?:which is |that is )?(?:the |our )?default\b/gi },
  { name: "advisory default / default advisory", regex: /\b(?:advisory\s+defaults?|defaults?\s+advisory)\b/gi },
  { name: "defaults to advisory", regex: /\bdefaults?\s+to\s+advisory\b/gi },
  { name: "Default: advisory", regex: /\bdefault\s*:\s*advisory\b/gi },
  { name: "Default | advisory", regex: /\bdefault\s*\|\s*advisory\b/gi },
];

// True statements under the new default read like the false ones ("advisory is the opt-in, not the default",
// "advisory is no longer the default", "the previous default advisory mode"). A match is dropped only when a word
// that qualifies THE MATCHED CLAIM says so. The words that count are the claim's own text, up to six words before it
// inside the same clause (BEFORE_EXEMPTION: a negation, a reference to the past, the explicit or opt-in nature of
// advisory), and up to six words right after it inside the same clause (AFTER_EXEMPTION: "was", "until", "no
// longer"). A word in another clause never exempts the claim, and naming fail-closed is no exemption either:
// "Fail-closed is opt-in, and advisory is the default." is flagged because "opt-in" belongs to the first clause.
// "Previously advisory", "explicit advisory", "advisory requires the explicit value" and "the old default was
// advisory" never match a pattern at all, because none puts is/stays/remains/as/by or a default marker between
// advisory and "default" in that order.
const EXEMPTION_WORDS = 6;
export const BEFORE_EXEMPTION =
  /\b(?:no longer|not|never|isn't|aren't|wasn't|was|were|used to|previously|previous|formerly|former|old|older|until|before|explicit|explicitly|opt-in|opt in|opts in|requires?|must set|unless|instead of|rather than|unlike)\b/i;
export const AFTER_EXEMPTION = /\b(?:previously|before|until|was|were|used to be|no longer|not any more|anymore)\b/i;

export function normalizeText(text) {
  // A list item starts a new clause even when it carries no punctuation.
  return text.replace(/\n\s*(?:[-*+]|\d+[.)])\s+/g, " ; ").replace(/[`*"]/g, "").replace(/\s+/g, " ").trim();
}

// Splits text into paragraphs (blocks separated by blank lines), each with the 1-based line of its first line.
export function splitParagraphs(text) {
  const paragraphs = [];
  let current = [];
  let start = 0;
  const lines = text.split(/\r?\n/);
  const flush = () => {
    if (current.length > 0) {
      paragraphs.push({ line: start, text: current.join("\n") });
      current = [];
    }
  };
  lines.forEach((line, index) => {
    if (line.trim() === "") {
      flush();
      return;
    }
    if (current.length === 0) {
      start = index + 1;
    }
    current.push(line);
  });
  flush();
  return paragraphs;
}

function lastWords(text, count) {
  return text.trim().split(/\s+/).slice(-count).join(" ");
}

function firstWords(text, count) {
  return text.trim().split(/\s+/).slice(0, count).join(" ");
}

// The clause that holds the match: from the end of the last delimiter before it to the start of the first delimiter
// after it. Delimiters inside the match (patterns that span a colon or parenthesis) belong to the claim itself.
function clauseAround(text, start, end) {
  let clauseStart = 0;
  let clauseEnd = text.length;
  for (const delimiter of text.matchAll(CLAUSE_DELIMITER)) {
    const delimiterEnd = delimiter.index + delimiter[0].length;
    if (delimiterEnd <= start) {
      clauseStart = delimiterEnd;
    } else if (delimiter.index >= end) {
      clauseEnd = delimiter.index;
      break;
    }
  }
  return { before: text.slice(clauseStart, start), after: text.slice(end, clauseEnd) };
}

export function isExempt(text, match) {
  const { before, after } = clauseAround(text, match.index, match.index + match[0].length);
  return (
    BEFORE_EXEMPTION.test(`${lastWords(before, EXEMPTION_WORDS)} ${match[0]}`) ||
    AFTER_EXEMPTION.test(firstWords(after, EXEMPTION_WORDS))
  );
}

function matchesOf(pattern, text) {
  const found = [];
  const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
  let match = regex.exec(text);
  while (match !== null) {
    if (isExempt(text, match)) {
      // Retry one character later: a shorter span inside an exempt one may still be a real assertion.
      regex.lastIndex = match.index + 1;
    } else {
      found.push(match[0]);
    }
    match = regex.exec(text);
  }
  return found;
}

function tableCells(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|")) {
    return undefined;
  }
  return trimmed.replace(/^\||\|$/g, "").split("|").map((cell) => normalizeText(cell));
}

// A Markdown table whose header names a "Default" column: report each row whose Default cell is advisory.
function tableDefaultColumnFindings(paragraph) {
  const rows = paragraph.text.split(/\r?\n/).map(tableCells);
  const header = rows[0];
  if (header === undefined) {
    return [];
  }
  const column = header.findIndex((cell) => /^default$/i.test(cell));
  if (column < 0) {
    return [];
  }
  const found = [];
  for (const cells of rows.slice(1)) {
    const cell = cells?.[column];
    if (cell !== undefined && /^advisory\b/i.test(cell) && !BEFORE_EXEMPTION.test(cell) && !AFTER_EXEMPTION.test(cell)) {
      found.push(`Default column: ${cell}`);
    }
  }
  return found;
}

// Findings for one document: [{ file, line, phrase }], with line the first line of the paragraph.
export function scanDocument(file, text) {
  const findings = [];
  for (const paragraph of splitParagraphs(text)) {
    const normalized = normalizeText(paragraph.text);
    const phrases = new Set();
    for (const pattern of ASSERTION_PATTERNS) {
      for (const phrase of matchesOf(pattern, normalized)) {
        phrases.add(phrase);
      }
    }
    for (const phrase of tableDefaultColumnFindings(paragraph)) {
      phrases.add(phrase);
    }
    for (const phrase of phrases) {
      findings.push({ file, line: paragraph.line, phrase });
    }
  }
  return findings;
}

export function formatFinding({ file, line, phrase }) {
  return `${file}:${line}: asserts advisory is the default: "${phrase}"`;
}

function isExcluded(relativePath) {
  return EXCLUDED_DIRECTORIES.some((dir) => relativePath === dir || relativePath.startsWith(`${dir}/`));
}

const REAL_READERS = {
  readText: (path) => readFileSync(path, "utf8"),
  isFile: (path) => {
    try {
      return statSync(path).isFile();
    } catch (error) {
      if (error.code === "ENOENT") {
        return false;
      }
      throw error;
    }
  },
  readDirectory: (path) => {
    try {
      return readdirSync(path, { withFileTypes: true }).map((entry) => ({ name: entry.name, directory: entry.isDirectory() }));
    } catch (error) {
      if (error.code === "ENOENT") {
        return [];
      }
      throw error;
    }
  },
};

// Root-relative POSIX paths of every file to scan, sorted. Reads only through the injected readers.
export function collectFiles(root, readers) {
  const files = [];
  for (const file of SCANNED_FILES) {
    if (readers.isFile(join(root, file))) {
      files.push(file);
    }
  }
  const walk = (relativeDirectory) => {
    if (isExcluded(relativeDirectory)) {
      return;
    }
    for (const entry of readers.readDirectory(join(root, relativeDirectory))) {
      const relativePath = `${relativeDirectory}/${entry.name}`;
      if (entry.directory) {
        walk(relativePath);
      } else if (entry.name.endsWith(".md") && !isExcluded(relativePath)) {
        files.push(relativePath);
      }
    }
  };
  for (const directory of SCANNED_DIRECTORIES) {
    walk(directory);
  }
  return files.sort();
}

export function findDefaultModeClaims(root, readers) {
  const findings = [];
  for (const file of collectFiles(root, readers)) {
    findings.push(...scanDocument(file, readers.readText(join(root, file))));
  }
  return findings;
}

// Runs the check. argv accepts only --root <dir>. Resolves to { code, output }: code 0 with a one-line summary, or
// code 1 with one line per finding. overrides may replace root and the readers (readText, isFile, readDirectory).
export function runCheck(argv = [], overrides = {}) {
  const readers = { ...REAL_READERS, ...overrides };
  let root = overrides.root ?? DEFAULT_ROOT;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--root" && argv[index + 1] !== undefined) {
      root = resolve(argv[index + 1]);
      index += 1;
    } else {
      return { code: 2, output: `check:default-mode usage: default-mode.mjs [--root <dir>] (got ${argv[index]})\n` };
    }
  }
  const findings = findDefaultModeClaims(root, readers);
  if (findings.length === 0) {
    return { code: 0, output: `check:default-mode: ${collectFiles(root, readers).length} files scanned, no advisory-default claim\n` };
  }
  return { code: 1, output: `${findings.map(formatFinding).join("\n")}\n` };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { code, output } = runCheck(process.argv.slice(2));
  (code === 0 ? process.stdout : process.stderr).write(output);
  process.exitCode = code;
}

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

// A gap between two key words stays inside one clause: it holds no sentence end or semicolon, and it is short.
const GAP = "[^.!?;]{0,80}?";

// Phrases that assert advisory is the default. Matched against paragraph text with whitespace collapsed and with
// backticks, asterisks and double quotes removed, so `"advisory"` and **advisory** read as advisory.
export const ASSERTION_PATTERNS = [
  { name: "advisory ... is/stays/remains/as/by ... default", regex: new RegExp(`\\badvisory\\b${GAP}\\b(?:is|stays|remains|as|by)\\b${GAP}\\bdefault\\b`, "gi") },
  { name: "default ... is/stays/remains ... advisory", regex: new RegExp(`\\bdefault\\b${GAP}\\b(?:is|stays|remains)\\b${GAP}\\badvisory\\b`, "gi") },
  { name: "advisory (the default)", regex: new RegExp(`\\badvisory\\b[^.!?;()]{0,40}\\((?:the |it is the )?default\\)`, "gi") },
  { name: "advisory default / default advisory", regex: /\b(?:advisory\s+defaults?|defaults?\s+advisory)\b/gi },
  { name: "defaults to advisory", regex: /\bdefaults?\s+to\s+advisory\b/gi },
  { name: "Default: advisory", regex: /\bdefault\s*:\s*advisory\b/gi },
  { name: "Default | advisory", regex: /\bdefault\s*\|\s*advisory\b/gi },
];

// True statements under the new default read like the false ones ("advisory is the opt-in, not the default",
// "the old default was advisory", "advisory requires the explicit value"). A match is therefore dropped when its own
// text, or the few words before it in the same clause ("the previous default advisory mode"), carries a word that
// turns it into the true statement: a negation, a reference to the past, the explicit or opt-in nature of advisory,
// or fail-closed named inside the same clause (the default is then fail-closed).
// "previously advisory", "explicit advisory" and "advisory requires the explicit value" never match a pattern at
// all, because none of them puts is/stays/remains/as/by or a default marker between advisory and "default".
const LOOKBEHIND = 30;
export const EXEMPTION =
  /\b(?:not|no longer|never|isn't|aren't|wasn't|was|were|previously|previous|formerly|former|old|older|used to|once|explicit|explicitly|opt-in|opt in|opts|opt|instead|rather than|unlike|requires?|fail-closed)\b/i;

export function normalizeText(text) {
  return text.replace(/[`*"]/g, "").replace(/\s+/g, " ").trim();
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

function isExempt(text, match) {
  const clauseStart = Math.max(text.lastIndexOf(".", match.index), text.lastIndexOf("!", match.index), text.lastIndexOf("?", match.index), text.lastIndexOf(";", match.index)) + 1;
  const before = text.slice(Math.max(clauseStart, match.index - LOOKBEHIND), match.index);
  return EXEMPTION.test(`${before} ${match[0]}`);
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
    if (cell !== undefined && /^advisory\b/i.test(cell) && !EXEMPTION.test(cell)) {
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

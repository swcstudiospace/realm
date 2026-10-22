import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

const TEXT_EXTENSIONS = [".md", ".svg", ".json", ".yml", ".yaml", ".txt", ".xml"];
const SKIPPED_DIRECTORIES = new Set(["node_modules", "dist", ".git"]);

const HOST_PATH_PATTERNS = [
  /\/root\/[A-Za-z0-9._-]+/g,
  /\/tmp\/[A-Za-z0-9._-]+/g,
  /\/Users\/[A-Za-z0-9._-]+/g,
  /\/home\/[A-Za-z0-9._-]+\//g,
];

// Each entry is a root-relative file or directory, or { path, extensions }.
// Plain strings accept every text extension; assets accepts only SVG.
const DEFAULT_INPUTS = [
  "README.md",
  "CHANGELOG.md",
  "AGENTS.md",
  "CLAUDE.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "docs",
  ".planning",
  ".github",
  { path: "assets", extensions: [".svg"] },
];

function normalizeInput(input) {
  if (typeof input === "string") {
    return { path: input, extensions: TEXT_EXTENSIONS };
  }
  return { path: input.path, extensions: input.extensions ?? TEXT_EXTENSIONS };
}

async function statIfExists(path) {
  try {
    return await stat(path);
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function collectFiles(absolutePath, extensions, found) {
  const info = await statIfExists(absolutePath);
  if (info === null) {
    return;
  }
  if (info.isFile()) {
    if (extensions.includes(extname(absolutePath))) {
      found.push(absolutePath);
    }
    return;
  }
  if (!info.isDirectory()) {
    return;
  }
  const entries = await readdir(absolutePath, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (SKIPPED_DIRECTORIES.has(entry.name)) {
      continue;
    }
    await collectFiles(join(absolutePath, entry.name), extensions, found);
  }
}

function displayPath(root, file) {
  return relative(root, file).split(sep).join("/");
}

function scanText(text, file) {
  const hits = [];
  text.split(/\r?\n/).forEach((lineText, index) => {
    for (const pattern of HOST_PATH_PATTERNS) {
      for (const match of lineText.matchAll(pattern)) {
        hits.push({ file, line: index + 1, column: match.index + 1, match: match[0] });
      }
    }
  });
  return hits.sort((a, b) => a.line - b.line || a.column - b.column);
}

export async function findHostPaths({ root = DEFAULT_ROOT, files = DEFAULT_INPUTS } = {}) {
  const hits = [];
  for (const input of files) {
    const { path, extensions } = normalizeInput(input);
    const found = [];
    await collectFiles(resolve(root, path), extensions, found);
    for (const file of found) {
      const text = await readFile(file, "utf8");
      hits.push(...scanText(text, displayPath(root, file)));
    }
  }
  return hits;
}

async function main() {
  const hits = await findHostPaths({ root: DEFAULT_ROOT });
  if (hits.length === 0) {
    console.log("host paths: ok");
    return 0;
  }
  for (const hit of hits) {
    console.log(`${hit.file}:${hit.line}:${hit.column}: ${hit.match}`);
  }
  return 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}

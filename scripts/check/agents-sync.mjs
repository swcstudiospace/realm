import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

const REQUIRED_AGENTS_HEADINGS = [
  "## Commands",
  "## Versioning and release",
  "## Merge and release flow",
];
const CLAUDE_IMPORT = "@AGENTS.md";
const FORBIDDEN_CLAUDE_HEADING = "## Commands";

async function readIfExists(path) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function splitLines(text) {
  return text.split(/\r?\n/).map((line) => line.trim());
}

function countLines(lines, expected) {
  return lines.filter((line) => line === expected).length;
}

export async function checkAgentsSync({ root = DEFAULT_ROOT } = {}) {
  const problems = [];

  const agents = await readIfExists(join(root, "AGENTS.md"));
  if (agents === null) {
    problems.push("AGENTS.md is missing");
  } else {
    const lines = splitLines(agents);
    for (const heading of REQUIRED_AGENTS_HEADINGS) {
      const count = countLines(lines, heading);
      if (count !== 1) {
        problems.push(`AGENTS.md must contain "${heading}" exactly once (found ${count})`);
      }
    }
  }

  const claude = await readIfExists(join(root, "CLAUDE.md"));
  if (claude === null) {
    problems.push("CLAUDE.md is missing");
  } else {
    const lines = splitLines(claude);
    if (countLines(lines, CLAUDE_IMPORT) === 0) {
      problems.push(`CLAUDE.md must contain a line "${CLAUDE_IMPORT}"`);
    }
    if (countLines(lines, FORBIDDEN_CLAUDE_HEADING) > 0) {
      problems.push(`CLAUDE.md must not contain "${FORBIDDEN_CLAUDE_HEADING}"`);
    }
  }

  return problems;
}

async function main() {
  const problems = await checkAgentsSync({ root: DEFAULT_ROOT });
  if (problems.length === 0) {
    console.log("agents sync: ok");
    return 0;
  }
  for (const problem of problems) {
    console.error(problem);
  }
  return 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}

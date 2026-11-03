// Module size ratchet (Q0-002). Builtins only. Every src/**/*.ts file is limited to LINE_LIMIT newline-terminated
// lines. A file over the limit must be on the allowlist, at or below its recorded ceiling. An allowlisted file that
// is at or under the limit is stale and fails, so the allowlist shrinks as the splits land.
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ALLOWLIST_PATH = "scripts/check/module-size-allowlist.json";

export const LINE_LIMIT = 1000;

// Given { file, count } entries and an allowlist of { [file]: ceiling }, returns one violation per file that breaks
// the ratchet. Each violation carries its file, its count (null for an absent file), and a reason: "over-limit" for
// an unlisted file above the limit, "grew" for an allowlisted file above its ceiling, and "stale-allowlist" for an
// allowlisted file at or under the limit or absent from the file list, so a split that deletes or renames its target
// must remove the entry.
export function checkModuleSizes({ files, limit, allowlist }) {
  const violations = [];
  for (const { file, count } of files) {
    const listed = Object.hasOwn(allowlist, file);
    if (listed && count <= limit) {
      violations.push({ file, count, reason: "stale-allowlist", ceiling: allowlist[file], limit });
    } else if (listed && count > allowlist[file]) {
      violations.push({ file, count, reason: "grew", ceiling: allowlist[file], limit });
    } else if (!listed && count > limit) {
      violations.push({ file, count, reason: "over-limit", limit });
    }
  }
  const present = new Set(files.map(({ file }) => file));
  for (const file of Object.keys(allowlist)) {
    if (!present.has(file)) {
      violations.push({ file, count: null, reason: "stale-allowlist", ceiling: allowlist[file], limit });
    }
  }
  return violations;
}

// The number of newline bytes, which is what wc -l reports.
export function countLines(buffer) {
  let count = 0;
  for (const byte of buffer) {
    if (byte === 0x0a) count += 1;
  }
  return count;
}

function sourceFiles(root) {
  return readdirSync(join(root, "src"), { recursive: true })
    .map((entry) => entry.split(sep).join("/"))
    .filter((entry) => entry.endsWith(".ts"))
    .sort()
    .map((entry) => `src/${entry}`);
}

function main(root = DEFAULT_ROOT) {
  const files = sourceFiles(root).map((file) => ({
    file,
    count: countLines(readFileSync(join(root, file))),
  }));
  const allowlist = JSON.parse(readFileSync(join(root, ALLOWLIST_PATH), "utf8"));
  const violations = checkModuleSizes({ files, limit: LINE_LIMIT, allowlist });
  if (violations.length === 0) {
    console.log(`module size: ${String(files.length)} files checked, no violations`);
    return 0;
  }
  for (const violation of violations) {
    const detail =
      violation.count === null
        ? "file not found; remove its allowlist entry"
        : violation.reason === "over-limit"
          ? `${String(violation.count)} lines exceeds the ${String(violation.limit)}-line limit and is not allowlisted`
          : violation.reason === "grew"
            ? `${String(violation.count)} lines exceeds its allowlisted ceiling of ${String(violation.ceiling)}`
            : `${String(violation.count)} lines is at or under the ${String(violation.limit)}-line limit; remove its allowlist entry`;
    console.error(`module size: ${violation.file}: ${violation.reason}: ${detail}`);
  }
  return 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}

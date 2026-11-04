// Export usage gate (Q0-007, D-1306). It fails on a src export that no other file imports:
//   self-only         only its own file uses it, so `export` can be dropped;
//   test-only         only test files use it. D-1306 keeps those as documented seams, so they pass only when the
//                     explicit allowlist (export-usage-allowlist.json) names them with a reason.
// Forwarded re-exports, public-signature exports and entries the analysis cannot classify are not failures: they are
// public surface, a sibling's signature, or a resolution gap the analysis reports itself. An allowlist entry that matches
// no export of a failing class is stale and fails the gate, so a removed or re-used seam cannot stay listed. The classes come from export-usage.mjs.
//
// Usage: export-usage-gate.mjs. Exit 0 when every failing export is allowlisted and no entry is stale, 1 otherwise.
// It is not in check:gates until the findings it reports are resolved (phase 20 record, HELD).

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { analyze, listTypeScript } from "./export-usage.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const ALLOWLIST_FILE = "scripts/check/export-usage-allowlist.json";
// public-signature is not a failure: a sibling export's signature names it, so it is public API (export-usage.mjs:27-31).
export const FAILING_CLASSES = Object.freeze(["self-only", "test-only"]);

function keyOf(file, name) {
  return `${file}#${name}`;
}

// `allowlist` is [{ file, name, reason }]. Returns { failures, stale } with the failing entries and the allowlist
// entries that no longer name a failing export.
export function evaluate(files, allowlist) {
  const { entries } = analyze(files);
  const allowed = new Set(allowlist.map((item) => keyOf(item.file, item.name)));
  const failing = entries.filter((entry) => entry.file.startsWith("src/") && FAILING_CLASSES.includes(entry.class));
  const failingKeys = new Set(failing.map((entry) => keyOf(entry.file, entry.name)));
  const failures = failing.filter((entry) => !allowed.has(keyOf(entry.file, entry.name)));
  const stale = allowlist.filter((item) => !failingKeys.has(keyOf(item.file, item.name)));
  return { failures, stale, allowlisted: failing.length - failures.length };
}

// Runs the gate on a source tree. The tree and the allowlist can be injected; the defaults read the package root.
export function runGate(options = {}) {
  const root = options.root ?? ROOT;
  const files = options.files ?? listTypeScript(root);
  const allowlist =
    options.allowlist ?? JSON.parse(readFileSync(join(root, ALLOWLIST_FILE), "utf8")).allowed;
  const { failures, stale, allowlisted } = evaluate(files, allowlist);
  const lines = [];
  for (const entry of failures) {
    lines.push(`FAIL ${entry.file}:${entry.line} ${entry.name} (${entry.class}) has no importer outside ${entry.file}`);
  }
  for (const item of stale) {
    lines.push(`STALE allowlist entry ${keyOf(item.file, item.name)}: it names no failing export; remove it`);
  }
  lines.push(
    `export-usage gate: ${failures.length} failing export(s), ${allowlisted} allowlisted seam(s), ${stale.length} stale allowlist entr${stale.length === 1 ? "y" : "ies"}`,
  );
  return { code: failures.length === 0 && stale.length === 0 ? 0 : 1, output: `${lines.join("\n")}\n` };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { code, output } = runGate();
  (code === 0 ? process.stdout : process.stderr).write(output);
  process.exitCode = code;
}

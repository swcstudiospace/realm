// The `toml-table` recipe: Realm owns one TOML table of a host file, located by its exact header line. No marker is written.
//
// Why no markers: Codex rewrites config.toml with a comment-dropping TOML editor (observed 2026-11-17, codex-cli 0.154.0). After
// `codex mcp add other` the `# BEGIN` line was gone and the `# END` line was left behind; after `codex mcp remove realm` the table was
// gone and the `# END` line stayed. The table text itself is kept byte for byte. So ownership is the table and nothing around it.
//
// The owned text is the header line and its key lines, each ended by "\n" (carriage returns are not part of it, so a CRLF file and an
// LF file hold the same owned text). A comment or blank line inside the table makes it different, hence not owned.
//
//   install    absent: append the table, after one blank line when the file is non-empty and does not already end in one. Present with
//              exactly the owned text and owned by the receipt: no-op. Present with the text the receipt owns but not the recipe's: the
//              recipe's text replaces it. Anything else (different text, a second header, a subtable, a dotted or inline definition)
//              is foreign-content; a header the scanner cannot read is unparseable.
//   status     owned part absent: missing. Equal to the receipt's hash: ok. Anything else: drifted.
//   uninstall  the table is removed, with the blank line Realm added, only when its hash equals the receipt's. Gone already (for
//              instance `codex mcp remove realm`): nothing to do, and the receipt is deleted. Changed: drifted.
//
// Everything else in the file stays byte for byte, in the line ending the file already uses.

import { makeRealmError } from "../core/errors.js";
import type { ReceiptEntry } from "./receipt.js";
import {
  currentOf,
  detectEol,
  dirCleanup,
  entryFlags,
  HostRefusal,
  makeEntry,
  missingDirsFor,
  noopChange,
  priorEntry,
  removeFileChange,
  requireRelPath,
  sha256Text,
  writeChange,
  type PlanState,
  type RecipePlan,
} from "./recipe.js";
import { locateTomlTable } from "./toml-table.js";
import type { InstallRecipe } from "./types.js";

type TomlTableRecipe = Extract<InstallRecipe, { kind: "toml-table" }>;

const MAX_TABLE_SEGMENTS = 6;
const MAX_TEXT_LINES = 200;
const TABLE_KEY = /^[A-Za-z0-9_-]+$/;
// A blank line at the end of a text: a line ending right after another line ending.
const ENDS_IN_BLANK_LINE = /\n\r?\n$/;
// What status reports for an owned part that is defined in a form Realm does not own. It equals no real table text hash.
const FOREIGN_PART = "foreign definition of the owned table";

interface OwnedTable {
  readonly file: string;
  readonly lines: readonly string[];
  // The owned text, "\n" after every line: what locateTomlTable returns for an untouched table.
  readonly text: string;
  readonly sha256: string;
}

// The recipe's table path and text must be exactly one table: the header of the path, then key lines.
function ownedTable(recipe: TomlTableRecipe): OwnedTable {
  const table = recipe.table;
  if (table.length < 1 || table.length > MAX_TABLE_SEGMENTS || !table.every((key) => TABLE_KEY.test(key))) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  const lines = recipe.text.split("\n");
  const [header, ...keys] = lines;
  if (
    lines.length > MAX_TEXT_LINES ||
    header !== `[${table.join(".")}]` ||
    keys.some((line) => line.trim() === "" || line.includes("\r") || line.trimStart().startsWith("#") || line.trimStart().startsWith("["))
  ) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  const text = `${lines.join("\n")}\n`;
  return { file: requireRelPath(recipe.file), lines, text, sha256: sha256Text(text) };
}

// The owned table as written into a file that uses `eol`.
function written(owned: OwnedTable, eol: string): string {
  return `${owned.lines.join(eol)}${eol}`;
}

// The blank line to put between the file's text and an appended table: none for an empty file or one that ends in a blank line, one
// line ending after a line that ends in one, two after a last line without one (the first completes that line).
function separatorFor(current: string, eol: string): string {
  if (current === "" || ENDS_IN_BLANK_LINE.test(current)) {
    return "";
  }
  return current.endsWith("\n") ? eol : `${eol}${eol}`;
}

function stripLineEndings(text: string, count: number): string | null {
  let out = text;
  for (let i = 0; i < count; i += 1) {
    if (out.endsWith("\r\n")) {
      out = out.slice(0, -2);
    } else if (out.endsWith("\n")) {
      out = out.slice(0, -1);
    } else {
      return null;
    }
  }
  return out;
}

export function planTomlTableInstall(recipe: TomlTableRecipe, state: PlanState): RecipePlan {
  const owned = ownedTable(recipe);
  const file = owned.file;
  const current = currentOf(state, file);
  const prior = priorEntry(state, "toml-table", file);
  const location = current === null ? null : locateTomlTable(current, recipe.table);
  if (location?.state === "unreadable") {
    throw new HostRefusal("unparseable");
  }
  if (location?.state === "foreign") {
    throw new HostRefusal("foreign-content");
  }
  if (current !== null && location?.state === "present") {
    if (prior === undefined || prior.ownedSha256 !== sha256Text(location.text)) {
      // Text Realm did not write, or the very text but with no receipt that says Realm wrote it: never claimed, never overwritten.
      throw new HostRefusal("foreign-content");
    }
    if (location.text === owned.text) {
      return { changes: [noopChange(file, current)], entries: [prior] };
    }
    const after = `${current.slice(0, location.start)}${written(owned, detectEol(current))}${current.slice(location.end)}`;
    return {
      changes: [writeChange(file, current, after)],
      entries: [makeEntry("toml-table", file, current, after, { ownedSha256: owned.sha256, ...entryFlags(prior) })],
    };
  }

  const flags: { -readonly [K in keyof ReceiptEntry]?: ReceiptEntry[K] } = {};
  let after: string;
  if (current === null) {
    after = written(owned, "\n");
    flags.createdFile = true;
    const dirs = missingDirsFor([file], state.dirs);
    if (dirs.length > 0) {
      flags.createdDirs = dirs;
    }
  } else {
    const eol = detectEol(current);
    const separator = separatorFor(current, eol);
    after = `${current}${separator}${written(owned, eol)}`;
    if (separator !== "") {
      flags.separatorAdded = true;
    }
  }
  return {
    changes: [writeChange(file, current, after)],
    entries: [makeEntry("toml-table", file, current, after, { ownedSha256: owned.sha256, ...flags })],
  };
}

export function planTomlTableUninstall(recipe: TomlTableRecipe, state: PlanState): RecipePlan {
  const entry = state.receipt.find((candidate) => candidate.kind === "toml-table");
  if (entry === undefined) {
    return { changes: [], entries: [] };
  }
  const file = requireRelPath(recipe.file);
  if (entry.path !== file || entry.ownedSha256 === undefined) {
    throw new HostRefusal("drifted");
  }
  const current = currentOf(state, file);
  if (current === null) {
    return { changes: [noopChange(file, null), ...dirCleanup([entry], new Set(), state)], entries: [] };
  }
  const location = locateTomlTable(current, recipe.table);
  if (location.state === "absent") {
    return { changes: [noopChange(file, current), ...dirCleanup([entry], new Set(), state)], entries: [] };
  }
  if (location.state !== "present" || sha256Text(location.text) !== entry.ownedSha256) {
    throw new HostRefusal("drifted");
  }
  let head = current.slice(0, location.start);
  const tail = current.slice(location.end);
  if (entry.separatorAdded === true && ENDS_IN_BLANK_LINE.test(head)) {
    // The separator Realm added is one blank line, or two line endings after a file whose last line had none: the one that
    // gives back the file as it was is the one that matches the hash taken before the install.
    const whole = stripLineEndings(head, 2);
    head = whole !== null && sha256Text(`${whole}${tail}`) === entry.beforeSha256 ? whole : (stripLineEndings(head, 1) ?? head);
  }
  const after = `${head}${tail}`;
  if (entry.createdFile === true && after === "") {
    return { changes: [removeFileChange(file, current), ...dirCleanup([entry], new Set([file]), state)], entries: [] };
  }
  return { changes: [writeChange(file, current, after), ...dirCleanup([entry], new Set(), state)], entries: [] };
}

// Status: the hash of the owned table text, null when the table is absent. A foreign definition hashes to a fixed text that no
// receipt owns, so it reads as drift; a header the scanner cannot read is unparsed.
export function ownedTomlTablePart(recipe: TomlTableRecipe, content: string): { readonly parsed: boolean; readonly sha256: string | null } {
  const location = locateTomlTable(content, recipe.table);
  switch (location.state) {
    case "absent":
      return { parsed: true, sha256: null };
    case "present":
      return { parsed: true, sha256: sha256Text(location.text) };
    case "foreign":
      return { parsed: true, sha256: sha256Text(FOREIGN_PART) };
    case "unreadable":
      return { parsed: false, sha256: null };
  }
}

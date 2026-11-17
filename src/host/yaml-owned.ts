// The `yaml-map` recipe: Realm owns one entry `parent.child` of a block-style YAML file (Hermes `config.yaml`: `mcp_servers.realm`),
// located by key identity and compared by its PARSED value. No marker is written and none is read.
//
// Why no markers: Codex rewrote its file with a comment-dropping editor and orphaned them (see toml-owned.ts), and Hermes rewrites its
// file with a round trip that re-quotes and re-flows the entry. The key and the value it parses to survive both.
//
//   install    parent absent: `parent:` and the entry are appended (after a line ending when the file lacks one). Parent present
//              and the child absent: the entry goes after the last content line of the block. Parent `{}`: replaced by the block
//              header and the entry. Child present with the recipe's value: a no-op, claimed only when the receipt owns it. Child
//              present with the value the receipt owns: replaced in place. Any other child, or a parent that is not a block
//              mapping: foreign-content; a file the scanner cannot read: unparseable.
//   status     entry absent: null. Parsed value equal to the receipt's hash: ok. Anything else: drifted.
//   uninstall  the entry's lines (and the header and line ending Realm added) are removed only when the parsed value hashes to
//              the receipt's. Gone already (for instance `hermes mcp remove`): nothing to do, and the receipt is deleted. Changed:
//              drifted. A file the scanner cannot read: unparseable.
//
// Every other byte stays, in the file's own line ending. The planner never writes a comment, so the text it removes is exactly the
// text it wrote.

import { SchemaInvalidError } from "../contract/validate.js";
import type { ReceiptEntry } from "./receipt.js";
import {
  canonicalJson,
  currentOf,
  dirCleanup,
  entryFlags,
  HostRefusal,
  isSafeKeySegment,
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
import { scanYamlMap, type YamlEntryLocation, type YamlEntryValue, type YamlParent, type YamlScan } from "./yaml-scan.js";
import type { InstallRecipe } from "./types.js";

type YamlMapRecipe = Extract<InstallRecipe, { kind: "yaml-map" }>;

const MAX_VALUE_KEYS = 8;
const MAX_ARRAY_ITEMS = 16;
const MAX_STRING_CHARS = 256;
const DEFAULT_INDENT = 2;
const PATH_KEY = /^[A-Za-z0-9_][A-Za-z0-9_-]*$/;
const VALUE_KEY = /^[A-Za-z0-9_]+$/;
// A plain scalar that needs no quoting: no space, no quote, no flow character.
const PLAIN_VALUE = /^[A-Za-z0-9_./=:@%+-]+$/;
// A plain scalar that YAML 1.1 reads as something other than a string, or that starts like a number.
const TYPED_WORD = /^(?:true|false|yes|no|on|off|y|n|null|~)$/i;
const NUMBER_START = /^[-+]?\.?[0-9]|^\.(?:inf|nan)$/i;
// What status reports for an owned entry that is defined in a form Realm does not own. It equals no real entry hash.
const FOREIGN_PART = "foreign definition of the owned yaml entry";

function invalid(): never {
  throw new SchemaInvalidError("host yaml-map recipe is invalid");
}

// A string the recipe may carry: a plain scalar that is always a YAML string and round trips through the reader.
function plainString(text: string): boolean {
  const first = text.charAt(0);
  return (
    text.length > 0 &&
    text.length <= MAX_STRING_CHARS &&
    PLAIN_VALUE.test(text) &&
    !":@%=".includes(first) &&
    text !== "-" &&
    !text.endsWith(":") &&
    !TYPED_WORD.test(text) &&
    !NUMBER_START.test(text)
  );
}

interface OwnedEntry {
  readonly file: string;
  readonly parent: string;
  readonly child: string;
  readonly value: YamlEntryValue;
  readonly sha256: string;
}

// The recipe must be exactly one entry: a two-key path and a flat mapping of plain strings and arrays of them.
function ownedEntry(recipe: YamlMapRecipe): OwnedEntry {
  const segments: readonly string[] = recipe.path;
  const [parent = "", child = ""] = segments;
  const keys = Object.keys(recipe.value);
  if (
    segments.length !== 2 ||
    ![parent, child].every((key) => isSafeKeySegment(key) && PATH_KEY.test(key) && !TYPED_WORD.test(key)) ||
    keys.length < 1 ||
    keys.length > MAX_VALUE_KEYS ||
    !keys.every((key) => VALUE_KEY.test(key)) ||
    !Object.values(recipe.value).every((item) =>
      typeof item === "string" ? plainString(item) : item.length <= MAX_ARRAY_ITEMS && item.every((text) => plainString(text)),
    )
  ) {
    return invalid();
  }
  return { file: requireRelPath(recipe.file), parent, child, value: recipe.value, sha256: sha256Text(canonicalJson(recipe.value)) };
}

// The entry's lines, without line endings, the child key at `indent` and its body one `step` deeper (sequence items two steps).
function entryLines(owned: OwnedEntry, indent: number, step: number): string[] {
  const pad = (width: number): string => " ".repeat(width);
  const lines = [`${pad(indent)}${owned.child}:`];
  for (const [key, value] of Object.entries(owned.value)) {
    if (typeof value === "string") {
      lines.push(`${pad(indent + step)}${key}: ${value}`);
    } else if (value.length === 0) {
      lines.push(`${pad(indent + step)}${key}: []`);
    } else {
      lines.push(`${pad(indent + step)}${key}:`, ...value.map((item) => `${pad(indent + step * 2)}- ${item}`));
    }
  }
  return lines;
}

// `lines` joined by `eol`, a last line ending included only when `terminated`.
function joinLines(lines: readonly string[], eol: string, terminated: boolean): string {
  return `${lines.join(eol)}${terminated ? eol : ""}`;
}

// Puts `lines` into `current` at `at`, a line start (or the end of the file). When the file ends without a line ending and `at` is its
// end, the first line ending is added before the lines and none after them, so the file keeps ending as it did; `separator` says so.
function insertLines(current: string, at: number, lines: readonly string[], eol: string): { readonly after: string; readonly separator: boolean } {
  const unterminated = at === current.length && current !== "" && !current.endsWith("\n");
  const text = unterminated ? `${eol}${joinLines(lines, eol, false)}` : joinLines(lines, eol, true);
  return { after: `${current.slice(0, at)}${text}${current.slice(at)}`, separator: unterminated };
}

export function planYamlMapInstall(recipe: YamlMapRecipe, state: PlanState): RecipePlan {
  const owned = ownedEntry(recipe);
  const file = owned.file;
  const current = currentOf(state, file);
  const prior = priorEntry(state, "yaml-map", file);
  const flags: { -readonly [K in keyof ReceiptEntry]?: ReceiptEntry[K] } = {};
  let after: string;
  if (current === null) {
    after = joinLines([`${owned.parent}:`, ...entryLines(owned, DEFAULT_INDENT, DEFAULT_INDENT)], "\n", true);
    flags.createdFile = true;
    flags.createdParents = [[owned.parent]];
    const dirs = missingDirsFor([file], state.dirs);
    if (dirs.length > 0) {
      flags.createdDirs = dirs;
    }
    return { changes: [writeChange(file, null, after)], entries: [makeEntry("yaml-map", file, null, after, { ownedSha256: owned.sha256, ...flags })] };
  }
  const scan = scanYamlMap(current, [owned.parent, owned.child]);
  if (scan.state === "unreadable") {
    throw new HostRefusal("unparseable");
  }
  if (scan.state === "foreign") {
    throw new HostRefusal("foreign-content");
  }
  if (scan.state === "present") {
    const existing = scan.entry.value === null ? null : sha256Text(canonicalJson(scan.entry.value));
    if (existing === owned.sha256) {
      // Equal to the recipe: nothing to write. Claimed only when the receipt says Realm wrote it.
      return { changes: [noopChange(file, current)], entries: prior !== undefined && prior.ownedSha256 === owned.sha256 ? [prior] : [] };
    }
    if (existing === null || prior === undefined || prior.ownedSha256 !== existing) {
      throw new HostRefusal("foreign-content");
    }
    const { entry } = scan;
    const lines = entryLines(owned, scan.childIndent, scan.childIndent);
    const terminated = current.slice(entry.start, entry.end).endsWith("\n");
    after = `${current.slice(0, entry.start)}${joinLines(lines, scan.eol, terminated)}${current.slice(entry.end)}`;
    return { changes: [writeChange(file, current, after)], entries: [makeEntry("yaml-map", file, current, after, { ownedSha256: owned.sha256, ...entryFlags(prior) })] };
  }
  // The entry is absent. Flags about the file itself carry over from an earlier install; the others describe this one.
  if (prior?.createdFile === true) {
    flags.createdFile = true;
  }
  if (prior?.createdDirs !== undefined) {
    flags.createdDirs = prior.createdDirs;
  }
  const parent = scan.parent;
  let inserted: { readonly after: string; readonly separator: boolean };
  if (parent === null) {
    inserted = insertLines(current, current.length, [`${owned.parent}:`, ...entryLines(owned, DEFAULT_INDENT, DEFAULT_INDENT)], scan.eol);
    flags.createdParents = [[owned.parent]];
  } else {
    const indent = parent.childIndent ?? DEFAULT_INDENT;
    const lines = entryLines(owned, indent, indent);
    if (parent.flowEnd < 0) {
      inserted = insertLines(current, parent.insertAt, lines, scan.eol);
    } else {
      // `mcp_servers: {}` becomes the block header (a trailing comment stays); the entry goes right below it.
      const headerText = current.slice(parent.headerStart, parent.headerEnd);
      const lineEnd = headerText.endsWith("\r\n") ? 2 : headerText.endsWith("\n") ? 1 : 0;
      const line = headerText.slice(0, headerText.length - lineEnd);
      const header = `${line.slice(0, parent.colon + 1)}${line.slice(parent.flowEnd)}`;
      const opened = `${current.slice(0, parent.headerStart)}${header}${current.slice(parent.headerEnd - lineEnd)}`;
      inserted = insertLines(opened, parent.headerStart + header.length + lineEnd, lines, scan.eol);
    }
  }
  if (inserted.separator) {
    flags.separatorAdded = true;
  }
  return {
    changes: [writeChange(file, current, inserted.after)],
    entries: [makeEntry("yaml-map", file, current, inserted.after, { ownedSha256: owned.sha256, ...flags })],
  };
}

// `current` without the entry at [start, end), and without what Realm added around it: the header it created, the line ending it
// added, and `{}` where a `{}` parent was opened. The text that gives back the file as it was is the one that matches the hash taken
// before the install; when none does (the file changed since), the plain removal stands.
function removed(current: string, located: YamlEntryLocation, entry: ReceiptEntry, path: readonly [string, string]): string {
  let text = `${current.slice(0, located.start)}${current.slice(located.end)}`;
  const rest: YamlScan = scanYamlMap(text, path);
  const parent: YamlParent | null = rest.state === "free" ? rest.parent : null;
  const eol = rest.state === "free" ? rest.eol : "\n";
  let header: string | null = null;
  if (parent?.bare === true) {
    const line = text.slice(parent.headerStart, parent.headerEnd);
    const lineEnd = line.endsWith("\r\n") ? 2 : line.endsWith("\n") ? 1 : 0;
    if (entry.createdParents !== undefined) {
      text = `${text.slice(0, parent.headerStart)}${text.slice(parent.headerEnd)}`;
    } else {
      const bare = line.slice(0, line.length - lineEnd);
      header = `${text.slice(0, parent.headerStart)}${bare.slice(0, parent.colon + 1)} {}${bare.slice(parent.colon + 1)}${text.slice(parent.headerStart + bare.length)}`;
    }
  }
  const natural = entry.separatorAdded === true && located.end === current.length;
  const strip = (whole: string): string => (whole.endsWith(eol) ? whole.slice(0, -eol.length) : whole);
  const candidates = [text, ...(header === null ? [] : [header])];
  // The line ending Realm added is stripped only when the entry is still the last thing in the file; otherwise it is the file's own.
  const options = natural ? [...candidates.map(strip), ...candidates] : candidates;
  return options.find((option) => sha256Text(option) === entry.beforeSha256) ?? options[0] ?? text;
}

export function planYamlMapUninstall(recipe: YamlMapRecipe, state: PlanState): RecipePlan {
  const owned = ownedEntry(recipe);
  const entry = state.receipt.find((candidate) => candidate.kind === "yaml-map");
  if (entry === undefined) {
    return { changes: [], entries: [] };
  }
  const file = owned.file;
  if (entry.path !== file || entry.ownedSha256 === undefined) {
    throw new HostRefusal("drifted");
  }
  const current = currentOf(state, file);
  if (current === null) {
    return { changes: [noopChange(file, null), ...dirCleanup([entry], new Set(), state)], entries: [] };
  }
  const path: readonly [string, string] = [owned.parent, owned.child];
  const scan = scanYamlMap(current, path);
  if (scan.state === "unreadable") {
    throw new HostRefusal("unparseable");
  }
  if (scan.state === "free") {
    return { changes: [noopChange(file, current), ...dirCleanup([entry], new Set(), state)], entries: [] };
  }
  if (scan.state !== "present" || scan.entry.value === null || sha256Text(canonicalJson(scan.entry.value)) !== entry.ownedSha256) {
    throw new HostRefusal("drifted");
  }
  const after = removed(current, scan.entry, entry, path);
  if (entry.createdFile === true && after === "") {
    return { changes: [removeFileChange(file, current), ...dirCleanup([entry], new Set([file]), state)], entries: [] };
  }
  return { changes: [writeChange(file, current, after), ...dirCleanup([entry], new Set(), state)], entries: [] };
}

// Status: the hash of the canonical JSON of the parsed entry, null when the entry is absent. A foreign definition, or an entry the
// reader does not accept, hashes to a fixed text that no receipt owns, so it reads as drift; a file the scanner cannot read is unparsed.
export function ownedYamlMapPart(recipe: YamlMapRecipe, content: string): { readonly parsed: boolean; readonly sha256: string | null } {
  const owned = ownedEntry(recipe);
  const scan = scanYamlMap(content, [owned.parent, owned.child]);
  switch (scan.state) {
    case "unreadable":
      return { parsed: false, sha256: null };
    case "foreign":
      return { parsed: true, sha256: sha256Text(FOREIGN_PART) };
    case "free":
      return { parsed: true, sha256: null };
    case "present":
      return { parsed: true, sha256: sha256Text(scan.entry.value === null ? FOREIGN_PART : canonicalJson(scan.entry.value)) };
  }
}

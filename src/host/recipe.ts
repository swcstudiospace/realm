// Pure planning for the five install recipes (json-merge, text-block, toml-table, yaml-map, bundle-copy). Nothing in
// this module touches the file system: the caller reads the current content of every file the
// recipe names and passes it in as PlanState, so the same inputs always give the same plan and
// the same hashes. The installer (install.ts) does every read and every write.
//
// Ownership: Realm changes only what a receipt entry owns. A value, a marker block or a bundle
// file that is not owned and differs from what Realm would write is refused, never overwritten.

import { createHash } from "node:crypto";
import { makeRealmError, RealmError, type ErrorCode } from "../core/errors.js";
import type { ReceiptEntry } from "./receipt.js";
import { ownedTomlTablePart, planTomlTableInstall, planTomlTableUninstall } from "./toml-owned.js";
import { ownedYamlMapPart, planYamlMapInstall, planYamlMapUninstall } from "./yaml-owned.js";
import type { InstallRecipe } from "./types.js";

export type HostRefusalReason =
  | "recipe-pending"
  | "not-detected"
  | "foreign-content"
  | "drifted"
  | "symlink"
  | "unparseable"
  | "config-home-missing"
  | "concurrent-change"
  | "extension-unbuilt"
  | "already-loaded"
  | "unsupported-path";

const REFUSAL_CODE: Readonly<Record<HostRefusalReason, ErrorCode>> = Object.freeze({
  "recipe-pending": "POLICY_DENIED",
  "not-detected": "POLICY_DENIED",
  "foreign-content": "POLICY_DENIED",
  drifted: "POLICY_DENIED",
  symlink: "PATH_ESCAPE",
  unparseable: "SCHEMA_INVALID",
  "config-home-missing": "POLICY_DENIED",
  "concurrent-change": "WRITE_NOT_ATOMIC",
  "extension-unbuilt": "POLICY_DENIED",
  "already-loaded": "POLICY_DENIED",
  "unsupported-path": "POLICY_DENIED",
});

// Fixed text per reason. It never carries file content, a key name or a host value.
const HOST_REFUSAL_TEXT: Readonly<Record<HostRefusalReason, string>> = Object.freeze({
  "recipe-pending": "no install recipe exists for this host yet",
  "not-detected": "the host was not detected on this machine",
  "foreign-content": "the host configuration holds content that Realm does not own",
  drifted: "content that Realm owns was changed after it was written",
  symlink: "a symlink lies on the path to a host file",
  unparseable: "a host file cannot be parsed safely",
  "config-home-missing": "the host config home does not exist",
  "concurrent-change": "a host file changed while the operation ran",
  "extension-unbuilt": "the Realm extension entry is not built; run npm run build in the Realm package",
  "already-loaded": "the host already loads Realm through a plugin link; remove that link first",
  "unsupported-path": "the Realm package path holds a backslash that Node cannot import; move the package to a path without one and build it there",
});

// A catalogue error plus one of eleven fixed reasons. `refusal` names the reason; `reason` stays the
// catalogue text of the code, as on every RealmError. `fix` is a fixed hint, set for `symlink` only.
export class HostRefusal extends RealmError {
  readonly refusal: HostRefusalReason;
  readonly fix: string | undefined;

  constructor(refusal: HostRefusalReason, fix?: string) {
    super(REFUSAL_CODE[refusal]);
    this.name = "HostRefusal";
    this.refusal = refusal;
    this.fix = fix;
    this.message = fix === undefined ? HOST_REFUSAL_TEXT[refusal] : `${HOST_REFUSAL_TEXT[refusal]}; ${fix}`;
  }
}

const BLOCK_BEGIN = "# BEGIN realm host-plugin";
const BLOCK_END = "# END realm host-plugin";
export const MAX_FILE_BYTES = 1024 * 1024;
export const MAX_BUNDLE_FILES = 256;
const MAX_BLOCK_LINES = 200;
const MAX_KEY_SEGMENTS = 6;
const MAX_JSON_DEPTH = 32;
const KEY_SEGMENT = /^[A-Za-z0-9_.-]+$/;
const PATH_SEGMENT = /^[^\0/\\]{1,255}$/;
const POISON_KEYS: readonly string[] = ["__proto__", "constructor", "prototype"];

export type HostOperationKind = "install" | "uninstall";

export interface BundleFile {
  // Relative path inside the bundle source, POSIX separators.
  readonly rel: string;
  // UTF-8 text. A bundle file that is not valid UTF-8 is refused by the reader as unparseable.
  readonly content: string;
}

export interface PlanState {
  readonly operation: HostOperationKind;
  // Relative path -> current content, null when the file is absent. Every path the plan may touch
  // (see recipeTargetPaths) must be present.
  readonly files: ReadonlyMap<string, string | null>;
  // Existing directories among the ancestors of those paths, relative to the home; "" is the home.
  readonly dirs: ReadonlySet<string>;
  // Entry names of the directories a receipt marks as created (uninstall only).
  readonly listings: ReadonlyMap<string, readonly string[]>;
  // Receipt entries (empty when there is no receipt).
  readonly receipt: readonly ReceiptEntry[];
  // The files of a bundle-copy install.
  readonly bundle: readonly BundleFile[];
}

export interface PlannedChange {
  readonly path: string;
  readonly kind: "file" | "dir";
  readonly action: "create" | "update" | "noop" | "remove";
  readonly before: string | null;
  readonly after: string | null;
  readonly beforeSha256: string | null;
  readonly afterSha256: string | null;
  // Byte length of the content written, or of the content removed.
  readonly bytes: number;
}

export interface RecipePlan {
  readonly changes: readonly PlannedChange[];
  // The receipt entries Realm owns once the plan is applied (install), [] for uninstall.
  readonly entries: readonly ReceiptEntry[];
}

export function sha256Text(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function byteLength(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

function refuse(reason: HostRefusalReason): never {
  throw new HostRefusal(reason);
}

function invalid(): never {
  throw makeRealmError("SCHEMA_INVALID");
}

// ---- Paths ---------------------------------------------------------------------

// A relative POSIX path of non-empty segments, none of them `.` or `..`.
export function isSafeRelPath(path: string): boolean {
  if (path.length === 0 || path.length > 1024 || path.startsWith("/")) {
    return false;
  }
  return path.split("/").every((segment) => segment !== "" && segment !== "." && segment !== ".." && PATH_SEGMENT.test(segment));
}

export function isSafeKeySegment(segment: string): boolean {
  return KEY_SEGMENT.test(segment) && !POISON_KEYS.includes(segment);
}

export function requireRelPath(path: string): string {
  if (!isSafeRelPath(path)) {
    invalid();
  }
  return path;
}

function joinRel(dir: string, rel: string): string {
  return `${dir}/${rel}`;
}

// The directories above a file, shallowest first, as relative paths ("a", "a/b").
function ancestorsOf(path: string): string[] {
  const segments = path.split("/");
  const out: string[] = [];
  for (let i = 1; i < segments.length; i += 1) {
    out.push(segments.slice(0, i).join("/"));
  }
  return out;
}

export function missingDirsFor(paths: readonly string[], dirs: ReadonlySet<string>): string[][] {
  const missing = new Set<string>();
  for (const path of paths) {
    for (const dir of ancestorsOf(path)) {
      if (!dirs.has(dir)) {
        missing.add(dir);
      }
    }
  }
  return [...missing].sort((a, b) => a.split("/").length - b.split("/").length || (a < b ? -1 : 1)).map((dir) => dir.split("/"));
}

// ---- Canonical JSON --------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function canonical(value: unknown, depth: number): string {
  if (depth > MAX_JSON_DEPTH) {
    return invalid();
  }
  if (value === null) {
    return "null";
  }
  if (typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? JSON.stringify(value) : invalid();
  }
  if (Array.isArray(value)) {
    return `[${value.map((item: unknown) => canonical(item, depth + 1)).join(",")}]`;
  }
  if (isPlainObject(value)) {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical(value[key], depth + 1)}`).join(",")}}`;
  }
  return invalid();
}

// Keys sorted at every level, so two values are equal exactly when their canonical text is.
export function canonicalJson(value: unknown): string {
  return canonical(value, 0);
}

// ---- Entry helpers ---------------------------------------------------------------

type EntryKind = InstallRecipe["kind"];

export function priorEntry(state: PlanState, kind: EntryKind, path: string): ReceiptEntry | undefined {
  return state.receipt.find((entry) => entry.kind === kind && entry.path === path);
}

function hashOrNull(text: string | null): string | null {
  return text === null ? null : sha256Text(text);
}

export function noopChange(path: string, current: string | null): PlannedChange {
  const hash = hashOrNull(current);
  return {
    path,
    kind: "file",
    action: "noop",
    before: current,
    after: current,
    beforeSha256: hash,
    afterSha256: hash,
    bytes: current === null ? 0 : byteLength(current),
  };
}

export function writeChange(path: string, before: string | null, after: string): PlannedChange {
  return {
    path,
    kind: "file",
    action: before === null ? "create" : "update",
    before,
    after,
    beforeSha256: hashOrNull(before),
    afterSha256: sha256Text(after),
    bytes: byteLength(after),
  };
}

export function removeFileChange(path: string, before: string): PlannedChange {
  return {
    path,
    kind: "file",
    action: "remove",
    before,
    after: null,
    beforeSha256: sha256Text(before),
    afterSha256: null,
    bytes: byteLength(before),
  };
}

export function entryFlags(prior: ReceiptEntry | undefined): Partial<ReceiptEntry> {
  const flags: { -readonly [K in keyof ReceiptEntry]?: ReceiptEntry[K] } = {};
  if (prior?.createdFile === true) {
    flags.createdFile = true;
  }
  if (prior?.createdParents !== undefined) {
    flags.createdParents = prior.createdParents;
  }
  if (prior?.createdDirs !== undefined) {
    flags.createdDirs = prior.createdDirs;
  }
  if (prior?.separatorAdded === true) {
    flags.separatorAdded = true;
  }
  return flags;
}

export function makeEntry(
  kind: EntryKind,
  path: string,
  before: string | null,
  after: string,
  extra: Partial<ReceiptEntry>,
): ReceiptEntry {
  return {
    path,
    kind,
    beforeSha256: hashOrNull(before),
    afterSha256: sha256Text(after),
    ...extra,
  };
}

export function currentOf(state: PlanState, path: string): string | null {
  const content = state.files.get(path);
  if (content === undefined) {
    return invalid();
  }
  return content;
}

// ---- Receipt resume rule -----------------------------------------------------------

export type ResumeDecision = "done" | "apply" | "conflict";

// current equals the written content: done. Equals the prior content: not applied yet. Anything
// else: a third party changed the file.
export function resumeDecision(
  entry: { readonly beforeSha256: string | null; readonly afterSha256: string },
  currentSha256: string | null,
): ResumeDecision {
  if (currentSha256 === entry.afterSha256) {
    return "done";
  }
  if (currentSha256 === entry.beforeSha256) {
    return "apply";
  }
  return "conflict";
}

// ---- json-merge -----------------------------------------------------------------

interface JsonFormat {
  readonly indent: string;
  readonly eol: string;
  readonly trailingNewline: boolean;
}

const DEFAULT_JSON_FORMAT: JsonFormat = { indent: "  ", eol: "\n", trailingNewline: true };

function detectJsonFormat(text: string): JsonFormat {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const match = /\n([ \t]+)\S/.exec(text);
  let indent = "  ";
  if (match !== null && match[1] !== undefined) {
    const lead = match[1];
    if (lead.startsWith("\t")) {
      indent = "\t";
    } else if (lead.length === 4) {
      indent = "    ";
    }
  }
  return { indent, eol, trailingNewline: text.endsWith("\n") };
}

function serializeJson(doc: Record<string, unknown>, format: JsonFormat): string {
  let text = JSON.stringify(doc, null, format.indent);
  if (format.eol === "\r\n") {
    text = text.replace(/\n/g, "\r\n");
  }
  return format.trailingNewline ? `${text}${format.eol}` : text;
}

// True when a number literal outside a string would not survive a parse and stringify round trip
// (an integer past 2^53, or a value that overflows to Infinity). Re-serializing such a file would
// change the user's data, so it is refused instead.
function hasLossyNumber(text: string): boolean {
  const token = /"(?:[^"\\]|\\[\s\S])*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/g;
  for (const match of text.matchAll(token)) {
    const literal = match[0];
    if (literal.startsWith('"')) {
      continue;
    }
    const value = Number(literal);
    if (!Number.isFinite(value)) {
      return true;
    }
    if (/^-?\d+$/.test(literal) && literal.replace("-", "").length > 15 && BigInt(literal) !== BigInt(value)) {
      return true;
    }
  }
  return false;
}

function parseJsonObject(text: string): Record<string, unknown> {
  if (hasLossyNumber(text)) {
    return refuse("unparseable");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return refuse("unparseable");
  }
  if (!isPlainObject(parsed)) {
    return refuse("unparseable");
  }
  return parsed;
}

function validateKeyPath(keyPath: readonly string[]): void {
  if (keyPath.length < 1 || keyPath.length > MAX_KEY_SEGMENTS || !keyPath.every((segment) => isSafeKeySegment(segment))) {
    invalid();
  }
}

interface PathLookup {
  readonly found: boolean;
  readonly value: unknown;
}

function lookup(doc: Record<string, unknown>, keyPath: readonly string[]): PathLookup {
  let cursor: unknown = doc;
  for (const segment of keyPath) {
    if (!isPlainObject(cursor) || !Object.hasOwn(cursor, segment)) {
      return { found: false, value: undefined };
    }
    cursor = cursor[segment];
  }
  return { found: true, value: cursor };
}

function planJsonInstall(recipe: Extract<InstallRecipe, { kind: "json-merge" }>, state: PlanState): RecipePlan {
  const file = requireRelPath(recipe.file);
  validateKeyPath(recipe.keyPath);
  const desired = canonicalJson(recipe.value);
  const desiredHash = sha256Text(desired);
  const current = currentOf(state, file);
  const prior = priorEntry(state, "json-merge", file);
  const doc: Record<string, unknown> = current === null ? {} : parseJsonObject(current);
  const format = current === null ? DEFAULT_JSON_FORMAT : detectJsonFormat(current);

  // Walk to the parent of the key, creating missing parents.
  const createdParents: string[][] = [];
  let cursor = doc;
  for (let i = 0; i < recipe.keyPath.length - 1; i += 1) {
    const segment = recipe.keyPath[i];
    if (segment === undefined) {
      return invalid();
    }
    if (!Object.hasOwn(cursor, segment)) {
      const child: Record<string, unknown> = {};
      cursor[segment] = child;
      createdParents.push(recipe.keyPath.slice(0, i + 1));
      cursor = child;
      continue;
    }
    const child = cursor[segment];
    if (!isPlainObject(child)) {
      return refuse("foreign-content");
    }
    cursor = child;
  }
  const last = recipe.keyPath[recipe.keyPath.length - 1];
  if (last === undefined) {
    return invalid();
  }
  const owned = (existingCanonical: string): boolean => prior?.ownedSha256 === sha256Text(existingCanonical);
  if (Object.hasOwn(cursor, last)) {
    const existing = canonicalJson(cursor[last]);
    if (existing === desired) {
      return {
        changes: [noopChange(file, current)],
        entries: prior !== undefined && owned(existing) ? [prior] : [],
      };
    }
    if (!owned(existing)) {
      return refuse("foreign-content");
    }
  }
  cursor[last] = recipe.value;
  const after = serializeJson(doc, format);
  const newDirs = missingDirsFor([file], state.dirs);
  const flags: Partial<ReceiptEntry> =
    current === null
      ? {
          createdFile: true,
          ...(createdParents.length > 0 ? { createdParents } : {}),
          ...(newDirs.length > 0 ? { createdDirs: newDirs } : {}),
        }
      : prior !== undefined
        ? { ...entryFlags(prior), ...(createdParents.length > 0 ? { createdParents: [...(prior.createdParents ?? []), ...createdParents] } : {}) }
        : { ...(createdParents.length > 0 ? { createdParents } : {}) };
  return {
    changes: [writeChange(file, current, after)],
    entries: [makeEntry("json-merge", file, current, after, { ownedSha256: desiredHash, ...flags })],
  };
}

function planJsonUninstall(recipe: Extract<InstallRecipe, { kind: "json-merge" }>, state: PlanState): RecipePlan {
  validateKeyPath(recipe.keyPath);
  const entry = state.receipt.find((candidate) => candidate.kind === "json-merge");
  if (entry === undefined) {
    return { changes: [], entries: [] };
  }
  if (entry.path !== requireRelPath(recipe.file) || entry.ownedSha256 === undefined) {
    return refuse("drifted");
  }
  const file = entry.path;
  const current = currentOf(state, file);
  if (current === null) {
    return { changes: [noopChange(file, null), ...dirCleanup([entry], new Set(), state)], entries: [] };
  }
  const doc = parseJsonObject(current);
  const found = lookup(doc, recipe.keyPath);
  if (!found.found) {
    return { changes: [noopChange(file, current), ...dirCleanup([entry], new Set(), state)], entries: [] };
  }
  if (sha256Text(canonicalJson(found.value)) !== entry.ownedSha256) {
    return refuse("drifted");
  }
  removeKey(doc, recipe.keyPath);
  const parents = [...(entry.createdParents ?? [])].sort((a, b) => b.length - a.length);
  for (const parent of parents) {
    const there = lookup(doc, parent);
    if (there.found && isPlainObject(there.value) && Object.keys(there.value).length === 0) {
      removeKey(doc, parent);
    }
  }
  if (entry.createdFile === true && Object.keys(doc).length === 0) {
    const removed = new Set([file]);
    return { changes: [removeFileChange(file, current), ...dirCleanup([entry], removed, state)], entries: [] };
  }
  const after = serializeJson(doc, detectJsonFormat(current));
  return { changes: [writeChange(file, current, after), ...dirCleanup([entry], new Set(), state)], entries: [] };
}

function removeKey(doc: Record<string, unknown>, keyPath: readonly string[]): void {
  let cursor: unknown = doc;
  for (let i = 0; i < keyPath.length - 1; i += 1) {
    const segment = keyPath[i];
    if (segment === undefined || !isPlainObject(cursor) || !Object.hasOwn(cursor, segment)) {
      return;
    }
    cursor = cursor[segment];
  }
  const last = keyPath[keyPath.length - 1];
  if (last !== undefined && isPlainObject(cursor) && Object.hasOwn(cursor, last)) {
    // Own data property of a parsed object: a plain delete cannot reach a prototype.
    Reflect.deleteProperty(cursor, last);
  }
}

// ---- text-block ------------------------------------------------------------------

function blockLines(block: string): string[] {
  if (block === "") {
    return invalid();
  }
  const lines = block.split(/\r?\n/);
  if (lines.length > 1 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  if (lines.length < 1 || lines.length > MAX_BLOCK_LINES) {
    return invalid();
  }
  for (const line of lines) {
    if (line === BLOCK_BEGIN || line === BLOCK_END) {
      return invalid();
    }
  }
  return lines;
}

interface BlockLocation {
  // Offset of the start of the BEGIN line.
  readonly beginStart: number;
  // Offset just past the end of the BEGIN line, its newline included.
  readonly bodyStart: number;
  // Offset of the start of the END line.
  readonly endStart: number;
  // Offset just past the END line, its newline included when it has one.
  readonly endEnd: number;
  // The block text between the markers, joined with "\n", carriage returns removed.
  readonly text: string;
}

function stripCr(line: string): string {
  return line.endsWith("\r") ? line.slice(0, -1) : line;
}

// null: no markers at all. A throw: any other layout (a lone marker, a reversed pair, more than one pair).
function locateBlock(content: string): BlockLocation | null {
  const lines = content.split("\n");
  let offset = 0;
  const begins: { index: number; start: number }[] = [];
  const ends: { index: number; start: number }[] = [];
  for (const [index, line] of lines.entries()) {
    const plain = stripCr(line);
    if (plain === BLOCK_BEGIN) {
      begins.push({ index, start: offset });
    } else if (plain === BLOCK_END) {
      ends.push({ index, start: offset });
    }
    offset += line.length + 1;
  }
  if (begins.length === 0 && ends.length === 0) {
    return null;
  }
  const begin = begins[0];
  const end = ends[0];
  if (begins.length !== 1 || ends.length !== 1 || begin === undefined || end === undefined || begin.index >= end.index) {
    return refuse("unparseable");
  }
  const between = lines.slice(begin.index + 1, end.index).map(stripCr);
  const endLine = lines[end.index] ?? "";
  const beginLine = lines[begin.index] ?? "";
  return {
    beginStart: begin.start,
    bodyStart: begin.start + beginLine.length + 1,
    endStart: end.start,
    endEnd: Math.min(content.length, end.start + endLine.length + 1),
    text: between.join("\n"),
  };
}

export function detectEol(content: string): string {
  return content.includes("\r\n") ? "\r\n" : "\n";
}

function planTextInstall(recipe: Extract<InstallRecipe, { kind: "text-block" }>, state: PlanState): RecipePlan {
  const file = requireRelPath(recipe.file);
  const lines = blockLines(recipe.block);
  const desiredText = lines.join("\n");
  const desiredHash = sha256Text(desiredText);
  const current = currentOf(state, file);
  const prior = priorEntry(state, "text-block", file);
  const location = current === null ? null : locateBlock(current);

  if (current !== null && location !== null) {
    if (location.text === desiredText) {
      return {
        changes: [noopChange(file, current)],
        entries: prior !== undefined && prior.ownedSha256 === desiredHash ? [prior] : [],
      };
    }
    if (prior?.ownedSha256 !== sha256Text(location.text)) {
      return refuse("foreign-content");
    }
    const eol = detectEol(current);
    const after = `${current.slice(0, location.bodyStart)}${lines.join(eol)}${eol}${current.slice(location.endStart)}`;
    return {
      changes: [writeChange(file, current, after)],
      entries: [makeEntry("text-block", file, current, after, { ownedSha256: desiredHash, ...entryFlags(prior) })],
    };
  }

  const eol = current === null ? "\n" : detectEol(current);
  const body = `${[BLOCK_BEGIN, ...lines, BLOCK_END].join(eol)}${eol}`;
  let after: string;
  const flags: { -readonly [K in keyof ReceiptEntry]?: ReceiptEntry[K] } = {};
  if (current === null) {
    after = body;
    flags.createdFile = true;
    const dirs = missingDirsFor([file], state.dirs);
    if (dirs.length > 0) {
      flags.createdDirs = dirs;
    }
  } else if (current === "" || current.endsWith("\n")) {
    after = `${current}${body}`;
  } else {
    after = `${current}${eol}${body}`;
    flags.separatorAdded = true;
  }
  return {
    changes: [writeChange(file, current, after)],
    entries: [makeEntry("text-block", file, current, after, { ownedSha256: desiredHash, ...flags })],
  };
}

function planTextUninstall(recipe: Extract<InstallRecipe, { kind: "text-block" }>, state: PlanState): RecipePlan {
  const entry = state.receipt.find((candidate) => candidate.kind === "text-block");
  if (entry === undefined) {
    return { changes: [], entries: [] };
  }
  if (entry.path !== requireRelPath(recipe.file) || entry.ownedSha256 === undefined) {
    return refuse("drifted");
  }
  const file = entry.path;
  const current = currentOf(state, file);
  if (current === null) {
    return { changes: [noopChange(file, null), ...dirCleanup([entry], new Set(), state)], entries: [] };
  }
  let location: BlockLocation | null;
  try {
    location = locateBlock(current);
  } catch {
    return refuse("drifted");
  }
  if (location === null) {
    return { changes: [noopChange(file, current), ...dirCleanup([entry], new Set(), state)], entries: [] };
  }
  if (sha256Text(location.text) !== entry.ownedSha256) {
    return refuse("drifted");
  }
  let head = current.slice(0, location.beginStart);
  if (entry.separatorAdded === true) {
    if (head.endsWith("\r\n")) {
      head = head.slice(0, -2);
    } else if (head.endsWith("\n")) {
      head = head.slice(0, -1);
    }
  }
  const after = `${head}${current.slice(location.endEnd)}`;
  if (entry.createdFile === true && after === "") {
    return { changes: [removeFileChange(file, current), ...dirCleanup([entry], new Set([file]), state)], entries: [] };
  }
  return { changes: [writeChange(file, current, after), ...dirCleanup([entry], new Set(), state)], entries: [] };
}

// ---- bundle-copy -------------------------------------------------------------------

function bundleTargets(recipe: Extract<InstallRecipe, { kind: "bundle-copy" }>, bundle: readonly BundleFile[]): string[] {
  const dest = requireRelPath(recipe.dest);
  return bundle.map((file) => joinRel(dest, requireRelPath(file.rel)));
}

function checkBundleBounds(bundle: readonly BundleFile[]): void {
  if (bundle.length > MAX_BUNDLE_FILES) {
    refuse("unparseable");
  }
  for (const file of bundle) {
    if (byteLength(file.content) > MAX_FILE_BYTES) {
      refuse("unparseable");
    }
  }
}

function planBundleInstall(recipe: Extract<InstallRecipe, { kind: "bundle-copy" }>, state: PlanState): RecipePlan {
  requireRelPath(recipe.source);
  checkBundleBounds(state.bundle);
  const targets = bundleTargets(recipe, state.bundle);
  const byPath = new Map<string, string>();
  for (const [index, file] of state.bundle.entries()) {
    const path = targets[index];
    if (path === undefined || byPath.has(path)) {
      return invalid();
    }
    byPath.set(path, file.content);
  }
  const paths = [...byPath.keys()].sort();
  const changes: PlannedChange[] = [];
  const entries: ReceiptEntry[] = [];
  const created: string[] = [];
  for (const path of paths) {
    const desired = byPath.get(path) ?? "";
    const current = currentOf(state, path);
    const prior = priorEntry(state, "bundle-copy", path);
    if (current === null) {
      changes.push(writeChange(path, null, desired));
      entries.push(makeEntry("bundle-copy", path, null, desired, {}));
      created.push(path);
      continue;
    }
    const currentHash = sha256Text(current);
    const owned = prior !== undefined && resumeDecision(prior, currentHash) !== "conflict";
    if (current === desired) {
      changes.push(noopChange(path, current));
      if (prior !== undefined && owned) {
        entries.push(prior);
      }
      continue;
    }
    if (!owned) {
      return refuse("foreign-content");
    }
    changes.push(writeChange(path, current, desired));
    entries.push(makeEntry("bundle-copy", path, current, desired, {}));
  }
  // A file an earlier install owned that the bundle no longer ships is removed when still unchanged.
  const carriedDirs: string[][] = [];
  for (const prior of state.receipt) {
    if (prior.kind !== "bundle-copy") {
      continue;
    }
    carriedDirs.push(...(prior.createdDirs ?? []).map((segments) => [...segments]));
    const current = state.files.get(prior.path);
    if (!byPath.has(prior.path) && current !== undefined && current !== null && sha256Text(current) === prior.afterSha256) {
      changes.push(removeFileChange(prior.path, current));
    }
  }
  const dirs = mergeDirs([...carriedDirs, ...missingDirsFor(created, state.dirs)]);
  const first = entries[0];
  if (first !== undefined && dirs.length > 0) {
    entries[0] = { ...first, createdDirs: dirs };
  }
  return { changes, entries };
}

function mergeDirs(dirs: readonly (readonly string[])[]): string[][] {
  const seen = new Set<string>();
  const out: string[][] = [];
  for (const segments of dirs) {
    const key = segments.join("/");
    if (!seen.has(key)) {
      seen.add(key);
      out.push([...segments]);
    }
  }
  return out.sort((a, b) => a.length - b.length || (a.join("/") < b.join("/") ? -1 : 1));
}

function planBundleUninstall(state: PlanState): RecipePlan {
  const owned = state.receipt.filter((entry) => entry.kind === "bundle-copy");
  const changes: PlannedChange[] = [];
  const removed = new Set<string>();
  for (const entry of [...owned].sort((a, b) => (a.path < b.path ? -1 : 1))) {
    requireRelPath(entry.path);
    const current = currentOf(state, entry.path);
    if (current === null) {
      changes.push(noopChange(entry.path, null));
      continue;
    }
    const hash = sha256Text(current);
    if (hash === entry.afterSha256) {
      changes.push(removeFileChange(entry.path, current));
      removed.add(entry.path);
    } else if (hash === entry.beforeSha256) {
      changes.push(noopChange(entry.path, current));
    } else {
      return refuse("drifted");
    }
  }
  return { changes: [...changes, ...dirCleanup(owned, removed, state)], entries: [] };
}

// Directories a receipt marks as created are removed, deepest first, when nothing is left in them
// once the planned removals are applied.
export function dirCleanup(entries: readonly ReceiptEntry[], removedFiles: ReadonlySet<string>, state: PlanState): PlannedChange[] {
  const dirs = mergeDirs(entries.flatMap((entry) => entry.createdDirs ?? [])).reverse();
  const removed = new Set(removedFiles);
  const changes: PlannedChange[] = [];
  for (const segments of dirs) {
    const dir = segments.join("/");
    const names = state.listings.get(dir);
    if (names === undefined || !names.every((name) => removed.has(joinRel(dir, name)))) {
      continue;
    }
    removed.add(dir);
    changes.push({ path: dir, kind: "dir", action: "remove", before: null, after: null, beforeSha256: null, afterSha256: null, bytes: 0 });
  }
  return changes;
}

// ---- Entry points -------------------------------------------------------------------

// Every relative file path the plan may read: the recipe's own files plus everything the receipt owns.
export function recipeTargetPaths(
  recipe: InstallRecipe,
  operation: HostOperationKind,
  bundle: readonly BundleFile[],
  receipt: readonly ReceiptEntry[],
): readonly string[] {
  const paths = new Set<string>(receipt.map((entry) => requireRelPath(entry.path)));
  if (operation === "install") {
    if (recipe.kind === "bundle-copy") {
      for (const path of bundleTargets(recipe, bundle)) {
        paths.add(path);
      }
    } else {
      paths.add(requireRelPath(recipe.file));
    }
  }
  return [...paths].sort();
}

// The directories whose listing an uninstall needs: every directory a receipt marks as created.
export function receiptDirPaths(receipt: readonly ReceiptEntry[]): readonly string[] {
  return mergeDirs(receipt.flatMap((entry) => entry.createdDirs ?? [])).map((segments) => segments.join("/"));
}

export function planRecipe(recipe: InstallRecipe, state: PlanState): RecipePlan {
  const install = state.operation === "install";
  switch (recipe.kind) {
    case "json-merge":
      return install ? planJsonInstall(recipe, state) : planJsonUninstall(recipe, state);
    case "text-block":
      return install ? planTextInstall(recipe, state) : planTextUninstall(recipe, state);
    case "toml-table":
      return install ? planTomlTableInstall(recipe, state) : planTomlTableUninstall(recipe, state);
    case "yaml-map":
      return install ? planYamlMapInstall(recipe, state) : planYamlMapUninstall(recipe, state);
    case "bundle-copy":
      return install ? planBundleInstall(recipe, state) : planBundleUninstall(state);
  }
}

// The part of `content` a receipt entry owns, hashed. json-merge: the canonical value at the key path. text-block: the text
// between the markers. toml-table: the table text. yaml-map: the canonical parsed entry. bundle-copy: the whole file. `parsed` is false when the content cannot be parsed (not a JSON object, or a
// broken marker layout); `sha256` is null when it parsed but the owned part is absent. Used by status against the receipt.
export function ownedPart(recipe: InstallRecipe, content: string): { readonly parsed: boolean; readonly sha256: string | null } {
  try {
    if (recipe.kind === "bundle-copy") {
      return { parsed: true, sha256: sha256Text(content) };
    }
    if (recipe.kind === "toml-table") {
      return ownedTomlTablePart(recipe, content);
    }
    if (recipe.kind === "yaml-map") {
      return ownedYamlMapPart(recipe, content);
    }
    if (recipe.kind === "text-block") {
      const location = locateBlock(content);
      return { parsed: true, sha256: location === null ? null : sha256Text(location.text) };
    }
    const found = lookup(parseJsonObject(content), recipe.keyPath);
    return { parsed: true, sha256: found.found ? sha256Text(canonicalJson(found.value)) : null };
  } catch {
    return { parsed: false, sha256: null };
  }
}

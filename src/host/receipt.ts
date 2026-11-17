// Ownership receipts for the host installer. A receipt records, per host, which files Realm wrote
// and the hashes needed to undo exactly that. It holds paths, booleans and hashes only: never file
// content and never a value taken from a host configuration.
//
// Location: <stateDir>/hosts/<hostId>.receipt.json, directory 0700, file 0600, written through
// atomicWriteFile with the hash the caller observed, so two racing installers cannot both win.

import { constants, mkdirSync, realpathSync, rmSync } from "node:fs";
import { open, type FileHandle } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { Buffer } from "node:buffer";
import { makeRealmError, RealmError } from "../core/errors.js";
import { SchemaInvalidError } from "../contract/validate.js";
import { withTimeout } from "../core/timeout.js";
import { atomicWriteFile, observeSha256, sha256Hex } from "../fs/atomic-write.js";
import { errnoOf, lstatIfPresent } from "../fs/canonicalize.js";
import { isSafeKeySegment, isSafeRelPath, MAX_FILE_BYTES } from "./recipe.js";
import { HOST_IDS, type HostId, type InstallRecipe } from "./types.js";

type ReceiptState = "pending" | "installed";

export interface ReceiptEntry {
  // Relative to Receipt.configHome, POSIX separators.
  readonly path: string;
  readonly kind: InstallRecipe["kind"];
  // Hash of the file before Realm wrote it, null when it did not exist.
  readonly beforeSha256: string | null;
  // Hash of the whole file as Realm wrote it.
  readonly afterSha256: string;
  // json-merge: hash of the canonical value Realm owns. text-block: hash of the block text. toml-table: hash of the table text.
  readonly ownedSha256?: string;
  readonly createdFile?: boolean;
  // json-merge: key paths of parent objects Realm created.
  readonly createdParents?: readonly (readonly string[])[];
  // Directories (relative path segments) Realm created for this entry's files.
  readonly createdDirs?: readonly (readonly string[])[];
  // text-block, toml-table: the newline or blank line Realm added before its block or table.
  readonly separatorAdded?: boolean;
}

export interface Receipt {
  readonly schemaVersion: 1;
  readonly hostId: HostId;
  readonly recipeKind: InstallRecipe["kind"];
  readonly state: ReceiptState;
  readonly configHome: string;
  readonly createdAt: string;
  readonly entries: readonly ReceiptEntry[];
}

export interface ReceiptRead {
  readonly receipt: Receipt;
  // Hash of the receipt file as read: pass it back as the prior hash of the next write.
  readonly sha256: string;
}

export const DEFAULT_READ_TIMEOUT_MS = 10_000;
const MAX_ENTRIES = 300;
const MAX_DIR_LISTS = 64;
const MAX_DIR_DEPTH = 16;
const HASH = /^[0-9a-f]{64}$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
const RECIPE_KINDS: readonly string[] = ["json-merge", "text-block", "toml-table", "bundle-copy"];
const ENTRY_KEYS = ["path", "kind", "beforeSha256", "afterSha256", "ownedSha256", "createdFile", "createdParents", "createdDirs", "separatorAdded"];
const RECEIPT_KEYS = ["schemaVersion", "hostId", "recipeKind", "state", "configHome", "createdAt", "entries"];

function reject(): never {
  throw new SchemaInvalidError("host receipt is not valid");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function strictKeys(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!isRecord(value)) {
    return reject();
  }
  for (const key of Object.getOwnPropertyNames(value)) {
    if (!allowed.includes(key)) {
      reject();
    }
  }
  return value;
}

function hashValue(value: unknown): string {
  return typeof value === "string" && HASH.test(value) ? value : reject();
}

function segmentLists(value: unknown, maxLists: number, maxDepth: number, valid: (segment: string) => boolean): string[][] {
  if (!Array.isArray(value) || value.length > maxLists) {
    return reject();
  }
  return value.map((list: unknown) => {
    if (!Array.isArray(list) || list.length < 1 || list.length > maxDepth) {
      return reject();
    }
    return list.map((segment: unknown) => (typeof segment === "string" && valid(segment) ? segment : reject()));
  });
}

function parseEntry(value: unknown, recipeKind: string): ReceiptEntry {
  const obj = strictKeys(value, ENTRY_KEYS);
  const path = obj["path"];
  if (typeof path !== "string" || !isSafeRelPath(path) || obj["kind"] !== recipeKind) {
    return reject();
  }
  const before = obj["beforeSha256"];
  const entry: { -readonly [K in keyof ReceiptEntry]: ReceiptEntry[K] } = {
    path,
    kind: recipeKind as InstallRecipe["kind"],
    beforeSha256: before === null ? null : hashValue(before),
    afterSha256: hashValue(obj["afterSha256"]),
  };
  if (obj["ownedSha256"] !== undefined) {
    entry.ownedSha256 = hashValue(obj["ownedSha256"]);
  }
  if (obj["createdFile"] !== undefined) {
    if (typeof obj["createdFile"] !== "boolean") {
      reject();
    }
    entry.createdFile = obj["createdFile"];
  }
  if (obj["separatorAdded"] !== undefined) {
    if (typeof obj["separatorAdded"] !== "boolean") {
      reject();
    }
    entry.separatorAdded = obj["separatorAdded"];
  }
  if (obj["createdParents"] !== undefined) {
    entry.createdParents = segmentLists(obj["createdParents"], 6, 6, isSafeKeySegment);
  }
  if (obj["createdDirs"] !== undefined) {
    entry.createdDirs = segmentLists(obj["createdDirs"], MAX_DIR_LISTS, MAX_DIR_DEPTH, (segment) => isSafeRelPath(segment));
  }
  return entry;
}

// Strict, hand-written, dependency-free. Every refusal is SCHEMA_INVALID with one fixed message.
export function parseReceipt(text: string): Receipt {
  if (Buffer.byteLength(text, "utf8") > MAX_FILE_BYTES) {
    reject();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return reject();
  }
  const obj = strictKeys(parsed, RECEIPT_KEYS);
  const hostId = obj["hostId"];
  const recipeKind = obj["recipeKind"];
  const state = obj["state"];
  const configHome = obj["configHome"];
  const createdAt = obj["createdAt"];
  const entries = obj["entries"];
  if (
    obj["schemaVersion"] !== 1 ||
    typeof hostId !== "string" ||
    !(HOST_IDS as readonly string[]).includes(hostId) ||
    typeof recipeKind !== "string" ||
    !RECIPE_KINDS.includes(recipeKind) ||
    (state !== "pending" && state !== "installed") ||
    typeof configHome !== "string" ||
    !isAbsolute(configHome) ||
    configHome.length > 4096 ||
    configHome.includes("\0") ||
    typeof createdAt !== "string" ||
    !TIMESTAMP.test(createdAt) ||
    !Array.isArray(entries) ||
    entries.length > MAX_ENTRIES
  ) {
    return reject();
  }
  return {
    schemaVersion: 1,
    hostId: hostId as HostId,
    recipeKind: recipeKind as InstallRecipe["kind"],
    state,
    configHome,
    createdAt,
    entries: entries.map((entry: unknown) => parseEntry(entry, recipeKind)),
  };
}

function entryRecord(entry: ReceiptEntry): Record<string, unknown> {
  return {
    path: entry.path,
    kind: entry.kind,
    beforeSha256: entry.beforeSha256,
    afterSha256: entry.afterSha256,
    ...(entry.ownedSha256 === undefined ? {} : { ownedSha256: entry.ownedSha256 }),
    ...(entry.createdFile === undefined ? {} : { createdFile: entry.createdFile }),
    ...(entry.createdParents === undefined ? {} : { createdParents: entry.createdParents }),
    ...(entry.createdDirs === undefined ? {} : { createdDirs: entry.createdDirs }),
    ...(entry.separatorAdded === undefined ? {} : { separatorAdded: entry.separatorAdded }),
  };
}

// Deterministic text: fixed key order, two-space indent, trailing newline.
export function serializeReceipt(receipt: Receipt): string {
  const record = {
    schemaVersion: receipt.schemaVersion,
    hostId: receipt.hostId,
    recipeKind: receipt.recipeKind,
    state: receipt.state,
    configHome: receipt.configHome,
    createdAt: receipt.createdAt,
    entries: receipt.entries.map(entryRecord),
  };
  return `${JSON.stringify(record, null, 2)}\n`;
}

export function receiptPath(stateDir: string, hostId: HostId): string {
  return join(stateDir, "hosts", `${hostId}.receipt.json`);
}

// The hosts directory must be a real directory. A symlink there could redirect every receipt.
function assertRealHostsDir(stateDir: string): boolean {
  const stats = lstatIfPresent(join(stateDir, "hosts"));
  if (stats === null) {
    return false;
  }
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw makeRealmError("PATH_ESCAPE");
  }
  return true;
}

async function readReceiptFile(stateDir: string, hostId: HostId): Promise<ReceiptRead | null> {
  if (!assertRealHostsDir(stateDir)) {
    return null;
  }
  const file = receiptPath(stateDir, hostId);
  const target = lstatIfPresent(file);
  if (target === null) {
    return null;
  }
  if (!target.isFile()) {
    throw makeRealmError("PATH_ESCAPE");
  }
  let handle: FileHandle;
  try {
    handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (error: unknown) {
    const code = errnoOf(error);
    if (code === "ENOENT") {
      return null;
    }
    throw makeRealmError(code === "ELOOP" ? "PATH_ESCAPE" : "SCHEMA_INVALID");
  }
  try {
    const stats = await handle.stat();
    if (!stats.isFile()) {
      throw makeRealmError("PATH_ESCAPE");
    }
    if (stats.size > MAX_FILE_BYTES) {
      return reject();
    }
    const buffer = Buffer.alloc(MAX_FILE_BYTES + 1);
    const { bytesRead } = await handle.read(buffer, 0, MAX_FILE_BYTES + 1, 0);
    if (bytesRead > MAX_FILE_BYTES) {
      return reject();
    }
    const bytes = buffer.subarray(0, bytesRead);
    const receipt = parseReceipt(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (receipt.hostId !== hostId) {
      return reject();
    }
    return { receipt, sha256: sha256Hex(bytes) };
  } catch (error: unknown) {
    if (error instanceof RealmError) {
      throw error;
    }
    throw makeRealmError("SCHEMA_INVALID");
  } finally {
    await handle.close();
  }
}

// null when no receipt exists. A corrupt one is SCHEMA_INVALID; a symlinked hosts directory or file is
// PATH_ESCAPE; a read that does not finish in time is TOOL_TIMEOUT.
export function readReceipt(stateDir: string, hostId: HostId, readTimeoutMs: number = DEFAULT_READ_TIMEOUT_MS): Promise<ReceiptRead | null> {
  return withTimeout(readReceiptFile(stateDir, hostId), readTimeoutMs, "TOOL_TIMEOUT");
}

export interface WriteReceiptOptions {
  // Hash of the receipt the caller read, or null when it saw none. Default: the hash on disk now.
  readonly expectedPriorSha256?: string | null;
}

// Writes the receipt atomically and returns the hash of what was written. A receipt that changed since
// expectedPriorSha256 loses with WRITE_NOT_ATOMIC.
export function writeReceipt(stateDir: string, receipt: Receipt, options: WriteReceiptOptions = {}): string {
  assertRealHostsDir(stateDir);
  mkdirSync(join(stateDir, "hosts"), { recursive: true, mode: 0o700 });
  let realState: string;
  try {
    realState = realpathSync(stateDir);
  } catch {
    throw makeRealmError("PATH_ESCAPE");
  }
  const file = receiptPath(realState, receipt.hostId);
  const text = serializeReceipt(receipt);
  const prior = options.expectedPriorSha256 === undefined ? observeSha256(file) : options.expectedPriorSha256;
  try {
    atomicWriteFile(file, text, { expectedPriorSha256: prior });
  } catch (error: unknown) {
    if (error instanceof RealmError && error.code === "LOCK_CONFLICT") {
      throw makeRealmError("WRITE_NOT_ATOMIC", "LOCK_CONFLICT");
    }
    throw error;
  }
  return sha256Hex(text);
}

// Deletes the receipt only while it still has the hash the caller read.
export function removeReceipt(stateDir: string, hostId: HostId, expectedSha256: string): void {
  if (!assertRealHostsDir(stateDir)) {
    return;
  }
  const file = receiptPath(stateDir, hostId);
  if (observeSha256(file) !== expectedSha256) {
    throw makeRealmError("WRITE_NOT_ATOMIC", "LOCK_CONFLICT");
  }
  rmSync(file, { force: true });
}

// Capability keyring at rest (CAPT-03, D-32-04): STATE_DIR/capability/keys.json.
//
// The directory is mode 0700 and the file mode 0600, both owned by the current user, neither a symlink, the file a
// regular file of at most 64 KiB. Every guard failure, and every malformed content, is POLICY_DENIED with no
// detail. Rotation appends a new active key and keeps the previous one verifying until no token it signed can be
// live; revocation removes every non-active key at once.
//
// Privacy rule: a key value never enters an error, a log or any value this module returns other than through the
// lookup closure of a snapshot. Snapshots hold keys in a closure, so inspect, JSON and toString of a snapshot show
// no key bytes.

import { Buffer } from "node:buffer";
import { randomBytes as cryptoRandomBytes } from "node:crypto";
import {
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
  type Stats,
} from "node:fs";
import { join } from "node:path";
import { makeRealmError } from "../core/errors.js";
import { atomicWriteFile, sha256Hex, syncDirectory, tempFileName } from "../fs/atomic-write.js";
import { KEY_BYTES, type KeyLookup } from "./token.js";

const KEYRING_DIR = "capability";
const KEYRING_FILE = "keys.json";
const KEYRING_VERSION = 1;
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;
const MAX_FILE_BYTES = 64 * 1024;
// A retired key verifies until retiredAt plus the longest token life plus the clock skew (src/capability/token.ts).
const KEY_GRACE_SECONDS = 86400 + 60;
const KID_PATTERN = /^[a-z0-9]{1,16}$/;
const COUNTER_KID = /^k([0-9]{1,15})$/;
const KEY_TEXT_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const ENTRY_KEYS = Object.freeze(["kid", "key", "createdAt"]);
const TOP_KEYS = Object.freeze(["version", "active", "keys"]);

// Test seams. Production passes none: the uid is the process user, the clock is the machine clock in whole
// seconds, the key source is the system CSPRNG.
export interface KeyringOptions {
  readonly uid?: number;
  readonly now?: () => number;
  readonly randomBytes?: (size: number) => Buffer;
}

// The file's identity, so a caller can reload when it changes.
export interface KeyringIdentity {
  readonly ino: number;
  readonly mtimeMs: number;
  readonly size: number;
}

export interface RetiredKey {
  readonly kid: string;
  readonly retiredAt: number;
  // True when the key can no longer verify any live token (its grace is over) and rotation would prune it.
  readonly pastGrace: boolean;
}

export interface KeyringSnapshot {
  readonly active: string;
  readonly retired: readonly RetiredKey[];
  // The key bytes for a kid, or undefined for an unknown kid, a revoked kid and a retired kid past its grace.
  readonly lookup: KeyLookup;
  readonly identity: KeyringIdentity;
}

export type KeyringRead =
  | { readonly present: false }
  | { readonly present: true; readonly snapshot: KeyringSnapshot };

export interface RotationResult {
  readonly active: string;
  // The non-active kids that remain after the rotation.
  readonly retired: readonly string[];
  // The kids removed because revokePrevious was given.
  readonly revoked: readonly string[];
}

interface Entry {
  readonly kid: string;
  readonly key: Buffer;
  readonly createdAt: number;
  readonly retiredAt: number | null;
}

interface Parsed {
  readonly active: string;
  readonly entries: readonly Entry[];
}

interface Loaded {
  readonly parsed: Parsed;
  readonly sha256: string;
  readonly identity: KeyringIdentity;
}

export function keyringPathOf(stateDir: string): string {
  return join(stateDir, KEYRING_DIR, KEYRING_FILE);
}

function nowSeconds(options: KeyringOptions): number {
  return options.now === undefined ? Math.floor(Date.now() / 1000) : options.now();
}

function currentUid(options: KeyringOptions): number {
  const uid = options.uid ?? process.getuid?.();
  if (uid === undefined) {
    // A stat with no uid to compare to is never trusted.
    throw makeRealmError("POLICY_DENIED");
  }
  return uid;
}

function isAbsent(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

// The directory must be a real directory (never a symlink), mode 0700, owned by the user. Absent is not an error.
function directoryPresent(dir: string, uid: number): boolean {
  let stat: Stats;
  try {
    stat = lstatSync(dir);
  } catch (error: unknown) {
    if (isAbsent(error)) {
      return false;
    }
    throw makeRealmError("POLICY_DENIED");
  }
  if (!stat.isDirectory() || (stat.mode & 0o777) !== DIR_MODE || stat.uid !== uid) {
    throw makeRealmError("POLICY_DENIED");
  }
  return true;
}

function assertKeyFile(stat: Stats, uid: number): void {
  if (!stat.isFile() || (stat.mode & 0o777) !== FILE_MODE || stat.uid !== uid || stat.size > MAX_FILE_BYTES) {
    throw makeRealmError("POLICY_DENIED");
  }
}

function identityOf(stat: Stats): KeyringIdentity {
  return { ino: stat.ino, mtimeMs: stat.mtimeMs, size: stat.size };
}

// Reads the file through a descriptor that is checked again after the open, so a swap between the lstat and the
// open is caught. Returns null when the file or its directory is absent.
function readGuarded(stateDir: string, options: KeyringOptions): { text: Buffer; identity: KeyringIdentity } | null {
  const uid = currentUid(options);
  if (!directoryPresent(join(stateDir, KEYRING_DIR), uid)) {
    return null;
  }
  const path = keyringPathOf(stateDir);
  let named: Stats;
  try {
    named = lstatSync(path);
  } catch (error: unknown) {
    if (isAbsent(error)) {
      return null;
    }
    throw makeRealmError("POLICY_DENIED");
  }
  assertKeyFile(named, uid);
  let fd: number;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch {
    throw makeRealmError("POLICY_DENIED");
  }
  try {
    const opened = fstatSync(fd);
    assertKeyFile(opened, uid);
    if (opened.dev !== named.dev || opened.ino !== named.ino) {
      throw makeRealmError("POLICY_DENIED");
    }
    const text = readFileSync(fd);
    if (text.length > MAX_FILE_BYTES) {
      throw makeRealmError("POLICY_DENIED");
    }
    return { text, identity: identityOf(opened) };
  } catch {
    throw makeRealmError("POLICY_DENIED");
  } finally {
    closeSync(fd);
  }
}

function isSafeCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function entryOf(value: unknown): Entry {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw makeRealmError("POLICY_DENIED");
  }
  const record = value as Readonly<Record<string, unknown>>;
  const names = Object.keys(record);
  const hasRetired = names.length === ENTRY_KEYS.length + 1;
  const expected = hasRetired ? [...ENTRY_KEYS, "retiredAt"] : ENTRY_KEYS;
  if (names.length !== expected.length || !expected.every((name, index) => names[index] === name)) {
    throw makeRealmError("POLICY_DENIED");
  }
  const { kid, key, createdAt, retiredAt } = record;
  if (
    typeof kid !== "string" ||
    !KID_PATTERN.test(kid) ||
    typeof key !== "string" ||
    !KEY_TEXT_PATTERN.test(key) ||
    !isSafeCount(createdAt) ||
    (hasRetired && !isSafeCount(retiredAt))
  ) {
    throw makeRealmError("POLICY_DENIED");
  }
  const bytes = Buffer.from(key, "base64url");
  if (bytes.length !== KEY_BYTES || bytes.toString("base64url") !== key) {
    bytes.fill(0);
    throw makeRealmError("POLICY_DENIED");
  }
  return { kid, key: bytes, createdAt, retiredAt: hasRetired && isSafeCount(retiredAt) ? retiredAt : null };
}

function parseKeyring(text: Buffer): Parsed {
  let value: unknown;
  try {
    value = JSON.parse(text.toString("utf8"));
  } catch {
    throw makeRealmError("POLICY_DENIED");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw makeRealmError("POLICY_DENIED");
  }
  const record = value as Readonly<Record<string, unknown>>;
  const names = Object.keys(record);
  if (names.length !== TOP_KEYS.length || !TOP_KEYS.every((name, index) => names[index] === name)) {
    throw makeRealmError("POLICY_DENIED");
  }
  const { version, active, keys } = record;
  if (version !== KEYRING_VERSION || typeof active !== "string" || !Array.isArray(keys) || keys.length === 0) {
    throw makeRealmError("POLICY_DENIED");
  }
  const raw: readonly unknown[] = keys;
  const entries: Entry[] = [];
  try {
    for (const item of raw) {
      const entry = entryOf(item);
      const activeEntry = entry.kid === active;
      // The active key has no retiredAt; every other key has one, or it would never expire.
      if (entries.some((known) => known.kid === entry.kid) || activeEntry !== (entry.retiredAt === null)) {
        entry.key.fill(0);
        throw makeRealmError("POLICY_DENIED");
      }
      entries.push(entry);
    }
    if (!entries.some((entry) => entry.kid === active)) {
      throw makeRealmError("POLICY_DENIED");
    }
  } catch (error: unknown) {
    for (const entry of entries) {
      entry.key.fill(0);
    }
    throw error;
  }
  return { active, entries };
}

function load(stateDir: string, options: KeyringOptions): Loaded | null {
  const read = readGuarded(stateDir, options);
  if (read === null) {
    return null;
  }
  // The file bytes hold every key, so they are zero-filled on every path, a refusal included.
  try {
    return { parsed: parseKeyring(read.text), sha256: sha256Hex(read.text), identity: read.identity };
  } finally {
    read.text.fill(0);
  }
}

function snapshotOf(loaded: Loaded, options: KeyringOptions): KeyringSnapshot {
  const { active, entries } = loaded.parsed;
  const keys = new Map(entries.map((entry) => [entry.kid, entry] as const));
  const lookup: KeyLookup = (kid) => {
    const entry = keys.get(kid);
    if (entry === undefined) {
      return undefined;
    }
    if (entry.retiredAt !== null && entry.retiredAt + KEY_GRACE_SECONDS <= nowSeconds(options)) {
      return undefined;
    }
    return entry.key;
  };
  const now = nowSeconds(options);
  const retired = entries.flatMap((entry): RetiredKey[] =>
    entry.retiredAt === null
      ? []
      : [{ kid: entry.kid, retiredAt: entry.retiredAt, pastGrace: entry.retiredAt + KEY_GRACE_SECONDS <= now }],
  );
  return Object.freeze({ active, retired: Object.freeze(retired), lookup, identity: loaded.identity });
}

// Reads and checks the keyring. An absent file (or directory) is { present: false }, not an error. Anything else
// that is wrong is POLICY_DENIED.
export function readKeyring(stateDir: string, options: KeyringOptions = {}): KeyringRead {
  const loaded = load(stateDir, options);
  return loaded === null ? { present: false } : { present: true, snapshot: snapshotOf(loaded, options) };
}

// The identity of the key file, or null when it is absent. Does not read the file or check its guards (a reload
// that follows does).
export function keyringIdentity(stateDir: string): KeyringIdentity | null {
  try {
    return identityOf(lstatSync(keyringPathOf(stateDir)));
  } catch (error: unknown) {
    if (isAbsent(error)) {
      return null;
    }
    throw makeRealmError("POLICY_DENIED");
  }
}

function serialize(active: string, entries: readonly Entry[]): string {
  const keys = entries.map((entry) => ({
    kid: entry.kid,
    key: entry.key.toString("base64url"),
    createdAt: entry.createdAt,
    ...(entry.retiredAt === null ? {} : { retiredAt: entry.retiredAt }),
  }));
  return `${JSON.stringify({ version: KEYRING_VERSION, active, keys }, null, 2)}\n`;
}

function newKey(options: KeyringOptions): Buffer {
  const source = options.randomBytes ?? ((size: number): Buffer => cryptoRandomBytes(size));
  const key = source(KEY_BYTES);
  if (key.length !== KEY_BYTES) {
    key.fill(0);
    throw makeRealmError("POLICY_DENIED");
  }
  return key;
}

// Creates the directory (0700) when absent and re-checks it, so a race or an odd umask cannot leave a loose one.
function ensureDirectory(stateDir: string, uid: number): void {
  const dir = join(stateDir, KEYRING_DIR);
  if (!directoryPresent(dir, uid)) {
    try {
      mkdirSync(dir, { recursive: true, mode: DIR_MODE });
    } catch {
      throw makeRealmError("POLICY_DENIED");
    }
    if (!directoryPresent(dir, uid)) {
      throw makeRealmError("POLICY_DENIED");
    }
  }
}

// Writes the first file with create-exclusive semantics and complete content: a temp file is linked to the target,
// and a link fails when the target exists, so a racing creator wins whole or not at all.
function createFirstFile(stateDir: string, text: string): void {
  const dir = join(stateDir, KEYRING_DIR);
  const temp = join(dir, tempFileName(KEYRING_FILE));
  try {
    const fd = openSync(temp, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, FILE_MODE);
    try {
      fchmodSync(fd, FILE_MODE);
      writeFileSync(fd, text);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    try {
      linkSync(temp, keyringPathOf(stateDir));
    } catch (error: unknown) {
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) {
        throw error;
      }
      // Another creator won; the caller reads its file.
      return;
    }
    syncDirectory(dir);
  } catch {
    throw makeRealmError("WRITE_NOT_ATOMIC");
  } finally {
    rmSync(temp, { force: true });
  }
}

// Returns the keyring, creating it with one active key k1 when absent. An existing valid file is returned untouched.
// Two racing callers produce one key, and both then read the same file.
export function ensureKeyring(stateDir: string, options: KeyringOptions = {}): KeyringSnapshot {
  const existing = readKeyring(stateDir, options);
  if (existing.present) {
    return existing.snapshot;
  }
  ensureDirectory(stateDir, currentUid(options));
  const key = newKey(options);
  try {
    const first: Entry = { kid: "k1", key, createdAt: nowSeconds(options), retiredAt: null };
    createFirstFile(stateDir, serialize("k1", [first]));
  } finally {
    key.fill(0);
  }
  const created = readKeyring(stateDir, options);
  if (!created.present) {
    throw makeRealmError("POLICY_DENIED");
  }
  return created.snapshot;
}

function nextKid(entries: readonly Entry[]): string {
  let highest = 0;
  for (const entry of entries) {
    const match = COUNTER_KID.exec(entry.kid);
    const counter = match?.[1];
    if (counter !== undefined) {
      highest = Math.max(highest, Number(counter));
    }
  }
  const kid = `k${String(highest + 1)}`;
  if (!KID_PATTERN.test(kid)) {
    throw makeRealmError("POLICY_DENIED");
  }
  return kid;
}

// Appends a new active key. Planned (default): the previous active key is stamped retired and keeps verifying for
// its grace, and retired keys past their grace are pruned. revokePrevious: every non-active key, the previous
// active one included, is removed at once. The write is atomic and fails with LOCK_CONFLICT when the file changed
// since it was read. An absent keyring is created, with no retired and no revoked kid.
export function rotateKeyring(
  stateDir: string,
  request: { readonly revokePrevious: boolean },
  options: KeyringOptions = {},
): RotationResult {
  const loaded = load(stateDir, options);
  if (loaded === null) {
    return { active: ensureKeyring(stateDir, options).active, retired: [], revoked: [] };
  }
  const now = nowSeconds(options);
  const { active, entries } = loaded.parsed;
  const key = newKey(options);
  const kid = nextKid(entries);
  const kept: Entry[] = [];
  const revoked: string[] = [];
  for (const entry of entries) {
    if (request.revokePrevious) {
      revoked.push(entry.kid);
    } else if (entry.kid === active) {
      kept.push({ ...entry, retiredAt: now });
    } else if (entry.retiredAt !== null && entry.retiredAt + KEY_GRACE_SECONDS > now) {
      kept.push(entry);
    }
  }
  const next: readonly Entry[] = [...kept, { kid, key, createdAt: now, retiredAt: null }];
  try {
    atomicWriteFile(keyringPathOf(stateDir), serialize(kid, next), { expectedPriorSha256: loaded.sha256 });
  } finally {
    key.fill(0);
    for (const entry of entries) {
      entry.key.fill(0);
    }
  }
  return { active: kid, retired: kept.map((entry) => entry.kid), revoked };
}

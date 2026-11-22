// The cross-process workspace binding lock (CBIND-03, D-v9-6). One lock file per session id at
// `<stateDir>/bindings/<sessionId>.lock` names the single live binder of that workspace: its pid, its
// start time in clock ticks, the boot id, the session id and the workspace (dev, ino).
//
// The lock is published whole. The owner record is written and synced to a temporary file in the bindings
// directory, then linked to the lock path with link(2). link fails with EEXIST when the lock exists, so the
// lock path either does not exist or already holds the full record. A crash before the link leaves only a
// temporary name, which no reader opens and which does not block a later acquisition.
//
// A lock is taken over only when its owner is provably gone (the pid is not alive, its start time differs,
// or the boot differs). A live or unprovable owner keeps the lock. Acquisition waits FIFO in arrival order
// within this process, and polls cross-process, bounded by the caller's own wait budget: a binder with no
// wait budget is refused LOCK_CONFLICT, and a wait that expires on the up path is TOOL_TIMEOUT. No new
// catalogue code. A lock file that is not a regular file, empty or malformed is refused (LOCK_CONFLICT),
// never followed and never taken over.
//
// Modeled on checkpoint-lock.ts (same publish protocol, same provably-gone rule, same cap of 3 takeover
// attempts), not by extending it: the binding lock has the wait discipline and the workspace identity that
// the checkpoint lock does not.

import { randomBytes } from "node:crypto";
import {
  closeSync,
  constants,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { makeRealmError, RealmError } from "../core/errors.js";
import { errnoOf, openVerified } from "../fs/canonicalize.js";
import { currentBootId, startTicksOf } from "./proc-identity.js";
import { bindingsDirOf, bindingLockPathOf } from "./paths.js";

const TEMP_PREFIX = ".lock.tmp-";
const LOCK_SCHEMA = 1;
const OWNER_FILE_MODE = 0o600;
const BINDINGS_DIR_MODE = 0o700;
// A stale lock is taken over at most this many times before the operation is refused.
const LOCK_TAKEOVER_ATTEMPTS = 3;
// FIFO poll interval while waiting for a held binding. The total wait stays bounded by the caller.
const POLL_INTERVAL_MS = 5;
// Test seam: removes a lock file. A test replaces unlink to make a release fail, and restores unlinkSync afterwards.
export const bindingRemoval: { unlink: (path: string) => void } = { unlink: unlinkSync };

// The owner recorded in the lock file. The start time is kept as its decimal text, as the file stores it.
interface OwnerRecord {
  readonly schema: typeof LOCK_SCHEMA;
  readonly pid: number;
  readonly startTicks: string;
  readonly bootId: string;
  readonly sessionId: string;
  readonly dev: number;
  readonly ino: number;
}

// Untrusted JSON read from disk. Each field is checked with typeof before it is used.
interface RawOwner {
  readonly schema?: unknown;
  readonly pid?: unknown;
  readonly startTicks?: unknown;
  readonly bootId?: unknown;
  readonly sessionId?: unknown;
  readonly dev?: unknown;
  readonly ino?: unknown;
}

export interface BindingOptions {
  // The caller's existing wait budget (upLockWaitMs for up, downLockWaitMs for down). Zero means refuse
  // LOCK_CONFLICT immediately when held. A wait that expires is TOOL_TIMEOUT.
  readonly waitMs: number;
  // The workspace identity, recorded on the owner record for the pre-create re-verification.
  readonly dev: number;
  readonly ino: number;
}

export interface BindingHandle {
  readonly lockPath: string;
  readonly sessionId: string;
  // The release is returned, not thrown, so the caller decides: a warning after a commit, or the cause of
  // the error it is already throwing. Nothing is thrown from a finally.
  release(): { readonly ok: true } | { readonly ok: false; readonly error: RealmError };
}

// In-process FIFO order per lock path: each acquirer chains behind the previous one, so waiters in this
// process are granted in arrival order. The chain never rejects; a failed acquisition still releases it.
const fifoChains = new Map<string, Promise<void>>();

function enqueueFifo(lockPath: string): { readonly wait: Promise<void>; readonly done: () => void } {
  const prior = fifoChains.get(lockPath) ?? Promise.resolve();
  let releaseChain: () => void = () => undefined;
  const chain = new Promise<void>((resolve) => {
    releaseChain = resolve;
  });
  const next = prior.then(() => chain);
  fifoChains.set(lockPath, next);
  return {
    wait: prior,
    done: () => {
      releaseChain();
      if (fifoChains.get(lockPath) === next) {
        fifoChains.delete(lockPath);
      }
    },
  };
}

// Acquires the workspace binding or refuses. Holds the FIFO slot for this process for the whole wait, so a
// second binder here queues. On grant the returned handle releases the lock file.
export async function acquireBinding(
  stateDir: string,
  sessionId: string,
  options: BindingOptions,
): Promise<BindingHandle> {
  const lockPath = bindingLockPathOf(stateDir, sessionId);
  const fifo = enqueueFifo(lockPath);
  await fifo.wait;
  try {
    await acquireInner(stateDir, lockPath, sessionId, options);
    return {
      lockPath,
      sessionId,
      release: () => releaseBinding(lockPath),
    };
  } finally {
    fifo.done();
  }
}

// The synchronous fast path: publishes when the lock is free, takes over a provably-gone owner, and
// returns undefined when a live owner holds it (the caller then takes the FIFO wait path). No waiting.
export function tryAcquireBinding(
  stateDir: string,
  sessionId: string,
  options: BindingOptions,
): BindingHandle | undefined {
  const lockPath = bindingLockPathOf(stateDir, sessionId);
  const bindingsDir = bindingsDirOf(stateDir);
  mkdirSync(bindingsDir, { mode: BINDINGS_DIR_MODE, recursive: true });
  let takeovers = 0;
  for (;;) {
    if (publishBinding(bindingsDir, lockPath, sessionId, options)) {
      return { lockPath, sessionId, release: () => releaseBinding(lockPath) };
    }
    if (!takeOverProvablyGone(lockPath)) {
      return undefined;
    }
    takeovers += 1;
    if (takeovers >= LOCK_TAKEOVER_ATTEMPTS) {
      throw makeRealmError("LOCK_CONFLICT");
    }
  }
}

async function acquireInner(
  stateDir: string,
  lockPath: string,
  sessionId: string,
  options: BindingOptions,
): Promise<void> {
  const bindingsDir = bindingsDirOf(stateDir);
  mkdirSync(bindingsDir, { mode: BINDINGS_DIR_MODE, recursive: true });
  const deadline = Date.now() + Math.max(0, options.waitMs);
  let takeovers = 0;
  for (;;) {
    if (publishBinding(bindingsDir, lockPath, sessionId, options)) {
      return;
    }
    if (takeOverProvablyGone(lockPath)) {
      takeovers += 1;
      if (takeovers >= LOCK_TAKEOVER_ATTEMPTS) {
        throw makeRealmError("LOCK_CONFLICT");
      }
      continue;
    }
    if (Date.now() >= deadline) {
      if (options.waitMs > 0) {
        throw makeRealmError("TOOL_TIMEOUT");
      }
      throw makeRealmError("LOCK_CONFLICT");
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, POLL_INTERVAL_MS);
    });
  }
}

// Publishes the owner record at lockPath. Returns false when a lock already exists. The temporary name is
// removed on every path. A temporary name that cannot be removed refuses the acquisition with
// CLEANUP_FAILED; a lock this call published is released first, so a refused acquisition holds no lock.
function publishBinding(
  bindingsDir: string,
  lockPath: string,
  sessionId: string,
  options: BindingOptions,
): boolean {
  const tempPath = join(bindingsDir, `${TEMP_PREFIX}${randomBytes(8).toString("hex")}`);
  writeOwnerFile(tempPath, ownerRecordText(sessionId, options));
  const published = linkLock(tempPath, lockPath);
  const cleanup = removeTempFile(tempPath);
  if (cleanup !== undefined) {
    if (published) {
      releaseBinding(lockPath);
    }
    throw cleanup;
  }
  return published;
}

function ownerRecordText(sessionId: string, options: BindingOptions): string {
  const bootId = currentBootId() ?? "";
  const record: OwnerRecord = {
    schema: LOCK_SCHEMA,
    pid: process.pid,
    startTicks: String(startTicksOf(process.pid) ?? 0),
    bootId,
    sessionId,
    dev: options.dev,
    ino: options.ino,
  };
  return `${JSON.stringify(record)}\n`;
}

function writeOwnerFile(path: string, text: string): void {
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, OWNER_FILE_MODE);
  try {
    writeFileSync(fd, text, "utf8");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

// link(2) of the synced owner file to the lock path. EEXIST means the lock is held.
function linkLock(tempPath: string, lockPath: string): boolean {
  try {
    linkSync(tempPath, lockPath);
    return true;
  } catch (error) {
    if (errnoOf(error) === "EEXIST") {
      return false;
    }
    throw makeRealmError("CLEANUP_FAILED");
  }
}

// The temporary name is removed once the lock is published or refused. An absent name is already removed.
// A name that cannot be removed is returned as CLEANUP_FAILED, and publishBinding refuses the acquisition
// on it.
function removeTempFile(path: string): RealmError | undefined {
  try {
    unlinkSync(path);
    return undefined;
  } catch (error) {
    if (errnoOf(error) === "ENOENT") {
      return undefined;
    }
    return makeRealmError("CLEANUP_FAILED");
  }
}

// Removes an existing lock only when its owner is provably gone. Returns true when the lock is gone
// (absent, or taken over); false while a live or unprovable owner holds it, so the caller keeps polling
// until its wait budget expires. A malformed owner record is LOCK_CONFLICT, never taken over.
function takeOverProvablyGone(lockPath: string): boolean {
  const text = readLockFile(lockPath);
  if (text === undefined) {
    return true;
  }
  const owner = parseOwner(text);
  if (owner === undefined) {
    throw makeRealmError("LOCK_CONFLICT");
  }
  if (!ownerProvablyGone(owner)) {
    return false;
  }
  try {
    unlinkSync(lockPath);
  } catch {
    throw makeRealmError("LOCK_CONFLICT");
  }
  return true;
}

// Reads the lock file through openVerified, on the real path of the lock. Returns undefined when the lock
// is absent, which is the meaning of ENOENT. A lock that is not a regular file, or that cannot be verified
// or read, is LOCK_CONFLICT. openVerified refuses a FIFO without blocking on it, so a FIFO at the lock path
// is refused rather than hanging the open.
function readLockFile(lockPath: string): string | undefined {
  let stat;
  try {
    stat = lstatSync(lockPath);
  } catch (error) {
    if (errnoOf(error) === "ENOENT") {
      return undefined;
    }
    throw makeRealmError("LOCK_CONFLICT");
  }
  if (!stat.isFile()) {
    throw makeRealmError("LOCK_CONFLICT");
  }
  try {
    const real = realpathSync(lockPath);
    const fd = openVerified(real);
    try {
      return readFileSync(fd, "utf8");
    } finally {
      closeSync(fd);
    }
  } catch {
    throw makeRealmError("LOCK_CONFLICT");
  }
}

// The owner is provably gone when its boot differs, its pid is not alive, or its start time differs (the
// pid was reused). A live process whose start time cannot be read is unprovable, so it counts as live.
function ownerProvablyGone(owner: OwnerRecord): boolean {
  const boot = currentBootId();
  if (boot === null || owner.bootId !== boot) {
    return true;
  }
  if (!processAlive(owner.pid)) {
    return true;
  }
  const start = startTicksOf(owner.pid);
  return start !== undefined && String(start) !== owner.startTicks;
}

// Whether the pid names a live process. ESRCH proves it gone, and EPERM means it exists under another
// user. Any other failure leaves the owner unproven, so it counts as live.
function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return errnoOf(error) !== "ESRCH";
  }
}

function parseOwner(text: string): OwnerRecord | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (raw === null || typeof raw !== "object") {
    return undefined;
  }
  const owner = raw as RawOwner;
  if (owner.schema !== LOCK_SCHEMA) {
    return undefined;
  }
  if (typeof owner.pid !== "number" || !Number.isSafeInteger(owner.pid)) {
    return undefined;
  }
  if (typeof owner.startTicks !== "string") {
    return undefined;
  }
  if (typeof owner.bootId !== "string" || typeof owner.sessionId !== "string") {
    return undefined;
  }
  if (typeof owner.dev !== "number" || typeof owner.ino !== "number") {
    return undefined;
  }
  return {
    schema: LOCK_SCHEMA,
    pid: owner.pid,
    startTicks: owner.startTicks,
    bootId: owner.bootId,
    sessionId: owner.sessionId,
    dev: owner.dev,
    ino: owner.ino,
  };
}

// Releases the binding lock file. An absent file is already released. A failure to remove is
// CLEANUP_FAILED, returned not thrown.
export function releaseBinding(
  lockPath: string,
): { readonly ok: true } | { readonly ok: false; readonly error: RealmError } {
  try {
    bindingRemoval.unlink(lockPath);
    return { ok: true };
  } catch (error) {
    if (errnoOf(error) === "ENOENT") {
      return { ok: true };
    }
    return { ok: false, error: makeRealmError("CLEANUP_FAILED") };
  }
}


// Whether a live binder holds the binding: a lock file exists and its owner is not provably gone. A stale
// file from a dead binder does not block (the takeover rule handles it).
export function bindingIsLive(lockPath: string): boolean {
  const text = readLockFile(lockPath);
  if (text === undefined) {
    return false;
  }
  const owner = parseOwner(text);
  return owner !== undefined && !ownerProvablyGone(owner);
}


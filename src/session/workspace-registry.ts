// Workspace registry (C3, MULTI-02). Each admitted project has one entry at
// <stateDir>/workspaces/<sessionId>.json, holding { schema, sessionId, workspaceRoot, dev, ino }.
// The directory is mode 0700, each file mode 0600, and every write is atomic (the record store's
// primitive). The entry is the trust anchor for turning a sandbox name into a host path: a read
// refuses any entry whose id, path or identity does not derive from the requested id.

import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, closeSync } from "node:fs";
import { join } from "node:path";
import { makeRealmError, RealmError } from "../core/errors.js";
import {
  atomicWriteFile,
  observeSha256,
  syncDirectory,
  WriteNotAtomicError,
} from "../fs/atomic-write.js";
import { openCanonical } from "../fs/canonicalize.js";
import { bindRoot, PinnedRoot, verifyPinnedAt } from "../fs/root.js";
import { isSessionId, recordFileName, sessionIdOfWorkspace } from "./paths.js";

const DIRECTORY_MODE = 0o700;
const ENTRY_SUFFIX = ".json";
const ENTRY_SCHEMA = 1;
const ENTRY_FIELDS = "dev,ino,schema,sessionId,workspaceRoot";

export interface WorkspaceEntry {
  readonly schema: 1;
  readonly sessionId: string;
  readonly workspaceRoot: string;
  readonly dev: number;
  readonly ino: number;
}

export function workspaceRegistryDirOf(stateDir: string): string {
  return join(stateDir, "workspaces");
}

// The entry for a pinned project, built in memory and written nowhere. The id must be the one derived from the pinned
// realpath; any other id is SCHEMA_INVALID. writeWorkspaceEntry stores exactly this value, and a caller that pins a
// project for one command without registering it (realm checkpoint) builds the same value, so the two cannot drift.
export function workspaceEntryOf(pinned: PinnedRoot, sessionId: string): WorkspaceEntry {
  if (sessionId !== sessionIdOfWorkspace(pinned.realPath)) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  return {
    schema: ENTRY_SCHEMA,
    sessionId,
    workspaceRoot: pinned.realPath,
    dev: pinned.dev,
    ino: pinned.ino,
  };
}

// Writes the entry for a pinned project. The id must be the one derived from the pinned realpath; any
// other id is SCHEMA_INVALID and nothing is written.
export function writeWorkspaceEntry(stateDir: string, pinned: PinnedRoot, sessionId: string): WorkspaceEntry {
  const entry = workspaceEntryOf(pinned, sessionId);
  const fileName = recordFileName(sessionId);
  const dir = workspaceRegistryDirOf(stateDir);
  mkdirSync(dir, { recursive: true, mode: DIRECTORY_MODE });
  assertPrivateDirectory(dir);
  const root = bindRoot(dir);
  const target = join(root.realPath, fileName);
  const text = `${JSON.stringify(entry, null, 2)}\n`;
  atomicWriteFile(target, text, { expectedPriorSha256: observeSha256(target) });
  return entry;
}

// The stored entry for a session id, or null when there is none. A file that names another id or
// another directory, or whose schema is not 1, is SCHEMA_INVALID.
export function readWorkspaceEntry(stateDir: string, sessionId: string): WorkspaceEntry | null {
  const fileName = recordFileName(sessionId);
  const dir = workspaceRegistryDirOf(stateDir);
  if (!existsSync(dir)) {
    return null;
  }
  const opened = openCanonical(bindRoot(dir), fileName);
  if (opened.status === "absent") {
    return null;
  }
  let text: string;
  try {
    text = readFileSync(opened.fd, "utf8");
  } finally {
    closeSync(opened.fd);
  }
  return parseEntry(text, sessionId);
}

// Removes the entry for a session id. Removing an entry that does not exist is a no-op.
export function removeWorkspaceEntry(stateDir: string, sessionId: string): void {
  const fileName = recordFileName(sessionId);
  const dir = workspaceRegistryDirOf(stateDir);
  if (!existsSync(dir)) {
    return;
  }
  const realPath = bindRoot(dir).realPath;
  rmSync(join(realPath, fileName), { force: true });
  try {
    syncDirectory(realPath);
  } catch (error: unknown) {
    if (error instanceof RealmError) {
      throw error;
    }
    throw new WriteNotAtomicError(true);
  }
}

// The session ids of the entry files, sorted. A name is taken only when it is a regular file ending in
// .json whose stem passes isSessionId. No file is opened or parsed. An absent directory lists nothing.
export function listWorkspaceEntryIds(stateDir: string): readonly string[] {
  const dir = workspaceRegistryDirOf(stateDir);
  if (!existsSync(dir)) {
    return [];
  }
  const ids: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(ENTRY_SUFFIX)) {
      continue;
    }
    const sessionId = entry.name.slice(0, -ENTRY_SUFFIX.length);
    if (isSessionId(sessionId)) {
      ids.push(sessionId);
    }
  }
  return ids.sort();
}

// Checks that the entry's directory is still the directory it was pinned as. A moved directory, a
// directory replaced at the same path, and a link at the path are POLICY_DENIED (verifyPinnedAt).
export function verifyWorkspaceEntry(entry: WorkspaceEntry): PinnedRoot {
  const pinned = new PinnedRoot(entry.workspaceRoot, entry.dev, entry.ino);
  return verifyPinnedAt(pinned, entry.workspaceRoot);
}

// The registry directory must be a real directory, not a link, at mode 0700. Anything else is refused
// before a file is written or read under it.
function assertPrivateDirectory(dir: string): void {
  const stats = lstatSync(dir);
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw makeRealmError("PATH_ESCAPE");
  }
  if ((stats.mode & 0o777) !== DIRECTORY_MODE) {
    throw makeRealmError("POLICY_DENIED");
  }
}

function parseEntry(text: string, sessionId: string): WorkspaceEntry {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw makeRealmError("SCHEMA_INVALID");
  }
  const entry = entryFrom(parsed);
  if (entry.sessionId !== sessionId) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  if (sessionIdOfWorkspace(entry.workspaceRoot) !== sessionId) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  return entry;
}

// The exact field set and the field types. Anything else is SCHEMA_INVALID.
function entryFrom(value: unknown): WorkspaceEntry {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  const fields = value as Record<string, unknown>;
  if (Object.keys(fields).sort().join(",") !== ENTRY_FIELDS) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  const { schema, sessionId, workspaceRoot, dev, ino } = fields;
  if (
    schema !== ENTRY_SCHEMA ||
    typeof sessionId !== "string" ||
    typeof workspaceRoot !== "string" ||
    typeof dev !== "number" ||
    typeof ino !== "number" ||
    !Number.isSafeInteger(dev) ||
    !Number.isSafeInteger(ino)
  ) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  return { schema: ENTRY_SCHEMA, sessionId, workspaceRoot, dev, ino };
}

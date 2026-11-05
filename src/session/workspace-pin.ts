// Workspace pin record. Each session has one pin at <stateDir>/workspace-pins/<sessionId>.json,
// holding { schema, sessionId, workspaceRoot, realPath, dev, ino }. Each bind (up) writes the pin, replacing any
// earlier pin for the session. It is independent of the workspace registry entry, so it survives that entry's removal
// on down. The directory is mode 0700, each file mode 0600, and every write is atomic (the record
// store's primitive).
//
// This module never removes a pin. When a pin is removed (on down, on startup, or at teardown) is a
// removal policy decision and is left to its owner.

import { closeSync, existsSync, lstatSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { makeRealmError } from "../core/errors.js";
import { atomicWriteFile, observeSha256 } from "../fs/atomic-write.js";
import { openCanonical } from "../fs/canonicalize.js";
import { bindRoot, type PinnedRoot } from "../fs/root.js";
import { recordFileName, sessionIdOfWorkspace } from "./paths.js";
import { verifyWorkspaceEntry } from "./workspace-registry.js";

const DIRECTORY_MODE = 0o700;
const PIN_SCHEMA = 1;
const PIN_FIELDS = "dev,ino,realPath,schema,sessionId,workspaceRoot";

export interface WorkspacePin {
  readonly schema: 1;
  readonly sessionId: string;
  readonly workspaceRoot: string;
  readonly realPath: string;
  readonly dev: number;
  readonly ino: number;
}

export function workspacePinDirOf(stateDir: string): string {
  return join(stateDir, "workspace-pins");
}

// Binds the directory at the session path: writes the pin for the session id, replacing any pin stored under it. up is the
// caller that binds, so a directory replaced while the project was down is bound again here. create and restore verify
// the stored pin with verifyWorkspacePin from then on. A stored record that is malformed or names another id is SCHEMA_INVALID,
// and it is left as it is. The session id must derive from the pinned real path, otherwise the write is SCHEMA_INVALID and
// nothing is written. Returns the pin as written.
export function writeWorkspacePin(stateDir: string, pinned: PinnedRoot, sessionId: string): WorkspacePin {
  const fileName = recordFileName(sessionId);
  const dir = workspacePinDirOf(stateDir);
  mkdirSync(dir, { recursive: true, mode: DIRECTORY_MODE });
  assertPrivateDirectory(dir);
  const target = join(bindRoot(dir).realPath, fileName);
  // Observed before the stored record is read, so the rename below refuses a record that changed in between.
  const priorSha256 = observeSha256(target);
  // The stored record is read only to refuse a malformed one before it is replaced. Its content is not used.
  readWorkspacePin(stateDir, sessionId);
  if (sessionId !== sessionIdOfWorkspace(pinned.realPath)) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  const pin: WorkspacePin = {
    schema: PIN_SCHEMA,
    sessionId,
    workspaceRoot: pinned.realPath,
    realPath: pinned.realPath,
    dev: pinned.dev,
    ino: pinned.ino,
  };
  atomicWriteFile(target, `${JSON.stringify(pin, null, 2)}\n`, { expectedPriorSha256: priorSha256 });
  return pin;
}

// The stored pin for a session id, or null when there is none. A record that names another id, whose
// two paths disagree, whose id does not derive from its real path, or whose field set or types are wrong
// is SCHEMA_INVALID.
export function readWorkspacePin(stateDir: string, sessionId: string): WorkspacePin | null {
  const fileName = recordFileName(sessionId);
  const dir = workspacePinDirOf(stateDir);
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
  return parsePin(text, sessionId);
}

// Checks that the pinned directory is still the directory it was pinned as. The check is the registry's
// (verifyWorkspaceEntry): a moved directory, a directory replaced at the same path, and a link at the path
// are POLICY_DENIED.
export function verifyWorkspacePin(pin: WorkspacePin): PinnedRoot {
  return verifyWorkspaceEntry(pin);
}

// The pin directory must be a real directory, not a link, at mode 0700. Anything else is refused
// before a file is written under it.
function assertPrivateDirectory(dir: string): void {
  const stats = lstatSync(dir);
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw makeRealmError("PATH_ESCAPE");
  }
  if ((stats.mode & 0o777) !== DIRECTORY_MODE) {
    throw makeRealmError("POLICY_DENIED");
  }
}

function parsePin(text: string, sessionId: string): WorkspacePin {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw makeRealmError("SCHEMA_INVALID");
  }
  const pin = pinFrom(parsed);
  if (pin.sessionId !== sessionId || pin.workspaceRoot !== pin.realPath) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  if (sessionIdOfWorkspace(pin.realPath) !== sessionId) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  return pin;
}

// The exact field set and the field types. Anything else is SCHEMA_INVALID.
function pinFrom(value: unknown): WorkspacePin {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  const fields = value as Record<string, unknown>;
  if (Object.keys(fields).sort().join(",") !== PIN_FIELDS) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  const { schema, sessionId, workspaceRoot, realPath, dev, ino } = fields;
  if (
    schema !== PIN_SCHEMA ||
    typeof sessionId !== "string" ||
    typeof workspaceRoot !== "string" ||
    typeof realPath !== "string" ||
    typeof dev !== "number" ||
    typeof ino !== "number" ||
    !Number.isSafeInteger(dev) ||
    !Number.isSafeInteger(ino)
  ) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  return { schema: PIN_SCHEMA, sessionId, workspaceRoot, realPath, dev, ino };
}

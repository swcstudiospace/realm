// Session record persistence (D-37, RT-07). Records live at
// <stateDir>/sessions/<sessionId>.json, the directory at mode 0700 and each record at
// mode 0600. Every write is validated against the frozen session-record schema and
// goes through the atomic replace without a lock, because the realm owns these files.
//
// D-14 one-way: later phases read these files (reaping in Phase 4 keys off them). A
// change to the field set or the location needs a migration, so the record carries
// exactly the frozen fields and no token, secret, or environment value.

import { existsSync, closeSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { validate, type SessionRecord } from "../contract/validate.js";
import { makeRealmError } from "../core/errors.js";
import { atomicWriteFile, observeSha256 } from "../fs/atomic-write.js";
import { openCanonical } from "../fs/canonicalize.js";
import { bindRoot } from "../fs/root.js";
import { recordFileName, sessionsDirOf } from "./paths.js";

const DIRECTORY_MODE = 0o700;
const RECORD_SUFFIX = ".json";

export class SessionStore {
  readonly stateDir: string;

  constructor(stateDir: string) {
    this.stateDir = stateDir;
  }

  save(record: SessionRecord): void {
    const checked = validate("sessionRecord", record);
    if (!checked.ok) {
      throw checked.error;
    }
    const fileName = recordFileName(record.sessionId);
    const dir = sessionsDirOf(this.stateDir);
    mkdirSync(dir, { recursive: true, mode: DIRECTORY_MODE });
    const root = bindRoot(dir);
    const target = join(root.realPath, fileName);
    const text = `${JSON.stringify(orderedFields(checked.value), null, 2)}\n`;
    atomicWriteFile(target, text, { expectedPriorSha256: observeSha256(target) });
  }

  // The stored record, or null when the session has no record.
  load(sessionId: string): SessionRecord | null {
    const fileName = recordFileName(sessionId);
    const dir = sessionsDirOf(this.stateDir);
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
    return parseRecord(text);
  }

  // The session ids of the record files, sorted (D-85). A name is taken only when it is a regular file
  // ending in .json whose stem passes recordFileName. No file is opened or parsed, so a corrupt record is
  // still listed and can be deleted. An absent sessions directory lists nothing.
  list(): string[] {
    const dir = sessionsDirOf(this.stateDir);
    if (!existsSync(dir)) {
      return [];
    }
    const ids: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(RECORD_SUFFIX)) {
        continue;
      }
      const sessionId = entry.name.slice(0, -RECORD_SUFFIX.length);
      try {
        recordFileName(sessionId);
      } catch {
        continue;
      }
      ids.push(sessionId);
    }
    return ids.sort();
  }

  // Removing a record that does not exist is a no-op.
  delete(sessionId: string): void {
    const fileName = recordFileName(sessionId);
    const dir = sessionsDirOf(this.stateDir);
    if (!existsSync(dir)) {
      return;
    }
    rmSync(join(bindRoot(dir).realPath, fileName), { force: true });
  }
}

// Fixed field order, with containerId written as null until the container exists.
function orderedFields(record: SessionRecord): Record<string, string | null> {
  return {
    realmId: record.realmId,
    sessionId: record.sessionId,
    workspaceRoot: record.workspaceRoot,
    state: record.state,
    controlSocketPath: record.controlSocketPath,
    containerId: record.containerId ?? null,
  };
}

function parseRecord(text: string): SessionRecord {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw makeRealmError("SCHEMA_INVALID");
  }
  const checked = validate("sessionRecord", parsed);
  if (!checked.ok) {
    throw checked.error;
  }
  return checked.value;
}

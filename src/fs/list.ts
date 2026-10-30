// Reported directory list (D-36, FS-01, FS-03). Canonicalizes first and applies the
// credential check to the listed directory. Entries are reported with their kind; symlinks
// are reported with their link text and are never followed. At most MAX_LIST_ENTRIES
// entries are returned, sorted by name, and truncated is set when more exist.

import { readdirSync, readlinkSync, type Dirent } from "node:fs";
import { join } from "node:path";
import { makeRealmError } from "../core/errors.js";
import { canonicalize, lstatIfPresent } from "./canonicalize.js";
import { assertCredentialAccess, relPathOf } from "./credentials.js";
import type { PinnedRoot } from "./root.js";

const MAX_LIST_ENTRIES = 1000;

export type EntryKind = "file" | "dir" | "symlink" | "other";

export interface ListEntry {
  readonly name: string;
  readonly kind: EntryKind;
  // Present only for symlinks: the link text, read without following the link.
  readonly target?: string;
}

export interface ListFound {
  readonly status: "found";
  readonly entries: readonly ListEntry[];
  readonly truncated: boolean;
}

export interface ListAbsent {
  readonly status: "absent";
}

export type ListResult = ListFound | ListAbsent;

export interface ListOptions {
  readonly credentialAllow: readonly string[];
}

export function listDir(root: PinnedRoot, relPath: string, options: ListOptions): ListResult {
  const resolved = canonicalize(root, relPath, { mode: "read" });
  assertCredentialAccess(relPathOf(root, resolved), options.credentialAllow);
  if (resolved.status === "absent") {
    return { status: "absent" };
  }
  const dir = resolved.realPath;
  const stats = lstatIfPresent(dir);
  if (stats === null || !stats.isDirectory()) {
    throw makeRealmError("PATH_ESCAPE");
  }
  const dirents = readDirOrEscape(dir).sort(byName);
  return {
    status: "found",
    entries: dirents.slice(0, MAX_LIST_ENTRIES).map((entry) => describeEntry(dir, entry)),
    truncated: dirents.length > MAX_LIST_ENTRIES,
  };
}

function byName(a: { readonly name: string }, b: { readonly name: string }): number {
  if (a.name === b.name) {
    return 0;
  }
  return a.name < b.name ? -1 : 1;
}

function describeEntry(dir: string, entry: Dirent): ListEntry {
  if (entry.isSymbolicLink()) {
    return { name: entry.name, kind: "symlink", target: readLinkOrEscape(join(dir, entry.name)) };
  }
  return { name: entry.name, kind: kindOf(entry) };
}

function kindOf(entry: Dirent): EntryKind {
  if (entry.isFile()) {
    return "file";
  }
  if (entry.isDirectory()) {
    return "dir";
  }
  return "other";
}

// A directory that cannot be read cannot be verified, so it fails closed with PATH_ESCAPE.
function readDirOrEscape(dir: string) {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    throw makeRealmError("PATH_ESCAPE");
  }
}

function readLinkOrEscape(path: string): string {
  try {
    return readlinkSync(path);
  } catch {
    throw makeRealmError("PATH_ESCAPE");
  }
}

// Capped read (D-36, FS-01, FS-02, FS-03). The order is fixed: canonicalize (PATH_ESCAPE
// first), credential check on the canonical path, the resolve-to-open hook, then the
// verified open (D-30). Non-regular files are PATH_ESCAPE. At most maxBytes of content are
// returned; sha256 covers the whole file, so it matches the hash a locked write compares
// against (ifMatchSha256).

import { createHash } from "node:crypto";
import { closeSync, fstatSync, readSync } from "node:fs";
import { makeRealmError } from "../core/errors.js";
import { canonicalize, lstatIfPresent, openVerified, type OpenOptions } from "./canonicalize.js";
import { assertCredentialAccess, relPathOf } from "./credentials.js";
import type { PinnedRoot } from "./root.js";

const CHUNK_BYTES = 64 * 1024;

export interface ReadOptions extends OpenOptions {
  readonly maxBytes: number;
  readonly credentialAllow: readonly string[];
}

export interface ReadFound {
  readonly status: "found";
  readonly content: Uint8Array;
  readonly sha256: string;
  readonly truncated: boolean;
}

export interface ReadAbsent {
  readonly status: "absent";
}

export type ReadResult = ReadFound | ReadAbsent;

export function readFileCapped(root: PinnedRoot, relPath: string, options: ReadOptions): ReadResult {
  const resolved = canonicalize(root, relPath, { mode: "read" });
  assertCredentialAccess(relPathOf(root, resolved), options.credentialAllow);
  if (resolved.status === "absent") {
    return { status: "absent" };
  }
  requireRegular(lstatIfPresent(resolved.realPath));
  options.onResolveBoundary?.(resolved.realPath);
  const fd = openVerified(resolved.realPath, options.procFdDir);
  try {
    requireRegular(fstatSync(fd));
    return captureCapped(fd, options.maxBytes);
  } finally {
    closeSync(fd);
  }
}

// A FIFO, device, socket, or directory is not readable content. Checking before the open
// keeps a FIFO from blocking the open; checking the descriptor catches a swap after it.
function requireRegular(stats: { isFile(): boolean } | null): void {
  if (stats === null || !stats.isFile()) {
    throw makeRealmError("PATH_ESCAPE");
  }
}

function captureCapped(fd: number, maxBytes: number): ReadFound {
  const hash = createHash("sha256");
  const chunk = Buffer.alloc(CHUNK_BYTES);
  const kept: Buffer[] = [];
  let keptBytes = 0;
  let total = 0;
  for (;;) {
    const count = readSync(fd, chunk, 0, chunk.length, null);
    if (count === 0) {
      break;
    }
    total += count;
    hash.update(chunk.subarray(0, count));
    const room = maxBytes - keptBytes;
    if (room > 0) {
      const take = Math.min(room, count);
      kept.push(Buffer.from(chunk.subarray(0, take)));
      keptBytes += take;
    }
  }
  return {
    status: "found",
    content: Buffer.concat(kept),
    sha256: hash.digest("hex"),
    truncated: total > maxBytes,
  };
}

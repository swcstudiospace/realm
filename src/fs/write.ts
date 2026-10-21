// Locked write (D-34, FS-04, FS-05). The order is fixed and must not change:
//   1. canonicalize in write mode (parent present and inside the root; symlink at target
//      is PATH_ESCAPE);
//   2. credential check on the canonical relative path;
//   3. acquire the advisory lock (LOCK_CONFLICT leaves the file untouched);
//   4. observe the current content hash, or absence;
//   5. ifMatchSha256, when given, must equal the observed hash (absent is a mismatch);
//   6. atomic replace (D-35) with the observed hash as the expected prior state;
//   7. release the lock in a finally.
// The lock is taken before the prior hash is observed, so the observation cannot race a
// cooperating writer. A non-cooperating writer is caught by the re-check before rename.

import { join } from "node:path";
import { makeRealmError } from "../core/errors.js";
import {
  atomicWriteFile,
  observeSha256,
  sha256Hex,
  type AtomicWriteOptions,
  type StageHook,
} from "./atomic-write.js";
import { canonicalize } from "./canonicalize.js";
import { assertCredentialAccess, relPathOf } from "./credentials.js";
import type { LockTable } from "./locks.js";
import type { PinnedRoot } from "./root.js";

export interface LockedWriteOptions {
  readonly owner: string;
  readonly locks: LockTable;
  readonly credentialAllow: readonly string[];
  // When present, the write proceeds only if the observed hash equals it. An absent target
  // counts as a mismatch.
  readonly ifMatchSha256?: string;
  // Fault-injection seam (D-35), passed through to atomicWriteFile. Production callers do
  // not pass it.
  readonly stageHook?: StageHook;
}

export interface LockedWriteResult {
  readonly sha256: string;
}

export function lockedWrite(
  root: PinnedRoot,
  relPath: string,
  content: string | Uint8Array,
  options: LockedWriteOptions,
): LockedWriteResult {
  const resolved = canonicalize(root, relPath, { mode: "write" });
  if (resolved.status === "absent" && resolved.missing.length !== 1) {
    throw makeRealmError("PATH_ESCAPE");
  }
  const target =
    resolved.status === "found" ? resolved.realPath : join(resolved.nearest, ...resolved.missing);

  assertCredentialAccess(relPathOf(root, resolved), options.credentialAllow);

  const alreadyHeld = options.locks.isHeldBy(target, options.owner);
  const handle = options.locks.acquire(target, options.owner);
  try {
    const observed = observeSha256(target);
    if (options.ifMatchSha256 !== undefined && options.ifMatchSha256 !== observed) {
      throw makeRealmError("LOCK_CONFLICT");
    }
    const writeOptions: AtomicWriteOptions =
      options.stageHook === undefined
        ? { expectedPriorSha256: observed }
        : { expectedPriorSha256: observed, stageHook: options.stageHook };
    atomicWriteFile(target, content, writeOptions);
  } finally {
    // A write by an owner that already held the path must not drop the lock it took earlier.
    if (!alreadyHeld) {
      options.locks.release(handle);
    }
  }
  return { sha256: sha256Hex(content) };
}

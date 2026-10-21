// Advisory lock table (D-33, FS-04). Locks are held in memory and keyed by canonical real
// path. The daemon hosts this table in Phase 6. Nothing here touches the filesystem, so a
// lock never outlives the process that holds it. Non-cooperating writers bypass locks; the
// pre-rename hash re-check in atomicWriteFile is the backstop (T-02-07).

import { makeRealmError } from "../core/errors.js";

export interface LockHandle {
  readonly realPath: string;
  readonly owner: string;
}

export class LockTable {
  private readonly held = new Map<string, LockHandle>();

  // Returns the handle, or throws LOCK_CONFLICT when another owner holds the path. The same
  // owner re-acquiring gets the same handle back.
  acquire(realPath: string, owner: string): LockHandle {
    const current = this.held.get(realPath);
    if (current === undefined) {
      const handle: LockHandle = Object.freeze({ realPath, owner });
      this.held.set(realPath, handle);
      return handle;
    }
    if (current.owner === owner) {
      return current;
    }
    throw makeRealmError("LOCK_CONFLICT");
  }

  // Idempotent. A stale handle, already released or superseded by another owner's lock,
  // leaves the current holder in place.
  release(handle: LockHandle): void {
    if (this.held.get(handle.realPath) === handle) {
      this.held.delete(handle.realPath);
    }
  }

  // True when owner holds the path now. A locked write uses it so that it never releases a
  // lock its owner took elsewhere.
  isHeldBy(realPath: string, owner: string): boolean {
    return this.held.get(realPath)?.owner === owner;
  }

  // Releases every lock the owner holds. Session destroy calls it (D-33).
  releaseOwner(owner: string): void {
    for (const [realPath, handle] of this.held) {
      if (handle.owner === owner) {
        this.held.delete(realPath);
      }
    }
  }
}

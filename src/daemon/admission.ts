// Aggregate admission ledger of the daemon (Phase 18, MULTI-06, contract C7). The daemon is the single owner of the count of
// concurrent sessions: the driver never counts. A session holds a slot from its synchronous reservation until either its
// container removal is proven or no container was ever created for it. The committed set is the union, by session id, of the
// persisted record ids (read through recordedIds at every call), the in-flight reservations and the ids whose removal is not
// yet proven. Every method is synchronous and performs no I/O.

import { makeRealmError } from "../core/errors.js";

export interface AdmissionLedgerOptions {
  readonly maxSessions: number;
  readonly recordedIds: () => readonly string[];
}

export class AdmissionLedger {
  readonly #maxSessions: number;
  readonly #recordedIds: () => readonly string[];
  // In-flight and live reservations: a session that has a slot but no proven removal and no record of its own yet.
  readonly #reserved = new Set<string>();
  // Ids whose container removal failed: the container may still exist, so the slot stays held.
  readonly #unproven = new Set<string>();

  constructor(options: AdmissionLedgerOptions) {
    if (!Number.isInteger(options.maxSessions) || options.maxSessions < 1) {
      throw makeRealmError("SCHEMA_INVALID");
    }
    this.#maxSessions = options.maxSessions;
    this.#recordedIds = options.recordedIds;
  }

  // Reserves a slot for the session. An id already committed is admitted without change. A distinct id at the bound is refused
  // with POLICY_DENIED before anything is recorded.
  reserve(sessionId: string): void {
    const recorded = new Set(this.#recordedIds());
    if (recorded.has(sessionId) || this.#reserved.has(sessionId) || this.#unproven.has(sessionId)) {
      return;
    }
    if (this.#countIn(recorded) >= this.#maxSessions) {
      throw makeRealmError("POLICY_DENIED");
    }
    this.#reserved.add(sessionId);
  }

  // Keeps the session's slot after a failed removal or a failed start. An id that is already unproven is a no-op.
  markUnproven(sessionId: string): void {
    if (this.#unproven.has(sessionId)) {
      return;
    }
    this.#reserved.delete(sessionId);
    this.#unproven.add(sessionId);
  }

  // Frees the session's reservation and unproven mark. The caller invokes it only after the container removal is proven, or when
  // no container was created for the id. A persisted record keeps its id committed until the record itself is deleted.
  release(sessionId: string): void {
    this.#reserved.delete(sessionId);
    this.#unproven.delete(sessionId);
  }

  committedCount(): number {
    return this.#countIn(new Set(this.#recordedIds()));
  }

  isCommitted(sessionId: string): boolean {
    return this.#recordedIds().includes(sessionId) || this.#reserved.has(sessionId) || this.#unproven.has(sessionId);
  }

  // The size of the committed set, given one snapshot of the recorded ids.
  #countIn(recorded: ReadonlySet<string>): number {
    let count = recorded.size;
    for (const id of this.#reserved) {
      if (!recorded.has(id)) {
        count += 1;
      }
    }
    for (const id of this.#unproven) {
      if (!recorded.has(id) && !this.#reserved.has(id)) {
        count += 1;
      }
    }
    return count;
  }
}

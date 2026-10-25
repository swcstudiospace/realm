// Boundary handles for the isolation backend (phase 9.5, PRD-ISO-01 and PRD-ISO-06).
//
// OpenBoundary binds one driver-provisioned resource to an authenticated sandbox, runtime generation and session. The
// binding is keyed by those three values, so reopening the same launch returns the same handle, and a different resource
// for that key is refused. A handle is an unguessable token. Driver deletion of a sandbox invalidates every handle that
// sandbox holds, so a later use of an old handle fails and changes nothing. The registry never reissues a handle.

import { randomUUID } from "node:crypto";
import { status } from "@grpc/grpc-js";
import { makeRealmError } from "../../../core/errors.js";
import { DriverStatusError, driverNotFound } from "../grpc-status.js";

// The identity of one launch. sandboxName and generationId come from the authenticated sandbox bearer; sessionId comes
// from the OpenBoundary request. resourceId names the driver-provisioned resource the boundary is bound to.
export interface BoundaryOpening {
  readonly sandboxName: string;
  readonly generationId: string;
  readonly sessionId: string;
  readonly resourceId: string;
}

export interface Boundary {
  readonly handle: string;
  readonly sandboxName: string;
  readonly generationId: string;
  readonly sessionId: string;
  readonly resourceId: string;
}

export class BoundaryRegistry {
  private readonly byHandle = new Map<string, Boundary>();
  private readonly byLaunch = new Map<string, Boundary>();

  // Returns the handle for the launch. A second open of the same launch returns the handle it already has. A second open
  // that names a different resource fails, and the existing binding is left as it was.
  open(opening: BoundaryOpening): string {
    for (const value of [opening.sandboxName, opening.generationId, opening.sessionId, opening.resourceId]) {
      if (value === "") {
        throw makeRealmError("SCHEMA_INVALID");
      }
    }
    const key = launchKey(opening);
    const existing = this.byLaunch.get(key);
    if (existing !== undefined) {
      if (existing.resourceId !== opening.resourceId) {
        throw new DriverStatusError({
          code: status.FAILED_PRECONDITION,
          details: "the boundary is bound to a different resource",
        });
      }
      return existing.handle;
    }
    const boundary: Boundary = { ...opening, handle: randomUUID() };
    this.byHandle.set(boundary.handle, boundary);
    this.byLaunch.set(key, boundary);
    return boundary.handle;
  }

  // Returns the boundary a handle names. An unknown or invalidated handle fails with NOT_FOUND and reads nothing else.
  resolve(handle: string): Boundary {
    const boundary = this.byHandle.get(handle);
    if (boundary === undefined) {
      throw new DriverStatusError(driverNotFound("the boundary handle is not valid"));
    }
    return boundary;
  }

  // Removes every handle of one sandbox, across all of its generations and sessions. Other sandboxes are untouched.
  // Returns how many handles were removed.
  invalidateAll(sandboxName: string): number {
    let removed = 0;
    for (const boundary of [...this.byHandle.values()]) {
      if (boundary.sandboxName !== sandboxName) {
        continue;
      }
      this.byHandle.delete(boundary.handle);
      this.byLaunch.delete(launchKey(boundary));
      removed += 1;
    }
    return removed;
  }

  // The number of live handles. Used to show that a refused call changed nothing.
  get size(): number {
    return this.byHandle.size;
  }
}

// JSON keeps the key unambiguous whatever characters the identifiers hold.
function launchKey(launch: Pick<BoundaryOpening, "sandboxName" | "generationId" | "sessionId">): string {
  return JSON.stringify([launch.sandboxName, launch.generationId, launch.sessionId]);
}

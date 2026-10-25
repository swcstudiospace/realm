// Boundary handles for the isolation backend (phase 9.5, PRD-ISO-01 and PRD-ISO-06).
//
// OpenBoundary binds one driver-provisioned resource to an authenticated sandbox, runtime generation and session. The
// binding is keyed by that launch, so reopening the same launch returns the same handle, and a different resource for that
// key is refused. A handle is an unguessable token.
//
// Two identities meet in a handle. sandboxName is the driver's name for the sandbox: DeleteSandbox names a sandbox by it, and
// driver deletion invalidates every handle under that name, so a later use of an old handle fails and changes nothing.
// gatewaySandboxId is the sandbox identity the supervisor's bearer carries (its sandbox_id claim): Attach checks the bearer
// against it. The registry never reissues a handle.
//
// A bound handle moves to Attached once the supervisor's bearer for its sandbox and generation verifies (Attach). Only one
// boundary of a sandbox generation may be Attached, so a second Attach for that generation is refused.
//
// The driver's record is the other half of a handle's validity. A handle bound while a DeleteSandbox is in progress is not
// invalidated by that delete's first step, so every use also checks the driver's record for the sandbox (ProvisionedResources).
// Once the driver has removed the sandbox, the handle fails NOT_FOUND on its next use.

import { randomUUID } from "node:crypto";
import { status } from "@grpc/grpc-js";
import { makeRealmError } from "../../../core/errors.js";
import { DriverStatusError, driverNotFound } from "../grpc-status.js";

// The identity of one launch. sessionId comes from the OpenBoundary request; resourceId names the driver-provisioned resource
// the boundary is bound to.
export interface BoundaryOpening {
  readonly sandboxName: string;
  readonly gatewaySandboxId: string;
  readonly generationId: string;
  readonly sessionId: string;
  readonly resourceId: string;
}

// Bound: opened, and no supervisor has attached. Attached: the supervisor's bearer verified for this boundary.
export type BoundaryLifecycle = "Bound" | "Attached";

export interface Boundary {
  readonly handle: string;
  readonly sandboxName: string;
  readonly gatewaySandboxId: string;
  readonly generationId: string;
  readonly sessionId: string;
  readonly resourceId: string;
  readonly lifecycle: BoundaryLifecycle;
}

// A resource the driver provisioned for one gateway sandbox: the driver's name for the sandbox, and the identity of its runtime.
export interface ProvisionedResource {
  readonly sandboxName: string;
  readonly resourceId: string;
}

// The driver's lookup of the resource it holds for a gateway sandbox id. It is synchronous, so a caller binds or checks a handle
// with no await in between. It is undefined when the driver holds no such sandbox.
export interface ProvisionedResources {
  provisionedResource(sandboxId: string): ProvisionedResource | undefined;
}

export class BoundaryRegistry {
  private readonly byHandle = new Map<string, Boundary>();
  private readonly byLaunch = new Map<string, Boundary>();

  // Returns the handle for the launch. A second open of the same launch returns the handle it already has. A second open
  // that names a different resource fails, and the existing binding is left as it was.
  open(opening: BoundaryOpening): string {
    for (const value of [
      opening.sandboxName,
      opening.gatewaySandboxId,
      opening.generationId,
      opening.sessionId,
      opening.resourceId,
    ]) {
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
    const boundary: Boundary = { ...opening, handle: randomUUID(), lifecycle: "Bound" };
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

  // Moves a Bound boundary to Attached. Fails with FAILED_PRECONDITION, and changes nothing, when the boundary is not
  // Bound or another boundary of the same sandbox generation is already Attached.
  markAttached(handle: string): Boundary {
    const boundary = this.resolve(handle);
    if (boundary.lifecycle !== "Bound") {
      throw new DriverStatusError({
        code: status.FAILED_PRECONDITION,
        details: "the boundary is not waiting for an attach",
      });
    }
    for (const other of this.byHandle.values()) {
      if (
        other.gatewaySandboxId === boundary.gatewaySandboxId &&
        other.generationId === boundary.generationId &&
        other.lifecycle === "Attached"
      ) {
        throw new DriverStatusError({
          code: status.FAILED_PRECONDITION,
          details: "the sandbox generation is already attached",
        });
      }
    }
    const attached: Boundary = { ...boundary, lifecycle: "Attached" };
    this.byHandle.set(handle, attached);
    this.byLaunch.set(launchKey(attached), attached);
    return attached;
  }

  // Removes every handle of one driver sandbox, across all of its generations and sessions. Other sandboxes are untouched.
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
function launchKey(launch: Pick<BoundaryOpening, "sandboxName" | "gatewaySandboxId" | "generationId" | "sessionId">): string {
  return JSON.stringify([launch.sandboxName, launch.gatewaySandboxId, launch.generationId, launch.sessionId]);
}

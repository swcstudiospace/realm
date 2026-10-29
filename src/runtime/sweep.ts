// Zero-orphan sweep (D-84, RT-08; D-68 and RT-09 before the move). It removes every realm-owned container
// and proves none survives. A realm-owned container is an OpenShell-managed sandbox whose sandbox name
// carries the realm prefix. It lives here, not in session-execution, so that session code can receive it as
// a function argument (D-50) without importing runtime. Foreign containers are never listed, so they are
// never removed.

import { makeRealmError, RealmError, type ErrorCode } from "../core/errors.js";
import { withTimeout } from "../core/timeout.js";
import type { LibpodClient, LibpodContainerSummary } from "./libpod-client.js";
import {
  isRealmSandboxName,
  OPENSHELL_MANAGED_LABEL_KEY,
  OPENSHELL_MANAGED_LABEL_VALUE,
  OPENSHELL_SANDBOX_NAME_LABEL_KEY,
} from "./openshell.js";

export type SweepClient = Pick<LibpodClient, "listContainersByLabel" | "removeContainer">;

// Bound for each libpod call the sweep awaits. The production LibpodClient already times out each request
// on its own socket (D-53, PODMAN_MACHINE_DOWN); this bound holds for any SweepClient that does not, so a
// hung call cannot block daemon start. A call that does not answer in time gives PODMAN_MACHINE_DOWN, the
// code D-53 gives a runtime socket timeout. It is 30 s so that one removal on a loaded host is not cut off:
// a force removal of a running container waits the client's short stop grace (2 s) and then the kill, and the
// sweep must outlast that plus the client's request bound (5 s) rather than race it (crash recovery, RT-08).
export const SWEEP_CALL_TIMEOUT_MS = 30_000;

// Removes every realm-owned container and returns how many the first listing found. A failed removal
// leaves its container listed, and the second listing reports it, so a failure is never swallowed
// silently. Every container of the first listing is gone when the second listing is empty, so the count
// is the first listing's length. A repeated call on a clean host returns zero and removes nothing.
// Each libpod call is bounded by SWEEP_CALL_TIMEOUT_MS. A hung listing rejects with PODMAN_MACHINE_DOWN, and
// a hung removal counts as a failed one: the second listing, itself bounded, decides.
// `onRemoved` receives the id of each container that is gone (CRASH-04, D-1405), exactly once, so a caller can name what was
// destroyed and the ids always match the count. An id is reported right after its removal succeeds. A removal whose reply
// was lost (the container was removed but the request failed or timed out) is reported after the proving listing, when that
// listing no longer holds the id. A container that is still listed is never reported and keeps its failure. It must not throw.
export async function removeAllRealmContainers(
  libpod: SweepClient,
  onRemoved?: (id: string) => void,
): Promise<number> {
  const found = await listRealmContainers(libpod);
  // The first removal failure keeps its code, so a refusal names what stopped the sweep.
  let removalFailure: ErrorCode | undefined;
  const reported = new Set<string>();
  for (const container of found) {
    try {
      await withTimeout(
        libpod.removeContainer(container.id, { force: true }),
        SWEEP_CALL_TIMEOUT_MS,
        "PODMAN_MACHINE_DOWN",
      );
    } catch (error: unknown) {
      // The second listing proves whether the container is still there.
      if (removalFailure === undefined) {
        removalFailure = codeOf(error);
      }
      continue;
    }
    reported.add(container.id);
    onRemoved?.(container.id);
  }
  const survivors = await listRealmContainers(libpod);
  const stillListed = new Set(survivors.map((container) => container.id));
  for (const container of found) {
    if (!reported.has(container.id) && !stillListed.has(container.id)) {
      reported.add(container.id);
      onRemoved?.(container.id);
    }
  }
  if (survivors.length > 0) {
    throw makeRealmError("REALM_STOPPING", removalFailure);
  }
  return found.length;
}

// The realm's containers: the OpenShell-managed sandboxes whose sandbox name carries the realm prefix.
async function listRealmContainers(libpod: SweepClient): Promise<readonly LibpodContainerSummary[]> {
  const listed = await withTimeout(
    libpod.listContainersByLabel(OPENSHELL_MANAGED_LABEL_KEY, OPENSHELL_MANAGED_LABEL_VALUE),
    SWEEP_CALL_TIMEOUT_MS,
    "PODMAN_MACHINE_DOWN",
  );
  return listed.filter((container) => isRealmSandboxName(container.labels?.[OPENSHELL_SANDBOX_NAME_LABEL_KEY]));
}

// A removal failure that is not a RealmError has no catalogue code of its own, so it is SCHEMA_INVALID.
function codeOf(error: unknown): ErrorCode {
  return error instanceof RealmError ? error.code : "SCHEMA_INVALID";
}

// Zero-orphan sweep (D-84, RT-08; D-68 and RT-09 before the move). It removes every realm-labelled
// container and proves none survives. It lives here, not in session-execution, so that session code can
// receive it as a function argument (D-50) without importing runtime. Foreign containers are never listed,
// so they are never removed.

import { makeRealmError } from "../core/errors.js";
import { withTimeout } from "../core/timeout.js";
import type { LibpodClient } from "./libpod-client.js";
import { MANAGED_LABEL_KEY, MANAGED_LABEL_VALUE } from "./openshell.js";

export type SweepClient = Pick<LibpodClient, "listContainersByLabel" | "removeContainer">;

// Bound for each libpod call the sweep awaits. The production LibpodClient already times out each request
// on its own socket (D-53, PODMAN_MACHINE_DOWN); this bound holds for any SweepClient that does not, so a
// hung call cannot block daemon start. A call that does not answer in time gives PODMAN_MACHINE_DOWN, the
// code D-53 gives a runtime socket timeout.
export const SWEEP_CALL_TIMEOUT_MS = 10_000;

// Removes every realm-labelled container and returns how many the first listing found. A failed removal
// leaves its container listed, and the second listing reports it, so a failure is never swallowed
// silently. Every container of the first listing is gone when the second listing is empty, so the count
// is the first listing's length. A repeated call on a clean host returns zero and removes nothing.
// Each libpod call is bounded by SWEEP_CALL_TIMEOUT_MS. A hung listing rejects with PODMAN_MACHINE_DOWN, and
// a hung removal counts as a failed one: the second listing, itself bounded, decides.
export async function removeAllRealmContainers(libpod: SweepClient): Promise<number> {
  const found = await withTimeout(
    libpod.listContainersByLabel(MANAGED_LABEL_KEY, MANAGED_LABEL_VALUE),
    SWEEP_CALL_TIMEOUT_MS,
    "PODMAN_MACHINE_DOWN",
  );
  for (const container of found) {
    try {
      await withTimeout(
        libpod.removeContainer(container.id, { force: true }),
        SWEEP_CALL_TIMEOUT_MS,
        "PODMAN_MACHINE_DOWN",
      );
    } catch {
      // The second listing proves whether the container is still there.
    }
  }
  const survivors = await withTimeout(
    libpod.listContainersByLabel(MANAGED_LABEL_KEY, MANAGED_LABEL_VALUE),
    SWEEP_CALL_TIMEOUT_MS,
    "PODMAN_MACHINE_DOWN",
  );
  if (survivors.length > 0) {
    throw makeRealmError("REALM_STOPPING");
  }
  return found.length;
}

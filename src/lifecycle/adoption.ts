// Hydration of the sessions adopted at daemon start: each one is hydrated under its own startup
// budget, a bounded number at a time.
import type { StateSnapshot } from "../core/state-machine.js";
import { withTimeout } from "../core/timeout.js";
import { HYDRATE_CONCURRENCY } from "./bounds.js";

// Hydrates the adopted sessions HYDRATE_CONCURRENCY at a time, each under its own startup budget, so one that expires fails that
// session alone. A session leaves `pending` once its hydration settles. Resolves with how many sessions did not come back active.
export async function hydrateAdopted(
  adopted: readonly { readonly sessionId: string; readonly containerId: string }[],
  hydrate: (sessionId: string, containerId: string) => Promise<StateSnapshot>,
  budgetMs: number,
  pending: Set<string>,
): Promise<number> {
  let next = 0;
  let failed = 0;
  const worker = async (): Promise<void> => {
    for (let session = adopted[next]; session !== undefined; session = adopted[next]) {
      next += 1;
      const work = hydrate(session.sessionId, session.containerId);
      const snapshot = await withTimeout(work, budgetMs, "STARTUP_BUDGET_EXCEEDED").catch(() => undefined);
      if (snapshot?.state !== "active") {
        failed += 1;
      }
      pending.delete(session.sessionId);
    }
  };
  await Promise.all(Array.from({ length: Math.min(HYDRATE_CONCURRENCY, adopted.length) }, worker));
  return failed;
}

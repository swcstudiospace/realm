// CPU burners for the stall probe's load-invariance pass (Phase 45, OMPV-02): worker threads that spin until terminated, so the
// verdict can be checked beside real CPU contention. They are threads of the test process, which is why the probe reads the
// calling thread's CPU time (process.threadCpuUsage) and not the process total.

import { Worker } from "node:worker_threads";
import { boundedWait } from "./timing.js";

const SPIN_SOURCE = "for (;;) {}";
const STOP_BOUND_MS = 5_000;

// Starts count burner threads (none for 0) and returns a stop function that terminates them and resolves once they have all
// exited. It rejects with a named message when they have not exited within the bound. Stopping twice is harmless.
export function startCpuBurners(count: number): () => Promise<void> {
  const workers: Worker[] = [];
  for (let index = 0; index < count; index += 1) {
    const worker = new Worker(SPIN_SOURCE, { eval: true });
    worker.on("error", () => undefined);
    workers.push(worker);
  }
  let stopping: Promise<void> | undefined;
  return () => {
    stopping ??= boundedWait(
      Promise.all(workers.map((worker) => worker.terminate())).then(() => undefined),
      "stopping the cpu burner workers",
      STOP_BOUND_MS,
    );
    return stopping;
  };
}

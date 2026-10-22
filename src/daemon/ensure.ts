// Ensures a daemon answers on its control socket (Phase 6 wave 3). When the probe already reports
// a live daemon, it returns at once. Otherwise it calls spawnDaemon exactly once, then polls the
// probe every pollMs until it reports true or timeoutMs has elapsed. The poll mirrors runUp in
// src/cli/main.ts: one spawn after an absent daemon, then bounded retries, and DAEMON_START_TIMEOUT when the
// daemon never comes up. The module spawns no process itself and reads no environment; the caller
// supplies the probe and the spawn. A rejected probe or spawn propagates unchanged.

import { makeRealmError } from "../core/errors.js";

export interface EnsureDaemonOptions {
  // Control socket the probe checks; passed to probe so the caller owns no hidden path.
  readonly socketPath: string;
  // Resolves true when a daemon answers on socketPath.
  readonly probe: (socketPath: string) => Promise<boolean>;
  // Starts the daemon. Called at most once per ensureDaemon call.
  readonly spawnDaemon: () => void;
  // Bound, in milliseconds, on the wait after the spawn. Finite and non-negative.
  readonly timeoutMs: number;
  // Interval, in milliseconds, between probes after the spawn. Finite and positive.
  readonly pollMs: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function ensureDaemon(options: EnsureDaemonOptions): Promise<void> {
  const { socketPath, probe, spawnDaemon, timeoutMs, pollMs } = options;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0 || !Number.isFinite(pollMs) || pollMs <= 0) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  if (await probe(socketPath)) {
    return;
  }
  spawnDaemon();
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await probe(socketPath)) {
      return;
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw makeRealmError("DAEMON_START_TIMEOUT");
    }
    await sleep(Math.min(pollMs, remaining));
  }
}

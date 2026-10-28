// The AgentOS liveness probe that OpenShell runs inside the sandbox (D-014). It exits 0 only while the
// runner's heartbeat is fresh. A missing or stale heartbeat exits 1. It imports Node built-ins only,
// because the sandbox image ships it beside the runner.

import { statSync } from "node:fs";

// The workspace is the user's project and must not receive realm files, so the heartbeat lives in /tmp, the container's tmpfs
// scratch, which the realm policy grants read-write (SANDBOX_SCRATCH_PATHS in src/runtime/openshell.ts). The runner ships as a
// standalone file and keeps its own copy of this constant: the two must match.
const HEARTBEAT_PATH = "/tmp/realm-agentos/heartbeat";
// The runner rewrites the heartbeat every 5 s, so three missed beats is the staleness limit.
const MAX_AGE_MS = 15_000;

function isFresh(path: string): boolean {
  try {
    const ageMs = Date.now() - statSync(path).mtimeMs;
    return ageMs >= 0 && ageMs <= MAX_AGE_MS;
  } catch {
    return false;
  }
}

process.exit(isFresh(HEARTBEAT_PATH) ? 0 : 1);

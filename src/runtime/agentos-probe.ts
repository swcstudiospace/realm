// The AgentOS liveness probe that OpenShell runs inside the sandbox (D-014). It exits 0 only while the
// runner's heartbeat is fresh. A missing or stale heartbeat exits 1. It imports Node built-ins only,
// because the sandbox image ships it beside the runner.

import { statSync } from "node:fs";

// Must match the path the runner writes (under the workspace path the sandbox policy grants).
const HEARTBEAT_PATH = "/workspace/realm-agentos/heartbeat";
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

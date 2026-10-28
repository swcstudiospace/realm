// The AgentOS workload that runs as the OpenShell sandbox process (D-014, D-016). It creates one AgentOS
// VM through the library and rewrites a heartbeat file that the liveness probe reads. SIGTERM or SIGINT
// disposes the VM and exits 0. A startup or runtime failure, including an uncaught exception or unhandled rejection, writes a fixed line (never the error text) to stderr and exits 1, so
// the sandbox stops and the supervisor sees it. The sandbox image ships this file beside the library, so it
// imports only the library and Node built-ins.

import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { AgentOs } from "@rivet-dev/agentos-core";

// The workspace is the user's project and must not receive realm files, so the heartbeat lives in /tmp, the container's tmpfs
// scratch, which the realm policy grants read-write (SANDBOX_SCRATCH_PATHS in src/runtime/openshell.ts). The probe ships as a
// standalone file and keeps its own copy of this constant: the two must match.
const HEARTBEAT_PATH = "/tmp/realm-agentos/heartbeat";
const HEARTBEAT_INTERVAL_MS = 5_000;

function writeHeartbeat(path: string): void {
  // Write a staging file, then rename it, so the probe never reads a partly written heartbeat.
  const staging = `${path}.tmp`;
  writeFileSync(staging, `${new Date().toISOString()}\n`);
  renameSync(staging, path);
}

async function main(): Promise<void> {
  mkdirSync(dirname(HEARTBEAT_PATH), { recursive: true });
  const vm = await AgentOs.create();
  writeHeartbeat(HEARTBEAT_PATH);
  const timer = setInterval(() => {
    writeHeartbeat(HEARTBEAT_PATH);
  }, HEARTBEAT_INTERVAL_MS);
  const shutdown = (): void => {
    clearInterval(timer);
    void vm.dispose().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

// Only a fixed line is printed. A raw error message or stack can carry a path or a value, and the
// catalogue has no code for a workload failure, which this standalone file could not import anyway.
// Node's default handler for an uncaught exception or an unhandled rejection (for example a throw
// inside the heartbeat interval) prints the stack, so both are handled here as well as main().
function failFixed(): never {
  process.stderr.write("agentos runner failed\n");
  process.exit(1);
}

process.on("uncaughtException", failFixed);
process.on("unhandledRejection", failFixed);

main().catch(failFixed);

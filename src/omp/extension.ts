// Omp extension entry (edge). The only module in the Omp wiring that reads process.env: it resolves
// the state directory and the control socket once, builds the attach path, and hands it to the
// plugin. The plugin itself stays free of environment and runtime reads.
//
// Attach means: ensure a daemon answers on the control socket (spawn it detached when absent), connect,
// and run the idempotent up for the workspace. The daemon owns the sandbox; this host only attaches.

import { startDetachedDaemon } from "../cli/main.js";
import { fileURLToPath } from "node:url";
import { connectDaemon, type DaemonClient } from "../daemon/client.js";
import { CONTROL_TIMEOUT_MS } from "../daemon/channel.js";
import { daemonAnswers, ensureDaemon, reportingStartFailure } from "../daemon/ensure.js";
import { readHostRuntime } from "../runtime/host-paths.js";
import { controlSocketPath } from "../session/paths.js";
import { registerRealmPlugin, type OmpExtensionApi } from "./plugin.js";

export default function realmExtension(pi: OmpExtensionApi): void {
  // Read once, at the edge: the config's stateDir, the value the CLI and the daemon use. An invalid config throws here.
  const stateDir = readHostRuntime(process.env).stateDir;
  const socketPath = controlSocketPath(stateDir);
  const daemonEntry = fileURLToPath(new URL("../daemon/main.js", import.meta.url));

  const attachDaemon = async (workspaceRoot: string): Promise<DaemonClient> => {
    await ensureDaemon({
      socketPath,
      probe: reportingStartFailure(daemonAnswers(connectDaemon), stateDir),
      spawnDaemon: () => {
        startDetachedDaemon(daemonEntry, stateDir);
      },
      timeoutMs: CONTROL_TIMEOUT_MS.up,
      pollMs: 100,
    });
    const client = connectDaemon(socketPath);
    try {
      await client.up(workspaceRoot);
    } catch (error: unknown) {
      client.close();
      throw error;
    }
    return client;
  };

  registerRealmPlugin(pi, { attachDaemon });
}

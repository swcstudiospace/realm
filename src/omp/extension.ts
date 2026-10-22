// Omp extension entry (edge). The only module in the Omp wiring that reads process.env: it resolves
// the state directory and the control socket once, builds the attach path, and hands it to the
// plugin. The plugin itself stays free of environment and runtime reads.
//
// Attach means: ensure a daemon answers on the control socket (spawn it detached when absent), connect,
// and run the idempotent up for the workspace. The daemon owns the sandbox; this host only attaches.

import { startDetachedDaemon } from "../cli/main.js";
import { fileURLToPath } from "node:url";
import { RealmError } from "../core/errors.js";
import { connectDaemon, type DaemonClient } from "../daemon/client.js";
import { CONTROL_TIMEOUT_MS } from "../daemon/channel.js";
import { ensureDaemon } from "../daemon/ensure.js";
import { controlSocketPath, resolveStateDir } from "../session/paths.js";
import { registerRealmPlugin, type OmpExtensionApi } from "./plugin.js";

// Status probe for ensureDaemon: true when a daemon answers, false when none does. Any other
// failure propagates to ensureDaemon unchanged.
async function probeDaemon(socketPath: string): Promise<boolean> {
  const client = connectDaemon(socketPath);
  try {
    await client.status();
    return true;
  } catch (error: unknown) {
    if (error instanceof RealmError && error.code === "REALM_NOT_ACTIVE") {
      return false;
    }
    throw error;
  } finally {
    client.close();
  }
}

export default function realmExtension(pi: OmpExtensionApi): void {
  // Read once, at the edge. A state directory that cannot be resolved throws here, unswallowed.
  const stateDir = resolveStateDir(process.env);
  const socketPath = controlSocketPath(stateDir);
  const daemonEntry = fileURLToPath(new URL("../daemon/main.js", import.meta.url));

  const attachDaemon = async (workspaceRoot: string): Promise<DaemonClient> => {
    await ensureDaemon({
      socketPath,
      probe: probeDaemon,
      spawnDaemon: () => startDetachedDaemon(daemonEntry),
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

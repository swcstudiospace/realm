// Omp extension entry (edge). The only module in the Omp wiring that reads process.env: it resolves
// the state directory and the control socket once, builds the attach path, and hands it to the
// plugin. The plugin itself stays free of environment and runtime reads.
//
// Attach means: ensure a daemon answers on the control socket (spawn it detached when absent), connect,
// and run the idempotent up for the workspace. The daemon owns the sandbox; this host only attaches.

import { startDetachedDaemon } from "../cli/main.js";
import { fileURLToPath } from "node:url";
import { connectDaemon } from "../daemon/client.js";
import { CONTROL_TIMEOUT_MS } from "../daemon/channel.js";
import { daemonAnswers, ensureDaemon, reportingStartFailure } from "../daemon/ensure.js";
import { readHostRuntime } from "../runtime/host-paths.js";
import { controlSocketPath } from "../session/paths.js";
import { makeRealmError, RealmError } from "../core/errors.js";
import { registerRealmPlugin, type DaemonAttach, type OmpExtensionApi } from "./plugin.js";

// The re-attach switch (O4). Unset and 0 leave re-attach off, 1 turns it on. Any other value is a bad setting and fails the load.
export function reattachEnabledOf(value: string | undefined): boolean {
  if (value === undefined || value === "0") {
    return false;
  }
  if (value === "1") {
    return true;
  }
  throw makeRealmError("SCHEMA_INVALID");
}

export default function realmExtension(pi: OmpExtensionApi): void {
  // Read once, at the edge: the config's stateDir, the value the CLI and the daemon use. An invalid config throws here.
  const stateDir = readHostRuntime(process.env).stateDir;
  // The re-attach switch is read once, here: a value that is neither unset, 0 nor 1 fails the load before anything registers.
  const reattachEnabled = reattachEnabledOf(process.env.REALM_OMP_REATTACH);
  const socketPath = controlSocketPath(stateDir);
  const daemonEntry = fileURLToPath(new URL("../daemon/main.js", import.meta.url));

  const attachDaemon = async (workspaceRoot: string): Promise<DaemonAttach> => {
    await ensureDaemon({
      socketPath,
      probe: reportingStartFailure(daemonAnswers(connectDaemon), stateDir),
      spawnDaemon: () => {
        // startDetachedDaemon allowlists the child environment (spawn-env.ts). A sentinel does not cross.
        startDetachedDaemon(daemonEntry, stateDir);
      },
      timeoutMs: CONTROL_TIMEOUT_MS.up,
      pollMs: 100,
    });
    const client = connectDaemon(socketPath);
    try {
      await client.up(workspaceRoot);
      return { client, refusal: null };
    } catch (error: unknown) {
      // A refused up still leaves a daemon that answers. Keep its client when its status answers: the refusal is returned with
      // it, so the plugin shows the refusal code and forwards tool calls (reachable, inactive). A dead channel closes the client
      // and rethrows the up error.
      try {
        await client.status();
      } catch {
        client.close();
        throw error;
      }
      return { client, refusal: error instanceof RealmError ? error : makeRealmError("SCHEMA_INVALID") };
    }
  };

  registerRealmPlugin(pi, { attachDaemon, reattach: { enabled: reattachEnabled, random: Math.random } });
}

// Omp extension entry (edge). The only module in the Omp wiring that reads process.env: it resolves
// the state directory and the control socket once, builds the attach path, and hands it to the
// plugin. The plugin itself stays free of environment and runtime reads.
//
// The bounds come from the omp manifest through resolveBoot (src/host/boot.ts); the one switch this edge reads is REALM_OMP_REATTACH.
// A presence marker (src/host/presence.ts) records that this process loaded the plugin and how its last attach ended. It is
// written and removed through the plugin's onAttach and onSessionEnd callbacks and never changes an attach outcome.
//
// Attach means: ensure a daemon answers on the control socket (spawn it detached when absent), connect,
// and run the idempotent up for the workspace. The daemon owns the sandbox; this host only attaches.

import { startDetachedDaemon } from "../cli/main.js";
import { fileURLToPath } from "node:url";
import { connectDaemon, selectionOf, type DaemonStatus } from "../daemon/client.js";
import { CONTROL_TIMEOUT_MS } from "../daemon/channel.js";
import { daemonAnswers, ensureDaemon, reportingStartFailure } from "../daemon/ensure.js";
import { readHostRuntime } from "../runtime/host-paths.js";
import { controlSocketPath } from "../session/paths.js";
import { makeRealmError, RealmError } from "../core/errors.js";
import { packageVersion } from "../core/package-version.js";
import { resolveBoot } from "../host/boot.js";
import { defaultManifestFor, parseHostPluginManifest } from "../host/manifest.js";
import { removePresence, writePresence } from "../host/presence.js";
import { createRealmPlugin, type DaemonAttach, type OmpExtensionApi, type PluginAttachOutcome } from "./plugin.js";

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
  const bounds = resolveBoot(
    parseHostPluginManifest({ ...defaultManifestFor("omp", packageVersion()), boot: { reattach: { enabled: reattachEnabled } } }),
  );
  const socketPath = controlSocketPath(stateDir);
  const daemonEntry = fileURLToPath(new URL("../daemon/main.js", import.meta.url));

  const startedAt = new Date().toISOString();
  // The session id of the workspace the last attach selected; null until one resolves.
  let attachedSessionId: string | null = null;

  const attachDaemon = async (workspaceRoot: string): Promise<DaemonAttach> => {
    const selection = selectionOf(workspaceRoot);
    attachedSessionId = selection.sessionId;
    await ensureDaemon({
      socketPath,
      probe: reportingStartFailure(daemonAnswers(connectDaemon, selection), stateDir, process.stderr),
      spawnDaemon: () => {
        // startDetachedDaemon allowlists the child environment (spawn-env.ts). A sentinel does not cross.
        startDetachedDaemon(daemonEntry, stateDir);
      },
      timeoutMs: CONTROL_TIMEOUT_MS.up,
      pollMs: 100,
    });
    const client = connectDaemon(socketPath, selection);
    try {
      await client.up();
      return { client, refusal: null };
    } catch (error: unknown) {
      // A refused up leaves the daemon pinned to its own root. Keep the client only when its status answers and reports
      // workspaceRoot as that root: the refusal is then returned with it, and the plugin shows the code and forwards calls
      // (reachable, inactive). Otherwise the client closes and the refusal is rethrown, so no call can reach another project.
      // A dead channel also closes the client and rethrows the up error.
      let status: DaemonStatus;
      try {
        status = await client.status();
      } catch {
        client.close();
        throw error;
      }
      // The daemon reports its root as a realpath and the session id of that root. A daemon that reports no root predates the
      // field, so its root is unknown. A reply that names another session or another root is not this project's, so it is refused
      // the same way: the client closes and the refusal is rethrown.
      if (
        status.boundRoot === undefined ||
        status.boundRoot !== selection.workspaceRoot ||
        status.sessionId !== selection.sessionId
      ) {
        client.close();
        throw error;
      }
      return { client, refusal: error instanceof RealmError ? error : makeRealmError("SCHEMA_INVALID") };
    }
  };

  // A presence failure is reported as its catalogue code on one stderr line and nothing else; it never reaches the plugin.
  const presenceFailure = (error: unknown): void => {
    const code = error instanceof RealmError ? error.code : "unexpected error";
    process.stderr.write(`realm: presence marker not updated: ${code}\n`);
  };

  const onAttach = (outcome: PluginAttachOutcome): void => {
    if (attachedSessionId === null) {
      return;
    }
    try {
      writePresence(stateDir, "omp", {
        pid: process.pid,
        startedAt,
        sessionId: attachedSessionId,
        attach: outcome.outcome,
        code: outcome.outcome === "failed" ? outcome.code : null,
      });
    } catch (error: unknown) {
      presenceFailure(error);
    }
  };

  const onSessionEnd = (): void => {
    try {
      removePresence(stateDir, "omp", process.pid);
    } catch (error: unknown) {
      presenceFailure(error);
    }
  };

  createRealmPlugin(pi, {
    attachDaemon,
    bounds,
    reattach: { enabled: bounds.reattach.enabled, random: Math.random },
    onAttach,
    onSessionEnd,
  });
}

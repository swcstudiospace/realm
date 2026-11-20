// The one attach sequence every host entry shares (Phase 23, BOOT-01): ensure a daemon answers on the control socket, connect a
// client for the workspace's selection, and run the idempotent up. The module spawns nothing (spawnDaemon is injected, because
// src/host may not import child_process), reads no environment and names no control method except through DaemonClient.
//
// What a refused up does to the client is the one place the entries differ, and each behavior is pinned by an existing test, so
// the three are named, not unified:
//   "verified": keep the client only when its status answers and names this root and session id; the refusal comes back with
//               it. Otherwise close the client and rethrow. This is the Omp extension (src/omp/extension.ts).
//   "always":   keep the client and return the refusal with it, with no status read. This is realm mcp, which keeps serving
//               (every request carries the selection, so the daemon refuses another project's); the boot driver's readback
//               then decides whether the client is adopted.
//   "never":    close the client and rethrow. This is realm acp, which cannot serve without a successful up.
// A refusal that is not a RealmError is returned as SCHEMA_INVALID, as Omp does today.
//
// Selection is resolved on every call and never cached, so a root swapped for a symlink between two attempts is canonicalized
// again. Errors of selectionOf, ensureDaemon and connect propagate unchanged.

import { makeRealmError, RealmError } from "../core/errors.js";
import type { ControlSelection } from "../daemon/channel.js";
import { selectionOf, type ConnectDaemonOptions, type DaemonClient, type DaemonStatus } from "../daemon/client.js";
import { daemonAnswers, ensureDaemon, reportingStartFailure } from "../daemon/ensure.js";
import type { HostId } from "./types.js";

export type RefusalRetention = "verified" | "always" | "never";

export interface DaemonAttachOptions {
  readonly socketPath: string;
  readonly stateDir: string;
  // The third argument is passed only when a host is set (CAPT-06), so a two-argument connect still fits.
  readonly connect: (socketPath: string, selection: ControlSelection, options?: ConnectDaemonOptions) => DaemonClient;
  // The host id the client attaches its capability token as. Absent for a host that has no label (an unlabelled stdio
  // session): its client never attaches and sends no token.
  readonly host?: HostId;
  // Starts the daemon detached. Called at most once per attach, and only when the socket is absent.
  readonly spawnDaemon: () => void;
  readonly diagnostics: { write(text: string): void };
  // The bound, in milliseconds, on the wait for a daemon to answer (ensureDaemon timeoutMs), and the probe interval.
  readonly upBoundMs: number;
  readonly pollMs: number;
  readonly refusalRetention: RefusalRetention;
  // Called with the session id of the selection, before the first probe.
  readonly onSelection?: (sessionId: string) => void;
  // Called once with the up reply when up succeeds. Never called for a refusal. A throw propagates: it is the caller's contract.
  readonly onUp?: (status: DaemonStatus) => void;
}

export interface DaemonAttachResult {
  readonly client: DaemonClient;
  readonly refusal: RealmError | null;
}

// The refusal handling of a rejected up, by retention mode. Closes the client in every branch that does not return it.
async function retainOrClose(
  client: DaemonClient,
  selection: ControlSelection,
  error: unknown,
  retention: RefusalRetention,
): Promise<DaemonAttachResult> {
  const refusal = error instanceof RealmError ? error : makeRealmError("SCHEMA_INVALID");
  switch (retention) {
    case "always":
      return { client, refusal };
    case "never":
      client.close();
      throw error;
    case "verified": {
      let status: DaemonStatus;
      try {
        status = await client.status();
      } catch {
        client.close();
        throw error;
      }
      // A daemon that reports no root predates the field, so its root is unknown; a reply naming another root or session is
      // not this project's. Either way the refusal is rethrown and no call can reach another project.
      if (status.boundRoot === undefined || status.boundRoot !== selection.workspaceRoot || status.sessionId !== selection.sessionId) {
        client.close();
        throw error;
      }
      return { client, refusal };
    }
  }
}

export function createDaemonAttach(options: DaemonAttachOptions): (workspaceRoot: string) => Promise<DaemonAttachResult> {
  return async (workspaceRoot) => {
    const selection = selectionOf(workspaceRoot);
    options.onSelection?.(selection.sessionId);
    await ensureDaemon({
      socketPath: options.socketPath,
      probe: reportingStartFailure(daemonAnswers(options.connect, selection), options.stateDir, options.diagnostics),
      spawnDaemon: options.spawnDaemon,
      timeoutMs: options.upBoundMs,
      pollMs: options.pollMs,
    });
    const client =
      options.host === undefined
        ? options.connect(options.socketPath, selection)
        : options.connect(options.socketPath, selection, { host: options.host });
    let status: DaemonStatus;
    try {
      status = await client.up();
    } catch (error: unknown) {
      return retainOrClose(client, selection, error, options.refusalRetention);
    }
    options.onUp?.(status);
    return { client, refusal: null };
  };
}

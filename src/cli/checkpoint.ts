// realm checkpoint (RES-04, D19-6): the CLI over the workspace checkpoint library (src/session/checkpoint.ts).
// `create` snapshots the selected project's workspace and `restore` puts a checkpoint's tree back. The project is
// the canonical per-project session that realm status --workspace selects (selectionOf), and the state root is the
// state directory the runtime config names, read by the same loader the status path uses. Arguments are parsed before
// any config is read or any file is touched, so a usage error changes nothing. Every refusal is a catalogue code on
// stdout with its reason on stderr, the convention of the other subcommands.
//
// The library's sandboxRunning predicate is the daemon's status call for the session. Any state other than unbound
// counts as running, so a state the CLI does not recognise is refused rather than assumed stopped. A daemon that cannot
// answer refuses with REALM_NOT_ACTIVE before anything is written.
//
// Known gap (not closed here): the daemon does not refuse realm up while a checkpoint lock is live, so a restore can
// race a sandbox start. The library's point-sample manifest check and stamp check detect a writer during a snapshot;
// closing the start race needs a separately owned daemon change.

import { ERROR_CATALOGUE, makeRealmError, RealmError, type ErrorCode } from "../core/errors.js";
import type { ControlSelection } from "../daemon/channel.js";
import { connectDaemon, selectionOf, type DaemonClient, type DaemonStatus } from "../daemon/client.js";
import { loadRuntimeConfig } from "../runtime/config.js";
import { readRuntimeConfigFile } from "../runtime/config-file.js";
import { resolveConfigPath } from "../runtime/host-paths.js";
import {
  restoreWorkspace,
  snapshotWorkspace,
  type CheckpointManifest,
  type SandboxRunning,
} from "../session/checkpoint.js";
import { controlSocketPath, isSessionId, type EnvironmentLike } from "../session/paths.js";
import { readWorkspaceEntry, type WorkspaceEntry } from "../session/workspace-registry.js";
import type { CliResult } from "./main.js";

export const CHECKPOINT_USAGE =
  "realm checkpoint: usage: realm checkpoint create|restore --workspace <absolute path> --id <checkpointId>";

// The seams the command reads. CliDeps satisfies this shape, so the entry edge passes its own deps through.
export interface CheckpointDeps {
  readonly env: EnvironmentLike;
  // Reads the runtime config file (default readRuntimeConfigFile).
  readonly readConfig?: (path: string) => unknown;
  // Dials the control socket for the status call (default connectDaemon).
  readonly connect?: (socketPath: string, selection: ControlSelection) => DaemonClient;
}

interface CheckpointArgs {
  readonly command: "create" | "restore";
  readonly workspace: string;
  readonly checkpointId: string;
}

// The words after `checkpoint`: create or restore, then exactly two flags, --workspace and --id, each given once, in
// either order. A missing, duplicate or unknown flag, a relative workspace, or an id outside the library's safe set is
// a usage error.
function parseCheckpointArgs(words: readonly string[]): CheckpointArgs | undefined {
  const [command, ...flags] = words;
  if (command !== "create" && command !== "restore") {
    return undefined;
  }
  if (flags.length !== 4) {
    return undefined;
  }
  const [firstFlag, firstValue, secondFlag, secondValue] = flags;
  const pairs: readonly (readonly [string | undefined, string | undefined])[] = [
    [firstFlag, firstValue],
    [secondFlag, secondValue],
  ];
  let workspace: string | undefined;
  let checkpointId: string | undefined;
  for (const [flag, value] of pairs) {
    if (value === undefined) {
      return undefined;
    }
    if (flag === "--workspace" && workspace === undefined) {
      workspace = value;
    } else if (flag === "--id" && checkpointId === undefined) {
      checkpointId = value;
    } else {
      return undefined;
    }
  }
  if (workspace === undefined || checkpointId === undefined) {
    return undefined;
  }
  // Absolute POSIX path by string operations, as the up, mcp and acp commands check it.
  if (!workspace.startsWith("/") || !isSessionId(checkpointId)) {
    return undefined;
  }
  return { command, workspace, checkpointId };
}

// The catalogue code and reason for a failure; a non-RealmError maps to SCHEMA_INVALID, as failureFor does in main.ts.
function refusal(error: unknown): CliResult {
  const code: ErrorCode = error instanceof RealmError ? error.code : "SCHEMA_INVALID";
  return { exitCode: 1, stdout: `${code}\n`, stderr: `${ERROR_CATALOGUE[code].reason}\n` };
}

// The state directory from the runtime config, through the loader the status path uses. Absent or invalid config yields
// undefined, so the command refuses with usage (exit 2) as the other state-directory commands do.
function stateDirOf(deps: CheckpointDeps): string | undefined {
  try {
    return loadRuntimeConfig((deps.readConfig ?? readRuntimeConfigFile)(resolveConfigPath(deps.env))).stateDir;
  } catch {
    return undefined;
  }
}

export async function runCheckpointCommand(words: readonly string[], deps: CheckpointDeps): Promise<CliResult> {
  const args = parseCheckpointArgs(words);
  if (args === undefined) {
    return { exitCode: 2, stdout: "", stderr: `${CHECKPOINT_USAGE}\n` };
  }
  const stateRoot = stateDirOf(deps);
  if (stateRoot === undefined) {
    return {
      exitCode: 2,
      stdout: "",
      stderr: "realm checkpoint: cannot resolve a state directory (the realm config file under an absolute XDG_CONFIG_HOME or HOME must be present and valid)\n",
    };
  }
  // The same selection realm status --workspace makes: the canonical root and the session it maps to.
  let selection: ControlSelection;
  try {
    selection = selectionOf(args.workspace);
  } catch (error) {
    return refusal(error);
  }
  // The registry entry is the trust anchor the library pins the workspace against. Without one the workspace names no
  // session, which is the code the status path reports for it (the daemon's unbound state, REALM_UNBOUND).
  let entry: WorkspaceEntry | null;
  try {
    entry = readWorkspaceEntry(stateRoot, selection.sessionId);
  } catch (error) {
    return refusal(error);
  }
  if (entry === null) {
    return refusal(makeRealmError("REALM_UNBOUND"));
  }
  let client: DaemonClient;
  try {
    client = (deps.connect ?? connectDaemon)(controlSocketPath(stateRoot), selection);
  } catch {
    return refusal(makeRealmError("REALM_NOT_ACTIVE"));
  }
  return runAgainstDaemon(client, args, entry, stateRoot);
}

async function runAgainstDaemon(
  client: DaemonClient,
  args: CheckpointArgs,
  entry: WorkspaceEntry,
  stateRoot: string,
): Promise<CliResult> {
  // A property, not a let: the closure below sets it, and a narrowed local would read as constant at the catch.
  const state = { daemonSilent: false };
  const sandboxRunning: SandboxRunning = async () => {
    try {
      const status: DaemonStatus = await client.status();
      return status.snapshot.state !== "unbound";
    } catch (error) {
      state.daemonSilent = true;
      throw error;
    }
  };
  try {
    // Pre-flight: the daemon must answer before the library writes anything, so an absent daemon refuses here.
    await sandboxRunning(entry.sessionId);
    const scope = { entry, stateRoot, sandboxRunning, checkpointId: args.checkpointId };
    const manifest: CheckpointManifest =
      args.command === "create" ? await snapshotWorkspace(scope) : await restoreWorkspace(scope);
    return {
      exitCode: 0,
      stdout: `${JSON.stringify({ command: args.command, checkpointId: args.checkpointId, entries: manifest.entries.length })}\n`,
      stderr: "",
    };
  } catch (error) {
    // The library maps a throwing predicate to REALM_NOT_ACTIVE. Here the daemon is the thing that cannot answer,
    // so the refusal is the daemon-unreachable code whatever the library reported.
    return refusal(state.daemonSilent ? makeRealmError("REALM_NOT_ACTIVE") : error);
  } finally {
    client.close();
  }
}

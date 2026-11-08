// realm checkpoint (RES-04, D19-6): the CLI over the workspace checkpoint library (src/session/checkpoint.ts).
// `create` snapshots the selected project's workspace and `restore` puts a checkpoint's tree back. The project is
// the canonical per-project session that realm status --workspace selects (selectionOf), and the state root is the
// state directory the runtime config names, read by the same loader the status path uses. Arguments are parsed before
// any config is read or any file is touched, so a usage error changes nothing. Every refusal is a catalogue code on
// stdout with its reason on stderr, the convention of the other subcommands.
//
// The project's entry is the trust anchor the library pins the workspace against. A registered project uses its
// registry entry unchanged. A project stopped with realm down has no entry and usually no daemon, so the command pins
// the workspace itself, in memory, by the rules realm up applies to an unknown project (pinStoppedProject: the policy
// workspaceRoots, the configured workspace root, the id check). The library takes the entry inside its request and
// verifies it against the directory before every copy and move, so the in-memory entry is the whole mechanism: the
// command writes no workspaces/<id>.json and removes none, and a crash leaves nothing behind.
//
// The library's sandboxRunning predicate proves the sandbox is stopped, in full on every call, in this order:
//   1. the daemon answers: state unbound is stopped, any other state is running;
//   2. there is no daemon (the control socket is absent or refuses the connection, DaemonAbsentError) and the entry was
//      pinned in memory: Podman holds no container named for the session. A container in any state, an unresolvable
//      or unreachable Podman, a failed or overlong inspect all leave the proof unfinished and refuse;
//   3. every other failure (a daemon that did not answer in time, an error or malformed reply, a connection dropped
//      mid-reply), and no daemon for a registered project, refuse with REALM_NOT_ACTIVE without consulting Podman.
// A daemon that exists but did not answer is never "no daemon": it may be running a sandbox.
//
// A sandbox start holds the session's checkpoint lock (src/lifecycle/controller.ts create and hydrate), so a checkpoint
// refused by a live start gets LOCK_CONFLICT, and a start refused by a checkpoint gets REALM_NOT_ACTIVE. A restore that
// begins after a start has settled still relies on the stopped-sandbox check, and a start that never settles holds the
// lock until it settles or the process exits.

import type { Policy } from "../contract/validate.js";
import { ERROR_CATALOGUE, makeRealmError, RealmError, type ErrorCode } from "../core/errors.js";
import { loadPolicyFile } from "../core/policy.js";
import { withTimeout } from "../core/timeout.js";
import { DaemonAbsentError, type ControlSelection } from "../daemon/channel.js";
import { connectDaemon, selectionOf, type DaemonClient, type DaemonStatus } from "../daemon/client.js";
import { bindRoot, bindWorkspaceUnderPolicy, isInsideRoot, type PinnedRoot } from "../fs/root.js";
import { loadRuntimeConfig, type RuntimeConfig } from "../runtime/config.js";
import { readRuntimeConfigFile } from "../runtime/config-file.js";
import { defaultPolicyPath, podmanSocketPath, resolveConfigPath } from "../runtime/host-paths.js";
import { LibpodClient } from "../runtime/libpod-client.js";
import { realmSandboxName } from "../runtime/openshell.js";
import {
  restoreWorkspace,
  snapshotWorkspace,
  type CheckpointManifest,
  type SandboxRunning,
} from "../session/checkpoint.js";
import { controlSocketPath, isSessionId, type EnvironmentLike } from "../session/paths.js";
import { readWorkspaceEntry, workspaceEntryOf, type WorkspaceEntry } from "../session/workspace-registry.js";
import type { CliResult } from "./main.js";

export const CHECKPOINT_USAGE =
  "realm checkpoint: usage: realm checkpoint create|restore --workspace <absolute path> --id <checkpointId>";

// The bound on one Podman call of the stopped-sandbox proof, in milliseconds.
export const PODMAN_PROOF_TIMEOUT_MS = 10_000;

// The seams the command reads. CliDeps satisfies this shape, so the entry edge passes its own deps through.
export interface CheckpointDeps {
  readonly env: EnvironmentLike;
  // Reads the runtime config file (default readRuntimeConfigFile).
  readonly readConfig?: (path: string) => unknown;
  // Dials the control socket for the status call (default connectDaemon).
  readonly connect?: (socketPath: string, selection: ControlSelection) => DaemonClient;
  // Loads the policy file a project that has no registry entry is bound under (default loadPolicyFile).
  readonly readPolicy?: (path: string) => Policy;
  // The libpod inspect of the named container; resolves null for an absent one (default: the host Podman socket).
  readonly inspectContainer?: (containerName: string) => Promise<unknown>;
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

// The runtime config, through the loader the status path uses. Absent or invalid config yields undefined, so the command
// refuses with usage (exit 2) as the other state-directory commands do.
function runtimeConfigOf(deps: CheckpointDeps): RuntimeConfig | undefined {
  try {
    return loadRuntimeConfig((deps.readConfig ?? readRuntimeConfigFile)(resolveConfigPath(deps.env)));
  } catch {
    return undefined;
  }
}

// The entry for a project that has no registry entry, built in memory and written nowhere. It applies the rules realm up
// applies to an unknown project (resolveSelection in src/daemon/sessions.ts) with the same functions: the path must bind
// under the policy workspaceRoots and lie inside the configured workspace root (POLICY_DENIED), and the id must be the
// one the bound path derives (SCHEMA_INVALID).
export function pinStoppedProject(selection: ControlSelection, policy: Policy, ceiling: PinnedRoot): WorkspaceEntry {
  const pinned = bindWorkspaceUnderPolicy(policy.workspaceRoots, selection.workspaceRoot);
  if (!isInsideRoot(ceiling, pinned.realPath)) {
    throw makeRealmError("POLICY_DENIED");
  }
  return workspaceEntryOf(pinned, selection.sessionId);
}

// The libpod inspect through the host Podman socket. An unresolvable socket or a client that cannot be built rejects.
async function inspectThroughPodman(env: EnvironmentLike, containerName: string): Promise<unknown> {
  const socketPath = podmanSocketPath(env);
  if (socketPath === undefined) {
    throw makeRealmError("REALM_NOT_ACTIVE");
  }
  return new LibpodClient(socketPath).inspectContainer(containerName);
}

export async function runCheckpointCommand(words: readonly string[], deps: CheckpointDeps): Promise<CliResult> {
  const args = parseCheckpointArgs(words);
  if (args === undefined) {
    return { exitCode: 2, stdout: "", stderr: `${CHECKPOINT_USAGE}\n` };
  }
  const config = runtimeConfigOf(deps);
  if (config === undefined) {
    return {
      exitCode: 2,
      stdout: "",
      stderr: "realm checkpoint: cannot resolve a state directory (the realm config file under an absolute XDG_CONFIG_HOME or HOME must be present and valid)\n",
    };
  }
  const stateRoot = config.stateDir;
  // The same selection realm status --workspace makes: the canonical root and the session it maps to.
  let selection: ControlSelection;
  try {
    selection = selectionOf(args.workspace);
  } catch (error) {
    return refusal(error);
  }
  // A registered project uses its entry as it is. An unregistered one (the usual state after realm down) is pinned in
  // memory under the policy and the workspace root, before the daemon is touched; nothing is written either way.
  let entry: WorkspaceEntry;
  let pinnedInMemory = false;
  try {
    const registered = readWorkspaceEntry(stateRoot, selection.sessionId);
    if (registered === null) {
      const policy = (deps.readPolicy ?? loadPolicyFile)(defaultPolicyPath(stateRoot));
      entry = pinStoppedProject(selection, policy, bindRoot(config.workspaceRoot));
      pinnedInMemory = true;
    } else {
      entry = registered;
    }
  } catch (error) {
    return refusal(error);
  }
  let client: DaemonClient;
  try {
    client = (deps.connect ?? connectDaemon)(controlSocketPath(stateRoot), selection);
  } catch {
    return refusal(makeRealmError("REALM_NOT_ACTIVE"));
  }
  const inspectContainer =
    deps.inspectContainer ?? ((containerName: string) => inspectThroughPodman(deps.env, containerName));
  return runAgainstDaemon(client, args, entry, stateRoot, pinnedInMemory ? inspectContainer : undefined);
}

// The inspect of the session's sandbox container: null when Podman holds none. Any failure or an overlong call rejects,
// so the proof stays unfinished.
async function containerOf(
  inspectContainer: (containerName: string) => Promise<unknown>,
  sessionId: string,
): Promise<unknown> {
  return withTimeout(
    Promise.resolve().then(() => inspectContainer(realmSandboxName(sessionId))),
    PODMAN_PROOF_TIMEOUT_MS,
    "TOOL_TIMEOUT",
  );
}

// The library's predicate for a stopped sandbox. inspectContainer is present only for an entry pinned in memory: it is
// the second proof, taken only when no daemon exists. It is bounded, and anything but an absent container fails the proof.
async function runAgainstDaemon(
  client: DaemonClient,
  args: CheckpointArgs,
  entry: WorkspaceEntry,
  stateRoot: string,
  inspectContainer: ((containerName: string) => Promise<unknown>) | undefined,
): Promise<CliResult> {
  // A property, not a let: the closure below sets it, and a narrowed local would read as constant at the catch.
  const state = { proofFailed: false };
  const sandboxRunning: SandboxRunning = async () => {
    try {
      const status: DaemonStatus = await client.status();
      return status.snapshot.state !== "unbound";
    } catch (error) {
      state.proofFailed = true;
      if (error instanceof DaemonAbsentError && inspectContainer !== undefined) {
        // No daemon: the proof is Podman's, and only an absent container finishes it.
        const found = await containerOf(inspectContainer, entry.sessionId);
        if (found === null) {
          state.proofFailed = false;
          return false;
        }
        throw makeRealmError("REALM_NOT_ACTIVE");
      }
      throw error;
    }
  };
  try {
    // Pre-flight: the proof must finish before the library writes anything, so an unproven sandbox refuses here.
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
    // The library maps a throwing predicate to REALM_NOT_ACTIVE. Here the proof is the thing that could not finish,
    // so the refusal is the not-active code whatever the library reported.
    return refusal(state.proofFailed ? makeRealmError("REALM_NOT_ACTIVE") : error);
  } finally {
    client.close();
  }
}

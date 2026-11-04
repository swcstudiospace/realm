// Session state helpers shared by the lifecycle controller and the daemon: the live-state test,
// and the pinned workspace root that an adopted session is verified against.
import { makeRealmError } from "../core/errors.js";
import type { StateSnapshot } from "../core/state-machine.js";
import { PinnedRoot, verifyPinnedAt } from "../fs/root.js";
import { readWorkspaceEntry } from "../session/workspace-registry.js";

// A live session is one whose container is or may be running: connecting, active or degraded. A live session is
// never created again, and a down of a live session arms the daemon's stop once it is destroyed.
export function isLiveState(state: StateSnapshot["state"]): boolean {
  return state === "connecting" || state === "active" || state === "degraded";
}

// The pin of an adopted session, verified against its workspace. The device and inode were recorded in the session's workspace
// entry at create. An entry that is absent, or that lacks them, is SCHEMA_INVALID; a workspace that is no longer that directory
// is POLICY_DENIED.
export function storedPinOf(stateDir: string, sessionId: string, workspaceRoot: string): PinnedRoot {
  const entry = readWorkspaceEntry(stateDir, sessionId);
  if (entry === null) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  return verifyPinnedAt(new PinnedRoot(entry.workspaceRoot, entry.dev, entry.ino), workspaceRoot);
}

// The observed state of a sandbox as the driver reports it, and whether a container holds a workspace. Reads only.

import type { LibpodInspect } from "../libpod-client.js";
import type { DriverSandboxOut, SandboxRecord } from "./compute-driver.js";

// The observed state of one sandbox, named by the gateway. Ready is True only while the container is running and its host
// supervisor has not exited.
export function sandboxOut(name: string, record: SandboxRecord, inspect: LibpodInspect): DriverSandboxOut {
  const state = runStateOf(inspect);
  const ready = state === "running" && !record.supervisorExited;
  const instance: unknown = inspect["Id"];
  return {
    id: record.id,
    name,
    namespace: "",
    workspace: record.workspace,
    status: {
      name,
      instance_id: typeof instance === "string" ? instance : "",
      agent_fd: "",
      sandbox_fd: "",
      conditions: [
        {
          type: "Ready",
          status: ready ? "True" : "False",
          reason: record.supervisorExited ? "supervisor-exited" : state,
          message: "",
        },
      ],
      deleting: false,
    },
  };
}

function runStateOf(inspect: LibpodInspect): string {
  const state: unknown = inspect["State"];
  if (typeof state === "object" && state !== null && "Status" in state && typeof state.Status === "string") {
    return state.Status;
  }
  return "unknown";
}

// States in which a container holds no workspace: it has not started, or it has stopped. Every other readable state is live,
// which includes running and paused.
const NON_HOLDING_STATES: Record<string, true> = { configured: true, created: true, exited: true, stopped: true };

// True when a container holds the workspace: it is live, and one of its mounts has the workspace as its source. Throws when the
// state or the mounts cannot be read, so the caller refuses the create.
export function holdsWorkspace(inspect: LibpodInspect, workspace: string): boolean {
  const state = runStateOf(inspect);
  if (state === "unknown") {
    throw new Error("container state unreadable");
  }
  if (NON_HOLDING_STATES[state] === true) {
    return false;
  }
  const mounts: unknown = inspect["Mounts"];
  if (!Array.isArray(mounts)) {
    throw new Error("container mounts unreadable");
  }
  const entries: readonly unknown[] = mounts;
  return entries.some((mount) => typeof mount === "object" && mount !== null && "Source" in mount && mount.Source === workspace);
}

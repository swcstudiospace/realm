// The one derivation of a sandbox container's host binding (C2). The driver's create builds the container's mounts from it,
// and both verifiers check the inspect against it: the driver's post-start verify and the session's verifyOrRemove. So the paths a
// container is created with and the paths its inspect is verified against come from one function. The workspace is the pinned
// root and is never derived. The state directory and the channel directory are per sandbox: each is named by the sandbox name
// under its root. The channel directory is the one channelPathsOf names under the sandbox's secret directory.

import { join } from "node:path";
import { channelPathsOf } from "./channel.js";
import { secretDirOf } from "./secret-store.js";

// The roots a sandbox binds from: the pinned workspace root, the realm state root, and the realm secret root.
export interface SandboxRoots {
  readonly workspaceRoot: string;
  readonly stateRoot: string;
  readonly secretRoot: string;
}

// The host paths a sandbox container binds. The workspace is mounted read-write at /workspace, the state directory read-only at
// /realm-state, and the channel directory read-write at /run/openshell/channel.
export interface SandboxBinding {
  readonly workspaceRoot: string;
  readonly stateDir: string;
  readonly channelDir: string;
}

// The binding of one sandbox. The name must be a realm sandbox name and one container-name-safe segment; secretDirOf checks it, so
// the joined paths stay under their roots. Nothing is created or read here.
export function sandboxBindingOf(roots: SandboxRoots, sandboxName: string): SandboxBinding {
  const secretDir = secretDirOf(roots.secretRoot, sandboxName);
  return {
    workspaceRoot: roots.workspaceRoot,
    stateDir: join(roots.stateRoot, sandboxName),
    channelDir: channelPathsOf(secretDir).channelDir,
  };
}

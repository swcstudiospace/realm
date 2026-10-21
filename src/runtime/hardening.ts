// Session-container hardening profile and the fail-closed inspect verifier (RT-01, D-47, D-51).
// OpenShell's Podman driver creates the session container; Realm verifies it after create
// against this profile and destroys it on any failure (D-47). The verifier reads a libpod
// inspect object, which is untrusted input. Every property is checked on its own. A missing,
// mistyped, or unrecognised field fails that property, and nothing defaults to a safe value.
//
// The field paths below are the libpod inspect fields the route table treats as provisional
// (libpod-routes.ts, podman.md Q5). They are confirmed only by the gated suite on Podman 5.x.
// No capability beyond the ALL drop is verified yet (D-51).

// Numeric limits and the frozen profile values live here and nowhere else (D-52).
export const HARDENING_PROFILE = Object.freeze({
  privileged: false,
  capDrop: Object.freeze(["ALL"]),
  capAdd: Object.freeze([] as readonly string[]),
  securityOpt: Object.freeze(["no-new-privileges"]),
  readonlyRootfs: true,
  tmpfs: Object.freeze(["/tmp", "/run"]),
  pidsLimit: 512,
  memoryBytes: 1024 * 1024 * 1024,
  nanoCpus: 2_000_000_000,
  networkMode: "none",
  socketNames: Object.freeze(["docker.sock", "podman.sock"]),
  // Mount destinations inside the container (R1, D-51). The workspace path is the in-sandbox path that the
  // OpenShell policy grants read-write (SANDBOX_WORKSPACE_PATH, OQ-P3-02). No document fixes the state path:
  // Realm chooses it, and the gated suite must confirm that the OpenShell driver mounts the state dir there.
  workspaceDestination: "/workspace",
  stateDestination: "/realm-state",
});

// The properties that verifyInspect checks, in report order.
export const HARDENING_PROPERTIES = Object.freeze([
  "privileged",
  "rootless",
  "cap-drop",
  "cap-add",
  "no-new-privileges",
  "read-only-root",
  "tmpfs",
  "pids-limit",
  "memory-limit",
  "cpu-limit",
  "network-mode",
  "image-digest",
  "mounts",
  "socket-path",
] as const);

export type HardeningProperty = (typeof HARDENING_PROPERTIES)[number];

// What the profile is checked against. Each value comes from the caller, never from the inspect.
export interface HardeningBinding {
  // Digest-pinned image reference from RuntimeConfig.image (D-52).
  readonly image: string;
  // From libpod info, never inferred (D-51). Anything other than true fails the rootless check.
  readonly rootless: boolean;
  // The two mount sources the container must carry, and no others (D-51).
  readonly workspaceRoot: string;
  readonly stateDir: string;
}

type Check = (inspect: unknown, binding: HardeningBinding) => boolean;

const CHECKS: Readonly<Record<HardeningProperty, Check>> = Object.freeze({
  privileged: (inspect) => field(inspect, ["HostConfig", "Privileged"]) === HARDENING_PROFILE.privileged,
  rootless: (_inspect, binding) => binding.rootless === true,
  "cap-drop": (inspect) => sameStrings(field(inspect, ["HostConfig", "CapDrop"]), HARDENING_PROFILE.capDrop),
  "cap-add": (inspect) => sameStrings(field(inspect, ["HostConfig", "CapAdd"]), HARDENING_PROFILE.capAdd),
  "no-new-privileges": (inspect) => hasNoNewPrivileges(field(inspect, ["HostConfig", "SecurityOpt"])),
  "read-only-root": (inspect) =>
    field(inspect, ["HostConfig", "ReadonlyRootfs"]) === HARDENING_PROFILE.readonlyRootfs,
  tmpfs: (inspect) => {
    const tmpfs = field(inspect, ["HostConfig", "Tmpfs"]);
    return isRecord(tmpfs) && sameStrings(Object.keys(tmpfs), HARDENING_PROFILE.tmpfs);
  },
  "pids-limit": (inspect) => field(inspect, ["HostConfig", "PidsLimit"]) === HARDENING_PROFILE.pidsLimit,
  "memory-limit": (inspect) => field(inspect, ["HostConfig", "Memory"]) === HARDENING_PROFILE.memoryBytes,
  "cpu-limit": (inspect) => field(inspect, ["HostConfig", "NanoCpus"]) === HARDENING_PROFILE.nanoCpus,
  "network-mode": (inspect) => field(inspect, ["HostConfig", "NetworkMode"]) === HARDENING_PROFILE.networkMode,
  "image-digest": (inspect, binding) => {
    const pinned = digestOf(binding.image);
    return pinned !== undefined && field(inspect, ["ImageDigest"]) === pinned;
  },
  // The two bind mounts and no others (D-51). The workspace is read-write, as the OpenShell policy grants
  // /workspace. The state directory is read-only, which fails closed because D-51 is silent on it.
  mounts: (inspect, binding) => {
    const mounts = field(inspect, ["Mounts"]);
    return (
      Array.isArray(mounts) &&
      mounts.length === 2 &&
      isMountOf(mounts, binding.workspaceRoot, HARDENING_PROFILE.workspaceDestination, true) &&
      isMountOf(mounts, binding.stateDir, HARDENING_PROFILE.stateDestination, false)
    );
  },
  "socket-path": (inspect) => {
    const mounts = field(inspect, ["Mounts"]);
    return (
      Array.isArray(mounts) &&
      mounts.every((mount) => isRecord(mount) && pathIsClear(mount.Source) && pathIsClear(mount.Destination))
    );
  },
});

// Returns the failed property names in report order. An empty list means the inspect conforms.
export function verifyInspect(binding: HardeningBinding, inspect: unknown): readonly HardeningProperty[] {
  return HARDENING_PROPERTIES.filter((property) => !CHECKS[property](inspect, binding));
}

function field(source: unknown, path: readonly string[]): unknown {
  let node: unknown = source;
  for (const key of path) {
    if (!isRecord(node)) {
      return undefined;
    }
    node = node[key];
  }
  return node;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// True only when the value is an array of strings with exactly the expected members, in any order.
function sameStrings(actual: unknown, expected: readonly string[]): boolean {
  if (!Array.isArray(actual) || actual.length !== expected.length) {
    return false;
  }
  if (!actual.every((member): member is string => typeof member === "string")) {
    return false;
  }
  const left = [...actual].sort();
  const right = [...expected].sort();
  return left.every((member, index) => member === right[index]);
}

function hasNoNewPrivileges(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.some((option) => option === "no-new-privileges" || option === "no-new-privileges:true")
  );
}

// True when exactly one mount has this source, and that mount is a bind with the expected destination and
// read-write flag. A missing or mistyped field fails it, so nothing defaults to a safe value.
function isMountOf(mounts: readonly unknown[], source: string, destination: string, rw: boolean): boolean {
  const matches = mounts.filter((mount) => isRecord(mount) && mount.Source === source);
  const only = matches[0];
  return (
    matches.length === 1 &&
    isRecord(only) &&
    only.Type === "bind" &&
    only.Destination === destination &&
    only.RW === rw
  );
}

// A path is clear when it is a string and none of its segments is a container-engine socket.
function pathIsClear(value: unknown): boolean {
  return typeof value === "string" && !value.split("/").some((segment) => HARDENING_PROFILE.socketNames.includes(segment));
}

// The sha256 digest after the "@" of a digest-pinned reference, or undefined when there is none.
function digestOf(imageRef: string): string | undefined {
  const at = imageRef.lastIndexOf("@");
  return at < 0 ? undefined : imageRef.slice(at + 1);
}

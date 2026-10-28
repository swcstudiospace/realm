// Session-container hardening profile and the fail-closed inspect verifier (RT-01, D-47, D-51).
// OpenShell's Podman driver creates the session container; Realm verifies it after create
// against this profile and destroys it on any failure (D-47). The verifier reads a libpod
// inspect object, which is untrusted input. Every property is checked on its own. A missing,
// mistyped, or unrecognised field fails that property, and nothing defaults to a safe value.
//
// The field paths below are the libpod inspect fields the route table treats as provisional
// (libpod-routes.ts, podman.md Q5). They are confirmed only by the gated suite on Podman 5.x.
// The capability check is not an inspect property. Podman 5.7.1 does not report KernelCaps, so the five capability sets of the
// container's init process are proven live, from its host /proc status, by kernel-caps.ts (D-51).
//
// Every sandbox container has the same shape: a read-write channel mount for the sandbox runtime, and a noexec tmpfs for the
// runtime's CA material. The binding names the channel directory, which sandboxBindingOf always derives.

import { createHash } from "node:crypto";
import { isAbsolute } from "node:path";
import { SECCOMP_PROFILE_FILE_NAME } from "./driver/seccomp-profile.js";

// Numeric limits and the frozen profile values live here and nowhere else (D-52).
export const HARDENING_PROFILE = Object.freeze({
  privileged: false,
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
  // The channel the sandbox runtime and the host supervisor share: its bootstrap, TLS files and control socket.
  channelDestination: "/run/openshell/channel",
  // A tmpfs of the runtime's CA material, mounted noexec and sticky (mode 1703). The runtime creates its owned material directory under this mount.
  supervisorCaDestination: "/run/openshell-supervisor-ca",
  // The workload identity of the sandbox process. The user namespace maps the realm account to this uid and gid.
  workloadUid: 1001,
  workloadGid: 1001,
  // The name of the seccomp profile file the sandbox container runs under. It carries the digest of the embedded profile, so the
  // evidence digest changes when the profile does.
  seccompProfileFile: SECCOMP_PROFILE_FILE_NAME,
});

// The sandbox runtime is the sandbox container's main process (phase 9.5, wave 3). Its binary and the exact argv that starts it
// are one value: the create body names them, and the verifier checks PID 1 against them. The file name is the one the channel
// writes (BOOTSTRAP_FILE_NAME in driver/secret-store.ts).
export const RUNTIME_BINARY = "/usr/local/lib/realm/openshell-sandbox";
export const CONTAINER_BOOTSTRAP_PATH = `${HARDENING_PROFILE.channelDestination}/bootstrap.json`;
export const RUNTIME_ARGV: readonly string[] = Object.freeze([RUNTIME_BINARY, "--bootstrap", CONTAINER_BOOTSTRAP_PATH]);
// The options the channel mount carries, as Podman's inspect reports them. Writability is not listed here: Podman reports it in the RW
// field, which the pre-start check reads, and the create asks for rw explicitly.
export const CHANNEL_MOUNT_OPTIONS: readonly string[] = Object.freeze(["noexec", "nosuid", "nodev"]);
// The options of the CA tmpfs: noexec, nosuid and nodev, and mode 1703. That mode is sticky, owner rwx (root in the container
// namespace), no group bits, and other -wx. The workload uid 1001 can create its material directory beneath the mount, and it
// cannot list the root or remove or rename another uid's entry. The driver no longer verifies the owner, because Podman's create
// route refuses the uid and gid tmpfs options. The runtime creates its owned directory under the mount, per SUPERVISOR_CA_RUNTIME_DIR
// in the runtime contract.
export const SUPERVISOR_CA_TMPFS_OPTIONS: readonly string[] = Object.freeze(["noexec", "nosuid", "nodev", "mode=1703"]);

// The properties that verifyInspect checks, in report order.
export const HARDENING_PROPERTIES = Object.freeze([
  "privileged",
  "rootless",
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
  "init-process",
  "socket-path",
  "seccomp-profile",
] as const);

export type HardeningProperty = (typeof HARDENING_PROPERTIES)[number];

// What the profile is checked against. Each value comes from the caller, never from the inspect.
export interface HardeningBinding {
  // Digest-pinned image reference from RuntimeConfig.image (D-52).
  readonly image: string;
  // From libpod info, never inferred (D-51). Anything other than true fails the rootless check.
  readonly rootless: boolean;
  // The two mount sources of the session container, and no others (D-51): the workspace read-write, the state directory read-only.
  readonly workspaceRoot: string;
  readonly stateDir: string;
  // The sandbox container's channel source, read-write. The container must also carry the CA tmpfs and the channel mount, and
  // nothing else.
  readonly channelDir: string;
}

type Check = (inspect: unknown, binding: HardeningBinding) => boolean;

const CHECKS: Readonly<Record<HardeningProperty, Check>> = Object.freeze({
  privileged: (inspect) => field(inspect, ["HostConfig", "Privileged"]) === HARDENING_PROFILE.privileged,
  rootless: (_inspect, binding) => binding.rootless,
  "cap-add": (inspect) => sameStrings(field(inspect, ["HostConfig", "CapAdd"]), HARDENING_PROFILE.capAdd),
  "no-new-privileges": (inspect) => hasNoNewPrivileges(field(inspect, ["HostConfig", "SecurityOpt"])),
  "read-only-root": (inspect) =>
    field(inspect, ["HostConfig", "ReadonlyRootfs"]) === HARDENING_PROFILE.readonlyRootfs,
  tmpfs: (inspect) => {
    const tmpfs = field(inspect, ["HostConfig", "Tmpfs"]);
    return isRecord(tmpfs) && sameStrings(Object.keys(tmpfs), [...HARDENING_PROFILE.tmpfs, HARDENING_PROFILE.supervisorCaDestination]);
  },
  "pids-limit": (inspect) => field(inspect, ["HostConfig", "PidsLimit"]) === HARDENING_PROFILE.pidsLimit,
  "memory-limit": (inspect) => field(inspect, ["HostConfig", "Memory"]) === HARDENING_PROFILE.memoryBytes,
  "cpu-limit": (inspect) => field(inspect, ["HostConfig", "NanoCpus"]) === HARDENING_PROFILE.nanoCpus,
  "network-mode": (inspect) => field(inspect, ["HostConfig", "NetworkMode"]) === HARDENING_PROFILE.networkMode,
  "image-digest": (inspect, binding) => {
    const pinned = digestOf(binding.image);
    return pinned !== undefined && field(inspect, ["ImageDigest"]) === pinned;
  },
  // The bind mounts and no others (D-51). The workspace is read-write, as the OpenShell policy grants /workspace. The state
  // directory is read-only, which fails closed because D-51 is silent on it. The channel is read-write, so the runtime can write
  // its socket and remove its bootstrap. An extra mount, or a read-write state mount, fails.
  mounts: (inspect, binding) => {
    const mounts = field(inspect, ["Mounts"]);
    return (
      Array.isArray(mounts) &&
      mounts.length === 3 &&
      isMountOf(mounts, binding.workspaceRoot, HARDENING_PROFILE.workspaceDestination, true) &&
      isMountOf(mounts, binding.stateDir, HARDENING_PROFILE.stateDestination, false) &&
      isMountOf(mounts, binding.channelDir, HARDENING_PROFILE.channelDestination, true)
    );
  },
  // PID 1 of a sandbox container is the sandbox runtime, started with its exact argv (phase 9.5, wave 3).
  "init-process": (inspect) =>
    field(inspect, ["Path"]) === RUNTIME_BINARY && sameArgv(field(inspect, ["Args"]), RUNTIME_ARGV.slice(1)),
  "socket-path": (inspect) => {
    const mounts = field(inspect, ["Mounts"]);
    return (
      Array.isArray(mounts) &&
      mounts.every((mount) => isRecord(mount) && pathIsClear(mount.Source) && pathIsClear(mount.Destination))
    );
  },
  // The container runs under the driver's seccomp profile: the file Podman reports names the embedded profile by its digest. Podman
  // omits the field when no profile is set, and an absent, mistyped or relative value fails. The file's content is not read here: the
  // driver writes the file under a digest-bearing name, and refuses to start on a file of that name with other content.
  "seccomp-profile": (inspect) => {
    const path = field(inspect, ["SeccompProfilePath"]);
    return typeof path === "string" && isAbsolute(path) && path.endsWith(`/${HARDENING_PROFILE.seccompProfileFile}`);
  },
});

// Returns the failed property names in report order. An empty list means the inspect conforms.
export function verifyInspect(binding: HardeningBinding, inspect: unknown): readonly HardeningProperty[] {
  return HARDENING_PROPERTIES.filter((property) => !CHECKS[property](inspect, binding));
}

// The sha256 hex digest of the hardening profile, the properties the verifier checks, and the image. It is computed before the
// container is created and stored as the provisioning evidence of the sandbox. The runtime is started only after the verifier
// has accepted the container, so the evidence names a profile that was verified for that container.
export function hardeningEvidenceDigest(image: string): string {
  const canonical = JSON.stringify({ profile: HARDENING_PROFILE, properties: HARDENING_PROPERTIES, image });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
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

// The properties a sandbox container is refused for before it starts (phase 9.5, wave 3, F): the CA tmpfs options and the
// channel mount options. A missing or mistyped field fails its check.
export type ChannelProperty = "ca-tmpfs-options" | "channel-mount-options";

// The channel checks run on the container as created, before the runtime's files are written and before it starts. Reports
// in the order of ChannelProperty; an empty list means the container conforms.
export function channelOptionFailures(inspect: unknown): readonly ChannelProperty[] {
  const failures: ChannelProperty[] = [];
  if (!caTmpfsOptionsSafe(inspect)) {
    failures.push("ca-tmpfs-options");
  }
  if (!channelMountOptionsSafe(inspect)) {
    failures.push("channel-mount-options");
  }
  return failures;
}

function caTmpfsOptionsSafe(inspect: unknown): boolean {
  const options = field(inspect, ["HostConfig", "Tmpfs", HARDENING_PROFILE.supervisorCaDestination]);
  if (typeof options !== "string") {
    return false;
  }
  const given = options.split(",");
  return SUPERVISOR_CA_TMPFS_OPTIONS.every((option) => given.includes(option));
}

// The channel mount must be read-write (its RW field is true) and carry each of CHANNEL_MOUNT_OPTIONS in its Options, which is what
// Podman reports. A read-only channel is refused here, before the runtime starts.
function channelMountOptionsSafe(inspect: unknown): boolean {
  const mounts = field(inspect, ["Mounts"]);
  if (!Array.isArray(mounts)) {
    return false;
  }
  const entries: readonly unknown[] = mounts;
  const channel = entries.filter((mount) => isRecord(mount) && mount["Destination"] === HARDENING_PROFILE.channelDestination);
  const [only] = channel;
  if (channel.length !== 1 || !isRecord(only)) {
    return false;
  }
  const options = only["Options"];
  if (!Array.isArray(options)) {
    return false;
  }
  const given: readonly unknown[] = options;
  return only["RW"] === true && CHANNEL_MOUNT_OPTIONS.every((option) => given.includes(option));
}

// True only when the value is an array holding exactly the expected arguments, in order.
function sameArgv(actual: unknown, expected: readonly string[]): boolean {
  if (!Array.isArray(actual)) {
    return false;
  }
  const values: readonly unknown[] = actual;
  return values.length === expected.length && values.every((value, index) => value === expected[index]);
}

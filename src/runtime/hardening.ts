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
// Some properties read evidence that the host attaches to the inspect, never values the engine reports. The seccomp-keyring
// property reads the verdict seccomp-evidence.ts derives from the container's OCI config. The rlimit, sysctl, masked-path and
// read-only-path properties read the fields create-evidence.ts projects from the same config. The live-seccomp and live-no-new-privs
// properties read the Seccomp and NoNewPrivs values that kernel-caps.ts reads from the init process's /proc status. A caller must
// attach all of it (attachRuntimeEvidence in create-evidence.ts) before verifyInspect, and a property whose evidence is absent fails.
//
// Every sandbox container has the same shape: a read-write channel mount for the sandbox runtime, and a noexec tmpfs for the
// runtime's CA material. The binding names the channel directory, which sandboxBindingOf always derives.

import { createHash } from "node:crypto";
import { makeRealmError } from "../core/errors.js";
import { OCI_RUNTIME_FIELD } from "./create-evidence.js";
import { KERNEL_STATUS_FIELD } from "./kernel-caps.js";
import { keyringEvidenceHolds } from "./seccomp-evidence.js";
import { SECCOMP_PROFILE_FILE_NAME } from "./driver/seccomp-profile.js";

const WORKLOAD_UID = 1001;
const WORKLOAD_GID = 1001;
const PIDS_LIMIT = 512;
const SUPERVISOR_CA_DESTINATION = "/run/openshell-supervisor-ca";
const TMPFS_SIZES: Readonly<Record<string, string>> = Object.freeze({
  "/tmp": "256m",
  "/run": "16m",
  [SUPERVISOR_CA_DESTINATION]: "4m",
});
const RUNTIME_SYSCTLS: Readonly<Record<string, string>> = Object.freeze({
  "net.ipv4.ip_unprivileged_port_start": "0",
  "net.ipv6.conf.all.disable_ipv6": "1",
  "net.ipv6.conf.default.disable_ipv6": "1",
});

// Numeric limits and the frozen profile values live here and nowhere else (D-52).
export const HARDENING_PROFILE = Object.freeze({
  privileged: false,
  capAdd: Object.freeze([] as readonly string[]),
  securityOpt: Object.freeze(["no-new-privileges"]),
  readonlyRootfs: true,
  tmpfs: Object.freeze(["/tmp", "/run"]),
  pidsLimit: PIDS_LIMIT,
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
  // A tmpfs of the runtime's CA material, mounted noexec and mode 1703. The runtime creates its owned material directory under this mount.
  supervisorCaDestination: SUPERVISOR_CA_DESTINATION,
  // The workload identity of the sandbox process. The user namespace maps the realm account to this uid and gid.
  workloadUid: WORKLOAD_UID,
  workloadGid: WORKLOAD_GID,
  // The user the container runs as, as the create body names it and as the inspect reports it in Config.User.
  workloadUser: `${String(WORKLOAD_UID)}:${String(WORKLOAD_GID)}`,
  // The name of the seccomp profile file the sandbox container runs under. It carries the digest of the embedded profile, so the
  // evidence digest changes when the profile does.
  seccompProfileFile: SECCOMP_PROFILE_FILE_NAME,
  // The options every scratch tmpfs (/tmp and /run) carries. Nothing executes from either: the workload's execute rights are
  // limited by Landlock to the system paths (SANDBOX_SYSTEM_READ_ONLY_PATHS), /tmp is granted read-write only, the AgentOS
  // heartbeat in /tmp is a data file, and the runtime binary lives under /usr/local/lib/realm. The CA tmpfs carries its own
  // options (SUPERVISOR_CA_TMPFS_OPTIONS).
  tmpfsOptions: Object.freeze(["noexec", "nosuid", "nodev"]),
  // The size cap of every tmpfs. A tmpfs page counts against the container's memory limit, so each cap leaves the rest of the
  // 1 GiB for the processes: /tmp holds the sidecar's temporary state, the heartbeat and the workload's scratch files, /run holds
  // only small runtime files (the channel is a separate bind mount), and the CA tmpfs holds a certificate and a key.
  tmpfsSizes: TMPFS_SIZES,
  // The resource limits the create body sets and the verifier reads back from the OCI config. nofile bounds open descriptors and
  // core 0 disables core dumps. The create body sets no RLIMIT_NPROC: the kernel counts it per real host uid, and the container's
  // processes run as the realm account's own uid, so a limit would be shared with the realm account's other host processes (the
  // daemon, driver, gateway, podman API and supervisor) and a fork in the sandbox could fail with EAGAIN while the host is busy.
  // The container-scoped process bound is the cgroup pids limit (pidsLimit).
  rlimits: Object.freeze([
    Object.freeze({ type: "RLIMIT_NOFILE", limit: 4096 }),
    Object.freeze({ type: "RLIMIT_CORE", limit: 0 }),
  ]),
  // Every sysctl the create body sets, which the OCI config must carry (the engine may add defaults of its own). The sandbox runtime binds loopback ports below
  // 1024 as the workload uid, so the network namespace lowers the unprivileged port start to 0. IPv6 is disabled in the same
  // namespace (RT-05), so the sandbox has IPv4 loopback only. The sysctls are per network namespace, and the sandbox has no
  // network beyond loopback. The sandbox runtime itself checks the low-port value at startup and refuses to run otherwise.
  sysctls: RUNTIME_SYSCTLS,
  // The Podman default masked and read-only paths that the OCI config must carry. The verifier asserts that these are present, not
  // that the list is exactly Podman's, so a newer Podman that adds an entry still passes.
  maskedPaths: Object.freeze(["/proc/acpi", "/proc/kcore", "/proc/keys", "/proc/scsi", "/sys/firmware"]),
  readonlyPaths: Object.freeze(["/proc/bus", "/proc/irq", "/proc/sys", "/proc/sysrq-trigger"]),
});

// The options of one tmpfs of the create body: its fixed options and its size cap. A destination without a size is a defect of
// the profile, and it is refused so that no tmpfs is created unbounded.
export function tmpfsOptionsOf(destination: string): readonly string[] {
  const size = HARDENING_PROFILE.tmpfsSizes[destination];
  if (size === undefined) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  const fixed = destination === SUPERVISOR_CA_DESTINATION ? SUPERVISOR_CA_TMPFS_OPTIONS : HARDENING_PROFILE.tmpfsOptions;
  return [...fixed, `size=${size}`];
}

// The sandbox runtime is the sandbox container's main process (phase 9.5, wave 3). Its binary and the exact argv that starts it
// are one value: the create body names them, and the verifier checks PID 1 against them. The file name is the one the channel
// writes (BOOTSTRAP_FILE_NAME in driver/secret-store.ts).
export const RUNTIME_BINARY = "/usr/local/lib/realm/openshell-sandbox";
const CONTAINER_BOOTSTRAP_PATH = `${HARDENING_PROFILE.channelDestination}/bootstrap.json`;
export const RUNTIME_ARGV: readonly string[] = Object.freeze([RUNTIME_BINARY, "--bootstrap", CONTAINER_BOOTSTRAP_PATH]);
// The options the channel mount carries, as Podman's inspect reports them. Writability is not listed here: Podman reports it in the RW
// field, which the pre-start check reads, and the create asks for rw explicitly.
export const CHANNEL_MOUNT_OPTIONS: readonly string[] = Object.freeze(["noexec", "nosuid", "nodev"]);
// The options of the CA tmpfs: noexec, nosuid and nodev, and mode 1703 (sticky, owner rwx, no group bits, other -wx). The mode
// keeps other users from listing the root. The sticky bit gives no protection between processes of the same uid: the runtime and
// the workload run as the same uid, so either can remove or replace the other's entry. The material is protected by the runtime's
// own directory permissions and by Landlock, not by the sticky bit. The driver no longer verifies the owner, because Podman's
// create route refuses the uid and gid tmpfs options. The runtime creates its owned directory under the mount, per
// SUPERVISOR_CA_RUNTIME_DIR in the runtime contract.
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
  "seccomp-keyring",
  "live-seccomp",
  "live-no-new-privs",
  "namespaces",
  "devices",
  "user",
  "security-opt",
  "memory-swap",
  "ulimits",
  "sysctls",
  "masked-paths",
  "readonly-paths",
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
  // The scratch tmpfs mounts and the CA tmpfs, and no others. Each is noexec, nosuid and nodev, re-enables none of them, and
  // carries a size cap equal to the profile's size for its destination, so no tmpfs is executable or unbounded.
  tmpfs: (inspect) => {
    const tmpfs = field(inspect, ["HostConfig", "Tmpfs"]);
    return (
      isRecord(tmpfs) &&
      sameStrings(Object.keys(tmpfs), [...HARDENING_PROFILE.tmpfs, HARDENING_PROFILE.supervisorCaDestination]) &&
      Object.entries(tmpfs).every(([destination, options]) => tmpfsConforms(destination, options))
    );
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
  // The container's seccomp profile denies the three keyring syscalls. Podman 5.7.1 does not record an API-applied profile in inspect
  // (HostConfig.SecurityOpt holds only no-new-privileges), so SecurityOpt and annotations are not read. The evidence is the verdict
  // attachSeccompEvidence derived from the container's OCI config; absent or false fails.
  "seccomp-keyring": (inspect) => keyringEvidenceHolds(inspect),
  // The live process state read from the init process's /proc status: a seccomp filter is in force (mode 2, not 0 or the strict
  // mode 1) and no_new_privs is set.
  "live-seccomp": (inspect) => field(inspect, [KERNEL_STATUS_FIELD, "Seccomp"]) === "2",
  "live-no-new-privs": (inspect) => field(inspect, [KERNEL_STATUS_FIELD, "NoNewPrivs"]) === "1",
  // The container shares no namespace with the host or with another container: none of the pid, ipc, uts, cgroup and user
  // modes is host, a joined path or a joined container.
  namespaces: (inspect) =>
    PRIVATE_NAMESPACE_FIELDS.every((name) => {
      const mode = field(inspect, ["HostConfig", name]);
      return typeof mode === "string" && !sharesNamespace(mode);
    }),
  // No host device is passed to the container. A missing or null list is not an empty list.
  devices: (inspect) => {
    const devices = field(inspect, ["HostConfig", "Devices"]);
    return Array.isArray(devices) && devices.length === 0;
  },
  // The container runs as the workload user, never as root.
  user: (inspect) => field(inspect, ["Config", "User"]) === HARDENING_PROFILE.workloadUser,
  // No option that switches off the SELinux label or unmasks a path.
  "security-opt": (inspect) => securityOptionsSafe(field(inspect, ["HostConfig", "SecurityOpt"])),
  // Swap equals the memory limit, so the container has no swap.
  "memory-swap": (inspect) => field(inspect, ["HostConfig", "MemorySwap"]) === HARDENING_PROFILE.memoryBytes,
  // The OCI config carries every rlimit the create body sets, each once with soft and hard equal to the limit. An engine default
  // of another type (for example RLIMIT_NPROC) is tolerated.
  ulimits: (inspect) => rlimitsMatch(field(inspect, [OCI_RUNTIME_FIELD, "rlimits"])),
  // The OCI config carries every sysctl the create body sets, which include the low-port start. An engine default is tolerated.
  sysctls: (inspect) => sysctlsMatch(field(inspect, [OCI_RUNTIME_FIELD, "sysctl"])),
  "masked-paths": (inspect) => includesEvery(field(inspect, [OCI_RUNTIME_FIELD, "maskedPaths"]), HARDENING_PROFILE.maskedPaths),
  "readonly-paths": (inspect) => includesEvery(field(inspect, [OCI_RUNTIME_FIELD, "readonlyPaths"]), HARDENING_PROFILE.readonlyPaths),
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

// The HostConfig fields of the namespaces the sandbox must not share.
const PRIVATE_NAMESPACE_FIELDS: readonly string[] = Object.freeze(["PidMode", "IpcMode", "UTSMode", "CgroupMode", "UsernsMode"]);

// True when a namespace mode names the host, a namespace path, or another container. The empty mode and the private, shareable
// and keep-id modes are the sandbox's own.
function sharesNamespace(mode: string): boolean {
  return mode === "host" || mode.startsWith("host:") || mode.startsWith("ns:") || mode.startsWith("container:");
}

// True only when the value is an array of strings, and none of them turns off the label or unmasks a path.
function securityOptionsSafe(value: unknown): boolean {
  if (!Array.isArray(value)) {
    return false;
  }
  const options: readonly unknown[] = value;
  return options.every(
    (option) =>
      typeof option === "string" && option !== "label=disable" && option !== "label:disable" && !option.startsWith("unmask"),
  );
}

// The options a tmpfs must not carry: each re-enables what the profile disables (noexec, nosuid, nodev).
const TMPFS_REENABLING_OPTIONS: readonly string[] = Object.freeze(["exec", "suid", "dev"]);

const TMPFS_SIZE_PATTERN = /^([1-9][0-9]*)([kmg]?)$/i;
const TMPFS_SIZE_UNITS: Readonly<Record<string, number>> = Object.freeze({ "": 1, k: 1024, m: 1024 ** 2, g: 1024 ** 3 });

// A tmpfs size option value (a plain byte count, or a count with a k, m or g suffix) in bytes, or undefined when it is not a
// positive size of that form. Podman may rewrite 256m as 262144k, so sizes are compared in bytes.
export function tmpfsSizeBytes(size: string): number | undefined {
  const match = TMPFS_SIZE_PATTERN.exec(size);
  const [, count, suffix] = match ?? [];
  const unit = TMPFS_SIZE_UNITS[(suffix ?? "").toLowerCase()];
  if (count === undefined || unit === undefined) {
    return undefined;
  }
  const bytes = Number(count) * unit;
  return Number.isSafeInteger(bytes) ? bytes : undefined;
}

// True only when the value is the options string of the tmpfs at this destination and that tmpfs is noexec, nosuid and nodev,
// re-enables none of them, and carries exactly one size cap equal in bytes to the profile's size for the destination.
function tmpfsConforms(destination: string, value: unknown): boolean {
  if (typeof value !== "string") {
    return false;
  }
  const profileSize = HARDENING_PROFILE.tmpfsSizes[destination];
  const expectedBytes = profileSize === undefined ? undefined : tmpfsSizeBytes(profileSize);
  const given = value.split(",");
  const sizes = given.filter((option) => option.startsWith("size="));
  const [size] = sizes;
  return (
    expectedBytes !== undefined &&
    HARDENING_PROFILE.tmpfsOptions.every((option) => given.includes(option)) &&
    !TMPFS_REENABLING_OPTIONS.some((option) => given.includes(option)) &&
    sizes.length === 1 &&
    size !== undefined &&
    tmpfsSizeBytes(size.slice("size=".length)) === expectedBytes
  );
}

// True only when every rlimit of the profile appears in the OCI rlimits exactly once with the soft and the hard value both equal
// to the profile's limit. Entries of other types are tolerated, because the engine may add its own default (for example
// RLIMIT_NPROC) when the create body omits it; an entry that is not an object with a type is not an engine entry and fails.
function rlimitsMatch(value: unknown): boolean {
  if (!Array.isArray(value)) {
    return false;
  }
  const entries: readonly unknown[] = value;
  if (!entries.every((entry) => isRecord(entry) && typeof entry.type === "string")) {
    return false;
  }
  return HARDENING_PROFILE.rlimits.every((limit) => {
    const ofType = entries.filter((entry) => isRecord(entry) && entry.type === limit.type);
    const [only] = ofType;
    return ofType.length === 1 && isRecord(only) && only.soft === limit.limit && only.hard === limit.limit;
  });
}

// True only when every sysctl of the profile is present with exactly the expected string value. Extra keys are tolerated,
// because the engine may add its own defaults (for example net.ipv4.ping_group_range).
function sysctlsMatch(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  return Object.entries(HARDENING_PROFILE.sysctls).every(([name, setting]) => value[name] === setting);
}

// True only when the value is an array of strings that holds every required path. Extra paths are allowed.
function includesEvery(value: unknown, required: readonly string[]): boolean {
  if (!Array.isArray(value)) {
    return false;
  }
  const paths: readonly unknown[] = value;
  return required.every((path) => paths.includes(path));
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

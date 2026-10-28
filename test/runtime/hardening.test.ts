import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CHANNEL_MOUNT_OPTIONS,
  channelOptionFailures,
  hardeningEvidenceDigest,
  HARDENING_PROFILE,
  HARDENING_PROPERTIES,
  type HardeningBinding,
  type HardeningProperty,
  RUNTIME_ARGV,
  RUNTIME_BINARY,
  SUPERVISOR_CA_TMPFS_OPTIONS,
  verifyInspect,
} from "../../src/runtime/hardening.js";
import { SECCOMP_PROFILE_FILE_NAME } from "../../src/runtime/driver/seccomp-profile.js";
import { SANDBOX_WORKSPACE_PATH } from "../../src/runtime/openshell.js";

const DIGEST_HEX = "a".repeat(64);
const DIGEST = `sha256:${DIGEST_HEX}`;
const WORKSPACE = "/realm/workspace";
const STATE = "/realm/state";
const CHANNEL = "/realm/channel";
const SUPERVISOR_CA = HARDENING_PROFILE.supervisorCaDestination;
const SECCOMP_PATH = `/realm/seccomp/${SECCOMP_PROFILE_FILE_NAME}`;

const BINDING: HardeningBinding = {
  image: `registry.example.com/realm/session@${DIGEST}`,
  rootless: true,
  workspaceRoot: WORKSPACE,
  stateDir: STATE,
  channelDir: CHANNEL,
};

// A libpod inspect object that conforms to every D-51 property of a sandbox container. Each call returns a fresh object,
// so a test can change one field without affecting the others. Capability sets are not in the inspect: the live proof
// reads them from the process (kernel-caps.ts).
function conforming(): Record<string, unknown> {
  return {
    ImageDigest: DIGEST,
    SeccompProfilePath: SECCOMP_PATH,
    Path: RUNTIME_BINARY,
    Args: RUNTIME_ARGV.slice(1),
    HostConfig: {
      Privileged: false,
      CapAdd: [],
      SecurityOpt: ["no-new-privileges"],
      ReadonlyRootfs: true,
      Tmpfs: { "/tmp": "rw", "/run": "rw", [SUPERVISOR_CA]: "rw" },
      PidsLimit: 512,
      Memory: 1024 * 1024 * 1024,
      NanoCpus: 2_000_000_000,
      NetworkMode: "none",
    },
    Mounts: [
      bind(WORKSPACE, "/workspace", true),
      bind(STATE, "/realm-state", false),
      bind(CHANNEL, HARDENING_PROFILE.channelDestination, true),
    ],
  };
}

// A bind mount entry of a libpod inspect object, with the read-write flag that D-51 checks.
function bind(source: string, destination: string, rw: boolean): Record<string, unknown> {
  return { Type: "bind", Source: source, Destination: destination, RW: rw };
}

type Inspect = Record<string, unknown>;

// One row per field-level property: the path to the field, and a value that violates it.
const FIELD_CASES: ReadonlyArray<{
  readonly property: HardeningProperty;
  readonly path: readonly string[];
  readonly wrong: unknown;
}> = [
  { property: "privileged", path: ["HostConfig", "Privileged"], wrong: true },
  { property: "cap-add", path: ["HostConfig", "CapAdd"], wrong: ["NET_ADMIN"] },
  { property: "no-new-privileges", path: ["HostConfig", "SecurityOpt"], wrong: [] },
  { property: "read-only-root", path: ["HostConfig", "ReadonlyRootfs"], wrong: false },
  { property: "tmpfs", path: ["HostConfig", "Tmpfs"], wrong: { "/tmp": "rw" } },
  { property: "pids-limit", path: ["HostConfig", "PidsLimit"], wrong: 1024 },
  { property: "memory-limit", path: ["HostConfig", "Memory"], wrong: 2 * 1024 * 1024 * 1024 },
  { property: "cpu-limit", path: ["HostConfig", "NanoCpus"], wrong: 4_000_000_000 },
  { property: "network-mode", path: ["HostConfig", "NetworkMode"], wrong: "bridge" },
  { property: "image-digest", path: ["ImageDigest"], wrong: `sha256:${"b".repeat(64)}` },
  { property: "seccomp-profile", path: ["SeccompProfilePath"], wrong: "/realm/seccomp/default.json" },
];

void test("the frozen profile carries the D-51 values (RT-01)", () => {
  assert.equal(Object.isFrozen(HARDENING_PROFILE), true);
  assert.equal(Object.isFrozen(HARDENING_PROFILE.tmpfs), true);
  assert.deepEqual([...HARDENING_PROFILE.capAdd], []);
  assert.equal(HARDENING_PROFILE.privileged, false);
  assert.equal(HARDENING_PROFILE.readonlyRootfs, true);
  assert.deepEqual([...HARDENING_PROFILE.tmpfs], ["/tmp", "/run"]);
  assert.equal(HARDENING_PROFILE.pidsLimit, 512);
  assert.equal(HARDENING_PROFILE.memoryBytes, 1024 * 1024 * 1024);
  assert.equal(HARDENING_PROFILE.nanoCpus, 2_000_000_000);
  assert.equal(HARDENING_PROFILE.networkMode, "none");
});

void test("a conforming inspect yields an empty failure list (RT-01)", () => {
  assert.deepEqual(verifyInspect(BINDING, conforming()), []);
});

void test("every D-51 property has a named check, and a non-object inspect fails every inspect-derived property (RT-01)", () => {
  assert.deepEqual(
    [...HARDENING_PROPERTIES],
    [
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
    ],
  );
  // The rootless check reads the binding, so only the inspect-derived properties fail on a non-object inspect.
  const inspectDerived = HARDENING_PROPERTIES.filter((property) => property !== "rootless");
  assert.deepEqual(verifyInspect(BINDING, undefined), inspectDerived);
  assert.deepEqual(verifyInspect(BINDING, "not an object"), inspectDerived);
});

for (const row of FIELD_CASES) {
  void test(`a wrong value for ${row.property} fails that property alone (RT-01)`, () => {
    const inspect = conforming();
    setPath(inspect, row.path, row.wrong);
    assert.deepEqual(verifyInspect(BINDING, inspect), [row.property]);
  });

  void test(`a missing field for ${row.property} fails closed with that property named (RT-01)`, () => {
    const inspect = conforming();
    deletePath(inspect, row.path);
    assert.ok(verifyInspect(BINDING, inspect).includes(row.property));
  });
}

void test("a field of the wrong type fails closed rather than being coerced (RT-01)", () => {
  const inspect = conforming();
  const host = inspect.HostConfig as Record<string, unknown>;
  host.Privileged = "false";
  host.ReadonlyRootfs = 1;
  host.PidsLimit = "512";
  assert.deepEqual(verifyInspect(BINDING, inspect), ["privileged", "read-only-root", "pids-limit"]);
});

void test("a null CapAdd is not an empty list and fails the cap-add property (RT-01)", () => {
  const inspect = conforming();
  (inspect.HostConfig as Record<string, unknown>).CapAdd = null;
  assert.deepEqual(verifyInspect(BINDING, inspect), ["cap-add"]);
});

void test("rootless is taken from the binding, and anything other than true fails it (RT-01)", () => {
  assert.deepEqual(verifyInspect({ ...BINDING, rootless: false }, conforming()), ["rootless"]);
});

void test("a mount that is not the workspace root and the state directory fails the mounts property (RT-01)", () => {
  const inspect = conforming();
  inspect.Mounts = [
    bind(WORKSPACE, "/workspace", true),
    bind("/realm/elsewhere", "/elsewhere", false),
    bind(CHANNEL, HARDENING_PROFILE.channelDestination, true),
  ];
  assert.deepEqual(verifyInspect(BINDING, inspect), ["mounts"]);
});

void test("a read-write state directory mount fails the mounts property, because the state directory is read-only (RT-01, D-51)", () => {
  const inspect = conforming();
  inspect.Mounts = [
    bind(WORKSPACE, "/workspace", true),
    bind(STATE, "/realm-state", true),
    bind(CHANNEL, HARDENING_PROFILE.channelDestination, true),
  ];
  assert.deepEqual(verifyInspect(BINDING, inspect), ["mounts"]);
});

void test("a state directory mount at the wrong destination fails the mounts property (RT-01, D-51)", () => {
  const inspect = conforming();
  inspect.Mounts = [
    bind(WORKSPACE, "/workspace", true),
    bind(STATE, "/elsewhere", false),
    bind(CHANNEL, HARDENING_PROFILE.channelDestination, true),
  ];
  assert.deepEqual(verifyInspect(BINDING, inspect), ["mounts"]);
});

void test("a workspace mount at the wrong destination fails the mounts property (RT-01, D-51)", () => {
  const inspect = conforming();
  inspect.Mounts = [
    bind(WORKSPACE, "/elsewhere", true),
    bind(STATE, "/realm-state", false),
    bind(CHANNEL, HARDENING_PROFILE.channelDestination, true),
  ];
  assert.deepEqual(verifyInspect(BINDING, inspect), ["mounts"]);
});

void test("a read-only workspace mount fails the mounts property, because the policy grants /workspace read-write (RT-01)", () => {
  const inspect = conforming();
  inspect.Mounts = [
    bind(WORKSPACE, "/workspace", false),
    bind(STATE, "/realm-state", false),
    bind(CHANNEL, HARDENING_PROFILE.channelDestination, true),
  ];
  assert.deepEqual(verifyInspect(BINDING, inspect), ["mounts"]);
});

void test("a mount without a read-write flag fails the mounts property closed (RT-01)", () => {
  const inspect = conforming();
  const state = bind(STATE, "/realm-state", false);
  Reflect.deleteProperty(state, "RW");
  inspect.Mounts = [bind(WORKSPACE, "/workspace", true), state, bind(CHANNEL, HARDENING_PROFILE.channelDestination, true)];
  assert.deepEqual(verifyInspect(BINDING, inspect), ["mounts"]);
});

void test("the workspace destination in the profile is the in-sandbox workspace path of the OpenShell policy (RT-01)", () => {
  assert.equal(HARDENING_PROFILE.workspaceDestination, SANDBOX_WORKSPACE_PATH);
});

void test("an extra mount fails the mounts property even when every expected path is present (RT-01)", () => {
  const inspect = conforming();
  inspect.Mounts = [
    bind(WORKSPACE, "/workspace", true),
    bind(STATE, "/realm-state", false),
    bind(CHANNEL, HARDENING_PROFILE.channelDestination, true),
    bind("/realm/extra", "/extra", false),
  ];
  assert.deepEqual(verifyInspect(BINDING, inspect), ["mounts"]);
});

void test("a tmpfs entry in the mount list fails the mounts property, because only bind mounts are admitted (RT-01)", () => {
  const inspect = conforming();
  inspect.Mounts = [
    bind(WORKSPACE, "/workspace", true),
    bind(STATE, "/realm-state", false),
    { Type: "tmpfs", Source: "tmpfs", Destination: "/scratch" },
  ];
  assert.deepEqual(verifyInspect(BINDING, inspect), ["mounts"]);
});

void test("a mount of the docker or podman socket fails the socket-path property and the mounts property (RT-01)", () => {
  for (const socket of ["/var/run/docker.sock", "/run/user/1000/podman/podman.sock"]) {
    const inspect = conforming();
    inspect.Mounts = [
      bind(WORKSPACE, "/workspace", true),
      bind(socket, "/run/host.sock", false),
      bind(CHANNEL, HARDENING_PROFILE.channelDestination, true),
    ];
    const failed = verifyInspect(BINDING, inspect);
    assert.ok(failed.includes("socket-path"), `socket ${socket} must fail socket-path`);
    assert.ok(failed.includes("mounts"), `socket ${socket} must fail mounts`);
  }
});

void test("a socket name in a mount destination fails the socket-path property (RT-01)", () => {
  const inspect = conforming();
  inspect.Mounts = [
    bind(WORKSPACE, "/workspace/podman.sock", true),
    bind(STATE, "/realm-state", false),
    bind(CHANNEL, HARDENING_PROFILE.channelDestination, true),
  ];
  assert.ok(verifyInspect(BINDING, inspect).includes("socket-path"));
});

void test("a missing Mounts field fails the mounts and socket-path properties (RT-01)", () => {
  const inspect = conforming();
  delete inspect.Mounts;
  assert.deepEqual(verifyInspect(BINDING, inspect), ["mounts", "socket-path"]);
});

void test("the digest check compares against the pinned digest of the binding image (RT-01)", () => {
  const other: HardeningBinding = {
    ...BINDING,
    image: `registry.example.com/realm/session@sha256:${"c".repeat(64)}`,
  };
  assert.deepEqual(verifyInspect(other, conforming()), ["image-digest"]);
});

void test("an image reference with no digest fails the digest property, never matching by default (RT-01)", () => {
  assert.deepEqual(verifyInspect({ ...BINDING, image: "registry.example.com/realm/session" }, conforming()), [
    "image-digest",
  ]);
});

void test("a read-write channel mount of the wrong source fails the mounts property (RT-01)", () => {
  const inspect = conforming();
  inspect.Mounts = [
    bind(WORKSPACE, "/workspace", true),
    bind(STATE, "/realm-state", false),
    bind("/realm/elsewhere", HARDENING_PROFILE.channelDestination, true),
  ];
  assert.deepEqual(verifyInspect(BINDING, inspect), ["mounts"]);
});

void test("a channel binding refuses a read-only channel mount, because the runtime writes its socket there (RT-01)", () => {
  const inspect = conforming();
  inspect.Mounts = [
    bind(WORKSPACE, "/workspace", true),
    bind(STATE, "/realm-state", false),
    bind(CHANNEL, HARDENING_PROFILE.channelDestination, false),
  ];
  assert.deepEqual(verifyInspect(BINDING, inspect), ["mounts"]);
});

void test("a channel binding refuses a container without the CA tmpfs (RT-01)", () => {
  const inspect = conforming();
  inspect.HostConfig = { ...(inspect.HostConfig as Record<string, unknown>), Tmpfs: { "/tmp": "rw", "/run": "rw" } };
  assert.deepEqual(verifyInspect(BINDING, inspect), ["tmpfs"]);
});

void test("PID 1 of a sandbox container is the runtime with its exact argv: any other program or argument list is refused (phase 9.5, wave 3)", () => {
  const cases: readonly (readonly [string, (inspect: Inspect) => void])[] = [
    ["another program", (inspect) => { inspect.Path = "/opt/realm/bin/realm-helper"; }],
    ["another argument list", (inspect) => { inspect.Args = ["idle"]; }],
    ["an extra argument", (inspect) => { inspect.Args = [...RUNTIME_ARGV.slice(1), "--extra"]; }],
    ["the arguments reordered", (inspect) => { inspect.Args = [...RUNTIME_ARGV.slice(1)].reverse(); }],
    ["no program", (inspect) => { Reflect.deleteProperty(inspect, "Path"); }],
    ["no arguments", (inspect) => { Reflect.deleteProperty(inspect, "Args"); }],
  ];
  for (const [name, change] of cases) {
    const inspect = conforming();
    change(inspect);
    assert.deepEqual(verifyInspect(BINDING, inspect), ["init-process"], name);
  }
});

void test("seccomp-profile: an inspect naming the embedded profile file by an absolute path conforms (phase 9.6)", () => {
  const inspect = conforming();
  assert.equal(inspect.SeccompProfilePath, SECCOMP_PATH);
  assert.deepEqual(verifyInspect(BINDING, inspect), []);
  inspect.SeccompProfilePath = `/another/directory/${SECCOMP_PROFILE_FILE_NAME}`;
  assert.deepEqual(verifyInspect(BINDING, inspect), [], "only the file name is fixed, not the directory");
});

void test("seccomp-profile: an absent value fails, since Podman omits the field when no profile is set (phase 9.6)", () => {
  const inspect = conforming();
  Reflect.deleteProperty(inspect, "SeccompProfilePath");
  assert.deepEqual(verifyInspect(BINDING, inspect), ["seccomp-profile"]);
});

void test("seccomp-profile: a profile file of another name fails, even one that differs in a single digit (phase 9.6)", () => {
  const flipped = SECCOMP_PROFILE_FILE_NAME.replace(/(?<=seccomp-)[0-9a-f]/, (digit) => (digit === "0" ? "1" : "0"));
  assert.notEqual(flipped, SECCOMP_PROFILE_FILE_NAME);
  const names = [
    "default.json",
    "realm-seccomp-0000000000000000.json",
    flipped,
    `${SECCOMP_PROFILE_FILE_NAME}.bak`,
    `old-${SECCOMP_PROFILE_FILE_NAME}`,
    "",
  ];
  for (const name of names) {
    const inspect = conforming();
    inspect.SeccompProfilePath = `/realm/seccomp/${name}`;
    assert.deepEqual(verifyInspect(BINDING, inspect), ["seccomp-profile"], name);
  }
});

void test("seccomp-profile: a relative path fails, whatever its file name (phase 9.6)", () => {
  for (const path of [SECCOMP_PROFILE_FILE_NAME, `seccomp/${SECCOMP_PROFILE_FILE_NAME}`, `./${SECCOMP_PROFILE_FILE_NAME}`]) {
    const inspect = conforming();
    inspect.SeccompProfilePath = path;
    assert.deepEqual(verifyInspect(BINDING, inspect), ["seccomp-profile"], path);
  }
});

void test("seccomp-profile: a value that is not a string, or whose file name is a directory, fails closed (phase 9.6)", () => {
  const values: readonly unknown[] = [
    null,
    42,
    true,
    [SECCOMP_PATH],
    { path: SECCOMP_PATH },
    `${SECCOMP_PATH}/`,
    `${SECCOMP_PATH}/inner.json`,
  ];
  for (const value of values) {
    const inspect = conforming();
    inspect.SeccompProfilePath = value;
    assert.deepEqual(verifyInspect(BINDING, inspect), ["seccomp-profile"], JSON.stringify(value));
  }
});

void test("seccomp-profile: the profile carries the file name, so the evidence digest binds the profile (phase 9.6)", () => {
  assert.equal(HARDENING_PROFILE.seccompProfileFile, SECCOMP_PROFILE_FILE_NAME);
  assert.match(hardeningEvidenceDigest(BINDING.image), /^[0-9a-f]{64}$/);
  assert.notEqual(hardeningEvidenceDigest(BINDING.image), hardeningEvidenceDigest(`${BINDING.image}-other`));
});

function setPath(root: Inspect, path: readonly string[], value: unknown): void {
  const parent = parentOf(root, path);
  const key = path[path.length - 1];
  if (key === undefined) {
    throw new Error("empty path");
  }
  parent[key] = value;
}

function deletePath(root: Inspect, path: readonly string[]): void {
  const parent = parentOf(root, path);
  const key = path[path.length - 1];
  if (key === undefined) {
    throw new Error("empty path");
  }
  Reflect.deleteProperty(parent, key);
}

function parentOf(root: Inspect, path: readonly string[]): Record<string, unknown> {
  let node: Record<string, unknown> = root;
  for (const key of path.slice(0, -1)) {
    node = node[key] as Record<string, unknown>;
  }
  return node;
}

// A container as created, before start: the CA tmpfs and the channel mount carry the given options (phase 9.5, F).
function createdSandbox(
  caOptions: readonly string[] = SUPERVISOR_CA_TMPFS_OPTIONS,
  channelOptions: readonly string[] = CHANNEL_MOUNT_OPTIONS,
): Record<string, unknown> {
  const inspect = conforming();
  inspect.HostConfig = {
    ...(inspect.HostConfig as Record<string, unknown>),
    Tmpfs: { "/tmp": "nosuid,nodev", "/run": "nosuid,nodev", [SUPERVISOR_CA]: caOptions.join(",") },
  };
  inspect.Mounts = [
    bind(WORKSPACE, "/workspace", true),
    bind(STATE, "/realm-state", false),
    { ...bind(CHANNEL, HARDENING_PROFILE.channelDestination, true), Options: [...channelOptions, "rbind"] },
  ];
  return inspect;
}

void test("a container as created carries the CA tmpfs and channel mount options it must (phase 9.5, F)", () => {
  assert.deepEqual(channelOptionFailures(createdSandbox()), []);
});

for (const option of SUPERVISOR_CA_TMPFS_OPTIONS) {
  void test(`a CA tmpfs without ${option} fails ca-tmpfs-options alone, before start (phase 9.5, F)`, () => {
    const options = SUPERVISOR_CA_TMPFS_OPTIONS.filter((member) => member !== option);
    assert.deepEqual(channelOptionFailures(createdSandbox(options)), ["ca-tmpfs-options"]);
  });
}

for (const option of CHANNEL_MOUNT_OPTIONS) {
  void test(`a channel mount without ${option} fails channel-mount-options alone, before start (phase 9.5, F)`, () => {
    const options = CHANNEL_MOUNT_OPTIONS.filter((member) => member !== option);
    assert.deepEqual(channelOptionFailures(createdSandbox(undefined, options)), ["channel-mount-options"]);
  });
}

void test("a read-only channel mount (RW false) fails channel-mount-options alone, before start (phase 9.5, F)", () => {
  const inspect = createdSandbox();
  inspect.Mounts = [
    bind(WORKSPACE, "/workspace", true),
    bind(STATE, "/realm-state", false),
    { ...bind(CHANNEL, HARDENING_PROFILE.channelDestination, false), Options: ["rw", ...CHANNEL_MOUNT_OPTIONS, "rbind"] },
  ];
  assert.deepEqual(channelOptionFailures(inspect), ["channel-mount-options"]);
});

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
  tmpfsOptionsOf,
  tmpfsSizeBytes,
  verifyInspect,
} from "../../src/runtime/hardening.js";
import { RealmError } from "../../src/core/errors.js";
import { attachRuntimeEvidence, OCI_RUNTIME_FIELD } from "../../src/runtime/create-evidence.js";
import { KERNEL_STATUS_FIELD, liveCapabilityFailures } from "../../src/runtime/kernel-caps.js";
import { SECCOMP_PROFILE_FILE_NAME } from "../../src/runtime/driver/seccomp-profile.js";
import { SANDBOX_WORKSPACE_PATH } from "../../src/runtime/openshell.js";
import { MAX_OCI_CONFIG_BYTES, SECCOMP_EVIDENCE_FIELD } from "../../src/runtime/seccomp-evidence.js";
import {
  CONFORMING_PROC_STATUS,
  procStatusOf,
  RUNTIME_KEYCTL_ALLOWED_OCI_CONFIG_TEXT,
  RUNTIME_OCI_CONFIG_TEXT,
} from "./hardening-fixtures.js";
import { OCI_CONFIG_PATH, ociReaderOf, STATIC_DIR } from "./seccomp-fixtures.js";

const DIGEST_HEX = "a".repeat(64);
const DIGEST = `sha256:${DIGEST_HEX}`;
const WORKSPACE = "/realm/workspace";
const STATE = "/realm/state";
const CHANNEL = "/realm/channel";
const SUPERVISOR_CA = HARDENING_PROFILE.supervisorCaDestination;

const BINDING: HardeningBinding = {
  image: `registry.example.com/realm/session@${DIGEST}`,
  rootless: true,
  workspaceRoot: WORKSPACE,
  stateDir: STATE,
  channelDir: CHANNEL,
};

// The inspect before the host read: no host evidence attached. The OCI config path is tied to the container's StaticDir.
function rawConforming(): Record<string, unknown> {
  return {
    ImageDigest: DIGEST,
    Path: RUNTIME_BINARY,
    Args: RUNTIME_ARGV.slice(1),
    StaticDir: STATIC_DIR,
    OCIConfigPath: OCI_CONFIG_PATH,
    State: { Pid: 4242 },
    Config: { User: HARDENING_PROFILE.workloadUser },
    HostConfig: {
      Privileged: false,
      CapAdd: [],
      SecurityOpt: ["no-new-privileges"],
      ReadonlyRootfs: true,
      Tmpfs: Object.fromEntries(
        [...HARDENING_PROFILE.tmpfs, SUPERVISOR_CA].map((destination): [string, string] => [destination, tmpfsOptionsOf(destination).join(",")]),
      ),
      PidsLimit: 512,
      Memory: 1024 * 1024 * 1024,
      MemorySwap: 1024 * 1024 * 1024,
      NanoCpus: 2_000_000_000,
      NetworkMode: "none",
      Devices: [],
      PidMode: "private",
      IpcMode: "shareable",
      UTSMode: "private",
      CgroupMode: "private",
      UsernsMode: "keep-id:uid=1001,gid=1001",
    },
    Mounts: [
      bind(WORKSPACE, "/workspace", true),
      bind(STATE, "/realm-state", false),
      bind(CHANNEL, HARDENING_PROFILE.channelDestination, true),
    ],
  };
}

// A libpod inspect object that conforms to every D-51 property of a sandbox container, with the host evidence attached from a
// conforming OCI config and a conforming init process status. Each call returns a fresh object, so a test can change one field
// without affecting the others.
function conforming(): Record<string, unknown> {
  return { ...attachRuntimeEvidence(rawConforming(), ociReaderOf(RUNTIME_OCI_CONFIG_TEXT), () => CONFORMING_PROC_STATUS) };
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
  { property: "live-seccomp", path: [KERNEL_STATUS_FIELD, "Seccomp"], wrong: "0" },
  { property: "live-no-new-privs", path: [KERNEL_STATUS_FIELD, "NoNewPrivs"], wrong: "0" },
  { property: "namespaces", path: ["HostConfig", "PidMode"], wrong: "host" },
  { property: "devices", path: ["HostConfig", "Devices"], wrong: [{ PathOnHost: "/dev/fuse", PathInContainer: "/dev/fuse", CgroupPermissions: "rwm" }] },
  { property: "user", path: ["Config", "User"], wrong: "0:0" },
  { property: "security-opt", path: ["HostConfig", "SecurityOpt"], wrong: ["no-new-privileges", "label=disable"] },
  { property: "memory-swap", path: ["HostConfig", "MemorySwap"], wrong: 2 * 1024 * 1024 * 1024 },
  { property: "ulimits", path: [OCI_RUNTIME_FIELD, "rlimits"], wrong: [{ type: "RLIMIT_NOFILE", soft: 1048576, hard: 1048576 }] },
  { property: "sysctls", path: [OCI_RUNTIME_FIELD, "sysctl"], wrong: { "net.ipv4.ip_unprivileged_port_start": "1024" } },
  { property: "masked-paths", path: [OCI_RUNTIME_FIELD, "maskedPaths"], wrong: ["/proc/kcore"] },
  { property: "readonly-paths", path: [OCI_RUNTIME_FIELD, "readonlyPaths"], wrong: [] },
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

void test("the frozen profile carries the F5, F9 and F10 values: user, tmpfs caps, rlimits, sysctls and paths", () => {
  for (const value of [
    HARDENING_PROFILE.tmpfsOptions,
    HARDENING_PROFILE.tmpfsSizes,
    HARDENING_PROFILE.rlimits,
    HARDENING_PROFILE.sysctls,
    HARDENING_PROFILE.maskedPaths,
    HARDENING_PROFILE.readonlyPaths,
  ]) {
    assert.equal(Object.isFrozen(value), true);
  }
  assert.equal(HARDENING_PROFILE.workloadUser, "1001:1001");
  assert.deepEqual([...HARDENING_PROFILE.tmpfsOptions], ["noexec", "nosuid", "nodev"]);
  assert.deepEqual(
    HARDENING_PROFILE.rlimits.map(({ type, limit }) => [type, limit]),
    [["RLIMIT_NOFILE", 4096], ["RLIMIT_CORE", 0]],
  );
  assert.equal(HARDENING_PROFILE.sysctls["net.ipv4.ip_unprivileged_port_start"], "0");
  assert.deepEqual(Object.keys(HARDENING_PROFILE.sysctls), [
    "net.ipv4.ip_unprivileged_port_start",
    "net.ipv6.conf.all.disable_ipv6",
    "net.ipv6.conf.default.disable_ipv6",
  ]);
});

void test("every tmpfs of the profile has a bounded size, and a destination without one is refused (F9)", () => {
  for (const destination of [...HARDENING_PROFILE.tmpfs, SUPERVISOR_CA]) {
    const options = tmpfsOptionsOf(destination);
    assert.ok(options.some((option) => /^size=[1-9][0-9]*[kmg]$/.test(option)), destination);
    assert.ok(options.includes("noexec") && options.includes("nosuid") && options.includes("nodev"), destination);
  }
  assert.ok(tmpfsOptionsOf(SUPERVISOR_CA).includes("mode=1703"));
  assert.throws(
    () => tmpfsOptionsOf("/var/tmp"),
    (error: unknown) => error instanceof RealmError && error.code === "SCHEMA_INVALID",
  );
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
    ["another program", (inspect) => { inspect.Path = "/opt/other/bin/program"; }],
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

// An inspect of an API-created container as Podman 5.7.1 reports it (real layout): SecurityOpt holds only no-new-privileges and the
// annotations carry no seccomp entry, or a misleading one. The OCI config and the init status are attached through the injected
// readers.
function realisticWith(text: string, extra: Inspect = {}): Inspect {
  const inspect: Inspect = { ...rawConforming(), Id: "0".repeat(64), Name: "realm-sandbox", Image: "1".repeat(64), ...extra };
  return { ...attachRuntimeEvidence(inspect, ociReaderOf(text), () => CONFORMING_PROC_STATUS) };
}

// The properties that read host evidence. A container whose evidence is absent fails exactly these.
const EVIDENCE_PROPERTIES: readonly HardeningProperty[] = [
  "seccomp-keyring",
  "live-seccomp",
  "live-no-new-privs",
  "ulimits",
  "sysctls",
  "masked-paths",
  "readonly-paths",
];

void test("seccomp-keyring: passes only on attached evidence that all three keyring syscalls are denied (phase 9.6)", () => {
  assert.deepEqual(verifyInspect(BINDING, conforming()), []);
  assert.deepEqual(verifyInspect(BINDING, realisticWith(RUNTIME_KEYCTL_ALLOWED_OCI_CONFIG_TEXT)), ["seccomp-keyring"]);
});

void test("seccomp-keyring: fails closed when no evidence is attached, or the evidence is not exactly true (phase 9.6)", () => {
  assert.deepEqual(verifyInspect(BINDING, rawConforming()), EVIDENCE_PROPERTIES);
  for (const value of [false, "true", 1, null, {}]) {
    assert.deepEqual(verifyInspect(BINDING, { ...rawConforming(), [SECCOMP_EVIDENCE_FIELD]: value }), EVIDENCE_PROPERTIES, JSON.stringify(value));
  }
});

void test("seccomp-keyring: the property ignores SecurityOpt and the annotations of a real Podman 5.7.1 inspect (phase 9.6)", () => {
  const annotated = (securityOpt: unknown, annotation: string): Inspect => {
    const host = { ...(rawConforming().HostConfig as Record<string, unknown>), SecurityOpt: securityOpt, Annotations: { "io.podman.annotations.seccomp": annotation } };
    return {
      HostConfig: host,
      Config: {
        User: HARDENING_PROFILE.workloadUser,
        Annotations: { "io.podman.annotations.seccomp": annotation },
        CreateCommand: ["podman", "create", "--security-opt", `seccomp=${annotation}`, "--security-opt", "no-new-privileges"],
      },
    };
  };
  // A conforming OCI config passes whatever SecurityOpt and the annotations say: the real layout has no seccomp= entry at all.
  const passing = realisticWith(RUNTIME_OCI_CONFIG_TEXT, annotated(["no-new-privileges"], ""));
  assert.equal(Object.hasOwn(passing, "SeccompProfilePath"), false);
  assert.deepEqual(verifyInspect(BINDING, passing), []);
  const lying = realisticWith(RUNTIME_OCI_CONFIG_TEXT, annotated(["no-new-privileges", "seccomp=/realm/seccomp/default.json"], "/realm/seccomp/default.json"));
  assert.deepEqual(verifyInspect(BINDING, lying), []);
  // An OCI config that allows keyctl fails although SecurityOpt and the annotations name a profile.
  const named = `/realm/seccomp/${SECCOMP_PROFILE_FILE_NAME}`;
  const refused = realisticWith(RUNTIME_KEYCTL_ALLOWED_OCI_CONFIG_TEXT, annotated(["no-new-privileges", `seccomp=${named}`], named));
  assert.deepEqual(verifyInspect(BINDING, refused), ["seccomp-keyring"]);
});

void test("seccomp-keyring: the profile carries the file name, so the evidence digest binds the profile (phase 9.6)", () => {
  assert.equal(HARDENING_PROFILE.seccompProfileFile, SECCOMP_PROFILE_FILE_NAME);
  assert.match(hardeningEvidenceDigest(BINDING.image), /^[0-9a-f]{64}$/);
  assert.notEqual(hardeningEvidenceDigest(BINDING.image), hardeningEvidenceDigest(`${BINDING.image}-other`));
});

// The five HostConfig fields that name a namespace mode, and the value that each must not carry (F5).
const NAMESPACE_FIELDS = ["PidMode", "IpcMode", "UTSMode", "CgroupMode", "UsernsMode"] as const;

for (const name of NAMESPACE_FIELDS) {
  void test(`namespaces: a host, joined-path or joined-container ${name} fails the namespaces property alone (F5)`, () => {
    for (const mode of ["host", "host:/proc/1/ns", "ns:/proc/1/ns/pid", "container:0123456789ab"]) {
      const inspect = conforming();
      (inspect.HostConfig as Record<string, unknown>)[name] = mode;
      assert.deepEqual(verifyInspect(BINDING, inspect), ["namespaces"], `${name}=${mode}`);
    }
  });

  void test(`namespaces: the engine's private modes and a missing or mistyped ${name} are told apart (F5)`, () => {
    for (const mode of ["", "private", "shareable", "keep-id:uid=1001,gid=1001"]) {
      const inspect = conforming();
      (inspect.HostConfig as Record<string, unknown>)[name] = mode;
      assert.deepEqual(verifyInspect(BINDING, inspect), [], `${name}=${mode}`);
    }
    for (const bad of [null, 0, ["host"], undefined]) {
      const inspect = conforming();
      (inspect.HostConfig as Record<string, unknown>)[name] = bad;
      assert.deepEqual(verifyInspect(BINDING, inspect), ["namespaces"], `${name}=${JSON.stringify(bad)}`);
    }
  });
}

void test("devices: a null or non-list Devices is not an empty list and fails the devices property (F5)", () => {
  for (const value of [null, {}, "", 0]) {
    const inspect = conforming();
    (inspect.HostConfig as Record<string, unknown>).Devices = value;
    assert.deepEqual(verifyInspect(BINDING, inspect), ["devices"], JSON.stringify(value));
  }
});

void test("user: only the workload user passes, whatever form the root user takes (F5)", () => {
  for (const user of ["", "0", "root", "0:0", "1001", "1001:0", "root:root"]) {
    const inspect = conforming();
    (inspect.Config as Record<string, unknown>).User = user;
    assert.deepEqual(verifyInspect(BINDING, inspect), ["user"], JSON.stringify(user));
  }
  const inspect = conforming();
  Reflect.deleteProperty(inspect, "Config");
  assert.deepEqual(verifyInspect(BINDING, inspect), ["user"]);
});

void test("security-opt: an option that disables the label or unmasks a path fails the property alone, a mistyped entry too (F5)", () => {
  for (const option of ["label=disable", "label:disable", "unmask=ALL", "unmask=/proc/*", "unmask"]) {
    const inspect = conforming();
    (inspect.HostConfig as Record<string, unknown>).SecurityOpt = ["no-new-privileges", option];
    assert.deepEqual(verifyInspect(BINDING, inspect), ["security-opt"], option);
  }
  const mistyped = conforming();
  (mistyped.HostConfig as Record<string, unknown>).SecurityOpt = ["no-new-privileges", 7];
  assert.deepEqual(verifyInspect(BINDING, mistyped), ["security-opt"]);
  const label = conforming();
  (label.HostConfig as Record<string, unknown>).SecurityOpt = ["no-new-privileges", "label=type:container_t", "seccomp=/realm/seccomp/profile.json"];
  assert.deepEqual(verifyInspect(BINDING, label), []);
});

void test("memory-swap: a swap above or below the memory limit, and a mistyped one, fail the property alone (F9)", () => {
  for (const swap of [0, -1, 1024 * 1024 * 1024 + 1, "1073741824", null]) {
    const inspect = conforming();
    (inspect.HostConfig as Record<string, unknown>).MemorySwap = swap;
    assert.deepEqual(verifyInspect(BINDING, inspect), ["memory-swap"], JSON.stringify(swap));
  }
});

void test("tmpfsSizeBytes: a plain byte count and the k, m and g suffixes parse to bytes, and anything else is refused (F9)", () => {
  assert.equal(tmpfsSizeBytes("4096"), 4096);
  assert.equal(tmpfsSizeBytes("4k"), 4096);
  assert.equal(tmpfsSizeBytes("16m"), 16 * 1024 * 1024);
  assert.equal(tmpfsSizeBytes("1G"), 1024 ** 3);
  assert.equal(tmpfsSizeBytes("256m"), tmpfsSizeBytes("262144k"));
  for (const bad of ["", "0", "0m", "100%", "-1", "1.5m", "m", "1t", "1 m", "9999999999999999999g"]) {
    assert.equal(tmpfsSizeBytes(bad), undefined, bad);
  }
});

void test("tmpfs: a mount without noexec, nosuid, nodev or the profile's size fails the tmpfs property alone (F9)", () => {
  const bounded = (destination: string): string => tmpfsOptionsOf(destination).join(",");
  const broken: readonly (readonly [string, string])[] = [
    ["no size", bounded("/tmp").replace(/,size=[^,]+/, "")],
    ["a percentage size", bounded("/tmp").replace(/size=[^,]+/, "size=100%")],
    ["a zero size", bounded("/tmp").replace(/size=[^,]+/, "size=0")],
    ["a tiny size", bounded("/tmp").replace(/size=[^,]+/, "size=1")],
    ["a huge size", bounded("/tmp").replace(/size=[^,]+/, "size=900g")],
    ["another destination's size", bounded("/tmp").replace(/size=[^,]+/, "size=16m")],
    ["a repeated size", `${bounded("/tmp")},size=256m`],
    ["two different sizes", `${bounded("/tmp")},size=1m`],
    ["no noexec", bounded("/tmp").replace("noexec,", "")],
    ["no nosuid", bounded("/tmp").replace("nosuid,", "")],
    ["no nodev", bounded("/tmp").replace("nodev,", "")],
    ["exec re-enabled", `${bounded("/tmp")},exec`],
    ["suid re-enabled", `${bounded("/tmp")},suid`],
    ["dev re-enabled", `${bounded("/tmp")},dev`],
  ];
  for (const [name, options] of broken) {
    const inspect = conforming();
    const host = inspect.HostConfig as Record<string, unknown>;
    host.Tmpfs = { ...(host.Tmpfs as Record<string, unknown>), "/tmp": options };
    assert.deepEqual(verifyInspect(BINDING, inspect), ["tmpfs"], name);
  }
  const mistyped = conforming();
  const host = mistyped.HostConfig as Record<string, unknown>;
  host.Tmpfs = { ...(host.Tmpfs as Record<string, unknown>), "/run": ["noexec", "nosuid", "nodev", "size=16m"] };
  assert.deepEqual(verifyInspect(BINDING, mistyped), ["tmpfs"]);
  const unbounded = conforming();
  const hostConfig = unbounded.HostConfig as Record<string, unknown>;
  hostConfig.Tmpfs = { ...(hostConfig.Tmpfs as Record<string, unknown>), [SUPERVISOR_CA]: SUPERVISOR_CA_TMPFS_OPTIONS.join(",") };
  assert.deepEqual(verifyInspect(BINDING, unbounded), ["tmpfs"]);
});

void test("tmpfs: an engine's rewritten size and extra harmless options still conform (F9)", () => {
  const inspect = conforming();
  const host = inspect.HostConfig as Record<string, unknown>;
  host.Tmpfs = {
    "/tmp": "rw,noexec,nosuid,nodev,size=262144k,relatime",
    "/run": "noexec,nosuid,nodev,size=16384k",
    [SUPERVISOR_CA]: `${SUPERVISOR_CA_TMPFS_OPTIONS.join(",")},size=4096k`,
  };
  assert.deepEqual(verifyInspect(BINDING, inspect), []);
});

// One rlimit of an OCI config.
const rlimit = (type: string, limit: number): Record<string, unknown> => ({ type, hard: limit, soft: limit });

void test("ulimits: every profile rlimit must appear exactly once with soft and hard equal to the limit, and other types are tolerated (F9)", () => {
  const nofile = rlimit("RLIMIT_NOFILE", 4096);
  const core = rlimit("RLIMIT_CORE", 0);
  const cases: readonly (readonly [string, unknown])[] = [
    ["no core limit", [nofile]],
    ["no nofile limit", [core]],
    ["a repeated limit", [nofile, core, nofile]],
    ["a repeated limit with another value", [nofile, core, rlimit("RLIMIT_NOFILE", 1024)]],
    ["a raised nofile", [rlimit("RLIMIT_NOFILE", 1048576), core]],
    ["a soft limit below the hard limit", [{ type: "RLIMIT_NOFILE", hard: 4096, soft: 1024 }, core]],
    ["a hard limit above the soft limit", [{ type: "RLIMIT_NOFILE", hard: 8192, soft: 4096 }, core]],
    ["numbers as strings", [{ type: "RLIMIT_NOFILE", hard: "4096", soft: "4096" }, core]],
    ["a nonzero core limit", [nofile, rlimit("RLIMIT_CORE", 1)]],
    ["an entry that is not an object", [nofile, core, "RLIMIT_AS"]],
    ["an entry without a type", [nofile, core, { hard: 1, soft: 1 }]],
    ["not a list", { RLIMIT_NOFILE: 4096 }],
    ["null", null],
  ];
  for (const [name, rlimits] of cases) {
    const inspect = conforming();
    (inspect[OCI_RUNTIME_FIELD] as Record<string, unknown>).rlimits = rlimits;
    assert.deepEqual(verifyInspect(BINDING, inspect), ["ulimits"], name);
  }
  const tolerated: readonly (readonly [string, unknown])[] = [
    ["reordered limits", [core, nofile]],
    ["an engine default RLIMIT_NPROC", [nofile, core, rlimit("RLIMIT_NPROC", HARDENING_PROFILE.pidsLimit)]],
    ["another extra limit", [nofile, rlimit("RLIMIT_AS", 1024), core]],
  ];
  for (const [name, rlimits] of tolerated) {
    const inspect = conforming();
    (inspect[OCI_RUNTIME_FIELD] as Record<string, unknown>).rlimits = rlimits;
    assert.deepEqual(verifyInspect(BINDING, inspect), [], name);
  }
});

void test("sysctls: every profile sysctl must carry its exact value, including the low-port start of 0, and extra keys are tolerated (F10)", () => {
  const expected = { ...HARDENING_PROFILE.sysctls };
  const without = (name: string): Record<string, string> => {
    const copy: Record<string, string> = { ...expected };
    Reflect.deleteProperty(copy, name);
    return copy;
  };
  const cases: readonly (readonly [string, unknown])[] = [
    ["no low-port start", without("net.ipv4.ip_unprivileged_port_start")],
    ["a low-port start of 1024", { ...expected, "net.ipv4.ip_unprivileged_port_start": "1024" }],
    ["no IPv6 sysctl", without("net.ipv6.conf.all.disable_ipv6")],
    ["IPv6 enabled", { ...expected, "net.ipv6.conf.all.disable_ipv6": "0" }],
    ["a numeric value", { ...expected, "net.ipv4.ip_unprivileged_port_start": 0 }],
    ["an empty set", {}],
    ["a list", Object.entries(expected)],
    ["null", null],
  ];
  for (const [name, sysctl] of cases) {
    const inspect = conforming();
    (inspect[OCI_RUNTIME_FIELD] as Record<string, unknown>).sysctl = sysctl;
    assert.deepEqual(verifyInspect(BINDING, inspect), ["sysctls"], name);
  }
  const tolerated: readonly (readonly [string, unknown])[] = [
    ["an engine default ping group range", { ...expected, "net.ipv4.ping_group_range": "0 0" }],
    ["another extra sysctl", { ...expected, "net.ipv4.ip_forward": "1" }],
  ];
  for (const [name, sysctl] of tolerated) {
    const inspect = conforming();
    (inspect[OCI_RUNTIME_FIELD] as Record<string, unknown>).sysctl = sysctl;
    assert.deepEqual(verifyInspect(BINDING, inspect), [], name);
  }
});

void test("masked-paths and readonly-paths: every required Podman default must be present, extra entries are allowed (F5)", () => {
  assert.ok(HARDENING_PROFILE.maskedPaths.length > 0 && HARDENING_PROFILE.readonlyPaths.length > 0);
  for (const missing of HARDENING_PROFILE.maskedPaths) {
    const inspect = conforming();
    const evidence = inspect[OCI_RUNTIME_FIELD] as Record<string, unknown>;
    evidence.maskedPaths = (evidence.maskedPaths as readonly string[]).filter((path) => path !== missing);
    assert.deepEqual(verifyInspect(BINDING, inspect), ["masked-paths"], missing);
  }
  for (const missing of HARDENING_PROFILE.readonlyPaths) {
    const inspect = conforming();
    const evidence = inspect[OCI_RUNTIME_FIELD] as Record<string, unknown>;
    evidence.readonlyPaths = (evidence.readonlyPaths as readonly string[]).filter((path) => path !== missing);
    assert.deepEqual(verifyInspect(BINDING, inspect), ["readonly-paths"], missing);
  }
  for (const bad of [null, "/proc/kcore", { "/proc/kcore": true }]) {
    const inspect = conforming();
    Object.assign(inspect[OCI_RUNTIME_FIELD] as Record<string, unknown>, { maskedPaths: bad, readonlyPaths: bad });
    assert.deepEqual(verifyInspect(BINDING, inspect), ["masked-paths", "readonly-paths"], JSON.stringify(bad));
  }
});

void test("live-seccomp and live-no-new-privs: the init process must run a seccomp filter (mode 2) with no_new_privs set (F5)", () => {
  const cases: readonly (readonly [string, Readonly<Record<string, string>>, readonly HardeningProperty[]])[] = [
    ["no seccomp", { Seccomp: "0" }, ["live-seccomp"]],
    ["strict seccomp", { Seccomp: "1" }, ["live-seccomp"]],
    ["no no_new_privs", { NoNewPrivs: "0" }, ["live-no-new-privs"]],
    ["neither", { Seccomp: "0", NoNewPrivs: "0" }, ["live-seccomp", "live-no-new-privs"]],
    ["a filter count but no mode", { Seccomp: "0", Seccomp_filters: "3" }, ["live-seccomp"]],
  ];
  for (const [name, overrides, failed] of cases) {
    const attached = attachRuntimeEvidence(rawConforming(), ociReaderOf(RUNTIME_OCI_CONFIG_TEXT), () => procStatusOf(overrides));
    assert.deepEqual(verifyInspect(BINDING, attached), failed, name);
  }
});

void test("live-seccomp and live-no-new-privs: a status that cannot be read, or has no such line, fails both and the capability proof (F5)", () => {
  const unreadable = attachRuntimeEvidence(rawConforming(), ociReaderOf(RUNTIME_OCI_CONFIG_TEXT), () => {
    throw new Error("ENOENT");
  });
  assert.deepEqual(verifyInspect(BINDING, unreadable), ["live-seccomp", "live-no-new-privs"]);
  assert.deepEqual(liveCapabilityFailures(unreadable), ["cap-drop"]);
  const bare = attachRuntimeEvidence(rawConforming(), ociReaderOf(RUNTIME_OCI_CONFIG_TEXT), () => "Name:\tinit");
  assert.deepEqual(verifyInspect(BINDING, bare), ["live-seccomp", "live-no-new-privs"]);
  const noPid = attachRuntimeEvidence({ ...rawConforming(), State: { Pid: 0 } }, ociReaderOf(RUNTIME_OCI_CONFIG_TEXT), () => CONFORMING_PROC_STATUS);
  assert.deepEqual(verifyInspect(BINDING, noPid), ["live-seccomp", "live-no-new-privs"]);
});

void test("attachRuntimeEvidence: the config is read once, from the validated path, and gives the verdict and the projection (F5)", () => {
  const paths: string[] = [];
  const reader = (path: string): string => {
    paths.push(path);
    return RUNTIME_OCI_CONFIG_TEXT;
  };
  const attached = attachRuntimeEvidence(rawConforming(), reader, () => CONFORMING_PROC_STATUS);
  assert.deepEqual(paths, [OCI_CONFIG_PATH]);
  assert.equal(attached[SECCOMP_EVIDENCE_FIELD], true);
  assert.deepEqual(Object.keys(attached[OCI_RUNTIME_FIELD] as object).sort(), ["maskedPaths", "readonlyPaths", "rlimits", "sysctl"]);
  const off = attachRuntimeEvidence({ ...rawConforming(), OCIConfigPath: "/attacker/config.json" }, reader, () => CONFORMING_PROC_STATUS);
  assert.deepEqual(paths, [OCI_CONFIG_PATH], "a path outside the container's static directory is never read");
  assert.equal(Object.hasOwn(off, OCI_RUNTIME_FIELD), false);
});

void test("attachRuntimeEvidence: a config that cannot be read, is oversize, or is not a JSON object attaches no projection (F5)", () => {
  const texts: readonly (() => string)[] = [
    () => {
      throw new Error("EACCES");
    },
    () => `${RUNTIME_OCI_CONFIG_TEXT}${" ".repeat(MAX_OCI_CONFIG_BYTES)}`,
    () => "not json",
    () => "null",
    () => "[]",
    () => '"text"',
  ];
  for (const [index, text] of texts.entries()) {
    const attached = attachRuntimeEvidence(rawConforming(), text, () => CONFORMING_PROC_STATUS);
    assert.equal(Object.hasOwn(attached, OCI_RUNTIME_FIELD), false, String(index));
    const failed = verifyInspect(BINDING, attached);
    for (const property of ["ulimits", "sysctls", "masked-paths", "readonly-paths", "seccomp-keyring"] as const) {
      assert.ok(failed.includes(property), `${String(index)}: ${property}`);
    }
  }
});

void test("attachRuntimeEvidence: an inbound projection or kernel status is dropped, so only the host read decides (F5)", () => {
  const forged = {
    ...rawConforming(),
    [SECCOMP_EVIDENCE_FIELD]: true,
    [OCI_RUNTIME_FIELD]: { rlimits: [], sysctl: {}, maskedPaths: [], readonlyPaths: [] },
    [KERNEL_STATUS_FIELD]: { Seccomp: "2", NoNewPrivs: "1" },
  };
  const unread = attachRuntimeEvidence(
    forged,
    () => {
      throw new Error("EACCES");
    },
    () => {
      throw new Error("EACCES");
    },
  );
  for (const field of [SECCOMP_EVIDENCE_FIELD, OCI_RUNTIME_FIELD, KERNEL_STATUS_FIELD]) {
    assert.equal(Object.hasOwn(unread, field), false, field);
  }
  assert.deepEqual(verifyInspect(BINDING, unread), EVIDENCE_PROPERTIES);
  const replaced = attachRuntimeEvidence(forged, ociReaderOf(RUNTIME_OCI_CONFIG_TEXT), () => CONFORMING_PROC_STATUS);
  assert.deepEqual(verifyInspect(BINDING, replaced), []);
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

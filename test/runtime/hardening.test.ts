import { test } from "node:test";
import assert from "node:assert/strict";
import {
  HARDENING_PROFILE,
  HARDENING_PROPERTIES,
  type HardeningBinding,
  type HardeningProperty,
  verifyInspect,
} from "../../src/runtime/hardening.js";
import { SANDBOX_WORKSPACE_PATH } from "../../src/runtime/openshell.js";

const DIGEST_HEX = "a".repeat(64);
const DIGEST = `sha256:${DIGEST_HEX}`;
const WORKSPACE = "/realm/workspace";
const STATE = "/realm/state";

const BINDING: HardeningBinding = {
  image: `registry.example.com/realm/session@${DIGEST}`,
  rootless: true,
  workspaceRoot: WORKSPACE,
  stateDir: STATE,
};

// A libpod inspect object that conforms to every D-51 property. Each call returns a fresh object,
// so a test can change one field without affecting the others.
function conforming(): Record<string, unknown> {
  return {
    ImageDigest: DIGEST,
    HostConfig: {
      Privileged: false,
      CapDrop: ["ALL"],
      CapAdd: [],
      SecurityOpt: ["no-new-privileges"],
      ReadonlyRootfs: true,
      Tmpfs: { "/tmp": "rw", "/run": "rw" },
      PidsLimit: 512,
      Memory: 1024 * 1024 * 1024,
      NanoCpus: 2_000_000_000,
      NetworkMode: "none",
    },
    Mounts: [
      bind(WORKSPACE, "/workspace", true),
      bind(STATE, "/realm-state", false),
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
  { property: "cap-drop", path: ["HostConfig", "CapDrop"], wrong: ["NET_RAW"] },
  { property: "cap-add", path: ["HostConfig", "CapAdd"], wrong: ["NET_ADMIN"] },
  { property: "no-new-privileges", path: ["HostConfig", "SecurityOpt"], wrong: [] },
  { property: "read-only-root", path: ["HostConfig", "ReadonlyRootfs"], wrong: false },
  { property: "tmpfs", path: ["HostConfig", "Tmpfs"], wrong: { "/tmp": "rw" } },
  { property: "pids-limit", path: ["HostConfig", "PidsLimit"], wrong: 1024 },
  { property: "memory-limit", path: ["HostConfig", "Memory"], wrong: 2 * 1024 * 1024 * 1024 },
  { property: "cpu-limit", path: ["HostConfig", "NanoCpus"], wrong: 4_000_000_000 },
  { property: "network-mode", path: ["HostConfig", "NetworkMode"], wrong: "bridge" },
  { property: "image-digest", path: ["ImageDigest"], wrong: `sha256:${"b".repeat(64)}` },
];

void test("the frozen profile carries the D-51 values and verifies no capability beyond the ALL drop (RT-01)", () => {
  assert.equal(Object.isFrozen(HARDENING_PROFILE), true);
  assert.equal(Object.isFrozen(HARDENING_PROFILE.capDrop), true);
  assert.equal(Object.isFrozen(HARDENING_PROFILE.tmpfs), true);
  assert.deepEqual([...HARDENING_PROFILE.capDrop], ["ALL"]);
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
    ],
  );
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
  ];
  assert.deepEqual(verifyInspect(BINDING, inspect), ["mounts"]);
});

void test("a read-write state directory mount fails the mounts property, because the state directory is read-only (RT-01, D-51)", () => {
  const inspect = conforming();
  inspect.Mounts = [bind(WORKSPACE, "/workspace", true), bind(STATE, "/realm-state", true)];
  assert.deepEqual(verifyInspect(BINDING, inspect), ["mounts"]);
});

void test("a state directory mount at the wrong destination fails the mounts property (RT-01, D-51)", () => {
  const inspect = conforming();
  inspect.Mounts = [bind(WORKSPACE, "/workspace", true), bind(STATE, "/elsewhere", false)];
  assert.deepEqual(verifyInspect(BINDING, inspect), ["mounts"]);
});

void test("a workspace mount at the wrong destination fails the mounts property (RT-01, D-51)", () => {
  const inspect = conforming();
  inspect.Mounts = [bind(WORKSPACE, "/elsewhere", true), bind(STATE, "/realm-state", false)];
  assert.deepEqual(verifyInspect(BINDING, inspect), ["mounts"]);
});

void test("a read-only workspace mount fails the mounts property, because the policy grants /workspace read-write (RT-01)", () => {
  const inspect = conforming();
  inspect.Mounts = [bind(WORKSPACE, "/workspace", false), bind(STATE, "/realm-state", false)];
  assert.deepEqual(verifyInspect(BINDING, inspect), ["mounts"]);
});

void test("a mount without a read-write flag fails the mounts property closed (RT-01)", () => {
  const inspect = conforming();
  const state = bind(STATE, "/realm-state", false);
  Reflect.deleteProperty(state, "RW");
  inspect.Mounts = [bind(WORKSPACE, "/workspace", true), state];
  assert.deepEqual(verifyInspect(BINDING, inspect), ["mounts"]);
});

void test("the workspace destination in the profile is the in-sandbox workspace path of the OpenShell policy (RT-01)", () => {
  assert.equal(HARDENING_PROFILE.workspaceDestination, SANDBOX_WORKSPACE_PATH);
});

void test("an extra mount fails the mounts property even when both expected paths are present (RT-01)", () => {
  const inspect = conforming();
  inspect.Mounts = [
    bind(WORKSPACE, "/workspace", true),
    bind(STATE, "/realm-state", false),
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

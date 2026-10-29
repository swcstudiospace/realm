import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RealmError, type ErrorCode } from "../../src/core/errors.js";
import { LibpodClient, validateContainerSpec, type ContainerSpec } from "../../src/runtime/libpod-client.js";
import { SECCOMP_PROFILE_FILE_NAME } from "../../src/runtime/driver/seccomp-profile.js";

// The API version the fake reports on /_ping. Every create and start route is pinned to it.
const PINNED_VERSION = "5.7.1";
const CREATED_ID = "realm-sess-1-0a1b2c";
const PING = "/_ping";

interface Seen {
  readonly method: string;
  readonly target: string;
  readonly contentType: string | undefined;
  readonly body: string;
}

interface FakeOptions {
  // The status and body the create route answers with. The defaults are Podman's 201 and the new id.
  readonly createStatus?: number;
  readonly createBody?: string;
  // When set, the create route refuses a tmpfs option whose key Podman 5.7.1's create route does not accept, as the real route does.
  readonly podmanTmpfsRule?: boolean;
}

// A minimal in-process libpod stand-in on a Unix socket. It answers /_ping, the versioned create route, and the
// versioned start route of the created container, and it records every request it receives.
async function startFake(t: TestContext, options: FakeOptions = {}): Promise<{ readonly socketPath: string; readonly seen: Seen[] }> {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "realm-libpod-create-")));
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  const socketPath = join(dir, "podman.sock");
  const seen: Seen[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      seen.push(record(req, body));
      answer(req, res, options, body);
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => {
      server.off("error", reject);
      resolve();
    });
  });
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
  });
  return { socketPath, seen };
}

function record(req: IncomingMessage, body: string): Seen {
  return {
    method: req.method ?? "",
    target: req.url ?? "",
    contentType: req.headers["content-type"],
    body,
  };
}

function answer(req: IncomingMessage, res: ServerResponse, options: FakeOptions, body: string): void {
  const path = (req.url ?? "").split("?")[0];
  if (path === PING) {
    res.writeHead(200, { "libpod-api-version": PINNED_VERSION });
    res.end();
    return;
  }
  if (req.method === "POST" && path === `/v${PINNED_VERSION}/libpod/containers/create`) {
    const refused = options.podmanTmpfsRule === true ? unacceptedTmpfsOption(body) : undefined;
    if (refused !== undefined) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ cause: "", message: `unknown mount option ${refused} invalid mount option`, response: 500 }));
      return;
    }
    res.writeHead(options.createStatus ?? 201, { "content-type": "application/json" });
    res.end(options.createBody ?? JSON.stringify({ Id: CREATED_ID, Warnings: [] }));
    return;
  }
  if (req.method === "POST" && path === `/v${PINNED_VERSION}/libpod/containers/${CREATED_ID}/start`) {
    res.writeHead(204);
    res.end();
    return;
  }
  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ cause: "page not found", message: "page not found", response: 404 }));
}

// The tmpfs option keys the fake route accepts, observed on Podman 5.7.1. This is the fake's allowlist, not a live check against Podman.
const PODMAN_TMPFS_OPTION_KEYS: readonly string[] = ["size", "mode", "rw", "ro", "noexec", "exec", "nosuid", "suid", "nodev", "dev"];

// The first tmpfs option key of a create body that the route does not accept, or undefined when every key is accepted.
function unacceptedTmpfsOption(body: string): string | undefined {
  const parsed = JSON.parse(body) as { readonly mounts?: readonly { readonly type?: string; readonly options?: readonly string[] }[] };
  for (const mount of parsed.mounts ?? []) {
    if (mount.type !== "tmpfs") {
      continue;
    }
    for (const option of mount.options ?? []) {
      const key = option.split("=")[0] ?? option;
      if (!PODMAN_TMPFS_OPTION_KEYS.includes(key)) {
        return key;
      }
    }
  }
  return undefined;
}

// The requests the client sent for the call itself, without the /_ping that precedes the first versioned call.
function callsOf(seen: readonly Seen[]): readonly Seen[] {
  return seen.filter((request) => request.target !== PING);
}

async function assertRefused(work: Promise<unknown>, code: ErrorCode, label: string): Promise<void> {
  await assert.rejects(
    work,
    (error: unknown) => error instanceof RealmError && error.code === code,
    `${label} must be refused with ${code}`,
  );
}

const WORKSPACE_DIR = "/srv/realm-test/workspace/sess-1";
const STATE_DIR = "/srv/realm-test/state/sess-1";
const CHANNEL_DIR = "/srv/realm-test/secrets/sess-1/channel";
const SPEC: ContainerSpec = {
  sandboxName: "realm-sess-1",
  image: `localhost/realm-agentos@sha256:${"a".repeat(64)}`,
  workspaceDir: WORKSPACE_DIR,
  stateDir: STATE_DIR,
  channelDir: CHANNEL_DIR,
};

const SECCOMP_PROFILE_PATH = `/srv/realm-test/seccomp/${SECCOMP_PROFILE_FILE_NAME}`;

// A client that names the profile file in every create, as the driver's client does.
function clientOn(socketPath: string): LibpodClient {
  return new LibpodClient(socketPath, { seccompProfilePath: SECCOMP_PROFILE_PATH });
}

// The create body the spec must produce, field for field (plan T1, as amended). Any extra or missing field fails.
const EXPECTED_BODY = {
  name: "realm-sess-1",
  image: SPEC.image,
  entrypoint: ["/usr/local/lib/realm/openshell-sandbox", "--bootstrap", "/run/openshell/channel/bootstrap.json"],
  user: "1001:1001",
  userns: { nsmode: "keep-id", value: "uid=1001,gid=1001" },
  labels: {
    "openshell.managed": "true",
    "openshell.ai/sandbox-name": "realm-sess-1",
    "openshell.ai/isolation-role": "sandbox",
  },
  privileged: false,
  cap_drop: ["ALL"],
  cap_add: [],
  no_new_privileges: true,
  seccomp_profile_path: SECCOMP_PROFILE_PATH,
  read_only_filesystem: true,
  resource_limits: {
    pids: { limit: 512 },
    memory: { limit: 1073741824, swap: 1073741824 },
    cpu: { quota: 200000, period: 100000 },
  },
  r_limits: [
    { type: "NOFILE", hard: 4096, soft: 4096 },
    { type: "CORE", hard: 0, soft: 0 },
  ],
  netns: { nsmode: "none" },
  sysctl: {
    "net.ipv4.ip_unprivileged_port_start": "0",
    "net.ipv6.conf.all.disable_ipv6": "1",
    "net.ipv6.conf.default.disable_ipv6": "1",
  },
  use_image_resolve_conf: true,
  tty: false,
  mounts: [
    { type: "tmpfs", destination: "/tmp", options: ["noexec", "nosuid", "nodev", "size=256m"] },
    { type: "tmpfs", destination: "/run", options: ["noexec", "nosuid", "nodev", "size=16m"] },
    {
      type: "tmpfs",
      destination: "/run/openshell-supervisor-ca",
      options: ["noexec", "nosuid", "nodev", "mode=1703", "size=4m"],
    },
    { type: "bind", source: WORKSPACE_DIR, destination: "/workspace", options: ["rw", "noexec", "nosuid", "nodev"] },
    { type: "bind", source: STATE_DIR, destination: "/realm-state", options: ["ro", "noexec", "nosuid", "nodev"] },
    {
      type: "bind",
      source: CHANNEL_DIR,
      destination: "/run/openshell/channel",
      options: ["rw", "noexec", "nosuid", "nodev"],
    },
  ],
};

void test("PRD-CTR-01: createContainer posts the spec's body to the pinned 5.7.1 create route and returns the id", async (t) => {
  const { socketPath, seen } = await startFake(t);
  const id = await clientOn(socketPath).createContainer(SPEC);
  assert.equal(id, CREATED_ID);
  const sent = callsOf(seen);
  assert.equal(sent.length, 1, "one create request, after the version probe");
  const [create] = sent;
  assert.ok(create !== undefined);
  assert.equal(create.method, "POST");
  assert.equal(create.target, "/v5.7.1/libpod/containers/create", "no query string, version pinned to 5.7.1");
  assert.equal(create.contentType, "application/json");
  assert.deepEqual(JSON.parse(create.body) as unknown, EXPECTED_BODY);
});

void test("phase 9.6: the create body adds seccomp_profile_path and changes no other field", async (t) => {
  const { socketPath, seen } = await startFake(t);
  await clientOn(socketPath).createContainer(SPEC);
  const [create] = callsOf(seen);
  assert.ok(create !== undefined);
  const posted = JSON.parse(create.body) as Record<string, unknown>;
  assert.equal(posted.seccomp_profile_path, SECCOMP_PROFILE_PATH);
  const before: Record<string, unknown> = { ...EXPECTED_BODY };
  delete before.seccomp_profile_path;
  delete posted.seccomp_profile_path;
  assert.deepEqual(posted, before, "every other field is the body the create sent before the profile existed");
});

void test("sandbox resolver: the create body uses the image's resolv.conf and sets no dns_server", async (t) => {
  const { socketPath, seen } = await startFake(t);
  await clientOn(socketPath).createContainer(SPEC);
  const [create] = callsOf(seen);
  assert.ok(create !== undefined);
  const posted = JSON.parse(create.body) as Record<string, unknown>;
  assert.equal(posted.use_image_resolve_conf, true);
  // Podman refuses dns_server with network none, so the body must never carry it.
  assert.equal("dns_server" in posted, false);
});

void test("phase 9.6: a client built without a profile path refuses every create, with no request", async (t) => {
  const { socketPath, seen } = await startFake(t);
  await assertRefused(new LibpodClient(socketPath).createContainer(SPEC), "SCHEMA_INVALID", "a client without a profile path");
  assert.equal(seen.length, 0, "no request reaches the socket, not even the version probe");
});

void test("phase 9.6: a client refuses at construction a profile path that is relative or names another file", () => {
  for (const path of [
    SECCOMP_PROFILE_FILE_NAME,
    `seccomp/${SECCOMP_PROFILE_FILE_NAME}`,
    "/srv/realm-test/seccomp/default.json",
    `/srv/realm-test/seccomp/${SECCOMP_PROFILE_FILE_NAME}.bak`,
    `/srv/realm-test/seccomp/${SECCOMP_PROFILE_FILE_NAME}\0`,
    "",
  ]) {
    assert.throws(
      () => new LibpodClient("/srv/realm-test/podman.sock", { seccompProfilePath: path }),
      (error: unknown) => error instanceof RealmError && error.code === "SCHEMA_INVALID",
      JSON.stringify(path),
    );
  }
});

void test("PRD-CTR-01: the create body carries exactly the runtime sysctls (low port, IPv6 off) and no other sysctl", async (t) => {
  const { socketPath, seen } = await startFake(t);
  await clientOn(socketPath).createContainer(SPEC);
  const [create] = callsOf(seen);
  assert.ok(create !== undefined);
  const parsed = JSON.parse(create.body) as { readonly sysctl?: Readonly<Record<string, string>> };
  assert.deepEqual(parsed.sysctl, {
    "net.ipv4.ip_unprivileged_port_start": "0",
    "net.ipv6.conf.all.disable_ipv6": "1",
    "net.ipv6.conf.default.disable_ipv6": "1",
  });
  assert.deepEqual(Object.keys(parsed.sysctl ?? {}), [
    "net.ipv4.ip_unprivileged_port_start",
    "net.ipv6.conf.all.disable_ipv6",
    "net.ipv6.conf.default.disable_ipv6",
  ]);
});

void test("PRD-CTR-01: the CA tmpfs options pass the create route's tmpfs rule, so the create is not refused for uid or gid", async (t) => {
  const { socketPath } = await startFake(t, { podmanTmpfsRule: true });
  const id = await clientOn(socketPath).createContainer(SPEC);
  assert.equal(id, CREATED_ID);
});

void test("F9: every tmpfs of the create body is noexec, nosuid, nodev and bounded, and the swap equals the memory limit", async (t) => {
  const { socketPath, seen } = await startFake(t, { podmanTmpfsRule: true });
  await clientOn(socketPath).createContainer(SPEC);
  const [create] = callsOf(seen);
  assert.ok(create !== undefined);
  const body = JSON.parse(create.body) as {
    readonly mounts: readonly { readonly type: string; readonly destination: string; readonly options: readonly string[] }[];
    readonly resource_limits: { readonly memory: { readonly limit: number; readonly swap: number } };
  };
  const tmpfs = body.mounts.filter((mount) => mount.type === "tmpfs");
  assert.deepEqual(
    tmpfs.map((mount) => mount.destination),
    ["/tmp", "/run", "/run/openshell-supervisor-ca"],
  );
  for (const mount of tmpfs) {
    for (const option of ["noexec", "nosuid", "nodev"]) {
      assert.ok(mount.options.includes(option), `${mount.destination} carries ${option}`);
    }
    assert.equal(mount.options.filter((option) => option.startsWith("size=")).length, 1, `${mount.destination} has one size cap`);
  }
  assert.equal(body.resource_limits.memory.swap, body.resource_limits.memory.limit, "no swap: the swap limit equals the memory limit");
});

void test("F9: the rlimits of the create body are exactly nofile 4096 and core 0 under the REST names, without the RLIMIT_ prefix the engine adds itself, soft equal to hard, with no nproc limit", async (t) => {
  const { socketPath, seen } = await startFake(t);
  await clientOn(socketPath).createContainer(SPEC);
  const [create] = callsOf(seen);
  assert.ok(create !== undefined);
  const body = JSON.parse(create.body) as {
    readonly r_limits: readonly { readonly type: string; readonly hard: number; readonly soft: number }[];
  };
  assert.deepEqual(
    body.r_limits.map((limit) => [limit.type, limit.soft, limit.hard]),
    [["NOFILE", 4096, 4096], ["CORE", 0, 0]],
  );
});

void test("PRD-CTR-01: the create body carries no socket-bearing mount and binds the state directory read-only", async (t) => {
  const { socketPath, seen } = await startFake(t);
  await clientOn(socketPath).createContainer(SPEC);
  const [create] = callsOf(seen);
  assert.ok(create !== undefined);
  const body = JSON.parse(create.body) as {
    readonly mounts: readonly { readonly type: string; readonly source?: string; readonly options: readonly string[] }[];
  };
  for (const mount of body.mounts) {
    if (mount.type === "bind") {
      assert.doesNotMatch(mount.source ?? "", /\.sock(\/|$)/, "no engine socket is mounted");
    }
  }
  const state = body.mounts.find((mount) => mount.source === STATE_DIR);
  assert.ok(state?.options.includes("ro"), "the state directory bind is read-only");
});

void test("PRD-CTR-01: startContainer posts to the pinned 5.7.1 start route of the container id", async (t) => {
  const { socketPath, seen } = await startFake(t);
  await new LibpodClient(socketPath).startContainer(CREATED_ID);
  assert.deepEqual(
    callsOf(seen).map((request) => [request.method, request.target]),
    [["POST", `/v5.7.1/libpod/containers/${CREATED_ID}/start`]],
  );
});

void test("PRD-CTR-01: createContainer refuses a create reply that is not 201 or carries no well-formed id", async (t) => {
  const wrongStatus = await startFake(t, { createStatus: 500 });
  await assertRefused(clientOn(wrongStatus.socketPath).createContainer(SPEC), "SCHEMA_INVALID", "a 500 create");

  const noId = await startFake(t, { createBody: JSON.stringify({ Warnings: [] }) });
  await assertRefused(clientOn(noId.socketPath).createContainer(SPEC), "SCHEMA_INVALID", "a reply without Id");

  const badId = await startFake(t, { createBody: JSON.stringify({ Id: "../escape" }) });
  await assertRefused(clientOn(badId.socketPath).createContainer(SPEC), "SCHEMA_INVALID", "a malformed Id");
});

void test("PRD-CTR-01: createContainer refuses a spec outside the typed form before any socket request", async (t) => {
  const { socketPath, seen } = await startFake(t);
  const client = clientOn(socketPath);
  const refused: readonly (readonly [string, ContainerSpec])[] = [
    ["a workspace named like the podman socket", { ...SPEC, workspaceDir: "/srv/realm-test/podman.sock" }],
    ["a state directory under a docker socket name", { ...SPEC, stateDir: "/srv/realm-test/docker.sock/state" }],
    ["a relative workspace path", { ...SPEC, workspaceDir: "workspace" }],
    ["a channel directory under a podman socket name", { ...SPEC, channelDir: "/srv/realm-test/podman.sock/channel" }],
    ["a relative channel path", { ...SPEC, channelDir: "channel" }],
    ["an image without a digest", { ...SPEC, image: "localhost/realm-agentos:latest" }],
    ["a sandbox name outside the container id pattern", { ...SPEC, sandboxName: "realm sess" }],
  ];
  for (const [label, spec] of refused) {
    await assertRefused(client.createContainer(spec), "SCHEMA_INVALID", label);
  }
  assert.equal(seen.length, 0, "no refused spec reaches the socket");
});

void test("PRD-CTR-01: validateContainerSpec refuses a bad image digest, and createContainer sends no request for it", async (t) => {
  const { socketPath, seen } = await startFake(t);
  const badDigest = { ...SPEC, image: "localhost/realm-agentos@sha256:XYZ" };
  assert.doesNotThrow(() => {
    validateContainerSpec(SPEC);
  });
  assert.throws(
    () => {
      validateContainerSpec(badDigest);
    },
    (error: unknown) => error instanceof RealmError && error.code === "SCHEMA_INVALID",
  );
  await assertRefused(clientOn(socketPath).createContainer(badDigest), "SCHEMA_INVALID", "a bad digest");
  assert.equal(seen.length, 0, "no request reaches the socket, not even the version probe");
});

void test("PRD-CTR-01: a create answered 409 rejects with SANDBOX_NAME_IN_USE and sends no follow-up request", async (t) => {
  const { socketPath, seen } = await startFake(t, {
    createStatus: 409,
    createBody: JSON.stringify({ cause: "name is already in use", message: "name is already in use", response: 409 }),
  });
  await assertRefused(clientOn(socketPath).createContainer(SPEC), "SANDBOX_NAME_IN_USE", "a name in use");
  const sent = callsOf(seen);
  assert.equal(sent.length, 1, "the only request after the version probe is the create itself");
  assert.equal(sent[0]?.target, "/v5.7.1/libpod/containers/create");
});

void test("PRD-CTR-01: createContainer refuses a container-safe sandbox name without the realm prefix, with no request", async (t) => {
  const { socketPath, seen } = await startFake(t);
  await assertRefused(
    clientOn(socketPath).createContainer({ ...SPEC, sandboxName: "agent-sess-1" }),
    "SCHEMA_INVALID",
    "a name without the realm prefix",
  );
  assert.equal(seen.length, 0, "no request reaches the socket, not even the version probe");
});

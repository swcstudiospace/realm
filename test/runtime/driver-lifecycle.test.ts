import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createServer as createSocketServer } from "node:net";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RealmError, type ErrorCode } from "../../src/core/errors.js";
import { DriverLifecycle, HardeningRefusal } from "../../src/runtime/driver/lifecycle.js";
import { attachKernelCaps } from "../../src/runtime/kernel-caps.js";
import {
  HARDENING_PROFILE,
  RUNTIME_ARGV,
  RUNTIME_BINARY,
  SUPERVISOR_CA_TMPFS_OPTIONS,
  verifyInspect,
  type HardeningBinding,
  type HardeningProperty,
} from "../../src/runtime/hardening.js";
import { LibpodClient, type ContainerSpec } from "../../src/runtime/libpod-client.js";
import {
  LIBPOD_API_VERSION_HEADER,
  matchLibpodRoute,
  PING_PATH,
  type LibpodRouteName,
} from "../../src/runtime/libpod-routes.js";
import {
  OPENSHELL_ISOLATION_ROLE_LABEL_KEY,
  OPENSHELL_MANAGED_LABEL_KEY,
  OPENSHELL_MANAGED_LABEL_VALUE,
  OPENSHELL_SANDBOX_NAME_LABEL_KEY,
} from "../../src/runtime/openshell.js";

// The API version the fake reports on /_ping. Every lifecycle route is pinned to it through the client.
const PINNED_VERSION = "5.7.1";
// The id the fake gives every container it creates. Each test builds its own fake, so one id is enough.
const CREATED_ID = "0123456789ab";
// The id of a foreign container the fake stores while it answers a create with a malformed body.
const FOREIGN_RACE_ID = "f0f0f0f0f0f1";
const GOOD_PID = 4242;
const SANDBOX = "realm-sess-1";
const IMAGE_DIGEST = `sha256:${"a".repeat(64)}`;
const SPEC_IMAGE = `localhost/realm-agentos@${IMAGE_DIGEST}`;
const NOT_FOUND_TEXT = JSON.stringify({ cause: "no such container", message: "no such container", response: 404 });

const ZERO_MASK = "0000000000000000";

// The text of a /proc/<pid>/status file with the five capability sets, each overridden set replacing its zero mask.
function statusWith(overrides: Readonly<Record<string, string>>): string {
  const masks: Record<string, string> = {
    CapInh: ZERO_MASK,
    CapPrm: ZERO_MASK,
    CapEff: ZERO_MASK,
    CapBnd: ZERO_MASK,
    CapAmb: ZERO_MASK,
    ...overrides,
  };
  return Object.entries(masks)
    .map(([name, mask]) => `${name}:\t${mask}`)
    .join("\n");
}

const ZERO_STATUS = statusWith({});

// Everything the fake answers and records. The fake models the create, start, inspect, stop, remove and list
// routes that the lifecycle uses. Its inspect is the good fixture, with one optional mutation applied to it. The
// capability sets are not in the inspect: the lifecycle reads them through the injected status reader, so each row
// of the property table drives cap-drop through that reader.
interface SeedContainer {
  readonly id: string;
  readonly name: string;
  readonly labels: Readonly<Record<string, string>>;
  readonly running: boolean;
}

interface FakeOptions {
  readonly inspect: Readonly<Record<string, unknown>>;
  readonly mutate?: ((body: Record<string, unknown>) => void) | undefined;
  readonly rootless?: boolean | undefined;
  // The init pid the engine reports once a container runs. Zero models a container with no init process.
  readonly pid?: number | undefined;
  // The create route stores the container, then never answers, so the client times out.
  readonly hangCreate?: boolean | undefined;
  // The start route answers 500, so the start fails after the container exists.
  readonly failStart?: boolean | undefined;
  // The remove route answers 500, so a cleanup fails and the container survives.
  readonly failRemove?: boolean | undefined;
  // The create route stores the container and answers 201 with a body that carries no id.
  readonly malformedCreate?: boolean | undefined;
  // The create route answers 409 without storing a container, so another owner of the name is not visible to the lifecycle.
  readonly conflictCreate?: boolean | undefined;
  // The create route stores a foreign container of the name that carries no labels, then answers 201 with a body that
  // carries no id. This is a same-name container that appears during a create.
  readonly foreignOnCreate?: boolean | undefined;
  // Podman 5.7.1 reports the bare container name. This switch makes the fake report the name with a leading slash.
  readonly reportSlashName?: boolean | undefined;
  readonly seed?: readonly SeedContainer[] | undefined;
}

interface Seen {
  readonly method: string;
  readonly route: LibpodRouteName | null;
  readonly containerId: string | null;
  readonly target: string;
  readonly body: string;
}

interface Stored {
  readonly id: string;
  readonly name: string;
  readonly labels: Record<string, string>;
  running: boolean;
}

interface Fake {
  readonly socketPath: string;
  readonly seen: Seen[];
  readonly store: Map<string, Stored>;
}

interface Reply {
  readonly status: number;
  readonly text: string;
}

function json(status: number, value: unknown): Reply {
  return { status, text: JSON.stringify(value) };
}

const NOT_FOUND: Reply = { status: 404, text: NOT_FOUND_TEXT };

function labelTerms(raw: string | null): readonly string[] {
  if (raw === null) {
    return [];
  }
  const parsed = JSON.parse(raw) as { readonly label?: readonly string[] };
  return parsed.label ?? [];
}

function labelMatches(labels: Readonly<Record<string, string>>, term: string): boolean {
  const split = term.indexOf("=");
  return labels[term.slice(0, split)] === term.slice(split + 1);
}

function tempDir(t: TestContext, prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

async function startFake(t: TestContext, options: FakeOptions): Promise<Fake> {
  const socketPath = join(tempDir(t, "realm-lifecycle-fake-"), "podman.sock");
  const seen: Seen[] = [];
  const store = new Map<string, Stored>();
  for (const seed of options.seed ?? []) {
    store.set(seed.id, { id: seed.id, name: seed.name, labels: { ...seed.labels }, running: seed.running });
  }

  const find = (key: string | null): Stored | undefined => {
    if (key === null) {
      return undefined;
    }
    return store.get(key) ?? [...store.values()].find((container) => container.name === key);
  };

  const answer = (route: LibpodRouteName, key: string | null, query: URLSearchParams, body: string): Reply => {
    switch (route) {
      case "info":
        return json(200, {
          host: { security: { rootless: options.rootless ?? true } },
          version: { Version: PINNED_VERSION },
        });
      case "listContainers": {
        const terms = labelTerms(query.get("filters"));
        const visible = [...store.values()].filter((container) =>
          terms.every((term) => labelMatches(container.labels, term)),
        );
        return json(
          200,
          visible.map((container) => ({
            Id: container.id,
            Names: [`/${container.name}`],
            Labels: container.labels,
            State: container.running ? "running" : "exited",
          })),
        );
      }
      case "createContainer": {
        const spec = JSON.parse(body) as { readonly name: string; readonly labels: Record<string, string> };
        if (options.conflictCreate === true) {
          return json(409, { message: "name in use" });
        }
        if ([...store.values()].some((container) => container.name === spec.name)) {
          return json(409, { message: "name in use" });
        }
        if (options.foreignOnCreate === true) {
          store.set(FOREIGN_RACE_ID, { id: FOREIGN_RACE_ID, name: spec.name, labels: {}, running: true });
          return json(201, { Warnings: [] });
        }
        store.set(CREATED_ID, { id: CREATED_ID, name: spec.name, labels: { ...spec.labels }, running: false });
        if (options.malformedCreate === true) {
          return json(201, { Warnings: [] });
        }
        return json(201, { Id: CREATED_ID, Warnings: [] });
      }
      case "startContainer": {
        const container = find(key);
        if (container === undefined) {
          return NOT_FOUND;
        }
        if (options.failStart === true) {
          return json(500, { message: "start refused" });
        }
        container.running = true;
        return { status: 204, text: "" };
      }
      case "inspectContainer": {
        const container = find(key);
        if (container === undefined) {
          return NOT_FOUND;
        }
        const inspect = structuredClone(options.inspect) as Record<string, unknown>;
        inspect.Id = container.id;
        inspect.Name = options.reportSlashName === true ? `/${container.name}` : container.name;
        inspect.State = {
          Status: container.running ? "running" : "exited",
          Running: container.running,
          Pid: container.running ? (options.pid ?? GOOD_PID) : 0,
        };
        inspect.Config = { Labels: container.labels, Tty: false };
        options.mutate?.(inspect);
        return json(200, inspect);
      }
      case "stopContainer": {
        const container = find(key);
        if (container === undefined) {
          return NOT_FOUND;
        }
        if (!container.running) {
          return { status: 304, text: "" };
        }
        container.running = false;
        return { status: 204, text: "" };
      }
      case "removeContainer": {
        const container = find(key);
        if (container === undefined) {
          return NOT_FOUND;
        }
        if (options.failRemove === true) {
          return json(500, { message: "remove refused" });
        }
        if (container.running && query.get("force") !== "true") {
          return json(409, { message: "container is running" });
        }
        store.delete(container.id);
        return { status: 200, text: "" };
      }
      default:
        return json(500, { message: "route not served by this fake" });
    }
  };

  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });
    req.on("end", () => {
      const url = new URL(req.url ?? "/", "http://fake.invalid");
      if (url.pathname === PING_PATH) {
        res.writeHead(200, { [LIBPOD_API_VERSION_HEADER]: PINNED_VERSION });
        res.end();
        return;
      }
      const body = Buffer.concat(chunks).toString("utf8");
      const matched = matchLibpodRoute(req.method ?? "", url.pathname);
      seen.push({
        method: req.method ?? "",
        route: matched?.name ?? null,
        containerId: matched?.containerId ?? null,
        target: req.url ?? "",
        body,
      });
      if (matched?.name === "createContainer" && options.hangCreate === true) {
        // The engine made the container, and the reply never arrives.
        answer(matched.name, matched.containerId, url.searchParams, body);
        return;
      }
      const reply =
        matched === undefined
          ? json(404, { message: "page not found" })
          : answer(matched.name, matched.containerId, url.searchParams, body);
      res.writeHead(reply.status, { "content-type": "application/json" });
      res.end(reply.text);
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
  return { socketPath, seen, store };
}

// A libpod inspect object of a conforming container, built from HARDENING_PROFILE and the bound paths. Each
// call returns a fresh object, so a test can change one field without affecting another test. The workspace mount
// carries noexec, nosuid and nodev (C1), which is what a conforming engine reports for it. A container with a channel also
// carries the channel mount and the CA tmpfs that the channel binding expects.
function goodInspect(stateDir: string, workspaceDir: string, channelDir?: string): Record<string, unknown> {
  const channelTmpfs = channelDir === undefined ? [] : [HARDENING_PROFILE.supervisorCaDestination];
  const channelMounts =
    channelDir === undefined
      ? []
      : [
          {
            Type: "bind",
            Source: channelDir,
            Destination: HARDENING_PROFILE.channelDestination,
            RW: true,
            Options: ["rbind", "rw", "noexec", "nosuid", "nodev"],
          },
        ];
  return {
    ImageDigest: IMAGE_DIGEST,
    ...(channelDir === undefined ? {} : { Path: RUNTIME_BINARY, Args: RUNTIME_ARGV.slice(1) }),
    HostConfig: {
      Privileged: HARDENING_PROFILE.privileged,
      CapAdd: [...HARDENING_PROFILE.capAdd],
      SecurityOpt: [...HARDENING_PROFILE.securityOpt],
      ReadonlyRootfs: HARDENING_PROFILE.readonlyRootfs,
      Tmpfs: Object.fromEntries(
        [...HARDENING_PROFILE.tmpfs, ...channelTmpfs].map((path): [string, string] => [
          path,
          path === HARDENING_PROFILE.supervisorCaDestination ? SUPERVISOR_CA_TMPFS_OPTIONS.join(",") : "nosuid,nodev",
        ]),
      ),
      PidsLimit: HARDENING_PROFILE.pidsLimit,
      Memory: HARDENING_PROFILE.memoryBytes,
      NanoCpus: HARDENING_PROFILE.nanoCpus,
      NetworkMode: HARDENING_PROFILE.networkMode,
    },
    Mounts: [
      {
        Type: "bind",
        Source: workspaceDir,
        Destination: HARDENING_PROFILE.workspaceDestination,
        RW: true,
        Options: ["rbind", "noexec", "nosuid", "nodev"],
      },
      {
        Type: "bind",
        Source: stateDir,
        Destination: HARDENING_PROFILE.stateDestination,
        RW: false,
        Options: ["rbind", "ro", "noexec", "nosuid", "nodev"],
      },
      ...channelMounts,
    ],
  };
}

function hostConfig(body: Record<string, unknown>): Record<string, unknown> {
  return body.HostConfig as Record<string, unknown>;
}

function configOf(body: Record<string, unknown>): Record<string, unknown> {
  return body.Config as Record<string, unknown>;
}

function mountsOf(body: Record<string, unknown>): Record<string, unknown>[] {
  return body.Mounts as Record<string, unknown>[];
}

// Replaces the options of every workspace mount in an inspect object.
function setWorkspaceOptions(body: Record<string, unknown>, options: readonly string[]): void {
  for (const mount of mountsOf(body)) {
    if (mount.Destination === HARDENING_PROFILE.workspaceDestination) {
      mount.Options = [...options];
    }
  }
}

const SOCKET_MOUNT_SOURCE = "/srv/realm-test/engine/podman.sock";
const SIMULATED_WORKSPACE = "/srv/realm-test/workspace/sess-1";
const SIMULATED_STATE_DIR = "/srv/realm-test/state/sess-1";

interface Arrangement {
  readonly mutate?: ((body: Record<string, unknown>) => void) | undefined;
  readonly rootless?: boolean | undefined;
  readonly pid?: number | undefined;
  readonly hangCreate?: boolean | undefined;
  readonly failStart?: boolean | undefined;
  readonly failRemove?: boolean | undefined;
  readonly malformedCreate?: boolean | undefined;
  readonly conflictCreate?: boolean | undefined;
  readonly foreignOnCreate?: boolean | undefined;
  readonly reportSlashName?: boolean | undefined;
  readonly seed?: readonly SeedContainer[] | undefined;
  readonly procStatus?: string | undefined;
  readonly requestTimeoutMs?: number | undefined;
  readonly sweep?: boolean | undefined;
  // The state root and the workspace. A test that needs a particular layout gives them; otherwise both are fresh.
  readonly stateRoot?: string | undefined;
  readonly workspaceDir?: string | undefined;
  readonly secretRoot?: string | undefined;
  readonly noChannel?: boolean | undefined;
  readonly removeDirectory?: ((dir: string) => void) | undefined;
}

interface Harness {
  readonly fake: Fake;
  readonly lifecycle: DriverLifecycle;
  readonly stateRoot: string;
  readonly stateDir: string;
  readonly workspaceDir: string;
  readonly secretRoot: string;
  readonly spec: ContainerSpec;
}

// Builds a fake, a lifecycle over a client on it, a sandbox state directory under the state root, and a workspace
// directory. The sweep runs first unless the arrangement turns it off, since create and delete refuse before the sweep.
async function harness(t: TestContext, arrangement: Arrangement = {}): Promise<Harness> {
  const stateRoot = arrangement.stateRoot ?? tempDir(t, "realm-lifecycle-state-");
  const stateDir = join(stateRoot, SANDBOX);
  mkdirSync(stateDir, { recursive: true });
  const workspaceDir = arrangement.workspaceDir ?? tempDir(t, "realm-lifecycle-workspace-");
  mkdirSync(workspaceDir, { recursive: true });
  const secretRoot = arrangement.secretRoot ?? tempDir(t, "realm-lifecycle-secret-");
  const channelDir = join(secretRoot, SANDBOX, "channel");
  const fake = await startFake(t, {
    inspect: goodInspect(stateDir, workspaceDir, channelDir),
    mutate: arrangement.mutate,
    rootless: arrangement.rootless,
    pid: arrangement.pid,
    hangCreate: arrangement.hangCreate,
    failStart: arrangement.failStart,
    failRemove: arrangement.failRemove,
    malformedCreate: arrangement.malformedCreate,
    conflictCreate: arrangement.conflictCreate,
    foreignOnCreate: arrangement.foreignOnCreate,
    reportSlashName: arrangement.reportSlashName,
    seed: arrangement.seed,
  });
  const libpod = new LibpodClient(
    fake.socketPath,
    arrangement.requestTimeoutMs === undefined ? {} : { requestTimeoutMs: arrangement.requestTimeoutMs },
  );
  const lifecycle = new DriverLifecycle({
    libpod,
    sandboxStateRoot: stateRoot,
    secretRoot,
    readProcStatus: () => arrangement.procStatus ?? ZERO_STATUS,
    removeDirectory: arrangement.removeDirectory,
  });
  if (arrangement.sweep !== false) {
    await lifecycle.startupSweep();
  }
  if (arrangement.noChannel !== true) {
    mkdirSync(channelDir, { recursive: true });
  }
  return {
    fake,
    lifecycle,
    stateRoot,
    stateDir,
    workspaceDir,
    secretRoot,
    spec: { sandboxName: SANDBOX, image: SPEC_IMAGE, workspaceDir, stateDir, channelDir },
  };
}

function hasCode(code: ErrorCode): (error: unknown) => boolean {
  return (error) => error instanceof RealmError && error.code === code;
}

function forcedRemoval(seen: readonly Seen[], containerId: string): boolean {
  return seen.some(
    (request) =>
      request.route === "removeContainer" && request.containerId === containerId && request.target.endsWith("force=true"),
  );
}

// Listens on a Unix socket at path for the rest of the test, so the path is a live socket file.
async function listenOnSocket(t: TestContext, path: string): Promise<void> {
  const socket = createSocketServer();
  await new Promise<void>((resolve, reject) => {
    socket.once("error", reject);
    socket.listen(path, () => {
      socket.off("error", reject);
      resolve();
    });
  });
  t.after(
    () =>
      new Promise<void>((resolve) => {
        socket.close(() => {
          resolve();
        });
      }),
  );
}

interface PropertyCase {
  readonly property: HardeningProperty;
  // The property create reports first. It differs from property only where report order puts another check
  // ahead of it: socket-path is reported after mounts, and a socket mount always fails mounts too.
  readonly reported?: HardeningProperty | undefined;
  readonly mutate?: ((body: Record<string, unknown>) => void) | undefined;
  readonly rootless?: boolean | undefined;
  readonly procStatus?: string | undefined;
}

// One row per hardening property (D-51). Each row mutates exactly one field of the good inspect, except the two
// that the libpod inspect does not carry: rootless comes from the engine's info, and cap-drop from the injected
// reader of the init process's /proc status.
const PROPERTY_CASES: readonly PropertyCase[] = [
  { property: "privileged", mutate: (body) => { hostConfig(body).Privileged = true; } },
  { property: "rootless", rootless: false },
  { property: "cap-drop", procStatus: statusWith({ CapBnd: "0000000000000008" }) },
  { property: "cap-add", mutate: (body) => { hostConfig(body).CapAdd = ["NET_ADMIN"]; } },
  { property: "no-new-privileges", mutate: (body) => { hostConfig(body).SecurityOpt = []; } },
  { property: "read-only-root", mutate: (body) => { hostConfig(body).ReadonlyRootfs = false; } },
  {
    property: "tmpfs",
    mutate: (body) => {
      hostConfig(body).Tmpfs = { "/tmp": "nosuid,nodev", [HARDENING_PROFILE.supervisorCaDestination]: SUPERVISOR_CA_TMPFS_OPTIONS.join(",") };
    },
  },
  { property: "pids-limit", mutate: (body) => { hostConfig(body).PidsLimit = 1024; } },
  { property: "memory-limit", mutate: (body) => { hostConfig(body).Memory = 2 * 1024 ** 3; } },
  { property: "cpu-limit", mutate: (body) => { hostConfig(body).NanoCpus = 4_000_000_000; } },
  { property: "network-mode", mutate: (body) => { hostConfig(body).NetworkMode = "bridge"; } },
  { property: "image-digest", mutate: (body) => { body.ImageDigest = `sha256:${"b".repeat(64)}`; } },
  {
    property: "mounts",
    mutate: (body) => {
      for (const mount of mountsOf(body)) {
        mount.RW = true;
      }
    },
  },
  { property: "init-process", mutate: (body) => { body.Args = ["--bootstrap", "/tmp/elsewhere.json"]; } },
  {
    property: "socket-path",
    reported: "mounts",
    mutate: (body) => {
      mountsOf(body).push({ Type: "bind", Source: SOCKET_MOUNT_SOURCE, Destination: "/run/engine.sock", RW: false });
    },
  },
];

for (const row of PROPERTY_CASES) {
  const reported = row.reported ?? row.property;
  void test(`PRD-CTR-01: a ${row.property} mismatch fails create, reports ${reported}, and force-removes the container`, async (t) => {
    const h = await harness(t, {
      mutate: row.mutate,
      rootless: row.rootless,
      procStatus: row.procStatus,
    });
    await assert.rejects(
      h.lifecycle.create(h.spec),
      (error: unknown) =>
        error instanceof HardeningRefusal &&
        error.property === reported &&
        error.code === "OPENSHELL_START_FAILED" &&
        error.message.includes(`in report order: ${reported}`) &&
        error.message.includes(row.property),
    );
    assert.equal(forcedRemoval(h.fake.seen, CREATED_ID), true);
    assert.equal(h.fake.store.size, 0);
  });
}

void test("PRD-CTR-01: a socket mount fails mounts and socket-path, and create names mounts first", () => {
  const body = { ...goodInspect(SIMULATED_STATE_DIR, SIMULATED_WORKSPACE), State: { Pid: GOOD_PID } };
  mountsOf(body).push({ Type: "bind", Source: SOCKET_MOUNT_SOURCE, Destination: "/run/engine.sock", RW: false });
  const binding: HardeningBinding = {
    image: SPEC_IMAGE,
    rootless: true,
    workspaceRoot: SIMULATED_WORKSPACE,
    stateDir: SIMULATED_STATE_DIR,
  };
  const attached = attachKernelCaps(body, () => ZERO_STATUS);
  assert.deepEqual(verifyInspect(binding, attached), ["mounts", "socket-path"]);
});

void test("PRD-CTR-01: a conforming container is returned by id, kept, and posted with tty false (C6)", async (t) => {
  const h = await harness(t);
  assert.equal(await h.lifecycle.create(h.spec), CREATED_ID);
  assert.equal(h.fake.store.has(CREATED_ID), true);
  assert.equal(h.fake.seen.some((request) => request.route === "removeContainer"), false);
  const creates = h.fake.seen.filter((request) => request.route === "createContainer");
  assert.equal(creates.length, 1);
  const posted = JSON.parse(creates[0]?.body ?? "{}") as { readonly tty?: unknown };
  assert.equal(posted.tty, false);
});

void test("PRD-CTR-02: PID 1 that is not the sandbox runtime with its exact argv is refused, and the container is force-removed (phase 9.5, wave 3)", async (t) => {
  const h = await harness(t, {
    mutate: (body) => {
      body.Path = "/opt/realm/bin/realm-helper";
      body.Args = ["idle"];
    },
  });
  await assert.rejects(
    h.lifecycle.create(h.spec),
    (error: unknown) => error instanceof HardeningRefusal && error.property === "init-process",
  );
  assert.equal(forcedRemoval(h.fake.seen, CREATED_ID), true);
  assert.equal(h.fake.store.size, 0);
});

void test("PRD-CTR-02: a CA tmpfs without its options is refused before start, and the container never starts (phase 9.5, F)", async (t) => {
  const h = await harness(t, {
    mutate: (body) => {
      hostConfig(body).Tmpfs = {
        "/tmp": "nosuid,nodev",
        "/run": "nosuid,nodev",
        [HARDENING_PROFILE.supervisorCaDestination]: "nosuid,nodev",
      };
    },
  });
  await assert.rejects(
    h.lifecycle.create(h.spec),
    (error: unknown) => error instanceof HardeningRefusal && error.property === "ca-tmpfs-options",
  );
  assert.equal(h.fake.seen.some((request) => request.route === "startContainer"), false, "the container is never started");
  assert.equal(forcedRemoval(h.fake.seen, CREATED_ID), true);
});

void test("PRD-CTR-02: a channel mount without noexec is refused before start, and the container never starts (phase 9.5, F)", async (t) => {
  const h = await harness(t, {
    mutate: (body) => {
      for (const mount of mountsOf(body)) {
        if (mount.Destination === HARDENING_PROFILE.channelDestination) {
          mount.Options = ["rbind", "rw", "nosuid", "nodev"];
        }
      }
    },
  });
  await assert.rejects(
    h.lifecycle.create(h.spec),
    (error: unknown) => error instanceof HardeningRefusal && error.property === "channel-mount-options",
  );
  assert.equal(h.fake.seen.some((request) => request.route === "startContainer"), false, "the container is never started");
});

void test("PRD-CTR-01 (C1): a workspace mount without noexec is refused after create, and the container is removed", async (t) => {
  const h = await harness(t, {
    mutate: (body) => {
      setWorkspaceOptions(body, ["rbind", "nosuid", "nodev"]);
    },
  });
  await assert.rejects(
    h.lifecycle.create(h.spec),
    (error: unknown) => error instanceof HardeningRefusal && error.property === "mounts-options",
  );
  assert.equal(forcedRemoval(h.fake.seen, CREATED_ID), true);
  assert.equal(h.fake.store.size, 0);
});

void test("PRD-CTR-01 (C6): a container with a tty is refused after create, and the container is removed", async (t) => {
  const h = await harness(t, {
    mutate: (body) => {
      configOf(body).Tty = true;
    },
  });
  await assert.rejects(h.lifecycle.create(h.spec), (error: unknown) => error instanceof HardeningRefusal && error.property === "tty");
  assert.equal(forcedRemoval(h.fake.seen, CREATED_ID), true);
  assert.equal(h.fake.store.size, 0);
});

void test("PRD-CTR-01: a State.Pid of 0 after start fails cap-drop and force-removes the container", async (t) => {
  const h = await harness(t, { pid: 0 });
  await assert.rejects(
    h.lifecycle.create(h.spec),
    (error: unknown) => error instanceof HardeningRefusal && error.property === "cap-drop",
  );
  assert.equal(forcedRemoval(h.fake.seen, CREATED_ID), true);
  assert.equal(h.fake.store.size, 0);
});

void test("PRD-CTR-01: a start that fails force-removes the container by id and rejects with OPENSHELL_START_FAILED", async (t) => {
  const h = await harness(t, { failStart: true });
  await assert.rejects(h.lifecycle.create(h.spec), hasCode("OPENSHELL_START_FAILED"));
  assert.equal(forcedRemoval(h.fake.seen, CREATED_ID), true);
  assert.equal(h.fake.store.size, 0);
});

void test("PRD-CTR-01: a failed cleanup after a hardening refusal still names the hardening property, and reports the survivor", async (t) => {
  const h = await harness(t, { mutate: (body) => { hostConfig(body).Privileged = true; }, failRemove: true });
  await assert.rejects(
    h.lifecycle.create(h.spec),
    (error: unknown) =>
      error instanceof HardeningRefusal &&
      error.property === "privileged" &&
      error.code === "OPENSHELL_START_FAILED" &&
      error.message.includes("in report order: privileged") &&
      error.message.includes(`container ${CREATED_ID} survived`) &&
      error.message.includes("cleanup code SCHEMA_INVALID"),
  );
  assert.equal(h.fake.store.has(CREATED_ID), true);
});

void test("PRD-CTR-01: a create whose reply never arrives removes its own container by name, so a retry does not meet the name", async (t) => {
  const h = await harness(t, { hangCreate: true, requestTimeoutMs: 100 });
  await assert.rejects(h.lifecycle.create(h.spec), hasCode("PODMAN_MACHINE_DOWN"));
  assert.equal(forcedRemoval(h.fake.seen, SANDBOX), true);
  assert.equal(h.fake.store.size, 0);
});

void test("PRD-CTR-01: a 201 whose body carries no id removes its own container by name, because the labels show it is ours", async (t) => {
  const h = await harness(t, { malformedCreate: true });
  await assert.rejects(h.lifecycle.create(h.spec), hasCode("SCHEMA_INVALID"));
  assert.equal(h.fake.store.size, 0);
  assert.equal(forcedRemoval(h.fake.seen, SANDBOX), true);
});

void test("PRD-CTR-01 (L1): a same-name foreign container without the sandbox labels survives a failed create", async (t) => {
  const h = await harness(t, { foreignOnCreate: true });
  await assert.rejects(h.lifecycle.create(h.spec), hasCode("SCHEMA_INVALID"));
  assert.equal(h.fake.store.has(FOREIGN_RACE_ID), true);
  assert.equal(h.fake.seen.some((request) => request.route === "removeContainer"), false);
});

void test("PRD-CTR-01 (name free): a live container of the sandbox name makes create refuse, and that container is not touched", async (t) => {
  const h = await harness(t);
  const liveId = "1e1e1e1e1e1e";
  h.fake.store.set(liveId, {
    id: liveId,
    name: SANDBOX,
    labels: { [OPENSHELL_MANAGED_LABEL_KEY]: OPENSHELL_MANAGED_LABEL_VALUE, [OPENSHELL_SANDBOX_NAME_LABEL_KEY]: SANDBOX },
    running: true,
  });
  await assert.rejects(h.lifecycle.create(h.spec), hasCode("SANDBOX_NAME_IN_USE"));
  assert.equal(h.fake.store.has(liveId), true);
  assert.equal(h.fake.seen.some((request) => request.route === "removeContainer"), false);
  assert.equal(h.fake.seen.some((request) => request.route === "createContainer"), false);
});

void test("PRD-CTR-01 (name free): a container of the sandbox name without the sandbox label makes create refuse, and it is not removed", async (t) => {
  const h = await harness(t);
  const foreignId = "2d2d2d2d2d2d";
  h.fake.store.set(foreignId, { id: foreignId, name: SANDBOX, labels: {}, running: true });
  await assert.rejects(h.lifecycle.create(h.spec), hasCode("SANDBOX_NAME_IN_USE"));
  assert.equal(h.fake.store.has(foreignId), true);
  assert.equal(h.fake.seen.some((request) => request.route === "removeContainer"), false);
  assert.equal(h.fake.seen.some((request) => request.route === "createContainer"), false);
});

void test("PRD-CTR-01: a 409 from the create route gives SANDBOX_NAME_IN_USE and removes nothing", async (t) => {
  const h = await harness(t, { conflictCreate: true });
  await assert.rejects(h.lifecycle.create(h.spec), hasCode("SANDBOX_NAME_IN_USE"));
  assert.equal(h.fake.seen.some((request) => request.route === "removeContainer"), false);
});

void test("PRD-CTR-01 (C5): a state directory holding a socket is refused before any libpod call", async (t) => {
  const h = await harness(t);
  const socketPath = join(h.stateDir, "agent.sock");
  await listenOnSocket(t, socketPath);
  assert.equal(lstatSync(socketPath).isSocket(), true);
  const before = h.fake.seen.length;
  await assert.rejects(h.lifecycle.create(h.spec), hasCode("SCHEMA_INVALID"));
  assert.equal(h.fake.seen.length, before);
});

void test("PRD-CTR-01 (workspace): a socket file under the workspace is refused before any libpod call", async (t) => {
  const h = await harness(t);
  await listenOnSocket(t, join(h.workspaceDir, "agent.sock"));
  const before = h.fake.seen.length;
  await assert.rejects(h.lifecycle.create(h.spec), hasCode("SCHEMA_INVALID"));
  assert.equal(h.fake.seen.length, before);
});

void test("PRD-CTR-01 (C5): a secret-named entry that group or world can access is refused, and the same entry at 0600 is admitted", async (t) => {
  const h = await harness(t);
  mkdirSync(join(h.stateDir, "secrets"), { mode: 0o700 });
  const secret = join(h.stateDir, "secrets", "token.json");
  writeFileSync(secret, "{}");
  chmodSync(secret, 0o644);
  const notes = join(h.stateDir, "notes.txt");
  writeFileSync(notes, "ok");
  chmodSync(notes, 0o644);
  await assert.rejects(h.lifecycle.create(h.spec), hasCode("SCHEMA_INVALID"));
  chmodSync(secret, 0o600);
  assert.equal(await h.lifecycle.create(h.spec), CREATED_ID);
});

void test("PRD-CTR-01 (L3): a group-readable id_ed25519 is refused as a secret-named entry", async (t) => {
  const h = await harness(t);
  const key = join(h.stateDir, "id_ed25519");
  writeFileSync(key, "key");
  chmodSync(key, 0o644);
  const before = h.fake.seen.length;
  await assert.rejects(h.lifecycle.create(h.spec), hasCode("SCHEMA_INVALID"));
  assert.equal(h.fake.seen.length, before);
});

void test("PRD-CTR-01 (spec first): a bad image digest is refused with zero requests", async (t) => {
  const h = await harness(t);
  const before = h.fake.seen.length;
  await assert.rejects(
    h.lifecycle.create({ ...h.spec, image: "localhost/realm-agentos:latest" }),
    hasCode("SCHEMA_INVALID"),
  );
  assert.equal(h.fake.seen.length, before);
});

void test("PRD-CTR-01 (C5 containment): a state directory outside the state root is refused before any libpod call", async (t) => {
  const h = await harness(t);
  const outside = tempDir(t, "realm-lifecycle-outside-");
  const before = h.fake.seen.length;
  await assert.rejects(h.lifecycle.create({ ...h.spec, stateDir: outside }), hasCode("SCHEMA_INVALID"));
  await assert.rejects(
    h.lifecycle.create({ ...h.spec, stateDir: join(h.stateRoot, "..", "escape") }),
    hasCode("SCHEMA_INVALID"),
  );
  assert.equal(h.fake.seen.length, before);
});

void test("PRD-CTR-01 (C5 containment): a state directory that is a symlink is refused before any libpod call", async (t) => {
  const h = await harness(t);
  const outside = tempDir(t, "realm-lifecycle-outside-");
  rmSync(h.stateDir, { recursive: true, force: true });
  symlinkSync(outside, h.stateDir);
  const before = h.fake.seen.length;
  await assert.rejects(h.lifecycle.create(h.spec), hasCode("SCHEMA_INVALID"));
  assert.equal(h.fake.seen.length, before);
});

void test("PRD-CTR-01 (C5 ancestors): a symlinked ancestor of the state root is refused before any libpod call", async (t) => {
  const base = tempDir(t, "realm-lifecycle-ancestor-");
  mkdirSync(join(base, "real"));
  symlinkSync(join(base, "real"), join(base, "link"));
  const h = await harness(t, { stateRoot: join(base, "link", "root") });
  const before = h.fake.seen.length;
  await assert.rejects(h.lifecycle.create(h.spec), hasCode("SCHEMA_INVALID"));
  assert.equal(h.fake.seen.length, before);
});

void test("PRD-CTR-01 (state dir identity): a sibling of the sandbox's own directory is refused before any libpod call", async (t) => {
  const h = await harness(t);
  const sibling = join(h.stateRoot, "realm-sess-2");
  mkdirSync(sibling);
  const before = h.fake.seen.length;
  await assert.rejects(h.lifecycle.create({ ...h.spec, stateDir: sibling }), hasCode("SCHEMA_INVALID"));
  assert.equal(h.fake.seen.length, before);
});

// The four ways the workspace can overlap the state directory and the state root, each refused before any request.
const OVERLAP_CASES: ReadonlyArray<{
  readonly name: string;
  readonly layout: (base: string) => { readonly stateRoot: string; readonly workspaceDir: string };
}> = [
  {
    name: "the workspace contains the state directory",
    layout: (base) => ({ stateRoot: join(base, "root"), workspaceDir: join(base, "root") }),
  },
  {
    name: "the state directory contains the workspace",
    layout: (base) => ({ stateRoot: join(base, "root"), workspaceDir: join(base, "root", SANDBOX, "ws") }),
  },
  {
    name: "the workspace is inside the state root",
    layout: (base) => ({ stateRoot: join(base, "root"), workspaceDir: join(base, "root", "ws") }),
  },
  {
    name: "the state root is inside the workspace",
    layout: (base) => ({ stateRoot: join(base, "root"), workspaceDir: base }),
  },
];

for (const row of OVERLAP_CASES) {
  void test(`PRD-CTR-01 (overlap): ${row.name}, and create refuses before any libpod call`, async (t) => {
    const base = tempDir(t, "realm-lifecycle-layout-");
    const h = await harness(t, row.layout(base));
    const before = h.fake.seen.length;
    await assert.rejects(h.lifecycle.create(h.spec), hasCode("SCHEMA_INVALID"));
    assert.equal(h.fake.seen.length, before);
  });
}

void test("PRD-CTR-02: delete force-removes the sandbox's containers and removes its state directory", async (t) => {
  const h = await harness(t);
  await h.lifecycle.create(h.spec);
  writeFileSync(join(h.stateDir, "state.json"), "{}");
  await h.lifecycle.delete(SANDBOX);
  assert.equal(h.fake.store.size, 0);
  assert.equal(h.fake.seen.some((request) => request.route === "stopContainer" && request.containerId === CREATED_ID), true);
  assert.equal(forcedRemoval(h.fake.seen, CREATED_ID), true);
  assert.equal(existsSync(h.stateDir), false);
});

void test("PRD-CTR-02: delete refuses a name outside the realm prefix or with a separator, before it touches libpod", async (t) => {
  const h = await harness(t);
  const before = h.fake.seen.length;
  await assert.rejects(h.lifecycle.delete("other-sandbox"), hasCode("SCHEMA_INVALID"));
  await assert.rejects(h.lifecycle.delete("realm-../escape"), hasCode("SCHEMA_INVALID"));
  assert.equal(h.fake.seen.length, before);
});

void test("PRD-CTR-02: delete refuses a sandbox directory that is a symlink and never removes what it points to", async (t) => {
  const h = await harness(t);
  const outside = tempDir(t, "realm-lifecycle-outside-");
  writeFileSync(join(outside, "keep.txt"), "keep");
  rmSync(h.stateDir, { recursive: true, force: true });
  symlinkSync(outside, h.stateDir);
  const before = h.fake.seen.length;
  await assert.rejects(h.lifecycle.delete(SANDBOX), hasCode("SCHEMA_INVALID"));
  assert.equal(h.fake.seen.length, before);
  assert.equal(readFileSync(join(outside, "keep.txt"), "utf8"), "keep");
  assert.equal(lstatSync(h.stateDir).isSymbolicLink(), true);
});

void test("PRD-CTR-02 (delete scope): a container with another name or without the managed label survives delete, and a container of this sandbox in another role is removed", async (t) => {
  const h = await harness(t);
  const sandboxNameLabel = { [OPENSHELL_SANDBOX_NAME_LABEL_KEY]: SANDBOX };
  const otherNameId = "3a3a3a3a3a3a";
  const unmanagedId = "4b4b4b4b4b4b";
  const supervisorId = "5c5c5c5c5c5c";
  h.fake.store.set(otherNameId, {
    id: otherNameId,
    name: "realm-sess-1-other",
    labels: { [OPENSHELL_MANAGED_LABEL_KEY]: OPENSHELL_MANAGED_LABEL_VALUE, ...sandboxNameLabel },
    running: true,
  });
  h.fake.store.set(unmanagedId, { id: unmanagedId, name: SANDBOX, labels: { ...sandboxNameLabel }, running: true });
  // The supervisor role of the same sandbox carries the managed and sandbox-name labels under the sandbox name.
  h.fake.store.set(supervisorId, {
    id: supervisorId,
    name: SANDBOX,
    labels: {
      [OPENSHELL_MANAGED_LABEL_KEY]: OPENSHELL_MANAGED_LABEL_VALUE,
      ...sandboxNameLabel,
      [OPENSHELL_ISOLATION_ROLE_LABEL_KEY]: "supervisor",
    },
    running: true,
  });
  await h.lifecycle.delete(SANDBOX);
  assert.equal(h.fake.store.has(otherNameId), true);
  assert.equal(h.fake.store.has(unmanagedId), true);
  assert.equal(h.fake.store.has(supervisorId), false);
  assert.equal(
    h.fake.seen.some(
      (request) =>
        request.route === "removeContainer" && (request.containerId === otherNameId || request.containerId === unmanagedId),
    ),
    false,
  );
  assert.equal(forcedRemoval(h.fake.seen, supervisorId), true);
});

void test("PRD-CTR-02 (L2): a failed removal of the state directory reports CLEANUP_FAILED and no path", async (t) => {
  const h = await harness(t, {
    removeDirectory: (dir) => {
      throw new Error(`EACCES: permission denied, rm '${dir}'`);
    },
  });
  await assert.rejects(
    h.lifecycle.delete(SANDBOX),
    (error: unknown) =>
      error instanceof RealmError &&
      error.code === "CLEANUP_FAILED" &&
      !error.message.includes(h.stateDir) &&
      !error.message.includes(h.stateRoot),
  );
});

// The sandbox's own container, seeded with the labels a create gives it, for the delete name tests below.
const OWN_CONTAINER_ID = "6d6d6d6d6d6d";
function ownContainer(): SeedContainer {
  return {
    id: OWN_CONTAINER_ID,
    name: SANDBOX,
    labels: { [OPENSHELL_MANAGED_LABEL_KEY]: OPENSHELL_MANAGED_LABEL_VALUE, [OPENSHELL_SANDBOX_NAME_LABEL_KEY]: SANDBOX },
    running: true,
  };
}

void test("PRD-CTR-02 (bare name): delete removes the sandbox's own container when Podman reports the bare name", async (t) => {
  const h = await harness(t, { seed: [ownContainer()] });
  await h.lifecycle.delete(SANDBOX);
  assert.equal(h.fake.store.has(OWN_CONTAINER_ID), false);
  assert.equal(forcedRemoval(h.fake.seen, OWN_CONTAINER_ID), true);
});

void test("PRD-CTR-02 (slash name): a name reported with a leading slash still matches, and delete removes the container", async (t) => {
  const h = await harness(t, { seed: [ownContainer()], reportSlashName: true });
  await h.lifecycle.delete(SANDBOX);
  assert.equal(h.fake.store.has(OWN_CONTAINER_ID), false);
  assert.equal(forcedRemoval(h.fake.seen, OWN_CONTAINER_ID), true);
});

const ORPHAN: SeedContainer = {
  id: "0f0f0f0f0f0f",
  name: "realm-orphan",
  labels: { [OPENSHELL_MANAGED_LABEL_KEY]: OPENSHELL_MANAGED_LABEL_VALUE, [OPENSHELL_SANDBOX_NAME_LABEL_KEY]: "realm-orphan" },
  running: true,
};
const FOREIGN: SeedContainer = {
  id: "e0e0e0e0e0e0",
  name: "other-sandbox",
  labels: { [OPENSHELL_MANAGED_LABEL_KEY]: OPENSHELL_MANAGED_LABEL_VALUE, [OPENSHELL_SANDBOX_NAME_LABEL_KEY]: "other-sandbox" },
  running: true,
};

void test("PRD-CTR-03: startupSweep removes realm-labelled orphans before it resolves and leaves foreign containers", async (t) => {
  const h = await harness(t, { seed: [ORPHAN, FOREIGN], sweep: false });
  assert.equal(h.fake.store.has(ORPHAN.id), true);
  const removed = await h.lifecycle.startupSweep();
  assert.equal(removed, 1);
  assert.equal(h.fake.store.has(ORPHAN.id), false);
  assert.equal(h.fake.store.has(FOREIGN.id), true);
});

void test("PRD-CTR-03: create and delete refuse with REALM_NOT_ACTIVE until startupSweep has resolved", async (t) => {
  const h = await harness(t, { sweep: false });
  await assert.rejects(h.lifecycle.create(h.spec), hasCode("REALM_NOT_ACTIVE"));
  await assert.rejects(h.lifecycle.delete(SANDBOX), hasCode("REALM_NOT_ACTIVE"));
  assert.equal(h.fake.seen.length, 0);
  await h.lifecycle.startupSweep();
  mkdirSync(h.spec.channelDir, { recursive: true });
  assert.equal(await h.lifecycle.create(h.spec), CREATED_ID);
});

void test("PRD-CTR-02 (secret): delete removes launch.json and active from the sandbox secret directory, then the empty directory", async (t) => {
  const h = await harness(t);
  const secretDir = join(h.secretRoot, SANDBOX);
  mkdirSync(secretDir, { recursive: true });
  writeFileSync(join(secretDir, "launch.json"), "{}");
  writeFileSync(join(secretDir, "active"), "");
  await h.lifecycle.delete(SANDBOX);
  assert.equal(existsSync(join(secretDir, "launch.json")), false);
  assert.equal(existsSync(join(secretDir, "active")), false);
  assert.equal(existsSync(secretDir), false);
  assert.equal(existsSync(h.secretRoot), true);
});

void test("PRD-CTR-02 (secret absent): delete succeeds when neither secret file exists, and when the secret root does not exist", async (t) => {
  const h = await harness(t);
  await h.lifecycle.delete(SANDBOX);
  assert.deepEqual(readdirSync(h.secretRoot), []);
  const missing = join(tempDir(t, "realm-lifecycle-absent-"), "not-created");
  const absent = await harness(t, { secretRoot: missing, noChannel: true });
  await absent.lifecycle.delete(SANDBOX);
  assert.equal(existsSync(missing), false);
});

void test("PRD-CTR-02 (secret link): a symbolic link named active makes delete refuse, and the link is neither followed nor removed", async (t) => {
  const h = await harness(t);
  const secretDir = join(h.secretRoot, SANDBOX);
  mkdirSync(secretDir, { recursive: true });
  const target = join(tempDir(t, "realm-lifecycle-target-"), "keep.txt");
  writeFileSync(target, "keep");
  symlinkSync(target, join(secretDir, "active"));
  const before = h.fake.seen.length;
  await assert.rejects(h.lifecycle.delete(SANDBOX), hasCode("SCHEMA_INVALID"));
  assert.equal(h.fake.seen.length, before);
  assert.equal(lstatSync(join(secretDir, "active")).isSymbolicLink(), true);
  assert.equal(readFileSync(target, "utf8"), "keep");
});

void test("PRD-CTR-02 (secret non-regular): a directory named active makes delete refuse before any container is removed, and the directory is kept", async (t) => {
  const h = await harness(t);
  const secretDir = join(h.secretRoot, SANDBOX);
  const activeDir = join(secretDir, "active");
  mkdirSync(activeDir, { recursive: true });
  const containerId = "6d6d6d6d6d6d";
  h.fake.store.set(containerId, {
    id: containerId,
    name: SANDBOX,
    labels: {
      [OPENSHELL_MANAGED_LABEL_KEY]: OPENSHELL_MANAGED_LABEL_VALUE,
      [OPENSHELL_SANDBOX_NAME_LABEL_KEY]: SANDBOX,
    },
    running: true,
  });
  const before = h.fake.seen.length;
  await assert.rejects(h.lifecycle.delete(SANDBOX), hasCode("SCHEMA_INVALID"));
  assert.equal(h.fake.seen.length, before);
  assert.equal(h.fake.store.has(containerId), true);
  assert.equal(lstatSync(activeDir).isDirectory(), true);
});

void test("PRD-CTR-02 (secret root): a secret root equal to, or inside, the state directory, or relative, is refused at construction", (t) => {
  const stateRoot = tempDir(t, "realm-lifecycle-state-");
  const libpod = new LibpodClient(join(stateRoot, "podman.sock"));
  const construct = (secretRoot: string) => () => new DriverLifecycle({ libpod, sandboxStateRoot: stateRoot, secretRoot });
  assert.throws(construct(stateRoot), hasCode("SCHEMA_INVALID"));
  assert.throws(construct(join(stateRoot, "secrets")), hasCode("SCHEMA_INVALID"));
  assert.throws(construct("relative/secrets"), hasCode("SCHEMA_INVALID"));
  // A sibling whose name starts with the state root's name is outside it, so it is admitted.
  assert.doesNotThrow(construct(`${stateRoot}-secrets`));
});

void test("PRD-CTR-02 (secret root): a secret root that is a symbolic link is refused at construction", (t) => {
  const stateRoot = tempDir(t, "realm-lifecycle-state-");
  const real = tempDir(t, "realm-lifecycle-real-");
  const link = join(tempDir(t, "realm-lifecycle-links-"), "secrets");
  symlinkSync(real, link);
  const libpod = new LibpodClient(join(stateRoot, "podman.sock"));
  assert.throws(
    () => new DriverLifecycle({ libpod, sandboxStateRoot: stateRoot, secretRoot: link }),
    hasCode("SCHEMA_INVALID"),
  );
});

void test("PRD-CTR-02 (secret name): a sandbox name with a separator or a dot segment is refused before any filesystem access", async (t) => {
  const h = await harness(t);
  const victim = join(h.secretRoot, "victim");
  mkdirSync(victim);
  writeFileSync(join(victim, "launch.json"), "{}");
  const before = h.fake.seen.length;
  await assert.rejects(h.lifecycle.delete(`${SANDBOX}/../victim`), hasCode("SCHEMA_INVALID"));
  await assert.rejects(h.lifecycle.delete(`${SANDBOX}/x`), hasCode("SCHEMA_INVALID"));
  assert.equal(h.fake.seen.length, before);
  assert.equal(readFileSync(join(victim, "launch.json"), "utf8"), "{}");
});

void test("PRD-CTR-02 (secret create): create writes no launch or active file under the secret root", async (t) => {
  const h = await harness(t);
  const before = readdirSync(h.secretRoot);
  assert.equal(await h.lifecycle.create(h.spec), CREATED_ID);
  assert.deepEqual(readdirSync(h.secretRoot), before);
});

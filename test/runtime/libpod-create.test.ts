import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RealmError, type ErrorCode } from "../../src/core/errors.js";
import { LibpodClient, validateContainerSpec, type ContainerSpec } from "../../src/runtime/libpod-client.js";

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
      seen.push(record(req, Buffer.concat(chunks).toString("utf8")));
      answer(req, res, options);
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

function answer(req: IncomingMessage, res: ServerResponse, options: FakeOptions): void {
  const path = (req.url ?? "").split("?")[0];
  if (path === PING) {
    res.writeHead(200, { "libpod-api-version": PINNED_VERSION });
    res.end();
    return;
  }
  if (req.method === "POST" && path === `/v${PINNED_VERSION}/libpod/containers/create`) {
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
const SPEC: ContainerSpec = {
  sandboxName: "realm-sess-1",
  image: `localhost/realm-agentos@sha256:${"a".repeat(64)}`,
  workspaceDir: WORKSPACE_DIR,
  stateDir: STATE_DIR,
};

// The create body the spec must produce, field for field (plan T1, as amended). Any extra or missing field fails.
const EXPECTED_BODY = {
  name: "realm-sess-1",
  image: SPEC.image,
  entrypoint: ["/opt/realm/bin/realm-helper", "idle"],
  labels: {
    "openshell.managed": "true",
    "openshell.ai/sandbox-name": "realm-sess-1",
    "openshell.ai/isolation-role": "sandbox",
  },
  privileged: false,
  cap_drop: ["ALL"],
  cap_add: [],
  no_new_privileges: true,
  read_only_filesystem: true,
  resource_limits: {
    pids: { limit: 512 },
    memory: { limit: 1073741824 },
    cpu: { quota: 200000, period: 100000 },
  },
  netns: { nsmode: "none" },
  tty: false,
  mounts: [
    { type: "tmpfs", destination: "/tmp", options: ["nosuid", "nodev"] },
    { type: "tmpfs", destination: "/run", options: ["nosuid", "nodev"] },
    { type: "bind", source: WORKSPACE_DIR, destination: "/workspace", options: ["noexec", "nosuid", "nodev"] },
    { type: "bind", source: STATE_DIR, destination: "/realm-state", options: ["ro", "noexec", "nosuid", "nodev"] },
  ],
};

void test("PRD-CTR-01: createContainer posts the spec's body to the pinned 5.7.1 create route and returns the id", async (t) => {
  const { socketPath, seen } = await startFake(t);
  const id = await new LibpodClient(socketPath).createContainer(SPEC);
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

void test("PRD-CTR-01: the create body carries no socket-bearing mount and binds the state directory read-only", async (t) => {
  const { socketPath, seen } = await startFake(t);
  await new LibpodClient(socketPath).createContainer(SPEC);
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
  await assertRefused(new LibpodClient(wrongStatus.socketPath).createContainer(SPEC), "SCHEMA_INVALID", "a 500 create");

  const noId = await startFake(t, { createBody: JSON.stringify({ Warnings: [] }) });
  await assertRefused(new LibpodClient(noId.socketPath).createContainer(SPEC), "SCHEMA_INVALID", "a reply without Id");

  const badId = await startFake(t, { createBody: JSON.stringify({ Id: "../escape" }) });
  await assertRefused(new LibpodClient(badId.socketPath).createContainer(SPEC), "SCHEMA_INVALID", "a malformed Id");
});

void test("PRD-CTR-01: createContainer refuses a spec outside the typed form before any socket request", async (t) => {
  const { socketPath, seen } = await startFake(t);
  const client = new LibpodClient(socketPath);
  const refused: readonly (readonly [string, ContainerSpec])[] = [
    ["a workspace named like the podman socket", { ...SPEC, workspaceDir: "/srv/realm-test/podman.sock" }],
    ["a state directory under a docker socket name", { ...SPEC, stateDir: "/srv/realm-test/docker.sock/state" }],
    ["a relative workspace path", { ...SPEC, workspaceDir: "workspace" }],
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
  await assertRefused(new LibpodClient(socketPath).createContainer(badDigest), "SCHEMA_INVALID", "a bad digest");
  assert.equal(seen.length, 0, "no request reaches the socket, not even the version probe");
});

void test("PRD-CTR-01: a create answered 409 rejects with SANDBOX_NAME_IN_USE and sends no follow-up request", async (t) => {
  const { socketPath, seen } = await startFake(t, {
    createStatus: 409,
    createBody: JSON.stringify({ cause: "name is already in use", message: "name is already in use", response: 409 }),
  });
  await assertRefused(new LibpodClient(socketPath).createContainer(SPEC), "SANDBOX_NAME_IN_USE", "a name in use");
  const sent = callsOf(seen);
  assert.equal(sent.length, 1, "the only request after the version probe is the create itself");
  assert.equal(sent[0]?.target, "/v5.7.1/libpod/containers/create");
});

// Drives the isolation backend over its Unix socket with a real gRPC client. The socket rules are the driver's: the parent
// directory is 0700, the socket is 0600, and a path that cannot be the backend's own socket is refused.

import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { existsSync, lstatSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  credentials,
  makeClientConstructor,
  Metadata,
  status,
  type Client,
  type ServiceDefinition,
  type ServiceError,
} from "@grpc/grpc-js";
import { RealmError } from "../../../src/core/errors.js";
import {
  ISOLATION_BACKEND_SERVICE_NAME,
  SANDBOX_PROTOCOL_SERVICE_NAME,
  loadIsolationServices,
  startIsolationBackend,
  type IsolationBackendOptions,
} from "../../../src/runtime/driver/isolation/backend.js";
import { BoundaryRegistry, type ProvisionedResource } from "../../../src/runtime/driver/isolation/boundary.js";
import type { SocketServer } from "../../../src/runtime/driver/server.js";
import { IMPLEMENTATION_VERSION, socketDirectory } from "../driver/fakes.js";
import { fakeResources, type FakeResources } from "./provisioned-resources.js";
import {
  GENERATION_ID,
  SANDBOX_ID,
  generateGatewayKey,
  nowSeconds,
  provisioningFor,
  sandboxClaims,
  signedToken,
  type GatewayKey,
} from "./supervisor-token.js";

const GATEWAY_KEY = generateGatewayKey();
// A supervisor on the base contract, which every Describe must carry.
const SUPERVISOR = { supervisor: { protocol_version: { major: 1, minor: 0 }, implementation_name: "supervisor" } };
// The driver's resource for the sandbox the gateway sandbox id names: its name, and the identity of its runtime.
const SANDBOX: ProvisionedResource = { sandboxName: "realm-session-1", resourceId: "container-1" };

function optionsOn(socketPath: string, overrides: Partial<IsolationBackendOptions> = {}): IsolationBackendOptions {
  return {
    socketPath,
    implementationVersion: IMPLEMENTATION_VERSION,
    provisioning: provisioningFor(GATEWAY_KEY),
    boundaries: new BoundaryRegistry(),
    resources: fakeResources({ [SANDBOX_ID]: SANDBOX }),
    ...overrides,
  };
}

function modeOf(path: string): number {
  return lstatSync(path).mode & 0o777;
}

function expectCode(code: string): (error: unknown) => boolean {
  return (error: unknown) => error instanceof RealmError && error.code === code;
}

// A client on the backend's socket for one service. The client closes when the test ends.
function clientFor(t: TestContext, socketPath: string, serviceName: string, service: ServiceDefinition): Client {
  const Constructor = makeClientConstructor(service, serviceName);
  const client = new Constructor(`unix:${socketPath}`, credentials.createInsecure());
  t.after(() => {
    client.close();
  });
  return client;
}

// One unary RPC with optional call metadata. A failed call rejects with the wire error, whose code is the gRPC status.
function unary(
  client: Client,
  service: ServiceDefinition,
  method: string,
  request: object,
  metadata: Metadata = new Metadata(),
): Promise<Record<string, unknown>> {
  const definition = service[method];
  if (definition === undefined) {
    throw new Error(`the service has no ${method} method`);
  }
  return new Promise((resolve, reject) => {
    client.makeUnaryRequest(
      definition.path,
      definition.requestSerialize,
      definition.responseDeserialize,
      request,
      metadata,
      (error: ServiceError | null, response: unknown) => {
        if (error !== null) {
          reject(error);
          return;
        }
        resolve(response as Record<string, unknown>);
      },
    );
  });
}

// Opens one bidirectional stream, writes the frames, and resolves with the error the server ends it with.
function streamError(client: Client, service: ServiceDefinition, method: string, frames: readonly object[]): Promise<ServiceError> {
  const definition = service[method];
  if (definition === undefined) {
    throw new Error(`the service has no ${method} method`);
  }
  return new Promise((resolve) => {
    const stream = client.makeBidiStreamRequest(definition.path, definition.requestSerialize, definition.responseDeserialize);
    stream.on("error", (error: ServiceError) => {
      stream.cancel();
      resolve(error);
    });
    for (const frame of frames) {
      stream.write(frame);
    }
    stream.end();
  });
}

async function startOnFreshPath(
  t: TestContext,
  overrides: Partial<IsolationBackendOptions> = {},
): Promise<{ socketPath: string; server: SocketServer }> {
  const socketPath = join(socketDirectory(), "backend.sock");
  const server = await startIsolationBackend(optionsOn(socketPath, overrides));
  t.after(() => server.close());
  return { socketPath, server };
}

function bearer(token: string): Metadata {
  const metadata = new Metadata();
  metadata.set("authorization", `Bearer ${token}`);
  return metadata;
}

function validToken(key: GatewayKey, overrides: Readonly<Record<string, unknown>> = {}): string {
  return signedToken(key, sandboxClaims(nowSeconds(), overrides));
}

// Changes one signature character between two values that decode to different bytes.
function tamperSignature(token: string): string {
  return token.slice(0, -2) + (token.slice(-2, -1) === "A" ? "B" : "A") + token.slice(-1);
}

void test("PRD-ISO-01: the parent directory is 0700 and the socket is 0600, and the socket is removed on close", async () => {
  const socketPath = join(socketDirectory(), "backend.sock");
  const server = await startIsolationBackend(optionsOn(socketPath));
  assert.equal(modeOf(join(socketPath, "..")), 0o700);
  assert.equal(lstatSync(socketPath).isSocket(), true);
  assert.equal(modeOf(socketPath), 0o600);
  await server.close();
  assert.equal(existsSync(socketPath), false);
});

void test("PRD-ISO-01: a relative socket path is refused", async () => {
  await assert.rejects(startIsolationBackend(optionsOn("backend.sock")), expectCode("SCHEMA_INVALID"));
});

void test("PRD-ISO-01: a regular file at the socket path is refused and left in place", async () => {
  const socketPath = join(socketDirectory(), "backend.sock");
  writeFileSync(socketPath, "not a socket");
  await assert.rejects(startIsolationBackend(optionsOn(socketPath)), expectCode("SCHEMA_INVALID"));
  assert.equal(lstatSync(socketPath).isFile(), true);
});

void test("PRD-ISO-01: a socket with a live listener is refused, and the running backend keeps serving", async (t) => {
  const { socketPath } = await startOnFreshPath(t);
  await assert.rejects(startIsolationBackend(optionsOn(socketPath)), expectCode("LOCK_CONFLICT"));
  const backend = loadIsolationServices().backend;
  const client = clientFor(t, socketPath, ISOLATION_BACKEND_SERVICE_NAME, backend);
  await unary(client, backend, "Describe", SUPERVISOR);
});

void test("PRD-ISO-01: Describe advertises no optional capability and states the base contract", async (t) => {
  const { socketPath } = await startOnFreshPath(t);
  const backend = loadIsolationServices().backend;
  const client = clientFor(t, socketPath, ISOLATION_BACKEND_SERVICE_NAME, backend);
  const response = await unary(client, backend, "Describe", SUPERVISOR);
  assert.deepEqual(response.backend, {
    protocol_version: { major: 1, minor: 0 },
    implementation_name: "realm/podman-isolation",
    implementation_version: IMPLEMENTATION_VERSION,
    supported_capabilities: [],
    required_capabilities: [],
  });
});

void test("PRD-ISO-01: Describe refuses a supervisor on another major version, one that requires a capability, or none", async (t) => {
  const { socketPath } = await startOnFreshPath(t);
  const backend = loadIsolationServices().backend;
  const client = clientFor(t, socketPath, ISOLATION_BACKEND_SERVICE_NAME, backend);
  await assert.rejects(
    unary(client, backend, "Describe", { supervisor: { protocol_version: { major: 2, minor: 0 } } }),
    (error: ServiceError) => error.code === status.FAILED_PRECONDITION,
  );
  await assert.rejects(
    unary(client, backend, "Describe", {
      supervisor: { protocol_version: { major: 1, minor: 0 }, required_capabilities: ["openshell.sandbox.suspend-resume"] },
    }),
    (error: ServiceError) => error.code === status.FAILED_PRECONDITION,
  );
  await assert.rejects(
    unary(client, backend, "Describe", {}),
    (error: ServiceError) => error.code === status.FAILED_PRECONDITION,
  );
});

void test("PD-09: SuspendBoundary and ResumeBoundary return UNIMPLEMENTED and the endpoint keeps answering", async (t) => {
  const { socketPath } = await startOnFreshPath(t);
  const backend = loadIsolationServices().backend;
  const client = clientFor(t, socketPath, ISOLATION_BACKEND_SERVICE_NAME, backend);
  await assert.rejects(
    unary(client, backend, "SuspendBoundary", { boundary_id: "b", session_id: "s", generation_id: "g" }),
    (error: ServiceError) => error.code === status.UNIMPLEMENTED,
  );
  await assert.rejects(
    unary(client, backend, "ResumeBoundary", { allow_cold_start_fallback: false }),
    (error: ServiceError) => error.code === status.UNIMPLEMENTED,
  );
  await unary(client, backend, "Describe", SUPERVISOR);
});

void test("PRD-ISO-01: OpenBoundary binds the sandbox the bearer names, and reopening the same launch returns the same handle", async (t) => {
  const boundaries = new BoundaryRegistry();
  const { socketPath } = await startOnFreshPath(t, { boundaries });
  const backend = loadIsolationServices().backend;
  const client = clientFor(t, socketPath, ISOLATION_BACKEND_SERVICE_NAME, backend);
  const token = validToken(GATEWAY_KEY);
  const request = { session_id: "session-1", backend_name: "realm", driver_descriptor: Buffer.from("opaque") };
  const first = await unary(client, backend, "OpenBoundary", request, bearer(token));
  const second = await unary(client, backend, "OpenBoundary", request, bearer(token));
  assert.equal(first.outcome, "LAUNCH_OUTCOME_FRESH");
  assert.equal(second.boundary_id, first.boundary_id);
  assert.equal(boundaries.size, 1);
  const boundary = boundaries.resolve(String(first.boundary_id));
  assert.equal(boundary.sandboxName, SANDBOX.sandboxName);
  assert.equal(boundary.gatewaySandboxId, SANDBOX_ID);
  assert.equal(boundary.generationId, GENERATION_ID);
  assert.equal(boundary.sessionId, "session-1");
  assert.equal(boundary.resourceId, SANDBOX.resourceId);
  assert.equal(boundary.lifecycle, "Bound");
});

void test("PRD-ISO-01: a different resource for the same launch fails FAILED_PRECONDITION, and the first handle keeps its resource", async (t) => {
  const boundaries = new BoundaryRegistry();
  const resources: FakeResources = fakeResources({ [SANDBOX_ID]: SANDBOX });
  const { socketPath } = await startOnFreshPath(t, { boundaries, resources });
  const backend = loadIsolationServices().backend;
  const client = clientFor(t, socketPath, ISOLATION_BACKEND_SERVICE_NAME, backend);
  const token = validToken(GATEWAY_KEY);
  const request = { session_id: "session-1" };
  const first = await unary(client, backend, "OpenBoundary", request, bearer(token));
  resources.records.set(SANDBOX_ID, { sandboxName: SANDBOX.sandboxName, resourceId: "container-2" });
  await assert.rejects(
    unary(client, backend, "OpenBoundary", request, bearer(token)),
    (error: ServiceError) => error.code === status.FAILED_PRECONDITION,
  );
  assert.equal(boundaries.size, 1);
  assert.equal(boundaries.resolve(String(first.boundary_id)).resourceId, SANDBOX.resourceId);
});

void test("PRD-ISO-02: an OpenBoundary whose bearer fails the check is UNAUTHENTICATED and changes no state", async (t) => {
  const boundaries = new BoundaryRegistry();
  const { socketPath } = await startOnFreshPath(t, { boundaries });
  const backend = loadIsolationServices().backend;
  const client = clientFor(t, socketPath, ISOLATION_BACKEND_SERVICE_NAME, backend);
  const request = { session_id: "session-1" };
  const now = nowSeconds();
  const attempts: Record<string, Metadata> = {
    "no bearer": new Metadata(),
    "an altered signature": bearer(tamperSignature(validToken(GATEWAY_KEY))),
    "a bearer for another gateway id": bearer(signedToken(GATEWAY_KEY, sandboxClaims(now, { iss: "openshell-gateway:other" }))),
    "a bearer from another signing key": bearer(signedToken(generateGatewayKey(), sandboxClaims(now))),
  };
  for (const [name, metadata] of Object.entries(attempts)) {
    await assert.rejects(
      unary(client, backend, "OpenBoundary", request, metadata),
      (error: ServiceError) => error.code === status.UNAUTHENTICATED,
      name,
    );
    assert.equal(boundaries.size, 0, name);
  }
});

void test("PRD-ISO-02: an OpenBoundary for a sandbox with no launch material is UNAUTHENTICATED and binds nothing", async (t) => {
  const boundaries = new BoundaryRegistry();
  const { socketPath } = await startOnFreshPath(t, { boundaries, provisioning: { verifierFor: () => undefined } });
  const backend = loadIsolationServices().backend;
  const client = clientFor(t, socketPath, ISOLATION_BACKEND_SERVICE_NAME, backend);
  await assert.rejects(
    unary(client, backend, "OpenBoundary", { session_id: "session-1" }, bearer(validToken(GATEWAY_KEY))),
    (error: ServiceError) => error.code === status.UNAUTHENTICATED,
  );
  assert.equal(boundaries.size, 0);
});

void test("PRD-ISO-02: an OpenBoundary whose bearer names a sandbox the launch lookup does not know is UNAUTHENTICATED", async (t) => {
  const boundaries = new BoundaryRegistry();
  const { socketPath } = await startOnFreshPath(t, { boundaries });
  const backend = loadIsolationServices().backend;
  const client = clientFor(t, socketPath, ISOLATION_BACKEND_SERVICE_NAME, backend);
  const otherSandbox = validToken(GATEWAY_KEY, { sandbox_id: "sandbox-b", sub: "spiffe://openshell/sandbox/sandbox-b" });
  await assert.rejects(
    unary(client, backend, "OpenBoundary", { session_id: "session-1" }, bearer(otherSandbox)),
    (error: ServiceError) => error.code === status.UNAUTHENTICATED,
  );
  assert.equal(boundaries.size, 0);
});

void test("PRD-ISO-01: OpenBoundary for a sandbox the driver does not hold is NOT_FOUND and binds nothing", async (t) => {
  const boundaries = new BoundaryRegistry();
  const { socketPath } = await startOnFreshPath(t, { boundaries, resources: fakeResources() });
  const backend = loadIsolationServices().backend;
  const client = clientFor(t, socketPath, ISOLATION_BACKEND_SERVICE_NAME, backend);
  await assert.rejects(
    unary(client, backend, "OpenBoundary", { session_id: "session-1" }, bearer(validToken(GATEWAY_KEY))),
    (error: ServiceError) => error.code === status.NOT_FOUND,
  );
  assert.equal(boundaries.size, 0);
});

void test("PRD-ISO-06: a handle OpenBoundary bound is NOT_FOUND once the driver deletes its sandbox, and the sandbox cannot be reopened", async (t) => {
  const boundaries = new BoundaryRegistry();
  const resources: FakeResources = fakeResources({ [SANDBOX_ID]: SANDBOX });
  const { socketPath } = await startOnFreshPath(t, { boundaries, resources });
  const backend = loadIsolationServices().backend;
  const client = clientFor(t, socketPath, ISOLATION_BACKEND_SERVICE_NAME, backend);
  const request = { session_id: "session-1" };
  await unary(client, backend, "OpenBoundary", request, bearer(validToken(GATEWAY_KEY)));
  boundaries.invalidateAll(SANDBOX.sandboxName);
  resources.records.delete(SANDBOX_ID);
  assert.equal(boundaries.size, 0);
  await assert.rejects(
    unary(client, backend, "OpenBoundary", request, bearer(validToken(GATEWAY_KEY))),
    (error: ServiceError) => error.code === status.NOT_FOUND,
  );
  assert.equal(boundaries.size, 0);
});

void test("PRD-ISO-02: Exchange without a bearer is refused UNAUTHENTICATED, and Mediate is refused UNIMPLEMENTED", async (t) => {
  const { socketPath } = await startOnFreshPath(t);
  const protocol = loadIsolationServices().protocol;
  const client = clientFor(t, socketPath, SANDBOX_PROTOCOL_SERVICE_NAME, protocol);
  const requestFrames = [
    { boundary_id: "not-a-handle" },
    { request: { request_id: "request-1", attach: { supervisor_instance_id: "supervisor-1", policy: { version: 1 } } } },
  ];
  const exchangeError = await streamError(client, protocol, "Exchange", requestFrames);
  assert.equal(exchangeError.code, status.UNAUTHENTICATED);
  const mediateError = await streamError(client, protocol, "Mediate", []);
  assert.equal(mediateError.code, status.UNIMPLEMENTED);
});

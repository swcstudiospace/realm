// Drives the isolation backend over its Unix socket with a real gRPC client. The socket rules are the driver's: the
// parent directory is 0700, the socket is 0600, and a path that cannot be the backend's own socket is refused.

import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { existsSync, lstatSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  credentials,
  makeClientConstructor,
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
import type { SocketServer } from "../../../src/runtime/driver/server.js";
import { IMPLEMENTATION_VERSION, socketDirectory } from "../driver/fakes.js";

const VERIFICATION_KEY = new Uint8Array(32).fill(7);
// A supervisor on the base contract, which every Describe must carry.
const SUPERVISOR = { supervisor: { protocol_version: { major: 1, minor: 0 }, implementation_name: "supervisor" } };

function optionsOn(socketPath: string, overrides: Partial<IsolationBackendOptions> = {}): IsolationBackendOptions {
  return {
    socketPath,
    implementationVersion: IMPLEMENTATION_VERSION,
    provisioning: { gatewayId: "gateway-1", verificationKeys: [VERIFICATION_KEY] },
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

// One unary RPC. A failed call rejects with the wire error, whose code is the gRPC status.
function unary(
  client: Client,
  service: ServiceDefinition,
  method: string,
  request: object,
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

// Opens one bidirectional stream and resolves with the error the server ends it with.
function streamError(client: Client, service: ServiceDefinition, method: string): Promise<ServiceError> {
  const definition = service[method];
  if (definition === undefined) {
    throw new Error(`the service has no ${method} method`);
  }
  return new Promise((resolve) => {
    const stream = client.makeBidiStreamRequest(
      definition.path,
      definition.requestSerialize,
      definition.responseDeserialize,
    );
    stream.on("error", (error: ServiceError) => {
      stream.cancel();
      resolve(error);
    });
  });
}

async function startOnFreshPath(t: TestContext): Promise<{ socketPath: string; server: SocketServer }> {
  const socketPath = join(socketDirectory(), "backend.sock");
  const server = await startIsolationBackend(optionsOn(socketPath));
  t.after(() => server.close());
  return { socketPath, server };
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

void test("PRD-ISO-01: a backend with no verification key or no gateway identity is refused before any socket exists", async () => {
  const withoutKeys = join(socketDirectory(), "keyless.sock");
  await assert.rejects(
    startIsolationBackend(optionsOn(withoutKeys, { provisioning: { gatewayId: "gateway-1", verificationKeys: [] } })),
    expectCode("SCHEMA_INVALID"),
  );
  assert.equal(existsSync(withoutKeys), false);

  const withoutGateway = join(socketDirectory(), "gatewayless.sock");
  await assert.rejects(
    startIsolationBackend(optionsOn(withoutGateway, { provisioning: { gatewayId: "", verificationKeys: [VERIFICATION_KEY] } })),
    expectCode("SCHEMA_INVALID"),
  );
  assert.equal(existsSync(withoutGateway), false);
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
  await assert.rejects(
    unary(client, backend, "OpenBoundary", { session_id: "s", backend_name: "b" }),
    (error: ServiceError) => error.code === status.UNIMPLEMENTED,
  );
  await unary(client, backend, "Describe", SUPERVISOR);
});

void test("PRD-ISO-02: every SandboxProtocol stream is served on the endpoint and refused UNIMPLEMENTED", async (t) => {
  const { socketPath } = await startOnFreshPath(t);
  const protocol = loadIsolationServices().protocol;
  const client = clientFor(t, socketPath, SANDBOX_PROTOCOL_SERVICE_NAME, protocol);
  for (const method of ["Exchange", "Mediate"]) {
    const error = await streamError(client, protocol, method);
    assert.equal(error.code, status.UNIMPLEMENTED, method);
  }
});

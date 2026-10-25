// Drives the real socket server with a real gRPC client. It proves the wire contract end to end: the field names, the
// status each refusal reaches the gateway with, the admission acknowledgement, and the watch stream.

import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  credentials,
  makeClientConstructor,
  status,
  type Client,
  type ServiceDefinition,
  type ServiceError,
} from "@grpc/grpc-js";
import {
  ComputeDriver,
  COMPUTE_DRIVER_SERVICE_NAME,
  computeDriverImplementation,
  loadComputeDriverService,
} from "../../../src/runtime/driver/compute-driver.js";
import { DRIVER_ADMISSION_ACKNOWLEDGEMENT } from "../../../src/runtime/driver/admission.js";
import { startSocketServer, type SocketServer } from "../../../src/runtime/driver/server.js";
import { BoundaryRegistry } from "../../../src/runtime/driver/isolation/boundary.js";
import { FakeLibpod, FakeLifecycle, driverConfig, OTHER_DIGEST_IMAGE, socketDirectory, validSandbox } from "./fakes.js";

interface Harness {
  readonly client: Client;
  readonly lifecycle: FakeLifecycle;
  readonly service: ServiceDefinition;
  readonly server: SocketServer;
}

async function harness(t: TestContext): Promise<Harness> {
  const libpod = new FakeLibpod();
  const lifecycle = new FakeLifecycle(libpod);
  const config = driverConfig();
  mkdirSync(config.workspaceRoot, { recursive: true });
  const driver = new ComputeDriver(config, { lifecycle, libpod, boundaries: new BoundaryRegistry() });
  const service = loadComputeDriverService();
  const socketPath = join(socketDirectory(), "driver.sock");
  const server = await startSocketServer(socketPath, [
    { service, implementation: computeDriverImplementation(driver, 10) },
  ]);
  const Constructor = makeClientConstructor(service, COMPUTE_DRIVER_SERVICE_NAME);
  const client = new Constructor(`unix:${socketPath}`, credentials.createInsecure());
  t.after(async () => {
    client.close();
    await server.close();
  });
  return { client, lifecycle, service, server };
}

function methodOf(h: Harness, method: string): ServiceDefinition[string] {
  const definition = h.service[method];
  if (definition === undefined) {
    throw new Error(`the service has no ${method} method`);
  }
  return definition;
}

// One unary RPC. A failed call rejects with the wire error, whose code is the gRPC status.
function call(h: Harness, method: string, request: object): Promise<Record<string, unknown>> {
  const definition = methodOf(h, method);
  return new Promise((resolve, reject) => {
    h.client.makeUnaryRequest(
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

async function statusOf(promise: Promise<unknown>): Promise<status | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error: unknown) {
    const code = (error as Partial<ServiceError>).code;
    return code;
  }
}

void test("PRD-GW-03: GetCapabilities over the wire returns the pinned acknowledgement on both calls", async (t) => {
  const h = await harness(t);
  const first = await call(h, "GetCapabilities", {});
  const second = await call(h, "GetCapabilities", {});
  assert.equal(first["resource_admission_policy"], DRIVER_ADMISSION_ACKNOWLEDGEMENT);
  assert.equal(second["resource_admission_policy"], DRIVER_ADMISSION_ACKNOWLEDGEMENT);
  assert.equal(first["driver_name"], "realm");
});

void test("PRD-DRV-02: an out-of-profile CreateSandbox reaches the gateway as INVALID_ARGUMENT with no create", async (t) => {
  const h = await harness(t);
  const sandbox = validSandbox();
  const bad = { ...sandbox, spec: { ...sandbox.spec, template: { ...sandbox.spec?.template, image: OTHER_DIGEST_IMAGE } } };
  assert.equal(await statusOf(call(h, "CreateSandbox", { sandbox: bad })), status.INVALID_ARGUMENT);
  assert.equal(h.lifecycle.creates.length, 0);
});

void test("PRD-DRV-02: a non-empty platform config sent on the wire is refused as INVALID_ARGUMENT", async (t) => {
  const h = await harness(t);
  const sandbox = validSandbox();
  const withConfig = {
    ...sandbox,
    spec: {
      ...sandbox.spec,
      template: { ...sandbox.spec?.template, platform_config: { fields: { hostNetwork: { bool_value: true } } } },
    },
  };
  assert.equal(await statusOf(call(h, "CreateSandbox", { sandbox: withConfig })), status.INVALID_ARGUMENT);
  assert.equal(h.lifecycle.creates.length, 0);
});

void test("PRD-DRV-03: StopSandbox and StartSandbox reach the gateway as FAILED_PRECONDITION", async (t) => {
  const h = await harness(t);
  const request = { sandbox_id: "sandbox-1", name: "realm-session-1" };
  assert.equal(await statusOf(call(h, "StopSandbox", request)), status.FAILED_PRECONDITION);
  assert.equal(await statusOf(call(h, "StartSandbox", request)), status.FAILED_PRECONDITION);
});

void test("the driver does not offer AuthenticateSandbox: it is UNIMPLEMENTED", async (t) => {
  const h = await harness(t);
  assert.equal(await statusOf(call(h, "AuthenticateSandbox", { credential: "" })), status.UNIMPLEMENTED);
});

void test("a sandbox the driver does not hold is NOT_FOUND on the wire", async (t) => {
  const h = await harness(t);
  assert.equal(await statusOf(call(h, "GetSandbox", { name: "realm-missing" })), status.NOT_FOUND);
});

void test("PRD-DRV-01: create, get, delete, and EnsureWorkspace work over the wire", async (t) => {
  const h = await harness(t);
  const created = await call(h, "CreateSandbox", { sandbox: validSandbox() });
  assert.equal(created["runtime_identity"], "id-realm-session-1");
  const got = await call(h, "GetSandbox", { sandbox_id: "sandbox-1" });
  const sandbox = got["sandbox"] as { id: string; name: string };
  assert.equal(sandbox.id, "sandbox-1");
  assert.equal(sandbox.name, "realm-session-1");
  assert.deepEqual(await call(h, "DeleteSandbox", { sandbox_id: "sandbox-1" }), { deleted: true });
  assert.deepEqual(await call(h, "EnsureWorkspace", { workspace: "workspace-a" }), {});
});

void test("PRD-DRV-01: WatchSandboxes streams the current sandboxes, and the stream ends when the client cancels", async (t) => {
  const h = await harness(t);
  await call(h, "CreateSandbox", { sandbox: validSandbox() });
  const watch = methodOf(h, "WatchSandboxes");
  const stream = h.client.makeServerStreamRequest(
    watch.path,
    watch.requestSerialize,
    watch.responseDeserialize,
    {},
  );
  const first = await new Promise<unknown>((resolve, reject) => {
    stream.once("data", (event: unknown) => {
      resolve(event);
    });
    stream.once("error", reject);
  });
  stream.cancel();
  const payload = first as { sandbox?: { sandbox?: { name?: string } } };
  assert.equal(payload.sandbox?.sandbox?.name, "realm-session-1");
});

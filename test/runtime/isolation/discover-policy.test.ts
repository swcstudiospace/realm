// Drives DiscoverPolicy over the SandboxProtocol Exchange stream with a real gRPC client. DiscoverPolicy is read-only and permitted
// only before Attach: it answers with no image policy, and every refused request ends with its status and changes no state.

import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { credentials, makeClientConstructor, Metadata, status, type Client } from "@grpc/grpc-js";
import {
  SANDBOX_PROTOCOL_SERVICE_NAME,
  loadIsolationServices,
  startIsolationBackend,
  type BackendProvisioning,
} from "../../../src/runtime/driver/isolation/backend.js";
import type { SupervisorBearerVerifier } from "../../../src/runtime/driver/isolation/bearer.js";
import {
  BoundaryRegistry,
  type BoundaryOpening,
  type ProvisionedResource,
} from "../../../src/runtime/driver/isolation/boundary.js";
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
  verifierOf,
  type GatewayKey,
} from "./supervisor-token.js";

interface ExchangeOutcome {
  readonly code: status;
  readonly responses: readonly Record<string, unknown>[];
}

const LAUNCH: BoundaryOpening = {
  sandboxName: "realm-session-1",
  gatewaySandboxId: SANDBOX_ID,
  generationId: GENERATION_ID,
  sessionId: "session-1",
  resourceId: "resource-1",
};

const RESOURCE: ProvisionedResource = { sandboxName: LAUNCH.sandboxName, resourceId: LAUNCH.resourceId };

async function startBackendFor(
  t: TestContext,
  key: GatewayKey,
  boundaries: BoundaryRegistry,
  resources: FakeResources = fakeResources({ [SANDBOX_ID]: RESOURCE }),
  provisioning: BackendProvisioning = provisioningFor(key),
): Promise<{ socketPath: string; server: SocketServer }> {
  const socketPath = join(socketDirectory(), "backend.sock");
  const server = await startIsolationBackend({
    socketPath,
    implementationVersion: IMPLEMENTATION_VERSION,
    provisioning,
    boundaries,
    resources,
  });
  t.after(() => server.close());
  return { socketPath, server };
}

// Opens one Exchange stream, writes the frames, and resolves with the status the server ends it with and the responses.
function exchange(t: TestContext, socketPath: string, metadata: Metadata, frames: readonly object[]): Promise<ExchangeOutcome> {
  const protocol = loadIsolationServices().protocol;
  const definition = protocol["Exchange"];
  if (definition === undefined) {
    throw new Error("the protocol has no Exchange method");
  }
  const Constructor = makeClientConstructor(protocol, SANDBOX_PROTOCOL_SERVICE_NAME);
  const client: Client = new Constructor(`unix:${socketPath}`, credentials.createInsecure());
  t.after(() => {
    client.close();
  });
  return new Promise((resolve) => {
    const responses: Record<string, unknown>[] = [];
    const stream = client.makeBidiStreamRequest(
      definition.path,
      definition.requestSerialize,
      definition.responseDeserialize,
      metadata,
    );
    stream.on("data", (response: Record<string, unknown>) => {
      responses.push(response);
    });
    stream.on("error", () => undefined);
    stream.on("status", (received: { code: status }) => {
      resolve({ code: received.code, responses });
    });
    for (const frame of frames) {
      stream.write(frame);
    }
    stream.end();
  });
}

function bearer(token: string): Metadata {
  const metadata = new Metadata();
  metadata.set("authorization", `Bearer ${token}`);
  return metadata;
}

function boundaryFrame(handle: string): object {
  return { boundary_id: handle };
}

function attachFrame(requestId = "request-1"): object {
  return { request: { request_id: requestId, attach: { supervisor_instance_id: "supervisor-1", policy: { version: 1 } } } };
}

function discoverPolicyFrame(requestId = "request-1"): object {
  return { request: { request_id: requestId, discover_policy: {} } };
}

function validToken(key: GatewayKey, overrides: Readonly<Record<string, unknown>> = {}): string {
  return signedToken(key, sandboxClaims(nowSeconds(), overrides));
}

// Changes one signature character between two values that decode to different bytes.
function tamperSignature(token: string): string {
  return token.slice(0, -2) + (token.slice(-2, -1) === "A" ? "B" : "A") + token.slice(-1);
}

void test("PRD-ISO-02: DiscoverPolicy on a Bound boundary answers no image policy, changes no state, and Attach still follows", async (t) => {
  const key = generateGatewayKey();
  const boundaries = new BoundaryRegistry();
  const handle = boundaries.open(LAUNCH);
  const { socketPath } = await startBackendFor(t, key, boundaries);
  const discovered = await exchange(t, socketPath, bearer(validToken(key)), [boundaryFrame(handle), discoverPolicyFrame("request-d")]);
  assert.equal(discovered.code, status.OK);
  assert.equal(discovered.responses.length, 1);
  const response = discovered.responses[0]?.response as Record<string, unknown>;
  assert.equal(response.request_id, "request-d");
  const imagePolicy = response.image_policy as { yaml?: string | null; invalid: boolean };
  assert.equal(imagePolicy.invalid, false);
  assert.equal(imagePolicy.yaml ?? null, null);
  assert.equal(boundaries.resolve(handle).lifecycle, "Bound");
  const attached = await exchange(t, socketPath, bearer(validToken(key)), [boundaryFrame(handle), attachFrame()]);
  assert.equal(attached.code, status.OK);
  assert.equal(boundaries.resolve(handle).lifecycle, "Attached");
});

void test("PRD-ISO-02: DiscoverPolicy after Attach is refused FAILED_PRECONDITION and changes no state", async (t) => {
  const key = generateGatewayKey();
  const boundaries = new BoundaryRegistry();
  const handle = boundaries.open(LAUNCH);
  const { socketPath } = await startBackendFor(t, key, boundaries);
  const attached = await exchange(t, socketPath, bearer(validToken(key)), [boundaryFrame(handle), attachFrame()]);
  assert.equal(attached.code, status.OK);
  const late = await exchange(t, socketPath, bearer(validToken(key)), [boundaryFrame(handle), discoverPolicyFrame()]);
  assert.equal(late.code, status.FAILED_PRECONDITION);
  assert.equal(late.responses.length, 0);
  assert.equal(boundaries.resolve(handle).lifecycle, "Attached");
});

void test("PRD-ISO-02: a DiscoverPolicy whose bearer fails a check is UNAUTHENTICATED and changes no state", async (t) => {
  const key = generateGatewayKey();
  const boundaries = new BoundaryRegistry();
  const handle = boundaries.open(LAUNCH);
  const { socketPath } = await startBackendFor(t, key, boundaries);
  const now = nowSeconds();
  const attempts: Record<string, Metadata> = {
    "no bearer": new Metadata(),
    "an altered signature": bearer(tamperSignature(validToken(key))),
    "another gateway id": bearer(validToken(key, { iss: "openshell-gateway:other" })),
    "another generation": bearer(validToken(key, { runtime_generation: "generation-2" })),
    "an expired lifetime": bearer(validToken(key, { iat: now - 3700, exp: now - 100 })),
    "another signing key": bearer(signedToken(generateGatewayKey(), sandboxClaims(now))),
  };
  for (const [name, metadata] of Object.entries(attempts)) {
    const outcome = await exchange(t, socketPath, metadata, [boundaryFrame(handle), discoverPolicyFrame()]);
    assert.equal(outcome.code, status.UNAUTHENTICATED, name);
    assert.equal(outcome.responses.length, 0, name);
    assert.equal(boundaries.resolve(handle).lifecycle, "Bound", name);
  }
});

void test("PRD-ISO-02: a DiscoverPolicy with another sandbox's bearer on this handle is UNAUTHENTICATED and changes no state", async (t) => {
  const key = generateGatewayKey();
  const boundaries = new BoundaryRegistry();
  const handle = boundaries.open(LAUNCH);
  const { socketPath } = await startBackendFor(t, key, boundaries);
  const otherSandbox = validToken(key, { sandbox_id: "sandbox-b", sub: "spiffe://openshell/sandbox/sandbox-b" });
  const outcome = await exchange(t, socketPath, bearer(otherSandbox), [boundaryFrame(handle), discoverPolicyFrame()]);
  assert.equal(outcome.code, status.UNAUTHENTICATED);
  assert.equal(outcome.responses.length, 0);
  assert.equal(boundaries.resolve(handle).lifecycle, "Bound");
});

void test("PRD-ISO-02: a DiscoverPolicy for a sandbox with no launch material is UNAUTHENTICATED, and answers once material exists", async (t) => {
  const key = generateGatewayKey();
  const boundaries = new BoundaryRegistry();
  const handle = boundaries.open(LAUNCH);
  const verifiers = new Map<string, SupervisorBearerVerifier>();
  const provisioning: BackendProvisioning = { verifierFor: (sandboxId) => verifiers.get(sandboxId) };
  const { socketPath } = await startBackendFor(t, key, boundaries, undefined, provisioning);
  const refused = await exchange(t, socketPath, bearer(validToken(key)), [boundaryFrame(handle), discoverPolicyFrame()]);
  assert.equal(refused.code, status.UNAUTHENTICATED);
  assert.equal(refused.responses.length, 0);
  assert.equal(boundaries.resolve(handle).lifecycle, "Bound");
  verifiers.set(SANDBOX_ID, verifierOf(key));
  const answered = await exchange(t, socketPath, bearer(validToken(key)), [boundaryFrame(handle), discoverPolicyFrame()]);
  assert.equal(answered.code, status.OK);
  assert.equal(boundaries.resolve(handle).lifecycle, "Bound");
});

void test("PRD-ISO-06: DiscoverPolicy with a handle invalidated by delete is NOT_FOUND and changes no state", async (t) => {
  const key = generateGatewayKey();
  const boundaries = new BoundaryRegistry();
  const handle = boundaries.open(LAUNCH);
  const { socketPath } = await startBackendFor(t, key, boundaries);
  boundaries.invalidateAll(LAUNCH.sandboxName);
  const outcome = await exchange(t, socketPath, bearer(validToken(key)), [boundaryFrame(handle), discoverPolicyFrame()]);
  assert.equal(outcome.code, status.NOT_FOUND);
  assert.equal(outcome.responses.length, 0);
  assert.equal(boundaries.size, 0);
});

void test("PRD-ISO-06: DiscoverPolicy on a handle bound during a delete is NOT_FOUND once the driver has removed the sandbox", async (t) => {
  const key = generateGatewayKey();
  const boundaries = new BoundaryRegistry();
  const resources: FakeResources = fakeResources({ [SANDBOX_ID]: RESOURCE });
  const handle = boundaries.open(LAUNCH);
  const { socketPath } = await startBackendFor(t, key, boundaries, resources);
  resources.records.delete(SANDBOX_ID);
  const outcome = await exchange(t, socketPath, bearer(validToken(key)), [boundaryFrame(handle), discoverPolicyFrame()]);
  assert.equal(outcome.code, status.NOT_FOUND);
  assert.equal(outcome.responses.length, 0);
  assert.equal(boundaries.resolve(handle).lifecycle, "Bound");
});

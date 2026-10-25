// Drives the SandboxProtocol Exchange stream over the backend's Unix socket with a real gRPC client. Each refused Attach must end
// with its status and leave the boundary exactly as it was. The gateway's bearer is minted in the test with the key the backend
// was started with.

import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { credentials, makeClientConstructor, Metadata, status, type Client } from "@grpc/grpc-js";
import {
  SANDBOX_PROTOCOL_SERVICE_NAME,
  loadIsolationServices,
  startIsolationBackend,
} from "../../../src/runtime/driver/isolation/backend.js";
import { SupervisorBearerVerifier } from "../../../src/runtime/driver/isolation/bearer.js";
import { BoundaryRegistry, type BoundaryOpening } from "../../../src/runtime/driver/isolation/boundary.js";
import type { SocketServer } from "../../../src/runtime/driver/server.js";
import { IMPLEMENTATION_VERSION, socketDirectory } from "../driver/fakes.js";
import {
  GENERATION_ID,
  SANDBOX_ID,
  generateGatewayKey,
  hmacTokenWithPublicKey,
  nowSeconds,
  sandboxClaims,
  sandboxHeader,
  signedToken,
  unsignedToken,
  type GatewayKey,
} from "./supervisor-token.js";

interface ExchangeOutcome {
  readonly code: status;
  readonly responses: readonly Record<string, unknown>[];
}

// The driver's name for the sandbox, and the gateway identity the bearer carries for it.
const LAUNCH: BoundaryOpening = {
  sandboxName: "realm-session-1",
  gatewaySandboxId: SANDBOX_ID,
  generationId: GENERATION_ID,
  sessionId: "session-1",
  resourceId: "resource-1",
};

async function startBackendFor(
  t: TestContext,
  key: GatewayKey,
  boundaries: BoundaryRegistry,
): Promise<{ socketPath: string; server: SocketServer }> {
  const socketPath = join(socketDirectory(), "backend.sock");
  const server = await startIsolationBackend({
    socketPath,
    implementationVersion: IMPLEMENTATION_VERSION,
    provisioning: { verifier: new SupervisorBearerVerifier(key.publicPem) },
    boundaries,
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

function validToken(key: GatewayKey, overrides: Readonly<Record<string, unknown>> = {}): string {
  return signedToken(key, sandboxClaims(nowSeconds(), overrides));
}

// Changes one signature character between two values that decode to different bytes.
function tamperSignature(token: string): string {
  return token.slice(0, -2) + (token.slice(-2, -1) === "A" ? "B" : "A") + token.slice(-1);
}

void test("PRD-ISO-02: a valid bearer and an Attach move the boundary to Attached and answer with its generation", async (t) => {
  const key = generateGatewayKey();
  const boundaries = new BoundaryRegistry();
  const handle = boundaries.open(LAUNCH);
  const { socketPath } = await startBackendFor(t, key, boundaries);
  const outcome = await exchange(t, socketPath, bearer(validToken(key)), [boundaryFrame(handle), attachFrame("request-7")]);
  assert.equal(outcome.code, status.OK);
  assert.equal(outcome.responses.length, 1);
  const response = outcome.responses[0]?.response as Record<string, unknown>;
  assert.equal(response.request_id, "request-7");
  const attached = response.attached as { snapshot: { generation: string } };
  assert.equal(attached.snapshot.generation, GENERATION_ID);
  assert.equal(boundaries.resolve(handle).lifecycle, "Attached");
});

// A duplicated authorization value never reaches this handler: the HTTP/2 layer refuses a repeated single-value header, so the
// client sees INTERNAL with no state change. The bearer reader refuses duplicates on its own (supervisor-bearer.test.ts).
void test("PRD-ISO-02: a missing bearer fails UNAUTHENTICATED and the boundary stays Bound", async (t) => {
  const key = generateGatewayKey();
  const boundaries = new BoundaryRegistry();
  const handle = boundaries.open(LAUNCH);
  const { socketPath } = await startBackendFor(t, key, boundaries);
  const missing = await exchange(t, socketPath, new Metadata(), [boundaryFrame(handle), attachFrame()]);
  assert.equal(missing.code, status.UNAUTHENTICATED);
  assert.equal(boundaries.resolve(handle).lifecycle, "Bound");
});

void test("PRD-ISO-02: each bearer that fails a check ends UNAUTHENTICATED and changes no state", async (t) => {
  const key = generateGatewayKey();
  const boundaries = new BoundaryRegistry();
  const handle = boundaries.open(LAUNCH);
  const { socketPath } = await startBackendFor(t, key, boundaries);
  const now = nowSeconds();
  const attempts: Record<string, string> = {
    "an altered signature": tamperSignature(validToken(key)),
    "the none algorithm": unsignedToken(sandboxClaims(now), sandboxHeader(key, { alg: "none" })),
    "an HMAC key confusion": hmacTokenWithPublicKey(key, sandboxClaims(now)),
    "an expired lifetime": validToken(key, { iat: now - 3700, exp: now - 100 }),
    "a wrong audience": validToken(key, { aud: "openshell-gateway" }),
    "another sandbox": validToken(key, { sandbox_id: "sandbox-b", sub: "spiffe://openshell/sandbox/sandbox-b" }),
    "another generation": validToken(key, { runtime_generation: "generation-2" }),
    "another signing key": signedToken(generateGatewayKey(), sandboxClaims(now)),
  };
  for (const [name, token] of Object.entries(attempts)) {
    const outcome = await exchange(t, socketPath, bearer(token), [boundaryFrame(handle), attachFrame()]);
    assert.equal(outcome.code, status.UNAUTHENTICATED, name);
    assert.equal(outcome.responses.length, 0, name);
    assert.equal(boundaries.resolve(handle).lifecycle, "Bound", name);
  }
});

void test("PRD-ISO-02: a bad bearer on a request other than Attach is UNAUTHENTICATED, not UNIMPLEMENTED", async (t) => {
  const key = generateGatewayKey();
  const boundaries = new BoundaryRegistry();
  const handle = boundaries.open(LAUNCH);
  const { socketPath } = await startBackendFor(t, key, boundaries);
  const confirm = { request: { request_id: "request-2", confirm: {} } };
  const outcome = await exchange(t, socketPath, bearer(tamperSignature(validToken(key))), [boundaryFrame(handle), confirm]);
  assert.equal(outcome.code, status.UNAUTHENTICATED);
});

void test("PRD-ISO-02: a second Attach for the same generation is refused and leaves the first attach in place", async (t) => {
  const key = generateGatewayKey();
  const boundaries = new BoundaryRegistry();
  const handle = boundaries.open(LAUNCH);
  const otherSession = boundaries.open({ ...LAUNCH, sessionId: "session-2" });
  const { socketPath } = await startBackendFor(t, key, boundaries);
  const first = await exchange(t, socketPath, bearer(validToken(key)), [boundaryFrame(handle), attachFrame()]);
  assert.equal(first.code, status.OK);
  const again = await exchange(t, socketPath, bearer(validToken(key)), [boundaryFrame(handle), attachFrame()]);
  assert.equal(again.code, status.FAILED_PRECONDITION);
  const sibling = await exchange(t, socketPath, bearer(validToken(key)), [boundaryFrame(otherSession), attachFrame()]);
  assert.equal(sibling.code, status.FAILED_PRECONDITION);
  assert.equal(boundaries.resolve(handle).lifecycle, "Attached");
  assert.equal(boundaries.resolve(otherSession).lifecycle, "Bound");
});

void test("PRD-ISO-06: an unknown handle is NOT_FOUND, and a handle invalidated by delete is NOT_FOUND with no state change", async (t) => {
  const key = generateGatewayKey();
  const boundaries = new BoundaryRegistry();
  const handle = boundaries.open(LAUNCH);
  const { socketPath } = await startBackendFor(t, key, boundaries);
  const unknown = await exchange(t, socketPath, bearer(validToken(key)), [boundaryFrame("not-a-handle"), attachFrame()]);
  assert.equal(unknown.code, status.NOT_FOUND);
  boundaries.invalidateAll(LAUNCH.sandboxName);
  const deleted = await exchange(t, socketPath, bearer(validToken(key)), [boundaryFrame(handle), attachFrame()]);
  assert.equal(deleted.code, status.NOT_FOUND);
  assert.equal(boundaries.size, 0);
});

void test("PRD-ISO-03: a request other than Attach is UNIMPLEMENTED and does not advance the state", async (t) => {
  const key = generateGatewayKey();
  const boundaries = new BoundaryRegistry();
  const handle = boundaries.open(LAUNCH);
  const { socketPath } = await startBackendFor(t, key, boundaries);
  const confirm = { request: { request_id: "request-2", confirm: {} } };
  const outcome = await exchange(t, socketPath, bearer(validToken(key)), [boundaryFrame(handle), confirm]);
  assert.equal(outcome.code, status.UNIMPLEMENTED);
  assert.equal(boundaries.resolve(handle).lifecycle, "Bound");
});

void test("PRD-ISO-02: a stream whose first frame is not a boundary handle is refused as an invalid argument", async (t) => {
  const key = generateGatewayKey();
  const boundaries = new BoundaryRegistry();
  boundaries.open(LAUNCH);
  const { socketPath } = await startBackendFor(t, key, boundaries);
  const outcome = await exchange(t, socketPath, bearer(validToken(key)), [attachFrame()]);
  assert.equal(outcome.code, status.INVALID_ARGUMENT);
});

// The SandboxProtocol Exchange stream (phase 9.5, PRD-ISO-02 and PRD-ISO-03). This wave serves two request kinds: DiscoverPolicy,
// which is permitted before attachment, and Attach.
//
// The stream carries two frames: the boundary handle, and a request. The supervisor's bearer is read from the call metadata when
// the stream opens, but it is verified only once both frames are read, so a token that expires while the stream is held open
// cannot authorize the request. A refusal is raised after the frames, so a client that wrote its frames never sees its own writes
// reset the stream. Every request checks that the verified gateway sandbox and runtime generation are the ones the handle was
// opened for, and that the driver still holds that sandbox as the handle was bound. DiscoverPolicy answers with no image policy and
// changes no state. Attach moves the boundary to Attached. Every failed check ends the stream with its status and changes no state.
// Any other request kind returns UNIMPLEMENTED and changes no state; Confirm, StartAgent and the rest of the lifecycle are built in
// later waves.

import type { ServerDuplexStream } from "@grpc/grpc-js";
import { status } from "@grpc/grpc-js";
import { makeRealmError } from "../../../core/errors.js";
import { DriverStatusError, driverFailureOf, driverNotFound, driverUnimplemented, toServerError } from "../grpc-status.js";
import { bearerFromMetadata, type SupervisorBearerVerifier, type SupervisorSession } from "./bearer.js";
import type { Boundary, BoundaryRegistry, ProvisionedResources } from "./boundary.js";

export interface SandboxProtocolDeps {
  readonly verifier: Pick<SupervisorBearerVerifier, "verify">;
  readonly boundaries: BoundaryRegistry;
  readonly resources: ProvisionedResources;
}

// The Exchange handler. The stream is ended by this handler after the response, or ended with the failure.
export function exchange(deps: SandboxProtocolDeps): (call: ServerDuplexStream<unknown, unknown>) => void {
  return (call) => {
    serveExchange(call, deps).catch((error: unknown) => {
      call.emit("error", toServerError(driverFailureOf(error)));
    });
  };
}

// The bearer as the call metadata carries it at stream open: the token, or the refusal to raise once the frames are read.
type BearerOutcome = { readonly token: string } | { readonly refusal: unknown };

function readBearer(call: ServerDuplexStream<unknown, unknown>): BearerOutcome {
  try {
    return { token: bearerFromMetadata(call.metadata) };
  } catch (error: unknown) {
    return { refusal: error };
  }
}

// The frames are proto-loader messages with oneofs set: `payload` names the set ExchangeFrame field, and `request` names the
// set RequestEnvelope field.
async function serveExchange(call: ServerDuplexStream<unknown, unknown>, deps: SandboxProtocolDeps): Promise<void> {
  const bearer = readBearer(call);
  const frames = call[Symbol.asyncIterator]();

  const boundaryFrame = await nextFrame(frames);
  if (boundaryFrame.payload !== "boundary_id" || typeof boundaryFrame.boundary_id !== "string") {
    throw makeRealmError("SCHEMA_INVALID");
  }
  const handle = boundaryFrame.boundary_id;

  const requestFrame = await nextFrame(frames);
  if (requestFrame.payload !== "request") {
    throw makeRealmError("SCHEMA_INVALID");
  }
  if ("refusal" in bearer) {
    throw bearer.refusal;
  }
  // Verified at the time of use, not at stream open: the frames may arrive later, and the token's expiry is checked then.
  const session = deps.verifier.verify(bearer.token);
  const envelope = requestFrame.request as Readonly<Record<string, unknown>>;
  if (envelope.request === "discover_policy") {
    const boundary = boundaryOf(deps, handle, session);
    if (boundary.lifecycle !== "Bound") {
      throw new DriverStatusError({
        code: status.FAILED_PRECONDITION,
        details: "DiscoverPolicy is permitted only before Attach",
      });
    }
    // No image policy is absent yaml with invalid false (sandbox_protocol.proto, ImagePolicy). The supervisor then uses its
    // restrictive default when the gateway holds no policy, and never treats this as an invalid image.
    call.write({ response: { request_id: envelope.request_id, image_policy: { invalid: false } } });
    call.end();
    return;
  }
  if (envelope.request !== "attach") {
    throw new DriverStatusError(driverUnimplemented("only DiscoverPolicy and Attach are served on the sandbox protocol in this wave"));
  }
  const boundary = boundaryOf(deps, handle, session);
  deps.boundaries.markAttached(handle);
  call.write({
    response: {
      request_id: envelope.request_id,
      attached: { snapshot: { generation: boundary.generationId, processes: [] } },
    },
  });
  call.end();
}

// The boundary a handle names, when it is still valid for the verified sandbox. An unknown or invalidated handle is NOT_FOUND. A
// boundary of another sandbox or generation is UNAUTHENTICATED. A handle whose driver record is gone, or whose resource was
// replaced, is NOT_FOUND: a handle bound while a DeleteSandbox was in progress fails here once the driver has removed the sandbox.
// Every refusal changes no state.
function boundaryOf(deps: SandboxProtocolDeps, handle: string, session: SupervisorSession): Boundary {
  const boundary = deps.boundaries.resolve(handle);
  if (boundary.gatewaySandboxId !== session.sandboxId || boundary.generationId !== session.runtimeGeneration) {
    throw new DriverStatusError({
      code: status.UNAUTHENTICATED,
      details: "the supervisor bearer does not match the sandbox of the boundary",
    });
  }
  const resource = deps.resources.provisionedResource(session.sandboxId);
  if (
    resource === undefined ||
    resource.sandboxName !== boundary.sandboxName ||
    resource.resourceId !== boundary.resourceId
  ) {
    throw new DriverStatusError(driverNotFound("the boundary handle is not valid"));
  }
  return boundary;
}

// The next frame of the stream. A stream that ends before the frame is a protocol error.
async function nextFrame(frames: AsyncIterator<unknown>): Promise<Readonly<Record<string, unknown>>> {
  const next = await frames.next();
  if (next.done === true || typeof next.value !== "object" || next.value === null) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  return next.value as Readonly<Record<string, unknown>>;
}

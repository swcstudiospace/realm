// The SandboxProtocol Exchange stream (phase 9.5, PRD-ISO-02 and PRD-ISO-03). This wave serves one request kind: Attach.
//
// The stream carries two frames: the boundary handle, and a request whose kind is Attach. The supervisor's bearer is read from
// the call metadata when the stream opens and verified then; a refusal is kept and raised only after both frames are read.
// The status is therefore sent after the client has finished its request, so a client that wrote its frames never sees its
// own writes reset the stream. Attach checks that the verified gateway sandbox and runtime generation are the ones the handle
// was opened for, and only then moves the boundary to Attached. Every failed check ends the stream with its status and changes
// no state. Any other request kind returns UNIMPLEMENTED and changes no state; Confirm, StartAgent and the rest of the
// lifecycle are built in later waves.

import type { ServerDuplexStream } from "@grpc/grpc-js";
import { status } from "@grpc/grpc-js";
import { makeRealmError } from "../../../core/errors.js";
import { DriverStatusError, driverFailureOf, driverUnimplemented, toServerError } from "../grpc-status.js";
import { bearerFromMetadata, type SupervisorBearerVerifier, type SupervisorSession } from "./bearer.js";
import type { BoundaryRegistry } from "./boundary.js";

export interface SandboxProtocolDeps {
  readonly verifier: Pick<SupervisorBearerVerifier, "verify">;
  readonly boundaries: BoundaryRegistry;
}

// The Exchange handler. The stream is ended by this handler after the Attach response, or ended with the failure.
export function exchange(deps: SandboxProtocolDeps): (call: ServerDuplexStream<unknown, unknown>) => void {
  return (call) => {
    serveExchange(call, deps).catch((error: unknown) => {
      call.emit("error", toServerError(driverFailureOf(error)));
    });
  };
}

// The outcome of the bearer check at stream open: the verified session, or the refusal to raise once the frames are read.
type BearerOutcome = { readonly session: SupervisorSession } | { readonly refusal: unknown };

function verifyBearer(call: ServerDuplexStream<unknown, unknown>, deps: SandboxProtocolDeps): BearerOutcome {
  try {
    return { session: deps.verifier.verify(bearerFromMetadata(call.metadata)) };
  } catch (error: unknown) {
    return { refusal: error };
  }
}

// The frames are proto-loader messages with oneofs set: `payload` names the set ExchangeFrame field, and `request` names the
// set RequestEnvelope field.
async function serveExchange(call: ServerDuplexStream<unknown, unknown>, deps: SandboxProtocolDeps): Promise<void> {
  const bearer = verifyBearer(call, deps);
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
  const envelope = requestFrame.request as Readonly<Record<string, unknown>>;
  if (envelope.request !== "attach") {
    throw new DriverStatusError(driverUnimplemented("only Attach is served on the sandbox protocol in this wave"));
  }
  const boundary = deps.boundaries.resolve(handle);
  if (bearer.session.sandboxId !== boundary.gatewaySandboxId || bearer.session.runtimeGeneration !== boundary.generationId) {
    throw new DriverStatusError({
      code: status.UNAUTHENTICATED,
      details: "the supervisor bearer does not match the sandbox of the boundary",
    });
  }
  deps.boundaries.markAttached(handle);
  call.write({
    response: {
      request_id: envelope.request_id,
      attached: { snapshot: { generation: boundary.generationId, processes: [] } },
    },
  });
  call.end();
}

// The next frame of the stream. A stream that ends before the frame is a protocol error.
async function nextFrame(frames: AsyncIterator<unknown>): Promise<Readonly<Record<string, unknown>>> {
  const next = await frames.next();
  if (next.done === true || typeof next.value !== "object" || next.value === null) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  return next.value as Readonly<Record<string, unknown>>;
}

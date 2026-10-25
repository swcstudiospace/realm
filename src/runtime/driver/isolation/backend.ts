// The realm's isolation backend endpoint (phase 9.5, PRD-ISO-01 and T1). It serves the IsolationBackend service and the
// SandboxProtocol service on one authenticated Unix socket. The socket is the only transport boundary: its parent directory
// is the realm account's (0700) and the socket is 0600, under the same rules as the driver's socket (server.ts).
//
// The backend verifies the supervisor's bearer with the verifier its caller provisions (bearer.ts), which the caller builds
// from the gateway public key and gateway id. The backend reads no key itself. Boundary handles live in the driver's
// BoundaryRegistry, which the compute driver shares, so a DeleteSandbox invalidates handles in this process. The resource a
// boundary binds to comes from the driver's own record of the sandbox the verified bearer names (ProvisionedResources).
//
// Describe conveys PeerMetadata only, no credential, and it advertises no optional capability. OpenBoundary is served here.
// SuspendBoundary, ResumeBoundary, and Mediate return UNIMPLEMENTED and change no state. The SandboxProtocol Exchange stream is
// served by protocol.ts.

import { isAbsolute } from "node:path";
import {
  status,
  type Metadata,
  type ServerDuplexStream,
  type ServerUnaryCall,
  type sendUnaryData,
  type ServiceDefinition,
  type UntypedServiceImplementation,
} from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import { makeRealmError } from "../../../core/errors.js";
import { DriverStatusError, driverFailureOf, driverNotFound, driverUnimplemented, toServerError } from "../grpc-status.js";
import { isImplementationVersion, protoIncludeDirectory } from "../compute-driver.js";
import { startSocketServer, type BoundService, type SocketServer } from "../server.js";
import { bearerFromMetadata, type SupervisorBearerVerifier } from "./bearer.js";
import type { BoundaryRegistry, ProvisionedResources } from "./boundary.js";
import { exchange, type SandboxProtocolDeps } from "./protocol.js";

export const ISOLATION_BACKEND_SERVICE_NAME = "openshell.sandbox.backend.v1.IsolationBackend";
export const SANDBOX_PROTOCOL_SERVICE_NAME = "openshell.sandbox.protocol.v1.SandboxProtocol";
const BACKEND_PROTO_FILE = "isolation_backend.proto";
const PROTOCOL_PROTO_FILE = "sandbox_protocol.proto";
const IMPLEMENTATION_NAME = "realm/podman-isolation";
// The base contract this backend speaks. Version 1.0 is the only one, and no optional capability is advertised.
const PROTOCOL_VERSION = Object.freeze({ major: 1, minor: 0 });

// What the driver provisions from the gateway's launch authentication: the verifier of the supervisor's sandbox bearer,
// built from the gateway public key and gateway id by the driver's entry point.
export interface BackendProvisioning {
  readonly verifier: SupervisorBearerVerifier;
}

export interface IsolationBackendOptions {
  readonly socketPath: string;
  readonly implementationVersion: string;
  readonly provisioning: BackendProvisioning;
  readonly boundaries: BoundaryRegistry;
  readonly resources: ProvisionedResources;
}

// Peer metadata as the request carries it. proto-loader delivers keepCase names, and defaults fill absent fields.
interface PeerMetadataIn {
  readonly protocol_version?: { major?: number } | null;
  readonly required_capabilities?: readonly string[];
}

// OpenBoundary as the request carries it. The launch identity is the session; the sandbox and generation come from the bearer.
interface OpenBoundaryIn {
  readonly session_id?: string;
}

// The method maps of both services, loaded from the vendored protos with the pinned loader.
export function loadIsolationServices(): { backend: ServiceDefinition; protocol: ServiceDefinition } {
  const definitions = protoLoader.loadSync([BACKEND_PROTO_FILE, PROTOCOL_PROTO_FILE], {
    includeDirs: [protoIncludeDirectory()],
    keepCase: true,
    defaults: true,
    oneofs: true,
    longs: String,
    enums: String,
  });
  const backend = definitions[ISOLATION_BACKEND_SERVICE_NAME];
  const protocol = definitions[SANDBOX_PROTOCOL_SERVICE_NAME];
  if (backend === undefined || !("Describe" in backend) || protocol === undefined || !("Exchange" in protocol)) {
    throw new Error("isolation services are missing from the vendored protos");
  }
  return { backend, protocol };
}

// Starts the endpoint. The options are checked before the socket is touched; the socket rules are the driver's.
export async function startIsolationBackend(options: IsolationBackendOptions): Promise<SocketServer> {
  if (!isImplementationVersion(options.implementationVersion) || !isAbsolute(options.socketPath)) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  const { backend, protocol } = loadIsolationServices();
  const services: readonly BoundService[] = [
    { service: backend, implementation: isolationBackendImplementation(options) },
    {
      service: protocol,
      implementation: sandboxProtocolImplementation({
        verifier: options.provisioning.verifier,
        boundaries: options.boundaries,
        resources: options.resources,
      }),
    },
  ];
  return startSocketServer(options.socketPath, services);
}

// Negotiates the base contract. A supervisor on another major version, or one that requires a capability this backend
// does not advertise, is refused before any boundary exists.
function describe(supervisor: PeerMetadataIn | null | undefined, implementationVersion: string): Record<string, unknown> {
  const required = supervisor?.required_capabilities ?? [];
  if (supervisor?.protocol_version?.major !== PROTOCOL_VERSION.major || required.length > 0) {
    throw new DriverStatusError({
      code: status.FAILED_PRECONDITION,
      details: "the supervisor's contract is not satisfied by this backend",
    });
  }
  return {
    backend: {
      protocol_version: PROTOCOL_VERSION,
      implementation_name: IMPLEMENTATION_NAME,
      implementation_version: implementationVersion,
      supported_capabilities: [],
      required_capabilities: [],
    },
  };
}

// Binds the sandbox the verified bearer names to the driver's resource for it. The bearer is verified first, and the driver's record
// is read and the handle bound in one synchronous run, so a refused bearer or an unknown sandbox changes no state. Reopening the same
// launch returns the same handle, and a different resource for it fails in the registry. The outcome is always FRESH: the supervisor's
// client accepts no other, and a reopen returns the same result (isolation_backend.proto, OpenBoundary).
function openBoundary(options: IsolationBackendOptions, request: OpenBoundaryIn, metadata: Metadata): Record<string, unknown> {
  const session = options.provisioning.verifier.verify(bearerFromMetadata(metadata));
  const resource = options.resources.provisionedResource(session.sandboxId);
  if (resource === undefined) {
    throw new DriverStatusError(driverNotFound("the sandbox has no provisioned resource"));
  }
  const handle = options.boundaries.open({
    sandboxName: resource.sandboxName,
    gatewaySandboxId: session.sandboxId,
    generationId: session.runtimeGeneration,
    sessionId: request.session_id ?? "",
    resourceId: resource.resourceId,
  });
  return { boundary_id: handle, outcome: "LAUNCH_OUTCOME_FRESH" };
}

function isolationBackendImplementation(options: IsolationBackendOptions): UntypedServiceImplementation {
  return {
    Describe: unaryHandler((request: { supervisor?: PeerMetadataIn | null }) =>
      describe(request.supervisor, options.implementationVersion),
    ),
    OpenBoundary: unaryHandler((request: OpenBoundaryIn, metadata: Metadata) => openBoundary(options, request, metadata)),
    SuspendBoundary: unaryHandler(() => {
      throw unimplemented("SuspendBoundary is not offered (PD-09)");
    }),
    ResumeBoundary: unaryHandler(() => {
      throw unimplemented("ResumeBoundary is not offered (PD-09)");
    }),
  };
}

function sandboxProtocolImplementation(deps: SandboxProtocolDeps): UntypedServiceImplementation {
  return {
    Exchange: exchange(deps),
    Mediate: refuseStream,
  };
}

function unimplemented(details: string): DriverStatusError {
  return new DriverStatusError(driverUnimplemented(details));
}

// Runs a unary handler and maps any throw to its wire status, as the driver's unary binding does. The handler sees the call metadata,
// which carries the supervisor's bearer for OpenBoundary.
function unaryHandler<Req, Res>(
  handle: (request: Req, metadata: Metadata) => Res,
): (call: ServerUnaryCall<Req, Res>, callback: sendUnaryData<Res>) => void {
  return (call, callback) => {
    let response: Res;
    try {
      response = handle(call.request, call.metadata);
    } catch (error: unknown) {
      callback(toServerError(driverFailureOf(error)));
      return;
    }
    callback(null, response);
  };
}

// The mediation stream is refused until it is built. The refusal is a status on the stream.
function refuseStream(call: ServerDuplexStream<unknown, unknown>): void {
  call.emit("error", toServerError(driverFailureOf(unimplemented("the mediation stream is not served yet"))));
}

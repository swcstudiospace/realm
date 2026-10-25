// The realm's isolation backend endpoint (phase 9.5, PRD-ISO-01, T1). It serves the IsolationBackend service and the
// SandboxProtocol service on one authenticated Unix socket. The socket is the only authentication boundary at this
// stage: its parent directory is the realm account's (0700) and the socket is 0600, under the same rules as the driver's
// socket (server.ts). The backend starts only with the verification keys its caller provisions. It reads no key from the
// repository or from a file it writes itself, so a start without provisioning fails closed.
//
// This wave serves Describe and nothing else. Describe conveys PeerMetadata only, no credential, and it advertises no
// optional capability: the sandbox protocol and the suspend/resume capability are not built yet. Every other RPC of both
// services returns UNIMPLEMENTED and changes no lifecycle state. OpenBoundary is held back until the supervisor's bearer
// can be verified against the provisioned keys, because the launch identity it binds comes from that bearer.

import { isAbsolute } from "node:path";
import {
  status,
  type ServerDuplexStream,
  type ServerUnaryCall,
  type sendUnaryData,
  type ServiceDefinition,
  type UntypedServiceImplementation,
} from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import { makeRealmError } from "../../../core/errors.js";
import { DriverStatusError, driverFailureOf, driverUnimplemented, toServerError } from "../grpc-status.js";
import { isImplementationVersion, protoIncludeDirectory } from "../compute-driver.js";
import { startSocketServer, type BoundService, type SocketServer } from "../server.js";

export const ISOLATION_BACKEND_SERVICE_NAME = "openshell.sandbox.backend.v1.IsolationBackend";
export const SANDBOX_PROTOCOL_SERVICE_NAME = "openshell.sandbox.protocol.v1.SandboxProtocol";
const BACKEND_PROTO_FILE = "isolation_backend.proto";
const PROTOCOL_PROTO_FILE = "sandbox_protocol.proto";
const IMPLEMENTATION_NAME = "realm/podman-isolation";
// The base contract this backend speaks. Version 1.0 is the only one, and no optional capability is advertised.
const PROTOCOL_VERSION = Object.freeze({ major: 1, minor: 0 });

// The verification keys the driver provisions from the gateway's launch authentication. They verify the supervisor's
// sandbox bearer; the bearer check that uses them is added with Attach.
export interface BackendProvisioning {
  readonly gatewayId: string;
  readonly verificationKeys: readonly Uint8Array[];
}

export interface IsolationBackendOptions {
  readonly socketPath: string;
  readonly implementationVersion: string;
  readonly provisioning: BackendProvisioning;
}

// Peer metadata as the request carries it. proto-loader delivers keepCase names, and defaults fill absent fields.
interface PeerMetadataIn {
  readonly protocol_version?: { major?: number } | null;
  readonly required_capabilities?: readonly string[];
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

// Starts the endpoint. Options are checked before the socket is touched; the socket rules are the driver's.
export async function startIsolationBackend(options: IsolationBackendOptions): Promise<SocketServer> {
  if (!isImplementationVersion(options.implementationVersion) || !isAbsolute(options.socketPath)) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  checkProvisioning(options.provisioning);
  const { backend, protocol } = loadIsolationServices();
  const services: readonly BoundService[] = [
    { service: backend, implementation: isolationBackendImplementation(options.implementationVersion) },
    { service: protocol, implementation: sandboxProtocolImplementation() },
  ];
  return startSocketServer(options.socketPath, services);
}

// A backend without a gateway identity or a usable verification key could trust nothing, so it does not start.
function checkProvisioning(provisioning: BackendProvisioning): void {
  if (
    provisioning.gatewayId === "" ||
    provisioning.verificationKeys.length === 0 ||
    provisioning.verificationKeys.some((key) => key.length === 0)
  ) {
    throw makeRealmError("SCHEMA_INVALID");
  }
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

function isolationBackendImplementation(implementationVersion: string): UntypedServiceImplementation {
  return {
    Describe: unaryHandler((request: { supervisor?: PeerMetadataIn | null }) =>
      describe(request.supervisor, implementationVersion),
    ),
    OpenBoundary: unaryHandler(() => {
      throw unimplemented("OpenBoundary is not served before the supervisor bearer is verified");
    }),
    SuspendBoundary: unaryHandler(() => {
      throw unimplemented("SuspendBoundary is not offered (PD-09)");
    }),
    ResumeBoundary: unaryHandler(() => {
      throw unimplemented("ResumeBoundary is not offered (PD-09)");
    }),
  };
}

function sandboxProtocolImplementation(): UntypedServiceImplementation {
  return {
    Exchange: refuseStream,
    Mediate: refuseStream,
  };
}

function unimplemented(details: string): DriverStatusError {
  return new DriverStatusError(driverUnimplemented(details));
}

// Runs a unary handler and maps any throw to its wire status, as the driver's unary binding does.
function unaryHandler<Req, Res>(
  handle: (request: Req) => Res,
): (call: ServerUnaryCall<Req, Res>, callback: sendUnaryData<Res>) => void {
  return (call, callback) => {
    try {
      callback(null, handle(call.request));
    } catch (error: unknown) {
      callback(toServerError(driverFailureOf(error)));
    }
  };
}

// Every stream of the sandbox protocol is refused until the protocol is built. The refusal is a status on the stream.
function refuseStream(call: ServerDuplexStream<unknown, unknown>): void {
  call.emit("error", toServerError(driverFailureOf(unimplemented("the sandbox protocol is not served yet"))));
}

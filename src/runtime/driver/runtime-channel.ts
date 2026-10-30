// The built-in runtime channel (phase 9.5, wave 2). The driver builds, from the gateway's launch material and the TLS it
// generates for one sandbox, the bootstrap that the sandbox runtime reads (BoundaryConfig), the descriptor that the host
// supervisor reads (SandboxRuntimeDescriptor), and the supervisor's auth bundle. This module is pure: it builds the documents,
// checks that the bootstrap and the descriptor agree, and returns the arguments and environment of the two processes. Files
// are written by channel.ts and the host supervisor is started by supervisor.ts. Field names follow the runtime's serde types
// (boundary_protocol.rs: BoundaryConfig, SandboxRuntimeDescriptor, BoundaryListener, SandboxTlsServerConfig;
// jwt.rs: SupervisorAuthBundle). Every type rejects an unknown field, so the documents carry exactly those names.
//
// No secret value reaches an argument or the environment. Keys and tokens live in the 0600 files only.

import { createHash } from "node:crypto";
import { makeRealmError } from "../../core/errors.js";
import { HARDENING_PROFILE } from "../hardening.js";
import { BUILTIN_ISOLATION_BACKEND } from "../gateway-config.js";
import { JsonNumber, type JsonValue } from "./isolation/json.js";
import { AUTH_FILE_NAME, DESCRIPTOR_FILE_NAME, MAIN_EXIT_MARKER_NAME } from "./secret-store.js";

// The identity the sandbox process runs as. The user namespace maps the realm account to these ids.
const SANDBOX_IDENTITY_SOURCE = "realm-image-user";
export const CONTAINER_CONTROL_SOCKET = `${HARDENING_PROFILE.channelDestination}/control.sock`;
const CONTAINER_CERTIFICATE_PATH = `${HARDENING_PROFILE.channelDestination}/server.crt`;
const CONTAINER_PRIVATE_KEY_PATH = `${HARDENING_PROFILE.channelDestination}/server.key`;

// A JSON value this module writes. A JsonNumber keeps its digits, so a u64 is written exactly.
export type JsonOut = null | boolean | number | string | JsonNumber | readonly JsonOut[] | { readonly [key: string]: JsonOut };
export type JsonDocument = { readonly [key: string]: JsonOut };

// The supervisor identity of one launch: the fields the bootstrap and the descriptor name, and the bundle the auth file holds.
export interface SupervisorIdentity {
  readonly sessionId: string;
  readonly runtimeGeneration: string;
  // Decimal digits of the u64 values, kept as text so no value is rounded.
  readonly sessionRotation: string;
  readonly authEpoch: string;
  readonly bundle: ReadonlyMap<string, JsonValue>;
  // True when the launch material carries a non-empty ssh_host_private_key. The key itself stays in the bundle; this flag only lets the spawn refuse.
  readonly hasSshHostPrivateKey: boolean;
}

export interface RuntimeVerificationKey {
  readonly keyId: string;
  readonly publicKeyPem: string;
}

export interface RuntimeChannelInput {
  // The gateway's sandbox id: the boundary id.
  readonly sandboxId: string;
  // The container name. It is the resource the boundary binds to, carried as the resource claim.
  readonly containerName: string;
  // The digest-pinned sandbox image reference.
  readonly image: string;
  readonly gatewayId: string;
  readonly supervisor: SupervisorIdentity;
  readonly verificationKeys: readonly RuntimeVerificationKey[];
  // The DNS name the runtime's server certificate carries as its subject alternative name, and the CA that signed it.
  readonly serverName: string;
  readonly trustAnchorPem: string;
  // The host path of the runtime's control socket, as the descriptor's transport names it.
  readonly controlSocketHostPath: string;
  // The sha256 hex digest of the hardening profile the verifier checks (hardeningEvidenceDigest).
  readonly evidenceDigest: string;
}

export interface RuntimeChannel {
  readonly bootstrap: JsonDocument;
  readonly descriptor: JsonDocument;
  readonly auth: string;
}

// The fields the runtime requires the descriptor to share with the bootstrap (isolation_protocol.rs).
const AGREED_FIELDS: readonly string[] = Object.freeze([
  "boundary_id",
  "generation",
  "session_id",
  "workload_identity",
  "resource_claims",
  "provisioning_evidence",
]);

// The name the runtime's server certificate carries for one session. It is a DNS name: "sandbox.<session>.openshell.internal".
export function runtimeServerName(sessionId: string): string {
  return `sandbox.${sessionId}.openshell.internal`;
}

// Builds the bootstrap and the descriptor, and the auth bundle text. Pure: nothing is written.
export function buildRuntimeChannel(input: RuntimeChannelInput): RuntimeChannel {
  const { supervisor } = input;
  const workloadIdentity: JsonDocument = {
    uid: HARDENING_PROFILE.workloadUid,
    gid: HARDENING_PROFILE.workloadGid,
    supplementary_gids: [],
    source: SANDBOX_IDENTITY_SOURCE,
    resource_digest: sha256Hex(input.image),
  };
  const resourceClaims: JsonDocument = { container: input.containerName };
  const provisioningEvidence: JsonDocument = {
    generation: supervisor.runtimeGeneration,
    evidence_digest: input.evidenceDigest,
  };
  const bootstrap: JsonDocument = {
    boundary_id: input.sandboxId,
    generation: supervisor.runtimeGeneration,
    session_id: supervisor.sessionId,
    session_rotation: new JsonNumber(supervisor.sessionRotation),
    auth_epoch: new JsonNumber(supervisor.authEpoch),
    gateway_id: input.gatewayId,
    verification_keys: input.verificationKeys.map((key) => ({ key_id: key.keyId, public_key_pem: key.publicKeyPem })),
    listener: {
      kind: "unix",
      socket_path: CONTAINER_CONTROL_SOCKET,
      tls: { certificate_chain_path: CONTAINER_CERTIFICATE_PATH, private_key_path: CONTAINER_PRIVATE_KEY_PATH },
    },
    resource_claims: resourceClaims,
    workload_identity: workloadIdentity,
    provisioning_evidence: provisioningEvidence,
  };
  const descriptor: JsonDocument = {
    boundary_id: input.sandboxId,
    generation: supervisor.runtimeGeneration,
    session_id: supervisor.sessionId,
    transport: { kind: "unix", socket_path: input.controlSocketHostPath },
    tls: { server_name: input.serverName, trust_anchor_pem: input.trustAnchorPem },
    workload_identity: workloadIdentity,
    resource_claims: resourceClaims,
    provisioning_evidence: provisioningEvidence,
  };
  return { bootstrap, descriptor, auth: authBundleText(supervisor.bundle) };
}

// Refuses a bootstrap and a descriptor that do not agree on the fields the runtime checks. The refusal names no value.
export function assertRuntimeFilesAgree(bootstrap: JsonDocument, descriptor: JsonDocument): void {
  for (const field of AGREED_FIELDS) {
    const left = bootstrap[field];
    const right = descriptor[field];
    if (left === undefined || right === undefined || serializeJson(left) !== serializeJson(right)) {
      throw makeRealmError("SCHEMA_INVALID");
    }
  }
}

// The argv of the host supervisor: the paths of its files and the gateway identity of the sandbox. It holds no key or token.
export function supervisorArguments(options: {
  readonly sandboxId: string;
  readonly sandboxName: string;
  readonly gatewayEndpoint: string;
  readonly secretDir: string;
  readonly sshSocketPath: string;
}): readonly string[] {
  return [
    "--role",
    "isolation-backend",
    "--sandbox-id",
    options.sandboxId,
    "--sandbox",
    options.sandboxName,
    "--openshell-endpoint",
    options.gatewayEndpoint,
    "--ssh-socket-path",
    options.sshSocketPath,
    "--backend-descriptor-file",
    `${options.secretDir}/${DESCRIPTOR_FILE_NAME}`,
    "--auth-bundle-file",
    `${options.secretDir}/${AUTH_FILE_NAME}`,
    "--main-exit-marker",
    `${options.secretDir}/${MAIN_EXIT_MARKER_NAME}`,
    "--parent-liveness-stdin",
  ];
}

// The environment of the host supervisor. It names the admitted backend, the sandbox, the gateway, the gateway CA path and the
// image. It holds no secret value: the CA is a certificate path and the keys and tokens stay in the 0600 files.
export function supervisorEnvironment(options: {
  readonly sandboxId: string;
  readonly sandboxName: string;
  readonly gatewayEndpoint: string;
  readonly gatewayCaPath: string;
  readonly image: string;
}): Readonly<Record<string, string>> {
  return {
    OPENSHELL_ADMITTED_ISOLATION_BACKEND: BUILTIN_ISOLATION_BACKEND,
    OPENSHELL_SANDBOX_ID: options.sandboxId,
    OPENSHELL_SANDBOX: options.sandboxName,
    OPENSHELL_ENDPOINT: options.gatewayEndpoint,
    OPENSHELL_TLS_CA: options.gatewayCaPath,
    OPENSHELL_CONTAINER_IMAGE: options.image,
  };
}

// The text of a document in compact JSON. Object keys keep their insertion order, and a JsonNumber is written as its digits.
export function serializeJson(value: JsonOut | undefined): string {
  if (value === undefined) {
    return "";
  }
  if (value instanceof JsonNumber) {
    return value.text;
  }
  if (Array.isArray(value)) {
    return `[${value.map((item: JsonOut) => serializeJson(item)).join(",")}]`;
  }
  if (typeof value === "object" && value !== null) {
    const members = Object.entries(value).map(([key, member]) => `${JSON.stringify(key)}:${serializeJson(member)}`);
    return `{${members.join(",")}}`;
  }
  return JSON.stringify(value);
}

// The supervisor auth bundle as JSON. The bundle has exactly the fields the gateway wrote. An optional field the gateway left null
// is omitted, which an Option reads as absent.
function authBundleText(bundle: ReadonlyMap<string, JsonValue>): string {
  return serializeJson(toJsonOut(bundle));
}

function toJsonOut(value: JsonValue): JsonOut {
  if (value instanceof Map) {
    const object: Record<string, JsonOut> = {};
    for (const [key, member] of value as ReadonlyMap<string, JsonValue>) {
      if (member !== null) {
        object[key] = toJsonOut(member);
      }
    }
    return object;
  }
  if (Array.isArray(value)) {
    return value.map((item: JsonValue) => toJsonOut(item));
  }
  return value as JsonOut;
}

function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

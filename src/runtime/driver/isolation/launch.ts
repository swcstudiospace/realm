// The gateway's launch authentication for one sandbox (phase 9.5, wave 1d). The gateway sends it on CreateSandbox as the bytes of
// serde_json::to_vec(SandboxLaunchAuthentication) (crates/openshell-core/src/jwt.rs; the gateway encodes it in
// crates/openshell-server/src/grpc/sandbox.rs). The driver decodes it with the gateway's own rules: UTF-8 JSON, unknown fields
// refused (deny_unknown_fields at each level), every required field present, and the checks of
// SandboxLaunchAuthentication::validate and of the field types. Each verification key's PEM text is a JSON array of bytes
// (serde Vec<u8>).
//
// Only the gateway id and the verification keys leave this module for the isolation backend. The supervisor and gateway tokens
// stay in the stored bytes, and this module never returns them.

import { makeRealmError } from "../../../core/errors.js";
import type { VerificationKey } from "./bearer.js";
import { parseVerificationKeys } from "./bearer.js";

const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const NIL_SESSION_ID = "00000000-0000-0000-0000-000000000000";
const GENERATION_PATTERN = /^[a-z0-9-]{1,64}$/;
const WHITESPACE_PATTERN = /\s/;
const TOP_LEVEL_FIELDS: readonly string[] = Object.freeze(["supervisor", "gateway_id", "verification_keys"]);
const SUPERVISOR_FIELDS: readonly string[] = Object.freeze([
  "session_id",
  "runtime_generation",
  "session_rotation",
  "auth_epoch",
  "gateway_token",
  "gateway_expires_at",
  "sandbox_token",
  "sandbox_expires_at",
]);
// The optional supervisor fields. The gateway omits them when unset; null is the same as absent for an Option.
const OPTIONAL_SUPERVISOR_FIELDS: readonly string[] = Object.freeze(["ssh_host_private_key", "ocsf_otlp_headers"]);
const KEY_FIELDS: readonly string[] = Object.freeze(["key_id", "public_key_pem"]);

type Fields = Readonly<Record<string, unknown>>;

// The part of a launch body the driver keeps: the gateway id it was issued for, and the keys the bearer check verifies with.
export interface LaunchAuthentication {
  readonly gatewayId: string;
  readonly verificationKeys: readonly VerificationKey[];
}

// Decodes and validates one launch body for the gateway the driver is pinned to. Every refusal is SCHEMA_INVALID, and names no
// value, so no token or key reaches a log.
export function decodeLaunchAuthentication(body: Uint8Array, gatewayId: string): LaunchAuthentication {
  const root = parseObject(body);
  requireFields(root, TOP_LEVEL_FIELDS, []);
  checkSupervisor(asObject(root["supervisor"]));
  const issuedFor = textField(root, "gateway_id");
  if (!isIdentifier(issuedFor) || issuedFor !== gatewayId) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  const verificationKeys = keysField(root);
  parseVerificationKeys(verificationKeys);
  return { gatewayId: issuedFor, verificationKeys };
}

// Checks the supervisor bundle: the field types, SupervisorAuthBundle::validate (non-negative lifetimes, a valid runtime
// generation, a non-zero session rotation), and the session id and token rules the gateway applies while deserializing.
function checkSupervisor(supervisor: Fields): void {
  requireFields(supervisor, SUPERVISOR_FIELDS, OPTIONAL_SUPERVISOR_FIELDS);
  const sessionId = textField(supervisor, "session_id");
  if (!SESSION_ID_PATTERN.test(sessionId) || sessionId === NIL_SESSION_ID) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  if (!GENERATION_PATTERN.test(textField(supervisor, "runtime_generation"))) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  if (integerField(supervisor, "session_rotation") < 1) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  integerField(supervisor, "auth_epoch");
  for (const name of ["gateway_token", "sandbox_token"]) {
    const token = textField(supervisor, name);
    if (token === "" || WHITESPACE_PATTERN.test(token)) {
      throw makeRealmError("SCHEMA_INVALID");
    }
  }
  integerField(supervisor, "gateway_expires_at");
  integerField(supervisor, "sandbox_expires_at");
  for (const name of OPTIONAL_SUPERVISOR_FIELDS) {
    const value = supervisor[name];
    if (value !== undefined && value !== null && typeof value !== "string") {
      throw makeRealmError("SCHEMA_INVALID");
    }
  }
}

// The verification keys: a non-empty array of distinct key ids, each with a PEM body given as bytes.
function keysField(root: Fields): VerificationKey[] {
  const entries: unknown = root["verification_keys"];
  if (!Array.isArray(entries) || entries.length === 0) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  const keyIds = new Set<string>();
  return entries.map((entry: unknown) => {
    const key = asObject(entry);
    requireFields(key, KEY_FIELDS, []);
    const keyId = textField(key, "key_id");
    if (!isIdentifier(keyId) || keyIds.has(keyId)) {
      throw makeRealmError("SCHEMA_INVALID");
    }
    keyIds.add(keyId);
    return { keyId, publicKeyPem: bytesField(key, "public_key_pem") };
  });
}

// The body as one JSON object. Invalid UTF-8 and any text that is not a JSON object are refused.
function parseObject(body: Uint8Array): Fields {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
  } catch {
    throw makeRealmError("SCHEMA_INVALID");
  }
  return asObject(value);
}

function asObject(value: unknown): Fields {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  return value as Fields;
}

function textField(record: Fields, name: string): string {
  const value = record[name];
  if (typeof value !== "string") {
    throw makeRealmError("SCHEMA_INVALID");
  }
  return value;
}

// A JSON integer that fits a JavaScript safe integer and is not negative: the gateway's u64 and i64 fields.
function integerField(record: Fields, name: string): number {
  const value = record[name];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  return value;
}

// A non-empty JSON array of byte values, as the PEM text of a key.
function bytesField(record: Fields, name: string): Uint8Array {
  const value: unknown = record[name];
  if (!Array.isArray(value) || value.length === 0) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  const bytes = value.map((item: unknown) => {
    if (typeof item !== "number" || !Number.isInteger(item) || item < 0 || item > 255) {
      throw makeRealmError("SCHEMA_INVALID");
    }
    return item;
  });
  return Uint8Array.from(bytes);
}

// Every required field present, and no field outside the required and optional sets.
function requireFields(record: Fields, required: readonly string[], optional: readonly string[]): void {
  for (const name of required) {
    if (!Object.hasOwn(record, name)) {
      throw makeRealmError("SCHEMA_INVALID");
    }
  }
  for (const name of Object.keys(record)) {
    if (!required.includes(name) && !optional.includes(name)) {
      throw makeRealmError("SCHEMA_INVALID");
    }
  }
}

// The gateway's identifier rule (validate_gateway_id and validate_key_id): non-empty, no surrounding or inner whitespace.
function isIdentifier(text: string): boolean {
  return text !== "" && text.trim() === text && !WHITESPACE_PATTERN.test(text);
}

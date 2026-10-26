// The gateway's launch authentication for one sandbox (phase 9.5, wave 1d). The gateway sends it on CreateSandbox, in the spec of
// the driver sandbox, as the bytes of serde_json::to_vec(SandboxLaunchAuthentication) (crates/openshell-core/src/jwt.rs; the
// gateway encodes it in crates/openshell-server/src/compute/mod.rs). The driver decodes it with the gateway's own rules: one strict
// JSON document (json.ts), unknown fields refused (deny_unknown_fields at each level), every required field present, the integer
// ranges of the Rust types, and the checks of SandboxLaunchAuthentication::validate. Each verification key's PEM text is a JSON
// array of bytes (serde Vec<u8>).
//
// Only the gateway id and the verification keys leave this module for the isolation backend. The supervisor and gateway tokens
// stay in the stored bytes, and this module never returns them. Every refusal is SCHEMA_INVALID, logged by check name (refusal.ts),
// and names no value.

import { parseVerificationKeys, type VerificationKey } from "./bearer.js";
import { integerOf, parseJsonDocument, type JsonValue } from "./json.js";
import { refusal, type RefusalCheck, type RefusalScope } from "../refusal.js";

const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const NIL_SESSION_ID = "00000000-0000-0000-0000-000000000000";
const GENERATION_PATTERN = /^[a-z0-9-]{1,64}$/;
// The gateway tests whitespace with Rust's char::is_whitespace, which is the Unicode White_Space property. JavaScript's \s is a
// different set (it holds U+FEFF and not U+0085), so the White_Space property is named here.
const WHITE_SPACE = /\p{White_Space}/u;
// The Rust integer types the launch fields use: a u64 for the rotation and the epoch, an i64 for the token lifetimes.
const U64_MAX = (1n << 64n) - 1n;
const I64_MIN = -(1n << 63n);
const I64_MAX = (1n << 63n) - 1n;
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

type Record = ReadonlyMap<string, JsonValue>;

// The part of a launch body the driver keeps: the gateway id it was issued for, and the keys the bearer check verifies with.
export interface LaunchAuthentication {
  readonly gatewayId: string;
  readonly verificationKeys: readonly VerificationKey[];
}

// Decodes and validates one launch body for the gateway the driver is pinned to. Every refusal is SCHEMA_INVALID, logged with the
// scope's RPC and the check that refused, and names no value, so no token or key reaches a log.
export function decodeLaunchAuthentication(body: Uint8Array, gatewayId: string, scope: RefusalScope): LaunchAuthentication {
  return new LaunchDecoder(scope).decode(body, gatewayId);
}

class LaunchDecoder {
  constructor(private readonly scope: RefusalScope) {}

  decode(body: Uint8Array, gatewayId: string): LaunchAuthentication {
    const root = this.objectOf(parseJsonDocument(body), "launch.json");
    this.requireFields(root, TOP_LEVEL_FIELDS, [], "launch.fields");
    this.checkSupervisor(this.objectOf(root.get("supervisor"), "launch.supervisor"));
    const issuedFor = this.text(root, "gateway_id", "launch.gateway_id");
    if (!isIdentifier(issuedFor) || issuedFor !== gatewayId) {
      this.refuse("launch.gateway_id");
    }
    const verificationKeys = this.keysOf(root);
    try {
      parseVerificationKeys(verificationKeys);
    } catch {
      this.refuse("launch.key_material");
    }
    return { gatewayId: issuedFor, verificationKeys };
  }

  // The supervisor bundle: the field types, SupervisorAuthBundle::validate (non-negative lifetimes, a valid runtime generation, a
  // non-zero session rotation), and the session id and token rules the gateway applies while deserializing.
  private checkSupervisor(supervisor: Record): void {
    this.requireFields(supervisor, SUPERVISOR_FIELDS, OPTIONAL_SUPERVISOR_FIELDS, "launch.supervisor");
    const sessionId = this.text(supervisor, "session_id", "launch.session_id");
    if (!SESSION_ID_PATTERN.test(sessionId) || sessionId === NIL_SESSION_ID) {
      this.refuse("launch.session_id");
    }
    if (!GENERATION_PATTERN.test(this.text(supervisor, "runtime_generation", "launch.runtime_generation"))) {
      this.refuse("launch.runtime_generation");
    }
    if (this.integer(supervisor, "session_rotation", "launch.session_rotation", 0n, U64_MAX) < 1n) {
      this.refuse("launch.session_rotation");
    }
    this.integer(supervisor, "auth_epoch", "launch.auth_epoch", 0n, U64_MAX);
    for (const name of ["gateway_token", "sandbox_token"]) {
      const token = this.text(supervisor, name, "launch.token");
      if (token === "" || WHITE_SPACE.test(token)) {
        this.refuse("launch.token");
      }
    }
    for (const name of ["gateway_expires_at", "sandbox_expires_at"]) {
      if (this.integer(supervisor, name, "launch.expires_at", I64_MIN, I64_MAX) < 0n) {
        this.refuse("launch.expires_at");
      }
    }
    for (const name of OPTIONAL_SUPERVISOR_FIELDS) {
      const value = supervisor.get(name);
      if (value !== undefined && value !== null && typeof value !== "string") {
        this.refuse("launch.supervisor");
      }
    }
  }

  // The verification keys: a non-empty array of distinct key ids, each with a PEM body given as bytes.
  private keysOf(root: Record): VerificationKey[] {
    const entries = root.get("verification_keys");
    if (!isArray(entries) || entries.length === 0) {
      this.refuse("launch.verification_keys");
    }
    const keyIds = new Set<string>();
    return entries.map((entry) => {
      const key = this.objectOf(entry, "launch.verification_keys");
      this.requireFields(key, KEY_FIELDS, [], "launch.verification_keys");
      const keyId = this.text(key, "key_id", "launch.key_id");
      if (!isIdentifier(keyId) || keyIds.has(keyId)) {
        this.refuse("launch.key_id");
      }
      keyIds.add(keyId);
      return { keyId, publicKeyPem: this.bytes(key, "public_key_pem") };
    });
  }

  private objectOf(value: JsonValue | undefined, check: RefusalCheck): Record {
    if (!isObject(value)) {
      this.refuse(check);
    }
    return value;
  }

  private text(record: Record, name: string, check: RefusalCheck): string {
    const value = record.get(name);
    if (typeof value !== "string") {
      this.refuse(check);
    }
    return value;
  }

  // An integer field of the given Rust range. A fraction, an exponent, or a value outside the range is refused.
  private integer(record: Record, name: string, check: RefusalCheck, min: bigint, max: bigint): bigint {
    const value = integerOf(record.get(name));
    if (value === undefined || value < min || value > max) {
      this.refuse(check);
    }
    return value;
  }

  // A non-empty JSON array of byte values, as the PEM text of a key.
  private bytes(record: Record, name: string): Uint8Array {
    const value = record.get(name);
    if (!isArray(value) || value.length === 0) {
      this.refuse("launch.key_bytes");
    }
    return Uint8Array.from(
      value.map((item) => {
        const byte = integerOf(item);
        if (byte === undefined || byte < 0n || byte > 255n) {
          this.refuse("launch.key_bytes");
        }
        return Number(byte);
      }),
    );
  }

  // Every required field present, and no field outside the required and optional sets.
  private requireFields(record: Record, required: readonly string[], optional: readonly string[], check: RefusalCheck): void {
    for (const name of required) {
      if (!record.has(name)) {
        this.refuse(check);
      }
    }
    for (const name of record.keys()) {
      if (!required.includes(name) && !optional.includes(name)) {
        this.refuse(check);
      }
    }
  }

  private refuse(check: RefusalCheck): never {
    throw refusal(this.scope, check);
  }
}

// The gateway's identifier rule (validate_gateway_id and validate_key_id): non-empty, and no whitespace anywhere. A leading or trailing
// whitespace character is refused by the gateway's trim comparison, so the two rules are one.
function isIdentifier(text: string): boolean {
  return text !== "" && !WHITE_SPACE.test(text);
}

function isObject(value: JsonValue | undefined): value is Record {
  return value instanceof Map;
}

function isArray(value: JsonValue | undefined): value is readonly JsonValue[] {
  return Array.isArray(value);
}

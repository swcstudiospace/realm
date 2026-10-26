// Gateway configuration renderer for the OpenShell gateway (phase 9.1 T7; phase 9.5 selects the built-in runtime). The module is
// pure: no file system, no process.env, no network. It derives the PKI layout written by `openshell-gateway generate-certs` and
// renders the gateway TOML that Realm hands to the gateway binary. Every input is validated before it is written, and each value
// is refused rather than escaped, so the rendered TOML equals the input text. A refused value throws SCHEMA_INVALID.
//
// The driver runs the sandbox runtime that ships in the image (openshell-sandbox), so the gateway selects the built-in backend by its
// reserved name. The gateway registers no isolation backend for that name: its driver table names the selection, and no supervisor
// section is rendered.

import { isAbsolute, posix } from "node:path";
import { isIP } from "node:net";
import { makeRealmError, type RealmError } from "../core/errors.js";

export interface RealmGatewayPkiPaths {
  readonly serverCert: string;
  readonly serverKey: string;
  readonly clientCert: string;
  readonly clientKey: string;
  readonly caCert: string;
  readonly jwtSigningKey: string;
  readonly jwtPublicKey: string;
  readonly jwtKid: string;
}

export interface RealmGatewayInput {
  readonly bindAddress: string;
  readonly gatewayId: string;
  readonly computeDriver: string;
  readonly driverSocketPath: string;
  readonly pkiDir: string;
}

// The reserved selection name of the built-in sandbox runtime. The gateway accepts it for a driver and registers nothing for it.
export const BUILTIN_ISOLATION_BACKEND = "openshell-sandbox";

export const GATEWAY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const COMPUTE_DRIVER_PATTERN = /^[a-z][a-z0-9-]{0,62}$/;
// Either a bracketed IPv6 literal or a bare IPv4 literal, then a decimal port. A bare host with a colon
// fails here, so an unbracketed IPv6 address is refused.
const BIND_ADDRESS_PATTERN = /^(?:\[([^[\]]+)\]|([^:[\]]+)):([0-9]{1,5})$/;
const PORT_PATTERN = /^[1-9][0-9]{0,4}$/;
const MAX_PORT = 65535;

function invalid(): RealmError {
  return makeRealmError("SCHEMA_INVALID");
}

// Reads one field of the input object. A missing object or a non-object input fails closed.
function fieldOf(source: unknown, key: keyof RealmGatewayInput): unknown {
  if (typeof source !== "object" || source === null) {
    throw invalid();
  }
  return (source as Record<string, unknown>)[key];
}

function checkToken(value: unknown, pattern: RegExp): string {
  if (typeof value !== "string" || !pattern.test(value)) {
    throw invalid();
  }
  return value;
}

// IPv4 "a.b.c.d:port" or IPv6 "[addr]:port". The host must be an IP literal of the matching family.
function checkBindAddress(value: unknown): string {
  if (typeof value !== "string") {
    throw invalid();
  }
  const match = BIND_ADDRESS_PATTERN.exec(value);
  if (match === null) {
    throw invalid();
  }
  const bracketed = match[1] !== undefined;
  const host = match[1] ?? match[2] ?? "";
  const port = match[3] ?? "";
  const family = isIP(host);
  if (bracketed ? family !== 6 : family !== 4) {
    throw invalid();
  }
  if (!PORT_PATTERN.test(port) || Number(port) > MAX_PORT) {
    throw invalid();
  }
  return value;
}

// An absolute path with no ".." segment and no character that the TOML basic string would need escaped:
// double quote, backslash, or a control character (U+0000 to U+001F, U+007F).
function checkPath(value: unknown): string {
  if (typeof value !== "string" || !isAbsolute(value)) {
    throw invalid();
  }
  if (value.split("/").includes("..")) {
    throw invalid();
  }
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f || code === 0x22 || code === 0x5c) {
      throw invalid();
    }
  }
  return value;
}

// The PKI layout that `openshell-gateway generate-certs --output-dir DIR` writes. ca.key is not returned:
// the gateway configuration never refers to it.
export function realmGatewayPkiPaths(pkiDir: string): RealmGatewayPkiPaths {
  const dir = checkPath(pkiDir);
  return Object.freeze({
    serverCert: posix.join(dir, "server", "tls.crt"),
    serverKey: posix.join(dir, "server", "tls.key"),
    clientCert: posix.join(dir, "client", "tls.crt"),
    clientKey: posix.join(dir, "client", "tls.key"),
    caCert: posix.join(dir, "ca.crt"),
    jwtSigningKey: posix.join(dir, "jwt", "signing.pem"),
    jwtPublicKey: posix.join(dir, "jwt", "public.pem"),
    jwtKid: posix.join(dir, "jwt", "kid"),
  });
}

// Renders the gateway TOML. The key order and the blank line between tables are fixed. The output ends with one LF, and it
// never contains disable_tls: the listener always runs TLS with client verification.
//
// The compute driver's table selects the built-in backend. The output has no supervisor section: the built-in backend needs no
// registration, so no [[openshell.supervisor.isolation_backends]] entry is written.
export function renderRealmGatewayConfig(input: RealmGatewayInput): string {
  const source: unknown = input;
  const bindAddress = checkBindAddress(fieldOf(source, "bindAddress"));
  const gatewayId = checkToken(fieldOf(source, "gatewayId"), GATEWAY_ID_PATTERN);
  const computeDriver = checkToken(fieldOf(source, "computeDriver"), COMPUTE_DRIVER_PATTERN);
  const driverSocketPath = checkPath(fieldOf(source, "driverSocketPath"));
  const pki = realmGatewayPkiPaths(checkPath(fieldOf(source, "pkiDir")));

  const lines = [
    "[openshell]",
    "version = 2",
    "",
    "[openshell.gateway]",
    `compute_driver = "${computeDriver}"`,
    `bind_address = "${bindAddress}"`,
    `guest_tls_ca = "${pki.caCert}"`,
    "",
    "[openshell.gateway.tls]",
    `cert_path = "${pki.serverCert}"`,
    `key_path = "${pki.serverKey}"`,
    `client_ca_path = "${pki.caCert}"`,
    "",
    "[openshell.gateway.gateway_jwt]",
    `signing_key_path = "${pki.jwtSigningKey}"`,
    `public_key_path = "${pki.jwtPublicKey}"`,
    `kid_path = "${pki.jwtKid}"`,
    `gateway_id = "${gatewayId}"`,
    "",
    `[openshell.drivers.${computeDriver}]`,
    `socket_path = "${driverSocketPath}"`,
    `isolation_backend = "${BUILTIN_ISOLATION_BACKEND}"`,
  ];
  return `${lines.join("\n")}\n`;
}

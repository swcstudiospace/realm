// RuntimeConfig type and load-time validation (RT-01, D-52, D-73). The checks are hand-written:
// no schema file and no ajv (D-73). The loader reads no environment. Phase 3 supplies no
// default image; the caller and the gated suite provide it.
// Numeric limits live only in HARDENING_PROFILE (src/runtime/hardening.ts) and in the backoff
// defaults, never here.

import { isAbsolute, join } from "node:path";
import { makeRealmError } from "../core/errors.js";

export interface RuntimeConfig {
  // Digest-pinned image reference (D-52). A tag-only reference is rejected at load.
  readonly image: string;
  // Anda Engine base URL. Absent when no Anda engine is configured (the doctor reports that).
  readonly andaUrl?: string;
  readonly stateDir: string;
  readonly workspaceRoot: string;
  // Optional. Absent means <stateDir>/secrets (runtimeRootsOf). A relative value is SCHEMA_INVALID.
  readonly secretRoot?: string;
  // Optional. Absent means <stateDir>/sandboxes (runtimeRootsOf). A relative value is SCHEMA_INVALID.
  readonly sandboxStateRoot?: string;
}

export interface RuntimeRoots {
  readonly secretRoot: string;
  readonly workspaceRoot: string;
  readonly sandboxStateRoot: string;
}

const IMAGE_PATTERN = /^[a-z0-9][a-z0-9._/-]*@sha256:[a-f0-9]{64}$/;

// Scheme and an authority that contains "@": any userinfo, even an empty one, is refused.
const USERINFO_PATTERN = /^[a-z][a-z0-9+.-]*:\/\/[^/?#]*@/i;
const ACCEPTED_KEYS: Readonly<Record<string, true>> = {
  image: true,
  andaUrl: true,
  stateDir: true,
  workspaceRoot: true,
  secretRoot: true,
  sandboxStateRoot: true,
};

// D-80: host networking and driver escape. The closed key set refuses these too; naming them here
// makes the refusal explicit in the code and in the tests.
const DENIED_KEYS: Readonly<Record<string, true>> = {
  network: true,
  networkMode: true,
  hostNetwork: true,
  netns: true,
  driverConfig: true,
  driverConfigJson: true,
};

// Validates an untrusted input object and returns a frozen RuntimeConfig. Any violation throws
// a RealmError with SCHEMA_INVALID. The error names no field value, so no secret reaches a log.
export function loadRuntimeConfig(input: unknown): RuntimeConfig {
  const record = plainRecord(input);
  for (const key of Object.keys(record)) {
    // D-80: the named refusal for host-network and driver-escape keys, checked before the closed key set.
    if (Object.hasOwn(DENIED_KEYS, key)) {
      reject();
    }
    if (!Object.hasOwn(ACCEPTED_KEYS, key)) {
      reject();
    }
  }

  const image = requireImage(record["image"]);
  const stateDir = requireAbsolutePath(record["stateDir"]);
  const workspaceRoot = requireAbsolutePath(record["workspaceRoot"]);
  const secretRoot = record["secretRoot"] === undefined ? undefined : requireAbsolutePath(record["secretRoot"]);
  const sandboxStateRoot = record["sandboxStateRoot"] === undefined ? undefined : requireAbsolutePath(record["sandboxStateRoot"]);
  const andaUrl = record["andaUrl"] === undefined ? undefined : requireAndaUrl(record["andaUrl"]);
  return Object.freeze({
    image,
    stateDir,
    workspaceRoot,
    ...(andaUrl === undefined ? {} : { andaUrl }),
    ...(secretRoot === undefined ? {} : { secretRoot }),
    ...(sandboxStateRoot === undefined ? {} : { sandboxStateRoot }),
  });
}

// The Anda bridge is required exactly when an Anda Engine URL is configured (C4). Without one, a
// session starts with no bridge and no handshake, and exec and write run on an active session. The
// guard narrows andaUrl to a string for the caller that builds the bridge.
export function andaBridgeRequired(
  config: RuntimeConfig,
): config is RuntimeConfig & { readonly andaUrl: string } {
  return config.andaUrl !== undefined;
}

// The three roots the daemon and the driver share. secretRoot and sandboxStateRoot default under stateDir when the
// config omits them. workspaceRoot is required on the config. A stale REALM_DRIVER_*_ROOT variable is not consulted.
export function runtimeRootsOf(config: RuntimeConfig): RuntimeRoots {
  return {
    secretRoot: config.secretRoot ?? join(config.stateDir, "secrets"),
    workspaceRoot: config.workspaceRoot,
    sandboxStateRoot: config.sandboxStateRoot ?? join(config.stateDir, "sandboxes"),
  };
}

function reject(): never {
  throw makeRealmError("SCHEMA_INVALID");
}

function plainRecord(input: unknown): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    reject();
  }
  return input as Record<string, unknown>;
}

function requireImage(value: unknown): string {
  if (typeof value !== "string" || !IMAGE_PATTERN.test(value)) {
    reject();
  }
  return value;
}

// D-73: a relative state directory or workspace root is SCHEMA_INVALID.
function requireAbsolutePath(value: unknown): string {
  if (typeof value !== "string" || !isAbsolute(value)) {
    reject();
  }
  return value;
}

function requireAndaUrl(value: unknown): string {
  if (typeof value !== "string") {
    reject();
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    reject();
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    reject();
  }
  if (url.username !== "" || url.password !== "" || USERINFO_PATTERN.test(value)) {
    reject();
  }
  return value;
}

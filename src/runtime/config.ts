// RuntimeConfig type and load-time validation (RT-01, D-52, D-73). The checks are hand-written:
// no schema file and no ajv (D-73). The loader reads no environment. Phase 3 supplies no
// default image and no default workload; the caller and the gated suite provide them.
// Numeric limits live only in HARDENING_PROFILE (src/runtime/hardening.ts) and in the backoff
// defaults, never here.

import { isAbsolute } from "node:path";
import { makeRealmError } from "../core/errors.js";

export interface RuntimeConfig {
  // Digest-pinned image reference (D-52). A tag-only reference is rejected at load.
  readonly image: string;
  // Anda Engine base URL. Absent when no Anda engine is configured (the doctor reports that).
  readonly andaUrl?: string;
  readonly workloadArgv: readonly string[];
  readonly stateDir: string;
  readonly workspaceRoot: string;
}

const IMAGE_PATTERN = /^[a-z0-9][a-z0-9._/-]*@sha256:[a-f0-9]{64}$/;

// Scheme and an authority that contains "@": any userinfo, even an empty one, is refused.
const USERINFO_PATTERN = /^[a-z][a-z0-9+.-]*:\/\/[^/?#]*@/i;
const ACCEPTED_KEYS: Readonly<Record<string, true>> = {
  image: true,
  andaUrl: true,
  workloadArgv: true,
  stateDir: true,
  workspaceRoot: true,
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
  const workloadArgv = requireArgv(record["workloadArgv"]);
  const stateDir = requireAbsolutePath(record["stateDir"]);
  const workspaceRoot = requireAbsolutePath(record["workspaceRoot"]);

  if (record["andaUrl"] === undefined) {
    return Object.freeze({ image, workloadArgv, stateDir, workspaceRoot });
  }
  const andaUrl = requireAndaUrl(record["andaUrl"]);
  return Object.freeze({ image, andaUrl, workloadArgv, stateDir, workspaceRoot });
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

// A non-empty array of non-empty strings whose first element is an absolute path (D-79). The copy
// means later changes to the caller's array cannot alter the loaded config.
function requireArgv(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length === 0) {
    reject();
  }
  const argv: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || item.length === 0) {
      reject();
    }
    argv.push(item);
  }
  // D-79: argv[0] must be an absolute path. An OpenShell network rule matches the executable by
  // path, and an empty binaries list matches nothing.
  if (!isAbsolute(argv[0] ?? "")) {
    reject();
  }
  return Object.freeze(argv);
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
  const url = parseUrl(value);
  if (url === undefined || (url.protocol !== "http:" && url.protocol !== "https:")) {
    reject();
  }
  if (url.username !== "" || url.password !== "" || USERINFO_PATTERN.test(value)) {
    reject();
  }
  return value;
}

function parseUrl(text: string): URL | undefined {
  try {
    return new URL(text);
  } catch {
    return undefined;
  }
}

// RuntimeConfig type and load-time validation (RT-01, D-52, D-73). The checks are hand-written:
// no schema file and no ajv (D-73). The loader reads no environment. Phase 3 supplies no
// default image; the caller and the gated suite provide it.
// Numeric limits live only in HARDENING_PROFILE (src/runtime/hardening.ts) and in the backoff
// defaults, never here.

import { isAbsolute, join, relative, sep } from "node:path";
import { makeRealmError } from "../core/errors.js";

export interface RuntimeConfig {
  // Digest-pinned image reference (D-52). A tag-only reference is rejected at load.
  readonly image: string;
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
  readonly stateDir: string;
}

const IMAGE_PATTERN = /^[a-z0-9][a-z0-9._/-]*@sha256:[a-f0-9]{64}$/;

const ACCEPTED_KEYS: Readonly<Record<string, true>> = {
  image: true,
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

// Keys that an earlier release accepted. A retired key is refused like any other key outside the closed set above
// (loadRuntimeConfig knows no difference). Its sentence is a literal chosen by this table, never built from input,
// so the CLI can say what to delete without echoing a key name or a value from the file (D-28-02).
const RETIRED_KEYS: Readonly<Record<string, string>> = {
  andaUrl: "andaUrl was removed in the 0.4 release line, with the Anda bridge: delete it from config.json",
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
  if (overlapProblems(secretRoot, sandboxStateRoot, workspaceRoot).length > 0) {
    reject();
  }
  return Object.freeze({
    image,
    stateDir,
    workspaceRoot,
    ...(secretRoot === undefined ? {} : { secretRoot }),
    ...(sandboxStateRoot === undefined ? {} : { sandboxStateRoot }),
  });
}

// The migration sentence of each retired key present in an input, in table order. It is empty for an input that is not a
// JSON object, and for one with no retired key. The sentences are literals from RETIRED_KEYS: no input value is included.
export function retiredKeyNotes(input: unknown): readonly string[] {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return [];
  }
  return Object.entries(RETIRED_KEYS)
    .filter(([key]) => Object.hasOwn(input, key))
    .map(([, sentence]) => sentence);
}

// A key-level description of why an input would not load, for the doctor's report. Every phrase is
// fixed text: no value and no unknown key name is ever included, so arbitrary input is never echoed.
export function describeRuntimeConfigProblems(input: unknown): readonly string[] {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return ["config.json is not a JSON object"];
  }
  const record = input as Record<string, unknown>;
  const problems: string[] = [];
  if (Object.keys(record).some((key) => Object.hasOwn(DENIED_KEYS, key) || !Object.hasOwn(ACCEPTED_KEYS, key))) {
    problems.push("config.json has a key that is not accepted");
  }
  problems.push(...retiredKeyNotes(record));
  if (!isImageReference(record["image"])) {
    problems.push("image is absent or not a digest-pinned reference");
  }
  if (!isAbsolutePathValue(record["stateDir"])) {
    problems.push("stateDir is absent or not an absolute path");
  }
  if (!isAbsolutePathValue(record["workspaceRoot"])) {
    problems.push("workspaceRoot is absent or not an absolute path");
  }
  if (record["secretRoot"] !== undefined && !isAbsolutePathValue(record["secretRoot"])) {
    problems.push("secretRoot is not an absolute path");
  }
  if (record["sandboxStateRoot"] !== undefined && !isAbsolutePathValue(record["sandboxStateRoot"])) {
    problems.push("sandboxStateRoot is not an absolute path");
  }
  const secretRoot = record["secretRoot"];
  const sandboxStateRoot = record["sandboxStateRoot"];
  const workspaceRoot = record["workspaceRoot"];
  problems.push(
    ...overlapProblems(
      isAbsolutePathValue(secretRoot) ? secretRoot : undefined,
      isAbsolutePathValue(sandboxStateRoot) ? sandboxStateRoot : undefined,
      isAbsolutePathValue(workspaceRoot) ? workspaceRoot : undefined,
    ),
  );
  return problems;
}

// The roots the daemon and the driver share, all derived from the same config.json. secretRoot and
// sandboxStateRoot default under stateDir when the config omits them. workspaceRoot is required on the config.
// stateDir is the fourth shared value: the state directory the workspace registry lives under (<stateDir>/workspaces).
// A stale REALM_DRIVER_*_ROOT variable is not consulted.
export function runtimeRootsOf(config: RuntimeConfig): RuntimeRoots {
  return {
    secretRoot: config.secretRoot ?? join(config.stateDir, "secrets"),
    workspaceRoot: config.workspaceRoot,
    sandboxStateRoot: config.sandboxStateRoot ?? join(config.stateDir, "sandboxes"),
    stateDir: config.stateDir,
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

function isImageReference(value: unknown): value is string {
  return typeof value === "string" && IMAGE_PATTERN.test(value);
}

function requireImage(value: unknown): string {
  if (!isImageReference(value)) {
    reject();
  }
  return value;
}

function isAbsolutePathValue(value: unknown): value is string {
  return typeof value === "string" && isAbsolute(value);
}

// D-73: a relative state directory or workspace root is SCHEMA_INVALID.
function requireAbsolutePath(value: unknown): string {
  if (!isAbsolutePathValue(value)) {
    reject();
  }
  return value;
}

// Lexical only, no filesystem access: true when the two paths are equal or one lies inside the
// other. A prefix sibling such as /srv/realm/secrets-old against /srv/realm/secrets is not overlap.
function rootsOverlap(a: string, b: string): boolean {
  return isSameOrInside(relative(a, b)) || isSameOrInside(relative(b, a));
}

function isSameOrInside(relativePath: string): boolean {
  return relativePath === "" || (relativePath !== ".." && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath));
}

// Explicit values only: a derived default is checked by the doctor, not here.
function overlapProblems(
  secretRoot: string | undefined,
  sandboxStateRoot: string | undefined,
  workspaceRoot: string | undefined,
): readonly string[] {
  const problems: string[] = [];
  if (secretRoot !== undefined && sandboxStateRoot !== undefined && rootsOverlap(secretRoot, sandboxStateRoot)) {
    problems.push("secretRoot overlaps sandboxStateRoot");
  }
  if (secretRoot !== undefined && workspaceRoot !== undefined && rootsOverlap(secretRoot, workspaceRoot)) {
    problems.push("secretRoot overlaps workspaceRoot");
  }
  if (sandboxStateRoot !== undefined && workspaceRoot !== undefined && rootsOverlap(sandboxStateRoot, workspaceRoot)) {
    problems.push("sandboxStateRoot overlaps workspaceRoot");
  }
  return problems;
}

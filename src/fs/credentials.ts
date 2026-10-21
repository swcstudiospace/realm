// Credential path denial (D-31, FS-03). The denied shapes are one frozen constant. They are
// matched on the canonical relative path after symlink resolution, so a symlink into ~/.ssh
// is denied and the raw input is never matched. Callers run the PATH_ESCAPE checks
// (canonicalize) first, so an escaping path always reports PATH_ESCAPE. Policy
// credentialAllow globs override a denial.

import { join, relative, sep } from "node:path";
import { makeRealmError } from "../core/errors.js";
import type { CanonicalPath } from "./canonicalize.js";
import { matchGlob } from "./glob.js";
import type { PinnedRoot } from "./root.js";

export const CREDENTIAL_PATTERNS = Object.freeze([
  ".env",
  ".env.*",
  "**/.env",
  "**/.env.*",
  "**/.ssh/**",
  "**/id_rsa",
  "**/id_rsa.*",
  "**/id_dsa",
  "**/id_ecdsa",
  "**/id_ed25519",
  "**/id_ed25519.*",
  "**/.aws/credentials",
  "**/.aws/config",
  "**/.config/gcloud/**",
  "**/.azure/**",
  "**/.kube/config",
  "**/.docker/config.json",
  "**/.netrc",
  "**/.git-credentials",
  "**/.gnupg/**",
] as const);

export function isCredentialDenied(canonicalRelPath: string): boolean {
  return CREDENTIAL_PATTERNS.some((pattern) => matchGlob(pattern, canonicalRelPath));
}

export function isCredentialAllowed(patterns: readonly string[], canonicalRelPath: string): boolean {
  return patterns.some((pattern) => matchGlob(pattern, canonicalRelPath));
}

// The denial check used by read, list, and write. A denied shape with no matching
// credentialAllow glob fails with CREDENTIAL_PATH_DENIED.
export function assertCredentialAccess(canonicalRelPath: string, credentialAllow: readonly string[]): void {
  if (isCredentialDenied(canonicalRelPath) && !isCredentialAllowed(credentialAllow, canonicalRelPath)) {
    throw makeRealmError("CREDENTIAL_PATH_DENIED");
  }
}

// Canonical relative path ("/" separated) of a canonicalize result. An absent result names
// the missing final segment under its verified parent, so a denied shape that does not
// exist yet is still denied.
export function relPathOf(root: PinnedRoot, path: CanonicalPath): string {
  const absolute = path.status === "found" ? path.realPath : join(path.nearest, ...path.missing);
  return relative(root.realPath, absolute).split(sep).join("/");
}

// The capability-tokens doctor item (CAPT-08, D-32-12). It reads the policy's capabilityTokens member and, when the mode is
// enforce, the keyring at rest under the state directory. It never throws, reads no process environment and carries catalogue
// codes only: a detail names the mode, key ids and counts, and a fix names a command or a mode, never a key, a token, a policy
// value or a path. The keyring module reports every guard failure as one POLICY_DENIED with no detail, so this item runs its
// own lstat guards first (with injectable seams) to name the failure class, then lets the module read the file. This module
// imports nothing from checks.ts or src/cli.

import { lstatSync, type Stats } from "node:fs";
import { dirname, isAbsolute, relative, sep } from "node:path";
import { capabilityPolicyOf } from "../capability/admit.js";
import { keyringPathOf, readKeyring, type KeyringRead } from "../capability/keyring.js";
import type { CapabilityTokenPolicy } from "../contract/validate.js";
import { loadPolicyFileDetailed } from "../core/policy.js";
import { runtimeRootsOf, type RuntimeConfig } from "../runtime/config.js";

interface CapabilityTokensCheckResult {
  readonly id: "capability-tokens";
  readonly status: "pass" | "warn" | "fail";
  readonly detail: string;
  readonly fix: string | null;
}

interface CapabilityTokensCheckOptions {
  readonly stateDir: string;
  // The explicit policy path. Absent: no policy file, so the validated defaults (mode off, no profiles).
  readonly policyPath?: string;
  // Loaded runtime config. When present, a keyring under its sandbox state root is a failure.
  readonly runtimeConfig?: RuntimeConfig;
  // Test seams. Production passes none: the lstat is node:fs lstatSync, the uid is the process user, the clock is the
  // machine clock in whole seconds.
  readonly lstat?: (path: string) => Stats;
  readonly uid?: number;
  readonly now?: () => number;
}

const ID = "capability-tokens";
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;
const MAX_FILE_BYTES = 64 * 1024;
const PERMISSION_BITS = 0o777;

// No policy file configured: the validated defaults (mode off, no profiles).
const NO_POLICY: CapabilityTokenPolicy = { mode: "off", ttlSeconds: 3600, profiles: {} };

type FailureClass =
  | "missing"
  | "unreadable"
  | "symlink"
  | "owner"
  | "mode"
  | "too-large"
  | "malformed";

const FAILURE_DETAIL: Readonly<Record<FailureClass, string>> = {
  missing: "the keyring is missing",
  unreadable: "the keyring cannot be read",
  symlink: "the keyring or its directory is a symlink",
  owner: "the keyring or its directory is owned by another user",
  mode: "the keyring directory is not mode 700, or the key file is not mode 600",
  "too-large": "the key file is larger than 64 KiB",
  malformed: "the keyring is malformed or has no active key",
};

const FAILURE_FIX: Readonly<Record<FailureClass, string>> = {
  missing: "Run realm host token rotate to create the keyring, or set capabilityTokens.mode to off.",
  unreadable:
    "Make the capability directory of the state directory readable by the current user, or remove it and run realm host token rotate.",
  symlink:
    "Remove the symlink and run realm host token rotate. The keyring must be a real directory and a regular file under the state directory.",
  owner:
    "Remove the keyring owned by the other user and run realm host token rotate as the user that runs the daemon, or set capabilityTokens.mode to off.",
  mode: "Set the capability directory to mode 700 and the key file to mode 600, or remove both and run realm host token rotate.",
  "too-large": "Remove the key file and run realm host token rotate.",
  malformed: "Remove the key file and run realm host token rotate, or set capabilityTokens.mode to off.",
};

function failure(failureClass: FailureClass): CapabilityTokensCheckResult {
  return { id: ID, status: "fail", detail: `capability tokens enforce: ${FAILURE_DETAIL[failureClass]}`, fix: FAILURE_FIX[failureClass] };
}

function isAbsent(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

// True when child lies inside root (never equal to it).
function isUnder(root: string, child: string): boolean {
  const path = relative(root, child);
  return path !== "" && path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

// Names the guard that the keyring module would refuse on, or null when every guard holds. A path that is absent is missing.
function guardClass(
  stat: (path: string) => Stats,
  path: string,
  uid: number | undefined,
  kind: "directory" | "file",
): FailureClass | null {
  let found: Stats;
  try {
    found = stat(path);
  } catch (error: unknown) {
    return isAbsent(error) ? "missing" : "unreadable";
  }
  if (found.isSymbolicLink()) {
    return "symlink";
  }
  if (kind === "directory" ? !found.isDirectory() : !found.isFile()) {
    return "unreadable";
  }
  if (uid === undefined || found.uid !== uid) {
    return "owner";
  }
  if ((found.mode & PERMISSION_BITS) !== (kind === "directory" ? DIR_MODE : FILE_MODE)) {
    return "mode";
  }
  return kind === "file" && found.size > MAX_FILE_BYTES ? "too-large" : null;
}

function enforcedCheck(options: CapabilityTokensCheckOptions, hostsWithProfile: number): CapabilityTokensCheckResult {
  const keyringPath = keyringPathOf(options.stateDir);
  if (options.runtimeConfig !== undefined && isUnder(runtimeRootsOf(options.runtimeConfig).sandboxStateRoot, keyringPath)) {
    return {
      id: ID,
      status: "fail",
      detail: "capability tokens enforce: the keyring lies under the configured sandbox state root, so a sandbox mount can reach it",
      fix: "Move the sandbox state root, or the state directory, so that the state directory is not inside the sandbox state root.",
    };
  }
  const stat = options.lstat ?? lstatSync;
  const uid = options.uid ?? process.getuid?.();
  // The directory is the keyring path's parent: the module's own layout, STATE_DIR/capability.
  const directoryClass = guardClass(stat, dirname(keyringPath), uid, "directory");
  if (directoryClass !== null) {
    return failure(directoryClass);
  }
  const fileClass = guardClass(stat, keyringPath, uid, "file");
  if (fileClass !== null) {
    return failure(fileClass);
  }
  let read: KeyringRead;
  try {
    read = readKeyring(options.stateDir, {
      ...(uid === undefined ? {} : { uid }),
      ...(options.now === undefined ? {} : { now: options.now }),
    });
  } catch {
    return failure("malformed");
  }
  if (!read.present) {
    return failure("missing");
  }
  const { active, retired } = read.snapshot;
  const expired = retired.filter((key) => key.pastGrace).length;
  const detail = `capability tokens enforce: active key ${active}, ${String(retired.length)} retired key(s), ${String(hostsWithProfile)} host(s) with a profile`;
  if (expired > 0) {
    return {
      id: ID,
      status: "warn",
      detail: `${detail}; ${String(expired)} retired key(s) are past their prune time`,
      fix: "Run realm host token rotate to prune the expired retired keys.",
    };
  }
  return { id: ID, status: "pass", detail, fix: null };
}

// Never throws. A policy that cannot be loaded is a warn that points at the policy-file item, which reports the failure.
export function capabilityTokensCheck(options: CapabilityTokensCheckOptions): CapabilityTokensCheckResult {
  let policy: CapabilityTokenPolicy;
  try {
    policy = options.policyPath === undefined ? NO_POLICY : capabilityPolicyOf(loadPolicyFileDetailed(options.policyPath).policy);
  } catch {
    return {
      id: ID,
      status: "warn",
      detail: "capability tokens: the policy cannot be loaded, so the mode is unknown; the policy-file item reports why",
      fix: "Fix the policy-file item first, then rerun the check.",
    };
  }
  const hostsWithProfile = Object.keys(policy.profiles).length;
  if (policy.mode === "off") {
    if (hostsWithProfile > 0) {
      return {
        id: ID,
        status: "warn",
        detail: `capability tokens are off but ${String(hostsWithProfile)} host profile(s) are configured, so they have no effect`,
        fix: "Set capabilityTokens.mode to enforce, or remove the capabilityTokens profiles.",
      };
    }
    return {
      id: ID,
      status: "pass",
      detail: "capability tokens are off (the default): no token is minted or checked",
      fix: null,
    };
  }
  return enforcedCheck(options, hostsWithProfile);
}

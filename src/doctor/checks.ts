// Doctor core check runner (D-44, Phase 2 goal). Each check returns one result with an id,
// a status of pass, warn, or fail (F-10: a status shape distinct from the validate ok
// shape), a detail, and a fix. The fix is null only when the status is pass.
//
// Phase 2 registers exactly three checks. Podman, OpenShell, AgentOS, Anda, and
// control-channel items are not registered, so the runner reports only what it can
// inspect. Phase 3 and Phase 6 add their items to REGISTERED deliberately; the list is a
// costly change under D-44.
//
// Details and fixes name paths, rules, and schema pointers. They never carry a value read
// from the policy file (the privacy rule in src/contract/validate.ts).

import { accessSync, constants, existsSync, statSync, type Stats } from "node:fs";
import { dirname } from "node:path";
import { SchemaInvalidError } from "../contract/validate.js";
import { RealmError } from "../core/errors.js";
import { loadPolicyFile } from "../core/policy.js";
import { sessionsDirOf } from "../session/paths.js";

export type CheckId = "policy-file" | "state-dir" | "session-store";
export type CheckStatus = "pass" | "warn" | "fail";

export interface CheckResult {
  readonly id: CheckId;
  readonly status: CheckStatus;
  readonly detail: string;
  readonly fix: string | null;
}

export interface DoctorOptions {
  // The explicit policy path (D-21). Undefined when the host configures none.
  readonly policyPath?: string;
  // The state directory (D-37), resolved by the caller.
  readonly stateDir: string;
  // Writability probe for the session store. The default is access(W_OK), which writes no
  // file (D-44). Tests inject a probe to exercise the unwritable outcome.
  readonly canWrite?: (path: string) => boolean;
}

type WriteProbe = (path: string) => boolean;
type Check = (options: DoctorOptions, canWrite: WriteProbe) => CheckResult;

const STATE_DIR_MODE = 0o700;
const PERMISSION_BITS = 0o777;

// The registered checks in report order.
const REGISTERED: readonly Check[] = Object.freeze([
  policyFileCheck,
  stateDirCheck,
  sessionStoreCheck,
]);

export function runChecks(options: DoctorOptions): readonly CheckResult[] {
  const canWrite = options.canWrite ?? defaultCanWrite;
  return REGISTERED.map((check) => check(options, canWrite));
}

// access(W_OK) answers without creating or touching any file.
function defaultCanWrite(path: string): boolean {
  try {
    accessSync(path, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

// policy-file (D-21, D-22, D-44). Validation and the inside-root rule run through the
// policy loader, so the doctor never restates them.
function policyFileCheck(options: DoctorOptions): CheckResult {
  const id: CheckId = "policy-file";
  const path = options.policyPath;
  if (path === undefined || !existsSync(path)) {
    const where =
      path === undefined ? "no policy file path is configured" : "no policy file at the configured path";
    return {
      id,
      status: "warn",
      detail: `${where}; defaults in effect (advisory mode, no workspace roots, shell disabled)`,
      fix: "Create a policy file at the configured path that names workspaceRoots. Without one, every create is refused with POLICY_DENIED.",
    };
  }
  try {
    loadPolicyFile(path);
  } catch (error: unknown) {
    if (error instanceof SchemaInvalidError) {
      return {
        id,
        status: "fail",
        detail: `policy file fails the schema: ${error.detail}`,
        fix: "Correct the policy file so it satisfies the schema at the location named in the detail, then rerun the check. The value is never reported.",
      };
    }
    if (error instanceof RealmError && error.code === "POLICY_DENIED") {
      return {
        id,
        status: "fail",
        detail:
          "policy file cannot be verified: it is unreadable, sits inside one of its own workspace roots, or names a root that does not resolve",
        fix: "Make the policy file readable, move it outside every workspace root, and make every workspaceRoots entry an existing directory.",
      };
    }
    throw error;
  }
  return {
    id,
    status: "pass",
    detail: "policy file loads, and it lies outside its own workspace roots",
    fix: null,
  };
}

// state-dir (D-37, D-44). The directory is created with mode 0700 on first use.
function stateDirCheck(options: DoctorOptions): CheckResult {
  const id: CheckId = "state-dir";
  const dir = options.stateDir;
  const found = probePath(dir);
  if (found.state === "absent") {
    return {
      id,
      status: "warn",
      detail: "state directory is absent",
      fix: "No action needed: the realm creates the state directory with mode 700 on first use.",
    };
  }
  if (found.state === "unreadable") {
    return {
      id,
      status: "fail",
      detail: "state directory cannot be inspected",
      fix: "Check the ownership and permissions of the parent directory of the state directory.",
    };
  }
  if (!found.stats.isDirectory()) {
    return {
      id,
      status: "fail",
      detail: "state directory path is not a directory",
      fix: "Move the file at the state directory path aside so the realm can create the directory.",
    };
  }
  const mode = found.stats.mode & PERMISSION_BITS;
  if (mode !== STATE_DIR_MODE) {
    return {
      id,
      status: "fail",
      detail: `state directory mode is ${mode.toString(8)}, expected 700`,
      fix: `Run chmod 700 on the state directory: ${dir}`,
    };
  }
  return { id, status: "pass", detail: "state directory exists with mode 700", fix: null };
}

// session-store (D-37, D-44). Writability is access(W_OK) on the session directory, or on
// the nearest existing ancestor when the session directory is not yet created. No probe file
// is written.
function sessionStoreCheck(options: DoctorOptions, canWrite: WriteProbe): CheckResult {
  const id: CheckId = "session-store";
  const dir = sessionsDirOf(options.stateDir);
  const found = probePath(dir);
  if (found.state === "unreadable") {
    return {
      id,
      status: "fail",
      detail: "session store cannot be inspected",
      fix: "Check the ownership and permissions of the state directory.",
    };
  }
  if (found.state === "present") {
    if (!found.stats.isDirectory()) {
      return {
        id,
        status: "fail",
        detail: "session store path is not a directory",
        fix: "Move the file at the session store path aside so the realm can create the directory.",
      };
    }
    if (canWrite(dir)) {
      return { id, status: "pass", detail: "session store directory is writable by this process", fix: null };
    }
    return {
      id,
      status: "fail",
      detail: "session store directory is not writable by this process",
      fix: `Check the ownership of ${dir}: it must belong to the user that runs the realm and be writable by that user.`,
    };
  }
  const ancestor = nearestExistingAncestor(dir);
  if (isDirectoryAt(ancestor) && canWrite(ancestor)) {
    return {
      id,
      status: "warn",
      detail: "session store is absent",
      fix: "No action needed: the realm creates the session store on first use.",
    };
  }
  return {
    id,
    status: "fail",
    detail: "session store cannot be created: no writable directory covers its path",
    fix: `Check the ownership of ${ancestor}: it must be a directory that the user running the realm can write.`,
  };
}

type PathProbe =
  | { readonly state: "absent" }
  | { readonly state: "unreadable" }
  | { readonly state: "present"; readonly stats: Stats };

function probePath(path: string): PathProbe {
  try {
    return { state: "present", stats: statSync(path) };
  } catch (error: unknown) {
    return errnoOf(error) === "ENOENT" ? { state: "absent" } : { state: "unreadable" };
  }
}

function isDirectoryAt(path: string): boolean {
  const found = probePath(path);
  return found.state === "present" && found.stats.isDirectory();
}

function nearestExistingAncestor(path: string): string {
  let current = dirname(path);
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) {
      return current;
    }
    current = parent;
  }
  return current;
}

function errnoOf(error: unknown): string | undefined {
  if (error instanceof Error && "code" in error && typeof error.code === "string") {
    return error.code;
  }
  return undefined;
}

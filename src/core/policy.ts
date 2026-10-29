// Policy loading, mode decision, and the exec gate (CORE-03, TOOL-02; D-21 to D-24).
//
// Layering (F-1, recorded in 02-02-SUMMARY.md): this module imports validation
// from src/contract/validate.ts. The contract module imports only core/errors and
// core/states, never this file, so the edge is one-way and no cycle exists.
//
// Nothing here executes a command. checkExecPolicy only decides.

import { readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, sep } from "node:path";
import {
  SchemaInvalidError,
  validate,
  type ExecParams,
  type Policy,
  type ValidationResult,
} from "../contract/validate.js";
import { makeRealmError } from "./errors.js";
import type { State } from "./states.js";

// ---- Loader (D-21, D-22) ----------------------------------------------------

// Loads the policy at an explicit caller-supplied path. A missing file yields the
// validated defaults (advisory, no roots, shell disabled). An unreadable file, or a
// policy file that resolves inside one of its own workspace roots, fails with
// POLICY_DENIED. Invalid content fails with SchemaInvalidError (SCHEMA_INVALID).
// Returns the plain Policy value; the validation wrapper's ok shape is not exposed.
export function loadPolicyFile(explicitPath: string): Policy {
  const text = readPolicyText(explicitPath);
  if (text === undefined) {
    return unwrap(validate("policy", {}));
  }
  const policy = unwrap(validate("policy", parseJson(text)));
  assertAbsoluteRoots(policy);
  assertPolicyOutsideRoots(explicitPath, policy);
  return policy;
}

function unwrap(result: ValidationResult<Policy>): Policy {
  if (!result.ok) {
    throw result.error;
  }
  return result.value;
}

// Returns undefined for a missing file. Any other read failure is POLICY_DENIED:
// the policy cannot be verified, so it cannot be trusted to constrain anything.
function readPolicyText(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch (error: unknown) {
    if (errnoCode(error) === "ENOENT") {
      return undefined;
    }
    throw makeRealmError("POLICY_DENIED");
  }
}

function errnoCode(error: unknown): string | undefined {
  if (error instanceof Error && "code" in error && typeof error.code === "string") {
    return error.code;
  }
  return undefined;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    // The parser message can quote file content, so it is discarded.
    throw new SchemaInvalidError("policy file is not valid JSON");
  }
}

// F-3: the frozen schema does not express absoluteness, so the loader checks it
// after validation. The detail names the index, never the value.
function assertAbsoluteRoots(policy: Policy): void {
  for (const [index, root] of policy.workspaceRoots.entries()) {
    if (!isAbsolute(root)) {
      throw new SchemaInvalidError(`/workspaceRoots/${String(index)} must be an absolute path`);
    }
  }
}

// D-22: the policy file must not reside inside any of its own workspace roots,
// because the agent can write there and could rewrite the policy. Both sides are
// canonicalized with realpath, so a symlink into a root counts as inside. A root
// that cannot be canonicalized is POLICY_DENIED.
function assertPolicyOutsideRoots(policyPath: string, policy: Policy): void {
  if (policy.workspaceRoots.length === 0) {
    return;
  }
  const policyReal = canonical(policyPath);
  for (const root of policy.workspaceRoots) {
    if (isInside(canonical(root), policyReal)) {
      throw makeRealmError("POLICY_DENIED");
    }
  }
}

function canonical(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    throw makeRealmError("POLICY_DENIED");
  }
}

// Segment comparison, not a string prefix: /ws-other is not inside /ws. Equality
// counts as inside.
function isInside(root: string, path: string): boolean {
  const rel = relative(root, path);
  if (rel === "") {
    return true;
  }
  return !isAbsolute(rel) && rel.split(sep)[0] !== "..";
}

// ---- Mode decision (D-23) ---------------------------------------------------

export type MutationDenyCode = "REALM_UNBOUND" | "REALM_STOPPING" | "REALM_NOT_ACTIVE";

export type MutationDecision =
  | { readonly decision: "allow" }
  | { readonly decision: "allow-with-warning"; readonly warning: string }
  | { readonly decision: "deny"; readonly code: MutationDenyCode };

// Pure. The one mutation decision for file-mutating calls, in both policy modes. An active session
// allows a write whether or not an Anda bridge is configured; a configured bridge that goes down
// moves the session to degraded, which is refused below.
// Under advisory policy a write in any other non-active state proceeds with a warning.
export function decideMutation(policy: Policy, state: State): MutationDecision {
  if (state === "active") {
    return { decision: "allow" };
  }
  if (policy.mode === "advisory") {
    return {
      decision: "allow-with-warning",
      warning: `realm is ${state}; the write proceeds under advisory policy`,
    };
  }
  return { decision: "deny", code: denyCodeFor(state) };
}

function denyCodeFor(state: Exclude<State, "active">): MutationDenyCode {
  switch (state) {
    case "unbound":
      return "REALM_UNBOUND";
    case "stopping":
      return "REALM_STOPPING";
    case "connecting":
    case "degraded":
    case "error":
      return "REALM_NOT_ACTIVE";
  }
}

// ---- Exec gate (D-24) -------------------------------------------------------

// Accepts the argv form. The shell form throws SHELL_NOT_ALLOWED unless
// policy.shellEnabled is true. Runs only on input that has already passed
// validate("tools", ...). It decides and never spawns a process.
export function checkExecPolicy(policy: Policy, exec: ExecParams): void {
  if ("argv" in exec) {
    return;
  }
  if (!policy.shellEnabled) {
    throw makeRealmError("SHELL_NOT_ALLOWED");
  }
}

// Capability mapping and the per-host profile (CAPT-02, CAPT-04, D-32-09). Pure: this module reads the raw tool
// object and the policy and decides nothing about admission. The token is a gate in front of the unchanged
// dispatcher; it never grants what the policy refuses (D-32-07).

import type { CapabilityTokenPolicy, Policy } from "../contract/validate.js";
import type { HostId } from "../host/types.js";
import { TOKEN_CAPABILITIES, type TokenCapability } from "./token.js";

// What a call needs: a capability, nothing (status: a valid token for the session is enough), or the marker for a
// call the mapping does not know (a valid token is still required, and the dispatcher then refuses the call).
export type RequiredCapability = TokenCapability | "none" | "unmapped";

// The default for code that does not go through the schema: a hand-built Policy literal that omits capabilityTokens, and
// the doctor when no policy file is configured. For a validated policy the schema (src/core/policy.schema.json) is the
// source of the default; a test pins the two equal so they cannot drift (D34-1).
export const DEFAULT_CAPABILITY_POLICY: CapabilityTokenPolicy = Object.freeze({
  mode: "enforce",
  ttlSeconds: 3600,
  profiles: Object.freeze({}),
});

// The capability a raw tool object needs. Reads only the single own key of a plain object and, for exec, the shell
// member (as an own data property, so no getter runs). Validates nothing else and never throws.
export function requiredCapability(rawTool: unknown): RequiredCapability {
  if (typeof rawTool !== "object" || rawTool === null || Array.isArray(rawTool)) {
    return "unmapped";
  }
  const prototype: unknown = Object.getPrototypeOf(rawTool);
  if (prototype !== Object.prototype && prototype !== null) {
    return "unmapped";
  }
  const names = Object.keys(rawTool);
  const name = names[0];
  if (names.length !== 1 || name === undefined) {
    return "unmapped";
  }
  switch (name) {
    case "read":
      return "fs.read";
    case "list":
      return "fs.list";
    case "write":
      return "fs.write";
    case "retry":
      return "daemon.attach";
    case "status":
      return "none";
    case "exec":
      return execCapability(Reflect.getOwnPropertyDescriptor(rawTool, name)?.value);
    default:
      return "unmapped";
  }
}

// The shell form is exactly shell equal to the boolean true; anything else, a malformed exec included, is argv.
function execCapability(params: unknown): TokenCapability {
  if (typeof params !== "object" || params === null || Array.isArray(params)) {
    return "exec.argv";
  }
  const shell: unknown = Reflect.getOwnPropertyDescriptor(params, "shell")?.value;
  return shell === true ? "exec.shell" : "exec.argv";
}

// The policy's capabilityTokens, or the default (mode enforce, ttlSeconds 3600, no profiles). The only reader of the
// member: a validated policy always has it, a hand-built literal may not.
export function capabilityPolicyOf(policy: Policy): CapabilityTokenPolicy {
  return policy.capabilityTokens ?? DEFAULT_CAPABILITY_POLICY;
}

// The sorted capabilities a host's token carries: the configured list, all six when the host has no entry, none
// when its entry is empty.
export function profileFor(policy: Policy, host: HostId): readonly TokenCapability[] {
  const profile = capabilityPolicyOf(policy).profiles[host];
  // The schema admits only the six names, so narrowing the configured list through the known set drops nothing.
  return profile === undefined ? TOKEN_CAPABILITIES : TOKEN_CAPABILITIES.filter((known) => profile.includes(known)).sort();
}

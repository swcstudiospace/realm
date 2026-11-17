// Capability catalog: each capability maps to exactly one existing Policy fact. This module reads
// Policy data only. It is not an enforcement path: tools still go through the dispatcher gates.

import type { Policy } from "../contract/validate.js";
import type { ErrorCode } from "../core/errors.js";
import type { HostCapability, HostCapabilityRequest, IntegrationKind } from "./types.js";

type Fact = "none" | "workspaceRoots" | "shellEnabled" | "egressAllow" | "credentialAllow" | "mode";

interface CapabilityFact {
  readonly fact: Fact;
  readonly denial: ErrorCode | null;
  readonly scope: "forbidden" | "host-port" | "pattern";
}

// Typed as a full Record: a new capability fails compilation until it is mapped here.
const CAPABILITY_FACTS: Readonly<Record<HostCapability, CapabilityFact>> = Object.freeze({
  "daemon.attach": { fact: "none", denial: null, scope: "forbidden" },
  "fs.read": { fact: "workspaceRoots", denial: "POLICY_DENIED", scope: "forbidden" },
  "fs.write": { fact: "workspaceRoots", denial: "POLICY_DENIED", scope: "forbidden" },
  "fs.list": { fact: "workspaceRoots", denial: "POLICY_DENIED", scope: "forbidden" },
  "exec.argv": { fact: "none", denial: null, scope: "forbidden" },
  "exec.shell": { fact: "shellEnabled", denial: "SHELL_NOT_ALLOWED", scope: "forbidden" },
  "net.egress": { fact: "egressAllow", denial: "EGRESS_DENIED", scope: "host-port" },
  "credential.read": { fact: "credentialAllow", denial: "CREDENTIAL_PATH_DENIED", scope: "pattern" },
  "host.tools.restrict": { fact: "mode", denial: "POLICY_DENIED", scope: "forbidden" },
});

export const HOST_CAPABILITIES: readonly HostCapability[] = Object.freeze([
  "daemon.attach",
  "fs.read",
  "fs.write",
  "fs.list",
  "exec.argv",
  "exec.shell",
  "net.egress",
  "credential.read",
  "host.tools.restrict",
]);

const MCP_CONFIG_CEILING: readonly HostCapability[] = Object.freeze([
  "daemon.attach",
  "fs.read",
  "fs.write",
  "fs.list",
  "exec.argv",
  "exec.shell",
]);

export function integrationCeiling(kind: IntegrationKind): readonly HostCapability[] {
  return kind === "extension" ? HOST_CAPABILITIES : MCP_CONFIG_CEILING;
}

export function isWithinCeiling(kind: IntegrationKind, request: HostCapabilityRequest): boolean {
  return integrationCeiling(kind).includes(request.capability);
}

export interface CapabilityDenial {
  readonly request: HostCapabilityRequest;
  readonly code: ErrorCode;
}

export interface CapabilityResolution {
  readonly granted: readonly HostCapabilityRequest[];
  readonly denied: readonly CapabilityDenial[];
}

// Exact `host:port` with a port in 1..65535. The host may not contain a colon or whitespace.
function parseHostPort(scope: string): { host: string; port: number } | undefined {
  const match = /^([^\s:]+):(\d{1,5})$/.exec(scope);
  if (match === null) {
    return undefined;
  }
  const port = Number(match[2]);
  if (port < 1 || port > 65535) {
    return undefined;
  }
  return { host: match[1] as string, port };
}

function decide(request: HostCapabilityRequest, policy: Policy): ErrorCode | null {
  const spec = CAPABILITY_FACTS[request.capability];
  const scope = request.scope;
  if (spec.scope === "forbidden") {
    if (scope !== undefined) {
      return "SCHEMA_INVALID";
    }
  } else if (scope === undefined || scope === "") {
    return "SCHEMA_INVALID";
  }
  let admitted: boolean;
  switch (spec.fact) {
    case "none":
      admitted = true;
      break;
    case "workspaceRoots":
      admitted = policy.workspaceRoots.length > 0;
      break;
    case "shellEnabled":
      admitted = policy.shellEnabled;
      break;
    case "mode":
      admitted = policy.mode === "fail-closed";
      break;
    case "egressAllow": {
      const target = parseHostPort(scope as string);
      if (target === undefined) {
        return "SCHEMA_INVALID";
      }
      admitted = policy.egressAllow.some((rule) => rule.host === target.host && rule.port === target.port);
      break;
    }
    case "credentialAllow":
      admitted = policy.credentialAllow.includes(scope as string);
      break;
  }
  return admitted ? null : spec.denial;
}

// Pure: grant = request AND policy. Preserves request order and never mutates the policy.
export function resolveCapabilities(
  requested: readonly HostCapabilityRequest[],
  policy: Policy,
): CapabilityResolution {
  const granted: HostCapabilityRequest[] = [];
  const denied: CapabilityDenial[] = [];
  for (const request of requested) {
    const code = decide(request, policy);
    if (code === null) {
      granted.push(request);
    } else {
      denied.push({ request, code });
    }
  }
  return Object.freeze({ granted: Object.freeze(granted), denied: Object.freeze(denied) });
}

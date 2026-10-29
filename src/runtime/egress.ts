// Egress allowlist validation and OpenShell network-policy rendering (RT-05, D-77, D-78).
// validateEgressAllow admits only an exact DNS hostname of at least two labels or an IPv4
// literal, with an integer port from 1 to 65535. It refuses wildcards, IPv6 literals, localhost,
// and IPv4 literals in these ranges: 0.0.0.0/8 (this network), 10.0.0.0/8, 100.64.0.0/10 (shared
// address space), 127.0.0.0/8 (loopback), 169.254.0.0/16 (link-local), 172.16.0.0/12,
// 192.0.0.0/24, 192.168.0.0/16, 198.18.0.0/15 (the sandbox resolver hands out synthetic answers
// there, so a literal would collide with them), 224.0.0.0/4 (multicast) and 240.0.0.0/4
// (reserved, including 255.255.255.255) (D-77). Hex, octal-looking and short notations such as
// 0x7f.0.0.0x1, 010.0.0.1 and 127.1 are refused: a host whose last label is decimal or 0x-hex must
// be a canonical dotted quad. The check is otherwise lexical: a hostname that resolves
// to a private address cannot be refused here, and the supervisor resolves hostnames.
// renderNetworkPolicies writes only the D-78 fields, in a deterministic order, and renders an
// empty allowlist to {} (deny-all, S-20). Both are pure: they read no environment and do no I/O.
// The rendered shape is a documented contract, so changing it is a costly change.

import { isAbsolute } from "node:path";
import { makeRealmError } from "../core/errors.js";
import type { EgressRule } from "../contract/validate.js";

export interface NetworkPolicyEndpoint {
  readonly host: string;
  readonly port: number;
}

export interface NetworkPolicyBinary {
  readonly path: string;
}

export interface NetworkPolicyEntry {
  readonly name: string;
  readonly endpoints: readonly NetworkPolicyEndpoint[];
  readonly binaries: readonly NetworkPolicyBinary[];
}

export type NetworkPolicies = Readonly<Record<string, NetworkPolicyEntry>>;

const LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
// Canonical decimal octets only: "0" alone or no leading zero, so octal-looking 010 or 0177 is refused.
const OCTET_PATTERN = /^(?:0|[1-9][0-9]{0,2})$/;
// A label inet_aton reads as a number: decimal digits, or 0x followed by hex digits (possibly none).
const NUMERIC_LABEL_PATTERN = /^(?:[0-9]+|0x[0-9a-f]*)$/i;
const IPV6_OR_WILDCARD_PATTERN = /[:[\]*]/;
const MAX_HOST_LENGTH = 253;
const MAX_PORT = 65535;

// Validates an untrusted allowlist and returns a frozen copy of its entries. Any refusal throws
// SCHEMA_INVALID. The error names no value, so a refused host never reaches a log.
export function validateEgressAllow(rules: unknown): readonly EgressRule[] {
  if (!Array.isArray(rules)) {
    reject();
  }
  return Object.freeze(rules.map(validateRule));
}

// Renders the allowlist as the OpenShell network_policies map (D-78). The workload binary must be
// an absolute path (D-79), because an empty binaries list matches no executable. Rules are
// validated first, so an invalid host is never rendered.
export function renderNetworkPolicies(rules: unknown, workloadBinary: unknown): NetworkPolicies {
  if (typeof workloadBinary !== "string" || !isAbsolute(workloadBinary)) {
    reject();
  }
  const binaryPath = workloadBinary;
  const validated = validateEgressAllow(rules);
  if (validated.length === 0) {
    const deny: NetworkPolicies = {};
    return Object.freeze(deny);
  }
  const sorted = [...validated].sort(compareRules);
  const entries: Record<string, NetworkPolicyEntry> = {};
  sorted.forEach((rule, index) => {
    entries[`egress_${String(index)}`] = Object.freeze({
      name: `${rule.host}:${String(rule.port)}`,
      endpoints: Object.freeze([Object.freeze({ host: rule.host, port: rule.port })]),
      binaries: Object.freeze([Object.freeze({ path: binaryPath })]),
    });
  });
  return Object.freeze(entries);
}

function validateRule(entry: unknown): EgressRule {
  if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
    reject();
  }
  const { host, port } = entry as { readonly host?: unknown; readonly port?: unknown };
  if (typeof host !== "string" || !isAllowedHost(host)) {
    reject();
  }
  if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > MAX_PORT) {
    reject();
  }
  return Object.freeze({ host, port });
}

// D-77: an exact DNS hostname of at least two labels, or an IPv4 literal outside the refused ranges.
function isAllowedHost(host: string): boolean {
  if (host.length === 0 || host.length > MAX_HOST_LENGTH || IPV6_OR_WILDCARD_PATTERN.test(host)) {
    return false;
  }
  const lower = host.toLowerCase();
  if (lower === "localhost" || lower.endsWith(".localhost")) {
    return false;
  }
  const labels = host.split(".");
  const last = labels[labels.length - 1] ?? "";
  if (NUMERIC_LABEL_PATTERN.test(last)) {
    // A final decimal or 0x-hex label is not a valid DNS name, and inet_aton reads such a host as an
    // IPv4 literal in hex, octal or short form. Only a canonical dotted quad outside the refused ranges passes.
    const octets = parseIpv4(labels);
    return octets !== undefined && isRoutableIpv4(octets);
  }
  return labels.length >= 2 && labels.every((label) => LABEL_PATTERN.test(label));
}

function parseIpv4(labels: readonly string[]): readonly number[] | undefined {
  if (labels.length !== 4 || !labels.every((label) => OCTET_PATTERN.test(label))) {
    return undefined;
  }
  const octets = labels.map(Number);
  return octets.every((octet) => octet <= 255) ? octets : undefined;
}

// Refuses every IPv4 literal in the ranges listed in the header comment.
function isRoutableIpv4(octets: readonly number[]): boolean {
  const [first = 0, second = 0, third = 0] = octets;
  switch (first) {
    case 0:
    case 10:
    case 127:
      return false;
    case 100:
      return second < 64 || second > 127;
    case 169:
      return second !== 254;
    case 172:
      return second < 16 || second > 31;
    case 192:
      return !(second === 168 || (second === 0 && third === 0));
    case 198:
      return second !== 18 && second !== 19;
    default:
      return first < 224;
  }
}

// D-78 order: by host, then by port. Plain code-unit comparison keeps it locale-independent.
function compareRules(a: EgressRule, b: EgressRule): number {
  if (a.host !== b.host) {
    return a.host < b.host ? -1 : 1;
  }
  return a.port - b.port;
}

function reject(): never {
  throw makeRealmError("SCHEMA_INVALID");
}

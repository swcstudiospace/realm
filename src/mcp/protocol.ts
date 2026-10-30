// MCP protocol eras and result shapes for the stdio server (TOOL-05; docs/integration/mcp.md, "Protocol eras
// and result shapes"). The server is dual-era in the sense of the 2026-07-28 versioning page:
//
//  - Modern (revision 2026-07-28): stateless. Every request carries its protocol version in
//    `params._meta["io.modelcontextprotocol/protocolVersion"]`, there is no handshake, and every result carries
//    `resultType`. `server/discover` is mandatory, `tools/list` results carry `ttlMs` and `cacheScope`, and a
//    `tools/call` result carries `content`.
//  - Legacy (2025-11-25 and 2025-06-18): an `initialize` handshake selects the revision for the rest of the
//    stdio process. Results carry no `resultType`; a `tools/call` result carries `content`, and may carry
//    `structuredContent` and `isError`.
//
// A modern-only server fails every legacy client. Claude Code 2.1.308 refused the 0.2.0 server with "Server's
// protocol version is not supported: 2026-07-28", because the server answered `initialize` with the modern
// revision string. Grok Build speaks the modern era and connected.

import type { RealmError } from "../core/errors.js";
import { packageVersion } from "../core/package-version.js";
import type { ToolOutcome } from "../tools/dispatch.js";

export const MCP_MODERN_VERSION = "2026-07-28";
// Newest first. `initialize` answers the requested version when it is listed here, else the first entry (the
// legacy lifecycle: the server answers another version it supports, preferably the latest).
const MCP_LEGACY_VERSIONS: readonly string[] = ["2025-11-25", "2025-06-18"];
const MCP_LATEST_LEGACY_VERSION = "2025-11-25";
// Listed in `server/discover` and in an UnsupportedProtocolVersionError, as the versioning page's example shows
// for a dual-era server.
export const MCP_SUPPORTED_VERSIONS: readonly string[] = [MCP_MODERN_VERSION, ...MCP_LEGACY_VERSIONS];

const MCP_SERVER_NAME = "agent-realm";

export const META_PROTOCOL_VERSION = "io.modelcontextprotocol/protocolVersion";
const META_SERVER_INFO = "io.modelcontextprotocol/serverInfo";

// The JSON-RPC error code of UnsupportedProtocolVersionError (schema, 2026-07-28).
export const UNSUPPORTED_PROTOCOL_VERSION = -32022;

// Cache hints the schema makes required on `server/discover` and `tools/list`. Both answers are static for the
// life of the process, so they are public and long-lived; the tool list is shorter because a host upgrade may
// change it.
const DISCOVER_TTL_MS = 3_600_000;
const TOOL_LIST_TTL_MS = 300_000;

export type McpEra = { readonly kind: "modern" } | { readonly kind: "legacy"; readonly version: string };

export interface McpToolDescriptor {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
}

// The version a legacy `initialize` is answered with: the requested one when supported, else the latest.
export function negotiateLegacyVersion(requested: unknown): string {
  return typeof requested === "string" && MCP_LEGACY_VERSIONS.includes(requested) ? requested : MCP_LATEST_LEGACY_VERSION;
}

// Modern results carry `resultType: "complete"`. A legacy result has no such field.
function stamped(era: McpEra, body: Record<string, unknown>): Record<string, unknown> {
  return era.kind === "modern" ? { resultType: "complete", ...body } : body;
}

function implementation(): { readonly name: string; readonly version: string } {
  return { name: MCP_SERVER_NAME, version: packageVersion() };
}

// DiscoverResult (schema, 2026-07-28): resultType, supportedVersions, capabilities, ttlMs and cacheScope are required;
// the server identity travels in `_meta`.
export function discoverResult(): Record<string, unknown> {
  return {
    resultType: "complete",
    supportedVersions: [...MCP_SUPPORTED_VERSIONS],
    capabilities: { tools: {} },
    _meta: { [META_SERVER_INFO]: implementation() },
    ttlMs: DISCOVER_TTL_MS,
    cacheScope: "public",
  };
}

// The legacy lifecycle's initialize result: the negotiated version, the capabilities and the server identity.
export function initializeResult(version: string): Record<string, unknown> {
  return { protocolVersion: version, capabilities: { tools: {} }, serverInfo: implementation() };
}

export function toolListResult(era: McpEra, tools: readonly McpToolDescriptor[]): Record<string, unknown> {
  if (era.kind === "legacy") {
    return { tools };
  }
  return stamped(era, { tools, ttlMs: TOOL_LIST_TTL_MS, cacheScope: "public" });
}

// A tool that ran. The outcome is the structured result; the same JSON is serialised into a text block because a
// host shows `content` to the model and the specification asks for the serialised form beside `structuredContent`.
// A refused outcome is a tool failure the model must be able to see, so it carries isError. The ToolOutcome itself
// is the frozen contract and the ACP surface returns it as is; its refused variant gained an optional, additive
// causeCode (present only when the refusing error carried a cause), which this result then shows in structuredContent.
export function toolCallResult(era: McpEra, outcome: ToolOutcome): Record<string, unknown> {
  return stamped(era, {
    content: [{ type: "text", text: JSON.stringify(outcome) }],
    structuredContent: outcome,
    isError: outcome.outcome === "refused",
  });
}

// A RealmError is a tool failure, not a protocol failure. It returns as a tool error result carrying the catalogue
// code, the reason, the retryable flag and any cause code (G-08).
export function toolErrorResult(era: McpEra, error: RealmError): Record<string, unknown> {
  const structured: Record<string, unknown> = { code: error.code, message: error.message, retryable: error.retryable };
  if (error.causeCode !== undefined) {
    structured["causeCode"] = error.causeCode;
  }
  return stamped(era, {
    isError: true,
    content: [{ type: "text", text: `${error.code}: ${error.message}` }],
    structuredContent: structured,
  });
}

// The error a modern request gets when its `_meta` names a version the server does not serve.
export function unsupportedVersionError(requested: string): {
  readonly code: number;
  readonly message: string;
  readonly data: { readonly supported: readonly string[]; readonly requested: string };
} {
  return {
    code: UNSUPPORTED_PROTOCOL_VERSION,
    message: "Unsupported protocol version",
    data: { supported: [...MCP_SUPPORTED_VERSIONS], requested },
  };
}

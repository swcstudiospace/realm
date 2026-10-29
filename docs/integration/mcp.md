# MCP integration note

Status: gate note (FOUND-03). No MCP code exists in this phase.
Blocks: MCP **transport code only**. The shared contract types (`src/contract/`, `src/core/`) proceed without this note, per D-18. The tool schema is not transport-specific.

## Official sources read

Read date: 2026-10-21 (ISO 8601).

| Source | URL |
| --- | --- |
| Specification index (the `latest` alias rendered revision 2026-07-28) | https://modelcontextprotocol.io/specification/2026-07-28 |
| Transports overview (revision 2026-07-28) | https://modelcontextprotocol.io/specification/2026-07-28/basic/transports |
| stdio transport (revision 2026-07-28) | https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/stdio |
| Backward-compatibility section, linked from the stdio page | https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning#backward-compatibility-with-initialization-based-versions (linked, not fetched directly) |
| Documentation index | https://modelcontextprotocol.io/llms.txt |

Not read directly in this phase: the Streamable HTTP binding page (`/basic/transports/streamable-http`). Its details are not stated below beyond the overview's one-line description.

## Questions and answers

### Q1. Spec version

Sourced answer: **revision 2026-07-28** is the revision the official `latest` specification page renders (https://modelcontextprotocol.io/specification/2026-07-28, read 2026-10-21). Earlier revisions use an `initialize` handshake and allow servers to initiate requests (transports page, "Backward Compatibility").

Legacy revision 2024-11-05 (HTTP+SSE): the revision name appears only in the upstream Omp documentation (`mcp-protocol-transports.md`, read 2026-10-21). It was not verified against the MCP specification pages in this phase.

### Q2. Transport

Sourced answer. The 2026-07-28 transports overview defines two standard bindings (https://modelcontextprotocol.io/specification/2026-07-28/basic/transports):

1. **stdio**: the client launches the server as a subprocess. Newline-delimited JSON-RPC over stdin/stdout. Messages MUST NOT contain embedded newlines. The server MUST NOT write non-MCP content to stdout. Stderr is for logs. Shutdown is by closing stdin, then signals per the stdio page (https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/stdio).
2. **Streamable HTTP**: each message is an HTTP POST to a single MCP endpoint; replies arrive as a JSON object or a request-scoped SSE stream. Named in the overview; detail not read in this phase.

Custom transports are permitted. Custom transports over a byte stream SHOULD reuse the stdio framing (transports overview and stdio page).

Revision 2026-07-28 is stateless per request: protocol version and client capabilities travel in each request's `_meta.io.modelcontextprotocol/*` fields. Clients that support both modern and `initialize`-based revisions SHOULD probe with `server/discover` first and fall back to `initialize` only when the server returns an error other than a recognised modern error, or does not answer in time (stdio page, "Backward Compatibility").

### Q3. Security statements that bind any MCP host or client

Sourced answer (specification index, "Security and Trust & Safety", read 2026-10-21):

- Hosts MUST obtain explicit user consent before invoking any tool.
- Tool descriptions and annotations are untrusted unless obtained from a trusted server.
- Hosts MUST NOT transmit resource data elsewhere without user consent.

### Q4. Host-side transport support observed in Omp (informational)

Upstream Omp documentation (`mcp-protocol-transports.md`) states that its MCP client implements `StdioTransport`, `HttpTransport` (Streamable HTTP), and `LegacySseTransport` (revision 2024-11-05), selected by config `type` (`stdio` default, `http`, `sse`). This is the Omp host's behaviour, not the MCP specification. Omp reads configs from root `mcp.json` and `.mcp.json`, and from plugin manifests (upstream `mcp-config.md`).

### Q5. Which transport Realm uses

Decided in Phase 5 (P5-D9). Realm serves MCP over stdio with revision 2026-07-28 semantics: stateless per-request handling where protocol version and client capabilities travel in each request; answers the `server/discover` probe for modern clients; answers the `initialize` handshake for `initialize`-based clients (the probe-then-fallback rule is cited in Q1-Q2, "Backward Compatibility"). Stdio framing follows Q2 by reference: newline-delimited JSON-RPC, no embedded newlines, nothing but MCP messages on stdout, stderr for logs, shutdown by closing stdin.

Only one spec-verified revision string was used when Q5 was decided: `2026-07-28`. The upstream-only string named in Q1 remains upstream-only and unverified. Q6 (2026-10-29) supersedes the single-revision part: the same server also answers the legacy revisions 2025-11-25 and 2025-06-18 through `initialize`, because a legacy client fails against a modern-only server.

### Q6. Protocol eras and result shapes

Read date: 2026-10-29. Sources:

| Source | URL |
| --- | --- |
| Versioning and compatibility, revision 2026-07-28 (terminology, version negotiation, the client and server era matrix, "Dual-era") | https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning |
| Tools, revision 2026-07-28 (the `tools/call` result and structured content) | https://modelcontextprotocol.io/specification/2026-07-28/server/tools |
| Schema reference, revision 2026-07-28 (`Result`, `DiscoverResult`, `ListToolsResult`, `CallToolResult`, `UnsupportedProtocolVersionError`) | https://modelcontextprotocol.io/specification/2026-07-28/schema |
| Lifecycle, revision 2025-11-25 (the `initialize` handshake and "Version Negotiation") | https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle |

Finding that prompted this answer. Q5 decided that Realm answers both `server/discover` and `initialize`, but release 0.2.0 answered `initialize` with `protocolVersion: "2026-07-28"` and returned bare tool outcomes, so it matched neither era. Checked on 2026-10-29 with the real hosts on this machine, each in an isolated home, against the released 0.2.0 build attached to the realm account's stack:

- Claude Code 2.1.308, `claude mcp list`: failed to connect, "Server's protocol version is not supported: 2026-07-28". A client that does not support the version in the server's answer disconnects (lifecycle page, "Version Negotiation"), so 0.2.0 was unusable from Claude Code.
- Grok Build 1.0.46, `grok mcp doctor`: handshake accepted and 6 tools discovered. It accepted the modern revision string, but the tool results had no `content` for the model to read.

Sourced answers:

- A legacy client (`initialize`-based, 2025-11-25 and earlier) fails against a modern-only server and works against a dual-era one. A dual-era server selects its behaviour from how the client opens: a request carrying modern per-request `_meta` is served statelessly under the modern revision, and an `initialize` request selects the legacy revision for the stdio process (versioning page, matrix and "Dual-era").
- Modern results: `Result.resultType` is required, and "Servers implementing this protocol version MUST include this field" (schema). `DiscoverResult` requires `resultType`, `supportedVersions`, `capabilities`, `ttlMs` and `cacheScope`, and carries the server identity in `_meta["io.modelcontextprotocol/serverInfo"]`. `ListToolsResult` requires `resultType`, `ttlMs` and `cacheScope`. `CallToolResult` requires `resultType` and `content`, and has optional `structuredContent` and `isError`; "a tool that returns structured content SHOULD also return the serialized JSON in a TextContent block" (tools page). Tool failures are reported inside the result with `isError: true`, not as protocol errors (schema, `CallToolResult.isError`).
- A modern request naming a version the server does not serve gets `UnsupportedProtocolVersionError`, code -32022, with `data.supported` and `data.requested` (versioning page).
- Legacy handshake: "If the server supports the requested protocol version, it MUST respond with the same version. Otherwise, the server MUST respond with another protocol version it supports. This SHOULD be the latest version supported by the server." The `initialize` result carries `protocolVersion`, `capabilities` and `serverInfo` (lifecycle page).
- The modern schema defines no `ping`. The legacy revisions do.

Realm's behaviour (`src/mcp/protocol.ts` holds the constants and every result shape, `src/mcp/server.ts` the routing):

| Method | Modern (`_meta` names 2026-07-28) | Legacy (after `initialize`) |
| --- | --- | --- |
| `server/discover` | `resultType`, `supportedVersions` (2026-07-28, 2025-11-25, 2025-06-18), `capabilities`, `_meta` server identity, `ttlMs`, `cacheScope` | the same (a modern method) |
| `initialize` | not part of the revision | `protocolVersion` (the requested one when it is 2025-11-25 or 2025-06-18, otherwise 2025-11-25), `capabilities`, `serverInfo` |
| `tools/list` | `resultType`, `tools`, `ttlMs`, `cacheScope` | `tools` |
| `tools/call` | `resultType`, `content` (one text block holding the outcome as JSON), `structuredContent` (the dispatcher outcome), `isError` | the same without `resultType` |
| `ping` | method not found | `{}` |
| a version in `_meta` that is not served | error -32022 with `data.supported` and `data.requested` | not applicable |

A request that carries neither a handshake nor `_meta` is served in the server's own (modern) revision, so a bare client still gets an answer. `isError` is true for a refused outcome and for a thrown `RealmError`, so the model sees the failure; the outcome itself is the frozen tool contract and is unchanged, and the ACP surface still returns it as is. `serverInfo.version` and the ACP `agentInfo.version` read the package manifest (`src/core/package-version.ts`); 0.2.0 advertised 0.0.0. The tool descriptors state what the frozen tool schema enforces (no unknown keys, the same required keys, types and bounds), and `test/mcp/descriptors.test.ts` pins the two together.

No descriptor has a combinator, an enum or a conditional at its root. The Anthropic Messages API rejects such a tool with a 400 (`tools.N.custom.input_schema: input_schema does not support oneOf, allOf, or anyOf at the top level`), and one rejected tool fails the whole request, so a host that loads the server would fail every model turn (reported against Claude Code in https://github.com/anthropics/claude-code/issues/65896 and against other Anthropic clients in https://github.com/home-assistant/core/issues/160565; read 2026-10-29). The 0.2.0 `exec` descriptor had a root `oneOf` for "exactly one of argv, or shell with script". It is now prose in the descriptor, and the dispatcher keeps enforcing it through the frozen schema's `if`/`then`/`else`. A connection check cannot show this defect, because it never sends a schema to a model; the descriptor test guards it instead.

Checks. `test/mcp/server.test.ts` covers each era's shapes, the negotiation, the unsupported-version error and `ping`. `npm run check:mcp` drives one session in both eras against the built server (it accepts a fail-closed attach refusal when no daemon can start, so a runner without Podman checks only that refusal). Scenario 6 of the production live suite handshakes as a legacy client and then sends a modern request to the same process. After the change, on 2026-10-29 with a build of this change attached to the realm account's stack: Claude Code `claude mcp list` reports Connected, and Grok Build `grok mcp doctor` reports the handshake accepted (protocol 2025-11-25) and 6 tools discovered. Muse Code and Omp have no connectivity command, and the Hermes Agent install on this machine is not usable, so they were not checked. No model-driven tool call through any host was run, because it needs a model.

## Blocked module

MCP transport code (Phase 5). Nothing else is blocked by this note.

## Not in this note

- No transport code, no server, no client, no `mcp.json`.
- No URL guessed. The Streamable HTTP page is marked as not read.

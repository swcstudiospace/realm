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

Not decided here. Phase 5 chooses it and records the decision. This note does not choose a transport and does not authorise any transport code.

## Blocked module

MCP transport code (Phase 5). Nothing else is blocked by this note.

## Not in this note

- No transport code, no server, no client, no `mcp.json`.
- No URL guessed. The Streamable HTTP page is marked as not read.

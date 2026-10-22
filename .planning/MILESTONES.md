# Milestones

## v1.0 (Archived: 2026-10-22; provisional name for the 0.1.x release line)

**Phases completed:** 7 phases, 40 plans (task count not recomputed in this archive)

**Key accomplishments:**
- createRealmHandle wires RuntimeConfig plus real adapters into one LifecycleController and one ToolDispatcher sharing a single LockTable, with OMP-01/OMP-05 tests and structural pins
- MCP revision handling, ACP v1 plus realm/tool extension, and Omp API names verified against the official pages, all pinned by exact-string doc tests.
- Newline-delimited JSON-RPC 2.0 stdio server over the shared dispatcher: probe-plus-initialize handling, six-tool unchanged-map routing, and a client-shaped end-to-end drive, with no tool logic in the surface.
- ACP v1 stdio agent with the realm/tool Realm extension routing all six ToolCall maps unchanged to ToolDispatcher.call, covered by nine TOOL-05 cases over in-memory streams
- Same ToolCall through MCP and ACP returns outcome-equal payloads on one dispatcher, a static guard proves the three surfaces hold no tool logic, and the taxonomy cites all six Phase 5 IDs.
- NDJSON control-channel wire format with request ids and catalogue-code-only errors, plus 0700/0600 socket guards bounded by SOCKET_TIMEOUT_MS — no daemon logic.
- Single-owner daemon with reap-before-serve, four-method channel dispatch, and graceful down shutdown, sharing the composition-root wiring with realm mcp
- `realm` CLI with up/down/status/doctor/mcp, exits 0/1/2, detached argv-form spawn, probe-first up with bounded PODMAN_MISSING, and the Phase 5 MCP server over stdio
- Eight-item doctor report with control-channel and agentos checks carrying fix texts, plus the package.json bin entry at the compiled CLI

---

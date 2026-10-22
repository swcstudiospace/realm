# 01-02 Summary: integration gate notes (anda, omp, mcp, acp)

Requirement: FOUND-03 (gate notes). Decisions applied: D-03, D-06, D-16, D-17, D-18. Read date for every source: 2026-10-21 (ISO 8601).

## Files written

| File | Blocks | Outcome |
| --- | --- | --- |
| `docs/integration/anda.md` | `src/anda/` (Phase 3); record in `docs/integration/anda-decision.md` | D-06 position checked, not confirmed. HTTP surface documented; client credentials, RPC parameter schema and version handshake recorded as not documented in prose. Licence conflict recorded. |
| `docs/integration/omp.md` | `plugin/` (Phase 5) | Manifest, lifecycle hooks and status surface recorded with sources. Spec q4 (host write-tool removal in required mode) recorded as OPEN for Phase 5. No plugin code or manifest. |
| `docs/integration/mcp.md` | MCP transport code only | Spec revision 2026-07-28; stdio and Streamable HTTP bindings; security statements. |
| `docs/integration/acp.md` | ACP transport code only | Protocol v1 and v2 documented; stdio defined; Streamable HTTP is a draft; remote-transport discrepancy recorded. |

## URLs read

Anda (https://github.com/ldclabs/anda and raw files under https://raw.githubusercontent.com/ldclabs/anda/main/):
- `README.md`, `Cargo.toml`, `LICENSE-MIT`, `LICENSE-APACHE`, `MCP_INTEGRATION.md`, `docs/architecture.md`
- `anda_core/Cargo.toml`, `anda_engine/Cargo.toml`, `anda_engine_server/Cargo.toml`, `anda_engine_server/README.md`, `anda_engine_server/src/lib.rs`, `anda_engine/src/engine.rs`, `anda_cli/README.md`

Omp:
- https://omp.sh/, https://omp.sh/docs, https://omp.sh/docs/extension-authoring, https://omp.sh/docs/marketplace
- Upstream `docs/` pages (`extensions.md`, `extension-loading.md`, `hooks.md`, `cli-reference.md`, `sdk.md`, `marketplace.md`, `mcp-config.md`, `mcp-protocol-transports.md`, `gemini-manifest-extensions.md`) at https://github.com/can1357/oh-my-pi, read through a local read-only clone at commit `0e2411c0df59fce8c56dc03a5f1c9afffcb0d746` (2026-10-02). The clone was read only; nothing was run.

MCP:
- https://modelcontextprotocol.io/specification/2026-07-28 (rendered for `latest`)
- https://modelcontextprotocol.io/specification/2026-07-28/basic/transports
- https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/stdio
- https://modelcontextprotocol.io/llms.txt

ACP:
- https://agentclientprotocol.com/llms.txt
- https://agentclientprotocol.com/get-started/introduction
- https://agentclientprotocol.com/protocol/v1/overview, `/v1/initialization`, `/v1/transports`
- https://agentclientprotocol.com/protocol/v2/overview, `/v2/initialization`, `/v2/transports`

## Confirmed findings

- **Anda licence conflict (confirmed in documentation).** Workspace `Cargo.toml` sets `license = "MIT OR Apache-2.0"`, inherited by anda_core 0.17.1, anda_engine 0.17.4 and anda_engine_server 0.17.0. Both `LICENSE-MIT` and `LICENSE-APACHE` are present. The README, anda_engine_server README and anda_cli README say "MIT License" only. The GitHub repository page reads "Apache-2.0, MIT licenses found". This is recorded for the Phase 3 decision; no legal determination is made.
- **Anda version handshake: not documented.** `AppInformation` has no protocol-version field; `app_version` appears only in a startup log line.
- **Anda TypeScript reachability.** The HTTP contract (`POST /{id}`, CBOR or JSON, 401/415/400 behaviour) is documented. No TypeScript, npm, N-API or WASM binding was found in the files read. ICP envelope and CWT formats are only in Rust crates not read here.
- **Omp spec q4 open.** Existing switches (`--tools`, `--no-tools`, `setActiveTools`, `tool_call` blocking, `registerFileWriteFallback`) do not show a verified way to make required mode hold. Phase 5 must test a candidate before choosing.
- **MCP revision and transports.** Revision 2026-07-28; stdio and Streamable HTTP. The Streamable HTTP page was not read directly.
- **ACP.** v1 and v2 both documented (`protocolVersion` 1 and 2). stdio is the only defined transport; Streamable HTTP is a draft. The introduction page mentions HTTP or WebSocket for remote agents, which the transports pages do not define. Recorded as a discrepancy.

## Not done (by design)

- No integration source code, plugin code, manifest, `plugin/` directory, or `src/anda/` file.
- No `npm`, `node`, build, test or install command. No package was added.
- `docs/specs/realm-spec.xml` not modified. No file outside the four notes and this summary written.
- Pages not fetched from official sites are marked as upstream-sourced in the notes; no URL was guessed.

## Checks run

- Scan of the four notes for the host-path prefixes (root, home, and Users directories under `/`) and for secret-shaped text: no matches.
- Notes contain the required URL, read date and blocked-module statements per the plan's acceptance criteria.

## Hand-off to Phase 3 and Phase 5

- Phase 3: create `docs/integration/anda-decision.md`. Resolve the Anda licence conflict and the Q2 to Q4 items in `anda.md` before any Anda dependency or client code.
- Phase 5: answer spec q4 in `omp.md`; choose MCP and ACP transports in `mcp.md` and `acp.md`.

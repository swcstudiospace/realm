# Anda integration note

Status: gate note (FOUND-03, decision D-06). No Anda code exists in this phase.
Blocks: `src/anda/` (Phase 3). Phase 3 records its decision in `docs/integration/anda-decision.md` (ANDA-01), which does not exist yet.

## Position under check (not a fact)

D-06 plans a **TypeScript client over the Anda Engine HTTP API**, with no Rust shim unless the documentation shows no TypeScript-reachable surface. This note records what the sources show for and against that position. It does not confirm it.

Rule: a silent or "not documented" answer reopens the choice in Phase 3. The choice is not changed silently here.

## Official sources read

Read date: 2026-10-21 (ISO 8601).

| Source | URL |
| --- | --- |
| Repository page | https://github.com/ldclabs/anda |
| README | https://raw.githubusercontent.com/ldclabs/anda/main/README.md |
| Workspace manifest | https://raw.githubusercontent.com/ldclabs/anda/main/Cargo.toml |
| anda_core manifest | https://raw.githubusercontent.com/ldclabs/anda/main/anda_core/Cargo.toml |
| anda_engine manifest | https://raw.githubusercontent.com/ldclabs/anda/main/anda_engine/Cargo.toml |
| anda_engine_server manifest | https://raw.githubusercontent.com/ldclabs/anda/main/anda_engine_server/Cargo.toml |
| anda_engine_server README (HTTP contract) | https://raw.githubusercontent.com/ldclabs/anda/main/anda_engine_server/README.md |
| anda_engine_server source (router, `AppInformation`) | https://raw.githubusercontent.com/ldclabs/anda/main/anda_engine_server/src/lib.rs |
| anda_engine source (`Engine::agent_run`, `tool_call`, `information`) | https://raw.githubusercontent.com/ldclabs/anda/main/anda_engine/src/engine.rs |
| Architecture document | https://raw.githubusercontent.com/ldclabs/anda/main/docs/architecture.md |
| MCP integration document | https://raw.githubusercontent.com/ldclabs/anda/main/MCP_INTEGRATION.md |
| anda_cli README | https://raw.githubusercontent.com/ldclabs/anda/main/anda_cli/README.md |
| License texts | https://raw.githubusercontent.com/ldclabs/anda/main/LICENSE-MIT and https://raw.githubusercontent.com/ldclabs/anda/main/LICENSE-APACHE |

Version observed in manifests: anda_core 0.17.1, anda_engine 0.17.4, anda_engine_server 0.17.0 (workspace members, each with its own version).

## Questions and answers

### Q1. Engine boundary: where does the Rust runtime stop and a callable surface begin?

Sourced answer (partly documented).

- The runtime is `anda_engine`: `Engine` exposes `agent_run(caller, AgentInput)` and `tool_call(caller, ToolInput<Json>)`, and `information()` returns an `EngineCard` (`anda_engine/src/engine.rs`, read 2026-10-21).
- `anda_engine_server` is "a thin, stateless HTTP front-end" that "only authenticates callers and forwards typed requests to the target engine" (server README, "Architecture" section).
- The HTTP boundary is documented in the server README "HTTP contract" table:
  - `GET /`, `GET /.well-known/information`, `GET /.well-known/agents` return `AppInformation` (anonymous allowed; responses `Cache-Control: no-store`).
  - `GET /.well-known/agents/{id}` returns the public `EngineCard` (exported functions only).
  - `POST /{id}` returns the RPC result for `agent_run`, `tool_call`, or `information`. `{id}` is an engine principal or `default`.
- The Rust crates (`anda_core`, `anda_engine`) are the in-process boundary. Nothing in the files read documents an in-process FFI, N-API, or WASM binding.

### Q2. Is there a TypeScript-reachable surface?

Sourced answer: **the HTTP surface is language-agnostic and documented; no TypeScript client is documented.**

- The wire contract is HTTP: `POST /{id}` with `Content-Type: application/cbor` or `application/json` (or a `+cbor`/`+json` suffix). Other types return `415`; an undecodable envelope returns `400`; invalid credentials return `401`; execution and parameter errors return HTTP `200` with an error inside `RPCResponse::Err`. The default body limit is 2 MiB (server README).
- No TypeScript, npm, N-API, or WASM binding was found in the README and manifest files read. This is a search of the files listed above, not of the whole repository. [INFERENCE] that none exists outside those files.
- The Rust-only CBOR/serde types for `AgentInput`, `ToolInput`, and the RPC envelope are not described in prose in the files read. Their JSON or CBOR field layout is therefore **not documented** in the sources read; a TypeScript client would need it from the Rust source (`not documented` in prose).

### Q3. Client authentication: can a TypeScript client produce the credentials the server verifies?

Sourced answer (partly documented, partly not).

- RPC calls accept `Authorization: ICP ...` (ICP `SignedEnvelope`) or legacy `ic-auth-*` headers, or a bearer CWT (server README, "Authentication").
- On RPC calls the envelope digest must equal the **SHA3-256 hash of the received body** (server README).
- Bearer tokens are verified as CWT with a valid principal in `sub` and an `exp` claim, when trusted Ed25519 keys are configured (server README).
- The envelope format, the CWT claim set beyond `sub`/`exp`/`nbf`, and the signing algorithm for ICP envelopes are **not documented** in prose in the files read. They are implemented in the Rust crates `ic_auth_types` and `ic_auth_verifier`, which are external to this repository's README set and were not read.
- Security notes in the server README apply to any client: direct-key signatures give no freshness and no automatic engine binding; clients should set `RequestMeta::engine` and use TLS. The server does not enforce `aud` or scope claims on bearer tokens.

### Q4. Version handshake: what surface reports a protocol or engine version?

Sourced answer: **not documented** as a protocol or engine version.

- `AppInformation` (`anda_engine_server/src/lib.rs`, the type at lines 11 to 21 of the types module read) has these fields: `engines`, `default_engine`, `caller`, `start_time_ms`, `extra_info`. No protocol-version field was observed.
- `app_version` is set with `with_app_version` and appears only in the `serve()` startup log line (`log::warn!("{}@{} listening on {:?}", ...)`). It is not returned on any HTTP route read.
- `extra_info` is operator-supplied metadata configured with `with_extra_info`; it is not a protocol version.
- `EngineCard` carries `id` and `info: AgentInfo`. `AgentInfo` fields `handle`, `name`, and `description` were observed; other fields were not read, so a version field there is **not documented** here.
- Conclusion: Phase 3 must treat version compatibility as unverified. It may not rely on an advertised version. The version-mismatch error `ANDA_VERSION_MISMATCH` (spec n6) can only be raised once a handshake surface is found or defined. [INFERENCE]

### Q5. Does the Anda MCP client matter to Realm?

Sourced answer, informational. Anda consumes external MCP servers through its MCP client (`MCP_INTEGRATION.md`, read 2026-10-21): stdio and Streamable HTTP transports, MCP revision `2026-07-28` and older `initialize`-based revisions. This is not a Realm requirement. See `docs/integration/mcp.md`.

### Q6. Licence

Sourced answer: **conflict in the documentation; confirmed as a conflict, not resolved here.**

| Evidence | Says |
| --- | --- |
| Workspace `Cargo.toml`, `[workspace.package]` | `license = "MIT OR Apache-2.0"`, inherited by member crates via `license.workspace = true` (anda_core, anda_engine, anda_engine_server) |
| `LICENSE-MIT` and `LICENSE-APACHE` both present at the repository root | Dual files present |
| README "License" section, anda_engine_server README, anda_cli README | "licensed under the MIT License" only |
| GitHub repository page (read 2026-10-21) | Sidebar: "Apache-2.0, MIT licenses found" |

Consequence: the Cargo metadata and the license files say dual-licensed; the prose READMEs say MIT only. The conflict is recorded for the Phase 3 decision. This note makes no legal determination.

## Open questions left to Phase 3

1. Client-side credential production (Q3): can an ICP envelope and SHA3-256 body digest be produced from TypeScript against the Rust reference? Needs a spike.
2. RPC parameter schema (Q2): the CBOR/JSON shape of `AgentInput`, `ToolInput`, and the RPC envelope. Not documented in prose.
3. Version handshake (Q4): no surface found. `not documented`.
4. Licence (Q6): resolve before any Anda code or dependency is added.

Rule restated: if any of Q2 to Q4 remains `not documented` at Phase 3 entry, the choice in D-06 is reopened there, and `anda-decision.md` must say which option was taken. A Rust shim is one option; it is not decided here.

## Not in this note

- No Rust code, no shim, no `src/anda/` file, no Anda dependency.
- No guessed URLs. Every URL above was read at the listed path.

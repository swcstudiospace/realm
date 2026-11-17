# Anda replacement research (ANDA-01 to ANDA-04)

Status: adopted on 2026-11-17 as the rationale of D-27-01 (`docs/integration/runtime-decision.md`, section "Anda bridge removal (Phase 27, ANDAX-01, 2026-11-17)"). It was written as research that decides nothing; the owner decided on 2026-11-17 and section 10 records the answers to its five questions. The evidence sections are unchanged and keep their original read dates.
Read date of every external source below: 2026-11-17 (ISO 8601), unless a row says otherwise.
Scope: whether Realm should keep, replace or drop the Anda bridge (`src/anda/`), and whether a better mechanism than MCP exists for connecting agents and tools to the sandbox.
Method: repository files were read in a worktree of `origin/main` (release 0.3.54). External sources were read with the read tool, or reached through a web search result. The source table marks which. Nothing in this note was run: no build, no test, no live handshake.

Labels used below:

- **Observed**: read in this repository's files on 2026-11-17.
- **Documented**: stated by an external source in the table in section 4.
- **Search-only**: the claim comes from a web search result summary and its primary page was not opened. Treat it as a lead to verify, not a fact.
- **[INFERENCE]**: my reasoning from observed or documented facts.

## 1. Bottom line

1. **Drop the Anda bridge entirely. Do not replace it with a new connection mechanism.** The bridge is an optional health probe. It makes one anonymous `GET` to `/.well-known/information`, carries no tool call and no credential, and exists only to move a session between `active` and `degraded` (section 2). No file I read names a capability that Realm needs from Anda and cannot get elsewhere.
2. **Anda needs no bridge to use Realm.** The recorded direction since 2026-10-22 (P5-D1) is that Anda consumes Realm as an MCP client over stdio. Anda's own documentation says its MCP client supports stdio, Streamable HTTP and OAuth 2.1 (S22). That path already works through `realm mcp` and does not touch `src/anda/`.
3. **MCP over stdio stays the connection mechanism for agent hosts.** For a local, single-user sandbox it has the smallest attack surface of every option compared: no listener, no DNS rebinding exposure, no token to pass through. The MCP authorization specification itself says stdio implementations SHOULD NOT follow the OAuth flow and should take credentials from the environment (S1).
4. **None of the alternatives beats a 0600 socket against a same-user attacker, and the workload is a same-user attacker.** The sandbox workload runs under the realm account's uid (`docs/integration/openshell.md`, keep-id finding). mTLS, SPIFFE, bearer tokens and Biscuit all reduce to "protect a secret from the same uid", which a 0700 directory and a 0600 socket already do. Section 5 explains where each one still helps.
5. **Two small hardening items are worth scheduling regardless of Anda**: tool annotations on the six MCP tools (observed missing), and, as a spike only, per-host scoped capabilities for least privilege and audit attribution.
6. **Honest limits.** I could not find why the original spec wanted "Anda Engine components the sandbox needs" (`docs/specs/realm-spec.xml`, which never lists them). If the owner has a concrete Anda capability in mind (memory, TEE, a specific tool), that is the one input that would change this recommendation. It is open question 1.

## 2. What the Anda bridge is, and what it was for

### 2.1 What it does today (observed)

| Fact | Evidence |
| --- | --- |
| The bridge is attached only when the runtime config names `andaUrl`. With no `andaUrl`, no bridge exists and a session goes `active` without one. | `src/runtime/config.ts` (`andaBridgeRequired`), `src/realm/compose.ts`, `src/daemon/seams.ts` (`defaultBridge`), `docs/policy-reference.md` |
| The only request is an anonymous `GET /.well-known/information`. `POST /{id}` (the RPC route) is not used, and no credential is produced. | `src/anda/client.ts` header comment, `docs/integration/anda-decision.md` sections 1 and 6 |
| The "version handshake" is a shape check on three fields. Anda publishes no version surface, so a pass proves only that the body has the documented shape. | `src/anda/shape.ts`, `docs/integration/anda-decision.md` section 3, `docs/integration/anda.md` Q4 |
| The bridge publishes `up`, `down` and `mismatch`. The controller turns them into state changes: `down` moves `active` to `degraded` with `ANDA_UNREACHABLE`, `up` moves it back, `mismatch` moves it to `error` with `ANDA_VERSION_MISMATCH`. With `andaUrl` set, an unreachable engine also refuses the start. | `src/lifecycle/controller.ts` (`onBridgeEvent`), `src/core/ports.ts` (`BridgePort`), `docs/policy-reference.md` |
| **The bridge is the only producer of `degraded`.** A search of `src` finds exactly one `transition("degraded", ...)`, in `onBridgeEvent`. Its own comment at `src/lifecycle/controller.ts` line 342 says the probe never produces `degraded`. | `src/lifecycle/controller.ts` lines 342 and 791 |
| The bridge has never connected to a real engine. ANDA-01 to ANDA-04 are "Partial (live-gated)". The verification report re-verified on 2026-11-17 keeps four items open, all about Anda: the live behaviour of ANDA-01 to ANDA-04 and the licence question OQ-P3-11. | `.planning/REQUIREMENTS.md` (lines 179 to 182, 227, 345 to 348), `.planning/milestones/v1.0-phases/03-container-runtime-and-bridges/03-VERIFICATION.md` (rows 10, 11, 18) |
| Only unit and fake-engine evidence exists. Production live runs ran with no engine configured, and the doctor `anda-bridge` check warns for that reason. | `test/anda/*`, `test/support/fake-anda.ts`, `docs/integration/openshell.md` (lines 264 and 482) |

### 2.2 What capability did Realm need from Anda that nothing else provides?

**None that I can identify.** The evidence:

- The product spec says "Anda Engine components reached from the TypeScript client" and "the Anda Engine components the sandbox needs" but never lists a component. It says the boundary "is decided by the documentation spike" (`docs/specs/realm-spec.xml`, the original-layering, bridge and open-question passages).
- The requirements ask for a connection, a handshake, a reconnect policy and an optional Rust shim (ANDA-01 to ANDA-04). They name no call to make once connected.
- The Phase 3 decision narrowed the surface to the health route and deferred every real call to OQ-P3-10, which blocks the first phase that calls `POST /{id}`. No later phase called it.
- The Phase 5 decision reversed the direction: Anda consumes Realm over MCP (P5-D1, `docs/integration/anda-decision.md` section 7). In that direction Anda is the client and Realm needs no code that dials Anda.
- The repository's own hardening note treats an Anda-related repository as "Reference for H3 only", with a licence "inconsistent (Apache-2.0 header, MIT README)" (`docs/integration/hardening-plan.md`, line 136).

The one behaviour the bridge buys is a **status signal**: "the sandbox's optional Anda engine is down, so show `degraded`". That is a monitoring feature, not a capability, and it matters only to someone who runs an Anda engine and sets `andaUrl`. The 2026-10-28 owner decision already made `active` independent of the bridge when `andaUrl` is absent, and the audit records that no engine is configured on any host.

### 2.3 Licence and maintenance state of Anda (documented)

- The workspace manifest says `license = "MIT OR Apache-2.0"` (S22, raw `Cargo.toml`, line 25). The repository README and the server README say "licensed under the MIT License" (S22). The GitHub page reports "Apache License 2.0" (S22, repository page). The conflict recorded as OQ-P3-11 is **still present on 2026-11-17**. This note makes no legal determination.
- Realm today reaches Anda only over HTTP and vendors nothing, so the conflict never became a blocker for running code. Both candidate licences (MIT, Apache-2.0) are permissive and the manifest offers them as a choice; whether that is enough for the AGPL-3.0-only Realm to vendor Anda code is a question for the owner. Dropping the bridge removes the question.
- The project is active: the repository page lists a review file dated 2026-09-23 and workspace crates at 0.17.x (S22; versions as read on 2026-10-21 in `docs/integration/anda.md`, not re-read today).

## 3. How tools reach agents today (observed)

| Surface | Transport and framing | Who connects | Authentication today | Source |
| --- | --- | --- | --- | --- |
| `realm mcp` | stdio, newline-delimited JSON-RPC 2.0. Dual era: revision 2026-07-28 statelessly, legacy revisions through `initialize`. Six tools: `exec`, `read`, `write`, `list`, `status`, `retry`. | The agent host launches it as a child process. | None at the protocol layer. The trust is process lineage: the host started it. | `src/mcp/server.ts`, `docs/integration/mcp.md` Q5 to Q7 |
| `realm acp` | stdio, ACP v1. One extension method `_realm/tool`. Answers `session/new` and `session/prompt` with -32601, so a standard ACP host cannot start a session with it. | A Realm-aware client. | None at the protocol layer. | `src/acp/agent.ts`, `docs/integration/acp.md` Q5 |
| Omp plugin | In-process extension talking to the daemon. | Omp. | The control socket. | `src/omp/`, `docs/integration/omp.md` |
| Control socket | AF_UNIX, newline-delimited JSON with request ids, methods `status up down doctor tool metrics host-boot`. Directory mode 0700, socket 0600, owner checked. | `realm` CLI, `realm mcp`, `realm acp`, the Omp plugin. | **Filesystem permissions only.** No peer-credential check, no token. | `src/daemon/channel.ts`, `AGENTS.md` (Safety) |
| Compute driver socket | gRPC over AF_UNIX, 0600 in a 0700 parent. | The OpenShell gateway. | **Filesystem permissions only.** The server binds with `ServerCredentials.createInsecure()` (`src/runtime/driver/server.ts` line 168). | `src/runtime/driver/server.ts` |
| Runtime control socket in the sandbox | AF_UNIX plus TLS. | The driver and the supervisor. | Server certificate from a one-use CA that Realm makes (leaf has `extendedKeyUsage = serverAuth`). The runtime requires a client certificate: a handshake without one was rejected live. | `src/runtime/driver/channel.ts`, `docs/integration/openshell.md` (verified-live list) |
| OpenShell gateway | TLS and JWT profile; client material under a directory the realm owns. | The Realm host stack. | mTLS plus gateway JWT. | `docs/integration/openshell.md` (lines 136 to 141) |

**Correction to the assignment's premise.** The compute driver does not use "gRPC with mTLS over a Unix socket". Its host-facing socket is insecure-credential gRPC protected by file modes. mTLS appears in two other places: the OpenShell gateway, and the runtime control socket inside the sandbox. Option 4 below is judged on that corrected fact.

**Trust boundaries that matter for the choice (observed):**

- The workload runs as the realm account's uid, not as a separate user. The sandbox and the realm account share one kernel uid under keep-id, and a workload process described the realm account's user keyring by serial (`docs/integration/openshell.md`, keyring section). A uid check therefore never separates the workload from a host-side process.
- Sockets the workload can reach are an accepted residual: a unix socket a host process creates in the pinned workspace after the sandbox starts is reachable from the sandbox (owner decision 2026-10-28; Landlock gains a unix-socket connect scope only with kernel 6.12, and the host runs 6.8).
- The Realm control socket lives in the state directory's run directory, not in the workspace. [INFERENCE] The workload therefore cannot reach it by path unless an operator breaks the operator rule "keep no sockets inside the project directory".
- No host secrets are injected into the sandbox by default (`AGENTS.md`, Safety). There is no downstream API token for Realm to leak or pass through.

### 3.1 What `realm mcp` already does and lacks

Does (observed):

- Opens no network listener. Nothing to rebind, nothing to reach from a browser.
- Serves six static tool descriptors with no root combinator, pinned to the frozen schema by `test/mcp/descriptors.test.ts`. Tool descriptions are first-party and do not change after approval.
- Forwards every call to the daemon, which runs one dispatcher with fail-closed policy, root allowlist, credential-path denial, and an audit line before execution (`admission`) and after (`result`) (`src/tools/dispatch.ts` header).
- Registers itself only in user-level host config, with an ownership receipt, through `realm host install` (`docs/integration/mcp.md` Q8).
- Boots in six checked steps and exposes tools only after the boot settles, refusing calls when the realm is not active.

Lacks (observed or inferred):

- **No tool annotations.** A search of `src/mcp/` finds no `annotations`, `readOnlyHint` or `destructiveHint`. The 2026-07-28 tools page defines an optional `annotations` property and tells clients to treat annotations as untrusted unless the server is trusted (S4). Annotations would let a host prompt for `exec` and `write` and skip the prompt for `read`, `list` and `status`. This is cheap, and a host may ignore it.
- **No per-surface authorization.** Any process that can open the control socket can call `tool` with any of the six tools and can call `down`. There is no notion of "this host may only read".
- **No caller identity in the audit trail.** The audit identity is the `up` correlation id (`src/tools/dispatch.ts`, D-1703). `--host ID` labels the session for boot reports, but it is a self-declared label, not a verified identity. [INFERENCE from `docs/integration/mcp.md` Q7.]
- **No treatment of tool output as untrusted input to the model.** `exec` and `read` return workload-controlled text straight into the model context. Realm contains what the workload can do; it does not filter what the workload can say. Section 6 covers this.

## 4. Sources read

| ID | Source | URL | How read |
| --- | --- | --- | --- |
| S1 | MCP specification 2026-07-28, Authorization | https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization | Read directly, lines 1 to 300 of 453 |
| S2 | MCP Security Best Practices (2026-07-28 docs) | https://modelcontextprotocol.io/docs/2026-07-28/tutorials/security/security_best_practices | Read directly, lines 1 to 763 of 999 |
| S3 | MCP specification 2026-07-28, Streamable HTTP transport | https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http | Read directly, lines 1 to 300 of 741 |
| S4 | MCP specification 2026-07-28, Tools | https://modelcontextprotocol.io/specification/2026-07-28/server/tools | Searched for annotation and consent text only |
| S5 | A2A specification, latest (1.0.0) | https://a2a-protocol.org/latest/specification/ | Read directly: lines 1 to 300 and section 7 (authentication and authorization) of 3960 lines; a search of the page for security terms |
| S6 | A2A v1.0 release notes and signed Agent Cards | https://a2a-protocol.org/latest/announcing-1.0/ and https://github.com/a2aproject/A2A/blob/main/docs/whats-new-v1.md | **Search-only** (primary pages not opened) |
| S7 | A2A joins the Agentic AI Foundation | https://a2a-protocol.org/latest/blog/2026/08/27/a-new-chapter-for-a2a-joining-the-agentic-ai-foundation/ | **Search-only** |
| S8 | ACP v1 transports | https://agentclientprotocol.com/protocol/v1/transports | Read directly |
| S9 | ACP remote transport RFD and OAuth RFD | https://agentclientprotocol.com/rfds/streamable-http-websocket-transport | **Search-only** |
| S10 | gRPC authentication guide | https://grpc.io/docs/guides/auth/ | Read directly, lines 1 to 300 of 421 |
| S11 | grpc-js server credentials source | https://raw.githubusercontent.com/grpc/grpc-node/master/packages/grpc-js/src/server-credentials.ts | Searched for the `createSsl` and `createInsecure` signatures |
| S12 | SPIFFE concepts | https://spiffe.io/docs/latest/spiffe-about/spiffe-concepts/ | Read directly |
| S13 | SPIRE peer tracking and the PID reuse race | https://github.com/spiffe/spire/blob/main/doc/plugin_agent_workloadattestor_unix.md (selectors page) | **Search-only** for the `peertracker` behaviour |
| S14 | Node.js has no peer-credential API; fd passing request closed | https://github.com/nodejs/node/issues/53391 (issue number from the search summary) | **Search-only** |
| S15 | Eclipse Biscuit and biscuit-wasm | https://www.biscuitsec.org/ , https://www.npmjs.com/package/@biscuit-auth/biscuit-wasm , https://projects.eclipse.org/proposals/eclipse-biscuit | **Search-only** |
| S16 | Macaroons, NDSS 2014 | https://www.ndss-symposium.org/ndss2014/ndss-2014-programme/macaroons-cookies-contextual-caveats-decentralized-authorization-cloud/ | **Search-only** |
| S17 | Cap'n Web and capnp-es | https://github.com/mnutt/capnp-es , https://www.jsdelivr.com/package/npm/capnp-es | **Search-only** |
| S18 | WebTransport over HTTP/3 draft | https://datatracker.ietf.org/doc/html/draft-ietf-webtrans-http3 | **Search-only** |
| S19 | Tool poisoning, rug pull, shadowing (Invariant Labs) | https://invariantlabs.ai/blog/introducing-mcp-scan | **Search-only** (the April 2025 notice itself was not opened) |
| S20 | CVE-2025-49596, MCP Inspector (Oligo Security) | https://www.oligo.security/blog/critical-rce-vulnerability-in-anthropic-mcp-inspector-cve-2025-49596 | **Search-only** |
| S21 | CVE-2025-6514, mcp-remote command injection | https://www.cve.org/CVERecord?id=CVE-2025-6514 | **Search-only**; only the record title was returned |
| S22 | Anda repository, manifests and MCP client note | https://github.com/ldclabs/anda , https://raw.githubusercontent.com/ldclabs/anda/main/Cargo.toml , https://raw.githubusercontent.com/ldclabs/anda/main/MCP_INTEGRATION.md | Read directly (repository page, license line, MCP transports and authorization lines) |
| S23 | Claude Code MCP documentation | https://code.claude.com/docs/en/mcp.md | Searched for transports and authentication |
| S24 | Codex MCP documentation | https://developers.openai.com/codex/mcp | Searched for transports and authentication |
| S25 | Agentic AI Foundation, MCP donation of 2025-12-09 | https://infoq.com/news/2025/12/agentic-ai-foundation/ (URL as listed in a search result; the announcement itself was not opened) | **Search-only** |

## 5. The mechanisms compared

Every verdict below is for one question: **how should an agent host or tool reach the Realm sandbox on one machine, for one user, when the workload is assumed malicious and failure must be closed?**

### 5.1 Summary matrix

| Mechanism | AuthN | AuthZ | Local-attack exposure | Hosts that speak it | Maintenance and licence | Fit | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- |
| MCP stdio (today) | Process lineage; no protocol auth | Policy in the daemon, not per host | No listener | The 15 `mcp-config` hosts with a recipe register a stdio launcher (see 5.2) | Open specification under the Agentic AI Foundation (S25); the spec evolves fast (three eras handled) | Best | **Keep** |
| MCP Streamable HTTP with OAuth 2.1 | OAuth 2.1 bearer, audience-bound | Scopes | New TCP listener: DNS rebinding, 0.0.0.0-day, any local user can connect | Several documented (Claude Code, Codex, Hermes, Kilo, Muse Code, Omp); none documented over a unix socket | Needs an authorization server | Poor locally | **Do not adopt**; revisit only for remote hosts |
| A2A 1.0 | TLS, per-request authN, optional mTLS | Server-defined | HTTP listener | None documented in the repo | Apache-2.0, Linux Foundation, 1.0.0 | Wrong shape | **No** |
| ACP | None in v1 stdio | None | stdio only; remote is an RFD | Editors acting as clients; Realm already serves it as a tool bridge | Open spec, remote still moving | Already used | **Keep as is; no change for Anda** |
| gRPC with mTLS on a unix socket | Client certificate | Interceptors | No listener beyond the socket | No host speaks gRPC for tools | grpc-js 1.14.6 is already a dependency (`package.json`) | Internal only | **No for hosts; keep internal use** |
| SO_PEERCRED and SPIFFE/SPIRE | Kernel uid, gid, pid | Selectors | Same-uid attacker passes | n/a | Node has no API; SPIRE is two extra daemons | Wrong threat | **No** |
| Capability tokens (Biscuit, Macaroons) | Token possession | Attenuated caveats | Same-uid reader of the token passes | Carried inside any transport | Biscuit: Eclipse, Apache-2.0; Macaroons: paper only | Real utility, little security | **Spike, optional** |
| Cap'n Proto / Cap'n Web RPC | Capability references | Object capabilities | Depends on transport | None | capnp-es pre-1.0; Cap'n Web MIT | Replaces the protocol | **No** |
| Unix socket plus fd passing | Kernel fd rights | Fd as capability | Same-uid | None | Node cannot send fds | Not buildable in Node | **No** |
| WebTransport | TLS | Server-defined | UDP and TLS listener | None | Node has no native server; draft | Wrong shape | **No** |

### 5.2 MCP: stdio, and Streamable HTTP with OAuth 2.1

**Specification state (documented).** The current revision is 2026-07-28. Authorization is optional. HTTP-based transports SHOULD follow it; stdio SHOULD NOT and should take credentials from the environment; other transports MUST follow established best practices for their protocol (S1). The authorization specification builds on OAuth 2.1 draft 13, RFC 9728 protected resource metadata (servers MUST implement it), RFC 8414 or OpenID Connect discovery, RFC 8707 resource indicators (clients MUST send `resource` in both the authorization and the token request), RFC 9207 issuer identification, and Client ID Metadata Documents. Dynamic Client Registration is **deprecated** as of 2026-07-28 and kept for compatibility (S1, S2). Bearer tokens MUST ride in the `Authorization` header on every request and MUST NOT appear in the query string (S1). Servers MUST NOT accept tokens not issued for them, which rules out token passthrough (S2). The 2026-07-28 revision also removed protocol-level sessions and the GET stream endpoint from Streamable HTTP (S3).

**Streamable HTTP's own local-security rules (documented, S3).** Servers MUST validate the `Origin` header on all incoming connections to prevent DNS rebinding, and respond 403 when it is present and invalid. Servers running locally SHOULD bind only to 127.0.0.1. Servers SHOULD implement authentication for all connections.

**Security properties of each transport for Realm.**

| Property | stdio | Streamable HTTP on loopback with OAuth |
| --- | --- | --- |
| Authentication | None, but the only peer is the parent process that spawned it | OAuth 2.1 bearer, audience-bound by RFC 8707. Needs an authorization server. [INFERENCE] For a single-user local daemon, hosting one is itself new attack surface and new state. |
| Authorization | Realm policy; no per-host scope | OAuth scopes, if Realm defines them. Realm defines none today. |
| Confused deputy | Not applicable: Realm is not an OAuth proxy and holds no downstream token | Applies only to MCP proxy servers with a static client ID, dynamic registration and a consent cookie (S2). Realm would not be one, but a bridge to an external identity provider could make it one. |
| Token passthrough | Not applicable: no tokens | Avoidable by design; the spec forbids it (S2). |
| DNS rebinding and localhost attacks | No listener. Not exposed. | Exposed unless Origin validation, loopback binding and authentication all hold. CVE-2025-49596 (MCP Inspector, CVSS 9.4) was an unauthenticated local proxy reachable from a web page through the 0.0.0.0 address or DNS rebinding; the fix added Origin validation and a session token (S20, search-only). |
| Cross-user exposure on a shared machine | None: child process of one user | Any local user can connect to 127.0.0.1 and must be stopped by the token. The 0600 control socket stops them without a token. |
| Transport confidentiality | In-process pipe | Loopback plaintext unless TLS is added. A local TLS certificate has the same trust-distribution problem as section 5.5. |
| Command execution risk on the client side | The host starts the command from its config. The spec lists a malicious startup command as a local-server risk (S2). `realm host install` limits what Realm writes. | Moves risk to OAuth metadata discovery. CVE-2025-6514 (mcp-remote OS command injection in the OAuth flow) shows the class (S21, search-only). |

**Which of the 19 runtimes speak it.** `docs/integration/mcp.md` Q8 documents `realm mcp --host ID` as a **stdio** command for the 15 `mcp-config` hosts that have an install recipe (Claude Code, OpenCode, Codex, Kimi CLI, Kimi Code, Cursor, Copilot, Qwen, Augment, Pi, Cline, Antigravity, Kilo, CodeBuddy and Hermes). Windsurf, Trae and ZCode are deferred (`recipe-pending`), and Omp uses its own extension (`AGENTS.md`, `src/host/runtimes.ts`). I re-read the quoted manual commands in Q8, not each recipe's file writer. Remote Streamable HTTP is documented for Claude Code (`claude mcp add --transport http`, with OAuth; S23), for Codex (a "Streamable HTTP" server type with OAuth, S24), and in the repository's host notes for Hermes, Kilo (`--url`), Muse Code (`streamable_http`) and Omp (`docs/integration/mcp.md` Q4). **Not surveyed**: the other runtimes' own HTTP support. **Not found**: any host documenting an MCP endpoint over a unix socket. The Claude Code page offers http, sse and WebSocket URLs (S23). An HTTP transport therefore means a TCP listener on every machine.

**Fit with Realm.** Poor for local use, for three reasons. It adds a listener where there is none. It needs credential issuance that Realm does not have. And it protects against an attacker (a remote web page, another local user) that the 0600 socket plus stdio already excludes. Streamable HTTP becomes interesting only if the owner wants a **remote** agent host, a container host or a second user to reach a Realm daemon. That is a different product decision, and it should start from a resource-server-only design: protected resource metadata, audience validation, Origin validation, and an external authorization server.

**Maintenance and licence.** MCP is under the Linux Foundation's Agentic AI Foundation, which received it on 2025-12-09 (S25, search-only). The specification has changed three times in the span Realm handles (legacy `initialize`, 2025 revisions, 2026-07-28 stateless), and Realm already carries a dual-era shim (`src/mcp/protocol.ts`). Adding an HTTP binding adds a fourth axis of drift. [INFERENCE]

### 5.3 A2A (Agent2Agent)

**What it is (documented).** An open protocol for independent, opaque agents to discover each other, negotiate modalities and manage collaborative tasks, "without needing access to each other's internal state, memory, or tools" (S5). Version 1.0.0 is the latest release on the specification page (S5). Per a search summary, 1.0.0 shipped on 2026-03-12, added optional signed Agent Cards (JWS, JSON canonicalization) and mutual-TLS security-scheme declarations, and A2A joined the Agentic AI Foundation in August 2026 (S6, S7, search-only).

**Security properties (documented, S5 section 7).** Production deployments MUST use HTTPS or TLS. Clients SHOULD verify the server certificate. A2A servers MUST authenticate every incoming request and authorize it by identity, skill, action and scope. Agent Card security schemes include API key, HTTP auth, OAuth 2.0, OpenID Connect and mutual TLS. In-task authorization asks for credentials out of band and warns that in-band exchange can pass credentials through chains of agents (S5, 7.6.3). A signed Agent Card protects the card only; it does not authenticate requests (S6, search-only).

**Utility.** The unit of A2A is a `Task` between agents. Realm's unit is a synchronous file or process operation with an audit line. Wrapping `exec` and `read` as A2A tasks adds discovery, streaming and push-notification machinery that nothing needs, and still needs the authentication choices above. No host note in this repository mentions A2A, and I did not survey each runtime's own documentation. **Not verified**: whether any of the 19 runtimes can act as an A2A client.

**Fit.** Wrong abstraction. A2A would fit if Realm exposed a *sandboxed coding agent* to other agents. Realm exposes a *sandbox*.

### 5.4 ACP (Agent Client Protocol), already used

**State (documented, S8, read directly).** The stable v1 protocol defines one transport, stdio. A remote transport "based on Streamable HTTP is being specified in the transport RFD". Custom transports are allowed. Per a search summary, the RFD is Active, leaves authentication to a layer above, and a separate OAuth 2.1 RFD for remote agents is still a proposal (S9, search-only).

**Fit.** ACP is a client-to-agent protocol (an editor drives a coding agent). Realm implements `initialize` and the extension `_realm/tool` only, and answers `session/new` with -32601 (`docs/integration/acp.md` Q5). `docs/integration/acp.md` records that no ACP host exists that could start a session against it, and the live check was a throwaway client. So the surface works as an MCP-equivalent tool bridge for a Realm-aware client, and the ACP-specific value for real hosts is **unproven**. This is unrelated to Anda. No change is needed for the Anda decision; whether to keep the surface is a separate owner question (not counted in the five at the end).

### 5.5 gRPC with mTLS over a Unix socket

**Documented.** gRPC supports SSL/TLS with optional client certificates for mutual authentication, and refuses to send call credentials over an unencrypted channel in most language implementations (S10). grpc-js exposes `ServerCredentials.createSsl(rootCerts, keyCertPairs, checkClientCertificate)` and `createInsecure()` (S11, signature lines only).

**Observed.** The compute driver uses `createInsecure()` on a 0600 socket (`src/runtime/driver/server.ts` line 168). Realm already creates a CA and leaf with the openssl CLI for the runtime channel, and removes the CA key after signing (`src/runtime/driver/channel.ts`).

**Analysis. [INFERENCE]** mTLS on a local unix socket gives cryptographic client identity that does not depend on the socket's mode. The client's private key, though, must sit in a file the client can read, and every process with the same uid can read the same file. Against a same-uid attacker, mTLS matches a 0600 socket. It helps when the socket is **not** protected by a private directory (a shared directory, a mounted socket, a network hop), or when the peer is a different uid. It costs certificate lifecycle code and a dependence on the openssl CLI that Realm already tolerates in one place. No agent host speaks gRPC for tool calls, so mTLS would sit between Realm's own processes only. That is the compute driver's boundary, which is owned by the OpenShell contract, not by the Anda decision.

**Verdict.** Not a host-facing mechanism. The driver's `createInsecure()` choice is a separate hardening topic (a candidate for a v4.0 spike, see section 8.4), unrelated to removing Anda.

### 5.6 Peer credentials and workload identity: SO_PEERCRED, SPIFFE and SPIRE

**SO_PEERCRED (documented through search, S14).** Linux reports the connecting process's uid, gid and pid on a unix socket. **Node.js has no API for it.** A search found no open or merged core proposal; the nearest request, passing file descriptors over unix sockets (nodejs/node issue 53391), was closed as not planned on 2025-09-11. The workarounds are a native addon (`unix-socket-credentials`, last published 13 years ago) or FFI over a private handle field. Realm's rules ask for a justification, a licence check and a maintenance check for every new dependency (`CONTRIBUTING.md`), and a native addon fails the maintenance check on its face.

**The checks would be weak here anyway. [INFERENCE]**

- A uid check adds nothing: the kernel already enforces the 0600 mode on connect, and the workload shares the realm uid.
- A pid check is racy. SPIRE pins the connecting process through a `/proc` file descriptor and re-checks it after attestation to close the PID-reuse race (S13, search-only). `SO_PEERPIDFD` removes the window on Linux 6.5 and newer (S13, search-only; the host runs 6.8 per `docs/integration/openshell.md`). Across a PID namespace boundary the pid reads 0 (S14, search-only), which is exactly the container case.

**SPIFFE and SPIRE (documented, S12).** SPIFFE gives a workload a verifiable identity through a Workload API on a local socket, with no secret to deploy, and short-lived rotating keys. Its **stated assumption** is that "a workload is sufficiently well isolated from other workloads such that a malicious workload could not steal the credentials of another after they have been issued" (S12). Realm's premise is the opposite: the workload is malicious and shares the account's uid. SPIRE also adds a server and an agent as long-running services. For one user on one host this is more attack surface than the problem has.

**Verdict.** No. At most, a one-line defence-in-depth check of the peer uid could be reconsidered if Node ever ships the API.

### 5.7 Other mechanisms

**Capability tokens: Macaroons and Biscuit.** These are the only family here whose **utility** is materially better than the status quo.

- Macaroons (documented through search, S16): bearer tokens with HMAC-chained caveats. A holder can add caveats (attenuate) but cannot remove one. Verification needs the minting service's root key, so only that service can verify them. Third-party caveats require discharge tokens from another service.
- Biscuit (S15, search-only): public-key-verifiable tokens with append-only blocks, offline attenuation and a Datalog policy language. It is an Eclipse Foundation project under Apache-2.0. `@biscuit-auth/biscuit-wasm` 0.6.0 is a WebAssembly wrapper of the Rust implementation, and on Node it needs `--experimental-wasm-modules` (S15, search-only). That flag requirement and a WebAssembly dependency are real costs for a package that ships plain Node.
- What it would buy Realm: a daemon could mint a token per host and per workspace that says "tools read, list, status only; this workspace; expires in one hour", and `realm host install` could hand that token to exactly one host. The audit trail would then name a verified principal instead of a self-declared `--host` label, and a prompt-injected or compromised host could do only what its token allows.
- What it would **not** buy: protection from a same-uid process that can read the token file or the host's environment. The token is a secret held at the same privilege level as the socket. [INFERENCE]
- The cheaper version needs no library: a daemon-minted token signed with HMAC-SHA256 from `node:crypto`, carrying host id, workspace root, allowed tools and an expiry. That is a small subset of the Macaroon idea, and it avoids a new dependency. The risk is the usual one with a home-made token format; keep it to one signature primitive and no caveat language.

**Cap'n Proto RPC and Cap'n Web.** Object-capability RPC (S17, search-only). `capnp-es` is at 0.0.16, MIT, with experimental level 1 RPC. Cap'n Web is a different, JSON-based protocol from Cloudflare under MIT that does not speak Cap'n Proto, and it does no runtime type checking by itself. Either replaces Realm's JSON-RPC control protocol and is spoken by no agent host. No.

**Unix socket plus file-descriptor passing.** A capability transfer by kernel handle is the strongest local primitive. Node cannot send or receive file descriptors over a unix socket; the request was closed as not planned (S14, search-only). Not buildable in Node without a native addon. No.

**WebTransport.** Needs HTTP/3 and TLS. Node core has an experimental `node:quic` behind a build-time flag and no WebTransport API; the usual option is a third-party native package; the IETF draft is at revision 16 (S18, search-only). No agent host speaks it. No.

**MCP over a custom transport on a unix socket.** The MCP specification permits custom transports and says byte-stream transports SHOULD reuse the stdio framing (`docs/integration/mcp.md` Q2). Realm's control socket already is that framing. No agent host documents unix-socket MCP (section 5.2), so the stdio launcher `realm mcp` is the adapter. Nothing to add.

## 6. MCP security guidance and known attacks against `realm mcp`

| Attack or guidance | Source | Applies to `realm mcp` over stdio? | Current behaviour | Gap |
| --- | --- | --- | --- | --- |
| Tool poisoning: hidden instructions in a tool description, shown to the model but not the user (Invariant Labs, 2025-04-01) | S19 (search-only) | Realm is not the poisoner; other servers in the same host could poison the model against Realm's tools | Descriptors are first-party and static, pinned by a test. | Realm cannot stop another server in the host. Document the risk. |
| Rug pull: a tool description changes after approval | S19 (search-only) | No: descriptors do not change at run time | Static table in `src/mcp/server.ts`. | None. |
| Tool shadowing: one server rewrites how the agent uses another server's tools | S19 (search-only) | Yes, as a victim: a hostile sibling server can steer calls to `exec` or `write` | Realm sees only the final call. Policy and containment apply to it. | Annotations and per-host capability scoping would shrink the blast radius. |
| Indirect prompt injection through tool results (Invariant, 2025-05-26, GitHub MCP server) | S19 (search-only) | **Yes**: `exec` and `read` return workload-controlled text to the model | Containment of effects, not of content. | Open. Residual risk that no connection mechanism removes. Operator advice and host confirmation are the controls. |
| Confused deputy through an MCP OAuth proxy | S2 | No: Realm has no OAuth proxy and no third-party API | n/a | n/a. Avoid creating one if HTTP is ever added. |
| Token passthrough | S2 | No tokens | n/a | n/a. |
| State handle hijacking (replaced session hijacking in 2026-07-28) | S2 | Partly: the session is daemon-owned and selected by canonical workspace root and a session id; the MCP server itself is stateless | `src/daemon/channel.ts` validates the selection shape; the controller checks the id against the root. | Authentication of the caller is only file permission. |
| DNS rebinding, 0.0.0.0-day, CSRF against local servers | S3, S20 (search-only) | No listener | n/a | Becomes live the moment an HTTP binding is added. |
| SSRF in OAuth metadata discovery | S2 | No OAuth client in Realm | n/a | n/a |
| Local server compromise: a malicious startup command in client config | S2 | Realm is the local server; the risk is a hostile edit of host config | `realm host install` edits user-level files with an ownership receipt and refuses foreign content. | None found for Realm itself. |
| Human in the loop for tool calls; annotations are untrusted unless the server is trusted | S4 | Host duty | No annotations are set. | Add them (low cost, host may ignore). |

## 7. Recommendation

### 7.1 ANDA-01 to ANDA-04: drop, do not replace

**Recommendation: drop the Anda bridge and the four requirements.** Reasons, in order of weight:

1. No identified need (section 2.2). A bridge that never made a call is a monitor for a service that no host is recorded as running.
2. No live evidence since Phase 3. Four requirements are "Partial (live-gated)" and the milestone audit carries them forward each time.
3. The direction chosen in Phase 5 already removes the reason to dial Anda. Anda reaches Realm as an MCP client, over a transport that Anda documents (S22).
4. It is the sole source of `degraded`, the only thing it adds to the state machine, and no live run records `degraded` occurring.
5. It carries an unresolved licence question that only matters if Realm ever vendors Anda code, which nothing plans to do.
6. A replacement mechanism has nothing to carry: there is no call to send. Section 5 shows the candidate mechanisms either do not fit the threat model or add attack surface for a feature that does not exist.

**Requirement disposition.** Mark ANDA-01 to ANDA-04 as dropped by owner decision (not as satisfied and not as carried), through a GSD command, with the decision ID and this note as the reason. Do not leave them as "Partial" after the code is gone. Remove the line "ANDA-01 to ANDA-04: blocked by the Anda engine licence" from the carried list. OQ-P3-09 (version surface), OQ-P3-10 (RPC credentials) and OQ-P3-11 (licence) become moot and should be closed as "superseded by removal".

**What replaces the monitoring signal.** Nothing. If an operator wants to know whether an Anda engine they run is up, that belongs to their own monitoring. Realm's doctor already reports its own health items (Podman, gateway, driver socket, control channel, AgentOS, host binaries).

### 7.2 Is a "better connection mechanism" warranted?

Not as a replacement for the bridge. For agent-to-sandbox tool calls, **keep MCP over stdio** and keep the control socket. The two additions that have real value and cost little are in the plan below as optional phases:

- **Tool annotations** (section 3.1): mark `read`, `list` and `status` read-only, and `exec` and `write` as non-read-only. Verify the exact annotation names against the tools page (S4) before writing code, because I read only the lines that name the property and the trust warning.
- **Scoped capabilities, as a spike** (section 5.7): decide with evidence whether per-host least privilege and verified audit attribution are worth a token. If yes, prefer the small HMAC token from `node:crypto` over a new dependency, and attach it to the existing control socket, not to a new transport.

### 7.3 Minimal change list for a clean cutover (no shims)

Counts are from a case-sensitive search of the worktree and are a starting inventory. Re-run the search when the phase starts, because the tree moves.

**Delete**

- `src/anda/client.ts`, `src/anda/shape.ts`, and the directory `src/anda/`.
- `test/anda/` (four files: `handshake.test.ts`, `listener-diagnostic.test.ts`, `no-shim.test.ts`, `reconnect.test.ts`) and `test/support/fake-anda.ts`.
- `test/lifecycle/bridge-retry.test.ts` and `test/lifecycle/bridge-states.test.ts`.
- `docs/integration/anda.md`. Replace `docs/integration/anda-decision.md` with a short superseded notice that points to the new decision, or delete it and move the history into the decision record. Pick one; do not keep both as live guidance.

**Edit source**

- `src/core/errors.ts`: remove `ANDA_UNREACHABLE` and `ANDA_VERSION_MISMATCH` from the code list and the catalogue. Remove their entries from `src/runtime/driver/grpc-status.ts` (lines 24 and 25).
- `src/core/ports.ts`: remove `BridgePort`, `BridgeEvent` and `BridgeKind`.
- `src/lifecycle/controller.ts`: remove the `bridge` option, `connectBridge`, `subscribeBridge`, the handshake fields, `onBridgeEvent` and the bridge close in teardown. The file is on the module-size allowlist at 1218 lines (`scripts/check/module-size-allowlist.json`); re-measure, and delete the entry if the file falls to 1000 lines or fewer.
- `src/realm/compose.ts`, `src/daemon/seams.ts` (`defaultBridge`, the `andaUrl` pass-through), `src/daemon/daemon.ts` (comment): remove the bridge wiring.
- `src/runtime/config.ts`: remove `andaUrl`, `andaBridgeRequired`, `isAndaUrl`, `requireAndaUrl`, the allowed-key entry and the validation message. A config that still carries `andaUrl` will then fail as an unknown key. That is the clean cutover, and it is acceptable because no host is recorded with an engine configured. Check the unknown-key behaviour in `test/runtime/config.test.ts` first.
- `src/doctor/checks.ts`: remove the `anda-bridge` check id, `andaBridgeCheck`, the `andaUrl` option, `FIX_ANDA_URL`, `AndaReply` and the `fetchInformation` seam if nothing else uses it, and its position in the ordered list. The run now reports one item fewer: `docs/integration/openshell.md` records fourteen items, so update that count and every doctor test that pins the list (`test/doctor/*.test.ts`).
- `src/core/backoff.ts` and `src/core/timeout.ts`: keep (AgentOS uses the backoff and the timeout helpers; confirm with a search), and reword the comments that cite ANDA-03 and `src/anda/client.ts`. `sleepUnlessAborted` lives in `src/anda/client.ts`; if another module uses the pattern, move it, otherwise remove it. `test/core/backoff.test.ts` pins the Anda schedule (500 ms base, 30000 ms cap) and needs the same edit.
- `src/core/policy.ts` and `src/lifecycle/mutation-gate.ts`: reword the comments that mention the bridge.
- `src/core/states.ts` and the other ten files that read `degraded`: **no change recommended in v4.0**; see open question 2.
- `scripts/check/export-usage-allowlist.json`: delete the entries for `src/anda/client.ts` (two) and `AndaReply`. The export-usage gate fails on stale entries.
- Tests that name `ANDA_*` codes or `degraded` through the bridge: `test/core/errors.test.ts`, `test/lifecycle/controller-health.test.ts`, `test/lifecycle/create-interrupt.test.ts`, `test/lifecycle/mutation-gate.test.ts`, `test/daemon/daemon-health.test.ts`, `test/daemon/daemon.test.ts`, `test/daemon/e2e.test.ts`, `test/omp/plugin.test.ts`, `test/quality/suite-taxonomy.test.ts`, `test/doctor/checks.test.ts`, `test/doctor/control-channel.test.ts`, `test/doctor/runtime-checks.test.ts`, `test/runtime/config.test.ts`. Some of these only use the bridge as a way to reach `degraded`; those tests either lose a case or need another way to drive the state if the state stays.

**Edit docs (same pull request as the code, per `AGENTS.md`)**

- `AGENTS.md`: the Project paragraph (Anda Engine "reached over HTTP"), the Layout bullet for `anda/`, and the settled-decision bullet "Anda consumes Realm over MCP". Settled decisions change only through a new recorded decision, so the new decision must exist first.
- `README.md`, `site/content/index.md`, `docs/policy-reference.md` (lines for `andaUrl`, the active row, the `degraded` explanation), `docs/integration/runtime-decision.md` (the Anda service line, OQ-P3-09 to OQ-P3-11, the `anda.listener_failed` log record), `docs/integration/hardening-plan.md`, `docs/integration/host-binaries.md`, `docs/integration/omp.md`, `docs/integration/openshell.md` (the doctor counts and the two mentions), and the Anda mention in `docs/integration/mcp.md` and `docs/integration/acp.md` only if they name `src/anda/`.
- `.planning/REQUIREMENTS.md` (ANDA-01 to ANDA-04, carried list), `.planning/PROJECT.md`, and the milestone audit notes: only through GSD commands (`AGENTS.md`, Planning artifacts).
- `docs/specs/realm-spec.xml` names Anda in the layering, the bridge section, the `degraded` state and open questions. `AGENTS.md` says agents do not edit the spec on their own initiative. An owner-directed edit is allowed; the pull request must record the owner's instruction and the reason.
- `CHANGELOG.md` is release-owned. Do not edit it. Use a `Removes:` trailer only if the removal should hide an unreleased feature entry; otherwise a `refactor!` or `feat!` commit subject makes the removal visible in the release notes.

### 7.4 Risks

| Risk | Detail | Mitigation |
| --- | --- | --- |
| A hidden user of `andaUrl` | The audit says no host has an engine configured. I checked the repository only, not every operator's config. | State the removal in the release notes; fail with a clear error naming the key. |
| `degraded` becomes unreachable | It is part of the product spec's six states and the status schema's `degraded` flag, and ACP and `cli/stdio-host.ts` accept `active` or `degraded`. | Keep the state in v4.0 and say it has no producer (section 7.5), or remove it in a separate breaking phase. Owner decision. |
| Settled-decision edit | `AGENTS.md` forbids changing settled runtime decisions except through a new recorded decision. | Write the decision first, as the opening phase. |
| Spec edit | The product spec is owner-controlled. | Owner instruction recorded in the pull request. |
| Over-reach | Removing the bridge tempts a "while here" rework of the control channel or the driver. | Keep hardening items in their own phases, behind their own decisions. |
| Wrong inference about Anda's purpose | If the owner intended a future Anda call (memory, TEE), dropping the bridge removes a placeholder, not a design. | Open question 1. Re-adding a client later is cheap because the HTTP surface is documented (S22). |
| Search-only evidence | Sections 5.3, 5.6 and 5.7 lean on search summaries for several claims (marked). | Open each primary page before any item from section 7.2 becomes a requirement. |

### 7.5 Ordered plan skeleton for a v4.0 slice

Phase numbers continue from v3.0, which ended at Phase 26 (`.planning/ROADMAP.md`). `release/milestone.json` moves to minor 4 in the first pull request of the milestone (`AGENTS.md`, Versioning and release). Each phase is a GSD phase and a separate pull request. This is a skeleton, not a committed plan.

| Phase | Name | Scope | Exit evidence |
| --- | --- | --- | --- |
| 27 | Decision and requirement closure | Record the decision to drop the bridge (new decision ID, this note as input). Resolve open questions 1 and 2. Mark ANDA-01 to ANDA-04 dropped and close OQ-P3-09 to OQ-P3-11 as superseded. Owner-directed spec edit. Update `AGENTS.md` settled decisions. Bump `release/milestone.json`. Docs only. | The decision file exists; `npm run check:docs` passes. |
| 28 | Remove the Anda bridge | Section 7.3 source, test and doc edits, as one coherent cutover with no compatibility shim. Keep `degraded` or remove it per question 2. Update the doctor item count and every pinned list. | `npm run typecheck`, `npm run lint`, `npm test`, `npm run check:gates` and `npm run check:docs` green; the export-usage allowlist has no stale entry; a search for `anda` (case-insensitive, word-bounded) in `src`, `test` and `docs/integration` finds only the superseded record and historical planning files. |
| 29 | MCP tool annotations | Add annotations to the six descriptors after reading the tools page for the exact fields. Extend `test/mcp/descriptors.test.ts` and `npm run check:mcp`. Optional host-prompt behaviour is documented as host-dependent. | Descriptor test pins the annotations; `check:mcp` green. |
| 30 | Scoped-capability spike (optional) | Written spike, no product code: threat statement, token format (HMAC token from `node:crypto` versus Biscuit), where the token is carried, how the audit names the principal, what it does not stop (same-uid reader). Include the question of `ServerCredentials.createInsecure()` on the driver socket. Decision at the end. | A decision note with measured cost and an explicit "build" or "do not build". |
| 31 | Implement the capability slice (only if the spike says build) | Per-host token minted by the daemon, enforced at the control socket's `tool` method, recorded in the audit chain, installed by `realm host install`. Fail closed on a missing or expired token. | Contract tests with seeded defects; a live run against a Podman stack as in the existing live suite. |

[INFERENCE] Phases 27 and 28 are the whole Anda cutover and can ship without 29 to 31. Phases 29 to 31 are independent of Anda and should be accepted or rejected on their own merit.

## 8. What is documented only, and what is observed

- **Observed (repository files, today):** the bridge's shape and its single producer of `degraded`; the optional `andaUrl`; the control socket and driver socket protections; `createInsecure()` on the driver socket; the stdio launch commands quoted in `docs/integration/mcp.md` Q8; the absence of tool annotations; the file inventory in section 7.3 (a text search, not a build).
- **Observed (external, direct read):** MCP authorization, security best practices and Streamable HTTP text (parts), the A2A specification header and section 7, ACP v1 transports, the gRPC authentication guide, SPIFFE concepts, the Anda repository page, manifest licence line and MCP client note, the Claude Code and Codex MCP transport lines.
- **Documented only (no Realm run):** every claim about how a mechanism behaves, and every statement about which hosts support it, other than the stdio launch commands in `docs/integration/mcp.md` Q8 and the lines read from Claude Code and Codex.
- **Search-only:** items marked so in section 4. In particular the A2A release dates and signed-card details, the ACP remote RFD status, the Node peer-credential gap, the SPIRE peer-tracking behaviour, the Biscuit and Cap'n Proto package status, the WebTransport state, and the attack write-ups.
- **Not done:** no live handshake with an Anda Engine, no build of Anda, no test, no type check, no doctor run. This task asked for research only.

## 9. Open questions for the owner (five)

1. **Did the owner intend any concrete Anda capability** (memory through KIP, a TEE-backed tool, a specific engine tool) that Realm should call, now or later? If yes, name it and the drop recommendation becomes "replace with a scoped client for that one capability". If no, drop.
2. **What happens to `degraded`?** After the bridge goes, nothing produces it. Keep it as a reserved state with documented "no current producer" (no contract change), or remove it from the state machine, the status schema, the host contract and the product spec in a separate breaking phase (about eleven source files and thirty-five test and doc files)?
3. **Is a remote or multi-user Realm in scope for v4.0?** If no, MCP Streamable HTTP, OAuth and A2A stay out for good. If yes, section 5.2's resource-server-only design is the starting point and it is a larger milestone.
4. **Should per-host scoped capabilities and verified audit attribution be explored** (phases 30 and 31), or is the 0600 socket plus fail-closed policy enough for the threat model? The same-uid limitation in section 5.7 means this is a least-privilege and attribution feature, not a defence against a malicious host process.
5. **Which release signal for the removal?** A breaking removal of `andaUrl` and two error codes: a `feat!` or `refactor!` commit visible in the 0.4.0 notes, or a quiet removal because no known user exists? The release tooling shows breaking subjects, so the choice is yours.

## 10. Owner decisions (2026-11-17)

Source: the owner's decisions of 2026-11-17. The mapping of those decisions to the five questions of section 9 is the planner's reading (27-CONTEXT, OQ-27-04).

| Question | Answer | Decision |
| --- | --- | --- |
| 1. Concrete Anda capability intended? | No capability named. Drop the bridge. | D-27-01 |
| 2. What happens to `degraded`? | Removed in Phase 28, with the state machine, status label flag, schemas, host contract text and docs. Measured blast radius on 2026-11-17: 11 src files, 28 test files, 8 doc files outside this note. | D-27-01 |
| 3. Remote or multi-user Realm in v4.0? | No. Local single-user only. | D-27-04 |
| 4. Explore per-host scoped capabilities and verified attribution? | Yes, as a spike (Phase 30); build only if the spike records a build decision. | D-27-03 |
| 5. Release signal for the removal? | A breaking-change commit subject visible in the 0.4.0 notes; release line 0.4.x. | D-27-05 |

The phase skeleton of section 7.5 is superseded by the v4.0 roadmap (Phases 27 to 31). In that roadmap Phase 31 is production-stack boot rehearsals; the capability slice of the skeleton is considered only if the Phase 30 decision is build.

# ACP integration note

Status: gate note (FOUND-03), extended in Phase 5 (decision Q5) and by the live check of 2026-10-29.
Blocks: ACP **transport code only**. The shared contract types (`src/contract/`, `src/core/`) proceed without this note, per D-18.

## Official sources read

Read date: 2026-10-21 (ISO 8601).

| Source | URL |
| --- | --- |
| Documentation index | https://agentclientprotocol.com/llms.txt |
| Introduction | https://agentclientprotocol.com/get-started/introduction |
| Protocol v1 overview | https://agentclientprotocol.com/protocol/v1/overview |
| Protocol v1 initialization | https://agentclientprotocol.com/protocol/v1/initialization |
| Protocol v1 transports | https://agentclientprotocol.com/protocol/v1/transports |
| Protocol v2 overview | https://agentclientprotocol.com/protocol/v2/overview |
| Protocol v2 initialization | https://agentclientprotocol.com/protocol/v2/initialization |
| Protocol v2 transports | https://agentclientprotocol.com/protocol/v2/transports |
| Protocol v1 extensibility (read 2026-10-29) | https://agentclientprotocol.com/protocol/v1/extensibility |

Not read in this phase: the v2 migration guide (`/protocol/v2/migration`) and the schema page. Both are listed in the index.

## Questions and answers

### Q1. Spec version

Sourced answer: **two protocol generations are documented.**

- v2 pages exist under `/protocol/v2/`. Its initialization example uses `"protocolVersion": 2` and the `info` field for implementation information (https://agentclientprotocol.com/protocol/v2/initialization).
- v1 pages exist under `/protocol/v1/`. Its initialization example uses `"protocolVersion": 1` and `clientInfo`/`agentInfo` (https://agentclientprotocol.com/protocol/v1/initialization).
- The protocol version is a single integer identifying a MAJOR version. The agent selects the highest version it supports that is less than or equal to the requested one (v2 initialization, "Version Negotiation"). If the client does not support the agent's selected version, the client SHOULD close the connection (v1 initialization, "Version Negotiation").

Which generation Realm targets is not decided here. Phase 5 decides and records it.

### Q2. Transport

Sourced answer (v2 transports page, https://agentclientprotocol.com/protocol/v2/transports; v1 transports page is the same in substance):

1. **stdio** (defined): the client launches the agent as a subprocess; newline-delimited JSON-RPC on stdin/stdout. Messages MUST NOT contain embedded newlines. The agent MUST NOT write anything to stdout that is not a valid ACP message. Stderr is for logs. Agents and clients SHOULD support stdio whenever possible.
2. **Streamable HTTP** (not defined): listed as "draft proposal in progress". No normative binding exists in the pages read.
3. **Custom transports**: permitted, if they preserve the JSON-RPC message format and lifecycle requirements.

Batch rule (v2 transports): clients and agents SHOULD NOT batch lifecycle-sensitive messages such as `initialize`, `auth/login`, `session/new`, `session/resume`, and `session/prompt`.

### Q3. Remote transport: a discrepancy in the sources

The introduction page says remote agents "communicate over HTTP or WebSocket" and that "full support for remote agents is a work in progress" (https://agentclientprotocol.com/get-started/introduction). The transports pages define only stdio and list Streamable HTTP as a draft. No WebSocket binding was found in the pages read.

Recorded as found: **the remote binding is not documented as normative.** Any remote ACP transport would be a custom transport under the transports page's rules.

### Q4. Authentication and session methods (informational)

v2 defines `auth/login` and `auth/logout`. A client MUST NOT call them when `authMethods` is omitted or empty (v2 overview and initialization). v2 also defines `session/new`, `session/prompt`, `session/resume`, `session/close`, and `session/list`. Their details are not needed for the transport decision in this phase.

### Q5. Which generation and method Realm uses

Decided in Phase 5 (P5-D10). Realm speaks protocol generation v1: `"protocolVersion": 1` with `clientInfo` / `agentInfo` (Q1), over the stdio framing of Q2 by reference (newline-delimited JSON-RPC, stdout carries only ACP messages, stderr for logs). Version negotiation follows Q1: the agent selects the highest version it supports at or below the requested one. Lifecycle-sensitive messages are never batched, per the Q2 batch rule (`initialize`, `auth/login`, `session/new`, `session/resume`, `session/prompt`).

Realm's six tools ride one Realm extension method named `_realm/tool`, which carries the whole frozen `ToolCall` map unchanged. `_realm/tool` is a Realm extension, not standard ACP: no client-invoked tool method exists in the standard protocol pages read. Clients must not treat it as a standard ACP method.

The leading underscore follows the ACP extensibility rules (https://agentclientprotocol.com/protocol/v1/extensibility, read 2026-10-29): the protocol reserves method names starting with an underscore for custom extensions, and custom requests are allowed as long as their name starts with an underscore. The old unprefixed name `realm/tool` is not an alias; it is an unknown method. As a request it answers `-32601` without reaching the dispatcher; as a notification it gets no reply.

Capability advert: the `initialize` reply carries `agentCapabilities: { _meta: { "realm/tool": true } }` next to `protocolVersion` and `agentInfo`, so a client can discover the extension. The extensibility page suggests `com.example/<name>` keys under `_meta`; Realm controls no reverse-DNS domain, so the key is the method name without its underscore.

Realm is a tool bridge, not a full ACP agent. It implements `initialize` and the one extension method `_realm/tool`, and answers `session/new` and `session/prompt` with `-32601`. A standard ACP host therefore cannot start a session with it; only a Realm-aware client that calls `_realm/tool` can use the tools.

### Live check (2026-10-29)

A throwaway client drove `realm mcp` and then `realm acp` against the same sandbox on the production stack (Podman 5.7.1, the OpenShell 0.1.5 gateway, the Realm compute driver). 67 checks, 0 failed. Sixteen are equality checks: for each of exec (echo, exit code, stderr, shell form), write (multi-byte content, byte count and SHA-256, file on the host), read (whole, truncated, absent), list, status and five refused paths (`.env` read and write, `../` escape, an absolute path, a directory), the ACP result equals the MCP result; a refusal carries the same catalogue code and retryable flag, and both surfaces saw one status snapshot. ACP-only probes passed: the capability advert, `session/new` answered `-32601` as documented above, the old name `realm/tool` answered `-32601`, an echoed string id, an unknown method, a malformed line (the agent keeps serving), a batch line (rejected, never dispatched), and a `_realm/tool` notification (never executed, no reply). The workspace, containers and daemons were empty afterwards. The client is not part of the repository; the repository's own equivalence test is `test/surfaces/equivalence.test.ts`.

The equality above was observed for refusals that carry no cause. For a refusal that carries a cause the shape depends on the path, and the cause code is what stays the same. The refused `ToolOutcome` has an optional, additive `causeCode` (a catalogue code; the key is absent when the refusing error carried none). In process the ACP `result` is the outcome, so the cause is `result.causeCode`. Behind `realm acp` the dispatcher is the daemon client: the daemon answers a refused outcome as an error reply carrying `code` and, when present, `causeCode`, the client throws it as a `RealmError`, and the ACP error carries it as `error.data.causeCode` next to `data.code` and `data.retryable`. `test/surfaces/daemon-equivalence.test.ts` drives a real daemon through MCP and ACP and compares the cause code with the in-process answer.

## Blocked module

ACP transport code (Phase 5). Nothing else is blocked by this note.

## Not in this note

- A model-driven ACP session: no ACP host exists that could start one, because Realm implements no `session/*` method.
- No guessed URLs. Pages not listed above, and not cited with their read date in Q5, were not read and are not cited.

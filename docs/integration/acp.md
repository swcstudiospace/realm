# ACP integration note

Status: gate note (FOUND-03). No ACP code exists in this phase.
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

## Blocked module

ACP transport code (Phase 5). Nothing else is blocked by this note.

## Not in this note

- No transport code, no agent, no client, no stdio handler.
- No guessed URLs. Pages not listed above were not read and are not cited.

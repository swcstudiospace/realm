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
- How Realm sets annotations, and why that grants no trust, is Q9.
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

A request that carries neither a handshake nor `_meta` is served in the server's own (modern) revision, so a bare client still gets an answer. `isError` is true for a refused outcome and for a thrown `RealmError`, so the model sees the failure; the outcome itself is the frozen tool contract, and the ACP surface still returns it as is. The one change to it is additive: the refused variant carries an optional `causeCode` (a catalogue code), present only when the refusing error carried a cause, so every outcome without a cause is byte-for-byte unchanged. In process the cause appears in `structuredContent.causeCode` next to `code` and `retryable`. Behind `realm mcp` the dispatcher is the daemon client, and the daemon answers a refusal as an error reply that the client throws as a `RealmError`; that tool error result carries the same cause as `structuredContent.causeCode` (and omits the key when there is none). The shapes of the two paths still differ; the cause code is the same (`test/surfaces/daemon-equivalence.test.ts`). `serverInfo.version` and the ACP `agentInfo.version` read the package manifest (`src/core/package-version.ts`); 0.2.0 advertised 0.0.0. The tool descriptors state what the frozen tool schema enforces (no unknown keys, the same required keys, types and bounds), and `test/mcp/descriptors.test.ts` pins the two together.

No descriptor has a combinator, an enum or a conditional at its root. The Anthropic Messages API rejects such a tool with a 400 (`tools.N.custom.input_schema: input_schema does not support oneOf, allOf, or anyOf at the top level`), and one rejected tool fails the whole request, so a host that loads the server would fail every model turn (reported against Claude Code in https://github.com/anthropics/claude-code/issues/65896 and against other Anthropic clients in https://github.com/home-assistant/core/issues/160565; read 2026-10-29). The 0.2.0 `exec` descriptor had a root `oneOf` for "exactly one of argv, or shell with script". It is now prose in the descriptor, and the dispatcher keeps enforcing it through the frozen schema's `if`/`then`/`else`. A connection check cannot show this defect, because it never sends a schema to a model; the descriptor test guards it instead.

Checks. `test/mcp/server.test.ts` covers each era's shapes, the negotiation, the unsupported-version error and `ping`. `npm run check:mcp` drives one session in both eras against the built server (it accepts a fail-closed attach refusal when no daemon can start, so a runner without Podman checks only that refusal). Scenario 6 of the production live suite handshakes as a legacy client and then sends a modern request to the same process. After the change, on 2026-10-29 with a build of this change attached to the realm account's stack: Claude Code `claude mcp list` reports Connected, and Grok Build `grok mcp doctor` reports the handshake accepted (protocol 2025-11-25) and 6 tools discovered. Muse Code and Omp have no connectivity command, and the Hermes Agent install on this machine is not usable, so they were not checked. No model-driven tool call through any host was run, because it needs a model.

### Q7. Boot sequence under `realm mcp`

Since Phase 23 `realm mcp [--workspace <absolute path>] [--host <id>] [--reattach]` boots in six numbered steps and serves nothing before the last settles: resolve (flags, the host's manifest and bounds, a boot id), ensure (probe the control socket, spawn the detached daemon at most once, poll to the `up` bound), up (the idempotent `up` for the workspace), readback (one `status` read, checked against the workspace's root and session id), settle, expose (the server starts reading stdin). A reply to `initialize` is the readiness signal: no frame is written, and stdin is not read, before the boot settles. The protocol claims in Q1 to Q6 do not change.

Flags. `--workspace`, `--host` and `--reattach` may come in any order, each at most once; any other shape is the usage error (exit 2) and nothing is started. `--host` names an `mcp-config` host by its canonical id (`claude`, `codex`, `kimi`, ...: not an alias, not `omp`), so the session's marker, log line and report name the host. A session with no `--host` runs the same boot and is reported as `unlabelled`. `--reattach` turns on bounded boot retry and link re-attach (off by default); there is no environment variable.

Exit codes and exposure. The tools are exposed when the boot is `ready`, when `up` was refused and the readback confirms this workspace (the refusal code is written to stderr and every call is refused), and when the daemon refused `up` but its status did not confirm this workspace (calls are refused locally and never forwarded). Any other failure exits 1 before any frame, with the catalogue code and the daemon-log path on stderr and nothing on stdout. With `--reattach` a retryable failure (`DAEMON_START_TIMEOUT`, `REALM_NOT_ACTIVE`, `TOOL_TIMEOUT`, `STARTUP_BUDGET_EXCEEDED`) exposes the tools instead: every call is refused with the last code until a re-attach links, and the Realm `retry` tool re-attaches once. Stdin ending exits 0; a failed input stream exits 1 with `MCP_INPUT_FAILED`.

Teardown and logging. Stdin EOF, `SIGTERM`, `SIGINT` and `SIGHUP` close the client, remove the marker and exit (`128 + signal` for a signal); a second signal exits at once. Nothing in the boot sends `down`: the sandbox lasts until `realm down`. Stdout carries protocol frames only. At the default level the session writes nothing to stderr on success; `REALM_LOG_LEVEL=debug` shows one `host.boot.<phase>` JSON line per step, all sharing the boot id as `correlationId`, and a failed boot still prints its catalogue code. The full contract and what is proven against what are in `docs/integration/host-plugin-contract.md`, "Boot integration".

### Q8. Registering Realm in a host

`realm host install <host>` is the supported way to register `realm mcp --host <host>` in the user-level MCP configuration of `claude`, `opencode`, `codex`, `kimi` and `kimi-code` (Phase 24) and of `cursor`, `copilot`, `qwen`, `augment`, `pi`, `cline`, `antigravity`, `kilo`, `codebuddy` and `hermes` (Phase 25); `windsurf`, `trae` and `zcode` are owner-approved deferrals and refuse as `recipe-pending`. It edits only the host's own user-level file, with an ownership receipt, and `realm host uninstall <host>` removes exactly what it wrote. The manual route stays valid (`claude mcp add --scope user realm -- realm mcp --host claude`, `codex mcp add realm -- realm mcp --host codex`, `qwen mcp add realm -s user realm mcp --host qwen`, `copilot mcp add realm -- realm mcp --host copilot`, `pi mcp add realm -- realm mcp --host pi`, or the JSON entry for OpenCode, Kimi, Cursor, Kilo and Antigravity); an identical manual entry makes the installer a no-op, and a different `realm` entry is refused. Each host has a snippet with the file, the entry, the override variable, the host's validator command, the shadowing warning for project-level configuration and the evidence tier reached: [Claude Code](../hosts/snippets/claude-code.md), [OpenCode](../hosts/snippets/opencode.md), [Codex](../hosts/snippets/codex.md), [Kimi CLI and Kimi Code](../hosts/snippets/kimi.md), [Cursor](../hosts/snippets/cursor.md), [Copilot](../hosts/snippets/copilot.md), [Qwen Code](../hosts/snippets/qwen.md), [Augment](../hosts/snippets/augment.md), [Pi](../hosts/snippets/pi.md), [Cline](../hosts/snippets/cline.md), [Antigravity](../hosts/snippets/antigravity.md), [Kilo](../hosts/snippets/kilo.md), [CodeBuddy](../hosts/snippets/codebuddy.md), [Hermes Agent](../hosts/snippets/hermes-agent.md) and the [deferred hosts](../hosts/snippets/deferred-hosts.md). The per-host live rehearsal is gated and has no recorded result yet. The protocol claims in Q1 to Q6 do not change.

### Q9. Tool annotations

Since Phase 29 every tool `realm mcp` lists carries a `title` and an `annotations` object with the four hints, in both protocol eras. The hints are for a host that chooses to use them. Realm never reads them and they are never a security control.

Read date: 2026-11-17.

| Source | URL |
| --- | --- |
| Schema reference, revision 2026-07-28 | https://modelcontextprotocol.io/specification/2026-07-28/schema |
| Schema reference, revision 2025-11-25 | https://modelcontextprotocol.io/specification/2025-11-25/schema |
| Schema reference, revision 2025-06-18 | https://modelcontextprotocol.io/specification/2025-06-18/schema |
| Tools page, revision 2026-07-28 | https://modelcontextprotocol.io/specification/2026-07-28/server/tools |
| Tools page, revision 2025-11-25 | https://modelcontextprotocol.io/specification/2025-11-25/server/tools |
| Tools page, revision 2025-06-18 | https://modelcontextprotocol.io/specification/2025-06-18/server/tools |
| MCP blog, "Tool Annotations as Risk Vocabulary: What Hints Can and Can't Do", 2026-03-16 (the maintainers' blog, not normative) | https://blog.modelcontextprotocol.io/posts/2026-03-16-tool-annotations/ |

Sourced answers.

- Shape. A `Tool` has `name`, optional `title`, optional `description`, `inputSchema`, optional `annotations` and optional `_meta`. `ToolAnnotations` has five optional fields: `title`, `readOnlyHint`, `destructiveHint`, `idempotentHint` and `openWorldHint`. The `ToolAnnotations` interface and the four hint descriptions are word for word the same in 2026-07-28, 2025-11-25 and 2025-06-18, the three revisions Realm serves, so one object shape serves both eras. The only per-revision differences in `Tool` are fields Realm does not emit (`icons` and `execution` in 2025-11-25, `icons` in 2026-07-28). Annotations first appeared in 2025-03-26, a revision Realm does not serve.
- Hint meanings and defaults. `readOnlyHint`: "If true, the tool does not modify its environment. Default: false". `destructiveHint`: "If true, the tool may perform destructive updates to its environment. If false, the tool performs only additive updates. (This property is meaningful only when readOnlyHint == false) Default: true". `idempotentHint`: "If true, calling the tool repeatedly with the same arguments will have no additional effect on its environment. (This property is meaningful only when readOnlyHint == false) Default: false". `openWorldHint`: "If true, this tool may interact with an 'open world' of external entities. If false, the tool's domain of interaction is closed. For example, the world of a web search tool is open, whereas that of a memory tool is not. Default: true". The defaults are pessimistic, so Realm states all four explicitly for every tool, including the read-only ones.
- Display name. Revision 2026-07-28: "Display name precedence order is: title, annotations.title, then name." Realm sets `title` and `annotations.title` to the same fixed ASCII literal, so a client built on either field shows the same name.
- Trust. Schema reference: "all properties in ToolAnnotations are hints. They are not guaranteed to provide a faithful description of tool behavior (including descriptive properties like title). Clients should never make tool use decisions based on ToolAnnotations received from untrusted servers." Tools page, all three revisions: "For trust & safety and security, clients MUST consider tool annotations to be untrusted unless they come from trusted servers." and "there SHOULD always be a human in the loop with the ability to deny tool invocations".
- What clients typically do. The maintainers' blog describes typical client behaviour, not a requirement: a read-only tool from a trusted server may skip the confirmation dialog, a destructive tool may get a warning and an idempotent tool may be retried safely. Servers should set read-only on read-only tools, destructive false on additive operations and open-world false on closed-domain tools.

Realm's behaviour. Each tool lists these values, in this order:

<!-- mcp-tool-annotations:begin -->
| Tool | Title | readOnlyHint | destructiveHint | idempotentHint | openWorldHint | Basis |
| --- | --- | --- | --- | --- | --- | --- |
| `exec` | Run command | false | true | false | true | Runs an arbitrary workload with the workspace mounted read-write: it can delete or overwrite any workspace file, so destructive. Two identical runs can have different effects (appending, counters): not idempotent. Egress is closed by default but policy can open it, and the descriptor cannot see the policy: open world (D-29-05). |
| `read` | Read file | true | false | true | false | Returns file content, changes nothing in the workspace. Reads a closed domain (the bound workspace). |
| `write` | Write file | false | true | true | false | Replaces the whole content of the target file (and creates it if absent); an existing file's old content is overwritten, so destructive. The same path and content again leaves the same file, so idempotent (with `ifMatchSha256` a repeat is refused rather than applied; still no additional effect). Closed domain: only the bound workspace, and the credential check and path lock refuse the rest. |
| `list` | List directory | true | false | true | false | As `read`. |
| `status` | Realm status | true | false | true | false | Returns the controller snapshot, no effect. Closed domain. |
| `retry` | Retry session start | false | false | true | false | Not read-only: from `error` it starts the session's sandbox. Not destructive in the sense a user means: it acts only on Realm's own session container (including destroying one failed container it started) and never on workspace content (D-29-04). Idempotent: once the session is up a repeat returns the snapshot and does nothing; a failed attempt leaves state `error`. Closed domain: the local container runtime. |
<!-- mcp-tool-annotations:end -->

Both eras emit the same `title` and `annotations` objects: the legacy `tools/list` result has only `tools`, the modern one adds `resultType`, `ttlMs` and `cacheScope`, and nothing else differs. The table is static for the life of the process, so a description or an annotation cannot change after a host approved the server.

Rules.

- (a) Annotations are hints and never a security control. Realm never reads them. Enforcement is the schema validation, the shell gate, the policy mode, the mutation gate, the path locks and the sandbox, and a read-only-hinted tool still refuses a hostile argument (`test/mcp/server.test.ts`, "MCPA-01: a read-only hint relaxes nothing": a path outside the workspace is refused as `SCHEMA_INVALID` for `read` and `list`).
- (b) What environment means. The hints describe the workspace files, the sandbox and the running session. Realm's own audit chain and metric rows are excluded, because every call, including `read`, `list` and `status`, appends to the audit log; without that exclusion no tool could be read-only.
- (c) Why `exec` is open world. The default policy has no egress, so `exec` is offline in practice. The policy can open named host and port pairs, and the descriptor cannot see the policy, so the hint states what the policy may allow.
- (d) Why `retry` is not destructive and `write` is both destructive and idempotent. `retry` can destroy one container, Realm's own disposable runtime object for the session, which it recreates in the same call, and it never touches workspace content, the thing a destructive prompt protects. `write` overwrites the whole content of the target, so it is destructive, and writing the same content to the same path again leaves the same file, so it is idempotent. The descriptor cannot tell creating a file from overwriting one, so a host that prompts on destructive tools will prompt on every `write`.
- (e) The mistake direction. When a value depends on a case the descriptor cannot see, Realm states the broader one, which at worst causes an extra prompt and never skips a needed one.

Host dependence. What a host does with the hints (auto-approve, prompt, use in a plan mode, or ignore them) is the host's choice and is host-dependent. It was not observed for Claude Code, Grok Build, Omp or any other host in this phase. Annotations never replace the host's duty of consent or Realm's containment. A hostile sibling server steering calls to `exec` or `write` is not addressed by annotations, because a host decides per server.

Checks. `test/mcp/annotations.test.ts` (the pins against the frozen contract, the behaviour and 93 mutants), `test/mcp/server.test.ts` (both eras on the wire and the hostile-argument test), `scripts/check/mcp-smoke.test.mjs` (90 seeded faults of the gate), `test/docs/mcp-annotations-doc.test.ts` (this table equals the pins) and `npm run check:mcp`, which checks the title and annotations of the built server in both eras and, when no daemon can start, accepts only the fail-closed attach refusal; in that case the annotation checks are proven by the script tests alone. The research record's observation "no tool annotations" (`docs/integration/anda-replacement-research.md`) is closed by Phase 29.

## Blocked module

MCP transport code (Phase 5). Nothing else is blocked by this note.

## Not in this note

- No transport code, no server, no client, no `mcp.json`.
- No URL guessed. The Streamable HTTP page is marked as not read.

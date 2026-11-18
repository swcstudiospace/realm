# Phase 29: MCP tool annotations - Context

**Gathered:** 2026-11-17, from the v4.0 worktree (`src/mcp/server.ts`, `src/mcp/protocol.ts`, `src/contract/tools.schema.json`, `src/tools/dispatch.ts`, `src/lifecycle/controller.ts`, `src/runtime/hardening.ts`, `test/mcp/*`, `test/support/fake-tools.ts`, `scripts/check/mcp-smoke.mjs`, `docs/integration/mcp.md`, `docs/integration/anda-replacement-research.md`), the MCP specification pages named in E-01 to E-07, and the milestone decisions of the owner (2026-11-17).
**Status:** Planned (two plans, nothing executed). Requirement ids MCPA-01 and MCPA-02 are in `.planning/REQUIREMENTS.md` (v4.0 section); this phase does not edit ROADMAP, STATE or REQUIREMENTS.

<domain>
## Phase Boundary

`realm mcp` lists six tools (`exec`, `read`, `write`, `list`, `status`, `retry`) from one static table (`MCP_TOOL_DESCRIPTORS` in `src/mcp/server.ts`). Each descriptor has `name`, `description` and `inputSchema` and nothing else. Today a host that applies the specification's defaults to an unannotated tool must assume the worst for every one of them: not read-only, destructive, not idempotent, open world (E-03). A host that wants to skip a prompt for `read`, `list` and `status` has no signal to do so (`docs/integration/anda-replacement-research.md`, "No tool annotations").

Phase 29 does four things:

1. **Annotate every tool** (MCPA-01). Each descriptor gains the `annotations` object with `readOnlyHint`, `destructiveHint`, `idempotentHint` and `openWorldHint`, all four always present and explicit (never left to the pessimistic defaults), plus a human-readable `title`. Both protocol eras `realm mcp` serves emit the same objects, because the `ToolAnnotations` shape is identical in 2025-06-18, 2025-11-25 and 2026-07-28 (E-01, E-02).
2. **Decide each value honestly** (D-29-02 to D-29-06), against what the dispatcher and the sandbox actually do, with the stated rule that annotations are hints and never a security control (D-29-01).
3. **Pin them** (MCPA-02). A test pins the table per tool against the tool contract (`src/contract/tools.schema.json`) and against observed tool behaviour, runs the check on the wire in both eras, and a seeded mutation of any annotation (flip, delete, rename, swap, drop a tool) makes a test fail.
4. **Extend the gate and the docs**: `npm run check:mcp` checks the annotations in both eras of the built server; `docs/integration/mcp.md` gets a sourced section and a per-tool table that a test compares to the pins; AGENTS.md and CONTRIBUTING.md describe the extended gate.

Out of scope (not claimed):

- **No change to enforcement.** Policy mode, the mutation gate, path locks, the shell gate and the sandbox are untouched. Nothing in `src` reads an annotation to decide anything (D-29-01).
- **No change to the frozen tool contract** (`src/contract/tools.schema.json`, D-13), to `ToolOutcome`, to result shapes, to the ACP surface (`_realm/tool` has no annotation concept) or to error codes.
- **No dynamic annotations.** The table is static per process, as the descriptors already are (a hint that changed at run time would be a rug-pull vector, E-06). A policy-dependent value (egress) is stated at its most permissive (D-29-05).
- **No host-behaviour claim.** What a given host does with the hints (auto-approve, prompt, plan mode, ignore) is host-dependent and was not observed on this machine; the docs say so (D-29-08). No host is driven in this phase except an optional connectivity recheck (plan 29-02, verification).
- **No `outputSchema`, `icons` or `_meta`** on descriptors, no `execution` field, no new MCP method, no change to the Anda removal (Phase 28) or to the capability-token spike (Phase 30; it may cite the hints as a consumer-side signal only).
- **No CHANGELOG edit** (release-owned, generated from commits) and no version change. The release line is 0.4.x and this change is additive.
</domain>

<decisions>
## Implementation Decisions

### Evidence (specification facts: source, read date 2026-11-17)

Every page below was fetched on 2026-11-17 and the quoted text compared across revisions.

| Id | Source | URL | What it establishes |
| --- | --- | --- | --- |
| E-01 | Schema reference, revision 2026-07-28 | https://modelcontextprotocol.io/specification/2026-07-28/schema | `Tool` has `name`, optional `title`, optional `description`, `inputSchema`, optional `annotations?: ToolAnnotations`, optional `_meta`. `ToolAnnotations` is `{ title?: string; readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean }`. "Display name precedence order is: title, annotations.title, then name." Text: "all properties in ToolAnnotations are hints. They are not guaranteed to provide a faithful description of tool behavior (including descriptive properties like title). Clients should never make tool use decisions based on ToolAnnotations received from untrusted servers." |
| E-02 | Schema reference, revisions 2025-11-25 and 2025-06-18 | https://modelcontextprotocol.io/specification/2025-11-25/schema and https://modelcontextprotocol.io/specification/2025-06-18/schema | The `ToolAnnotations` interface and the four hint descriptions are word for word the same as E-01; `Tool` has `title` and `annotations` in both. The only per-revision differences in `Tool` are fields Realm does not emit (`icons` and `execution` in 2025-11-25, `icons` in 2026-07-28). So one object shape is correct in all three revisions `realm mcp` serves. (Annotations first appeared in 2025-03-26, a revision Realm does not serve.) |
| E-03 | The hint semantics, same schema pages | as E-01 | `readOnlyHint`: "If true, the tool does not modify its environment. Default: false". `destructiveHint`: "If true, the tool may perform destructive updates to its environment. If false, the tool performs only additive updates. (This property is meaningful only when readOnlyHint == false) Default: true". `idempotentHint`: "If true, calling the tool repeatedly with the same arguments will have no additional effect on its environment. (This property is meaningful only when readOnlyHint == false) Default: false". `openWorldHint`: "If true, this tool may interact with an 'open world' of external entities. If false, the tool's domain of interaction is closed. For example, the world of a web search tool is open, whereas that of a memory tool is not. Default: true". |
| E-04 | Tools, revisions 2026-07-28, 2025-11-25, 2025-06-18 | https://modelcontextprotocol.io/specification/2026-07-28/server/tools (and the same path under each revision) | The tool definition lists `annotations: Optional properties describing tool behavior` and, in all three revisions, "For trust & safety and security, clients MUST consider tool annotations to be untrusted unless they come from trusted servers." All three revisions also say "there SHOULD always be a human in the loop with the ability to deny tool invocations" and that the protocol mandates no interaction model. |
| E-05 | MCP blog, "Tool Annotations as Risk Vocabulary: What Hints Can and Can't Do", 2026-03-16 | https://blog.modelcontextprotocol.io/posts/2026-03-16-tool-annotations/ | What clients typically do (blog's own table and prose): a read-only tool from a trusted server may skip the confirmation dialog, a destructive one may get a warning, an idempotent one may be retried safely. Servers should set read-only on read-only tools, destructive false on additive operations and open-world false on closed-domain tools. It is a maintainers' blog, not the normative specification; the normative statements are E-01 to E-04. |
| E-06 | Existing Realm research, `docs/integration/anda-replacement-research.md` (S4, S19) | repository file | Realm is a possible victim of tool shadowing by a hostile sibling server and of a rug pull (a description that changes after approval). The descriptors are static for the life of the process, so the second does not apply; annotations do not help with the first because a host decides per server. |
| E-07 | `docs/integration/mcp.md` Q3 | repository file | Realm already records the binding statements: hosts MUST obtain consent before invoking a tool; descriptions and annotations are untrusted unless from a trusted server. |

[INFERENCE] Which hosts on this machine (Claude Code, Grok Build, Omp, others) read the hints, and what they do with them, was not observed. E-05 describes typical behaviour, not any named host. Nothing in this phase asserts a host behaviour.

### Findings in the repository that shape the plans (verified 2026-11-17)

- **F1. One static table.** `MCP_TOOL_DESCRIPTORS` is built in `src/mcp/server.ts` from `TOOL_NAMES`, `TOOL_INPUT_SCHEMAS` and `TOOL_DESCRIPTIONS`, and `toolListResult` in `src/mcp/protocol.ts` puts the same `tools` array into the legacy result (`{ tools }`) and the modern one (`resultType`, `tools`, `ttlMs`, `cacheScope`). So a descriptor field reaches both eras without any era branch. `McpToolDescriptor` in `src/mcp/protocol.ts` is `{ name, description, inputSchema }`.
- **F2. The tool contract.** `src/contract/tools.schema.json` freezes six tools: `exec` (argv form or shell form), `read` (`path`, `maxBytes`), `write` (`path`, `content`, optional `ifMatchSha256`), `list` (`path`, `depth`), `status` and `retry` (no params). `test/mcp/descriptors.test.ts` already pins the descriptors' input schemas to it.
- **F3. Who consumes the descriptors.** `src/cli/stdio-host.ts` creates the server for `realm mcp` (the dispatcher is the daemon client); `test/mcp/server.test.ts` ("the tool descriptors the server lists are the ones the module exports") deep-compares a wire `tools/list` with `MCP_TOOL_DESCRIPTORS`; `scripts/check/mcp-smoke.mjs` checks `tools/list` in both eras but only that `status` is present and that both eras list the same count; `test/integration/production-driver.test.ts` checks name, `description` and `inputSchema` of each descriptor from a live `realm mcp`. No other file reads the descriptor shape (`grep -rln inputSchema test scripts src adapters docs`).
- **F4. What the tools do** (`src/tools/dispatch.ts`, `src/tools/workspace.ts`, `src/lifecycle/controller.ts`, `src/runtime/hardening.ts`):
  - `exec` runs an argv or shell workload in the sandbox, only while the state is `active`, under `TOOL_CALL_TIMEOUT_MS`. The workspace is bind-mounted **read-write** into the sandbox (`src/runtime/hardening.ts`, mounts of D-51), so a workload can delete or overwrite any workspace file. Network egress is closed by default; the policy key `egressAllow` (`src/core/policy.schema.json`) can open named host and port pairs, and `credentialAllow` can pass credentials. The dispatcher and the descriptor do not know the policy.
  - `read` and `list` take workspace-relative paths (schema rule: no leading slash or drive, no `..` segment), are not gated, and write nothing in the workspace.
  - `write` canonicalizes the target, runs the credential check and the path-lock probe, goes through the mutation gate, and writes atomically. It replaces the target's content (there is no create-only mode); `ifMatchSha256` is an optional precondition. The same path and the same content again leaves the same file.
  - `status` returns the controller snapshot and its display mapping, not gated.
  - `retry` acts only in state `error` (it refuses in `unbound` and `stopping`; any other state returns the current snapshot with no work done). In `error` it runs `controller.create` for the bound workspace: it starts the session's sandbox and, when a stored container's start failed, destroys that one container once and creates a new one (`createHeld` comment, `src/lifecycle/controller.ts`). It never touches workspace content.
  - **Every** tool call, including `read`, `list` and `status`, appends admission and result lines to the session's audit log in the state directory. That is Realm's own bookkeeping, not part of the project environment a host user means by "environment"; D-29-06 excludes it explicitly.
- **F5. The test harness.** `test/support/fake-tools.ts` `makeHarness(t, options)` gives a real dispatcher over a real workspace (`h.ws`, `h.doc()`), real audit log, a settable fake OpenShell runner (`h.setRunner`, `h.runs`), and the recorded `h.creates`; `options.state` starts it in a given state. `test/mcp/server.test.ts` drives the real server over in-memory streams with local helpers (`drive`, `request`, `toolRequest`, `resultRecord`).
- **F6. Gates that a source change touches.** `scripts/check/export-usage-gate.mjs` fails on an export used only by tests unless allowlisted; the annotation table is therefore not exported (the tests read it through the already allowlisted `MCP_TOOL_DESCRIPTORS`), and the new type is exported from `src/mcp/protocol.ts` because `server.ts` imports it. `scripts/check/module-size.mjs` limit is 1000 lines (`server.ts` is 313). `npm run check:docs` scans published docs for host-local absolute paths.
- **F7. Phase interplay.** Phase 28 (Anda removal) edits `docs/integration/mcp.md`-adjacent docs, AGENTS.md and error-code files, and removes the `degraded` state. Phase 29 depends only on Phase 27, so the two may land in either order. The planned edits here are an appended section in `docs/integration/mcp.md` and one-line changes in AGENTS.md and CONTRIBUTING.md; none touches an Anda line. `src/mcp`, `test/mcp` and `scripts/check/mcp-smoke.mjs` contain no Anda or `degraded` reference (grep, 2026-11-17), and the planned tests use the `active` and `error` states only so they survive Phase 28 unchanged.

### D-29-01. Annotations are hints, never a security control (the rule)

Realm sets the annotations so that a **host that chooses to use them** can prompt sensibly. It never reads them. The consequences are binding on every task:

- No code in `src` branches on an annotation. Enforcement stays where it is: schema validation, the shell gate, policy mode, the mutation gate, path locks, the sandbox mounts and egress rules, the audit chain.
- A tool marked `readOnlyHint: true` still receives hostile arguments and still refuses them (plan 29-01 tests this over the wire).
- Values are chosen so that an error is never in the dangerous direction: when a tool's behaviour depends on policy or on a case the descriptor cannot see, the value states the broader possibility (D-29-05), which at worst causes an extra prompt and never skips one that is needed.
- The docs repeat the specification's own wording (E-01, E-04): hints may not be faithful; clients must treat them as untrusted unless the server is trusted; consent and the human in the loop are the host's duty; Realm's guarantee is the containment, not the hint.

### D-29-02. The shape: explicit values, `title` in both places

Every descriptor gets `title` (top level) and `annotations` with exactly the keys `title`, `readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`, with `annotations.title` equal to `title`. Reasons:

- All four hints are emitted for every tool, including the read-only ones for which the specification says `destructiveHint` and `idempotentHint` are "meaningful only when readOnlyHint == false". The defaults are pessimistic (`destructiveHint` true, `idempotentHint` false, `openWorldHint` true), and a client that ignores the caveat would read a bare `readOnlyHint: true` as "read-only but destructive". Explicit values cost nothing and are what MCPA-01 names.
- Top-level `title` (since 2025-06-18) is the first choice in the 2026-07-28 display precedence; `annotations.title` (since 2025-03-26) is read by clients built on older SDKs. They are equal, and the test pins the equality.
- Titles are fixed ASCII literals of up to 40 characters, never derived from workload data, so the field cannot carry injected text.
- Realm's own type makes all five annotation keys required (the specification makes them optional), so a missing value is a compile error, and `Record` over `ToolName` makes a missing tool a compile error.

### D-29-03. The per-tool table (the deliverable the owner approves)

| Tool | `title` | `readOnlyHint` | `destructiveHint` | `idempotentHint` | `openWorldHint` | Basis |
| --- | --- | --- | --- | --- | --- | --- |
| `exec` | Run command | false | true | false | true | Runs an arbitrary workload with the workspace mounted read-write: it can delete or overwrite any workspace file, so destructive. Two identical runs can have different effects (appending, counters): not idempotent. Egress is closed by default but policy can open it, and the descriptor cannot see the policy: open world (D-29-05). |
| `read` | Read file | true | false | true | false | Returns file content, changes nothing in the workspace. Reads a closed domain (the bound workspace). |
| `write` | Write file | false | true | true | false | Replaces the whole content of the target file (and creates it if absent); an existing file's old content is overwritten, so destructive. The same path and content again leaves the same file, so idempotent (with `ifMatchSha256` a repeat is refused rather than applied; still no additional effect). Closed domain: only the bound workspace, and the credential check and path lock refuse the rest. |
| `list` | List directory | true | false | true | false | As `read`. |
| `status` | Realm status | true | false | true | false | Returns the controller snapshot, no effect. Closed domain. |
| `retry` | Retry session start | false | false | true | false | Not read-only: from `error` it starts the session's sandbox. Not destructive in the sense a user means: it acts only on Realm's own session container (including destroying one failed container it started) and never on workspace content (D-29-04). Idempotent: once the session is up a repeat returns the snapshot and does nothing; a failed attempt leaves state `error`. Closed domain: the local container runtime. |

### D-29-04. `retry` is not destructive (judgement call, OQ-29-01)

`retry` can destroy one container: the stored container of the session when its start failed. That container is Realm's own disposable runtime object, recreated in the same call; the user's workspace (the only thing a host user is protecting by a destructive prompt) is never touched. A destructive prompt on `retry` would train users to click through prompts. Default: `destructiveHint: false`. Owner may reverse it (set true); the pins and docs change in one place.

### D-29-05. `exec` is open world because policy can open it (OQ-29-02)

With the default policy (`egressAllow: []`) a workload has no network and `exec` is in practice closed. The descriptor is static and the policy is per project, so the only value that is never wrong is the broad one. Default: `openWorldHint: true`, and the docs say that the default policy keeps `exec` offline and that the hint states what policy may allow. This follows D-29-01 (never understate).

### D-29-06. What "environment" means for the hints

The hints describe the project the host user cares about: the workspace files, the sandbox and the running session. Realm's own bookkeeping (the audit chain, the metric rows, the daemon log, the session record) is excluded. Without that rule no tool could be `readOnlyHint: true`, because every call appends audit lines (F4). The docs state this exclusion and the plan 29-01 behaviour test checks that `read`, `list` and `status` leave the workspace byte for byte unchanged.

### D-29-07. Tests: three layers and a mutation set

1. **Pins** (`test/support/mcp-annotation-pins.ts`): one independent literal table of the six rows of D-29-03 plus a checker `annotationViolations(tools)` that returns human-readable violations (exact tool set, exact key set per annotation object, exact values, `title` equal in both places, title charset, and rules derived from the tool contract: `write` is the only tool with a `content` property and must be non-read-only and destructive; every tool whose frozen definition takes a `path` and no `content` must be read-only; `exec` is the only tool with `argv` and must be destructive and open world; a read-only tool must be non-destructive and idempotent; only `exec` may be open world).
2. **Behaviour** (honesty): through the real dispatcher over the real server, `read`, `list` and `status` leave every workspace byte unchanged; `write` twice with the same content leaves the same bytes and the second call is not an error; `retry` in `active` changes nothing and creates no container; and every hint-true tool still refuses a hostile argument.
3. **Wire, both eras**: a real `tools/list` in the legacy era (after `initialize`) and in the modern era (`_meta`) yields exactly the pinned objects; both eras are equal.
4. **Mutation**: a generated mutant set (flip each of the four hints on each tool, delete each of the five keys, rename a title, add an unknown key, remove `annotations` or `title`, swap two tools' annotations, drop a tool, add a seventh) is run through the checker and **every mutant must produce at least one violation that names the mutated tool**; the mutant count is asserted so the generator cannot shrink silently. A source-level mutation (flip `exec`'s `readOnlyHint` in `src/mcp/server.ts`, build, observe the failing tests, revert) is a recorded manual acceptance step of the parent, not a committed artifact.
5. **Gate** (plan 29-02): the smoke script holds its own literal table, checks both eras of the built server, and a script test mutates each hint in a fixture reply and requires a failure; a unit test compares the smoke table, the pin table and the docs table so the three cannot drift.

### D-29-08. Docs

`docs/integration/mcp.md` gets one new section, Q9 "Tool annotations", before "Blocked module": the read date and URLs of E-01 to E-05, the shape per revision, the per-tool table (marked by two HTML comment markers so a test can parse it), the rules of D-29-01, D-29-05 and D-29-06, and the host-behaviour statement: host-dependent, typical behaviour per E-05, not observed on the hosts here, annotations never replace the containment. It also adds one line to Q3 pointing to Q9. `docs/integration/anda-replacement-research.md` is a dated research record and keeps its "no tool annotations" observation as history (Phase 27 owns its disposition); Q9 records that Phase 29 closed it. AGENTS.md and CONTRIBUTING.md describe the extended `check:mcp`. Markdown rules for every doc edit: no host-local absolute path, and any angle-bracket token outside a code fence written as `&lt;..&gt;`.

### Threat model: annotations as an attack and as a mistake (summary; each plan carries its STRIDE rows)

The asset is the user's consent decision in the host: what it prompts for and what it lets through. The adversary is a hostile workload or a hostile sibling MCP server, and the risk of Realm's own mistake.

| Asset | Attack or mistake | Hold |
| --- | --- | --- |
| Host consent prompt for `write`, `exec`, `retry` | An understated hint (`readOnlyHint: true` on a mutating tool) lets a host auto-approve a mutation | Values chosen to err broad (D-29-01, D-29-05); the behaviour test proves read-only tools leave the workspace unchanged and `write` is destructive; the derived contract rules fail if `write` or `exec` becomes read-only; the mutation set fails on any flip |
| Realm's containment | A reader treats the hints as a guard and removes a check | D-29-01 stated in code comment, docs and a test that a hint-true tool refuses hostile input; no `src` file reads a hint |
| Host trust in descriptors | A rug pull: a description or annotation changes after approval | The table is static for the process; the wire test pins the exact list; `tools/list` carries a 300000 ms TTL and `cacheScope: public` as today |
| Model context | Injected text through `title` | Fixed ASCII literals, charset pinned by the checker; no workload data reaches a descriptor |
| Sibling server shadowing | A hostile server steers calls to `exec` or `write` | Not addressable by annotations (host decides per server); recorded as a host duty in Q9 and unchanged from the Anda research |
| Information disclosure | Annotations leak paths or policy | They are six fixed literals with no path, policy or secret; `exec`'s open-world value is the same for every project |
| Client compatibility | A client that rejects an unknown or unexpected field | Only specification fields are emitted, identical across the three served revisions (E-02); the smoke gate checks the built server in both eras; an optional connectivity recheck with the real hosts is listed in plan 29-02 |
| Residual | A host that ignores the hints, or trusts them from a server it should not | Not claimed; documented as host-dependent |

### Verification posture

Offline: `npm run build`, the named test files, `npm run test:scripts`, `npm run check:docs`, `npm run check:gates`, `npm run lint`, `npm run check:mcp` (accepts the fail-closed attach refusal when no daemon can start; then it checks only that refusal, and the annotation checks run in the unit tests of the script). Optional online: a connectivity recheck with `claude mcp list` and `grok mcp doctor` in isolated homes, as `docs/integration/mcp.md` Q6 did on 2026-10-29. The parent records what actually ran; nothing is claimed for a host that was not run.
</decisions>

<canonical_refs>
## Canonical References

- `src/mcp/server.ts`, `src/mcp/protocol.ts` (descriptor table, `toolListResult`, era handling).
- `src/contract/tools.schema.json` (frozen tool contract, D-13) and `test/mcp/descriptors.test.ts` (existing pin of the input schemas).
- `src/tools/dispatch.ts`, `src/tools/workspace.ts`, `src/lifecycle/controller.ts`, `src/runtime/hardening.ts`, `src/core/policy.schema.json` (what each tool does, the read-write workspace mount, egress policy).
- `test/mcp/server.test.ts`, `test/support/fake-tools.ts`, `scripts/check/mcp-smoke.mjs`, `scripts/check/mcp-smoke.test.mjs`, `test/integration/production-driver.test.ts`.
- `docs/integration/mcp.md` (Q3, Q6), `docs/integration/anda-replacement-research.md` (section 3.1, S4, S19, phase table row 29), `AGENTS.md` and `CONTRIBUTING.md` (gate descriptions).
- The MCP pages of E-01 to E-05.
- `.planning/ROADMAP.md` Phase 29 and `.planning/REQUIREMENTS.md` MCPA-01, MCPA-02.
</canonical_refs>

<code_context>
## Existing Code Insights

- `TOOL_NAMES` in `src/mcp/server.ts` is the single ordered list; `TOOL_INPUT_SCHEMAS` and `TOOL_DESCRIPTIONS` are `Record` over `ToolName`, so adding a third `Record` for annotations follows the file's own pattern and gets exhaustiveness from the compiler.
- The wire test pattern (`drive` plus `resultRecord`) already round-trips descriptors through JSON; annotations are plain booleans and strings and need no special handling.
- `test/mcp/descriptors.test.ts` loads the frozen schema with `readFileSync("src/contract/tools.schema.json")` relative to the repository root, the same pattern the pins use.
- `scripts/check/mcp-smoke.mjs` exports its pure checkers (`checkEras`, `compareStatus`, `frameFor`, `parseReplies`) so `mcp-smoke.test.mjs` can feed them replies; the new table and check follow that.
- The docs site and `check:docs` read published markdown; the Q9 table is plain GFM.
</code_context>

<specifics>
## Requirement IDs

| Id | Meaning in this phase |
| --- | --- |
| MCPA-01 | Every one of the six tools advertises `title` and `annotations` with the four hints in both protocol eras: the legacy `initialize` era (2025-11-25 and 2025-06-18) and revision 2026-07-28. The values are the table of D-29-03, backed by the evidence E-01 to E-04 and the repository findings F4. |
| MCPA-02 | A test pins the annotations per tool against the tool contract and observed behaviour, runs on the wire in both eras, and a mutation of any annotation fails a test (the mutant set of D-29-07); the smoke gate and the docs table are pinned to the same table. |

## Wave Structure

- **Wave 1, plan 29-01** (MCPA-01, MCPA-02): the type and the table in `src`, the pins and the checker, the pin, behaviour, wire and mutation tests. Self-contained; proves the requirement on in-process servers.
- **Wave 2, plan 29-02** (MCPA-01, MCPA-02, depends on 29-01): the `check:mcp` gate and its script tests, the cross-pin test, the docs, AGENTS.md and CONTRIBUTING.md, the production-driver assertion.

## Open Questions (owner decisions or unverified; none blocks planning)

- **OQ-29-01.** `retry` is `destructiveHint: false` (D-29-04). Owner may prefer true. Default: false.
- **OQ-29-02.** `exec` is `openWorldHint: true` although the default policy keeps it offline (D-29-05). Owner may prefer a policy-derived value; that needs the policy at list time and is not in scope. Default: true.
- **OQ-29-03.** `title` is emitted at the top level and in `annotations` (D-29-02). Default: both, equal.
- **OQ-29-04.** `write` is destructive and idempotent. A host that prompts on destructive writes will prompt on every write, including creating a new file, because the descriptor cannot tell the cases apart. Default: accept (never understate); a create-only variant would be a contract change.
- **OQ-29-05.** [INFERENCE] How Claude Code 2.1.x, Grok Build 1.0.x, Omp and the other hosts use the hints is not verified. Default: documented as host-dependent. A later live rehearsal could observe a prompt change; it is not required for MCPA-01 or MCPA-02.
</specifics>

<deferred>
## Deferred Ideas

- Policy-derived or per-project annotations (needs the policy at `tools/list` time and a cache story).
- A create-only `write` mode so a host can tell creation from overwrite (changes the frozen contract).
- Observing real host behaviour with the hints (a prompt-versus-no-prompt rehearsal per host).
- `outputSchema` for the tool outcomes, descriptor `icons`, and a CI check that fails when a future tool is added without a pinned row (the compile-time `Record` already forces the source side; the test side is the exact-tool-set pin).
</deferred>

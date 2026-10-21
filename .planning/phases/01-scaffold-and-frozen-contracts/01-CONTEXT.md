# Phase 1: Scaffold and Frozen Contracts - Context

**Gathered:** 2026-10-21
**Status:** Ready for planning
**Mode:** `--auto` (all gray areas auto-selected; recommended option taken for each question; decisions derived from `docs/specs/realm-spec.xml`)

<domain>
## Phase Boundary

Phase 1 delivers three things and nothing else:

1. A strict ESM TypeScript package at the repo root with working `typecheck`, `lint`, `test`, and `build` scripts that pass with no suppressed errors (FOUND-01, QUAL-01 enforcement rules).
2. The frozen shared contracts that every later module codes against: state table, typed error catalogue, tool schema, session-record schema, policy schema, and a schema-validation wrapper (FOUND-02).
3. One integration note per external source under `docs/integration/` (agentos.md, podman.md, openshell.md, anda.md, omp.md, mcp.md, acp.md, hosts.md), each with its official URL and read date. No integration module is written in this phase (FOUND-03).

Out of this phase: the state machine's transition logic and its tests beyond the frozen table (Phase 2), the display-label mapping (Phase 2), any container, OpenShell, AgentOS, or Anda code (Phase 3), policy evaluation, path canonicalization, locks, and atomic writes (Phase 2), any Omp, MCP, or ACP transport code (Phase 5).

</domain>

<spec_lock>
## Requirements Lock (source: `.planning/REQUIREMENTS.md` and `docs/specs/realm-spec.xml`)

Phase requirements: **FOUND-01, FOUND-02, FOUND-03, QUAL-01**. Their text lives in `.planning/REQUIREMENTS.md` and is not restated here. The spec's `GRAPH_OF_THOUGHT` nodes n1, n2, n3, n5, n6, n7 and its `CLARIFICATIONS` q1 to q4 are the decision basis for this file. No phase-level `*-SPEC.md` exists, so `spec_loaded = false`.

</spec_lock>

<decisions>
## Implementation Decisions

### Settled inputs (not reopened in this discussion)

- **D-01:** Policy mode default is **advisory** with a visible warning. **Fail-closed** is an opt-in per project. The spec's `GRACEFUL_DEGRADATION` text about "required mode" is read as the same thing as the config value `fail-closed` (see D-09). The contradiction flagged in spec n3 is resolved this way. The two labels `advisory` and `fail-closed` are the config values, and "required mode" is prose for `fail-closed`.
- **D-02:** One container per session. The session record holds one container reference per session (see D-11). Granularity is reversible; the Swarm seam is not built in this phase.
- **D-03:** Host write tools (Omp built-in write and edit) are disabled only in required mode. Phase 1 records this as an open question for Phase 5 in `docs/integration/omp.md`. Phase 1 writes no plugin code.
- **D-04:** Delivery is vertical-slice first. Phase 1 contributes only the scaffold and contracts that the slice needs.
- **D-05:** Podman-gated integration tests are not written in this phase. They arrive in Phase 3 and skip with a stated reason while Podman is below 5.x. Local Podman 4.9.3 is not changed. No system packages are installed or upgraded in this phase. npm dev dependencies for the toolchain are allowed, but each one is verified in its registry before it is added (see D-07).
- **D-06:** The Anda boundary planning position is a **TypeScript client over the Anda Engine HTTP API**, with no Rust shim unless the documentation shows no TypeScript-reachable surface. In Phase 1 this is a position to be checked, not a fact. `docs/integration/anda.md` records the evidence for or against it. Phase 3 writes `anda-decision.md`. If the docs do not document an HTTP surface, `anda.md` records "not documented" and the choice is re-opened in Phase 3. It is not changed silently.

### Scaffold and quality gates (FOUND-01, QUAL-01)

- **D-07:** Toolchain: npm with a committed lockfile; TypeScript compiler in strict mode; ESM (`"type": "module"`); ESLint in flat-config form with the typescript-eslint parser; Node's built-in test runner. Each package is verified in its npm registry entry before it is added, and the verified version is recorded in the plan's task output. No package name or version is typed from memory. **Reversibility:** reversible.
- **D-08:** The four scripts `typecheck`, `lint`, `test`, and `build` exist. None of them may use a suppression: no `@ts-ignore`, `@ts-expect-error` used as a blanket, `eslint-disable`, `skip`, or `todo` on tests. QUAL-01's "no silent catch blocks" is enforced by ESLint `no-empty` with empty catch blocks disallowed. Phase 1 contains no runtime async boundary, so the timeout rule applies from Phase 2 onward. The `TOOL_TIMEOUT` code and the `RealmError` shape (D-10) make timeout and error typing available to every later module.
- **D-09:** Engines field: `package.json` `engines` is set from the Node requirement recorded in `docs/integration/hosts.md`, not guessed. This creates an ordering constraint: the `hosts.md` note is written before the scaffold sets `engines`.

### Contracts (FOUND-02)

- **D-10:** Typed errors live in `src/core/errors.ts`. `RealmError` carries `code` (a string literal union drawn from the catalogue), `reason` (non-empty human-readable text), and `retryable` (boolean). The catalogue is the 20 codes from spec n6, and no others are added. Each code's `retryable` value is fixed as follows:
  - `true`: REALM_NOT_ACTIVE, STARTUP_BUDGET_EXCEEDED, TOOL_TIMEOUT, PODMAN_MACHINE_DOWN, OPENSHELL_START_FAILED, AGENTOS_CRASH_LOOP, ANDA_UNREACHABLE, LOCK_CONFLICT, WRITE_NOT_ATOMIC.
  - `false`: REALM_UNBOUND, REALM_STOPPING, REALM_INVALID_TRANSITION, PODMAN_MISSING, ANDA_VERSION_MISMATCH, POLICY_DENIED, PATH_ESCAPE, CREDENTIAL_PATH_DENIED, EGRESS_DENIED, SHELL_NOT_ALLOWED, SCHEMA_INVALID.

  **Reversibility:** costly. The codes are machine-readable and are surfaced to MCP and ACP hosts. Renaming one touches every module and every host snippet.
- **D-11:** State table lives in `src/core/states.ts`. It holds the six states `unbound`, `connecting`, `active`, `degraded`, `error`, `stopping`, and exports a pure transition-check function plus the allowed-edge table. The allowed edges are exactly: unbound→connecting; connecting→active, error, stopping; active→degraded, error, stopping; degraded→active, error, stopping; error→connecting, stopping; stopping→unbound. Any other pair is rejected with `REALM_INVALID_TRANSITION`. Phase 1 tests check the table itself (every allowed edge accepted, every disallowed pair rejected, including self-transitions). Phase 2 owns the state-machine behavior, events, and display mapping. **Reversibility:** costly. Every module imports it.
- **D-12:** Schemas are JSON Schema files at fixed paths, with `additionalProperties: false` on every object, so unknown keys are rejected. The validator is a single JSON Schema library, verified in its registry before it is added (D-07). A wrapper in `src/contract/` validates an input against a named schema and returns either a typed value or a `RealmError` with code `SCHEMA_INVALID` whose `reason` names the offending key or path.
- **D-13:** Tool schema at `src/contract/tools.schema.json`. It defines six tools: `exec`, `read`, `write`, `list`, `status`, `retry`. `exec` is argv-first: its argv form is `{ argv: string[] (minItems 1) }`. Its shell form is `{ shell: true, script: string }` and is schema-valid, because the schema cannot know policy. The shell form is rejected later by `SHELL_NOT_ALLOWED` when `policy.shellEnabled` is false (Phase 2, TOOL-02). `read` takes `{ path, maxBytes }`. `write` takes `{ path, content, ifMatchSha256? }`, where `ifMatchSha256` is a 64-character lowercase hex string. `list` takes `{ path, depth }`. `status` and `retry` take `{}`. Every `path` is workspace-relative: a non-empty string that is not absolute and has no `..` segment, enforced at schema level as defense in depth. Canonicalization is still Phase 2 (FS-01). **Reversibility:** one-way. The tool contract is published to MCP and ACP hosts.
- **D-14:** Session-record schema at `src/contract/session-record.schema.json`. Required fields: `realmId`, `sessionId`, `workspaceRoot`, `state` (one of the six states), `controlSocketPath`. `containerId` is a string or null, and it is **null until the container exists**, because the record is written before container creation (RT-07). No token, secret, or environment-variable field exists. **Reversibility:** one-way. The record is persisted on disk, so changing its shape needs a migration.
- **D-15:** Policy schema at `src/core/policy.schema.json`. Keys:
  - `mode`: `"advisory"` (default) or `"fail-closed"`.
  - `workspaceRoots`: array of strings, default `[]`. With no roots the session is unbound.
  - `credentialAllow`: array of glob strings, default `[]`. Credential-shaped paths are denied by default.
  - `egressAllow`: array of `{ host: string, port: integer }`, default `[]`.
  - `shellEnabled`: boolean, default `false`.
  - `startupBudgetMs`: positive integer, default is a short bounded value (see Claude's Discretion).
  - `toolQueueMs`: positive integer, default is a short bounded value (see Claude's Discretion).

  **Reversibility:** one-way. This is a user-authored config format.

### Integration notes (FOUND-03)

- **D-16:** Eight notes under `docs/integration/`, one per file named in the roadmap: `agentos.md`, `podman.md`, `openshell.md`, `anda.md`, `omp.md`, `mcp.md`, `acp.md`, `hosts.md`. Each note has the following sections: official URL(s), read date (ISO 8601), a list of the questions the spec asks, the answer with its source quote or section for each, and `not documented` for any question the docs do not answer. An unanswered question takes the spec's stated default (n3). Notes contain no code written from memory and no host-local paths.
- **D-17:** Starting points given in the spec: Rivet docs at `rivet.dev/docs` (agentos.md) and Podman docs at `docs.podman.io` (podman.md). The spec does not give URLs for OpenShell, Anda, the Omp plugin and status API, MCP, ACP, or the host runtimes. Each of those URLs is found from the official source during execution and recorded at read time. A URL that is not found is recorded as `not documented`, not guessed.
- **D-18:** Each note states the open questions it leaves to later phases and names the module it blocks, following spec n7:
  - agentos.md: AgentOS identity (Rivet actor service or separate product). Blocks `src/runtime/agentos.ts`. Default: `ExecutionService` interface, no actor design.
  - podman.md: rootless hardening flags, resource limits, egress control. Blocks `src/runtime/podman.ts`.
  - openshell.md: launch inside the container, policy model. Blocks `src/runtime/openshell.ts`.
  - anda.md: Engine boundary, version handshake, Rust shim need. Blocks `src/anda/`.
  - omp.md: manifest, lifecycle hooks, status API, host-write removal (spec q4). Blocks `plugin/`.
  - mcp.md and acp.md: spec version and transport. Block transport code only.
  - hosts.md: Node or Bun constraint per host, plugin, MCP, and ACP loading model, capability gaps. Blocks `engines` and the build target.

  The no-dependency wave (spec n7 step 7) needs no note. It is policy, state, path, schema, lock, atomic write, audit, and contract tests against an in-memory fake, so it can proceed in Phase 1 and Phase 2 without any note.

### Claude's Discretion

- Exact tsconfig options beyond `strict` and ESM, and the exact ESLint rule set beyond `no-empty`.
- Test layout: `test/` mirrors `src/`. The spec's file names (`test/fs/toctou.test.ts`, `test/core/fail-closed.test.ts`, and so on) are the model.
- The shape of `tools.schema.json` (for example, a map keyed by tool name, or one schema per tool), as long as each of the six tools is addressable by name and every input is validated as in D-13.
- The numeric defaults for `startupBudgetMs` and `toolQueueMs`. Pick short bounded values, record them as the schema defaults, and note them in the Phase 1 plan output for Phase 7's policy reference. Do not hard-code the numbers anywhere else.
- The upper bound for `read.maxBytes`. Keep it an integer with a stated maximum in the schema.
- Whether to add a `schemaVersion` field to the session record. Default: no, because the spec lists the fields exactly. Deferred unless a plan finds a concrete need.
- File-level naming of the integration notes beyond the eight required names.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Product spec (source of truth; do not modify)
- `docs/specs/realm-spec.xml` — `<CONSTRAINTS>` (QUALITY, NO_INVENTED_FACTS, HARD_LIMITS), `<REALM_SANDBOX>` (CONTAINER_LAYER_PODMAN, FILESYSTEM_LOCKDOWN, LIFECYCLE), `<STATES>`, `<SECURITY_AND_VALIDATION>`, `<GRACEFUL_DEGRADATION>`, `<ASSUMPTIONS>`, `<AMBIGUITIES>`, `<GRAPH_OF_THOUGHT>` nodes n1, n2, n3, n5, n6, n7, and `<CLARIFICATIONS>` q1 to q4.

### Planning state
- `.planning/REQUIREMENTS.md` — FOUND-01, FOUND-02, FOUND-03, QUAL-01 text; traceability table.
- `.planning/ROADMAP.md` — Phase 1 goal, success criteria 1 to 4, and the eight integration-note names.
- `.planning/PROJECT.md` — Constraints (ESM, strict, Node LTS, no unverified dependencies, no host paths, no telemetry) and Key Decisions table.
- `.planning/STATE.md` — blockers for Phase 1 (AgentOS identity) and Phase 3 (Anda boundary, Podman 4.9.3 vs OpenShell 5.x).

### Integration notes (created in this phase)
- `docs/integration/agentos.md`, `podman.md`, `openshell.md`, `anda.md`, `omp.md`, `mcp.md`, `acp.md`, `hosts.md` — each a deliverable of this phase (D-16 to D-18).

### Not yet present (later phases)
- `docs/integration/anda-decision.md` — Phase 3 (ANDA-01).

No other external specs or ADRs are referenced. The workflow's ADR and SPEC files do not exist for this repo.

</canonical_refs>

<code_context>
## Existing Code Insights

The repo is greenfield. Tracked files at discussion time are `.agents/GEMINI.md`, `.planning/*`, and nothing else in source. `docs/` is untracked and contains `docs/specs/realm-spec.xml`. No `package.json`, `tsconfig.json`, or source tree exists.

### Reusable Assets
- None. Phase 1 creates the first source files.

### Established Patterns
- None in code. Repo conventions come from the spec and PROJECT.md: TypeScript strict, ESM, single package at the repo root, typed errors with `code` and `reason`, no silent catches, every async boundary timed.

### Integration Points
- `src/core/` is the root of the dependency graph (spec n2). Phase 2 and every later module import `states.ts`, `errors.ts`, and `policy.schema.json` from there.
- `src/contract/` holds the tool and session schemas and the validation wrapper. The Phase 4 dispatcher and the Phase 5 MCP and ACP surfaces import from there.
- `docs/integration/` is the gate directory. The spec requires each module's note to exist before that module's integration code is written.

</code_context>

<specifics>
## Specific Ideas

- Keep the frozen contracts small and exact: the spec lists exact fields and exact codes, so match them and do not add more.
- `RealmError` should be easy to construct from the catalogue, so later modules do not invent ad hoc strings. A single lookup from code to default `retryable` is enough.
- The Anda planning position (D-06) is a stated position, not a finding. The Anda note must say what the docs showed.

No further specific references. The spec and the decisions above carry the direction.

</specifics>

<deferred>
## Deferred Ideas

- The shared state display mapping (`realm active` / `realm disconnected`) and state-machine behavior, events, and timestamps: Phase 2 (CORE-02, CORE-04).
- Policy evaluation and defaults enforcement: Phase 2 (CORE-03). Phase 1 freezes only the policy schema.
- Path canonicalization, locks, atomic writes: Phase 2 (FS-01 to FS-05).
- Podman, OpenShell, AgentOS, Anda runtime code and gated integration tests: Phase 3.
- `docs/integration/anda-decision.md`: Phase 3 (ANDA-01).
- Host write-tool removal in required mode (spec q4): Phase 5 (OMP-05). Phase 1 records the question only.
- A `schemaVersion` field on the session record: not added (see Claude's Discretion). Revisit only if a plan finds a concrete migration need.
- macOS and Podman machine behavior, Bun support: out of v1 or later (PROJECT.md Out of Scope; spec n3).
- The Swarm seam and per-workspace granularity: out of v1 (spec n4; PROJECT.md).

### Reviewed Todos (not folded)
- None. `todo.match-phase 1` returned zero todos.

</deferred>

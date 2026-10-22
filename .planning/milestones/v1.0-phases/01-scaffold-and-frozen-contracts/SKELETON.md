# Walking Skeleton — Realm

**Phase:** 1
**Generated:** 2026-10-21

## Applicability

Phase-specific applicability for this skeleton (must not be silently ignored):

- Phase 1 has no runtime, no database, no routing, no UI, and no container. Those belong to Phase 3 (runtime and Anda bridge) and Phase 5 (Omp, MCP, ACP). No database, route, UI interaction, or deployment was added to satisfy the template.
- The skeleton for this phase is the thinnest end-to-end working path the phase can prove: the strict ESM package builds, the four quality scripts run, one frozen contract (the state table, plus the error catalogue and one schema) is loaded and exercised, and one invalid input is rejected with its typed code.
- The phase did not inflate its scope to match the template. The phase boundary in 01-CONTEXT.md is fixed.

## Capability Proven End-to-End

A developer runs the four quality scripts on the strict ESM package and every script passes; one frozen contract loads and accepts a valid input while one invalid input is rejected with its typed error code.

## Architectural Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Language and modules | TypeScript strict, ESM, single package at repo root | Spec CONSTRAINTS QUALITY and PROJECT.md constraints |
| Test runner | Node built-in test runner, test/ mirrors src/ | D-07, no extra dependency to verify |
| Lint | ESLint flat config with TypeScript parser, no-empty disallowing empty catch blocks | D-07, D-08, QUAL-01 |
| Validation | Single JSON Schema validation library, registry-verified at execution, imported only by src/contract/validate.ts | D-12, one-way contract shape |
| Schema shape | tools.schema.json is a map keyed by tool name; every object sets additionalProperties false | D-12, D-13, Claude's Discretion |
| Numeric defaults | startupBudgetMs default 10000, toolQueueMs default 2000, read.maxBytes maximum 1048576 | Claude's Discretion short bounded positive integers; recorded for Phase 7 |
| Engines | Set from docs/integration/hosts.md Node requirement, never guessed | D-09 |
| Dependency root | src/core/ owns states, errors, policy schema; src/contract/ depends only on src/core/ | Spec nodes n1, n2, n6 |

## Stack Touched in Phase 1

- [x] Project scaffold (strict TS, ESM, lint, built-in test runner, build)
- [ ] Routing — not applicable in Phase 1 (no CLI yet; owned by Phase 6)
- [ ] Database — not applicable in Phase 1 (session record is a JSON file validated by schema; owned by Phase 2 session store)
- [ ] UI — not applicable in Phase 1 (status indicator; owned by Phase 5)
- [ ] Deployment — not applicable in Phase 1 (container and daemon; owned by Phases 3 and 6)
- [x] Frozen contracts loaded and exercised (state table, error catalogue, schemas, validate wrapper)
- [x] One invalid input rejected with its typed code (SCHEMA_INVALID; REALM_INVALID_TRANSITION for state pairs)

## Out of Scope (Deferred to Later Slices)

- State-machine behavior, events, display mapping (Phase 2)
- Policy evaluation and defaults enforcement (Phase 2)
- Path canonicalization, locks, atomic writes (Phase 2)
- Podman, OpenShell, AgentOS, Anda runtime code and anda-decision.md (Phase 3)
- Reaper, egress guard, shared dispatcher (Phase 4)
- Omp plugin, MCP and ACP transports, host snippets (Phases 5 and 6)
- Policy reference and security review (Phase 7)

## Subsequent Slice Plan

Each later phase adds one vertical slice on top of this skeleton without altering its architectural decisions:

- Phase 2: Policy, state machine, filesystem lockdown, and contract tests against an in-memory fake
- Phase 3: Rootless Podman container, OpenShell, AgentOS, Anda bridge, lifecycle controller
- Phase 4: Orphan reaper, default-deny egress, single tool dispatcher
- Phase 5: Omp autostart and status, MCP and ACP over the shared dispatcher
- Phase 6: Standalone CLI, daemon, control channel, host packaging
- Phase 7: Policy reference and recorded security and supply-chain reviews

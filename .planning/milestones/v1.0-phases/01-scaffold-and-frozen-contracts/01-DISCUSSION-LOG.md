# Phase 1: Scaffold and Frozen Contracts - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md. This log preserves the alternatives considered.

**Date:** 2026-10-21
**Phase:** 1-scaffold-and-frozen-contracts
**Mode:** `--auto` (no interactive prompts; every question took its recommended default)
**Areas discussed:** Settled inputs, Scaffold and quality gates, Contracts, Integration notes

---

[--auto] Context check: no prior phase CONTEXT.md exists (first phase). No todos matched Phase 1. No phase-level SPEC.md exists, so requirements come from `.planning/REQUIREMENTS.md` and the spec.

[--auto] Selected all gray areas: Settled inputs, Scaffold and quality gates, Contracts, Integration notes.

## Settled inputs

[auto] Settled inputs — Q: "Policy mode default when disconnected?" → Selected: advisory with visible warning; fail-closed as per-project opt-in (recommended default; matches PROJECT.md Key Decisions and the spec ASSUMPTIONS).
[auto] Settled inputs — Q: "One container per session or per workspace?" → Selected: one container per session (recommended default; spec n4 and q3).
[auto] Settled inputs — Q: "Host write and edit tools in required mode?" → Selected: disable in required mode only (recommended default; spec q4). Recorded as an open question for Phase 5.
[auto] Settled inputs — Q: "Delivery order?" → Selected: vertical slice first (recommended default; spec q2).
[auto] Settled inputs — Q: "Anda boundary?" → Selected: TypeScript client over the Anda Engine HTTP API, to be confirmed by the anda.md note; no Rust shim unless the docs show no TypeScript-reachable surface (planning position from the orchestrator; spec n4).

## Scaffold and quality gates

[auto] Scaffold and quality gates — Q: "Test runner and toolchain?" → Selected: npm with lockfile, TypeScript strict ESM, ESLint flat config with typescript-eslint, Node built-in test runner. Each package verified in its registry before it is added (recommended default; spec "Verify all dependencies first").
[auto] Scaffold and quality gates — Q: "How is 'no silent catch' enforced?" → Selected: ESLint `no-empty` with empty catch blocks disallowed (recommended default; spec QUAL-01).
[auto] Scaffold and quality gates — Q: "Engines field source?" → Selected: derived from `docs/integration/hosts.md`, so `hosts.md` is written before the scaffold sets `engines` (recommended default; spec n7 step 6).

## Contracts

[auto] Contracts — Q: "Error catalogue shape?" → Selected: 20 codes from spec n6, `RealmError {code, reason, retryable}`, with a fixed retryable value per code (recommended default).
[auto] Contracts — Q: "State table scope in Phase 1?" → Selected: frozen table plus table-level tests only; display mapping and state-machine behavior deferred to Phase 2 (recommended default; ROADMAP Phase 2 owns CORE-01 and CORE-02).
[auto] Contracts — Q: "Schema form and validation?" → Selected: JSON Schema files at fixed paths, `additionalProperties: false`, one validator library verified before use, wrapper returns `SCHEMA_INVALID` (recommended default; spec n6 step 4 and TOOL-01).
[auto] Contracts — Q: "Exec shell form in the tool schema?" → Selected: schema-valid behind a `shell: true` branch, rejected by policy later with `SHELL_NOT_ALLOWED` (recommended default; spec TOOL-02, because the schema cannot see policy).
[auto] Contracts — Q: "Session record containerId before creation?" → Selected: nullable, null until the container exists (recommended default; spec RT-07 writes the record before container creation).
[auto] Contracts — Q: "Policy numeric defaults?" → Selected: left to Claude's discretion as short bounded values, recorded in the schema (recommended default; spec ASSUMPTIONS).

## Integration notes

[auto] Integration notes — Q: "Note format and gating?" → Selected: eight notes with URL, ISO read date, answered questions, and `not documented` for gaps; no code from memory (recommended default; spec NO_INVENTED_FACTS and n7).
[auto] Integration notes — Q: "URLs not given in the spec?" → Selected: discovered from official sources at execution time, never guessed; unfound means `not documented` (recommended default).

---

## Claude's Discretion

- tsconfig options beyond `strict` and ESM; ESLint rules beyond `no-empty`.
- Test layout (`test/` mirrors `src/`).
- Shape of `tools.schema.json` (a map by tool name, or one schema per tool).
- Numeric defaults for `startupBudgetMs` and `toolQueueMs`; the upper bound for `read.maxBytes`.
- Whether to add `schemaVersion` to the session record (default: no).
- File-level naming beyond the eight required integration note names.

## Deferred Ideas

- Display mapping and state-machine events: Phase 2.
- Policy evaluation: Phase 2.
- Path canonicalization, locks, atomic writes: Phase 2.
- Runtime code, gated Podman tests, `anda-decision.md`: Phase 3.
- Host write-tool removal in required mode: Phase 5.
- macOS, Bun, Swarm seam, per-workspace granularity: out of v1.

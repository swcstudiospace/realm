# Phase 1: Scaffold and Frozen Contracts - Pattern Map

**Mapped:** 2026-10-21
**Files analyzed:** 24 new (0 modified)
**Analogs found:** 0 / 24 (greenfield repo; no in-repo analogs exist)

## Analog Status

No in-repo analogs exist. The repo has no `package.json`, `tsconfig`, lint or test config, `src/` tree, or `docs/integration/`. Tracked files are `.agents/GEMINI.md` and `.planning/*`. `docs/specs/realm-spec.xml` is read-only. Every file below is "no analog in repo (greenfield)". Its convention source is the spec section, spec node, or PROJECT.md constraint named in the last column. No code excerpts are given.

## File Classification

### Scaffold (FOUND-01, QUAL-01)

| New File | Role | Governing Decision | Convention Source (no analog) |
|----------|------|--------------------|-------------------------------|
| `package.json` | config | D-07, D-08, D-09 | PROJECT.md constraints: ESM, strict, Node LTS, no unverified deps; `engines` from `docs/integration/hosts.md` |
| `package-lock.json` | config | D-07 | npm with committed lockfile (D-07); each package verified in registry before add |
| `tsconfig.json` | config | D-07 | TypeScript strict and ESM are fixed; other options are Claude's Discretion |
| `eslint.config.js` | config | D-07, D-08 | Flat config with typescript-eslint parser; `no-empty` disallows empty catch blocks (QUAL-01) |

Test config: none mandated. Node's built-in test runner (D-07) is invoked from the `test` script in `package.json`. If the plan adds a config file, D-07 and D-08 govern it.

### Frozen Contracts (FOUND-02)

| New File | Role | Governing Decision | Convention Source (no analog) |
|----------|------|--------------------|-------------------------------|
| `src/core/states.ts` | model | D-11 | `<STATES>` section; spec n1 and n2 (`src/core/` is the dependency root) |
| `src/core/errors.ts` | model | D-10 | Spec n6 catalogue of exactly 20 codes; PROJECT.md "typed errors with `code` and `reason`" |
| `src/core/policy.schema.json` | schema | D-15, D-01 | `<CONSTRAINTS>` HARD_LIMITS; spec n3 for mode (advisory default, fail-closed opt-in) |
| `src/contract/tools.schema.json` | schema | D-13 | `<SECURITY_AND_VALIDATION>`; workspace-relative path rule; one-way contract (published to MCP and ACP) |
| `src/contract/session-record.schema.json` | schema | D-14 | `<REALM_SANDBOX>` LIFECYCLE and RT-07 (record written before container exists); one-way on-disk format |
| `src/contract/validate.ts` | utility | D-12 | D-12 wrapper returns typed value or `RealmError` with `SCHEMA_INVALID`; spec n2 (`src/contract/` layer) |

### Integration Notes (FOUND-03)

Each note follows D-16: official URL(s), ISO 8601 read date, spec questions with sourced answers, and `not documented` where the docs are silent. The "Blocks" column comes from D-18.

| New File | Role | Governing Decision | Blocks / Notes |
|----------|------|--------------------|----------------|
| `docs/integration/agentos.md` | doc | D-16, D-17, D-18 | Blocks `src/runtime/agentos.ts`; start at `rivet.dev/docs` (D-17) |
| `docs/integration/podman.md` | doc | D-16, D-17, D-18 | Blocks `src/runtime/podman.ts`; start at `docs.podman.io` (D-17); local Podman 4.9.3 is not changed (D-05) |
| `docs/integration/openshell.md` | doc | D-16, D-17, D-18 | Blocks `src/runtime/openshell.ts`; URL not in spec, so find from official source or record `not documented` |
| `docs/integration/anda.md` | doc | D-06, D-16, D-18 | Blocks `src/anda/`; records evidence for or against the TypeScript-over-HTTP position; `not documented` reopens it in Phase 3 |
| `docs/integration/omp.md` | doc | D-03, D-16, D-18 | Blocks `plugin/`; records host-write removal as an open question for Phase 5 (OMP-05); no plugin code |
| `docs/integration/mcp.md` | doc | D-16, D-18 | Blocks transport code only; spec version and transport |
| `docs/integration/acp.md` | doc | D-16, D-18 | Blocks transport code only; spec version and transport |
| `docs/integration/hosts.md` | doc | D-09, D-16, D-18 | Blocks `engines` and build target; written before `package.json` sets `engines` |

### Tests (layout is Claude's Discretion; `test/` mirrors `src/`)

| New File | Role | Governing Decision | Convention Source (no analog) |
|----------|------|--------------------|-------------------------------|
| `test/core/states.test.ts` | test | D-11 | Every allowed edge accepted; every disallowed pair rejected, including self-transitions |
| `test/core/errors.test.ts` | test | D-10 | All 20 codes present; `retryable` values match the D-10 lists |
| `test/core/policy.schema.test.ts` | test | D-15 | Defaults and `additionalProperties: false` behavior |
| `test/contract/validate.test.ts` | test | D-12 | Valid input returns typed value; invalid input returns `SCHEMA_INVALID` with path in `reason` |
| `test/contract/tools.schema.test.ts` | test | D-13 | Six tools addressable by name; argv and shell `exec` forms both schema-valid; `..` and absolute paths rejected |
| `test/contract/session-record.schema.test.ts` | test | D-14 | Required fields enforced; `containerId` accepts null; unknown keys rejected |

Test files must not use `skip`, `todo`, `@ts-ignore`, `@ts-expect-error` as a blanket, or `eslint-disable` (D-08).

## Ordering and Open Items for the Plan

- `docs/integration/hosts.md` is written before `package.json` sets `engines` (D-09).
- The notes are written before any module that they block (FOUND-03). Phase 1 writes no integration module.
- `startupBudgetMs` and `toolQueueMs` defaults are short bounded values chosen in the plan (Claude's Discretion). Record them in the plan output for Phase 7's policy reference. Do not hard-code them elsewhere.
- The upper bound for `read.maxBytes` is an integer with a stated maximum in `tools.schema.json` (Claude's Discretion).
- The session record has no `schemaVersion` field (D-14, Claude's Discretion).
- Not created this phase: `docs/integration/anda-decision.md` (Phase 3, ANDA-01); any `src/runtime/`, `src/anda/`, or `plugin/` code.

## Shared Conventions (apply to every new `.ts` file)

- Strict TypeScript, ESM (`"type": "module"`), single package at the repo root (PROJECT.md).
- Typed errors use `RealmError` with `code`, `reason`, and `retryable` (D-10). No silent catch blocks (QUAL-01, D-08).
- `src/core/` is the dependency root. `src/contract/` depends only on `src/core/` (spec n2).
- Notes and schemas contain no host-local absolute paths (`/root`, `/home`, `/Users`) and no secrets (repo is public).

## Metadata

**Analog search scope:** repo root, `.planning/`, `.agents/`, `docs/`. The glob found no source, package, lint, test, or integration files.
**Files listed:** 24 (18 required deliverables; 6 proposed test files under Claude's Discretion).
**Pattern extraction date:** 2026-10-21

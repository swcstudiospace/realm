# Phase 2: Policy, State, and Filesystem Lockdown - Pattern Map

**Mapped:** 2026-10-21
**Files analyzed:** 22 new source and support files (D-19 plus `test/support/fake-execution.ts`), 8 named new test files (D-45), and 1 test directory with no named file (`test/core/*`, see Planner Findings F-4)
**Analogs found:** 11 / 22 source files with a partial or better analog (1 role-match, 10 partial); 11 greenfield. 7 / 8 named test files have a partial or better analog; 1 is greenfield.

## Analog Status Since Phase 1

The Phase 1 map (`01-PATTERNS.md`) reported an empty repo. That is superseded. These Phase 1 files now exist and are the analogs for this map:

- `src/core/states.ts`, `src/core/errors.ts`, `src/contract/validate.ts`
- `src/core/policy.schema.json`, `src/contract/tools.schema.json`, `src/contract/session-record.schema.json`
- `test/core/states.test.ts`, `test/core/errors.test.ts`, `test/core/policy.schema.test.ts`
- `test/contract/validate.test.ts`, `test/contract/tools.schema.test.ts`, `test/contract/session-record.schema.test.ts`
- `test/integration/podman-gate.test.ts`, `test/integration/podman-version.ts`, `test/integration/podman-version.test.ts`
- `eslint.config.js`, `tsconfig.json`, `package.json`

No `src/fs/`, `src/session/`, `src/audit/`, `src/lifecycle/`, `src/doctor/`, or `test/fs/`, `test/audit/`, `test/quality/`, `test/support/` directories exist yet.

## Conventions to Copy

These are the repo conventions every new file inherits. Excerpts are verbatim from existing files and each is at most 10 lines.

### 1. Module imports

From `src/contract/validate.ts` (imports block):

```ts
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Ajv2020, type ErrorObject, type SchemaObject, type ValidateFunction } from "ajv/dist/2020.js";
import { RealmError } from "../core/errors.js";
import { STATES, type State } from "../core/states.js";
```

Rules: relative imports carry the `.js` suffix (NodeNext). Builtins use the `node:` prefix. Type-only names use the inline `type` modifier inside a named import (`verbatimModuleSyntax` is on), as in `src/core/states.ts` (`import { makeRealmError, type RealmError } from "./errors.js";`).

### 2. Frozen constant tables

From `src/core/states.ts`:

```ts
// Object.freeze is shallow. Each edge is frozen as well as the outer array, the
// same way ERROR_CATALOGUE freezes its entries in src/core/errors.ts.
function freezeEdges(edges: Edge[]): readonly Edge[] {
  for (const edge of edges) {
    Object.freeze(edge);
  }
  return Object.freeze(edges);
}
```

From the same file, the list-and-derived-type pattern:

```ts
export const STATES = Object.freeze([
  "unbound",
  "connecting",
  // ...
] as const);

export type State = (typeof STATES)[number];
```

Rules for every new constant table (credential patterns D-31, redaction patterns D-41, check statuses D-44): `Object.freeze` the outer value and every entry; use `as const` where the element type is a literal; derive the type from the constant. `src/core/errors.ts` `freezeCatalogue` is the record-of-entries variant.

### 3. Errors

From `src/core/errors.ts`, the only construction path:

```ts
export function makeRealmError(code: ErrorCode): RealmError {
  return new RealmError(code);
}
```

Its comment says `reason` and `retryable` "come only from the catalogue, so every instance carries a catalogue code and nothing else." Rules:

- Use only the 21 codes in `ERROR_CODES`. D-10 freezes the catalogue, and Q-1 keeps teardown timeouts on `REALM_STOPPING`. Adding a code is out of scope.
- Phase 2 codes in use, from the decisions: `REALM_UNBOUND`, `REALM_NOT_ACTIVE`, `REALM_STOPPING`, `REALM_INVALID_TRANSITION`, `STARTUP_BUDGET_EXCEEDED`, `POLICY_DENIED`, `PATH_ESCAPE`, `CREDENTIAL_PATH_DENIED`, `LOCK_CONFLICT`, `WRITE_NOT_ATOMIC`, `SHELL_NOT_ALLOWED`, `SCHEMA_INVALID`.
- Subclass pattern to copy when a failure needs a detail string, from `src/contract/validate.ts`:

```ts
export class SchemaInvalidError extends RealmError {
  // The offending key or JSON pointer and the rule it broke. Never the value.
  readonly detail: string;

  constructor(detail: string) {
    super("SCHEMA_INVALID");
    this.detail = detail;
    this.message = `${this.reason} ${detail}`;
  }
}
```

### 4. Result shapes

Two discriminated-union conventions already exist in the decisions. Keep them separate; do not unify without a decision.

- `src/contract/validate.ts` uses an `ok` discriminant and never throws:

```ts
export interface ValidationOk<T> {
  readonly ok: true;
  readonly value: T;
}

export interface ValidationFailure {
  readonly ok: false;
  readonly error: SchemaInvalidError;
}
```

- D-36 (`read`, `list`) specifies a `status` discriminant: `{ status: "found", ... } | { status: "absent" }`. D-44 (`doctor`) specifies a check object with `status: "pass" | "warn" | "fail"`. Follow the decisions for these, not the `ok` shape.

### 5. Validation boundary and the privacy rule

From the header of `src/contract/validate.ts`:

```ts
// Privacy rule: a failure names the offending key or JSON pointer and the rule it
// broke. It never includes the offending value, because the value may be a
// credential. Messages are built from the keyword and pointer only, never from
// ajv's message text.
```

`src/contract/validate.ts` is the only module that imports ajv. Every schema check in Phase 2 (policy load, tool gate, session record read or write) must go through `validate(name, input)`. Hand-written copies of schema rules drift from the frozen schema. See Planner Findings F-1 to F-3 for the layering consequence.

### 6. Path rule in the frozen tool schema

From `src/contract/tools.schema.json`, the workspace-relative rule the canonicalizer may assume as input:

```json
"pattern": "^(?![/\\\\]|[A-Za-z]:)",
"not": { "pattern": "(^|[/\\\\])\\.\\.([/\\\\]|$)" }
```

The schema rejects absolute and `..`-containing paths. `src/fs/canonicalize.ts` (D-29) still enforces `PATH_ESCAPE` for symlink escapes, which the schema cannot see.

### 7. Tests

From `test/core/states.test.ts` (imports):

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
```

Conventions observed across `test/core/states.test.ts` and `test/contract/validate.test.ts`:

- `node:test` with `test("<behavior sentence>", () => { ... })`; titles state the behavior and name the decision where useful (for example, "a secret-shaped offending value never appears in the error").
- `assert/strict`. Compare error codes with `assert.equal(error.code, "SCHEMA_INVALID")`; match detail text with `assert.match(error.detail, /\/exec\/argv/)`.
- Expected values are pinned as literals so the test does not read the table under test (`EXPECTED_ALLOWED` in `states.test.ts`; `DEFAULTS` in `test/core/policy.schema.test.ts`).
- Unwrap helpers at the top of the file. From `test/contract/validate.test.ts`:

```ts
function value<T>(result: ValidationResult<T>): T {
  if (!result.ok) {
    throw new Error(`expected a value, got ${result.error.message}`);
  }
  return result.value;
}
```

- Gated suites use the `skip` option with a reason, not a suppression. From `test/integration/podman-gate.test.ts`: `test("Podman gated integration suite (...)", { skip: gate }, () => { ... })`.
- Tests run from `dist/test/` after `tsc` (`package.json` `test` script: `tsc -p tsconfig.json && node --test "dist/test/**/*.test.js"`). Every new test directory is picked up by that glob with no config change.

### 8. Lint and compiler gates (apply to every new file)

From `eslint.config.js`:

```js
"no-empty": ["error", { allowEmptyCatch: false }],
"@typescript-eslint/ban-ts-comment": [
  "error",
  { "ts-expect-error": true, "ts-ignore": true, "ts-nocheck": true },
],
```

From `tsconfig.json`: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noUnusedLocals`, `noUnusedParameters`, `noImplicitReturns`, `verbatimModuleSyntax`, `module`/`moduleResolution` `NodeNext`.

Consequences for Phase 2:

- No `catch {}` blocks. Every catch rethrows or maps to a `RealmError` code (QUAL-01, D-08).
- Optional object properties are written as `readonly ifMatchSha256?: string;` (from `WriteParams` in `validate.ts`). Assigning `undefined` explicitly needs `| undefined`, because of `exactOptionalPropertyTypes`.
- `stageHook` (D-35) and any unused parameters must be used or removed (`noUnusedParameters`).

### 9. Sync `node:fs` precedent

`src/contract/validate.ts` uses synchronous `existsSync` and `readFileSync` at schema load, and `dirname` and `join` from `node:path` with `fileURLToPath` for package-root resolution. This is the only fs precedent in the repo. D-35 does not say whether atomic writes are sync or async; the planner decides. No analog forces either.

### 10. Frozen files

Frozen files (`src/core/states.ts`, `src/core/errors.ts`, `src/core/policy.schema.json`, `src/contract/*`) are extended only by adding new files beside them. Nothing in Phase 2 edits their tables (D-19).

## File Classification: Source (src/)

Match key: **role-match** = same role and layer; **partial** = same concern or convention, different role; **none** = greenfield for this role (convention noted, no analog file).

| New file | Role | Data flow | Closest analog | Match | Convention to copy and notes |
|---|---|---|---|---|---|
| `src/core/state-machine.ts` | service (stateful wrapper) | state transition, event publish | `src/core/states.ts` | role-match | Wrap `checkTransition` and `makeRealmError`; do not redefine `ALLOWED_TRANSITIONS`. D-25: check before commit, publish after. |
| `src/core/events.ts` | service (typed bus) | pub-sub, synchronous | none | none | Greenfield. Event type is an exported interface; no bus precedent. D-26 delivery order and rethrow rule. |
| `src/core/status.ts` | utility (pure mapping) | transform | `src/core/states.ts` | partial | Pure exported function over the `State` union. Labels are exact strings; use `as const` for the two labels (section 2). |
| `src/core/policy.ts` | service (load, defaults, mode, exec gate) | transform, load | `src/contract/validate.ts` (`Policy`, `validate("policy")`) | partial | Load must go through `validate`. **Layer conflict; see F-1.** Mode decision `decideMutation` is pure. Gate `checkExecPolicy` returns `SHELL_NOT_ALLOWED`. |
| `src/core/ports.ts` | model (interface only) | none | `src/contract/validate.ts` (exported `interface` blocks such as `ToolParams`) | partial | Interface only, no runtime values. D-39 signatures are exact. No environment field (AUD-02). |
| `src/core/timeout.ts` | utility | async, time-bounded | none | none | `withTimeout(promise, ms, code)` rejects with `makeRealmError(code)`; clear the timer on settle. |
| `src/fs/root.ts` | model (pinned canonical root) | transform | none | none | Holds the canonical root resolved by `realpath` (D-22, D-29 step 1). D-19 names the file; its scope beyond that is not defined. See F-9. |
| `src/fs/canonicalize.ts` | utility (path resolution) | transform, filesystem read | none | none | Greenfield. D-29 hop limit 40 maps to `PATH_ESCAPE`. Input is already schema-valid (section 6). |
| `src/fs/glob.ts` | utility (matcher) | transform | none | none | Greenfield. Local matcher, no dependency (D-32). `*`, `?`, `**`. |
| `src/fs/credentials.ts` | config (frozen pattern list) | none | `src/core/states.ts` (`freezeEdges`), `src/contract/validate.ts` (`SCHEMA_FILES`) | partial | Single frozen constant (section 2). Matched after canonicalization (D-31). |
| `src/fs/locks.ts` | service (in-memory lock table) | state, keyed | none | none | Greenfield. Map keyed by canonical real path; idempotent `acquire` and `release` (D-33). |
| `src/fs/atomic-write.ts` | utility (atomic replace) | file write | none | none | Greenfield. Node `fs` precedent is sync (section 9). Errors map to `WRITE_NOT_ATOMIC`. `stageHook` is test-only. |
| `src/fs/read.ts` | service (read) | file read | none | none | Greenfield. Returns the D-36 `status` union. Rejects non-regular files with `PATH_ESCAPE`. |
| `src/fs/list.ts` | service (directory list) | file read | none | none | Greenfield. Symlinks reported, never followed. 1000-entry cap. |
| `src/fs/write.ts` | service (locked write) | file write | none | none | Greenfield. Composes canonicalize, credential check, lock, hash check, and atomic replace in the D-34 order. `finally` releases the lock. |
| `src/session/paths.ts` | utility | transform | `src/contract/validate.ts` (`dirname`, `join`, `fileURLToPath`) | partial | Resolves `$XDG_STATE_HOME/realm` or `$HOME/.local/state/realm` (D-37). Takes env as an argument; never reads `process.env` directly if avoidable, so tests stay hermetic. |
| `src/session/store.ts` | service (record persistence) | file read and write | `src/contract/validate.ts` (validates `sessionRecord`) | partial | Writes through the D-35 atomic replace. Records must validate via `validate("sessionRecord")`. **Layer conflict; see F-2.** |
| `src/audit/redact.ts` | utility (pure) | transform | `src/contract/validate.ts` (privacy rule header) | partial | Recursive, depth-limited, fail-closed to `"[REDACTED]"` (D-41). Never throws. Never echoes the value in any error. |
| `src/audit/log.ts` | service (append-only log) | file append | `src/session/store.ts` (sibling; to be written) | none | Greenfield. `O_APPEND`, mode 0600, JSON Lines. Redaction runs before append (D-42). |
| `src/lifecycle/controller.ts` | service (orchestration) | state transition, async | `src/core/states.ts` (consumer of `checkTransition`) | partial | Composes core, session, and the port. Owns the single `5000` teardown constant (D-28). Calls the state machine only with checked transitions (D-38). |
| `src/doctor/checks.ts` | service (check runner) | transform, filesystem read | `src/contract/validate.ts` (`ValidationOk` and `ValidationFailure`) | partial | Check object shape per D-44. Uses `access(W_OK)` and no probe write. Registers only the three Phase 2 checks. |
| `test/support/fake-execution.ts` | test double (in-memory port) | state, keyed | `test/contract/validate.test.ts` (helper functions) | partial | Greenfield implementation of the D-39 interface. Test-only, under `test/`, so no integration code sits in `src/` (D-19). Keyed by idempotency key; call counters; scripted delay and failure. |

## File Classification: Tests (test/)

| New or named file | Role | Data flow | Closest analog | Match | Convention to copy and notes |
|---|---|---|---|---|---|
| `test/core/state-machine.test.ts` (D-45, state-machine) | test (unit) | state transition | `test/core/states.test.ts` | role-match | Same `node:test` style and literal pins. Assert that a rejected transition leaves state, reason, time, and events unchanged (D-25). |
| `test/fs/glob.test.ts` (D-45, unit) | test (unit) | transform | `test/core/states.test.ts` (style only) | partial | Table-driven `test(...)` per pattern. No fs needed. |
| `test/fs/canonicalize.test.ts` (D-45, path and symlink) | test (integration-like, temp dirs) | filesystem read | `test/core/states.test.ts` (style only) | partial | No in-repo temp-directory helper exists. D-37 says tests use temporary directories. Put the helper in `test/support/`. |
| `test/fs/toctou.test.ts` (D-45, path and symlink) | test (race) | filesystem read and write | none for fs; style from `test/contract/validate.test.ts` | partial | Greenfield for fs races. Tests for D-30 must fail closed where `/proc/self/fd` is absent; they must not skip silently. |
| `test/contract/tool-input-gate.test.ts` (D-45, schema rejection) | test (unit) | input validation | `test/contract/tools.schema.test.ts` | role-match | Same `value` and `rejection` helpers and the same schema. Read the full analog first; see F-6. |
| `test/contract/exec-policy.test.ts` (D-45, schema rejection) | test (unit) | input validation, policy gate | `test/contract/tools.schema.test.ts` (exec cases) and `test/core/states.test.ts` (pure check style) | role-match | Covers `checkExecPolicy` (D-24): argv allowed, shell rejected unless `shellEnabled`. |
| `test/audit/redaction.test.ts` (D-45, audit redaction) | test (unit) | transform | `test/contract/validate.test.ts` (secret-shaped value test) | partial | Mirror the existing "secret-shaped offending value never appears" assertion. Assert sentinel absence in the output, not only that a key was replaced. |
| `test/core/*` (D-45, unit, no file named) | test (unit) | mixed | `test/core/states.test.ts`, `test/core/errors.test.ts` | partial | Any new core test (events, status, timeout, policy) goes here. D-45 does not name them; see F-4. |
| `test/quality/suite-taxonomy.test.ts` (D-45, taxonomy check) | test (meta) | filesystem read | none | none | Greenfield. Reads category directories with `node:fs` and asserts each has a test file. See F-5 for the category map. |

Existing tests not changed in Phase 2: `test/core/states.test.ts`, `test/core/errors.test.ts`, `test/core/policy.schema.test.ts`, `test/contract/validate.test.ts`, `test/contract/tools.schema.test.ts`, `test/contract/session-record.schema.test.ts`, `test/integration/podman-gate.test.ts`, `test/integration/podman-version.test.ts`. No new integration test in Phase 2 (D-45).

## Pattern Assignments (short)

- **State machine (`src/core/state-machine.ts`):** call `checkTransition(from, to)` from `src/core/states.ts`; if it returns a `RealmError`, throw it before any mutation. The only table is the frozen one.
- **Policy loader (`src/core/policy.ts`):** the `Policy` type comes from `src/contract/validate.ts`. Defaults come from `validate("policy", raw)`; the loader does not hard-code D-15 defaults except in tests, which pin them as literals (the `DEFAULTS` pattern in `test/core/policy.schema.test.ts`).
- **Tool gate (D-40):** call `validate("tools", raw)` first; the only test-side pattern is the `value` and `rejection` helpers from `test/contract/tools.schema.test.ts`.
- **Redaction (`src/audit/redact.ts`):** a pure function whose output never contains the input value on error. The privacy rule in `src/contract/validate.ts` is the model: report keys and rules, never values.
- **Persistence (`src/session/store.ts`, `src/audit/log.ts`):** `node:fs` only, paths from a `stateDir` argument (D-37), modes 0700 and 0600. No analog file exists; follow the D-35 and D-42 text.

## Planner Findings (resolve before planning)

These are conflicts or gaps between the decisions and the existing code. None is resolved here; each needs an orchestrator or planner decision.

**F-1. Layer conflict: policy loading and exec gating in `src/core/`.** D-19 places `src/core/policy.ts` in `core`, and D-20 states "`core` imports nothing from the other modules." But the loader must call `validate("policy", …)` from `src/contract/validate.ts`, and `contract` imports `core` (D-20). Placing the loader in `core` creates a cycle. The exec gate needs the `ExecParams` and `Policy` types from `contract`, which has the same problem even as type-only imports. Options for the planner to choose between: move the loader and gate into a new file beside `src/contract/` (allowed by D-19's "extend by adding new files beside them"), or amend D-20 to permit `core` to type-import `contract`. Either choice must be recorded, because D-20 is the dependency rule.

**F-2. D-20 omits `contract` for three modules that must validate.** D-20 lists dependencies as: `session` imports `core` and `fs`; `lifecycle` imports `core`, `session`, and `fs`; `doctor` imports `core`, `session`, and `fs`. But `validate.ts` is the only ajv importer, so `session/store.ts` (sessionRecord), the lifecycle create path, and `doctor/checks.ts` (`policy-file` invalid → fail, D-44) all need `contract`. Amend D-20 to add `contract` for these three, or route validation through a module that is allowed.

**F-3. `workspaceRoots` absoluteness is not enforced by the frozen schema.** `src/core/policy.schema.json` declares `workspaceRoots` items as `{ "type": "string" }` with no pattern. D-22 requires a relative root to fail with `SCHEMA_INVALID`. Since the schema is frozen (D-15), the check must be a code check in the loader, after `validate("policy", …)` succeeds, that returns `SCHEMA_INVALID` through the same `SchemaInvalidError` shape. Verify that `test/core/policy.schema.test.ts` does not assert that a relative root passes. That file was only partly read (lines 1-33 of 97).

**F-4. Named tests are incomplete.** D-45 names test files for state-machine, glob, canonicalize, toctou, tool-input-gate, exec-policy, redaction, and taxonomy. These decisions require behavior tests with no named path:

- `src/fs/locks.ts` (D-33): idempotent acquire and release; session destroy releases locks.
- `src/fs/atomic-write.ts` and `src/fs/write.ts` (D-34, D-35): fault injection through `stageHook` at `after-temp-write`, `after-fsync`, `before-rename`.
- `src/fs/read.ts`, `src/fs/list.ts` (D-36): truncation, non-regular rejection, symlink reporting, 1000-entry cap.
- `src/session/store.ts` (D-37): record fields, mode 0600 and 0700, no secret field.
- `src/lifecycle/controller.ts` (D-38, D-43): create-before-container ordering (RT-07); the sentinel-environment test.
- `src/doctor/checks.ts` (D-44): three checks with their pass, warn, and fail outcomes.
- `src/core/events.ts`, `src/core/status.ts`, `src/core/timeout.ts`, `src/core/policy.ts`: no named file.

Proposed placement, not decided: `test/fs/locks.test.ts`, `test/fs/atomic-write.test.ts`, `test/session/store.test.ts`, `test/lifecycle/controller.test.ts`, `test/doctor/checks.test.ts`. The orchestrator must confirm these, and F-5 must be resolved for them.

**F-5. Taxonomy check cannot classify the proposed directories.** `test/quality/suite-taxonomy.test.ts` asserts that each category directory has at least one test file. D-45's categories are unit, state-machine, path and symlink, schema rejection, audit redaction, and integration. It does not map `test/session/`, `test/lifecycle/`, `test/doctor/`, or `test/fs/locks`, `test/fs/atomic-write`. Either assign them to existing categories in D-45, or add categories and say which one each directory belongs to. Without this the taxonomy test has no defined input.

**F-6. Overlap with Phase 1 tool-schema tests.** `test/contract/tools.schema.test.ts` (245 lines) already covers argv and shell acceptance, empty argv rejected with the path named, and an exec with neither form rejected (lines 1-43 read). The D-40 list (unknown keys at each level, unknown tool names, both exec forms together, shell form with no `script`, absolute and `..` paths, over-large `maxBytes`) is partly covered. Read lines 44-245 before writing `tool-input-gate.test.ts`, and add only the cases missing from it.

**F-7. The "no environment field" assertion cannot use suppression comments.** D-39 and D-43 require the port to have no environment field, and an env-free check on the fake. `eslint.config.js` bans `@ts-expect-error` and `@ts-ignore` (D-08). Any negative type assertion must be a runtime check (for example, a key-set comparison on the fake and on the port's sample request), not a `@ts-expect-error` line.

**F-8. Linux-only path verification.** D-30 relies on `/proc/self/fd`. The toctou and canonicalize tests must fail closed where `/proc` is missing, as D-30 requires. They must not be gated with a silent skip, because that would hide a path-verification failure.

**F-9. `src/fs/root.ts` scope is undefined.** D-19 lists it, D-29 step 1 says canonicalization starts "at the pinned, canonical root," and D-22 says roots are canonicalized at bind. The decisions do not say whether `root.ts` is a separate module or whether its function belongs in `canonicalize.ts`. The planner decides.

**F-10. Result naming differs.** `validate()` returns `ok`; D-36 returns `status`; D-44 returns `status` with `pass` or `warn` or `fail`. This is intentional per the decisions, but the planner should not unify them silently (section 4).

**F-11. Q-4 (MCP and ACP contract tests).** No MCP or ACP test is in Phase 2 scope. This is consistent with D-45 and open question Q-4. Nothing to map.

## Metadata

**Analog search scope:** `src/core/`, `src/contract/`, `test/core/`, `test/contract/`, `test/integration/`, root config (`package.json`, `tsconfig.json`, `eslint.config.js`), and `.planning/phases/`.
**Files read for analogs:** `src/core/states.ts`, `src/core/errors.ts` (lines 30-63 and `makeRealmError`), `src/contract/validate.ts` (lines 1-60, 96-120, 185-203), `src/contract/tools.schema.json` (lines 21-22), `src/core/policy.schema.json` (lines 1-30), `test/core/states.test.ts` (imports and test titles), `test/contract/validate.test.ts` (helpers and titles), `test/contract/tools.schema.test.ts` (lines 1-43), `test/core/policy.schema.test.ts` (lines 1-33), `test/integration/podman-gate.test.ts`, `package.json`, `tsconfig.json`, `eslint.config.js`.
**Phase 2 decisions read:** D-01 through D-45 and the canonical references in `02-CONTEXT.md`.
**Pattern extraction date:** 2026-10-21

## PATTERN MAPPING COMPLETE

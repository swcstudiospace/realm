# Plan 01-05 summary: frozen schemas and SCHEMA_INVALID validation wrapper (FOUND-02, QUAL-01)

Status: complete. Built TDD: four test files written first, RED recorded, then the three schemas and `validate.ts` written, GREEN recorded. All four scripts exit 0. No banned directive from D-08 appears in any file written. No package was installed and `package.json` is unchanged.

## Files changed

| File | Change |
| --- | --- |
| `src/core/policy.schema.json` | New. Exactly the D-15 keys, defaults applied by the wrapper, every object `additionalProperties: false`. |
| `src/contract/tools.schema.json` | New. Map keyed by the six D-13 tool names. Path rules at schema level. |
| `src/contract/session-record.schema.json` | New. D-14 fields, `containerId` string or null, six-state enum, no `schemaVersion`. |
| `src/contract/validate.ts` | New. The only module that imports ajv. Named-schema wrapper returning a typed value or a `SchemaInvalidError`. |
| `test/core/policy.schema.test.ts` | New. Defaults, fail-closed acceptance, mode rejection, zero-budget rejection, unknown-key rejection, egress rules. |
| `test/contract/tools.schema.test.ts` | New. Six tools by name, argv and shell exec forms, path rules (absolute, `..`, Windows forms), `ifMatchSha256`, `maxBytes` boundary, empty and unknown-key inputs. |
| `test/contract/session-record.schema.test.ts` | New. Null and string `containerId`, required fields, empty object, the six states cross-checked against `STATES`, forbidden keys. |
| `test/contract/validate.test.ts` | New. Typed value, `SCHEMA_INVALID` shape, detail naming, unknown key, non-object input, and the secret-value leak test. |
| `.planning/phases/01-scaffold-and-frozen-contracts/01-05-SUMMARY.md` | This file. |

`src/core/errors.ts`, `src/core/states.ts`, `package.json`, `tsconfig.json`, and `docs/` are untouched.

## TDD evidence

RED. `npm test` after writing the four test files and before any implementation. `tsc` fails on the missing module, so the node test runner never starts:

```
> tsc -p tsconfig.json && node --test "dist/test/**/*.test.js"

test/contract/session-record.schema.test.ts(7,8): error TS2307: Cannot find module '../../src/contract/validate.js' or its corresponding type declarations.
test/contract/tools.schema.test.ts(7,8): error TS2307: Cannot find module '../../src/contract/validate.js' or its corresponding type declarations.
test/contract/validate.test.ts(7,8): error TS2307: Cannot find module '../../src/contract/validate.js' or its corresponding type declarations.
test/core/policy.schema.test.ts(7,8): error TS2307: Cannot find module '../../src/contract/validate.js' or its corresponding type declarations.
(followed by TS2571/TS18046 "unknown" errors from the unresolved import)
EXIT=2
```

GREEN. Same command after the schemas and `validate.ts` were written:

```
ℹ tests 155
ℹ pass 155
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
EXIT=0
```

Final gate run, all after GREEN:

| Script | Command | Exit |
| --- | --- | --- |
| typecheck | `npm run typecheck` | 0 |
| lint | `npm run lint` | 0 |
| test | `npm test` (155 pass, 0 fail, 0 cancelled, reporter-listed skipped and todo counts 0) | 0 |
| build | `npm run build` | 0 |

Failures hit on the way to GREEN, all fixed without suppression:

1. `TS2351: This expression is not constructable` on the default import of `ajv/dist/2020.js`. Under NodeNext the CJS default import is typed as the module namespace. Fixed by the named import (see Decisions).
2. Runtime `strictRequired` error on the `exec` `if/then/else`. Fixed by setting `strictRequired: false` on the ajv instance (see Decisions).
3. Lint `@typescript-eslint/no-dynamic-delete` in the `without()` test helper. Fixed by rebuilding the object with `Object.fromEntries`.

Banned-directive sweep (D-08) over `src/` and `test/` returned no matches. A known-positive query over the same paths returned the expected lines, so the search ran.

## Decisions

1. **Error reason versus D-12 (approved by Main).** D-12 requires the `SCHEMA_INVALID` reason to name the offending key or path. `RealmError(code)` takes its reason only from the catalogue, and the plan forbids editing `errors.ts`. Applied, as approved: `validate.ts` returns `SchemaInvalidError extends RealmError`, with code `SCHEMA_INVALID` and the catalogue reason unchanged. It adds a `detail` field, and `message` is the catalogue reason plus `detail`. `detail` is the JSON pointer and a fixed rule phrase (for example `/write/path: matches a forbidden form`, `/sessionId: required key is missing`). The catalogue `reason` on its own does not name the path; the path is in `detail` and `message`. Clean fix for later: an optional detail argument on `RealmError`, which touches `errors.ts` and needs its own decision.

2. **No value ever appears in a failure (approved by Main).** `detail` is built only from the pointer, the key name for `additionalProperties` and `required` failures, and a fixed phrase per ajv keyword. ajv's own message text is never used, because it can include values. Test `a secret-shaped offending value never appears in the error` feeds a secret-shaped string into nine invalid positions and asserts it is absent from `message`, `detail`, `reason`, `JSON.stringify(error)`, and `String(error)`.

3. **Tool call shape (D-13 map).** A tool call is an object with exactly one key, the tool name, whose value is that tool's input: `{ "write": { "path": "a.txt", "content": "x" } }`. `minProperties: 1` and `maxProperties: 1` reject an empty envelope and an envelope holding two tools. Plan wording left this open; this shape is the reading of "a map keyed by tool name".

4. **`exec` form.** A single object with `argv` (array, `minItems: 1`), `shell` (`const: true`), and `script` (non-empty string). An `if: { required: ["shell"] }` selects the shell form, whose `then` requires `script` and forbids `argv`. Otherwise `else` requires `argv`. Both forms are schema-valid. Policy gating of the shell form (`SHELL_NOT_ALLOWED`) stays in Phase 2. A `oneOf` over two forms was tried first and rejected: when both branches fail it reports only `/exec`, which hides the `/exec/argv` path the plan names.

5. **`strictRequired: false`.** ajv's strict `strictRequired` check flags `required` names in `if`, `then`, and `else` subschemas that are declared only in the parent `properties`. That is the normal shape of conditional subschemas. Every other strict check stays on. The option is set on the single ajv instance in `validate.ts` with a comment.

6. **ajv import form.** `import { Ajv2020, type ErrorObject, type SchemaObject, type ValidateFunction } from "ajv/dist/2020.js";`. Draft 2020-12 needs the `/2020` entry, because the root `ajv` entry is draft-07 only. The default import fails typecheck under NodeNext (`TS2351`), so the named export is used. `ajv/dist/2020.d.ts` declares `export declare class Ajv2020`, and `ajv/dist/2020.js` sets `module.exports.Ajv2020`, so Node's CJS lexer detects it at runtime.

7. **Schema loading.** `tsc` does not copy JSON into `dist/`, and `tsconfig.json` has no `resolveJsonModule`, so the schemas are read with `readFileSync` at runtime. `validate.ts` walks up from its own module location to the directory holding `package.json`, then reads `src/core/…` or `src/contract/…`. This works from `src/` and from `dist/src/`.

8. **Defaults.** ajv `useDefaults` fills defaults on a `structuredClone` of the input, so the caller's object is never mutated and each result holds fresh arrays. Covered by tests.

9. **Recorded numeric defaults for the Phase 7 policy reference (Claude's Discretion).** `startupBudgetMs` default **10000**; `toolQueueMs` default **2000**. Both are positive integers, `minimum: 1`. Hard-coded nowhere else.

10. **Bounds added beyond the plan's wording.** Each is a plain validity bound, flagged here so Main can reject any of them:
    - `read.maxBytes`: integer, `minimum: 1`, `maximum: 1048576`. Negative and zero values are rejected.
    - `list.depth`: integer, `minimum: 0`.
    - `egressAllow[].port`: integer, 1 to 65535.
    - `egressAllow[].host`, session ids, `workspaceRoot`, `controlSocketPath`, `exec.script`: non-empty strings.
    - `write.ifMatchSha256`: `^[0-9a-f]{64}$`, as the plan requires.

11. **`containerId` is optional, not required.** The plan lists five required fields (`realmId`, `sessionId`, `workspaceRoot`, `state`, `controlSocketPath`) and says `containerId` is nullable. The schema follows that list exactly: `containerId` may be absent, a string, or null. D-14 says it is always written, starting as null. Phase 2 should always write it. Open for Main if you want it required.

12. **Path rule.** Workspace-relative paths are non-empty, do not start with `/` or `\` or a drive letter (`[A-Za-z]:`), and have no `..` segment in either separator style. Names that only contain dots (`..hidden`, `a..b`, `dir/..x`, `x/.`) pass. Tests cover both sides. Canonicalization stays in Phase 2.

13. **Session record.** No `schemaVersion`, token, secret, or environment key. Those keys are rejected by `additionalProperties: false`. Tests cover each one. The `state` enum is cross-checked against `STATES` from `src/core/states.ts` in the session-record test.

## Open questions

1. **ajv is in devDependencies, but `validate.ts` imports it at runtime.** Per the plan, `package.json` is unchanged. Main should move `ajv@8.20.0` to `dependencies`. Until then the built output would not run outside a dev install.

2. **Dependency direction for `Policy` and `SessionRecord` types.** Spec n2 says `src/contract/` depends only on `src/core/`. The value types are hand-written in `validate.ts`, because JSON schemas cannot be imported under the current `tsconfig` (no `resolveJsonModule`). Phase 2 modules that need `Policy` would import from `src/contract/`, which runs against n2. The right home is `src/core/`, which needs a new file outside this plan's scope. The types mirror the schemas by hand; the enum cross-check against `STATES` is the only automated drift guard so far.

3. **`validate()` throws on non-JSON input.** `structuredClone` throws for functions and symbols. Input is JSON from the host boundary, so this cannot happen there. A TypeScript caller passing such values would get an uncaught `DataCloneError`, not `SCHEMA_INVALID`.

## Rework 1

Scope: findings M-1 and m-2 from `01-REVIEW.md` (gate CHANGES_REQUESTED). Nothing else changed. M-2 and the other minor items are deferred (see below).

### M-1: the exec argv form accepted `script` (fixed)

- `src/contract/tools.schema.json`: the `else` branch (argv form) now sets `"properties": { "script": false, "shell": false }`. An argv call that carries `script` or `shell` no longer validates. The `if` and the shell-form `then` are unchanged.
- Tests added to `test/contract/tools.schema.test.ts`: argv with `script` is rejected and the detail names `/exec/script`; argv with `shell: true` and no script is rejected; argv with `shell: false` is rejected. Existing tests still cover shell with argv, mixed forms, and both valid forms.

### m-2: `validate()` threw on non-JSON input (fixed)

- `src/contract/validate.ts`: the `structuredClone` call is wrapped. A clone failure returns a `SchemaInvalidError` (code `SCHEMA_INVALID`) with detail `input holds a value that is not JSON-compatible`. The thrown `DataCloneError` is discarded, not echoed: V8 builds its message from the value itself (RED output showed `() => SECRET could not be cloned.` and `Symbol(sk-live-SECRET-4242-sym) could not be cloned.`).
- The detail names the rule, not a JSON pointer. Naming the pointer would need a walker with cycle protection; not added.
- Tests added to `test/contract/validate.test.ts`: a function input at the root, and a symbol nested in an object. Both return `SCHEMA_INVALID`, and the secret text appears in neither `message`, `detail`, `String(error)` nor `JSON.stringify(error)`.

### TDD evidence

RED: `npm test` after the tests were added and before any source change. Exit 1. Tests 173, pass 169, fail 3, skipped 1. Failing:

- `exec argv form with a script key is rejected and the key is named` (schema accepted it)
- `a function input returns SCHEMA_INVALID instead of throwing` (`DataCloneError`)
- `a symbol nested in the input returns SCHEMA_INVALID and never echoes its description` (`DataCloneError`)

The two argv-with-shell negatives already passed at RED. Those cases were rejected by the `then` branch, so they are regression guards, not holes.

GREEN: after both fixes, every gate exits 0:

| Script | Command | Exit | Result |
| --- | --- | --- | --- |
| typecheck | `npm run typecheck` | 0 | clean |
| lint | `npm run lint` | 0 | clean |
| test | `npm test` | 0 | tests 173, pass 172, fail 0, skipped 1 |
| build | `npm run build` | 0 | clean |
| integration | `npm run test:integration` | 0 | tests 12, pass 11, fail 0, skipped 1 |

The one skip in each run is the Podman gate. The host has Podman 4.9.3, which the gate records as `PODMAN_UNSUPPORTED_VERSION` (01-06 deviation 2). It was skipped at RED too, so it is not caused by this rework.

Open question 3 above (`validate()` throws on non-JSON input) is resolved by this rework.

### Deferred (not in this rework)

- M-2: `ajv` under `devDependencies` while imported at runtime. Owner decision; `package.json` is untouched.
- m-1: `containerId` optional in the session-record schema.
- m-3: `STATES` and `ERROR_CODES` not frozen at runtime.
- m-4: session-record state enum not tied to `STATES`.
- m-5: `engines` `>=22` admits Node versions that the installed eslint rejects.
- m-6: schemas are not copied into `dist/`.
- m-7: plan 01-06 has no PLAN file.
- m-8: integration notes cited an unnamed earlier note. Resolved in the fix-up pass: each citation is replaced by an official URL or "not documented".
- n-1 to n-4: nits, as listed in the review.

## Fix-up pass decisions

- **dist self-containment (m-6) deferred to Phase 6.** Schemas still load from `src/core/` and `src/contract/` at runtime, so `dist/` is not self-contained. Phase 6 packaging must bundle the schemas into `dist/`. Not implemented in Phase 1.
- **Podman gate override (accepted).** `PODMAN_UNSUPPORTED_VERSION` is added to the error catalogue, which now has 21 codes: the 20 codes listed above plus this one. `npm run test:integration` exists and runs the Podman gate, which records the host's Podman 4.9.3 as unsupported and skips. This overrides D-10 (the 20-code catalogue) and D-05 (no change to the host Podman).
- **containerId stays optional (m-1).** The session record is written before the container is created, so `containerId` is optional in `session-record.schema.json` and accepts a string or null. Phase 2 must always write it, starting as null (D-14).

# Plan 01-04 summary: frozen state table and typed error catalogue (FOUND-02, QUAL-01)

Status: complete. Built TDD: tracer tests written first and observed RED, then source written and observed GREEN, then full coverage tests. All four scripts exit 0. No suppression directive, skip, or todo was introduced. Only the files listed in the plan were touched.

## Files changed

| File | Change |
| --- | --- |
| `src/core/states.ts` | New. Six states, frozen allowed-edge table (13 edges), pure `isTransitionAllowed` and `checkTransition`. |
| `src/core/errors.ts` | New. Exactly 20 codes, one frozen catalogue (reason plus retryable per code), `RealmError` class, `makeRealmError`. |
| `test/core/states.test.ts` | New. Structural tests, table pins, and one test per ordered pair (36). |
| `test/core/errors.test.ts` | New. Catalogue pins, retryable partition, and one test per code (20). |
| `.planning/phases/01-scaffold-and-frozen-contracts/01-04-SUMMARY.md` | This file. |

## Discrepancy in the plan: edge count

The plan states 12 allowed edges and 24 rejected pairs. The D-11 table it cites lists 13 edges: unbound>connecting (1), connecting>active|error|stopping (3), active>degraded|error|stopping (3), degraded>active|error|stopping (3), error>connecting|stopping (2), stopping>unbound (1). That totals 13. The spec n6 table (`docs/specs/realm-spec.xml`, node n6) gives the same 13 edges.

Applied: the table is implemented exactly as D-11 and the spec's allowed-edge table (realm-spec.xml, node n6, CONCLUSION) list it. Corrected counts, which supersede the plan's 12 and 24: 13 allowed edges and 23 rejected of 36 ordered pairs. The 23 include the six self-transitions. No edge was added or dropped to match the plan's figures.

## Design choices

- `ALLOWED_TRANSITIONS` is an exported frozen array of `[from, to]` pairs. Self-transitions are absent from it, so they are rejected by the table itself. No separate branch is needed.
- `checkTransition(from, to)` returns `null` when allowed, otherwise a `RealmError` with code `REALM_INVALID_TRANSITION`. `isTransitionAllowed` returns the boolean. The caller decides whether to throw (Phase 2).
- `RealmError extends Error` with `code`, `reason`, and `retryable`. The constructor takes only the code and reads reason and retryable from `ERROR_CATALOGUE`, so the catalogue is the single lookup and no caller can supply ad hoc values.
- `ERROR_CATALOGUE` is typed `Record<ErrorCode, CatalogueEntry>`, so a missing or extra code is a compile error. The codes are also listed as `ERROR_CODES`.
- `src/core/states.ts` imports only `./errors.js`. `src/core/errors.ts` imports nothing. Nothing outside `src/core/` is imported.

## Task 1 (tracer): RED then GREEN

RED. `npm test` run after writing the tracer tests and before any source existed:

```
> tsc -p tsconfig.json && node --test "dist/test/**/*.test.js"

test/core/errors.test.ts(3,44): error TS2307: Cannot find module '../../src/core/errors.js' or its corresponding type declarations.
test/core/states.test.ts(3,54): error TS2307: Cannot find module '../../src/core/states.js' or its corresponding type declarations.
test/core/states.test.ts(4,28): error TS2307: Cannot find module '../../src/core/errors.js' or its corresponding type declarations.
EXIT=2
```

GREEN. Same command after writing the minimal sources:

```
✔ tracer: makeRealmError builds a typed error with code, reason and retryable (1.105851ms)
✔ tracer: unbound -> connecting is accepted (1.721023ms)
✔ tracer: active -> unbound is rejected with REALM_INVALID_TRANSITION (0.45241ms)
ℹ tests 3
ℹ pass 3
ℹ fail 0
ℹ skipped 0
ℹ todo 0
EXIT=0
```

The tracer GREEN source already contained the full D-11 edge table and the full 20-code D-10 catalogue. The plan's Task 2 required no source change, so the expansion below was not a separate RED step. Its tests were written against the complete tables.

## Task 2: full matrix and catalogue (GREEN)

Final run of the four scripts, after all test files were expanded:

```
npm run typecheck   -> tsc -p tsconfig.json --noEmit           EXIT 0
npm run lint        -> ESLint: No issues found                  EXIT 0
npm test            -> tests 65, pass 65, fail 0, skipped 0, todo 0   EXIT 0
npm run build       -> tsc -p tsconfig.json                     EXIT 0
```

Test breakdown (65 total):

- `test/core/states.test.ts`: 41 tests. Five structural tests (state set, 36-pair count with 13 allowed and 23 rejected, exported table equals the pinned D-11 edges, table frozen, all six self-transitions rejected with `REALM_INVALID_TRANSITION`) plus 36 per-pair tests. Each per-pair test asserts `isTransitionAllowed`, and `checkTransition` returns `null` for an allowed pair or a `REALM_INVALID_TRANSITION` `RealmError` for a rejected one.
- `test/core/errors.test.ts`: 24 tests. Four structural tests (exactly 20 codes in `ERROR_CODES`, exactly 20 keys in the frozen `ERROR_CATALOGUE`, true and false lists partition the catalogue, catalogue retryable values equal the D-10 lists) plus 20 per-code tests. Each per-code test asserts `name`, `code`, non-empty `reason` equal to the catalogue entry, `message` equal to `reason`, and `retryable` equal to the D-10 value.

The pinned D-10 and D-11 lists in the tests are literals, not read from the source under test, so a change to either table fails the suite.

## Checks run

- Suppression and skip grep over `src/core/` and `test/core/` (`ts-ignore`, `ts-expect-error`, `eslint-disable`, `skip`, `todo`): no matches.
- Import check: `src/core/states.ts` imports `./errors.js` only; `src/core/errors.ts` imports nothing.
- Scope: only the five files listed in the plan were written. `dist/` was regenerated by `npm run build` and is git-ignored.

## Not done

- No commit, push, or fetch was performed.
- No package was installed.
- No file under `docs/` or the 01-01 to 01-03 artifacts was modified.

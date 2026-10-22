# Plan 01-06 summary: PODMAN_UNSUPPORTED_VERSION code and the Podman integration gate

Status: complete. Built TDD: catalogue and unit tests and the gate file written first, RED recorded, then the code written, GREEN recorded. All five gates exit 0 on this host.

## Overrides and tensions (read first)

1. **Catalogue count override (explicit, from the project Goal).** Plan 01-04 and D-10 fix the catalogue at 20 codes. The Goal adds `PODMAN_UNSUPPORTED_VERSION` as a 21st code, non-retryable, placed next to `PODMAN_MISSING` and `PODMAN_MACHINE_DOWN`. This is an override of the 20-code count. `src/core/errors.ts` header now says 21 and names the amendment. The catalogue test asserts 21, and the non-retryable list is now twelve codes. No other code's retryable value changed.
2. **D-05 tension.** D-05 says Podman-gated integration tests are not written in Phase 1. This lane adds the gate only, per the Goal. `test/integration/podman-gate.test.ts` contains a single test whose body is the probe check; no Phase 3 suite body exists.
3. **D-08 tension.** D-08 bans `skip` on tests. The Goal requires the gate to use node:test's `skip` option with a reason. The only `skip` in the files written by this plan is that single gate option. Its reason string is the gate, not a suppression.

## Files changed

| File | Change |
| --- | --- |
| `src/core/errors.ts` | Adds `PODMAN_UNSUPPORTED_VERSION` to `ERROR_CODES` and to `ERROR_CATALOGUE` (reason "Podman version is below the 5.x that OpenShell requires.", retryable false). Header comment updated to 21 codes. |
| `test/core/errors.test.ts` | Expected codes list gains the new code. Count assertions move from 20 to 21. The retryable-false list gains the new code and its length assertion moves from 11 to 12. Test titles updated. |
| `test/integration/podman-version.ts` | New. Pure helpers: `parsePodmanVersion` (stdout to `{ok, version, major}` or `{ok:false, reason}`), `podmanSkipReason` (probe outcome to a skip reason string or `false`), and the `PodmanProbe` type. Not a test file, so `node --test` does not run it directly. |
| `test/integration/podman-version.test.ts` | New. Unit tests for the parse helper (4.9.3, 5.0.0, 5.x as 5.3.1, empty output, whitespace-only output, malformed output) and for the skip-reason mapping. Run by `npm test` and by `npm run test:integration`. |
| `test/integration/podman-gate.test.ts` | New. Runs `podman --version` through `execFile` with a 5 s timeout. Any failure maps to the probe state "unavailable". Top-level await computes the gate; one test carries `{ skip: gate }`. For 5+ the test asserts only that the probe parsed to major ≥ 5. |
| `package.json` | Adds `"test:integration"`: `tsc -p tsconfig.json && node --test "dist/test/integration/*.test.js"`. No other change. |
| `.planning/phases/01-scaffold-and-frozen-contracts/01-06-SUMMARY.md` | This file. |

No file under `src/contract/`, `docs/`, or `.planning/` other than this summary was touched. No package was installed. Nothing was committed.

## Design decisions

1. **Helper location.** The file list for this plan allowed only `test/` and the catalogue, so the parse helper lives at `test/integration/podman-version.ts`. Phase 3 will need the same probe at runtime; at that point the helper should move to `src/runtime/` and the import path changes. That move is Phase 3 work.
2. **Probe failures map to PODMAN_MISSING.** Per the Goal, ENOENT, non-zero exit, and timeout all become "unavailable", and the skip reason names PODMAN_MISSING.
3. **Unparseable output fails closed.** If `podman --version` runs but its output holds no `major.minor` version, the skip reason names PODMAN_UNSUPPORTED_VERSION. The Goal does not cover this case, so it is a recorded decision. The alternative (run the suite) would let an unknown Podman through the gate.
4. **Skip reason text.** For Podman below 5: `Podman <version> detected; OpenShell requires Podman 5.x; PODMAN_UNSUPPORTED_VERSION`, matching the Goal's example. For missing Podman: `podman binary not found or not runnable; PODMAN_MISSING`.
5. **Executor-form Promise, not `Promise.withResolvers`.** The style guidance prefers `Promise.withResolvers()`. `tsconfig.json` pins `lib` to `ES2023`, where that API is absent, and tsc rejects it (TS2550 in the RED run). The lib pin is outside this plan's file list, so the probe uses the executor form. Changing the lib is a separate decision.
6. **npm test also runs the gate file.** `npm test` globs `dist/test/**/*.test.js`, which includes `dist/test/integration/`. The gate skips there too, with the same reason. The gate is not run twice in any meaningful sense: `npm test` and `npm run test:integration` both show it as skipped.
7. **Phase 3 extension point.** Only the 5+ branch exists as a body. Phase 3 adds Podman-backed suites beside that test in `podman-gate.test.ts`, under the same `skip: gate` option.

## TDD evidence

RED. After the catalogue test, the unit test, and the gate test were written, and before the helper and `errors.ts` change:

```
> tsc -p tsconfig.json && node --test "dist/test/**/*.test.js"

test/core/errors.test.ts(21,3): error TS2322: Type '"PODMAN_UNSUPPORTED_VERSION"' is not assignable to type '"REALM_UNBOUND" | ...'
test/core/errors.test.ts(55,3): error TS2322: Type '"PODMAN_UNSUPPORTED_VERSION"' is not assignable to type '"REALM_UNBOUND" | ...'
test/integration/podman-gate.test.ts(8,8): error TS2307: Cannot find module './podman-version.js' or its corresponding type declarations.
test/integration/podman-gate.test.ts(16,40): error TS2550: Property 'withResolvers' does not exist on type 'PromiseConstructor'. (reverted; see decision 5)
test/integration/podman-version.test.ts(4,54): error TS2307: Cannot find module './podman-version.js' or its corresponding type declarations.
test/integration/podman-version.test.ts(73,34): error TS2345: Argument of type '"PODMAN_UNSUPPORTED_VERSION"' is not assignable to parameter of type '...'
EXIT=2
```

Catalogue-only run after tsc emitted despite the errors (`node --test dist/test/core/errors.test.js`):

```
✖ the catalogue holds exactly the 21 codes: the 20 D-10 codes plus PODMAN_UNSUPPORTED_VERSION
✖ the catalogue record has exactly the 21 codes and no others
✖ the retryable values produced by the catalogue match the D-10 lists exactly
✖ PODMAN_UNSUPPORTED_VERSION builds a RealmError with its code, a non-empty reason, and retryable=false
ℹ tests 25
ℹ pass 21
ℹ fail 4
```

GREEN. After `errors.ts`, the helper, and the package script were written, and the withResolvers form was reverted:

| Script | Command | Exit | Result |
| --- | --- | --- | --- |
| typecheck | `npm run typecheck` | 0 | no diagnostics |
| lint | `npm run lint` | 0 | no diagnostics |
| test | `npm test` | 0 | tests 168, pass 167, fail 0, cancelled 0, skipped 1 (the gate), todo 0 |
| build | `npm run build` | 0 | emits `dist/` |
| test:integration | `npm run test:integration` | 0 | tests 12, pass 11, fail 0, skipped 1 (the gate) |

The integration run prints the gate's skip with the detected version in its reason:

```
﹣ Podman gated integration suite (Phase 1: probe only; bodies arrive in Phase 3) (0.831247ms) # Podman 4.9.3 detected; OpenShell requires Podman 5.x; PODMAN_UNSUPPORTED_VERSION
```

Directive sweep over the files written here (`ts-ignore`, `ts-expect-error`, `eslint-disable`, `todo`, bare `skip`, empty catch, host-local absolute paths): no suppression directive, no `todo`, no empty catch, no host path. The only `skip` option is the gate in `podman-gate.test.ts`; other matches are identifiers such as `podmanSkipReason`.

## Open questions

1. **Helper home.** Phase 3 may need the probe and parse helper in `src/runtime/`. Moving it then is cheap, but it changes an import path, so it should happen in the Phase 3 plan that first needs it.
2. **`tsconfig` lib.** The `ES2023` lib pin blocks `Promise.withResolvers`. If the project later wants that style, the lib needs to move to `ES2024` or later. That is a project-wide change and was not made here.

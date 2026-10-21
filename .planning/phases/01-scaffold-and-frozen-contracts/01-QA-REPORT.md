# Phase 1 QA Report (re-gate after rework): Scaffold and Frozen Contracts

Gate: quality re-gate for Phase 1 (FOUND-01, FOUND-02, FOUND-03, QUAL-01), run after the rework that fixed review finding M-1 (exec argv branch) and the `validate()` DataCloneError (m-2).
Repository: agent-realm (repo root, uncommitted Phase 1 work; all Phase 1 files are untracked).
Environment: Node v24.18.0, npm 11.16.0. `node_modules` was already present; no install, fetch, commit, push, or PR was run.
Side effects: `npm test`, `npm run build`, and `npm run test:integration` regenerated `dist/` (git-ignored). No product code, config, or doc was changed. The only file written is this report.
Signing: no swarm gate task was leased to this run, so `swarm_gate` was not invoked. The verdict below is the QA report verdict only and is unsigned.

## 1. Required checks: exact command results

| Check | Command | Exit | Result |
|---|---|---|---|
| 1 | `npm run typecheck` | 0 | PASS, no diagnostics |
| 2 | `npm run lint` | 0 | PASS, `eslint .` clean |
| 3 | `npm run test` | 0 | PASS: 173 tests, 172 pass, 0 fail, 1 skipped |
| 4 | `npm run build` | 0 | PASS |
| 5 | `npm run test:integration` | 0 | PASS: 12 tests, 11 pass, 0 fail, 1 skipped |

Check 3 summary (from `npm test` output): `tests 173`, `pass 172`, `fail 0`, `skipped 1`. The earlier QA run recorded 168 tests; the increase is the rework's new tests.

Check 5 summary: `tests 12`, `pass 11`, `fail 0`, `skipped 1`.

### Integration skip names the version

The single skip in both check 3 and check 5 is the Podman gate, with this reason:

```
﹣ Podman gated integration suite (Phase 1: probe only; bodies arrive in Phase 3) # Podman 4.9.3 detected; OpenShell requires Podman 5.x; PODMAN_UNSUPPORTED_VERSION
```

The skip names the detected version 4.9.3 and `PODMAN_UNSUPPORTED_VERSION`, as the Goal requires. The gate is `{ skip: gate }` at `test/integration/podman-gate.test.ts:33`. The file's comment says the skip "is the gate, not a suppression."

## 2. Rework fixes verified in source

### M-1: exec argv form rejects `script` and `shell` (VERIFIED)

`src/contract/tools.schema.json`, `$defs/exec`:
- `if: { required: ["shell"] }`, `then`: requires `script` and forbids `argv`.
- `else` (argv form): `required: ["argv"]` and `properties: { "script": false, "shell": false }`.

So `{ argv, script }` and `{ argv, shell: true }` are both rejected, with the key named in the detail. Tests that pass in check 3, `test/contract/tools.schema.test.ts`:
- `exec argv form with a script key is rejected and the key is named` (asserts `SCHEMA_INVALID` and `/exec/script`).
- `exec argv form with shell true and no script is rejected`.
- `exec argv form with shell false is rejected`.
- `exec mixing argv and shell forms is rejected`.
- `exec shell form is accepted (policy gating is Phase 2)`, which confirms the shell form still validates.

### m-2: non-JSON input returns SCHEMA_INVALID (VERIFIED)

`src/contract/validate.ts:243-258`:

```ts
let working: unknown;
try {
  working = structuredClone(input);
} catch {
  return { ok: false, error: new SchemaInvalidError("input holds a value that is not JSON-compatible") };
}
```

The `catch` is not empty: it returns a typed `SCHEMA_INVALID` error and does not echo the thrown message, which could carry a value. The thrown `DataCloneError` never reaches the caller. Tests that pass in check 3, `test/contract/validate.test.ts`:
- `a function input returns SCHEMA_INVALID instead of throwing` (also checks that the secret-shaped value does not leak).
- `a symbol nested in the input returns SCHEMA_INVALID and never echoes its description`.

## 3. Static sweeps

| Pattern | Scope | Hits | Disposition |
|---|---|---|---|
| `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`, `eslint-disable` | `src`, `test`, `eslint.config.js`, `tsconfig.json` | none | PASS |
| `.skip(`, `it.skip`, `describe.skip`, `test.skip`, `todo`, `TODO`, `FIXME` | `src`, `test`, config, `package.json` | none | PASS. The only `skip` option is the designed gate at `podman-gate.test.ts:33` |
| Host-local absolute paths (`/root/`, `/home/`, `/Users/`) | `src`, `test`, `docs`, `package.json`, `tsconfig.json`, `eslint.config.js`, `.gitignore`, `.planning/phases/01-scaffold-and-frozen-contracts/` | none in code or docs. Matches only in `01-01-PLAN.md:78` and `:145`, where the pattern is quoted as a check | PASS |
| Windows-style path literal | `test/contract/tools.schema.test.ts:124` (`"C:\\secret"`) | a path-rejection fixture asserting the schema refuses drive-letter paths | Not a host path. PASS |
| Secret-shaped strings (`password=`, `api_key=`, private-key headers, AKIA, gh/sk/xox token shapes) | `src`, `test`, `docs` | none | PASS. The `sk-live-SECRET-…` fixtures in `validate.test.ts` are deliberate and assert the value never appears in error text |

Result: PASS. No suppression, host path, or secret was introduced by the rework.

## 4. Known deviations (verified as stated)

1. **21 error codes, not 20.** Accepted per the Goal.
2. **Podman gate skips on 4.9.3.** Verified in section 1. Accepted per the Goal.
3. **13 transition edges, 23 rejected.** Accepted per spec n4. Plan 01-04 still says 12/24 (P-1, see section 5).
4. **`ajv` in devDependencies while imported at runtime (M-2).** Still open, unchanged. `package.json` has no `dependencies` key; `ajv` is `"devDependencies": { "ajv": "8.20.0" }`; `src/contract/validate.ts:16` imports `ajv/dist/2020.js` at runtime. Owner-deferred, so it does not block the gate.
5. **eslint `engines` (F-2, low).** Still open, unchanged. `package.json` `engines` is `>=22`; eslint 10.13.0 requires `^20.19.0 || ^22.13.0 || >=24`. Accepted, not blocking.
6. **Deferred minor items.** Owner-deferred, listed for traceability, not failures: m-1 (`containerId` optional), m-3 (`STATES`/`ERROR_CODES` not frozen), m-4 (session-record enum not tied to `STATES`), m-5 (engines vs eslint, same as F-2), m-6 (schemas load from `src/`, `dist/` not self-contained), m-7 (plan 01-06 has no PLAN file), m-8 (integration notes cited an unnamed earlier note; replaced by official URLs or "not documented" in the fix-up pass).

## 5. Findings

| ID | Severity | Kind | Location | Summary | Status | Gate effect |
|---|---|---|---|---|---|---|
| M-1 | major | security/schema | `src/contract/tools.schema.json` exec `else` branch | argv form accepted a `script` key | FIXED, verified in section 2 | none |
| m-2 | minor | contract | `src/contract/validate.ts:249` | `validate()` threw `DataCloneError` for non-JSON input | FIXED, verified in section 2 | none |
| M-2 | major | dependency | `package.json` devDependencies; `src/contract/validate.ts:16` | `ajv` imported at runtime but declared as devDependency | OPEN, owner-deferred | Allowed by gate rule; does not block |
| F-2 | low | dependency | `package.json` `engines` | `>=22` admits Node versions eslint rejects | OPEN, accepted | none |
| m-1, m-3, m-4, m-5, m-6, m-7, m-8 | minor | various | per review | see section 4 item 6 | DEFERRED by owner | none |
| n-1 to n-4 | nit | various | per review | argv length bounds, key-name echo, egress/port additions, plan 01-04 wording | not re-checked, unchanged | none |
| P-1 | info | plan | `01-04-PLAN.md` | plan says 12/24 edges; correct count is 13/23 | OPEN plan text only | none |

No new blocker, critical, or major finding was introduced by the rework. No new suppression, host path, or secret appeared in the changed files.

## 6. Requirement evidence

**FOUND-01 (strict ESM package; typecheck, lint, test, build pass with no suppressions): PASS.** Checks 1-4 exit 0; section 3 shows no suppression directive.

**FOUND-02 (frozen contracts; validate wrapper; tested): PASS.** The M-1 schema hole is closed with negative tests. `validate()` returns `SCHEMA_INVALID` for non-cloneable input instead of throwing. All 173 `npm test` tests pass with 0 failures.

**FOUND-03 (integration note per external dependency with official URL and read date): PASS.** Unchanged from the prior gate; no integration note was modified in this rework.

**QUAL-01 (every async boundary has a timeout; every error typed; no silent catch): PASS.** The Podman probe keeps its 5 s timeout. The new `catch` in `validate()` returns a typed error and is not empty; lint's `no-empty` rule passes.

## 7. Verdict

GATE: PASS

Basis, per the gate rule:
- `typecheck`, `lint`, `test`, `build`, and `test:integration` all exit 0 (section 1).
- The integration skip names 4.9.3 and `PODMAN_UNSUPPORTED_VERSION` (section 1).
- M-1 and the DataCloneError fix are verified in source and covered by passing tests (section 2).
- No blocker or major finding remains other than M-2, which the owner deferred (section 5).

Open items carried forward, none blocking: M-2 (move `ajv` to `dependencies`), F-2 (engines vs eslint), P-1 (plan 01-04 wording), and the owner-deferred minors in section 4 item 6.

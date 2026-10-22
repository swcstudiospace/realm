# Phase 1 Re-review: Scaffold and Frozen Contracts (after Rework 1)

Scope: the reworked files only, as directed: `src/contract/tools.schema.json` (argv branch), `src/contract/validate.ts` (`structuredClone` path), `test/contract/tools.schema.test.ts` and `test/contract/validate.test.ts` (new negative tests), and `01-05-SUMMARY.md` "Rework 1". The prior review (CHANGES_REQUESTED) findings are re-judged below.

Method: read-only. No `npm`, build, test, or integration run was executed in this pass. Gate command results are taken from the GREEN record in `01-05-SUMMARY.md` "Rework 1" and are not independently re-executed. The RED record is checked for consistency with the code, not re-run. The "nothing else changed" claim in Rework 1 was not diffed.

## Status of prior findings

| ID | Prior severity | Status now | Basis |
| --- | --- | --- | --- |
| M-1 exec argv form accepts `script` | major | **Closed** | `tools.schema.json:42-45` (see M-1 below) |
| m-2 `validate()` throws on non-cloneable input | minor | **Closed** | `validate.ts:248-258`, tests at `validate.test.ts:83-101` |
| M-2 `ajv` in devDependencies, imported at runtime | major | **Open, owner-deferred, does not block** | `package.json` unchanged; `validate.ts` imports `ajv/dist/2020.js` |
| m-1 `containerId` optional | minor | Open, owner-deferred | deviation 6 |
| m-3 `STATES` / `ERROR_CODES` not frozen | minor | Open, owner-deferred | deviation 6 |
| m-4 session-record state enum not tied to `STATES` | minor | Open, owner-deferred | deviation 6 |
| m-5 `engines >=22` vs eslint floor (QA F-2) | low | Open, known deviation 5 | `package.json` unchanged |
| m-6 schemas not copied into `dist/` | minor | Open, owner-deferred | deviation 6 |
| m-7 plan 01-06 has no PLAN file | minor | Open, owner-deferred | deviation 6 |
| m-8 citations to an unnamed earlier note | minor | Fixed in fix-up pass (Fix 5), pending QA | deviation 6 |
| n-1 to n-4 nits | nit | Open, not in rework scope | not addressed by Rework 1 |

## M-1: closed

The `else` branch of `$defs/exec` now restricts the argv form:

```json
"else": {
  "required": ["argv"],
  "properties": { "script": false, "shell": false }
}
```

Walk-through of the schema as it now stands (`if` is `required: ["shell"]`, `then` requires `script` and forbids `argv`, top-level `shell` is `const: true`, `script` is non-empty string):

| Input `exec` value | Result | Reason |
| --- | --- | --- |
| `{ argv: ["ls"] }` | accept | else; argv present, no `script`/`shell` |
| `{ argv: ["ls"], script: "x" }` | **reject** | else; `properties.script: false` (the M-1 hole) |
| `{ argv: ["ls"], shell: false }` | reject | if true, then requires `script` |
| `{ argv: ["ls"], shell: true, script: "x" }` | reject | then; `not required argv` |
| `{ shell: true, script: "x" }` | accept | then |
| `{ shell: false, script: "x" }` | reject | top-level `shell: const true` |
| `{ shell: true }` | reject | then requires `script` |
| `{}` | reject | else requires `argv` |
| `{ argv: [] }` | reject | `minItems: 1` |

Test coverage: `test/contract/tools.schema.test.ts:64-70` ("exec argv form with a script key is rejected and the key is named") asserts `SCHEMA_INVALID` and `/\/exec\/script/`. The argv-with-`shell` negatives (`:72-80`) are kept as regression guards. The `{argv, script}` case, which the prior schema accepted, is now a real negative test.

RED record: `01-05-SUMMARY.md` "Rework 1" lists `exec argv form with a script key ...` as failing at RED ("schema accepted it"). That matches the pre-fix schema, which had no restriction on `script` in the `else` branch. The two argv-with-`shell` negatives passed at RED, which the summary states explicitly and which is consistent with the `then` branch rejecting them. Test counts reconcile (RED: 173 total, 169 pass, 3 fail, 1 skip; 169 + 3 + 1 = 173).

Residual, noted as new minor finding N-1 below: the guard keys on property presence with `undefined` values, which JSON cannot carry.

## DataCloneError (prior m-2): closed

`validate.ts:248-258`:

```ts
try {
  working = structuredClone(input);
} catch {
  // structuredClone throws DataCloneError ... The thrown error is not used ...
  return { ok: false, error: new SchemaInvalidError("input holds a value that is not JSON-compatible") };
}
```

- The catch returns a `SCHEMA_INVALID` failure with a fixed message. It does not rethrow, and it does not use the `DataCloneError` message, which V8 builds from the value. That matches the privacy rule in the module header.
- The cloned `working` copy is what gets validated and returned, so the caller's object is still not mutated, and defaults are filled on the copy as before.
- Tests: `validate.test.ts:83-91` (function at root) and `:93-101` (symbol nested in `{ mode }`). Both assert `SCHEMA_INVALID`, the catalogue reason, and that the secret text is absent from `message`, `detail`, `String(error)` and `JSON.stringify(error)`.
- RED record: the summary lists both as failing at RED with `DataCloneError`, which matches the pre-fix code path (raw ajv on a function or symbol throws at clone time). Open Question 3 in the summary is resolved for these inputs.

Scope note (informational): the catch is catch-all. A throwing getter or a revoked Proxy also lands in the same "not JSON-compatible" message. That wording is slightly imprecise for those cases, but it does not leak and it fails closed. No action requested.

## New findings

**N-1. minor: `undefined`-valued keys and non-JSON objects pass the guards that are meant to reject them.**
- Location: `tools.schema.json:42-45` (the `else` guard) and `validate.ts:249` (`structuredClone` admits values that the module comment says are rejected).
- Issue 1 [INFERENCE, not executed]: ajv's `properties` keyword applies a subschema only when the data property is not `undefined`. `structuredClone` keeps `undefined`-valued own keys. So `{ exec: { argv: ["ls"], script: undefined } }` should validate, and the typed result would carry `script: undefined`. A dispatcher that tests `"script" in exec` would still fail closed, but one that tests `exec.script !== undefined` would take the argv path. Only TypeScript callers can produce this, since JSON has no `undefined`.
- Issue 2 [INFERENCE, not executed]: `structuredClone` also clones `Map`, `Set`, and `Date`. ajv's `type: object` check accepts them, so `validate("policy", new Map())` should return `ok: true` with defaults. The `validate.ts` header says "Input that JSON cannot carry ... is a SCHEMA_INVALID failure". Only functions, symbols, and clone failures are rejected, so the header overstates the guarantee. This is pre-existing behaviour (raw ajv also accepted these objects), not a regression from Rework 1.
- Severity: minor. The boundary is JSON from the host (summary Open Question 3), and a `shell` route still fails closed. No blocker.
- Suggested fix (not applied, not tested): add `"propertyNames": { "not": { "enum": ["script", "shell"] } }` to the `else` branch, which sees keys with `undefined` values. For Issue 2, either narrow the header claim to "functions, symbols and non-cloneable values", or reject non-plain objects after cloning.

## Gate checks (recorded, not re-run)

The gate rule needs typecheck, lint, test, build and test:integration to exit 0. `01-05-SUMMARY.md` "Rework 1" records GREEN for all five after both fixes:
- typecheck, lint, build: clean.
- test: 173 total, 172 pass, 0 fail, 1 skipped.
- test:integration: 12 total, 11 pass, 0 fail, 1 skipped.

The one skip in each suite is the Podman gate. The host has Podman 4.9.3, recorded as `PODMAN_UNSUPPORTED_VERSION` (deviation 2). The skip predates this rework.

Known deviations 1-6 are unchanged and were not re-litigated. Deviation 4 (M-2) is still open at its recorded severity, as directed.

## Verdict

- M-1: closed. The schema now rejects `script` and `shell` in the argv form, with a negative test and a recorded RED.
- DataCloneError (prior m-2): closed. Non-cloneable input returns `SCHEMA_INVALID` with no value echoed, with negative tests and a recorded RED.
- Open, not blocking: M-2 (owner-deferred), the owner-deferred minors, m-5 (known deviation 5), and nits n-1 to n-4.
- New, not blocking: N-1 (minor).
- No blocker or major remains other than M-2, which is owner-deferred.

GATE: APPROVE

# Plan 02-02 Summary: Policy, Mode Decision, Exec Gate, Display Mapping, Timeout

Date: 2026-10-21. Requirements: CORE-02, CORE-03, TOOL-02 (QUAL-01 timeout enforcement, per D-28).

Status: all tasks implemented. Compiler, lint, and tests were not run during this lane, per the wave rules. The orchestrator runs the gates after the wave.

## Files

Created or changed (repo-relative):

- `src/core/policy.ts`: `loadPolicyFile`, `decideMutation`, `checkExecPolicy`.
- `src/core/status.ts`: `STATUS_LABELS` (the only definition of the two labels), `displayStatus`.
- `src/core/timeout.ts`: `withTimeout`.
- `test/core/policy.test.ts`: loader cases (CORE-03).
- `test/core/fail-closed.test.ts`: mode decision for all six states under both modes (CORE-03).
- `test/contract/exec-policy.test.ts`: exec gate (TOOL-02).
- `test/core/status.test.ts`: display mapping (CORE-02).
- `test/core/timeout.test.ts`: timeout helper (QUAL-01).
- `.planning/phases/02-policy-state-and-filesystem-lockdown/02-02-SUMMARY.md` (this file).

No frozen file was edited: `src/core/states.ts`, `src/core/errors.ts`, `src/core/policy.schema.json`, `src/contract/*`. No dependency was added.

## Must-haves and evidence

| Must-have | Test names that evidence it |
|---|---|
| Missing file yields the default policy (advisory, no roots, shell disabled) | `CORE-03: a missing policy file yields the default policy (advisory, no roots, shell disabled)`; `CORE-03: keys missing from a policy file take the validated defaults` |
| Invalid file fails SCHEMA_INVALID | `CORE-03: an unknown key in a policy file fails SCHEMA_INVALID and names the key`; `CORE-03: a policy file that is not JSON fails SCHEMA_INVALID without echoing its content` |
| Relative root fails SCHEMA_INVALID | `CORE-03: a relative workspace root fails SCHEMA_INVALID, names the index, and never echoes the value` |
| Policy inside its own roots fails POLICY_DENIED | `CORE-03: a policy file directly inside its own workspace root fails POLICY_DENIED`; `... nested below its own workspace root ...`; `... reaches its own workspace root through a symlink ...` |
| decideMutation: allow in active; allow-with-warning in advisory non-active; deny with exact codes in fail-closed non-active | `CORE-03: active allows a mutation under advisory and under fail-closed`; `CORE-03: advisory allows every non-active state with a warning that names the state`; `CORE-03: fail-closed denies every non-active state with its exact code` |
| checkExecPolicy: argv allowed, shell rejected with SHELL_NOT_ALLOWED unless shellEnabled, never executes | `TOOL-02: the argv form is allowed when shell is disabled`; `TOOL-02: the shell form is rejected with SHELL_NOT_ALLOWED when shellEnabled is false`; `TOOL-02: the shell form is allowed when shellEnabled is true`; `TOOL-02: the exec gate never executes a command, for argv or shell form`; `TOOL-02: no source file under src imports child_process` |
| displayStatus: one of the two frozen labels, degraded flag, reason, last-transition time | `CORE-02: the two frozen label strings are pinned`; `CORE-02: each of the six states maps to exactly one of the two labels ...`; `CORE-02: degraded is the active label with the degraded flag, not a third label`; `CORE-02: a snapshot reason and transition time pass through for active and error` |
| withTimeout: resolve, code-carrying expiry, timer cleared | `QUAL-01: withTimeout resolves with the work's value and clears its timer on settle`; `QUAL-01: withTimeout rejects with a RealmError carrying the given code on expiry`; `QUAL-01: withTimeout passes the work's own rejection through and clears its timer` |

Prohibitions: no new npm dependency (Node built-ins only). `src/core/policy.schema.json` is untouched; the relative-root and inside-roots rules are code checks.

## Decisions applied where the plan was silent

1. **F-1 (layering) resolved.** `src/core/policy.ts` imports `validate`, `SchemaInvalidError`, and the `Policy` and `ExecParams` types from `src/contract/validate.ts`. `contract` never imports `core/policy`, so the edge is one-way and no cycle exists. **D-20 amendment:** `core` may import `contract` for validation-only use (`policy.ts`). The amendment is recorded here; the frozen `.planning` text is not edited. The orchestrator should carry it into the phase decision record.
2. **F-3 resolved.** The absolute-root rule is a loader code check after `validate("policy", …)`. It returns `SchemaInvalidError` with detail `/workspaceRoots/<index> must be an absolute path`, which never echoes the value.
3. **Invalid JSON** is `SCHEMA_INVALID` with a fixed detail. The parser message is discarded because it can quote file content.
4. **Unreadable policy path** (for example a directory, or any read error other than ENOENT) is `POLICY_DENIED`. The plan did not name this case. Fail-closed was chosen, since the policy cannot be verified.
5. **Unresolvable workspace root fails the load, not a later bind.** The plan's test wording said "fails the bind". The loader needs the canonical root to run the inside-roots check, so a policy naming a non-existent root fails `POLICY_DENIED` at load. Callers that want a missing root tolerated must remove it from the file. This is the one behavioral choice a reviewer should look at.
6. **Inside-roots check** uses realpath on both sides and compares path segments (not string prefixes). Equality with a root counts as inside. A policy file reached through a symlink into a root is caught.
7. **Display reasons.** For `unbound`, `connecting`, and `stopping`, the display reason is the D-27 text, regardless of the snapshot reason. For `active`, `degraded`, and `error`, the snapshot reason passes through (for `error`, the caller supplies the catalogue code). Both labels are defined only in `src/core/status.ts`.
8. **`checkExecPolicy`** returns `void` and throws `SHELL_NOT_ALLOWED`. It checks the argv form first; anything that is not argv is treated as shell, so an unvalidated input with no argv fails closed when shell is disabled.
9. **Lint and compiler style.** The repo targets ES2023 (`tsconfig.json`), whose lib does not type `Promise.withResolvers`. `withTimeout` keeps the `new Promise` executor form. The timer type is `NodeJS.Timeout`.
10. **Timeout test** counts live `Timeout` entries from `process.getActiveResourcesInfo()` before and after each call. This proves no timer outlives a settled call.

## Checkpoint (D-15 file format) answered

The orchestrator approved the D-15 format and the explicit-path rule. The loader takes an explicit path with no default location. A missing file means defaults, invalid content means `SCHEMA_INVALID` through `validate("policy", …)`, and the schema stays frozen.

## Deferred and residual items

- **Q-4 (QUAL-02 MCP and ACP contract tests):** deferred to Phase 5. No placeholder MCP or ACP test was added. QUAL-02 is covered in this plan only through the taxonomy and category tests named in D-45.
- **Q-1 (teardown-timeout code):** not touched in this plan. `withTimeout` takes the code as a parameter, so Phase 3 chooses it.
- **Q-2 (rename-window residual risk):** not in this plan's scope (no fs code). Nothing here changes it.
- **Q-3 (orphaned temp files):** not in this plan's scope.
- **Residual risk, policy self-rewrite:** D-22 blocks a policy file inside its own roots at load time. A file moved into a root after load is not re-checked. The next load catches it. Phase 6 should re-run the check when the policy is reloaded.
- **Residual risk, `/proc`:** not in this plan. `checkExecPolicy` and the loader use no `/proc`.

## Not verified in this lane

Per the wave rules, `tsc`, `node --test`, and lint were not run. The orchestrator's gate run is the first verification of these files. The one check most likely to need a fix is the timer-count test in `test/core/timeout.test.ts`, if the runtime reports timers differently.

---
phase: 16
plan: 04
subsystem: omp-plugin
tags: [omp, reattach, daemon, status-item, feature-flag]
requires: ["16-01"]
provides:
  - "src/omp/reattach.ts: pure re-attach rules (caps, equal-jitter delay, LINK_LOST_CODES, RETRYABLE_ATTACH_CODES, six-name sub-state transition table)"
  - "src/omp/plugin.ts: re-attach state machine behind RealmPluginOptions.reattach (off by default)"
  - "src/omp/extension.ts: reattachEnabledOf(REALM_OMP_REATTACH) read only at the edge; invalid value fails load with SCHEMA_INVALID"
affects: [src/omp/plugin.ts, src/omp/extension.ts, src/omp/reattach.ts]
key-files:
  created:
    - src/omp/reattach.ts
  modified:
    - src/omp/plugin.ts
    - src/omp/extension.ts
    - test/omp/plugin.test.ts
    - test/omp/extension.test.ts
decisions:
  - "Re-attach default stays OFF; flipping it waits on the owner's live validation (not run)."
  - "Retry cap 8, equal jitter, base 1 s, delay cap 60 s, attempt budget STARTUP_BUDGET_MS, status read bound GUARD_STATUS_BUDGET_MS."
  - "No new state name is added to the frozen six-name State table; re-attach sub-states are host-side and map onto connecting / active / error."
  - "The pure helpers moved from plugin.ts (plan T1 location) to src/omp/reattach.ts in commit bcfabcb (refactor). plugin.ts imports them from there."
commits:
  - "984d758 feat(omp): re-attach the plugin after a dropped link, behind REALM_OMP_REATTACH (phase 16, O4)"
  - "bcfabcb refactor: split host-binary checks and re-attach policy out of large modules"
status: code-verified; tests not run in this unit; live validation pending
---

# Phase 16 Plan 04 (O4): bounded re-attach behind REALM_OMP_REATTACH Summary

Static verification against `origin/main` at `191293b`, in a detached worktree with no commit. The re-attach code, the flag edge and the O4 test names are present. No test, build or live check was run in this unit, so no requirement is marked passed here. `REQUIREMENTS.md` and `STATE.md` are not edited.

## Tasks

| Task | Name | Evidence on main | Status |
| ---- | ---- | ---------------- | ------ |
| T1 | Pure helpers and constants | `src/omp/reattach.ts:10-21` (caps, `LINK_LOST_CODES`, `RETRYABLE_ATTACH_CODES`); `:25-38` (`ReattachState`, `REATTACH_TRANSITIONS`, `reattachTransitionAllowed`); `:42-58` (`equalJitterDelayMs` with RangeError checks and injected `random`). Tests: `test/omp/plugin.test.ts:2012` (jitter bounds, cap from attempt 7), `:2043` (invalid inputs), `:2056` (transition table), `:2075` (code sets). | Verified in code. Location differs from plan (see Deviations). |
| T2 | Options and per-session fields | `src/omp/plugin.ts:107` (`reattach?` option); `:133-140` (per-session `link`, `reattachCount`, `wait`, `onLinkLost`); `:312-313` (`reattach` is `null` unless `enabled`). | Verified in code. Option-absent regression run not executed. |
| T3 | Loss detection and one wait | `src/omp/plugin.ts:233-240` (`moveLink` refuses illegal moves with a notify); `:264-265` (`reportLinkLoss`); `:541` (poll read); `:625` (`onLinkLost` wiring); `:675` (Realm read/list/exec/write). Test: `O4 R1`, `O4 R6` (`plugin.test.ts:1740`, `:1844`). | Verified in code. |
| T4 | Attempts, FAILED, user retry | `src/omp/plugin.ts:447-466` (`settleAttempt`: reset on attached, retry while below cap, FAILED with `/realm-retry` notify); `:496` (`waitExpired`); `:694` (`REALM_RETRY_COMMAND` cancels wait via `cancelWait`, `:249-254`). Tests: `O4 R3` (`:1790`), `O4 R4` (`:1809`), `O4 R5` (`:1827`). | Verified in code. |
| T5 | In-flight Realm writes after a loss | `src/omp/plugin.ts:666-681`: a write/exec whose request was sent and whose reply was lost throws `AUDIT_OUTCOME_UNKNOWN`; a read keeps its code. Tests: `O4 R8` (`:1889`), `O4 R8b` (`:1940`). | Verified in code. |
| T6 | Deterministic tests | `test/omp/plugin.test.ts:1681-2090`: `seededRandom` (mulberry32), `O4 R1`-`R11`, `O4 R8b`, `O4 T1` (four tests). | Test names present; not executed. |
| T7 | Edge wiring and its test | `src/omp/extension.ts:18-27` (`reattachEnabledOf`: unset and `0` off, `1` on, else `makeRealmError("SCHEMA_INVALID")`); `:33` (only read of `REALM_OMP_REATTACH`); `:80` (`reattach: { enabled, random: Math.random }`). Tests: `test/omp/extension.test.ts:421` (unset/0 off), `:432` (1 on), `:440` (other value throws `SCHEMA_INVALID`), using `withProcessEnv` at `:350`. | Verified in code. Not executed. |

## Verification

- Static, against `origin/main` (`191293b`): `git merge-base --is-ancestor 984d758 HEAD` succeeds, so the O4 commit is on main.
- Flag default: `reattachEnabledOf(undefined)` returns `false` (`src/omp/extension.ts:20`). The default is off.
- Environment reads: `REALM_OMP_REATTACH` is read in `src/omp/extension.ts:33` only. `plugin.ts` receives the option and reads no environment for it.
- Not run (per this unit's contract): `npm run build`, `node --test dist/test/omp/plugin.test.js dist/test/omp/extension.test.js`, and the option-absent regression of existing `plugin.test.ts` tests.

## Deviations from Plan

1. **File ownership.** The plan's `files_modified` lists four files. `src/omp/reattach.ts` is outside that list and holds the T1 helpers. It was split out by `bcfabcb`. Under the plan's stop condition this is a change outside the owned files, so it needs parent acknowledgement.
2. **Tests for `reattach.ts`.** No dedicated `test/omp/reattach.test.ts` exists. The T1 assertions live in `test/omp/plugin.test.ts`, as the plan's T1 "Done when" states.
3. **Plan T1 location.** The plan says the helpers are exported from `plugin.ts`. They are now in `reattach.ts`, and `plugin.ts` imports them.

## Known Stubs

None found in the O4 code paths read.

## Threat Flags

None new. The re-attach path reuses the existing attach path (`ensureDaemon`, `connectDaemon`, `client.up`) and its refusal checks in `src/omp/extension.ts:37-78`.

## NOT VERIFIED

- **Test and build run.** Not executed in this unit. All "Verified" entries above are static, from code reading.
- **Option-absent regression.** The plan requires every existing `plugin.test.ts` test to pass with the option absent. Not run.
- **Live validation (owner).** With `REALM_OMP_REATTACH=1`, stop the daemon while Omp is attached. Expect `realm disconnected · connecting`, then `realm active` within the first wait. Not run. The owner's reply decides whether the default flips.
- **Handshake and credentials.** The spec's protocol-version and credential requirements have no counterpart in `src/daemon/channel.ts`. The plan marks this a BLOCKER for the handshake portion, pending owner decision. Not implemented.
- **In-flight abort on shutdown.** `sendRequest` takes no abort signal, so in-flight control requests are bounded by `CONTROL_TIMEOUT_MS` only. `src/daemon/channel.ts` is not owned by O4.
- **Message-level validation.** Malformed threshold to DEGRADED, flood limits and replay request IDs are not implemented. Out of scope for O4.
- **External gate `phase-15-pr-b`.** Listed in the plan. Not checked in this unit.
- **Exact test-name match.** Test names were matched by their `O4 R<n>` / `O4 T1` prefixes and descriptions, not by full string comparison against each plan entry.

## Self-Check

- Files written: `.planning/phases/16-omp-runs-in-the-sandbox/16-04-SUMMARY.md` only, in worktree `<tmp>` (detached at `origin/main` `191293b`). No commit, no code edit.
- Commit hashes cited: `984d758` and `bcfabcb` confirmed present on main by ancestry and `git log -- src/omp/reattach.ts`.

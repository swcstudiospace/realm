---
phase: 16-omp-runs-in-the-sandbox
plan: 01
unit: O1
subsystem: omp
tags: [omp, host-tools, fail-closed, guard, read-render, lifecycle]
requires: []
provides:
  - "fail-closed keeps host bash active so the tool_call guard refuses it with POLICY_DENIED"
  - "every host tool change runs through a bounded queue; a mode is published only after readback"
  - "a registered read renders decoded text with sha256, byte count and truncation for five wire shapes"
affects: [src/omp/plugin.ts, src/omp/tools.ts, src/omp/host-tools.ts, test/omp/plugin.test.ts, test/omp/tools.test.ts]
key-files:
  modified:
    - src/omp/tools.ts
    - src/omp/plugin.ts
    - src/omp/host-tools.ts
    - test/omp/tools.test.ts
    - test/omp/plugin.test.ts
decisions:
  - "bash stays active in fail-closed and the guard refuses it (P16-D5). Removal would give Omp's native 'Tool bash not found', which is not a catalogue code. Owner confirmation of this trade is open (16-SUMMARY.md, owner question 2)."
  - "The host tool set moved from plugin.ts to src/omp/host-tools.ts in bcfabcb (2026-11-04). The T3 code is read from that file on main."
requirements: [OMPX-02, OMPX-03, OMPX-04]
metrics:
  tasks: 6
  commits: 1
  completed: 2026-11-15
status: committed on the run branch; code for T1 to T6 located on main; tests located, not run by this writer
commits:
  - "2e5e6c5 feat(omp): keep bash for the guard in fail-closed and bound host tool changes (phase 16, OMPX-02/03/04)"
---

# Phase 16 Plan 01 (O1): host-tool policy, lifetime and registered results (OMPX-02, OMPX-03, OMPX-04) Summary

The fail-closed tool set keeps `bash` callable so the `tool_call` guard refuses it with `POLICY_DENIED`. Host tool changes run through a bounded queue, the policy mode is published only after the tool set reads back, restore covers only names the extension owns, and registered reads render decoded text with a digest, byte count and truncation flag. Code for all six plan tasks is located on `origin/main` (191293b). No test, build or lint was run by this writer.

## Tasks

| Task | Name | Code on main | Test on main | Status |
| ---- | ---- | ------------ | ------------ | ------ |
| T1 | keep fail-closed `bash` callable | `src/omp/tools.ts:31-37` (`FAIL_CLOSED_KEEP` includes `"bash"`; JSDoc lines 31-36 state the guard rationale); `src/omp/tools.ts:39-41` (`failClosedToolNames`); `bash` absent from `PASS_THROUGH_HOST_TOOLS` at `src/omp/tools.ts:25-29` | `test/omp/tools.test.ts:143-158`, `:257` | code verified; test not run |
| T2 | guard path for model-issued `bash` carries the catalogue code | `src/omp/plugin.ts:744` (no session: `POLICY_DENIED`), `:746-748` (pass-through), `:785` (status unreadable: `POLICY_DENIED`), `:815` (fail-closed: `POLICY_DENIED`, advisory: `undefined`) | `test/omp/plugin.test.ts:1447` (every state), `:1455` (status unreadable; no mode known), `:1469` (advisory passes; no session refused), `:1673` (advisory with unreadable status) | code verified; test not run |
| T3 | fence every awaited setter; owed bookkeeping truthful | `src/omp/host-tools.ts:58-71` (`setHostMode`, `MAX_HOST_CHANGES = 2` at `:32`, rejects `POLICY_DENIED` when full); `:76-107` (`applyHostMode`): early return when not current `:77-79`, readback of `tools.removed` in `finally` `:84-89` and `:96-103`, late readback on a setter past budget `:99-102`, throw `POLICY_DENIED` on a non-holding set `:104-106`; `HOST_TOOL_SET_BUDGET_MS = 5_000` at `:36`. Mode published after success: `src/omp/plugin.ts:416-421` (attach), `:802-803` (guard), `:580` (poll). Attach setter uses `isCurrent() && !spent` at `:380` | `test/omp/plugin.test.ts:1475` (attach budget expired), `:1498` (after shutdown), `:1522` (after new session start), `:1371` (mode published only after the tool set takes it) | code verified; test not run |
| T4 | restore only what the extension owns | `src/omp/tools.ts:67-82` (`planHostTools`): fail-closed `wanted` filter `:73-76`, owed drop for unregistered names `:77`, advisory restores `owed ∩ registered` `:80-81` | `test/omp/tools.test.ts:230-256` (glob stays off `:230`; Realm write put back `:237`; vanished owed tool dropped `:244`, `:251`) | code verified; test not run |
| T5 | registered `read` result for every wire shape | `src/omp/tools.ts:254-281` (`resultOf`: text from `bytes.toString("utf8")`, note with `truncated` and `sha256`, `details.value.{sha256,truncated,bytes}`); `:283-297` (`bytesOf`: `Uint8Array` or serialized Buffer; a non-byte element returns undefined); `:299-301` (`isByte`); a refusal `SCHEMA_INVALID` at `:258-259`; `ReadDetails` at `:96-100`. Frozen `SPECS` (`:137-208`) has no hunk in the `2e5e6c5` diff, which changes only `failClosedToolNames`, `planHostTools`, the Buffer path of `resultOf`, and `isByte` | `test/omp/tools.test.ts:284` (Uint8Array), `:300` (serialized Buffer), `:316` (empty, both wire forms), `:332` (truncated), `:348` (invalid UTF-8 as U+FFFD), `:363` (non-byte data refused as `SCHEMA_INVALID`) | code verified; test not run |
| T6 | lifecycle matrix tests | No source change (the plan allows only tests here; T2 and T3 supply the source). | `test/omp/plugin.test.ts:1538` (a drift), `:1549` (b fail-closed, advisory, fail-closed), `:1570` (c failed restore then unavailable daemon), `:1601` (d deferred setter, retry, shutdown, new session), `:1628` (e disappeared tool), `:1642` (f user-deactivated stays off), `:1656` (g refused setter never publishes) | code verified (tests present, assert active set, published mode and `tools.removed`); test not run |

## OMPX-04 evidence outside T1 to T6

The requirement row says registered Realm `read` and `write` never fall back to the host. The plan's tasks do not cover this. The evidence located on main is: the guard returns `undefined` for the Realm write when the status is unreadable in fail-closed, so the daemon decides it (`src/omp/plugin.ts:777-779`); the write is passed through after a successful status read (`:805-806`); and the test `test/omp/plugin.test.ts:1331` ("registered ${mode} write refuses an unreachable daemon without host fallback") pins the no-fallback rule. `test/omp/plugin.test.ts:1243` pins the advisory refusal of the Realm write on an unreadable status. The Realm write path comes from the phase 16 commits listed under Commits; this summary did not trace which of them introduced each line.

## Commits

The phase summary (`16-SUMMARY.md`) lists `2e5e6c5` as the only commit for 16-01. Four earlier commits on main changed the same files on the same attach and tool path:

- `4e714b8` register the five Realm tools and enforce the fail-closed allowlist (phase 16, PR #42)
- `b0055ae` hide the same-name Realm write while disconnected in advisory mode, and restore built-ins on drift (phase 16)
- `4cea401` forward the registered write to a reachable daemon while the realm is inactive (phase 16, OMPX-04)
- `dccd974` show the refusal code when up is refused with a live daemon (no phase tag; touches the attach path)

`2e5e6c5` is an ancestor of `origin/main`. Its stat matches the commit: `src/omp/plugin.ts` (68 lines), `src/omp/tools.ts` (42), `test/omp/plugin.test.ts` (301), `test/omp/tools.test.ts` (156).

## Deviations from Plan

**1. [Plan files vs tree] T3 code is not in a plan-owned file on main.** The plan lists `src/omp/plugin.ts` and `src/omp/tools.ts` only. `setHostMode` and `applyHostMode` were in `plugin.ts` at `2e5e6c5` and were moved to `src/omp/host-tools.ts` by `bcfabcb` (2026-11-04, a refactor of host-binary checks and re-attach policy). `host-tools.ts` does not exist at `2e5e6c5`. The behaviour the plan asks for is unchanged in the moved code.

**2. [Plan vs phase summary] Commit attribution.** `16-SUMMARY.md` attributes only `2e5e6c5` to 16-01. The commits in the Commits section above also changed O1 code. This summary does not edit `16-SUMMARY.md`.

**3. [Behaviour pinned by a test, owner-open] Advisory with an unreadable status refuses host `bash`.** `src/omp/plugin.ts:785` refuses any non-Realm-write, non-`edit` tool when the status cannot be read, in every mode. The plan's T2 only asks for fail-closed and advisory-passes cases. `test/omp/plugin.test.ts:1673` pins the advisory refusal. `16-SUMMARY.md` open item 8 records it as an open question.

**4. [Plan wording vs code] "Done when" for T1.** The plan wants the set to exclude `edit` and to include `bash`, `read`, `write`, `grep`. `test/omp/tools.test.ts:143-158` asserts the full kept set (`ask`, `bash`, `exec`, `glob`, `grep`, `list`, `read`, `status`, `todo`, `wait`, `write`), which is a superset of the plan's example.

## Verification

| Scope | Check | Result |
| ----- | ----- | ------ |
| This writer | read-only code and test location on `origin/main` (191293b), `git show --stat` on `2e5e6c5`, ancestry check | code located for T1 to T6; test titles located |
| This writer | build, lint, typecheck, `node --test` on `test/omp/*.test.js` | not run (the writer's contract forbids it) |
| `2e5e6c5` (as reported in `16-SUMMARY.md`) | typecheck, lint, full suite | reported as pass (2483 tests); not rerun here |

## Open items

- Owner confirmation of guard-blocked `bash` in place of removal (P16-D5; `16-SUMMARY.md` owner question 2).
- Advisory refusal of host `bash` on an unreadable status (deviation 3; `16-SUMMARY.md` open item 8).
- No live step was run for this plan. The O1 suite is hermetic.

## Self-Check

Code located for all six tasks on `origin/main`; test titles located for each task. Tests not run by this writer. Requirement status in `REQUIREMENTS.md` is not changed here; the parent owns it.

---
*Phase: 16-omp-runs-in-the-sandbox*
*Completed: 2026-11-15*

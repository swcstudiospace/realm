# Phase 12 Plan 03: HARN-02 registered-write tests and native guard case alignment Summary

**Closes the code and test side of verification gap 2 (WR-01): the four HARN-02 registered-write tests now exist and run over the real dispatcher, pinned filesystem, lock table and audit log. The live guard cases are re-pointed to the owner's 2026-11-12 ruling, and the guard docs describe them. HARN-02's live half, HARN-03, HARN-04 and OMP-05 are NOT closed by this plan.**

## Frontmatter

```yaml
phase: 12-scripted-provider-harness-and-omp-enforcement-spike
plan: 03
status: complete
requirements: [HARN-02]   # code and test side only; the live half is not closed here
commits: 3                # MEASURED: git rev-list --count aae0e96..HEAD
plan_head_before: aae0e9621e665f38564323e30b78631e37b0fb98
plan_head_after: 17a790052cb0c927557e8d97727a9a8abe17bfdd
actuals:
  tasks: 3
  commits: 3
files_modified:
  - test/omp/plugin.test.ts
  - test/integration/omp-guard.test.ts
  - docs/integration/omp.md
  - docs/integration/omp-lifecycle-runbook.md
```

## Commits

| Task | Type | Commit | Subject |
|------|------|--------|---------|
| 1 | test | bff9168 | test(omp): cover registered writes through the real dispatcher (HARN-02) |
| 2 | test | f2e1e9e | test(omp): align the native guard cases with the owner ruling (C4, C4b) |
| 3 | docs | 17a7900 | docs(omp): describe the guard suite cases after the owner ruling |

## What changed

- **Registered-write tests (`test/omp/plugin.test.ts`).** `makeFixture` takes an optional `cwd`. `makeRegisteredWorkspace` builds a real `ToolDispatcher` over `bindRoot`, `LockTable`, `createEventBus`, `gateMutation` and a temp state directory, and routes the fake daemon's dispatch through it. Only the daemon transport is a double. Four tests (five test cases, since the unreachable case runs once per mode):
  - `HARN-02 C1` (advisory, realm degraded, daemon reachable): two writes land the exact bytes, each shows the advisory warning, the read returns the last content, and the audit file has one admission and one result per write.
  - `HARN-02 C2` (fail-closed, realm degraded): refused `REALM_NOT_ACTIVE`, no host file, no notice.
  - `HARN-02: registered {advisory,fail-closed} write refuses an unreachable daemon` (one test per mode): the guard verdict is `{ block: true, reason: "REALM_NOT_ACTIVE" }` under advisory (the owner ruling, plan 12-02) and `undefined` under fail-closed; the direct execute refuses in both modes with no host file and no notice.
  - `HARN-02 C1: registered advisory writes propagate validation, path and conditional-write failures`: four exact codes, existing bytes kept, no invalid file created.
- **Guard file (`test/integration/omp-guard.test.ts`).** C4 is the native positive control with the daemon reachable and the realm inactive (the same helper C1 uses). Its single expected notice is `REALM_ERROR_WARNING`. C4b is new: advisory with the daemon down, asserting `isError: true`, a `REALM_NOT_ACTIVE` text, no file and no notice. C2 asserts no notice with `assert.deepEqual(omp.notices(), [])`. `ADVISORY_NOTICE` is deleted, and the file no longer contains the removed unavailable-status text. The header case list names C1, C1b, C2, C3, C4 and C4b.
- **Docs (`docs/integration/omp.md`, `docs/integration/omp-lifecycle-runbook.md`).** The guard-suite section describes six cases as the file defines them. C1 is the reachable inactive advisory case, C1b the daemon-down refusal, C4 the native positive control, and C4b the native refusal. The evidence paragraph states that C1, C1b, C4 and C4b are not run on the current source, that the 2026-10-30 and 2026-10-31 receipts predate the 2026-11-12 ruling, and that no current pass is recorded. The runbook table has rows for all six cases. The manual advisory step 2 premise is made explicit (see the contradiction check below).

## Test results (real output)

Baseline before any edit, on `aae0e96`: `node --test dist/test/omp/plugin.test.js` 97 pass, 0 fail, 0 skipped.

| Gate | Result |
|------|--------|
| `npm run build` | exit 0 (`tsc -p tsconfig.json`, no output) |
| `npm run typecheck` | exit 0 (`tsc -p tsconfig.json --noEmit`) |
| `npm run lint` | exit 0 (`eslint .`, no output) |
| `node --test dist/test/omp/plugin.test.js` | tests 102, pass 102, fail 0, skipped 0 |
| HARN-02 by name: `node --test --test-name-pattern=HARN-02 dist/test/omp/plugin.test.js` | tests 5, pass 5, fail 0, skipped 0 |
| `npm run check:docs` | exit 0: `host paths: ok`, `agents sync: ok`, `check:default-mode: 28 files scanned, no advisory-default claim` |
| `npm run check:gates` | exit 0: `gate closure: 4 modules, no violations`, `module size: 120 files checked, no violations`, `export-usage gate: 0 failing export(s), 160 allowlisted seam(s), 0 stale allowlist entries` |
| `node --test dist/test/integration/omp-guard.test.js` | tests 8, pass 0, fail 0, skipped 8; `not ok` count 0 |
| `npm test` (plan verification 6) | exit 0: tests 3024, pass 2985, fail 0, cancelled 0, skipped 39 |

Delta from the 12-02 full run (3018 / 2980 / 38): six tests added (five HARN-02 cases and C4b), five more passes and one more skip, consistent with the change set.

HARN-02 by name, per test:

- `HARN-02 C1: registered advisory write warns on every inactive invocation and writes exact host bytes`: ok
- `HARN-02 C2: registered inactive fail-closed write refuses REALM_NOT_ACTIVE without a host file`: ok
- `HARN-02: registered advisory write refuses an unreachable daemon without host fallback`: ok
- `HARN-02: registered fail-closed write refuses an unreachable daemon without host fallback`: ok
- `HARN-02 C1: registered advisory writes propagate validation, path and conditional-write failures`: ok

## Propagation codes (observed, exact)

Each case asserts its exact code. No assertion was loosened, and no case produced a different code, so no stop was needed.

| Case | Observed code (asserted exactly) | Outcome checked |
|------|----------------------------------|-----------------|
| `content: 42` | `SCHEMA_INVALID` | no `invalid.txt` created |
| `path: "../escaped.txt"` | `SCHEMA_INVALID` | no file created outside the workspace |
| `path: "link.txt"` (symlink to a file in the workspace) | `PATH_ESCAPE` | the symlink target is untouched |
| `path: "existing.txt"`, `ifMatchSha256` of 64 zeros | `LOCK_CONFLICT` | the file keeps `original` |

The code for each case is the one the test asserts, and the test passed, so the observed code matches the plan. This SUMMARY does not trace which internal stage produces each code.

## Mutation check (plan task 1, step 8)

Run against the compiled `dist/src/omp/plugin.js` only; `src/` was not edited. The file was restored from a saved copy after each run, and `npm run build` was run again afterwards.

- **(a) Warning notify removed** (the `session.ctx.ui.notify(outcome.value.warning)` statement in `callDaemon`, replaced by a no-op): `HARN-02 C1` fails. The other four pass. Result: 4 pass, 1 fail, the intended test.
- **(b) Advisory Realm write passes an unreadable status** (`if (toolName === REALM_WRITE_NAME && session.mode !== "advisory")` changed to `if (toolName === REALM_WRITE_NAME)`): `HARN-02: registered advisory write refuses an unreachable daemon` fails. The other four pass. Result: 4 pass, 1 fail, the intended test.

After the restore, `HARN-02` by name is 5 pass, 0 fail, and `dist/src/omp/plugin.js` contains no mutant marker.

## Contradiction check: `docs/integration/omp.md` manual advisory step 2 versus advisory-mode text

**Verdict: the code is correct as written in `src/omp/plugin.ts` and `src/core/policy.ts`; `docs/integration/omp.md` (the advisory paragraph) and `docs/policy-reference.md` agree with it. Step 2 was not a contradiction of the code. Its premise was implicit, so it read as if it described the reachable case.**

Evidence:

- `src/core/policy.ts` `decideMutation` (lines 157-161): under advisory, a non-active state is `allow-with-warning`.
- `src/omp/plugin.ts` `guardHostToolCall` (lines 789-790): a readable status with a Realm write returns `undefined`, so the write goes to the daemon. `callDaemon` (lines 667-669) shows the daemon's warning. The daemon's mutation gate allows it with a warning. So a reachable daemon with an inactive realm forwards the write under advisory.
- `src/omp/plugin.ts` `unreadableVerdict` (lines 765-767, 845-848): an unreadable status under advisory refuses the Realm write with the read's code, before any daemon call.
- `docs/integration/omp.md` line 150 (advisory paragraph) and `docs/policy-reference.md` line 74 both state those two rules. They match the code.
- Step 2 expects a Realm write refused with `REALM_NOT_ACTIVE`, the file absent, and no notice. Its premise is `realm down`. In `src/daemon/daemon.ts`, `releaseSession` (lines 441-473) sets `stopAfterReply` when the last session is released; `stopDaemon` (lines 550-555) runs `closeEverything`, which calls `server.close()` (line 535). The listener is gone, so the status read is a refused connection, which is `REALM_NOT_ACTIVE` (`src/daemon/channel.ts`, per the plan). Step 2's expected result is therefore the daemon-unreachable case, and the code refuses it.

Change made: step 2 now says that the last session's `down` stops the daemon, so the step is the daemon-unreachable case. It says the reachable-and-inactive case is forwarded, with the file written and the warning shown, and that C1 sets it up. Its expected outcome is unchanged. The advisory paragraph and `docs/policy-reference.md` are unchanged. `npm run check:docs` passes.

Note on the 12-02 report: it described step 2 as a reachable-daemon refusal. On this reading, that is not what step 2 says. The closest true statement is that step 2 never stated that its daemon was down. This is recorded for the owner. It is not a code defect.

## Skipped tests and why

Without `REALM_LIVE_OMP` or `REALM_LIVE_PRODUCTION`, the live suites skip by design. The 39 skips in `npm test`:

- 21 `REALM_LIVE_OMP=1 is not set; the live Omp suite needs an explicit operator opt-in`. These include all eight cases in `omp-guard.test.ts` (verified by running that file alone: skipped 8). The other 13 are in the other Omp live suites, which this run did not break down by name.
- 14 `REALM_LIVE_PRODUCTION=1 is not set; the production live suite needs an explicit operator opt-in`.
- 3 running as root, where permission bits do not restrict root: an unreadable audit file, a locked directory, and an unwritable directory test.
- 1 `Podman 4.9.3 detected; OpenShell requires Podman 5.x; PODMAN_UNSUPPORTED_VERSION`. This host's Podman is older than the 5.x the OpenShell path requires.

No skip was introduced by this plan's tests. The HARN-02 registered-write tests run offline and do not skip.

## Not run (live and human items, plan `<verification>`)

None of the following was run. No `REALM_LIVE_OMP` or `REALM_LIVE_PRODUCTION` was set, and no live Omp, daemon or Podman run was started.

- **H1, live guard cases C1, C1b, C2, C3, C4 and C4b on the current source.** Not run. The file skips. The C4b expectation (`REALM_NOT_ACTIVE`) comes from the channel analysis, not from a live record. If the first live record shows another code, the assertion must follow it, as the plan states.
- **H2, HARN-03 warm network proof on the current build.** Not run.
- **H3, OMPX-01 re-run on the installed Omp, for the version record.** Not run.
- **H4, closure of HARN-02, HARN-04 and OMP-05.** Not claimed. These need H1 and H2 to pass and the owner to accept the record. `.planning/REQUIREMENTS.md` still marks them complete; reopening them is a GSD command for the owner's reconciler. This plan did not edit `REQUIREMENTS.md`, `ROADMAP.md` or `STATE.md`.
- **H5, open owner rulings, not decided here:**
  - (a) whether C4 re-pointed to a reachable inactive daemon, plus C4b, is the intended reading of the ruling;
  - (b) whether an advisory Realm write is refused on a timed-out status read as well as on a refused connection. The code does refuse both, per the ruling read literally;
  - (c) whether the `LLAMA_CPP_BASE_URL` lever or a port 9931 allowlist change counts for HARN-03.
- **T-12-04, timeout over-refusal, open owner question.** Under advisory, a slow but live daemon whose status read exceeds the 5 s guard budget is refused as `TOOL_TIMEOUT`. This follows the ruling literally and is not changed here. The owner must decide whether a timed-out read should refuse.

## Deviations from Plan

**1. [Precondition, branch base] Fast-forwarded the worktree branch to `aae0e96`.** The plan says 12-02 is merged into the starting branch, merge commit `aae0e96`. This worktree's branch (`worktree-agent-af30f63ac7d779d3b`) was at `9181e80`, five commits behind, and did not contain `aae0e96` or the CR-01 fix (`38d5778`). `aae0e96` is on `gsd/v3-autonomous-run`. I ran `git merge --ff-only aae0e96`, which is a fast-forward with no rewrite and no force. The worktree was clean before it. The fast-forward is the minimum needed to build on 12-02 as the plan requires.

**2. [Precondition, dependencies] Ran `npm ci`.** `node_modules` was absent and `fast-check` was missing. The install exited 0 and `fast-check` is present. No tracked file changed.

**3. [Plan file location] Read the plan from the main checkout.** `12-03-PLAN.md` is untracked and lives only in `/root/src/repos/agent-realm/.planning/phases/12-.../`, not in the worktree or any ref. I read it from there and wrote this SUMMARY into the worktree's phase directory. Only the SUMMARY is committed from `.planning`.

**4. [Test setup, own RED] The unreachable test first failed in my own test code.** I set `callError` on the fake daemon, but the helper had already replaced `call` with the real dispatcher route, so the write landed. The product behaviour was correct: the guard refuses before execute, and a direct `execute` bypasses the hook. I changed the test to make the dispatch itself reject, as the plan specifies. The assertion was not loosened.

**5. [Docs, scope] Edited a paragraph plan 12-02 had touched.** The plan says not to edit the paragraph 12-02 edited. The user's instruction to resolve the step 2 contradiction takes precedence, so I edited step 2 only. Its expected outcome is unchanged. The spike section of `omp.md` was not touched.

**6. [Not run] State and roadmap updates.** The executor's state-update step (`state advance-plan`, `roadmap update-plan-progress`, `requirements mark-complete`) was not run. The plan and the orchestrator forbid `.planning` commits beyond this SUMMARY. Phase 12 plan progress needs an orchestrator-level update.

**7. [Ledger] `plan_head_before` is taken from the fast-forward base, not a ledger file.** `commits: 3` is measured with `git rev-list --count aae0e96..HEAD`.

## Threat flags

None. The new tests write only under `os.tmpdir()` in unique directories removed with `t.after` (T-12-06). The live guard cases still inherit `refuseExternalNetwork` (T-12-05). No dependency was added.

## Known Stubs

None.

## Not closed by this plan

HARN-02's live half, HARN-03, HARN-04 and OMP-05 remain open. The live guard suite and the warm network run have not been executed on the current source.

## Self-Check

- Created file exists: `.planning/phases/12-scripted-provider-harness-and-omp-enforcement-spike/12-03-SUMMARY.md` (this file).
- Commits `bff9168`, `f2e1e9e` and `17a7900` are ancestors of HEAD, measured with `git rev-list --count aae0e96..HEAD` = 3.
- `grep -n "ADVISORY_NOTICE\|status unavailable" test/integration/omp-guard.test.ts` returns no matches.
- No change to `CHANGELOG.md`, the version fields, the adapter manifests, `AGENTS.md` or `CLAUDE.md`. Confirmed with `git diff --name-only aae0e96..HEAD`.

## Self-Check: PASSED

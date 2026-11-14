---
phase: 16-omp-runs-in-the-sandbox
verified: 2026-11-14
verdict: human_needed
status: human_needed
ref: origin/main 06a3e40 (PR 77; includes 4b9cebb, 63f4262, 38d5778, 9cdbe8e)
supersedes: 16-VERIFICATION.md at 4b9cebb (2026-11-08, gaps_found 0/4)
---

# Phase 16: Omp runs in the sandbox: Re-verification at 06a3e40

**Goal:** A model working through Omp does its file mutations and commands through Realm's tools in the sandbox, and in fail-closed mode its built-in host `write`, `edit` and `bash` are gone or refused.

**verdict: human_needed.** Criteria 1 to 3 (OMPX-02, OMPX-03, OMPX-04) have code and test evidence on `origin/main` 06a3e40. Criterion 4 (OMPX-05) needs the owner-authorised production live run, which has not been executed and has no approval recorded. The one gap in the 2026-11-08 report, the missing guard-not-containment disclosure in fail-closed status text, is closed on main (`src/omp/plugin.ts:178`, commit 63f4262).

**Method.** Worktree `<tmp>/wt-p16v` on branch `gsd/phase-16-verify` from `origin/main` 06a3e40. Static reads, greps, and `git diff`/`git log` only. No tests, lint, typecheck, build, formatters, or live operations were run. Read-only evidence: `<home>/realm-evidence/phase12/12-omp-guard.txt`. Nothing was committed. Line numbers are at 06a3e40.

**Old must-have list (2026-11-08 report).** The old report's four roadmap truths are the basis of the table below. Its residual items are checked in "Old report items": the status-disclosure gap is closed, and the behavior-unverified items are now covered by test presence plus the Phase 12 record.

## Goal Achievement: Roadmap Success Criteria

Criteria text: `.planning/ROADMAP.md` Phase 16 block, at 06a3e40.

| # | Criterion | Status | Evidence on origin/main (06a3e40) |
| --- | --- | --- | --- |
| 1 | Extension registers `exec`, `read`, `write`, `list`, `status` as Omp tools, each calling the daemon client with the frozen `ToolCall`; `retry` stays the `realm-retry` command; no `glob` tool; frozen tool schema tests pass unchanged (OMPX-02) | VERIFIED (code and test presence; runtime pass from Phase 12 record, see Residual 1) | Names: `src/omp/tools.ts:16` (`REALM_TOOL_NAMES`). Registration: `src/omp/plugin.ts:688-689` (`realmToolDefinitions`, `tools.ts:211-213`). One-key frozen call: `tools.ts` `callOf`/`definitionOf`. Retry command: `plugin.ts:158`, `:694-697`. No glob: `tools.ts:16`, glob only in the read-only built-in list `tools.ts:20`. Frozen contract: `src/contract/tools.schema.json` has no diff since 4b9cebb; `src/contract/validate.ts` changed since 4b9cebb only in comments. Model-visible read: `tools.ts:255-275` returns decoded text plus a digest/truncation note. Tests: `test/omp/tools.test.ts:60-66` (names, no glob, no retry), `:67` (definitions), `:91` (one frozen call per tool), `:114`, `:126`; `test/omp/plugin.test.ts:1036-1047` (registration, no glob), `:1048` (frozen call), `:1072` (no daemon: `REALM_NOT_ACTIVE`). |
| 2 | Fail-closed: built-in `write`, `edit`, `bash` removed or blocked by the spike-proven mechanism; `tool_call` guard stays as backstop; model `bash` refused with a catalogue code; status text and docs say guard, not containment (OMPX-03) | VERIFIED (code and test presence; see Residual 2 for the `write` reading) | Allowlist: `tools.ts:37` (`FAIL_CLOSED_KEEP`: read-only built-ins, Realm tools, `bash`), `tools.ts:39-41` (`failClosedToolNames`), `tools.ts:67-80` (`planHostTools`, fail-closed branch). Applied and read back before publish: `src/omp/host-tools.ts:58` (`setHostMode`), `plugin.ts:803` (`session.mode` set after readback). Backstop: `plugin.ts:731-815`; bash refused with `POLICY_DENIED`: `plugin.ts:744` (no session), `plugin.ts:815` (fail-closed, not pass-through); `bash` is not in `PASS_THROUGH_HOST_TOOLS` (`tools.ts:25-29`). Not containment: `plugin.ts:147-164` comments; status text `plugin.ts:178` ("(Omp host-tool guard; not host process containment)"); `docs/integration/omp.md:148`. Tests: `test/omp/tools.test.ts:143` (allowlist), `:166`; `test/omp/plugin.test.ts:1080` (removes built-ins outside the allowlist), `:1094` (removal refused, bash denied), `:1109`, `:1128`, `:1447`, `:1455`; `test/integration/omp-guard.test.ts:383` (O2: model `bash` `POLICY_DENIED`). |
| 3 | Advisory: Realm tools registered; built-ins other than same-name `read`/`write` stay available; existing native advisory notice shows; Realm `read`/`write` displace built-ins by the accepted name-shadowing exception (OMPX-04) | VERIFIED (code and test presence) | Advisory plan keeps every active tool and gives back owed tools still registered: `tools.ts:80-81`. Same-name displacement: `tools.ts:6-8` (comment), `tools.ts:52` (`REALM_WRITE_NAME`). Advisory notice: `plugin.ts:874-875` (`realm is <state>; the write proceeds under advisory policy`). Advisory mode published only after readback: `plugin.ts:803`. Tests: `test/omp/tools.test.ts:183` (B1 and B9: advisory plans every tool, owes nothing), `test/omp/plugin.test.ts:1147` (advisory attach with realm not active changes nothing); `test/integration/omp-guard.test.ts:292` (C4: native edit CREATE allowed, notice shown), `:313` (C4b: refused, no notice). |
| 4 | In the Phase 12 harness with the realm active, a model-issued write through the registered tool lands in the sandbox's `/workspace` and appears in the host root; audit log holds an admission line and a result line for it (OMPX-05) | HUMAN_NEEDED | Gated scenario present: `test/integration/omp-ompx05.test.ts:87-88` (skip gate: `REALM_LIVE_OMP=1` and `REALM_LIVE_PRODUCTION=1`, prerequisites named in the skip reason), `:124` (scenario). Assertions: host root bytes (`:226`), sandbox `/workspace` read via `exec` (`:242-252`, container named for the session), paired admission and result audit lines by session id, op id, correlationId and sha256 (`:255` onward; header lines 1-11). Not executed in this verification. No owner approval for a live window is recorded at 06a3e40 (`.planning/phases/16-omp-runs-in-the-sandbox/16-03-PLAN.md` external gate `owner-live-approval: NOT GRANTED`; `16-SUMMARY.md` "not approved as of 2026-11-02"). The earlier 9cdbe8e run (orchestrator-reported 1/1) predates later driver changes and the a8cee97 `OPENSHELL_START_FAILED` observation, and is recorded as historical, not Phase 16 evidence (`.planning/quick/261108-puz-reconcile-the-v3-0-planning-records-with/261108-puz-SUMMARY.md:12`; `16-SUMMARY.md`). |

**Score:** 3/4 roadmap criteria VERIFIED on code and test evidence; criterion 4 HUMAN_NEEDED.

## Requirements coverage

| Requirement | Plan | Status | Basis |
| --- | --- | --- | --- |
| OMPX-02 | 16-01, 16-02 | SATISFIED on code and tests | Criterion 1 |
| OMPX-03 | 16-01, 16-02 | SATISFIED on code and tests | Criterion 2 |
| OMPX-04 | 16-01, 16-02 | SATISFIED on code and tests | Criterion 3 |
| OMPX-05 | 16-03 | NEEDS HUMAN | Criterion 4; live run not executed |

`.planning/REQUIREMENTS.md:201-204` still carries the 2026-11-08 traceability wording ("incomplete"). It is not updated by this report.

## Old report items (2026-11-08, 4b9cebb)

| Old item | Status on 06a3e40 | Evidence |
| --- | --- | --- |
| Gap: fail-closed status lacks guard/containment disclosure (`plugin.ts:187-197` at 4b9cebb) | CLOSED | `src/omp/plugin.ts:178`; commit 63f4262 "fix(omp): disclose host-tool guard limits"; asserted by `test/omp/plugin.test.ts:66-67`, `:685`, `:771`, `:1519`. |
| Behavior-unverified: five tools use frozen ToolCall shapes; registered read/write reach model | Presence and wiring verified; runtime pass recorded in Phase 12 file | Tests in criterion 1 rows; `<home>/realm-evidence/phase12/12-omp-guard.txt` (Residual 1). |
| Behavior-unverified: advisory keeps native tools and restores active set across mode changes; native notice | Tests present; runtime pass recorded in Phase 12 file | `test/omp/plugin.test.ts` P16 (b)-(e) at `:1371-1410`; `omp-guard.test.ts` C4/C4b/O2; Phase 12 file `ok 5`, `ok 6`, `ok 7`. |
| OMPX-05 "1/1 historical live" | Still not Phase 16 evidence | See criterion 4. |
| O4 re-attach default off (`src/omp/extension.ts:33`) | Unchanged; not a criterion | `16-SUMMARY.md` open items (Residual 4). |

## Phase 12 record (read-only)

`<home>/realm-evidence/phase12/12-omp-guard.txt`: TAP, `omp/18.20.0`, `fake-backed daemon and scripted provider, not production containment`. Pass 7, fail 0, skipped 1 (HARN-03, `REALM_OMP_NET_TRACE` not set). Relevant passes: C1 (ok 1), C1b (ok 2), C2 (ok 3), C3 with offered tool list `ask, bash, exec, glob, grep, list, read, status, todo, wait, write` (ok 4), C4 (ok 5), C4b (ok 6), O2 advisory to fail-closed with registered write and read reaching the provider and model `bash` `POLICY_DENIED` (ok 7). The offered tool list matches the fail-closed allowlist in `test/omp/plugin.test.ts:1021`. The file has no commit header, so the tree it ran on is not identified (Residual 1).

## Anti-patterns and checks

- Scan of `src/omp`, `test/omp`, and `test/integration/omp-*.ts` for `TODO`, `FIXME`, `XXX`, `HACK`, `PLACEHOLDER`: none found in the code paths cited above. Not re-run as a formal scan; stated from reads.
- No test, probe, or live command was executed in this verification.

## Open items

1. **OMPX-05 production acceptance (criterion 4). Needs owner approval and this run:**
   - Precondition: the owner approves a live window for the production daemon, driver, OpenShell and rootless Podman stack. Shared-stack runs are serialized (ROADMAP Phase 16 Notes).
   - Build: `npm run build` in a checkout of the tree to be accepted (main at 06a3e40 or later).
   - Run: `REALM_LIVE_OMP=1 REALM_LIVE_PRODUCTION=1 node --test dist/test/integration/omp-ompx05.test.js`, with the matching production config and the selected workspace. The file never sets either variable. Any skipped prerequisite is reported as skipped, not passed.
   - Pass needs all of: host workspace root holds the written bytes; sandbox `/workspace` `cat` and `sha256sum` return the same bytes, run in the session's container; audit `<stateDir>/audit/<session id>.jsonl` holds one paired admission and result line (same path, correlationId, sha256; result carries bytes); `realm down` leaves no sandbox container.
   - Evidence to return: Omp version, provider, RPC log, container identity, audit excerpt, TAP output.
   - Owner reply form: approved with the window, or declined. Record it in `16-CONTEXT.md` before any run.
2. **Plan-file drift.** `16-03-PLAN.md` names `test/integration/production-driver.test.ts` for the OMPX-05 scenario. On 06a3e40 the scenario is in `test/integration/omp-ompx05.test.ts`, and `production-driver.test.ts` has no OMPX-05 case. Traceability should cite the actual file. Not blocking.
3. **Test re-run not performed here.** Criteria 1 to 3 rely on test presence plus the Phase 12 record. The recorded run is fake-backed, on Omp 18.20.0, and its tree is unidentified. Whether to re-run the named suites (`test/omp/tools.test.ts`, `test/omp/plugin.test.ts`, `test/integration/omp-guard.test.ts`) on 06a3e40 is for the main agent to decide.

## Residuals (not verdict-blocking)

1. **Phase 12 record provenance.** `12-omp-guard.txt` has no commit or date header. Its test names match the cases in `test/integration/omp-guard.test.ts` on 06a3e40, so it is consistent with this tree, but this verification did not confirm the tree it ran on. Omp 18.20.0 differs from the 18.12.6 spike (`docs/integration/omp.md:76`) and the 18.18.1 record for 9cdbe8e.
2. **Criterion 2 wording on `write`.** The roadmap says built-in `write` is "removed or blocked". On 06a3e40 the built-in `write` is displaced by the same-named Realm `write` in both modes (`tools.ts:6-8`, `FAIL_CLOSED_KEEP` includes `REALM_TOOL_NAMES`), which is the accepted name-shadowing exception (spike S1, `docs/integration/omp.md`). This report reads criterion 2 as satisfied by that displacement plus removal of `edit` and the other built-ins.
3. **Enforcement limits.** Fail-closed is an allowlist and a `tool_call` backstop, not process containment. Host paths that bypass the extension pipeline are not covered (`docs/integration/omp.md:148`). The status text and docs say so.
4. **O4 re-attach.** Default off (`src/omp/extension.ts:33`). Owner live stop and re-attach validation is outstanding (`16-SUMMARY.md` open items). Not a Phase 16 success criterion.
5. **Spec read was not executed.** Criteria 1 to 3 are judged on code and test presence. A passing run on this tree is not established by this report.

## Verdict

verdict: human_needed

Criteria 1 to 3 have code and test evidence on `origin/main` 06a3e40, and the 2026-11-08 gap is closed. Criterion 4 (OMPX-05) is the only open item. It needs the owner-authorised production live run described in Open item 1. It is not marked passed.

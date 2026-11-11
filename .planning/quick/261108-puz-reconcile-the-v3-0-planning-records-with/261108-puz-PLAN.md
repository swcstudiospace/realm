---
quick: 261108-puz
type: execute
wave: 1
depends_on: []
autonomous: true
files_modified:
  - .planning/REQUIREMENTS.md
  - .planning/STATE.md
  - .planning/phases/18-per-project-sandboxes/18-HELD-OWNER.md
  - .planning/phases/19-resume-and-checkpoint/19-HELD-OWNER.md
  - .planning/phases/13-quality-ratchet/13-VERIFICATION.md
  - .planning/phases/14-crash-safety-pack/14-VERIFICATION.md
  - .planning/phases/17-observability-and-tamper-evident-audit/17-VERIFICATION.md
  - docs/integration/runtime-decision.md
  - AGENTS.md
  - docs/integration/openshell.md
  - .planning/config.json
---

# Quick 261108-puz: reconcile the v3.0 planning records with the integration line

<objective>
Make the v3.0 planning records say what the integration line tree shows (lane HEAD c39abe6, re-verified in this planning pass), add dated reconciliation text rather than deleting history, and leave every live-gated or owner-gated item open.

Purpose: several rows still say "missing" for code that exists with authored offline tests, several held-owner notes predate owner decisions of 2026-11-08, and scenario counts lag the twelve-scenario live suite.
Output: edited records only. No code, test, workflow, release, CHANGELOG, package or ROADMAP change.
</objective>

<scope_note>
Source of truth: `.planning/quick/261108-puz-reconcile-the-v3-0-planning-records-with/261108-puz-CONTEXT.md` (locked). The planning context named `.planning/quick/261108-puz-CONTEXT.md`; that path does not exist, and the file is under the directory above.

Conflict, flagged for the orchestrator: the spawn constraints forbid planning edits under `.planning/phases/`, `.planning/REQUIREMENTS.md` and `.planning/ROADMAP.md`, but the locked CONTEXT names `REQUIREMENTS.md` and the phase 13, 14, 17, 18 and 19 records as in scope. This plan follows the locked list. It edits no ROADMAP.md at all (progress rows are not touched). If the orchestrator wants the constraint to win, drop tasks 1 and 2 and report the rest as blocked.

Re-verification done in this planning pass (lane c39abe6). Line numbers drifted from the CONTEXT; the executor MUST re-locate each target by the quoted text before editing:
- AGENTS.md stale routing sentence is line 74 (the `observe/` bullet), not 73. AGENTS.md:37 says "ten scenarios"; :23 is dated 2026-10-30 evidence and stays.
- runtime-decision.md "The daemon log records" paragraph starts at line 222; the `audit.head` bullet is line 225. The stopped-project open item is closed at line 523 (decision 7), not the open-items list near 529.
- REQUIREMENTS.md: QR-06 wording is already present at line 33 and ROADMAP.md at line 390, so 13-VERIFICATION.md line 48 is stale. CRASH-04 sentence at line 43. Checkboxes ONB-01/02/03 at lines 50, 52, 54. Phase 18 traceability rows MULTI-02..06 at lines 209-213; RES-02..05 at 215-218; REL-03/REL-04 at 221-222; QR-04/05/08 rows at 179, 180, 183; CRASH-04 row at 187; ONB rows at 191-193.
- 14-VERIFICATION.md open-gap text: lines 5, 28, 46 and 62. The helper asserts recordsDeleted at test/support/production-live.ts:299-316.
- 17-VERIFICATION.md stale text: line 9 ("daemon.log does not rotate") and line 100 (O-f, rotation missing). Closure already recorded at line 124.
- README.md has no live-suite count statement (its lines 137-139 name scenarios 5 and 6 only). Change nothing there unless a count is found on re-check.
- openshell.md:433 is a present-tense "ten scenarios" line; openshell.md:579 is dated 2026-10-30 and stays unchanged.
- Re-read the CONTEXT file for every fact below before writing it. A fact that does not match the tree is not written; report it.

Citation rule: every changed sentence cites the file and line range that makes it true. Never write "verified", "passed" or "complete" for live-gated or CI-gated acceptance. Never tick a checkbox. Unticking the three ONB boxes is the one status change (see task 1).

Verified lane facts (all commits exist on the lane): a7b765c, 91d4afe, 835fb9c, 455671a, f1e3cac, e46b4b1, 98a20e7, 26e9470, 6784dbb, eb056f1, 097256f, 94590fd, 52388dd, 5c79211, 74ce823, 6735d4b, 9ee3d81, 27c9782, 520eba7, b9cd28c, c05cc22, 9e2142f, b16a828, a833ece, 21693b1, 9cdbe8e, c39abe6, 4bfca1a, e2baed6, 33dd980. The `.planning/config.json` diff is exactly one added line, `"use_worktrees": false` under `workflow`.
</scope_note>

<tasks>

<task type="auto">
  <name>Task 1: REQUIREMENTS.md rows, STATE frontmatter, and the Phase 18 and 19 held-owner notes</name>
  <files>.planning/REQUIREMENTS.md, .planning/STATE.md, .planning/phases/18-per-project-sandboxes/18-HELD-OWNER.md, .planning/phases/19-resume-and-checkpoint/19-HELD-OWNER.md</files>
  <action>
REQUIREMENTS.md (traceability and text only; no ticks):
- MULTI-02, MULTI-03, MULTI-06 rows (about lines 209-213): replace "Missing ..." with "Implemented offline, tests authored; live acceptance not claimed" and cite: session identity `src/session/paths.ts:57-74` and `test/session/paths.test.ts:35-89`; pin registry `src/session/workspace-registry.ts` and `test/session/workspace-registry.test.ts`; per-session registry, admission and locking `src/daemon/sessions.ts`, `src/daemon/daemon.ts:432-539`, `test/daemon/daemon.test.ts:1905-2495`; aggregate ledger and derived bound `src/daemon/admission.ts`, `src/runtime/hardening.ts:53-131`, `test/daemon/admission.test.ts`, `test/runtime/hardening.test.ts:881-913`; per-sandbox mount `src/runtime/driver/compute-driver.ts:852-956`. Keep the existing phase and P18 tail.
- MULTI-04 row: offline selected-project transport and per-sandbox mount implemented (`src/daemon/channel.ts:114-158`, `src/daemon/client.ts:138-196`, `compute-driver.ts:852-956`); live acceptance open. The deployed driver predates these modules and was not live-verified in the window (CONTEXT, "Driver closure NOT live-verified").
- MULTI-05 row: two-project scenario authored and gated in `test/integration/production-driver.test.ts` ("two projects"); live acceptance open in the approved batched window.
- RES-02 row: implemented offline (`src/runtime/driver/lifecycle.ts:217-264`, `src/runtime/driver/registry-rebuild.ts:43-59`, `src/daemon/daemon.ts:922-926,988-991,1079-1082,1193-1200`); live acceptance open.
- RES-03 row: scratch volume create, attach and ordered deletion implemented offline (`src/runtime/hardening.ts:161-176`, `src/runtime/libpod-client.ts:608-615`, `test/runtime/driver/scratch-volume.test.ts`, `test/runtime/driver/restart-adoption.test.ts`); attachment and inspect live acceptance open (OQ-P19-01, OQ-P19-02).
- RES-04 row: filesystem spike recorded (`docs/integration/workspace-snapshot-spike.md`); D19-6 full copy (`docs/integration/runtime-decision.md:467`); `realm checkpoint create|restore` implemented offline (`src/session/checkpoint.ts`, `src/cli/checkpoint.ts`, `test/session/checkpoint.test.ts`, `test/session/checkpoint-quiescence.test.ts`, `docs/checkpoint.md`). Stopped-project pin closed by owner decision 2026-11-08 (decision 7, `docs/integration/runtime-decision.md:523`; QUICK-CP commits 835fb9c and 455671a).
- RES-05 row: live acceptance open (OQ-P19-03 same-container survival across a daemon kill). Do not describe the 2026-11-08 SIGKILL adoption observation as acceptance.
- REL-03 row (about line 221): the rollback workflow takes `docs_tag`, validates ancestry and published non-prerelease state before mutation, and forwards `source_ref` (`.github/workflows/rollback.yml:6-120`); Pages validates it (`.github/workflows/pages.yml:5-100`). GitHub-side acceptance and PR #40 human review stay open.
- REL-04 row (about line 222): explicit `Removes:` relationships, multiple targets, earlier-release notes and canonical-revert-first composition implemented (`scripts/release/changelog.mjs:28-29,143-178`; `scripts/release/changelog.test.mjs:424-508`).
- QR-04 row (about line 179): add the 2026-11-08 raised-floor run: `src/fs` branches raised from 87 to 95 against a measured 88.89 exited 1; committed floors exited 0 (all nine metrics on Node 24.18). Host-only evidence; CI provenance on Node 22.x and 24.x (D-1304) still open (cite CONTEXT).
- QR-05 row (about line 180): add the 2026-11-08 one-CPU rootless container run of `npm test`: 2799 passed, 0 failed, 34 skipped, 169.7 s, image `localhost/realm-qr05-runner:0626abe261` (cite CONTEXT). Status stays implemented-unverified; CI provenance still open.
- QR-08 row (about line 183): owner decision D-1308 on 2026-11-08; `actions: write` dropped by cherry-pick 9e2142f of 33dd980 (`.github/workflows/mutation.yml`, executor greps that no `actions: write` remains). Human review of the workflow change still required.
- CRASH-04 sentence at line 43 and row at line 187: the helper now asserts `recordsDeleted` (`test/support/production-live.ts:299-316`), so the "does not assert" sentence is stale. The 2026-11-02 live pass belongs to pre-adoption behaviour; current-behaviour live proof is pending the approved window. Checkbox stays unticked.
- ONB-01, ONB-02, ONB-03 checkboxes at lines 50, 52, 54: change `[x]` to `[ ]` (the one permitted status change; the 2026-10-31 evidence was not re-observed on c39abe6, per CONTEXT). Append to rows at lines 191-193 a dated note: "2026-11-08: checkbox cleared; the 2026-10-31 evidence is retained as history and is not re-observed on lane c39abe6." Do not delete the 2026-10-31 text. Flag this in the SUMMARY as an owner-reversible decision.

STATE.md (frontmatter only, line 13 area):
- Edit `completed_phases: 18` to `completed_phases: 0` (no v3.0 phase is complete; Phase 12 is verification_deferred_gaps). Introduced by commit b2803b8; the milestone start commit 6fe70ee had 0. Use Edit, not a bare gsd-tools state command (the STATE incident note forbids that).
- Do NOT change `total_plans` or `completed_plans`. Check the plan-level SUMMARY files on disk under `.planning/phases/` for v3.0 phases; if their count differs from `completed_plans: 9`, report it in the SUMMARY and do not edit. Keep `percent` unless `completed_plans`/`total_plans` change.

18-HELD-OWNER.md (dated reconciliation paragraph under the top status and "What is not done"; keep the original text):
- Lines 1 and 5: note that MULTI-02/03/06 and the offline parts of MULTI-04/05 are implemented with authored offline tests (cite the REQUIREMENTS rows), while live items stay HELD. Replace "the runtime is not implemented" in the dated record with the offline-implemented scope.
- Lines 22-23: plans 06 and 08 to 14 status is only what the lane records show; cite `.planning/phases/18-per-project-sandboxes/18-SUMMARY.md` if it names them, otherwise leave them as "not executed by this record". Gate status: the offline gate set on the lane at 9cdbe8e and c39abe6 (typecheck 0, lint 0, npm test 2936 pass / 0 fail / 37 skipped, test:scripts 0, check:docs 0, check:gates 0, check:pack 0, check:mcp 0), cite CONTEXT "Verified facts at lane HEAD c39abe6".
- Owner items (locate the "Owner items (not decided here)" paragraph): record the 2026-11-08 owner decisions:
  (a) TOOL_TIMEOUT reason text KEPT; no code change.
  (b) startupBudgetMs: schema maximum 200000 implemented by QUICK-SB (commits a7b765c, records 91d4afe). Before citing, grep `policy.schema.json` for the maximum; mark item (b) resolved by decision only with that citation.
  (c) seven commits 4bfca1a through e2baed6 STAND; none merged to trunk; human review before any merge still applies.

19-HELD-OWNER.md (dated reconciliation; keep original text):
- Line 11 (D19-1 "exact decision needed"): the ownership label contract is decided at `docs/integration/runtime-decision.md:459` (D19-1, 2026-11-03).
- Line 17 (RES-04 spike not run): superseded: spike recorded at `docs/integration/workspace-snapshot-spike.md`; D19-6 full copy at `docs/integration/runtime-decision.md:467` (the held document's allocation request is not the decision).
- Line 29 ("RES-02 to RES-05 are not implemented, verified or started"): superseded for implementation: offline implemented per the REQUIREMENTS rows; live acceptance open.
- Open item "stopped projects" (D19-9 closure): closed by owner decision 2026-11-08, "Checkpoint pins the workspace itself"; decision 7 at `docs/integration/runtime-decision.md:523`; behaviour at `docs/checkpoint.md:81-85`; implemented by QUICK-CP (835fb9c, 455671a; records f1e3cac). Note the runtime-decision D19-9 heading (line 515) is a different, library-level decision; cite both rather than conflating them.
- Live observation 2026-11-08: after a daemon SIGKILL the next daemon adopted the session, status reached active with one sandbox and one container. This is scenario 5 observed while it failed on its superseded assertion; it is not RES-05 acceptance. Cite the quick summary that records it (grep `adopted and kept` under `.planning/quick/`).
  </action>
  <verify>
    <automated>npm run check:docs</automated>
  </verify>
  <done>Rows and notes cite file:line for each sentence; no checkbox ticked; ONB-01..03 unticked with dated note; completed_phases reads 0; ROADMAP.md untouched; RES-05, MULTI-04/05, REL-01..03, CRASH-04 live acceptance still open.</done>
</task>

<task type="auto">
  <name>Task 2: Phase 13, 14 and 17 verification text, and the live window record</name>
  <files>.planning/phases/13-quality-ratchet/13-VERIFICATION.md, .planning/phases/14-crash-safety-pack/14-VERIFICATION.md, .planning/phases/17-observability-and-tamper-evident-audit/17-VERIFICATION.md</files>
  <action>
13-VERIFICATION.md:
- Line 48 (QR-06 wording): replace the claim that REQUIREMENTS and ROADMAP still need the D-1306 amendment. Record: the amendment is present at `.planning/REQUIREMENTS.md:33` and `.planning/ROADMAP.md:390` (grep to confirm the exact text "found by reference analysis" in both). Keep the original sentence and add the dated correction.
- Add a dated 2026-11-08 paragraph with the QR-04 raised-floor run, the QR-05 one-CPU container run and the QR-08 permission drop, each with the commands and numbers recorded in CONTEXT. State that these are host measurements, not CI provenance (D-1304 still open), and that QR-07 PR-body attachment and Node 22.x/24.x CI provenance remain open.

14-VERIFICATION.md:
- Lines 5, 28, 46 and 62 (open gap about `startupReapLineFor` not asserting `recordsDeleted`): add dated text that the helper now asserts `recordsDeleted` (`test/support/production-live.ts:299-316`, `counted(parsed.value, "recordsDeleted", ...)`), so the gap is closed in the helper. Do not claim a live pass for it.
- Record that the 2026-11-02 live pass (item 6, PASS) belongs to the pre-adoption behaviour; scenario 5 was rewritten to re-adoption (quick task L1, commit a833ece; records 21693b1). Current-behaviour live proof is pending the owner's batched window.
- Keep "Status: gaps_found" unless the grep shows it is now false; if you change it, say why in the dated paragraph.

17-VERIFICATION.md:
- Line 9 ("`daemon.log` does not rotate (O-f below)"): dated correction. The rotating sink exists for `<stateDir>/daemon.log` (`src/daemon/main.ts:174-199`, `test/daemon/main.test.ts:702-718`); the startup reader's rotation handling is fixed by 5c79211.
- Line 100 (O-f, rotation missing): dated closure. Cite 5c79211 (reader), and the closure already at line 124 (a044d12).
- Add dated closures for the Phase 17 gaps listed in CONTEXT, each with commit: merkleRootOfLeaves exported and tested (74ce823); unreadable audit exit and head look-back boundaries tested (6735d4b); invalid log level warning tested (94590fd, `test/daemon/main.test.ts`); in-place truncation branch tested (b9cd28c). Grep each test name before citing it.
- Live scenarios 6 and 10 and spike S17-b stay human-needed. Scenario 6 is in the batched window; 10 and S17-b are NOT approved.

Live window record (in BOTH 14-VERIFICATION.md and 17-VERIFICATION.md, one dated paragraph each):
- Window status at the time of this task: no live window result is recorded on disk for 2026-11-08 (grep `.planning/` for a window result file before writing). Write: "Batched window approved for non-gateway scenarios (production live 1-9 with rewritten 5 and new 5b/5c, the two-project scenario, OMPX-05 on Omp 18.18.1). Results: pending; to be recorded with exact pass and fail counts per scenario when the owner's window finishes." If a result file does exist, record its exact per-scenario counts instead and cite it.
- Record as NOT RUN with the owner's reason: scenario 10 (stops the gateway), spike S17-b (stops the driver), plan 15-10 L-B (driver unit edit). Reason: not approved for the batched window (CONTEXT, "The live window").
- Record the driver caveat: the deployed driver build predates the 15-04, CP and gateway-status modules, so the window does not validate the new driver closure (CONTEXT, "Driver closure NOT live-verified").

Do not edit CHANGELOG.md, package.json, `.github/**` or `release/**`. Do not stage `.planning/config.json`.
  </action>
  <verify>
    <automated>npm run check:docs</automated>
  </verify>
  <done>Each changed sentence in 13/14/17 cites file:line or a commit; the live window is recorded as pending or with the exact counts from an existing result file; scenarios 10, S17-b and 15-10 L-B are recorded as not run with the reason; no PASS claimed for live or CI-gated acceptance.</done>
</task>

<task type="auto">
  <name>Task 3: present-tense routing sentences, scenario counts, and the lane config restore</name>
  <files>docs/integration/runtime-decision.md, AGENTS.md, docs/integration/openshell.md, .planning/config.json</files>
  <action>
docs/integration/runtime-decision.md (lines 222-228 only; re-locate by text, "The daemon log records" paragraph and the `audit.head` bullet):
- The paragraph says the entry writes through its logger "to its standard error", and that a detached daemon's standard error is `<stateDir>/daemon.log`. Replace the present-tense routing with: the entry writes these records through its logger to the rotating file sink for `<stateDir>/daemon.log` (`src/daemon/main.ts:174-199`; stderr only as the fallback for a line the sink refuses, per `.planning/phases/17-observability-and-tamper-evident-audit/17-VERIFICATION.md:124`). Keep the detached/foreground distinction only if the code confirms it; grep `src/cli/main.ts` for `startDetachedDaemon` before keeping it.
- The `audit.head` bullet says it "covers only the file of session id `daemon`". Replace with per-session heads: the head is written for each session's audit file (`src/daemon/daemon.ts:499-533`; owner answer "Per-session heads (the plan as written)" recorded in `.planning/STATE.md`). Re-read `daemon.ts:499-533` for the exact file name before writing it; do not keep `<stateDir>/audit/daemon.jsonl` unless the code shows it.
- Leave the decision text D19-x, C6 (`runtime-decision.md:437`) and the owner decisions unchanged.

AGENTS.md:
- Line 74 (`observe/` bullet; the CONTEXT's "line 73" is stale): replace "the entry writes its records to stderr, which is `daemon.log`, through the logger; the daemon writes its lifecycle, control and tool records to `requests.log` through the logger and the file sink" with: the entry writes its start, failure and audit-head records to `daemon.log` through the logger and its rotating file sink, and the daemon writes lifecycle, control and tool records to `requests.log` through the same sink (`src/daemon/main.ts:174-199`; `src/daemon/daemon.ts:271-273`). Keep the rest of the bullet.
- Line 37 (`ten scenarios`): change to twelve scenarios. Cite `test/integration/production-driver.test.ts` after grepping the scenario count (the executor counts the scenario blocks; the CONTEXT says ten plus 5b and 5c). Note in the text that 5b and 5c were added on 2026-11-08 and are not yet run in the live window.
- Line 23: keep unchanged (dated 2026-10-30).
- Keep all ten `##` headings and the `@AGENTS.md` import in CLAUDE.md untouched.

docs/integration/openshell.md:
- Line 433 ("The gated production live suite passes in full: ten scenarios, 33 of 33 assertions ... (2026-10-30 ...)"): keep the dated result, and add that the suite now has twelve scenarios (5b and 5c added 2026-11-08, not yet run in the live window). Do not edit the present tense "passes in full" into a claim: say "passed in full on 2026-10-30".
- Line 579 (dated 2026-10-30 result): unchanged.
- The "Scenarios" list (around line 565-575) lists scenarios 1-9 and does not show 5b and 5c. Only count statements are in scope; do not add list entries.

README.md:
- Grep for scenario-count statements. The earlier check found none; lines 137-139 name scenarios 5 and 6 only. If none is found, change nothing and say so in the SUMMARY.

.planning/config.json (final step, locked by CONTEXT; the one destructive git action permitted here):
- Run `git diff -- .planning/config.json`. If the only change is the added `"use_worktrees": false` line under `workflow`, restore the file with `git checkout -- .planning/config.json` and record in the SUMMARY that this was done (the CONTEXT's second option). If any other line differs, stop: do not restore; report the diff instead.
- Never stage `.planning/config.json`.
  </action>
  <verify>
    <automated>npm run check:docs</automated>
  </verify>
  <done>No present-tense routing sentence describes stderr-only daemon.log or daemon-only heads; scenario counts read twelve in present-tense statements and dated results are unchanged; `check:docs` passes with all ten AGENTS headings; config.json restored or reported.</done>
</task>

</tasks>

<verification>
Final verify step (run after all three tasks; plain commands, cwd at the checkout root):
- `npm run typecheck`
- `npm run lint`
- `npm run check:gates`
- `npm run check:docs`
- `git diff --stat` and confirm the changed paths are only the files in `files_modified`, excluding `.planning/config.json` (restored in task 3) and the untracked quick task directory. Confirm no ROADMAP.md, CHANGELOG.md, package.json, `.github/**` or `release/**` change.
- Host-path scan of edited records: `grep -nE "/(root|home|tmp|Users)/" <each edited file>` returns nothing.
</verification>

<success_criteria>
- Every changed sentence cites a file and line range or a commit that the tree shows.
- No live-gated or CI-gated item is described as passed, verified or complete; RES-05, MULTI-04, MULTI-05, REL-01..03, CRASH-04 live proof, QR-07 and CI provenance (D-1304) remain open.
- No requirement checkbox is ticked. ONB-01..03 are unticked with a dated note.
- STATE.md `completed_phases` reads 0; `total_plans`, `completed_plans` and `percent` are unchanged, or any mismatch is reported.
- Held-owner notes for phases 18 and 19 record the 2026-11-08 owner decisions (a), (b), (c), the D19-9 closure, and the superseded spike and implementation statements.
- Live window: recorded as pending or with exact per-scenario counts from an existing result file; scenarios 10, S17-b and 15-10 L-B recorded as not run with the owner's reason.
- AGENTS.md, openshell.md and runtime-decision.md no longer describe stderr-only routing or daemon-only heads in the present tense; scenario counts read twelve in present-tense statements.
- typecheck, lint, check:gates and check:docs pass.
</success_criteria>

<output>
Write the SUMMARY to `.planning/quick/261108-puz-SUMMARY.md` with: the conflict resolution on the spawn constraint; line-number drifts found; which statements were changed, with citations; which were left unchanged and why; the ONB unticking and the STATE completed_plans check as owner-reversible decisions; the live window state; the config.json action taken; and the exact gate results.
</output>

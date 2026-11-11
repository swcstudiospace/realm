# Quick task REC: reconcile stale v3.0 planning records with the integration line

## Why

Several planning rows still say "missing" for code that exists with authored offline tests, and several held-owner notes predate later recorded decisions. A read-only scan of the integration lane (HEAD at the time of the scan: e34da60; each claim below carries file:line evidence from the tree) found these. The records must say what the tree shows, without claiming verification the repository does not hold.

## Rules (locked)

- Record "implemented, offline tests authored" where the evidence says so. Never write "verified", "passed" or "complete" for anything whose acceptance is live-gated or CI-gated. Never tick a requirement checkbox. Do not touch ROADMAP.md progress rows.
- Keep dated history: add a dated reconciliation paragraph or amend the one row that is now false. Do not delete earlier entries.
- Every changed sentence cites the file and lines that make it true. If you cannot cite it, do not write it.
- Live-gated and owner-gated items stay open and are named as such.

## Facts to record (each verified by the scan against the tree)

Phase 18 (`.planning/REQUIREMENTS.md` traceability rows MULTI-02..MULTI-06, and `.planning/phases/18-per-project-sandboxes/18-HELD-OWNER.md` lines 1-5 and 22-23 say runtime missing / plans unimplemented):
- Implemented with authored offline tests: workspace-derived session identity (`src/session/paths.ts:57-74`, `test/session/paths.test.ts:35-89`); persistent pin registry (`src/session/workspace-registry.ts`, `test/session/workspace-registry.test.ts`); per-session daemon registry, admission and locking (`src/daemon/sessions.ts`, `src/daemon/daemon.ts:432-539`, `test/daemon/daemon.test.ts:1905-2495`); aggregate resource ledger and derived bound (`src/daemon/admission.ts`, `src/runtime/hardening.ts:53-131`, `test/daemon/admission.test.ts`, `test/runtime/hardening.test.ts:881-913`); authoritative per-sandbox mount in the compute driver (`src/runtime/driver/compute-driver.ts:852-956`, `test/runtime/driver/compute-driver.test.ts`); selected-project protocol and clients (`src/daemon/channel.ts:114-158`, `src/daemon/client.ts:138-196`); CLI, MCP, ACP and Omp selection (`test/cli/cli.test.ts:1002-1120`, `test/omp/plugin.test.ts:1908-1945`); the two-project live scenario is authored (`test/integration/production-driver.test.ts` "two projects" scenario) and gated.
- Still open: MULTI-04 and MULTI-05 live acceptance (plan 18-14 human checkpoint: owner live window, shared live lock, realm live account); owner items in 18-HELD-OWNER.md (TOOL_TIMEOUT reason text; startupBudgetMs schema maximum or client bound; acknowledgement of seven pre-verdict commits).

Phase 19 (`.planning/REQUIREMENTS.md` rows RES-02..RES-05, and `.planning/phases/19-resume-and-checkpoint/19-HELD-OWNER.md` lines 17 and 29 say the spike never ran and implementation never started):
- The ownership label contract is decided: `docs/integration/runtime-decision.md:459` (D19-1, 2026-11-03). Inspection-failure behaviour: `:461`. The scratch mount-options decision is D19-2 (`:463`), not the held document's allocation request.
- Implemented with authored offline tests: selective reap and proven removal (`src/session/reap.ts:1-16,179-221`); driver adoption and registry/supervisor rebuild (`src/runtime/driver/lifecycle.ts:217-264`, `src/runtime/driver/registry-rebuild.ts:43-59`); daemon pin application and hydration (`src/daemon/daemon.ts:922-926,988-991,1079-1082,1193-1200`); scratch volume create, attach, ordered deletion (`src/runtime/hardening.ts:161-176`, `src/runtime/libpod-client.ts:608-615`, `test/runtime/driver/scratch-volume.test.ts`, `test/runtime/driver/restart-adoption.test.ts`); filesystem snapshot spike recorded (`docs/integration/workspace-snapshot-spike.md`) and D19-6 selects a full copy (`docs/integration/runtime-decision.md:467`); `realm checkpoint create|restore` (`src/session/checkpoint.ts`, `src/cli/checkpoint.ts`, `test/session/checkpoint.test.ts`, `test/session/checkpoint-quiescence.test.ts`, `docs/checkpoint.md`).
- Live observation 2026-11-08 (recorded in `.planning/quick/` summaries for the live-suite tasks): after a daemon SIGKILL the next daemon adopted the session ("adopted and kept"), status reached active with exactly one sandbox and one container. This is an observation of the production stack by the suite's scenario 5, which asserted the superseded behaviour and failed on that assertion; it is not RES-05 acceptance.
- Still open: RES-05 live acceptance (OQ-P19-01 scratch attachment, OQ-P19-02 inspect shape, OQ-P19-03 same-container survival across a daemon kill); the undecided question of checkpointing a normally stopped project (`docs/checkpoint.md:81-85`, `docs/integration/runtime-decision.md:529`): `realm down` removes the registration that checkpoint requires.

Phase 20 (`.planning/REQUIREMENTS.md` rows REL-03 and REL-04; `20-CONTEXT.md:45-47` describe canonical-only filtering):
- REL-04: `scripts/release/changelog.mjs:28-29,143-178` implements explicit `Removes:` relationships, multiple targets, earlier-release removal notes and canonical-revert-first composition; `scripts/release/changelog.test.mjs:424-508` covers them. The "multi-commit non-revert semantics missing" wording is stale.
- REL-03: the rollback workflow takes `docs_tag`, validates distinct semver tags, verifies ancestry and published, non-prerelease release state before any mutation, then forwards `source_ref` (`.github/workflows/rollback.yml:6-120`); Pages validates it before checkout (`.github/workflows/pages.yml:5-100`). The "known-good docs selection missing" wording is stale.
- Still open: REL-01, REL-02 and REL-03 GitHub-side acceptance (release run, attestation verification, approved test-release rollback and Pages deployment) and human workflow review (PR #40).

Phase 13 (`.planning/phases/13-quality-ratchet/13-VERIFICATION.md`):
- Line 48 says REQUIREMENTS and ROADMAP still need the D-1306 amendment. They already contain it (`.planning/REQUIREMENTS.md:33`, `.planning/ROADMAP.md:390`). Correct that finding.
- New evidence 2026-11-08 (record with the commands and numbers): QR-04 raised-floor run: `node scripts/check/coverage.mjs --lcov coverage/lcov.info --floors <scratch>` with `src/fs` branches raised from 87 to 95 against a measured 88.89 exited 1 and printed `src/fs branches 88.89 95.00 below`; the same lcov against the committed floors exited 0 (all nine metrics at or above their floors on Node 24.18). Measured on this host only; CI provenance on Node 22.x and 24.x is still required (D-1304). QR-05 quota run: the full suite (`npm test`, 2799 passed, 0 failed, 34 skipped, 169.7 s) inside a rootless Podman container limited with `--cpus=1` (image `localhost/realm-qr05-runner:0626abe261`, Node 24.22.1, copy of the lane at e34da60, host load 10.0 before and 11.9 after on 8 CPUs).
- QR-08: the owner decided on 2026-11-08 to drop `actions: write` (D-1308, PR #47 commit 33dd980); applied by a separate quick task; merge still needs human review.

Phase 14 (`.planning/phases/14-crash-safety-pack/14-VERIFICATION.md` item 6 and the "open gap" sentences; REQUIREMENTS.md CRASH-04 row):
- The helper gap is closed: `startupReapLineFor` asserted `recordsDeleted`. Superseded by the re-adoption realignment (live-suite quick tasks): scenario 5 now asserts adoption, and a new scenario asserts the destroyed-record path with `recordsDeleted`. Record that the 2026-11-02 live pass belongs to the pre-adoption behaviour and that the current-behaviour live proof is pending the approved window.

Phase 17 (`.planning/phases/17-observability-and-tamper-evident-audit/17-VERIFICATION.md`; `docs/integration/runtime-decision.md:222-228`; `AGENTS.md:73`):
- `17-VERIFICATION.md:100` says rotation is missing; the rotating sink exists (`src/daemon/main.ts:174-199`, `test/daemon/main.test.ts:702-718`). The startup reader's rotation handling is changed by a separate quick task.
- `runtime-decision.md:222-228` and `AGENTS.md:73` still describe entry stderr routing and daemon-only heads; actual routing is a rotating file sink and heads are per session (`src/daemon/main.ts:174-199`, `src/daemon/daemon.ts:499-533`, C6 at `runtime-decision.md:437`). Reconcile those present-tense sentences.

## Files in scope

`.planning/REQUIREMENTS.md`, `.planning/phases/13-quality-ratchet/13-VERIFICATION.md`, `.planning/phases/14-crash-safety-pack/14-VERIFICATION.md`, `.planning/phases/17-observability-and-tamper-evident-audit/17-VERIFICATION.md`, `.planning/phases/18-per-project-sandboxes/18-HELD-OWNER.md`, `.planning/phases/19-resume-and-checkpoint/19-HELD-OWNER.md`, `docs/integration/runtime-decision.md` (lines 222-228 only), `AGENTS.md` (line 73 only). Nothing else.

## Execution notes

- Split into at most three tasks: (1) REQUIREMENTS.md rows and the Phase 18 and 19 held-owner notes; (2) Phase 13, 14 and 17 verification text; (3) the two present-tense routing sentences in `runtime-decision.md` and `AGENTS.md`.
- Verify with `flock -w 7200 <heavy-slot lock> npm run check:docs`. AGENTS.md keeps all ten `##` headings and CLAUDE.md keeps importing it.
- Do not edit CHANGELOG.md, package.json, `.github/**` or `release/**`. `.planning/config.json` has an uncommitted orchestrator change: never stage it.

## Owner decisions recorded 2026-11-08 (add to the records; each is a decision the owner gave in this session)

- Phase 18 held-owner item (a), the TOOL_TIMEOUT reason text 'A tool call did not finish within its queue timeout.': KEEP the current text. No code change. The lock-wait expiry for `up` and `down` keeps answering with it.
- Phase 18 held-owner item (b), `startupBudgetMs` above the client's `up` bound: a schema maximum below the client bound. Implemented by quick task QUICK-SB (policy.schema.json maximum 200000). Mark item (b) resolved by decision only after QUICK-SB's commits exist on the lane, and cite them.
- Phase 18 held-owner item (c), the seven commits 4bfca1a through e2baed6 made before the plan-check verdict was recorded: they STAND (acknowledged by the owner). None is merged into trunk, and human review before merge still applies.
- Phase 19 open item D19-9, checkpointing a stopped project: the owner chose "Checkpoint pins the workspace itself" (create the pin under the policy roots and ceiling the way `up` does, run, then remove it). Implemented by quick task QUICK-CP. Close the open item in the Phase 19 records only after QUICK-CP's commits exist on the lane, and cite them.
- QR-08 (D-1308), owner decision: drop `actions: write` from `.github/workflows/mutation.yml` by cherry-picking `33dd980` (quick task QUICK-M). Merge of the workflow change still needs human review.
- The live window: ONE batched window approved for the non-gateway scenarios only (production live 1-9 with the rewritten scenario 5 and new 5b/5c, the two-project scenario, and the OMPX-05 Omp scenario on Omp 18.18.1). Scenario 10 (stops the gateway), spike S17-b (stops the driver) and plan 15-10 L-B (driver unit edit) are NOT approved.

## GSD tool artifacts to repair in the records (observed 2026-11-08, after plans 15-01 to 15-08)

- `.planning/STATE.md` frontmatter `progress.completed_phases: 18` was introduced by commit `b2803b8` (the 15-03 state update). The milestone start commit `6fe70ee` had `completed_phases: 0`. Milestone v3.0 has `total_phases: 9` (phases 12 to 20) and none is complete (Phase 12 is `verification_deferred_gaps`). Set `completed_phases` to 0 through the GSD state verb that owns the field, or by an Edit if no verb exists, and say which in the SUMMARY. Do not touch `total_plans` or `completed_plans` (the plan executors maintain them).
- `roadmap update-plan-progress` ticks the NEXT plan of a phase in error. After 15-08 the ROADMAP shows `[x] 15-07-PLAN.md` although plan 15-07 has no SUMMARY. The plan executors repair their own ticks, so check the Phase 15 plan list against the summaries on disk at the time you run, and correct any tick that has no matching `15-NN-SUMMARY.md`.


## Verified facts at lane HEAD c39abe6 (2026-11-08), supersede any older line above

- Offline gate set at 9cdbe8e (the code commit under the live window) and at c39abe6 (records only): typecheck 0, lint 0, npm test 2936 pass / 0 fail / 37 skipped, test:scripts 0, check:docs 0, check:gates 0, check:pack 0, check:mcp 0.
- Quick tasks landed with commits: SB a7b765c (records 91d4afe); CP 835fb9c, 455671a (records f1e3cac); T e46b4b1, 98a20e7, 26e9470 (records 6784dbb); HINT eb056f1 (records 097256f); O2 94590fd (records 52388dd); O 5c79211, 74ce823, 6735d4b (records 9ee3d81); R 27c9782 (records 520eba7); O3 b9cd28c (records c05cc22); M 9e2142f = cherry-pick of 33dd980 (records b16a828); L1 a833ece (records 21693b1); L2 9cdbe8e (records c39abe6).
- Phase 15: plans 15-01..15-09 have SUMMARYs. The ROADMAP ticks 15-01..15-09 and leaves 15-10..15-16 open. Plan 15-10 (checkpoints L-A to L-D) stays open: L-A is not run in this session; L-B is unapproved.
- Phase 14 (crash-safety pack): scenario 5 was rewritten to re-adoption (L1). Its live run is in the window below.
- Phase 17 gaps: O-f rotation reader fixed (5c79211), merkleRootOfLeaves exported and tested (74ce823), unreadable audit file exit and head look-back boundaries tested (6735d4b), invalid log level warning tested (94590fd), in-place truncation branch tested (b9cd28c). The live scenarios 6 and 10 and spike S17-b stay human-needed: 6 is in the window, 10 and S17-b are not approved.
- Phase 18 held-owner items decided 2026-11-08: (a) TOOL_TIMEOUT text KEPT; (b) startupBudgetMs schema maximum (QUICK-SB, a7b765c); (c) the seven pre-verdict commits 4bfca1a..e2baed6 STAND (none merged to trunk; human review still required before any merge toward trunk).
- Phase 19: D19-9 (stopped project checkpoint) closed by owner decision 2026-11-08, implemented by QUICK-CP and recorded in docs/integration/runtime-decision.md (decision 7). RES-05 live proof stays open.
- Phase 20: REL-03 and REL-04 offline coverage landed (27c9782). REL-01/02 still need human review of the release workflow; the QR-08 workflow change (9e2142f) is in the same review set.
- Phase 13: QR-05 timing migration is complete offline (e46b4b1, 98a20e7, 26e9470 orchestrator scope addition for killIfPresent). QR-04 floors evidence recorded earlier. QR-08 permission drop applied (9e2142f). QR-07 PR-body attachment and Node 22.x/24.x CI provenance remain open.
- Driver closure NOT live-verified in the window: the deployed driver build predates these modules, and the window does not restage or restart it. Differences in the driver's import closure: runtime/config.js (15-04 overlap refusal and describeRuntimeConfigProblems), session/workspace-registry.js (CP workspaceEntryOf extraction), runtime/openshell.js (added gatewayStatusJsonCommand export). Records must say so and must not claim the new driver is live-verified.
- The lane .planning/config.json is still an uncommitted orchestrator change (workflow.use_worktrees=false). Revert it at the end (config-set workflow.use_worktrees true, or git checkout), and say which one was done.
- Known stale statements to fix (verify each before editing): STATE.md progress.completed_phases reads 18 (should be 0, no phase of v3.0 is complete); STATE.md progress.completed_plans and percent are stale; AGENTS.md, README.md and docs/integration/openshell.md say the live suite has ten scenarios, now twelve (5b and 5c added by L2): update the count statements, keep dated evidence unchanged; REQUIREMENTS.md still checks ONB-01, ONB-02 and ONB-03 from 2026-10-31 notes that were not re-observed.
- Live window: pending at the time of writing this context. Its results must be recorded, with the exact pass and fail counts per scenario, after the window finishes. Scenarios 10, S17-b and 15-10 L-B are NOT run and must be recorded as not run, with the owner's reason.

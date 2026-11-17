# Phase 12 summary: scripted-provider harness and Omp enforcement spike

Status: **PARTIAL — current-source acceptance UNVERIFIED** (2026-10-31). HARN-02, HARN-04 and OMP-05 remain in progress/reopened. No phase, Phase 16 or milestone completion, global-status promotion, merge, release or publication is recorded here.

Task: `Trealm31-phase12-artifacts`; correlation: `realm-phase12-records-oct31`; A15 attempt 2. Original execution graph/correlation: `ut-mvvowl70-29165019`. The accepted 27-task snapshot, all 52 criteria, D1–D6, DONE tasks and previous results/hashes remain authoritative. This supplemental five-path records edit does not reopen DONE `Trealm31-gsd-records` or replace its historical snapshot. The earlier blocked/read-only attempt is retained unchanged.

## Outcome

- Restored the written HARN-02 advisory notice-and-file criterion; removed the current recovery interpretation that registered-name shadowing superseded it. Owner answer: **WARN AND ALLOW** when the daemon is reachable but the realm is inactive and policy is advisory. Every applicable registered-write invocation must show the existing warning and create actual exact host bytes. Unreachable daemon: refuse/no file. Reachable inactive fail-closed: refuse/no file. Failure propagation and repeated notices are required, not optional.
- Reconciled `12-01-PLAN.md`, `12-CONTEXT.md` and `docs/integration/omp.md`, including the advisory verification step 2, the genuine native C4 CREATE execution and the guard's `refuseExternalNetwork` profile control. Locked decisions and historical native/registered-refusal/failed-network receipts remain distinguishable.
- Created this summary and `12-VERIFICATION.md` from actual source and retained parent execution records. Current implementation and execution are separate columns; neither source existence nor suite totals closes a criterion.
- Supplementary AF-DOC-1/QF-101's stale C4-not-run and unproxied-guard statements are corrected in the owned integration note. The original signed quality findings are not edited or backfilled. The separate lifecycle runbook is outside ownership.

## Answered behavior and actual source interface

The current authored Omp change is in `src/omp/plugin.ts`, `registerRealmPlugin` → `callDaemon`: await the real daemon client's call, and for each successful write with non-null `outcome.value.warning`, notify the still-current session through `ctx.ui.notify`. It does not add a second host-write implementation or use cached advisory mode to fall back after a transport failure.

The actual write remains `ToolDispatcher.call` (`src/tools/dispatch.ts`) → `writeWorkspaceFile` (`src/tools/workspace.ts`) → `lockedWrite` (`src/fs/write.ts`). The shared dispatcher retains frozen-schema validation, mutation gate, pinned workspace, locks and audit. `decideMutation` (`src/core/policy.ts`) supplies the existing reachable-inactive advisory text `realm is <state>; the write proceeds under advisory policy`; the authored behavioral case uses `degraded`. The historical unavailable-status notice belongs to native C4 after socket removal. Registered `realmToolDefinitions` (`src/omp/tools.ts`) maps the outcome/error into Omp content/details without a native fallback. These are source-reading facts, not a successful build or executed behavioral result.

New tests authored by the Omp owner in `test/omp/plugin.test.ts` use registered `execute`, the real dispatcher, real pinned filesystem write/read, locks and audit; only the daemon transport/lifecycle is a double:

- `HARN-02 C1: registered advisory write warns on every inactive invocation and writes exact host bytes` — two UTF-8 writes, notice per invocation, registered readback and paired audit phases.
- `HARN-02 C2: registered inactive fail-closed write refuses REALM_NOT_ACTIVE without a host file`.
- `HARN-02: registered advisory/fail-closed write refuses an unreachable daemon without host fallback` — each policy is a distinct parameterized case.
- `HARN-02 C1: registered advisory writes propagate validation, path and conditional-write failures` — invalid schema, traversal, symlink and conditional hash refusal preserve existing bytes.

**These tests were authored by the implementation owner and remain unexecuted in this records task.** Current real Omp C1–C4/HARN-03 proof is still required. The live guard file still uses `daemon.down()` for C1 and asserts refusal/no notice; it proves unreachable refusal, not the restored reachable-inactive advisory case. Its alignment needs separate authorized ownership outside these five paths and the Omp owner's original four paths.

## Requirement disposition

| Requirement | Implementation disposition | Execution disposition / remaining condition |
| --- | --- | --- |
| HARN-01 | IMPLEMENTED: isolated `createOmpProfile`, `ScriptedProvider`, `startOmp` RPC and built extension path | Retained Omp 18.12.6 offered/issued/result/provider evidence exists. Current joined source UNVERIFIED; no new harness run here. |
| HARN-02 | PARTIAL: actual warning forwarding and real registered-tool behavioral tests authored; live C1 still models unreachable refusal | Historical C1–C4 passes are pre-answer. Current reachable-inactive advisory C1, reachable inactive fail-closed, unreachable control, active C3 and native C4 require Main execution. |
| HARN-03 | IMPLEMENTED measurement: `tracedRealmWrite`, `defaultAllow`, proxy refusal at the provider port, exact bytes/RPC/provider assertions | Retained strict warm 0 external/0 DNS/0 offenders is genuine for its earlier build. Current-source run required; honest cold/prerequisite skips do not pass. |
| HARN-04 / OMP-05 | PARTIAL: written basis corrected; historical closure preserved, not current clearance | In progress/reopened until current answered C1–C4 AND HARN-03 pass, then separate global allocation can reconcile records. |
| OMPX-01 | IMPLEMENTED: permanent spike and versioned S1–S14 table; OQ-P5-01 closed for 18.12.6, OQ-P5-02 narrowly restated | Retained 11 independent non-network recovery passes plus earlier spike history; no current-source broad containment or Phase 16 pass inferred. |

The full command/run/skip/evidence mapping is in `12-VERIFICATION.md`.

## Retained execution, not current-source clearance

- Native C4 actually passed on Omp 18.12.6: child-only `PI_EDIT_VARIANT=patch`, absent `c4-created.txt`, supported `edit` CREATE, advisory notice, `isError=false`, exact `c4\n`, identical successful provider tool result. Raw frames/requests: `<evidence-dir>/harn31-02hxpj5r/c4.*`; parent log `8785.bash.log` lines 10–13. The earlier unissued `[c4.txt#0000] REM` failure remains history. This C4 is distinct from the research's optional production-stack case of the same name.
- Approved earlier warm built-Realm trace: `<evidence-dir>/harn31-approved-0g2wtnam`, Omp 18.12.6, only stub 42461 plus discovery 11434/8080/1234; zero external/DNS/offenders; registered write produced 39 UTF-8 bytes with SHA-256 `075d35c7cd91e5ffa0c45f790d2924956038d8b5f948df6feeef18f849d6a838` and provider continuation. Cold remains explicitly skipped. Missing Podman was separately 0 pass/0 fail/1 named skip. Preserve old warm 44 offenders, cold skip 49, failed intermediate correction and narrower S11 observations; no acceptance relaxation.
- Actual production receipt `<evidence-dir>/omp-production-driver-rootless-ns-oct31.json`: real daemon/driver/rootless sandbox, UID 5002; registered write offered/issued/succeeded/continued; exact 21 bytes in host root AND sandbox `/workspace`; matching audit admission/result correlation. Scripted NOT LLM-driven; not strace HARN-03; not a permanent production regression case. It does not close OMPX-05/Phase 16 or re-execute live5/live6 (`productionScenarios.executed=false`).
- Genuine first-quality `Trealm31-wave1-quality`: A08 attempt 1/RW0, once through the canonical gate, `npm test` exit 0, 2388 tests/2359 pass/0 fail/29 skip. Supported canonical ingest subsequently settled it DONE with exactly C4/init/doctor signed quality PASS rows. Original producers remain IN_REVIEW with later review OPEN. These are historical gate/task facts supplied by current binding authority and the retained A08 receipt, not freshly issued or cryptographically reverified here.

Do not combine that formal quality run with the older host union (2358 pass/30 skip), earlier first wave (2351 pass/29 skip), later scoped trace run (6 tests/4 pass/0 fail/2 honest cold skips), or independent CPU-quota run (2359 pass/29 skip). Identical totals do not make two runs the same receipt.

## Handoff and allocation gaps

1. Main runs the current-source postjoin checks only after every edit-only implementation owner returns, retaining actual source identity, command, exit status, named skips and raw evidence. `12-VERIFICATION.md` lists prospective commands; none is marked executed here.
2. A qualified owner needs authorized live guard-case alignment for reachable-inactive advisory C1 and inactive fail-closed C2, while preserving the unreachable negative and native C4 controls. The existing live file is outside this task; no sixth-path change was made.
3. **Separate global allocation gap:** `.planning/REQUIREMENTS.md`, `.planning/ROADMAP.md` and `.planning/STATE.md` are not owned. REQUIREMENTS still has checked HARN-02/HARN-04/OMP-05 and the obsolete recovery interpretation. A sole separately allocated A15 global reconciler must retain those receipts as history, reflect current in-progress/reopened status and wait for Main's actual joined-artifact verification before any later promotion. No raw DAG/amendment/new reconciliation vehicle or `phase.complete` is authorized here.
4. The lifecycle runbook's stale network-pending text is outside this five-path scope. OMPX-02..05 and permanent production coverage remain separately owned acceptance, not closed by this record. Broader CRASH/OBS/ONB/DEF coverage allocation and logged `recordsDeleted` proof are not inferred from this phase's counts or notices.
5. The absolute publication hold remains: no merge, release, publication, dispatch or backport without new written parent approval. Carried exclusions FS-02/ANDA-01..04/UI-01/TD-10 and narrowly scoped PRD-DRV-01 remain unchanged.

## Process and evidence boundary

Only the five signed documentation paths were written. Realpath resolution of the repository, existing files and both new-file parents stayed at their exact expected paths within the Recovery root; no symlink escape was accepted. No product code, global planning files, protected spec/legal/changelog/version files, historical evidence, task store, signing material, main checkout or sibling repository was written.

No tests, builds, typecheck, lint, formatter, docs scanner (including `docs_bundle` twins), gate, smoke, service, live action, commit, Git mutation or phase/milestone completion command ran in this task. The edit-only boundary explicitly precludes those checks. This summary and verification report are authored records awaiting Main review, not a fresh passing bundle or a current signed verdict.

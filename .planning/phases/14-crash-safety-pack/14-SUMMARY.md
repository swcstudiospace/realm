# Phase 14 summary: crash-safety pack

Date: 2026-11-01. Requirements: CRASH-01 to CRASH-07. Plan: `14-01-PLAN.md`. Context decisions: D-1401 to D-1410 in `14-CONTEXT.md`. Verification: `14-VERIFICATION.md` (status `human_needed`).

## Outcome
Implemented on the branch and verified by unit, daemon-path and in-process tests. Live scenario 5 (acceptance item 6) has not been run and needs owner approval for a live window under the live lock. No requirement is checked here; REQUIREMENTS.md and ROADMAP.md are parent-owned.

## Scope delivered (by requirement)
- CRASH-01: `sweepOrphanTempFiles` in `src/fs/temp-sweep.ts` removes only exact `.<name>.realm-tmp-<16 hex>` regular files owned by the daemon uid, older than 60 s, on the root's device, through a pinned directory descriptor, never through a symlink. Audit line per removal before the unlink; 15 s budget and 500 000 entry cap. Runs in `runStartupMaintenance` before the gate opens (`src/daemon/daemon.ts`).
- CRASH-02: `reconcileAuditLogs` and `pairingKey` in `src/audit/reconcile.ts`. One reconciliation line per admission with no result, outcome `AUDIT_OUTCOME_UNKNOWN` (new catalogue code, D5), through `appendAudit` only, idempotent across starts. A torn last line is closed in `writeAuditLine`. Runs at daemon start.
- CRASH-03: `SessionStore.delete` syncs the sessions directory after the unlink; a failed sync is `WRITE_NOT_ATOMIC` (`src/session/store.ts`).
- CRASH-04: startup report (`containersRemoved`, `recordsDeleted`, container ids) from `runStartupMaintenance`; `notice` on daemon `status`, `up` and `down` replies, kept for the daemon's lifetime; shown by `realm status` (JSON), Omp attach (`ui.notify`, once per attach), and `realm mcp` / `realm acp` diagnostics. `removeAllRealmContainers` takes an optional `onRemoved` (`src/runtime/sweep.ts`).
- CRASH-05: four real child-process SIGKILL tests (one per hookable stage), a control, and an age-bound test in `test/fs/atomic-write-sigkill.test.ts`.
- CRASH-06 (TD-01): the refused `ToolOutcome` carries an optional `causeCode`; the dispatcher, the daemon `tool` reply and the client guard pass it on (`src/tools/dispatch.ts`, `src/daemon/daemon.ts`, `src/daemon/client.ts`).
- CRASH-07 (TD-04): when a recorded container fails to start with `OPENSHELL_START_FAILED` and no create ran in this call, the controller destroys it once, clears the id and creates again (`src/lifecycle/controller.ts`).
- Catalogue: `AUDIT_OUTCOME_UNKNOWN` added to `src/core/errors.ts` and `src/runtime/driver/grpc-status.ts` (gRPC `INTERNAL`). The Phase 14 commit pins 30 codes.

## Commits (branch `integrate/omp-18142`; both are ancestors of its tip 069b73b)
- `157ebfe` feat: add the crash-safety libraries, the lost-container retry and the daemon cause code (phase 14, part 1) (#11): CRASH-01 and CRASH-05 libraries, CRASH-02 library and catalogue code, CRASH-03, CRASH-06, CRASH-07, Phase 14 docs.
- `5719f81` feat(daemon): sweep and reconcile at start, log the reap and show a notice (phase 14, part 2) (#15): start-time wiring for CRASH-01 and CRASH-02, the CRASH-04 report, notice and surfaces, and the scenario 5 assertions in `test/integration/production-driver.test.ts`. Its message records Greptile review rounds 1 to 5 on PR #15. The standalone round commits (`3f38269`, `8da6167`, `88046e6`, `9527f34`, `aa840a1`) are not reachable from `integrate/omp-18142`; their content is recorded in that message.
- Prerequisite already on the branch: `45aa633` (pins the atomic-write directory by descriptor and fsyncs audit lines).

## Phase 14 files changed (union of `157ebfe` and `5719f81`, 46 files)
- Planning: `.planning/phases/14-crash-safety-pack/14-01-PLAN.md`, `14-CONTEXT.md`, `14-RESEARCH.md`.
- Docs: `AGENTS.md`, `docs/integration/acp.md`, `docs/integration/mcp.md`, `docs/integration/omp.md`, `docs/integration/omp-lifecycle-runbook.md`, `docs/integration/runtime-decision.md`.
- Source: `src/audit/log.ts`, `src/audit/reconcile.ts`, `src/cli/main.ts`, `src/core/errors.ts`, `src/daemon/client.ts`, `src/daemon/daemon.ts`, `src/daemon/main.ts`, `src/fs/atomic-write.ts`, `src/fs/temp-sweep.ts`, `src/lifecycle/controller.ts`, `src/mcp/protocol.ts`, `src/omp/plugin.ts`, `src/runtime/driver/grpc-status.ts`, `src/runtime/sweep.ts`, `src/session/reap.ts`, `src/session/store.ts`, `src/tools/dispatch.ts`.
- Tests and support: `test/audit/log.test.ts`, `test/audit/reconcile.test.ts`, `test/cli/cli.test.ts`, `test/core/errors.test.ts`, `test/daemon/client.test.ts`, `test/daemon/daemon.test.ts`, `test/daemon/main.test.ts`, `test/fs/atomic-write.test.ts`, `test/fs/atomic-write-sigkill.test.ts` (new), `test/fs/temp-sweep.test.ts` (new), `test/integration/production-driver.test.ts`, `test/lifecycle/stale-container.test.ts` (new), `test/omp/plugin.test.ts`, `test/runtime/sweep.test.ts`, `test/session/store.test.ts`, `test/support/fake-tools.ts`, `test/support/fsync-spy.ts` (new), `test/support/production-live.ts`, `test/surfaces/daemon-equivalence.test.ts` (new), `test/tools/dispatch.test.ts`.

## Verification run (parent; this closeout runs nothing)
- Phase 14 targeted set (ledger row P14, `RECOVERY-2026-10-31.md`): `node --test` over `temp-sweep`, `atomic-write-sigkill`, `audit/log`, `audit/reconcile`, `session/store`, `lifecycle/stale-container`, `surfaces/daemon-equivalence`: 124 tests, 0 fail, 0 skipped.
- Full suite under a one-CPU cgroup quota: 2458 tests, 2426 pass, 0 fail, 32 skipped.
- Typecheck, lint, script tests, `check:docs`, `check:gates`, build, `check:pack`, `check:mcp`: all exit 0 on this tree.
- Not run: live production scenario 5 (`test/integration/production-driver.test.ts`), by owner instruction.

## Deviations and notes
1. Catalogue count. The plan's "30 codes" holds at the Phase 14 commits. The current tree (`1fa69c1`) pins 31 in `test/core/errors.test.ts` because Phase 17 later added `OPENSHELL_GATEWAY_LOST`. Not changed here.
2. Startup record. The reap report is now a JSON `daemon.startup` record. Phase 17 commits `50fe21f` and `2e48073` changed the format on the same seam; the Phase 14 assertions still pass on this tree.
3. Cross-device negative test (`test/fs/temp-sweep.test.ts`) skips with a stated reason when `/dev/shm` is not a separate device or is not writable. The 124-test run reported 0 skipped.
4. The daemon-equivalence test (CRASH-06) replaces the dispatcher call with a scripted refusal, so it proves the surface and daemon path. Dispatcher propagation is proven separately in `test/tools/dispatch.test.ts`.
5. Test skip additions in the Phase 14 commits are limited to the conditional cross-device skip above. No suppression directive was added in those commits.

## Open items
- Acceptance item 6 (live scenario 5): NOT RUN. Needs a per-window owner approval under the live lock.
- CRASH-04 live assertion gap: `startupReapLineFor` (`test/support/production-live.ts`) checks the event, `containersRemoved === 1` and the container id, but not `recordsDeleted`. Scenario 5 checks the notice's counts through `realm status`. The in-process test `test/daemon/main.test.ts` asserts `recordsDeleted` in the startup record.
- CRASH-02 in-chain live presence: belongs to Phase 17 (ledger P17).
- Phase 19 rewrites `reapStartup` and the report. Keep the seams `runStartupMaintenance`, `sweepOrphanTempFiles(roots)`, the report object and `pairingKey` stable until then.
- REQUIREMENTS.md, CRASH-04 entry, says "production live5 actually passed on 2026-10-31 with the rebuilt driver". That record is not attributed to tree `1fa69c1`, and the ledger requires exact revision attribution. This closeout does not rely on it. Parent to reconcile the wording.
- No push, pull request, merge or release. Draft PRs #46 and #47 were not touched.

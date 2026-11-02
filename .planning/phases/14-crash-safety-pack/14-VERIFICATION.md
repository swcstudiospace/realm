# Phase 14 verification: crash-safety pack

Date: 2026-11-01 for acceptance items 1 to 5 and the plan checks. Live run (item 6): 2026-11-02. Static tree: `gsd/v3-autonomous` at `1fa69c1`, built on `integrate/omp-18142` at `069b73b`. Live tree: the Phase 14 code of `integrate/omp-18142` at `5527882`, with only a test edit on top. Source of acceptance: `14-CONTEXT.md`, section Acceptance, items 1 to 6.

**Status: gaps_found.** Items 1 to 6 PASS on the evidence below. Open gap: the live helper `startupReapLineFor` does not assert the logged `recordsDeleted` field (CRASH-04 detail). Closing it needs a helper change and another approved live window. No requirement is checked here; the parent owns REQUIREMENTS.md.

## Acceptance items

### 1. Real-SIGKILL stages, orphan and sweep, and negative rules: PASS
- Four stages (`after-temp-write`, `after-fsync`, `before-rename`, `after-recheck`): `test/fs/atomic-write-sigkill.test.ts` loop at line 79. A child process writes through `atomicWriteFile` and SIGKILLs itself from the stage hook. The test asserts signal `SIGKILL`, target bytes unchanged, exactly one orphan matching `TEMP_NAME_PATTERN`, and that the sweep removes it with one audit entry `{tool: "temp-sweep", outcome: "ok", path, bytes}`.
- Control (no kill, no temp left): same file, line 114. Age bound with the production 60 s value keeps a fresh orphan: line 125.
- Negatives in `test/fs/temp-sweep.test.ts`: age (line 106), exact pattern (117), owner uid (140), symlink named like a temp file (151), symlinked directory (166), cross-device directory (180, conditional skip with a stated reason), audit failure keeps the file and counts it (214), failed unlink appends `CLEANUP_FAILED` (230).
- The four stages and the pattern tests are in the Phase 14 targeted set (124 tests, 0 fail, 0 skipped).
- Limit: the cross-device case skips when `/dev/shm` is not a separate device. The run reported 0 skipped.

### 2. Planted admission gets one reconciliation line at the next start, none at the second: PASS
- `test/daemon/daemon.test.ts`, "CRASH-01, CRASH-02, CRASH-04: startDaemon sweeps ..." (line 463). An admission with no result is planted. First `startDaemon`: one reconciled line, `outcome` `AUDIT_OUTCOME_UNKNOWN`, `phase` `reconciliation`. Second `startDaemon`: `auditLinesReconciled` 0 and still one reconciliation line in the log.
- Pairing, torn tail and idempotence unit cases: `test/audit/reconcile.test.ts` (CRASH-02 block, lines 164 to 266).
- The daemon test is in the full suite (2426 pass), not in the 124-test targeted set.

### 3. Durable delete, reap log with ids and counts, notice on every surface: PASS (in-process; live-path gap noted under item 6)
- `SessionStore.delete` fsync: `test/session/store.test.ts` line 116 (fsync spy sees the record already absent, after the unlink); line 139 (failing fsync is `WRITE_NOT_ATOMIC`).
- Reap log: `test/daemon/main.test.ts`, "CRASH-04: the start's onStartup report is written ..." (line 187). The startup record asserts `containerIds` and `recordsDeleted: 1`.
- Notice on `status`, `up` and `down`: `test/daemon/daemon.test.ts` line 463 region (kept on re-read, absent on a clean second start); `test/daemon/client.test.ts` line 135.
- `realm status` prints the notice in its JSON: `test/cli/cli.test.ts` line 1045.
- `realm mcp` and `realm acp` attach diagnostics, once and never on stdout: `test/cli/cli.test.ts` lines 993 and 1017.
- Omp status flow, `ui.notify` once per attach: `test/omp/plugin.test.ts` line 446.
- Gap: the live helper does not assert `recordsDeleted` (item 6).

### 4. Same refusal cause code over MCP and ACP, in process and over the daemon: PASS
- `test/surfaces/daemon-equivalence.test.ts` line 185: a refused outcome with `causeCode` `PODMAN_MACHINE_DOWN` yields the same `{code, retryable, causeCode}` through in-process MCP, in-process ACP, MCP over the daemon and ACP over the daemon.
- Line 209: with no cause, the four paths carry no `causeCode`.
- Supporting: `test/daemon/daemon.test.ts` line 1060; `test/tools/dispatch.test.ts` lines 98 and 108 (dispatcher propagation).
- Scope: the equivalence test replaces the dispatcher call with a scripted refusal at the adapter seam. It proves the surface and daemon path; the dispatcher is covered by `dispatch.test.ts`.

### 5. Controller retry after a removed container reaches `active` with a new id: PASS
- `test/lifecycle/stale-container.test.ts` line 76: the recorded container is removed; `create` returns `active`; the new `containerId` differs from the old one; the recovery destroy runs before the second create; one resource exists afterwards.
- Related: line 108 (fail-at-start then gone, active in one call); line 125 (one recovery per call, no loop); line 142 (destroy failure goes to `error` with its own code and creates nothing); line 156 (non-recovery codes keep the container and issue no destroy).
- These are controller tests with a fake exec adapter. Item 6 does not exercise this path: scenario 5 covers the daemon-crash reap, not the start-failure retry. No live evidence is claimed for this path.

### 6. Live production scenario 5 shows the notice and the log line: PASS (live window 2026-11-02)
- Window: one approved live window, production live scenario 5 only, run once on 2026-11-02 under the realm live lock, against the Phase 14 code (live tree above). The staged driver was swapped in for the window and the original driver was restored afterwards. After the window, the three realmlive units are active, zero realmlive containers remain, and the window's test-only artifacts were removed.
- Result: 1 test, 1 pass, 0 fail, 0 skipped.
- Assertions (`test/integration/production-driver.test.ts`, scenario 5): after the daemon is killed, the next `realm up` reaps the sandbox the crash left and reaches active with exactly one. The checks are: `realm status` reaches active (line 580); after the restart exactly one realm-daemon sandbox and one container exist; `realm status` carries the notice `destroyed at startup` with one container and at least one session record; `daemon.log` holds a `daemon.startup` record naming the crashed container; `realm audit verify` reports ok. The test passed, so every one of these held on the live run.
- The scenario and helper source are identical at `5527882` and at the lane HEAD `612a6d4`.
- Open gap: `startupReapLineFor` (`test/support/production-live.ts`, line 288) checks the event, `containersRemoved === 1` and the container id, but not `recordsDeleted`. The in-process test in item 3 does check it. Closing this gap needs a helper change plus another approved live window.
- Historical record: `REQUIREMENTS.md` (CRASH-04 entry) says production live5 passed on 2026-10-31 with a rebuilt driver. That record is not attributed to a tree and is not counted here. The 2026-11-02 run above is the attributed evidence.

## Plan-level checks (from `14-01-PLAN.md` Acceptance)
- Typecheck, lint, `check:docs`, `check:gates`, `test:scripts`, build, `check:pack`, `check:mcp`: exit 0 on tree `1fa69c1` (parent run). Not re-run on the live tree `5527882`.
- `npm test` under a one-CPU cgroup quota, tree `1fa69c1` (parent run): 2458 tests, 2426 pass, 0 fail, 32 skipped. The 32 skips are not itemised here.
- Catalogue: 30 codes at the Phase 14 commits (`157ebfe` pins `CATALOGUE_SIZE = 30`). Now 31: Phase 17 added `OPENSHELL_GATEWAY_LOST`, and `test/core/errors.test.ts` pins 31.
- Suppression directives and test skips added by `157ebfe` and `5719f81`: none, apart from the conditional cross-device skip in item 1.
- "No other frozen contract changed": not separately verified by this closeout.

## Requirement evidence (not checked; parent owns REQUIREMENTS.md)
| Requirement | Evidence | State |
|---|---|---|
| CRASH-01 | Items 1 and 2; sweep before the gate opens (`daemon.ts`, `openGate()` after `runStartupMaintenance`) | Implemented; verified except live path |
| CRASH-02 | Item 2; catalogue and pairing tests | In-chain live presence is Phase 17 (ledger P17) |
| CRASH-03 | Item 3 | Implemented; verified |
| CRASH-04 | Item 3 (unit), item 6 (live, PASS 2026-11-02) | Implemented; live `recordsDeleted` assertion is an open gap |
| CRASH-05 | Item 1 | Implemented; verified |
| CRASH-06 | Item 4 | Implemented; verified |
| CRASH-07 | Item 5 | Implemented; verified |

## Open items for the owner
1. Done: scenario 5 ran once on 2026-11-02 under the live lock (item 6). No other live step was approved.
2. Open: close the CRASH-04 gap. Add the `recordsDeleted` assertion to `startupReapLineFor`, then approve another live window for scenario 5 under the live lock.
3. Confirm the Phase 17 owner of the in-chain live presence for CRASH-02.
4. Reconcile the CRASH-04 wording in REQUIREMENTS.md with the attribution rule in item 6.

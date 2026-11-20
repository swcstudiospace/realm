# Phase 14 — PLAN (consolidation)

Reused detail: `14-01-PLAN.md`. This consolidation assigns every CRASH ID
to exactly one plan; waves are file-disjoint.

## Wave 1 — Startup maintenance + session durability
- P14-01 [CRASH-01] files: `src/fs/temp-sweep.ts`, `src/daemon/daemon.ts`
  (runStartupMaintenance only), `src/fs/atomic-write.ts` (pattern seam).
  Observable: aged exact-name/owner/no-symlink/cross-device negatives;
  each removal audited before unlink. IU (wiring exists).
- P14-02 [CRASH-03] files: `src/session/store.ts`,
  `src/session/store.test.ts`. Observable: fsync spy after delete;
  sync failure → `WRITE_NOT_ATOMIC`. IU.

## Wave 2 — Audit + daemon surfaces (disjoint from Wave 1 except daemon.ts seam — serialize on daemon.ts)
- P14-03 [CRASH-02] files: `src/audit/reconcile.ts`,
  `src/core/errors.ts`, `test/audit/reconcile.test.ts`.
  Observable: planted admission → exactly 1 reconciliation line, second
  start appends 0; pairing via `pairingKey`. IU; live chain presence → P17.
- P14-04 [CRASH-04] files: `src/daemon/main.ts`, `src/daemon/daemon.ts`
  (report/notice only), `src/omp/plugin.ts` (notice display),
  `src/cli/main.ts` (status print). Observable: startup reap line names
  container ids + `recordsDeleted`; next attach/status shows notice;
  live scenario 5 asserts logged count for a startup removal. GENUINE GAP:
  current live 5b asserts count after SIGTERM, not startup removal.
- P14-05 [CRASH-06] files: `src/tools/dispatch.ts`, `src/daemon/client.ts`,
  `test/surfaces/daemon-equivalence.test.ts`. Observable: same cause code
  in-process/MCP/ACP; no wire-shape unification. IU.
- P14-06 [CRASH-07] files: `src/lifecycle/controller.ts`,
  `test/lifecycle/stale-container.test.ts`. Observable: removed container
  → retry reaches `active`, new id, one recovery, no loop. IU.

## Wave 3 — SIGKILL proof
- P14-07 [CRASH-05] files: `test/fs/atomic-write-sigkill.test.ts`,
  `src/fs/temp-sweep.ts` (reuse P14-01 seam, no change).
  Observable: 4 real child SIGKILL stages; original intact, orphan named,
  next sweep removes it; age control. IU.

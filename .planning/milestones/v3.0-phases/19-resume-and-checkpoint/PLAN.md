# Phase 19 — PLAN (consolidation)

Reused detail: `19-01-PLAN.md` (single-plan source; callsite allocation per
D19-2 is A01's pre-cutover step). Each RES ID appears in exactly one plan
below; waves are file-disjoint.

## Wave 1 — Decisions (docs only)
- P19-01 [RES-01] files: `docs/integration/runtime-decision.md`.
  Observable: D5(ii/iii) reaper + scratch amendment with D19-1 label
  alignment (`:459`) and D19-6 full-copy selection (`:467`), both dated
  before dependent code. DR.

## Wave 2 — Adoption + scratch (after Phase 18 releases callsites)
- P19-02 [RES-02] files: `src/runtime/driver/lifecycle.ts`,
  `src/runtime/driver/registry-rebuild.ts`, `src/daemon/daemon.ts`,
  `src/session/reap.ts`, `test/runtime/driver/restart-adoption.test.ts`.
  Observable: verified survivor adopted (same id, hydrated, supervised);
  verifier-fail/no-record removed before serving; causes logged; unknown
  removal aborts startup. Implemented offline; live open.
- P19-03 [RES-03] files: `src/runtime/hardening.ts`,
  `src/runtime/libpod-client.ts`, `src/runtime/libpod-routes.ts`,
  `test/runtime/driver/scratch-volume.test.ts`. Observable: exact rw
  `/scratch`, verifier admits exactly 3 workspace/state/channel binds +
  this volume; down removes sandbox then volume with proven absence.
  Implemented offline; live attach/inspect open (OQ-P19-01/02).

## Wave 3 — Checkpoint + live acceptance
- P19-04 [RES-04] files: `src/session/checkpoint.ts`, `src/cli/checkpoint.ts`,
  `src/session/checkpoint-quiescence.ts`, `test/session/checkpoint.test.ts`,
  `test/session/checkpoint-quiescence.test.ts`. Observable: snapshot→
  modify→restore round-trips byte-for-byte incl. deletions/extras; unsafe/
  corrupt inputs refused; stopped-project self-pinning. Implemented
  offline (full copy); live roundtrip open.
- P19-05 [RES-05] files: `test/integration/production-driver.test.ts`,
  `test/support/production-live.ts`. Observable (live, owner window):
  daemon kill+restart → same container id, `/workspace` intact, no second
  container; verifier-fail removed; scratch survives restart, gone after
  down; snapshot/restore roundtrip. MC + LG — not claimed from offline.

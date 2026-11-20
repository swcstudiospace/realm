# Phase 18 — PLAN (consolidation)

Reused detail: `18-01..18-14-PLAN.md` (+18-04b) and `18-PLAN-CHECK.md`
(execution-ready after round 9). This consolidation assigns every MULTI ID
to exactly one plan; waves are file-disjoint per the sub-plans.

## Wave 1 — Contract + identity (no runtime cutover yet)
- P18-01 [MULTI-01] files: `docs/integration/runtime-decision.md`.
  Observable: D5(i) decision with PR36 chronology retained; decision
  timestamp precedes dependent code commits. DR — retain, do not reopen.
- P18-02 [MULTI-02] files: `src/session/paths.ts`,
  `src/session/workspace-registry.ts`, `src/fs/root.ts`,
  `test/session/paths.test.ts`, `test/session/workspace-registry.test.ts`.
  Observable: alias idempotence, descendant eligibility, exact pin,
  outside-root `POLICY_DENIED`, forced-collision refusal. Implemented
  offline; live acceptance open.

## Wave 2 — Daemon per-session + admission (disjoint from Wave 1)
- P18-03 [MULTI-03] files: `src/daemon/sessions.ts`, `src/daemon/daemon.ts`,
  `src/daemon/admission.ts`, `test/daemon/daemon.test.ts`,
  `test/daemon/admission.test.ts`. Observable: per-session audit/locks/
  status; down A leaves B active; pre-await reservations count in-flight,
  adopted and failed-removal commitments. Implemented offline.
- P18-04 [MULTI-06] files: `src/runtime/hardening.ts`,
  `src/daemon/admission.ts`, `test/runtime/hardening.test.ts`,
  `docs/integration/runtime-decision.md` (bound record). Observable: owner
  bound 4 GiB / 4e9 nanoCpus / 2 sessions enforced under concurrent
  creates; no new catalogue code. Implemented offline; live open.
  (Serialize `admission.ts` with P18-03.)

## Wave 3 — Driver transport + live acceptance (after Waves 1–2)
- P18-05 [MULTI-04] files: `src/daemon/channel.ts`, `src/daemon/client.ts`,
  `src/runtime/driver/compute-driver.ts`,
  `test/runtime/driver/driver-service.test.ts`. Observable: transport
  resolves selected project through gateway identity to the actual mount;
  inspected mount source equals canonical project. Implemented offline;
  deployed-driver closure not restarted — live open.
- P18-06 [MULTI-05] files: `test/integration/production-driver.test.ts`,
  `test/runtime/sandbox-binding.test.ts`, `test/fs/root.test.ts`.
  Observable (live, owner window): two projects, distinct same-name
  `/workspace` bytes, write in A invisible in B, down A leaves B active.
  Authored + live-gated; prior window failed at first `up`.

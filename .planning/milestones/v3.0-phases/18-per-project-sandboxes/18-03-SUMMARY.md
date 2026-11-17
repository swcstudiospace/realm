---
phase: 18-per-project-sandboxes
plan: 03
subsystem: daemon, runtime
tags: [admission, aggregate-budget, maxSessions, hardening-profile, multi-project]
requires: ["18-01"]
provides:
  - "src/daemon/admission.ts exports AdmissionLedger: synchronous reserve, markUnproven, release, committedCount, isCommitted, reservedCount"
  - "src/runtime/hardening.ts: HARDENING_PROFILE.aggregateMemoryBytes and aggregateNanoCpus, maxConcurrentSessions(), MAX_CONCURRENT_SESSIONS = 2"
affects: [src/daemon/admission.ts, src/runtime/hardening.ts, test/daemon/admission.test.ts, test/runtime/hardening.test.ts]
key-files:
  created:
    - src/daemon/admission.ts
    - test/daemon/admission.test.ts
  modified:
    - src/runtime/hardening.ts
    - test/runtime/hardening.test.ts
decisions:
  - "maxSessions is derived, not configured: min(floor(4 GiB / 1 GiB), floor(4e9 / 2e9)) = 2 (C7, owner 2026-11-02)"
  - "The ledger takes recordedIds as a function evaluated at each call; it never reads the record store itself, so it has no I/O"
  - "reserve is synchronous and returns void; no method awaits"
requirements: [MULTI-06]
metrics:
  tasks: 2
  commits: 1
  commit: c7469dc
status: complete
---

# Phase 18 Plan 03: aggregate admission ledger and the bound constants (MULTI-06) Summary

The daemon now has a synchronous admission ledger that refuses a distinct session once the committed count reaches the derived bound of 2, and the bound is computed from the hardening profile's per-container caps and two new aggregate budget fields.

## Commit and provenance

- Commit `c7469dc` (`feat(phase-18): aggregate admission ledger and derived maxSessions (MULTI-06, plan 03)`) is an ancestor of `4ad91be`, the worktree head. It changes exactly the four planned files: `src/daemon/admission.ts` (+82), `src/runtime/hardening.ts` (+29), `test/daemon/admission.test.ts` (+122), `test/runtime/hardening.test.ts` (+37); 270 insertions, 0 deletions.
- The read-only audit on origin/main `ea07518` recorded these facts for this plan: `src/daemon/admission.ts:1-95`, `src/runtime/hardening.ts:51-56, 110-131, 353-356`. Symbol locations confirmed in the worktree: `AdmissionLedger` at `admission.ts:14`, `reserve` at `admission.ts:32`, the `POLICY_DENIED` throw at `admission.ts:38`; `aggregateMemoryBytes` and `aggregateNanoCpus` at `hardening.ts:54, 56`, `maxConcurrentSessions` at `hardening.ts:110`, `MAX_CONCURRENT_SESSIONS` at `hardening.ts:131`.

## Tasks

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| T1 | admission ledger (`AdmissionLedger`) and its tests | c7469dc | src/daemon/admission.ts, test/daemon/admission.test.ts |
| T2 | aggregate constants, `maxConcurrentSessions`, `MAX_CONCURRENT_SESSIONS`, digest test | c7469dc | src/runtime/hardening.ts, test/runtime/hardening.test.ts |

## What was added

- `src/daemon/admission.ts`: `class AdmissionLedger` built from `{ maxSessions, recordedIds }`. Committed set = recorded ids (read per call) union reserved union unproven. `reserve` is synchronous; an already-committed id returns without change; a distinct id at the bound throws `POLICY_DENIED` before anything is recorded. `markUnproven` moves an id from reserved to unproven (failed destroy or start keeps its slot). `release` frees the id and is called only after proven removal or when no container was created. The class has no I/O and no `await`.
- `src/runtime/hardening.ts`: two fields placed after `nanoCpus`, `aggregateMemoryBytes: 4 GiB` and `aggregateNanoCpus: 4_000_000_000`, each with a comment stating the aggregate budget and that per-container caps are unchanged. `maxConcurrentSessions(profile)` returns `min(floor(aggregateMemoryBytes / memoryBytes), floor(aggregateNanoCpus / nanoCpus))` and throws `SCHEMA_INVALID` on a non-positive-integer input or a result below 1. `MAX_CONCURRENT_SESSIONS = maxConcurrentSessions(HARDENING_PROFILE)`.
- Both new fields sit inside `hardeningEvidenceDigest`, which hashes the whole profile. Sandboxes created after this change carry a different provisioning-evidence digest; no stored digest is compared, so no existing sandbox is affected.

## Test cases present (names observed in the worktree; none run)

- `test/daemon/admission.test.ts`: third distinct reserve in one synchronous turn refused with `POLICY_DENIED`, count stays 2; reserve returns `undefined`; re-reserving a reserved id does not increase the count; a recorded id counted once; recorded ids read at every call; failed removal keeps the slot; release after `markUnproven` frees it; `markUnproven` on an unproven id is a no-op; release with no container frees the slot; `isCommitted`; non-positive-integer `maxSessions` (0, -1, 1.5, NaN, Infinity) throws `SCHEMA_INVALID` and 1 is accepted; `reservedCount` zero after every release.
- `test/runtime/hardening.test.ts`: bound is 2 with the profile's caps (`MAX_CONCURRENT_SESSIONS` and `maxConcurrentSessions(HARDENING_PROFILE)`); memory term binds (aggregate 1 GiB gives 1); CPU term binds (aggregate 2e9 nanoCpus gives 1); zero and sub-1 inputs throw `SCHEMA_INVALID`; JSON of the profile contains both keys with their values; `hardeningEvidenceDigest(image)` equals the sha256 of the canonical document built from the profile.

## Host evidence step (C7)

The audit recorded the realm host at 31 GiB memory and 8 CPUs. Both exceed the plan's thresholds (`MemTotal` at least 4194304 kB, online CPUs at least 4), so the stop rule does not trigger. This summary takes those values from the audit; it did not re-read `/proc/meminfo` or the CPU count. The constants were not lowered.

## Deviations from Plan

**1. [Plan vs code] Extra ledger method and extra test cases**
- The plan's method list omits `reservedCount()`; the test file exercises it. It is a read-only count and adds no state.
- The non-positive `maxSessions` test covers `NaN` and `Infinity` in addition to the values the plan named.

**2. [Plan vs code] Extra bound tests**
- The plan asked for the memory-term case and the zero-input case. The test file also has a CPU-term-binds case, a non-integer aggregate CPU case, and an aggregate-memory-of-512-MiB case (which yields 0 and must throw).

**Total deviations:** 2, both additive test or method coverage. No behavior differs from the plan's stated contract.

## Not verified here

- `npm run build && node --test dist/test/daemon/admission.test.js` (T1 verify command): NOT VERIFIED. Not run for this summary; the case names exist, the pass result was not observed.
- `npm run build && node --test dist/test/runtime/hardening.test.js` (T2 verify command): NOT VERIFIED. Same reason.
- Host `MemTotal` and CPU count: taken from the audit (31 GiB, 8 CPUs), not re-read: NOT VERIFIED by this summary.
- Plan 06 wiring (the single daemon `AdmissionLedger` calling `reserve`, `markUnproven`, `release`; the driver never counting): outside this plan; NOT VERIFIED here.

## Issues Encountered

None recorded in the audit facts for this plan.

## Known Stubs

None found in the two source files named above.

## Threat Flags

None. The change adds no config key, no policy key, no catalogue code, and no I/O.

## Next Phase Readiness

Plan 06 imports `AdmissionLedger` and `MAX_CONCURRENT_SESSIONS`. Any change to `aggregateMemoryBytes`, `aggregateNanoCpus`, or the per-container caps changes the bound and the provisioning-evidence digest; that change needs the owner's C7 decision.

---
*Phase: 18-per-project-sandboxes*

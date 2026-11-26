# Phase 56: F-51-1 cause — Verification

**Status:** `gaps_found` (cause not established; live gate closed; F-51-1 carried with evidence per D-56-3)
**Date:** 2026-11-25
**HEAD:** `404da2b` (docs unity record; Phase 56 emission commit `b37b94c` is the latest phase commit)
**Scope:** roadmap Phase 56 success criteria (3) verified against `.planning/phases/56-f-51-1-cause/` and the tree at HEAD. Hermes `su realmlive` gate probe reproduced read-only.

## Criteria table

| # | Success criterion (ROADMAP) | Verdict | Evidence |
|---|---|---|---|
| 1 | Live window captures failed step + cause code for every dirty stop; timeline kept outside repo | **CARRIED (gate-blocked)** — no window ran | Gate probe reproduced 2026-11-25: `su - realmlive -c 'openshell status'` → "No gateway configured."; no `REALM_DRIVER_*` / `REALM_LIVE_*` env for realmlive. Matches `56-WINDOW.md` (2026-11-22T18:58Z: podman.socket dead, openshell-gateway dead, no compute-driver unit, root's stack unreachable). Capture-gap closed in code (below) but never exercised live. |
| 2 | STOP-05 met with cause recorded in `docs/integration/runtime-decision.md`, or carried with stated tested reason; F-51-1 not folded into F-41-1 | **CARRIED-WITH-REASON (roadmap-permitted)** | `56-EVIDENCE.md` §closure + `56-WINDOW.md` record: emission added, window blocked, Phase 51 inference stands (not replaced), F-51-1 carried explicitly, distinct from F-41-1 / GAP-43-03 / GAP-40-01. `docs/integration/runtime-decision.md` F-51-1 note records emission + blocked window + carry. Cause itself is **not established**. |
| 3 | Cause fixed or bounded (waits bounded, no bound/orphan weakening) + ≥20 consecutive variant-c iterations with `failedTeardowns` 0 | **CARRIED (gate-blocked)** — no fix, no clean run | No fix commit in phase; no live run exists. Bounds/guarantee preservation claim is code-reviewable only: `teardown.ts` change is additive (`causeCode` field, same `boundMs` path, `withTimeout` unchanged) — but the 20-iteration run is absent, so the criterion is not met. |

## Hermetic evidence verified in tree (read-only)

- **Emission exists:** `src/daemon/teardown.ts:7-12` — `StopSessionsResult.causeCode` ("first failed session's own cause code"); `:31-39` populates it from `RealmError.causeCode` of first failure, `undefined` otherwise (the Phase 51 shape).
- **Row carries it:** `src/daemon/daemon.ts:566-568` — `daemon.stopped` logs `causeCode` when present, alongside `code`/`failedTeardowns`. Commit `b37b94c` ("phase56: emit daemon.stopped causeCode; window blocked, F-51-1 carried").
- **Harness reads it:** `test/support/rapid-stop-up.ts` exports `stopCauseOf` (cause capture: `causeCode`/`failedStep`/`captured`; row without either counts as **not captured**, never assumed) plus reused `classifyStop`/`stopRecordsOf`/`mergeTimeline`. No failed-step *name* is emitted by the product (recorded limitation; `causeCode` alone counts as captured).
- **Pre-change gap confirmed by read:** before this phase, `daemon.stopped` carried only `code`+`failedTeardowns`, so the three dirty stops of `51-EVIDENCE.md` §4 yielded `AGENTOS_STOP_FAILED` with no cause code — the gap this phase closed in code but could not exercise live.

## Live gate probe (reproduced, read-only)

```
su - realmlive -c 'openshell status'   →  Status: No gateway configured.
printenv | grep REALM_DRIVER          →  (none); realmlive: REALM_LIVE_*/REALM_DRIVER_* absent
```
Gate closed exactly as `56-WINDOW.md` recorded 2026-11-22. No dirty stop observed; nothing captured; no pass claimed. Consistent with PLAN step 2 (BLOCKING-human) and D-56-3.

## Resume command (carried part)

Once the `realmlive` account's stack is up (rootless Podman socket, `openshell-gateway` running, compute-driver unit with pinned image + driver config so gate variables are fillable), from a fresh build of this tree, as `realmlive` under the held shared live lock (`realm-evidence/live.lock`, serial vs Phases 57/58):

```bash
su - realmlive -c 'REALM_LIVE_PRODUCTION=1 REALM_LIVE_RAPID=1 REALM_RAPID_VARIANTS=c <window command>'
```

Then: every dirty stop must carry `causeCode` on its `daemon.stopped` row (readable by `stopCauseOf`); record the captured cause in `docs/integration/runtime-decision.md` replacing the inference (or re-carry with new evidence), fix/bound in the owning module with bounded waits, and run ≥20 consecutive variant-c iterations with `failedTeardowns` 0 and zero residue.

## Checks run (read-only; no builds/lint/format per assignment)

- Read: `56-CONTEXT.md`, `56-PLAN.md`, `56-EVIDENCE.md`, `56-WINDOW.md`, ROADMAP Phase 56 block (`ROADMAP.md:1211-1220`), `src/daemon/teardown.ts`, `src/daemon/daemon.ts` causeCode lines, `test/support/rapid-stop-up.ts` (skim).
- `git rev-parse --short HEAD` = `404da2b`; `git log --oneline -3` shows `b37b94c` as the phase commit.
- Gate probe above (`su - realmlive`, env list) — reproduced gate-closed.

_Verified: 2026-11-25 · Verifier: gsd-verifier (Verify56)_

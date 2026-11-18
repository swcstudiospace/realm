---
phase: 30-capability-token-spike
plan: "02"
status: executed
requirements: [CAPT-01]
---

# Plan 30-02 summary: results read against the frozen criteria; criteria outcome DROP; owner override to BUILD

Date: 2026-11-17. No production code, no test, no `package.json` and no lockfile changed. `ROADMAP.md`, `STATE.md` and `REQUIREMENTS.md` were not edited.

## Freeze check

Section 3 of the note, sha256 `535b8cd6fc72b1acc606d4836a15e98196b3390ac58883dd4c69e8ae729e81c0`, recomputed before any result was written: equal to the hash in section 1 of the note and to the hash in the plan 30-01 summary. Recomputed again after all edits: equal.

## Files changed

- `docs/integration/capability-token-spike.md`: status line (Decided, criteria outcome DROP, owner override BUILD); section 5 (E1 to E9 with the recorded values, one row each, no experiment "not run", no surprise); section 6 (prototype cost, Biscuit probe and redaction, delivery channels D1 to D4 with the M2 reading, integration inventory with totals and the M4 reading); section 7 (the eight readings, the derived outcome, the freeze-check line); section 8 (owner override, the limit, the proposed follow-up phase).
- `docs/integration/runtime-decision.md`: new section "Capability token spike (Phase 30, 2026-11-17)" with decision D30-1.
- `docs/integration/anda-replacement-research.md`: one outcome bullet at the end of the "Capability tokens" bullets of section 5.7.
- `.planning/phases/30-capability-token-spike/30-02-SUMMARY.md` and `30-VERIFICATION.md` (this phase's records).

## Criteria readings (as derived; not edited)

| ID | Reading | Evidence |
| --- | --- | --- |
| M1 | Not met | E3 and E4 (a same-uid reader obtains the token, root and uid 65534); E5 (only a different uid is refused, by file modes) |
| M2 | Not met | D1 fails the rule, D2 fails E3 and E4, D3 authenticates nothing, D4 unavailable |
| M3 | Met | E6, E7 (b): 0 dependencies, no flag for the chosen candidate; Biscuit would fail |
| M4 | Met (estimate) | about 13 production files, about 10 test files, 3 additive contract changes, 0 new error codes |
| M5 | Met | E1 (26 rows, 0 mismatches), E2 (6 pairs, 0 mismatches); the "no verbose reason" clause has no experiment |
| S1 | Met in the prototype | E9 |
| S2 | Met | E2 |
| S3 | Observed | E8 |

Rule: BUILD only if M1 to M5, S1 and S2 are all met. M1 and M2 are not met. **Criteria outcome: DROP.** This agrees with the prior in section 3 and is now measured.

## Owner decision (blocking checkpoint, answered)

On 2026-11-17 the owner reviewed the result and explicitly overrode the criteria outcome, directing a BUILD. Recorded as an owner override in section 8 of the note and in D30-1, beside the criteria outcome and without relabelling it. The criteria and their readings were not edited. The unmet criteria accepted by the direction: M1 and M2. No reason text accompanied the direction, so none is recorded beyond it.

The build, as proposed in section 8: Phase 32, capability tokens for stdio hosts, three plans (32-01 token module, frame key, daemon verification before dispatch, token AND policy, fail closed with `POLICY_DENIED`; 32-02 audit attribution, `rcap1.` redaction pattern, key rotation by kid; 32-03 policy posture key, doctor check, documentation, removal of the spike scripts), requirements CAPTB-01 to CAPTB-04, channel D3. It states what the build does not give: no defence against a same-uid reader of the token. The phase is proposed, not scheduled; the orchestrator registers it.

## D30-1 text (as appended to runtime-decision.md)

Owner decision, override of the criteria outcome. Criteria outcome DROP (M1 not demonstrated, M2 not met; criteria hash 535b8cd6fc72b1acc606d4836a15e98196b3390ac58883dd4c69e8ae729e81c0). The owner overrode it with a BUILD on 2026-11-17. Evidence: the note sections 5 to 8; E3 and E4 for the same-uid limit. Consequence: a follow-up phase is proposed and not scheduled; no production code in Phase 30; no defence against a same-uid reader.

## Checks run

- The criteria hash command: output equal to the recorded value (before the edits and after).
- `node scripts/check/host-paths.mjs`: `host paths: ok`.
- `git status --short`: the three documents of `files_modified`, the plan 30-01 summary and prototype directory (both from plan 30-01), and this plan's records. Nothing under `src`, `test`, `adapters`, `package.json` or a lockfile.
- Not run by the executor: `npm run check:docs`, a fresh `run.mjs` run, any build, test or lint (left to the parent per the plan).

## Residuals

- R-30-01: every same-uid observation covers one Linux kernel, one Node version (v24.18.0; v22.13.0 for the Biscuit import only), `ptrace_scope` 1.
- R-30-03: the integration inventory is an estimate from reading the code.
- The M5 clause "no verbose reason leaves the daemon" and the S1 claim rest on the prototype, not on a daemon.

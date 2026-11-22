---
phase: 30-capability-token-spike
verified: 2026-11-22
verdict: passed
status: passed
score: "1/1 requirement covered (CAPT-01); the claims rest on repository files read on 2026-11-17 and on the recorded results of plan 30-01, not on a re-run by the verifier; 4 items outside the evidence reach, listed as behavior_unverified"
ref: "worktree branch gsd/phase-30-exec1 on 63f89c0, uncommitted"
behavior_unverified: 4
overrides_applied: 1
covered_files:
  - ".planning/phases/30-capability-token-spike/30-CONTEXT.md"
  - ".planning/phases/30-capability-token-spike/30-01-PLAN.md"
  - ".planning/phases/30-capability-token-spike/30-01-SUMMARY.md"
  - ".planning/phases/30-capability-token-spike/30-02-PLAN.md"
  - ".planning/phases/30-capability-token-spike/30-02-SUMMARY.md"
  - "docs/integration/capability-token-spike.md"
  - "docs/integration/runtime-decision.md"
  - "docs/integration/anda-replacement-research.md"
  - "scripts/spike/capability-token/token.mjs"
  - "scripts/spike/capability-token/gate.mjs"
  - "scripts/spike/capability-token/run.mjs"
covered_digest: "v3:sha256:19399ba19ba7d9ca3b92f4f1f16edfa9b79cf0c162d5d7f4c81261773d087f97"
---

# Phase 30 Verification: Capability token spike

Method: read-only read of the worktree on 2026-11-17 (the design note sections 1 to 8, the plan 30-01 and 30-02 summaries, the D30-1 entry in `docs/integration/runtime-decision.md`, the outcome bullet in section 5.7 of `docs/integration/anda-replacement-research.md`, the line counts of the three prototype files), plus the criteria hash command and `node scripts/check/host-paths.mjs`. The experiments were not re-run by the verifier.

Rule recorded by this phase: the build or drop outcome follows only from the criteria frozen and hashed before any experiment; an owner who overrides it is recorded as an override and the criteria and readings are not edited. No code in `src` was written by this phase.

## Requirements coverage

| Req | Statement | Status | Evidence |
| --- | --- | --- | --- |
| CAPT-01 | A build or drop decision with evidence: threat model, same-user limits, cost, and a recorded decision | SATISFIED by repository evidence | The note holds the threat model (section 2), the criteria and their hash (section 3, hash `535b8cd6fc72b1acc606d4836a15e98196b3390ac58883dd4c69e8ae729e81c0`, recomputed equal), the candidates and delivery channels (section 4), nine experiment rows with the recorded values (section 5), the cost and the integration inventory (section 6), the eight readings and the derived criteria outcome DROP (section 7), and the owner override to BUILD with the proposed follow-up phase and the limit (section 8). D30-1 is registered in `runtime-decision.md`. The research note section 5.7 has its one outcome line. |

"Satisfied by repository evidence" means the artifacts exist with the content described. It does not mean the verifier ran the experiments.

## Key facts checked

- The criteria outcome is DROP: M1 (no attacker class that a token stops and today's model admits; E3 and E4 show a same-uid reader obtains the token) and M2 (no delivery channel is both admitted and meaningful) are not met. M3, M4 (an estimate), M5, S1 and S2 are met; S3 is observed.
- The owner reviewed the result on 2026-11-17 and overrode the criteria outcome with a BUILD. The override is recorded as "owner override" in section 8 of the note and in D30-1, beside the criteria outcome; the outcome was not relabelled as BUILD and no criterion or reading was edited. No reason text accompanied the direction and none is recorded.
- The build is proposed (Phase 32, capability tokens for stdio hosts, three plans, requirements CAPTB-01 to CAPTB-04, channel D3) and is not scheduled; `ROADMAP.md`, `STATE.md` and `REQUIREMENTS.md` were not edited by this phase.
- The note states what the build does not give: no defence against a same-uid reader of the token, nor of the environment or memory of the process that holds it.
- The prototype is three files of 62, 38 and 299 lines, Node built-ins only, outside `src`, not packaged. No file under `src`, `test`, `adapters`, `package.json` or a lockfile changed.
- The path check printed `host paths: ok`.

## behavior_unverified

1. **The prototype is not shipped.** The token, the gate and the audit-attribution behavior exist only as a throwaway harness. No daemon, no control frame, no dispatcher or audit code carries a token, so the M5 clause "no verbose reason leaves the daemon" and the attribution claim (S1) were not exercised against Realm itself.
2. **The experiments ran on one kernel and one Node version.** Linux 6.8, Node v24.18.0, harness uid 0 with uid 65534 for the non-root pair, `ptrace_scope` 1; the Biscuit import was also tried on Node v22.13.0 and nowhere else. Other kernels, `hidepid` mounts, non-dumpable processes and a reader confined by a host's own sandbox were not modelled.
3. **The M1 outcome versus the owner override.** By the frozen criteria the outcome is DROP; the BUILD rests on the owner's decision, not on a measured gain against an attacker. Whether the per-host ceiling and the verified attribution justify the cost for a user, given channel D3 authenticates nothing against a same-uid process that can start `realm mcp --host OTHER`, is the owner's judgement and is not verified here.
4. **No code in `src` was written or tested.** The integration inventory (about 13 production files, about 10 test files, 3 additive contract changes, 0 new error codes) is an estimate from reading the code, not from building it.

## Residuals (not verdict-blocking)

- **R1: planning bookkeeping.** This verification does not edit `ROADMAP.md`, `STATE.md` or `REQUIREMENTS.md`; closing CAPT-01 and registering the proposed follow-up phase are the orchestrator's steps, after the owner schedules it.
- **R2: the default posture of the build** (opt-in per workspace policy or mandatory for every host, OQ-30-03) is left to the owner as the first task of the proposed phase.
- **R3: the parent's verification commands were not run by the executor:** `npm run check:docs`, a fresh `node scripts/spike/capability-token/run.mjs --work SCRATCH`, and lint of the prototype directory.

## Verdict

passed: the design note, the recorded experiments and their reading against the frozen criteria, the criteria outcome (DROP) and the owner override (BUILD) as separate records, decision D30-1 and the research pointer exist; the criteria hash is unchanged; no production code was written. Nothing in the phase is FAILED. The four items above are not proven and must not be claimed beyond what is stated; in particular nothing here says the token stops a same-uid attacker, and the BUILD is an owner override of the criteria outcome.


## Re-verification at main 7ae9afc (2026-11-22, autonomous)

Full local suite executed on main 7ae9afc: 5945 tests, 5849 pass, 0 fail, 96 skipped (Podman-gated). Prior verdict (passed) stands; covered files changed only by later merged phases.

_Re-verifier: Omp (main session)_

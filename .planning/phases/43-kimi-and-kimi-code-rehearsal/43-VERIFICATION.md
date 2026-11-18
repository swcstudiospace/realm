---
phase: 43-kimi-and-kimi-code-rehearsal
verified: 2026-11-18
verdict: passed
status: passed
score: "2/2 requirements covered (KIMI-01, KIMI-02): KIMI-01 met (both CLIs installed outside the repository and run, four results recorded with version and date: three passes and one failure); KIMI-02 met as recording (no blocker applied, GAP-24-02 narrowed, the support matrix and the wave 1 page state the tier reached); the legacy kimi production tier FAILED and is carried as GAP-43-03, not as a pass"
ref: "origin/main 8c4c62b (plan 43-01 wiring), plus the recording change that carries this file"
behavior_unverified: 5
overrides_applied: 0
covered_files:
  - ".planning/phases/43-kimi-and-kimi-code-rehearsal/43-CONTEXT.md"
  - ".planning/phases/43-kimi-and-kimi-code-rehearsal/43-01-PLAN.md"
  - ".planning/phases/43-kimi-and-kimi-code-rehearsal/43-01-SUMMARY.md"
  - ".planning/phases/43-kimi-and-kimi-code-rehearsal/43-02-PLAN.md"
  - ".planning/phases/43-kimi-and-kimi-code-rehearsal/43-02-SUMMARY.md"
  - "test/support/host-live.ts"
  - "test/support/host-live-session.ts"
  - "test/support/host-live-kimi.ts"
  - "test/support/host-registry.ts"
  - "test/integration/host-live-kimi.test.ts"
  - "test/integration/host-live-kimi-code.test.ts"
  - "test/integration/host-live-kimi-helpers.test.ts"
  - "test/docs/host-gaps.test.ts"
  - "docs/integration/wave1-boot-matrix.md"
  - "docs/integration/host-support-matrix.md"
  - "docs/integration/host-plugin-gaps.md"
  - "docs/integration/host-plugin-contract.md"
  - "docs/integration/hosts.md"
  - "docs/hosts/snippets/kimi.md"
---

# Phase 43 Verification: Kimi and Kimi Code rehearsal

Method: a read of the files above on the recording branch, against the requirement statements KIMI-01 and KIMI-02 and the truths of plans 43-01 and 43-02, on 2026-11-18. The live results are copied from the window's evidence (kept outside the repository; this file names no path of it). The tests of the window were run by a person on the `realmlive` account; no agent ran them.

What this phase is, stated once: an evidence phase. Plan 43-01 gave the two Kimi hosts their live wiring (test support only). Plan 43-02 installed both CLIs outside the repository, ran the validator and production tiers cold on the production stack, and recorded the results.

## Requirements coverage

| Req | Statement | Status | Evidence |
| --- | --- | --- | --- |
| KIMI-01 | Both Kimi CLIs are installed outside the repository and their validator and production tiers are run, each result with version and date | MET | Kimi Code 2.6.3 and kimi-cli 1.51.0 installed with integrity facts (`43-02-SUMMARY.md`); five of six tests passed on 2026-11-18: Kimi Code 3 of 3, the legacy kimi validator 2 of 2; the legacy kimi production tier failed and is recorded as failed, not as a pass (`test/support/host-registry.ts`, `docs/integration/wave1-boot-matrix.md`) |
| KIMI-02 | Whatever cannot run has a named blocker, and GAP-24-02 and the support matrix state the tier reached | MET, with one open finding | no blocker of D-43-09 applied; GAP-24-02 is narrowed with the tier reached per host; GAP-43-01, GAP-43-02 and GAP-43-03 are on `docs/integration/host-plugin-gaps.md`; the generated block of `docs/integration/host-support-matrix.md` carries both rows. The legacy production failure is a finding, so "met" does not mean the legacy CLI boots Realm |

## Key facts checked

- The registry t3 of `kimi` is a gap whose note starts `rehearsal failed`, and the wave 1 page row says `failed`; the t3 of `kimi-code` is `rehearsed` (`test/docs/wave1-boot-matrix.test.ts` ties them).
- Kimi Code 2.6.3: the `kimi -p` session launched `realm mcp --host kimi-code` before any model request; the wire shows `initialize`, `notifications/initialized`, `tools/list` and the six tools; the provider saw 6 requests, all with the one fixed placeholder key, from loopback peers. Kimi Code forwards its whole environment to the server, so the placeholder key name reaches `realm mcp`.
- Legacy kimi 1.51.0: `kimi mcp test realm` exited 0 after 18225 ms (below the 25000 ms bound), sent `tools/list`, and the recorder saw no tool names; it forwards only `HOME` and `PATH` to a stdio server, so the recorder restored three names.
- The stack was clean before and after the window.

## behavior_unverified

1. **Why the legacy kimi production tier failed (GAP-43-03).** Not established. [INFERENCE] The response to `tools/list` was either not written before kimi closed the connection or was an error response; the recorder summary cannot tell. The window kept no wire log and no full command output.
2. **Whether a real user of the legacy CLI reaches a non-default stack (GAP-43-01).** Not shown: the recipe writes no `env` block, and the production run restored the three names inside the recorder. OQ-43-03 is the owner question.
3. **The network use of both CLIs in the production tiers (GAP-43-02).** Not measured; only the documented switches were set. Accepted residual.
4. **No model turn and no tool call through either product (GAP-31-02).** The sessions list tools and nothing more.
5. **One version of each CLI on one machine (GAP-31-03).** And the intermediate stack residue: one container, one sandbox and one daemon were seen after the failed legacy run and gone by the next snapshot; the step that removed them is not in the evidence read [INFERENCE: cleanup or a `realm down`].

## Residuals (not verdict-blocking)

- **R1: planning bookkeeping.** This verification does not edit `ROADMAP.md`, `STATE.md` or `REQUIREMENTS.md`; registering KIMI-01 and KIMI-02 is the orchestrator's step.
- **R2: the scratch installs** (a scratch directory under the system optional-software directory) are removed by the orchestrator after this recording; they are not part of the repository.
- **R3: the legacy product is archived.** Its failure is not expected to be fixed upstream; dropping the row is the owner's decision (OQ-24-01).
- **R4: one test bound changed.** `test/docs/host-gaps.test.ts` accepted gap ids of phases 21 to 34 only; the bound is now 43, with every other check unchanged.

## Verdict

passed, with KIMI-01 and KIMI-02 met as evidence and recording: Kimi Code 2.6.3 is rehearsed (validator as a session proof, production cold), and the legacy kimi 1.51.0 passed its validator tier and failed its production tier with an unestablished cause, carried as an open gap. Kimi Code is the supported product; the legacy CLI is archived.

---
phase: 31-production-stack-boot-rehearsals-for-wave-1-hosts
verified: 2026-11-18
verdict: passed
status: passed
score: "BOOTP-02 met; BOOTP-01 met for claude and codex (production tier passed on 2026-11-18 for both); opencode rehearsed beyond the requirement; the live results rest on a human-owned window whose evidence is kept outside the repository, not on a run by the verifier; 7 items outside the evidence reach, listed as behavior_unverified"
ref: "origin/main efa7847 (the production tier accepts the modern handshake) plus this closure"
behavior_unverified: 7
overrides_applied: 0
covered_files:
  - ".planning/phases/31-production-stack-boot-rehearsals-for-wave-1-hosts/31-CONTEXT.md"
  - ".planning/phases/31-production-stack-boot-rehearsals-for-wave-1-hosts/31-01-PLAN.md"
  - ".planning/phases/31-production-stack-boot-rehearsals-for-wave-1-hosts/31-01-SUMMARY.md"
  - ".planning/phases/31-production-stack-boot-rehearsals-for-wave-1-hosts/31-02-PLAN.md"
  - ".planning/phases/31-production-stack-boot-rehearsals-for-wave-1-hosts/31-02-SUMMARY.md"
  - "test/support/host-live-session.ts"
  - "test/support/host-live.ts"
  - "test/support/host-registry.ts"
  - "test/integration/host-live-session-helpers.test.ts"
  - "test/integration/host-live-claude.test.ts"
  - "test/integration/host-live-codex.test.ts"
  - "test/integration/host-live-opencode.test.ts"
  - "test/docs/wave1-boot-matrix.test.ts"
  - "docs/integration/wave1-boot-matrix.md"
  - "docs/integration/host-plugin-gaps.md"
  - "docs/integration/host-support-matrix.md"
  - "docs/integration/host-plugin-contract.md"
  - "docs/hosts/snippets/claude-code.md"
  - "docs/hosts/snippets/codex.md"
  - "docs/hosts/snippets/opencode.md"
  - "docs/hosts/snippets/kimi.md"
covered_digest: "v3:sha256:78773e8e355a5b2c80c1d412c95f08c049a4e1beb482e641c9900814b13a3382"
---

# Phase 31 Verification: production-stack boot rehearsals for wave 1 hosts

Method: a read of the files above on `origin/main` after `efa7847`, together with the results the human-owned live windows reported (2026-11-18: 8 of 8 passed for claude and opencode, 5 of 5 for codex). The verifier did not run the live tests, the build or CI; the live evidence is kept outside the repository and is not reproduced here. Nothing under `src` changed in this phase.

## Requirements coverage

The definitions are in `31-CONTEXT.md`, "Requirement IDs".

| Req | Statement (31-CONTEXT) | Status | Evidence |
| --- | --- | --- | --- |
| BOOTP-01 | Each wave 1 host that can run here (claude, codex; others named) is booted through its own CLI against the production stack, and Realm tools are listed or called, with results recorded | MET (claude and codex); opencode extra | claude 2.1.322: the production tier passed on 2026-11-18 (rootless Podman 5.7.1 account, warm session); `claude mcp list` connected, the recorder shows `server/discover` then `tools/list` and the six Realm tools, `realm status` active, clean before and after; recorded in `test/support/host-registry.ts` (`rehearsed`) and `docs/integration/wave1-boot-matrix.md`. codex-cli 0.154.0: the production tier passed on 2026-11-18 (window 9, 5 of 5 tests: validator 2, validator session 2, production 1) after the exit-race fix in the closure change; `codex exec` against the refusing loopback provider launched `realm mcp --host codex`, the recorder showed initialize, notifications/initialized and tools/list and the six Realm tools, the stack was clean before and after; the validator session rehearsal of 2026-11-17 (2 of 2) stands; the registry holds `rehearsed`. opencode 1.19.5 (a named host that was not required to run): the production tier passed on 2026-11-18 from an owner-approved scratch install. "Called" was never attempted: listing only (D-31-07, OQ-31-04) |
| BOOTP-02 | Hosts that cannot be booted (missing CLI, no credentials, archived) have a named gap in `docs/integration/host-plugin-gaps.md` | MET | `kimi` (archived Python CLI, deprecation stub) and `kimi-code` (functional, not installed here, no MCP validator documented; installing it needs an owner decision) are in GAP-24-02 with the real reason and a lift condition; GAP-24-01 (opencode) is narrowed now that it ran; GAP-31-01 to GAP-31-04 are named; `test/docs/host-gaps.test.ts` and `test/docs/wave1-boot-matrix.test.ts` check the table shape and tie each matrix row to the registry |

"Met" is a claim about the repository and the reported windows. It is not a statement that the verifier booted a host.

## Key facts checked

- The registry records claude, codex and opencode as `rehearsed` with date 2026-11-18 and the versions 2.1.322, 0.154.0 and 1.19.5, and kimi and kimi-code as `gap`.
- The wave 1 boot matrix rows match the registry; the matrix test requires a date and a version on a `rehearsed` row and none on a `not-run` row.
- The generated block of the support matrix and the contract page and snippets state the same results; the warm-session requirement is stated in each (GAP-31-04).
- The production tier warms the session with `realm up --workspace` using the production PATH, runs the host with the production PATH ahead of the host directory, accepts `initialize` or `server/discover` as the handshake, and its cleanup runs every step and uninstalls the recipe.

## behavior_unverified

1. **kimi and kimi-code were not run.** `kimi` is archived and cannot run a session; Kimi Code was not installed (an owner decision, GAP-24-02) and documents no non-interactive MCP validator.
2. **A cold first attach is not shown to pass (GAP-31-04, open).** The cold sandbox creation (about 35 to 60 s) exceeds the hosts' connect timeouts (OpenCode 30 s; Claude's probe gave up). Only a warm attach passed. A later phase must answer before `up` finishes (serve-early) or document running `realm up` first. This phase changes no product code.
3. **One version per host, one machine, a warm stack.** claude 2.1.322, opencode 1.19.5 and codex-cli 0.154.0 only; a second version and a second machine were not run (GAP-31-03, GAP-22-02, GAP-22-03, GAP-23-02).
4. **The live evidence is kept outside the repository.** The windows' counts (8 of 8, clean before and after) are reported, not reproduced by files here.
5. **No model turn and no tool call ran.** The session drive lists tools only (GAP-31-02); the codex environment finding (only `HOME`, `LANG` and `PATH` reach a stdio server by default) is observed, and its consequence for a real user is inferred (GAP-31-01).
6. **OpenCode's tool listing is not asserted.** The wire was recorded and `opencode mcp list` reported realm connected; the assertion on the six tools is only for claude and codex.
7. **A stale daemon hazard was observed, not fixed.** A daemon left running from an earlier stub-PATH run kept answering `PODMAN_MISSING` until it was stopped; a host that starts the daemon from a minimal PATH is a related hazard (recorded in GAP-31-04).

## Residuals (not verdict-blocking)

- **R1: planning bookkeeping.** This verification does not edit `ROADMAP.md`, `STATE.md` or `REQUIREMENTS.md`; marking BOOTP-02 satisfied and BOOTP-01 partial is the orchestrator's step.
- **R2: the OpenCode scratch install is outside the repository** and is not reproducible from it (owner approved; GAP-24-01 says what would lift it).
- **R3: the wave 2 hosts have no production tier** by owner decision (GAP-25-07).

## Verdict

passed, with BOOTP-01 and BOOTP-02 met: the harness, the recorder, the named gaps and the boot matrix exist on `main`, claude and opencode have dated production-stack results with version and date, codex has a dated production-stack result (after the exit-race fix) beside its validator session rehearsal, and kimi and kimi-code are named gaps with reasons and lift conditions. Nothing in the phase is FAILED. The seven items above are not proven and must not be claimed beyond what is stated; in particular nothing here says a cold first attach works, or that any host called a Realm tool.

---
phase: 33-cold-attach
verified: 2026-11-18
verdict: passed
status: passed
score: "4/4 requirements covered (COLD-01 to COLD-04), met by repository evidence and the dated live cold window of 2026-11-18 on the production stack (14 of 14 tests passed); the real hosts were shown to connect cold within the bound and list the six tools, and the transition to a ready session on one connection was shown by the direct probe, not by a real host; 7 items outside the evidence reach, listed as behavior_unverified"
ref: "origin/main dbdbf23 (PR 169, after PR 163 1d7d6d9, PR 164 77922ea, PR 166 1b0b077 and PR 167 439e9eb), plus the recording change that carries this file"
behavior_unverified: 7
overrides_applied: 0
covered_files:
  - ".planning/phases/33-cold-attach/33-CONTEXT.md"
  - ".planning/phases/33-cold-attach/33-01-PLAN.md"
  - ".planning/phases/33-cold-attach/33-01-SUMMARY.md"
  - ".planning/phases/33-cold-attach/33-02-PLAN.md"
  - ".planning/phases/33-cold-attach/33-02-SUMMARY.md"
  - ".planning/phases/33-cold-attach/33-03-PLAN.md"
  - ".planning/phases/33-cold-attach/33-03-SUMMARY.md"
  - "src/cli/stdio-host.ts"
  - "src/cli/stdio-settle.ts"
  - "src/host/boot-driver.ts"
  - "scripts/check/mcp-smoke.mjs"
  - "test/cli/stdio-cold-attach.test.ts"
  - "test/cli/stdio-settle.test.ts"
  - "test/daemon/cold-attach-e2e.test.ts"
  - "test/daemon/up-disconnect.test.ts"
  - "test/host/boot-driver.test.ts"
  - "test/support/host-live.ts"
  - "test/support/cold-attach-probe.ts"
  - "test/integration/cold-attach-live.test.ts"
  - "test/integration/cold-attach-probe-helpers.test.ts"
  - "test/integration/host-live-helpers.test.ts"
  - "test/integration/host-live-claude.test.ts"
  - "test/integration/host-live-opencode.test.ts"
  - "test/integration/host-live-codex.test.ts"
  - "test/support/host-registry.ts"
  - "docs/integration/mcp.md"
  - "docs/integration/wave1-boot-matrix.md"
  - "docs/integration/host-support-matrix.md"
  - "docs/integration/host-plugin-gaps.md"
  - "docs/integration/host-plugin-contract.md"
  - "docs/hosts/snippets/claude-code.md"
  - "docs/hosts/snippets/codex.md"
  - "docs/hosts/snippets/opencode.md"
covered_digest: "v3:sha256:5fec6c4138c8fbfd5dbe1b1b29721f11677733fd8b51d03db6ff41d54f305d96"
---

# Phase 33 Verification: cold attach

Method: a read of the files above on `origin/main` after PR 169 (`dbdbf23`), against the requirement statements in `.planning/REQUIREMENTS.md` (COLD-01 to COLD-04) and the plans' truths, on 2026-11-18. The live results were taken from the owner-run window's evidence, which is kept outside the repository and was reported to the recording task; the verifier ran no live step and no build of its own for the live claims. For the docs the recording task built the tree and ran the docs and registry tests (`dist/test/docs/*.test.js` and `dist/test/host/host-registry.test.js`, with the support matrix regenerated through `REALM_WRITE_HOST_MATRIX=1`), `check:docs` and the host-paths check.

What this phase is, stated once: `realm mcp` serves its MCP handshake and `tools/list` at once and boots behind a not-active gate (every tool call is refused `REALM_NOT_ACTIVE`, retryable, until the driver has adopted a verified client), the same connection forwards calls afterwards, and the production tiers of claude, opencode and codex attach cold with the warm-up removed.

## Requirements coverage

| Req | Statement | Status | Evidence |
| --- | --- | --- | --- |
| COLD-01 | `realm mcp` answers the handshake (`initialize`, `server/discover`, `tools/list`) before `ensure` and `up` complete, so a host with a 30 s connect timeout connects on a cold start | MET | `src/cli/stdio-host.ts` (the server is created right after resolve; steps 2 to 5 run behind it); hermetic: `test/cli/stdio-cold-attach.test.ts`, `test/daemon/cold-attach-e2e.test.ts`. Live, 2026-11-18, no warm-up: the direct probe saw all three replies at 500 ms (an earlier run 285 ms) against a 10000 ms bound while `realm status` was not active; claude 2.1.322, opencode 1.19.5 and codex-cli 0.154.0 connected cold after 2438 ms, 2155 ms and 896 ms against the 25000 ms bound (below OpenCode's 30 s). Before the change the first answer took 35 to 60 s |
| COLD-02 | Until ready the realm is reported not active and every tool call is refused with the existing not-active refusal (fail closed); once ready, tools work on the same connection | MET | `src/cli/stdio-host.ts`, `src/host/boot-driver.ts`, `src/cli/stdio-settle.ts`; hermetic as above and `test/cli/stdio-settle.test.ts`. Live: the probe (`test/integration/cold-attach-live.test.ts`) saw `realm status` not active at reply time, 5 calls refused `REALM_NOT_ACTIVE` with `retryable` true (the last at 6918 ms), the first success at 8982 ms after 4 status polls on the same process, a `list` of the workspace root done at 8995 ms, one attached boot report, and a clean exit after the input closed. The probe, not a real host, shows this transition; its host id is `claude` and it uses no recipe and no host binary |
| COLD-03 | The warm path does not regress and the status and audit contracts are unchanged; tests assert the not-active window, the transition and the refusal in between | MET (hermetic) | the existing contract, equivalence and capability end-to-end suites hold after the change (`test/cli/stdio-host.test.ts`, `test/cli/stdio-host-matrix.test.ts`, `test/daemon/capability-e2e.test.ts`), no file under `src/daemon`, `src/audit`, `src/core`, `src/contract`, `src/capability`, `src/tools`, `src/omp` or `src/acp` changed, the catalogue still has 29 codes; the window, the transition and the refusal in between are asserted in `test/cli/stdio-cold-attach.test.ts` and `test/daemon/cold-attach-e2e.test.ts`. No live warm-path run was made after the change, because the live window removed the warm-up |
| COLD-04 | The claude, opencode and codex production tiers pass on the live stack from a cold start with the warm-up removed from `test/support/host-live.ts`; GAP-31-04 is closed with the evidence | MET, as worded | the warm-up is gone and a static test keeps it gone (`test/integration/host-live-helpers.test.ts`); window 3 (14 of 14 passed; account `realmlive`, rootless Podman 5.7.1; clean before and after: 0 containers, 0 sandboxes, an empty workspace) passed the three production tiers cold; GAP-31-04 and GAP-23-02 are closed in `docs/integration/host-plugin-gaps.md` with the dated runs. What the tiers assert is a bounded connect, the realm line `connected` and the six tools on the wire; they do not assert that the realm became ready, because a health check exits before then, by design (below) |

"Met" for COLD-04 does not mean a real host made a tool call through the not-active window, and does not mean the realm was active after a health check left.

## Run history

| Run | Outcome | What it found |
| --- | --- | --- |
| Earlier warm windows (before this phase's code) | passed with a warm-up | the cold first attach exceeded the host connect timeout (GAP-31-04); the production tier had to warm the session |
| Earlier cold windows, after PR 166 | failed | the probe's `list` call needed its required `depth` argument (fixed in PR 167); the host tiers' original criterion was wrong: they required `realm status` active and an attached boot report after the host left, but a health check exits before the realm is ready and its child `realm mcp` is stopped during ensure and up, so status stayed unbound or the daemon was absent (fixed in PR 169, which asserts the bounded connect and the six tools); an interrupted run left the shared host receipt behind and the next gate refused it |
| Window 3, `main` after PRs 166 to 169 | passed, 14 of 14 | the results in the coverage table |

The covered digest is recorded in the frontmatter.

## Key facts checked

- The not-active gate is the driver's local refusal: a call made before a verified client is adopted makes no daemon request, no audit line and no metric, and is never queued; a `retry` while an attempt is in flight starts no second attempt (`src/host/boot-driver.ts`, `test/host/boot-driver.test.ts`).
- The outcome of a settled boot is one stderr diagnostic and, at stdin end, exit 1 only when no client was ever adopted and the boot failed (`src/cli/stdio-settle.ts`).
- The ACP branch is unchanged and still answers only after the boot settles; `docs/integration/acp.md` and the contract page say so.
- The production tier no longer runs `realm up` (`test/support/host-live.ts`, with its static guard), tolerates a `realm down` on an absent daemon (`downAcceptable`), and removes the recipe, the receipt and the presence directory in a finally-based cleanup; the operator's real host file is asserted byte-identical.
- The registry notes, the generated support matrix, the boot matrix, the gaps page, the contract rehearsal rows and the three host snippets agree on the dated cold result; the warm records stay as dated history. GAP-31-03 and GAP-22-02 are narrowed, not closed.

## behavior_unverified

1. **No real host made a tool call through the window.** The window refusal, its `retryable` flag and the same-connection transition are shown by the direct probe over its own connection; whether a real host's model retries a refused call (OQ-33-03) is not shown. No model turn ran (GAP-31-02).
2. **A health check leaves before the realm is ready.** In the live host tiers the host exited before readiness and `realm status` stayed unbound or the daemon was absent afterwards. The hermetic daemon test pins that the daemon completes an `up` whose client disconnected, but the live cause of the absent or unbound state when the process is stopped during ensure and up was not investigated. A health check cannot be relied on to leave a ready session.
3. **A cold image pull is not shown.** The digest-pinned image was present in every run (GAP-22-02, narrowed).
4. **One machine and one version per host.** claude 2.1.322, opencode 1.19.5, codex-cli 0.154.0, one Podman 5.7.1 account (GAP-31-03, narrowed; GAP-22-03 open).
5. **`realm acp` is unchanged.** An ACP host on a cold first boot can still wait up to the 230 s `up` bound for its first reply; no real ACP host's timeout was measured.
6. **kimi and kimi-code did not run.** `kimi` is archived and Kimi Code needs an owner decision (GAP-24-02).
7. **A stale daemon is a hazard.** A daemon left running from an earlier run with a stub `PATH` kept answering `PODMAN_MISSING` until it was stopped, and a host that starts the daemon from a minimal `PATH` is a related hazard; this is recorded on the gaps page as an observation and was not changed.

## Residuals (not verdict-blocking)

- **R1: planning bookkeeping.** This verification does not edit `ROADMAP.md`, `STATE.md` or `REQUIREMENTS.md`; registering COLD-01 to COLD-04 as satisfied is the orchestrator's step.
- **R2: Task 7 of plan 33-03.** The final gate sweep as a non-root user (typecheck, lint, build, the full test run, the script tests and the gates) is not recorded by this verification; the live window ran as the `realmlive` account and the docs and registry tests above were run by the recording task as the build user.
- **R3: the scope of the host-tier proof.** The three tiers are connect-and-list proofs; the readiness proof is one probe on one host id. If a later phase needs a real host's session through the window, it needs a scripted provider that makes a host call a tool (a deferred idea).

## Verdict

passed, with COLD-01 to COLD-04 met: `realm mcp` answers the handshake at once and refuses calls until ready (500 ms and 285 ms live, against a 35 to 60 s first answer before), the same connection serves after ready (the probe: first success at 8982 ms on the same process), and the claude, opencode and codex production tiers connect cold within the 25000 ms bound with the warm-up removed. GAP-31-04 and GAP-23-02 are closed on that dated evidence; GAP-31-03 and GAP-22-02 are narrowed. The seven unverified items above stay open and are stated, not hidden.

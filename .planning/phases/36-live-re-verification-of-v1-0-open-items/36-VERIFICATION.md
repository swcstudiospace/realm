---
phase: 36-live-re-verification-of-v1-0-open-items
verified: 2026-11-18
verdict: passed
status: passed
score: "2/2 requirements covered (V1LIVE-01, V1LIVE-02): V1LIVE-01 met with one item carried by a named reason (OI-11, the Omp cold-attach responsiveness, not measured because the host was not quiet), V1LIVE-02 met (14 of 14 items have a final label); the live steps ran on 2026-11-18 on the production stack and are copied from evidence kept outside the repository; 7 items outside the evidence reach, listed as behavior_unverified"
ref: "origin/main 04ca807 (PR 176, after PR 172 7c44538, PR 174 c9130d1 and the Phase 36 plan 01 and 02 merges), plus the recording change that carries this file"
behavior_unverified: 7
overrides_applied: 0
covered_files:
  - ".planning/phases/36-live-re-verification-of-v1-0-open-items/36-CONTEXT.md"
  - ".planning/phases/36-live-re-verification-of-v1-0-open-items/36-01-PLAN.md"
  - ".planning/phases/36-live-re-verification-of-v1-0-open-items/36-01-SUMMARY.md"
  - ".planning/phases/36-live-re-verification-of-v1-0-open-items/36-02-PLAN.md"
  - ".planning/phases/36-live-re-verification-of-v1-0-open-items/36-02-SUMMARY.md"
  - ".planning/phases/36-live-re-verification-of-v1-0-open-items/36-03-PLAN.md"
  - ".planning/phases/36-live-re-verification-of-v1-0-open-items/36-03-SUMMARY.md"
  - ".planning/phases/36-live-re-verification-of-v1-0-open-items/36-DISPOSITIONS.md"
  - "test/support/host-live-muse.ts"
  - "test/integration/host-live-muse-helpers.test.ts"
  - "test/integration/host-live-muse.test.ts"
  - "test/support/host-live.ts"
  - "test/support/host-live-wave2.ts"
  - "test/integration/host-live-helpers.test.ts"
  - "test/integration/host-live-wave2.test.ts"
  - "test/support/responsiveness.ts"
  - "test/support/responsiveness.test.ts"
  - "test/integration/omp-responsiveness.test.ts"
  - "test/integration/live-closeout.test.ts"
  - "test/integration/production-driver.test.ts"
  - "test/support/host-registry.ts"
  - "docs/integration/openshell.md"
  - "docs/integration/runtime-decision.md"
  - "docs/integration/omp.md"
  - "docs/integration/hosts.md"
  - "docs/integration/host-plugin-gaps.md"
  - "docs/integration/host-support-matrix.md"
  - "docs/hosts/snippets/muse-code.md"
  - "docs/hosts/snippets/hermes-agent.md"
covered_digest: "v3:sha256:f4d361abab585bd2b7a62f422aade7768d544fe2da6aaf96991479ed9b60680f"
---

# Phase 36 Verification: live re-verification of the v1.0 open items

Method: a read of the files above on `origin/main` after PR 176 (`04ca807`), against the requirement statements in `.planning/REQUIREMENTS.md` (V1LIVE-01 and V1LIVE-02) and the plans' truths, on 2026-11-18. The live results are copied from the owner-authorized window's evidence (three runs on the production stack as the realm account, rootless Podman 5.7.1, under the shared live lock), which is kept outside the repository and was reported to the recording task, and from the Plan 36-01 and 36-02 summaries. The verifier read those records; it ran no live step. The recording task ran the build, the docs and registry tests and the docs scripts (below).

What this phase is, stated once: an evidence phase. It added three gated tests with their helpers (Muse Code, the Omp responsiveness measurement) and a repair of the Hermes gate (test support only), ran the live checks this host can run, and recorded every one of the 14 open items of the v1.0 re-verification with a final label. It changed no file under `src` and no product behaviour. A defect the runs expose is a finding, never a patch inside this phase.

## Requirements coverage

| Req | Statement | Status | Evidence |
| --- | --- | --- | --- |
| V1LIVE-01 | The v1.0 live items this host can run are re-verified, each with dated evidence kept outside the repository and recorded in the phase, or carried with a named reason: the doctor and control-socket live modes, the two reaper live checks, Muse Code and Hermes loading, Omp responsiveness | MET, with OI-11 carried | Doctor (OI-05): live closeout A passed 1 of 1 (run 1). Control socket (OI-06): live closeout B passed 1 of 1 (run 1; modes 700 and 600, socket removed after down). Hung-exec timeout (OI-10): live closeout C passed 1 of 1 (run 3; two harness failures first, see Findings). Reaper (OI-09): production live 11 passed 1 of 1 (run 1) and production live 5 passed 1 of 1 (run 3). Muse Code (OI-07): validator tier passed 1 of 1 (Plan 36-01, Muse Code 1.4.23). Hermes (OI-08): the gate was repaired and the wave 2 hermes scenario passed (Plan 36-01, Hermes Agent 0.23.1). Omp responsiveness (OI-11): CARRIED, the cold-attach test refused to run on three tries because the host was not quiet (1.67, 0.76 and 1.47 load per CPU, bound 0.5); the loaded mechanics baseline (41 probes, none unanswered, maximum 114 ms) is not a measurement. Also re-verified or closed in Plan 36-02: OI-12 closed by test, OI-14 re-verified (145 registry signatures, 39 attestations, 10 of 10 tarballs equal). Records: `.planning/phases/36-live-re-verification-of-v1-0-open-items/36-DISPOSITIONS.md`, `36-01-SUMMARY.md`, `36-02-SUMMARY.md`, `36-03-SUMMARY.md` |
| V1LIVE-02 | The Anda live handshake and licence items are closed as dropped by owner decision D-27-01, and the v1.0 open-item list is reconciled so that no item is left without a status | MET | `36-DISPOSITIONS.md`: OI-01 to OI-03 Dropped (D-27-01), OI-04 Closed: moot, not resolved (no legal determination), and Part C, which lists all 14 items with their final labels and the count by label (Dropped 3, Closed: moot 1, Re-verified 6, Re-verified current contract form 1, Closed by test 1, Carried 1, Needs the owner 1); no row reads Pending |

"Met" for V1LIVE-01 does not mean Omp responsiveness was measured: it was not, and the item is carried with its reason. It does not mean OI-13 is decided: that item needs the owner. The status of UI-01 is not changed by this phase.

## Run history

The window was authorized by the owner on 2026-11-18, run by a person as the `realmlive` account under the shared live lock, one test at a time, in three runs.

1. **Run 1 (about 06:39 UTC), main at `dbdbf23`.** Live closeout A, B and production live 11 passed. Live closeout C and production live 5 failed: the live suites called a tool before the serve-early session was ready (`REALM_NOT_ACTIVE`).
2. **Run 2 (about 06:52 UTC), main after PR 172 (`waitUntilServed`).** Live closeout C and production live 5 failed again: the status call waited for the served session and was then refused `POLICY_DENIED`, because the live session carried no host label under capability-token enforcement.
3. **Run 3 (about 07:08 UTC), main at `04ca807`, after PR 174 (the `--host claude` label in `startMcpSession`).** Live closeout C and production live 5 passed 1 of 1 each.
4. **The Omp cold-attach test (step E)** refused to run in all three runs: not quiet.

Every snapshot (before, after each step, final) of every run read 0 containers, 0 sandboxes, an empty workspace and no daemon.

## Key facts checked

- The doctor `control-channel` row with no daemon is `warn`, with detail `control socket is absent, so the daemon looks stopped`; `realm doctor` exits 0 and says `daemon absent (REALM_NOT_ACTIVE); ran 15 local checks`.
- After `realm up` the run directory is mode 700 and `control.sock` a socket of mode 600, both owned by the invoking user, one daemon; after `realm down` the socket is gone and the daemon stopped on the first poll.
- The exec of `sleep 47` answered `TOOL_TIMEOUT` (`retryable` true) after 28083 ms; the sleeper was seen in flight at 409 ms.
- Muse Code 1.4.23 and Hermes Agent 0.23.1 results are in `36-01-SUMMARY.md`; the hermes `t2` record and the support matrix row carry "2026-11-18, 0.23.1: PASS; covers 0.23.1 only" (`test/support/host-registry.ts`, `docs/integration/host-support-matrix.md`).
- Build and docs checks run by the recording task on 2026-11-18: `npm run build` clean; `node --test dist/test/docs/*.test.js` 72 of 72 pass (includes the host-gaps, host-docs and host-support-matrix tests); `node --test dist/test/host/host-registry.test.js` pass; `node scripts/check/host-paths.mjs` and `npm run check:docs` ok. The full test suite and the lint were not run by this task.

## behavior_unverified

1. **Omp responsiveness during a cold attach (OI-11).** Not measured. The only numbers are a loaded baseline with no extension. UI-01 stays the owner's call; lift condition: a quiet slot (load per CPU at most 0.5, no realm daemon of the account running) on the production stack.
2. **The stdin trust boundary (OI-13).** Needs the owner; the decision text is proposed in `36-DISPOSITIONS.md` and no docs file was changed.
3. **Whether the dispatcher's timeout kills the hung process.** After the `TOOL_TIMEOUT` reply the sleeper was still listed on 13 consecutive polls before it was gone. [INFERENCE] It may have ended by its own 47 s run time. The test as written passes either way, so OI-10 is re-verified as the test defines it and no further.
4. **A Muse Code boot against the production stack.** Not rehearsed (named gap: no recipe, no registry record, no `--host` id, a 30 s default start timeout). The validator tier uses a recorder in place of the real `realm`, so it does not show how an unlabelled launcher fares under capability-token enforcement (GAP-34-01).
5. **No model-driven tool call through any host.** The Muse Code and Hermes runs used a fake server or a stub, not the real `realm`, and no model turn ran. The Hermes and Muse results cover one version each (0.23.1 and 1.4.23).
6. **One machine, one stack.** One Podman 5.7.1 account on one host; the harness fixes of PR 172 and PR 174 were first shown working by run 3, once.
7. **Record gaps.** The exact command lines of the window steps and any file hashes were not captured in the evidence (written as not recorded).

## Residuals (not verdict-blocking)

- **R1: planning bookkeeping.** This verification does not edit `ROADMAP.md`, `STATE.md` or `REQUIREMENTS.md`; registering V1LIVE-01 and V1LIVE-02 as satisfied is the orchestrator's step.
- **R2: the harness findings.** The two harness failures (the call before the served session, the unlabelled session under enforcement) were caused by Phases 33 and 34 and fixed by PR 172 and PR 174; they are test-harness findings, not product defects, and no product file changed.
- **R3: the archived v1.0 reports** are history and were not edited.

## Verdict

passed, with V1LIVE-01 and V1LIVE-02 met: the live checks this host can run (doctor, control-socket modes, the hung-exec timeout, the two reaper checks, Muse Code and Hermes loading) were re-verified with dated evidence kept outside the repository, the Omp responsiveness item is carried with its named reason (the host was not quiet), and all 14 items of the v1.0 open-item list have a final status (6 re-verified, 1 re-verified in its current contract form, 1 closed by test, 3 dropped, 1 closed as moot, 1 carried, 1 waiting for the owner). The claim is limited to what the evidence shows: one machine, no model-driven tool call, and no measurement of the Omp attach.

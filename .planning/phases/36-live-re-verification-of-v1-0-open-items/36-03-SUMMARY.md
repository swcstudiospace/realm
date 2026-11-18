---
phase: 36-live-re-verification-of-v1-0-open-items
plan: "03"
status: complete-with-one-finding-carried
requirements: [V1LIVE-01, V1LIVE-02]
completed: 2026-11-18
window: "2026-11-18, production stack, account realmlive, rootless Podman 5.7.1, shared live lock, three runs"
---

# Plan 36-03 summary: the window and the recording

Tasks 1 to 3 (the window date, the preflight and lock, the live runs) were checkpoints run by people outside this repository, under the owner's authorization of 2026-11-18. Tasks 4 and 5 (this recording) ran afterwards from the person's evidence. The evidence is kept outside the repository; this summary names it only as EVIDENCE_DIR (a placeholder, no path). Every result below is copied from that evidence and from the Plan 36-01 and 36-02 summaries.

## What changed (Tasks 4 and 5)

- `36-DISPOSITIONS.md`: all 14 rows final, the window record, the findings, the per-item run records, Part C (the reconciliation).
- `docs/integration/openshell.md`: a dated results paragraph for live closeout A, B, C and production live 5 and 11.
- `docs/integration/runtime-decision.md`: one sentence in the Directory modes bullet of the closure decisions citing the live stat observation of live closeout B.
- `docs/integration/omp.md`: the UI-01 detail carries the 2026-11-18 re-verification: three refusals on a host that was not quiet, then a loaded-host run that failed its thresholds (the numbers and the unestablished cause). The UI-01 row text is unchanged.
- `docs/integration/hosts.md` and `docs/hosts/snippets/muse-code.md`: the Muse Code validator-tier result and the named gap.
- `docs/hosts/snippets/hermes-agent.md` and `docs/integration/host-plugin-gaps.md`: the Hermes result (T2 row, GAP-25-01, GAP-25-04, GAP-25-05).
- `test/support/host-registry.ts`: the hermes `t2` record (2026-11-18, 0.23.1, PASS; covers 0.23.1 only); `docs/integration/host-support-matrix.md` regenerated (one row).
- OI-13 (added after the owner's decision of 2026-11-18, accepted as proposed): `docs/integration/mcp.md` gained Q11. Stdin trust boundary and `docs/integration/acp.md` one pointer sentence in Q2; the ledger, the reconciliation and `36-VERIFICATION.md` count OI-13 as Closed: owner decision (accepted).
- No file under `src` changed.

## Window evidence summary

Three runs, one test at a time, run by a person as the `realmlive` account under the shared live lock. Counts are from the TAP files kept in EVIDENCE_DIR; a duration marked "about" is the file duration of a failed run.

| Step | Run (about, UTC; main) | Result | Duration |
| --- | --- | --- | --- |
| A, live closeout A (OI-05) | 1 (06:39; dbdbf23) | 1 of 1 pass | 1288 ms |
| B, live closeout B (OI-06) | 1 | 1 of 1 pass | 12323 ms |
| D11, production live 11 (OI-09) | 1 | 1 of 1 pass | 28947 ms |
| C, live closeout C (OI-10) | 1 | fail (F-1) | 47554 ms |
| C | 2 (06:52; after PR 172) | fail (F-2) | about 13 s |
| C | 3 (07:08; 04ca807) | 1 of 1 pass | 60891 ms |
| D5, production live 5 (OI-09) | 1 | fail (F-1) | about 27 s |
| D5 | 2 | fail (F-2) | about 25 s |
| D5 | 3 | 1 of 1 pass | 29882 ms |
| E, Omp cold attach (OI-11) | 1, 2, 3 | fail before any probe: host not quiet (1.67, 0.76, 1.47 load per CPU; bound 0.5) | under 1 s each |
| E | 4 (about 12:01 UTC, loaded-host run accepted by the owner) | fail (thresholds): baseline loaded 41 probes, 0 unanswered, max 271 ms; cold attach 97 probes over 24001 ms, 6 unanswered, max 9868 ms, median 18 ms, p95 8910 ms, longest gap 11369 ms, realm active reached; load 8.16 then 9.00 on 8 CPUs | 49.8 s |

Residue: every snapshot of every run (runs 1 to 4) (before, after each step, final) read 0 containers, 0 sandboxes, an empty workspace and no daemon. The snapshot files and the TAP files are in EVIDENCE_DIR. No file hashes are recorded for this window: the evidence holds none (not recorded).

Specifics copied from the evidence: the doctor `control-channel` row is `warn` with detail `control socket is absent, so the daemon looks stopped` and the fix `Run realm up to start the daemon, then rerun doctor.`; stderr `realm doctor: daemon absent (REALM_NOT_ACTIVE); ran 15 local checks`. After `realm up` the run directory is `700` and `control.sock` is `600`, both owned by `realmlive`, one daemon; after `realm down` the socket was gone and the stop poll took 1 attempt. The exec of `sleep 47` was seen in flight at 409 ms and answered `TOOL_TIMEOUT` (`retryable` true) after 28083 ms; the sleeper was present on 13 consecutive polls after the reply and gone on the next.

## Per-item outcomes (the 14 items)

OI-01 to OI-03 Dropped (D-27-01); OI-04 Closed: moot, not resolved; OI-05, OI-06, OI-07, OI-08, OI-10 and OI-14 Re-verified (dated run, command, commit); OI-09 Re-verified, current contract form; OI-12 Closed by test; OI-11 Re-verified (loaded host, thresholds failed), carried as a finding; OI-13 Closed: owner decision (accepted), 2026-11-18 (the owner accepted the proposed stdin trust boundary text; Q11 in `docs/integration/mcp.md`). Part C of `36-DISPOSITIONS.md` has the table and the counts.

## Findings

- F-1 (run 1): the live suites called a tool before the serve-early session was ready (`REALM_NOT_ACTIVE`). A test-harness finding caused by Phase 33, fixed by PR 172 (`waitUntilServed`). Not a product defect.
- F-2 (run 2): an unlabelled live `realm mcp` session was refused `POLICY_DENIED` under capability-token enforcement. A test-harness finding caused by Phase 34, fixed by PR 174 (`--host claude` in `startMcpSession`). Not a product defect.
- F-3 (run 3): after the `TOOL_TIMEOUT` reply the sleeper was still listed on 13 consecutive polls. [INFERENCE] It may have ended by its own 47 s run time, not because the timeout killed it; the test as written cannot tell the two apart. An evidence limit for the owner, recorded in `docs/integration/openshell.md` and in the ledger; nothing was changed.
- F-4: the host was never quiet during runs 1 to 3, so the cold-attach test refused to run each time.
- F-5 (run 4): on a loaded host, accepted by the owner, the cold-attach test failed its thresholds: `get_state` went unanswered for about 11 s (longest gap 11369 ms, 6 of 97 probes unanswered, maximum 9868 ms). The Omp extension still attaches before answering; Phase 33's serve-early applies to `realm mcp`, not to the Omp extension. Not a quiet-host measurement; the cause (load or a blocking attach in the Omp path) is not established. Carried, with F-3, into the candidate v5.1 phase "Omp responsiveness during cold attach".

## Gate results of this plan

Run by the recording task: `npm run build` (clean); the docs and registry tests (`test/docs/host-gaps.test.ts`, `test/docs/host-docs.test.ts`, `test/docs/host-support-matrix.test.ts`, `test/host/host-registry.test.ts`) and the host-path and docs scripts, as listed in `36-VERIFICATION.md`. The matrix was regenerated with `REALM_WRITE_HOST_MATRIX=1` (CI unset for that one command) and the diff is the one hermes row. The full test suite and the lint were not run by this task.

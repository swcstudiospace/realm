---
phase: 19-resume-and-checkpoint
plan: 01
subsystem: resume-and-checkpoint
tags: [live, driver-restart, checkpoint, scratch, adoption, health-reattach]
requires: ["18-14"]
provides:
  - "Live production suite on commit 2ff6df9: 40 tests, 40 pass, 0 fail, 0 skipped, exit 0 (second full run); host restored: 0 containers, 0 sandboxes, empty workspace"
  - "Driver restart keeps the sandbox: the adopted container restarts with a rebuilt runtime channel and a new supervisor attaches"
  - "Daemon health loop re-attaches the runner on the recorded container after a probe failure (bounded)"
affects: [.planning/REQUIREMENTS.md, .planning/ROADMAP.md]
key-files:
  created:
    - .planning/phases/19-resume-and-checkpoint/19-01-SUMMARY.md
  modified: []
decisions:
  - "Owner 2026-11-15: stopped-project pin in memory (decision 7) and the daemonless name+label proof (PR 91, 21a3b17, ec31518)"
  - "Owner 2026-11-16: restart the adopted sandbox's container on driver adoption (restart-container), not re-adopt the existing runtime bind, which OpenShell 0.1.5 does not support"
  - "Owner 2026-11-16: the daemon re-attaches its runner automatically after a probe failure (auto-reattach), a bounded exception to the RT-04 / N1 no-automatic-restart rule; documented in docs/integration/omp.md and docs/integration/openshell.md"
requirements: [RES-01, RES-02, RES-03, RES-04, RES-05]
metrics:
  tasks: 4
  completed: 2026-11-16
plan_head_before: e655aa2
commits: 25
status: live-evidence-recorded
---

# Phase 19 Plan 01: resume and checkpoint, live acceptance (RES-01 to RES-05) Summary

PR 91 (merge commit `3c5ebc5`) merged the in-memory stopped-project pin, the gap tests, the driver restart and the daemon re-attach. The owner-authorized live window on commit `2ff6df9` passed all 40 production live tests with none skipped on its second full run, and the host was restored each time.

## What was found and fixed

The `production live 19 driver-restart` scenario failed on every build before this plan's fixes. The causes, each shown by a captured log line and not inferred:

1. The in-container runtime binds to the first host supervisor and the respawned supervisor was refused: `attachment denied: boundary process leaf: sandbox runtime is already bound to another supervisor process` (supervisor log).
2. A plain container restart then exits: `read boundary config /run/openshell/channel/bootstrap.json: No such file or directory`, because the runtime consumes its bootstrap (container log).
3. The gateway marks a sandbox whose container exited as phase Error and does not recover it (gateway log: `Sandbox failed to become ready ... reason=exited`).
4. A health re-attach that ran create again replaced the container, and a restart racing a 10 s stop grace let the daemon destroy the container (libpod `404 no such container` on start, after `StopSignal SIGTERM failed to stop container ... resorting to SIGKILL`).

The fixes: the registry rebuild stops each adopted container (1 s grace), clears the previous generation's channel, TLS, ssh, descriptor and auth entries (not `launch.json`), issues the runtime's leaf again, writes the bootstrap, descriptor and auth bundle, restarts and re-verifies the container, waits for the TLS handshake, then starts the supervisor. The daemon's health loop re-attaches through the hydration path (never create). The live scenario polls the workload after the restart, because the gateway shows the sandbox not ready until the new supervisor attaches.

## Evidence

| Check | Result | Source |
| ----- | ------ | ------ |
| Hermetic, `2ff6df9` | build, lint, `check:docs`, `check:gates`, `test:scripts`, `check:pack`, `check:mcp` pass; full suite 3051 pass, 0 fail, 43 skipped | local runs (PR 91 CI on `4cb5e14`: Verify 22.x and 24.x, docs site and dependency audit pass) |
| Live, `2ff6df9`, run 1 | 40 tests, 39 pass, 1 fail, 0 skipped. Failure: `production live 12` (scratch file survives a daemon restart): `cat /scratch/marker.txt: No such file or directory` | evidence file `19-live-2ff6df9.txt` |
| Live, `2ff6df9`, run 2 | 40 tests, 40 pass, 0 fail, 0 skipped, exit 0 | evidence file `19-live-2ff6df9-r2.txt` |
| `production live 12` alone | pass | evidence file `19-live-live12-a.txt` |
| `production live 19 driver-restart` alone | pass (29 s) | evidence file `19-live-drvrestart-10.txt` |
| `production live 12` alone, 8 repeats | 8 of 8 pass | evidence files `19-live-live12-loop-1.txt` to `-8.txt` |
| Live, same product code, 3 more full runs with container-state capture | 3 of 3: 40 pass, 0 fail, 0 skipped | evidence files `19-live-full3-1.txt` to `-3.txt` |
| Live, PR 92 (each scenario starts after the previous scenario's host supervisors are gone), 2 full runs | 2 of 2: 40 pass, 0 fail, 0 skipped; host restored | evidence files `19-live-settle-1.txt`, `-2.txt` |
| Host after each run | 0 containers, 0 sandboxes, empty workspace, original driver unit and config restored | run output |

Evidence files are under the operator's evidence directory outside the repository (`<home>/realm-evidence/phase14/`).

## NOT VERIFIED

- The cause of the single `production live 12` failure in run 1 is not established. The daemon log shows the reaper removed the survivor with cause `running` (the container was not running when the new daemon started), after a scenario that reused the same sandbox name; the driver journal shows the previous sandbox's host supervisor exiting seconds after that scenario's residue check. A cross-scenario race is a hypothesis, not a finding, and the driver's exit handler is identity-guarded (it cannot stop a newer container). Owner decision 2026-11-16: harden the test (PR 92, merge commit `b23684e`). Afterwards 5 of 5 full runs passed on the unchanged product code; the failure was 1 in 5 full runs before, and 0 in 8 isolated repeats.
- Plan Task 1 (strict-ancestor evidence that the D5 and D19 decisions precede the code, RES-01) is not re-run here; the independent verifier reports it.
- Plan Task 4 (owner review of the per-case evidence) is recorded by the owner's approval of PR 91 on 2026-11-16 after the evidence summary above; the per-case TAP files were not reviewed line by line in this summary.
- The Omp harness and hosts other than the realm CLI were not exercised by these scenarios.
- Scenario 8 (runner exit) still sees `AGENTOS_CRASH_LOOP`, but only inside the 10 s window before the first re-attach attempt; it polls every 2 s. That window is its only protection.

## Deviations

- The live scenario was edited (poll the workload after a driver restart) after the first failure analysis, not left as planned. The change is in `test/integration/production-driver.test.ts` and keeps every original assertion.
- The documented RT-04 / N1 rule "there is no automatic restart" is amended for the health loop's bounded re-attach (owner decision above).

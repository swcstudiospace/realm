# Quick task L2: live scenarios 5b and 5c and the audit-pair validator

## Why

Quick task L1 realigns scenario 5 to startup re-adoption. Two behaviours around it have no live scenario, and one plan item is still open:

- The destroy path. Documented behaviour (`docs/integration/omp-lifecycle-runbook.md`, section C, row `kill -TERM <daemon pid>`): a SIGTERM makes the daemon exit and its container is removed within about 30 s while the session record stays. The NEXT start therefore reports a destroyed record with zero containers ("A previous daemon's sandbox was destroyed at startup: 0 container(s), N session record(s)." from `startupNoticeOf` in `src/daemon/daemon.ts`). This is the only live path that proves the logged `recordsDeleted` field (CRASH-04).
- The per-session scratch volume (RES-03). `src/runtime/hardening.ts` (`SCRATCH_VOLUME_PREFIX`, `scratchVolumeNameOf`, destination `/scratch`) defines one named read-write volume per session. Its survival across a crash and removal on `realm down` have no live proof.
- Plan 16-03 T1/T2 (`.planning/phases/16-omp-runs-in-the-sandbox/16-03-PLAN.md` lines 47-55) asks for a pure audit-pair validator that the live scenarios use.

## Locked decisions

1. New scenario "production live 5b: after the daemon is stopped with SIGTERM, the next realm up reports the destroyed record and reaches active with a new container". Steps: startScenario, assertActive, capture the single container id, SIGTERM the one daemon pid (reuse `daemonPids`; the suite may only signal the one daemon its own `realm up` started), poll with the existing bounded pollUntil constants until the daemon is gone AND no container for the sandbox remains, then `realm up`, waitForActive. Assert exactly one container whose id differs from the captured one; the status notice contains "destroyed at startup" with `reapCountsOfNotice(...).containers === 0` and `sessionRecords >= 1`; the `daemon.log` `daemon.startup` line (use `startupLineWith` from task L1) has `recordsDeleted >= 1`, `containersRemoved === 0`, `adopted === 0`; `realm audit verify` is ok.
2. New scenario "production live 5c: the scratch volume survives a daemon crash and is gone after realm down". Through the MCP `exec` tool write a marker under /scratch; SIGKILL the daemon as scenario 5 does; `realm up`; read the marker back through `exec` (same bytes); then `realm down` and assert, with a small helper that lists the account's volumes through podman the way `listSandboxContainers` lists containers, that no volume named for this session remains. Add a hermetic test for the volume-list parser.
3. `auditPairProblems(records, expected)` in `test/support/production-live.ts`: a pure validator that, for the audit lines of one tool call, returns a list of problems (empty means ok): exactly one admission line followed by exactly one result line, in that order, with the same correlationId (reuse the convention `auditLinesWithCorrelation` already uses; do not invent a wire field), and the expected tool, session id and outcome. Hermetic tests: ok pair; missing result; missing admission; duplicate admission; duplicate result; reversed order; wrong correlation id; wrong session id. Use it in `test/integration/omp-ompx05.test.ts` where it checks counts and ids today (around lines 286-314) and in `production-driver.test.ts` scenario 6's audit join. Do not weaken any assertion that exists today.

## Files in scope

`test/integration/production-driver.test.ts`, `test/support/production-live.ts`, `test/integration/production-live-helpers.test.ts`, `test/integration/omp-ompx05.test.ts`. Nothing else. This task runs AFTER quick task L1: its helpers (`startupLineWith`, `adoptedCountOfNotice`) must already exist.

## Execution notes

- Live scenarios are gated (`REALM_LIVE_PRODUCTION=1`, and `REALM_LIVE_OMP=1` for the Omp one) and stay skipped here. Never run them and never touch the live stack: nothing under the live account's home directory, no podman, openshell or systemctl.
- Verify with typecheck, lint and the hermetic helper tests only, every heavy command through `flock -w 7200 <heavy-slot lock> <command>`.
- Do not edit CHANGELOG.md, package.json, package-lock.json, `.github/**` or `release/**`. `.planning/config.json` has an uncommitted orchestrator change: never stage it.

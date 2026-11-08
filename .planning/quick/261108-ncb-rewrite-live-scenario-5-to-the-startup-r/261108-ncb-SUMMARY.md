---
phase: quick-261108-ncb
plan: 01
subsystem: test/live-production
tags: [live-suite, crash-recovery, startup-reap, re-adoption, D5]
status: complete
requires: []
provides: [startupLineWith, adoptedCountOfNotice]
key-files:
  modified:
    - test/support/production-live.ts
    - test/integration/production-live-helpers.test.ts
    - test/integration/production-driver.test.ts
commit: a833ece
---

# Quick task 261108-ncb: rewrite live scenario 5 to startup re-adoption

Production live scenario 5 now asserts that the restarted daemon re-adopts the sandbox the crash left (owner decision D5, `docs/integration/runtime-decision.md`, "Startup reaper and scratch volume"), not that it destroys it. Two new pure helpers carry hermetic tests.

## What changed

- `test/support/production-live.ts`: `startupReapLineFor` is removed. Added `StartupLineExpectation`, `startupLineWith(log, expected)` (matches a `daemon.startup` JSON line by its `adopted`, `containersRemoved` and `recordsDeleted` counts; a count left out is not compared) and `adoptedCountOfNotice(notice)` (parses "<n> session(s) from the previous daemon were adopted and kept"). `reapCountsOfNotice` is kept and its export is untouched, as the orchestrator directed, because quick task 261108-ncc (scenario 5b) reads it.
- `test/integration/production-live-helpers.test.ts`: header names the new readers; 7 hermetic `startupLineWith` tests and 3 `adoptedCountOfNotice` tests, all fixed-input and behavioural.
- `test/integration/production-driver.test.ts`: scenario 5 rewritten to "adopt after crash". Before the kill it writes a marker file through the MCP `write` tool (name `WORKSPACE_ADOPT_NAME`, added to `WORKSPACE_FILES` so cleanup removes it). After the restart it asserts: status active; one new daemon process; one sandbox and one container; the container id equals the pre-kill id (prefix match in either direction, from the sandbox's container listing); the status notice contains "adopted and kept", counts 1, and does not contain "destroyed at startup"; `daemon.log` holds a `daemon.startup` line with `adopted` 1, `containersRemoved` 0, `recordsDeleted` 0; the marker reads back byte-identical through a second MCP session; `realm audit verify` is unchanged. `jsonLinesSinceStartup` now anchors on `adopted === 1`. The title and the comments say re-adopt. The catch block that runs one extra `up` is kept.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `startupLineWith` takes no `containerId`.**
- **Found during:** Task 1, while reading the daemon's startup report.
- **Issue:** The plan asked the `daemon.startup` match to require a `containerIds` entry equal, or prefix-related, to the crashed container. `containerIds` is built only from containers the reap removed (`src/daemon/daemon.ts`, the `reaped.removed` loop). Adopted containers are reported in `reaped.adopted` (`src/session/reap.ts`) and never enter `removed`. The check could never pass against a live re-adoption.
- **Fix:** The helper matches on counts only. The container identity is proven by the sandbox's container listing after `replacementReady`, compared by prefix in either direction, which is the source that actually shows the container. The `containerId` hermetic tests the plan listed were therefore not written.
- **Files modified:** `test/support/production-live.ts`, `test/integration/production-live-helpers.test.ts`, `test/integration/production-driver.test.ts`.

**2. `reapCountsOfNotice` import dropped from the driver suite.**
- Scenario 5 was its only caller in this tree, so the import would fail `noUnusedLocals`. The export stays in `production-live.ts` (orchestrator override). The helper has no test in the helper file, so no test changed.

### Notes

- `startupLineWith` naming the container and the scenario's daemon-log check: the daemon log cannot name an adopted container (see item 1). The log assertion is counts-only; its failure message still names the crashed container id for diagnosis.
- Scenario 5's `startScenario` now receives `WORKSPACE_FILES` (scenarios 1 and 6 do the same).

## Verification

Run through the heavy-slot lock, in the pinned root, with the exit code of each command:

- `npm run typecheck`: exit 0.
- `npm run build`: exit 0.
- `node --test dist/test/integration/production-live-helpers.test.js dist/test/integration/production-driver.test.js`: exit 0. 88 tests, 77 pass, 0 fail, 11 skipped. The skips are the gated live scenarios, skipped because `REALM_LIVE_PRODUCTION` is unset. The live suite was not run and the live stack was not touched.
- `npm run lint`: exit 0.
- `npm run check:gates`: exit 0 (gate closure: 4 modules, no violations; module size: 107 files, no violations).
- `npm run check:docs`: exit 0 (host paths ok, agents sync ok, default mode ok).

Commit `a833ece` (`test(live): rewrite scenario 5 to startup re-adoption`) was made with hooks on; `--no-verify` was not used. It stages only the three in-scope files. `.planning/config.json` (the orchestrator's uncommitted change) was neither staged nor reverted. The PLAN, this SUMMARY and STATE.md are not committed here; the orchestrator commits them.

Not run: the gated live scenarios, and the full test suite (the orchestrator runs it).

## Known Stubs

None.

## Self-Check: PASSED

- Commit `a833ece` exists on `gsd/v3-integrate-p19`.
- The three in-scope files were modified and committed; no other files were.
- `startupReapLineFor` no longer appears under `test/`; `reapCountsOfNotice` remains exported, as directed.

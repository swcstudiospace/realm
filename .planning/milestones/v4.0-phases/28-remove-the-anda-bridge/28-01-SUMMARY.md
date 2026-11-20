---
phase: 28-remove-the-anda-bridge
plan: "01"
subsystem: anda-bridge-removal
tags: [anda, removal, breaking-change, config, error-catalogue, doctor, lifecycle]
requires: []
provides:
  - "src/anda/ is deleted and no file under src imports from it; the bridge port types, the bridge member of the lifecycle and wiring options, and the controller's bridge step and handshake bookkeeping are gone; a session reaches active after the container start with no bridge step"
  - "src/runtime/config.ts: the andaUrl key is gone from RuntimeConfig; a closed RETIRED_KEYS table holds one fixed migration sentence; retiredKeyNotes returns the sentence for an input that carries a retired key; loadRuntimeConfig refuses the key with SCHEMA_INVALID like any key outside its closed set; describeRuntimeConfigProblems adds the sentence and never echoes a key name or a value"
  - "src/cli/main.ts: a command that reaches the config load prints the sentence on a following stderr line (status refuses with exit 2, doctor stays diagnostic)"
  - "src/core/errors.ts: ERROR_CODES and ERROR_CATALOGUE go from 31 to 29 codes; ANDA_UNREACHABLE and ANDA_VERSION_MISMATCH are removed with no replacement"
  - "src/doctor/checks.ts: the anda-bridge item and its HTTP transport are removed; REGISTERED has 10 items in the old order minus that one"
  - "The Anda tests and fixtures are deleted and the remaining tests are rewritten to the controller without a bridge"
affects: [src/core/ports.ts, src/core/errors.ts, src/core/state-machine.ts, src/lifecycle/controller.ts, src/realm/compose.ts, src/daemon/daemon.ts, src/runtime/config.ts, src/doctor/checks.ts, src/cli/main.ts, test/runtime/config.test.ts, test/cli/cli.test.ts, test/lifecycle/adopt-hydrate.test.ts, scripts/check/export-usage-allowlist.json, scripts/check/module-size-allowlist.json]
key-files:
  created: []
  modified:
    - src/runtime/config.ts
    - src/core/errors.ts
    - src/doctor/checks.ts
    - src/cli/main.ts
    - src/lifecycle/controller.ts
    - src/realm/compose.ts
    - test/runtime/config.test.ts
    - test/cli/cli.test.ts
    - test/lifecycle/adopt-hydrate.test.ts
    - test/core/errors.test.ts
    - scripts/check/export-usage-allowlist.json
    - scripts/check/module-size-allowlist.json
  deleted:
    - src/anda/
    - test/anda/
    - test/support/fake-anda.ts
    - test/support/fake-bridge.ts
decisions:
  - "D-28-02: an andaUrl key is refused with SCHEMA_INVALID whatever its value; no new error code; one fixed sentence is added by a literal table, so no key name or value from the file is echoed"
  - "D-28-03: the catalogue shrinks to 29 codes; nothing replaces the two removed codes"
  - "D-28-05: the doctor loses the item and its transport; the report is one item shorter"
  - "D-28-06: the lifecycle controller drops the bridge and the persist-code hold (holdPersistCode and releasePersistCode, which only the bridge listener reached) with it"
  - "No shim, alias or re-export of a removed name; the degraded state stays valid but unreachable until plan 28-02"
  - "The export-usage allowlist gained DEFAULT_REQUEST_TIMEOUT_MS after the first CI run (see Deviations)"
requirements: [ANDAX-03, ANDAX-05]
metrics:
  tasks: 4
  completed: 2026-11-17
status: merged
---

# Phase 28 Plan 01: Remove the bridge, the andaUrl key, the error codes and the doctor item Summary

Merged to main in PR 138 (merge commit `b7fc985`). This plan is the first commit of the PR, `2dda45d` "feat(anda)!: remove the Anda bridge, the andaUrl key and the ANDA error codes (ANDAX-03)": 60 files changed, 308 insertions, 3502 deletions. The PR carried four commits in all; the commit boundary of this plan is the one boundary the pull request kept from the plan. The release `v0.4.3` followed on main (`29d2f2f`).

## What was done

- Task 1 (doctor): the `anda-bridge` doctor item and its `node:http` and `node:https` transport are removed from `src/doctor/checks.ts`; `DoctorOptions` lost its Anda members. `REGISTERED` now holds 10 items (policy file, state dir, session store, podman, podman service, openshell, control channel, agentos, host binaries, kernel hardening).
- Task 2 (bridge): `src/anda/` is deleted with its tests and the two fakes; the port types, the options members, the controller's bridge step and the wiring in `src/realm/compose.ts` and the daemon are removed. The create tail and the hydrate tail now run the port start, check ownership, persist `active` and transition. The persist-code hold on the state machine, reachable only from the bridge listener, is removed.
- Task 3 (config): the retired-key table and `retiredKeyNotes` in `src/runtime/config.ts`; the CLI prints the sentence on a following stderr line. The sentence, as held by the table: "andaUrl was removed in the 0.4 release line, with the Anda bridge: delete it from config.json".
- Task 4 (codes): the two codes are removed from the catalogue and the status map; `CATALOGUE_SIZE` in `src/core/errors.ts` is 29.

## Observed

- Read of `origin/main` on 2026-11-17: `src/anda` does not exist; `src/runtime/config.ts` holds `RETIRED_KEYS` with the one sentence above, `retiredKeyNotes`, and `describeRuntimeConfigProblems` calling it; `src/cli/main.ts` imports `retiredKeyNotes` and prints each sentence as the line `realm` plus the command name, a colon, `config.json:` and the sentence; `src/core/errors.ts` has `CATALOGUE_SIZE = 29`; `REGISTERED` in `src/doctor/checks.ts` has 10 entries; no `src` or `test` file other than the retired-key tests names `ANDA_UNREACHABLE` or `ANDA_VERSION_MISMATCH`.
- `test/runtime/config.test.ts` has the refusal case for any value of `andaUrl`, the case that a loaded config has no `andaUrl` property, and the two retired-key message cases (the sentence is added; a hostile value is not echoed; an input with another bad key gets no sentence). `test/cli/cli.test.ts` has the `status`, `doctor` and `doctor --fix` cases with the retired key.
- `scripts/check/module-size-allowlist.json` holds `src/lifecycle/controller.ts` at 1069, the measured line count of the file (OQ-28-04).
- The orchestrator ran the built CLI on the PR head: a `config.json` with `andaUrl` made `realm status` exit 2 with the sentence, and `realm doctor` printed it; without the key `status` worked. That evidence is not stored in the repository.
- CI on PR 138 ran the build, the test suites, lint and the gates (see Deviations for the one failure).

## Not verified here

- `npm test` and `npm run test:coverage` were not run locally by the closer or the orchestrator; the claim rests on CI of PR 138.
- The rewritten cases of `test/lifecycle/adopt-hydrate.test.ts` were the riskiest edit of the plan (the hydrate tail lost its bridge step) and passed only in CI; nobody ran them locally.
- The smoke run of the built CLI is an orchestrator observation, recorded here from its report; the closer did not repeat it.
- The line counts and file counts above are those of the git diff stat; the closer did not recount deleted tests.

## Deviations from plan

- The plan fixed eight commits for the phase and a gate-data commit only if needed; the PR kept four (this plan one, plan 28-02 one, plan 28-03 one, one gate-data fix). The six subjects named in D-28-09 were folded into the three feature commits.
- The first CI run failed the export-usage gate: after the bridge removal `DEFAULT_REQUEST_TIMEOUT_MS` is used by tests only. Commit `54b6b41` "chore: allowlist DEFAULT_REQUEST_TIMEOUT_MS as a test seam after the bridge removal" added five lines to `scripts/check/export-usage-allowlist.json`. CI was green afterwards.

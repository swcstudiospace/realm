---
phase: 25-host-adapters-wave-2-remaining-gsd-core-runtimes
plan: 03
subsystem: host-live-rehearsal
tags: [host, live-rehearsal, validator-tier, gated-tests, wave2]
requires: ["25-01", "25-02"]
provides:
  - "test/support/host-live.ts extended with the wave 2 host ids and the version floor; test/support/host-live-wave2.ts is the per-host script table (override variables, the file the real recipe writes, the host's own validator commands, whether the host launches the registered command, an optional host add command run after install)"
  - "test/integration/host-live-wave2.test.ts: one gated scenario per host for qwen, pi, hermes, cursor, kilo, copilot, augment, codebuddy and cline, each opted in with REALM_LIVE_&lt;ID&gt;=1 (optional REALM_&lt;ID&gt;_BIN), run in an isolated HOME, skipping with a named reason when the opt-in, the executable, the version floor or a working host CLI is missing"
  - "test/integration/host-live-helpers.test.ts extended: the hermetic test that always runs covers skip-reason selection, the version floor, the stub realm, the isolation guard, version parsing and the shape of the per-host table"
  - "A recorded run of 2026-11-17 on the verification machine (below); antigravity has no live file and its gap is written down"
affects: [test/support/host-live.ts, test/support/host-live-wave2.ts, test/integration/host-live-helpers.test.ts, test/integration/host-live-wave2.test.ts]
key-files:
  created:
    - test/support/host-live-wave2.ts
    - test/integration/host-live-wave2.test.ts
  modified:
    - test/support/host-live.ts
    - test/integration/host-live-helpers.test.ts
decisions:
  - "Every command a scenario runs is one the host runs without a login, without a model prompt and without a credential; no live registration touches a real host configuration (the operator's real files are hashed before and after and must not change)"
  - "pi runs only for pi 1.3 and later; an older pi is a named skip, not a failure (OQ-25-07)"
  - "A host that only prints the registered entry starts nothing: the scenario then asserts the stub realm was never run; a host that connects to the stub, which does not speak MCP, may exit 1 after it printed its row (pi, hermes) and the scenario accepts only the listed exit codes"
  - "No production tier (T3) for any wave 2 host: they are config-only by the owner's decision (OQ-25-09); antigravity has no live file because agy was never run (OQ-25-04)"
requirements: [WAVE2-07]
metrics:
  tasks: 2
  completed: 2026-11-17
status: merged
---

# Phase 25 Plan 03: Gated live validator tier for the wave 2 hosts Summary

Merged to main in PR 118 (squash `2540115`). The rehearsal code exists and is gated; the results below were produced by running it by hand on the verification machine on 2026-11-17, with the evidence kept outside the repository.

## What shipped

- The per-host script table `test/support/host-live-wave2.ts` and the table-driven gated file `test/integration/host-live-wave2.test.ts`.
- The additions to `test/support/host-live.ts` (wave 2 host ids, floor handling) and the extended hermetic `test/integration/host-live-helpers.test.ts`.

## Live results (2026-11-17, this machine, evidence kept outside the repo)

| Host | Tier | Result |
| --- | --- | --- |
| qwen 0.22.0 | validator (`REALM_LIVE_QWEN=1`) | **PASS**: the real recipe installs into an isolated home, Qwen Code's own commands parse it, and uninstall removes only what install created |
| pi, hermes, cursor, kilo, copilot, augment, codebuddy, cline | validator | **skipped with named reasons**: opt-in not set, CLI not installed on this machine, pi 0.84.3 below the 1.3 floor, hermes CLI broken here (`hermes --version` fails asking for a repair that was not run). Not run, so no result |
| antigravity | none | no live file; `agy` was never run |
| every wave 2 host | production (T3) | no tier exists (OQ-25-09) |
| hermetic helper test | always runs | 32 passed, 0 failed, 8 skipped |

## Observed

- Read of `origin/main` at `2540115`: the four files above exist; `test/support/host-live-wave2.ts` lists the nine ids `qwen`, `pi`, `hermes`, `cursor`, `kilo`, `copilot`, `augment`, `codebuddy` and `cline`.
- CI on the PR 118 head passed. The live file skips without its opt-in, so CI runs only the hermetic helper test.
- The qwen run covers Qwen Code 0.22.0 only.
- The qwen result and the skips are now recorded in `docs/integration/host-plugin-contract.md`, `docs/integration/hosts.md` and `docs/hosts/snippets/qwen.md`.

## Not verified here

- Eight of the nine gated scenarios (pi, hermes, cursor, kilo, copilot, augment, codebuddy, cline) have never run against a real host. For these the goldens rest on earlier manual scratch observations (kilo, copilot, auggie, codebuddy, cline, pi 1.5.2, cursor-agent), which were not made through `realm host install`.
- `antigravity` has never been run; its file and shape are documented only.
- No wave 2 host has a production tier; nothing here shows a real host booting Realm through `realm mcp --host ID`.
- The scenarios for pi and hermes accept exit code 1 after the host printed its row, because the stub does not speak MCP; whether a real pi or hermes then marks the server healthy is not shown.

## Deviations from plan

- **The plan expected a recorded run per host; one host ran.** The other eight skipped with named reasons, which is the designed behavior; the plan's checkpoint is therefore satisfied for qwen only.
- **Code written without local compilation.** CI was the gate; fix rounds landed before merge.

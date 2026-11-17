---
phase: 22-omp-plugin-on-boot
plan: 03
subsystem: omp-auto-open-and-reporting
tags: [omp, daemon, bun, presence, doctor, docs, live-rehearsal]
requires: ["22-01", "22-02"]
provides:
  - "src/daemon/node-runtime.ts findNodeBinary: a Bun host spawns the daemon with an absolute PATH Node; with none found the attach still fails closed with REALM_NOT_ACTIVE and no child exists"
  - "src/host/presence.ts: strict, bounded, symlink-safe presence markers at <stateDir>/hosts/omp-active/<pid>.json, written and removed through the plugin's onAttach and onSessionEnd"
  - "realm doctor (host-plugins) and realm host status omp report installed, shim target present, live plugin sessions and (status only) a duplicate plugin link, naming ids, states and counts only"
  - "docs/integration/omp.md install and auto-open section with evidence tiers; export-usage allowlist reconciled"
  - "test/integration/omp-boot-install.test.ts: the live boot rehearsal (PR 108)"
affects: [src/daemon/node-runtime.ts, src/cli/main.ts, src/host/presence.ts, src/host/adapter.ts, src/omp/extension.ts, src/doctor/host-checks.ts, src/doctor/checks.ts, src/cli/host.ts, scripts/check/export-usage-allowlist.json, scripts/check/pack-smoke.mjs, docs/integration/omp.md, docs/hosts/snippets/omp.md, docs/integration/host-plugin-contract.md, test/integration/omp-boot-install.test.ts]
key-files:
  created:
    - src/host/presence.ts
    - test/host/presence.test.ts
    - test/daemon/node-runtime.test.ts
    - test/integration/omp-boot-install.test.ts
  modified:
    - src/daemon/node-runtime.ts
    - src/cli/main.ts
    - src/omp/extension.ts
    - src/host/adapter.ts
    - src/doctor/host-checks.ts
    - src/doctor/checks.ts
    - src/cli/host.ts
    - scripts/check/export-usage-allowlist.json
    - docs/integration/omp.md
    - docs/hosts/snippets/omp.md
    - docs/integration/host-plugin-contract.md
decisions:
  - "Presence markers are advisory: a marker that cannot be written never changes an attach outcome (one stderr line with the catalogue code), and a live marker means a process loaded the plugin, not that the sandbox is healthy and not containment"
  - "Duplicate-load detection lives in realm host status omp, not doctor, because it needs the user's home and doctor deliberately never reads it"
  - "The live test gives Omp the account HOME and isolates only PI_CODING_AGENT_DIR: the daemon needs the account's HOME or the sandbox stop fails with AGENTOS_STOP_FAILED"
requirements: [OMPB-06, OMPB-07, OMPB-08]
metrics:
  tasks: 3
  completed: 2026-11-17
status: merged
---

# Phase 22 Plan 03: Auto-open on Omp session start, reporting, docs and the live rehearsal Summary

Merged to main in PR 106 (squash `819014d`: code, docs, allowlist) and PR 108 (live test `test/integration/omp-boot-install.test.ts`).

## What shipped

- Bun-host daemon spawn: `findNodeBinary(pathValue)` in `src/daemon/node-runtime.ts` returns an absolute, regular, executable `node` from an absolute `PATH` directory or `null`; `src/cli/main.ts` uses it so the compiled Omp binary can start the daemon. The Node branch is unchanged and a Bun host with no Node still refuses with `REALM_NOT_ACTIVE`.
- `src/host/presence.ts`: markers are strict (fixed key set, bounded count and size, symlink-safe, a pid that differs from the file name is unreadable); `src/omp/extension.ts` writes one through `onAttach` and removes it through `onSessionEnd`, and takes its bounds from the omp manifest through `resolveBoot`.
- Reporting: `src/doctor/host-checks.ts` (`host-plugins`) and `src/cli/host.ts` (`realm host status omp` with a `plugin` object: `target`, `sessions` live/stale/unreadable, `conflicts`).
- Docs: `docs/integration/omp.md` ("Installed by `realm host install omp`", the Bun spawn rule, the live rehearsal record), `docs/hosts/snippets/omp.md`, `docs/integration/host-plugin-contract.md`. `scripts/check/export-usage-allowlist.json` has no stale entry and no entry whose reason promises Phase 22 wiring.
- `test/integration/omp-boot-install.test.ts` (PR 108): one live test against the production stack.

## Live rehearsal 2026-11-17 (Omp 18.22.0, production stack): passed (1 test)

- A session with Node absent from `PATH` shows `REALM_NOT_ACTIVE` and starts no daemon.
- `realm host install omp --dry-run` and `install` write exactly one file under `extensions/realm/`; `realm host status omp` reports installed; `omp plugin list --json` lists nothing.
- With no daemon and no realm up, Omp loads the installed shim, the plugin starts the daemon and the sandbox, and status becomes realm active; 1 live session while running, 0 after.
- A directory outside the policy roots paints `POLICY_DENIED` and creates no sandbox.
- Uninstall leaves the profile byte-identical; `realm down` leaves no container or sandbox.

## Findings

- The daemon needs the account's `HOME`: with an isolated `HOME` the sandbox stop failed with `AGENTOS_STOP_FAILED`. The test now gives Omp the account `HOME` and isolates only `PI_CODING_AGENT_DIR`.
- The first live attempts also failed for a test bug: cleanup ran `realm down` on a directory that had been removed, which the CLI refuses with `POLICY_DENIED`. Fixed in the test, not in product code.

## Not verified here

- Duplicate-load refusal against a real `omp plugin install` link (offline tests only).
- A cold stack (the rehearsal ran on the production stack with images present).
- Hosts other than Omp; Omp versions other than 18.22.0.

## Deviations from plan

`src/host/bundle.ts`, listed in the plan's files, does not exist on main; the bundle logic lives in `src/host/adapter.ts` and `src/host/recipe.ts`.

---
phase: 22-omp-plugin-on-boot
verified: 2026-11-17
verdict: passed
status: passed
score: 8/8 requirements covered (OMPB-01 to OMPB-08); one live rehearsal on Omp 18.22.0 passed; 4 claims outside the evidence reach, listed as behavior_unverified
ref: origin/main 4dfefff (PR 106 squash 819014d, plans 22-01 to 22-03; PR 108 live test)
behavior_unverified: 4
overrides_applied: 0
covered_files:
  - ".planning/phases/22-omp-plugin-on-boot/22-01-PLAN.md"
  - ".planning/phases/22-omp-plugin-on-boot/22-01-SUMMARY.md"
  - ".planning/phases/22-omp-plugin-on-boot/22-02-PLAN.md"
  - ".planning/phases/22-omp-plugin-on-boot/22-02-SUMMARY.md"
  - ".planning/phases/22-omp-plugin-on-boot/22-03-PLAN.md"
  - ".planning/phases/22-omp-plugin-on-boot/22-03-SUMMARY.md"
  - ".planning/phases/22-omp-plugin-on-boot/22-CONTEXT.md"
  - "adapters/omp/index.js"
  - "docs/hosts/snippets/omp.md"
  - "docs/integration/host-plugin-contract.md"
  - "docs/integration/omp.md"
  - "scripts/check/export-usage-allowlist.json"
  - "scripts/check/pack-smoke.mjs"
  - "src/cli/host.ts"
  - "src/cli/main.ts"
  - "src/daemon/node-runtime.ts"
  - "src/doctor/checks.ts"
  - "src/doctor/host-checks.ts"
  - "src/host/adapter.ts"
  - "src/host/boot.ts"
  - "src/host/presence.ts"
  - "src/host/recipe.ts"
  - "src/host/runtimes.ts"
  - "src/host/types.ts"
  - "src/omp/extension.ts"
  - "src/omp/host-tools.ts"
  - "src/omp/plugin.ts"
  - "src/omp/tools.ts"
  - "test/cli/host.test.ts"
  - "test/daemon/node-runtime.test.ts"
  - "test/doctor/host-checks.test.ts"
  - "test/host/adapter.test.ts"
  - "test/host/boot.test.ts"
  - "test/host/omp-recipe.test.ts"
  - "test/host/presence.test.ts"
  - "test/host/runtimes.test.ts"
  - "test/integration/omp-boot-install.test.ts"
  - "test/omp/boot-conformance.test.ts"
  - "test/omp/plugin.test.ts"
  - "test/support/host-boot-conformance.ts"
  - "test/support/omp-boot-hook.ts"
covered_digest: "v3:sha256:6db7081f67e72d0ee9c9891065e36b172117accac29116ce24fdd0d8bb39eb3e"
---

# Phase 22: Omp plugin on boot: Verification at 4dfefff

**Goal:** Omp runs on the Phase 21 host contract (one copy of the boot rules, conformance cases C1 to C9 run against the real plugin), has a real install recipe (`realm host install omp` writes a shim, with refusals), opens Realm automatically at session start (including under a Bun host), reports its state through doctor and `realm host status omp`, and the behavior is rehearsed live.

**verdict: passed.** Every requirement traces to code and a test on `origin/main`; CI on both PR heads passed, and the live rehearsal on 2026-11-17 against Omp 18.22.0 on the production stack passed. The boundaries of that rehearsal are listed under behavior_unverified and must not be read as proven.

Method: read of the repository at `4dfefff` (read-only: file existence, `src/omp`, `src/host`, `adapters/omp`, `docs/integration/omp.md`), plus the CI and live results reported by the orchestrator. The verifier did not run the build, lint or tests. CI on the heads of PR 106 and PR 108: Verify on Node 22.x and 24.x, the docs site build and the dependency audit passed.

## Requirements coverage

| Req | Statement | Status | Evidence |
| --- | --- | --- | --- |
| OMPB-01 | Omp reads every boot bound, code list, re-attach table and jitter from `src/host/boot.ts`; `src/omp/reattach.ts` and the `src/omp` bound constants are gone; parity tests deleted | SATISFIED | `src/omp/reattach.ts` is absent; `src/omp/plugin.ts` imports from `../host/boot.js`; the bound constants survive only as test-local aliases of `BOOT_BOUNDS` in `test/omp/plugin.test.ts`; `test/host/boot.test.ts` keeps 'imports nothing from src/omp'. |
| OMPB-02 | The real Omp plugin passes harness cases C1 to C9; the four reference mutants still fail their cases | SATISFIED | `test/omp/boot-conformance.test.ts` runs `defineBootConformance` over `test/support/omp-boot-hook.ts` (real `createRealmPlugin` through an in-memory host API); mutants remain in `test/host/boot-conformance.test.ts`. Passed in CI. |
| OMPB-03 | Guard, status text, tool-set reconciliation and fail-closed default unchanged | SATISFIED | Pre-existing `test/omp/` and `test/integration/omp-*.test.ts` expectations pass in CI; the recorded change to them is import lines only. |
| OMPB-04 | `realm host install omp` writes the shim idempotently and atomically, records a receipt, supports `--dry-run`; uninstall removes only what the receipt owns | SATISFIED | `adapters/omp/index.js`, the omp entry in `src/host/runtimes.ts`, `src/host/adapter.ts`; `test/host/omp-recipe.test.ts` (fixture host, real import of the installed shim). Live: one file under `extensions/realm/`, uninstall leaves the profile byte-identical. |
| OMPB-05 | Install refuses with `POLICY_DENIED` and writes nothing for `extension-unbuilt` and `already-loaded`; foreign content, drift and symlinks keep their refusals | SATISFIED offline (see unverified item 1) | `src/host/recipe.ts` maps `extension-unbuilt`, `already-loaded` and `unsupported-path` (backslash package root) to `POLICY_DENIED`; `src/host/adapter.ts` throws each before any write; `test/host/omp-recipe.test.ts`, `test/host/adapter.test.ts`. |
| OMPB-06 | With the shim installed and no env switch, session start attaches and spawns the daemon when none answers, including under a Bun host via an absolute-PATH Node; a Bun host with no Node refuses with `REALM_NOT_ACTIVE` and spawns nothing | SATISFIED | `findNodeBinary` in `src/daemon/node-runtime.ts`, used from `src/cli/main.ts`; `test/daemon/node-runtime.test.ts`. Live (Omp 18.22.0): no-Node session shows `REALM_NOT_ACTIVE` and starts no daemon; with the shim and no daemon the plugin starts the daemon and sandbox and status becomes realm active; `test/integration/omp-boot-install.test.ts`. |
| OMPB-07 | doctor (`host-plugins`) and `realm host status omp` report installed, shim target and live sessions (presence markers); status also reports duplicate-load; ids, states and counts only | SATISFIED | `src/host/presence.ts` (strict, bounded, symlink-safe), `src/omp/extension.ts` (onAttach, onSessionEnd), `src/doctor/host-checks.ts`, `src/cli/host.ts`; `test/host/presence.test.ts`, `test/doctor/host-checks.test.ts`, `test/cli/host.test.ts`. Live: status reports installed; 1 live session while running, 0 after. |
| OMPB-08 | Docs state shipped behavior with evidence tiers and the unproven boundary; allowlist has no stale or outdated entry; module-size, pack-smoke and docs gates pass | SATISFIED | `docs/integration/omp.md` ("Installed by `realm host install omp`", evidence tiers, live record), `docs/hosts/snippets/omp.md`, `docs/integration/host-plugin-contract.md`; `scripts/check/export-usage-allowlist.json` reconciled in PR 106; `scripts/check/pack-smoke.mjs`; docs site build and CI gates passed. |

## Plan must-have truths

All three plans' truths trace to the files above: 22-01 (no boot copies in `src/omp`, parity deleted, C1 to C9 on the real plugin, unchanged guard); 22-02 (single-file atomic install, shim import with unusual path characters, refusals, only omp has a recipe, single bundle token); 22-03 (Bun-host spawn rule, Node branch unchanged, reporting, four Omp events kept, presence never alters an attach outcome, allowlist, live rehearsal). The plan 22-03 file list names `src/host/bundle.ts`, which does not exist; the logic is in `src/host/adapter.ts` and `src/host/recipe.ts`, and no truth depends on that file.

## Live rehearsal, 2026-11-17

Omp 18.22.0 on the production stack, `test/integration/omp-boot-install.test.ts`, one test, passed: no-Node session shows `REALM_NOT_ACTIVE` and starts no daemon; install dry-run and install write one file under `extensions/realm/`; status reports installed; `omp plugin list --json` lists nothing; with no daemon and no realm up Omp loads the shim, the plugin starts the daemon and sandbox, status becomes realm active; 1 live session while running, 0 after; a directory outside the policy roots paints `POLICY_DENIED` and creates no sandbox; uninstall leaves the profile byte-identical; `realm down` leaves no container or sandbox.

Findings: the daemon needs the account's `HOME` (an isolated `HOME` made the sandbox stop fail with `AGENTOS_STOP_FAILED`; the test now isolates only `PI_CODING_AGENT_DIR`); the first live attempts also failed on a test bug (cleanup ran `realm down` on a removed directory, `POLICY_DENIED` at the CLI), fixed in PR 108.

## behavior_unverified (4)

1. **Duplicate-load refusal against a real plugin link.** `already-loaded` and the status `conflicts` report are proven only against a link path created on a fixture host; no real `omp plugin install` link was made.
2. **A cold stack.** The rehearsal ran on the production stack with images present; a first start from nothing was not observed.
3. **Hosts other than Omp.** No other host has a recipe; the other 18 still refuse as recipe-pending (Phases 24 and 25).
4. **Omp versions other than 18.22.0.** The shim and status behavior were observed on one version only.

## Residuals (not verdict-blocking)

- **R1: planning bookkeeping.** `ROADMAP.md`, `STATE.md` and `REQUIREMENTS.md` (OMPB-01 to OMPB-08 shown as Planned) are updated by the orchestrator.
- **R2: presence is advisory.** A live marker means a process loaded the plugin and its last attach ended `attached` or `failed`; it is not a health signal (`realm status` is) and not containment.
- **R3: daemon boot wiring.** The production `bootHook` that opens Realm from a host's own boot is Phase 23, not this phase.
- **R4: counts not re-observed.** Test counts and mutant outcomes were not re-run for this report; they rest on the CI results above.

## Verdict

passed: Omp consumes the host boot contract and passes the conformance harness, the install recipe and refusals exist, auto-open works including under a Bun host, doctor and status report presence, the docs state their evidence tiers, and the live rehearsal on Omp 18.22.0 passed. Nothing in the phase is FAILED. The four items above are not proven and must not be claimed from this report.

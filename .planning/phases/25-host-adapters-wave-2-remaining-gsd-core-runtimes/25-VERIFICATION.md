---
phase: 25-host-adapters-wave-2-remaining-gsd-core-runtimes
verified: 2026-11-17
verdict: passed
status: passed
score: "8/8 requirements covered (WAVE2-01 to WAVE2-08); 16 of 19 hosts have a recipe, 3 are deferred by owner decision; proven on fixture hosts and CI; the wave 2 validator tier ran live for qwen 0.22.0 (PASS) and the helper test passed (32 pass, 0 fail, 8 skipped); 7 claims outside the evidence reach, listed as behavior_unverified"
ref: "origin/main 2540115 (PR 116 plans a34041a; PR 118 squash 2540115, plans 25-01 to 25-04)"
behavior_unverified: 7
overrides_applied: 0
covered_files:
  - ".planning/phases/25-host-adapters-wave-2-remaining-gsd-core-runtimes/25-CONTEXT.md"
  - ".planning/phases/25-host-adapters-wave-2-remaining-gsd-core-runtimes/25-01-PLAN.md"
  - ".planning/phases/25-host-adapters-wave-2-remaining-gsd-core-runtimes/25-01-SUMMARY.md"
  - ".planning/phases/25-host-adapters-wave-2-remaining-gsd-core-runtimes/25-02-PLAN.md"
  - ".planning/phases/25-host-adapters-wave-2-remaining-gsd-core-runtimes/25-02-SUMMARY.md"
  - ".planning/phases/25-host-adapters-wave-2-remaining-gsd-core-runtimes/25-03-PLAN.md"
  - ".planning/phases/25-host-adapters-wave-2-remaining-gsd-core-runtimes/25-03-SUMMARY.md"
  - ".planning/phases/25-host-adapters-wave-2-remaining-gsd-core-runtimes/25-04-PLAN.md"
  - ".planning/phases/25-host-adapters-wave-2-remaining-gsd-core-runtimes/25-04-SUMMARY.md"
  - "docs/hosts/snippets/deferred-hosts.md"
  - "docs/integration/host-plugin-contract.md"
  - "src/host/adapter.ts"
  - "src/host/runtimes.ts"
  - "src/host/types.ts"
  - "src/host/yaml-owned.ts"
  - "src/host/yaml-scan.ts"
  - "test/host/codebuddy-recipe.test.ts"
  - "test/host/hermes-recipe.test.ts"
  - "test/host/shadows.test.ts"
  - "test/host/wave2-json-recipes.test.ts"
  - "test/host/wave2-json-specifics.test.ts"
  - "test/host/yaml-owned.test.ts"
  - "test/host/yaml-scan.test.ts"
  - "test/integration/host-live-wave2.test.ts"
  - "test/support/host-live-wave2.ts"
---

# Phase 25 Verification: Host adapters wave 2 (the remaining GSD Core runtimes)

Method: read-only read of the repository at `2540115` (existence and content of the key files, the table rows in `src/host/runtimes.ts`, the `yaml-map` kind and the `shadows` field in `src/host/types.ts`, `src/host/yaml-scan.ts` and `src/host/yaml-owned.ts`, the gated live file and its script table, the deferred-hosts page and the contract page), plus the CI result and the live rehearsal results reported by the orchestrator. The verifier did not run the build, lint or tests. The code of this phase was written by agents without local compilation; CI was the gate and needed several rounds of fixes (lint, two helper-test failures from an unescaped regular expression and from `antigravity` now having a home, ten `yaml-scan` and `yaml-owned` test fixes where the scanner locates and `yaml-owned` decides ownership, and a yaml uninstall separator bug in the engine) before it passed on the PR 118 head. The live results below are reported by the orchestrator; their evidence is kept outside the repository and was not re-read by the closer.

Owner decisions of 2026-11-17: `windsurf`, `trae` and `zcode` are deferred (recipe null, install refuses `recipe-pending`, the docs record why); `pi` ships for pi 1.3 and later only.

## Requirements coverage

| Req | Statement | Status | Evidence |
| --- | --- | --- | --- |
| WAVE2-01 | `yaml-map` recipe kind, owned by key identity and parsed value, no comment marker; scanner refuses the D-25-04 cases; modules keep `recipe.ts` small | SATISFIED on fixtures | `src/host/yaml-scan.ts` (590 lines), `src/host/yaml-owned.ts` (284 lines), the `yaml-map` variant in `src/host/types.ts`, `test/host/yaml-scan.test.ts`, `test/host/yaml-owned.test.ts`; CI passed after the fixes noted above |
| WAVE2-02 | A table entry may carry `shadows`; install that would create the recipe file next to a shadow is refused `foreign-content`, not refused when the file exists | SATISFIED on fixtures | `shadows` in `src/host/types.ts`, `src/host/runtimes.ts` (validation) and `src/host/adapter.ts` (`shadowsRecipeFile`); `test/host/shadows.test.ts` |
| WAVE2-03 | Eight JSON recipes (cursor, copilot, qwen, augment, pi, cline, antigravity, kilo) proven on fixture hosts against recorded goldens | SATISFIED on fixtures | the eight `json-merge` rows in `src/host/runtimes.ts`; `test/host/wave2-json-recipes.test.ts`, `test/host/wave2-json-specifics.test.ts` |
| WAVE2-04 | `codebuddy` lifecycle including the `shadows` refusal and its skip when `.mcp.json` exists | SATISFIED on fixtures | the `codebuddy` row (`.mcp.json`, `CODEBUDDY_CONFIG_DIR`, shadows `mcp.json` in the config home and `.codebuddy.json` in the user's home); `test/host/codebuddy-recipe.test.ts` |
| WAVE2-05 | `hermes` lifecycle (`config.yaml`, `HERMES_HOME`, `mcp_servers.realm`) including a host-rewritten file that stays `ok` | SATISFIED on fixtures | the `hermes` row with a `yaml-map` recipe; `test/host/hermes-recipe.test.ts` |
| WAVE2-06 | 16 of 19 hosts have a recipe; `windsurf`, `trae`, `zcode` keep `recipe: null` and refuse as `recipe-pending`, pinned by name | SATISFIED | 16 rows with a `recipe` in `src/host/runtimes.ts`; the three deferred rows carry none and a reason comment; `test/host/runtimes.test.ts`, `test/host/adapter.test.ts`, `test/cli/host.test.ts` pin them |
| WAVE2-07 | A gated live file for the nine hosts with a skip reason per missing prerequisite; a hermetic helper test that always runs; antigravity's gap written down | SATISFIED as code; run for one host | `test/integration/host-live-wave2.test.ts`, `test/support/host-live-wave2.ts`, the extended `test/integration/host-live-helpers.test.ts`. Live 2026-11-17: qwen 0.22.0 PASS; the helper test passes (32 pass, 0 fail, 8 skipped); eight hosts skipped with named reasons |
| WAVE2-08 | Docs per host with file, shape, override, validator, project-level shadowing and tier, `deferred-hosts.md`, the contract table with 16 recipe hosts and 3 pending | SATISFIED | the ten snippets, `docs/hosts/snippets/deferred-hosts.md` and `docs/integration/host-plugin-contract.md` exist and carry the table and the owner approval; after the live run the contract page (evidence matrix, rehearsal sentence, Evidence limits), `docs/integration/hosts.md` and `docs/hosts/snippets/qwen.md` record the qwen 0.22.0 PASS and keep the other eight hosts as not run (R1 resolved) |

## Live rehearsal (2026-11-17, this machine, evidence kept outside the repo)

| Host | Result |
| --- | --- |
| qwen 0.22.0 | **PASS** (`REALM_LIVE_QWEN=1`): the real recipe installs into an isolated home, Qwen Code's own commands parse it, uninstall removes only what install created |
| pi, hermes, cursor, kilo, copilot, augment, codebuddy, cline | **skipped**, each with a named reason: opt-in not set, CLI not installed, pi 0.84.3 below the 1.3 floor, hermes CLI broken here. Not run |
| antigravity | no live tier; `agy` was never run |
| every wave 2 host | no production-stack (T3) tier exists |
| hermetic helper test | 32 pass, 0 fail, 8 skipped |

Earlier manual scratch observations (kilo, copilot, auggie, codebuddy, cline, pi 1.5.2, cursor-agent) were not made through `realm host install` and are not evidence of the recipes.

## behavior_unverified

1. **Eight hosts never ran through the gated tier.** For pi, hermes, cursor, kilo, copilot, augment, codebuddy and cline no host command has parsed what Realm's recipe wrote; the goldens rest on scratch observations or documentation. A skipped test is not a pass.
2. **antigravity was never run.** Its file (`~/.gemini/config/mcp_config.json`) and shape (no `type`) are documented only (three Google pages agree; GSD's own path disagrees); there is no live file for it.
3. **No production-stack (T3) tier for any wave 2 host.** Nothing shows a real Cursor, Copilot, Qwen Code, Augment, Pi, Cline, Antigravity, Kilo, CodeBuddy or Hermes starting Realm through `realm mcp --host &lt;id&gt;`. The qwen PASS shows that the host's own commands parse the entry, not that a session boots Realm.
4. **Cursor's config shape was hand-written.** `mcp.json` with `type: "stdio"` and no override variable is documented; the `cursor-agent` scratch observations were not through `realm host install` and the Cursor IDE was not observed.
5. **The pi floor cannot be enforced.** The recipe cannot read the host version; on a pi below 1.3 the install succeeds and the host ignores the file. The one pi on this machine (0.84.3) is below the floor and skipped.
6. **Version reach.** The qwen PASS covers Qwen Code 0.22.0 only; how newer versions of any wave 2 host rewrite the file (drift or normalising the entry, OQ-25-10 to OQ-25-12) is not known. The hermes YAML scanner was checked against recorded writer output and fixtures, not a working Hermes install (the CLI was broken here).
7. **Counts and the closer's own checks.** Test counts, lint, type and build results were not re-run for this report; they rest on CI and on the orchestrator's report. The live results were not re-read from their evidence.

Deferred, not unverified: `windsurf`, `trae` and `zcode` have no recipe by owner decision (OQ-25-01 to OQ-25-03). They refuse install as `recipe-pending` and change no file; nothing is claimed about them beyond that.

## Residuals (not verdict-blocking)

- **R1 (resolved): the evidence matrix.** `docs/integration/host-plugin-contract.md`, `docs/integration/hosts.md` and `docs/hosts/snippets/qwen.md` now record the 2026-11-17 qwen 0.22.0 PASS, the helper test result (32 pass, 0 fail, 8 skipped) and that the other eight gated hosts skipped with named reasons; the other nine snippets and matrix rows still say no result, which is accurate (not run).
- **R2: planning bookkeeping.** `ROADMAP.md`, `STATE.md` and `REQUIREMENTS.md` (WAVE2-01 to WAVE2-08, defined in `25-CONTEXT.md`) are updated by the orchestrator.
- **R3: R-25-01 and R-25-02 stand.** A workload can write a host's project-level configuration into the workspace and shadow Realm's entry (not mitigated), and the concurrent-writer window for running or GUI-owned hosts cannot be closed; both are recorded on the contract page.
- **R4: the README and the export-usage allowlist.** Plan 25-04 listed both; neither is in the PR 118 diff. CI passed without them, so no stale entry was reported.
- **R5: JSONC hosts refuse.** augment, codebuddy and kilo refuse a commented file as `unparseable` and name the host's own add command (OQ-25-06).

## Verdict

passed: the `shadows` guard, the `yaml-map` kind, the sixteen recipes, the three named deferrals, the gated live tier and the docs exist on `main` at `2540115`, CI passed on the PR 118 head, and the wave 2 validator tier ran live for qwen 0.22.0 and passed. Nothing in the phase is FAILED. The seven items above are not proven (the live qwen result is a recorded pass and is not one of them; it narrows items 3 and 6 only for qwen 0.22.0, and none of the seven became provable) and must not be claimed from this report: no claim follows that a real Cursor, Copilot, Augment, Pi, Cline, Antigravity, Kilo, CodeBuddy or Hermes accepts what Realm writes, and no claim that any wave 2 host boots Realm.

---
phase: 24-host-adapters-wave-1-claude-code-opencode-codex-kimi-cli
plan: 02
subsystem: host-recipes
tags: [host, recipes, claude, opencode, codex, kimi, kimi-code, goldens, fixtures]
requires: ["24-01"]
provides:
  - "Real install recipes for claude (user-level .claude.json), opencode (V1 key path in opencode.json), codex (the [mcp_servers.realm] table in config.toml), kimi (mcp.json) and the sibling kimi-code row (mcp.json), each replacing recipe: null"
  - "Per-host lifecycle proof on a fixture host: install, no-op, dry-run, drift, foreign content, hostile content, uninstall, doctor and status"
  - "Golden strings recorded from claude 2.1.322 and codex-cli 0.154.0 in isolated HOMEs; opencode and kimi goldens come from official documentation, with a source and date per string"
  - "src/host/toml-owned.ts (PR 114): the marker-free toml-table recipe, which owns one TOML table by its header"
affects: [src/host/runtimes.ts, src/host/recipe.ts, src/host/toml-owned.ts, src/host/toml-table.ts, src/host/adapter.ts, src/host/types.ts, test/support/host-config-goldens.ts, test/support/host-recipe-suite.ts, test/host/claude-recipe.test.ts, test/host/opencode-recipe.test.ts, test/host/codex-recipe.test.ts, test/host/kimi-recipe.test.ts, test/host/toml-owned.test.ts, test/host/runtimes.test.ts, test/host/adapter.test.ts, test/cli/host.test.ts, test/cli/host-wave1.test.ts]
key-files:
  created:
    - src/host/toml-owned.ts
    - test/support/host-config-goldens.ts
    - test/support/host-recipe-suite.ts
    - test/host/claude-recipe.test.ts
    - test/host/opencode-recipe.test.ts
    - test/host/codex-recipe.test.ts
    - test/host/kimi-recipe.test.ts
    - test/host/toml-owned.test.ts
    - test/cli/host-wave1.test.ts
  modified:
    - src/host/runtimes.ts
    - src/host/recipe.ts
    - src/host/toml-table.ts
    - src/host/adapter.ts
    - src/host/types.ts
    - test/host/runtimes.test.ts
    - test/host/adapter.test.ts
    - test/cli/host.test.ts
decisions:
  - "Ship a same-shaped kimi-code row beside kimi (OQ-24-01 default applied): Kimi CLI is archived; both flags resolve to a documented recipe and the successor is named"
  - "OpenCode gets the V1 key path (OQ-24-02 default applied); revisit when OpenCode drops V1 support"
  - "Project-level config shadowing by a workload is documented only, not mitigated (OQ-24-03 default applied; residual R-24-01)"
  - "Codex marker survival (OQ-24-05) was answered by the live run on 2026-11-17: comment markers do not survive Codex's own edits, so PR 114 replaced the text-block recipe with a marker-free toml-table recipe that owns [mcp_servers.realm] by its header"
  - "kimi has no binary detection; the recipe values equal defaultManifestFor(id).launch for all five recipe hosts"
requirements: [ADPT-04, ADPT-05, ADPT-06, ADPT-07]
metrics:
  tasks: 3
  completed: 2026-11-17
status: merged
---

# Phase 24 Plan 02: The four recipes and the kimi-code row Summary

Merged to main in PR 113 (squash `9212949`); the Codex recipe was replaced in PR 114 (`c157149`). Five of the 19 host rows now have a recipe: `claude`, `opencode`, `codex`, `kimi`, `kimi-code`. `omp` already had one.

## What shipped

- `src/host/runtimes.ts`: the five recipes. Claude merges one entry into `<home or CLAUDE_CONFIG_DIR>/.claude.json`; OpenCode into `<XDG_CONFIG_HOME or ~/.config>/opencode/opencode.json` (JSONC refused, a sibling `opencode.jsonc` untouched); Kimi into `~/.kimi/mcp.json` (`KIMI_SHARE_DIR`); Kimi Code into `~/.kimi-code/mcp.json` (`KIMI_CODE_HOME`); Codex into `<CODEX_HOME or ~/.codex>/config.toml`.
- `src/host/toml-owned.ts` (PR 114): `planTomlTableInstall`, `planTomlTableUninstall`, `ownedTomlTablePart`; the owned unit is the table `[mcp_servers.realm]`, found by header, with no marker comment. A pre-existing table is refused as foreign content, never duplicated; other tables, comments and blank lines survive byte-exact.
- Fixture proof per host in `test/host/{claude,opencode,codex,kimi}-recipe.test.ts` through the shared `test/support/host-recipe-suite.ts`; goldens in `test/support/host-config-goldens.ts`, each tagged with its source and date (claude 2.1.322 and codex-cli 0.154.0 recorded in isolated HOMEs on 2026-11-17).
- `test/cli/host-wave1.test.ts`: the five rows through the CLI.

## Observed

- Read of `origin/main` at `c157149`: `src/host/toml-owned.ts` exports the three functions above and `src/host/runtimes.ts` has a `kind: "toml-table"` recipe row; the four recipe tests and `test/host/toml-owned.test.ts` exist.
- CI on the head of PR 113 and of PR 114 passed (Verify on Node 22.x and 24.x, docs site build, dependency audit), after fix rounds.
- The marker-free Codex recipe was run against a real codex-cli 0.154.0 (validator tier, from the merged tree, 2026-11-17): 5 passed, 0 failed, 2 skipped (production tiers). Evidence is kept outside the repository; the closer did not re-read it.

## Not verified here

- opencode and kimi formats rest on official documentation (and an observation of OpenCode 1.19.5 recorded in the docs); no opencode or kimi executable was run.
- A later Codex version that reformats the owned table (quoting, key order) makes the entry `drifted`; this is residual R-24-04 in `docs/integration/host-plugin-contract.md`.
- Project-level shadowing (a workload writing `.mcp.json`, `.codex/config.toml`, `opencode.json` or `.kimi-code/mcp.json` in the workspace) is not mitigated.

## Deviations from plan

- **Codex recipe kind changed after merge.** The plan specified a `text-block` recipe with `# BEGIN realm host-plugin` and `# END realm host-plugin` markers and the `tomlTable` guard. The live run on 2026-11-17 showed `codex mcp add other` drops the BEGIN comment and keeps END, and `codex mcp remove realm` leaves an orphan END. PR 114 replaced it with the marker-free `toml-table` recipe. The Codex recipe tests were rewritten in that PR.
- **Code written without local compilation.** CI was the gate; fix rounds (lint, type errors, a stale allowlist entry, an `owns()` assertion) landed before merge.

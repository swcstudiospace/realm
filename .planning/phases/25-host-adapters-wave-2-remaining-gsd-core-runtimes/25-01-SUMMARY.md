---
phase: 25-host-adapters-wave-2-remaining-gsd-core-runtimes
plan: 01
subsystem: host-recipes
tags: [host, json-merge, cursor, copilot, qwen, augment, pi, cline, antigravity, kilo]
requires: ["24-04"]
provides:
  - "Eight json-merge rows in src/host/runtimes.ts (cursor, copilot, qwen, augment, pi, cline, antigravity, kilo) that replace recipe null: each registers realm mcp --host &lt;id&gt; in the host's own user-level MCP file, owned by key, with no engine change"
  - "Each recipe value equals defaultManifestFor(id).launch (command realm, never an absolute path) and the host's own canonical output where it was observed (copilot with tools and type local; augment with type stdio; qwen, pi and cline flat; kilo type local with an argv array); cursor and antigravity use the documented shape"
  - "The host's own override variable per row (COPILOT_HOME, QWEN_HOME, AUGMENT_CACHE_DIR, PI_CODING_AGENT_DIR, CLINE_DIR; kilo the base XDG_CONFIG_HOME plus kilo; cursor and antigravity none); antigravity has the home .gemini/config; kilo's .kilo is a detection-only skills home"
  - "String goldens with source, version and read date (test/support/host-config-goldens.ts), the shared recipe suite run against every real table row (test/host/wave2-json-recipes.test.ts) and per-host specifics: host-rewritten files, JSONC refusal, sibling kilo.jsonc untouched, the cline data/settings subdirectory (test/host/wave2-json-specifics.test.ts)"
affects: [src/host/runtimes.ts, test/support/host-config-goldens.ts, test/support/host-recipe-suite.ts, test/host/wave2-json-recipes.test.ts, test/host/wave2-json-specifics.test.ts, test/host/runtimes.test.ts, test/host/adapter.test.ts, test/cli/host.test.ts]
key-files:
  created:
    - test/host/wave2-json-recipes.test.ts
    - test/host/wave2-json-specifics.test.ts
  modified:
    - src/host/runtimes.ts
    - test/support/host-config-goldens.ts
    - test/support/host-recipe-suite.ts
    - test/host/runtimes.test.ts
    - test/host/adapter.test.ts
    - test/cli/host.test.ts
decisions:
  - "Ownership is by key identity, never by a comment marker: Copilot, Qwen and CodeBuddy were observed dropping comments from the JSON file they rewrite, and Codex orphaned a marker in Phase 24 (D-25-02)"
  - "A JSON file with comments or trailing commas (augment, kilo, any host) is refused unparseable with nothing written; no JSONC-aware merge in this phase (OQ-25-06)"
  - "pi ships for pi 1.3 and later only, approved by the owner 2026-11-17 (OQ-25-07); the recipe cannot check the host version"
  - "antigravity ships documented-only (OQ-25-04): three Google pages agree on ~/.gemini/config/mcp_config.json and the agy CLI was never run"
  - "cline is the Cline CLI only (OQ-25-08): the install creates data/settings under an existing ~/.cline and refuses config-home-missing when ~/.cline is absent"
requirements: [WAVE2-03]
metrics:
  tasks: 3
  completed: 2026-11-17
status: merged
---

# Phase 25 Plan 01: Eight JSON recipes for the wave 2 hosts Summary

Merged to main in PR 118 (squash `2540115`, one squash for plans 25-01 to 25-04; the plans themselves were merged in PR 116, `a34041a`). After this plan eight more hosts install, report status and uninstall through the existing `json-merge` primitive; the engine did not change.

## What shipped

- `src/host/runtimes.ts`: the `cursor`, `copilot`, `qwen`, `augment`, `pi`, `cline`, `antigravity` and `kilo` rows with homes, override variables, detection binaries and deep-frozen recipes. `mcpServers.realm` is the key for seven of them; `kilo` uses `mcp.realm` in `kilo.json` and never touches a sibling `kilo.jsonc`.
- `test/support/host-config-goldens.ts` (extended): the goldens, each with its source, host version and the date it was read.
- `test/host/wave2-json-recipes.test.ts` and `test/host/wave2-json-specifics.test.ts`: the shared lifecycle suite (install, no-op, dry-run, drift, foreign content, hostile content, symlinks, override, doctor, `realm host status`) and the per-host cases.
- `test/host/runtimes.test.ts`, `test/host/adapter.test.ts` and `test/cli/host.test.ts`: pins for the new rows (every recipe value equals `defaultManifestFor(id).launch`).

## Observed

- Read of `origin/main` at `2540115`: the eight rows exist in `src/host/runtimes.ts` with `json-merge` recipes of the shapes above; the two wave 2 JSON test files exist and `test/support/host-config-goldens.ts` carries the goldens.
- CI on the PR 118 head passed after several fix rounds (see Deviations).
- The recipes are exercised on fixture hosts only in this plan.

## Not verified here

- Cursor's shape (`type: "stdio"`, `~/.cursor/mcp.json`, no override variable) rests on documentation and a hand-written golden. The `cursor-agent` scratch observations were not made through `realm host install`, and the Cursor IDE was not observed.
- Antigravity's file and shape are documented only; `agy` was never run.
- The earlier scratch observations (kilo, copilot, auggie, cline, pi 1.5.2, cursor-agent) were manual runs of each host's own CLI, not runs through `realm host install`.
- That a real host reads the entry and starts Realm is a later plan's question (25-03, validator tier) and is only partly answered there.

## Deviations from plan

- **CI on the PR 118 squash needed several fix rounds before it passed.** The code was written without local compilation. Fixes that touched this plan's rows: a helper-test regular expression that was not escaped and a helper-test expectation that `antigravity` has no home (it now has `.gemini/config`), plus lint. The other fixes belong to plan 25-02.
- **Plan said 14 hosts with a recipe after this plan.** That held for this plan; plan 25-02 raised the count to 16.

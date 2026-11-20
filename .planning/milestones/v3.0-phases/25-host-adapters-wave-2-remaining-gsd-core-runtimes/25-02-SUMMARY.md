---
phase: 25-host-adapters-wave-2-remaining-gsd-core-runtimes
plan: 02
subsystem: host-engine
tags: [host, shadows, yaml-map, codebuddy, hermes, deferrals]
requires: ["25-01"]
provides:
  - "The table entry field shadows: an install that would CREATE the recipe file while a shadow path exists is refused foreign-content with nothing written (lstat, so a dangling symlink counts); it is not refused when the recipe file already exists; entries without the field behave as before (src/host/types.ts, src/host/runtimes.ts, src/host/adapter.ts)"
  - "The yaml-map recipe kind: src/host/yaml-scan.ts is a conservative line scanner that locates one block-style parent.child entry (every doubt is a refusal), and src/host/yaml-owned.ts decides ownership by key identity and the PARSED value with no comment marker; every byte outside the owned lines survives, in the file's own line ending"
  - "The codebuddy row: json-merge of mcpServers.realm into .mcp.json (CODEBUDDY_CONFIG_DIR) with shadows mcp.json in the config home and .codebuddy.json in the user's home"
  - "The hermes row: yaml-map of mcp_servers.realm into config.yaml (HERMES_HOME); a host-rewritten file (re-quoted, re-flowed entry, same parsed value) stays ok"
  - "The deferral pins: exactly 16 of the 19 hosts have a recipe and windsurf, trae and zcode keep recipe null, refuse install as recipe-pending and change no file; each is pinned by name in the tests"
affects: [src/host/types.ts, src/host/runtimes.ts, src/host/adapter.ts, src/host/recipe.ts, src/host/receipt.ts, src/host/yaml-scan.ts, src/host/yaml-owned.ts, test/support/host-yaml-cases.ts, test/support/host-recipe-suite.ts, test/support/host-config-goldens.ts, test/host/shadows.test.ts, test/host/codebuddy-recipe.test.ts, test/host/yaml-scan.test.ts, test/host/yaml-owned.test.ts, test/host/hermes-recipe.test.ts, test/host/runtimes.test.ts, test/host/adapter.test.ts, test/host/receipt.test.ts, test/cli/host.test.ts, test/doctor/host-checks.test.ts, test/host/recipe.test.ts, test/support/fixture-host.ts]
key-files:
  created:
    - src/host/yaml-scan.ts
    - src/host/yaml-owned.ts
    - test/support/host-yaml-cases.ts
    - test/host/shadows.test.ts
    - test/host/codebuddy-recipe.test.ts
    - test/host/yaml-scan.test.ts
    - test/host/yaml-owned.test.ts
    - test/host/hermes-recipe.test.ts
  modified:
    - src/host/types.ts
    - src/host/runtimes.ts
    - src/host/adapter.ts
    - src/host/recipe.ts
    - src/host/receipt.ts
    - test/support/host-recipe-suite.ts
    - test/support/host-config-goldens.ts
    - test/host/runtimes.test.ts
    - test/host/adapter.test.ts
    - test/host/receipt.test.ts
    - test/cli/host.test.ts
    - test/doctor/host-checks.test.ts
    - test/host/recipe.test.ts
    - test/support/fixture-host.ts
decisions:
  - "The YAML scanner locates and yaml-owned decides: the scanner never claims to parse YAML and refuses on a BOM, a NUL, a Unicode line break other than LF, a lone CR, mixed line endings, tab indentation, an anchor, alias, tag or merge key, a document marker, an unclosed quote or a line it cannot classify; ownership is the parsed value, not the scanner's opinion (D-25-04)"
  - "No comment marker anywhere: Hermes round-trips its file and re-quotes and re-flows the entry; the key and the parsed value survive that (the Codex lesson of Phase 24)"
  - "Foreign content is a refusal, not a merge: a duplicate parent or child, a parent that is a scalar, a flow mapping other than an empty one, or a sequence is refused and nothing is written; no new RealmError code and no new HostRefusalReason"
  - "windsurf, trae and zcode stay recipe null, approved by the owner 2026-11-17 (OQ-25-01 to OQ-25-03): windsurf was renamed and has two MCP files with the IDE unobserved, trae is three products with no official global MCP path, zcode is a GUI-owned Electron application with a shared native config"
  - "codebuddy install refuses to create .mcp.json next to a legacy mcp.json or ~/.codebuddy.json because a new .mcp.json hides the older servers (observed); the user moves or merges the legacy file themselves"
requirements: [WAVE2-01, WAVE2-02, WAVE2-04, WAVE2-05, WAVE2-06]
metrics:
  tasks: 3
  completed: 2026-11-17
status: merged
---

# Phase 25 Plan 02: The shadows guard, the yaml-map kind, CodeBuddy, Hermes and the deferral pins Summary

Merged to main in PR 118 (squash `2540115`, one squash for plans 25-01 to 25-04). The engine gained one table field and one recipe kind, and two hosts that needed them now install; with plan 25-01 the table holds 16 recipe hosts and 3 pending.

## What shipped

- `shadows` on a table entry, checked in `src/host/adapter.ts` before an install creates the recipe file; `src/host/runtimes.ts` validates it (at most four entries, each a safe relative path with base `home` or `config`).
- `src/host/yaml-scan.ts` (590 lines) and `src/host/yaml-owned.ts` (284 lines), so `src/host/recipe.ts` stays under the module-size limit; the `yaml-map` kind in `src/host/types.ts`.
- The `codebuddy` and `hermes` rows in `src/host/runtimes.ts`.
- The shared YAML case table `test/support/host-yaml-cases.ts`, `test/host/shadows.test.ts`, `test/host/codebuddy-recipe.test.ts`, `test/host/yaml-scan.test.ts`, `test/host/yaml-owned.test.ts`, `test/host/hermes-recipe.test.ts`, and the updated pins (16 recipe hosts, 3 pending, the three deferrals named).

## Observed

- Read of `origin/main` at `2540115`: `src/host/yaml-scan.ts`, `src/host/yaml-owned.ts`, the `shadows` field in `src/host/types.ts` and `src/host/runtimes.ts`, the `yaml-map` recipe on the `hermes` row, the `shadows` list on the `codebuddy` row, and the test files above exist; `windsurf`, `trae` and `zcode` have no `recipe`.
- CI on the PR 118 head passed after several fix rounds: ten `yaml-scan` and `yaml-owned` test fixes (the scanner locates, `yaml-owned` decides ownership, so the ownership assertions were corrected to that split) and a yaml uninstall separator bug, which was an engine fix.

## Not verified here

- The YAML scanner is conservative by design and was checked only against fixtures and recorded Hermes writer output. No real Hermes round trip was run through `realm host install`: the `hermes` CLI on the verification machine was broken (`hermes --version` fails asking for `hermes pm repair`, which was not run).
- The `shadows` guard rests on the observation that a new CodeBuddy `.mcp.json` hides older servers; that observation was a manual scratch run, not a run through `realm host install`.
- A later CodeBuddy or Hermes release that changes the file layout is not covered; that is expected to show as `drifted` or a refusal rather than silent damage, but it was not exercised against a real host.

## Deviations from plan

- **Ten test fixtures and one engine bug were fixed after the first CI runs.** The test fixes aligned assertions with the scanner and ownership split; the uninstall separator bug was in the engine and was fixed there.
- **Code written without local compilation.** CI was the gate; fix rounds landed before merge.

---
phase: 24-host-adapters-wave-1-claude-code-opencode-codex-kimi-cli
plan: 01
subsystem: host-engine
tags: [host, install-engine, home-roles, toml-guard, status, doctor]
requires: ["21-01", "22-01", "23-01"]
provides:
  - "Home roles (config, skills, mcp) in src/host/runtimes.ts and src/host/install.ts: an absolute envOverride moves the config and mcp homes and never the skills home; envBase moves OpenCode's home with XDG_CONFIG_HOME; installHome selects by role"
  - "src/host/install.ts reads owned files with ignoreBOM, so a leading UTF-8 byte order mark is kept and a BOM file is never rewritten without it"
  - "src/host/toml-table.ts: the conservative line scanner that finds a table or an ancestor key in a TOML file, used as a guard so an install never creates a duplicate table"
  - "realm host status reports an unreadable entry state (symlink, oversize, unparseable) instead of drifted, and a launch field (on-path or not-on-path) for an installed mcp-config host; the host-plugins doctor sentence carries the unreadable count"
affects: [src/host/types.ts, src/host/runtimes.ts, src/host/recipe.ts, src/host/toml-table.ts, src/host/adapter.ts, src/host/install.ts, src/cli/host.ts, src/doctor/host-checks.ts, test/host/runtimes.test.ts, test/host/toml-table.test.ts, test/host/recipe.test.ts, test/host/adapter.test.ts, test/host/install.test.ts, test/cli/host.test.ts, test/doctor/host-checks.test.ts]
key-files:
  created:
    - src/host/toml-table.ts
    - test/host/toml-table.test.ts
  modified:
    - src/host/types.ts
    - src/host/runtimes.ts
    - src/host/recipe.ts
    - src/host/adapter.ts
    - src/host/install.ts
    - src/cli/host.ts
    - src/doctor/host-checks.ts
    - test/host/runtimes.test.ts
    - test/host/recipe.test.ts
    - test/host/adapter.test.ts
    - test/host/install.test.ts
    - test/cli/host.test.ts
    - test/doctor/host-checks.test.ts
decisions:
  - "A home carries a role; the env override is applied per role so KIMI_SHARE_DIR moves Kimi's config home and not its skills home (D-24-01)"
  - "status says unreadable for a file Realm refused or could not parse; drifted is kept for a readable file whose owned part differs (D-24-09); no new error code"
  - "The TOML guard is a conservative line scanner, not a parser: when it cannot read a header it refuses rather than guesses"
  - "After PR 114 the scanner functions in src/host/toml-table.ts (tomlTableState and its table locator) are the base of the Codex toml-table recipe in src/host/toml-owned.ts (see 24-02); the text-block tomlTable guard field introduced here no longer exists on main"
requirements: [ADPT-01, ADPT-02, ADPT-03]
metrics:
  tasks: 3
  completed: 2026-11-17
status: merged
---

# Phase 24 Plan 01: Engine groundwork: home roles and env, BOM, TOML table guard, status honesty Summary

Merged to main in PR 113 (squash `9212949`, one squash for plans 24-01 to 24-04). The install engine can now place a host's MCP file where the host keeps it (Claude Code's `~/.claude.json` is outside `~/.claude`), and says `unreadable` instead of `drifted` when it cannot read what it owns.

## What shipped

- `src/host/runtimes.ts` and `src/host/install.ts`: home roles `config`, `skills`, `mcp`; the env override moves `config` and `mcp` homes only; `envBase` honours `XDG_CONFIG_HOME` for OpenCode; `installHome` selects by role. `resolveHomes` keeps its results for every existing entry.
- `src/host/install.ts`: the file reader decodes with `ignoreBOM`, so a leading byte order mark is preserved when Realm rewrites a file.
- `src/host/toml-table.ts`: the line scanner and the foreign-content refusal for a pre-existing table; nothing is written on refusal.
- `src/host/adapter.ts`, `src/cli/host.ts`, `src/doctor/host-checks.ts`: `unreadable` entry state, the `launch` field on `realm host status`, the doctor sentence with the unreadable count.
- Tests: `test/host/runtimes.test.ts`, `test/host/toml-table.test.ts`, `test/host/recipe.test.ts`, `test/host/adapter.test.ts`, `test/host/install.test.ts`, `test/cli/host.test.ts`, `test/doctor/host-checks.test.ts`.

## Observed

- Read of `origin/main` at `c157149` (PR 114 on top of the squash): every file named above exists; `src/host/toml-table.ts` exists and `src/host/types.ts` carries the `launch` field and the `unreadable` entry state, and `src/host/install.ts` decodes with `ignoreBOM`.
- CI on the PR head passed (Verify on Node 22.x and 24.x, docs site build, dependency audit), after several fix rounds (lint, type errors, a stale export-usage allowlist entry, an `owns()` assertion).

## Not verified here

- Behavior of the engine against a real host's files: only fixture homes in a temporary directory were used by this plan's tests; the live validator tier is plan 24-03.
- `launch` reports whether `realm` resolves on the `PATH` that `realm host status` sees, which is not necessarily the host's own `PATH`.
- The closer did not run the build, lint or tests.

## Deviations from plan

- **Code written without local compilation.** CI was the gate; the fix rounds landed before merge and the closer did not re-derive each fix.
- **The `text-block` `tomlTable` guard did not survive.** Plan 24-02 gave Codex the text-block recipe with this guard; PR 114 replaced that with a `toml-table` recipe (see 24-02 and 24-03) and `text-block` on `main` has no `tomlTable` field. The scanner in `src/host/toml-table.ts` stays in use. ADPT-02 as worded (a `text-block` recipe with `tomlTable`) is therefore met in intent by the `toml-table` recipe's foreign-content refusal, not by the original field.

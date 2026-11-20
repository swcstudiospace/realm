---
phase: 24-host-adapters-wave-1-claude-code-opencode-codex-kimi-cli
plan: 03
subsystem: host-live-rehearsal
tags: [host, live-rehearsal, validator-tier, production-tier, gated-tests]
requires: ["24-02"]
provides:
  - "test/support/host-live.ts: gate selection with named skip reasons, a stub realm on PATH, the isolated-HOME guard, version parsing and run descriptions"
  - "Gated live files test/integration/host-live-{claude,codex,opencode,kimi}.test.ts, each with a validator tier (the host's own listing command parses what the recipe wrote and launches the registered argv) and, where it can exist, a production tier (a real host boots Realm)"
  - "test/integration/host-live-helpers.test.ts: a hermetic test that always runs and covers skip-reason selection, the stub realm, the isolation guard and version parsing"
affects: [test/support/host-live.ts, test/integration/host-live-helpers.test.ts, test/integration/host-live-claude.test.ts, test/integration/host-live-codex.test.ts, test/integration/host-live-opencode.test.ts, test/integration/host-live-kimi.test.ts]
key-files:
  created:
    - test/support/host-live.ts
    - test/integration/host-live-helpers.test.ts
    - test/integration/host-live-claude.test.ts
    - test/integration/host-live-codex.test.ts
    - test/integration/host-live-opencode.test.ts
    - test/integration/host-live-kimi.test.ts
  modified: []
decisions:
  - "Every live tier skips with a named reason when its prerequisite is missing: the opt-in variable (REALM_LIVE_CLAUDE, REALM_LIVE_CODEX, REALM_LIVE_OPENCODE, REALM_LIVE_KIMI), an executable, a version, and for the production tier REALM_LIVE_PRODUCTION=1 and Podman 5.x"
  - "The live files run in an isolated HOME and a guard refuses a run whose home is the real one"
  - "Codex has no production tier: codex mcp list does not start servers (a named gap)"
  - "The first live Codex validator run failed and found a real defect (the comment-marker recipe); the fix is in PR 114 and the Codex live test was changed in that PR"
requirements: [ADPT-08]
metrics:
  tasks: 2
  completed: 2026-11-17
status: merged
---

# Phase 24 Plan 03: Gated live rehearsals Summary

Merged to main in PR 113 (squash `9212949`); the Codex live file was changed in PR 114 (`c157149`). The rehearsal code exists and is gated; the results below were produced by running it by hand on the verification machine on 2026-11-17. The evidence is kept outside the repository.

## What shipped

- `test/support/host-live.ts` and the hermetic `test/integration/host-live-helpers.test.ts`.
- The four gated files named above.

## Live results (2026-11-17, this machine, evidence kept outside the repo)

| Host | Tier | Result |
| --- | --- | --- |
| claude 2.1.322 | validator | 3/3 passed, run twice (the second from the merged tree, after PR 114): the real `claude mcp get` and `claude mcp list` parse and launch what the recipe wrote; the host's own add and remove interoperate with the recipe; `CLAUDE_CONFIG_DIR` moves the file |
| codex-cli 0.154.0 | validator, first run (comment-marker recipe) | **FAILED, and found a real defect**: `codex mcp add other` rewrites `config.toml`, drops the `# BEGIN realm host-plugin` comment and keeps `# END`; `codex mcp remove realm` removes the table and leaves an orphan END. Comment markers are unsafe for Codex |
| codex-cli 0.154.0 | validator, after PR 114 (run from the merged tree) | **5 passed, 0 failed, 2 skipped** (the production tiers: `REALM_LIVE_PRODUCTION` unset, and the Codex named gap). `codex mcp get\|list` parse the marker-free `[mcp_servers.realm]` table; after `codex mcp add other` and `codex mcp remove realm` install, status and uninstall stay consistent; after `codex mcp add realm` install refuses with `foreign-content` |
| every host | production | skipped: `REALM_LIVE_PRODUCTION` not set, and Podman 4.9.3 is below the required 5.x |
| codex | production | named gap: `codex mcp list` does not start servers |
| opencode | validator and production | skipped: opt-in not set, and no executable on this machine |
| kimi | validator and production | skipped: no functional Kimi CLI release exists (the last release is a deprecation stub) |
| kimi-code | validator | not available: no validator command is documented |

## Observed

- Read of `origin/main` at `c157149`: the six files above exist; `test/support/host-live.ts` names the four opt-in variables.
- CI on both PR heads passed. The live files skip without their opt-in, so CI runs only the hermetic helper test.

## Not verified here

- The Codex production tier has no runnable form (`codex mcp list` does not start servers, a session needs model credentials). The Codex validator test as it stands on `main` was run against a real codex-cli 0.154.0 on 2026-11-17, after PR 114; that run covers 0.154.0 only.
- No production-tier run for any host.
- No run of the opencode or kimi live files.

## Deviations from plan

- **The Codex assertions changed after the live run.** The plan's Codex test asserted that the marker block survived `codex mcp add other`; the live run disproved that, and PR 114 rewrote the test to assert that the owned table is byte-identical after `codex mcp add other` and that after `codex mcp remove realm` status is `missing` and uninstall is a no-op.
- **Code written without local compilation.** CI was the gate and the fix rounds landed before merge.

---
phase: 24-host-adapters-wave-1-claude-code-opencode-codex-kimi-cli
plan: 04
subsystem: host-docs
tags: [docs, host-snippets, evidence-matrix, allowlist, mcp-q8]
requires: ["24-02", "24-03"]
provides:
  - "A snippet per host (docs/hosts/snippets/{claude-code,opencode,codex,kimi}.md): the file, the shape, the override variable, the host's own validator, project-level behavior and the shadowing warning, recovery, and the evidence tier reached; Kimi CLI and Kimi Code are both covered and the flag resolution is recorded"
  - "docs/integration/host-plugin-contract.md: six hosts with a recipe, the unreadable state and launch field, the three evidence tiers with a per-host matrix, and residuals R-24-01 to R-24-04"
  - "docs/integration/mcp.md Q8: realm host install as the supported way to register realm mcp --host <host>"
  - "scripts/check/export-usage-allowlist.json without a stale entry"
affects: [docs/hosts/snippets/claude-code.md, docs/hosts/snippets/opencode.md, docs/hosts/snippets/codex.md, docs/hosts/snippets/kimi.md, docs/integration/host-plugin-contract.md, docs/integration/hosts.md, docs/integration/mcp.md, scripts/check/export-usage-allowlist.json]
key-files:
  created: []
  modified:
    - docs/hosts/snippets/claude-code.md
    - docs/hosts/snippets/opencode.md
    - docs/hosts/snippets/codex.md
    - docs/hosts/snippets/kimi.md
    - docs/integration/host-plugin-contract.md
    - docs/integration/hosts.md
    - docs/integration/mcp.md
    - scripts/check/export-usage-allowlist.json
decisions:
  - "The docs state each claim at its evidence tier (T1 offline fixture, T2 host validator, T3 live end to end) and say not run or gap where a tier was not reached"
  - "Kimi flag resolution: --kimi is Kimi CLI (Python, archived), --kimi-code is Kimi Code (Node); both recipes are documented and the successor is named"
  - "Workload-written project config shadowing is documented as residual R-24-01 and not mitigated (OQ-24-03 default applied)"
requirements: [ADPT-09]
metrics:
  tasks: 3
  completed: 2026-11-17
status: merged
---

# Phase 24 Plan 04: Docs, evidence matrix, mcp Q8, allowlist Summary

Merged to main in PR 113 (squash `9212949`); the Codex snippet, the contract page, `hosts.md` and the allowlist were corrected in PR 114 (`c157149`) to describe the marker-free Codex recipe.

## What shipped

- The four snippets, each with its observations dated 2026-11-17 and its sources named.
- The contract page: recipe table, commands, status states, the evidence matrix and residuals R-24-01 (project-level shadowing), R-24-02 (concurrent-writer window), R-24-04 (the Codex editor).
- `docs/integration/mcp.md` Q8 and the allowlist cleanup.

## Observed

- Read of `origin/main` at `c157149`: the four snippets, the contract page and `docs/integration/mcp.md` exist; the contract page lists `omp`, `claude`, `opencode`, `codex`, `kimi` and `kimi-code` as recipe hosts and its matrix has a row per wave 1 host; `docs/hosts/snippets/codex.md` states that Realm writes no marker comment.
- CI on both PR heads passed (docs site build included).

## Not verified here

- **The evidence matrix records the live validator results.** The contract page and the claude and codex snippets state the 2026-11-17 results for claude 2.1.322 (3/3, run twice) and codex-cli 0.154.0 (first run failed on the comment-marker recipe; the run after PR 114 passed 5 of 5 with 2 skipped). Production-tier, opencode and kimi statements are unchanged: not run or gap.
- The commands in the snippets were not re-run by the closer; they rest on the plan-time observations and the CI-tested recipes.

## Deviations from plan

- **Codex documentation rewritten after merge.** The first version described the comment-marker block; PR 114 replaced it with the header-owned table and kept the marker observation as evidence for why.

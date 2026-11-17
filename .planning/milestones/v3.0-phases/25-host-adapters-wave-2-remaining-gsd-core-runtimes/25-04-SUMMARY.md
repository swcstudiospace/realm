---
phase: 25-host-adapters-wave-2-remaining-gsd-core-runtimes
plan: 04
subsystem: docs
tags: [docs, host-snippets, deferred-hosts, evidence-matrix]
requires: ["25-01", "25-02", "25-03"]
provides:
  - "Ten snippets (nine new, one section added to hermes-agent.md): docs/hosts/snippets/{cursor,copilot,qwen,augment,pi,cline,antigravity,kilo,codebuddy,hermes-agent}.md, each with the file, the shape, the override, the validator command, what the host does when it rewrites the file, the project-level shadowing warning, the evidence tier reached and the gaps"
  - "docs/hosts/snippets/deferred-hosts.md: windsurf, trae and zcode with the reason, the evidence, the alternative and the decision that would lift each (OQ-25-01 to OQ-25-03, approved 2026-11-17)"
  - "docs/integration/host-plugin-contract.md: the 19-host table with 16 recipe hosts and 3 pending, the Phase 25 recipes, the yaml-map kind and shadows, the evidence matrix, the residuals R-25-01 and R-25-02 and the open owner decisions OQ-25-01 to OQ-25-12; docs/integration/hosts.md, docs/integration/mcp.md and the AGENTS pointer line"
affects: [docs/hosts/snippets/cursor.md, docs/hosts/snippets/copilot.md, docs/hosts/snippets/qwen.md, docs/hosts/snippets/augment.md, docs/hosts/snippets/pi.md, docs/hosts/snippets/cline.md, docs/hosts/snippets/antigravity.md, docs/hosts/snippets/kilo.md, docs/hosts/snippets/codebuddy.md, docs/hosts/snippets/hermes-agent.md, docs/hosts/snippets/deferred-hosts.md, docs/integration/host-plugin-contract.md, docs/integration/hosts.md, docs/integration/mcp.md, AGENTS.md]
key-files:
  created:
    - docs/hosts/snippets/cursor.md
    - docs/hosts/snippets/copilot.md
    - docs/hosts/snippets/qwen.md
    - docs/hosts/snippets/augment.md
    - docs/hosts/snippets/pi.md
    - docs/hosts/snippets/cline.md
    - docs/hosts/snippets/antigravity.md
    - docs/hosts/snippets/kilo.md
    - docs/hosts/snippets/codebuddy.md
    - docs/hosts/snippets/deferred-hosts.md
  modified:
    - docs/hosts/snippets/hermes-agent.md
    - docs/integration/host-plugin-contract.md
    - docs/integration/hosts.md
    - docs/integration/mcp.md
    - AGENTS.md
decisions:
  - "The deferrals are recorded as decisions, not defects: windsurf (renamed Devin Desktop, two MCP files, IDE unobserved), trae (three products, no official global MCP path) and zcode (GUI-owned native config) each keep refusing install as recipe-pending; each page entry names what would lift it (D-25-02)"
  - "pi is documented as valid for pi 1.3 and later only, with the warning that on an older pi the install succeeds and the host ignores the file (OQ-25-07)"
  - "The docs state evidence tiers per host (T1 fixture, T2 host validator, documented-only) and never claim a live Realm session for a wave 2 host (OQ-25-09)"
  - "R-25-01 (project-level shadowing by the ten Phase 25 hosts: a workload can write a host's project-level configuration into the workspace) and R-25-02 (the concurrent-writer window for GUI-owned or running hosts) are recorded and not mitigated"
requirements: [WAVE2-08]
metrics:
  tasks: 3
  completed: 2026-11-17
status: merged
---

# Phase 25 Plan 04: Docs, evidence matrix and deferred hosts Summary

Merged to main in PR 118 (squash `2540115`, one squash for plans 25-01 to 25-04). An operator can read, per host, which file changes, what the host does to it, what is refused and what has been shown.

## What shipped

- The ten snippets and `docs/hosts/snippets/deferred-hosts.md`.
- The contract page: 19-host table (16 recipe hosts, 3 pending), decision table, `yaml-map` and `shadows`, evidence matrix, residuals and open owner decisions.
- `docs/integration/hosts.md`, `docs/integration/mcp.md` and the `AGENTS.md` pointer line. The README and `scripts/check/export-usage-allowlist.json` were planned but are not in the PR 118 diff.

## Observed

- Read of `origin/main` at `2540115`: the ten snippets, `deferred-hosts.md` and the contract page exist; the contract table lists `windsurf`, `trae` and `zcode` as deferred (OQ-25-01 to OQ-25-03) and the other recipe hosts with their file, home and override; the contract page and the deferred-hosts page record the owner approval of 2026-11-17.
- CI on the PR 118 head passed.

## Not verified here

- **The evidence matrix was stale for qwen and is now updated.** PR 118 said the gated rehearsal records no result yet. After the 2026-11-17 live run (qwen 0.22.0 PASS), the contract page (evidence matrix, rehearsal sentence, Evidence limits), `docs/integration/hosts.md` and `docs/hosts/snippets/qwen.md` were updated in the closing change; the other eight gated hosts stay as not run.
- The commands in the snippets were not re-run by the closer; they rest on the plan-time observations and the CI-tested recipes.
- The snippet claims about Cursor and Antigravity are documented-only.

## Deviations from plan

- **A doc claim the live run later outdated.** The docs were written before the 2026-11-17 live run; the closing change folded the qwen result into them (see Not verified here).

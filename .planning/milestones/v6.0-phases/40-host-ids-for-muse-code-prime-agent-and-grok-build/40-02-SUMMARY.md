---
phase: 40-host-ids-for-muse-code-prime-agent-and-grok-build
plan: "02"
requirements: [HOSTID-01, HOSTID-02, HOSTID-03]
---

# 40-02 summary: three host ids, recipes and labelled launchers

Landed as PR 196 (`dbd42cf`) on 2026-11-18 (46 files, 894 insertions, 206 deletions).

## What changed

- `src/host/types.ts`, `src/host/runtimes.ts`, `src/host/boot-report.ts`, `src/cli/host.ts`, `src/core/policy.schema.json`: `muse-code`, `prime-agent` and `grok-build` are in the closed host list (19 to 22 hosts), in the `profiles` schema enum and in the runtime table (one row each, tier `config-only`), and therefore, by derivation, in the default manifests (21 `mcp-config` hosts), the boot report vocabulary, presence markers, receipts, token and gate checks, `realm host list` and `--host`. `realm host install|uninstall|status ID` work for all three: `muse-code` (`json-merge`, `settings.json` below `XDG_CONFIG_HOME/muse`, key `mcpServers.realm`, `required: true`, with the seed and the rival key of plan 40-01), `prime-agent` (`json-merge`, `settings.json` of the agent directory, override `PRIME_AGENT_CODING_AGENT_DIR`) and `grok-build` (`toml-table`, `config.toml` below `.grok`, the multi-line table `grok mcp add` writes).
- Shipped launchers carry the label: `adapters/muse-code/mcp-settings.snippet.json` (respelled to `mcpServers`, with `schema_version` and `required`) and `adapters/prime-agent/MCP.md`; `adapters/claude-plugin` stays `--host claude`. `test/host/adapters-labelled.test.ts` lost its named exception for the three hosts and now names only the shared Grok bundle (GAP-40-01).
- New suites and goldens: `test/host/muse-code-recipe.test.ts`, `prime-agent-recipe.test.ts`, `grok-build-recipe.test.ts`, `test/support/host-config-goldens.ts` (bytes the hosts' own writers produced), about 25 pinned test and script updates for the new counts (22, 19, 21, 18).
- `test/integration/enforce-default.test.ts`: the daemon-side proof, over a real control socket and the default `enforce` mode with no policy edit, that each of the 21 ids attaches and completes a tool call, and that the audit names the host.
- Documents kept true: `docs/integration/host-plugin-contract.md` (Phase 40 recipes section, counts), `host-plugin-gaps.md` (GAP-34-01 closed, GAP-40-01 new), `host-support-matrix.md` (regenerated), `docs/policy-reference.md`, `AGENTS.md`, `README.md` and the three snippet pages (the minimum; plan 40-03 wrote the rest).

## Limits

No evidence record and no live run in this plan. The proof of attach is at the daemon; a real host process reading the entry is plan 40-03. No `daemon.ts`, `main.ts`, wire, error-code or version change.

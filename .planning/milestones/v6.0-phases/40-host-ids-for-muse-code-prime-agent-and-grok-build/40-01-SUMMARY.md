---
phase: 40-host-ids-for-muse-code-prime-agent-and-grok-build
plan: "01"
requirements: [HOSTID-01]
---

# 40-01 summary: the json-merge extension and the multi-line argument reader

Landed as PR 192 (`8c4c62b`) on 2026-11-18, before any host id existed. The plan added no host: the closed host list, the schema enum and every pinned count stayed as they were, so the change was green on its own.

## What changed

- `src/host/types.ts`, `src/host/recipe.ts` (about 54 lines changed in the recipe): the `json-merge` recipe takes two optional members. `seed` writes top-level members (for Muse Code, `schema_version: 1`) only into a file Realm creates, never into an existing file; uninstall removes a file that holds nothing but the seed. `refuseIfPresent` refuses an install or reinstall as `foreign-content` while a named rival top-level key is present (for Muse Code, the older `mcp_servers` spelling). No new refusal reason, receipt field, error code or state was added.
- `test/support/host-contract.ts`: the contract checker reads the multi-line `args` array that Grok Build writes (it read it as no argument list before), with mutant rows in `test/host/host-contract-matrix.test.ts`.
- `test/host/recipe.test.ts` and `test/support/host-recipe-suite.ts`: rows for the two members and two descriptor members in the shared recipe suite.

## Why

Muse Code refuses to start with a settings file that has no `schema_version` member (E-40-04), and a file that holds both `mcp_servers` and `mcpServers` makes every `muse mcp` command fail with `ambiguous_user_key` (E-40-05); a plain `json-merge` handles neither (E-40-11). Grok Build's owned table has a multi-line array (E-40-12).

## Checks and limits

The plan's own checks ran in its pull request. The registry of hosts, `src` boot paths and the schema are untouched by this plan; plan 40-02 uses the two members for the `muse-code` row only.

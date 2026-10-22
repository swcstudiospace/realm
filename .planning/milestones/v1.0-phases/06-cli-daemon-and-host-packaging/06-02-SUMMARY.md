# Phase 06 Plan 02: Host Snippets from Documented Fields — Summary

phase: 06-cli-daemon-and-host-packaging
plan: 06-02
subsystem: docs-hosts
tags: [CLI-04, P6-D8, P6-D9, host-snippets, evidentiary-docs]
status: complete

## One-liner

hosts.md gains the Muse Code official record (read 2026-10-22); five host
snippets point at the `realm mcp` stdio entry using only documented fields;
an eight-test CLI-04 suite asserts the exact cited strings.

## Tasks completed

1. hosts.md Muse Code update (P6-D8): gate-table row, read-date line, three
   official URLs, sourced Q1–Q5, open-question entry. All other host sections
   untouched.
2. Omp and Muse Code snippets written from their host notes only.
3. Claude Code, Grok Build, Hermes Agent snippets plus
   test/docs/host-snippets.test.ts (8 tests, CLI-04 titles, exact-string
   assertions, no-credential sweep).

## Files changed

- docs/integration/hosts.md (extended: Muse Code row, read date, URLs, Q1–Q5)
- docs/hosts/snippets/omp.md (new)
- docs/hosts/snippets/muse-code.md (new)
- docs/hosts/snippets/claude-code.md (new)
- docs/hosts/snippets/grok-build.md (new)
- docs/hosts/snippets/hermes-agent.md (new)
- test/docs/host-snippets.test.ts (new)

## Decisions

- Omp snippet is prose-only (no JSON block): the exact stdio key layout inside
  the manifest `mcpServers` entry is unverified, so per P6-D8 no keys are shown.
- Grok snippet routes through the documented Claude Code compatibility read
  ("Grok automatically reads Claude Code ... MCPs") instead of inventing a
  `~/.grok/config.toml` MCP key.
- Every snippet marks its host's silent areas not-documented (Omp key layout,
  Muse/Claude/Grok ACP, Grok direct key and manifest format, ACP-as-consumer
  for Hermes).

## Externally verified facts (read with the read tool, 2026-10-22)

- https://dev.meta.ai/docs/muse-code/extending — `mcp_servers` block;
  `transport` stdio (command/args/env) or streamable_http (url/headers);
  every server takes `enabled` and `mode` (required default); stdio `framing`;
  `${VAR}` interpolation; `MUSE_SESSION_ID`; `/mcp`; `muse mcp login/logout`.
- https://dev.meta.ai/docs/muse-code/configuration — settings at
  `~/.config/muse/settings.json`; must set `"schema_version": 1`.
- https://dev.meta.ai/docs/muse-code — native `muse` binary installer; no Node
  or Bun floor stated; SDK via `npm install @muse-code/sdk`.
- https://code.claude.com/docs/en/mcp.md — `claude mcp add <name> -- <cmd>`;
  local/project/user scopes; `.mcp.json` `mcpServers` project entries (no
  `type` reads as stdio); Pending-approval for project scope.
- https://docs.x.ai/build/features/skills-plugins-marketplaces — MCP from
  enabled plugins; plugin directory list; Claude Code MCP auto-read;
  `grok inspect`; no direct MCP key in the pages read.
- https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp —
  `mcp_servers` in `~/.hermes/config.yaml`; stdio command/args/env minimal
  shape; `tools.include`/`exclude`; `hermes chat`; `hermes acp` is
  Hermes-as-server only. Note: the `.md`-suffix form of this URL 404s; the
  page was read without the suffix.

## Deviations from plan

1. Test helper shape: two one-expression read wrappers were merged into a
   single `readDoc(...segments)` helper (9 call sites, lockstep path join)
   to satisfy the ts-no-tiny-functions style rule. Same assertions.
2. Claude snippet approval sentence reworded to "Pending approval" prose to
   avoid nested backticks that broke the JSON fence. Same documented fact.
3. Hermes test assertions use the YAML key form (`command: "realm"`,
   `args: ["mcp"]`) to match the snippet's YAML block exactly.
4. Verification by read-only grep only: the shared constraints for this task
   forbid running tests, typecheck, or git commands, so `npx tsc` /
   `node --test` were not run. The orchestrator owns the gate. Every string
   the suite asserts was confirmed present (and Bearer/Authorization absent)
   via read-only search.

## Not completed

- Automated verify (`tsc` + `node --test dist/test/docs/host-snippets.test.js`)
  intentionally not run per task constraints; left to the orchestrator wave gate.

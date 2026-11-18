---
phase: 31-production-stack-boot-rehearsals-for-wave-1-hosts
plan: "01"
subsystem: host-boot-rehearsal-harness
tags: [host, boot, production-stack, wire-recorder, codex-session, gaps, boot-matrix]
requires: []
provides:
  - "test/support/host-live-session.ts: the refusing loopback provider, the Codex session arguments, the wire recorder (a realm shim that forwards the host's stdio byte for byte and logs method names and tool names only), a fake MCP stdio server, and runHostUntil (a process-group runner that waits for a condition instead of an exit)"
  - "test/integration/host-live-session-helpers.test.ts: the always-running hermetic test of every helper above"
  - "test/integration/host-live-codex.test.ts: two Codex validator-tier session tests (no Podman) and the Codex production test"
  - "test/support/host-live.ts: runHostProduction takes an optional session drive, records the wire for claude, codex and opencode, and HOST_LIVE.codex has a production tier"
  - "docs/integration/wave1-boot-matrix.md and test/docs/wave1-boot-matrix.test.ts: the five wave 1 hosts, one row each, tied to the registry"
  - "docs/integration/host-plugin-gaps.md: GAP-24-01 and GAP-24-02 rewritten for the real situation, and GAP-31-01 to GAP-31-03"
key-files:
  created:
    - test/support/host-live-session.ts
    - test/integration/host-live-session-helpers.test.ts
    - test/docs/wave1-boot-matrix.test.ts
    - docs/integration/wave1-boot-matrix.md
  modified:
    - test/support/host-live.ts
    - test/support/host-registry.ts
    - test/integration/host-live-codex.test.ts
    - test/integration/host-live-helpers.test.ts
    - test/docs/host-gaps.test.ts
    - test/docs/host-docs.test.ts
    - docs/integration/host-plugin-gaps.md
    - docs/integration/host-support-matrix.md
    - docs/integration/host-plugin-contract.md
    - docs/integration/hosts.md
    - docs/hosts/snippets/codex.md
    - docs/hosts/snippets/kimi.md
    - README.md
decisions:
  - "Codex is driven by `codex exec` against a loopback provider that refuses every request, because Codex starts its registered MCP servers before its first model request and needs no credential for that (31-CONTEXT E-31-4, D-31-02)"
  - "The evidence that tools were listed is a client-side wire record, not a claim: method names and, for the tools/list response, tool names only"
  - "No file under src changed; no recipe changed"
---

# Plan 31-01 Summary: the harness and the named gaps

Landed on `main` as `8a687e4` (PR 136). Test support, tests and docs only.

## What shipped

- The wire recorder, the refusing loopback provider, the Codex argument list, the fake MCP server and `runHostUntil` in `test/support/host-live-session.ts`, with a hermetic test that always runs.
- `runHostProduction` gained an optional session drive (Codex) and records the wire for every host.
- The Codex validator-tier session tests and the Codex production test.
- The wave 1 boot matrix page, its test against the registry, and the gap rows GAP-24-01, GAP-24-02, GAP-31-01, GAP-31-02, GAP-31-03.
- The Kimi Code facts read from the official pages on 2026-11-17 (`docs/hosts/snippets/kimi.md`).

## Observed

- The two Codex validator session tests passed against codex-cli 0.154.0 on 2026-11-17 (reported by the live runner; evidence kept outside the repository). The registered stdio server was launched, saw initialize and tools/list, and without the `env_vars` override saw only `HOME`, `LANG` and `PATH` (GAP-31-01).

## Not verified here

- The default CI result of the PR is the only evidence for the hermetic tests; the writer did not run them.
- Nothing in this plan ran on the production stack; that is plan 31-02.

## Deviations from plan

- The opencode row of the boot matrix is `not-run`, not `gap`, because the registry rule and the matrix test tie the disposition to the registry status.
- After the first live runs, test-support fixes followed on `main` (project directory order, the OpenCode uninstall and jsonc contract, the warm-up, the cleanup, the production `PATH` order and the modern handshake). They are recorded in `31-02-SUMMARY.md`.

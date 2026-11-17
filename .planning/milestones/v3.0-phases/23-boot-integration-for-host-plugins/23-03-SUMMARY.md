---
phase: 23-boot-integration-for-host-plugins
plan: 03
subsystem: stdio-host-boot-and-closure
tags: [stdio, observer, realm-mcp, realm-acp, omp, isolation, docs, allowlist]
requires: ["23-01", "23-02"]
provides:
  - "src/host/boot-observer.ts: createBootObserver, one best-effort observer (log line, presence marker, host-boot report) shared by Omp and the stdio hosts"
  - "src/cli/stdio-host.ts: runStdioHost, the numbered boot sequence, exit contract and teardown of realm mcp and realm acp"
  - "realm mcp|acp [--workspace <path>] [--host <id>] [--reattach] in src/cli/main.ts"
  - "src/omp/extension.ts adopts the shared createDaemonAttach (verified mode) and the shared observer"
  - "test/integration/host-boot-isolation.test.ts: per-host failure isolation against a real daemon over fakes"
  - "docs/integration/host-plugin-contract.md Boot integration section with evidence tiers; mcp, acp, hosts and omp docs updated; export-usage allowlist reconciled"
affects: [src/host/boot-observer.ts, src/cli/stdio-host.ts, src/cli/main.ts, src/omp/extension.ts, scripts/check/export-usage-allowlist.json, scripts/check/mcp-smoke.mjs, scripts/check/mcp-smoke.test.mjs, docs/integration/host-plugin-contract.md, docs/integration/mcp.md, docs/integration/acp.md, docs/integration/hosts.md, docs/integration/omp.md, AGENTS.md, test/host/boot-observer.test.ts, test/host/boot-no-down.test.ts, test/host/boot-boundaries.test.ts, test/cli/stdio-host.test.ts, test/cli/mcp-attach.test.ts, test/cli/cli.test.ts, test/omp/extension.test.ts, test/integration/host-boot-isolation.test.ts]
key-files:
  created:
    - src/host/boot-observer.ts
    - src/cli/stdio-host.ts
    - test/host/boot-observer.test.ts
    - test/host/boot-boundaries.test.ts
    - test/cli/stdio-host.test.ts
    - test/integration/host-boot-isolation.test.ts
  modified:
    - src/cli/main.ts
    - src/omp/extension.ts
    - scripts/check/export-usage-allowlist.json
    - scripts/check/mcp-smoke.mjs
    - scripts/check/mcp-smoke.test.mjs
    - docs/integration/host-plugin-contract.md
    - docs/integration/mcp.md
    - docs/integration/acp.md
    - docs/integration/hosts.md
    - docs/integration/omp.md
    - AGENTS.md
    - test/host/boot-no-down.test.ts
    - test/cli/mcp-attach.test.ts
    - test/cli/cli.test.ts
    - test/omp/extension.test.ts
decisions:
  - "realm mcp and realm acp serve nothing before the boot sequence settles (serve-after-boot); a terminal failure exits 1 with its catalogue code and nothing on stdout"
  - "stdin EOF, SIGTERM, SIGINT and SIGHUP end a session the same way: close the client, remove the marker, bounded closed report, never down"
  - "Omp adopts the shared attach (verified) and the shared observer; realm mcp uses always and realm acp uses never, so every pre-existing assertion holds"
  - "Serve-early with calls awaiting boot (OQ-23-01) is deferred until a live rehearsal measures a real host's start timeout"
requirements: [BOOT-01, BOOT-03, BOOT-04, BOOT-05, BOOT-08, BOOT-09]
metrics:
  tasks: 4
  completed: 2026-11-17
status: merged
---

# Phase 23 Plan 03: Stdio host runner, shared observer, isolation proof and closure Summary

Merged to main in PR 110 (squash `82928b6`). `realm mcp --host <id>` and `realm acp --host <id>` boot Realm through the shared attach and observer, and Omp uses the same two modules. The live rehearsal task of this plan was not run.

## What shipped

- `src/cli/stdio-host.ts` (`runStdioHost`) runs the numbered boot sequence and teardown; `src/cli/main.ts` parses `--host <id>` and `--reattach` (each at most once, any order) for `mcp` and `acp`.
- `src/host/boot-observer.ts` (`createBootObserver`) writes the redacted log line, the presence marker and the `host-boot` report from one event stream; all best effort.
- `src/omp/extension.ts` now calls `createDaemonAttach` and the observer instead of its own attach and presence code.
- `test/integration/host-boot-isolation.test.ts` starts a real daemon with fake hosts and checks that one host's failure leaves another host's session and the shared sandbox answering, and that no boot path issues `down`.
- Docs: Boot integration and Evidence tiers in `docs/integration/host-plugin-contract.md`; `mcp.md`, `acp.md`, `hosts.md` and `omp.md` describe the shipped behavior. `scripts/check/export-usage-allowlist.json` was reconciled and `scripts/check/mcp-smoke.mjs` covers a built `realm mcp --host claude` marker.

## Observed

- Read of `origin/main` at `82928b6`: the files above exist; `src/cli/main.ts` carries the `--host` and `--reattach` flags in its usage text and parser; `docs/integration/host-plugin-contract.md` states the live rehearsal "not run" and records OQ-23-01.
- CI on the PR head passed (Verify on Node 22.x and 24.x, docs site build, dependency audit), after four rounds of fixes: type errors, lint, and five unit-test expectation fixes.

## Not verified here

- **Live rehearsal not run.** No real stdio host (Claude Code, OpenCode, Codex or Kimi CLI) booted Realm through `realm mcp --host <id>`, and no real Omp boot through the new shared modules was rehearsed in this phase. BOOT-09 allows the rehearsal to be recorded or the plan to stay blocked on the named step; it is recorded here as not run.
- **OQ-23-01 unmeasured.** Whether a host's MCP start timeout is shorter than a cold first boot (up to the 230 s `up` bound before `initialize` is answered) is unknown.
- **Isolation tests ran against fakes only**, with the real daemon in-process over the existing fakes (no Podman) and `realm mcp`/`realm acp` driven through `runCli`; not a real container stack and not a real host.
- **Residual: a client whose `up` never settles is not closed by teardown.** The driver cannot reach it; the process exits and the sandbox is unaffected. Documented in `docs/integration/host-plugin-contract.md`.

## Deviations from plan

- **Live rehearsal task not run** (see above); the plan's final autonomous-false checkpoint stays open.
- **Status poll arms unconditionally after adoption** in `src/host/boot-driver.ts` (see 23-01-SUMMARY.md).
- **Code written without local compilation;** CI fix rounds as above.

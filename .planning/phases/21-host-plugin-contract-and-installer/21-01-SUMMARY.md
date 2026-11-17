---
phase: 21-host-plugin-contract-and-installer
plan: 01
subsystem: host-plugin-contract
tags: [host, manifest, capabilities, runtime-table, least-privilege]
requires: ["20-01"]
provides:
  - "Host-neutral contract types: 19 host ids, tiers, integration kinds, HostEnv, InstallRecipe, HostPluginManifest, HostAdapter, boot-hook port types"
  - "Strict manifest validator (SCHEMA_INVALID on every refusal, deeply frozen result) and a default manifest per host"
  - "Capability catalogue mapped one to one onto existing Policy facts, with a per-integration ceiling and a pure intersection resolver"
  - "Declarative runtime table: Omp reference plus the 18 GSD Core installer flags, config homes from 21-DISCOVERY.md, every recipe null"
affects: [src/host/types.ts, src/host/runtimes.ts, src/host/manifest.ts, src/host/capabilities.ts, eslint.config.js]
key-files:
  created:
    - src/host/types.ts
    - src/host/runtimes.ts
    - src/host/manifest.ts
    - src/host/capabilities.ts
    - test/host/runtimes.test.ts
    - test/host/manifest.test.ts
    - test/host/capabilities.test.ts
  modified:
    - eslint.config.js
decisions:
  - "Owner: the plugin loads into each CLI agent; Omp plus Claude Code, OpenCode, Codex and Kimi CLI are the proven tier, every other host is config-only"
  - "Owner: Enterprise baseline only (logging, redaction, least privilege, audit chain); no new error code and no second enforcement path"
  - "The runtime list follows GSD Core `next` at commit 69d604e (2026-11-16); gemini (retired) and vscode (not installable) are not in the table"
requirements: [HOST-01, HOST-02, HOST-03]
metrics:
  tasks: 3
  completed: 2026-11-17
status: merged
---

# Phase 21 Plan 01: contract types, manifest, capability catalogue, runtime table Summary

Merged to main in PR 102 (squash `bf70847`) together with plans 21-02 to 21-04. This plan is the data model every later host adapter is written against: nothing in it touches a file system or a host.

## What shipped

- `src/host/types.ts`: `HOST_IDS` (19 ids: `omp` plus the 18 installer flags), `HostTier` (`reference | proven | config-only`), `IntegrationKind` (`extension | mcp-config`), `HostEnv` (absolute home, environment, absolute PATH directories), `InstallRecipe` (`json-merge | text-block | bundle-copy`), `HostRuntimeEntry`, the manifest and capability types, and the boot-hook and adapter interfaces. Types and `as const` lists only.
- `src/host/runtimes.ts`: `HOST_RUNTIMES`, a frozen `Record<HostId, HostRuntimeEntry>` (a missing host fails compilation). Tier: Omp `reference`; claude, opencode, codex, kimi `proven`; the other 14 `config-only`. Omp is the only `extension`; the rest are `mcp-config`. `antigravity` and Omp carry no home and `homeVerified: false`. Claude has the `CLAUDE_CONFIG_DIR` override; `windsurf` carries the alias `devin-desktop`; `kimi` has a skills home `.config/agents` and a config home `.kimi`. Every `recipe` is `null`. `resolveHostId`, `recipePending` and `resolveHomes` (pure; a relative home or relative override is SCHEMA_INVALID).
- `src/host/manifest.ts`: `parseHostPluginManifest` (strict keys, version pattern, safe launch command, entry confined to the package, ceiling check; own `__proto__`, `constructor` and `prototype` keys refused; the refusal never echoes input) and `defaultManifestFor(id, version)`, which always round-trips. The Omp default entry is `dist/src/omp/extension.js`, held equal to `package.json` `omp.extensions[0]` by a test.
- `src/host/capabilities.ts`: nine capabilities (`daemon.attach`, `fs.read`, `fs.write`, `fs.list`, `exec.argv`, `exec.shell`, `net.egress`, `credential.read`, `host.tools.restrict`), each mapped to one Policy fact and one existing catalogue denial code (POLICY_DENIED, SHELL_NOT_ALLOWED, EGRESS_DENIED, CREDENTIAL_PATH_DENIED). `mcp-config` hosts are capped below `net.egress`, `credential.read` and `host.tools.restrict`; only `extension` gets the full list. `resolveCapabilities(requests, policy)` returns granted and denied in request order and never mutates the policy.
- `eslint.config.js`: a `src/host/**` block that lets the layer import `appendAudit` and `withTimeout` only, and bars the dispatcher internals, so the "no second enforcement path" rule is lint-checked.
- Tests: `test/host/runtimes.test.ts` (pins the 19 ids and flags, no gemini or vscode, the invariant that every recipe is null), `manifest.test.ts` (7 cases), `capabilities.test.ts` (11 cases including an intersection grid and a source scan for gate calls).

## Observed

- Read of `origin/main` at `bf70847`: all four modules and three test files exist with the shapes above. `src/host` has no `process.env` read and no import from `src/omp` (the only `src/omp` mentions are comments and the Omp entry string).
- CI on the PR head (Verify on Node 22.x and 24.x, docs site, dependency audit) passed. The orchestrator reported a clean build and clean eslint before the PR.

## Not verified here

- The config homes are taken from the GSD Core discovery and were not checked on a machine with each host installed. `kimi` follows the installer flag `--kimi`, which is [INFERENCE] for the Kimi CLI itself and is to be confirmed in Phase 24.
- No capability is enforced by this layer by design: grants are data, and tool calls still go through the dispatcher gates.

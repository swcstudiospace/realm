---
phase: 21-host-plugin-contract-and-installer
verified: 2026-11-17
verdict: passed
status: passed
score: 9/9 requirements covered (HOST-01 to HOST-09) on fixture hosts; 19/19 plan must-have truths verified by code and test reading; 3 claims outside this phase's evidence reach, listed as behavior_unverified
ref: origin/main bf70847 (PR 102 squash merge of plans 21-01 to 21-04)
behavior_unverified: 3
overrides_applied: 0
covered_files:
  - ".planning/phases/21-host-plugin-contract-and-installer/21-01-PLAN.md"
  - ".planning/phases/21-host-plugin-contract-and-installer/21-01-SUMMARY.md"
  - ".planning/phases/21-host-plugin-contract-and-installer/21-02-PLAN.md"
  - ".planning/phases/21-host-plugin-contract-and-installer/21-02-SUMMARY.md"
  - ".planning/phases/21-host-plugin-contract-and-installer/21-03-PLAN.md"
  - ".planning/phases/21-host-plugin-contract-and-installer/21-03-SUMMARY.md"
  - ".planning/phases/21-host-plugin-contract-and-installer/21-04-PLAN.md"
  - ".planning/phases/21-host-plugin-contract-and-installer/21-04-SUMMARY.md"
  - ".planning/phases/21-host-plugin-contract-and-installer/21-DISCOVERY.md"
  - "docs/integration/host-plugin-contract.md"
  - "docs/integration/hosts.md"
  - "eslint.config.js"
  - "scripts/check/coverage-floors.json"
  - "scripts/check/export-usage-allowlist.json"
  - "scripts/check/pack-smoke.mjs"
  - "src/cli/host.ts"
  - "src/cli/main.ts"
  - "src/doctor/checks.ts"
  - "src/doctor/host-checks.ts"
  - "src/host/adapter.ts"
  - "src/host/boot.ts"
  - "src/host/capabilities.ts"
  - "src/host/env.ts"
  - "src/host/host-audit.ts"
  - "src/host/install.ts"
  - "src/host/manifest.ts"
  - "src/host/receipt.ts"
  - "src/host/recipe.ts"
  - "src/host/runtimes.ts"
  - "src/host/types.ts"
  - "test/cli/host.test.ts"
  - "test/doctor/host-checks.test.ts"
  - "test/host/adapter.test.ts"
  - "test/host/boot-conformance.test.ts"
  - "test/host/boot.test.ts"
  - "test/host/capabilities.test.ts"
  - "test/host/env.test.ts"
  - "test/host/install.test.ts"
  - "test/host/manifest.test.ts"
  - "test/host/receipt.test.ts"
  - "test/host/recipe.test.ts"
  - "test/host/runtimes.test.ts"
  - "test/support/fake-host-daemon.ts"
  - "test/support/fixture-host.ts"
  - "test/support/host-boot-conformance.ts"
  - "test/support/reference-boot-hook.ts"
covered_digest: "v3:sha256:eeb27dfd88bc73e5e4065151cbe344a4a1ce88765af4dcf6076e1163b7cd7f9f"
---

# Phase 21: Host plugin contract and installer: Verification at bf70847

**Goal:** A shared host plugin contract (manifest, capability grants mapped to the existing policy gates, boot-hook port, installer engine) and a declarative table of Omp plus the 18 GSD Core runtimes, driven by a `realm host` CLI and a doctor check, proven on fixture hosts.

**verdict: passed.** The goal is worded "proven on fixture hosts", and that is what exists: every contract piece is present on `origin/main`, each plan truth traces to code and to a test that asserts it, and CI on the PR head passed. The phase does not claim, and this report does not verify, that any real host loads a Realm plugin: no real host recipe exists, and every real install refuses as recipe-pending. Three claims beyond fixture reach are listed under behavior_unverified and are the work of Phases 24 and 25.

Method: read of the repository at `bf70847` (read-only), plus the CI and local results reported by the orchestrator. The verifier did not run the build, lint or tests.

## Requirements coverage

| Req | Statement | Status | Evidence |
| --- | --- | --- | --- |
| HOST-01 | Strict manifest schema | SATISFIED | `parseHostPluginManifest` (`src/host/manifest.ts` l.153): strict keys, version pattern, ceiling check, `SchemaInvalidError` on every refusal, frozen result, own `__proto__` keys refused; `defaultManifestFor` (l.216) always round-trips. `test/host/manifest.test.ts` (7 cases). |
| HOST-02 | Capability grants map onto the existing policy gates, no new enforcement path | SATISFIED | `src/host/capabilities.ts`: 9 capabilities, each mapped to one Policy fact and an existing catalogue code; `resolveCapabilities` (l.121) is an intersection and never mutates the policy; `mcp-config` hosts are capped below `net.egress`, `credential.read`, `host.tools.restrict`. An eslint block for `src/host/**` bars dispatcher internals other than `appendAudit` and `withTimeout`. `test/host/capabilities.test.ts` (11 cases, including an intersection grid and a no-second-enforcement-path source scan). |
| HOST-03 | Declarative runtime table: Omp plus 18 flags, pinned to the verified source | SATISFIED (source-pinned, homes unverified on machines) | `src/host/runtimes.ts`: `HOST_RUNTIMES` is a full `Record<HostId, …>` over the 19 `HOST_IDS`; no gemini, no vscode; `antigravity` and Omp `homeVerified: false`. `test/host/runtimes.test.ts` pins ids and flags and the invariant that every recipe is null. Source: GSD Core `next` at 69d604e per `21-DISCOVERY.md`. |
| HOST-04 | Boot-hook port with bounds parity against the Omp plugin and a conformance harness | SATISFIED | `src/host/boot.ts` `BOOT_BOUNDS` (200000, 5000, 2000, cap 8, 1000, 60000, code lists); `test/host/boot.test.ts` (16 cases) compares them with the Omp constants and functions at runtime (all 25 transition pairs, a jitter grid, the `RangeError`). Harness `test/support/host-boot-conformance.ts` C1 to C9; `test/host/boot-conformance.test.ts`: the reference hook passes all and each broken variant (no budget, down on shutdown, wave-through, unbounded re-attach) fails its named cases. |
| HOST-05 | Installer engine: pure recipes, atomic idempotent writes, receipts, dry-run, crash resume | SATISFIED on fixtures | `src/host/recipe.ts` (pure planners), `receipt.ts` (`writeReceipt` l.295 with observed prior hash), `install.ts` (`planHostOperation` l.281, `applyHostOperation` l.450; every write is `atomicWriteFile(…, { expectedPriorSha256 })`). `test/host/install.test.ts` (19 cases): dry run writes nothing; install then uninstall is an exact inverse; crash between files then install resumes, then uninstall restores; second install is a noop; symlink, over-size, non-UTF-8 and foreign content are refused. |
| HOST-06 | Audited on the shared chain, logged with redaction, bounded in time | SATISFIED on fixtures | `src/host/host-audit.ts`: lines on the existing chain under session id `host-plugins` (`host.install`, `host.uninstall`); a failed admission append writes nothing (`install.ts` l.470-480); result-line failure is AUDIT_WRITE_FAILED with the change kept; reads bounded by `TOOL_TIMEOUT` (`bounded`, l.193). Tests: four-line verifiable chain, no secret or file content in log, audit or receipt, stalled read is `TOOL_TIMEOUT`. |
| HOST-07 | `realm host list|detect|status|install|uninstall` with dry-run | SATISFIED | `src/cli/host.ts` `runHostCommand` (l.304), dispatched at `src/cli/main.ts` l.720, `host` in `CLI_COMMANDS`; exit 0, 1 (code on stdout, `<reason id>: <fixed text>` on stderr) and 2. `test/cli/host.test.ts` asserts, among others: on the real table every install (with and without `--dry-run`) refuses POLICY_DENIED and changes no file; a fixture host lifecycle with two verifiable audit lines; drift refusal; symlink refusal; no state directory; relative `HOME` refused; log falls back to stderr. |
| HOST-08 | Doctor `host-plugins` reads receipts only | SATISFIED | `src/doctor/host-checks.ts` `hostPluginsCheck`, appended by `runChecks` (`src/doctor/checks.ts` l.191): pass `no host plugin installed` with no receipts, warn on drift with the exact `realm host install|uninstall <id>` fix, fail on an unreadable receipt, never throws. `test/doctor/host-checks.test.ts` (211 lines); the `host-plugins` id added to the four doctor and daemon expectation lists. |
| HOST-09 | Contract docs, packaging proof and repo gates for `src/host` | SATISFIED, with residual R1 | `docs/integration/host-plugin-contract.md` (189 lines: table, evidence limits, residual risks) and a pointer in `hosts.md`; `scripts/check/pack-smoke.mjs` `HOST_MODULE_FILES` plus a consumer probe (19 hosts, every default manifest builds); 25 `src/host` entries added to the export-usage allowlist; `src/host` in `coverage-floors.json`. CI Verify (22.x and 24.x) ran these gates and passed. |

## Plan must-have truths

| Plan | Truths | Status | Notes |
| --- | --- | --- | --- |
| 21-01 | 4 | 4 VERIFIED | Manifest refusals, capability intersection, 19-entry table (18 flags plus Omp), no new error code and no gate call from `src/host` (no `ErrorCode` added by the merge: `src/core/errors.ts` is not in the PR's file list). |
| 21-02 | 4 | 4 VERIFIED | `src/host` imports nothing from `src/omp` (the PR's file list has no `src/omp` entry; `test/host/boot.test.ts` asserts the import and environment rule). |
| 21-03 | 6 | 6 VERIFIED on fixtures | Truth 1 (only receipt-owned bytes change) and truth 6 (crash resume) are asserted by the inverse and crash tests; truth 3 (dry run writes nothing, not even an audit line) by the dry-run test. |
| 21-04 | 5 | 5 VERIFIED | Truth 2 (real table refuses recipe-pending, fixture hosts behave) by `test/cli/host.test.ts`; truth 5 (no `process.env` read in host code): grep of `src/host`, `src/cli/host.ts` and `src/doctor/host-checks.ts` finds `process.env` only in comments. |

## Evidence read

| Source | Result |
| --- | --- |
| CI on the PR 102 head | Verify on Node 22.x and 24.x, docs site build and dependency audit passed, including the coverage floors and export-usage gates (reported by the orchestrator) |
| Local run before the PR | `npm run build` and `eslint` clean; 215 host, cli and doctor tests pass (reported by the orchestrator, not re-run by this verification) |
| Repository at `bf70847` | Every file in `covered_files` that is source, test, doc or script exists with the symbols cited above; `HOST_IDS` lists 19 ids; every entry in `HOST_RUNTIMES` has `recipe: null` |
| Path hygiene | No absolute host-local path in `docs/integration/host-plugin-contract.md` (grep for the four host-path prefixes the `host-paths` gate checks found none); this report and the four summaries carry none |

## behavior_unverified (3)

1. **No host loads a Realm plugin.** No live install on any real host was run, so it is unknown that any host reads the entry a recipe would write. By design Phase 21 produces no real recipe; Phases 24 (Claude Code, OpenCode, Codex, Kimi CLI) and 25 (the rest) own this proof.
2. **No real-host recipe exists.** Every `HOST_RUNTIMES` entry has `recipe: null`, so `realm host install <host>` on a real host refuses as recipe-pending (POLICY_DENIED) and changes nothing. The installer engine is proven only on fixture hosts in temporary homes with an injected runtime table.
3. **Kimi CLI flag and home.** `--kimi` and the homes `~/.config/agents` and `~/.kimi` come from the GSD Core discovery of its installer. That the Kimi CLI itself uses them is [INFERENCE], to be confirmed in Phase 24. The same caveat applies in lesser degree to every config home: none was checked on a machine with the host installed.

## Residuals (not verdict-blocking)

- **R1: the `src/host` coverage floor is 0.** `coverage-floors.json` carries `src/host: 0/0/0`, so the passing coverage gate does not measure the host layer. Raise it with `node scripts/check/coverage.mjs --write` after a coverage run (the 21-04 worker left it for the parent). No coverage figure for `src/host` was observed in this verification.
- **R2: planning bookkeeping.** `ROADMAP.md` still shows the four plan checkboxes unticked and `REQUIREMENTS.md` shows HOST-01 to HOST-09 as Planned; the orchestrator updates both through `gsd-tools`.
- **R3: CHANGELOG.** No CHANGELOG line was written for the phase (release-owned).
- **R4: engine limits.** JSONC is refused as unparseable, TOML is a marker block only, a symlinked config home is refused unless `--config-home` names the real directory, and the write phase is synchronous and bounded by file size (1 MiB per file, 256 bundle files), not by a timer. All are documented in the contract.
- **R5: the daemon-boot wiring** of the hook (Phase 23) and the move of Omp onto the contract with deletion of the duplicated Omp constants (Phase 22) are not part of this phase.

## Verdict

passed: the contract, the runtime table, the boot-hook port with parity and a harness, the installer engine with receipts and audit, the `realm host` CLI, the doctor item, the docs and the gates all exist on `origin/main` at `bf70847` and meet HOST-01 to HOST-09 as proven on fixture hosts. Nothing in the phase is FAILED. What is not proven, and must not be claimed from this report, is any live host integration.

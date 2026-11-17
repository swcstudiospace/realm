---
phase: 24-host-adapters-wave-1-claude-code-opencode-codex-kimi-cli
verified: 2026-11-17
verdict: passed
status: passed
score: 9/9 requirements covered (ADPT-01 to ADPT-09); proven on fixture hosts and CI; the claude validator tier ran live (3/3, twice) and the codex validator tier ran live (the first run found a real defect that PR 114 fixed; the run after PR 114 passed 5/0/2 skipped); 6 claims outside the evidence reach, listed as behavior_unverified
ref: origin/main c157149 (PR 113 squash 9212949, plans 24-01 to 24-04; PR 114 Codex fix)
behavior_unverified: 6
overrides_applied: 0
covered_files:
  - ".planning/phases/24-host-adapters-wave-1-claude-code-opencode-codex-kimi-cli/24-CONTEXT.md"
  - ".planning/phases/24-host-adapters-wave-1-claude-code-opencode-codex-kimi-cli/24-01-PLAN.md"
  - ".planning/phases/24-host-adapters-wave-1-claude-code-opencode-codex-kimi-cli/24-01-SUMMARY.md"
  - ".planning/phases/24-host-adapters-wave-1-claude-code-opencode-codex-kimi-cli/24-02-PLAN.md"
  - ".planning/phases/24-host-adapters-wave-1-claude-code-opencode-codex-kimi-cli/24-02-SUMMARY.md"
  - ".planning/phases/24-host-adapters-wave-1-claude-code-opencode-codex-kimi-cli/24-03-PLAN.md"
  - ".planning/phases/24-host-adapters-wave-1-claude-code-opencode-codex-kimi-cli/24-03-SUMMARY.md"
  - ".planning/phases/24-host-adapters-wave-1-claude-code-opencode-codex-kimi-cli/24-04-PLAN.md"
  - ".planning/phases/24-host-adapters-wave-1-claude-code-opencode-codex-kimi-cli/24-04-SUMMARY.md"
  - "docs/hosts/snippets/claude-code.md"
  - "docs/hosts/snippets/codex.md"
  - "docs/hosts/snippets/kimi.md"
  - "docs/hosts/snippets/opencode.md"
  - "docs/integration/host-plugin-contract.md"
  - "scripts/check/export-usage-allowlist.json"
  - "src/host/adapter.ts"
  - "src/host/install.ts"
  - "src/host/recipe.ts"
  - "src/host/runtimes.ts"
  - "src/host/toml-owned.ts"
  - "src/host/toml-table.ts"
  - "src/host/types.ts"
  - "test/host/claude-recipe.test.ts"
  - "test/host/codex-recipe.test.ts"
  - "test/host/kimi-recipe.test.ts"
  - "test/host/opencode-recipe.test.ts"
  - "test/host/toml-owned.test.ts"
  - "test/integration/host-live-claude.test.ts"
  - "test/integration/host-live-codex.test.ts"
  - "test/integration/host-live-helpers.test.ts"
  - "test/integration/host-live-kimi.test.ts"
  - "test/integration/host-live-opencode.test.ts"
  - "test/support/host-live.ts"
covered_digest: "v3:sha256:0921135a84a8ed54680ba540337fd61be0c7d4825373e38bc9a7ea21f2adf7c5"
---

# Phase 24 Verification: Host adapters wave 1 (Claude Code, OpenCode, Codex, Kimi)

Method: read-only read of the repository at `c157149` (existence and content of the key files, the recipe types in `src/host/types.ts`, the `toml-table` recipe in `src/host/runtimes.ts` and `src/host/toml-owned.ts`, the evidence matrix in `docs/integration/host-plugin-contract.md`, the Codex snippet), plus the CI result and the live rehearsal results reported by the orchestrator. The verifier did not run the build, lint or tests. The code of this phase was written by agents without local compilation; CI was the gate and needed several rounds of fixes (lint, type errors, a stale export-usage allowlist entry, an `owns()` assertion) before it passed on both PR heads. CI on PR 113 and PR 114: Verify on Node 22.x and 24.x, the docs site build and the dependency audit passed.

## Requirements coverage

| Req | Statement | Status | Evidence |
| --- | --- | --- | --- |
| ADPT-01 | Home roles `config`, `skills`, `mcp`; env override moves `config` and `mcp` only; `envBase` for OpenCode; `installHome` selects by role | SATISFIED on fixtures | `src/host/runtimes.ts`, `src/host/install.ts`; `test/host/runtimes.test.ts`, `test/host/install.test.ts`. Passed in CI. |
| ADPT-02 | A TOML table already defined outside Realm's ownership is refused as `foreign-content`, never duplicated; nothing written on refusal | SATISFIED, wording changed (see R3) | The original `text-block` `tomlTable` field no longer exists on `main`; `src/host/toml-owned.ts` refuses a foreign definition of `[mcp_servers.realm]` with `foreign-content`, using the scanner in `src/host/toml-table.ts`. `test/host/toml-table.test.ts`, `test/host/toml-owned.test.ts`, `test/host/codex-recipe.test.ts`. |
| ADPT-03 | `unreadable` entry state and `launch` field in `realm host status`; doctor carries the unreadable count; no new error code | SATISFIED on fixtures | `src/host/types.ts` (`unreadable` state, `launch`), `src/cli/host.ts`, `src/doctor/host-checks.ts`; `test/cli/host.test.ts`, `test/doctor/host-checks.test.ts`. |
| ADPT-04 | Claude recipe: entry in `<home or CLAUDE_CONFIG_DIR>/.claude.json`, byte-preserving merge, lifecycle proven, value equals golden | SATISFIED on fixtures; validator tier ran live | `src/host/runtimes.ts`; `test/host/claude-recipe.test.ts`. Golden recorded from Claude Code 2.1.322 in an isolated HOME. Live validator run 2026-11-17 (claude 2.1.322): 3/3 passed, evidence kept outside the repo. |
| ADPT-05 | OpenCode recipe: V1-shaped entry in `<XDG_CONFIG_HOME or ~/.config>/opencode/opencode.json`, JSONC refused, `opencode.jsonc` untouched | SATISFIED on fixtures only | `test/host/opencode-recipe.test.ts`. Format from official documentation and a recorded observation of OpenCode 1.19.5; no `opencode` executable ran here. |
| ADPT-06 | Codex recipe: the owned table in `<CODEX_HOME or ~/.codex>/config.toml`; a table written by `codex mcp add realm` is refused; other content byte-exact | SATISFIED on fixtures and by the validator tier, by a different mechanism than planned | The plan's comment-marker text-block recipe was refuted by the first live run and replaced in PR 114 by a marker-free `toml-table` recipe (`src/host/toml-owned.ts`). `test/host/codex-recipe.test.ts`, `test/host/toml-owned.test.ts` passed in CI. The validator tier was re-run live from the merged tree on 2026-11-17 with codex-cli 0.154.0 (5 passed, 0 failed, 2 skipped); see "Live rehearsal record". |
| ADPT-07 | `kimi` (`~/.kimi/mcp.json`, `KIMI_SHARE_DIR`) and `kimi-code` (`~/.kimi-code/mcp.json`, `KIMI_CODE_HOME`); `kimi` has no binary detection; recipe values equal `defaultManifestFor(id).launch` | SATISFIED on fixtures only | `src/host/runtimes.ts`; `test/host/kimi-recipe.test.ts`. Formats from official documentation; no Kimi executable ran. |
| ADPT-08 | A gated live file per host with named skip reasons; hermetic helper test always runs | SATISFIED (the files exist and skip honestly); results partial | `test/integration/host-live-{claude,codex,opencode,kimi}.test.ts`, `test/support/host-live.ts`, `test/integration/host-live-helpers.test.ts`. See "Live rehearsal record". |
| ADPT-09 | Docs per host, evidence tiers stated honestly, contract table, allowlist, gates | SATISFIED | `docs/hosts/snippets/{claude-code,opencode,codex,kimi}.md`, `docs/integration/host-plugin-contract.md` (six recipe hosts, three-tier matrix with the recorded claude and codex validator results, residuals R-24-01 to R-24-04), `docs/integration/mcp.md` Q8, `scripts/check/export-usage-allowlist.json`. CI docs site build and the allowlist check passed. |

## Live rehearsal record (2026-11-17, this machine, evidence kept outside the repo)

| Host | Validator tier | Production tier |
| --- | --- | --- |
| claude 2.1.322 | 3/3 passed, run twice (the second from the merged tree, after PR 114): the real `claude mcp get` and `claude mcp list` parse and launch the recipe's file; the host's own add and remove interoperate; `CLAUDE_CONFIG_DIR` moves the file | skipped: `REALM_LIVE_PRODUCTION` not set; Podman 4.9.3 is below 5.x |
| codex-cli 0.154.0 | first run (comment-marker recipe) **FAILED** and found a real defect: `codex mcp add other` rewrites `config.toml`, drops the `# BEGIN realm host-plugin` comment and keeps `# END`; `codex mcp remove realm` removes the table and leaves an orphan END. PR 114 replaced the markers with a header-owned table. **Re-run live from the merged tree after PR 114: 5 passed, 0 failed, 2 skipped (production tiers).** `codex mcp get\|list` parse the marker-free `[mcp_servers.realm]` table; after `codex mcp add other` and `codex mcp remove realm` install, status and uninstall stay consistent; after `codex mcp add realm` install refuses with `foreign-content` | named gap: `codex mcp list` does not start servers |
| opencode | skipped: opt-in not set, no executable on this machine | skipped: same, and Podman 4.9.3 |
| kimi | skipped: no functional Kimi CLI release (the last release is a deprecation stub) | gap: nothing to run |
| kimi-code | not available: no validator command is documented | gap: not run |

Owner questions, defaults applied: OQ-24-01 a same-shaped `kimi-code` row ships; OQ-24-02 OpenCode V1 key path; OQ-24-03 project-level shadowing by a workload is documented only (R-24-01); OQ-24-05 (do Codex markers survive) answered by the live run: they do not.

## Not verified (behavior_unverified)

Resolved since the first draft: the marker-free Codex recipe was run against a real codex-cli 0.154.0 on 2026-11-17 after PR 114 (validator tier only; see "Live rehearsal record"). Its limits remain in items 3 and 5 below.

1. **Any live run of OpenCode.** No executable on this machine and the opt-in was not set. The V1 key path rests on documentation and one recorded observation of 1.19.5; whether a V2 build lists the server is unknown (OQ-24-02).
2. **Any live run of Kimi CLI or Kimi Code.** No functional Kimi CLI release exists; Kimi Code has no documented validator. The formats rest on official documentation.
3. **A production-stack boot of any wave 1 host.** No host was shown to boot Realm through `realm mcp --host <id>` against a real daemon, sandbox and workspace: `REALM_LIVE_PRODUCTION` was not set and Podman 4.9.3 is below the required 5.x; for Codex the tier has no runnable form. The claude and codex validator successes show the host parses the entry (and, for Claude, launches the registered argv), not that a Realm session runs.
4. **Project-level shadowing.** A workload writing `.mcp.json`, `.codex/config.toml`, `opencode.json`, `.opencode/` or `.kimi-code/mcp.json` in the workspace is documented (R-24-01, OQ-24-03), not mitigated or tested; OpenCode documents no trust gate.
5. **Concurrent writers and later host versions.** Claude Code rewrites `~/.claude.json` at any time and the window between the final hash check and the rename cannot be closed (R-24-02); a later Codex version that reformats the owned table makes the entry `drifted` (R-24-04). Only claude 2.1.322 and codex-cli 0.154.0 were observed.
6. **Counts and the closer's own checks.** Test counts and lint, type and build results were not re-run for this report; they rest on CI. The live results above are reported by the orchestrator; their evidence is outside the repository and was not re-read by the closer.

## Residuals (not verdict-blocking)

- **R1 (resolved): the evidence matrix.** `docs/integration/host-plugin-contract.md` and the claude and codex snippets now record the 2026-11-17 live validator results for claude 2.1.322 and codex-cli 0.154.0, with the Codex first-run failure noted. Production-tier and opencode and kimi statements are unchanged.
- **R2: planning bookkeeping.** `ROADMAP.md`, `STATE.md` and `REQUIREMENTS.md` (ADPT-01 to ADPT-09, which `24-CONTEXT.md` says are not yet registered) are updated by the orchestrator.
- **R3: ADPT-02 wording.** The requirement names a `text-block` recipe with `tomlTable`; that field was removed with the marker recipe. The requirement text should be reworded to the `toml-table` recipe's refusal when it is registered.
- **R4: `launch` is advisory.** `launch` reports the `PATH` `realm host status` sees, not the host's own.
- **R5: kimi-code and kimi share the command name `kimi`.** Detection and the validator for the sibling row stay open until Kimi Code documents one.

## Verdict

passed: the engine groundwork, the five recipes, the gated live files, the docs and the allowlist exist on `main` at `c157149`, CI passed on both PR heads, the claude and codex validator tiers ran live and passed (the codex run on the merged marker-free recipe), and the one earlier live failure (Codex comment markers) was a real defect that was fixed in PR 114 with the cause recorded. Nothing in the phase is FAILED. The six items above are not proven and must not be claimed from this report; in particular, no claim that a real Claude Code, Codex, OpenCode or Kimi boots Realm through `realm mcp --host <id>` follows from it, and no claim about OpenCode or Kimi against a real host.

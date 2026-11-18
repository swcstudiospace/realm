---
phase: 40-host-ids-for-muse-code-prime-agent-and-grok-build
verified: 2026-11-18
verdict: passed
status: passed
score: "3/3 requirements covered (HOSTID-01, HOSTID-02, HOSTID-03): HOSTID-01 met; HOSTID-02 met at the daemon (hermetic proof over a real socket under the enforce default) and at the validator tier (each host's own CLI read what the real recipe wrote, 3 of 3 passed on 2026-11-18), partial for a host-driven tool call, which no tier makes; HOSTID-03 met for the documents and the registry, with the docs site build carried by CI. The tier of all three hosts is config-only: no production tier and no model-driven call (D-25-08, D-40-06), and a Grok Build session that loads the shared Claude files stays attributed claude (GAP-40-01)"
ref: "origin/main 2faf19a (PR 192 8c4c62b, PR 196 dbd42cf, PR 199), plus the recording change that carries this file"
behavior_unverified: 3
overrides_applied: 0
covered_files:
  - ".planning/phases/40-host-ids-for-muse-code-prime-agent-and-grok-build/40-CONTEXT.md"
  - ".planning/phases/40-host-ids-for-muse-code-prime-agent-and-grok-build/40-01-PLAN.md"
  - ".planning/phases/40-host-ids-for-muse-code-prime-agent-and-grok-build/40-01-SUMMARY.md"
  - ".planning/phases/40-host-ids-for-muse-code-prime-agent-and-grok-build/40-02-PLAN.md"
  - ".planning/phases/40-host-ids-for-muse-code-prime-agent-and-grok-build/40-02-SUMMARY.md"
  - ".planning/phases/40-host-ids-for-muse-code-prime-agent-and-grok-build/40-03-PLAN.md"
  - ".planning/phases/40-host-ids-for-muse-code-prime-agent-and-grok-build/40-03-SUMMARY.md"
  - "src/host/types.ts"
  - "src/host/recipe.ts"
  - "src/host/runtimes.ts"
  - "src/host/boot-report.ts"
  - "src/cli/host.ts"
  - "src/core/policy.schema.json"
  - "adapters/muse-code/mcp-settings.snippet.json"
  - "adapters/prime-agent/MCP.md"
  - "test/support/host-contract.ts"
  - "test/support/host-recipe-suite.ts"
  - "test/support/host-config-goldens.ts"
  - "test/support/host-live.ts"
  - "test/support/host-live-wave2.ts"
  - "test/support/host-live-muse.ts"
  - "test/support/host-registry.ts"
  - "test/host/recipe.test.ts"
  - "test/host/muse-code-recipe.test.ts"
  - "test/host/prime-agent-recipe.test.ts"
  - "test/host/grok-build-recipe.test.ts"
  - "test/host/adapters-labelled.test.ts"
  - "test/host/runtimes.test.ts"
  - "test/integration/enforce-default.test.ts"
  - "test/integration/host-live-muse.test.ts"
  - "test/integration/host-live-muse-helpers.test.ts"
  - "test/integration/host-live-wave2.test.ts"
  - "test/integration/host-live-helpers.test.ts"
  - "test/docs/capability-token-doc.test.ts"
  - "docs/hosts/snippets/muse-code.md"
  - "docs/hosts/snippets/prime-agent.md"
  - "docs/hosts/snippets/grok-build.md"
  - "docs/integration/host-support-matrix.md"
  - "docs/integration/host-plugin-gaps.md"
  - "docs/integration/host-plugin-contract.md"
  - "docs/integration/hosts.md"
  - "docs/integration/mcp.md"
  - "docs/integration/writing-a-host-plugin.md"
  - "docs/policy-reference.md"
  - "AGENTS.md"
covered_digest: "v3:sha256:07385b7d952acc7c8433f113deb854c26567c29712af0776ecc26014ebaf2955"
---

# Phase 40 Verification: host ids for Muse Code, Prime Agent and Grok Build

Method: a read of the files above on the recording branch, against the requirement statements HOSTID-01 to HOSTID-03 in `.planning/REQUIREMENTS.md` and the truths of plans 40-01 to 40-03, on 2026-11-18. The live results are copied from the window's evidence (kept outside the repository; this file names no path of it). The window ran as root in isolated homes with a stub `realm`; it needed no Podman, no production stack, no shared live lock and no credential. The registry, matrix, docs and live-helper tests named below were re-run on the recording branch.

What this phase is, stated once: a product change with an evidence tail. Plan 40-01 extended the `json-merge` recipe and the contract checker, plan 40-02 added the three host ids, rows, recipes, labelled launchers and the daemon-side proof, plan 40-03 re-pointed the Muse Code live test at the real install, added Prime Agent and Grok Build to the wave 2 live table, wrote the migration table, and recorded the dated results.

## Requirements coverage

| Req | Statement | Status | Evidence |
| --- | --- | --- | --- |
| HOSTID-01 | Each of the three hosts has a host id in the closed list and the `profiles` schema, with a manifest, recipe or launcher label as its config surface allows | MET | `muse-code`, `prime-agent` and `grok-build` are rows of `src/host/runtimes.ts` (22 hosts, 21 `mcp-config`, 19 recipes), in `src/core/policy.schema.json` and `HOST_IDS`; recipes are `json-merge` (with `seed` and `refuseIfPresent` for Muse Code) and `toml-table` for Grok Build, each equal to the bytes the host's own writer produced (`test/support/host-config-goldens.ts`, the three recipe suites); the shipped launchers carry the label |
| HOSTID-02 | Each host attaches and completes a tool call under the enforce default with no policy edit; GAP-34-01 closed; the guard test loses its named exception | MET at the daemon and the validator tier; PARTIAL for a host-driven call | `test/integration/enforce-default.test.ts` attaches and completes a call for every id under the default; `test/host/adapters-labelled.test.ts` names only the shared Grok bundle; GAP-34-01 is closed. Live, 2026-11-18, one machine: Muse Code 1.4.23 (real install equals the snippet; `muse exec` launched the entry with `mcp --host muse-code`, handshake and six tools; the host's own `muse mcp add` left the entry value-identical; uninstall removed the seed-only file), Prime Agent 0.10.2 and Grok Build 1.0.77 (the host's own listing commands read the entry; `grok mcp doctor` launched it with `mcp --host grok-build`; the host's own add left Realm's entry unchanged): 3 passed, 9 skipped, 0 failed. No model decided to call a Realm tool through any of the three hosts, and no production-stack boot was run |
| HOSTID-03 | The contract checker, support matrix, host-plugin docs, policy reference and migration notes agree with the registry; docs site build and `check:docs` pass | MET for the documents and `check:docs`; the site build is carried by CI | the contract page (22 hosts, 19 recipes, the Phase 40 section and evidence rows), the hosts page, the guide, `AGENTS.md`, the policy reference, the three snippet pages, the generated matrix and Q10 (migration table pinned by `test/docs/capability-token-doc.test.ts`) agree with the registry t2 entries; `npm run check:docs` and `node scripts/check/host-paths.mjs` pass; `npm ci --prefix site` and `npm run build --prefix site` were not run in the recording task, so the CI `site` job carries that part |

"Met" for HOSTID-02 does not mean a model used Realm through these hosts, and does not mean any of them boots against the production stack. The tier of all three is `config-only` (D-25-08): the validator tier is the highest that exists for them (D-40-06, OQ-40-05).

## Key facts checked

- The registry t2 of `muse-code`, `prime-agent` and `grok-build` is dated 2026-11-18 with the observed version; `muse-code` keeps `live` null (D-40-07), so its t2 text names `REALM_LIVE_MUSE=1` and `test/integration/host-live-muse.test.ts`; the other two keep their wave 2 live key and the matrix prints their gate. The t3 of all three is the config-only none-defined cell.
- The Muse Code snippet was respelled (`mcp_servers` to `mcpServers`, plus `schema_version` and `required`). Q10 tells an existing install what to do, and the installer refuses with `foreign-content` while the old spelling exists; no commit of the phase carries the breaking marker (D-40-11, OQ-40-04 default).
- The E-40-09 observation (Grok Build reads `config.toml`, `~/.claude.json` and `.mcp.json`; a `config.toml` entry shadows a Claude one of the same name) was made by hand during planning, not by the 2026-11-18 test run, and is stated that way on the Grok Build page and in GAP-40-01.

## Residuals and limits

- **GAP-40-01 (accepted).** A Grok Build session that loads the shared Claude plugin bundle, or starts the entry the `claude` recipe wrote into the shared Claude file, is attributed `claude`; the label is a self-declared attribution, not an identity. Lift: a Grok Build plugin bundle of its own, or a host feature that names the host in a shared file.
- **No production tier and no model-driven call** for any of the three hosts (D-40-06, OQ-40-05): the evidence stops at the validator tier with a stub `realm`.
- **One machine, one version each.** The results cover Muse Code 1.4.23, Prime Agent 0.10.2 and Grok Build 1.0.77, run as root; a different version may behave differently, and the results are not repeated.
- The non-root run of the new tests and the docs site build are carried by CI; an intermittent `boot-driver` timing failure under load is known (Phase 43 record) and touches nothing here.

## behavior_unverified

1. A real Muse Code model turn that calls a Realm tool through the labelled entry: not observed (the echo provider never calls tools).
2. A real Prime Agent model turn that calls a Realm tool: not observed; its listing commands print only the name and the transport.
3. A real Grok Build model turn that calls a Realm tool, and the attribution of a session when both `config.toml` and the Claude files carry a `realm` server, beyond the planning-time observation: not observed by a test.

---
phase: 40-host-ids-for-muse-code-prime-agent-and-grok-build
plan: "03"
requirements: [HOSTID-02, HOSTID-03]
---

# 40-03 summary: the validator tiers, the dated results and the migration notes

Code and structure landed as PR 199 (`2faf19a`); the dated results and this record are the recording change that carries this file. Everything below was observed on 2026-11-18.

## Code (PR 199)

- `test/integration/host-live-muse.test.ts`, `test/support/host-live-muse.ts`: the Phase 36 Muse Code live test now runs the real `realm host install muse-code` in process (dry run first, then real), compares the written file with the document of the shipped snippet, and adds the host's own writer (`muse mcp add` and `remove` of a second server, with the observation asserted and printed) and `realm host uninstall muse-code` (the seed-only file goes, a file holding more stays). Hermetic helper rows are in `host-live-muse-helpers.test.ts`.
- `test/support/host-live.ts`, `host-live-wave2.ts`, `test/integration/host-live-wave2.test.ts`, `host-live-helpers.test.ts`: Prime Agent and Grok Build are entries 15 and 16 of the live table and 10 and 11 of the wave 2 table (opt-ins `REALM_LIVE_PRIME_AGENT` and `REALM_LIVE_GROK_BUILD`, overrides `REALM_PRIME_AGENT_BIN` and `REALM_GROK_BUILD_BIN`; Prime Agent isolates with `PRIME_AGENT_CODING_AGENT_DIR`, Grok Build with `HOME`); the scenario learned the `toml-table` recipe.
- `docs/integration/mcp.md` Q10: the migration table for existing installs of the three hosts (hand-merged Muse snippet, `muse mcp add`, opt-out or borrowed label, Prime Agent `mcp add`, Grok Build through the Claude files, a `profiles` entry), with `ambiguous_user_key`, the `foreign-content` refusal and the statement that uninstall removes only what the install wrote; pinned by `test/docs/capability-token-doc.test.ts`.

## The live window (2026-11-18)

Run as root, in isolated homes with a stub `realm` that records its argument list (validator tier: no Podman, no production stack, no shared live lock, no credential, no model prompt), on `main` at the merge of PR 199, with Muse Code 1.4.23, Prime Agent 0.10.2 and Grok Build 1.0.77 (all equal to the recorded versions). Command: `REALM_LIVE_MUSE=1 REALM_LIVE_PRIME_AGENT=1 REALM_LIVE_GROK_BUILD=1 node --test dist/test/integration/host-live-muse.test.js dist/test/integration/host-live-wave2.test.js`. Result: 12 tests, 3 passed, 9 skipped (the other wave 2 hosts, opt-in unset), 0 failed, about 76 s. The TAP file is kept outside the repository.

| Host | Result | Diagnostics |
| --- | --- | --- |
| Muse Code 1.4.23 | pass | A the plugin bundle validated; B the dry run wrote nothing, the install wrote the shipped snippet document, status installed; C `muse mcp list` and `get` printed the entry and started no server; C2 after `muse mcp add other` the realm entry was value-identical (E-40-03 confirmed) and status stayed installed; D `muse exec` exit 0 in 26 s, one server start with the arguments `mcp --host muse-code`, methods `initialize`, `notifications/initialized`, `tools/list`, six tools; E a stub realm failed the run (exit 1, `failed during startup`, two stub invocations); E2 uninstall removed the entry and the seed-only settings file; F the real Muse settings file byte-equal, 0 muse processes before and after |
| Prime Agent 0.10.2 | pass | the host's own `mcp list` and `mcp get realm` accepted the file; `mcp add other` left Realm's entry value-identical, status installed, entry `ok`; uninstall and the real-file hash check passed |
| Grok Build 1.0.77 | pass | `grok mcp list` and `grok mcp doctor` accepted the file and the stub recorded `mcp --host grok-build`; `grok mcp add other` left the Realm table byte-identical, status installed, entry `ok`; uninstall and the real-file hash check passed |

Recorded in `test/support/host-registry.ts` (t2), the three snippet pages, the contract page tier table, `hosts.md`, GAP-34-01 and GAP-40-01 evidence, and the regenerated support matrix (the Muse cell keeps `live` null by D-40-07, so its t2 text names the gate and the test file).

## Not done and not claimed

- The E-40-09 observation (Grok reads three MCP sources, and a `config.toml` entry shadows a Claude one) was made by hand during planning with `grok mcp doctor --json`; the 2026-11-18 window did not exercise it.
- No production-stack boot and no model-driven tool call through any of the three hosts (D-40-06, OQ-40-05, GAP-40-01): the tier is `config-only` and the validator tier is the highest reached. The results cover one machine and one version of each host.
- The docs site build (`npm ci --prefix site`, `npm run build --prefix site`) and the non-root run of the new tests are carried by CI; this record task ran `check:docs`, `host-paths`, the docs and registry tests and the matrix test locally.

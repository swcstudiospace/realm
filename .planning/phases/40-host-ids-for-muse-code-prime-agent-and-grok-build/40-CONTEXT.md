# Phase 40: Host ids for Muse Code, Prime Agent and Grok Build - Context

**Gathered:** 2026-11-18, from a fresh read of branch `gsd/v6-plan` (release line 0.5.x, the v6.0 milestone start): `src/host/{types,manifest,runtimes,recipe,adapter,boot-report,presence,receipt,toml-owned,toml-table}.ts`, `src/core/policy.schema.json`, `src/cli/{main,host}.ts`, `src/daemon/channel.ts`, `src/capability/{gate,token}.ts`, `src/doctor/host-checks.ts`, the shipped `adapters/{muse-code,prime-agent,claude-plugin}`, `docs/hosts/snippets/{muse-code,prime-agent,grok-build}.md`, `docs/integration/{host-plugin-gaps,host-support-matrix,host-plugin-contract,hosts,mcp,writing-a-host-plugin}.md`, `docs/policy-reference.md`, `README.md`, `AGENTS.md`, the host tests under `test/host`, `test/cli`, `test/docs`, `test/support`, `test/integration`, `scripts/check/pack-smoke.mjs`, the Phase 34 record (`.planning/milestones/v5.0-phases/34-capability-tokens-enforce-by-default/34-CONTEXT.md`, D-34-07 and OQ-34-01) and the three real host CLIs that are installed on this machine (Muse Code 1.4.23, Prime Agent 0.10.2, Grok Build 1.0.77), each driven in a throwaway HOME.
**Status:** Planned (three plans, nothing executed). Requirement ids HOSTID-01 to HOSTID-03 are already in `.planning/REQUIREMENTS.md` (v6.0). This phase does not edit ROADMAP, STATE or REQUIREMENTS.
**Depends on:** Phase 37 (the v5.0 close-out). Independent of Phases 38, 39, 41 and 43; Phase 42 runs after it. Coordination: Phase 43 also edits `docs/integration/host-support-matrix.md` (a generated block: regenerate it after the last rebase, never merge it by hand), `docs/integration/host-plugin-gaps.md` (different rows) and possibly `test/support/host-live.ts`.

<domain>
## Phase Boundary

Owner decision D-v6-4 (2026-11-18): Muse Code, Prime Agent and Grok Build get host ids and manifests, recipes or launcher labels, so that they work under the enforce default; `GAP-34-01` closes; the contract checker, the support matrix and the docs follow; a host with no verifiable config surface stays config-only with a label in its launcher.

Today (E-40-01) `HOST_IDS` has 19 entries and none of the three, `realm mcp --host` accepts only the 18 `mcp-config` ids, so the shipped Muse Code and Prime Agent launchers are bare `realm mcp` and the default (`capabilityTokens.mode` is `enforce`) refuses them with `POLICY_DENIED`; Grok Build has no launcher of its own and reads the Claude plugin bundle, so its sessions are attributed `claude`. This phase removes all three conditions.

What the phase delivers:

1. Three host ids, `muse-code`, `prime-agent` and `grok-build`, in the closed list `HOST_IDS`, in the policy `profiles` schema enum, in the runtime table (one row each), and therefore, by derivation, in the default manifests, the boot report vocabulary, the presence markers, the receipts, the token and gate checks, `realm host list` and `--host`.
2. An install recipe for each, because each host has a config surface that its own CLI writes and reads back (D-40-02): `json-merge` for Muse Code and Prime Agent, `toml-table` for Grok Build. `realm host install|uninstall|status ID` work for all three and register `realm mcp --host ID`.
3. A small, optional extension of the `json-merge` recipe (D-40-03) that Muse Code needs to be safe: `seed` and `refuseIfPresent`.
4. The shipped launchers carry their label; the guard test of labelled launchers loses its named exception; the contract checker, the registry, the support matrix, the gaps page, the snippets, the migration notes and every pinned count agree with the registry.
5. Dated evidence at the validator tier for each host (the host's own commands parse what the recipe wrote), run on this machine in isolated homes, and the hermetic proof that each id attaches and completes a tool call under the default.

### What this phase does NOT change

1. The security claim. A host id is a self-declared attribution label (D-32-02); the token protects nothing against a process of the same user that can read the key, the environment or process memory. Every document keeps the same first paragraph.
2. The wire. No new control method, no new reply member, no new error code (the catalogue stays at 29), no change to `src/contract/tools.schema.json`, to `ToolOutcome`, or to any MCP or ACP reply shape.
3. The token, keyring, gate verdict order, audit fields, profile model, `realm host token` verbs, the existing 18 default manifests and 15 `mcp-config` recipes (their files, entries and tests), and the Omp extension.
4. The Claude plugin bundle `adapters/claude-plugin` (it stays labelled `claude`; it is shared with Grok Build by the Grok Build documentation) and the Muse Code plugin bundle `adapters/muse-code/.muse-plugin` and the Prime Agent skill package. The installer registers the MCP server only; it does not install either bundle.
5. `docs/specs/realm-spec.xml`, `CHANGELOG.md` and version fields (release-owned), `release/milestone.json`, `LICENSE`, `NOTICE`, `.github/workflows/**`, `src/daemon/daemon.ts` (986 of 1000 lines) and `src/cli/main.ts` (about 923).
6. The three deferred hosts (`windsurf`, `trae`, `zcode`) and Phase 43's kimi work.
</domain>

<decisions>
## Implementation Decisions

### Evidence (every fact: source, read date 2026-11-18, tier)

Tiers: **Observed** = read in this repository, or produced by the named host's own command in a throwaway HOME, today; **[INFERENCE]** = reasoning from observed facts, not run. Plan 40-02 Task 1 re-runs the host probes first and stops on a mismatch (D-40-13).

| ID | Fact | Source | Tier |
| --- | --- | --- | --- |
| E-40-01 | `HOST_IDS` has 19 entries (the Omp reference plus 18 GSD Core installer flags); `--host` accepts `HOST_IDS.find` entries whose runtime row is `mcp-config`, so main.ts needs no edit; the three names appear only in the guard test's named set and in documents. | `src/host/types.ts`; `src/cli/main.ts` lines 93 to 97; `test/host/adapters-labelled.test.ts` lines 20 to 32 | Observed |
| E-40-02 | Muse Code 1.4.23: `muse mcp add NAME -- COMMAND ARGS` (default scope user) creates `XDG_CONFIG_HOME/muse/settings.json` with exactly `mcpServers.NAME = { type: "stdio", command, args }` and `schema_version: 1`. Keys are sorted, two-space indent, no trailing newline. `muse mcp add-json NAME JSON` takes the same object. XDG_CONFIG_HOME relocates the file (the Phase 36 isolated environment); no other relocation variable was observed. | `muse mcp --help`, `muse mcp add --help`, a throwaway `XDG_CONFIG_HOME` | Observed |
| E-40-03 | The `mcpServers` entry of Muse accepts `required: true`: `muse mcp list --json` prints `required: true`; with `required` the run `muse exec --provider echo --trust-workspace` fails with exit 1 and the text `Required MCP server realm failed during startup` when `realm` does not speak MCP; without it (the default `muse mcp add` writes none) the same run exits 0 and starts the stub with the argument list `mcp --host muse-code`. `muse mcp add other` and `muse mcp remove other` rewrite the file but leave the realm entry value-identical, `required` included. | the same throwaway home, a stub `realm` on PATH | Observed |
| E-40-04 | A settings file with no `schema_version` member makes `muse exec` refuse (`malformed settings file ... no schema_version member; add "schema_version": 1`), while `muse --version` and `muse mcp list` still answer. A recipe that created the file with only the entry would therefore break the host. | the same | Observed |
| E-40-05 | A settings file that holds both `mcp_servers` and `mcpServers` makes `muse mcp list`, `get` and `add` fail with the fault `ambiguous_user_key` (field `/mcpServers`) and leaves the file unchanged; `muse exec` still ran the echo provider. The hand-merged snippet of Phase 36 used `mcp_servers`, so an operator who followed it and then installs the recipe would break `muse mcp`. | the same | Observed |
| E-40-06 | Prime Agent 0.10.2: `prime-agent mcp add NAME -- COMMAND ARGS` writes `mcpServers.NAME = { type: "stdio", command, args }` into `settings.json` of the agent directory, which is the home `.prime/agent` or, when `PRIME_AGENT_CODING_AGENT_DIR` is set, that directory itself (it also creates `auth.json` beside it). Two-space indent, no trailing newline. `mcp add other` and `mcp remove other` leave the realm entry value-identical. `mcp list` and `mcp get realm` print only `realm: stdio` (no argument list, no server start). | `prime-agent mcp --help`, `mcp add --help`, a throwaway HOME with and without the variable | Observed |
| E-40-07 | Grok Build 1.0.77: `grok mcp add NAME -- COMMAND ARGS` (scope user, the default) writes the table `[mcp_servers.NAME]` into `.grok/config.toml` below HOME with `command`, a multi-line `args` array (four-space indent) and `enabled = true`; the file ends in a newline. A later `grok mcp add other` or `grok mcp remove other` leaves that table byte-identical, but rewrites a hand-written single-line `args` array into the multi-line form and drops comments (a comment-dropping editor, as Codex). `grok mcp --help` names `~/.grok/config.toml` as the user config. | `grok mcp --help`, `grok mcp add --help`, a throwaway HOME | Observed |
| E-40-08 | Grok Build documents no relocation variable (the 2026-10-22 page read says to set HOME); `grok mcp list` prints `realm: realm mcp --host grok-build` and starts nothing; `grok mcp doctor` starts the server: with a stub `realm` that does not speak MCP it records the argument list `mcp --host grok-build`, prints `server started` and `handshake failed`, and exits 1. | the same; `docs/hosts/snippets/grok-build.md` | Observed |
| E-40-09 | Grok Build reads three MCP sources (`grok mcp doctor`): `~/.grok/config.toml`, `~/.claude.json` and `.mcp.json`. With a `realm` server only in `~/.claude.json` (the entry `realm mcp --host claude` that the `claude` recipe writes) Grok lists and starts it, so the session is attributed `claude`; with a `realm` in both files the `config.toml` entry is the one listed (`--host grok-build`) and the Claude file contributes no second server. | `grok mcp doctor --json` in two throwaway HOMEs | Observed |
| E-40-10 | `HOST_LABEL` accepts `^[a-z][a-z0-9-]{0,31}$`: the three ids (11, 10 and 10 characters, one hyphen) pass, as `kimi-code` does. Receipts, presence directories and the boot report use the id as a name or a closed-list member and need no change. | `src/daemon/channel.ts` line 125; `src/host/receipt.ts`; `src/host/presence.ts`; `src/host/boot-report.ts` | Observed |
| E-40-11 | `json-merge` is the only recipe kind that cannot express Muse's file: it creates a missing file holding only the entry (`planJsonInstall`, `current === null`), refuses only a non-object parent, and on uninstall removes a created file only when the document is empty. `toml-table` accepts a multi-line owned text (key lines may not be blank, a comment or start with an opening bracket; a closing bracket line and an indented continuation are fine). | `src/host/recipe.ts` lines 431 to 534; `src/host/toml-owned.ts` lines 60 to 78 | Observed |
| E-40-12 | The contract checker reads a toml-table recipe's argument list with one regular expression on line 3 of the owned text (`args = [...]` on one line). A multi-line array reads as `null` and trips `launch-unsafe`. | `test/support/host-contract.ts` lines 258 to 285 | Observed |
| E-40-13 | Pinned lists and counts that include the three ids today: see D-40-12 (about 45 places). The module-size gate covers `src` only; `src/host/recipe.ts` is 919 lines, `runtimes.ts` 387, `types.ts` 249. | `grep` over src, test, docs, scripts; `scripts/check/module-size.mjs` | Observed |
| E-40-14 | The Muse Code live test of Phase 36 (`test/integration/host-live-muse.test.ts`, helpers `test/support/host-live-muse.ts`, hermetic pins `test/integration/host-live-muse-helpers.test.ts`) writes the hand-merged snippet verbatim, with a recorder named `realm` first on PATH, and passed on 2026-11-18 with Muse 1.4.23. The wave-2 live table (`test/support/host-live-wave2.ts`, `host-live.ts`, `test/integration/host-live-wave2.test.ts`) fits a host whose recipe is installed by `realm host install` and read back by the host's own commands. | those files; `docs/hosts/snippets/muse-code.md` | Observed |
| E-40-15 | The support matrix page is a generated view: `REALM_WRITE_HOST_MATRIX=1 node --test dist/test/docs/host-support-matrix.test.js` rewrites the block between its markers; the registry (`test/support/host-registry.ts`) is a full record over `HostId`, so a host without a record fails compilation, and a host with a recipe needs a suite file that calls a `defineHost...Suite(` function and names the id. | `test/support/host-support-matrix.ts`; `test/host/host-registry.test.ts` | Observed |
| E-40-16 | The docs site is built by VitePress from the repository Markdown (`site/`, CI job `site`); a raw tag-like token outside code breaks it, and `check:docs` runs the host-path, agents-sync and default-mode guards. `site/` has no installed dependencies here, so the local site build runs only if `npm ci --prefix site` is possible. | `package.json`; `.github/workflows/ci.yml` lines 110 to 135 | Observed |

### D-40-01. Three ids, appended, config-only tier

The ids are `muse-code`, `prime-agent` and `grok-build` (the names `docs/hosts/snippets`, the guard test and the Phase 34 record already use, and the `snippetOf` lookup of the doctor resolves them to their pages without an alias). They are appended to `HOST_IDS` after `pi`, in that order, so every ordered list (the matrix, `realm host list`, the registry) only grows at the end. Rows: display names `Muse Code`, `Prime Agent`, `Grok Build`; flags `--muse-code`, `--prime-agent`, `--grok-build` (the identity rule of the contract checker requires `--ID`; the flag is shown by `realm host list` and is not a GSD Core installer flag); `integration` `mcp-config` (derived: only `omp` is `extension`); tier `config-only`; no aliases.

Tier `config-only` is the tier of the wave-2 hosts: the recipe is proven on fixtures and against the host's own commands, and no production tier is defined (25-CONTEXT D-25-08, OQ-25-09). The tier is not promoted by this phase (D-40-06).

### D-40-02. Per host: what its config surface allows (the decision the owner asked for)

| Host | Config surface verified? | Decision | Recipe | Home and detection | Value |
| --- | --- | --- | --- | --- | --- |
| Muse Code 1.4.23 | Yes: the host's own writer and reader, E-40-02 to E-40-05 | host id, manifest and recipe | `json-merge`, file `settings.json`, key path `mcpServers.realm`, `seed` `schema_version: 1`, `refuseIfPresent` `mcp_servers` | home `.config/muse`, base variable `XDG_CONFIG_HOME` with `sub` `muse`, binary `muse` | `{ type: "stdio", command: "realm", args: ["mcp", "--host", "muse-code"], required: true }` |
| Prime Agent 0.10.2 | Yes: E-40-06 | host id, manifest and recipe | `json-merge`, file `settings.json`, key path `mcpServers.realm` | home `.prime/agent`, override variable `PRIME_AGENT_CODING_AGENT_DIR`, binary `prime-agent` | `{ type: "stdio", command: "realm", args: ["mcp", "--host", "prime-agent"] }` |
| Grok Build 1.0.77 | Yes (new since the 2026-10-22 read, which found no direct MCP key): E-40-07 to E-40-09 | host id, manifest and recipe | `toml-table`, file `config.toml`, table `mcp_servers.realm` | home `.grok`, no variable, binary `grok` | the four-line table Grok writes (D-40-05) |

The fallback the owner's decision names (a host with no verifiable config surface stays config-only with a label in its launcher) is not needed for any of the three on this evidence. It stays the rule if the probe of plan 40-02 Task 1 contradicts a row: that host then gets the id, the manifest and the launcher label only, `recipe: null` (it refuses `realm host install` as `recipe-pending`, like the three deferred hosts) with a registry deferral record, and the snippet carries the labelled launcher (D-40-13).

The recipes register the MCP server and nothing else. The Muse Code plugin bundle (`muse plugins install`, which asks for hook approval) and the Prime Agent skill package (`prime-agent package install`) change the user's configuration in ways a recipe must not, so they stay documented manual steps.

### D-40-03. Two optional members for the `json-merge` recipe, used only by Muse Code (plan 40-01)

E-40-04 and E-40-05 are two ways a plain `json-merge` breaks Muse Code, so the recipe vocabulary gets two optional members, validated like `keyPath` (safe key segments, bounded, `SCHEMA_INVALID` on a bad value, the table deep-frozen):

- `seed`: a plain JSON object of top-level members that are written only when Realm creates the file (`current === null`), before the entry. They never touch an existing file. Muse: `{ "schema_version": 1 }`. A seed key may not equal the first segment of `keyPath`. Uninstall removes a file Realm created when the document holds exactly the seed members (by canonical value) and nothing else; a created file that Muse has since changed (another server, another member) is kept, as today.
- `refuseIfPresent`: top-level keys of the document whose presence refuses install and reinstall with the existing reason `foreign-content` (fixed text, no key name echoed). Muse: `["mcp_servers"]`, the other spelling of the same list. The operator's fix, written in the snippet, is to remove or relabel the old entry by hand first.

Both are data on the row, pure, and need no new refusal reason, error code, receipt field or state-machine change. Names avoid the substrings the bare-recipe test forbids (`env`, `token`, `key`, `secret`). The alternative considered and rejected: refuse to install when the settings file is absent. It would force every operator through a first Muse run and it does not solve the two-spelling fault (OQ-40-02).

### D-40-04. Muse Code: the recipe uses the spelling Muse writes, and keeps the entry required

The value is what `muse mcp add-json realm` accepts and what Muse's own writer produces (`mcpServers`, `type: "stdio"`), plus `required: true` (E-40-03). Rationale for `required: true`: the Phase 36 snippet used `mode: "required"` on purpose, so that a run whose Realm server fails to start aborts instead of silently continuing with Muse's own unsandboxed tools. A recipe that dropped it would weaken the guarantee the snippet gave. The shipped hand-merge snippet `adapters/muse-code/mcp-settings.snippet.json` takes the same shape and the same label, so there is one spelling and a test pins the snippet's entry deep-equal to the recipe value (`museSettingsText` of the hermetic helpers). The old `mcp_servers` spelling is documented as superseded, with the E-40-05 hazard and the migration step.

### D-40-05. Grok Build: the owned table is the text Grok writes, multi-line

The owned text is exactly what `grok mcp add realm -- realm mcp --host grok-build` writes (E-40-07): the header, `command = "realm"`, the `args` array over six lines with a four-space indent, and `enabled = true`. Reason: Grok rewrites a single-line array into this form on any later `grok mcp add` or `remove` (E-40-07), which would make `realm host status` read `drifted` and refuse `realm host uninstall`; the host's own canonical form is stable. The toml-table engine already accepts the text (E-40-11). The contract checker's argument reader is generalised (plan 40-01) to read the array whether it is on one line or spread over several, with a mutant test; the 15 existing rows keep their single-line text.

### D-40-06. Evidence tier: validator only, no production tier, no model-driven call

Each host is installed here, so plan 40-03 runs the validator tier live, in isolated homes with the stub `realm` that records its argument list (no Podman, no network, no credential, no model prompt, no shared live lock, because nothing touches the production stack):

- Muse Code reuses the Phase 36 test (E-40-14), re-pointed at the recipe: the real `realm host install muse-code` writes the file instead of the hand-written snippet; the host's own commands then list it, start it (the stub records `mcp --host muse-code`), and a broken server fails the run because the entry is required.
- Prime Agent and Grok Build join the wave-2 table (opt-ins `REALM_LIVE_PRIME_AGENT` and `REALM_LIVE_GROK_BUILD`, executable overrides `REALM_PRIME_AGENT_BIN` and `REALM_GROK_BUILD_BIN`). Grok's `mcp doctor` starts the registered command and records the argument list; Prime Agent's `mcp list` and `mcp get` print the entry's name and transport only (E-40-06), so the label is proven by the file bytes the test reads back.

No production tier (T3) is defined: the tier is `config-only` (D-25-08), and the hosts cannot drive a session that calls a Realm tool without a model: Muse's echo provider never calls tools, and Grok Build and Prime Agent need a provider credential. The statement "attaches and completes a tool call under the default" (HOSTID-02) is therefore proven where it can be, at the daemon, and the document says so (D-40-09): the E1 matrix of `test/integration/enforce-default.test.ts` runs `realm mcp --host ID` for every `mcp-config` id, now 21, against a real daemon whose policy has no `capabilityTokens` key, answers a `status` call, and checks the attach and call audit lines carry that id and a key id. For the three new ids E1 additionally runs the exact argument list the recipe registers (read from the table), so the launcher a host starts is the launcher that was tested. A model-driven call through the hosts' own model loops is a stated limit, not a claim.

### D-40-07. Where the live tests live, and how the matrix shows them

Prime Agent and Grok Build become entries 14 and 15 of `LIVE_HOST_IDS` and of `WAVE2_LIVE_IDS`; their registry records say `live` with the same id, so the matrix prints the gate and the dated T2 result. Muse Code keeps its own test and helper module (a different shape: bundle validation, `exec`, a fake server); its registry record keeps `live: null`, so the generated gate cell reads `none`, and the T2 result text names `REALM_LIVE_MUSE=1` and the test file, so the page does not understate it. Folding Muse into the wave-2 table is a refactor of two pinned modules outside this phase (OQ-40-03).

### D-40-08. Shipped launchers and the guard test

- `adapters/muse-code/mcp-settings.snippet.json`: the D-40-04 shape. `adapters/prime-agent/MCP.md`: `prime-agent mcp add realm -- realm mcp --host prime-agent`. The three snippet pages carry the same labelled launcher lines; their prose is rewritten in plan 40-03.
- `adapters/claude-plugin/.mcp.json` stays `--host claude`. The Grok Build page says: for a Grok session attributed `grok-build`, register the server in Grok's own config (`realm host install grok-build` or `grok mcp add`), not through the shared plugin bundle (D-40-09).
- `test/host/adapters-labelled.test.ts` loses `NAMED_HOSTS`, `NAMED_UNLABELLED_FILES` and the two tests that guard them. The remaining rule is total: every launcher in the adapters, the snippets and the README carries a canonical `mcp-config` id. The scan-presence test keeps its file list. New pins: the shipped Muse snippet entry equals the Muse recipe value; each of the three adapters and snippets names its own id (a test row per host, so a copy-paste of another host's label fails). The guard fails the moment the ids exist and a file is still bare, so the ids, the labelled files and the guard land in one commit (plan 40-02, Commit Unit A).

### D-40-09. Gap rows: GAP-34-01 closes, GAP-40-01 records the shared Claude configuration

- `GAP-34-01` becomes status `closed`, class unchanged (`accepted-residual`), evidence: the three ids, rows, recipes and suites (`src/host/runtimes.ts`, `test/host/runtimes.test.ts`, `test/host/adapters-labelled.test.ts`, `test/integration/enforce-default.test.ts`), and the dated validator runs; next step `none`. The host-gaps test requires a closed row to cite existing repository paths in code spans.
- New row `GAP-40-01` (source `40-CONTEXT D-40-09`, class `accepted-residual`, status `accepted`): a Grok Build session that loads the Claude plugin bundle or starts the entry the `claude` recipe wrote into `~/.claude.json` (E-40-09) is attributed `claude`, not `grok-build`; and no model-driven tool call was made through any of the three hosts' own model loops (D-40-06). Lift conditions: a Grok Build plugin bundle of its own, or a host feature that names the host in a shared file; a provider seam for a scripted model in each host. `test/docs/host-gaps.test.ts` accepts phases 21 to 34 only: the bound becomes 40.

### D-40-10. What an existing install must do (HOSTID-03 migration notes)

| Prior state | What changes | What the operator does |
| --- | --- | --- |
| Muse Code, hand-merged the Phase 36 snippet (`mcp_servers.realm`, unlabelled) | Under the default the session is refused; the new snippet and the recipe use `mcpServers` | Remove the old `mcp_servers` realm entry, then run `realm host install muse-code` (it refuses with `foreign-content` while `mcp_servers` exists) or merge the new snippet by hand; never keep both spellings (`ambiguous_user_key`) |
| Muse Code, entry added with `muse mcp add realm -- realm mcp` (unlabelled) | refused under the default | `muse mcp remove realm`, then `realm host install muse-code`; or edit the args to add the host flag |
| Muse Code, opted out (`capabilityTokens.mode` `off`) or borrowed a label (`--host claude`) | nothing breaks | optional: switch to `muse-code` so the audit names the host, then remove the opt-out |
| Prime Agent, `prime-agent mcp add realm -- realm mcp` | refused under the default | `prime-agent mcp remove realm`, then `realm host install prime-agent`, or `prime-agent mcp add realm -- realm mcp --host prime-agent` |
| Grok Build through the Claude plugin bundle or the `claude` recipe | attributed `claude`, unchanged | to be attributed `grok-build`: `realm host install grok-build` (its `config.toml` entry shadows the Claude one by name, E-40-09) |
| A `profiles` entry for `claude` that the operator meant for Grok Build | none | add `profiles` entries for the new ids if the profile should differ (the schema accepts them now) |

`realm host uninstall ID` removes only what the install wrote (receipt-owned): the table, the key, and a settings file that holds nothing but the seed.

### D-40-11. Commit conventions: additive, no breaking marker (OQ-40-04)

Every change is additive for a client that works today: the closed lists and `realm host list` only grow, the `profiles` schema accepts more keys, and no session that was admitted before is refused now; an operator who opted out or borrowed a label keeps working, and an unlabelled launcher was already refused by Phase 34. So the commits of this phase use plain Conventional Commit subjects (`feat(host): ...`, `test(host): ...`, `docs(host): ...`) with no `!`, and the subject of the Commit Unit A commit is written to stand alone as a release note: "feat(host): host ids muse-code, prime-agent and grok-build with install recipes; the shipped launchers carry their label (GAP-34-01 closed)". If the owner prefers to flag the respelled Muse snippet as breaking for hand-merged installs, only that unit's subject gains `!` (cheap, and the migration table of D-40-10 already exists). The pull request lands as a merge commit; `CHANGELOG.md` and version fields are not edited.

### D-40-12. Every pinned count and list that changes (the executor's probe is authoritative; this is the prediction)

After the phase: `HOST_IDS` 22; `mcp-config` hosts 21; hosts with a recipe 19 (18 `mcp-config` recipes plus the Omp bundle copy); recipe-pending 3 (unchanged); `BOOT_REPORT_HOSTS` 23; policy `profiles` enum 22; live hosts 15, of which wave-2 hosts 11.

| Area | File and place | Change |
| --- | --- | --- |
| Source | `src/host/types.ts` `HOST_IDS` and the comment above it; `src/core/policy.schema.json` the `propertyNames` enum of `profiles`; `src/host/runtimes.ts` three rows and its header comment; `src/host/boot-report.ts` and `src/cli/host.ts` comments (19) | +3 |
| Source | `src/host/types.ts` and `src/host/recipe.ts`, `json-merge` | `seed`, `refuseIfPresent` (plan 40-01) |
| Tests, host | `test/host/runtimes.test.ts`: `EXPECTED_IDS`, `EXPECTED_FLAGS` (split: the 18 GSD Core flags and the 3 Realm-only flags), `EXPECTED_TIERS`, `EXPECTED_HOMES`, `WITH_RECIPE`, `EXPECTED_OVERRIDES`, `EXPECTED_BINARIES`, the `expectedBase` expression, the titles and the counts at lines 88, 93, 96, 152, 174 and 647 | +3; 19 to 22; 18 to 18 plus 3; 16 to 19 |
| Tests, host | `test/host/adapter.test.ts` line 106; `boot-driver-conformance.test.ts` lines 12 and 13; `manifest.test.ts` line 139; `recipes-bare.test.ts` (title and counts 18 and 15, lines 2, 60, 61, 77, 81, 86, 118); `boot-report.test.ts` line 51 (20) | 19 to 22; 18 to 21; 15 to 18; 20 to 23 |
| Tests, host | `host-registry.test.ts`, `host-contract-matrix.test.ts`, `host-lifecycle-matrix.test.ts` (comment of line 1) | derived from the table; no literal; the comment count changes |
| Tests, cli and integration | `test/cli/host.test.ts` lines 3, 161 to 173, 183 to 189, 699 (`rows.length`, the `ready` list, 16 to 19, the title); `test/cli/stdio-host-matrix.test.ts` header, lines 113 and 114; `test/integration/enforce-default.test.ts` lines 5, 43, 214 and 215; `test/integration/host-boot-matrix.test.ts` comments of lines 2 and 6 | 19 to 22; 18 to 21 |
| Tests, schema and docs | `test/core/policy.schema.test.ts` line 259 (19); `test/docs/capability-token-doc.test.ts` lines 144, 255, 260, 292 to 300, 331 to 333, 342; `test/docs/host-gaps.test.ts` phase bound 34 | 19 to 22; text pins; 34 to 40 |
| Tests, support | `test/support/host-registry.ts` (+3 records); `test/support/host-config-goldens.ts` (+3 goldens); `test/support/host-live.ts` (`LiveHostId`, `LIVE_HOST_IDS`, `HOST_LIVE`, `HOST_OVERRIDE_VARIABLES`); `test/support/host-live-wave2.ts` (`Wave2LiveId`, `WAVE2_LIVE_IDS`, `WAVE2_LIVE`); `test/integration/host-live-helpers.test.ts` (the list of line 99, the title "thirteen", `expected`, `displayNames`, `RECORDED_OUTPUT`, `WAVE2_OVERRIDES`); `test/support/host-live-muse.ts` and its two tests | +3; 13 to 15 live hosts; 9 to 11 wave-2 |
| Tests, support | `test/support/host-recipe-suite.ts` (descriptor members for the seed and the rival key); `test/support/host-contract.ts` (`registeredArgvOf`, multi-line array) | plan 40-01 |
| New tests | `test/host/muse-code-recipe.test.ts`, `prime-agent-recipe.test.ts`, `grok-build-recipe.test.ts` (no basename holds `mcp` or `acp`) | new |
| Scripts | `scripts/check/pack-smoke.mjs` lines 5, 70, 85 and 86 (19); `pack-smoke.test.mjs` lines 363 (`/!== 19/`) and 562 (`length: 19`); `scripts/check/export-usage-allowlist.json` line 313 (the reason text says 19 ids) | 19 to 22 |
| Docs | `docs/policy-reference.md` line 287 (19); `docs/integration/mcp.md` lines 131, 205 (the `profiles` keys cell, pinned equal to the schema), 237 and the Q10 migration paragraph (counts 18 and 15, pinned phrase); `docs/integration/host-plugin-contract.md` lines 3, 5, 29, 203, 259, 291, 299, the "The 19 hosts" section and its table, the Phase 24 and 25 tables (a Phase 40 table is added), the evidence tables; `docs/integration/hosts.md` lines 29 and 31; `docs/integration/host-plugin-gaps.md` rows GAP-21-02, GAP-23-03, GAP-34-01 and the new GAP-40-01; `docs/integration/host-support-matrix.md` (regenerated block and prose); `docs/integration/writing-a-host-plugin.md` (Step 2 recipe table); `README.md` lines 258 to 261 and 273; `AGENTS.md` line 64 (the 19-host table, 16 recipes and their list); the three snippet pages | counts and lists; migration notes |

### D-40-13. If a probe contradicts the evidence

Plan 40-02 Task 1 re-runs the host commands of E-40-02 to E-40-09 in throwaway homes before it edits anything and writes the observed bytes into the goldens. A host whose output differs from this context (a newer version that moved a file or changed the entry shape) is not forced into a recipe: it takes the D-40-02 fallback, and the executor records the difference as a finding in the summary. The three goldens are the observed bytes of each host's own writer, so a drift in a later host version fails a hermetic test, not a live one.

### Open questions (defaults taken; none blocks)

- **OQ-40-01.** Should the Muse recipe keep `required: true` (default taken, D-40-04: the Phase 36 posture, a failed Realm aborts the run) or write the entry `muse mcp add` writes with no `required` (a failed Realm leaves Muse running with its own unsandboxed tools, silently)?
- **OQ-40-02.** `seed` and `refuseIfPresent` on `json-merge` (default taken, D-40-03) versus a refusal when the settings file is absent plus documentation for the two-spelling hazard.
- **OQ-40-03.** Fold Muse Code into the wave-2 live table so that the matrix shows its gate (default taken: no, D-40-07; the gate is named in the T2 result text).
- **OQ-40-04.** The `!` marker for the commit that respells the shipped Muse snippet (default taken: none, D-40-11).
- **OQ-40-05.** Whether the owner wants a production-stack boot rehearsal for Muse Code (installed here) or the others later: the tier is `config-only` by owner decision D-25-08 and no model-driven call is possible without credentials; Phase 31 rehearsed the wave-1 hosts only.

### Threat model (summary; each plan carries its STRIDE rows)

Assets: the audit attribution (`host` on every admission and result line), the profile of each host, the user's host configuration files, the receipts.

| Actor | Before | After | Stays open |
| --- | --- | --- | --- |
| A session of Muse Code, Prime Agent or Grok Build | Refused (unlabelled) or attributed to another host (`claude`) | Attributed to its own id; its profile can be set separately | The label is self-declared (D-32-02); a process of the same user can attach as any host |
| The installer, writing three more user files | Not applicable | Writes only the owned entry; receipt-owned removal; never overwrites foreign content; never creates a Muse file the host would reject | The hosts rewrite their files with their own editors: Grok drops comments |
| An operator with both Muse spellings | Not applicable | The install refuses; the snippet explains | A hand edit that creates both spellings later breaks `muse mcp`, not Realm |
| A Grok Build session through the Claude files | Attributed `claude` | Attributed `grok-build` when installed through Grok's own config; `claude` otherwise | GAP-40-01 |
| Documents and evidence | Not applicable | No host path, no token, counts and versions only; no raw angle token outside code | none |
</decisions>

<canonical_refs>
## Canonical References

- `.planning/MILESTONE-CONTEXT.md` (D-v6-4), the v6.0 section of `.planning/REQUIREMENTS.md` (HOSTID-01 to HOSTID-03), the Phase 40 block of `.planning/ROADMAP.md`.
- The Phase 34 record: `.planning/milestones/v5.0-phases/34-capability-tokens-enforce-by-default/34-CONTEXT.md` (D-34-07, OQ-34-01), `34-03-PLAN.md` (the guard test and the migration section), and `docs/integration/host-plugin-gaps.md` GAP-34-01.
- The wave-2 record: `docs/integration/host-plugin-contract.md` (the recipe tables, the evidence tiers), `docs/integration/writing-a-host-plugin.md`, `docs/integration/host-support-matrix.md`, `test/support/host-registry.ts`, 25-CONTEXT D-25-02, D-25-08, D-25-09 (the ship rule, the tier, the live table).
- `src/host/{types,manifest,runtimes,recipe,toml-owned,toml-table,adapter,install}.ts`, `src/core/policy.schema.json`, `src/cli/{main,host}.ts`.
- `test/support/{host-contract,host-recipe-suite,host-registry,host-config-goldens,host-live,host-live-wave2,host-live-muse,fixture-host}.ts`, `test/host/{adapters-labelled,runtimes,recipes-bare,host-registry,host-contract-matrix,host-lifecycle-matrix}.test.ts`, `test/integration/{enforce-default,host-live-muse,host-live-muse-helpers,host-live-helpers,host-live-wave2}.test.ts`.
- `scripts/check/{host-paths,module-size,export-usage-gate,pack-smoke,agents-sync,default-mode}.mjs`, `scripts/release/changelog.mjs`.
- Style precedent: the Phase 34 and 36 plans in `.planning/milestones/v5.0-phases/`.
</canonical_refs>

<specifics>
## Wave Structure

| Wave | Plan | What |
| --- | --- | --- |
| 1 | 40-01 | The `json-merge` extension (`seed`, `refuseIfPresent`) and the generalised argument reader of the contract checker. Behaviour neutral for every existing row; green on its own. |
| 2 | 40-02 | The three ids, rows, schema enum, recipes, suites, goldens, registry records, every pinned count, the labelled shipped launchers and the guard test, in one green commit unit; then the hermetic attach proof (E1) and the pack smoke. |
| 3 | 40-03 | The validator tier live (Muse re-pointed, Prime Agent and Grok Build in the wave-2 table), run on this machine with dated results; the gaps rows, the snippets, the migration notes, the contract and matrix documents; the final gates. |

Wave 2 needs wave 1 (the Muse row uses the new members). Wave 3 needs wave 2 (the ids exist before a live test names them). Files are disjoint across plans except `test/support/host-recipe-suite.ts` and `test/support/host-contract.ts` (40-01 only) and `test/support/host-live.ts` (40-03 only).

## Hygiene for every plan

No `src/contract/tools.schema.json` change; no new error code; no `daemon.ts` or `main.ts` edit. `src/host/recipe.ts` stays under 1000 lines (919 now; the extension is about 40 lines) and `src/host/runtimes.ts` too. No host path in any committed file (`node scripts/check/host-paths.mjs` scans `docs` and `.planning`; use placeholders such as SCRATCH_HOME; the patterns that fail are the four absolute prefixes for the root user, the temporary directory, macOS and Linux home directories). Raw angle tokens outside code fences are escaped; inside plan task blocks there are no angle brackets at all. Every new `src` export has a `src` importer (export-usage gate; this phase adds no export); a test-only export needs an allowlist entry and a stale entry fails the gate. Lint: no unnecessary conditions after assert narrowing, `restrict-template-expressions` (wrap numbers in `String(...)`), `no-base-to-string`, `prefer-const`, `void test(...)`. Gate closure: nothing reachable from the exec gate closure reaches `node:child_process`; `src/contract` imports nothing from `host/` or `capability/` (the schema enum is a JSON literal, pinned to `HOST_IDS` by a test). Tests assert observable behaviour only; doc pins read documents. Test file basenames never contain `mcp` or `acp` (the taxonomy test). The new tests pass as a regular non-root user (Phase 42's whole-suite run includes them).

## Live window rule (plan 40-03)

The owner authorized live windows on 2026-11-18. This phase needs none on the shared realm account: the host CLIs run in throwaway homes with a stub `realm` and no Podman, so no shared lock is taken, the production stack is untouched, and no credential is forwarded. The executor runs the three gated tests itself; each test hashes the operator's real configuration files of the host before and after and fails on a change; evidence is the dated test output (versions, counts, exit codes), recorded in the registry, the snippets and the summary, with no host path and no file content.

## Deferred

- A Grok Build plugin bundle of its own (GAP-40-01), a production tier or a model-driven call for the three hosts (OQ-40-05), folding Muse into the wave-2 table (OQ-40-03).
- A `muse plugins` or `prime-agent package` installer path (a recipe must not change hook approvals or packages).
- Any change to the audit bound, the token lifetime or the profile model.
</specifics>

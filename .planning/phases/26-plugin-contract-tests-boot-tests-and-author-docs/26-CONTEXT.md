# Phase 26: Plugin contract tests, boot tests and author docs - Context

**Gathered:** 2026-11-17, from `main` at 2540115 (v0.3.48): `src/host/*.ts`, `src/cli/{main,stdio-host,host}.ts`, `test/host/*`, `test/cli/stdio-host.test.ts`, `test/integration/host-boot-isolation.test.ts`, `test/support/{host-boot-conformance,reference-boot-hook,omp-boot-hook,host-recipe-suite,host-config-goldens,fixture-host,fake-host-daemon,realm-daemon-fixture,stdio-host-harness,host-live}.ts`, `docs/integration/{host-plugin-contract,hosts}.md`, `docs/hosts/snippets/*`, `scripts/docs/sync-site.mjs`, `scripts/check/*`, `.github/workflows/{ci,pages,mutation}.yml`, and the Phase 21 to 25 planning files (CONTEXT, VERIFICATION, SUMMARY, PLAN). Phase 25's own VERIFICATION is not in the repository yet (its closer is running); Phase 25's gap list is therefore taken from `25-CONTEXT.md` and the "Evidence limits" section of the contract doc, and plan 26-03 reconciles it with `25-VERIFICATION.md` if that file exists when 26-03 runs.
**Status:** Planned (three plans, nothing executed). Requirement IDs TEST-HOST-01..TEST-HOST-08 are defined in this file's `<specifics>` block and are not yet in `.planning/REQUIREMENTS.md`; the orchestrator registers them with gsd-tools. `.planning/ROADMAP.md` still shows Phase 26 as "To be planned"; the orchestrator updates it.

<domain>
## Phase Boundary

Phases 21 to 25 built the host plugin contract (a 19-row runtime table, a strict manifest, a capability catalogue, the boot-hook port and its conformance harness, an installer engine with five recipe kinds, ownership receipts, an audit chain, the `realm host` command), the boot path (`realm mcp|acp --host ID` through one attach, one observer and one driver), and 16 recipes (3 hosts are owner-approved deferrals). The direction is fixed by the owner and is not reopened: the plugin loads into each CLI agent; the agent is the host process and Realm is the sandbox it attaches to; Enterprise baseline only (the structured logger, redaction, least privilege and the hash-chained audit trail); merge when CI is green.

Phase 26 does not add a host, a recipe kind or an engine feature. It answers three questions about what already exists, and plans only the real gaps (G1 to G8 below):

1. **Is the contract enforced as a contract, or only as 19 hand-written pins?** A cross-host contract matrix drives every row of the real table through the same invariants, a registry says which evidence each host has, and a completeness meta-test fails when a row is added without its suite, snippet and live spec (TEST-HOST-01 to TEST-HOST-03).
2. **Does the boot path behave the same for every stdio host id, and would the conformance harness notice if it did not?** The production driver passes the nine conformance cases for all 18 `mcp-config` hosts (today 2), the harness is shown to fail on a seeded defect for every case (today 4 of 9), and a boot matrix runs every host id through `realm mcp` and `realm acp` against scripted daemons and against a real in-process daemon with no Podman (TEST-HOST-04 to TEST-HOST-06).
3. **Can a stranger add a host?** A guide "Writing a Realm host plugin", a per-host support matrix that a test keeps equal to the table, and a tracked gaps page that turns the Phase 21 to 25 unverified and residual lists into rows with a status (TEST-HOST-07, TEST-HOST-08).

Out of scope (not claimed): a new host, recipe, recipe kind or engine behavior; any live registration in a real host configuration (every rehearsal keeps its isolated `HOME`); new T2 or T3 evidence for any host (the matrices run on fixtures and fakes and say so); a published conformance package (the harness stays under `test/support`; publishing it is a separate decision recorded as deferred); changes to the sandbox mount set; a JSONC-aware merge; project-level install; ROADMAP, STATE and REQUIREMENTS edits (the orchestrator owns them).
</domain>

<decisions>
## Implementation Decisions

### What already exists (verified in the repository, 2026-11-17)

| Area | What exists | Evidence |
| --- | --- | --- |
| Engine | five recipe kinds (`json-merge`, `text-block`, `toml-table`, `yaml-map`, `bundle-copy`), pure planning, atomic write with a hash re-check, receipts, a `host-plugins` audit chain, `host.log`, the `shadows` guard | `src/host/{recipe,install,adapter,receipt,host-audit,toml-owned,yaml-owned,yaml-scan,presence}.ts` |
| Table | `HOST_RUNTIMES`, a full record over `HOST_IDS`; 19 rows; 16 with a recipe; `windsurf`, `trae`, `zcode` have `recipe: null`; `entry()` deep-freezes | `src/host/runtimes.ts` (387 lines), `src/host/types.ts` |
| Per-host recipe suites on the REAL row | `defineHostRecipeSuite` (json), `defineHostTomlSuite`, `defineHostYamlSuite` register lifecycle, drift, concurrency, mode, doctor, override, symlink, hostile content and format cases per host | `test/support/host-recipe-suite.ts` (879 lines); consumers `claude-recipe`, `opencode-recipe`, `kimi-recipe` (kimi and kimi-code), `codex-recipe`, `wave2-json-recipes` (eight hosts in one file), `codebuddy-recipe`, `hermes-recipe`, `omp-recipe` (own tests), `shadows` |
| Table pins | hand-written expected values per host: ids, flags, tiers, homes, overrides, binaries, the 16/3 split, deep freeze, `registeredArgv` equals `defaultManifestFor(id).launch` | `test/host/runtimes.test.ts` (648 lines) |
| A few all-host loops | every default manifest parses and round-trips; every launch names its host; 19 adapters construct without touching the file system; `bootHookOf` is null for `omp` only; boot-report vocabulary equals `HOST_IDS` | `test/host/{manifest,adapter,boot-driver,boot-report}.test.ts` |
| Conformance | nine cases C1 to C9 against fakes; a reference hook and four broken variants; the real Omp plugin through its API double | `test/support/host-boot-conformance.ts`, `reference-boot-hook.ts`, `omp-boot-hook.ts`, `test/host/boot-conformance.test.ts`, `test/omp/boot-conformance.test.ts` |
| Production driver conformance | run for `claude` and `kimi-code` only (the `HOSTS` constant) | `test/host/boot-driver-conformance.test.ts` line 10 |
| Boot sequence, scripted | flags, numbered sequence, readiness, `--reattach` with injected timers, teardown on EOF and three signals, log levels, stdout purity; hosts `claude` and `kimi` | `test/cli/stdio-host.test.ts` (568 lines; the scripted `World`, `ScriptedClient`, `start` and `finish` live inside the file) |
| Boot isolation, real daemon | a real in-process daemon (`startRealmDaemon`) over the existing fakes, no Podman; hung `up`, failed boot, stdin close, report flood, three hosts on one project, hostile directory name; hosts `claude`, `codex`, `kimi` (ACP) | `test/integration/host-boot-isolation.test.ts`, `test/support/realm-daemon-fixture.ts` |
| Smoke | a built `realm mcp --host claude` writes its marker before the first reply | `scripts/check/mcp-smoke.mjs` |
| Live tiers | 13 `LiveHostId` rows (`claude`, `codex`, `opencode`, `kimi` plus nine wave-2 hosts), gated by `REALM_LIVE_ID`, isolated `HOME`, stub `realm`; a hermetic helper test always runs | `test/support/host-live.ts` (1069 lines), `test/integration/host-live-*.test.ts` |
| Docs | the contract page (365 lines: manifest, capabilities, boot, recipes, receipts, commands, the 19-host table, evidence limits, residuals), `hosts.md`, 19 snippets plus `deferred-hosts.md` | `docs/integration/`, `docs/hosts/snippets/` |
| Publishing | `scripts/docs/sync-site.mjs` mirrors every markdown file under `docs/` and `.planning/` into `site/content` (VitePress); CI builds the site on every PR; `check:docs` runs `host-paths.mjs` (no host-local path in `docs`, `.planning`, root docs), `agents-sync.mjs` and `default-mode.mjs` | `scripts/docs/sync-site.mjs`, `package.json` `check:docs`, `.github/workflows/{ci,pages}.yml` |
| Mutation | a weekly, report-only fallback campaign (12 mutants) over policy, redaction and `src/fs`; nothing in `src/host` | `scripts/mutation/run.mjs`, `.github/workflows/mutation.yml` |

### Gap inventory (what is NOT covered; each row names where it goes)

Only these are planned. Everything else in the table above is left alone.

- **G1. No single contract matrix.** The universal invariants (frozen rows, safe homes and paths, override resolution, launch argv safe and equal to the manifest, known recipe kinds, capability grants within the policy gates) are pinned per host by hand-written expectation tables plus four all-host loops. A new row or a changed recipe needs edits in six or more places and nothing fails if one is forgotten. Capability resolution is tested on synthetic manifests only (`test/host/capabilities.test.ts`), never on each host's default manifest under real policies. -> TEST-HOST-01.
- **G2. Nothing says which evidence each host has, and nothing fails when it is missing.** A 20th row could ship without a recipe suite, a snippet or a live spec. -> TEST-HOST-02 (registry plus completeness meta-test).
- **G3. No generic lifecycle invariant on every real row.** The per-host suites assert ownership, restoration and redaction with host-specific seeds; no test asserts, once and for all 16 recipes plus the three pending refusals, that an install writes nothing outside the resolved home and the state directory, that uninstall restores the exact bytes and removes only what Realm owns, and that no planted secret reaches a receipt, an audit line or the log. `buildRig.watched` hashes only HOME and the override directory. -> TEST-HOST-03.
- **G4. The production driver is conformance-tested for 2 of 18 hosts; the harness is mutation-tested for 4 of 9 cases.** C2, C3, C4, C7 and C9 have no seeded defect, so a harness regression in those cases would pass unnoticed (`MUTANTS` in `test/host/boot-conformance.test.ts`). The manifests of the 18 hosts differ only by launch arguments, so the risk is low, but it is unshown. -> TEST-HOST-04.
- **G5. Boot matrix.** Readiness, bounded retry, failure isolation and teardown are proven for `claude` and `kimi` on scripted daemons and for `claude`, `codex` and `kimi` on a real in-process daemon. The other 15 ids, and the rule "only the 18 canonical `mcp-config` ids are accepted by `--host`, no alias, no `omp`", are not exercised per id. The scripted `World` helpers are private to `stdio-host.test.ts`. -> TEST-HOST-05 (scripted matrix, helper extraction), TEST-HOST-06 (real-daemon matrix).
- **G6. No plugin author documentation.** No page tells a contributor how to add a host: the only author-facing text is the three lines under "Boot-hook port" on running `defineBootConformance` ("To check a new hook"). Nothing explains the table row, the recipe choice, the evidence rules of Phases 24 and 25 (O, D, S, 3, I tiers; the ship-or-defer rule), the recipe suites, the live-rehearsal gating or the PR gates. -> TEST-HOST-07.
- **G7. The support picture can drift.** The 19-row table in the contract page, the per-host lines of `hosts.md`, the tier tables and the snippets are hand-maintained prose. -> TEST-HOST-07 (a matrix page that a test regenerates and compares, and a path-existence test for the new pages).
- **G8. The Phase 21 to 25 residual and unverified lists live in five VERIFICATION and CONTEXT files** and in prose of the contract page. Several are stale (Phase 21's "no host loads a plugin" is narrowed by Phase 24's live claude and codex runs; its coverage floor 0 for `src/host` is still true in `scripts/check/coverage-floors.json`). -> TEST-HOST-08 (a tracked gaps page, verified by a test) and the `src/host` coverage-floor ratchet.

**Overlap, stated plainly.** Four of the D-26-03 rules restate something an existing test already asserts for the real table: `not-frozen` (the "frozen at every level" test of `runtimes.test.ts`), `launch-mismatch` (its `registeredArgv` test), `manifest` (the all-hosts loop of `manifest.test.ts`) and part of `identity` (its flag, alias and tier pins). They are kept in the single checker on purpose: the checker also holds an injected or fixture row to the same rules and is proven to fail on seeded defects, which no existing test is. The existing tests stay untouched (a failure in either place names the host). The genuinely new rules are `home-unsafe` and `env-shape` as generic rules (the GSD-only names), `launch-unsafe`, `capability-grant` on the default manifests, `shadow-shape`, `home-resolution` as a property and the whole lifecycle contract.

### Findings that shape the plans (verified 2026-11-17)

- **F1. The tests are the product here; `src` stays untouched.** Every matrix needs only seams that exist: `createHostAdapter` takes `audit`, `logger`, `reader`, `stageHook`, `bootHook`; `runCli` takes `connect`, `spawn`, `readConfig`, `mcpInput`/`mcpOutput`/`acpInput`/`acpOutput`, `signals`, `bootTimers`, `random`; `startRealmDaemon` takes a logger. If a matrix finds a real defect the fix is a minimal `src` change with a named regression test in the same plan, recorded in the SUMMARY; no defect is claimed today.
- **F2. Node test files run in separate processes**, so a runtime registry filled by `defineHostRecipeSuite` cannot be read by another file. Completeness is therefore checked against files: the registry names each host's suite file, and the meta-test reads that file, strips comments, and requires a `defineHost...Suite(` call and the host id as a string literal. This is a source check that must not match comments (lesson: static source greps match comments, strip them first).
- **F3. Test exports are outside the export-usage gate** (`scripts/check/export-usage.mjs` analyzes `src`), and `module-size.mjs` limits `src` only (`LINE_LIMIT` 1000): `host-live.ts` is 1069 lines and is not listed. New test support files carry no allowlist entry, and none is added.
- **F4. Published docs are fragile in two ways.** `sync-site.mjs` escapes tag-like tokens outside fenced code, and `check:docs` rejects host-local absolute path patterns (the four prefixes of `HOST_PATH_PATTERNS` in `scripts/check/host-paths.mjs`) in `docs`, `.planning` and root docs. New pages use `&lt;..&gt;` or plain capital words for placeholders, never a raw angle token, and name the temporary directory as `os.tmpdir()` in prose. Generated blocks sit between HTML comments, which the site passes through untouched.
- **F5. The real-daemon fixture admits a bounded number of sessions and stops when the last live session is released.** `host-boot-isolation.test.ts` keeps an `anchor` session and releases each project when its scenario ends; the matrix does the same and counts its own `down` requests, so "no boot path sent down" is an exact equality (`downCount() === releases`).
- **F6. `kimi` and `kimi-code` have no `binaries`** (they share the command name `kimi`, R5 of 24-VERIFICATION); the contract checker must not require a binary.
- **F7. The conformance harness is host-neutral by construction** (`host-boot-conformance.ts` names no host); the production driver differs per host only through the manifest passed in, so running it for 18 manifests is cheap (nine cases on fakes, no sockets).

### D-26-01. One registry, one checker, no second convention

New files hold shared logic; per-host files stay as they are.

| File | Provides |
| --- | --- |
| `test/support/host-registry.ts` | `HOST_REGISTRY`: for every `HostId` exactly one frozen record `{ id, family, suites, snippet, live, t2, t3, deferral }`: `family` is the recipe kind or `"none"`; `suites` the test files that run the host's recipe suite (a list of repo-relative paths); `snippet` the page under `docs/hosts/snippets` that documents it; `live` the `LiveHostId` or null (checked against `HOST_LIVE`, not copied); `t2` null or `{ date, version, result, command }` (dated, hand-entered, the only machine-unverifiable facts); `t3` one of `"none-defined"` (config-only), `"not-run"`, `"gap"`, `"rehearsed"` with a note; `deferral` null or `{ reason, openQuestion }`. Table facts (home, file, override, binaries, tier, flag) are never copied: they are read from `HOST_RUNTIMES`. |
| `test/support/host-contract.ts` | `checkHostRowContract(id, row)` returns violation codes from a closed list (D-26-03); `lifecycleContract(...)` (D-26-05) returns violations from one install/uninstall run; both are pure of node:test so seeded-defect tests can call them. |
| `test/support/host-support-matrix.ts` | `renderHostSupportMatrix()` returns the markdown table from `HOST_RUNTIMES`, `HOST_REGISTRY` and `HOST_LIVE`. |

The three are the single place a new host's facts are added; the guide (D-26-08) says so.

### D-26-02. Registry completeness (TEST-HOST-02)

`test/host/host-registry.test.ts` fails when: a `HostId` has no registry row or a row names a non-id; a row's `family` differs from `HOST_RUNTIMES[id].recipe?.kind ?? "none"`; a host with a recipe has no suite file, or its suite file (comments stripped, F2) lacks a `defineHost...Suite(` call or the id literal, or does not exist; a host with a recipe has no snippet or the snippet file does not exist; a deferred host (`recipe: null`) has a registry `deferral` and no suite; `live` is set but absent from `HOST_LIVE`, or `HOST_LIVE` names a host the registry marks `live: null`; `omp` has `family: "bundle-copy"` and its suite is `test/host/omp-recipe.test.ts` (a file of own tests, so the check there is existence plus the id literal only). The test lists every failing host at once, not the first.

### D-26-03. The static row contract (TEST-HOST-01)

`checkHostRowContract` checks, for one table row, closed-list violation codes; the real table must return none for all 19 rows, and seeded rows must return exactly their code (D-26-04). Codes and rules:

| Code | Rule |
| --- | --- |
| `not-frozen` | the entry, `homes`, each home, `aliases`, `binaries`, `conflicts`, `shadows`, `envBase` and the recipe (value, key path, arguments, nested arrays) are frozen at every level |
| `identity` | `id` is in `HOST_IDS`; `flag` equals `--` plus the id; each alias is unique across the table and is not an id; `tier` and `integration` are in their closed sets; `omp` is the only `extension`/`reference` row |
| `home-unsafe` | every home `rel` is a relative POSIX path (`.` allowed) with no `..` segment, no backslash, no drive prefix; `role` is `config`, `skills` or `mcp`; at least one `config` home |
| `env-shape` | `envOverride` and `envBase` are not both set; a name matches `[A-Z][A-Z0-9_]*`; `envBase.sub` is one safe segment; no name is one of the GSD-only names (E-G2 of 25-CONTEXT: `COPILOT_CONFIG_DIR`, `CURSOR_CONFIG_DIR`, `AUGMENT_CONFIG_DIR`, `TRAE_CONFIG_DIR`, `WINDSURF_CONFIG_DIR`, `KILO_CONFIG_DIR`, `CLINE_CONFIG_DIR`, `ANTIGRAVITY_CONFIG_DIR`) |
| `home-resolution` | with an absolute `env.home`, `resolveHomeSpecs` yields `join(home, rel)` per home when no variable is set; an absolute override moves `config` and `mcp` homes and never a `skills` home; `envBase` yields `base/sub` for `config` homes; an empty or relative value is `SCHEMA_INVALID`; no resolved path is outside the override directory or the home |
| `recipe-kind` | `recipe` is null or one of the five known kinds; `file`, `dest` and `source` are safe relative paths; key-path and `path` segments are safe key segments; `homeRole` names a role the row has |
| `launch-unsafe` | for an `mcp-config` row the registered argv (read from the recipe value; the TOML text is parsed from its own lines, as `registeredArgv` in `runtimes.test.ts` does) is the bare command `realm`, then `mcp`, `--host`, the id; no element contains a path separator, a shell metacharacter, a space or a home-relative path |
| `launch-mismatch` | that argv equals `defaultManifestFor(id, version).launch` element for element |
| `manifest` | `defaultManifestFor(id, "1.0.0")` parses, survives a JSON round trip, and an `mcp-config` manifest requests exactly the `mcp-config` ceiling, an `extension` manifest has an `entry` and no `launch` |
| `capability-grant` | for each of three policies (fail-closed with shell off and one workspace root; advisory with shell on; fail-closed with no workspace root), `resolveCapabilities(manifest.capabilities, policy)` grants a subset of the request, every denial carries a catalogue code, `exec.shell` is granted exactly when `shellEnabled`, the three `fs.*` capabilities exactly when `workspaceRoots` is not empty, `daemon.attach` and `exec.argv` always, `host.tools.restrict` only for a request under `mode` fail-closed |
| `shadow-shape` | at most four `shadows`, each a safe relative path with base `home` or `config`; a row with shadows has a recipe |
| `pending-inert` | a row with `recipe: null` has no `conflicts`, no `envBase`, no `shadows` and is reported pending by `recipePending` |

A real row that violates a code is a finding: fix the row if it is a defect (a src change with the regression test), or record the reason and narrow the rule in the checker's comment; the plan says which, it does not weaken a rule silently.

### D-26-04. Seeded defects prove the checker and the matrix can fail (TEST-HOST-01, TEST-HOST-03, TEST-HOST-04)

"Mutation spot checks" are done as seeded defects inside ordinary tests, deterministic and in CI, not as a new campaign over `src/host` (the existing campaign picks files by group and maps one test per source file; extending it is deferred). Each seeded defect names the exact violation or case it must trip, in the style of `MUTANTS` in `test/host/boot-conformance.test.ts` (an assertion on the exact failing set with the details in the message):

- the row checker: a copy of a real row with one change each (an unfrozen array, an alias equal to an id, a `..` home, both `envOverride` and `envBase`, a GSD-only variable, a launch with an absolute command, a launch whose host id differs, a capability request outside the ceiling, a shadow with an absolute path, a pending row with `conflicts`);
- the lifecycle contract: defects injected through existing seams, each a one-line change: an `audit` function that appends the planted marker to the path (secret in audit); a logger sink that writes the planted marker (secret in log); a `stageHook` that deletes a neighbor file during uninstall (unowned removal); a `stageHook` that writes a file beside the home (write outside the home); a `stageHook` that leaves a stray temp file (non-restoring uninstall);
- the conformance harness: new faults in `reference-boot-hook.ts` for C2, C3, C4, C7 and C9, one more that trips two cases, and decorators around the production driver for C3 and C4, C5 and C9 (D-26-06).

### D-26-05. The generic lifecycle contract (TEST-HOST-03)

`test/host/host-lifecycle-matrix.test.ts` runs, for every `HostId` with a recipe, on the REAL row, in a fresh fixture root (`makeFixtureHost`, `buildRig`-style rig, root asserted under the realpath of `os.tmpdir()`), one generic scenario built from the row (`recipe.kind` chooses the seed; no per-host knowledge):

1. seed: the recipe file holds a neighbor (`json-merge`: an unrelated top-level key and the planted marker as a value; `toml-table`: a comment and an unrelated table; `yaml-map`: a comment and an unrelated key; `bundle-copy`: a neighbor file beside the destination), recorded by tree hash; the marker string is unique per test (the `MARKER` of `host-recipe-suite.ts`);
2. dry run: actions listed, tree hash unchanged, no receipt, no audit directory;
3. install: `installed`; every changed path is the recipe file (or bundle destination), created directories below the resolved home, the receipt and the audit and log files under the state directory; nothing else in the whole fixture root changed (hash of the root minus the home and state subtrees is equal);
4. receipt: parses, `hostId` and `recipeKind` match the row, `configHome` equals the resolved home, every entry holds a relative path and 64-hex hashes only, the planted marker and any recipe value text is absent from the receipt bytes;
5. audit: `checkAuditFile` verifies the `host-plugins` chain, two lines per applied operation, the marker absent;
6. log: the captured log lines hold only the closed event names (`host.install.plan`, `.applied`), host id, relative paths, byte counts and hashes; the marker is absent at the lowest level;
7. status `installed`, then a second install is a `noop` with no new audit line;
8. neighbor survival: an unrelated entry added after install (appended through the same format) survives uninstall;
9. uninstall: `removed`, then the seeded tree hash is byte-equal to step 1 (including the neighbor), no receipt remains, a second uninstall is a `noop`;
10. override: when the row has `envOverride` or `envBase`, the same scenario with the variable set to an absolute directory under the root writes nothing in the default home.

For each `recipe: null` host (`windsurf`, `trae`, `zcode`): install and dry run refuse `recipe-pending` (`POLICY_DENIED`), uninstall is a `noop`, and the tree hash, receipt and audit directory are unchanged. `omp` uses a stub `adapters/omp/index.js` in the fixture's adapters directory exactly as `omp-recipe.test.ts` does (one line of stub content). The scenario is a function `lifecycleContract(row, rig)` that returns violation codes, so D-26-04's seeded defects call the same function; the matrix test asserts it returns `[]` for each real row.

### D-26-06. Conformance for all 18 drivers and seeded defects for every case (TEST-HOST-04)

- `test/host/boot-driver-conformance.test.ts` replaces the two-host constant with the 18 ids derived from the table (the `HOST_IDS` entries whose row has integration `mcp-config`), keeps the per-host `defineBootConformance` registration (162 cases) and the "all nine as data" test over the same list, and asserts the list has 18 entries and omits only `omp`.
- `reference-boot-hook.ts` gains six faults, each a one-line-class change in `buildHook`, exported as factories next to the existing four. Each is chosen from what the case asserts (read in `host-boot-conformance.ts`): `repaintsDuplicatesHook` (`show` repaints an identical text; C2 asserts one paint per distinct state), `dropsRefusedClientHook` (closes the client that came back with a refused `up` although its status names this root; C3 asserts it is kept), `retriesTerminalHook` (treats every failure as retryable, so a terminal `POLICY_DENIED` schedules a re-attach; C4 asserts none), `reattachAlwaysHook` (`enabled` is true although the manifest has re-attach off; C7), `reattachSameRootHook` (`switchWorkspace` attaches again for the root it already serves; C9 asserts no attach), and `adoptsForeignHook` (skips the root and session check on the status reply, so a reply naming another project is adopted; C9 and the unrooted case of C3 both assert it is not).
- `test/host/boot-conformance.test.ts` extends `MUTANTS` to ten rows (the existing four and these six). Each row declares the exact failing set, in the existing assertion style that prints `id: detail` for any difference. The expected sets above are the plan's reading of the cases (`adoptsForeignHook` trips C3 and C9, the others one case each, `reattachAlwaysHook` possibly more); the executor records what the harness actually reports and writes that set with a comment saying why a second case fails, and a mutant that fails no case is a harness gap to fix, not a row to drop.
- A new `test/support/host-boot-mutants.ts` holds decorators over a production driver factory: `guardOpen` (the guard returns undefined for every tool; C5), `switchNoop` (`switchWorkspace` resolves without calling the inner hook; C9), `retryNoop` (`retry` resolves without attaching; C3 and C4 both assert a retry performs one new attach). The test runs the conformance harness on each decorated `bootHookOf(HOST_RUNTIMES.claude)` and on the same decorator over `kimi-code`, and asserts the exact failing set, proving the harness would catch the same defect in the production driver, not only in the reference double.

### D-26-07. The boot matrix (TEST-HOST-05, TEST-HOST-06)

Two files, one list of 18 ids derived from the table, both transports.

**Scripted matrix** (`test/cli/stdio-host-matrix.test.ts`, no socket, injected timers and signals): the `World`, `ScriptedClient`, `start`, `finish`, `markerOf`, `reportsOf` helpers move unchanged from `stdio-host.test.ts` to `test/support/stdio-world.ts` (a move: `stdio-host.test.ts` imports them and its 14 tests are otherwise untouched). For each id and each of `mcp`, `acp`:

- M0 flag grammar over ALL 19 ids and every alias: `--host ID` is accepted exactly for the 18 canonical `mcp-config` ids; `omp`, every alias (`devin-desktop`), a differently cased id and a hostile value (control characters, 200 characters) are usage errors (exit 2, empty stdout, no daemon spawn); the diagnostics echo no control character (if the usage text echoes the value at all, the test pins what it does, and an echo of raw control characters is a finding).
- M1 readiness: the marker for the id exists and holds the six keys before the first protocol reply; stdout holds frames only; the first report is `attached` with this id and transport, the last `closed`, one boot id.
- M2 bounded retry (`--reattach`, MCP): a boot failing `DAEMON_START_TIMEOUT` exposes the tools, refuses calls with that code, arms one wait whose delay is within the manifest's equal-jitter window, forwards after the daemon comes up; with a daemon that never comes up the number of attempts stops at the retry cap (8) and no timer remains after shutdown; ACP with `--reattach` still exits 1 with no frame.
- M3 failure paths: refused `up` with a confirming status serves (MCP) or exits 1 with no frame (ACP); a status naming another session serves and refuses calls locally; a daemon that never answers exits 1 with `DAEMON_START_TIMEOUT` and an empty stdout.
- M4 teardown: EOF, SIGTERM, SIGINT and SIGHUP end the session the same way (exit 0, 143, 130, 129), the client is closed once, the marker is gone, a `closed` report is sent, and no scripted `down` request is recorded.

**Real-daemon matrix** (`test/integration/host-boot-matrix.test.ts`, a real in-process daemon over fakes, no Podman; the scaffolding of `host-boot-isolation.test.ts` is copied and narrowed into `test/support/boot-matrix-rig.ts`, the isolation test stays untouched): one fresh daemon per host id, because the daemon's `host-boot` token bucket (60 reports, one more per second) is per daemon and 18 ids with several reports each would exhaust a shared one; a per-id daemon also makes the metrics and audit assertions exact. For each id, on its own daemon and with a standing sibling host of another id (`claude`, or `codex` when the id is `claude`):

- R1 readiness: the session serves a status call and the daemon reports the project `active`; the marker exists; the daemon's metrics hold a `hostBoot` row `{ hostId, transport, phase: attached }`; the daemon log holds a `host.boot` line with that id.
- R2 bounded retry (MCP, `--reattach`): a first `connect` that fails `DAEMON_START_TIMEOUT` (an injected flaky `connect`) with injected boot timers: the tools are exposed, a call is refused with the code, then forwards after the timers advance and the real connect succeeds; two connect attempts in all, never more than one plus the retry cap.
- R3 failure isolation: for the id, a session whose `up` is hung (a `hangingUp` client) never settles while the sibling still answers a status call and the daemon answers its own `status` control request within `BOUND_MS`; a SIGTERM ends the hung session; the sibling and the sandbox are unaffected.
- R4 teardown never sends down: after each ok session's EOF the exit is 0, the marker is gone, the sandbox state is still `active` and `downCount()` equals the test's own releases; at the end the metrics `hostBoot` rows hold `attached` and `closed` for the id on both transports, and `verifyAuditFile` on `audit/host-boot.jsonl` is ok with exactly two lines whose path is `ID/mcp/attached` (the ok session and the retried one), exactly one `ID/acp/attached` and the sibling's own, every path a closed triple.
- R5 hygiene: one project of the id has a hostile directory name (newline, quote, ANSI escape, token-shaped string, as S6); none of those bytes appears in any daemon log line, report, metric, audit line or marker, and the runners' diagnostics hold no control character.

Timing: every wait is `boundedWait` (`REALM_TEST_TIMEOUT_SCALE` applies), sessions run sequentially and release their project when done (F5), each id's daemon is stopped in a `finally`; if the file measures more than 60 s it is split by transport (OQ-26-05).

### D-26-08. Author docs and the support matrix (TEST-HOST-07)

Three new pages under `docs/integration/`, all linked from the contract page, `hosts.md` and the README:

- `writing-a-host-plugin.md`, "Writing a Realm host plugin": the guide outlined in plan 26-03 (when to add a host; evidence and the ship-or-defer rule; the table row field by field; recipe choice; manifest and capabilities; the boot hook for each integration kind; the tests a contributor adds and the ones that pick the row up automatically; the snippet layout; evidence tiers T1 to T3 and what each may claim; live-rehearsal gating and isolation; the Enterprise baseline checklist; the PR checklist and CI gates; failure-to-test troubleshooting; what never to do). It uses a fictional host `acme-agent` in one fenced worked example that is plainly marked as not in the table.
- `host-support-matrix.md`: a prose header and one generated block between `<!-- host-support-matrix:begin -->` and `<!-- host-support-matrix:end -->`. Columns: id, display name, tier, integration, recipe kind or "pending (deferred)", config home with override, file, binaries, T1 suite, T2 gate and recorded result, T3 status, snippet link. The test `test/docs/host-support-matrix.test.ts` renders the block and fails with a unified difference when the file differs; `REALM_WRITE_HOST_MATRIX=1` rewrites only that block (refused when `CI` is set, and the write path is asserted to be the page itself). The page is documentation of the table, not a second source: edits go to the table or the registry.
- `host-plugin-gaps.md`: the tracked gaps page (D-26-09).

A second test, `test/docs/host-docs.test.ts`, verifies the three pages and their inbound links: every repository path named in backticks exists (`src/`, `test/`, `docs/`, `scripts/`, `adapters/`, `.github/`), no host-local path pattern, no unescaped tag-like token outside fences, each page is linked from the contract page, `hosts.md` and (guide and matrix) the README, and the guide's checklist names only test files that exist.

### D-26-09. The tracked gaps page (TEST-HOST-08)

`docs/integration/host-plugin-gaps.md` holds one table. Columns: `ID` (`GAP-PP-NN`), `Source` (the phase file and item), `Gap` (one sentence), `Class` (`unverified-behavior`, `accepted-residual`, `owner-decision`, `inference`), `Status` (`open`, `narrowed`, `closed`, `accepted`), `Evidence now` (what exists), `Next step or lift condition`. The verification test checks that ids are unique and well formed, every `Source` cites a file that exists (planning sources are skipped with a named message when `.planning/phases` has been archived), every `closed` or `narrowed` row cites a test or doc path that exists, and the number of rows citing each of the Phase 21 to 24 VERIFICATION files is at least the number of items in that file's `behavior_unverified` list. The initial rows (32) are enumerated in "The gap rows" below. Honest by construction: a row is `closed` only when an automated check or a dated run supports it; everything that needs a real host, a Podman 5.x stack or an owner decision stays `open` with its lift condition.

The coverage ratchet rides here: Phase 21 R1 recorded `src/host` at `0/0/0` in `scripts/check/coverage-floors.json` and it is still 0. After the parent runs the coverage job once, `node scripts/check/coverage.mjs --write` raises the `src/host` floor to the measured values, and GAP-21-04 becomes `closed`.

### Threat model (summary; each plan carries its STRIDE rows)

The assets are the operator's real host configuration, the state directory (receipts, audit chain, `host.log`), the secrets that live in shared host settings files, the audit and log sinks, and the published documentation. The actors are a malicious workload (inside the sandbox, plus what it writes into the workspace), hostile config content, a careless contributor, and a future maintainer who trusts a docs page.

| Asset | Attack | Hold |
| --- | --- | --- |
| Real host configuration and home | a matrix, a seeded defect or a doc test writes outside its fixture, or a rehearsal helper runs | every root is created under the realpath of `os.tmpdir()` and asserted so; the matrices import no host CLI runner and set no live gate variable; the registry imports `HOST_LIVE` for names only; the docs test writes only the one generated block and refuses when `CI` is set |
| Secrets in shared settings files (`settings.json`, `config.yaml`) | a planted secret reaches a receipt, an audit line, `host.log`, a boot report, a metric or a failure message | a unique marker in every seed, asserted absent from every sink in the lifecycle and boot matrices; assertion messages carry hashes and counts, never file text; seeded defects (audit, log) prove the assertion can fail |
| Audit chain | a matrix leaves a broken or forged chain, or the chain hides a missing line | `checkAuditFile` after every install/uninstall scenario; `verifyAuditFile` over `host-boot.jsonl` after the 36 sessions; a count of lines per session; the matrices only read chains through the production verifier |
| Boot path | one host's hung up, failure or signal takes a sibling or the sandbox down; a boot path sends `down` | R3 and R4 per id on the real daemon, exact `down` count equality, `test/host/boot-no-down.test.ts` unchanged |
| Capability catalogue | a host manifest requests more than its integration ceiling or more than the policy admits | `capability-grant` on all 19 default manifests under three policies |
| Overclaiming | a matrix result or a docs page is read as live evidence | every matrix header states "fixtures and fakes"; `t2` and `t3` cells say "not run" until a dated result exists; the gaps page keeps `open` rows; GAP-26-01 states the limit |
| Docs drift and breakage | a page disagrees with the table, names a missing file, leaks a host-local path or breaks the site build | generated block compared in CI, path existence test, `check:docs`, the CI site build; the placeholders rule (F4) |
| Test infrastructure | a new helper adds an unbounded wait, a leaked socket or a global state that makes siblings flaky | `boundedWait` everywhere, sequential sessions, release in `finally`, the daemon stopped in `after`, no module-level side effect in the new support files |
| Residual (unchanged) | a workload-planted project-level host config, a concurrent writer, a host that normalizes the entry | R-24-01, R-24-02, R-24-04, R-25-01, R-25-02 stay documented and open; none is claimed fixed |

### The gap rows (initial content of the gaps page; plan 26-03 writes them)

Class and status are the proposal; the executor keeps them unless a source says otherwise.

| ID | Source | Gap | Class / status | Evidence now | Next step or lift condition |
| --- | --- | --- | --- | --- | --- |
| GAP-21-01 | 21-VERIFICATION U1 | No host loaded a Realm plugin when Phase 21 closed | unverified-behavior / narrowed | claude (2.1.322) and codex (0.154.0) T2 ran live 2026-11-17, recorded in `docs/integration/host-plugin-contract.md`; Omp rehearsed in Phase 22 | the other 13 hosts with a recipe need their gated T2 run recorded |
| GAP-21-02 | 21-VERIFICATION U2; 22-VERIFICATION U3 | No real-host recipe existed, and no host other than Omp had one when Phase 22 closed | unverified-behavior / closed | 16 of 19 recipes (Phases 22, 24, 25), pinned in `test/host/runtimes.test.ts`; 3 deferrals by decision (`src/host/runtimes.ts`) | none |
| GAP-21-03 | 21-VERIFICATION U3 | Flags and homes come from GSD Core discovery, not from the hosts | inference / narrowed | claude, codex, opencode observed (24); wave 2 observed or documented per host (25), tagged per host in `docs/integration/host-plugin-contract.md`; kimi and kimi-code documentation only | observe a Kimi product when one exists |
| GAP-21-04 | 21-VERIFICATION R1 | `src/host` coverage floor is 0/0/0 | accepted-residual / open until the ratchet lands, then closed by TEST-HOST-08 | `scripts/check/coverage-floors.json` | parent runs `coverage.mjs --write` after the coverage job |
| GAP-21-05 | 21-VERIFICATION R4 | JSONC refused, symlinked config home refused, synchronous bounded write | accepted-residual / accepted | contract page "Residual risks" | a JSONC-aware merge is deferred (OQ-25-06) |
| GAP-22-01 | 22-VERIFICATION U1 | Duplicate-load refusal against a real `omp plugin install` link not exercised | unverified-behavior / open | fixture link only | rehearse with a real link in an isolated Omp profile |
| GAP-22-02 | 22-VERIFICATION U2 | A cold stack start was not observed | unverified-behavior / open | rehearsal ran with images present | rehearse from nothing |
| GAP-22-03 | 22-VERIFICATION U4 | Omp versions other than 18.22.0 | unverified-behavior / open | one version observed | rehearse a second version |
| GAP-22-04 | 22-VERIFICATION R2 | Presence is advisory, not health or containment | accepted-residual / accepted | contract page "Presence" | none |
| GAP-23-01 | 23-VERIFICATION U1 | No real stdio host booted Realm through `--host` | unverified-behavior / open | scripted and real-daemon matrices (this phase: all 18 ids on fakes) | live rehearsal with a real host |
| GAP-23-02 | 23-VERIFICATION U2, OQ-23-01 | Serve-after-boot can exceed a host's connect timeout on a cold first boot (up to 230 s) | unverified-behavior / open | none measured | measure a real host's timeout; serve-early is the follow-up |
| GAP-23-03 | 23-VERIFICATION U3 | Real container stack under the isolation tests | unverified-behavior / open | real daemon over fakes, no Podman (extended to 18 ids here) | Podman 5.x run |
| GAP-23-04 | 23-VERIFICATION U4 | A real Omp through the shared attach and observer after Phase 23 | unverified-behavior / open | unit tests, Phase 22 rehearsal predates it | repeat the Omp rehearsal |
| GAP-23-05 | 23-VERIFICATION U5 | Windows and other platforms | unverified-behavior / open | Linux only | out of the milestone |
| GAP-23-06 | 23-VERIFICATION U6 | Test counts and mutant outcomes rested on CI | unverified-behavior / narrowed | the mutants are now asserted in tests for every conformance case (`test/host/boot-conformance.test.ts`, TEST-HOST-04) | none |
| GAP-23-07 | 23-VERIFICATION R2 | The client of an `up` that never settles is not closed at teardown | accepted-residual / accepted | contract page "Boot integration" | none |
| GAP-23-08 | 23-VERIFICATION R3 | The status poll arms after adoption although the plan text says only with re-attach | accepted-residual / accepted | bounded; C6 and C7 pin that no timer remains after shutdown and none is armed while re-attach is off | amend the plan text or the code if the owner prefers |
| GAP-23-09 | 23-VERIFICATION R4, R5, OQ-23-02 | Reports are self-reported; a boot that never reaches a daemon leaves no daemon record; an older `realm metrics` client fails on new keys | accepted-residual / accepted | contract page "Boot integration" | none |
| GAP-24-01 | 24-VERIFICATION U1, OQ-24-02 | OpenCode never run; V1 versus V2 entry shape | unverified-behavior / open | documentation plus one recorded observation (1.19.5) | run `host-live-opencode` with a scratch binary |
| GAP-24-02 | 24-VERIFICATION U2, OQ-24-01 | Kimi CLI and Kimi Code never run (no functional release; no documented validator) | unverified-behavior / open | formats from official documentation | when a release exists |
| GAP-24-03 | 24-VERIFICATION U3 | No production-stack boot (T3) of any wave-1 host; Podman 4.9.3 is below 5.x | unverified-behavior / open | claude and codex T2 only | `REALM_LIVE_PRODUCTION=1` on a Podman 5.x machine |
| GAP-24-04 | 24-VERIFICATION U4, R-24-01, OQ-24-03 | A workload-planted project-level host config (`.mcp.json`, `.codex/config.toml`, `opencode.json`, ...) | accepted-residual / open | documented, not mitigated | a read-only or hidden overlay in the workspace mount (Phase 19 territory) |
| GAP-24-05 | 24-VERIFICATION U5, R-24-02, R-24-04 | Concurrent writers and later host versions that reformat the owned entry | accepted-residual / accepted | `concurrent-change` refusal, `drifted` and refusing uninstall | install with no host session open |
| GAP-24-06 | 24-VERIFICATION U6, R3, R4, R5 | The closer's own checks rested on CI; `launch` is advisory; `kimi` and `kimi-code` share the command name; ADPT-02 wording names a removed recipe | accepted-residual / accepted | contract page "Commands" | reword ADPT-02 in REQUIREMENTS (orchestrator) |
| GAP-25-01 | 25-CONTEXT D-25-08, contract page | No recorded T2 result for the nine wave-2 hosts | unverified-behavior / open | gated `host-live-wave2.test.ts`, qwen runs here | run with scratch binaries and record dated results |
| GAP-25-02 | 25-CONTEXT OQ-25-01..03 | `windsurf`, `trae`, `zcode` have no recipe | owner-decision / accepted | approved 2026-11-17; each refuses `recipe-pending` | the lift conditions in `deferred-hosts.md` |
| GAP-25-03 | 25-CONTEXT OQ-25-04, E-AG2 | `antigravity` is documented-only, `agy` never run | unverified-behavior / open | three Google pages agree | observe `agy` |
| GAP-25-04 | 25-CONTEXT OQ-25-06..08, E-HM2 | JSONC refused; `pi` below 1.3 silently ignores the file; `cline` CLI only; the Hermes CLI was broken on the verification machine | accepted-residual / accepted | snippets | a version probe, a JSONC-aware merge, a repaired Hermes install |
| GAP-25-05 | 25-CONTEXT OQ-25-10..12 | Three unverified inferences (Hermes `enabled`, newer host versions normalizing the entry, CodeBuddy legacy file under an override, Kilo `.json` versus `.jsonc` precedence) | inference / open | defaults in `deferred-hosts.md` | the T2 run on newer scratch installs |
| GAP-25-06 | 25-CONTEXT R-25-01, R-25-02, OQ-25-09 | Project-level shadowing by the ten wave-2 hosts; the concurrent-writer window; no T3 for config-only hosts | accepted-residual / accepted | contract page | as GAP-24-04, GAP-24-05 |
| GAP-26-01 | this phase | The matrices prove the contract on fixtures and fakes; they add no live evidence | accepted-residual / accepted | headers of the matrices and the support matrix | live rehearsals (GAP-23-01, GAP-24-03, GAP-25-01) |
| GAP-26-02 | this phase | Recorded T2 and T3 cells in the registry are hand-entered dated facts | accepted-residual / accepted | `HOST_REGISTRY` comments carry the source of each | none |

### Verification posture

Offline acceptance is `node:test` from compiled output (`npm run build`, then the named `dist/test/...` files), `npx eslint .`, `npm run check:gates`, `npm run check:docs`, `npm run check:pack` and the docs site build. Worker plans run none of these mid-flight; the parent runs them once after each wave. Everything is offline: no Podman, no host CLI, no network, no gate variable. Merge on green CI (owner decision); the parent runs the coverage ratchet once after the matrices land.
</decisions>

<canonical_refs>
## Canonical References

- `.planning/ROADMAP.md` Phase 26; `.planning/phases/21-host-plugin-contract-and-installer/21-{CONTEXT,VERIFICATION}.md`, `22-omp-plugin-on-boot/22-{CONTEXT,VERIFICATION}.md`, `23-boot-integration-for-host-plugins/23-{CONTEXT,VERIFICATION}.md`, `24-host-adapters-wave-1-claude-code-opencode-codex-kimi-cli/24-{CONTEXT,VERIFICATION}.md`, `25-host-adapters-wave-2-remaining-gsd-core-runtimes/25-CONTEXT.md` (the evidence ids E-*, decisions D-24-* and D-25-*, open questions OQ-*, residuals R-*).
- `src/host/{types,runtimes,manifest,capabilities,boot,boot-driver,boot-observer,boot-report,attach,adapter,install,recipe,receipt,host-audit,presence,env}.ts`, `src/cli/{main,stdio-host,host}.ts`.
- `test/host/{runtimes,manifest,capabilities,adapter,boot-conformance,boot-driver-conformance,boot-driver,boot-no-down,boot-report}.test.ts`, `test/cli/stdio-host.test.ts`, `test/integration/{host-boot-isolation,host-live-helpers,host-live-wave2}.test.ts`, `test/omp/boot-conformance.test.ts`.
- `test/support/{host-boot-conformance,reference-boot-hook,omp-boot-hook,host-recipe-suite,host-config-goldens,host-yaml-cases,fixture-host,fake-host-daemon,realm-daemon-fixture,stdio-host-harness,host-live,timing}.ts`.
- `docs/integration/{host-plugin-contract,hosts,mcp}.md`, `docs/hosts/snippets/*`, `README.md` ("Host integrations" paragraph near line 251), `scripts/docs/sync-site.mjs`, `scripts/check/{host-paths,agents-sync,default-mode,gate-closure,module-size,export-usage-gate,coverage,pack-smoke,mcp-smoke}.mjs`, `scripts/check/coverage-floors.json`, `.github/workflows/{ci,pages}.yml`.
- Lessons carried: static source checks must strip comments before matching; run host tests from the built output; every rehearsal uses an isolated `HOME`; no host-local path in committed docs.
</canonical_refs>

<code_context>
## Existing Code Insights

- `HOST_IDS` has 19 ids; `HOST_RUNTIMES` is a record over it; `recipePending(id)` is `recipe === null`; `bootHookOf(entry)` returns the production driver for an `mcp-config` row and null for `omp`; `parseStdioHost` accepts `--host` only for a canonical `mcp-config` id (`src/cli/main.ts` lines 93 to 130).
- `defaultManifestFor(id, version)` always parses; an `mcp-config` host launches `realm mcp --host ID` with the six-capability ceiling; Omp gets the entry and all capabilities. `resolveCapabilities(requested, policy)` is pure: grant is request AND policy.
- `createHostAdapter(entry, manifest, deps)` takes `{ stateDir, adaptersDir, logger, now, audit?, newCorrelationId?, readTimeoutMs?, reader?, stageHook?, bootHook? }`; construction touches no file; `operate` runs detection, the `conflicts` preflight and `runHostOperation`.
- Receipt entries carry `path`, `kind`, `beforeSha256`, `afterSha256`, `ownedSha256?`, creation flags, never text. The audit line carries tool, config home, byte count and hashes. `host.log` events are `host.install|uninstall.plan|applied|refused|audit_failed`.
- `test/support/host-boot-conformance.ts` exports `BOOT_CONFORMANCE_IDS`, `runBootConformance(factory, manifest)` and `defineBootConformance(label, factory, manifest)`; `reference-boot-hook.ts` exports `referenceBootHook` and four faulty factories built by `buildHook(deps, manifest, faults)`.
- `test/integration/host-boot-isolation.test.ts` is the template for the real-daemon matrix (`before` starts the fixture and an anchor session; `bootHost(argv, options)` runs `runCli` with injected streams, signals and an optional `connect`; `serveStatus`, `sandboxState`, `downCount`, `metrics`, `hangingUp`).
- `test/cli/stdio-host.test.ts` is the template for the scripted matrix (the `World`, `ScriptedClient`, `start`, `finish` helpers and `FakeTimers` from `test/support/fake-host-daemon.ts`).
- `test/support/host-live.ts` exports `HOST_LIVE`, `LIVE_HOST_IDS`, `LiveHostId`, `hostLiveSkipReason`, `isolatedHostEnv`; the 13 live ids are claude, codex, opencode, kimi, qwen, pi, hermes, cursor, kilo, copilot, augment, codebuddy, cline.
</code_context>

<specifics>
## Wave Structure

| Wave | Plan | Requirements | Depends on |
| --- | --- | --- | --- |
| 1 | 26-01 Cross-host contract matrix, registry and generic lifecycle contract, with seeded defects | TEST-HOST-01, TEST-HOST-02, TEST-HOST-03 | none (Phases 21 to 25 merged) |
| 1 | 26-02 Boot matrix: conformance for all 18 drivers, seeded defects for every case, scripted and real-daemon matrices | TEST-HOST-04, TEST-HOST-05, TEST-HOST-06 | none |
| 2 | 26-03 Author guide, support matrix, gaps page, links, coverage ratchet and the recorded run | TEST-HOST-07, TEST-HOST-08 | 26-01, 26-02 |

26-01 and 26-02 touch disjoint files and run in parallel. 26-01 owns `test/support/{host-registry,host-contract}.ts`, `test/host/{host-contract-matrix,host-registry,host-lifecycle-matrix}.test.ts`. 26-02 owns `test/support/{reference-boot-hook,host-boot-mutants,stdio-world,boot-matrix-rig}.ts` (and `host-boot-conformance.ts` only if a seeded defect shows a harness gap), `test/host/{boot-conformance,boot-driver-conformance}.test.ts`, `test/cli/{stdio-host,stdio-host-matrix}.test.ts`, `test/integration/host-boot-matrix.test.ts`. 26-03 owns `docs/integration/{writing-a-host-plugin,host-support-matrix,host-plugin-gaps}.md`, `test/support/host-support-matrix.ts`, `test/docs/*`, the link edits in `docs/integration/{host-plugin-contract,hosts}.md` and `README.md`, and (parent step only, written by `coverage.mjs --write`) `scripts/check/coverage-floors.json`; it consumes the registry from 26-01 and the test names from 26-02. No plan touches `src`, ROADMAP, STATE or REQUIREMENTS.

## Requirement IDs

| ID | Statement |
| --- | --- |
| TEST-HOST-01 | A table-driven contract checker runs every one of the 19 rows of the real runtime table through the invariants of D-26-03 (frozen rows, identity, safe homes, env shape, home resolution, recipe kind and paths, launch argv safe and equal to the default manifest, manifest, capability grants within the policy gates under three policies, shadow shape, pending rows inert) and returns no violation; seeded defective rows each return exactly their violation code. |
| TEST-HOST-02 | A registry holds one record per host (recipe family, suite files, snippet, live spec, recorded T2 and T3, deferral); a completeness test fails, listing every host at once, when a table row lacks a registry record, a suite file, a snippet or a consistent live spec, or when a registry fact contradicts the table. |
| TEST-HOST-03 | A generic lifecycle contract runs on every real recipe row (16) and the three pending rows: dry run writes nothing, install changes only the recipe file or bundle and the state directory, the receipt holds relative paths and hashes only, the audit chain verifies, the log is closed-vocabulary and redacted, reinstall is a no-op, uninstall restores the seeded bytes exactly and removes only what Realm owns, an override variable redirects everything, and a pending host refuses `recipe-pending` with nothing written; seeded defects (a secret in the audit, a secret in the log, an unowned removal, a write outside the home, a non-restoring uninstall) each fail it. |
| TEST-HOST-04 | The production boot driver passes all nine conformance cases for each of the 18 `mcp-config` hosts; the harness fails on a seeded defect in every one of the nine cases (six new reference faults and three decorators over the production driver, plus the four existing), each with its declared exact failing set. |
| TEST-HOST-05 | A scripted boot matrix over the 18 ids and both transports shows the `--host` grammar accepts exactly the 18 canonical ids (no alias, no `omp`, no hostile value), readiness before the first reply with a marker and an attached report, bounded `--reattach` retry with no timer left, the refused-up and failed-boot exits, and EOF and three signals ending the session the same way with no `down`. |
| TEST-HOST-06 | A real in-process daemon matrix (no Podman) boots every one of the 18 ids through `realm mcp` and `realm acp` against its own project: it serves status, records the `hostBoot` metric row and the `host.boot` daemon log line, retries within the cap, leaves a sibling host, the sandbox and the daemon answering while its own `up` hangs, never sends `down` (exact count), leaves a verified `host-boot` audit chain with one `attached` line per session, and leaks no hostile project-name text or planted secret into any sink. |
| TEST-HOST-07 | `docs/integration/writing-a-host-plugin.md` explains how to add a host end to end (table row, recipe choice, manifest, capabilities, boot hook, conformance and recipe suites, evidence tiers, live-rehearsal gating, Enterprise checklist, PR gates); `docs/integration/host-support-matrix.md` holds a block generated from the table, the registry and the live specs that a test compares and can rewrite; both are linked from the contract page, `hosts.md` and the README; a test checks every named repository path exists, no host-local path, no unescaped tag-like token; the docs site build and `check:docs` pass. |
| TEST-HOST-08 | `docs/integration/host-plugin-gaps.md` tracks the Phase 21 to 25 unverified and residual items as rows with id, source, class, status, evidence and lift condition (the 32 of "The gap rows", reconciled with `25-VERIFICATION.md` if present); a test verifies ids, sources, evidence paths and per-phase coverage; the `src/host` coverage floor is ratcheted to the measured values. |

## Open Questions (owner decisions or unverified; none blocks planning)

- **OQ-26-01.** Publish the conformance harness and the row checker as a package for third-party host authors? Default: no; the harness stays under `test/support` and the guide tells a contributor to add a host in this repository (the contract is not a public extension API). Owner may reverse; it needs a package boundary and a stability promise.
- **OQ-26-02.** Extend the weekly mutation campaign to `src/host` (`scripts/mutation/run.mjs` groups files into policy, redact, fs and other, maps one test per source file, caps at 12)? Default: no; the seeded defects of D-26-04 are the Phase 26 answer and run in CI. Revisit if the campaign gains per-file test lists.
- **OQ-26-03.** Is the generated matrix block written by a test (opt-in, refused in CI) acceptable, or should it be a script under `scripts/docs`? Default: the test, because the renderer reads the compiled table and registry and a `.mjs` script would need to import `dist`. Owner may prefer a script.
- **OQ-26-04.** [INFERENCE] A real row might violate one of the D-26-03 rules today (for example a `claude` entry carries `env: {}` in the value; the `launch-unsafe` rule reads only argv and is not expected to trip). The first run decides; a violation is a finding, not a silent narrowing.
- **OQ-26-05.** [INFERENCE] Running 36 real-daemon sessions in one file may exceed the integration job's time budget on a slow runner. Mitigation: sequential sessions, `REALM_TEST_TIMEOUT_SCALE`, and a split of the file by transport if the parent measures more than 60 s.
</specifics>

<deferred>
## Deferred Ideas

- A published conformance and row-check package (OQ-26-01); extending the mutation campaign to `src/host` (OQ-26-02); a generated, signed support matrix on the docs site that reads live results (needs a result store); a `realm host doctor` that runs a gated validator on the operator's machine; live rehearsals of any host (every GAP row marked open); a stdio boot smoke for hosts other than `claude` in `scripts/check/mcp-smoke.mjs`; Windows.
- Raising the other `src` coverage floors; this phase raises `src/host` only.
</deferred>

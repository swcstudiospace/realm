# Phase 48: Grok Build attribution and production tiers for Muse Code, Prime Agent and Grok Build - Context

**Gathered:** 2026-11-19, from the Phase 48 block of `.planning/ROADMAP.md`, HTIER-01 to HTIER-05 in `.planning/REQUIREMENTS.md`, `.planning/MILESTONE-CONTEXT.md` (D-v7-5), `.planning/PROJECT.md`, `AGENTS.md`, the Phase 40 records (`.planning/milestones/v6.0-phases/40-host-ids-for-muse-code-prime-agent-and-grok-build/`: `40-CONTEXT.md` D-40-06 and D-40-09 and E-40-02 to E-40-09, `40-VERIFICATION.md`, `40-03-SUMMARY.md`), the Phase 43 and 44 records as the format and live-window precedents, the row `GAP-40-01` of `docs/integration/host-plugin-gaps.md`, `docs/integration/host-plugin-contract.md`, `docs/integration/host-support-matrix.md`, `docs/integration/wave1-boot-matrix.md`, the three host pages under `docs/hosts/snippets/`, the evidence registry `test/support/host-registry.ts`, the live harness (`test/support/host-live.ts`, `host-live-session.ts`, `host-live-wave2.ts`, `host-live-muse.ts`, `production-live.ts`), and read-only probes of the three installed host CLIs in throwaway homes on 2026-11-19 (E-48-01 to E-48-05).
**Status:** Planned (four plans, nothing executed). HTIER-01 to HTIER-05 are registered in `.planning/REQUIREMENTS.md` and mapped to Phase 48; the orchestrator registers the plans in the ROADMAP and closes the requirements after verification.

<domain>
## Phase Boundary

Decisions fixed elsewhere and not reopened here: D-v7-5 (this phase exists; Linear SPE-34733), D-v7-7 (Notion skipped), D-25-08 and OQ-25-09 (a config-only host has no production tier unless it is shown to have one), D-33-01 (cold attach: `realm mcp` answers the handshake before the realm is ready), D-34-01 (capability tokens enforce by default, so every shipped launcher carries a host label), D-40-01 to D-40-13 (the three ids, their recipes and goldens, the validator tier), D-43-05 (the credential hard rule: no credential, no login, no model turn), and the Phase 43 and 44 live-window pattern (a person runs the window as the `realmlive` account under the shared live lock, serially, with before and after residue snapshots and evidence kept outside the repository).

The phase closes two things Phase 40 left open and records the result everywhere the old statement stood:

1. **GAP-40-01, the attribution half.** A Grok Build session that finds a `realm` server in the shared Claude files is attributed `claude`, not `grok-build`. Phase 40 observed by hand (E-40-09) that with a `realm` in both `~/.grok/config.toml` and `~/.claude.json` the `config.toml` entry is the one Grok lists. Nothing has shown that on the production stack with the audit line, and nothing has tried the other source combinations. HTIER-01 asks for a live demonstration, or an honest accepted-residual with the missing Grok feature named.
2. **D-40-06, no production tier.** Muse Code, Prime Agent and Grok Build were left at validator tier because no model-driven call can be made without a credential. Claude, opencode and codex got their production tier without a model-driven call (a host health check, or a session against a loopback provider that refuses every request), so the same standard is applied here: the host launches `realm mcp --host ID` cold on the production stack and the wire recorder shows the handshake, `tools/list` and the six tools. A host with no credential-free way to make that happen gets a named blocker.

What stays out: a model-driven tool call through any host's own model loop (GAP-31-02; the second half of `GAP-40-01` stays accepted-residual and moves to its own row), the legacy kimi work (Phase 47), the Omp work (Phase 45) and the stop-then-up fix (Phase 46), any change to the capability-token enforcement, the 29-code error catalogue, the six tools or the recipes' written bytes (unless the attribution decision D-48-05 selects an additional entry, see Outcome B).

The three hosts' CLIs are installed on the planning host at the Phase 40 versions (E-48-01), but the live window runs where the production stack is (the `realmlive` account). A host CLI that is absent or at another version there is a named outcome, never a pass and never a reason to stop the phase (D-48-06).
</domain>

<decisions>
## Implementation Decisions

### Evidence (each fact: source, date, tier)

Tiers: **Observed** = read in this repository, or produced by the named host's own command in a throwaway HOME with a recording stub `realm`, on 2026-11-19; **[INFERENCE]** = reasoning from observed facts, not run. Plan 48-01 Task 1 re-runs the probes and records the observed bytes before anything is edited; a contradiction is a finding, not a failure (D-48-09).

| ID | Fact | Source | Tier |
| --- | --- | --- | --- |
| E-48-01 | Muse Code 1.4.23, Prime Agent 0.10.2 and Grok Build 1.0.77 are installed on the planning host, each equal to the version Phase 40 recorded. The other hosts' CLIs are not needed here. | `muse --version`, `prime-agent --version`, `grok --version` | Observed |
| E-48-02 | Grok Build 1.0.77, a throwaway HOME with `realm` in `config.toml` (`--host grok-build`), in `~/.claude.json` (`--host claude`) and in a project `.mcp.json` (`--host claude`): `grok mcp doctor --json` lists one server `realm`, source `config`, target `realm mcp --host grok-build`; the Claude file and the `.mcp.json` show `server_count` 0 (the server of the same name is shadowed); the stub recorded exactly one start with `mcp --host grok-build`. The checks are `command found`, `server started` and `handshake` (`handshake failed` with a stub that exits: the host sends an `initialize` request, so doctor is a real handshake against the registered server). Whether doctor also sends `tools/list` is not yet observed. | `grok mcp doctor --json` with a stub `realm` first on `PATH` | Observed |
| E-48-03 | `grok inspect --json` prints `externalCompat.cells`: one per vendor and surface, among them `claude` with surfaces `skills`, `rules`, `agents`, `mcps`, `hooks` and `sessions`, each `enabled: true`, `source: default`. It also prints `projectTrusted: false` for a fresh directory and each MCP server with its source (`configToml` and a path). The key that turns the `claude` `mcps` cell off is not observed. | `grok inspect --json` | Observed (cells); the switch is [INFERENCE] |
| E-48-04 | Grok Build offers `grok plugin` (`list`, `install`, `uninstall`, `validate`, `details`, `marketplace`), the flag `--plugin-dir`, `grok mcp add` with `--scope user` or `--scope project` (`./.grok/config.toml`) and `--env KEY=value`, and the flag `--leader-socket` (a per-run leader socket; the default is `~/.grok/leader.sock`, so a Grok run may leave a leader process, which is residue the window checks). The shipped Grok page says the repository's Claude bundle `adapters/claude-plugin` is the plugin route (it is labelled `claude`, GAP-40-01). | `grok --help`, `grok mcp add --help`, `grok plugin --help`, `docs/hosts/snippets/grok-build.md` | Observed |
| E-48-05 | Muse Code accepts `--provider echo`, `meta` or `local`; Phase 40 observed that `muse exec --provider echo --trust-workspace` starts every registered MCP server and that a `required: true` server that fails aborts the run with exit 1 (E-40-03, `40-03-SUMMARY.md` step D: one server start with exactly `mcp --host muse-code`, methods `initialize`, `notifications/initialized`, `tools/list`, six tools, 26 s). The echo provider never calls a tool. Prime Agent has run modes `text`, `json`, `rpc`, `acp`, `daemon`, the flags `--offline`, `--provider`, `--model`, `--api-key`, `--no-session`, and `mcp list` and `mcp get` that print only `realm: stdio` and start nothing (E-40-06); no credential-free command that starts its MCP servers has been observed. | `muse --help`; `prime-agent --help`; the Phase 40 records | Observed; the Prime Agent drive is open |
| E-48-06 | The production harness covers five hosts today: `HostProductionId` is `claude`, `codex`, `opencode`, `kimi`, `kimi-code`; `productionOverrides` gives each its isolated configuration home; `wave2Spec` sets `productionTier: false` and `productionGap: CONFIG_ONLY_GAP` for every wave 2 host, including `prime-agent` and `grok-build`; Muse Code lives outside the live table in `host-live-muse.ts` (D-40-07). The shared scenario `runHostProduction` runs a health-check drive (`claude`, `opencode`), a session drive (`codex`, `kimi-code`) or a command drive (`kimi`) with a wire recorder as the registered `realm`, cold, from a new directory under the pinned workspace root. The production gate is the variable `REALM_LIVE_PRODUCTION` plus the host's own opt-in. | `test/support/host-live.ts`; `test/support/production-live.ts` | Observed |
| E-48-07 | The attribution of a production attach is visible in three places the harness already reads or can read: the daemon's attach audit line (`audit/SESSION.jsonl` below the shared state directory, selected by correlation id), the presence directory `hosts/ID-active`, and the count of `attached` boot reports for the host. | `test/support/production-live.ts` (`auditLinesWithCorrelation`); `test/support/host-live.ts` (`presenceEntries`, boot report counts) | Observed |
| E-48-08 | Where the old statements stand (each is edited in plan 48-04): the contract page ("no wave 2 host has a production tier" and the Phase 40 table, whose sentences say no production tier is defined), the support matrix block (generated from `HOST_RUNTIMES`, the registry and the live specs by `test/docs/host-support-matrix.test.ts`), the wave 1 boot page ("Not shown: the wave 2 hosts have no production tier"), the three host pages ("No production tier is defined for this host" and the `config-only` phrase that `test/docs/capability-token-doc.test.ts` pins), `GAP-25-07`, `GAP-34-01`, `GAP-40-01`. | the files named | Observed |
| E-48-09 | The pinning tests that move: `test/docs/host-gaps.test.ts` accepts gap phases 21 to 43 only and resolves each row's source to a planning file; `test/docs/capability-token-doc.test.ts` pins `GAP-40-01` as `accepted-residual` and `accepted` and requires `config-only` on each of the three pages; `test/docs/wave1-boot-matrix.test.ts` knows five hosts; `test/host/runtimes.test.ts` pins every host's tier; `test/host/adapters-labelled.test.ts` guards every shipped launcher; `test/integration/enforce-default.test.ts` (E1b, E1c) attaches the three ids under the default. | the files named | Observed |
| E-48-10 | The production scenario keeps HOME as the account's, because the daemon the host starts needs it (the harness comment cites an AGENTOS_STOP_FAILED measured with a profile HOME in Phase 22); every wave 1 host has a relocation variable for its own configuration home. Grok Build documents none (E-40-08: set HOME), and its writer and reader use `~/.grok/config.toml`. Muse Code relocates with XDG_CONFIG_HOME and Prime Agent with PRIME_AGENT_CODING_AGENT_DIR (both already used by the validator tier). So the Grok production scenario cannot isolate its configuration with a variable the daemon is indifferent to. | `test/support/host-live.ts` (comment above `runHostProduction`); `docs/hosts/snippets/grok-build.md`; `40-CONTEXT.md` E-40-08 | Observed |

### D-48-01. Evidence phase with test-support wiring; no product change expected (HTIER-02 to HTIER-04)

Plans 48-01 and 48-02 change test support, live test files and, only if Outcome B of D-48-05 is chosen, one shipped adapter file. No file under `src` is expected to change. The production tier is an observation of the shipped `realm mcp --host ID` path, not a new code path. A defect the window finds is recorded as a finding with the plan that would own the fix; nothing is patched in the window.

### D-48-02. What the production tier is for each host (the drives)

The standard is the one claude, opencode and codex met (D-48-03 states the cold rule). The drive is the host's own credential-free command that makes the host launch the registered server and talk to it:

| Host | Drive | Why it counts | Open point |
| --- | --- | --- | --- |
| Muse Code | a command drive: `muse exec --provider echo --trust-workspace` from the new project directory, the recipe's required entry pointing at the wire recorder | Phase 40 observed that this starts the registered server and sends `initialize`, `tools/list`; the echo provider needs no credential and never calls a tool | Muse may leave before the realm is ready (by design, as codex does); the recorder, not the exit code, decides |
| Grok Build | a health-check drive: `grok mcp doctor realm` (or `grok mcp doctor` for the one registered server), run with a per-run `--leader-socket` inside the scenario | doctor starts the server and sends `initialize` (E-48-02) | whether doctor sends `tools/list`; if it sends only `initialize`, the wire can show the handshake but not the six tools, and the outcome is recorded as the handshake only (a legal partial, named in the registry note), not stretched. Isolation (E-48-10): the host runs with HOME set to a scenario directory (its only relocation), and the wire recorder that is the registered `realm` starts the real `realm mcp` with the account's HOME restored (names and a value the recorder is given, never printed); if that cannot be made to work, the host is blocked by B-48-03 and the real `~/.grok` is never used |
| Prime Agent | to be found by plan 48-01 Task 1: candidates are `mcp` subcommands beyond `list` and `get`, a headless mode (`--mode json` or `rpc` with `--no-session --offline` and input closed), and a session against a loopback provider that refuses every request (as codex and kimi-code do) | any of them that starts the registered server, reaches `tools/list` and needs no credential | if none exists the outcome is blocker B-48-02 for HTIER-03, with the commands tried as evidence |

A drive that needs a login, an API key, a model turn, a prompt that reaches a provider other than a loopback refusing one, or a write to the operator's real host configuration is refused by the plan and recorded as B-48-02 or B-48-03.

### D-48-03. Cold and warm-up-free, new project directory, one host at a time

Same as Phase 43: no warm-up, each production attach from a new project directory under the pinned workspace root (so the host's own `realm mcp` creates the daemon and the sandbox), serial, with the production `PATH` ahead of the host binary's directory (the host spawns `realm mcp`, which runs `podman --version`, and the production Podman 5 must win over any older Podman beside the host binary). The recorder is the registered `realm` and logs method names and tool names only. The failure bound of each command is a failure bound, not a pass criterion; the pass criterion is the wire (handshake, `tools/list`, the six tool names) plus the daemon (one attached boot report for the host, the presence directory named for the host id, zero live sessions and an empty presence directory afterwards, no container, sandbox or workspace entry left).

### D-48-04. Credentials: none (hard rule, as D-43-05)

No login, no API key, no token, no model turn, no operator credential forwarded, no value printed. The preflight counts, and writes only the count of, environment variable names that look like a credential for these three hosts (names that start with XAI_, GROK_, MUSE_, PRIME_ or META_, or end with _API_KEY or _TOKEN) and removes them from the shell if the count is not zero. Evidence holds counts, versions, hashes, millisecond marks and names, never values or paths.

### D-48-05. Grok Build attribution (HTIER-01): decision procedure and three outcomes

The probe matrix (plan 48-01 Task 1) runs `grok mcp doctor --json` and `grok inspect --json` in throwaway homes with the stub `realm`, one cell per source combination, and records for each cell which `--host` label the started server carried: user `config.toml` alone; `~/.claude.json` alone; both; both plus a project `.mcp.json` in an untrusted and (where Grok offers a way to trust a directory without a login) a trusted project; `config.toml` entry disabled with `grok mcp disable`; a project-scope `./.grok/config.toml` entry beside the user entry; the Claude bundle loaded by `--plugin-dir adapters/claude-plugin` beside a `config.toml` entry; and, where `grok inspect` shows it, the Claude vendor `mcps` cell turned off. The cells are the evidence, and the outcome follows from them:

- **Outcome A, closed through the recipe's own entry.** In every cell that has the recipe's `config.toml` entry, the started server carries `--host grok-build`, and the live attach (plan 48-03) writes an audit line attributed `grok-build` with `realm` present in both `config.toml` and the Claude files. `GAP-40-01` loses its attribution half: the row says what is shown (version, date, the cells) and keeps one honest residual, the cell with no `config.toml` entry (a Grok Build user who ran only `realm host install claude`) stays attributed `claude`; it moves, with the model-loop half, to the new row `GAP-48-01` (class `accepted-residual`, status `accepted`, lift condition: a Grok Build feature that names the host in a shared file, or a per-vendor MCP switch the recipe may set).
- **Outcome B, an additional shipped entry wins where the recipe's does not.** If a cell exists in which a file the repository ships (and `realm host install grok-build` may write) would win over a Claude entry and the recipe's `config.toml` entry does not, a Grok-owned entry or bundle is added under `adapters/` with the launcher `realm mcp --host grok-build`, and the labelled-launcher guard test (`test/host/adapters-labelled.test.ts`, `OWN_ID_OF_FILE`) covers it. A new bundle must not reuse the server name in a way that makes both the Claude and the Grok bundle load a second `realm`. This outcome adds a shipped file; it is chosen only if the matrix shows a cell it fixes, and it needs the owner decision OD-48-3 if installing it would change what `realm host install grok-build` writes.
- **Outcome C, no deterministic seam.** If the winner depends on something the recipe cannot control (an undocumented, version-specific ordering the matrix shows changing between cells), `GAP-40-01` stays `accepted-residual` with the missing Grok feature named, the verified workaround (`realm host install grok-build`, and the cell in which it holds) documented, and HTIER-01 is recorded as met by the honest alternative the requirement names.

A VOID or not-reproduced live result (the window did not open, the host CLI was absent, the attach did not reach the audit line) is a legal result: HTIER-01 then rests on the probe matrix and the row stays as Outcome C or as before, and the requirement text says what was and was not shown.

The statement "the first Grok source wins by name" is an observation of 1.0.77, not a documented guarantee; whichever outcome, the page says so and names the version.

### D-48-06. Outcomes and named blockers (HTIER-02 to HTIER-04)

Every (host, tier) result is exactly one of: **passed** (dated, versioned, counted), **failed** (a run happened and an assertion failed; the registry T3 is a gap whose note starts with `rehearsal failed`, the page says failed, a gap row names the finding and the plan that would own the fix), or **blocked** with one named blocker:

| Blocker | Meaning |
| --- | --- |
| B-48-01 | the host CLI is absent or does not run as the window account (the version found, if any, is recorded) |
| B-48-02 | the host has no credential-free command that makes it start the registered server (the commands tried are the evidence) |
| B-48-03 | the host's drive needs a provider seam (a loopback provider cannot be pointed at, or a fixed key the harness cannot supply) |
| B-48-04 | the production stack is not usable on the day (Podman 5.x, the digest-pinned image, the driver or the gateway is down) |
| B-48-05 | the window did not open (nobody ran it, or the lock was not obtained) |

B-48-02 and B-48-03 are properties of the host: a host blocked by them satisfies the requirement's "or a named blocker" clause. B-48-01, B-48-04 and B-48-05 are circumstances of the day (a CLI missing for the window account, a stack down, a window not opened): a requirement blocked only by them is not met and not closed; it stays open and carried, and the documents say so. A skipped test is `not-run`, never a pass. A host whose production tier is blocked stays at the validator tier it has, and its page says so with the blocker id. A different version than the recorded one runs and is recorded with its version; it does not replace the Phase 40 observation.

### D-48-07. What "the registry tier updated" means (HTIER-02 to HTIER-05; owner decision OD-48-1)

The default follows the Phase 43 precedent for kimi-code: the evidence registry record of the host gets the dated T3 result (`rehearsed`, or `gap` with `rehearsal failed`, or `gap` or `not-run` with the blocker id), the live spec of the host gets `productionTier: true` and `productionGap: null` once a drive exists, and the generated support matrix block is regenerated. `HOST_RUNTIMES.ID.tier` stays `config-only` (kimi-code is `config-only` with a rehearsed T3), so `EXPECTED_TIERS` in `test/host/runtimes.test.ts` does not change. If the owner decides a passing production tier promotes the host to `proven`, plan 48-04 also edits the three rows of `src/host/runtimes.ts`, the tier pins, the snippet pages' `config-only` phrase and the matrix, in one change with a plain `feat(host):` subject.

### D-48-08. Documents land after Phase 47

Phases 47 and 48 both edit the host registry rows, the support matrix, `docs/integration/host-plugin-gaps.md` and `docs/integration/wave1-boot-matrix.md`. Plan 48-04 starts from a tree that contains Phase 47's documentation edits (or rebases onto them) so the generated matrix block does not conflict, and widens the gap-phase bound of `test/docs/host-gaps.test.ts` to 48 (whichever of Phases 47 and 48 lands second reconciles the bound, never narrowing it).

### D-48-09. If a probe contradicts the evidence

Plan 48-01 Task 1 records the observed bytes of every probe first. A host whose behavior differs from E-48-02 to E-48-05 (a newer version that moved a file, doctor sending no handshake, a muse that no longer starts the server under echo) changes the drive table of D-48-02 or the matrix of D-48-05 by the observed fact, as a finding. It never forces a drive.

### D-48-10. The live window (blocking-human)

One window, run by a person as the `realmlive` account from a checkout of the commit under test, under the shared live lock, serially, with a before snapshot and an after snapshot (containers, OpenShell sandboxes named `realm-`, the workspace root's entries, the account's processes that run the compiled daemon entry, the control socket, the shared state directory's `hosts` entries for the three ids, any Grok leader process and any host daemon process, the top-level entry names of the account home, and the SHA-256 of each host's real configuration file: the real Muse Code settings file, the Prime Agent settings file and the Grok `config.toml`, or the word absent). The tests never set a gate variable; the person sets them for the command. Output of every command is kept outside the repository (EVIDENCE_DIR). The owner authorization of 2026-11-18 named v6.0; OD-48-5 asks the owner to confirm it covers this window.

### D-48-11. Commit conventions: additive, no breaking marker

Nothing a client or an existing install relies on changes (the three recipes write the same bytes; a new shipped file under Outcome B is additive), so the commit subjects are plain `test(host): ...`, `docs(host): ...`, and `feat(host): ...` only for an Outcome B file. A recipe or install change that makes an existing install refresh its file would use `!` (not expected).

### Threat model (summary; each plan carries its STRIDE rows)

| Boundary | Description |
| --- | --- |
| Third-party host CLI to the network | Muse Code, Prime Agent and Grok Build may contact their vendors (updates, telemetry, login) despite no credential being present; not contained in the production tiers (the sandbox needs the network); recorded as GAP-48-02, accepted residual (as GAP-43-02) |
| Third-party host CLI to the account home | each host writes configuration, sessions, caches and a Grok leader socket and process; isolated homes and a per-run leader socket contain it, and the window compares before and after |
| Window to the production stack | the runs create a daemon, a sandbox and a state-directory entry per attach |
| Evidence to the repository | results are copied into docs and the registry; no path, value or credential name goes in |
| Attribution evidence to the claim | a label stronger than the evidence (a doctor-launched attach called a session; a cell not run called shown) |

## Canonical References

- `.planning/ROADMAP.md` (Phase 48 block), `.planning/REQUIREMENTS.md` (HTIER-01 to HTIER-05), `.planning/MILESTONE-CONTEXT.md` (D-v7-5, ordering), `AGENTS.md`
- `.planning/milestones/v6.0-phases/40-host-ids-for-muse-code-prime-agent-and-grok-build/` (`40-CONTEXT.md` D-40-06, D-40-09, E-40-02 to E-40-09; `40-VERIFICATION.md`; `40-03-SUMMARY.md`)
- `.planning/milestones/v6.0-phases/43-kimi-and-kimi-code-rehearsal/43-CONTEXT.md` and `43-02-PLAN.md` (the live-window and blocker pattern), `.planning/milestones/v6.0-phases/44-omp-non-blocking-cold-attach/` (plan format)
- `docs/integration/host-plugin-gaps.md` (GAP-25-07, GAP-34-01, GAP-40-01, GAP-43-02), `docs/integration/host-plugin-contract.md` (the Phase 40 table, the wave 2 sentence), `docs/integration/host-support-matrix.md`, `docs/integration/wave1-boot-matrix.md`, `docs/hosts/snippets/grok-build.md`, `muse-code.md`, `prime-agent.md`, `docs/integration/hosts.md` (Phase 40 note), `docs/integration/mcp.md` (Q10)
- `test/support/host-live.ts`, `host-live-session.ts`, `host-live-wave2.ts`, `host-live-muse.ts`, `production-live.ts`, `host-registry.ts`; `test/integration/host-live-wave2.test.ts`, `host-live-muse.test.ts`, `host-live-opencode.test.ts` (the production test shape), `host-live-helpers.test.ts`, `enforce-default.test.ts`; `test/host/adapters-labelled.test.ts`, `runtimes.test.ts`; `test/docs/host-gaps.test.ts`, `capability-token-doc.test.ts`, `wave1-boot-matrix.test.ts`, `host-support-matrix.test.ts`

## Wave Structure

| Wave | Plan | Type | What |
| --- | --- | --- | --- |
| 1 | 48-01 | auto | The probe record (drives and the Grok source matrix), the attribution outcome, the validator-tier cells, and the shipped launcher if Outcome B (HTIER-01, HTIER-05 part) |
| 2 | 48-02 | auto | The production-tier wiring for the three hosts in the harness and the hermetic helper tests (HTIER-02 to HTIER-04 wiring, HTIER-05 part) |
| 3 | 48-03 | HUMAN-NEEDED window | The live window: preflight, attribution attach, three production tiers, residue (HTIER-01 to HTIER-04) |
| 4 | 48-04 | auto | The registry, the matrices, the contract page, the gap rows, the host pages and the pinning tests agree with the window result (HTIER-05) |

## Requirement IDs

HTIER-01 (48-01, 48-03, 48-04), HTIER-02 (48-02, 48-03, 48-04), HTIER-03 (48-01, 48-02, 48-03, 48-04), HTIER-04 (48-02, 48-03, 48-04), HTIER-05 (48-01, 48-02, 48-04).

## Owner decisions needed (defaults taken; none blocks planning or plans 48-01 and 48-02)

- **OD-48-1.** Does a passing production tier promote a host's `HOST_RUNTIMES` tier from `config-only` to `proven`? Default taken: no (the kimi-code precedent: the registry T3 and the live spec say rehearsed and the runtime tier stays `config-only`). Owner must answer before plan 48-04 if the answer is yes.
- **OD-48-2.** May the HTIER-01 and HTIER-04 evidence for Grok Build be a host-launched attach (`grok mcp doctor`) rather than a model session? Default taken: yes, named exactly that in every document ("a doctor-launched attach, no model turn"), because a session needs a Grok login (D-48-04). If the owner wants a model session, HTIER-01 and HTIER-04 become blocked by B-48-03 until a credential policy exists.
- **OD-48-3.** Under Outcome B, may `realm host install grok-build` write more than the one `config.toml` table (for example a plugin entry or the Claude vendor switch)? Default taken: no; the recipes register the MCP server and nothing else (D-40-02). Outcome B then ships the file as documented, manual steps only.
- **OD-48-4.** If Grok has a per-vendor switch that turns the Claude `mcps` cell off, is documenting it as the workaround enough, or should it be a recipe feature? Default taken: documented workaround only, no recipe change.
- **OD-48-5.** Does the owner authorization of 2026-11-18 (live windows and scratch installs, scoped to v6.0) extend to this v7.0 window, and who runs it and when? Default taken: yes; plan 48-03 Task 2 asks for the date, the person and the lock mechanism, and records B-48-05 if no window opens.

## Open Questions (unverified; none blocks)

- **OQ-48-1.** Does `grok mcp doctor` send `tools/list`? If not, is the Grok wire evidence the handshake alone, or is there a second credential-free Grok command that lists tools? (Plan 48-01 Task 1.)
- **OQ-48-2.** Does a Muse Code cold run under the real realm stay alive long enough for the recorder to see `tools/list` (Phase 40 saw it in 26 s with a stub that answered at once)? A host that leaves first is judged from the wire, as codex is.
- **OQ-48-3.** Does a Prime Agent command exist that starts its MCP servers without a credential? (Plan 48-01 Task 1; B-48-02 if not.)
- **OQ-48-4.** Does Grok write a leader process or socket that survives a doctor run in an isolated home? The window checks it either way.
</decisions>

<specifics>
## Deferred Ideas

- A model-driven tool call through any of the three hosts (a scripted provider seam in each): GAP-31-02, and the residual half of the old `GAP-40-01`, carried by the new row `GAP-48-01` (plan 48-04).
- Measuring the three CLIs' own network use: recorded as `GAP-48-02`, not measured here.
- A second version of any host (GAP-31-03).
- A Muse Code plugin bundle or Prime Agent skill package as Realm shipments (they change user configuration beyond the MCP server).
</specifics>

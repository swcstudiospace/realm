---
phase: 48-grok-attribution-and-production-tiers
plan: "01"
subsystem: host-live-validator
tags: [grok-build, muse-code, prime-agent, attribution, GAP-40-01, HTIER-01, HTIER-03, HTIER-05]
requires: []
provides:
  - "The Grok Build source matrix, observed on 1.0.77 (cells a to i and four extra cells, each run twice)"
  - "Attribution outcome A of CONTEXT D-48-05, with its deciding cells"
  - "The drive of Muse Code (a command drive) and blocker B-48-02 for Prime Agent"
  - "A gated validator step that keeps the matrix: the Grok Build scenario of the wave 2 live table"
affects: [48-02, 48-03, 48-04]
key-files:
  modified:
    - test/support/host-live-wave2.ts
    - test/integration/host-live-wave2.test.ts
    - test/integration/host-live-helpers.test.ts
  created: []
duration: one session
completed: 2026-11-19
---

# Phase 48 Plan 01: Grok source matrix, drive probes and attribution outcome

Result: Outcome A (the recipe's own `config.toml` entry closes the attribution half of GAP-40-01 on Grok Build 1.0.77, with one honest residual). Muse Code has a credential-free command drive. Prime Agent has none (B-48-02). `grok mcp doctor` sends `tools/list`. The matrix is kept as a gated validator step that passed once on the installed Grok Build. No file under `src` or `adapters` changed.

Evidence is kept in EVIDENCE_DIR (a directory outside the repository, mode 0700): per-cell doctor JSON, inspect JSON, the stub log and the exit code and elapsed time of every command, the Muse and Prime Agent run records, and the TAP output of the gated run. The summary below carries counts, names, versions and milliseconds only.

## Facts of the day

| Fact | Value |
| --- | --- |
| Date | 2026-11-19 |
| Grok Build | 1.0.77, equal to the recorded version |
| Prime Agent | 0.10.2, equal to the recorded version |
| Muse Code | 1.4.24, the recorded version is 1.4.23 (see Findings F-4 and Deviations) |
| Probe environment | every probe ran under an empty environment (`env -i`) with its own throwaway HOME and the host's relocation variable (XDG_CONFIG_HOME for Muse Code, PRIME_AGENT_CODING_AGENT_DIR for Prime Agent); the invoking shell held 10 variable names that match the credential patterns (count only, none was passed to any probe) |
| Stub realm | a speaking stub (answers `initialize` and `tools/list` with the six tool names; logs argv, method names and tool names only) first on PATH |
| Recipes | installed by the built `realm host install` (the real tables), never hand-written (the only hand-written files are the project `.mcp.json` of cells d and e and the `[compat.claude]` lines of the switch cells) |

## 1. Grok Build source matrix (Grok Build 1.0.77)

Every cell ran twice in a new throwaway HOME and a new project directory, with `grok mcp doctor --json` and `grok inspect --json` and a per-run `--leader-socket`. Both runs of every cell gave the same label, source and start count (no cell is not-reproducible).

| Cell | Files in the HOME or project | Label that won | Source Grok printed | Server starts (stub) | Second realm server |
| --- | --- | --- | --- | --- | --- |
| a | `config.toml` alone (real recipe) | grok-build | config | 1 | no |
| b | the Claude file alone (real `realm host install claude`) | claude | the Claude file | 1 | no |
| c | a and b | grok-build | config (the Claude file shows `server_count` 0: shadowed) | 1 | no |
| d | c plus a project `.mcp.json` labelled claude, project untrusted (`projectTrusted` false) | grok-build | config (the Claude file and `.mcp.json` show `server_count` 0) | 1 | no |
| e | d with the folder-trust gate off (see Findings F-3: there is no per-directory trust command without a login) | grok-build | config | 1 | no |
| f | c after `grok mcp disable realm` | none | none | 0 | no (excluded from the rule: the entry is disabled) |
| g | c plus a project-scope `./.grok/config.toml` table `--host grok-build` (`grok mcp add --scope project`), project untrusted | grok-build (the target Grok lists) | config | 0: the check is `folder untrusted`, doctor exits 1, the user table is shadowed by the same-name project table | no |
| g, trusted (extra) | g with the folder-trust gate off | grok-build | config | 1 | no |
| h | a plus the Claude bundle `adapters/claude-plugin` installed for the HOME (`grok plugin install` of the local directory with `--trust`; `--plugin-dir` exists only on `grok agent`, which needs a session, so it cannot be used with doctor) | grok-build | config (the plugin provides one `mcpServers` entry named realm, shadowed) | 1 | no |
| h0 (extra) | the Claude bundle alone, no `config.toml` entry | claude | plugin: realm | 1 | no |
| i | c with `[compat.claude]` `mcps = false` in `config.toml` | grok-build | config | 1 | no |
| i, env (extra) | c with the environment variable `GROK_CLAUDE_MCPS_ENABLED` false | grok-build | config | 1 | no |
| b, switch off (extra) | b with `[compat.claude]` `mcps = false` | claude | the Claude file | 1 | no |

Cells not found or not available: none is unrun. Cell e is run with the global folder-trust gate off, not with a trusted directory (Findings F-3).

## 2. The doctor observation (OQ-48-1)

`grok mcp doctor` with a speaking stub: the stub saw `initialize`, `notifications/initialized`, `tools/list`, and returned six tool names. Doctor printed the checks `command found`, `server started`, `handshake OK` and `6 tools discovered`. Answer: yes, doctor sends `tools/list`. Plan 48-03 can therefore show the handshake and the six tools on the wire for Grok Build, not the handshake alone. `grok mcp doctor` with no name and with the name `realm` both start the one registered server (the listed server is the same). Elapsed: 0.5 s to 23 s per cell on this host (about 70 percent steal, so the elapsed times are noisy).

## 3. The drive table

| Host | Drive for the production tier | Wire the stub saw | Waits for the server? | Blocker |
| --- | --- | --- | --- | --- |
| Muse Code | command drive: `muse exec --provider echo --trust-workspace` with the prompt of the validator tier, from a new project directory, with the recipe's required entry | one start, argv exactly `mcp --host muse-code`, `initialize`, `notifications/initialized`, `tools/list`, six tools; exit 0 in 4.9 s with a stub that answers at once | yes: with a stub that delayed its `initialize` answer by 8 s Muse waited, then sent `notifications/initialized` at 8.1 s and `tools/list` at 8.2 s, and exited 0 in 13.6 s | none (the run is on 1.4.24, see Deviations; B-48-01 for the version difference only) |
| Grok Build | health-check drive: `grok mcp doctor` (with a per-run `--leader-socket`) | one start, argv exactly `mcp --host grok-build`, handshake, `tools/list`, six tools | n/a (doctor connects and waits for the handshake) | none |
| Prime Agent | none | the stub was never started by any command tried | n/a | B-48-02 |

Prime Agent commands tried (OQ-48-3), in the plan's order, each with the stub realm registered by the real recipe, each with stdin closed. None logged an `initialize`:

1. `prime-agent mcp list`: exit 0, prints `realm: stdio`, starts nothing. The `mcp` subcommands are only add, list, get and remove; there is no test, doctor, ping, start or connect verb (`prime-agent mcp --help`).
2. `prime-agent --mode json --no-session --offline`, and `prime-agent -p --no-session --offline`, and `--mode rpc` with the same flags: exit 1 in under 1 s, "No authenticated models available".
3. `prime-agent --mode acp --no-session --offline`: exit 0 after 33 s with stdin closed, no start. It left a Prime Agent daemon running (see Residue).
4. A loopback refusing provider (custom provider in `models.json` of the agent directory, a fixed non-secret key literal): `prime-agent -p --no-session --offline --provider refusing --model m ready`: exit 1 in 8.7 s; the provider recorded one `POST` to the chat completions path (with the fixed key, from the loopback peer, answered 503); the stub was never started. The same provider with `--mode rpc` and `--mode acp` (closed at once): exit 0, no request, no start.
5. Also `prime-agent status` and `prime-agent doctor`: "No background services found", no start.

Why none can work (from the host's own documentation, 0.9.8 release docs; the 0.10.2 release ships no docs directory): an MCP connection "is initialized and its tools discovered on first use" through the Python `mcp` module of the model's REPL tool, and the shell commands "exit without starting an agent". A start therefore needs a model tool call. That is B-48-02 (a property of the host: no credential-free command starts the registered server) and satisfies the "or a named blocker" clause of HTIER-03. The run also downloads a Python runtime into the HOME on first use (the host's own network use, not contained: GAP-48-02).

## 4. The outcome of CONTEXT D-48-05: Outcome A

Rule applied to the cells with the recipe's `config.toml` entry (a, c, d, e, g, h and i; f excluded):

- In every one of them the server named realm carries `--host grok-build` (the target Grok lists and, wherever a server started, the argv the stub recorded). No cell shows a second realm server. Both runs of every cell agree.
- Cell g (untrusted project scope) starts no server at all (`folder untrusted`), which is a trust gate, not a Claude winner; with the gate off (g, trusted) it starts with grok-build.
- Outcome B does not apply: no cell has a Claude entry winning while a file the repository could ship for Grok Build would win. In cell h0 (no recipe entry) a Grok-labelled plugin would win, but the recipe's `config.toml` entry already wins in that combination (cell h), and shipping a second Grok entry would only add a second place for the same table.
- Outcome C does not apply: the order is the documented one in the host's own user guide (the compatibility table says all sources are merged in the priority order `config.toml`, then Claude, then Cursor, then `.mcp.json`) and was observed in every cell and run.

The Claude-only cell (b) is attributed claude: this is the residual of D-48-05 (a Grok Build user who ran only `realm host install claude`), recorded as the residual, not a failure. The residual also covers h0 (the Claude bundle alone is attributed claude). Per the statement of D-48-05, "the first Grok source wins by name" is an observation of version 1.0.77 and the documented order of that version, not a guarantee for later versions; the gated validator step below fails on a version that changes it.

Outcome A needs the live half (plan 48-03: the production attach with the audit line) before GAP-40-01 loses its attribution half; this plan shows only the cells.

## 5. Findings and answers to the open questions

- F-1 (documented order, contradicts the wording of D-48-05). The Grok user guide documents the MCP source priority (config, then Claude, then Cursor, then `.mcp.json`) and the Claude switch, so the order is a documented behavior of the version, not only an observation. The page keeps the version caveat.
- F-2 (the Claude `mcps` switch does not stop the Claude file being loaded). OQ-48-4 and E-48-03: the switch is `[compat.claude]` `mcps = false` in `config.toml`, or the environment variable `GROK_CLAUDE_MCPS_ENABLED`. `grok inspect --json` then prints the `claude` `mcps` cell as `enabled: false`, source `config` (or `env`). But with the Claude file alone and the switch off (cell b, switch off), Grok 1.0.77 still listed the Claude file's realm server (source the Claude file) and started it with `--host claude`, in both runs. So the switch is not a working workaround on 1.0.77 for doctor or inspect. The plan does not ship it (OD-48-4); plan 48-04 must not document it as a workaround.
- F-3 (trust). `grok mcp doctor` and `grok inspect` take no trust flag; `--trust` is documented for a session or a headless agent run only, and the trust store is a file in the Grok home written by a session. In the probes `projectTrusted` was true in directories with no project configuration and false where a project `.mcp.json` or `.grok/config.toml` existed (cells d and g). Cell e and the trusted cell g used the documented global switch `GROK_FOLDER_TRUST=0`, which is not the same as trusting one directory; the cells say so.
- F-4 (Muse Code runs 1.4.24, not 1.4.23). The drive behaves as in Phase 40 (E-48-05 holds): one start, exactly `mcp --host muse-code`, `initialize`, `tools/list`, six tools. The version difference is recorded, not hidden (D-48-06: a different version runs and is recorded).
- F-5 (E-48-02 holds). With a stub that speaks, doctor lists one server `realm`, source `config`, target `realm mcp --host grok-build`; the Claude file shows `server_count` 0 (shadowed). New: doctor does send `tools/list` (OQ-48-1).
- F-6 (OQ-48-4: leader residue). After doctor and inspect runs with a per-run `--leader-socket`, `grok leader list` printed "No background service processes found" and no Grok process remained. The Grok binary copied itself into the throwaway HOME (its own `bin` directory) on first run; nothing was written to the real Grok home. The window still checks, as planned.
- F-7 (Prime Agent daemon residue, new). A Prime Agent run in acp mode started a daemon process whose socket directory is under the system temporary directory, outside the throwaway HOME (the directory is named for the user id). It survived the run and was removed by hand: the production window must snapshot and clean it for Prime Agent. Worker sockets stayed in that directory and were removed too.
- F-8 (answers). OQ-48-1: yes. OQ-48-2 (Muse waiting): a stub that answers `initialize` after 8 s still reaches `tools/list`; the real cold attach is longer (Phase 40 measured 26 s), which this plan did not model; the wire decides in the window. OQ-48-3: no command, B-48-02. OQ-48-4: the switch exists but does not work (F-2); a leader does not survive doctor.

## 6. The residue of the probes

- Processes: every Grok, Muse, stub and provider process was gone after its probe. One Prime Agent daemon (F-7) was found and stopped; nothing of the three hosts remains.
- Real configuration files: the real Grok `config.toml`, the real Claude file, the real Prime Agent settings file and the real Muse settings file all have modification times that predate the probes (and the SHA-256 of the two Grok-relevant files taken before and after the gated run are equal). A before-and-after hash was not taken around the first probes (see Deviations), so for those probes the evidence is the unchanged modification times.
- Every throwaway HOME, project directory and the Prime Agent socket directory was removed.

## 7. What changed in the repository

| File | Change |
| --- | --- |
| `test/support/host-live-wave2.ts` | new types `Wave2SourceCell` and `Wave2SourceMatrix`; the optional field `sourceMatrix` of `Wave2Script`; the Grok Build entry carries the two cells and the restore steps; `realFiles` of Grok Build also hashes the real Claude file; the pure helper `doctorRealmLabel(text)` (the label of the server named realm: the label, or `none`, `several`, or `unlabelled` when the target names no host) |
| `test/integration/host-live-wave2.test.ts` | new step C2: for each cell, runs the `realm host` words in the isolated HOME, runs `grok mcp doctor --json` with a leader socket inside the rig, asserts the helper's label and the stub's recorded arguments, then restores the HOME before step D; the diagnostic names the cell, the version and the label |
| `test/integration/host-live-helpers.test.ts` | hermetic rows for `doctorRealmLabel` (grok-build label, claude label, no realm server, two realm servers, bare launcher, no target, text that is not JSON, empty text, arrays, wrong shapes) and a pin of the Grok Build matrix shape (cells, restore, leader socket inside the rig, real Claude file hashed, only Grok Build has the matrix) |

Not changed: nothing under `src`, nothing under `adapters` (no `adapters/grok-build/mcp.json`: Outcome A), `test/host/adapters-labelled.test.ts` untouched, no recipe byte, no document other than this summary, no ROADMAP, STATE or REQUIREMENTS edit.

## 8. Checks run

| Check | Result |
| --- | --- |
| `npm run build` (tsc) | passed |
| `node --test` on `host-live-helpers`, `host-live-wave2`, `adapters-labelled` and `grok-build-recipe` (compiled) | 109 tests, 98 passed, 11 skipped (the eleven wave 2 live scenarios, no opt-in), 0 failed; run as root with no host needed by the hermetic rows |
| Gated run `REALM_LIVE_GROK_BUILD=1 node --test dist/test/integration/host-live-wave2.test.js` on Grok Build 1.0.77 | passed (1 passed, 10 skipped); diagnostics: cell "both files" carried grok-build, cell "the Claude file alone" carried claude, the stub started once per cell; the operator's real Grok `config.toml` and Claude file byte-equal before and after |
| `eslint` on the three changed files | no issues |
| `npm run check:gates` (gate-closure, module-size, export-usage, lockfile) | passed |
| `node scripts/check/host-paths.mjs` and `agents-sync` | ok |

Not run: the tests as a non-root user and under `env -i` (the hermetic rows read no host and no gate variable and the new rows build only a rig under the temporary directory); the full test suite.

## HTIER statements

- HTIER-01: the matrix shows, for Grok Build 1.0.77, that the recipe's `config.toml` entry makes the started server carry grok-build in every combination that holds it (Outcome A), with the Claude-file-alone residual attributed claude; the gated validator step keeps the two decisive cells (both files, Claude file alone) so a later Grok Build that changes the precedence fails a gated rerun. Not shown here: the production attach with the audit line (plan 48-03). A residual row with the missing Grok feature (a per-vendor switch that works, or a host name in a shared file) remains for plan 48-04.
- HTIER-03: Prime Agent has no credential-free drive: B-48-02, with the commands above as the evidence. Muse Code has a drive.
- HTIER-05: no launcher was added, so the labelled-launcher guard needed no entry (the guard test passes unedited).

## Deviations from the plan

1. Muse Code ran at 1.4.24 (recorded 1.4.23). Task 1 step 1 says to record B-48-01 for a host at another version and skip its probes; D-48-06 says a different version runs and is recorded. I ran the probes (read-only, throwaway HOME) and recorded both the version difference (B-48-01 for the version, a circumstance of the day) and the observed wire, because the observation only adds information and plan 48-02 needs the drive.
2. Cell h used `grok plugin install` of the local plugin directory with `--trust` in the throwaway HOME, because `--plugin-dir` is offered only on `grok agent` (which needs a model session), not on `grok mcp doctor` or `grok inspect`.
3. Cell e and the trusted cell g used `GROK_FOLDER_TRUST=0` (documented, global), because no per-directory trust command exists without a login (F-3).
4. Extra cells beyond the plan (h0, b with the switch off, i with the environment variable, g trusted) were run to answer OQ-48-4 and to bound the residual; they do not decide the outcome.
5. In the gated step the doctor command also carries `--json` and `--leader-socket` inside the rig (the plan names the doctor run; the flags make the label readable and keep a leader inside the rig). The helper reports `unlabelled` in one case the plan did not name (a realm target with no host); the other values are the plan's.
6. The cells run before step D and the HOME is restored (reinstall of the Grok entry, uninstall of the Claude file) so steps D and E are unchanged; `installedHash` is recomputed after the restore.
7. A first draft of the project-scope cell g passed the leader socket after `--`, which made it part of the server command; the cell was rerun correctly for both runs and the wrong one was discarded.
8. The before hash of the real configuration files was not captured before the first probes; the modification times (all older than the probes) are the evidence for those probes. The gated run has a before and after hash.

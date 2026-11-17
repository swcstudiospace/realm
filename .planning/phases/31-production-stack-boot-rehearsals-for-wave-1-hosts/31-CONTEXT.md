# Phase 31: Production-stack boot rehearsals for wave 1 hosts - Context

**Gathered:** 2026-11-17, from the Phase 27 to 31 blocks of `.planning/ROADMAP.md`, the v4.0 section of `.planning/REQUIREMENTS.md` (BOOTP-01, BOOTP-02), `test/support/host-live.ts`, `test/support/production-live.ts`, the four gated wave 1 files `test/integration/host-live-{claude,codex,opencode,kimi}.test.ts`, `test/integration/host-live-helpers.test.ts`, `test/support/host-registry.ts`, `docs/integration/{host-plugin-gaps,host-support-matrix,host-plugin-contract,openshell}.md`, the live-window records of Phases 14, 17, 18 and 22 (`.planning/milestones/v3.0-phases/`), `.planning/STATE.md`, and a research pass on 2026-11-17 that ran the installed `claude` 2.1.322 and `codex` 0.154.0 against throwaway stub servers in isolated homes (nothing in a real host configuration, no Podman, no network model call) and read the vendor documentation named under Evidence.
**Status:** Planned (two plans, nothing executed). BOOTP-01 and BOOTP-02 are registered in `.planning/REQUIREMENTS.md` and mapped to Phase 31 as Planned; the orchestrator closes them after verification. `.planning/ROADMAP.md` still shows Phase 31 with `Plans: 0 plans`; the orchestrator updates it.

<domain>
## Phase Boundary

Milestone v4.0 decisions fixed by the owner on 2026-11-17 and not reopened here: the Anda bridge is removed as a breaking change with no shim (Phase 28); MCP over stdio stays the transport for agent hosts; Realm is local and single-user only; the release line is 0.4.x. This phase depends on Phase 28: the commit under test is a build that no longer has the Anda bridge, so the production stack the hosts boot is the stack v4.0 ships.

Phases 21 to 26 built the host plugin contract, 19 recipes, and a three-tier evidence model. T1 (offline fixture) and T2 (the host's own validator in an isolated home with a stub `realm`) have run. **T3 (a real host booting Realm against the production stack) has never run for any wave 1 host.** `docs/integration/host-plugin-gaps.md` says so in GAP-23-01 (no real stdio host booted Realm through `--host`), GAP-24-03 (no T3 of any wave 1 host; Podman 4.9.3 is below 5.x) and GAP-24-01 / GAP-24-02 (OpenCode and Kimi were never run). This phase closes what can be closed and names the rest.

Deliverables:

1. **BOOTP-01: boot rehearsals, with results recorded.** For each wave 1 host that can run on this machine, the host is booted through its own CLI against the production stack (the `realmlive` account's rootless Podman 5.7.1 stack, one human-opened window), Realm's tools are listed through the host, and the result, with its version and date, goes into the registry, the support matrix, a new wave 1 boot matrix page and the gaps page. The hosts that can run here are **claude** (its production tier already exists and has never been run) and **codex** (the tier is a named gap today; this phase finds a way to run it without model credentials, D-31-02).
2. **BOOTP-02: named gaps for the rest.** A host that cannot be booted gets a named row in `docs/integration/host-plugin-gaps.md` stating why (missing CLI, no credentials, archived) and what would lift it: **opencode** (no executable here; the tier exists), **kimi** (the legacy Python CLI is archived), and **kimi-code** (functional, not installed, no validator command documented). The rows are written for the real situation of 2026-11-17, not copied from the Phase 24 wording (the Kimi row is stale in part, E-31-9).
3. **A wave 1 boot matrix**, `docs/integration/wave1-boot-matrix.md`: one row per wave 1 host with its disposition (rehearsed, failed, named gap), what was driven, what was observed on the wire and in the daemon, the version and date, and the residue result; a test ties it to the registry.

Out of scope, stated so no task drifts into it:

- **No product code change.** Nothing under `src/`, no recipe change, no new error code, no policy key. A defect the rehearsal finds is recorded as a finding and a gap row and goes to a new plan; it is never patched inside a live window (the Phase 18 stop rule). The one exception is test support code under `test/support/` and the gated integration files, which this phase writes.
- No registration of Realm in any real host configuration. Every host run uses an isolated configuration home; the operator's real `.claude.json`, `.codex/config.toml` and `opencode.json` are hashed before and after and must not change (as the existing tiers do).
- No model credential, no login, no paid or remote model call. The Codex session talks to a loopback provider that refuses every request, and no prompt reaches a model.
- No tool call through a host. BOOTP-01 says "listed or called"; listing is what a refusing provider allows and what the evidence shows. A scripted provider that makes a host call a Realm tool is a deferred idea (D-31-07).
- No cold-stack start (GAP-22-02, GAP-23-02 stay open; the window measures a warm boot and says so).
- No second live run of the 17-scenario production suite; this phase runs only the host production tests named below.
- No Kimi Code, OpenCode or other host install on the owner's machine without the owner's decision (OQ-31-01); the default is a named gap.
- No change to Windows or macOS claims: Linux only (GAP-23-05).
</domain>

<decisions>
## Implementation Decisions

### Evidence (every fact below: source, read or observed date 2026-11-17, tier)

**E-31-1. Machine and account.** `claude` 2.1.322 and `codex-cli` 0.154.0 are installed and on the default path. `opencode` and `kimi` are not (the executable lookup finds neither). Podman for the root account is 4.9.3, below the 5.x gate (`podmanSkipReason`), so every production run goes through the `realmlive` account, whose rootless Podman is 5.7.1 with the runc runtime, whose gateway and compute-driver user units are the production stack, and whose 5.x binary needs the account's `PATH` (`.planning/STATE.md`, Phase 9.1 and 9.6 records). Tier: observed (this machine) and recorded (the STATE entries).

**E-31-2. The claude production tier exists and was never run.** `test/integration/host-live-claude.test.ts`, test "claude production: ...", gated by `collectHostLiveGate("claude", "production", ...)`: opt-in `REALM_LIVE_CLAUDE=1`, Linux, the executable, a parsed version, the built CLI, then `productionSkipReason` (`REALM_LIVE_PRODUCTION=1`, Podman 5.x, `REALM_LIVE_IMAGE`, `REALM_LIVE_DRIVER_CONFIG`, `REALM_DRIVER_SOCKET`, the rootless Podman socket, the `openshell` CLI) and no Realm receipt for claude in the shared state directory. The body is `runHostProduction` (`test/support/host-live.ts`): scenario environment with an isolated `CLAUDE_CONFIG_DIR` and the account's `HOME`; a shim `realm` first on `PATH`; `realm host install claude --dry-run` then install, status `installed`, launch `on-path`; `claude mcp list` from a directory under the pinned workspace root must exit 0 and print the realm line with `connected` and no `failed`; `realm status` must reach `active` for that project; `realm metrics` must count at least one `attached` boot report for `claude`; after the host command ends, the live-session count is 0 and the presence directory is empty; `realm down`, no residue, no container of the sandbox; uninstall `removed`; the real `.claude.json` is byte-equal. Tier: read in the repository.

**E-31-3. What `claude mcp list` does on the wire (observed).** Claude Code 2.1.322, isolated `CLAUDE_CONFIG_DIR`, entry added with `claude mcp add realm -s user`, a stub stdio server: `claude mcp list` printed `Connected`; the stub received `server/discover`, `initialize`, `notifications/initialized` and `tools/list`, in that order. It forwarded the whole environment it was given (a planted variable reached the server). So the health check lists tools on the wire; a client-side recorder can show it (D-31-03). Tier: observed, one version, a stub server rather than Realm.

**E-31-4. Codex starts MCP servers at session start, before any model reply, and needs no credential for that (observed).** codex-cli 0.154.0, isolated `CODEX_HOME`, one `[mcp_servers.realm]` table written by hand, no login. `codex exec --json --skip-git-repo-check` with `-c model_provider="rehearsal"`, `-c model_providers.rehearsal={name="Realm rehearsal",base_url="http://127.0.0.1:PORT/v1",wire_api="responses",request_max_retries=0,stream_max_retries=0}` and `-c model="rehearsal-model"`, where nothing answers on PORT: the stub MCP server was launched within one second; it received `initialize`, `notifications/initialized` and `tools/list`; then Codex printed `Reconnecting... waiting for network` in a loop and never exited by itself (the run was killed after 12 s, and the stub saw EOF). The `-c` overrides left `config.toml` byte-identical. The MCP child's working directory was the directory Codex was started in. Tier: observed on one version with a stub server rather than Realm.

**E-31-5. Codex forwards only `HOME`, `LANG` and `PATH` to a stdio MCP server by default (observed).** With `XDG_RUNTIME_DIR`, `XDG_CONFIG_HOME`, `REALM_DRIVER_SOCKET` and a planted `SECRET_TOKEN` set in Codex's own environment, the stub saw only `HOME`, `LANG` and `PATH`. Adding `-c 'mcp_servers.realm.env_vars=["XDG_RUNTIME_DIR","XDG_CONFIG_HOME","REALM_DRIVER_SOCKET"]'` forwarded exactly those three names (and still not `SECRET_TOKEN`) and merged into the table the recipe wrote; the file stayed unchanged. The Codex configuration reference documents `mcp_servers.ID.env_vars` as "Additional environment variables to whitelist for an MCP stdio server" and `mcp_servers.ID.env` as "Environment variables forwarded to the MCP stdio server" (https://learn.chatgpt.com/docs/config-file/config-reference, read 2026-11-17; the older address https://developers.openai.com/codex/config-reference redirects there). Consequence for Realm: `realm mcp` resolves its config from `XDG_CONFIG_HOME` or `HOME` and the daemon it starts needs `XDG_RUNTIME_DIR` for the rootless Podman socket (`src/runtime/host-paths.ts`, `src/runtime/podman-probe.ts`) and `REALM_DRIVER_SOCKET` for the driver probe (`src/daemon/spawn-env.ts`). A Codex session whose environment lacks those names after the filter cannot reach the production stack unless the user adds `env_vars`. That consequence is an [INFERENCE] until the window exercises it; the recipe writes no `env_vars` today. Tier: observed (forwarding), inferred (the Realm consequence).

**E-31-6. The other non-interactive Codex surfaces do not start the server, or are the wrong direction.**
- `codex mcp list|get`: print configuration only; never start servers (Phase 24 observation, `host-live-codex.test.ts` header).
- `codex doctor` (new in this version): ran with a stub server in the config; the server was never launched (observed 2026-11-17). It reports installation, configuration, authentication and runtime health.
- `codex mcp-server` (Codex as an MCP server for another client): not in the `codex --help` command list of 0.154.0; reported deprecated in August 2026 and removed in September 2026, replaced by `codex app-server` (search result summaries of 2026-11-17 citing the Codex changelog and the 0.154.0 release notes, https://github.com/openai/codex/releases/tag/rust-v0.154.0; the removal claim itself was not read from a primary page, so only the absence from `--help` is treated as observed). It is the wrong direction in any case: Realm needs the host to be the MCP client.
- `codex app-server`, `codex exec-server`: experimental servers with their own protocols; starting one would test Codex's server, not Codex launching Realm.
- `codex exec` with a refusing loopback provider: the only surface observed to launch the registered server and send `tools/list` without credentials (E-31-4).

**E-31-7. Codex provider configuration (documented, plus observed).** `model_provider` and `model_providers` are read from the user configuration; Codex ignores them in a project `.codex/config.toml` (configuration reference, same URL; also the Codex quick guides found by search on 2026-11-17). `wire_api = "responses"` is the only supported value. `requires_openai_auth` defaults to false; with no `env_key`, no `auth` and no `experimental_bearer_token`, Codex sends no bearer token for a custom provider (observed indirectly in E-31-4: nothing was sent that needed a credential; the plan asserts the absence of an Authorization header on the provider stub, so this stays a checked claim, not an assumption). The `-c` flag overrides take TOML values and worked for the provider table (E-31-4).

**E-31-8. OpenCode (documented).** The npm package `opencode-ai` is at 1.19.5 (https://www.npmjs.com/package/opencode-ai, read 2026-11-17: "1.19.5 • Public • Published 19 days ago"; 0 dependencies); `opencode mcp list` lists configured servers with their connection status, and the V1-shaped `mcp` entry is documented at https://opencode.ai/docs/mcp-servers/ and https://opencode.ai/docs/cli/commands/ (read 2026-11-17 through search result excerpts). A local install without root is `npm install opencode-ai@1.19.5` into a scratch prefix, which the owner must approve (OQ-31-01). The existing production tier (`host-live-opencode.test.ts`) already drives `opencode mcp list` as the health check, like claude.

**E-31-9. Kimi (documented).** The Python `kimi-cli` repository is archived: "[Archived] Legacy Python Kimi CLI, no longer maintained. Please use Kimi Code CLI" (https://github.com/MoonshotAI/kimi-cli, read 2026-11-17). Its last release is a deprecation stub (the gate's `KIMI_STUB_MARKER`). **Kimi Code CLI** is a separate TypeScript product under the same `kimi` command name: MIT licensed, active (https://github.com/MoonshotAI/kimi-code, read 2026-11-17), with a non-interactive `kimi -p` print mode, `KIMI_CODE_HOME` (default `~/.kimi-code`) and `kimi doctor` that validates `config.toml` and `tui.toml` only (https://moonshotai.github.io/kimi-code/en/reference/kimi-command, read 2026-11-17). **Settled by plan 31-01 from the official pages (read 2026-11-17, OQ-31-06):** the official MCP page (https://moonshotai.github.io/kimi-code/en/customization/mcp) declares servers in `mcp.json` (user level `$KIMI_CODE_HOME/mcp.json`, default `~/.kimi-code/mcp.json`; project level `.kimi-code/mcp.json`) and manages them in the TUI with `/mcp-config` and `/mcp`; the command page lists no `kimi mcp` group (the subcommands are login, acp, web, app, install-desktop, doctor, export, migrate, import-sessions, upgrade, vis and provider). The third-party guide (https://decodo.com/blog/kimi-code-cli) said the same, and the official pages now confirm it, so it is no longer an inference. There is no non-interactive MCP validator: `kimi doctor` validates `config.toml` and `tui.toml` only. `kimi -p` runs one prompt without the TUI and needs a configured model; the env-vars page documents a provider override (`KIMI_MODEL_NAME` and `KIMI_MODEL_API_KEY` required, `KIMI_MODEL_BASE_URL` and `KIMI_MODEL_PROVIDER_TYPE` optional) that makes a loopback provider conceivable, but an API key is required, so unlike the Codex drive a session would carry a credential-shaped header [INFERENCE]; whether a login is required when the override is set is not stated. Headless runs leave project-level servers disabled unless the workspace is trusted (`KIMI_CODE_TRUST_WORKSPACE`). Consequence: the Phase 24 wording "no functional Kimi CLI release exists" (GAP-24-02, `HOST_LIVE.kimi.productionGap`, the registry `kimi` note) is true for `kimi` (legacy) and **not true for `kimi-code`**, whose honest gap is "functional, not installed here, no MCP validator command documented". Tier: documented.

**E-31-10. The daemon needs the account's real `HOME` (Phase 22 finding).** An isolated `HOME` made the sandbox stop fail with `AGENTOS_STOP_FAILED`. `runHostProduction` therefore keeps `HOME` and isolates only the host's own configuration variable. The Codex tier keeps the same rule: `CODEX_HOME` is isolated, `HOME` is the account's.

**E-31-11. The live-window procedure (earlier phases).** Phase 18 plan 14 is the model: a human-owned window (the owner opens it; no subagent runs a live step), the `realmlive` account, the shared live lock (the realm stack is shared and the startup reap is account-wide, so one live run at a time), preconditions confirmed first, steps in order, evidence kept outside the repository (names, counts, hashes and results go in the handoff; paths never), a stop rule (a failed step is reported with its catalogue code and the plan that owns the behaviour, never retried silently), and no push, pull request, merge or release from the window. Phase 17 plan 05 and Phase 14's scenario-5 window ran under the same lock and recorded the commit hash, the date, the assertion counts and the residue result (zero containers, sandboxes, state and secret directories, workspace entries, daemon processes). `docs/integration/openshell.md` ("Environment variables" and "Command") lists the production gate variables and the rule to run a live file alone.

### D-31-01. Host dispositions (BOOTP-01, BOOTP-02)

| Host | Disposition | How | Lift condition for a gap |
| --- | --- | --- | --- |
| `claude` | **boot** | the existing production tier, with a wire recorder and an elapsed-time diagnostic added (D-31-03) | none |
| `codex` | **boot** | a new session production tier (D-31-02): `codex exec` with a refusing loopback provider, killed once the boot is observed | none |
| `opencode` | **boot if approved, else named gap** | the existing production tier through a scratch install of `opencode-ai@1.19.5` the owner approves (OQ-31-01); without approval GAP-24-01 is rewritten with the real reason | an approved scratch install, or a CI image that carries `opencode` |
| `kimi` | **named gap** | the legacy Python CLI is archived; no run is possible or worth attempting | none planned; the row says so |
| `kimi-code` | **named gap** | functional, not installed, no MCP validator documented (E-31-9) | read the official MCP page, then an approved scratch install and a print-mode session with a refusing provider, if Kimi Code supports a provider override (unverified); a later phase |

A result is recorded whatever it is. A failed boot is a finding, not a failed phase: BOOTP-01 asks for results recorded, and the phase cannot manufacture a pass. A pass is never claimed from a skipped test.

### D-31-02. The Codex drive: `codex exec` with a refusing loopback provider (why this and not the others)

The Phase 24 gap says "`codex mcp list` does not start servers and a session needs model credentials, which no rehearsal supplies". The first half stays true. The second half is true of a model turn, and false of a session start: E-31-4 shows Codex launches and initializes its MCP servers before the first model request, and a provider that refuses is enough. So the Codex tier is a **session tier**:

1. The recipe writes the real table into an isolated `CODEX_HOME` (`realm host install codex`), so the entry Codex launches is the one the installer wrote, not a test double.
2. The session is `codex exec --json --skip-git-repo-check` with the three provider overrides of E-31-4 and the `env_vars` override of E-31-5, started as a bounded process group in a directory under the pinned workspace root, with a fixed prompt of one harmless sentence. The provider is a loopback HTTP server the test owns, bound to 127.0.0.1 on an ephemeral port, that answers every request with a 503 and records the request count and whether an Authorization header was ever present.
3. The harness does not wait for Codex to exit (it never does, E-31-4). It polls for the boot evidence (D-31-03 and the daemon checks below) and, once seen or at the bound, signals the process group (SIGTERM, then SIGKILL after 2 s) and sweeps the group at the end, as `runHost` does for a timeout.
4. After the kill, the same post-conditions as the claude tier: no live session, an empty presence directory, `realm down`, no residue, uninstall `removed`, the real `~/.codex/config.toml` byte-equal.

Rejected alternatives, each with the observed reason: `codex mcp list|get` (no server start), `codex doctor` (no server start, E-31-6), `codex mcp-server` (removed, and the wrong direction), `codex app-server` (tests Codex's server), and a real model credential (the phase rule: no credential). A scripted Responses-API server that makes Codex call a Realm tool is possible and is the deferred idea D-31-07.

### D-31-03. The evidence of "tools listed": a client-side wire recorder in the registered `realm`

The shim `realm` that `runHostProduction` puts first on `PATH` today `exec`s `node dist/src/cli/main.js "$@"`. For this phase it becomes a **recorder**: a small Node script that spawns the real CLI with the same argv, pipes the host's stdin to the child and the child's stdout back, and appends one JSON line per message to a log file whose path is fixed into the script when the test writes it. A line holds the direction, the JSON-RPC method name (or `response` and the request id), and, for the response to `tools/list`, the tool **names** only. It never records parameters, results, headers, paths or content. EOF on the host's stdin ends the child's stdin; the child's exit code is the recorder's exit code; SIGTERM and SIGINT are forwarded. The recorder is test-only and lives under `test/support/`.

What it proves: that the host's own client sent `initialize` and `tools/list` to Realm and Realm answered with the six tools (`exec`, `read`, `write`, `list`, `status`, `retry`, `src/mcp/server.ts` `TOOL_NAMES`). That is the meaning of "Realm tools are listed" in BOOTP-01. The daemon-side facts (`realm status` active, the `hostBoot` metric row with `phase` `attached` for the host id, the presence marker) are asserted as the claude tier already does.

Assertions per host, kept to what was observed: `initialize` observed for every host; `tools/list` observed and its names equal to the six tools for **codex** (E-31-4) and **claude** (E-31-3); for **opencode** the recorded methods are written to the evidence and not asserted, because no OpenCode run has been observed (the first run decides, and the plan says to pin an assertion only after a run, in a follow-up edit recorded in the summary). The recorder replaces the plain shim for the three hosts; the hermetic tests prove it forwards bytes, EOF and signals faithfully, so it adds no behaviour of its own to the boot.

### D-31-04. A validator-level session proof runs now, before the window

Because the Codex session needs no Podman, plan 31-01 includes a gated test that runs on this machine today: the validator-tier "session" test (`REALM_LIVE_CODEX=1`, no Podman): real recipe install into an isolated `CODEX_HOME`, `codex exec` with the refusing provider and the recorder pointing at a stub `realm` instead of the CLI, assert that the stub was launched with `mcp --host codex`, that `initialize` and `tools/list` crossed the wire, that the server's environment held `HOME`, `LANG`, `PATH` plus exactly the three forwarded names and nothing else from a planted secret, that its working directory was the project directory, that the provider stub saw no Authorization header, and that nothing outlives the test. This de-risks the window (the Codex drive and the recorder are exercised against the real Codex before the stack is involved) and pins E-31-4 and E-31-5 as tests, not prose. It is the same kind of run as the Phase 24 validator rehearsals, which ran on this machine on 2026-11-17.

### D-31-05. Where the code goes (test support only)

`test/support/host-live.ts` is 1069 lines and holds the gate, the runner and `runHostProduction`; the module-size ratchet covers `src` only, but the file should not grow another subsystem. New code goes in `test/support/host-live-session.ts` (the refusing provider, the Codex argument builder, the recorder writer and its log reader, and `runHostUntil`, the process-group runner that waits for a condition instead of an exit). `runHostProduction` gains one optional field, a drive description, and keeps its default behaviour (`HOST mcp list`) byte-for-byte for claude and opencode; the exported names it needs (`realmLines`, `attachedBootsOf`, `presenceEntries`) are shared with the new module without being copied.

### D-31-06. Gate, spec and registry changes for codex

`HOST_LIVE.codex` becomes a host with a production tier: `productionTier: true`, `productionGap: null`. The Codex production test uses the same two gates as claude and opencode (the validator gate plus the production prerequisites and no receipt). The sentence of the old gap moves to history (this file, the gaps page). The registry `codex.t3` changes from `gap` to `not-run` in plan 31-01 (the tier exists, no dated result yet) and to `rehearsed` or `gap` (failed) in plan 31-02 from the recorded result; `claude.t3` and `opencode.t3` change in 31-02 only. The hermetic pins in `test/integration/host-live-helpers.test.ts` change with the spec (the table, the production-gap assertion for codex, the gate order test, the collect-gate test). The generated block of `docs/integration/host-support-matrix.md` is rewritten with `REALM_WRITE_HOST_MATRIX=1` and checked by its test.

A failed rehearsal is recorded as `gap` with a note that begins `rehearsal failed` and names the date and the catalogue code (no new status value: the legend of the support matrix stays as it is).

### D-31-07. Deferred idea: a scripted Responses provider that makes Codex call a tool

A loopback server that speaks enough of the Responses stream (`response.created`, a `function_call` item naming the Realm tool, `response.completed`) would let Codex call `status` and show a tool result end to end. It needs the exact event schema of the Responses streaming API and a second drive state machine; it adds a result BOOTP-01 does not require ("listed or called"). Deferred; the plan records the idea in the boot matrix page under Not shown.

### D-31-08. The live window (blocking-human)

Every step that touches the `realmlive` stack, the shared live lock or a real installation is a **checkpoint for a person** (plan 31-02), as in Phase 18 plan 14: no agent runs the production tests, the window, or any command that starts the daemon, the gateway or a container on the production stack. The plan states the preconditions, the exact commands with placeholders, the evidence to keep outside the repository and the resume signal. Recording the results in the repository is an agent task after the person reports (31-02 task 4). If the owner has not opened the window, execution stops at the first checkpoint and reports BLOCKED with the unmet precondition; plan 31-01 stands on its own and is complete without the window.

### D-31-09. Docs

New page `docs/integration/wave1-boot-matrix.md`; edits to `docs/integration/host-plugin-gaps.md` (rows, below), `docs/integration/host-support-matrix.md` (the generated block, plus one sentence), `docs/integration/host-plugin-contract.md` (the Phase 24 evidence table T3 cells and one paragraph), the four snippets (`claude-code.md`, `codex.md`, `opencode.md`, `kimi.md`), `docs/integration/hosts.md` and `README.md` (one link). No `CHANGELOG.md` edit: release notes are generated. The pages follow the docs rules: no host-local path, no raw angle token outside code, one level-one heading, every repository path in a code span exists.

### D-31-10. The gap rows this phase writes or changes

Rows keep the Phase 26 table shape (seven cells). The test `test/docs/host-gaps.test.ts` accepts phases 21 to 26 only; plan 31-01 widens it to 21 to 31 (a one-line range change plus the pins that name the phase range in its messages) and makes a source of the form `31-CONTEXT` resolve like the others (it already resolves by phase number in `.planning/phases`).

| ID | Source | Change |
| --- | --- | --- |
| GAP-24-03 | 24-VERIFICATION U3 | narrowed by 31-02 with the claude and codex results (or kept open with the failure) |
| GAP-23-01 | 23-VERIFICATION U1 | narrowed by 31-02: claude and codex rehearsed; the wave 2 hosts stay open (GAP-25-07) |
| GAP-24-01 | 24-VERIFICATION U1, OQ-24-02 | rewritten in 31-01 for the real situation (no executable here; tier exists; scratch install is OQ-31-01); closed or narrowed in 31-02 only if the owner approved the install and it ran |
| GAP-24-02 | 24-VERIFICATION U2, OQ-24-01 | rewritten in 31-01: `kimi` archived; `kimi-code` functional and not run (E-31-9) |
| GAP-23-02 | 23-VERIFICATION U2, OQ-23-01 | stays open; 31-02 adds the measured warm `claude mcp list` time and whether Claude reported connected |
| GAP-31-01 | 31-CONTEXT E-31-5 | new: Codex forwards only `HOME`, `LANG` and `PATH` to a stdio server; the recipe writes no `env_vars`; whether a real Codex user reaches the production stack without them is inferred until 31-02 reports (owner decision OQ-31-03 on a recipe change) |
| GAP-31-02 | 31-CONTEXT D-31-02 | new: Codex boot is proven with a refusing provider and listing only; no model turn and no tool call ran (accepted residual; lift: D-31-07) |
| GAP-31-03 | 31-CONTEXT D-31-01 | new: the rehearsal covers a warm stack on one machine and one version per host; a cold start and other versions are not shown (links GAP-22-02, GAP-22-03, GAP-23-02) |

### Threat model: the rehearsal itself (summary; each plan carries STRIDE rows)

The workload is not part of this phase (no workload code runs; the host prompt is a fixed harmless sentence and the provider refuses it). What this phase adds is a live run on a shared production stack and a loopback listener. How each is held:

| Asset | Attack or failure | Hold |
| --- | --- | --- |
| The `realmlive` production stack and its shared state | A rehearsal leaves a sandbox, container, daemon, receipt or presence marker; two live runs overlap and the account-wide startup reap kills the other's children | The shared live lock; one file per invocation, `--test-concurrency=1`; the existing cleanup (`realm down`, receipt and presence removal, `waitForNoResidue`); a before and after snapshot of containers, sandboxes, state-directory entries and processes taken by the person, compared and kept outside the repository; the stop rule |
| The operator's real host configuration | The rehearsal registers Realm in a real `.claude.json`, `.codex/config.toml` or `opencode.json` | Each host's configuration home is isolated inside the scenario root (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `XDG_CONFIG_HOME`); the real file's sha256 is compared before and after in the test and again by the person |
| Credentials | A model credential or a token reaches a host, the provider stub or an evidence file | The host environment is an allowlist built from the scenario (no `*_API_KEY`, no token, no proxy variable); the Codex provider config has no `env_key`, `auth` or bearer token; the stub asserts that no Authorization header ever arrived; the recorder logs method names and tool names only; evidence files hold versions, counts and hashes, never environment values or paths |
| The loopback provider stub | It accepts a connection from another host or process, or answers with content that a model client treats as instructions | Binds 127.0.0.1 only on an ephemeral port; answers every request with a fixed 503 and an empty JSON body; records only method, path, whether Authorization was present and the peer address; closes in test cleanup; a test fails if a non-loopback peer connects |
| The Codex and Claude processes | A host process outlives the test and keeps a Realm session or a sandbox alive; a Codex child tree escapes the group kill | `runHostUntil` runs the host as a process-group leader, signals the group, waits, sweeps with SIGKILL at the end; the post-conditions (0 live sessions, empty presence, `realm down`, no residue) are asserted; the person's after-snapshot confirms no stray process |
| The recorder shim | The recorder changes the byte stream, hangs on EOF, swallows a signal, or logs content | Hermetic tests with a fake child prove byte-exact forwarding in both directions, EOF propagation, exit-code mirroring, signal forwarding and a log with no parameter or result content (a planted marker in params and results never appears in the log) |
| The scratch install of OpenCode (only if approved) | A scratch install runs a postinstall script or leaves a global binary | Owner decision first (OQ-31-01); the install uses a scratch prefix outside the repository and off the default path, the version is pinned, the result is removed after the window; nothing is installed globally |
| Documentation | A page overstates what the rehearsal showed (a pass for a host that was skipped; "booted" for a refused provider; "listed" without a wire record) | Every matrix cell carries its tier, version and date; the wave 1 boot matrix test ties each row's status to the registry; the Not shown list is mandatory; a skipped test is recorded as a gap, never a pass |

### Verification posture

Plan 31-01 is verified by its own hermetic tests, by the typecheck and lint of the test files, by the docs tests, and by one real run on this machine of the Codex validator-tier session test (`REALM_LIVE_CODEX=1`, no Podman). Plan 31-02 is verified by the person's window evidence and by the docs tests after the results are recorded. Nothing in the repository claims T3 for a host until 31-02 task 4 writes a dated result from the person's evidence.
</decisions>

<canonical_refs>
## Canonical References

- `test/support/host-live.ts` (gate order header, `HOST_LIVE`, `runHost`, `runHostProduction`, `collectHostLiveGate`), `test/support/production-live.ts` (`productionSkipReason`, `readLiveInputs`, `createScenarioEnvironment`, `waitForNoResidue`)
- `test/integration/host-live-{claude,codex,opencode,kimi}.test.ts`, `test/integration/host-live-helpers.test.ts`, `test/integration/production-driver.test.ts` (header: gate variables and the removal scope)
- `test/support/host-registry.ts`, `test/support/host-support-matrix.ts`, `test/docs/host-support-matrix.test.ts`, `test/docs/host-gaps.test.ts`, `test/docs/host-docs.test.ts`
- `docs/integration/host-plugin-gaps.md`, `host-support-matrix.md`, `host-plugin-contract.md` (the Phase 24 evidence table), `openshell.md` (production live suite: variables, command, results), `hosts.md`
- `docs/hosts/snippets/{claude-code,codex,opencode,kimi}.md` (each has a T3 row)
- `.planning/milestones/v3.0-phases/18-per-project-sandboxes/18-14-PLAN.md` (the live-window checkpoint model), `17-observability-and-tamper-evident-audit/17-05-PLAN.md`, `22-omp-plugin-on-boot/22-VERIFICATION.md` ("Live rehearsal, 2026-11-17"), `24-host-adapters-wave-1-claude-code-opencode-codex-kimi-cli/24-VERIFICATION.md`
- `docs/integration/anda-replacement-research.md` (the v4.0 rationale; this phase uses only its decisions as stated above)
- Vendor documentation read 2026-11-17: https://learn.chatgpt.com/docs/config-file/config-reference (Codex configuration reference), https://learn.chatgpt.com/docs/extend/mcp (Codex MCP), https://github.com/openai/codex/releases/tag/rust-v0.154.0, https://www.npmjs.com/package/opencode-ai, https://opencode.ai/docs/mcp-servers/, https://github.com/MoonshotAI/kimi-cli, https://github.com/MoonshotAI/kimi-code, https://moonshotai.github.io/kimi-code/en/reference/kimi-command
</canonical_refs>

<code_context>
## Existing Code Insights

- `hostLiveSkipReason` (`test/support/host-live.ts`) returns `spec.productionGap` as the production skip for a host that has one: that is how codex and kimi skip today; setting `productionGap: null` and `productionTier: true` opens the production gate for codex with no other change to the order.
- `runHostProduction` takes `{ host: "claude" | "opencode", bin, cliPath, env, realFile }`; the host literal type widens to include `"codex"`. Its steps 1 to 6 (scenario, isolation, install, host command, status poll, metrics poll, quiet poll, down, residue, uninstall, real-file hash) are what the Codex session drive reuses; only "run the host command and wait for it to exit" differs.
- The host command today is `runHost(bin, ["mcp", "list"], env, projectDir, bound)`; `runHost` signals the process group on timeout and sweeps it at the end; `runHostUntil` is the same shape with a readiness predicate.
- `HOST_OVERRIDE_VARIABLES.codex` already lists `CODEX_HOME`; `isolatedHostEnv` and `createHostRig` are the validator tier's isolation; the production tier uses `createScenarioEnvironment` (`production-live.ts`) which already keeps the account's `HOME`, `PATH` and `XDG_RUNTIME_DIR`.
- `attachedBootsOf` reads `realm metrics --workspace PROJECT` JSON for `hostBoot` rows with `hostId`, `phase` `attached`; `presenceEntries` lists the state directory's `hosts/ID-active` markers. Both are reused for codex.
- The registry `RegistryT3` status values are `none-defined | not-run | gap | rehearsed`; the support matrix renders `status: note` per host; the note must hold no angle bracket or pipe.
- `test/docs/host-gaps.test.ts` parses the gaps table (seven cells, ids `GAP-NN-NN` with NN from 21 to 26), checks sources against `.planning/phases` (skipped with a diagnostic when the tree is archived), and requires every closed or narrowed row to cite an existing repository path in its evidence.
- `test/docs/host-docs.test.ts` holds the page list for the shared docs checks (one level-one heading, code-span paths exist, relative links resolve, no raw angle token) and the link requirements (contract page, `hosts.md`, README link each page in the list).
- The Realm MCP server answers `server/discover` (modern era) and `initialize` (legacy era) and lists six tools (`src/mcp/server.ts`); Claude 2.1.322 sends both `server/discover` and `initialize`.
- Evidence directories and the live lock are operator-owned and outside the repository; no repository file records their locations.
</code_context>

<specifics>
## Wave Structure

| Wave | Plan | Requirements | Depends on |
| --- | --- | --- | --- |
| 1 | 31-01 Harness for the production tier (session drive, wire recorder, codex tier, registry and gate pins, hermetic tests), the Codex validator-tier session proof on this machine, the named gaps and the wave 1 boot matrix page with honest not-run cells | BOOTP-02 (complete), BOOTP-01 (harness) | Phase 28 merged (the build under test has no Anda bridge) |
| 2 | 31-02 The live window (blocking-human checkpoints), then recording the results | BOOTP-01 (results), BOOTP-02 (opencode disposition) | 31-01 |

31-01 owns: `test/support/host-live-session.ts` (new), `test/support/host-live.ts` (spec row, the drive option, the recorder shim use, the elapsed diagnostic, header comments), `test/integration/host-live-session-helpers.test.ts` (new, hermetic), `test/integration/host-live-codex.test.ts` (production test, session validator test, header), `test/integration/host-live-helpers.test.ts` (pins), `test/support/host-registry.ts` (codex `not-run`), `test/docs/host-gaps.test.ts` (range), `test/docs/host-docs.test.ts` (page list), `test/docs/wave1-boot-matrix.test.ts` (new), and the docs of D-31-09 except the result cells. 31-02 owns the result cells of the registry, the matrix block, the boot matrix page, the gaps rows, the contract page T3 cells and the snippets' T3 rows.

## Requirement IDs

| ID | Statement |
| --- | --- |
| BOOTP-01 | Each wave 1 host that can run here (claude, codex; others named) is booted through its own CLI against the production stack, and Realm tools are listed or called, with results recorded |
| BOOTP-02 | Hosts that cannot be booted (missing CLI, no credentials, archived) have a named gap in `docs/integration/host-plugin-gaps.md` |

## Open Questions (owner decisions or unverified; none blocks plan 31-01)

- **OQ-31-01.** Approve a scratch install of `opencode-ai@1.19.5` (and, separately, of Kimi Code CLI) on the `realmlive` account's side, outside the repository and off the default path, for one window? Default: **no**; OpenCode and Kimi Code stay named gaps and the matrix says why. Approval changes 31-02 task 1 only (it adds the OpenCode run to the window and the OpenCode result cells).
- **OQ-31-02.** When does the window open, and who holds the shared live lock and runs the steps? Default: the owner opens it and a person the owner names runs the steps as the `realmlive` account; nothing runs without it.
- **OQ-31-03.** [INFERENCE until 31-02] Codex forwards only `HOME`, `LANG` and `PATH` to a stdio server, and `realm host install codex` writes no `env_vars`. Should a later phase add `env_vars` (`XDG_RUNTIME_DIR`, `XDG_CONFIG_HOME`, `REALM_DRIVER_SOCKET`) to the Codex recipe so a real Codex session reaches a non-default stack? Out of scope here (no recipe change); the finding and a gap row are this phase's output. Default: record, decide after the window shows whether the account-default paths suffice for a real user.
- **OQ-31-04.** Is "listed" enough for BOOTP-01's "listed or called" for codex and claude? Default: yes, the requirement text says "or"; a scripted tool call is the deferred idea D-31-07.
- **OQ-31-05.** [INFERENCE] Whether Claude Code's `claude mcp list` health check finishes within its connection timeout when a cold Realm boot takes up to 230 s (GAP-23-02). The window runs warm; a failure there (not connected) is evidence, not a defect to patch.
- **OQ-31-06.** [INFERENCE] Whether Kimi Code's MCP surface has a non-interactive validator; plan 31-01 reads the official MCP page and corrects E-31-9.
</specifics>

<deferred>
## Deferred Ideas

- A scripted Responses-API provider so a Codex session calls a Realm tool end to end (D-31-07), and the same idea for Claude Code (`ANTHROPIC_BASE_URL` to a loopback stub), OpenCode and Kimi Code.
- A cold-stack rehearsal (GAP-22-02, GAP-23-02) and rehearsals on a second version of each host (GAP-22-03).
- A Kimi Code recipe check and tier (functional product; scratch install; print mode with a refusing provider) as its own phase if the owner wants it.
- Adding `env_vars` to the Codex recipe (OQ-31-03).
- A T3 tier for the wave 2 config-only hosts (OQ-25-09, GAP-25-07).
- A CI image that carries `claude`, `codex` and `opencode` so the validator and session tiers run on every pull request.
</deferred>

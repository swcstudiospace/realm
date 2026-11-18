# Host runtimes: Node or Bun requirement, plugin, MCP and ACP loading

## Host tiers (v2.0)

Realm ships one integration per host. The tier says how far each one is verified.

| Tier | Meaning | Hosts |
| --- | --- | --- |
| 1: live verified | Run in a real session on the verification host, with the evidence recorded | Omp, for OMP-LIVE-01, OMP-LIVE-03 and OMP-LIVE-04: a live Omp session on the final build, 2026-10-28 (Omp 18.12.6, Podman 5.7.1), showed `realm active` after the attach, the `realm-retry` command reattaching from disconnected in the same session, and the same daemon still running after Omp quit (see `docs/integration/omp.md`). The disconnected status with the daemon's own reason was observed live on 2026-10-23 (OMP-LIVE-02). UI-01's "without blocking the session" was re-measured on 2026-10-28 but is a measurement, not a demonstration, so the Omp host is not a full pass. OMP-05 is unproven live, and ACP was not exercised live |
| 2: validator verified | The adapter bundle passes the host's own validator, in an isolated directory. Not registered in the live host configuration | Claude Code and Grok Build (`adapters/claude-plugin`): `claude plugin validate` passes with warnings, `grok plugin validate` passes. Muse Code (`adapters/muse-code`): `muse plugins validate` passes. Hermes Agent (`adapters/hermes-agent`, a portable package): `hermes plugins validate` passes. Prime Agent (`adapters/prime-agent`): no validator subcommand exists; an isolated project-local install and list pass |
| 3: documented only | Snippet from the host's official pages, not run here | none at v2.0 |

MCP connectivity, checked on 2026-10-29 with the real clients in isolated homes against `realm mcp` attached to the realm account's stack (a connection check, not a model-driven tool call): Claude Code 2.1.308 (`claude mcp list`) and Grok Build 1.0.46 (`grok mcp doctor`) connect and discover the six tools. The same check against release 0.2.0 found Claude Code unable to connect, because the server answered `initialize` with a revision a legacy client does not know; `docs/integration/mcp.md`, Q6, records the finding and the dual-era fix. Muse Code, Hermes Agent and Omp were not checked on that date (no connectivity command, or no usable install on this machine). Muse Code and Hermes Agent were later checked at the validator tier on 2026-11-18 (Phase 36; the Muse Code result is under "Muse Code" below and in `docs/hosts/snippets/muse-code.md`, the Hermes Agent result in `docs/hosts/snippets/hermes-agent.md`); neither was booted against the production stack.

Each host has a snippet in `docs/hosts/snippets/`. The snippets reference the
adapter bundles by their repo paths. `realm` is not on `PATH` on the
verification host, so every snippet says so and gives no install path.

Realm was not registered in any live host configuration (Claude Code, Grok
Build, Muse Code, Hermes Agent, Prime Agent, or the persistent Omp config).
The Omp link recorded on 2026-11-13 (`docs/hosts/snippets/omp.md`) is in an
isolated profile, not the persistent config. Its status item read
`realm disconnected` with `REALM_NOT_ACTIVE`, and `realm status` in the same run
reported daemon absent. Registration needs explicit approval per host.


## Host plugin contract

Phase 21 adds one contract for every CLI agent Realm may run in: a runtime table of 19 hosts (22 since Phase 40, which added `muse-code`, `prime-agent` and `grok-build`), a strict plugin manifest, a capability catalogue over the existing policy facts, a boot-hook port with a conformance harness, an installer engine with ownership receipts, and `realm host list|detect|status|install|uninstall`. It is documented in [host-plugin-contract.md](host-plugin-contract.md), with the table of hosts and its evidence limits. Phases 22 and 24 gave `omp`, `claude`, `opencode`, `codex`, `kimi` and `kimi-code` an install recipe and Phase 25 gave ten more (`cursor`, `copilot`, `qwen`, `augment`, `pi`, `cline`, `antigravity`, `kilo`, `codebuddy`, `hermes`), so 16 hosts have a recipe; the other 3 (`windsurf`, `trae`, `zcode`) are owner-approved deferrals that refuse as `recipe-pending` and change nothing. Everything is proven on fixture hosts (a temporary home and string goldens); the per-host live rehearsal is gated and records no result yet, so no host is registered live by this repository and no live Realm session through any of these hosts is claimed. Registration still needs explicit approval per host. The tier table above is unchanged.

Phase 23 adds the boot path for the 18 `mcp-config` hosts (21 since Phase 40): a host's configuration launches `realm mcp --host <id>` (or `realm acp --host <id>`, optionally with `--reattach`) and the session boots in six numbered steps, serves nothing until the boot settles, writes its presence marker and reports its boot to the daemon. `--host` takes a canonical host id only. Every adapter bundle and snippet shipped before Phase 24 still runs plain `realm mcp`, which boots the same way and reports as `unlabelled`; the Phase 24 and Phase 25 recipes write `--host <id>` (claude, opencode, codex, kimi, kimi-code and the ten Phase 25 hosts), and no live registration was made. The sequence, the exit codes and what is proven against what are in [host-plugin-contract.md](host-plugin-contract.md), "Boot integration". It is proven against fakes and a real daemon over fakes; the live rehearsal with a real Claude Code and a real Omp has not been run.

To add a host, read [Writing a Realm host plugin](writing-a-host-plugin.md); the per-host summary is the [Host support matrix](host-support-matrix.md); what is not proven is tracked in [Host plugin gaps](host-plugin-gaps.md); the production-stack boot status of the five wave 1 hosts is on [Wave 1 boot matrix](wave1-boot-matrix.md).

### Phase 25: the remaining runtimes

Read date 2026-11-17. Each host below has a snippet with the file, the entry, the override variable, the host's validator command, whether and how the host loads project-level configuration (with the shadowing warning), what the host does to the file when it rewrites it, the recovery steps and the evidence tier reached. One line per host, from the decision table in [host-plugin-contract.md](host-plugin-contract.md), "The Phase 25 recipes":

- Cursor: ships; `~/.cursor/mcp.json`, `mcpServers.realm` with `type: "stdio"`; documented, spawn observed; no override variable. [Snippet](../hosts/snippets/cursor.md).
- GitHub Copilot CLI: ships; `~/.copilot/mcp-config.json` (`COPILOT_HOME`), Copilot's canonical entry with `tools`; observed (1.0.112). [Snippet](../hosts/snippets/copilot.md).
- Qwen Code: ships; `~/.qwen/settings.json` (`QWEN_HOME`), the host's whole settings file; observed (0.22.0). [Snippet](../hosts/snippets/qwen.md).
- Augment (Auggie CLI): ships; `~/.augment/settings.json` (`AUGMENT_CACHE_DIR`); observed (1.2.1). [Snippet](../hosts/snippets/augment.md).
- Pi: ships for pi 1.3 and later only (owner-approved); `~/.pi/agent/mcp.json` (`PI_CODING_AGENT_DIR`, shared with Omp); observed (1.5.2). [Snippet](../hosts/snippets/pi.md).
- Cline: ships for the Cline CLI only; `~/.cline/data/settings/cline_mcp_settings.json` (`CLINE_DIR`); the documented flat shape parses (3.0.74). [Snippet](../hosts/snippets/cline.md).
- Antigravity: ships documented-only; `~/.gemini/config/mcp_config.json`, three Google pages agree, GSD Core's path differs, `agy` never run. [Snippet](../hosts/snippets/antigravity.md).
- Kilo Code: ships; `~/.config/kilo/kilo.json` (`XDG_CONFIG_HOME`), OpenCode-shaped `mcp.realm`; observed (7.8.27). [Snippet](../hosts/snippets/kilo.md).
- CodeBuddy Code: ships with a guard; `~/.codebuddy/.mcp.json` (`CODEBUDDY_CONFIG_DIR`), refused when it would hide a legacy file; observed (2.185.0). [Snippet](../hosts/snippets/codebuddy.md).
- Hermes Agent: ships through the new `yaml-map` kind; `~/.hermes/config.yaml` (`HERMES_HOME`), `mcp_servers.realm`; observed through the host's own writer functions, the CLI was broken on the verification machine. [Snippet](../hosts/snippets/hermes-agent.md).
- Windsurf (renamed Devin Desktop), Trae and ZCode: deferred, owner-approved 2026-11-17; each keeps refusing `recipe-pending`. [Reasons, evidence and the owner decisions](../hosts/snippets/deferred-hosts.md).

Nothing here was registered in a live host configuration, no wave 2 host has a live end-to-end tier, and the gated validator rehearsal ran live once (Qwen Code 0.22.0 passed on 2026-11-17; the other eight gated hosts skipped with named reasons and were not run).

## Gate note (FOUND-03)

Gate note for FOUND-03 (decisions D-09, D-16, D-17, D-18). Status per host:

| Host | Official source found | Node or Bun requirement | Plugin, MCP, ACP model |
| --- | --- | --- | --- |
| Omp | yes (omp.sh, project README) | Bun 1.3.14 or later for the recommended install; Node not documented | partly documented |
| Claude Code | yes (code.claude.com) | none for the native binary; Node.js 22 or later only for the npm install path | plugins and MCP documented; ACP not documented |
| Grok Build | yes (docs.x.ai) | not documented | plugins and MCP documented; ACP named, transport not documented |
| Hermes Agent | yes (hermes-agent.nousresearch.com) | managed Python 3.14 and Node.js; no system Node adopted | plugins, MCP and ACP documented |
| Muse Code | yes (dev.meta.ai) | native binary, no runtime stated | skills, hooks and MCP documented; ACP not documented |

Blocks: the `engines` field and the build target (plan 01-03, D-09). It also blocks host-specific plugin code in later phases, which must read the matching gate section below before writing code.

## Read date

2026-10-21 (ISO 8601) for Omp, Claude Code, Grok Build, and Hermes Agent; 2026-10-22 for Muse Code. Every statement below was read on its section's date. Quotations are taken from the page text as fetched.

Phase 25 hosts (Cursor, Copilot, Qwen Code, Augment, Pi, Cline, Antigravity, Kilo, CodeBuddy, Hermes, Windsurf/Devin Desktop, Trae, ZCode): 2026-11-17.

## Official URLs read

Omp:

- https://omp.sh/ (project homepage)
- https://github.com/can1357/oh-my-pi#readme (project README, which names the package install path and the runtime)

Claude Code:

- https://code.claude.com/docs/llms.txt (documentation index)
- https://code.claude.com/docs/en/overview.md (overview)
- https://code.claude.com/docs/en/setup.md ("Advanced setup": system requirements and npm install)
- https://code.claude.com/docs/en/features-overview.md (extension layer: plugins, MCP, hooks)
- https://code.claude.com/docs/en/quickstart.md (install commands)
- https://code.claude.com/docs/en/mcp.md (MCP reference; read 2026-10-22, see `docs/hosts/snippets/claude-code.md`)

Grok Build:

- https://docs.x.ai/ (xAI documentation root; links to Grok Build)
- https://docs.x.ai/build/overview (Grok Build overview)
- https://docs.x.ai/build/features/skills-plugins-marketplaces (skills, plugins, hooks, MCP loading)

Hermes Agent:

- https://hermes-agent.nousresearch.com/ (product site; links the documentation)
- https://hermes-agent.nousresearch.com/docs (documentation landing page)
- https://hermes-agent.nousresearch.com/docs/getting-started/installation (prerequisites and managed runtime)
- https://hermes-agent.nousresearch.com/docs/user-guide/features/plugins (plugin loading)
- https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp (MCP configuration)
- https://hermes-agent.nousresearch.com/docs/user-guide/features/acp (ACP server)

Muse Code (read 2026-10-22):

- https://dev.meta.ai/docs/muse-code (product index; install and reading guide)
- https://dev.meta.ai/docs/muse-code/extending (skills, hooks, MCP servers, headless runs)
- https://dev.meta.ai/docs/muse-code/configuration (settings.json, schema_version, project instructions, memory)

Phase 25 hosts (read 2026-11-17; the ones marked third-party or archived are not official current sources):

- https://cursor.com/docs/mcp and https://cursor.com/docs/cli/reference/configuration (Cursor)
- https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers (GitHub Copilot CLI)
- https://github.com/QwenLM/qwen-code (Qwen Code; the documentation bundled in the npm package)
- https://docs.augmentcode.com/cli/integrations (Augment)
- https://pi.dev/docs/latest/mcp and https://github.com/earendil-works/pi (Pi)
- https://docs.cline.bot/mcp/mcp-overview.md and https://docs.cline.bot/getting-started/config.md (Cline)
- https://antigravity.google/docs/mcp/, https://antigravity.google/docs/cli/gcli-migration and https://antigravity.google/docs/settings (Antigravity)
- https://kilo.ai/docs/automate/mcp/using-in-kilo-code and https://kilo.ai/docs/code-with-ai/platforms/cli (Kilo Code)
- https://www.codebuddy.ai/docs/cli/mcp (CodeBuddy Code)
- https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp and github.com/NousResearch/hermes-agent v0.23.2 (Hermes, MCP page re-read)
- https://docs.devin.ai/desktop/devin-desktop-faq.md, https://docs.devin.ai/desktop/changelog.md, https://docs.devin.ai/cli/extensibility/mcp/configuration.md, https://docs.devin.ai/desktop/devin-local/customizations.md and https://docs.devin.ai/cli/reference/configuration/read-config-from.md (Windsurf, now Devin Desktop; the legacy Cascade file is documented only in a Wayback snapshot of 2026-02-28 of docs.windsurf.com/windsurf/cascade/mcp)
- https://docs.trae.ai/ide/add-mcp-servers (Trae IDE) and, third-party, https://github.com/vshulcz/deja-vu/issues/4731
- https://zcode.z.ai/en/docs/mcp-services and https://zcode.z.ai/en/docs/install (ZCode)
- github.com/open-gsd/gsd-core `next` (`bin/install.js`, `docs/how-to/connect-gsd-mcp-server.md`, `docs/how-to/install-on-your-runtime.md`, `docs/reference/host-integration-capability-matrix.md`), read as the source of GSD Core's own homes and variable names

Each URL in the lists above the Phase 25 list was reached from the official documentation index or from a link on an official page. None was typed from memory. The Phase 25 URLs were read in the 2026-11-17 research pass, each one directly; the Devin legacy Cascade snapshot and the Trae issue are marked as such and are not official current sources.

## Spec questions asked (D-16, spec n7 gate 6, PER_HOST_MATRIX)

For each host:

1. Q1: Node or Bun requirement.
2. Q2: How the host loads plugins.
3. Q3: How the host loads MCP servers.
4. Q4: How the host loads or hosts ACP agents.
5. Q5: Capability gaps relevant to Realm.

## Omp

Q1 (Node or Bun). Answer: Bun 1.3.14 or later for the recommended install. The README lists "macOS · Linux · Windows · bun ≥ 1.3.14" and gives the install command `bun install -g @oh-my-pi/pi-coding-agent` under "Bun (recommended)". It also states: "Without a usable bun (or with `--binary`), the install scripts fetch the prebuilt binary from `build.stencil.so` and check its SHA-256 before installing it." Node: not documented.

Q2 (plugin loading). Answer, from the README: "Ask omp to write the piece you're missing, then `/reload-plugins`. Keep it local, ship it in a `marketplace`, or publish it to npm." Extension discovery is controlled by `--no-extensions` ("to skip ambient extension discovery") and `--trusted-extension /absolute/path/to/file.ts` ("for an exact extension allowlist"). Opening a repository "loads its project inputs by design: settings, extensions, hooks, tools, commands, skills, rules, and project MCP configuration." The plugin manifest file name, package key, lifecycle hook names and status API are not documented in the README. Those are the gate questions for omp.md (Phase 1, gate 4), not answered here.

Observed later, not from the README: on 2026-11-13 (omp 18.20.0, isolated profile), `omp plugin list --json` listed a linked checkout's package with manifest `extensions` `./dist/src/omp/extension.js` (`docs/hosts/snippets/omp.md`).

Q3 (MCP loading). Answer: project MCP configuration loads when a repository is opened. It is excluded for one invocation with `--config <file>` and the YAML key `mcp.enableProjectConfig: false`. The README also says omp reads "MCP servers from `.claude`, `.cursor`, `.windsurf`, `.gemini`, `.codex`, `.cline`, `.github/copilot`, and `.vscode`."

Q4 (ACP). Answer: the README section "ACP: editor-drivable agent" states that omp runs inside Zed as "the same agent you drive from the terminal ... No bridge, no plugin." The ACP transport, version and method list are not documented in the README. Not documented beyond that statement.

Q5 (capability gaps). Built-in write and edit tools: the README says "`--no-tools` disables built-in tools, but project tool modules remain a separate discovery surface." It does not say whether that flag covers the built-in write and edit tools specifically, or how a required mode would enforce it. This is the D-03 host-write question. It stays open for Phase 5 (OMP-05), to be answered in omp.md. Not documented in the README.

## Claude Code

Q1 (Node or Bun). Answer, from the Advanced setup page: the native installer is the recommended route, and it needs no Node runtime. The npm route is documented as follows: "The npm package requires Node.js 22 or later. On an older Node.js version, npm prints an `EBADENGINE` warning during install rather than failing." It also states: "The npm package installs the same native binary as the standalone installer ... The installed `claude` binary does not itself invoke Node." Bun: not documented.

Q2 (plugin loading). Answer, from the Extend Claude Code page: "A plugin bundles skills, hooks, subagents, and MCP servers into a single installable unit," and plugins are distributed through marketplaces. The plugin manifest format is on a linked page (plugins/overview) that was not fetched in the 2026-10-21 read. `docs/hosts/snippets/claude-code.md` documents `claude plugin validate <dir>` and `claude --plugin-dir <dir>` for a plugin bundle, from a page read on 2026-10-22; the manifest schema itself is not recorded here.

Q3 (MCP loading). Answer, from the Extend Claude Code page: MCP "connects Claude to external services and tools." MCP servers load "at session start." `/mcp` shows each server's connection status, and remote servers reconnect automatically. The configuration file format was on the MCP reference page, which the 2026-10-21 read did not fetch. The page read on 2026-10-22 (https://code.claude.com/docs/en/mcp.md, recorded in `docs/hosts/snippets/claude-code.md`) documents `claude mcp add [options] <name> -- <command> [args...]` and a project-shared `.mcp.json` with an entry under `mcpServers`; an entry with no `type` is read as a stdio server.

Q4 (ACP). Not documented in the pages read.

Q5 (capability gaps). Claude Code's own ACP host behaviour is not documented in the pages read. Hooks run "outside the main conversation" and are the lifecycle surface. The Node floor (22) applies only to the npm install route, not to the native binary.

Installed by `realm host install claude`: since Phase 24 the command merges `mcpServers.realm` (`realm mcp --host claude`) into the user-scope file `~/.claude.json` (or `<CLAUDE_CONFIG_DIR>/.claude.json`), the entry `claude mcp add --scope user` writes (observed with Claude Code 2.1.322 in an isolated home, 2026-11-17). Q3 above gains the precedence rule from https://code.claude.com/docs/en/mcp.md (re-read 2026-11-17): local scope, then project scope (`.mcp.json`, approved interactively), then user scope, then plugin-provided servers, then claude.ai connectors; the winner's whole entry is used. See [the snippet](../hosts/snippets/claude-code.md) for the file, the shadowing warning and the evidence reached. On 2026-11-18 the attach, the host label and the key id on the audit lines were shown live for this host under enforced capability tokens, with the limit that the turn was a scripted provider and not a model, on [the capability token evidence page](capability-token-evidence.md).

## OpenCode

Read date: 2026-11-17 (ISO 8601). Sources: https://opencode.ai/docs/config.md, https://opencode.ai/docs/mcp-servers.md, https://opencode.ai/docs/migrate-v1.md; observed with OpenCode 1.19.5 (fetched into a scratch directory, never installed).

Q1 (Node or Bun). Not recorded in the pages read.

Q2 (plugin loading). Not covered by this phase: Realm uses the MCP configuration file, not an OpenCode plugin. The configuration locations are the global `~/.config/opencode/opencode.json(c)` (moved by `XDG_CONFIG_HOME`, observed), a project `opencode.json(c)` and `.opencode/`, and a machine-wide `/etc/opencode`.

Q3 (MCP loading). Servers are read from the `mcp` key of the configuration. Quoted from the config page: "The package config overrides matching settings from the repository config, which overrides the global config." From the MCP page: "A higher-precedence project config replaces the entire server object with the same name"; V2 names servers under `mcp.servers` and "does not place server names directly under `mcp`". The migration page: "The V1 config format remains supported" and "OpenCode recognizes mixed V1 and V2 members within `mcp`". Realm writes the V1 shape `mcp.realm` (`{"type": "local", "command": ["realm", "mcp", "--host", "opencode"]}`), which 1.19.5 listed. `opencode mcp add` is interactive in 1.19.5. No trust or approval gate for project configuration is documented.

Q4 (ACP). Not documented in the pages read.

Q5 (capability gaps). `opencode.jsonc` with comments is read by OpenCode but is never read or changed by Realm, and JSON with comments in `opencode.json` is refused. Which of `opencode.json` and `opencode.jsonc` wins for a same-named server in one directory is not documented. See [the snippet](../hosts/snippets/opencode.md).

## Codex

Read date: 2026-11-17 (ISO 8601). Source: https://developers.openai.com/codex/mcp; observed with codex-cli 0.154.0 in an isolated home.

Q1 (Node or Bun). Not recorded in the pages read.

Q2 (plugin loading). Not covered by this phase: Realm uses the MCP configuration, not a Codex plugin.

Q3 (MCP loading). Quoted: "By default this is `~/.codex/config.toml`, but you can also scope MCP servers to a project with `.codex/config.toml` (trusted projects only)." (`CODEX_HOME` moves the user file, observed.) Each server is a `[mcp_servers.<server-name>]` table with `command`, `args`, `env`, `env_vars`, `cwd`, and a documented per-server `startup_timeout_sec`. `codex mcp add realm -- realm mcp --host codex` writes the table Realm's block holds; `codex mcp list` and `codex mcp get realm` parse it without launching it.

Q4 (ACP). Not documented in the pages read.

Q5 (capability gaps). `codex mcp get realm` prints a `remove: codex mcp remove realm` hint, but Realm's table is removed with `realm host uninstall codex`; after Codex's own remover took the table out, that command is a clean no-op (Codex rewrites `config.toml` with a comment-dropping editor, so Realm owns the table by its header and writes no marker; observed with codex-cli 0.154.0, 2026-11-17). `codex mcp list` does not start servers; a live Codex session booting Realm is driven by `codex exec` against a loopback provider that refuses every request, so no model credential is needed, and that drive is written and has not run on the production stack (see the [Wave 1 boot matrix](wave1-boot-matrix.md)). See [the snippet](../hosts/snippets/codex.md).

## Kimi CLI and Kimi Code

Read date: 2026-11-17 (ISO 8601). Sources: https://github.com/MoonshotAI/kimi-cli; https://moonshotai.github.io/kimi-cli/en/customization/mcp.html and .../configuration/{data-locations,env-vars}.html; https://www.kimi.com/code/docs/en/kimi-code-cli/customization/mcp.html and .../configuration/{data-locations,env-vars}.html; the GSD Core installer source at commit `69d604e`. The documentation was read on that date; on 2026-11-18 kimi-cli 1.51.0 (the last functional PyPI release; 1.52.0 is a deprecation stub) and Kimi Code 2.6.3 were run from scratch installs outside the repository (see Q5). `kimi mcp add` was never run: it did not complete in 60 s on 2026-11-17 and the cause was not found.

The flag question is closed: `--kimi` and the id `kimi` are Kimi CLI (Python, `~/.kimi`, `KIMI_SHARE_DIR`); `--kimi-code` and `kimi-code` are Kimi Code (Node, `~/.kimi-code`, `KIMI_CODE_HOME`). The command name `kimi` is shared, so Realm never detects either by it. Kimi CLI is archived upstream ("Legacy Python Kimi CLI, no longer maintained. Please use Kimi Code CLI"); Kimi Code is the successor.

Q1 (Node or Bun). Not recorded in the pages read (Kimi Code is described as Node, Kimi CLI as Python by the installer source).

Q2 (plugin loading). Not covered by this phase: Realm uses the MCP configuration file.

Q3 (MCP loading). Kimi CLI: "MCP server configuration is stored in `~/.kimi/mcp.json`, in a format compatible with other MCP clients" with `{"mcpServers": {...}}`; commands `kimi mcp add|list|remove|test|auth`; `KIMI_SHARE_DIR` "Customize the share directory path (default: ~/.kimi)"; no project-level behavior documented. Kimi Code: user-level `~/.kimi-code/mcp.json` ("optional"), `KIMI_CODE_HOME` overrides the data root, project-level `.kimi-code/mcp.json` takes effect only after the folder is trusted at the startup prompt, and a server added by editing `mcp.json` mid-session joins only sessions created later. No validator command is documented for Kimi Code, and on 2.6.3 `kimi mcp` is an unknown command.

Q4 (ACP). Not documented in the pages read.

Q5 (capability gaps). T1 is the offline fixtures against goldens that follow the documentation. On 2026-11-18, Kimi Code 2.6.3 launched `realm mcp --host kimi-code` in a `kimi -p` session on the production stack and listed the six tools (rehearsed), with a session proof as its validator tier because no validator command exists. The legacy kimi 1.51.0 passed its validator tier but its production tier failed (`kimi mcp test realm` sent `tools/list` and the recorder saw no tool names; GAP-43-03), and it forwards only `HOME` and `PATH` to a stdio server (GAP-43-01). No model turn ran for either product. See [the snippet](../hosts/snippets/kimi.md) and the open owner decision OQ-24-01.

## Grok Build

Q1 (Node or Bun). Answer: not documented. The overview gives the install command `curl -fsSL https://x.ai/cli/install.sh | bash` (macOS and Linux) and `irm https://x.ai/cli/install.ps1 | iex` (PowerShell). It names no Node or Bun version.

Q2 (plugin loading). Answer, from the Skills, Plugins and Marketplaces page: "Plugins extend Grok with additional skills, agents, hooks, MCP servers, and LSP servers." Grok loads plugins from `./.grok/plugins/`, `~/.grok/plugins/`, marketplace installs under `~/.grok/plugins/marketplaces/`, extra paths under `[plugins] paths` in `~/.grok/config.toml`, and `--plugin-dir <PATH>`. Plugin hooks receive `GROK_PLUGIN_ROOT` and `GROK_PLUGIN_DATA`. The plugin manifest file format is not on the pages read: not documented in the pages read. The snippet (`docs/hosts/snippets/grok-build.md`) validates the shared Claude bundle with `grok plugin validate` (tier 2 above), which does not make the manifest format documented.

Q3 (MCP loading). Answer: MCP servers are loaded from enabled plugins. The page also states that Grok "automatically reads Claude Code marketplaces, plugins, skills, MCPs, agents, hooks, and instruction files." A direct MCP configuration key in `~/.grok/config.toml` is not documented in the pages read.

Q4 (ACP). Answer, from the overview: Grok Build is usable "through the Agent Client Protocol (ACP) in other apps." The ACP transport, version and launch command are not documented in the pages read.

Q5 (capability gaps). `grok inspect` lists "config sources, instructions, skills, plugins, hooks, and MCP servers" for the current directory, which the doctor probe could use. Node requirement: not documented.

Phase 40 note (2026-11-18, Grok Build 1.0.77). This supersedes the Q3 statement that no direct MCP configuration key is documented: the host's own writer shows one. `grok mcp add NAME -- COMMAND ARGS` writes a `[mcp_servers.NAME]` table into `~/.grok/config.toml`, and `grok mcp list` prints the registered command without starting it. `realm host install grok-build` writes that same table with the launcher `realm mcp --host grok-build`, so a Grok Build session is attributed `grok-build` under the enforced default. Grok also reads `~/.claude.json` and `.mcp.json`; a `claude`-labelled entry that only the shared Claude files carry is attributed `claude` (`GAP-40-01`), and a `realm` entry in `config.toml` shadows it by name. The read-date statements above are unchanged. Detail and the dated validator result are in `docs/hosts/snippets/grok-build.md`.

## Hermes Agent

Q1 (Node or Bun). Answer, from the installation page: the installer provisions its own runtime. "PM provides pinned Python, Node.js, npm, ripgrep, and FFmpeg." It also states: "Current first-party installations run on **Python 3.14**" and "PM ... does not adopt arbitrary system Node versions as the installed runtime." The source-install prerequisites are "Git, curl, tar, and SHA-256 utilities." The numeric Node.js version pinned by PM is not documented in the page read. Bun: not documented.

Q2 (plugin loading). Answer, from the Plugins page: drop a directory into `~/.hermes/plugins/` containing `plugin.yaml` and Python code. `__init__.py` defines `register(ctx)`, which calls `ctx.register_tool(...)` and `ctx.register_hook(...)`. Project-local plugins under `./.hermes/plugins/` are gated by `HERMES_ENABLE_PROJECT_PLUGINS`, and the gateway "discovers plugins once for the whole process." Plugins are enabled through `hermes plugins` (per the page). The repository's bundle uses the portable form (`plugin.json` and `mcp.json`, no Python) and is checked with `hermes plugins validate` (tier 2 above; see `docs/hosts/snippets/hermes-agent.md`).

Q3 (MCP loading). Answer, from the MCP page: servers are declared under `mcp_servers` in `~/.hermes/config.yaml`. "Local stdio servers and remote HTTP MCP servers in the same config" are both supported, with "automatic tool discovery and registration at startup" and per-server tool filtering. A `~/.claude.json` `mcpServers` block maps to `mcp_servers` on import.

Q4 (ACP). Answer, from the ACP page: "Hermes Agent can run as an ACP server, letting ACP-compatible hosts talk to Hermes over stdio." The host command is `hermes acp`. ACP mode uses the curated `hermes-acp` toolset, and MCP servers from `mcp_servers` follow the same rules as the gateway by default.

Q5 (capability gaps). The page states that "The embedded `hermes mcp serve` exposes a **stdio-only** MCP server today." So Hermes can be an MCP client over stdio or HTTP, but as an MCP server it is stdio-only. The ACP toolset excludes messaging delivery and cron management. [INFERENCE] Hermes reaches a Realm MCP server as a client, so the Realm server needs a stdio or HTTP transport that Hermes' client accepts.

## Muse Code

Read date: 2026-10-22 (ISO 8601). Sources are the three official URLs listed above.

Q1 (Node or Bun). Answer: not documented. The index page installs "a native `muse` binary on your path" with the one-line installer (`curl -fsSL https://dev.meta.ai/install.sh | sh` on macOS and Linux; `irm https://dev.meta.ai/install.ps1 | iex` on Windows) and states no Node or Bun version requirement. The TypeScript SDK installs with `npm install @muse-code/sdk`; no Node floor for the SDK is stated on the pages read.

Q2 (plugin loading). Answer, from the extending page: a skill "packages a repeatable workflow the agent can load on demand" and skills load from four sources: built-in, user (`$XDG_CONFIG_HOME/muse/skills` and `~/.agents/skills`), project (`<repo>/.agents/skills/<skill-id>/SKILL.md`), and plugin ("skills contributed by enabled plugin bundles"). Management commands are `muse skills list`, `muse skills inspect <skill-id>`, `muse skills enable <skill-id> --scope project`, `muse skills install ./my-skill --scope user`, `muse skills validate ./my-skill`, and `muse skills import --from claude`. A hook "binds to exactly one event"; the available events are `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PermissionRequest`, `PostToolUse`, `PostToolUseFailure`, `PostToolBatch`, `PreLLMCall`, `PostLLMCall`, `PreCompact`, `PostCompact`, `SubagentStart`, `SubagentStop`, `Notification`, `Stop`, `StopFailure`, and `SessionEnd`. Hooks are declared in the first-class `hooks` block of the settings file. The plugin bundle manifest format is not on the pages read: not documented in the pages read.

Q3 (MCP loading). Answer, from the extending page: "Declare servers in the `mcp_servers` block of your settings file. Each server takes a `transport`: either `stdio` (with `command`, `args`, and `env`) or `streamable_http` (with `url` and `headers`). Every server also takes `enabled` and `mode`." A server's `mode` defaults to `required` ("If a required server fails to start, the whole run aborts"); `optional` is skipped with a warning when unavailable. "For `stdio`, the optional `framing` setting controls message framing." Server configs support `${VAR}` environment-variable interpolation, and Muse Code passes `MUSE_SESSION_ID` to `stdio` servers. The settings file lives at `~/.config/muse/settings.json` and "must set `"schema_version": 1`" (configuration page). Run `/mcp` in an interactive session for a live inventory; `muse mcp login <server>` and `muse mcp logout <server>` handle OAuth sign-in for remote servers.

Q4 (ACP). Not documented in the pages read. Neither the extending nor the configuration page names an ACP surface.

Q5 (capability gaps). From the extending page: "MCP tools are not sandboxed. Unlike shell commands, an MCP server runs as an ordinary child process (stdio) or a direct network connection, outside the filesystem and network sandbox." A tool whose server declares it read-only runs without an approval prompt under on-request approvals. The agent-tree execution capacity defaults to 8 including the root agent and is set with `agents.execution_capacity` (1 through 64; an unconfigured `ultra` root uses 64).

Validator-tier check of 2026-11-18 (Phase 36, Muse Code 1.4.23, base commit e32bb05, `REALM_LIVE_MUSE=1`, `test/integration/host-live-muse.test.ts`, 1 of 1 passed). The settings entry of `adapters/muse-code/mcp-settings.snippet.json` (command `realm`, args `mcp`) was written into an isolated settings file, with a recorder named `realm` first on `PATH` forwarding to a fake MCP server. Shown: `muse plugins validate` on `adapters/muse-code` prints the valid line; `muse mcp list --json` and `muse mcp get realm --json` print the entry and start nothing; `muse exec --provider echo --trust-workspace` starts the entry through `PATH` with the argument `mcp`, the handshake completes and the six Realm tools are listed; a stub that does not speak MCP makes the same run fail with `failed during startup`; the operator's real settings file is byte-equal before and after. Without `--trust-workspace` Muse did not start the entry (a measurement of the same day, not a test assertion). Named gap: a Muse Code boot against the production stack was not rehearsed (no recipe and no registry record for Muse Code, a 30 s default start timeout; to rehearse after Phase 33), and the validator tier does not run the real `realm`, so it does not show how an unlabelled launcher fares under capability-token enforcement (GAP-34-01 in `docs/integration/host-plugin-gaps.md`).

Phase 40 note (2026-11-18, Muse Code 1.4.23). This supersedes the Q3 spelling and the Phase 36 entry below: `muse mcp add NAME -- COMMAND ARGS` writes `mcpServers.NAME` into the user `settings.json` together with `"schema_version": 1`, and the older `mcp_servers` spelling of the same list is superseded; a file that holds both makes every `muse mcp` command fail with `ambiguous_user_key`. The shipped entry is now `mcpServers.realm` with the arguments `mcp`, `--host`, `muse-code` and `required: true`, and `realm host install muse-code` writes it (adding `schema_version` only to a file it creates, and refusing while an old `mcp_servers` entry is present). The Phase 36 paragraph above is a dated record of the earlier entry and is left as read.

Prime Agent, Phase 40 note (2026-11-18, Prime Agent 0.10.2). Prime Agent has no section of its own on this page (it appears in the tier table above). `prime-agent mcp add NAME -- COMMAND ARGS` writes `mcpServers.NAME = { type: "stdio", command, args }` into `settings.json` of the agent directory (`~/.prime/agent`, or the directory named by `PRIME_AGENT_CODING_AGENT_DIR`), and `prime-agent mcp list` and `prime-agent mcp get realm` print the name and the transport only. `realm host install prime-agent` writes the entry with the launcher `realm mcp --host prime-agent`. Detail is in `docs/hosts/snippets/prime-agent.md`.

## Node requirement recorded for plan 01-03 (D-09)

Recorded value: `"engines": { "node": ">=22" }`.

Basis:

- The only Node version floor stated in the official host pages read is Claude Code's npm route, which requires Node.js 22 or later.
- Hermes ships its own pinned Node and does not use a system Node. Its page gives no numeric version.
- Omp's recommended route requires Bun 1.3.14 or later. Omp does not state a Node requirement.
- Grok Build and Muse Code state no Node requirement.
- The OpenShell TypeScript SDK requires Node.js 20.3 or later (see openshell.md). The value `>=22` satisfies that floor.

Status: the choice of `>=22` is a derived recommendation. No host page says Realm must run on Node 22. [INFERENCE] Node 22 is an LTS line. That status was not checked against nodejs.org in this phase. Bun is not declared in `engines`. Spec n3 leaves Bun unverified, and it stays that way here.

Development requirement, not a runtime one: ESLint 10 needs Node ^22.13 for development tooling only. The `engines` field stays `">=22"` and is not raised.

Decision owner: plan 01-03 and the main agent confirm this value before `package.json` is written.

## Open questions left to later phases

- Omp plugin manifest, lifecycle hooks and status API: gate 4 in omp.md.
- Omp host-write removal in required mode (D-03, OMP-05): whether `--no-tools` covers the built-in write and edit tools. Answered in omp.md, Phase 5.
- MCP protocol version and transport: mcp.md. ACP protocol version and transport: acp.md.
- Claude Code ACP support: not documented in the pages read. The MCP configuration format and the plugin validate and load commands are in `docs/hosts/snippets/claude-code.md` (page read 2026-10-22); the plugin manifest schema is not recorded.
- Grok Build plugin manifest, hook contract and ACP transport: not read in this phase.
- Hermes numeric managed Node.js version: not documented in the page read.
- Muse Code: plugin bundle manifest format and ACP support (not on the pages read 2026-10-22); Node or Bun requirement not stated on those pages.
- Phase 24 (OpenCode, Codex, Kimi): the entry shape for OpenCode V1 versus V2 (OQ-24-02); project-level shadowing of a `realm` server by workload-written host configuration, with OpenCode documenting no trust gate (OQ-24-03); how a running Claude Code session reacts to `~/.claude.json` changing underneath it (OQ-24-04); real MCP start timeouts against a cold first boot of up to 230 s (OQ-24-06); which of `opencode.json` and `opencode.jsonc` wins for a same-named server (OQ-24-07). OQ-24-01 (keep, drop or promote the `kimi-code` row) and OQ-24-05 (whether Codex keeps the owned table byte-identical in versions other than 0.154.0) live in the Kimi and Codex snippets and in [host-plugin-contract.md](host-plugin-contract.md).

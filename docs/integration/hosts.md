# Host runtimes: Node or Bun requirement, plugin, MCP and ACP loading

## Host tiers (v2.0)

Realm ships one integration per host. The tier says how far each one is verified.

| Tier | Meaning | Hosts |
| --- | --- | --- |
| 1: live verified | Run in a real session on the verification host, with the evidence recorded | Omp, for OMP-LIVE-01, OMP-LIVE-03 and OMP-LIVE-04: a live Omp session on the final build, 2026-10-28, showed `realm active` after the attach, the `realm-retry` command reattaching from disconnected in the same session, and the same daemon still running after Omp quit (see `docs/integration/omp.md`). The disconnected status with the daemon's own reason was observed live on 2026-10-23 (OMP-LIVE-02). UI-01's "without blocking the session" is not demonstrated, so the Omp host is not a full pass |
| 2: validator verified | The adapter bundle passes the host's own validator, in an isolated directory. Not registered in the live host configuration | Claude Code and Grok Build (`adapters/claude-plugin`): `claude plugin validate` passes with warnings, `grok plugin validate` passes. Muse Code (`adapters/muse-code`): `muse plugins validate` passes. Hermes Agent (`adapters/hermes-agent`, a portable package): `hermes plugins validate` passes. Prime Agent (`adapters/prime-agent`): no validator subcommand exists; an isolated project-local install and list pass |
| 3: documented only | Snippet from the host's official pages, not run here | none at v2.0 |

Each host has a snippet in `docs/hosts/snippets/`. The snippets reference the
adapter bundles by their repo paths. `realm` is not on `PATH` on the
verification host, so every snippet says so and gives no install path.

Realm was not registered in any live host configuration (Claude Code, Grok
Build, Muse Code, Hermes Agent, Prime Agent, or the persistent Omp config).
Registration needs explicit approval per host.


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

Each URL was reached from the official documentation index or from a link on an official page. None was typed from memory.

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

Q3 (MCP loading). Answer: project MCP configuration loads when a repository is opened. It is excluded for one invocation with `--config <file>` and the YAML key `mcp.enableProjectConfig: false`. The README also says omp reads "MCP servers from `.claude`, `.cursor`, `.windsurf`, `.gemini`, `.codex`, `.cline`, `.github/copilot`, and `.vscode`."

Q4 (ACP). Answer: the README section "ACP: editor-drivable agent" states that omp runs inside Zed as "the same agent you drive from the terminal ... No bridge, no plugin." The ACP transport, version and method list are not documented in the README. Not documented beyond that statement.

Q5 (capability gaps). Built-in write and edit tools: the README says "`--no-tools` disables built-in tools, but project tool modules remain a separate discovery surface." It does not say whether that flag covers the built-in write and edit tools specifically, or how a required mode would enforce it. This is the D-03 host-write question. It stays open for Phase 5 (OMP-05), to be answered in omp.md. Not documented in the README.

## Claude Code

Q1 (Node or Bun). Answer, from the Advanced setup page: the native installer is the recommended route, and it needs no Node runtime. The npm route is documented as follows: "The npm package requires Node.js 22 or later. On an older Node.js version, npm prints an `EBADENGINE` warning during install rather than failing." It also states: "The npm package installs the same native binary as the standalone installer ... The installed `claude` binary does not itself invoke Node." Bun: not documented.

Q2 (plugin loading). Answer, from the Extend Claude Code page: "A plugin bundles skills, hooks, subagents, and MCP servers into a single installable unit," and plugins are distributed through marketplaces. The plugin manifest format is on a linked page (plugins/overview) that was not fetched in this phase: not documented in the pages read.

Q3 (MCP loading). Answer, from the Extend Claude Code page: MCP "connects Claude to external services and tools." MCP servers load "at session start." `/mcp` shows each server's connection status, and remote servers reconnect automatically. The configuration file format is on the MCP reference page, which was not fetched: not documented in the pages read.

Q4 (ACP). Not documented in the pages read.

Q5 (capability gaps). Claude Code's own ACP host behaviour is not documented in the pages read. Hooks run "outside the main conversation" and are the lifecycle surface. The Node floor (22) applies only to the npm install route, not to the native binary.

## Grok Build

Q1 (Node or Bun). Answer: not documented. The overview gives the install command `curl -fsSL https://x.ai/cli/install.sh | bash` (macOS and Linux) and `irm https://x.ai/cli/install.ps1 | iex` (PowerShell). It names no Node or Bun version.

Q2 (plugin loading). Answer, from the Skills, Plugins and Marketplaces page: "Plugins extend Grok with additional skills, agents, hooks, MCP servers, and LSP servers." Grok loads plugins from `./.grok/plugins/`, `~/.grok/plugins/`, marketplace installs under `~/.grok/plugins/marketplaces/`, extra paths under `[plugins] paths` in `~/.grok/config.toml`, and `--plugin-dir <PATH>`. Plugin hooks receive `GROK_PLUGIN_ROOT` and `GROK_PLUGIN_DATA`. The plugin manifest file format is not on the pages read: not documented in the pages read.

Q3 (MCP loading). Answer: MCP servers are loaded from enabled plugins. The page also states that Grok "automatically reads Claude Code marketplaces, plugins, skills, MCPs, agents, hooks, and instruction files." A direct MCP configuration key in `~/.grok/config.toml` is not documented in the pages read.

Q4 (ACP). Answer, from the overview: Grok Build is usable "through the Agent Client Protocol (ACP) in other apps." The ACP transport, version and launch command are not documented in the pages read.

Q5 (capability gaps). `grok inspect` lists "config sources, instructions, skills, plugins, hooks, and MCP servers" for the current directory, which the doctor probe could use. Node requirement: not documented.

## Hermes Agent

Q1 (Node or Bun). Answer, from the installation page: the installer provisions its own runtime. "PM provides pinned Python, Node.js, npm, ripgrep, and FFmpeg." It also states: "Current first-party installations run on **Python 3.14**" and "PM ... does not adopt arbitrary system Node versions as the installed runtime." The source-install prerequisites are "Git, curl, tar, and SHA-256 utilities." The numeric Node.js version pinned by PM is not documented in the page read. Bun: not documented.

Q2 (plugin loading). Answer, from the Plugins page: drop a directory into `~/.hermes/plugins/` containing `plugin.yaml` and Python code. `__init__.py` defines `register(ctx)`, which calls `ctx.register_tool(...)` and `ctx.register_hook(...)`. Project-local plugins under `./.hermes/plugins/` are gated by `HERMES_ENABLE_PROJECT_PLUGINS`, and the gateway "discovers plugins once for the whole process." Plugins are enabled through `hermes plugins` (per the page).

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
- Claude Code plugin manifest, MCP configuration format and ACP support: not read in this phase.
- Grok Build plugin manifest, hook contract and ACP transport: not read in this phase.
- Hermes numeric managed Node.js version: not documented in the page read.
- Muse Code: plugin bundle manifest format and ACP support (not on the pages read 2026-10-22); Node or Bun requirement not stated on those pages.

# Grok Build snippet: Realm MCP server (stdio)

Source: `docs/integration/hosts.md` Grok Build section (read 2026-10-21).
Official page read 2026-10-22:
https://docs.x.ai/build/features/skills-plugins-marketplaces (Skills, Plugins
and Marketplaces).

Realm serves MCP over stdio through its `realm` command with the `mcp`
argument. This snippet carries no token, secret, or host path.

`realm` is not on `PATH` on the verification host. Install or link the `realm`
binary first, or give the absolute path to it in place of `realm` below.

## Plugin bundle (documented route)

The repository ships one bundle for Claude Code and Grok Build:
`adapters/claude-plugin`. The Grok Build page documents loading
plugins from `--plugin-dir <PATH>` and from `./.grok/plugins/` and
`~/.grok/plugins/`. Validate the bundle with the Grok validator (run from
`<repo>`):

```bash
grok plugin validate adapters/claude-plugin
```

Expected result: exit 0 with "Plugin manifest is valid."

Caveat: Grok documents no home-directory variable or flag. Isolated runs
therefore set `HOME=<scratch>` in the environment instead.

Load it for one session without installing it:

```bash
grok --plugin-dir adapters/claude-plugin
```

Installing with `grok plugin install <path>` is a separate step that changes
the user's Grok configuration. It is not part of this snippet.

## Claude Code project configuration

The same page documents that "Grok automatically reads Claude Code
marketplaces, plugins, skills, MCPs, agents, hooks, and instruction files."
The `.mcp.json` `mcpServers` entry in the `claude-code.md` snippet therefore
also reaches Grok. That entry starts the stdio command `realm mcp --host claude` (command `realm`, arguments `mcp`,
`--host`, `claude`). Use it to share Realm with a project.

The shared bundle is labelled `claude`, so the attribution of a Grok Build session that loads it, or that starts the entry the
`claude` recipe wrote into `~/.claude.json`, is `claude` (`GAP-40-01`): a self-declared label, not an identity. For a session
attributed `grok-build`, register the server in Grok's own configuration, not through the shared bundle:

```bash
realm host install grok-build
grok mcp add realm -- realm mcp --host grok-build
```

Either line registers the same table in `~/.grok/config.toml` (the second is the host's own writer; the first is the Realm
installer). A `realm` entry in that file shadows a `claude`-labelled one of the same name. `GAP-34-01` in
`docs/integration/host-plugin-gaps.md` is closed by Phase 40; the opt-out and the migration steps are in Q10 of
`docs/integration/mcp.md`.

To list what Grok sees for the current directory, run `grok inspect`. It
covers "config sources, instructions, skills, plugins, hooks, and MCP servers."

## Existing installs

A session that reads the Claude plugin bundle, or the entry the `claude` recipe wrote into `~/.claude.json`, keeps working and
stays attributed `claude`. To be attributed `grok-build`, run `realm host install grok-build`: the `config.toml` entry shadows the
Claude one of the same name. `realm host uninstall grok-build` removes only the table the install wrote. The table of every case
is in Q10 of `docs/integration/mcp.md`.

## Evidence reached

Tier: `config-only`. The recipe (`toml-table`, file `config.toml` below `~/.grok`, table `mcp_servers.realm`) is proven on fixtures
(`test/host/grok-build-recipe.test.ts`) and observed against Grok Build 1.0.77 (2026-11-18, isolated homes): the owned text is the
table `grok mcp add realm -- realm mcp --host grok-build` writes (a multi-line `args` array and `enabled = true`), so a later
`grok mcp add` or `grok mcp remove` of another server leaves it byte-identical, while the host rewrites a hand-written single-line
`args` array into the multi-line form and drops comments. Grok documents no home-directory variable, so the isolated runs set
`HOME`. `grok mcp list` prints the registered command and starts nothing; `grok mcp doctor` starts it. The shared Claude files
observation: Grok reads `~/.grok/config.toml`, `~/.claude.json` and `.mcp.json`; a `realm` server that only `~/.claude.json`
carries is listed and started with the `claude` label, and when both files carry one the `config.toml` entry is the one listed
(`GAP-40-01`).

The validator tier is the wave 2 entry `grok-build` of `test/integration/host-live-wave2.test.ts` (gate `REALM_LIVE_GROK_BUILD=1`,
executable override `REALM_GROK_BUILD_BIN`): `realm host install grok-build` in an isolated home, then `grok mcp list`, then
`grok mcp doctor` (starts the labelled entry; the stub does not speak MCP, so the host exits 1 after printing its row), then
`grok mcp add` of a second server and `realm host uninstall grok-build`. Validator tier, run on 2026-11-18 (Phase 40)
with Grok Build 1.0.77, as root with isolated homes and a stub `realm` (no production stack):
`REALM_LIVE_GROK_BUILD=1 node --test dist/test/integration/host-live-wave2.test.js` (the other wave 2 hosts stay skipped), the
`grok-build` scenario passed. Shown: the dry run named `config.toml` and wrote nothing; the install wrote the owned table and
`realm host status` said installed; `grok mcp list` printed the registered command with the host flag and started nothing;
`grok mcp doctor` started the entry (the stub recorded exactly `mcp --host grok-build`; the stub does not speak MCP, so the host
exited 1 after printing its row, which the scenario accepts); the host's own `grok mcp add` of a second server left the Realm
table byte-identical (status installed, entry `ok`); uninstall removed only the Realm table; the operator's real `config.toml`
was byte-equal before and after. The result covers Grok Build 1.0.77 on one machine only and is recorded in
`test/support/host-registry.ts`. The three-source observation (`config.toml`, `~/.claude.json`, `.mcp.json`) is not part of
this run: it was made by hand in isolated homes with `grok mcp doctor --json` on the same date (40-CONTEXT E-40-09).

Attribution result of Phase 48 (2026-11-19, Grok Build 1.0.77): the source matrix (plan 48-01, cells a to i, each run twice) shows that with the recipe's `config.toml` entry present the started server carries `grok-build` (cells a, c, d, e, g, h, i), and with the Claude file alone it carries `claude` (cell b); the gated validator step passed 1 of 1 the same day (`test/integration/host-live-wave2.test.ts`). The live both-files attach never reached the host (same install failure as the production tier), and the Claude-alone control named presence `claude` but wrote no attach audit line (the cold doctor left in 1595 ms). The first source winning by name is an observation of version 1.0.77 and the documented order of that version, not a guarantee for later versions. The verified workaround is `realm host install grok-build` (cells a and c). The Claude vendor switch (`[compat.claude] mcps = false`, or the environment variable `GROK_CLAUDE_MCPS_ENABLED`) exists but does not stop the Claude file being loaded on 1.0.77, so it is not a working workaround and the recipe does not set it (OD-48-4). `adapters/claude-plugin` stays labelled `claude`.

Not shown: a Grok Build boot against the production stack (the production tier of 2026-11-19 failed at `realm host install grok-build --dry-run` with `config-home-missing`, catalogue `POLICY_DENIED`, before the host command ran; the harness fix, to create the grok config home in `productionOverrides`, is carried as `GAP-48-03` and the tier stays `config-only`), and a model-driven tool call (`GAP-48-01`).

## Not documented

A documented direct MCP server key in `~/.grok/config.toml`: the 2026-10-22 page read found none. Phase 40 observed the host's own
writer instead (`grok mcp add` writes a `[mcp_servers.NAME]` table into that file, 1.0.77, 2026-11-18), and the `grok-build` recipe
owns exactly that table. ACP transport and launch command: not documented in the pages read, so this snippet gives no ACP
configuration.

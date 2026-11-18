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

## Not documented

A documented direct MCP server key in `~/.grok/config.toml`: the 2026-10-22 page read found none. Phase 40 observed the host's own
writer instead (`grok mcp add` writes a `[mcp_servers.NAME]` table into that file, 1.0.77, 2026-11-18), and the `grok-build` recipe
owns exactly that table. ACP transport and launch command: not documented in the pages read, so this snippet gives no ACP
configuration.

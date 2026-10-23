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
also reaches Grok. That entry starts the stdio command `realm mcp` (command
`realm`, argument `mcp`). Use it to share Realm with a project.

To list what Grok sees for the current directory, run `grok inspect`. It
covers "config sources, instructions, skills, plugins, hooks, and MCP servers."

## Not documented

A direct MCP server key in `~/.grok/config.toml`: not documented in the pages
read, so this snippet gives no `~/.grok/config.toml` MCP block. ACP transport
and launch command: not documented in the pages read, so this snippet gives no
ACP configuration.

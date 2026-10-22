# Grok Build snippet: Realm MCP server (stdio)

Source: `docs/integration/hosts.md` Grok Build section (read 2026-10-21).
Official page read 2026-10-22:
https://docs.x.ai/build/features/skills-plugins-marketplaces (Skills, Plugins
and Marketplaces).

Realm serves MCP over stdio via the `realm mcp` command (P6-D9; the entry
plan 06-04 builds). This snippet carries no token, secret, or host path.

## Documented path: Claude Code compatibility

A direct MCP configuration key in `~/.grok/config.toml` is not documented in
the pages read, so this snippet gives no `~/.grok/config.toml` MCP block.

What the page documents instead: "Grok automatically reads Claude Code
marketplaces, plugins, skills, MCPs, agents, hooks, and instruction files."
No extra setup is needed. Consume Realm by adding it to the Claude Code
project configuration (the `.mcp.json` `mcpServers` entry in the
`claude-code.md` snippet beside this one); Grok reads that entry alongside
`~/.grok/`. List what Grok sees with `grok inspect`, which covers "config
sources, instructions, skills, plugins, hooks, and MCP servers" for the
current directory.

The plugin route is also documented: "Plugins extend Grok with additional
skills, agents, hooks, MCP servers, and LSP servers," loaded from
`./.grok/plugins/`, `~/.grok/plugins/`, marketplace installs under
`~/.grok/plugins/marketplaces/`, extra paths under `[plugins] paths` in
`~/.grok/config.toml`, and `--plugin-dir <PATH>`.

## Not documented

A direct MCP server key in `~/.grok/config.toml`: not documented in the
pages read. The plugin manifest file format: not documented in the pages
read. ACP transport and launch command: not documented in the pages read, so
this snippet gives no ACP configuration.

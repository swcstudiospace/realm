# Claude Code snippet: Realm MCP server (stdio)

Source: `docs/integration/hosts.md` Claude Code section (read 2026-10-21).
Official page read 2026-10-22: https://code.claude.com/docs/en/mcp.md
(MCP reference; reached from the code.claude.com documentation index).

Realm serves MCP over stdio via the `realm mcp` command (P6-D9; the entry
plan 06-04 builds). This snippet carries no token, secret, or host path.

## Add the server

Stdio servers run as local processes. The documented add form is
`claude mcp add [options] <name> -- <command> [args...]`, where the `--`
double dash separates Claude's own options from the server command:

```bash
claude mcp add realm -- realm mcp
```

Each command writes to local scope unless `--scope project` or
`--scope user` is added. Check the connection with `claude mcp get realm`,
or `/mcp` inside a session.

## Project-shared form

To share the server with a team, add the entry under `mcpServers` in
`.mcp.json` at the project root and commit it. An entry with no `type` is
read as a stdio server:

```json
{
  "mcpServers": {
    "realm": {
      "command": "realm",
      "args": ["mcp"]
    }
  }
}
```

A project-scoped `.mcp.json` server shows "Pending approval" until it is approved by running `claude` interactively.

## Not documented

ACP: not documented in the pages read. The MCP reference page names no ACP
surface, so this snippet gives no ACP configuration.

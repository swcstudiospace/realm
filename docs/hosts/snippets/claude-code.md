# Claude Code snippet: Realm MCP server (stdio)

Source: `docs/integration/hosts.md` Claude Code section (read 2026-10-21).
Official page read 2026-10-22: https://code.claude.com/docs/en/mcp.md

Realm serves MCP over stdio through its `realm` command with the `mcp` argument.
This snippet carries no token, secret, or host path.

`realm` is not on `PATH` on the verification host. Install or link the `realm`
binary first, or give the absolute path to it in place of `realm` below.

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

## Plugin bundle

The repository ships a Claude Code plugin bundle at `adapters/claude-plugin`,
which Grok Build shares. Validate it offline with the Claude Code validator
(run from `<repo>`; it does not start a session):

```bash
claude plugin validate adapters/claude-plugin
```

Expected result: exit 0 with "Validation passed with warnings". The warnings
are that the bundle has no author and no plugin icon (ICON_MISSING).

Loading the bundle for one session does not change any live Claude Code
configuration:

```bash
claude --plugin-dir adapters/claude-plugin
```

Installing it with `claude plugin install` is a separate step and is not part
of this snippet.

## Not documented

ACP: not documented in the pages read. The MCP reference page names no ACP
surface, so this snippet gives no ACP configuration.

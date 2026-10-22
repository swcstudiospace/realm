# Muse Code snippet: Realm MCP server (stdio)

Source: `docs/integration/hosts.md` Muse Code section (read 2026-10-22).
Official pages: https://dev.meta.ai/docs/muse-code,
https://dev.meta.ai/docs/muse-code/extending,
https://dev.meta.ai/docs/muse-code/configuration.

Realm serves MCP over stdio via the `realm mcp` command (P6-D9; the entry
plan 06-04 builds). This snippet carries no token, secret, or host path.

## Settings file

User settings live at `~/.config/muse/settings.json`. The file must set
`"schema_version": 1`; a file that omits that key fails every command at
startup. Declare servers in the `mcp_servers` block. Each server takes a
`transport`: either `stdio` (with `command`, `args`, and `env`) or
`streamable_http` (with `url` and `headers`). Every server also takes
`enabled` and `mode`. A server's `mode` defaults to `required`: if a required
server fails to start, the whole run aborts.

Add this entry inside the top-level object of `~/.config/muse/settings.json`:

```json
{
  "schema_version": 1,
  "mcp_servers": {
    "realm": {
      "transport": "stdio",
      "command": "realm",
      "args": ["mcp"],
      "enabled": true,
      "mode": "required"
    }
  }
}
```

Server configs support `${VAR}` environment-variable interpolation, and Muse
Code passes `MUSE_SESSION_ID` to `stdio` servers. Run `/mcp` in an
interactive session to see a live inventory of connected servers and their
tools.

## Not documented

ACP: not documented in the pages read. Neither the extending nor the
configuration page names an ACP surface, so this snippet gives no ACP
configuration. The plugin bundle manifest format is likewise not on the pages
read.

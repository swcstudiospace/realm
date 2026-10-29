# Muse Code snippet: Realm MCP server (stdio)

Source: `docs/integration/hosts.md` Muse Code section (read 2026-10-22).
Official pages: https://dev.meta.ai/docs/muse-code,
https://dev.meta.ai/docs/muse-code/extending,
https://dev.meta.ai/docs/muse-code/configuration.

Realm serves MCP over stdio through its `realm` command with the `mcp`
argument. This snippet carries no token, secret, or host path.

`realm` is not on `PATH` on the verification host. Install or link the `realm`
binary first, or give the absolute path to it in place of `realm` below.

## Settings file

User settings live at `~/.config/muse/settings.json`. The file must set
`"schema_version": 1`; a file that omits that key fails every command at
startup. Declare servers in the `mcp_servers` block. Each server takes a
`transport`: either `stdio` (with `command`, `args`, and `env`) or
`streamable_http` (with `url` and `headers`). Every server also takes
`enabled` and `mode`. A server's `mode` defaults to `required`: if a required
server fails to start, the whole run aborts.

Add this entry inside the top-level object of `~/.config/muse/settings.json`.
It is a snippet to merge by hand, not a file to copy over an existing one. The
same entry is kept in `adapters/muse-code/mcp-settings.snippet.json`:

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

## Plugin bundle

The repository ships a Muse Code plugin bundle at `adapters/muse-code`
(manifest `.muse-plugin/plugin.json`, which declares `schemaVersion` 1 and
`compat` source `native`). Validate it offline (run from `<repo>`). Plugin
commands need the experimental flag, so set it explicitly:

```bash
MUSE_EXPERIMENTAL_PLUGINS=1 muse plugins validate adapters/muse-code
```

Expected result: exit 0 and the line
`valid realm native skills=0 commands=0 hooks=0 mcp=0 reminders=0 diagnostics=0`.

The MCP server is not carried by the plugin. Merge the `realm` entry above into
settings by hand.

Installing the bundle with `muse plugins install` and approving its hooks with
`muse plugins approve` change the user's Muse Code configuration. They are not
part of this snippet.

## Not documented

ACP: not documented in the pages read. Neither the extending nor the
configuration page names an ACP surface, so this snippet gives no ACP
configuration.

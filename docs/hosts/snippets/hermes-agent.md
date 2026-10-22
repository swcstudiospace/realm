# Hermes Agent snippet: Realm MCP server (stdio)

Source: `docs/integration/hosts.md` Hermes Agent section (read 2026-10-21).
Official page read 2026-10-22:
https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp (MCP
configuration).

Realm serves MCP over stdio via the `realm mcp` command (P6-D9; the entry
plan 06-04 builds). This snippet carries no token, secret, or host path.

## Configuration file

MCP servers are declared under `mcp_servers` in `~/.hermes/config.yaml`.
"Local stdio servers and remote HTTP MCP servers" are supported "in the same
config", with "automatic tool discovery and registration at startup". MCP
support ships with the standard install; no extra step is needed. Add this
entry, then start Hermes with `hermes chat`:

```yaml
mcp_servers:
  realm:
    command: "realm"
    args: ["mcp"]
```

This mirrors the page's minimal stdio example, which uses `command`, `args`,
and `env` for a local subprocess server. No `env` is needed here: the Realm
entry takes no token. Per-server tool filtering (`tools.include` /
`tools.exclude`) is available on the same page when only part of the Realm
tool surface should be exposed.

## Not documented

ACP as a way to consume an MCP server: not documented in the pages read.
The page documents `hermes acp` only for running Hermes itself as an ACP
server, so this snippet gives no ACP configuration.

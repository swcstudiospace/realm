# Hermes Agent snippet: Realm MCP server (stdio)

Source: `docs/integration/hosts.md` Hermes Agent section (read 2026-10-21).
Official page read 2026-10-22:
https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp (MCP
configuration).

Realm serves MCP over stdio through its `realm` command with the `mcp`
argument. This snippet carries no token, secret, or host path.

`realm` is not on `PATH` on the verification host. Install or link the `realm`
binary first, or give the absolute path to it in place of `realm` below.

## Configuration file

MCP servers are declared under `mcp_servers` in `~/.hermes/config.yaml`.
"Local stdio servers and remote HTTP MCP servers" are supported "in the same
config", with "automatic tool discovery and registration at startup". Add this
entry, then start Hermes with `hermes chat`:

```yaml
mcp_servers:
  realm:
    command: "realm"
    args: ["mcp"]
```

This mirrors the page's minimal stdio example, which uses `command` and
`args` for a local subprocess server. No `env` is needed: the Realm entry takes
no token. Per-server tool filtering (`tools.include` / `tools.exclude`) is
available on the same page when only part of the Realm tool surface should be
exposed.

## Plugin bundle

The repository ships a Hermes Agent Plugins v1 (portable) bundle at
`adapters/hermes-agent`. It has `plugin.json` (name `realm`, trust
`untrusted`) and `mcp.json` (stdio server `realm`, command `realm`, args
`["mcp"]`). It has no Python code. The native `plugin.yaml` is not part of the
bundle.

Validate it with the Hermes validator, using an isolated `HERMES_HOME` (run
from `<repo>`):

```bash
env HERMES_HOME=<scratch> hermes plugins validate adapters/hermes-agent
```

Expected result: exit 0 with "Validation passed." and an isolation line that
reads "portable plugin (no Python)".

Installing the bundle into `~/.hermes/plugins` changes the user's Hermes
configuration and is not part of this snippet. Hosts configured by hand can
use `adapters/hermes-agent/mcp.snippet.yaml`, the manual `mcp_servers` form
shown above.

## Not documented

ACP as a way to consume an MCP server: not documented in the pages read. The
page documents `hermes acp` only for running Hermes itself as an ACP server, so
this snippet gives no ACP configuration.

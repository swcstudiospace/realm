# Prime Agent snippet: Realm MCP server (stdio) and skill package

Source: `docs/integration/hosts.md` Prime Agent section. The MCP and settings
formats here are medium confidence, read from the Prime Agent sources. The
package format and install check were verified on 2026-10-23.

Realm serves MCP over stdio through its `realm` command with the `mcp`
argument. This snippet carries no token, secret, or host path.

`realm` is not on `PATH` on the verification host. Install or link the `realm`
binary first, or give the absolute path to it in place of `realm` below.

## Add the MCP server

The documented form is `prime-agent mcp add <name> [--cwd] [--env CHILD=SOURCE] -- <command> [args]`:

```bash
prime-agent mcp add realm -- realm mcp
```

This writes the `mcpServers` block of the Prime Agent `settings.json` (medium
confidence). To test without touching the live configuration, run it from a
scratch project directory with the project-local form in the next section.

## Skill package

The repository ships a Prime Agent package at `adapters/prime-agent`. The
binary is `prime-agent`. Install it into a scratch project with `--local`, so
nothing under the live Prime Agent directory changes (run from `<repo>`):

```bash
cd <scratch> && prime-agent package install <repo>/adapters/prime-agent --local
```

Expected result: prints `Installed <path>` and exits 0. `--local` writes
`<scratch>/.prime/agent/settings.json`. Confirm it with:

```bash
cd <scratch> && prime-agent package list
```

Expected result: the package is listed under "Project packages".

Installing without `--local` writes to the live Prime Agent directory. That is
a separate step and is not part of this snippet.

## Not documented

Prime Agent hooks: none observed in the sources read. Prime Agent ACP: not
documented in the sources read, so this snippet gives no ACP configuration.

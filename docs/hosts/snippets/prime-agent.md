# Prime Agent snippet: Realm MCP server (stdio) and skill package

Source: `docs/integration/hosts.md` Prime Agent section. The Prime Agent home
directory is set per host; the settings and package formats here are medium confidence, read from the Prime Agent sources.

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
confidence). To test without touching the live configuration, point
`PRIME_AGENT_CODING_AGENT_DIR` at a scratch directory first.

## Skill package

The repository ships a Prime Agent package at `adapters/prime-agent`
(`package.json` with a `pi.skills` entry and a `SKILL.md`). Install it from a
local path with the package command:

```bash
prime-agent package install adapters/prime-agent
```

Run that install against an isolated `PRIME_AGENT_CODING_AGENT_DIR`. Installing
into the live Prime Agent directory is a separate step and is not part of this
snippet.

## Not documented

Prime Agent hooks: none observed in the sources read. Prime Agent ACP: not
documented in the sources read, so this snippet gives no ACP configuration.

---
name: realm
description: Use the Realm agent sandbox through its MCP server (realm mcp) when file mutations or agent execution must run inside the Realm sandbox.
---

# Realm

Realm runs agent execution and file mutations inside a locked-down sandbox and
serves them over MCP. Its MCP server starts with `realm mcp` over stdio.

## Before use

- Confirm the Realm MCP server is attached: list the MCP tools and check that the
  Realm server appears. Setup is in `MCP.md` in this bundle.
- `realm` must be on `PATH` for the server to start. If it is not, use the
  absolute path to the `realm` binary in the server command.
- Realm is fail-closed: a file mutation either lands inside the realm under
  policy or fails. Report a failure as a failure; do not retry it by writing
  outside the realm.

## Checking the sandbox

- `realm status` reports whether the workspace is attached to the shared daemon.
- Use the MCP tools the server lists in `tools/list` for sandboxed work. Do not
  assume a tool name that the server did not list.

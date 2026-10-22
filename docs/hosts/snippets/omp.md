# Omp snippet: Realm MCP server (stdio)

Source: `docs/integration/omp.md` Q1 (read 2026-10-21; verified 2026-10-22).
Official pages: https://omp.sh/docs/extension-authoring,
https://omp.sh/docs/marketplace.

Realm serves MCP over stdio via the `realm mcp` command (P6-D9; the entry
plan 06-04 builds). This snippet carries no token, secret, or host path.

## Documented placement

From omp.md Q1: a manifest `mcpServers` entry replaces the default
`.mcp.json`. The plugin tree uses `.omp-plugin/plugin.json` read first, then
`.claude-plugin/plugin.json`; a root `plugin.json` using the Agent Plugins
1.0.0 schema uses the portable provider with skills and `mcp.json`.
`${PLUGIN_ROOT}` and `${PLUGIN_DATA}` are expanded in portable plugin MCP
config.

Point the manifest `mcpServers` entry for the Realm server at the Realm stdio
entry: the `realm mcp` command.

## Not documented

The exact stdio key layout inside the manifest `mcpServers` entry (key names
for the launch command and its arguments) was not verified in the pages read.
Manifest validation details beyond the Q1 fields "were not verified in this
phase" (omp.md Q1). Do not guess key names here; confirm them against the Omp
reference when the plugin is written.

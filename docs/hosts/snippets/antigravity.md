# Antigravity snippet: Realm MCP server (stdio), documented-only

This snippet carries no token, secret, or host path. Placeholders: `<home>` is the user's home directory,
`<config home>` is the Antigravity configuration directory, `<tmp>` a throwaway directory.

`realm host install antigravity` registers `realm mcp --host antigravity` in Antigravity's global MCP file. **This recipe
is documented-only:** `agy` (the Antigravity CLI) was never installed, run or observed, because it needs a Google
sign-in and its installer is a third-party-reported script. The file and the entry shape come from three official
Google pages that agree; nothing was observed writing or reading them. Antigravity is a config-only host: Realm edits one
entry in that file and does not run Antigravity. The sections below say what it changes and how far each claim is proven
(tiers T1 and T2 are defined under "Evidence reached"; no wave 2 host has a T3 tier).

## Sources and dates

All read on 2026-11-17. Nothing here was observed on a running host.

- https://antigravity.google/docs/mcp/, https://antigravity.google/docs/cli/gcli-migration and
  https://antigravity.google/docs/settings agree: the global MCP file for the App, the IDE and the CLI (`agy`) is
  `~/.gemini/config/mcp_config.json` (the IDE page: "View raw config ... located globally at
  ~/.gemini/config/mcp_config.json"), and the workspace file is `.agents/mcp_config.json`. The file is plain JSON and
  MCP-only (settings live in `~/.gemini/antigravity-cli/settings.json`). The quoted shape is
  `{"mcpServers": {"sqlite-explorer": {"command": "node", "args": ["/usr/local/bin/sqlite-mcp-server.js"], "env": {...}}}}`;
  each entry needs exactly one transport property (`command`, or `serverUrl` or `url`); **no `type` field is
  documented**; no relocation variable is documented. Tier: documented.
- **The evidence conflicts with GSD Core.** GSD Core's installer source (branch `next`, read 2026-11-17) registers its own
  companion server for Antigravity at `~/.gemini/antigravity/mcp_config.json` and its source comment calls that a
  "BEST-EFFORT PATH CHOICE"; Google's three pages name `~/.gemini/config/mcp_config.json`. Two older third-party vendor
  guides name `~/.gemini/antigravity-cli/mcp_config.json` and `~/.gemini/antigravity/mcp_config.json`. Realm follows
  Google's pages; if the host reads another path, the install succeeds and changes nothing the host reads.
- `agy mcp add|list|enable|disable|remove` and `/mcp` exist: `/mcp` is documented, the commands come from a third-party
  summary and were not exercised.

## Install with realm host

```bash
realm host install antigravity --dry-run
realm host install antigravity
realm host status antigravity
realm host uninstall antigravity
```

Each command prints one JSON line. `install` and `uninstall` print `{ id, status, dryRun, actions }` with `status` one
of `planned`, `installed`, `noop` or `removed` and each action `{ path, action, bytes }` (`path` relative to the config
home, no content). `status` prints `{ id, status, entries, launch }`: each entry is a path and one of `ok`, `drifted`
(the file parses and the owned entry differs or is absent), `missing` (the recorded file is gone) or `unreadable` (a
symlink, a file over 1 MiB, invalid UTF-8, or JSON that does not parse, which includes JSON with comments); `launch` is
`on-path` or `not-on-path` and says whether `realm` resolves on the `PATH` that `realm host status` sees, which is not
necessarily Antigravity's own.

`--config-home <abs>` names the directory that holds `mcp_config.json`, skips detection, and must exist: Realm never
creates a host home. Antigravity is detected by `~/.gemini/config` or by `agy` on an absolute `PATH` directory. A bare
`~/.gemini` (the retired Gemini CLI's home) is not a detection signal: with only `~/.gemini` present install is refused
as `not-detected`; with only `~/.gemini` and `agy` on `PATH` the host is detected and install is refused as
`config-home-missing` (create `~/.gemini/config` or pass `--config-home`). There is no override variable. Install with no
Antigravity session open (residual R-25-02).

## What changes

One file: `<config home>/mcp_config.json`, by default `<home>/.gemini/config/mcp_config.json`. Realm merges one entry at
`mcpServers.realm` with no `type` key (T1 golden; the documented shape):

```json
{
  "mcpServers": {
    "realm": {
      "command": "realm",
      "args": [
        "mcp",
        "--host",
        "antigravity"
      ]
    }
  }
}
```

Every other key, the indent, the line endings, the trailing newline and the file mode are preserved; a missing file is
created (mode 0600). The command is the bare `realm`, resolved on Antigravity's `PATH`; nothing absolute is written. What
Antigravity does to the file when it rewrites it was not observed; the GUI (Customizations, MCP Store) also edits this
file [INFERENCE]. The workspace file `.agents/mcp_config.json` and `~/.gemini/antigravity-cli/settings.json` are never
touched.

## Manual registration and the host's own tools

There is no verified command: edit the file by hand from the fence above, or use the GUI. `agy mcp add` is reported by a
third-party summary only and was not exercised. If an identical `mcpServers.realm` entry exists,
`realm host install antigravity` is a no-op that Realm does not own. A different `realm` entry is refused as
`foreign-content`. If the entry Realm owns is deleted or edited, `realm host status antigravity` reports `drifted`, and
`realm host uninstall antigravity` removes only what Realm still owns (a clean no-op when nothing remains).

## Refusals and recovery

- An `mcp_config.json` with comments or a trailing comma is refused as `unparseable` and nothing is written (`status`
  says `unreadable`). Realm's JSON engine is strict. Move the comments out, or put the entry in by hand.
- A file over 1 MiB, invalid UTF-8, or a symlink on the path is refused. A change while the command runs is
  `concurrent-change`: run it again.
- A drifted entry makes `realm host uninstall antigravity` refuse rather than guess: edit `mcpServers.realm` back to the
  fence above or delete it, then uninstall.

## Project-level configuration and shadowing

Antigravity reads a workspace `.agents/mcp_config.json`. No trust or approval gate is documented in the pages read. A
workload can write that file into the workspace. **Never approve or trust a `realm` server defined in a repository.**
Realm writes and reads no project-level configuration, and the sandbox mount does not hide these names (accepted
residual R-25-01; hiding them is a Phase 19 decision).

## Evidence reached

| Tier | Claim | Result |
| --- | --- | --- |
| T1 offline fixture | the recipe on a fixture host in a temporary home: detect (a bare `~/.gemini` not detecting, `~/.gemini/config` detecting, the `agy`-only case), dry-run, install writing no `type` key, no-op reinstall, drift, foreign content, a commented file refused, hostile content, uninstall, doctor, `realm host status` | covered by the offline tests (`test/host/wave2-json-recipes.test.ts`, `test/host/wave2-json-specifics.test.ts`) |
| T2 host validator | none: no validator was observed (`agy mcp list` comes from a third-party summary) | not defined; there is no live file for Antigravity |
| T3 live end to end | not defined for config-only hosts | none |

**Documented-only:** `agy` was never run. Google's three pages agree on the path; GSD's own path differs. Not shown by any
tier: that Antigravity reads this file, accepts the entry without a `type`, or starts Realm; Antigravity's MCP start
timeout against a cold first boot of up to 230 s (OQ-24-06, carried). The owner may defer this host instead (open
question OQ-25-04).

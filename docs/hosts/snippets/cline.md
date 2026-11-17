# Cline snippet: Realm MCP server (stdio), Cline CLI only

This snippet carries no token, secret, or host path. Placeholders: `<home>` is the user's home directory,
`<config home>` is the Cline directory, `<tmp>` a throwaway directory.

`realm host install cline` registers `realm mcp --host cline` in the Cline **CLI**'s MCP settings file. The Cline IDE
extension's MCP file is not documented in anything read, so the recipe does not claim it (open question OQ-25-08).
Cline is a config-only host: Realm edits one entry in that file and does not run Cline. The sections below say what it
changes, what Cline's own commands do about it, and how far each claim is proven (tiers T1 and T2 are defined under
"Evidence reached"; no wave 2 host has a T3 tier).

## Sources and dates

All read or observed on 2026-11-17.

- https://docs.cline.bot/mcp/mcp-overview.md and https://docs.cline.bot/getting-started/config.md: the CLI reads
  `~/.cline/data/settings/cline_mcp_settings.json`; `CLINE_MCP_SETTINGS_PATH` overrides the file, `CLINE_DATA_DIR`
  replaces `~/.cline/data` and `CLINE_DIR` replaces `~/.cline`; JSON, key `mcpServers`; the example is the flat shape
  `{"command": "node", "args": [...], "env": {...}, "disabled": false, "autoApprove": []}`. No project MCP file is
  documented. Tier: documented.
- Observed with `cline` 3.0.74 (fetched into a scratch directory, run with an isolated `HOME` and `CLINE_DIR`, never
  installed): `cline mcp add realm --yes -- realm mcp --host cline` wrote the file below the `CLINE_DIR` directory in a
  **nested** shape that the documentation does not show (`{"mcpServers":{"realm":{"transport":{"type":"stdio",
  "command":"realm","args":[...]}}}}`); the documented flat shape also parses, and a later `cline mcp add foo` kept a
  hand-written flat entry verbatim; `cline config mcp --json` listed the entry as stdio with no launch and no login.
  How Cline handles comments in the file was not tested.

## Install with realm host

```bash
realm host install cline --dry-run
realm host install cline
realm host status cline
realm host uninstall cline
```

Each command prints one JSON line. `install` and `uninstall` print `{ id, status, dryRun, actions }` with `status` one
of `planned`, `installed`, `noop` or `removed` and each action `{ path, action, bytes }` (`path` relative to the config
home, no content). `status` prints `{ id, status, entries, launch }`: each entry is a path and one of `ok`, `drifted`
(the file parses and the owned entry differs or is absent), `missing` (the recorded file is gone) or `unreadable` (a
symlink, a file over 1 MiB, invalid UTF-8, or JSON that does not parse, which includes JSON with comments); `launch` is
`on-path` or `not-on-path` and says whether `realm` resolves on the `PATH` that `realm host status` sees, which is not
necessarily Cline's own.

`--config-home <abs>` names the Cline directory itself (the one that holds `data/`), skips detection, and must exist:
Realm never creates a host home. Cline is detected by `~/.cline` (or the `CLINE_DIR` directory) or by `cline` on an
absolute `PATH` directory. With `~/.cline` absent and `cline` on `PATH`, install is refused as `config-home-missing` and
creates nothing (with neither, it is `not-detected`). Install with no Cline session open (residual R-25-02).

## What changes

One file: `<config home>/data/settings/cline_mcp_settings.json`, where `<config home>` is the `CLINE_DIR` directory when
set to an absolute path, else `<home>/.cline`. When `data/settings` is missing, install creates it below the config home
(file mode 0600) and records the directories it created; uninstall removes exactly those, once empty, and never the
Cline directory itself. Realm merges one entry at `mcpServers.realm`, the documented flat shape (T1 golden; the shape
parses in cline 3.0.74):

```json
{
  "mcpServers": {
    "realm": {
      "command": "realm",
      "args": [
        "mcp",
        "--host",
        "cline"
      ]
    }
  }
}
```

Every other key, the indent, the line endings, the trailing newline and the file mode are preserved. The command is the
bare `realm`, resolved on Cline's `PATH`; nothing absolute is written. The nested `transport` shape that `cline mcp add`
writes is not used by Realm because it is undocumented. `CLINE_DATA_DIR` and `CLINE_MCP_SETTINGS_PATH` are not honoured
(a documented gap): setting either one moves the file the host reads away from the one Realm edits, so with either set
use `--config-home` for the directory the host really reads, or edit the file by hand.

## Manual registration and the host's own tools

The same entry by hand: `cline mcp add realm --yes -- realm mcp --host cline`. That command writes the nested shape,
which is a **different** value from Realm's: `realm host install cline` then refuses it as `foreign-content` and does not
rewrite it. Either keep the entry the Cline CLI wrote, or delete the `realm` entry from the file (the Cline CLI's own
remover was not exercised) and run the install. An identical flat entry makes the install a no-op that Realm does not
own. If the entry Realm owns is deleted, `realm host status cline` reports `drifted` and `realm host uninstall cline`
is a clean no-op that deletes the receipt. `cline config mcp --json` is the host's own check; it lists the servers and
does not launch them.

## Refusals and recovery

- A settings file with comments or a trailing comma is refused as `unparseable` and nothing is written (`status` says
  `unreadable`). Realm's JSON engine is strict. Move the comments out, or put the entry in by hand.
- A `realm` entry in the nested `transport` shape, or any other different `realm` value, is `foreign-content` (see
  above).
- A file over 1 MiB, invalid UTF-8, or a symlink on the path is refused. A change while the command runs is
  `concurrent-change`: run it again.
- A drifted entry makes `realm host uninstall cline` refuse rather than guess: edit `mcpServers.realm` back to the fence
  above or delete it, then uninstall.

## Project-level configuration and shadowing

No project-level MCP file is documented for the Cline CLI, so no shadowing path is known. The Cline IDE extension is out
of scope. Realm writes and reads no project-level configuration. If a Cline project file is ever documented, **never
approve or trust a `realm` server defined in a repository** (accepted residual R-25-01).

## Evidence reached

| Tier | Claim | Result |
| --- | --- | --- |
| T1 offline fixture | the recipe on a fixture host in a temporary home: detect, dry-run, install creating `data/settings` (mode 0600) with the directories recorded, uninstall removing them but not the Cline directory, `config-home-missing` with `~/.cline` absent, a nested-shape `realm` refused, `CLINE_DIR` moving the tree with `CLINE_DATA_DIR` and `CLINE_MCP_SETTINGS_PATH` changing nothing, a commented file refused, hostile content, doctor, `realm host status` | covered by the offline tests (`test/host/wave2-json-recipes.test.ts`, `test/host/wave2-json-specifics.test.ts`) |
| T2 host validator | `cline config mcp --json` lists the entry as stdio (parse only), in an isolated `HOME` and `CLINE_DIR` | gated (`REALM_LIVE_CLINE=1`, optional `REALM_CLINE_BIN`; `test/integration/host-live-wave2.test.ts`); the gated rehearsal records no result yet. The 3.0.74 observation above was a manual scratch-directory run, not the gated test and not through `realm host install` |
| T3 live end to end | not defined for config-only hosts | none |

Not shown by any tier: that a long-running Cline session starts Realm; Cline's MCP start timeout against a cold first
boot of up to 230 s (OQ-24-06, carried); a Cline newer than 3.0.74 (OQ-25-10). Host-specific gap: Cline CLI only; the IDE
extension's file is not documented.

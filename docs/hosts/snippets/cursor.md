# Cursor snippet: Realm MCP server (stdio)

This snippet carries no token, secret, or host path. Placeholders: `<home>` is the user's home directory,
`<config home>` is the Cursor directory, `<tmp>` a throwaway directory.

`realm host install cursor` registers `realm mcp --host cursor` in Cursor's global MCP file. Cursor is a config-only
host: Realm edits one entry in that file and does not run Cursor. The sections below say what it changes, what Cursor's
own commands do about it, and how far each claim is proven (tiers T1 and T2 are defined under "Evidence reached"; no
wave 2 host has a T3 tier).

## Sources and dates

All read or observed on 2026-11-17.

- https://cursor.com/docs/mcp: the global file is `~/.cursor/mcp.json` and a project file is `.cursor/mcp.json`; JSON,
  key `mcpServers`; the stdio table marks `type` ("stdio") required (the page's code example omits it), `command` is
  required, `args`, `env` and `envFile` are optional. The file is plain and MCP-only; the editor's "Customize" page edits
  the same file. Tier: documented.
- https://cursor.com/docs/cli/reference/configuration: `CURSOR_CONFIG_DIR` and `XDG_CONFIG_HOME` are documented for
  `cli-config.json` only. Whether they relocate `mcp.json` is not documented and was not tested [INFERENCE: treat
  `~/.cursor/mcp.json` as fixed].
- Observed with `cursor-agent` 2026.11.13-eacade1 (fetched from `cursor.com/install` into a scratch directory, run with
  an isolated `HOME`, never installed): `agent mcp list` read `<home>/.cursor/mcp.json` and launched the registered
  command (a stub `realm` on `PATH` recorded `mcp --host cursor`). Its output is an interactive menu and was not
  captured cleanly. The file used in that run was the documented shape, written by hand.

## Install with realm host

```bash
realm host install cursor --dry-run
realm host install cursor
realm host status cursor
realm host uninstall cursor
```

Each command prints one JSON line. `install` and `uninstall` print `{ id, status, dryRun, actions }` with `status` one
of `planned`, `installed`, `noop` or `removed` and each action `{ path, action, bytes }` (`path` relative to the config
home, no content). `status` prints `{ id, status, entries, launch }`: each entry is a path and one of `ok`, `drifted`
(the file parses and the owned entry differs or is absent), `missing` (the recorded file is gone) or `unreadable` (a
symlink, a file over 1 MiB, invalid UTF-8, or JSON that does not parse, which includes JSON with comments); `launch` is
`on-path` or `not-on-path` and says whether `realm` resolves on the `PATH` that `realm host status` sees, which is not
necessarily Cursor's own.

`--config-home <abs>` names the Cursor directory itself (the one that holds `mcp.json`), skips detection, and must
exist: Realm never creates a host home. Cursor has no override variable that Realm honours (`CURSOR_CONFIG_DIR` is a
GSD Core name that Cursor does not read for this file), so `--config-home` is the only way to point at another
directory. Cursor is detected by `~/.cursor` or by `cursor-agent` or `cursor` on an absolute `PATH` directory; a
`cursor` on `PATH` can be only the VS Code remote-cli stub (observed 3.26.13 on the verification machine), so a binary
match alone does not prove Cursor's agent is installed. Install with no Cursor session open (residual R-25-02).

## What changes

One file: `<config home>/mcp.json`, by default `<home>/.cursor/mcp.json`. Realm merges one entry at `mcpServers.realm`
(T1 golden; the shape is the documented one, hand-written, and `agent mcp list` spawned it, see above):

```json
{
  "mcpServers": {
    "realm": {
      "type": "stdio",
      "command": "realm",
      "args": [
        "mcp",
        "--host",
        "cursor"
      ]
    }
  }
}
```

Every other key, the indent, the line endings, the trailing newline and the file mode are preserved; a missing file is
created (mode 0600). `type: "stdio"` is written because the documentation's table marks it required. The command is the
bare `realm`, resolved on Cursor's `PATH`; nothing absolute is written. What Cursor does to this file when it rewrites
it (for example when a server is edited in the editor) was not observed. The project file `.cursor/mcp.json` and
Cursor's `cli-config.json` are never touched.

## Manual registration and the host's own tools

There is no `agent mcp add`: Cursor's commands are `agent mcp list`, `list-tools`, `login`, `enable` and `disable`, so
the entry goes in by hand from the fence above (or through the editor's Customize page). `agent mcp enable` adds a
server to a local approved list; Realm does not write that list. If an identical `mcpServers.realm` entry already
exists, `realm host install cursor` is a no-op that Realm does not own (it is not in the receipt). A different `realm`
entry is refused as `foreign-content`. If the entry is deleted or edited by hand or in the editor, `realm host status
cursor` reports `drifted`, and `realm host uninstall cursor` removes only what Realm still owns (a clean no-op when
nothing remains). No Cursor remover was exercised.

## Refusals and recovery

- An `mcp.json` with comments or a trailing comma is refused as `unparseable` and nothing is written (`status` says
  `unreadable`). Realm's JSON engine is strict. Move the comments out, or put the entry in by hand from the fence above.
- A file over 1 MiB, invalid UTF-8, or a symlink on the path is refused. A change while the command runs is
  `concurrent-change`: run it again.
- A drifted entry makes `realm host uninstall cursor` refuse rather than guess: edit `mcpServers.realm` back to the
  fence above or delete it, then uninstall.

## Project-level configuration and shadowing

Cursor reads a project `.cursor/mcp.json` and merges it with the global file; in the CLI each server needs its own
approval. A workload can write that file into the workspace. **Never approve or trust a `realm` server defined in a
repository.** Realm writes and reads no project-level configuration, and the sandbox mount does not hide these names
(accepted residual R-25-01; hiding them is a Phase 19 decision).

## Evidence reached

| Tier | Claim | Result |
| --- | --- | --- |
| T1 offline fixture | the recipe on a fixture host in a temporary home: detect, dry-run, install, no-op reinstall, drift, foreign content, JSONC refusal, hostile content, uninstall, doctor, `realm host status` | covered by the offline tests (`test/host/wave2-json-recipes.test.ts`, `test/host/wave2-json-specifics.test.ts`) |
| T2 host validator | `agent mcp list` reads the file and launches the registered argv (a stub `realm` on `PATH` records it); the menu output is not asserted | gated (`REALM_LIVE_CURSOR=1`, optional `REALM_CURSOR_BIN`; `test/integration/host-live-wave2.test.ts`); the gated rehearsal records no result yet. The 2026.11.13 observation above was a manual scratch-directory run, not the gated test and not through `realm host install` |
| T3 live end to end | not defined for config-only hosts | none |

Not shown by any tier: that a long-running Cursor session starts Realm; Cursor's MCP start timeout against a cold first
boot of up to 230 s (OQ-24-06, carried); a Cursor newer than the observed one (OQ-25-10). Host-specific gaps: the file
shape is the documented one and the spawn was observed through `agent mcp list`; what Cursor itself writes into the file
was not observed; whether an override variable relocates `mcp.json` is unknown.

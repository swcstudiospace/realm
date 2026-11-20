# GitHub Copilot CLI snippet: Realm MCP server (stdio)

This snippet carries no token, secret, or host path. Placeholders: `<home>` is the user's home directory,
`<config home>` is the Copilot directory, `<tmp>` a throwaway directory.

`realm host install copilot` registers `realm mcp --host copilot` in the Copilot CLI's MCP file. Copilot is a
config-only host: Realm edits one entry in that file and does not run Copilot. The sections below say what it changes,
what Copilot's own commands do about it, and how far each claim is proven (tiers T1 and T2 are defined under "Evidence
reached"; no wave 2 host has a T3 tier).

## Sources and dates

All read or observed on 2026-11-17.

- https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers: the user file is
  `~/.copilot/mcp-config.json`, key `mcpServers`, an entry such as `{"type": "local", "command": "npx", "args": [...],
  "env": {}, "tools": ["*"]}`; `COPILOT_HOME` replaces `~/.copilot`; a project `.mcp.json` or `.github/mcp.json` loads only
  after folder trust and overrides a user entry of the same name. Tier: documented.
- Observed with `@github/copilot` 1.0.112 (fetched into a scratch directory without credentials, run with an isolated
  `HOME` and `COPILOT_HOME`, never installed): `copilot mcp add realm -- realm mcp --host copilot` wrote exactly the
  entry below (key order `tools`, `type`, `command`, `args`, no `env`); `"type": "stdio"` is also accepted;
  `copilot mcp list` and `copilot mcp get realm` need no login and do not launch the server.

## Install with realm host

```bash
realm host install copilot --dry-run
realm host install copilot
realm host status copilot
realm host uninstall copilot
```

Each command prints one JSON line. `install` and `uninstall` print `{ id, status, dryRun, actions }` with `status` one
of `planned`, `installed`, `noop` or `removed` and each action `{ path, action, bytes }` (`path` relative to the config
home, no content). `status` prints `{ id, status, entries, launch }`: each entry is a path and one of `ok`, `drifted`
(the file parses and the owned entry differs or is absent), `missing` (the recorded file is gone) or `unreadable` (a
symlink, a file over 1 MiB, invalid UTF-8, or JSON that does not parse, which includes JSON with comments); `launch` is
`on-path` or `not-on-path` and says whether `realm` resolves on the `PATH` that `realm host status` sees, which is not
necessarily Copilot's own.

`--config-home <abs>` names the Copilot directory itself (the one that holds `mcp-config.json`), skips detection, and
must exist: Realm never creates a host home. Copilot is detected by `~/.copilot` (or the `COPILOT_HOME` directory) or by
`copilot` on an absolute `PATH` directory. Install with no Copilot session open (residual R-25-02).

## What changes

One file: `<config home>/mcp-config.json`, where `<config home>` is the `COPILOT_HOME` directory when set to an absolute
path, else `<home>/.copilot`. Realm merges one entry at `mcpServers.realm`, Copilot's own canonical form (T1 golden; the
bytes `copilot mcp add` wrote, observed in 1.0.112):

```json
{
  "mcpServers": {
    "realm": {
      "tools": [
        "*"
      ],
      "type": "local",
      "command": "realm",
      "args": [
        "mcp",
        "--host",
        "copilot"
      ]
    }
  }
}
```

Every other key, the indent, the line endings, the trailing newline and the file mode are preserved; a missing file is
created (mode 0600). The command is the bare `realm`, resolved on Copilot's `PATH`; nothing absolute is written. Realm
never reads, creates or removes the lock file `mcp-config.json.copilot-mcp.lock` that Copilot keeps beside the file.

What Copilot does to the file when it rewrites it (observed 1.0.112): on any `copilot mcp add` it normalises every
entry, so an entry written without `tools` gains `"tools": ["*"]`; it drops comments and keeps unknown top-level keys.
Realm's value is already the normalised form and ownership is by parsed value, so Copilot's rewrite is not drift.

## Manual registration and the host's own tools

The same entry by hand: `copilot mcp add realm -- realm mcp --host copilot`. If an identical `mcpServers.realm` entry
exists, `realm host install copilot` is a no-op that Realm does not own (it is not in the receipt). A different `realm`
entry is refused as `foreign-content`; for Copilot that includes a hand-written entry without the canonical `tools` key,
which Copilot would itself normalise. Remove it first (`copilot mcp remove realm` or edit the file), then install. If
Copilot's own remover deletes an entry Realm owns, `realm host status copilot` reports `drifted` and `realm host
uninstall copilot` is a clean no-op that deletes the receipt (the remover itself was not exercised here). `copilot mcp
list` and `copilot mcp get realm` are the host's own checks; they parse the file and do not launch the server.

## Refusals and recovery

- An `mcp-config.json` with comments or a trailing comma is refused as `unparseable` and nothing is written (`status`
  says `unreadable`). Realm's JSON engine is strict, although Copilot itself reads a file with `//` comments. Either run
  `copilot mcp add realm -- realm mcp --host copilot` (which rewrites the file and drops the comments) or move the
  comments out and run the install again.
- A file over 1 MiB, invalid UTF-8, or a symlink on the path is refused. A change while the command runs is
  `concurrent-change`: run it again.
- A drifted entry (edited by hand or normalised differently by a newer Copilot, open question OQ-25-10) makes `realm host
  uninstall copilot` refuse rather than guess: edit `mcpServers.realm` back to the fence above or delete it, then
  uninstall.

## Project-level configuration and shadowing

Copilot loads a workspace `.mcp.json` and `.github/mcp.json` after folder trust, and they override a user entry of the
same name. A workload can write these files into the workspace. **Never approve or trust a `realm` server defined in a
repository** (do not trust the folder for this purpose). Realm writes and reads no project-level configuration, and the
sandbox mount does not hide these names (accepted residual R-25-01; hiding them is a Phase 19 decision).

## Evidence reached

| Tier | Claim | Result |
| --- | --- | --- |
| T1 offline fixture | the recipe on a fixture host in a temporary home: detect, dry-run, install, no-op reinstall, drift, foreign content, JSONC refusal, hostile content, Copilot's own rewrite (tools first, `realm` before another server) not being drift, a `realm` entry without `tools` refused, the lock file untouched, `COPILOT_HOME`, uninstall, doctor, `realm host status` | covered by the offline tests (`test/host/wave2-json-recipes.test.ts`, `test/host/wave2-json-specifics.test.ts`) |
| T2 host validator | `copilot mcp get realm` and `copilot mcp list` parse the entry (parse only; Copilot does not launch it), in an isolated `HOME` and `COPILOT_HOME` | gated (`REALM_LIVE_COPILOT=1`, optional `REALM_COPILOT_BIN`; `test/integration/host-live-wave2.test.ts`); the gated rehearsal records no result yet. The 1.0.112 observation above was a manual scratch-directory run, not the gated test and not through `realm host install` |
| T3 live end to end | not defined for config-only hosts | none |

Not shown by any tier: that a long-running Copilot session starts Realm; Copilot's MCP start timeout against a cold
first boot of up to 230 s (OQ-24-06, carried); a Copilot newer than 1.0.112 (OQ-25-10).

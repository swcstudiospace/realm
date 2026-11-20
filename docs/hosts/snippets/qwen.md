# Qwen Code snippet: Realm MCP server (stdio)

This snippet carries no token, secret, or host path. Placeholders: `<home>` is the user's home directory,
`<config home>` is the Qwen Code directory, `<tmp>` a throwaway directory.

`realm host install qwen` registers `realm mcp --host qwen` in Qwen Code's user settings file. Qwen Code is a
config-only host: Realm edits one entry in that file and does not run Qwen Code. The sections below say what it changes,
what Qwen Code's own commands do about it, and how far each claim is proven (tiers T1 and T2 are defined under
"Evidence reached"; no wave 2 host has a T3 tier).

## Sources and dates

All read or observed on 2026-11-17.

- The Qwen Code documentation bundled in the npm package (`lib/bundled/qc-helper/docs/features/mcp.md` and
  `configuration/settings.md`; https://github.com/QwenLM/qwen-code): the user file is `~/.qwen/settings.json`, the key is
  `mcpServers`, a stdio server needs no `type`. Tier: documented and observed.
- Observed with Qwen Code 0.22.0 (the `qwen` on `PATH` of the verification machine, run with an isolated `HOME` and
  `QWEN_HOME`; nothing was installed or registered in the real configuration): `qwen mcp add realm -s user realm mcp
  --host qwen` wrote the entry below; `QWEN_HOME` relocates the directory (`<dir>/settings.json`); `qwen mcp list`
  needs no login and launched the registered command (a stub `realm` on `PATH` recorded `mcp --host qwen`). The newest
  release that day was 0.27.4 (npm, modified 2026-11-16); it was not run.

## Install with realm host

```bash
realm host install qwen --dry-run
realm host install qwen
realm host status qwen
realm host uninstall qwen
```

Each command prints one JSON line. `install` and `uninstall` print `{ id, status, dryRun, actions }` with `status` one
of `planned`, `installed`, `noop` or `removed` and each action `{ path, action, bytes }` (`path` relative to the config
home, no content). `status` prints `{ id, status, entries, launch }`: each entry is a path and one of `ok`, `drifted`
(the file parses and the owned entry differs or is absent), `missing` (the recorded file is gone) or `unreadable` (a
symlink, a file over 1 MiB, invalid UTF-8, or JSON that does not parse, which includes JSON with comments); `launch` is
`on-path` or `not-on-path` and says whether `realm` resolves on the `PATH` that `realm host status` sees, which is not
necessarily Qwen Code's own.

`--config-home <abs>` names the Qwen Code directory itself (the one that holds `settings.json`), skips detection, and
must exist: Realm never creates a host home. Qwen Code is detected by `~/.qwen` (or the `QWEN_HOME` directory) or by
`qwen` on an absolute `PATH` directory. Install with no Qwen Code session open: a change between Realm's last check and
its rename is refused as `concurrent-change`, but the window after that check cannot be closed (residual R-25-02).

## What changes

One file: `<config home>/settings.json`, where `<config home>` is the `QWEN_HOME` directory when `QWEN_HOME` is set to
an absolute path, else `<home>/.qwen`. The file is Qwen Code's whole settings file, not an MCP-only file. Realm merges
one entry at `mcpServers.realm` (T1 golden, the bytes `qwen mcp add -s user` wrote, observed in 0.22.0):

```json
{
  "mcpServers": {
    "realm": {
      "command": "realm",
      "args": [
        "mcp",
        "--host",
        "qwen"
      ]
    }
  }
}
```

Every other key, the indent, the line endings, the trailing newline (or its absence) and the file mode are preserved; a
missing file is created (mode 0600). No `type` is written because Qwen Code documents none for stdio. The command is the
bare `realm`, resolved on Qwen Code's `PATH`; nothing absolute is written. Realm parses the file in memory and its
receipt, audit and log lines carry only the host id, relative paths, byte counts and hashes, never a value from the
file (the file may hold other settings that are private).

What Qwen Code does to the file when it rewrites it (observed 0.22.0): `qwen mcp add foo` on a file with comments, a
`theme` key and `mcpServers` stripped the comments, moved `theme` to `ui.theme` and appended `"$version": 4`; the
existing `realm` entry survived with the same value. Ownership is by parsed value, so none of this is drift. Only
`QWEN_HOME` moves the file.

## Manual registration and the host's own tools

The same entry by hand: `qwen mcp add realm -s user realm mcp --host qwen`. If an identical `mcpServers.realm` entry
already exists (added by hand or by that command), `realm host install qwen` is a no-op that Realm does not own (it is
not in the receipt, so `realm host uninstall qwen` leaves it). A different `realm` entry is refused as
`foreign-content`; remove it first with `qwen mcp remove realm -s user` or by editing the file, then install. If Qwen
Code's own remover deletes an entry Realm owns, `realm host status qwen` reports `drifted` and `realm host uninstall
qwen` is a clean no-op that deletes the receipt (the remover itself was not exercised here).
`qwen mcp list` is the host's own check: it needs no login and launches each configured server.

## Refusals and recovery

- A `settings.json` with `//` comments or a trailing comma is refused as `unparseable` and nothing is written
  (`status` says `unreadable`). Realm's JSON engine is strict. Qwen Code strips comments itself the first time it
  rewrites the file, so either let `qwen mcp add realm -s user realm mcp --host qwen` do the edit or move the comments
  out and run the install again.
- A file over 1 MiB, invalid UTF-8, or a symlink on the path is refused. A change while the command runs is
  `concurrent-change`: run it again.
- A drifted entry (edited by hand, or normalised by a newer Qwen Code than 0.22.0, which is open question OQ-25-10) makes
  `realm host uninstall qwen` refuse rather than guess. Fix it by editing `mcpServers.realm` back to the fence above or
  deleting it, then run `realm host uninstall qwen`.

## Project-level configuration and shadowing

Qwen Code reads a project `.qwen/settings.json`. Observed 0.22.0: a project entry named `realm` replaced the user
entry and the host showed "Pending approval" (`qwen mcp approve`). A workload can write that file into the workspace.
**Never approve or trust a `realm` server defined in a repository.** Realm writes and reads no project-level
configuration, and the sandbox mount does not hide these names; a hidden or read-only overlay is a Phase 19 decision
(accepted residual R-25-01).

## Evidence reached

| Tier | Claim | Result |
| --- | --- | --- |
| T1 offline fixture | the recipe on a fixture host in a temporary home: detect, dry-run, install, no-op reinstall, drift, foreign content, JSONC refusal, hostile content, a migrated settings file (`ui.theme`, `$version`) keeping every other key and the missing trailing newline, `QWEN_HOME`, uninstall, doctor, `realm host status` | covered by the offline tests (`test/host/wave2-json-recipes.test.ts`, `test/host/wave2-json-specifics.test.ts`) |
| T2 host validator | `qwen mcp list` parses the entry and launches the registered argv (a stub `realm` on `PATH` records it), in an isolated `HOME` and `QWEN_HOME` | gated (`REALM_LIVE_QWEN=1`, optional `REALM_QWEN_BIN`; `test/integration/host-live-wave2.test.ts`); **ran live on 2026-11-17 with Qwen Code 0.22.0: PASS** (the real recipe installs into an isolated home, Qwen Code's own commands parse it, uninstall removes only what install created; evidence kept outside the repository, 0.22.0 only). The earlier 0.22.0 observation above was a manual run in an isolated home, not the gated test and not through `realm host install` |
| T3 live end to end | not defined for config-only hosts | none |

Not shown by any tier: that a long-running Qwen Code session starts Realm; that Qwen Code's MCP start timeout outlasts a
cold first boot of up to 230 s (OQ-24-06, carried); that a Qwen Code newer than 0.22.0 leaves the entry unchanged
(OQ-25-10).

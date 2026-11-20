# Augment Code (Auggie CLI) snippet: Realm MCP server (stdio)

This snippet carries no token, secret, or host path. Placeholders: `<home>` is the user's home directory,
`<config home>` is the Augment directory, `<tmp>` a throwaway directory.

`realm host install augment` registers `realm mcp --host augment` in the Auggie CLI's user settings file. Augment is a
config-only host: Realm edits one entry in that file and does not run Auggie. The sections below say what it changes,
what Auggie's own commands do about it, and how far each claim is proven (tiers T1 and T2 are defined under "Evidence
reached"; no wave 2 host has a T3 tier).

## Sources and dates

All read or observed on 2026-11-17.

- https://docs.augmentcode.com/cli/integrations: the user file is `~/.augment/settings.json`, key `mcpServers`; the
  page's example has no `type`. Tier: documented.
- Observed with `@augmentcode/auggie` 1.2.1 (fetched into a scratch directory without credentials, run with an
  isolated `HOME`, never installed): `auggie mcp add-json realm '{"type":"stdio","command":"realm","args":["mcp","--host","augment"],"env":{"K":"v"}}'`
  (default scope `user`) wrote the entry shape below into `~/.augment/settings.json`; `--project` writes
  `.augment/settings.json` and `--local` writes `.augment/settings.local.json`; `AUGMENT_CACHE_DIR=<dir>` moves the whole
  directory (`<dir>/settings.json`); Auggie edits the file format-preservingly (a compact file stayed compact, and a file
  with `//` comments and a trailing comma kept both), so a real settings file may be JSONC. `auggie mcp list` printed the
  entry with a tick even for a missing executable: it lists and does not launch, and each invocation took about 40 s.

## Install with realm host

```bash
realm host install augment --dry-run
realm host install augment
realm host status augment
realm host uninstall augment
```

Each command prints one JSON line. `install` and `uninstall` print `{ id, status, dryRun, actions }` with `status` one
of `planned`, `installed`, `noop` or `removed` and each action `{ path, action, bytes }` (`path` relative to the config
home, no content). `status` prints `{ id, status, entries, launch }`: each entry is a path and one of `ok`, `drifted`
(the file parses and the owned entry differs or is absent), `missing` (the recorded file is gone) or `unreadable` (a
symlink, a file over 1 MiB, invalid UTF-8, or JSON that does not parse, which includes JSON with comments); `launch` is
`on-path` or `not-on-path` and says whether `realm` resolves on the `PATH` that `realm host status` sees, which is not
necessarily Auggie's own.

`--config-home <abs>` names the Augment directory itself (the one that holds `settings.json`), skips detection, and must
exist: Realm never creates a host home. Augment is detected by `~/.augment` (or the `AUGMENT_CACHE_DIR` directory) or by
`auggie` on an absolute `PATH` directory. Install with no Auggie session open (residual R-25-02).

## What changes

One file: `<config home>/settings.json`, where `<config home>` is the `AUGMENT_CACHE_DIR` directory when set to an
absolute path, else `<home>/.augment`. The file is Auggie's shared settings file (hooks, model and more), not an
MCP-only file. Realm merges one entry at `mcpServers.realm` (T1 golden; the bytes `auggie mcp add-json` writes, without
`env`):

```json
{
  "mcpServers": {
    "realm": {
      "type": "stdio",
      "command": "realm",
      "args": [
        "mcp",
        "--host",
        "augment"
      ]
    }
  }
}
```

Every other key, the line endings, the trailing newline and the file mode are preserved; a missing file is created
(mode 0600). A compact one-line file keeps every key and value but is re-rendered with the file's detected indent.
`type: "stdio"` is written because that is what `auggie mcp add-json` writes. The command is the bare `realm`, resolved
on Auggie's `PATH`; nothing absolute is written. Realm parses the file in memory; its receipt, audit and log lines
carry only the host id, relative paths, byte counts and hashes, never a value from the file. GSD Core's own
`AUGMENT_CONFIG_DIR` is not read by Auggie and not by Realm: only `AUGMENT_CACHE_DIR` moves the file. Auggie keeps
comments and formatting when it edits the file, so no rewrite behaviour changes the entry.

## Manual registration and the host's own tools

The same entry by hand: `auggie mcp add-json realm '{"type":"stdio","command":"realm","args":["mcp","--host","augment"]}'`.
If an identical `mcpServers.realm` entry exists, `realm host install augment` is a no-op that Realm does not own (it is
not in the receipt). A different `realm` entry is refused as `foreign-content`; remove it first with Auggie's own
remover or by editing the file. If the entry Realm owns is deleted, `realm host status augment` reports `drifted` and
`realm host uninstall augment` is a clean no-op that deletes the receipt (the remover itself was not exercised here).
`auggie mcp list` is the host's own check; it parses the entry and does not launch it.

## Refusals and recovery

- A `settings.json` with `//` comments or a trailing comma is refused as `unparseable` and nothing is written (`status`
  says `unreadable`). Realm's JSON engine is strict, and Auggie preserves comments, so a real settings file may be
  commented. The fallback is the host's own command, which keeps the comments: `auggie mcp add-json realm
  '{"type":"stdio","command":"realm","args":["mcp","--host","augment"]}'`.
- A file over 1 MiB, invalid UTF-8, or a symlink on the path is refused. A change while the command runs is
  `concurrent-change`: run it again.
- A drifted entry makes `realm host uninstall augment` refuse rather than guess: edit `mcpServers.realm` back to the
  fence above or delete it, then uninstall.

## Project-level configuration and shadowing

Auggie also reads `.augment/settings.json` and `.augment/settings.local.json` in a project. No approval or trust gate is
documented and none was tested. A workload can write these files into the workspace. **Never approve or trust a `realm`
server defined in a repository.** Realm writes and reads no project-level configuration, and the sandbox mount does not
hide these names (accepted residual R-25-01; hiding them is a Phase 19 decision).

## Evidence reached

| Tier | Claim | Result |
| --- | --- | --- |
| T1 offline fixture | the recipe on a fixture host in a temporary home: detect, dry-run, install, no-op reinstall, drift, foreign content, a commented file refused, hostile content, a one-line settings file keeping every key, `AUGMENT_CACHE_DIR` (and `AUGMENT_CONFIG_DIR` changing nothing), uninstall, doctor, `realm host status` | covered by the offline tests (`test/host/wave2-json-recipes.test.ts`, `test/host/wave2-json-specifics.test.ts`) |
| T2 host validator | `auggie mcp list` parses the entry (parse only, about 40 s), in an isolated `HOME` and `AUGMENT_CACHE_DIR` | gated (`REALM_LIVE_AUGMENT=1`, optional `REALM_AUGMENT_BIN`; `test/integration/host-live-wave2.test.ts`); the gated rehearsal records no result yet. The 1.2.1 observation above was a manual scratch-directory run, not the gated test and not through `realm host install` |
| T3 live end to end | not defined for config-only hosts | none |

Not shown by any tier: that a long-running Auggie session starts Realm; Auggie's MCP start timeout against a cold first
boot of up to 230 s (OQ-24-06, carried); an Auggie newer than 1.2.1 (OQ-25-10); a JSONC-aware merge (open question
OQ-25-06; the default is the refusal above).

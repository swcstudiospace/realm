# Kilo Code snippet: Realm MCP server (stdio)

This snippet carries no token, secret, or host path. Placeholders: `<home>` is the user's home directory,
`<config home>` is the Kilo configuration directory, `<tmp>` a throwaway directory.

`realm host install kilo` registers `realm mcp --host kilo` in Kilo's global configuration file `kilo.json`. Kilo is an
OpenCode fork and uses the OpenCode-shaped entry (key `mcp`, an array `command`). Kilo is a config-only host: Realm edits
one entry in that file and does not run Kilo. The sections below say what it changes, what Kilo's own commands do about
it, and how far each claim is proven (tiers T1 and T2 are defined under "Evidence reached"; no wave 2 host has a T3
tier).

## Sources and dates

All read or observed on 2026-11-17.

- https://kilo.ai/docs/automate/mcp/using-in-kilo-code and https://kilo.ai/docs/code-with-ai/platforms/cli: the global
  file is `~/.config/kilo/kilo.json` or `kilo.jsonc` ("or legacy `opencode.json[c]`", with no fallback to
  `~/.config/opencode`); key `mcp`; a local server is `{"type": "local", "command": ["node", "/path/to/server.js"],
  "environment": {...}, "enabled": true, "timeout": 10000}` (the command array includes the arguments). A project
  `./kilo.json[c]` or `./.kilo/` overrides the global file; no trust gate for `mcp` entries is documented. Tier:
  documented. GSD Core's own connect guide still names the legacy `~/.config/kilo/opencode.jsonc`.
- Observed with `@kilocode/cli` 7.8.27 (fetched into a scratch directory without credentials, run with an isolated
  `HOME` and `XDG_CONFIG_HOME`, never installed): a lone strict-JSON `~/.config/kilo/kilo.json` holding the entry below
  was listed by `kilo mcp list` ("realm failed, Executable not found in $PATH: realm", `realm mcp --host kilo`), so Kilo
  parsed it and launched the command (it performs the MCP initialize handshake). Kilo then rewrote the file (see "What
  changes"). With both `kilo.jsonc` (a comment, server `a`) and `kilo.json` (server `realm`) in one directory both were
  listed: Kilo merges the two files and rewrites each in place. `XDG_CONFIG_HOME=<tmp>` relocated the directory to
  `<tmp>/kilo`; with `enabled` omitted the server is enabled; `~/.kilo/kilo.json` alone is also read as a global file.

## Install with realm host

```bash
realm host install kilo --dry-run
realm host install kilo
realm host status kilo
realm host uninstall kilo
```

Each command prints one JSON line. `install` and `uninstall` print `{ id, status, dryRun, actions }` with `status` one
of `planned`, `installed`, `noop` or `removed` and each action `{ path, action, bytes }` (`path` relative to the config
home, no content). `status` prints `{ id, status, entries, launch }`: each entry is a path and one of `ok`, `drifted`
(the file parses and the owned entry differs or is absent), `missing` (the recorded file is gone) or `unreadable` (a
symlink, a file over 1 MiB, invalid UTF-8, or JSON that does not parse, which includes JSON with comments); `launch` is
`on-path` or `not-on-path` and says whether `realm` resolves on the `PATH` that `realm host status` sees, which is not
necessarily Kilo's own.

`--config-home <abs>` names the Kilo directory itself (the one that holds `kilo.json`), skips detection, and must exist:
Realm never creates a host home. Kilo is detected by `~/.config/kilo` (or the `XDG_CONFIG_HOME` equivalent), by `~/.kilo`
or by `kilo` or `kilocode` on an absolute `PATH` directory. `~/.kilo` is a detection signal only: with only `~/.kilo`
present the host is detected but install is refused as `config-home-missing` and creates nothing (create
`~/.config/kilo` or pass `--config-home`). Install with no Kilo session open: Kilo performs a first-run migration of its
files (residual R-25-02).

## What changes

One file: `<config home>/kilo.json`, where `<config home>` is `$XDG_CONFIG_HOME/kilo` when `XDG_CONFIG_HOME` is set to an
absolute path (`XDG_CONFIG_HOME` is a base, as for OpenCode), else `<home>/.config/kilo`. Realm merges one entry at
`mcp.realm` (T1 golden; the shape is documented and Kilo 7.8.27 listed and launched it):

```json
{
  "mcp": {
    "realm": {
      "type": "local",
      "command": [
        "realm",
        "mcp",
        "--host",
        "kilo"
      ]
    }
  }
}
```

Every other key, the indent, the line endings, the trailing newline and the file mode are preserved; a missing file is
created (mode 0600). No `enabled`, `timeout` or `$schema` is written. The command is the bare `realm`, resolved on
Kilo's `PATH`; nothing absolute is written. Realm writes `kilo.json` and never `kilo.jsonc`: the sibling `.jsonc` is
never read, changed or created (a test holds it byte-identical). GSD Core's `KILO_CONFIG_DIR` is not read by Kilo or by
Realm.

What Kilo does to the file when it rewrites it (observed 7.8.27): 2-space indent with arrays expanded, `"$schema":
"https://app.kilo.ai/config.json"` first and `"permission": {"bash": "allow"}` last, and `.gitignore` and
`.bash-permission-migrated` files created beside it; the `realm` entry stayed value-identical, so none of this is drift.
Because Kilo merges `kilo.json` and `kilo.jsonc` in one directory, a same-named server defined in both is resolved by
Kilo's own rule, and which file wins is not tested (OQ-25-12).

## Manual registration and the host's own tools

`kilo mcp add` is interactive for local servers (its flags `--url`, `--env` and `--header` are for remote ones), so the
entry goes in by hand from the fence above. If an identical `mcp.realm` entry already exists, `realm host install kilo`
is a no-op that Realm does not own (it is not in the receipt). A different `mcp.realm` value is refused as
`foreign-content`. If the entry is deleted or edited by hand, `realm host status kilo` reports `drifted`, and `realm host
uninstall kilo` removes only what Realm still owns (a clean no-op when nothing remains). No Kilo remover was exercised.
`kilo mcp list` is the host's own check: it parses the entry and launches the command.

## Refusals and recovery

- A `kilo.json` with comments or a trailing comma is refused as `unparseable` and nothing is written (`status` says
  `unreadable`). Realm's JSON engine is strict; Kilo itself rewrites `kilo.json` as strict JSON with `$schema`, and reads
  `kilo.jsonc` with comments, which Realm never touches. Move the comments out of `kilo.json`, or put the entry in by
  hand from the fence above (a JSONC-aware merge is open question OQ-25-06).
- A file over 1 MiB, invalid UTF-8, or a symlink on the path is refused. A change while the command runs is
  `concurrent-change`: run it again.
- A drifted entry makes `realm host uninstall kilo` refuse rather than guess: edit `mcp.realm` back to the fence above or
  delete it, then uninstall.

## Project-level configuration and shadowing

Kilo reads a project `./kilo.json` or `./kilo.jsonc` and `./.kilo/`, overriding the global file. No trust or approval gate
for `mcp` entries is documented. A workload can write these files into the workspace. **Never approve or trust a `realm`
server defined in a repository.** Realm writes and reads no project-level configuration, and the sandbox mount does not
hide these names (accepted residual R-25-01; hiding them is a Phase 19 decision).

## Evidence reached

| Tier | Claim | Result |
| --- | --- | --- |
| T1 offline fixture | the recipe on a fixture host in a temporary home: detect, dry-run, install, no-op reinstall, drift, foreign content, a commented `kilo.json` refused, hostile content, a sibling `kilo.jsonc` untouched, the file Kilo rewrote (`$schema` first, `permission` last) accepted, `~/.kilo` alone detecting but not installing, `XDG_CONFIG_HOME` (and `KILO_CONFIG_DIR` changing nothing), uninstall, doctor, `realm host status` | covered by the offline tests (`test/host/wave2-json-recipes.test.ts`, `test/host/wave2-json-specifics.test.ts`) |
| T2 host validator | `kilo mcp list` parses the entry and launches the registered argv (a stub `realm` on `PATH` records it), in an isolated `HOME` and `XDG_CONFIG_HOME` | gated (`REALM_LIVE_KILO=1`, optional `REALM_KILO_BIN`; `test/integration/host-live-wave2.test.ts`); the gated rehearsal records no result yet. The 7.8.27 observation above was a manual scratch-directory run, not the gated test and not through `realm host install` |
| T3 live end to end | not defined for config-only hosts | none |

Not shown by any tier: that a long-running Kilo session starts Realm; Kilo's MCP start timeout against a cold first boot
of up to 230 s (OQ-24-06, carried); a Kilo newer than 7.8.27 (OQ-25-10); which of `kilo.json` and `kilo.jsonc` wins for a
same-named server (OQ-25-12).

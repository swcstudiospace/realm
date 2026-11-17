# Pi snippet: Realm MCP server (stdio), pi 1.3 and later only

This snippet carries no token, secret, or host path. Placeholders: `<home>` is the user's home directory,
`<config home>` is the Pi agent directory, `<tmp>` a throwaway directory.

`realm host install pi` registers `realm mcp --host pi` in Pi's user MCP file. **The recipe is valid for pi 1.3 and
later only** (owner-approved, open question OQ-25-07): an older pi has no MCP support and ignores the file, and the
recipe cannot check the version. Pi is a config-only host: Realm edits one entry in that file and does not run Pi. The
sections below say what it changes, what Pi's own commands do about it, and how far each claim is proven (tiers T1 and T2
are defined under "Evidence reached"; no wave 2 host has a T3 tier).

## Sources and dates

All read or observed on 2026-11-17.

- https://pi.dev/docs/latest/mcp (and the package source at github.com/earendil-works/pi): the user file is
  `~/.pi/agent/mcp.json`, key `mcpServers`, a stdio server is `{command, args, env, cwd}` (`type` optional, `sse`
  rejected); `PI_CODING_AGENT_DIR` overrides `~/.pi/agent`; a project `.pi/mcp.json` is read only after project trust and
  replaces a user entry of the same name; an adapter extension that registers `/mcp` replaces the built-in MCP, and
  `--no-mcp` disables it. Tier: documented.
- GSD Core's capability matrix (installer source, branch `next`, read 2026-11-17) says built-in MCP starts at pi 1.3.0.
- Observed with pi 1.5.2 (`@earendil-works/pi-coding-agent`, fetched into a scratch directory, run with an isolated
  `HOME`, never installed): `pi mcp add realm -- realm mcp --host pi` wrote the entry below; the file is strict JSON (a
  `//` comment makes `pi mcp add` refuse and leave the file untouched); `pi mcp list` connects to every enabled server
  (a stub `realm` on `PATH` recorded `mcp --host pi`), exits 1 on a failed one and needs no login.
- The `pi` on the verification machine is 0.84.3: its README says "No MCP", `pi --help` lists no `mcp` command, and it
  ignores `mcp.json`. On such a pi the recipe succeeds and changes nothing the host reads. Check the version with
  `pi --version` before installing.

## Install with realm host

```bash
pi --version
realm host install pi --dry-run
realm host install pi
realm host status pi
realm host uninstall pi
```

Each command prints one JSON line. `install` and `uninstall` print `{ id, status, dryRun, actions }` with `status` one
of `planned`, `installed`, `noop` or `removed` and each action `{ path, action, bytes }` (`path` relative to the config
home, no content). `status` prints `{ id, status, entries, launch }`: each entry is a path and one of `ok`, `drifted`
(the file parses and the owned entry differs or is absent), `missing` (the recorded file is gone) or `unreadable` (a
symlink, a file over 1 MiB, invalid UTF-8, or JSON that does not parse, which includes JSON with comments); `launch` is
`on-path` or `not-on-path` and says whether `realm` resolves on the `PATH` that `realm host status` sees, which is not
necessarily Pi's own.

`--config-home <abs>` names the Pi agent directory itself (the one that holds `mcp.json`), skips detection, and must
exist: Realm never creates a host home. Pi is detected by `~/.pi/agent` (or the `PI_CODING_AGENT_DIR` directory) or by
`pi` on an absolute `PATH` directory. Install with no Pi session open (residual R-25-02).

## What changes

One file: `<config home>/mcp.json`, where `<config home>` is the `PI_CODING_AGENT_DIR` directory when set to an absolute
path, else `<home>/.pi/agent`. `PI_CODING_AGENT_DIR` is also Omp's override: setting it moves both hosts' homes, and a
Pi install there writes only `mcp.json` beside Omp's `extensions/`. Realm merges one entry at `mcpServers.realm` (T1
golden; the bytes `pi mcp add` wrote, observed in pi 1.5.2):

```json
{
  "mcpServers": {
    "realm": {
      "command": "realm",
      "args": [
        "mcp",
        "--host",
        "pi"
      ]
    }
  }
}
```

Every other key, the indent, the line endings, the trailing newline and the file mode are preserved; a missing file is
created (mode 0600). No `type` is written (it is optional). The command is the bare `realm`, resolved on Pi's `PATH`;
nothing absolute is written. What Pi does to the file when it rewrites it: `pi mcp add` rewrites a strict-JSON file with
2-space indent and one array item per line; nothing in what was observed changes an existing `realm` entry.

## Manual registration and the host's own tools

The same entry by hand: `pi mcp add realm -- realm mcp --host pi`. If an identical `mcpServers.realm` entry exists,
`realm host install pi` is a no-op that Realm does not own (it is not in the receipt). A different `realm` entry is
refused as `foreign-content`; remove it first (Pi's own remover or an edit of the file). If the entry Realm owns is
deleted, `realm host status pi` reports `drifted` and `realm host uninstall pi` is a clean no-op that deletes the
receipt (the remover itself was not exercised here). `pi mcp list` is the host's own check: it connects to every
enabled server, so it launches the registered command.

## Refusals and recovery

- An `mcp.json` with comments or a trailing comma is refused as `unparseable` and nothing is written (`status` says
  `unreadable`). Realm's JSON engine is strict, and Pi's own file is strict JSON too (`pi mcp add` refuses a commented
  file). Move the comments out, or put the entry in by hand.
- A file over 1 MiB, invalid UTF-8, or a symlink on the path is refused. A change while the command runs is
  `concurrent-change`: run it again.
- pi older than 1.3: the install writes the file and the host ignores it. Upgrade pi, or `realm host uninstall pi`.
- A drifted entry makes `realm host uninstall pi` refuse rather than guess: edit `mcpServers.realm` back to the fence
  above or delete it, then uninstall.

## Project-level configuration and shadowing

Pi reads a project `.pi/mcp.json` only after project trust, and a project entry replaces a user entry of the same name.
A workload can write that file into the workspace. **Never approve or trust a `realm` server defined in a repository**
(do not grant project trust for this purpose). Realm writes and reads no project-level configuration, and the sandbox
mount does not hide these names (accepted residual R-25-01; hiding them is a Phase 19 decision).

## Evidence reached

| Tier | Claim | Result |
| --- | --- | --- |
| T1 offline fixture | the recipe on a fixture host in a temporary home: detect, dry-run, install, no-op reinstall, drift, foreign content, a commented file refused, hostile content, `PI_CODING_AGENT_DIR` resolving the `pi` and `omp` homes to one directory with a Pi install writing only `mcp.json`, uninstall, doctor, `realm host status` | covered by the offline tests (`test/host/wave2-json-recipes.test.ts`, `test/host/wave2-json-specifics.test.ts`) |
| T2 host validator | `pi mcp list` connects to the entry and launches the registered argv (a stub `realm` on `PATH` records it), in an isolated `HOME` and `PI_CODING_AGENT_DIR`; the test skips below pi 1.3.0 | gated (`REALM_LIVE_PI=1`, optional `REALM_PI_BIN`; `test/integration/host-live-wave2.test.ts`); the gated rehearsal records no result yet (on the verification machine it would skip: 0.84.3 is below 1.3.0). The 1.5.2 observation above was a manual scratch-directory run, not the gated test and not through `realm host install` |
| T3 live end to end | not defined for config-only hosts | none |

Not shown by any tier: that a long-running Pi session starts Realm; Pi's MCP start timeout against a cold first boot of
up to 230 s (OQ-24-06, carried); a Pi newer than 1.5.2 (OQ-25-10); a version probe that would let the installer refuse
below 1.3 (deferred).

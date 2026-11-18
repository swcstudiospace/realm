# OpenCode snippet: Realm MCP server (stdio)

This snippet carries no token, secret, or host path. Placeholders: `<home>` is the user's home directory,
`<config home>` is the OpenCode configuration directory, `<tmp>` a throwaway directory.

`realm host install opencode` registers `realm mcp --host opencode` in OpenCode's global configuration file. The
sections below say what it changes, what OpenCode's own commands do about it, and how far each claim is proven (tiers
T1 to T3 are defined under "Evidence reached").

## Sources and dates

All read or observed on 2026-11-17.

- https://opencode.ai/docs/config.md: the global file is `~/.config/opencode/opencode.json` (or `.jsonc`); a project
  `opencode.json` (or `.jsonc`) and `.opencode/` sit in the project; there is a machine-wide `/etc/opencode`. "The
  package config overrides matching settings from the repository config, which overrides the global config."
- https://opencode.ai/docs/mcp-servers.md (V2 documentation): servers are named under `mcp.servers`, a local server is
  `{"type": "local", "command": [...]}`, "A higher-precedence project config replaces the entire server object with the
  same name", and "V2 does not place server names directly under `mcp`".
- https://opencode.ai/docs/migrate-v1.md: "The V1 config format remains supported", "OpenCode recognizes mixed V1 and
  V2 members within `mcp`", and "V1 and V2 use the same configuration locations, so do not point V1 at files after
  converting them to native V2-only shapes".
- Observed with OpenCode 1.19.5 (the `latest` npm dist-tag that day; the Linux binary was fetched into a scratch
  directory and run there with an isolated `HOME` and `XDG_CONFIG_HOME`, never installed): `opencode mcp add [name]` is
  interactive (there is no `-- <command>` form); `opencode mcp list` printed a `realm` row, "failed", "Executable not
  found in $PATH: realm", "realm mcp --host opencode" for the entry below, so the host parsed it and tried to launch
  exactly that argv; it also lists a server written as `mcp.servers.<name>`, reads a JSONC `opencode.jsonc` with
  comments and trailing commas, and merges `opencode.json` and `opencode.jsonc` found in the same directory; a moved
  `XDG_CONFIG_HOME` is honoured, and a directory named by `OPENCODE_CONFIG_DIR` is read as an additional source.
- Node or Bun requirement of OpenCode: not recorded in the pages read.

## Install with realm host

```bash
realm host install opencode --dry-run
realm host install opencode
realm host status opencode
realm host uninstall opencode
```

Each command prints one JSON line. `install` and `uninstall` print `{ id, status, dryRun, actions }` with `status` one
of `planned`, `installed`, `noop` or `removed` and each action `{ path, action, bytes }` (`path` relative to the config
home, no content). `status` prints `{ id, status, entries, launch }`: each entry is a path and one of `ok`, `drifted`
(the file parses and the owned entry differs or is absent), `missing` (the recorded file is gone) or `unreadable` (a
symlink, a file over 1 MiB, invalid UTF-8, or JSON that does not parse, which includes JSON with comments); `launch` is
`on-path` or `not-on-path` and says whether `realm` resolves on the `PATH` that `realm host status` sees, which is not
necessarily OpenCode's own.

`--config-home <abs>` names the OpenCode directory itself (the one that holds `opencode.json`), skips detection, and
must exist: Realm never creates a host home. OpenCode is detected by `~/.config/opencode` (or the `XDG_CONFIG_HOME`
equivalent) or by `opencode` on an absolute `PATH` directory. Install with no OpenCode session open.

## What changes

One file: `<config home>/opencode.json`, where `<config home>` is `$XDG_CONFIG_HOME/opencode` when `XDG_CONFIG_HOME` is
set to an absolute path, else `<home>/.config/opencode`. Realm merges one entry at `mcp.realm`, the V1 shape (T1
golden; the shape is documented, and 1.19.5 listed it, see above):

```json
{
  "mcp": {
    "realm": {
      "type": "local",
      "command": ["realm", "mcp", "--host", "opencode"]
    }
  }
}
```

Every other key, the indent, the line endings, the trailing newline and the file mode are preserved; a missing file is
created (mode 0600). No `enabled` key and no `$schema` is written. `opencode.jsonc` is never read, changed or created.
The command is the bare `realm`, resolved on OpenCode's `PATH`; nothing absolute is written.

V1 shape versus V2 shape: the V2 documentation prefers `mcp.servers.realm`. Realm writes the V1 `mcp.realm` shape
because OpenCode 1.x reads it (observed 1.19.5), V2 documents it as supported, and a V2-only `mcp.servers` entry would
look like a server named `servers` to a V1-only version, which could break the whole configuration load. If OpenCode
drops V1 support, one table row in `src/host/runtimes.ts` flips the key path to `["mcp", "servers", "realm"]` (owner
decision, open question OQ-24-02). Not seen: a V2 build listing the V1 entry (a search-result summary of an upstream
issue reported "No MCP servers configured" for a flat entry after a restart; it was not read and is not relied on).

## Manual registration and the host's own tools

`opencode mcp add` is interactive in 1.19.5, so the entry goes in by hand from the fence above. If an identical
`mcp.realm` entry already exists, `realm host install opencode` is a no-op that Realm does not own (it is not in the
receipt). A different `mcp.realm` value is refused as `foreign-content`. A hand-made `mcp.servers.realm` (the V2 shape)
is not seen by Realm. If the entry is deleted or edited by hand, `realm host status opencode` reports `drifted`, and
`realm host uninstall opencode` removes only what Realm still owns (a clean no-op when nothing remains). No OpenCode
remover was exercised.

### What OpenCode itself writes (observed 2026-11-17, opencode 1.19.5)

`opencode mcp list` is not read-only. Run against the config directory, it writes `{"$schema": "https://opencode.ai/config.json"}` into `opencode.json` (adding the key beside the `mcp` section the recipe wrote, or creating the file when absent) and creates a `.gitignore` (63 bytes) beside it. Realm owns only its `mcp.realm` entry, so after the host has run, `realm host uninstall opencode` removes the realm entry (and the `mcp` section when the entry was all it held) and leaves the file holding only `$schema` (51 bytes) and the host-created `.gitignore` as the host left them. The file is removed only when the host never touched it, for example when uninstall follows install with no OpenCode command in between. Also expected: with the stub `realm` of the validator tier, which exits at once, `opencode mcp list` prints `realm failed: MCP error -32000: Connection closed`; the validator test checks the row and the launched argv, not a connected state.

## Project-level configuration and shadowing

OpenCode loads a project `opencode.json` (or `.jsonc`) and `.opencode/` from the project, and per its documentation a
higher-precedence project config replaces the entire server object of the same name, so a project `realm` server
shadows the global entry Realm installed. No trust or approval prompt for project configuration is documented in
anything read. A workload can write these files in the workspace. Never keep a `realm` server in a project you did not
install it in yourself. Realm itself writes and reads no project-level configuration, and the sandbox mount does not
hide these names. A read-only or hidden overlay is an open owner decision (OQ-24-03) and is not done here.

## Evidence reached

| Tier | Claim | Result |
| --- | --- | --- |
| T1 offline fixture | the recipe on a fixture host in a temporary home: detect, dry-run, install, no-op reinstall, drift, foreign content, JSONC refusal, a sibling `opencode.jsonc` untouched, hostile content, uninstall, doctor, `realm host status`, `XDG_CONFIG_HOME` | covered by the offline tests (`test/host/opencode-recipe.test.ts`) |
| T2 host validator | `opencode mcp list` parses the entry and launches the registered argv (a stub `realm` on `PATH` records it), in an isolated `HOME` and `XDG_CONFIG_HOME` | gated (`REALM_LIVE_OPENCODE=1`); **ran live on 2026-11-18 with opencode 1.19.5**, 3 of 3 passed, from an owner-approved scratch install outside the repository. The earlier 1.19.5 observation above was a manual scratch-directory run, not the gated test |
| T3 live end to end | the real `realm` on `PATH`, `opencode mcp list` shows the server connected, the daemon is opened for a workspace | gated (`REALM_LIVE_PRODUCTION=1` plus `REALM_LIVE_OPENCODE=1`); **ran live on 2026-11-18 with opencode 1.19.5** on the production stack (rootless Podman 5.7.1 account, warm session): `opencode mcp list` reported realm connected and the stack was clean before and after. The wire was recorded and the tool listing is not asserted for OpenCode. A cold first attach exceeds OpenCode's 30 s connect timeout (GAP-31-04); evidence is kept outside the repository |

Not shown by any tier: a Realm tool call through OpenCode; that a real model turn calls the Realm tools; that a V2
build lists the V1 entry; that OpenCode's start timeout outlasts a cold first boot of up to 230 s (OQ-24-06).

## Known limits

- JSON with comments in `opencode.json` is refused as `unparseable` (`status` says `unreadable`). Either move the
  comments out, or put the entry in by hand from the fence above. `opencode.jsonc` is never read or changed. Because
  OpenCode merges `opencode.json` and `opencode.jsonc` in one directory, a missing `opencode.json` is created beside an
  existing `opencode.jsonc`; which of the two wins for a same-named server is not documented (OQ-24-07).
- A file over 1 MiB, invalid UTF-8, or a symlink on the path is refused. A change while the command runs is
  `concurrent-change`: run it again (residual R-24-02).
- Only the global file is written. Project scope, `/etc/opencode` and `OPENCODE_CONFIG_DIR` are never written.

ACP: not documented in the pages read, so this snippet gives no ACP configuration.

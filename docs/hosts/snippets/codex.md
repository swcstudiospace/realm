# Codex snippet: Realm MCP server (stdio)

This snippet carries no token, secret, or host path. Placeholders: `<home>` is the user's home directory,
`<codex home>` is the Codex directory, `<tmp>` a throwaway directory.

`realm host install codex` registers `realm mcp --host codex` as an owned block in Codex's user-level
`config.toml`. The sections below say what it changes, why Codex's own remover is the one tool not to use on it, and how
far each claim is proven (tiers T1 to T3 are defined under "Evidence reached").

## Sources and dates

All read or observed on 2026-11-17.

- https://developers.openai.com/codex/mcp (also served at learn.chatgpt.com/docs/extend/mcp): "By default this is
  `~/.codex/config.toml`, but you can also scope MCP servers to a project with `.codex/config.toml` (trusted projects
  only)." Each server is a `[mcp_servers.<server-name>]` table; stdio keys are `command` (required), `args`, `env`,
  `env_vars` and `cwd`; `startup_timeout_sec` is a documented per-server key (Realm writes none).
- Observed with codex-cli 0.154.0 in an isolated `HOME`: `codex mcp add realm -- realm mcp --host codex` printed "Added
  global MCP server 'realm'." and created `<home>/.codex/config.toml` (mode 0600, directory 0700) holding exactly the
  table below with a trailing newline. `codex mcp list` (a table with Name, Command, Args, Env, Cwd, Status, Auth) and
  `codex mcp get realm` (transport, command, args, and a `remove: codex mcp remove realm` line) both worked with `realm`
  absent from `PATH`: they parse the registration and do not launch it. `CODEX_HOME=<tmp>` moved the file to
  `<tmp>/config.toml`.
- A real `config.toml` on the verification machine is hand-grown TOML (a `[features]` table, `[hooks.state."..."]`
  tables, another `[mcp_servers.*]` table, comments), which is the normal case the recipe must preserve.
- Node or Bun requirement of Codex: not recorded in the pages read.

## Install with realm host

```bash
realm host install codex --dry-run
realm host install codex
realm host status codex
realm host uninstall codex
```

Each command prints one JSON line. `install` and `uninstall` print `{ id, status, dryRun, actions }` with `status` one
of `planned`, `installed`, `noop` or `removed` and each action `{ path, action, bytes }` (`path` relative to the config
home, no content). `status` prints `{ id, status, entries, launch }`: each entry is a path and one of `ok`, `drifted`
(the owned block differs or is absent), `missing` (the recorded file is gone) or `unreadable` (a symlink, a file over
1 MiB, invalid UTF-8, or a lone Realm marker); `launch` is `on-path` or `not-on-path` and says whether `realm` resolves
on the `PATH` that `realm host status` sees, which is not necessarily Codex's own.

`--config-home <abs>` names the Codex directory itself (the one that holds `config.toml`), skips detection, and must
exist: Realm never creates a host home. Codex is detected by `~/.codex` (or `CODEX_HOME`) or by `codex` on an absolute
`PATH` directory. Install with no Codex session open.

## What changes

One file: `<codex home>/config.toml`, where `<codex home>` is `CODEX_HOME` when it is set to an absolute path, else
`<home>/.codex`. Realm appends one block at the end of the file (a separator newline first when the file does not end in
one). The text between the two marker lines is the table `codex mcp add` writes (T1 golden, from the observation above):

```toml
# BEGIN realm host-plugin
[mcp_servers.realm]
command = "realm"
args = ["mcp", "--host", "codex"]
# END realm host-plugin
```

Every byte outside the markers (other tables, comments, blank lines, line endings, mode) is preserved; a missing file
is created (mode 0600). The block goes at the end because a new table header is always valid TOML there, so a file that
ends inside another table cannot capture the block's keys. TOML is never parsed or rewritten: the engine owns only the
text between the markers. The command is the bare `realm`, resolved on Codex's `PATH`.

## The duplicate-table guard

Before an install, the text outside the markers is scanned by a line scanner (`src/host/toml-table.ts`), not a TOML
parser. The install is refused as `foreign-content` and nothing is written when the scanner finds `mcp_servers.realm`
defined: as a header in any spelling (`[mcp_servers.realm]`, `[ mcp_servers . realm ]`, `[mcp_servers."realm"]`,
`['mcp_servers'.'realm']`, `[mcp_servers.realm.env]`, `[[mcp_servers.realm]]`), as a `realm = ...`, `"realm" = ...` or
`realm.command = ...` line inside `[mcp_servers]`, or as a top-level dotted key (`mcp_servers.realm.command = ...`,
`mcp_servers = ...`). A header or key the scanner cannot read is refused as `unparseable`. Limits: a look-alike inside a
multi-line string is a false positive (refused, which is safe); a bare `["x"]` line inside a multi-line array in
`[mcp_servers]` can hide a real definition from the scanner, in which case Codex itself rejects the resulting file and
`codex mcp get realm` shows it (residual R-24-03; uninstall restores the file).

## Manual registration and the host's own tools

By hand, the same table is `codex mcp add realm -- realm mcp --host codex`. A user who already ran it has the table
outside any marker, so `realm host install codex` refuses it as `foreign-content` rather than adding a second table:
either keep the manual entry and skip the installer, or remove it with `codex mcp remove realm` first and then run
`realm host install codex`. A manual `codex mcp add other -- other-cmd` after Realm's install adds a separate table
and does not touch the block (T2 is meant to record that for 0.154.0; see below).

**Uninstall with `realm host uninstall codex`, not with `codex mcp remove realm`.** Codex's remover edits the file with
Codex's own TOML editor. [INFERENCE] It removes the table and the comment lines attached to it and leaves the
`# END realm host-plugin` marker behind. The recorded effect of `codex mcp remove realm` on 0.154.0 is **not yet
recorded**: the gated rehearsal that would record it has not run (see "Evidence reached"). If a lone marker is left, the
engine refuses to guess: `realm host status codex` says `unreadable`, and `realm host install codex` and `realm host
uninstall codex` both refuse as `unparseable`. Recovery, by hand:

1. Open `<codex home>/config.toml` and delete the two lines `# BEGIN realm host-plugin` and `# END realm host-plugin`
   if either is still present. Leave every other line.
2. Run `realm host uninstall codex`. With no block left it is a clean no-op that clears the receipt.
3. Reinstall with `realm host install codex` if you still want the entry.

## Project-level configuration and shadowing

Codex honours a project `.codex/config.toml` for trusted projects only. A project-level `[mcp_servers.realm]` table is
launched by Codex outside the sandbox with the user's privileges. A workload can write that file in the workspace.
Never trust a project, or keep a `realm` server, that you did not set up yourself. Realm itself writes and reads no
project-level configuration, and the sandbox mount does not hide these names. A read-only or hidden overlay is an open
owner decision (OQ-24-03) and is not done here.

## Evidence reached

| Tier | Claim | Result |
| --- | --- | --- |
| T1 offline fixture | the recipe on a fixture host in a temporary home against the observed table and a real-shaped hand-grown `config.toml`: detect, dry-run, install, no-op reinstall, drift, the duplicate-table guard (every spelling above), a lone marker, hostile content, uninstall, doctor, `realm host status`; other tables, comments and blank lines survive byte-exact | covered by the offline tests (`test/host/codex-recipe.test.ts`, `test/host/toml-table.test.ts`); the golden table is the output of codex-cli 0.154.0 observed 2026-11-17 |
| T2 host validator | `codex mcp get realm` and `codex mcp list` parse what the recipe wrote (they do not launch it); a following `codex mcp add other -- other-cmd` leaves the block and status intact; `codex mcp remove realm` is run and its effect recorded | gated (`REALM_LIVE_CODEX=1`); runnable here with codex-cli 0.154.0; **no result is recorded yet**. This page claims nothing about what Codex does to the markers until a dated result is written here |
| T3 live end to end | not available: `codex mcp list` does not start servers, and a Codex session needs model credentials | **gap, not run**: no Codex session booting Realm is recorded or automatable here |

Not shown by any tier: a live Realm session through Codex; that Codex keeps the marker comments when it rewrites the
file (OQ-24-05); that a real model turn calls the Realm tools; that Codex's `startup_timeout_sec` outlasts a cold first
boot of up to 230 s (OQ-24-06).

## Known limits

- The guard is a line scanner, not a parser (see "The duplicate-table guard").
- A file over 1 MiB, invalid UTF-8 or a symlink on the path is refused (`status` says `unreadable`). A change while
  the command runs is `concurrent-change`: run it again (residual R-24-02).
- The remover caveat above (residual R-24-04). The engine is deliberately not loosened to heal a lone marker: a
  half-present marker is exactly what a hand-edited file looks like.
- Only the user-level file is written; `.codex/config.toml` in a project is never written.

ACP: not documented in the pages read, so this snippet gives no ACP configuration.

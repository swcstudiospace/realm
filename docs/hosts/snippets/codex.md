# Codex snippet: Realm MCP server (stdio)

This snippet carries no token, secret, or host path. Placeholders: `<home>` is the user's home directory,
`<codex home>` is the Codex directory, `<tmp>` a throwaway directory.

`realm host install codex` registers `realm mcp --host codex` as one owned table, `[mcp_servers.realm]`, in Codex's
user-level `config.toml`. Ownership is by the table header: Realm writes no marker comment. The sections below say what
it changes, how it behaves when Codex rewrites the file itself, and how far each claim is proven (tiers T1 to T3 are
defined under "Evidence reached").

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
- Observed with codex-cli 0.154.0 in an isolated `CODEX_HOME` (2026-11-17), starting from a file with `# user comment`,
  `model = "x"`, a `# BEGIN realm host-plugin` line, the table below and a `# END realm host-plugin` line: `codex mcp add
  other -- echo hi` rewrote the file with a comment-dropping TOML editor. The `# BEGIN` line (decor of the table) was
  **dropped**, the table text was kept byte-identical, `[mcp_servers.other]` was inserted after it, and the `# END` line
  was kept at the end of the file. `codex mcp remove realm` then removed the table and left the orphan `# END` line. A
  comment marker is therefore not a safe way to own text in this file: after any Codex-side edit the markers are lone.
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
(the owned table differs, or is defined a second time or in another form), `missing` (the recorded file is gone, or the
file is there and the owned table is not: for instance after `codex mcp remove realm`) or `unreadable` (a symlink, a file
over 1 MiB, invalid UTF-8, or a header the line scanner cannot read); `launch` is `on-path` or `not-on-path` and says whether `realm` resolves
on the `PATH` that `realm host status` sees, which is not necessarily Codex's own.

`--config-home <abs>` names the Codex directory itself (the one that holds `config.toml`), skips detection, and must
exist: Realm never creates a host home. Codex is detected by `~/.codex` (or `CODEX_HOME`) or by `codex` on an absolute
`PATH` directory. Install with no Codex session open.

## What changes

One file: `<codex home>/config.toml`, where `<codex home>` is `CODEX_HOME` when it is set to an absolute path, else
`<home>/.codex`. Realm appends one table at the end of the file, after one blank line when the file is not empty and
does not already end in a blank line. The table is exactly what `codex mcp add` writes (T1 golden, from the observation
above), with no comment around it:

```toml
[mcp_servers.realm]
command = "realm"
args = ["mcp", "--host", "codex"]
```

Every byte outside the table (other tables, comments, blank lines, line endings, mode) is preserved; a missing file is
created (mode 0600). A CRLF file stays CRLF. The table goes at the end because a new table header is always valid TOML
there, so a file that ends inside another table cannot capture the table's keys. TOML is never parsed or rewritten: the
engine owns only the text of that one table, found by its header line (`[mcp_servers.realm]`, written exactly so, on a
line of its own) through its last key line. Comment and blank lines after the last key line belong to what follows and
are not part of the table. The receipt stores the hash of the table text and no text. The command is the bare `realm`,
resolved on Codex's `PATH`.

What the engine does with the table:

- **install**: table absent, append it. Present with exactly the owned text and owned by the receipt, a no-op. Present
  with different text, a duplicate, a subtable or a dotted or inline definition, refused as `foreign-content`. The exact
  owned text with no receipt (for example one written by `codex mcp add realm`) is not claimed: it is `foreign-content`
  too, so Realm never takes ownership of an entry it did not write.
- **status**: the owned table equal to the receipt's hash is `ok`; absent is `missing`; present but different is
  `drifted`.
- **uninstall**: the table is removed, with the blank separator line Realm added, only when its hash equals the receipt's
  hash. If it was changed, uninstall refuses as `drifted` and writes nothing. If Codex or the user already removed it,
  uninstall is a no-op that deletes the receipt.

## The duplicate-table guard

Before an install (and for status and uninstall), the text outside the owned table is scanned by a line scanner (`src/host/toml-table.ts`), not a TOML
parser. The install is refused as `foreign-content` and nothing is written when the scanner finds `mcp_servers.realm`
defined: as a header in any spelling (`[mcp_servers.realm]`, `[ mcp_servers . realm ]`, `[mcp_servers."realm"]`,
`['mcp_servers'.'realm']`, `[mcp_servers.realm.env]`, `[[mcp_servers.realm]]`), as a `realm = ...`, `"realm" = ...` or
`realm.command = ...` line inside `[mcp_servers]`, or as a top-level dotted key (`mcp_servers.realm.command = ...`,
`mcp_servers = ...`). A header or key the scanner cannot read is refused as `unparseable`. Limits: a look-alike inside a
multi-line string is a false positive (refused, which is safe); a bare `["x"]` line inside a multi-line array in
`[mcp_servers]` can hide a real definition from the scanner, in which case Codex itself rejects the resulting file and
`codex mcp get realm` shows it (residual R-24-03; uninstall restores the file).

## Manual registration and the host's own tools

By hand, the same table is `codex mcp add realm -- realm mcp --host codex`. A user who already ran it has a table
Realm did not write, so `realm host install codex` refuses it as `foreign-content` rather than adding a second table or
claiming it: either keep the manual entry and skip the installer, or remove it with `codex mcp remove realm` first and
then run `realm host install codex`.

Codex's own commands and Realm's table coexist, because ownership is the table and not a comment:

- `codex mcp add other -- other-cmd` after Realm's install adds a separate table and leaves the owned table
  byte-identical, so `realm host status codex` stays `installed`.
- `codex mcp remove realm` removes the owned table. `realm host status codex` then says `drifted` with the entry
  `missing`, and `realm host uninstall codex` is a clean no-op that deletes the receipt and leaves the file as Codex left
  it. Realm can be installed again afterwards.
- Editing the owned table by hand (another value, an added key, a comment inside it) is drift: `realm host uninstall
  codex` refuses as `drifted` and writes nothing, until the table is put back or removed by hand.

## Project-level configuration and shadowing

Codex honours a project `.codex/config.toml` for trusted projects only. A project-level `[mcp_servers.realm]` table is
launched by Codex outside the sandbox with the user's privileges. A workload can write that file in the workspace.
Never trust a project, or keep a `realm` server, that you did not set up yourself. Realm itself writes and reads no
project-level configuration, and the sandbox mount does not hide these names. A read-only or hidden overlay is an open
owner decision (OQ-24-03) and is not done here.

## Evidence reached

| Tier | Claim | Result |
| --- | --- | --- |
| T1 offline fixture | the recipe on a fixture host in a temporary home against the observed table and a real-shaped hand-grown `config.toml`: detect, dry-run, install, no-op reinstall, drift, the duplicate-table guard (every spelling above), a Codex-style `add other` (a table inserted after ours; status stays ok) and `remove realm` (the table deleted; status missing, uninstall a no-op), hostile content, CRLF, uninstall, doctor, `realm host status`; other tables, comments and blank lines survive byte-exact | covered by the offline tests (`test/host/codex-recipe.test.ts`, `test/host/toml-owned.test.ts`, `test/host/toml-table.test.ts`); the golden table is the output of codex-cli 0.154.0 observed 2026-11-17 |
| T2 host validator | `codex mcp get realm` and `codex mcp list` parse what the recipe wrote (they do not launch it); a following `codex mcp add other -- other-cmd` leaves the owned table byte-identical and status `installed`; `codex mcp remove realm` removes the table, status says `missing` and uninstall is a no-op | gated (`REALM_LIVE_CODEX=1`); **ran live with codex-cli 0.154.0 on 2026-11-17**. The first run, against the old comment-marker recipe, failed and found the marker defect (see "Sources and dates"). After the header-owned recipe merged, the validator ran again from the merged tree: 5 passed, 0 failed, 2 skipped (the production tier, `REALM_LIVE_PRODUCTION` unset, and the Codex production gap). `codex mcp get|list` parse the marker-free `[mcp_servers.realm]` table; after `codex mcp add other` and after `codex mcp remove realm`, install, status and uninstall stay consistent; after `codex mcp add realm`, install refuses with `foreign-content`. The evidence is kept outside the repository |
| T3 live end to end | `codex exec` against a loopback provider that refuses every request (no credential): Codex starts the registered `realm mcp --host codex` before its first model request and lists its tools; a wire recorder in front of the real CLI logs method names and tool names | gated (`REALM_LIVE_PRODUCTION=1` plus `REALM_LIVE_CODEX=1`); the session drive is written and **has not run** against the production stack (a human-owned window on the production account is pending); the validator-tier session test needs no Podman. `codex mcp list` still does not start servers. Not shown: a model turn or a tool call, and Codex forwarding only `HOME`, `LANG` and `PATH` to a server unless the entry lists `env_vars` (GAP-31-01) |

Not shown by any tier: a live Realm session through Codex; that Codex keeps the owned table byte-identical in every
Codex version (observed for codex-cli 0.154.0 only; OQ-24-05); that a real model turn calls the Realm tools; that Codex's `startup_timeout_sec` outlasts a cold first
boot of up to 230 s (OQ-24-06).

## Known limits

- The guard is a line scanner, not a parser (see "The duplicate-table guard").
- A file over 1 MiB, invalid UTF-8 or a symlink on the path is refused (`status` says `unreadable`). A change while
  the command runs is `concurrent-change`: run it again (residual R-24-02).
- Codex's editor may reformat the owned table (quoting, key order, inline values) in a later version. The engine then
  reads a changed table as drift and refuses uninstall rather than guessing; remove the table by hand and run `realm host
  uninstall codex` (a no-op that clears the receipt). Only 0.154.0 is observed.
- Only the user-level file is written; `.codex/config.toml` in a project is never written.

ACP: not documented in the pages read, so this snippet gives no ACP configuration.

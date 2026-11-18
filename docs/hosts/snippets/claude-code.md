# Claude Code snippet: Realm MCP server (stdio)

This snippet carries no token, secret, or host path. Placeholders: `<home>` is the user's home directory, `<tmp>` a
throwaway directory.

`realm host install claude` registers `realm mcp --host claude` in Claude Code's user-level MCP file. The sections
below say what it changes, how it interacts with Claude's own `claude mcp` commands, and how far each claim is proven
(tiers T1 to T3 are defined under "Evidence reached").

## Sources and dates

All read or observed on 2026-11-17 unless a date is given.

- https://code.claude.com/docs/en/mcp.md (read 2026-10-22 and again 2026-11-17): user-scoped servers live in
  `~/.claude.json`; local scope is also in `~/.claude.json` (under the project entry); project scope is `.mcp.json` and
  needs interactive approval ("Pending approval"). Precedence: local, then project, then user, then plugin-provided
  servers, then claude.ai connectors. Duplicates are matched by name across scopes and the whole entry of the winner is
  used; fields are not merged. An organization's managed MCP configuration outranks all of them.
- Observed with Claude Code 2.1.322 in an isolated `HOME` (never the real one): `claude mcp add --scope user realm --
  realm mcp --host claude` printed "Added stdio MCP server realm ... to user config" and wrote `<tmp>/.claude.json`
  (mode 0600, 2-space indent, no trailing newline) holding Claude's own keys plus the entry shown below. With
  `CLAUDE_CONFIG_DIR` set, the same command wrote `<CLAUDE_CONFIG_DIR>/.claude.json` and left `HOME` untouched.
  `claude mcp get realm` printed the scope, the command and args and a health-check result (here a failure, because
  `realm` was not on that `PATH`: "Executable not found in $PATH: realm"), so `get` and `list` launch the registered
  command to check it.
- Claude Code's own `~/.claude.json` is a hot file: Claude rewrites it from its own process at any time and leaves
  `.claude.json.tmp.*` files beside it.

## Install with realm host

```bash
realm host install claude --dry-run
realm host install claude
realm host status claude
realm host uninstall claude
```

Each command prints one JSON line. `install` and `uninstall` print `{ id, status, dryRun, actions }` with `status` one
of `planned`, `installed`, `noop` or `removed` and each action `{ path, action, bytes }` (`path` relative to the home
that holds the file, no content). `status` prints `{ id, status, entries, launch }`: each entry is a path and one of the
states `ok`, `drifted` (the file parses and the owned entry differs or is absent), `missing` (the recorded file is
gone) or `unreadable` (the file is a symlink, over 1 MiB, not valid UTF-8 or not valid JSON: a reinstall cannot fix
that); `launch` is `on-path` or `not-on-path` and says whether the command `realm` resolves as an executable file in an
absolute directory of the `PATH` that the `realm host status` process sees. It is not Claude's own `PATH` (a launcher or
service may differ).

`--config-home <abs>` names the directory that holds `.claude.json`, not the `.claude` directory: that is `<home>`
(the user's home) unless `CLAUDE_CONFIG_DIR` is set, in which case it is that directory. It skips detection and must
exist. Install with no Claude Code session open: Claude rewrites the file while it runs.

## What changes

One file: `<home>/.claude.json` (override: `CLAUDE_CONFIG_DIR`, which moves both the file and the `.claude`
directory). Realm merges one entry at `mcpServers.realm`, the bytes `claude mcp add --scope user` writes (T1 golden,
from the observation above):

```json
{
  "mcpServers": {
    "realm": {
      "type": "stdio",
      "command": "realm",
      "args": ["mcp", "--host", "claude"],
      "env": {}
    }
  }
}
```

Every other key, the indent, the line endings, the trailing newline and the file mode are preserved; a missing file is
created with mode 0600. Realm never touches local-scope entries (under a project key in the same file), a project
`.mcp.json`, or `adapters/claude-plugin`. The registered command is the bare `realm`, resolved on Claude's `PATH`;
nothing absolute is written, so an upgrade or package move needs no reinstall.

## Manual registration and the host's own tools

By hand, the same entry is `claude mcp add --scope user realm -- realm mcp --host claude`. Realm reads the result as
follows:

- If an identical entry already exists, `realm host install claude` is a no-op that Realm does not own (it is not in
  the receipt), so `realm host uninstall claude` leaves it.
- A different `realm` entry is refused as `foreign-content`; nothing is written.
- `claude mcp remove realm -s user` deletes the key. `realm host status claude` then reports `drifted` and `realm host
  uninstall claude` is a clean no-op that clears the receipt.

## Project-level configuration and shadowing

Claude Code loads project scope from `.mcp.json` (after interactive approval) and local scope from the project entry in
`~/.claude.json`; local outranks project, which outranks user, so a `realm` entry at either narrower scope replaces
the entry Realm installed. A workload can write `.mcp.json` in the workspace. Never approve, trust or keep a `realm`
server you did not install. Realm itself writes and reads no project-level configuration, and the sandbox mount does
not hide these names. A read-only or hidden overlay is an open owner decision (OQ-24-03) and is not done here.

## Evidence reached

| Tier | Claim | Result |
| --- | --- | --- |
| T1 offline fixture | the recipe on a fixture host in a temporary home against the observed golden: detect, dry-run, install, no-op reinstall, drift, foreign content, hostile content, uninstall, doctor, `realm host status` | covered by the offline tests (`test/host/claude-recipe.test.ts`); the golden is the output of Claude Code 2.1.322 observed 2026-11-17 |
| T2 host validator | `claude mcp get realm` parses what the recipe wrote and launches the registered argv (a stub `realm` on `PATH` records it), in an isolated `HOME` | gated (`REALM_LIVE_CLAUDE=1`); **ran live on 2026-11-17 with Claude Code 2.1.322, 3 of 3 passed**, run twice (the second time from the merged tree): the real `claude mcp get` and `claude mcp list` parse the file the recipe wrote and launch the registered argv, the host's own `claude mcp add` and `claude mcp remove` interoperate with the recipe, and `CLAUDE_CONFIG_DIR` moves the file. The evidence is kept outside the repository. This shows the host parses and would launch the entry, not that a Realm session runs (see T3) |
| T3 live end to end | the real `realm` on `PATH`, `claude mcp list` health-checks a real MCP handshake (`server/discover` then `tools/list` for Claude Code 2.1.322), and the daemon is opened for a workspace | gated (`REALM_LIVE_PRODUCTION=1` plus `REALM_LIVE_CLAUDE=1`); **ran live on 2026-11-18 with Claude Code 2.1.322** on the production stack (rootless Podman 5.7.1 account, warm session): `claude mcp list` connected, the six Realm tools were on the wire, `realm status` answered active and the stack was clean before and after. The validator tier passed 3 of 3 the same day. A cold first attach exceeds the host connect timeout (GAP-31-04); evidence is kept outside the repository |

Not shown by any tier: that a running Claude session keeps using the entry after the file changes underneath it
(open question OQ-24-04); that a real model turn calls the Realm tools; and that Claude Code's start timeout outlasts a
cold first boot of up to 230 s (OQ-24-06; no recipe writes a timeout).

## Known limits

- A `~/.claude.json` over 1 MiB is refused as `unparseable`, and `status` says `unreadable`. Fallback: run the manual
  command in the section above; it is the host's own writer.
- Claude rewrites the file at any time. A change during install is refused as `concurrent-change` (`WRITE_NOT_ATOMIC`)
  and nothing is lost: run the command again. The window between the final hash check and the rename cannot be closed
  without a lock Claude does not honour (residual R-24-02), so install with no session open.
- A symlinked `~/.claude.json` (a dotfile manager) is refused (`symlink`); the refusal does not name a replacement
  path. Replace the symlink or run the manual command against the real file.
- `adapters/claude-plugin` is a separate route (validate it with `claude plugin validate`, below). Its `.mcp.json` runs
  `realm mcp --host claude`, so a session is attributed `claude` and attaches under the enforced capability-token
  default; `realm host` never installs it. Do not use both routes for the same server name.
- `realm doctor` names this file when it warns: a `host-plugins` warning for `claude` points at a file in the user's
  home that the receipt owns. Doctor reads only the files a receipt names, never a host binary or the environment.

## Add the server by hand (older snippet)

Stdio servers run as local processes. The documented add form is
`claude mcp add [options] <name> -- <command> [args...]`, where the `--`
double dash separates Claude's own options from the server command:

```bash
claude mcp add realm -- realm mcp --host claude
```

Each command writes to local scope unless `--scope project` or
`--scope user` is added. Check the connection with `claude mcp get realm`,
or `/mcp` inside a session.

## Project-shared form

To share the server with a team, add the entry under `mcpServers` in
`.mcp.json` at the project root and commit it. An entry with no `type` is
read as a stdio server:

```json
{
  "mcpServers": {
    "realm": {
      "command": "realm",
      "args": ["mcp", "--host", "claude"]
    }
  }
}
```

A project-scoped `.mcp.json` server shows "Pending approval" until it is approved by running `claude` interactively.

## Plugin bundle

The repository ships a Claude Code plugin bundle at `adapters/claude-plugin`,
which Grok Build shares. Validate it offline with the Claude Code validator
(run from `<repo>`; it does not start a session):

```bash
claude plugin validate adapters/claude-plugin
```

Expected result: exit 0 with "Validation passed with warnings". The warnings
are that the bundle has no author and no plugin icon (ICON_MISSING).

Loading the bundle for one session does not change any live Claude Code
configuration:

```bash
claude --plugin-dir adapters/claude-plugin
```

Installing it with `claude plugin install` is a separate step and is not part
of this snippet.

## Not documented

ACP: not documented in the pages read. The MCP reference page names no ACP
surface, so this snippet gives no ACP configuration.

# CodeBuddy Code snippet: Realm MCP server (stdio)

This snippet carries no token, secret, or host path. Placeholders: `<home>` is the user's home directory,
`<config home>` is the CodeBuddy directory, `<tmp>` a throwaway directory.

`realm host install codebuddy` registers `realm mcp --host codebuddy` in CodeBuddy's user-scope MCP file `.mcp.json`.
CodeBuddy is a config-only host: Realm edits one entry in that file and does not run CodeBuddy. One extra rule protects
the user's existing servers: Realm refuses to **create** `.mcp.json` next to a legacy MCP file, because creating it hides
the legacy one (see "Refusals and recovery"). The sections below say what it changes, what CodeBuddy's own commands do
about it, and how far each claim is proven (tiers T1 and T2 are defined under "Evidence reached"; no wave 2 host has a T3
tier).

## Sources and dates

All read or observed on 2026-11-17.

- https://www.codebuddy.ai/docs/cli/mcp: the user-scope file is `~/.codebuddy/.mcp.json` (JSONC allowed); the legacy
  fallbacks are `~/.codebuddy/mcp.json` (deprecated) and `~/.codebuddy.json`, and **the first existing file wins**; the
  default `--scope` is `local`, so `--scope user` is required; precedence is local, then project, then user; a project
  `.mcp.json` needs approval on first connect. Tier: documented.
- Observed with `@tencent-ai/codebuddy-code` 2.185.0 (fetched into a scratch directory with `npm install
  --ignore-scripts`, run with an isolated `HOME`, never installed): `codebuddy mcp add-json --scope user realm
  '{"type":"stdio","command":"realm","args":["mcp","--host","codebuddy"],"env":{"K":"v"}}'` wrote `{"mcpServers":
  {"realm":{...}},"disabledMcpServers":[]}` to `~/.codebuddy/.mcp.json`. `codebuddy mcp add --scope user realm2 -- ...`
  wrote a spurious `"print": true` key, so `add-json` is the command to use. **A new `.mcp.json` hides both legacy
  files:** with server `a` in `~/.codebuddy/mcp.json` (or at the top level of `~/.codebuddy.json`) and `realm` in a new
  `.mcp.json`, `codebuddy mcp list` showed only `realm` and `codebuddy mcp get a` answered "not found in any scope".
  `CODEBUDDY_CONFIG_DIR=<dir>` writes `<dir>/.mcp.json` (not `<dir>/.codebuddy/`); `CODEBUDDY_HOME` had no effect.
  `codebuddy mcp list` and `mcp get realm` launch the server as a health check, need no login and take 30 to 45 s.

## Install with realm host

```bash
realm host install codebuddy --dry-run
realm host install codebuddy
realm host status codebuddy
realm host uninstall codebuddy
```

Each command prints one JSON line. `install` and `uninstall` print `{ id, status, dryRun, actions }` with `status` one
of `planned`, `installed`, `noop` or `removed` and each action `{ path, action, bytes }` (`path` relative to the config
home, no content). `status` prints `{ id, status, entries, launch }`: each entry is a path and one of `ok`, `drifted`
(the file parses and the owned entry differs or is absent), `missing` (the recorded file is gone) or `unreadable` (a
symlink, a file over 1 MiB, invalid UTF-8, or JSON that does not parse, which includes JSON with comments); `launch` is
`on-path` or `not-on-path` and says whether `realm` resolves on the `PATH` that `realm host status` sees, which is not
necessarily CodeBuddy's own.

`--config-home <abs>` names the directory that holds `.mcp.json`, skips detection, and must exist: Realm never creates a
host home. CodeBuddy is detected by `~/.codebuddy` (or the `CODEBUDDY_CONFIG_DIR` directory) or by `codebuddy` on an
absolute `PATH` directory. Install with no CodeBuddy session open (residual R-25-02).

## What changes

One file: `<config home>/.mcp.json`, where `<config home>` is the `CODEBUDDY_CONFIG_DIR` directory when set to an absolute
path (the directory that directly holds `.mcp.json`), else `<home>/.codebuddy`. `CODEBUDDY_HOME` is not honoured because
CodeBuddy ignores it. Realm merges one entry at `mcpServers.realm` (T1 golden; the entry `codebuddy mcp add-json
--scope user` writes, without `env`):

```json
{
  "mcpServers": {
    "realm": {
      "type": "stdio",
      "command": "realm",
      "args": [
        "mcp",
        "--host",
        "codebuddy"
      ]
    }
  }
}
```

Every other key, the indent, the line endings, the trailing newline and the file mode are preserved; a missing file is
created (mode 0600). The command is the bare `realm`, resolved on CodeBuddy's `PATH`; nothing absolute is written.

What CodeBuddy does to the file when it rewrites it (observed 2.185.0): it drops an inline comment, injects
`"type": "stdio"` into an entry that lacks it, appends a trailing comma and a `"disabledMcpServers": []` key, and after
`add-json --scope user other ...` it leaves a plain-JSON `realm` entry value-identical with changed whitespace. Realm's
value already carries `type`, and ownership is by parsed value, so none of this is drift; uninstall leaves the host's
own additions.

## Manual registration and the host's own tools

The same entry by hand: `codebuddy mcp add-json --scope user realm
'{"type":"stdio","command":"realm","args":["mcp","--host","codebuddy"]}'` (`--scope user` is required; the default scope
is `local`). If an identical `mcpServers.realm` entry exists, `realm host install codebuddy` is a no-op that Realm does
not own (it is not in the receipt). A different `realm` entry is refused as `foreign-content`; remove it first with
CodeBuddy's own remover or by editing the file. If the entry Realm owns is deleted, `realm host status codebuddy`
reports `drifted` and `realm host uninstall codebuddy` is a clean no-op that deletes the receipt (the remover itself was
not exercised here). `codebuddy mcp list` and `codebuddy mcp get realm` are the host's own checks; they launch the
server and take 30 to 45 s.

## Refusals and recovery

- **A legacy file would be hidden.** If `.mcp.json` does not exist and either `<config home>/mcp.json` (deprecated) or
  `<home>/.codebuddy.json` exists, `realm host install codebuddy` is refused as `foreign-content` and nothing is written
  (a dry run too). The reason: CodeBuddy reads the first existing file, so a new `.mcp.json` would silently hide the
  servers in the legacy file. The refusal text is fixed and names no path; the log line is `host.install.refused`. The
  recovery is CodeBuddy's own command, which writes into the file CodeBuddy actually reads: `codebuddy mcp add-json
  --scope user realm '{"type":"stdio","command":"realm","args":["mcp","--host","codebuddy"]}'`. When `.mcp.json`
  already exists the guard does not run. The guard runs for install only, never for status or uninstall. With
  `CODEBUDDY_CONFIG_DIR` set, the legacy `~/.codebuddy.json` in the user's home still guards the install (conservative;
  OQ-25-11).
- A `.mcp.json` with comments or a trailing comma is refused as `unparseable` and nothing is written (`status` says
  `unreadable`). Realm's JSON engine is strict, although CodeBuddy allows JSONC and itself appends a trailing comma when
  it rewrites the file. Use the `add-json` command above, which keeps the host's own formatting, or move the comments
  out.
- A file over 1 MiB, invalid UTF-8, or a symlink on the path is refused. A change while the command runs is
  `concurrent-change`: run it again.
- A drifted entry makes `realm host uninstall codebuddy` refuse rather than guess: edit `mcpServers.realm` back to the
  fence above or delete it, then uninstall.

## Project-level configuration and shadowing

CodeBuddy resolves local scope, then project scope (a project `.mcp.json`, which needs approval on first connect), then
user scope. A workload can write a project `.mcp.json` into the workspace. **Never approve or trust a `realm` server
defined in a repository.** Realm writes and reads no project-level configuration, and the sandbox mount does not hide
these names (accepted residual R-25-01; hiding them is a Phase 19 decision).

## Evidence reached

| Tier | Claim | Result |
| --- | --- | --- |
| T1 offline fixture | the recipe on a fixture host in a temporary home: detect, dry-run, install, no-op reinstall, drift, foreign content, a commented file refused, hostile content, the `shadows` refusal with `mcp.json` in the config home and with `.codebuddy.json` in the user's home (dry run included), the guard skipped when `.mcp.json` exists and never run for status or uninstall, the host's own rewrite (re-indent, injected `type`, `disabledMcpServers`) staying `ok`, `CODEBUDDY_CONFIG_DIR` (and `CODEBUDDY_HOME` changing nothing), uninstall, doctor, `realm host status` | covered by the offline tests (`test/host/wave2-json-recipes.test.ts`, `test/host/codebuddy-recipe.test.ts`, `test/host/shadows.test.ts`) |
| T2 host validator | `codebuddy mcp list` parses the entry and launches the registered argv (a stub `realm` on `PATH` records it), in an isolated `HOME` and `CODEBUDDY_CONFIG_DIR`; 30 to 45 s | gated (`REALM_LIVE_CODEBUDDY=1`, optional `REALM_CODEBUDDY_BIN`; `test/integration/host-live-wave2.test.ts`); the gated rehearsal records no result yet. The 2.185.0 observation above was a manual scratch-directory run, not the gated test and not through `realm host install` |
| T3 live end to end | not defined for config-only hosts | none |

Not shown by any tier: that a long-running CodeBuddy session starts Realm; CodeBuddy's MCP start timeout against a cold
first boot of up to 230 s (OQ-24-06, carried); a CodeBuddy newer than 2.185.0 (OQ-25-10); where the legacy
`~/.codebuddy.json` is read when `CODEBUDDY_CONFIG_DIR` is set (OQ-25-11).

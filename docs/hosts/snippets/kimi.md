# Kimi snippet: Kimi CLI and Kimi Code, Realm MCP server (stdio)

This snippet carries no token, secret, or host path. Placeholders: `<home>` is the user's home directory,
`<config home>` is the product's directory, `<tmp>` a throwaway directory.

Moonshot has two products that share the command name `kimi`. `realm host install kimi` and `realm host install
kimi-code` register `realm mcp --host kimi` and `realm mcp --host kimi-code` in each product's user-level `mcp.json`.
Of everything in this phase, Kimi has the thinnest evidence: the formats come from official documentation, not from a
running host. The sections below say exactly what is and is not shown (tiers T1 to T3 are defined under "Evidence
reached").

## Which product is which

The flag question is resolved, from the GSD Core installer source read at commit 69d604e (`bin/install.js` maps
`--kimi` to runtime `kimi` and `--kimi-code` to runtime `kimi-code` and names them "Kimi CLI (Python, ~/.kimi/) and Kimi
Code (Node, ~/.kimi-code/) ... two distinct Moonshot products"):

| Realm id | Flag | Product | Config home | Override |
| --- | --- | --- | --- | --- |
| `kimi` | `--kimi` | Kimi CLI (Python) | `~/.kimi` | `KIMI_SHARE_DIR` |
| `kimi-code` | `--kimi-code` | Kimi Code (Node) | `~/.kimi-code` | `KIMI_CODE_HOME` |

(`realm host` itself accepts bare ids only; the flags are the installer's spelling in the table.) Because the command
name `kimi` is shared, Realm never detects either product by a binary: detection is by the home directory only, and
the `kimi` row has no `binaries`. `KIMI_SHARE_DIR` moves the Kimi CLI config home and never its skills home
(`~/.config/agents`).

**Kimi CLI is archived upstream.** https://github.com/MoonshotAI/kimi-cli (read 2026-11-17) is marked "[Archived]
Legacy Python Kimi CLI, no longer maintained. Please use Kimi Code CLI: https://github.com/MoonshotAI/kimi-code". The
last PyPI release, kimi-cli 1.52.0 (fetched into a scratch environment 2026-11-17), is a deprecation stub: every entry
point prints "kimi-cli is no longer maintained. Please use the new Kimi Code CLI." and exits 0 without writing
anything. kimi-cli 1.51.0 answered `--version`, but `kimi mcp add --transport stdio ...` did not return within 60 s in
an isolated `HOME` and wrote nothing; the cause was not found. No functional Kimi CLI was observed running. **Kimi Code
is the maintained successor.** Phase 24 ships both rows (one recipe shape, one shared test suite): the `kimi` row keeps
its `proven` tier by the owner's roadmap while its evidence tier is T1 only; the `kimi-code` row stays `config-only`.
Whether to keep the `kimi-code` row, drop it, or promote it in place of `kimi` is an owner decision (OQ-24-01); doing
either is a table-row and test-pin edit.

## Sources and dates

All read on 2026-11-17 (documentation; nothing here was observed running).

- Kimi CLI: https://moonshotai.github.io/kimi-cli/en/customization/mcp.html: "MCP server configuration is stored in
  `~/.kimi/mcp.json`, in a format compatible with other MCP clients", with `{"mcpServers": {"chrome-devtools":
  {"command": "npx", "args": [...]}}}`; commands `kimi mcp add|list|remove|test|auth`; `--mcp-config-file`.
  .../configuration/data-locations.html lists `config.toml` and `mcp.json` under `~/.kimi/`;
  .../configuration/env-vars.html: `KIMI_SHARE_DIR` "Customize the share directory path (default: ~/.kimi)". No
  project-level behavior is documented in anything read.
- Kimi Code: https://www.kimi.com/code/docs/en/kimi-code-cli/customization/mcp.html and
  .../configuration/data-locations.html and .../configuration/env-vars.html: user-level `~/.kimi-code/mcp.json`
  ("optional"); `KIMI_CODE_HOME` overrides the data root; project-level `.kimi-code/mcp.json` takes effect only after
  the folder is trusted at the startup prompt; a server added by editing `mcp.json` mid-session joins only sessions
  created later; same `mcpServers` shape. No host validator command is documented for Kimi Code in anything read
  (a third-party guide reported in a search summary, not read directly, says Kimi Code 0.34.0 has no `kimi mcp`
  subcommand: [INFERENCE]).
- On the verification machine, `~/.kimi/config.toml` and `~/.kimi-code/config.toml` exist (written by other tools'
  hook installs), neither has an `mcp.json`, and no `kimi` executable is on `PATH`.
- Node or Bun requirement of either product: not recorded in the pages read.

## Install with realm host

```bash
realm host install kimi --dry-run
realm host install kimi
realm host status kimi
realm host uninstall kimi
```

and the same four commands with `kimi-code`. Each prints one JSON line. `install` and `uninstall` print `{ id, status,
dryRun, actions }` with `status` one of `planned`, `installed`, `noop` or `removed` and each action `{ path, action,
bytes }` (`path` relative to the config home, no content). `status` prints `{ id, status, entries, launch }`: each entry
is a path and one of `ok`, `drifted` (the file parses and the owned entry differs or is absent), `missing` (the recorded
file is gone) or `unreadable` (a symlink, a file over 1 MiB, invalid UTF-8 or JSON that does not parse); `launch` is
`on-path` or `not-on-path` and says whether `realm` resolves on the `PATH` that `realm host status` sees, which is not
necessarily the host's own.

`--config-home <abs>` names the product directory (the one that holds `mcp.json`: `~/.kimi` or `~/.kimi-code`, or the
override), skips detection, and must exist: Realm never creates a host home. Pass the right directory for the right
product: nothing in the file can tell Realm which product reads it, and a wrong-product install reports success and
does nothing. Install with no Kimi session open.

## What changes

One file per product: `<config home>/mcp.json`, where `<config home>` is `KIMI_SHARE_DIR` (Kimi CLI) or
`KIMI_CODE_HOME` (Kimi Code) when set to an absolute path, else `<home>/.kimi` or `<home>/.kimi-code`. Realm merges one
entry at `mcpServers.realm`, the documented shape (T1 golden; it follows the documentation above, not an observation,
and [INFERENCE] `kimi mcp add --transport stdio` writes the same shape):

```json
{
  "mcpServers": {
    "realm": {
      "command": "realm",
      "args": ["mcp", "--host", "kimi"]
    }
  }
}
```

For `kimi-code` the last argument is `kimi-code`. Every other key, the indent, the line endings, the trailing newline and
the file mode are preserved; a missing file is created (mode 0600). The command is the bare `realm`, resolved on the
host's `PATH`; nothing absolute is written.

## Manual registration and the host's own tools

By hand, the entry in the fence above can be added to `mcp.json`; for Kimi CLI the documented `kimi mcp add` command
does the same through the host (not exercised here). If an identical entry already exists, `realm host install` is a
no-op that Realm does not own (not in the receipt). A different `realm` entry is refused as `foreign-content`. If the
entry is removed or edited by hand (or with `kimi mcp remove realm`, not exercised), `realm host status` reports
`drifted` and `realm host uninstall` removes only what Realm still owns, a clean no-op when nothing remains.

## Project-level configuration and shadowing

Kimi Code reads a project `.kimi-code/mcp.json` only after the folder is trusted at the startup prompt. For Kimi CLI no
project-level behavior is documented in anything read. A workload can write these files in the workspace: never trust a
folder, or keep a `realm` server, that you did not set up yourself. Realm itself writes and reads no project-level
configuration, and the sandbox mount does not hide these names. A read-only or hidden overlay is an open owner decision
(OQ-24-03) and is not done here.

## Kimi Code CLI 2.x, read 2026-11-17

Read on 2026-11-17 from the official Kimi Code pages (https://moonshotai.github.io/kimi-code/en/customization/mcp, https://moonshotai.github.io/kimi-code/en/reference/kimi-command and https://moonshotai.github.io/kimi-code/en/configuration/env-vars). Nothing here was observed running: no Kimi Code executable is installed on the verification machine. Where a third-party guide and an official page differ, the official page wins; they agree on the points below.

- **Where servers are declared.** `mcp.json`, at user level (`$KIMI_CODE_HOME/mcp.json`, default `~/.kimi-code/mcp.json`) and at project level (`.kimi-code/mcp.json`); a project entry overrides a user entry of the same name. Entries with a `command` field are stdio servers (optional `env`, `cwd`, `startupTimeoutMs`). In the TUI, `/mcp-config` adds, edits and deletes servers and `/mcp` shows their connection status.
- **No `kimi mcp` command.** The documented subcommands are `login`, `acp`, `web`, `app`, `install-desktop`, `doctor`, `export`, `migrate`, `import-sessions`, `upgrade`, `vis` and `provider`. The Python CLI's `kimi mcp add|list|remove|test|auth` group does not carry over.
- **No non-interactive validator for the MCP entry.** `kimi doctor` validates `config.toml` and `tui.toml` only. `/mcp` is a TUI command.
- **`kimi -p`.** `--prompt` runs one prompt non-interactively without the TUI. It needs a configured model: a login (`kimi login`) or a provider in `config.toml`. The pages do not say whether it runs without either.
- **Provider override.** `KIMI_MODEL_NAME` and `KIMI_MODEL_API_KEY` (both required) with optional `KIMI_MODEL_BASE_URL` and `KIMI_MODEL_PROVIDER_TYPE` (`kimi`, `anthropic` or `openai`) define a temporary provider in memory. A key is required, so a session against a loopback provider would carry a key-shaped header, unlike the Codex session drive [INFERENCE].
- **Headless runs and trust.** Project-level MCP servers stay disabled in a headless run unless the workspace is trusted (`KIMI_CODE_TRUST_WORKSPACE`); the recipe writes the user-level file.

This is why `kimi-code` is a named gap in [Host plugin gaps](../../integration/host-plugin-gaps.md) (GAP-24-02) and not a session rehearsal: the product is functional, but nothing here was installed, and there is no documented command that lists or launches a registered server without a session.

## Evidence reached

| Tier | Claim | Result |
| --- | --- | --- |
| T1 offline fixture | the recipe on a fixture host in a temporary home, for `kimi` and `kimi-code`: detect, dry-run, install, no-op reinstall, drift, foreign content, hostile content, uninstall, doctor, `realm host status`, the override variables, and the recipe value equal to the manifest launch for both | covered by the offline tests (`test/host/kimi-recipe.test.ts`); the goldens follow the official documentation read 2026-11-17 |
| T2 host validator | `kimi mcp test realm` launches the registered argv (only a functional Kimi CLI) | gated (`REALM_LIVE_KIMI=1`); **not run**: no `kimi` executable on the verification machine, and the one published release is the inert stub. **Not available for `kimi-code`**: no validator command is documented |
| T3 live end to end | a real Kimi session booting Realm | **gap, not run**. `kimi`: the Python CLI is archived and its last release is a deprecation stub, so no session can run. `kimi-code`: a functional product that is not installed on the verification machine, with no MCP validator command documented; none was attempted |

The named gaps: `kimi` has T1 only; `kimi-code` has T1 only; no Kimi session of either product has loaded Realm.

## Known limits

- The `kimi` row is the archived product. The recipe is correct only to the extent the documentation is.
- A file over 1 MiB, invalid UTF-8, non-JSON content or a symlink on the path is refused (`status` says `unreadable`).
  A change while the command runs is `concurrent-change`: run it again (residual R-24-02).
- A server added by editing `mcp.json` joins only sessions Kimi Code creates afterwards (documented), and the start
  timeout against a cold first boot of up to 230 s is unknown (OQ-24-06; a search summary reported a 30 s default for
  Kimi Code, not read directly).

ACP: not documented in the pages read, so this snippet gives no ACP configuration.

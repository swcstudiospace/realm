# Kimi snippet: Kimi CLI and Kimi Code, Realm MCP server (stdio)

This snippet carries no token, secret, or host path. Placeholders: `<home>` is the user's home directory,
`<config home>` is the product's directory, `<tmp>` a throwaway directory.

Moonshot has two products that share the command name `kimi`. `realm host install kimi` and `realm host install
kimi-code` register `realm mcp --host kimi` and `realm mcp --host kimi-code` in each product's user-level `mcp.json`.
Kimi had the thinnest evidence of the wave 1 hosts: until 2026-11-18 the formats came from official documentation, not
from a running host. On that day both products were run from scratch installs outside the repository: Kimi Code 2.6.3
passed its production tier, and the archived legacy kimi-cli 1.51.0 passed its validator tier but failed its production
tier. On 2026-11-19 the legacy kimi-cli 1.51.0 was run again: its validator tier passed again, and its production tier
did not pass its bound (three cold runs were answered with the six tool names, each slower than the test's own 25000 ms
bound), while the failure of 2026-11-18 was not reproduced and is not explained. The sections below say exactly what is
and is not shown (tiers T1 to T3 are defined under "Evidence reached").

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
anything. kimi-cli 1.51.0 answered `--version`, but on 2026-11-17 `kimi mcp add --transport stdio ...` did not return
within 60 s in an isolated `HOME` and wrote nothing; the cause was not found. On 2026-11-19 the same command with `--env`
returned exit 0 in an isolated home and wrote an `mcp.json` (see "Kimi CLI (legacy), observed 2026-11-19"); the hang of
2026-11-17 was not seen again and stays unexplained. On 2026-11-18 kimi-cli
1.51.0, pinned and installed from its PyPI wheel into a scratch environment, ran `kimi mcp list`, `kimi mcp test` and
`kimi mcp remove` against the recipe's file. **Kimi Code is the maintained successor and the supported product.** Phase
24 ships both rows (one recipe shape, one shared test suite): the `kimi` row keeps its `proven` tier by the owner's
roadmap while its production tier did not pass on 2026-11-18 or on 2026-11-19 (see "Evidence reached"); the `kimi-code` row stays
`config-only` and was rehearsed.
Whether to keep the `kimi-code` row, drop it, or promote it in place of `kimi` is an owner decision (OQ-24-01); doing
either is a table-row and test-pin edit.

## Sources and dates

Documentation read on 2026-11-17 (nothing in this list was observed running); the pages and registry reads of 2026-11-18
follow the list.

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

Read on 2026-11-18, with the scratch installs described under "Observed 2026-11-18":

- Kimi Code repository: https://github.com/MoonshotAI/kimi-code. Kimi Code pages (Markdown variants):
  https://moonshotai.github.io/kimi-code/en/customization/mcp.html (the `mcp.json` shape, `startupTimeoutMs` with a
  default of 30000, reconnect with backoff), https://moonshotai.github.io/kimi-code/en/reference/kimi-command.html (the
  subcommands, `kimi doctor`, `kimi -p`) and https://moonshotai.github.io/kimi-code/en/configuration/env-vars.html
  (`KIMI_CODE_HOME`, the telemetry and update switches, the `KIMI_MODEL_*` provider variables).
- npm registry, https://registry.npmjs.org/@moonshot-ai/kimi-code: version 2.6.3 (`latest`), Node `>=22.19.0`, the
  integrity value that the installed lockfile equals.
- PyPI, https://pypi.org/pypi/kimi-cli/json: kimi-cli 1.51.0 (uploaded 2026-09-21) and the archived 1.52.0 stub
  (Python `>=3.12`); the SHA-256 of the 1.51.0 wheel equals the installed download.
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
and observed on 2026-11-19: the host's own `kimi mcp add --transport stdio` writes the same members in the same order, plus an `env` member when `--env` is given, with no trailing newline):

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
does the same through the host (exercised on 2026-11-19, with `--env`). If an identical entry already exists, `realm host install` is a
no-op that Realm does not own (not in the receipt). A different `realm` entry is refused as `foreign-content`. If the
entry is removed or edited by hand (or with `kimi mcp remove realm`, which the validator tier of 2026-11-18 exercised), `realm host status` reports
`drifted` and `realm host uninstall` removes only what Realm still owns, a clean no-op when nothing remains.

## Project-level configuration and shadowing

Kimi Code reads a project `.kimi-code/mcp.json` only after the folder is trusted at the startup prompt. For Kimi CLI no
project-level behavior is documented in anything read. A workload can write these files in the workspace: never trust a
folder, or keep a `realm` server, that you did not set up yourself. Realm itself writes and reads no project-level
configuration, and the sandbox mount does not hide these names. A read-only or hidden overlay is an open owner decision
(OQ-24-03) and is not done here.

## Kimi Code CLI 2.x, read 2026-11-17

Read on 2026-11-17 from the official Kimi Code pages (https://moonshotai.github.io/kimi-code/en/customization/mcp, https://moonshotai.github.io/kimi-code/en/reference/kimi-command and https://moonshotai.github.io/kimi-code/en/configuration/env-vars). The bullets below are the documentation; the observations of 2026-11-18 follow them. Where a third-party guide and an official page differ, the official page wins; they agree on the points below.

- **Where servers are declared.** `mcp.json`, at user level (`$KIMI_CODE_HOME/mcp.json`, default `~/.kimi-code/mcp.json`) and at project level (`.kimi-code/mcp.json`); a project entry overrides a user entry of the same name. Entries with a `command` field are stdio servers (optional `env`, `cwd`, `startupTimeoutMs`). In the TUI, `/mcp-config` adds, edits and deletes servers and `/mcp` shows their connection status.
- **No `kimi mcp` command.** The documented subcommands are `login`, `acp`, `web`, `app`, `install-desktop`, `doctor`, `export`, `migrate`, `import-sessions`, `upgrade`, `vis` and `provider`. The Python CLI's `kimi mcp add|list|remove|test|auth` group does not carry over.
- **No non-interactive validator for the MCP entry.** `kimi doctor` validates `config.toml` and `tui.toml` only. `/mcp` is a TUI command.
- **`kimi -p`.** `--prompt` runs one prompt non-interactively without the TUI. It needs a configured model: a login (`kimi login`) or a provider in `config.toml`. The pages do not say whether it runs without either.
- **Provider override.** `KIMI_MODEL_NAME` and `KIMI_MODEL_API_KEY` (both required) with optional `KIMI_MODEL_BASE_URL` and `KIMI_MODEL_PROVIDER_TYPE` (`kimi`, `anthropic` or `openai`) define a temporary provider in memory. A key is required, so a session against a loopback provider would carry a key-shaped header, unlike the Codex session drive [INFERENCE].
- **Headless runs and trust.** Project-level MCP servers stay disabled in a headless run unless the workspace is trusted (`KIMI_CODE_TRUST_WORKSPACE`); the recipe writes the user-level file.

Because no documented command lists or launches a registered server without a session, the validator tier of `kimi-code` is a session proof, and GAP-24-02 in [Host plugin gaps](../../integration/host-plugin-gaps.md) is narrowed, not closed.

### Observed 2026-11-18

Kimi Code 2.6.3 was installed from the npm package at that exact version into a scratch directory outside the repository (`npm install --ignore-scripts`; the lockfile integrity equals the registry value; the install is removed after the window) and run on the production stack's account.

- **No validator command.** `kimi mcp` is an unknown command (`unknown command 'mcp'`), so no host command checks the entry; `kimi doctor` exits 0 and does not read `mcp.json`.
- **The session launches the entry.** `kimi -p` with a temporary provider (`KIMI_MODEL_NAME`, the one fixed non-secret placeholder `KIMI_MODEL_API_KEY`, `KIMI_MODEL_BASE_URL` set to a loopback provider that refuses every request, `KIMI_MODEL_PROVIDER_TYPE` set to `openai`) started `realm mcp --host kimi-code` before any model request: the server saw `initialize`, `notifications/initialized` and `tools/list`, and the six Realm tools were listed (the validator session was ready after 12005 ms with 0 provider requests; the production run showed the same wire).
- **The model request is retried.** In the production run the host command took 37405 ms because Kimi Code retries the refused model request; the drive ended it once the boot was observed. The provider saw 6 requests, every one carrying the placeholder key, all from loopback peers.
- **The whole environment is forwarded.** The server saw every name of the host's environment, including `KIMI_MODEL_API_KEY` (the placeholder), unlike the legacy CLI.
- **Containment.** The update and telemetry switches were set in every run and a dead proxy in the validator runs; the production runs did not measure the CLI's own network use (GAP-43-02).
- **Not shown.** No model turn and no tool call (GAP-31-02); one version (GAP-31-03).

## Kimi CLI (legacy), observed 2026-11-19

kimi-cli 1.51.0 was installed again from its PyPI wheel (the SHA-256 equals the registry value) into a scratch environment outside the repository and run on the production stack's account in the Phase 47 window; the scratch install is removed.

- **The production tier did not pass its bound.** Three default cold runs of `kimi mcp test realm`, with the three names restored by the recorder, printed the connected line and the six tool names, and the recorder logged the six names each time. Each run took longer than the test's own 25000 ms cold connect bound (28804, 31393 and 32301 ms, on a host under load; the legacy client alone against a fake MCP server takes about 30 s). The tier is not recorded as passed.
- **The failure of 2026-11-18 was not reproduced.** Its cause is not established (GAP-43-03, narrowed, not closed). Only as an inference, not a result: the client was seen to kill the stdio server a few milliseconds after the `tools/list` response, and the recorder writes its log line after it forwards the bytes, so a recorder log can miss its last lines.
- **Which environment names are needed.** Variants that restore a subset of the three names (diagnostic variants, never the tier), each run twice, on one non-default production stack: `XDG_CONFIG_HOME` and `XDG_RUNTIME_DIR` are needed (without either, the stack is not reached), `REALM_DRIVER_SOCKET` is not needed, and with nothing restored `realm mcp` exits at start with `SCHEMA_INVALID` and the stack is not reached. Whether a default config location needs `XDG_CONFIG_HOME` is not shown.
- **References are not expanded.** An `env` block of `${NAME}`, of `$NAME` and of a plain literal reached the server as the reference text for both reference spellings and unchanged for the literal. A recipe `env` block of references therefore cannot work.
- **The host's own writer.** `kimi mcp add --transport stdio --env NAME=VALUE realm -- realm mcp --host kimi` returned exit 0 in an isolated home and wrote an `mcp.json` whose `realm` entry has the members `command`, `args` and `env` in that order, indent 2 and no trailing newline; the recipe's file has no `env` member and ends with a newline. Passing the flag twice was not observed.
- **Not shown.** A warm control, a model turn or a tool call (GAP-31-02), a second version (GAP-31-03), the network use of the CLI (GAP-43-02).

## Evidence reached

| Tier | Claim | Result |
| --- | --- | --- |
| T1 offline fixture | the recipe on a fixture host in a temporary home, for `kimi` and `kimi-code`: detect, dry-run, install, no-op reinstall, drift, foreign content, hostile content, uninstall, doctor, `realm host status`, the override variables, and the recipe value equal to the manifest launch for both | covered by the offline tests (`test/host/kimi-recipe.test.ts`); the goldens follow the official documentation read 2026-11-17 |
| T2 host validator | `kimi mcp test realm` launches the registered argv (only a functional Kimi CLI); for `kimi-code` a session proof, because no validator command exists | `kimi`: gated (`REALM_LIVE_KIMI=1`); **ran live 2026-11-18 and again 2026-11-19, kimi-cli 1.51.0, 2 of 2 passed each time** (`kimi mcp list`, `kimi mcp test` and `kimi mcp remove` against the stub realm, and a session step against a fake MCP server; the legacy CLI forwards only `HOME` and `PATH` to the server, GAP-43-01). `kimi-code`: gated (`REALM_LIVE_KIMI_CODE=1`); **ran live 2026-11-18, Kimi Code 2.6.3, 2 of 2 passed** as a session proof (`kimi doctor` exits 0, `kimi mcp` is an unknown command, and the `kimi -p` session launched the registered server and listed the six tools) |
| T3 live end to end | a real Kimi session booting Realm on the production stack | `kimi`: **rehearsal failed, kimi-cli 1.51.0**. 2026-11-18: `kimi mcp test realm` exited 0 after 18225 ms and sent `tools/list`, but the recorder saw no tool names. 2026-11-19: three default cold runs were answered with the six tool names and each exceeded the test's own 25000 ms bound (28804, 31393 and 32301 ms, on a loaded host), so the tier did **not** pass its bound; the failure of 2026-11-18 was not reproduced and its cause is not established (GAP-43-03). `kimi-code`: **rehearsed, 2026-11-18, Kimi Code 2.6.3**, cold with no warm-up: a `kimi -p` session against a refusing loopback provider launched `realm mcp --host kimi-code`, the wire shows the handshake, `tools/list` and the six tools, and the provider saw 6 requests all with the one placeholder key. No model turn and no tool call (GAP-31-02) |

The named gaps: the legacy `kimi` production tier did not pass its bound and its 2026-11-18 failure is unexplained (GAP-43-03); its reachability of a non-default stack needs the manual workaround below, because no recipe `env` block is possible (GAP-43-01); the network use of both CLIs is not measured (GAP-43-02); one version each (GAP-31-03). Kimi Code is the supported product; the legacy CLI is archived.

## Legacy Kimi CLI: environment names for a non-default stack

The recipe's entry has no `env` block, and none is possible: the legacy client forwards only `HOME` and `PATH` to a stdio server and does not expand `${NAME}` or `$NAME` in an env value (observed 2026-11-19), so an entry would have to hold literal values, which a bare recipe never does. On the one non-default production stack observed, the names that must reach `realm mcp` are exactly `XDG_CONFIG_HOME` and `XDG_RUNTIME_DIR`; `REALM_DRIVER_SOCKET` was not needed there. Register the server with the host's own command, one `--env NAME=VALUE` for each name, with the values from your own environment:

```bash
kimi mcp add --transport stdio --env XDG_CONFIG_HOME=VALUE realm -- realm mcp --host kimi
```

The example shows one name; the second name is added the same way (repeating the flag was not observed) or by adding both names to the `env` object of the `realm` entry in `mcp.json` by hand. Do not run `realm host install kimi` over an entry written this way: a different `realm` entry is refused as `foreign-content`; whether `realm host status` reports a host-written entry as `drifted` was not observed. An install-time capture capability that records these names is planned in its own later phase (decision of 2026-11-19) and is not implemented.

## Known limits

- The `kimi` row is the archived legacy product. Its production tier failed on 2026-11-18 and did not pass its 25000 ms bound on 2026-11-19, and it forwards only `HOME` and `PATH` to a stdio server without expanding references, so the recipe (which writes no `env` block, and cannot) does not reach a non-default stack without the manual workaround above (GAP-43-01).
- A file over 1 MiB, invalid UTF-8, non-JSON content or a symlink on the path is refused (`status` says `unreadable`).
  A change while the command runs is `concurrent-change`: run it again (residual R-24-02).
- A server added by editing `mcp.json` joins only sessions Kimi Code creates afterwards (documented). The documented
  default start timeout of Kimi Code is 30000 ms (OQ-24-06 narrowed: `realm mcp` answers the handshake and `tools/list`
  at once on a cold first attach, and the Kimi Code production tier listed the tools on a cold attach; a Kimi Code
  run against a bring-up longer than the default is not shown).
  The 60 s `kimi mcp add` hang of 2026-11-17 was not seen on 2026-11-19 and stays unexplained.

ACP: not documented in the pages read, so this snippet gives no ACP configuration.

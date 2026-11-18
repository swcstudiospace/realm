# Hermes Agent snippet: Realm MCP server (stdio)

Source: `docs/integration/hosts.md` Hermes Agent section (read 2026-10-21).
Official page read 2026-10-22:
https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp (MCP
configuration).

Realm serves MCP over stdio through its `realm` command with the `mcp`
argument. This snippet carries no token, secret, or host path.

`realm` is not on `PATH` on the verification host. Install or link the `realm`
binary first, or give the absolute path to it in place of `realm` below.

## Install with realm host

`realm host install hermes` registers `realm mcp --host hermes` in Hermes Agent's `config.yaml`. Hermes is a
config-only host: Realm edits one entry in that file and does not run Hermes. It is the only YAML host, so Realm owns
the entry by key and parsed value, never by a comment marker. The sections below say what it changes, what Hermes's own
commands do about it, and how far each claim is proven (tiers T1 and T2 are defined under "Evidence reached"; no wave 2
host has a T3 tier). Placeholders: `<home>` is the user's home directory, `<config home>` is the Hermes directory,
`<tmp>` a throwaway directory.

### Sources and dates

All read or observed on 2026-11-17 unless a date says otherwise.

- https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp (read 2026-10-22 and again 2026-11-17): the file is
  `~/.hermes/config.yaml`, the top-level key is `mcp_servers` (not `mcpServers`), a stdio server is `command`, `args`,
  `env`; an HTTP server uses `url`; `HERMES_HOME` relocates the home (`HERMES_DATA_DIR_SUFFIX` and profiles also exist and
  are not handled). Tier: documented.
- The host's own code was read and run from a local checkout of NousResearch/hermes-agent v0.23.2 (2026-11-16), with its
  dependencies installed into a scratch directory: `hermes_cli.mcp_config._save_mcp_server` against a file with a header
  comment, an inline comment, `model.default` and no `mcp_servers` appended `_config_version` if missing and wrote the
  entry with the comments preserved (a comment-preserving round trip), file mode 0600, atomic replace. `hermes mcp list`
  parses the entry without launching it; `hermes mcp test realm` launches it. The `hermes` command itself was **not**
  run: the install on the verification machine is broken (`hermes --version` prints "no dependency environment is
  committed for this install; run `hermes pm repair`" and fails, and `hermes pm repair` was not run because it would
  touch the real home).
- The shape of the real Hermes file on the verification machine was read (no value recorded): about 112 KB, LF line
  endings, no tab, no BOM, no document marker, no merge key, anchor-looking tokens only inside comments, `mcp_servers:`
  in the middle of the file with 2-space children and `enabled: true` on every entry. Such a file passes Realm's scanner.

### Install

```bash
realm host install hermes --dry-run
realm host install hermes
realm host status hermes
realm host uninstall hermes
```

Each command prints one JSON line. `install` and `uninstall` print `{ id, status, dryRun, actions }` with `status` one
of `planned`, `installed`, `noop` or `removed` and each action `{ path, action, bytes }` (`path` relative to the config
home, no content). `status` prints `{ id, status, entries, launch }`: each entry is a path and one of `ok`, `drifted`
(the file is readable and the owned entry differs), `missing` (the file is gone, or the file is there and the owned entry
is not) or `unreadable` (a symlink, a file over 1 MiB, invalid UTF-8, or YAML the scanner will not read, see
"Refusals and recovery"); `launch` is `on-path` or `not-on-path` and says whether `realm` resolves on the `PATH` that
`realm host status` sees, which is not necessarily Hermes's own.

`--config-home <abs>` names the Hermes directory itself (the one that holds `config.yaml`), skips detection, and must
exist: Realm never creates a host home. Hermes is detected by `~/.hermes` (or the `HERMES_HOME` directory) or by `hermes`
on an absolute `PATH` directory. Install with no Hermes session open (residual R-25-02).

### What changes

One file: `<config home>/config.yaml`, where `<config home>` is the `HERMES_HOME` directory when set to an absolute
path, else `<home>/.hermes`. Realm adds one block-style entry under `mcp_servers` (T1 golden; the entry Hermes's own
writer produces, with plain scalars):

```yaml
mcp_servers:
  realm:
    command: realm
    args:
      - mcp
      - --host
      - hermes
```

Realm appends the `mcp_servers:` block at the end of the file when it is absent; when it is present it inserts the
`realm` child under it, in the file's own child indent (default 2) and its own line ending (LF or CRLF). Everything
outside the owned lines stays byte for byte: comments, blank lines, other children, quoting and indentation. A file Realm
creates holds `mcp_servers:` and the entry only (mode 0600), and uninstall removes it. Other files in the Hermes
directory (a `.env` with secrets, for instance) are never read or changed. The command is the bare `realm`, resolved on
Hermes's `PATH`; nothing absolute is written. The Agent Plugins bundle `adapters/hermes-agent` is not read by an install
and is unchanged.

What Hermes does to the file when it rewrites it: its writer keeps comments, may re-quote or re-flow the entry (flow
`args`, quotes) and adds `_config_version` if it is missing. Ownership is by parsed value, so a re-quoted or re-flowed
entry with the same value stays `ok`. **A rewrite that adds a key to Realm's entry (for example `enabled: true`, which
other tools wrote on every entry of the real file) is drift:** `realm host status hermes` says `drifted` and `realm host
uninstall hermes` refuses (open question OQ-25-10); edit the entry back to the fence above or delete it, then uninstall.

### Manual registration and the host's own tools

There is no documented one-command equivalent that writes this exact entry: `hermes mcp add` first launches the server as
a probe and saves a failed one only after an interactive confirmation, with `enabled: false`, so it is not what Realm
copies; edit `config.yaml` by hand from the fence above. If an identical `mcp_servers.realm` entry exists (written by
hand or by Hermes's own writer), `realm host install hermes` is a no-op that Realm does not own (it is not in the
receipt). A different `realm` entry is refused as `foreign-content`; that includes the flow-style `realm` entry with
`args: ["mcp"]` shown under "Configuration file" below, which has no `--host`, and an entry with an extra key such as
`enabled`. If Hermes's own remover (or you) deletes the entry Realm owns, `realm host status hermes` reports `missing`
and `realm host uninstall hermes` is a clean no-op that deletes the receipt. `hermes mcp list` parses the entry without
launching it, and `hermes mcp test realm` launches it; both are the host's own checks.

### Refusals and recovery

Realm's YAML scanner is a conservative line scanner, not a YAML parser, and every doubt is a refusal.

- Refused as `unparseable`, nothing written: a file over 1 MiB; a NUL or a BOM; a Unicode line break other than LF, a
  lone CR or mixed line endings; a tab used for indentation; a flow-style root (`{` or `[` as the first non-comment
  character); a document marker (`---` or `...`) or a `%` directive; an anchor (`&x`), alias (`*x`) or tag (`!x`) token
  anywhere outside a comment (a token such as ` *x` inside a plain scalar is a false positive, which is safe); a merge key
  (`<<:`); a complex key (`? `); a quote that does not close on its line; and any line the scanner cannot classify.
- Refused as `foreign-content`, nothing written: a duplicate `mcp_servers` parent or a duplicate `realm` child; a parent
  that is a scalar, a sequence, `null` or `~`, or a flow mapping other than exactly `{}`; and a `realm` entry that is
  not exactly the recipe's value.
- The fallback is a manual edit of `config.yaml` from the fence above (or `hermes mcp add`, with the caveats above), or
  cleaning the file of the construct named. A file with an anchor in a comment only passes.
- A symlink on the path is refused; a change while the command runs is `concurrent-change`: run it again.

### Project-level configuration and shadowing

No project-level MCP configuration for Hermes was found in the source read. If one exists, **never approve or trust a
`realm` server defined in a repository** (accepted residual R-25-01). Realm writes and reads no project-level
configuration, and the sandbox mount does not hide any such names.

### Evidence reached

| Tier | Claim | Result |
| --- | --- | --- |
| T1 offline fixture | the recipe on a fixture host in a temporary home against goldens recorded from the host's own writer and its documentation: the scanner's refusal table (each case nothing written), a file shaped like the real one installing and uninstalling to the original bytes, the host's own output being a no-op Realm does not claim, a re-quoted or re-flowed entry staying `ok`, an added `enabled: true` being drift with uninstall refusing, a created file mode 0600, `HERMES_HOME`, uninstall, doctor, `realm host status` | covered by the offline tests (`test/host/hermes-recipe.test.ts`, `test/host/yaml-scan.test.ts`, `test/host/yaml-owned.test.ts`) |
| T2 host validator | `hermes mcp list` parses the entry and `hermes mcp test realm` launches the registered argv (a stub `realm` on `PATH` records it), in an isolated `HOME` and `HERMES_HOME` | passed on 2026-11-18, Hermes Agent 0.23.1, base commit e32bb05: `REALM_LIVE_HERMES=1 REALM_TEST_TIMEOUT_SCALE=3 node --test dist/test/integration/host-live-wave2.test.js`, 9 tests, 1 pass (hermes), 8 skipped by their unset opt-ins; the scenario took about 26 s and the operator's real `config.yaml` was byte-equal before and after (`test/integration/host-live-wave2.test.ts`). A fresh Hermes data root makes `hermes --version` fail until the first command bootstraps it (about 20 s here), so the gate's version probe now runs `hermes mcp list` once in its throwaway data root first (`test/support/host-live.ts`). A manual run against a fake server that answers the handshake showed `hermes mcp list` with the `realm` row enabled and `hermes mcp test realm` with Connected and 6 tools discovered, exit 0. The result covers 0.23.1 only |
| T3 live end to end | not defined for config-only hosts | none |

Not shown by any tier: that the real `realm` is started by the `hermes` command (the 2026-11-18 run started a stub and a fake server, not the real `realm`; the CLI that failed `--version` on the earlier verification machine was a fresh data root that had not been bootstrapped); Hermes's MCP start timeout against a cold first boot of up to 230 s (OQ-24-06, carried); a Hermes
newer than v0.23.2 (OQ-25-10). The owner may drop the recipe and keep the Agent Plugins bundle as the only route (open
question OQ-25-05).

## Configuration file

MCP servers are declared under `mcp_servers` in `~/.hermes/config.yaml`.
"Local stdio servers and remote HTTP MCP servers" are supported "in the same
config", with "automatic tool discovery and registration at startup". Add this
entry, then start Hermes with `hermes chat`:

```yaml
mcp_servers:
  realm:
    command: "realm"
    args: ["mcp", "--host", "hermes"]
```

This mirrors the page's minimal stdio example, which uses `command` and
`args` for a local subprocess server. No `env` is needed: the Realm entry takes
no token. Per-server tool filtering (`tools.include` / `tools.exclude`) is
available on the same page when only part of the Realm tool surface should be
exposed.

## Plugin bundle

The repository ships a Hermes Agent Plugins v1 (portable) bundle at
`adapters/hermes-agent`. It has `plugin.json` (name `realm`, trust
`untrusted`) and `mcp.json` (stdio server `realm`, command `realm`, args
`["mcp", "--host", "hermes"]`). It has no Python code. The native `plugin.yaml` is not part of the
bundle.

Validate it with the Hermes validator, using an isolated `HERMES_HOME` (run
from `<repo>`):

```bash
env HERMES_HOME=<scratch> hermes plugins validate adapters/hermes-agent
```

Expected result: exit 0 with "Validation passed." and an isolation line that
reads "portable plugin (no Python)".

Installing the bundle into `~/.hermes/plugins` changes the user's Hermes
configuration and is not part of this snippet. Hosts configured by hand can
use `adapters/hermes-agent/mcp.snippet.yaml`, the manual `mcp_servers` form
shown above.

## Not documented

ACP as a way to consume an MCP server: not documented in the pages read. The
page documents `hermes acp` only for running Hermes itself as an ACP server, so
this snippet gives no ACP configuration.

# Deferred hosts: windsurf, trae and zcode

This page carries no token, secret, or host path. Placeholders: `<home>` is the user's home directory.

Phase 25 decides per host, on evidence, whether `realm host install` ships a recipe. A host gets a recipe only if (a) its
official documentation names the file and the entry shape, **and** (b) the shape was observed on a running host, or at
least two official pages agree and the file is MCP-only plain JSON. A host is deferred when that fails, when the product
is renamed or archived in a way that makes the target ambiguous, or when the file is the native config of a GUI-owned
application that cannot be observed here.

Three hosts are deferred. The owner approved each deferral on 2026-11-17. Each keeps no recipe, so for each of them
`realm host install <id>` (and `--dry-run`) is refused as `recipe-pending` (`POLICY_DENIED`) and changes nothing,
`realm host status <id>` reports `recipe-pending`, and `realm host uninstall <id>` is a no-op. The table rows keep their
flag, aliases, display name and detection home; only a comment in `src/host/runtimes.ts` records the reason and the
open-question id. Lifting a deferral costs one table row plus one fixture suite.

All evidence below was read or observed on 2026-11-17. Tier letters: documented (an official page read), observed (the
host run in an isolated home, a fetched copy, nothing installed), third-party (a report not read from an official source),
inference (not verified; also marked [INFERENCE]).

## windsurf (renamed Devin Desktop)

Table row: id `windsurf`, flag `--windsurf`, alias `devin-desktop`, detection home `~/.codeium/windsurf`. Decision:
**defer** (open question OQ-25-01).

**Reason.** The product was renamed, and two different MCP files now exist, so the target of a recipe is ambiguous. The
Desktop IDE itself was not observed.

**Evidence.**

- https://docs.devin.ai/desktop/devin-desktop-faq.md and https://docs.devin.ai/desktop/changelog.md (documented):
  Windsurf became **Devin Desktop** on 2026-06-02 (current v3.13.4); windsurf.com and docs.windsurf.com redirect to
  devin.ai; Cascade is now "Cascade (legacy)" and the default agent is Devin Local, which shares its harness with the
  Devin CLI.
- Legacy Cascade file `~/.codeium/windsurf/mcp_config.json` (key `mcpServers`): documented only in a Wayback snapshot
  (2026-02-28) of docs.windsurf.com/windsurf/cascade/mcp, which is no longer in the current documentation (documented,
  archived).
- Devin Local and the Devin CLI file `~/.config/devin/mcp_config.json` (since v3000.3; older versions kept `mcpServers`
  inside `~/.config/devin/config.json` and auto-migrate), project files `.devin/mcp_config.json` and
  `.devin/mcp_config.local.json`; the format is "JSON with comments" (documented:
  https://docs.devin.ai/cli/extensibility/mcp/configuration.md and
  https://docs.devin.ai/desktop/devin-local/customizations.md). The Devin CLI imports the legacy Cascade file by default
  (documented: https://docs.devin.ai/cli/reference/configuration/read-config-from.md).
- Observed with the Devin CLI 3000.13.4 (fetched from `cli.devin.ai/install.sh`, no login, isolated home): `devin mcp add
  -s user realm -- cmd mcp --host devin` wrote `{"mcpServers":{"realm":{"command":"cmd","args":["mcp","--host","devin"],
  "transport":"stdio"}}}` to `~/.config/devin/mcp_config.json` (the default scope is local); `devin mcp list` launches the
  server. The Desktop IDE was not observed, and no configuration-directory variable is documented (`WINDSURF_CONFIG_DIR`
  is a GSD Core name only).

**Today.** `realm host install windsurf` refuses `recipe-pending` and changes nothing. A user who wants Realm in Devin
Desktop or the Devin CLI registers it by hand (`devin mcp add -s user realm -- realm mcp --host windsurf`, or the JSON
entry in `~/.config/devin/mcp_config.json`); that route is not covered by any test here.

**Alternative the owner could choose.** Ship `~/.config/devin/mcp_config.json` with `mcpServers.realm = {command: "realm",
args: ["mcp", "--host", "windsurf"], transport: "stdio"}` (observed with the Devin CLI, documented for Devin Local), or the
legacy `~/.codeium/windsurf/mcp_config.json` (Cascade legacy only, archived evidence), or both. The file is JSON with
comments, so Realm's strict JSON engine would refuse a commented file (open question OQ-25-06). The detection home would
change with the choice, and the id and alias need a decision: keep the id `windsurf` with the alias `devin-desktop`, or
rename the host (the id is a `--host` value in `realm mcp`).

## trae

Table row: id `trae`, flag `--trae`, detection home `~/.trae`. Decision: **defer** (open question OQ-25-02).

**Reason.** "Trae" names three different products and no official page names a global MCP file for any of them. The only
tested paths are third-party reports.

**Evidence.**

- Trae IDE (https://docs.trae.ai/ide/add-mcp-servers, documented): Settings, MCP, "Raw Config (JSON)" opens TRAE's own
  `mcp.json`, but the page names **no global path**; the project file `<project>/.trae/mcp.json` sits behind a "Project
  MCP" setting that is off by default. The only tested path is **third-party**: https://github.com/vshulcz/deja-vu/issues/4731
  (IDE 3.5.104 on macOS) reports an application-data file `~/Library/Application Support/Trae/User/mcp.json` and that the
  IDE rejects a `type` key; the Linux path `~/.config/Trae/User/mcp.json` is [INFERENCE].
- TRAE CLI 2.0 (`traecli`): the only description is a **third-party** pull-request report (cc-switch #8759): file
  `~/.trae/traecli.toml`, tables `[mcp_servers.<id>]`, honouring `TRAE_HOME`. The installer fetch answered HTTP 403 and
  the official Chinese-language page was not readable, so nothing official was read.
- bytedance/trae-agent: a project-local `trae_config.yaml` with an `mcp_servers` map; last commit 2026-02-05, no release,
  not on PyPI.
- `~/.trae` holds rules, skills and hooks, not a global MCP file. GSD Core registers no MCP server for trae. Trae was
  never installed or run.

**Today.** `realm host install trae` refuses `recipe-pending` and changes nothing.

**Alternative the owner could choose.** A `toml-table` recipe for `[mcp_servers.realm]` in `~/.trae/traecli.toml` (the
engine kind already exists for Codex). Lift condition: an official page, or a live `traecli` run, that names that file
and the entry shape. Until then the evidence is third-party and the table row stays without a recipe.

## zcode

Table row: id `zcode`, flag `--zcode`, detection home `~/.zcode`. Decision: **defer** (open question OQ-25-03).

**Reason.** ZCode is a GUI-owned Electron desktop application whose MCP configuration is its own native file, shared with
the application's other settings and written by its GUI. It has no CLI, no validator and no environment variable, so a
recipe could not be observed or checked here.

**Evidence.**

- https://zcode.z.ai/en/docs/mcp-services and https://zcode.z.ai/en/docs/install (documented; v3.18.2): Z.ai's Electron
  desktop environment (not Zed). The user file is `~/.zcode/cli/config.json` with the key `mcp.servers`; the workspace file
  `<project>/.zcode/config.json` auto-connects with no trust prompt, and "if a project and your own settings use the same
  name, yours wins"; a fallback `~/.agents/mcp.json` (`mcpServers`) is skipped when any server is defined in the
  `.zcode` file of that scope.
- GSD Core's capability matrix still calls native MCP registration for ZCode "BLOCKED (undocumented settings-filename/
  schema gap)"; that statement is stale against the documentation above. ZCode was never installed or run.

**Today.** `realm host install zcode` refuses `recipe-pending` and changes nothing.

**Alternative the owner could choose.** Ship the documented-only `~/.zcode/cli/config.json` with `mcp.servers.realm =
{command: "realm", args: ["mcp", "--host", "zcode"]}`, as a documented-only recipe like Antigravity's. It would write
into a file the GUI owns and rewrites, with no way here to check that the application reads it.

## Decisions the owner must take

Each line is one open question with the default that is in force. The three deferrals and the Pi version floor are
approved; the remaining defaults hold until the owner changes them.

- **OQ-25-01.** `windsurf` stays `recipe-pending`. Approved 2026-11-17. Options: ship `~/.config/devin/mcp_config.json`
  (id `windsurf`, alias `devin-desktop`), the legacy `~/.codeium/windsurf/mcp_config.json`, or both.
- **OQ-25-02.** `trae` stays `recipe-pending`. Approved 2026-11-17. Lift condition: an official page or a live `traecli`
  run naming `~/.trae/traecli.toml` and its entry shape (then a `toml-table` row).
- **OQ-25-03.** `zcode` stays `recipe-pending`. Approved 2026-11-17. Option: ship the documented-only
  `~/.zcode/cli/config.json`, `mcp.servers.realm`.
- **OQ-25-04.** `antigravity` ships documented-only (three Google pages agree; GSD's own path disagrees; `agy` never run).
  Default in force. Option: defer it instead (the row would keep `homes: []` and `homeVerified: false`).
- **OQ-25-05.** `hermes` ships through the new `yaml-map` engine kind (a conservative owned-entry approach). Default in
  force. Option: defer `hermes` and keep the Agent Plugins bundle `adapters/hermes-agent` as the only route; the kind and
  the row delete cleanly.
- **OQ-25-06.** JSONC hosts (`augment`, `codebuddy`, Devin) refuse a commented file and name the host's own add command.
  Default in force. A JSONC-aware, comment-preserving merge is a separate engine job.
- **OQ-25-07.** `pi` ships for pi 1.3 and later only. Approved. The recipe cannot check the version, and a pi below 1.3
  ignores the file; the gated live test skips below 1.3.0. Option: defer `pi` until a version probe exists.
- **OQ-25-08.** `cline` ships for the Cline CLI only; the IDE extension's file is unknown, and `CLINE_DATA_DIR` and
  `CLINE_MCP_SETTINGS_PATH` are not honoured (documented gap). Default in force.
- **OQ-25-09.** No production (T3 live end to end) tier for any wave 2 host, which is config-only. Default in force;
  confirm.
- **OQ-25-10.** [INFERENCE] Whether Hermes adds `enabled: true` to Realm's entry on a later rewrite, and whether a host
  version newer than the observed one (Qwen 0.27.4 against 0.22.0; Kilo, Copilot, CodeBuddy) normalises Realm's entry
  differently. A changed form shows as drift and uninstall refuses; the snippets give the recovery. A gated run on a newer
  install would show it.
- **OQ-25-11.** [INFERENCE] When `CODEBUDDY_CONFIG_DIR` is set, whether the legacy `~/.codebuddy.json` is still read from
  the user's home. The guard checks the user's home regardless (conservative).
- **OQ-25-12.** [INFERENCE] Which of `kilo.json` and `kilo.jsonc` wins for a same-named server in one directory (both
  load and merge).

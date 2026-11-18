# Muse Code snippet: Realm MCP server (stdio)

Source: `docs/integration/hosts.md` Muse Code section (read 2026-10-22).
Official pages: https://dev.meta.ai/docs/muse-code,
https://dev.meta.ai/docs/muse-code/extending,
https://dev.meta.ai/docs/muse-code/configuration.

Realm serves MCP over stdio through its `realm` command with the `mcp`
argument. This snippet carries no token, secret, or host path.

`realm` is not on `PATH` on the verification host. Install or link the `realm`
binary first, or give the absolute path to it in place of `realm` below.

## Settings file

User settings live at `~/.config/muse/settings.json`. The file must set
`"schema_version": 1`; a file that omits that key fails every command at
startup. Servers are declared in the `mcpServers` object, the spelling
`muse mcp add` writes; the older `mcp_servers` spelling of the same list is
superseded and must not appear in the same file (Muse reports
`ambiguous_user_key`). The entry takes `type`, `command` and `args`, and
`required: true` makes a run abort when the server fails to start.

`realm host install muse-code` writes this entry for you (it adds
`schema_version` only to a file it creates, and refuses while an old
`mcp_servers` entry is present). To merge it by hand, add this inside the
top-level object of `~/.config/muse/settings.json`. It is a snippet to merge
by hand, not a file to copy over an existing one. The same document is kept in
`adapters/muse-code/mcp-settings.snippet.json`:

```json
{
  "schema_version": 1,
  "mcpServers": {
    "realm": {
      "type": "stdio",
      "command": "realm",
      "args": ["mcp", "--host", "muse-code"],
      "required": true
    }
  }
}
```

The launcher carries the host label `--host muse-code`, so the default (capability tokens enforced) admits the session and
the audit names the host. `GAP-34-01` in `docs/integration/host-plugin-gaps.md` is closed by Phase 40. If an older
`mcp_servers` realm entry exists, remove it first; the installer refuses with `foreign-content` while it is present.

Server configs support `${VAR}` environment-variable interpolation, and Muse
Code passes `MUSE_SESSION_ID` to `stdio` servers. Run `/mcp` in an
interactive session to see a live inventory of connected servers and their
tools.

## Plugin bundle

The repository ships a Muse Code plugin bundle at `adapters/muse-code`
(manifest `.muse-plugin/plugin.json`, which declares `schemaVersion` 1 and
`compat` source `native`). Validate it offline (run from `<repo>`). Plugin
commands need the experimental flag, so set it explicitly:

```bash
MUSE_EXPERIMENTAL_PLUGINS=1 muse plugins validate adapters/muse-code
```

Expected result: exit 0 and the line
`valid realm native skills=0 commands=0 hooks=0 mcp=0 reminders=0 diagnostics=0`.

The MCP server is not carried by the plugin. Merge the `realm` entry above into
settings by hand or with `realm host install muse-code`.

Installing the bundle with `muse plugins install` and approving its hooks with
`muse plugins approve` change the user's Muse Code configuration. They are not
part of this snippet.

## Evidence reached

Tier: `config-only`. The recipe is proven on fixtures (`test/host/muse-code-recipe.test.ts`) and, in the validator tier, against Muse Code's own commands; no production tier and no model-driven tool call exist for this host (`GAP-40-01` in `docs/integration/host-plugin-gaps.md` states the limit).

Superseded entry: the Phase 36 run below used the earlier `mcp_servers` entry with the argument list `mcp` and no host flag. Phase 40 replaced it with the entry above and re-points the same test at the real recipe: the gated test `test/integration/host-live-muse.test.ts` (gate `REALM_LIVE_MUSE=1`; the registry keeps `live` null for this host because the test has a file of its own, so the support matrix names the gate here and not in a cell) runs `realm host install muse-code` in an isolated home, checks that the file equals the document above, has Muse's own commands read and start the entry, runs `muse mcp add` of a second server to see whether the entry stays value-identical, and runs `realm host uninstall muse-code`. Validator tier, run on 2026-11-18 (Phase 40) with Muse Code 1.4.23, as root with an isolated home and a stub `realm` (no production stack): `REALM_LIVE_MUSE=1 node --test dist/test/integration/host-live-muse.test.js`, 1 test, 1 pass. Shown: the plugin bundle validates; `realm host install muse-code --dry-run` wrote nothing; the real install wrote a settings file whose document equals the entry above, and `realm host status muse-code` said installed; `muse mcp list --json` and `muse mcp get realm --json` print the entry and start nothing; the host's own writer `muse mcp add` of a second server left the `realm` entry value-identical (`required` included) and `realm host status` still said installed, as 40-CONTEXT E-40-03 recorded; `muse exec --provider echo --trust-workspace` started the entry once through `PATH` with the arguments `mcp`, `--host`, `muse-code`, completed the handshake (`initialize`, `notifications/initialized`, `tools/list`) in 26 s and listed the six Realm tools; a stub `realm` that does not speak MCP made the run fail with `failed during startup` and recorded `mcp --host muse-code`; `realm host uninstall muse-code` removed the entry and, because only the seed remained, the settings file itself; the operator's real Muse settings file was byte-equal before and after and no `muse` process was left. The result covers Muse Code 1.4.23 on one machine only and is recorded in `test/support/host-registry.ts`.

Validator tier, run on 2026-11-18 (Phase 36) with Muse Code 1.4.23, base commit e32bb05: `REALM_LIVE_MUSE=1 node --test dist/test/integration/host-live-muse.test.js` (`test/integration/host-live-muse.test.ts`), 1 test, 1 pass. In an isolated home the settings entry above was written verbatim, with a recorder named `realm` first on `PATH` forwarding to a fake MCP server (the real `realm` is not run). Shown: the plugin bundle validates; `muse mcp list --json` and `muse mcp get realm --json` print the entry and start nothing; `muse exec --provider echo --trust-workspace` starts the entry through `PATH` with the argument `mcp`, completes the handshake and lists the six Realm tools; a stub that does not speak MCP makes the run fail with `failed during startup`; the operator's real settings file is byte-equal before and after. Muse did not start the entry in a workspace it did not trust (observed, not asserted). The result covers Muse Code 1.4.23 only.

Not shown: a Muse Code boot against the production stack (a 30 s default start timeout; Muse Code has a host id, a recipe and a registry record since Phase 40, and its attach under the enforced default is proven at the daemon by `test/integration/enforce-default.test.ts`, GAP-34-01 closed in `docs/integration/host-plugin-gaps.md`). No model-driven tool call was made.

## Not documented

ACP: not documented in the pages read. Neither the extending nor the
configuration page names an ACP surface, so this snippet gives no ACP
configuration.

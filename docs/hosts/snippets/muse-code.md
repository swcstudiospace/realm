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
startup. Declare servers in the `mcp_servers` block. Each server takes a
`transport`: either `stdio` (with `command`, `args`, and `env`) or
`streamable_http` (with `url` and `headers`). Every server also takes
`enabled` and `mode`. A server's `mode` defaults to `required`: if a required
server fails to start, the whole run aborts.

Add this entry inside the top-level object of `~/.config/muse/settings.json`.
It is a snippet to merge by hand, not a file to copy over an existing one. The
same entry is kept in `adapters/muse-code/mcp-settings.snippet.json`:

```json
{
  "schema_version": 1,
  "mcp_servers": {
    "realm": {
      "transport": "stdio",
      "command": "realm",
      "args": ["mcp"],
      "enabled": true,
      "mode": "required"
    }
  }
}
```

Muse Code has no host id, so this launcher stays `realm mcp` with no host flag and carries no capability token. Realm
enforces capability tokens by default, so the default refuses this session with `POLICY_DENIED` (`GAP-34-01` in
`docs/integration/host-plugin-gaps.md`). Either set the policy value `capabilityTokens.mode` to `off` (the opt-out, which
`realm doctor` flags with a warning), or add `"--host", "ID"` to `args` with the id of a host family you accept as the
attribution label (`realm host list` names the ids). The migration steps are in Q10 of `docs/integration/mcp.md`.

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
settings by hand.

Installing the bundle with `muse plugins install` and approving its hooks with
`muse plugins approve` change the user's Muse Code configuration. They are not
part of this snippet.

## Evidence reached

Validator tier, run on 2026-11-18 (Phase 36) with Muse Code 1.4.23, base commit e32bb05: `REALM_LIVE_MUSE=1 node --test dist/test/integration/host-live-muse.test.js` (`test/integration/host-live-muse.test.ts`), 1 test, 1 pass. In an isolated home the settings entry above was written verbatim, with a recorder named `realm` first on `PATH` forwarding to a fake MCP server (the real `realm` is not run). Shown: the plugin bundle validates; `muse mcp list --json` and `muse mcp get realm --json` print the entry and start nothing; `muse exec --provider echo --trust-workspace` starts the entry through `PATH` with the argument `mcp`, completes the handshake and lists the six Realm tools; a stub that does not speak MCP makes the run fail with `failed during startup`; the operator's real settings file is byte-equal before and after. Muse did not start the entry in a workspace it did not trust (observed, not asserted). The result covers Muse Code 1.4.23 only.

Not shown: a Muse Code boot against the production stack (no recipe, no registry record and no `--host` id for Muse Code, a 30 s default start timeout; to rehearse after Phase 33), and the behavior of this unlabelled launcher under capability-token enforcement (GAP-34-01 in `docs/integration/host-plugin-gaps.md`). No model-driven tool call was made.

## Not documented

ACP: not documented in the pages read. Neither the extending nor the
configuration page names an ACP surface, so this snippet gives no ACP
configuration.

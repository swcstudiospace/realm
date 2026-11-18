# Prime Agent snippet: Realm MCP server (stdio) and skill package

Source: the tier-2 row of the host tiers table in
`docs/integration/hosts.md`, where Prime Agent appears. The MCP and settings
formats here are medium confidence, read from the Prime Agent sources. The
package format and install check were verified on 2026-10-23.

Realm serves MCP over stdio through its `realm` command with the `mcp`
argument. This snippet carries no token, secret, or host path.

`realm` is not on `PATH` on the verification host. Install or link the `realm`
binary first, or give the absolute path to it in place of `realm` below.

## Add the MCP server

The documented form is `prime-agent mcp add <name> [--cwd] [--env CHILD=SOURCE] -- <command> [args]`:

```bash
prime-agent mcp add realm -- realm mcp --host prime-agent
```

This writes the `mcpServers` block of the Prime Agent `settings.json` (medium
confidence). To test without touching the live configuration, run it from a
scratch project directory with the project-local form in the next section.

The launcher carries the host label `--host prime-agent`, so the default (capability tokens enforced) admits the session and
the audit names the host. `realm host install prime-agent` registers the same entry. `GAP-34-01` in
`docs/integration/host-plugin-gaps.md` is closed by Phase 40. An older entry added as `realm mcp` with no host flag is refused
under the default: run `prime-agent mcp remove realm` first, then add the labelled entry. The migration steps are in Q10 of
`docs/integration/mcp.md`.

## Skill package

The repository ships a Prime Agent package at `adapters/prime-agent`. The
binary is `prime-agent`. Install it into a scratch project with `--local`, so
nothing under the live Prime Agent directory changes (run from `<repo>`):

```bash
cd <scratch> && prime-agent package install <repo>/adapters/prime-agent --local
```

Expected result: prints `Installed <path>` and exits 0. `--local` writes
`<scratch>/.prime/agent/settings.json`. Confirm it with:

```bash
cd <scratch> && prime-agent package list
```

Expected result: the package is listed under "Project packages".

Installing without `--local` writes to the live Prime Agent directory. That is
a separate step and is not part of this snippet.

## Existing installs

An entry added earlier as `prime-agent mcp add realm -- realm mcp` has no host flag and is refused under the default. Run
`prime-agent mcp remove realm`, then `realm host install prime-agent`; or run
`prime-agent mcp add realm -- realm mcp --host prime-agent`. `realm host uninstall prime-agent` removes only the entry the
install wrote. The table of every case is in Q10 of `docs/integration/mcp.md`.

## Evidence reached

Tier: `config-only`. The recipe (`json-merge`, file `settings.json` in the agent directory, key `mcpServers.realm`) is proven on
fixtures (`test/host/prime-agent-recipe.test.ts`) and observed against Prime Agent 0.10.2 (2026-11-18, isolated homes):
`prime-agent mcp add` writes the same entry shape, and a later `prime-agent mcp add` or `mcp remove` of another server leaves the
entry value-identical. The validator tier is the wave 2 entry `prime-agent` of `test/integration/host-live-wave2.test.ts`
(gate `REALM_LIVE_PRIME_AGENT=1`, executable override `REALM_PRIME_AGENT_BIN`): `realm host install prime-agent` in an isolated
agent directory (`PRIME_AGENT_CODING_AGENT_DIR`), then `prime-agent mcp list` and `prime-agent mcp get realm` (each prints the name
and the transport only, so the registered label is proven by the bytes the test reads back), then `prime-agent mcp add` of a
second server and `realm host uninstall prime-agent`. Validator tier, run on 2026-11-18 (Phase 40)
with Prime Agent 0.10.2, as root with isolated homes and a stub `realm` (no production stack):
`REALM_LIVE_PRIME_AGENT=1 node --test dist/test/integration/host-live-wave2.test.js` (the other wave 2 hosts stay skipped), the
`prime-agent` scenario passed. Shown: the dry run named `settings.json` and wrote nothing; the install wrote the entry and
`realm host status` said installed with the launch resolved on `PATH`; `prime-agent mcp list` and `prime-agent mcp get realm`
exited 0, printed `realm: stdio` and started nothing; the host's own `prime-agent mcp add` of a second server left Realm's entry
value-identical (status installed, entry `ok`); uninstall removed only Realm's entry; the operator's real settings file was
byte-equal before and after. The result covers Prime Agent 0.10.2 on one machine only and is recorded in
`test/support/host-registry.ts`.

Not shown: a Prime Agent boot against the production stack, and a model-driven tool call. No production tier is defined for
this host (`GAP-40-01` in `docs/integration/host-plugin-gaps.md`).

## Not documented

Prime Agent hooks: none observed in the sources read. Prime Agent ACP: not
documented in the sources read, so this snippet gives no ACP configuration.

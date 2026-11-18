# Prime Agent: add the Realm MCP server

Realm serves MCP over stdio through `realm mcp`. Add it to Prime Agent with the
documented `mcp add` form, where `--` separates Prime's options from the server
command:

```bash
prime-agent mcp add realm -- realm mcp --host prime-agent
```

`realm` must be on `PATH`, or replace it with the absolute path to the binary.
This bundle carries no token and no host path.

The launcher carries the host label `--host prime-agent`, so Realm attributes the session to its own host id and the default
(capability tokens enforced) admits it. `realm host install prime-agent` registers the same entry. GAP-34-01 (a bare launcher
refused with `POLICY_DENIED`) is closed by Phase 40. The migration steps are in Q10 of `docs/integration/mcp.md`.

To test without touching the default Prime Agent home, set an isolated
directory for the run:

```bash
PRIME_AGENT_CODING_AGENT_DIR=<isolated directory> prime-agent mcp add realm -- realm mcp --host prime-agent
```

Install the skill from this bundle with `prime-agent package install <path to
adapters/prime-agent>` only after checking the install scope; the bundle's
`package.json` declares `pi.skills` as `./skills`.

# Prime Agent: add the Realm MCP server

Realm serves MCP over stdio through `realm mcp`. Add it to Prime Agent with the
documented `mcp add` form, where `--` separates Prime's options from the server
command:

```bash
prime-agent mcp add realm -- realm mcp
```

`realm` must be on `PATH`, or replace it with the absolute path to the binary.
This bundle carries no token and no host path.

Prime Agent has no Realm host id, so this launcher is `realm mcp` with no host flag and carries no capability token.
Realm enforces capability tokens by default, so the default refuses this session with `POLICY_DENIED`. Set the policy
value `capabilityTokens.mode` to `off` (the opt-out), or end the command with `--host ID`, using the id of a host family
you accept as the attribution label. The migration steps are in Q10 of `docs/integration/mcp.md`.

To test without touching the default Prime Agent home, set an isolated
directory for the run:

```bash
PRIME_AGENT_CODING_AGENT_DIR=<isolated directory> prime-agent mcp add realm -- realm mcp
```

Install the skill from this bundle with `prime-agent package install <path to
adapters/prime-agent>` only after checking the install scope; the bundle's
`package.json` declares `pi.skills` as `./skills`.

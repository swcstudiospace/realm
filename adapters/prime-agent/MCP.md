# Prime Agent: add the Realm MCP server

Realm serves MCP over stdio through `realm mcp`. Add it to Prime Agent with the
documented `mcp add` form, where `--` separates Prime's options from the server
command:

```bash
prime-agent mcp add realm -- realm mcp
```

`realm` must be on `PATH`, or replace it with the absolute path to the binary.
This bundle carries no token and no host path.

To test without touching the default Prime Agent home, set an isolated
directory for the run:

```bash
PRIME_AGENT_CODING_AGENT_DIR=<isolated directory> prime-agent mcp add realm -- realm mcp
```

Install the skill from this bundle with `prime-agent package install <path to
adapters/prime-agent>` only after checking the install scope; the bundle's
`package.json` declares `pi.skills` as `./skills`.

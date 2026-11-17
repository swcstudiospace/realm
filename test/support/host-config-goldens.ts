// String goldens for the wave-1 host recipes (Phase 24, plan 24-02). `tsc` copies no fixture files, so every golden is a string
// constant (24-CONTEXT F8). Each carries `source: <evidence id>; <host> <version>; read 2026-11-17; <observed|documented>`.
// "observed" means the host's own command wrote it in an isolated HOME; "documented" means it follows the host's official
// documentation and no host was run. Random identifiers of a real file are replaced by fixed placeholders. No host-local path.

// source: E-C1; claude 2.1.322; read 2026-11-17; observed. `claude mcp add --scope user realm -- realm mcp --host claude` in an
// isolated HOME wrote this file (2-space indent, no trailing newline, mode 0600). machineID and userID are fixed placeholders;
// every key, its order and the entry are as observed.
export const CLAUDE_MCP_ADD_FILE = `{
  "firstStartTime": "2026-11-17T07:59:15.023Z",
  "firstStartVersion": "2.1.322",
  "machineID": "0000000000000000000000000000000000000000000000000000000000000001",
  "opusProMigrationComplete": true,
  "sonnet1m45MigrationComplete": true,
  "seenNotifications": {},
  "hasResetAutoModeOptInForDefaultOffer": true,
  "migrationVersion": 15,
  "userID": "0000000000000000000000000000000000000000000000000000000000000002",
  "mcpServers": {
    "realm": {
      "type": "stdio",
      "command": "realm",
      "args": [
        "mcp",
        "--host",
        "claude"
      ],
      "env": {}
    }
  }
}`;

// source: E-C1; claude 2.1.322; read 2026-11-17; observed. The `mcpServers.realm` object inside CLAUDE_MCP_ADD_FILE.
export const CLAUDE_MCP_ADD_ENTRY = { type: "stdio", command: "realm", args: ["mcp", "--host", "claude"], env: {} } as const;

// source: E-X1; codex-cli 0.154.0; read 2026-11-17; observed. `codex mcp add realm -- realm mcp --host codex` in an isolated
// HOME created ~/.codex/config.toml (mode 0600) with exactly this text, trailing newline included.
export const CODEX_MCP_ADD_TOML = '[mcp_servers.realm]\ncommand = "realm"\nargs = ["mcp", "--host", "codex"]\n';

// source: E-X5; codex-cli 0.154.0; read 2026-11-17; observed (shape only). A hand-grown config.toml: a [features] table, two
// [hooks.state."<path>:<event>:1:0"] tables with `enabled` and a `trusted_hash`, one other MCP table, comments and blank lines.
// Paths use <home> placeholders and the hashes are fixed placeholders.
export const CODEX_REAL_SHAPED_TOML = `# Hand-edited Codex configuration.

[features]
hooks = true

[hooks.state."<home>/.codex/hooks/session-start.js:session_start:1:0"]
enabled = true
trusted_hash = "sha256:0000000000000000000000000000000000000000000000000000000000000001"

[hooks.state."<home>/.codex/hooks/pre-tool.js:pre_tool_use:1:0"]
enabled = true
trusted_hash = "sha256:0000000000000000000000000000000000000000000000000000000000000002"

# Another MCP server, added by hand.
[mcp_servers.railway]
command = "npx"
args = ["-y", "@railway/mcp-server"]
`;

// source: E-O2; opencode 1.19.5; read 2026-11-17; observed. The hand-written file `opencode mcp list` parsed into a `realm` row
// that tried to launch exactly `realm mcp --host opencode` (V1 shape: the server name sits directly under `mcp`).
export const OPENCODE_V1_FILE = `{
  "mcp": {
    "realm": {
      "type": "local",
      "command": [
        "realm",
        "mcp",
        "--host",
        "opencode"
      ]
    }
  }
}
`;

// source: E-O5; opencode docs (mcp-servers.md, config.md); read 2026-11-17; documented. The V2 shape: servers are named under
// `mcp.servers`. The server name is an invented example.
export const OPENCODE_V2_DOC_FILE = `{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "servers": {
      "my-local-server": {
        "type": "local",
        "command": [
          "npx",
          "-y",
          "my-mcp-command"
        ]
      }
    }
  }
}
`;

// source: E-K4; kimi-cli docs (customization/mcp.html); read 2026-11-17; documented. ~/.kimi/mcp.json in the mcpServers shape,
// one URL server with headers and one stdio server. Names and header values are invented examples.
export const KIMI_MCP_DOC_FILE = `{
  "mcpServers": {
    "context7": {
      "url": "https://mcp.example.com/mcp",
      "headers": {
        "CONTEXT7_API_KEY": "KEY-PLACEHOLDER"
      }
    },
    "chrome-devtools": {
      "command": "npx",
      "args": [
        "-y",
        "chrome-devtools-mcp@latest"
      ]
    }
  }
}
`;

// source: E-K5; Kimi Code docs (kimi-code-cli/customization/mcp.html); read 2026-11-17; documented. ~/.kimi-code/mcp.json has
// the same mcpServers shape. The server name is an invented example.
export const KIMI_CODE_MCP_DOC_FILE = `{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-filesystem"
      ]
    }
  }
}
`;

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
// HOME created ~/.codex/config.toml (mode 0600) with exactly this text, trailing newline included. It is also the text Realm owns
// for Codex: the `toml-table` recipe writes this table, located by its header, with no comment marker around it.
//
// source: E-X6; codex-cli 0.154.0; read 2026-11-17; observed. Why there is no marker: with `# user comment` and `model = "x"`
// above a `# BEGIN realm host-plugin` line, this table and a `# END realm host-plugin` line, `codex mcp add other -- echo hi`
// rewrote the file with a comment-dropping TOML editor. The BEGIN line (decor of the table) was dropped, the table was kept
// byte for byte, `[mcp_servers.other]` was inserted after it, and the END line was kept at the end of the file. A following
// `codex mcp remove realm` removed the table and left the END line alone.
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

// ---- Phase 25, plan 25-01: the wave-2 JSON hosts (25-CONTEXT E-CU1 to E-AG2). "observed" is a host command's own output in an isolated
// HOME or a scratch override directory; "documented" follows the official page and no host was run. No host-local path; any random
// machine identifier is replaced by a placeholder.

// source: E-CP2; copilot 1.0.112; read 2026-11-17; observed. `COPILOT_HOME=<scratch> copilot mcp add realm -- realm mcp --host copilot`
// wrote this file (2-space indent, one array item per line, trailing newline, key order tools, type, command, args, no env).
export const COPILOT_MCP_ADD_FILE = `{
  "mcpServers": {
    "realm": {
      "tools": [
        "*"
      ],
      "type": "local",
      "command": "realm",
      "args": [
        "mcp",
        "--host",
        "copilot"
      ]
    }
  }
}
`;

// source: E-CP2; copilot 1.0.112; read 2026-11-17; observed. The same file after `copilot mcp add other -- other-cmd`: Copilot
// normalized every entry (the realm entry is value-identical) and added the other server with its own `tools` and an empty `args`.
export const COPILOT_NORMALIZED_FILE = `{
  "mcpServers": {
    "realm": {
      "tools": [
        "*"
      ],
      "type": "local",
      "command": "realm",
      "args": [
        "mcp",
        "--host",
        "copilot"
      ]
    },
    "other": {
      "tools": [
        "*"
      ],
      "type": "local",
      "command": "other-cmd",
      "args": []
    }
  }
}
`;

// source: E-QW1; qwen 0.22.0; read 2026-11-17; observed. `qwen mcp add realm -s user realm mcp --host qwen` wrote this file (2-space
// indent, array items one per line, no trailing newline).
export const QWEN_MCP_ADD_FILE = `{
  "mcpServers": {
    "realm": {
      "command": "realm",
      "args": [
        "mcp",
        "--host",
        "qwen"
      ]
    }
  }
}`;

// source: E-QW2; qwen 0.22.0; read 2026-11-17; observed (shape). After `qwen mcp add foo` on a file with comments, `theme` and
// `mcpServers`, Qwen had stripped the comments, moved `theme` to `ui.theme`, appended `"$version": 4` and kept the existing entry.
// The theme value is a placeholder, the key order is the one this fixture chose, and no trailing newline (as Qwen writes).
export const QWEN_HOST_MIGRATED_FILE = `{
  "mcpServers": {
    "realm": {
      "command": "realm",
      "args": [
        "mcp",
        "--host",
        "qwen"
      ]
    }
  },
  "ui": {
    "theme": "example-theme"
  },
  "$version": 4
}`;

// source: E-PI1; pi 1.5.2; read 2026-11-17; observed. `pi mcp add realm -- realm mcp --host pi` into a scratch PI_CODING_AGENT_DIR wrote
// this file (2-space indent, array items one per line). No trailing-newline state was recorded, so no test asserts one.
export const PI_MCP_ADD_FILE = `{
  "mcpServers": {
    "realm": {
      "command": "realm",
      "args": [
        "mcp",
        "--host",
        "pi"
      ]
    }
  }
}
`;

// source: E-AU1; auggie 1.2.1; read 2026-11-17; observed. `auggie mcp add-json realm '{"type":"stdio","command":"realm","args":["mcp","--host","augment"],"env":{"K":"v"}}'`
// (default scope user) wrote this file (2-space indent, array items one per line). The `env` is what was observed because the command
// was given one; the entry Realm registers is the same without `env`. No trailing-newline state was recorded.
export const AUGMENT_MCP_ADD_JSON_FILE = `{
  "mcpServers": {
    "realm": {
      "type": "stdio",
      "command": "realm",
      "args": [
        "mcp",
        "--host",
        "augment"
      ],
      "env": {
        "K": "v"
      }
    }
  }
}
`;

// source: E-AU2; auggie 1.2.1; read 2026-11-17; observed (shape). Auggie edits its shared settings file format-preservingly, so a real
// file may keep a `//` comment and a trailing comma after `mcp add-json`. Used only as a refusal seed: Realm's strict JSON reader refuses it.
// The `hooks` content and the model name are placeholders.
export const AUGMENT_SETTINGS_JSONC = `{
  // Auggie settings, edited by hand.
  "model": "example-model",
  "hooks": {
    "PreToolUse": []
  },
}
`;

// source: E-KL2; kilo 7.8.27; read 2026-11-17; observed. A strict-JSON ~/.config/kilo/kilo.json holding only the realm entry was rewritten by Kilo
// (2-space indent, arrays expanded, `$schema` first, `permission.bash` last) and the realm entry stayed value-identical.
export const KILO_JSON_REWRITTEN_FILE = `{
  "$schema": "https://app.kilo.ai/config.json",
  "mcp": {
    "realm": {
      "type": "local",
      "command": [
        "realm",
        "mcp",
        "--host",
        "kilo"
      ]
    }
  },
  "permission": {
    "bash": "allow"
  }
}
`;

// source: E-KL2; kilo 7.8.27; read 2026-11-17; observed (shape). A kilo.jsonc beside kilo.json is read and merged by Kilo; a comment
// survives in it. Realm never reads or writes the .jsonc; the server name `a` is an invented example.
export const KILO_JSONC_FILE = `{
  // a user comment
  "mcp": {
    "a": {
      "type": "local",
      "command": [
        "a-command"
      ]
    }
  }
}
`;

// source: E-CU1; https://cursor.com/docs/mcp; read 2026-11-17; documented. ~/.cursor/mcp.json in the mcpServers shape. The server name,
// command and key are invented examples.
export const CURSOR_MCP_DOC_FILE = `{
  "mcpServers": {
    "server-name": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-server"
      ],
      "env": {
        "API_KEY": "value"
      }
    }
  }
}
`;

// source: E-AG1; https://antigravity.google/docs/mcp/; read 2026-11-17; documented. ~/.gemini/config/mcp_config.json: the quoted
// `sqlite-explorer` stdio server, plus one `serverUrl` server with headers (the URL and header are invented examples).
export const ANTIGRAVITY_MCP_DOC_FILE = `{
  "mcpServers": {
    "sqlite-explorer": {
      "command": "node",
      "args": [
        "/usr/local/bin/sqlite-mcp-server.js"
      ],
      "env": {
        "SQLITE_DB_PATH": "/var/data/app.db"
      }
    },
    "remote-server": {
      "serverUrl": "https://mcp.example.com/mcp",
      "headers": {
        "Authorization": "Bearer TOKEN-PLACEHOLDER"
      }
    }
  }
}
`;

// source: E-CL1; https://docs.cline.bot/mcp/mcp-overview.md; read 2026-11-17; documented. ~/.cline/data/settings/cline_mcp_settings.json in the
// flat mcpServers shape with `disabled` and `autoApprove`. The server name and paths are invented examples.
export const CLINE_MCP_DOC_FILE = `{
  "mcpServers": {
    "local-server": {
      "command": "node",
      "args": [
        "/path/to/server.js"
      ],
      "env": {
        "API_KEY": "..."
      },
      "disabled": false,
      "autoApprove": []
    }
  }
}
`;

// source: E-CL2; cline 3.0.74; read 2026-11-17; observed. `CLINE_DIR=<scratch> cline mcp add realm --yes -- realm mcp --host cline` wrote
// `data/settings/cline_mcp_settings.json` with the nested `transport` shape, unlike the documented flat one. The Cline CLI also parses the
// flat entry Realm writes. No trailing-newline state was recorded.
export const CLINE_CLI_NESTED_FILE = `{
  "mcpServers": {
    "realm": {
      "transport": {
        "type": "stdio",
        "command": "realm",
        "args": [
          "mcp",
          "--host",
          "cline"
        ]
      }
    }
  }
}
`;

// source: E-CB1; codebuddy 2.185.0; read 2026-11-17; observed. `codebuddy mcp add-json --scope user realm '{"type":"stdio","command":"realm",
// "args":["mcp","--host","codebuddy"]}'` in an isolated HOME wrote `<home>/.codebuddy/.mcp.json` with the entry and an empty
// `disabledMcpServers`. The observation also passed an `env`; it is left out here because the recipe value has none.
export const CODEBUDDY_ADD_JSON_FILE = `{
  "mcpServers": {
    "realm": {
      "type": "stdio",
      "command": "realm",
      "args": [
        "mcp",
        "--host",
        "codebuddy"
      ]
    }
  },
  "disabledMcpServers": []
}
`;

// source: E-HM1; hermes-agent v0.23.2 (hermes_cli.mcp_config._save_mcp_server, run from a local checkout); read 2026-11-17; observed. The host's own
// writer, given a file with a header comment, an inline comment, `model.default` and no `mcp_servers`, appended `_config_version: 53` and the
// entry in block style. The observation used the host id `hermes-agent` in `args`; the table id is `hermes`.
export const HERMES_SAVE_MCP_SERVER_FILE = `# my header comment
model:
  default: foo   # inline comment
# trailing
_config_version: 53
mcp_servers:
  realm:
    command: realm
    args:
      - mcp
      - --host
      - hermes
`;

// source: E-HM1; https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp; read 2026-11-17; documented. A `mcp_servers` entry with a
// flow-style `args`. The server name and the path are invented examples.
export const HERMES_DOC_FILE = `mcp_servers:
  filesystem:
    command: npx
    args: ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/projects"]
`;

// source: E-HM3; read 2026-11-17; observed (shape only). The real Hermes configuration is a long LF file with comments that carry
// `*word*`, `mcp_servers` in the middle between other top-level keys, 2-space children, block-style `args` and `enabled: true` on every
// sibling. This is generated from a template: no key, value or text of any real file is recorded, and `<home>` is a placeholder.
function realShapedSections(first: number, count: number): string {
  const sections: string[] = [];
  for (let index = first; index < first + count; index += 1) {
    sections.push(
      [
        `section_${String(index)}:`,
        "  enabled: true",
        `  path: <home>/data/${String(index)}`,
        '  label: "quoted value"',
        `  # note ${String(index)}: *emphasis* stays a comment`,
        "  items:",
        "    - one",
        "    - two",
        "",
      ].join("\n"),
    );
  }
  return sections.join("\n");
}

const HERMES_REAL_SHAPED_HEAD = `# Configuration shape, generated from a template.
# Keep *closed* networks, *and* *confidential* data out of prompts.
model:
  default: example-model
  provider: example-provider   # inline comment
system_prompt: |
  You are helpful.
  *x &y !z are plain text inside this block scalar.
  mcp_servers:
    realm: not a key

${realShapedSections(0, 18)}
`;

const HERMES_REAL_SHAPED_SERVERS = `mcp_servers:
  filesystem:
    command: npx
    args:
      - -y
      - "@scope/example-server"
      - <home>/projects
    enabled: true
  # a note between two servers
  github:
    command: example-github-server
    env:
      TOKEN: placeholder
    enabled: true
`;

const HERMES_REAL_SHAPED_TAIL = `# --- end of servers ---
${realShapedSections(18, 12)}
auxiliary:
  vision:
    provider: auto
_config_version: 53
`;

// The file in three parts: what comes before `mcp_servers`, the block up to its last content line, and what follows. Realm's entry goes
// between the second and the third.
export const HERMES_REAL_SHAPED_PARTS = { head: HERMES_REAL_SHAPED_HEAD, servers: HERMES_REAL_SHAPED_SERVERS, tail: HERMES_REAL_SHAPED_TAIL } as const;
export const HERMES_REAL_SHAPED_FILE = `${HERMES_REAL_SHAPED_HEAD}${HERMES_REAL_SHAPED_SERVERS}${HERMES_REAL_SHAPED_TAIL}`;

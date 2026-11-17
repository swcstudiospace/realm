// The per-host script table of the wave-2 live validator tier (WAVE2-07, 25-CONTEXT D-25-08 and D-25-09). Data and a few pure functions
// only: nothing here starts a process, reads the process environment or touches a host. test/integration/host-live-wave2.test.ts runs
// one scenario per host from this table, test/integration/host-live-helpers.test.ts pins the table's shape without any host CLI.
//
// Every command is one the host runs without a login, without a model prompt and without a credential (E-QW2, E-CP2, E-AU2, E-CB1,
// E-KL2, E-PI1, E-HM1, E-CU3, E-CL2). `launches` says whether the host starts the registered command: the stub `realm` then records
// `mcp --host <id>`. A host that only prints the registered entry starts nothing, and the scenario asserts the stub was never run.

import { isRecord } from "./omp-live.js";
import type { HostRig, LiveHostId } from "./host-live.js";
import { HOST_RUNTIMES } from "../../src/host/runtimes.js";

export type Wave2LiveId = Exclude<LiveHostId, "claude" | "codex" | "opencode" | "kimi">;
export const WAVE2_LIVE_IDS: readonly Wave2LiveId[] = Object.freeze(["qwen", "pi", "hermes", "cursor", "kilo", "copilot", "augment", "codebuddy", "cline"] as const);

// One of the host's own commands, run in the isolated environment after Realm's install.
export interface Wave2Validator {
  // The arguments after the host executable.
  readonly args: readonly string[];
  // Each pattern must match the command's stdout and stderr together, colour removed.
  readonly expect: readonly RegExp[];
  // Whether the host starts the registered command: the stub records `mcp --host <id>` when true, and is never run when false.
  readonly launches: boolean;
  // A failure bound in milliseconds (scaled by REALM_TEST_TIMEOUT_SCALE); the default is VALIDATOR_TIMEOUT_MS.
  readonly timeoutMs?: number;
  // The exit codes that count as the host having answered; the default is [0]. A host that connects to the stub, which does not speak MCP,
  // may exit 1 after it printed its row (pi, hermes).
  readonly exitCodes?: readonly number[];
  // The command is an interactive menu that never ends with stdin closed: the bound kill is the expected outcome and only the stub argv is
  // asserted (Cursor, E-CU3).
  readonly boundKillExpected?: boolean;
}

// The host's own add command, run after Realm's install to see whether the host leaves Realm's entry value-identical.
export interface Wave2AddOther {
  readonly args: readonly string[];
  // What the observation is about; printed in the test diagnostic.
  readonly note: string;
}

export interface Wave2Script {
  // Override variable -> directory name below the rig root (created by the rig).
  readonly overrides: Readonly<Record<string, string>>;
  // The configuration home of the host in the rig: the directory Realm's install expects to exist.
  readonly homeDir: (rig: HostRig) => string;
  // The file the real recipe writes.
  readonly configFile: (rig: HostRig) => string;
  // The directories below the home that Realm's install creates and uninstall removes again (never the home itself).
  readonly createdDirs: (rig: HostRig) => readonly string[];
  readonly validators: readonly Wave2Validator[];
  readonly addOther?: Wave2AddOther;
  // The operator's real configuration files of this host below `realHome`: hashed before and after, and never to change.
  readonly realFiles: (realHome: string) => readonly string[];
}

const NO_DIRS = (): readonly string[] => [];

// `--host <id>` as a host prints it: spaced (`realm mcp --host copilot`) or as a JSON array (`"--host", "copilot"`).
function hostFlag(id: Wave2LiveId): RegExp {
  return new RegExp(`--host["',\\s]+${id}`);
}

const REALM_ROW = /realm/;

export const WAVE2_LIVE: Readonly<Record<Wave2LiveId, Wave2Script>> = Object.freeze<Record<Wave2LiveId, Wave2Script>>({
  // E-QW1, E-QW2: `qwen mcp list` needs no login and spawns the server. `qwen mcp add` rewrites the whole settings file but kept the entry.
  qwen: {
    overrides: { QWEN_HOME: "qwen" },
    homeDir: (rig) => rig.path("qwen"),
    configFile: (rig) => rig.path("qwen", "settings.json"),
    createdDirs: NO_DIRS,
    validators: [{ args: ["mcp", "list"], expect: [REALM_ROW], launches: true }],
    addOther: { args: ["mcp", "add", "other", "-s", "user", "other-cmd"], note: "qwen mcp add rewrites the whole settings file (E-QW2)" },
    realFiles: (home) => [`${home}/.qwen/settings.json`],
  },
  // E-PI1, E-PI2: pi >= 1.3 only (the gate skips an older one). `pi mcp list` connects to every enabled server and exits 1 on a stub that
  // does not speak MCP; the row is printed first.
  pi: {
    overrides: { PI_CODING_AGENT_DIR: "pi" },
    homeDir: (rig) => rig.path("pi"),
    configFile: (rig) => rig.path("pi", "mcp.json"),
    createdDirs: NO_DIRS,
    validators: [{ args: ["mcp", "list"], expect: [REALM_ROW], launches: true, exitCodes: [0, 1] }],
    addOther: { args: ["mcp", "add", "other", "--", "other-cmd"], note: "pi mcp add writes a strict-JSON file (E-PI1)" },
    realFiles: (home) => [`${home}/.pi/agent/mcp.json`],
  },
  // E-HM1, E-HM2: `hermes mcp list` prints the registered entry; `hermes mcp test realm` starts it and exits 1 on a stub that does not speak
  // MCP. `hermes mcp add` probes the server and saves a failed one only after an interactive confirmation, so there is no add step.
  hermes: {
    overrides: { HERMES_HOME: "hermes" },
    homeDir: (rig) => rig.path("hermes"),
    configFile: (rig) => rig.path("hermes", "config.yaml"),
    createdDirs: NO_DIRS,
    validators: [
      { args: ["mcp", "list"], expect: [REALM_ROW], launches: false },
      { args: ["mcp", "test", "realm"], expect: [REALM_ROW], launches: true, exitCodes: [0, 1] },
    ],
    realFiles: (home) => [`${home}/.hermes/config.yaml`],
  },
  // E-CU3: `agent mcp list` (cursor-agent) is an interactive menu. It reads the file and spawns the command; its output was never
  // captured cleanly, so only the stub argv is asserted and a bound kill is the expected end. There is no `mcp add`.
  cursor: {
    overrides: {},
    homeDir: (rig) => rig.path("home", ".cursor"),
    configFile: (rig) => rig.path("home", ".cursor", "mcp.json"),
    createdDirs: NO_DIRS,
    validators: [{ args: ["mcp", "list"], expect: [], launches: true, timeoutMs: 60_000, boundKillExpected: true }],
    realFiles: (home) => [`${home}/.cursor/mcp.json`],
  },
  // E-KL1, E-KL2: `kilo mcp list` lists the entry and spawns the command; Kilo then rewrites kilo.json (the entry stays value-identical) and
  // creates files beside it. `kilo mcp add` is interactive for a local server, so there is no add step.
  kilo: {
    overrides: { XDG_CONFIG_HOME: "config" },
    homeDir: (rig) => rig.path("config", "kilo"),
    configFile: (rig) => rig.path("config", "kilo", "kilo.json"),
    createdDirs: NO_DIRS,
    validators: [{ args: ["mcp", "list"], expect: [REALM_ROW], launches: true }],
    realFiles: (home) => [`${home}/.config/kilo/kilo.json`],
  },
  // E-CP1, E-CP2: `copilot mcp get|list` print the entry and start nothing. `copilot mcp add` normalizes every entry (adds `tools`); Realm's
  // entry already carries it.
  copilot: {
    overrides: { COPILOT_HOME: "copilot" },
    homeDir: (rig) => rig.path("copilot"),
    configFile: (rig) => rig.path("copilot", "mcp-config.json"),
    createdDirs: NO_DIRS,
    validators: [
      { args: ["mcp", "get", "realm"], expect: [hostFlag("copilot")], launches: false },
      { args: ["mcp", "list", "--json"], expect: [hostFlag("copilot")], launches: false },
    ],
    addOther: { args: ["mcp", "add", "other", "--", "other-cmd"], note: "copilot mcp add normalizes every entry and adds `tools` (E-CP2)" },
    realFiles: (home) => [`${home}/.copilot/mcp-config.json`],
  },
  // E-AU1, E-AU2: `auggie mcp list` lists the entry and spawns nothing; each call takes about 40 s. `auggie mcp add-json` edits the shared
  // settings file format-preservingly.
  augment: {
    overrides: { AUGMENT_CACHE_DIR: "augment" },
    homeDir: (rig) => rig.path("augment"),
    configFile: (rig) => rig.path("augment", "settings.json"),
    createdDirs: NO_DIRS,
    validators: [{ args: ["mcp", "list"], expect: [REALM_ROW], launches: false, timeoutMs: 120_000 }],
    addOther: { args: ["mcp", "add-json", "other", '{"type":"stdio","command":"other-cmd","args":[]}'], note: "auggie mcp add-json edits the shared settings file format-preservingly (E-AU2)" },
    realFiles: (home) => [`${home}/.augment/settings.json`],
  },
  // E-CB1, E-CB3: `codebuddy mcp list|get` spawn the server (a health check) and take 30 to 45 s. `mcp add-json --scope user` is the golden
  // writer; `mcp add` wrote a spurious key and is never used. The host rewrites the file (trailing comma, `disabledMcpServers`).
  codebuddy: {
    overrides: { CODEBUDDY_CONFIG_DIR: "codebuddy" },
    homeDir: (rig) => rig.path("codebuddy"),
    configFile: (rig) => rig.path("codebuddy", ".mcp.json"),
    createdDirs: NO_DIRS,
    validators: [
      { args: ["mcp", "list"], expect: [REALM_ROW], launches: true, timeoutMs: 120_000 },
      { args: ["mcp", "get", "realm"], expect: [REALM_ROW], launches: true, timeoutMs: 120_000 },
    ],
    addOther: {
      args: ["mcp", "add-json", "--scope", "user", "other", '{"type":"stdio","command":"other-cmd"}'],
      note: "codebuddy rewrites .mcp.json: it drops comments, injects `type`, appends a trailing comma and `disabledMcpServers` (E-CB3)",
    },
    realFiles: (home) => [`${home}/.codebuddy/.mcp.json`],
  },
  // E-CL1, E-CL2: `cline config mcp --json` lists the entry as stdio with no spawn and no login. `cline mcp add` writes a nested shape and
  // keeps a flat entry verbatim. Install creates data/settings and data below CLINE_DIR, never CLINE_DIR itself.
  cline: {
    overrides: { CLINE_DIR: "cline" },
    homeDir: (rig) => rig.path("cline"),
    configFile: (rig) => rig.path("cline", "data", "settings", "cline_mcp_settings.json"),
    createdDirs: (rig) => [rig.path("cline", "data", "settings"), rig.path("cline", "data")],
    validators: [{ args: ["config", "mcp", "--json"], expect: [REALM_ROW, /stdio/], launches: false }],
    addOther: { args: ["mcp", "add", "other", "--yes", "--", "other-cmd"], note: "cline mcp add writes a nested shape and kept a flat entry verbatim (E-CL2)" },
    realFiles: (home) => [`${home}/.cline/data/settings/cline_mcp_settings.json`],
  },
});

// What the real table installs for a host: the file below the config home, the key path of the owned entry (the map key and the server
// name) and the value the recipe writes. The live scenario installs through `realm host install`, never from this copy.
export interface Wave2Recipe {
  readonly file: string;
  readonly keyPath: readonly string[];
  readonly value: unknown;
  readonly yaml: boolean;
}

export function wave2Recipe(host: Wave2LiveId): Wave2Recipe {
  const recipe = HOST_RUNTIMES[host].recipe;
  if (recipe?.kind === "json-merge") {
    return { file: recipe.file, keyPath: recipe.keyPath, value: recipe.value, yaml: false };
  }
  if (recipe?.kind === "yaml-map") {
    return { file: recipe.file, keyPath: recipe.path, value: recipe.value, yaml: true };
  }
  throw new Error(`${host} has no json-merge or yaml-map recipe in the real table`);
}

// The value at `keyPath` below `root`, or undefined when any step is missing or not an object.
export function valueAt(root: unknown, keyPath: readonly string[]): unknown {
  let current = root;
  for (const key of keyPath) {
    if (!isRecord(current) || !Object.hasOwn(current, key)) {
      return undefined;
    }
    current = current[key];
  }
  return current;
}

// Parses a JSON file a host may have rewritten as JSONC: `//` and block comments and trailing commas outside strings are dropped. A
// host's own rewrite (CodeBuddy appends a trailing comma, E-CB3) must not stop the scenario from reading the entry.
export function parseLooseJson(text: string): unknown {
  let out = "";
  let inString = false;
  let index = 0;
  while (index < text.length) {
    const char = text.charAt(index);
    if (inString) {
      out += char;
      if (char === "\\") {
        out += text.charAt(index + 1);
        index += 2;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      index += 1;
      continue;
    }
    if (char === '"') {
      inString = true;
      out += char;
      index += 1;
      continue;
    }
    if (char === "/" && text.charAt(index + 1) === "/") {
      while (index < text.length && text.charAt(index) !== "\n") {
        index += 1;
      }
      continue;
    }
    if (char === "/" && text.charAt(index + 1) === "*") {
      const end = text.indexOf("*/", index + 2);
      index = end === -1 ? text.length : end + 2;
      continue;
    }
    if (char === "}" || char === "]") {
      const trimmed = out.trimEnd();
      if (trimmed.endsWith(",")) {
        out = trimmed.slice(0, -1);
      }
    }
    out += char;
    index += 1;
  }
  const parsed: unknown = JSON.parse(out);
  return parsed;
}

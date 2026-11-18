// Pure helpers of the Muse Code validator-tier live test (V1LIVE-01, 36-CONTEXT D-36-04). Since Phase 40 Muse Code has the host id
// `muse-code`, a recipe and a registry record (the recipe value is pinned equal to this entry, 40-CONTEXT D-40-04): the documented
// settings entry (docs/hosts/snippets/muse-code.md) is written verbatim into an isolated settings file and the real `muse` binary reads it. This module holds the checks of that entry, of what `muse mcp list --json` and `muse mcp get realm
// --json` print about it, the gate reason and the isolated environment.
//
// Nothing here reads the process environment, reads a clock or starts a process at import time. The hermetic test is
// test/integration/host-live-muse-helpers.test.ts; the gated test is test/integration/host-live-muse.test.ts.
//
// Exports: MUSE_OPT_IN, MUSE_BIN_VARIABLE, MUSE_RECORDED_VERSION, MUSE_PLUGIN_VALID_PATTERN, parseMuseVersion, museSettingsText,
// museEntryProblem, museListProblem, museGateReason, museIsolatedEnv.

import { isAbsolute, join } from "node:path";
import type { EnvironmentLike } from "../../src/session/paths.js";
import type { HostVersionProbe } from "./host-live.js";
import { isRecord } from "./omp-live.js";

export const MUSE_OPT_IN = "REALM_LIVE_MUSE";
export const MUSE_BIN_VARIABLE = "REALM_MUSE_BIN";
// Informational (36-CONTEXT E-36-06): a different version runs and is recorded, never skipped.
export const MUSE_RECORDED_VERSION = "1.4.23";

// The line `muse plugins validate adapters/muse-code` prints: tab or space separated.
export const MUSE_PLUGIN_VALID_PATTERN = /^valid[\t ]+realm[\t ]+native[\t ]+skills=0 commands=0 hooks=0 mcp=0 reminders=0 diagnostics=0$/m;

const VERSION_PATTERN = /\d+\.\d+\.\d+/;
const PRODUCT = "Muse Code";

// The first x.y.z that follows the words `Muse Code`; undefined when there is none.
export function parseMuseVersion(stdout: string): string | undefined {
  const at = stdout.indexOf(PRODUCT);
  if (at < 0) {
    return undefined;
  }
  return VERSION_PATTERN.exec(stdout.slice(at + PRODUCT.length))?.[0];
}

// The one documented entry, field by field.
const EXPECTED_ENTRY: Readonly<Record<string, unknown>> = Object.freeze({ type: "stdio", command: "realm", args: Object.freeze(["mcp", "--host", "muse-code"]), required: true });

// Parses the snippet text and requires exactly the documented shape; returns the settings text to write (two-space indent, final
// newline). Throws an Error that names the first difference.
export function museSettingsText(snippetText: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(snippetText);
  } catch (error) {
    throw new Error("the Muse settings snippet is not JSON", { cause: error });
  }
  if (!isRecord(parsed)) {
    throw new Error("the Muse settings snippet is not an object");
  }
  const keys = Object.keys(parsed);
  if (parsed["schema_version"] !== 1) {
    throw new Error("schema_version differs: expected 1");
  }
  const extra = keys.filter((key) => key !== "schema_version" && key !== "mcpServers");
  if (extra.length > 0) {
    throw new Error(`the snippet has an unexpected top-level key: ${extra[0] ?? ""}`);
  }
  const servers = parsed["mcpServers"];
  if (!isRecord(servers)) {
    throw new Error("mcpServers is missing or not an object");
  }
  const names = Object.keys(servers);
  if (names.length !== 1 || names[0] !== "realm") {
    throw new Error(`mcpServers must hold exactly the server realm, found ${names.join(",") === "" ? "none" : names.join(",")}`);
  }
  const entry = servers["realm"];
  if (!isRecord(entry)) {
    throw new Error("the realm entry is not an object");
  }
  for (const [key, expected] of Object.entries(EXPECTED_ENTRY)) {
    if (!Object.hasOwn(entry, key)) {
      throw new Error(`the realm entry lacks ${key}`);
    }
    if (JSON.stringify(entry[key]) !== JSON.stringify(expected)) {
      throw new Error(`the realm entry differs at ${key}: expected ${JSON.stringify(expected)}`);
    }
  }
  const surplus = Object.keys(entry).filter((key) => !Object.hasOwn(EXPECTED_ENTRY, key));
  if (surplus.length > 0) {
    throw new Error(`the realm entry has an unexpected key: ${surplus[0] ?? ""}`);
  }
  return `${JSON.stringify(parsed, null, 2)}\n`;
}

// Checks one server object as `muse mcp list --json` (inside its servers array) or `muse mcp get realm --json` prints it. Keys Muse
// prints beyond these are ignored. Undefined when it holds, else one sentence naming the first field that differs.
export function museEntryProblem(entry: unknown): string | undefined {
  if (!isRecord(entry)) {
    return "the server entry is not an object";
  }
  const expected: readonly (readonly [string, unknown])[] = [
    ["name", "realm"],
    ["enabled", true],
    ["type", "stdio"],
    ["required", true],
    ["source", "user"],
    ["status", "enabled"],
    ["command", "realm"],
  ];
  for (const [key, value] of expected) {
    if (entry[key] !== value) {
      return `the server field ${key} is not ${JSON.stringify(value)}`;
    }
  }
  const args = entry["args"];
  if (!Array.isArray(args) || JSON.stringify(args) !== JSON.stringify(["mcp", "--host", "muse-code"])) {
    return "the server field args is not mcp, --host, muse-code";
  }
  return undefined;
}

// The value of `muse mcp list --json`: an object whose servers array holds exactly one entry, the realm entry of museEntryProblem.
export function museListProblem(value: unknown): string | undefined {
  if (!isRecord(value)) {
    return "the list is not an object";
  }
  const servers = value["servers"];
  if (!Array.isArray(servers)) {
    return "the list has no servers array";
  }
  if (servers.length !== 1) {
    return `the list holds ${String(servers.length)} servers, expected exactly one`;
  }
  return museEntryProblem(servers[0]);
}

export interface MuseGateInputs {
  readonly env: EnvironmentLike;
  readonly platform: string;
  // The absolute path of the executable a name (looked up on PATH) or an absolute path names, or undefined.
  readonly resolveBinary: (nameOrPath: string) => string | undefined;
  readonly versionProbe: HostVersionProbe;
}

// The first missing prerequisite as a sentence, or false when every prerequisite holds. The built CLI is not a prerequisite: the
// validator tier never runs `realm`.
export function museGateReason(inputs: MuseGateInputs): string | false {
  const { env } = inputs;
  if (env[MUSE_OPT_IN] !== "1") {
    return `${MUSE_OPT_IN}=1 is not set; the live Muse Code rehearsal needs an explicit operator opt-in`;
  }
  if (inputs.platform !== "linux") {
    return `the live host rehearsals are verified on Linux only; this host is ${inputs.platform}`;
  }
  const override = env[MUSE_BIN_VARIABLE];
  const overridden = override !== undefined && override !== "";
  if (overridden && !isAbsolute(override)) {
    return `${MUSE_BIN_VARIABLE} must be an absolute path to the muse executable; a relative path is refused`;
  }
  const named = overridden ? override : "muse";
  if (inputs.resolveBinary(named) === undefined) {
    return `no Muse Code executable ${named}; install muse or point ${MUSE_BIN_VARIABLE} at it`;
  }
  if (inputs.versionProbe.kind === "unavailable") {
    return `${named} --version did not run to a successful exit`;
  }
  if (parseMuseVersion(inputs.versionProbe.stdout) === undefined) {
    return `${named} --version printed no x.y.z version after Muse Code`;
  }
  return false;
}

// The whole environment a Muse process is given, and nothing else: no inherited variable, no credential, no MUSE variable.
export function museIsolatedEnv(root: string, pathValue: string): Record<string, string> {
  return {
    PATH: pathValue,
    HOME: join(root, "home"),
    XDG_CONFIG_HOME: join(root, "config"),
    XDG_DATA_HOME: join(root, "data"),
    XDG_STATE_HOME: join(root, "state"),
    XDG_CACHE_HOME: join(root, "cache"),
    LANG: "C.UTF-8",
    TERM: "dumb",
  };
}

// The always-running hermetic test of test/support/host-live-muse.ts (V1LIVE-01): no Muse binary, no Podman, no network. It starts no
// process. It pins the version parse, the documented settings entry (and that the documented text and the adapter snippet cannot
// drift), the checks of what `muse mcp list --json` prints, the gate-reason order and the isolated environment.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import {
  MUSE_BIN_VARIABLE,
  MUSE_OPT_IN,
  MUSE_PLUGIN_VALID_PATTERN,
  museEntryProblem,
  museGateReason,
  type MuseGateInputs,
  museIsolatedEnv,
  museListProblem,
  museSettingsText,
  parseMuseVersion,
} from "../support/host-live-muse.js";

const SNIPPET_PATH = fileURLToPath(new URL("../../../adapters/muse-code/mcp-settings.snippet.json", import.meta.url));
const DOC_PATH = fileURLToPath(new URL("../../../docs/hosts/snippets/muse-code.md", import.meta.url));

const SNIPPET_TEXT = readFileSync(SNIPPET_PATH, "utf8");

function snippetObject(): Record<string, unknown> {
  return JSON.parse(SNIPPET_TEXT) as Record<string, unknown>;
}

// The entry object of a freshly parsed snippet, for a mutant to change.
function realmEntry(settings: Record<string, unknown>): Record<string, unknown> {
  const servers = settings["mcpServers"] as Record<string, Record<string, unknown>>;
  const entry = servers["realm"];
  assert.ok(entry !== undefined);
  return entry;
}

void test("V1LIVE-01 parseMuseVersion reads the recorded line, refuses text without a version and ignores a number before the product name", () => {
  assert.equal(parseMuseVersion("Muse Code 1.4.23 (1.4.23-R8977.1)\n"), "1.4.23");
  assert.equal(parseMuseVersion("Muse Code 2.0.1\n"), "2.0.1");
  assert.equal(parseMuseVersion("Muse Code\n"), undefined);
  assert.equal(parseMuseVersion("1.2.3\n"), undefined);
  assert.equal(parseMuseVersion("something else 9.9.9\n"), undefined);
  assert.equal(parseMuseVersion("node 22.1.0 runs Muse Code 1.4.23\n"), "1.4.23");
  assert.match("valid\trealm\tnative\tskills=0 commands=0 hooks=0 mcp=0 reminders=0 diagnostics=0\n", MUSE_PLUGIN_VALID_PATTERN);
  assert.match("valid realm native skills=0 commands=0 hooks=0 mcp=0 reminders=0 diagnostics=0\n", MUSE_PLUGIN_VALID_PATTERN);
  assert.doesNotMatch("valid\trealm\tnative\tskills=1 commands=0 hooks=0 mcp=0 reminders=0 diagnostics=0\n", MUSE_PLUGIN_VALID_PATTERN);
});

void test("V1LIVE-01 museSettingsText accepts the adapter snippet and refuses every mutant of it", () => {
  const text = museSettingsText(SNIPPET_TEXT);
  assert.ok(text.endsWith("\n"));
  assert.deepEqual(JSON.parse(text), snippetObject());
  const mutants: readonly (readonly [string, (settings: Record<string, unknown>) => void, RegExp])[] = [
    ["command changed", (s) => { realmEntry(s)["command"] = "/usr/bin/realm"; }, /command/],
    ["args empty", (s) => { realmEntry(s)["args"] = []; }, /args/],
    ["args without the host flag", (s) => { realmEntry(s)["args"] = ["mcp"]; }, /args/],
    ["args with a changed label", (s) => { realmEntry(s)["args"] = ["mcp", "--host", "claude"]; }, /args/],
    ["args with an extra element", (s) => { realmEntry(s)["args"] = ["mcp", "--host", "muse-code", "--x"]; }, /args/],
    ["required removed", (s) => { delete realmEntry(s)["required"]; }, /lacks required/],
    ["required false", (s) => { realmEntry(s)["required"] = false; }, /required/],
    ["type changed", (s) => { realmEntry(s)["type"] = "streamable_http"; }, /type/],
    ["the old transport member", (s) => { realmEntry(s)["transport"] = "stdio"; }, /unexpected key: transport/],
    ["the old enabled member", (s) => { realmEntry(s)["enabled"] = true; }, /unexpected key: enabled/],
    ["the old mode member", (s) => { realmEntry(s)["mode"] = "required"; }, /unexpected key: mode/],
    ["schema_version 2", (s) => { s["schema_version"] = 2; }, /schema_version/],
    ["schema_version missing", (s) => { delete s["schema_version"]; }, /schema_version/],
    ["the old spelling of the list", (s) => { s["mcp_servers"] = s["mcpServers"]; delete s["mcpServers"]; }, /unexpected top-level key: mcp_servers/],
    ["both spellings", (s) => { s["mcp_servers"] = {}; }, /unexpected top-level key: mcp_servers/],
    ["a second server", (s) => { (s["mcpServers"] as Record<string, unknown>)["other"] = { type: "stdio", command: "other", args: [] }; }, /exactly the server realm/],
    ["an extra key on the entry", (s) => { realmEntry(s)["env"] = {}; }, /unexpected key: env/],
    ["an extra top-level key", (s) => { s["theme"] = "dark"; }, /unexpected top-level key: theme/],
  ];
  for (const [name, mutate, message] of mutants) {
    const settings = snippetObject();
    mutate(settings);
    assert.throws(() => museSettingsText(JSON.stringify(settings)), message, `mutant: ${name}`);
  }
  assert.throws(() => museSettingsText("not json"), /not JSON/);
  assert.throws(() => museSettingsText("[]"), /not an object/);
});

void test("V1LIVE-01 the first json block of the Muse Code snippet page is the adapter snippet", () => {
  const page = readFileSync(DOC_PATH, "utf8");
  const open = page.indexOf("```json\n");
  assert.ok(open >= 0, "the page has a json block");
  const start = open + "```json\n".length;
  const close = page.indexOf("\n```", start);
  assert.ok(close > start, "the json block is closed");
  assert.ok(isDeepStrictEqual(JSON.parse(page.slice(start, close)), snippetObject()), "the documented entry and the tested entry are the same");
});

// The object `muse mcp list --json` printed for the snippet on 2026-11-18 (Muse Code 1.4.23), plus keys the checks ignore.
function measuredEntry(): Record<string, unknown> {
  return {
    args: ["mcp", "--host", "muse-code"],
    auth: "none",
    command: "realm",
    cwd: null,
    enabled: true,
    env: {},
    name: "realm",
    required: true,
    source: "user",
    startup_timeout_sec: 30.0,
    status: "enabled",
    type: "stdio",
    url: null,
  };
}

void test("V1LIVE-01 museEntryProblem and museListProblem accept the measured object and refuse each single-field mutant", () => {
  assert.equal(museEntryProblem(measuredEntry()), undefined);
  assert.equal(museListProblem({ servers: [measuredEntry()] }), undefined);
  assert.equal(museEntryProblem({ ...measuredEntry(), remove_hint: "muse mcp remove realm" }), undefined, "keys Muse prints beyond the checked ones are ignored");
  const fields: readonly (readonly [string, unknown])[] = [
    ["name", "other"],
    ["enabled", false],
    ["type", "streamable_http"],
    ["required", false],
    ["source", "project"],
    ["status", "disabled"],
    ["command", "/usr/bin/realm"],
    ["args", []],
    ["args", ["mcp"]],
    ["args", ["mcp", "--host", "claude"]],
    ["args", ["mcp", "--other"]],
  ];
  for (const [field, value] of fields) {
    const entry = { ...measuredEntry(), [field]: value };
    const problem = museEntryProblem(entry);
    assert.ok(problem !== undefined && problem.includes(field), `${field}=${JSON.stringify(value)}: ${String(problem)}`);
    assert.notEqual(museListProblem({ servers: [entry] }), undefined, `${field} in a list`);
  }
  assert.notEqual(museEntryProblem({ ...measuredEntry(), args: ["--x", "mcp", "--host", "muse-code"] }), undefined, "the argument list is exact, not a suffix");
  assert.notEqual(museListProblem({ servers: [] }), undefined);
  assert.match(String(museListProblem({ servers: [measuredEntry(), measuredEntry()] })), /2 servers/);
  assert.notEqual(museListProblem({}), undefined);
  assert.notEqual(museListProblem("text"), undefined);
  assert.notEqual(museListProblem(null), undefined);
  assert.notEqual(museEntryProblem([]), undefined);
  assert.notEqual(museEntryProblem(null), undefined);
});

// Inputs under which every prerequisite holds; a case overrides one field.
function gateInputs(over: Partial<MuseGateInputs> = {}): MuseGateInputs {
  return {
    env: { [MUSE_OPT_IN]: "1" },
    platform: "linux",
    resolveBinary: (name) => `/usr/bin/${name}`,
    versionProbe: { kind: "output", stdout: "Muse Code 1.4.23 (1.4.23-R8977.1)\n" },
    ...over,
  };
}

void test("V1LIVE-01 museGateReason names the first missing prerequisite in order and is false when all hold", () => {
  assert.equal(museGateReason(gateInputs()), false);
  assert.match(String(museGateReason(gateInputs({ env: {}, platform: "darwin", resolveBinary: () => undefined }))), /REALM_LIVE_MUSE=1 is not set/);
  assert.match(String(museGateReason(gateInputs({ env: { [MUSE_OPT_IN]: "0" } }))), /REALM_LIVE_MUSE=1 is not set/);
  assert.match(String(museGateReason(gateInputs({ platform: "darwin", resolveBinary: () => undefined }))), /Linux only; this host is darwin/);
  assert.match(String(museGateReason(gateInputs({ env: { [MUSE_OPT_IN]: "1", [MUSE_BIN_VARIABLE]: "bin/muse" }, resolveBinary: () => undefined }))), /REALM_MUSE_BIN must be an absolute path/);
  assert.match(String(museGateReason(gateInputs({ resolveBinary: () => undefined, versionProbe: { kind: "unavailable" } }))), /no Muse Code executable muse; install muse or point REALM_MUSE_BIN at it/);
  assert.match(String(museGateReason(gateInputs({ env: { [MUSE_OPT_IN]: "1", [MUSE_BIN_VARIABLE]: "/opt/muse" }, resolveBinary: () => undefined }))), /no Muse Code executable \/opt\/muse/);
  assert.match(String(museGateReason(gateInputs({ versionProbe: { kind: "unavailable" } }))), /--version did not run to a successful exit/);
  assert.match(String(museGateReason(gateInputs({ versionProbe: { kind: "output", stdout: "Muse Code\n" } }))), /printed no x\.y\.z version/);
  assert.match(String(museGateReason(gateInputs({ versionProbe: { kind: "output", stdout: "1.4.23\n" } }))), /printed no x\.y\.z version/);
});

void test("V1LIVE-01 museIsolatedEnv holds exactly the isolated keys, all paths inside the root, and no credential-like name", () => {
  const root = "/tmp/rlh-muse-x";
  const env = museIsolatedEnv(root, "/shim:/usr/bin");
  assert.deepEqual(Object.keys(env).sort(), ["HOME", "LANG", "PATH", "TERM", "XDG_CACHE_HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME"]);
  assert.equal(env["PATH"], "/shim:/usr/bin");
  for (const name of ["HOME", "XDG_CACHE_HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME"]) {
    assert.ok(env[name]?.startsWith(`${root}/`), `${name} is inside the root`);
  }
  assert.equal(env["LANG"], "C.UTF-8");
  assert.equal(env["TERM"], "dumb");
  assert.equal(Object.keys(env).filter((name) => /TOKEN|KEY|SECRET|PASSWORD|MUSE/.test(name)).length, 0);
});

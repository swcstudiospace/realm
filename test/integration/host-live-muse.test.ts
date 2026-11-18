// Muse Code against its real CLI, validator tier (V1LIVE-01 / OI-07, 36-CONTEXT D-36-04). Muse Code has no recipe, registry record or
// `--host` id, so no `realm host install` runs: the documented settings entry (docs/hosts/snippets/muse-code.md, command `realm`, args
// `mcp`) is written verbatim into an ISOLATED settings file and the real `muse` binary is asked what it makes of it.
//
// One scenario; the real `realm` is never run, a wire recorder named `realm` first on the PATH stands in for it and forwards to a fake
// MCP server that answers the handshake, so the entry stays byte-identical to the documented one and Muse must resolve it through PATH.
//   A  `muse --version` is recorded; `muse plugins validate adapters/muse-code` prints the `valid realm native` line
//   B  the snippet passes museSettingsText and is written to <config home>/muse/settings.json of the isolated environment
//   C  `muse mcp list --json` and `muse mcp get realm --json` print the entry and start nothing (no server start, empty wire log)
//   D  `muse exec --provider echo --trust-workspace` starts the required entry through PATH, completes the handshake and sees the six
//      Realm tools. The workspace is trusted by the flag: without it Muse does not start the entry (measured 2026-11-18, 36-CONTEXT
//      E-36-06), which this test notes and does not assert
//   E  control: a stub `realm` that does not speak MCP makes the same run fail with `failed during startup`; the stub records `mcp`
//   F  the operator's real Muse settings file is byte-equal before and after
//
// Opt in with REALM_LIVE_MUSE=1 and optionally REALM_MUSE_BIN (an absolute path to the muse executable):
//   REALM_LIVE_MUSE=1 node --test dist/test/integration/host-live-muse.test.js
// The test never sets a gate variable, never forwards a credential (the environment is museIsolatedEnv), never sends a model prompt (the
// echo provider answers locally) and prints only versions, exit codes, counts and method or tool names.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { delimiter, dirname, isAbsolute, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { describeRun, fileSha256, processAlive, readStubArgv, requireReturned, resolveExecutable, runHost, stripAnsi, VALIDATOR_TIMEOUT_MS, writeStubRealm, type HostVersionProbe } from "../support/host-live.js";
import {
  MUSE_BIN_VARIABLE,
  MUSE_PLUGIN_VALID_PATTERN,
  MUSE_RECORDED_VERSION,
  museEntryProblem,
  museGateReason,
  museIsolatedEnv,
  museListProblem,
  museSettingsText,
  parseMuseVersion,
} from "../support/host-live-muse.js";
import { readFakeServerLog, readWireLog, REALM_TOOL_NAMES, SESSION_PROMPT, wireSummary, writeFakeMcpServer, writeWireRecorder } from "../support/host-live-session.js";
import { scaledMs, testTimeout } from "../support/timing.js";

const PLUGIN_BUNDLE = fileURLToPath(new URL("../../../adapters/muse-code", import.meta.url));
const SNIPPET = fileURLToPath(new URL("../../../adapters/muse-code/mcp-settings.snippet.json", import.meta.url));

// The gate is decided once, at module top: nothing is probed when REALM_LIVE_MUSE is not 1 on Linux.
function museBinary(): string | undefined {
  const override = process.env[MUSE_BIN_VARIABLE];
  const named = override === undefined || override === "" ? "muse" : override;
  if (!isAbsolute(named) && override !== undefined && override !== "") {
    return undefined;
  }
  return resolveExecutable(named, process.env["PATH"]);
}

async function probeVersion(bin: string): Promise<HostVersionProbe> {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "rlh-muse-ver-")));
  try {
    const env = museIsolatedEnv(home, [dirname(bin), dirname(process.execPath), "/usr/bin", "/bin"].join(delimiter));
    const result = await runHost(bin, ["--version"], env, home, scaledMs(VALIDATOR_TIMEOUT_MS));
    return result.exitCode === 0 ? { kind: "output", stdout: result.stdout } : { kind: "unavailable" };
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

const BIN = process.env["REALM_LIVE_MUSE"] === "1" && process.platform === "linux" ? museBinary() : undefined;
const VERSION_PROBE: HostVersionProbe = BIN === undefined ? { kind: "unavailable" } : await probeVersion(BIN);
const SKIP = museGateReason({ env: process.env, platform: process.platform, resolveBinary: (name) => resolveExecutable(name, process.env["PATH"]), versionProbe: VERSION_PROBE });

// The operator's real Muse settings files: below HOME, and below XDG_CONFIG_HOME when the real process sets it. `absent` is a value.
function realSettingsHashes(): string[] {
  const paths = new Set<string>([join(homedir(), ".config", "muse", "settings.json")]);
  const xdg = process.env["XDG_CONFIG_HOME"];
  if (xdg !== undefined && xdg !== "" && isAbsolute(xdg)) {
    paths.add(join(xdg, "muse", "settings.json"));
  }
  return [...paths].map((path) => fileSha256(path) ?? "absent");
}

void test(
  "V1LIVE-01 muse validator: the documented realm entry is listed, started through PATH, handshaken and shows the six tools; a broken entry fails visibly; the real settings stay untouched",
  { skip: SKIP, ...testTimeout(600_000) },
  async (t) => {
    assert.ok(BIN !== undefined, "the gate found the muse executable");
    const bin = BIN;
    const root = realpathSync(mkdtempSync(join(tmpdir(), "rlh-muse-")));
    t.after(() => {
      rmSync(root, { recursive: true, force: true });
    });
    const bound = scaledMs(VALIDATOR_TIMEOUT_MS);
    const realBefore = realSettingsHashes();

    const workspace = join(root, "workspace");
    const shim = join(root, "shim");
    const stubDir = join(root, "stub");
    const serverLog = join(root, "fake-server.log");
    const wireLog = join(root, "wire.log");
    const stubLog = join(root, "stub.log");
    for (const dir of ["home", "config", "data", "state", "cache"]) {
      mkdirSync(join(root, dir), { recursive: true });
    }
    mkdirSync(workspace, { recursive: true });
    const systemPath = [dirname(process.execPath), "/usr/bin", "/bin"];
    const env = museIsolatedEnv(root, [shim, ...systemPath].join(delimiter));
    const stubEnv = museIsolatedEnv(root, [stubDir, ...systemPath].join(delimiter));
    const clean = (result: { readonly stdout: string; readonly stderr: string }): string => stripAnsi(`${result.stdout}\n${result.stderr}`);

    // A: the version, then the offline validation of the plugin bundle (plugin commands need the experimental flag).
    const observed = parseMuseVersion(VERSION_PROBE.kind === "output" ? VERSION_PROBE.stdout : "");
    t.diagnostic(`muse version observed ${observed ?? "unknown"}, recorded ${MUSE_RECORDED_VERSION}`);
    const validate = await runHost(bin, ["plugins", "validate", PLUGIN_BUNDLE], { ...env, MUSE_EXPERIMENTAL_PLUGINS: "1" }, workspace, bound);
    requireReturned(validate, "muse plugins validate");
    assert.equal(validate.exitCode, 0, describeRun(validate));
    assert.match(clean(validate), MUSE_PLUGIN_VALID_PATTERN, describeRun(validate));
    t.diagnostic("A: plugin bundle validated (valid realm native, all counts 0)");

    // B: the documented entry, verbatim, in the isolated settings file; the recorder shim stands in for `realm` on the PATH.
    mkdirSync(join(root, "config", "muse"), { recursive: true });
    writeFileSync(join(root, "config", "muse", "settings.json"), museSettingsText(readFileSync(SNIPPET, "utf8")));
    const server = writeFakeMcpServer(join(root, "server"), serverLog);
    writeWireRecorder(shim, { nodePath: process.execPath, target: [process.execPath, server], logFile: wireLog });
    writeStubRealm(stubDir, stubLog);
    t.diagnostic("B: the snippet entry was written to the isolated settings file");

    // C: listing reads the file and starts nothing.
    const list = await runHost(bin, ["mcp", "list", "--json"], env, workspace, bound);
    requireReturned(list, "muse mcp list --json");
    assert.equal(list.exitCode, 0, describeRun(list));
    assert.equal(museListProblem(JSON.parse(list.stdout)), undefined, "muse mcp list --json shows exactly the documented realm entry");
    const get = await runHost(bin, ["mcp", "get", "realm", "--json"], env, workspace, bound);
    requireReturned(get, "muse mcp get realm --json");
    assert.equal(get.exitCode, 0, describeRun(get));
    assert.equal(museEntryProblem(JSON.parse(get.stdout)), undefined, "muse mcp get realm --json shows the documented realm entry");
    assert.equal(readFakeServerLog(serverLog).starts.length, 0, "listing started no server");
    assert.equal(readWireLog(wireLog).length, 0, "listing sent nothing over the wire");
    t.diagnostic("C: mcp list and mcp get print the documented entry and started no server");

    // D: a run starts the required entry through PATH. Muse starts it only in a trusted workspace; the flag trusts the scratch one.
    const started = Date.now();
    const run = await runHost(bin, ["exec", "--provider", "echo", "--trust-workspace", SESSION_PROMPT], env, workspace, bound);
    const elapsed = Date.now() - started;
    requireReturned(run, "muse exec");
    assert.equal(run.exitCode, 0, describeRun(run));
    assert.doesNotMatch(clean(run), /failed during startup/, describeRun(run));
    const log = readFakeServerLog(serverLog);
    const launches = log.starts.filter((start) => start.argv.length === 1 && start.argv[0] === "mcp");
    assert.ok(launches.length >= 1, `Muse started the realm entry through PATH with the argument mcp (${String(log.starts.length)} starts recorded)`);
    const summary = wireSummary(readWireLog(wireLog));
    assert.ok(summary.hostMethods.includes("initialize") || summary.hostMethods.includes("server/discover"), `the host opened the session: ${summary.hostMethods.join(",")}`);
    assert.deepEqual([...summary.toolNames], [...REALM_TOOL_NAMES], "Muse saw the six Realm tools");
    for (const start of log.starts) {
      assert.equal(processAlive(start.pid), false, "no server process outlives the run");
    }
    t.diagnostic(`D: exec exit 0 in ${String(elapsed)} ms; server starts ${String(log.starts.length)} (argv mcp: ${String(launches.length)}); host methods ${summary.hostMethods.join(",")}; tools ${summary.toolNames.join(",")}`);

    // E: control, a broken entry is visible.
    const broken = await runHost(bin, ["exec", "--provider", "echo", "--trust-workspace", SESSION_PROMPT], stubEnv, workspace, bound);
    requireReturned(broken, "muse exec with a broken realm");
    assert.notEqual(broken.exitCode, 0, `a realm that does not speak MCP must fail the run; ${describeRun(broken)}`);
    assert.match(clean(broken), /failed during startup/, describeRun(broken));
    const stubArgv = readStubArgv(stubLog);
    assert.ok(stubArgv.some((argv) => argv.length === 1 && argv[0] === "mcp"), `the stub realm was started with the argument mcp (${String(stubArgv.length)} invocations)`);
    t.diagnostic(`E: a stub realm failed the run (exit ${String(broken.exitCode)}, failed during startup); stub invocations ${String(stubArgv.length)}`);

    // F: the operator's real settings file is byte-equal.
    assert.deepEqual(realSettingsHashes(), realBefore, "the operator's real Muse settings file must be unchanged");
    t.diagnostic("F: the operator's real Muse settings file is byte-equal before and after");
  },
);

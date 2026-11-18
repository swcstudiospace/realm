// Muse Code against its real CLI, validator tier (V1LIVE-01 / OI-07, 36-CONTEXT D-36-04; re-pointed at the real recipe by 40-03). The entry is
// written by `realm host install muse-code` (the real table, in process) into an ISOLATED settings file, and the real `muse` binary is asked
// what it makes of it. The shipped snippet (docs/hosts/snippets/muse-code.md, command `realm`, args `mcp --host muse-code`, required) is the
// document the install must produce: the snippet, the recipe and this run are one entry (40-CONTEXT D-40-04).
//
// One scenario; the real `realm` daemon is never run, a wire recorder named `realm` first on the PATH stands in for it and forwards to a fake
// MCP server that answers the handshake, so Muse must resolve the entry through PATH.
//   A  `muse --version` is recorded; `muse plugins validate adapters/muse-code` prints the `valid realm native` line
//   B  `realm host install muse-code --dry-run` names settings.json and writes nothing; the real install writes the settings file, whose
//      document equals that of the shipped snippet; `realm host status muse-code` says installed
//   C  `muse mcp list --json` and `muse mcp get realm --json` print the entry and start nothing (no server start, empty wire log)
//   C2 the host's own writer: `muse mcp add other` exits 0, the realm entry and `realm host status` are observed (E-40-03: the entry stays
//      value-identical), `muse mcp remove other` exits 0
//   D  `muse exec --provider echo --trust-workspace` starts the required entry through PATH, completes the handshake and sees the six
//      Realm tools. The workspace is trusted by the flag: without it Muse does not start the entry (measured 2026-11-18, 36-CONTEXT
//      E-36-06), which this test notes and does not assert
//   E  control: a stub `realm` that does not speak MCP makes the same run fail with `failed during startup`; the stub records `mcp --host muse-code`
//   E2 `realm host uninstall muse-code` removes the realm entry, and the settings file itself when nothing but the seed remains (the host's
//      lock file may stay and is not asserted); when more remains the file is kept, which the test asserts instead and names in its diagnostic
//   F  the operator's real Muse settings file is byte-equal before and after, and no muse process the run started is left
//
// Opt in with REALM_LIVE_MUSE=1 and optionally REALM_MUSE_BIN (an absolute path to the muse executable):
//   REALM_LIVE_MUSE=1 node --test dist/test/integration/host-live-muse.test.js
// The test never sets a gate variable, never forwards a credential (the environment is museIsolatedEnv), never sends a model prompt (the
// echo provider answers locally) and prints only versions, exit codes, counts and method or tool names.

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { delimiter, dirname, isAbsolute, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { runCli } from "../../src/cli/main.js";
import { actionsOf, cliJson, describeRun, fileSha256, processAlive, readStubArgv, requireReturned, resolveExecutable, runHost, stripAnsi, VALIDATOR_TIMEOUT_MS, writeStubRealm, type HostVersionProbe } from "../support/host-live.js";
import {
  countProcessesNamed,
  MUSE_BIN_VARIABLE,
  MUSE_PLUGIN_VALID_PATTERN,
  MUSE_RECORDED_VERSION,
  museEntryProblem,
  museGateReason,
  museInstalledProblem,
  museIsolatedEnv,
  museListProblem,
  museUninstallExpectation,
  parseMuseVersion,
} from "../support/host-live-muse.js";
import { readFakeServerLog, readWireLog, REALM_TOOL_NAMES, SESSION_PROMPT, wireSummary, writeFakeMcpServer, writeWireRecorder } from "../support/host-live-session.js";
import { isRecord } from "../support/omp-live.js";
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

// The argument list the entry gives the server: the labelled launcher of the muse-code recipe (40-CONTEXT D-40-04).
const IMAGE = `registry.example.com/realm/workload@sha256:${"0".repeat(64)}`;
const isMuseLaunch = (argv: readonly string[]): boolean => argv.length === 3 && argv[0] === "mcp" && argv[1] === "--host" && argv[2] === "muse-code";
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
    const museBefore = countProcessesNamed("muse");

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

    // B: the real recipe installs the entry; the recorder shim stands in for `realm` on the PATH. The dry run writes nothing.
    const museHome = join(root, "config", "muse");
    mkdirSync(museHome, { recursive: true });
    const server = writeFakeMcpServer(join(root, "server"), serverLog);
    writeWireRecorder(shim, { nodePath: process.execPath, target: [process.execPath, server], logFile: wireLog });
    writeStubRealm(stubDir, stubLog);
    const stateDir = join(root, "realm-state");
    mkdirSync(stateDir, { mode: 0o700 });
    const realm = (words: readonly string[]) =>
      runCli(["host", ...words], { env, readConfig: () => ({ image: IMAGE, stateDir, workspaceRoot: join(root, "projects") }), now: () => new Date() });
    const settingsFile = join(museHome, "settings.json");
    const planned = cliJson(await realm(["install", "muse-code", "--dry-run"]), "realm host install muse-code --dry-run");
    assert.equal(planned["status"], "planned");
    assert.equal(planned["dryRun"], true);
    assert.ok(
      actionsOf(planned, "dry run").some((action) => action.path === "settings.json" && action.action === "create"),
      `the dry run must create settings.json: ${JSON.stringify(planned["actions"])}`,
    );
    assert.equal(existsSync(settingsFile), false, "a dry run writes nothing");
    const installed = cliJson(await realm(["install", "muse-code"]), "realm host install muse-code");
    assert.equal(installed["status"], "installed", JSON.stringify(installed));
    assert.equal(museInstalledProblem(readFileSync(settingsFile, "utf8"), readFileSync(SNIPPET, "utf8")), undefined, "the install wrote exactly the document of the shipped snippet");
    const afterInstall = cliJson(await realm(["status", "muse-code"]), "realm host status muse-code");
    assert.equal(afterInstall["status"], "installed", JSON.stringify(afterInstall));
    t.diagnostic("B: the dry run wrote nothing; the install wrote the shipped snippet document; realm host status says installed");

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

    // C2: the host's own writer. Muse rewrites the file (sorted keys, no trailing newline); 36/40-CONTEXT E-40-03 recorded that the realm entry
    // stays value-identical, `required` included. A different observation is a finding: it is printed before it is asserted, never hidden.
    const added = await runHost(bin, ["mcp", "add", "other", "--", "other-cmd"], env, workspace, bound);
    requireReturned(added, "muse mcp add other");
    assert.equal(added.exitCode, 0, describeRun(added));
    const afterAdd = await runHost(bin, ["mcp", "get", "realm", "--json"], env, workspace, bound);
    requireReturned(afterAdd, "muse mcp get realm --json after the host's own add");
    const keptProblem = afterAdd.exitCode === 0 ? museEntryProblem(JSON.parse(afterAdd.stdout)) : `exit ${String(afterAdd.exitCode)}`;
    const afterAddStatus = cliJson(await realm(["status", "muse-code"]), "realm host status muse-code after muse mcp add");
    t.diagnostic(
      `C2: after muse mcp add other the realm entry is ${keptProblem === undefined ? "value-identical (E-40-03)" : `CHANGED: ${keptProblem} (a finding)`}; realm host status ${String(afterAddStatus["status"])}`,
    );
    assert.equal(keptProblem, undefined, "FINDING: muse mcp add rewrote the realm entry; record it in the registry and the snippet page");
    assert.equal(afterAddStatus["status"], "installed", `FINDING: realm host status says ${String(afterAddStatus["status"])} after the host's own add: ${JSON.stringify(afterAddStatus)}`);
    const removed = await runHost(bin, ["mcp", "remove", "other"], env, workspace, bound);
    requireReturned(removed, "muse mcp remove other");
    assert.equal(removed.exitCode, 0, describeRun(removed));
    assert.equal(readFakeServerLog(serverLog).starts.length, 0, "the host's own writer started no server");

    // D: a run starts the required entry through PATH. Muse starts it only in a trusted workspace; the flag trusts the scratch one.
    const started = Date.now();
    const run = await runHost(bin, ["exec", "--provider", "echo", "--trust-workspace", SESSION_PROMPT], env, workspace, bound);
    const elapsed = Date.now() - started;
    requireReturned(run, "muse exec");
    assert.equal(run.exitCode, 0, describeRun(run));
    assert.doesNotMatch(clean(run), /failed during startup/, describeRun(run));
    const log = readFakeServerLog(serverLog);
    const launches = log.starts.filter((start) => isMuseLaunch(start.argv));
    assert.ok(launches.length >= 1, `Muse started the realm entry through PATH with the arguments mcp --host muse-code (${String(log.starts.length)} starts recorded)`);
    const summary = wireSummary(readWireLog(wireLog));
    assert.ok(summary.hostMethods.includes("initialize") || summary.hostMethods.includes("server/discover"), `the host opened the session: ${summary.hostMethods.join(",")}`);
    assert.deepEqual([...summary.toolNames], [...REALM_TOOL_NAMES], "Muse saw the six Realm tools");
    for (const start of log.starts) {
      assert.equal(processAlive(start.pid), false, "no server process outlives the run");
    }
    t.diagnostic(`D: exec exit 0 in ${String(elapsed)} ms; server starts ${String(log.starts.length)} (argv mcp --host muse-code: ${String(launches.length)}); host methods ${summary.hostMethods.join(",")}; tools ${summary.toolNames.join(",")}`);

    // E: control, a broken entry is visible.
    const broken = await runHost(bin, ["exec", "--provider", "echo", "--trust-workspace", SESSION_PROMPT], stubEnv, workspace, bound);
    requireReturned(broken, "muse exec with a broken realm");
    assert.notEqual(broken.exitCode, 0, `a realm that does not speak MCP must fail the run; ${describeRun(broken)}`);
    assert.match(clean(broken), /failed during startup/, describeRun(broken));
    const stubArgv = readStubArgv(stubLog);
    assert.ok(stubArgv.some((argv) => isMuseLaunch(argv)), `the stub realm was started with the arguments mcp --host muse-code (${String(stubArgv.length)} invocations)`);
    t.diagnostic(`E: a stub realm failed the run (exit ${String(broken.exitCode)}, failed during startup); stub invocations ${String(stubArgv.length)}`);

    // E2: uninstall removes only what the install wrote. Realm created the file, so when nothing but the seed and the realm entry is in it the
    // file goes too; when the host put more in it, the file stays and says so.
    const expectation = museUninstallExpectation(readFileSync(settingsFile, "utf8"));
    assert.notEqual(expectation, "unreadable", "the settings file the host left is a JSON object");
    const uninstalled = cliJson(await realm(["uninstall", "muse-code"]), "realm host uninstall muse-code");
    assert.equal(uninstalled["status"], "removed", JSON.stringify(uninstalled));
    if (expectation === "file-removed") {
      assert.equal(existsSync(settingsFile), false, "only the seed and the realm entry were there: uninstall removes the settings file itself");
    } else {
      assert.equal(existsSync(settingsFile), true, "the host put more in the file: uninstall keeps it");
      const remaining: unknown = JSON.parse(readFileSync(settingsFile, "utf8"));
      assert.ok(isRecord(remaining) && !(isRecord(remaining["mcpServers"]) && Object.hasOwn(remaining["mcpServers"], "realm")), "uninstall removed the realm entry");
    }
    assert.equal(readStubArgv(stubLog).length, stubArgv.length, "uninstall started nothing");
    t.diagnostic(`E2: uninstall removed the realm entry; the settings file was ${expectation === "file-removed" ? "removed (only the seed remained)" : "kept (the host left more in it)"}`);

    // F: the operator's real settings file is byte-equal, and no process of the run is left.
    assert.deepEqual(realSettingsHashes(), realBefore, "the operator's real Muse settings file must be unchanged");
    const museAfter = countProcessesNamed("muse");
    assert.ok(museAfter <= museBefore, `no muse process the run started is left (${String(museBefore)} before, ${String(museAfter)} after)`);
    t.diagnostic(`F: the operator's real Muse settings file is byte-equal before and after; muse processes ${String(museBefore)} before, ${String(museAfter)} after`);
  },
);

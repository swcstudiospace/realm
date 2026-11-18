// Kimi Code (the 2.x Node product, `@moonshot-ai/kimi-code`) against the real `kimi` CLI (ADPT-08, BOOTP-01, KIMI-01). Three groups of
// tests: the validator tier, the validator-tier session proof, and the production tier. The command name `kimi` is shared with the legacy
// Python CLI (test/integration/host-live-kimi.test.ts): the gate skips this file when the installed kimi is 1.x or older.
//
// Kimi Code documents no command that launches a registered server and no listing command (43-CONTEXT E-43-06): its only validators are
// `kimi doctor` (it does not check mcp.json) and the absence of `kimi mcp`. So the proof that the host launches the recipe's entry is the
// session group, as for Codex. Kimi Code needs a key variable to define a provider at all (E-43-08): the session drives carry the one
// fixed non-secret literal KIMI_REHEARSAL_KEY, never an operator credential, and the refusing provider judges every header against it.
//
//   kimi-code validator (REALM_LIVE_KIMI_CODE=1, a Kimi Code executable, the built CLI; no Podman): the real recipe installs mcp.json into
//     an isolated KIMI_CODE_HOME.
//     A  dry run names mcp.json            B  install; status installed
//     C  `kimi doctor` exits 0             D  `kimi mcp list` is an unknown command (the evidence that no host validator exists)
//     E  uninstall removes the entry and the receipt
//   kimi-code validator session (REALM_LIVE_KIMI_CODE=1, no Podman): `kimi -p` against a refusing loopback provider launches the
//     registered server, which is the wire recorder in front of a fake MCP server. The test proves the argv, the working directory, the
//     handshake, the tool listing, that the whole environment is forwarded and that only the fixed key is ever sent.
//   kimi-code production (the validator gate plus the production prerequisites): the same session against `realm mcp --host kimi-code` on
//     the production stack, ended once the daemon shows an attached boot report and the recorder shows the six tools. See runHostProduction.
//
// The test never sets a gate variable, forwards no operator credential, sends no model turn that anything answers and prints neither an
// environment value nor a header. Every validator-tier host command runs with the containment environment (update and telemetry switches
// off, a dead proxy; 43-CONTEXT D-43-07). The operator's real ~/.kimi-code/mcp.json is hashed before and after and must not change.

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { basename, delimiter, join } from "node:path";
import { test, type TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import {
  actionsOf,
  cliJson,
  collectHostLiveGate,
  createHostRig,
  describeRun,
  fileSha256,
  gateBin,
  hostStatusOf,
  hostVersionNote,
  jsonObjectAt,
  processAlive,
  requireReturned,
  runHost,
  runHostProduction,
  stripAnsi,
  VALIDATOR_TIMEOUT_MS,
  type HostRig,
  type HostRunResult,
} from "../support/host-live.js";
import { kimiCodeDriveEnv, kimiCodeSessionArgs, kimiContainmentEnv, KIMI_REHEARSAL_KEY } from "../support/host-live-kimi.js";
import {
  isLoopbackPeer,
  readFakeServerLog,
  readWireLog,
  REALM_TOOL_NAMES,
  runHostUntil,
  startRefusingProvider,
  wireSummary,
  withoutShellNames,
  writeFakeMcpServer,
  writeWireRecorder,
} from "../support/host-live-session.js";
import { pollUntil, scaledMs, testTimeout } from "../support/timing.js";

const CLI_PATH = fileURLToPath(new URL("../../src/cli/main.js", import.meta.url));
const REAL_KIMI_CODE_MCP = join(homedir(), ".kimi-code", "mcp.json");

const validator = await collectHostLiveGate("kimi-code", "validator", { env: process.env, platform: process.platform, cliPath: CLI_PATH });
const production = await collectHostLiveGate("kimi-code", "production", { env: process.env, platform: process.platform, cliPath: CLI_PATH });

function rigFor(t: TestContext): HostRig {
  const rig = createHostRig({ host: "kimi-code", bin: gateBin(validator), overrides: { KIMI_CODE_HOME: "kimi-code" } }, process.env);
  t.after(() => {
    rig.dispose();
  });
  return rig;
}

// A host command in the rig's isolated environment plus the containment environment (the rig's own host method takes no environment).
function runContained(rig: HostRig, args: readonly string[]): Promise<HostRunResult> {
  return runHost(rig.bin, args, { ...rig.env, ...kimiContainmentEnv() }, rig.cwd, scaledMs(VALIDATOR_TIMEOUT_MS));
}

// The first non-empty line of a command's output, colour removed and cut to 200 characters.
function firstLineOf(run: HostRunResult): string {
  const line =
    stripAnsi(`${run.stdout}\n${run.stderr}`)
      .split("\n")
      .map((text) => text.trim())
      .find((text) => text !== "") ?? "";
  return JSON.stringify(line.slice(0, 200));
}

void test(
  "kimi-code validator: the recipe installs mcp.json into the isolated KIMI_CODE_HOME, `kimi doctor` runs, and the host has no `mcp` validator command",
  { skip: validator.skip, ...testTimeout(900_000) },
  async (t) => {
    t.diagnostic(hostVersionNote("kimi-code", validator));
    const realBefore = fileSha256(REAL_KIMI_CODE_MCP);
    const rig = rigFor(t);
    const file = rig.path("kimi-code", "mcp.json");

    // A: a dry run names mcp.json and writes nothing.
    const planned = cliJson(await rig.realm(["install", "kimi-code", "--dry-run"]), "realm host install kimi-code --dry-run");
    assert.equal(planned["status"], "planned");
    assert.equal(planned["dryRun"], true);
    assert.deepEqual(actionsOf(planned, "dry run"), [{ path: "mcp.json", action: "create" }]);
    assert.equal(existsSync(file), false, "a dry run writes nothing");

    // B: install writes it; status installed.
    const installed = cliJson(await rig.realm(["install", "kimi-code"]), "realm host install kimi-code");
    assert.equal(installed["status"], "installed");
    assert.equal(existsSync(file), true, "the install writes <KIMI_CODE_HOME>/mcp.json");
    assert.equal((await hostStatusOf(rig, "kimi-code"))["status"], "installed");

    // C: `kimi doctor` with the isolated home. The documentation says it does not check mcp.json (E-43-06), so only the exit code is asserted.
    const doctor = await runContained(rig, ["doctor"]);
    requireReturned(doctor, "kimi doctor");
    assert.equal(doctor.exitCode, 0, `kimi doctor: ${describeRun(doctor)}`);
    t.diagnostic(`kimi doctor printed: ${firstLineOf(doctor)}`);

    // D: the documented absence of a validator. This is the evidence that no host validator command exists for Kimi Code 2.6.3: a later
    // version that adds `kimi mcp` fails this step, which is the signal to add a validator tier.
    const listed = await runContained(rig, ["mcp", "list"]);
    requireReturned(listed, "kimi mcp list");
    assert.notEqual(listed.exitCode, 0, `kimi mcp list must not exist in this version; a later version that adds it needs a validator tier: ${describeRun(listed)}`);
    assert.match(stripAnsi(`${listed.stdout}\n${listed.stderr}`), /unknown command/i, `kimi mcp list must be an unknown command: ${describeRun(listed)}`);
    t.diagnostic(`kimi mcp list printed: ${firstLineOf(listed)}`);

    // E: uninstall removes the entry and the receipt.
    const removed = cliJson(await rig.realm(["uninstall", "kimi-code"]), "realm host uninstall kimi-code");
    assert.equal(removed["status"], "removed");
    assert.notEqual((await hostStatusOf(rig, "kimi-code"))["status"], "installed");
    assert.equal(existsSync(rig.receiptFile("kimi-code")), false, "the uninstall deletes the receipt");
    if (existsSync(file)) {
      const servers = jsonObjectAt(file)["mcpServers"];
      assert.equal(typeof servers === "object" && servers !== null && "realm" in servers, false, "the realm entry is gone from mcp.json");
    }

    assert.equal(fileSha256(REAL_KIMI_CODE_MCP), realBefore, "the operator's real ~/.kimi-code/mcp.json must be unchanged");
  },
);

void test(
  "kimi-code validator session: kimi -p against a refusing loopback provider launches the registered server, which sees the handshake and tools/list, with only the fixed key sent",
  { skip: validator.skip, ...testTimeout(600_000) },
  async (t) => {
    t.diagnostic(hostVersionNote("kimi-code", validator));
    const realBefore = fileSha256(REAL_KIMI_CODE_MCP);
    const rig = rigFor(t);
    const wireDir = rig.path("wire");
    const serverLog = rig.path("server.log");
    const wireLog = rig.path("wire.log");
    const server = writeFakeMcpServer(wireDir, serverLog);
    writeWireRecorder(wireDir, { nodePath: process.execPath, target: [process.execPath, server], logFile: wireLog });

    const installed = cliJson(await rig.realm(["install", "kimi-code"]), "realm host install kimi-code");
    assert.equal(installed["status"], "installed", "the recipe installs into the isolated KIMI_CODE_HOME");
    const status = await hostStatusOf(rig, "kimi-code");
    assert.equal(status["status"], "installed");
    assert.equal(status["launch"], "on-path", "the bare realm command must resolve on the rig's PATH");
    const configAfterInstall = fileSha256(rig.path("kimi-code", "mcp.json"));

    const provider = await startRefusingProvider({ expectedKey: KIMI_REHEARSAL_KEY });
    t.after(() => provider.close());

    // The rig's allowlist with the recorder directory first on PATH in place of the rig's stub realm, the fixed-key drive variables and the
    // containment (the dead proxy never touches the loopback provider: NO_PROXY keeps it direct).
    const stubDir = rig.path("stub");
    const env: Record<string, string> = { ...rig.env, ...kimiCodeDriveEnv(provider.baseUrl), ...kimiContainmentEnv() };
    env["PATH"] = [wireDir, ...(rig.env["PATH"] ?? "").split(delimiter).filter((entry) => entry !== stubDir)].join(delimiter);

    const startedAt = Date.now();
    const run = await runHostUntil(rig.bin, kimiCodeSessionArgs(), env, rig.cwd, {
      ready: () => Promise.resolve(wireSummary(readWireLog(wireLog)).answered),
      timeoutMs: scaledMs(180_000),
      pollMs: 500,
    });
    const readyMs = Date.now() - startedAt;
    const summary = wireSummary(readWireLog(wireLog));
    const wire = `host methods [${summary.hostMethods.join(", ")}], tools [${summary.toolNames.join(", ")}]`;
    const requests = provider.requests();
    t.diagnostic(`kimi-code session ended by ${run.endedBy} after ${String(readyMs)} ms; wire: ${wire}; the refusing provider saw ${String(requests.length)} request(s)`);
    assert.equal(
      run.endedBy,
      "ready",
      `kimi did not send tools/list to the registered server (ended by ${run.endedBy}; an exit before tools/list is B-43-03: the session does not start MCP servers without a model turn); wire: ${wire}; provider requests: ${String(requests.length)}; ${describeRun(run)}`,
    );

    const { starts } = readFakeServerLog(serverLog);
    assert.ok(starts.length > 0, "the registered server must have been launched");
    for (const start of starts) {
      assert.deepEqual([...start.argv], ["mcp", "--host", "kimi-code"], "Kimi Code must launch the recipe's command and arguments");
      assert.equal(start.cwd, basename(rig.cwd), "the server must run in the project directory");
      const names = withoutShellNames(start.env).sort();
      t.diagnostic(`kimi-code server environment names: ${names.join(", ")}`);
      // The whole environment is forwarded (E-43-08): the assertion is only that the names the drive set reach the server.
      for (const required of ["HOME", "PATH", "KIMI_MODEL_NAME"]) {
        assert.ok(names.includes(required), `the server must be started with ${required}; saw [${names.join(", ")}]`);
      }
    }

    assert.ok(summary.hostMethods.includes("initialize") || summary.hostMethods.includes("server/discover"), `the host must send initialize or server/discover; wire: ${wire}`);
    assert.equal(summary.answered, true, `the host must list the tools through the recorder; wire: ${wire}`);
    assert.deepEqual([...summary.toolNames], [...REALM_TOOL_NAMES], `the listed tools must be the six Realm tools; wire: ${wire}`);

    const mismatched = requests.filter((request) => request.matchesKey === false).length;
    assert.equal(mismatched, 0, `no request to the provider may carry a key other than the fixed literal (${String(mismatched)} did)`);
    for (const request of requests) {
      assert.ok(isLoopbackPeer(request.peer), `the refusing provider must only see loopback peers; saw ${request.peer}`);
    }
    assert.equal(fileSha256(rig.path("kimi-code", "mcp.json")), configAfterInstall, "the session must not change the isolated mcp.json");
    assert.equal(fileSha256(REAL_KIMI_CODE_MCP), realBefore, "the operator's real ~/.kimi-code/mcp.json must be unchanged");
    await pollUntil(() => starts.every((start) => !processAlive(start.pid)), "the fake MCP server exited", { timeoutMs: 10_000, intervalMs: 100 });
  },
);

// ---- Production tier -------------------------------------------------------------------------------------------------------
// The host attaches cold (Phase 33) and a `kimi -p` run usually ends before the realm is ready: on exit the tier requires the wire
// handshake and tools/list with the six names, not readiness (test/integration/cold-attach-live.test.ts proves the ready transition).

void test(
  "kimi-code production: kimi -p against a refusing loopback provider launches realm mcp --host kimi-code on the production stack and lists the six tools",
  { skip: production.skip, ...testTimeout(1_800_000) },
  async (t) => {
    t.diagnostic(hostVersionNote("kimi-code", production));
    const provider = await startRefusingProvider({ expectedKey: KIMI_REHEARSAL_KEY });
    t.after(() => provider.close());
    await runHostProduction(t, {
      host: "kimi-code",
      bin: gateBin(production),
      cliPath: CLI_PATH,
      env: process.env,
      realFile: (home) => join(home, ".kimi-code", "mcp.json"),
      drive: { kind: "session", provider, args: kimiCodeSessionArgs(), env: kimiCodeDriveEnv(provider.baseUrl), credential: "fixed-key" },
    });
  },
);

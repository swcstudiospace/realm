// Codex against the real `codex` CLI (ADPT-08, ADPT-06, BOOTP-01). Three groups of tests: the validator tier, the validator-tier session
// proof, and the production tier.
//
// Validator tier (REALM_LIVE_CODEX=1, the codex executable, the built CLI; no Podman). The real recipe installs the owned TOML table
// (`[mcp_servers.realm]`, owned by its header, no marker comment) into an isolated CODEX_HOME and Codex's own commands parse it. `codex mcp get|list` print the registered command and do NOT start the
// server, so no stub invocation is expected and none is asserted to exist.
//   A  dry run names config.toml            B  install; status installed
//   C  `codex mcp get|list` print the registered command and args (E-X2)
//   D  `codex mcp add other` leaves the owned table byte-identical and status installed (OQ-24-05)
//   E  reversed order (second home): `codex mcp add realm` first makes install refuse with foreign-content and leaves the file alone
//   F  `codex mcp remove realm` after D: the table is gone, status says missing, and uninstall is a no-op that deletes the receipt
//
// The test never sets a gate variable, never edits Codex's file by hand to make a step pass, and never prints file contents. Observed
// 2026-11-17 with codex-cli 0.154.0: Codex rewrites config.toml with a comment-dropping editor, which is why no marker comment is used. The operator's real ~/.codex/config.toml is hashed before and after and must not change.
//
// Session tier (31-CONTEXT D-31-02, D-31-04). Codex starts its registered MCP servers at session start, before any model request, and needs
// no credential for that (E-31-4). `codex exec` is pointed at a loopback provider the test owns that answers every request with a 503 and
// records whether an Authorization header ever arrived; no `env_key`, `auth` or bearer field is configured. The registered `realm` is a
// wire recorder (test/support/host-live-session.ts) that logs JSON-RPC method names and, for the `tools/list` response, tool names only.
//   validator session (REALM_LIVE_CODEX=1, no Podman): the recorder fronts a fake MCP server, so the test proves what Codex itself does
//     with the recipe's table: it launches `realm mcp --host codex`, sends initialize, notifications/initialized and tools/list, forwards
//     exactly the whitelisted environment (HOME, LANG, PATH and, with the env_vars override, the three names of CODEX_FORWARDED_ENV),
//     runs the server in the project directory, writes no file through its `-c` overrides, and leaves no process behind. A second test
//     pins that without the override the server sees only HOME, LANG and PATH (E-31-5, GAP-31-01).
//   production (the validator gate plus the production prerequisites): the same session against `realm mcp --host codex` on the production
//     stack, ended once the daemon shows an attached boot report and the recorder shows the six tools. See runHostProduction.
// What the session drive proves: the host's own client started the registered server and listed its tools. What it does not: no model
// turn, no tool call and no credential ever happens (GAP-31-02). The test never sets a gate variable and never prints an environment
// value or a file body.

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
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
  ownedTableOf,
  processAlive,
  refusalReasonOf,
  requireReturned,
  runHostProduction,
  stripAnsi,
  type HostRig,
  type HostRunResult,
} from "../support/host-live.js";
import {
  codexSessionArgs,
  readFakeServerLog,
  readWireLog,
  REALM_TOOL_NAMES,
  runHostUntil,
  startRefusingProvider,
  isLoopbackPeer,
  type HostUntilResult,
  type ProviderRequestRecord,
  wireSummary,
  type WireSummary,
  withoutShellNames,
  writeFakeMcpServer,
  writeWireRecorder,
  type FakeServerStart,
} from "../support/host-live-session.js";
import { pollUntil, scaledMs, testTimeout } from "../support/timing.js";

const CLI_PATH = fileURLToPath(new URL("../../src/cli/main.js", import.meta.url));
const REAL_CODEX_CONFIG = join(homedir(), ".codex", "config.toml");

const validator = await collectHostLiveGate("codex", "validator", { env: process.env, platform: process.platform, cliPath: CLI_PATH });
const production = await collectHostLiveGate("codex", "production", { env: process.env, platform: process.platform, cliPath: CLI_PATH });

function rigFor(t: TestContext): HostRig {
  const rig = createHostRig({ host: "codex", bin: gateBin(validator), overrides: { CODEX_HOME: "codex" } }, process.env);
  t.after(() => {
    rig.dispose();
  });
  return rig;
}

async function succeeded(run: Promise<HostRunResult>, label: string): Promise<HostRunResult> {
  const result = await run;
  requireReturned(result, label);
  assert.equal(result.exitCode, 0, `${label}: ${describeRun(result)}`);
  return result;
}

void test(
  "codex validator: `codex mcp get|list` parse the recipe's table, and the host's own add and remove leave install, status and uninstall consistent",
  { skip: validator.skip, ...testTimeout(900_000) },
  async (t) => {
    t.diagnostic(hostVersionNote("codex", validator));
    const realBefore = fileSha256(REAL_CODEX_CONFIG);
    const rig = rigFor(t);
    const file = rig.path("codex", "config.toml");

    // A: a dry run names config.toml and writes nothing.
    const planned = cliJson(await rig.realm(["install", "codex", "--dry-run"]), "realm host install codex --dry-run");
    assert.equal(planned["status"], "planned");
    assert.equal(planned["dryRun"], true);
    assert.deepEqual(actionsOf(planned, "dry run"), [{ path: "config.toml", action: "create" }]);
    assert.equal(existsSync(file), false, "a dry run writes nothing");

    // B: install writes the table.
    const installed = cliJson(await rig.realm(["install", "codex"]), "realm host install codex");
    assert.equal(installed["status"], "installed");
    assert.equal((await hostStatusOf(rig, "codex"))["status"], "installed");
    const installedText = readFileSync(file, "utf8");
    const ownedTable = ownedTableOf(installedText);
    assert.ok(ownedTable !== undefined, "the install wrote the owned table");
    assert.equal(installedText.includes("host-plugin"), false, "and no marker comment");

    // C: Codex's own commands print the registered command. They do not start the server (E-X2).
    const got = await succeeded(rig.host(["mcp", "get", "realm"]), "codex mcp get realm");
    const gotText = stripAnsi(got.stdout);
    for (const expected of ["transport: stdio", "command: realm", "args: mcp --host codex"]) {
      assert.ok(gotText.includes(expected), `codex mcp get realm must print ${JSON.stringify(expected)}: ${describeRun(got)}`);
    }
    const listed = await succeeded(rig.host(["mcp", "list"]), "codex mcp list");
    const row = stripAnsi(listed.stdout)
      .split("\n")
      .find((line) => /^\s*realm\s+realm\s+mcp --host codex\b/.test(line));
    assert.ok(row !== undefined, `codex mcp list must have a realm row with the command and args: ${describeRun(listed)}`);
    assert.ok(/\benabled\b/.test(row), `the realm row must be enabled: ${JSON.stringify(row)}`);
    assert.deepEqual(rig.stubInvocations(), [], "codex mcp get and list do not start the server: the stub realm was never launched");

    // D: a Codex-written entry beside the owned table leaves the table byte-identical and the status ok (OQ-24-05 for this version).
    await succeeded(rig.host(["mcp", "add", "other", "--", "other-cmd"]), "codex mcp add other");
    const afterAdd = readFileSync(file, "utf8");
    assert.ok(afterAdd.includes("[mcp_servers.other]"), "Codex wrote its own entry");
    assert.equal(ownedTableOf(afterAdd), ownedTable, "codex mcp add other must leave the owned table byte-identical");
    const afterAddStatus = await hostStatusOf(rig, "codex");
    assert.equal(afterAddStatus["status"], "installed", "the owned table is still intact");
    assert.deepEqual(afterAddStatus["entries"], [{ path: "config.toml", state: "ok" }]);
    t.diagnostic(
      `codex mcp add other: the other table follows the owned one: ${String(afterAdd.indexOf("[mcp_servers.other]") > afterAdd.indexOf("[mcp_servers.realm]"))}; ` +
        `the file keeps ${String(afterAdd.split("\n").filter((line) => line.startsWith("#")).length)} comment line(s)`,
    );

    // F: Codex's own remover takes the table out. The entry is missing, and uninstall has nothing left to remove.
    const remove = await rig.host(["mcp", "remove", "realm"]);
    requireReturned(remove, "codex mcp remove realm");
    assert.equal(remove.exitCode, 0, describeRun(remove));
    const afterRemove = readFileSync(file, "utf8");
    assert.equal(ownedTableOf(afterRemove), undefined, "codex mcp remove realm removed the owned table");
    assert.equal(afterRemove.includes("[mcp_servers.realm]"), false);
    assert.ok(afterRemove.includes("[mcp_servers.other]"), "and left the other entry");
    const afterRemoveStatus = await hostStatusOf(rig, "codex");
    assert.equal(afterRemoveStatus["status"], "drifted");
    assert.deepEqual(afterRemoveStatus["entries"], [{ path: "config.toml", state: "missing" }]);
    const uninstall = await rig.realm(["uninstall", "codex"]);
    assert.equal(uninstall.exitCode, 0, `uninstall after Codex removed the table must be a no-op: ${describeRun(uninstall)}`);
    assert.equal(cliJson(uninstall, "realm host uninstall codex")["status"], "noop");
    assert.equal(readFileSync(file, "utf8"), afterRemove, "the no-op uninstall leaves the file as Codex left it");
    assert.equal(existsSync(rig.receiptFile("codex")), false, "and deletes the stale receipt");
    t.diagnostic(`codex mcp remove realm (exit ${String(remove.exitCode)}) removed the table; realm host uninstall codex: exit ${String(uninstall.exitCode)}, no refusal`);

    assert.equal(fileSha256(REAL_CODEX_CONFIG), realBefore, "the operator's real ~/.codex/config.toml must be unchanged");
  },
);

void test(
  "codex validator: an entry written by `codex mcp add realm` first makes install refuse with foreign-content and leaves the file alone",
  { skip: validator.skip, ...testTimeout(600_000) },
  async (t) => {
    const realBefore = fileSha256(REAL_CODEX_CONFIG);
    const rig = rigFor(t);
    const file = rig.path("codex", "config.toml");

    // E: the reverse order, in a second isolated home (the guard, live).
    await succeeded(rig.host(["mcp", "add", "realm", "--", "realm", "mcp", "--host", "codex"]), "codex mcp add realm");
    const before = readFileSync(file);
    const refused = await rig.realm(["install", "codex"]);
    assert.equal(refused.exitCode, 1, `the install must refuse: ${refused.stdout}${refused.stderr}`);
    assert.equal(refusalReasonOf(refused), "foreign-content", refused.stderr);
    assert.ok(readFileSync(file).equals(before), "a refused install leaves the file byte-identical");
    assert.equal(existsSync(rig.receiptFile("codex")), false, "and writes no receipt");
    assert.equal(fileSha256(REAL_CODEX_CONFIG), realBefore, "the operator's real ~/.codex/config.toml must be unchanged");
  },
);

// ---- Session tier ----------------------------------------------------------------------------------------------------------

// A throwaway value the test plants in Codex's own environment. It must never reach the registered server.
const SECRET_NAME = "REALM_REHEARSAL_SECRET";

interface CodexSessionFacts {
  readonly rig: HostRig;
  readonly run: HostUntilResult;
  readonly summary: WireSummary;
  // The start lines the fake MCP server logged: one per launch.
  readonly starts: readonly FakeServerStart[];
  readonly requests: readonly ProviderRequestRecord[];
  readonly configAfterInstall: string | null;
  readonly configAfterSession: string | null;
}

function wireText(summary: WireSummary): string {
  return `host methods [${summary.hostMethods.join(", ")}], tools [${summary.toolNames.join(", ")}]`;
}

// One validator-tier session: the real recipe installs into the rig's isolated CODEX_HOME, then `codex exec` runs against a refusing
// loopback provider. The registered `realm` is the wire recorder, in front of a fake MCP server, so the test sees what Codex sent and
// what the server was started with. The run ends as soon as the tools/list response is logged (Codex may also exit on its own within seconds).
async function driveCodexSession(t: TestContext, forwardEnv: boolean): Promise<CodexSessionFacts> {
  const rig = rigFor(t);
  const wireDir = rig.path("wire");
  const serverLog = rig.path("server.log");
  const wireLog = rig.path("wire.log");
  const server = writeFakeMcpServer(wireDir, serverLog);
  writeWireRecorder(wireDir, { nodePath: process.execPath, target: [process.execPath, server], logFile: wireLog });

  const installed = cliJson(await rig.realm(["install", "codex"]), "realm host install codex");
  assert.equal(installed["status"], "installed", "the recipe installs into the isolated CODEX_HOME");
  const status = await hostStatusOf(rig, "codex");
  assert.equal(status["status"], "installed");
  assert.equal(status["launch"], "on-path", "the bare realm command must resolve on the rig's PATH");
  const configAfterInstall = fileSha256(rig.path("codex", "config.toml"));

  const provider = await startRefusingProvider();
  t.after(() => provider.close());

  // Codex's own environment: the rig's allowlist without TERM and TMPDIR (Codex's default list may forward them, and the proof
  // compares the forwarded set with the three default names), the recorder directory first on PATH in place of the rig's stub realm, the
  // three names the env_vars override forwards (dummy paths) and one planted secret.
  const env: Record<string, string> = Object.fromEntries(Object.entries(rig.env).filter(([name]) => name !== "TERM" && name !== "TMPDIR"));
  const stubDir = rig.path("stub");
  env["PATH"] = [wireDir, ...(env["PATH"] ?? "").split(delimiter).filter((entry) => entry !== stubDir)].join(delimiter);
  env["XDG_RUNTIME_DIR"] = rig.path("forward-runtime");
  env["XDG_CONFIG_HOME"] = rig.path("forward-config");
  env["REALM_DRIVER_SOCKET"] = rig.path("forward-driver.sock");
  env[SECRET_NAME] = "throwaway-rehearsal-value";

  const run = await runHostUntil(rig.bin, codexSessionArgs({ baseUrl: provider.baseUrl, forwardEnv }), env, rig.cwd, {
    ready: () => Promise.resolve(wireSummary(readWireLog(wireLog)).answered),
    timeoutMs: scaledMs(60_000),
    pollMs: 200,
  });
  const summary = wireSummary(readWireLog(wireLog));
  const requests = provider.requests();
  t.diagnostic(`codex session ended by ${run.endedBy}; wire: ${wireText(summary)}; the refusing provider saw ${String(requests.length)} request(s)`);
  assert.equal(
    run.endedBy,
    "ready",
    `codex did not send tools/list to the registered server (ended by ${run.endedBy}); wire: ${wireText(summary)}; provider requests: ${String(requests.length)}; ${describeRun(run)}`,
  );
  return {
    rig,
    run,
    summary,
    starts: readFakeServerLog(serverLog).starts,
    requests,
    configAfterInstall,
    configAfterSession: fileSha256(rig.path("codex", "config.toml")),
  };
}

// What every session test asserts, with the environment names the server must have been started with.
async function assertSession(t: TestContext, facts: CodexSessionFacts, expectedEnvNames: readonly string[]): Promise<void> {
  const { summary, starts, requests } = facts;
  const at = (method: string): number => summary.hostMethods.indexOf(method);
  assert.ok(
    at("initialize") >= 0 && at("initialize") < at("notifications/initialized") && at("notifications/initialized") < at("tools/list"),
    `the host must send initialize, notifications/initialized and tools/list in that order; wire: ${wireText(summary)}`,
  );
  assert.deepEqual([...summary.toolNames], [...REALM_TOOL_NAMES], `the listed tools must be the six Realm tools; wire: ${wireText(summary)}`);

  assert.ok(starts.length > 0, "the registered server must have been launched");
  const sorted = [...expectedEnvNames].sort();
  for (const start of starts) {
    assert.deepEqual([...start.argv], ["mcp", "--host", "codex"], "Codex must launch the recipe's command and arguments");
    const names = withoutShellNames(start.env).sort();
    t.diagnostic(`codex server environment names: ${names.join(", ")}`);
    assert.equal(names.includes(SECRET_NAME), false, "the planted secret must never reach the server");
    assert.deepEqual(names, sorted, "Codex must forward exactly the whitelisted environment names");
    assert.equal(start.cwd, basename(facts.rig.cwd), "the server must run in the project directory");
  }

  assert.equal(requests.filter((request) => request.authorization).length, 0, "the refusing provider must never see an Authorization header");
  for (const request of requests) {
    assert.ok(isLoopbackPeer(request.peer), `the refusing provider must only see loopback peers; saw ${request.peer}`);
  }
  assert.equal(facts.configAfterSession, facts.configAfterInstall, "the -c overrides must write nothing: config.toml is byte-identical after the session");
  await pollUntil(() => starts.every((start) => !processAlive(start.pid)), "the fake MCP server exited", { timeoutMs: 10_000, intervalMs: 100 });
}

void test(
  "codex validator session: codex exec against a refusing loopback provider launches the registered server, which sees initialize and tools/list, with only the whitelisted environment",
  { skip: validator.skip, ...testTimeout(600_000) },
  async (t) => {
    t.diagnostic(hostVersionNote("codex", validator));
    const realBefore = fileSha256(REAL_CODEX_CONFIG);
    const facts = await driveCodexSession(t, true);
    await assertSession(t, facts, ["HOME", "LANG", "PATH", "REALM_DRIVER_SOCKET", "XDG_CONFIG_HOME", "XDG_RUNTIME_DIR"]);
    assert.equal(fileSha256(REAL_CODEX_CONFIG), realBefore, "the operator's real ~/.codex/config.toml must be unchanged");
  },
);

void test(
  "codex validator session: without the env_vars override the server sees only HOME, LANG and PATH",
  { skip: validator.skip, ...testTimeout(600_000) },
  async (t) => {
    t.diagnostic(hostVersionNote("codex", validator));
    const realBefore = fileSha256(REAL_CODEX_CONFIG);
    // The three forwarded names and the planted secret are in Codex's own environment; only the defaults reach the server. A newer Codex
    // that forwards more fails here: that is the signal to revisit GAP-31-01 and OQ-31-03.
    const facts = await driveCodexSession(t, false);
    await assertSession(t, facts, ["HOME", "LANG", "PATH"]);
    assert.equal(fileSha256(REAL_CODEX_CONFIG), realBefore, "the operator's real ~/.codex/config.toml must be unchanged");
  },
);

// ---- Production tier -------------------------------------------------------------------------------------------------------

void test(
  "codex production: codex exec against a refusing loopback provider launches realm mcp --host codex on the production stack and lists the six tools",
  { skip: production.skip, ...testTimeout(1_800_000) },
  async (t) => {
    t.diagnostic(hostVersionNote("codex", production));
    const provider = await startRefusingProvider();
    t.after(() => provider.close());
    await runHostProduction(t, {
      host: "codex",
      bin: gateBin(production),
      cliPath: CLI_PATH,
      env: process.env,
      realFile: (home) => join(home, ".codex", "config.toml"),
      drive: { kind: "session", provider, args: codexSessionArgs({ baseUrl: provider.baseUrl }) },
    });
  },
);

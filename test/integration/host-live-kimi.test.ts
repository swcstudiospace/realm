// Kimi CLI (the legacy Python `kimi-cli` 1.x) against the real `kimi` CLI (ADPT-08, ADPT-07, BOOTP-01, KIMI-01). Three groups of tests: the
// validator tier, a validator-tier session step against a fake MCP server, and the production tier. The command name `kimi` is shared with
// Kimi Code (2.x, test/integration/host-live-kimi-code.test.ts): the gate skips this file when the installed kimi is 2.x or newer.
//
// Validator tier (REALM_LIVE_KIMI=1, a kimi executable that is the legacy CLI and NOT the archived Python stub, the built CLI; no Podman).
// The real recipe installs mcp.json into an isolated KIMI_SHARE_DIR and Kimi's own commands parse and launch it. The only kimi commands that
// run are `kimi mcp list`, `kimi mcp test realm` and `kimi mcp remove realm`: `kimi mcp add` is never run (not needed, and it is the command
// that did not return within 60 s in the 2026-11-17 observation, cause unknown). A command that does not return fails the test with the
// sentence `did not return` instead of hanging. Every host command runs with the containment environment (update and telemetry switches
// off, a dead proxy; 43-CONTEXT D-43-07).
//   A  dry run names mcp.json          B  install; status installed
//   C  `kimi mcp list` prints realm; `kimi mcp test realm` launches the stub realm: `mcp --host kimi`
//   D  `kimi mcp remove realm` leaves status drifted; uninstall is a clean no-op
//
// Validator session (REALM_LIVE_KIMI=1, no Podman): the wire recorder fronts a fake MCP server and `kimi mcp test realm` connects to it. The
// test proves the handshake, the tool listing and the argv, and reports (does not assert) which of XDG_RUNTIME_DIR, XDG_CONFIG_HOME and
// REALM_DRIVER_SOCKET the legacy CLI forwards to the server (43-CONTEXT E-43-09, D-43-06).
//
// Production tier (the validator gate plus the production prerequisites): the command drive runs `kimi mcp test realm` against
// `realm mcp --host kimi` on the production stack through the wire recorder, which gives back the three variables the legacy CLI does not
// forward and logs their names. See runHostProduction.
//
// The test never sets a gate variable. No prompt is sent and no credential is forwarded. The operator's real ~/.kimi/mcp.json is hashed
// before and after and must not change.
//
// Phase 47 switches (all optional; with none set the production test is the Phase 43 one): REALM_LIVE_KIMI_RESTORE (none, or a comma
// list of the names the recorder restores, default all three), REALM_LIVE_KIMI_WARM (1: bring the session up before the host command)
// and REALM_LIVE_EVIDENCE_DIR (an existing directory of mode 0700 outside the checkout: each run keeps its wire log, full command output,
// server stderr and reach record there, before any assertion). A restore set other than all three, and the warm control, label the run
// `diagnostic variant`. Two more validator tests, the expansion probe and the writer probe, need REALM_LIVE_KIMI_PROBES=1 as well.

import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
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
  processAlive,
  requireReturned,
  runHost,
  runHostProduction,
  stripAnsi,
  VALIDATOR_TIMEOUT_MS,
  type HostRig,
  type HostRunResult,
} from "../support/host-live.js";
import { checkEvidenceDir, EVIDENCE_REFUSAL_TEXT, type RunEvidenceSettings, writeRunEvidence } from "../support/host-live-evidence.js";
import {
  classifyExpansion,
  describeMcpJsonShape,
  digest12,
  EVIDENCE_DIR_VARIABLE,
  KIMI_PROBES_VARIABLE,
  KIMI_RESTORED_ENV,
  kimiContainmentEnv,
  kimiEvidenceSettings,
  kimiProductionDrive,
  kimiProductionPlan,
} from "../support/host-live-kimi.js";
import { readFakeServerLog, readWireLog, REALM_TOOL_NAMES, wireSummary, withoutShellNames, writeFakeMcpServer, writeWireRecorder } from "../support/host-live-session.js";
import { isRecord } from "../support/omp-live.js";
import { pollUntil, scaledMs, testTimeout } from "../support/timing.js";

const CLI_PATH = fileURLToPath(new URL("../../src/cli/main.js", import.meta.url));
// The checkout root: this file runs from dist/test/integration, three directories below it.
const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const REAL_KIMI_MCP = join(homedir(), ".kimi", "mcp.json");

const validator = await collectHostLiveGate("kimi", "validator", { env: process.env, platform: process.platform, cliPath: CLI_PATH });
const production = await collectHostLiveGate("kimi", "production", { env: process.env, platform: process.platform, cliPath: CLI_PATH });

// The three optional switches of the production test (phase 47): REALM_LIVE_KIMI_RESTORE, REALM_LIVE_KIMI_WARM and REALM_LIVE_EVIDENCE_DIR.
// With none set the plan is the Phase 43 one. This file never sets a gate variable.
const plan = kimiProductionPlan(process.env);

// The settings of this run's evidence, or undefined when REALM_LIVE_EVIDENCE_DIR is not set. A refused directory fails the test, with a
// sentence that names the reason and not the path.
function evidenceSettings(build: (dir: string) => RunEvidenceSettings): RunEvidenceSettings | undefined {
  if (plan.evidenceDir === undefined) {
    return undefined;
  }
  const checked = checkEvidenceDir(plan.evidenceDir, REPO_ROOT);
  if (!checked.ok) {
    throw new Error(`${EVIDENCE_DIR_VARIABLE}: ${EVIDENCE_REFUSAL_TEXT[checked.reason]}`);
  }
  return build(checked.dir);
}

function rigFor(t: TestContext): HostRig {
  const rig = createHostRig({ host: "kimi", bin: gateBin(validator), overrides: { KIMI_SHARE_DIR: "kimi" } }, process.env);
  t.after(() => {
    rig.dispose();
  });
  return rig;
}

// A host command in the rig's isolated environment plus the containment environment (the rig's own host method takes no environment).
function runContained(rig: HostRig, args: readonly string[], env: Readonly<Record<string, string>> = rig.env): Promise<HostRunResult> {
  return runHost(rig.bin, args, { ...env, ...kimiContainmentEnv() }, rig.cwd, scaledMs(VALIDATOR_TIMEOUT_MS));
}

void test(
  "kimi validator: `kimi mcp list|test` parse and launch the recipe's mcp.json, and the host's own remover leaves status drifted",
  { skip: validator.skip, ...testTimeout(900_000) },
  async (t) => {
    t.diagnostic(hostVersionNote("kimi", validator));
    const realBefore = fileSha256(REAL_KIMI_MCP);
    const rig = rigFor(t);
    const file = rig.path("kimi", "mcp.json");

    // A: a dry run names mcp.json and writes nothing.
    const planned = cliJson(await rig.realm(["install", "kimi", "--dry-run"]), "realm host install kimi --dry-run");
    assert.equal(planned["status"], "planned");
    assert.equal(planned["dryRun"], true);
    assert.deepEqual(actionsOf(planned, "dry run"), [{ path: "mcp.json", action: "create" }]);
    assert.equal(existsSync(file), false, "a dry run writes nothing");

    // B: install writes it; status installed.
    const installed = cliJson(await rig.realm(["install", "kimi"]), "realm host install kimi");
    assert.equal(installed["status"], "installed");
    assert.equal(existsSync(file), true, "the install writes <KIMI_SHARE_DIR>/mcp.json");
    assert.equal((await hostStatusOf(rig, "kimi"))["status"], "installed");

    // C: the host lists realm, and `kimi mcp test realm` launches the registered argv. The test's own exit status is not asserted: the stub
    // realm exits at once, so the host reports a failed connection. That it LAUNCHED the argv is the evidence.
    const listed = await runContained(rig, ["mcp", "list"]);
    requireReturned(listed, "kimi mcp list");
    assert.equal(listed.exitCode, 0, `kimi mcp list: ${describeRun(listed)}`);
    assert.ok(/(^|[^\w-])realm([^\w-]|$)/m.test(stripAnsi(listed.stdout)), `kimi mcp list must list realm: ${describeRun(listed)}`);
    const tested = await runContained(rig, ["mcp", "test", "realm"]);
    requireReturned(tested, "kimi mcp test realm");
    const calls = rig.stubInvocations();
    assert.ok(calls.length >= 1, `kimi mcp test realm must launch the registered command; the stub recorded no invocation (${describeRun(tested)})`);
    for (const call of calls) {
      assert.deepEqual(call, ["mcp", "--host", "kimi"], "the host launched exactly realm mcp --host kimi");
    }

    // D: the host's own remover. Status drifts; uninstall is a clean no-op.
    const removal = await runContained(rig, ["mcp", "remove", "realm"]);
    requireReturned(removal, "kimi mcp remove realm");
    assert.equal(removal.exitCode, 0, `kimi mcp remove realm: ${describeRun(removal)}`);
    const afterRemove = await hostStatusOf(rig, "kimi");
    assert.equal(afterRemove["status"], "drifted", `a removal by the host must read as drifted: ${JSON.stringify(afterRemove)}`);
    const removed = cliJson(await rig.realm(["uninstall", "kimi"]), "realm host uninstall kimi after the host's own removal");
    assert.deepEqual(
      actionsOf(removed, "uninstall").filter((action) => action.action !== "noop"),
      [],
      `the uninstall must change nothing: ${JSON.stringify(removed)}`,
    );
    assert.equal(existsSync(rig.receiptFile("kimi")), false, "the uninstall deletes the receipt");

    assert.equal(fileSha256(REAL_KIMI_MCP), realBefore, "the operator's real ~/.kimi/mcp.json must be unchanged");
  },
);

// The three names the production drive restores. The legacy CLI forwards HOME and PATH only (43-CONTEXT E-43-09); the session step reports
// which of these it forwards instead of asserting an answer.
const MARKER_NAMES = KIMI_RESTORED_ENV;

void test(
  "kimi validator session: `kimi mcp test realm` launches the registered server, which sees the handshake and tools/list, and the forwarded environment is reported",
  { skip: validator.skip, ...testTimeout(600_000) },
  async (t) => {
    t.diagnostic(hostVersionNote("kimi", validator));
    const realBefore = fileSha256(REAL_KIMI_MCP);
    const rig = rigFor(t);
    const c1Evidence = evidenceSettings((dir) => ({ dir, label: "control C1: the client alone against the fake server", folderLabel: "c1", diagnostic: false, control: "C1" }));
    const wireDir = rig.path("wire");
    const serverLog = rig.path("server.log");
    const wireLog = rig.path("wire.log");
    const server = writeFakeMcpServer(wireDir, serverLog);
    writeWireRecorder(wireDir, { nodePath: process.execPath, target: [process.execPath, server], logFile: wireLog });

    const installed = cliJson(await rig.realm(["install", "kimi"]), "realm host install kimi");
    assert.equal(installed["status"], "installed", "the recipe installs into the isolated KIMI_SHARE_DIR");
    const status = await hostStatusOf(rig, "kimi");
    assert.equal(status["status"], "installed");
    assert.equal(status["launch"], "on-path", "the bare realm command must resolve on the rig's PATH");

    // The recorder directory goes first on PATH in place of the rig's stub realm; the marker variables carry dummy paths inside the rig.
    const stubDir = rig.path("stub");
    const env: Record<string, string> = { ...rig.env };
    env["PATH"] = [wireDir, ...(env["PATH"] ?? "").split(delimiter).filter((entry) => entry !== stubDir)].join(delimiter);
    env["XDG_RUNTIME_DIR"] = rig.path("forward-runtime");
    env["XDG_CONFIG_HOME"] = rig.path("forward-config");
    env["REALM_DRIVER_SOCKET"] = rig.path("forward-driver.sock");

    const startedAt = Date.now();
    const tested = await runContained(rig, ["mcp", "test", "realm"], env);
    const testedMs = Date.now() - startedAt;
    if (c1Evidence !== undefined) {
      // Kept before any assertion of the run (the timeline of the client alone is the control C1 of the window).
      try {
        const written = writeRunEvidence({
          settings: c1Evidence,
          restore: [],
          warm: false,
          cold: false,
          elapsedMs: testedMs,
          returned: !tested.timedOut,
          ...(tested.exitCode === undefined ? {} : { exitCode: tested.exitCode }),
          wireLog,
          stdout: tested.stdout,
          stderr: tested.stderr,
        });
        t.diagnostic(`control C1 evidence kept${written.failures.length > 0 ? `; members not written [${written.failures.join(", ")}]` : ""}`);
      } catch {
        t.diagnostic("control C1 evidence could not be kept");
      }
    }
    requireReturned(tested, "kimi mcp test realm");
    assert.equal(tested.exitCode, 0, `kimi mcp test realm must succeed against the fake server: ${describeRun(tested)}`);
    t.diagnostic(`kimi mcp test realm returned after ${String(testedMs)} ms`);
    const firstLine =
      stripAnsi(`${tested.stdout}\n${tested.stderr}`)
        .split("\n")
        .map((line) => line.trim())
        .find((line) => line !== "") ?? "";
    t.diagnostic(`kimi mcp test realm printed: ${JSON.stringify(firstLine.slice(0, 200))}`);

    const summary = wireSummary(readWireLog(wireLog));
    const wire = `host methods [${summary.hostMethods.join(", ")}], tools [${summary.toolNames.join(", ")}]`;
    assert.ok(summary.hostMethods.includes("initialize") || summary.hostMethods.includes("server/discover"), `the host must send initialize or server/discover; wire: ${wire}`);
    assert.equal(summary.answered, true, `the host must list the tools through the recorder; wire: ${wire}`);
    assert.deepEqual([...summary.toolNames], [...REALM_TOOL_NAMES], `the listed tools must be the six Realm tools; wire: ${wire}`);

    const { starts } = readFakeServerLog(serverLog);
    assert.ok(starts.length >= 1, "the registered server must have been launched");
    for (const start of starts) {
      assert.deepEqual([...start.argv], ["mcp", "--host", "kimi"], "kimi must launch the recipe's command and arguments");
      const names = withoutShellNames(start.env);
      for (const required of ["HOME", "PATH"]) {
        assert.ok(names.includes(required), `the server must be started with ${required}; saw [${names.join(", ")}]`);
      }
      // The observation of 2026-11-18 on 1.51.0: none of the three marker names is forwarded (E-43-09). A different observation is reported.
      for (const marker of MARKER_NAMES) {
        t.diagnostic(`kimi forwarded ${marker} to the server: ${names.includes(marker) ? "forwarded" : "not forwarded"}`);
      }
    }

    await pollUntil(() => starts.every((start) => !processAlive(start.pid)), "the fake MCP server exited", { timeoutMs: 10_000, intervalMs: 100 });
    assert.equal(fileSha256(REAL_KIMI_MCP), realBefore, "the operator's real ~/.kimi/mcp.json must be unchanged");
  },
);

// ---- Production tier -------------------------------------------------------------------------------------------------------
// The command drive: `kimi mcp test realm` connects to `realm mcp --host kimi` through the wire recorder, lists the tools and returns. The
// recorder gives back the three variables the legacy CLI does not forward and logs their names (test/support/host-live.ts).

void test(
  `kimi production: kimi mcp test realm launches realm mcp --host kimi on the production stack and lists the six tools${plan.diagnostic ? ` [${plan.label}]` : ""}`,
  { skip: production.skip, ...testTimeout(1_800_000) },
  async (t) => {
    t.diagnostic(hostVersionNote("kimi", production));
    if (plan.diagnostic) {
      t.diagnostic(plan.label);
    }
    const evidence = evidenceSettings((dir) => kimiEvidenceSettings(plan, dir));
    await runHostProduction(t, {
      host: "kimi",
      bin: gateBin(production),
      cliPath: CLI_PATH,
      env: process.env,
      realFile: (home) => join(home, ".kimi", "mcp.json"),
      drive: kimiProductionDrive(plan, evidence),
    });
  },
);

// ---- The two validator probes (phase 47; REALM_LIVE_KIMI plus REALM_LIVE_KIMI_PROBES; no Podman) ---------------------------------------
// They run the legacy CLI in the rig's isolated home under the containment environment, never touch the operator's real mcp.json (its hash
// is checked before and after) and assert only what is certain; what the client does with an env block, and what its own writer produces,
// is reported as diagnostics.

const probes: string | false = validator.skip === false ? (process.env[KIMI_PROBES_VARIABLE] === "1" ? false : `${KIMI_PROBES_VARIABLE} is not 1: the expansion and writer probes run only with it`) : validator.skip;

// The text of the recipe's mcp.json with an `env` object on the realm entry.
function withEnvBlock(recipeText: string, env: Readonly<Record<string, string>>): string {
  const document: unknown = JSON.parse(recipeText);
  assert.ok(isRecord(document), "the recipe's mcp.json must be a JSON object");
  const servers = document["mcpServers"];
  assert.ok(isRecord(servers), "the recipe's mcp.json must hold mcpServers");
  const entry = servers["realm"];
  assert.ok(isRecord(entry), "the recipe's mcp.json must hold the realm entry");
  entry["env"] = env;
  return `${JSON.stringify(document, null, 2)}\n`;
}

const EXPANSION_LITERAL = "expansion-probe-literal-text";

void test(
  "kimi expansion probe: an env block of references (brace and bare spelling) and of a plain literal, and which of them the server receives",
  { skip: probes, ...testTimeout(600_000) },
  async (t) => {
    t.diagnostic(hostVersionNote("kimi", validator));
    const realBefore = fileSha256(REAL_KIMI_MCP);
    const rig = rigFor(t);
    const wireDir = rig.path("wire");
    const serverLog = rig.path("server.log");
    const server = writeFakeMcpServer(wireDir, serverLog, { hashNames: KIMI_RESTORED_ENV });
    writeWireRecorder(wireDir, { nodePath: process.execPath, target: [process.execPath, server], logFile: rig.path("wire.log") });
    const installed = cliJson(await rig.realm(["install", "kimi"]), "realm host install kimi");
    assert.equal(installed["status"], "installed", "the recipe installs into the isolated KIMI_SHARE_DIR");
    const file = rig.path("kimi", "mcp.json");
    const recipeText = readFileSync(file, "utf8");

    // The host's own values: the names the references point at, with dummy paths inside the rig. Only a 12 character digest of what the
    // server receives is ever logged.
    const hostValues: Record<string, string> = {
      XDG_RUNTIME_DIR: rig.path("probe-runtime"),
      XDG_CONFIG_HOME: rig.path("probe-config"),
      REALM_DRIVER_SOCKET: rig.path("probe-driver.sock"),
    };
    const stubDir = rig.path("stub");
    const env: Record<string, string> = { ...rig.env, ...hostValues };
    env["PATH"] = [wireDir, ...(env["PATH"] ?? "").split(delimiter).filter((entry) => entry !== stubDir)].join(delimiter);

    const spellings = {
      brace: (name: string): string => `\${${name}}`,
      bare: (name: string): string => `$${name}`,
      literal: (): string => EXPANSION_LITERAL,
    };
    for (const [spelling, textOf] of Object.entries(spellings)) {
      writeFileSync(file, withEnvBlock(recipeText, Object.fromEntries(KIMI_RESTORED_ENV.map((name) => [name, textOf(name)]))));
      writeFileSync(serverLog, "");
      const tested = await runContained(rig, ["mcp", "test", "realm"], env);
      requireReturned(tested, `kimi mcp test realm (${spelling} spelling)`);
      const { starts } = readFakeServerLog(serverLog);
      assert.ok(starts.length >= 1, `the registered server must have been launched (${spelling} spelling)`);
      for (const start of starts) {
        assert.deepEqual([...start.argv], ["mcp", "--host", "kimi"], "kimi must launch the recipe's command and arguments");
      }
      const received = starts[0]?.hashes ?? {};
      for (const name of KIMI_RESTORED_ENV) {
        const candidates = { brace: digest12(`\${${name}}`), bare: digest12(`$${name}`), host: digest12(hostValues[name] ?? "") };
        const literal = spelling === "literal" ? `; the literal text arrived unchanged: ${String(received[name] === digest12(EXPANSION_LITERAL))}` : "";
        t.diagnostic(`expansion probe, ${spelling} spelling, ${name}: ${classifyExpansion(received[name], candidates)}${literal}`);
      }
    }
    assert.equal(fileSha256(REAL_KIMI_MCP), realBefore, "the operator's real ~/.kimi/mcp.json must be unchanged");
  },
);

void test(
  "kimi writer probe: the host's own `kimi mcp add --transport stdio --env` writes an mcp.json, compared structurally with the recipe's",
  { skip: probes, ...testTimeout(300_000) },
  async (t) => {
    t.diagnostic(hostVersionNote("kimi", validator));
    const realBefore = fileSha256(REAL_KIMI_MCP);
    const recipeRig = rigFor(t);
    assert.equal(cliJson(await recipeRig.realm(["install", "kimi"]), "realm host install kimi")["status"], "installed");
    const recipeShape = describeMcpJsonShape(readFileSync(recipeRig.path("kimi", "mcp.json"), "utf8"));

    // The 2026-11-17 observation: `kimi mcp add --transport stdio ...` did not return within 60 s in an isolated home and wrote nothing, cause
    // unknown. The run is bounded and either outcome is a result.
    const rig = rigFor(t);
    const added = await runHost(
      rig.bin,
      ["mcp", "add", "--transport", "stdio", "--env", `XDG_RUNTIME_DIR=${rig.path("probe-runtime")}`, "realm", "--", "realm", "mcp", "--host", "kimi"],
      { ...rig.env, ...kimiContainmentEnv() },
      rig.cwd,
      scaledMs(60_000),
    );
    t.diagnostic(added.timedOut ? "kimi mcp add did not return within the 60 s bound" : `kimi mcp add returned with exit code ${String(added.exitCode)}`);
    const written = rig.path("kimi", "mcp.json");
    if (existsSync(written)) {
      const shape = describeMcpJsonShape(readFileSync(written, "utf8"));
      t.diagnostic(`the host's own mcp.json shape (names, order and indent only): ${JSON.stringify(shape)}`);
      t.diagnostic(`the recipe's mcp.json shape (names, order and indent only): ${JSON.stringify(recipeShape)}`);
    } else {
      t.diagnostic("kimi mcp add wrote no mcp.json in the isolated home");
    }
    assert.equal(fileSha256(REAL_KIMI_MCP), realBefore, "the operator's real ~/.kimi/mcp.json must be unchanged");
  },
);

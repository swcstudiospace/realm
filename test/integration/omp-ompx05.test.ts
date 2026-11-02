// The Omp write through the production stack: one real Omp process loads the built extension, dials the production daemon that
// `realm up` starts over OpenShell and rootless Podman, and calls the registered Realm `write` once.
//
// The scripted provider sends exactly one tool call, the Realm `write` of a unique file in the pinned workspace, and then a final
// message. Three assertions then check that one write from three sides:
//   (a) the host workspace root holds the file with exactly the written bytes;
//   (b) a Realm `exec` in the sandbox runs `cat` and `sha256sum` on the same path under /workspace. The sandbox's bytes and digest
//       are the written ones, and the container that ran the exec is the session's, named realm-daemon;
//   (c) the daemon's session audit file, <stateDir>/audit/daemon.jsonl, holds the admission and result lines of that write. Both
//       carry the same path, the same correlationId and the sha256 of the write. The result line carries the byte count too.
//
// Gate. The file skips, naming the first missing prerequisite, unless both of these hold:
//   1. REALM_LIVE_OMP=1 and the Omp prerequisites (ompSkipReason): Linux, the omp executable, its version, the built extension.
//   2. REALM_LIVE_PRODUCTION=1 and the production prerequisites (productionSkipReason): the opt-in, Podman 5.x, the digest-pinned
//      image, the driver config, a rootless Podman socket, the openshell CLI and the built CLI.
// The test never sets either variable.
//
// Removal scope. The test writes one workspace file, named ompx05-<random>.txt, and removes exactly that name. It starts the
// production daemon with its own scenario directory and runs `realm down` in cleanup. It then asserts that no container labelled
// with the daemon sandbox remains. Its Omp profile is a temporary root, removed afterwards.

import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  closeWithEvidence,
  collectOmpGateInputs,
  createCleanups,
  EXTENSION_PATH,
  isRecord,
  OMP_PROMPT_TIMEOUT_MS,
  OMP_READY_TIMEOUT_MS,
  ompBinary,
  ompSkipReason,
} from "../support/omp-live.js";
import { createOmpProfile, type OmpProfile } from "../support/omp-profile.js";
import { scriptedTurnProblem, startOmp, type OmpSession } from "../support/omp-rpc.js";
import { ScriptedProvider } from "../support/scripted-provider.js";
import {
  callTool,
  createScenarioEnvironment,
  DAEMON_SESSION_ID,
  describeResult,
  describeValue,
  field,
  initializeMcp,
  isDirectory,
  isSocket,
  listDaemonContainers,
  type LiveInputs,
  type McpExit,
  onPath,
  probePodman,
  productionSkipReason,
  readLiveInputs,
  realmCli,
  runCommand,
  startMcpSession,
  type ScenarioEnvironment,
  waitForActive,
  waitForNoResidue,
} from "../support/production-live.js";

// The compiled CLI beside the compiled tests: this file runs from dist/test/integration, the CLI from dist/src/cli.
const CLI_PATH = fileURLToPath(new URL("../../src/cli/main.js", import.meta.url));
const OMP_BIN = ompBinary(process.env);

// The Omp prerequisites are checked first, then the production ones, so the first missing one names the skip.
const ompGate = ompSkipReason(await collectOmpGateInputs(process.env, { platform: process.platform, trace: false }));
const productionGate = productionSkipReason({
  env: process.env,
  podman: await probePodman(),
  isSocket,
  onPath: (name) => onPath(name, process.env["PATH"]),
  exists: existsSync,
  isDirectory,
  cliPath: CLI_PATH,
});
const skip: string | false = ompGate ?? productionGate;
const live: LiveInputs | undefined = skip === false ? readLiveInputs(process.env, CLI_PATH) : undefined;

function requireLive(): LiveInputs {
  if (live === undefined) {
    throw new Error("the Omp write scenario ran although its gate is closed");
  }
  return live;
}

// The bounds of the one scenario. Its parts are realm up (240 s), the Omp ready frame (180 s), the prompt (60 s) and the first
// MCP answer (150 s, MCP_FIRST_RESPONSE_TIMEOUT_MS in production-live.ts); the test timeout covers their sum.
const SCENARIO_TIMEOUT_MS = 900_000;
const UP_TIMEOUT_MS = 240_000;
const DOWN_TIMEOUT_MS = 120_000;
const ACTIVE_TIMEOUT_MS = 120_000;
const MCP_EXIT_TIMEOUT_MS = 30_000;
const PODMAN_INSPECT_TIMEOUT_MS = 30_000;
const EVIDENCE_DIR_VARIABLE = "REALM_OMP_EVIDENCE_DIR";
const CLOSE_OPTIONS = { graceMs: 40_000, termMs: 20_000, killMs: 20_000 } as const;

// The audit lines of one file, each a JSON object. A line that is not one fails the test.
function auditEntries(file: string): Record<string, unknown>[] {
  const entries: Record<string, unknown>[] = [];
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (line.trim() === "") {
      continue;
    }
    const parsed: unknown = JSON.parse(line);
    assert.ok(isRecord(parsed), `an audit line must be a JSON object: ${line.slice(0, 200)}`);
    entries.push(parsed);
  }
  return entries;
}

void test(
  "Omp's registered Realm write reaches the production daemon: the host file, the sandbox copy and the audit pair agree",
  { skip, timeout: SCENARIO_TIMEOUT_MS },
  async (t) => {
    const inputs = requireLive();
    const scenario: ScenarioEnvironment = createScenarioEnvironment(inputs, { image: inputs.image });
    const name = `ompx05-${randomBytes(6).toString("hex")}.txt`;
    const content = `ompx05 ${randomUUID()}\nUTF-8 bytes: λ\n`;
    const expected = Buffer.from(content, "utf8");
    const expectedSha256 = createHash("sha256").update(expected).digest("hex");
    const prompt = `ompx05 write ${name}`;

    // Cleanups run last-in, first-out: Omp is closed first, then the daemon is stopped and the scenario's files are removed.
    const cleanups = createCleanups();
    t.after(() => cleanups.run());
    cleanups.add(async () => {
      const stopped = await realmCli(inputs, scenario, ["down"], DOWN_TIMEOUT_MS);
      assert.equal(stopped.exitCode, 0, `realm down: ${describeResult(stopped)}`);
      rmSync(join(inputs.workspaceRoot, name), { force: true });
      rmSync(scenario.root, { recursive: true, force: true });
      const residue = await waitForNoResidue(inputs);
      assert.ok(residue.ok, `residue after realm down: ${residue.detail}`);
      const containers = await listDaemonContainers(inputs);
      assert.ok(containers.ok, `list the daemon containers after realm down: ${describeValue(containers)}`);
      assert.deepEqual(containers.items, [], "no container named for the daemon session may remain after realm down");
    });

    const provider = new ScriptedProvider();
    cleanups.add(() => provider.stop());
    provider.onTurn((turn) =>
      turn.lastRole === "tool" ? { text: "done" } : { call: { name: "write", args: { path: name, content } } },
    );
    const { port } = await provider.start();

    const pathValue = process.env["PATH"];
    const profile: OmpProfile = createOmpProfile({
      providerPort: port,
      ...(pathValue === undefined ? {} : { path: pathValue }),
    });
    cleanups.add(() => {
      profile.dispose();
    });

    // The daemon is up before Omp starts, so the plugin finds it active and never starts a daemon of its own.
    const up = await realmCli(inputs, scenario, ["up", "--workspace", inputs.workspaceRoot], UP_TIMEOUT_MS);
    assert.equal(up.exitCode, 0, `realm up: ${describeResult(up)}`);
    const active = await waitForActive(inputs, scenario, ACTIVE_TIMEOUT_MS);
    assert.ok(active.ok, `realm status must report active before Omp starts: ${active.detail}`);

    // Omp runs with the profile's own HOME, agent directory and temporary directory. Only the configuration home is the
    // scenario's: the plugin reads the production config (image, stateDir, roots) from it.
    const configHome = scenario.cliEnvironment["XDG_CONFIG_HOME"];
    assert.ok(configHome !== undefined, "the scenario environment must name its configuration home");
    const tmpDir = join(profile.root, "tmp");
    mkdirSync(tmpDir);
    const omp: OmpSession = startOmp({
      bin: OMP_BIN,
      env: { ...profile.env, XDG_CONFIG_HOME: configHome, TMPDIR: tmpDir },
      // The daemon pins the project root the test brings up. Omp starts in that project, as a user runs it: the plugin
      // attaches with its working directory, and any other directory is refused with POLICY_DENIED.
      cwd: inputs.workspaceRoot,
      extensionPath: EXTENSION_PATH,
    });
    cleanups.add(() =>
      closeWithEvidence({
        evidenceDir: process.env[EVIDENCE_DIR_VARIABLE],
        evidence: {
          "ompx05.frames.jsonl": () => omp.frames.map((frame) => JSON.stringify(frame)).join("\n"),
          "ompx05.requests.json": () => JSON.stringify(provider.requests, null, 1),
        },
        report: (problem) => {
          t.diagnostic(problem);
        },
        close: () => omp.close(CLOSE_OPTIONS),
      }),
    );
    await omp.ready(OMP_READY_TIMEOUT_MS);
    await omp.waitFor(
      (session) => session.status()?.includes("realm active") === true,
      OMP_READY_TIMEOUT_MS,
      "the plugin's realm active status",
    );

    const outcome = await omp.prompt(prompt, OMP_PROMPT_TIMEOUT_MS);
    const turn = scriptedTurnProblem({ prompt, requests: provider.requests, frames: outcome.frames });
    assert.equal(turn, undefined, `the scripted Omp turn must complete: ${turn ?? ""}`);
    const writeEnds = outcome.toolEnds.filter((end) => end.toolName === "write");
    assert.equal(
      writeEnds.length,
      1,
      `exactly one write tool must end: ${describeValue(outcome.toolEnds.map((end) => end.toolName))}`,
    );
    const [writeEnd] = writeEnds;
    assert.ok(writeEnd !== undefined);
    assert.equal(writeEnd.isError, false, `the Realm write must succeed: ${writeEnd.text}`);

    // (a) The host workspace root holds the file with exactly the written bytes.
    const hostPath = join(inputs.workspaceRoot, name);
    assert.ok(existsSync(hostPath), `the host workspace root must hold ${name} after the Realm write`);
    const onHost = readFileSync(hostPath);
    assert.ok(
      onHost.equals(expected),
      `the host file must hold exactly the written bytes: host sha256 ${createHash("sha256").update(onHost).digest("hex")}, written sha256 ${expectedSha256}`,
    );

    // (b) Inside the sandbox, the same path under /workspace holds the written bytes and digest, and the container that ran the
    // exec is the session's: it is named realm-<id> for the daemon session, the name buildExecArgv gives the exec.
    const mcp = startMcpSession(inputs, scenario);
    let mcpExit: McpExit | undefined;
    try {
      await initializeMcp(mcp);
      const sandboxPath = `/workspace/${name}`;
      const sandboxExec = async (argv: readonly string[]): Promise<string> => {
        const value = await callTool(mcp, "exec", { argv });
        assert.equal(field(value, "exitCode"), 0, `exec ${argv.join(" ")} in the sandbox must exit 0: ${describeValue(value)}`);
        const stdout = field(value, "stdout");
        assert.ok(
          typeof stdout === "string" && field(value, "truncated") !== true,
          `exec ${argv.join(" ")} in the sandbox must return its whole stdout: ${describeValue(value)}`,
        );
        return stdout;
      };

      const sandboxContent = await sandboxExec(["cat", sandboxPath]);
      assert.equal(sandboxContent, content, `the sandbox's ${sandboxPath} must hold the written content`);
      const digestLine = await sandboxExec(["sha256sum", sandboxPath]);
      const [sandboxSha256] = digestLine.trim().split(/\s+/);
      assert.equal(
        sandboxSha256,
        expectedSha256,
        `the sandbox's sha256sum of ${sandboxPath} must match the written bytes: ${describeValue(digestLine)}`,
      );

      const containers = await listDaemonContainers(inputs);
      assert.ok(containers.ok, `list the daemon containers: ${describeValue(containers)}`);
      assert.equal(
        containers.items.length,
        1,
        `exactly one container carries the realm-${DAEMON_SESSION_ID} sandbox label: ${describeValue(containers.items)}`,
      );
      const [containerId] = containers.items;
      assert.ok(containerId !== undefined);
      const inspected = await runCommand("podman", ["inspect", "--format", "{{.Name}}", containerId], {
        env: inputs.hostEnvironment,
        timeoutMs: PODMAN_INSPECT_TIMEOUT_MS,
        cwd: tmpdir(),
      });
      assert.equal(inspected.exitCode, 0, `podman inspect ${containerId}: ${describeResult(inspected)}`);
      assert.equal(
        inspected.stdout.trim(),
        `realm-${DAEMON_SESSION_ID}`,
        `the container that ran the sandbox exec must be the session's realm-${DAEMON_SESSION_ID} container`,
      );
    } finally {
      mcp.closeInput();
      mcpExit = await mcp.waitForExit(MCP_EXIT_TIMEOUT_MS);
      // A child still running after the exit deadline (stuck in attach or a request) is killed here, so its pipes close and the
      // assertion below reports the failure instead of leaving the test worker holding the child.
      mcp.kill();
    }
    assert.notEqual(mcpExit, undefined, `realm mcp must exit within ${String(MCP_EXIT_TIMEOUT_MS / 1000)} s; stderr ${mcp.stderr()}`);

    // (c) The daemon's audit file holds the admission and result lines of this write, paired on one correlationId.
    // The daemon writes its session's audit under its own session id, so the file is audit/daemon.jsonl.
    const auditFile = join(scenario.stateDir, "audit", `${DAEMON_SESSION_ID}.jsonl`);
    assert.ok(existsSync(auditFile), `the daemon's audit file must exist: ${auditFile}`);
    const writes = auditEntries(auditFile).filter((entry) => entry["tool"] === "write" && entry["path"] === name);
    const admissions = writes.filter((entry) => entry["phase"] === "admission");
    const results = writes.filter((entry) => entry["phase"] === "result");
    assert.equal(admissions.length, 1, `exactly one admission line for ${name}: ${describeValue(writes)}`);
    assert.equal(results.length, 1, `exactly one result line for ${name}: ${describeValue(writes)}`);
    const [admission] = admissions;
    const [result] = results;
    assert.ok(admission !== undefined && result !== undefined);
    assert.equal(result["outcome"], "ok", `the result line must record success: ${describeValue(result)}`);
    assert.equal(typeof result["correlationId"], "string", `the result line must carry a correlationId: ${describeValue(result)}`);
    assert.equal(
      admission["correlationId"],
      result["correlationId"],
      `the admission and result lines must share one correlationId: ${describeValue(writes)}`,
    );
    assert.equal(result["bytes"], expected.byteLength, `the result line's byte count: ${describeValue(result)}`);
    assert.equal(result["sha256"], expectedSha256, `the result line's sha256 must match the written bytes: ${describeValue(result)}`);
    assert.equal(admission["sha256"], expectedSha256, `the admission line's sha256 must match the written bytes: ${describeValue(admission)}`);
  },
);

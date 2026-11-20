// The live enforce proof (EVID-03, plan 35-03). Two tiers, each gated and each skipped, naming the first missing variable, when its gate is closed;
// the test never sets a gate variable and starts nothing while a gate is closed.
//
// Validator tier (REALM_LIVE_CLAUDE=1 and a claude executable; no Podman, no production stack). The real claude CLI runs in print mode in an
// isolated configuration against the scripted Anthropic-format loopback provider (test/support/scripted-anthropic-provider.ts), with the real
// recipe installed and a stub `realm` standing behind the registered command. It answers one question: does claude itself issue a tools/call
// for the Realm status tool when the provider asks for it? Observed 2026-11-18 (claude 2.1.322): yes, once ENABLE_TOOL_SEARCH=false makes claude
// offer MCP tools by name instead of deferring them behind its ToolSearch tool (without it the provider is offered no MCP tool at all).
//
// Production tier (the production gate of claude, which needs REALM_LIVE_CLAUDE, REALM_LIVE_PRODUCTION and the production prerequisites, and
// REALM_LIVE_CAPABILITY=1; the realmlive account's rootless Podman 5.x stack). With the effective default (capabilityTokens absent from the
// policy, so enforce) it shows:
//   1  the effective mode (realm host token status, the capability-tokens doctor item);
//   2  the launcher-driven drive: the registered command `realm mcp --host claude`, started cold for a new project, driven by a script that polls
//      status until the session is active and then lists the workspace root;
//   3  that enforce really enforces: a second session started without the host flag is refused POLICY_DENIED and does no tool work;
//   4  the plan 35-02 memory probe aimed, from a process that is no descendant of the test, at the live realm mcp process and at the live daemon
//      (the result is recorded as a diagnostic, not claimed);
//   5  the audit file of the session: the attach line, host claude and the active kid on every call line, the attach before the first call,
//      realm audit verify passing and an edited copy failing;
//   6  optional, only with REALM_LIVE_CAPABILITY_HOST_TURN=1 (the owner's decision of OQ-35-02): the host-driven drive, in which claude itself issues a
//      tool call against the scripted provider (no credential, no real model), through a wire recorder, against the warm session of the project;
//   7  a leak scan of every sink for a token shape and the key texts of the keyring;
//   8  the cleanup: the capability keyring directory the run created is removed (one that existed is left byte for byte), the operator policy.json is
//      restored byte for byte, the receipt and presence entries of the run are removed, the real host file is byte-identical and nothing remains.
//
// Diagnostics carry counts, codes, states, ids of hosts and keys and millisecond marks: never a token, a key, a header value or a path.

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { test, type TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import { keyringPathOf } from "../../src/capability/keyring.js";
import { runCli, type CliResult } from "../../src/cli/main.js";
import {
  auditCountsOf,
  checkCapabilityAudit,
  claudePrintArgs,
  claudeTurnEnv,
  doctorItemOf,
  keyringFactOf,
  keyringSecrets,
  leakProblems,
  parseAuditLines,
  readStubCalls,
  sinksUnder,
  tamperedCopies,
  TOKEN_SECRET,
  writeStatusStubServer,
  type Sink,
} from "../support/capability-live.js";
import {
  cliJson,
  collectHostLiveGate,
  createHostRig,
  describeRun,
  downAcceptable,
  fileSha256,
  gateBin,
  hostVersionNote,
  PRODUCTION_TIMEOUT_MS,
  requireReturned,
  runHost,
  shellQuote,
  VALIDATOR_TIMEOUT_MS,
} from "../support/host-live.js";
import { readWireLog, REALM_TOOL_NAMES, wireSummary, writeWireRecorder } from "../support/host-live-session.js";
import { startNonDescendantProbe, type ProbeReport } from "../support/memory-probe.js";
import { createCleanups } from "../support/omp-live.js";
import {
  createScenarioEnvironment,
  describeResult,
  describeValue,
  field,
  findDaemonPids,
  initializeMcp,
  listSandboxContainers,
  MCP_RESPONSE_TIMEOUT_MS,
  pollUntil,
  readLiveInputs,
  realmCli,
  realmCliWithWorkspace,
  removeSharedStateCreatedBy,
  requestLogLinesOf,
  restoreSharedPolicy,
  sandboxNameFor,
  SERVED_POLL_INTERVAL_MS,
  sessionIdFor,
  startMcpSession,
  stateOfStatus,
  waitForNoResidue,
  type CommandResult,
  type LiveInputs,
  type McpSession,
  type ScenarioEnvironment,
} from "../support/production-live.js";
import { ScriptedAnthropicProvider } from "../support/scripted-anthropic-provider.js";
import { scaledMs, testTimeout } from "../support/timing.js";

// The compiled CLI, the compiled daemon entry and the compiled probe entry beside the compiled tests.
const CLI_PATH = fileURLToPath(new URL("../../src/cli/main.js", import.meta.url));
const DAEMON_ENTRY = fileURLToPath(new URL("../../src/daemon/main.js", import.meta.url));
const PROBE_ENTRY = fileURLToPath(new URL("../support/memory-probe-run.js", import.meta.url));

const validator = await collectHostLiveGate("claude", "validator", { env: process.env, platform: process.platform, cliPath: CLI_PATH });
const production = await collectHostLiveGate("claude", "production", { env: process.env, platform: process.platform, cliPath: CLI_PATH });
const CAPABILITY_VARIABLE = "REALM_LIVE_CAPABILITY";
const HOST_TURN_VARIABLE = "REALM_LIVE_CAPABILITY_HOST_TURN";
// The production gate first (its reason names the first missing variable), then the proof's own opt-in.
const proofGate: string | false = production.skip !== false ? production.skip : process.env[CAPABILITY_VARIABLE] === "1" ? false : `${CAPABILITY_VARIABLE}=1 is not set: the enforce proof is an explicit opt-in`;

const HOST = "claude";
const REGISTERED_ARGV = ["mcp", "--host", HOST];
const PROOF_TEST_TIMEOUT_MS = 900_000;
const COLD_START_BOUND_MS = 300_000;
const UNLABELLED_BOUND_MS = 120_000;
const COMMAND_TIMEOUT_MS = 60_000;
const DOWN_TIMEOUT_MS = 120_000;
const EXIT_TIMEOUT_MS = 15_000;
const DAEMON_EXIT_TIMEOUT_MS = 60_000;
const AUDIT_REFUSAL_CEILING = 10;

function textOfError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ---- Validator tier: is a scripted claude turn feasible? --------------------------------------------------------------------

void test(
  "claude feasibility: print mode against the scripted provider issues a tools/call for the Realm status tool through the registered command (stub realm)",
  { skip: validator.skip, ...testTimeout(600_000) },
  async (t: TestContext) => {
    t.diagnostic(hostVersionNote(HOST, validator));
    const rig = createHostRig({ host: HOST, bin: gateBin(validator), overrides: { CLAUDE_CONFIG_DIR: "claude-config" } }, process.env);
    t.after(() => {
      rig.dispose();
    });
    // The registered command resolves to the first `realm` on PATH, the rig's stub directory. Replace the recording stub with one that
    // execs the status stub server, so the real `realm mcp --host claude` argv reaches a server that answers the MCP calls.
    const stubLog = rig.path("status-stub.log");
    const server = writeStatusStubServer(rig.path("stub-server"), stubLog);
    const shim = join(rig.path("stub"), "realm");
    writeFileSync(shim, `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(server)} "$@"\n`);
    chmodSync(shim, 0o755);
    const installed = cliJson(await rig.realm(["install", HOST]), "realm host install claude");
    assert.equal(installed["status"], "installed", describeValue(installed));

    const provider = new ScriptedAnthropicProvider();
    const { baseUrl } = await provider.start();
    t.after(async () => {
      await provider.stop();
    });
    const env = claudeTurnEnv(rig.env, baseUrl, provider.apiKey);
    const startedAt = Date.now();
    const run = await runHost(rig.bin, claudePrintArgs(), env, rig.cwd, scaledMs(VALIDATOR_TIMEOUT_MS));
    const elapsedMs = Date.now() - startedAt;
    requireReturned(run, "claude print mode");
    const messages = provider.messageRequests;
    const calls = readStubCalls(stubLog);
    t.diagnostic(
      `claude print mode: exit ${String(run.exitCode)} after ${String(elapsedMs)} ms; stub methods [${calls.map((call) => call.method).join(", ")}]; ` +
        `provider messages ${String(messages.length)}, tool results seen [${messages.map((entry) => String(entry.hasToolResult)).join(", ")}], ` +
        `mcp tools offered in the first request ${String(messages[0]?.toolsOffered.filter((name) => name.startsWith("mcp__")).length ?? 0)}, streamed [${messages.map((entry) => String(entry.streamed)).join(", ")}], ` +
        `rejected ${String(provider.rejected.length)}, proxy refusals ${String(provider.proxyRefusals.length)}, failures ${String(provider.failures.length)}`,
    );
    assert.equal(run.exitCode, 0, `claude print mode must exit 0: ${describeRun(run)}`);
    assert.ok(calls.some((call) => call.method === "tools/call" && call.tool === "status"), `the stub must have recorded a tools/call for status; methods seen: [${calls.map((call) => call.method).join(", ")}]`);
    assert.ok(messages.length >= 2, `the provider must have seen at least two Messages requests; saw ${String(messages.length)}`);
    assert.equal(messages[0]?.hasToolResult, false, "the first request carries no tool result");
    assert.equal(messages[1]?.hasToolResult, true, "the second request carries the tool result");
    assert.equal(provider.rejected.length, 0, "the provider rejected no request: claude sent the placeholder key");
    assert.equal(provider.proxyRefusals.length, 0, "claude made no proxy request");
    assert.deepEqual(provider.failures, []);
  },
);

// ---- Production tier: enforce on the production stack ----------------------------------------------------------------------

// The state of a status tool result: the snapshot state of a call that ran, or undefined.
function snapshotStateOf(result: unknown): string | undefined {
  const state: unknown = field(field(field(field(result, "structuredContent"), "value"), "snapshot"), "state");
  return typeof state === "string" ? state : undefined;
}

// The catalogue code of a refused tool result, or undefined for a result that ran.
function refusalCodeOf(result: unknown): string | undefined {
  if (field(result, "isError") !== true) {
    return undefined;
  }
  const code: unknown = field(field(result, "structuredContent"), "code");
  return typeof code === "string" ? code : "(none)";
}

interface ColdDrive {
  readonly elapsedMs: number;
  readonly polls: number;
  // Outcomes before the session was active, counted by code or state.
  readonly outcomes: ReadonlyMap<string, number>;
  // The calls of the drive that ran (a status call that answered, whatever its state, and the later served calls).
  readonly served: number;
}

// Polls status through the session until the snapshot state is active. A refusal other than REALM_NOT_ACTIVE fails at once.
async function driveUntilActive(session: McpSession): Promise<ColdDrive> {
  const outcomes = new Map<string, number>();
  let served = 0;
  const count = (key: string): void => {
    outcomes.set(key, (outcomes.get(key) ?? 0) + 1);
  };
  const startedAt = Date.now();
  const outcome = await pollUntil(
    async () => {
      const result = await session.request("tools/call", { name: "status", arguments: {} }, MCP_RESPONSE_TIMEOUT_MS);
      const code = refusalCodeOf(result);
      if (code !== undefined) {
        count(`refused ${code}`);
        assert.equal(code, "REALM_NOT_ACTIVE", `a status call before the session is active may be refused REALM_NOT_ACTIVE only; got ${code}; realm mcp stderr ${session.stderr()}`);
        return { done: false, detail: `refused ${code}` };
      }
      served += 1;
      const state = snapshotStateOf(result) ?? "unknown";
      count(`state ${state}`);
      return state === "active" ? { done: true } : { done: false, detail: `state ${state}` };
    },
    { timeoutMs: COLD_START_BOUND_MS, intervalMs: SERVED_POLL_INTERVAL_MS },
  );
  assert.ok(outcome.ok, `the cold session must become active within ${String(COLD_START_BOUND_MS / 1000)} s; ${String(outcome.attempts)} status calls, the last: ${outcome.detail}; realm mcp stderr ${session.stderr()}`);
  return { elapsedMs: Date.now() - startedAt, polls: outcome.attempts, outcomes, served };
}

function describeOutcomes(outcomes: ReadonlyMap<string, number>): string {
  return [...outcomes.entries()].map(([key, count]) => `${key} x${String(count)}`).join(", ");
}

function probeSummary(report: ProbeReport): string {
  return (
    `ptrace_scope ${report.ptraceScope}, probe uid ${String(report.probeUid)}, target uid ${String(report.target.uid)}, ancestor ${String(report.probeIsAncestorOfTarget)}, ` +
    `status ${report.target.status}, environ ${report.environ.read} (token shapes ${String(report.environ.tokenShapes)}), ` +
    `mem open ${report.mem.open}, maps ${report.mem.maps}, regions listed ${String(report.mem.regionsListed)} read ${String(report.mem.regionsRead)} ` +
    `failed ${JSON.stringify(report.mem.regionsFailed)} unread ${String(report.mem.regionsUnread)}, bytes ${String(report.mem.bytesRead)}, truncated ${String(report.mem.truncated)}, ` +
    `token candidates ${String(report.mem.tokenCandidateCount)}, key file ${report.keyFile}, target gone ${String(report.targetGone)}, ${String(report.elapsedMs)} ms`
  );
}

void test(
  "capability enforce on the production stack: claude attaches cold through the daemon under the default policy, the audit lines carry host and kid, an unlabelled session is refused, and no secret leaks",
  { skip: proofGate, timeout: PROOF_TEST_TIMEOUT_MS },
  async (t: TestContext) => {
    const bin = gateBin(production);
    const inputs: LiveInputs = readLiveInputs(process.env, CLI_PATH);
    const { driverStateDir } = inputs;
    assert.ok(driverStateDir !== undefined, "the production gate names the driver's state directory");
    const hostTurn = process.env[HOST_TURN_VARIABLE] === "1";
    t.diagnostic(`${hostVersionNote(HOST, production)}; the host-driven drive ${hostTurn ? "is enabled" : `is off (${HOST_TURN_VARIABLE} is not 1)`}`);

    // What the run must leave as it found it, read before the scenario touches the state root.
    const hostsDir = join(driverStateDir, "hosts");
    const hostsDirExisted = existsSync(hostsDir);
    const presenceDir = join(hostsDir, `${HOST}-active`);
    const presenceDirExisted = existsSync(presenceDir);
    const policyBefore = fileSha256(join(driverStateDir, "policy.json"));
    const keyringBefore = keyringFactOf(driverStateDir);
    const requestLogBefore = requestLogLinesOf(driverStateDir).length;
    const daemonLogFile = join(driverStateDir, "daemon.log");
    const daemonLogBefore = existsSync(daemonLogFile) ? readFileSync(daemonLogFile, "utf8").split("\n").length : 0;

    // The scenario policy omits capabilityTokens: the effective default applies and nothing hides a flip of it.
    const scenario: ScenarioEnvironment = createScenarioEnvironment(inputs, { image: inputs.image });
    const hostHome = scenario.cliEnvironment["HOME"];
    assert.ok(hostHome !== undefined, "the scenario environment must name the account home");
    const realClaudeFile = join(hostHome, ".claude.json");
    const realClaudeBefore = fileSha256(realClaudeFile);
    const productionPath = inputs.hostEnvironment["PATH"];

    const projectDir = join(inputs.workspaceRoot, `capability-proof-${randomBytes(6).toString("hex")}`);
    // The directory must exist first: sandboxNameFor and sessionIdFor resolve its real path.
    mkdirSync(projectDir);
    const sandboxes = [sandboxNameFor(projectDir)];
    const sessionId = sessionIdFor(projectDir);
    const auditFile = join(driverStateDir, "audit", `${sessionId}.jsonl`);

    // Every sink a secret could reach, and the diagnostics the test prints themselves.
    const sinks: Sink[] = [];
    const record = (name: string, text: string): void => {
      sinks.push({ name, text });
    };
    const diag = (message: string): void => {
      t.diagnostic(message);
      record("a diagnostic of this test", message);
    };
    const ran = (label: string, result: CommandResult): CommandResult => {
      record(`${label} stdout`, result.stdout);
      record(`${label} stderr`, result.stderr);
      return result;
    };

    const sessions: McpSession[] = [];
    const recipe: { uninstall?: () => Promise<void> } = {};
    const cleanups = createCleanups();
    t.after(() => cleanups.run());
    let cleaned = false;
    const cleanup = async (): Promise<void> => {
      if (cleaned) {
        return;
      }
      cleaned = true;
      // Every step runs even when an earlier one fails; the failures are reported together at the end.
      const failures: unknown[] = [];
      const step = async (work: () => void | Promise<void>): Promise<void> => {
        try {
          await work();
        } catch (error) {
          failures.push(error);
        }
      };
      await step(() => {
        for (const session of sessions) {
          session.kill();
        }
      });
      await step(async () => {
        if (existsSync(projectDir)) {
          const stopped = await realmCliWithWorkspace(inputs, scenario, ["down"], projectDir, DOWN_TIMEOUT_MS);
          assert.ok(downAcceptable(stopped), `realm down: ${describeResult(stopped)}`);
        }
      });
      await step(async () => {
        const gone = await pollUntil(
          async () => {
            const listing = await findDaemonPids(inputs, DAEMON_ENTRY);
            if (!listing.ok) {
              return { done: false, detail: listing.detail };
            }
            return listing.pids.length === 0 ? { done: true } : { done: false, detail: `${String(listing.pids.length)} daemon process(es) still run` };
          },
          { timeoutMs: scaledMs(DAEMON_EXIT_TIMEOUT_MS), intervalMs: 2_000 },
        );
        assert.ok(gone.ok, `no daemon of the run may remain after realm down: ${gone.detail}`);
      });
      await step(async () => {
        await recipe.uninstall?.();
      });
      await step(() => {
        restoreSharedPolicy(scenario);
      });
      await step(() => {
        removeSharedStateCreatedBy(scenario);
      });
      await step(() => {
        // The receipt and the presence directory of this run. Nothing that existed before the run is removed.
        rmSync(join(hostsDir, `${HOST}.receipt.json`), { force: true });
        if (!presenceDirExisted) {
          rmSync(presenceDir, { recursive: true, force: true });
        }
        if (!hostsDirExisted) {
          rmSync(hostsDir, { recursive: true, force: true });
        }
      });
      await step(() => {
        rmSync(projectDir, { recursive: true, force: true });
        rmSync(scenario.root, { recursive: true, force: true });
      });
      await step(async () => {
        const residue = await waitForNoResidue(inputs, sandboxes);
        assert.ok(residue.ok, `residue after realm down: ${residue.detail}`);
        for (const sandbox of sandboxes) {
          const containers = await listSandboxContainers(inputs, sandbox);
          assert.ok(containers.ok, `list the containers of ${sandbox} after realm down: ${describeValue(containers)}`);
          assert.deepEqual(containers.items, [], `no container of ${sandbox} may remain after realm down`);
        }
      });
      if (failures.length > 0) {
        throw new AggregateError(failures, `capability proof cleanup: ${failures.map(textOfError).join("; ")}`);
      }
    };
    cleanups.add(cleanup);

    // ---- 1  The effective mode --------------------------------------------------------------------------------------------
    const statusBefore = ran("realm host token status (before)", await realmCli(inputs, scenario, ["host", "token", "status"], COMMAND_TIMEOUT_MS));
    assert.equal(statusBefore.exitCode, 0, `realm host token status: ${describeResult(statusBefore)}`);
    const tokenBefore: unknown = JSON.parse(statusBefore.stdout.trim());
    assert.equal(field(tokenBefore, "mode"), "enforce", `the effective default is not enforce (mode ${describeValue(field(tokenBefore, "mode"))}): the test writes no policy edit that would hide the flip`);
    diag(`effective mode enforce; keyring ${describeValue(field(tokenBefore, "keyring"))} before the first call (a keyring existed before the run: ${String(keyringBefore.present)})`);
    const doctorBefore = ran("realm doctor (before)", await realmCli(inputs, scenario, ["doctor"], COMMAND_TIMEOUT_MS));
    const itemBefore = doctorItemOf(doctorBefore.stdout);
    diag(`doctor item capability-tokens before the first attach: ${itemBefore === undefined ? "not found in the doctor output" : `${itemBefore.status}: ${itemBefore.detail}`}`);

    // ---- 2  The launcher-driven drive, cold -------------------------------------------------------------------------------
    // The registered command, `realm mcp --host claude`, for a new project: nothing started a daemon or a sandbox for it.
    const launcher = startMcpSession(inputs, scenario, { host: HOST, workspace: projectDir });
    sessions.push(launcher);
    diag(`launcher-driven drive: realm ${REGISTERED_ARGV.join(" ")} for a new project under the pinned workspace root (cold)`);
    await initializeMcp(launcher);
    const listed = await launcher.request("tools/list", {}, MCP_RESPONSE_TIMEOUT_MS);
    const toolsListed = field(listed, "tools");
    const toolNames = Array.isArray(toolsListed) ? (toolsListed as unknown[]).map((tool) => String(field(tool, "name"))).sort() : [];
    assert.deepEqual(toolNames, [...REALM_TOOL_NAMES], `tools/list must show the six Realm tools: ${describeValue(listed)}`);
    const cold = await driveUntilActive(launcher);
    diag(`cold start: active after ${String(cold.elapsedMs)} ms and ${String(cold.polls)} status calls; outcomes before and at active: ${describeOutcomes(cold.outcomes)}`);
    let served = cold.served;
    const statusResult = await launcher.request("tools/call", { name: "status", arguments: {} }, MCP_RESPONSE_TIMEOUT_MS);
    assert.equal(refusalCodeOf(statusResult), undefined, `a status call after active must run: ${describeValue(statusResult)}`);
    served += 1;
    const listResult = await launcher.request("tools/call", { name: "list", arguments: { path: ".", depth: 1 } }, MCP_RESPONSE_TIMEOUT_MS);
    assert.equal(refusalCodeOf(listResult), undefined, `a list call after active must run: ${describeValue(listResult)}`);
    assert.equal(field(field(listResult, "structuredContent"), "outcome"), "done", `the list of the workspace root must be done: ${describeValue(listResult)}`);
    served += 1;
    diag(`after active: a status call and a list of the workspace root ran; ${String(served)} calls of the drive ran in all`);

    const statusAfter = ran("realm host token status (after)", await realmCli(inputs, scenario, ["host", "token", "status"], COMMAND_TIMEOUT_MS));
    assert.equal(statusAfter.exitCode, 0, `realm host token status after the attach: ${describeResult(statusAfter)}`);
    const tokenAfter: unknown = JSON.parse(statusAfter.stdout.trim());
    const kid = field(tokenAfter, "active");
    assert.equal(field(tokenAfter, "mode"), "enforce");
    assert.equal(field(tokenAfter, "keyring"), "present", "the keyring exists once the daemon enforces and a host attached");
    assert.ok(typeof kid === "string" && kid.length > 0, `realm host token status must name the active kid: ${describeValue(tokenAfter)}`);
    diag(`token status after the attach: mode enforce, keyring present, active kid ${kid}, file mode ${describeValue(field(tokenAfter, "fileMode"))}`);
    const doctorAfter = ran("realm doctor (after)", await realmCli(inputs, scenario, ["doctor"], COMMAND_TIMEOUT_MS));
    const itemAfter = doctorItemOf(doctorAfter.stdout);
    diag(`doctor item capability-tokens after the first attach: ${itemAfter === undefined ? "not found in the doctor output" : `${itemAfter.status}: ${itemAfter.detail}`}`);
    assert.equal(itemAfter?.status, "pass", "the capability-tokens doctor item must pass after the first attach");

    // ---- 3  Enforce is really enforcing: the unlabelled session is refused ----------------------------------------------
    const unlabelled = startMcpSession(inputs, scenario, { host: null, workspace: projectDir });
    sessions.push(unlabelled);
    await initializeMcp(unlabelled);
    // The session may be refused REALM_NOT_ACTIVE until the daemon has adopted it; the first answer that is not that is the verdict.
    let verdict: unknown;
    const decided = await pollUntil(
      async () => {
        verdict = await unlabelled.request("tools/call", { name: "status", arguments: {} }, MCP_RESPONSE_TIMEOUT_MS);
        return refusalCodeOf(verdict) === "REALM_NOT_ACTIVE" ? { done: false, detail: "REALM_NOT_ACTIVE" } : { done: true };
      },
      { timeoutMs: UNLABELLED_BOUND_MS, intervalMs: SERVED_POLL_INTERVAL_MS },
    );
    assert.ok(decided.ok, `the unlabelled session must get an answer other than REALM_NOT_ACTIVE: ${decided.detail}`);
    assert.equal(refusalCodeOf(verdict), "POLICY_DENIED", `the unlabelled session must be refused POLICY_DENIED: ${describeValue(verdict)}`);
    assert.notEqual(field(field(verdict, "structuredContent"), "outcome"), "done", "the refused call did no tool work");
    diag("unlabelled session (no host flag): status refused POLICY_DENIED, no tool work");
    unlabelled.closeInput();
    const unlabelledExit = await unlabelled.waitForExit(EXIT_TIMEOUT_MS);
    record("realm mcp (unlabelled) stderr", unlabelled.stderr());
    diag(`the unlabelled session ended: ${describeValue(unlabelledExit)}`);

    // The daemon's own account of the refusal: a capability.refused line of this run in its logs.
    const requestLines = requestLogLinesOf(driverStateDir);
    const newRequestLines = requestLines.length >= requestLogBefore ? requestLines.slice(requestLogBefore) : requestLines;
    const daemonLogLines = existsSync(daemonLogFile) ? readFileSync(daemonLogFile, "utf8").split("\n") : [];
    const newDaemonLines = daemonLogLines.length >= daemonLogBefore ? daemonLogLines.slice(daemonLogBefore) : daemonLogLines;
    record("the request log lines of this run", newRequestLines.join("\n"));
    record("the daemon log lines of this run", newDaemonLines.join("\n"));
    const refusedInLog = [...newRequestLines, ...newDaemonLines].filter((line) => line.includes("capability.refused"));
    diag(`the daemon logs hold ${String(refusedInLog.length)} capability.refused line(s) for this run (request log ${String(newRequestLines.length)} new lines, daemon log ${String(newDaemonLines.length)} new lines)`);
    assert.ok(refusedInLog.length >= 1, "the daemon log must hold a capability.refused line of this run");

    // ---- 4  The live probe observation -------------------------------------------------------------------------------------
    // From a process that is no descendant of this test, aimed at the realm mcp child and at the daemon, with no needle and no marker: the
    // real key and the real token are never passed to a probe. The reports are printed; only their shape is asserted.
    const keyringFile = keyringPathOf(driverStateDir);
    const daemonListing = await findDaemonPids(inputs, DAEMON_ENTRY);
    assert.ok(daemonListing.ok, `listing the daemon processes: ${daemonListing.ok ? "" : daemonListing.detail}`);
    assert.equal(daemonListing.pids.length, 1, `exactly one daemon process must run from the compiled daemon entry; found ${String(daemonListing.pids.length)}`);
    const daemonPid = daemonListing.pids[0];
    assert.ok(daemonPid !== undefined && launcher.pid !== undefined, "the realm mcp child and the daemon have pids");
    for (const [label, pid] of [["realm mcp process", launcher.pid], ["daemon", daemonPid]] as const) {
      const report = await startNonDescendantProbe(PROBE_ENTRY, { kind: "target", pid, needles: [], markers: [], keyringPath: keyringFile }, join(scenario.root, `probe-${label.split(" ")[0] ?? "target"}.json`));
      diag(`live probe of the ${label}: ${probeSummary(report)}`);
      assert.equal(JSON.stringify(report).includes("rcap1."), false, `the report of the ${label} must be redacted: it holds a token prefix`);
      assert.equal(report.probeIsAncestorOfTarget, false, `the probe must be no ancestor of the ${label}`);
      assert.notEqual(report.probeUid, 0, "the probe must run as a non-root user");
      assert.equal(report.probeUid, report.target.uid, `the probe and the ${label} must run as the same user`);
    }

    // ---- 5  The audit file ---------------------------------------------------------------------------------------------------
    launcher.closeInput();
    const launcherExit = await launcher.waitForExit(EXIT_TIMEOUT_MS);
    record("realm mcp (launcher) stderr", launcher.stderr());
    diag(`the launcher session ended: ${describeValue(launcherExit)}`);
    assert.deepEqual(launcherExit, { code: 0, signal: null }, "the launcher session must exit 0 once its input closed");

    const verifySession = async (label: string): Promise<void> => {
      const verified = ran(`realm audit verify (${label})`, await realmCli(inputs, scenario, ["audit", "verify", "--session", sessionId], COMMAND_TIMEOUT_MS));
      diag(`realm audit verify --session (${label}): exit ${String(verified.exitCode)}`);
      assert.equal(verified.exitCode, 0, `realm audit verify --session must pass (${label}): ${describeResult(verified)}`);
    };
    const firstText = readFileSync(auditFile, "utf8");
    const firstLines = parseAuditLines(firstText);
    const firstCounts = auditCountsOf(firstLines);
    diag(`audit file after the launcher drive: ${JSON.stringify(firstCounts)}`);
    const problems = checkCapabilityAudit(firstLines, { sessionId, host: HOST, kid, calls: served, refusals: 1 });
    diag(`audit check (host ${HOST}, kid ${kid}, ${String(served)} calls, at least 1 refusal): ${problems.length === 0 ? "no problem" : problems.join(" | ")}`);
    assert.deepEqual(problems, [], "the audit file must carry the attach line, host claude and the active kid on every call line");
    assert.equal(firstCounts.attach, 1, "one attach line for the one labelled session");
    assert.ok(firstCounts.refusal >= 1 && firstCounts.refusal <= AUDIT_REFUSAL_CEILING, `the refusals stay within the audit bound: ${String(firstCounts.refusal)} refusal lines`);
    const attachLine = firstLines.find((line) => line["tool"] === "capability.attach");
    const callLine = firstLines.find((line) => line["phase"] === "admission");
    diag(`the attach line: tool ${String(attachLine?.["tool"])}, outcome ${String(attachLine?.["outcome"])}, host ${String(attachLine?.["host"])}, kid ${String(attachLine?.["kid"])}; the first call line: tool ${String(callLine?.["tool"])}, phase ${String(callLine?.["phase"])}, host ${String(callLine?.["host"])}, kid ${String(callLine?.["kid"])}`);
    await verifySession("after the launcher drive");
    const copies = tamperedCopies(firstText);
    const verifyFile = async (name: string, text: string): Promise<CommandResult> => {
      const file = join(scenario.root, `${name}.jsonl`);
      writeFileSync(file, text, { mode: 0o600 });
      return ran(`realm audit verify --file (${name})`, await realmCli(inputs, scenario, ["audit", "verify", "--file", file], COMMAND_TIMEOUT_MS));
    };
    const untouched = await verifyFile("copy-untouched", firstText);
    const hostEdited = await verifyFile("copy-host-edited", copies.hostEdited);
    const kidEdited = await verifyFile("copy-kid-edited", copies.kidEdited);
    diag(`audit copies: unedited exit ${String(untouched.exitCode)}, host edited exit ${String(hostEdited.exitCode)}, kid edited exit ${String(kidEdited.exitCode)}`);
    assert.equal(untouched.exitCode, 0, "the unedited copy must verify");
    assert.equal(hostEdited.exitCode, 1, "the copy with an edited host must fail realm audit verify");
    assert.equal(kidEdited.exitCode, 1, "the copy with an edited kid must fail realm audit verify");

    // ---- 6  The host-driven drive (the owner's decision OQ-35-02) -----------------------------------------------------------
    let wireLogText = "";
    let calls = served;
    if (!hostTurn) {
      diag("host-driven drive not run: only the registered command was driven by a script; claude did not itself issue a tool call");
    } else {
      // The launcher session ended; the project's session stays active until realm down. The host-driven drive is warm by design.
      const warm = await pollUntil(
        async () => {
          const status = ran("realm status (before the host-driven drive)", await realmCliWithWorkspace(inputs, scenario, ["status"], projectDir, COMMAND_TIMEOUT_MS));
          const state = status.exitCode === 0 ? stateOfStatus(status.stdout) : undefined;
          return state === "active" ? { done: true } : { done: false, detail: `state ${state ?? "none"}` };
        },
        { timeoutMs: scaledMs(90_000), intervalMs: 2_000 },
      );
      assert.ok(warm.ok, `the project's session must still be active for the host-driven drive: ${warm.detail}`);

      const claudeDir = join(scenario.root, "cfg");
      mkdirSync(claudeDir);
      const shimDir = join(scenario.root, "shim");
      const wireLog = join(scenario.root, "wire.log");
      writeWireRecorder(shimDir, { nodePath: process.execPath, target: [process.execPath, CLI_PATH], logFile: wireLog });
      const pathValue = [shimDir, productionPath, dirname(bin)].filter((entry): entry is string => entry !== undefined && entry !== "").join(delimiter);
      const hostEnv: Readonly<Record<string, string>> = { ...scenario.cliEnvironment, PATH: pathValue, CLAUDE_CONFIG_DIR: claudeDir };
      const realmHost = (words: readonly string[]): Promise<CliResult> => runCli(["host", ...words], { env: hostEnv, now: () => new Date() });
      const installed = cliJson(await realmHost(["install", HOST]), "realm host install claude");
      assert.equal(installed["status"], "installed", `the install must report installed: ${describeValue(installed)}`);
      recipe.uninstall = async () => {
        const removed = await realmHost(["uninstall", HOST]);
        assert.equal(removed.exitCode, 0, `realm host uninstall ${HOST} at cleanup: ${describeRun({ ...removed, timedOut: false })}`);
      };

      const provider = new ScriptedAnthropicProvider();
      const { baseUrl } = await provider.start();
      cleanups.add(async () => {
        await provider.stop();
      });
      const turnEnv = claudeTurnEnv(hostEnv, baseUrl, provider.apiKey);
      const startedAt = Date.now();
      const run = await runHost(bin, claudePrintArgs(), turnEnv, projectDir, scaledMs(PRODUCTION_TIMEOUT_MS));
      record("claude print mode stdout", run.stdout);
      record("claude print mode stderr", run.stderr);
      requireReturned(run, "claude print mode on the production stack");
      const messages = provider.messageRequests;
      wireLogText = existsSync(wireLog) ? readFileSync(wireLog, "utf8") : "";
      const wire = wireSummary(readWireLog(wireLog));
      const wireCalls = readWireLog(wireLog).filter((event) => event.dir === "host-to-realm" && event.method === "tools/call").length;
      diag(
        `host-driven drive: claude issued the call against a scripted provider, no credential, no real model; exit ${String(run.exitCode)} after ${String(Date.now() - startedAt)} ms; ` +
          `wire host methods [${wire.hostMethods.join(", ")}], tools [${wire.toolNames.join(", ")}], tools/call x${String(wireCalls)}; ` +
          `provider messages ${String(messages.length)}, tool results seen [${messages.map((entry) => String(entry.hasToolResult)).join(", ")}], rejected ${String(provider.rejected.length)}, proxy refusals ${String(provider.proxyRefusals.length)}, failures ${String(provider.failures.length)}`,
      );
      assert.equal(run.exitCode, 0, `claude print mode must exit 0: ${describeRun(run)}`);
      assert.ok(wire.hostMethods.includes("initialize") || wire.hostMethods.includes("server/discover"), `claude must have sent initialize or server/discover through the recorder: [${wire.hostMethods.join(", ")}]`);
      assert.ok(wire.hostMethods.includes("tools/list"), "claude must have listed the tools through the recorder");
      assert.ok(wireCalls >= 1, "claude must have sent a tools/call through the recorder");
      assert.ok(messages.length >= 2, `the provider must have seen the tool-call turn and its follow-up; saw ${String(messages.length)} Messages requests`);
      assert.equal(messages[0]?.hasToolResult, false);
      assert.equal(messages[1]?.hasToolResult, true, "the follow-up request carries the tool result");
      assert.equal(provider.rejected.length, 0);
      assert.equal(provider.proxyRefusals.length, 0, "claude made no proxy request");
      assert.deepEqual(provider.failures, []);
      record("the scripted provider requests", JSON.stringify(provider.requests));

      // A new process attached: a second attach line, and the call lines of claude's status call carry host claude and the same kid.
      calls += 1;
      const secondText = readFileSync(auditFile, "utf8");
      const secondLines = parseAuditLines(secondText);
      const secondCounts = auditCountsOf(secondLines);
      diag(`audit file after the host-driven drive: ${JSON.stringify(secondCounts)}`);
      const secondProblems = checkCapabilityAudit(secondLines, { sessionId, host: HOST, kid, calls, refusals: 1 });
      diag(`audit check after the host-driven drive (${String(calls)} calls): ${secondProblems.length === 0 ? "no problem" : secondProblems.join(" | ")}`);
      assert.deepEqual(secondProblems, [], "the whole audit file must still hold: host claude and the active kid on every call line");
      assert.equal(secondCounts.attach, 2, "the host's own realm mcp process attached once more");
      await verifySession("after the host-driven drive");
    }

    // ---- 7  The leak scan ---------------------------------------------------------------------------------------------------
    record("the audit file of the run", readFileSync(auditFile, "utf8"));
    record("the wire log", wireLogText);
    sinks.push(...sinksUnder(scenario.root, "the scenario directory"));
    const keys = keyringSecrets(keyringFile);
    diag(`leak scan: ${String(sinks.length)} sinks, the token shape and ${String(keys.secrets.length)} key texts${keys.note === undefined ? "" : ` (${keys.note})`}`);
    assert.equal(keys.note, undefined, "enforce attached, so the keyring must be readable for the key sweep");
    const leaks = leakProblems(sinks, [TOKEN_SECRET, ...keys.secrets]);
    assert.deepEqual(leaks, [], "no sink may hold a token shape or a key text");

    // ---- 8  The cleanup, then what the run left behind ----------------------------------------------------------------------
    await cleanup();
    assert.equal(fileSha256(realClaudeFile), realClaudeBefore, "the operator's real ~/.claude.json must be byte-identical after the run");
    assert.equal(fileSha256(join(driverStateDir, "policy.json")), policyBefore, "the operator's policy.json must be restored byte for byte");
    const keyringAfter = keyringFactOf(driverStateDir);
    assert.deepEqual(keyringAfter, keyringBefore, keyringBefore.present ? "a keyring that existed before the run must be byte-identical" : "a keyring the run created must be removed");
    assert.equal(existsSync(join(hostsDir, `${HOST}.receipt.json`)), false, "no receipt of the run remains");
    assert.equal(existsSync(presenceDir), presenceDirExisted, "the presence directory is as it was before the run");
    const remaining = await findDaemonPids(inputs, DAEMON_ENTRY);
    assert.ok(remaining.ok && remaining.pids.length === 0, "no daemon of the run remains");
    diag(`cleanup: keyring ${keyringBefore.present ? "left as it was" : "removed"}, policy.json restored, receipt and presence as before, real host file unchanged, no container, sandbox, daemon or workspace entry`);
  },
);

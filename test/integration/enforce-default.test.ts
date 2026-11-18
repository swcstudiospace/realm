// Every client class the repository ships, under the enforced default of capability tokens (Phase 34, ENF-02, D-34-06): each is
// driven against the real daemon in this process over the existing fakes (startRealmDaemon), over a real Unix socket, with a
// policy file that has no capabilityTokens key (and once with no policy file at all).
//
//   E1  the 18 mcp-config hosts: realm mcp --host ID answers a status call; the session audit file has one capability.attach line
//       per id and every call line carries that host and a kid; the chain verifies.
//   E2  realm acp --host ID completes one tool call over ACP stdio, with the same audit fields.
//   E3  Omp's attach, configured as src/omp/extension.ts configures it, attaches as omp and completes a call.
//   E4  the CLI commands that use the control socket without a token still work, and the keyring exists before any attach.
//   E5  an unlabelled realm mcp is refused POLICY_DENIED, the one-time diagnostic is written once, no call is admitted.
//   E6  the stale client frame (the tokenless tool request of a client from before capability tokens) is refused POLICY_DENIED.
//   E7  a labelled session whose host profile is empty has its write refused, and writes the labelled diagnostic once.
//   E8  the explicit opt-out (mode off): the same frame and the unlabelled session are admitted; no keyring, no capability line.
//   E9  no policy file at all: the daemon enforces (keyring at start, doctor item passes, the tokenless frame is refused).
//
// There is no CLI command that issues a tool call: the only senders of a tool request are the boot driver (realm mcp and realm acp,
// through createDaemonAttach) and Omp's attach (src/omp/extension.ts). A future sender needs a row here.
// Nothing here needs Podman or a credential.

import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { PassThrough } from "node:stream";
import { verifyAuditFile } from "../../src/audit/chain.js";
import { keyringPathOf } from "../../src/capability/keyring.js";
import { runCli, type CliResult, type SpawnDaemon } from "../../src/cli/main.js";
import { sendRequest, type ControlReply } from "../../src/daemon/channel.js";
import { connectDaemon } from "../../src/daemon/client.js";
import { createDaemonAttach } from "../../src/host/attach.js";
import { HOST_RUNTIMES } from "../../src/host/runtimes.js";
import { HOST_IDS, type HostId } from "../../src/host/types.js";
import { isMetricsSnapshot, type MetricsSnapshot } from "../../src/observe/metrics.js";
import type { EnvironmentLike } from "../../src/session/paths.js";
import { startRealmDaemon, type RealmDaemonFixture, type RealmDaemonOptions } from "../support/realm-daemon-fixture.js";
import { callStatus, capture, FakeSignals, frame, framesOf, toolOutcomeOf, untilPresence, untilReplyOn, type Capture } from "../support/stdio-host-harness.js";
import { boundedWait, testTimeout } from "../support/timing.js";

const IMAGE = `registry.example.com/realm/workload@sha256:${"0".repeat(64)}`;
const BOUND_MS = 5000;
const ENV: EnvironmentLike = { PATH: "/usr/bin", HOME: "/root", XDG_RUNTIME_DIR: "/run/user/0" };
// The 18 ids a stdio session may name with --host, from the runtime table, so a new host id is covered automatically.
const MCP_HOSTS: readonly HostId[] = HOST_IDS.filter((id) => HOST_RUNTIMES[id].integration === "mcp-config");
const WRITE_CALL = (id: number): string => frame(id, "tools/call", { name: "write", arguments: { path: "from-unlabelled.txt", content: "x" } });

interface World {
  readonly root: string;
  readonly stateDir: string;
  readonly fixture: RealmDaemonFixture;
  // A project directory under the root, created once and released with the world.
  project(name: string): string;
}

// One daemon on its own state directory, released when the test ends.
async function startWorld(t: TestContext, capabilityTokens: RealmDaemonOptions["capabilityTokens"]): Promise<World> {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "realm-enf-")));
  const root = join(base, "root");
  const stateDir = join(base, "state");
  mkdirSync(root, { recursive: true });
  const fixture = await startRealmDaemon({
    stateDir,
    workspace: root,
    mode: "advisory",
    ...(capabilityTokens === undefined ? {} : { capabilityTokens }),
  });
  const projects: string[] = [];
  t.after(async () => {
    for (const project of projects) {
      await fixture.release(project).catch(() => undefined);
    }
    // A daemon that admits no project (no policy file) cannot be released by down, so it is stopped in process.
    await fixture.stop().catch(() => undefined);
    await boundedWait(fixture.done, "the daemon stopping", 10_000).catch(() => undefined);
    rmSync(base, { recursive: true, force: true });
  });
  return {
    root,
    stateDir,
    fixture,
    project(name) {
      const path = join(root, name);
      mkdirSync(path, { recursive: true });
      const real = realpathSync(path);
      projects.push(real);
      return real;
    },
  };
}

// ---- One host process ---------------------------------------------------------------------------------------------------------

interface Host {
  // The --host id, or "unlabelled": the name of the presence marker directory.
  readonly label: string;
  readonly result: Promise<CliResult>;
  readonly input: PassThrough;
  readonly output: Capture;
  readonly diagnostics: Capture;
}

function bootHost(world: World, argv: readonly string[]): Host {
  const input = new PassThrough();
  const output = capture();
  const diagnostics = capture();
  const spawn: SpawnDaemon = () => ({ unref: () => undefined });
  const result = runCli(argv, {
    env: ENV,
    cwd: world.root,
    daemonEntry: join(dirname(world.stateDir), "daemon", "main.js"),
    readConfig: () => ({ image: IMAGE, stateDir: world.stateDir, workspaceRoot: world.root }),
    timeoutMs: BOUND_MS,
    spawn,
    mcpInput: input,
    mcpOutput: output.stream,
    acpInput: input,
    acpOutput: output.stream,
    diagnostics: diagnostics.stream,
    signals: new FakeSignals(),
  });
  const labelAt = argv.indexOf("--host");
  return { label: labelAt < 0 ? "unlabelled" : (argv[labelAt + 1] ?? "unlabelled"), result, input, output, diagnostics };
}

const mcpHost = (world: World, workspace: string, host?: HostId): Host =>
  bootHost(world, host === undefined ? ["mcp", "--workspace", workspace] : ["mcp", "--host", host, "--workspace", workspace]);

async function end(host: Host): Promise<CliResult> {
  host.input.end();
  const result = await boundedWait(host.result, "the host ending after stdin closed", 10_000);
  assert.equal(result.stdout, "", "stdout holds protocol frames only");
  framesOf(host.output.text());
  return result;
}

// One MCP tools/call reply, once a client was adopted: a labelled host writes a presence marker then; an unlabelled one writes
// none, so its calls are retried while the boot is pending (the local REALM_NOT_ACTIVE refusal reaches no daemon).
async function mcpCall(world: World, host: Host, id: number, request: (requestId: number) => string): Promise<Record<string, unknown>> {
  if (host.label !== "unlabelled") {
    await untilPresence(world.stateDir, host.label);
    host.input.write(request(id));
    return toolOutcomeOf(await boundedWait(untilReplyOn(host.output, id), `the reply to call ${String(id)}`, BOUND_MS));
  }
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const probeId = 1000 + attempt;
    host.input.write(request(probeId));
    const outcome = toolOutcomeOf(await boundedWait(untilReplyOn(host.output, probeId), `the reply to call ${String(id)}`, BOUND_MS));
    if (outcome["code"] !== "REALM_NOT_ACTIVE") {
      return outcome;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("the unlabelled session never left its pending boot");
}

function stateOf(outcome: unknown): unknown {
  assert.ok(typeof outcome === "object" && outcome !== null && "value" in outcome, `an outcome with a value, not ${JSON.stringify(outcome)}`);
  const { value } = outcome;
  assert.ok(typeof value === "object" && value !== null && "snapshot" in value, `a status value, not ${JSON.stringify(outcome)}`);
  const snapshot = value.snapshot;
  assert.ok(typeof snapshot === "object" && snapshot !== null && "state" in snapshot, "a snapshot");
  return snapshot.state;
}

// The diagnostics lines of the capability hint: every other diagnostic of these sessions is a JSON log line or absent.
const hintLinesOf = (host: Host): string[] => host.diagnostics.text().split("\n").filter((line) => line.startsWith("realm: "));

// ---- The daemon's own records -------------------------------------------------------------------------------------------------

function auditPathOf(world: World, project: string): string {
  return join(world.stateDir, "audit", `${world.fixture.selectionFor(project).sessionId}.jsonl`);
}

function auditLinesOf(world: World, project: string): Record<string, unknown>[] {
  const path = auditPathOf(world, project);
  return existsSync(path)
    ? readFileSync(path, "utf8")
        .split("\n")
        .filter((line) => line !== "")
        .map((line) => JSON.parse(line) as Record<string, unknown>)
    : [];
}

const attachLinesOf = (lines: readonly Record<string, unknown>[]): Record<string, unknown>[] =>
  lines.filter((line) => line["tool"] === "capability.attach");

// The admission and result lines of tool calls: the lines that carry a phase.
const callLinesOf = (lines: readonly Record<string, unknown>[]): Record<string, unknown>[] => lines.filter((line) => line["phase"] !== undefined);

async function metricsOf(world: World, project: string): Promise<MetricsSnapshot> {
  const reply = await sendRequest(
    world.fixture.socketPath,
    { id: "enf-metrics", method: "metrics", params: { selection: world.fixture.selectionFor(project) } },
    { timeoutMs: BOUND_MS },
  );
  assert.equal(reply.error, undefined);
  assert.ok(isMetricsSnapshot(reply.result));
  return reply.result;
}

// The tokenless tool request a client from before capability tokens sends: the tool and the selection, no token, no attach.
function staleFrame(world: World, project: string): Promise<ControlReply> {
  return sendRequest(
    world.fixture.socketPath,
    { id: "stale-1", method: "tool", params: { tool: { status: {} }, selection: world.fixture.selectionFor(project) } },
    { timeoutMs: BOUND_MS },
  );
}

const hasKeyring = (world: World): boolean => existsSync(keyringPathOf(world.stateDir));

// ---- E1 to E4: the default ----------------------------------------------------------------------------------------------------

void test("E1: each of the 18 mcp-config hosts attaches under the default and answers a status call; the audit lines carry its id and a kid", testTimeout(120_000), async (t) => {
  assert.equal(MCP_HOSTS.length, 18, "the runtime table names 18 mcp-config hosts");
  const world = await startWorld(t, "default");
  await world.fixture.up(world.project("anchor"));
  const project = world.project("e1");
  for (const id of MCP_HOSTS) {
    const host = mcpHost(world, project, id);
    const outcome = await mcpCall(world, host, 1, callStatus);
    assert.equal(outcome["outcome"], "done", `${id}: the call is admitted`);
    assert.equal(stateOf(outcome), "active", `${id}: the sandbox is active`);
    assert.equal(hintLinesOf(host).length, 0, `${id}: no refusal diagnostic`);
    assert.equal((await end(host)).exitCode, 0, `${id}: clean exit`);
  }
  const lines = auditLinesOf(world, project);
  const attaches = attachLinesOf(lines);
  assert.deepEqual(attaches.map((line) => line["host"]).sort(), [...MCP_HOSTS].sort(), "one attach line per id");
  for (const line of attaches) {
    assert.equal(typeof line["kid"], "string", "the attach line names the key id");
  }
  const calls = callLinesOf(lines);
  assert.equal(calls.length, MCP_HOSTS.length * 2, "an admission and a result line per call");
  for (const line of calls) {
    assert.ok(MCP_HOSTS.some((id) => id === line["host"]), `a call line carries a host id, not ${String(line["host"])}`);
    assert.equal(typeof line["kid"], "string");
  }
  assert.equal(new Set(calls.map((line) => line["host"])).size, MCP_HOSTS.length, "every host's calls are attributed to itself");
  assert.equal(verifyAuditFile(auditPathOf(world, project)).ok, true, "the audit chain verifies");
});

void test("E2: realm acp with a host flag completes one tool call over ACP stdio under the default, with the same audit fields", testTimeout(60_000), async (t) => {
  const world = await startWorld(t, "default");
  await world.fixture.up(world.project("anchor"));
  const project = world.project("e2");
  const acp = bootHost(world, ["acp", "--host", "kimi", "--workspace", project]);
  acp.input.write(frame(1, "initialize", { protocolVersion: 1 }));
  acp.input.write(frame(2, "_realm/tool", { tool: { status: {} } }));
  const reply = await boundedWait(untilReplyOn(acp.output, 2), "the ACP status call", BOUND_MS);
  const result = reply["result"];
  assert.ok(typeof result === "object" && result !== null && "outcome" in result);
  assert.equal(result.outcome, "done");
  assert.equal(stateOf(result), "active");
  assert.equal(hintLinesOf(acp).length, 0);
  assert.equal((await end(acp)).exitCode, 0);
  const lines = auditLinesOf(world, project);
  const attaches = attachLinesOf(lines);
  assert.equal(attaches.length, 1);
  assert.equal(attaches[0]?.["host"], "kimi");
  assert.equal(typeof attaches[0]["kid"], "string");
  const calls = callLinesOf(lines);
  assert.equal(calls.length, 2);
  for (const line of calls) {
    assert.equal(line["host"], "kimi");
    assert.equal(line["kid"], attaches[0]["kid"]);
  }
  assert.equal(verifyAuditFile(auditPathOf(world, project)).ok, true);
});

void test("E3: Omp's attach, configured as the extension configures it, attaches as omp and a call through it completes under the default", testTimeout(60_000), async (t) => {
  const world = await startWorld(t, "default");
  await world.fixture.up(world.project("anchor"));
  const project = world.project("e3");
  // The options of src/omp/extension.ts: connectDaemon, host omp, the verified refusal retention. Nothing is spawned: a daemon answers.
  const attach = createDaemonAttach({
    socketPath: world.fixture.socketPath,
    stateDir: world.stateDir,
    connect: connectDaemon,
    host: "omp",
    spawnDaemon: () => {
      assert.fail("the daemon already answers; Omp's attach must not spawn one");
    },
    diagnostics: { write: () => undefined },
    upBoundMs: BOUND_MS,
    pollMs: 20,
    refusalRetention: "verified",
  });
  const { client, refusal } = await boundedWait(attach(project), "Omp's attach", BOUND_MS);
  assert.equal(refusal, null);
  try {
    const outcome = await client.call({ status: {} });
    assert.equal(outcome.outcome, "done");
  } finally {
    client.close();
  }
  const lines = auditLinesOf(world, project);
  const attaches = attachLinesOf(lines);
  assert.equal(attaches.length, 1);
  assert.equal(attaches[0]?.["host"], "omp");
  for (const line of callLinesOf(lines)) {
    assert.equal(line["host"], "omp");
  }
});

void test("E4: the commands that use the control socket without a token still work under the default, the keyring exists before any attach and the doctor item passes", testTimeout(60_000), async (t) => {
  const world = await startWorld(t, "default");
  const project = world.project("e4");
  // (5) The keyring is created when the daemon starts, before any attach.
  assert.equal(hasKeyring(world), true, "the daemon created its keyring at start");
  assert.equal(statSync(keyringPathOf(world.stateDir)).mode & 0o777, 0o600);
  assert.equal(statSync(dirname(keyringPathOf(world.stateDir))).mode & 0o777, 0o700);
  assert.equal(attachLinesOf(auditLinesOf(world, project)).length, 0, "no attach has happened");

  assert.equal((await world.fixture.up(project)).error, undefined, "up (the realm up request)");
  const run = (words: readonly string[]): Promise<CliResult> =>
    runCli(words, {
      env: ENV,
      cwd: world.root,
      daemonEntry: join(dirname(world.stateDir), "daemon", "main.js"),
      readConfig: () => ({ image: IMAGE, stateDir: world.stateDir, workspaceRoot: world.root }),
      timeoutMs: BOUND_MS,
      spawn: () => ({ unref: () => undefined }),
      diagnostics: new PassThrough(),
      signals: new FakeSignals(),
    });
  const status = await run(["status", "--workspace", project]);
  assert.equal(status.exitCode, 0, status.stderr);
  assert.match(status.stdout, /"state":"active"/u);
  const metrics = await run(["metrics", "--workspace", project]);
  assert.equal(metrics.exitCode, 0, metrics.stderr);
  const doctor = await run(["doctor", "--workspace", project]);
  assert.equal(doctor.exitCode, 0, doctor.stderr);
  const checks: unknown = JSON.parse(doctor.stdout);
  assert.ok(Array.isArray(checks), "the daemon's doctor reply is the list of checks");
  const last: unknown = checks[checks.length - 1];
  assert.ok(typeof last === "object" && last !== null && "id" in last && "status" in last);
  assert.equal(last.id, "capability-tokens", "the item stays last");
  assert.equal(last.status, "pass", "a daemon with its keyring passes the capability-tokens item");

  // The status call that realm checkpoint and the liveness probe make: a client built without a host, no token.
  const probe = connectDaemon(world.fixture.socketPath, world.fixture.selectionFor(project));
  try {
    assert.equal((await probe.status()).snapshot.state, "active");
  } finally {
    probe.close();
  }
  assert.equal((await world.fixture.release(project)).error, undefined, "down (the realm down request)");
  assert.equal(attachLinesOf(auditLinesOf(world, project)).length, 0, "no status-class command attached");
});

// ---- E5 to E7: the refusals ---------------------------------------------------------------------------------------------------

void test("E5: an unlabelled realm mcp boots and lists tools; its calls are refused POLICY_DENIED, the diagnostic is written once, nothing is admitted and the workspace is unchanged", testTimeout(60_000), async (t) => {
  const world = await startWorld(t, "default");
  await world.fixture.up(world.project("anchor"));
  const project = world.project("e5");
  const host = mcpHost(world, project);
  const first = await mcpCall(world, host, 1, callStatus);
  assert.equal(first["outcome"], "refused");
  assert.equal(first["code"], "POLICY_DENIED");
  host.input.write(callStatus(2));
  const second = toolOutcomeOf(await boundedWait(untilReplyOn(host.output, 2), "the second refused call", BOUND_MS));
  assert.equal(second["code"], "POLICY_DENIED");
  host.input.write(WRITE_CALL(3));
  const written = toolOutcomeOf(await boundedWait(untilReplyOn(host.output, 3), "the refused write", BOUND_MS));
  assert.equal(written["code"], "POLICY_DENIED");

  const lines = hintLinesOf(host);
  assert.equal(lines.length, 1, "the diagnostic is written once for three refusals");
  assert.ok(lines[0]?.includes("no host id"));
  assert.ok(lines[0]?.includes("capabilityTokens.mode to off"));
  assert.equal((await end(host)).exitCode, 0);

  const snapshot = await metricsOf(world, project);
  const refused = snapshot.toolCalls.filter((row) => row.outcome === "refused" && row.code === "POLICY_DENIED").reduce((sum, row) => sum + row.count, 0);
  assert.equal(refused, 3, "the daemon counted three refused tool calls");
  assert.equal(snapshot.toolCalls.filter((row) => row.outcome === "done").length, 0, "no call was admitted");
  assert.equal(callLinesOf(auditLinesOf(world, project)).length, 0, "no admission line for a refused call");
  assert.equal(existsSync(join(project, "from-unlabelled.txt")), false, "the write had no effect");
});

void test("E6: the stale client frame is refused with exactly an id and POLICY_DENIED, and nothing is admitted", testTimeout(60_000), async (t) => {
  const world = await startWorld(t, "default");
  const project = world.project("e6");
  assert.equal((await world.fixture.up(project)).error, undefined);
  const reply = await staleFrame(world, project);
  assert.deepEqual(reply, { id: "stale-1", error: { code: "POLICY_DENIED" } });
  const snapshot = await metricsOf(world, project);
  assert.equal(snapshot.toolCalls.filter((row) => row.outcome === "done").length, 0);
  assert.ok(snapshot.toolCalls.some((row) => row.outcome === "refused" && row.code === "POLICY_DENIED"));
  assert.equal(callLinesOf(auditLinesOf(world, project)).length, 0, "zero dispatcher admissions");
  assert.equal(attachLinesOf(auditLinesOf(world, project)).length, 0);
});

void test("E7: a labelled session whose host profile is empty has its write refused POLICY_DENIED and writes the labelled diagnostic once", testTimeout(60_000), async (t) => {
  const world = await startWorld(t, { profiles: { claude: [] } });
  await world.fixture.up(world.project("anchor"));
  const project = world.project("e7");
  const host = mcpHost(world, project, "claude");
  const refused = await mcpCall(world, host, 1, WRITE_CALL);
  assert.equal(refused["outcome"], "refused");
  assert.equal(refused["code"], "POLICY_DENIED");
  host.input.write(WRITE_CALL(2));
  await boundedWait(untilReplyOn(host.output, 2), "the second refused write", BOUND_MS);
  const lines = hintLinesOf(host);
  assert.equal(lines.length, 1);
  assert.ok(lines[0]?.includes("host claude"));
  assert.ok(lines[0]?.includes("realm doctor"));
  assert.equal((await end(host)).exitCode, 0);
  assert.equal(existsSync(join(project, "from-unlabelled.txt")), false, "the workspace is unchanged");
  assert.equal(callLinesOf(auditLinesOf(world, project)).length, 0, "no write was admitted");
});

// ---- E8: the opt-out, E9: no policy file --------------------------------------------------------------------------------------

void test("E8: under an explicit mode off the tokenless frame and an unlabelled realm mcp are admitted; no keyring is created and no capability line is written", testTimeout(60_000), async (t) => {
  const world = await startWorld(t, "off");
  const anchor = world.project("anchor");
  assert.equal((await world.fixture.up(anchor)).error, undefined);
  const project = world.project("e8");
  assert.equal((await world.fixture.up(project)).error, undefined);

  const reply = await staleFrame(world, project);
  assert.equal(reply.error, undefined, "the tokenless frame is admitted");
  assert.ok(typeof reply.result === "object" && reply.result !== null);

  const host = mcpHost(world, project);
  const outcome = await mcpCall(world, host, 1, callStatus);
  assert.equal(outcome["outcome"], "done");
  assert.equal(stateOf(outcome), "active");
  assert.equal(hintLinesOf(host).length, 0);
  assert.equal((await end(host)).exitCode, 0);

  // A labelled client's attach answers mode off and the client sends no token.
  const attach = await sendRequest(
    world.fixture.socketPath,
    { id: "attach-1", method: "capability-attach", params: { selection: world.fixture.selectionFor(project), host: "claude" } },
    { timeoutMs: BOUND_MS },
  );
  assert.deepEqual(attach, { id: "attach-1", result: { mode: "off" } });
  const labelled = mcpHost(world, project, "claude");
  assert.equal((await mcpCall(world, labelled, 1, callStatus))["outcome"], "done");
  assert.equal((await end(labelled)).exitCode, 0);

  assert.equal(hasKeyring(world), false, "no keyring was created");
  assert.equal(existsSync(dirname(keyringPathOf(world.stateDir))), false, "no capability directory exists");
  const lines = auditLinesOf(world, project);
  assert.equal(attachLinesOf(lines).length, 0, "no capability line");
  assert.ok(callLinesOf(lines).length > 0, "the admitted calls are audited as before");
  assert.equal(
    callLinesOf(lines).filter((line) => line["host"] !== undefined || line["kid"] !== undefined).length,
    0,
    "a call line carries no host or key id",
  );
});

void test("E9: with no policy file at all the daemon enforces: its keyring exists before any attach, its doctor item passes and the tokenless frame is refused", testTimeout(60_000), async (t) => {
  const world = await startWorld(t, "no-policy-file");
  assert.equal(existsSync(world.fixture.policyPath), false, "no policy file was written");
  // The keyring is created at start only under enforce, and no attach has happened: the missing file loaded as the enforced default.
  assert.equal(hasKeyring(world), true, "the daemon created its keyring from the defaults");
  // The validated defaults name no workspace root, so this daemon admits no project at all (up refuses POLICY_DENIED whatever the
  // token posture): a labelled realm mcp session cannot be served by it, which is why the proof of a working session is E1 to E4 on a
  // policy file with roots and no capabilityTokens key. What a missing file proves is the posture, read through the two requests that
  // need no project.
  const project = world.project("e9");
  assert.deepEqual(await staleFrame(world, project), { id: "stale-1", error: { code: "POLICY_DENIED" } });
  const doctor = await sendRequest(world.fixture.socketPath, { id: "enf-doctor", method: "doctor" }, { timeoutMs: BOUND_MS });
  assert.equal(doctor.error, undefined);
  const checks: unknown = doctor.result;
  assert.ok(Array.isArray(checks));
  const last: unknown = checks[checks.length - 1];
  assert.ok(typeof last === "object" && last !== null && "id" in last && "status" in last);
  assert.equal(last.id, "capability-tokens");
  assert.equal(last.status, "pass");
  assert.equal(attachLinesOf(auditLinesOf(world, project)).length, 0, "no attach was needed to create the keyring");
});

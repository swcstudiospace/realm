// The write-guard suite (HARN-02; decisions D-1201, D-1202, D-1203 of phase 12).
//
// Four guard cases and one separately gated warm network case, against the built Realm plugin
// (dist/src/omp/extension.js), not the spike extension. A scripted provider emits one call, then a final text reply. The
// policy mode is written into the profile and into the daemon's policy file; nothing here relies on the default.
//
//   C1 advisory, realm inactive: the daemon answers with its realm in error, so the Realm write is forwarded and lands with the
//      advisory warning on every call; the file has the exact bytes and the write stays in the offered tool list.
//   C1b advisory, daemon down: the Realm write is refused with REALM_NOT_ACTIVE and the file is absent. C1 and C1b are authored, not run.
//   C2 fail-closed, realm down: the write is blocked with REALM_NOT_ACTIVE, the file is absent, and the provider's next
//      request carries that error.
//   C3 realm active: the write proceeds on the host. The offered tool list is recorded, not asserted; Phase 16 owns removal.
//   C4 advisory, realm down: the built-in patch-mode edit CREATE is not refused by the guard. The advisory notice shows,
//      exact bytes are created on the host at an absent path, and the provider's next request carries the successful result.
//   O2 (gated, skipped without REALM_LIVE_OMP): one session moves from advisory to fail-closed by a daemon restart and /realm-retry.
//      The offered tools follow the mode, a registered write then read reach the provider with text and digest, and a model-issued
//      bash is refused with POLICY_DENIED.
//
// The plugin reads the mode from the daemon's status, not from the policy file. C2 and C4 therefore attach while the daemon
// is up (so the explicit mode is known) and only then take the realm down, which is what makes the status unreadable. The
// daemon is listening before Omp is spawned, so ensureDaemon never starts a detached daemon (D-1203).
// C4 selects PI_EDIT_VARIANT=patch only in its Omp child. Realm read/write do not issue native hashline snapshots; CREATE
// needs no snapshot tag. These fake-backed cases prove host-path/guard behaviour, not production sandbox/audit containment.
// The separate traced warm case measures Omp network attempts with the stub port itself acting as a refusing proxy.
//
// Gate. The file skips, naming the first missing prerequisite, unless REALM_LIVE_OMP=1 and the Omp executable, its version
// and the built extension are present (ompSkipReason). A test never sets the opt-in. Waits resolve from frames; the bounds
// of D-1203 are failure bounds only.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test, { type TestContext } from "node:test";
import {
  closeWithEvidence,
  collectOmpGateInputs,
  createCleanups,
  EXTENSION_PATH,
  OMP_PROMPT_TIMEOUT_MS,
  OMP_READY_TIMEOUT_MS,
  OMP_SCENARIO_TIMEOUT_MS,
  ompBinary,
  ompSkipReason,
  parseOmpVersion,
  isRecord,
  writeEvidence,
} from "../support/omp-live.js";
import { createOmpProfile, type OmpProfile, type ProfilePolicyMode } from "../support/omp-profile.js";
import { boundedCapture, scriptedTurnProblem, startOmp, turnFailures, type OmpSession, type PromptOutcome, type ToolEnd } from "../support/omp-rpc.js";
import { startRealmDaemon, type RealmDaemonFixture } from "../support/realm-daemon-fixture.js";
import { ScriptedProvider, type ChatMessage, type ProviderTurn, type RecordedRequest, type TurnPlan } from "../support/scripted-provider.js";
import { classify, defaultAllow, externalConnects, formatOffenders, parseConnects, traceArgv, type NetAllow, type NetConnect } from "../support/net-trace.js";
import { onPath } from "../support/production-live.js";
import { sendRequest } from "../../src/daemon/channel.js";
import { selectionOf } from "../../src/daemon/client.js";
import { startDaemon } from "../../src/daemon/daemon.js";
import type { PodmanProbeResult } from "../../src/runtime/podman-probe.js";
import { FakeBridge } from "../support/fake-bridge.js";
import { FakeExecutionService } from "../support/fake-execution.js";

const ADVISORY_NOTICE = "realm status unavailable (REALM_NOT_ACTIVE); the write proceeds under advisory policy";
// The warning the daemon attaches to an advisory write while its realm is in error (decideMutation, src/core/policy.ts).
const REALM_ERROR_WARNING = "realm is error; the write proceeds under advisory policy";
const CLOCK_ISO = "2026-10-21T09:30:00.000Z";
const REALM_IMAGE = `registry.example.com/realm/workload@sha256:${"0".repeat(64)}`;
const CONTROL_TIMEOUT_MS = 5000;
const EVIDENCE_DIR_VARIABLE = "REALM_OMP_EVIDENCE_DIR";
const CLOSE_OPTIONS = { graceMs: 40_000, termMs: 20_000, killMs: 20_000 } as const;
// Two starts over one profile, each with its own frame-driven startup, prompt and bounded close.
const NETWORK_SCENARIO_TIMEOUT_MS = 1_200_000;
const COLD_REASON = "cold built-Realm warm-up; startup catalog refresh is outside the measured warm network claim";

const platform = process.platform;
const OMP_BIN = ompBinary(process.env);
const baseInputs = await collectOmpGateInputs(process.env, { platform, trace: false });
const skip: string | false = ompSkipReason(baseInputs) ?? false;
const traceSkip =
  skip ||
  (ompSkipReason(await collectOmpGateInputs(process.env, { platform, trace: true })) ?? false) ||
  (onPath("podman", process.env["PATH"]) ? false : "no podman executable on PATH; HARN-03 requires Podman even with a fake-backed daemon");
const ompVersionText = baseInputs.version.kind === "output" ? (parseOmpVersion(baseInputs.version.stdout)?.text ?? "unknown") : "unknown";

// C1 needs a daemon that answers while its realm is not active. The shared fixture's sandbox always creates, so this starts the
// real daemon over the same fakes with one container create refused: the state moves to error and the control socket still answers.
async function startInactiveRealmDaemon(options: {
  readonly stateDir: string;
  readonly workspace: string;
  readonly mode: ProfilePolicyMode;
}): Promise<{ down(): Promise<void> }> {
  const policyDir = dirname(options.stateDir);
  mkdirSync(policyDir, { recursive: true });
  const policyPath = join(policyDir, "policy.json");
  writeFileSync(policyPath, JSON.stringify({ mode: options.mode, workspaceRoots: [options.workspace] }));
  const exec = new FakeExecutionService();
  exec.failNext("create", "PODMAN_MISSING");
  const daemon = await startDaemon({
    runtimeInput: { image: REALM_IMAGE, stateDir: options.stateDir, workspaceRoot: options.workspace },
    policyPath,
    exec,
    bridge: new FakeBridge(),
    clock: () => new Date(CLOCK_ISO),
    runOpenShell: () => Promise.resolve({ exitCode: 0, stdout: "", stderr: "", truncated: false }),
    sweep: () => Promise.resolve(0),
    probe: () => Promise.resolve<PodmanProbeResult>({ ok: true, version: "5.0.0" }),
  });
  return {
    async down(): Promise<void> {
      await sendRequest(daemon.socketPath, { id: "c1-down", method: "down", params: { selection: selectionOf(options.workspace) } }, { timeoutMs: CONTROL_TIMEOUT_MS });
      await daemon.done;
    },
  };
}

interface GuardCase {
  readonly name: string;
  readonly mode: ProfilePolicyMode;
  // down: attach, then remove the realm, then make the call. inactive: the daemon answers, but its container create failed, so
  // the realm is in error while the call is made. active: the daemon stays up for the call.
  readonly realm: "down" | "inactive" | "active";
  // The tool the model calls: the Realm write, or the built-in edit.
  readonly tool: "write" | "edit";
  readonly relativePath: string;
  // How many writes the model makes, one after another. Omitted means one.
  readonly writes?: number;
}

async function runGuard(
  t: TestContext,
  spec: GuardCase,
): Promise<{ omp: OmpSession; profile: OmpProfile; outcome: PromptOutcome; requests: readonly RecordedRequest[] }> {
  t.diagnostic(`omp/${ompVersionText}`);
  const cleanups = createCleanups();
  t.after(() => cleanups.run());
  const provider = new ScriptedProvider();
  cleanups.add(() => provider.stop());
  let issued = 0;
  provider.onTurn((turn) => {
    if (turn.lastRole === "tool" && issued >= (spec.writes ?? 1)) {
      return { text: "done" };
    }
    issued += 1;
    return { call: callOf(spec) };
  });
  const { port } = await provider.start();
  const pathValue = process.env["PATH"];
  const profile = createOmpProfile({
    providerPort: port,
    refuseExternalNetwork: true,
    realm: { mode: spec.mode },
    ...(pathValue === undefined ? {} : { path: pathValue }),
  });
  cleanups.add(() => {
    profile.dispose();
  });
  if (spec.tool === "edit") {
    assert.equal(existsSync(join(profile.workspace, spec.relativePath)), false, "native CREATE requires an absent workspace file");
  }
  const daemon =
    spec.realm === "inactive"
      ? await startInactiveRealmDaemon({ stateDir: profile.stateDir, workspace: profile.workspace, mode: spec.mode })
      : await startRealmDaemon({ stateDir: profile.stateDir, workspace: profile.workspace, mode: spec.mode });
  let realmUp = true;
  cleanups.add(async () => {
    if (realmUp) {
      realmUp = false;
      await daemon.down();
    }
  });
  const tmpDir = join(profile.root, "tmp");
  mkdirSync(tmpDir);
  const omp = startOmp({
    bin: OMP_BIN,
    env: { ...profile.env, TMPDIR: tmpDir, ...(spec.tool === "edit" ? { PI_EDIT_VARIANT: "patch" } : {}) },
    cwd: profile.workspace,
    extensionPath: EXTENSION_PATH,
  });
  cleanups.add(() =>
    closeWithEvidence({
      evidenceDir: process.env[EVIDENCE_DIR_VARIABLE],
      evidence: {
        [`${spec.name}.frames.jsonl`]: () => omp.frames.map((frame) => JSON.stringify(frame)).join("\n"),
        [`${spec.name}.requests.json`]: () => boundedCapture(provider.requests),
        [`${spec.name}.proxy-refusals.json`]: () => JSON.stringify(provider.proxyRefusals, null, 1),
      },
      report: (problem) => {
        t.diagnostic(problem);
      },
      close: () => omp.close(CLOSE_OPTIONS),
    }),
  );
  await omp.ready(OMP_READY_TIMEOUT_MS);
  await omp.waitFor(
    (session) => session.status()?.includes(spec.realm === "inactive" ? "PODMAN_MISSING" : "realm active") === true,
    OMP_READY_TIMEOUT_MS,
    spec.realm === "inactive" ? "the plugin's realm error status" : "the plugin's realm active status",
  );
  if (spec.realm === "down") {
    realmUp = false;
    await daemon.down();
  }
  const outcome = await omp.prompt(`${spec.tool} ${spec.relativePath}`, OMP_PROMPT_TIMEOUT_MS);
  return { omp, profile, outcome, requests: provider.requests };
}

// The scripted call: the Realm write of the case's content, or a tag-free native patch CREATE for C4.
function callOf(spec: GuardCase): { name: string; args: Record<string, unknown> } {
  if (spec.tool === "write") {
    return { name: "write", args: { path: spec.relativePath, content: spec.name } };
  }
  return { name: "edit", args: { path: spec.relativePath, edits: [{ op: "create", diff: "c4\n" }] } };
}

function toolEndOf(outcome: PromptOutcome, tool: string): ToolEnd {
  const ends = outcome.toolEnds.filter((end) => end.toolName === tool);
  assert.equal(ends.length, 1, `${tool}: expected one tool_execution_end, got ${JSON.stringify(outcome.toolEnds.map((end) => end.toolName))}`);
  const end = ends[0];
  assert.ok(end !== undefined);
  return end;
}

void test(
  "C1: advisory with the realm inactive and the daemon reachable forwards the Realm write, which lands with the warning on every call",
  { skip, timeout: OMP_SCENARIO_TIMEOUT_MS },
  async (t) => {
    const spec: GuardCase = { name: "c1", mode: "advisory", realm: "inactive", tool: "write", relativePath: "c1.txt", writes: 2 };
    const { omp, profile, outcome, requests } = await runGuard(t, spec);
    assert.ok((requests[0]?.toolsOffered ?? []).includes("write"), "the Realm write stays in the offered tool list");
    assert.deepEqual(omp.notices(), [REALM_ERROR_WARNING, REALM_ERROR_WARNING], "the advisory warning is shown on every call");
    const ends = outcome.toolEnds.filter((end) => end.toolName === "write");
    assert.equal(ends.length, 2, "both writes reached the daemon");
    for (const end of ends) {
      assert.equal(end.isError, false, end.text);
    }
    assert.deepEqual(readFileSync(join(profile.workspace, spec.relativePath)), Buffer.from(spec.name));
  },
);

void test(
  "C1b: advisory with the daemon unreachable refuses the Realm write with REALM_NOT_ACTIVE and creates no file",
  { skip, timeout: OMP_SCENARIO_TIMEOUT_MS },
  async (t) => {
    const spec: GuardCase = { name: "c1b", mode: "advisory", realm: "down", tool: "write", relativePath: "c1b.txt" };
    const { omp, profile, outcome } = await runGuard(t, spec);
    const end = toolEndOf(outcome, "write");
    assert.equal(end.isError, true);
    assert.match(end.text, /REALM_NOT_ACTIVE/);
    assert.equal(existsSync(join(profile.workspace, spec.relativePath)), false);
    assert.deepEqual(omp.notices(), [], "the refused write carries no warning");
  },
);

void test(
  "C2: fail-closed with the realm down blocks the write with REALM_NOT_ACTIVE and the next request carries the error",
  { skip, timeout: OMP_SCENARIO_TIMEOUT_MS },
  async (t) => {
    const spec: GuardCase = { name: "c2", mode: "fail-closed", realm: "down", tool: "write", relativePath: "c2.txt" };
    const { omp, profile, outcome, requests } = await runGuard(t, spec);
    assert.equal(omp.notices().includes(ADVISORY_NOTICE), false);
    const end = toolEndOf(outcome, "write");
    assert.equal(end.isError, true);
    assert.match(end.text, /REALM_NOT_ACTIVE/);
    assert.equal(existsSync(join(profile.workspace, spec.relativePath)), false);
    const carried = requests.find((request) => request.toolResultText?.includes("REALM_NOT_ACTIVE") === true);
    assert.ok(carried !== undefined, "the provider's next request did not carry REALM_NOT_ACTIVE");
  },
);

void test(
  "C3: with the realm active the write proceeds on the host; the offered tool list is the Phase 16 baseline",
  { skip, timeout: OMP_SCENARIO_TIMEOUT_MS },
  async (t) => {
    const spec: GuardCase = { name: "c3", mode: "fail-closed", realm: "active", tool: "write", relativePath: "c3.txt" };
    const { profile, outcome, requests } = await runGuard(t, spec);
    const offered = requests[0]?.toolsOffered ?? [];
    t.diagnostic(`offered tools: ${[...offered].sort().join(", ")}`);
    const end = toolEndOf(outcome, "write");
    assert.equal(end.isError, false, end.text);
    assert.equal(readFileSync(join(profile.workspace, spec.relativePath), "utf8"), spec.name);
  },
);

void test(
  "C4: advisory with the realm down permits native patch CREATE on the host and forwards its successful result",
  { skip, timeout: OMP_SCENARIO_TIMEOUT_MS },
  async (t) => {
    const spec: GuardCase = { name: "c4", mode: "advisory", realm: "down", tool: "edit", relativePath: "c4-created.txt" };
    const { omp, profile, outcome, requests } = await runGuard(t, spec);
    assert.deepEqual(omp.notices(), [ADVISORY_NOTICE]);
    const end = toolEndOf(outcome, "edit");
    t.diagnostic(`edit result: ${end.text}`);
    assert.equal(end.isError, false, end.text);
    assert.deepEqual(readFileSync(join(profile.workspace, spec.relativePath)), Buffer.from("c4\n"));
    assert.ok(end.text.length > 0, "native CREATE must report a successful tool result");
    const nextRequest = requests[1];
    assert.ok(nextRequest !== undefined, "the provider must receive the native edit result in its next request");
    assert.equal(nextRequest.lastRole, "tool");
    const carried = nextRequest.toolResults.find((result) => result.toolCallId === end.toolCallId);
    assert.ok(carried !== undefined, "the provider's next request must carry the result of the edit's own tool call");
    assert.equal(carried.text, end.text, "the provider's next request must carry the successful native edit result");
  },
);

// ---- O2 (OMPX-02, OMPX-03, OMPX-04): one session that moves from advisory to fail-closed ------------------------------------

const T3_ADVISORY_PROMPT = "t3-advisory-write-then-read";
const T3_FAIL_CLOSED_PROMPT = "t3-fail-closed-bash";
const T3_PATH = "t3.txt";
const T3_CONTENT = "t3 registered write\nUTF-8: λ\n";
const T3_SHA = createHash("sha256").update(T3_CONTENT).digest("hex");
const T3_READ_LIMIT = 4096;
const T3_BASH_FILE = "t3-bash-denied.txt";
// What fail-closed offers: the five Realm tools, the read-only built-ins, and bash, which the guard refuses. Sorted.
const FAIL_CLOSED_OFFERED = ["ask", "bash", "exec", "glob", "grep", "list", "read", "status", "todo", "wait", "write"];

// The scripted turns of the case. An advisory prompt issues a registered write, then a registered read, then text. A fail-closed
// prompt issues a model-issued bash, then text. Calls are counted from the last user message, so each prompt answers its own calls.
function t3Turn(turn: ProviderTurn): TurnPlan {
  const answered = toolRoundsSinceUser(turn.messages);
  if (turn.userText.includes(T3_ADVISORY_PROMPT)) {
    if (answered === 0) {
      return { call: { name: "write", args: { path: T3_PATH, content: T3_CONTENT } } };
    }
    if (answered === 1) {
      return { call: { name: "read", args: { path: T3_PATH, maxBytes: T3_READ_LIMIT } } };
    }
    return { text: "advisory done" };
  }
  if (turn.userText.includes(T3_FAIL_CLOSED_PROMPT)) {
    if (answered === 0) {
      return { call: { name: "bash", args: { command: `echo denied > ${T3_BASH_FILE}` } } };
    }
    return { text: "fail-closed done" };
  }
  return { text: "ack" };
}

// How many tool results follow the last user message: the calls already answered in this prompt.
function toolRoundsSinceUser(messages: readonly ChatMessage[]): number {
  let rounds = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const role = messages[index]?.role;
    if (role === "user") {
      break;
    }
    if (role === "tool") {
      rounds += 1;
    }
  }
  return rounds;
}

// The details the daemon's outcome carries in the frame, beside the text the model reads.
function detailsOf(end: ToolEnd): unknown {
  const result = end.frame["result"];
  assert.ok(isRecord(result));
  return result["details"];
}

void test(
  "O2 advisory to fail-closed in one session: the offered tools follow the mode, a registered write and read reach the provider with text and digest, and a model bash is POLICY_DENIED",
  { skip, timeout: OMP_SCENARIO_TIMEOUT_MS },
  async (t) => {
    t.diagnostic(`omp/${ompVersionText}; fake-backed daemon and scripted provider, not production containment`);
    const cleanups = createCleanups();
    t.after(() => cleanups.run());
    const provider = new ScriptedProvider();
    cleanups.add(() => provider.stop());
    provider.onTurn(t3Turn);
    const { port } = await provider.start();
    const pathValue = process.env["PATH"];
    const profile = createOmpProfile({
      providerPort: port,
      refuseExternalNetwork: true,
      realm: { mode: "advisory" },
      ...(pathValue === undefined ? {} : { path: pathValue }),
    });
    cleanups.add(() => {
      profile.dispose();
    });
    // The daemon reads its mode from its policy file at start, so a mode change is a restart over the same state directory.
    const realm: { daemon: RealmDaemonFixture | undefined } = {
      daemon: await startRealmDaemon({ stateDir: profile.stateDir, workspace: profile.workspace, mode: "advisory" }),
    };
    cleanups.add(async () => {
      await realm.daemon?.down();
    });
    const tmpDir = join(profile.root, "tmp");
    mkdirSync(tmpDir);
    const omp = startOmp({
      bin: OMP_BIN,
      env: { ...profile.env, TMPDIR: tmpDir, PI_EDIT_VARIANT: "patch" },
      cwd: profile.workspace,
      extensionPath: EXTENSION_PATH,
    });
    // Captures are bounded and credential-free: boundedCapture strips authorization, api-key, token and secret fields.
    const captured: { schemas: Record<string, unknown>; results: Record<string, unknown> } = { schemas: {}, results: {} };
    cleanups.add(() =>
      closeWithEvidence({
        evidenceDir: process.env[EVIDENCE_DIR_VARIABLE],
        evidence: {
          "o2-advisory-to-fail-closed.frames.json": () => boundedCapture(omp.frames),
          "o2-advisory-to-fail-closed.requests.json": () => boundedCapture(provider.requests),
          "o2-advisory-to-fail-closed.tool-schemas.json": () => boundedCapture(captured.schemas),
          "o2-advisory-to-fail-closed.tool-results.json": () => boundedCapture(captured.results),
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
      "the plugin's realm active status (advisory)",
    );

    // Advisory: the built-in edit and bash are offered, and the registered write then read run through the daemon.
    const advisoryMark = provider.requests.length;
    const advisory = await omp.prompt(T3_ADVISORY_PROMPT, OMP_PROMPT_TIMEOUT_MS);
    const advisoryRequests = provider.requests.slice(advisoryMark);
    assert.equal(scriptedTurnProblem({ prompt: T3_ADVISORY_PROMPT, requests: advisoryRequests, frames: advisory.frames }), undefined);
    assert.equal(advisoryRequests.length, 3, "a write, a read and the final text: three provider requests");
    const advisoryOffered = advisoryRequests[0]?.toolsOffered ?? [];
    assert.ok(advisoryOffered.includes("edit") && advisoryOffered.includes("bash"), "advisory keeps the built-in edit and bash offered");
    captured.schemas["advisory"] = advisoryRequests[0]?.toolSchemas;

    const writeEnd = toolEndOf(advisory, "write");
    assert.equal(writeEnd.isError, false, writeEnd.text);
    const writeResult = { outcome: "done", tool: "write", value: { sha256: T3_SHA, bytes: Buffer.byteLength(T3_CONTENT), warning: null } };
    assert.deepEqual(JSON.parse(writeEnd.text), writeResult, "the registered write reports its digest and byte count");
    assert.deepEqual(readFileSync(join(profile.workspace, T3_PATH)), Buffer.from(T3_CONTENT), "the registered write created the exact bytes");
    const readEnd = toolEndOf(advisory, "read");
    assert.equal(readEnd.isError, false, readEnd.text);
    assert.ok(readEnd.text.startsWith(T3_CONTENT) && readEnd.text.includes(T3_SHA), "the registered read returns the text and its digest");
    assert.deepEqual(detailsOf(readEnd), {
      outcome: "done",
      tool: "read",
      value: { status: "found", sha256: T3_SHA, truncated: false, bytes: Buffer.byteLength(T3_CONTENT) },
    });
    const afterWrite = advisoryRequests[1];
    const afterRead = advisoryRequests[2];
    assert.ok(afterWrite !== undefined && afterRead !== undefined, "the provider received the write and the read results");
    const carriedWrite = afterWrite.toolResults.find((result) => result.toolCallId === writeEnd.toolCallId);
    assert.ok(carriedWrite !== undefined, "the provider's next request carries the result of the write's own call");
    assert.equal(carriedWrite.text, writeEnd.text);
    assert.deepEqual(carriedWrite.json, writeResult, "the write result reaches the provider with its digest and byte count");
    const carriedRead = afterRead.toolResults.find((result) => result.toolCallId === readEnd.toolCallId);
    assert.ok(carriedRead !== undefined, "the provider's next request carries the result of the read's own call");
    assert.equal(carriedRead.text, readEnd.text);
    assert.ok(carriedRead.digests.includes(T3_SHA), "the read result reaches the provider with the file digest");
    captured.results["write"] = writeEnd.text;
    captured.results["read"] = readEnd.text;

    // Advisory to fail-closed: the daemon goes down, and the plugin shows the loss on its own status poll. The daemon restarts
    // with the fail-closed policy, and /realm-retry re-attaches the plugin through its existing attach path.
    const downed = realm.daemon;
    realm.daemon = undefined;
    await downed?.down();
    await omp.waitFor(
      (session) => {
        const status = session.status();
        return status !== undefined && !status.includes("realm active");
      },
      OMP_READY_TIMEOUT_MS,
      "the plugin's status once the daemon is down",
    );
    realm.daemon = await startRealmDaemon({ stateDir: profile.stateDir, workspace: profile.workspace, mode: "fail-closed" });
    const daemonStatus = await realm.daemon.status();
    assert.equal(isRecord(daemonStatus.result) ? daemonStatus.result["mode"] : undefined, "fail-closed", "the daemon's own status reports fail-closed");
    await omp.prompt("/realm-retry", OMP_PROMPT_TIMEOUT_MS);
    await omp.waitFor(
      (session) => session.status()?.includes("realm active") === true,
      OMP_READY_TIMEOUT_MS,
      "the plugin's realm active status after the re-attach",
    );

    // Fail-closed: the offered set is the Realm tools, the read-only built-ins and bash. A model-issued bash is refused by the guard.
    const failClosedMark = provider.requests.length;
    const failClosed = await omp.prompt(T3_FAIL_CLOSED_PROMPT, OMP_PROMPT_TIMEOUT_MS);
    const failClosedRequests = provider.requests.slice(failClosedMark);
    assert.equal(scriptedTurnProblem({ prompt: T3_FAIL_CLOSED_PROMPT, requests: failClosedRequests, frames: failClosed.frames }), undefined);
    assert.equal(failClosedRequests.length, 2, "a bash call and its final text: two provider requests");
    const failClosedOffered = [...(failClosedRequests[0]?.toolsOffered ?? [])].sort();
    assert.deepEqual(failClosedOffered, FAIL_CLOSED_OFFERED, "fail-closed offers the Realm tools, the read-only built-ins and bash, and no edit");
    captured.schemas["failClosed"] = failClosedRequests[0]?.toolSchemas;
    const bashEnd = toolEndOf(failClosed, "bash");
    assert.equal(bashEnd.isError, true, bashEnd.text);
    assert.match(bashEnd.text, /POLICY_DENIED/, "the model-issued bash is refused with the catalogue code");
    assert.doesNotMatch(bashEnd.text, /Tool bash not found/, "the refusal is not Omp's native removal text");
    assert.equal(existsSync(join(profile.workspace, T3_BASH_FILE)), false, "the refused bash never ran");
    const afterBash = failClosedRequests[1];
    assert.ok(afterBash !== undefined, "the provider received the bash result");
    const carriedBash = afterBash.toolResults.find((result) => result.toolCallId === bashEnd.toolCallId);
    assert.ok(carriedBash !== undefined, "the provider's next request carries the result of the bash call");
    assert.match(carriedBash.text, /POLICY_DENIED/);
    captured.results["bash"] = bashEnd.text;
  },
);

interface GuardTraceSummary {
  readonly offenders: readonly NetConnect[];
  readonly external: number;
  readonly dns: number;
  readonly loopbackPorts: readonly number[];
}

function guardTraceSummary(trace: string, allow: NetAllow): GuardTraceSummary {
  const connects = parseConnects(trace);
  return {
    offenders: externalConnects(trace, allow),
    external: connects.filter((connect) => classify(connect) === "external").length,
    dns: connects.filter((connect) => classify(connect) === "dns").length,
    loopbackPorts: [...new Set(connects.filter((connect) => classify(connect) === "loopback").map((connect) => connect.port ?? 0))].sort((a, b) => a - b),
  };
}

// One real Omp start, built extension and registered write, not a text-only or spike-tool substitute.
// The unique per-run target and Realm result metadata distinguish execution from merely issuing a write.
async function tracedRealmWrite(
  t: TestContext,
  provider: ScriptedProvider,
  profile: OmpProfile,
  label: "cold" | "warm",
  allow: NetAllow,
): Promise<GuardTraceSummary> {
  const relativePath = `built-realm-${label}.txt`;
  const content = `registered Realm write: ${label}\nUTF-8: λ\n`;
  const prompt = `built-realm-${label}-registered-write`;
  const call = { name: "write", args: { path: relativePath, content } };
  assert.equal(existsSync(join(profile.workspace, relativePath)), false, "each traced write begins with an absent target");
  // Omp owns its enriched user context. Bind this script to this run's request window and actual tool execution, not prompt bytes.
  const script: { phase: "issue" | "continuation" | "done" } = { phase: "issue" };
  provider.onTurn((turn) => {
    switch (script.phase) {
      case "issue":
        script.phase = "continuation";
        return { call };
      case "continuation":
        assert.equal(turn.lastRole, "tool", "the second request must carry this run's tool result");
        script.phase = "done";
        return { text: "done" };
      case "done":
        throw new Error("the registered-write script received an unexpected extra provider turn");
    }
  });
  const requestsBefore = provider.requests.length;
  const failuresBefore = provider.failures.length;
  const refusalsBefore = provider.proxyRefusals.length;
  const traceFile = join(profile.root, `built-realm-${label}.strace`);
  const tmpDir = join(profile.root, "tmp");
  mkdirSync(tmpDir, { recursive: true });
  const omp = startOmp({
    bin: OMP_BIN,
    env: { ...profile.env, TMPDIR: tmpDir },
    cwd: profile.workspace,
    extensionPath: EXTENSION_PATH,
    wrap: traceArgv(traceFile),
  });
  let turnProven = false;
  let processClosed = false;
  try {
    await omp.ready(OMP_READY_TIMEOUT_MS);
    await omp.waitFor(
      (session) => session.status()?.includes("realm active") === true,
      OMP_READY_TIMEOUT_MS,
      "the built plugin's active status before the traced write",
    );
    const outcome = await omp.prompt(prompt, label === "cold" ? OMP_READY_TIMEOUT_MS : OMP_PROMPT_TIMEOUT_MS);
    const requests = provider.requests.slice(requestsBefore);
    assert.deepEqual(turnFailures(outcome.frames), [], "the registered-write exchange must contain no failed or aborted turn");
    assert.ok(
      outcome.frames.some((frame) => frame["type"] === "turn_end" && isRecord(frame["message"]) && frame["message"]["stopReason"] === "stop"),
      "the final provider continuation must end with stopReason stop",
    );
    assert.equal(script.phase, "done", "this run must complete its issue and continuation phases");
    assert.deepEqual(provider.failures.slice(failuresBefore), [], "proxy refusals must not poison normal provider turns");
    assert.equal(requests.length, 2, "the same measured call requires one issue and one provider continuation");
    const issued = requests[0];
    assert.ok(issued !== undefined);
    assert.ok(issued.toolsOffered.includes("write"), "the registered write was offered to the provider");
    assert.deepEqual(issued.plan, { call });
    assert.equal(outcome.toolStarts.length, 1);
    const start = outcome.toolStarts[0];
    assert.ok(start !== undefined);
    assert.equal(start.toolName, "write");
    assert.deepEqual(start.args, call.args);
    assert.equal(outcome.toolEnds.length, 1);
    const end = toolEndOf(outcome, "write");
    assert.equal(end.toolCallId, start.toolCallId);
    assert.equal(end.isError, false, end.text);
    const expected = {
      outcome: "done",
      tool: "write",
      value: { sha256: createHash("sha256").update(content).digest("hex"), bytes: Buffer.byteLength(content), warning: null },
    };
    // src/omp/tools.ts returns the daemon outcome as both JSON content and details. Native write cannot satisfy this.
    assert.deepEqual(JSON.parse(end.text), expected, "the built Realm adapter executed the daemon write");
    const result = end.frame["result"];
    assert.ok(isRecord(result));
    assert.deepEqual(result["details"], expected, "RPC success must carry the registered Realm outcome");
    assert.deepEqual(readFileSync(join(profile.workspace, relativePath)), Buffer.from(content), "the measured call created the exact workspace bytes");
    const continued = requests[1];
    assert.ok(continued !== undefined);
    assert.equal(continued.lastRole, "tool");
    assert.equal(continued.toolResultText, end.text, "the same successful registered-write result reached the provider");
    assert.deepEqual(continued.plan, { text: "done" });
    turnProven = true;
  } finally {
    try {
      await omp.close(CLOSE_OPTIONS);
      processClosed = true;
    } finally {
      // Save after close, including on assertion/startup/close failure, so the raw trace covers the whole measured process.
      for (const problem of writeEvidence(process.env[EVIDENCE_DIR_VARIABLE], {
        [`built-realm-${label}.version.txt`]: () => ompVersionText,
        [`built-realm-${label}.strace`]: () => readFileSync(traceFile, "utf8"),
        [`built-realm-${label}.frames.jsonl`]: () => omp.frames.map((frame) => JSON.stringify(frame)).join("\n"),
        [`built-realm-${label}.stderr.txt`]: () => omp.stderr(),
        [`built-realm-${label}.requests.json`]: () => boundedCapture(provider.requests.slice(requestsBefore)),
        [`built-realm-${label}.provider-failures.json`]: () => JSON.stringify(provider.failures.slice(failuresBefore), null, 1),
        [`built-realm-${label}.proxy-refusals.json`]: () => JSON.stringify(provider.proxyRefusals.slice(refusalsBefore), null, 1),
        [`built-realm-${label}.summary.json`]: () => JSON.stringify({
          ompVersion: ompVersionText,
          extensionPath: EXTENSION_PATH,
          scope: "fake-backed built-Realm guard/network proof, not production containment",
          status: turnProven && processClosed ? (label === "cold" ? "skipped" : "measured; assertions determine result") : "failed",
          ...(label === "cold" && turnProven && processClosed ? { reason: COLD_REASON } : {}),
          scriptPhase: script.phase,
          turnProven,
          processClosed,
          prompt,
          call,
          allow,
          ...guardTraceSummary(readFileSync(traceFile, "utf8"), allow),
        }, null, 1),
      })) {
        t.diagnostic(problem);
      }
    }
  }
  return guardTraceSummary(readFileSync(traceFile, "utf8"), allow);
}

void test(
  "built Realm warm registered-write guard/network proof: only the stub and three discovery ports, zero external/DNS/offenders (HARN-03)",
  { skip: traceSkip, timeout: NETWORK_SCENARIO_TIMEOUT_MS },
  async (t) => {
    t.diagnostic(`omp/${ompVersionText}; built extension ${EXTENSION_PATH}; fake-backed daemon, not production containment`);
    const cleanups = createCleanups();
    t.after(() => cleanups.run());
    const provider = new ScriptedProvider();
    cleanups.add(() => provider.stop());
    const { port } = await provider.start();
    const pathValue = process.env["PATH"];
    const profile = createOmpProfile({
      providerPort: port,
      refuseExternalNetwork: true,
      realm: { mode: "fail-closed" },
      ...(pathValue === undefined ? {} : { path: pathValue }),
    });
    cleanups.add(() => {
      profile.dispose();
    });
    const daemon = await startRealmDaemon({ stateDir: profile.stateDir, workspace: profile.workspace, mode: "fail-closed" });
    cleanups.add(() => daemon.down());
    // Literal HARN-03 allowlist, unchanged: no additional proxy port and no DNS/external exemptions.
    const allow = defaultAllow(port);
    let warmed = false;
    await t.test("cold built-Realm profile: catalog warm-up is separately skipped, never warm evidence", async (cold) => {
      const summary = await tracedRealmWrite(cold, provider, profile, "cold", allow);
      warmed = true;
      cold.diagnostic(`cold: ${String(summary.external)} external, ${String(summary.dns)} DNS, ${String(summary.offenders.length)} offenders`);
      cold.skip(COLD_REASON);
    });
    await t.test("same profile warm: registered write succeeds with zero external, zero DNS and zero offenders", async (warm) => {
      assert.ok(warmed, "the cold run must have completed before the warm measurement");
      const summary = await tracedRealmWrite(warm, provider, profile, "warm", allow);
      warm.diagnostic(`warm: ${String(summary.external)} external, ${String(summary.dns)} DNS; loopback ports ${summary.loopbackPorts.join(",")}`);
      assert.equal(summary.offenders.length, 0, formatOffenders(summary.offenders));
      assert.equal(summary.external, 0, "no external peer is exempt");
      assert.equal(summary.dns, 0, "no resolver is exempt");
      assert.deepEqual(summary.loopbackPorts.filter((candidate) => !allow.loopbackPorts.includes(candidate)), []);
      assert.ok(summary.loopbackPorts.includes(port), "this measured registered-write turn reached the scripted stub");
    });
  },
);

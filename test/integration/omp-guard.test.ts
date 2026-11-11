// The write-guard suite (HARN-02; decisions D-1201, D-1202, D-1203 of phase 12).
//
// Four guard cases, separate unreachable/filesystem negatives, and a separately gated warm network case,
// against the built Realm plugin (dist/src/omp/extension.js), not the spike extension. Each invocation
// has its own scripted call and actual HTTP tool-result continuation, with explicit profile/daemon policy.
//
//   C1 reachable error, advisory: TWO registered writes in the SAME Omp child each notify, write exact
//      host bytes, and return the metadata-only Realm outcome to the provider. A missing-parent negative
//      separately proves that advisory policy does not turn a real filesystem refusal into success.
//   C2 reachable error, fail-closed: REALM_NOT_ACTIVE, no host file, actual provider error continuation.
//   C3 active: the registered write succeeds on the host; offered tools remain a recorded baseline.
//   C4 unreachable, advisory: native patch-mode edit CREATE retains its distinct unavailable-status notice,
//      exact host bytes and successful provider continuation. Only this child gets PI_EDIT_VARIANT=patch.
//   Unreachable registered writes in BOTH modes refuse/no file; old C1/C2 receipts belong to this negative.
//
// C1/C2 attach while active, then the fixture drives the public fake execution health port unhealthy and
// calls the REAL controller probe. The daemon stays bound/listening in error ("probe failed"), NOT down
// or unbound. Real status replies, local controller snapshots and a synchronous transition subscription
// establish the state/mode before, during and after each guarded exchange, including its actual tool start.
// The daemon is listening before Omp starts, preventing a detached ensureDaemon spawn (D-1203).
// C4 CREATE needs no hashline snapshot tag. These fake-runtime cases prove the real host-path/guard
// behavior, NOT production sandbox containment.
// The separate traced warm case measures Omp network attempts with the stub port itself acting as a refusing proxy.
//
// Gate. The file skips, naming the first missing prerequisite, unless REALM_LIVE_OMP=1 and the Omp executable, its version
// and the built extension are present (ompSkipReason). A test never sets the opt-in. Waits resolve from frames; the bounds
// of D-1203 are failure bounds only.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
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
import { startOmp, turnFailures, type OmpSession, type PromptOutcome, type ToolEnd } from "../support/omp-rpc.js";
import { startRealmDaemon } from "../support/realm-daemon-fixture.js";
import { ScriptedProvider, type RecordedRequest } from "../support/scripted-provider.js";
import { classify, defaultAllow, externalConnects, formatOffenders, parseConnects, traceArgv, type NetAllow, type NetConnect } from "../support/net-trace.js";
import { onPath } from "../support/production-live.js";

const ADVISORY_NOTICE = "realm status unavailable (REALM_NOT_ACTIVE); the write proceeds under advisory policy";
const INACTIVE_ADVISORY_NOTICE = "realm is error; the write proceeds under advisory policy";
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

interface GuardCase {
  readonly name: string;
  readonly mode: ProfilePolicyMode;
  // inactive: reachable controller error; down: attach then remove listener/socket; active: unchanged.
  readonly realm: "inactive" | "down" | "active";
  // The tool the model calls: the Realm write, or the built-in edit.
  readonly tool: "write" | "edit";
  readonly relativePath: string;
}

interface GuardInvocation {
  readonly outcome: PromptOutcome;
  readonly requests: readonly RecordedRequest[];
  readonly notices: readonly string[];
}

async function runGuard(
  t: TestContext,
  spec: GuardCase,
): Promise<{
  omp: OmpSession;
  profile: OmpProfile;
  invoke(relativePath?: string, content?: string): Promise<GuardInvocation>;
}> {
  t.diagnostic(`omp/${ompVersionText}`);
  const cleanups = createCleanups();
  t.after(() => cleanups.run());
  const provider = new ScriptedProvider();
  cleanups.add(() => provider.stop());
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
  const daemon = await startRealmDaemon({ stateDir: profile.stateDir, workspace: profile.workspace, mode: spec.mode });
  let realmUp = true;
  cleanups.add(async () => {
    if (realmUp) {
      realmUp = false;
      await daemon.down();
    }
  });
  const observations: unknown[] = [];
  const transitions: unknown[] = [];
  const expectedState = spec.realm === "inactive" ? "error" : "active";
  const assertSnapshot = (): void => {
    const snapshot = daemon.handle.controller.snapshot();
    assert.equal(snapshot.state, expectedState);
    if (expectedState === "error") {
      assert.equal(snapshot.reason, "probe failed", "health failure, not stop()/unbound, must establish the inactive realm");
    }
    assert.equal(daemon.handle.policyMode, spec.mode);
  };
  const observeReachable = async (phase: string): Promise<void> => {
    const reply = await daemon.status();
    assert.equal(reply.error, undefined, `${phase}: the REAL daemon must answer the control channel`);
    assert.ok(isRecord(reply.result));
    assert.equal(reply.result["mode"], spec.mode, `${phase}: require explicit daemon policy, not a cached default`);
    assertSnapshot();
    assert.deepEqual(reply.result["snapshot"], daemon.handle.controller.snapshot(), `${phase}: wire and independent controller snapshots agree`);
    assert.equal(existsSync(daemon.socketPath), true);
    observations.push({ phase, reply, snapshot: daemon.handle.controller.snapshot(), mode: daemon.handle.policyMode });
  };
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
        [`${spec.name}.requests.json`]: () => JSON.stringify(provider.requests, null, 1),
        [`${spec.name}.provider-failures.json`]: () => JSON.stringify(provider.failures, null, 1),
        [`${spec.name}.proxy-refusals.json`]: () => JSON.stringify(provider.proxyRefusals, null, 1),
        [`${spec.name}.states.json`]: () => JSON.stringify(observations, null, 1),
        [`${spec.name}.transitions.json`]: () => JSON.stringify(transitions, null, 1),
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
  if (spec.realm === "down") {
    realmUp = false;
    await daemon.down();
    assert.equal(existsSync(daemon.socketPath), false, "the unreachable negative removes the actual socket");
    await assert.rejects(daemon.status(), "the unreachable negative must not have a replying status server");
  } else {
    if (spec.realm === "inactive") {
      const snapshot = await daemon.failHealthProbe();
      assert.equal(snapshot.state, "error");
      assert.equal(snapshot.reason, "probe failed");
    }
    await observeReachable("fixture-ready");
  }
  let invocation = 0;
  return {
    omp,
    profile,
    async invoke(relativePath = spec.relativePath, content = spec.name): Promise<GuardInvocation> {
      invocation += 1;
      const label = `${spec.name}-${String(invocation)}`;
      const call = callOf(spec, relativePath, content);
      const requestsBefore = provider.requests.length;
      const noticesBefore = omp.notices().length;
      const failuresBefore = provider.failures.length;
      const startsBefore = omp.toolStarts().length;
      const transitionsBefore = transitions.length;
      // Synchronous lifecycle events rule out even a transient return to active during a fast write.
      // No method is replaced: the registered call still crosses the real daemon/dispatcher/gate/fs.
      const unsubscribe = daemon.handle.controller.events.subscribe((event) => {
        transitions.push({ invocation: label, event });
      });
      const script: { phase: "issue" | "continuation" | "done" } = { phase: "issue" };
      provider.onTurn(async (turn) => {
        if (spec.realm !== "down") {
          await observeReachable(`${label}-during-provider-${script.phase}`);
        }
        switch (script.phase) {
          case "issue":
            assert.ok(turn.toolsOffered.includes(spec.tool), `the provider must be offered ${spec.tool}`);
            script.phase = "continuation";
            return { call };
          case "continuation":
            assert.equal(turn.lastRole, "tool", "the next actual HTTP request must carry the tool result");
            script.phase = "done";
            return { text: "done" };
          case "done":
            throw new Error(`${label}: unexpected extra provider request`);
        }
      });
      try {
        if (spec.realm !== "down") {
          await observeReachable(`${label}-before`);
        }
        const started = omp.waitFor(
          (session) => session.toolStarts().length > startsBefore,
          OMP_PROMPT_TIMEOUT_MS,
          `${label}: actual registered/native tool start`,
        ).then(() => {
          if (spec.realm !== "down") {
            assertSnapshot();
            observations.push({ phase: `${label}-during-tool-start`, snapshot: daemon.handle.controller.snapshot(), mode: daemon.handle.policyMode });
          }
        });
        const [outcome] = await Promise.all([omp.prompt(`${spec.tool} ${relativePath}`, OMP_PROMPT_TIMEOUT_MS), started]);
        if (spec.realm !== "down") {
          await observeReachable(`${label}-after`);
          assert.equal(transitions.length, transitionsBefore, "the realm must stay in the observed state throughout this invocation");
        }
        const requests = provider.requests.slice(requestsBefore);
        assert.equal(script.phase, "done");
        assert.deepEqual(provider.failures.slice(failuresBefore), []);
        assert.deepEqual(turnFailures(outcome.frames), []);
        assert.ok(outcome.frames.some((frame) => frame["type"] === "turn_end" && isRecord(frame["message"]) && frame["message"]["stopReason"] === "stop"));
        assert.equal(requests.length, 2, "each invocation needs its own issue and actual provider continuation");
        assert.deepEqual(requests[0]?.plan, { call });
        assert.equal(outcome.toolStarts.length, 1);
        const start = outcome.toolStarts[0];
        assert.ok(start !== undefined);
        assert.equal(start.toolName, spec.tool);
        assert.deepEqual(start.args, call.args);
        const end = toolEndOf(outcome, spec.tool);
        assert.equal(end.toolCallId, start.toolCallId);
        assert.equal(requests[1]?.lastRole, "tool");
        assert.equal(requests[1]?.toolResultText, end.text, "the next provider request must carry THIS invocation's actual tool result");
        assert.deepEqual(requests[1]?.plan, { text: "done" });
        return { outcome, requests, notices: omp.notices().slice(noticesBefore) };
      } finally {
        unsubscribe();
      }
    },
  };
}

// The scripted call: the Realm write of the case's content, or a tag-free native patch CREATE for C4.
function callOf(spec: GuardCase, relativePath = spec.relativePath, content = spec.name): { name: string; args: Record<string, unknown> } {
  if (spec.tool === "write") {
    return { name: "write", args: { path: relativePath, content } };
  }
  return { name: "edit", args: { path: relativePath, edits: [{ op: "create", diff: "c4\n" }] } };
}

function toolEndOf(outcome: PromptOutcome, tool: string): ToolEnd {
  const ends = outcome.toolEnds.filter((end) => end.toolName === tool);
  assert.equal(ends.length, 1, `${tool}: expected one tool_execution_end, got ${JSON.stringify(outcome.toolEnds.map((end) => end.toolName))}`);
  const end = ends[0];
  assert.ok(end !== undefined);
  return end;
}

function assertRegisteredRefusal(end: ToolEnd, code: "REALM_NOT_ACTIVE" | "PATH_ESCAPE"): void {
  assert.equal(end.isError, true, end.text);
  const expected = { outcome: "refused", tool: "write", code, retryable: code === "REALM_NOT_ACTIVE" };
  assert.deepEqual(JSON.parse(end.text), expected, "require the catalogue refusal, not native success or echoed arguments");
  const result = end.frame["result"];
  assert.ok(isRecord(result));
  assert.deepEqual(result["details"], expected);
}

void test(
  "C1: reachable error/advisory registered writes EACH warn, write exact bytes, and continue to the provider",
  { skip, timeout: OMP_SCENARIO_TIMEOUT_MS },
  async (t) => {
    const spec: GuardCase = { name: "c1", mode: "advisory", realm: "inactive", tool: "write", relativePath: "c1.txt" };
    const { profile, invoke } = await runGuard(t, spec);
    for (const [relativePath, content] of [
      ["c1-first.txt", "first advisory write\nUTF-8: λ\n"],
      ["c1-second.txt", "second advisory write\nUTF-8: 雪\n"],
    ] as const) {
      assert.equal(existsSync(join(profile.workspace, relativePath)), false);
      const { outcome, notices } = await invoke(relativePath, content);
      assert.deepEqual(notices, [INACTIVE_ADVISORY_NOTICE], "each registered write must forward its own existing daemon notice");
      const end = toolEndOf(outcome, "write");
      assert.equal(end.isError, false, end.text);
      const expected = {
        outcome: "done",
        tool: "write",
        value: { sha256: createHash("sha256").update(content).digest("hex"), bytes: Buffer.byteLength(content), warning: INACTIVE_ADVISORY_NOTICE },
      };
      assert.deepEqual(JSON.parse(end.text), expected, "registered writes return metadata, not raw file contents");
      const result = end.frame["result"];
      assert.ok(isRecord(result));
      assert.deepEqual(result["details"], expected);
      assert.deepEqual(readFileSync(join(profile.workspace, relativePath)), Buffer.from(content), "actual host bytes, not result text, prove the effect");
    }
  },
);

void test(
  "C1 filesystem negative: reachable error/advisory preserves a real missing-parent refusal",
  { skip, timeout: OMP_SCENARIO_TIMEOUT_MS },
  async (t) => {
    const spec: GuardCase = { name: "c1-filesystem", mode: "advisory", realm: "inactive", tool: "write", relativePath: "missing-parent/c1.txt" };
    const { profile, invoke } = await runGuard(t, spec);
    assert.equal(existsSync(join(profile.workspace, "missing-parent")), false);
    const { outcome, notices } = await invoke();
    assertRegisteredRefusal(toolEndOf(outcome, "write"), "PATH_ESCAPE");
    assert.deepEqual(notices, [], "a refused filesystem write must not be reported as advisory success");
    assert.equal(existsSync(join(profile.workspace, spec.relativePath)), false);
    assert.equal(existsSync(join(profile.workspace, "missing-parent")), false);
  },
);

void test(
  "C2: reachable error/fail-closed refuses with REALM_NOT_ACTIVE, no file, and actual provider error continuation",
  { skip, timeout: OMP_SCENARIO_TIMEOUT_MS },
  async (t) => {
    const spec: GuardCase = { name: "c2", mode: "fail-closed", realm: "inactive", tool: "write", relativePath: "c2.txt" };
    const { profile, invoke } = await runGuard(t, spec);
    const { outcome, notices } = await invoke();
    assert.deepEqual(notices, []);
    assertRegisteredRefusal(toolEndOf(outcome, "write"), "REALM_NOT_ACTIVE");
    assert.equal(existsSync(join(profile.workspace, spec.relativePath)), false);
  },
);

for (const mode of ["advisory", "fail-closed"] as const) {
  void test(
    `unreachable negative (${mode}): registered write refuses/no file; NOT reachable-inactive C1/C2 proof`,
    { skip, timeout: OMP_SCENARIO_TIMEOUT_MS },
    async (t) => {
      const spec: GuardCase = { name: `unreachable-${mode}`, mode, realm: "down", tool: "write", relativePath: `unreachable-${mode}.txt` };
      const { profile, invoke } = await runGuard(t, spec);
      const { outcome, notices } = await invoke();
      assert.deepEqual(notices, [], "cached advisory mode does not authorize a transport fallback");
      assertRegisteredRefusal(toolEndOf(outcome, "write"), "REALM_NOT_ACTIVE");
      assert.equal(existsSync(join(profile.workspace, spec.relativePath)), false);
    },
  );
}

void test(
  "C3: with the realm active the write proceeds on the host; the offered tool list is the Phase 16 baseline",
  { skip, timeout: OMP_SCENARIO_TIMEOUT_MS },
  async (t) => {
    const spec: GuardCase = { name: "c3", mode: "fail-closed", realm: "active", tool: "write", relativePath: "c3.txt" };
    const { profile, invoke } = await runGuard(t, spec);
    const { outcome, requests } = await invoke();
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
    const { profile, invoke } = await runGuard(t, spec);
    const { outcome, requests, notices } = await invoke();
    assert.deepEqual(notices, [ADVISORY_NOTICE]);
    const end = toolEndOf(outcome, "edit");
    t.diagnostic(`edit result: ${end.text}`);
    assert.equal(end.isError, false, end.text);
    assert.deepEqual(readFileSync(join(profile.workspace, spec.relativePath)), Buffer.from("c4\n"));
    assert.ok(end.text.length > 0, "native CREATE must report a successful tool result");
    const nextRequest = requests[1];
    assert.ok(nextRequest !== undefined, "the provider must receive the native edit result in its next request");
    assert.equal(nextRequest.lastRole, "tool");
    assert.equal(nextRequest.toolResultText, end.text, "the provider's next request must carry the successful native edit result");
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
        [`built-realm-${label}.requests.json`]: () => JSON.stringify(provider.requests.slice(requestsBefore), null, 1),
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

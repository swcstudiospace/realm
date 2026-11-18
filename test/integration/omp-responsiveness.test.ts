// Omp stays responsive while Realm attaches (V1LIVE-01 / OI-11, 36-CONTEXT D-36-06): the measurement behind the "UI-01 detail" of
// docs/integration/omp.md. No file in test or scripts sent `get_state` before this one, so the claim "the Omp UI is not blocked during
// a cold attach" had no method. The method: send `get_state` to a running Omp every 250 ms and measure the time from each send to the
// response frame carrying its id. A probe that is never answered (10 s per probe) is an unanswered probe.
//
// Two tests, both gated:
//   baseline     Omp with no extension in an isolated profile (a scripted provider serves models.yml and is never asked a turn). It needs no
//                production stack. It shows what a quiet host answers on its own, so a slow attach is not confused with a loaded machine.
//   cold attach  the baseline first, then Omp with the built extension, with no realm daemon running, from a project directory under the
//                pinned workspace root. The window runs from process start until the status line shows `realm active` (the plugin starts the
//                daemon itself on a cold attach). It needs the production stack and is run by a person in a live window (Plan 36-03).
//
// Verdict (test/support/responsiveness.ts): a quiet host, a passing baseline, at least 40 probes, a window of at least 10 s, every probe
// answered, a maximum of at most 1000 ms and a 95th percentile of at most 500 ms. A host that is not quiet fails the measurement, naming
// the load, unless REALM_OMP_RESPONSIVENESS_ALLOW_LOADED=1: the run then proceeds, is labelled loaded in the diagnostics and the summary
// text, and is a check of the mechanics, not a measurement.
//
// Gate. Both tests skip, naming the first missing prerequisite, unless REALM_LIVE_OMP_RESPONSIVENESS=1 and the Omp prerequisites hold
// (REALM_LIVE_OMP=1, ompSkipReason); the cold-attach test also needs the production prerequisites (productionSkipReason). The file never
// sets a gate variable, never stops a daemon it did not start, never prints a secret.
//
// Evidence, when REALM_OMP_EVIDENCE_DIR names a directory: the samples CSV and the summary text of each phase, and the transcript.
//
// Removal scope of the cold-attach test: one directory under the pinned workspace root, omp-resp-<random>, and the scenario root, both
// removed exactly; the entries the run created in the shared state directory (including the presence markers under hosts/ that did not
// exist before); and the daemon the plugin started (`realm down` for the project). A host receipt is never touched: this test installs none.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { cpus, loadavg } from "node:os";
import { join, sep } from "node:path";
import { test, type TestContext } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { closeWithEvidence, collectOmpGateInputs, createCleanups, EXTENSION_PATH, OMP_READY_TIMEOUT_MS, ompBinary, ompSkipReason, writeEvidence, type Cleanups } from "../support/omp-live.js";
import { createOmpProfile, type OmpProfile } from "../support/omp-profile.js";
import { killGroup, OmpSession, startOmp, type OmpExit } from "../support/omp-rpc.js";
import {
  createScenarioEnvironment,
  describeResult,
  describeValue,
  findDaemonPids,
  isDirectory,
  isSocket,
  type LiveInputs,
  onPath,
  probePodman,
  productionSkipReason,
  readLiveInputs,
  realmCliWithWorkspace,
  removeSharedStateCreatedBy,
  restoreSharedPolicy,
  sandboxNameFor,
  type ScenarioEnvironment,
  waitForNoResidue,
} from "../support/production-live.js";
import {
  BASELINE_MIN_PROBES,
  BASELINE_WINDOW_MS,
  type HostLoad,
  PROBE_INTERVAL_MS,
  type ProbeSample,
  QUIET_LOAD_PER_CPU,
  quietHost,
  responsivenessProblems,
  samplesCsv,
  summariseLatencies,
  summaryText,
} from "../support/responsiveness.js";
import { ScriptedProvider } from "../support/scripted-provider.js";
import { scaledMs } from "../support/timing.js";

const CLI_PATH = fileURLToPath(new URL("../../src/cli/main.js", import.meta.url));
const OMP_BIN = ompBinary(process.env);

const OPT_IN_VARIABLE = "REALM_LIVE_OMP_RESPONSIVENESS";
const ALLOW_LOADED_VARIABLE = "REALM_OMP_RESPONSIVENESS_ALLOW_LOADED";
const EVIDENCE_DIR_VARIABLE = "REALM_OMP_EVIDENCE_DIR";
const EVIDENCE_PREFIX = "omp-responsiveness";

// Bounds of the tests: failure bounds only, a pass never waits on them.
const BASELINE_TIMEOUT_MS = 600_000;
const COLD_TIMEOUT_MS = 1_200_000;
const PROBE_ANSWER_TIMEOUT_MS = 10_000;
const ATTACH_ACTIVE_TIMEOUT_MS = 360_000;
const COMMANDS_TIMEOUT_MS = 30_000;
const DOWN_TIMEOUT_MS = 120_000;
const CLOSE_OPTIONS = { graceMs: 40_000, termMs: 20_000, killMs: 20_000 } as const;
// The baseline window is probed at ticks 0, 1, ... while tick * interval is within BASELINE_WINDOW_MS, so its last send is at the window.
const BASELINE_MIN_WINDOW_MS = BASELINE_WINDOW_MS - PROBE_INTERVAL_MS;

// The Omp arguments of the baseline: the extension-free session of ompArgs (omp-rpc.ts).
const BASELINE_OMP_ARGS: readonly string[] = ["--mode", "rpc-ui", "--no-extensions", "--model", "stub/scripted", "--no-session"];

// ---- Gate (decided once, at module top; nothing is probed before the opt-in) -----------------------------------------------------

const optInGate = process.env[OPT_IN_VARIABLE] === "1" ? undefined : `${OPT_IN_VARIABLE}=1 is not set; the Omp responsiveness measurement needs an explicit operator opt-in`;
const ompGate = optInGate ?? ompSkipReason(await collectOmpGateInputs(process.env, { platform: process.platform, trace: false }));
const baselineSkip: string | false = ompGate ?? false;
const coldSkip: string | false =
  baselineSkip !== false
    ? baselineSkip
    : productionSkipReason({
        env: process.env,
        podman: await probePodman(),
        isSocket,
        onPath: (name) => onPath(name, process.env["PATH"]),
        exists: existsSync,
        isDirectory,
        cliPath: CLI_PATH,
      });
const live: LiveInputs | undefined = coldSkip === false ? readLiveInputs(process.env, CLI_PATH) : undefined;

// ---- The probe loop --------------------------------------------------------------------------------------------------------------

// Sends one `get_state` and resolves with its sample: the latency from the send to the response frame with the same id, or undefined
// when none arrived within PROBE_ANSWER_TIMEOUT_MS (or Omp had exited).
function probeOnce(omp: OmpSession, id: string, origin: number): Promise<ProbeSample> {
  const sentAt = performance.now();
  omp.send({ id, type: "get_state" });
  return omp
    .waitFor((session) => session.frames.some((frame) => frame["type"] === "response" && frame["id"] === id), scaledMs(PROBE_ANSWER_TIMEOUT_MS), `get_state ${id}`)
    .then(
      () => ({ sentAtMs: Math.round(sentAt - origin), latencyMs: Math.round(performance.now() - sentAt) }),
      () => ({ sentAtMs: Math.round(sentAt - origin), latencyMs: undefined }),
    );
}

interface ProbeLoopOptions {
  readonly prefix: string;
  // Called before each send with the tick number and the milliseconds since the loop began; true ends the loop.
  readonly stop: (tick: number, elapsedMs: number) => boolean;
}

// Probes every PROBE_INTERVAL_MS, on a fixed schedule (a slow tick does not push the later ones), until `stop` says so, then waits for
// the pending answers. An Omp that exited ends the loop too: the probes after it would only be unanswered writes to a closed pipe.
async function probeLoop(omp: OmpSession, options: ProbeLoopOptions): Promise<ProbeSample[]> {
  const origin = performance.now();
  const pending: Promise<ProbeSample>[] = [];
  // Held in an object: the exit handler assigns it after the loop began.
  const state = { gone: false };
  void omp.exited.then(() => {
    state.gone = true;
  });
  for (let tick = 0; ; tick += 1) {
    if (state.gone || options.stop(tick, performance.now() - origin)) {
      break;
    }
    pending.push(probeOnce(omp, `${options.prefix}-${String(tick)}`, origin));
    // A real wait: the probe interval is the measurement itself, so fake timers cannot stand in for it.
    await sleep(Math.max(0, origin + (tick + 1) * PROBE_INTERVAL_MS - performance.now()));
  }
  return Promise.all(pending);
}

function loadNow(label: string): HostLoad {
  const [load1 = 0, load5 = 0, load15 = 0] = loadavg();
  return { label, load1, load5, load15, cpus: cpus().length };
}

// ---- The baseline ----------------------------------------------------------------------------------------------------------------

interface Recorder {
  readonly t: TestContext;
  readonly cleanups: Cleanups;
  readonly transcript: string[];
  readonly loads: HostLoad[];
}

function createRecorder(t: TestContext): Recorder {
  const cleanups = createCleanups();
  t.after(() => cleanups.run());
  const transcript: string[] = [];
  const loads: HostLoad[] = [];
  cleanups.add(() => {
    const files = { [`${EVIDENCE_PREFIX}.transcript.txt`]: () => transcript.join("\n") };
    for (const problem of writeEvidence(process.env[EVIDENCE_DIR_VARIABLE], files)) {
      t.diagnostic(problem);
    }
  });
  return { t, cleanups, transcript, loads };
}

function note(recorder: Recorder, text: string): void {
  recorder.transcript.push(text);
  recorder.t.diagnostic(text);
}

function saveEvidence(recorder: Recorder, phase: string, samples: readonly ProbeSample[], text: string): void {
  const files = { [`${EVIDENCE_PREFIX}.${phase}.samples.csv`]: () => samplesCsv(samples), [`${EVIDENCE_PREFIX}.${phase}.summary.txt`]: () => text };
  for (const problem of writeEvidence(process.env[EVIDENCE_DIR_VARIABLE], files)) {
    recorder.t.diagnostic(problem);
  }
}

// Registers the teardown of one Omp session: evidence first, then the bounded close.
function registerClose(recorder: Recorder, label: string, omp: OmpSession): void {
  recorder.cleanups.add(() =>
    closeWithEvidence({
      evidenceDir: process.env[EVIDENCE_DIR_VARIABLE],
      evidence: {
        [`${EVIDENCE_PREFIX}.${label}.frames.jsonl`]: () => omp.frames.map((frame) => JSON.stringify(frame)).join("\n"),
        [`${EVIDENCE_PREFIX}.${label}.stderr.txt`]: () => omp.stderr(),
      },
      report: (problem) => {
        recorder.t.diagnostic(problem);
      },
      close: () => omp.close(CLOSE_OPTIONS),
    }),
  );
}

// Omp without an extension: the same spawn as startOmp (its own process group, piped stdio) with the extension-free arguments.
function startBaselineOmp(env: Readonly<Record<string, string>>, cwd: string): OmpSession {
  const child = spawn(OMP_BIN, [...BASELINE_OMP_ARGS], { cwd, env: { ...env }, stdio: ["pipe", "pipe", "pipe"], detached: true });
  const exited = new Promise<OmpExit>((resolve) => {
    child.once("error", (error) => {
      resolve({ code: null, signal: null, error: error.message });
    });
    child.once("close", (code, signal) => {
      resolve({ code, signal });
    });
  });
  return new OmpSession({ stdin: child.stdin, stdout: child.stdout, stderr: child.stderr, kill: (signal) => killGroup(child, signal) }, exited);
}

// The baseline measurement: the host must be quiet (or the run is labelled loaded), Omp without an extension is ready, and 10 s of probes
// pass the bounds with the baseline's probe minimum. Returns the label the run carries ("quiet" or "loaded").
async function measureBaseline(recorder: Recorder, profile: OmpProfile): Promise<"quiet" | "loaded"> {
  const before = loadNow("before the baseline");
  recorder.loads.push(before);
  const verdict = quietHost(before.load1, before.cpus, QUIET_LOAD_PER_CPU);
  const allowLoaded = process.env[ALLOW_LOADED_VARIABLE] === "1";
  const label = verdict.quiet ? "quiet" : "loaded";
  note(recorder, `host load before the baseline: ${before.load1.toFixed(2)} on ${String(before.cpus)} cpus, ${verdict.perCpu.toFixed(2)} per cpu (the quiet ceiling is ${String(QUIET_LOAD_PER_CPU)}): ${label}`);
  if (!verdict.quiet && !allowLoaded) {
    assert.fail(`the host is not quiet: ${verdict.perCpu.toFixed(2)} load per cpu, above ${String(QUIET_LOAD_PER_CPU)}; run in a quiet slot or set ${ALLOW_LOADED_VARIABLE}=1 to check the mechanics only (the result is then labelled loaded)`);
  }
  const omp = startBaselineOmp(profile.env, profile.workspace);
  registerClose(recorder, "baseline", omp);
  await omp.ready(OMP_READY_TIMEOUT_MS);
  const samples = await probeLoop(omp, { prefix: "baseline", stop: (tick) => tick * PROBE_INTERVAL_MS > BASELINE_WINDOW_MS });
  const after = loadNow("after the baseline");
  recorder.loads.push(after);
  const summary = summariseLatencies(samples);
  const text = summaryText(`baseline (${label})`, summary, recorder.loads);
  saveEvidence(recorder, "baseline", samples, text);
  note(recorder, `baseline (${label}): ${String(summary.sent)} probes, ${String(summary.unanswered)} unanswered, max ${String(summary.maxMs)} ms, median ${String(summary.medianMs)} ms, p95 ${String(summary.p95Ms)} ms, longest gap ${String(summary.longestGapMs)} ms`);
  const problems = responsivenessProblems(summary, { minProbes: BASELINE_MIN_PROBES, minWindowMs: BASELINE_MIN_WINDOW_MS });
  assert.deepEqual(problems, [], `the baseline (${label}) does not pass: ${problems.join("; ")}`);
  await omp.close(CLOSE_OPTIONS);
  return label;
}

async function startScriptedProfile(recorder: Recorder): Promise<OmpProfile> {
  // The scripted provider only serves models.yml: no prompt is sent, so it is never asked a turn.
  const provider = new ScriptedProvider();
  recorder.cleanups.add(() => provider.stop());
  provider.onTurn(() => ({ text: "unused" }));
  const { port } = await provider.start();
  const pathValue = process.env["PATH"];
  const profile = createOmpProfile({ providerPort: port, ...(pathValue === undefined ? {} : { path: pathValue }) });
  recorder.cleanups.add(() => {
    profile.dispose();
  });
  return profile;
}

void test(
  "V1LIVE-01 omp responsiveness baseline: get_state answers within the bounds on a quiet host with no extension",
  { skip: baselineSkip, timeout: BASELINE_TIMEOUT_MS },
  async (t) => {
    const recorder = createRecorder(t);
    const profile = await startScriptedProfile(recorder);
    await measureBaseline(recorder, profile);
  },
);

// ---- The cold attach -------------------------------------------------------------------------------------------------------------

void test(
  "V1LIVE-01 omp responsiveness cold attach: get_state stays answered from process start until realm active",
  { skip: coldSkip, timeout: COLD_TIMEOUT_MS },
  async (t) => {
    assert.ok(live !== undefined, "the cold-attach test ran although its gate is closed");
    const inputs = live;
    const recorder = createRecorder(t);
    const scenario: ScenarioEnvironment = createScenarioEnvironment(inputs, { image: inputs.image });
    const suffix = randomBytes(6).toString("hex");
    // The project Omp starts in: a directory inside the pinned workspace root, so it is inside a policy root.
    const projectDir = join(inputs.workspaceRoot, `omp-resp-${suffix}`);
    const hostsDir = inputs.driverStateDir === undefined ? undefined : join(inputs.driverStateDir, "hosts");
    const hostsDirExisted = hostsDir !== undefined && existsSync(hostsDir);
    const presenceDirExisted = hostsDir !== undefined && existsSync(join(hostsDir, "omp-active"));
    const sandboxes: string[] = [];

    // Last in, first out: Omp closes first, then the profile and the provider go, then the daemon is stopped and the files are removed.
    recorder.cleanups.add(async () => {
      if (existsSync(projectDir)) {
        const stopped = await realmCliWithWorkspace(inputs, scenario, ["down"], projectDir, DOWN_TIMEOUT_MS);
        assert.equal(stopped.exitCode, 0, `realm down: ${describeResult(stopped)}`);
      }
      restoreSharedPolicy(scenario);
      removeSharedStateCreatedBy(scenario);
      if (hostsDir !== undefined) {
        // Presence markers of this run only: nothing that existed before it is removed, and no receipt is touched.
        if (!presenceDirExisted) {
          rmSync(join(hostsDir, "omp-active"), { recursive: true, force: true });
        }
        if (!hostsDirExisted) {
          rmSync(hostsDir, { recursive: true, force: true });
        }
      }
      rmSync(projectDir, { recursive: true, force: true });
      rmSync(scenario.root, { recursive: true, force: true });
      const residue = await waitForNoResidue(inputs, sandboxes);
      assert.ok(residue.ok, `residue after realm down: ${residue.detail}`);
    });

    const profile = await startScriptedProfile(recorder);
    mkdirSync(projectDir);
    const tmpDir = join(profile.root, "tmp");
    mkdirSync(tmpDir);
    sandboxes.push(sandboxNameFor(projectDir));
    assert.ok(!profile.root.startsWith(`${inputs.workspaceRoot}${sep}`) && profile.root !== inputs.workspaceRoot, "the isolated profile root must lie outside the pinned workspace root");

    // The environment of the extension session, composed as in omp-boot-install.test.ts: the scenario's configuration home and runtime
    // variables, the profile's agent directory, the account's own HOME (the OpenShell CLI the daemon runs resolves the gateway from it).
    const configHome = scenario.cliEnvironment["XDG_CONFIG_HOME"];
    assert.ok(configHome !== undefined, "the scenario environment must name its configuration home");
    const hostHome = scenario.cliEnvironment["HOME"];
    assert.ok(hostHome !== undefined, "the scenario environment must name the account home");
    const ompEnv: Readonly<Record<string, string>> = { ...scenario.cliEnvironment, ...profile.env, HOME: hostHome, XDG_CONFIG_HOME: configHome, TMPDIR: tmpDir };

    const label = await measureBaseline(recorder, profile);

    // A daemon of the account that is already running would hide the cold attach: the measurement needs none.
    const absent = await realmCliWithWorkspace(inputs, scenario, ["status"], projectDir, 30_000);
    assert.equal(absent.exitCode, 0, `realm status before the attach: ${describeResult(absent)}`);
    assert.equal(absent.stdout.trim(), "disconnected", `a realm daemon of this account is running; stop it with realm down before the cold-attach measurement: ${describeResult(absent)}`);
    const daemons = await findDaemonPids(inputs, fileURLToPath(new URL("../../src/daemon/main.js", import.meta.url)));
    assert.ok(daemons.ok, `list the daemon processes: ${describeValue(daemons)}`);
    assert.deepEqual(daemons.pids, [], "a realm daemon process of this account is running; the cold attach needs none");

    const beforeSession = loadNow("before the extension session");
    recorder.loads.push(beforeSession);
    note(recorder, `host load before the extension session: ${beforeSession.load1.toFixed(2)} on ${String(beforeSession.cpus)} cpus`);
    const omp = startOmp({ bin: OMP_BIN, env: ompEnv, cwd: projectDir, extensionPath: EXTENSION_PATH });
    registerClose(recorder, "attach", omp);
    const samples = await probeLoop(omp, {
      prefix: "attach",
      stop: (_tick, elapsedMs) => omp.status()?.includes("realm active") === true || elapsedMs > scaledMs(ATTACH_ACTIVE_TIMEOUT_MS),
    });
    const reachedActive = omp.status()?.includes("realm active") === true;
    const afterSession = loadNow("after the extension session");
    recorder.loads.push(afterSession);
    const summary = summariseLatencies(samples);
    const text = summaryText(`cold attach (${label} baseline, realm active reached: ${String(reachedActive)})`, summary, recorder.loads);
    saveEvidence(recorder, "attach", samples, text);
    note(recorder, `cold attach: ${String(summary.sent)} probes over ${String(summary.windowMs)} ms, ${String(summary.unanswered)} unanswered, max ${String(summary.maxMs)} ms, median ${String(summary.medianMs)} ms, p95 ${String(summary.p95Ms)} ms, longest gap ${String(summary.longestGapMs)} ms, realm active reached: ${String(reachedActive)}`);
    assert.ok(reachedActive, `the status line never showed realm active within ${String(ATTACH_ACTIVE_TIMEOUT_MS)} ms; status: ${String(omp.status())}`);
    const problems = responsivenessProblems(summary);
    assert.deepEqual(problems, [], `Omp was not responsive during the cold attach: ${problems.join("; ")}`);
    // The session is still a working one: it answers a command after the attach.
    omp.send({ id: `commands-${suffix}`, type: "get_available_commands" });
    await omp.waitFor((session) => session.frames.some((frame) => frame["type"] === "response" && frame["id"] === `commands-${suffix}`), COMMANDS_TIMEOUT_MS, "get_available_commands after the attach");
  },
);

// Omp stays responsive while Realm attaches (V1LIVE-01 / OI-11, 36-CONTEXT D-36-06): the measurement behind the "UI-01 detail" of
// docs/integration/omp.md. No file in test or scripts sent `get_state` before this one, so the claim "the Omp UI is not blocked during
// a cold attach" had no method. The method: send `get_state` to a running Omp every 250 ms and measure the time from each send to the
// response frame carrying its id. A probe that is never answered (10 s per probe) is an unanswered probe.
//
// Three tests, all gated:
//   baseline     Omp with no extension in an isolated profile (a scripted provider serves models.yml and is never asked a turn). It needs no
//                production stack. It shows what a quiet host answers on its own, so a slow attach is not confused with a loaded machine.
//   control      Omp with no extension, probed from process start exactly as the cold attach is, until a probe was answered and 12 s have
//                elapsed. It asserts only that Omp answered; its first-answer time is Omp's own boot, the figure the cold attach is read
//                against (38-CONTEXT D-38-02: the boot excess). It needs no production stack.
//   cold attach  the baseline first, then Omp with the built extension, with no realm daemon running, from a project directory under the
//                pinned workspace root. The window runs from process start until the status line shows `realm active` (the plugin starts the
//                daemon itself on a cold attach). It needs the production stack and is run by a person in a live window (Plan 36-03).
//
// Per-run record (Phase 38, 38-CONTEXT D-38-03): the control and the cold attach each write omp-responsiveness.<phase>.record.json to the
// evidence directory (numbers, booleans, closed phrases and problem lines only), and the cold attach also writes
// omp-responsiveness.attach.timeline.txt: when Omp was ready, when the first and last realm status painted, when the first probe was
// answered and when realm active showed, in milliseconds from process start (frame times are taken from the session's construction, a few
// milliseconds after the probe loop's origin). The cold record carries valid and invalidReason, so the window can tell a run that counts
// from one that does not; a run that fails an assertion before the record (the baseline, the no-daemon check) writes none and is not valid.
// The decision rule that reads these numbers is test/support/responsiveness-decision.ts; the verdict assertions below are unchanged.
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
// Evidence, when REALM_OMP_EVIDENCE_DIR names a directory: the samples CSV and the summary text of each phase, the record of the
// control and of the cold attach, the timeline of the cold attach, and the transcript.
//
// Removal scope of the cold-attach test: one directory under the pinned workspace root, omp-resp-<random>, and the scenario root, both
// removed exactly; the entries the run created in the shared state directory (including the presence markers under hosts/ that did not
// exist before); and the daemon the plugin started (`realm down` for the project). A host receipt is never touched: this test installs none.
// The control removes nothing beyond what the baseline removes (its profile and provider).

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { cpus, loadavg } from "node:os";
import { join, sep } from "node:path";
import { test, type TestContext } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { closeWithEvidence, collectOmpGateInputs, createCleanups, EXTENSION_PATH, isRecord, OMP_READY_TIMEOUT_MS, ompBinary, ompSkipReason, writeEvidence, type Cleanups } from "../support/omp-live.js";
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
import { classifyRun, CONTROL_MAX_WINDOW_MS, CONTROL_MIN_WINDOW_MS, firstAnswerMs, servingProblems, startupOrder, type StartupOrder } from "../support/responsiveness-decision.js";
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

// The quiet-host check before the baseline (and before the control): the load is recorded and noted, and a host that is not quiet fails
// unless the run is explicitly allowed to proceed loaded. Returns the label the run carries ("quiet" or "loaded").
function checkQuietHost(recorder: Recorder): "quiet" | "loaded" {
  const before = loadNow("before the baseline");
  recorder.loads.push(before);
  const verdict = quietHost(before.load1, before.cpus, QUIET_LOAD_PER_CPU);
  const allowLoaded = process.env[ALLOW_LOADED_VARIABLE] === "1";
  const label = verdict.quiet ? "quiet" : "loaded";
  note(recorder, `host load before the baseline: ${before.load1.toFixed(2)} on ${String(before.cpus)} cpus, ${verdict.perCpu.toFixed(2)} per cpu (the quiet ceiling is ${String(QUIET_LOAD_PER_CPU)}): ${label}`);
  if (!verdict.quiet && !allowLoaded) {
    assert.fail(`the host is not quiet: ${verdict.perCpu.toFixed(2)} load per cpu, above ${String(QUIET_LOAD_PER_CPU)}; run in a quiet slot or set ${ALLOW_LOADED_VARIABLE}=1 to check the mechanics only (the result is then labelled loaded)`);
  }
  return label;
}

// The baseline measurement: the host must be quiet (or the run is labelled loaded), Omp without an extension is ready, and 10 s of probes
// pass the bounds with the baseline's probe minimum. Returns the label the run carries ("quiet" or "loaded").
async function measureBaseline(recorder: Recorder, profile: OmpProfile): Promise<"quiet" | "loaded"> {
  const label = checkQuietHost(recorder);
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

// ---- The per-run record and the timeline -----------------------------------------------------------------------------------------

const CONTROL_RECORD_FILE = `${EVIDENCE_PREFIX}.control.record.json`;

// Whether the reading with this label was on a quiet host, by the same function and ceiling as the baseline check; null when the run took
// no such reading.
function quietAt(loads: readonly HostLoad[], label: string): boolean | null {
  const reading = loads.find((load) => load.label === label);
  return reading === undefined ? null : quietHost(reading.load1, reading.cpus, QUIET_LOAD_PER_CPU).quiet;
}

// The arrival, in milliseconds from the session's construction, of the first realm status frame that reads "realm active".
function realmActiveArrivalMs(omp: OmpSession): number | undefined {
  for (const [index, frame] of omp.frames.entries()) {
    const text = frame["statusText"];
    if (frame["type"] === "extension_ui_request" && frame["method"] === "setStatus" && frame["statusKey"] === "realm" && typeof text === "string" && text.includes("realm active")) {
      return omp.frameArrivalsMs[index];
    }
  }
  return undefined;
}

// The fields both records carry. Only numbers, booleans, closed phrases and problem lines: no path, no environment value, no secret.
function buildRunRecord(kind: "control" | "cold-attach", recorder: Recorder, omp: OmpSession, samples: readonly ProbeSample[]): Record<string, unknown> {
  const startup = startupOrder(omp.frames, omp.frameArrivalsMs);
  return {
    kind,
    loads: recorder.loads,
    quietBeforeBaseline: quietAt(recorder.loads, "before the baseline"),
    quietBeforeSession: quietAt(recorder.loads, "before the extension session"),
    summary: summariseLatencies(samples),
    firstAnswerMs: firstAnswerMs(samples) ?? null,
    servingProblems: servingProblems(samples),
    startup: { readyMs: startup.readyMs ?? null, firstRealmStatusMs: startup.firstRealmStatusMs ?? null, lastRealmStatusMs: startup.lastRealmStatusMs ?? null, readyFirst: startup.readyFirst ?? null },
  };
}

// The control's first-answer time as a control run of the same attempt recorded it (the same evidence directory), or undefined when
// there is no directory or no record.
function controlFirstAnswerFromEvidence(): number | undefined {
  const dir = process.env[EVIDENCE_DIR_VARIABLE];
  if (dir === undefined || dir === "") {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(dir, CONTROL_RECORD_FILE), "utf8"));
    return isRecord(parsed) && typeof parsed["firstAnswerMs"] === "number" ? parsed["firstAnswerMs"] : undefined;
  } catch {
    return undefined;
  }
}

// One line per moment, from process start; "not seen" when the moment did not happen.
function timelineText(startup: StartupOrder, firstAnswer: number | undefined, activeMs: number | undefined): string {
  const at = (ms: number | undefined): string => (ms === undefined ? "not seen" : `${String(Math.round(ms))} ms`);
  const order = startup.readyFirst === undefined ? "unknown" : startup.readyFirst ? "yes" : "no";
  return [
    `omp ready: ${at(startup.readyMs)}`,
    `first realm status paint: ${at(startup.firstRealmStatusMs)}`,
    `last realm status paint: ${at(startup.lastRealmStatusMs)}`,
    `first answered probe: ${at(firstAnswer)}`,
    `realm active: ${at(activeMs)}`,
    `ready before the first realm status paint: ${order}`,
    "",
  ].join("\n");
}

function saveRecord(recorder: Recorder, name: string, record: Record<string, unknown>, extra: Readonly<Record<string, string>> = {}): void {
  const files: Record<string, () => string> = { [name]: () => `${JSON.stringify(record, null, 2)}\n` };
  for (const [file, text] of Object.entries(extra)) {
    files[file] = () => text;
  }
  for (const problem of writeEvidence(process.env[EVIDENCE_DIR_VARIABLE], files)) {
    recorder.t.diagnostic(problem);
  }
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

// ---- The control -----------------------------------------------------------------------------------------------------------------

// A probe answered: a response frame whose id carries the control prefix.
function controlAnswered(omp: OmpSession): boolean {
  return omp.frames.some((frame) => frame["type"] === "response" && typeof frame["id"] === "string" && frame["id"].startsWith("control-"));
}

void test(
  "V1LIVE-01 omp responsiveness control with no extension, probed from process start",
  { skip: baselineSkip, timeout: BASELINE_TIMEOUT_MS },
  async (t) => {
    const recorder = createRecorder(t);
    const profile = await startScriptedProfile(recorder);
    const label = checkQuietHost(recorder);
    const omp = startBaselineOmp(profile.env, profile.workspace);
    registerClose(recorder, "control", omp);
    // From process start, with no wait for the ready frame: the first answer is Omp's own boot. Ends once a probe was answered and the
    // minimum window has passed, or at the maximum.
    const samples = await probeLoop(omp, {
      prefix: "control",
      stop: (_tick, elapsedMs) => (controlAnswered(omp) && elapsedMs >= CONTROL_MIN_WINDOW_MS) || elapsedMs >= scaledMs(CONTROL_MAX_WINDOW_MS),
    });
    recorder.loads.push(loadNow("after the control"));
    const summary = summariseLatencies(samples);
    saveEvidence(recorder, "control", samples, summaryText(`control (${label}, no extension, probed from process start)`, summary, recorder.loads));
    saveRecord(recorder, CONTROL_RECORD_FILE, buildRunRecord("control", recorder, omp, samples));
    note(recorder, `control (${label}): ${String(summary.sent)} probes, ${String(summary.unanswered)} unanswered, first answer ${String(firstAnswerMs(samples))} ms from process start`);
    assert.ok(summary.answered > 0, `the control is invalid: Omp with no extension answered no probe in ${String(summary.windowMs)} ms`);
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
    // The record and the timeline, before any assertion that can fail on a latency. The baseline and the no-daemon check are asserted
    // above, so reaching this point means both held; validity adds the two quiet readings and realm active (first failed condition wins).
    const base = buildRunRecord("cold-attach", recorder, omp, samples);
    const invalidReason =
      base["quietBeforeBaseline"] !== true
        ? "host not quiet before the baseline"
        : base["quietBeforeSession"] !== true
          ? "host not quiet before the extension session"
          : !reachedActive
            ? "realm active not reached"
            : null;
    const controlFirstAnswer = controlFirstAnswerFromEvidence();
    const classified = controlFirstAnswer === undefined ? undefined : classifyRun(samples, [controlFirstAnswer]);
    saveRecord(
      recorder,
      `${EVIDENCE_PREFIX}.attach.record.json`,
      {
        ...base,
        baselinePassed: true,
        noDaemonAtStart: true,
        reachedActive,
        valid: invalidReason === null,
        invalidReason,
        verdictProblems: responsivenessProblems(summary),
        controlFirstAnswerMs: controlFirstAnswer ?? null,
        bootExcessMs: classified?.bootExcessMs ?? null,
        case: classified?.case ?? null,
      },
      { [`${EVIDENCE_PREFIX}.attach.timeline.txt`]: timelineText(startupOrder(omp.frames, omp.frameArrivalsMs), firstAnswerMs(samples), realmActiveArrivalMs(omp)) },
    );
    note(recorder, `cold attach: ${String(summary.sent)} probes over ${String(summary.windowMs)} ms, ${String(summary.unanswered)} unanswered, max ${String(summary.maxMs)} ms, median ${String(summary.medianMs)} ms, p95 ${String(summary.p95Ms)} ms, longest gap ${String(summary.longestGapMs)} ms, realm active reached: ${String(reachedActive)}`);
    assert.ok(reachedActive, `the status line never showed realm active within ${String(ATTACH_ACTIVE_TIMEOUT_MS)} ms; status: ${String(omp.status())}`);
    const problems = responsivenessProblems(summary);
    assert.deepEqual(problems, [], `Omp was not responsive during the cold attach: ${problems.join("; ")}`);
    // The session is still a working one: it answers a command after the attach.
    omp.send({ id: `commands-${suffix}`, type: "get_available_commands" });
    await omp.waitFor((session) => session.frames.some((frame) => frame["type"] === "response" && frame["id"] === `commands-${suffix}`), COMMANDS_TIMEOUT_MS, "get_available_commands after the attach");
  },
);

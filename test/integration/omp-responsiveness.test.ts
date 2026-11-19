// Omp stays responsive while Realm attaches (V1LIVE-01 / OI-11, 36-CONTEXT D-36-06): the measurement behind the "UI-01 detail" of
// docs/integration/omp.md. No file in test or scripts sent `get_state` before this one, so the claim "the Omp UI is not blocked during
// a cold attach" had no method. The method: send `get_state` to a running Omp every 250 ms and measure the time from each send to the
// response frame carrying its id. A probe that is never answered (10 s per probe) is an unanswered probe.
//
// Five tests, all gated:
//   baseline     Omp with no extension in an isolated profile (a scripted provider serves models.yml and is never asked a turn). It needs no
//                production stack. It shows what a quiet host answers on its own, so a slow attach is not confused with a loaded machine.
//   control      Omp with no extension, probed from process start exactly as the cold attach is, until a probe was answered and 12 s have
//                elapsed. It asserts only that Omp answered; its first-answer time is Omp's own boot, the figure the cold attach is read
//                against (38-CONTEXT D-38-02: the boot excess). It needs no production stack.
//   cold attach  the baseline first, then Omp with the built extension, with no realm daemon running, from a project directory under the
//                pinned workspace root. Probes are sent from process start until the status line shows `realm active` and the minimum window
//                has passed since Omp's ready frame; the verdict reads the window from the ready frame (Phase 44 correction, below). The
//                plugin starts the daemon itself on a cold attach. It needs the production stack and is run by a person in a live window.
//   paired arm   one arm (before or after) of one pair of the paired loaded A/B (44-CONTEXT D-44-06 and D-44-07; the validity of 45-CONTEXT
//                D-45-06): the control and the cold attach back to back in one test, in the order controlFirst(runIndexOf(pair, arm)) gives
//                (the control first for an odd run index, the cold attach first for an even one, so the order alternates), each Omp in its
//                own transient scope with the same wrapper. It writes a record, two samples files and two readings files. It asserts
//                mechanics only (no daemon at the start, the control answered, realm active reached, the session answers a command) and no
//                latency: the verdict and the pair decision are computed from the records by test/support/omp-window-analysis.ts and not
//                by this file. A refusal (the scope or a reading unavailable) is written to the record and then fails the test with a
//                message that begins REFUSED, so it is never read as a pass. The record carries the tier label and the fixed label
//                "loaded, paired": it never claims a quiet host, does not require one, reads no load average as a validity input and does
//                not read the loaded-host escape variable. It needs the production stack, REALM_OMP_PAIRED_ARM (before or after) and
//                REALM_OMP_PAIRED_PAIR (1 to 12).
//   calibration  one scoped control with no extension (45-CONTEXT D-45-08), probed exactly as the control part of the arm test, for the
//                calibration of the validity bounds: a record, its samples CSV and its readings CSV. It needs no production stack. It
//                asserts that the control answered and nothing else. It needs REALM_OMP_CALIBRATION_RUN (1 to 16).
//
// Phase 44 correction (44-CONTEXT D-44-03; E-44-08 and E-44-09): the controls with no extension answer nothing for 9 to 15 s from process
// start, so a window that starts there holds Omp's own boot, and the in-test baseline missed its bounds at low load averages in five of
// nine runs. The cold attach therefore keeps probing from process start but reads its verdict, its 40-probe and 10-s conditions and its
// stop rule over the window that starts at the ready frame; the earlier process-start window is the one the 2026-11-18 runs of Phase 38
// used. The probes before ready are boot samples: written to the samples CSV with a phase column, summarized apart, never in the verdict.
// The numbers over every sample are still computed and written beside the corrected ones, a labelled control-relative secondary reading
// (window minus the in-run baseline) is added and is never a verdict, and the CPU pressure is recorded at each load reading. No
// threshold is edited and the baseline assertion is not loosened.
//
// Phase 45 (45-CONTEXT D-45-03 to D-45-09): the paired arm and the calibration run every Omp process through one transient systemd scope
// (test/support/omp-arm-run.ts, scopedWrap), read the scope's CPU pressure and the Omp main thread's run-queue time at every probe send and
// answer, and write them as readings CSVs; validity is decided from that contention, never from the host load average (the load and
// pressure readings the record keeps are descriptive). The baseline, control and cold-attach tests stay unscoped: they are the Phase 38
// and Phase 44 instruments, unchanged. Tier labels: "loaded, scoped" (the default of this file) and "loaded, unscoped" (the fallback).
//
// Per-run record (Phase 38, 38-CONTEXT D-38-03): the control and the cold attach each write omp-responsiveness.<phase>.record.json to the
// evidence directory (numbers, booleans, closed phrases and problem lines only), and the cold attach also writes
// omp-responsiveness.attach.timeline.txt: when Omp was ready, when the first and last realm status painted, when the first probe was
// answered and when realm active showed, in milliseconds from process start (frame times are taken from the session's construction, a few
// milliseconds after the probe loop's origin). The cold record carries valid and invalidReason, so the window can tell a run that counts
// from one that does not; a run that fails an assertion before the record (the baseline, the no-daemon check) writes none and is not valid.
// The decision rule that reads these numbers is test/support/responsiveness-decision.ts; the thresholds of the verdict are unchanged.
//
// Verdict (test/support/responsiveness.ts): a quiet host, a passing baseline, at least 40 probes, a window of at least 10 s, every probe
// answered, a maximum of at most 1000 ms and a 95th percentile of at most 500 ms. A host that is not quiet fails the measurement, naming
// the load, unless REALM_OMP_RESPONSIVENESS_ALLOW_LOADED=1: the run then proceeds, is labelled loaded in the diagnostics and the summary
// text, and is a check of the mechanics, not a measurement.
//
// Gate. The tests skip, naming the first missing prerequisite, unless REALM_LIVE_OMP_RESPONSIVENESS=1 and the Omp prerequisites hold
// (REALM_LIVE_OMP=1, ompSkipReason); the cold-attach test and the paired arm also need the production prerequisites
// (productionSkipReason), the calibration needs REALM_OMP_CALIBRATION_RUN. The file never sets a gate variable, never stops a daemon it
// did not start, never prints a secret.
//
// Evidence, when REALM_OMP_EVIDENCE_DIR names a directory: the samples CSV and the summary text of each phase, the record of the
// control and of the cold attach, the timeline of the cold attach, the paired record, its two samples files and its two readings files
// (omp-responsiveness.paired.control.readings.csv, omp-responsiveness.paired.cold.readings.csv), the calibration record
// (omp-responsiveness.calibration.record.json, omp-responsiveness.calibration.samples.csv, omp-responsiveness.calibration.readings.csv),
// and the transcript.
//
// Removal scope of the cold-attach test and of the paired arm: one directory under the pinned workspace root, omp-resp-<random>, and the
// scenario root, both removed exactly; the entries the run created in the shared state directory (including the presence markers under
// hosts/ that did not exist before); and the daemon the plugin started (`realm down` for the project). A host receipt is never touched:
// these tests install none. The control removes nothing beyond what the baseline removes (its profile and provider).

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
import { classifyRun, CONTROL_MAX_WINDOW_MS, CONTROL_MIN_WINDOW_MS, firstAnswerMs, servingProblems, splitAtReady, startupOrder, type StartupOrder, windowStopReached } from "../support/responsiveness-decision.js";
import { MAX_PAIR_ATTEMPTS, PAIRED_LABEL } from "../support/paired-ab.js";
import {
  buildCalibrationRecord,
  buildRunRecord as buildArmRecord,
  type ContentionSampler,
  createContentionSampler,
  createFsReader,
  DESIGN_BRANCH,
  type HostReading,
  type PartParts,
  type Refusal,
  readingsCsv,
  readThreadSplit,
  scopedWrap,
  type ThreadSplit,
  verifyScopedChild,
} from "../support/omp-arm-run.js";
import { CALIBRATED_BOUNDS } from "../support/omp-calibration.js";
import type { ContentionReading } from "../support/omp-contention.js";
import { CALIBRATION_MAX_ATTEMPTS, controlFirst, runIndexOf } from "../support/omp-verdict.js";
import {
  BASELINE_MIN_PROBES,
  BASELINE_WINDOW_MS,
  type CpuPressure,
  type HostLoad,
  type LatencySummary,
  MIN_PROBES,
  MIN_WINDOW_MS,
  parsePressure,
  PROBE_INTERVAL_MS,
  type ProbeSample,
  QUIET_LOAD_PER_CPU,
  quietHost,
  relativeSummary,
  responsivenessProblems,
  samplesCsv,
  samplesCsvWithPhase,
  summariseLatencies,
  summaryText,
  summaryTextWithSecondary,
} from "../support/responsiveness.js";
import { ScriptedProvider } from "../support/scripted-provider.js";
import { scaledMs } from "../support/timing.js";

const CLI_PATH = fileURLToPath(new URL("../../src/cli/main.js", import.meta.url));
const OMP_BIN = ompBinary(process.env);

const OPT_IN_VARIABLE = "REALM_LIVE_OMP_RESPONSIVENESS";
const ALLOW_LOADED_VARIABLE = "REALM_OMP_RESPONSIVENESS_ALLOW_LOADED";
const EVIDENCE_DIR_VARIABLE = "REALM_OMP_EVIDENCE_DIR";
const PAIRED_ARM_VARIABLE = "REALM_OMP_PAIRED_ARM";
const PAIRED_PAIR_VARIABLE = "REALM_OMP_PAIRED_PAIR";
const CALIBRATION_RUN_VARIABLE = "REALM_OMP_CALIBRATION_RUN";
const EVIDENCE_PREFIX = "omp-responsiveness";
// The file the CPU pressure reading comes from (Linux only; absent elsewhere by design, recorded as null).
const PRESSURE_FILE = "/proc/pressure/cpu";

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
// The paired arm needs the arm (before or after) and the pair number (1 to 10) on top of the cold-attach gate, so a run that names neither
// skips naming the first missing variable. It never sets a gate variable; the order is the opt-in, the arm, the pair, then the rest.
const pairedArmValue = process.env[PAIRED_ARM_VARIABLE];
const pairedArm: "before" | "after" | undefined = pairedArmValue === "before" || pairedArmValue === "after" ? pairedArmValue : undefined;
const pairedPairValue = process.env[PAIRED_PAIR_VARIABLE];
const pairedPair = pairedPairValue !== undefined && /^[1-9]\d*$/.test(pairedPairValue) && Number(pairedPairValue) <= MAX_PAIR_ATTEMPTS ? Number(pairedPairValue) : undefined;
const pairedSkip: string | false =
  optInGate ??
  (pairedArm === undefined
    ? `${PAIRED_ARM_VARIABLE} must be before or after; the paired arm test measures one arm of one pair`
    : pairedPair === undefined
      ? `${PAIRED_PAIR_VARIABLE} must be an integer from 1 to ${String(MAX_PAIR_ATTEMPTS)}; the paired arm test measures one arm of one pair`
      : coldSkip);
// The calibration control needs the number of the control (1 to CALIBRATION_MAX_ATTEMPTS) on top of the Omp prerequisites and no production stack.
const calibrationRunValue = process.env[CALIBRATION_RUN_VARIABLE];
const calibrationRun = calibrationRunValue !== undefined && /^[1-9]\d*$/.test(calibrationRunValue) && Number(calibrationRunValue) <= CALIBRATION_MAX_ATTEMPTS ? Number(calibrationRunValue) : undefined;
const calibrationSkip: string | false =
  optInGate ?? (calibrationRun === undefined ? `${CALIBRATION_RUN_VARIABLE} must be an integer from 1 to ${String(CALIBRATION_MAX_ATTEMPTS)}; the calibration test records one scoped control` : baselineSkip);

// ---- The probe loop --------------------------------------------------------------------------------------------------------------

// A hook the scoped runs hand to the probe loop: `reading` is called with the loop time in milliseconds at every probe send, at every answer
// arrival (the send time plus the latency, the sample's own numbers) and every TAIL_READING_MS while the loop waits for the pending
// answers, so every probe interval is bracketed by readings; `aborted` ends the loop early (a refusal was met).
interface ProbeHooks {
  readonly reading: (atMs: number) => void;
  readonly aborted: () => boolean;
}

// How often the contention is read while the loop waits for the pending answers (a probe that is never answered ends 10 s after its send).
const TAIL_READING_MS = 100;

// Sends one `get_state` and resolves with its sample: the latency from the send to the response frame with the same id, or undefined
// when none arrived within PROBE_ANSWER_TIMEOUT_MS (or Omp had exited).
function probeOnce(omp: OmpSession, id: string, origin: number, hooks?: ProbeHooks): Promise<ProbeSample> {
  const sentAt = performance.now();
  const sentAtMs = Math.round(sentAt - origin);
  hooks?.reading(sentAtMs);
  omp.send({ id, type: "get_state" });
  return omp
    .waitFor((session) => session.frames.some((frame) => frame["type"] === "response" && frame["id"] === id), scaledMs(PROBE_ANSWER_TIMEOUT_MS), `get_state ${id}`)
    .then(
      () => {
        const latencyMs = Math.round(performance.now() - sentAt);
        hooks?.reading(sentAtMs + latencyMs);
        return { sentAtMs, latencyMs };
      },
      () => ({ sentAtMs, latencyMs: undefined }),
    );
}

interface ProbeLoopOptions {
  readonly prefix: string;
  // Called before each send with the tick number and the milliseconds since the loop began; true ends the loop.
  readonly stop: (tick: number, elapsedMs: number) => boolean;
  readonly hooks?: ProbeHooks;
}

// Probes every PROBE_INTERVAL_MS, on a fixed schedule (a slow tick does not push the later ones), until `stop` says so, then waits for
// the pending answers. An Omp that exited ended the loop too: the probes after it would only be unanswered writes to a closed pipe.
async function probeLoop(omp: OmpSession, options: ProbeLoopOptions): Promise<ProbeSample[]> {
  const origin = performance.now();
  const pending: Promise<ProbeSample>[] = [];
  // Held in an object: the exit handler assigns it after the loop began.
  const state = { gone: false };
  void omp.exited.then(() => {
    state.gone = true;
  });
  for (let tick = 0; ; tick += 1) {
    if (state.gone || options.stop(tick, performance.now() - origin) || options.hooks?.aborted() === true) {
      break;
    }
    pending.push(probeOnce(omp, `${options.prefix}-${String(tick)}`, origin, options.hooks));
    // A real wait: the probe interval is the measurement itself, so fake timers cannot stand in for it.
    await sleep(Math.max(0, origin + (tick + 1) * PROBE_INTERVAL_MS - performance.now()));
  }
  const { hooks } = options;
  const tail = hooks === undefined ? undefined : setInterval(() => {
    hooks.reading(Math.round(performance.now() - origin));
  }, TAIL_READING_MS);
  try {
    return await Promise.all(pending);
  } finally {
    clearInterval(tail);
  }
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
  readonly pressures: PressureReading[];
}

function createRecorder(t: TestContext): Recorder {
  const cleanups = createCleanups();
  t.after(() => cleanups.run());
  const transcript: string[] = [];
  const loads: HostLoad[] = [];
  const pressures: PressureReading[] = [];
  cleanups.add(() => {
    const files = { [`${EVIDENCE_PREFIX}.transcript.txt`]: () => transcript.join("\n") };
    for (const problem of writeEvidence(process.env[EVIDENCE_DIR_VARIABLE], files)) {
      t.diagnostic(problem);
    }
  });
  return { t, cleanups, transcript, loads, pressures };
}

function note(recorder: Recorder, text: string): void {
  recorder.transcript.push(text);
  recorder.t.diagnostic(text);
}

function saveEvidence(recorder: Recorder, phase: string, csv: string, text: string): void {
  const files = { [`${EVIDENCE_PREFIX}.${phase}.samples.csv`]: () => csv, [`${EVIDENCE_PREFIX}.${phase}.summary.txt`]: () => text };
  for (const problem of writeEvidence(process.env[EVIDENCE_DIR_VARIABLE], files)) {
    recorder.t.diagnostic(problem);
  }
}

// One reading of the host CPU pressure at a load reading, with the label of that reading.
interface PressureReading {
  readonly label: string;
  readonly pressure: CpuPressure | null;
}

// The "some" line of the CPU pressure file as numbers, or null when the file is absent or unreadable. Evidence for the baseline finding
// F-44-01 (the load average per CPU does not describe the contention Omp sees); never a validity condition, and it never fails a test.
function readPressure(): CpuPressure | null {
  try {
    return parsePressure(readFileSync(PRESSURE_FILE, "utf8"));
  } catch {
    return null;
  }
}

// A load reading and a pressure reading together, both kept in the recorder and the pressure noted in the transcript.
function takeReading(recorder: Recorder, label: string): HostLoad {
  const load = loadNow(label);
  recorder.loads.push(load);
  const pressure = readPressure();
  recorder.pressures.push({ label, pressure });
  note(recorder, `cpu pressure ${label}: ${pressure === null ? "not readable" : `some avg10 ${pressure.avg10.toFixed(2)} avg60 ${pressure.avg60.toFixed(2)} avg300 ${pressure.avg300.toFixed(2)}`}`);
  return load;
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

// Omp without an extension: the same spawn as startOmp (its own process group, piped stdio) with the extension-free arguments, and the
// wrapper argv in front when there is one (the scope of the scoped runs).
function startBaselineOmp(env: Readonly<Record<string, string>>, cwd: string, wrap: readonly string[] = []): OmpSession {
  const [wrapper, ...wrapArgs] = wrap;
  const command = wrapper ?? OMP_BIN;
  const args = wrapper === undefined ? [...BASELINE_OMP_ARGS] : [...wrapArgs, OMP_BIN, ...BASELINE_OMP_ARGS];
  const child = spawn(command, args, { cwd, env: { ...env }, stdio: ["pipe", "pipe", "pipe"], detached: true });
  const exited = new Promise<OmpExit>((resolve) => {
    child.once("error", (error) => {
      resolve({ code: null, signal: null, error: error.message });
    });
    child.once("close", (code, signal) => {
      resolve({ code, signal });
    });
  });
  return new OmpSession({ stdin: child.stdin, stdout: child.stdout, stderr: child.stderr, pid: child.pid, kill: (signal) => killGroup(child, signal) }, exited);
}

// The quiet-host check before the baseline (and before the control): the load is recorded and noted, and a host that is not quiet fails
// unless the run is explicitly allowed to proceed loaded. Returns the label the run carries ("quiet" or "loaded").
function checkQuietHost(recorder: Recorder): "quiet" | "loaded" {
  const before = takeReading(recorder, "before the baseline");
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
// pass the bounds with the baseline's probe minimum. Returns the label the run carries ("quiet" or "loaded") and the baseline's summary,
// which the cold attach's control-relative secondary reading is taken against.
async function measureBaseline(recorder: Recorder, profile: OmpProfile): Promise<{ readonly label: "quiet" | "loaded"; readonly summary: LatencySummary }> {
  const label = checkQuietHost(recorder);
  const omp = startBaselineOmp(profile.env, profile.workspace);
  registerClose(recorder, "baseline", omp);
  await omp.ready(OMP_READY_TIMEOUT_MS);
  const samples = await probeLoop(omp, { prefix: "baseline", stop: (tick) => tick * PROBE_INTERVAL_MS > BASELINE_WINDOW_MS });
  takeReading(recorder, "after the baseline");
  const summary = summariseLatencies(samples);
  const text = summaryText(`baseline (${label})`, summary, recorder.loads);
  saveEvidence(recorder, "baseline", samplesCsv(samples), text);
  note(recorder, `baseline (${label}): ${String(summary.sent)} probes, ${String(summary.unanswered)} unanswered, max ${String(summary.maxMs)} ms, median ${String(summary.medianMs)} ms, p95 ${String(summary.p95Ms)} ms, longest gap ${String(summary.longestGapMs)} ms`);
  const problems = responsivenessProblems(summary, { minProbes: BASELINE_MIN_PROBES, minWindowMs: BASELINE_MIN_WINDOW_MS });
  assert.deepEqual(problems, [], `the baseline (${label}) does not pass: ${problems.join("; ")}`);
  await omp.close(CLOSE_OPTIONS);
  return { label, summary };
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
    pressure: recorder.pressures,
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

function saveRecord(recorder: Recorder, name: string, record: unknown, extra: Readonly<Record<string, string>> = {}): void {
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

// The arrival, in milliseconds from the session's construction, of the first response frame whose id carries the prefix: the moment Omp
// answered its first probe of that run. Undefined while no probe was answered.
function firstAnswerArrivalMs(omp: OmpSession, prefix: string): number | undefined {
  for (const [index, frame] of omp.frames.entries()) {
    if (frame["type"] === "response" && typeof frame["id"] === "string" && frame["id"].startsWith(prefix)) {
      return omp.frameArrivalsMs[index];
    }
  }
  return undefined;
}

interface ControlRun {
  readonly omp: OmpSession;
  readonly samples: ProbeSample[];
}

interface ControlSpec {
  // The evidence label of the frames and stderr, and the probe id prefix (ids read `<prefix>-<tick>`).
  readonly label: string;
  readonly prefix: string;
  // Called before each send with the session and the milliseconds since the loop began; true ends the loop.
  readonly done: (omp: OmpSession, elapsedMs: number) => boolean;
}

// Omp with no extension, probed from process start with no wait for the ready frame: the first answer is Omp's own boot. The control test
// and the paired arm share this run and differ in the stop rule.
async function runControl(recorder: Recorder, profile: OmpProfile, spec: ControlSpec): Promise<ControlRun> {
  const omp = startBaselineOmp(profile.env, profile.workspace);
  registerClose(recorder, spec.label, omp);
  const samples = await probeLoop(omp, { prefix: spec.prefix, stop: (_tick, elapsedMs) => spec.done(omp, elapsedMs) });
  return { omp, samples };
}

void test(
  "V1LIVE-01 omp responsiveness control with no extension, probed from process start",
  { skip: baselineSkip, timeout: BASELINE_TIMEOUT_MS },
  async (t) => {
    const recorder = createRecorder(t);
    const profile = await startScriptedProfile(recorder);
    const label = checkQuietHost(recorder);
    // Ends once a probe was answered and the minimum window has passed, or at the maximum.
    const { omp, samples } = await runControl(recorder, profile, {
      label: "control",
      prefix: "control",
      done: (session, elapsedMs) => (firstAnswerArrivalMs(session, "control-") !== undefined && elapsedMs >= CONTROL_MIN_WINDOW_MS) || elapsedMs >= scaledMs(CONTROL_MAX_WINDOW_MS),
    });
    takeReading(recorder, "after the control");
    const summary = summariseLatencies(samples);
    saveEvidence(recorder, "control", samplesCsv(samples), summaryText(`control (${label}, no extension, probed from process start)`, summary, recorder.loads));
    saveRecord(recorder, CONTROL_RECORD_FILE, buildRunRecord("control", recorder, omp, samples));
    note(recorder, `control (${label}): ${String(summary.sent)} probes, ${String(summary.unanswered)} unanswered, first answer ${String(firstAnswerMs(samples))} ms from process start`);
    assert.ok(summary.answered > 0, `the control is invalid: Omp with no extension answered no probe in ${String(summary.windowMs)} ms`);
  },
);

// ---- The cold-attach setup shared by the cold attach and the paired arm ----------------------------------------------------------

interface ColdSetup {
  readonly inputs: LiveInputs;
  readonly scenario: ScenarioEnvironment;
  readonly projectDir: string;
  readonly suffix: string;
  readonly profile: OmpProfile;
  // The environment of the extension session.
  readonly ompEnv: Readonly<Record<string, string>>;
}

// The scenario, the project directory under the pinned workspace root, the isolated profile and the cleanups of the removal scope (see the
// header): the daemon the plugin starts is stopped, the shared state entries and the files this run created are removed, and the residue is
// checked. Cleanups run last in, first out: Omp closes first, then the profile and the provider go, then the daemon is stopped.
async function setupColdAttach(recorder: Recorder, inputs: LiveInputs): Promise<ColdSetup> {
  const scenario: ScenarioEnvironment = createScenarioEnvironment(inputs, { image: inputs.image });
  const suffix = randomBytes(6).toString("hex");
  // The project Omp starts in: a directory inside the pinned workspace root, so it is inside a policy root.
  const projectDir = join(inputs.workspaceRoot, `omp-resp-${suffix}`);
  const hostsDir = inputs.driverStateDir === undefined ? undefined : join(inputs.driverStateDir, "hosts");
  const hostsDirExisted = hostsDir !== undefined && existsSync(hostsDir);
  const presenceDirExisted = hostsDir !== undefined && existsSync(join(hostsDir, "omp-active"));
  const sandboxes: string[] = [];

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
  return { inputs, scenario, projectDir, suffix, profile, ompEnv };
}

// A daemon of the account that is already running would hide the cold attach: the measurement needs none.
async function assertNoDaemonAtStart(setup: ColdSetup): Promise<void> {
  const absent = await realmCliWithWorkspace(setup.inputs, setup.scenario, ["status"], setup.projectDir, 30_000);
  assert.equal(absent.exitCode, 0, `realm status before the attach: ${describeResult(absent)}`);
  assert.equal(absent.stdout.trim(), "disconnected", `a realm daemon of this account is running; stop it with realm down before the cold-attach measurement: ${describeResult(absent)}`);
  const daemons = await findDaemonPids(setup.inputs, fileURLToPath(new URL("../../src/daemon/main.js", import.meta.url)));
  assert.ok(daemons.ok, `list the daemon processes: ${describeValue(daemons)}`);
  assert.deepEqual(daemons.pids, [], "a realm daemon process of this account is running; the cold attach needs none");
}

// The cold attach probe loop: from process start, until realm active is shown and MIN_WINDOW_MS have passed since the ready frame
// arrived (Phase 44 correction, 44-CONTEXT D-44-03), or at the maximum.
function coldProbeLoop(omp: OmpSession, prefix: string, hooks?: ProbeHooks): Promise<ProbeSample[]> {
  return probeLoop(omp, {
    prefix,
    ...(hooks === undefined ? {} : { hooks }),
    stop: (_tick, elapsedMs) => {
      const readyMs = startupOrder(omp.frames, omp.frameArrivalsMs).readyMs;
      const sinceReadyMs = readyMs === undefined ? undefined : elapsedMs - readyMs;
      return windowStopReached(sinceReadyMs, omp.status()?.includes("realm active") === true, MIN_WINDOW_MS) || elapsedMs > scaledMs(ATTACH_ACTIVE_TIMEOUT_MS);
    },
  });
}

// The samples CSV with the phase column when the ready time is known, the plain one otherwise.
function csvFor(samples: readonly ProbeSample[], readyMs: number | undefined): string {
  return readyMs === undefined ? samplesCsv(samples) : samplesCsvWithPhase(samples, readyMs);
}

// ---- The cold attach -------------------------------------------------------------------------------------------------------------

void test(
  "V1LIVE-01 omp responsiveness cold attach: get_state stays answered from Omp ready until realm active",
  { skip: coldSkip, timeout: COLD_TIMEOUT_MS },
  async (t) => {
    assert.ok(live !== undefined, "the cold-attach test ran although its gate is closed");
    const recorder = createRecorder(t);
    const setup = await setupColdAttach(recorder, live);
    const baseline = await measureBaseline(recorder, setup.profile);
    await assertNoDaemonAtStart(setup);

    const beforeSession = takeReading(recorder, "before the extension session");
    note(recorder, `host load before the extension session: ${beforeSession.load1.toFixed(2)} on ${String(beforeSession.cpus)} cpus`);
    const omp = startOmp({ bin: OMP_BIN, env: setup.ompEnv, cwd: setup.projectDir, extensionPath: EXTENSION_PATH });
    registerClose(recorder, "attach", omp);
    const samples = await coldProbeLoop(omp, "attach");
    const reachedActive = omp.status()?.includes("realm active") === true;
    takeReading(recorder, "after the extension session");
    const startup = startupOrder(omp.frames, omp.frameArrivalsMs);
    const readyAtMs = startup.readyMs;
    // The verdict reads the window from the ready frame; the numbers over every sample are still computed and written beside it.
    const split = readyAtMs === undefined ? undefined : { readyAtMs, ...splitAtReady(samples, readyAtMs) };
    const allSummary = summariseLatencies(samples);
    const windowSummary = split === undefined ? undefined : summariseLatencies(split.window);
    const bootSummary = split === undefined ? undefined : summariseLatencies(split.boot);
    const relative = windowSummary === undefined ? undefined : relativeSummary(windowSummary, baseline.summary);
    const heading = `cold attach (${baseline.label} baseline, realm active reached: ${String(reachedActive)})`;
    const text =
      readyAtMs === undefined || windowSummary === undefined || bootSummary === undefined || relative === undefined
        ? summaryText(`${heading}, Omp ready frame not seen`, allSummary, recorder.loads)
        : summaryTextWithSecondary(heading, { readyAtMs, window: windowSummary, all: allSummary, boot: bootSummary, firstAnswerMs: firstAnswerMs(samples), relative, referenceLabel: "the in-run baseline" }, recorder.loads);
    saveEvidence(recorder, "attach", csvFor(samples, readyAtMs), text);
    // The record and the timeline, before any assertion that can fail on a latency. The baseline and the no-daemon check are asserted
    // above, so reaching this point means both held; validity adds the two quiet readings, realm active and the ready frame (first failed
    // condition wins).
    const base = buildRunRecord("cold-attach", recorder, omp, samples);
    const invalidReason =
      base["quietBeforeBaseline"] !== true
        ? "host not quiet before the baseline"
        : base["quietBeforeSession"] !== true
          ? "host not quiet before the extension session"
          : !reachedActive
            ? "realm active not reached"
            : readyAtMs === undefined
              ? "Omp ready frame not seen"
              : null;
    const controlFirstAnswer = controlFirstAnswerFromEvidence();
    const classified = controlFirstAnswer === undefined || readyAtMs === undefined ? undefined : classifyRun(samples, [controlFirstAnswer], readyAtMs);
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
        readyAtMs: readyAtMs ?? null,
        verdictProblems: windowSummary === undefined ? null : responsivenessProblems(windowSummary),
        windowSummary: windowSummary ?? null,
        allSamplesSummary: allSummary,
        bootSummary: bootSummary ?? null,
        relative: relative ?? null,
        controlFirstAnswerMs: controlFirstAnswer ?? null,
        bootExcessMs: classified?.bootExcessMs ?? null,
        case: classified?.case ?? null,
      },
      { [`${EVIDENCE_PREFIX}.attach.timeline.txt`]: timelineText(startup, firstAnswerMs(samples), realmActiveArrivalMs(omp)) },
    );
    note(recorder, `cold attach: ${String(allSummary.sent)} probes over ${String(allSummary.windowMs)} ms, ${String(allSummary.unanswered)} unanswered, max ${String(allSummary.maxMs)} ms, longest gap ${String(allSummary.longestGapMs)} ms (uncorrected, from process start), realm active reached: ${String(reachedActive)}`);
    if (windowSummary !== undefined) {
      note(recorder, `cold attach window from ready: ${String(windowSummary.sent)} probes over ${String(windowSummary.windowMs)} ms, ${String(windowSummary.unanswered)} unanswered, max ${String(windowSummary.maxMs)} ms, median ${String(windowSummary.medianMs)} ms, p95 ${String(windowSummary.p95Ms)} ms`);
    }
    assert.ok(reachedActive, `the status line never showed realm active within ${String(ATTACH_ACTIVE_TIMEOUT_MS)} ms; status: ${String(omp.status())}`);
    assert.ok(windowSummary !== undefined, "the Omp ready frame never arrived, so the window from ready cannot be read");
    const problems = responsivenessProblems(windowSummary);
    assert.deepEqual(problems, [], `Omp was not responsive during the cold attach: ${problems.join("; ")}`);
    // The session is still a working one: it answers a command after the attach.
    omp.send({ id: `commands-${setup.suffix}`, type: "get_available_commands" });
    await omp.waitFor((session) => session.frames.some((frame) => frame["type"] === "response" && frame["id"] === `commands-${setup.suffix}`), COMMANDS_TIMEOUT_MS, "get_available_commands after the attach");
  },
);

// ---- The scoped runs (Phase 45) --------------------------------------------------------------------------------------------------

// How long a scoped Omp has to replace the wrapper (systemd-run execs the command in place once its scope exists), and how often it is looked at.
const SCOPE_VERIFY_TIMEOUT_MS = 10_000;
const SCOPE_POLL_MS = 10;
// The serving window of a scoped control (and of the calibration control) is the probes sent from the ready frame; the loop stops two probe
// intervals past the minimum window, so the window holds at least MIN_PROBES probes and spans at least MIN_WINDOW_MS, as the cold window does.
const CONTROL_SERVING_STOP_MS = MIN_WINDOW_MS + 2 * PROBE_INTERVAL_MS;
const procReader = createFsReader();

// One scoped Omp run, measured: its session, the probes, the contention readings, the ready time, the thread split read at the end of the
// window and the refusal that ended it, if any.
interface ScopedPart {
  readonly omp: OmpSession;
  readonly samples: ProbeSample[];
  readonly readings: readonly ContentionReading[];
  readonly readyMs: number | undefined;
  readonly threads: ThreadSplit | null;
  readonly refusal: Refusal | null;
}

interface ScopedCold extends ScopedPart {
  readonly reachedActive: boolean;
  readonly commandsAnswered: boolean;
}

// The environment of a scoped Omp: the environment of the unscoped run plus XDG_RUNTIME_DIR, which systemd-run --user needs to reach the
// user manager. Nothing else is added.
function scopedEnv(env: Readonly<Record<string, string>>): Record<string, string> {
  const runtimeDir = process.env["XDG_RUNTIME_DIR"];
  return runtimeDir === undefined ? { ...env } : { ...env, XDG_RUNTIME_DIR: runtimeDir };
}

// The system CPU pressure and the one-minute load per CPU at a moment of a run: descriptive numbers of the record, never a validity input.
function hostReading(label: HostReading["label"]): HostReading {
  const [load1 = 0] = loadavg();
  return { label, pressure: readPressure(), loadPerCpu: load1 / Math.max(cpus().length, 1) };
}

type ScopeOutcome = { readonly scopeDir: string | null } | { readonly refusal: Refusal };

// The scope of the child, once systemd-run has replaced itself with Omp: Branch N has none; Branch S waits for the wrapper to be gone
// (bounded) and verifies the cgroup. A wrapper that exited first is a scope command that failed.
async function establishScope(omp: OmpSession, pid: number): Promise<ScopeOutcome> {
  if (DESIGN_BRANCH === "N") {
    return { scopeDir: null };
  }
  const state = { gone: false };
  void omp.exited.then(() => {
    state.gone = true;
  });
  const deadline = performance.now() + SCOPE_VERIFY_TIMEOUT_MS;
  for (;;) {
    const check = verifyScopedChild(pid, null, procReader);
    if (check.ok) {
      return { scopeDir: check.scopeDir };
    }
    if (state.gone) {
      return { refusal: "scope command failed" };
    }
    // Until the deadline every refusal is retried: right after the spawn the child is still the harness's own fork, then the wrapper, then
    // Omp in its scope.
    if (performance.now() > deadline) {
      return { refusal: check.refusal };
    }
    await sleep(SCOPE_POLL_MS);
  }
}

// Runs one probe loop over a started scoped Omp with the contention sampler reading at every probe send and answer, then reads the thread
// split while Omp is still alive. The loop starts at once (the probes are from process start); the scope is verified beside it, and a
// refusal ends the loop.
async function measureScopedPart(omp: OmpSession, probe: (hooks: ProbeHooks) => Promise<ProbeSample[]>): Promise<ScopedPart> {
  const pid = omp.pid;
  if (pid === undefined) {
    return { omp, samples: [], readings: [], readyMs: undefined, threads: null, refusal: "child has no process id" };
  }
  const state: { sampler: ContentionSampler | undefined; refusal: Refusal | null; stamp: number } = { sampler: undefined, refusal: null, stamp: 0 };
  const established = establishScope(omp, pid).then((outcome) => {
    if ("refusal" in outcome) {
      state.refusal = outcome.refusal;
    } else {
      state.sampler = createContentionSampler({ pid, scopeDir: outcome.scopeDir, reader: procReader, nowMs: () => state.stamp });
    }
  });
  const hooks: ProbeHooks = {
    reading: (atMs) => {
      const { sampler } = state;
      if (sampler === undefined) {
        return;
      }
      state.stamp = atMs;
      const result = sampler.read("probe");
      if (!result.ok) {
        state.refusal ??= result.refusal;
      }
    },
    aborted: () => state.refusal !== null,
  };
  const samples = await probe(hooks);
  await established;
  const split = state.refusal === null ? readThreadSplit(pid, procReader) : undefined;
  const threads = split?.ok === true ? split.split : null;
  const splitRefusal = split !== undefined && !split.ok ? split.refusal : null;
  return {
    omp,
    samples,
    readings: state.sampler?.readings() ?? [],
    readyMs: startupOrder(omp.frames, omp.frameArrivalsMs).readyMs,
    threads,
    refusal: state.refusal ?? splitRefusal,
  };
}

// Omp with no extension in its own scope, probed from process start until its serving window is complete (or at the maximum): the control
// part of the arm test and the calibration control are this one function.
async function runScopedControl(recorder: Recorder, profile: OmpProfile, label: string, prefix: string): Promise<ScopedPart> {
  const omp = startBaselineOmp(scopedEnv(profile.env), profile.workspace, scopedWrap(DESIGN_BRANCH));
  registerClose(recorder, label, omp);
  return measureScopedPart(omp, (hooks) =>
    probeLoop(omp, {
      prefix,
      hooks,
      stop: (_tick, elapsedMs) => {
        const readyMs = startupOrder(omp.frames, omp.frameArrivalsMs).readyMs;
        return (readyMs !== undefined && elapsedMs - readyMs >= CONTROL_SERVING_STOP_MS) || elapsedMs >= scaledMs(CONTROL_MAX_WINDOW_MS);
      },
    }),
  );
}

// The cold attach in its own scope (the same wrapper as the control), then get_available_commands after it: the session is still a working one.
async function runScopedCold(recorder: Recorder, setup: ColdSetup, label: string, prefix: string): Promise<ScopedCold> {
  const omp = startOmp({ bin: OMP_BIN, env: scopedEnv(setup.ompEnv), cwd: setup.projectDir, extensionPath: EXTENSION_PATH, wrap: scopedWrap(DESIGN_BRANCH) });
  registerClose(recorder, label, omp);
  const part = await measureScopedPart(omp, (hooks) => coldProbeLoop(omp, prefix, hooks));
  const reachedActive = omp.status()?.includes("realm active") === true;
  const commandId = `commands-${setup.suffix}`;
  let commandsAnswered = false;
  if (reachedActive) {
    omp.send({ id: commandId, type: "get_available_commands" });
    commandsAnswered = await omp.waitFor((session) => session.frames.some((frame) => frame["type"] === "response" && frame["id"] === commandId), COMMANDS_TIMEOUT_MS, "get_available_commands after the attach").then(
      () => true,
      () => false,
    );
  }
  return { ...part, reachedActive, commandsAnswered };
}

// A control answered when a probe was answered and its serving window (the probes sent from the ready frame) holds at least MIN_PROBES.
function controlHeld(part: ScopedPart): boolean {
  const readyMs = part.readyMs;
  return readyMs !== undefined && part.samples.some((sample) => sample.latencyMs !== undefined) && part.samples.filter((sample) => sample.sentAtMs >= readyMs).length >= MIN_PROBES;
}

const EMPTY_PART: PartParts = { samples: [], readings: [], readyMs: undefined, threads: null };

function partOf(part: ScopedPart | undefined): PartParts {
  return part === undefined ? EMPTY_PART : { samples: part.samples, readings: part.readings, readyMs: part.readyMs, threads: part.threads };
}

// ---- The paired arm --------------------------------------------------------------------------------------------------------------

const PAIRED_RECORD_FILE = `${EVIDENCE_PREFIX}.paired.record.json`;

// One arm of one pair of the paired loaded A/B (Phase 44, 44-CONTEXT D-44-06; Phase 45, D-45-03, D-45-06 and D-45-07). In order: the
// no-daemon check; then the two parts in the order the run index sets (controlFirst(runIndexOf(pair, arm)): the control first when odd, the
// cold attach first when even, a cold-first run stopping its own daemon with realm down before the control): the control (Omp with no
// extension, in its own scope, probed from process start until its serving window is complete) and the cold attach (in the same kind of
// scope; get_available_commands after the attach); the record. It asserts mechanics only and no latency: the verdict and the pair
// decision are computed from the records by test/support/omp-window-analysis.ts, never by this test. A refusal writes the record with its
// phrase and then fails the test, REFUSED first; so does a mechanics failure. The run is labelled loaded, paired with its tier and never
// claims a quiet host; it does not require one, reads no load average as a validity input and does not read the loaded-host escape variable.
void test(
  "V1LIVE-01 omp responsiveness paired arm (scoped, loaded, paired A/B of Phase 44 and 45)",
  { skip: pairedSkip, timeout: COLD_TIMEOUT_MS },
  async (t) => {
    assert.ok(live !== undefined && pairedArm !== undefined && pairedPair !== undefined, "the paired arm test ran although its gate is closed");
    const startedAtEpochMs = Date.now();
    const runIndex = runIndexOf(pairedPair, pairedArm);
    const controlOrder = controlFirst(runIndex);
    const recorder = createRecorder(t);
    const setup = await setupColdAttach(recorder, live);
    const host: HostReading[] = [hostReading("start")];

    // The no-daemon check is a mechanic: a failure is recorded and fails the test after the record, like every other mechanic.
    const state: { problem: string | undefined } = { problem: undefined };
    await assertNoDaemonAtStart(setup).catch((error: unknown) => {
      state.problem = error instanceof Error ? error.message : String(error);
    });
    let control: ScopedPart | undefined;
    let cold: ScopedCold | undefined;
    if (state.problem === undefined) {
      if (controlOrder) {
        control = await runScopedControl(recorder, setup.profile, "paired.control", "pcontrol");
        await control.omp.close(CLOSE_OPTIONS);
        host.push(hostReading("between"));
        if (control.refusal === null) {
          cold = await runScopedCold(recorder, setup, "paired.cold", "pcold");
        }
      } else {
        cold = await runScopedCold(recorder, setup, "paired.cold", "pcold");
        await cold.omp.close(CLOSE_OPTIONS);
        host.push(hostReading("between"));
        // The cold attach started a daemon: stop it before the control, which needs none.
        const stopped = await realmCliWithWorkspace(live, setup.scenario, ["down"], setup.projectDir, DOWN_TIMEOUT_MS);
        if (stopped.exitCode !== 0) {
          state.problem = `realm down after the cold attach: ${describeResult(stopped)}`;
        } else if (cold.refusal === null) {
          control = await runScopedControl(recorder, setup.profile, "paired.control", "pcontrol");
        }
      }
    }
    host.push(hostReading("end"));

    const refusal = control?.refusal ?? cold?.refusal ?? null;
    const mechanicsHeld = state.problem === undefined && control !== undefined && controlHeld(control) && cold !== undefined && cold.reachedActive && cold.commandsAnswered;
    const record = buildArmRecord({
      arm: pairedArm,
      pair: pairedPair,
      branch: DESIGN_BRANCH,
      startedAtEpochMs,
      refusal,
      mechanicsHeld,
      control: partOf(control),
      cold: partOf(cold),
      host,
      bounds: CALIBRATED_BOUNDS,
    });
    const readings: Record<string, string> = {};
    if (control !== undefined) {
      saveEvidence(recorder, "paired.control", csvFor(control.samples, control.readyMs), summaryText(`paired control (${record.tier}, no extension, probed from process start)`, summariseLatencies(control.samples), []));
      readings[`${EVIDENCE_PREFIX}.paired.control.readings.csv`] = readingsCsv(control.readings);
    }
    if (cold !== undefined) {
      saveEvidence(recorder, "paired.cold", csvFor(cold.samples, cold.readyMs), summaryText(`paired cold attach (${PAIRED_LABEL}, ${record.tier}, realm active reached: ${String(cold.reachedActive)})`, summariseLatencies(cold.samples), []));
      readings[`${EVIDENCE_PREFIX}.paired.cold.readings.csv`] = readingsCsv(cold.readings);
    }
    saveRecord(recorder, PAIRED_RECORD_FILE, record, readings);
    note(recorder, `paired arm ${pairedArm} pair ${String(pairedPair)} run ${String(runIndex)} (${PAIRED_LABEL}, ${record.tier}, ${controlOrder ? "control first" : "cold attach first"}): ${record.validity.valid ? "valid" : `not valid by ${String(record.validity.rule)}`}, bounds applied: ${String(record.validity.boundsApplied)}`);
    if (refusal !== null) {
      assert.fail(`REFUSED: ${refusal}; the run is recorded and counts for nothing`);
    }
    assert.equal(state.problem, undefined, `the mechanics did not hold: ${String(state.problem)}`);
    assert.ok(control !== undefined && controlHeld(control), "the control is invalid: Omp with no extension answered no probe or did not complete its serving window");
    assert.ok(cold?.reachedActive === true, `the status line never showed realm active within ${String(ATTACH_ACTIVE_TIMEOUT_MS)} ms; status: ${String(cold?.omp.status())}`);
    assert.ok(cold.commandsAnswered, "the session did not answer get_available_commands after the attach");
  },
);

// ---- The calibration control -----------------------------------------------------------------------------------------------------

// One scoped control with no extension (45-CONTEXT D-45-08): the same wrapper, probe loop, ready window and serving window as the control
// part of the arm test, with no production stack. It records the control and asserts only that it answered; a refusal fails the test after
// the record is written. The validity inside the record is the mechanical rules only: the bounds are what the calibration derives.
void test(
  "V1LIVE-01 omp responsiveness calibration control (scoped, no extension, Phase 45)",
  { skip: calibrationSkip, timeout: BASELINE_TIMEOUT_MS },
  async (t) => {
    assert.ok(calibrationRun !== undefined, "the calibration test ran although its gate is closed");
    const startedAtEpochMs = Date.now();
    const recorder = createRecorder(t);
    const profile = await startScriptedProfile(recorder);
    const host: HostReading[] = [hostReading("start")];
    const part = await runScopedControl(recorder, profile, "calibration", "ccontrol");
    host.push(hostReading("end"));
    const held = controlHeld(part);
    const record = buildCalibrationRecord({ attempt: calibrationRun, branch: DESIGN_BRANCH, startedAtEpochMs, refusal: part.refusal, mechanicsHeld: held, control: partOf(part), host });
    saveEvidence(recorder, "calibration", csvFor(part.samples, part.readyMs), summaryText(`calibration control ${String(calibrationRun)} (${record.tier}, no extension)`, summariseLatencies(part.samples), []));
    saveRecord(recorder, `${EVIDENCE_PREFIX}.calibration.record.json`, record, { [`${EVIDENCE_PREFIX}.calibration.readings.csv`]: readingsCsv(part.readings) });
    note(recorder, `calibration control ${String(calibrationRun)} (${record.tier}): ${record.validity.valid ? "mechanically valid" : `not valid by ${String(record.validity.rule)}`}`);
    if (part.refusal !== null) {
      assert.fail(`REFUSED: ${part.refusal}; the control is recorded and counts for nothing`);
    }
    assert.ok(held, "the calibration control is invalid: Omp with no extension answered no probe or did not complete its serving window");
  },
);

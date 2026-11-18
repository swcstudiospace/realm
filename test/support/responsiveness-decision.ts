// The decision rule of the Omp cold-attach window (Phase 38, OMPR-01 and OMPR-02; 38-CONTEXT D-38-02 and D-38-03). Pure: no process, no
// clock, no environment, no file. The harness test/integration/omp-responsiveness.test.ts measures; this module turns the numbers
// into a case per run and an outcome per window. The hermetic test is test/support/responsiveness-decision.test.ts.
//
// The rule is frozen. It was written before any quiet-host number existed, and no constant or row below is edited after one does: a
// wrong rule is a finding and a replan, never a silent edit.
//
// The case of one valid run, from the cold-attach samples and the control first answers (Omp with no extension, probed from process
// start):
//   pass           the verdict (responsivenessProblems) is empty.
//   short-window   the verdict has only shortness problems (too few probes, a window under the minimum) and no latency problem: the
//                  attach finished before the window minimum, a harness defect.
//   serving-stall  a latency problem, and the same latency conditions over only the probes sent at or after the first answer are not
//                  empty: Omp stalls after it started serving, during the attach. Extension path.
//   boot-delay     a latency problem, nothing after the first answer, and the first answer comes more than BOOT_EXCESS_MAX_MS after the
//                  slowest control first answer: the extension delays Omp's start beyond its own boot. Extension load path.
//   own-boot       a latency problem, nothing after the first answer, and the first answer comes at most BOOT_EXCESS_MAX_MS after the
//                  slowest control first answer: Omp's own boot is inside the window and exceeds the maximum by itself, a harness defect.
//
// The outcome of the window, from the cases of the valid runs:
//   VOID     fewer than MIN_VALID_RUNS valid runs: no verdict.
//   CODE     at least MIN_VALID_RUNS valid runs and at least one serving-stall or boot-delay (this takes precedence over HARNESS).
//   HARNESS  at least MIN_VALID_RUNS valid runs, no serving-stall and no boot-delay, at least one own-boot or short-window.
//   PASS     at least MIN_VALID_RUNS valid runs, every case pass.
// All valid runs given are counted; a valid run is never discarded.
//
// Exports: MIN_VALID_RUNS, MAX_ATTEMPTS, BOOT_EXCESS_MAX_MS, CONTROL_MIN_WINDOW_MS, CONTROL_MAX_WINDOW_MS, RunCase, WindowOutcome,
// StartupOrder, RunClassification, WindowDecision, firstAnswerMs, servingProblems, bootExcessMs, startupOrder, classifyRun, decideWindow.

import { latencyProblems, type ProbeSample, responsivenessProblems, summariseLatencies } from "./responsiveness.js";

// The valid runs a window needs, and the most attempts it makes. An attempt that is not valid counts for nothing.
export const MIN_VALID_RUNS = 3;
export const MAX_ATTEMPTS = 6;
// One probe interval: a first answer that comes less than this much after the control's cannot be told from noise.
export const BOOT_EXCESS_MAX_MS = 250;
// The harness control (Omp with no extension) stops when at least one probe was answered and the minimum has elapsed, or at the maximum.
export const CONTROL_MIN_WINDOW_MS = 12_000;
export const CONTROL_MAX_WINDOW_MS = 60_000;

export type RunCase = "pass" | "short-window" | "serving-stall" | "boot-delay" | "own-boot";
export type WindowOutcome = "PASS" | "CODE" | "HARNESS" | "VOID";

// The time, from process start, at which the first answered probe was answered: the smallest send time plus latency among the
// answered probes. Undefined when none was answered.
export function firstAnswerMs(samples: readonly ProbeSample[]): number | undefined {
  let first: number | undefined;
  for (const sample of samples) {
    if (sample.latencyMs === undefined) {
      continue;
    }
    const answeredAt = sample.sentAtMs + sample.latencyMs;
    if (first === undefined || answeredAt < first) {
      first = answeredAt;
    }
  }
  return first;
}

// The latency problems over only the probes sent at or after the first answer (Omp is serving from then on): an unanswered later
// probe is a problem; an unanswered probe sent before the first answer is boot time and is not. When nothing was answered there is
// no serving time and the result is one problem line.
export function servingProblems(samples: readonly ProbeSample[]): string[] {
  const first = firstAnswerMs(samples);
  if (first === undefined) {
    return ["no probe was answered, so Omp never served"];
  }
  return latencyProblems(summariseLatencies(samples.filter((sample) => sample.sentAtMs >= first)));
}

// The cold first answer minus the largest control first answer, in milliseconds (negative when the cold run answered first). Undefined
// when the cold run has no first answer or there is no control.
export function bootExcessMs(coldFirstAnswerMs: number | undefined, controlFirstAnswersMs: readonly number[]): number | undefined {
  if (coldFirstAnswerMs === undefined || controlFirstAnswersMs.length === 0) {
    return undefined;
  }
  return coldFirstAnswerMs - Math.max(...controlFirstAnswersMs);
}

// When the ready frame and the first and last realm status paints arrived (milliseconds from the session start, as given), and whether
// ready came before the first paint (by frame order). A field is undefined when its frame is missing; readyFirst is undefined when
// either frame is missing.
export interface StartupOrder {
  readonly readyMs: number | undefined;
  readonly firstRealmStatusMs: number | undefined;
  readonly lastRealmStatusMs: number | undefined;
  readonly readyFirst: boolean | undefined;
}

// `frames` and `arrivalsMs` are parallel (OmpSession.frames and OmpSession.frameArrivalsMs); arrays of different length are refused.
// Only the ready frame and the setStatus frames with statusKey realm count; the first ready frame is the ready time.
export function startupOrder(frames: readonly Readonly<Record<string, unknown>>[], arrivalsMs: readonly number[]): StartupOrder {
  if (frames.length !== arrivalsMs.length) {
    throw new Error(`startupOrder needs one arrival time per frame: ${String(frames.length)} frames, ${String(arrivalsMs.length)} times`);
  }
  let readyIndex: number | undefined;
  let firstRealmIndex: number | undefined;
  let lastRealmIndex: number | undefined;
  for (const [index, frame] of frames.entries()) {
    if (readyIndex === undefined && frame["type"] === "ready") {
      readyIndex = index;
    }
    if (frame["type"] === "extension_ui_request" && frame["method"] === "setStatus" && frame["statusKey"] === "realm") {
      firstRealmIndex ??= index;
      lastRealmIndex = index;
    }
  }
  const at = (index: number | undefined): number | undefined => (index === undefined ? undefined : arrivalsMs[index]);
  return {
    readyMs: at(readyIndex),
    firstRealmStatusMs: at(firstRealmIndex),
    lastRealmStatusMs: at(lastRealmIndex),
    readyFirst: readyIndex === undefined || firstRealmIndex === undefined ? undefined : readyIndex < firstRealmIndex,
  };
}

export interface RunClassification {
  readonly case: RunCase;
  // responsivenessProblems of the cold samples: the existing verdict, empty for a pass.
  readonly verdict: readonly string[];
  readonly firstAnswerMs: number | undefined;
  readonly bootExcessMs: number | undefined;
  readonly servingProblems: readonly string[];
}

// The case of one valid run. `controlFirstAnswersMs` holds at least one time (a tuple type: an empty list does not compile); the
// largest is the control. When both shortness and latency problems are present the latency decides. A run with no probe sent has
// only the "nothing was measured" line, no latency problem, and reads short-window.
export function classifyRun(coldSamples: readonly ProbeSample[], controlFirstAnswersMs: readonly [number, ...number[]]): RunClassification {
  const verdict = responsivenessProblems(summariseLatencies(coldSamples));
  const first = firstAnswerMs(coldSamples);
  const excess = bootExcessMs(first, controlFirstAnswersMs);
  const serving = servingProblems(coldSamples);
  const measures = { verdict, firstAnswerMs: first, bootExcessMs: excess, servingProblems: serving };
  if (verdict.length === 0) {
    return { case: "pass", ...measures };
  }
  if (latencyProblems(summariseLatencies(coldSamples)).length === 0) {
    return { case: "short-window", ...measures };
  }
  if (serving.length > 0) {
    return { case: "serving-stall", ...measures };
  }
  // No serving problem means a first answer exists, so the excess is defined here.
  return { case: excess !== undefined && excess > BOOT_EXCESS_MAX_MS ? "boot-delay" : "own-boot", ...measures };
}

export interface WindowDecision {
  readonly outcome: WindowOutcome;
  // One line that names each case.
  readonly reason: string;
}

// The outcome of the window from the cases of its valid runs, in the order they ran.
export function decideWindow(cases: readonly RunCase[]): WindowDecision {
  const list = cases.length === 0 ? "none" : cases.join(", ");
  const summary = `${String(cases.length)} valid runs (${list})`;
  if (cases.length < MIN_VALID_RUNS) {
    return { outcome: "VOID", reason: `${summary}: fewer than ${String(MIN_VALID_RUNS)} valid runs, so no verdict` };
  }
  const extension = cases.filter((c) => c === "serving-stall" || c === "boot-delay");
  if (extension.length > 0) {
    return { outcome: "CODE", reason: `${summary}: ${extension.join(", ")} fired, so the extension path is the finding` };
  }
  const harness = cases.filter((c) => c === "own-boot" || c === "short-window");
  if (harness.length > 0) {
    return { outcome: "HARNESS", reason: `${summary}: ${harness.join(", ")} fired and no extension case, so the window is the finding` };
  }
  return { outcome: "PASS", reason: `${summary}: every case is pass` };
}

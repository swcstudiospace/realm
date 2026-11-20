// Pure helpers of the gated live test of the daemon stop (Phase 41, test/integration/daemon-stop-live.test.ts). The live test stops
// a real daemon that holds a real sandbox container, repeatedly, and judges what the daemon reported and what it left behind.
// Everything here takes its inputs as parameters: no process is started, no file is read and the environment is not touched, so
// the hermetic file test/integration/daemon-stop-live-helpers.test.ts covers every branch on any host.
//
// Nothing here carries a path, an environment value or a container id into an evidence text.

import { isAbsolute } from "node:path";
import { productionSkipReason, type ProductionGateInputs } from "./production-live.js";

// ---- Gate -----------------------------------------------------------------------------------------------------------------

export const LIVE_STOP_VARIABLE = "REALM_LIVE_STOP";
export const LIVE_STOP_REPEATS_VARIABLE = "REALM_LIVE_STOP_REPEATS";
export const LIVE_STOP_VARIANTS_VARIABLE = "REALM_LIVE_STOP_VARIANTS";
export const STOP_EVIDENCE_DIR_VARIABLE = "REALM_STOP_EVIDENCE_DIR";

export type Variant = "a" | "b" | "c";
const ALL_VARIANTS: readonly Variant[] = ["a", "b", "c"];

export const DEFAULT_REPEATS = 5;
export const MIN_REPEATS = 1;
export const MAX_REPEATS = 20;

// A whole number of repeats from 1 to 20. Absent, blank or non-numeric gives the default; a whole number out of range is
// clamped to the nearest end; a decimal is not a whole number and gives the default.
export function parseRepeats(raw: string | undefined): number {
  if (raw === undefined || !/^\s*\d+\s*$/.test(raw)) {
    return DEFAULT_REPEATS;
  }
  return Math.min(MAX_REPEATS, Math.max(MIN_REPEATS, Number(raw.trim())));
}

// A comma list over the letters a, b and c. Absent or blank gives all three. An unknown letter, or an empty element, makes the
// whole value invalid. The result lists each chosen variant once, in the order a, b, c.
export type ParsedVariants = { readonly ok: true; readonly variants: readonly Variant[] } | { readonly ok: false };

export function parseVariants(raw: string | undefined): ParsedVariants {
  if (raw === undefined || raw.trim() === "") {
    return { ok: true, variants: ALL_VARIANTS };
  }
  const chosen = new Set<Variant>();
  for (const part of raw.split(",")) {
    const letter = ALL_VARIANTS.find((variant) => variant === part.trim());
    if (letter === undefined) {
      return { ok: false };
    }
    chosen.add(letter);
  }
  return { ok: true, variants: ALL_VARIANTS.filter((variant) => chosen.has(variant)) };
}

// The reason the live stop test cannot run, or false. The first missing prerequisite, in this order: the production gate (the
// same inputs productionSkipReason takes), the opt-in REALM_LIVE_STOP exactly "1" (the test never sets it), an evidence directory
// that is an absolute path to an existing directory, and a valid variant list. The reason names the variable, never a value.
export function daemonStopSkipReason(inputs: ProductionGateInputs): string | false {
  const production = productionSkipReason(inputs);
  if (production !== false) {
    return production;
  }
  const { env } = inputs;
  if (env[LIVE_STOP_VARIABLE] !== "1") {
    return `${LIVE_STOP_VARIABLE}=1 is not set; the daemon stop live test needs an explicit operator opt-in`;
  }
  const evidenceDir = env[STOP_EVIDENCE_DIR_VARIABLE];
  if (evidenceDir === undefined || !isAbsolute(evidenceDir) || !inputs.isDirectory(evidenceDir)) {
    return `${STOP_EVIDENCE_DIR_VARIABLE} is not an absolute path to an existing directory; the evidence of each iteration is written there, outside the repository`;
  }
  if (!parseVariants(env[LIVE_STOP_VARIANTS_VARIABLE]).ok) {
    return `${LIVE_STOP_VARIANTS_VARIABLE} is not a comma list over a, b and c`;
  }
  return false;
}

// ---- The daemon's stop records --------------------------------------------------------------------------------------------

export interface StopRecord {
  readonly event: "daemon.stopping" | "daemon.stopped";
  readonly ts: string;
  readonly row: Readonly<Record<string, unknown>>;
}

// The daemon.stopping and daemon.stopped rows of a request log whose ts is at or after sinceIso, in file order. A line that is
// not JSON is ignored (the file sink may hold a partial line), and so is a row with no parsable ts.
export function stopRecordsOf(logText: string, sinceIso: string): readonly StopRecord[] {
  const since = Date.parse(sinceIso);
  if (Number.isNaN(since)) {
    throw new RangeError("sinceIso must be a date");
  }
  const records: StopRecord[] = [];
  for (const line of logText.split(/\r?\n/)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      continue;
    }
    const row = parsed as Record<string, unknown>;
    const { event, ts } = row;
    if ((event !== "daemon.stopping" && event !== "daemon.stopped") || typeof ts !== "string") {
      continue;
    }
    const at = Date.parse(ts);
    if (!Number.isNaN(at) && at >= since) {
      records.push({ event, ts, row });
    }
  }
  return records;
}

export interface StoppedVerdict {
  readonly failedTeardowns: number;
  readonly code: string | undefined;
}

// What a daemon.stopped row reports: the failed-teardown count and the code when there is one. A row with no numeric
// failedTeardowns is refused (undefined).
export function stoppedVerdictOf(row: Readonly<Record<string, unknown>>): StoppedVerdict | undefined {
  const { failedTeardowns, code } = row;
  if (typeof failedTeardowns !== "number" || !Number.isFinite(failedTeardowns)) {
    return undefined;
  }
  return { failedTeardowns, code: typeof code === "string" ? code : undefined };
}

// ---- Container state and the stage timeline ------------------------------------------------------------------------------

export interface ContainerSample {
  // Milliseconds from the signal to the moment the listing returned.
  readonly atMs: number;
  readonly present: boolean;
  readonly running: boolean;
}

// The state of a session's container from `podman ps -a --format {{.State}}` lines for its sandbox label. No line is an absent
// container. A container that is running or still stopping counts as running, so containerStoppedMs is the moment it stopped,
// not the moment the stop began.
export function containerStateOf(stateLines: string): { readonly present: boolean; readonly running: boolean } {
  const states = stateLines
    .split(/\r?\n/)
    .map((line) => line.trim().toLowerCase())
    .filter((line) => line !== "");
  return { present: states.length > 0, running: states.some((state) => state === "running" || state === "stopping") };
}

// Wall-clock times (epoch milliseconds) of the four marks of one stop. A mark the run did not see is null.
export interface StopMarks {
  readonly signal: number;
  readonly stopping: number | null;
  readonly stopped: number | null;
  readonly exit: number | null;
}

export interface StageTimeline {
  // Signal to the daemon's exit.
  readonly stopMs: number | null;
  // daemon.stopping to daemon.stopped.
  readonly logMs: number | null;
  // The first sample with the container not running (an absent container is not running).
  readonly containerStoppedMs: number | null;
  // The first sample with the container absent.
  readonly containerGoneMs: number | null;
  // The largest gap between two consecutive samples: the resolution of the two figures above.
  readonly largestGapMs: number | null;
}

// A figure the data cannot give is null, never zero.
export function stageTimeline(samples: readonly ContainerSample[], marks: StopMarks): StageTimeline {
  let largestGapMs: number | null = null;
  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1];
    const current = samples[index];
    if (previous !== undefined && current !== undefined) {
      const gap = current.atMs - previous.atMs;
      largestGapMs = largestGapMs === null ? gap : Math.max(largestGapMs, gap);
    }
  }
  return {
    stopMs: marks.exit === null ? null : marks.exit - marks.signal,
    logMs: marks.stopping === null || marks.stopped === null ? null : marks.stopped - marks.stopping,
    containerStoppedMs: samples.find((sample) => !sample.running)?.atMs ?? null,
    containerGoneMs: samples.find((sample) => !sample.present)?.atMs ?? null,
    largestGapMs,
  };
}

// ---- The verdict ---------------------------------------------------------------------------------------------------------

// A stop slower than this is flagged near: it is the headroom figure for the next bound decision (the daemon's own teardown bound
// before Phase 41 was this long). The flag never fails an iteration.
export const NEAR_STOP_MS = 30_000;

export interface IterationResult {
  readonly timeline: StageTimeline;
  // The daemon.stopped row's figures, undefined when no row with a numeric failedTeardowns was written.
  readonly stopped: StoppedVerdict | undefined;
  // The daemon exited inside the bound the caller applied.
  readonly exitedInBound: boolean;
  // The session's container is absent at the check made after the exit (variants a and b).
  readonly containerGone: boolean;
  // The gateway no longer lists the session's sandbox (variants a and b).
  readonly sandboxGone: boolean;
  // The problems waitForNoResidue reports for the scenario's sandbox; empty is clean (variants a and b).
  readonly residueProblems: readonly string[];
  // The up that follows the stop reached active (variant c); undefined when it was not run.
  readonly followUpActive: boolean | undefined;
}

export interface IterationVerdict {
  readonly pass: boolean;
  // The first failing reason, a fixed string; undefined on a pass.
  readonly reason: string | undefined;
  readonly near: boolean;
}

// Variants a and b pass only if the daemon exited inside its bound, daemon.stopped reported failedTeardowns 0 with no code, the
// container and the sandbox are gone and there is no residue. Variant c is an observation: it passes if the daemon exited inside
// the bound and the follow-up up reached active; failedTeardowns and code are recorded as observed, never judged.
export function iterationVerdict(variant: Variant, result: IterationResult): IterationVerdict {
  const near = result.timeline.stopMs !== null && result.timeline.stopMs > NEAR_STOP_MS;
  const reason = ((): string | undefined => {
    if (!result.exitedInBound) {
      return "the daemon did not exit within the bound";
    }
    if (variant === "c") {
      return result.followUpActive === true ? undefined : "the follow-up up did not reach active";
    }
    if (result.stopped === undefined) {
      return "daemon.stopped was not written with a numeric failedTeardowns";
    }
    if (result.stopped.failedTeardowns !== 0) {
      return "daemon.stopped reported failed teardowns";
    }
    if (result.stopped.code !== undefined) {
      return "daemon.stopped carried a code";
    }
    if (!result.containerGone) {
      return "the session's container was still present after the exit";
    }
    if (!result.sandboxGone) {
      return "the gateway still lists the session's sandbox";
    }
    return result.residueProblems.length === 0 ? undefined : "residue remained after the stop";
  })();
  return { pass: reason === undefined, reason, near };
}

// ---- Evidence ------------------------------------------------------------------------------------------------------------

// The load of the host as the loadavg of one minute per CPU, to two decimals, or null when either figure is unusable.
export function loadPerCpu(loadavgOneMinute: number, cpuCount: number): number | null {
  if (!Number.isFinite(loadavgOneMinute) || !Number.isFinite(cpuCount) || cpuCount < 1) {
    return null;
  }
  return Math.round((loadavgOneMinute / cpuCount) * 100) / 100;
}

// The count of busy workers of variant b: the CPU count, at least one. The spawn itself is in the live test.
export function loadWorkers(cpuCount: number): number {
  return Number.isFinite(cpuCount) ? Math.max(1, Math.floor(cpuCount)) : 1;
}

export interface IterationRecord {
  readonly variant: Variant;
  readonly iteration: number;
  readonly verdict: IterationVerdict;
  readonly timeline: StageTimeline;
  readonly stopped: StoppedVerdict | undefined;
  readonly loadBefore: number | null;
  readonly loadAfter: number | null;
}

// One JSON line of the evidence file: the figures of one iteration. No path, no environment value, no container id.
export function evidenceLineOf(record: IterationRecord): string {
  return JSON.stringify({
    variant: record.variant,
    iteration: record.iteration,
    pass: record.verdict.pass,
    reason: record.verdict.reason ?? null,
    near: record.verdict.near,
    stopMs: record.timeline.stopMs,
    logMs: record.timeline.logMs,
    containerStoppedMs: record.timeline.containerStoppedMs,
    containerGoneMs: record.timeline.containerGoneMs,
    largestGapMs: record.timeline.largestGapMs,
    failedTeardowns: record.stopped?.failedTeardowns ?? null,
    code: record.stopped?.code ?? null,
    loadBefore: record.loadBefore,
    loadAfter: record.loadAfter,
  });
}

// The median of a sorted list: the middle value, or the mean of the two middle values rounded to a whole number.
function medianOf(sorted: readonly number[]): number {
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle] ?? 0;
  const lower = sorted[sorted.length - 1 - middle] ?? 0;
  return Math.round((lower + upper) / 2);
}

function histogramText(counts: ReadonlyMap<string, number>): string {
  return [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, count]) => `${key}=${String(count)}`)
    .join(", ");
}

// The evidence summary, per variant: the iteration count, the passes, the minimum, median and maximum stopMs, the number of near
// flags, the histogram of failedTeardowns and of code, and the load readings.
export function evidenceText(records: readonly IterationRecord[]): string {
  const out: string[] = [];
  for (const variant of ALL_VARIANTS) {
    const own = records.filter((record) => record.variant === variant);
    if (own.length === 0) {
      continue;
    }
    const stops = own.flatMap((record) => (record.timeline.stopMs === null ? [] : [record.timeline.stopMs])).sort((a, b) => a - b);
    const failed = new Map<string, number>();
    const codes = new Map<string, number>();
    for (const record of own) {
      const failedKey = record.stopped === undefined ? "none" : String(record.stopped.failedTeardowns);
      failed.set(failedKey, (failed.get(failedKey) ?? 0) + 1);
      const codeKey = record.stopped?.code ?? "none";
      codes.set(codeKey, (codes.get(codeKey) ?? 0) + 1);
    }
    const loads = own.map((record) => `${String(record.loadBefore)}/${String(record.loadAfter)}`).join(" ");
    out.push(
      `variant ${variant}: ${String(own.length)} iteration(s), ${String(own.filter((record) => record.verdict.pass).length)} pass`,
      stops.length === 0
        ? "  stopMs: none observed"
        : `  stopMs: min ${String(stops[0])}, median ${String(medianOf(stops))}, max ${String(stops[stops.length - 1])}`,
      `  near (> ${String(NEAR_STOP_MS)} ms): ${String(own.filter((record) => record.verdict.near).length)}`,
      `  failedTeardowns: ${histogramText(failed)}`,
      `  code: ${histogramText(codes)}`,
      `  load per CPU before/after: ${loads}`,
    );
  }
  return `${out.join("\n")}\n`;
}

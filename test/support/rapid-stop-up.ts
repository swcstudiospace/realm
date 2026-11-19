// Pure helpers of the gated live test of the rapid stop-then-up chain (Phase 46, test/integration/rapid-stop-up-live.test.ts).
// The live test stops a real daemon with SIGTERM and runs `realm up` for the same workspace the instant the daemon's pid is gone,
// again and again on one sandbox name, to reproduce finding F-41-1 (an `up` right after a stop failed with OPENSHELL_START_FAILED)
// or to record how many consecutive iterations were clean. Everything here takes its inputs as parameters: no process is started,
// no file is read and the environment is not touched, so the hermetic file test/integration/rapid-stop-up-helpers.test.ts covers
// every branch on any host. The outcome words of 46-CONTEXT D-46-02 are code here (windowOutcome); a disagreement between this
// file and that table is settled in favour of the table.
//
// Nothing here carries a path, an environment value, a token or a container id into a record meant for the repository:
// evidenceLine refuses a value that could hold one.

import { isAbsolute } from "node:path";
import { ERROR_CODES, type ErrorCode } from "../../src/core/errors.js";
import { stoppedVerdictOf, type StopRecord } from "./daemon-stop-live.js";
import { noticeOfStatus, productionSkipReason, type ProductionGateInputs } from "./production-live.js";

// ---- A. Gate --------------------------------------------------------------------------------------------------------------

export const LIVE_RAPID_VARIABLE = "REALM_LIVE_RAPID";
export const RAPID_EVIDENCE_DIR_VARIABLE = "REALM_RAPID_EVIDENCE_DIR";
export const RAPID_VARIANTS_VARIABLE = "REALM_RAPID_VARIANTS";
export const RAPID_ITERATIONS_VARIABLE = "REALM_RAPID_ITERATIONS";
export const RAPID_MAX_FAILURES_VARIABLE = "REALM_RAPID_MAX_FAILURES";
export const RAPID_GATEWAY_UNIT_VARIABLE = "REALM_RAPID_GATEWAY_UNIT";
// Read by the live test, not required by the gate: the systemd user unit of the compute driver.
export const LIVE_DRIVER_UNIT_VARIABLE = "REALM_LIVE_DRIVER_UNIT";

// ---- B. Parsing -----------------------------------------------------------------------------------------------------------

export type RapidVariant = "a" | "b" | "c" | "s";

const ALL_VARIANTS: readonly RapidVariant[] = ["a", "b", "c", "s"];
const DEFAULT_VARIANTS: readonly RapidVariant[] = ["a", "b", "c"];

// The consecutive clean iterations per variant a, b and c that STOP-01 takes as the non-reproduction bound.
export const TARGET_CLEAN_ITERATIONS = 50;
// The iterations of the settled control s.
export const CONTROL_ITERATIONS = 20;
// Variant c: the signal is sent this long after an up started.
export const MID_UP_DELAY_MS = 3_000;

const DEFAULT_MAX_FAILURES = 3;
const MIN_MAX_FAILURES = 1;
const MAX_MAX_FAILURES = 5;

export type ParsedRapidVariants = { readonly ok: true; readonly variants: readonly RapidVariant[] } | { readonly ok: false };

// A comma list over the letters a, b, c and s. Absent or blank gives a, b, c. An unknown letter, or an empty element, makes the
// whole value invalid. The result lists each chosen variant once, in the order a, b, c, s.
export function parseRapidVariants(raw: string | undefined): ParsedRapidVariants {
  if (raw === undefined || raw.trim() === "") {
    return { ok: true, variants: DEFAULT_VARIANTS };
  }
  const chosen = new Set<RapidVariant>();
  for (const part of raw.split(",")) {
    const letter = ALL_VARIANTS.find((variant) => variant === part.trim());
    if (letter === undefined) {
      return { ok: false };
    }
    chosen.add(letter);
  }
  return { ok: true, variants: ALL_VARIANTS.filter((variant) => chosen.has(variant)) };
}

// A whole number from min to max. Absent, blank, decimal or text gives the default; a whole number out of range is clamped.
function boundedWholeNumber(raw: string | undefined, fallback: number, min: number, max: number): number {
  if (raw === undefined || !/^\s*\d+\s*$/.test(raw)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Number(raw.trim())));
}

// The consecutive clean iterations a variant runs to: 1 to 50, default 50.
export function parseIterations(raw: string | undefined): number {
  return boundedWholeNumber(raw, TARGET_CLEAN_ITERATIONS, 1, TARGET_CLEAN_ITERATIONS);
}

// The failures a variant keeps before it stops: 1 to 5, default 3.
export function parseMaxFailures(raw: string | undefined): number {
  return boundedWholeNumber(raw, DEFAULT_MAX_FAILURES, MIN_MAX_FAILURES, MAX_MAX_FAILURES);
}

// The consecutive clean target of one variant: the control runs its own count, capped by the chosen iteration count.
export function targetOf(variant: RapidVariant, iterations: number): number {
  return variant === "s" ? Math.min(CONTROL_ITERATIONS, iterations) : iterations;
}

// The reason the rapid live test cannot run, or false. The first missing prerequisite, in this order: the production gate (the
// same inputs productionSkipReason takes), REALM_LIVE_RAPID exactly "1" (the test never sets it), an evidence directory that is an
// absolute path to an existing directory, and a valid variant list. The reason names the variable, never a value.
export function rapidSkipReason(inputs: ProductionGateInputs): string | false {
  const production = productionSkipReason(inputs);
  if (production !== false) {
    return production;
  }
  const { env } = inputs;
  if (env[LIVE_RAPID_VARIABLE] !== "1") {
    return `${LIVE_RAPID_VARIABLE}=1 is not set; the rapid stop-then-up live test needs an explicit operator opt-in`;
  }
  const evidenceDir = env[RAPID_EVIDENCE_DIR_VARIABLE];
  if (evidenceDir === undefined || !isAbsolute(evidenceDir) || !inputs.isDirectory(evidenceDir)) {
    return `${RAPID_EVIDENCE_DIR_VARIABLE} is not an absolute path to an existing directory; the timeline of each iteration is written there, outside the repository`;
  }
  if (!parseRapidVariants(env[RAPID_VARIANTS_VARIABLE]).ok) {
    return `${RAPID_VARIANTS_VARIABLE} is not a comma list over a, b, c and s`;
  }
  return false;
}

// Whether the settled control s runs, and the closed reason the test writes either way. A list that names s runs it. With the
// default list (the variable absent or blank) s runs only when a, b or c recorded a failure. A list that does not name s never
// runs it. The absence of s is recorded, never counted as a pass.
export function controlDecision(rawVariants: string | undefined, failuresInAbc: number): { readonly run: boolean; readonly reason: string } {
  const parsed = parseRapidVariants(rawVariants);
  if (!parsed.ok) {
    return { run: false, reason: "variant-list-invalid" };
  }
  if (parsed.variants.includes("s")) {
    return { run: true, reason: "named-in-list" };
  }
  if (rawVariants !== undefined && rawVariants.trim() !== "") {
    return { run: false, reason: "not-named-in-list" };
  }
  return failuresInAbc > 0 ? { run: true, reason: "failure-in-abc" } : { run: false, reason: "no-failure-in-abc" };
}

// ---- C. The up classifier -------------------------------------------------------------------------------------------------

// The CLI result of one `realm up`: its exit code (undefined when it did not run to an exit), whether it was killed at its bound,
// and its output.
export interface UpRun {
  readonly exitCode: number | undefined;
  readonly timedOut: boolean;
  readonly stdout: string;
  readonly stderr: string;
}

// What one up did. The only text taken from the output is a catalogue code name. notice is whether the output of the up, or the
// status text given with it, carries a status notice (a previous daemon's sandbox was destroyed); the notice text is never kept.
export type UpOutcome =
  | { readonly kind: "ok"; readonly notice: boolean }
  | { readonly kind: "start-failed"; readonly causeCode: ErrorCode | undefined; readonly notice: boolean }
  | { readonly kind: "other-failure"; readonly code: ErrorCode | undefined; readonly notice: boolean }
  | { readonly kind: "timeout"; readonly notice: boolean }
  | { readonly kind: "not-run"; readonly notice: false };

function isErrorCode(token: string): token is ErrorCode {
  return (ERROR_CODES as readonly string[]).includes(token);
}

// The catalogue codes in a text, each once, in order of appearance. The CLI prints the code on its own stdout line and the reason
// text on stderr, so a token only counts when it is exactly a catalogue code.
function catalogueCodesIn(text: string): readonly ErrorCode[] {
  const found: ErrorCode[] = [];
  for (const match of text.matchAll(/\b[A-Z][A-Z0-9_]{2,}\b/g)) {
    const token = match[0];
    if (isErrorCode(token) && !found.includes(token)) {
      found.push(token);
    }
  }
  return found;
}

// ok: exit 0. timeout: the call was killed at its bound. start-failed: a non-zero exit whose output carries OPENSHELL_START_FAILED,
// with the first other catalogue code the output carries as the cause. other-failure: a non-zero exit with any other catalogue
// code (the first, or none when the output carries no code). An up that is not ok is never a clean iteration; only start-failed is
// ever a reproduction.
export function classifyUp(run: UpRun, statusText: string): UpOutcome {
  const notice = noticeOfStatus(run.stdout) !== undefined || noticeOfStatus(statusText) !== undefined;
  if (run.timedOut) {
    return { kind: "timeout", notice };
  }
  if (run.exitCode === 0) {
    return { kind: "ok", notice };
  }
  const codes = catalogueCodesIn(`${run.stdout}\n${run.stderr}`);
  if (codes.includes("OPENSHELL_START_FAILED")) {
    return { kind: "start-failed", causeCode: codes.find((code) => code !== "OPENSHELL_START_FAILED"), notice };
  }
  return { kind: "other-failure", code: codes[0], notice };
}

// ---- D. The stop record classifier ----------------------------------------------------------------------------------------

// What the request log says of one stop. clean needs a daemon.stopping row and a daemon.stopped row with failedTeardowns 0 and no
// code. dirty is a daemon.stopped row that is not that (failedTeardowns above 0, a code, an unreadable count, or no stopping row
// before it). row-absent is no daemon.stopped row at all: stoppingSeen says whether a daemon.stopping row was there, startupSeen
// whether the daemon's startup report was already in the daemon log at the signal (null when the variant does not observe it).
// log-unreadable is a request log that could not be read. not-exited is a daemon still alive at the exit bound (the caller sets
// it; no row is read). Only clean is a pass.
export type StopClass =
  | { readonly kind: "clean" }
  | { readonly kind: "dirty"; readonly failedTeardowns: number | null; readonly code: ErrorCode | "unlisted" | undefined; readonly stoppingSeen: boolean }
  | { readonly kind: "row-absent"; readonly stoppingSeen: boolean; readonly startupSeen: boolean | null }
  | { readonly kind: "log-unreadable" }
  | { readonly kind: "not-exited" };

// records are the rows stopRecordsOf returns for the stop window, or undefined when the request log could not be read. A row
// stamped before the signal is not part of this stop.
export function classifyStop(records: readonly StopRecord[] | undefined, signalMs: number, startupSeen: boolean | null): StopClass {
  if (records === undefined) {
    return { kind: "log-unreadable" };
  }
  const own = records.filter((record) => Date.parse(record.ts) >= signalMs);
  const stoppingSeen = own.some((record) => record.event === "daemon.stopping");
  const stopped = own.filter((record) => record.event === "daemon.stopped").at(-1);
  if (stopped === undefined) {
    return { kind: "row-absent", stoppingSeen, startupSeen };
  }
  const verdict = stoppedVerdictOf(stopped.row);
  if (verdict === undefined) {
    return { kind: "dirty", failedTeardowns: null, code: undefined, stoppingSeen };
  }
  if (verdict.failedTeardowns === 0 && verdict.code === undefined && stoppingSeen) {
    return { kind: "clean" };
  }
  const code = verdict.code === undefined ? undefined : isErrorCode(verdict.code) ? verdict.code : "unlisted";
  return { kind: "dirty", failedTeardowns: verdict.failedTeardowns, code, stoppingSeen };
}

// ---- E. The chain state machine -------------------------------------------------------------------------------------------

export type FailureKind =
  | "start-failed"
  | "other-failure"
  | "timeout"
  | "not-active"
  | "exec-failed"
  | "dirty-stop"
  | "row-absent"
  | "log-unreadable"
  | "stop-timeout"
  | "down-failed";

// One failed iteration, kept whole: its number and every kind it failed in, the up kind first.
export interface IterationFailure {
  readonly iteration: number;
  readonly kinds: readonly FailureKind[];
}

// What one iteration observed. active is the session reaching active after the up, execOk the scratch exec succeeding.
export interface IterationOutcome {
  readonly up: UpOutcome;
  readonly active: boolean;
  readonly execOk: boolean;
  readonly stop: StopClass;
  // The realm down that follows a variant c iteration, classified like an up; absent for the other variants.
  readonly down?: UpOutcome | undefined;
}

// The state of one variant across its chains: the iterations run, the iterations that were clean, the consecutive clean count
// since the last failure, the failures kept, the consecutive target and the failure cap.
export interface ChainState {
  readonly variant: RapidVariant;
  readonly target: number;
  readonly failureCap: number;
  readonly iterations: number;
  readonly cleanIterations: number;
  readonly consecutiveClean: number;
  readonly failures: readonly IterationFailure[];
}

export type ChainAction = "continue" | "variant-done-clean" | "variant-done-failed" | "restart-chain";

export function newChainState(variant: RapidVariant, target: number, failureCap: number): ChainState {
  return { variant, target, failureCap, iterations: 0, cleanIterations: 0, consecutiveClean: 0, failures: [] };
}

// The kinds an iteration failed in, in a fixed order: the up first, then the session, then the stop. Empty is a clean iteration:
// the up is ok, the session is active, the exec succeeded and the stop was clean. An iteration whose up never ran (the daemon did
// not exit, so no up could start) is never clean.
export function failureKindsOf(outcome: IterationOutcome): readonly FailureKind[] {
  const kinds: FailureKind[] = [];
  if (outcome.up.kind === "ok") {
    if (!outcome.active) {
      kinds.push("not-active");
    } else if (!outcome.execOk) {
      kinds.push("exec-failed");
    }
  } else if (outcome.up.kind !== "not-run") {
    kinds.push(outcome.up.kind);
  }
  if (outcome.stop.kind === "dirty") {
    kinds.push("dirty-stop");
  } else if (outcome.stop.kind === "not-exited") {
    kinds.push("stop-timeout");
  } else if (outcome.stop.kind !== "clean") {
    kinds.push(outcome.stop.kind);
  }
  // The realm down that follows a variant c iteration: a failing down (a product code, a timeout) is a failure of its own kind.
  if (outcome.down !== undefined && outcome.down.kind !== "ok") {
    kinds.push("down-failed");
  }
  if (kinds.length === 0 && outcome.up.kind === "not-run") {
    kinds.push("other-failure");
  }
  return kinds;
}

// One iteration of the chain. A clean iteration adds to the consecutive count and ends the variant when the count reaches the
// target. A failure is kept with its kinds, resets the consecutive count and either ends the variant (the failure cap reached) or
// asks for a new chain after the cleanup. Nothing is retried, dropped or relabelled.
export function chainStep(state: ChainState, outcome: IterationOutcome): { readonly state: ChainState; readonly action: ChainAction } {
  const iteration = state.iterations + 1;
  const kinds = failureKindsOf(outcome);
  if (kinds.length === 0) {
    const next: ChainState = { ...state, iterations: iteration, cleanIterations: state.cleanIterations + 1, consecutiveClean: state.consecutiveClean + 1 };
    return { state: next, action: next.consecutiveClean >= next.target ? "variant-done-clean" : "continue" };
  }
  const next: ChainState = { ...state, iterations: iteration, consecutiveClean: 0, failures: [...state.failures, { iteration, kinds }] };
  return { state: next, action: next.failures.length >= next.failureCap ? "variant-done-failed" : "restart-chain" };
}

// ---- F. The window outcome ------------------------------------------------------------------------------------------------

// How a variant ended: it reached its target, it reached its failure cap, or it stopped for a host reason (the lock lost, a count
// that changed outside the harness, the stack down, a settle that did not finish).
export type VariantEnd = "target" | "failure-cap" | "host";

export interface VariantResult {
  readonly variant: RapidVariant;
  readonly state: ChainState;
  readonly ended: VariantEnd;
}

export type WindowOutcome = "REPRODUCED" | "OTHER-FAILURE" | "NOT-REPRODUCED" | "VOID";

export interface VariantCounts {
  readonly variant: RapidVariant;
  readonly iterations: number;
  readonly clean: number;
  readonly consecutiveClean: number;
  readonly failures: number;
  readonly startFailed: number;
  readonly ended: VariantEnd;
}

export interface WindowResult {
  readonly outcome: WindowOutcome;
  readonly counts: readonly VariantCounts[];
}

// The window outcome of 46-CONTEXT D-46-02. REPRODUCED: any variant recorded an up that failed with OPENSHELL_START_FAILED.
// OTHER-FAILURE: a failure of any other kind and no start-failed. NOT-REPRODUCED: each of a, b and c ended at its target with
// 50 consecutive clean iterations and no variant recorded a failure of any kind. VOID: anything else (a variant missing, a host
// stop, fewer than 50 clean and no failure, a target below 50). A control that stopped for a host reason does not void a window
// whose a, b and c are complete.
export function windowOutcome(results: readonly VariantResult[]): WindowResult {
  const counts = results.map((result): VariantCounts => ({
    variant: result.variant,
    iterations: result.state.iterations,
    clean: result.state.cleanIterations,
    consecutiveClean: result.state.consecutiveClean,
    failures: result.state.failures.length,
    startFailed: result.state.failures.filter((failure) => failure.kinds.includes("start-failed")).length,
    ended: result.ended,
  }));
  if (counts.some((count) => count.startFailed > 0)) {
    return { outcome: "REPRODUCED", counts };
  }
  if (counts.some((count) => count.failures > 0)) {
    return { outcome: "OTHER-FAILURE", counts };
  }
  const complete = (variant: RapidVariant): boolean =>
    counts.some((count) => count.variant === variant && count.ended === "target" && count.consecutiveClean >= TARGET_CLEAN_ITERATIONS);
  return { outcome: complete("a") && complete("b") && complete("c") ? "NOT-REPRODUCED" : "VOID", counts };
}

// ---- G. The timeline ------------------------------------------------------------------------------------------------------

// The closed event names of a timeline.
export const TIMELINE_EVENTS = [
  "signal",
  "daemon-exit",
  "up-start",
  "up-end",
  "first-up-start",
  "first-up-end",
  "stopping-row",
  "stopped-row",
  "startup-row",
  "supervisor-first-seen",
  "supervisor-last-seen",
  "container-first-seen",
  "container-gone",
  "sandbox-listed",
  "sandbox-unlisted",
  "journal-line",
  "podman-event",
] as const;

export type TimelineEventName = (typeof TIMELINE_EVENTS)[number];

// One event on the harness's own UTC millisecond clock. detail is text the caller has already made free of paths and ids.
export interface TimelineEvent {
  readonly source: string;
  readonly atMs: number;
  readonly event: TimelineEventName;
  readonly detail?: string;
}

// The events of every source in one list, sorted by time. Events at the same millisecond keep the order of the lists given, then
// the order inside a list.
export function mergeTimeline(sources: readonly (readonly TimelineEvent[])[]): readonly TimelineEvent[] {
  return sources.flat().sort((left, right) => left.atMs - right.atMs);
}

// The events from beforeMs before centreMs to afterMs after it, both ends included.
export function timelineAround(events: readonly TimelineEvent[], centreMs: number, beforeMs: number, afterMs: number): readonly TimelineEvent[] {
  return events.filter((event) => event.atMs >= centreMs - beforeMs && event.atMs <= centreMs + afterMs);
}

// One sample of the driver unit's child processes: the moment it was taken and the pids it saw.
export interface SupervisorSample {
  readonly atMs: number;
  readonly pids: readonly number[];
}

export interface SupervisorLifespan {
  readonly pid: number;
  readonly firstMs: number;
  readonly lastMs: number;
}

// For each pid the first and the last sample that saw it, in pid order.
export function supervisorLifespans(samples: readonly SupervisorSample[]): readonly SupervisorLifespan[] {
  const spans = new Map<number, { firstMs: number; lastMs: number }>();
  for (const sample of samples) {
    for (const pid of sample.pids) {
      const span = spans.get(pid);
      if (span === undefined) {
        spans.set(pid, { firstMs: sample.atMs, lastMs: sample.atMs });
      } else {
        span.firstMs = Math.min(span.firstMs, sample.atMs);
        span.lastMs = Math.max(span.lastMs, sample.atMs);
      }
    }
  }
  return [...spans.entries()].sort(([left], [right]) => left - right).map(([pid, span]) => ({ pid, ...span }));
}

// The supervisors of the previous sandbox that outlive the stop: those first seen at or before the daemon's exit (the supervisors
// of the new sandbox start later and are not late) and still seen after the daemon's exit, and those still seen after the next up
// started (the M1 observation of 46-CONTEXT: a host supervisor of the previous sandbox that outlives the stop and is alive when
// the next create starts).
export function lateSupervisors(
  lifespans: readonly SupervisorLifespan[],
  daemonExitMs: number,
  nextUpStartMs: number,
): { readonly afterDaemonExit: readonly number[]; readonly afterNextUpStart: readonly number[] } {
  const previous = lifespans.filter((span) => span.firstMs <= daemonExitMs);
  return {
    afterDaemonExit: previous.filter((span) => span.lastMs > daemonExitMs).map((span) => span.pid),
    afterNextUpStart: previous.filter((span) => span.lastMs > nextUpStartMs).map((span) => span.pid),
  };
}

// The pids a `ps -o pid=,...` listing names, one per line (the driver unit's children, sampled while a stop and an up run).
// A line that does not start with a number is ignored.
export function pidsOfListing(listing: string): readonly number[] {
  const pids: number[] = [];
  for (const line of listing.split(/\r?\n/)) {
    const match = /^\s*([1-9]\d{0,9})(\s|$)/.exec(line);
    if (match?.[1] !== undefined) {
      pids.push(Number(match[1]));
    }
  }
  return pids;
}

// The rows of the daemon's startup report (event daemon.startup) in a daemon log text, with the row's time and the count of
// containers the startup reap removed when the row carries one. A line that is not JSON is ignored.
export interface StartupRow {
  readonly atMs: number;
  readonly containersRemoved: number | null;
}

export function startupRowsOf(daemonLogText: string): readonly StartupRow[] {
  const rows: StartupRow[] = [];
  for (const line of daemonLogText.split(/\r?\n/)) {
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
    const { event, ts, containersRemoved } = row;
    if (event !== "daemon.startup" || typeof ts !== "string") {
      continue;
    }
    const atMs = Date.parse(ts);
    if (!Number.isNaN(atMs)) {
      rows.push({ atMs, containersRemoved: typeof containersRemoved === "number" && Number.isFinite(containersRemoved) ? containersRemoved : null });
    }
  }
  return rows;
}

// Whether a startup report row was already written at the signal: the answer to "did the daemon get past its startup before the
// stop" for the variant c stops (OBS-C).
export function startupSeenAt(rows: readonly StartupRow[], signalMs: number): boolean {
  return rows.some((row) => row.atMs <= signalMs);
}

// The containers the next daemon's startup reap removed: the count the first startup row after afterMs carries, or null when
// there is no such row or the row has no count.
export function reapRemovedAfter(rows: readonly StartupRow[], afterMs: number): number | null {
  return rows.find((row) => row.atMs > afterMs)?.containersRemoved ?? null;
}

// ---- H. Evidence lines ----------------------------------------------------------------------------------------------------

export type EvidenceValue = string | number | boolean | null;

// A closed name: letters, digits, dot, hyphen, underscore and plus (a joined list of kinds), starting with a letter. No slash,
// backslash or colon fits.
const CLOSED_NAME = /^[A-Za-z][A-Za-z0-9_.+-]*$/;
// A run of twelve hex digits is the short form of a container id; the 64-digit form contains it.
const HEX_RUN = /[0-9a-f]{12,}/i;

function evidenceValueText(key: string, value: EvidenceValue): string {
  if (value === null) {
    return "none";
  }
  if (typeof value === "boolean") {
    return value ? "yes" : "no";
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new RangeError(`evidence field ${key} is not a finite number`);
    }
    return String(value);
  }
  if (!CLOSED_NAME.test(value) || HEX_RUN.test(value)) {
    throw new RangeError(`evidence field ${key} is not a closed name; a path, a colon, a slash or an id cannot enter a record`);
  }
  return value;
}

// One closed-phrase line, key=value pairs separated by single spaces, from numbers, booleans (yes or no), null (none) and closed
// names only. A key that is not a plain word, a string value that is not a closed name, and any value that holds a slash, a
// backslash, a colon or a run of twelve or more hex digits (a container id, a 64-digit id) throws, so a path or an id cannot enter
// a record.
export function evidenceLine(fields: Readonly<Record<string, EvidenceValue>>): string {
  return Object.entries(fields)
    .map(([key, value]) => {
      if (!/^[a-z][A-Za-z0-9]*$/.test(key)) {
        throw new RangeError("an evidence key is not a plain word");
      }
      return `${key}=${evidenceValueText(key, value)}`;
    })
    .join(" ");
}

// The figures of one iteration, as the closed fields the evidence line renders. Every field is a number, a boolean or a closed
// name.
export interface IterationRecord {
  readonly variant: RapidVariant;
  readonly chain: number;
  readonly iteration: number;
  readonly up: UpOutcome;
  // The first, interrupted up of variant c; undefined for the other variants.
  readonly interruptedUp: UpOutcome | undefined;
  // The realm down that follows each variant c iteration; undefined for the other variants.
  readonly down: UpOutcome | undefined;
  readonly active: boolean;
  readonly execOk: boolean;
  readonly stop: StopClass;
  // The signal to the daemon's exit, and the exit to the start of the next up, in milliseconds; null when not observed.
  readonly stopMs: number | null;
  readonly gapToUpMs: number | null;
  readonly upMs: number | null;
  // Containers the next daemon's startup reap removed, from the startup report; null when the report was not in the log slice.
  readonly containersRemoved: number | null;
  // Variant c: whether the daemon's startup report was already in the daemon log when the signal arrived (OBS-C); null otherwise.
  readonly startupSeen: boolean | null;
  readonly lateAfterExit: number | null;
  readonly lateAfterNextUp: number | null;
  readonly loadBefore: number | null;
  readonly loadAfter: number | null;
  readonly kinds: readonly FailureKind[];
}

// The one closed-phrase line of an iteration. A clean iteration has kinds none.
export function iterationEvidenceLine(record: IterationRecord): string {
  const stop = record.stop;
  return evidenceLine({
    variant: record.variant,
    chain: record.chain,
    iteration: record.iteration,
    result: record.kinds.length === 0 ? "clean" : "failed",
    kinds: record.kinds.length === 0 ? null : record.kinds.join("+"),
    up: record.up.kind,
    upCode: record.up.kind === "other-failure" ? (record.up.code ?? null) : null,
    upCause: record.up.kind === "start-failed" ? (record.up.causeCode ?? null) : null,
    interruptedUp: record.interruptedUp === undefined ? null : record.interruptedUp.kind,
    down: record.down === undefined ? null : record.down.kind,
    downCode: record.down?.kind === "other-failure" ? (record.down.code ?? null) : null,
    active: record.active,
    execOk: record.execOk,
    stop: stop.kind,
    failedTeardowns: stop.kind === "dirty" ? stop.failedTeardowns : null,
    stopCode: stop.kind === "dirty" ? (stop.code ?? null) : null,
    stoppingSeen: stop.kind === "dirty" || stop.kind === "row-absent" ? stop.stoppingSeen : null,
    startupSeen: record.startupSeen,
    notice: record.up.notice,
    containersRemoved: record.containersRemoved,
    stopMs: record.stopMs,
    gapToUpMs: record.gapToUpMs,
    upMs: record.upMs,
    lateAfterExit: record.lateAfterExit,
    lateAfterNextUp: record.lateAfterNextUp,
    loadBefore: record.loadBefore,
    loadAfter: record.loadAfter,
  });
}

// The per-variant counts and the outcome word, one closed-phrase line each: the lines a person copies numbers from.
export function summaryOf(window: WindowResult): string {
  const lines = [evidenceLine({ outcome: window.outcome })];
  for (const count of window.counts) {
    lines.push(
      evidenceLine({
        variant: count.variant,
        iterations: count.iterations,
        clean: count.clean,
        consecutiveClean: count.consecutiveClean,
        failures: count.failures,
        startFailed: count.startFailed,
        ended: count.ended,
      }),
    );
  }
  return `${lines.join("\n")}\n`;
}

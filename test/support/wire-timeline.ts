// The frozen rules of the Phase 47 window as code (47-CONTEXT D-47-03 to D-47-06): the classification of one run's tools/list outcome,
// the reproduction rule, the cause attribution rule and the environment ablation verdict, with their constants. They are written and
// pinned by test/support/wire-timeline.test.ts BEFORE any run exists, so the result of a window is computed by this code and not by hand.
//
// Pure: every input is a parameter; nothing here reads the environment, a clock or a process. The one exception is readWireTimeline,
// which reads the single file path it is given (the log the wire recorder of test/support/host-live-session.ts writes). The module
// imports no value from a live module: the six tool names and the three environment names are repeated here as constants, and a
// hermetic test compares the six names with REALM_TOOL_NAMES.
//
// Nothing here carries a message text, a request parameter, a header, a path or an environment value: marks, ids, methods, flags,
// numeric codes, tool names, environment NAMES and catalogue codes only. Every text a result holds is a fixed sentence of this file.

import { existsSync, readFileSync } from "node:fs";

// ---- The constants (frozen; source: 47-CONTEXT D-47-04 to D-47-06) ----------------------------------------------------------

// D-47-04: valid cold runs needed, attempts allowed, failing valid runs that decide REPRODUCED.
export const REPRO_MIN_VALID = 3;
export const REPRO_MAX_ATTEMPTS = 5;
export const REPRO_FAIL_THRESHOLD = 2;

// D-47-05: a response later than this is a stall (equal to the handshake bound of the cold attach probe); two client-closing
// moments within this fraction of each other read as one fixed client timeout.
export const STALL_MS = 10_000;
export const FIXED_TIMEOUT_SPREAD = 0.1;

// D-47-06: the reach observation window and poll interval, and the runs made per name of the ablation.
export const REACH_WINDOW_MS = 60_000;
export const REACH_POLL_MS = 2_000;
export const ABLATION_RUNS_PER_NAME = 2;

// D-47-06: the three names the ablation removes one at a time, in the order of its record.
export const ABLATION_NAMES: readonly string[] = Object.freeze(["XDG_CONFIG_HOME", "XDG_RUNTIME_DIR", "REALM_DRIVER_SOCKET"]);

// The six tools `realm mcp` lists, sorted (src/mcp/server.ts).
export const SIX_TOOLS: readonly string[] = Object.freeze(["exec", "list", "read", "retry", "status", "write"]);

// ---- The timeline ----------------------------------------------------------------------------------------------------------

export type TimelineKind = "request" | "notification" | "response" | "other" | "lifecycle";
export type LifecycleEvent = "host-stdin-end" | "host-signal" | "child-start" | "child-exit";

// One line of the recorder log. `t` is the monotonic mark in milliseconds from the recorder start. A wire line has `dir`; a lifecycle
// line has `event`.
export interface TimelineEvent {
  readonly t: number;
  readonly kind: TimelineKind;
  readonly dir?: "host-to-realm" | "realm-to-host";
  readonly method?: string;
  readonly id?: string | number;
  readonly toolNames?: readonly string[];
  // On a response: the JSON-RPC error flag and its numeric code (never the message).
  readonly error?: boolean;
  readonly errorCode?: number;
  // On a request: it carried a `_meta` member (never its content).
  readonly meta?: boolean;
  // On a host-to-realm line: the line was not a JSON-RPC 2.0 message object.
  readonly invalid?: boolean;
  readonly restored?: readonly string[];
  readonly event?: LifecycleEvent;
  // host-signal: the signal name. child-exit: the signal that ended the child, when it ended by a signal.
  readonly signal?: string;
  // child-exit: the exit code, when the child ended by exiting.
  readonly exitCode?: number;
}

const WIRE_DIRECTIONS: readonly string[] = ["host-to-realm", "realm-to-host"];
const WIRE_KINDS: readonly string[] = ["request", "notification", "response", "other"];
const LIFECYCLE_EVENTS: readonly string[] = ["host-stdin-end", "host-signal", "child-start", "child-exit"];

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const items = value as unknown[];
  return items.every((item) => typeof item === "string") ? items : undefined;
}

// The events a recorder logged, in file order. A missing file is an empty list; a malformed or foreign line, and a line whose mark is
// not a non-negative integer (every line of a recorder that predates the marks), is skipped, never thrown.
export function readWireTimeline(file: string): TimelineEvent[] {
  if (!existsSync(file)) {
    return [];
  }
  const events: TimelineEvent[] = [];
  for (const line of readFileSync(file, "utf8").split("\n")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isObject(parsed)) {
      continue;
    }
    const { t, kind, dir, method, id, event, signal, code } = parsed;
    if (typeof t !== "number" || !Number.isInteger(t) || t < 0 || typeof kind !== "string") {
      continue;
    }
    if (kind === "lifecycle") {
      if (typeof event !== "string" || !LIFECYCLE_EVENTS.includes(event)) {
        continue;
      }
      events.push({
        t,
        kind: "lifecycle",
        event: event as LifecycleEvent,
        ...(typeof signal === "string" ? { signal } : {}),
        ...(typeof code === "number" ? { exitCode: code } : {}),
      });
      continue;
    }
    if (typeof dir !== "string" || !WIRE_DIRECTIONS.includes(dir) || !WIRE_KINDS.includes(kind)) {
      continue;
    }
    const toolNames = stringList(parsed["toolNames"]);
    const restored = stringList(parsed["restored"]);
    const errorCode = parsed["errorCode"];
    events.push({
      t,
      kind: kind as TimelineKind,
      dir: dir as "host-to-realm" | "realm-to-host",
      ...(typeof method === "string" ? { method } : {}),
      ...(typeof id === "string" || typeof id === "number" ? { id } : {}),
      ...(toolNames === undefined ? {} : { toolNames }),
      ...(parsed["error"] === true ? { error: true } : {}),
      ...(typeof errorCode === "number" ? { errorCode } : {}),
      ...(parsed["meta"] === true ? { meta: true } : {}),
      ...(parsed["invalid"] === true ? { invalid: true } : {}),
      ...(restored === undefined ? {} : { restored }),
    });
  }
  return events;
}

// ---- D-47-03: the classification of one run's tools/list outcome -----------------------------------------------------------

export type ToolsListClass = "NOT-REQUESTED" | "ANSWERED" | "ERROR" | "WRITTEN-AFTER-CLOSE" | "NEVER-WRITTEN";

export interface ChildExit {
  readonly t: number;
  readonly code?: number;
  readonly signal?: string;
}

// The verdict of one run. `L` is the time the response took, `G` the time the host gave before it closed its end (both from the mark
// of the first tools/list request), each defined only when its two marks exist.
export interface RunVerdict {
  readonly class: ToolsListClass;
  // The log holds an initialize or server/discover request from the host.
  readonly valid: boolean;
  // Some host-to-realm line was not a JSON-RPC 2.0 message object.
  readonly invalidRequestLine: boolean;
  readonly tRequest?: number;
  readonly tResponse?: number;
  readonly tHostEnd?: number;
  readonly L?: number;
  readonly G?: number;
  // ANSWERED only: the listed names equal the six Realm tools.
  readonly sixTools?: boolean;
  // ERROR, and WRITTEN-AFTER-CLOSE: the kind of the response and, for an error, its numeric code.
  readonly responseKind?: "result" | "error";
  readonly errorCode?: number;
  // NEVER-WRITTEN: the exit of the child, when the log holds one.
  readonly childExit?: ChildExit;
}

function sameNames(left: readonly string[], right: readonly string[]): boolean {
  const sorted = [...left].sort();
  return sorted.length === right.length && sorted.every((name, at) => name === right[at]);
}

// D-47-03. `tHostEnd` is the earliest of the host-stdin-end mark and the first host-signal mark; a response written exactly at that mark
// is not after it.
export function classifyToolsList(events: readonly TimelineEvent[]): RunVerdict {
  const valid = events.some((event) => event.dir === "host-to-realm" && event.kind === "request" && (event.method === "initialize" || event.method === "server/discover"));
  const invalidRequestLine = events.some((event) => event.dir === "host-to-realm" && event.invalid === true);
  const base = { valid, invalidRequestLine };
  const requestAt = events.findIndex((event) => event.dir === "host-to-realm" && event.kind === "request" && event.method === "tools/list" && event.id !== undefined);
  const request = events[requestAt];
  if (request === undefined) {
    return { ...base, class: "NOT-REQUESTED" };
  }
  const tRequest = request.t;
  const ends = events.filter((event) => event.kind === "lifecycle" && (event.event === "host-stdin-end" || event.event === "host-signal")).map((event) => event.t);
  const tHostEnd = ends.length === 0 ? undefined : Math.min(...ends);
  const hostEnd = tHostEnd === undefined ? {} : { tHostEnd, G: tHostEnd - tRequest };
  const response = events.slice(requestAt + 1).find((event) => event.dir === "realm-to-host" && event.kind === "response" && event.id === request.id);
  if (response === undefined) {
    const exit = events.find((event) => event.kind === "lifecycle" && event.event === "child-exit");
    return {
      ...base,
      class: "NEVER-WRITTEN",
      tRequest,
      ...hostEnd,
      ...(exit === undefined ? {} : { childExit: { t: exit.t, ...(exit.exitCode === undefined ? {} : { code: exit.exitCode }), ...(exit.signal === undefined ? {} : { signal: exit.signal }) } }),
    };
  }
  const tResponse = response.t;
  const timed = { tRequest, tResponse, ...hostEnd, L: tResponse - tRequest };
  const responseKind = response.error === true ? "error" : "result";
  const errored = responseKind === "error" ? { ...(response.errorCode === undefined ? {} : { errorCode: response.errorCode }) } : {};
  if (tHostEnd !== undefined && tHostEnd < tResponse) {
    return { ...base, class: "WRITTEN-AFTER-CLOSE", ...timed, responseKind, ...errored };
  }
  if (responseKind === "error") {
    return { ...base, class: "ERROR", ...timed, responseKind, ...errored };
  }
  return { ...base, class: "ANSWERED", ...timed, responseKind, sixTools: response.toolNames !== undefined && sameNames(response.toolNames, SIX_TOOLS) };
}

// A run that is ANSWERED with the six names: the only class that is not a failure of the tier.
export function isHealthy(verdict: RunVerdict): boolean {
  return verdict.class === "ANSWERED" && verdict.sixTools === true;
}

// ---- D-47-04: the reproduction rule ----------------------------------------------------------------------------------------

export type ReproOutcome = "REPRODUCED" | "NOT-REPRODUCED" | "INCONCLUSIVE" | "VOID";
export type ExcludeReason = "not-cold" | "not-valid" | "not-2026-11-18-condition";

// One attempt. `cold`: the before snapshot showed no daemon of the account, 0 containers, 0 sandboxes and an empty workspace root.
// `condition`: made in the 2026-11-18 condition (the recorder restored all three names, no warm control, the default drive).
export interface ReproRun {
  readonly cold: boolean;
  readonly condition: boolean;
  readonly verdict: RunVerdict;
}

export interface ReproResult {
  readonly outcome: ReproOutcome;
  readonly attempts: number;
  // Runs that count toward the rule, and how many of them failed (any class other than ANSWERED with the six names).
  readonly counted: number;
  readonly failing: number;
  readonly excluded: readonly { readonly index: number; readonly reasons: readonly ExcludeReason[] }[];
}

export function reproductionOutcome(runs: readonly ReproRun[]): ReproResult {
  const excluded: { index: number; reasons: ExcludeReason[] }[] = [];
  let counted = 0;
  let failing = 0;
  runs.forEach((run, index) => {
    const reasons: ExcludeReason[] = [];
    if (!run.cold) {
      reasons.push("not-cold");
    }
    if (!run.verdict.valid) {
      reasons.push("not-valid");
    }
    if (!run.condition) {
      reasons.push("not-2026-11-18-condition");
    }
    if (reasons.length > 0) {
      excluded.push({ index, reasons });
      return;
    }
    counted += 1;
    if (!isHealthy(run.verdict)) {
      failing += 1;
    }
  });
  let outcome: ReproOutcome;
  if (failing >= REPRO_FAIL_THRESHOLD) {
    outcome = "REPRODUCED";
  } else if (counted >= REPRO_MIN_VALID && failing === 0) {
    outcome = "NOT-REPRODUCED";
  } else if (counted === 0) {
    outcome = "VOID";
  } else {
    outcome = "INCONCLUSIVE";
  }
  return { outcome, attempts: runs.length, counted, failing, excluded };
}

// Whether the window asks for another run: not once an outcome is decided (two failing runs, or three valid runs none failing) and not
// past the attempt limit.
export function nextStep(runs: readonly ReproRun[]): "more" | "stop" {
  const { outcome, attempts } = reproductionOutcome(runs);
  return outcome === "REPRODUCED" || outcome === "NOT-REPRODUCED" || attempts >= REPRO_MAX_ATTEMPTS ? "stop" : "more";
}

// ---- D-47-05: the cause attribution rule -----------------------------------------------------------------------------------

// The controls of the window. C1: the legacy client alone against the fake server through the recorder (verdicts of its runs). C2: the
// realm alone, cold, the direct cold attach probe (whether it answered, and how long the handshake and tools/list took). C3: the
// legacy client warm, taken only when the reproduction is REPRODUCED (verdicts of its runs).
export interface Controls {
  readonly c1: readonly RunVerdict[];
  readonly c2: readonly { readonly answered: boolean; readonly ms?: number }[];
  readonly c3: readonly RunVerdict[];
}

export type Cause = "CLIENT" | "REALM-MCP" | "STACK" | "UNDETERMINED" | "NOT-ESTABLISHED";

export interface CauseVerdict {
  readonly cause: Cause;
  // The numbered rule of D-47-05 that decided; null for NOT-ESTABLISHED.
  readonly rule: number | null;
  // A fixed sentence of this file; never a message of a run.
  readonly reason: string;
  readonly errorCode?: number;
  readonly childExit?: ChildExit;
  // Rule 4: at least two closing moments agree within FIXED_TIMEOUT_SPREAD; the value in milliseconds.
  readonly fixedClientTimeoutMs?: number;
  // UNDETERMINED: what the evidence narrows to.
  readonly narrowing?: string;
}

export const NARROWING_NOT_COLD_STACK = "not cold-stack timing";

// The largest cluster of values that agree within FIXED_TIMEOUT_SPREAD of the larger one; its rounded mean, or undefined when no two agree.
function fixedValueOf(values: readonly number[]): number | undefined {
  const sorted = [...values].sort((a, b) => a - b);
  let best: number[] = [];
  for (let from = 0; from < sorted.length; from += 1) {
    const cluster: number[] = [];
    for (let at = from; at < sorted.length; at += 1) {
      const low = sorted[from];
      const high = sorted[at];
      if (low === undefined || high === undefined || high - low > FIXED_TIMEOUT_SPREAD * high) {
        break;
      }
      cluster.push(high);
    }
    if (cluster.length > best.length) {
      best = cluster;
    }
  }
  return best.length >= 2 ? Math.round(best.reduce((sum, value) => sum + value, 0) / best.length) : undefined;
}

function isStall(verdict: RunVerdict): boolean {
  if (verdict.L !== undefined) {
    return verdict.L > STALL_MS;
  }
  if (verdict.class === "NEVER-WRITTEN" && verdict.tRequest !== undefined) {
    return verdict.childExit === undefined || verdict.childExit.t >= verdict.tRequest + STALL_MS;
  }
  return false;
}

// D-47-05, in order, on the failing valid runs of a REPRODUCED window. Any other outcome has no attributed cause.
export function attributeCause(outcome: ReproOutcome, failing: readonly RunVerdict[], controls: Controls): CauseVerdict {
  if (outcome !== "REPRODUCED") {
    return { cause: "NOT-ESTABLISHED", rule: null, reason: "the reproduction did not reproduce, so no cause is attributed" };
  }
  if (controls.c1.length === 0) {
    return { cause: "UNDETERMINED", rule: null, reason: "control C1 has no run", narrowing: "control C1 is missing" };
  }
  // 1. The client against a server that answers at once.
  if (controls.c1.some((verdict) => !isHealthy(verdict))) {
    return { cause: "CLIENT", rule: 1, reason: "the client alone fails against a server that answers at once" };
  }
  // 2. An error response is realm's own, unless the host's request line was not valid JSON-RPC.
  const errors = failing.filter((verdict) => verdict.class === "ERROR");
  if (errors.length > 0) {
    if (errors.some((verdict) => verdict.invalidRequestLine)) {
      return { cause: "CLIENT", rule: 2, reason: "the response is an error and the host's request line was not valid JSON-RPC" };
    }
    const code = errors.find((verdict) => verdict.errorCode !== undefined)?.errorCode;
    return { cause: "REALM-MCP", rule: 2, reason: "the response is an error written by realm mcp", ...(code === undefined ? {} : { errorCode: code }) };
  }
  // 3. The server went away without answering.
  const gone = failing.find(
    (verdict) => verdict.class === "NEVER-WRITTEN" && verdict.tRequest !== undefined && verdict.childExit !== undefined && verdict.childExit.t < verdict.tRequest + STALL_MS,
  );
  if (gone?.childExit !== undefined) {
    return { cause: "REALM-MCP", rule: 3, reason: "the server exited without answering", childExit: gone.childExit };
  }
  // 4. The client closed before a healthy answer.
  if (failing.length > 0 && failing.every((verdict) => verdict.class === "WRITTEN-AFTER-CLOSE" && verdict.L !== undefined && verdict.G !== undefined && verdict.L <= STALL_MS && verdict.G < verdict.L)) {
    const fixed = fixedValueOf(failing.map((verdict) => verdict.G).filter((value): value is number => value !== undefined));
    return {
      cause: "CLIENT",
      rule: 4,
      reason: fixed === undefined ? "the client closed before a healthy answer" : "the client closed before a healthy answer: fixed client timeout",
      ...(fixed === undefined ? {} : { fixedClientTimeoutMs: fixed }),
    };
  }
  // 5. A stall: told apart by the controls.
  if (failing.some(isStall)) {
    if (controls.c3.length > 0 && controls.c3.some((verdict) => !isHealthy(verdict))) {
      return { cause: "UNDETERMINED", rule: 5, reason: "the failing runs stall and the warm client does not answer in every run", narrowing: NARROWING_NOT_COLD_STACK };
    }
    const c2Fast = controls.c2.length > 0 && controls.c2.every((run) => run.answered && run.ms !== undefined && run.ms <= STALL_MS);
    if (c2Fast && controls.c3.length > 0) {
      return { cause: "STACK", rule: 5, reason: "the failing runs stall, the realm alone answers within the bound and the warm client answers in every run" };
    }
  }
  // 6. Any other combination.
  return { cause: "UNDETERMINED", rule: 6, reason: "no rule of the attribution decides these runs" };
}

// ---- D-47-06: the environment ablation -------------------------------------------------------------------------------------

// The counts one poll of the reach observation took. A count that could not be read is absent.
export interface ReachCounts {
  readonly sandboxes?: number;
  readonly containers?: number;
  // Boot reports of the phase `attached` for the host, from `realm metrics`.
  readonly attached?: number;
}

export interface ReachPoll extends ReachCounts {
  // The mark of the poll, in milliseconds from the start of the observation.
  readonly atMs: number;
}

// A poll reaches the stack when a sandbox of the project exists, a container of the project exists, or an attached boot report was counted.
export function pollReached(counts: ReachCounts): boolean {
  return (counts.sandboxes ?? 0) >= 1 || (counts.containers ?? 0) >= 1 || (counts.attached ?? 0) >= 1;
}

// A run is reached when any of its polls reached.
export function runReached(polls: readonly ReachPoll[]): boolean {
  return polls.some(pollReached);
}

export interface AblationRun {
  // The names the recorder restored in this run.
  readonly restore: readonly string[];
  readonly polls: readonly ReachPoll[];
  // The catalogue codes found in the server's stderr copy (names only).
  readonly catalogueCodes: readonly string[];
}

export type NameVerdict = "NEEDED" | "NOT-NEEDED" | "UNDETERMINED";
export type NameBasis = "reach" | "fallback" | "insufficient-runs" | "disagreement";

export interface NameResult {
  readonly name: string;
  readonly verdict: NameVerdict;
  readonly basis: NameBasis;
  readonly runs: number;
  // basis fallback (SA not reached): the catalogue codes seen in this name's minus-N runs and in no SA run, sorted.
  readonly fallbackCodes?: readonly string[];
}

export interface AblationVerdict {
  // Every SA run reached the stack (and at least one SA run exists).
  readonly saReached: boolean;
  // S0, the real-user condition, recorded as a fact and never used by the per-name rule; undefined when no S0 run exists.
  readonly s0Reached?: boolean;
  readonly perName: readonly NameResult[];
  readonly text: string;
}

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((name) => right.includes(name)) && right.every((name) => left.includes(name));
}

// D-47-06. SA is all three names, S0 none, and for each name N all three minus N.
export function ablationVerdict(runs: readonly AblationRun[]): AblationVerdict {
  const saRuns = runs.filter((run) => sameSet(run.restore, ABLATION_NAMES));
  const s0Runs = runs.filter((run) => run.restore.length === 0);
  const saReached = saRuns.length > 0 && saRuns.every((run) => runReached(run.polls));
  const saCodes = new Set(saRuns.flatMap((run) => run.catalogueCodes));
  const perName: NameResult[] = ABLATION_NAMES.map((name) => {
    const minus = runs.filter((run) => sameSet(run.restore, ABLATION_NAMES.filter((other) => other !== name)));
    if (!saReached) {
      const fallbackCodes = [...new Set(minus.flatMap((run) => run.catalogueCodes).filter((code) => !saCodes.has(code)))].sort();
      return { name, verdict: "UNDETERMINED", basis: "fallback", runs: minus.length, ...(fallbackCodes.length === 0 ? {} : { fallbackCodes }) };
    }
    if (minus.length < ABLATION_RUNS_PER_NAME) {
      return { name, verdict: "UNDETERMINED", basis: "insufficient-runs", runs: minus.length };
    }
    const reached = minus.filter((run) => runReached(run.polls)).length;
    if (reached === 0) {
      return { name, verdict: "NEEDED", basis: "reach", runs: minus.length };
    }
    if (reached === minus.length) {
      return { name, verdict: "NOT-NEEDED", basis: "reach", runs: minus.length };
    }
    return { name, verdict: "UNDETERMINED", basis: "disagreement", runs: minus.length };
  });
  const needed = perName.filter((result) => result.verdict === "NEEDED").map((result) => result.name);
  const parts = perName.map((result) => `${result.name} ${result.verdict}`);
  const text = [
    parts.join("; "),
    needed.length > 0 ? `${needed.join(", ")} needed for this non-default stack` : "no name is shown needed for this non-default stack",
    "XDG_CONFIG_HOME is relocated by the production scenario, so its verdict holds for this non-default stack and a user with the default config location may not need it",
  ].join(". ");
  return { saReached, ...(s0Runs.length === 0 ? {} : { s0Reached: s0Runs.some((run) => runReached(run.polls)) }), perName, text };
}

// ---- The run record the runner reads ---------------------------------------------------------------------------------------

// The shape of run.json (written by test/support/host-live-evidence.ts): names, flags, counts and catalogue codes; never an environment
// value, a path or a message.
export interface RunRecord {
  readonly label: string;
  readonly restore: readonly string[];
  readonly warm: boolean;
  readonly diagnostic: boolean;
  readonly cold: boolean;
  readonly elapsedMs: number;
  readonly returned: boolean;
  readonly exitCode?: number;
  readonly catalogueCodes: readonly string[];
  // The control a run stands for (D-47-05), when it is one.
  readonly control?: "C1" | "C2" | "C3";
  // The members of the run folder the evidence writer could not write (names only).
  readonly evidenceFailures?: readonly string[];
}

// A run made in the 2026-11-18 condition: all three names restored, no warm control, the default drive.
export function isReproCondition(record: Pick<RunRecord, "restore" | "warm" | "diagnostic">): boolean {
  return !record.warm && !record.diagnostic && sameSet(record.restore, ABLATION_NAMES);
}

// The run record of a parsed run.json, or undefined when it is not one. Unknown members are dropped; a value of a wrong type refuses
// the whole record (the runner then names the folder as skipped).
export function parseRunRecord(value: unknown): RunRecord | undefined {
  if (!isObject(value)) {
    return undefined;
  }
  const { label, restore, warm, diagnostic, cold, elapsedMs, returned, exitCode, catalogueCodes, control } = value;
  const failures = stringList(value["evidenceFailures"]);
  const restoreNames = stringList(restore);
  const codes = stringList(catalogueCodes);
  if (
    typeof label !== "string" ||
    restoreNames === undefined ||
    codes === undefined ||
    typeof warm !== "boolean" ||
    typeof diagnostic !== "boolean" ||
    typeof cold !== "boolean" ||
    typeof elapsedMs !== "number" ||
    typeof returned !== "boolean" ||
    (exitCode !== undefined && typeof exitCode !== "number") ||
    (control !== undefined && control !== "C1" && control !== "C2" && control !== "C3")
  ) {
    return undefined;
  }
  return { label, restore: restoreNames, warm, diagnostic, cold, elapsedMs, returned, catalogueCodes: codes, ...(exitCode === undefined ? {} : { exitCode }), ...(control === undefined ? {} : { control }), ...(failures === undefined ? {} : { evidenceFailures: failures }) };
}

// The polls of a parsed reach.json (`{ polls: [...] }`); a poll that is not a record with a numeric `atMs` is dropped, a count that is not a
// number is absent. Undefined when the document has no polls member.
export function parseReachPolls(value: unknown): ReachPoll[] | undefined {
  if (!isObject(value) || !Array.isArray(value["polls"])) {
    return undefined;
  }
  const polls: ReachPoll[] = [];
  for (const entry of value["polls"] as unknown[]) {
    if (!isObject(entry) || typeof entry["atMs"] !== "number") {
      continue;
    }
    const { sandboxes, containers, attached } = entry;
    polls.push({
      atMs: entry["atMs"],
      ...(typeof sandboxes === "number" ? { sandboxes } : {}),
      ...(typeof containers === "number" ? { containers } : {}),
      ...(typeof attached === "number" ? { attached } : {}),
    });
  }
  return polls;
}

// The direct cold attach probe (33-03 Task 2; COLD-02, COLD-04). It launches `realm mcp --host claude` on the production stack for a
// project nobody has started, and records what a host sees on one connection: the handshake replies within seconds while the realm is
// not active, tool calls refused REALM_NOT_ACTIVE (retryable) while the bring-up runs, and the same process serving a call once the
// session is active. No recipe is installed and no receipt is written: the probe starts the CLI itself, so no host binary is needed.
//
// Two parts:
//   judgeColdTimeline   a pure judge of one recorded timeline (covered by test/integration/cold-attach-probe-helpers.test.ts)
//   runColdAttachProbe  the live driver; it returns the timeline for the judge and the per-step marks for the diagnostics
//
// Marks are milliseconds since the process was spawned. Nothing here records a path, a token or a header value.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { META_PROTOCOL_VERSION, MCP_MODERN_VERSION } from "../../src/mcp/protocol.js";
import { bootPhaseCountsOf } from "./host-live.js";
import {
  describeValue,
  field,
  findRpcReply,
  pollUntil,
  realmCli,
  realmCliWithWorkspace,
  splitJsonRpcLines,
  stateOfStatus,
  type LiveInputs,
  type RpcReply,
  type ScenarioEnvironment,
} from "./production-live.js";

// Every handshake reply must arrive within this bound of the spawn: the bring-up takes tens of seconds on a cold sandbox, so a reply
// inside the bound was not waiting for it (the shortest known host connect timeout is OpenCode's 30 s).
export const HANDSHAKE_BOUND_MS = 10_000;
// The bound for the realm to serve a call after the handshake: the cold bring-up (35 to 60 s measured 2026-11-18) with a margin.
export const COLD_PROBE_READY_TIMEOUT_MS = 240_000;
const POLL_INTERVAL_MS = 2_000;
const HANDSHAKE_WAIT_MS = 60_000;
const CALL_TIMEOUT_MS = 60_000;
const COMMAND_TIMEOUT_MS = 60_000;
const BOOT_REPORT_TIMEOUT_MS = 90_000;
const EXIT_TIMEOUT_MS = 10_000;
const STDERR_LIMIT = 16 * 1024;
const PROBE_HOST = "claude";

// ---- The judge ---------------------------------------------------------------------------------------------------------------

// One tool call that was not served, as the host saw it.
export interface ColdRefusal {
  readonly tool: string;
  readonly atMs: number;
  readonly code: string;
  readonly retryable: boolean;
  readonly isError: boolean;
}

export interface ColdTimeline {
  // The mark of each handshake reply; undefined when the reply never came.
  readonly replyMs: { readonly discover: number | undefined; readonly initialize: number | undefined; readonly toolsList: number | undefined };
  // The lifecycle state `realm status` reported right after the last handshake reply; undefined when status gave none.
  readonly statusAtReply: string | undefined;
  readonly refusals: readonly ColdRefusal[];
  // The mark of the first call that returned a done outcome; undefined when none did.
  readonly firstSuccessMs: number | undefined;
  // How many status polls ran after the first two calls.
  readonly polls: number;
  // True when the child ended before the probe closed its stdin: it was not the same process throughout.
  readonly childExited: boolean;
  readonly elapsedMs: number;
}

export type ColdRule = "handshake-bound" | "cold-start" | "refusal-in-window" | "refusal-shape" | "success-after-refusal" | "same-process";

export type ColdVerdict = { readonly pass: true; readonly facts: readonly string[] } | { readonly pass: false; readonly rule: ColdRule; readonly message: string };

function failed(rule: ColdRule, detail: string): ColdVerdict {
  return { pass: false, rule, message: `${rule}: ${detail}` };
}

// Judges one timeline. The first violated rule fails the verdict by name; a pass lists the facts it established.
export function judgeColdTimeline(timeline: ColdTimeline): ColdVerdict {
  const marks: readonly (readonly [string, number | undefined])[] = [
    ["server/discover", timeline.replyMs.discover],
    ["initialize", timeline.replyMs.initialize],
    ["tools/list", timeline.replyMs.toolsList],
  ];
  for (const [name, mark] of marks) {
    if (mark === undefined) {
      return failed("handshake-bound", `the ${name} reply never arrived`);
    }
    if (mark > HANDSHAKE_BOUND_MS) {
      return failed("handshake-bound", `the ${name} reply arrived at ${String(mark)} ms, later than the ${String(HANDSHAKE_BOUND_MS)} ms bound`);
    }
  }
  if (timeline.statusAtReply === "active") {
    return failed("cold-start", "realm status already answered active when the handshake replies arrived, so the run was not cold");
  }
  if (timeline.refusals.length === 0) {
    return failed("refusal-in-window", "no call was refused in the window, so the handshake was not shown ahead of readiness");
  }
  for (const refusal of timeline.refusals) {
    if (!refusal.isError || refusal.code !== "REALM_NOT_ACTIVE" || !refusal.retryable) {
      return failed(
        "refusal-shape",
        `the refused ${refusal.tool} call at ${String(refusal.atMs)} ms had isError ${String(refusal.isError)}, code ${refusal.code} and retryable ${String(refusal.retryable)}; it must be an error REALM_NOT_ACTIVE with retryable true`,
      );
    }
  }
  const lastRefusalMs = Math.max(...timeline.refusals.map((refusal) => refusal.atMs));
  if (timeline.firstSuccessMs === undefined) {
    return failed("success-after-refusal", `no call succeeded after the last refusal at ${String(lastRefusalMs)} ms (${String(timeline.polls)} status polls)`);
  }
  if (timeline.firstSuccessMs <= lastRefusalMs) {
    return failed("success-after-refusal", `the first success at ${String(timeline.firstSuccessMs)} ms is not later than the last refusal at ${String(lastRefusalMs)} ms`);
  }
  if (timeline.childExited) {
    return failed("same-process", "the realm mcp process ended before the probe closed its input, so the connection was not the same throughout");
  }
  return {
    pass: true,
    facts: [
      `handshake replies at ${String(timeline.replyMs.discover)}, ${String(timeline.replyMs.initialize)} and ${String(timeline.replyMs.toolsList)} ms (bound ${String(HANDSHAKE_BOUND_MS)} ms)`,
      `realm status was ${timeline.statusAtReply ?? "not reported"} when the replies arrived`,
      `${String(timeline.refusals.length)} calls refused REALM_NOT_ACTIVE with retryable true, the last at ${String(lastRefusalMs)} ms`,
      `the first success at ${String(timeline.firstSuccessMs)} ms after ${String(timeline.polls)} status polls, on the same process`,
    ],
  };
}

// ---- The live driver ---------------------------------------------------------------------------------------------------------

export interface ColdMark {
  readonly step: string;
  readonly ms: number;
}

// What the probe observed after the first success, for the live test to assert.
export interface ColdAfterReady {
  // The outcome of the list of the workspace root on the same connection: done when served.
  readonly listOutcome: string;
  // The attached boot reports for the probe's host that the daemon counted, polled with a bound.
  readonly attachedBoots: number;
  // The per-phase boot report counts for the host, for the diagnostics.
  readonly bootPhases: Readonly<Record<string, number>>;
  readonly presenceMarkerPresent: boolean;
  // How the child ended after its stdin was closed; undefined when it was still running after the bound.
  readonly exit: { readonly code: number | null; readonly signal: string | null } | undefined;
  readonly presenceMarkerGone: boolean;
}

export interface ColdProbeResult {
  readonly timeline: ColdTimeline;
  readonly marks: readonly ColdMark[];
  readonly afterReady: ColdAfterReady | undefined;
  // The clipped stderr text of the child, for a failure message.
  readonly stderr: string;
}

export interface ColdProbeOptions {
  readonly inputs: LiveInputs;
  readonly scenario: ScenarioEnvironment;
  // A new project directory under the pinned workspace root that nothing has started.
  readonly projectDir: string;
}

type CallClass = { readonly kind: "done" } | { readonly kind: "refused"; readonly code: string; readonly retryable: boolean; readonly isError: boolean };

// A tools/call result and the mark of its reply.
interface ServedCall {
  readonly atMs: number;
  readonly result: unknown;
}

interface ChildEnd {
  readonly code: number | null;
  readonly signal: string | null;
}

// A tools/call result is served when its outcome is done and it is no error; every other outcome is a refusal with whatever code it carries.
function classifyCall(result: unknown): CallClass {
  const structured = field(result, "structuredContent");
  const isError = field(result, "isError") === true;
  if (field(structured, "outcome") === "done" && !isError) {
    return { kind: "done" };
  }
  const code = field(structured, "code");
  return { kind: "refused", code: typeof code === "string" ? code : "(none)", retryable: field(structured, "retryable") === true, isError };
}

// Launches `realm mcp --host claude --workspace <project>` and drives the cold attach. The child is killed when it is still running at the end.
export async function runColdAttachProbe(options: ColdProbeOptions): Promise<ColdProbeResult> {
  const { inputs, scenario, projectDir } = options;
  const productionPath = inputs.hostEnvironment["PATH"];
  const env: Record<string, string> = { ...scenario.cliEnvironment, ...(productionPath === undefined ? {} : { PATH: productionPath }) };
  const startedAt = Date.now();
  const now = (): number => Date.now() - startedAt;
  const marks: ColdMark[] = [];
  const mark = (step: string): number => {
    const ms = now();
    marks.push({ step, ms });
    return ms;
  };

  const child = spawn(process.execPath, [inputs.cliPath, "mcp", "--host", PROBE_HOST, "--workspace", projectDir], {
    env,
    cwd: scenario.root,
    stdio: ["pipe", "pipe", "pipe"],
  });
  mark("spawned");
  const received: string[] = [];
  const arrivals = new Map<number, number>();
  const waiters = new Set<() => void>();
  let partial = "";
  let stderrText = "";
  // Written by the child's event handlers, read by the driver: held in one object so the reads are not narrowed to their initial value.
  const live: { exit: ChildEnd | undefined; failure: string | undefined } = { exit: undefined, failure: undefined };
  const wake = (): void => {
    for (const waiter of [...waiters]) {
      waiter();
    }
  };
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    const split = splitJsonRpcLines(partial + chunk);
    partial = split.rest;
    const at = now();
    for (const line of split.lines) {
      received.push(line);
      try {
        const id: unknown = (JSON.parse(line) as Record<string, unknown>)["id"];
        if (typeof id === "number" && !arrivals.has(id)) {
          arrivals.set(id, at);
        }
      } catch {
        // A line that is not a JSON object has no id; the judge sees the missing reply.
      }
    }
    wake();
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    if (stderrText.length < STDERR_LIMIT) {
      stderrText += chunk;
    }
  });
  child.stdin.on("error", (error: NodeJS.ErrnoException) => {
    live.failure = `stdin ${error.code ?? "failed"}`;
    wake();
  });
  child.once("error", (error: NodeJS.ErrnoException) => {
    live.failure = `spawn ${error.code ?? "failed"}`;
    wake();
  });
  child.once("close", (code, signal) => {
    live.exit = { code, signal };
    wake();
  });

  // Resolves with the first value probe returns, checked now and on every change of the child's output or state; undefined at timeoutMs.
  const waitFor = <T>(probe: () => T | undefined, timeoutMs: number): Promise<T | undefined> =>
    new Promise((resolve) => {
      const timer = setTimeout(() => {
        waiters.delete(check);
        resolve(undefined);
      }, timeoutMs);
      const check = (): void => {
        const found = probe();
        if (found !== undefined) {
          clearTimeout(timer);
          waiters.delete(check);
          resolve(found);
        }
      };
      waiters.add(check);
      check();
    });
  const send = (message: Record<string, unknown>): void => {
    child.stdin.write(`${JSON.stringify(message)}\n`);
  };
  let nextId = 0;
  const sendRequest = (method: string, params: unknown): number => {
    nextId += 1;
    send({ jsonrpc: "2.0", id: nextId, method, params });
    return nextId;
  };
  // One tools/call; undefined when no result came (the child ended or the bound passed).
  const callTool = async (tool: string, args: Readonly<Record<string, unknown>>): Promise<ServedCall | undefined> => {
    const id = sendRequest("tools/call", { name: tool, arguments: args });
    const reply = await waitFor<RpcReply>(() => findRpcReply(received, id), CALL_TIMEOUT_MS);
    return reply?.kind === "result" ? { atMs: arrivals.get(id) ?? now(), result: reply.result } : undefined;
  };

  const refusals: ColdRefusal[] = [];
  const seen: { firstSuccessMs: number | undefined } = { firstSuccessMs: undefined };
  let polls = 0;
  const replyMs: { discover: number | undefined; initialize: number | undefined; toolsList: number | undefined } = {
    discover: undefined,
    initialize: undefined,
    toolsList: undefined,
  };
  const markerFile = (pid: number): string => join(scenario.stateDir, "hosts", `${PROBE_HOST}-active`, `${String(pid)}.json`);
  // Records one call: a refusal joins the list, the first done outcome sets the success mark.
  const record = (tool: string, served: ServedCall | undefined): void => {
    if (served === undefined) {
      return;
    }
    const outcome = classifyCall(served.result);
    if (outcome.kind === "refused") {
      refusals.push({ tool, atMs: served.atMs, code: outcome.code, retryable: outcome.retryable, isError: outcome.isError });
      mark(`${tool} refused ${outcome.code}`);
    } else if (seen.firstSuccessMs === undefined) {
      seen.firstSuccessMs = served.atMs;
      mark(`${tool} served`);
    }
  };

  try {
    // A modern-era server/discover, a legacy-era initialize and tools/list, all at once: the three replies are the handshake a host waits for.
    const discoverId = sendRequest("server/discover", { _meta: { [META_PROTOCOL_VERSION]: MCP_MODERN_VERSION } });
    const initializeId = sendRequest("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "realm-cold-probe", version: "0" } });
    const listId = sendRequest("tools/list", {});
    await waitFor(() => {
      const complete = arrivals.has(discoverId) && arrivals.has(initializeId) && arrivals.has(listId);
      return complete || live.exit !== undefined || live.failure !== undefined ? true : undefined;
    }, HANDSHAKE_WAIT_MS);
    replyMs.discover = arrivals.get(discoverId);
    replyMs.initialize = arrivals.get(initializeId);
    replyMs.toolsList = arrivals.get(listId);
    mark("handshake replies seen");
    send({ jsonrpc: "2.0", method: "notifications/initialized" });

    const status = await realmCliWithWorkspace(inputs, scenario, ["status"], projectDir, COMMAND_TIMEOUT_MS);
    const statusAtReply = status.exitCode === 0 ? stateOfStatus(status.stdout) : undefined;
    mark(`realm status read (exit ${String(status.exitCode)}, state ${statusAtReply ?? "none"})`);

    // Inside the window: a status call and an exec are both refused; then status is polled until a call is served.
    record("status", await callTool("status", {}));
    record("exec", await callTool("exec", { argv: ["true"] }));
    const deadline = Date.now() + COLD_PROBE_READY_TIMEOUT_MS;
    while (seen.firstSuccessMs === undefined && Date.now() < deadline && live.exit === undefined && live.failure === undefined) {
      await sleep(POLL_INTERVAL_MS);
      polls += 1;
      record("status", await callTool("status", {}));
    }
    const childExited = live.exit !== undefined;
    const { firstSuccessMs } = seen;
    const elapsedMs = firstSuccessMs ?? now();

    let afterReady: ColdAfterReady | undefined;
    if (firstSuccessMs !== undefined && !childExited) {
      const listed = await callTool("list", { path: ".", depth: 1 });
      let listOutcome = "no reply";
      if (listed !== undefined) {
        const served = classifyCall(listed.result);
        listOutcome = served.kind === "done" ? "done" : describeValue(field(listed.result, "structuredContent"));
      }
      mark(`list of the workspace root: ${listOutcome}`);
      let bootPhases: Readonly<Record<string, number>> = {};
      await pollUntil(
        async () => {
          const metrics = await realmCli(inputs, scenario, ["metrics", "--workspace", projectDir], COMMAND_TIMEOUT_MS);
          bootPhases = metrics.exitCode === 0 ? bootPhaseCountsOf(metrics.stdout, PROBE_HOST) : {};
          const attached = bootPhases["attached"] ?? 0;
          return attached >= 1 ? { done: true } : { done: false, detail: `attached boot reports for ${PROBE_HOST}: ${String(attached)}` };
        },
        { timeoutMs: BOOT_REPORT_TIMEOUT_MS, intervalMs: POLL_INTERVAL_MS },
      );
      mark("boot reports read");
      const { pid } = child;
      const presenceMarkerPresent = pid !== undefined && existsSync(markerFile(pid));
      child.stdin.end();
      const ended = await waitFor(() => live.exit, EXIT_TIMEOUT_MS);
      mark("child ended after stdin end");
      afterReady = {
        listOutcome,
        attachedBoots: bootPhases["attached"] ?? 0,
        bootPhases,
        presenceMarkerPresent,
        exit: ended,
        presenceMarkerGone: pid !== undefined && !existsSync(markerFile(pid)),
      };
    }
    return {
      timeline: { replyMs, statusAtReply, refusals, firstSuccessMs, polls, childExited, elapsedMs },
      marks,
      afterReady,
      stderr: stderrText,
    };
  } finally {
    if (live.exit === undefined) {
      child.kill("SIGKILL");
    }
  }
}

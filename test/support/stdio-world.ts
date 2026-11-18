// The scripted-daemon world of the stdio boot suites (test/cli/stdio-host.test.ts and test/cli/stdio-host-matrix.test.ts): a
// scripted daemon, a session of realm mcp or realm acp on injected streams, signals and timers, and the marker and report
// readers. Every daemon is a script, every timer and signal an injected seam: nothing here opens a socket, arms a boot timer
// or raises a real signal. What the helpers read from a test file's scope is one argument, the StdioRig.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { runCli, type CliDeps, type CliResult, type ConnectDaemon, type SendControlRequest, type SpawnDaemon } from "../../src/cli/main.js";
import { RealmError, type ErrorCode } from "../../src/core/errors.js";
import type { State } from "../../src/core/states.js";
import type { ControlReply, ControlRequest, ControlSelection } from "../../src/daemon/channel.js";
import type { ConnectDaemonOptions, DaemonClient, DaemonStatus } from "../../src/daemon/client.js";
import { parseHostBootReport, type HostBootReport } from "../../src/host/boot-report.js";
import type { MetricsSnapshot } from "../../src/observe/metrics.js";
import { sessionIdOfWorkspace, type EnvironmentLike } from "../../src/session/paths.js";
import type { ToolOutcome } from "../../src/tools/dispatch.js";
import { FakeTimers } from "./fake-host-daemon.js";
import { capture, FakeSignals, untilReplyOn, type Capture } from "./stdio-host-harness.js";
import { boundedWait, pollUntil } from "./timing.js";

const AT = "2026-10-22T00:00:00.000Z";

// What a suite supplies from its own module scope.
export interface StdioRig {
  // The default environment of a session.
  readonly env: EnvironmentLike;
  readonly stateDir: string;
  readonly workspace: string;
  readonly daemonEntry: string;
}

// ---- A scripted daemon -------------------------------------------------------------------------------------------------------

export interface World {
  // Whether the control socket answers a status probe.
  daemonUp: boolean;
  // What up does: answer, never settle, or refuse with a catalogue code.
  upResult: "ok" | "hang" | ErrorCode;
  state: State;
  reason: string;
  // The status after up names another project's root and session.
  readbackOther: boolean;
  // When set, a status call made after up waits on it: the readback is held open.
  gateAfterUp: Promise<void> | null;
  // When set, up waits on it after it is logged: the up is held open and released later (Phase 33).
  gateUp: Promise<void> | null;
  upSeen: boolean;
  // The code a forwarded tool call is refused with (default REALM_NOT_ACTIVE; POLICY_DENIED scripts the daemon's capability refusal).
  callCode: ErrorCode;
  readonly log: string[];
  readonly tools: unknown[];
  readonly clients: ScriptedClient[];
}

export const newWorld = (): World => ({
  daemonUp: true,
  upResult: "ok",
  state: "active",
  reason: "realm active",
  readbackOther: false,
  gateAfterUp: null,
  gateUp: null,
  upSeen: false,
  callCode: "REALM_NOT_ACTIVE",
  log: [],
  tools: [],
  clients: [],
});

function statusOf(world: World, selection: ControlSelection): DaemonStatus {
  return {
    snapshot: { state: world.state, reason: world.reason, lastTransitionAt: AT },
    display: { label: "realm active", reason: world.reason, lastTransitionAt: AT },
    mode: "advisory",
    boundRoot: world.readbackOther ? "/ws/other" : selection.workspaceRoot,
    sessionId: world.readbackOther ? sessionIdOfWorkspace("/ws/other") : selection.sessionId,
  };
}

export class ScriptedClient implements DaemonClient {
  closeCalls = 0;
  upCalls = 0;
  constructor(
    private readonly world: World,
    private readonly selection: ControlSelection,
    // The third argument the host passed to connect (CAPT-06): undefined when it passed two.
    readonly options?: ConnectDaemonOptions,
  ) {}

  async status(): Promise<DaemonStatus> {
    this.world.log.push("status");
    if (!this.world.daemonUp) {
      throw new RealmError("REALM_NOT_ACTIVE");
    }
    if (this.world.upSeen && this.world.gateAfterUp !== null) {
      await this.world.gateAfterUp;
    }
    return statusOf(this.world, this.selection);
  }

  async up(): Promise<DaemonStatus> {
    this.world.log.push("up");
    this.world.upSeen = true;
    this.upCalls += 1;
    if (this.world.gateUp !== null) {
      await this.world.gateUp;
    }
    if (this.world.upResult === "hang") {
      return new Promise<DaemonStatus>(() => undefined);
    }
    if (this.world.upResult !== "ok") {
      throw new RealmError(this.world.upResult);
    }
    return statusOf(this.world, this.selection);
  }

  call(tool: unknown): Promise<ToolOutcome> {
    this.world.log.push("call");
    this.world.tools.push(tool);
    return Promise.resolve({ outcome: "refused", tool: "status", code: this.world.callCode, retryable: true });
  }

  metrics(): Promise<MetricsSnapshot> {
    return Promise.reject(new RealmError("REALM_NOT_ACTIVE"));
  }

  close(): void {
    this.closeCalls += 1;
  }
}

// The clients that received up: the adopted ones, not the liveness probes.
export const adopted = (world: World): ScriptedClient[] => world.clients.filter((client) => client.upCalls > 0);

// ---- Injected seams ----------------------------------------------------------------------------------------------------------

// FakeSignals and capture are shared with the isolation suite (test/support/stdio-host-harness.ts).

export interface Session {
  readonly result: Promise<CliResult>;
  readonly input: PassThrough;
  readonly output: Capture;
  readonly diagnostics: Capture;
  readonly sent: ControlRequest[];
  readonly signals: FakeSignals;
  readonly timers: FakeTimers;
  readonly spawns: string[];
  readonly world: World;
}

export interface StartOptions {
  readonly argv: readonly string[];
  readonly world?: World;
  readonly env?: EnvironmentLike;
  readonly timeoutMs?: number;
  readonly send?: SendControlRequest;
  // The injected boot timers (default: a fresh FakeTimers).
  readonly timers?: FakeTimers;
}

export function startSession(options: StartOptions, rig: StdioRig): Session {
  const world = options.world ?? newWorld();
  const input = new PassThrough();
  const output = capture();
  const diagnostics = capture();
  const sent: ControlRequest[] = [];
  const spawns: string[] = [];
  const signals = new FakeSignals();
  const timers = options.timers ?? new FakeTimers();
  const connect: ConnectDaemon = (_socketPath, selection, options) => {
    const client = new ScriptedClient(world, selection, options);
    world.clients.push(client);
    return client;
  };
  const spawn: SpawnDaemon = (_file, args) => {
    spawns.push(...args);
    return { unref: () => undefined };
  };
  const send: SendControlRequest =
    options.send ?? ((_socketPath, request): Promise<ControlReply> => Promise.resolve({ id: request.id, result: { recorded: true } }));
  const deps: CliDeps = {
    env: options.env ?? rig.env,
    cwd: rig.workspace,
    daemonEntry: rig.daemonEntry,
    timeoutMs: options.timeoutMs ?? 2000,
    spawn,
    connect,
    send: (socketPath, request, timeoutMs) => {
      sent.push(request);
      return send(socketPath, request, timeoutMs);
    },
    mcpInput: input,
    mcpOutput: output.stream,
    acpInput: input,
    acpOutput: output.stream,
    diagnostics: diagnostics.stream,
    signals,
    bootTimers: timers,
    random: timers.random,
    now: timers.now,
  };
  const result = runCli(options.argv, deps);
  return { result, input, output, diagnostics, sent, signals, timers, spawns, world };
}

export const untilReply = (session: Session, id: number): Promise<Record<string, unknown>> => untilReplyOn(session.output, id);

export async function finish(session: Session): Promise<CliResult> {
  session.input.end();
  return boundedWait(session.result, "the session ending after stdin closed", 10_000);
}

// The directory a host's markers live in.
const markerDirOf = (rig: StdioRig, host: string): string => join(rig.stateDir, "hosts", `${host}-active`);

// The marker file this process wrote for a host.
export const markerPathOf = (rig: StdioRig, host: string): string => join(markerDirOf(rig, host), `${String(process.pid)}.json`);

export const markerOf = (rig: StdioRig, host: string): Record<string, unknown> =>
  JSON.parse(readFileSync(markerPathOf(rig, host), "utf8")) as Record<string, unknown>;

// ---- Readiness waits (Phase 33) ----------------------------------------------------------------------------------------------

const ADOPTED_PHASES: readonly string[] = ["attached", "refused"];
const SETTLED_PHASES: readonly string[] = ["attached", "refused", "failed"];

const phasesOf = (sent: readonly ControlRequest[]): string[] =>
  reportsOf(sent.filter((request) => request.method === "host-boot")).map((report) => report.phase);

// Waits until the session adopted a client: a host-boot report whose phase is attached or refused was sent. The observer sends
// it only after the driver adopted a verified client, so this is the exact moment a tools/call is forwarded.
export const untilAttached = (session: Session): Promise<void> =>
  pollUntil(() => phasesOf(session.sent).some((phase) => ADOPTED_PHASES.includes(phase)), "the boot adopting a client (an attached or refused report)");

// Waits until the first attempt settled either way: a report whose phase is attached, refused or failed.
export const untilSettled = (session: Session): Promise<void> =>
  pollUntil(() => phasesOf(session.sent).some((phase) => SETTLED_PHASES.includes(phase)), "the boot settling (an attached, refused or failed report)");

export const reportsOf = (sent: readonly ControlRequest[]): HostBootReport[] =>
  sent.map((request) => {
    assert.equal(request.method, "host-boot");
    const params = request.params;
    assert.ok(typeof params === "object" && params !== null && "report" in params);
    return parseHostBootReport(params.report);
  });

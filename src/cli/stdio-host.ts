// The boot sequence of `realm mcp` and `realm acp` (Phase 23, BOOT-03, BOOT-04, BOOT-08; Phase 33, COLD-01 to COLD-03). Both
// entries run the same numbered steps:
//   1 resolve  the host's manifest and bounds (or the defaults for a session with no --host), a boot id, the observer;
//   2 ensure   probe the control socket, spawn the detached daemon at most once, poll to the up bound;
//   3 up       connect for the workspace's selection and run the idempotent up;
//   4 readback one status read, validated against the selection (session id, bound root);
//   5 settle   the driver's outcome: ready, refused or failed; marker written, boot report sent, log line written;
//   6 expose   MCP creates its server and reads stdin; ACP starts its agent.
// Steps 2 to 5 are the boot driver (src/host/boot-driver.ts) fed the shared attach (src/host/attach.ts). MCP exposes right after
// step 1 while steps 2 to 5 run behind it: the handshake and tools/list are answered at once, every tool call is refused
// REALM_NOT_ACTIVE (retryable) until the driver has adopted a verified client, and the same connection forwards calls after
// that; the host observes boot through the handshake reply, then the refusals or the first forwarded call. When the boot
// settles, src/cli/stdio-settle.ts decides the one diagnostic and whether the process exits 1 at stdin end (D-33-05). ACP
// exposes after step 5: nothing reads stdin before step 5 settles, so its first protocol reply is the readiness signal, and a
// boot that does not end ready exits 1 before any frame. The runner writes no stdout at all: boot text goes to diagnostics,
// and stdout holds protocol frames only, in every outcome.
//
// Teardown is one idempotent function run when stdin ends, on SIGTERM, SIGINT or SIGHUP, and on every other exit: the driver
// shuts down (timers cleared, client closed, marker removed, a `closed` report sent) and the observer flushes within one second.
// No code path here, or in the driver, the attach or the observer, sends `down`: the sandbox lasts until `realm down`.
//
// This module reads no environment. The CLI entry hands it the raw log level, the host id, the flags and every seam, so tests
// raise no real signal and arm no real timer.

import type { Readable, Writable } from "node:stream";
import { runAcpOverStdio } from "../acp/stdio.js";
import { makeRealmError, RealmError, type ErrorCode } from "../core/errors.js";
import type { ControlReply, ControlRequest, ControlSelection } from "../daemon/channel.js";
import { selectionOf, type ConnectDaemonOptions, type DaemonClient, type DaemonStatus } from "../daemon/client.js";
import { createDaemonAttach, type RefusalRetention } from "../host/attach.js";
import { BOOT_BOUNDS, resolveBoot, type ResolvedBoot } from "../host/boot.js";
import { bootHookOf, createBootDriver, type BootDriver } from "../host/boot-driver.js";
import { createBootObserver, type BootObserver } from "../host/boot-observer.js";
import { defaultManifestFor, parseHostPluginManifest } from "../host/manifest.js";
import { createRefusalHint } from "../host/refusal-hint.js";
import { HOST_RUNTIMES } from "../host/runtimes.js";
import type { HostBootDeps, HostId, HostStatusSink, HostTimers } from "../host/types.js";
import { newCorrelationId } from "../observe/ids.js";
import { createLogger, parseLogLevel, type LogLevel } from "../observe/logger.js";
import { createStderrSink } from "../observe/log-file.js";
import { createMcpServer } from "../mcp/server.js";
import type { ToolOutcome } from "../tools/dispatch.js";
import { describeSettle, exitCodeAfterClose } from "./stdio-settle.js";

export type StdioSignal = "SIGTERM" | "SIGINT" | "SIGHUP";

// The signal seam. `once` registers a one-shot handler and returns its release; `exit` ends the process (the default does not
// return; a test's records the code).
export interface StdioSignals {
  readonly once: (signal: StdioSignal, handler: () => void) => () => void;
  readonly exit: (code: number) => void;
}

// The exact stderr texts the pinned CLI tests assert, produced by the functions that produce them today.
export interface StdioHostFormat {
  readonly attachFailure: (error: unknown) => string;
  readonly diagnosticFor: (error: unknown) => string;
  readonly upRefusal: (lifecycle: { readonly state: unknown; readonly reason: unknown }) => { readonly code: ErrorCode; readonly reason: string };
  readonly writeNotice: (status: DaemonStatus) => void;
}

export interface StdioHostInput {
  readonly transport: "mcp" | "acp";
  readonly workspaceRoot: string;
  // The canonical id of an mcp-config host, or null for a session started with no --host.
  readonly hostId: HostId | null;
  readonly reattach: boolean;
  readonly socketPath: string;
  readonly stateDir: string;
  readonly connect: (socketPath: string, selection: ControlSelection, options?: ConnectDaemonOptions) => DaemonClient;
  readonly spawnDaemon: () => void;
  readonly send: (socketPath: string, request: ControlRequest, timeoutMs: number) => Promise<ControlReply>;
  readonly diagnostics: Writable;
  readonly mcpInput: Readable;
  readonly mcpOutput: Writable;
  readonly acpInput: NodeJS.ReadableStream;
  readonly acpOutput: NodeJS.WritableStream;
  readonly upBoundMs: number;
  readonly pollMs: number;
  // The raw REALM_LOG_LEVEL value. Unset means error: a default session writes nothing it did not write before.
  readonly logLevel: string | undefined;
  readonly format: StdioHostFormat;
  readonly signals: StdioSignals;
  readonly timers: HostTimers;
  readonly random: () => number;
  readonly now: () => Date;
  readonly pid: number;
  readonly version: string;
}

export interface StdioHostResult {
  readonly exitCode: number;
  readonly stdout: "";
  readonly stderr: string;
}

const SIGNALS: readonly StdioSignal[] = ["SIGTERM", "SIGINT", "SIGHUP"];
const SIGNAL_NUMBER: Readonly<Record<StdioSignal, number>> = Object.freeze({ SIGHUP: 1, SIGINT: 2, SIGTERM: 15 });
// The bound on the closing report and the observer flush.
const FLUSH_MS = 1_000;
const SIGNALLED: unique symbol = Symbol("signalled");

function bootBoundsOf(input: StdioHostInput): ResolvedBoot {
  if (input.hostId === null) {
    return Object.freeze({ ...BOOT_BOUNDS, reattach: Object.freeze({ ...BOOT_BOUNDS.reattach, enabled: input.reattach }) });
  }
  return resolveBoot(
    parseHostPluginManifest({ ...defaultManifestFor(input.hostId, input.version), boot: { reattach: { enabled: input.reattach } } }),
  );
}

function driverOf(input: StdioHostInput, deps: HostBootDeps, bounds: ResolvedBoot): BootDriver {
  if (input.hostId === null) {
    return createBootDriver(deps, bounds);
  }
  const factory = bootHookOf(HOST_RUNTIMES[input.hostId]);
  if (factory === null) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  return factory(
    deps,
    parseHostPluginManifest({ ...defaultManifestFor(input.hostId, input.version), boot: { reattach: { enabled: input.reattach } } }),
  );
}

export async function runStdioHost(input: StdioHostInput): Promise<StdioHostResult> {
  const { format } = input;
  const fail = (stderr: string): StdioHostResult => ({ exitCode: 1, stdout: "", stderr });

  // 1 resolve. The canonical root (a realpath) is what the daemon pins and what the driver's readback is checked against.
  let selection: ControlSelection;
  try {
    selection = selectionOf(input.workspaceRoot);
  } catch (error: unknown) {
    return fail(format.attachFailure(error));
  }
  const raw = input.logLevel;
  const level: LogLevel = raw === undefined || raw.trim() === "" ? "error" : parseLogLevel(raw).level;
  const logger = createLogger({ sink: createStderrSink(input.diagnostics), level, now: input.now });
  const bootId = newCorrelationId();
  let sessionId: string | null = selection.sessionId;
  const observer: BootObserver = createBootObserver({
    hostId: input.hostId ?? "unlabelled",
    transport: input.transport,
    bootId,
    stateDir: input.stateDir,
    socketPath: input.socketPath,
    logger,
    diagnostics: input.diagnostics,
    send: input.send,
    pid: input.pid,
    startedAt: input.now().toISOString(),
    sessionId: () => sessionId,
  });

  let noticeWritten = false;
  // The refusal of the last attach that resolved with one, kept on an object so the readers below see closure writes.
  const attachSeen: { refusal: RealmError | null } = { refusal: null };
  // The MCP session's state across the background boot: `ending` once stdin closed or a signal came (no text is written after
  // teardown began), `noClient` when the settle decided that a process that never adopted a client exits 1.
  const session = { ending: false, noClient: false };
  const retention: RefusalRetention = input.transport === "mcp" ? "always" : "never";
  // The error the last attach threw. A RealmError is described by its code and the daemon-log hint; anything else is a bug in a
  // seam, not a daemon problem, so it is reported as the one catalogue-coded line with no hint.
  let lastAttachError: unknown = null;
  const failureText = (code: ErrorCode): string =>
    lastAttachError !== null && !(lastAttachError instanceof RealmError)
      ? format.diagnosticFor(lastAttachError)
      : format.attachFailure(makeRealmError(code));
  const attach = createDaemonAttach({
    socketPath: input.socketPath,
    stateDir: input.stateDir,
    connect: input.connect,
    // The host id it was given, never the unlabelled placeholder: an unlabelled session attaches as no host (CAPT-06).
    ...(input.hostId === null ? {} : { host: input.hostId }),
    spawnDaemon: input.spawnDaemon,
    diagnostics: input.diagnostics,
    upBoundMs: input.upBoundMs,
    pollMs: input.pollMs,
    refusalRetention: retention,
    onSelection: (id) => {
      sessionId = id;
    },
    onUp: (status) => {
      // The daemon's startup-reap notice goes to diagnostics once, never stdout.
      if (!noticeWritten) {
        noticeWritten = true;
        format.writeNotice(status);
      }
    },
  });
  const statusLogger = logger.child({ correlationId: bootId });
  const sink: HostStatusSink = {
    setStatus: (_key, text) => {
      statusLogger.debug("host.boot.status", { text });
    },
    notify: (message) => {
      statusLogger.debug("host.boot.status", { text: message });
    },
  };
  const deps: HostBootDeps = {
    attachDaemon: async (workspaceRoot) => {
      try {
        lastAttachError = null;
        const attached = await attach(workspaceRoot);
        attachSeen.refusal = attached.refusal;
        return attached;
      } catch (error: unknown) {
        lastAttachError = error;
        throw error;
      }
    },
    now: input.now,
    random: input.random,
    timers: input.timers,
    sink,
    observe: observer.observe,
  };
  let driver: BootDriver;
  try {
    driver = driverOf(input, deps, bootBoundsOf(input));
  } catch (error: unknown) {
    return fail(format.diagnosticFor(error));
  }

  // The call seam of both transports: the driver's outcome, unchanged, seen once by the refusal hint (D-34-05). The hint writes
  // on the first POLICY_DENIED only; a pending-boot REALM_NOT_ACTIVE refusal is another code and writes nothing.
  const hint = createRefusalHint(input.hostId, (text) => {
    input.diagnostics.write(text);
  });
  const observedCall = async (tool: unknown): Promise<ToolOutcome> => {
    const outcome = await driver.call(tool);
    hint.observe(outcome);
    return outcome;
  };

  // Signals. The first one ends the session through teardown and exits 128 + the signal number; a second exits at once.
  let signalCode: number | null = null;
  let releases: (() => void)[] = [];
  let resolveSignal: () => void = () => undefined;
  const signalled = new Promise<void>((resolve) => {
    resolveSignal = resolve;
  });
  const releaseHandlers = (): void => {
    const held = releases;
    releases = [];
    for (const release of held) {
      release();
    }
  };
  const onFirstSignal = (signal: StdioSignal): void => {
    if (signalCode !== null) {
      return;
    }
    signalCode = 128 + SIGNAL_NUMBER[signal];
    session.ending = true;
    releaseHandlers();
    for (const other of SIGNALS) {
      releases.push(
        input.signals.once(other, () => {
          input.signals.exit(128 + SIGNAL_NUMBER[other]);
        }),
      );
    }
    resolveSignal();
  };
  for (const signal of SIGNALS) {
    releases.push(
      input.signals.once(signal, () => {
        onFirstSignal(signal);
      }),
    );
  }
  const orSignal = <T>(work: Promise<T>): Promise<T | typeof SIGNALLED> =>
    Promise.race<T | typeof SIGNALLED>([work, signalled.then((): typeof SIGNALLED => SIGNALLED)]);

  let tornDown: Promise<void> | null = null;
  const teardown = (): Promise<void> => {
    tornDown ??= (async (): Promise<void> => {
      try {
        await driver.shutdown();
      } catch (error: unknown) {
        logger.error(
          "stdio.shutdown_failed",
          error instanceof RealmError ? { code: error.code } : {},
        );
      }
      await observer.flush(FLUSH_MS);
    })();
    return tornDown;
  };
  const signalExit = async (): Promise<StdioHostResult> => {
    const code = signalCode ?? 1;
    await teardown();
    releaseHandlers();
    input.signals.exit(code);
    return { exitCode: code, stdout: "", stderr: "" };
  };

  try {
    if (input.transport === "mcp") {
      // 2 to 5 run behind the server: the driver starts first (it holds the connecting state before the first line is read),
      // the server is created in the same synchronous turn, and the settle runs when the boot does (D-33-01, D-33-05).
      void driver.start(selection.workspaceRoot).then(
        () => {
          if (session.ending) {
            return;
          }
          const settled = describeSettle({
            outcome: driver.outcome(),
            refusal: attachSeen.refusal,
            reattach: input.reattach,
            attachFailure: format.attachFailure,
            failureText,
          });
          session.noClient = settled.noClient;
          if (settled.diagnostic !== null) {
            input.diagnostics.write(settled.diagnostic);
          }
        },
        (error: unknown) => {
          if (session.ending) {
            return;
          }
          session.noClient = true;
          input.diagnostics.write(format.attachFailure(error));
        },
      );
      const server = createMcpServer({ call: observedCall }, input.mcpInput, input.mcpOutput, input.diagnostics);
      try {
        if ((await orSignal(server.closed)) === SIGNALLED) {
          return await signalExit();
        }
      } catch (error: unknown) {
        session.ending = true;
        if (error instanceof RealmError) {
          return fail(format.diagnosticFor(error));
        }
        throw error;
      }
      session.ending = true;
      return { exitCode: exitCodeAfterClose(session.noClient, driver.outcome()), stdout: "", stderr: "" };
    }

    // ACP: 2 to 5 settle before the agent starts.
    try {
      if ((await orSignal(driver.start(selection.workspaceRoot))) === SIGNALLED) {
        return await signalExit();
      }
    } catch (error: unknown) {
      return fail(format.attachFailure(error));
    }
    const outcome = driver.outcome();

    if (outcome.kind !== "ready") {
      return fail(failureText(outcome.code ?? "REALM_NOT_ACTIVE"));
    }
    const snapshot = outcome.status?.snapshot;
    if (snapshot?.state !== "active") {
      const { code, reason } = format.upRefusal({ state: snapshot?.state, reason: snapshot?.reason });
      return fail(`${code}: ${reason}\n`);
    }
    try {
      const served = await orSignal(
        runAcpOverStdio({
          dispatcher: { call: observedCall },
          stdin: input.acpInput,
          stdout: input.acpOutput,
        }),
      );
      if (served === SIGNALLED) {
        return await signalExit();
      }
    } catch (error: unknown) {
      return fail(format.diagnosticFor(error));
    }
    return { exitCode: 0, stdout: "", stderr: "" };
  } finally {
    await teardown();
    releaseHandlers();
  }
}

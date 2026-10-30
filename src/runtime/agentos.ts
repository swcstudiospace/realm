// AgentOS driver port and crash-loop supervisor (RT-04, D-59, D-60). The supervisor is the only
// code that starts or stops the AgentOS process. It reaches the process through the
// AgentOsDriver port alone. No concrete driver lives in this module: the library binding is
// blocked (OQ-P3-05 in-sandbox channel, OQ-P3-06 package verification), so the composition
// takes a driver as an argument and the gap is reported, not papered over.
//
// Start policy (D-59), for the INITIAL start only:
//   - a failed start is one failure;
//   - retries wait a delay from the shared schedule (base 500 ms, cap 8000 ms, full jitter);
//   - the fifth consecutive failure holds the supervisor and throws AGENTOS_CRASH_LOOP, which
//     is retryable: an explicit start() runs the policy again from a clean count;
//   - the consecutive count resets only after 60000 ms of continuous alive, on the injected clock.
//
// Owner ruling (phase 9.6, N1; RT-04 amended 2026-10-28): once the session is active there is no automatic restart and
// no hysteresis. A runner exit, or one failed probe (alive answers false, does not answer in time or rejects, which
// covers a stale heartbeat and an OpenShell failure), holds the supervisor, and check throws a catalogue code, so the
// session moves to error with that code. Phase 17 (OBS-04) tells two causes apart: the failure path asks the driver
// whether the gateway answers (gatewayAnswers). A gateway that does not answer throws OPENSHELL_GATEWAY_LOST; one that
// answers throws AGENTOS_CRASH_LOOP. A healthy check asks nothing extra. Recovery is realm down then realm up, or the
// retry command: the next stop removes the sandbox and an explicit start() begins again. The ruling applies only after
// the initial start has finished: a check made while that start is still pending (for example realm doctor during
// realm up) answers false and changes nothing, because the runner is not ready to be probed yet.
//
// Every driver call is raced against callTimeoutMs (QUAL-01). src/core/timeout.ts is not used
// for this race because withTimeout requires a catalogue code and no catalogue code names a
// driver-call timeout. A timed-out call is a failed attempt, not a code the caller sees. The
// timed-out work is abandoned and never awaited again, so a hung driver cannot hang supervision.

import { computeBackoffDelayMs, type RandomSource } from "../core/backoff.js";
import { makeRealmError, type ErrorCode } from "../core/errors.js";
import type { SandboxCreateRequest } from "./openshell.js";

export interface AgentOsDriver {
  // Creates the session's sandbox from the request, running the create argv once within timeoutMs.
  create(request: SandboxCreateRequest, timeoutMs: number): Promise<void>;
  // The session's runner. start, alive, stop and runnerExited each act on the sandbox realm-<sessionId> of the session named.
  start(sessionId: string): Promise<void>;
  alive(sessionId: string): Promise<boolean>;
  stop(sessionId: string): Promise<void>;
  // True when the runner process started for the session's sandbox has exited and has not been stopped. A stop the realm
  // asked for is never reported here, because the driver detaches the runner before it stops it.
  runnerExited(sessionId: string): boolean;
  // True when the OpenShell gateway, and the compute driver behind it, answers a status request in time. A rejection, a
  // missed bound and a non-zero exit are all false. The session is not named: the gateway is shared by every session.
  gatewayAnswers(): Promise<boolean>;
}

export const AGENTOS_BACKOFF_BASE_MS = 500;
export const AGENTOS_BACKOFF_CAP_MS = 8000;
export const AGENTOS_MAX_CONSECUTIVE_FAILURES = 5;
export const AGENTOS_STABLE_WINDOW_MS = 60_000;

export interface AgentOsSupervisorOptions {
  readonly driver: AgentOsDriver;
  // The session this supervisor supervises. Every driver call names it, so the driver acts on this session's sandbox only.
  readonly sessionId: string;
  // Upper bound for one driver call. Must be a positive finite number.
  readonly callTimeoutMs: number;
  readonly random: RandomSource;
  readonly sleep: (ms: number) => Promise<void>;
  readonly now: () => number;
}

// idle: never started. running: under supervision. held: the initial start failed five times in a row, or check found the
// runner exited or a probe failed (its code is still being classified until heldCode is set). stopped: stop() was called,
// so the supervisor does not probe.
type Phase = "idle" | "running" | "held" | "stopped";

type Settled<T> = { readonly ok: true; readonly value: T } | { readonly ok: false };

export class AgentOsSupervisor {
  private readonly driver: AgentOsDriver;
  private readonly sessionId: string;
  private readonly callTimeoutMs: number;
  private readonly random: RandomSource;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private phase: Phase = "idle";
  // True from the beginning of start() until its startUntilUp settles, for the epoch that start began with. While it is
  // true, check() answers false without touching the driver or the supervisor.
  private starting = false;
  // Incremented by every start(). A continuation left over from an earlier start sees a different
  // epoch and returns without another driver call.
  private epoch = 0;
  private failures = 0;
  // The code every check throws while held: set by a start that gave up, or by the classification of a failed check.
  // Null while that classification is still in flight, and after start().
  private heldCode: ErrorCode | null = null;
  // The classification in flight for the current hold, or null. It settles with the code, or with null when a stop or a
  // newer start overtook it. A check made meanwhile awaits it, so every check of one hold throws the same code.
  private classifying: Promise<ErrorCode | null> | null = null;
  // Clock reading at which the current continuous alive run was first observed, or null.
  private aliveSince: number | null = null;
  // Cancels every driver call and backoff wait still in flight. stop() calls each one.
  private readonly inFlight = new Set<() => void>();

  constructor(options: AgentOsSupervisorOptions) {
    if (!(options.callTimeoutMs > 0) || !Number.isFinite(options.callTimeoutMs)) {
      throw new RangeError("AgentOS call timeout must be a positive finite number");
    }
    this.driver = options.driver;
    this.sessionId = options.sessionId;
    this.callTimeoutMs = options.callTimeoutMs;
    this.random = options.random;
    this.sleep = options.sleep;
    this.now = options.now;
  }

  // Creates the session's sandbox through the driver, once, within one call budget. A failed, rejected or missed create is
  // OPENSHELL_START_FAILED. Nothing is retried here: the caller owns the container lookup that follows the create.
  async create(request: SandboxCreateRequest, timeoutMs: number): Promise<void> {
    if (request.sessionId !== this.sessionId) {
      throw makeRealmError("SCHEMA_INVALID");
    }
    // Not registered for cancellation: a stop that overtakes a create waits for it and deletes the container it makes (B-3).
    const created = await settle(() => this.driver.create(request, timeoutMs), this.callTimeoutMs, new Set<() => void>());
    if (!created.ok) {
      throw makeRealmError("OPENSHELL_START_FAILED");
    }
  }

  // Starts the driver. A failed start is retried under the policy. Rejects with
  // AGENTOS_CRASH_LOOP when the fifth consecutive failure holds the supervisor. Calling it
  // again after a hold is the explicit retry, and it starts a fresh count.
  async start(): Promise<void> {
    this.epoch += 1;
    const epoch = this.epoch;
    this.phase = "running";
    this.starting = true;
    this.failures = 0;
    this.heldCode = null;
    this.classifying = null;
    this.aliveSince = null;
    try {
      await this.startUntilUp(epoch);
    } finally {
      // A newer start() or a stop() that moved the epoch on owns the flag now: leave it alone.
      if (this.epoch === epoch) {
        this.starting = false;
      }
    }
  }

  // One liveness check. Returns false, and does not touch the driver, when the supervisor is idle or stopped, and while the
  // initial start is still pending: the runner is not ready to be probed yet, so a check made then (realm doctor during
  // realm up) neither calls the driver, nor holds, nor counts, nor throws. Returns false when stop() or a newer start()
  // overtakes the check in flight, including while it classifies a failure. Returns true when the driver answers alive and
  // its runner has not exited. Anything else is terminal (owner ruling N1): a runner that exited, before or during the
  // probe, or a probe that answers false, fails to answer in time, or rejects (a stale heartbeat, an OpenShell failure)
  // holds the supervisor and throws. The code is OPENSHELL_GATEWAY_LOST when the gateway does not answer, and
  // AGENTOS_CRASH_LOOP when it does. There is no restart and no failure count here, and every later check throws the same
  // code until start() is called again.
  async check(): Promise<boolean> {
    if (this.phase === "idle" || this.phase === "stopped") {
      return false;
    }
    if (this.phase === "held") {
      return this.throwHeld();
    }
    if (this.starting) {
      return false;
    }
    const epoch = this.epoch;
    let healthy = false;
    if (!this.driver.runnerExited(this.sessionId)) {
      const probe = await this.race(() => this.driver.alive(this.sessionId));
      const late = this.lateOutcome(epoch);
      if (late !== null) {
        return late;
      }
      // The runner may have exited while the probe was in flight, whatever the probe answered.
      healthy = probe.ok && probe.value && !this.driver.runnerExited(this.sessionId);
    }
    if (!healthy) {
      return this.hold(epoch);
    }
    this.observeAlive();
    return true;
  }

  // Stops the driver. A failed, missed or hung driver stop rejects with AGENTOS_STOP_FAILED, so a failed delete is never
  // read as success. That rejection does not stop the caller's teardown: the session container is removed by the
  // lifecycle, which is the hard guarantee. Stop cancels every driver call and backoff wait still in flight, so none of
  // them starts the driver again afterwards. After stop the supervisor stays stopped until start() is called.
  async stop(): Promise<void> {
    this.phase = "stopped";
    this.aliveSince = null;
    for (const cancel of [...this.inFlight]) {
      cancel();
    }
    const stopped = await this.race(() => this.driver.stop(this.sessionId));
    if (!stopped.ok) {
      throw makeRealmError("AGENTOS_STOP_FAILED");
    }
  }

  // The current consecutive failure count, for diagnostics and tests.
  consecutiveFailures(): number {
    return this.failures;
  }

  private observeAlive(): void {
    const at = this.now();
    if (this.aliveSince === null) {
      this.aliveSince = at;
    }
    if (at - this.aliveSince >= AGENTOS_STABLE_WINDOW_MS) {
      this.failures = 0;
    }
  }

  // True while this start is still the running supervision: stop(), or a newer start(), ends it.
  private isCurrent(epoch: number): boolean {
    return this.phase === "running" && this.epoch === epoch;
  }

  // What a check does when another call moved the supervisor on while its probe was in flight. A stop or a newer start()
  // ends the check with false. An overlapping check (a health tick and realm doctor) may have failed first and held the
  // supervisor: this check then joins that hold, so it throws the same code and waits for the classification when it is
  // still in flight. Null means the supervisor is still running this epoch, so the check judges its own probe.
  private lateOutcome(epoch: number): Promise<boolean> | null {
    if (this.epoch !== epoch || this.phase === "stopped") {
      return Promise.resolve(false);
    }
    if (this.phase === "held") {
      return this.throwHeld();
    }
    return null;
  }

  // Attempts starts until one succeeds. Every failed attempt is one failure under the policy.
  // Returns without a further driver call as soon as the supervisor is no longer current.
  private async startUntilUp(epoch: number): Promise<void> {
    while (this.isCurrent(epoch)) {
      const attempt = await this.race(() => this.driver.start(this.sessionId));
      if (!this.isCurrent(epoch)) {
        return;
      }
      if (attempt.ok) {
        this.aliveSince = null;
        return;
      }
      await this.recordFailure(epoch);
    }
  }

  // Counts one failed start attempt. The fifth consecutive failure holds the supervisor. Otherwise the
  // driver is stopped best effort and the caller waits the backoff delay before its next start. Only startUntilUp calls
  // it: a failed probe in check is terminal and never comes here.
  // Returns without holding or waiting once the supervisor is no longer current.
  private async recordFailure(epoch: number): Promise<void> {
    this.failures += 1;
    await this.race(() => this.driver.stop(this.sessionId));
    if (!this.isCurrent(epoch)) {
      return;
    }
    if (this.failures >= AGENTOS_MAX_CONSECUTIVE_FAILURES) {
      this.phase = "held";
      this.heldCode = "AGENTOS_CRASH_LOOP";
      throw makeRealmError("AGENTOS_CRASH_LOOP");
    }
    const delay = computeBackoffDelayMs(
      this.failures - 1,
      AGENTOS_BACKOFF_BASE_MS,
      AGENTOS_BACKOFF_CAP_MS,
      this.random,
    );
    // The wait is cancelled by stop(), so teardown never sits out a backoff delay.
    await settle(() => this.sleep(delay), null, this.inFlight);
  }

  private race<T>(work: () => Promise<T>): Promise<Settled<T>> {
    return settle(work, this.callTimeoutMs, this.inFlight);
  }

  // Holds the supervisor after a failed check, classifies the loss, and throws its code. Unlike recordFailure, it does not
  // stop the driver or back off: the session moves to error, and the next stop removes the sandbox. The phase is held
  // before the first await, so a concurrent check sees the hold. Returns false when stop() or a newer start() overtook the
  // classification: that check no longer has a session to report on.
  private async hold(epoch: number): Promise<boolean> {
    this.aliveSince = null;
    this.phase = "held";
    this.heldCode = null;
    const classification = this.classify(epoch);
    this.classifying = classification;
    const code = await classification;
    if (code === null) {
      return false;
    }
    throw makeRealmError(code);
  }

  // Asks the driver whether the gateway answers. Only a hold that is still this epoch's records the code.
  private async classify(epoch: number): Promise<ErrorCode | null> {
    const gateway = await this.race(() => this.driver.gatewayAnswers());
    if (this.phase !== "held" || this.epoch !== epoch) {
      return null;
    }
    const code: ErrorCode = gateway.ok && gateway.value ? "AGENTOS_CRASH_LOOP" : "OPENSHELL_GATEWAY_LOST";
    this.heldCode = code;
    return code;
  }

  // A check made while held: throws the held code, waiting for the classification when it is still in flight.
  private async throwHeld(): Promise<boolean> {
    const code = this.heldCode ?? (await this.classifying);
    if (code === null) {
      return false;
    }
    throw makeRealmError(code);
  }
}

// Races one piece of work against an optional timer and against stop(). It settles exactly once:
// when the work settles, when the timer fires, or when stop() cancels it. A call that rejects,
// throws synchronously, times out, or is cancelled gives { ok: false }. The timer is cleared on
// every settlement path, so no timer outlives the wait. A timed-out or cancelled call is
// abandoned, and its late result is ignored.
function settle<T>(
  work: () => Promise<T>,
  timeoutMs: number | null,
  inFlight: Set<() => void>,
): Promise<Settled<T>> {
  return new Promise<Settled<T>>((resolve) => {
    const cancel = (): void => {
      finish({ ok: false });
    };
    const finish = (outcome: Settled<T>): void => {
      clearTimeout(timer);
      inFlight.delete(cancel);
      resolve(outcome);
    };
    const timer =
      timeoutMs === null ? undefined : setTimeout(() => { finish({ ok: false }); }, timeoutMs);
    inFlight.add(cancel);
    Promise.resolve()
      .then(work)
      .then(
        (value) => { finish({ ok: true, value }); },
        () => { finish({ ok: false }); },
      );
  });
}

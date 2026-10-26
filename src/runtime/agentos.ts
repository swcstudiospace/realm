// AgentOS driver port and crash-loop supervisor (RT-04, D-59, D-60). The supervisor is the only
// code that starts or stops the AgentOS process. It reaches the process through the
// AgentOsDriver port alone. No concrete driver lives in this module: the library binding is
// blocked (OQ-P3-05 in-sandbox channel, OQ-P3-06 package verification), so the composition
// takes a driver as an argument and the gap is reported, not papered over.
//
// Restart policy (D-59):
//   - a crash (alive answers false or does not answer in time) or a failed start is one failure;
//   - restarts wait a delay from the shared schedule (base 500 ms, cap 8000 ms, full jitter);
//   - the fifth consecutive failure holds the supervisor and throws AGENTOS_CRASH_LOOP, which
//     is retryable: an explicit start() runs the policy again from a clean count;
//   - the consecutive count resets only after 60000 ms of continuous alive, on the injected clock.
//
// A runner that exits while the session is active is not restarted here. check reports it at once as
// AGENTOS_CRASH_LOOP, so the session moves to error. The next stop removes the sandbox.
//
// Every driver call is raced against callTimeoutMs (QUAL-01). src/core/timeout.ts is not used
// for this race because withTimeout requires a catalogue code and no catalogue code names a
// driver-call timeout. A timed-out call is a failed attempt, not a code the caller sees. The
// timed-out work is abandoned and never awaited again, so a hung driver cannot hang supervision.

import { computeBackoffDelayMs, type RandomSource } from "../core/backoff.js";
import { makeRealmError } from "../core/errors.js";

export interface AgentOsDriver {
  start(): Promise<void>;
  alive(): Promise<boolean>;
  stop(): Promise<void>;
  // True when the runner process started for the sandbox has exited and has not been stopped. A stop the realm
  // asked for is never reported here, because the driver detaches the runner before it stops it.
  runnerExited(): boolean;
}

export const AGENTOS_BACKOFF_BASE_MS = 500;
export const AGENTOS_BACKOFF_CAP_MS = 8000;
export const AGENTOS_MAX_CONSECUTIVE_FAILURES = 5;
export const AGENTOS_STABLE_WINDOW_MS = 60_000;

export interface AgentOsSupervisorOptions {
  readonly driver: AgentOsDriver;
  // Upper bound for one driver call. Must be a positive finite number.
  readonly callTimeoutMs: number;
  readonly random: RandomSource;
  readonly sleep: (ms: number) => Promise<void>;
  readonly now: () => number;
}

// idle: never started. running: under supervision. held: five consecutive failures.
// stopped: stop() was called, so the supervisor neither probes nor restarts.
type Phase = "idle" | "running" | "held" | "stopped";

type Settled<T> = { readonly ok: true; readonly value: T } | { readonly ok: false };

export class AgentOsSupervisor {
  private readonly driver: AgentOsDriver;
  private readonly callTimeoutMs: number;
  private readonly random: RandomSource;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private phase: Phase = "idle";
  // Incremented by every start(). A continuation left over from an earlier start sees a different
  // epoch and returns without another driver call.
  private epoch = 0;
  private failures = 0;
  // Clock reading at which the current continuous alive run was first observed, or null.
  private aliveSince: number | null = null;
  // Cancels every driver call and backoff wait still in flight. stop() calls each one.
  private readonly inFlight = new Set<() => void>();

  constructor(options: AgentOsSupervisorOptions) {
    if (!(options.callTimeoutMs > 0) || !Number.isFinite(options.callTimeoutMs)) {
      throw new RangeError("AgentOS call timeout must be a positive finite number");
    }
    this.driver = options.driver;
    this.callTimeoutMs = options.callTimeoutMs;
    this.random = options.random;
    this.sleep = options.sleep;
    this.now = options.now;
  }

  // Starts the driver. A failed start is retried under the policy. Rejects with
  // AGENTOS_CRASH_LOOP when the fifth consecutive failure holds the supervisor. Calling it
  // again after a hold is the explicit retry, and it starts a fresh count.
  async start(): Promise<void> {
    this.epoch += 1;
    this.phase = "running";
    this.failures = 0;
    this.aliveSince = null;
    await this.startUntilUp(this.epoch);
  }

  // One liveness check. Returns false when the supervisor is idle or stopped, and does not
  // touch the driver. Returns true when the driver is alive, or when a detected crash was
  // recovered by restart. Returns false when stop() runs while the check is in flight. Throws
  // AGENTOS_CRASH_LOOP while the supervisor is held.
  async check(): Promise<boolean> {
    if (this.phase === "idle" || this.phase === "stopped") {
      return false;
    }
    if (this.phase === "held") {
      throw makeRealmError("AGENTOS_CRASH_LOOP");
    }
    // A runner that exited while the session was active is reported at once, and supervision does not restart it.
    if (this.driver.runnerExited()) {
      throw makeRealmError("AGENTOS_CRASH_LOOP");
    }
    const epoch = this.epoch;
    const probe = await this.race(() => this.driver.alive());
    if (!this.isCurrent(epoch)) {
      return false;
    }
    if (probe.ok && probe.value) {
      this.observeAlive();
      return true;
    }
    this.aliveSince = null;
    await this.recordFailure(epoch);
    if (!this.isCurrent(epoch)) {
      return false;
    }
    await this.startUntilUp(epoch);
    return this.isCurrent(epoch);
  }

  // Stops the driver, best effort. A failed or hung stop does not block teardown: the session
  // container is removed by the lifecycle, which is the hard guarantee. Stop cancels every driver
  // call and backoff wait still in flight, so none of them starts the driver again afterwards.
  // After stop the supervisor stays stopped until start() is called.
  async stop(): Promise<void> {
    this.phase = "stopped";
    this.aliveSince = null;
    for (const cancel of [...this.inFlight]) {
      cancel();
    }
    await this.race(() => this.driver.stop());
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

  // Attempts starts until one succeeds. Every failed attempt is one failure under the policy.
  // Returns without a further driver call as soon as the supervisor is no longer current.
  private async startUntilUp(epoch: number): Promise<void> {
    while (this.isCurrent(epoch)) {
      const attempt = await this.race(() => this.driver.start());
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

  // Counts one failure. The fifth consecutive failure holds the supervisor. Otherwise the
  // driver is stopped best effort and the caller waits the backoff delay before its next start.
  // Returns without holding or waiting once the supervisor is no longer current.
  private async recordFailure(epoch: number): Promise<void> {
    this.failures += 1;
    await this.race(() => this.driver.stop());
    if (!this.isCurrent(epoch)) {
      return;
    }
    if (this.failures >= AGENTOS_MAX_CONSECUTIVE_FAILURES) {
      this.phase = "held";
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

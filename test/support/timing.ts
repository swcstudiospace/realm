// Shared timing helpers for tests (QR-05, D-1305). A test that waits on a real timer must not depend on the host being quiet:
// every fixed bound goes through scaledMs, so a loaded CI runner can stretch all of them at once with
// REALM_TEST_TIMEOUT_SCALE (a number from 1 to 10). Where a seam exists, prefer a gate, a ManualClock or an event over a wait.
//
// The scale is read once, when this module loads. Test support is the one place besides the entry edges that reads the
// environment; production modules never import this file.

export const TIMEOUT_SCALE_VARIABLE = "REALM_TEST_TIMEOUT_SCALE";

const MIN_SCALE = 1;
const MAX_SCALE = 10;
const DEFAULT_WAIT_MS = 5000;
const DEFAULT_POLL_INTERVAL_MS = 5;

// The scale a raw variable value means: a finite number clamped to [1, 10]. A missing, blank or non-numeric value is 1.
export function parseTimeoutScale(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") {
    return MIN_SCALE;
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    return MIN_SCALE;
  }
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));
}

export const TIMEOUT_SCALE: number = parseTimeoutScale(process.env[TIMEOUT_SCALE_VARIABLE]);

// A fixed bound, stretched by the scale and rounded up to whole milliseconds.
export function scaledMs(ms: number): number {
  return Math.ceil(ms * TIMEOUT_SCALE);
}

// The node:test option object that bounds one test: test(name, testTimeout(30_000), body).
export function testTimeout(ms: number): { readonly timeout: number } {
  return { timeout: scaledMs(ms) };
}

// Races work against an ALREADY-scaled bound. The timer is deliberately NOT unref'd: when work never settles it is the only
// thing that can end the race, and an unref'd timer would let the event loop empty with the awaiting test still pending. It is
// always cleared, so nothing is left running after the race settles.
async function raceWithin<T>(work: Promise<T>, boundMs: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const expired = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(message));
    }, boundMs);
  });
  try {
    return await Promise.race([work, expired]);
  } finally {
    clearTimeout(timer);
  }
}

// Waits for work, or rejects once the scaled bound passes. The timer keeps the process alive until the bound passes or work
// settles, and it is always cleared, so nothing is left running after work settles.
export function boundedWait<T>(work: Promise<T>, what: string, ms: number = DEFAULT_WAIT_MS): Promise<T> {
  const bound = scaledMs(ms);
  return raceWithin(work, bound, `${what} did not settle within ${String(bound)} ms`);
}

// Checks the predicate every intervalMs until it is true. Rejects once the scaled deadline passes. An async check is bounded by
// the time that remains, so one that never settles, or settles true too late, rejects at the deadline instead of hanging. A
// synchronous check arms no timer, and no timer is left running after this settles.
export async function pollUntil(
  predicate: () => boolean | Promise<boolean>,
  what: string,
  options: { readonly timeoutMs?: number; readonly intervalMs?: number } = {},
): Promise<void> {
  const bound = scaledMs(options.timeoutMs ?? DEFAULT_WAIT_MS);
  const interval = options.intervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const message = `${what} did not hold within ${String(bound)} ms`;
  const deadline = Date.now() + bound;
  let checked = false;
  for (;;) {
    const remaining = deadline - Date.now();
    if (checked && remaining <= 0) {
      throw new Error(message);
    }
    checked = true;
    const result = predicate();
    const held = typeof result === "boolean" ? result : await raceWithin(result, Math.max(remaining, 1), message);
    if (held) {
      return;
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, interval);
    });
  }
}

// Waits until the predicate holds by yielding to the event loop on setImmediate, which node's mocked setTimeout does not
// touch, so it also works while a test has mocked timers on (pollUntil sleeps on setTimeout and would hang there). The
// deadline reads the real clock (Date.now, which a test that mocks setTimeout alone leaves alone), is scaled, and makes a
// condition that never comes fail the test instead of spinning. Do not use it where Date is mocked.
export async function yieldUntil(predicate: () => boolean, what: string, timeoutMs: number = DEFAULT_WAIT_MS): Promise<void> {
  const bound = scaledMs(timeoutMs);
  const deadline = Date.now() + bound;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error(`${what} did not hold within ${String(bound)} ms`);
    }
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
  }
}

// A clock a test advances by hand. `now` is an arrow property, so it can be passed as an option (LibpodClientOptions.now).
export class ManualClock {
  private current: number;

  constructor(start = 0) {
    this.current = start;
  }

  readonly now = (): number => this.current;

  advance(ms: number): void {
    this.current += ms;
  }
}

// What trackMockedTimers reports.
export interface MockedTimerTracker {
  // The number of timers created since tracking began that have neither fired nor been cleared.
  pending(): number;
}

// Counts the timers a test leaves pending while node's mocked setTimeout is on. A mocked timer is not a native resource, so
// process.getActiveResourcesInfo() cannot see it, and a code path that forgets clearTimeout would go unnoticed. Call this right
// after t.mock.timers.enable: it wraps the CURRENT globalThis.setTimeout and globalThis.clearTimeout (the mock's), records every
// handle the wrapped setTimeout returns, drops a handle when its callback runs or when it is cleared, and puts the wrapped
// functions back when the test ends. If the mock was reset first, the global already holds the real functions and is left alone.
export function trackMockedTimers(t: { after(hook: () => void): void }): MockedTimerTracker {
  const originalSet = globalThis.setTimeout;
  const originalClear = globalThis.clearTimeout;
  const live = new Set<unknown>();
  const trackedSet = (callback: (...args: unknown[]) => void, ms?: number, ...args: unknown[]): NodeJS.Timeout => {
    const handle: NodeJS.Timeout = originalSet(
      (...fired: unknown[]) => {
        live.delete(handle);
        callback(...fired);
      },
      ms,
      ...args,
    );
    live.add(handle);
    return handle;
  };
  const trackedClear = (handle: NodeJS.Timeout | string | number | undefined): void => {
    live.delete(handle);
    originalClear(handle);
  };
  const installedSet = trackedSet as unknown as typeof setTimeout;
  const installedClear = trackedClear;
  globalThis.setTimeout = installedSet;
  globalThis.clearTimeout = installedClear;
  t.after(() => {
    if (globalThis.setTimeout === installedSet) {
      globalThis.setTimeout = originalSet;
    }
    if (globalThis.clearTimeout === installedClear) {
      globalThis.clearTimeout = originalClear;
    }
  });
  return { pending: () => live.size };
}

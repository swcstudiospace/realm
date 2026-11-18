// The bound on capability audit lines (CAPT-07, D-32-10): a bucket of 60 with a refill of one per second, over an injected
// millisecond clock. No timers. The count is kept in thousandths of a line, so the refill is exact integer arithmetic and a
// clock that stands still or moves back never adds credit.

const CAPACITY_LINES = 60;
const MILLI = 1000;
const CAPACITY = CAPACITY_LINES * MILLI;

export interface Limiter {
  // Takes one line from the bucket. False when the bucket holds less than one.
  take(): boolean;
}

export function createLimiter(nowMs: () => number): Limiter {
  const state = { credit: CAPACITY, last: nowMs() };
  return {
    take: () => {
      const now = nowMs();
      // One thousandth of a line per elapsed millisecond. A clock that moves back adds nothing and does not move `last`
      // back, so the same interval is never credited twice.
      if (now > state.last) {
        state.credit = Math.min(CAPACITY, state.credit + (now - state.last));
        state.last = now;
      }
      if (state.credit < MILLI) {
        return false;
      }
      state.credit -= MILLI;
      return true;
    },
  };
}

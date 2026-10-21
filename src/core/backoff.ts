// Bounded exponential backoff with full jitter (ANDA-03, RT-04, D-49). Pure: the random
// source is injected and sleeping stays with the caller. Callers pass their own base and
// cap (Anda 500/30000 per D-62, AgentOS 500/8000 per D-59); this module holds no defaults.
//
// Contract: random() returns a number in [0, 1]. The delay is random() times
// min(cap, base * 2^attempt), so it lies in [0, min(cap, base * 2^attempt)] and never
// exceeds cap. When 2^attempt overflows to Infinity, min() clamps to cap. A zero base gives
// zero, never NaN. Invalid inputs throw RangeError instead of producing a delay.

export type RandomSource = () => number;

export function computeBackoffDelayMs(
  attempt: number,
  baseMs: number,
  capMs: number,
  random: RandomSource,
): number {
  if (!Number.isSafeInteger(attempt) || attempt < 0) {
    throw new RangeError("backoff attempt must be a non-negative safe integer");
  }
  if (!Number.isFinite(baseMs) || baseMs < 0) {
    throw new RangeError("backoff base must be a finite non-negative number");
  }
  if (!Number.isFinite(capMs) || capMs < 0) {
    throw new RangeError("backoff cap must be a finite non-negative number");
  }
  const draw = random();
  if (!(draw >= 0 && draw <= 1)) {
    throw new RangeError("backoff random source must return a number in [0, 1]");
  }
  const ceiling = baseMs === 0 ? 0 : Math.min(capMs, baseMs * 2 ** attempt);
  return draw * ceiling;
}

// Time-bounded promise helper (D-28, QUAL-01). Races the work against a timer and
// clears the timer as soon as either side settles, so no timer outlives the call.

import { makeRealmError, type ErrorCode } from "./errors.js";

export function withTimeout<T>(work: Promise<T>, ms: number, code: ErrorCode): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const expiry = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(makeRealmError(code));
    }, ms);
  });
  return Promise.race([work, expiry]).finally(() => {
    clearTimeout(timer);
  });
}

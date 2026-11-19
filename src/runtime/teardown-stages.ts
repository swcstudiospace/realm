// The stage bounds of one session end, and their worst-case sum. SessionExecution.stop and destroy run these stages in turn, each
// under its own bound, so the single teardown bound (TEARDOWN_TIMEOUT_MS in lifecycle/bounds.ts) is derived from them here and
// is never written as a literal. This module imports only constants and nothing that reaches node:child_process.

import { DEFAULT_REQUEST_TIMEOUT_MS, FORCE_REMOVE_STOP_GRACE_SECONDS } from "./libpod-client.js";

// Backstop bound on the AgentOS stop in stop() and destroy(). The supervisor's own per-call timeout normally
// settles the stop first; this timer only guarantees the container step is reached. It also bounds the wait for a create of the
// sandbox that is still in flight when the session ends.
export const AGENTOS_STOP_DEADLINE_MS = 15_000;

// Grace period a container gets to stop before it is killed (libpod stop timeout). The sandbox runtime ignores SIGTERM (see the
// comment on ADOPTION_RESTART_GRACE_MS in src/runtime/driver/lifecycle.ts), so a longer grace is dead time before the kill. The
// AgentOS runner has been stopped first, and the force removal of down already uses the same 2 s (FORCE_REMOVE_STOP_GRACE_SECONDS).
// The container is removed by the sandbox delete that follows.
export const CONTAINER_STOP_GRACE_MS = 2_000;

// Bound on the delete of one session's realm sandbox in stop() and destroy(). A delete that misses it is a failed stop.
export const SANDBOX_DELETE_DEADLINE_MS = 15_000;

// Bound on the confirmation wait after a libpod stop or force removal request that missed its request bound (5 s plus its 2 s
// grace, 7 s). The live window of 2026-11-19 saw the container stop take 7 to about 12 s in 9 of 52 stops (typically about 3 s),
// the longest read 11.9 s after the stop began, so the request bound (7 s) was missed by up to about 5 s. The confirmation wait
// is twice that, 10 s. A container still live at this bound keeps the failed step, so the wait fails closed.
export const CONTAINER_END_CONFIRM_MS = 10_000;

// The pause between two reads of the container state during the confirmation wait.
export const CONTAINER_CONFIRM_POLL_MS = 500;

// The bound of each stage that runs in turn inside one session end.
const SESSION_END_STAGE_BOUNDS_MS = Object.freeze({
  // Spent only while a create of the sandbox is in flight (settleCreatesFor): the end waits for it under the AgentOS bound.
  createWait: AGENTOS_STOP_DEADLINE_MS,
  // The AgentOS runner stop.
  agentosStop: AGENTOS_STOP_DEADLINE_MS,
  // The inspect has one request bound, and the stop or the force removal has one request bound extended by its grace
  // (libpod-client.ts exchange).
  containerStep:
    2 * DEFAULT_REQUEST_TIMEOUT_MS + Math.max(CONTAINER_STOP_GRACE_MS, FORCE_REMOVE_STOP_GRACE_SECONDS * 1000),
  // The wait that follows a stop or a force removal whose request missed its bound while Podman was still working on it: the
  // state of the container is read until it has ended, inside this bound (CONTAINER_END_CONFIRM_MS). Spent only after such a miss.
  containerConfirm: CONTAINER_END_CONFIRM_MS,
  // The delete of the realm sandbox at the gateway.
  sandboxDelete: SANDBOX_DELETE_DEADLINE_MS,
});

// The sum of the stage bounds: the longest one session end can take with every stage inside its own bound.
export const SESSION_END_WORST_CASE_MS =
  SESSION_END_STAGE_BOUNDS_MS.createWait +
  SESSION_END_STAGE_BOUNDS_MS.agentosStop +
  SESSION_END_STAGE_BOUNDS_MS.containerStep +
  SESSION_END_STAGE_BOUNDS_MS.containerConfirm +
  SESSION_END_STAGE_BOUNDS_MS.sandboxDelete;

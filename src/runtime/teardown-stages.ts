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
  // The delete of the realm sandbox at the gateway.
  sandboxDelete: SANDBOX_DELETE_DEADLINE_MS,
});

// The sum of the stage bounds: the longest one session end can take with every stage inside its own bound.
export const SESSION_END_WORST_CASE_MS =
  SESSION_END_STAGE_BOUNDS_MS.createWait +
  SESSION_END_STAGE_BOUNDS_MS.agentosStop +
  SESSION_END_STAGE_BOUNDS_MS.containerStep +
  SESSION_END_STAGE_BOUNDS_MS.sandboxDelete;

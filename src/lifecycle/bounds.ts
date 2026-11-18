// Time and concurrency bounds of the lifecycle controller and of the daemon's adoption pass.

import { SESSION_END_WORST_CASE_MS } from "../runtime/teardown-stages.js";

// Margin over the stage bounds for the controller's synchronous record writes between stages.
const TEARDOWN_MARGIN_MS = 3_000;

// The single teardown bound (D-28, Q-1). It is the worst case of the stages that run in turn inside one session end (the
// pending-create wait, the AgentOS stop, the container step and the sandbox delete, each under its own bound, defined in
// src/runtime/teardown-stages.ts) plus a margin for the controller's synchronous record writes. Teardown therefore gives up
// only after every stage has had its own bound, and a stage that runs out of its own bound reports its own code first. Expiry
// returns REALM_STOPPING and leaves the session in stopping, so a repeated destroy resumes teardown. The catalogue has no
// teardown-timeout code, and none is added.
export const TEARDOWN_TIMEOUT_MS = SESSION_END_WORST_CASE_MS + TEARDOWN_MARGIN_MS;

// How many adopted sessions hydrate at once. It bounds the libpod requests and the open descriptors hydration holds.
export const HYDRATE_CONCURRENCY = 4;

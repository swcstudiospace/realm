// Time and concurrency bounds of the lifecycle controller and of the daemon's adoption pass.

// The single teardown bound (D-28, Q-1). It is the sum of three bounds that teardown stages
// honour in turn: the AgentOS stop backstop (15 s), the container stop grace (10 s), and one
// libpod request bound (5 s). Teardown gives up only after an inner stage has had its own
// bound, so it does not expire while that stage is still within it. Expiry returns
// REALM_STOPPING and leaves the session in stopping, so a repeated destroy resumes teardown.
// The catalogue has no teardown-timeout code, and none is added.
export const TEARDOWN_TIMEOUT_MS = 30_000;

// How many adopted sessions hydrate at once. It bounds the libpod requests and the open descriptors hydration holds.
export const HYDRATE_CONCURRENCY = 4;

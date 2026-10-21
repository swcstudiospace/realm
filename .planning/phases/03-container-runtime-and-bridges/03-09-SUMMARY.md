# Plan 03-09 Summary: Mutation gate and controller bridge wiring

## Status

Done, with three documented deviations (see below) and two open issues in sibling-owned code (see Open issues).

## Files changed

- `src/lifecycle/mutation-gate.ts` (new): `gateMutation`, `runGatedMutation`, and the `GateOutcome` and `GatedResult` types. A synchronous wrapper over `decideMutation`. No timer, no wait, no audit write.
- `src/lifecycle/controller.ts`: required `bridge: BridgePort` dependency; `mutationGate()`; bridge listener subscribed in `create` before the first handshake and released in `destroy`; startup handshake inside the startup budget; bridge state rules; mismatch refusal on retry; bridge teardown in `stop` and `destroy`. Operation names unchanged.
- `test/lifecycle/mutation-gate.test.ts` (new, 8 tests).
- `test/lifecycle/bridge-states.test.ts` (new, 12 tests).
- `test/lifecycle/controller.test.ts`, `idempotent.test.ts`, `no-host-env.test.ts`, `startup-budget.test.ts`: fixtures and constructors migrated to `FakeBridge` (zero latency, healthy). No Phase 2 assertion changed.

## Tests

- Verify command `npx tsc -p tsconfig.json && node --test` over the six lifecycle files: exit 0, 67 pass, 0 fail, 0 skipped.
- Sibling compile errors still present in files this plan does not own: `test/integration/podman-gate.test.ts`, `test/quality/suite-taxonomy.test.ts` (known, plan 03-10), and `test/runtime/session-execution.test.ts` (sibling in progress). They do not affect the lifecycle files.
- `npx eslint` on all owned `.ts` files: no issues.

## Requirement evidence

- CORE-05: `mutation-gate.test.ts` covers every state in both modes, with named warnings and exact deny codes, synchronous results, no `setTimeout` call, and no refusal reaching the mutation. A controller test shows `mutationGate()` follows the live state (refused when unbound; refused when degraded after a bridge down event).
- ANDA-03: `bridge-states.test.ts` covers active to degraded on down and back on up; mismatch to error from active and degraded; startup exhaustion to error with `ANDA_UNREACHABLE`, keeping the recorded container; startup mismatch to error with retry refused; other error states retryable; events discarded in error, connecting, stopping, and unbound without a throw or transition; probe exec-only; bridge closed on stop and destroy; bridge close beyond the teardown bound gives `REALM_STOPPING` and a repeat destroy resumes.

## Deviations

1. **Bridge close is started first but not awaited before `exec.stop`.** The plan says stop closes the bridge before `exec.stop`. The frozen Phase 2 idempotency assertion (`stop of a stopping session is a no-op while the first stop completes`) requires `exec.stop` to be invoked synchronously within the first `stop()` call. Awaiting the close first would break that assertion, and Phase 2 assertions must stay unchanged (D-72). So `teardownBridgeAndContainer` invokes `bridge.close()` first, then `exec.stop` in the same tick, and awaits both under the teardown bound. `AndaBridge.close()` aborts its stopper synchronously, so the probe loop stops before the container stop begins.
2. **Listener in `connecting` is discarded, not transitioned.** The create flow owns the startup outcome through the `connect()` promise. A listener transition in `connecting` would race that outcome and double-transition (for example, `error` to `error`). D-64 allows the event to be accepted for this path, but the state change belongs to create.
3. **Mismatch is not retryable by throwing.** `create` (and therefore `start`) from `error` with reason `ANDA_VERSION_MISMATCH` throws `ANDA_VERSION_MISMATCH` and leaves the state unchanged. `stop` or `destroy` still works from that state.

## Open issues (not fixed here: outside the owned files)

- **`AndaBridge.connect` is single-use** (`src/anda/client.ts`: "may be called once per bridge"). The controller's retry from `error` calls `connect` again on the same bridge. With the real bridge, that call throws a plain `Error`, which maps to `OPENSHELL_START_FAILED`. The same applies to create after stop, because stop closes the bridge. The fake bridge permits repeat calls, so the unit tests do not catch this. It needs either a re-connectable bridge (plan 03-06 owner) or a fresh bridge per startup attempt supplied by the daemon (Phase 6). Not resolved in this plan.
- **Listener store-write failures** propagate into the bridge publisher, because the listener has no catch by design (the state guard is an explicit check). A failing record write during a background event would surface as a rejection of the bridge's monitor loop. No caller can observe it today.

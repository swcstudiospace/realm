# Plan 02-05 Summary: Lifecycle completion, budgets, lock release, no-host-env proof, doctor core

**Status:** implemented; gates not run in this lane (the orchestrator runs `tsc`, lint, and `node --test` after the wave). Requirements claimed: CORE-06, RT-07, AUD-02, and the D-44 doctor core.

## Files

Created or changed (repo-relative):

- `src/lifecycle/controller.ts`: rewritten in full, with the create path behavior preserved. Adds `start`, `probe`, `stop`, and `destroy`; wraps every `ExecutionService` call in `withTimeout`; adds an optional `locks` dependency (default: an owned `LockTable`).
- `src/doctor/checks.ts` (new): `runChecks` with three registered checks (`policy-file`, `state-dir`, `session-store`), result shape `{ id, status, detail, fix }`.
- `test/lifecycle/idempotent.test.ts` (new): repeat and idempotency cases, probe, stop and destroy no-op cases, budget mapping for probe, lock release on destroy.
- `test/lifecycle/no-host-env.test.ts` (new): sentinel environment absence and runtime key-set checks.
- `test/lifecycle/controller.test.ts` (appended only): two budget cases (startup overrun, teardown overrun with resume).
- `test/doctor/checks.test.ts` (new): pass, warn, and fail outcomes with fixes for each check; registration boundary.
- `.planning/phases/02-policy-state-and-filesystem-lockdown/02-05-SUMMARY.md` (this file).

Not changed: `test/support/fake-execution.ts` (its existing `setDelay`, `failNext`, `beforeCall`, `setHealth`, `calls`, `callCount`, and `resources` already cover every scripted case in this plan). No frozen file (`src/core/states.ts`, `src/core/errors.ts`, `src/contract/*`, `src/core/policy.schema.json`) was edited. No dependency was added. No `.planning/` file other than this summary was touched.

## Must-haves and the tests that evidence them

- **Repeating any operation returns the same snapshot with no duplicate fake resources.** `repeating each of the seven operations returns the same snapshot with no duplicate fake resources (CORE-06)`; `a create that times out reattaches to one container on retry, with no duplicate resource (CORE-06, RT-07)`; `repeating create on an active session returns the same snapshot with no second create (CORE-06)` (controller.test.ts, existing).
- **Startup overrun gives STARTUP_BUDGET_EXCEEDED with state error.** `create with a scripted fake delay beyond startupBudgetMs gives STARTUP_BUDGET_EXCEEDED and state error (CORE-06, D-28)`; `a probe that overruns the startup budget gives STARTUP_BUDGET_EXCEEDED and state error (D-28)`.
- **Teardown overrun returns REALM_STOPPING, the session stays in stopping, and a repeated destroy resumes.** `destroy with a scripted stop delay beyond the teardown bound returns REALM_STOPPING, keeps the session stopping, and a repeated destroy resumes teardown (D-28, Q-1)`; `stop of a stopping session is a no-op while the first stop completes (CORE-06, D-38)`.
- **Every ExecutionService call is wrapped.** create and start share one startup deadline; probe uses `startupBudgetMs`; stop and destroy use the single `TEARDOWN_TIMEOUT_MS = 5000` constant. Evidence: the four budget tests above.
- **Destroy releases the session locks and removes the record last.** `destroy releases the session's advisory locks, leaves other owners' locks, and deletes the record (CORE-06, FS-04, D-33)`.
- **Sentinel environment value never reaches the fake, the record, or an audit line.** `a sentinel host environment value never reaches the fake, the session record, or any audit line (AUD-02, D-43)`; `the port request and the fake carry no environment field, by runtime key-set check (AUD-02, F-7)`.
- **Doctor reports pass, warn, fail with fixes, and never reports on uninspectable components.** The `policy-file`, `state-dir`, and `session-store` tests in `test/doctor/checks.test.ts` (listed in the next section); `only the three Phase 2 checks are registered, and none reports on a component Phase 2 cannot inspect (D-44)`.

## Test inventory

`test/lifecycle/idempotent.test.ts`: all seven operations repeated; a timed-out create reattaches; start from error and start in active; probe healthy, probe unhealthy, probe outside active or degraded, probe budget overrun; stop of unbound, stop of stopping, stop from error; destroy of an absent session; destroy releases locks and deletes the record.

`test/lifecycle/no-host-env.test.ts`: the sentinel test (fake calls, fake resources, two record file reads, six audit lines); the key-set test (every recorded create request has exactly `idempotencyKey` and `workspaceRoot`; no fake instance field name matches `/env/i`).

`test/lifecycle/controller.test.ts` (appended): the two budget cases.

`test/doctor/checks.test.ts`: `policy-file` absent (warn), no path configured (warn), valid (pass), unknown key (fail, names the key, never the value), relative root (fail, names the index), not JSON (fail, no content echoed), policy inside its own root (fail, move fix); `state-dir` missing (warn), mode 0700 (pass), mode 0755 (fail, chmod fix), file at the path (fail); `session-store` writable with no probe file written (pass), unwritable (fail, ownership fix), absent with writable ancestor (warn), absent with no writable ancestor (fail); registration boundary.

## Deviations and interpretations (each with the default applied)

1. **`start` is a public operation.** The plan's must-haves list seven operations, so `start()` is public. Semantics: connecting returns the snapshot (the in-flight create owns the start); active and degraded are no-ops; error runs `create` against the recorded workspace, which moves through connecting and reuses the stored container; unbound throws `REALM_UNBOUND`; stopping throws `REALM_STOPPING`.
2. **One startup deadline.** D-28 says "for the whole startup", so create and start in one `create` call share `startupBudgetMs` through a single deadline. Each call gets the remaining budget, never a negative one.
3. **Probe expiry maps to `STARTUP_BUDGET_EXCEEDED`.** The plan wraps probe with `startupBudgetMs` and gives the same mapping. Probe expiry in active or degraded therefore moves the session to error with that reason.
4. **Teardown overrun throws `REALM_STOPPING`.** The plan says "returns `REALM_STOPPING`". It is thrown, as the existing create-from-stopping refusal already is, so the code is asserted with `assertRejectsWith`. Startup failures remain snapshot results with the code as reason, as in the existing create path.
5. **Destroy order.** Destroy stops (when not unbound), then destroys the container, then releases the session's locks, then moves stopping to unbound, then deletes the record. A teardown timeout on the destroy call leaves the session in stopping, so a repeated destroy resumes. Stop is `stop container → unbound`, and it keeps the record with its container id so a later create or destroy can reuse it.
6. **Lock table injection.** `LifecycleDeps` gains an optional `locks: LockTable`. Without it the controller owns a table. The lock owner is the session id. The daemon will pass its shared table in Phase 6.
7. **Probe from degraded.** An unhealthy result from degraded also moves to error (`degraded → error` is an allowed frozen edge). The plan's text names only active; the reason is the same, `probe failed`.
8. **Unbound reason.** After stop or destroy the reason is `INITIAL_REASON` (`no workspace`), the same reason the display mapping shows for unbound.
9. **`policy-file` POLICY_DENIED is one fail.** The loader raises the same code for an unreadable file, a policy inside its own root, and a root that does not resolve, and it does not say which. The doctor reports one fail whose fix covers all three ("make it readable, move it outside every workspace root, make every root an existing directory"). The inside-root case is still a fail with a move fix (D-44).
10. **`state-dir` non-directory is a fail.** The plan lists missing, wrong mode, and session-store checks only. A file at the state directory path is reported as a fail with a move-aside fix, so that path does not produce an undefined result. Unlisted, but required for the check to return a status.
11. **Writability is an injectable probe.** `runChecks` takes an optional `canWrite`. The default is `access(W_OK)`, which writes no file (D-44). As root, `access(W_OK)` succeeds whatever the mode, so the unwritable outcome cannot be produced by mode in tests run as root. Tests inject the probe for that outcome. The default is exercised by the pass, absent-with-writable-ancestor, and no-probe-file tests.
12. **Audit lines in the sentinel test.** The controller does not emit audit lines, and the plan does not ask it to. The sentinel test writes one lifecycle audit line per operation through `appendAudit`, then checks the file for the sentinel. The check exercises the real append path and redaction; the lines are written by the test, not by the controller.
13. **Real-time waits.** Three tests use real timers on purpose: the two budget tests (the fake's scripted delays and `withTimeout` are real timers, and the teardown bound is the 5000 ms constant), and the timed-out-create test (a 350 ms wait so the abandoned create finishes before the assertion). A deterministic fake clock would also have to drive the controller's own timer, so none is used. The teardown test takes about 5 s. The executor form of `new Promise` is used because `tsconfig` targets ES2023 and its lib lacks `Promise.withResolvers`, the same reason `withTimeout` uses it.
14. **No change to the fake.** `test/support/fake-execution.ts` already has every setter the plan asks for.

## Residual risks and open questions

- **Operations are not serialized.** A `destroy` called while a `create` is in flight is not coordinated. The state machine rejects the invalid transition, so the in-flight operation fails rather than corrupting state. A queue is not in this plan. Default applied: none; recorded here for Phase 3 or the daemon.
- **Abandoned timed-out create.** A create that outlives its budget can leave a container that nothing reattaches to if no retry follows. The idempotency key makes a retry reattach (tested), and reaping is Phase 4 (RT-08). Default applied: rely on the key and the retry.
- **Q-1 (teardown bound).** The single 5000 ms constant is used with `REALM_STOPPING`, with no new catalogue code. Phase 3 decides whether a dedicated code is needed.
- **Q-2 (rename window) and Q-3 (orphaned temp files).** Unchanged from 02-03 and 02-01.
- **Q-4 (MCP and ACP contract tests).** Not part of this plan; they are deferred to Phase 5.
- **Not verified in this lane.** Per the shared rules, I did not run `tsc`, lint, or `node --test`. Items the orchestrator should watch on the compiler pass: `let health: ProbeResult` definite assignment across the `try`/`catch` in `probe`; the `{ ...record, state }` spread in `writeState` against `SessionRecord`'s `containerId?` under `exactOptionalPropertyTypes`; the zero-argument `canWrite: () => false` arrow in the doctor tests; and the `Object.keys(exec)` runtime check in `no-host-env.test.ts`.

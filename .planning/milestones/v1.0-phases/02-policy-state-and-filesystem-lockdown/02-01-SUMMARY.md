# Plan 02-01 Summary: Tracer slice (state machine, events, port, pinned root, canonicalizer, atomic replace, session store, lifecycle create)

**Status:** implemented; gates not run in this lane (orchestrator runs them after the wave). Requirements claimed: CORE-01, CORE-04, FS-01, FS-05, RT-07. CORE-06 is partly covered here (create retry, idempotent create, attach and detach); the full seven-operation set lands in plan 02-05.

## Files

Created or changed (repo-relative):

- `src/core/state-machine.ts`: `RealmStateMachine` and `StateSnapshot`. Wraps the frozen `checkTransition`; commits, then publishes.
- `src/core/events.ts`: `createEventBus`, `StateTransitionEvent`, `RealmEvent`, `EventBus`. D-26 delivery and rethrow rule.
- `src/core/ports.ts`: `ExecutionService` (D-39 methods), `CreateRequest`, `ProbeResult`. No environment field.
- `src/fs/root.ts`: `bindRoot`, `PinnedRoot`, `isInsideRoot`.
- `src/fs/canonicalize.ts`: `canonicalize` (D-29 walk, `mode: "read" | "write"`), `openVerified`, `verifyDescriptor`, `openCanonical` (with the `onResolveBoundary` hook and a `procFdDir` override), `lstatIfPresent`, `errnoOf`, `MAX_SYMLINK_HOPS`.
- `src/fs/atomic-write.ts`: `atomicWriteFile` (D-35, `expectedPriorSha256`, `stageHook`), `observeSha256`, `sha256Hex`, `WriteNotAtomicError` (with `replaced`).
- `src/session/paths.ts`: `resolveStateDir(env)`, `sessionsDirOf`, `controlSocketPath`, `recordFileName`.
- `src/session/store.ts`: `SessionStore` (`save`, `load`, `delete`), D-14 frozen fields, modes 0700 and 0600.
- `src/lifecycle/controller.ts`: `LifecycleController` create path, `attach`, `detach`, `attachments()`, `snapshot()`, `events`.
- `test/support/fake-execution.ts`: `FakeExecutionService` (idempotency-keyed resources, call log, `callCount`, `setDelay`, `failNext`, `beforeCall`, `setHealth`, `resources`).
- `test/core/state-machine.test.ts`, `test/core/events.test.ts`, `test/fs/canonicalize.test.ts`, `test/session/store.test.ts`, `test/lifecycle/controller.test.ts`.

No frozen file was edited (`src/core/states.ts`, `src/core/errors.ts`, `src/contract/*`, `src/core/policy.schema.json`). No dependency was added.

## Must-haves and the tests that evidence them

- A rejected transition, including every self-transition, throws `REALM_INVALID_TRANSITION` and leaves state, reason, time, and events unchanged: `every disallowed pair, including all six self-transitions, throws REALM_INVALID_TRANSITION with nothing changed (CORE-01)`; 13 allowed and 23 rejected pairs counted in `the 36 ordered pairs split into the 13 D-11 edges and 23 rejected pairs (CORE-01)`.
- Every committed transition publishes exactly one event, in subscription order, surviving a throwing listener: `every committed transition publishes exactly one state.transition event ... (CORE-04)`, `listeners run synchronously in subscription order (CORE-04, D-26)`, `a throwing listener does not stop later listeners ... (CORE-04, D-26)`, `when several listeners throw, the first listener error is the one rethrown (D-26)`, `a transition whose listener throws stays committed ... (CORE-04, D-25)`.
- A relative path inside the root canonicalizes; an escaping symlink, a more-than-40-hop chain, or an unverifiable descriptor fails with `PATH_ESCAPE`: `a relative path inside the root resolves to its real path (FS-01)`, `a symlink that escapes the root is rejected with PATH_ESCAPE, relative or absolute (FS-01)`, `a chain of exactly 40 symlink hops resolves; 41 hops fail with PATH_ESCAPE (FS-01)`, `openVerified refuses a symlink at the final component with PATH_ESCAPE (FS-02)`, `without /proc/self/fd the descriptor check fails closed with PATH_ESCAPE and is never skipped (FS-02)`.
- Session create writes the record with `containerId` null before the fake create runs, then stores the returned id (RT-07): `create writes the record with containerId null before the fake create runs (RT-07)`, `create stores the returned containerId before start, and the record holds it afterwards (RT-07)`, `a failed port create leaves containerId null in the record and the session in error (RT-07)`.
- The fake implements the exact D-39 method set with no environment parameter: `the port request carries only the idempotency key and the workspace root (AUD-02)` (runtime key-set check on the recorded request).

## Requirement evidence

- CORE-01: `test/core/state-machine.test.ts`, all five tests.
- CORE-04: `test/core/events.test.ts`, all six tests.
- FS-01: `test/fs/canonicalize.test.ts`, bind, resolution, escape, segment containment, hop limit, loop, absent results, dot-dot, write mode.
- FS-05 (partial in this plan): `test/session/store.test.ts` `an update replaces the record atomically and leaves no temporary file behind (FS-05, D-37)`. The stage-hook failure matrix (`after-temp-write`, `after-fsync`, `before-rename`) is owned by plan 02-03 (`test/fs/atomic-write.test.ts`).
- RT-07: `test/lifecycle/controller.test.ts` create-ordering tests and `test/session/store.test.ts` `a first save writes exactly the frozen fields ... (RT-07, D-14)`.
- CORE-06 (partial): create retry through error, no second create for a stored containerId, repeated create returns the same snapshot, attach and detach idempotent.

Test titles use the `(CORE-xx)` and `(FS-xx)` markers, so the taxonomy and requirement checks can find them.

## Deviations and interpretations (each with the default applied)

1. **Port is async.** D-39 writes the signatures without `Promise`. The port returns Promises because D-28 races every call with `withTimeout`, which takes a Promise. A synchronous call could not be bounded. Method names, argument shapes, and the absence of an environment field are exactly D-39.
2. **D-20 layering amendment (recorded here, not edited in `.planning/`).** `session` and `lifecycle` import `contract` for validation only (F-2). `lifecycle` also imports `fs` for the root bind. `core` imports nothing from other modules. The policy loader is not in this plan (plan 02-02 owns it), so no `core` to `contract` cycle is introduced here.
3. **Canonicalize result shapes.** `found` is `{status, realPath}`. `absent` is `{status, nearest, missing}`, where `missing` lists the unresolved segments. Write mode rejects a symlink at the final segment (D-34 step 1); symlinks in intermediate segments are followed.
4. **Symlink containment is checked on the final resolved path.** Absolute symlink targets may pass through ancestors of the root during the walk. The final real path must lie inside the root, and the descriptor check confirms the object that is opened. An escape that ends outside the root is `PATH_ESCAPE`.
5. **Any open failure in `openVerified` is `PATH_ESCAPE`** (including `ELOOP` from a swapped symlink and `ENOENT`). A path that cannot be verified is treated as escaping, per F-8 and D-30. An `lstat` failure other than `ENOENT` or `ENOTDIR` is also `PATH_ESCAPE`.
6. **Verification failures inside `atomicWriteFile` keep their own code.** A temp-file descriptor mismatch is `PATH_ESCAPE`. Other pre-rename failures are `WRITE_NOT_ATOMIC` with `replaced: false`. A re-hash mismatch is `LOCK_CONFLICT`. A parent fsync failure after a successful rename is `WRITE_NOT_ATOMIC` with `replaced: true`, so the audit layer can record that durability is unconfirmed.
7. **Stage order in `atomicWriteFile`:** write, `after-temp-write`, fsync, `after-fsync`, `before-rename`, re-hash, rename, parent fsync. The `before-rename` hook runs before the re-hash, so a test can change the target and observe `LOCK_CONFLICT`.
8. **Session ids are restricted to `^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$`** because they become file names. A bad id fails with `SCHEMA_INVALID`. The frozen schema only requires `minLength: 1`, so this is a code check.
9. **`resolveStateDir` throws a plain `Error`** when neither an absolute `XDG_STATE_HOME` nor an absolute `HOME` is set. The catalogue has no configuration code and the catalogue is frozen. Callers see a non-taxonomy error. Phase 6 CLI should surface it.
10. **Controller error reasons.** A `RealmError` from the port moves the session to `error` with the code as the reason, and the snapshot is returned. A non-`RealmError` moves it to `error` with reason `unexpected port failure` and rethrows. The fake's `failNext` accepts either form.
11. **Workspace policy.** `create` canonicalizes the requested root and every `policy.workspaceRoots` entry. The root must lie inside a policy root. An unresolvable policy root, or an empty `workspaceRoots`, fails with `POLICY_DENIED`. A stored container bound to another workspace is never reused (`POLICY_DENIED`).
12. **Stopping state.** `create` from `stopping` throws `REALM_STOPPING`. Stop and destroy semantics are plan 02-05's.
13. **Store writes are inside the guarded block.** The first record write runs inside the `try`, so a failed write moves the session to `error` rather than leaving it stuck in `connecting`.
14. **No timeouts in create.** `startupBudgetMs` wrapping is plan 02-05's (D-28). The create path calls the port directly.
15. **The store has `delete`** (listed in the plan's artifacts). Plan 02-05 uses it when it removes the record last.
16. **Helper directories.** Temporary-directory helpers are inlined in each test file, because `files_modified` does not list a shared helper.

## Residual risks and open questions

- **Q-2 (rename window, accepted).** Node 22 has no `openat`. A parent directory swapped between verification and `rename(2)` is narrowed by the parent re-check, not closed. Recorded for the Phase 7 security review. This plan adds no native helper.
- **Q-3 (orphaned temp files, default applied).** A temp file left by a killed process is not cleaned up here. The name pattern is `.<basename>.realm-tmp-<hex>`.
- **Q-1 (teardown timeout, default applied).** No teardown code in this plan. Plan 02-05 uses the single `TEARDOWN_TIMEOUT_MS` constant with `REALM_STOPPING`.
- **Q-4 (MCP and ACP contract tests, deferred to Phase 5).** No MCP or ACP test in this plan. QUAL-02 is covered only through the taxonomy and category tests (plan 02-06).
- **Not verified in this lane.** Per the shared rules, I did not run `tsc`, `eslint`, or `node --test`. The orchestrator must run the gates after the wave. Watch in particular: definite assignment of `fd` in `atomicWriteFile` and `openVerified`; the optional-chain narrowing in `controller.test.ts` (`created?.request`); and the `let containerId` narrowing across the `try` in the controller.

## Checkpoint decision (D-14, approved)

The record matches the approved one-way shape: `<stateDir>/sessions/<sessionId>.json`, directory mode 0700, record mode 0600, the six frozen fields in fixed order, `containerId` null until created, `controlSocketPath` recorded but not created, and writes through the atomic replace with no lock. The `store.test.ts` tests check these properties.

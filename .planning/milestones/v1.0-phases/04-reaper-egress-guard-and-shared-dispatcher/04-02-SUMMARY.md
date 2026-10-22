# Plan 04-02 Summary: Sweep move, SessionStore.list, startup reaper (RT-08)

Status: implemented. Unit suites were written but not run in this lane; the orchestrator runs the gates after the wave lands. Live behavior is not claimed (the host runs Podman 4.9.3; the sweep and reaper are proven here with in-process fakes only).

## Files

- `src/runtime/sweep.ts` (new): `removeAllRealmContainers(libpod)` moved from `session-execution.ts` with the same double-listing zero-survivor proof. It now resolves with the removed count (D-84). `SweepClient` moved with it.
- `src/runtime/openshell.ts`: `MANAGED_LABEL_VALUE` added beside `MANAGED_LABEL_KEY` (D-84). `buildCreateArgv` uses the constant for the `io.realm.managed` label; the emitted argv is unchanged.
- `src/runtime/session-execution.ts`: the sweep body, `SweepClient`, and the local `MANAGED_LABEL_VALUE` are removed. The module re-exports `removeAllRealmContainers` and `SweepClient` from `sweep.ts`, so existing callers keep resolving. The header comment points at `sweep.ts`.
- `src/session/store.ts`: `SessionStore.list()` (D-85). Name-only enumeration; no file is parsed.
- `src/session/reap.ts` (new): `reapStartup({ store, sweep })` (D-84, D-86, D-87). Imports no `src/runtime/` module (D-50).
- `test/runtime/down-sweep.test.ts` (migrated): imports from `src/runtime/sweep.js`; asserts the removed count.
- `test/session/store.test.ts` (extended): three RT-08 `list()` cases.
- `test/session/reap.test.ts` (new): six RT-08 reaper cases.

## must_haves evidence

Truth 1 (sweep removes every realm-labelled container, touches no foreign container, returns the removed count, proves zero survivors or reports REALM_STOPPING; RT-08, D-84):
- `RT-08: the sweep removes every realm-labelled container, leaves a foreign container untouched, and returns the removed count` (test/runtime/down-sweep.test.ts)
- `RT-08: the sweep lists before and after removal on every run, and a repeated sweep over a clean host is a no-op returning zero` (test/runtime/down-sweep.test.ts)
- `RT-08: a container that cannot be removed gives REALM_STOPPING, and a repeated sweep clears it and returns its count` (test/runtime/down-sweep.test.ts)

Truth 2 (`SessionStore.list()` returns ids from file names, including corrupt records, and ignores non-matching names; RT-08, D-85):
- `RT-08: list() returns the sorted ids of record files and ignores names that do not match the record pattern (D-85)` (test/session/store.test.ts)
- `RT-08: list() includes the id of a record whose contents are corrupt, so the record can still be deleted (D-85)` (test/session/store.test.ts)
- `RT-08: list() on an absent sessions directory returns an empty array, not null (D-85)` (test/session/store.test.ts)

Truth 3 (reapStartup removes containers before records, reaps a crash during realm up in both record states, is a no-op on repeat, and deletes nothing when the sweep fails; RT-08, D-84, D-86):
- `RT-08: reapStartup removes every container before it deletes any record, checked against the live container store (D-84)` (order check: each record deletion asserts zero realm-labelled containers remain, and the call log reads sweep, then records)
- `RT-08: reapStartup reaps a crash during realm up with a null container id, found through its label (D-86)`
- `RT-08: reapStartup reaps a record that holds a container id together with that container (D-86)`
- `RT-08: reapStartup leaves a foreign unlabelled container untouched (D-86)`
- `RT-08: a second reapStartup is a no-op that removes nothing and deletes nothing (D-84)`
- `RT-08: a surviving container makes reapStartup reject with REALM_STOPPING, deletes no record, and a later reap completes (D-84)`

Prohibitions:
- `src/session/reap.ts` imports only `./store.js` as a type. No runtime import (D-50).
- No error code, policy key, or dependency was added (D-101).

## Decisions and deviations

- The sweep returns `found.length`. Once the second listing is empty, every container the first listing found is gone, so this is the removed count.
- `reapStartup` resolves with `{ containersRemoved, recordsDeleted }`. The plan did not fix a return shape; the counts make the reap observable.
- `SessionStore.list()` keeps only regular files (`Dirent.isFile()`). A directory named `*.json` would otherwise be listed, and `delete` on it would fail. Contents are still never read.
- `buildCreateArgv` now reads the label value from `MANAGED_LABEL_VALUE` instead of the literal `true`. This is the sharing the pattern map asks for; the argv string is identical.
- `test/integration/podman-gate.test.ts` is outside this lane's owned files. It still imports `removeAllRealmContainers` and `SweepClient` from `src/runtime/session-execution.js`. The re-export keeps it compiling. Its owning lane should migrate the import to `src/runtime/sweep.js` (the pattern map lists this migration).
- `test/quality/suite-taxonomy.test.ts` is not edited here. `test/session/reap.test.ts` is not yet in `D45_FILES`, and the Phase 4 ID assertions belong to that lane (D-102).

## Open items (live-gated or residual)

- OQ-P4-06 (residual risk, Phase 6): reaping has no cross-process owner check. The single-owner precondition (D-87) is documented in `src/session/reap.ts`.
- The OpenShell create's label application by the Podman driver is live-gated (OQ-P3-01). The orphan-by-label reap of a null-id record is proven only against the fake libpod.

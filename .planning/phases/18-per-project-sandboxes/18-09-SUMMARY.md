---
phase: 18
plan: 09
subsystem: daemon
tags: [daemon, startup, audit, registry, orphan-sweep, attribution]
requires: ["18-06"]
provides:
  - "Startup orphan temp-file removals are written to the audit file of the session whose recorded workspace holds the path, and to no other"
  - "Removals no recorded workspace holds are counted as unattributedTempFiles and write no audit line"
  - "Registry entries of earlier generations are removed at startup and counted as registryEntriesRemoved"
  - "A failed registry cleanup at startup is a reap failure, reported with its catalogue code"
affects: [src/daemon/startup.ts, src/daemon/main.ts, test/daemon/daemon.test.ts, test/daemon/main.test.ts]
key-files:
  created: []
  modified:
    - src/daemon/startup.ts
    - src/daemon/daemon.ts
    - src/daemon/main.ts
    - test/daemon/daemon.test.ts
    - test/daemon/main.test.ts
decisions:
  - "The maintenance code lives in src/daemon/startup.ts (split out of daemon.ts by f813448); daemon.ts only calls runStartupMaintenance"
  - "Adopted sessions keep their registry entries (adoptedIds is skipped in the removal loop); this is Phase 19's selective adoption (b3411bc), not part of this plan's scope"
requirements: [MULTI-03]
metrics:
  tasks: 2
  commits: 4
commits: 4
status: implemented; test runs NOT VERIFIED in this audit
---

# Phase 18 Plan 09: startup maintenance attribution and registry cleanup (MULTI-03) Summary

Both tasks are in the code and tests on the branch. The attribution and the registry cleanup were added in one feature commit; the review gap fixes (a failed cleanup as a reap failure, and a startup-line test with a real leftover) are three follow-up commits. The plan's verify commands were not run in this summary.

## Tasks

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| T1 | Attribute orphan removals from the pre-reap records | c42b312 (feature), f813448 (move to startup.ts) | src/daemon/startup.ts, src/daemon/daemon.ts, test/daemon/daemon.test.ts |
| T2 | Registry entries removed by the startup reap, and reported | c42b312 (feature); gap: 1775047, ec94fec, 4ad91be | src/daemon/startup.ts, src/daemon/main.ts, test/daemon/main.test.ts, test/daemon/daemon.test.ts |

## What was added

- `src/daemon/startup.ts` `captureOwners` (about lines 363-387) reads each record with `store.list()` and `store.load()` before `reapStartupSelective` deletes them. A record that cannot be loaded adds to `unreadable` and its catalogue code to `unreadableCodes`. The store seam type is `Pick<SessionStore, "list" | "load" | "delete">` (line 110).
- `ownerOfPath` (about lines 391-401) returns the session of the owner whose `workspaceRoot` equals the path or is a proper ancestor of it. It compares path segments with `relative` and `isAbsolute`, not string prefixes, and takes the longest such root.
- In the orphan sweep's `audit` callback (about lines 240-253), a path with an owner calls `appendAudit` with that owner's `sessionId`. A path with no owner increments `unattributedTempFiles` and writes nothing. No code path writes under the id `daemon`: a grep of `src` finds no `sessionId: "daemon"` and no `appendAudit` with that id.
- `StartupReport` (about lines 81-88) carries `unattributedTempFiles`, `unattributedRecords` (from `unreadableRecords`) and `registryEntriesRemoved`. `src/daemon/main.ts` lines 168-170 copy them to the startup line beside the existing fields, which keep their names.
- Registry cleanup (about lines 188-214): after the reap and before the temp-file sweep, every entry from `listWorkspaceEntryIds` whose id is not an adopted session is removed with `removeWorkspaceEntry` and counted. A removal that throws is a reap failure: `failedStartReport` carries the code and the counts, and the error is rethrown.
- Tests: `test/daemon/daemon.test.ts` lines 2835-2877 (attribution of A and B, outside file counted, no daemon audit file, both records gone after the start); 2879-2897 (an invalid-JSON record counted in `unattributedRecords` with `SCHEMA_INVALID`, start completes); 2917-2945 (one leftover entry removed by the first startup, second startup removes none). `test/daemon/main.test.ts` lines 850-889 (leftover entry and record, startup line reports `registryEntriesRemoved: 1`, `recordsDeleted: 1`, `unattributedTempFiles: 0`, `unattributedRecords: 0`, `containersRemoved: 0`); 893-915 (a registry directory that is a file fails the start: `reapFailure` and `code` are `SCHEMA_INVALID`, `failures: 1`, `registryEntriesRemoved: 0`, `daemon.failed` line with the same code).
- Expected-report literals in `test/daemon/main.test.ts` and `test/daemon/daemon.test.ts` carry the three new fields with value 0, except the two-orphan scenario in daemon.test.ts (line 748-750: `unattributedTempFiles: 2`, `unattributedRecords: 1`, `registryEntriesRemoved: 0`).

## Gap closure (review on PR 88)

- 1775047: `src/daemon/startup.ts` now treats a failed registry cleanup as a reap failure through `failedStartReport`. Before it, the throw was not reported with its code.
- ec94fec: `test/daemon/main.test.ts` startup-line test writes a real leftover entry and record instead of a fake one.
- 4ad91be: the leftover entry and record are keyed by the workspace's own id from `sessionIdOfWorkspace`. A registry entry with a fixed UUID is refused with `SCHEMA_INVALID` by `writeWorkspaceEntry`, so the test could not reach the startup.

## Verification

Read-only checks in this summary (no build, test, lint or formatter was run, per the assignment):

- Commit ancestry: c42b312, 1775047, ec94fec and 4ad91be are ancestors of HEAD (4ad91be).
- Symbols present in code: `captureOwners`, `ownerOfPath`, `unattributedTempFiles`, `unattributedRecords`, `registryEntriesRemoved`, `removeWorkspaceEntry`, `listWorkspaceEntryIds`, `reapFailure` in `src/daemon/startup.ts`; the three fields in `src/daemon/main.ts`.
- Test names and assertions above were read in the test files.
- The `audit/daemon.jsonl` absence is asserted at `test/daemon/daemon.test.ts:2873`.

NOT VERIFIED:
- `npm run build && node --test dist/test/daemon/daemon.test.js` (T1 verify command): not run.
- `npm run build && node --test dist/test/daemon/main.test.js dist/test/daemon/daemon.test.js` (T2 verify command): not run.
- T1 done-when (d), "the reap order is observed": the test asserts the attribution outcome and that the store is empty after the start. It does not assert the record listing at the time of the sweep callback, so (d) as written is not covered.

## Deviations from Plan

**1. Plan file list vs code: `runStartupMaintenance` is in `src/daemon/startup.ts`**
- The plan names `src/daemon/daemon.ts` as the home of `runStartupMaintenance`. Commit f813448 (refactor, before this plan's tests) moved it and its seams to `src/daemon/startup.ts`. `daemon.ts` keeps only the call at its startup path.
- The attribution and cleanup code therefore sits in `startup.ts`. The reap order is unchanged: capture owners, reap, registry cleanup, temp-file sweep, reconciliation, serve.

**2. Plan vs code: adopted sessions keep their registry entries**
- The plan's must-have says each entry left by a previous generation is removed. The code skips entries whose id is an adopted session (`adoptedIds`). This came with Phase 19's selective adoption (b3411bc), and the adopted entry is written again by its hydration.

**3. Stale comment, not edited (outside this plan's files)**
- `test/daemon/daemon.test.ts:986` says "no removal is written to the daemon's log until plan 09". Plan 09 has landed, and the assertion there is still correct. The comment is stale. Left unchanged.

**Total deviations:** 3, two plan-vs-code and one stale comment.

## Known Stubs

None.

## Threat Flags

None. The change adds no network surface and writes only to the owning session's audit file.

## Next Phase Readiness

Plan 11 (surface tests) and the live checkpoint (18-14) rely on the orphan-line attribution. Owner must run the two verify commands above before the attribution is treated as passing. The one open test gap is T1 (d).

---
*Phase: 18-per-project-sandboxes*
*Completed: 2026-11-15*

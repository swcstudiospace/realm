---
phase: 18-per-project-sandboxes
plan: 07
requirements: [MULTI-02, MULTI-05]
status: complete_run_not_observed
---

# Phase 18 plan 07: per-project pin regressions (MULTI-02, MULTI-05)

The unit proofs for the per-project pin are in place: alias, nested, sibling-prefix, configured-root, rename and rename-aside cases in `test/fs/root.test.ts`, and the two-project sandbox binding cases in `test/runtime/sandbox-binding.test.ts`. No production code changed. The new cases were added by commit e2baed6 (on main at audit ea07518) and are present at the worktree HEAD 4ad91be.

## Tasks

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| T1 | canonical identity and pin regressions in the root module | e2baed6 | test/fs/root.test.ts |
| T2 | two projects give two distinct sandbox bindings | e2baed6 | test/runtime/sandbox-binding.test.ts |

## What was added

T1, `test/fs/root.test.ts`, each case asserts returned values or a thrown catalogue code:

- (a) symlink to a project: `bindWorkspaceUnderPolicy` returns the same `realPath`, `dev` and `ino` as the direct bind, and equal `sessionIdOfWorkspace` (line 114).
- (b) project nested in another project: both bind, with different `realPath` and session ids; `verifyPinnedAt` of the outer pin does not admit the nested path (line 128).
- (c) sibling named `<root>2`: refused with `POLICY_DENIED` (line 141).
- (d) configured root itself: accepted by equality (line 150).
- (e) bound project renamed away: `verifyPinnedAt` throws `POLICY_DENIED` (line 155).
- (f) bound project renamed aside, new directory at its path: `verifyPinnedAt` throws `POLICY_DENIED`. The original is renamed, never removed (line 164).
- (g) relative request naming a directory inside the root: refused with `POLICY_DENIED` (line 174).

T2, `test/runtime/sandbox-binding.test.ts`, on the two-project fixture (`twoProjects`, line 66):

- two projects give bindings whose `workspaceRoot` is each project and whose `stateDir` and `channelDir` differ (line 78).
- each project's sandbox name is at most 19 characters, the gateway limit (line 90). The limit is `SANDBOX_NAME_MAX_LENGTH` in `src/session/paths.ts`, checked by `sandboxNameOfSession`.
- a name for another session id maps to its own `stateDir` under the same state root; a name with a path separator throws `SCHEMA_INVALID` (line 96).

## Deviations

- Plan item (g) says "not absolute". The case as written passes a relative path to a directory inside the root. It exercises the same `POLICY_DENIED` refusal for a non-absolute request.
- Commit e2baed6 deletes four lines in the two files. All four are import lines that were reordered or extended. No existing case body changed, which meets the plan's "existing cases unchanged" rule.

## Verification

Verified by reading the code at HEAD:

- Each new case asserts a value or a thrown code. `assertDenied` checks `RealmError.code === "POLICY_DENIED"`; line 106 checks `SCHEMA_INVALID`. No case reads source text.
- `src/session/paths.ts` provides the inputs the cases depend on: the 19-character limit and the canonical-absolute-path check (`isCanonicalAbsolutePath`).

NOT VERIFIED:

- `npm run build && node --test dist/test/fs/root.test.js` and `node --test dist/test/runtime/sandbox-binding.test.js` were not run in this pass. The contract for this pass forbids running tests, and no recorded pass result for plan 07 was found in `18-VERIFICATION.md`, which lists the two files only as covered.

## Dependencies

Plan 07 depends on plan 04, which owns `sandbox-binding.test.ts` in the same wave-4 batch (`18-PLAN-CHECK.md`). Plan 02 is a transitive dependency through the path and workspace-registry changes.

## Known Stubs

None.

## Threat Flags

None. The change is test-only.

## Next Phase Readiness

The unit pin proofs for MULTI-02 and MULTI-05 are written. A run of the two verify commands is still needed to close the unit evidence. The live two-project scenario is plan 13 and plan 14 and is not covered by this plan.

---
*Phase: 18-per-project-sandboxes*
*Plan: 07*

# Plan 04-04 Summary: workspace handlers, audit phase marker, no-bypass guard (TOOL-03)

Requirement: TOOL-03. Decisions: D-34, D-42, D-88, D-89, D-90, D-98, D-99, D-104, D-107, C-4, C-5.

Status: implemented. The gates (tsc, node --test) were not run in this lane, per the wave policy. The orchestrator runs them after the wave lands.

## Files

- `src/audit/log.ts` (edited): `AuditPhase = "admission" | "result"` and the optional `phase` field on `AuditEntryInput`. The entry object gains `phase: input.phase`. JSON serialization drops an absent phase, so entries without a phase keep the old seven-key shape.
- `src/tools/workspace.ts` (new): `readWorkspaceFile`, `listWorkspaceDir`, `writeWorkspaceFile`, with `WorkspaceDeps` and `WriteOutcome`. It is the only module under `src/tools/` that imports `lockedWrite`, `readFileCapped`, or `listDir` (D-88).
- `test/audit/log.test.ts` (extended): two TOOL-03 cases appended. Existing assertions are unchanged.
- `test/tools/workspace.test.ts` (new): 19 TOOL-03 cases against real files, real `LockTable`, and the real audit log.
- `test/tools/no-bypass.test.ts` (new): five TOOL-03 static guard cases over `src/`.

## Stage order per handler (D-89)

- Write: state gate (injected `mutationGate`; a refusal throws with no audit line), then canonicalize in write mode and the credential check, then the lock probe, then the admission line, then `lockedWrite`, then the result line.
- Read and list: admission line, then `readFileCapped` or `listDir`, then the result line.
- A failed admission append throws `AUDIT_WRITE_FAILED` before execution. A failed result append throws `AUDIT_WRITE_FAILED` without rollback.

## Must-have evidence

| Truth | Evidence (test titles) |
|---|---|
| A write with a stale `ifMatchSha256` returns `LOCK_CONFLICT` and leaves the file byte-identical (TOOL-03, D-98, D-34) | `TOOL-03: a write with a stale ifMatchSha256 is LOCK_CONFLICT, the file stays byte-identical, and the result line records the code (D-34, D-98)`; `TOOL-03: a write with a matching ifMatchSha256 replaces the content, returns its sha256 and byte count, and logs admission then result (D-34, D-98, D-90)` |
| Audit lines carry byte count and sha256, never content (TOOL-03, D-90, D-42) | `TOOL-03: write audit lines carry the byte count and sha256 of the content and never the content (D-42, D-90)`; `TOOL-03: a read returns the Phase 2 result shape and logs admission and result lines with byte count and sha256, never content (D-36, D-42, D-98)`; `TOOL-03: the byte count of a write is its UTF-8 length, not its character count (D-42)` |
| Read and list pass the credential and root checks and return Phase 2 shapes (TOOL-03, D-98) | `TOOL-03: a read capped at maxBytes returns the capped content, the sha256 of the whole file, and truncated true (D-36, D-98)`; `TOOL-03: a read of an escaping path is PATH_ESCAPE and a credential path is CREDENTIAL_PATH_DENIED, each logged as its result code (D-36, D-31, D-98)`; `TOOL-03: a credential path is readable when credentialAllow names it (D-31)`; `TOOL-03: a list returns the Phase 2 result shape sorted by name, with symlinks reported by link text and never followed (D-36, FS-03)`; `TOOL-03: a list of a credential directory is CREDENTIAL_PATH_DENIED and logged as its result code (D-31, D-36)`; `TOOL-03: a list of an escaping path is PATH_ESCAPE (D-36, FS-01)` |
| Audit entries carry admission or result stage (TOOL-03, D-89, D-90, C-4) | `TOOL-03: an entry carries its phase when the caller names one, and each phase is its own line (D-90, D-107)`; `TOOL-03: an entry with no phase has no phase key, so the pre-stage shape is unchanged (D-107)`; the write and read tests above assert the admission then result order |

Further cases that pin the pipeline:
- Lock refusal before admission: `TOOL-03: a write to a path another owner holds is LOCK_CONFLICT before admission, and that owner keeps the lock (D-89 stage 3, D-34)`.
- Symlink and credential refusal before admission: `TOOL-03: a write whose target is a symlink ...`, `TOOL-03: a write to a credential path ...`.
- State gate refusal: `TOOL-03: a write refused by the state gate in required mode is REALM_NOT_ACTIVE ...`.
- Advisory warning: `TOOL-03: a write in a non-active state under advisory policy proceeds and returns the advisory warning (D-98, D-23)`.
- S-21 and OQ-P4-07: `TOOL-03: a write whose admission line cannot be appended ...`, `TOOL-03: a result line that cannot be appended after a write ...`, `TOOL-03: a read whose admission line cannot be appended ...`.

Static guard (plan 04-04 Task 3, D-99, D-104, C-5):
- `TOOL-03: the D-99 symbols are referenced only from src/tools/, the two shared runtime modules, and their own modules (D-99)`
- `TOOL-03: spawn( appears in src/ only in src/runtime/session-execution.ts (D-99)`
- `TOOL-03: OPENSHELL_BINARY is referenced only from its allowlist, and the doctor probe is allowlisted for that literal alone (D-99, D-104, C-5)`
- `TOOL-03: under src/tools/ only workspace.ts imports lockedWrite, readFileCapped, or listDir (D-88)`
- `TOOL-03: the guard reports a module outside the allowlist that references a guarded symbol, spawns a process, or names the binary`. This last case runs the guard on synthetic sources, so the guard cannot pass vacuously.

## Deviations from the plan

1. **Read and list do not repeat canonicalize or the credential check.** `readFileCapped` and `listDir` already run canonicalize (read mode), then the credential check, in that order (D-36). Repeating them in the handler adds nothing. Write does run them, because its lock probe needs the canonical target.
2. **Lock pre-check uses `acquire` plus `release`, not a bare `isHeldBy`.** `LockTable` has no "held by another owner" query. `isHeldBy` covers the session's own lock. For another owner's lock, the probe calls `acquire`, which throws `LOCK_CONFLICT`, then releases the lock it just took. The effect is the D-89 stage 3 refusal before admission. `lockedWrite` still performs the authoritative acquire (D-34).
3. **The write gate is injected as `mutationGate: () => GateOutcome`.** This keeps `src/tools/workspace.ts` off the controller type. The dispatcher will pass `() => controller.mutationGate()`.
4. **Handlers write their own audit lines.** The plan injects `audit` into the workspace handlers, so each file call writes its admission and result lines. Plan 04-06 has the dispatcher write audit lines for every tool. For file tools, 04-06 must not write them a second time. I raised this with the orchestrator.
5. **`ListParams.depth` is not used.** The schema accepts `depth`, but `listDir` is single-level (Phase 2 shape). The handler takes `Pick<ListParams, "path">`.
6. **Audit `bytes` for a read is the length of the returned content (at most `maxBytes`), and `sha256` covers the whole file.** This is what `readFileCapped` reports. A write records the UTF-8 length and sha256 of what it wrote.
7. **A non-`RealmError` thrown during execution is rethrown with no result line.** Phase 2 maps every expected failure to a `RealmError`, so any other error is a defect. The catalogue has no generic internal code, so I did not invent one (D-101).

## Open questions and defaults applied

- Should the dispatcher or the workspace handlers own the file-tool audit lines? Default applied: the handlers own them, per Task 2. This is pending the orchestrator's answer on 04-06.
- Should `list` honour `depth`? Default applied: no. Single level, per Phase 2.
- Should an unexpected non-`RealmError` get an audit result line? Default applied: no. It is rethrown.

## Not run

Per the lane policy, I did not run `tsc`, `node --test`, or any linter. The orchestrator's gate run should cover `test/audit/log.test.ts`, `test/tools/workspace.test.ts`, and `test/tools/no-bypass.test.ts`. Also check that `src/tools/workspace.ts` compiles with `exactOptionalPropertyTypes` (the ifMatch conditional spread is the spot to look at).

# Phase 14 research: crash-safety pack (proposal 4, CRASH-01 to CRASH-07)

Scope: read-only research for the Phase 14 planner. Code state: branch `docs/milestone-v3-start`, tree as found (only `.planning/` files modified). Labels: VERIFIED_BY_CODE_READING (the cited lines were read in this task), VERIFIED_BY_EXECUTION (a read-only command was run: `git grep`, `grep`, `ls`), INFERENCE, UNKNOWN. All paths are repo-relative. No build, test or lint was run.

Requirement IDs used below are the ones already present in `.planning/REQUIREMENTS.md:33-39` (CRASH-01 sweep, 02 reconciliation, 03 delete fsync, 04 reap log and notice, 05 real SIGKILL, 06 TD-01, 07 TD-04).

Corrections to the brief, found while reading:

- There is no pinned-root *descriptor* API. `PinnedRoot` holds only `realPath`, `dev` and `ino` (`src/fs/root.ts:13-25`), and `verifyPinnedAt` opens and closes its own fd (`src/fs/root.ts:63-80`). The only code that holds a pinned directory descriptor and acts through `/proc/self/fd/<fd>/<name>` is private to `src/fs/atomic-write.ts` (`pinDirectory` `:249-272`, `assertDirectoryPinned` `:276-288`). There is no directory walker anywhere in `src/fs/` (`list.ts` reads one directory; `glob.ts` is a string matcher). The sweep needs a new walker. (VERIFIED_BY_CODE_READING)
- There is no call id on audit lines. Pairing of admission and result lines is by order and content only (item 2).
- Over the daemon the refusal is not merely missing its cause code. The daemon turns a refused `ToolOutcome` into a control-channel *error* reply (`src/daemon/daemon.ts:417-420`), the client turns that into a thrown `RealmError` (`src/daemon/client.ts:125-127`), and MCP and ACP then render a thrown error, not the refused outcome (`src/mcp/server.ts:212-215`, `src/acp/agent.ts:194-199`). The cause code is dropped one step earlier too, in the dispatcher (`src/tools/dispatch.ts:127`, `:257-259`). Item 6 treats both.
- `docs/policy-reference.md` does not enumerate the error catalogue and does not describe the audit log (VERIFIED_BY_EXECUTION: `grep -i audit` returns one unrelated line). The files that do enumerate the catalogue are listed in item 2.
- The L6a SIGKILL helper is not committed as a script. It is the appendix script `atomic-kill-test.mjs` inside `docs/integration/omp-lifecycle-runbook.md` (section D at `:84-86`, script near `:190-250`). Its core is the child `atomicWriteFile(target, content, {expectedPriorSha256: prior, stageHook: (stage) => { if (stage === killAt) process.kill(process.pid, "SIGKILL"); }})`.

---

## Item 1. Orphan temp-file sweep (CRASH-01)

### Current behaviour
- Temp name `.<name>.realm-tmp-<16 hex>` is built inline at `src/fs/atomic-write.ts:177` from `randomBytes(8).toString("hex")`, so the suffix is always 16 lowercase hex. It is created `O_CREAT|O_EXCL|O_WRONLY|O_NOFOLLOW` mode 0600 through `/proc/self/fd/<dirFd>/<temp>` (`:178-185`), then `fchmod` to the target's rwx bits (`:192`). Stage hooks fire at `:194`, `:196`, `:197`, `:202`; `renameSync` is `:203`; the only removal is the in-process catch (`:204-212`, helper `removeTempFile` `:129-136`, which returns `CLEANUP_FAILED` on failure). A SIGKILL before the rename leaves one complete temp file forever. (VERIFIED_BY_CODE_READING; LIVE-VERIFICATION L6a, VERIFIED_BY_EXECUTION by that task)
- Other `atomicWriteFile` callers, whose orphans the requirement text does not name: `src/session/store.ts:40` (sessions dir), `src/runtime/openshell.ts:376` (`<stateDir>/runtime/<id>.policy.json`), `src/runtime/driver/seccomp-delivery.ts:46` (the driver's `seccomp` directory), and `src/fs/write.ts:69` (workspace files through `lockedWrite`). (VERIFIED_BY_EXECUTION: `git grep atomicWriteFile -- src`)
- Production code never reads the pattern `realm-tmp` except at `src/fs/atomic-write.ts:177`. Tests filter on `includes(".realm-tmp-")` (`test/fs/atomic-write.test.ts:53`, `test/fs/write.test.ts:55`, `test/tools/workspace.test.ts:122,151`).
- Startup order today: `startDaemon` binds the socket, then `reapStartup` (`src/daemon/daemon.ts:542-546`), then `openGate()` (`:547`). Connections wait on the gate (`:480-487`). Policy roots are available as `policy.workspaceRoots` (`src/contract/validate.ts:32`), but `startDaemon` does not hold the policy: `buildDaemonHandle` loads it inside (`:148`, and `createRealmHandle` `src/realm/compose.ts:62`). `RealmHandle` exposes only `policyMode` (`src/realm/compose.ts:21-27`). The sessions directory is `sessionsDirOf(stateDir)` (`src/session/paths.ts:12`). The runtime config also has `workspaceRoot` (`src/runtime/config.ts:16`), which `createRealmHandle` requires to lie inside a policy root (`src/realm/compose.ts:63`).
- The audit sink is `appendAudit(stateDir, entry)` (`src/audit/log.ts:69-91`), session id from `startDaemon`'s `options.sessionId` (the daemon entry passes `"daemon"`, `src/daemon/main.ts:21`, so the audit file is `<stateDir>/audit/daemon.jsonl`).

### Change (minimal)
1. Single source for the name. In `src/fs/atomic-write.ts` export `TEMP_NAME_PATTERN = /^\.(.+)\.realm-tmp-[0-9a-f]{16}$/` and a `tempFileName(name)` used at `:177`, so writer and sweeper cannot drift. Export `pinDirectory` (`:249`) and the descriptor fsync helper (`:292`) for reuse (or move the three pin helpers to a new `src/fs/pinned-dir.ts` that `atomic-write.ts` imports; the export is the smaller diff).
2. New `src/fs/temp-sweep.ts`: `sweepOrphanTempFiles(roots: readonly string[], options)` returning `{ removed: readonly {path: string; bytes: number}[]; skipped: number; failed: number; truncated: boolean }`.
   - Per root: `bindRoot(root)` (`src/fs/root.ts:29`); a root that fails to bind is counted and skipped, never fatal. Open it with `pinDirectory`-style open (`O_RDONLY|O_DIRECTORY|O_NONBLOCK|O_NOFOLLOW`), `fstat` against the pinned dev and ino, readlink of `/proc/self/fd/<fd>` equal to `realPath`.
   - Walk: `readdirSync("/proc/self/fd/<fd>", {withFileTypes: true})`. A child directory is entered only by opening `/proc/self/fd/<fd>/<name>` with `O_NOFOLLOW|O_DIRECTORY` (a symlink fails with ELOOP and is never followed), then `fstat` and the same `/proc` readlink check. Do not descend into a child whose `st_dev` differs from the root's (bind mounts and other filesystems). `Dirent.isSymbolicLink()` entries are never opened.
   - Candidate file: `Dirent` is a regular file, name matches `TEMP_NAME_PATTERN`, `lstatSync("/proc/self/fd/<fd>/<name>")` is a regular file (not a symlink), `st.uid === options.ownerUid`, and `now - st.mtimeMs >= options.minAgeMs`. Anything else, including every other dotfile, is untouched.
   - Order per candidate: audit first, then unlink, so a deletion is never unrecorded. `options.audit(entry)` appends `{ tool: "temp-sweep", outcome: "ok", path: <absolute real path>, bytes }` with no `phase` (an entry with no `phase` keeps the pre-stage shape, `src/audit/log.ts:34-35`, and test `test/audit/log.test.ts:303-310`, so it is never mistaken for an admission by item 2). If the audit append throws, skip the file (do not delete) and count it. Unlink through `/proc/self/fd/<dirFd>/<name>` (the same mechanism as `removeTempFile`, `:129-136`). If the unlink then fails, append a second line with outcome `CLEANUP_FAILED` (an existing code whose reason fits, `src/core/errors.ts:177-180`).
   - Bounds, because the walk is synchronous and a configured root may be a large tree: `options.maxEntries` and `options.deadlineMs` (checked with `performance.now()`), returning `truncated: true` when hit. Recommended defaults: age bound `ORPHAN_TEMP_MIN_AGE_MS = 60_000`, wall budget 15 s, entry cap 500 000. The age bound only has to exceed the longest legitimate write (a temp file lives for one write and one fsync); at daemon start no write of this daemon is in flight and the single-owner rule excludes another daemon (`src/session/reap.ts:29-32`).
   - Inject `now`, `minAgeMs`, `ownerUid` (`process.getuid()` supplied by the caller, so the module reads no process state) and `audit`. The module reads no `process.env`.
3. Wiring (in plan E, `src/daemon/daemon.ts`): in `startDaemon`, load the policy once (`const policy = options.policy ?? loadPolicyFile(options.policyPath)`, pass `policy` to `buildDaemonHandle`, which already accepts it at `:148`), compute roots = `policy.workspaceRoots` plus `sessionsDirOf(stateDir)`, drop a root that lies inside an earlier one (`isInsideRoot`, `src/fs/root.ts:84`), and run the sweep after `reapStartup` and before `openGate()` (between `:546` and `:547`). Sweep failures are reported through the startup observer (item 4) and never abort start. The sweep runs after the reap so a fresh sessions directory is already clean of records.

### Files
`src/fs/atomic-write.ts` (export and one call site), `src/fs/temp-sweep.ts` (new), `src/daemon/daemon.ts` (wiring, plan E), `docs/integration/omp-lifecycle-runbook.md:86` and the appendix expectations ("a later clean write leaves that orphan in place" becomes "the next daemon start removes it after the age bound").

### Tests
- New `test/fs/temp-sweep.test.ts`: removes an exact-pattern regular file older than the bound and appends one audit line per removal (read `<stateDir>/audit/<session>.jsonl`); keeps a younger file; keeps `.hidden`, `.x.realm-tmp-<15 hex>`, `.x.realm-tmp-<16 uppercase hex>`, `x.realm-tmp-<16 hex>` (no leading dot) and `.realm-tmp-<16 hex>` (empty name); does not follow a symlink named like a temp file (target outside root keeps existing; the link itself is not a regular file, so it is left alone); does not enter a symlinked directory pointing outside the root; does not enter a directory on another device (use a bind of `/dev/shm` only if available, otherwise skip with a stated reason: INFERENCE that tmpfs is mountable without privilege in CI); a root that does not exist or is a file is skipped; an audit that throws leaves the file in place; `truncated` is set when `maxEntries` is 1; a root swapped for a symlink after `bindRoot` is refused (PATH_ESCAPE-class check) — model on `test/fs/toctou.test.ts` and `test/fs/root.test.ts`.
- Extend `test/fs/atomic-write.test.ts`: the exported `TEMP_NAME_PATTERN` matches the name the writer produces (take it from a stage hook that lists the directory at `after-temp-write`).
- `test/daemon/daemon.test.ts`: a startDaemon test beside `CLI-01: startDaemon runs the reap sweep before serving` (`:435-454`) that plants an aged orphan in `fixture.ws` and one in `<stateDir>/sessions`, starts, and asserts both are gone before the first status reply.

### Risks
- Deletion by name pattern in the user's workspace. A user file literally named `.x.realm-tmp-<16 hex>` is indistinguishable from an orphan; the requirement accepts this (exact match, age, owner, regular file).
- A configured root such as a home directory makes the walk long. Cost is bounded by the budget; the skip-list question (`node_modules`, `.git`) is an owner-visible deviation from "under each configured workspace root", so the recommendation is no skip list and rely on the bound. UNKNOWN: the size of real configured roots.
- TOCTOU between `lstat` and `unlink` can only remove a file whose name matches the pattern; no read of its content occurs.
- Other writers' orphans (policy documents under `<stateDir>/runtime`, the driver `seccomp` directory) are outside the requirement text. Adding them is one extra root each; recommend `<stateDir>/runtime` (cheap, same state dir) and leave the driver directory out (it is the driver process's, not the daemon's, and the daemon does not know its path).
- Phase 18 (per-project sessions) changes what "configured root" means (D5 i). Keep the function root-list based so Phase 18 can call it per session. Phase 19 does not touch it.

---

## Item 2. Audit reconciliation (CRASH-02) and the one catalogue code

### Current behaviour
- Line shape (`src/audit/log.ts:69-91`): `{at, sessionId, tool, outcome, phase?, path?, bytes?, sha256?, execSummary?}` after `redactValue`. `AuditOutcome = "ok" | ErrorCode` (`:18`). `AuditPhase = "admission" | "result"` (`:36`), optional. No call id and no sequence field. File `<stateDir>/audit/<sessionId>.jsonl`, `O_APPEND`, fsync per line, directory fsync when the call created the file (`:101-124`).
- Who writes pairs: file tools in `src/tools/workspace.ts:128-149` (`audited`: admission `outcome: "ok"` before, result `ok` with bytes and sha256 or the error code after; a failed append after execution throws `AUDIT_WRITE_FAILED` and does not roll back, `:10-15`), and the dispatcher for exec, status and retry in `src/tools/dispatch.ts:231-254` (admission, then result `ok` or the code; a non-`RealmError` throw writes no result line, `:247-250`). The key a pair shares: `tool`, `path` (file tools), `execSummary` (exec; present on both lines because `base` is reused, `dispatch.ts:236-241`).
- Calls may overlap (the dispatcher is async and only path locks serialise writes), so lines of two calls can interleave. Order-based pairing is unsafe; per-key counting is safe. (VERIFIED_BY_CODE_READING; the interleaving itself is INFERENCE)
- Phase 17 plans a correlation id on each `up` and tool call (`IMPROVEMENT-PROPOSALS.md:248`, success measure `:258`). When it lands the pairing key can become that id.

### Does an existing code fit?
No. Candidates read in `src/core/errors.ts`: `AUDIT_WRITE_FAILED` says "audit log could not be written; the tool call did not run" and is retryable (`:169-172`), which is false for a call that may have run. `WRITE_NOT_ATOMIC` and `TOOL_TIMEOUT` describe other events; `REALM_STOPPING` says the realm refuses new requests. So the owner's one allowed addition (D5) is needed.

Recommendation: code `AUDIT_OUTCOME_UNKNOWN`, `retryable: false`, reason: "The process ended before this call's result was recorded; whether the call took effect is unknown." Non-retryable because it only ever labels a historical line and must not invite a blind retry. gRPC status in `DRIVER_STATUS`: `status.INTERNAL` (same as `AUDIT_WRITE_FAILED`, `src/runtime/driver/grpc-status.ts:35`).

### Complete list of what enumerates the catalogue (adding one code, 29 to 30)
(VERIFIED_BY_EXECUTION: `git grep` of three rarely used codes and of `ERROR_CODES`/`ERROR_CATALOGUE`)
- `src/core/errors.ts`: header comment `:1-4` ("Exactly these 29 codes"), the `ERROR_CODES` tuple `:8-38`, the `ERROR_CATALOGUE` record `:60-181` (typed `Record<ErrorCode, ...>`, a missing key fails compilation).
- `src/runtime/driver/grpc-status.ts:8-38` (`DRIVER_STATUS`, typed `Record<ErrorCode, status>`, compilation fails without the new key).
- `test/core/errors.test.ts`: `EXPECTED_CODES` `:12-42` and its two count assertions `:85-86`, `:90`; the retryable partition lists `RETRYABLE_TRUE` (12) `:45-58` and `RETRYABLE_FALSE` (17) `:61-79` with counts at `:100-101` (new code goes to `RETRYABLE_FALSE`, 18); the test titles that spell "29" `:83`, `:89`.
- Automatically derived, no edit: `src/daemon/channel.ts:21`, `src/daemon/client.ts:37`, `src/daemon/ensure.ts:87`, `src/cli/main.ts:252` (all read `ERROR_CODES`); `test/runtime/driver/admission-and-status.test.ts:39-65` and `test/acp/agent.test.ts:275` loop over `ERROR_CODES`.
- Docs: no table enumerates the full catalogue. `docs/integration/runtime-decision.md:148-166` ("Catalogue extension (closure, 2026-10-22)") is the precedent and holds a stale count ("now holds 25 codes"); add a "Catalogue extension (Phase 14)" section there, with the new code, its retryable flag and what it replaces (nothing). `docs/specs/realm-spec.xml:325` lists the original codes and is read-only. `docs/policy-reference.md` needs no change. Phase 17 adds the TD-05 code the same way (30 to 31), so write the count tests so that the second edit is one line.

### Change (minimal)
1. Catalogue code as above (three files plus the test).
2. `src/audit/log.ts`: extend `AuditPhase` with `"reconciliation"` (`:36`) so a reconciliation line says what it is by its own field, not only by its code. Update the comment block `:34-35` and `runtime-decision.md:125-127` ("Audit: two lines per call (D-90)").
3. New `src/audit/reconcile.ts`: `reconcileAuditLogs(stateDir, options): { files: number; appended: number; failed: number }`.
   - Enumerate `<stateDir>/audit/*.jsonl`: `lstat` each, regular files only, stem must pass the same pattern as `SAFE_SESSION_ID` (`src/audit/log.ts:67`); a missing directory is zero work.
   - Read bytes (`readFileSync`), split with the exported `splitAuditLines` (`src/audit/anchor.ts:65-78`), `JSON.parse` each line inside a try that treats an unparseable line as ignorable (a torn admission means nothing ran, because the admission is appended before execution).
   - Key = `tool` + `\0` + `path ?? ""` + `\0` + `JSON.stringify(execSummary ?? null)`. For each key count lines with `phase === "admission"` (A) and lines with `phase === "result"` or `"reconciliation"` (C). For `A > C` append `A - C` lines through `appendAudit` with `phase: "reconciliation"`, `outcome: "AUDIT_OUTCOME_UNKNOWN"`, copying `tool`, `path`, `execSummary` (never `bytes` or `sha256`). Lines with no `phase` (the item 1 sweep lines, pre-stage lines) are ignored.
   - Idempotent by construction: after the append `A == C`, so a second run appends nothing (the success measure in `IMPROVEMENT-PROPOSALS.md:164`).
   - Per-file failure (for example `AUDIT_WRITE_FAILED`) is counted and reported by the caller, not fatal; reading a file larger than a cap (recommend 256 MiB) is skipped and counted, because the log has no rotation. (INFERENCE: no rotation, from the absence of any rename or truncate in `src/audit/`.)
   - Appending only through `appendAudit` keeps Phase 17's hash chain the single writer of the file; do not write bytes directly.
4. Torn tail (small, recommended): a crash mid-append can leave a last line with no `\n`; the next `appendAudit` would glue its line onto it. Handle it inside `writeAuditLine` (`src/audit/log.ts:101-124`): if the file is non-empty and its last byte is not `0x0a`, prefix the new line with `\n` in the same `writeSync`. This stays in `log.ts` so Phase 17's chain recovery owns one tail rule. Needs a test that appends to a file whose last line is truncated.
5. Wiring (plan E): call after the sweep, before `openGate()`, with the daemon's `stateDir`; before any dispatcher exists in this process (the single-owner precondition of `src/session/reap.ts:29-32` applies identically).

### Files
`src/core/errors.ts`, `src/runtime/driver/grpc-status.ts`, `src/audit/log.ts`, `src/audit/reconcile.ts` (new), `src/daemon/daemon.ts` (plan E), `docs/integration/runtime-decision.md`.

### Tests
- `test/core/errors.test.ts` (edits listed above).
- `test/audit/log.test.ts`: a `phase: "reconciliation"` entry round-trips; torn-tail append produces two valid lines.
- New `test/audit/reconcile.test.ts`: admission with no result gets one reconciliation line; a balanced pair gets none; two concurrent identical admissions with one result get exactly one; interleaved A1, A2, R2, R1 get none; a second run appends none; a pre-stage line and a sweep line are ignored; a symlinked audit file or directory is refused (model on `test/audit/log.test.ts:208-250`); a result with no admission is ignored; the new lines carry `outcome` `AUDIT_OUTCOME_UNKNOWN` and no `bytes`/`sha256`.
- Crash form of the success measure: write an admission through `appendAudit`, start the daemon (or call the reconciler on that state dir), assert one reconciliation line, start again, assert none (`test/daemon/daemon.test.ts`, plan E).
- Redaction: reconciliation copies `execSummary` already redacted; no test needed beyond the copy.

### Risks
- A lone admission can also come from a failed append (fsync failure after the line landed, `src/audit/log.ts:93-97`): nothing ran, yet it is labelled unknown. Conservative and acceptable; say so in the runtime-decision text.
- Reading the whole log at each start is O(size). The cap above bounds it.
- Phase 17 shares this file: it adds `seq` and `prev` to each line and must treat reconciliation lines as ordinary appended lines. Design the key function (`pairingKey(entry)`) as one exported function so Phase 17 can swap it for the correlation id.

---

## Item 3. `SessionStore.delete` directory fsync (CRASH-03)

### Current behaviour
`delete` (`src/session/store.ts:85-92`): `existsSync(dir)` guard, then `rmSync(join(bindRoot(dir).realPath, fileName), { force: true })` (`:91`) with no directory sync. `save` goes through `atomicWriteFile`, which fsyncs the directory (`:40`; `src/fs/atomic-write.ts:150-154`). The exported helper `syncDirectory(dir)` (`src/fs/atomic-write.ts:302-314`) opens with `O_RDONLY|O_DIRECTORY|O_NONBLOCK`, fstats, fsyncs; an open failure or non-directory is `PATH_ESCAPE`, an fsync failure is a raw Node error. `syncDirectory` is currently used only by tests (`test/fs/atomic-write.test.ts:24`). Callers of `delete`: `src/session/reap.ts:37` and `src/lifecycle/controller.ts:436`. `bindRoot` is imported already in `store.ts:16`.

### Change
In `delete`, after the `rmSync`, call `syncDirectory(realPath)` (import from `../fs/atomic-write.js`, already imported at `store.ts:14`). Convert an fsync failure into a `RealmError` instead of a raw Node error: recommend `new WriteNotAtomicError(true)` semantics (`WRITE_NOT_ATOMIC`, "replaced but durability not confirmed"), because a raw error from `reapStartup` reaches `abortStart` and the daemon entry prints `realm daemon: SCHEMA_INVALID` for it (`src/daemon/daemon.ts:499-508`, `src/daemon/main.ts:169-171`). The existing message text of `WriteNotAtomicError(true)` says "The file was replaced"; either accept it or give the class a delete-specific message (decision for the planner; the code stays `WRITE_NOT_ATOMIC`). Syncing even when the record was absent is harmless and keeps the "absent record is a no-op" test (`test/session/store.test.ts:105`) true.

### Files
`src/session/store.ts`.

### Tests
Extend `test/session/store.test.ts` (next to `:105`): with an fsync spy, `delete` of an existing record records a directory fsync after the unlink and `delete` of an absent record throws nothing. The spy pattern to copy is `spyOnFsync` with `syncBuiltinESMExports()` in `test/audit/log.test.ts:312-331`; put the copy in a new `test/support/fsync-spy.ts` rather than editing `log.test.ts` (keeps plan files disjoint; a later cleanup can point `log.test.ts` at it). Also a failing-fsync case asserting a `RealmError` with the chosen code. `test/session/reap.test.ts` needs no change (it uses real files).

### Risks
Per-record fsync during a reap of N records costs N directory fsyncs; N is tiny. A failure here now stops the daemon start (before the gate opens); that is the intended fail-closed behaviour and is the same as `save`.

---

## Item 4. Startup reap logging and the status-read notice (CRASH-04)

### Current behaviour
- `await reapStartup({ store, sweep })` result is dropped (`src/daemon/daemon.ts:543`). `ReapResult = { containersRemoved, recordsDeleted }` (`src/session/reap.ts:19-22`, built `:39`). `removeAllRealmContainers` returns only a count (`src/runtime/sweep.ts:33-53`; the ids are in the local `found` list, `:34`). `StartDaemonOptions.sweep` is `() => Promise<number>` (`daemon.ts:121`); the same function is also called by the driver (`src/runtime/driver/lifecycle.ts:133`). Test injections of `sweep`: `test/daemon/client.test.ts:243`, `daemon-health.test.ts:152`, `daemon.test.ts:100,462,786,846`, `e2e.test.ts:120`; `test/session/reap.test.ts` (7 call sites) and `test/runtime/sweep-timeout.test.ts` use the real function. (VERIFIED_BY_EXECUTION: `git grep`)
- A detached daemon's stderr goes to `<stateDir>/daemon.log` (`docs/integration/runtime-decision.md:185`); the entry writes failure lines with `writeStderr` (`src/daemon/main.ts:72-104`, `writeLine` `:177-179`). There is an observer precedent in `StartDaemonOptions.onHealthProbeFailure` (`daemon.ts:124`, used `:254`).
- Status flow: daemon `status` and `up` replies are `statusResult(snapshot, mode)` = `{snapshot, display, mode}` (`daemon.ts:551-560`, used `:379`, `:403`, `:343`, `:365`). The client type is `DaemonStatus extends StatusValue { mode }` and the guard `isDaemonStatus` ignores extra fields (`src/daemon/client.ts:19-21`, `:77-79`). `realm status` prints the whole control reply result as JSON (`src/cli/main.ts:403-407`, `replyToResult` `:222-228`). The MCP and ACP `status` tool returns `StatusValue = {snapshot, display}` from the dispatcher, a different shape (`src/tools/dispatch.ts:76-79`, `:198-204`). The state after a reap is `unbound`, whose display reason is fixed text (`src/core/status.ts:32-36`, `:46-51`), so the reason cannot carry a notice. The Omp attach path is `attachDaemon` (ensure then `up`, `src/omp/extension.ts:20-48`) followed by `client.status()` (`src/omp/plugin.ts:238-240`), painted by `renderRealmStatus` (`:138-150`); `ctx.ui.notify(message)` already exists and is used (`:433`, `:448`). `check:mcp` compares only `snapshot` and `display` of MCP status with `realm status` (`scripts/check/mcp-smoke.mjs:37-57`), so an extra field does not break it. (VERIFIED_BY_CODE_READING)

### Options for the notice (no new tool-contract field is needed in any of them)
| Option | What changes | Touches | Verdict |
|---|---|---|---|
| N1. Log line only | one stderr line to `daemon.log` | `src/daemon/daemon.ts`, `src/daemon/main.ts` | Meets "log", not "notice on next attach". Needed anyway. |
| N2. Optional `notice` string on the daemon `status` and `up` reply (and `down`, one helper) | `statusResult` adds `notice` only when something was destroyed; `DaemonStatus.notice?: string`; guard validates it as a string | `src/daemon/daemon.ts:551`, `src/daemon/client.ts:19,77`; no change to `src/daemon/channel.ts` (reply result is `unknown`); not the frozen tool contract, not the session-record schema, not `StateSnapshot` (`src/core/state-machine.ts:12-16`). Precedent: `mode` was added the same way (`runtime-decision.md:178`). | Recommended. |
| N3. Put text in the snapshot `reason` | would need the `unbound` and `connecting` display reasons (fixed, `src/core/status.ts:32-36`, `:46-51`) or the `active` reason ("container running", `src/lifecycle/controller.ts:297`) to carry it | `src/core/status.ts` (frozen display mapping), controller tests that pin reasons, plugin text tests | Rejected: changes a frozen mapping or muddles `reason`. |
| N4. Notice in a state-directory file read by clients | new file protocol | every client | Rejected: second channel, extra I/O. |

Delivery with N2: daemon keeps the notice for its lifetime (no consume-on-read: Omp's `attachDaemon` already calls `up` before `status()`, so a one-shot on `up` would be consumed before the plugin could show it). `realm status` and `realm up` show it with no CLI code change (JSON). Omp: in `attach` (`plugin.ts:262-265`), after a successful attach call `ctx.ui.notify(notice)` once per attach when `attached.status.notice` is set. MCP and ACP attach: `runMcp` and `runAcp` (`src/cli/main.ts:473-479`, `:502-510`) hold the `up` reply and can write the notice to `deps.diagnostics`/stderr. Notice text is fixed text built from counts, for example `a previous daemon's sandbox was destroyed at startup (<n> container(s), <m> session record(s)); state outside the workspace was lost`. Only present when `containersRemoved > 0 || recordsDeleted > 0`.

### Change
1. Container ids. Recommended: additive optional callback, `removeAllRealmContainers(libpod, onRemoved?: (id: string) => void)` (`src/runtime/sweep.ts:33`), called after each successful `removeContainer`; the daemon's default sweep closure collects ids. No signature change for `ReapDeps.sweep`, the 7 injections and the driver caller (`lifecycle.ts:133`). Alternative (rejected for now): change the return type to the id list; it touches about 20 call sites and tests and Phase 19 rewrites the reaper's result anyway (adopt versus remove).
2. `startDaemon` keeps the `ReapResult`, builds `{ containerIds, containersRemoved, recordsDeleted, tempFilesRemoved, auditLinesReconciled, truncated, failures }` and passes it to a new observer `onStartup?: (report) => void` in `StartDaemonOptions` (`daemon.ts:107-131`), which must not throw (same contract as `onHealthProbeFailure`). `runDaemon` wires it to `writeStderr` with one line, for example `realm daemon: startup removed 1 container(s) [<id>] and 2 session record(s); removed 1 orphan temp file(s); reconciled 0 audit admission(s)` (`src/daemon/main.ts:83-94`). Container ids are not secrets. Phase 17's structured logger will replace the line format; keep the report object as the stable seam.
3. N2 as above.

### Files
`src/runtime/sweep.ts`, `src/session/reap.ts` (comment only; header says reap is silent), `src/daemon/daemon.ts`, `src/daemon/main.ts`, `src/daemon/client.ts`, `src/omp/plugin.ts`, `src/cli/main.ts`, docs `docs/integration/runtime-decision.md` (add near `:178`) and `docs/integration/omp.md` (status text and notify).

### Tests
- `test/runtime/sweep.test.ts`: `onRemoved` receives each removed id, none on a clean host.
- `test/daemon/daemon.test.ts`: injected sweep plus a planted record; `onStartup` receives counts; status reply carries `notice`; with nothing reaped the reply has no `notice` key (existing deepEqual tests such as the status reply at `:697-715` keep passing).
- `test/daemon/client.test.ts`: `status()` accepts a reply with `notice`, rejects a non-string `notice` with `SCHEMA_INVALID` (model on `:100-110`).
- `test/daemon/main.test.ts`: the `start` fake invokes `onStartup`; `lines` holds the single stderr line (harness `:57-88`). The existing test at `:108-133` does not assert the full start options, so an added `onStartup` option does not break it.
- `test/omp/plugin.test.ts`: attach with a status carrying `notice` calls `ui.notify` once (the test UI already records `notify`, `:75`); without it no call.
- `test/cli/cli.test.ts` / `test/cli/mcp-attach.test.ts`: `realm status` prints the notice in JSON; `mcp`/`acp` attach writes it to diagnostics.
- `test/session/reap.test.ts`: unchanged unless `ReapResult` changes (it does not in the recommended shape).

### Risks
Phase 19 rewrites `reapStartup` (D5 ii); the notice text must then say "adopted" as well as "removed". The report object absorbs that. Phase 17 logger replaces the stderr line. Both touch `daemon.ts:542-548`, so plan E should keep the startup block in one function (`runStartupMaintenance(...)`), which later phases edit in one place.

---

## Item 5. Real-SIGKILL tests (CRASH-05)

### Current behaviour
- The child-process pattern is `runChild` (`test/fs/atomic-write.test.ts:71-81`, spawnSync of `process.execPath --input-type=module -e <script>` with payload in `REALM_CHILD_PAYLOAD`, module imported by `new URL("../../src/fs/atomic-write.js", import.meta.url).href`, `:167-168`, `:189-190`). It asserts `run.signal === null` and `status === 0`, so it cannot be reused for a killed child. Exception-injection tests for the four stages are `:112-134` (`STAGES` `:31`). `test/audit/log.test.ts:268-282` uses `killSignal: "SIGKILL"` only as a timeout guard.
- Hooks: `AtomicWriteStage` (`src/fs/atomic-write.ts:34`): `after-temp-write` (`:194`), `after-fsync` (`:196`), `before-rename` (`:197`), `after-recheck` (`:202`); all precede `renameSync` (`:203`); no hook exists after it.
- The L6a helper (runbook appendix) runs the child per stage with `process.kill(process.pid, "SIGKILL")` from the hook and observed the outcome in the proposals: target old, one orphan holding the new content, later clean write leaves it.

### Change
New test file `test/fs/atomic-write-sigkill.test.ts`, one test per stage (loop over the same four stage names), each in its own temp directory (`realpathSync(mkdtempSync(...))`, `t.after` removal):
1. Write target with `ORIGINAL`; compute `sha256Hex(ORIGINAL)`.
2. `spawnSync(process.execPath, ["--input-type=module", "-e", CHILD, <args>], { timeout: 30_000, encoding: "utf8" })` where CHILD imports `atomicWriteFile` from the file URL and kills itself at the chosen stage. Assert `run.error === undefined`, `run.signal === "SIGKILL"`, `run.status === null`, and that stdout does not contain "completed".
3. Parent asserts the target bytes equal `ORIGINAL`; exactly one entry matches `TEMP_NAME_PATTERN`, named `.target.txt.realm-tmp-<16 hex>`, and its content is the new content.
4. Run `sweepOrphanTempFiles([dir], { minAgeMs: 0, now, ownerUid: process.getuid(), audit })` and assert zero temp files remain, the audit callback saw one removal with that path, and the target is still `ORIGINAL`.
5. A control case with no kill leaves no temp file and the new content; a second case runs the sweep with the production age bound (`60_000`) on a fresh orphan and asserts it is kept (age bound).
Kill after the rename cannot be hooked (no stage); do not add a fifth stage (the requirement names four). The post-rename outcome stays INFERENCE from `rename(2)` atomicity; say so in the test comment, as the proposals do.

### Files
`test/fs/atomic-write-sigkill.test.ts` (new); depends on `src/fs/temp-sweep.ts` (item 1). The runbook appendix text (`docs/integration/omp-lifecycle-runbook.md:86`) is updated in the same plan as item 1.

### Tests
This item is the tests. The success measure (`IMPROVEMENT-PROPOSALS.md:164`): original bytes intact, one orphan present, zero orphans after the next sweep, for each of the four stages.

### Risks
SIGKILL timing under the loaded host: the child is self-terminating at a deterministic hook, so no race; keep the 30 s guard. `process.getuid` exists on Linux (the only verified platform). Test runs from `dist/test/fs`, so the URL resolves to `dist/src/fs/...`.

---

## Item 6. TD-01: carry the refusal cause code across the daemon (CRASH-06)

### Current behaviour (VERIFIED_BY_CODE_READING)
- `ToolOutcome` refused variant: `{ outcome, tool, code, retryable }`, no cause (`src/tools/dispatch.ts:90-95`). `ToolDispatcher.call` catches a `RealmError` and returns `refused(tool, error.code)` (`:125-128`); `refused` builds the shape (`:257-259`). The cause code on the caught error (`RealmError.causeCode`, `src/core/errors.ts:186-205`) is dropped. Producers of a cause: `makeRealmError(error.code, cleanup)` and `WriteNotAtomicError(false, cleanup)` in the atomic write (`src/fs/atomic-write.ts:210,212`, cause `CLEANUP_FAILED`) reaching the dispatcher through `lockedWrite`; `canonicalize`'s `CLEANUP_FAILED` causes; any controller error thrown through the retry tool. Exec cannot carry one (`runSandboxExec` throws a bare `REALM_NOT_ACTIVE` or `TOOL_TIMEOUT`, `src/runtime/session-execution.ts:698-703`).
- Daemon `tool` method: a refused outcome becomes `{ id, error: { code: outcome.code } }` (`src/daemon/daemon.ts:417-420`), a thrown `RealmError` goes through `refusalReply`, which does carry the cause (`:567-572`). The channel encodes and decodes `causeCode` already (`src/daemon/channel.ts:75-77`, `:174-179`, `:210-223`). The client throws `makeRealmError(code, causeCode)` (`src/daemon/client.ts:125-127`); its `isToolOutcome` guard knows only `tool`, `code`, `retryable` for a refused outcome (`:81-99`).
- Surfaces over the daemon: `realm mcp` passes the daemon client as the dispatcher (`src/cli/main.ts:479`, `createMcpServer(client, ...)`), `realm acp` passes `{ call: (tool) => client.call(tool) }` (`:516`). A thrown `RealmError` becomes MCP `toolErrorResult` = `{code, message, retryable, causeCode?}` with `isError` (`src/mcp/server.ts:212-215`, `src/mcp/protocol.ts:104-114`) and an ACP JSON-RPC error with `data: {code, retryable, causeCode?}` (`src/acp/agent.ts:194-199`, `:95-102`). In process the dispatcher's refused outcome is returned as the result: MCP `structuredContent` and ACP `result` are the outcome itself (`src/mcp/protocol.ts:94-100`).
- So the surfaces already forward a `causeCode` when the daemon client throws one. The missing links are exactly two: the dispatcher drops it, and the daemon drops it from the refused outcome. `test/daemon/client.test.ts:261-283` proves the client-and-surface half for a *thrown* error; the dispatcher-to-daemon half is untested.

### Design of the wire change
Recommended (smallest, no channel or contract-schema change):
1. Dispatcher: add `readonly causeCode?: ErrorCode` to the refused variant (`dispatch.ts:90-95`); `refused(tool, code, causeCode?)` includes the key only when defined (`exactOptionalPropertyTypes`); `call` passes `error.causeCode` at `:127`. An additive optional field: in-process MCP and ACP then show it automatically (the outcome is serialised whole).
2. Daemon `tool` case (`daemon.ts:418-420`): reply `{ id, error: outcome.causeCode === undefined ? { code } : { code, causeCode } }`. Nothing else: the channel, client throw, MCP and ACP renderers already carry it.
3. Client guard `isToolOutcome` (`client.ts:85-94`): accept an optional `causeCode` that is a known code, so the type and the guard agree (the daemon no longer sends a refused outcome as a result, but the type is shared and the guard is used for results).
4. Equivalence: the shapes still differ between in-process (outcome carries `causeCode`) and daemon (MCP `structuredContent.causeCode`, ACP `error.data.causeCode`); the first sentence of TD-01 (MCP `isError` result versus ACP error) stays as it is. The requirement CRASH-06 asks for the same *cause code* in both; do not unify shapes in this phase. Alternative (not recommended now): the daemon answers a refused outcome as a normal result (`{id, result: outcome}`), which makes the daemon path byte-equal to in-process; `isToolOutcome` already accepts a refused result and `test/daemon/client.test.ts:140-149` already expects "a refusal as a resolved outcome". It changes what hosts see over the daemon (live-proven shapes in `docs/integration/acp.md:70` and `mcp.md:92`), so it needs an owner decision. Record it as an open decision.

### Files
`src/tools/dispatch.ts`, `src/daemon/daemon.ts` (tool case only), `src/daemon/client.ts` (guard).

### Tests and docs that pin the result shape (all must be re-checked; none changes unless a cause code is present)
- Update: `test/daemon/daemon.test.ts:651-677` ("a refused outcome answers its catalogue code and no other field"): keep the no-cause case and add one with `causeCode` expecting `{ id, error: { code, causeCode } }`; `test/daemon/client.test.ts:140-149`, `:183` (invalid code rejected), `:300-316` (refused outcome rejects with no `causeCode` property; add a cause case).
- Pins that must stay green: `test/acp/agent.test.ts:267,292-296,368,454-456`; `test/mcp/server.test.ts:340,367`; `test/cli/mcp-attach.test.ts:102,153`; `test/cli/cli.test.ts:93`; `test/realm/compose.test.ts:115`; `test/tools/dispatch.test.ts` (refusals); `test/support/fake-tools.ts:237` (`refusal` helper builds the exact shape); `test/surfaces/equivalence.test.ts:152-201` (deepEqual against objects without a cause: unchanged).
- New: in `test/tools/dispatch.test.ts`, a retry call whose controller `create` rejects with `makeRealmError("OPENSHELL_START_FAILED", "PODMAN_MACHINE_DOWN")` returns `{outcome:"refused", tool:"retry", code, retryable, causeCode}` and a no-cause rejection returns no `causeCode` key. This needs a small option in `test/support/fake-tools.ts` (`HarnessOptions.create?: (root) => Promise<StateSnapshot>`, used where the harness defines `create`, `:186-189`), because exec and status cannot raise a cause.
- New `test/surfaces/daemon-equivalence.test.ts` (beside `equivalence.test.ts`): start a real daemon with the fakes (copy the local helper `startRealDaemon`, `test/daemon/client.test.ts:222-258`), replace `daemon.handle.dispatcher.call` as the existing tests do (`client.test.ts:263-268`) with a function returning a refused outcome that carries `causeCode: "PODMAN_MACHINE_DOWN"`; drive `createMcpServer(connectDaemon(socket), ...)` and `runAcpAgent({ dispatcher: { call: (t) => client.call(t) }, ... })` (driver code from `equivalence.test.ts:27-119`); extract the cause from MCP `structuredContent.causeCode` and ACP `error.data.causeCode`; assert both equal the in-process value from the same dispatcher answered through MCP and ACP in process (`structuredContent.causeCode` and `result.causeCode`), and that a refusal without a cause has no `causeCode` anywhere.
- Docs: `docs/integration/runtime-decision.md:176` ("Tool method ... reply is the tool outcome or a catalogue code"), `docs/integration/mcp.md:92` (the sentence that the outcome "is unchanged"), `docs/integration/acp.md:70` (the equality claim), comment at `src/mcp/protocol.ts:92-93` ("ToolOutcome itself is unchanged: it is the frozen contract"). State that `causeCode` is additive and optional.

### Risks
The dispatcher outcome is described as the frozen tool contract in the MCP comment and doc; an optional field is additive, but the owner should see it named (it is in CRASH-06 by name). `tools.schema.json` covers only inputs (VERIFIED_BY_EXECUTION: `src/contract/tools.schema.json` is 2.7K and the outcome type lives in `dispatch.ts`); no schema file changes. The audit result line records only the code, not the cause (`dispatch.ts:248`); not in scope.

---

## Item 7. TD-04: retry when the recorded container is gone (CRASH-07)

### Current behaviour (VERIFIED_BY_CODE_READING)
- Rule: "A stored containerId means no second create" (`src/lifecycle/controller.ts:156`). In `create` the prior id comes from the record (`:193-194`), is kept as `containerId` (`:211`), the port create is skipped when it is non-null (`:225`), and the start is issued for it (`:259-265`).
- Start of a missing container: `SessionExecution.start` inspects it and throws `OPENSHELL_START_FAILED` when `inspect === null` or it is not running (`src/runtime/session-execution.ts:271-278`); a raw error from any port is mapped to the same code (`controller.ts:31-38`).
- Failure handling: `failCreate` (`:508-533`): a `RealmError` moves to `error` with its code as reason, persists the same `containerId` again, and returns the snapshot; a non-`RealmError` also persists it, then throws `OPENSHELL_START_FAILED`. The stale id stays recorded, so every retry repeats it. `destroy` (`:417-439`) is the only way to clear it, reached by `realm down`. How the session gets there: a probe on a removed container returns "unhealthy" (`session-execution.ts:283-290`) and the controller moves to `error` (`controller.ts:358-360`); `retry` and `up` then call `create` (`dispatch.ts:210-225`, `daemon.ts:402`).
- Existing coverage: `test/lifecycle/controller.test.ts:135-170` (retry after a start failure reuses the stored container, `PODMAN_MACHINE_DOWN`), `:193-201` (raw start failure keeps the id), `test/lifecycle/idempotent.test.ts:119-130` (start from error reuses it). No test removes the container. The fake: `test/support/fake-execution.ts` (`destroy` removes the resource and `start` on a missing id throws a raw `Error`, `:83-91`, `:66-70`, `:145-151`, which the controller maps to `OPENSHELL_START_FAILED`).

### Change (minimal; no port change)
In `create`, when the container being started is the *recorded* one (`containerId === priorContainerId`, so no create ran in this call) and its start fails with `portFailureCode(error) === "OPENSHELL_START_FAILED"`, recover once:
1. `await withTimeout(this.deps.exec.destroy(containerId, this.sandboxName()), remaining, "STARTUP_BUDGET_EXCEEDED")` (destroy of an already gone container is success, `session-execution.ts:303-307`, `:358-370`; it also deletes the gateway sandbox name, so the new create does not hit `SANDBOX_NAME_IN_USE`).
2. `this.persist(realmId, root, null)` (record before create, RT-07), set `containerId = null`, and run the existing create-then-start path once more. Allow exactly one recovery per `create` call (no loop): a second `OPENSHELL_START_FAILED` goes to `failCreate` as today.
3. Do not recover for any other code. `AGENTOS_CRASH_LOOP` (runner dead in a live container) must keep the container, because `/realm-retry` recovers it in place (`docs/integration/omp.md:160` per the findings). A destroy failure goes to `failCreate` with its own code and the old id stays recorded.
Structure: extract the create-and-start block (`:225-265`) into a private method taking a flag so the recovery is a second call, rather than a nested loop; keep the new logic in one private method (`recoverStaleContainer`). Update the doc comment at `:154-159` ("A stored containerId means no second create, except ... start fails with OPENSHELL_START_FAILED: that container is destroyed once and a new one is created").

### Files
`src/lifecycle/controller.ts` (also touched by Phase 18 and 19: keep the change in one private method).

### Tests (controller, with the fakes in `test/support/`)
New file `test/lifecycle/stale-container.test.ts` using the `fixture` pattern of `test/lifecycle/controller.test.ts:40-72` (copy; the helper is file-local), or add to `controller.test.ts` after `:170`:
- Removed container reaches `active` on retry: `create` to active; remove the container behind the controller's back with `exec.destroy(oldId, "realm-session-1")`; `controller.probe()` (moves to `error`; it throws `OPENSHELL_START_FAILED` for the fake's raw error, `controller.test.ts:203-211`, so assert with `assertRejectsWith`); `controller.create(workspace)` returns `state: "active"`; `store.load(SESSION).containerId` is a new id different from the old; `exec.callCount("create") === 2`; `exec.resources().length === 1`; call order shows destroy before the second create.
- `up`-style retry from a `create` that failed at start with `OPENSHELL_START_FAILED` on a recorded id reaches active in one call (not two).
- No loop: if the new container's start fails with `OPENSHELL_START_FAILED` too (`exec.failNext("start", ...)` armed after the destroy), the call ends in `error`, exactly one destroy and two creates in total.
- Destroy failure: `exec.failNext("destroy", "AGENTOS_STOP_FAILED")` gives `error` with that code and the old id still recorded; no create.
- Non-recovery: start failing with `PODMAN_MACHINE_DOWN` or `AGENTOS_CRASH_LOOP` on a reused id still reuses it (existing `:158-170` stays green) and issues no destroy.
- Fresh create whose first start fails with a raw error (existing `:193-201`) stays unchanged (`priorContainerId` is null).
- Budget: recovery respects `startupBudgetMs` (model on `startup-budget.test.ts`).
Also re-run `create-interrupt.test.ts`, `teardown-failures.test.ts`, `idempotent.test.ts`, `test/omp/plugin.test.ts`, `test/realm/compose.test.ts` (INFERENCE that none retry a stored id after `OPENSHELL_START_FAILED`; not checked test by test).

### Risks
A container that is merely stopped (not gone) also fails start with the same code and is now recreated; its AgentOS state was already lost with the runner, and the workspace is a host bind so no file is lost (`ABRUPT-END-PERSISTENCE-FINDINGS.md` A3). The distinction gone-versus-stopped is not available from the port (no cause code on that throw); adding one needs a catalogue change and is out of scope. Phase 19 (adopt a surviving container) interacts: it adds an adopt path before this one; keep recovery as the fallback when adoption is refused.

---

## Contract and doc impact

Frozen contracts touched (each named, with what changes):
1. Error catalogue: one added code (`AUDIT_OUTCOME_UNKNOWN`), approved by D5 (`.planning/MILESTONE-CONTEXT.md:17`). Enumerating files: `src/core/errors.ts`, `src/runtime/driver/grpc-status.ts`, `test/core/errors.test.ts` (item 2). Nothing else lists codes by hand.
2. Audit line format (D-42, one-way): new `phase` value `"reconciliation"` and new `tool` value `"temp-sweep"` (lines with no `phase`). Documented in `docs/integration/runtime-decision.md:125-127`; test `test/audit/log.test.ts`.
3. `ToolOutcome` refused variant: optional `causeCode` (additive), plus the daemon `tool` error reply now carrying it (the channel already allows it). Documented in `runtime-decision.md:176`, `mcp.md:92`, `acp.md:70`.
4. Control `status`/`up`/`down` replies: optional `notice` (additive, like `mode`, `runtime-decision.md:178`). Not the tool contract, not `StateSnapshot`, not the session record, not the policy schema.
Not touched: `ExecutionService` port (`src/core/ports.ts`, TD-04 uses `destroy` and `create`), session-record schema and field set, `tools.schema.json`, display mapping (`src/core/status.ts`), state table, `docs/specs/realm-spec.xml`.

Docs to update in the same PR as their code (AGENTS.md "Update the docs in the same pull request"):
- `docs/integration/runtime-decision.md`: Catalogue extension (Phase 14), audit phase value and temp-sweep lines, the reaper report and notice, TD-01 tool-method sentence, TD-04 recovery rule.
- `docs/integration/omp-lifecycle-runbook.md` section D (`:84-86`) and the appendix expectation ("later clean write leaves that orphan in place").
- `docs/integration/mcp.md:92`, `docs/integration/acp.md:70`, `docs/integration/omp.md` (notice via `notify`).
- `AGENTS.md` layout bullets for `fs/` and `audit/` (new `temp-sweep.ts`, `reconcile.ts` are new paths, "a new or moved path is a layout change"); `CLAUDE.md` imports it.
- `CHANGELOG.md`, versions: release job only. `.planning/*`: GSD only.

## Dependency order between the items
- 2 (catalogue code and reconciler) and 1 (sweep) are independent libraries; both are called from the same startup block (plan E).
- 5 needs 1.
- 3 and 7 are independent of everything.
- 6 dispatcher half is independent; the daemon half and the client guard edit `daemon.ts` and `client.ts`, which item 4 also edits, so 6 precedes 4 (or share a plan).
- 4 (log, notice) needs the reports of 1, 2 and the reap, so it comes last; its option `onRemoved` needs `runtime/sweep.ts` only.
- Later phases: 17 builds on item 2 (appended lines inside the hash chain; swap the pairing key for the correlation id; second catalogue code, count tests become 31) and on the `onStartup` report seam; 18 reuses `sweepOrphanTempFiles(roots)` per project and the per-file `audit/*.jsonl` enumeration (if audit files move per project the reconcile enumeration moves with them), and edits `controller.ts`/`daemon.ts`; 19 rewrites `reapStartup`/the reap report and the notice wording and sits next to the item 7 recovery in `controller.ts`.

## Suggested plan slicing (5 plans, 2 waves, file-disjoint)

Wave 1 (parallel; no shared files):
- **14-01 Orphan sweep library and real-SIGKILL tests** (CRASH-01 library, CRASH-05). Files: `src/fs/atomic-write.ts`, `src/fs/temp-sweep.ts` (new), `test/fs/temp-sweep.test.ts` (new), `test/fs/atomic-write.test.ts` (pattern test only), `test/fs/atomic-write-sigkill.test.ts` (new), `docs/integration/omp-lifecycle-runbook.md`.
- **14-02 Audit reconciliation library and catalogue code** (CRASH-02 library). Files: `src/core/errors.ts`, `src/runtime/driver/grpc-status.ts`, `src/audit/log.ts`, `src/audit/reconcile.ts` (new), `test/core/errors.test.ts`, `test/audit/log.test.ts`, `test/audit/reconcile.test.ts` (new).
- **14-03 Controller recovery and durable record deletion** (CRASH-07, CRASH-03). Files: `src/lifecycle/controller.ts`, `src/session/store.ts`, `test/lifecycle/stale-container.test.ts` (new) or `test/lifecycle/controller.test.ts`, `test/session/store.test.ts`, `test/support/fsync-spy.ts` (new).
- **14-04 Cause code across the daemon** (CRASH-06). Files: `src/tools/dispatch.ts`, `src/daemon/daemon.ts` (tool case, lines 417-420 only), `src/daemon/client.ts` (`isToolOutcome`), `test/support/fake-tools.ts`, `test/tools/dispatch.test.ts`, `test/daemon/daemon.test.ts` (the `:651-677` test), `test/daemon/client.test.ts` (refused-outcome tests), `test/surfaces/daemon-equivalence.test.ts` (new), `docs/integration/mcp.md`, `docs/integration/acp.md`, comment in `src/mcp/protocol.ts`.

Wave 2 (after wave 1 lands; one plan owning the startup block and the notice):
- **14-05 Startup maintenance wiring, reap log and notice** (CRASH-01 wiring, CRASH-02 wiring, CRASH-04). Files: `src/daemon/daemon.ts` (policy loaded once, sweep roots, `runStartupMaintenance`, `onStartup`, `notice` in `statusResult`), `src/daemon/main.ts`, `src/daemon/client.ts` (`DaemonStatus.notice`), `src/runtime/sweep.ts` (`onRemoved`), `src/session/reap.ts` (comment), `src/omp/plugin.ts` (notify on attach), `src/cli/main.ts` (mcp/acp attach diagnostics), tests `test/daemon/daemon.test.ts`, `test/daemon/client.test.ts`, `test/daemon/main.test.ts`, `test/runtime/sweep.test.ts`, `test/omp/plugin.test.ts`, `test/cli/cli.test.ts`, `test/cli/mcp-attach.test.ts`, `AGENTS.md`, `docs/integration/runtime-decision.md` (all of this phase's decision text, including the catalogue extension, the audit phase value and the tool-method line, so no other plan edits it), `docs/integration/omp.md`.
Wave 1 plans share no file (checked against the lists above; `daemon.ts`, `client.ts` and both daemon test files appear only in 14-04 in wave 1 and in 14-05 in wave 2).

## Open decisions for the planner (recommendation first)
1. Sweep roots: `policy.workspaceRoots` plus `<stateDir>/sessions` (the requirement), plus `<stateDir>/runtime` (recommended, same writer). No skip list. Age bound 60 s, budget 15 s, entry cap 500 000.
2. Sweep audit entries: `tool: "temp-sweep"`, no `phase`, bytes recorded, no sha256, audit before unlink.
3. Reconciliation: new code `AUDIT_OUTCOME_UNKNOWN` (non-retryable, `INTERNAL`), `phase: "reconciliation"`, counting by `(tool, path, execSummary)`, torn-tail fix inside `appendAudit`.
4. Notice: option N2 (`notice` on daemon status and up replies, lifetime of the daemon, shown by Omp through `ui.notify` and by `realm status` as JSON).
5. Container ids: `onRemoved` callback on `removeAllRealmContainers`, not a return-type change.
6. TD-01: carry `causeCode` only (dispatcher field plus daemon error reply); the shape unification of the daemon path is not done and is recorded as a separate owner decision.
7. Delete durability error: `WRITE_NOT_ATOMIC` from the directory-sync failure, with or without a delete-specific message.

## Unknowns
- Size of real configured workspace roots (bounds the sweep cost).
- Whether any test other than the ones listed retries a stored container id after `OPENSHELL_START_FAILED` (item 7 check list is by name, not exhaustively verified).
- Whether `/dev/shm` or another second device is available to the test host for the cross-device skip test.
- Whether the real `removeContainer` ids returned by libpod listing are the same strings `reap` and the session record use (the sweep lists by label, `src/runtime/sweep.ts:57-62`, and removes by `container.id`).

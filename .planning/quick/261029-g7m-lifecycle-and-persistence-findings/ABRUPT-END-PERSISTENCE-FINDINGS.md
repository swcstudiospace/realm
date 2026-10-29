# Abrupt-end persistence findings: are files kept and recoverable when a session ends abruptly?

Quick task 261029-g7m, 2026-10-29. Repository at main 00e0003 (release v0.2.2); live checks on the installed build 0.2.1 (code identical). Evidence labels are those of `SANDBOX-LIFECYCLE-FINDINGS.md`: VERIFIED_BY_CODE_READING, VERIFIED_BY_EXECUTION (record sections L1 to L9 in `LIVE-VERIFICATION.md`), UNVERIFIED. Paths are repository-relative.

## 1. Answer per state class

"Abrupt" means the process dies with no shutdown hook: SIGKILL, an out-of-memory kill, a crash, or a closed terminal (SIGHUP, which Omp survives only as far as its own handler runs).

| State class | Persisted? | Data-loss window | Recovery on the next start |
|---|---|---|---|
| **A1.** Files written by Omp's own `write` and `edit` into the workspace | **Partially.** A completed write survives the death of Omp, the daemon and the container, because it is a plain file on the host (L7, L5). It is not synced: no `fsync`, no temp file, no rename (L6b). | Process death: from the `open` to the `close` of the write, which is a single `write` plus `ftruncate`. A kill between them while the file is being shortened leaves the new content followed by the old tail (INFERENCE from the observed order). Machine death: everything since the last writeback. | none. Nothing detects a torn file |
| **A2.** Files written through Realm's tools (MCP `write`, ACP `_realm/tool`) | **Yes.** Temp file, `fsync`, prior-hash check, rename, directory `fsync` (`src/fs/atomic-write.ts:177-203`, `:149-153`). The target is always old or new, never torn: a kill at any of the four hookable stages, all of which fire before the rename, left the old content (L6a); a kill after the rename leaves the complete new file by the atomicity of `rename(2)` (not run, INFERENCE). | Process death: none for content; a kill before the rename leaves one complete orphan temp file (L6a). Machine death: none after the call returned; `WriteNotAtomicError(replaced)` if the directory sync fails (`:49-52`). | the orphan temp file is never removed (G2) |
| **A3.** Files written by processes inside the sandbox to `/workspace` | **Yes**, as host files: the sandbox binds the pinned host directory read-write (`src/runtime/driver/sandbox-binding.ts:18`). They survived a daemon SIGKILL, the container's destruction and a restart (L5). No atomicity: the writer is an arbitrary process (INFERENCE). | the workload's own write window | none needed |
| **A4.** Everything else in the sandbox: `/tmp`, `/run`, AgentOS VM state, running processes | **No.** tmpfs and a read-only root (`src/runtime/hardening.ts:47-48`); the VM is ephemeral (`docs/integration/agentos.md:26-28`). After a daemon SIGKILL the container kept running with its `/tmp` file (L5), then the next daemon start destroyed it (L5). | everything since the sandbox was created | none: the reaper destroys, it never adopts (`src/session/reap.ts:33-39`) |
| **B1.** Session record | Written atomically (`src/session/store.ts:29-40`); deleted by the reaper on the next start, so it does not give a resume. | n/a | destroyed, then a fresh record (L5) |
| **B2.** Audit log | `fsync` per line and directory sync (`src/audit/log.ts:93-151`). An admission line is written before a write and a result line after (`src/tools/workspace.ts:10-15`); a crash between them leaves an admission line with no result, which nothing reconciles (G5). | one tool call | none |
| **C.** GSD planning artifacts (`.planning/*`) | Not written by Realm. They are written by the host agent's own write and edit tools (class A1 behaviour for Omp) and by GSD tooling (atomicity UNVERIFIED). They are tracked in git; a commit is the safety net. | work since the last commit | `git` |
| **D.** Orphans: temp file, container, stale socket | Temp files persist indefinitely (L6a). An orphan container persists until the next daemon start (L5). A stale control socket is removed by the next start (`src/daemon/daemon.ts:216-224`). | n/a | container and socket yes, temp files no |

No scenario that was run loses user work in the workspace. No S1 gap (irrecoverable loss or silent deletion of user work) was found.

## 2. Write paths

| Class | When | Where | How | Flushed | Locks |
|---|---|---|---|---|---|
| A1 | when the tool runs | host filesystem, inside the workspace | `openat(O_WRONLY\|O_CREAT)`, one `write`, `ftruncate`, `close` (L6b) | no | none |
| A2 | when the tool runs | host filesystem, inside a policy root | same-directory temp file `.<name>.realm-tmp-<16 hex>`, `O_EXCL\|O_NOFOLLOW`, `fsync`, prior-hash check, `rename`, directory `fsync` | yes, file and directory | in-memory table, no lock files (`src/fs/locks.ts:14`) |
| A3 | when the workload writes | the same host directory through the bind mount | whatever the process does | no | none |
| A4 | when the workload writes | tmpfs or the container layer | n/a | n/a | n/a |
| B1 | at create, active and error transitions | `<stateDir>/sessions/<id>.json` | `atomicWriteFile` | yes | none; delete is a plain `rmSync` without a directory sync (`src/session/store.ts:85-91`) |
| B2 | before and after each guarded tool call | `<stateDir>` audit file | `O_APPEND` line, `fsync` | yes | none |

## 3. Scenario matrix

| Scenario | A1 Omp-written file | A2 Realm-tool file | A3 sandbox `/workspace` file | A4 sandbox scratch and processes | Sandbox container | Evidence |
|---|---|---|---|---|---|---|
| Terminal closed (SIGHUP to Omp) | kept (completed write) | kept | kept | kept | **kept**, same id | L7, VERIFIED_BY_EXECUTION |
| Omp SIGKILL (also the OOM kill case) | kept (completed write) | kept | kept | kept | **kept**, same id; the next session reattaches in about 9 s | L7, VERIFIED_BY_EXECUTION |
| Omp SIGTERM, SIGINT | not run | not run | not run | not run | expected kept: the daemon is detached into its own session (`src/cli/main.ts:342`) | UNVERIFIED, same mechanism as L7 |
| Network drop of a remote session | same as SIGHUP | same | same | same | same | analogy to L7, UNVERIFIED |
| Daemon SIGKILL | kept | kept | kept | kept while the orphan lives, then **lost** | **orphan keeps running** | L5, VERIFIED_BY_EXECUTION |
| Next `realm up` after a daemon crash | kept | kept | kept | **lost** (`/tmp` file gone) | orphan **destroyed**, one new container | L5, and live scenario 5 (`test/integration/production-driver.test.ts:485`) |
| Daemon SIGTERM | kept | kept | kept | **lost** | container removed in about 25 s | L5, VERIFIED_BY_EXECUTION |
| Write killed in flight (process death) | possible torn file (INFERENCE) | **old or new, never torn**: old content plus one orphan temp file when killed before the rename (tested at four stages); the complete new file when killed after it (not run) | n/a | n/a | n/a | L6a VERIFIED_BY_EXECUTION for the four stages before the rename; the kill after the rename is INFERENCE; L6b order, INFERENCE for the torn file |
| Sandbox runner killed | kept | kept | kept | the runner's state lost | status `AGENTOS_CRASH_LOOP` in about 11 s; `/realm-retry` recovers | 2026-10-28 live run, `docs/integration/omp.md:160`; not re-run |
| Host crash, power loss | may lose recent writes (no sync) | kept once the call returned | host filesystem semantics | lost | gone with the host | UNVERIFIED by construction |
| Disk full | Omp reports the error (UNVERIFIED) | the temp write fails and the temp file is removed (`src/fs/atomic-write.ts:204-205`, exception-injection tests only) | writer's own error | tmpfs full is capped by size | n/a | UNVERIFIED, not caused on a shared host |

## 4. Maximum data-loss windows

- **Files in the workspace:** process death, at most the write in flight; no completed write was lost in any scenario that was run. Machine death, A1 may lose anything not yet written back by the kernel, A2 loses nothing that was acknowledged.
- **Sandbox state outside `/workspace`:** everything since the container was created, lost at the next daemon start or at any teardown. This is by design (`src/session/reap.ts:1-5`) and not reported to the user: the reap result is awaited and discarded (`src/daemon/daemon.ts:543`).

## 5. Recovery behaviour on the next start

| Start | What happens | Evidence |
|---|---|---|
| a new Omp session while the daemon lives | attaches to the same sandbox; nothing to recover | L7 |
| a new daemon after a crash | removes every realm-labelled container, then deletes every session record, then serves; the next `up` creates a fresh sandbox. A crash during the reap leaves the records for the next reap | `src/session/reap.ts:1-5`, `:33-39`; L5 |
| stale control socket | probed; removed if nothing answers; `LOCK_CONFLICT` if a daemon is alive | `src/daemon/daemon.ts:216-224` |
| stale lock files | none exist: locks are in memory | `src/fs/locks.ts:14` |
| orphan temp files, torn Omp writes, admission lines with no result | not detected, not reported | G1, G2, G5 |

## 6. Gaps, with severity and a concrete design

Severity: S1 irrecoverable loss or silent deletion of user work; S2 undetectable torn state or a stale lock that blocks sessions; S3 recoverable but manual or undocumented; S4 hardening.

| Id | Severity | Gap | Evidence | Design | Proposal |
|---|---|---|---|---|---|
| G1 | S2 | Omp's own writes are in place, unsynced and not covered by Realm's atomic path, so a kill can tear a shortening overwrite and nothing detects it. | L6b; `README.md:15` | route Omp writes through Realm's atomic write, or write a content hash before and verify after (`registerFileWriteFallback`, `tool_call` input replacement; needs a spike on Omp's extension API) | 1 |
| G2 | S3 | Orphan `.<name>.realm-tmp-*` files are never removed; they hold complete new content, sit in the user's project and can be committed by `git add -A`. | L6a; `git grep realm-tmp` finds only `src/fs/atomic-write.ts` | at daemon start and on `realm doctor`, report and remove temp files older than a threshold inside policy roots (positively identified by name and owner) | 4 |
| G3 | S3 | A daemon crash destroys sandbox state outside `/workspace` and any running process, while an Omp session may still be running. | L5; `src/session/reap.ts:33-39` | re-adopt a surviving container whose hardening verifies, a persistent scratch volume, workspace snapshots | 5 |
| G4 | S3 | The reap is silent: a destroyed sandbox leaves no log line and no message. | `src/daemon/daemon.ts:543` | log the counts and container ids; show a notice in the next status read | 4, 7 |
| G5 | S4 | An audit admission line with no result line is never reconciled. | `src/tools/workspace.ts:10-15`; the audit outcome type is `"ok" \| ErrorCode` (`src/audit/log.ts:18`), so a reconciliation line needs a catalogue code | at start, mark unmatched admissions with an existing code or an owner-approved new one | 4 |
| G6 | S4 | A session-record delete is not directory-synced. | `src/session/store.ts:85-91` | use the pinned-directory sync helper after `rmSync` | 4 |
| G7 | S4 | No committed test kills a process mid-write. The existing tests inject exceptions; the audit test uses SIGKILL only as a hang guard. | `test/fs/atomic-write.test.ts:112-134`; `test/audit/log.test.ts` | the child-process kill test of L6a, turned into a test | 4 |

## 7. Not covered

Power loss, disk full, kernel panic and an Omp SIGTERM or SIGINT were not run (section 3). The planning artifacts written by GSD tooling were not examined, so their atomicity is UNVERIFIED.

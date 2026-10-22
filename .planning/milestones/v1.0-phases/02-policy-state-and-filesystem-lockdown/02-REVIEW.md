---
phase: 02-policy-state-and-filesystem-lockdown
reviewed: 2026-10-21T00:00:00Z
depth: deep
files_reviewed: 9
files_reviewed_list:
  - src/lifecycle/controller.ts
  - src/fs/canonicalize.ts
  - src/fs/read.ts
  - src/fs/write.ts
  - src/fs/atomic-write.ts
  - src/fs/list.ts
  - src/fs/credentials.ts
  - src/audit/log.ts
  - src/audit/redact.ts
findings:
  critical: 0
  high: 2
  medium: 3
  low: 3
status: issues_found
verdict: CHANGES_REQUIRED
---

# Phase 2 review: lifecycle, fs lockdown, audit

Controller logic is coherent (record-before-create holds, idempotency keys correct,
teardown fail-closed in stopping). Degraded-as-non-active is correct: D-23 maps
degraded to deny/REALM_NOT_ACTIVE in required mode, matching n5 step 6 ("every
mutating tool checks state is active"); the spec's "shows active with degraded
marker" is display mapping only, and advisory allow-with-warning preserves S-01.

## Blocking

### H-1: FIFO swap blocks open forever (hang, violates n5 "never hang")
**File:** `src/fs/canonicalize.ts:174`
`openSync(realPath, O_RDONLY|O_NOFOLLOW)` blocks on a FIFO. `read.ts` lstat
pre-check does not close the race: a FIFO swapped in at the hook still blocks
`openVerified` (also hit via `observeSha256`, `openCanonical`).
**Fix:** `openSync(realPath, constants.O_RDONLY | constants.O_NOFOLLOW |
constants.O_NONBLOCK)` — O_NONBLOCK is a no-op for subsequent regular-file reads.

### H-2: `create()` early return skips workspace policy check
**File:** `src/lifecycle/controller.ts:75`
`connecting/active/degraded` returns the snapshot before `bindWorkspace`, so
`create(otherRoot)` while active succeeds instead of POLICY_DENIED (S-02).
**Fix:** bind the workspace and run the existing-record mismatch check before the
state early-return.

## Non-blocking

### M-1: atomic replace preserves setuid/setgid bits
**File:** `src/fs/atomic-write.ts:87` — `existing.mode & 0o7777` copies
setuid/setgid/sticky onto the temp file.
**Fix:** mask with `0o777`.

### M-2: audit dir follows a pre-created symlink out of stateDir
**File:** `src/audit/log.ts:81` — `mkdirSync(recursive)` traverses a symlinked
`audit` dir, landing log lines outside stateDir; a symlinked log file throws a
raw (non-RealmError) error.
**Fix:** lstat-verify `dir` is a real directory after mkdir; map open failure to
a catalogue error.

### M-3: raw port errors escape stop/destroy/probe paths
**File:** `src/lifecycle/controller.ts:enterError/failCreate/stopContainer/destroy`
Non-RealmError from `exec.stop/destroy` propagates unmapped (message may carry
tool output), and a `destroy` failure skips `releaseOwner` + record delete, leaking
locks.
**Fix:** map unknown teardown errors to a catalogue code before throw; release
locks in a finally.

### L-1: `destroy()` on null record leaves machine stuck
**File:** `src/lifecycle/controller.ts:destroy` — null record returns early even
when state is connecting/active.
**Fix:** transition to unbound when there is no record to tear down.

### L-2: host attachments never cleared
**File:** `src/lifecycle/controller.ts:180-193` — stop/destroy leave stale ids.
**Fix:** clear the set in stop/destroy.

### L-3: redaction pattern list is narrow (info)
**File:** `src/audit/redact.ts` — no JWT/Slack/GCP patterns; D-41 froze the list
so this is accepted residual risk, noted for Phase 7.

_Blockers: H-1, H-2. Error messages themselves are safe (RealmError carries
catalogue text only) and session-id validation is duplicated consistently._

## Corrective pass

Scope: the seven fix-list items and the typed-error gap, nothing else. Item 8
(redaction list, D-20 amendment, degraded-to-deny) is unchanged as instructed.
Nothing was committed or pushed. The `verdict` above stays `CHANGES_REQUIRED`
until a re-review confirms the fixes.

### Results

| Item | Finding | Result | Regression test(s) |
|------|---------|--------|--------------------|
| 1 | H-1 FIFO swap blocks open | PASS | `test/fs/canonicalize.test.ts`: "a FIFO swapped in at the resolve-to-open boundary is refused with PATH_ESCAPE and the open returns (FS-02)"; "observeSha256 on a FIFO returns PATH_ESCAPE within a bounded time (FS-02)" |
| 2 | H-2 `create()` skips policy check | PASS | `test/lifecycle/controller.test.ts`: "create on an active session at another workspace is refused with POLICY_DENIED and changes nothing"; "create on an active session at the same workspace returns the snapshot with no port call" (idempotency guard) |
| 3 | M-1 setuid/setgid preserved | PASS | `test/fs/atomic-write.test.ts`: "an atomic replace keeps the prior rwx bits and drops its setuid bit (FS-05)" |
| 4 | M-2 audit symlink escape | PASS | `test/audit/log.test.ts`: pre-created audit-directory symlink (outside directory stays empty); symlinked log file (outside file stays byte-identical). Both return AUDIT_WRITE_FAILED |
| 5 | M-3 teardown raw errors, lock leak | PASS | `test/lifecycle/controller.test.ts`: "a raw failure from the port destroy ..." and "a raw failure from the port stop ..." (typed REALM_STOPPING, state stopping, lock released on destroy) |
| 6 | L-1 `destroy()` on null record | PASS | `test/lifecycle/controller.test.ts`: "destroy on a session whose record is gone moves to unbound ..." |
| L-2 | host attachments not cleared | PASS | four tests in `test/lifecycle/controller.test.ts` covering stop from unbound, stop from active, destroy, and a failed teardown that keeps attachments |
| 7 | Raw Node errors from audit writes | PASS | `test/audit/log.test.ts`: "audit path is not a directory" (AUDIT_WRITE_FAILED, nothing written); `test/core/errors.test.ts` pins the exact reason text and retryable value |

Red-before-green was observed for every item. Examples: the FIFO test hung until
its child-process bound (ETIMEOUT), then accepted the FIFO after `O_NONBLOCK` alone;
the setuid replacement kept mode 4755; `create(otherRoot)` resolved while active; the
symlinked audit directory received the log line.

### Catalogue

The catalogue grew from 21 to 22 codes. `AUDIT_WRITE_FAILED` has the reason
"audit log could not be written; the tool call did not run" and `retryable: true`.
Its enforcement, which blocks tool calls when the audit write fails, is Phase 4
work (TOOL-03/04). Those tool calls are not yet gated on it.

### Gates

| Gate | Result |
|------|--------|
| `npm run typecheck` | passed, no errors |
| `npm run lint` | passed, ESLint: no issues found |
| `npm test` | 442 tests: 441 pass, 0 fail, 1 skipped (Podman gated suite, PODMAN_UNSUPPORTED_VERSION on 4.9.3) |
| `npm run test:integration` | 12 tests: 11 pass, 0 fail, 1 skipped (same Podman gate) |
| `npm run build` | passed |

### Files changed

- `src/fs/canonicalize.ts`
- `src/fs/atomic-write.ts`
- `src/lifecycle/controller.ts`
- `src/core/errors.ts`
- `src/audit/log.ts`
- `test/fs/canonicalize.test.ts`
- `test/fs/atomic-write.test.ts`
- `test/lifecycle/controller.test.ts`
- `test/core/errors.test.ts`
- `test/audit/log.test.ts`

### Deviations from the fix text

1. **Item 5, record retention.** The fix text said to delete the session record in
   a finally block. The record is not deleted when destroy fails. It holds the only
   copy of the containerId, and deleting it would orphan a container that may still
   run. The record is deleted only after a successful destroy, or when no containerId
   exists. A repeated destroy resumes teardown, as the controller documents.
2. **Item 5, error code.** Teardown failures map to `REALM_STOPPING`, the existing
   teardown-failure code. No code was added for this. Its catalogue `retryable` value
   is false.
3. **Item 1, regular-file check.** The review assumed the post-open regular-file
   check existed in `verifyDescriptor`. It did not. Named FIFOs also pass the
   `/proc/self/fd` readlink comparison, so `O_NONBLOCK` alone was not enough. An
   `isFile()` check on the fstat result was added to `verifyDescriptor`. Existing
   callers already map non-regular files to PATH_ESCAPE, so no code changed.
4. **Item 4, mapping.** All audit-path failures, including symlinks, map to
   AUDIT_WRITE_FAILED rather than PATH_ESCAPE, so one code covers the audit write.

### Decisions needed

- **Item 5, locks on stop failure.** Locks are released on the destroy path only, as
  the fix text says. If `exec.stop` fails, the locks stay held, because the container
  may still be running. Confirm whether locks should also be released on stop failure.
- **Item 7, retryable value.** `retryable` is set to true because the tool call did not
  run, so a retry is safe. Confirm this against the spec.
- **Item 3, verification scope.** The setuid test proves the fix only when run as root.
  As an unprivileged user the kernel clears setuid on write, so the test would pass
  before the fix in that case.

### Residual risks (not in the fix list, not fixed)

- **H-1 residual, `syncDirectory`.** `src/fs/atomic-write.ts` opens the parent
  directory with plain `O_RDONLY`, with no `O_NONBLOCK`. A FIFO swapped in at that
  directory path could block. The fix list covers only `openVerified`, `observeSha256`,
  and `openCanonical`. This needs a decision.
- **M-2 residual, check-then-open race.** The audit directory check is `lstat` then
  open, which is not atomic. A directory swapped for a symlink between the two calls
  is not caught. Closing this needs an `fstat` on a directory fd, a design change.
- **M-3 residual, probe and create paths.** `enterError` and `failCreate` still rethrow
  non-RealmError errors unmapped. The fix list covers teardown only (item 5), so this
  stays open.
- **L-3.** The redaction list is unchanged, as instructed. Accepted under D-41 and
  flagged for Phase 7.

### Re-review

The verdict stays `CHANGES_REQUIRED` until a re-review confirms the fixes and
decides the residual items above.

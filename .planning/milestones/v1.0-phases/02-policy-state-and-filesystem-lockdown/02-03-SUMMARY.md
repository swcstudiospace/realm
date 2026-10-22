# Plan 02-03 Summary: Filesystem enforcement (glob, credential denial, locks, capped read and list, locked write, race test)

**Status:** implemented; gates not run in this lane (the orchestrator runs `tsc`, lint, and `node --test` after the wave). Requirements claimed: FS-01, FS-02, FS-03, FS-04, FS-05.

## Files

Created or changed (repo-relative):

- `src/fs/glob.ts`: `matchGlob(pattern, relPath)`. `*` within a segment, `?` one character, whole-segment `**`. Hand-written, memoized, no dependency (D-32).
- `src/fs/credentials.ts`: `CREDENTIAL_PATTERNS` (frozen, exactly the 20 D-31 shapes), `isCredentialDenied`, `isCredentialAllowed`, `assertCredentialAccess` (throws `CREDENTIAL_PATH_DENIED`), `relPathOf` (canonical relative path of a canonicalize result, absent results included).
- `src/fs/locks.ts`: `LockTable` with `acquire`, `release`, `isHeldBy`, `releaseOwner` (in memory; keyed by canonical real path).
- `src/fs/read.ts`: `readFileCapped`, returning the `found` or `absent` union.
- `src/fs/list.ts`: `listDir`, returning the `found` or `absent` union, with `MAX_LIST_ENTRIES = 1000`.
- `src/fs/write.ts`: `lockedWrite` in the D-34 order with a `finally` release.
- `test/fs/glob.test.ts`, `test/fs/deny-credentials.test.ts`, `test/fs/lock.test.ts`, `test/fs/read-list.test.ts`, `test/fs/write.test.ts`, `test/fs/atomic-write.test.ts`, `test/fs/toctou.test.ts`.
- `.planning/phases/02-policy-state-and-filesystem-lockdown/02-03-SUMMARY.md` (this file).

Not changed: `src/fs/canonicalize.ts`, `src/fs/atomic-write.ts`, `src/fs/root.ts` (the 02-01 base is used as-is). No frozen file, no `package.json`, no other `.planning/` file was touched. No dependency was added.

## Must-haves and the tests that evidence them

- A symlink swapped in between resolve and open is rejected with `PATH_ESCAPE` via the boundary hook: `a symlink swapped in at the resolve-to-open boundary is rejected with PATH_ESCAPE (FS-02)`. Also `a directory on the resolved path swapped for an escaping symlink is caught by the /proc/self/fd check (FS-02, D-30)`, which shows the descriptor readlink check is what catches an intermediate-directory swap.
- Every denied credential shape fails with `CREDENTIAL_PATH_DENIED` on read and on write unless `credentialAllow` permits; escapes report `PATH_ESCAPE` first: `every denied shape fails with CREDENTIAL_PATH_DENIED on read (FS-03)`, `... on write and leaves the file unchanged (FS-03)`, `credentialAllow permits the matching denied path for read and write and nothing else (FS-03)`, `an escaping credential path reports PATH_ESCAPE before any credential check (FS-01, FS-03)`.
- A conflicting lock fails with `LOCK_CONFLICT` leaving the file unchanged; same-owner re-acquire is idempotent; release is idempotent; a second owner through a symlink conflicts: `a conflicting owner gets LOCK_CONFLICT and the file stays byte-identical (FS-04)`, `same-owner re-acquire is idempotent and returns the same handle (FS-04)`, `release is idempotent and frees the path for another owner (FS-04)`, `a second owner reaching the same file through a file symlink conflicts (FS-04)`, `a second owner writing through a directory symlink conflicts and the file is unchanged (FS-04)`.
- Each atomic-write stage-hook failure leaves the original byte-identical with no `.realm-tmp-` file and reports `WRITE_NOT_ATOMIC`: `a stage-hook failure at after-temp-write | after-fsync | before-rename leaves the original byte-identical with no temp file and reports WRITE_NOT_ATOMIC (FS-05)`. The success path: `the success path replaces the content and leaves no temp file (FS-05)`.

Plan task acceptance criteria:

- Task 1: `test/fs/glob.test.ts` covers star, question mark, and double star at root, middle, and trailing positions. `test/fs/deny-credentials.test.ts` denies every D-31 class, permits via `credentialAllow`, and asserts escape-before-credential ordering. No new dependency in `package.json`.
- Task 2: `test/fs/lock.test.ts` asserts conflict unchanged, idempotent acquire and release, and the through-symlink conflict. `test/fs/read-list.test.ts` asserts truncation, non-regular rejection, symlink reporting without following, and the 1000-entry cap. No persistence file is created (`locks live in memory and acquire and release create no file (FS-04)`).
- Task 3: `test/fs/write.test.ts` covers the `ifMatchSha256` mismatch and absent cases and the pre-rename re-check race. `test/fs/atomic-write.test.ts` covers all three stage hooks plus success. `test/fs/deny-credentials.test.ts` covers read and write denial.
- Task 4: `test/fs/toctou.test.ts` swaps a symlink at the boundary and asserts `PATH_ESCAPE`. There is no skip, todo, or platform gate in any test file. The fail-closed case is `without /proc/self/fd the verified read fails closed with PATH_ESCAPE and is never skipped (FS-02, D-30)`, with a positive control `the same read succeeds with /proc/self/fd present ... (FS-02)`.

## Requirement evidence

- FS-01 (canonical paths, escapes): `test/fs/read-list.test.ts` (`read returns the content...`, `list reports each entry's kind...`), `test/fs/write.test.ts` (`a target reached through an escaping directory symlink...`, `a symlink at the target...`), and `test/fs/deny-credentials.test.ts` (`an escaping credential path...`).
- FS-02 (race rejection): `test/fs/toctou.test.ts`, all four tests.
- FS-03 (credential denial): `test/fs/deny-credentials.test.ts`, all twelve tests, including `the denied list is exactly the D-31 shapes...`, which pins the list as literals.
- FS-04 (advisory locks, locked write): `test/fs/lock.test.ts`, all nine tests; `test/fs/write.test.ts`, all thirteen tests, including the D-34 order effects (`an ifMatchSha256 that differs...`, `an ifMatchSha256 against an absent target...`, `a non-cooperating writer between observation and rename...`).
- FS-05 (atomic replace): `test/fs/atomic-write.test.ts`, all five tests.
- D-32 matcher cases: `test/fs/glob.test.ts`, all eight tests.
- D-36 read and list: `test/fs/read-list.test.ts`, all seven tests.

## Deviations and interpretations (each with the default applied)

1. **`atomic-write.ts` not edited.** It is not in this plan's `files_modified`. The stage-hook matrix is driven from tests with a plain `Error` thrown from the hook, which the existing catch maps to `WRITE_NOT_ATOMIC` with `replaced: false`. A `RealmError` thrown from a hook propagates unchanged. Production callers pass no hook, so this is a test-seam property only.
2. **Missing parent on write is `PATH_ESCAPE`.** D-34 step 1 requires the parent to exist, but names no code for its absence. The default applied is `PATH_ESCAPE`, since an unverifiable path is treated as escaping (D-30). Covered by `a missing parent directory is PATH_ESCAPE and creates nothing (D-34 step 1)`.
3. **`LockTable.releaseOwner` added.** D-33 says session destroy releases every lock held for that session, and plan 02-05 (`destroy releases the session locks via the D-33 table`) calls it. It is in `locks.ts`, which is in this plan's scope. Covered by `releasing an owner's locks frees every path it held (FS-04, D-33)`.
4. **`LockTable.isHeldBy` added; a write does not drop a lock its owner took earlier.** Without this, `lockedWrite` by an owner that already held the path would release that lock in its `finally`. Covered by `a locked write by the lock's own owner keeps the lock it took before (FS-04)`.
5. **`read` sha256 covers the whole file.** Content is capped at `maxBytes`, but the hash keeps streaming past the cap, so it matches `observeSha256`, which the locked write uses for `ifMatchSha256`. `truncated` is `total > maxBytes`.
6. **Read content is `Uint8Array` (bytes), not a string.** A capped read can cut a UTF-8 sequence, so bytes are the honest type.
7. **Credential check covers absent paths.** The check runs on the canonical path of an absent result too, so a denied shape that does not yet exist is denied on read and write. Covered by `a denied shape that does not exist yet is denied on read and on write (FS-03)`.
8. **`list` of a non-directory, or of an unreadable directory, is `PATH_ESCAPE`.** No catalogue code names this; the default applied is the same fail-closed rule as the canonicalizer.
9. **`credentialAllow` is required** on the read, list, and write options. It has no default, so a caller cannot skip the policy silently.
10. **Credential matching is case-sensitive**, as the Linux filesystems this phase targets are. `.ENV` is not denied by the `.env` shape.
11. **Credential check runs before the resolve-to-open hook in `read`**, and the verified open confirms the descriptor's real path equals the checked path (the `/proc/self/fd` readlink check), so a swap after the check cannot redirect the open to an unchecked object.

## Residual risks and open questions

- **Q-2 (rename window, accepted).** Node 22 has no `openat`. A parent directory swapped between verification and `rename(2)` is narrowed by the parent re-check, not closed. Recorded in the header of `test/fs/toctou.test.ts` and here, for the Phase 7 security review.
- **FIFO open race (not closed here).** `read` rejects FIFOs and other non-regular files before the open, so a FIFO present at check time never blocks. A FIFO swapped in between that check and the `O_RDONLY` open would block the open. Closing it needs `O_NONBLOCK` in `openVerified` (02-01 module, outside this plan's changes). Flagged for the Phase 7 review.
- **Q-3 (orphaned temp files, default applied).** A temp file left by a killed process is not cleaned up by this plan.
- **Q-4 (MCP and ACP contract tests, deferred to Phase 5).** No MCP or ACP test was added. QUAL-02 coverage is through the taxonomy tests in plan 02-06.
- **Not verified in this lane.** Per the shared rules, I did not run `tsc`, lint, or `node --test`. Items the orchestrator should watch on the compiler pass: the `Dirent` type import and `readdirSync` withFileTypes return inference in `src/fs/list.ts`; the `Object.freeze` typing of `LockHandle`; `.some` on the frozen `as const` credential tuple; and the `Buffer` and `Uint8Array` assignments in `src/fs/read.ts`.

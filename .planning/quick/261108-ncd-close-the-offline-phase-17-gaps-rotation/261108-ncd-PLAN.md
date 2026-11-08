---
phase: quick-261108-ncd
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/daemon/ensure.ts
  - test/daemon/start-failure.test.ts
  - src/audit/anchor.ts
  - test/audit/anchor.test.ts
  - test/cli/audit.test.ts
  - test/audit/chain.test.ts
autonomous: true
requirements: [OBS-01, OBS-02]

must_haves:
  truths:
    - "A daemon.failed line written after the daemon log rotated (file replaced by a shorter file, or by a file already longer than the remembered offset) is still reported by reportingStartFailure, so realm up reports the daemon's own code instead of waiting for the timeout."
    - "A failure line written before the start is still ignored, a LOCK_CONFLICT line is still not a start failure, and the reader still never echoes log content."
    - "merkleRootOfLeaves is exported from src/audit/anchor.ts with a doc comment and is tested directly against roots computed independently with node:crypto; no hash byte changes."
    - "realm audit verify --file on a regular file at mode 0o000 exits 1 with the unreadable failure, no success output and no host path in stdout or stderr (skipped with a stated reason as uid 0)."
    - "readAuditHead is pinned at the 64-line look-back edge, the torn final line, a legacy-only file and the byte-window edge, each compared with verifyAuditFile where that applies; src/audit/chain.ts is unchanged."
  artifacts:
    - path: "src/daemon/ensure.ts"
      provides: "rotation-aware start-failure reader"
    - path: "src/audit/anchor.ts"
      provides: "exported merkleRootOfLeaves"
    - path: "test/daemon/start-failure.test.ts"
      provides: "rotation regression tests"
    - path: "test/audit/anchor.test.ts"
      provides: "merkleRootOfLeaves tests"
    - path: "test/cli/audit.test.ts"
      provides: "unreadable audit file test"
    - path: "test/audit/chain.test.ts"
      provides: "look-back and byte-window boundary tests"
  key_links:
    - from: "src/daemon/ensure.ts reportingStartFailure"
      to: "src/daemon/main.ts entryWriter (rotating file sink on daemon.log)"
      via: "daemon.log identity (dev, ino) and size tracking"
---

<objective>
Close the offline Phase 17 gaps (OBS-01, OBS-02) named in 261108-ncd-CONTEXT.md: make the daemon start-failure reader survive rotation of daemon.log, export and directly test merkleRootOfLeaves, and add the unreadable-audit-file CLI test and the head look-back boundary tests.

Purpose: a daemon that refuses to start must be reported by its own code even when the log rotates mid-wait; the anchor Merkle fold and the audit head boundaries get direct, independent evidence.
Output: one behaviour fix in src/daemon/ensure.ts, one export in src/audit/anchor.ts, and tests in four test files. No change to src/audit/chain.ts, CHANGELOG.md, package.json, package-lock.json, .github/** or release/**. Never stage .planning/config.json.
</objective>

<execution_context>
@~/.claude/gsd-core/workflows/execute-plan.md
@~/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@AGENTS.md
@.planning/quick/261108-ncd-close-the-offline-phase-17-gaps-rotation/261108-ncd-CONTEXT.md
@src/daemon/ensure.ts
@src/observe/log-file.ts
@test/daemon/start-failure.test.ts
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Make the start-failure reader rotation-aware (D-01)</name>
  <files>src/daemon/ensure.ts, test/daemon/start-failure.test.ts</files>
  <behavior>
    - Verdict on the current code, verified at planning time: the defect is REAL. src/daemon/main.ts entryWriter sends daemon.log through createFileSink (src/observe/log-file.ts), which on rotation renames the file to daemon.log.1 and opens a fresh daemon.log. reportingStartFailure records one byte offset on the first miss and keeps it; daemonStartFailureSince returns undefined whenever size is not above the offset. After a rotation to a shorter file every later poll yields undefined, and a replacement that regrew past the offset is read from the middle, so a daemon.failed line can be skipped or cut. Either way realm up waits for the timeout instead of reporting the daemon's code.
    - Test A: rotate (rename daemon.log to daemon.log.1, write a new shorter daemon.log) after the mark; a failure line appended to the new file is returned.
    - Test B: rotate to a new file already longer than the old offset that holds the failure line near its start; the failure is returned (inode change forces a read from byte 0).
    - Test C: through reportingStartFailure: first miss (mark taken), rotate, append failure, next poll rejects with the daemon's code (RealmError, code check as in the existing wrapper test).
    - Test D: a failure line written BEFORE the mark is still ignored, both without rotation and when the log then rotates to a new file with no failure line (the pre-start line sits in daemon.log.1 and is never read). A LOCK_CONFLICT line after rotation is still not a failure.
    - Existing tests, including test/daemon/main.test.ts line 619 (daemonStartFailureSince(stateDir, 0)), keep passing unchanged.
  </behavior>
  <action>
    In src/daemon/ensure.ts (per D-01):
    1. Track the log's identity next to its offset. Add an exported helper that returns the current daemon.log identity (device and inode, read with bigint stats so large inode numbers stay exact) or undefined when the file is absent; keep daemonLogSize as is. Extend daemonStartFailureSince with an optional third parameter, the identity recorded with the offset; the two-argument call used by test/daemon/main.test.ts must keep its meaning.
    2. Rewrite the read path of daemonStartFailureSince to open the log once and fstat that descriptor (no stat-then-open race; a missing file, ENOENT, yields undefined as today). The start position is 0 when an identity was supplied and the opened file's device or inode differs from it, or when the file's size is smaller than the offset (truncation or a shorter replacement); otherwise it is the recorded offset. Nothing to read (size not above the start position) yields undefined. Keep the existing rules: only complete lines (up to the last newline) count, the last valid daemon.failed line wins, LOCK_CONFLICT and uncatalogued codes are ignored, and nothing from the log is ever returned or thrown except the catalogue code, so no log content is echoed. Fold readLogFrom into the descriptor-based read so there is one open per poll.
    3. In reportingStartFailure, record offset and identity together on the first miss (the same moment as today: the spawn follows that first miss, so the mark precedes the new daemon's output) and pass both on every later poll. Do not update the mark after a rotation; a replacement is always read from its start, and a second rotation is caught by the same inode comparison.
    4. Fix the stale comments: the header lines near the top and the comment above daemonLogPath (currently says request lines do not go here and that rotating daemon.log would leave failure lines on an unlinked inode) must instead state that daemon.log is the entry log written through the rotating file sink (renamed to daemon.log.1 at the size cap) and that the reader tolerates that rotation by identity and size; also update the comments above daemonStartFailureSince ("A log shorter than offset ... yields undefined") and above reportingStartFailure so they describe the rotation-aware behaviour. Keep requestLogPath's comment accurate.
    In test/daemon/start-failure.test.ts add tests A to D above using real files under scratchStateDir and renameSync/writeFileSync/appendFileSync (fixtures only: no daemon, no socket, no sink import needed). Reuse the failed() helper and the RealmError assertion shape already in the file. Do not weaken or remove existing tests. Do not touch src/daemon/main.ts or src/observe/log-file.ts.
  </action>
  <verify>
    <automated>npm run build && node --test dist/test/daemon/start-failure.test.js dist/test/daemon/main.test.js</automated>
  </verify>
  <done>The new rotation tests fail against the old reader and pass against the new one; existing start-failure and daemon main tests pass; the stale "no rotation" comments are corrected.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Export merkleRootOfLeaves and test it directly (D-02)</name>
  <files>src/audit/anchor.ts, test/audit/anchor.test.ts</files>
  <behavior>
    - Empty list throws AnchorError with code SCHEMA_INVALID (same assertion style as the existing merkleRoot empty test).
    - One leaf returns that leaf unchanged.
    - Two leaves: node(l0, l1). Three: node(node(l0, l1), l2). Four: node(node(l0, l1), node(l2, l3)). Five: node(node(node(l0, l1), node(l2, l3)), l4). Six and seven also checked (seven: the unpaired seventh leaf is promoted at the first level, then paired at the second).
    - Each expected root is computed in the test with the file's independent node:crypto helpers (sha256, leaf, node: prefixes 0x00 and 0x01) and compared as bytes; for odd counts also assert the root differs from the duplicate-the-last-node construction (node(x, x)) so promotion, never duplication, is pinned.
    - merkleRoot(lines) equals merkleRootOfLeaves(lines.map(leaf)) for the three and five line cases.
  </behavior>
  <action>
    In src/audit/anchor.ts (per D-02) add the export keyword to merkleRootOfLeaves (around line 100) and extend its doc comment to say it takes already-hashed leaves (each SHA-256(0x00 || line)), the pairing and unpaired-promotion rule, that it throws AnchorError SCHEMA_INVALID on an empty list, and that merkleRoot is the line-level entry. No other change: no hash, prefix or algorithm byte may change. Do not export parentLevel.
    In test/audit/anchor.test.ts import merkleRootOfLeaves and add the tests above next to the existing merkleRoot tests. Build expected values with the file's existing sha256, leaf and node helpers and the A to D fixtures; do not call newLeafHash, nodeHash or the module's own fold to produce an expectation.
  </action>
  <verify>
    <automated>npm run build && node --test dist/test/audit/anchor.test.js</automated>
  </verify>
  <done>merkleRootOfLeaves is exported and documented; direct tests for empty, one, even and odd counts pass against independently computed roots; existing anchor tests are unchanged and pass.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Unreadable audit file CLI test and head look-back boundary tests (D-03)</name>
  <files>test/cli/audit.test.ts, test/audit/chain.test.ts</files>
  <behavior>
    - CLI: realm audit verify --file on a seeded regular file chmod to 0o000 exits 1; stdout report has ok false and files[0].failure "unreadable"; stderr contains the text "audit file cannot be read"; stdout holds no ok:true report; neither stdout nor stderr contains the file path, its directory or the temp root. Mode restored (chmod 0o600) in t.after. Skipped with a stated reason when process.getuid?.() === 0, using the LOCKED_SKIP idiom of test/doctor/fix.test.ts (permission bits do not restrict root).
    - chain, using the exported readAuditHead and verifyAuditFile on fixture files written under a temp state dir: (a) a chained record exactly 64th from the end (63 non-chained JSON-object lines after it) is found, with seq and hash equal to verifyAuditFile's head seq and hash of that same line taken from a verify of the chained prefix; (b) one more non-chained line (65th from the end) gives state "none"; (c) a torn final line (no trailing newline) after chained lines: head is the last complete chained line and verifyAuditFile reports tornTail true with the same head seq and hash; a file that is only a torn fragment gives "none"; (d) a legacy-only (unchained) file gives "none" and verifyAuditFile reports unprotected-only (legacyLines equal to the line count, no head); (e) byte-window edge: the tail window is 2 * (AUDIT_LINE_MAX_BYTES + 1) bytes; a chained line whose first byte sits one byte inside the window (the preceding newline is the window's first byte) is found, and the same file grown by one byte at its end shifts that line to start exactly at the window's first byte and gives "none" (a window that starts mid-file never parses its cut first line). Build the large fixture with non-chained JSON-object padding lines whose lengths are computed in the test from AUDIT_LINE_MAX_BYTES, each under that bound; assert the computed offsets in the test so the edge is deterministic.
    - Where verifyAuditFile is run on the non-chained-tail files of (a), (b) and (e) it reports the file broken at the unchained line, which is the documented "only an altered file" case; assert that so the none results are tied to altered files.
    - If any boundary test shows readAuditHead behaving differently from the description above, do not change src/audit/chain.ts: record the observed behaviour as a defect note for the SUMMARY and pin only what is true.
  </behavior>
  <action>
    In test/cli/audit.test.ts (per D-03) add the unreadable-file test after the missing-file test, importing chmodSync and using seed/auditFile/withState/reportOf/runCli already in the file; the test takes t for t.after and the skip option for root. See src/cli/audit.ts verifyOne/pathFailure: lstat passes for a mode-0 regular file, then checkAuditFile's open fails, which maps to failure "unreadable" with FAILURE_TEXT.unreadable on stderr.
    In test/audit/chain.test.ts add the boundary tests using the file's withStateDir, auditFile, writeLines and seed helpers, importing readAuditHead and AUDIT_LINE_MAX_BYTES (already imported) from src/audit/chain.ts. Observed source facts to build on: SEQ_LOOKBACK_LINES is 64 and the loop in lastChainedLine examines 64 lines counted from the last newline-terminated line; readTailHead reads min(size, 2 * (AUDIT_LINE_MAX_BYTES + 1)) bytes from the end, returns none when the window has no newline, and stops without parsing when the window starts mid-file and the first line is cut. Pad with deterministic JSON-object lines (for example a single "pad" key of repeated characters) so each non-chained line parses as an object but has no seq and prev. Name tests with the file's existing "OBS-02:" style prefix. Keep the large byte-window fixture to the minimum size the edge needs and remove it with the temp dir.
    Do not edit src/audit/chain.ts or docs/integration/runtime-decision.md; the 64-line limitation stays an accepted documented gap.
  </action>
  <verify>
    <automated>npm run build && node --test dist/test/audit/chain.test.js dist/test/cli/audit.test.js && npm run typecheck && npm run lint && npm run check:gates</automated>
  </verify>
  <done>The unreadable-file test passes (or skips with its stated reason as root); the boundary tests pass and pin the look-back edge, torn line, legacy-only file and byte-window edge; chain.ts is unmodified; typecheck, lint and gates are clean.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| daemon.log content to host CLI | Log text is written by the daemon and read back by realm up; it is data, never echoed |
| audit file on disk to realm audit verify | File may be unreadable, altered or torn |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-ncd-01 | Information disclosure | daemonStartFailureSince | medium | mitigate | Only a catalogue ErrorCode leaves the reader; the descriptor-based read never returns or throws log text; a test asserts non-catalogue and LOCK_CONFLICT lines stay ignored |
| T-ncd-02 | Denial of service | reportingStartFailure after rotation | medium | mitigate | Identity (dev, ino) and size tracking read a replacement log from byte 0, so a failure line is found instead of waiting for the timeout |
| T-ncd-03 | Tampering | merkleRootOfLeaves export | low | accept | Export only; hash bytes unchanged and pinned by independent node:crypto roots |
| T-ncd-04 | Information disclosure | realm audit verify unreadable path | low | mitigate | Test asserts neither stdout nor stderr contains the host path |
| T-ncd-05 | Tampering | audit head 64-line look-back | low | accept | Documented limitation; the tests pin it and chain.ts is not changed |
</threat_model>

<verification>
Run, from the checkout root:
- npm run build && node --test dist/test/daemon/start-failure.test.js dist/test/daemon/main.test.js dist/test/audit/anchor.test.js dist/test/audit/chain.test.js dist/test/cli/audit.test.js
- npm run typecheck
- npm run lint
- npm run check:gates
</verification>

<success_criteria>
- A rotated daemon.log no longer hides a later daemon.failed line; pre-start failures, LOCK_CONFLICT handling and the no-echo rule are unchanged.
- merkleRootOfLeaves is exported, documented and covered by independent-root tests; no hash change.
- The unreadable audit file case and the head look-back and byte-window boundaries have deterministic tests; chain.ts is untouched; any defect a test exposes is reported in the SUMMARY, not fixed.
- typecheck, lint and check:gates pass.
</success_criteria>

<output>
Create `.planning/quick/261108-ncd-close-the-offline-phase-17-gaps-rotation/261108-ncd-SUMMARY.md` when done
</output>

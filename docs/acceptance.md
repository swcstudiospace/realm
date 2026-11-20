# Acceptance Criteria — v3.0 Containment by Default

## US-101 — Phase 12: scripted harness and enforcement spike

AC-1 story: US-101
Given a built extension and a local Omp on PATH
When the gated harness command runs with REALM_LIVE_OMP=1
Then the run passes with 6 live cases (C1, C1b, C2, C3, C4, C4b) and the output records 1 Omp version string
check: harness command exit code and recorded version
automated: true

AC-2 story: US-101
Given a reachable daemon with the realm inactive and advisory policy
When a model-issued Realm write runs through the harness
Then the every-invocation warning is shown, exact host bytes land, and the unreachable-daemon control refuses with REALM_NOT_ACTIVE and 0 host files
check: omp-guard live cases C1 and C1b file effects and error code
automated: true

AC-3 story: US-101
Given a warm Omp profile and REALM_OMP_NET_TRACE=1 with strace
When the measured warm registered-write turn runs
Then the trace records 0 external connects, 0 DNS offenders and 0 total offenders, with only the stub and ports 11434, 8080 and 1234 allowed
check: strace connect classification summary
automated: true

AC-4 story: US-101
Given the spike run on a recorded Omp version
When docs/integration/omp.md is read
Then the enforcement table states whether registerTool reaches the model, whether setActiveTools removes write, edit and bash with execution enforcement, and whether registerFileWriteFallback redirects a write, and OQ-P5-01 and OQ-P5-02 are closed or restated
check: documentation table contains 3 answers and 1 version string
automated: true

## US-102 — Phase 13: quality ratchet

AC-5 story: US-102
Given the repository CI configuration
When the audit and dependency checks run
Then ci.yml contains npm audit with flags omit-dev and audit-level-high, and dependabot covers github-actions and npm for the root and for site/
check: ci.yml and dependabot configuration content
automated: true

AC-6 story: US-102
Given a packed tarball from the current head
When pack-smoke runs against 1 normal and 4 damaged archives (missing adapter manifest, missing licence, wrong version, missing declared OMP entry, plus hermes-agent snippet and prime-agent MCP.md)
Then the normal archive passes, and each damaged archive exits 1 naming the 1 missing file
check: pack-smoke exit codes and named defects
automated: true

AC-7 story: US-102
Given Node 24.18 coverage output for src/fs, src/core and src/tools
When the coverage gate runs at the committed floors and at 1 floor raised above the measured value
Then the committed run exits 0, and the raised-floor run exits 1 reporting BELOW for the 1 raised directory
check: coverage gate exit codes and BELOW metric
automated: true

AC-8 story: US-102
Given the libpod TTL cache and idempotent lifecycle tests
When the full suite runs in a 1-CPU quota container with competing load
Then the run reports 0 failures, the 2 named seams use an injected fake clock, and the 21 acp fixed waits use the shared scaled-timeout helper
check: test counts and seam source paths
automated: true

AC-9 story: US-102
Given fast-check properties for the path canonicalizer and the policy parser
When npm test runs and a deliberately broken canonicalizer is substituted
Then the property suite reports 1 or more failures on the broken code and 0 failures on the restored code, and the mutation workflow covers src/fs, src/core/policy.ts and src/audit/redact.ts on schedule without blocking
check: property failure counts and mutation workflow scope
automated: true

## US-103 — Phase 14: crash safety

AC-10 story: US-103
Given a child process killed from the stage hook at each of 4 stages (after-temp-write, after-fsync, before-rename, after-recheck)
When the parent asserts and the next sweep runs
Then the original bytes are intact for all 4 stages, 1 orphan temp file per stage is named, and the sweep removes only regular files matching 1 exact pattern and leaves 1 other dotfile per case
check: SIGKILL stage assertions and sweep audit lines
automated: true

AC-11 story: US-103
Given 1 audit file with 1 admission line and 0 result lines
When the daemon starts twice
Then the first start appends exactly 1 reconciliation line marked as reconciliation, and the second start appends 0 lines
check: audit line counts across 2 starts
automated: true

AC-12 story: US-103
Given a records deletion and a startup reap that removes 1 container
When the reap completes and the next attach reads status
Then the startup log entry names 1 container id with recordsDeleted of 1 or more, and the status read shows 1 notice and never stays silent
check: log fields and status notice count
automated: true

AC-13 story: US-103
Given a recorded container that was removed externally
When a retry runs from the error state and the same refusal is sent over MCP and ACP
Then the retry reaches active with 1 new container id and never OPENSHELL_START_FAILED, and the MCP and ACP cause codes equal the in-process cause code for all 3 surfaces
check: controller state trace and 3-surface code equality
automated: true

## US-104 — Phase 16: Omp runs in the sandbox

AC-14 story: US-104
Given an Omp session with the extension loaded
When the callable tool list is read in each mode
Then 5 Realm tools (exec, read, write, list, status) are present with the frozen ToolCall shape, retry remains the realm-retry command, and 0 glob tools are present
check: tool list names and schema test result
automated: true

AC-15 story: US-104
Given fail-closed mode with the realm active
When a model-issued bash call runs
Then the call is refused with 1 catalogue code, the tool_call guard remains as a backstop, and the status text states guard or containment exactly as the spike finding allows
check: bash refusal code and status text
automated: true

AC-16 story: US-104
Given advisory mode
When the active set is read and mode publication runs
Then Realm tools are registered, built-ins other than read and write stay available, and registered read and write displace the built-ins by name, with restore ownership correct for 1 disappeared-tool case
check: active set comparison and restore assertion
automated: true

AC-17 story: US-104
Given REALM_LIVE_OMP=1 and REALM_LIVE_PRODUCTION=1 on the production stack
When a unique registered write runs end to end
Then the bytes land in the sandbox /workspace and in the host root, and the audit log holds exactly 1 admission line and 1 result line with the same correlation id
check: workspace bytes, host bytes and audit pair identity
automated: true

## US-105 — Phase 17: observability and audit integrity

AC-18 story: US-105
Given an audit file with a seq and prev chain including 1 reconciliation line
When verify runs untouched, with 1 middle line edited, 1 line removed, and 1 pair reordered in 3 separate copies
Then the untouched copy exits 0, and each of the 3 altered copies exits 1 naming the 1 first broken line, with the head recovered from the last line at startup
check: verify exit codes and named line numbers
automated: true

AC-19 story: US-105
Given the daemon under load
When 1 up and 1 tool call run
Then the daemon log holds 1 JSON object per line with level, 1 fixed catalogue-code field and 1 correlation id per operation, the tool-call id matches its audit admission and result lines, and package.json dependency count is unchanged
check: log line shape, correlation match and dependency count
automated: true

AC-20 story: US-105
Given a running daemon
When counters and timings are read
Then tool-call, transition and attach counts are readable over the control socket, and the daemon listening-socket listing shows 0 network listeners
check: socket read values and listener count
automated: true

AC-21 story: US-105
Given a killed gateway
When realm status and the probe test run
Then the status shows 1 gateway-or-driver-loss code and never AGENTOS_CRASH_LOOP, and every catalogue-enumerating table, doc and test includes the 1 new code
check: status code and enumeration file list
automated: true

## US-106 — Phase 18: per-project sandboxes

AC-22 story: US-106
Given 2 project workspaces under the configured roots each with 1 same-name file of distinct bytes
When realm up runs from each directory
Then 2 sandboxes realm-<sessionId> are active, each /workspace byte string differs from the other, a write in one is invisible in the other, and down for 1 leaves the other active
check: 2 container ids, 2 byte strings, down isolation
automated: true

AC-23 story: US-106
Given a directory outside every configured root
When realm up runs there
Then the call exits 1 with POLICY_DENIED and 0 containers created for that workspace, and each live session keeps 1 separate audit file, 1 lock table and 1 status snapshot
check: error code and per-session file counts
automated: true

## US-107 — Phase 19: resume and checkpoint

AC-24 story: US-107
Given an active sandbox with a recorded container id
When the daemon is killed and restarted
Then the same container id is active, /workspace bytes are identical, and 0 second containers exist
check: container id equality and byte comparison
automated: true

AC-25 story: US-107
Given 1 container that fails the hardening verifier and 1 scratch file beyond /workspace
When the daemon restarts and then realm down runs
Then the failing container is removed before serving with 1 cause log line, the scratch file survives the restart and is gone after down, and 0 orphans remain
check: removal log, scratch presence and orphan count
automated: true

AC-26 story: US-107
Given a modified workspace after a snapshot
When restore runs
Then every file returns to its prior bytes exactly, 1 deletion is restored, extras are removed, and unsafe paths are refused with 1 error
check: byte-for-byte comparison and refusal code
automated: true

## US-108 — Phase 20: release hardening

AC-27 story: US-108
Given the release workflow on a push to main
When the build and publish jobs run
Then the build job holds contents read only with 0 write grants, the publish job holds the 4 write grants and runs 0 npm install, build or pack steps, and gh attestation verify accepts the tarball, SHA256SUMS and SBOM
check: job permission sets and attestation verification
automated: true

AC-28 story: US-108
Given a test release and a known-good docs tag
When the manual rollback workflow runs
Then the test release is marked a prerelease, the docs site is rebuilt from the known-good tag, and no tag, asset or main commit is changed
check: release flag, sourced docs tag and unchanged main
automated: true

AC-29 story: US-108
Given a generated changelog from git history
When a feature was later removed by a revert or a Removes trailer covering 1 or more commits
Then the generated notes contain 0 entries for the removed feature commits and the removing commit leaves with them
check: changelog entry count for removed commits
automated: true

## US-109 — Milestone audit, complete, cleanup

AC-30 story: US-109
Given the joined milestone tree
When the milestone dry run completes
Then the audit records all 52 v3.0 requirements as satisfied, carried or superseded with 0 silent gaps, the dry run exits 0, and cleanup inventory shows 0 remaining scratch profiles and worktrees
check: audit row counts, dry-run exit code and cleanup inventory
automated: true

## US-110 — PR, ship and Linear tracking flow

AC-31 story: US-110
Given a pull request to main
When the gate suite runs
Then typecheck, lint, test, build, check:docs, check:gates, check:pack and check:mcp each exit 0, CI is green on Node 22.x and 24.x, Greptile reports 5 of 5 with 0 open comments, the merge runs once through the ship flow with squash, and the pull request edits 0 version fields and 0 CHANGELOG lines
check: 8 gate exit codes, CI and Greptile verdicts, ship merge record
automated: true

AC-32 story: US-110
Given the Linear workspace issue list
When deduplication runs before creation
Then 1 issue exists per phase for 8 phases (12, 13, 14, 16, 17, 18, 19, 20) with 0 duplicate phase titles, each issue links 1 phase id, 1 or more plan ids and 1 or more requirement ids, titles are 1 short line, and detail lives in 1 collapsible Agent notes section per issue with 1 sub-issue per plan or requirement
check: issue counts, title lengths and link fields
automated: true

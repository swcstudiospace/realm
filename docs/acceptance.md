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

## US-111 — Realm start-error debug and clean start

AC-33 story: US-111
Given a fresh build and a configured workspace directory that exists
When realm up runs
Then it reaches active with 1 container and 0 ERR_MODULE_NOT_FOUND errors
check: realm up exit code and error text
automated: true

AC-34 story: US-111
Given a stored config whose workspaceRoot points at 1 nonexistent directory
When realm up runs
Then it exits 1 with POLICY_DENIED and names 1 missing directory
check: exit code and diagnostic text
automated: true

AC-35 story: US-111
Given a fresh build with 1 audit chain module present
When the daemon starts
Then 0 module-load errors occur and 1 audit chain head is readable
check: start exit code and chain head read
automated: true

## US-112 — Optional Omp plugin toggle

AC-36 story: US-112
Given a default install with no toggle setting recorded
When the plugin loads
Then 5 Realm tools are registered and 1 status paint occurs
check: tool count and paint count
automated: true

AC-37 story: US-112
Given a stored toggle set to off
When the plugin loads hermetically
Then 0 Realm tools are registered, 0 paints occur, and 0 workspace mutations occur
check: hermetic tool count, paint count and mutation count
automated: true

AC-38 story: US-112
Given a stored toggle set to off
When Realm restarts 1 time
Then 0 Realm tools remain registered and the persisted value is still off
check: persisted flag and tool count
automated: true

## US-113 — Realm UI merged into the additional UI

AC-39 story: US-113
Given an active realm with the toggle on
When 1 status paint executes
Then 0 calls reach the under-bar status surface and 1 render lands in the additional UI region
check: paint target call counts
automated: true

AC-40 story: US-113
Given the daemon snapshot reports 1 of 4 states
When 4 paints run, one per state among unbound, connecting, active and error
Then painted text matches the snapshot in 4 of 4 cases with 1 label per paint
check: painted text equality across 4 states
automated: true

AC-41 story: US-113
Given the toggle set to off
When 1 status poll runs
Then 0 paints occur and the last truthful text is retained unchanged
check: paint count and retained text
automated: true

## US-114 — Production-grade quality bar on the release line

AC-42 story: US-114
Given the change branch
When the 8 standard gate commands run
Then each exits 0 with 0 failures across all suites
check: gate exit codes
automated: true

AC-43 story: US-114
Given CI on Node 22 and Node 24 legs
When the continuous integration workflow runs
Then the run is green on 2 of 2 versions with 0 failed jobs
check: continuous integration job verdicts
automated: true

AC-44 story: US-114
Given the baseline dependency count
When the vulnerability audit runs
Then the audit exits 0 and the dependency count differs by 0 from the baseline
check: audit exit code and dependency count delta
automated: true

## US-115 — Phase 55: Omp plugin health check

AC-45 story: US-115
Given injected fakes with 1 healthy plugin installed
When the doctor check runs
Then 1 check reports pass and names 1 installed version
check: doctor report line
automated: true

AC-46 story: US-115
Given 3 failing cases among not installed, wrong version and not loaded
When the doctor check runs
Then it reports 1 named remedy per case in 3 of 3 cases and 0 installs or removals occur
check: remedy text and mutation count
automated: true

AC-47 story: US-115
Given the Omp lifecycle runbook
When each doctor outcome is read
Then 1 section maps 3 outcomes to remedies with dated evidence cited and 0 steps signal foreign processes
check: runbook section count and evidence citations
automated: true

## US-116 — Phase 56: F-51-1 dirty-stop cause

AC-48 story: US-116
Given a live dirty-stop window
When 20 consecutive variant-c stop-then-up iterations run
Then every dirty stop carries 1 failed-step cause code and failedTeardowns equals 0
check: cause code count and failedTeardowns value
automated: true

AC-49 story: US-116
Given the phase record
When the cause section is read
Then it names 1 failing step with its reason, or 1 tested reason to carry with 0 folding into F-41-1
check: record content
automated: true

AC-50 story: US-116
Given a bounded cause fix
When 20 iterations complete
Then every wait stays bounded by 1 timeout each and the orphan count stays 0
check: wait bounds and orphan count
automated: true

## US-117 — Phase 57: HTIER-01 attribution retest

AC-51 story: US-117
Given a live Grok Build session on the production stack
When it writes both files
Then 1 audit line carries grok-build attribution with 1 handshake and 6 tools listed
check: audit attribution and tool count
automated: true

AC-52 story: US-117
Given the retest outcome
When the registry row and gap rows are read
Then HTIER-01 is met, or GAP-40-01 stays accepted-residual with 1 missing feature named and 1 verified workaround documented
check: registry row and gap row content
automated: true

## US-118 — Phase 58: KIMV-02 recorder fix and rerun

AC-53 story: US-118
Given the old recorder code
When 1 hermetic response test runs
Then the old code drops 1 response and the fixed code retains 1 response
check: dropped and retained counts
automated: true

AC-54 story: US-118
Given a live rerun with the fixed recorder
When the kimi mcp test runs 1 time
Then 1 wire log is kept with full output and 1 version plus date recorded
check: wire log count and version and date fields
automated: true

AC-55 story: US-118
Given the rerun result
When the phase record and gap rows are read
Then KIMV-02 is met, or carried with 1 tested reason and the GAP-43-03 label is unchanged
check: phase record and gap label
automated: true

## US-119 — Phase 59: concurrent binding behind ratification

AC-56 story: US-119
Given no owner ratification citing a date
When the change is submitted
Then 0 implementation files land and 1 gate-blocking statement records the missing ratification
check: merged file count and gate statement
automated: true

AC-57 story: US-119
Given ratification cited by date
When implementation lands
Then it follows 53-DESIGN section 4 surfaces with 1 new module, 2 path helpers, 0 new catalogue codes and 0 shims
check: file list and catalogue diff count
automated: true

AC-58 story: US-119
Given a dated ratification
When 6 hermetic contention cases run
Then 6 of 6 cases pass with stale takeover capped at 3
check: test counts and takeover cap
automated: true

## US-120 — Notion and Linear tracking through Notion

AC-59 story: US-120
Given the Notion workspace
When each of 5 phases 55 to 59 is queried
Then 5 pages exist, 1 per phase, each linking 1 phase id and 1 status
check: page count per phase
automated: true

AC-60 story: US-120
Given the Linear workspace
When the 5 phases are listed
Then 5 issues exist with 0 duplicates, each linking 1 phase id, 1 or more plan ids and 1 or more requirement ids
check: issue counts, duplicate count and link fields
automated: true

AC-61 story: US-120
Given 1 phase page and its issue
When either record is opened
Then each references 1 counterpart link by id
check: link field equality
automated: true

## US-121 — Green-CI pull request merge to main

AC-62 story: US-121
Given the pull request to main
When the 11 verification checkboxes run
Then 11 of 11 exit 0 with every template section completed
check: checkbox results and section completion
automated: true

AC-63 story: US-121
Given the pull request
When review completes
Then Greptile reports 5 of 5 reviews with 0 open comments and 1 reviewer approval before merge
check: Greptile verdict and approval count
automated: true

AC-64 story: US-121
Given the merged pull request
When main is read at the merge commit
Then 1 squash merge exists with 0 edited version fields and 0 CHANGELOG lines in the diff
check: merge commit count and diff stat
automated: true
## US-122 — Ultrathink W1: stale verdict retires on tracker completion

AC-65 story: US-122
Given 48 pending tracker rows staged with 1 partial_failure verdict
When tracker completion writes 0 pending rows and complete status
Then release recomputes verdict to ready with 0 stale partial_failure rows remaining
check: stale verdict count and ready state
automated: true

AC-66 story: US-122
Given a spec rewritten with 0 pending rows after tracker completion
When release is read 1 time
Then reported pending count equals 0 and stale verdict count equals 0
check: pending count equality
automated: true

AC-67 story: US-122
Given a tracker state at 1 pending row
When the completion gate runs
Then release reports not_ready with 1 pending row named
check: not_ready state and named pending count
automated: true

## US-123 — Ultrathink W2: proceed answer survives reload

AC-68 story: US-123
Given 1 proceed answer with 3 settled answers Q1, Q2, Q3
When the session ends with SIGTERM and relaunches
Then kickedOff equals true with 3 of 3 settled answers restored and 0 settled questions re-asked
check: kickedOff flag and restored answer count
automated: true

AC-69 story: US-123
Given 1 proceed answer recorded
When kickoff starts
Then ANSWER persistence is recorded before kickoff step 1 completes with 1 persisted record
check: persistence ordering record
automated: true

AC-70 story: US-123
Given a reload with persisted kickedOff true
When the host renders the next turn
Then 0 blocking proceed prompts render and continuation resumes at 1 recorded step
check: blocking prompt count and resume step
automated: true

## US-124 — Ultrathink W3: incomplete notice advises and continues

AC-71 story: US-124
Given 1 staged incomplete verdict with 1 pending set
When the host renders the plan notice
Then output holds 1 advisory note naming the pending count with 0 banned STOP, proceed or confirm strings
check: banned string count and advisory presence
automated: true

AC-72 story: US-124
Given 1 advisory incomplete state
When the next request runs under gsd-autonomous
Then 1 request continues with 0 manual proceed steps required
check: continuation count and manual step count
automated: true

AC-73 story: US-124
Given the advisory path active
When incomplete metrics are read 1 time
Then pending count and incomplete verdict stay visible with 1 warning line and 0 warnings suppressed wholesale
check: warning line count and visible metrics
automated: true

## US-125 — Tb559-be resume: signing waiver for BE and FE commits

AC-74 story: US-125
Given 2 commits 90b18ce and 0d5032f recorded with %G?=N and 0 keys provisioned
When be_patch_shape_check runs over the 2 commits
Then commits_signed failures equal 0 with 1 waiver record per commit
check: waiver records and failure count
automated: true

## US-126 — Tb559-be resume: preserve think commit and split pull requests

AC-75 story: US-126
Given 1 commit c53a15c present in local history
When branch swarm/Tb559-think at c53a15c is created and pull request 259 history is read
Then 1 branch holds c53a15c with 0 loss and pull request 259 holds 1 commit
check: branch head and pull request commit count
automated: true

AC-76 story: US-126
Given pull request 259 rebased onto 0d5032f
When force-with-lease update lands on the swarm branch
Then pull request 259 diff holds 1 commit and main holds 0 forced pushes
check: diff commit count and main push count
automated: true

## US-127 — Tb559-be resume: extend host suite to 119 of 119

AC-77 story: US-127
Given src/host/omp.test.ts as 1 of 6 target files with 1 partial-plan test at line 454
When src/host suite runs
Then the suite reports 119 of 119 passed with 0 failures and the test asserts 1 advisory note with fatal-path silence unchanged
check: passed count and advisory assertion
automated: true

## US-124 — Ultrathink W3 verification matrix extension

AC-78 story: US-124
Given 1 complete plan in herdr
When the host renders live and after reload with 2 renders
Then 0 advisories render in 2 of 2 renders
check: advisory count across 2 renders
automated: true

AC-79 story: US-124
Given 1 incomplete plan with 1 graph id and row count
When the host renders the notice 1 time
Then 1 advisory renders naming graph id, row count, and 1 unblocking action with 0 banned strings
check: named graph, row count, unblocking action, banned count
automated: true

AC-80 story: US-124
Given 1 advisory rendered 1 time with state unchanged
When 2 polls run over unchanged state
Then prompt count stays at 1 with 0 second prompts
check: prompt count across 2 polls
automated: true

AC-81 story: US-124
Given 1 malformed or missing plan state
When the host reads state 1 time
Then 1 named failure renders with 0 silent drops
check: named failure count and silent drop count
automated: true

## US-128 — Tb559-be resume: gates, Linear, planning hashes, CAPT-09 record

AC-82 story: US-128
Given 6 Tb559 plans Tb559-data, Tb559-fe, Tb559-be, Tb559-qa, Tb559-rev, Tb559-sec plus build, rel, obs, docs plans
When each named gate plan runs
Then each named gate plan exits 0 with 0 failures
check: gate exit codes
automated: true

AC-83 story: US-128
Given 4 Linear issues SPE-36512, SPE-36513, SPE-36515, SPE-36516
When sub-issue updates complete per task
Then 4 issues carry 1 commit ref each with Refs SPE-3651x and 1 PR body fix ref each with Fixes SPE-3651x
check: issue update refs
automated: true

AC-84 story: US-128
Given .planning STATE.md and ROADMAP.md
When sha256 hashes are read
Then STATE hash starts 29bc314a and ROADMAP hash starts 4b26403c with 0 planning edits
check: hash prefixes and edit count
automated: true

AC-85 story: US-128
Given 1 CAPT-09 record at docs/integration/runtime-decision.md line 753 from commit b37b94c
When pull request scope is read
Then 1 record routes CAPT-09 to A08 with 0 fixes in this scope and 0 block on scoped DONE
check: routing record and fix count
automated: true

## US-129 — SEC canary split in the boot-report test fixture

AC-86 story: US-129
Given 1 test file test/host/boot-report.test.ts at line 177 with 1 literal 40-character fixture
When the fixture is split into 2 concatenated parts and committed on swarm/Tb559r-capt09
Then the repository holds 0 literal fixture strings and 1 commit holds 2 parts
check: literal fixture grep count and commit diff
automated: true

AC-87 story: US-129
Given 1 compiled boot-report test file with the 2-part fixture
When node --test runs on the compiled file 1 time
Then 1 run exits 0 with 0 failures and refusal assertions report 0 echoes of the fixture
check: test exit code, failure count and echo count
automated: true

AC-88 story: US-129
Given 1 repository on swarm/Tb559r-capt09 with the 2-part fixture
When the secret scanner runs 1 time
Then the scanner reports 0 secrets with 0 literal fixture occurrences
check: scanner secret count and literal occurrence count
automated: true

## US-130 — Conditional merge of pull request 256

AC-89 story: US-130
Given 1 branch swarm/Tb559r-capt09 in the 354f00a line with 5 docs files
When local gates check-docs, test-scripts, build, lint and 1 compiled boot-report run execute plus CI reruns on the split commit
Then each local gate exits 0 and CI Verify on Node 22.x and 24.x passes with the docs site, the breaking-change check and the audit all passing and 0 failures
check: local gate exit codes and CI job verdicts
automated: true

AC-90 story: US-130
Given 1 merged main tree after pull request 256 merges
When npm run check:docs runs on main 1 time
Then the command exits 0 with 0 failures
check: check-docs exit code and failure count
automated: true

AC-91 story: US-130
Given 1 pull request 256 with local green and CI green and 1 Greptile offline signal
When the ship flow merges 1 time with squash
Then main holds 1 merge commit, the pull request body records 1 Greptile absence note and 0 claims of 5 of 5 reviews appear
check: merge commit count, absence note count and 5 of 5 claim count
automated: true

## US-131 — Round 3 gates, W3 matrix and Linear close-out

AC-92 story: US-131
Given 1 merged main tree
When plans qa.r3, rev.r3, sec.r3, build, rel, obs and docs run
Then 7 of 7 plans exit 0 with 0 failures
check: plan exit codes and failure counts
automated: true

AC-93 story: US-131
Given 1 ultrathink stack with commits a519184 and 0d5032f
When the 9 W3 checks across the 3 waves run
Then 9 of 9 checks report green with 0 failures
check: W3 check verdicts and failure counts
automated: true

AC-94 story: US-131
Given .planning STATE.md and ROADMAP.md on the merged main tree
When sha256 hashes are read 1 time
Then the STATE hash starts 29bc314a, the ROADMAP hash starts 4b26403c and 0 planning files changed
check: hash prefixes and changed-file count
automated: true

AC-95 story: US-131
Given 4 sub-issues n3 SPE-36512, n4 SPE-36513, n6 SPE-36515 and n7 SPE-36516
When round 3 gates and the W3 matrix pass
Then 4 of 4 sub-issues close with 1 commit ref each and 0 sub-issues close before gates pass
check: closed sub-issue count and commit ref presence
automated: true

AC-96 story: US-131
Given 1 final resume report
When the report is read 1 time
Then the report names 1 state for pull request 255 and 1 state for pull request 259 with 2 of 2 states listed
check: named state counts for 2 pull requests
automated: true

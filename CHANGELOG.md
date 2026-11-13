# Changelog

This changelog follows Keep a Changelog 1.1.0, and the project follows Semantic Versioning. The release line rule is described in AGENTS.md under Versioning and release.

## [Unreleased]

## [0.3.28] - 2026-11-13

### Added
- feat(checkpoint): pin a stopped project in memory for realm checkpoint (RES-04) (455671a)
- feat(checkpoint): add the typed no-daemon signal and the shared workspace entry constructor (835fb9c)
- feat(policy): cap startupBudgetMs at the client up wait in the schema (a7b765c)
- feat(15-07): plain doctor names an absent or invalid config and passes its paths (5b8b401)
- feat(15-07): the daemon passes configPath and driverSocketPath to its doctor (42749a0)
- feat(15-06): one-item report names the config problem keys; DoctorOptions carries configPath, configProblems and driverSocketPath (bb6ed18)
- feat(15-06): gateway runs openshell status; the TLS dial and the daemon's gateway names are removed (35ae71f)
- feat(15-06): driver-socket takes its path and checks the socket and parent owner (78e5292)
- feat(15-06): runtime-roots checks the channel path, canonical form, owner, overlap and config location (819c20a)
- feat(15-04): refuse overlapping explicit roots and describe config problems by key (7bb6316)
- feat(lifecycle): carry the recovered and failed-write codes on the next transition (58c3e23)
- feat(daemon): keep a removal's own code when the listing proves the container gone (c207665)
- feat(observe): count the file-sink lines that went to stderr as logLinesFallback (277b155)
- feat(daemon): count the start-failure scan's non-JSON lines and report the count (92cd86e)
- feat(mcp): answer a line that is not JSON with a parse error (2d548e1)
- feat(daemon): name a failed log close, and count failed teardowns on daemon.stopped (2268202)
- feat(daemon): name each startup removal's cause and each adopted container in daemon.startup (47fbbef)
- feat(driver): log each adoption's kept and removed containers (RES-02) (6fdc7ea)
- feat(session): keep a workspace pin per session (7b511e2)
- feat(phase-19): refuse to adopt a session whose runner cannot be proven gone (row 39) (15c81ea)
- feat(phase-19): add the selected-project checkpoint CLI over the snapshot library (RES-04) (47470e6)
- feat(phase-19): snapshot and restore a workspace with a manifest check, a registry pin and a cross-process lock (RES-04) (c9a59d5)
- feat(phase-19): verify the stored pin before hydration, bound hydration, and serve while sessions hydrate (row 38, D19-7) (a8fa08d)
- feat(phase-19): rebuild the driver registry and respawn supervisors at startup, cut over from the sweep (CS-3, CS-6) (466f1b4)
- feat(phase-19): grant the scratch mount point read-write in the sandbox policy (R3) (3cb0a11)
- feat(phase-19): persist a scratch volume per session and verify its exact mount (R2) (d7094b6)
- feat(phase-19): cut the driver startup over to selective adoption (RES-02) (15cf3a7)
- feat(phase-19): cut the daemon startup over to selective adoption (RES-02) (b3411bc)
- feat(phase-19): adopt verified driver sandboxes beside the destroy-all startup sweep (RES-02) (679aad0)
- feat(phase-19): hydrate an adopted survivor without a second create (RES-02) (87743e7)
- feat(phase-19): verify adopted sandboxes in one shared verdict and select survivors in the startup reaper (RES-01) (e355079)
- feat(phase-18): Omp attach checks the session of a refused up and follows a session switch (MULTI-02, MULTI-03, plan 10) (e7c2cb6)
- feat(phase-18): attribute startup orphan removals to their session and reap registry entries (MULTI-03, plan 09) (c42b312)
- feat(phase-18): CLI addresses each project by its selection (MULTI-02, MULTI-03, plan 08) (b42cb35)
- feat(phase-18): selected dispatch, session down and signal shutdown (MULTI-02, MULTI-03, MULTI-06, plan 06 T2) (bd43453)
- feat(phase-18): per-project sessions, selection resolution and admission (MULTI-02, MULTI-03, plan 06 T1) (552434e)
- feat(phase-18): bind the session's own workspace per request, not the configured pin (MULTI-02, plan 04b) (ff80844)
- feat(phase-18): selection-tagged control requests and per-client detach (MULTI-03, plan 05) (5b90aad)
- feat(phase-18): resolve the driver sandbox mount from the workspace registry (MULTI-02, MULTI-04, plan 04) (276e64e)
- feat(phase-18): aggregate admission ledger and derived maxSessions (MULTI-06, plan 03) (c7469dc)
- feat(phase-18): session identity, workspace registry and runtime stateDir (MULTI-02, MULTI-04, plan 02) (86e5cc2)
- feat(release): publish rollback docs from a validated known-good tag, and drop features removed without revert (REL-03, REL-04) (60b3934)
- feat(release): add a rollback workflow and drop reverted features from the changelog (REL-03, REL-04) (b9658df)
- feat(daemon): log lifecycle, control, and startup events as JSON lines (1829d4f)
- feat(omp): re-attach the plugin after a dropped link, behind REALM_OMP_REATTACH (phase 16, O4) (984d758)
- feat(omp): keep bash for the guard in fail-closed and bound host tool changes (phase 16, OMPX-02/03/04) (2e5e6c5)
- feat(release): add a rollback workflow and drop reverted features from the changelog (REL-03, REL-04) (148559e)

### Changed
- address greptile review feedback (093e34a)
- address greptile review feedback (a508ea2)
- address greptile review feedback (90b00f5)
- address greptile review feedback (f6f7c3b)
- address greptile review feedback (d27c2ed)
- address greptile review feedback (5d224b5)
- refactor(lifecycle): move session-state, bounds and adoption out of the controller (6bf1628)
- refactor(driver): move compute-driver helpers into create, state and output modules (451414f)
- refactor(daemon): split startup maintenance and seams out of daemon.ts (f813448)
- refactor(driver): move sandbox tree guards out of lifecycle.ts (fc72a7f)
- refactor: split host-binary checks and re-attach policy out of large modules (bcfabcb)
- refactor(driver): add one shared containment guard module (3068e6c)
- refactor(phase-19): one process-identity parser, a lock that is never empty, and REALM_NOT_ACTIVE from the library (6b929f5)
- refactor(quality): assert the dialers resolve with doesNotReject instead of a type cast (f746474)
- refactor(quality): share one dial, one sleep and one LibpodClient constructor; reject with catalogue codes (fe5c20e)
- refactor(agentos): give the backoff wait its own helper, so settle always has a timeout (680ef47)
- refactor(audit): drop export from readTailHead, which only its own file uses (7c044b6)
- refactor(audit): share leaf and node hashing between the chain and the anchor (334c1ad)
- refactor(runtime): remove qualified unused loader and refusal seams (4de1b4a)

### Fixed
- fix(omp): report a delivered write whose reply is lost or malformed as unknown outcome (95494ab)
- fix: close defects from the codebase quality audit (89aba92)
- fix(omp): refuse guarded calls when the daemon status cannot be read (CR-01) (38d5778)
- fix(checkpoint): require name and label absence before restore (dd568c6)
- fix(release): smoke-check repair tarball before handoff (75631f4)
- fix(omp): disclose host-tool guard limits (63f4262)
- fix(daemon): read the start-failure log by identity so a rotation cannot hide a failure (5c79211)
- fix(cli): name the failing config key when a state-directory command cannot load the config (eb056f1)
- fix(15-06): route the gateway status argv through openshell.ts and move runtime option building out of checks.ts (8d0be55)
- fix(daemon): pass the gateway CA into a spawned daemon (e34da60)
- fix(audit): report a listing error with no catalogue code as AUDIT_WRITE_FAILED (708cca0)
- fix(daemon): close the startup cause set in the type, and test the label-mismatch cause (b62f2e1)
- fix(audit): count an unparseable log on each start without rescanning it (5c12560)
- fix(driver): satisfy the export-usage gate after the adoption cause set (9b7a82a)
- fix(audit): count an unparseable audit line as a failure of its log (682e6df)
- fix(daemon): treat every dial failure but a refusal or a missing path as unknown (52300a3)
- fix(audit): keep pre-chain logs continuing past the lookback (D-1702) (6641d34)
- fix(audit): fail closed on an unparsable chain tail line (164282d)
- fix(daemon): refuse the start when the socket probe times out (6cf801e)
- fix(doctor): name the catalogue code in driver, gateway and andaUrl check details (2e80985)
- fix(fs): count a refused exclusion audit line as a failure (4a924d1)
- fix(driver): refuse a create whose stale check cannot read the directory with the read's code (17d3abc)
- fix(runtime): route runner dispose failures to the fixed line and fail a rejected backoff wait (7c45667)
- fix(mcp): name the code on the malformed-line diagnostic (cf897ae)
- fix(cli): print the catalogue code on stderr for anchor, down, audit and checkpoint refusals (8f3421f)
- fix(daemon): carry the probe code on a start timeout and the refusal code on startup (baba70b)
- fix(lifecycle): keep a stop-owned overtaken failure for the next destroy (4ac65e3)
- fix(observe): keep the log open when the tail probe fails (e068496)
- fix(daemon): keep new events out of the closed list and count delivered request lines as delivered (2d5604f)
- fix(audit): count reconcile run failures and carry sweep codes into the startup report (d7c16ce)
- fix(driver): write cause lines apart from refusals (89b9e62)
- fix(audit): record sweep and reconcile failures with their codes, and mark a failed listing incomplete (120b4f3)
- fix(driver): record refusal and cleanup codes, and refuse DeleteSandbox during the rebuild (72691ca)
- fix(runtime): carry the cleanup cause through agentos stop and start (4e82fb4)
- fix: fail closed on an owner that cannot be proven gone, and report unreadable audit directories (87459fd)
- fix(daemon): report startup and stop failure codes instead of dropping them (d3bbafc)
- fix(observe): count log drops by category instead of discarding them (cb03d46)
- fix(checkpoint): open every checkpoint source without blocking (31d74ce)
- fix(session): let up bind a replaced directory instead of refusing it (6a27a81)
- fix(checkpoint): keep the lock tombstone on any link failure, climb only on ENOENT, clear partial checkpoints (bd9aa8c)
- fix(driver): hold List, Get and Watch until the registry is rebuilt (b6138ad)
- fix(checkpoint): resolve a stopped project's workspace from its pin (47ab96c)
- fix(daemon): pin the workspace on up and keep the pin across down (4a7f2e8)
- fix(checkpoint): settle a rejected in-flight start before dropping its share (881bc07)
- fix(cli): exit explicitly after a checkpoint command writes its output (ed56d79)
- fix(checkpoint): refuse a non-regular manifest without blocking (fde798b)
- fix(gate): exempt public-signature exports from the export-usage gate (abdab8b)
- fix(checkpoint): bound cleanup waits and report committed-work cleanup as warnings (0c5abbd)
- fix(phase-19): hold the session's checkpoint lock for every sandbox start (row 58, RES-04 quiescence) (60c35c3)
- fix(phase-19): recover a restore that crashed after a snapshot-only name moved in (RES-04) (967ff98)
- fix(quality): name a missing allowlisted file in the module-size message (d218b2d)
- fix(phase-19): keep the create contract, narrow the attach refusal, pin the scratch options, keep the driver sweep (R2) (59f0fc7)
- fix(quality): log a non-RealmError listener failure as listener_error; pin the CI skip policy and the spawn-env signal (1cdd511)
- fix(phase-18): clear lint errors in plan 06 to 11 code and tests (5ddc95e)
- fix(docs): keep GitHub expressions in inline code from interpolating on the site (b7b66a5)
- fix(driver): refuse secret-entry removal outside the secret directory (e689071)
- fix(audit): report a typed anchor-check error by its code, not as unreadable (343cba6)
- fix(doctor): verify the gateway certificate against REALM_DRIVER_GATEWAY_CA (4909fc4)
- fix(anda): log a failing bridge listener with its catalogue code (Q0-012) (a559e68)
- fix(observe): put the up correlation id on tool-call audit lines (OBS-02, O-g) (3a6decc)
- fix(audit): read the audit head from the file tail (OBS-02) (4eba167)
- fix(daemon): log control refusals for unrecognized lines (OBS-02) (757a6b2)
- fix(daemon): write entry records to the rotating daemon.log sink (a044d12)
- fix(audit): redact NAME=value in linear time (1fa6c98)
- fix(onboarding): safely initialize roots and expose doctor repairs (3e53dcf)

### Documentation
- docs(12): record current Phase 12 verification state (ecfdba3)
- docs(phase-12): reopen HARN-02, HARN-04 and OMP-05 pending current-source live evidence (a6e947e)
- docs(12-03): summary for the HARN-02 registered-write tests and guard alignment (86ee9b9)
- docs(omp): describe the guard suite cases after the owner ruling (17a7900)
- docs(12-02): summary for the CR-01 unreadable advisory status fix (422e043)
- docs(omp): describe the refusal on an unreadable advisory status (82d8654)
- docs: redact host-local paths in evidence references (check:docs) (571d474)
- docs(quick-261108-puz): reconcile milestone evidence (7ade102)
- docs(quick): record checkpoint and driver diagnostics (759187e)
- docs(quick): record verified Omp and release fixes (6aa5091)
- docs(verification): refresh phases 13 through 17 evidence (f625453)
- docs(quick-261108-puz): Reconcile the v3.0 planning records with the integration line: stale STATE progress, REQUIREMENTS checkboxes, phase 13, 14, 17, 18, 19 and 20 verification and held-owner notes, scenario counts in AGENTS.md, README.md and openshell.md, and the live window results (f581e5c)
- docs: reconcile runtime logging and live suite descriptions (09ec888)
- docs(quick-261108-q1v): Fix three live-suite test defects found by the first non-gateway window: scenario 5 marker cleanup, scenario 5b audited write before the stop, scenario 6 metrics with the workspace argument (daef02d)
- docs(quick-261108-qkn): Fix gateway live scenario metrics workspace selection and stale log rotation comment (131b4a9)
- docs(quick-261108-ncc): Live scenarios 5b and 5c and the audit-pair validator (Phase 14 and 17 live suite) (c39abe6)
- docs(quick-261108-ncb): Rewrite live scenario 5 to the startup re-adoption behaviour (Phase 14 and 17 live suite) (21693b1)
- docs(quick-261108-nci): Drop actions write from the mutation workflow by cherry-picking 33dd980 (QR-08, D-1308) (b16a828)
- docs(quick-261108-ovn): Pin the in-place truncation branch of the start-failure reader (Phase 17, OBS-02): a test-only change (c05cc22)
- docs(quick-261108-nch): Phase 20 offline release-script coverage: rollback script and changelog fixtures (REL-03, REL-04) (520eba7)
- docs(quick-261108-ncd): Close the offline Phase 17 gaps: rotation-aware startup reader, anchor export, audit tests (9ee3d81)
- docs(quick-261108-ncf): Pin the daemon invalid log level warning in test/daemon/main.test.ts (Phase 17 gap 2) (52388dd)
- docs(quick-261108-nca): Commands that cannot load the config name the failing key and point at realm doctor (097256f)
- docs(quick-261108-ncg): Finish the QR-05 timing migration: caps and the two blind sleeps (Phase 13) (6784dbb)
- docs(quick-261108-nc8): realm checkpoint pins the workspace itself for a stopped project (RES-04 owner decision) (f1e3cac)
- docs(quick-261108-nc7): Cap policy startupBudgetMs at the client up bound in the schema (Phase 18 owner item b) (91d4afe)
- docs(15-09): record post-verification correction in summary (d22aa5d)
- docs(15-09): replace false driver-restart reap claim with adoptSurvivors behaviour (8d4d9c0)
- docs(15-09): add plan summary, update state and roadmap (252367c)
- docs(15-09): name spawn-env.ts and runtime-checks.ts in the layout (f6e547b)
- docs(15-09): date the eleven-item doctor record (4daa9ce)
- docs(15-09): describe the three runtime doctor items and the driver-roots cutover (bc4989d)
- docs(15-09): name secretRoot and sandboxStateRoot in the runtime config section (a6470d2)
- docs(15-07): drop a host-local path from the summary (e894e6e)
- docs(15-07): add plan summary, update state and roadmap (fe73e12)
- docs(15-08): add plan summary, update state and roadmap (c2c755b)
- docs(15-08): correct the live suite header; the driver roots live in the scenario config.json (4cd8cc7)
- docs(15-06): correct summary after orchestrator verification (54deb09)
- docs(15-06): update state and roadmap for plan 06 (7f6ef64)
- docs(15-06): add plan summary (621a288)
- docs(15-05): update state and roadmap for plan 05 (f0412bd)
- docs(15-05): add plan summary (196f676)
- docs(15-04): update state and roadmap for plan 04 (84d63bc)
- docs(15-04): add plan summary (93455cb)
- docs(15-03): complete plan 03 summary, state and roadmap (b2803b8)
- docs(15-03): add the doctor sentence to the policy-reference Upgrading subsection (0643ad3)
- docs(15-03): name the doctor and its exit code in the README Upgrading paragraph (5402dcb)
- docs(15-02): update state and roadmap for plan 02 (866d509)
- docs(15-02): add plan summary (092844d)
- docs(15-01): update STATE and ROADMAP for plan 15-01 (7aa759d)
- docs(15-01): complete the default-policy-mode reconcile plan (6afaade)
- docs(omp): move the plugin tool-list observation out of the enforcement spike section (17d0355)
- docs(integration): record which removal-code result reaches a log (43b6ead)
- docs(integration): record the 2026-11-07 rulings on the open runtime-decision items (30ece2e)
- docs(integration): correct the item 2 ruling's premise and scope the RES-02 ruling (c6d0ccd)
- docs(integration): correct the RES-05 record for scenario 11 and the scenario 5 checks (0ece29d)
- docs(integration): record the round 13 ruling on the RES-05 items not authored (3d2b167)
- docs(integration): correct the scenario 5 note for the adoption expectations (c6b28de)
- docs(integration): record the round 13 rulings for audit item 2 and RES-02 (4b29d25)
- docs(integration): record the refused subagent yield as an OMPX-03 finding (3cea96b)
- docs(integration): point the Adopted definition at the pin and runner checks (D19-7, D19-8) (048904b)
- docs(integration): correct the S11 warm attribution and record the 2026-11-06 runs (6db9f23)
- docs(integration): align the phase 19 adoption clause to the openshell labels (D19-1) (c375f2c)
- docs(audit): align the parseLine comment with the item 15 refusal (e15fc8b)
- docs(integration): record the owner's acceptance of the torn-tail consequence (item 15) (528ddf5)
- docs(integration): record the S11 lever run on Omp 18.16.0 (scripted, proxied) (57e7fdf)
- docs(integration): correct the item 12 note: phase 18 plan 06 is already in this branch (0e3e700)
- docs(integration): record the phase 18 overlap in the item 12 note (322ae6a)
- docs(integration): correct the HARN-03 attribution and record the llama.cpp discovery port (0477035)
- docs(integration): record the bounded HARN-03 probe on Omp 18.16.0 (a341199)
- docs(integration): record the owner rulings of 2026-11-06 for items 9, 12, 15 and D19-1 (be253b8)
- docs(runtime): state the refused exclusion-line failure and reword owner item 3 (d918e45)
- docs: name the export gate in the layout and record the silent-path decisions (30f7ae2)
- docs(runtime): record the review fixes and the owner items of 2026-11-05 (4c1af71)
- docs: correct stale source paths and check:gates lists (ef4f897)
- docs(runtime): restore the D19-5 readiness clause and record the restart recovery route in D19-10 (d5e7dcc)
- docs(runtime): record D19-10 for the workspace pin and update the layout (eb26673)
- docs(openshell): record the open question on UNAVAILABLE during reconcile (125ecd2)
- docs(checkpoint): document realm checkpoint, its refusal codes and its limits, and record D19-9 (092c255)
- docs(cli): correct the checkpoint known-gap comment now that the start lock closes the race (2a73d9b)
- docs(agents): list the round 4 paths, correct the D19-8 runner sentence, and put D19-6 in order (79225d8)
- docs(phase-19): record the RES-04 spike and select a copy with a manifest check (D19-6) (966fdf7)
- docs(agents): record the module-size ratchet in the Commands, Layout and Conventions (83e3e0a)
- docs(phase-18): correct the T2 deviations to match the tests (8e14a09)
- docs(phase-18): record the final gate run, plan status and held items (6ef2bf2)
- docs(phase-18): cleanup residue check names the scenario's own sandboxes (b1378dd)
- docs(phase-18): document per-project sandboxes, selection, switch rule and status (plan 12) (a7f2ce2)
- docs(phase-18): replace host paths in lane summary with repo-relative references (5ba3421)
- docs(phase-18): clarify 18-06 T1 case (m) reservation wording (84b6ed5)
- docs(phase-18): record the lane run status; plan 06 BLOCKED at T1 (MULTI-01..06) (ea6feea)
- docs(phase-18): add waitMs to the withSessionLock signature in plan 06 (fe0c231)
- docs(phase-18): apply the review fixes to the admission design and record the final plan-check verdict (d521561)
- docs(hosts): name REALM_DRIVER_GATEWAY_CA among the doctor gateway inputs (cb1ef3c)
- docs(core,contract): document every export of src/core and src/contract (7314650)
- docs(phase-18): record the per-project session contract (MULTI-01..06, plan 01) (4bfca1a)
- docs(phase-18): apply plan-check round 9 to session plans (f9dbc54)
- docs(phase-18): serialize admission per session id in plan 06 (4deee5e)
- docs(phase-18): reword plan 12 external-gate ordering so the frontmatter parses (fa98fcc)
- docs(phase-18): apply plan-check round 7 step 5 release justification (fd6b587)
- docs(phase-18): apply plan-check round 6 fixes to session admission (2fedd99)
- docs(phase-18): apply plan-check round 5 fixes to up admission (e036fac)
- docs(phase-18): fix up admission reservation and selection plan text (8962b53)
- docs(phase-18): apply plan-check round 3 fixes (56be821)
- docs(phase-18): fix five plan-check blockers and one external gate (ebf55f3)
- docs(phase-18): fix plan 03 memory-term case and host-misfit stop rule; record owner decisions D18-1 and D18-2 (17f0b26)
- docs(phase-18): apply owner rulings for C1, C2 and C7 (8d1c0f9)
- docs(release): describe the build and publish jobs, attestation and rollback (8782614)
- docs(omp): record the owner rulings on the audit head, the unreadable warn and driver-only loss (6902860)
- docs(omp): document the OBS-02 logs, audit.head, and the open decisions (9e6ed08)
- docs(state): record the run's decisions, kickoff, and phase 13-14 evidence (1fa69c1)
- docs(state): defer phase 12 verification gaps (owner decision) (d475923)
- docs(release): describe the build and publish jobs, attestation and rollback (a6eb46b)

### Maintenance
- test(live): scenario 5 asserts the destroyed-stray notice after the restart (73c99e4)
- test(omp): treat an exited process's /proc read as not alive (8b626f8)
- ci: run the PR gate jobs on GitHub-hosted runners (82a25d6)
- test(omp): align the native guard cases with the owner ruling (C4, C4b) (f2e1e9e)
- test(omp): cover registered writes through the real dispatcher (HARN-02) (bff9168)
- test(omp): pin the owner ruling on an unreadable advisory status (19c86b1)
- chore(check): allowlist five lane-added D-1306 test-only seams so check:gates passes (9181e80)
- test(omp): state Omp's text-part separator in the O2 read-back assertion (6a6635e)
- chore(cli): drop unwired config-problems and its refusal test; origin/main refusal wording is the shipped behavior (6d98e22)
- test: take backlog versions of three lane tests that target APIs absent from backlog source (6f18cb7)
- chore: stop tracking node_modules re-added by recovery WIP snapshot (f641413)
- chore: drop stray node_modules symlink carried in wave9 WIP snapshot (0da7ded)
- chore(wip): preserve uncommitted worktree changes from gsd/autonomous-phase18-gap (55832e6)
- chore(wip): preserve uncommitted worktree changes from gsd/v3-integrate-p19 (5264d20)
- chore(wip): preserve uncommitted worktree changes from wave9-integrate (was integrate/omp-18142) (ff2df3c)
- chore(wip): preserve uncommitted worktree changes from recovery-oct31 (was swarm/realm-v3-recovery-oct31) (96bce71)
- test(driver): distinguish workspace registry refusal causes (315b4fd)
- test: fix live gateway metrics workspace (e9e0c39)
- test(live): fix three production-suite defects found by the first non-gateway window (a8cee97)
- test(live): add scenarios 5b and 5c and the audit-pair validator (9cdbe8e)
- test(live): rewrite scenario 5 to startup re-adoption (a833ece)
- ci(mutation): drop unneeded actions write permission (9e2142f)
- test(daemon): pin the in-place truncation branch of the start-failure reader (OBS-02) (b9cd28c)
- test(release): cover rollback shell steps and changelog removal fixtures (27c9782)
- test(audit): pin the unreadable-file exit and the audit head look-back boundaries (6735d4b)
- test(audit): pin merkleRootOfLeaves against roots computed with node:crypto (74ce823)
- test(daemon): pin the invalid REALM_LOG_LEVEL warning on the request log (94590fd)
- test: tolerate a process that exits before the safety-net SIGKILL in omp-live-helpers (26e9470)
- test: observe the daemon health probe through a hand-fired interval instead of sleeping 12 s (98a20e7)
- test: scale the outer timeout caps of three timer suites with testTimeout (e46b4b1)
- test(15-07): pin the CLI spawn environment and the one-item config report (1514106)
- test(15-08): pin the live suite's roots from the config file, the loader-refused gate reason and the scenario config (ONB-03) (3ac8949)
- test(15-05): prove the allowlisted environment through runCli up with the default spawn (7501c37)
- test(15-05): pin daemonSpawnEnv selection and stale root on both start paths (7fa5b46)
- test(15-04): pin the driver config-home resolution and the absent root variables (05312cd)
- test(15-04): daemon start refuses an overlapping explicit root before startDaemon (067e448)
- test(15-02): assert check:docs wiring and repo tree pass the default-mode guard (3ec9398)
- test(15-01): correct the comment on which CLI path reads the policy file (490783c)
- test(15-01): pin the schema mode default and the loader provenance contract (ea4d00d)
- test(runtime): the sweep keeps a lost reply's code when its container is gone (35ecd47)
- test(daemon): inject the log sinks' file system, and test the close failure and the fallback count (8247796)
- test(live): make scenario 11 reach the verifier, and check the stray in scenario 5 (8d11af3)
- test(live): author the RES-05 scenarios and migrate scenario 5 to adoption (9b11336)
- test(omp): point the proxied runs at llama.cpp 8080 for HARN-03 (owner lever) (21ea64f)
- ci(mutation): drop actions write from the job permissions (5a78c67)
- test(observe): assert the REALM_LOG_LEVEL warn line (P17-O4) (bd1aa12)
- chore(gate): drop the stale DaemonPresence export-usage allowlist entry (d0dd220)
- chore(gate): run the export-usage gate in check:gates (E-11) (b61fa8a)
- chore(ratchet): retire the compute-driver entry and lower the controller ceiling (f815416)
- chore(ratchet): retire allowlist entries for the split modules (cb1d91c)
- test(mutation): give the baseline campaign headroom (4d7d277)
- test(driver): reword the residual sweep wording (3a7ed99)
- test(daemon): assert the hydration budget ordering directly (2a84343)
- chore(quality): re-measure the module-size ceilings on the merged candidate, and record D19-8 (f2f64f5)
- chore(quality): gate src module size with a ratchet allowlist (6768a0d)
- test(phase-18): two-project live scenario with derived sandbox names, skipped by default (MULTI-04, MULTI-05, plan 13) (b18b20e)
- test(phase-18): two projects on one daemon across the CLI, MCP, ACP and Omp paths (MULTI-03, MULTI-05, plan 11) (7eb19f7)
- test(phase-18): pin proofs for symlink, nested, sibling, rename-aside and relative roots (MULTI-02, MULTI-05, plan 07) (e2baed6)
- test: satisfy the lint rules on the Q0-001 and Q0-009 tests (83b2545)
- chore(scripts): hold check:exports out of npm scripts until the owner decides the public-signature rule (a6ab242)
- test(anda): assert the listener diagnostic as one structured record (66d315e)
- test(check): gate src exports that no other file imports (Q0-007) (06ff73a)
- test(fs): fail the cross-device sweep test on CI instead of skipping (Q0-015) (a710667)
- test(daemon): read the spawn env child file only after its rename (Q0-014) (5ca26cc)
- ci: skip a release in build only when it is published with every expected asset (e2c3761)
- ci: create releases as drafts and publish them only after every asset is uploaded (a2f94da)
- ci: make publish retries idempotent, check ancestry first and use one release date (b29db2e)
- ci: regenerate the release commit in publish instead of applying build output (9752048)
- ci: split the release job into an unprivileged build job and a publish job (REL-01, REL-02) (cbec121)
- test(runtime): hold OBS-04 overtake probe deadlines so a loaded host cannot time them out (f3e76ee)
- test(check): fail real tarballs that omit host snippets and prime-agent guides (e8e0eeb)
- test(live): assert recordsDeleted in the startup reap line helper (CRASH-04) (652919a)
- test(live): assert the OBS-02 request log and correlation join in scenario 6 (6ae7530)
- test(audit): pin fail-closed oversize appends and over-bound chain tails (2640681)
- test(omp): add fake-backed consumer controls and bounded guard evidence (phase 16, OMPX-02/03/04) (2af03b6)
- test(omp): ignore the coverage env in the spawned-child assertion (d3dffb5)
- test(omp): repair native create and isolate measured tool traces (31f3185)
- ci: skip a release in build only when it is published with every expected asset (cd87368)
- ci: create releases as drafts and publish them only after every asset is uploaded (14d2fc3)
- ci: make publish retries idempotent, check ancestry first and use one release date (ac972e4)
- ci: regenerate the release commit in publish instead of applying build output (61032cf)
- ci: split the release job into an unprivileged build job and a publish job (REL-01, REL-02) (da68a18)

## [0.3.27] - 2026-11-02

### Added
- feat(omp): forward the registered write to a reachable daemon while the realm is inactive, and refuse when unreachable (phase 16, OMPX-04) (4cea401)
- feat(audit): verify --anchor against realm anchor records by lineCount and Merkle root (phase 17, OBS-01) (d91deb0)
- feat(tools): record the sha256 of a write's input on its admission line (phase 16, OMPX-05) (6639cf6)
- feat(audit): wire checkpoint verification into realm audit verify with --file, --session, --head and --anchor (phase 17, OBS-01) (1fa8f1b)
- feat(omp): hide the same-name Realm write while disconnected in advisory mode, and restore built-ins on drift (phase 16, OMPX-02, OMPX-03, OMPX-04) (b0055ae)
- feat(daemon): write startup and early-failure lines as JSON with ts, event and code (phase 17, OBS-02) (2e48073)
- feat(audit): name the successor line and verify tail loss, prefix change and legacy lines (phase 17, OBS-01) (2aafd01)

### Changed
- refactor(runtime): remove qualified unused loader and refusal seams (a884c7d)

### Fixed
- fix(doctor): report a created state directory before its open can fail (fcb3d56)
- fix(audit): read unparsed lines in one scan and stream the anchor prefix (59804f5)
- fix(omp): keep a refused attach only for the daemon's own root (ea486f4)
- fix(runtime): a permission error on the driver socket is no answer, not driver loss (5a68eea)
- fix(omp): show the refusal code when up is refused with a live daemon (dccd974)
- fix(omp): never spawn the daemon under a Bun host (600d1a7)
- fix(omp): load the realm plugin inside the compiled Omp binary (27891df)
- fix(runtime): an unprobeable driver socket is not driver loss (76a5dc0)
- fix(runtime): report a compute driver that does not answer as OPENSHELL_GATEWAY_LOST (a24cdc2)
- fix(onboarding): safely initialize roots and expose doctor repairs (b6eaf27)

### Documentation
- docs(omp): describe the refused-up rule and its pre-upgrade case (618a579)
- docs(omp): the pinned root is the directory itself; a subdirectory is refused too (069b73b)
- docs(omp): a session outside the pinned root is refused with POLICY_DENIED (0aba1ea)
- docs: name REALM_DRIVER_SOCKET in the live prerequisites; realm up, then /realm-retry (b26b062)

### Maintenance
- test(omp): kill the MCP child when its exit deadline is missed (df728fd)
- test(omp): ignore the coverage env in the spawned-child assertion (5527882)
- test(omp): start the OMPX-05 Omp in the pinned project (8196485)
- test(daemon): wait for the spawn-env probe's complete output (c522c74)
- test(omp): add the gated real-stack OMPX-05 case and export its shared live helpers (phase 16) (beb2a28)
- test(omp): repair native create and isolate measured tool traces (6444eb2)

## [0.3.26] - 2026-10-30

### Documentation
- docs(omp): record the live isolated-profile plugin install (ONB-05) (#45) (685f3f3)

## [0.3.25] - 2026-10-30

### Documentation
- docs: state the fail-closed default and the containment limit accurately (ONB, DEF-02) (#44) (713a3db)

## [0.3.24] - 2026-10-30

### Added
- feat(omp): register the five Realm tools and enforce the fail-closed allowlist (phase 16) (#42) (4e714b8)

### Maintenance
- test(omp): rescope the no-network claim to the loopback stub with one recorded exception (#41) (318f2cb)

## [0.3.23] - 2026-10-30

### Added
- feat(doctor): report each driver root once and add the safe state-directory fix (#39) (db2f966)

## [0.3.22] - 2026-10-30

### Documentation
- docs(runtime): record per-project sessions and the reaper decision before the code (#36) (0d299a0)

## [0.3.21] - 2026-10-30

### Changed
- Drive the gsd-autonomous milestone through every remaining ROADMAP.md p… (#37) (19f234f)
- Drive the gsd-autonomous milestone through every remaining ROADMAP.md p… (#38) (01f72f3)

## [0.3.20] - 2026-10-30

### Maintenance
- test(integration): live evidence for phase 17 (scenarios 5, 6, 10) (#34) (5292d2c)

## [0.3.19] - 2026-10-30

### Changed
- refactor: drop the export keyword from self-only exports (phase 13, QR-06 slice 2) (#35) (9376984)

## [0.3.18] - 2026-10-30

### Added
- feat(daemon): expose metrics over the control socket (#33) (0ecd784)

## [0.3.17] - 2026-10-30

### Added
- feat(daemon): log one correlation id for each up and tool call (#32) (7e122b3)

## [0.3.16] - 2026-10-30

### Fixed
- fix(daemon): write the startup report as a daemon.startup JSON record (#31) (50fe21f)

## [0.3.15] - 2026-10-30

### Fixed
- fix(daemon): report start failures as daemon.failed JSON lines (#30) (f27e70e)

## [0.3.14] - 2026-10-30

### Added
- feat(runtime): read sandbox roots from config and allowlist the daemon environment (#29) (4037f84)

## [0.3.13] - 2026-10-30

### Maintenance
- ci: add a scheduled non-blocking mutation run (#27) (28be68b)

## [0.3.12] - 2026-10-30

### Added
- feat(audit): chain each line and add realm audit verify (#28) (c898823)

## [0.3.11] - 2026-10-30

### Maintenance
- test: add the three-case Omp write-guard suite (#26) (96fd339)

## [0.3.10] - 2026-10-30

### Added
- feat(observe): add the JSON logger, file sink and metrics registry (#25) (82e3928)

## [0.3.9] - 2026-10-30

### Added
- feat(runtime): add OPENSHELL_GATEWAY_LOST and tell a lost gateway from a dead runner (phase 17, part 1) (#22) (a3f87df)

### Maintenance
- chore: add the export reference analysis and drop self-only exports in the quiet directories (phase 13, part B-exports, slice 1) (#16) (edb8555)
- test: make six recurring load-sensitive tests deterministic (phase 13, part B-2) (#20) (aab94af)
- test: add the scripted-provider Omp harness and the enforcement spike (phase 12, part 1) (#21) (3f5c035)
- ci: enforce the coverage floors on the Node 22 leg (#24) (995a2cc)

## [0.3.8] - 2026-10-29

### Fixed
- fix(daemon): a connection error on a served socket must not stop the daemon (#23) (aabeece)

## [0.3.7] - 2026-10-29

### Maintenance
- ci: add the coverage ratchet script and print its report on the Node 22 leg, report-only (phase 13, part B-coverage) (#18) (d79a8be)

## [0.3.6] - 2026-10-29

### Added
- feat(daemon): sweep and reconcile at start, log the reap and show a notice (phase 14, part 2) (#15) (5719f81)

## [0.3.5] - 2026-10-29

### Security
- security!: default the policy mode to fail-closed (phase 15, part 1) (#19) (84f335b)

## [0.3.4] - 2026-10-29

### Maintenance
- test: add property tests for the canonicalizer and the policy parser, with fast-check (phase 13, part C-props) (#17) (9ef8b04)

## [0.3.3] - 2026-10-29

### Added
- feat: add the crash-safety libraries, the lost-container retry and the daemon cause code (phase 14, part 1) (#11) (157ebfe)

## [0.3.2] - 2026-10-29

### Maintenance
- test: replace fixed-timeout waits with injected clocks, gates and a scaled-timeout helper (phase 13, part B) (#14) (15a3651)

## [0.3.1] - 2026-10-29

### Maintenance
- ci: audit production dependencies, add Dependabot and smoke the release tarball (phase 13, part A) (#12) (fe76536)

## [0.3.0] - 2026-10-29

### Documentation
- docs: start milestone v3.0 Containment by Default (#10) (6fe70ee)

## [0.2.3] - 2026-10-29

### Documentation
- docs(omp): record the lifecycle findings and add a runbook (#9) (b3e90e3)

## [0.2.2] - 2026-10-29

### Maintenance
- chore(milestone): archive milestone v2.0 and record its audit (#8) (be10b1e)

## [0.2.1] - 2026-10-29

### Fixed
- fix(omp): wait for a daemon that holds the socket instead of spawning over it (f70c236)
- fix(mcp): serve the legacy initialize era beside the modern one, with spec-shaped results and descriptors (edb28e5)
- fix(omp): tolerate the daemon's bind race the way the CLI does (b93d1d8)
- fix(acp): advertise the package version instead of 0.0.0 (8620576)

### Documentation
- docs: record the MCP protocol eras, the real-host evidence and the descriptor rule (6906676)
- docs(core): correct the error catalogue header count (4b52015)

### Maintenance
- test(mcp): pin the element type of the exec argv descriptor (8e22802)

## [0.2.0] - 2026-10-29

### Added
- feat(release): list the version files, omit planning commits and write release assets (943e15e)
- feat(driver): pin the host supervisor by digest and report host binaries and the ptrace scope in realm doctor (f8f368a)
- feat(hardening): deny nested user namespaces and the mount family, and verify 11 more container properties at create (7cc2765)
- feat(driver): run the in-container runtime as the main process, with no exec route (20a81b6)
- feat(driver): start the in-container runtime on the built-in path (217c157)
- feat(driver): advertise the isolation-backend capability and accept the configured backend only (7aa12d1)
- feat(isolation): accept the gateway's launch material and store it in the secret root (df29a10)
- feat(isolation): answer DiscoverPolicy as the supervisor's startup requires (835c385)
- feat(isolation): bind handles in OpenBoundary and pin the gateway identity (0d6e7ec)
- feat(gateway): render the supervisor isolation backend section (dbea9e8)
- feat(driver): start the isolation backend in the driver process (686244a)
- feat(isolation): verify the supervisor bearer and serve Attach (237d743)
- feat(isolation): bind handles to a sandbox and invalidate them on delete (f4c78ac)
- feat(isolation): add the isolation protocol protos and the backend skeleton (1228c0b)
- feat(driver): add the compute driver process entry (4c5b1da)
- feat(driver): serve the ComputeDriver over a user-only unix socket (fae17e2)
- feat(driver): implement the ComputeDriver service with profile-checked create (440fe97)
- feat(driver): add the pinned admission acknowledgement and the gRPC status table (184d5d1)
- feat(runtime): remove launch and active files on sandbox delete (ad6222c)
- feat(runtime): harden the container lifecycle for phase 9.3 (1f714ac)
- feat(sandbox): add the native enforcement helper and its image definition (497b63f)
- feat(runtime): render the production gateway profile with TLS and JWT tables (d54e051)
- feat(runtime): add the AgentOS sandbox driver and key sandboxes by OpenShell labels (0a5e208)
- feat: host adapter bundles, MCP startup fix, and opt-in devnet anchoring (H1) (b7e9e1c)

### Changed
- refactor(anchor): give AnchorError a catalogue error code (3b0c15d)
- refactor(driver): remove the vendored protos that only the registered backend used (05bf7c0)
- refactor(runtime): require the image ref on sandbox create and trim stale comments (10032c9)
- refactor(sandbox): remove the retired realm helper and its image stages (c0a071b)
- refactor(runtime): make the session sandbox the only sandbox and drop the workload command from the runtime config (2007997)
- refactor(isolation): remove the registered backend code the built-in path makes dead (edb1053)

### Fixed
- fix(ci): dispatch Pages when the tip of main is a release commit (2b468a7)
- fix(acp): serve the tool method as the spec-reserved _realm/tool and advertise it (86bcb36)
- fix(agentos): do not let a check made during the initial start hold the supervisor (17cba3f)
- fix(anchor): turn audit log read failures into a controlled AnchorError (c3a65d4)
- fix(agentos): make a failed probe terminal, as the amended RT-04 says (0813010)
- fix(driver): claim the socket before the startup sweep and refuse creates until it resolves (1c029bc)
- fix(control): let the up request outlast the default startup budget (993e294)
- fix(session): refuse a sandbox whose mounted root is not the policy-approved workspace (94b401d)
- fix(image): exit 2 for a copy failure that is not an absent file, and refuse bad arguments before podman runs (482ca81)
- fix(doctor): read the driver's supervisor pin exactly as the driver does (6faf200)
- fix(doctor): bound the host binary digest separately from the process probe (cac8420)
- fix(libpod): send rlimit types in the form the engine's REST API expects (074f28e)
- fix(driver): bound the gRPC shutdown so SIGTERM exits within a grace period (cce4438)
- fix(egress): refuse private and special IPv4 literals in every notation (363bcae)
- fix(daemon): move the session to error when the AgentOS runner dies (1f99c97)
- fix(fs): pin the atomic write's directory by descriptor, fsync audit lines and widen the credential deny list (45aa633)
- fix(driver): reclaim the state and secret directories of a sandbox whose container is gone (d2db549)
- fix(tools): run exec and write on an active session that has no Anda bridge configured (82e099e)
- fix(runtime): force-remove leftover realm containers within the sweep bound (3a16a46)
- fix(runtime): check the sandbox name length after the create-time configuration checks (abe8b86)
- fix(runtime): refuse a session whose sandbox name exceeds the gateway's 19 character limit (3faf43a)
- fix(runtime): give the slow libpod info call its own 30 second timeout (a20abd6)
- fix(sandbox): point the sandbox resolver at the runtime's DNS relay (4671467)
- fix(hardening): verify the keyring syscalls are denied from the container's OCI seccomp config (f33e9d9)
- fix(hardening): read the seccomp profile from HostConfig.SecurityOpt, where Podman 5.7.1 reports it (24c9fd1)
- fix(driver): run sandboxes under Podman's default seccomp profile with the keyring syscalls denied (87c6269)
- fix(runtime): allow /dev/null, /dev/zero and /dev/random in the sandbox policy (3d79800)
- fix(runtime): keep the AgentOS heartbeat in scratch space, not in the workspace (6af73ce)
- fix(daemon): bind a session's sandbox state to the driver's state root (61cce5c)
- fix(driver): hold a pinned root for every live container, including after a restart (cc99538)
- fix(core): raise the default startup budget to cover an AgentOS start (799b762)
- fix(driver): refuse a second live sandbox on the same pinned root (ceef799)
- fix(daemon): take the AgentOS sandbox image from the configured digest only (6fc3e58)
- fix(lifecycle): reach active without an Anda bridge when no andaUrl is configured (efe2503)
- fix(hardening): verify zero capability sets from the live process, not KernelCaps (9dc731e)
- fix(runtime): verify sandbox containers with one binding for the driver and the session (9a43f53)
- fix(driver): mount the pinned workspace root and never remove it on delete (4473535)
- fix(check): drop the removed workloadArgv key from the MCP smoke config (54a6928)
- fix(runtime): take the sandbox name from the session and close the stop and create races (d4d778e)
- fix(runtime): delete session sandboxes on stop and close the stop-during-create and overlapping-start gaps (e01dabd)
- fix(driver): disable IPv6 in the sandbox network namespace (57a7692)
- fix(runtime): start the AgentOS runner as a managed exec child after create (cc4fe6d)
- fix(driver): start the supervisor's SSH access on a socket outside every container mount (7902a48)
- fix(driver): set the runtime's low-port sysctl in the sandbox create body (b41889d)
- fix(image): allow the dynamic loader's own soname in the runtime dependency gate (d7caa03)
- fix(driver): stop refusing the built-path create at podman, and log the create refusals by check (6a8b56b)
- fix(driver): observe the supervisor's exit and make delete report what happened (7dda8f1)
- fix(isolation): remove the TLS keys once the listener is confirmed, and check the socket path limit (3ce4f7a)
- fix(driver): require launch material at create, not at validation (538c0ef)
- fix(isolation): match the gateway's launch-material encoding and log refusals by check (dfe3050)
- fix(driver): prefix sandbox names and accept an empty command (3606f4b)
- fix(driver): create the workspace and state directories before a sandbox create (8565dc8)
- fix(driver): advertise the package version as the extension implementation version (fa235c6)
- fix(runtime): close review minors for the phase 9.3 lifecycle (aea0d50)
- fix(runtime): verify the container's kernel capability sets instead of the literal cap-drop list (57690a8)
- fix(runtime): send libpod requests under the /_ping API version (4579214)
- fix(check): assert declared pack entries; clean mcp scratch on early failure (3d8fcb7)
- fix(release): sync the Hermes JSON manifest and stage adapter manifests (6c9aa50)
- fix(ci): run the Pages deploy after a superseded or skipped release plan (23e6257)
- fix(adapters): Muse Code and Hermes Agent bundles pass their validators (c816d36)
- fix(daemon): report a refused start with the daemon's own code (e8f93bd)
- fix(omp): take the host's (event, ctx) arguments in session_start (ef91b81)

### Security
- security(pages): grant each Pages job only what it calls and deploy only after a release (ef0f1a0)
- security(ci): keep the release token away from dependency and build code (7746e1a)

### Documentation
- docs: state the Pages dispatch rule as the code now implements it (7141b5e)
- docs: align the contributor docs and the support window with the release flow (d524d23)
- docs(legal): attribute the vendored Apache-2.0 material and ship its licence text (2e4e833)
- docs: record the review outcome, the final evidence and two late observations (278005a)
- docs: record the round-two fix, the pull request and the review rounds (2c401b5)
- docs: record the five fixes made in answer to the Greptile review of the pull request (7639cf0)
- docs: record the live evidence of 2026-10-28, the live-proof fixes and the final review dispositions (b227499)
- docs: record the phase 9.7 hardening, host binaries, image build and review dispositions (0d06c13)
- docs(integration): refresh the Omp runbook, the driver RPC status and the drifted references (3a4f139)
- docs(integration): record the accepted residual risks and the open review items of the production sandbox (40684e0)
- docs(integration): record the sandbox DNS relay's synthetic answers and the final-build evidence (fdd335b)
- docs: match the integration docs and AGENTS.md to the production stack (3a96585)
- docs(integration): record the OpenShell 0.1.5 CLI pin and the create-command finding (164b942)
- docs(integration): record the phase 9.4 call sites and limits (64de730)
- docs(integration): record the compute driver RPC table and the PD-08 default (e0887b5)
- docs(policy): record the workspace-root breadth residual (a563c83)
- docs(omp): record the OQ-P5-02 re-read and the Podman 5.7.1 live run (3762e60)
- docs: record the owner's 2026-10-23 decisions (f0202b0)
- docs: record the live Omp run, validator results, and refreshed host snippets (3822494)
- docs(omp): verified live-run procedure with expected results on this host (5f99e62)

### Maintenance
- test(driver): cover a zero shutdown grace and a socket that is already gone, and correct the close comment (1176449)
- build(sandbox): compile the runner in the image, gate every input and commit the expected digests (0a0f3fc)
- ci: pin actions to commit SHAs, add job timeouts and persist-credentials false (439f4f7)
- test(integration): add live scenarios for TOOL-04, RT-04 and OMP-01 to the gated production suite (afc3659)
- test(integration): add crash recovery and MCP exec to the production live suite (1915b22)
- test(integration): remove the live bodies the production live suite supersedes (82895d9)
- test(integration): download the live suite's transfer file from the sandbox workspace (2086281)
- test(runtime): keep the libpod timeout tests independent of host speed (9c9147a)
- test(lifecycle): freeze the controller clock in the create-interrupt and idempotent budget tests (403c1cc)
- test(runtime): freeze the controller clock in the startup-budget tests (22a30ce)
- test(integration): add the gated live suite for the production stack (f067b54)
- test(runtime): keep the startup-budget tests independent of host speed (f6bbea8)
- build(image): build the in-container runtime in a pinned bookworm builder with a glibc gate (14abfbc)
- build(lint): allow child_process in the two supervisor spawn modules (03c0382)
- build(pack): assert the isolation protos in the packed package (6c85e37)
- build(pack): assert the vendored driver protos in the packed package (9e93a21)
- build(driver): pin grpc packages exactly and vendor the compute driver protos (351c725)
- test: remove wording-pin tests and enable noUncheckedSideEffectImports (00daeaf)
- test: remove source-text pins of documentation wording (0b65719)
- chore(changelog): drop branch edits; the release job owns CHANGELOG.md (54c29d7)
- chore(site): ignore generated adapters pages (9015268)

## [0.1.3] - 2026-10-23

### Changed
- 00057 - CI: run all jobs on Omega CI runners (8510529)

## [0.1.2] - 2026-10-22

### Changed
- Archive milestone v1.0 with its audit and deferred verification (#4) (58d2daa)

## [0.1.1] - 2026-10-22

### Changed
- Add the GitHub Pages docs site built from the repository markdown (#3) (118499c)

## [0.1.0] - 2026-10-22

### Added

- Strict ESM TypeScript package with typecheck, lint, test, and build scripts (FOUND-01).
- Frozen shared contracts: six-state machine, typed error catalogue, tool, session-record, and policy schemas, with schema rejection tests (FOUND-02).
- Integration notes under `docs/integration/`, each citing its official URL and read date (FOUND-03).
- State machine that rejects disallowed transitions, one display-label mapping ("realm active" or "realm disconnected") with reason and transition time, and a typed event bus (CORE-01, CORE-02, CORE-04).
- Policy engine with advisory mode as the default and a visible warning, and fail-closed mode as an opt-in per project (CORE-03).
- Mutation gate on state `active` with a bounded queue wait, and idempotent lifecycle operations (CORE-05, CORE-06).
- Filesystem lockdown: root-allowlisted canonical paths that reject escapes with `PATH_ESCAPE`, credential-path denial, advisory write locks with content-hash re-check, and atomic writes that report `WRITE_NOT_ATOMIC` (FS-01, FS-03, FS-04, FS-05).
- User-only control socket: directory 0700, socket 0600 (RT-06).
- Session record written before container creation (RT-07).
- Redacted JSONL audit log, and no host environment injected into the sandbox (AUD-01, AUD-02).
- `realm up` reports `PODMAN_MISSING` and exits promptly when Podman is absent; `realm doctor` lists each prerequisite with its fix (CLI-02, CLI-03).
- Six tools behind one schema, with every input validated before any sandbox call; argv-first exec, with shell mode gated by policy (TOOL-01, TOOL-02).
- Suite taxonomy with Podman-gated skips, and the policy reference and security and supply-chain reviews in `docs/policy-reference.md` (QUAL-02, QUAL-03).
- Silent-catch rule for the codebase, with a named list of exceptions (QUAL-01, amended 2026-10-22).
- Omp status as one item that carries the reason and transition time in its text (OMP-03, accepted approximation: the host has no tooltip API).

Open items, not part of 0.1.0:

- RT-04 (in-sandbox AgentOS runner) and CLI-01 (`realm up` reaching active) are deferred to a follow-up milestone.
- `realm up` fails closed with `AGENTOS_NOT_CONFIGURED` until an AgentOS driver exists.
- Live verification is deferred to a host running Podman 5.x. The affected requirements are RT-01, RT-02, RT-03, RT-05, RT-08, RT-09, TOOL-03, TOOL-04, TOOL-05, OMP-01, OMP-02, OMP-04, OMP-05, CLI-04, ANDA-01, ANDA-02, ANDA-03, and ANDA-04.
- FS-02 (race-resistant path resolution) is a partial, accepted approximation that awaits confirmation.

### Changed

- Licence is AGPL-3.0-only (`LICENSE`, `NOTICE`).
- Release automation runs from CI: it computes the next version, syncs the version, generates the changelog and release notes, tags the release, and creates the GitHub release.
- Documentation is published as a GitHub Pages site.

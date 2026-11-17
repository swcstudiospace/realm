# Requirements: Realm

**Defined:** 2026-10-29
**Core Value:** Every file mutation by an agent either lands inside the realm under policy or fails closed, and the user can always see whether the realm is active or disconnected.
**Source:** `.planning/quick/261029-g7m-lifecycle-and-persistence-findings/IMPROVEMENT-PROPOSALS.md` (the "Proposed change" of proposals 1 to 8 is the scope; each "Success measure" is the acceptance test) under the owner decisions D1 to D6 of 2026-10-29 in `.planning/MILESTONE-CONTEXT.md`. Research was skipped; the proposals and the findings documents beside them are the requirement basis.

All v3.0 requirements are hypotheses until shipped and verified.

**Recovery record (2026-10-31):** original task `Trealm31-gsd-records`, execution correlation `ut-mvvowl70-29165019`, remains accepted/DONE; the original 52-ID/code/recipe map in `phases/RECOVERY-2026-10-31.md` is retained as its historical snapshot. Bounded prerequisite task `Trealm31-prereq-onboarding-evidence`, correlation `realm-prerequisites-onb-network-oct31`, updates only the five signed docs/state paths within the existing invoked autonomous flat workflow. Individual ONB-01/02/03 evidence below supersedes their old pending status; unrelated unchecked rows are not promoted by a suite total. Historical checked HARN-02/HARN-04 and OMP-05 receipts remain intact. No aggregate gate, phase/SUMMARY/VERIFICATION completion or milestone closure is inferred; all nine phases remain incomplete.

**Parent evidence boundary:** the first joined wave passed typecheck/lint, 2380 tests (2351 passed, 0 failed, 29 skipped), 282 script tests, gate-closure (4 modules, 0 violations), build/pack/MCP (`firstWaveVerification`, parent artifact `artifact://8723`). MCP smoke there covered disconnected catalogue behaviour, not a live sandbox. The latest post-network union passed typecheck, then FAILED lint on two unnecessary optional chains in `test/integration/omp-spike.test.ts` at 955:43 and 960:55; all later chained tests/scripts/docs/gates/build/pack/MCP were NOT RUN (`lastJoinedAttempt`, lint artifact `artifact://8741`). The original owner is correcting those causes, not suppressing them. Neither result verifies future edits in this prerequisite wave; parent alone verifies the joined changes.

**Milestone v2.0 closed 2026-10-29.** The full v2.0 table is archived at `.planning/milestones/v2.0-REQUIREMENTS.md`. The requirements it left open (FS-02, ANDA-01 to ANDA-04, OMP-05, PRD-DRV-01) and the accepted limitation UI-01 are listed under "Carried from v2.0" below. OMP-05 is closed in this milestone by HARN-04; the others are not in this milestone.

## v3.0 Requirements

### Omp live harness (HARN)

- [ ] **HARN-01**: A gated test harness starts an isolated Omp profile whose model provider is a local OpenAI-compatible stub returning a scripted sequence (one `write` tool call, then a final message), loads the built extension with `-e`, and drives Omp over RPC pipes (`--mode rpc-ui`), with no pseudo-terminal, no credentials and no tokens
- [ ] **HARN-02**: The harness runs three cases: advisory mode with the realm down (the notice is shown and the file exists), fail-closed mode with the realm down (the call is blocked with `REALM_NOT_ACTIVE` and the file does not exist), and the realm active (the call proceeds; this is the baseline that Phase 16 changes)
  Recovery supersession: the checked three-case native-write receipt is historical. Phase16's accepted OMPX-04 same-name replacement means disconnected registered Realm write now refuses even in advisory mode and creates no host file. Supplied current C1–C3 passed on those semantics. The parent now separately verified C4 native patch-mode edit CREATE: 1 passed, 0 skipped on Omp18.12.6 (`firstWaveVerification.realC4`, `artifact://8723`), with no unissued snapshot tag. This is fake-backed host guard/control evidence, not production sandbox/audit proof. Do not erase the original receipt or claim registered-tool refusal meets its old native file-exists expectation.
- [ ] **HARN-03**: One command runs the harness against a built extension and a local Omp and passes; it records the Omp version and makes no connection to any host except the loopback stub (and Omp's three loopback discovery probes, D-1205). On a warmed profile, no connection outside the loopback stub is permitted; a cold profile is reported as skipped, its model-catalog refresh being the recorded reason. The command is gated like the production live suite, skipping with a stated reason when Omp, Podman or the gate variable is absent
  Evidence chronology: original S11 warm FAILED with 38 external + 6 DNS = 44 offenders; cold separately skipped with 49 offenders. The same-run refusing LOOPBACK PROXY LEVER observed 0 external, 0 DNS and 7 refused CONNECTs, narrower than a built-Realm warm harness pass. The original signed spike repair is now implemented-unverified, not NOT QUEUED; the latest parent union stopped at its two lint errors before later checks. The separately signed built-Realm prerequisite owns strict measured warm registered-write coverage with only `defaultAllow(stubPort)` (stub + discovery11434/8080/1234), no extra proxy port, zero external/DNS/offenders, separate cold skip, exact bytes/tool result/provider continuation and raw trace/version. Literal built-Realm warm execution remains pending parent proof; no spike/text-only substitute or network exemption completes HARN-03.
- [ ] **HARN-04**: OMP-05 is recorded complete in the traceability table on the harness evidence, and the recorded basis states that the run is scripted through Omp's own `write` tool and is not LLM-driven (owner decision D2)

### Quality and supply-chain ratchet (QR)

- [ ] **QR-01**: `ci.yml` runs `npm audit --omit=dev --audit-level=high`
- [ ] **QR-02**: `.github/dependabot.yml` exists and covers the `github-actions` and `npm` ecosystems for the repository root and for `site/`
- [ ] **QR-03**: TD-07: `pack-smoke` includes the host snippets and the prime-agent `MCP.md` and `SKILL.md`, and the release job reruns `check:pack` on the release tarball after the version sync
- [ ] **QR-04**: A `test:coverage` script produces the Node test runner's coverage output, and CI enforces a per-directory floor ratchet for `src/fs`, `src/core` and `src/tools`: CI fails when coverage in one of these directories drops below its recorded floor
- [ ] **QR-05**: Fixed-timeout tests are replaced by an injected fake clock where a seam exists (the libpod TTL cache and the idempotent lifecycle test) and by a shared scaled-timeout helper in `test/support` elsewhere (the 21 `{ timeout: 10_000 }` caps under `test/acp` and the other fixed waits the proposal lists); the suite passes on a loaded host, verified in a CPU-limited container
- [ ] **QR-06**: TD-09: dead exports found by reference analysis (`scripts/check/export-usage.mjs`; coverage output cannot find them, because a test covers an export that only tests use) are removed: an export used only inside its own file loses the keyword, an export used only by tests stays as a documented seam unless it is obsolete; the frozen error catalogue, the `ports` types and the schema validator types are not changed
- [ ] **QR-07**: `fast-check` is added as a dev dependency with the three items `CONTRIBUTING.md` requires (justification, licence check, maintenance check); properties run in `npm test` and cover the path canonicalizer (no result escapes the root for random `..`, symlink, NUL, doubled-slash and unicode inputs) and the policy parser (round trip, unknown keys rejected); a deliberately broken canonicalizer fails at least one property
- [ ] **QR-08**: A scheduled, non-blocking mutation run covers `src/fs`, `src/core/policy.ts` and `src/audit/redact.ts`

### Crash safety (CRASH)

- [ ] **CRASH-01**: A startup sweep removes regular files named exactly `.<name>.realm-tmp-<16 lowercase hex>` under each configured workspace root and the state directory's session directory, through the pinned-root descriptor and never by following symlinks, only when older than a stated bound; each removal is audited, and no other dotfile is touched
- [ ] **CRASH-02**: At startup, for each audit file, every admission line with no following result line gets one reconciliation line, marked as a reconciliation and not an execution result, using the catalogue code the owner approved (owner decision D5: an existing code if one fits, otherwise the one allowed addition); a second start appends none
- [ ] **CRASH-03**: The sessions directory is fsynced after `SessionStore.delete`, reusing the directory-sync helper of `src/fs/atomic-write.ts`
- [ ] **CRASH-04**: The startup reap logs the container ids removed and the number of records deleted, and the next attach shows a status-read notice, so a destroyed sandbox is never silent
  Current bounded disposition: production live5 actually passed on 2026-10-31 with the rebuilt driver (live5/6 together: 2 passed, 0 skipped). Its assertions cover real SIGKILL, replacement active with exactly one container, status-read notice with 1 container and at least 1 session record, and a `daemon.startup` log entry naming the destroyed container. However, `startupReapLineFor` (`test/support/production-live.ts`) asserts `containersRemoved` and `containerIds`, **not the logged `recordsDeleted` count**. `src/daemon/main.ts` emits that field, but source emission is not the missing runtime assertion. Keep CRASH-04 unchecked until the logged record-deletion count is asserted against the actual run; Phase19 selective-notice preservation also remains a separate future obligation.
  2026-11-08 correction: `startupLineWith` can compare `recordsDeleted` (`test/support/production-live.ts:295-316`), and scenario 5b asserts `recordsDeleted >= 1` (`test/integration/production-driver.test.ts:761-766`). Scenario 5b passed live after SIGTERM removed the container; it did not show startup removing that container. CRASH-04 and Phase 19 selective-notice acceptance remain open.
- [ ] **CRASH-05**: Real-SIGKILL tests: a child process writes through `atomicWriteFile` and kills itself from the stage hook at each of the four stages (`after-temp-write`, `after-fsync`, `before-rename`, `after-recheck`); for each stage the parent asserts the original is intact, names the orphan temp file, and asserts the next sweep removes it
- [ ] **CRASH-06**: TD-01: the refusal cause code is carried across the daemon for MCP and ACP, with a daemon-path equivalence test beside `test/surfaces/equivalence.test.ts` showing the same cause code over MCP and ACP as in process
- [ ] **CRASH-07**: TD-04: when the recorded container is gone, a retry from the error state creates a new container instead of failing with `OPENSHELL_START_FAILED`; a controller test with a removed container reaches `active` on retry

### Zero-config onboarding (ONB)

- [ ] **ONB-01**: `realm init` writes `config.json` and `policy.json` templates, creates the state directory with mode 0700, refuses to overwrite an existing file, and takes the image digest as an argument or from `release/` (it never invents one); on a clean host with Podman 5.x, `realm init` then `realm up` reaches active with no manual file edit
  Individually verified (2026-10-31 parent): first-wave init safety suite in `artifact://8723` plus actual fresh generated-config lifecycle on compiled Realm0.3.26/Podman5.7.1, uid5002. Init reported fail-closed; up/status active with exactly one actual rootless container; down unbound, zero containers. No manual JSON edits. `test/cli/init.test.ts` covers 0600 templates, 0700 state/derived roots, no overwrite and unsafe-root refusals. README normalizes the actual stdout. Scope requires an already provisioned gateway/supervisor/rootless Podman and matching rebuilt compute driver, not a claim that init or a released installer provisions those prerequisites.
- [ ] **ONB-02**: `realm doctor --fix` applies only the safe subset (create missing directories, set the state directory to 0700), supports a dry-run mode, refuses symlinked directories, is idempotent and reports what it changed; everything else stays prose; run on a state directory with mode 0755 it changes it to 0700, and a second run changes nothing
  Individually verified (2026-10-31 parent): 31 nonroot doctor tests passed, 0 skipped, uid5002; actual CLI dry-run/apply/idempotence also passed (`firstWaveVerification.unprivilegedDoctor`, `artifact://8723`). `test/cli/cli.test.ts` exercises the real runCli consumer with 0755→0700, run/sessions creation, dry-run immutability, symlink refusal, unchanged unrelated contents and `fixes: []` on repeat. Current README/snippet command documentation still awaits parent docs checks.
- [ ] **ONB-03**: The three `REALM_DRIVER_*` roots (secret, workspace and state) move into `config.json` with a default derived under `stateDir`; the environment variables are removed (clean cutover, no shim); the driver and the daemon read the same source
  Individually verified (2026-10-31 parent): fresh actual driver/daemon run selected the same generated config, no legacy root environment and no manual JSON edits (`freshLiveVerification.sameConfig`). `runtimeRootsOf` derives secret/sandbox-state roots under stateDir; workspaceRoot is explicit. Driver `loadDriverProcessConfig` and daemon `runDaemon` read that shared source. Driver image/socket/gateway/supervisor settings remain their documented separate environment contract. Temporary rebuilt-driver success does not prove a released service was permanently upgraded.
- [ ] **ONB-04**: `realm doctor` checks that the three roots are set, absolute and mode-correct, that the driver socket is present with mode 0600 in a 0700 directory, and that the gateway is reachable (TD-03); a failure names the check and the fix, and a unit test covers each check
- [ ] **ONB-05**: `omp plugin install` is verified live under an isolated profile, the result is recorded in `docs/hosts/snippets/omp.md`, and `README.md` carries the install steps
- [ ] **ONB-06**: `README.md` carries a quickstart with a transcript, captured on a real Podman 5.x host, of `init`, `up`, `status` and `down`
  Docs authored in this bounded unit: README now carries the isolated local-link commands and exact normalized generated-config lifecycle stdout; Omp snippet retains the historical Omp18.12.6/package0.3.24 install receipt. ONB-05/06 stay unchecked pending parent docs/link/path/AGENTS-sync/default-mode checks after these edits. No registry/marketplace or current-package installed-load proof is substituted.
- [ ] **ONB-07**: The daemon starts with an allowlisted environment (`PATH`, `HOME`, `XDG_RUNTIME_DIR`, `XDG_CONFIG_HOME` and what the roots need) in both `startDetachedDaemon` and the CLI's spawn; a test shows that a sentinel variable does not reach the daemon

### Containment default (DEF)

- [ ] **DEF-01**: A policy with no `mode` loads as fail-closed; the schema default and the loader agree; advisory requires the explicit value (owner decision D4)
- [ ] **DEF-02**: The policy reference, the README, the Omp notes, the doctor output and the `init` templates state the fail-closed default, and every test that relied on the old advisory default either states its mode explicitly or asserts the new default; no document still calls advisory the default

### Omp in the sandbox (OMPX)

- [ ] **OMPX-01**: A spike on a live Omp determines whether `registerTool` tools reach the model, whether `setActiveTools` removes `write`, `edit` and `bash` from the callable set and is enforced at execution, and whether `registerFileWriteFallback` can redirect a write; the finding is recorded with the Omp version in `docs/integration/omp.md` and closes OQ-P5-01 and OQ-P5-02
- [ ] **OMPX-02**: The extension registers `exec`, `read`, `write`, `list` and `status` as Omp tools; each calls the daemon client with the frozen `ToolCall` shape, so validation, locking, audit and the state gate stay in the shared dispatcher (`retry` stays the existing `realm-retry` command; no `glob` tool is added)
- [ ] **OMPX-03**: In fail-closed mode the built-in `write`, `edit` and `bash` are removed or blocked by the mechanism the OMPX-01 spike proves, the existing `tool_call` guard stays as a backstop, and a model-issued `bash` call is refused with a catalogue code; if the API cannot enforce removal, the status text and the docs say that fail-closed is a guard and not containment (owner decision D3)
- [ ] **OMPX-04**: In advisory mode the Realm tools are registered and the built-in tools other than `read` and `write` stay available, with the existing notice; the registered Realm `read` and `write` displace the built-in `read` and `write` because they share their names (owner decision, the one exception)
- [ ] **OMPX-05**: On a live Omp with the realm active, a model-issued write through the registered tool lands in the sandbox's `/workspace` and appears in the host root, and the audit log holds an admission line and a result line for it; this runs through the Phase 12 harness

### Observability and audit integrity (OBS)

- [ ] **OBS-01**: Each audit line carries `seq` and `prev` (the sha256 of the previous line); `realm audit verify` reads an audit file, passes an untouched file, and names the first line that breaks the chain (edited, removed or reordered); the chain head is recovered from the last line at startup, and the design covers the reconciliation lines of Phase 14 and the Merkle anchor
- [ ] **OBS-02**: A leveled logger writes one JSON object per line on the daemon's log, with a correlation id per `up` and per tool call that also appears in the admission and result audit lines, and the catalogue code in a fixed field; it adds no dependency
- [ ] **OBS-03**: Counters and timings (tool calls by outcome, state transitions, attach duration) are exposed over the existing control socket, and no network listener exists
- [ ] **OBS-04**: TD-05: a distinct catalogue code for gateway or driver loss, approved by owner decision D5, is mapped in the probe path and shown by `realm status`; a probe test shows the new code instead of `AGENTOS_CRASH_LOOP`

### Per-project sandboxes (MULTI)

- [ ] **MULTI-01**: The new runtime decision (one session per project workspace, superseding one session per daemon) is recorded in `docs/integration/runtime-decision.md` before the code that needs it
- [ ] **MULTI-02**: `up` carries a workspace root that is a descendant of a configured root; the session id derives from the workspace; each session has its own record, its sandbox `realm-<sessionId>`, its pinned subdirectory and its bind mount; a directory outside every configured root is refused with `POLICY_DENIED`
- [ ] **MULTI-03**: The audit file, the lock table and the status snapshot are per session; `realm down` for one session leaves the others active
- [ ] **MULTI-04**: The compute driver and the gateway contract handle a workspace per sandbox, with PRD-DRV-01 handled only as far as this phase needs
- [ ] **MULTI-05**: A live scenario brings up two projects under the configured roots with distinct `/workspace` contents, shows that a write in one is not visible in the other, and shows that `down` of one leaves the other active; unit tests cover the per-session pin
- [ ] **MULTI-06**: The aggregate memory and CPU commitment of concurrent sessions is bounded and documented, using existing configuration and no new catalogue code

### Resume and checkpoint (RES)

- [x] **RES-01**: The reaper decision (re-adopt what passes the hardening verifier, remove what cannot be proven good, keep the no-orphan guarantee in a precise form) and the amendment of the RT-01 mount list for the scratch volume are recorded in `docs/integration/runtime-decision.md` before the code that needs them
- [x] **RES-02**: At startup a session record whose container is still running and passes the create-time hardening verifier is adopted, and a container that fails the verifier or has no record is removed; both outcomes are logged
- [x] **RES-03**: A persistent scratch volume is mounted beyond `/workspace`, owned by the session, survives a daemon restart, and is removed by `realm down`
- [x] **RES-04**: Workspace snapshot and restore commands exist, with the mechanism (copy, reflink or filesystem snapshot) chosen after a spike; restore returns a modified workspace to its prior content byte for byte
- [x] **RES-05**: Live scenarios show: the daemon is killed and restarted and the same container id is active with `/workspace` intact and no second container; a container that fails the verifier is removed; a scratch-volume file survives a daemon restart and is gone after `realm down`; a snapshot then restore round-trips

### Release hardening (REL)

- [x] **REL-01**: The release job is split into an unprivileged build job and a privileged publish job (owner decision D6)
- [x] **REL-02**: A release carries a build provenance attestation that `gh attestation verify` accepts
- [x] **REL-03**: A manual rollback workflow marks a release a prerelease and re-points the documentation; a test release is marked a prerelease by it
- [x] **REL-04**: TD-08: the changelog generator filters commits of features that were later removed

### Host plugin contract (HOST)

- [x] **HOST-01**: Host plugin manifest schema with strict validation
- [x] **HOST-02**: Capability grants map onto the existing policy gates (roots, credential allow, egress, shell, mode) with no new enforcement path
- [x] **HOST-03**: Declarative runtime table: Omp plus the 18 GSD Core runtime flags, pinned to the verified source
- [x] **HOST-04**: Boot-hook port with bounds parity against the Omp plugin and a reusable conformance harness
- [x] **HOST-05**: Installer engine: pure recipes, atomic idempotent writes, ownership receipts, dry-run, crash resume
- [x] **HOST-06**: Host operations are audited on the shared chain, logged with redaction and bounded in time
- [x] **HOST-07**: `realm host list|detect|status|install|uninstall` CLI with dry-run
- [x] **HOST-08**: Doctor host-plugins check reads receipts only
- [x] **HOST-09**: Contract docs, packaging proof and repo gates for src/host

### Omp plugin on boot (OMPB)

- [x] **OMPB-01**: The Omp plugin reads every boot bound, the link-lost and retryable code lists, the re-attach sub-state table and the jitter function from `src/host/boot.ts`; `src/omp/reattach.ts` and the `src/omp` bound constants no longer exist; the parity tests are deleted.
- [x] **OMPB-02**: The real Omp plugin, driven through the Omp host API, passes harness cases C1 to C9, and the harness's four reference mutants still fail exactly their cases.
- [x] **OMPB-03**: The existing guard, status text, tool-set reconciliation and fail-closed default behave as before: all pre-existing `test/omp/` and `test/integration/omp-*.test.ts` expectations pass with import-line changes only.
- [x] **OMPB-04**: `realm host install omp` writes, idempotently and atomically, the shim under `<agent dir>/extensions/realm/`, records a receipt, supports `--dry-run`, and `uninstall` removes only what the receipt owns.
- [x] **OMPB-05**: Install refuses with `POLICY_DENIED` and writes nothing when the extension entry is not built (`extension-unbuilt`) or Omp already loads Realm through a plugin link (`already-loaded`); foreign content, drift and symlinks keep their Phase 21 refusals.
- [x] **OMPB-06**: With the shim installed and no environment switch, Omp session start attaches, spawns the daemon when none answers (including under a Bun host, via an absolute `PATH` Node) and runs the idempotent `up`; a Bun host with no Node found still refuses with `REALM_NOT_ACTIVE` and spawns nothing.
- [x] **OMPB-07**: `realm doctor` (`host-plugins`) and `realm host status omp` report installed, shim target present and live plugin sessions (presence markers); `realm host status omp` also reports duplicate-load (it needs the user's home, which doctor deliberately never reads). Output names ids, states and counts only, never a path or file content.
- [x] **OMPB-08**: Docs describe the shipped behavior with evidence tiers and the unproven live boundary; the export-usage allowlist has no stale entry and no entry whose reason is outdated; module-size, pack-smoke and docs gates pass.

### Boot integration (BOOT)

- [x] **BOOT-01**: `createDaemonAttach` (`src/host/attach.ts`) is the only implementation of ensure daemon, connect, `up` and refusal retention; `src/omp/extension.ts`, `realm mcp` and `realm acp` call it; its three retention modes (`verified`, `always`, `never`) reproduce today's Omp, MCP and ACP behavior with every existing assertion unchanged.
- [x] **BOOT-02**: `createBootDriver` (`src/host/boot-driver.ts`) is the production `HostBootHook` for `mcp-config` hosts: bounds from `resolveBoot`, budget through `withStartupBudget`, retry through `attachFailureDisposition`, bounded re-attach off by default, fail-closed `call` gate, client-only shutdown. It passes harness cases C1 to C9; `bootHookOf` returns it for the 18 `mcp-config` hosts and `null` for `omp`; the four reference mutants still fail exactly their cases.
- [x] **BOOT-03**: `realm mcp\|acp [--host <id>] [--reattach]` runs the numbered boot sequence (resolve, ensure, up, readback, settle, expose); serves nothing before settle; a terminal failure exits 1 with its catalogue code and nothing on stdout; stdin EOF, `SIGTERM`, `SIGINT` and `SIGHUP` close the client, remove the marker and never send `down`; stdout holds only protocol frames in every outcome.
- [x] **BOOT-04**: Per-host failure isolation is proven with a real daemon over fakes: one host's hung `up`, failed boot, teardown or report flood leaves another host's session, the shared sandbox and the daemon answering within their bounds, and no boot path issues `down`.
- [x] **BOOT-05**: MCP and ACP sessions with `--host <id>` write and remove `<stateDir>/hosts/<id>-active/<pid>.json`; `realm host status <id>` and the `host-plugins` doctor item report live and unreadable markers for every host, ids and counts only.
- [x] **BOOT-06**: The `host-boot` control method accepts a strict closed-vocabulary report with no selection, rate-bounded by a token bucket; it feeds `hostBoot` counters and `timings.hostBootMs` in `realm metrics` and one redacted `host.boot` line carrying the boot id in `daemon.log`; a malformed or over-rate report is refused with an existing code and records nothing.
- [x] **BOOT-07**: The daemon alone appends `attached`, `refused` and `failed` reports to the reserved `host-boot` audit chain (closed-vocabulary `path`, boot id as correlation id, no paths or content); `realm audit verify --session host-boot` passes; the capability posture of the reporting host is logged from `resolveCapabilities` over the loaded policy.
- [x] **BOOT-08**: One host-side observer (`createBootObserver`) serves Omp and the stdio hosts: structured redacted log lines carrying the boot id, the presence marker and the report to the daemon, all best effort, none able to change an attach outcome, throw, or delay shutdown past 1 s.
- [x] **BOOT-09**: Docs describe the shipped behavior with evidence tiers and the unproven live boundary; the export-usage allowlist has no stale entry and no entry whose reason still says production wiring is Phase 23; module-size, host-paths, agents-sync, pack-smoke and mcp-smoke gates pass; the live rehearsal is recorded or the plan stays blocked on the named step.

### Host adapters wave 1 (ADPT)

- [x] **ADPT-01**: `resolveHomeSpecs` resolves homes with roles `config`, `skills`, `mcp`; an absolute `envOverride` moves `config` and `mcp` homes and never `skills`; `envBase` moves OpenCode's home with `XDG_CONFIG_HOME`; `installHome` selects by role; `resolveHomes` keeps its current results for every existing entry; a leaf-symlink refusal carries no `--config-home` hint.
- [x] **ADPT-02**: A `text-block` recipe with `tomlTable` refuses (`foreign-content`) any install whose file already defines that table or an ancestor key outside the markers, by the conservative line scanner of `src/host/toml-table.ts`; nothing is written on refusal; recipes without the field behave as before.
- [x] **ADPT-03**: `realm host status` reports an `unreadable` entry state (not `drifted`) for a refused or unparseable owned file, and `launch` (`on-path` or `not-on-path`) for an installed `mcp-config` host; the doctor sentence carries the unreadable count; no new error code.
- [x] **ADPT-04**: `realm host install claude` merges the entry E-C1 into `<home or CLAUDE_CONFIG_DIR>/.claude.json` keeping every other byte-preserved key, mode and format; install, no-op, dry-run, drift, foreign content, hostile content, uninstall, doctor and status are proven on a fixture host; the value equals the golden `claude mcp add` output.
- [x] **ADPT-05**: The same lifecycle for `opencode` with the V1-shaped entry in `<XDG_CONFIG_HOME or ~/.config>/opencode/opencode.json`, JSONC refused, a sibling `opencode.jsonc` untouched.
- [x] **ADPT-06**: The same lifecycle for `codex` with the owned TOML block in `<CODEX_HOME or ~/.codex>/config.toml`; a table written by `codex mcp add realm ...` is refused as foreign content, never duplicated; other tables, comments and blank lines survive byte-exact.
- [x] **ADPT-07**: The same lifecycle for `kimi` (`~/.kimi/mcp.json`, `KIMI_SHARE_DIR`) and `kimi-code` (`~/.kimi-code/mcp.json`, `KIMI_CODE_HOME`); `kimi` has no binary detection; the recipe values equal `defaultManifestFor(id).launch` for all five recipe hosts.
- [x] **ADPT-08**: For each host a gated live file runs the validator tier, and where available the production tier, on an isolated `HOME`, skipping with a named reason when its prerequisite is missing; the skip-reason selection, the stub `realm`, the isolation guard and the version parsing are covered by a hermetic helper test that always runs.
- [x] **ADPT-09**: Docs state, per host, the file, the shape, the override, the validator, the project-level behavior, the evidence tier reached and the gaps; the Kimi flag resolution and the archived status are recorded; the contract table shows the recipes ready; the allowlist has no stale entry; module-size, `check:docs` and pack-smoke pass; the live rehearsal record states what ran and what did not.

## Carried from v2.0 (not in this milestone)

- [ ] **FS-02**: Path resolution is race-resistant: components are opened relative to a pinned root descriptor with no-follow semantics, so a symlink swapped between check and open is rejected
- [ ] **ANDA-01**: TypeScript client connects to Anda Engine components over the boundary confirmed by the Anda documentation, and the chosen boundary and its rationale are recorded in `docs/integration/anda-decision.md`
- [ ] **ANDA-02**: Connection performs a version handshake; a version mismatch fails with `ANDA_VERSION_MISMATCH`
- [ ] **ANDA-03**: Reconnection uses bounded exponential backoff with jitter; an unreachable bridge reports `ANDA_UNREACHABLE`, moves the state to degraded, and retries in the background
- [ ] **ANDA-04**: A Rust shim is added only if the documentation spike shows no TypeScript-reachable surface; if added, it is minimal, lives in `src/anda/native/`, has its own build, and is covered by contract tests from the TypeScript side
- [ ] **OMP-05**: When disconnected, the plugin reports it and applies the configured policy; it never silently falls back to unsandboxed file mutation
  Status: Complete (2026-10-30). Basis (owner decision D2): a scripted OpenAI-compatible provider drove Omp 18.12.6's own `write` tool through the Realm plugin. Advisory with the realm down showed the unavailable notice and wrote the file; fail-closed with the realm down blocked the write with `REALM_NOT_ACTIVE` and that error was in the provider's next request; an active realm let the write land. Not an LLM-driven run. Paths that do not load the plugin are outside this closure.
  Note: closed in this milestone by HARN-04 (owner decision D2).
- [ ] **PRD-DRV-01**: The realm compute driver serves ComputeDriver gRPC on a Unix socket in a 0700 directory with mode 0600, implementing GetCapabilities, ValidateSandboxCreate, CreateSandbox, GetSandbox, ListSandboxes, DeleteSandbox, WatchSandboxes, and EnsureWorkspace. AuthenticateSandbox is not advertised and returns UNIMPLEMENTED, because the gateway does not call it on the built-in path, and DeleteWorkspace refuses, because the driver never creates or removes the pinned workspace root. This amendment follows from the owner decisions of 2026-10-26 and 2026-10-27 and awaits the owner's confirmation (Phase 9.4)
- [ ] **UI-01**: The Omp plugin starts on session launch and shows its realm state in the Omp UI status item without blocking the session (accepted limitation by owner decision, 2026-10-23: the status item appears at launch; a non-blocking check was not demonstrated, because get_state took about 6 s during the attach and the cause is not isolated; re-measured 2026-10-28: keystrokes echoed within 0.2 to 1.2 s through a 24 s cold attach on a loaded host, which bounds the stall but does not prove the loop is never blocked)

## Standing requirements (completed earlier, still binding)

These requirements were completed in v1.0 and v2.0 and bind every phase of v3.0. The full v2.0 table is archived at `.planning/milestones/v2.0-REQUIREMENTS.md`. `AGENTS.md` cites QUAL-01 for the named silent-catch exceptions.

### Quality and documentation (QUAL)

- [x] **QUAL-01**: Every async boundary has a timeout; every error is typed with a machine-readable code and a human-readable reason; the silent-catch rule is amended as below
  Amended by decision: no silent catch blocks exist, except the named exceptions below. Each exception keeps the failure as recorded state or a retry, or fails closed, as stated.
  - (a) `src/anda/client.ts`, `deliver`: a listener throw or rejection leaves the event undelivered for the monitor to retry (2 sites).
  - (b) `src/anda/client.ts`, `stamp`: a clock failure leaves the transition undelivered and unstamped for retry.
  - (c) `src/lifecycle/controller.ts`, `stop`: a stop failure is recovered by the fallback destroy, which succeeds; the stop error is not kept.
  - (d) `src/lifecycle/controller.ts`, `probe`: a probe error is not recorded when a stop already owns the session; the stop's outcome is the session state (documented in the code).
  - (e) `src/omp/plugin.ts`, `attach`: a late rejection from a superseded attempt; the current attempt reports its own outcome.
  - (f) `src/omp/plugin.ts`, `attach`: a late rejection after the attach budget; the budget error is what the status reports.
  - (g) `src/daemon/channel.ts`, and `daemon.ts` `dispatchLine`: a malformed control line whose id cannot be recovered gets no reply; the socket closes. The rule is in the channel comment and in the phase 06 summary.
  - (h) `src/audit/redact.ts`: a value that fails redaction becomes the REDACTED sentinel (fail-closed by design).
  - (i) `src/observe/logger.ts`: a format or sink failure, and a throwing field getter while copying fields for `child`, increments the dropped-line count and does not throw. A logger is called from event-bus listeners.
  - (j) `src/observe/log-file.ts`, the file sink `write` and `close` and the stderr sink `write`: a write, rotate or close failure returns false, which the logger counts. An open descriptor is kept and the next write retries.
- [x] **QUAL-02**: Test suite includes unit tests, state-machine tests, contract tests for MCP and ACP, path and symlink tests, schema-rejection tests, audit-redaction tests, and integration tests that run only when Podman is present and skip with a stated reason otherwise
- [x] **QUAL-03**: Policy reference documents every policy key; security review and dependency and supply-chain review are recorded before the first release

## v2 Requirements (deferred)

- **V2-01**: macOS support through Podman machine, verified on a matching Podman machine version
- **V2-02**: One container per workspace granularity with cross-session lock leases and refcounted reaping
- **V2-03**: Per-subagent container isolation built on the existing lock and session model

## Out of Scope

- Building Ultrathink, Substrate, or Swarm — Realm provides seams only; siblings are separate products
- Substrate memory interface or any GSD-Core change — not part of Realm
- Multi-tenant or cloud-hosted realm — v1 is a local single-user sandbox
- Porting the C# OmpOS implementation or Grok Bot variant code — behavioral reference only, no code copied
- UI beyond the status indicator and retry command — explicit spec boundary
- Windows-native support — out of scope unless the session says otherwise
- Container engines other than Podman — Podman is the only v1 engine
- Model tuning or prompt changes — not a Realm concern
- FS-02 closure — the owner's status call; the property tests of QR-07 add confidence only and do not change its status
- ANDA-01 to ANDA-04 — blocked by the Anda engine licence
- UI-01 — accepted limitation, the owner's status call
- TD-06 (a smoke mode for `check:mcp` on a runner without Podman 5.x) — not part of the eight approved proposals
- TD-10 repository settings (secret scanning, push protection, branch protection or rulesets, `sha_pinning_required`) — the owner's, and they cannot be changed from the repository; only the release job split and the attestation are in this milestone (REL-01, REL-02)
- Any change to the product spec (`docs/specs/realm-spec.xml`) — read-only

## Traceability

v3.0 requirements: 52 total, 52 mapped

Each v3.0 requirement maps to exactly one phase. The carried requirements keep their v2.0 phase and status.

| Requirement | Phase | Status |
|-------------|-------|--------|
| HARN-01 | Phase 12 | Implemented-unverified; supplied current C1–C3, P12 isolated RPC/version/provider evidence |
| HARN-02 | Phase 12 | Historical Complete (2026-10-30, 3/3, 0 skipped, Omp18.12.6 native write); current shadowing preserved; parent C4 native CREATE1pass/0skip, P12 |
| HARN-03 | Phase 12 | Original warm44/coldskip49 retained; proxy0/0/7 narrower; signed spike repair implemented-unverified, latest lint blocked later checks; literal built-Realm warm proof pending, P12 |
| HARN-04 | Phase 12 | Historical Complete (2026-10-30): OMP-05 recorded with scripted native-write basis, not LLM-driven; preserve receipt, P12 |
| OMPX-01 | Phase 12 | Historical versioned spike answers; parent verified current C4 native CREATE1pass/0skip on Omp18.12.6; not broad current-spike/containment closure, P12 |
| QR-01 | Phase 13 | Implemented-unverified; actual audit-job run needed, P13A |
| QR-02 | Phase 13 | Implemented-unverified configuration; TD-10 settings excluded, P13A |
| QR-03 | Phase 13 | Finish/repair actual-tarball smoke implemented in `75631f4` with offline behavior checks; human workflow review and GitHub repair-run evidence remain open, P13A |
| QR-04 | Phase 13 | Host run 2026-11-08: `src/fs` branch floor 95 against 88.89 exited 1; committed floors exited 0 on Node 24.18; Node 22.x/24.x CI provenance remains open (D-1304; `261108-puz-CONTEXT.md`, Phase 13), P13B |
| QR-05 | Phase 13 | Implemented-unverified; 2026-11-08 one-CPU container `npm test`: 2799 passed, 0 failed, 34 skipped, 169.7 s, image `localhost/realm-qr05-runner:0626abe261`; CI provenance open (`261108-puz-CONTEXT.md`, Phase 13), P13C |
| QR-06 | Phase 13 | Shipped cleanup/source support; current reference inventory and intentional-seam disposition unverified, P13B |
| QR-07 | Phase 13 | Historical deliberate break3/11/restoration11/11 accepted; current suite/provenance attachment pending, P13B; FS-02 unchanged |
| QR-08 | Phase 13 | Owner chose permission drop D-1308; `9e2142f` applies `33dd980` to `.github/workflows/mutation.yml`; workflow human review and run artifact remain open, P13B |
| CRASH-01 | Phase 14 | Implemented-unverified including startup wiring; conditional negative-case pass/skip attribution pending, P14 |
| CRASH-02 | Phase 14 | Implemented-unverified planted-start/idempotence; explicit live in-chain presence pending under OBS, P14/P17 |
| CRASH-03 | Phase 14 | Implemented-unverified durable delete/fsync failure cases, P14 |
| CRASH-04 | Phase 14 | Historical live5 covered pre-adoption behaviour; current live 5 re-adopts and live 5b asserts `recordsDeleted` after SIGTERM removed the container. Startup removal with its ID, count and notice remains unproven (`14-VERIFICATION.md`), P14 |
| CRASH-05 | Phase 14 | Implemented-unverified four real child SIGKILL stages, original/orphan/sweep controls, P14 |
| CRASH-06 | Phase 14 | Implemented-unverified cause-code equivalence; no wire-shape-unification expansion, P14 |
| CRASH-07 | Phase 14 | Implemented-unverified stale-container one-shot controller retry, P14 |
| ONB-01 | Phase 15 | Individually verified 2026-10-31: first-wave init safety and fresh generated-config lifecycle; 2026-11-08 checkbox cleared: historical evidence not re-observed on lane `c39abe6` (`261108-puz-CONTEXT.md`, known stale statements), P15 |
| ONB-02 | Phase 15 | Individually verified 2026-10-31: nonroot 31 pass/0 skip and CLI dry-run/apply/idempotence; 2026-11-08 checkbox cleared: historical evidence not re-observed on lane `c39abe6` (`261108-puz-CONTEXT.md`, known stale statements), P15 |
| ONB-03 | Phase 15 | Individually verified 2026-10-31: rebuilt driver and daemon shared generated config; 2026-11-08 checkbox cleared: historical evidence not re-observed on lane `c39abe6` (`261108-puz-CONTEXT.md`, known stale statements), P15 |
| ONB-04 | Phase 15 | Implemented diagnostics; actionable post-init missing-root repair guidance unresolved, P15 |
| ONB-05 | Phase 15 | Historical isolated local link Omp18.12.6/package0.3.24 retained; README/snippet steps now authored, parent docs checks pending; registry/current installed-load not claimed, P15 |
| ONB-06 | Phase 15 | Actual generated-config lifecycle captured Realm0.3.26/Podman5.7.1; normalized exact README transcript authored, parent docs checks pending, P15 |
| ONB-07 | Phase 15 | Implemented-unverified real-child sentinel tests on both daemon launches, P15 |
| DEF-01 | Phase 15 | Implemented-unverified fail-closed schema/loader/provenance, P0/P15 |
| DEF-02 | Phase 15 | Implemented-unverified current docs/default guard/fixture cutover; historical exclusions retained, P0/P15 |
| OMPX-02 | Phase 16 | Registered frozen calls implemented; successful-read regression/model-visible proof incomplete, P16 |
| OMPX-03 | Phase 16 | Missing active-set/lifetime transition correctness and actual catalogue bash proof, P12/P16 |
| OMPX-04 | Phase 16 | Same-name replacement implemented; safe restore/mode publication and current advisory proof incomplete, P12/P16 |
| OMPX-05 | Phase 16 | Missing real production Omp path coverage; live-gated /workspace+host+actual audit pair, P16 |
| OBS-01 | Phase 17 | Automated pass: seq/prev chain, verify with file, session, head and anchor selectors, oversize and over-bound fail closed (1fa6c98, 334c1ad, 2640681); live audit verify in scenarios 5 and 6 human-needed, P17 |
| OBS-02 | Phase 17 | Automated partial: JSON sinks and events, correlation ids, daemon.log rotation and unrecognized-refusal logging (1829d4f, a044d12, 757a6b2); live scenario 6 human-needed; open owner decisions on audit.head cost, unreadable audit file, crash stack and audit.head coverage, P17 |
| OBS-03 | Phase 17 | Automated pass: metrics over the control socket only, with the /proc listener test; live scenario 6 metrics counts human-needed, P17 |
| OBS-04 | Phase 17 | Automated pass for the gateway path; driver-only classification awaits owner ratification of D-1701 (O-e); live scenario 10 human-needed, P17 |
| MULTI-01 | Phase 18 | Decision recorded2026-10-30/PR36; retain chronology, not runtime completion, P18 |
| MULTI-02 | Phase 18 | Implemented offline, tests authored; live acceptance open: identity and pin registry (`src/session/paths.ts:57-74`, `test/session/paths.test.ts:35-89`, `src/session/workspace-registry.ts`, `test/session/workspace-registry.test.ts`), P18 |
| MULTI-03 | Phase 18 | Implemented offline, tests authored; live acceptance open: session registry, admission and locking (`src/daemon/sessions.ts`, `src/daemon/daemon.ts:432-539`, `test/daemon/daemon.test.ts:1905-2495`), P18 |
| MULTI-04 | Phase 18 | Selected-project transport and per-sandbox mount implemented offline (`src/daemon/channel.ts:114-158`, `src/daemon/client.ts:138-196`, `src/runtime/driver/compute-driver.ts:852-956`); live acceptance open, deployed driver closure not restarted (`261108-puz-CONTEXT.md`, driver caveat), P18 |
| MULTI-05 | Phase 18 | Two-project scenario authored and live-gated (`test/integration/production-driver.test.ts`, two projects); owner-approved live window on 4ad91be (2026-11-15, `18-14-SUMMARY.md`) passed the production suite 37 of 37, including the two-project scenario; the earlier window that failed at first `up` with `OPENSHELL_START_FAILED` is superseded; acceptance open for the NOT VERIFIED items in `18-14-SUMMARY.md`, P18 |
| MULTI-06 | Phase 18 | Implemented offline, tests authored; live acceptance open: aggregate ledger and bound (`src/daemon/admission.ts`, `src/runtime/hardening.ts:53-131`, `test/daemon/admission.test.ts`, `test/runtime/hardening.test.ts:881-913`), P18 |
| RES-01 | Phase 19 | Complete 2026-11-16: D5 recorded 2026-10-30 (`0d299a0`) precedes all dependent code; D19-2 and D19-5..D19-10 were recorded in the same commit as their code (owner-accepted deviation, `19-VERIFICATION.md`) |
| RES-02 | Phase 19 | Complete 2026-11-16: adoption, hydration and the driver-restart rebuild (container restart, rebuilt runtime channel, new supervisor) in `src/runtime/driver/lifecycle.ts`, `src/runtime/driver/registry-rebuild.ts`, `src/daemon/daemon.ts`; Live acceptance 2026-11-16 on `2ff6df9`: production suite 40 of 40, 0 skipped (`19-VERIFICATION.md`); owner-accepted known gaps: one unexplained `production live 12` failure in 14 full runs (G1), D19 same-commit ordering. |
| RES-03 | Phase 19 | Complete 2026-11-16: scratch creation, attachment and ordered deletion (`src/runtime/hardening.ts`, `src/runtime/libpod-client.ts`, `test/runtime/driver/scratch-volume.test.ts`); live scenario 12 ok in 13 of 14 full runs and 9 of 9 isolated runs (G1 open risk, owner-accepted) |
| RES-04 | Phase 19 | Complete 2026-11-16: spike recorded (`docs/integration/workspace-snapshot-spike.md`), D19-6 full copy; checkpoint create/restore (`src/session/checkpoint.ts`, `src/cli/checkpoint.ts`) with the in-memory stopped-project pin (PR 91); live `19 checkpoint-roundtrip` ok |
| RES-05 | Phase 19 | Complete 2026-11-16: live scenarios 5, 5c, 12, 13, `19 verifier-failure`, `19 no-record`, `19 driver-restart` and `19 checkpoint-roundtrip` ok with no skip in the 40-test runs; the daemon-kill same-container survival is scenario 5 (`19-VERIFICATION.md`) |
| REL-01 | Phase 20 | Complete (live release v0.3.30: build job read-only, publish job write grants) |
| REL-02 | Phase 20 | Complete (gh attestation verify exit 0 on v0.3.30 tarball, SHA256SUMS, SBOM; repair path offline-tested, owner-accepted) |
| REL-03 | Phase 20 | Complete (test rollback run 43951066556; docs rebuilt from the known-good SHA) |
| REL-04 | Phase 20 | Complete (release-cases tests, 59 passing) |
| HOST-01 | Phase 21 | Complete |
| HOST-02 | Phase 21 | Complete |
| HOST-03 | Phase 21 | Complete |
| HOST-04 | Phase 21 | Complete |
| HOST-05 | Phase 21 | Complete |
| HOST-06 | Phase 21 | Complete |
| HOST-07 | Phase 21 | Complete |
| HOST-08 | Phase 21 | Complete |
| HOST-09 | Phase 21 | Complete |
| OMPB-01 | Phase 22 | Complete |
| OMPB-02 | Phase 22 | Complete |
| OMPB-03 | Phase 22 | Complete |
| OMPB-04 | Phase 22 | Complete |
| OMPB-05 | Phase 22 | Complete |
| OMPB-06 | Phase 22 | Complete |
| OMPB-07 | Phase 22 | Complete |
| OMPB-08 | Phase 22 | Complete |
| BOOT-01 | Phase 23 | Complete |
| BOOT-02 | Phase 23 | Complete |
| BOOT-03 | Phase 23 | Complete |
| BOOT-04 | Phase 23 | Complete |
| BOOT-05 | Phase 23 | Complete |
| BOOT-06 | Phase 23 | Complete |
| BOOT-07 | Phase 23 | Complete |
| BOOT-08 | Phase 23 | Complete |
| BOOT-09 | Phase 23 | Complete |
| ADPT-01 | Phase 24 | Complete |
| ADPT-02 | Phase 24 | Complete |
| ADPT-03 | Phase 24 | Complete |
| ADPT-04 | Phase 24 | Complete |
| ADPT-05 | Phase 24 | Complete |
| ADPT-06 | Phase 24 | Complete |
| ADPT-07 | Phase 24 | Complete |
| ADPT-08 | Phase 24 | Complete |
| ADPT-09 | Phase 24 | Complete |
| FS-02 | Phase 2 | Partial (accepted approximation, confirmed by the owner 2026-10-23; rebind verified through the pinned root; check-to-use windows remain on the read and write paths; audit G-10) |
| ANDA-01 | Phase 3 | Partial (live-gated) |
| ANDA-02 | Phase 3 | Partial (live-gated) |
| ANDA-03 | Phase 3 | Partial (live-gated) |
| ANDA-04 | Phase 3 | Partial (live-gated) |
| OMP-05 | Phase 5 | Complete (2026-10-30, HARN-04, owner decision D2): scripted provider drove Omp 18.12.6's own write through the Realm plugin; not LLM-driven |
| PRD-DRV-01 | Phase 9.4 | Open: socket 0700/0600 verified live and in tests, AuthenticateSandbox UNIMPLEMENTED and not advertised, DeleteWorkspace refuses; the amendment follows from the owner decisions of 2026-10-26 and 2026-10-27 and awaits confirmation |
| UI-01 | Phase 9 | Accepted limitation (owner decision 2026-10-23): status item at launch; re-measured 2026-10-28: keystrokes echoed within 0.2 to 1.2 s through a 24 s cold attach on a loaded host, which bounds the stall but does not prove non-blocking; the status stays the owner's call |
| QUAL-01 | Phase 1 | Complete (amended 2026-10-22); standing, binds every v3.0 phase |
| QUAL-02 | Phase 2 | Complete; standing |
| QUAL-03 | Phase 7 | Complete; standing |

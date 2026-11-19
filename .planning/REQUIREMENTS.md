# Requirements: Realm

**Defined:** 2026-10-29
**Core Value:** Every file mutation by an agent either lands inside the realm under policy or fails closed, and the user can always see whether the realm is active or disconnected.
**Source:** `.planning/quick/261029-g7m-lifecycle-and-persistence-findings/IMPROVEMENT-PROPOSALS.md` (the "Proposed change" of proposals 1 to 8 is the scope; each "Success measure" is the acceptance test) under the owner decisions D1 to D6 of 2026-10-29 in `.planning/milestones/v3.0-MILESTONE-CONTEXT.md`. Research was skipped; the proposals and the findings documents beside them are the requirement basis.

All v3.0 requirements are hypotheses until shipped and verified.

**Recovery record (2026-10-31):** original task `Trealm31-gsd-records`, execution correlation `ut-mvvowl70-29165019`, remains accepted/DONE; the original 52-ID/code/recipe map in `phases/RECOVERY-2026-10-31.md` is retained as its historical snapshot. Bounded prerequisite task `Trealm31-prereq-onboarding-evidence`, correlation `realm-prerequisites-onb-network-oct31`, updates only the five signed docs/state paths within the existing invoked autonomous flat workflow. Individual ONB-01/02/03 evidence below supersedes their old pending status; unrelated unchecked rows are not promoted by a suite total. Historical checked HARN-02/HARN-04 and OMP-05 receipts remain intact. No aggregate gate, phase/SUMMARY/VERIFICATION completion or milestone closure is inferred; all nine phases remain incomplete.

**Parent evidence boundary:** the first joined wave passed typecheck/lint, 2380 tests (2351 passed, 0 failed, 29 skipped), 282 script tests, gate-closure (4 modules, 0 violations), build/pack/MCP (`firstWaveVerification`, parent artifact `artifact://8723`). MCP smoke there covered disconnected catalogue behaviour, not a live sandbox. The latest post-network union passed typecheck, then FAILED lint on two unnecessary optional chains in `test/integration/omp-spike.test.ts` at 955:43 and 960:55; all later chained tests/scripts/docs/gates/build/pack/MCP were NOT RUN (`lastJoinedAttempt`, lint artifact `artifact://8741`). The original owner is correcting those causes, not suppressing them. Neither result verifies future edits in this prerequisite wave; parent alone verifies the joined changes.

**Milestone v2.0 closed 2026-10-29.** The full v2.0 table is archived at `.planning/milestones/v2.0-REQUIREMENTS.md`. The requirements it left open (FS-02, ANDA-01 to ANDA-04, OMP-05, PRD-DRV-01) and the accepted limitation UI-01 are listed under "Carried from v2.0" below. OMP-05 is closed in this milestone by HARN-04; the others are not in this milestone. Dispositions of 2026-11-17 (Phase 27): ANDA-01 to ANDA-04 dropped by owner decision D-27-01; OMP-05 complete; FS-02 and UI-01 accepted limitations; PRD-DRV-01 open pending the owner's confirmation (confirmed later on 2026-11-17, see the traceability table). See `.planning/phases/27-anda-disposition-and-v4-0-requirement-closure/27-DISPOSITIONS.md`.

## v3.0 Requirements

### Omp live harness (HARN)

- [x] **HARN-01**: A gated test harness starts an isolated Omp profile whose model provider is a local OpenAI-compatible stub returning a scripted sequence (one `write` tool call, then a final message), loads the built extension with `-e`, and drives Omp over RPC pipes (`--mode rpc-ui`), with no pseudo-terminal, no credentials and no tokens
- [x] **HARN-02**: The harness runs three cases: advisory mode with the realm down (the notice is shown and the file exists), fail-closed mode with the realm down (the call is blocked with `REALM_NOT_ACTIVE` and the file does not exist), and the realm active (the call proceeds; this is the baseline that Phase 16 changes)
  Recovery supersession: the checked three-case native-write receipt is historical. Phase16's accepted OMPX-04 same-name replacement means disconnected registered Realm write now refuses even in advisory mode and creates no host file. Supplied current C1–C3 passed on those semantics. The parent now separately verified C4 native patch-mode edit CREATE: 1 passed, 0 skipped on Omp18.12.6 (`firstWaveVerification.realC4`, `artifact://8723`), with no unissued snapshot tag. This is fake-backed host guard/control evidence, not production sandbox/audit proof. Do not erase the original receipt or claim registered-tool refusal meets its old native file-exists expectation.
- [x] **HARN-03**: One command runs the harness against a built extension and a local Omp and passes; it records the Omp version and makes no connection to any host except the loopback stub (and Omp's three loopback discovery probes, D-1205). On a warmed profile, no connection outside the loopback stub is permitted; a cold profile is reported as skipped, its model-catalog refresh being the recorded reason. The command is gated like the production live suite, skipping with a stated reason when Omp, Podman or the gate variable is absent
  Evidence chronology: original S11 warm FAILED with 38 external + 6 DNS = 44 offenders; cold separately skipped with 49 offenders. The same-run refusing LOOPBACK PROXY LEVER observed 0 external, 0 DNS and 7 refused CONNECTs, narrower than a built-Realm warm harness pass. The original signed spike repair is now implemented-unverified, not NOT QUEUED; the latest parent union stopped at its two lint errors before later checks. The separately signed built-Realm prerequisite owns strict measured warm registered-write coverage with only `defaultAllow(stubPort)` (stub + discovery11434/8080/1234), no extra proxy port, zero external/DNS/offenders, separate cold skip, exact bytes/tool result/provider continuation and raw trace/version. Literal built-Realm warm execution remains pending parent proof; no spike/text-only substitute or network exemption completes HARN-03.
- [x] **HARN-04**: OMP-05 is recorded complete in the traceability table on the harness evidence, and the recorded basis states that the run is scripted through Omp's own `write` tool and is not LLM-driven (owner decision D2)

### Quality and supply-chain ratchet (QR)

- [x] **QR-01**: `ci.yml` runs `npm audit --omit=dev --audit-level=high`
- [x] **QR-02**: `.github/dependabot.yml` exists and covers the `github-actions` and `npm` ecosystems for the repository root and for `site/`
- [x] **QR-03**: TD-07: `pack-smoke` includes the host snippets and the prime-agent `MCP.md` and `SKILL.md`, and the release job reruns `check:pack` on the release tarball after the version sync
- [x] **QR-04**: A `test:coverage` script produces the Node test runner's coverage output, and CI enforces a per-directory floor ratchet for `src/fs`, `src/core` and `src/tools`: CI fails when coverage in one of these directories drops below its recorded floor
- [x] **QR-05**: Fixed-timeout tests are replaced by an injected fake clock where a seam exists (the libpod TTL cache and the idempotent lifecycle test) and by a shared scaled-timeout helper in `test/support` elsewhere (the 21 `{ timeout: 10_000 }` caps under `test/acp` and the other fixed waits the proposal lists); the suite passes on a loaded host, verified in a CPU-limited container
- [x] **QR-06**: TD-09: dead exports found by reference analysis (`scripts/check/export-usage.mjs`; coverage output cannot find them, because a test covers an export that only tests use) are removed: an export used only inside its own file loses the keyword, an export used only by tests stays as a documented seam unless it is obsolete; the frozen error catalogue, the `ports` types and the schema validator types are not changed
- [x] **QR-07**: `fast-check` is added as a dev dependency with the three items `CONTRIBUTING.md` requires (justification, licence check, maintenance check); properties run in `npm test` and cover the path canonicalizer (no result escapes the root for random `..`, symlink, NUL, doubled-slash and unicode inputs) and the policy parser (round trip, unknown keys rejected); a deliberately broken canonicalizer fails at least one property
- [x] **QR-08**: A scheduled, non-blocking mutation run covers `src/fs`, `src/core/policy.ts` and `src/audit/redact.ts`

### Crash safety (CRASH)

- [x] **CRASH-01**: A startup sweep removes regular files named exactly `.<name>.realm-tmp-<16 lowercase hex>` under each configured workspace root and the state directory's session directory, through the pinned-root descriptor and never by following symlinks, only when older than a stated bound; each removal is audited, and no other dotfile is touched
- [x] **CRASH-02**: At startup, for each audit file, every admission line with no following result line gets one reconciliation line, marked as a reconciliation and not an execution result, using the catalogue code the owner approved (owner decision D5: an existing code if one fits, otherwise the one allowed addition); a second start appends none
- [x] **CRASH-03**: The sessions directory is fsynced after `SessionStore.delete`, reusing the directory-sync helper of `src/fs/atomic-write.ts`
- [x] **CRASH-04**: The startup reap logs the container ids removed and the number of records deleted, and the next attach shows a status-read notice, so a destroyed sandbox is never silent
  Current bounded disposition: production live5 actually passed on 2026-10-31 with the rebuilt driver (live5/6 together: 2 passed, 0 skipped). Its assertions cover real SIGKILL, replacement active with exactly one container, status-read notice with 1 container and at least 1 session record, and a `daemon.startup` log entry naming the destroyed container. However, `startupReapLineFor` (`test/support/production-live.ts`) asserts `containersRemoved` and `containerIds`, **not the logged `recordsDeleted` count**. `src/daemon/main.ts` emits that field, but source emission is not the missing runtime assertion. Keep CRASH-04 unchecked until the logged record-deletion count is asserted against the actual run; Phase19 selective-notice preservation also remains a separate future obligation.
  2026-11-08 correction: `startupLineWith` can compare `recordsDeleted` (`test/support/production-live.ts:295-316`), and scenario 5b asserts `recordsDeleted >= 1` (`test/integration/production-driver.test.ts:761-766`). Scenario 5b passed live after SIGTERM removed the container; it did not show startup removing that container. CRASH-04 and Phase 19 selective-notice acceptance remain open.
- [x] **CRASH-05**: Real-SIGKILL tests: a child process writes through `atomicWriteFile` and kills itself from the stage hook at each of the four stages (`after-temp-write`, `after-fsync`, `before-rename`, `after-recheck`); for each stage the parent asserts the original is intact, names the orphan temp file, and asserts the next sweep removes it
- [x] **CRASH-06**: TD-01: the refusal cause code is carried across the daemon for MCP and ACP, with a daemon-path equivalence test beside `test/surfaces/equivalence.test.ts` showing the same cause code over MCP and ACP as in process
- [x] **CRASH-07**: TD-04: when the recorded container is gone, a retry from the error state creates a new container instead of failing with `OPENSHELL_START_FAILED`; a controller test with a removed container reaches `active` on retry

### Zero-config onboarding (ONB)

- [x] **ONB-01**: `realm init` writes `config.json` and `policy.json` templates, creates the state directory with mode 0700, refuses to overwrite an existing file, and takes the image digest as an argument or from `release/` (it never invents one); on a clean host with Podman 5.x, `realm init` then `realm up` reaches active with no manual file edit
  Individually verified (2026-10-31 parent): first-wave init safety suite in `artifact://8723` plus actual fresh generated-config lifecycle on compiled Realm0.3.26/Podman5.7.1, uid5002. Init reported fail-closed; up/status active with exactly one actual rootless container; down unbound, zero containers. No manual JSON edits. `test/cli/init.test.ts` covers 0600 templates, 0700 state/derived roots, no overwrite and unsafe-root refusals. README normalizes the actual stdout. Scope requires an already provisioned gateway/supervisor/rootless Podman and matching rebuilt compute driver, not a claim that init or a released installer provisions those prerequisites.
- [x] **ONB-02**: `realm doctor --fix` applies only the safe subset (create missing directories, set the state directory to 0700), supports a dry-run mode, refuses symlinked directories, is idempotent and reports what it changed; everything else stays prose; run on a state directory with mode 0755 it changes it to 0700, and a second run changes nothing
  Individually verified (2026-10-31 parent): 31 nonroot doctor tests passed, 0 skipped, uid5002; actual CLI dry-run/apply/idempotence also passed (`firstWaveVerification.unprivilegedDoctor`, `artifact://8723`). `test/cli/cli.test.ts` exercises the real runCli consumer with 0755→0700, run/sessions creation, dry-run immutability, symlink refusal, unchanged unrelated contents and `fixes: []` on repeat. Current README/snippet command documentation still awaits parent docs checks.
- [x] **ONB-03**: The three `REALM_DRIVER_*` roots (secret, workspace and state) move into `config.json` with a default derived under `stateDir`; the environment variables are removed (clean cutover, no shim); the driver and the daemon read the same source
  Individually verified (2026-10-31 parent): fresh actual driver/daemon run selected the same generated config, no legacy root environment and no manual JSON edits (`freshLiveVerification.sameConfig`). `runtimeRootsOf` derives secret/sandbox-state roots under stateDir; workspaceRoot is explicit. Driver `loadDriverProcessConfig` and daemon `runDaemon` read that shared source. Driver image/socket/gateway/supervisor settings remain their documented separate environment contract. Temporary rebuilt-driver success does not prove a released service was permanently upgraded.
- [x] **ONB-04**: `realm doctor` checks that the three roots are set, absolute and mode-correct, that the driver socket is present with mode 0600 in a 0700 directory, and that the gateway is reachable (TD-03); a failure names the check and the fix, and a unit test covers each check
- [x] **ONB-05**: `omp plugin install` is verified live under an isolated profile, the result is recorded in `docs/hosts/snippets/omp.md`, and `README.md` carries the install steps
- [x] **ONB-06**: `README.md` carries a quickstart with a transcript, captured on a real Podman 5.x host, of `init`, `up`, `status` and `down`
  Docs authored in this bounded unit: README now carries the isolated local-link commands and exact normalized generated-config lifecycle stdout; Omp snippet retains the historical Omp18.12.6/package0.3.24 install receipt. ONB-05/06 stay unchecked pending parent docs/link/path/AGENTS-sync/default-mode checks after these edits. No registry/marketplace or current-package installed-load proof is substituted.
- [x] **ONB-07**: The daemon starts with an allowlisted environment (`PATH`, `HOME`, `XDG_RUNTIME_DIR`, `XDG_CONFIG_HOME` and what the roots need) in both `startDetachedDaemon` and the CLI's spawn; a test shows that a sentinel variable does not reach the daemon

### Containment default (DEF)

- [x] **DEF-01**: A policy with no `mode` loads as fail-closed; the schema default and the loader agree; advisory requires the explicit value (owner decision D4)
- [x] **DEF-02**: The policy reference, the README, the Omp notes, the doctor output and the `init` templates state the fail-closed default, and every test that relied on the old advisory default either states its mode explicitly or asserts the new default; no document still calls advisory the default

### Omp in the sandbox (OMPX)

- [x] **OMPX-01**: A spike on a live Omp determines whether `registerTool` tools reach the model, whether `setActiveTools` removes `write`, `edit` and `bash` from the callable set and is enforced at execution, and whether `registerFileWriteFallback` can redirect a write; the finding is recorded with the Omp version in `docs/integration/omp.md` and closes OQ-P5-01 and OQ-P5-02
- [x] **OMPX-02**: The extension registers `exec`, `read`, `write`, `list` and `status` as Omp tools; each calls the daemon client with the frozen `ToolCall` shape, so validation, locking, audit and the state gate stay in the shared dispatcher (`retry` stays the existing `realm-retry` command; no `glob` tool is added)
- [x] **OMPX-03**: In fail-closed mode the built-in `write`, `edit` and `bash` are removed or blocked by the mechanism the OMPX-01 spike proves, the existing `tool_call` guard stays as a backstop, and a model-issued `bash` call is refused with a catalogue code; if the API cannot enforce removal, the status text and the docs say that fail-closed is a guard and not containment (owner decision D3)
- [x] **OMPX-04**: In advisory mode the Realm tools are registered and the built-in tools other than `read` and `write` stay available, with the existing notice; the registered Realm `read` and `write` displace the built-in `read` and `write` because they share their names (owner decision, the one exception)
- [x] **OMPX-05**: On a live Omp with the realm active, a model-issued write through the registered tool lands in the sandbox's `/workspace` and appears in the host root, and the audit log holds an admission line and a result line for it; this runs through the Phase 12 harness

### Observability and audit integrity (OBS)

- [x] **OBS-01**: Each audit line carries `seq` and `prev` (the sha256 of the previous line); `realm audit verify` reads an audit file, passes an untouched file, and names the first line that breaks the chain (edited, removed or reordered); the chain head is recovered from the last line at startup, and the design covers the reconciliation lines of Phase 14 and the Merkle anchor
- [x] **OBS-02**: A leveled logger writes one JSON object per line on the daemon's log, with a correlation id per `up` and per tool call that also appears in the admission and result audit lines, and the catalogue code in a fixed field; it adds no dependency
- [x] **OBS-03**: Counters and timings (tool calls by outcome, state transitions, attach duration) are exposed over the existing control socket, and no network listener exists
- [x] **OBS-04**: TD-05: a distinct catalogue code for gateway or driver loss, approved by owner decision D5, is mapped in the probe path and shown by `realm status`; a probe test shows the new code instead of `AGENTOS_CRASH_LOOP`

### Per-project sandboxes (MULTI)

- [x] **MULTI-01**: The new runtime decision (one session per project workspace, superseding one session per daemon) is recorded in `docs/integration/runtime-decision.md` before the code that needs it
- [x] **MULTI-02**: `up` carries a workspace root that is a descendant of a configured root; the session id derives from the workspace; each session has its own record, its sandbox `realm-<sessionId>`, its pinned subdirectory and its bind mount; a directory outside every configured root is refused with `POLICY_DENIED`
- [x] **MULTI-03**: The audit file, the lock table and the status snapshot are per session; `realm down` for one session leaves the others active
- [x] **MULTI-04**: The compute driver and the gateway contract handle a workspace per sandbox, with PRD-DRV-01 handled only as far as this phase needs
- [x] **MULTI-05**: A live scenario brings up two projects under the configured roots with distinct `/workspace` contents, shows that a write in one is not visible in the other, and shows that `down` of one leaves the other active; unit tests cover the per-session pin
- [x] **MULTI-06**: The aggregate memory and CPU commitment of concurrent sessions is bounded and documented, using existing configuration and no new catalogue code

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

### Host adapters wave 2 (WAVE2)

- [x] **WAVE2-01**: A `yaml-map` recipe kind installs, no-ops, drifts, refuses and uninstalls one `parent.child` entry of a block-style YAML file, owned by key identity and parsed value with no comment marker; the scanner refuses every case in the D-25-04 contract (nothing written, no new error code or refusal reason); comments, blank lines, other keys, quoting, indentation and line endings outside the owned lines survive byte for byte; modules `yaml-scan.ts` and `yaml-owned.ts` keep `recipe.ts` under 1000 lines.
- [x] **WAVE2-02**: A table entry may carry `shadows`; an install that would create the recipe file while a shadow path exists is refused `foreign-content` with nothing written, and is not refused when the recipe file already exists; recipes without the field behave as before.
- [x] **WAVE2-03**: `realm host install` registers `realm mcp --host <id>` in the user-level MCP file named in D-25-02 for `cursor`, `copilot`, `qwen`, `augment`, `pi`, `cline`, `antigravity`, `kilo`: each proven on a fixture host built from the real table row (lifecycle, no-op, dry-run, drift, foreign content, JSONC refusal, hostile content, symlinks, override, doctor, `realm host status`), against goldens whose source and date are recorded; each value equals the host's own output where observed and `defaultManifestFor(id).launch`.
- [x] **WAVE2-04**: The same lifecycle for `codebuddy` (`.mcp.json`, `CODEBUDDY_CONFIG_DIR`) including the `shadows` refusal with `mcp.json` in the config home and `.codebuddy.json` in the user's home, and the skip of the guard when `.mcp.json` exists.
- [x] **WAVE2-05**: The same lifecycle for `hermes` (`config.yaml`, `HERMES_HOME`, `mcp_servers.realm`) on goldens recorded from the host's own writer and its documentation, including a host-rewritten file (re-quoted, re-flowed entry, same parsed value) that stays `ok`.
- [x] **WAVE2-06**: Exactly 16 of the 19 hosts have a recipe; `windsurf`, `trae` and `zcode` keep `recipe: null`, refuse install as `recipe-pending`, change no file, and are pinned by name in the tests; each deferral row carries its reason and open-question id in a table comment; no recipe exists for a host whose config format is not documented.
- [x] **WAVE2-07**: For each of `qwen`, `pi`, `hermes`, `cursor`, `kilo`, `copilot`, `augment`, `codebuddy`, `cline` a gated live file installs the real recipe into an isolated `HOME` and has the host's own listing command parse it (and launch the stub `realm` where it launches), skipping with a named reason when its prerequisite is missing; the skip-reason selection, the version floor, the stub, the isolation guard and the version parsing are covered by a hermetic helper test that always runs; `antigravity`'s gap is written down.
- [x] **WAVE2-08**: Docs state, per shipped host, the file, the shape, the override, the validator, the project-level behavior and shadowing warning, the evidence tier reached (T1, T2, documented-only) with version and date, and the gaps; `deferred-hosts.md` records the three deferrals with reasons and alternatives; the contract table shows 16 hosts with a recipe and 3 pending; the allowlist has no stale entry; module-size, `check:docs` and pack-smoke pass; the rehearsal record states what ran and what did not.

### Plugin tests and author docs (TEST-HOST)

- [x] **TEST-HOST-01**: A table-driven contract checker runs every one of the 19 rows of the real runtime table through the invariants of D-26-03 (frozen rows, identity, safe homes, env shape, home resolution, recipe kind and paths, launch argv safe and equal to the default manifest, manifest, capability grants within the policy gates under three policies, shadow shape, pending rows inert) and returns no violation; seeded defective rows each return exactly their violation code.
- [x] **TEST-HOST-02**: A registry holds one record per host (recipe family, suite files, snippet, live spec, recorded T2 and T3, deferral); a completeness test fails, listing every host at once, when a table row lacks a registry record, a suite file, a snippet or a consistent live spec, or when a registry fact contradicts the table.
- [x] **TEST-HOST-03**: A generic lifecycle contract runs on every real recipe row (16) and the three pending rows: dry run writes nothing, install changes only the recipe file or bundle and the state directory, the receipt holds relative paths and hashes only, the audit chain verifies, the log is closed-vocabulary and redacted, reinstall is a no-op, uninstall restores the seeded bytes exactly and removes only what Realm owns, an override variable redirects everything, and a pending host refuses `recipe-pending` with nothing written; seeded defects (a secret in the audit, a secret in the log, an unowned removal, a write outside the home, a non-restoring uninstall) each fail it.
- [x] **TEST-HOST-04**: The production boot driver passes all nine conformance cases for each of the 18 `mcp-config` hosts; the harness fails on a seeded defect in every one of the nine cases (six new reference faults and three decorators over the production driver, plus the four existing), each with its declared exact failing set.
- [x] **TEST-HOST-05**: A scripted boot matrix over the 18 ids and both transports shows the `--host` grammar accepts exactly the 18 canonical ids (no alias, no `omp`, no hostile value), readiness before the first reply with a marker and an attached report, bounded `--reattach` retry with no timer left, the refused-up and failed-boot exits, and EOF and three signals ending the session the same way with no `down`.
- [x] **TEST-HOST-06**: A real in-process daemon matrix (no Podman) boots every one of the 18 ids through `realm mcp` and `realm acp` against its own project: it serves status, records the `hostBoot` metric row and the `host.boot` daemon log line, retries within the cap, leaves a sibling host, the sandbox and the daemon answering while its own `up` hangs, never sends `down` (exact count), leaves a verified `host-boot` audit chain with one `attached` line per session, and leaks no hostile project-name text or planted secret into any sink.
- [x] **TEST-HOST-07**: `docs/integration/writing-a-host-plugin.md` explains how to add a host end to end (table row, recipe choice, manifest, capabilities, boot hook, conformance and recipe suites, evidence tiers, live-rehearsal gating, Enterprise checklist, PR gates); `docs/integration/host-support-matrix.md` holds a block generated from the table, the registry and the live specs that a test compares and can rewrite; both are linked from the contract page, `hosts.md` and the README; a test checks every named repository path exists, no host-local path, no unescaped tag-like token; the docs site build and `check:docs` pass.
- [x] **TEST-HOST-08**: `docs/integration/host-plugin-gaps.md` tracks the Phase 21 to 25 unverified and residual items as rows with id, source, class, status, evidence and lift condition (the 32 of "The gap rows", reconciled with `25-VERIFICATION.md` if present); a test verifies ids, sources, evidence paths and per-phase coverage; the `src/host` coverage floor is ratcheted to the measured values.

### v4.0 Anda removal, MCP hardening and production boot proof

- [x] **ANDAX-01**: Every Anda requirement and open question (ANDA-01..04, OQ-P3-11, PRD-DRV-01 carry notes) is dispositioned by a recorded owner decision of 2026-11-17: the Anda bridge is removed and the replacement research is the rationale
- [x] **ANDAX-02**: The v2.0 carry list is reconciled: FS-02, OMP-05, PRD-DRV-01 and UI-01 have an evidence-cited disposition (complete, accepted limitation, or still open with a reason)
- [x] **ANDAX-03**: The Anda bridge code, the `andaUrl` config key, `ANDA_UNREACHABLE`, `ANDA_VERSION_MISMATCH`, the degraded state, the Anda doctor check and the Anda tests are removed with no shim
- [x] **ANDAX-04**: The state machine, status labels, schemas, policy reference, README and integration docs no longer mention the removed surface, and the check:docs and check:gates gates pass
- [x] **ANDAX-05**: The removal is a documented breaking change: release note text, config migration note (an unknown `andaUrl` key is refused with a clear message or ignored with a warning, as decided in the phase context)
- [x] **MCPA-01**: Every Realm MCP tool advertises tool annotations (readOnlyHint, destructiveHint, idempotentHint, openWorldHint) in both protocol eras `realm mcp` serves
- [x] **MCPA-02**: A test pins the annotations per tool against the tool contract, and a mutation of an annotation fails a test
- [x] **CAPT-01**: A spike answers whether a per-session capability token is worth building (threat model, same-user limits, cost) and records a build or drop decision with evidence
- [x] **CAPT-02**: A per-session, per-host HMAC capability token can be minted and verified in a fixed order with deterministic refusal classes, with a tool-to-capability mapping and per-host profiles, proven by a seeded refusal matrix
- [x] **CAPT-03**: A keyring at rest (mode and ownership checked, atomic) supports rotation by key id with a grace period and an emergency revoke
- [x] **CAPT-04**: The policy has a capabilityTokens key (mode off or enforce, ttlSeconds, per-host profiles) with schema, defaults, type and reference docs; the default leaves behaviour unchanged
- [x] **CAPT-05**: The token shape is redacted by the audit and log redaction layers in every position
- [x] **CAPT-06**: With enforcement on, every tool request is verified against a daemon-minted token before dispatch, fail closed with POLICY_DENIED, token AND policy; the client keeps the token in memory only; MCP, ACP and Omp hosts attach
- [x] **CAPT-07**: The verified host and key id are recorded on the audit lines of every tokened call; attaches and refusals are audited within a bound; the chain covers the fields
- [x] **CAPT-08**: realm host token status and rotate work without a daemon; a doctor item capability-tokens reports mode, keyring and misconfiguration
- [x] **CAPT-09**: The delivery decision, the limits (no defence against a same-uid reader) and the owner override are documented and tested; the 18 default manifests and 15 recipes are unchanged
- [x] **BOOTP-01**: Each wave 1 host that can run here (claude, codex; others named) is booted through its own CLI against the production stack, and Realm tools are listed or called, with results recorded
- [x] **BOOTP-02**: Hosts that cannot be booted (missing CLI, no credentials, archived) have a named gap in docs/integration/host-plugin-gaps.md

### v5.0 Cold attach, enforced capability tokens and evidence

- [x] **COLD-01**: `realm mcp` (`src/cli/stdio-host.ts`) answers the MCP handshake (`initialize`, `server/discover`, `tools/list`) before `ensure` and `up` complete, so a host with a 30 s connect timeout connects on a cold start (closes GAP-31-04)
- [x] **COLD-02**: Until the session is ready, the realm is reported as not active (the existing status vocabulary) and every tool call is refused with the existing not-active refusal (fail closed); once ready, tools work on the same connection with no reconnect
- [x] **COLD-03**: The warm path does not regress (a warm attach answers as before) and the status and audit contracts are unchanged; tests assert the not-active window, the transition to ready and the refusal of calls in between
- [x] **COLD-04**: The claude, opencode and codex production tiers pass on the live stack from a cold start, with the warm-up (`realm up --workspace` first) removed from the test harness (`test/support/host-live.ts`); `GAP-31-04` is closed in `docs/integration/host-plugin-gaps.md` with the evidence
- [x] **ENF-01**: The default of `capabilityTokens.mode` is `enforce`; the schema (`src/core/policy.schema.json`), the defaults, `docs/policy-reference.md`, the README and the tests change together, and a policy file with no `capabilityTokens` key loads as enforce
- [x] **ENF-02**: Every client shipped in the repository (the stdio hosts, Omp, ACP and `realm mcp`) attaches and works under enforce with no policy edit; a test per client class proves it
- [x] **ENF-03**: The migration path is documented and visible: `"mode": "off"` opts out, `realm doctor` says what to do when a stale or unlabelled client is refused, and the refusal message names the cause and the fix
- [x] **ENF-04**: The default flip is a recorded breaking change: its commits carry `!` in the subject so the release notes list them, and the release note text and the migration notes are in the docs

- [x] **EVID-01**: The capability token tests run end to end as a non-root user on a host with `ptrace_scope` 1, and the result is recorded (the Phase 32 runs were as root)
- [x] **EVID-02**: The `/proc/PID/mem` probe runs as a non-root, non-descendant, same-uid process and its result is recorded either way, settling or leaving open the memory-read claim of the Phase 32 limits
- [x] **EVID-03**: A live enforce proof on the production stack: claude through the daemon with the host attached under enforce, and the audit lines are verified to carry the host and the kid; the evidence is kept outside the repository and cited by date

- [x] **V1LIVE-01**: The v1.0 live items this host can run are re-verified, each with dated evidence kept outside the repository and recorded in the phase, or carried with a named reason: the doctor and control-socket live modes, the two reaper live checks, Muse Code and Hermes loading, Omp responsiveness
- [x] **V1LIVE-02**: The Anda live handshake and licence items from the v1.0 list are closed as dropped by owner decision D-27-01, and the v1.0 open-item list in the planning record is reconciled so that no item is left without a status

- [x] **SPEC-01**: `docs/specs/realm-spec.xml` no longer describes the Anda bridge, and the statements that require `andaUrl` or the degraded state are removed or retired; all other spec content is unchanged; the pull request records the owner's instruction of 2026-11-18 and the reason (an owner-directed edit of the spec)

### v6.0 Responsiveness, exec kill proof, host ids and evidence debt

- [ ] **OMPR-01**: The Omp cold attach is measured on a quiet host (one-minute load per CPU below 0.5) with `test/integration/omp-responsiveness.test.ts`: `get_state` answered across the attach, with the number of probes, the maximum and the 95th percentile recorded, and the result recorded as a pass or a finding (OI-11; Linear SPE-34662)
  Status: Carried (not met). Phase 38 (2026-11-19): six attempts, one valid quiet-host run, outcome VOID; OI-11 stays `Carried (no quiet slot)`. Phase 44 did not meet it. Accepted by the owner on completing v6.0 (2026-11-19); a candidate for v7.0
- [x] **OMPR-02**: If the quiet-host measurement exceeds the harness thresholds, the Omp extension path is made non-blocking (it answers before `up` completes, as `realm mcp` does since Phase 33), fail closed is kept (no mutation before the session is ready), and the measurement is repeated and recorded; if it passes, the phase records that no code change was needed
  Status: Not triggered (2026-11-19): the frozen rule gave VOID, so neither a code outcome nor a pass; plans 38-02 and 38-03 were not run and are superseded by Phase 44. The extension change was made by the owner's override (D-44-01) as OMPR-05, not by this requirement; no quiet-host verdict was reached
- [x] **OMPR-03**: The numbers and the host facts (load, CPU count, Omp version, date) are recorded in the phase and in `docs/integration/omp.md` either way, and the OI-11 row of the v1.0 open items reads closed on that evidence
  Status: Complete (as VOID, 2026-11-19): the numbers and host facts are recorded in `38-MEASUREMENT.md` and `docs/integration/omp.md`; the OI-11 label follows the outcome and reads Carried, not closed
- [x] **OMPR-04**: The responsiveness harness reads the cold-attach verdict over the window that starts at Omp's ready frame (probes before it are recorded as boot samples), with every threshold and the Phase 38 decision constants unchanged; a control-relative comparison and the host CPU pressure are recorded as a labelled secondary measure that is never a verdict; the baseline instability (five of nine no-extension baselines missed their 500 ms bound at 0.17 to 0.36 load per CPU) is recorded as a finding with its cause unestablished; the attribution of the one valid quiet-host run is written down with evidence tiers (owner override of the VOID outcome, D-44-01)
- [x] **OMPR-05**: The Omp extension path is changed on the owner's override of the VOID outcome: the daemon-launch functions move to src/daemon/launch.ts with every importer migrated and no re-export, so the extension's static import closure reaches no CLI, doctor, MCP or ACP module; the attach starts through an injected deferral, one event-loop turn after the session handler, skipping an ended or superseded session; fail closed is kept (no mutation or tool call reaches the daemon before the session is ready), shown by an attach-window test and the unedited Omp suites; the lint and gate allowlists name the new module in place of the old one without widening
  Status: Complete (hermetic basis, 2026-11-19): that the change makes the cold attach more responsive is not shown by this phase
- [ ] **OMPR-06**: The change is measured by a paired before/after comparison on the loaded host (at least five valid pairs, interleaved, each arm against its own no-extension control in the same test) under a decision rule fixed as code before the first run; the outcome (EFFECT, NO-EFFECT, REGRESSION, NOT-REPRODUCED or VOID), the per-pair numbers and the host facts are recorded in the phase and in docs/integration/omp.md, labelled loaded and paired and never cited as a quiet-host measurement; OI-11 is recorded Carried with the owner override and the paired outcome
  Status: Partial (2026-11-19): the paired loaded window ended VOID with three valid pairs of the five required; no effect claim for or against the change. Accepted by the owner on completing v6.0; a candidate for v7.0 together with OMPR-01
- [x] **EXEC-01**: A live closeout test runs a sleeper that outlives the timeout window; after `TOOL_TIMEOUT` the sleeper is dead (not merely finished) within a stated bound, shown by a check independent of the sleeper's own run time (a sleeper longer than the observation window and a process-state check inside the sandbox) (finding F-3; Linear SPE-34663)
- [x] **EXEC-02**: If the sleeper survives, the kill path of the dispatcher and driver is fixed so that a timed-out exec's process tree is killed, the session stays usable, and a hermetic test pins the behaviour
- [x] **EXEC-03**: The timeout contract is unchanged for callers (the retryable `TOOL_TIMEOUT` reply, the per-call bound, the audit line), and the docs and the finding F-3 record state what the proof shows and its limits
- [x] **HOSTID-01**: Muse Code, Prime Agent and Grok Build each have a host id in the closed host-id list and the policy `profiles` schema, with a manifest, recipe or launcher label as the host's config surface allows; a host with no verifiable config surface stays config-only with a label in its launcher
- [x] **HOSTID-02**: Each of the three hosts attaches and completes a tool call under the enforce default with no policy edit (`GAP-34-01` is closed in `docs/integration/host-plugin-gaps.md`), and the guard test of labelled launchers (`test/host/adapters-labelled.test.ts`) no longer carries the named exception
- [x] **HOSTID-03**: The contract checker, the support matrix, the host-plugin docs, the policy reference and the migration notes are updated and agree with the registry, and the docs site build and `check:docs` pass
- [x] **TEAR-01**: The report `daemon.stopped code=REALM_STOPPING failedTeardowns=1` after about 30 s in a stop with a sandbox container is reproduced, and its cause is found and recorded
- [x] **TEAR-02**: The cause is fixed or bounded, with a hermetic test that fails without the fix and a live run on the production stack that stops with a sandbox container and reports `failedTeardowns=0`
- [x] **DEBT-01**: The whole unit suite runs as a non-root user (uid 5002) and the result is recorded (EVID-01 Set B), including any failure as a finding
- [x] **DEBT-02**: A script under `scripts/check`, with tests, reports every commit subject in a pull request range that is breaking (by the repository's own rules) and lacks the `!` marker, unless the pull request lands as a merge commit; it is wired into the gate conventions of the repository
- [x] **DEBT-03**: The guard is enforcing where the existing gate conventions allow it without a workflow change; where enforcement needs a change under `.github/workflows/**` the guard stays report-only and the needed change is recorded for human review
- [x] **KIMI-01**: Kimi CLI and Kimi Code CLI are installed in a scratch location outside the repository, and the validator and production tiers are run as for claude, opencode and codex, with each result recorded with version and date
- [x] **KIMI-02**: Anything that cannot run has a named blocker, and `GAP-24-02` and the support matrix are updated to the evidence tier reached

### v7.0 Carried findings closure

Ids are new and do not repeat any archived id: `OMPV` (the Omp responsiveness repeat, next to the archived `OMPR`), `STOP` (the rapid stop then up finding F-41-1), `KIMV` (the legacy kimi repeat, next to the archived `KIMI`) and `HTIER` (Grok Build attribution and the production tiers of the three v6.0 host ids). The milestone context is `.planning/MILESTONE-CONTEXT.md`; the Linear tickets are SPE-34730 (Phase 45), SPE-34731 (Phase 46), SPE-34732 (Phase 47) and SPE-34733 (Phase 48).

- [x] **OMPV-01**: A dated feasibility record in the phase states which host-isolation and contention-measurement primitives the realm account can use on this shared host (a delegated cgroup v2 subtree or transient systemd scope, `cpuset` pinning, per-cgroup `cpu.pressure`, `taskset`, `/proc/PID/schedstat`, the system CPU pressure file), each with the command or read that showed it, and the measurement design is frozen from that record before any verdict run (Linear SPE-34730)
  Status: Complete (2026-11-19). Basis: `45-FEASIBILITY.md` (P1–P10) and `45-DESIGN.md` frozen from it; `45-01-SUMMARY.md` (Branch S, wrapper argv, frozen constants).
- [x] **OMPV-02**: A deterministic in-process stall probe exists as a hermetic test: it drives the real Omp extension attach path with a scripted control socket and scripted `up` latencies (no Omp, no Podman) and measures event-loop blocking in CPU time per synchronous slice; it fails on a seeded blocking attach (red first), passes on the current extension, and gives the same verdict when a CPU burner runs beside it
  Status: Complete (2026-11-19, load-resistant). Basis: `test/omp/attach-stall.test.ts` (+ `test/support/stall-probe.ts`); red-first seeded cases and burner equality in all 40 loops; min-of-5 rule and 100 ms bound under approved deviation; stop rule exceeded and reported. Closes none of OMPR-01/06/OI-11 alone (D-45-12).
- [x] **OMPV-03**: The live harness decides a run's validity from the contention the Omp process tree itself experienced (scoped CPU pressure and the run-queue delay of the Omp process over the window), not from the host one-minute load average, and attributes each unanswered-probe interval to on-CPU time, run-queue delay or sleep; the verdict thresholds (maximum 1000 ms, 95th percentile 500 ms) and the Phase 38 constants are unchanged, and the validity constants and the decision table are code pinned by a hermetic test
  Status: Complete as harness code (2026-11-19). Basis: `test/support/omp-contention.ts`, `omp-verdict.ts`, `omp-arm-run.ts`, `omp-window-analysis.ts`; thresholds unchanged. Carried limitation: shipped `run-p<pid>-i<id>.scope` check rejected this host's `run-<32hex>.scope` (0/3 V0); fixed post-hoc to `run-*.scope`, 0 V0 in the re-calibration.
- [ ] **OMPV-04**: The control and the cold attach alternate order inside each pair, the validity bound of the no-extension baseline is recalibrated from a recorded calibration on this host and frozen in code before the first verdict run (never changed after a verdict is seen), and a refusal or an invalid run is recorded with its reason and counted as nothing, never reported as a result
  Status: Not met, carried (2026-11-19). Alternating order is code, but no bound was frozen: 0 of 0 valid controls then 5/16 with 2 passing of 5 needed; `CALIBRATED_BOUNDS` null. See `45-VERIFICATION.md`.
- [x] **OMPV-05**: A live window on the production stack under the frozen design ends in exactly one of PASS, FINDING (thresholds exceeded on valid runs, with a named cause), NOT-REPRODUCED or VOID by a rule that is code with a hermetic test before the first live run; every number is labelled with its tier (measured, isolated or loaded, scoped), and the host facts, the commit, the Omp version and the isolation used are recorded in the phase and in `docs/integration/omp.md`
  Status: Complete as VOID (2026-11-19). Basis: `45-MEASUREMENT.md` (calibration VOID, re-calibration VOID 5/16, verdict window not run); tiers, host facts and isolation in the phase and `docs/integration/omp.md`; residue zero.
- [x] **OMPV-06**: OMPR-01, OMPR-06 and OI-11 are resolved from the window: on PASS or FINDING they close with that evidence, and when the window yields the valid pairs the rule needs OMPR-06 closes with an effect or no-effect record; on VOID they stay carried and the phase writes the owner's options (retire with a recorded reason, or repeat), and no row closes on VOID or on the hermetic probe alone; if the finding names the extension, the fix keeps fail closed (no mutation before the session is ready), is shown red first by the OMPV-02 probe, and growth beyond the `src/omp/plugin.ts` module ceiling goes to a new module; the status of UI-01 stays the owner's call
  Status: Complete, carried honestly (2026-11-19). Basis: `45-RESOLUTION.md` (D-45-12 VOID row; OMPR-01/06 + OI-11 carried; owner's options a–d; 36-DISPOSITIONS ledger line). Task 8 did not apply (no FINDING).
- [ ] **STOP-01**: Finding F-41-1 is reproduced live on the production stack: `realm up` immediately after the stop of a daemon that held a sandbox of the same name fails with `OPENSHELL_START_FAILED`, in a loop with no settle between iterations (also under CPU load), with the iteration count and the timeline of every component (the daemon request log, the gateway, the compute driver, the supervisor, Podman) kept outside the repository; if 50 consecutive iterations per variant do not reproduce it, the phase records the non-reproduction, pins the suspected mechanism hermetically, and carries F-41-1 with that evidence instead of claiming a fix (Linear SPE-34731)
  Status: Not met, carried (2026-11-19). F-41-1 never reproduced (0/51 immediate ups); 50-per-variant never reached. See `46-VERIFICATION.md`.
- [ ] **STOP-02**: The cause is established from that evidence and recorded in `docs/integration/runtime-decision.md` in place of the INFERENCE paragraph: which component's late teardown, or which missing wait, reaches the new sandbox of the same name, with timestamps and the cause code the refusal carries
  Status: Not met for F-41-1, carried (2026-11-19). F-46-1 cause recorded instead.
- [ ] **STOP-03**: The cause is fixed or bounded: after a stop returns, or on the next `up`, a start with the same sandbox name does not fail because of the previous sandbox's teardown; every wait has an explicit timeout, fail closed and the no-orphan guarantee are kept, the `daemon.stopped` contract (the `failedTeardowns` count and the first failure code) and the 29-code error catalogue are unchanged, and a hermetic test fails without the change and passes with it
  Status: Not met for F-41-1, carried (2026-11-19). F-46-1 fix (containerConfirm, teardown 70 s) is separate, red-first, weakly live-supported.
- [ ] **STOP-04**: A live run on the production stack does at least 20 consecutive stop-then-`up` iterations on one sandbox name with no settle between them and records zero `OPENSHELL_START_FAILED`, `failedTeardowns` 0 in every `daemon.stopped` row, and zero residue (containers, sandboxes, workspace entries, daemons); the variant c stop of Phase 41 that wrote no `daemon.stopped` row is explained or recorded as a finding
  Status: Not met (windows VOID) (2026-11-19). 20/20 per variant in windows 2 (a) and 3 (b, c); OBS-C never recurred, stays not established.
- [x] **KIMV-01**: The legacy kimi-cli 1.51.0 production tier is rerun from a scratch install outside the repository with the wire recorder log and the full output of `kimi mcp test realm` kept outside the repository, and the dated result (version, date, stack) tells apart a `tools/list` response that was never written, one written after the client closed, and an error response (Linear SPE-34732)
  Status: Complete (2026-11-19). Basis: `47-WINDOW.md` (kimi-cli 1.51.0 scratch; 3/3 cold runs ANSWERED with six names, 28804/31393/32301 ms; NOT-REPRODUCED; tier did NOT pass its 25000 ms bound; scratch removed, stack as found).
- [ ] **KIMV-02**: The cause of GAP-43-03 is established and recorded as the legacy client, `realm mcp` (its handling of an early-closing or slow-reading client) or the stack (cold session timing); if the cause is in `realm mcp` it is fixed with a hermetic test that fails without the fix and the production tier passes, and if it is in the client the tier is shown to pass in a documented variant or the owner's decision to retire the archived row (OQ-24-01) is recorded
  Status: Not met, carried (2026-11-19). Reproduction NOT-REPRODUCED, cause NOT-ESTABLISHED; GAP-43-03 open, narrowed. See `47-VERIFICATION.md`.
- [x] **KIMV-03**: GAP-43-01 is closed by evidence: which of `XDG_CONFIG_HOME`, `XDG_RUNTIME_DIR` and `REALM_DRIVER_SOCKET` a real legacy kimi user needs to reach a non-default production stack is shown live with `kimi mcp test realm` and no names restored by the recorder; if any is needed the `kimi` recipe writes an `env` block of those names only (no secret), its golden equals what the host itself writes, and the migration note tells an existing install what to refresh; if none is needed the row closes as not needed with that evidence; or the owner retires the row (OQ-43-03, OQ-24-01)
  Status: Complete as accepted-residual (2026-11-19, OD-47-1 option a). Basis: `47-WINDOW.md` ablation (XDG_CONFIG_HOME + XDG_RUNTIME_DIR needed for this non-default stack, REALM_DRIVER_SOCKET not) + expansion probe (no expansion); GAP-43-01 is `accepted` with manual workaround, not `closed`; no recipe env block, no migration note (recipe unchanged).
- [x] **KIMV-04**: `GAP-24-02`, `GAP-43-01`, `GAP-43-03`, the support matrix, `docs/integration/wave1-boot-matrix.md`, the host registry note and the contract checker agree with the result, the scratch installs are removed, and the production stack is left as found (no leftover container or session)
  Status: Complete (2026-11-19). Basis: `47-04-SUMMARY.md` (registry, 4 gap rows, wave 1 page, matrix block, snippet, contract, hosts page at one dated `rehearsal failed` result; scratch absent; stack equal before/after; no `src` change).
- [ ] **HTIER-01**: A Grok Build session is attributed `grok-build` in the audit line even when the shared Claude plugin bundle or Claude configuration file also carries a `realm` server, through an entry or bundle of its own or a launcher label that wins, shown live with the installed Grok Build version recorded and with a `realm` server present in both `config.toml` and the Claude files; if Grok Build offers no seam that makes the attribution deterministic, `GAP-40-01` stays accepted-residual with the missing host feature named and the verified workaround documented (Linear SPE-34733)
  Status: Not met live, carried (2026-11-19). Validator matrix Outcome A passed; live both-files attach failed at install (no audit line), control wrote no attach line. GAP-40-01 accepted-residual + GAP-48-03. See `48-VERIFICATION.md`.
- [x] **HTIER-02**: Muse Code has a production tier as claude, opencode and codex have: a cold attach on the production stack with no warm-up and a new project directory, the host launches `realm mcp --host muse-code` and the handshake, `tools/list` and the six tools show on the wire, with the installed version and the date recorded and the registry tier updated; or a named blocker (for example a missing provider seam)
  Status: Complete (2026-11-19). Basis: `48-WINDOW.md` Step D (Muse Code 1.4.24 cold pass, 5891 ms, full wire); registry T3 `rehearsed`, runtime `proven` (OD-48-1 yes).
- [x] **HTIER-03**: Prime Agent has a production tier by the same standard as HTIER-02, or a named blocker
  Status: Complete by named blocker (2026-11-19, B-48-02). Basis: no credential-free command starts the registered server (host property, `48-01`/`48-03`); registry T3 `gap`, GAP-48-04.
- [ ] **HTIER-04**: Grok Build has a production tier by the same standard as HTIER-02, or a named blocker
  Status: Not met, honestly failed (2026-11-19). Grok production failed at install (`config-home-missing`, harness defect, GAP-48-03); never reached the host. See `48-VERIFICATION.md`.
- [x] **HTIER-05**: The registry rows, the support matrix, `docs/integration/host-plugin-contract.md` (its statement that no wave 2 host has a production tier and the Phase 40 evidence table), `docs/integration/host-plugin-gaps.md`, the host pages under `docs/hosts/`, and the pinning tests agree with the result and with each other; `test/integration/enforce-default.test.ts` still attaches and completes a call for every host id under the default; and any attribution mechanism that adds a launcher is covered by the labelled-launcher guard test
  Status: Complete (2026-11-19). Basis: `48-04-SUMMARY.md` (registry/matrix/contract/gaps/boot/host pages/pins agree; `enforce-default` passes unedited; no launcher added).

### v8.0 Shared sandboxes and durable recovery

The eight requirements v7.0 carried (OMPV-04; STOP-01 to STOP-04; KIMV-02; HTIER-01 and HTIER-04) are retested under corrected instruments, and two owner-approved (HITL) design phases add IDs that do not repeat any archived id: `CBIND` (concurrent binding) and `SNAP` (durable snapshots). The milestone context is `.planning/MILESTONE-CONTEXT.md`. The eight retested IDs keep their v7.0 text and status; each is taken into its v8.0 phase here and closes only on a valid verdict, live evidence or a frozen design, never on a VOID outcome or earlier hermetic test alone.

- [ ] **OMPV-04**: The control and the cold attach alternate order inside each pair, the validity bound of the no-extension baseline is recalibrated from a recorded calibration on this host and frozen in code before the first verdict run (never changed after a verdict is seen), and a refusal or an invalid run is recorded with its reason and counted as nothing, never reported as a result — taken into Phase 49 (the bracket-arithmetic fix, then a recalibration that freezes `CALIBRATED_BOUNDS`)
  Status: Open at v8.0 start, not met (carried from v7.0). Taken into Phase 49 and closes only on that phase's outcome.
- [ ] **STOP-01**: Finding F-41-1 is reproduced live on the production stack: `realm up` immediately after the stop of a daemon that held a sandbox of the same name fails with `OPENSHELL_START_FAILED`, in a loop with no settle between iterations (also under CPU load), with the iteration count and the timeline of every component kept outside the repository; if 50 consecutive iterations per variant do not reproduce it, the phase records the non-reproduction, pins the suspected mechanism hermetically, and carries F-41-1 with that evidence instead of claiming a fix — taken into Phase 51
  Status: Open at v8.0 start, not met (carried from v7.0). Taken into Phase 51 and closes only on that phase's outcome.
- [ ] **STOP-02**: The cause is established from that evidence and recorded in `docs/integration/runtime-decision.md` in place of the INFERENCE paragraph: which component's late teardown, or which missing wait, reaches the new sandbox of the same name, with timestamps and the cause code the refusal carries — taken into Phase 51
  Status: Open at v8.0 start, not met (carried from v7.0). Taken into Phase 51 and closes only on that phase's outcome.
- [ ] **STOP-03**: The cause is fixed or bounded: after a stop returns, or on the next `up`, a start with the same sandbox name does not fail because of the previous sandbox's teardown; every wait has a bound, and a fix never weakens teardown bounds or the no-orphan guarantee — taken into Phase 51
  Status: Open at v8.0 start, not met (carried from v7.0). Taken into Phase 51 and closes only on that phase's outcome.
- [ ] **STOP-04**: A live run on the production stack does at least 20 consecutive stop-then-up iterations with no `OPENSHELL_START_FAILED`, recorded with dates and the stack's state — taken into Phase 51
  Status: Open at v8.0 start, not met (carried from v7.0). Taken into Phase 51 and closes only on that phase's outcome.
- [ ] **KIMV-02**: The cause of GAP-43-03 is established and recorded as the failing component (client, `realm mcp` or stack), or narrowed further with the evidence that bounds it, and is fixed where it is in `realm mcp` — taken into Phase 52
  Status: Open at v8.0 start, not met (carried from v7.0). Taken into Phase 52 and closes only on that phase's outcome.
- [ ] **HTIER-01**: A Grok Build session is attributed `grok-build` in the audit log even when the shared Claude files are present, through an entry or bundle of its own or a launcher label that wins; if Grok Build offers no seam that makes the attribution deterministic, GAP-40-01 stays accepted-residual with the missing host feature named and the verified workaround documented — taken into Phase 50 (the GAP-48-03 harness fix, then the live rerun)
  Status: Open at v8.0 start, not met live (carried from v7.0). Taken into Phase 50 and closes only on that phase's outcome.
- [ ] **HTIER-04**: Grok Build has a production tier by the same standard as HTIER-02, or a named blocker — taken into Phase 50 (the GAP-48-03 harness fix, then the live rerun)
  Status: Open at v8.0 start, not met (carried from v7.0). Taken into Phase 50 and closes only on that phase's outcome.
- [ ] **CBIND-01**: A dated concurrent-binding design record states the binding semantics (what binds, what conflicts, what waits), the identity of a binding and the failure modes, each with the HITL owner decision that settled it — taken into Phase 53 (owner-approved scope, design only, no code)
  Status: Planned (2026-11-19). Owner-approved (HITL) scope; taken into Phase 53 and closes only on that phase's frozen, owner-approved design.
- [ ] **CBIND-02**: The concurrent-binding design names the code surfaces it would touch and the contract changes it would need, with a migration note where an existing contract changes and no compatibility shims left in the design — taken into Phase 53 (owner-approved scope, design only, no code)
  Status: Planned (2026-11-19). Owner-approved (HITL) scope; taken into Phase 53 and closes only on that phase's frozen, owner-approved design.
- [ ] **SNAP-01**: A dated snapshots design record states the snapshot contents, the durability guarantee (what survives a daemon restart and a crash) and the restore semantics (byte-for-byte return to prior content), each with the HITL owner decision that settled it — taken into Phase 54 (owner-approved scope, design only, no code; built on the RES-04 checkpoint mechanism)
  Status: Planned (2026-11-19). Owner-approved (HITL) scope; taken into Phase 54 and closes only on that phase's frozen, owner-approved design.
- [ ] **SNAP-02**: The snapshots design states how it composes with RES-04 checkpoint create/restore, the scratch volume and the no-orphan guarantee, and the code surfaces and contract changes it would need, with no compatibility shims left in the design — taken into Phase 54 (owner-approved scope, design only, no code)
  Status: Planned (2026-11-19). Owner-approved (HITL) scope; taken into Phase 54 and closes only on that phase's frozen, owner-approved design.

## Carried from v2.0 (not in this milestone)

- [ ] **FS-02**: Path resolution is race-resistant: components are opened relative to a pinned root descriptor with no-follow semantics, so a symlink swapped between check and open is rejected (Accepted limitation, Phase 27 disposition, 2026-11-17: the requirement text is unmet; owner-confirmed approximation of 2026-10-23)
- [x] **OMP-05**: When disconnected, the plugin reports it and applies the configured policy; it never silently falls back to unsandboxed file mutation
  Status: Complete (2026-10-30). Basis (owner decision D2): a scripted OpenAI-compatible provider drove Omp 18.12.6's own `write` tool through the Realm plugin. Advisory with the realm down showed the unavailable notice and wrote the file; fail-closed with the realm down blocked the write with `REALM_NOT_ACTIVE` and that error was in the provider's next request; an active realm let the write land. Not an LLM-driven run. Paths that do not load the plugin are outside this closure.
  Note: closed in this milestone by HARN-04 (owner decision D2).
- [x] **PRD-DRV-01**: The realm compute driver serves ComputeDriver gRPC on a Unix socket in a 0700 directory with mode 0600, implementing GetCapabilities, ValidateSandboxCreate, CreateSandbox, GetSandbox, ListSandboxes, DeleteSandbox, WatchSandboxes, and EnsureWorkspace. AuthenticateSandbox is not advertised and returns UNIMPLEMENTED, because the gateway does not call it on the built-in path, and DeleteWorkspace refuses, because the driver never creates or removes the pinned workspace root. This amendment follows from the owner decisions of 2026-10-26 and 2026-10-27 and awaits the owner's confirmation (Phase 9.4) (Complete: the owner confirmed the amendment on 2026-11-17, after the Phase 27 disposition recorded it as open; code and tests match it)
- [ ] **UI-01**: The Omp plugin starts on session launch and shows its realm state in the Omp UI status item without blocking the session (accepted limitation by owner decision, 2026-10-23: the status item appears at launch; a non-blocking check was not demonstrated, because get_state took about 6 s during the attach and the cause is not isolated; re-measured 2026-10-28: keystrokes echoed within 0.2 to 1.2 s through a 24 s cold attach on a loaded host, which bounds the stall but does not prove the loop is never blocked) (Accepted limitation, Phase 27 disposition, 2026-11-17; v5.0, Phase 36, 2026-11-18: the one Omp cold-attach run was on a loaded host and failed its thresholds, with about 11 s unanswered, so no pass is claimed; carried with finding F-3 into a v5.1 candidate phase, and the status stays the owner's call)

## Carried from v7.0 (open at close, 2026-11-19)

- [ ] **OMPR-01**: Carried, not met: a quiet-host measurement of the Omp cold attach (Phase 38 ended VOID, one valid run in six attempts; OI-11 `Carried (no quiet slot)`). Accepted by the owner on completing v6.0; taken into v7.0 (Phase 45: OMPV-01 to OMPV-06, a repeat under a design that can yield a valid verdict on a shared host). Still carried after v7.0: Phase 45 VOID (calibration) twice; no valid verdict (see `v7.0-MILESTONE-AUDIT.md`).
- [ ] **OMPR-06**: Partial: the paired loaded A/B window ended VOID with three valid pairs of five (Phase 44); no effect claim for or against the change. Accepted by the owner on completing v6.0; taken into v7.0 together with OMPR-01 (OMPV-05, OMPV-06). Still carried after v7.0: Phase 45 paired comparison VOID (zero valid pairs).
  Also carried as findings and accepted limitations, not requirements: F-41-1 (taken into v7.0 as STOP-01 to STOP-04; still carried, never reproduced, cause not established), GAP-40-01 (HTIER-01; still accepted-residual, plus GAP-48-01/03), GAP-43-01 to GAP-43-03 (KIMV-01 to KIMV-04; GAP-43-01 now accepted-residual with manual workaround per OD-47-1, GAP-43-03 open narrowed, GAP-43-02 stays accepted-residual) and the ship-flow `--enforce` confirmation of DEBT-03 (owner-side configuration, not in v7.0) (see `.planning/milestones/v6.0-MILESTONE-AUDIT.md` and `.planning/v7.0-MILESTONE-AUDIT.md`).

## Standing requirements (completed earlier, still binding)

These requirements were completed in v1.0 and v2.0 and bind every phase of v3.0. The full v2.0 table is archived at `.planning/milestones/v2.0-REQUIREMENTS.md`. `AGENTS.md` cites QUAL-01 for the named silent-catch exceptions.

### Quality and documentation (QUAL)

- [x] **QUAL-01**: Every async boundary has a timeout; every error is typed with a machine-readable code and a human-readable reason; the silent-catch rule is amended as below
  Amended by decision: no silent catch blocks exist, except the named exceptions below. Each exception keeps the failure as recorded state or a retry, or fails closed, as stated.
  - (a) and (b): removed with `src/anda/client.ts` in Phase 28 (2026-11-17); the remaining exceptions keep their letters.
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
- FS-02 closure — accepted limitation, the owner's status call (Phase 27); the property tests of QR-07 add confidence only and do not change its status
- UI-01 — accepted limitation, the owner's status call (Phase 27)
- TD-06 (a smoke mode for `check:mcp` on a runner without Podman 5.x) — not part of the eight approved proposals
- TD-10 repository settings (secret scanning, push protection, branch protection or rulesets, `sha_pinning_required`) — the owner's, and they cannot be changed from the repository; only the release job split and the attestation are in this milestone (REL-01, REL-02)
- Any change to the product spec (`docs/specs/realm-spec.xml`) — read-only, except the owner-directed Anda edit of SPEC-01 (v5.0, 2026-11-18)

## Traceability

v3.0 requirements: 52 total, 52 mapped

v5.0 requirements: 14 total (COLD-01..04, ENF-01..04, EVID-01..03, V1LIVE-01..02, SPEC-01), 14 mapped to phases 33 to 37, all Complete (ENF-04 with a recorded partial). Audit: `.planning/milestones/v5.0-MILESTONE-AUDIT.md`

v6.0 requirements: 19 total (OMPR-01..06, EXEC-01..03, HOSTID-01..03, TEAR-01..02, DEBT-01..03, KIMI-01..02), 19 mapped to phases 38 to 44. 17 ticked Complete (OMPR-02 not triggered; OMPR-03 as VOID; OMPR-05 on its hermetic basis; HOSTID-02 met at the daemon and the validator tier only; DEBT-03 with a recorded partial), OMPR-01 left open as Carried and OMPR-06 left open as Partial, both accepted by the owner on completing v6.0. Audit: `.planning/milestones/v6.0-MILESTONE-AUDIT.md`

v7.0 requirements: 19 total (OMPV-01..06, STOP-01..04, KIMV-01..04, HTIER-01..05), 19 mapped to phases 45 to 48. 11 ticked Complete; 8 not met and carried (OMPV-04; STOP-01 to STOP-04; KIMV-02; HTIER-01 and HTIER-04). Audit: `.planning/v7.0-MILESTONE-AUDIT.md`

v8.0 requirements: 12 total (OMPV-04; STOP-01..04; KIMV-02; HTIER-01, HTIER-04; CBIND-01..02; SNAP-01..02), 12 mapped to phases 49 to 54, all Planned. The eight retested IDs keep their v7.0 text and close only through Phases 49 to 52 (OMPR-01, OMPR-06 and OI-11 close only through Phase 49); CBIND and SNAP are owner-approved (HITL) design scope, Phases 53 and 54. Context: `.planning/MILESTONE-CONTEXT.md`

Each v3.0 requirement maps to exactly one phase. The carried requirements keep their v2.0 phase and status.

| Requirement | Phase | Status |
|-------------|-------|--------|
| HARN-01 | Phase 12 | Complete 2026-11-14: live Omp 18.20.0 guard run, 7 of 8 pass, scripted provider over rpc-ui, no creds (12-VERIFICATION truth 1); fake-backed, not production proof. |
| HARN-02 | Phase 12 | Complete with accepted limitation: C1, C1b, C2, C3, C4, C4b pass live on Omp 18.20.0 (12-VERIFICATION, 2026-11-14); semantics superseded by Phase 16 (disconnected advisory write refuses). |
| HARN-03 | Phase 12 | Complete with accepted limitation: warm pass 0 external/0 DNS on Omp 18.20.0 under owner ruling 2026-11-14 allowing port 9931 (4 discovery ports); cold profile skipped with stated reason. |
| HARN-04 | Phase 12 | Complete 2026-11-14: OMP-05 row reads Complete with scripted-write, not-LLM-driven basis (REQUIREMENTS OMP-05; 12-VERIFICATION truth 11), re-grounded on current live guard run. |
| OMPX-01 | Phase 12 | Complete 2026-11-14: spike answers recorded with Omp 18.12.6 in docs/integration/omp.md (12-VERIFICATION truth 10); versioned finding, not a containment claim. |
| QR-01 | Phase 13 | Complete 2026-11-15: ci.yml audit job runs npm audit --omit=dev --audit-level=high; Dependency audit job succeeded in CI run 43393671617 (13-VERIFICATION). |
| QR-02 | Phase 13 | Complete with accepted limitation: dependabot.yml covers github-actions and npm for root and site/ (13-VERIFICATION 2026-11-15); live repo Dependabot settings unverified, owner accepted (TD-10). |
| QR-03 | Phase 13 | Complete with accepted limitation: pack-smoke and release rerun verified 2026-11-15 (13-VERIFICATION); repair path not run live, covered offline, owner accepted 2026-11-17 (20-VERIFICATION G1). |
| QR-04 | Phase 13 | Complete 2026-11-15: test:coverage plus CI floors for src/fs, src/core, src/tools on Node 22.x; red run exit 1 below floor, run 43393671617 (13-VERIFICATION). |
| QR-05 | Phase 13 | Complete 2026-11-15: fake clock and scaled-timeout helper verified; one-CPU container run passed at 1ddfc45 (13-VERIFICATION); not repeated at a796b34; one skip lacks a stated reason. |
| QR-06 | Phase 13 | Complete 2026-11-15: export-usage gate wired in check:gates and CI, dead exports removed (13-VERIFICATION); check:gates exit 0 on 9710346 per 20-VERIFICATION 2026-11-17. |
| QR-07 | Phase 13 | Complete with accepted limitation: fast-check pinned, canonicalizer and policy properties in npm test (13-VERIFICATION 2026-11-15); PR-body justifications not inspectable, owner accepted; break check historical. |
| QR-08 | Phase 13 | Complete 2026-11-15: mutation.yml weekly cron plus dispatch, continue-on-error, contents read only, scope src/fs, policy.ts, redact.ts; Mutation run 43387372658 succeeded (13-VERIFICATION). |
| CRASH-01 | Phase 14 | Complete 2026-11-14: 14-VERIFICATION criterion 1: exact-pattern, age-bounded, no-follow sweep with audit before unlink, wired at startup; temp-sweep and daemon tests. Cross-device case skips off CI. |
| CRASH-02 | Phase 14 | Complete 2026-11-14: 14-VERIFICATION criterion 2: reconciliation line (AUDIT_OUTCOME_UNKNOWN, phase reconciliation), idempotent on 2nd start; planted-admission test, crash simulated not killed; chain covered by P17. |
| CRASH-03 | Phase 14 | Complete 2026-11-14: 14-VERIFICATION criterion 3: SessionStore.delete calls syncDirectory after unlink; store tests cover fsync order and WRITE_NOT_ATOMIC on fsync failure. |
| CRASH-04 | Phase 14 | Complete 2026-11-16: live scenario 11 asserts startup log recordsDeleted and removed ids plus status notice (19-VERIFICATION, 14-VERIFICATION); the old unasserted-count gap is closed. |
| CRASH-05 | Phase 14 | Complete 2026-11-14: 14-VERIFICATION criterion 1: atomic-write-sigkill test, real child SIGKILL at all four stages; original intact, one orphan, sweep removes it, no-kill control. |
| CRASH-06 | Phase 14 | Complete 2026-11-14: 14-VERIFICATION criterion 4: daemon-equivalence test shows same causeCode over MCP and ACP, in process and via daemon; no-cause case carries none. |
| CRASH-07 | Phase 14 | Complete 2026-11-14: 14-VERIFICATION criterion 5: stale-container retry reaches active with a new container (test tagged TD-04, not CRASH-07; behaviour matches). |
| ONB-01 | Phase 15 | Complete 2026-11-14: 15-VERIFICATION criterion 1: init templates, 0700 state dir, no overwrite, digest via --image only (release/ lookup not needed); README live transcript on Podman 5.7.1 at 1ddfc45. |
| ONB-02 | Phase 15 | Complete 2026-11-14: 15-VERIFICATION criterion 2: doctor --fix sets 0755 to 0700, dry run and 2nd run no-op, symlinks refused; fix.test.ts and cli tests. |
| ONB-03 | Phase 15 | Complete 2026-11-14: 15-VERIFICATION criterion 3: roots in config.json defaulting under stateDir, REALM_DRIVER root vars removed, driver and daemon share runtimeRootsOf; config and daemon tests. |
| ONB-04 | Phase 15 | Complete 2026-11-14: 15-VERIFICATION criterion 2: doctor runtime-roots, driver-socket and gateway checks name check and fix; unit test per check in runtime-root-checks and checks tests. |
| ONB-05 | Phase 15 | Complete with accepted limitation: omp plugin install recorded in omp.md and README steps 2026-11-13 (local-link, isolated profile, omp 18.20.0, 1ddfc45); owner-accepted; not re-run after later commits. |
| ONB-06 | Phase 15 | Complete with accepted limitation: README transcript of init, up, status, down captured 2026-11-13 on Podman 5.7.1 (Realm 0.3.29, 1ddfc45); 15-VERIFICATION notes later main commits not re-run live. |
| ONB-07 | Phase 15 | Complete 2026-11-14: 15-VERIFICATION criterion 3: daemonSpawnEnv allowlist on CLI spawn and startDetachedDaemon; spawn-env.test.ts sentinel never reaches a real daemon. |
| DEF-01 | Phase 15 | Complete 2026-11-14: 15-VERIFICATION criterion 4: schema default fail-closed, loader applies it with provenance, advisory needs explicit value; doctor tests cover it. |
| DEF-02 | Phase 15 | Complete 2026-11-14: 15-VERIFICATION criterion 4: policy reference, README, omp notes, doctor, init templates and spec state fail-closed; default-mode.mjs guard; no unannotated advisory default. |
| OMPX-02 | Phase 16 | Complete 2026-11-15: five tools registered with frozen ToolCall, retry stays command, no glob (16-VERIFICATION.md, code and tests read at 191293b; suites not re-run by verifier) |
| OMPX-03 | Phase 16 | Complete with accepted limitation: removal plus POLICY_DENIED bash guard verified 2026-11-15 (16-VERIFICATION.md); fail-closed is a guard not containment per D3, stated in status text; no live bash run |
| OMPX-04 | Phase 16 | Complete 2026-11-15: advisory keeps non-shadowed built-ins, native notice, same-name read/write shadowing recorded in omp.md (16-VERIFICATION.md, static; transition tests not re-run) |
| OMPX-05 | Phase 16 | Complete 2026-11-15: live production run 1/1 pass (host file, sandbox bytes, paired audit lines; 16-03-SUMMARY.md, 16-VERIFICATION.md); frames/request sidecars missing (EACCES), single run |
| OBS-01 | Phase 17 | Complete 2026-11-15: seq/prev chain, audit verify, head recovery (17-VERIFICATION.md, static plus scenario 5 live audit verify, 37/37 on a796b34 per openshell.md) |
| OBS-02 | Phase 17 | Complete 2026-11-15: JSON logger, correlation id on log and admission/result audit lines, no new dependency (17-VERIFICATION.md; scenario 6 live check recorded in openshell.md) |
| OBS-03 | Phase 17 | Complete 2026-11-15: metrics over control socket only, no network listener (17-VERIFICATION.md code read; live metrics and no-listener check in scenarios 6 and 10, openshell.md) |
| OBS-04 | Phase 17 | Complete 2026-11-15: OPENSHELL_GATEWAY_LOST in catalogue, spec and docs; live status shows it not AGENTOS_CRASH_LOOP (17-VERIFICATION.md); driver loss is retry-only per owner contract |
| MULTI-01 | Phase 18 | Complete 2026-11-15: runtime-decision.md section Per-project sessions precedes the code (commit order checked in 18-VERIFICATION.md) |
| MULTI-02 | Phase 18 | Complete 2026-11-15: workspace-derived session id, per-session sandbox, POLICY_DENIED outside roots; test and live scenario ok 11 at 4ad91be (18-VERIFICATION.md) |
| MULTI-03 | Phase 18 | Complete 2026-11-15: per-session record, audit, locks, snapshot; down of one leaves other active (live ok 11 step 6; locks and snapshot by code and unit tests, 18-VERIFICATION.md) |
| MULTI-04 | Phase 18 | Complete 2026-11-15: driver binds a workspace per sandbox from the registry entry; gateway carries sandbox name only (engineering decision C3, not owner-ratified; 18-VERIFICATION.md) |
| MULTI-05 | Phase 18 | Complete 2026-11-15: two-project live scenario ok 11 passed, suite 37/37 at 4ad91be (18-VERIFICATION.md, TAP file read there); per-session pin unit tests exist; run not re-executed |
| MULTI-06 | Phase 18 | Complete with accepted limitation: owner set 4 GiB/4e9 nanoCpus/2 sessions (D18-2, 2026-11-02) in the hardening profile, not user config; no new catalogue code (18-VERIFICATION.md) |
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
| WAVE2-01 | Phase 25 | Complete |
| WAVE2-02 | Phase 25 | Complete |
| WAVE2-03 | Phase 25 | Complete |
| WAVE2-04 | Phase 25 | Complete |
| WAVE2-05 | Phase 25 | Complete |
| WAVE2-06 | Phase 25 | Complete |
| WAVE2-07 | Phase 25 | Complete |
| WAVE2-08 | Phase 25 | Complete |
| TEST-HOST-01 | Phase 26 | Complete |
| TEST-HOST-02 | Phase 26 | Complete |
| TEST-HOST-03 | Phase 26 | Complete |
| TEST-HOST-04 | Phase 26 | Complete |
| TEST-HOST-05 | Phase 26 | Complete |
| TEST-HOST-06 | Phase 26 | Complete |
| TEST-HOST-07 | Phase 26 | Complete |
| TEST-HOST-08 | Phase 26 | Complete |
| ANDAX-01 | Phase 27 | Complete |
| ANDAX-02 | Phase 27 | Complete |
| ANDAX-03 | Phase 28 | Complete |
| ANDAX-04 | Phase 28 | Complete |
| ANDAX-05 | Phase 28 | Complete |
| MCPA-01 | Phase 29 | Complete |
| MCPA-02 | Phase 29 | Complete |
| CAPT-01 | Phase 30 | Complete (spike recorded; criteria outcome DROP, owner override BUILD in Phase 32) |
| CAPT-02 | Phase 32 | Complete |
| CAPT-03 | Phase 32 | Complete |
| CAPT-04 | Phase 32 | Complete |
| CAPT-05 | Phase 32 | Complete |
| CAPT-06 | Phase 32 | Complete |
| CAPT-07 | Phase 32 | Complete |
| CAPT-08 | Phase 32 | Complete |
| CAPT-09 | Phase 32 | Complete |
| BOOTP-01 | Phase 31 | Complete |
| BOOTP-02 | Phase 31 | Complete |
| COLD-01 | Phase 33 | Complete |
| COLD-02 | Phase 33 | Complete |
| COLD-03 | Phase 33 | Complete |
| COLD-04 | Phase 33 | Complete |
| ENF-01 | Phase 34 | Complete |
| ENF-02 | Phase 34 | Complete |
| ENF-03 | Phase 34 | Complete |
| ENF-04 | Phase 34 | Complete (partial: PR 168 squash title lacks the ! marker; the flip commit with ! is in the changelog) |
| EVID-01 | Phase 35 | Complete |
| EVID-02 | Phase 35 | Complete |
| EVID-03 | Phase 35 | Complete |
| V1LIVE-01 | Phase 36 | Complete |
| V1LIVE-02 | Phase 36 | Complete |
| SPEC-01 | Phase 37 | Complete |
| OMPR-01 | Phase 38 | Carried (not met): one valid quiet-host run in six attempts, outcome VOID; OI-11 stays Carried (no quiet slot); accepted by the owner on completing v6.0; taken into v7.0, Phase 45 (OMPV-05, OMPV-06) |
| OMPR-02 | Phase 38 | Complete (not triggered: the frozen rule gave VOID; plans 38-02 and 38-03 superseded by Phase 44) |
| OMPR-03 | Phase 38 | Complete (as VOID: numbers and host facts recorded, OI-11 reads Carried) |
| OMPR-04 | Phase 44 | Complete |
| OMPR-05 | Phase 44 | Complete (hermetic basis; no responsiveness effect shown) |
| OMPR-06 | Phase 44 | Partial: paired loaded window VOID, three valid pairs of five, no effect claim; accepted by the owner on completing v6.0; taken into v7.0, Phase 45 (OMPV-05, OMPV-06) |
| EXEC-01 | Phase 39 | Complete |
| EXEC-02 | Phase 39 | Complete |
| EXEC-03 | Phase 39 | Complete |
| HOSTID-01 | Phase 40 | Complete |
| HOSTID-02 | Phase 40 | Complete (met at the daemon and the validator tier; partial for a host-driven tool call: no production tier, no model-driven call; GAP-40-01 accepted) |
| HOSTID-03 | Phase 40 | Complete |
| TEAR-01 | Phase 41 | Complete |
| TEAR-02 | Phase 41 | Complete |
| DEBT-01 | Phase 42 | Complete |
| DEBT-02 | Phase 42 | Complete |
| DEBT-03 | Phase 42 | Complete (partial: the ship-flow --enforce run is owner-side configuration, unconfirmed) |
| KIMI-01 | Phase 43 | Complete |
| KIMI-02 | Phase 43 | Complete |
| OMPV-01 | Phase 45 | Planned |
| OMPV-02 | Phase 45 | Planned |
| OMPV-03 | Phase 45 | Planned |
| OMPV-04 | Phase 45 | Planned |
| OMPV-05 | Phase 45 | Planned |
| OMPV-06 | Phase 45 | Planned |
| STOP-01 | Phase 46 | Planned |
| STOP-02 | Phase 46 | Planned |
| STOP-03 | Phase 46 | Planned |
| STOP-04 | Phase 46 | Planned |
| KIMV-01 | Phase 47 | Planned |
| KIMV-02 | Phase 47 | Planned |
| KIMV-03 | Phase 47 | Planned |
| KIMV-04 | Phase 47 | Planned |
| HTIER-01 | Phase 48 | Planned |
| HTIER-02 | Phase 48 | Planned |
| HTIER-03 | Phase 48 | Planned |
| HTIER-04 | Phase 48 | Planned |
| HTIER-05 | Phase 48 | Planned |
| FS-02 | Phase 2 | Accepted limitation (Phase 27 disposition, 2026-11-17): accepted approximation, confirmed by the owner 2026-10-23; rebind verified through the pinned root; check-to-use windows remain on the read and write paths; audit G-10 |
| ANDA-01 | Phase 3 | Dropped (owner decision D-27-01, 2026-11-17): the Anda bridge is removed in Phase 28 |
| ANDA-02 | Phase 3 | Dropped (owner decision D-27-01, 2026-11-17): the Anda bridge is removed in Phase 28 |
| ANDA-03 | Phase 3 | Dropped (owner decision D-27-01, 2026-11-17): the Anda bridge is removed in Phase 28 |
| ANDA-04 | Phase 3 | Dropped (owner decision D-27-01, 2026-11-17): the Anda bridge is removed in Phase 28 |
| OMP-05 | Phase 5 | Complete (2026-10-30, HARN-04, owner decision D2): scripted provider drove Omp 18.12.6's own write through the Realm plugin; not LLM-driven |
| PRD-DRV-01 | Phase 9.4 | Complete (owner confirmed the amendment 2026-11-17; code and tests verified, 27-DISPOSITIONS.md Part B); socket 0700/0600 verified live and in tests, AuthenticateSandbox UNIMPLEMENTED and not advertised, DeleteWorkspace refuses; the amendment follows from the owner decisions of 2026-10-26 and 2026-10-27 |
| UI-01 | Phase 9 | Accepted limitation (owner decision 2026-10-23): status item at launch; re-measured 2026-10-28: keystrokes echoed within 0.2 to 1.2 s through a 24 s cold attach on a loaded host, which bounds the stall but does not prove non-blocking; the status stays the owner's call |
| QUAL-01 | Phase 1 | Complete (amended 2026-10-22); standing, binds every v3.0 phase |
| QUAL-02 | Phase 2 | Complete; standing |
| QUAL-03 | Phase 7 | Complete; standing |

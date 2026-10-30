# Requirements: Realm

**Defined:** 2026-10-29
**Core Value:** Every file mutation by an agent either lands inside the realm under policy or fails closed, and the user can always see whether the realm is active or disconnected.
**Source:** `.planning/quick/261029-g7m-lifecycle-and-persistence-findings/IMPROVEMENT-PROPOSALS.md` (the "Proposed change" of proposals 1 to 8 is the scope; each "Success measure" is the acceptance test) under the owner decisions D1 to D6 of 2026-10-29 in `.planning/MILESTONE-CONTEXT.md`. Research was skipped; the proposals and the findings documents beside them are the requirement basis.

All v3.0 requirements are hypotheses until shipped and verified.

**Milestone v2.0 closed 2026-10-29.** The full v2.0 table is archived at `.planning/milestones/v2.0-REQUIREMENTS.md`. The requirements it left open (FS-02, ANDA-01 to ANDA-04, OMP-05, PRD-DRV-01) and the accepted limitation UI-01 are listed under "Carried from v2.0" below. OMP-05 is closed in this milestone by HARN-04; the others are not in this milestone.

## v3.0 Requirements

### Omp live harness (HARN)

- [ ] **HARN-01**: A gated test harness starts an isolated Omp profile whose model provider is a local OpenAI-compatible stub returning a scripted sequence (one `write` tool call, then a final message), loads the built extension with `-e`, and drives Omp over RPC pipes (`--mode rpc-ui`), with no pseudo-terminal, no credentials and no tokens
- [x] **HARN-02**: The harness runs three cases: advisory mode with the realm down (the notice is shown and the file exists), fail-closed mode with the realm down (the call is blocked with `REALM_NOT_ACTIVE` and the file does not exist), and the realm active (the call proceeds; this is the baseline that Phase 16 changes)
- [ ] **HARN-03**: One command runs the harness against a built extension and a local Omp and passes; it records the Omp version and makes no connection to any host except the loopback stub (and Omp's three loopback discovery probes, D-1205). On a warmed profile, no connection outside the loopback stub is permitted; a cold profile is reported as skipped, its model-catalog refresh being the recorded reason. The command is gated like the production live suite, skipping with a stated reason when Omp, Podman or the gate variable is absent
- [x] **HARN-04**: OMP-05 is recorded complete in the traceability table on the harness evidence, and the recorded basis states that the run is scripted through Omp's own `write` tool and is not LLM-driven (owner decision D2)

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
- [ ] **CRASH-05**: Real-SIGKILL tests: a child process writes through `atomicWriteFile` and kills itself from the stage hook at each of the four stages (`after-temp-write`, `after-fsync`, `before-rename`, `after-recheck`); for each stage the parent asserts the original is intact, names the orphan temp file, and asserts the next sweep removes it
- [ ] **CRASH-06**: TD-01: the refusal cause code is carried across the daemon for MCP and ACP, with a daemon-path equivalence test beside `test/surfaces/equivalence.test.ts` showing the same cause code over MCP and ACP as in process
- [ ] **CRASH-07**: TD-04: when the recorded container is gone, a retry from the error state creates a new container instead of failing with `OPENSHELL_START_FAILED`; a controller test with a removed container reaches `active` on retry

### Zero-config onboarding (ONB)

- [ ] **ONB-01**: `realm init` writes `config.json` and `policy.json` templates, creates the state directory with mode 0700, refuses to overwrite an existing file, and takes the image digest as an argument or from `release/` (it never invents one); on a clean host with Podman 5.x, `realm init` then `realm up` reaches active with no manual file edit
- [ ] **ONB-02**: `realm doctor --fix` applies only the safe subset (create missing directories, set the state directory to 0700), supports a dry-run mode, refuses symlinked directories, is idempotent and reports what it changed; everything else stays prose; run on a state directory with mode 0755 it changes it to 0700, and a second run changes nothing
- [ ] **ONB-03**: The three `REALM_DRIVER_*` roots (secret, workspace and state) move into `config.json` with a default derived under `stateDir`; the environment variables are removed (clean cutover, no shim); the driver and the daemon read the same source
- [ ] **ONB-04**: `realm doctor` checks that the three roots are set, absolute and mode-correct, that the driver socket is present with mode 0600 in a 0700 directory, and that the gateway is reachable (TD-03); a failure names the check and the fix, and a unit test covers each check
- [ ] **ONB-05**: `omp plugin install` is verified live under an isolated profile, the result is recorded in `docs/hosts/snippets/omp.md`, and `README.md` carries the install steps
- [ ] **ONB-06**: `README.md` carries a quickstart with a transcript, captured on a real Podman 5.x host, of `init`, `up`, `status` and `down`
- [ ] **ONB-07**: The daemon starts with an allowlisted environment (`PATH`, `HOME`, `XDG_RUNTIME_DIR`, `XDG_CONFIG_HOME` and what the roots need) in both `startDetachedDaemon` and the CLI's spawn; a test shows that a sentinel variable does not reach the daemon

### Containment default (DEF)

- [ ] **DEF-01**: A policy with no `mode` loads as fail-closed; the schema default and the loader agree; advisory requires the explicit value (owner decision D4)
- [ ] **DEF-02**: The policy reference, the README, the Omp notes, the doctor output and the `init` templates state the fail-closed default, and every test that relied on the old advisory default either states its mode explicitly or asserts the new default; no document still calls advisory the default

### Omp in the sandbox (OMPX)

- [ ] **OMPX-01**: A spike on a live Omp determines whether `registerTool` tools reach the model, whether `setActiveTools` removes `write`, `edit` and `bash` from the callable set and is enforced at execution, and whether `registerFileWriteFallback` can redirect a write; the finding is recorded with the Omp version in `docs/integration/omp.md` and closes OQ-P5-01 and OQ-P5-02
- [ ] **OMPX-02**: The extension registers `exec`, `read`, `write`, `list` and `status` as Omp tools; each calls the daemon client with the frozen `ToolCall` shape, so validation, locking, audit and the state gate stay in the shared dispatcher (`retry` stays the existing `realm-retry` command; no `glob` tool is added)
- [ ] **OMPX-03**: In fail-closed mode the built-in `write`, `edit` and `bash` are removed or blocked by the mechanism the OMPX-01 spike proves, the existing `tool_call` guard stays as a backstop, and a model-issued `bash` call is refused with a catalogue code; if the API cannot enforce removal, the status text and the docs say that fail-closed is a guard and not containment (owner decision D3)
- [ ] **OMPX-04**: In advisory mode the Realm tools are registered and the built-in tools stay available, with the existing notice
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

- [ ] **RES-01**: The reaper decision (re-adopt what passes the hardening verifier, remove what cannot be proven good, keep the no-orphan guarantee in a precise form) and the amendment of the RT-01 mount list for the scratch volume are recorded in `docs/integration/runtime-decision.md` before the code that needs them
- [ ] **RES-02**: At startup a session record whose container is still running and passes the create-time hardening verifier is adopted, and a container that fails the verifier or has no record is removed; both outcomes are logged
- [ ] **RES-03**: A persistent scratch volume is mounted beyond `/workspace`, owned by the session, survives a daemon restart, and is removed by `realm down`
- [ ] **RES-04**: Workspace snapshot and restore commands exist, with the mechanism (copy, reflink or filesystem snapshot) chosen after a spike; restore returns a modified workspace to its prior content byte for byte
- [ ] **RES-05**: Live scenarios show: the daemon is killed and restarted and the same container id is active with `/workspace` intact and no second container; a container that fails the verifier is removed; a scratch-volume file survives a daemon restart and is gone after `realm down`; a snapshot then restore round-trips

### Release hardening (REL)

- [ ] **REL-01**: The release job is split into an unprivileged build job and a privileged publish job (owner decision D6)
- [ ] **REL-02**: A release carries a build provenance attestation that `gh attestation verify` accepts
- [ ] **REL-03**: A manual rollback workflow marks a release a prerelease and re-points the documentation; a test release is marked a prerelease by it
- [ ] **REL-04**: TD-08: the changelog generator filters commits of features that were later removed

## Carried from v2.0 (not in this milestone)

- [ ] **FS-02**: Path resolution is race-resistant: components are opened relative to a pinned root descriptor with no-follow semantics, so a symlink swapped between check and open is rejected
- [ ] **ANDA-01**: TypeScript client connects to Anda Engine components over the boundary confirmed by the Anda documentation, and the chosen boundary and its rationale are recorded in `docs/integration/anda-decision.md`
- [ ] **ANDA-02**: Connection performs a version handshake; a version mismatch fails with `ANDA_VERSION_MISMATCH`
- [ ] **ANDA-03**: Reconnection uses bounded exponential backoff with jitter; an unreachable bridge reports `ANDA_UNREACHABLE`, moves the state to degraded, and retries in the background
- [ ] **ANDA-04**: A Rust shim is added only if the documentation spike shows no TypeScript-reachable surface; if added, it is minimal, lives in `src/anda/native/`, has its own build, and is covered by contract tests from the TypeScript side
- [x] **OMP-05**: When disconnected, the plugin reports it and applies the configured policy; it never silently falls back to unsandboxed file mutation
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
| HARN-01 | Phase 12 | Pending |
| HARN-02 | Phase 12 | Complete (2026-10-30): the three cases passed live on Omp 18.12.6, 3 of 3, 0 skipped |
| HARN-03 | Phase 12 | Pending |
| HARN-04 | Phase 12 | Complete (2026-10-30): OMP-05 recorded complete with the scripted-write basis |
| OMPX-01 | Phase 12 | Pending |
| QR-01 | Phase 13 | Pending |
| QR-02 | Phase 13 | Pending |
| QR-03 | Phase 13 | Pending |
| QR-04 | Phase 13 | Pending |
| QR-05 | Phase 13 | Pending |
| QR-06 | Phase 13 | Pending |
| QR-07 | Phase 13 | Pending |
| QR-08 | Phase 13 | Pending |
| CRASH-01 | Phase 14 | Pending |
| CRASH-02 | Phase 14 | Pending |
| CRASH-03 | Phase 14 | Pending |
| CRASH-04 | Phase 14 | Pending |
| CRASH-05 | Phase 14 | Pending |
| CRASH-06 | Phase 14 | Pending |
| CRASH-07 | Phase 14 | Pending |
| ONB-01 | Phase 15 | Pending |
| ONB-02 | Phase 15 | Pending |
| ONB-03 | Phase 15 | Pending |
| ONB-04 | Phase 15 | Pending |
| ONB-05 | Phase 15 | Pending |
| ONB-06 | Phase 15 | Pending |
| ONB-07 | Phase 15 | Pending |
| DEF-01 | Phase 15 | Pending |
| DEF-02 | Phase 15 | Pending |
| OMPX-02 | Phase 16 | Pending |
| OMPX-03 | Phase 16 | Pending |
| OMPX-04 | Phase 16 | Pending |
| OMPX-05 | Phase 16 | Pending |
| OBS-01 | Phase 17 | Pending |
| OBS-02 | Phase 17 | Pending |
| OBS-03 | Phase 17 | Pending |
| OBS-04 | Phase 17 | Pending |
| MULTI-01 | Phase 18 | Pending |
| MULTI-02 | Phase 18 | Pending |
| MULTI-03 | Phase 18 | Pending |
| MULTI-04 | Phase 18 | Pending |
| MULTI-05 | Phase 18 | Pending |
| MULTI-06 | Phase 18 | Pending |
| RES-01 | Phase 19 | Pending |
| RES-02 | Phase 19 | Pending |
| RES-03 | Phase 19 | Pending |
| RES-04 | Phase 19 | Pending |
| RES-05 | Phase 19 | Pending |
| REL-01 | Phase 20 | Pending |
| REL-02 | Phase 20 | Pending |
| REL-03 | Phase 20 | Pending |
| REL-04 | Phase 20 | Pending |
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

# Improvement and feature proposals

Scope: Realm at main 00e0003 (release v0.2.2). This document proposes eight changes for the owner to select from. None is implemented. `.planning/ROADMAP.md` is not touched, and no requirement status is changed here.

Evidence labels: VERIFIED_BY_CODE_READING (the cited lines were read), VERIFIED_BY_EXECUTION (a recorded live run, cited), UNVERIFIED (what would verify it is stated). Every path is repo-relative. "The realm account" is the host account that runs the daemon.

Ordering rationale: ranked by impact relative to effort. Proposal 1 is first because it closes the only path on which the sandbox is bypassed by design in the Omp host; the small hardening and onboarding items follow, and the proposals that need new runtime decisions or large new subsystems come after them.

Corrections made while verifying the brief (all other claims held):

- Realm has no `glob` tool. The frozen tool schema lists `exec`, `read`, `write`, `list`, `status` and `retry` (`src/contract/tools.schema.json:10-15`, VERIFIED_BY_CODE_READING; the product spec also says six tools, `docs/specs/realm-spec.xml:320`). A glob function exists in `src/fs/glob.ts` but is not a tool. Proposal 1 therefore registers the five non-retry tools and keeps `retry` as the existing `realm-retry` command (`src/omp/plugin.ts:119`, `:346`). Adding a `glob` tool would change a frozen contract (`.planning/REQUIREMENTS.md:16`, FOUND-02) and is outside this proposal.
- The brief's wording "audit admission lines that have no result line" holds, but the audit outcome type is `"ok" | ErrorCode` (`src/audit/log.ts:18`). A reconciliation line therefore needs an existing catalogue code or a catalogue change. Proposal 4 states this.

## Summary

| Rank | Title | Type | Effort | Placement |
|---|---|---|---|---|
| 1 | Make Omp use the sandbox | feature | L | Next milestone, spike first |
| 2 | Zero-config onboarding | improvement | M | Next milestone |
| 3 | Per-project sandboxes | feature | L | Backlog until a runtime decision is recorded |
| 4 | Crash-safety pack | improvement | M | Next milestone |
| 5 | Resume and checkpoint | feature | L | Backlog until the reaper decision is made |
| 6 | Scripted-provider end-to-end harness | improvement | S to M | Next milestone |
| 7 | Observability and tamper-evident audit | feature | L | Backlog, audit chain first |
| 8 | Quality and supply-chain ratchet | improvement | L (split into S and M parts) | Next milestone for the S parts, backlog for the rest |

---

## 1. Make Omp use the sandbox

**Title:** Make Omp use the sandbox: register Realm's tools in Omp and, in fail-closed mode, route or disable Omp's built-in `write`, `edit` and `bash`.

**Type:** feature.

**Evidence and problem:**

- The plugin registers only three event handlers and one command: `session_start` (`src/omp/plugin.ts:318`), `session_shutdown` (`:340`), `tool_call` (`:344`) and `realm-retry` (`:346`). It registers no tool and calls no `setActiveTools`; the only mention is a comment (`src/omp/plugin.ts:18-20`). VERIFIED_BY_CODE_READING.
- The guard inspects only `write` and `edit` (`src/omp/plugin.ts:123`). When the realm state is `active` it returns undefined, which allows the call (`:444-446`), so Omp's own tool then writes to the host filesystem itself. VERIFIED_BY_CODE_READING.
- `bash` and every other Omp tool are outside the guard (`docs/integration/omp.md:209`; `README.md:15`: "the Omp guard warns and allows host write and edit calls"). VERIFIED_BY_CODE_READING.
- Advisory mode, the default, allows the call when the state is not active or the status is unreadable (`src/omp/plugin.ts:433`, `:448`). Fail-closed mode blocks with `REALM_UNBOUND`, `REALM_STOPPING` or `REALM_NOT_ACTIVE` (`:454-465`), or with the error code when the status is unreadable (`:436`). VERIFIED_BY_CODE_READING.
- Net effect: with the realm active, an Omp session still performs its edits and shell commands on the host. The sandbox is live and attached (`docs/integration/omp.md:187-198`, VERIFIED_BY_EXECUTION on 2026-10-28 and again on 2026-10-29), but Omp does not use it: with the extension loaded, the tool list that Omp sent to the model was `read, bash, edit, ask, eval, glob, grep, task, wait, todo, web_search, write`, with no Realm tool (`LIVE-VERIFICATION.md` L2, VERIFIED_BY_EXECUTION).
- The extension API names `registerTool`, `getActiveTools`, `getAllTools`, `setActiveTools` and `registerFileWriteFallback` (`docs/integration/omp.md:52`). VERIFIED_BY_CODE_READING of the note; the API itself is UNVERIFIED here.
- The same note says it is not documented whether `setActiveTools` removal is enforced at execution, and that a `tool_call` block is not a verified control on every path (`docs/integration/omp.md:84-90`). It also records that eval-prelude bridge calls emit no `tool_call` (`docs/integration/omp.md:94`). VERIFIED_BY_CODE_READING of the note.
- The plugin already holds a daemon client that can dispatch a tool call: `DaemonClient.call(tool)` (`src/daemon/client.ts:30`, `:146`), and the MCP and ACP surfaces use the same dispatcher (`.planning/REQUIREMENTS.md`, TOOL-05). VERIFIED_BY_CODE_READING.

**Proposed change:**

1. Spike first: against a live Omp, determine whether `registerTool` can register tools that the model sees, whether `setActiveTools` removes `write`, `edit` and `bash` from the callable set and is enforced at execution, and whether `registerFileWriteFallback` can redirect a write. Record the result in `docs/integration/omp.md` (OQ-P5-01 and OQ-P5-02 stay open until then).
2. Register `exec`, `read`, `write`, `list` and `status` as Omp tools. Each calls `client.call` with the frozen `ToolCall` shape, so validation, locking, audit and the state gate stay in the shared dispatcher.
3. In fail-closed mode, remove or block Omp's built-in `write`, `edit` and `bash` (the mechanism the spike proves), and keep the existing `tool_call` guard as a backstop. Extend `GUARDED_HOST_TOOLS` only if the spike shows `bash` is blockable through `tool_call`.
4. In advisory mode, register the tools and leave the built-ins available, with the existing notice. The default behaviour does not change.

**Benefit:** A model working through Omp does its file mutations and commands in the sandbox, so the product's stated guarantee (`README.md:15`) holds on the host it is built for, not only for MCP and ACP clients. Writes through Realm's tools also get the atomic temp-and-rename and audit path (`src/fs/atomic-write.ts:177-203`, `src/tools/workspace.ts:10-15`). Omp's own `write` does not: under strace it opened the target with `O_WRONLY|O_CREAT`, wrote the whole content once, called `ftruncate` and `close`, with no temp file, no rename and no `fsync` (`LIVE-VERIFICATION.md` L6b, VERIFIED_BY_EXECUTION), so a kill mid-write can tear a shortening overwrite (INFERENCE from that order).

**Effort and risk:** L. Risks: the extension API may not enforce removal (then fail-closed stays a guard, not containment, and the docs must say so); the tool result shape Omp expects is UNVERIFIED; `exec` output size and the `tool_call` 30 000 ms budget (`docs/integration/omp.md:59`) bound long commands; a model may behave differently with different tool names. The change touches the Omp-facing surface that OMP-05 and UI-01 depend on.

**Dependencies:** Proposal 6 (a scripted provider is the way to test this without a paid model). Owner decision: whether fail-closed may disable built-in tools (a behaviour change for existing fail-closed users), and what the product claims if enforcement is only partial.

**Success measure:** On a live Omp with the realm active, a model-issued write through the registered tool lands in the sandbox's `/workspace` and appears in the host root (the same mapping scenario 1 proves, `test/integration/production-driver.test.ts`), the audit log holds an admission and a result line for it, and in fail-closed mode a model-issued `bash` call is refused with a catalogue code. The spike's finding on enforcement is recorded with the Omp version.

**Suggested placement:** next milestone, with the spike as its first task.

---

## 2. Zero-config onboarding

**Title:** Zero-config onboarding: `realm init`, `realm doctor --fix`, the three driver roots in `config.json`, a verified Omp plugin install path, a README quickstart with a captured transcript, and the TD-03 doctor checks.

**Type:** improvement.

**Evidence and problem:**

- The daemon needs `REALM_DRIVER_SECRET_ROOT`, `REALM_DRIVER_WORKSPACE_ROOT` and `REALM_DRIVER_STATE_ROOT` in its environment (`src/daemon/main.ts:50-56`). Unset or relative, a create is refused with `SCHEMA_INVALID` (`src/runtime/session-execution.ts:425-447`). This is TD-03 (`.planning/milestones/v2.0-MILESTONE-AUDIT.md:266`). VERIFIED_BY_CODE_READING.
- `config.json` (image digest, `stateDir`, `workspaceRoot`) and `policy.json` are written by hand, and the state directory must be set to mode 0700 by hand (`docs/integration/omp.md:172-174`; schema at `docs/policy-reference.md:291-293`). VERIFIED_BY_CODE_READING.
- The CLI commands are `up`, `mcp`, `acp`, `down`, `status`, `doctor` and `anchor` (`src/cli/main.ts:580-608`). There is no `init` command and no `doctor --fix`. A doctor check carries a `fix: string | null`, which is prose (`src/doctor/checks.ts:57-62`). VERIFIED_BY_CODE_READING.
- The doctor check ids are `policy-file`, `state-dir`, `session-store`, `podman`, `podman-service`, `openshell`, `anda-bridge`, `control-channel`, `agentos`, `host-binaries` and `kernel-hardening` (`src/doctor/checks.ts:43-54`). None checks the three driver roots, the driver socket or the gateway (TD-03). VERIFIED_BY_CODE_READING.
- `README.md:24-32` shows `npm ci`, `npm run build`, `npm test` and no install or first-run commands; `README.md:45-46` says `realm` is not on `PATH`. VERIFIED_BY_CODE_READING.
- The persistent `omp plugin install --scope=user` path is not verified, and local install path semantics are not verified (`docs/hosts/snippets/omp.md:38-47`). Only the `-e` path was proven live. `package.json:30-34` declares the `omp.extensions` entry. VERIFIED_BY_CODE_READING.
- The daemon inherits the entire environment of the process that starts it: `startDetachedDaemon` passes no `env` option (`src/cli/main.ts:340-345`), and a daemon started by the Omp extension held both fake sentinel variables that were added to Omp's environment (`LIVE-VERIFICATION.md` L8, VERIFIED_BY_EXECUTION). Provider keys in an Omp environment therefore live in the long-lived daemon. Once the roots are in `config.json`, the daemon no longer needs the parent's environment.

**Proposed change:**

1. `realm init`: write `config.json` and `policy.json` templates, create the state directory with mode 0700, and refuse to overwrite an existing file. It takes the image digest as an argument or from `release/`; it never invents one.
2. `realm doctor --fix`: apply only the safe subset (create missing directories, set the state directory to 0700). Everything else stays prose. Each fix is idempotent and reports what it changed.
3. Move the three `REALM_DRIVER_*` roots into `config.json` with a derived default under `stateDir`, keeping the environment variables as an override for one release only if the owner wants a transition; the default stance (no shim) is a clean cutover.
4. Add the TD-03 checks: the three roots set, absolute and mode-correct; the driver socket present with mode 0600 in a 0700 directory; the gateway reachable.
5. Verify `omp plugin install` live under an isolated profile, record the result in `docs/hosts/snippets/omp.md`, and add install steps to `README.md`.
6. Add a README quickstart with a captured transcript of `init`, `up`, `status`, `down` on a real host.
7. Start the daemon with an allowlisted environment (`PATH`, `HOME`, `XDG_RUNTIME_DIR`, `XDG_CONFIG_HOME`, and what the roots need) instead of the parent's whole environment, in both `startDetachedDaemon` and the CLI's spawn (`src/cli/main.ts:333`, `:340-345`), with a test that a sentinel variable does not reach the daemon.

**Benefit:** A new user reaches an active sandbox without reading the integration notes or hand-writing JSON, and the generic `SCHEMA_INVALID` on an unset root becomes a named doctor failure with a fix.

**Effort and risk:** M. Risks: the driver launcher lives outside the repository (TD-02, `.planning/milestones/v2.0-MILESTONE-AUDIT.md:265`), so moving the roots into `config.json` must be coordinated with whoever launches the driver, or the driver and daemon will disagree; `realm doctor --fix` writes to the host, so it needs a dry-run mode and a mode check that refuses symlinked directories; the README transcript needs a real Podman 5.x host (UNVERIFIED until captured).

**Dependencies:** none of the other proposals. Owner decision: the driver-launcher location and whether the environment variables are removed or kept as an override. Extends TD-03 and TD-02, and CLI-03 (`.planning/REQUIREMENTS.md:80`).

**Success measure:** On a clean host with Podman 5.x, `realm init` then `realm up` reaches active with no manual file edit; `realm doctor` fails with a named check and a fix when a driver root is unset; `realm doctor --fix` on a state directory with mode 0755 changes it to 0700 and a second run changes nothing; unit tests cover each new check and each fix.

**Suggested placement:** next milestone.

---

## 3. Per-project sandboxes

**Title:** Per-project sandboxes: a session opens in any project directory or subdirectory with its own sandbox mounting that directory.

**Type:** feature.

**Evidence and problem:**

- `verifyPinnedAt` requires the same device and inode as the pinned root and refuses anything else with `POLICY_DENIED`; a subdirectory is refused (`src/fs/root.ts:63-80`). VERIFIED_BY_CODE_READING.
- `requireSameDirectory` refuses with `POLICY_DENIED` unless the session workspace and the pinned root resolve to one directory (`src/runtime/session-execution.ts:486-497`). VERIFIED_BY_CODE_READING.
- The daemon owns one session id, `"daemon"` (`src/daemon/main.ts:21`). The compute driver mounts one pinned root at `/workspace`, and "the workspace id selects no directory" (`src/runtime/driver/compute-driver.ts:122-124`, `:1130`). The sandbox binding takes one `workspaceRoot` (`src/runtime/driver/sandbox-binding.ts:12-16`, `:28-35`). VERIFIED_BY_CODE_READING.
- `realm up`, `mcp` and `acp` take a workspace root from `--workspace` or the working directory (`src/cli/main.ts:584`), but the daemon then accepts only the directory it was pinned to. A second project needs a second state directory and a second daemon, and that workaround is not safe on one account: the second daemon's startup reap removes every realm-owned container on the Podman socket, the first daemon's sandbox included (`src/session/reap.ts:33-39`; `src/runtime/sweep.ts:33-56`). VERIFIED_BY_CODE_READING; not run, because it would destroy a live session.
- The recorded decision is one container per session with the daemon owning sessions (`AGENTS.md:92`; `docs/integration/runtime-decision.md:25`). Changing it needs "a new recorded decision" (`AGENTS.md:90`). VERIFIED_BY_CODE_READING.

**Proposed change:** Let `up` carry a workspace root that is a descendant of a configured root in `policy.json` `workspaceRoots`, and let the daemon hold several sessions, each with its own session id, session record, sandbox name `realm-<sessionId>`, pinned subdirectory and bind mount. Replace the single `"daemon"` session id with an id derived from the workspace. Keep the pinned-root check, applied per session. Record the decision first (a new section in `docs/integration/runtime-decision.md`) because it changes what "the daemon owns sessions" means.

**Benefit:** One daemon serves several projects, a session opens in the directory the user is working in, and a sandbox mounts only that directory, which is a smaller exposure than a whole workspace root.

**Effort and risk:** L. Risks: the single-session assumption runs through the controller, the reaper (`src/session/reap.ts:33-39` deletes every record), the audit file name (`src/audit/log.ts:109`, one file per session id), the locks table (`src/fs/locks.ts:14`) and the status snapshot; resource limits are per container, so several sandboxes multiply the memory and CPU commitment (`src/runtime/hardening.ts:50-51`); the compute driver and gateway contract (PRD-DRV-01, still open, `.planning/REQUIREMENTS.md:132`) assume one workspace root.

**Dependencies:** Owner decision: a new runtime decision superseding the one-session model. Interacts with proposal 5 (reaper semantics and re-adoption are per session) and proposal 7 (the audit and correlation id become per project). PRD-DRV-01's amendment is an open owner decision (`.planning/milestones/v2.0-MILESTONE-AUDIT.md:248`) and the driver's workspace handling is part of it.

**Success measure:** Two `realm up` calls from two different project directories under the configured roots yield two active sandboxes with distinct `/workspace` contents; a write in one is not visible in the other; `realm down` for one leaves the other active; a directory outside every configured root is still refused with `POLICY_DENIED`. Unit tests cover the per-session pin, and the live suite gains a two-project scenario.

**Suggested placement:** backlog, until the runtime decision is recorded.

---

## 4. Crash-safety pack

**Title:** Crash-safety pack: orphan temp-file sweep, audit reconciliation, directory fsync on record deletion, real-SIGKILL fault injection, and the TD-01 and TD-04 fixes.

**Type:** improvement.

**Evidence and problem:**

- The write path creates `.<name>.realm-tmp-<16 hex>` in the target directory with `O_EXCL`, fsyncs it, compares the prior hash, renames, then fsyncs the parent directory (`src/fs/atomic-write.ts:177-203`, `:149-153`). VERIFIED_BY_CODE_READING.
- The temp file is removed only by an in-process catch (`src/fs/atomic-write.ts:204-205`). `git grep realm-tmp` finds production code only in `src/fs/atomic-write.ts:177`; nothing sweeps orphans after a crash. VERIFIED_BY_EXECUTION (the grep was run) and VERIFIED_BY_CODE_READING. Run for this task (`LIVE-VERIFICATION.md` L6a, VERIFIED_BY_EXECUTION): a child process SIGKILLed itself at each of the four hookable stages, all of which fire before the rename; every kill left the target at its old content (never torn) and one complete orphan temp file holding the new content, and a later clean write to the same target did not remove it. A kill after the rename leaves the complete new file and no temp file by the atomicity of `rename(2)` (not run, INFERENCE).
- `SessionStore.delete` calls `rmSync` and does no directory fsync (`src/session/store.ts:91`), while `save` goes through `atomicWriteFile`, which does fsync the directory (`src/session/store.ts:40`). VERIFIED_BY_CODE_READING.
- An admission line is written before a write and a result line after (`src/tools/workspace.ts:10-15`). A crash between them leaves an admission with no result, and nothing reconciles it. A failed append after execution does not roll back the effect (`src/tools/workspace.ts:14-15`). VERIFIED_BY_CODE_READING.
- Fault injection raises exceptions at each of the four stages `after-temp-write`, `after-fsync`, `before-rename`, `after-recheck` (`src/fs/atomic-write.ts:34`; `test/fs/atomic-write.test.ts:112-134`). No test kills a process mid-write: `test/audit/log.test.ts:276` uses `SIGKILL` only as a hang guard, and the live suite's only kill is the daemon in scenario 5 (`test/integration/production-driver.test.ts:485`, `:496`). VERIFIED_BY_CODE_READING.
- TD-01: over the daemon a tool refusal's cause code is dropped (`refused(tool, error.code)`, `src/tools/dispatch.ts:127`, `:257-258`); the daemon path is proven live only (`.planning/milestones/v2.0-MILESTONE-AUDIT.md:264`). VERIFIED_BY_CODE_READING.
- TD-04: a retry from the error state reuses the recorded container id, and if the container is gone start fails with `OPENSHELL_START_FAILED` and only `realm down` recovers; no test covers it (`.planning/milestones/v2.0-MILESTONE-AUDIT.md:267`). The controller comment at `src/lifecycle/controller.ts:154-158` states the stored-container-id rule. VERIFIED_BY_CODE_READING of the audit row and the comment; the failure itself is UNVERIFIED until a test reproduces it.
- The startup reap's result (`containersRemoved`, `recordsDeleted`) is awaited and dropped (`src/daemon/daemon.ts:543`), and no other file reads those fields, so the destruction of a sandbox after a crash leaves no log line and no message (`ABRUPT-END-PERSISTENCE-FINDINGS.md` G4). VERIFIED_BY_CODE_READING.

**Proposed change:**

1. Startup sweep: remove regular files named exactly `.<name>.realm-tmp-<16 lowercase hex>` under each configured workspace root and the state directory's session directory, through the pinned-root descriptor (never by following symlinks), older than a bound, and audit each removal. It must not touch any other dotfile.
2. Audit reconciliation at startup: for each audit file, find admission lines with no following result line and append a result line. The outcome type is `"ok" | ErrorCode` (`src/audit/log.ts:18`), so this needs an existing catalogue code or an owner-approved addition; the reconciliation must record that it is a reconciliation, not an execution result.
3. fsync the sessions directory after `SessionStore.delete`, reusing the directory-sync helper already in `src/fs/atomic-write.ts`.
3a. Log the startup reap: the container ids removed, the number of records deleted, and a status-read notice on the next attach, so a destroyed sandbox is never silent.
4. Real-SIGKILL tests: a child process writes through `atomicWriteFile` and kills itself from the stage hook at each of the four stages (all fire before the rename); the parent asserts the original is intact, names the orphan temp file, and asserts the next sweep removes it. The child-process pattern already exists in `test/fs/atomic-write.test.ts:99-110`.
5. TD-01: carry the refusal cause code across the daemon for MCP and ACP, and add a daemon-path equivalence test beside `test/surfaces/equivalence.test.ts`.
6. TD-04: when the recorded container is gone, retry creates a new container instead of failing; add the controller test.

**Benefit:** A crash at any point in a write leaves no stray hidden file and no unexplained audit gap; a retry recovers without `realm down`; clients see the real refusal cause.

**Effort and risk:** M. Risks: the orphan sweep deletes files in the user's workspace by name pattern, so the match must be exact and the sweep must be conservative; audit reconciliation appends to a log that is otherwise written only by the dispatcher; TD-01 touches the MCP and ACP result shapes, which the milestone audit found wrong in release 0.2.0 and fixed in 0.2.1 (`.planning/ROADMAP.md:369`), so the wire change needs the equivalence tests first.

**Dependencies:** Proposal 7 shares the audit log (do the hash chain after reconciliation, or design them together, because reconciliation appends lines). Owner decision: whether reconciliation may add a catalogue code. Extends TD-01, TD-04, and FS-05 (`.planning/REQUIREMENTS.md:34`) and AUD-01.

**Success measure:** For each of the four stages, a real-SIGKILL test passes: original bytes intact, one orphan present, zero orphans after the next sweep. A crash test leaves an admission line without a result and the next start appends the reconciliation line exactly once (a second start appends none). A controller test with a removed container reaches `active` on retry. A daemon-path test shows the same cause code over MCP and ACP as in process.

**Suggested placement:** next milestone.

---

## 5. Resume and checkpoint

**Title:** Resume and checkpoint: re-adopt a surviving sandbox after a daemon crash, add a persistent scratch volume, and add workspace snapshots with restore.

**Type:** feature.

**Evidence and problem:**

- The startup reaper removes every realm container and then deletes every session record, with no re-adoption (`src/session/reap.ts:33-39`; header at `:1-7` cites D-84, D-86 and RT-08). The sweep it calls is `removeAllRealmContainers` (`src/runtime/sweep.ts:33-56`). VERIFIED_BY_CODE_READING.
- The live suite proves exactly this behaviour: after the daemon is killed, the next `realm up` reaps the leftover sandbox and reaches active with one (`test/integration/production-driver.test.ts:485`; `.planning/REQUIREMENTS.md:210`, RT-08, VERIFIED_BY_EXECUTION on 2026-10-28). It was observed again on 2026-10-29 with a file in the sandbox's scratch directory (`LIVE-VERIFICATION.md` L5, VERIFIED_BY_EXECUTION): after the daemon's SIGKILL the orphan container kept running and still held the file, the next `realm up` replaced it with a container of a different id, and the scratch file was gone while the `/workspace` file was intact. So a daemon crash always destroys the sandbox and anything in its tmpfs.
- The sandbox has a read-only root and tmpfs mounts for its temporary and run directories (`src/runtime/hardening.ts:47-48`), and the workspace bind read-write at `/workspace` (`src/runtime/driver/sandbox-binding.ts:18-19`). Anything outside `/workspace` is lost on every teardown. VERIFIED_BY_CODE_READING.
- The AgentOS VM is ephemeral in library mode (`docs/integration/agentos.md:26-28`). VERIFIED_BY_CODE_READING.
- No checkpoint, snapshot-of-workspace or volume code exists in `src` (a search for checkpoint, volume and snapshot finds only unrelated state snapshots and the Anda client). VERIFIED_BY_EXECUTION (grep run).
- The sandbox lasts until `realm down`, and a host shutdown never sends `down` (`AGENTS.md:93`; `src/omp/plugin.ts:340-342`). VERIFIED_BY_CODE_READING.

**Proposed change:**

1. Re-adoption: at startup, for a session record whose container is still running and passes the create-time hardening verifier (`src/runtime/session-execution.ts:454-481`), adopt it instead of removing it; reap only what fails the verifier or has no record. The reaper's "remove everything" rule becomes "remove what cannot be proven good".
2. A persistent scratch volume mounted beyond `/workspace` for tool caches and build output, owned by the session, removed by `realm down`.
3. Workspace snapshots with restore: a snapshot of the workspace directory before a risky operation and a restore command. The mechanism (copy, reflink, filesystem snapshot) must be chosen after a spike.

**Benefit:** A daemon crash or restart no longer discards a running sandbox and its in-flight state; users can roll back a bad agent run.

**Effort and risk:** L. Risks: adoption trusts a running container, so the verifier must be the gate and the reaper's current guarantee (no orphan survives, RT-08, RT-09) must be kept in a precise form; a new volume is a new mount, which the profile and the A10 boundary review treat as a change (`.planning/REQUIREMENTS.md:38`, RT-01 "mounts only the bound workspace and the realm state directory"); snapshots of a live read-write bind can be inconsistent; the reaper header records a single-owner precondition (`src/session/reap.ts:29-32`).

**Dependencies:** Owner decision on the reaper semantics (D-84, D-86, RT-08) and on amending RT-01's mount list for a volume. Interacts with proposal 3 (per-session adoption) and proposal 4 (the orphan sweep and reconciliation run before adoption).

**Success measure:** A live scenario kills the daemon, restarts it, and observes the same container id active with its `/workspace` content intact and no second container; a container that fails the verifier is still removed; a file written to the scratch volume survives a daemon restart and is gone after `realm down`; a snapshot then restore returns a modified workspace to its prior content byte for byte.

**Suggested placement:** backlog, until the owner decides the reaper semantics.

---

## 6. Scripted-provider end-to-end harness

**Title:** Scripted-provider end-to-end harness: a local OpenAI-compatible stub that drives Omp's own write tool with no credentials and no tokens.

**Type:** improvement.

**Evidence and problem:**

- OMP-05 ("when disconnected, the plugin reports it and applies the configured policy; it never silently falls back to unsandboxed file mutation") is open and partial: the guard is unit-verified for `write` and `edit`, and a live check needs a model call (`.planning/REQUIREMENTS.md:74-75`, `:227` of the traceability table). VERIFIED_BY_CODE_READING.
- The live procedure exists but needs a working model provider; the realm account's profile ran out of quota on 2026-10-28 and a provider key is the owner's to supply (`docs/integration/omp.md:161`, `:202-209`). VERIFIED_BY_CODE_READING.
- The guard's decisions are unit-tested in `test/omp/plugin.test.ts`, which uses manual timers (`test/omp/plugin.test.ts:134`); no test drives Omp's own `write` tool. VERIFIED_BY_CODE_READING.
- Omp accepts a custom OpenAI-compatible provider, and the guard can be driven with it: on 2026-10-29 a scripted provider (a Node HTTP server of about 100 lines answering `POST /v1/chat/completions` over server-sent events) and a `models.yml` entry (`baseUrl`, `api: openai-completions`, `apiKey: dummy`) made Omp call its own `write` tool, and the guard was observed in advisory mode (notice, write allowed) and in fail-closed mode (write blocked with `REALM_NOT_ACTIVE`, no file), with the realm active and with it down (`LIVE-VERIFICATION.md` L3, L4). VERIFIED_BY_EXECUTION. The run is not LLM-driven.
- The audit lists this as owner decision 9, "OMP-05's live limit: open; the procedure is written" (`.planning/milestones/v2.0-MILESTONE-AUDIT.md:253`). VERIFIED_BY_CODE_READING.

**Proposed change:** A gated test harness under `test/` with a small local HTTP stub that speaks the OpenAI-compatible chat completions protocol and returns a scripted sequence (one `write` tool call, then a final message). It starts an isolated Omp profile whose `models.yml` points at the stub, loads the built extension with `-e` (`docs/integration/omp.md:175`), and runs the two cases of the existing procedure: advisory mode with the realm down (the call proceeds, the notice appears, the file exists) and fail-closed mode with the realm down (the call is blocked with `REALM_NOT_ACTIVE`, the file does not exist). It also adds a third case for the realm active, which is the case proposal 1 changes. The harness is gated like the production live suite and skips in CI by default.

**Benefit:** A repeatable regression run of the guard in both modes with no credentials, no quota and no tokens, and the test bed proposal 1 needs.

**Effort and risk:** S to M, because a working prototype exists outside the repository: Omp is driven over RPC pipes (`--mode rpc-ui`), so no pseudo-terminal and no keypresses are needed, and the run took about 3 minutes at a host load of about 70. Risks: the stub depends on Omp's provider protocol and tool-call format, which can change between Omp versions (18.12.6 was tested; the notes name 18.12.5 and 18.12.6); the prototype scripts need hardening, gating like the production live suite, and their own tests; the model's tool names and schema belong to Omp (the `write` schema carries a required intent field `i` that the scripted call did not set, and Omp accepted the call).

**Dependencies:** Proposal 1 benefits from it and should reuse it. Owner decision: none to build it. The change of OMP-05's status from partial to complete remains the owner's decision; this proposal produces evidence, it does not change the requirement.

**Success measure:** One command runs the harness against a built extension and a local Omp and passes: advisory mode shows the notice and creates the file, fail-closed mode blocks with `REALM_NOT_ACTIVE` and creates no file, with the Omp version recorded; the run makes no network call outside loopback. The result is attached to the evidence for OMP-05 so the owner can decide its status.

**Suggested placement:** next milestone, ahead of proposal 1's implementation.

---

## 7. Observability and tamper-evident audit

**Title:** Observability and tamper-evident audit: structured leveled logs with a correlation id, local metrics, a hash-chained audit log with a verify subcommand, and a distinct error code for gateway or driver loss.

**Type:** feature.

**Evidence and problem:**

- No metrics, tracing or structured logger exists in `src`; `git grep` for metric, opentelemetry, pino, traceId, correlationId, prometheus and logger finds one unrelated ed25519 line (`src/runtime/driver/isolation/launch.ts:83`). VERIFIED_BY_EXECUTION (grep run). Diagnostics are stderr text: a failed daemon writes one line carrying a catalogue code (`src/daemon/main.ts:70-71`). VERIFIED_BY_CODE_READING.
- The audit log has no hash chain: `src/audit/log.ts` has no previous-hash, HMAC or sequence field (a grep for `prev` and `seq` returns nothing); `createHash` is used only for the exec script digest. Tamper evidence is the optional manual Merkle anchor to Solana devnet, which needs a funded key and a network (`src/audit/anchor.ts:1-4`). VERIFIED_BY_CODE_READING.
- Audit files are named by session id (`src/audit/log.ts:2`, `:109`), and the daemon's only session id is `"daemon"` (`src/daemon/main.ts:21`). A session id therefore cannot separate one `up` or one tool call from another. VERIFIED_BY_CODE_READING.
- TD-05: a gateway or driver loss has no code of its own; any failed probe, including an OpenShell failure, reads as `AGENTOS_CRASH_LOOP` (`.planning/milestones/v2.0-MILESTONE-AUDIT.md:268`; throw sites `src/runtime/agentos.ts:143`, `:228`, `:249`). VERIFIED_BY_CODE_READING. The error catalogue is a frozen shared contract (`.planning/REQUIREMENTS.md:16`, FOUND-02; `AGENTS.md:65`), so a new code needs an owner decision.
- `AGENTS.md:142`: "There is no telemetry that sends data off the machine." Any metrics design must stay local. VERIFIED_BY_CODE_READING.

**Proposed change:**

1. Audit chain: add a `seq` and a `prev` field (sha256 of the previous line) to each audit line, and a `realm audit verify` subcommand that reads an audit file and reports the first line that breaks the chain. `appendAudit` does not read the file today, so the chain head must be tracked in memory per file and recovered from the last line at startup, with the reconciliation of proposal 4 designed in.
2. Structured logs: a small leveled logger with one JSON object per line on the daemon's log, a correlation id per `up` and per tool call, and the catalogue code in a fixed field. No dependency is needed; CONTRIBUTING.md:49-55 requires a justification, a licence check and a maintenance check for any dependency.
3. Metrics: counters and timings (tool calls by outcome, state transitions, attach duration) exposed over the existing control socket through a new `status` field or method, not over a network port.
4. TD-05: a distinct catalogue code for gateway or driver loss, mapped in the probe path, with the owner's approval.

**Benefit:** An operator can tell which call failed and why, can prove an audit file has not been edited or truncated without a network, and can tell a dead runner from a dead gateway.

**Effort and risk:** L. Risks: changing the audit line shape affects the redaction tests and the Merkle anchor (`src/audit/anchor.ts`), which hashes lines; a chain does not stop deletion of the whole file or of the tail, so the verify command must be paired with the anchor for that; a new metrics method extends the control protocol (`src/daemon/channel.ts`); a new error code changes a frozen contract and every table that enumerates codes.

**Dependencies:** Proposal 4 (reconciliation lines) and proposal 3 (the correlation id and audit file naming per project). Owner decision: TD-05's new code, because the catalogue is frozen. Extends AUD-01 and QUAL-03, and TD-05.

**Success measure:** `realm audit verify` passes on an untouched file and names the first broken line after a middle line is edited, removed or reordered; a log line for a tool call carries the same correlation id as its admission and result audit lines; killing the gateway yields the new code, not `AGENTOS_CRASH_LOOP`, in `realm status` and in a probe test; no new network listener exists.

**Suggested placement:** backlog; the audit chain and `verify` first, because they are the smallest and most testable part.

---

## 8. Quality and supply-chain ratchet

**Title:** Quality and supply-chain ratchet: a coverage gate, mutation and property tests for the path canonicalizer and policy parser, de-flaked fixed-timeout tests, `npm audit`, Dependabot, a release-job split that enables provenance attestation, rollback automation, and TD-07, TD-08 and TD-09.

**Type:** improvement.

**Evidence and problem:**

- No coverage tooling: `package.json:52-67` has no coverage script, `.github/workflows/ci.yml` has no coverage step, and `coverage` appears only in an ignore list (`scripts/docs/sync-site.mjs:24`). No `fast-check` or mutation tool exists in the repository (`git grep` returns nothing outside `.planning`). VERIFIED_BY_EXECUTION (grep run).
- Path canonicalization and policy parsing have example tests only: `src/fs/canonicalize.ts` with `test/fs/canonicalize.test.ts`, `test/fs/toctou.test.ts`; `src/core/policy.ts` with `test/core/policy.test.ts`, `test/core/policy.schema.test.ts`. FS-02 is the open requirement (`.planning/REQUIREMENTS.md:31`; traceability `:199`: "Partial (accepted approximation ... check-to-use windows remain on the read and write paths)"). VERIFIED_BY_CODE_READING. Property tests exercise canonicalization and parsing; they do not close FS-02's race-resistance, whose status is the owner's.
- Load-sensitive fixed-timeout tests: a real 9000 ms wait (`test/lifecycle/idempotent.test.ts:111-113`), `sleep(700)` against a cache TTL (`test/runtime/libpod-client.test.ts:313`), a 200 ms kill window against a 10 000 ms child (`test/runtime/session-execution.test.ts:944`), fixed 2000 ms guards (`test/mcp/server.test.ts:62`, `:124`; `test/daemon/daemon.test.ts:159`), and 21 `{ timeout: 10_000 }` caps under `test/acp`. `test/omp/plugin.test.ts:134` uses manual timers, which is the good pattern. VERIFIED_BY_CODE_READING and VERIFIED_BY_EXECUTION (the count was run).
- `.github` holds `ISSUE_TEMPLATE`, `PULL_REQUEST_TEMPLATE.md` and `workflows` only: no `dependabot.yml` and no `CODEOWNERS`. `ci.yml` has no `npm audit` step. `SECURITY.md` is 12 lines. VERIFIED_BY_EXECUTION (`git ls-files` and `wc -l` run).
- The release job holds `contents: write` and `actions: write` in the same job that installs dependencies and builds (`.github/workflows/ci.yml:138-140`, `:162`), runs on a self-hosted runner (`:136`), and the workflow says a job split "would remove the shared user altogether; it is a recorded follow-up" (`:398-401`). `AGENTS.md:105`: "The release carries no provenance attestation or signature yet." A split is the precondition for attestation (TD-10, `.planning/milestones/v2.0-MILESTONE-AUDIT.md:273`). VERIFIED_BY_CODE_READING.
- No rollback or yank automation exists (no rollback workflow in `.github/workflows`; `AGENTS.md:97-105` describes forward release only). VERIFIED_BY_CODE_READING.
- TD-07 (`pack-smoke` omits host snippets and the prime-agent `MCP.md` and `SKILL.md`; the release job packs after the version sync without rerunning `check:pack`), TD-08 (the changelog lists commits of later-removed features), TD-09 (`EGRESS_DENIED` catalogued, mapped, never thrown; about 60 exports and 55 exported types used only by tests) are at `.planning/milestones/v2.0-MILESTONE-AUDIT.md:270-272`. VERIFIED_BY_CODE_READING of the register.
- CONTRIBUTING.md requires three recorded items for any new dependency (`CONTRIBUTING.md:49-55`), and the runtime dependencies are exact pins (`package.json:77-80`).

**Proposed change:** Four independent parts, each its own pull request:

- A, small: add `npm audit --omit=dev --audit-level=high` to `ci.yml`; add `.github/dependabot.yml` for `github-actions` and `npm` (root and `site/`); fix TD-07 by adding the missing files to `pack-smoke` and rerunning `check:pack` on the release tarball.
- B, medium: a `test:coverage` script using the Node test runner's coverage output and a per-directory threshold ratchet for `src/fs`, `src/core` and `src/tools`; replace the fixed-timeout tests with an injected fake clock where a seam exists (libpod TTL cache, idempotent lifecycle) and a shared scaled-timeout helper in `test/support` for the remaining guards; TD-09 dead-export removal using the coverage output.
- C, medium: `fast-check` as a dev dependency (with the three CONTRIBUTING items) and properties for the canonicalizer (no result escapes the root for random `..`, symlink, NUL, doubled-slash and unicode inputs) and the policy parser (round trip, unknown keys rejected); a scheduled, non-blocking mutation run over `src/fs`, `src/core/policy.ts` and `src/audit/redact.ts`.
- D, large and owner-gated: split the release job into an unprivileged build job and a privileged publish job, add build provenance attestation, a manual rollback workflow (mark the release a prerelease and re-point the docs), and a changelog filter for removed features (TD-08, `scripts/release/changelog.mjs`).

**Benefit:** Regressions in the security-relevant path logic are found by generated inputs, not only by the cases someone thought of; flaky timing tests stop failing under load; known vulnerable or stale dependencies surface automatically; releases can carry provenance and be rolled back without hand work.

**Effort and risk:** L overall; A is S, B and C are M, D is L. Risks: part D changes the release path, which is the highest-risk path in the repository: "Human review is required before merge for `.github/workflows/**`, `release/**`, `scripts/release/**`" (`AGENTS.md:140`), and the release runs on every green push to `main`; a coverage threshold set too high blocks all merges; mutation testing is slow and belongs off the critical path; Dependabot opens pull requests that are subject to the Greptile and ship flow (`AGENTS.md:112-113`).

**Dependencies:** Part D needs the owner's explicit sign-off on any change under `.github/workflows` and `release`, and the repository settings listed in TD-10 (secret scanning, push protection, branch protection, `sha_pinning_required`) are the owner's and cannot be changed from the repository. Part B's dead-export work extends TD-09. Part C extends FS-01 and FS-03 confidence and touches the FS-02 area. None of the other seven proposals depends on it, but proposals 1, 4 and 7 each add code that part B's gate would then cover.

**Success measure:** CI fails when coverage in a ratcheted directory drops below its recorded floor; `fast-check` properties run in `npm test` and a deliberately broken canonicalizer fails one; the 21 `test/acp` caps and the six other fixed waits are replaced or scaled, and the suite passes under a loaded host (run with a CPU-limited container); `npm audit` and Dependabot appear in CI and `.github`; after part D a release carries an attestation that `gh attestation verify` accepts (UNVERIFIED until built) and the rollback workflow marks a test release as a prerelease.

**Suggested placement:** next milestone for parts A to C; backlog for part D until the owner signs off.

---

## Selection needed

Owner decision required before work can start:

- **Proposal 1:** whether fail-closed may disable Omp's built-in tools, and what the product claims if the extension API cannot enforce removal. The spike can start without the decision.
- **Proposal 3:** a new recorded runtime decision superseding one session per daemon (`AGENTS.md:90-92`); and PRD-DRV-01's open amendment (`.planning/milestones/v2.0-MILESTONE-AUDIT.md:248`).
- **Proposal 5:** the reaper semantics (D-84, D-86, RT-08) and an amendment of RT-01's mount list for a volume.
- **Proposal 7:** a new error code for gateway or driver loss (TD-05), because the catalogue is frozen; the audit chain and logging parts need no decision.
- **Proposal 8, part D:** explicit sign-off for changes under `.github/workflows` and `release` (`AGENTS.md:140`) and the TD-10 repository settings.
- **Proposal 4, item 2:** whether audit reconciliation may add a catalogue code or must reuse an existing one. The other items need no decision.

Can start without an owner decision: proposal 2 (apart from the driver-launcher coordination note), proposal 4 items 1, 3, 4, 5 and 6, proposal 6, and proposal 8 parts A to C.

Status changes are not proposed anywhere in this document: OMP-05, FS-02 and the other carried requirements keep the status the owner has set.

PROPOSALS_COMPLETE: yes

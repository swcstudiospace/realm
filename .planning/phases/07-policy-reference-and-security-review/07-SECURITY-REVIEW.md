# Phase 7 Security Review: Realm

Requirement: QUAL-03 (security review recorded before first release).
Reviewed: 2026-10-22, working tree at `/root/src/repos/agent-realm`.
Intended destination: `.planning/phases/07-policy-reference-and-security-review/07-SECURITY-REVIEW.md`.
Status of this document: review findings and dispositions. It does not close any finding.

## 1. Scope

In scope (source read at review time):

- Policy: `src/core/policy.ts`, `src/core/policy.schema.json`, `docs/policy-reference.md` (cross-checked, not edited).
- Composition root: `src/realm/compose.ts`.
- Lifecycle: `src/lifecycle/controller.ts`, `src/lifecycle/mutation-gate.ts`, `src/core/timeout.ts`.
- Dispatcher and file handlers: `src/tools/dispatch.ts`, `src/tools/workspace.ts`, `src/fs/write.ts`.
- Filesystem: `src/fs/root.ts`, `src/fs/canonicalize.ts`, `src/fs/credentials.ts`, `src/fs/atomic-write.ts`.
- Runtime: `src/runtime/hardening.ts`, `src/runtime/egress.ts`, `src/runtime/openshell.ts`, `src/runtime/session-execution.ts`, `src/runtime/sweep.ts`, `src/runtime/libpod-client.ts`, `src/runtime/config.ts`.
- Sessions and daemon: `src/session/paths.ts`, `src/session/store.ts`, `src/session/reap.ts`, `src/daemon/daemon.ts`, `src/daemon/channel.ts`.
- Audit: `src/audit/log.ts`, `src/audit/redact.ts`.
- Surfaces: `src/omp/plugin.ts`, `src/mcp/server.ts`, `src/acp/agent.ts`.
- Build and dependency manifest: `package.json`.
- Prior review records re-checked against current source: `.planning/phases/05-omp-plugin-mcp-and-acp-surfaces/05-REVIEW.md`, `05-VERIFICATION.md`, `.planning/phases/04-reaper-egress-guard-and-shared-dispatcher/04-REVIEW.md`, `docs/integration/omp.md`.

Out of scope for this file:

- Live behaviour of Podman, OpenShell, AgentOS, the Omp host, MCP clients, and ACP clients (see section 9).
- The dependency and supply-chain review, which is a separate deliverable. `package-lock.json` was not reviewed here.
- Phase 4 findings other than H-01, H-02, H-03, and M-01 (section 5.10). Their status is not re-verified here.

Constraints observed: no source or test file was modified, no dependency was added, and no test, typecheck, lint, build, or git command was run. No network request was made.

## 2. Method

1. Read each in-scope module and recorded the path and line of every claim. Line numbers are from the working tree at review time.
2. Traced each trust boundary from its entry point (host hook, MCP request, ACP request, control socket, policy file, runtime input) to the sink it controls (host filesystem, container lifecycle, OpenShell child process, audit file).
3. Re-checked every finding in the prior review records against current source. Where current source differs from a prior statement, the current source governs and the stale statement is noted in section 7.
4. Classified each control as:
   - **implemented**: the source enforces the control and no open gap is recorded against it;
   - **partial**: the source enforces part of the control and a named gap remains;
   - **open**: the gap is unresolved, or enforcement is unproven.
5. Marked conclusions that rest on reading code but were not exercised as `[INFERENCE]`.
6. Upstream host and client behaviour (Omp hooks, MCP, ACP, JSON-RPC wording) was not re-fetched. Statements about it cite the repository notes that recorded them, and are marked unverified where the notes say so.

## 3. The security boundary as implemented

### 3.1 Principals and paths

- **Untrusted principal:** the agent and any MCP or ACP client that drives it.
- **Entry points:**
  - the Omp `tool_call` hook for host built-in `write` and `edit` (`src/omp/plugin.ts:165`, `:259-276`);
  - MCP `tools/call` and ACP `realm/tool`, both of which call only `ToolDispatcher.call` (`src/mcp/server.ts:159`; `src/acp/agent.ts:168`);
  - the Omp retry command, which calls `dispatcher.call({ retry: {} })` (`src/omp/plugin.ts:284-300`).
- **Host-side file operations:** `read`, `list`, and `write` run in the realm process against the host filesystem, through the composed `PinnedRoot` (`src/tools/workspace.ts`, `src/fs/write.ts:43-63`). They do not run inside the container.
- **Container operations:** `exec` runs in the OpenShell-created Podman container (`src/tools/dispatch.ts:163-186`, `src/runtime/openshell.ts:141`).
- **Host inputs:** the policy file (`src/core/policy.ts:28-37`) and the runtime input (`src/runtime/config.ts`).

Implication (a fact from the code, not a finding): write containment for `write`, `edit`, and the realm `write` tool depends on the mutation gate and path checks, not on the container boundary.

### 3.2 Layered controls

**B1. Policy input.**
- `loadPolicyFile` reads an explicit caller-supplied path (`src/core/policy.ts:28-37`).
- A missing file yields the validated defaults: advisory mode, no roots, shell disabled (`policy.ts:28-37`; `policy.schema.json:8-17`).
- Any non-`ENOENT` read failure throws `POLICY_DENIED` (`policy.ts:46-57`).
- Invalid JSON throws `SchemaInvalidError` with a message that does not quote file content (`policy.ts`, `parseJson`).
- The schema is closed (`policy.schema.json:6`, `additionalProperties: false`).
- Every `workspaceRoots` entry must be absolute (`policy.ts:77-83`).
- The policy file may not resolve inside any of its own workspace roots, using `realpathSync` on both sides and segment comparison (`policy.ts:85-117`).
- No owner, mode, or content-hash check is made on the policy file. `policy.ts` contains no `stat`, `owner`, or `mode` call.

**B2. Workspace binding.**
- `bindRoot` requires an absolute path, resolves it with `realpathSync`, and requires a directory (`src/fs/root.ts:20-30`).
- `isInsideRoot` compares by path segment (`root.ts:33-41`).
- The composition root binds the workspace against the policy roots before any dispatcher exists (`src/realm/compose.ts:59`, `:90-94`).
- The controller binds again at `create`, from the string it is given (`src/lifecycle/controller.ts:156`, `:376-382`).

**B3. Mutation gate.**
- `decideMutation` returns allow for `active`. For any other state, advisory mode returns allow-with-warning. Fail-closed mode returns deny with a code from `denyCodeFor` (`src/core/policy.ts:130-141`, `:133-136` for advisory).
- The controller exposes the gate as `mutationGate()` (`src/lifecycle/controller.ts:115-117`).
- The file write handler consults the gate first and throws on refusal (`src/tools/workspace.ts:71-74`).

**B4. Dispatcher routing.**
- `#run` routes each tool. Unmatched values are refused with `SCHEMA_INVALID` (`src/tools/dispatch.ts:128-146`).
- `read` and `list` are not state-gated (`dispatch.ts:129-146`; `src/tools/workspace.ts`, `readWorkspaceFile`, `listWorkspaceDir`).
- `write` waits only while `connecting`, then runs the gate in the file handler (`dispatch.ts:153-157`).
- `exec` runs only while `active`, in both modes. A `connecting` state waits up to `toolQueueMs`. The shell form requires `shellEnabled` (`dispatch.ts:163-186`; `checkExecPolicy`, the final function in `policy.ts`).
- `retry` re-reads the state inside the audit window and then calls `controller.create(boundRoot.realPath)` (`dispatch.ts:199-214`).

**B5. File handlers.**
- A write runs in this order: gate, target canonicalization, credential check, advisory lock probe, admission audit line, then `lockedWrite` (`src/tools/workspace.ts:71-99`; `src/fs/write.ts:43-63`).
- `lockedWrite` refuses a symlink at the final segment in write mode and refuses an absent target with more than one missing segment (`write.ts:50-51`).
- `ifMatchSha256` mismatch throws `LOCK_CONFLICT` (`write.ts:62-63`).
- `canonicalize` resolves segment by segment with `lstat`, expands symlinks at most `MAX_SYMLINK_HOPS` times, and verifies the opened descriptor against `/proc/self/fd` on Linux, failing closed when that path is unavailable (`src/fs/canonicalize.ts:1-8`). Its header states that Node 22 has no `openat`, so the open is resolve-then-verify.
- `credentials.ts` denies a frozen list of credential-shaped paths, matched on the canonical relative path. A `credentialAllow` glob overrides a denial (`src/fs/credentials.ts`, `CREDENTIAL_PATTERNS`, and `assertCredentialAccess` at `:46-50`).
- Atomic write creates the temp file with `O_CREAT | O_EXCL | O_WRONLY | O_NOFOLLOW` at mode `0o600` (`src/fs/atomic-write.ts:51`, `:94-98`), checks the prior hash before rename (`:111-113`), and renames (`:114`). A post-rename durability failure reports `WRITE_NOT_ATOMIC` (`:42-48`).

**B6. Container profile.**
- `HARDENING_PROFILE` (`src/runtime/hardening.ts:13-30`): `privileged: false`; `capDrop: ["ALL"]`; `capAdd: []`; `no-new-privileges`; read-only root filesystem; tmpfs `/tmp` and `/run`; `pidsLimit` 512; memory 1 GiB; 2 CPUs; `networkMode: "none"`; forbidden socket names `docker.sock` and `podman.sock`.
- The header states that the libpod inspect field paths are provisional and are confirmed only by the gated Podman 5.x suite. It also states that no capability beyond the ALL drop is verified (`hardening.ts:1-10`, D-51).
- A non-conforming container is removed before the error is thrown (`src/runtime/session-execution.ts`, `verifyOrRemove`).

**B7. Egress.**
- The allowlist validator admits only exact DNS names of at least two labels, or IPv4 literals, with ports 1 to 65535 (`src/runtime/egress.ts:1-8`).
- An empty allowlist renders to `{}`, which is deny-all (`egress.ts:56-58`).
- The rendered map is placed in the OpenShell policy document (`src/runtime/openshell.ts:238-251`).
- The workload binary must be an absolute path (`src/runtime/config.ts:100-103`).

**B8. Host environment and socket isolation.**
- The OpenShell child receives only `PATH`, `HOME`, and `XDG_RUNTIME_DIR` (`src/runtime/session-execution.ts:49-51`, `:229-`).
- The child's environment is the frozen copy passed to `spawn` (`session-execution.ts:293`, `:307`).
- `buildExecArgv` never emits `--env` or `--provider` (`src/runtime/openshell.ts:5-6`, `:138-141`).
- The libpod client reads no environment and takes its socket path as an argument. The engine socket is never mounted into a session container (`src/runtime/libpod-client.ts:10-13`).
- The runtime config refuses host-network and driver-escape keys (`src/runtime/config.ts:32-39`, `:47-50`).
- `process.env` is read only on the host side: the CLI passes it to `runCli` (`src/cli/main.ts:502`), and the doctor probes read it (`src/doctor/checks.ts:131`, `:392`). None of these values reaches the container specification.

**B9. Teardown and startup reap.**
- The controller's single teardown bound is `TEARDOWN_TIMEOUT_MS = 5000` (`src/lifecycle/controller.ts:38`).
- `stop` runs from `controller.ts:317`. `destroy` runs from `controller.ts:347`, enters `stopping`, destroys the container, releases the session's locks, moves to `unbound`, and deletes the record (`controller.ts:347-374`).
- Teardown calls are wrapped by `teardownCall` (`controller.ts:745-753`).
- The adapter's `stop` stops the container after AgentOS, and `destroy` stops AgentOS before removing the container (`src/runtime/session-execution.ts:158-178`). The container step runs even when AgentOS stop fails.
- The adapter's container stop grace is `10_000` ms (`session-execution.ts:38`), and its AgentOS stop deadline is `15_000` ms (`session-execution.ts:41`).
- The daemon runs the startup reap before it opens its gate (`src/daemon/daemon.ts:427`). The reap proves zero realm-labelled containers survive, and only then deletes session records (`src/session/reap.ts:33-37`). The sweep removes every realm-labelled container (`src/runtime/sweep.ts:25-46`).

**B10. Host surfaces.**
- The Omp plugin guards exactly the host tool names `write` and `edit` (`src/omp/plugin.ts:101`).
- The guard refuses a non-string tool name, refuses all guarded calls when no session exists, refuses guarded calls the gate refuses, and warns and allows guarded calls the gate allows with a warning (`plugin.ts:259-276`).
- The plugin registers `session_start`, `session_shutdown`, `tool_call`, and the retry command (`plugin.ts:155-171`).
- MCP ignores notifications and never dispatches them, returns no reply to an unusable id, writes one-line JSON replies, and maps dispatch errors to fixed text (`src/mcp/server.ts:149-162`, `:185-188`, `:209-219`).
- ACP never executes a notification tool call, rejects batches, and decodes input with `StringDecoder` (`src/acp/agent.ts:124-130`, `:152-156`, `:200-201`).

**B11. Control channel and state directories.**
- The control socket path is `<stateDir>/run/control.sock` (`src/session/paths.ts:32-34`).
- The run directory is created or checked at mode `0o700`, and the socket is set to `0o600` after listen (`src/daemon/channel.ts:26`, `:29`; header `:5-8`).
- A live owner answering at the socket path refuses a second start with `LOCK_CONFLICT` (`src/daemon/daemon.ts:171-174`, `:412-413`).
- The session directory is created at mode `0o700` (`src/session/store.ts:19`, `:36`).

**B12. Audit.**
- The audit directory is created at `0o700`, refused if it is a symbolic link, and each audit file is opened and set to `0o600` (`src/audit/log.ts:98`, `:113-115`).
- The audit summary records `argv` with secret-shaped values redacted, and records a shell script as a byte count and a SHA-256, not as text (`log.ts:49-53`; `src/audit/redact.ts:34`).

## 4. Control status

| # | Control | Status | Evidence | Gap or note |
|---|---|---|---|---|
| C1 | Policy schema is closed, with frozen defaults | implemented | `policy.schema.json:6, 8-17` | None found. |
| C2 | Missing policy gives advisory defaults; unreadable gives `POLICY_DENIED`; invalid gives `SCHEMA_INVALID` | implemented | `policy.ts:28-37, 46-57` | No owner or mode check on the policy file (R6). |
| C3 | Workspace must lie inside a policy root before any dispatcher exists | partial | `compose.ts:59, 90-94`; `controller.ts:376-382` | Rule duplicated, not shared; rebind window (5.2). |
| C4 | Policy file may not lie inside its own roots | implemented | `policy.ts:85-117` | Location-only check (R6). |
| C5 | Policy roots must be absolute | implemented | `policy.ts:77-83` | Breadth of roots is unchecked (R7). |
| C6 | Mutation gate on file writes (CORE-05) | partial | `policy.ts:130-141`; `workspace.ts:71-74` | Advisory mode allows writes in every non-active state (5.3). |
| C7 | `exec` runs only while `active`, in both modes | implemented | `dispatch.ts:163-186` | None found. |
| C8 | Shell form requires `shellEnabled` | implemented | `checkExecPolicy` in `policy.ts`; `dispatch.ts:164`; `policy.schema.json` (default `false`) | Shell runs inside the sandbox, not on the host. |
| C9 | `read` and `list` are state-gated | not gated, by design | `dispatch.ts:129-146` | Reads within roots are allowed in any state (R8). |
| C10 | Symlink and traversal containment (FS-01) | implemented on Linux | `canonicalize.ts:1-8` | Fails closed without `/proc/self/fd`. |
| C11 | Race-resistant open (FS-02) | partial | `canonicalize.ts:5-8`; `root.ts` (`PinnedRoot` holds a path string) | No pinned descriptor for the root; resolve-then-verify only (R3). |
| C12 | Credential path denial (FS-03) | implemented, coverage gap | `credentials.ts` (`CREDENTIAL_PATTERNS`), `:46-50` | List has no entries for `**/*.pem`, `**/*.key`, `**/.npmrc`, or `**/.pypirc` (R4). `credentialAllow` can override. |
| C13 | Advisory per-file locks (FS-04) | implemented in-process | `compose.ts:60`; `write.ts:58-59` | Lock table is per handle; no cross-process lock (R9). |
| C14 | Atomic write (FS-05) | implemented | `atomic-write.ts:42-48, 51, 91-120` | A killed write leaves `.realm-tmp-*` behind (R5). |
| C15 | Container hardening profile (RT-01) | partial | `hardening.ts:1-10, 13-30` | Inspect field paths provisional; no live check (R1, R13). |
| C16 | Egress default-deny (RT-05) | partial | `egress.ts:56-58`; `openshell.ts:238-251` | Rendering is verified; live enforcement and the `networkMode: "none"` interplay are not (R1, R10). |
| C17 | No host environment or engine socket reaches the sandbox (AUD-02) | implemented in source | `session-execution.ts:49-51, 293-307`; `openshell.ts:5-6, 138-141`; `libpod-client.ts:10-13` | Not observed live (R1). |
| C18 | Teardown is bounded and idempotent (CORE-06) | partial | `controller.ts:38, 317, 347-374, 745-753`; `session-execution.ts:158-178` | Five teardown items open (5.6). |
| C19 | Startup reap runs before serve (RT-08) | implemented for the daemon, not the plugin | `daemon.ts:427`; `reap.ts:33-37` | Plugin path has no reap (5.6a). |
| C20 | Single owner for the control socket (RT-06, partial) | implemented for the daemon only | `daemon.ts:171-174, 412-413` | Plugin sessions are not coordinated (R9). |
| C21 | Control socket and run directory modes | implemented | `channel.ts:26, 29`; `paths.ts:32-34` | Not observed live. |
| C22 | Audit redaction and file modes (AUD-01, AUD-02) | implemented | `log.ts:49-53, 98, 113-115`; `redact.ts:34` | Result-line durability not re-verified (R10). |
| C23 | Host `write` and `edit` guard (OMP-05) | partial | `plugin.ts:101, 249-276` | Exact-name list; documented bypass paths (5.4). |
| C24 | MCP framing and dispatch-only routing | implemented | `mcp/server.ts:149-162, 185-188, 209-219` | Trust in stdin (5.8). |
| C25 | ACP framing and dispatch-only routing | partial | `acp/agent.ts:124-130, 152-156, 200-201` | LOW-02 open; LOW-03 partial (5.7). |
| C26 | Plugin startup failure is painted, not thrown | implemented | `plugin.ts` `startRealmSession` catch branch | None found. |

## 5. Open findings and dispositions

### 5.1 CR-01 (05-REVIEW.md:51): partial

Original finding: `createRealmHandle` bound the workspace with bare `bindRoot`, so the dispatcher could serve files outside `policy.workspaceRoots`. In advisory mode a write before `create` also proceeded with only a warning.

Current state:

- **Closed part.** The composition root now calls `bindPolicyWorkspace` before any dispatcher is constructed (`src/realm/compose.ts:59`, `:90-94`). A root outside every policy root, or an empty policy, throws `POLICY_DENIED`. `test/realm/compose.test.ts` has a test titled `CR-01: ...` that asserts this for an excluded root and for an absent policy file. That test was not run here.
- **Open part, 1.** The advisory-mode half of the finding is unchanged. Unbound writes proceed with a warning (`policy.ts:133-136`; `workspace.ts:71-74`). See 5.3.
- **Open part, 2.** The review's fix (a) asked for one shared bind helper. The current code keeps two copies, and its own comment says "both must change together" (`compose.ts:88-89`). See 5.5 and 5.2.
- **Open part, 3.** The double bind between composition and `create` (5.2).

Disposition: partial. Keep open until the bind rule has one implementation and the advisory write path is decided.

Stale statement: `05-VERIFICATION.md:88` (Limitation (f)) says `compose.ts` binds without the policy check. That is no longer true (section 7).

### 5.2 Controller rebind window: open

Chain of binds:

1. Composition binds the workspace and gives the dispatcher a `PinnedRoot` (`compose.ts:59`, `:73`).
2. The controller binds again, from a string, at `create` (`controller.ts:156`, `:376-382`). The plugin passes the configured `workspaceRoot` string from the validated runtime input (`src/omp/plugin.ts`, `startRealmSession`). Retry passes `boundRoot.realPath` (`dispatch.ts:208`).
3. `PinnedRoot` holds a path string only (`src/fs/root.ts`). Each file operation canonicalizes from that string again (`canonicalize.ts`). The dispatcher is therefore not pinned to the directory bound at construction.
4. The controller persists its own bound root in the record (`controller.ts:769-772`) and refuses a later `create` whose root differs from the record (`controller.ts:156-170`). Nothing compares the dispatcher's root with the container's root.

Analysis:

- **Plugin path.** `createRealmHandle` returns, then `create` runs its bind before its first `await` (`controller.ts:142-156`). JavaScript cannot interleave there. Another OS process can still swap a path component between the two `realpath` calls. The window is narrow, not zero.
- **Retry path.** The second bind runs at retry time (`dispatch.ts:208`), which may be long after the first.
- **Consequence [INFERENCE].** After a component swap, the container mounted at `create` can keep the old directory while later dispatcher operations follow the new one, or the reverse. This is the "double-bind TOCTOU" the review described.

Disposition: open. Required fix: bind once in composition, pass the same `PinnedRoot` (or a directory descriptor) to the controller, and have `create` accept that root rather than a string. This is not done in the current tree. Until it is, the workspace directory must not be replaced during a session. That operating rule is not written in any document reviewed.

### 5.3 Advisory-mode non-active writes: open, accepted as specified behaviour, disclosure required

Evidence:

- `decideMutation` in advisory mode returns allow-with-warning for every non-`active` state (`policy.ts:133-136`).
- The file write handler proceeds to lock probe and `lockedWrite` on the host filesystem (`workspace.ts:71-99`).
- The Omp guard returns no verdict and only notifies (`plugin.ts:274-276`).
- Non-`active` states include `unbound`, `connecting` after `toolQueueMs`, `degraded`, `error`, and `stopping` (`dispatch.ts:153-157`; `policy.ts:130-141`).
- The default mode is advisory (`policy.schema.json:8-12`).
- The spec basis is CORE-05: "in advisory mode the write proceeds with a visible warning" (`.planning/REQUIREMENTS.md`).

Precise scope of the Omp guard:

- A failed startup that fails before a handle exists leaves `session` null. The guard then blocks guarded calls regardless of mode (`plugin.ts:267-268`).
- A failure after the handle exists, such as `OPENSHELL_START_FAILED` or `PODMAN_MISSING` during `create`, leaves a non-null session in `error`. In advisory mode the guard allows guarded calls with a warning (`plugin.ts:270-276`).
- MCP and ACP have no host guard. Their write gating is entirely the controller gate, so the advisory behaviour applies to them in full.

Consequence: under the default configuration, host writes proceed outside the container, with only a notice, whenever the realm is not active and a handle exists.

Disposition: open. This is spec behaviour and not a code defect. It must be disclosed as a residual risk. The mode section of `docs/policy-reference.md` already states the effect, and this review recommends that fail-closed be the documented recommendation for any deployment that expects containment.

### 5.4 Host `write` and `edit` guard residual risk (OQ-P5-02): open

- The guard matches exact tool names `write` and `edit` (`plugin.ts:101`, `:264`). It does not check paths or content.
- The in-code residual statement names three bypass paths: launch-time tool flags, SDK sessions, and a host that ignores the hook (`plugin.ts:249-257`).
- Upstream notes say it is not documented whether `setActiveTools` removal or a `tool_call` block covers every host execution path (`docs/integration/omp.md:84-85`, `:90`). `omp.md:88-90` keeps OQ-P5-01 and OQ-P5-02 OPEN and requires fail-closed code.
- The claim that `tool_call` errors or timeouts block the call is upstream-sourced and unverified (`plugin.ts:14-15`; `omp.md:85`).
- Any host tool not named `write` or `edit` is outside the guard. That includes any shell tool and any extension or MCP tool that writes to the workspace.
- Names are compared exactly. A host that aliases tool names (for example `Write`) is not guarded.

Disposition: open. The residual is documented in code and notes but not closed. `omp.md:88` requires one test per candidate mechanism before one is chosen; those tests are not present in the reviewed tree, so enforcement cannot be claimed.

### 5.5 Workspace policy requirement: implemented, fail-closed by default; scope residual

- `policy.workspaceRoots` defaults to `[]` (`policy.schema.json:13-17`).
- Both the composition root and the controller refuse a workspace outside every policy root with `POLICY_DENIED` (`compose.ts:90-94`; `controller.ts:376-382`).
- The Omp plugin paints the error with its code and does not throw (`plugin.ts`, `startRealmSession` catch branch). `05-VERIFICATION.md:87` describes this as expected behaviour, and that remains accurate.
- Residual: roots are checked only for being absolute (`policy.ts:77-83`). A root of `/` or of a home directory is accepted, which widens both read and write scope to that tree. The code does not check breadth. `docs/policy-reference.md` documents the absolute-path rule but not a breadth warning.

Disposition: implemented. Keep the breadth residual (R7) in the policy reference.

### 5.6 Teardown behaviour: partial, five open items

**(a) Plugin shutdown is fire-and-forget. Open.**
- `endSession` unsubscribes, then calls `controller.destroy()` and `handle.close()` without awaiting either (`plugin.ts:142-153`). The comment says the host's shutdown budget does not wait (`plugin.ts:138-141`).
- If the host process exits first, the container can survive. [INFERENCE: exit timing is not observed.]
- The only startup reaper is in the daemon (`daemon.ts:427`; `reap.ts:33-37`). A plugin-only deployment has no reaper.

**(b) Replacement overlap. Open.**
- `session_start` calls `endSession()` and then starts a new handle, without awaiting the old destroy (`plugin.ts:155-158`).
- The new handle gets its own `LockTable` (`compose.ts:60`) and the same `sessionId`. The plugin passes its options through (`createRealmHandle({ ...options, policy })`, `plugin.ts` `startRealmSession`).
- The old `destroy` ends by deleting the session record (`controller.ts:347-374`, `store.delete(sessionId)`). If it completes after the new session has persisted its record, the delete removes the new record. [INFERENCE: ordering is not observed.]
- The single-owner precondition in `compose.ts` is violated for the length of the overlap.

**(c) Bound mismatch. Open, low.**
- The controller's teardown bound is 5 s (`controller.ts:38`). The adapter's container stop grace is 10 s (`session-execution.ts:38`), and its AgentOS stop deadline is 15 s (`session-execution.ts:41`).
- On expiry the controller reports `REALM_STOPPING` and stays in `stopping` (`controller.ts:745-753`).
- `withTimeout` races the promise and does not cancel it (`src/core/timeout.ts`). The adapter call keeps running, and a repeated `destroy` issues a second concurrent destroy.
- The adapter's removal treats an already-removed container as removed (`libpod-client.ts:144-146`), so the duplicate is repeated work, not data loss. [INFERENCE from source; not run.]

**(d) Cross-session reap. Open.**
- `removeAllRealmContainers` removes every realm-labelled container, with no session or state-directory scoping (`sweep.ts:25-46`).
- The reap runs only in the daemon (`daemon.ts:427`). The daemon's socket probe prevents a second daemon on one state directory (`daemon.ts:171-174`), but nothing prevents a daemon start from removing a container owned by a live plugin session.
- `reap.ts:32` accepts a second process reaping the same state directory as a residual until Phase 6. Phase 6 added the daemon probe, not coordination with plugin sessions. [INFERENCE: not exercised.]

**(e) Resolved.** Phase 4 H-01 (container stop skipped when AgentOS stop threw) and H-02 (destroy did not stop AgentOS) are fixed. The container step now runs regardless of the AgentOS result (`session-execution.ts:158-178`). Section 5.10 lists this.

### 5.7 ACP findings (05-REVIEW.md)

- **MED-01: ACP executed tool calls delivered as notifications. Fixed.** `handleLine` returns before dispatch for a notification on the tool method and emits a diagnostic (`acp/agent.ts:152-156`), matching MCP.
- **LOW-02: a non-standard id is answered with a `null` id. Open, low, parity.** For a request whose id is not a string, number, or null, ACP sends `INVALID_REQUEST` with id `null` (`acp/agent.ts:124-130`). MCP sends no reply for that case (`mcp/server.ts:209-213`). JSON-RPC 2.0 requires a `null` id when the id cannot be detected in an invalid request [INFERENCE from the spec wording; the spec was not re-fetched]. So the ACP behaviour is conformant, and the review's parity suggestion is a choice, not a requirement. Record the difference.
- **LOW-03: `setEncoding` on the caller's stream, and a log observer that can write to output. Partial.** `setEncoding` is removed; the adapter decodes locally with `StringDecoder` (`acp/agent.ts:200-201`). Diagnostics always go to stderr first (`acp/agent.ts:191-192`). An injected `log` that writes to `output` would still break the protocol. The contract is documented only (`acp/agent.ts:38-41`). It is not enforced.
- Batches are rejected by the `Array.isArray` check in `handleLine`, and only the tool method can execute (`acp/agent.ts` `handleLine`, `:152-168`).

### 5.8 MCP findings

No finding was recorded for MCP in `05-REVIEW.md`. The current source behaves as the review described: notifications take no reply and never dispatch (`mcp/server.ts:216-219`); an unusable id produces a diagnostic only (`:209-213`); replies are one JSON line (`:185-188`); `tools/call` validates `name` and `arguments` before dispatch (`:149-154`); dispatch errors map to fixed text (`:159-162`).

Residual, not findings:

- Whoever can write to the MCP server's stdin can call all six tools with the server's authority. The trust boundary is the process that launches the server. No MCP client was observed.
- The advisory write behaviour (5.3) applies in full.
- Read and list are ungated by state (R8).

### 5.9 Phase 5 plugin findings: fixed

Each item below is fixed in the current source. Evidence is the cited code.

- **HI-01: `session_shutdown` not subscribed, `close()` never called.** Fixed. Subscribed at `plugin.ts:161-163`. Its residual teardown ordering is 5.6(a).
- **HI-02: synchronous startup failure left the indicator blank.** Fixed. The catch branch of `startRealmSession` paints `error` with the catalogue code (`plugin.ts`, `startRealmSession`).
- **MED-02: budget-expiry paint overwrote a successful settle.** Fixed. A `settled` flag guards the expiry paint (`plugin.ts`, timer and settle callbacks).
- **MED-03: dedup cache written before the two `setStatus` calls.** Fixed. The cache is written after both writes (`plugin.ts:114-135`).
- **MED-04: policy file loaded twice.** Fixed. One `loadPolicyFile` call; `createRealmHandle` accepts the pre-loaded policy (`compose.ts:58`; `plugin.ts` `startRealmSession`).
- **LOW-01: `guardHostToolCall` did not refuse a non-string name.** Fixed. Refused at `plugin.ts:259-262`.
- **LOW-04: clock failure at expiry escaped the timer callback.** Fixed. `nowIso` falls back to wall time (`plugin.ts:240-246`).

### 5.10 Phase 4 items re-checked

- **H-01, H-02:** fixed (5.6(e)).
- **H-03: `#run` defaulted unmatched calls to `retry`.** Fixed. Unmatched values are refused with `SCHEMA_INVALID` (`dispatch.ts:128-146`).
- **M-01: `#retry` acted on a stale state.** Fixed. The state is re-read inside the audit window (`dispatch.ts:199-204`).
- **M-02 to M-08 and L-01 to L-09: not re-verified in this review.** Their status is unchanged from the 04-REVIEW record. Medium M-03 (egress IPv4 octets) and L-06 (no fsync on the audit result line) bear on the boundary, so R10 records them.

## 6. Residual risks

- **R1. Live behaviour is unverified.** Podman inspect field paths are provisional (`hardening.ts:1-10`). The OpenShell egress rules, the `networkMode: "none"` setting (`hardening.ts:13-30`), AgentOS stop semantics, the Omp host's hook fail-closed behaviour (`omp.md:84-90`), and MCP and ACP clients have not been observed. No claim of containment or of hardening should rest on this review alone.
- **R2. Host-side file writes.** `write`, `edit`, and the realm `write` tool act on the host filesystem. Containment depends on the mutation gate, path canonicalization, and credential checks (section 3.1). The container is not a write boundary for these tools.
- **R3. Path TOCTOU.** Resolution is segment-by-segment `lstat` plus post-open descriptor verification (`canonicalize.ts:1-8`). The root is not pinned to a descriptor. Verification depends on Linux `/proc/self/fd` and fails closed without it.
- **R4. Credential list coverage.** `CREDENTIAL_PATTERNS` (`credentials.ts`) has no entries for `**/*.pem`, `**/*.key`, `**/.npmrc`, or `**/.pypirc`. `credentialAllow` can override any denial. Coverage is a product decision; this review records it as a gap, not as a defect.
- **R5. Stale temp files.** A killed write leaves `.<name>.realm-tmp-<hex>` in the target directory (`atomic-write.ts:91`). No code path removes these. The reaper handles containers and records only (`reap.ts`). The planning notes record stale-temp cleanup as unscheduled (Q-3).
- **R6. Policy file integrity.** The check is location-only (`policy.ts:85-117`). There is no owner, mode, or content-hash check. A same-user process outside the roots can rewrite the policy.
- **R7. Policy root breadth.** Roots need only be absolute (`policy.ts:77-83`). A root of `/` or of a home directory is accepted.
- **R8. Reads are ungated by state and mode.** `read` and `list` run in any state and in either mode (`dispatch.ts:129-146`). Credential denial still applies.
- **R9. Cross-process coordination.** The lock table is in-process (`compose.ts:60`). The daemon's single-owner check is socket-based (`daemon.ts:171-174`). The plugin and the daemon on one state directory are not coordinated, and the reap is not scoped (`sweep.ts:25-46`).
- **R10. Audit durability.** The result line's durability was not re-verified. The 04-REVIEW record (L-06) states that no fsync is made on the result line.
- **R11. Dependencies.** `package.json` lists one runtime dependency, `ajv` pinned to `8.20.0`. Development dependencies are pinned to exact versions. The lockfile and advisory state were not reviewed in this file.
- **R12. Upstream host guarantees.** Tool-call fail-closed behaviour and `setActiveTools` enforcement are not proven (`omp.md:84-90`).
- **R13. Hardening verifier scope.** No capability beyond the ALL drop is verified (`hardening.ts:8-10`).
- **R14. Retry re-bind.** The retry path re-binds the root from a string at a later time (`dispatch.ts:208`). This is the rebind window in 5.2.

## 7. Documentation drift

- `.planning/phases/05-omp-plugin-mcp-and-acp-surfaces/05-REVIEW.md:51-53` (CR-01) cites `compose.ts:42` as a bare `bindRoot` with no policy check. Current `compose.ts:59` calls `bindPolicyWorkspace`.
- `.planning/phases/05-omp-plugin-mcp-and-acp-surfaces/05-VERIFICATION.md:88` (Limitation (f)) says `compose.ts` binds without the policy check. That is no longer accurate.
- `docs/policy-reference.md` cites `src/core/policy.ts:129-140` for `decideMutation`. In the current file the function starts at line 130. This is a one-line offset and does not change the statement.

These records describe code from before the current source. They should be updated when the Phase 7 documents are finalised. This review did not edit them.

## 8. Recommended actions before first release

These are recommendations from this review. None has been implemented.

1. Bind the workspace once in composition, and pass that root to the controller and the dispatcher (5.1, 5.2, R14).
2. Decide and document the default mode for containment-critical deployments, and state the advisory write behaviour in the policy reference (5.3).
3. Keep OQ-P5-02 open until the candidate mechanisms each have a test, as `omp.md:88` requires (5.4).
4. Await or serialise the old session's teardown before a replacement session starts with the same `sessionId` (5.6(b)).
5. Give plugin-only deployments a shutdown guarantee or a reaper (5.6(a), 5.6(d)).
6. Run the gated Podman 5.x suite and confirm the hardening field paths and egress behaviour before claiming RT-01 or RT-05 (R1, R13, C15, C16).
7. Record the policy root breadth expectation in the policy reference (R7).
8. Update the stale statements listed in section 7.

## 9. Explicit statement of what was not observed

No live Podman, OpenShell, AgentOS, Omp, MCP, or ACP behaviour was observed. Every finding in this file comes from reading source and repository documentation at the review date. Statements about host and client behaviour rely on repository notes that cite upstream documentation; those documents were not re-fetched, and where the notes mark a point as unverified, this file keeps it marked. No test, typecheck, lint, build, or git command was run. No source or test file was modified, and no dependency was added.

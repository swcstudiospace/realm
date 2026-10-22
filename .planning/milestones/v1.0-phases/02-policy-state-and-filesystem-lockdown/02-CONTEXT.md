# Phase 2: Policy, State, and Filesystem Lockdown - Context

**Gathered:** 2026-10-21
**Status:** Ready for planning
**Mode:** `--auto` (all gray areas auto-selected; each choice derived from `docs/specs/realm-spec.xml`, the settled user decisions, and the frozen Phase 1 contracts. Decision IDs continue from Phase 1 (D-01..D-18) so that IDs stay unique across the repo.)

<domain>
## Phase Boundary

Phase 2 delivers the no-container core and nothing that needs a container:

1. Policy loading and evaluation, the six-state machine with its event bus, and the one shared display mapping (CORE-01 to CORE-04).
2. Filesystem lockdown: canonical paths with symlink and escape rejection, race-resistant resolution, credential-path denial, advisory per-file locks, and atomic writes (FS-01 to FS-05).
3. Input gating for tools: schema validation at the boundary and the exec argv-or-shell policy gate (TOOL-01, TOOL-02).
4. The on-disk session record written before any container create (RT-07), and idempotent lifecycle operations against an in-memory fake `ExecutionService` (CORE-06).
5. Audit JSONL with redaction before append, and no host environment passed to the execution service (AUD-01, AUD-02).
6. Test-suite taxonomy and the doctor core check runner, limited to the checks Phase 2 can truthfully perform (QUAL-02, doctor core from the Phase 2 goal).

Out of this phase (see `<deferred>`): any Podman, OpenShell, AgentOS, or Anda code; the dispatcher (TOOL-03, TOOL-04); wiring of the mutation gate into tool calls (CORE-05, Phase 3); reaping and egress (RT-05, RT-08); the control socket (RT-06); the Omp, MCP, and ACP surfaces; the CLI.

</domain>

<spec_lock>
## Requirements Lock (source: `.planning/REQUIREMENTS.md` and `docs/specs/realm-spec.xml`)

Phase requirements: **CORE-01, CORE-02, CORE-03, CORE-04, CORE-06, FS-01, FS-02, FS-03, FS-04, FS-05, RT-07, TOOL-01, TOOL-02, AUD-01, AUD-02, QUAL-02** (16 IDs). Their text lives in `.planning/REQUIREMENTS.md` and is not restated here. No phase-level `*-SPEC.md` exists, so `spec_loaded = false`. The locked inputs are the spec sections named in `<canonical_refs>` and the frozen Phase 1 contracts.

</spec_lock>

<decisions>
## Implementation Decisions

### Settled inputs (from the user; not reopened in this discussion)

- **S-01:** Policy mode default is **advisory** with a visible warning. **Fail-closed** (prose: "required mode") is an opt-in per project. Host write tools (Omp built-in write and edit) are disabled only in required mode. Phase 2 implements the mode decision; it does not remove host tools (Phase 5, OMP-05).
- **S-02:** One container per session. Phase 2 has no container runtime.
- **S-03:** Advisory locks live in the daemon, keyed by canonical path. Phase 2 implements the lock table as a class that the daemon will host in Phase 6. No daemon exists in Phase 2.
- **S-04:** The control channel is a user-only Unix socket. Phase 2 records the socket path in the session record; it creates no socket (RT-06 is Phase 6).
- **S-05:** Reaping keys off the session record. Reaping itself is Phase 4 (RT-08). Phase 2 only writes the record.
- **S-06:** Host Podman is 4.9.3. Container integration stays gated. Phase 2 tests use the in-memory fake `ExecutionService` only.
- **Inherited constraints from Phase 1 (informational, not new Phase 2 decisions):** the Phase 1 decision set in `.planning/phases/01-scaffold-and-frozen-contracts/01-CONTEXT.md` remains in force in full. The points Phase 2 relies on are: the policy default is advisory and `fail-closed` is the config value for "required mode"; the 21-code catalogue, state table, and schemas are frozen; `containerId` is null until the container exists; the policy's numeric defaults are 10000 ms for `startupBudgetMs` and 2000 ms for `toolQueueMs`. [informational]

### Module ownership and layout (spec n2, amended for Phase 2)

- **D-19:** Phase 2 owns these new paths. Each file has exactly one owner (spec n2 rule). Frozen Phase 1 files (`src/core/states.ts`, `src/core/errors.ts`, `src/core/policy.schema.json`, `src/contract/*`) are extended only by adding new files beside them, never by editing their frozen tables.
  - `src/core/state-machine.ts` (behavior over `states.ts`), `src/core/events.ts` (typed bus), `src/core/status.ts` (display mapping), `src/core/policy.ts` (load, defaults, mode decision, exec gate), `src/core/ports.ts` (the `ExecutionService` interface), `src/core/timeout.ts` (`withTimeout`).
  - `src/fs/` with `root.ts`, `canonicalize.ts`, `glob.ts`, `credentials.ts`, `locks.ts`, `atomic-write.ts`, `read.ts`, `list.ts`, `write.ts` (the locked write composition). `root.ts` owns only the root binding: `bindRoot(path)` does `realpath`, checks it is a directory, and returns the canonical root object that every other fs function takes. `canonicalize.ts` owns only the walk (D-29). Splitting them keeps the bind step testable on its own.
  - `src/session/` with `paths.ts` (state directory resolution) and `store.ts` (session record persistence).
  - `src/audit/` with `redact.ts` and `log.ts`.
  - `src/lifecycle/controller.ts`. **Amendment to n2:** n2 does not name a lifecycle module. The controller composes core, session, and the port, so it cannot live in `src/core/` without a dependency cycle (session depends on core). It gets its own directory. Phase 3 extends this module with the gating of CORE-05.
  - `src/doctor/checks.ts` (check runner and report model).
  - `test/support/fake-execution.ts` (test-only in-memory `ExecutionService`). It lives under `test/`, not `src/`, so no runtime integration code sits in `src/` before its docs gate. This keeps FOUND-03's "no integration module without its note" rule intact.
  - **Reversibility:** reversible (module placement, one-file moves).

- **D-20:** Dependency direction for Phase 2: `core` imports nothing from the other modules. `fs` imports `core`. `session` imports `core`, `fs` (atomic replace for the record), and `contract` (validation of the record before write). `audit` imports `core` only (its append is `O_APPEND` on its own file, not the fs replace path). `lifecycle` imports `core`, `session`, `fs`, and `contract` (create validates the record it writes). `doctor` imports `core`, `session`, `fs`, and `contract` (the `policy-file` check validates through `validate("policy", …)`). `contract` (existing) imports `core`. `validate.ts` stays the only module that imports ajv. **Reversibility:** reversible.

### Policy file and policy engine (CORE-03)

- **D-21:** The policy file is an explicit path supplied by the caller. Phase 2 defines no default location; the CLI and host config choose it in Phase 6. A missing file means the default policy applies (advisory, no roots, shell disabled, session unbound); `doctor` reports that as a warning with the fix. An invalid file fails with `SCHEMA_INVALID` through the existing `validate("policy", …)` wrapper, and the wrapper's defaults fill in missing keys. **Reversibility:** reversible.

- **D-22:** A policy file must not reside inside any of its own `workspaceRoots`. The agent can write inside a workspace root, so a policy stored there could be rewritten by the agent it constrains. The loader rejects such a file with `POLICY_DENIED`. Every `workspaceRoots` entry must be an absolute path. The frozen policy schema does not enforce this (its items are plain strings, D-15 is frozen), so the loader runs a code check after `validate("policy", …)` succeeds and returns a `SchemaInvalidError` (the same shape the wrapper returns, code `SCHEMA_INVALID`) for a relative entry. Each root is canonicalized with `realpath` when the workspace is bound. A root that cannot be canonicalized fails the bind with `POLICY_DENIED`. **Reversibility:** costly. The policy file location rule is part of the user-authored format, so changing it touches every policy file's documented location (Phase 7 policy reference).

- **D-23:** Mode decision function (pure, no wiring): `decideMutation(policy, state)` returns one of
  - `allow` when state is `active`;
  - `allow-with-warning` when mode is `advisory` and state is not `active`. The warning text names the state and says the write proceeds under advisory policy;
  - `deny` when mode is `fail-closed` and state is not `active`. The code is `REALM_UNBOUND` for `unbound`, `REALM_STOPPING` for `stopping`, and `REALM_NOT_ACTIVE` for `connecting`, `degraded`, and `error`.

  Phase 3 wires this into the lifecycle gating (CORE-05). Phase 2 only provides and tests the decision (`test/core/fail-closed.test.ts`, spec n5 mitigation). Spec q2 default holds: required mode gates writes only, not reads. **Reversibility:** reversible.

- **D-24:** Exec policy gate (TOOL-02): `checkExecPolicy(policy, exec)`. An `argv` form is allowed. A `shell` form is rejected with `SHELL_NOT_ALLOWED` unless `policy.shellEnabled` is `true`. The gate runs only on input that has already passed `validate("tools", …)`. Phase 2 never executes a command; the gate is the only exec behavior Phase 2 provides. **Reversibility:** reversible.

### State machine, events, and display (CORE-01, CORE-02, CORE-04)

- **D-25:** `RealmStateMachine` (in `src/core/state-machine.ts`) holds the current state, the last reason, and the last-transition time (ISO 8601 UTC). `transition(to, reason)` calls the frozen `checkTransition`. A disallowed transition, including a self-transition, throws `RealmError` with `REALM_INVALID_TRANSITION` and changes nothing: state, reason, time, and events are untouched. An allowed transition commits the state and then publishes the event. The machine starts in `unbound` with reason `no workspace`. **Reversibility:** reversible.

- **D-26:** Typed event bus (`src/core/events.ts`). Every committed transition publishes `{ type: "state.transition", sessionId, from, to, reason, at }`. Delivery is synchronous and in subscription order. A listener that throws does not stop delivery to the remaining listeners; after all listeners have run, the first listener error is rethrown to the publisher. Nothing is swallowed. **Reversibility:** reversible.

- **D-27:** Display mapping (CORE-02) is one exported pure function, `displayStatus(snapshot)` in `src/core/status.ts`, used by the CLI, the plugin, and the tests. It returns exactly one label from the two frozen strings `"realm active"` and `"realm disconnected"`, plus `degraded: boolean`, `reason`, and `lastTransitionAt`:
  - `unbound` → disconnected, reason `no workspace`
  - `connecting` → disconnected, reason `connecting`
  - `active` → active
  - `degraded` → **active** with `degraded: true` (the spec's "degraded marker" is a flag, not a third label; CORE-02 wins over the spec's wording)
  - `error` → disconnected, reason is the error code
  - `stopping` → disconnected, reason `stopping` (the spec's "status reflects stopping" is carried by the reason; CORE-02 allows only two labels)

  Color and text cues belong to the plugin (Phase 5). **Reversibility:** costly. Every host and the CLI import this mapping, and the two label strings are user-visible.

### Timeouts (QUAL-01 enforcement from Phase 2 onward, per D-08)

- **D-28:** `withTimeout(promise, ms, code)` in `src/core/timeout.ts` races a promise against a timer and clears the timer on settle. On expiry it rejects with `RealmError(code)`. Every call into `ExecutionService` is wrapped:
  - `create`, `start`, and `probe` use `policy.startupBudgetMs` for the whole startup. On expiry the code is `STARTUP_BUDGET_EXCEEDED` and the state moves to `error`.
  - `stop` and `destroy` use a fixed teardown bound of 5000 ms, named once in `src/lifecycle/controller.ts`. The catalogue has no teardown-timeout code. On expiry the operation returns `REALM_STOPPING`, the session stays in `stopping`, and a repeated `destroy` resumes teardown. **Open question Q-1:** a dedicated teardown-timeout code would be a catalogue change (costly). Phase 2 does not add one; Phase 3 decides.
  - `toolQueueMs` is not used in Phase 2; it belongs to the dispatcher (Phase 4, TOOL-04).

  **Reversibility:** reversible for the constant; the mapping to `REALM_STOPPING` is reversible too.

### Filesystem lockdown (FS-01, FS-02, FS-03)

- **D-29:** Workspace roots are the only writable or readable area. A path is a workspace-relative string that the schema has already validated (non-empty, not absolute, no `..` segment). Canonicalization (`src/fs/canonicalize.ts`) works as follows:
  1. Start at the pinned, canonical root.
  2. Walk the path one segment at a time. For each segment, `lstat` the candidate.
  3. If the candidate is a symlink, read its target and resolve it relative to the current directory (absolute targets are allowed). Push the target's segments back onto the walk. Limit the number of symlink hops to 40; exceeding the limit is `PATH_ESCAPE`.
  4. A resolved path must stay inside the root, checked on path segments (not string prefix). Leaving the root is `PATH_ESCAPE`.
  5. A missing final segment is a result, not an error: canonicalization returns `{ status: "absent" }` with the verified parent. Reads of absent files return a not-found result. Writes may create the final segment. A missing intermediate segment is `absent` for the whole path.

  Symlinks that resolve inside the root are followed. Symlinks that resolve outside it are rejected. **Reversibility:** costly. It is the core security contract that every later module calls.

- **D-30:** Race resistance (FS-02). Node 22 exposes no `openat`, so components cannot be opened relative to a pinned directory descriptor. The implementation instead does resolve-then-verify:
  - Open the final real path with `O_NOFOLLOW`.
  - Call `fstat` on the descriptor and compare its `dev` and `ino` with `lstat` of the real path.
  - Read `/proc/self/fd/<fd>` with `readlink` and require it to equal the real path.

  Any mismatch closes the descriptor and fails with `PATH_ESCAPE`. The verification after open catches a symlink swapped in between check and open, which is the scenario FS-02 names. The same check applies to the temp file and the parent directory during writes.

  **Residual risk (recorded, not hidden):** a rename that targets a parent directory swapped between verification and `rename(2)` is narrowed by the parent re-check immediately before rename, but it cannot be closed with path-based Node APIs. This is an open question for the Phase 7 security review (Q-2). A native or `openat`-capable helper would close it; that is a Rust-shim question for Phase 3 and is not assumed here.

  Linux only. If `/proc/self/fd` is unavailable, every path operation fails closed with `PATH_ESCAPE` (the path cannot be verified, so it is treated as escaping). The path tests (`test/fs/canonicalize.test.ts`, `test/fs/toctou.test.ts`) must not skip on such a host: a path-verification failure is a real failure and a silent skip would hide it. macOS is V2-01. **Reversibility:** costly (the resolution strategy is used by every fs primitive).

- **D-31:** Credential denial (FS-03). The denied patterns are a single constant in `src/fs/credentials.ts`, matched against the canonical relative path (after symlink resolution, so a symlink into `~/.ssh` is denied). The initial list is:
  - `.env`, `.env.*`, `**/.env`, `**/.env.*`
  - `**/.ssh/**`
  - `**/id_rsa`, `**/id_rsa.*`, `**/id_dsa`, `**/id_ecdsa`, `**/id_ed25519`, `**/id_ed25519.*`
  - `**/.aws/credentials`, `**/.aws/config`
  - `**/.config/gcloud/**`, `**/.azure/**`, `**/.kube/config`, `**/.docker/config.json`
  - `**/.netrc`, `**/.git-credentials`, `**/.gnupg/**`

  `policy.credentialAllow` globs override a match. Denial is checked after `PATH_ESCAPE`, so an escaping path is always reported as an escape. The same check applies to reads and writes. A denied path returns `CREDENTIAL_PATH_DENIED`. Phase 7's policy reference documents this list. **Reversibility:** reversible (a constant list); the patterns are user-visible, so changes are documented.

- **D-32:** Glob matching (`src/fs/glob.ts`) is a small local matcher, not a new dependency. It supports `*` (within a segment), `?` (one character), and `**` (zero or more whole segments). No `path.matchesGlob` (experimental in Node 22). No new npm package is added in Phase 2 (D-07 verification not needed). **Reversibility:** reversible.

### Locks and atomic writes (FS-04, FS-05)

- **D-33:** Advisory lock table (`src/fs/locks.ts`). Keyed by canonical real path, in memory. `acquire(realPath, owner)` returns a handle, or fails with `LOCK_CONFLICT` if another owner holds the path. Re-acquire by the same owner is idempotent and returns the same handle. `release(handle)` is idempotent. Locks are not persisted: the daemon owns them and they vanish with it. Session destroy releases every lock held for that session. **Reversibility:** reversible (in-process today; the daemon hosts it in Phase 6).

- **D-34:** Locked write (`src/fs/write.ts`), with this order:
  1. Canonicalize the target in write mode. The parent must exist and be inside the root. A symlink at the target is `PATH_ESCAPE`.
  2. Run the credential check.
  3. Acquire the lock. Failure is `LOCK_CONFLICT` and the file is unchanged.
  4. Observe the current content hash, or absence.
  5. If `ifMatchSha256` is given and differs from the observed hash (including "absent"), fail with `LOCK_CONFLICT`.
  6. Run the atomic replace (D-35) with the observed hash as the expected prior state.
  7. Release the lock in a `finally`.

  A content change by a non-cooperating writer between step 4 and the rename is caught by the re-check in D-35 and reported as `LOCK_CONFLICT`. The file is unchanged. **Reversibility:** reversible.

- **D-35:** Atomic replace (FS-05, `src/fs/atomic-write.ts`). Steps:
  1. Create a temp file in the same directory with `O_CREAT | O_EXCL | O_NOFOLLOW`, named `.<basename>.realm-tmp-<random hex>`, mode 0600 (replaced by the target's existing mode if it has one).
  2. Verify the temp file's real path (D-30).
  3. Write, then `fsync` the file.
  4. Re-hash the target. If it no longer matches the expected prior hash, fail with `LOCK_CONFLICT`.
  5. `rename` the temp file over the target.
  6. `fsync` the parent directory.

  Any failure before step 5 removes the temp file and throws `WRITE_NOT_ATOMIC`. Failure at step 5 is also `WRITE_NOT_ATOMIC`; the original file remains intact because `rename` is atomic. Failure in step 6 after a successful rename is also reported as `WRITE_NOT_ATOMIC`, with a reason note in the audit entry, because durability is not confirmed. The fault-injection seam for tests is an optional `stageHook(stage)` parameter, called at `after-temp-write`, `after-fsync`, and `before-rename`. Production callers do not pass it. A temp file left by a killed process is not cleaned up in Phase 2 (Q-3).

  **Reversibility:** reversible.

- **D-36:** Read and list (`src/fs/read.ts`, `src/fs/list.ts`). Read returns `{ status: "found", content, sha256, truncated }` or `{ status: "absent" }`. It reads at most `maxBytes` and sets `truncated` when more exists. It rejects non-regular files with `PATH_ESCAPE`. It applies the credential check. List returns entries with `name`, `kind` (`file`, `dir`, `symlink`, `other`), and `target` for symlinks. Symlinks are reported, never followed. The list caps its output at 1000 entries and sets `truncated`. **Reversibility:** reversible.

### Session record and lifecycle (RT-07, CORE-06)

- **D-37:** Session record persistence (`src/session/store.ts`). Records live at `<stateDir>/sessions/<sessionId>.json`. The state directory defaults to `$XDG_STATE_HOME/realm`, falling back to `$HOME/.local/state/realm`. The directory is created with mode 0700 and each record with mode 0600. The store is a function of a `stateDir` argument, so tests use temporary directories. Writes use the atomic replace from D-35 without a lock (the realm owns these files). Fields are exactly the frozen schema: `realmId` (random UUID), `sessionId`, `workspaceRoot` (canonical), `state`, `controlSocketPath` (`<stateDir>/run/control.sock`, recorded and not created), and `containerId` (`null` until created). No token, secret, or environment field is ever written. A session with no bound workspace has no record; the in-memory machine starts `unbound` and the first `create` binds it. **Reversibility:** one-way (schema D-14; the record is on disk, so a shape change needs a migration).

- **D-38:** Lifecycle controller (`src/lifecycle/controller.ts`). Operations: `create`, `start`, `probe`, `attach`, `detach`, `stop`, `destroy`. Semantics:
  - **create** binds the workspace (policy check, then canonical root), moves `unbound` → `connecting`, and writes the record with `containerId: null` **before** calling `ExecutionService.create` (RT-07). It then stores the returned `containerId` in the record. The `ExecutionService.create` call passes the session id as an idempotency key, so a crash after create and before the record update leaves nothing a retry cannot reattach to. If the record already exists with a `containerId`, no second create happens. Then `start` runs. Success moves `connecting` → `active`. Failure moves `connecting` → `error`. From `error`, `create` retries through `error` → `connecting`.
  - **start** is valid in `connecting` and in `error` (via `create`). Startup is bounded by `policy.startupBudgetMs` (D-28).
  - **probe** in `active` or `degraded` calls `ExecutionService.probe`. A healthy result changes nothing. An unhealthy result moves `active` → `error` with reason `probe failed`. Phase 2 never produces `degraded`; Phase 3 (Anda, ANDA-03) does. Probe in any other state returns the snapshot.
  - **attach** and **detach** add and remove a host attachment id in an in-memory set. They change no state and no record. Both are idempotent.
  - **stop** moves `connecting`, `active`, `degraded`, or `error` → `stopping`, calls `ExecutionService.stop`, then moves `stopping` → `unbound`. Stopping an `unbound` or `stopping` session is a no-op that returns the current snapshot.
  - **destroy** stops the session if needed, calls `ExecutionService.destroy`, releases the session's locks (D-33), and deletes the record. Destroying an absent session is a no-op.

  Every operation returns the current snapshot (state, reason, last transition time). Repeating any operation returns the same state and does not duplicate resources. The controller never calls the state machine with a transition it has not checked. **Reversibility:** reversible for behavior; the operation set itself is a contract the Phase 3 gating and Phase 6 CLI will use, so the names are costly to change.

- **D-39:** `ExecutionService` port (`src/core/ports.ts`). Interface only, named per the spec n3 default:
  ```
  create(req: { idempotencyKey: string; workspaceRoot: string }) → { containerId: string }
  start(containerId: string) → void
  probe(containerId: string) → "healthy" | "unhealthy"
  stop(containerId: string) → void
  destroy(containerId: string) → void
  ```
  The port has **no environment field**, so no host environment can reach it by type (AUD-02). The fake (`test/support/fake-execution.ts`) keeps an in-memory resource table keyed by idempotency key, counts calls, and can be told to delay or fail a named operation so timeouts and failures are testable. **Reversibility:** costly (Phase 3 implements it for Podman/OpenShell/AgentOS and the lifecycle depends on its shape).

### Tool input gate (TOOL-01)

- **D-40:** Every tool input is checked by `validate("tools", raw)` before anything else in Phase 2 touches it. The schema is frozen (D-13). Phase 2 adds tests that show the gate rejects unknown keys at each nesting level, unknown tool names, both exec forms together, a shell form with no `script`, absolute and `..` paths, and an over-large `maxBytes`. The dispatcher that makes this the only entry point for every call is Phase 4 (TOOL-03). **Reversibility:** reversible.

### Audit and secrets (AUD-01, AUD-02)

- **D-41:** Redaction (`src/audit/redact.ts`) is applied to every value before it is serialized. It works in two layers.
  - Keys matching `/token|secret|password|passwd|api[_-]?key|authorization|cookie|credential|private[_-]?key/i` have their values replaced with `"[REDACTED]"`.
  - String values have these patterns replaced: `Bearer <token>`; PEM private key blocks; `AKIA[0-9A-Z]{16}`; `gh[pousr]_` tokens of 20 or more characters; `sk-` tokens of 20 or more characters; and `NAME=value` where `NAME` contains `TOKEN`, `SECRET`, `PASSWORD`, or `KEY`.

  Redaction never throws on unusual values; it recurses through arrays and objects with a depth limit that fails closed by replacing the deeper subtree with `"[REDACTED]"`. **Reversibility:** reversible (the patterns are a list).

- **D-42:** Audit entries (`src/audit/log.ts`) are appended to `<stateDir>/audit/<sessionId>.jsonl`, one JSON object per line, with mode 0600, appended with `O_APPEND`. An entry records `at`, `sessionId`, `tool`, `outcome` (`ok` or an error code), `path` (canonical relative path, when there is one), `bytes`, and `sha256`. A write entry never includes file content. An exec entry records `argv` after redaction, or for shell form only `script` length and `sha256`. Redaction runs before the append (spec n5). **Reversibility:** one-way (a persisted log format; Phase 7 review consumes it).

- **D-43:** No host environment reaches the sandbox by default (AUD-02). This is enforced by the port (D-39) having no environment field, and tested by a lifecycle test that sets a sentinel environment variable in the test process and asserts that the fake receives no env, and that no session record or audit line contains the sentinel. No secret is written to the repository, an image, or a log. **Reversibility:** reversible.

### Doctor core (Phase 2 goal; CLI-03 is Phase 6)

- **D-44:** `src/doctor/checks.ts` is a check runner. Each check returns `{ id, status: "pass" | "warn" | "fail", detail, fix }`. The Phase 2 checks are:
  - `policy-file`: absent → warn (defaults in effect); invalid → fail (fix names the schema problem, not the value); policy inside a workspace root → fail (fix: move it).
  - `state-dir`: missing → warn (fix: created on first use); wrong mode → fail (fix: `chmod 700`).
  - `session-store`: not writable → fail (fix: check ownership). The check uses `access(W_OK)` and does not write a probe file.

  The Podman, OpenShell, AgentOS, Anda, and control-channel items are **not** in Phase 2. They register into the same runner in Phase 3 and Phase 6, so Phase 2 never reports a pass or a fail for a component it cannot inspect. **Reversibility:** reversible.

### Test suite taxonomy (QUAL-02)

- **D-45:** Test layout mirrors `src/`: every `src/<dir>/<file>.ts` has its test at `test/<dir>/<file>.test.ts`, except where a file below says otherwise. Every Phase 2 requirement ID maps to at least one named test file. The complete list:
  - `test/core/state-machine.test.ts` (CORE-01: every allowed edge accepted, every disallowed pair including self-transitions rejected with `REALM_INVALID_TRANSITION`, state unchanged after rejection)
  - `test/core/status.test.ts` (CORE-02: one of two labels per state; the `degraded` flag; reason and time carried through)
  - `test/core/events.test.ts` (CORE-04: every committed transition publishes once with from, to, reason, at; listener-failure delivery per D-26)
  - `test/core/policy.test.ts` (CORE-03: defaults, `SCHEMA_INVALID` on unknown keys, relative root rejected, policy file inside a root rejected with `POLICY_DENIED`, missing file yields defaults)
  - `test/core/fail-closed.test.ts` (CORE-03 and the n5 silent-fallback mitigation: `decideMutation` for every state under both modes)
  - `test/core/timeout.test.ts` (QUAL-01: `withTimeout` resolves, rejects with the given code on expiry, clears its timer)
  - `test/fs/glob.test.ts` (D-32 matcher cases, including `**` at root and in the middle)
  - `test/fs/canonicalize.test.ts` (FS-01: relative resolution, symlink inside root followed, symlink outside root `PATH_ESCAPE`, hop limit, absent final segment returned as a result)
  - `test/fs/toctou.test.ts` (FS-02: a symlink swapped in between resolve and open is rejected with `PATH_ESCAPE`, driven by an injected hook at the resolve-to-open boundary)
  - `test/fs/deny-credentials.test.ts` (FS-03: each denied class denied for read and for write; `credentialAllow` permits; escape reported before credential)
  - `test/fs/lock.test.ts` (FS-04: conflict returns `LOCK_CONFLICT` and leaves the file unchanged; same-owner idempotence; release; a second owner reaching the same file through a symlink conflicts; session destroy releases)
  - `test/fs/atomic-write.test.ts` (FS-05: stage hooks `after-temp-write`, `after-fsync`, `before-rename` each leave the original byte-identical and no `.realm-tmp-` file behind; `WRITE_NOT_ATOMIC` reported; success path replaces content)
  - `test/fs/write.test.ts` (D-34 order: `ifMatchSha256` mismatch and absence both `LOCK_CONFLICT`; hash re-check before rename yields `LOCK_CONFLICT` with the file unchanged)
  - `test/fs/read-list.test.ts` (D-36: truncation flag, non-regular rejection, symlink reported not followed, 1000-entry cap with `truncated`)
  - `test/session/store.test.ts` (RT-07: record written with `containerId: null`; fields exactly the frozen schema; modes 0600 and 0700; no secret field; atomic replace on update)
  - `test/audit/redaction.test.ts` (AUD-01: key-based and value-based redaction; depth limit fails closed; spec n5 credential leakage test)
  - `test/audit/log.test.ts` (AUD-01: one JSON object per line; redaction before append; no file content in write entries; mode 0600)
  - `test/contract/tool-input-gate.test.ts` (TOOL-01: cases of D-40 not already covered by `test/contract/tools.schema.test.ts`; read that file first and add only missing cases)
  - `test/contract/exec-policy.test.ts` (TOOL-02: argv allowed; shell rejected with `SHELL_NOT_ALLOWED` unless `shellEnabled`; shell allowed when enabled; gate never executes)
  - `test/lifecycle/controller.test.ts` (D-38 transitions and the RT-07 ordering: the fake sees the record with `containerId: null` at the moment of `create`; startup budget overrun gives `STARTUP_BUDGET_EXCEEDED` and `error`; teardown timeout gives `REALM_STOPPING`)
  - `test/lifecycle/idempotent.test.ts` (CORE-06: every operation repeated returns the same snapshot with no duplicate fake resources)
  - `test/lifecycle/no-host-env.test.ts` (AUD-02: sentinel environment value never reaches the fake, the record, or the audit line; port sample request has no environment key)
  - `test/doctor/checks.test.ts` (D-44: pass, warn, and fail outcomes of each of the three checks, each with its fix)
  - `test/quality/suite-taxonomy.test.ts` (QUAL-02: the test directories `core`, `fs`, `session`, `audit`, `lifecycle`, `contract`, `doctor`, `integration` each hold at least one `*.test.ts`; `test/integration/*` files declare a Podman skip reason)

  Category mapping for the taxonomy check: unit = `core`, `fs`, `session`, `audit`, `lifecycle`, `doctor`; state-machine = `core/state-machine`; path and symlink = `fs/canonicalize`, `fs/toctou`; schema rejection = `contract`; audit redaction = `audit/redaction`; integration = `integration` (existing, Podman-gated, skips with a stated reason; no new integration test in Phase 2).

  `test/support/fake-execution.ts` is a helper, not a test file; it is exercised by the lifecycle tests above.

  **MCP and ACP contract tests are not written in Phase 2.** QUAL-02 names them, but no MCP or ACP surface exists until Phase 5, and ROADMAP Phase 5 success criterion 5 already requires those contract tests. Phase 2 covers the transport-neutral part, the tool schema contract, through `tool-input-gate.test.ts`. **Open question Q-4:** the orchestrator should confirm that QUAL-02's MCP and ACP clause moves to Phase 5 (the traceability table maps it to Phase 2 only through the other categories).

### Claude's Discretion

- Exact helper names, internal file splits inside each module, and whether `atomic-write.ts` and `write.ts` stay separate.
- Test helper layout under `test/support/`.
- The number of plans and their wave grouping, subject to the wave rules and dependency order in `<canonical_refs>`.
- The random-id source (`crypto.randomUUID` and `crypto.randomBytes` are both built-in and acceptable).
- Exact text of warning and reason strings beyond the frozen catalogue reasons, as long as the two display labels stay exact.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Product spec (source of truth; do not modify)
- `docs/specs/realm-spec.xml` §REALM_SANDBOX/FILESYSTEM_LOCKDOWN (workspace root allowlist, canonicalization, credential deny, advisory locks, atomic writes)
- `docs/specs/realm-spec.xml` §REALM_SANDBOX/LIFECYCLE (idempotent operations; session record before create)
- `docs/specs/realm-spec.xml` §STATES (six states and their status meaning)
- `docs/specs/realm-spec.xml` §SECURITY_AND_VALIDATION (schema before sandbox; argv over shell; audit redaction; no injected secrets)
- `docs/specs/realm-spec.xml` §GRACEFUL_DEGRADATION (POLICY_MODE, FAILURE_CASES, "never hang")
- `docs/specs/realm-spec.xml` §GRAPH_OF_THOUGHT n2 (module map and ownership), n3 (defaults: advisory mode, `ExecutionService` interface), n4 (control channel, granularity, locks in daemon), n5 (failure modes and the test files they name), n6 (frozen contracts)

### Planning state
- `.planning/REQUIREMENTS.md` (CORE-01..04, CORE-06, FS-01..05, RT-07, TOOL-01..02, AUD-01..02, QUAL-02 text)
- `.planning/ROADMAP.md` Phase 2 section (goal, five success criteria)
- `.planning/PROJECT.md` (constraints: ESM, strict, no host paths, no telemetry, no unverified dependencies)
- `.planning/STATE.md` (blockers carried into this phase)

### Prior phase (frozen; read before touching related code)
- `.planning/phases/01-scaffold-and-frozen-contracts/01-CONTEXT.md` (D-01..D-18)
- `.planning/phases/01-scaffold-and-frozen-contracts/01-VERIFICATION.md` (what Phase 1 verified as frozen)
- `.planning/phases/01-scaffold-and-frozen-contracts/SKELETON.md` (slice plan: Phase 2 is "policy, state machine, filesystem lockdown, and contract tests against an in-memory fake")

### Integration notes (Phase 1 outputs; read for the constraints they record)
- `docs/integration/podman.md` (rootless and hardening facts; Phase 3 consumes, Phase 2 must not contradict)
- `docs/integration/omp.md` (spec q4: whether host write tools can be removed; open for Phase 5)
- `docs/integration/hosts.md` (Node constraint behind `engines`)
- `docs/integration/openshell.md` and `docs/integration/agentos.md` (`ExecutionService` default per D-18)

### Frozen code (extend beside, never edit the frozen tables)
- `src/core/states.ts` (six states; 13 allowed edges; `checkTransition`)
- `src/core/errors.ts` (21-code catalogue; `RealmError`; `makeRealmError`)
- `src/core/policy.schema.json` (policy keys and defaults)
- `src/contract/tools.schema.json` (six tools; exec argv or shell form; workspace-relative paths)
- `src/contract/session-record.schema.json` (record fields; no secrets)
- `src/contract/validate.ts` (`validate("policy" | "tools" | "sessionRecord", input)`; returns `SCHEMA_INVALID`, never throws)

No other external specs or ADRs are referenced. `.planning/codebase/` does not exist for this repo, so the codebase scout used the source files above directly.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/core/states.ts`: `STATES`, `ALLOWED_TRANSITIONS`, `checkTransition`. The state machine (D-25) wraps it; it does not redefine the table.
- `src/core/errors.ts`: `RealmError`, `makeRealmError`, `ERROR_CATALOGUE`. Every new failure uses an existing code. No code is added.
- `src/contract/validate.ts`: `validate()` for `policy`, `tools`, and `sessionRecord`; `sessionRecordStateEnum()`; `SchemaInvalidError`.
- `test/core/states.test.ts`, `test/contract/*.test.ts`: existing `node:test` style and fixtures to mirror.

### Established Patterns
- Frozen values are wrapped in `Object.freeze` with entries frozen too (`states.ts`, `errors.ts`). New constant tables follow the same pattern (credential patterns, redaction patterns).
- Every error is a `RealmError` with a catalogue code, a reason, and `retryable`. No silent catches; `no-empty` lint rule is enforced.
- Tests use `node:test` and run from `dist/test/` after `tsc`. No suppression comments of any kind (D-08).
- ESM with `.js` extensions in relative imports (`NodeNext`). `verbatimModuleSyntax` is on: type-only imports use `import type`.
- `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess` are on: optional fields must be typed as `T | undefined` deliberately.

### Integration Points
- `src/core/ports.ts` is the seam Phase 3 implements (Podman, OpenShell, AgentOS).
- `src/lifecycle/controller.ts` is where Phase 3 adds CORE-05 gating and Phase 4 adds the dispatcher call path.
- `src/fs/locks.ts` is hosted by the daemon in Phase 6 (S-03).
- `src/doctor/checks.ts` is where Phase 3 and Phase 6 register their checks.
- The Phase 2 test fake is the only `ExecutionService` implementation until Phase 3.

</code_context>

<specifics>
## Specific Ideas

- The phrase "realm active" / "realm disconnected" must come from one constant pair in `src/core/status.ts` and nowhere else.
- Symlink tests should build the fixture under a temporary directory with a real symlink, not a mock, because the guarantee is about the filesystem.
- The atomic-write failure test should inject the failure through `stageHook`, then assert with a byte-for-byte comparison that the original file is unchanged and that no `.realm-tmp-` file is left behind.
- The lock test should run two owners against one canonical path, including one reached through a symlink, and assert that the second owner gets `LOCK_CONFLICT` and the file is unchanged.

No further specific references. The spec and the decisions above carry the direction.

</specifics>

<deferred>
## Deferred Ideas

Ideas that came up or are implied by the spec, which belong in later phases. Not lost; not acted on here.

- Podman, OpenShell, AgentOS, and Anda runtime code and gated integration tests: Phase 3 (RT-01..04, ANDA-01..04, RT-09).
- Wiring the mutation gate into tool calls (CORE-05): Phase 3.
- `degraded` produced by the Anda bridge: Phase 3 (ANDA-03).
- Dispatcher, call timeouts, and the queue wait (TOOL-03, TOOL-04): Phase 4. `toolQueueMs` is first used there.
- Orphan reaping by label and the reap plan over stale session records (RT-08); egress default-deny and IPv6 disable (RT-05): Phase 4.
- Control socket creation (RT-06), the daemon that hosts the lock table (S-03), and the CLI (CLI-01..04, including the full doctor list): Phase 6.
- Host write-tool removal in required mode (spec q4, OMP-05): Phase 5.
- MCP and ACP transports and their contract tests (TOOL-05, QUAL-02's MCP and ACP clause): Phase 5.
- Policy reference documenting every key and the credential list (QUAL-03): Phase 7.
- Stale `.realm-tmp-*` cleanup after a killed write: not scheduled. Candidate for the Phase 4 reaper (Q-3).
- macOS support through Podman machine (V2-01); per-workspace granularity (V2-02); per-subagent isolation (V2-03): out of v1 or later.
- A `schemaVersion` field on the session record: not added (Phase 1 discretion; no migration need found).
- A native or `openat`-capable helper that closes the rename-window residual risk (Q-2): decided with the Phase 3 Anda and shim question, not here.

### Open questions carried forward (not decided here)
- **Q-1:** Teardown timeout code. The catalogue has none; Phase 2 maps to `REALM_STOPPING`. Phase 3 decides whether a code is needed (costly change if added).
- **Q-2:** Rename-window residual risk for parent-directory swaps (D-30). Phase 7 security review owns the verdict.
- **Q-3:** Cleanup of temp files left by killed processes. Phase 4 reaper candidate.
- **Q-4:** QUAL-02's MCP and ACP contract clause moves to Phase 5. The orchestrator confirms before Phase 5 planning.

### Reviewed Todos (not folded)
- None. `todo.match-phase 2` returned zero todos.

</deferred>

---

*Phase: 02-policy-state-and-filesystem-lockdown*
*Context gathered: 2026-10-21*

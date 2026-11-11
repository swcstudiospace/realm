# Project session and recovery contract

Contract: `realm-project-session`, revision **1.0.0**, internal implementation contract.
Task: `Trealm31-project-runtime-contract`, attempt 2. Correlation: `ut-mvvowl70-29165019`.
Recorded: 2026-10-31. Owner: A03. Consumers: daemon, CLI/Omp/MCP/ACP, session storage, compute driver, lifecycle, hardening and integration-test owners.

This specifies the accepted D5 cutover recorded before dependent code in PR36 and [runtime-decision.md](runtime-decision.md). It is **not** an OpenAPI publication, a change to the vendored OpenShell protocol, an implemented runtime API, or a verification receipt. The TypeScript shapes below are normative interfaces to implement, not existing exports. Existing symbols are named explicitly in the source ledger. No build, test, formatter, gate, service operation or commit was run for this document. No phase is complete on the strength of this contract.

## 1. Scope and authority

MULTI-01..06 and RES-01..05 require separate project mounts, not just separate daemon map entries. D5 already authorizes per-project sessions, selective adoption and session-owned scratch; it is not waiting for another approval. This document resolves the naming, binding, selection, admission and recovery details of that decision. It does not amend the product spec, error catalogue, policy schema or session-record schema. It introduces no dependency or infrastructure.

The current source still has the fixed `SESSION_ID = "daemon"`, one daemon handle, global driver root exclusion and destructive startup sweeps. Those are migration callsites, not compatible alternatives. Historical live results in `openshell.md` remain results of that older implementation.

### Source ledger

| Source | Supported fact and contract use |
| --- | --- |
| `src/fs/root.ts`: `PinnedRoot`, `bindWorkspaceUnderPolicy`, `verifyPinnedAt`, `isInsideRoot` | Canonical path plus device/inode pin; eligibility includes root equality; subsequent use checks exact directory identity. |
| `src/runtime/openshell.ts`: `realmSandboxName`, `sessionOfRealmSandbox`, `GATEWAY_SANDBOX_NAME_MAX_LENGTH`, ownership constants, `buildCreateArgv` | `realm-` prefix, gateway limit 19, real OpenShell ownership labels and CLI name carrier. Current create argv does not transmit a host workspace. |
| `src/runtime/driver/proto/compute_driver.proto`: `DriverSandbox` fields 1, 2, 6; `EnsureWorkspaceRequest` | Gateway id, sandbox name and tenancy workspace are separate fields; workspace is not a host path. |
| Pinned upstream `driver_sandbox_from_public` | Public sandbox name reaches `DriverSandbox.name` unchanged; tenancy reaches `DriverSandbox.workspace` separately. See the pinned source links in [openshell.md](openshell.md#project-binding-over-the-pinned-openshell-protocol). |
| `src/runtime/config.ts`: `RuntimeConfig`, `runtimeRootsOf`; `src/core/policy.schema.json` | Existing roots/image and policy roots; no aggregate resource knob. Driver/daemon must load the same config. |
| `src/runtime/hardening.ts`: `HARDENING_PROFILE`, `verifyInspect`; `src/runtime/create-evidence.ts`, `src/runtime/kernel-caps.ts` | Existing 1 GiB/2 CPU per-container limits, three-bind verifier and full create evidence. New admission and scratch must not weaken them. |
| `src/daemon/channel.ts`: `ControlRequest`, `CONTROL_TIMEOUT_MS`, `MAX_CONTROL_LINE_BYTES`; `src/daemon/client.ts`: `connectDaemon`, `DaemonClient` | Bounded NDJSON transport; each call opens a new connection, so socket attachment cannot select a session. |
| `src/session/store.ts`: `SessionStore`; `src/contract/session-record.schema.json` | Per-id load/save/list/delete already exist; records hold canonical `workspaceRoot` and optional `containerId`, but no durable device/inode pin. |
| `src/runtime/driver/sandbox-binding.ts`: `sandboxBindingOf` | One shared derivation for mount creation and both verifiers; today it returns the global workspace. |
| `src/runtime/driver/lifecycle.ts`: `startupSweep`, `create`; `src/session/reap.ts`: `reapStartup` | Driver and daemon both independently destroy survivors today. Both must adopt the new ownership protocol. |
| `src/runtime/libpod-routes.ts`: `LIBPOD_ROUTES`; `src/runtime/libpod-client.ts`: `LibpodClient` | Container inspect/list/stop/start/remove/create only. No volume, pause/freeze or whole-tree snapshot API. |
| `src/fs/atomic-write.ts`: `atomicWriteFile`, `WriteNotAtomicError` | Descriptor-pinned per-file replacement and durability/error handling, not atomic tree restore. |

## 2. Canonical workspace identity (MULTI-02)

1. The caller sends an absolute project path. The daemon binds it with `bindWorkspaceUnderPolicy(policy.workspaceRoots, requested)` and also checks containment in the canonical `RuntimeConfig.workspaceRoot` served by this driver. The configured driver root is an enclosing eligibility boundary, **not** the mount source for all projects.
2. Root equality is eligible as well as descendants, matching `isInsideRoot`; symlink aliases resolve to one canonical path. Do not normalize Unicode, lowercase paths or hash the caller's spelling. A path outside either boundary is `POLICY_DENIED` before OpenShell/libpod/policy-file effects.
3. Identity is SHA-256 of the UTF-8 bytes of `PinnedRoot.realPath`, without a terminator. Store the entire lowercase 64-hex digest. `sessionId` is its **first 13 lowercase hex characters**. Sandbox name is exactly `realm-<sessionId>` (19 characters); scratch name is `realm-scratch-<sessionId>`. No random retry, suffix, legacy `daemon` alias or second hash encoding.
4. A truncated hash is a name, not authority. Before reuse or create, compare the complete canonical path, full digest and directory pin against the immutable binding and any session record. Different paths sharing a short id refuse with `SANDBOX_NAME_IN_USE`; do not overwrite or tear down the other project's container. A same-path pin replacement refuses with `POLICY_DENIED`; no automatic rebinding after rename/replacement.
5. Re-run `verifyPinnedAt` before dispatch/create/adopt/checkpoint and after relevant awaits before effects. A descendant check cannot replace it. Reject non-safe device/inode numbers rather than persisting rounded values, consistent with the current numeric `PinnedRoot` interface.
6. Concurrent sessions must have disjoint workspace trees. Equality reuses one session. An ancestor/descendant overlap with another live, creating, adopted or unconfirmed-removal session refuses with `LOCK_CONFLICT`. Otherwise the parent session could read/write the child's supposedly private project. Nested projects remain individually eligible when no conflicting session owns their ancestor/descendant.

```ts
interface ProjectIdentity {
  readonly sessionId: string;       // exactly /^[a-f0-9]{13}$/
  readonly workspaceSha256: string; // exactly /^[a-f0-9]{64}$/
  readonly workspace: PinnedRoot;   // existing type; exact realPath/dev/ino
}
interface ProjectSelection {
  readonly workspaceRoot: string;  // absolute canonical project path, not a gateway tenancy token
}
```

The daemon derives identity; no raw short id supplied by a tool or host is enough to bind a project.

## 3. Immutable owned binding reaching the actual driver (MULTI-04)

### Durable binding format and trust boundary

The daemon persists one internal binding before it asks OpenShell to create anything:

`<stateDir>/runtime/workspaces/<sessionId>.json`

```ts
interface ProjectBindingV1 {
  readonly version: 1;
  readonly sessionId: string;
  readonly workspaceSha256: string;
  readonly workspaceRoot: string; // canonical absolute path
  readonly dev: number;          // safe integer, exact pin
  readonly ino: number;          // safe integer, exact pin
}
```

This is an internal binding record, not an added field on the frozen session-record or policy schema. D5's narrowly necessary reason: `SessionRecord` has a path but lacks the durable pin needed by a separate driver process to reject a replaced directory and an ambiguous short id. Without this record the name cannot authorize a host mount. No secret, environment, argv, arbitrary mount option or executable content is allowed. The object has exactly the six keys above.

The state owner creates/checks the parent chain as owned real directories (private runtime/workspaces directories at 0700), opens the binding no-follow, requires an owned regular file at 0600 and bounded input (4 KiB), validates the closed object and recomputes its identity. Pin the state root/parents; reject symlinks and path overlap with any writable project. Daemon and driver independently validate the configured enclosing root, binding path, digest, session id and current exact pin. The daemon additionally checks the policy. The driver accepts **only** this daemon-owned binding, never a path from an RPC template.

Creation uses existing durable file-write conventions under the exclusive stateDir owner: absent-only write, fsync file and parent before create; an existing identical validated binding is idempotent, a conflicting one is never replaced. This does not pretend that `atomicWriteFile` alone is a cross-process compare-and-swap: the daemon lock is still required. The driver is a reader, not a second binding writer. Keep a binding while any create, recorded container, unconfirmed removal or scratch teardown references it. Delete/fsync only after proven teardown and record cleanup. Repeated creation during teardown refuses with `REALM_STOPPING`.

This is the existing local single-account trust boundary. Directory permissions prevent another uid or a sandbox (no binding-directory mount) from selecting host paths; they do not defend against a hostile process with the daemon's own uid. Do not describe the descriptor as signed or tamper-proof.

### Supported name carrier, not driver-config escape

```text
approved project pin → durable ProjectBindingV1
  → OpenShell sandbox create --name realm-<sessionId> ...
  → gateway public sandbox metadata.name
  → DriverSandbox.name = realm-<sessionId>
  → exact name parse + owned binding lookup + pin verification
  → sandboxBindingOf(selected project, state root, secret root)
  → DriverLifecycle.create → actual /workspace bind source
```

`DriverSandbox.workspace` stays the gateway's authorized tenancy identifier. `EnsureWorkspace` may validate that token and the configured enclosing root but cannot choose a project: its request contains no sandbox name. `DeleteWorkspace` remains refused and never deletes a host project. `DriverSandbox.id` remains the gateway's stable id, not the path hash; retain and verify its association in the driver registry. Reject the same project name in a different gateway tenancy or a second gateway id while its original runtime is held. One driver/config/stateDir pair owns this namespace.

For this contract the driver's accepted project sandbox name is **exactly** `realm-` plus 13 lowercase hex characters. Remove the `x`/`realm-x` alternate-name acceptance for project creation; never resolve a generic gateway name to `config.workspaceRoot`. Missing/malformed/foreign binding is a refusal, not a fallback. Driver `ValidateSandboxCreate` validates the binding too but reserves no resources and writes nothing; `CreateSandbox` revalidates and reserves before effects. Both keep existing launch-authentication, image, resource, namespace and environment checks.

Keep `platform_config` and `driver_config` empty. Do not add `--driver-config-json`, enable upstream `allow_driver_config`, or treat upstream parsing of that flag as permission to use it. No proto or gateway change is necessary to carry the name. The new binding resolver must be used by create, post-create verification, session verification and startup adoption; a daemon-only map fails MULTI-04.

### Internal resolver boundary

```ts
interface ProjectBindingResolver {
  resolveSandbox(sandboxName: string): ProjectIdentity; // reads/validates owned record, no writes
}
```

`resolveSandbox` fails with an existing catalogue error: `SCHEMA_INVALID` for malformed/unsafe owned state; `POLICY_DENIED` for a moved/replaced/out-of-bound project; `SANDBOX_NAME_IN_USE` for conflicting identity. Driver RPC binding continues translating these through its existing status/refusal machinery without logging host path values. Validating the binding never grants an arbitrary new mount.

## 4. Session selection and lifecycle (MULTI-03)

Keep the NDJSON outer envelope `{ id, method, params }`, 1 MiB cap, reply id/error/causeCode rules and existing per-method bounds. Change all session-sensitive params together; no unselected legacy overload remains:

| Method | Exact params for the cutover | Result/ownership |
| --- | --- | --- |
| `up` | `{ workspaceRoot }` | Derive/bind/reuse that project; return selected status. |
| `status` | `{ workspaceRoot }` | Selected status; do not create a sandbox. An eligible absent session is `unbound`. |
| `tool` | `{ workspaceRoot, tool }` | Dispatch the unchanged frozen ToolCall to this project's dispatcher only. |
| `down` | `{ workspaceRoot }` | Tear down only this project; return selected unbound status after proven cleanup. Never close the daemon listener. |
| `metrics` | `{ workspaceRoot }` | Selected per-session metrics, not another project's counters. |
| `doctor` | `{ workspaceRoot }` | Existing host prerequisites plus the selected project's runtime checks. |
| `ping` | no params | Daemon readiness only, `{ ready: true }` after maintenance; no selected lifecycle or creation. Used by `ensureDaemon`, not as session status. |
| `shutdown` | no params | Explicit daemon-wide teardown after draining all projects; no use by a host detach. Reply `{ stopped: true }` only after all selected downs succeeded. |

`ping` and `shutdown` are new **internal** control methods to implement, not current supported RPCs. `ping` uses the existing status timeout; `shutdown` is bounded by the aggregate teardown budget (two sequential downs, at most two existing down budgets). Unknown/missing/excess selector keys refuse with `SCHEMA_INVALID`. The daemon canonicalizes and verifies every selection; it never falls back to a recent project, connection-local state or the configured parent. Status replies add `sessionId` and canonical `workspaceRoot` outside the frozen `StateSnapshot`; the client validates that they match its bound project. The startup notice remains a separate reply field. An unbound status uses the derived identity, without inventing a container or persistent record.

```ts
// Replacement internal client face; method results use existing DaemonStatus,
// ToolOutcome and MetricsSnapshot, with the selected status fields described above.
connectDaemon(socketPath: string, selection: ProjectSelection): DaemonClient;
// DaemonClient retains status(), call(tool), metrics(), close(); up() no longer
// accepts a different workspace. Add down() and doctor() for that selection.
```

Construct one immutable selected client per attachment. Omp session switch constructs a new client and fences outstanding old-session completions; MCP/ACP bind their launch workspace for their full lifetime. CLI `up/status/down/metrics/doctor/snapshot/restore` select the explicit `--workspace` or absolute current working directory once, then bind it; no process-wide mutable current-project variable. All raw `sendRequest` callers (including signal shutdown), ensure probes and fake/real transport consumers migrate in the same joined cutover. Host/session close only closes the client; it never sends project down or daemon shutdown.

The daemon registry owns one controller, dispatcher, lock table, lifecycle/status snapshot, health loop and up correlation per identity. Concurrent same-project up joins the same create; a down or generation change fences late completions and cannot publish them into a replacement handle. Different projects cannot share path locks, audit ids or tool outcomes. `shutdown`/SIGTERM/SIGINT stop admissions, drain/fence calls, down each project within bounds and close the listener; failed cleanup is a nonzero error, not a successful shutdown. A daemon crash is handled by startup reconciliation, not an implicit down.

Per-session audit remains `<stateDir>/audit/<sessionId>.jsonl`. Reconciliation appends to each original log. Attribute workspace temp cleanup to the project that owns the root, and shared state-root maintenance to structured daemon diagnostics, not a synthetic `daemon` project audit. Never append a project audit event with another project's id. Retain historical `daemon.jsonl` as history, not an alias or merged chain.

## 5. Aggregate admission using the existing resource profile (MULTI-06)

The existing runtime/policy loaders have **no** aggregate resource setting. This contract does not invent one. The cutover chooses a fixed **two-session ceiling per driver/config/stateDir owner**, the minimum concurrent capacity required by MULTI-05. Centralize this ceiling with the existing hardening configuration; do not add environment variables or operator schema keys. This is a new admission rule to implement, not a cap enforced by today's global root lock.

Derive every commitment from `HARDENING_PROFILE` rather than a second numeric resource profile:

- `sessionLimit = 2`;
- `memoryLimitBytes = sessionLimit * HARDENING_PROFILE.memoryBytes` = 2 GiB;
- `cpuLimitNano = sessionLimit * HARDENING_PROFILE.nanoCpus` = 4,000,000,000 (4 CPU cores).

These are upper bounds on the **sum of container commitments**, not a promise of dedicated physical CPU, aggregate cgroup enforcement, available host RAM or headroom for gateway/supervisors. Existing configured image/roots and per-container 1 GiB/2 CPU enforcement remain unchanged. The driver's admission acknowledgement still describes gateway policy agreement, not host capacity. A future operator-adjustable limit is a separate requirement, not an undisclosed config amendment here.

```ts
interface AdmissionLedger {
  reserve(sessionId: string): void;       // synchronous, before the first await/effect
  adopt(sessionId: string, containerId: string): void; // seed before opening the gate
  confirmRemoved(sessionId: string): void; // only after proving absence
}
```

Ledger operations are idempotent for the same held session, not double accounting. Count creating/reserved, active, adopted, stopping and unconfirmed-removal containers; also enforce disjoint project pins. Refuse a third commitment with `REALM_INVALID_TRANSITION` before any create writes or libpod mutation. Validation-only requests do not reserve. A failed create releases only when it cannot have created a container or the owned container's absence is proven; a timeout is not proof. Failed down retains commitment/binding. Restart rebuilds the ledger from verified observations, never just the empty in-memory map. Unknown/unreadable surviving ownership fails the startup gate. If verified survivors exceed the new ceiling, abort serving without deleting a valid survivor merely to make the count fit; operator must resolve the overcommit. Both daemon and driver must avoid duplicate reservation, with the driver authoritative for admission across simultaneous requests.

## 6. Survivor verification and hydration (RES-01/02)

### Actual ownership and narrow legacy migration

Discovery uses the current OpenShell managed marker `openshell.managed=true`, `openshell.ai/sandbox-name=realm-<id>` and workload role `openshell.ai/isolation-role=sandbox`. Include Realm-prefixed containers carrying the historical `io.realm.managed`/`io.realm.session` ownership form in reconciliation so they cannot be missed. Names alone do not authorize destruction of an unrelated container. Inspect role/ownership and record/name/id agreement; a foreign name collision fails closed. Record the amendment to the old io.realm-only definition, rather than requiring labels the current create never writes.

Preserve all valid canonical-id records and bindings. An old fixed-id `daemon` record/container cannot be silently assigned a new hash identity: neither gateway identity nor mount/pin evidence proves that conversion. During the one-time cutover, classify it as non-adoptable with `REALM_INVALID_TRANSITION`, stop/remove only the proven-owned old sandbox, prove absence, then delete/fsync its legacy record. Keep project bytes and its old audit file; the next selected up creates the canonical identity. Do not delete an old record before its runtime's fate is known. Current containers lacking the new exact scratch mount also fail the amended verifier, not an exception to it. This is the recorded D5 migration reason; no record-schema edit or compatibility alias is introduced.

### One verifier, non-destructive verdict

```ts
type SurvivorVerdict =
  | { readonly outcome: "adopt"; readonly identity: ProjectIdentity;
      readonly containerId: string }
  | { readonly outcome: "remove"; readonly containerId: string;
      readonly cause: "no-record" | ErrorCode };
```

Verification does not delete. Callers own cleanup. Create-time verification and adoption use the same full hardening/evidence path: exact container id from the session record; canonical name and ownership; running; configured image; pin/mount match; OCI evidence; live `/proc` and kernel capabilities; namespace, network, privilege, seccomp, tmpfs and amended four-mount rules. Stale `state: active`, matching labels or readable inspect alone is insufficient. Re-read runtime identity after asynchronous evidence acquisition; if it changed, do not adopt a replacement by name. Missing/invalid runtime channel, state or launch artifacts, gateway id/tenancy mismatch, or inability to re-establish supervision is a verifier refusal with the concrete existing catalogue code.

Adoption preserves the same container id and scratch and performs **no** container create/start. Driver reconstruction must validate retained launch/descriptor/auth/channel material against that runtime and gateway, reconstruct registry/tenancy/id mappings and establish exactly one live supervisor. Bootstrap and TLS leaf key files may legitimately be consumed during initial handshake; do not require them to reappear or fabricate replacement keys to claim adoption. If the supported supervisor reconnect path cannot be established from retained artifacts, that survivor is not proven adoptable: remove/prove, log its concrete failure, and retain RES-05 as unverified. Source contains no general reconnect guarantee.

Daemon hydration is a separate operation: compose the project's pin/locks/audit/dispatcher/controller from the verified adoption, restore container id and active status, reattach/probe the existing AgentOS workload and start one health loop without invoking create or a duplicate runner. A retained record with an unbound controller is not hydration. Any supervisor/AgentOS readiness failure must be classified before serving.

### Startup order and bounded gate

1. Claim exclusive process/socket ownership; a live owner still gives `LOCK_CONFLICT`. Socket presence is not readiness.
2. Close the admission/serving gate. Load records and bindings without deleting artifacts. Driver and daemon serialize ownership reconciliation through the same stateDir ownership protocol (driver reconciles its runtimes; daemon waits for driver readiness before inspecting/hydrating). Neither may sweep secrets behind the other's verification.
3. Under the existing bounded reap, classify every owned container. Verify/adopt eligible survivors; remove other owned containers and prove their absence by authoritative listing. Failure or timeout proving removal aborts startup. Keep failed-removal commitments.
4. Delete/fsync only records without an adopted runtime after removal proof; log exact `recordsDeleted`. Reconcile scratch after surviving records are known. Keep only the validated artifacts belonging to adopted sessions; remove unreferenced state/secrets with existing safe-path checks. No wholesale `removeAllSecrets` on a selective-adoption startup.
5. Run bounded temp sweep, then per-log audit reconciliation, retaining existing incomplete-maintenance reporting. Reconcile accounting, reconstruct driver supervision and hydrate daemon handles before opening the serving gate. The raw verifier/adoption inventory may exist before composition; no serving controller/dispatcher may exist before ownership is settled.
6. Emit one startup diagnostic and expose readiness. Existing `containerIds`/`containersRemoved` remain removal fields; add explicit adopted ids/count and removal cause entries during the implementation cutover, rather than overloading them. The current `StartupReport` has not yet acquired these adoption fields.

No-orphan invariant: before serving, every discovered Realm-owned container is verified/adopted or proven absent, and every remaining session scratch volume belongs to an adopted record. Unreadable discovery, unverifiable removal or an unknown survivor aborts startup. Partial bounded temp/audit work retains the existing report semantics; it is not permission to skip runtime ownership checks.

Diagnostics use the common logger (`ts`, level, event, redaction, code). Keep the exact numeric deleted-record count as well as adopted/removed ids and causes. The destructive-startup notice is retained for the daemon lifetime only when `containersRemoved > 0 || recordsDeleted > 0`; an adoption-only restart produces no notice. An id list or notice alone is not proof that the record count was logged. Lifecycle diagnostics stay on inherited `daemon.log` stderr, separate from rotating `requests.log` (current logging cutover is documented in `runtime-decision.md`).

## 7. Scratch lifecycle and mount contract (RES-03)

Use the owned driver/libpod create path, not an undocumented upstream extra-mount flag:

- Named volume: exactly `realm-scratch-<sessionId>`, labels `io.realm.managed=true` and `io.realm.session=<sessionId>`; exclusive session ownership. Create-or-inspect must reject wrong labels/ownership, not relabel or adopt a foreign volume.
- Container mount list: exactly the existing selected-project bind rw `/workspace`, state bind ro `/realm-state`, channel bind rw `/run/openshell/channel`, **plus** this one named volume rw `/scratch`. Keep existing tmpfs and all other hardening restrictions. No tmpfs/anonymous-volume substitution, host-directory fallback, additional mount or cross-session scratch sharing.
- `buildPolicyDocument` grants `/scratch` read/write in the same cutover as mount creation and verifier changes. Never enable a mount-only or policy-only intermediate runtime.
- Extend the closed typed libpod client/route table with bounded named-volume create, inspect, list and remove operations before wiring them. Those operations are **not currently present**; actual versioned route/response shapes and inspect `Type`, `Name`, destination and RW evidence need parent live proof. Do not bypass the route table with arbitrary HTTP or CLI fallbacks.
- Verified adoption preserves this exact volume and data. Down removes/proves the sandbox first, then removes/proves its volume, then releases the commitment/binding and deletes/fsyncs the session record. A volume-in-use or missing removal proof is `CLEANUP_FAILED`, not successful down. Never delete another project's volume.
- Startup removes owned scratch with no adopted surviving record, after container/record classification; prove by listing and log `no-record`. Failed create can leave scratch, so reconcile it even when no session record was saved. Wrong-session/extra mount fails the shared hardening verifier. Unproven volume cleanup aborts serving; no silent orphan skip.

OQ-P19-01 is an owned-driver volume implementation/live-attachment question, not a requirement for a new OpenShell CLI mount option. OQ-P19-02 remains the real Podman inspect-shape proof. No volume live run is claimed here.

## 8. Checkpoint interface and unresolved physical prerequisite (RES-04)

### Supported-source conclusion

The closed libpod API has stop/start but no pause/freeze/checkpoint, OpenShell driver `StartSandbox`/`StopSandbox` are refused, `StateSnapshot` is lifecycle metadata, and `atomicWriteFile` replaces one file rather than a tree. None proves a running workload can be frozen, a reflink is available, or a whole-tree restore is atomic. Do not stop/start the sandbox runtime behind the gateway and call that a supported checkpoint barrier: runtime channel/bootstrap and workload reconnection must be proved too.

The parent reported a metadata-only `findmnt --json --target <host-home> --output TARGET,FSTYPE,OPTIONS` result: target `/`, filesystem `ext4`, options `rw,relatime,discard,errors=remount-ro,commit=30`, exit 0. This is supplied parent observation, **not** an operation probe or evidence of copy/reflink/snapshot/quiescence guarantees.

Select ordinary byte-copy as the implementation **candidate** available without new dependencies or a nonexistent runtime snapshot RPC. The final mechanism decision remains gated on the parent's actual target-filesystem operation and quiescence spike, as RES-04 requires. Do not label the mechanism selected by an executed spike, or implement/advertise successful checkpoint guarantees, before that receipt. No new approval of D5 is needed; the missing input is physical evidence, not policy permission.

### Exact proposed command/service boundary

```text
realm snapshot [--workspace <absolute-project>]
realm restore <snapshotId> [--workspace <absolute-project>]
```

Snapshot id is 32 lowercase hex characters allocated by the service with exclusive-create/collision refusal, never a caller filesystem path. The CLI never reads workspace bytes itself; it selects the project and calls the daemon. Add internal control methods only in the checkpoint implementation wave: `snapshot` params `{ workspaceRoot }`; `restore` params `{ workspaceRoot, snapshotId }`. Successful snapshot result is `{ sessionId, snapshotId }`; successful restore result is `{ sessionId, snapshotId, restored: true }`. Keep existing CLI 0 success / 1 operational refusal / 2 usage error conventions and catalogue errors. These commands/methods do **not** exist in current source.

```ts
interface WorkspaceCheckpoint {
  snapshot(selection: ProjectSelection): Promise<{
    readonly sessionId: string; readonly snapshotId: string;
  }>;
  restore(selection: ProjectSelection, snapshotId: string): Promise<{
    readonly sessionId: string; readonly snapshotId: string; readonly restored: true;
  }>;
}
```

Use `<stateDir>/checkpoints/<sessionId>/<snapshotId>/` with private owned parents, outside every writable workspace/scratch/state/channel mount. Internal metadata binds version, full project digest/path/pin, snapshot id, mechanism and a complete sorted relative-path manifest. Each regular-file entry records byte length, SHA-256 and ordinary permission bits; directory entries record ordinary permission bits including empty directories. Reject absolute/dot/parent/duplicate manifest paths, symlinks, sockets, devices, FIFOs, external hardlinks and privilege bits before destructive restore. Treat file contents as bytes, not JSON/text. Do not capture secret/channel files or scratch. Unsupported entry types fail explicitly; do not silently skip them. The filesystem spike must establish the chosen handling of hardlinks, modes and durability on the actual workspace/checkpoint devices before implementation claims coverage. ACLs/xattrs, owner ids, mtimes, sparse allocation and inode identity are not promised by byte-for-byte content restoration; if the spike requires them for correctness, update this internal contract before dependent code.

Quiescence is mandatory across snapshot and restore. Acquire the project's mutation/lifecycle gate, drain outstanding Realm calls and prevent new creates/tools/down for that identity. Path locks alone do not stop an arbitrary in-container or host writer. The implementable conservative candidate is **offline workspace operations**: project down completed with container absence proven, plus no other observed owned runtime bind overlaps the project and exclusive host-writer access established by the parent probe. That intentionally ends scratch according to down semantics; it is not a transparent active-session snapshot. No existing API establishes exclusive host-writer access. If the parent cannot prove an enforceable consistency boundary, return `REALM_INVALID_TRANSITION` before reading/copying/changing the tree; do not return a best-effort snapshot. Source-only pre/post hashes are not proof against ABA or transient writers.

Under the established barrier, stage and validate a complete byte copy, pin-check again, sync staged files/directories and only then publish the snapshot metadata. Bound input/storage by a preflight manifest and available filesystem space, abort on capacity/I/O errors without publishing success, and make deadlines cancellation-aware so work cannot continue mutating after a timeout. The parent spike must supply practical entry/byte/deadline bounds before implementation; do not borrow the 1 MiB control-message cap as a filesystem quota. No background unbounded copy hidden behind a timed-out promise.

Restore verifies the snapshot identity, complete manifest/digests and all target paths **before the first workspace mutation**. Stage the complete desired tree and an original-content rollback image outside the writable workspace, with capacity for both, then restore entries under the pinned root: recreate deleted files/directories, replace changed bytes/modes and remove extra paths. Do not rename away or replace the root directory: that breaks the accepted pin and any bind mounts. A series of per-entry replacements is not an atomic whole-tree swap. Keep a durable operation journal before the first mutation so a crash or failed rollback blocks project up and further checkpoint operations until recovery restores a validated complete state. Report `WRITE_NOT_ATOMIC` for unconfirmed durability/partial restore and retain journal/rollback material; `restored: true` requires full manifest comparison and completed syncs. Invalid/corrupt/foreign snapshots and preflight failures leave the workspace unchanged. Mid-restore failures must not be described as preserving the whole tree unless rollback and its syncs actually completed. Journal recovery is mandatory implementation scope, not a TODO to bypass. No atomic restore or crash-durable whole-tree claim is made by this design.

### Parent spike exit conditions

Main alone, after all owners join, must record actual copy/readback of binary/empty/nested files, modes and empty directories on the target workspace and checkpoint devices; extra/deleted-file restore; storage/permission failure; symlink/pin swap refusal; cancellation cleanup and interrupted-restore recovery; and a writer that tries to mutate while the barrier is held (including an in-container writer if active support is proposed). Record exact commands, paths/devices, mechanism, side effects and exit statuses. A filesystem-type observation is insufficient. Reflink/filesystem snapshot may replace the copy candidate only when their actual supported semantics and recovery boundary are recorded; there is no silent fallback. Keep RES-04/05 unverified until both this prerequisite and implemented CLI roundtrip pass.

## 9. Requirement disposition and parent proof

All commands below are **prospective parent execution only**, after the relevant dependent implementation joins; none was run here. Use the repository's existing commands `npm run typecheck`, `npm run lint`, `npm test`, `npm run check:docs`, `npm run check:gates`, `npm run build`; then, under the exclusive provisioned real-stack lock and documented environment, `node --test dist/test/integration/production-driver.test.js`. Existing tests must be migrated/extended by their signed owners; their filenames are not proof that these cases already exist.

| Requirement | Contract disposition | Runtime/evidence disposition; required consumer proof |
| --- | --- | --- |
| MULTI-01 | IMPLEMENTED in the accepted decision plus this identity/selection contract | Decision exists; not a runtime pass. Parent doc/chronology review. |
| MULTI-02 | IMPLEMENTED design, sections 2–3 | PARTIAL primitives (`bindWorkspaceUnderPolicy`, `verifyPinnedAt`, per-id store); session identity/bind routing STUB_OR_MISSING. Unit: aliases, equality/nesting eligibility, overlap refusal, outside-root no effects, forced 13-char collision, exact pin replacement. Parent `npm test`. |
| MULTI-03 | IMPLEMENTED design, section 4 | STUB_OR_MISSING multiplexing; per-id storage/locks exist. Unit/transport: immutable selected clients, per-session audit/status/metrics/locks, down A leaves B and socket usable, detach does not down, signal shutdown and late-completion fences. Parent `npm test`. |
| MULTI-04 | IMPLEMENTED design, section 3; supported upstream name carrier | STUB_OR_MISSING owned binding resolver and selected driver mount. Driver/argv tests must exercise actual name → binding → create spec/verifier, forged binding and wrong tenancy/id refusal. Parent `npm test` plus real inspected A/B mount sources. |
| MULTI-05 | IMPLEMENTED acceptance recipe | UNVERIFIABLE here: real A/B same-name distinct bytes, A write absent in B, down A leaves B active, exact ids/mounts/audits. Parent production suite after its owner authors the case; no historical one-root pass substitutes. |
| MULTI-06 | IMPLEMENTED design, section 5 | STUB_OR_MISSING aggregate ledger. Unit race: two reservations pass, third fails before effects, adopted sessions consume slots, failed removal retains commitment, proven down releases one; preserve per-container caps. Parent `npm test` plus real admission/isolation scenario. |
| RES-01 | IMPLEMENTED accepted decision and label/migration/order alignment, sections 6–7 | Decision is not adoption runtime. Parent doc review and current-source tests. |
| RES-02 | IMPLEMENTED design, section 6 | STUB_OR_MISSING selective reap/hydration/reconnect. Unit all verifier failures/no record/inspection failure/failed proving listing, exact before-serving order; real daemon and driver restart with same ids/no duplicate runtime/supervisor and per-session health. Parent unit/production suite. |
| RES-03 | IMPLEMENTED design, section 7 | STUB_OR_MISSING typed volume API/mount/policy/verifier/cleanup. Unit wrong type/name/session/extra mount, foreign volume refusal and cleanup failure; real scratch marker survives restart, down removes only A volume after A sandbox, listing proves absence. Parent unit/production suite. |
| RES-04 | PARTIAL design: exact service/CLI and consistency/recovery contract; mechanism candidate not spike-selected | STUB_OR_MISSING checkpoint implementation; physical/quiescence prerequisite UNVERIFIABLE. Parent actual spike first, then authored checkpoint/CLI tests and real byte manifest roundtrip including extras/deletes/failure recovery. No capability claim from ext4 metadata. |
| RES-05 | IMPLEMENTED live scenario specification | UNVERIFIABLE until current two-project restart, rejected/no-record runtime removal, scratch lifetime and snapshot roundtrip all execute. Historical destroy-on-start receipts are contrary behavior, not evidence of adoption. |

## 10. Cutover/dependency boundary

Implement canonical identity + immutable binding + selected transport first; then join daemon registry/composition/controller/client/surface and actual driver resolver/admission callsites as one coherent cutover. Session record schemas and vendored protos stay unchanged. Adopt/scratch then requires the shared verifier, both startup owners, validated runtime artifacts/supervisor and AgentOS reconnection, libpod route/client/spec, exact mount verifier/policy and reporting consumers together. Checkpoint code follows the parent's operation/quiescence spike and must include CLI/control/gate/journal recovery, not just a standalone copy helper.

This three-document task owns no product/test code. Additional caller/test allocations belong to A01 in the original DAG; this contract neither allocates new tasks nor edits planning records. All implementation and all parent evidence above remain to be supplied by those owners. No merge, release, publication or milestone closure is authorized.

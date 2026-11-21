# Data models — Realm v3.0 phases 12, 13, 14, 16, 17, 18, 19, 20

**Task:** `Tc8fd-data` · **Correlation:** `c8fd136c-b9a0-459e-bc27-e2c578d77a08`
Design record only; no code or executed migration. Storage is file-based JSON/JSONL under `<stateDir>/` (see `README.md` conventions). All entities are 3NF-equivalent by construction: one record per identity, no repeated groups, references by id (`sessionId`, `correlationId`, `checkpointId`, `containerId`) rather than embedded copies.

## 0. Entity-relationship summary

```
ProjectWorkspace 1───* SessionSandbox *───1 SessionRecord
                        │        │
                        │        ├────* AuditLine (per sessionId, hash-chained) ──1 AuditAnchor
                        │        ├────1 CheckpointManifest *──* ManifestEntry
                        │        ├────1 ScratchVolume
                        │        ├────1 RunnerRecord
                        │        └────* OmpToolRegistration
                        └────* AdoptionRecord / ReapRecord
HarnessRun *──* HarnessCaseResult        SpikeEvidence 1──1 OmpEnforcementFinding
GateRun *──* QualityEvidence             CoverageFloor *──* CoverageMeasurement
MutationRun *──* QualityEvidence         ReleaseArtifact 1──* Attestation
ReleaseArtifact 1──0..1 RollbackRecord   ChangelogEntry *──0..1 RemovedFeature
MilestoneAudit *──* RequirementDisposition LinearIssueLink 1──1 PhaseRecord / ShipRecord
```

No entity references another across a partition boundary except by `sessionId` / `correlationId` / phase id, so lanes (blueprint §5) share no mutable state.

## 1. Phase 12 — Harness and spike (HARN-01..04, OMPX-01)

### `HarnessRun` (evidence record, retained with the repo test evidence, not in stateDir)
| Field | Type | Rule |
|---|---|---|
| `runId` | string | uuid, unique |
| `correlationId` | string | joins daemon/audit lines for the run |
| `ompVersion` | string | exactly 1 version string recorded (HARN-01) |
| `startedAt` / `endedAt` | RFC3339 | `endedAt ≥ startedAt` |
| `profile` | enum `isolated` | isolated Omp profile, loopback stub only |
| `outcome` | enum `pass`, `fail`, `skip-cold`, `skip-missing-prereq` | cold / missing-prerequisite are named skips, never passes |
| `allowlistPorts` | int[] | ⊆ {11434, 8080, 1234} plus stub; 9931 only if the HARN-03 owner ruling admits it (ADR-0007) |
| `externalConnects`, `dnsOffenders`, `totalOffenders` | int ≥ 0 | warm pass requires all three = 0 |

### `HarnessCaseResult` (1 per case, FK `runId`)
Cases C1, C1b, C2, C3, C4, C4b (AC-1). Fields: `caseId`, `mode` (`advisory`/`fail-closed`), `daemonReachability`, `warningShownEveryInvocation` (bool, advisory-inactive only), `hostFilesCreated` (int; 0 on refusal), `errorCode` (catalogue code, e.g. `REALM_NOT_ACTIVE`, or null). Invariant: fail-closed + inactive ⇒ `hostFilesCreated = 0` and `errorCode = REALM_NOT_ACTIVE`.

### `SpikeEvidence` / `OmpEnforcementFinding` (OMPX-01)
One spike record per Omp version: `version`, three answers (`registerToolReachesModel`, `setActiveToolsRemovesWriteEditBash`, `registerFileWriteFallbackRedirectsWrite`) each `yes/no/unknown` + short evidence note, and closure state for OQ-P5-01 / OQ-P5-02 (`closed`/`restated`). Product claims (Phase 16) may assert only what a finding marks `yes`; `unknown` ⇒ guard-only wording (D3). Retention: kept with `docs/integration/omp.md` history; superseded by a newer version record, never edited in place.

## 2. Phase 13 — Quality ratchet (QR-01..08)

### `GateRun` (1 per gate per CI run; the evidence behind ShipRecord)
`runId`, `correlationId`, `gate` (enum `typecheck, lint, test, build, check:docs, check:gates, check:pack, check:mcp, audit, pack-smoke, coverage, mutation`), `exitCode` (int), `below` (bool, coverage raised-floor), `damagedArchiveDefect` (string|null, names the 1 missing file for QR-03). Idempotency: keyed by `(runId, gate)`; re-running a gate overwrites its own row only.

### `CoverageFloor` / `CoverageMeasurement`
`directory` ∈ {`src/fs`, `src/core`, `src/tools`}, `floorPct`, `measuredPct`, `below` = `measuredPct < floorPct`. Floors ratchet upward only; a raised-floor run exits 1 with BELOW for exactly the raised directory (AC-7).

### `MutationRun`
`scope` ∈ {`src/fs`, `src/core/policy.ts`, `src/audit/redact.ts`}, `schedule` (cron, non-blocking), `killed`, `survived`. Frozen catalogue unchanged by this phase (QR-06): no error-code field is writable here.

### `PropertyEvidence` (QR-07)
`target` ∈ {canonicalizer, policy-parser}, `runs` (fast-check, fixed seed), `failuresOnBroken`, `failuresOnRestored` (0 required). A deliberately broken canonicalizer must yield ≥1 failure (AC-9).

## 3. Phase 14 — Crash safety (CRASH-01..07)

### `AtomicWriteOp` (transient, journaled via the temp file itself)
Stages `after-temp-write → after-fsync → before-rename → after-recheck` (AC-10). Invariant per stage: original bytes intact, exactly 1 orphan temp file of the exact sweep pattern. The sweep removes only regular files matching that 1 exact-name pattern — never a symlink, never any other dotfile — and writes 1 audit line per removal (CRASH-05).

### `ReconciliationLine` (audit line subtype, CRASH-02)
A stranded admission (admission line with no result line) gets exactly 1 reconciliation line on the next daemon start, marked `reconciliation`; the second start appends 0. Idempotency is by construction: reconciliation scans for admissions lacking a result *and* lacking a reconciliation line, so a re-run is a no-op (row-count reconcile: before + 0 = after on second start).

### `ReapRecord` (CRASH-03/04)
`sessionId`, `containerId` (the 1 removed container id is named), `recordsDeleted` (≥1), `cause` (catalogue code), `at`. The next attach surfaces exactly 1 user-facing notice; silence is a defect (AC-12). `SessionStore.delete` fsyncs the sessions directory before the reap is counted complete.

### Retry / cause-code equivalence (CRASH-06/07)
No new persisted entity: the recorded container id in `SessionRecord` is replaced (1 new id) on retry from `error`, and the cause code over MCP, ACP and in-process must be equal across all 3 surfaces (AC-13). `OPENSHELL_START_FAILED` must never be the retry outcome.

## 4. Phase 16 — Omp in the sandbox (OMPX-02..05)

### `OmpToolRegistration`
Keyed by `(sessionId, mode)`. `tools` = exactly the 5 frozen Realm tools (`exec, read, write, list, status`) in `ToolCall` shape (frozen `tools.schema.json`); `retry` is a command, never a tool; `glob` count = 0 (AC-14). `registeredAt`, `correlationId`.

### `OmpEnforcementMode` (state machine per session)
```
fail-closed:  write/edit/bash removed-or-blocked by the spike-proved mechanism;
              model bash ⇒ 1 catalogue code; tool_call guard remains as backstop
advisory:     Realm read/write displace same-name built-ins; other built-ins stay
              with the every-invocation notice; restore ownership recorded
```
Transition is `fail-closed ↔ advisory` only via a policy change (the only writable field is policy `mode`); every transition writes 1 audit line. A status string may claim `containment` only where the spike finding says `yes`, otherwise `guard` (D3, AC-15).

### Production pair (OMPX-05, live-gated)
Audit holds exactly 1 admission + 1 result line sharing 1 `correlationId` for the registered write; bytes land in sandbox `/workspace` and the host root. No separate entity — this is a query over `AuditLine` + workspace bytes.

## 5. Phase 17 — Observability and audit (OBS-01..04)

### `AuditLine` (JSONL, `<stateDir>/audit/<sessionId>.jsonl`)
Existing shape, frozen here as the contract: `seq` (int ≥1, strictly increasing by 1), `prev` (lowercase hex sha256 of the previous physical line's raw bytes without the newline; genesis = 64 zeros), `code` (frozen catalogue code), `correlationId`, plus redacted payload fields. `prev` commits to raw bytes, so edit, removal, and reorder are all detected by `realm audit verify` (AC-18): exit 0 untouched; exit 1 naming the 1 first broken line with reason ∈ {`bad-chain-start, unchained-line, seq-gap, seq-regress, prev-mismatch, line-too-long, prefix-changed, tail-loss`}. Head is recovered from the last line at startup (no saved cursor); torn tail (no trailing newline / non-JSON fragment) is closed by the writer and stays its own line.

### `AuditAnchor` / head pin (externally held)
Head pin `"<seq>:<sha256>"` detects tail-loss and a changed head line. Anchor record `{version, sessionId, lineCount, rootSha256, createdAt}` commits to the first `lineCount` lines by Merkle root; a shorter log ⇒ `shorter-log`, a changed prefix ⇒ `prefix-changed`. Lines past the anchor count pass the anchor check but not the chain/head checks.

### `DaemonLogLine` (OBS-02)
1 JSON object per line: `level`, `code` (fixed catalogue-code field), `correlationId`, `toolCallId` (must equal the audit admission/result `toolCallId`). 0 new dependencies.

### `MetricsSnapshot` (OBS-03)
Counters (tool-call, transition, attach) + timings, readable only over the control socket; 0 network listeners on the daemon. Snapshot is read-only and non-persisted; no entity writes it.

### Gateway-loss code (OBS-04)
`OPENSHELL_GATEWAY_LOST` is a distinct catalogue code from `AGENTOS_CRASH_LOOP`, present in every catalogue-enumerating table, doc and test, and returned by `/status` when the gateway/driver is killed (AC-21). It is modelled as a code value, not a persisted flag.

## 6. Phase 18 — Per-project sandboxes (MULTI-01..06)

### `ProjectWorkspace`
`workspaceRoot` (canonical, inside a configured root), `sessionId` (derived, stable per workspace), `policy` (per-project `mode` etc.). Outside-root `up` ⇒ `POLICY_DENIED`, 0 containers created (AC-23).

### `SessionSandbox` (1 per session)
`containerId` (`realm-<sessionId>`), `imageDigest` (pinned), hardening facts (14-check verifier result), `state` (lifecycle state machine §9). Two `up` calls ⇒ 2 sandboxes with distinct `/workspace` bytes and no cross-project write visibility; single-project `down` leaves the other active (AC-22). Per session: 1 audit file, 1 lock table, 1 status snapshot — never shared.

### `ResourceCommitment` (MULTI-06)
Aggregate memory/CPU commitment across live sessions, bounded by existing config; 0 new error codes. Read-only projection over live `SessionSandbox` rows; persisted only as the daemon's in-memory counters.

## 7. Phase 19 — Resume and checkpoint (RES-01..05)

### `SessionRecord` (existing frozen schema, extended only additively)
`realmId, sessionId, workspaceRoot, state, controlSocketPath, containerId|null`. Written before container creation, so `containerId` is null until create. Validated on every save; unknown keys rejected.

### `RunnerRecord` (`<stateDir>/<sessionId>.runner.json`)
`pid, pgid (= pid, runner must lead its own group), startTicks, bootId`. Read before adoption; a reused pid (start ticks differ) or absent leader ⇒ adoption refused, nothing signalled. SIGTERM to the recorded group only while the leader is the same process; SIGKILL only under the same guard; bounded waits (5 s grace, 1 s settle, 50 ms poll).

### `AdoptionRecord` (RES-02/05)
Decision per restart: `adopted` (same `containerId`, verifier passed, 0 second containers) or `removed-before-serving` (verifier-failing or record-less, with 1 cause log line). A workspace that fails any of the 14 hardening checks is never adopted.

### `ScratchVolume` (RES-03)
Session-owned scratch beyond `/workspace`; survives daemon restart, gone after `down`, 0 orphans. Tracked by `sessionId`; deletion is part of the `down` sweep, ordered after container removal.

### `CheckpointManifest` (`src/session/checkpoint.ts`, RES-04)
`checkpointId` (reserved by creating the directory — the reservation is the idempotency), `schemaVersion = 1`, sorted `entries[]` (`path, type, mode, size, sha256, linkTarget`), plus `tree/` copy. Manifest is written last; a directory without a manifest is a partial and is removed under the session lock before the id is re-reserved. Restore: root retained, originals moved aside (`backed-up` marker), staged entries moved in, `committed` marker, backup deleted; recovery inverts by marker presence. Byte-for-byte restore, deletions restored, extras removed, unsafe paths refused with 1 error (AC-26). State root inside the workspace root is refused (would copy secrets into the checkpoint).

## 8. Phase 20 — Release hardening (REL-01..04)

### `ReleaseArtifact`
`version` (0.3.x line; first v3.0 release 0.3.0), `tarballSha256`, `sbomRef`, `attestationRef`. Build job: `contents: read` only, 0 write grants. Publish job: exactly the 4 write grants, 0 npm install/build/pack steps. `gh attestation verify` accepts tarball, `SHA256SUMS`, and SBOM (AC-27).

### `RollbackRecord` (REL-03)
Manual rollback: `testRelease` marked prerelease, docs rebuilt from a validated known-good tag, and provably 0 changes to tags, assets, or `main`. Recorded as an append-only line in the release log; it never rewrites a tag.

### `ChangelogEntry` / `RemovedFeature` (REL-04)
`commit`, `type` (Conventional Commit subject), `removedBy` (revert commit or `Removes:` trailer). A feature removed by a revert (or revert-of-revert) or trailer yields 0 entries for the removed commits, including the removing commit. PRs never edit `CHANGELOG.md` or version fields — the release job owns them.

## 9. Milestone close (audit / complete / cleanup)

### `MilestoneAudit` / `RequirementDisposition`
1 row per v3.0 requirement id (52): `disposition` ∈ {`satisfied, carried, superseded`}; 0 rows may be silent/absent (AC-30). `gsd-tools milestone complete` runs only after a dry run exits 0. Cleanup inventory: 0 remaining scratch profiles and worktrees.

### `LinearIssueLink` / `PhaseRecord` / `ShipRecord`
8 phase issues (12, 13, 14, 16, 17, 18, 19, 20) + 33 sub-issues (1 per plan), deduplicated against `SPE-*` before creation (0 duplicates). `PhaseRecord.state` ∈ {`brief drafted, discussed, planned, executed, verified, audited, completed, cleaned up`}. `ShipRecord`: 8 gates exit 0, CI green on Node 22.x/24.x, Greptile 5/5 with 0 open comments, squash merge via the ship flow, 0 version/CHANGELOG edits (AC-31/32).

## 10. State machines

### Lifecycle (frozen, `src/core/states.ts`) — 13 allowed edges
```
unbound → connecting → active → degraded → active (back)
connecting → error → connecting (retry); connecting/active/degraded/error → stopping → unbound
active → error; degraded → error
```
Self-transitions rejected (`REALM_INVALID_TRANSITION`). Re-attach from `error` reaches `active` with 1 new container id (CRASH-07); the same refusal cause code is returned over MCP, ACP and in-process.

### Phase lifecycle (blueprint §11)
`brief drafted → discussed → planned → executed → verified → audited → completed → cleaned up`. A phase enters CLAIMED/IMPLEMENTATION only when its contract is IN_REVIEW and the relevant ADR is accepted.

### Checkpoint restore
`idle → staged → backed-up → committed → done`, with `→ recovering → idle` on crash (marker-driven, §7). A step past its 300 s bound keeps the lock and work directory; cleanup waits under the same bound, else the operation is stuck with `TOOL_TIMEOUT` and everything is kept for recovery.

### Audit chain
`genesis (prev = 0×64) → seq 1 → seq n`, head recovered from the tail on every append. Verification is a pure function of the file (+ optional head pin / anchor); the writer never trusts a cached cursor.

## 11. Retention and deletion

| Data | Retention | Deletion |
|---|---|---|
| `AuditLine` per session | Until `down` + milestone evidence window; anchor/head pin retained with the release evidence | Removed only by the session sweep after `down`; never truncated in place (would break the chain) — a fresh file starts a new genesis |
| Session record / runner record / scratch | Until `down` | `SessionStore.delete` fsyncs the sessions directory; scratch sweep leaves 0 orphans |
| Checkpoints | Until explicitly superseded or `down` | Partial (no manifest) removed under lock; complete checkpoints removed whole |
| Harness / spike / quality evidence | Retained with repo/docs history | Superseded by newer version records, never edited |
| Release artifacts / attestations | Immutable, retained for the release lifetime | Never deleted or re-tagged; rollback re-points docs only |
| Metrics snapshots / daemon log | Log rotation per existing logger; counters are in-memory | Rolled files removed whole |

No GDPR/CCPA subject deletion applies: Realm stores no personal data (only `workspaceRoot`, a host-local path, classified in `contracts.md`). If that ever changes, deletion is an L4 plan requiring human approval — prepare only, never execute (A07 autonomy ceiling).

## 12. Atomic-write and idempotency semantics (all entities)

1. **Atomic replace.** Every record write: temp file in the target directory → `write` → `fsync` file → `rename` → `fsync` directory (`atomicWriteFile` + `syncDirectory`). An interrupted write leaves the original intact (`WRITE_NOT_ATOMIC`); the orphan temp is removed by the Phase 14 sweep (exact pattern only).
2. **Idempotent operations.** Repeating create/start/probe/attach/detach/stop/destroy against the same session returns the same state without duplicating resources. `SessionStore.delete` on a missing record is a no-op. Checkpoint snapshot reserves its id by directory creation (second snapshot with the same id is refused). Reconciliation appends 0 lines on the second start. `down` on an already-down session is a no-op.
3. **Optimistic concurrency.** `expectedPriorSha256` on atomic writes: a save that races another writer fails rather than silently overwriting. The session lock (`checkpoint-lock.ts`) serialises checkpoint operations; a live or unprovable lock owner keeps the lock (`LOCK_CONFLICT`).
4. **Bounded everything.** Tool queue wait bounded by `toolQueueMs`; every async boundary under `withTimeout`; audit lines ≤ 4 MiB; reads chunked at 64 KiB. No unbounded buffer holds a record.

## 13. Plugin manifest boot block — Omp plugin toggle (ADR-0001, US-112)

Addendum. The toggle is one optional field on the existing persisted manifest record, so the §0 ERD is unchanged (no new entity, no new relation). This section is the data contract; A05 implements the parser, resolver and wiring.

### `PluginBoot` (the `boot` block of `HostPluginManifest`)

| Field | Type | Rule |
|---|---|---|
| `enabled` | boolean, optional, default `true` | The persisted Omp plugin toggle. Absent means on (default-on). `false` registers 0 Realm tools, 0 retry command, 0 paints. Orthogonal to `reattach.enabled` (Phase 21): either may flip independently; the plugin is inert only when `enabled` is `false` |
| `startupBudgetMs` | integer 1..200000, optional | Pre-existing (Phase 21) |
| `reattach` | object, optional | Pre-existing (Phase 21) |

- **Persisted vs resolved.** The persisted document is the manifest JSON carrying the `boot` block. `ResolvedBoot.enabled` is required in the resolved (in-memory) view and always has a value: the manifest value, or `true` when absent (`resolveBoot` is the sole producer; `BOOT_BOUNDS.enabled` is `true`). The extension edge may intersect with the `REALM_OMP_ENABLED` environment reading (unset/`1` = on, `0` = off, anything else fails the load, mirroring `reattachEnabledOf`); the environment value is ephemeral and never persisted — the persisted manifest/settings value is the source of truth across a restart (blueprint §Storage).
- **Write path.** The toggle write is the `API-RealmOmpPlugin` `PUT /plugin/toggle` operation against this field (read: `GET /plugin/toggle`); no other writer may set `enabled`.
- **Fail-closed.** A non-boolean `enabled`, or any unknown `boot` key, is `SCHEMA_INVALID` (closed keys, D-12); nothing is coerced and no partial manifest is accepted.
- **ERD.** `PluginBoot` is an embedded block of the host plugin manifest record (`src/host/types.ts`, parsed by `src/host/manifest.ts`, resolved by `src/host/boot.ts`); it references no other entity by id and is referenced by none.
- **Retention / deletion.** The block lives with the manifest/settings document; removing the document removes the toggle. Rollback of M-2026-006 carries no retention entry; the off value does not survive rollback.
- **Paint and diagnose (no new persisted fields).** Status paint (US-113) and the named `workspaceRoot` diagnostic (US-116) persist nothing new: paint is an in-memory funnel over the daemon snapshot state (`active`, `disconnected`, `error`, `connecting` — 4 of 4 truthful) with 0 under-bar paints (ADR-0002); the diagnostic is operator-local stderr/doctor output only, never audit or log content (ADR-0003).

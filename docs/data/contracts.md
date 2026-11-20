# Data contracts — Realm v3.0

**Task:** `Tc8fd-data` · **Correlation:** `c8fd136c-b9a0-459e-bc27-e2c578d77a08`
Consumers (A05/A06/A08) pin these contracts by digest; they never mutate them. All contracts are BACKWARD compatible unless stated. Additive change = new *optional* field; any removal, rename, retype, or new *required* field is breaking ⇒ major bump + migration plan + consumer acks (L3 → BLOCKED, blueprint §12).

## Compatibility rules (all contracts)

- **Mode:** BACKWARD (new readers accept old data; old readers accept new data with optional fields absent). Registry-equivalent check: `data_contract_field_compat` on the field sets before publish.
- **Unknown keys:** rejected on every object (D-12, `additionalProperties: false`) — a writer that emits an unknown key is a bug, not a forward-compatible extension.
- **Versioning:** each contract carries `version` (semver). N-1 compatibility for the 30-day deprecation window (blueprint §12).

## C1 — `SC-SessionRecord` v1.0.0 (JSON Schema, frozen `src/contract/session-record.schema.json`)
Fields: `realmId` (string, required), `sessionId` (string, required), `workspaceRoot` (string, required), `state` (string, required, set from the frozen `STATES`), `controlSocketPath` (string, required), `containerId` (string|null, optional — null until creation). No token/secret/environment field exists or may be added without a major bump.

## C2 — `SC-AuditLine` v1.0.0 (JSONL)
Fields: `seq` (integer ≥1, required), `prev` (lowercase hex sha256, 64 chars, required; genesis `0×64`), `code` (catalogue code, required), `correlationId` (string, required). Payload fields beyond these are redacted before write and must never include secrets, environment, PII, or host-local absolute paths. Compatibility: additive optional payload fields only; `seq`/`prev` semantics are frozen (changing the hash input is a major bump).

## C3 — `SC-ToolCall` v1.0.0 (frozen `src/contract/tools.schema.json`)
Exactly 1 key of {`exec, read, write, list, status`} (`retry` is a command, not a tool; 0 `glob` tools). Workspace-relative paths only (schema-level pattern rejects absolute paths and `..`). `write` carries `path`, `content`, optional `ifMatchSha256` (optimistic concurrency). Frozen shape — any change is a major bump.

## C4 — `SC-CheckpointManifest` v1.0.0
Fields: `checkpointId` (string, required), `schemaVersion` (integer, required, currently 1), `entries` (array of `ManifestEntry`, required, sorted by `path`). `ManifestEntry`: `path` (safe relative, required), `type` (file/dir/link, required), `mode` (integer, required), `size` (integer, required), `sha256` (hex64, files only), `linkTarget` (links only). Additive: new optional entry fields allowed; changing `schemaVersion` semantics is a major bump.

## C5 — `SC-RunnerRecord` v1.0.0
Fields: `pid`, `pgid` (must equal `pid`), `startTicks`, `bootId` — all required. Any field change is breaking (the adoption guard compares `startTicks`/`bootId` exactly).

## C6 — `SC-HarnessEvidence` v1.0.0 (Phase 12; doc-retained, not stateDir)
`HarnessRun` + `HarnessCaseResult` + `SpikeEvidence` as modelled in `models.md` §1. Fields are additive-optional except `runId`, `ompVersion`, `outcome`. The HARN-03 allowlist (`allowlistPorts`) is data, not schema: admitting port 9931 changes a value after the owner ruling, not the contract.

## C7 — `SC-QualityEvidence` v1.0.0 (Phase 13)
`GateRun`, `CoverageFloor/Measurement`, `MutationRun`, `PropertyEvidence` as in `models.md` §2. `gate` and `directory` are closed enums; adding a gate/directory value is a minor bump (additive enum extension), removing one is major.

## C8 — `SC-GsdLinear` / `SC-ShipRecord` v1.0.0 (mirrors `api-gsd-linear.yaml`)
`PhaseRecord {phaseId ∈ {12,13,14,16,17,18,19,20}, state, correlationId}`, `LinearIssueLink {phaseId, issueId, subIssueIds}`, `ShipRecord {phaseId, gatesExit0, greptile ∈ {5/5}, correlationId}`. Consumed from the API contract; this contract only constrains the persisted linkage rows.

## C9 — `SC-ReleaseEvidence` v1.0.0 (Phase 20)
`ReleaseArtifact {version, tarballSha256, sbomRef, attestationRef}`, `RollbackRecord {releaseId, prereleaseMarked, docsTag, mainUnchanged}`, `ChangelogEntry {commit, type, removedBy?}`. Immutable once written; a correction is a new record that supersedes, never an edit.

## PII classification (100% coverage of new fields)

| Field | Classification | Handling |
|---|---|---|
| `workspaceRoot` (session record only) | `PII-indirect` / host-local path | Persisted only in `sessions/<id>.json` (0600, 0700 dir); never in audit, log, evidence, or release bundles; excluded from exports |
| `correlationId`, `sessionId`, `containerId`, `seq`, `prev`, hashes | not PII | Join keys / integrity values; safe to log |
| `content` (tool write), workspace file bytes, checkpoint tree | unclassified payload — **never copied into audit/log** | Only `path` (workspace-relative) + `sha256` are audited; bytes stay in the workspace/checkpoint |
| All other fields in C1–C9 | not PII | — |

No new field may be added to any contract without a classification row in this table (self-gate, A07 decision logic §4). Masking rule for non-prod environments: PII-indirect fields are replaced by their `sessionId`-derived pseudonym in any exported evidence bundle. There is no retention entry for PII because there is no PII store; `workspaceRoot` retention follows the session record (§11 of `models.md`).

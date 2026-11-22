# Migration index — Realm v3.0 (file-schema expand/contract)

**Task:** `Tc8fd-data` · **Correlation:** `c8fd136c-b9a0-459e-bc27-e2c578d77a08`
Realm persists JSON/JSONL records, not SQL. A "migration" here is therefore a **schema-version step** for those records: *expand* (add optional fields / new record kinds, old readers keep working), *backfill* (populate new fields from existing data), *contract* (make a field required or remove a field — only after every reader is upgraded). No step executes DDL; no step is destructive. This index is a design record: nothing here has been shipped, and no phase acceptance rehearsal has been run (brief: docs only); M-2026-006's data-direction rehearsal on ephemeral fixtures, recorded with the step, does not set `shadow_tested`. Each step below names its forward effect, its rollback, and the rehearsal the implementing phase must run before the step ships.

**Ordering rule.** Version ids are unique and strictly increasing (natural order); the new step always sorts last. Forward and reverse records are paired by id — a forward step with no named rollback is never published.

| ID | Kind | Step | Forward effect | Rollback |
|---|---|---|---|---|
| M-2026-001 | expand | Introduce C6–C9 record kinds + `schemaVersion` on checkpoint manifests (Phase 12–20 new records) | New record files may be written; existing records untouched; old readers ignore absent optional fields | Delete the new record kinds' writers; records already written stay readable (additive only) |
| M-2026-002 | expand | AuditLine payload: add optional `toolCallId` (OBS-02) | New lines carry `toolCallId`; old lines have none | Stop emitting the field; chain verification is unaffected (`prev` hashes raw bytes either way) |
| M-2026-003 | backfill | Populate `toolCallId` on new lines only; never rewrite history | 0 existing lines changed (row-count reconcile: before + 0) | No-op (nothing was rewritten) |
| M-2026-004 | expand | SessionRecord: add optional `containerId` write-back timing (already nullable in the frozen schema) — no field change, documents the pre-creation null window | None | None |
| M-2026-005 | contract | *Reserved.* Any field removal/rename/retype (e.g. a future `workspaceRoot` representation change) | Only after all readers accept the new shape; major contract bump + consumer acks | Restore the prior contract version; data written under the new shape must be down-converted by a named converter before rollback |
| M-2026-006 | expand | Persisted Omp plugin toggle: optional `boot.enabled` (boolean, default `true`) on the manifest boot block (ADR-0001, US-112) | Manifests without `enabled` parse and resolve to on — 0 existing manifests need rewriting; `ResolvedBoot.enabled` gains the defaulted required value | Strip `enabled` from any persisted manifest carrying it, then revert the parser allowlist arm and the resolved default; manifests without the field are byte-identical (the off value does not survive rollback) |

M-2026-005 has no forward content in this design and no approval is sought for it — it exists so a future contract step has a named slot instead of being improvised.

## Per-step safety

- **Expand steps (M-001, M-002, M-004)** are L2, additive, BACKWARD compatible. Approval required: `none`. Lock timeout: N/A (file writes are atomic rename, not table locks); every write is bounded by `withTimeout` and the audit-line 4 MiB cap.
- **Backfill (M-003)** writes 0 existing rows by design; any future backfill that rewrites records must declare its delta and reconcile counts (before + delta = after) before the contract step runs.
- **Contract (M-005)** is L3 minimum (compatibility mode other than pure additive) and would be BLOCKED `human-approval` with consumer acks; destructive execution is L4 and is never performed by A07.
- **Expand (M-2026-006)** is L2, additive, BACKWARD compatible (`data_contract_field_compat`: compatible, additive `enabled`; `data_migration_version_order`: M-2026-006 is unique and sorts last). Approval required: `none`. `requires_lock_timeout_s: 0` (atomic rename; no table locks). Destructive scan over the forward text: 0 flagged; `data_not_null_default_check`: 0 columns (no SQL surface); `data_lock_risk_scan`: 0 risks. Data-direction rehearsal (ephemeral fixtures, 2026-11-21): forward add / down strip is a byte involution (down output byte-identical to the pre-forward manifest); the real `parseHostPluginManifest` + `resolveBoot` accept the forward value (`enabled: false` resolves `false` and leaves `reattach.enabled` untouched), default absent to `true`, refuse a non-boolean value and any unknown `boot` key (`SCHEMA_INVALID`), and read the stripped document as on; file counts reconcile 1 → 1 → 1 (drift 0 both directions). `shadow_tested` stays `false` until the implementing phase runs the phase acceptance checks (AC-33..AC-64: hermetic off-path registration/paint counts, widget-only target, named diagnostic, AC-38 persistence across restart). EXPLAIN budget: vacuous — the step adds no index and no query, so there is no bound query to regress. Rollback ordering: strip the field first, then revert the parser (a manifest still carrying `enabled` would be `SCHEMA_INVALID` under the reverted parser); the env override `REALM_OMP_ENABLED` is ephemeral and needs no data rollback.

## Rollback rehearsal plan (per implementing phase, before ship)

1. Copy a production-shaped state directory (sessions, audit files, checkpoints) into an ephemeral directory.
2. Apply the forward step; run the phase's acceptance checks (e.g. AC-18 verify on a chained file for M-002).
3. Apply the rollback named above; re-run the same checks; reconcile row counts (drift must be 0).
4. Record `shadow_tested: true` in the phase's migration record only when forward **and** rollback both ran; until then it stays `false` (it is `false` for every step in this index today).

## What this index deliberately does not contain

- No SQL migrations, no `DROP`/`TRUNCATE`/type-change statements — there is no engine to run them against.
- No executed forward or rollback script. The implementing phases own the code and the rehearsal; A07 owns this index and the contracts.
- No production DDL rights are claimed or granted (A07 autonomy ceiling; execution, if ever needed, goes through A11 pipelines).

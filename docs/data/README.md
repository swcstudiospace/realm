# Data layer — Realm v3.0 (A07 single-writer zone)

**Task:** `Tc8fd-data` · **Correlation:** `c8fd136c-b9a0-459e-bc27-e2c578d77a08` · **Capability:** `data.migration`
**Branch:** `gsd/phase-15-complete` · **Engine:** file-based JSON/JSONL under the realm state directory — Realm has no SQL engine; there is no PostgreSQL, no DDL, and therefore no destructive-DDL surface in this design. L4 `destructive_ddl` does not arise.

This directory is the `data.model` / `data.contract` / `schema.migration` (design) record for phases 12, 13, 14, 16, 17, 18, 19, 20 plus milestone close. It is documentation only: no code, no executed migration, no gate run, per the brief. A05/A06 consume these contracts; they never mutate them.

| File | Contents |
|---|---|
| `models.md` | Entities (ERD), per-phase model, every state machine, storage layout, retention, redaction, atomic-write + idempotency semantics |
| `contracts.md` | `data.contract` records (JSON-Schema-shaped), compatibility mode, PII classification, field-level rules |
| `migrations.md` | `schema.migration` index: expand → backfill → contract sequence, forward/rollback per step, rollback rehearsal plan, sequencing |

## Conventions (global)

- **Identity.** `sessionId` is the partition key for all per-session state (`realm-<sessionId>` container, `sessions/<sessionId>.json`, `audit/<sessionId>.jsonl`, checkpoint dir, runner record). `correlationId` is the per-operation join key across audit admission + result lines, daemon log lines, and metrics. `realmId` is stable per state directory.
- **Persistence shape.** Every persisted record is one JSON object (or one JSONL line), written atomically (temp file in the same directory → fsync file → rename → fsync directory), mode `0600` in a `0700` directory, following the existing `SessionStore` / `atomicWriteFile` pattern in `src/session/store.ts`. No record carries a token, secret, or environment value (frozen `session-record.schema.json`, D-14 one-way).
- **Schema evolution.** Records carry an integer `version` (or rely on the frozen schema version in `src/contract/`). Evolution is additive-only under BACKWARD compatibility: new fields are optional, unknown keys are rejected on read (D-12 `additionalProperties: false` on all existing schemas), old readers ignore absent optional fields. Field removal / rename / retype is a *contract* step (§3 of `migrations.md`), never an expand step, and needs a major contract bump + consumer ack (L3 → BLOCKED per blueprint §12).
- **Redaction.** Audit and daemon log lines are redacted as a whole before write (`src/audit/redact.ts`); the redaction sentinel is present; 0 PII fields, 0 secrets, 0 environment values (NFR-C1). Host-local absolute paths are never written to audit/log/evidence records — only workspace-relative paths and `sessionId`/`correlationId`.
- **Fail-closed.** A record that fails schema validation, a lock owner that is live/unprovable, or a chain that fails verification refuses the operation with a catalogue `RealmError` code; it is never silently coerced or partially applied.
- **PII.** Realm stores no personal data by design. The only near-PII field is `workspaceRoot` (a host-local path), classified `host-local-path / PII-indirect` in `contracts.md`: it is persisted only in the session record (0600, state dir), never copied into audit, log, evidence, or release artifacts, and is excluded from every exported bundle.

## Sources

Blueprint `docs/architecture/blueprint.md` (§4 layering, §6 invariants, §12 contracts), ADR index `docs/architecture/adr-index.md` (ADR-0001..0007), requirements `docs/requirements/spec.md` (§4.1–§4.10), acceptance `docs/acceptance.md` (AC-1..AC-32), API contracts `docs/architecture/contracts/api-realm-control.yaml` (v1.0.0) and `api-gsd-linear.yaml` (v1.0.0), and the existing on-disk shapes in `src/contract/session-record.schema.json`, `src/contract/tools.schema.json`, `src/core/policy.schema.json`, `src/audit/chain.ts`, `src/session/store.ts`, `src/session/checkpoint.ts`, `src/session/runner-record.ts`, `src/core/states.ts`.

## Status

Design IN_REVIEW. No migration has been executed and no shadow rehearsal has been run (brief: docs only, skip gates) — `shadow_tested: false` in the migration index until the implementing phase runs forward + rollback on an ephemeral state directory. HARN-03 (ADR-0007) and Podman 5.x live proof remain owner/live-gated and are not inferred here.

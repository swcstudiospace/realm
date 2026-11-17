---
phase: 17-observability-and-tamper-evident-audit
plan: 01
subsystem: audit
tags: [audit, merkle, hash-chain, fail-closed, OBS-01]
requires: []
provides:
  - "src/audit/anchor.ts exports newLeafHash, nodeHash and merkleRootOfLeaves; merkleRoot composes them"
  - "src/audit/chain.ts imports the leaf and node hashes from anchor.ts; it holds no LEAF_PREFIX or NODE_PREFIX"
  - "An oversize append and an over-bound tail are refused with AUDIT_WRITE_FAILED, with tests named for both cases"
affects: [src/audit/anchor.ts, src/audit/chain.ts, src/audit/log.ts, test/audit/anchor.test.ts, test/audit/chain.test.ts, test/audit/log.test.ts]
key-files:
  created: []
  modified: []
decisions:
  - "Plan 17-01 changed no code. Its work was already on origin/main when the executor reconciled the plan, so this summary records the state found, not new edits."
  - "The plan's verify commands were not run for this summary (the write contract forbids running tests). Test pass status is therefore NOT VERIFIED."
requirements: [OBS-01]
metrics:
  tasks: 3
  commits: "334c1ad, 74ce823, 2640681 (all ancestors of origin/main; the commit-to-task mapping is not recorded)"
status: complete-on-main
---

# Phase 17 Plan 01: audit chain completion (OBS-01) Summary

The Merkle leaf and node hashes now have one definition in `anchor.ts`, the streaming verifier imports them, and the two fail-closed append cases the research requires have named tests. The plan itself changed no code.

## Tasks

| Task | Name | Commit | Files | State found |
| ---- | ---- | ------ | ----- | ----------- |
| T1 | One definition of the Merkle leaf and node hashes | not recorded per task (see commits above) | src/audit/anchor.ts | `newLeafHash` (anchor.ts:59-61), `nodeHash` (anchor.ts:64-66), `merkleRootOfLeaves` (anchor.ts:101-114) and `merkleRoot` (anchor.ts:117-119) are exported; `merkleRoot` composes the first two |
| T2 | The streaming verifier imports the hashes | not recorded per task | src/audit/chain.ts | chain.ts:19 imports `newLeafHash`, `nodeHash` from `./anchor.js`; `LEAF_PREFIX` and `NODE_PREFIX` do not appear in chain.ts. `anchor.ts` does not import `chain.ts` (import list read at anchor.ts top, not separately traced) |
| T3 | Oversize and over-bound tail fail closed, with tests | not recorded per task | src/audit/log.ts, test/audit/log.test.ts, test/audit/chain.test.ts | Tests at test/audit/log.test.ts:448 ("an oversize append fails with AUDIT_WRITE_FAILED and leaves the file unchanged (OBS-01)") and test/audit/chain.test.ts:575 ("an over-bound tail fails closed with AUDIT_WRITE_FAILED and leaves the file unchanged (OBS-01)"). No change to log.ts by this plan |

## What was found

- `src/audit/anchor.ts:59-118`: the incremental leaf hash (SHA-256 with the `0x00` prefix fed in), the parent hash (SHA-256 of `0x01 || left || right`), the fold that promotes an unpaired node unchanged, and `merkleRoot` over raw lines. The fold throws `SCHEMA_INVALID` on empty input.
- `src/audit/chain.ts:19`: the single import that replaces the duplicated prefix constants and hash functions. This closes the "partly done" item in the plan, the duplication the owner's STATE record listed as a follow-up.
- `src/audit/chain.ts:22`: `AUDIT_LINE_MAX_BYTES` (4 MiB) is defined here. The tail reads at chain.ts:126-143 and 197-214 throw `audit line exceeds the chain bound` for an over-bound last line, and the line scan at chain.ts:353 and 426-430 reports `line-too-long`.
- `src/audit/log.ts:101-108`: `appendAudit` rethrows a `RealmError` unchanged and maps every other error from `writeAuditLine` to `AUDIT_WRITE_FAILED`. That covers the chain-bound error from the tail read. `writeAuditLine` documents the oversize refusal at log.ts:138 ("A line longer than AUDIT_LINE_MAX_BYTES is refused"); the body of that check (log.ts:144-169) was not re-read for this summary.
- `test/audit/log.test.ts:448-460` appends a line with a 4 MiB path and asserts `AUDIT_WRITE_FAILED` and identical file bytes.
- `test/audit/chain.test.ts:575-589` writes a valid first line followed by a 4 MiB-plus-one fragment with no newline, then asserts `AUDIT_WRITE_FAILED` and identical file bytes. The head read must not hash the partial tail, and the test checks the bytes are unchanged afterwards.

## Verification

Read-only inspection only. The contract for this summary forbids running tests, lint, typecheck or formatters.

- VERIFIED by reading source: T1 exports and their line ranges; T2 import at chain.ts:19 and absence of prefix constants in chain.ts (grep for `LEAF_PREFIX|NODE_PREFIX` in src/audit returned only anchor.ts:30-31, 60, 65); the two test names and their line numbers; the error mapping at log.ts:101-108.
- Not in the orchestrator's facts: the commit hashes name the work as landed on main, but no commit-to-task mapping is recorded.

## NOT VERIFIED

- Test pass status for the plan's verify selectors (`node --test --test-name-pattern "oversize|over-bound" ...`) and the full set `anchor.test.js chain.test.js log.test.js reconcile.test.js cli/audit.test.js`. No run is recorded for 17-01.
- That every Merkle root checked by `test/audit/anchor.test.ts` is byte-identical after the refactor (stop condition in the plan). The test file was not re-read and not run.
- That `anchor.ts` has no import of `chain.ts` (the plan's import-cycle check). Not traced.
- That the oversize refusal path reaches the `AUDIT_WRITE_FAILED` mapping for a single line over the bound (the check body at log.ts:144-169 was not read).
- Which commit delivered which task (334c1ad, 74ce823, 2640681).

## Deviations from Plan

**1. [Plan vs tree] No code change by this plan.** T1 to T3 were already on origin/main. The plan's only allowed production change, a mapping fix in `log.ts`, was not needed as far as the read-only inspection shows.

**2. [Scope] Tests not run.** The plan's verify commands and the orchestrator's typecheck and lint were not run for this summary, per the write contract.

## Known Stubs

None.

## Threat Flags

None. The change set is a hash refactor and two refusal tests; no new input surface.

## Next Phase Readiness

- The duplicated hash definitions are gone, so later audit work imports the leaf and node hashes from `anchor.ts`.
- Open, not owned by this plan: the research's verifier output names (`legacyLines`, `chainStartLine`, `shorter-than-anchor`) differ from the implemented names (`unprotected`, `shorter-log`, `tail-loss`, `prefix-changed`). The plan's open question still awaits the owner's confirmation.

---
*Phase: 17-observability-and-tamper-evident-audit*

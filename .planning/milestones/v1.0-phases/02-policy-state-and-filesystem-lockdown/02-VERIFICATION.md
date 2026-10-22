---
phase: 02-policy-state-and-filesystem-lockdown
verified: 2026-10-21T00:00:00Z
status: passed
score: 16/16 must-haves verified
---

# Phase 2: Policy, State, and Filesystem Lockdown — Verification Report

**Phase Goal:** Policy, the six-state machine, the event bus, filesystem safety,
audit redaction, the session store, and the doctor core all work and are tested
with no container present.
**Verified:** 2026-10-21
**Status:** passed (QUAL-02 partial per accepted decision Q-4; MCP/ACP clause moves to Phase 5)

## Goal Achievement

### Observable Truths

| # | Truth (Roadmap SC) | Status | Evidence |
|---|--------------------|--------|----------|
| 1 | State-machine tests cover every allowed/rejected transition; rejections return `REALM_INVALID_TRANSITION` | ✓ VERIFIED | `test/core/state-machine.test.ts` — 13 allowed + 23 rejected pairs incl. all 6 self-transitions; wraps frozen `src/core/states.ts` via `src/core/state-machine.ts` |
| 2 | Display is exactly one of "realm active"/"realm disconnected" from one shared mapping; every transition publishes an event with reason + time | ✓ VERIFIED | `src/core/status.ts` (sole `STATUS_LABELS`), `test/core/status.test.ts`; `src/core/events.ts`, `test/core/events.test.ts` |
| 3 | Policy defaults advisory, fail-closed per project, `shellEnabled` false → exec shell rejected `SHELL_NOT_ALLOWED`, unknown tool keys rejected `SCHEMA_INVALID` | ✓ VERIFIED | `src/core/policy.ts`, `test/core/policy.test.ts`, `test/core/fail-closed.test.ts`, `test/contract/exec-policy.test.ts`, `test/contract/tool-input-gate.test.ts` |
| 4 | Escape→`PATH_ESCAPE` (incl. symlinks), credential paths→`CREDENTIAL_PATH_DENIED` unless allowlisted, lock conflict→`LOCK_CONFLICT` unchanged, interrupted write→`WRITE_NOT_ATOMIC` intact | ✓ VERIFIED | `src/fs/canonicalize.ts` + `root.ts`, `credentials.ts`, `locks.ts`, `write.ts`, `atomic-write.ts`; `test/fs/canonicalize.test.ts`, `deny-credentials.test.ts`, `lock.test.ts`, `write.test.ts`, `atomic-write.test.ts`, `toctou.test.ts` |
| 5 | Lifecycle ops idempotent vs fake runtime; audit redacted, no host secrets/env | ✓ VERIFIED | `src/lifecycle/controller.ts`, `test/lifecycle/idempotent.test.ts` + `controller.test.ts` + `no-host-env.test.ts`; `src/audit/redact.ts` + `log.ts`, `test/audit/redaction.test.ts` + `log.test.ts` |

### Required Artifacts

All present, substantive, wired: `src/core/{state-machine,events,ports,policy,status,timeout}.ts`,
`src/fs/{root,canonicalize,atomic-write,glob,credentials,locks,read,list,write}.ts`,
`src/session/{paths,store}.ts`, `src/lifecycle/controller.ts`, `src/doctor/checks.ts`,
`src/audit/{redact,log}.ts`, `test/support/fake-execution.ts`. No frozen Phase 1 file edited.

### Key Link Verification

| From | To | Via | Status |
|------|----|-----|--------|
| state machine | event bus | commit-then-publish in `state-machine.ts` | WIRED |
| controller.create | workspace policy | `bindWorkspace` + mismatch `POLICY_DENIED` before state early-return (review H-2 fix) | WIRED |
| canonicalize | open | `openVerified` O_NOFOLLOW+O_NONBLOCK + `isFile()` check (review H-1 fix) | WIRED |
| write path | locks + atomic replace | D-34 order in `write.ts`, `finally` release | WIRED |
| audit | redaction | redact-before-append in `log.ts`; failures → `AUDIT_WRITE_FAILED` | WIRED |

### Requirements Coverage

| Requirement | Evidence | Status |
|-------------|----------|--------|
| CORE-01 | `test/core/state-machine.test.ts` | ✓ SATISFIED |
| CORE-02 | `test/core/status.test.ts` (`src/core/status.ts`) | ✓ SATISFIED |
| CORE-03 | `test/core/policy.test.ts`, `fail-closed.test.ts` | ✓ SATISFIED |
| CORE-04 | `test/core/events.test.ts` | ✓ SATISFIED |
| CORE-06 | `test/lifecycle/idempotent.test.ts`, `controller.test.ts` | ✓ SATISFIED |
| FS-01 | `test/fs/canonicalize.test.ts`, `deny-credentials.test.ts` | ✓ SATISFIED |
| FS-02 | `test/fs/canonicalize.test.ts`, `toctou.test.ts` | ✓ SATISFIED |
| FS-03 | `test/fs/deny-credentials.test.ts` | ✓ SATISFIED |
| FS-04 | `test/fs/lock.test.ts`, `write.test.ts`, `lifecycle/idempotent.test.ts` | ✓ SATISFIED |
| FS-05 | `test/fs/atomic-write.test.ts`, `session/store.test.ts` | ✓ SATISFIED |
| RT-07 | `test/session/store.test.ts`, `lifecycle/controller.test.ts` | ✓ SATISFIED |
| TOOL-01 | `test/contract/tool-input-gate.test.ts` + Phase 1 `tools.schema.test.ts` | ✓ SATISFIED |
| TOOL-02 | `test/contract/exec-policy.test.ts` | ✓ SATISFIED |
| AUD-01 | `test/audit/redaction.test.ts`, `log.test.ts` | ✓ SATISFIED |
| AUD-02 | `test/lifecycle/no-host-env.test.ts` | ✓ SATISFIED |
| QUAL-02 | `test/quality/suite-taxonomy.test.ts` (taxonomy+category; MCP/ACP deferred to Phase 5 per Q-4) | ✓ SATISFIED (partial, accepted) |

### Gates (run by verifier)

- `npm run typecheck` (`tsc --noEmit`): clean
- `npm run lint` (ESLint): no issues
- `npm test`: 451 pass, 0 fail, 1 skipped (intentional Podman-gate skip), 452 total

### Review Blockers (02-REVIEW.md H-1, H-2)

Both fixed and verified in code: H-1 FIFO hang → `O_NONBLOCK` + `isFile()` in
`openVerified`/`verifyDescriptor` (`src/fs/canonicalize.ts:161,181`) plus
`syncDirectory` hardened (`O_DIRECTORY|O_NONBLOCK`, `src/fs/atomic-write.ts:158`);
H-2 early-return skip → `bindWorkspace` + mismatch check run before state
early-return (`src/lifecycle/controller.ts:91-101`). Non-blocking M-1/M-2/M-3
fixes also present (`0o777` mask, audit lstat+`AUDIT_WRITE_FAILED`, teardown lock
release in `finally`). Residuals recorded for Phase 7 review, not blockers.

### Gaps

None.

---
_Verified: 2026-10-21_
_Verifier: Claude (gsd-verifier)_

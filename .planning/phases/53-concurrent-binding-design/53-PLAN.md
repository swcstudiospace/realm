# Plan 53-01: Concurrent binding design (HITL)

**Phase:** 53-concurrent-binding-design · **Requirements:** CBIND-01..02 · **Wave:** 1 · **No code.** Output: `.planning/phases/53-concurrent-binding-design/53-DESIGN.md` only.

**Files read:** `src/session/paths.ts`, `src/session/workspace-registry.ts`, `src/session/checkpoint-lock.ts`, `src/session/reap.ts`, `src/lifecycle/controller.ts`, `src/daemon/sessions.ts`, `docs/integration/runtime-decision.md` (one-session-per-project decision), `docs/integration/host-plugin-gaps.md` (if a gap touches binding).

## Steps

1. **Write `53-DESIGN.md` (§1–2, CBIND-01):** dated design record stating (a) binding semantics — what binds (workspace dev/ino + session id + boot id), what conflicts (same workspace, alias path, nested root), what waits (bounded, timeout, refusal); (b) identity of a binding and how it is stored/derived; (c) failure modes (stale binder after crash, alias race, nested roots, daemon restart mid-bind, second binder's error). Each item carries the HITL owner decision that settled it; undecided items stay open questions with options.
2. **Write `53-DESIGN.md` (§3, CBIND-02):** code surfaces a future implementation would touch (`src/session/paths.ts`, `workspace-registry.ts`, `src/lifecycle/controller.ts`, `src/daemon/sessions.ts`, lock table, audit attribution) and contract changes it would need (session record shape, lock semantics, error codes — new code only with owner approval by name), with a migration note where an existing contract changes. No compatibility shims anywhere in the design.
3. **HITL gate (BLOCKING, human).** Present the open questions (D-53-3 candidates) to the owner: binder identity, conflict action (wait vs `LOCK_CONFLICT` vs new code), wait bound, nested-root rule. Record the picks in `53-DESIGN.md` as owner decisions D-53-H1…. The phase closes CBIND-01..02 only when the owner approves the frozen design.
4. **No-code proof.** Confirm `git status` shows no `src`, `test`, or contract change — only `.planning/phases/53-*/53-DESIGN.md` (and this plan/context).

## Checks

- `git status --short -- src test package.json package-lock.json` → empty.
- Design completeness: every CBIND-01 element (binds/conflicts/waits, identity, failure modes) and every CBIND-02 element (surfaces, contract changes, migration note, no shims) present and owner-decided.
- No live window; no test run needs doing (nothing executed).

## Decisions (end of phase 53)

The phase ends with the frozen, owner-approved design in `53-DESIGN.md`: binding identity, conflict rule, wait bound and failure-mode handling as decided in D-53-H1…; the code surfaces and contract changes of §3 as the approved implementation scope. No implementation is planned or implied beyond that approved scope; a dependent implementation phase needs its own owner decision after this freeze.

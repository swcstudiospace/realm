# Plan 54-01: Snapshots design (HITL)

**Phase:** 54-snapshots-design · **Requirements:** SNAP-01..02 · **Wave:** 1 · **No code.** Output: `.planning/phases/54-snapshots-design/54-DESIGN.md` only.

**Files read:** `src/session/checkpoint.ts`, `src/session/checkpoint-lock.ts`, `src/cli/checkpoint.ts`, `src/session/paths.ts`, `src/session/reap.ts`, `docs/integration/runtime-decision.md` (RES-04 rationale), `docs/policy-reference.md` (if snapshot retention touches policy).

## Steps

1. **Write `54-DESIGN.md` (§1–2, SNAP-01):** dated design record stating (a) snapshot contents (workspace tree as RES-04 manifest: path, type, mode, size, link target, sha256 — plus what is excluded: state dir, scratch volume unless decided); (b) durability guarantee (what survives a daemon restart and a crash: file fsync + directory fsync, manifest written last, marker recovery); (c) restore semantics (byte-for-byte return to prior content, root device/inode unchanged). Each item carries the HITL owner decision that settled it.
2. **Write `54-DESIGN.md` (§3, SNAP-02):** composition with RES-04 (`snapshotWorkspace`/`restoreWorkspace` under the per-session lock), the scratch volume (included/excluded), the no-orphan guarantee (snapshot dirs never adopted as containers/sandboxes; reap interaction), and the code surfaces (`src/session/checkpoint.ts`, `src/cli/checkpoint.ts`, `src/session/paths.ts`) plus contract changes (CLI shape, retention policy) with a migration note. No compatibility shims.
3. **HITL gate (BLOCKING, human).** Present the open questions (D-54-2 candidates) to the owner: named retained checkpoints vs new store, retention bound, scratch inclusion, restore conflicts with a live sandbox. Record the picks in `54-DESIGN.md` as owner decisions D-54-H1…. SNAP-01..02 close only on the owner-approved frozen design.
4. **No-code proof.** Confirm `git status` shows no `src`, `test`, or contract change — only `.planning/phases/54-*/54-DESIGN.md` (and this plan/context).

## Checks

- `git status --short -- src test package.json package-lock.json` → empty.
- Design completeness: every SNAP-01 element (contents, durability, restore) and every SNAP-02 element (RES-04 composition, scratch, no-orphan, surfaces, contract changes, migration, no shims) present and owner-decided.
- No live window; the RES-04 mechanism is read, not run.

## Decisions (end of phase 54)

The phase ends with the frozen, owner-approved design in `54-DESIGN.md`: snapshot contents, durability guarantee and restore semantics as decided in D-54-H1…; the RES-04 composition, scratch and no-orphan treatment, code surfaces and contract changes of §3 as the approved implementation scope. No implementation is planned or implied beyond that approved scope; a dependent implementation phase needs its own owner decision after this freeze.

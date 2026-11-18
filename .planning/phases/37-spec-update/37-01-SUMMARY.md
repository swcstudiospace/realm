# 37-01 Summary: Spec update (SPEC-01)

**Executed:** 2026-11-18, branch `gsd/phase-37-exec1`, cut from `origin/main` (release 0.5.0).
**Authority:** owner instruction of 2026-11-18, decision D-v5-6 (HITL, v5.0 milestone start).
**Status:** both documentation commits made; pull request not yet opened (see "Pull request").

## Commits

1. `docs(spec): retire the Anda bridge statements on the owner's instruction` (spec only; body carries the instruction, the reason, the counts, `Refs: SPEC-01`).
2. `docs(integration): record the Phase 37 spec edit in the decision notes` (runtime-decision.md and anda-replacement-research.md; `Refs: SPEC-01`).

Plan and context files (`37-CONTEXT.md`, `37-01-PLAN.md`, this summary) ship in a third documentation commit under `.planning/phases/37-spec-update/`.

## Precondition output (before the first edit)

- Latest spec commit: 78ea260 (no newer commit touched the spec).
- Anda mention lines: 60; mentions: 101; `degraded`: 6; lines with a tab: 161; `xmllint --noout` exit 0; the line numbers of every row in the 37-CONTEXT edit table matched.

## Acceptance output (final commit)

- `xmllint --noout docs/specs/realm-spec.xml`: exit 0.
- Script 1 (scope check): `unexpected changed lines: []`, `expected lines not changed: []`, `tracker attributes preserved: True`, `line 2 identical: True`, exit 0.
- Script 2 (residual check and parse): `Anda mentions outside verbatim, retired or tombstone lines: []`, `degraded (state) occurrences: 0`, `andaUrl occurrences: 0`, `six-state wording: 0`, `lines with a tab: 161`, `retired attributes: 15`, exit 0.
- `git diff --shortstat` of the spec against the merge base: 1 file changed, 36 insertions, 43 deletions.
- A word-level diff shows only the fragments of the 37-CONTEXT edit table changed; D4 lines and line 2 untouched.
- `git diff --name-only` against the merge base: the spec, `runtime-decision.md`, `anda-replacement-research.md` (plus the files under `.planning/phases/37-spec-update/` once the third commit lands).
- `node scripts/check/host-paths.mjs`, `node scripts/check/default-mode.mjs`, `node scripts/check/agents-sync.mjs` (`npm run check:docs`): pass.
- `npm run test:scripts`: 487 tests, 487 pass, 0 fail (after `npm ci`; on a tree without `node_modules` five script tests fail on the base too because the `typescript` package is missing).
- `npm run build`: passes. `node --test "dist/test/docs/*.test.js"`: 52 tests, 52 pass.
- Closing searches: `still names the bridge|read as superseded by this section` prints only `runtime-decision.md` lines 636 (the row, followed by its marker) and 642 (R-27-02, followed by its marker). `git grep "realm-spec" -- test scripts src` prints only the synthetic fixture line in `scripts/check/default-mode.test.mjs`.

## Open questions (standing defaults taken)

- OQ-37-01: planning history kept and marked with the `retired` attribute (default).
- OQ-37-02: the six to five state-count edits are within the owner's instruction (default).
- OQ-37-03: merge method follows the repository default; no breaking marker.

## Pull request (to submit)

Title: `docs(spec): drop the Anda bridge from the product spec`

Body: the text of 37-01-PLAN Task 3 (owner instruction of 2026-11-18, D-v5-6, and the reason as the first two paragraphs).

## Tracker hand-off for the orchestrator

- SPEC-01 status: done once the pull request merges.
- Phase 37 plans line: 37-01 complete.
- STATE entry: Phase 37 executed; spec no longer describes the Anda bridge.
- PROJECT.md: the two lines that still call the spec read-only and list Anda among its dependencies need the orchestrator's edit after the merge.
- No edit was made to ROADMAP, STATE, REQUIREMENTS, PROJECT, CHANGELOG, code, tests, scripts, workflows or version files.

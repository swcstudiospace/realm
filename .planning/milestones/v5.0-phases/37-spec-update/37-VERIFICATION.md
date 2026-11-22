---
phase: 37-spec-update
verified: 2026-11-22
verdict: passed
status: passed
score: "1/1 requirement covered (SPEC-01), met by repository evidence read on origin/main; the verifier ran xmllint and read-only grep and git diff counts, no build, test or live run; the claim is that the spec no longer requires the Anda bridge, andaUrl, the ANDA_ codes or the degraded state, with history kept and marked retired; 4 items outside the evidence reach, listed as behavior_unverified"
ref: "origin/main cca02fd (PR 157, squash 90e7127, merged 2026-11-18T05:18:21Z; docs/specs/realm-spec.xml has no later commit)"
behavior_unverified: 4
overrides_applied: 0
covered_files:
  - ".planning/phases/37-spec-update/37-CONTEXT.md"
  - ".planning/phases/37-spec-update/37-01-PLAN.md"
  - ".planning/phases/37-spec-update/37-01-SUMMARY.md"
  - "docs/specs/realm-spec.xml"
  - "docs/integration/runtime-decision.md"
  - "docs/integration/anda-replacement-research.md"
  - "src/core/states.ts"
  - "src/core/errors.ts"
  - ".planning/REQUIREMENTS.md"
covered_digest: "v3:sha256:c1c8e7c8095fb8fff967ce7b3eb080beaee8e25146b8ead2487d710ccd2019cb"
---

# Phase 37 Verification: spec update

Method: a read-only read of the merged spec, the two decision documents and the phase files on `origin/main` after `cca02fd`, on 2026-11-18. Commands run by the verifier: `xmllint --noout`, `grep` counts on the spec, `git diff` counts of the squash `90e7127` against its parent, `git log` for the spec, `gh pr view 157`. The verifier did not run the build, the test suite or any script from the plan; the figures in `37-01-SUMMARY.md` (acceptance scripts, `npm run check:docs`, 487 script tests, 52 docs tests) are the executor's report and are cited as such, not re-measured.

What this phase is: one owner-directed edit of the product spec (owner instruction of 2026-11-18, decision D-v5-6, HITL at the v5.0 milestone start), so that `docs/specs/realm-spec.xml` stops requiring a bridge that D-27-01 removed in v4.0 (Phase 28). What it is not: a rewrite of the spec. The original request is kept verbatim and the planning history that discusses the bridge is kept, marked with a `retired` attribute.

## Requirements coverage

| Req | Statement (REQUIREMENTS.md) | Status | Evidence |
| --- | --- | --- | --- |
| SPEC-01 | `docs/specs/realm-spec.xml` no longer describes the Anda bridge; the statements that require `andaUrl` or the degraded state are removed or retired; all other spec content is unchanged; the pull request records the owner's instruction of 2026-11-18 and the reason | MET | See the checks below |

## Checks run (all on the merged tree, the spec unchanged since `90e7127`)

- `xmllint --noout docs/specs/realm-spec.xml`: exit 0.
- `andaUrl`: 0 occurrences. `ANDA_`: 0 occurrences in the spec and 0 in `src/core/errors.ts`. `degraded` (any case, "degrad"): 0 occurrences. "six-state" and "six state": 0.
- `retired=`: 15 attributes, on the five planning NODE elements that discuss the bridge (n2, n3, n4, n7, n8) and on child elements; each reads "Statements about the Anda bridge in this element are history: the bridge was removed by owner decision D-27-01 (2026-11-17); spec edit instructed 2026-11-18". The remaining 41 lines that still contain "Anda" (65 mentions) are one of: the original request on line 2 (verbatim), a retirement statement (lines 31, 143, 186, 208: "Retired: ..."), or the body of a `retired` element. A grep for "Anda" outside those three classes was read line by line and found nothing that still states the bridge as a requirement. This residual check is a human read of 41 lines; the executor's script result is in the summary.
- Replacement wording (line 186): "The Anda bridge was removed (owner decision D-27-01, 2026-11-17; spec edited on the owner's instruction of 2026-11-18). Realm does not connect to Anda and has five states: unbound, connecting, active, error and stopping." The five states and the n6 transition table (line 317) match `src/core/states.ts` (`STATES`, `ALLOWED_TRANSITIONS`).
- Scope: `git diff --shortstat 90e7127^ 90e7127 -- docs/specs/realm-spec.xml` reads 1 file changed, 36 insertions, 43 deletions, the 43 lines of the owner's instruction. Of the 43 removed lines, 37 contain "Anda", "degraded" or `ANDA_`; the other 6 are the n2, n3, n4, n7, n8 element openers (which gained the `retired` attribute) and the one "six states" line (changed to five, OQ-37-02 default, inside the instruction). No other line differs. Line 2 (the original request) is untouched.
- Pull request: `gh pr view 157` reports MERGED on 2026-11-18T05:18:21Z; its body quotes the owner's instruction (HITL form, v5.0 scope item E), the reason (the bridge, `andaUrl`, the ANDA error codes and the degraded state were removed in v4.0 but the spec still required them), the counts and "history kept and marked retired".
- Decision record: `docs/integration/runtime-decision.md` carries D-37-1 (line 644: the instruction, the reason, what was removed, what was kept, the state count of five) and the Phase 27 table row (line 636) now reads "Superseded on 2026-11-18: edited by Phase 37 (D-37-1)". `docs/integration/anda-replacement-research.md` has an "Update 2026-11-18" in its status paragraph pointing to D-37-1; its evidence sections and read dates are unchanged.
- PR 157 changed six files: the spec, the two documents above, and the three phase files under `.planning/phases/37-spec-update/`. No code, schema, test, script, workflow, version, `ROADMAP`, `STATE`, `REQUIREMENTS` or `PROJECT` edit, as the plan's non-goals require.

## behavior_unverified

1. **No spec-to-code conformance test exists.** Nothing in `test`, `scripts` or `src` reads the spec (the executor's closing search found only a synthetic fixture line in `scripts/check/default-mode.test.mjs`). That the spec agrees with `src/core/states.ts` and `src/core/errors.ts` rests on this read and on the executor's scripts, not on a permanent check (37-CONTEXT D-37-09 chose none). A later edit to either side can drift unnoticed.
2. **The spec remains a large document with history kept.** It is 505 lines and still contains 41 lines mentioning Anda (65 mentions), by the owner's default (OQ-37-01: history kept and marked retired, not deleted). A reader or a tool that does not honour the `retired` attribute sees bridge discussion. "No longer describes the bridge" holds for requirements, not for every word.
3. **The "all other content unchanged" claim is by diff, not by an independent parse.** The verifier checked the line counts and the removed lines of the squash; the word-level diff and the scope script are the executor's report in the summary. The `retired` attribute is not part of any schema the repository validates (the spec has no DTD or schema run in CI; only well-formedness was checked).
4. **Operators with `andaUrl` configured are not reached by this edit.** The spec change is documentation. R-27-01 (the repository cannot show that no operator outside the audited hosts still has `andaUrl`) is unchanged and is mitigated by Phase 28's refusal message and the breaking-change release, not by this phase.

## Residuals (not verdict-blocking)

- **R1: planning bookkeeping.** This verification does not edit `ROADMAP.md`, `STATE.md` or `REQUIREMENTS.md`; `REQUIREMENTS.md` still shows SPEC-01 as Planned (line 412) and unchecked (line 215), and registering it as satisfied is the orchestrator's step.
- **R2: PROJECT.md.** Line 100 still calls the spec "read-only source of truth; do not modify" and line 102 still lists Anda among the external dependencies; the summary's hand-off named both for the orchestrator after the merge. Not edited here.
- **R3: other Anda mentions in `.planning/PROJECT.md`** (lines 127, 130: confirmed and decided rows) are historical decision-table entries of 2026-10, outside this phase's scope.

## Verdict

passed. SPEC-01 is met: the spec is well-formed, no longer contains `andaUrl`, `ANDA_` codes, the degraded state or a six-state count, states that Realm has five states and does not connect to Anda, keeps the original request and the bridge-related planning history marked retired, changed exactly the 43 instructed lines on `origin/main`, and the merged pull request and D-37-1 record the owner's instruction of 2026-11-18 and the reason. Nothing in the phase failed. The four items above are not proven and must not be claimed beyond what is stated: in particular nothing here says the spec is checked against the code by any automated test, or that the history in the spec is gone.


## Re-verification at main 7ae9afc (2026-11-22, autonomous)

Full local suite executed on main 7ae9afc: 5945 tests, 5849 pass, 0 fail, 96 skipped (Podman-gated). Prior verdict (passed) stands; covered files changed only by later merged phases.

_Re-verifier: Omp (main session)_

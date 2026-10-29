# Phase 11 verification: milestone v2.0 close

Status: VERIFIED (2026-10-29), with one removal that can only follow the merge of the pull request that carries this record (see criterion 2).

Method: the record is written after `gsd-tools milestone complete v2.0 --confirm`, because it records that step's result. Evidence is what the step printed, what git showed before and after it, and the files it wrote. Nothing was pushed or merged by the step.

## Success criteria

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | The gsd-tools milestone dry run completes before the milestone is completed | PASS | `milestone complete v2.0 --dry-run` exited 0 on 2026-10-28 (11-01-SUMMARY.md) and twice on 2026-10-29, once on main at release 0.2.0 and once at release 0.2.1. Each reported 11 phases and 12 plans, and each reported `audit: null` because the audit file did not exist yet. `--confirm` ran only after `v2.0-MILESTONE-AUDIT.md` was written. |
| 2 | Scratch profiles and worktrees created for the milestone are removed | PASS, with the closing worktree's removal following the merge | Profiles: the isolated Omp profile of the live checks was removed on 2026-10-28, and on 2026-10-29 a dead Omp daemon run directory that those checks had left in the realm account was found and removed (it held no configuration and nothing naming this repository). The host probes' isolated homes and scratch configurations lived in directories the probe script removed (none were left after either run). The orchestrator's evidence directory lost 2.5 GiB of regenerable build outputs (two Rust target directories and copies of `node_modules` and `dist`). The worktree and branch made to close the milestone (`chore/archive-milestone-v2.0`) exist until this change merges; they are removed afterwards, and the owner-side leftovers of the 2026-10-28 inventory (the rollback image, the Rust builder cache image, older scratch in the realm account) were not touched. |

## What the completion step did

- Observed result: `archived` roadmap, requirements, audit and phases true; `milestones_updated` and `state_updated` true; exit 0.
- Files: `.planning/milestones/v2.0-ROADMAP.md`, `v2.0-REQUIREMENTS.md`, `v2.0-MILESTONE-AUDIT.md` (moved from `.planning/`) and `v2.0-phases/` with the 11 phase directories (moved from `.planning/phases/`, which is now empty); `MILESTONES.md` and `STATE.md` rewritten.
- No commit and no tag: `git tag -l` printed the same six release tags (v0.1.0 to v0.1.3, v0.2.0, v0.2.1) before and after, and the branch held no commit ahead of main. Milestone completion does not touch the release tags, which the release job owns.
- What it did not do, and was done by hand as the workflow directs: collapse the v2.0 section of `ROADMAP.md` into its archived form (the same pattern as v1.0), update `PROJECT.md` ("Current State", "Next Milestone Goals"), and write the `MILESTONES.md` accomplishments (the tool found no one-line accomplishments, because this repository's summaries carry no frontmatter, and wrote "none recorded" and a doubled name). It also kept `current_phase`, `current_phase_name` and `stopped_at` in `STATE.md` from before ("preserved over disagreeing derived"), which were corrected by hand.
- `REQUIREMENTS.md` was kept in place, with a note at its head, because eight requirements are carried and this file is their live record until `/gsd-new-milestone`. Its archive copy is `v2.0-REQUIREMENTS.md`.
- The archived roadmap copy was taken before the roadmap's own Phase 11 entries were completed, so its Phase 11 lines were aligned by hand; the two files now agree.

## Carried, not closed

FS-02, ANDA-01 to ANDA-04, OMP-05 and PRD-DRV-01 are open, and UI-01 is an accepted limitation. Reasons, owners and the tech-debt register are in `v2.0-MILESTONE-AUDIT.md`; the next-milestone goals are in `PROJECT.md`.

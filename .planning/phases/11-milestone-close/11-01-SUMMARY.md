# Phase 11, plan 01 summary: milestone v2.0 close, up to the owner's confirmation

Status: executed up to the owner's decision (2026-10-28). `milestone complete v2.0 --confirm` was not run, `--force` was not used, and nothing was pushed, merged or released.

## 1. Sanctioned reorganisation (decision D-006)
The v1 phases 1 to 7 were wrapped in closed-milestone `<details>` blocks (summary text starts with the archive marker the GSD parser recognises), a Milestones list and a v2.0 milestone heading were added, and the archived v1 detail block was moved above the v2.0 heading, byte for byte, so that the v2.0 window holds only the milestone's own phases. Nothing was deleted. Checked against a copy taken first: 23 headings before and 25 after (the two added ones, none lost), the same 114 requirement-like identifiers, and no original line missing (the file grew from 343 to 361 lines). The write guard's shrink sentinel was not needed, because the file grew.

## 2. Roadmap analysis
`gsd-tools query roadmap.analyze` now lists the milestone's 11 phases (8, 9, 9.1 to 9.7, 10, 11) and no longer lists the v1 phases. Before the reorganisation it listed the v1 phases with no directory.

## 3. Dry run
`gsd-tools query milestone.complete v2.0 --dry-run` exits 0. It reports 11 phases and 11 plans, and would archive `ROADMAP.md` to `milestones/v2.0-ROADMAP.md`, `REQUIREMENTS.md` to `milestones/v2.0-REQUIREMENTS.md` and the 11 phase directories, and update `MILESTONES.md` and `STATE.md`. Two things the owner should know before confirming:
- It reports `audit: null`: there is no `v2.0-MILESTONE-AUDIT.md`. The only audit is the hand-written first pass in `10-02-TRIAGE-AUDIT.md`, which was flagged for ratification and predates phases 9.1 to 9.7.
- Its first two refusals before the reorganisation were "no phases found for milestone v2.0" (the roadmap had no v2.0 milestone heading) and "7 unstarted phases" (the v1 detail blocks sat inside the v2.0 window). Both are fixed by the reorganisation, not by `--force`.

## 4. Cleanup inventory
Removed (created by this milestone, safe): the isolated Omp profile and the scratch directories of the live checks, the diagnostic scripts, the tracing preload (and its line in the driver unit, restored to the content it had before), two scratch build contexts, the four old phase 9 image tags and dangling images, the temporary podman wrapper.
Checked and clean: the repository has one worktree (its own); no tmux server; no isolated Omp profile of this milestone in either account; after the final live run no containers, workspace entries, sandbox or secret directories, daemons or supervisors.
Kept, for the owner:
- the rollback image `phase9-runtime4` (the previous pinned image) and the Rust builder cache image `realm-runtime-builder:97` (2.96 GB, the cache that makes a rebuild fast);
- older scratch on the realm account from phases 9.1 to 9.5 that no running unit references and that this run could not prove it created: `config/realm/config.json` (a realm configuration, probably the account's own), `xdg` (60 KB), `realm-build` (79 MB), the containers runtime backup of 2026-10-25, and four small leftovers of ad hoc daemon runs;
- the private evidence directory of the orchestrator (3.5 GB of logs, probes and the saved reviews).

## 5. For the owner
- The single command that completes the milestone, only after the owner decisions below, is `gsd-tools milestone complete v2.0 --confirm` (the workflow then reorganises `ROADMAP.md` again, archives the phase directories and writes `MILESTONES.md`). It is irreversible. Run it from a clean state of this branch.
- The ship (push, PR, merge, release 0.2.0) is separate and still held. The circularity to settle: Phase 10's plan 04 and the ship assessment expect the milestone's phases to be complete, and the milestone completion expects the ship's outcome to be known.
- The decisions are listed in `09.7-VERIFICATION.md` under "Open owner decisions" (12 items) and in `10-03-SUMMARY.md` (ship readiness).

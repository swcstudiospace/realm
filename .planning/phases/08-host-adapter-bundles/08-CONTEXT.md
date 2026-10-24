# Phase 8 context: Host Adapter Bundles

Requirements: HOST-01, HOST-02 (see the v2.0 section of .planning/REQUIREMENTS.md).

## Decisions

- HOST-02 wording was amended by owner decision on 2026-10-24. Prime Agent has no validator subcommand, so its check is an isolated project-local install followed by a package list. The ratified wording is in the commit dcb11dc.
- Muse Code's validator needs MUSE_EXPERIMENTAL_PLUGINS=1 in the environment.
- No host configuration outside this repository is changed in this phase. HOST-03 is phase 10.

## Accepted grey areas

- None open. The owner answers above are the accepted decisions.

## Quality divergences

- None recorded for this phase.

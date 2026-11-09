---
task: 261109-6ta
status: complete
---

# Repair tarball smoke check

The milestone Finish build checks the exact tagged-worktree tarball and expected version with the current checker, using the historical source root, before generating notes or assets. The same tarball path reaches the handoff. Local regression fixtures execute the checked-in workflow block with fake commands; they do not prove a GitHub release.

Code commit: `75631f4`. Updated `.github/workflows/ci.yml` and `scripts/check/pack-smoke.test.mjs`.

Verification: typecheck, lint, build, pack-smoke tests, full `npm test`, script tests, `check:docs`, `check:gates`, `check:pack` and `check:mcp` passed. Actionlint passed with the self-hosted runner label configured and pre-existing SC2016 informational findings ignored; a bare actionlint run reported those findings. Human review of the workflow change is required before merge. No release or deployment was run.

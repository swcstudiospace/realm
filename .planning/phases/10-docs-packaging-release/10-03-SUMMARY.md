# Phase 10, plan 03 summary: HOST-03 audit and ship paperwork

Status: complete for what the plan covers (2026-10-28). Plan 04 (PR to main, merge, release 0.2.0) is held by the owner's ship hold of 2026-10-24 and was not started. Nothing was pushed, no PR was opened, nothing was merged or released, and no host configuration was written.

## HOST-03, first clause: no host configuration changed
Audit of 2026-10-28 (read only, names and counts only; the script is not kept):
- For Claude Code, Grok Build, Muse Code, Hermes Agent and Omp, in the root account, the configuration locations named in `docs/integration/hosts.md` were present and held 0 files that name this repository or the realm entry points (`realm mcp`, the CLI entry, the Omp extension entry).
- In the realm account none of those host locations exist (it runs only the realm production stack and one isolated Omp profile, now removed).
- The Claude Code backup files (the residual noted earlier): five hidden `.claude.json.backup.<timestamp>` files, all written on 2026-10-28 between 18:08 and 19:36 UTC by the Claude Code instances that are running on this host (29 Claude processes at the time). None of them, and not `.claude.json` itself, names this repository or its entry points. They are Claude Code's own rolling backups. The audit cannot say whether the earlier non-isolated validate run left a backup of its own, because only today's five exist; it can say that nothing in any backup or configuration refers to this repository.
- No host-local path appears in `src`, `adapters` or `scripts`.

What this milestone changed outside the repository, all on the realm account's own production stack: the compute driver's unit (sandbox image digest, the optional supervisor pin), the installed application directory (refreshed from the final build), images (old phase 9 images untagged, the new image built, the rollback image kept) and, for the live Omp checks, one isolated Omp profile that was created and then removed. No other account's configuration and no host configuration was changed.

## HOST-03, second clause: the bundles ship and the pack check asserts them
`npm run check:pack` exits 0 on the final tree: it asserts the six adapter manifests, the declared bin entries and the Omp extension entry, and the six driver protos. `npm run check:docs` exits 0: the host snippets match their host notes, no host-local path, AGENTS.md and CLAUDE.md in sync.

## Adapter manifest version fields
The four manifests that carry a release version (`adapters/claude-plugin/.claude-plugin/plugin.json`, `adapters/muse-code/.muse-plugin/plugin.json`, `adapters/hermes-agent/plugin.json`, `adapters/prime-agent/package.json`) read 0.1.2, the same as `package.json`. The release job rewrites them and pull requests never edit them, so they were left alone. Whether new files may carry an initial version is an owner question.

## Ship readiness list (nothing here was done)
- Owner decisions: lift the ship hold; `autoMerge` is true in the ultrathink config, while AGENTS.md requires human review for `.github/workflows/**`, `release/**` and `scripts/release/**`. The branch changes five such files: `.github/workflows/ci.yml`, `.github/workflows/pages.yml`, `release/milestone.json`, `scripts/release/sync-version.mjs` and its test. A merge through the automated flow would skip the review the rule asks for.
- The branch is 145 commits ahead of `origin/main` and 3 behind (the last fetch was on 2026-10-24); a rebase or merge of those three commits is needed before a PR.
- Tracking: Linear could not be written (free-issue limit), so tracking is Notion only and partial.
- The Greptile review (5 out of 5, no open comments) and the green CI run have not been run on this branch.
- Release 0.2.0 itself belongs to the release job; the CHANGELOG and version fields are not edited by hand.

## Requirements
HOST-03: both clauses are evidenced; the traceability row says so. The release step is not part of the requirement's text and stays held with plan 04.

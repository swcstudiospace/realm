# Phase 10, plan 04 summary: reserved-file review, PR to main, merge and release 0.2.0

Status: complete (2026-10-29). Pull request 6 was merged to main by the ship flow as merge commit 550a41f, the release job cut v0.2.0 (release commit 84d937c, annotated tag v0.2.0, GitHub release Realm v0.2.0 with three assets), and the released tarball was installed on the realm account and passed the nine-scenario live suite. Nothing is published to npm (`package.json` has `private: true`). Open items that were accepted or deferred, not closed here, are listed under "What was not done and why".

How to read the evidence: repository and GitHub facts (commits, tag, release, CI runs, review states) were re-read read-only when this record was written. The host observations (install on the realm account, the live suite, the live ACP run, the Pages site answering) and the pre-merge gate numbers are the orchestrator's observations of 2026-10-29; they were not re-run for this record and are marked (host) or (gates).

## What the owner instruction of 2026-10-29 changed
The 2026-10-28 decision lifted the ship hold with `autoMerge` off for pull request 6: the owner was to review the reserved files and merge by hand. The request of 2026-10-29 ("review our reserved files and upgrade them as expected ... auto merge to our main branch") supersedes that. It authorised an automatic merge to main and delegated to the run the human review that AGENTS.md requires for `.github/workflows/**`, `release/**`, `scripts/release/**`, `LICENSE` and `NOTICE`. The delegation is recorded in `10-04-PLAN.md` (Owner instructions) and in the pull request body. The note in `ROADMAP.md` about the 2026-10-28 hold (autoMerge off, owner merges by hand) is therefore historical; it was true when written and no longer describes how the PR landed.

## The reserved-file review
Plan: `10-04-PLAN.md`. Per-file ledger with before, after and evidence: `10-04-RESERVED-FILES.md`; it is not restated here.

Lanes: rf1 workflows and a release dry run under three merge methods; rf2 CI security; rf3 licence, NOTICE and release integrity; rf4 release scripts and the docs contract. Then v1, an adversarial security review of the final workflows, and v2, a rehearsal of the release job against a bare remote with five failure injections (each left main and the tags unchanged, per the ledger).

Applied upgrades, by commit:
- 943e15e `scripts/release`: `sync-version.mjs --files` lists the version files, the changelog omits commits scoped `planning`, release assets (`SHA256SUMS`, CycloneDX SBOM) are written, `next-version.mjs` is importable, with tests.
- 7746e1a `ci.yml`: no persisted credential, `npm ci --ignore-scripts`, the token reaches git only in the push step, the tag must be an ancestor of main, checksums and SBOM attached to the release, `needs: [verify, site]`.
- ef0f1a0 `pages.yml`: `permissions: {}` at workflow level, per-job grants (build: contents read and pages read; deploy: pages write and id-token write), `workflow_dispatch` only.
- 2e4e833 `NOTICE` third-party section and `licenses/Apache-2.0.txt`, shipped in the package and asserted by the pack check. `LICENSE` was reviewed and left unchanged (canonical GNU AGPL-3.0).
- 86bcb36 TOOL-05: the ACP tool method is now the spec-reserved `_realm/tool`, and `initialize` advertises it.
- d524d23 contributor docs, the supported line (0.2.x) and the release-flow rules.
- f06bf27 planning records for the review, TOOL-05 and the verification of the run.

Finding Greptile added to this change: one P1 against f06bf27, the Pages dispatch rule (see "The Pages dispatch lesson"), fixed in 2b468a7 with 7141b5e and b8de12d recording it. The earlier Greptile findings on this branch (rounds 1 and 2) concern phase 9.7 code and are recorded in `../09.7-review-finding-remediation/09.7-VERIFICATION.md`.

## The review loop
Review states read from the GitHub API on pull request 6; scores and fixes are from the records and the orchestrator's account.

| Round | Head | Score | Finding and fix |
|---|---|---|---|
| 1 | d9298c0 | 0 of 5 | Five findings, all fixed: 94b401d, 993e294, 1c029bc, 0813010, c3a65d4 |
| 2 | de2ce0d | 4 of 5 | One regression from the round-1 supervisor fix, fixed in 17cba3f |
| 3 | 2c401b5 | 5 of 5 | No comments |
| 4 | 278005a | 5 of 5 | No comments |
| 5 | f06bf27 | 4 of 5 | One P1: Pages was skipped when the release succeeded but the dispatch failed; fixed in 2b468a7 |
| 6 | b8de12d | 5 of 5 | No comments; the API review state is APPROVED |

The API lists six Greptile reviews (COMMENTED on d9298c0, de2ce0d and f06bf27; DISMISSED on 2c401b5 and 278005a, which later pushes superseded; APPROVED on b8de12d), seven inline review comments in total, and no pull request comments. That the final head has zero unresolved threads is the orchestrator's reading; this record did not query thread resolution. Checks on the head b8de12d: Build docs site, Verify (Node 22.x), Verify (Node 24.x) and Greptile Review succeeded; Release was skipped on a pull request, by design.

## Merge and release
- Merge: through the ship flow's merge step, never `gh pr merge`, with the merge method merge commit, giving 550a41f (parents e99f62b, the v0.1.3 release commit, and b8de12d) at 2026-10-29T04:39Z. Reason: the changelog lists `git log --no-merges`, so a squash would have reduced the 0.2.0 notes to one line and stranded the commit ids these records cite. AGENTS.md now states that rule.
- CI run 40819008323 on 550a41f: Verify (22.x and 24.x, including the MCP smoke step) and Build docs site succeeded, and the Release job succeeded in every step (finish, plan, sync, changelog, build and pack, checksums and SBOM, commit, atomic tag and push, GitHub release, Dispatch Pages workflow).
- Release commit 84d937c `chore(release): v0.2.0 [skip ci]` by github-actions[bot], parent 550a41f, seven files: `CHANGELOG.md` and six version files (`package.json`, `package-lock.json`, and the four adapter manifests), all 0.2.0. Annotated tag v0.2.0 points at 84d937c, an ancestor of main.
- GitHub release Realm v0.2.0, published 2026-10-29T04:43:56Z, not a draft. Assets: `agent-realm-0.2.0.tgz` (319223 bytes), `SHA256SUMS` (88 bytes), `agent-realm-0.2.0.cdx.json` (46437 bytes; CycloneDX 1.5, 51 components, main component agent-realm@0.2.0). `sha256sum -c` on the downloaded `SHA256SUMS` was OK (host). The tarball holds LICENSE, NOTICE, `licenses/Apache-2.0.txt`, README.md, CHANGELOG.md, adapters, `src` (protos and schemas) and `dist` (164 files) (host).
- `CHANGELOG.md` section 0.2.0: 135 entries in six groups (Added, Changed, Fixed, Security, Documentation, Maintenance), counted from the file at 84d937c; none scoped `planning`.
- Pages: the release job dispatched `pages.yml` (run 40819384185, `workflow_dispatch`, sha 84d937c); its Build site and Deploy to GitHub Pages jobs both succeeded. This was the first live proof of the per-job permissions, which the ledger had said only a deploy from main could show. The site named by `homepage` answers HTTP 200 and shows the 0.2 and v2.0 content (host).

## Install and live proof (host)
The released tarball was installed on the realm account, the owner's production stack: gateway and driver stopped, `dist`, `adapters`, `src` and `licenses` replaced, both restarted. The gateway logged Compute driver connected (configured and advertised driver realm). Against the build installed earlier, the released compiled output differs only in a comment header of `seccomp-profile.js`. The production live suite (`test/integration/production-driver.test.ts`, nine scenarios) ran on the installed 0.2.0 stack: 31 tests, 31 pass, 0 fail, 0 skipped, 466 s. Afterwards: no containers, no workspace or sandbox state, no daemons or supervisors, all three user units active, and the rollback image kept.

Earlier gate evidence on the pre-merge tree f06bf27, whose code the later commits did not change (gates): typecheck, lint, `check:docs`, `check:pack` and `check:mcp` exit 0; `npm test` 1846 tests, 1836 pass, 0 fail, 10 skipped; `test:scripts` 126 of 126; actionlint with shellcheck reports only an intentional SC2016 info; a live ACP client run against the production stack, 67 checks, 0 failed (TOOL-05). These were not re-run on 550a41f or 84d937c locally; CI on 550a41f ran the verify job above.

## What was not done and why
- Build-provenance attestation and the release job split. `actions/attest` needs `id-token: write`, which every step of the job would then hold, including those that run dependency code, and it could not run before the first release on main. The safe design is an unprivileged build job and a privileged publish job; that split also closes a channel the adversarial review found (build code and the push step share a user). The push step now pins git's configuration and hooks, which narrows it. Recorded as a follow-up for the owner.
- Deferred owner items from the ledger: repository settings (secret scanning, push protection, Dependabot, `sha_pinning_required`, branch protection or rulesets, Actions approving pull requests, the `omega-ci` runner group visibility); a Dependabot configuration for the SHA-pinned actions; a `license` field in the muse-code and hermes-agent manifests; amendments to the product specs; Podman probe classification.
- Open or accepted at the end of phase 10, not closed here: OMP-05 (needs a model call; the provider was out of quota), ANDA-01 to ANDA-04 (engine licence conflict), FS-02 (accepted approximation), UI-01 (accepted limitation), PRD-DRV-01 (awaits the owner).
- The version strings in `src/acp/agent.ts` (line 31) and `src/mcp/server.ts` (line 24) still read 0.0.0; noted, not changed.
- Linear tracking stayed blocked by the free-issue limit; tracking is Notion only (see `STATE.md`).

## The Pages dispatch lesson
The release job must deploy Pages exactly once per release content and never a newer push whose verify has not finished. Three formulations were tried; two were wrong.
1. Published, or skip (the rehearsal's). It broke the recovery path in which a rerun repairs a release and then plans as superseded.
2. Published, repaired, or skip. It still skipped Pages when the release succeeded but `gh workflow run` failed: the rerun finds the release, repairs nothing, and plans as superseded because main already holds its own `[skip ci]` release commit. Greptile found this in round 5 on f06bf27.
3. Dispatch exactly when the tip of main is a release commit (`chore(release): v...`). That content passed verify and was released, so the rule covers a publish, a repair and a retry of a failed dispatch, and it cannot deploy a newer unreleased push. This is the invariant, implemented in 2b468a7 and exercised against a bare remote with a stub `gh` in five tip states (ordinary commit, release commit, the same retried, a newer unreleased push, that push released).

The lesson: state the rule as the property the deploy must have (the tip is released content), not as a list of release outcomes that may trigger it, because a recovery path adds outcomes the list does not name.

## After the release: the real-host check and release 0.2.1
When this plan's evidence was complete, the released build was run with the real hosts for the first time (isolated homes, the realm account's production stack, connection checks only). It showed that release 0.2.0 could not be used from Claude Code: `claude mcp list` failed with "Server's protocol version is not supported: 2026-07-28", because the MCP server answered `initialize` with a revision a legacy client does not know. Reading the revision's schema and the Anthropic API's tool-schema restriction then found two more defects in the same surface (results without a `content` block or `resultType`, and an `exec` descriptor with a root `oneOf` that the API rejects with a 400 that fails the whole request), and the agent surfaces advertised 0.0.0. Pull request 7 (merge commit 2c818c4) fixed them and the Omp attach's probe, and release 0.2.1 (release commit 8b3ff55) shipped them: Claude Code connects, Grok Build connects and lists the six tools, and the production live suite passes 31 of 31 on the installed 0.2.1. The finding, its sources and the evidence are in `docs/integration/mcp.md` Q6 and in section 1 of `v2.0-MILESTONE-AUDIT.md`. What this record says about TOOL-05 and the 0.2.0 release stands as what was verified then; the audit holds the corrected picture.

## Commits
Subject lines as in `git log`, oldest first:
- 943e15e `feat(release): list the version files, omit planning commits and write release assets`
- 7746e1a `security(ci): keep the release token away from dependency and build code`
- ef0f1a0 `security(pages): grant each Pages job only what it calls and deploy only after a release`
- 2e4e833 `docs(legal): attribute the vendored Apache-2.0 material and ship its licence text`
- 86bcb36 `fix(acp): serve the tool method as the spec-reserved _realm/tool and advertise it`
- d524d23 `docs: align the contributor docs and the support window with the release flow`
- f06bf27 `docs(planning): record the reserved-file review, TOOL-05 and the verification of this run`
- 2b468a7 `fix(ci): dispatch Pages when the tip of main is a release commit`
- 7141b5e `docs: state the Pages dispatch rule as the code now implements it`
- b8de12d `docs(planning): record the Pages dispatch finding and its resolution`
- 550a41f `Merge pull request #6 from swcstudiospace/feat/realm-v2-0`
- 84d937c `chore(release): v0.2.0 [skip ci]`

## Rollback
To return the code to 0.1.3 (release commit e99f62b, tag v0.1.3, asset `agent-realm-0.1.3.tgz` on its GitHub release): revert the merge commit 550a41f on main through a pull request (a merge commit needs the mainline named, parent 1), never by rewriting main. Two consequences the owner decides:
- The release commit 84d937c is a separate commit; reverting only 550a41f leaves the version files and `CHANGELOG.md` at 0.2.0. Whether to revert 84d937c as well is the owner's call.
- The tag v0.2.0 and the GitHub release Realm v0.2.0 are not touched by a revert. What to do with them (keep, mark, withdraw) is the owner's decision; no tag command is given here. The release flow plans the next version from `release/milestone.json` and the existing tags.

The production stack is returned by installing the 0.1.3 tarball from its release the same way 0.2.0 was installed (stop gateway and driver, replace the installed directories, restart). This was not rehearsed for 0.1.3.

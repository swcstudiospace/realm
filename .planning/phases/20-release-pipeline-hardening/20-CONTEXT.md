# Phase 20: Release pipeline hardening - Context

**Gathered:** 2026-10-31, task `Trealm31-gsd-records`, correlation `ut-mvvowl70-29165019`.
**Status:** Context recovered from D6, phase13 research Part D and scout5; implementation in open PR40 is not release-run verification. No release action or checker executed by this records task.

<domain>
## Phase Boundary

REL-01..04: least-privileged build/publish separation, verifiable normal/repair provenance, manual test-release rollback that really re-points docs, and changelog filtering of later-removed features. Depends on phase13 pipeline changes and runs last after runtime acceptance. Does not authorize repository settings or version/CHANGELOG editing by specialists.
</domain>

<decisions>
## Implementation Decisions

### Binding approval and ownership

D6 authorizes necessary workflow/release-script changes with D6 cited in PR bodies. Parent's current approved gated-merge/test-release path supersedes scout5's older “approval missing” observation; preserve both chronology and the current permission. A15 never merges, pushes, dispatches Pages/rollback or creates/releases artifacts. Gated parent authority is not arbitrary production rollback approval. PR40 head cd873687 and w-release are retained references; do not rewrite/force that branch or assert its present head from old metadata.

### Reuse implementation, close real gaps

- Scout5 found unprivileged build/privileged publish split, normal+repair six-file attestation, draft-resumable completion and guarded atomic tag logic already implemented. Do not redesign into the older research's optional release.yml merely because it was recommended there.
- Keep privileged publish free of npm install/build/pack/dependency code; trusted built-in-only regeneration and byte equality with planned artifacts stay before mutation. Preserve normal and repair tarball/SHA256SUMS/SBOM subjects, repair ancestry checks and draft/upload/check/undraft protocol. Published incomplete assets must fail, not silently repair or skip.
- QR-03 also requires actual Finish/repair tarball/version smoke before mutation, not just normal-release smoke. Coordinate with phase13's single ci.yml owner.
- REL-04 cannot be closed by canonical `This reverts commit` pairs only. The real debt included multi-commit features removed by refactors, including shared/mixed surviving files. Implement maintainable explicit relationship semantics or demonstrated general path semantics covering actual behavior, no hard-coded historical SHAs. Preserve unrelated same-title/scope commits, renamed survivors and truthful removal notes for features shipped earlier. Never regenerate old published CHANGELOG to fabricate closure.
- REL-03 requires validated known-good documentation source through rollback and Pages; redeploying default branch still containing withdrawn content is not repointing. Validate tag/ref/ancestry/trust before dispatch, pass user input via environment/data rather than shell interpolation and prove resulting deployed content, not dispatch success alone.
- Job token separation does not prove separate OS users/ephemeral machines on shared self-hosted runners. Record residual runner isolation limits without a fabricated SLSA/security claim.

### Implementation discretion

Use existing release plan, version sync, assets, changelog and workflow patterns. Current supported APIs/actions/pins remain unless an assigned defect requires change. No dependency/runtime upgrade, new publication channel or production rollback beyond explicit approval.
</decisions>

<canonical_refs>
## Canonical References

- `.planning/REQUIREMENTS.md` REL-01..04; `.planning/MILESTONE-CONTEXT.md` D6 and ordering.
- `.planning/phases/13-quality-ratchet/13-CONTEXT.md`, `13-01-PLAN.md`, `13-RESEARCH.md` Part D (historical design, not automatic cutover instruction).
- `.planning/milestones/v2.0-MILESTONE-AUDIT.md` TD-08 source debt, as cited by scout5.
- `.planning/phases/RECOVERY-2026-10-31.md` scout4/5 source-vs-execution matrix, P13A/P20 and current approval chronology.
- `.github/workflows/ci.yml`, `rollback.yml`, `pages.yml`; `scripts/release/changelog.mjs`; `AGENTS.md` protected-path review rules. Future owners must inspect the actual PR40/current integration source before editing.
</canonical_refs>

<code_context>
## Existing Code Insights

Scout5 read PR40's seven changed-file diffs and source. Canonical-revert filter exists, known-good docs selection does not. Normal/repair paths already handle absent release, partial draft, complete published release, intentionally failed incomplete publication, ancestry and retry after atomic tag push. Release execution evidence still absent from the scout's scope. Existing temp-repository tests can model non-revert multi-commit histories; fake gh/git harnesses can verify nonpublishing decisions, not actual GitHub behavior.
</code_context>

<specifics>
## Required Evidence

P20: exact-current-head parent checks/review first, actual release run permission/artifact-handoff logs, downloaded subjects/digests with successful gh attestation verify, and approved test-release isPrerelease before/after plus rollback/Pages/deployment URLs and known-good deployed SHA/content. Source existence, old PR-author tests or APPROVED/Greptile metadata alone cannot satisfy them.
</specifics>

<deferred>
## Deferred Ideas

TD-10 settings stay owner-excluded. No spec, legal notices, version fields or CHANGELOG edits. No workflow dispatch/service/release/merge in this edit-only wave. Milestone audit/completion/cleanup waits for all required verified behavior and authorized deletion approval; no SUMMARY/VERIFICATION is created here.
</deferred>

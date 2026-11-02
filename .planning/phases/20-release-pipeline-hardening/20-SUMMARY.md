# Phase 20 summary: release pipeline hardening

Date: 2026-11-02. Lane: `gsd/v3-lane-a` (worktree `agent-realm-lanes/v3-lane-a`), on top of phase 13 (`ab7db34`, `9076532`). Source of acceptance: `20-CONTEXT.md` and `.planning/REQUIREMENTS.md` REL-01 to REL-04, under the D6 rule (workflow and release-script changes are signed off, cited in the PR body).

**Status: partially complete.** Code is on the lane for REL-01 to REL-04. REL-03 and REL-04 have local evidence. REL-01 and REL-02 come from PR #40, which is open and has not been through human review. Live release-run and test-release evidence is owner-gated and not produced here. No release, tag, publish, workflow dispatch, merge or PR state change was made.

## Lane commits

Source commits are the PR #40 head commits (`ci/release-build-publish-split`), cherry-picked in order onto the lane. PR #40 itself is not changed; its head stays `cd87368`.

| Lane commit | Source commit | Requirement | Change |
|---|---|---|---|
| `cbec121` | `da68a18` | REL-01, REL-02 | Release job split into an unprivileged build job (`contents: read`) and a privileged publish job; publish downloads only the build artifacts and runs no npm install, build or pack. |
| `b9658df` | `148559e` | REL-03, REL-04 | Rollback workflow added; changelog drops canonical revert pairs (superseded by `60b3934` below for rollback and REL-04). |
| `9752048` | `61032cf` | REL-01, REL-02 | Publish regenerates the release commit and `CHANGELOG.md` with trusted built-in code; byte equality with the packed tarball is checked. |
| `b29db2e` | `ac972e4` | REL-02 | Publish retries idempotent; ancestry checked first; one release date per run. |
| `8782614` | `a6eb46b` | REL-01, REL-02 | Documentation of the build and publish jobs, attestation and rollback (`AGENTS.md`), and `docs/integration/openshell.md`. |
| `a2f94da` | `14d2fc3` | REL-02 | Releases created as drafts and published only after every asset is uploaded. |
| `e2c3761` | `cd87368` | REL-02 | A release is skipped in the build job only when it is published with every expected asset. |
| `60b3934` | (this lane) | REL-03, REL-04 | Rollback publishes docs from a validated known-good tag (`docs_tag`, `source_ref` input to `pages.yml`); changelog drops features removed by a non-revert refactor through `Removes: <sha>` trailers. Tests and AGENTS.md text in the same commit. |

Phase 13 `QR-03` smoke for the release tarball (`--tarball` and `--expect-version` after the version sync) is in PR #40's build job (`Smoke the release tarball`), before any upload or remote write.

## REL-01: build and publish split (PR #40 source, lane `cbec121`, `9752048`, `b29db2e`, `a2f94da`, `e2c3761`)

- The build job holds `contents: read` only (`.github/workflows/ci.yml`, release job, build section). The publish job holds `contents: write`, `actions: write`, `id-token: write` and `attestations: write`, and runs in the `release-main` concurrency group.
- Status: implemented and configured. Verified only as configuration. The first real release run with per-job permissions and artifact handoff is owner-gated (L4) and was not run.

## REL-02: provenance (PR #40 source, lane `cbec121`, `a2f94da`, `e2c3761`)

- The publish job attests build provenance with `actions/attest-build-provenance` over the tarball, `SHA256SUMS` and the SBOM, plus the milestone files when present, before any tag is pushed (`ci.yml`, publish job, attest step).
- Status: implemented. Verified only as configuration. Downloaded-subject attestation proof with `gh attestation verify <file> --repo swcstudiospace/realm` is live-gated and not produced here.

## REL-03: rollback to known-good docs (lane `60b3934`)

- `rollback.yml` takes `tag` (the release to withdraw) and `docs_tag` (the known-good release). Validation runs before any change: both match `v<major>.<minor>.<patch>`; `docs_tag` differs from `tag`; `docs_tag` is an existing tag whose commit is an ancestor of the default branch; its release is published (not a draft or prerelease). Only then does it mark `tag` a prerelease and dispatch `pages.yml` with `-f source_ref=<docs_tag>`.
- `pages.yml` gains a `source_ref` input (default empty, which builds the dispatched branch, as the release job does). A validation step runs before checkout. Checkout uses `ref: ${{ inputs.source_ref }}`.
- Inputs reach the shell only through `env`.
- Limits recorded in AGENTS.md: the build job runs the known-good tag's site build on the shared self-hosted runner, with no write grant; the deploy job runs no code from the tag; the validation checks are the only gate on which tag is published.
- Status: implemented. Copies of the validation shell blocks of both workflows were run outside the repository with a fake `gh` (the copies are not the workflow files, which GitHub has not executed): 12 cases (tag and docs_tag format, same-tag refusal, injection and command substitution refusal, a branch name refused as a tag, empty and tag `source_ref`, branch and injected `source_ref` refused, ancestry on the default branch accepted, a tag off it and a missing tag refused). The release-state mapping (`published`, `draft`, `prerelease`) was checked against three fixtures with the same `jq` expression. Live rollback, Pages deployment and deployed-content proof are L4 and were not run.

## REL-04: features removed without revert (lane `60b3934`)

- `scripts/release/changelog.mjs`: a commit that removes earlier feature commits without `git revert` names each one in `Removes: <sha>` trailer lines. Named in-range commits leave the changelog. The removing commit leaves too when every commit it names is in the range; a removal that names an earlier release's commit stays, so the removal of a shipped feature is still recorded. Reverts are applied first, so a revert of a removal restores the features. Selection is by commit id, never by subject or file.
- Tests (scratch repositories, `scripts/release/changelog.test.mjs`): multi-commit removal; a later fix touching the same file; a later refactor renaming the module of a removed feature; same-title unrelated commit; revert of the removal restores the feature; removal of a feature from an earlier release with an in-range co-named feature. Six new tests, all pass, with the 20 PR #40 tests the file totals 26.
- Limits: the convention applies to removals made after this change. Removals made before it carry no trailer and are not reconstructed. The published `CHANGELOG.md` is not edited. TD-08 is closed for the removal-by-trailer semantics only; it is not claimed for removals written without the trailer.

## Gates

Run once on the phase 20 tree (`e2c3761` plus the REL-03 and REL-04 edits, committed as `60b3934`), heavy slot 1. Exit codes from the gate runner's log (kept out of the repository):

| Gate | Exit | Counts |
|---|---|---|
| `npm run typecheck` | 0 | |
| `npm run lint` | 0 | |
| `npm run build` | 0 | |
| `npm test` | 0 | 2537 tests, 2504 pass, 0 fail, 33 skipped |
| `npm run test:integration` | 0 | 202 tests, 171 pass, 0 fail, 31 skipped |
| `npm run test:scripts` | 0 | 294 tests, 294 pass, 0 fail |
| `npm run check:docs` | 1, then 0 | Failed on host-local evidence paths in the phase 13 records; fixed in `9076532`; re-run exit 0 |
| `npm run check:gates` | 0 | |
| `npm run check:pack` | 0 | |
| `npm run check:mcp` | 0 | |
| `npm run test:coverage` | 0 | 2537 tests, 2504 pass, 0 fail |

The `test:scripts` count rose from 286 (phase 13) by 8: 6 REL-04 tests and 2 PR #40 changelog tests.

## Owner items (not done here)

- **PR #40 human review (D6).** Required before merge. Its files (`ci.yml`, `rollback.yml`, `AGENTS.md`, `changelog.mjs`, `changelog.test.mjs`, `docs/integration/openshell.md`, `sync-version.mjs`) are protected paths. The lane's `60b3934` changes `rollback.yml`, `pages.yml`, `changelog.mjs` and `AGENTS.md` beyond PR #40, so PR #40's review does not cover them.
- **Live release run (L4).** Real per-job permission logs, artifact handoff, downloaded normal and repair subjects, `gh attestation verify` output, and the absent/draft/partial/complete/superseded release cases. Requires the owner's approved route.
- **Approved test-release rollback (L4).** `isPrerelease` before and after, rollback, Pages and deployment URLs, and deployed known-good SHA and content. Dispatch success is not evidence.
- **Runner isolation.** Job token separation does not prove separate OS users or ephemeral machines on the shared self-hosted pool. Residual risk is recorded, not claimed as isolated.
- **PR #47** (`feat/v3-qr-release`, draft): not merged or marked ready. Unchanged on the owner's side.
- No `ROADMAP.md` or `STATE.md` edits on the lane (delta in the yield). No `CHANGELOG.md` or version field edits.

## Omp version

Not observed: `omp --version` is blocked by the shell guard in this lane. The lead's stated version is 18.15.0. UNVERIFIED here.

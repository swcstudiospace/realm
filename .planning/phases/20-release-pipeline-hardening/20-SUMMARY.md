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

## Wave 2: branch gsd/v3-release-wave2 (local only)

Date: 2026-11-02. Branch `gsd/v3-release-wave2`, created from `9ab241f` in the lane worktree `agent-realm-lanes/v3-release-wave2`. Local only: no push, no fetch, no `gh` write, no edit to the main worktree or the WIP worktree, no workflow file merged to main. The D6 human review gate for PR #40 is unchanged.

| Commit | Unit | Requirement or finding | Change |
|---|---|---|---|
| `13a92fe` | PR #40 local integration | REL-01, REL-02 | `git merge --no-ff ci/release-build-publish-split`; the merged tree is unchanged, see below |
| `a559e68` | Q0-012 | observability | A failing bridge listener writes one warn line, `anda.listener_failed`, with its catalogue code |
| `5ca26cc` | Q0-014 | test quality | The spawn-env child renames a complete file into place; a `}` in a value round-trips |
| `a710667` | Q0-015 | test quality | On CI, a missing second device fails the cross-device sweep test instead of skipping |
| `06ff73a` | Q0-007 | dead code | `export-usage-gate` fails on src exports with no importer, with an explicit allowlist; not in `check:gates` |
| `66d315e` | Q0-012 follow-up | lint | Diagnostic assertion rewritten as one structured record (two lint errors) |

### PR #40 integration (REL-01, REL-02, REL-03, REL-04)

- Read-only `gh pr view 40`: OPEN, not a draft, not merged, head `cd873687e88be7525800e6a783c1e42274b29b4e`. It matches the local ref `ci/release-build-publish-split`, so integration went ahead.
- `git cherry 9ab241f ci/release-build-publish-split`: all seven PR #40 commits (`da68a18`, `61032cf`, `ac972e4`, `a6eb46b`, `14d2fc3`, `cd87368`, `148559e`) have patch-equivalent commits already on `9ab241f`. Lane A cherry-picked them earlier (the wave-1 table above). The merge therefore records the integration without changing the tree.
- Four files conflicted: `.github/workflows/rollback.yml`, `AGENTS.md`, `scripts/release/changelog.mjs` and `scripts/release/changelog.test.mjs`. Each was resolved to the `60b3934` side (REL-03, REL-04). That side is a superset of PR #40's older variant (`148559e`, `ac972e4`), which it replaces. The merge message records this choice.
- Requirement status is unchanged from wave 1: REL-01 and REL-02 are configuration only, REL-03 and REL-04 have local evidence, and every live proof is HELD for the owner (L4).

### Quality findings (Q0-007, Q0-012, Q0-014, Q0-015)

Each item has a failing-before and a passing-after result, recorded in the wave-2 section of `20-VERIFICATION.md`.

- Q0-012: `deliver()` in `src/anda/client.ts` logs a failing listener with its catalogue code. The bridge receives the daemon's request logger. The other listeners still run.
- Q0-014: the spawn-env child writes a temporary file and renames it. `waitFor` reads only the renamed path, and a new case round-trips a `}` inside a value.
- Q0-015: with `CI` set, a missing or shared `/dev/shm` fails the cross-device test with the reason. Locally the test still skips, with the same reason.
- Q0-007: `scripts/check/export-usage-gate.mjs` fails on `self-only`, `public-signature` and un-allowlisted `test-only` exports. Its allowlist, `scripts/check/export-usage-allowlist.json`, names 158 seams. Source exports are unchanged.

Q0-001 to Q0-006, Q0-008, Q0-009, Q0-011, Q0-013 and Q0-016 are not in this wave. Q0-010 is held for D6 review because it changes `.github/workflows/mutation.yml`.

## Wave 2 gates

Run once at head `06ff73a` (the four Q commits on top of the merge `13a92fe`). `lint` failed there on two errors in the new listener test. They were fixed in `66d315e`, and `lint` then exited 0. The full set was not re-run at `66d315e` because free disk space fell below the 8 GiB floor (see HELD). Exit codes and counts are in `20-VERIFICATION.md`.

## Wave 2 HELD items

- Live release run, attestation verification on downloaded assets, and the test-release rollback. Owner decision required (L4).
- Adding `export-usage-gate` to `check:gates`. The gate currently fails on 121 `public-signature` exports. Owner decision: either drop `export` from those names in a source unit, or exempt `public-signature` from the rule.
- Q0-010 (`.github/workflows/mutation.yml`): owner review under D6.
- Full gate-set re-run at `66d315e`. Disk free space is below 8 GiB, so the heavy jobs are held. Command: `flock -w 7200 <slot> -c 'bash gate-set'` with the nine gate lines from the run at `06ff73a`.

# Phase 20 verification: release pipeline hardening

Date: 2026-11-02. Tree: `gsd/v3-lane-a` at `60b3934` (phase 20 code), on top of phase 13 at `9076532`. Host: 8 CPUs, shared; Node v24.18.0; Podman 5.7.1; omp not probed. Source of acceptance: `20-CONTEXT.md` (Required Evidence) and `.planning/REQUIREMENTS.md` REL-01 to REL-04.

**Status: gaps_found.** Code is on the lane for all four requirements. Local evidence closes the code-side of REL-03 and REL-04 and the configuration of REL-01 and REL-02. Every live, GitHub-side proof is UNVERIFIED and owner-gated. Nothing here is a release run, a test-release rollback, or a CI run on the lane.

## Gate runs

Full phase gate set run once on the phase 20 tree, after all edits (gate runner log kept out of the repository). Exit codes: typecheck 0, lint 0, build 0, test 0 (2537 tests, 2504 pass, 0 fail, 33 skipped), test:integration 0 (202, 171 pass, 0 fail, 31 skipped), test:scripts 0 (294 pass, 0 fail), check:docs 1 then 0, check:gates 0, check:pack 0, check:mcp 0, test:coverage 0 (2537, 2504 pass, 0 fail).

`check:docs` exit 1 was the host-path check on phase 13 records (absolute evidence paths in committed files). Fixed in `9076532`; re-run exit 0. No other gate changed.

## Workflow lint

`actionlint` 1.7.7 on all `.github/workflows/*.yml`, with a temporary config (kept out of the repository) declaring the self-hosted label `omega-ci`: no findings except two `SC2016` info notes at `ci.yml` lines 202 and 615. Both are the same false positive as phase 13 (JS template literals inside a single-quoted `node -e` script, on purpose).

## Requirements

### REL-01: build and publish split (owner decision D6): implemented, configuration only, live UNVERIFIED
- Lane commits `cbec121` (source `da68a18`), `9752048` (source `61032cf`), `b29db2e` (source `ac972e4`), `e2c3761` (source `cd87368`), plus `a2f94da` (source `14d2fc3`) and `8782614` (source `a6eb46b`).
- `.github/workflows/ci.yml`, release job: the build job declares `contents: read`. The publish job declares `contents: write`, `actions: write`, `id-token: write`, `attestations: write`, and the `release-main` concurrency group.
- Publish runs no npm install, build or pack, and regenerates the release commit with built-in code (per PR #40 commit messages and AGENTS.md, Publish job section).
- UNVERIFIED: a real release run with per-job permissions and artifact handoff logs. Owner-gated (L4).
- UNVERIFIED: PR #40 human review (D6). It is required before merge and is not done.

### REL-02: build provenance attestation that `gh attestation verify` accepts: implemented, configuration only, live UNVERIFIED
- Publish job step `Attest build provenance` (`actions/attest-build-provenance`, pinned SHA) runs before any tag push and covers the tarball, `SHA256SUMS` and the SBOM, plus the milestone files when present (`ci.yml`, subject-path block).
- The phase 20 plan requires the normal and repair asset sets. The six-subject set is PR #40's design and is not changed here.
- UNVERIFIED: downloaded-subject attestation proof, `gh attestation verify <file> --repo swcstudiospace/realm` output for normal and repair subjects. Owner-gated (L4).

### REL-03: rollback marks a release a prerelease and re-points the documentation: implemented, shell validation exercised, live UNVERIFIED
- Lane commit `60b3934`. `rollback.yml`: inputs `tag` and `docs_tag`. Steps in order: checkout with full history (no persisted credential); validate both tags (format, not the same tag); validate the known-good source (tag fetched, commit an ancestor of the default branch, release state `published`); then mark `tag` a prerelease; then dispatch `pages.yml` with `-f source_ref=<docs_tag>`. All validation runs before the first remote change. User input reaches the shell only through `env`.
- `pages.yml`: `source_ref` input (default empty); `Validate source ref` step before checkout; checkout with `ref: ${{ inputs.source_ref }}`. Empty `source_ref` builds the dispatched branch, which is what the release job's dispatch does.
- Shell validation: copies of the validation blocks were run with a fake `gh` outside the repository: 12 cases, all as expected. The copies are not the workflow files, which GitHub has not executed. The release-state `jq` expression was checked against published, draft and prerelease fixtures.
- Residual limits (recorded in AGENTS.md): the build job runs the known-good tag's site build on the shared self-hosted runner with no write grant; the deploy job runs no code from the tag; the validation is the only gate on which tag is published.
- UNVERIFIED: a real test-release rollback with `isPrerelease` before and after, rollback, Pages and deployment URLs, and deployed known-good SHA and content. Owner-gated (L4). Dispatch success is not evidence.
- UNVERIFIED: whether the repository's `pages` dispatch accepts a `source_ref` input from the workflow file on the default branch. GitHub reads `workflow_dispatch` inputs from the default-branch file, and that file carries the input after this change lands.

### REL-04: features removed by a non-revert refactor (TD-08): implemented, tests pass, live UNVERIFIED
- Lane commit `60b3934`. `scripts/release/changelog.mjs`: `Removes: <sha>` trailers; `dropRemoved` runs after `dropReverted`; selection by commit id; the removal leaves only when every commit it names is in the range.
- `scripts/release/changelog.test.mjs`: 26 tests, all pass in this lane (`node --test scripts/release/changelog.test.mjs`). Six new tests in scratch repositories: multi-commit removal; a later fix touching the same file; a later refactor renaming the module of a removed feature; same-title unrelated commit; revert of the removal restores the feature; removal of a feature from an earlier release with an in-range co-named feature.
- `AGENTS.md` documents the trailer convention, with the revert and shipped-feature behaviour.
- Limits: the convention applies to removals made after this change. Earlier removals carry no trailer and are not reconstructed. The published `CHANGELOG.md` is not edited. TD-08 is claimed for trailer-named removals only.

## Open owner decisions and items

- PR #40 (`ci/release-build-publish-split`, head `cd87368`, OPEN): human review under D6 required. The lane's `60b3934` changes files beyond PR #40 (`rollback.yml`, `pages.yml`, `changelog.mjs`, `changelog.test.mjs`, `AGENTS.md`), so the PR #40 review does not cover them.
- Live release run (L4), approved test-release rollback (L4): owner-gated.
- Runner isolation: job-token separation does not prove separate OS users or ephemeral machines on the shared self-hosted pool. Residual risk recorded, no isolation claim made.
- No `ROADMAP.md`, `STATE.md`, `CHANGELOG.md` or version field edits on the lane.

## UNVERIFIED items

- Every GitHub-side behaviour: the release run, attestation verification of downloaded subjects, the rollback dispatch and Pages deployment, deployed known-good content.
- The `pages` dispatch with `source_ref` against the live default-branch workflow file.
- omp version (not observed; the shell guard blocks `omp --version` in this lane).

## Wave 2 verification (branch gsd/v3-release-wave2)

Date: 2026-11-02. Tree: `gsd/v3-release-wave2` at `66d315e`. Base `9ab241f`; PR #40 merge at `13a92fe`. Host: 8 CPUs, Node v24.18.0, npm 11.16.0. Heavy jobs ran in the lane's `heavy-slot-2` lock.

**Status: partial.** Offline evidence is recorded for REL-01 to REL-04 and the four Q items. Every live proof is UNVERIFIED and owner-gated.

### Gate runs

Full gate set at `06ff73a`, once:

| Gate | Exit | Result |
|---|---|---|
| typecheck | 0 | |
| lint | 1 at `06ff73a` | two errors in `test/anda/listener-diagnostic.test.ts`, fixed in `66d315e`; lint exit 0 at `66d315e` |
| test | 0 | 2540 tests, 2507 pass, 0 fail, 33 skipped |
| build | 0 | |
| test:integration | 0 | 202 tests, 171 pass, 0 fail, 31 skipped (Podman-gated skips) |
| test:scripts | 0 | 301 tests, 301 pass, 0 fail |
| check:docs | 0 | |
| check:gates | 0 | |
| build, check:pack, check:mcp | 0 | |

At `66d315e` (after the lint fix), typecheck exit 0, lint exit 0, and the listener test passes (1 of 1). The full set was not re-run at `66d315e`: free disk space on the root filesystem fell to 7.3 to 7.5 GiB, below the 8 GiB floor, so the heavy jobs were stopped. The full re-run is HELD until disk is freed.

Offline REL-01 and REL-02 checks at `13a92fe` (before the Q commits): release tests `node --test scripts/release/*.test.mjs`, 54 pass, 0 fail, 0 skipped; `check:pack` exit 0; `check:mcp` exit 0.

### Quality findings: failing before, passing after

- Q0-012 (`test/anda/listener-diagnostic.test.ts`). Before, against the pre-fix source: `AssertionError: one failed delivery writes one diagnostic`, `0 !== 1`. After: 1 pass. The diagnostic is `warn`, `kind: down`, `code: ANDA_UNREACHABLE`, and the next listener still receives the event. (At the pre-fix commit the test also reported a `logger` option type error, TS2353, because the option did not exist yet.)
- Q0-014 (`test/daemon/spawn-env.test.ts`). Before, a copy of the HEAD test with a non-atomic brace split: `SyntaxError: Unterminated string in JSON at position 23`. The copy was removed afterwards. After: the round-trip case passes and the sentinel case passes (2 of 2).
- Q0-015 (`test/fs/temp-sweep.test.ts`). The host has `/dev/shm` on a separate device. To reproduce the unavailable case, a private mount namespace was used (`unshare -m`, with `/dev/shm` bound to `/dev` inside it, nothing on the host). Before, with `CI=true`: the cross-device test is skipped silently, exit 0. After, with `CI=true`: `CI cannot exercise the cross-device sweep: /dev/shm ... shares /dev's device`, exit 1. After, without `CI` (local): the same skip with its reason, exit 0. After, with `CI=true` and a second device present: passes.
- Q0-007 (`scripts/check/export-usage-gate.test.mjs`). Seven fixture tests cover self-only, a used import, test-only with and without the allowlist, public-signature, forwarded, stale allowlist and the exit code. All 7 pass. On the repository the gate reports 121 failing `public-signature` exports, 0 `self-only`, 158 allowlisted seams and 0 stale entries. It exits 1 and is not in `check:gates` (HELD).

### Acceptance check

- PR #40 local ref equals the GitHub head `cd87368`. Integrated with `--no-ff`, tree unchanged. The D6 gate for merge to main is not affected.
- No push, no fetch, no `gh` write, no change to main or the WIP worktree, no workflow file merged to main, no CHANGELOG or version edit.
- Commits `--no-verify` were used once, for the merge commit `13a92fe`. Its tree equals its first parent, so there were no hook results to report.

### UNVERIFIED items

- Every GitHub-side behaviour: the release run, `gh attestation verify` on downloaded assets, the rollback dispatch with `source_ref`, the Pages deployment.
- The full gate set at `66d315e`.
- The 158 seam count differs from the 145 in the phase 13 inventory note (`.planning/STATE.md`, recorded at an earlier commit). The allowlist is generated from the current classifier output.

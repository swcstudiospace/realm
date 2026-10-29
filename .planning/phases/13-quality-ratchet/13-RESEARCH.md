# Research for Phase 13 (quality ratchet, proposal 8 parts A, B, C) and Phase 20 (release pipeline hardening, part D)

Scope: read-only research at branch `docs/milestone-v3-start` (HEAD 9372ffc). Requirement IDs: QR-01..QR-08 (Phase 13), REL-01..REL-04 (Phase 20), `.planning/REQUIREMENTS.md:22-29,90-93`. Owner decisions D1..D6: `.planning/MILESTONE-CONTEXT.md`. Every path is repo-relative. Nothing in the repository was changed; scratch files lived in `/tmp` and were removed.

Labels: VERIFIED_BY_CODE_READING (file and line read), VERIFIED_BY_EXECUTION (a read-only command or a scratch run was executed here, 2026-10-29), KNOWLEDGE (from general knowledge, not checked here), UNVERIFIED (needs a real workflow run or a measurement), INFERENCE (derived, not observed).

Runs that were allowed and done: `node --help`, `npm view`, `npm audit`, `npm pack --dry-run`, `npm install --package-lock-only` in a scratch directory, `gh api` reads, `actionlint`, a two-file scratch project to exercise Node's coverage flags, a TypeScript-API and a grep script that count exports. No repository test, build or typecheck was run.

---

## 0. The pipeline as it is (shared by both phases)

### 0.1 Workflows

`.github/workflows/` holds `ci.yml` (464 lines) and `pages.yml` (73 lines). `.github` also holds `ISSUE_TEMPLATE/` (two files) and `PULL_REQUEST_TEMPLATE.md`; there is no `dependabot.yml`, `CODEOWNERS` or `actionlint.yaml` (VERIFIED_BY_EXECUTION, directory listing).

Every job runs on `runs-on: [self-hosted, linux, x64, omega-ci]` (`ci.yml:27,106,136`; `pages.yml:20,62`), with a comment that says jobs never run on GitHub-hosted runners (`ci.yml:19-20`, `pages.yml:15-16`). The pool is documented outside this repository (`swcstudiospace/Omega-Prime docs/ci-runners.md`); whether its runners are ephemeral, share a Unix user between jobs, have Podman, or can reach Sigstore is UNKNOWN. Third-party actions are pinned to commit SHAs with a version comment: `actions/checkout` v7.0.1 (`3d3c42e5…`), `actions/setup-node` v7.1.0 (`949feb24…`), `actions/configure-pages` v6.0.0, `actions/upload-pages-artifact` v5.0.0, `actions/deploy-pages` v5.0.1.

`ci.yml` (VERIFIED_BY_CODE_READING):

| Lines | Item | Detail |
|---|---|---|
| 3-10 | triggers | `push` to `main`, `pull_request` to `main`, `workflow_dispatch` (no inputs) |
| 12-13 | workflow permissions | `contents: read` |
| 15-17 | concurrency | `ci-${{ github.ref }}`, cancel in progress only for pull requests |
| 22-101 | job `verify` | matrix Node `22.x` and `24.x`; skipped for fork PRs (`:26`); `timeout-minutes: 30`; `permissions: contents: read`. Steps: checkout (`persist-credentials: false`), setup-node with `cache: npm`, `npm ci`, `typecheck`, `lint`, `npm test` (`:63-66`), `npm run test:integration` (`:68-71`), `test:scripts`, `check:docs`, `check:gates`, `build`, `check:pack` (`:93-96`), `check:mcp` |
| 103-130 | job `site` | Node 22.x, `npm ci --prefix site`, `node scripts/docs/sync-site.mjs`, `npm run build --prefix site`; `contents: read`; 15 minutes |
| 132-464 | job `release` | `needs: [verify, site]`; runs only for `push` on `refs/heads/main` (`:135`); `permissions: contents: write, actions: write` (`:138-140`); `concurrency: release-main`, no cancel (`:141-143`); 30 minutes |

Release job steps in order (VERIFIED_BY_CODE_READING):

1. `:145-152` checkout `github.sha`, `fetch-depth: 0`, `persist-credentials: false` (build code must not read the token).
2. `:154-157` Node 24.x. `:159-162` `npm ci --ignore-scripts`. `:164-167` `git fetch --force --tags origin`.
3. `:174-239` **Finish unreleased milestone tag**: runs `next-version.mjs`; if the latest `v0.<minor>.*` tag has no GitHub release it checks the tag is an ancestor of `origin/main`, builds it in a separate worktree (`npm ci --ignore-scripts`, `npm run build`, `npm pack`, `changelog.mjs --notes-out`, `assets.mjs`) with `GH_TOKEN` unset in the subshell, then `gh release create` with the tarball, `SHA256SUMS` and the CycloneDX SBOM. Does not run `check:pack`.
4. `:241-255` **Compute next version** (`next-version.mjs` into step outputs `version`, `tag`, `previousTag`).
5. `:261-321` **Plan release**: one action out of `skip` (tag and release exist), `superseded` (`origin/main` is no longer `GITHUB_SHA`), `normal`; a tag without a release here is an error. `GH_TOKEN` is `github.token`.
6. `:323-329` **Sync package version** (`sync-version.mjs <version>`: `package.json`, `package-lock.json`, four adapter manifests).
7. `:331-343` **Generate changelog and notes** (`changelog.mjs --version --date --notes-out [--since <previousTag>]`).
8. `:345-350` **Build and pack** (`npm run build`, `npm pack`). The tarball is built after the sync. `check:pack` is not run on it (TD-07).
9. `:354-360` **Checksums and SBOM** (`assets.mjs`: `SHA256SUMS` of the tarball only, `scripts/release/assets.mjs:82`, and `agent-realm-<version>.cdx.json`) into `${RUNNER_TEMP}/release-assets`.
10. `:362-381` **Commit release changes**: bot identity, `git add CHANGELOG.md` plus `sync-version.mjs --files`, `chore(release): <tag> [skip ci]`.
11. `:385-422` **Tag and push atomically**: annotated tag, then `git push --atomic origin HEAD:refs/heads/main refs/tags/<tag>` with the token passed only through `GIT_CONFIG_*` environment variables, global and system git config ignored, hooks disabled (`:396-408`). A rejected push while `origin/main` moved is "superseded" and exits green (`:415-420`).
12. `:426-441` **Create GitHub release** (`gh release create … --verify-tag`; tarball, `SHA256SUMS`, SBOM; notes from `release-notes.md`), only when the push happened.
13. `:448-464` **Dispatch Pages**: `if: hashFiles('.github/workflows/pages.yml') != ''`; fetches `origin/main`, and runs `gh workflow run pages.yml --ref main` only when the tip subject starts with `chore(release): v`.

The job comment at `:398-401` and `AGENTS.md:105` say the shared user is the known weakness and the job split is a recorded follow-up.

`pages.yml`: `workflow_dispatch` only (`:5-6`), `permissions: {}` at workflow level (`:9`), concurrency `pages`. Job `build` (`:18-57`): `contents: read`, `pages: read`; Node 22.x; `sync-site.mjs`; `npm ci --prefix site`; build; `configure-pages`; `upload-pages-artifact` from `dist/site`. Job `deploy` (`:59-73`): `needs: build`; `pages: write`, `id-token: write`; environment `github-pages`; `deploy-pages`.

### 0.2 `package.json`, scripts, contributor documents

- Scripts (`package.json:52-67`): `typecheck`, `lint`, `test` = `tsc -p tsconfig.json && node --test "dist/test/**/*.test.js"` (`:55`), `test:integration` (same compile, `dist/test/integration/*.test.js`), `build`, `test:scripts` = `node --test "scripts/**/*.test.mjs"`, `check:docs` (`host-paths.mjs` then `agents-sync.mjs`), `check:mcp`, `check:pack`, `check:image-digests`, `build:image`, `check:gates`, `release:next|sync|changelog`. There is no coverage script and no audit script.
- `engines.node >=22.13.0` (`:49-51`). Runtime deps are exact pins (`:76-81`), dev deps are exact pins (`:69-75`: `@eslint/js`, `@types/node 22.20.5`, `eslint`, `typescript 6.0.3`, `typescript-eslint`). `files` (`:35-47`) ships `adapters`, `dist/src`, driver protos, three schemas, `README.md`, `LICENSE`, `NOTICE`, `licenses`, `CHANGELOG.md`. Not shipped: `docs/`, `test/`, `site/`.
- `tsconfig.json` compiles `src/**/*.ts`, `test/**/*.ts` and `eslint.config.js` to `dist/` with `sourceMap: true`, target ES2023, `rootDir: .`, so tests land in `dist/test/**` and import `../../src/…` which compile to `dist/src/…`.
- `scripts/check/`: `agents-sync.mjs`, `gate-closure.mjs`, `host-paths.mjs`, `mcp-smoke.mjs`, `pack-smoke.mjs`, `verify-image-digests.mjs`, each with a `*.test.mjs`. `scripts/release/`: `next-version.mjs`, `version.mjs`, `sync-version.mjs`, `changelog.mjs`, `assets.mjs`, each with a test. `scripts/docs/sync-site.mjs`, `scripts/image/build-image.mjs`. Convention: Node built-ins only (`AGENTS.md:67,87`).
- `CONTRIBUTING.md` (59 lines): gate table (`:20-31`), branch flow, commit types (`:43`), dependency rule (`:49-55`: justification, licence check, maintenance check). `SECURITY.md` (12 lines): only 0.2.x supported; private vulnerability reporting; nothing about verifying release artifacts.
- Repository settings read with `gh api` (VERIFIED_BY_EXECUTION): repo is public; `main` not protected; `sha_pinning_required: false`; secret scanning, push protection and Dependabot security updates all `disabled`; default workflow token permission `read`; both merge and squash allowed. These are the owner's (TD-10), not changed here.
- `actionlint` 1.7.7 is installed on this host (`/usr/local/bin`, not a repo dependency). Run against both workflows it reports only the unknown custom label `omega-ci` (needs an `actionlint.yaml` label list to silence) and one shellcheck info at `ci.yml:243` (SC2016, the `node -e` block). Useful as a local pre-check for every workflow change (VERIFIED_BY_EXECUTION).

---

# PART A: dependency audit, Dependabot, TD-07

## A.1 Findings

**A.1.1 `npm audit` placement.**
- `npm audit --omit=dev --audit-level=high` at the repository root exits 0 today: "found 0 vulnerabilities" (VERIFIED_BY_EXECUTION). So adding it does not turn `main` red on day one.
- It needs only `package-lock.json` plus network to the registry advisory endpoint, not `npm ci` and not a Node-version matrix (INFERENCE from how npm reads lockfiles; the run above had `node_modules` present). Putting it in the `verify` matrix would run it twice for no gain.
- `site/` is different: `site/package.json` has only a devDependency (`vitepress ^1.6.4`), and `npm audit --audit-level=high` in `site/` exits 1 today with 3 vulnerabilities (1 high, 2 moderate) in the `vite`/`esbuild`/`vitepress` chain (`vitepress <=1.6.4`, "may require choosing a different dependency"). With `--omit=dev` the site audit audits nothing and exits 0. So auditing `site/` in CI would fail today and the fix is a major bump of a dev-only tool (VERIFIED_BY_EXECUTION).
- Network-dependence risk: a new advisory can fail a push-to-main run with no code change, and `release` is `needs: [verify, site]` (`ci.yml:134`). That is the price of a blocking audit.

**A.1.2 Dependabot.**
- No `dependabot.yml` exists. `site/package-lock.json` exists (86.7K), so `/site` can be a Dependabot `npm` directory (VERIFIED_BY_EXECUTION).
- Root `package.json` pins exact versions; `@types/node` is pinned at major 22 (`package.json:71`) on purpose to match the Node 22.13 floor (INFERENCE); an unconstrained Dependabot would propose major 24/25 types.
- Dependabot subjects default to "Bump x from a to b", which the changelog classifier maps to `Changed` because it only parses Conventional Commit headers (`scripts/release/changelog.mjs:26,74-77`). `commit-message.prefix` fixes that (KNOWLEDGE: Dependabot supports `prefix`, `prefix-development`, `include: scope`).
- Dependabot PRs are same-repo branches, so the fork guard (`ci.yml:26`) does not skip them and they run on the self-hosted pool. The ship flow (Greptile 5/5, `AGENTS.md:112-113`) still applies to each.
- `@rivet-dev/agentos-core` (`package.json:79`) is a 0.x exact pin; the sandbox image carries the AgentOS runner pinned elsewhere (`AGENTS.md:73`). Whether the two must move together is INFERENCE and needs a check before Dependabot is allowed to bump it. Do not add a `docker` ecosystem entry: the sandbox image is pinned by `sandbox/expected-digests.json` and a Dependabot bump would fight that file.

**A.1.3 TD-07 exact omissions** (register row `.planning/milestones/v2.0-MILESTONE-AUDIT.md:270`; script `scripts/check/pack-smoke.mjs`).
- `npm pack --dry-run --json` lists 193 files; the non-`dist` ones are `CHANGELOG.md`, `LICENSE`, `NOTICE`, `README.md`, `package.json`, 10 files under `adapters/`, `licenses/Apache-2.0.txt`, the three schemas and 6 driver proto files (VERIFIED_BY_EXECUTION).
- `pack-smoke.mjs` asserts only 6 of the 10 adapter files (`ADAPTER_MANIFESTS`, `:22-29`): the two Claude plugin files, `muse-code/.muse-plugin/plugin.json`, `hermes-agent/plugin.json`, `hermes-agent/mcp.json`, `prime-agent/package.json`. It also checks declared entries (`bin`, `omp.extensions`; `:70-74`), the 6 driver protos (`DRIVER_PROTO_FILES`, `:76-85`) and 3 legal files (`LEGAL_FILES`, `:94`).
- **Shipped but unchecked (4 files):** `adapters/hermes-agent/mcp.snippet.yaml`, `adapters/muse-code/mcp-settings.snippet.json` (the host snippets that travel in the tarball), `adapters/prime-agent/MCP.md`, `adapters/prime-agent/skills/realm/SKILL.md`.
- **Not shipped at all:** the six `docs/hosts/snippets/*.md` files are not in `files`, so they are not in the tarball. If QR-03's "host snippet" means these, the tarball must first gain a `files` entry, which changes the package contents. The roadmap wording (`ROADMAP.md` Phase 13 criterion 2) says "a host snippet or the prime-agent `MCP.md` or `SKILL.md` is missing from the tarball"; the four files above satisfy that without a packaging change. Needs an owner/planner call (A.3 Q2).
- The release job packs at `ci.yml:345-350`, after the version sync (`:323-329`), and never runs `check:pack` on that tarball; the Finish step (`:221-223`) does not either. `check:pack` today packs by itself into a temp directory (`buildPackArgs`, `main()` `:114-163`) and installs the tarball into a throwaway consumer with `npm install --ignore-scripts` (a registry install of the four runtime dependencies).
- `scripts/check/pack-smoke.test.mjs` already tests the pure helpers (`buildPackArgs`, `buildInstallArgs`, `tarballFromPackOutput`, `missingAdapterManifests`, `missingDeclaredEntries`).
- The version fields the sync rewrites are listed in `RELEASE_VERSION_FILES` (`scripts/release/sync-version.mjs:17`): `package.json`, `package-lock.json` and four adapter manifests. All except the lockfile are in the tarball.

## A.2 Design

**A.2.1 Audit job** (new job in `ci.yml`, no Node matrix):

```yaml
  audit:
    name: Dependency audit
    if: github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name == github.repository
    runs-on: [self-hosted, linux, x64, omega-ci]
    timeout-minutes: 10
    permissions:
      contents: read
    steps:
      - checkout (same pin, persist-credentials: false)
      - setup-node 24.x
      - run: npm audit --omit=dev --audit-level=high
```

Add `audit` to the release job's `needs` (`ci.yml:134`) so a high production advisory blocks a release. Alternative: keep it out of `needs` and surface it only as a red check (non-blocking). Recommendation: blocking, because the milestone goal is "fail in CI before they ship"; the cost is an advisory-driven red `main`, answered by a Dependabot PR or a recorded exception. Do not audit `site/` (dev-only, red today); let Dependabot cover it.

**A.2.2 `.github/dependabot.yml`** (shape; `version: 2`):

```yaml
version: 2
updates:
  - package-ecosystem: github-actions
    directory: "/"
    schedule: { interval: weekly }
    commit-message: { prefix: "ci" }
    groups: { actions: { patterns: ["*"] } }
  - package-ecosystem: npm
    directory: "/"
    schedule: { interval: weekly }
    commit-message: { prefix: "build", prefix-development: "build", include: scope }
    ignore:
      - dependency-name: "@types/node"
        update-types: ["version-update:semver-major"]
    groups: { dev-tooling: { dependency-type: development } }
  - package-ecosystem: npm
    directory: "/site"
    schedule: { interval: weekly }
    commit-message: { prefix: "build", prefix-development: "build", include: scope }
```

Types `ci` and `build` are in the allowed list (`CONTRIBUTING.md:43`); `changelog.mjs:19-20` maps both to Maintenance. `build(deps-dev): …` matches `CONVENTIONAL_HEADER` (`changelog.mjs:26`). The `github-actions` ecosystem updates SHA pins and the `# vX.Y.Z` comment together (KNOWLEDGE). Decide per Q3 whether `@rivet-dev/agentos-core` is ignored.

**A.2.3 TD-07 in `pack-smoke.mjs`:**
1. Add the four files to the checked list (new exported constant or extend `ADAPTER_MANIFESTS` and rename it; its name is used in the existing test).
2. Add a completeness check that does not depend on a hand list: walk `ROOT/adapters` and `ROOT/licenses` in the source tree (fs walk, no git) and require every file to exist under the installed package. This catches the next added adapter file. Keep the explicit list too, because it documents intent.
3. Add options `--tarball <file>` (skip `npm pack`, install the given tarball; the `dist/src/contract/validate.js` precheck at `:115-118` applies only when packing) and `--expect-version <x.y.z>` (assert the installed `package.json` and each adapter manifest in `RELEASE_VERSION_FILES` that is in the tarball carry that version). The second proves the sync ran before the pack.
4. Release job: insert a step after **Build and pack tarball** (`ci.yml:345-350`) and before **Write release checksums** (`:354`): `node scripts/check/pack-smoke.mjs --tarball "agent-realm-${VERSION}.tgz" --expect-version "${VERSION}"`. It sits before every remote mutation, so a failure leaves no tag. Apply the same step in the Finish worktree (`:221-223`). It needs registry network (the consumer install pulls four dependencies; INFERENCE from `buildInstallArgs`).
5. Tests: extend `pack-smoke.test.mjs` for the new list, the walk comparison (fixture directories, as the existing tests do), the version assertion and argument parsing. All local.

## A.3 Open questions (Part A)

1. Blocking or advisory audit (A.2.1)? Recommendation given; the owner decides.
2. Does "host snippets" include `docs/hosts/snippets/*.md`? If yes, adding `docs/hosts/snippets` to `files` is a packaging change that goes into the tarball. Recommendation: no; they are published by the Pages site. Record the answer in the PR.
3. Should Dependabot be told to ignore `@rivet-dev/agentos-core` and majors of `@types/node`, `typescript`, `eslint`, `vitepress`? Needs the owner's view of churn.
4. Dependabot security updates are `disabled` in repo settings (VERIFIED_BY_EXECUTION). That is TD-10, the owner's setting, outside the repository.

## A.4 Suggested plan slicing (Part A; one pull request, D6 cited)

Wave A (file-disjoint units that can run in parallel):
- A1 `scripts/check/pack-smoke.mjs` and `pack-smoke.test.mjs` (list, walk check, `--tarball`, `--expect-version`).
- A2 `.github/dependabot.yml` (new file).

Wave B (single owner of `ci.yml`, after A1 because it needs the flags): A3 `.github/workflows/ci.yml` (audit job, release `needs`, release and Finish `check:pack` step), plus docs in the same PR: `AGENTS.md` (Layout `.github/`, Commands, Versioning and release step list), `CONTRIBUTING.md` (gate table row for audit), `.github/PULL_REQUEST_TEMPLATE.md` (checklist). Run `actionlint` on the workflow before pushing.

---

# PART B: coverage ratchet, deterministic time, dead exports

## B.1 Findings: coverage with the Node test runner

**B.1.1 Versions and flags.**
- Local Node is v24.18.0 (VERIFIED_BY_EXECUTION). `node --help` lists `--experimental-test-coverage`, `--test-coverage-include`, `--test-coverage-exclude`, `--test-coverage-lines`, `--test-coverage-branches`, `--test-coverage-functions`, `--test-reporter`, `--test-reporter-destination`, `--test-concurrency`, `--test-timeout`, `--test-randomize`, `--test-isolation` (VERIFIED_BY_EXECUTION).
- Node 22.x: no 22 binary exists on this host, so the 22.x flag set is KNOWLEDGE: coverage reporting is experimental in 22; `--test-coverage-include/exclude` arrived in 22.5.0; the three threshold flags in 22.8.0; the `lcov` reporter in 22.0.0 (version numbers UNVERIFIED). The engines floor is 22.13.0 (`package.json:50`) and CI uses `22.x` and `24.x` (`ci.yml:34-35`), both above those versions if the numbers are right. The first CI run on the 22.x leg is the proof; the coverage script must print the flags it used and the Node version.
- In 24.18 the flag is still named `--experimental-test-coverage` (VERIFIED_BY_EXECUTION).

**B.1.2 How tests run today.** `npm test` compiles everything with `tsc -p tsconfig.json` and runs `node --test "dist/test/**/*.test.js"` (`package.json:55`); the quoted glob is expanded by Node itself. By default the runner uses one process per test file (the default isolation, KNOWLEDGE). The glob includes `dist/test/integration/`, so Podman-gated suites run or skip as the host allows (`AGENTS.md:33`). Whether the `omega-ci` runners have Podman 5.x is UNKNOWN; a floor measured on a host with Podman can fail on one without it.

**B.1.3 What a scratch run showed** (a two-file project in `/tmp`, removed afterwards; VERIFIED_BY_EXECUTION on Node 24.18.0):
- `node --test --experimental-test-coverage --test-coverage-include="dist/src/**" --test-reporter=spec --test-reporter-destination=stdout --test-reporter=lcov --test-reporter-destination=coverage/lcov.info "dist/test/**/*.test.js"` prints the spec output and a tree table (columns: file, line %, branch %, funcs %, uncovered lines). Directory rows have empty cells: the table gives no per-directory totals.
- The `lcov` file is written only if its directory exists; otherwise the run crashes with `ENOENT … coverage/lcov.info`. The script must `mkdir` it first.
- lcov records per file `SF:`, `FN/FNDA/FNF/FNH`, `BRDA/BRF/BRH`, `DA`, `LF/LH`, so per-directory totals are a sum over `SF` paths.
- `--test-coverage-lines|branches|functions=N` are global thresholds, not per-directory: a run with `--test-coverage-branches=99` over a file at 66.67% branch coverage exited 1; a global 99 for lines on a 100% file exited 0. Per-directory floors therefore need a small script (or three full test runs, which is wasteful).
- A source file that no test imports is absent from the report entirely (verified with a never-imported file). The aggregate therefore overstates coverage; the script must list `dist/src/<dir>/**/*.js` files missing from the lcov and treat each as a finding.
- Coverage maps to the compiled `dist/src/*.js` paths. Whether Node 22.x and 24.x map back to TypeScript through the emitted source maps is KNOWLEDGE/UNVERIFIED; measuring on the compiled JS (target ES2023, nearly 1:1 with the TS) avoids depending on it. Directory keys are `dist/src/fs`, `dist/src/core`, `dist/src/tools`.
- V8 branch and function counting can differ between Node 22 and 24 (INFERENCE); gate on one leg only.

## B.2 Design: coverage ratchet (QR-04)

- `package.json`: `"test:coverage": "tsc -p tsconfig.json && node scripts/check/coverage.mjs"`.
- `scripts/check/coverage.mjs` (built-ins only, ~150 lines): `mkdirSync("coverage")`; spawn `process.execPath` with `--test --experimental-test-coverage --test-coverage-include=dist/src/** --test-reporter=spec --test-reporter-destination=stdout --test-reporter=lcov --test-reporter-destination=coverage/lcov.info "dist/test/**/*.test.js"`; fail with the child's exit code if tests fail; parse the lcov; sum `LH/LF`, `BRH/BRF`, `FNH/FNF` for `dist/src/fs`, `dist/src/core`, `dist/src/tools`; compare with the floors file; print a table (directory, metric, actual, floor, status); list unloaded source files; exit 1 below any floor. Exported pure functions `aggregateLcov(text)` and `compareToFloors(totals, floors)` so the script test feeds synthetic lcov strings and asserts exit codes and messages, with no real test run (local).
- Floors file: `scripts/check/coverage-floors.json`, for example `{ "gateNode": "22.x", "tolerance": 1.0, "floors": { "src/fs": { "lines": 0, "branches": 0, "functions": 0 }, … } }`. Real numbers must come from the CI run, not from this host: the host is loaded and its Podman/gating state differs (B.1.2). Store `floor = floor(measured) - tolerance`. `--write` mode only raises floors; lowering needs a hand edit with a reason in the PR (that is the ratchet).
- CI: one step in `verify`, `if: matrix.node-version == '22.x'` (or 24.x; choose one and record it) running `npm run test:coverage` after the existing `Unit tests` step; the suite then runs twice on that leg. Cheaper alternative: on the gate leg replace the `Unit tests` step with the coverage run and keep `npm test` on the other leg. Measure suite wall time on CI before choosing (UNVERIFIED; no suite timing was taken here). A failing floor fails `verify`, which blocks `release` (`ci.yml:134`).
- First landing: run with `--report-only` for a few CI runs on both legs to learn variance, then set floors and remove `--report-only`. Demonstrate the gate (roadmap criterion 3) once by lowering a test or raising a floor, and record that run in the PR; the committed regression test is the synthetic-lcov script test.
- Docs in the same PR: `AGENTS.md` (Commands, Layout `scripts/check/`), `CONTRIBUTING.md` gate table, `.github/PULL_REQUEST_TEMPLATE.md`. `coverage/` is already git-ignored (`.gitignore`).

## B.3 Findings and design: fixed-timeout tests (QR-05)

All line numbers re-read on this branch (VERIFIED_BY_CODE_READING; the counts were run).

| Test | Line | What it waits for | Seam and minimal fix |
|---|---|---|---|
| `test/lifecycle/idempotent.test.ts` | `:113` (`setTimeout(resolve, 9000)`; comment `:105-111`) | the abandoned create (3000 ms fake delay) to finish so the resource count can be asserted; the 1000 ms budget is a real `withTimeout` timer (`src/core/timeout.ts:9-13`); `performance.now` is already mocked to a constant (`:93`) | The fake delay is a real timer (`test/support/fake-execution.ts:32-36,93-101,133-136`). Replace `setDelay` for create with a hold gate: `exec.hold("create")` returns a release function and `exec.settled()` resolves when every started call has completed. Use `t.mock.timers.enable({ apis: ["setTimeout"] })` and `tick(1000)` to fire the budget (the pattern in `test/runtime/sweep-timeout.test.ts:65-90`), then `release()` and `await exec.settled()`. No `src` change: the controller reads time through `performance.now()` (`src/lifecycle/controller.ts:188,231,263,272`) and `withTimeout` uses the global `setTimeout`. This removes 9 s plus the 1 s real budget |
| `test/runtime/libpod-client.test.ts` | `:313` (`await sleep(700)`; client built with `infoTtlMs: 400` at `:309`) | the info cache TTL to lapse | The cache reads `performance.now()` directly (`src/runtime/libpod-client.ts:298,311`). Minimal seam: add `readonly now?: () => number` to `LibpodClientOptions` (`:62-72`, default `() => performance.now()`), consistent with `src/runtime/agentos.ts:56,71` and `src/anda/client.ts:153`. The test then uses a manual clock: `advance(399)` still cached, `advance(1)` refetches, which tests the boundary instead of 700 vs 400. The same file's other waits (`:189-190,210-211,236-237`, 5000/2000 ms) are event waits with guard timeouts and take the scaled helper |
| `test/runtime/session-execution.test.ts` | `:944` (`{ timeoutMs: 200 }`, child `setTimeout(() => {}, 10000)`) | the runner's own timer (`src/runtime/session-execution.ts:651-655`) to fire and the group kill to be refused (`process.kill` mocked to throw EPERM) | No seam in `src`. The child lives 10 s and `child.kill` still runs after the mocked failure, so the process ends; the test is robust to slowness in the child but the 200 ms bound is real time. Use the scaled helper for `timeoutMs` and make the child's lifetime a multiple of it. Neighbouring tests use 2000/5000/3000 ms (`:919,923,1038,1042`) and a local `sleep(20)` poll (`:1064,1099,1103`) |
| `test/mcp/server.test.ts` | `:62` and `:124` (2000 ms `.unref()`ed rejecting timers racing `server.closed`) | the server closing after stdin ends | Event-driven with a guard; replace by the shared `boundedWait` |
| `test/daemon/daemon.test.ts` | `:159` (`setTimeout(resolve, 2000)` in `cleanupDaemon`, racing `daemon.done`); the same file has `awaitDone` (`:134-147`, 5000 ms), and a local `bounded` with `WAIT_MS = 5000` (`:166-172`) | the daemon finishing teardown | Same: shared helper replaces three local guards |
| `test/acp/agent.test.ts` and `test/acp/stdio.test.ts` | `{ timeout: 10_000 }` at 20 lines in `agent.test.ts` (`:117,142,170,178,207,228,249,262,282,302,325,348,363,381,405,431,443,463,477,501`) and 1 in `stdio.test.ts:52`: 21 in all (VERIFIED_BY_EXECUTION, counted) | `node:test` per-test caps; the tests themselves are event driven (header comment `agent.test.ts:7-9`) | Only the cap is load-sensitive. Replace each literal with `testTimeout(10_000)` |

Other fixed waits seen in the inventory (VERIFIED_BY_EXECUTION grep, non-integration `test/`): local guard timers in `test/daemon/e2e.test.ts:135`, `test/cli/cli.test.ts:167`, `test/surfaces/equivalence.test.ts:47`, `test/doctor/runtime-checks.test.ts:346`, `test/omp/extension.test.ts:72`; test-level caps in `test/anda/reconnect.test.ts` (`:336` 20000, `:474,540,588,620,650` 5000) and `test/runtime/driver/socket-server.test.ts:163`; fixed sleeps in `test/support/fake-execution.ts:135` and `fake-bridge.ts:94`. The proposal names six plus the 21 caps; these extras are optional scope for QR-05 ("the other fixed waits the proposal lists" is the requirement text, `REQUIREMENTS.md:26`).

Good pattern to copy: `test/omp/plugin.test.ts:134-` (a `FakeCtx` whose `setTimeout` records `{ms, callback, handle}` and the test fires the callback itself; header comment "no wall clock runs in this file"). `test/support/production-live.ts:321` already has an injectable `clock.sleep`.

**Shared helper** `test/support/timing.ts` (test-only; reading an environment variable here is allowed because the entry-edge rule in `AGENTS.md:84` concerns `src`; `production-live.ts` already reads it):

```ts
// Multiplier for load. 1 by default; REALM_TEST_TIMEOUT_SCALE (a number >= 1, capped at 10) overrides it.
export const TIMEOUT_SCALE: number;
export function scaledMs(ms: number): number;                 // Math.ceil(ms * TIMEOUT_SCALE)
export function testTimeout(ms: number): { readonly timeout: number }; // for node:test options: { timeout: scaled }
// Race work against a scaled, unref'd, cleared timer. Rejects with Error(`${what} did not settle within ${n} ms`).
export function boundedWait<T>(work: Promise<T>, what: string, ms?: number): Promise<T>;
// Poll a predicate every intervalMs (default 5) until true or the scaled deadline; replaces waitForRecorded-style loops.
export function pollUntil(predicate: () => boolean | Promise<boolean>, what: string, options?: { timeoutMs?: number; intervalMs?: number }): Promise<void>;
// Deterministic clock for injected `now`.
export class ManualClock { now: () => number; advance(ms: number): void; }
```

`test/support/timing.test.ts` tests the helper (a `.test.ts` outside any suite directory runs under the same `dist/test/**/*.test.js` glob). Default scale 1 in normal runs; CI or the CPU-limited verification sets the variable. Do not auto-derive it from `os.loadavg()`, so that a failure reproduces.

Verification the requirement asks for: the suite passes in a CPU-limited container (`REQUIREMENTS.md:26`). Cheap ways on this host: a CPU-limited rootless Podman run, or `taskset -c 0` plus a CPU stressor (INFERENCE, not tried). The executor must run it once and record the load level and result.

## B.4 Findings and design: dead exports (TD-09, QR-06)

- The register row: "`EGRESS_DENIED` is catalogued and mapped but never thrown … About 60 exports and 55 exported types are used only by tests or inside their own file; no module is dead" (`.planning/milestones/v2.0-MILESTONE-AUDIT.md:272`; also `:232`, row 6). QR-06 says remove dead exports found with the coverage output and leave the frozen error catalogue unchanged (`REQUIREMENTS.md:27`).
- Coverage output cannot find them: an export used only by tests is covered by those tests. What coverage does give is functions at `FNDA:0` in the lcov (never executed by any test); that is a different list (dead code, not dead exports) and worth reading too. The reliable signal is reference analysis.
- **Reproducible method without a new dependency** (both were run here, VERIFIED_BY_EXECUTION):
  1. *Built-ins only*, ~40 lines, ~10 s: read `src/**/*.ts` and `test/**/*.ts`; collect `export (const|function|class|interface|type|enum) Name` with a regular expression; for each name test `\bName\b` in the other `src` files, then in `test`. Classes: used-in-src, test-only (value or type), self-only (declaring file only).
  2. *Exact*, uses the `typescript` devDependency through its compiler API (resolves aliases, ignores string matches): for every exported symbol count identifier references per file. Breaks the "scripts use Node built-ins only" convention (`AGENTS.md:67`), so keep it as an optional one-off, or justify it.
- First candidate list size (approximate; both methods agree within a few percent):

| Class | TypeScript API | Grep method |
|---|---|---|
| total exports in `src` | 599 | 598 |
| used by another `src` file | 233 values + 95 types | 339 |
| used only by tests: values / types | 97 / 48 | 93 / 48 |
| used only in their own file: values / types | 34 / 92 | 26 / 92 |

  So about 259 to 271 declarations are test-only or file-internal, against the register's "about 60 plus 55"; the register evidently counted a narrower set. Directory spread of the TS-API result (test-only plus self-only): `runtime` 116, `daemon` 25, `fs` 24, `audit` 17, `omp` 16, `cli` 14, `core` 10, `doctor` 10, `mcp` 9, `anda` 8, `contract` 7, `acp` 4, `tools` 4, `lifecycle` 3, `session` 3, `realm` 1.
- Caveats: `src/core/errors.ts`, the schema validator types, `ports` types (frozen contracts, `test/core/ports-freeze.test.ts`) and the `ERROR_CODES` catalogue are out of scope; entry modules loaded by path (`dist/src/omp/extension.js`, `main.ts` files) can look unreferenced; a "test-only" value may be a deliberate test seam (keep, document) and its test may be the only reason it exists (remove both only after a decision).
- Safe removal procedure: for self-only exports, drop the `export` keyword; `noUnusedLocals` (`tsconfig.json`) then makes `tsc` flag any that are truly unused, which are deleted. For test-only exports, decide per item: keep as a documented seam, or delete the export and its test.
- Optional follow-on: commit the built-ins script as `scripts/check/export-usage.mjs --list` (informational) so the method is reproducible; a ratchet on its count is possible but is new scope.
- Conflict warning: this touches about 16 `src` directories while the runtime and Omp lanes edit the same areas in parallel (`MILESTONE-CONTEXT.md:36`). Slice it per directory, land small PRs early and rebase often.

## B.5 Open questions (Part B)

1. Which Node leg gates coverage (22.x or 24.x), and does the `omega-ci` pool have Podman? Both change the floors; both need a CI run to learn.
2. Is a double run of the suite on the gate leg acceptable, or should the gate leg run only the coverage variant? Needs CI timings.
3. Does `REALM_TEST_TIMEOUT_SCALE` default to 1 in CI, or does CI set a value (suggest 2 once the CPU-limited run shows what is needed)?
4. Add the optional `now` option to `LibpodClientOptions` (a one-line `src` change, recommended) or mock `performance.now` as `idempotent.test.ts:93` does?
5. For TD-09: keep test-only seams or delete them with their tests? Decision rule needed before the removal PRs.

## B.6 Suggested plan slicing (Part B; each its own pull request; the PR touching `.github/workflows/**` cites D6)

PR B-time (QR-05):
- Wave 1 (single unit): `test/support/timing.ts` and `timing.test.ts`; `src/runtime/libpod-client.ts` (`now` option); `test/support/fake-execution.ts` (hold gate and `settled()`).
- Wave 2 (parallel, file-disjoint by test file): `test/runtime/libpod-client.test.ts`; `test/lifecycle/idempotent.test.ts`; `test/acp/agent.test.ts` plus `test/acp/stdio.test.ts`; `test/runtime/session-execution.test.ts`; `test/mcp/server.test.ts` plus `test/daemon/daemon.test.ts`; optionally the extra guard timers listed above.
- Wave 3: CPU-limited run recorded in the PR.

PR B-coverage (QR-04), independent of B-time:
- Unit 1 `scripts/check/coverage.mjs`, `coverage.test.mjs`, `coverage-floors.json`, `package.json` script. Unit 2 (after unit 1, after Part A's `ci.yml` change) `ci.yml` step. Unit 3 docs. Report-only first, then floors from CI.

PR B-exports (QR-06): after B-time (it edits `libpod-client.ts`); one commit per `src` directory; method script output pasted in the PR.

Shared files: `package.json` (B-coverage script, Part C dependency), `package-lock.json` (Part C), `ci.yml` (Parts A, B, and D later). Serialize those edits; the rest is file-disjoint.

---

# PART C: property tests and mutation testing

## C.1 Findings: candidates

All from `npm view` (VERIFIED_BY_EXECUTION, 2026-10-29) unless labelled. A dry resolution (`npm install --package-lock-only --ignore-scripts` in a scratch directory) gave exact tree sizes and licences.

| | `fast-check` | Stryker (`@stryker-mutator/core` + command runner; optional `@stryker-mutator/typescript-checker`) | In-repo mutation script |
|---|---|---|---|
| Latest | 4.10.2 | 10.1.1 (core, api, util, instrumenter, checker, tap-runner all 10.1.1) | n/a |
| Licence | MIT | Apache-2.0 | AGPL-3.0-only (the repo) |
| Last publish | 2026-09-19 (modified); 12 releases since 2025-10-29 | core 2026-10-23; 7 core releases since 2025-10-29; `next` tag is a stale 6.4.0-beta | n/a |
| Direct dependencies | 1 (`pure-rand ^8.0.0`, 8.4.2, MIT, 0 deps) | core 26 direct; resolved tree for core + typescript-checker: 188 packages (MIT 136, Apache-2.0 36, ISC 10, BSD-3-Clause 3, BlueOak-1.0.0 1 `minimatch`, 0BSD 1 `tslib`, CC-BY-4.0 1 `caniuse-lite`, which is browser data) | none |
| Tree for fast-check | 2 packages, both MIT | | |
| ESM / Node | `type: module`, dual ESM and CJS exports, engines `>=12.17.0`; TS types for TS 5.7+ and older (`types@<5.7`) | `type: module`, engines `>=22.0.0` (matches the 22.13 floor and Node 24) | built-ins |
| Provenance | npm attestation present (SLSA provenance v1) | present on core 10.1.1 | n/a |
| Maintainers | 1 npm account (`ndubien`; repository `dubzzz/fast-check`, funded through GitHub Sponsors and Open Collective) | 3 npm accounts (nicojs, simondel, a team account) | repo |
| Unpacked size | 1.5 MB | core 1.2 MB, many more in the tree | n/a |
| Deprecated flag | none shown | none shown | n/a |

### C.1.1 fast-check with `node:test`

It is a library: `import fc from "fast-check"` in a compiled test and call `fc.assert(fc.property(arb…, (x) => { … }), { numRuns })`. No runner integration is needed, it runs inside `node --test` on the compiled `dist/test`, and `npm test` picks it up. A failure prints the seed and path for replay and shrinks to a minimal counterexample. Time estimate (INFERENCE): the canonicalizer touches the real filesystem with a handful of `lstat` calls per input; build the fixture tree once in a `before` hook and keep 100 to 300 runs per property, which is well under a second per property; the policy loader writes a small file per run, ~0.2 ms each. Not measured.

### C.1.2 Stryker with `node:test` on compiled output

- Stryker has no first-class `node:test` runner. Options (KNOWLEDGE, UNVERIFIED): the built-in `command` runner (`testRunner: "command"`, `commandRunner.command`) runs a shell command and treats exit 0 as survived; it cannot do per-test coverage analysis (`coverageAnalysis: "off"`), so every mutant runs the whole command. A `@stryker-mutator/tap-runner` exists (deps `tap-parser`, `glob`); whether it can drive `node --test --test-reporter=tap` is UNVERIFIED and needs a spike.
- Mutating compiled JS under `dist/src/…` avoids the TypeScript compile and type-check problem (a mutant that breaks types; the alternative is `@stryker-mutator/typescript-checker` plus a `buildCommand`). The sandbox must contain `dist/**`, the schemas and `node_modules`; by default Stryker copies the git-tracked/non-ignored files and `dist/` is git-ignored, so `files` or `inPlace` must be configured (KNOWLEDGE, UNVERIFIED).
- Config sketch: `mutate: ["dist/src/fs/*.js", "dist/src/core/policy.js", "dist/src/audit/redact.js"]`, command `node --test "dist/test/fs/*.test.js" "dist/test/core/policy*.test.js" "dist/test/audit/redaction.test.js"`, `thresholds.break: null` (never fails the build), `concurrency` 2, HTML plus JSON report uploaded as a workflow artifact.
- Run-time estimate, INFERENCE (nothing run; sizes from `wc -l`: `src/fs/*.ts` 1,115 lines in 10 files, `src/core/policy.ts` 170, `src/audit/redact.ts` 95):

| Target | Lines | Estimated mutants | Test command | Estimate |
|---|---|---|---|---|
| `src/audit/redact.ts` | 95 | 40 to 90 (regex literals add many) | `redaction.test.js`, ~1 s | 1 to 3 min |
| `src/core/policy.ts` | 170 | 50 to 100 | `policy*.test.js`, ~1 s | 2 to 5 min |
| `src/fs/` | 1,115 | 250 to 450 | 9 files incl. child-process and race tests, 5 to 15 s | 25 to 110 min serial, 7 to 30 min at concurrency 4 |

  Total estimate 10 to 40 minutes on an idle runner with concurrency 4. This suits a weekly scheduled run, not a push gate.

### C.1.3 In-repo script

A minimal mutator over `dist/src/…js`: for each line apply one operator (`===`↔`!==`, `&&`↔`||`, `<`↔`<=`, `true`↔`false`, drop a `throw`, `return x`→`return undefined`), reject candidates that fail `node --check`, run the relevant `node --test` files, record killed or survived. About 200 lines, built-ins only, testable by `test:scripts`. Weaker mutator set, many equivalent mutants, no report UI, but no dependency and no 188-package tree.

### C.1.4 Recommendation

- `fast-check`: add as an exact-pinned devDependency (`4.10.2`, repo convention `package.json:69-75`).
- Mutation: Stryker core with the command runner, installed in its own directory (for example `mutation/package.json` plus lockfile, like `site/`) so the root lockfile, `npm audit --omit=dev` and the release SBOM are unaffected, with its own Dependabot entry. Make the first task a spike that answers the two UNVERIFIED points (runner choice, sandbox contents). If the spike fails, or the owner judges 188 dev packages too heavy for a supply-chain milestone, use the in-repo script (C.1.3).

## C.2 CONTRIBUTING.md items, filled in

**fast-check 4.10.2**
- Justification: QR-07 needs generated inputs (`..`, symlinks, NUL, doubled slashes, unicode) for the path canonicalizer and the policy parser with counterexample shrinking and seed replay. Re-implementing a generator and shrinker in-repo is more code than the dependency.
- Licence check: MIT (`npm view fast-check license`); its single dependency `pure-rand` 8.4.2 is MIT; resolved tree is 2 packages, both MIT (VERIFIED_BY_EXECUTION). Compatible with AGPL-3.0-only. Dev-only: not in `files`, not in the tarball, so `NOTICE` and `licenses/` need no change.
- Maintenance check: published 2026-09-19 (4.10.2), 12 releases since 2025-10-29, created 2017, npm provenance attestation, no deprecation, ESM and CJS, engines `>=12.17.0`. Risk: a single npm maintainer account (INFERENCE: bus factor of one).

**Stryker `@stryker-mutator/core` 10.1.1** (dev-only, isolated directory)
- Justification: QR-08 needs mutation testing of the security-relevant files on a schedule; Stryker is the established tool with an incremental mode and reports; an in-repo mutator is the fallback.
- Licence check: core and satellites Apache-2.0; resolved tree (core plus typescript-checker) 188 packages, all permissive: MIT, Apache-2.0, ISC, BSD-3-Clause, BlueOak-1.0.0, 0BSD, plus `caniuse-lite` under CC-BY-4.0 (browser-data package) (VERIFIED_BY_EXECUTION). Apache-2.0 is compatible with AGPL-3.0-only for a tool that is not redistributed; nothing is shipped, so `NOTICE` and `licenses/` are unchanged. The tree without the checker was not measured.
- Maintenance check: 10.1.1 published 2026-10-23, 7 core releases since 2025-10-29, three npm maintainers, npm provenance attestation, engines `>=22.0.0`, no deprecation. Risks: 26 direct dependencies including `@inquirer/prompts` and `execa`; the `node:test` fit is unproven (C.1.2).

## C.3 Properties to write

Read first: `src/fs/canonicalize.ts` (226 lines), `src/fs/root.ts` (125), `src/core/policy.ts` (170), `src/core/policy.schema.json`.

### Canonicalizer (`canonicalize(root, relPath, {mode})`, `src/fs/canonicalize.ts:84-150`)

Facts that shape the properties (VERIFIED_BY_CODE_READING): absolute `relPath` throws `PATH_ESCAPE` (`:89-91`); the walk splits on `/`, skips empty and `.` segments (`:99-101`), `..` pops `missing` or takes `dirname(current)` (`:102-108`), each real segment is `lstat`ed (`:114-115`) and a non-ENOENT/ENOTDIR error is `PATH_ESCAPE` (`:72-82`); symlink expansion is bounded at `MAX_SYMLINK_HOPS = 40` (`:24,124-127`); a write-mode final-segment symlink throws (`:121-123`); the final containment check is `isInsideRoot` (`:141-148`, `src/fs/root.ts:82-93`, segment-wise, so `<root>2` is outside); an absent result carries `nearest` and `missing` (`:36-40,144`).

Fixture, built once per test file under a temporary directory: a root with `a/`, `a/b/`, `a/f` (file), links `in -> a`, `up -> ..` (escape), `abs -> <outside dir>` (absolute), `loop1 <-> loop2`, `self -> self`, a sibling `<root>2`, and a file outside the root. Segment arbitrary: `fc.oneof` of `".."`, `"."`, `""`, `"a"`, `"b"`, `"f"`, `"in"`, `"up"`, `"abs"`, `"loop1"`, `"self"`, `"new"`, a NUL-bearing string, a very long name, a unicode string (NFC and NFD of one name, fullwidth characters, right-to-left marks), joined with `"/"`, `"//"` or `"///"`.

1. **No escape (the main property).** For every generated `relPath`, either `canonicalize` throws a `RealmError` with code `PATH_ESCAPE`, or the result is inside the root by an independent oracle (`path.relative(root.realPath, result)` is neither absolute nor starts with `..`). For `absent`, the same holds for `join(nearest, ...missing)`.
2. **Differential against the kernel.** When the walk target exists, `found.realPath === realpathSync(join(root.realPath, relPath))` if that is inside the root, and `PATH_ESCAPE` when it is outside. Symlink-loop inputs: `realpathSync` throws `ELOOP` where `canonicalize` throws `PATH_ESCAPE`.
3. **Absolute and NUL.** Any absolute `relPath` throws `PATH_ESCAPE`; a NUL inside a segment that is reached through `lstat` throws `PATH_ESCAPE` (the `ERR_INVALID_ARG_VALUE` code is not ENOENT, `:76-80`; INFERENCE).
4. **Absent shape.** `status: "absent"` implies `nearest` exists and is a real path inside the root, `missing` is non-empty, and no `missing` segment is `..`, `.`, empty or contains `/`. Expected discovery to evaluate (INFERENCE from `:110-113`): a NUL-bearing segment after a missing segment is pushed to `missing` without an `lstat`, so `new/<NUL>x` may yield `absent` with a NUL in `missing`. Whether that is a defect is a judgement for the executor and the owner; do not suppress it, and note FS-02 stays the owner's call.
5. **Idempotence.** `canonicalize(root, relative(root.realPath, found.realPath))` returns the same `realPath`.
6. **Write mode.** With `mode: "write"`, a path whose final segment is a symlink throws `PATH_ESCAPE`.
7. **Unicode is bytewise.** NFC and NFD spellings of one name are distinct entries; each resolves only to itself.

`isInsideRoot` direct property: for random pairs, `<root>`, `<root>/x`, `<root>2`, `<root>/../x` give true, true, false, false.

### Policy (`loadPolicyFile`, `decideMutation`, `checkExecPolicy`, `src/core/policy.ts`)

Facts: a missing file returns validated defaults (`:30-32`); content is validated against `policy.schema.json` (`additionalProperties: false`, enums, `startupBudgetMs`/`toolQueueMs` integers with minimum 1, egress `port` 1 to 65535); relative roots throw `SchemaInvalidError` naming the index (`:77-83`); the policy file must not live inside any own root and a root that cannot be canonicalized is `POLICY_DENIED` (`:89-107`); parse errors are `SchemaInvalidError` that never echo content (`:66-73`).

1. **Round trip.** For a generated full policy (`mode`, `workspaceRoots` drawn from a pool of real absolute directories that do not contain the policy file, `credentialAllow`, `egressAllow`, `shellEnabled`, budgets), `loadPolicyFile(write(JSON.stringify(p)))` deep-equals `p`; key order does not matter.
2. **Defaults from the schema, not from the test.** For a random subset of keys, the loaded policy equals the schema defaults overlaid with the subset, reading defaults from `policy.schema.json`. Do not hard-code `"advisory"`: Phase 15 (D4) flips that default, and `test/core/policy.test.ts:38-50` already hard-codes it, so Phase 15 must update that test.
3. **Unknown keys rejected.** Add any key not in the schema (including `__proto__`, `constructor`, unicode, and extra keys inside an `egressAllow` entry): `SCHEMA_INVALID`, the key named, and a generated secret value never appears in `error.message`.
4. **Type and range confusion.** Replace one known key by a value of another type or an out-of-range number (port 0 or 65536, budget 0, negative, fractional): `SCHEMA_INVALID`.
5. **Relative roots.** Any non-absolute root string yields `SCHEMA_INVALID` naming its index and not the value.
6. **Totality.** For arbitrary file text, `loadPolicyFile` returns a policy or throws a `RealmError`; never a raw `SyntaxError` or `TypeError`.
7. **Policy outside roots.** For a policy file placed at any generated depth under a listed root, `POLICY_DENIED`.
8. **`decideMutation` total and safe.** For every `(mode, state)`: `active` allows; `fail-closed` with any other state denies with a code in `REALM_UNBOUND | REALM_STOPPING | REALM_NOT_ACTIVE` and never allows; `advisory` with any other state returns `allow-with-warning`.
9. **`checkExecPolicy`.** The argv form never throws; the shell form throws `SHELL_NOT_ALLOWED` exactly when `shellEnabled` is false.

Seeds: use `fc.assert` defaults (random seed, printed on failure) with a shared `numRuns` in a `test/support/property.ts` via `fc.configureGlobal`; when a property finds a bug, add the minimal counterexample as an ordinary example test. Demonstration for QR-07 ("a deliberately broken canonicalizer fails at least one property"): in a scratch copy, remove the `isInsideRoot` check at `:146-148` or turn `..` into a no-op at `:102-108`, run the properties, and record the failing seed in the PR. The mutation run (QR-08) is the continuous form of that check.

## C.4 Open questions (Part C)

1. Stryker (isolated directory) or the in-repo script? The spike decides; the owner may rule out the 188-package tree up front.
2. Does the scheduled workflow commit or publish the report? Suggested: upload as an artifact only, never fail the run (`thresholds.break: null`).
3. Whether a NUL after a missing segment (C.3 canonicalizer property 4) is a defect to fix in Phase 13 or a recorded finding.

## C.5 Suggested plan slicing (Part C; two pull requests)

PR C-props (QR-07):
- Wave 1: `package.json` and `package-lock.json` (exact `fast-check@4.10.2`; the PR body carries the three items from C.2), `test/support/property.ts`. Needs the `package.json` owner to be serialized with Part B's script edit.
- Wave 2 (parallel, file-disjoint): `test/fs/canonicalize.property.test.ts`; `test/core/policy.property.test.ts`; both use the fixture helpers they build themselves.
- Wave 3: the deliberate-breakage demonstration, recorded in the PR.

PR C-mutation (QR-08, D6 cited; after the spike): `.github/workflows/mutation.yml` (`schedule` weekly plus `workflow_dispatch`, `contents: read`, self-hosted label, artifact upload), the mutation config under its own directory with lockfile, `.github/dependabot.yml` entry (added by the Part A unit or a follow-up commit), docs (`AGENTS.md` Layout and Commands, `CONTRIBUTING.md`). Independent of C-props except for the shared `package.json` only if the tool were installed at the root, which this design avoids.

---

# PART D (Phase 20): release job split, attestation, rollback, changelog filter

## D.1 Findings

**D.1.1 What the split must separate.** Today one job both runs dependency and build code (`npm ci --ignore-scripts`, `tsc`, `npm pack`; `ci.yml:159-162,345-350`) and holds `contents: write` and `actions: write` (`:138-140`), with the checkout token withheld from those steps and passed into the push step only (`:150-152,385-422`). The workflow itself says a split "would remove the shared user altogether" (`:398-401`) and `AGENTS.md:105` records it as the precondition for provenance. REL-01 asks only that write permissions and publishing steps live solely in the publish job (`ROADMAP.md` Phase 20 criterion 1).

**D.1.2 Self-hosted limits.** `permissions:` separate GitHub token scopes per job, but two jobs on the same self-hosted machine and Unix user are not process-isolated: a build step can leave a surviving process or modify the runner user's home, tool cache or `_work`, and a later job on that machine runs as the same user (KNOWLEDGE, INFERENCE). Real isolation needs the privileged jobs on a different runner identity (ephemeral or a separate OS user and label) or on a GitHub-hosted runner. That conflicts with the repository's "never on GitHub-hosted runners" rule (`ci.yml:19-20`). This is the first open question for the owner. Without it the split still meets REL-01 as worded but leaves the shared-user risk, and the documentation must say so.

**D.1.3 Attestation action (verified today from the primary READMEs).**
- `actions/attest-build-provenance` v4 "is simply a wrapper on top of `actions/attest`"; new implementations should use `actions/attest` (README of `actions/attest-build-provenance`, read 2026-10-29). Latest release tags via `gh api`: `actions/attest` v4.2.2 (2026-08-04, commit `1e69f48acb82d1966a394da916b4c1698aa569d6`), `actions/upload-artifact` v7.0.2 (2026-10-07, `cf430e030ddbb5b0abf93d22962f4752f3646cd9`), `actions/download-artifact` v8.0.2 (2026-10-07, `9000827ccba6bdab643e8b6fd33ac0654aef8333`) (VERIFIED_BY_EXECUTION). The user-given name was "from knowledge, UNVERIFIED"; the README confirms it, so the current recommended action is `actions/attest`.
- `actions/attest` modes: no predicate input generates SLSA build provenance; `sbom-path` attests an SPDX or CycloneDX SBOM; `predicate-*` inputs make a custom attestation. Subject inputs: `subject-path`, `subject-digest`, `subject-checksums` (a `sha256sum`-format file) or auto-discovery. Required permissions listed in its README: `id-token: write`, `attestations: write`, `artifact-metadata: write` (the last only for storage records; the action continues without the record if absent per the search summary, which is a secondary source).
- Public repo: Sigstore public-good instance, so the attestation lands in the public transparency log; private/internal needs GitHub Enterprise Cloud and uses GitHub's own Sigstore instance. This repository is public (VERIFIED_BY_EXECUTION).
- Self-hosted runner: the same permissions apply. The runner must reach the OIDC endpoint, `api.github.com`, and for a public repo the Sigstore hosts (Fulcio, Rekor, TUF); host names and the timestamp-clock sensitivity come from a secondary search summary, so treat them as UNVERIFIED and test egress in the rehearsal. Whether `omega-ci` allows that egress is UNKNOWN. A self-hosted runner does not give GitHub-hosted isolation guarantees, which limits the SLSA build level claim (secondary source). The certificate records the runner environment, which `--deny-self-hosted-runners` filters on.
- `assets.mjs` writes `SHA256SUMS` in `sha256sum` format for the tarball only (`scripts/release/assets.mjs:21-27,82`), so `subject-checksums: SHA256SUMS` is a ready subject file; the SBOM could get its own `sbom-path` attestation.

**D.1.4 `gh attestation verify`** (primary manual, read 2026-10-29): `gh attestation verify <file> --repo <owner/repo>` (or `--owner`) is the minimum; the default predicate type is `https://slsa.dev/provenance/v1`; the manual recommends also `--signer-workflow <owner/repo/path>` and notes that with a reusable workflow that workflow is the signer and `--signer-workflow` or `--signer-repo` is required. Other flags: `--source-ref`, `--source-digest`, `--signer-digest`, `--deny-self-hosted-runners` (would reject this repository's own attestations by design, so consumers must not pass it), `--bundle` and `--custom-trusted-root` (offline, with `gh attestation download`), `--predicate-type`, `--format json`. Needs: the artifact file (the release tarball), network to the GitHub attestation API unless a bundle is supplied, and a `gh` recent enough to have the subcommand (minimum version UNVERIFIED; `gh` is at `/usr/bin/gh` here). A GitHub token requirement for anonymous verification of a public repository is UNVERIFIED. An SBOM attestation would be verified with the matching `--predicate-type` (CycloneDX type string is KNOWLEDGE, UNVERIFIED).

**D.1.5 Changelog (TD-08).** `scripts/release/changelog.mjs:84-114` runs `git log --no-merges --format=%h%x09%s <since>..HEAD` and keeps every commit except subjects starting `chore(release)` and scope `planning` without `!` (`:79-82,108`). It reads subjects only, so a feature commit and the commit that later removes the feature both appear, or only the feature when the removal is worded differently. Evidence: the `0.2.0` section of `CHANGELOG.md` lists the isolation backend (`feat(isolation): …`, lines 40-48), the native enforcement helper (`:55`) and then `refactor(isolation): remove the registered backend code the built-in path makes dead (edb1053)` (`:66`). The generator is pure Node with `git`, and `changelog.test.mjs` builds temporary git repositories (`:3-4,33-58`), so a filter is fully testable offline. All existing test fixtures write the same `work.txt` in every commit (`changelog.test.mjs:38`), so a path-survival rule leaves them unaffected.

**D.1.6 Other facts the design relies on.** `next-version.mjs` ignores tags that do not match `^v\d+\.\d+\.\d+$` (`scripts/release/version.mjs:1-12`), so a non-matching rehearsal tag cannot disturb numbering. `sync-version.mjs` accepts only `0.<minor>.<patch>` (`:5`). `workflow_dispatch` is already declared on `ci.yml` (`:10`) so a branch version of the workflow can be dispatched before merge. Pushes made with the default token do not start new workflow runs, and `[skip ci]` is additional (KNOWLEDGE). `release/milestone.json` is still `v2.0`, minor 2, at this commit.

## D.2 Design: the split

### D.2.1 Structure

Move the release into a reusable workflow `.github/workflows/release.yml` (`on: workflow_call` plus `workflow_dispatch` with `rehearsal: boolean`), called from `ci.yml`:

```yaml
  release:
    needs: [verify, site, audit]
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    concurrency: { group: release-main, cancel-in-progress: false }
    permissions: { contents: write, actions: write, id-token: write, attestations: write }
    uses: ./.github/workflows/release.yml
```

Reasons (KNOWLEDGE, to be proven by the rehearsal): a job-level `concurrency` on the calling job serializes the whole called workflow. Putting `concurrency: release-main` on each inline job would let a newer run's pending job cancel an older run's pending job in mid-chain (pending jobs in a group are replaced), which breaks the chain; the caller-level group avoids that. The called workflow's job-level `permissions` can only narrow what the caller grants, so the caller carries the union and `release.yml` shows the per-job split. The signer workflow identity in the attestation becomes `release.yml`. Alternative: keep jobs inline in `ci.yml` with a workflow-level group; simpler to read, but the concurrency problem returns. Decide in Q2.

Jobs in `release.yml` (all `runs-on` the pool label unless Q1 says otherwise):

| Job | Permissions | Does | Outputs |
|---|---|---|---|
| `plan` | `contents: read` | checkout with `fetch-depth: 0`, `persist-credentials: false`; fetch tags; `next-version.mjs`; the Plan logic (`skip`, `superseded`, `normal`, plus `finish` for a tag without a release); `gh release view` read with the read token; the release date (`date -u`) | `action`, `tag`, `version`, `previousTag`, `date`, `ref` (the SHA, or the tag for `finish`) |
| `build` | `contents: read` | `needs: plan`, runs only for `normal` or `finish`; checkout `ref` with no persisted token; Node 24; `npm ci --ignore-scripts`; for `normal`: `sync-version.mjs`, `changelog.mjs`; `npm run build`; `npm pack`; `check:pack --tarball … --expect-version` (Part A); `assets.mjs`; `upload-artifact` of tarball, `SHA256SUMS`, SBOM, `release-notes.md`, and the exact bytes of the files `sync-version.mjs --files` plus `CHANGELOG.md` | artifact name |
| `attest` | `contents: read`, `id-token: write`, `attestations: write` | no checkout of build code, no `npm`; `download-artifact`; recompute SHA-256 of the tarball; `actions/attest` with `subject-path` (or `subject-checksums: SHA256SUMS`); optionally a second `actions/attest` with `sbom-path` | attestation id |
| `publish` | `contents: write` | `needs: [plan, build, attest]`; checkout the SHA with no persisted token; download artifact; **regenerate** `sync-version.mjs` and `changelog.mjs` itself (built-ins only, from the reviewed checkout), compare byte for byte with the build job's copies and with `package.json` and `CHANGELOG.md` inside the tarball (`tar -xzOf`), and fail on any difference; `gh attestation verify` on the tarball (`--repo`, `--signer-workflow`, `--source-digest`); then the commit, tag and atomic push exactly as at `ci.yml:362-422` (token only through `GIT_CONFIG_*`); re-check the superseded condition immediately before the push; `gh release create` with the three assets (`:426-441`); for `finish`, only `gh release create` against the existing tag | `pushed`, `tag` |
| `pages` | `actions: write` | the dispatch logic of `ci.yml:448-464`, unchanged | none |

Principles that make the split meaningful:
- The publish job never commits bytes that came from the build job; it commits what it regenerates and proves equal. A compromised build can therefore not inject content into `main`.
- The build job can still produce a malicious tarball. The attestation proves which workflow and commit produced the bytes, not that they are benign; say so in `SECURITY.md`. The reviewed repository scripts run in the publish job (Node built-ins only), and no `npm ci`, `tsc`, tests or dependency code do.
- `id-token: write` exists only in `attest`, which has no build code, so build code cannot mint an OIDC token to forge attestations.
- Superseded semantics are kept: `plan` decides early, `publish` re-checks `origin/main` before pushing.
- Build `finish`: same as today, build from the tag's worktree equivalent (checkout `ref` = the tag), skip sync and changelog, verify the notes section exists (`:224-227`), and publish only the release.

### D.2.2 Artifacts and runner requirements

`upload-artifact` and `download-artifact` v4 and later need a runner that supports the newer artifact service (minimum runner version KNOWLEDGE, UNVERIFIED); self-hosted runners must be new enough. Artifacts pass between jobs, possibly between machines. If the pool has several machines, artifact download is the only handoff; no shared workspace may be assumed.

### D.2.3 Version sync, changelog, commit, tag

Order inside the chain: `plan` computes version and date once; `build` runs `sync-version.mjs` and `changelog.mjs` with those values before `npm pack`, so the tarball carries the synced version and the new `CHANGELOG.md` section; `publish` regenerates the same files from the same inputs (git history of the SHA, version, date, `previousTag`) and commits them with `chore(release): <tag> [skip ci]`, tags annotated, and pushes `main` and the tag atomically. The tarball, the commit and the tag then describe the same tree for every shipped file; `package-lock.json` is the one file in the commit that is not in the tarball, and it is rewritten only by `sync-version.mjs` (VERIFIED_BY_CODE_READING `:17`).

### D.2.4 Rollback workflow

`.github/workflows/rollback.yml`, `workflow_dispatch` only. Inputs: `tag` (required, must match `^v0\.\d+\.\d+$` and exist as a release), `reason` (required, free text, passed through an environment variable and never interpolated into shell), `latest_tag` (optional: the release to restore as "latest", default the highest earlier non-prerelease), `dry_run` (boolean, default true). Permissions: `contents: write` (release edit) and `actions: write` (dispatch Pages), per job. Steps: validate inputs; `gh release view`; refuse if already a prerelease; `gh release edit <tag> --prerelease` (and `--latest=false`); prepend a "Withdrawn: <reason>" block to the release notes; `gh release edit <latest_tag> --latest`; dispatch `pages.yml`. It never deletes a tag or release and never touches `main` (`AGENTS.md:114`). Put the logic in `scripts/release/rollback.mjs` as a pure planner (`planRollback({ releases, tag, latestTag })` returning the `gh` argument lists) with an injectable executor, so `rollback.test.mjs` runs offline against a fake `gh`.

"Re-point the documentation" is under-specified (`REL-03`, `REQUIREMENTS.md:92`). Two readings: (a) re-point GitHub's "latest release" and re-run Pages so the badge and `releases/latest` URL follow the previous good release, no commit; (b) add a committed withdrawn marker (for example `release/withdrawn.json`) that `scripts/docs/sync-site.mjs` renders as a banner, which makes the rollback workflow a second writer to `main`. Recommendation: (a), and document it; (b) needs an owner decision because it adds a writer to `main` and changes `release/**`. The Pages site is built from the tip of `main` (`pages.yml`), so without a commit it cannot show a banner unless the site build reads release state from the API at build time, which is new scope. Protecting the workflow with a GitHub environment with required reviewers is a repository setting (owner).

### D.2.5 Changelog filter (REL-04)

Rule set implemented in `changelog.mjs`, using the commit's touched paths, not its subject:

- R1: drop a commit when it adds or modifies at least one path and every path it adds or modifies is absent from the `HEAD` tree and is not the source of a rename in `git diff -M --name-status <sha> HEAD` (a feature never shipped). Paths under `.planning/` and `CHANGELOG.md` are ignored when computing the set.
- R2: drop a commit that only deletes paths when every deleted path was first added inside the same range (removal of code that never shipped). A removal commit that deletes a path from an earlier release stays, because a shipped feature's removal is user-visible.
- Mixed commits, commits with an empty path set, and commits that touch any surviving path stay.
- Optional complement: honor a `Changelog: skip` trailer in the commit body.

Implementation notes: one `git log --no-merges --name-status -M --format=…` read for the range, one `git ls-tree -r --name-only HEAD` for the surviving set, and `git log --diff-filter=A --format=%h -- <path>` limited to the range for R2; per-commit `git diff` calls for rename tracking are bounded by the commit count (a release spans tens to low hundreds of commits; each call already has the 30 s timeout style used at `:88-92`). Subject-pairing heuristics (match `feat(x)` against a later `remove x`) are fragile and are not proposed. The rule applies to the `since..HEAD` range at release time, so it fixes the next release; the already published `0.2.0` section is not regenerated (`generateChangelog` returns unchanged when the heading exists, `:152-158`).

Tests (offline, temp repositories as in `changelog.test.mjs`): a feature commit whose files a later commit deletes is absent; the removal commit of never-shipped code is absent; the removal of a file that existed before `since` is present; a commit touching one deleted and one surviving file is present; a renamed file counts as surviving; commits with no path changes stay; the existing tests in `changelog.test.mjs` still pass unchanged.

## D.3 What can be tested where

Locally, in `npm run test:scripts` or by hand (VERIFIED_BY_CODE_READING that each script is plain Node and already tested that way): `changelog.mjs` filter; `rollback.mjs` planner with a fake `gh`; the bundle-equality check (regenerate and compare) in a temp git repository; `pack-smoke.mjs --tarball/--expect-version`; `sync-version.mjs`, `assets.mjs`, `next-version.mjs`; `actionlint` on every workflow (needs a labels config for `omega-ci`); YAML shape. A dry run of the whole build half in a scratch worktree with the real scripts (without token) is possible.

Only a real run proves: the permission ceiling of a reusable workflow, per-job token scopes, `upload-artifact`/`download-artifact` on this runner pool, `actions/attest` signing and Sigstore egress from `omega-ci`, `gh attestation verify` against the real store, whether a same-host build can influence a later publish job (Q1), concurrency behavior across overlapping pushes, the atomic push, `gh release create`, the Pages dispatch, the rollback's `gh release edit` result, and environment approvals.

## D.4 Safe rollout

1. First change that does not alter the release outcome: `20.0`: an `actionlint` baseline (labels file) and a pull-request job that runs the **build half** with no write permission (`permissions: contents: read`): sync to a throwaway version, build, pack, `check:pack --tarball --expect-version`, assets, with no remote effect. It runs on pull requests that touch `.github/workflows/**`, `scripts/release/**` or `release/**`. The release job itself is untouched.
2. REL-04 and REL-03 (changelog filter, rollback) land independently; they change release notes and add a manual workflow only. Run the rollback in `dry_run` first, then once on a test release created for the purpose (a tag that does not match `^v\d+\.\d+\.\d+$` is ignored by `next-version.mjs`, so a test release cannot disturb numbering).
3. Split behind a rehearsal: add `release.yml` with `workflow_dispatch` input `rehearsal` (default true). In rehearsal the chain runs `plan` (`action=rehearsal`), `build`, `attest` and `publish` up to the equality check and the `gh attestation verify`, and skips the commit, tag, push, release and Pages. Dispatch it from the pull request branch (`gh workflow run release.yml --ref <branch>`); `ci.yml` already has a `workflow_dispatch` trigger, so a branch copy of a workflow can be dispatched before merge. The attestation of a throwaway artifact is permanent and public but harmless; verify it with `--source-ref refs/heads/<branch>`.
4. Cutover pull request: `ci.yml`'s release job becomes the `uses:` caller; the old inline steps are deleted in the same PR (clean cutover, `AGENTS.md`). Merge only with D6 cited and human review (`AGENTS.md:140`). The merge's own push to `main` is the first real run; watch it. If a step after the tag push fails, the Finish logic in the next run (now the `finish` path) completes the release; rollback is a revert of the cutover PR, which restores the inline job. Keep the old behavior observable: same tag, same three assets, same commit subject, same Pages dispatch.
4b. Verify REL-02 on the first real release: `gh attestation verify agent-realm-<version>.tgz --repo swcstudiospace/realm --signer-workflow swcstudiospace/realm/.github/workflows/release.yml --source-ref refs/heads/main`, recorded in the phase verification. Until then it is UNVERIFIED (`ROADMAP.md` Phase 20 note).
5. Docs in the cutover or the next PR: `AGENTS.md` ("Versioning and release", "Merge and release flow", Layout), `SECURITY.md` (how to verify, what the attestation does and does not prove, self-hosted caveat), `README.md` (a short verification command), `CONTRIBUTING.md` if commit guidance changes, and the supply-chain notes in `docs/integration/openshell.md` that mention provenance.

## D.5 Open questions (Part D)

1. **Runner isolation for `attest` and `publish`:** a separate ephemeral or separate-user label on the pool, GitHub-hosted runners for just these two jobs, or accept permission-only separation on the shared user? Needs the owner and the Omega pool documentation. Blocks the claim in the docs, not the workflow shape.
2. Reusable workflow (`release.yml`) or inline jobs in `ci.yml`? Recommendation: reusable, for the concurrency reason in D.2.1; rehearsal proves it.
3. Does `omega-ci` allow egress to the Sigstore and OIDC endpoints and run a runner new enough for the v4+ artifact actions?
4. "Re-point the documentation": reading (a) or (b) in D.2.4; a required-reviewer environment for the rollback.
5. Attest the SBOM too, or only the tarball?
6. Changelog filter R2 (dropping removals of never-shipped code): acceptable, or keep removal commits visible?
7. Should rehearsals use a throwaway fork instead of the real repository (attestation records are permanent and public)?

## D.6 Suggested plan slicing (Phase 20; every pull request cites D6 and needs human review)

Wave 1 (parallel, file-disjoint, fully local):
- 20-A `scripts/release/changelog.mjs` and `changelog.test.mjs` (REL-04), docs line in `CONTRIBUTING.md` and `AGENTS.md`.
- 20-B `scripts/release/rollback.mjs`, `rollback.test.mjs`, `.github/workflows/rollback.yml` (REL-03), with the Q4 answer applied.
- 20-C `.github/actionlint.yaml` (labels) plus the pull-request build-half job in `ci.yml` (changes no release outcome). Single owner of `ci.yml` in this wave.

Wave 2 (needs Wave 1 for `ci.yml` ownership and the decisions Q1 to Q3): 20-D `.github/workflows/release.yml`, helper scripts `scripts/release/plan.mjs` and `scripts/release/verify-bundle.mjs` with tests, `scripts/check/pack-smoke.mjs` if Part A did not already add the flags. Rehearsal runs recorded.

Wave 3 (single unit, serial): 20-E the cutover edit of `ci.yml` (replace the release job with the caller, delete the inline steps) and the docs listed in D.4 step 5; then the observed first release and the `gh attestation verify` result recorded as the phase evidence.

Dependency on Phase 13: both edit `ci.yml` (audit job and coverage step there; release job here), and Part A already adds the release `check:pack` step that Phase 20 moves into `build`. Phase 20 starts after the Phase 13 pull requests that touch `ci.yml` have merged.

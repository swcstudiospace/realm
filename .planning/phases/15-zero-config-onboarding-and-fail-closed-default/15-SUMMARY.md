# Phase 15 summary: zero-config onboarding and fail-closed default

Date: 2026-11-02. Branch `gsd/v3-autonomous`, HEAD `612a6d4` at closeout. Requirements: DEF-01, DEF-02, ONB-01 to ONB-07. Plans: `15-01-PLAN.md` to `15-16-PLAN.md` (replanned in `eb832ab`). Context: `15-CONTEXT.md` (D4, P15-O1 to P15-O4, D-1501 to D-1508). Verification: `15-VERIFICATION.md`, status `human_needed`.

## Outcome
The Phase 15 code is on the branch in five commits (below). The automated evidence supplied for this closeout passes. The live steps (L-A, L-B, L-C, L-C2, L-D and the PR D transcripts) were not run and are not approved; they are human-needed. Phase 15 is not closed. No requirement is checked in this record; REQUIREMENTS.md, ROADMAP.md and STATE.md are parent-owned.

## Commits
Confirmed with read-only `git log` on the worktree. All five are ancestors of HEAD.

| Short hash | Subject | Requirements | Main files |
|---|---|---|---|
| 84f335b | security!: default the policy mode to fail-closed (phase 15, part 1) (#19) | DEF-01, DEF-02 | `src/core/policy.schema.json`, `src/core/policy.ts`, `src/doctor/checks.ts`, `src/cli/main.ts`, `src/omp/plugin.ts`, `scripts/check/default-mode.mjs` (+ test), `docs/policy-reference.md`, `docs/integration/*`, `README.md`, `AGENTS.md`, `site/content/index.md`, `package.json`, policy and doctor tests; 27 files |
| 4037f84 | feat(runtime): read sandbox roots from config and allowlist the daemon environment (#29) | ONB-03, ONB-04 (checks), ONB-07 | `src/runtime/config.ts`, `src/daemon/spawn-env.ts`, `src/daemon/main.ts`, `src/daemon/daemon.ts`, `src/daemon/channel.ts`, `src/runtime/driver/main.ts`, `src/doctor/runtime-checks.ts`, `src/cli/main.ts`, `test/daemon/spawn-env.test.ts`, `test/doctor/runtime-root-checks.test.ts`, `test/support/production-live.ts`; 31 files |
| db2f966 | feat(doctor): report each driver root once and add the safe state-directory fix (#39) | ONB-02, ONB-04 | `src/doctor/fix.ts` (new), `src/doctor/runtime-checks.ts`, `test/doctor/fix.test.ts`, `test/doctor/checks.test.ts`; 4 files |
| 01f72f3 | Drive the gsd-autonomous milestone through every remaining ROADMAP.md p… (#38) | ONB-01 | `src/cli/init.ts` (new), `src/cli/main.ts`, `test/cli/init.test.ts`; 3 files |
| b6eaf27 | fix(onboarding): safely initialize roots and expose doctor repairs | ONB-01, ONB-02, ONB-05 and ONB-06 (docs) | `src/cli/init.ts`, `src/cli/main.ts`, `src/doctor/fix.ts`, `src/doctor/runtime-checks.ts`, `README.md`, `docs/hosts/snippets/omp.md`, `AGENTS.md`, init, fix, cli and doctor tests; 12 files |

The 01f72f3 subject is truncated in git. Its body lists `feat(cli): add realm init` and `fix(cli): resolve symlinks before containment and make init publication durable`.

## Scope delivered (by requirement)
- DEF-01: the schema default is `"fail-closed"`. `loadPolicyFileDetailed` returns the policy with its provenance (`explicit`, `default`, `no-file`); `loadPolicyFile` returns its `.policy`. The doctor `policy-file` check states the mode and its source, and warns for an explicit `advisory` ("this is not containment").
- DEF-02: the README, `AGENTS.md`, `docs/policy-reference.md`, the integration docs and the site index state the fail-closed default and name advisory as the explicit opt-in. Upgrading notes are present. The breaking marker is in the 84f335b subject. `scripts/check/default-mode.mjs` runs inside `npm run check:docs`.
- ONB-03: `RuntimeConfig` has optional `secretRoot` and `sandboxStateRoot`, with defaults derived under `stateDir`. The driver and the daemon read the same config. The three `REALM_DRIVER_*_ROOT` variables are no longer read: they appear only in comments in `src/runtime/driver/main.ts` and `src/daemon/main.ts`. Live proof is pending.
- ONB-07: `src/daemon/spawn-env.ts` holds the allowlist (`daemonSpawnEnv`), used by the CLI spawn and by `startDetachedDaemon`. `test/daemon/spawn-env.test.ts` plants a sentinel and a stale `REALM_DRIVER_SECRET_ROOT` and asserts neither reaches the daemon on either start path.
- ONB-04: three doctor checks, `runtime-roots`, `driver-socket` and `gateway`, in `src/doctor/runtime-checks.ts` (ids in `src/doctor/checks.ts`). Unit tests are in `test/doctor/runtime-root-checks.test.ts`. The live doctor run (L-B) is pending.
- ONB-01: `realm init` preflights before any write and never overwrites (`linkSync` no-clobber publish). It writes `policy.json` then `config.json` at mode 0600, creates the state directory at 0700, and resolves symlinks before its containment checks. `test/cli/init.test.ts` covers: an existing `config.json` or `policy.json` is refused and left as it was; symlinked targets, a dangling symlink and a symlinked state directory are refused; a state directory inside the workspace, or the reverse, is refused; a relative path or a malformed digest writes nothing; a refused run leaves no file, state directory or config directory. The live clean-host run (L-C) is pending.
- ONB-02: `realm doctor --fix [--dry-run]` in `src/doctor/fix.ts` uses `lstat` and no-follow `fchmod`, refuses symlinks, foreign-owned directories and unsafe targets, and touches only the listed directories. `test/doctor/fix.test.ts` covers: a 0755 state directory is set to 0700 with a named action; missing `run` and `sessions` are created at 0700; a second run changes nothing; a dry run reports the same actions and writes nothing; symlinks at the state directory or a subdirectory are refused with their targets unchanged; the home directory, the workspace root and the filesystem root are refused. The live run (L-C) is pending.
- ONB-05: README install steps and the isolated local-link section in `docs/hosts/snippets/omp.md` (b6eaf27). The 2026-10-30 receipt (Omp 18.12.6, package 0.3.24) is kept as historical. The current isolated install (L-D) is not run.
- ONB-06: README quickstart with a transcript of `init`, `up`, `status`, `down`. The transcript in the README is the 2026-10-31 capture on Realm 0.3.26 and Podman 5.7.1. Plan 15-16 (Q1) requires a fresh capture on the current build (L-C2). That capture is not run, and the existing transcript predates b6eaf27.

## Verification commands and results
The results below were reported by the parent for this tree. This closeout did not rerun them.

| Command | Result |
|---|---|
| `npm test` (full suite, one-CPU quota) | 2458 tests, 2426 pass, 0 fail, 32 skipped |
| `npm run typecheck` | exit 0 |
| `npm run lint` | exit 0 |
| `npm run test:scripts` | exit 0 |
| `npm run check:docs` | exit 0 |
| `npm run check:gates` | exit 0 |
| `npm run build` | exit 0 |
| `npm run check:pack` | exit 0 |
| `npm run check:mcp` | exit 0 |

Read-only checks made for this closeout: commit hashes and subjects (git log), `policy.schema.json` default, the absence of live reads of the three root variables in `src`, the `check:docs` wiring in `package.json`, and the presence and test names listed above.

## Live steps (not run; human-needed)
- L-A: the production live suite on the realm stack, with roots read from `REALM_LIVE_DRIVER_CONFIG`. Not run.
- L-B: the P15-O4 edit of the driver unit (drop the three roots, add the config home), a driver restart, the restored unit, and the doctor's three runtime items. Not run.
- L-C and L-C2: `realm init`, `realm up`, `realm status`, `realm down` on a clean Podman 5.x host, plus `doctor --fix`. Not run.
- L-D: `omp plugin install` under an isolated profile, followed by list and an rpc-ui session. Not run.
- PR D: the README transcript on the current build. Not run.
- Owner approval: the only approved live window was production live scenario 5, a Phase 14 step. It ran once on 2026-11-02 and passed (1 of 1). It is not one of the Phase 15 steps above, so those remain human-needed and unapproved.

## Deviations
1. The closeout brief described 01f72f3 as "the init and fix path with docs". Its diff contains only the init path. The fix path is in db2f966 and b6eaf27; the docs are in 84f335b and b6eaf27.
2. b6eaf27's subject carries no PR number.
3. The brief describes L-A as nine scenarios. The suite has ten scenarios at HEAD (`production live 1` to `production live 10`). The nine-scenario figure is stale.
4. The code commits (84f335b to b6eaf27) predate the replan to 16 plans in `eb832ab`. The requirement mapping in this record uses the plan files on HEAD.
5. REQUIREMENTS.md lines 50 to 65 and the traceability rows 191 to 199 carry recovery notes dated 2026-10-31. They cite live runs for ONB-01, ONB-02 and ONB-03 and a transcript for ONB-06. This closeout did not re-observe those runs, and the owner has superseded the recovery overlays. REQUIREMENTS.md still shows ONB-01, ONB-02 and ONB-03 as checked. This closeout does not change those checkboxes.

## Open items
- Parent: run or approve the human-needed steps (L-A, L-B, L-C and L-C2, L-D, PR D), under the live lock, one at a time. Each needs owner approval. Scenario 5 is already done and does not count toward them.
- Parent: reconcile REQUIREMENTS.md checkboxes and traceability with `15-VERIFICATION.md`.
- Parent: update ROADMAP.md and STATE.md after the human steps are recorded.
- Phase 16 depends on the Phase 15 roots and the fail-closed default. Both are implemented; their live proof is pending. The fail-closed default is not containment of Omp's built-in tools. Phase 16 owns that (D3).

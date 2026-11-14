---
phase: 15-zero-config-onboarding-and-fail-closed-default
verified: 2026-11-14
verdict: passed
status: passed
ref: origin/main 724f487 (PRs 72, 73, 74 merged; 080d864, ca527cc)
supersedes: /root/15-VERIFICATION-final.md (origin/main 5f5b185)
---

# Phase 15: Zero-config onboarding and fail-closed default: Re-verification at 724f487

**Goal:** A new user on a Podman 5.x host reaches an active sandbox with `realm init` and `realm up` and no manual edit, and a policy that says nothing about its mode contains the agent.

**verdict: passed.** All five roadmap success criteria have evidence on `origin/main` 724f487. No unannotated default-mode statement remains in `docs/specs/realm-spec.xml`.

**Method.** Worktree `/tmp/verify-724` at `origin/main` 724f487, removed after this report was written. Static reads and greps only. No tests, lint, typecheck, build, formatters, `check:docs` or `scripts/check/default-mode.mjs` were run. Line numbers are at 724f487. Nothing was committed.

**Drift since the live evidence build.** The live transcripts were captured at `1ddfc45`, which is an ancestor of `origin/main`. `git diff 1ddfc45 HEAD -- src test scripts package.json` is not empty (3 files, 56 insertions, 9 deletions). It is `src/session/checkpoint.ts` and `test/session/checkpoint-symlink.test.ts` (ef9f68a, PR 73), plus `package.json` `@rivet-dev/agentos-core` 0.4.4 to 0.4.7 (4b73f77). None of these is on a Phase 15 criterion path (`src/cli/init.ts`, `src/doctor/*`, `src/runtime/config.ts`, `src/core/policy*`). See residual 2.

## Goal Achievement: Roadmap Success Criteria

Criteria text: `.planning/ROADMAP.md` l.418-427 at 724f487.

| # | Criterion | Status | Evidence on main (724f487) |
| --- | --- | --- | --- |
| 1 | Clean host: `init` then `up` reaches active with no manual edit; `init` writes `config.json` and `policy.json` templates; state dir 0700; refuses overwrite; digest as argument or from `release/`, never invented (ONB-01) | VERIFIED | `src/cli/init.ts`: wrong-mode state dir refused (l.204-208); `--image` must be `<name>@sha256:<64 hex>` (l.244-256, message l.253); no digest source other than the argument, which the criterion permits; templates `config.json` and `policy.json` (l.317-318); new directory created at 0700 (l.342) and `fchmod` 0700 on a no-follow fd (l.358); existing target refused, `linkSync` `EEXIST` refused (`publishNew`, ~l.392-421). Command surface: `README.md` l.94-96 (`init` then `up`). Live: `README.md` "Captured lifecycle transcript" (l.~124-150): `init`, `up`, `status`, `down` each exit 0, `"mode":"fail-closed"`, `state: active`, rootless Podman 5.7.1, Realm 0.3.29 at `1ddfc45`. Second live run: `README.md` l.160-170 (`localhost/realm-agentos@sha256:…` digest). |
| 2 | `doctor` fails with a named check and fix for an unset, relative or mode-wrong driver root, or an unreachable driver socket or gateway; a unit test per check. `doctor --fix` on 0755 sets 0700; second run and dry run change nothing; symlinked dir refused (ONB-02, ONB-04) | VERIFIED | `src/doctor/runtime-checks.ts`: root conditions `is unset` (l.145), `is not absolute` (l.148), `is absent` (l.152), `is a symbolic link` (l.158), `mode is 0NNN, expected 0700` (l.172), each with a fix string (fix table l.46-61). Driver socket `id = "driver-socket"` (l.211), parent-mode check. Gateway `id = "gateway"` (l.261-281): endpoint unset (l.269), CA unset (l.273), unreachable or chain mismatch (l.279). `src/doctor/fix.ts`: `PRIVATE_DIR_MODE = 0o700` (l.13), symlink refusal `FixRefusal(…, "symlink")` (l.163). Unit tests: `test/doctor/checks.test.ts` l.283-355 (runtime-roots per condition, one each for unset, relative, mode 0755); `test/doctor/runtime-root-checks.test.ts` l.214-269 (driver-socket pass/fail/code/absent-or-mode; gateway pass/fail); `test/doctor/fix.test.ts` l.68 (0755 to 0700), l.134 (second run no-op), l.148 and l.162 (dry run), l.177, l.191, l.228, l.265 (symlinked dirs refused), l.395 and l.447 (swapped-for-symlink). |
| 3 | Secret, workspace and state roots read from `config.json`, default under `stateDir`; `REALM_DRIVER_SECRET_ROOT`, `_WORKSPACE_ROOT`, `_STATE_ROOT` gone, other `REALM_DRIVER_*` unchanged; driver and daemon read the same source; sentinel env var does not reach the daemon from `startDetachedDaemon` or the CLI spawn (ONB-03, ONB-07) | VERIFIED | `src/runtime/config.ts`: `secretRoot` and `sandboxStateRoot` optional, relative value refused (l.17-20, l.107-111); `runtimeRootsOf` defaults them to `<stateDir>/secrets` and `<stateDir>/sandboxes` (l.139-146). Daemon: `src/daemon/main.ts` l.11, l.78 calls `runtimeRootsOf(loadRuntimeConfig(…))`; stale names ignored (l.50-51). Driver: `src/runtime/driver/main.ts` l.9, l.66 (stale names ignored), l.112 same call. Stale names are read by no code. Sentinel tests: `test/daemon/spawn-env.test.ts` l.89 (sentinel not reaching CLI spawn or `startDetachedDaemon`), l.196 (ONB-07, real daemon via `runCli up` sees no sentinel and no stale root). Config tests: `test/runtime/config.test.ts`, `test/daemon/main.test.ts`, `test/runtime/driver-lifecycle.test.ts`. Docs: `docs/policy-reference.md` l.318; `docs/integration/openshell.md` l.269, l.591; `docs/integration/omp-lifecycle-runbook.md` l.24. |
| 4 | Policy with no `mode` loads as fail-closed; schema default and loader agree; advisory needs the explicit value; policy reference, README, Omp notes, doctor output and `init` templates state fail-closed; no document calls advisory the default; tests relying on the old default state their mode or assert the new one (DEF-01, DEF-02) | VERIFIED | Schema: `src/core/policy.schema.json` l.8-12 (`enum ["advisory","fail-closed"]`, `"default": "fail-closed"`). Loader: `src/contract/validate.ts` l.165 `useDefaults: true`, so the schema default is applied. `src/core/policy.ts` l.42-56 records `modeSource` (`explicit`/`default`/`no-file`); the advisory-only path is gated on `policy.mode === "advisory"` (l.157-162). Doctor: `src/doctor/checks.ts` l.218 and l.257 say fail-closed is the default; l.246-250 warn only on explicit advisory. `init` templates: `src/cli/init.ts` l.3 header and l.69 summary `mode: "fail-closed"`, and the template writes `"mode": "fail-closed"` explicitly. Reference: `docs/policy-reference.md` l.38-46 (Default fail-closed, D4), l.82 (prior default recorded as history), l.318. README: l.15 and l.17 (default fail-closed; upgrade note). `AGENTS.md` l.169 (never call advisory the default). `site/content/index.md` l.21. Omp notes: `docs/hosts/snippets/omp.md` l.162 and l.170 (`applied mode: fail-closed`). Tests: `test/doctor/checks.test.ts` l.92 (no mode says fail-closed is the default), l.101, l.110 (explicit advisory warns). Doc-wide search (grep over README, AGENTS, docs excluding `docs/specs`, site index for "advisory" near "default"): every hit is either the fail-closed default, an upgrade note, a history line, or an explicit-opt-in description. Enforcement exists in `scripts/check/default-mode.mjs` (not run here). |
| 5 | `omp plugin install` run live under an isolated profile and recorded in `docs/hosts/snippets/omp.md`; README carries install steps and a quickstart transcript of `init`, `up`, `status`, `down` on a real Podman 5.x host (ONB-05, ONB-06) | VERIFIED | `docs/hosts/snippets/omp.md` "Current install record (ONB-05)" l.75-~110: dated 2026-11-13, checkout at origin/main `1ddfc45`, isolated `HOME`, `PI_CODING_AGENT_DIR` and `XDG_CONFIG_HOME` (l.79-81), dry-run (l.87) and real install (l.94). Daemon-up status frame: l.152-170 (`realm active`, `applied mode: fail-closed`). Install steps: `README.md` l.232-233. Quickstart transcript: `README.md` "Captured lifecycle transcript" (l.~124-150), Podman 5.7.1. |

Criterion 5's install is the owner-accepted record at `1ddfc45` (residual 2).

### Criterion 4: default-mode statements in `docs/specs/realm-spec.xml`

Every spec line containing "advisory" (26 lines) and every "default" line that concerns mode or policy was classified:

| Line | Content (abridged) | Class | Result |
| --- | --- | --- | --- |
| 83 | per-file advisory write locks | lock reference | OK |
| 132 | "Default to fail-closed when the user has enabled realm required mode. Default to visible warning in advisory mode." | first clause is fail-closed; second describes explicit advisory behaviour, not the policy default (see residual 4) | OK |
| 168 | advisory lock conflict | lock reference | OK |
| 189 | "Default mode is fail-closed (owner decision D4, 2026-10-29), with advisory available only as an explicit opt-in." | D4 statement | OK |
| 200 | "The default policy when realm is disconnected is fail-closed (owner decision D4 ...). Advisory requires an explicit value." | D4 statement | OK |
| 225, 230, 233, 242 | advisory locks in module and deferral lists | lock reference | OK |
| 227 | "Tentative defaults: fail-closed as the default policy mode (superseded: owner decision D4, 2026-10-29, advisory is opt-in)" | annotated as superseded | OK |
| 253 | open question on whether the default is fail-closed or advisory | question, resolved at l.256 and l.267 | OK (not a statement) |
| 256 | "Flag the policy default as a spec contradiction ... Resolved by owner decision D4 ...: fail-closed is the default." | annotated, resolved in the same sentence | OK |
| 267 | "Default policy mode: resolved by owner decision D4 ... fail-closed; advisory is an explicit opt-in." | D4 statement | OK |
| 279, 307, 311, 358, 434, 447 | advisory lock table, locks, granularity | lock reference | OK |
| 282, 291 | "in advisory mode it returns the write with a visible warning" | explicit advisory behaviour | OK |
| 295 | "Should required mode also gate reads? Default: gate writes only." | required-mode design default; not a mode-default statement | OK |
| 315 | question listing fail-closed or advisory as schema options | question | OK (not a statement) |
| 328 | "mode advisory(default; superseded by owner decision D4 ...)" | annotated as superseded | OK |
| 365 | "Default policy mode? Default: fail-closed (owner decision D4 ...); advisory is an explicit opt-in." | D4 statement | OK |
| 376 | "fail-closed is the default (owner decision D4, 2026-10-29)" | D4 statement | OK |
| 480 | question, "Resolved by owner decision D4 ...: fail-closed is the default" | annotated | OK |
| 483 | option, "Advisory with warning (superseded by owner decision D4 ...: no longer the recommendation; fail-closed is the default)" | annotated as superseded | OK |

**Unannotated default statements remaining: none.**

## Required Artifacts

| Artifact | Status | Detail |
| --- | --- | --- |
| `src/cli/init.ts` | VERIFIED | Criteria 1 and 4 |
| `src/doctor/runtime-checks.ts`, `src/doctor/fix.ts`, `src/doctor/checks.ts` | VERIFIED | Criteria 2 and 4 |
| `src/runtime/config.ts`, `src/daemon/main.ts`, `src/runtime/driver/main.ts` | VERIFIED | Criterion 3 |
| `src/core/policy.ts`, `src/core/policy.schema.json`, `src/contract/validate.ts` | VERIFIED | Criterion 4 |
| `README.md` | VERIFIED | Criteria 1, 4, 5 |
| `docs/policy-reference.md` | VERIFIED | Criterion 4 |
| `docs/hosts/snippets/omp.md` | VERIFIED | Criteria 4 and 5 |
| `docs/specs/realm-spec.xml` | VERIFIED | Criterion 4: no unannotated default statement |

## Residuals (not verdict-blocking)

1. **Policy hash change, 15-15 (owner-accepted gap).** The restored policy hash `e66c7871…` appears on main only in `.planning/phases/15-zero-config-onboarding-and-fail-closed-default/15-VERIFICATION.md` l.146 ("policy e66c7871…"). The pre-change hash `e46ee5` appears nowhere on main, in the working tree, or in `git log --all -S e46ee5`. The change is therefore not reconstructible from the repo. Owner-accepted; the verdict is unchanged.
2. **Live evidence predates three commits on main.** The `init`/`up`/`status`/`down` transcript and the ONB-05 `omp plugin install` record were captured at `1ddfc45`. Since then main has changed `src/session/checkpoint.ts` (ef9f68a, PR 73) and `package.json` `@rivet-dev/agentos-core` 0.4.4 to 0.4.7 (4b73f77). None touches a Phase 15 criterion file. The agentos-core bump could affect the live AgentOS `up` path; no live re-run was performed here. The previous template's claim that the diff since `1ddfc45` is empty no longer holds.
3. **Gates not run.** Per the assignment, no tests, lint, typecheck, build, formatter, `check:docs` or `scripts/check/default-mode.mjs` was run. Test references above were read, not executed. The advisory-default scan was done by hand with grep.
4. **Spec line 132.** "Default to visible warning in advisory mode" describes explicit advisory behaviour. It does not name advisory as the policy default, so it is classed OK, not annotated.
5. **Criterion 1 digest source.** The implementation takes the digest only from `--image` (`src/cli/init.ts` l.244-256). Criterion 1 allows "as an argument or from `release/`", so this satisfies it. No `release/` lookup exists.

## Verdict

verdict: passed

All five criteria have evidence on `origin/main` 724f487, and no unannotated default-mode statement remains in `docs/specs/realm-spec.xml`. Residuals 1 and 2 are recorded; neither changes the verdict.

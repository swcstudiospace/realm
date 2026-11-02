# Phase 15 verification: zero-config onboarding and fail-closed default

Date: 2026-11-02. Tree: `gsd/v3-autonomous` at `612a6d4`. Implementation commits: `84f335b`, `4037f84`, `db2f966`, `01f72f3`, `b6eaf27`. Source of acceptance: `15-CONTEXT.md`, section Acceptance, items 1 to 5, and the requirement lists of plans `15-01` to `15-16`.

**Status: human_needed.** The automated evidence passes for the requirements below. The live acceptance steps were not run and are not approved. No requirement is marked passed here. No requirement is checked in REQUIREMENTS.md; the parent owns that file.

## Automated evidence
The command results were reported by the parent for this tree. This closeout did not rerun them, per the rule against build and test runs.

| Command | Result |
|---|---|
| `npm test` (full suite, one-CPU quota) | 2458 tests, 2426 pass, 0 fail, 32 skipped |
| `npm run typecheck` | exit 0 |
| `npm run lint` | exit 0 |
| `npm run test:scripts` | exit 0 |
| `npm run check:docs` (host-paths, agents-sync, default-mode) | exit 0 |
| `npm run check:gates` | exit 0 |
| `npm run build` | exit 0 |
| `npm run check:pack` | exit 0 |
| `npm run check:mcp` | exit 0 |

Read-only checks made for this closeout:
- All five commits are ancestors of `612a6d4`, and their subjects match the commit table in `15-SUMMARY.md`.
- `src/core/policy.schema.json` sets the `mode` default to `"fail-closed"`, with `enum` `["advisory", "fail-closed"]`.
- `REALM_DRIVER_SECRET_ROOT`, `REALM_DRIVER_WORKSPACE_ROOT` and `REALM_DRIVER_STATE_ROOT` appear in `src` only in comments (`src/runtime/driver/main.ts`, `src/daemon/main.ts`).
- `package.json` wires `scripts/check/default-mode.mjs` into `check:docs`.
- `src/doctor/checks.ts` names the `runtime-roots`, `driver-socket` and `gateway` ids, and its `policy-file` check warns for an explicit `advisory` with the text "this is not containment".
- Test files present and named in the requirement rows below were read for their test names. Their assertions were not rerun.

## Requirement status

| Requirement | Status | Automated evidence | Live evidence pending |
|---|---|---|---|
| DEF-01 | implemented with automated evidence | Schema default and loader provenance (`loadPolicyFileDetailed`); policy and schema tests (`test/core/policy.test.ts`, `test/core/policy.schema.test.ts`); doctor policy-file check (`test/doctor/checks.test.ts`) | L-A scenario 1 (live suite asserts `mode` `fail-closed` for a policy with no mode key). Not run. |
| DEF-02 | implemented with automated evidence | `scripts/check/default-mode.mjs` and `scripts/check/default-mode.test.mjs`, run by `check:docs` (exit 0); docs cutover in README, AGENTS.md, policy reference, integration docs and site index; `security!:` subject on 84f335b | None. |
| ONB-03 | implemented with live evidence pending | `secretRoot` and `sandboxStateRoot` in `RuntimeConfig` with derived defaults; driver and daemon read the same config; the three `REALM_DRIVER_*_ROOT` variables are ignored (`test/runtime/config.test.ts`, `test/runtime/driver/driver-main.test.ts`) | L-A (roots from `REALM_LIVE_DRIVER_CONFIG`) and L-B (driver started from an edited unit with none of the three variables). Neither run. |
| ONB-04 | implemented with automated evidence | Three checks `runtime-roots`, `driver-socket` and `gateway` in `src/doctor/runtime-checks.ts`; unit tests per check in `test/doctor/runtime-root-checks.test.ts`, which includes a missing config as a one-item report whose fix names `realm init` | L-B doctor run on the live host. Not run. |
| ONB-07 | implemented with automated evidence | `src/daemon/spawn-env.ts` allowlist (`daemonSpawnEnv`) used by the CLI spawn and `startDetachedDaemon`; `test/daemon/spawn-env.test.ts` shows a sentinel and a stale root do not reach the daemon on either path (real child process) | L-A `realm up` through the CLI spawn. Not run. |
| ONB-01 | implemented with live evidence pending | `realm init` preflight, no-clobber publish, 0600 templates, 0700 state directory; `test/cli/init.test.ts` (refusals, symlink cases, digest argument, no partial writes) | L-C: `init` then `up` reaches active on a clean Podman 5.x host with no manual edit. Not run. |
| ONB-02 | implemented with automated evidence | `realm doctor --fix [--dry-run]` in `src/doctor/fix.ts`; `test/doctor/fix.test.ts` (0755 to 0700 with named action, idempotent second run, dry run writes nothing, symlink and unsafe-target refusals, home, workspace and filesystem root refused) | L-C doctor `--fix` run on the live host. Not run. |
| ONB-05 | implemented with live evidence pending | README install steps and the isolated local-link section in `docs/hosts/snippets/omp.md` (b6eaf27). Historical receipt from 2026-10-30 (Omp 18.12.6, package 0.3.24) retained and labelled historical. | L-D: `omp plugin install` under an isolated profile, `list`, and an rpc-ui session on the current build. Not run. |
| ONB-06 | implemented with live evidence pending | README quickstart with a transcript of `init`, `up`, `status`, `down`. The transcript is the 2026-10-31 capture on Realm 0.3.26 and Podman 5.7.1. | Fresh capture on the current build (plan 15-16, Q1, L-C2). Not run. The existing transcript predates b6eaf27. |

## Acceptance items (`15-CONTEXT.md`)
1. Policy default and docs (DEF-01, DEF-02): automated evidence complete. Live scenario 1 pending. **human_needed.**
2. `init`, `doctor --fix`, doctor checks (ONB-01, ONB-02, ONB-04): automated evidence complete. L-C and L-B pending. **human_needed.**
3. Roots in `config.json`, allowlisted environment (ONB-03, ONB-07): automated evidence complete. L-A and L-B pending. **human_needed.**
4. Fail-closed loader, schema and docs (DEF-01, DEF-02): automated evidence complete. **Automated part passes.** Phase status remains human_needed through items 2, 3 and 5.
5. `omp plugin install` live and quickstart transcript on a Podman 5.x host (ONB-05, ONB-06): **not run.** Human-needed.

## Live steps (not run; human-needed)

| Step | Purpose | Status | Approval |
|---|---|---|---|
| L-A | Production live suite on the realm stack, roots from `REALM_LIVE_DRIVER_CONFIG` | not run | not approved |
| L-B | Driver unit edited per P15-O4 (three roots dropped, config home added), driver restarted, unit restored, doctor runtime items checked | not run | not approved |
| L-C, L-C2 | `realm init`, `up`, `status`, `down` on a clean Podman 5.x host; `doctor --fix` | not run | not approved |
| L-D | `omp plugin install` under an isolated profile; `list`; rpc-ui session | not run | not approved |
| PR D | README transcript captured on the current build | not run | not approved |
| Scenario 5 | Production live scenario 5, a Phase 14 step (CRASH-04), not a Phase 15 step | run once on 2026-11-02, PASS (1 of 1); recorded in 14-VERIFICATION.md | approved by owner; run under the live lock; not counted as Phase 15 evidence |

Every live step above, L-A to L-D and PR D, needs the live lock and a new owner approval before it runs. Scenario 5 is a Phase 14 step and already ran on 2026-11-02; it does not count toward these.

## Gaps and limits
- `check:docs` guards advisory-default phrases only. Containment wording (the fail-closed default is not containment of Omp's built-in tools) is not guarded by a script and was not separately re-checked here. Phase 16 owns the containment question (D3).
- REQUIREMENTS.md still shows ONB-01, ONB-02 and ONB-03 as checked, from recovery notes dated 2026-10-31 that cite live runs. This record does not re-observe those runs and does not endorse those checkboxes. The parent should reconcile them against this record.
- Commit `b6eaf27` has no PR number in its subject.
- The suite has ten production live scenarios at HEAD, not nine.

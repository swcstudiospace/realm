# Phase 15 context: zero-config onboarding and fail-closed default

Status: planning (2026-10-29). Milestone v3.0, Omp lane, second phase (after Phase 12). Requirements ONB-01 to ONB-07 and DEF-01 to DEF-02 (`.planning/REQUIREMENTS.md`). Scope source: proposals 2 and 3 of `.planning/quick/261029-g7m-lifecycle-and-persistence-findings/IMPROVEMENT-PROPOSALS.md`. The code facts are cited from `15-RESEARCH.md` (a read-only pass with file and line evidence); implementation agents read the sections their unit names.

## Owner decisions that bind this phase
- **D4 (2026-10-29):** the default policy `mode` becomes `fail-closed` in this phase; `realm init` templates write the mode explicitly; advisory stays available as the explicit opt-in. D3 (a fail-closed Omp mode may remove or block the built-in write, edit and bash by a mechanism the spike proves) is Phase 16's work: Phase 15 depends on neither `registerTool` nor `setActiveTools`, and its wording must not present the default as containment while the built-ins still write to the host with the realm active.
- **D1 (all proposals) and the rules of `AGENTS.md`** apply. No catalogue, tool-schema or session-record change.

## Decisions the orchestrator took on the owner's behalf (the research's recommended defaults; D1 authorizes the phase; listed so the owner can overrule them)
- **P15-O1:** `realm init --image <name@sha256:...>` takes the image as a required argument. `release/` carries no image digest and no image is published, so there is nothing to look up; a published image (Phase 20) can add a lookup later. The README shows how to read the local digest.
- **P15-O2:** "clean host" means a host on which the gateway, the compute driver, the supervisor and the image are provisioned (as on the realm account) but Realm has no `config.json` or `policy.json`. Provisioning those parts stays outside this repository (TD-02) and is stated in the README prerequisites.
- **P15-O3:** `realm doctor` keeps exit code 0 whatever the check statuses (it is pinned by a test and documented); `realm doctor --fix` exits 1 when it refuses something.
- **P15-O4:** the live proof of ONB-03 installs the new build into the realm account's `app` directory, edits that account's driver unit (drops the three `REALM_DRIVER_*_ROOT` variables, adds the config home), restarts the driver (the startup reap is account-wide and removes every realm container) and restores the saved unit afterwards, once, under the live lock.

## Locked decisions
- **D-1501 default mode (DEF-01):** the only decision point is the schema default (`src/core/policy.schema.json`); it becomes `"fail-closed"`. `loadPolicyFileDetailed` returns the policy and the mode's provenance (`explicit`, `default`, `no-file`); `loadPolicyFile` is its `.policy`. The doctor's `policy-file` check states the mode and where it came from and warns for an explicit `advisory` ("this is not containment"). The local doctor reads `<stateDir>/policy.json` (today it never loads a policy). There is no migration code: a missing `mode` key is valid input.
- **D-1502 telling existing users (DEF-02):** the pull request subject carries the breaking marker (`security!:`), the doctor detail names the mode, `realm status` and `up` already print it, and `docs/policy-reference.md` and the README gain an "Upgrading" paragraph.
- **D-1503 docs guard:** `scripts/check/default-mode.mjs`, wired into `npm run check:docs`, fails on phrases that assert advisory is the default in `README.md`, `AGENTS.md`, `CONTRIBUTING.md`, `SECURITY.md`, `docs/**` (except `docs/specs/`) and `site/content/index.md`; `CHANGELOG.md`, `.planning/` and the spec are excluded.
- **D-1504 roots in `config.json` (ONB-03):** `RuntimeConfig` gains optional `secretRoot` and `sandboxStateRoot`; `runtimeRootsOf(config)` derives `<stateDir>/secrets` and `<stateDir>/sandboxes` when they are absent (equal to the installed driver's environment values on the realm host). The daemon and the driver read the same file; the three `REALM_DRIVER_*_ROOT` variables are no longer read (a stale one in a unit is ignored). The live suite gates on one variable, `REALM_LIVE_DRIVER_CONFIG`.
- **D-1505 daemon environment (ONB-07):** `src/daemon/spawn-env.ts` holds an allowlist (`PATH`, `HOME`, `XDG_RUNTIME_DIR`, `XDG_CONFIG_HOME`, `REALM_DRIVER_SOCKET`, the supervisor and `REALM_HOST_PIN_*` names) used by both start paths (the CLI and the Omp extension). Real-process sentinel tests prove a secret-shaped variable does not reach the daemon on either path.
- **D-1506 doctor (ONB-04):** three new checks (`runtime-roots`, `driver-socket`, `gateway`) in `src/doctor/runtime-checks.ts`; the report becomes 14 items; a failing config runs a one-item report that names `realm init`.
- **D-1507 init and fix (ONB-01, ONB-02):** `realm init` preflights everything before it writes, never overwrites (no-clobber publish with `linkSync`), writes `policy.json` then `config.json`, and sets 0700 and 0600 modes; `realm doctor --fix [--dry-run]` always runs locally, uses `lstat` and a no-follow `fchmod`, refuses symlinks, foreign owners and unsafe targets, and touches only the listed directories.
- **D-1508 pull requests:** A (default flip, docs guard and docs), B (roots, allowlist, doctor checks, live suite gate), C (`init` and `doctor --fix`), D (README quickstart and install evidence). B and C follow A.

## Frozen contracts touched
The policy schema default (the one approved public change, D4), the runtime config key set (two optional keys), the driver's environment (three variables removed), the doctor report (three items). Not touched: the error catalogue, the tool schema, the session record, the control protocol.

## Acceptance (the ROADMAP success criteria)
1. A policy with no `mode` loads as fail-closed; the schema default and the loader agree; advisory requires the explicit value; docs, README, Omp notes, doctor output and templates say so, and a check script prevents the old claim (DEF-01, DEF-02).
2. `realm init` and `realm doctor --fix` behave as D-1507; the daemon starts with the allowlisted environment on both start paths; the roots live in `config.json`; the doctor checks the roots, the driver socket and the gateway (ONB-01 to ONB-04, ONB-07).
3. `omp plugin install` is verified live under an isolated profile and the README carries a quickstart with a real transcript (ONB-05, ONB-06).

## Risks and stop conditions
See the risk table of `15-RESEARCH.md`. Stop and report if: a driver of the new build cannot be started on the edited unit; the live suite fails at the default flip for a reason other than a test fixture relying on the old default; the allowlist breaks the doctor's pins.

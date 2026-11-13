---
phase: 15-zero-config-onboarding-and-fail-closed-default
verified: 2026-11-13T19:13:49Z
status: human_needed
score: 5/5 roadmap success criteria verified; 2 human items open
behavior_unverified: 0
overrides_applied: 0
covered_files:
  - .planning/REQUIREMENTS.md
  - .planning/ROADMAP.md
  - .planning/phases/15-zero-config-onboarding-and-fail-closed-default/15-01-PLAN.md
  - .planning/phases/15-zero-config-onboarding-and-fail-closed-default/15-01-SUMMARY.md
  - .planning/phases/15-zero-config-onboarding-and-fail-closed-default/15-02-PLAN.md
  - .planning/phases/15-zero-config-onboarding-and-fail-closed-default/15-02-SUMMARY.md
  - .planning/phases/15-zero-config-onboarding-and-fail-closed-default/15-03-PLAN.md
  - .planning/phases/15-zero-config-onboarding-and-fail-closed-default/15-03-SUMMARY.md
  - .planning/phases/15-zero-config-onboarding-and-fail-closed-default/15-04-PLAN.md
  - .planning/phases/15-zero-config-onboarding-and-fail-closed-default/15-04-SUMMARY.md
  - .planning/phases/15-zero-config-onboarding-and-fail-closed-default/15-05-PLAN.md
  - .planning/phases/15-zero-config-onboarding-and-fail-closed-default/15-05-SUMMARY.md
  - .planning/phases/15-zero-config-onboarding-and-fail-closed-default/15-06-PLAN.md
  - .planning/phases/15-zero-config-onboarding-and-fail-closed-default/15-06-SUMMARY.md
  - .planning/phases/15-zero-config-onboarding-and-fail-closed-default/15-07-PLAN.md
  - .planning/phases/15-zero-config-onboarding-and-fail-closed-default/15-07-SUMMARY.md
  - .planning/phases/15-zero-config-onboarding-and-fail-closed-default/15-08-PLAN.md
  - .planning/phases/15-zero-config-onboarding-and-fail-closed-default/15-08-SUMMARY.md
  - .planning/phases/15-zero-config-onboarding-and-fail-closed-default/15-09-PLAN.md
  - .planning/phases/15-zero-config-onboarding-and-fail-closed-default/15-09-SUMMARY.md
  - .planning/phases/15-zero-config-onboarding-and-fail-closed-default/15-10-PLAN.md
  - .planning/phases/15-zero-config-onboarding-and-fail-closed-default/15-11-PLAN.md
  - .planning/phases/15-zero-config-onboarding-and-fail-closed-default/15-12-PLAN.md
  - .planning/phases/15-zero-config-onboarding-and-fail-closed-default/15-13-PLAN.md
  - .planning/phases/15-zero-config-onboarding-and-fail-closed-default/15-14-PLAN.md
  - .planning/phases/15-zero-config-onboarding-and-fail-closed-default/15-15-PLAN.md
  - .planning/phases/15-zero-config-onboarding-and-fail-closed-default/15-16-PLAN.md
  - .planning/phases/15-zero-config-onboarding-and-fail-closed-default/15-CONTEXT.md
  - .planning/phases/15-zero-config-onboarding-and-fail-closed-default/15-SUMMARY.md
  - AGENTS.md
  - README.md
  - docs/hosts/snippets/omp.md
  - docs/integration/host-binaries.md
  - docs/integration/hosts.md
  - docs/integration/omp.md
  - docs/integration/openshell.md
  - docs/policy-reference.md
  - docs/specs/realm-spec.xml
  - package.json
  - scripts/check/default-mode.mjs
  - scripts/check/default-mode.test.mjs
  - src/cli/init.ts
  - src/cli/main.ts
  - src/contract/validate.ts
  - src/core/policy.schema.json
  - src/core/policy.ts
  - src/daemon/main.ts
  - src/daemon/spawn-env.ts
  - src/doctor/checks.ts
  - src/doctor/fix.ts
  - src/doctor/runtime-checks.ts
  - src/omp/extension.ts
  - src/runtime/config.ts
  - src/runtime/driver/main.ts
  - src/runtime/openshell.ts
  - test/cli/cli.test.ts
  - test/cli/init.test.ts
  - test/core/policy.schema.test.ts
  - test/core/policy.test.ts
  - test/daemon/main.test.ts
  - test/daemon/spawn-env.test.ts
  - test/doctor/checks.test.ts
  - test/doctor/dial-defaults.test.ts
  - test/doctor/fix.test.ts
  - test/doctor/runtime-root-checks.test.ts
  - test/integration/production-driver.test.ts
  - test/integration/production-live-helpers.test.ts
  - test/runtime/config.test.ts
  - test/runtime/driver/driver-main.test.ts
  - test/support/production-live.ts
covered_digest: "v3:sha256:7e5ce8854fb8353c6fc1352c27b5ef23a31fa31b57732747ee2103b59b29174b"
re_verification:
  previous_status: human_needed
  previous_score: "5/5 roadmap success criteria verified on evidence; 4 human items open"
  gaps_closed:
    - "Daemon-up rpc-ui status frame (L-D2) recorded in docs/hosts/snippets/omp.md, section 'Daemon-up status frame (L-D2, 2026-11-13)', backed by host evidence 15-16-L-D2-evidence (previous human item 2)"
    - "The default-mode open question is resolved to fail-closed (owner decision D4) at docs/specs/realm-spec.xml ASSUMPTIONS (l.189), AMBIGUITIES (l.200) and the open-question list (l.267), merged in PR 70 (partly closes previous human item 1; see gaps_remaining)"
    - "status and down run outside the pinned workspace are documented as POLICY_DENIED in README.md (l.117-119), PR 69, with --workspace evidence in 15-16-workspace-flag-evidence (previous human item 3)"
  gaps_remaining:
    - "docs/specs/realm-spec.xml still describes advisory as the default in pre-D4 text at l.227 ('Tentative defaults: advisory mode by default'), l.256 (rationale: 'ASSUMPTIONS and POLICY_MODE say advisory by default'), l.365 ('Default: advisory with visible warning') and l.376 ('advisory is default'). The default-mode guard excludes docs/specs/ by design, so this does not fail the guard"
    - "Hermetic test suite not re-run on origin/main 7b15741 in this pass (previous human item 4)"
  regressions: []
human_verification:
  - test: "Decide the scope of the pre-D4 default-mode text in docs/specs/realm-spec.xml at l.227, l.256, l.365 and l.376. Either annotate each as superseded by owner decision D4 (an owner-directed edit, which AGENTS.md now permits when the owner asks and the PR records the instruction and reason), or record that the spec is a historical planning record outside DEF-02."
    expected: "Either those four lines are annotated as superseded by D4, or the owner records that they stay as historical text and that DEF-02 is closed for published documents only."
    why_human: "Whether the authoritative spec's historical planning nodes count toward DEF-02's 'search of the documents' is a scope decision. This verifier does not edit docs or the spec."
  - test: "Run the main agent's gates on origin/main 7b15741: the hermetic test suite, and check:docs. check:docs is needed because AGENTS.md and docs/specs/realm-spec.xml changed after the last recorded green run."
    expected: "The hermetic suite passes with 0 failures (last recorded: 3025 pass, 0 fail, 39 skipped, at bff6e4f, before PR 70). check:docs passes, including the default-mode guard that scans AGENTS.md."
    why_human: "Test and check execution was excluded from this pass; it is the main agent's gate."
---

# Phase 15: Zero-config onboarding and fail-closed default — Verification Report

**Phase Goal:** A new user on a Podman 5.x host reaches an active sandbox with `realm init` and `realm up` and no manual edit, and a policy that says nothing about its mode contains the agent.
**Verified:** 2026-11-13T19:13:49Z
**Status:** human_needed
**Re-verification:** Yes. Prior report status human_needed, after PR 69, PR 70 and the L-D2 evidence.

**Scope and method.** Branch `gsd/phase-15-verify-2`, created from `origin/main` 7b15741 (PR 70 merged). Per the assignment, no tests, lint, typecheck, build, formatters or `check:docs` were run, and no source, test, documentation, workflow, REQUIREMENTS, ROADMAP or STATE file was edited. Live results are cited from recorded host evidence by file name; their contents are not copied here. Evidence build `1ddfc45` is an ancestor of `origin/main`. Since then, the only changes are in `docs/`, `README.md`, `AGENTS.md` and `.planning/`. Nothing under `src/`, `test/`, `scripts/` or `package.json` changed, so the live evidence describes the current code.

## Goal Achievement

### Observable Truths

| # | Truth (roadmap success criterion) | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Clean host: `realm init` then `realm up` reaches active with no manual edit; init writes templates, state dir 0700, refuses overwrite, digest by argument or from `release/`, never invented (ONB-01) | ✓ VERIFIED | `src/cli/init.ts`: a mode-wrong state directory is refused (l.205); the directory is created with mode 0700 and fixed with `fchmod` 0700 (l.342, l.358); `--image` must be digest-pinned, `<name>@sha256:<64 hex>` (l.246–253); an existing target is refused via `linkSync` with `EEXIST` (l.392–414). Live: 15-16-transcript-evidence (Podman 5.7.1; init exit 0, up active, status active, down unbound, container count 0 before and after) and 15-15-LC-transcript (attempt 2: init 0, up active). Not re-run here. |
| 2 | `realm doctor` fails with a named check and a fix for an unset, relative or mode-wrong driver root, or an unreachable socket or gateway, and a unit test covers each check. `doctor --fix` on mode 0755 sets 0700; a second run changes nothing; dry-run changes nothing; a symlinked directory is refused (ONB-02, ONB-04) | ✓ VERIFIED | `src/doctor/runtime-checks.ts` registers `runtime-roots`, `driver-socket` and `gateway`, with failures for "is unset" (l.145), "is not absolute" (l.148), "mode is 0NNN, expected 0700" (l.172), driver-socket parent mode (l.236), and gateway endpoint or CA unset (l.269, l.273). Each carries a fix string. `src/doctor/fix.ts`: `PRIVATE_DIR_MODE = 0o700` (l.13); `FixRefusal(..., "symlink")` on symbolic links (l.163); dry-run action list (l.79, l.83). Unit tests present: `test/doctor/runtime-root-checks.test.ts`, `test/doctor/fix.test.ts`, `test/doctor/checks.test.ts`, `test/doctor/dial-defaults.test.ts`. Live scratch run (15-15-LC-transcript): dry-run lists the fixes and leaves mode 755; the real run sets 700; the repeat returns `fixes: []`. The idempotence transition is evidenced by that live transcript; the in-repo tests were not run in this pass (see Behavioral Spot-Checks). |
| 3 | Secret, workspace and state roots read from `config.json`, defaulting under `stateDir`. `REALM_DRIVER_SECRET_ROOT`, `_WORKSPACE_ROOT` and `_STATE_ROOT` are gone; other `REALM_DRIVER_*` variables are unchanged. The driver and daemon read the same source. A sentinel environment variable does not reach the daemon (ONB-03, ONB-07) | ✓ VERIFIED (sentinel test present, not re-run) | `src/runtime/config.ts` `runtimeRootsOf` (l.142–146) defaults `secretRoot` to `<stateDir>/secrets` and `sandboxStateRoot` to `<stateDir>/sandboxes`; relative values are `SCHEMA_INVALID` (l.17, l.19). The three stale variables are read by no code path. They appear only as ignored in `src/daemon/main.ts` (l.50–51) and `src/runtime/driver/main.ts` (l.66), and in tests that assert they are ignored (`test/daemon/main.test.ts` l.547–569; `test/runtime/driver/driver-main.test.ts` l.77–79, l.229). The other driver variables remain (`src/runtime/driver/main.ts` l.33–40; `src/daemon/main.ts` l.57). Sentinel: `test/daemon/spawn-env.test.ts`, with the allowlist in `src/daemon/spawn-env.ts` (l.14–18) and the stale names excluded at spec l.29–31. Not re-run. |
| 4 | A policy file with no `mode` loads as fail-closed. The schema default and the loader agree, and advisory needs the explicit value. The policy reference, README, Omp notes, doctor output and `init` templates state fail-closed. A search of the documents finds no document that calls advisory the default. Every test that relied on the old default states its mode or asserts the new one (DEF-01, DEF-02) | ✓ VERIFIED (with human item 1: spec residual) | `src/core/policy.schema.json` `mode` enum `[advisory, fail-closed]`, default `"fail-closed"` (l.8–12). `src/core/policy.ts` validated defaults are fail-closed (l.34); the advisory-only warning path requires `policy.mode === "advisory"` (l.157–160). `docs/policy-reference.md` l.45: "`fail-closed` is the default; `advisory` is the explicit opt-in". `README.md` l.15 and l.17 (default and upgrade note); l.209 (advisory only when explicit). `AGENTS.md` l.169 states the default. The published-document guard `scripts/check/default-mode.mjs` scans README, AGENTS, CONTRIBUTING, SECURITY, `site/content/index.md` and `docs/` except `docs/specs/`. It was not run in this pass. A static search of those files for advisory-as-default phrasings found only explicit opt-in or historical change statements (`docs/integration/hardening-plan.md` l.19). Residual, outside the guard's scope: `docs/specs/realm-spec.xml` (see Requirements Coverage and human item 1). |
| 5 | `omp plugin install` run live under an isolated profile and recorded in `docs/hosts/snippets/omp.md`. `README.md` carries the install steps and a quickstart transcript of `init`, `up`, `status` and `down` captured on a real Podman 5.x host (ONB-05, ONB-06) | ✓ VERIFIED (version deviation recorded) | `docs/hosts/snippets/omp.md`: dated 2026-11-13 record of `omp plugin install --dry-run` and `omp plugin install` (l.55–57, l.87–94); setStatus frames with disconnected and REALM_NOT_ACTIVE (l.131–132); the daemon-up section "Daemon-up status frame (L-D2, 2026-11-13)" (l.152 onward) records the `● realm active · container running · applied mode: fail-closed` frame. The recorded version is omp 18.20.0; the plan expected 18.12.6, and the record states the actual value. `README.md`: install commands (l.90–94); status and down outside-workspace behaviour (l.117–119); captured lifecycle transcript on rootless Podman 5.7.1 with `<digest>` substituted (l.101, l.122–138). Host evidence present by name: 15-16-L-D-evidence, 15-16-L-D2-evidence, 15-16-transcript-evidence, 15-16-workspace-flag-evidence. |

**Score:** 5/5 roadmap success criteria verified (criterion 4 carries human item 1). Behaviour-unverified truths: 0.

### Deferred Items

None.

### Advisory (New Scope, Unevidenced)

None.

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| `src/cli/init.ts` | Templates, 0700, refuse overwrite, digest validation | ✓ VERIFIED | Refusal paths and digest check present in code; exercised live (L-C2, L-C attempt 2) |
| `src/doctor/fix.ts` | Descriptor-based fixes, 0700, symlink refusal, dry-run | ✓ VERIFIED | Present in code; exercised in the L-C scratch run (dry-run, fix, repeat) |
| `src/doctor/runtime-checks.ts` | Named runtime-root, driver-socket and gateway checks with fixes | ✓ VERIFIED | Check ids and failure details at l.13, l.145–172, l.236, l.269–273 |
| `src/runtime/config.ts` | `runtimeRootsOf` with stateDir defaults | ✓ VERIFIED | Derives secrets and sandboxes roots when omitted (l.142–146) |
| `src/daemon/main.ts`, `src/runtime/driver/main.ts` | Read the same config; ignore stale root variables | ✓ VERIFIED | Lines cited in Truth 3 |
| `src/core/policy.schema.json`, `src/core/policy.ts` | `mode` default fail-closed, loader agrees | ✓ VERIFIED | Schema default l.11; loader default l.34; advisory warning only when explicit l.157 |
| `scripts/check/default-mode.mjs` | DEF-02 guard for published documents | ✓ VERIFIED (presence; not run) | Scope excludes `docs/specs/` by design |
| `docs/hosts/snippets/omp.md` | Dated install record and daemon-up frame | ✓ VERIFIED | Records omp 18.20.0, install, list, doctor, disconnected and active frames |
| `README.md` | Install steps, init/up/status/down transcript, workspace note | ✓ VERIFIED | Transcript on Podman 5.7.1 with `<digest>` substituted; POLICY_DENIED note at l.117–119 |
| `docs/specs/realm-spec.xml` | Default-mode consistent with decision D4 | ⚠️ PARTIAL | Open questions at l.189, l.200, l.267 updated (PR 70). Pre-D4 text remains at l.227, l.256, l.365, l.376 (human item 1) |

### Key Link Verification

| From | To | Via | Status | Details |
| ---- | -- | --- | ------ | ------- |
| `realm init` | `config.json` and `policy.json` | writes templates into a 0700 directory, `linkSync` for no-overwrite | ✓ WIRED | Live L-C2 and L-C attempt 2 |
| `config.json` | daemon and driver roots | `runtimeRootsOf`; `src/daemon/main.ts` l.50 states the roots come from the same config | ✓ WIRED | Code and comments consistent; live up active in L-C2 |
| `doctor --fix` | state directory | descriptor-based set-mode and create-directory | ✓ WIRED | Live scratch run (dry-run, fix, repeat) |
| Omp extension | daemon status | setStatus frames; realm-retry listed | ✓ WIRED | Active state recorded in L-D2 (daemon up); disconnected state recorded in L-D |
| `realm status` / `realm down` | pinned workspace | POLICY_DENIED outside the workspace; `--workspace` succeeds from elsewhere | ✓ WIRED (documented) | README l.117–119; 15-15-LC-transcript attempt 1 denied, attempt 2 passed; 15-16-workspace-flag-evidence |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
| -------- | ------------- | ------ | ------------------ | ------ |
| Quickstart status | `mode`, `boundRoot`, `sessionId` | daemon snapshot | Yes (live) | ✓ FLOWING |
| Doctor fixes | `fixes` list | filesystem state | Yes (live scratch run) | ✓ FLOWING |
| Omp status frame | `statusText` | daemon state | Yes (L-D disconnected, L-D2 active) | ✓ FLOWING |

### Behavioral Spot-Checks

Not run in this pass; the assignment excludes tests and checks.

- Behaviour cited from recorded runs: live transcripts named under Truths 1, 2, 5, and the orchestrator-observed hermetic result (3025 pass, 0 fail, 39 skipped, recorded at bff6e4f, before PR 70). PR 70 changed AGENTS.md and the spec only; no test reads either file.
- Behaviour-dependent truth to watch: the `doctor --fix` idempotence and dry-run no-change transitions in Truth 2 are evidenced by the live scratch-run transcript, not by an in-repo test run in this pass. If the main agent's test gate does not confirm the named tests, this truth becomes PRESENT_BEHAVIOR_UNVERIFIED.
- No new probe or spot-check outcome is claimed.

### Probe Execution

Not run in this pass. The prior pass identified no declared probes for this phase; this pass did not re-scan for them.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| ----------- | ----------- | ----------- | ------ | -------- |
| ONB-01 | 15-01 to 15-16 | `realm init` writes templates, state 0700, refuses overwrite, digest pinned | ✓ SATISFIED | Criterion 1 |
| ONB-02 | 15-01 to 15-16 | doctor named checks and fixes | ✓ SATISFIED | Criterion 2 |
| ONB-03 | 15-01 to 15-16 | roots read from `config.json` | ✓ SATISFIED | Criterion 3 |
| ONB-04 | 15-01 to 15-16 | doctor --fix on mode 0755 and symlink refusal | ✓ SATISFIED | Criterion 2 |
| ONB-05 | 15-16 | `omp plugin install` recorded | ✓ SATISFIED | Criterion 5 (version deviation recorded) |
| ONB-06 | 15-16 | README install and quickstart; daemon-up frame | ✓ SATISFIED | Criterion 5; L-D2 frame in `docs/hosts/snippets/omp.md` |
| ONB-07 | 15-01 to 15-16 | sentinel env does not reach daemon | ✓ SATISFIED (test presence) | Criterion 3; test not re-run |
| DEF-01 | 15-01 to 15-16 | policy without `mode` is fail-closed | ✓ SATISFIED | Criterion 4 |
| DEF-02 | 15-01 to 15-16 | documents state the fail-closed default | ⚠️ SATISFIED WITH RESIDUAL | Criterion 4; published documents and guard scope verified; `docs/specs/realm-spec.xml` residual (human item 1) |

### Anti-Patterns Found

Debt-marker scan (`TBD`, `FIXME`, `XXX`, `TODO`, `HACK`, `PLACEHOLDER`) over `src/`, `test/`, `scripts/check/`, the phase's docs and `README.md`/`AGENTS.md`: no matches. No Step 7 blocker was found.

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |
| `docs/specs/realm-spec.xml` | 227, 256, 365, 376 | Pre-D4 text describing advisory as the default | ⚠️ Warning | Outside the guard's scope by design; human item 1 |

### Human Verification Required

1. **Pre-D4 default-mode text in the spec (DEF-02 scope).**
   - **Test:** Decide the scope of `docs/specs/realm-spec.xml` l.227, l.256, l.365 and l.376. Either annotate each as superseded by owner decision D4 (an owner-directed edit, which AGENTS.md now allows when the owner asks and the PR records the instruction and reason), or record that the spec is a historical planning record outside DEF-02.
   - **Expected:** Either those lines are annotated as superseded, or the owner records that DEF-02 is closed for published documents only.
   - **Why human:** Whether the authoritative spec's historical planning text counts toward "a search of the documents" is a scope decision.

2. **Main-agent gates on `origin/main` 7b15741.**
   - **Test:** Run the hermetic test suite, and `check:docs` (which includes the default-mode guard scanning AGENTS.md, which changed).
   - **Expected:** The suite has 0 failures (last recorded 3025 pass, 0 fail, 39 skipped, at bff6e4f). `check:docs` passes.
   - **Why human:** Test and check execution was excluded from this pass; it is the main agent's gate.

### Gaps Summary

No blocker gaps. All five roadmap success criteria have evidence, and no truth is FAILED. The phase is not `passed`, for two reasons:

- The spec residual in human item 1 is an open scope decision on the authoritative spec.
- The main-agent gates in human item 2 have not been run on `origin/main` 7b15741.

Previous human items 2 and 3 are closed by the L-D2 frame and by the README note on workspace-bound `status` and `down`. Previous human item 1 is partly closed: the open questions are resolved, and the residual text is listed above.

---

_Verified: 2026-11-13T19:13:49Z_
_Verifier: Claude (gsd-verifier)_

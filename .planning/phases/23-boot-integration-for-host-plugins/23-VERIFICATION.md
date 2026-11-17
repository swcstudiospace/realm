---
phase: 23-boot-integration-for-host-plugins
verified: 2026-11-17
verdict: passed
status: passed
score: 9/9 requirements covered (BOOT-01 to BOOT-09); proven against fakes, a real daemon over fakes and CI; the live rehearsal with a real stdio host was not run; 6 claims outside the evidence reach, listed as behavior_unverified
ref: origin/main 82928b6 (PR 110 squash, plans 23-01 to 23-03)
behavior_unverified: 6
overrides_applied: 0
covered_files:
  - ".planning/phases/23-boot-integration-for-host-plugins/23-CONTEXT.md"
  - ".planning/phases/23-boot-integration-for-host-plugins/23-01-PLAN.md"
  - ".planning/phases/23-boot-integration-for-host-plugins/23-01-SUMMARY.md"
  - ".planning/phases/23-boot-integration-for-host-plugins/23-02-PLAN.md"
  - ".planning/phases/23-boot-integration-for-host-plugins/23-02-SUMMARY.md"
  - ".planning/phases/23-boot-integration-for-host-plugins/23-03-PLAN.md"
  - ".planning/phases/23-boot-integration-for-host-plugins/23-03-SUMMARY.md"
  - "docs/integration/host-plugin-contract.md"
  - "docs/integration/omp.md"
  - "scripts/check/export-usage-allowlist.json"
  - "src/cli/stdio-host.ts"
  - "src/daemon/host-boot.ts"
  - "src/host/attach.ts"
  - "src/host/boot-driver.ts"
  - "src/host/boot-observer.ts"
  - "src/host/boot-report.ts"
  - "src/host/presence.ts"
  - "test/daemon/host-boot.test.ts"
  - "test/host/attach.test.ts"
  - "test/host/boot-driver-conformance.test.ts"
  - "test/host/boot-driver.test.ts"
  - "test/host/boot-no-down.test.ts"
  - "test/host/boot-observer.test.ts"
  - "test/host/boot-report.test.ts"
  - "test/integration/host-boot-isolation.test.ts"
covered_digest: "v3:sha256:1226a5ed0d74eb328e9442f13ab91fc73cbfe5692ba198b49e3d9359fce20706"
---

# Phase 23 Verification: Boot integration for host plugins

Method: read-only read of the repository at `82928b6` (existence and content of the key files, exports, the usage text of `src/cli/main.ts`, the driver's status poll, the documented residuals), plus the CI result reported by the orchestrator. The verifier did not run the build, lint or tests. The code of this phase was written by agents without local compilation; CI was the gate and needed four rounds of fixes (type errors, lint, five unit-test expectation fixes) before it passed. CI on the PR head: Verify on Node 22.x and 24.x, the docs site build and the dependency audit passed.

## Requirements coverage

| Req | Statement | Status | Evidence |
| --- | --- | --- | --- |
| BOOT-01 | `createDaemonAttach` is the only attach implementation; Omp, `realm mcp` and `realm acp` call it; three retention modes | SATISFIED | `src/host/attach.ts` exports `createDaemonAttach` and `RefusalRetention` (`verified`, `always`, `never`); `src/omp/extension.ts` and `src/cli/stdio-host.ts` import it; `test/host/attach.test.ts`. Pre-existing Omp, CLI and mcp-attach expectations pass in CI. |
| BOOT-02 | `createBootDriver` is the production `HostBootHook` for `mcp-config` hosts; passes harness cases C1 to C9; `bootHookOf` returns it for 18 hosts and null for omp | SATISFIED against fakes (see unverified item 1) | `src/host/boot-driver.ts` exports `createBootDriver`, `bootHookOf`, `BootDriverFactory`, `systemTimers`; `test/host/boot-driver-conformance.test.ts` runs the harness; `test/host/boot-driver.test.ts`. Passed in CI. Plan deviation: the status poll arms unconditionally after adoption (residual R3). |
| BOOT-03 | `realm mcp\|acp [--host <id>] [--reattach]` runs the numbered boot sequence, serves nothing before settle, exits 1 on terminal failure, tears down on EOF and signals, never sends `down` | SATISFIED against fakes | `src/cli/stdio-host.ts` (`runStdioHost`); `src/cli/main.ts` usage text and parser carry `--host` and `--reattach`; `test/cli/stdio-host.test.ts`; `test/host/boot-no-down.test.ts`. The built `realm mcp --host claude` marker is read in `scripts/check/mcp-smoke.mjs`. |
| BOOT-04 | Per-host failure isolation with a real daemon over fakes | SATISFIED against fakes (see unverified item 2) | `test/integration/host-boot-isolation.test.ts` scenarios S1 to S7 (hung `up`, unreachable socket, EOF teardown, report flood, three hosts on one project, hostile directory name, stdout frames only). Header states it needs no Podman. |
| BOOT-05 | Markers for `--host <id>` sessions; `realm host status` and the doctor item report live and unreadable markers for every host | SATISFIED | `src/host/presence.ts`, `src/cli/host.ts`, `src/doctor/host-checks.ts`; `test/host/presence.test.ts`, `test/doctor/host-checks.test.ts`, `test/cli/host.test.ts`. Marker written by a built `realm mcp --host claude` in the mcp smoke. |
| BOOT-06 | The `host-boot` control method: strict closed-vocabulary report, token bucket, `hostBoot` metrics and `timings.hostBootMs`, one `host.boot` log line, malformed or over-rate refused and recorded nowhere | SATISFIED | `src/host/boot-report.ts` (`parseHostBootReport`, closed phase, transport and host vocabularies); `src/daemon/host-boot.ts` (60-token bucket taken before parse, `POLICY_DENIED` on empty); `src/observe/metrics.ts` (`hostBoot`, `hostBootMs`); `test/host/boot-report.test.ts`, `test/daemon/host-boot.test.ts`, `test/daemon/host-boot-control.test.ts`. |
| BOOT-07 | The daemon alone appends attached, refused and failed reports to the reserved `host-boot` audit chain; `realm audit verify --session host-boot` passes | SATISFIED against fakes (see unverified item 3) | `src/daemon/host-boot.ts` names the chain `host-boot` (`<stateDir>/audit/host-boot.jsonl`); `test/integration/host-boot-isolation.test.ts` S4 verifies the boot chain with `verifyAuditFile`. |
| BOOT-08 | One host-side observer serves Omp and the stdio hosts; best effort; cannot change an attach outcome, throw, or delay shutdown past 1 s | SATISFIED | `src/host/boot-observer.ts` exports `createBootObserver`; imported by `src/omp/extension.ts` and `src/cli/stdio-host.ts`; `test/host/boot-observer.test.ts`. |
| BOOT-09 | Docs state the shipped behavior with evidence tiers and the unproven live boundary; allowlist has no stale entry; gates pass; live rehearsal recorded or plan blocked on the named step | SATISFIED as recorded (see unverified item 1) | `docs/integration/host-plugin-contract.md` records the live rehearsal as "not run" and its evidence tiers; `docs/integration/omp.md`, `mcp.md`, `acp.md` and `hosts.md` updated; `scripts/check/export-usage-allowlist.json` exists and, [INFERENCE] the allowlist gate ran inside the Verify job that passed in CI; the closer did not read the job log. The rehearsal is recorded as not run, which BOOT-09 permits; it is not claimed. |

## What was observed

- All covered files exist at `82928b6`.
- CI on the PR head passed after four fix rounds; the final run is the gate for BOOT-01 to BOOT-09 test expectations.
- The docs name the live rehearsal as not run and record OQ-23-01 as unmeasured.

## behavior_unverified (6)

1. **A real stdio host booting Realm.** No Claude Code, OpenCode, Codex or Kimi CLI was started with a configuration that launches `realm mcp --host <id>`. The driver, the runner and the shared observer are proven against fakes, a real daemon over fakes, and a built `realm mcp --host claude` in the mcp smoke only. The plan's live rehearsal task was not run.
2. **Serve-after-boot against a real host's connect timeout (OQ-23-01).** A cold first boot can take up to the 230 s `up` bound before `initialize` is answered; no host's MCP start timeout was measured. Serve-early stays deferred.
3. **A real container stack under the isolation tests.** `test/integration/host-boot-isolation.test.ts` runs a real daemon in-process over the existing fakes, with no Podman; real sandbox behavior under a failing sibling host, and `realm audit verify --session host-boot` over a chain written by a real host session, were not observed.
4. **A real Omp through the shared attach and observer.** Omp was moved onto `createDaemonAttach` and `createBootObserver` and its pre-existing unit expectations pass in CI; the Phase 22 live rehearsal predates this change and was not repeated.
5. **Windows and other platforms, and other hosts' real behavior.** No `mcp-config` host was run; per-host recipes writing `realm mcp --host <id>` into host configurations belong to Phase 24 and 25.
6. **Counts and mutants not re-observed.** Test counts and the four reference-mutant outcomes were not re-run for this report; they rest on CI.

## Residuals (not verdict-blocking)

- **R1: planning bookkeeping.** `ROADMAP.md`, `STATE.md` and `REQUIREMENTS.md` (BOOT-01 to BOOT-09) are updated by the orchestrator.
- **R2: a client whose `up` never settles is not closed by teardown.** The driver cannot reach it; the process exits and the sandbox is unaffected. Documented in `docs/integration/host-plugin-contract.md`.
- **R3: status poll arms unconditionally after adoption.** The plan and its must-have say the poll arms only while re-attach is enabled; `src/host/boot-driver.ts` arms it after adoption regardless, and with re-attach off it never arms a wait. The behavior is bounded, but the plan text and the code differ.
- **R4: presence is advisory.** A live marker means a process loaded the plugin or ran a stdio session; it is not a health signal and not containment.
- **R5: no daemon, no daemon record (OQ-23-02).** A boot that never reaches a daemon leaves no daemon-side trail; the exit code, stderr and the host's own log are the trail.

## Verdict

passed: attach logic exists once, the production boot driver and the `realm mcp|acp --host <id>` runner exist and are wired, the daemon records closed-vocabulary boot reports with metrics and a reserved audit chain, the observer is shared, the docs state their evidence tiers, and CI passed on the PR head. Nothing in the phase is FAILED. The six items above are not proven and must not be claimed from this report; in particular, no claim that a real host boots Realm through `realm mcp --host <id>` follows from it.

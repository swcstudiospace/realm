---
phase: 23-boot-integration-for-host-plugins
plan: 02
subsystem: host-boot-daemon-side
tags: [daemon, control-method, audit, metrics, host-boot]
requires: ["22-01", "22-02", "22-03"]
provides:
  - "src/host/boot-report.ts: the strict closed-vocabulary host-boot report (phases, transports, host ids plus unlabelled) and parseHostBootReport"
  - "src/daemon/host-boot.ts: createHostBootRecorder, the daemon-side recorder behind the host-boot control method"
  - "The reserved host-boot audit chain at <stateDir>/audit/host-boot.jsonl, written by the daemon alone"
  - "hostBoot counters and timings.hostBootMs in realm metrics"
affects: [src/host/boot-report.ts, src/daemon/channel.ts, src/daemon/host-boot.ts, src/daemon/daemon.ts, src/observe/metrics.ts, test/host/boot-report.test.ts, test/daemon/channel.test.ts, test/daemon/host-boot.test.ts, test/daemon/host-boot-control.test.ts, test/observe/metrics.test.ts]
key-files:
  created:
    - src/host/boot-report.ts
    - src/daemon/host-boot.ts
    - test/host/boot-report.test.ts
    - test/daemon/host-boot.test.ts
    - test/daemon/host-boot-control.test.ts
  modified:
    - src/daemon/channel.ts
    - src/daemon/daemon.ts
    - src/observe/metrics.ts
    - test/daemon/channel.test.ts
    - test/observe/metrics.test.ts
decisions:
  - "The report is a closed vocabulary with no selection field: phases attached, refused, failed, link-lost, reattached, closed; transports extension, mcp, acp"
  - "Only attached, refused and failed reports reach the audit chain, appended by the daemon; the chain id is host-boot and the boot id is the correlation id"
  - "Reports are rate-bounded by a token bucket; a malformed or over-rate report is refused with an existing catalogue code and records nothing"
  - "hostBoot and timings.hostBootMs are both present or both absent in the metrics snapshot, so an older daemon emits neither; the hostBoot key space is closed and capped at a fixed row count"
requirements: [BOOT-06, BOOT-07]
metrics:
  tasks: 3
  completed: 2026-11-17
status: merged
---

# Phase 23 Plan 02: Daemon-side host-boot method, audit chain and metrics Summary

Merged to main in PR 110 (squash `82928b6`). The daemon can now be told, by a closed-vocabulary report, how a host's boot ended, and records it with mechanisms Realm already has.

## What shipped

- `src/host/boot-report.ts` defines `HOST_BOOT_PHASES`, `HOST_BOOT_TRANSPORTS`, `BOOT_REPORT_HOSTS`, `HostBootReport` and the strict `parseHostBootReport`.
- `src/daemon/host-boot.ts` (`createHostBootRecorder`) feeds the `hostBoot` metrics rows and `timings.hostBootMs`, writes one redacted `host.boot` daemon-log line carrying the boot id, and appends the boot audit chain; the capability posture of the reporting host is logged from the loaded policy.
- `src/daemon/channel.ts` and `src/daemon/daemon.ts` add the `host-boot` control method to the channel and wire the recorder.
- `src/observe/metrics.ts` adds `hostBoot` and `timings.hostBootMs` to the snapshot.
- Tests: `test/host/boot-report.test.ts`, `test/daemon/host-boot.test.ts`, `test/daemon/host-boot-control.test.ts`, plus additions to the channel and metrics tests.

## Observed

- Read of `origin/main` at `82928b6`: `src/host/boot-report.ts`, `src/daemon/host-boot.ts` and their tests exist; `src/daemon/host-boot.ts` names the audit session id `host-boot` and `src/observe/metrics.ts` carries `hostBoot` and `hostBootMs`.
- CI on the PR head passed (Verify on Node 22.x and 24.x, docs site build, dependency audit).

## Not verified here

- The daemon side was exercised through unit and control-channel tests and the isolation tests (fakes), not by a real host reporting from a real boot.
- `realm audit verify --session host-boot` against a chain written by a real host session was not run by the closer.

## Deviations from plan

- **Code written without local compilation.** As in 23-01, CI was the gate and the fix rounds (type errors, lint, test expectation fixes) landed before merge; the closer did not re-derive each fix.

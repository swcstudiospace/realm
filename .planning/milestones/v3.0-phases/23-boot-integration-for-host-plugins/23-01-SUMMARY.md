---
phase: 23-boot-integration-for-host-plugins
plan: 01
subsystem: host-boot-driver
tags: [host, boot-driver, attach, mcp-config, presence, conformance]
requires: ["22-01", "22-02", "22-03"]
provides:
  - "src/host/attach.ts: createDaemonAttach, the one implementation of ensure daemon, connect, up and refusal retention, with three retention modes (verified, always, never)"
  - "src/host/boot-driver.ts: createBootDriver, the production HostBootHook for mcp-config hosts, plus bootHookOf and systemTimers"
  - "bootHookOf returns the driver for the 18 mcp-config hosts and null for omp; createHostAdapter defaults bootHook to it, an explicit deps.bootHook still wins"
  - "mcp-config manifests accept a boot block; defaultManifestFor launches realm mcp --host <id> for every mcp-config host"
  - "Presence read side: realm host status <id> reports plugin.sessions for any host with live or unreadable markers; the host-plugins doctor item names live sessions by host id and count"
affects: [src/host/attach.ts, src/host/boot-driver.ts, src/host/types.ts, src/host/manifest.ts, src/host/adapter.ts, src/host/presence.ts, src/doctor/host-checks.ts, src/cli/host.ts, test/host/attach.test.ts, test/host/boot-driver.test.ts, test/host/boot-driver-conformance.test.ts, test/host/boot-no-down.test.ts, test/host/manifest.test.ts, test/host/adapter.test.ts, test/host/presence.test.ts, test/doctor/host-checks.test.ts, test/cli/host.test.ts]
key-files:
  created:
    - src/host/attach.ts
    - src/host/boot-driver.ts
    - test/host/attach.test.ts
    - test/host/boot-driver.test.ts
    - test/host/boot-driver-conformance.test.ts
    - test/host/boot-no-down.test.ts
  modified:
    - src/host/types.ts
    - src/host/manifest.ts
    - src/host/adapter.ts
    - src/host/presence.ts
    - src/doctor/host-checks.ts
    - src/cli/host.ts
    - test/host/manifest.test.ts
    - test/host/adapter.test.ts
    - test/host/presence.test.ts
    - test/doctor/host-checks.test.ts
    - test/cli/host.test.ts
decisions:
  - "One attach function serves three callers through a refusal-retention mode: verified (Omp), always (realm mcp), never (realm acp); selection is re-resolved on every call and the daemon is spawned at most once"
  - "The driver runs each attempt under withStartupBudget, takes every bound from ResolvedBoot and retries only what attachFailureDisposition calls retryable; re-attach stays off unless the manifest enables it"
  - "BootDriver.call is a { call } dispatcher that fails closed: a blocked or failed call returns a refused ToolOutcome and never throws; shutdown closes the client only and no file names the control method down"
  - "Presence is read for every host, not only omp; a host with no markers keeps the exact status row { id, status, entries }"
requirements: [BOOT-01, BOOT-02, BOOT-05]
metrics:
  tasks: 3
  completed: 2026-11-17
status: merged
---

# Phase 23 Plan 01: Shared attach, production boot driver, adapter and presence read side Summary

Merged to main in PR 110 (squash `82928b6`, one squash for plans 23-01 to 23-03). The 18 `mcp-config` hosts now have a production `HostBootHook`, and attach logic exists once.

## What shipped

- `src/host/attach.ts` exports `createDaemonAttach` and the `RefusalRetention` type (`verified`, `always`, `never`). It ensures the daemon, connects, sends `up` and decides whether a refused client is kept; a non-`RealmError` refusal becomes `SCHEMA_INVALID`.
- `src/host/boot-driver.ts` exports `createBootDriver`, `BootDriver`, `BootDriverFactory`, `bootHookOf`, `systemTimers` and `STDIO_TOOLS` (the six Realm tool names). It uses the bounds, budget, retry disposition, back-stop verdict, re-attach transition and jitter helpers of `src/host/boot.ts`. Its status poll paints the state the daemon reports and detects a lost link; shutdown clears every timer and closes the client once.
- `src/host/adapter.ts` defaults `bootHook` to `bootHookOf(entry)`; `src/host/manifest.ts` accepts a `boot` block for `mcp-config` manifests and `defaultManifestFor` launches `realm mcp --host <id>`.
- `src/host/presence.ts`, `src/cli/host.ts` and `src/doctor/host-checks.ts` give the read side of presence for every host: `realm host status <id>` reports `plugin.sessions`, the doctor item names live sessions by host id and count.
- `test/host/boot-driver-conformance.test.ts` runs the Phase 21 harness against the production driver; `test/host/boot-no-down.test.ts` pins that no driver path names `down`.

## Observed

- Read of `origin/main` at `82928b6`: `src/host/attach.ts`, `src/host/boot-driver.ts` and the tests above exist; `bootHookOf` is exported from `src/host/boot-driver.ts`.
- CI on the PR head passed (Verify on Node 22.x and 24.x, docs site build, dependency audit) after four rounds of fixes, see below.

## Not verified here

- No real host booted through this driver; the driver was exercised against fakes only (the live rehearsal is recorded as not run in 23-03-SUMMARY.md and 23-VERIFICATION.md).
- Harness case and mutant outcomes were not re-run by the closer; they rest on CI.

## Deviations from plan

- **Status poll arms unconditionally after adoption.** The plan says the poll arms only while re-attach is enabled. The merged `boot-driver.ts` arms it once a client is adopted, whatever the re-attach setting; with re-attach off the poll paints state and never arms a wait. Behavior is bounded and tested, but it differs from the plan text and from the plan's must-have truth. Recorded, not changed here.
- **Code written without local compilation.** The plan code was written by agents that did not compile or run it; CI was the gate and needed four rounds of fixes (type errors, lint, five unit-test expectation fixes). No behavior was dropped to get green; the closer did not re-derive each fix.

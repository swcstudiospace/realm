---
phase: 21-host-plugin-contract-and-installer
plan: 02
subsystem: host-boot-hook
tags: [host, boot-hook, conformance, omp-parity, reattach]
requires: ["21-01"]
provides:
  - "src/host/boot.ts: BOOT_BOUNDS, resolveBoot, withStartupBudget, attachFailureDisposition, backstopVerdict, reattachTransitionAllowed, equalJitterDelayMs"
  - "Parity tests that fail if BOOT_BOUNDS or the re-attach rules drift from the Omp constants and functions"
  - "A reusable conformance harness (cases C1 to C9) for any HostBootHook factory, a reference hook and broken variants"
affects: [src/host/boot.ts, test/support/host-boot-conformance.ts, test/support/reference-boot-hook.ts, test/support/fake-host-daemon.ts]
key-files:
  created:
    - src/host/boot.ts
    - test/host/boot.test.ts
    - test/host/boot-conformance.test.ts
    - test/support/fake-host-daemon.ts
    - test/support/host-boot-conformance.ts
    - test/support/reference-boot-hook.ts
  modified: []
decisions:
  - "The boot-hook port restates the Omp plugin's seams once for every host; src/omp is not modified and src/host imports nothing from it. Phase 22 moves Omp onto the contract and deletes the duplicated Omp copies and the parity test"
  - "Re-attach is off by default for a manifest without a boot block (an mcp-config host); a manifest can enable it, with the Omp cap and backoff"
requirements: [HOST-04]
metrics:
  tasks: 3
  completed: 2026-11-17
status: merged
---

# Phase 21 Plan 02: boot-hook port, bounds parity, conformance harness Summary

Merged to main in PR 102 (squash `bf70847`). The port states, in testable form, what the Omp plugin does at session start, tool guard, retry, shutdown and re-attach, so a future host hook can be checked against the same bounds.

## What shipped

- `src/host/boot.ts` (141 lines): `BOOT_BOUNDS` frozen at startup budget 200000 ms, guard status budget 5000 ms, status poll 2000 ms, re-attach cap 8, base 1000 ms, ceiling 60000 ms, re-attach disabled by default; link-lost codes `REALM_NOT_ACTIVE`, `TOOL_TIMEOUT`; retryable attach codes `REALM_NOT_ACTIVE`, `TOOL_TIMEOUT`, `STARTUP_BUDGET_EXCEEDED`, `DAEMON_START_TIMEOUT`. `withStartupBudget` delegates to `withTimeout(…, STARTUP_BUDGET_EXCEEDED)`. `backstopVerdict` is the fail-closed tool-name guard (a non-string name is blocked). `reattachTransitionAllowed` and `equalJitterDelayMs` restate the sub-state table and the equal-jitter formula.
- `test/host/boot.test.ts` (16 cases): `BOOT_BOUNDS` equals the Omp constants; the transition table agrees with Omp on all 25 pairs; the jitter function agrees over an attempt and random grid and throws the same `RangeError`; the startup budget equals the `policy.schema.json` default; `src/host/boot.ts` imports nothing from `src/omp` and reads no environment.
- `test/support/host-boot-conformance.ts`: nine cases for any `HostBootHookFactory`: C1 attach budget, C2 attach ok and status readback, C3 refused-up retention, C4 terminal attach failure, C5 fail-closed guard, C6 shutdown closes the client only, C7 re-attach off by default, C8 re-attach bounded by the cap, C9 workspace switch. `test/support/reference-boot-hook.ts` is a minimal conforming hook plus deliberately broken variants; `test/support/fake-host-daemon.ts` is the daemon double. `test/host/boot-conformance.test.ts` proves the reference hook passes every case and the broken variants fail.

## Observed

- Read of `origin/main` at `bf70847`: the files above exist; `boot.ts` holds the values listed. The parity tests compare against `src/omp/plugin.ts` and `src/omp/reattach.ts` at runtime, which are unmodified by the merge (the PR's file list has no `src/omp` entry).
- CI on the PR head passed (Verify 22.x and 24.x, docs site, dependency audit); the orchestrator reported the host tests green locally before the PR.

## Not verified here

- No real host hook exists yet. The harness is proven only against the reference hook and its broken variants over a fake daemon; a hook running inside a live host is Phase 22 (Omp), 24 and 25.
- Daemon-boot wiring of the hook is Phase 23.

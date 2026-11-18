---
phase: 33-cold-attach
plan: "01"
status: complete
requirements: [COLD-01, COLD-02, COLD-03]
merged: "PR 163, commit 1d7d6d9, 2026-11-18"
---

# 33-01 summary: `realm mcp` serves the handshake before ensure and up complete

## What changed

- `src/cli/stdio-host.ts`: the MCP branch creates its server right after step 1 (resolve) and starts the boot driver (ensure, up, readback, settle) without awaiting it. `initialize`, `server/discover` and `tools/list` are answered at once with the bytes a ready session gives. The ACP branch is unchanged: it still answers only after the boot settles.
- `src/host/boot-driver.ts`: a call made while an attempt is in flight is refused as retryable, and a `retry` in that state does nothing, so the attempt the host is waiting for is never restarted (`retryableNow` and the `retry` guard).
- `src/cli/stdio-settle.ts` (new): `describeSettle` and `exitCodeAfterClose`, the D-33-05 outcome table as a pure function. A settled boot is one stderr diagnostic, written once, and a decision whether the process exits 1 at stdin end: only when no client was ever adopted and the boot failed.
- `src/cli/main.ts`: five lines of wiring.
- `scripts/check/mcp-smoke.mjs` and its test: the smoke gate rewritten to the serve-early contract.

A tool call made before the driver has adopted a verified client is refused locally: outcome `refused`, code `REALM_NOT_ACTIVE`, `retryable` true. It makes no daemon request, writes no audit line and no metric, and is never queued. Once the boot settles ready, the next call on the same connection is forwarded, with no reconnect.

No file under `src/omp`, `src/acp`, `src/daemon`, `src/core`, `src/contract`, `src/capability`, `src/tools` or `src/audit` changed, and the error catalogue still has 29 codes.

## Tests added or migrated

- New: `test/cli/stdio-cold-attach.test.ts` (the not-active window, the refusal of every call, the retry in the window, the transition on one connection, a host that leaves in the window), `test/cli/stdio-settle.test.ts` (the outcome table), `test/daemon/cold-attach-e2e.test.ts` (a real daemon and socket with a held create, under capability enforce), `test/daemon/up-disconnect.test.ts` (the daemon completes an up whose client disconnected).
- Extended: `test/host/boot-driver.test.ts`, `test/cli/stdio-host.test.ts`, `test/cli/stdio-host-matrix.test.ts`, `test/cli/cli.test.ts`, `test/cli/mcp-attach.test.ts`, `test/integration/host-boot-isolation.test.ts`, `test/daemon/capability-e2e.test.ts`, and the support files `test/support/stdio-world.ts`, `test/support/stdio-host-harness.ts`, `test/support/capability-harness.ts`, `test/support/boot-matrix-rig.ts`.
- A follow-up commit in the same PR made the unlabelled cold-attach case run with capability tokens off, because the default had become enforce (Phase 34).

## Deviations and notes

- `test/cli/mcp-attach.test.ts` and `test/support/boot-matrix-rig.ts` changed although the plan's file list did not name them; both followed the same contract change.
- The live proof is plan 33-03; the pages are plan 33-02. This plan claimed no live result.

## Checks

The change merged through PR 163 with its CI. This summary was written afterwards from the merged commit and the plan; it records no command output of its own.

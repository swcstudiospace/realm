---
phase: 34-capability-tokens-enforce-by-default
plan: "01"
status: complete
requirements: [ENF-01, ENF-02]
merged: "PR 159, commit e7b4d57, 2026-11-18"
---

# 34-01 summary: the tests and rigs no longer depend on the capability default

## What changed

Behaviour neutral, in the tests only, while the default was still `off`, so the commit was green on its own and the flip of plan 34-02 could follow without a red commit.

- `test/support/policy-document.ts`: one shared opt-out member, `CAPABILITY_TOKENS_OFF` (`capabilityTokens.mode` set to `off`), for a test that starts a real daemon for a purpose that is not capability tokens.
- `test/support/realm-daemon-fixture.ts`: the option `capabilityTokens` (`"default"`, the default, writes no `capabilityTokens` key; `"off"` spreads the shared opt-out member in); `connectFor(project, host?)` hands out a client with or without a host id.
- `test/support/boot-matrix-rig.ts` and `test/integration/host-boot-isolation.test.ts`: the wrappers around `connectDaemon` forward the third argument, so the real client keeps its host id; these suites then run real hosts under whatever the default is, which is extra coverage after the flip.
- Tokenless-client tests that do not mean to test tokens pass `"off"` explicitly: `test/daemon/realm-daemon-fixture.test.ts`, `test/surfaces/daemon-equivalence.test.ts`, `test/daemon/daemon.test.ts`, `test/acp/agent.test.ts`, `test/mcp/server.test.ts`.

## Deviations and notes

- The merged change touches 9 files, fewer than the 12 the plan listed: `test/daemon/e2e.test.ts`, `daemon-health.test.ts`, `host-boot-control.test.ts`, `libpod-entry.test.ts` and `test/integration/omp-guard.test.ts` were not edited (the plan expected them unaffected and left the probe to confirm), while `test/acp/agent.test.ts` and `test/mcp/server.test.ts` were added.
- The results of the plan's local flip probe (which files failed with the default set to `enforce`) are not recorded in this summary. The later flip commit (plan 34-02) passed CI with the remaining files untouched, which is the evidence that the decoupling was sufficient.
- No `!` in the subject, by design: the commit is behaviour neutral (D-34-10).

## Checks

The change merged through PR 159 with its CI. This summary was written afterwards from the merged commit and the plan; it records no command output of its own.

---
phase: 42-evidence-debt
plan: "03"
requirements: [DEBT-01]
---

# 42-03 summary: the whole unit suite as uid 5002

Recorded 2026-11-18. The window was run by a person; this plan wrote the result into the evidence page and the decision record. No file under `src`, no schema, no recipe, no default and nothing under `.github/workflows` changed in this plan.

## Result (Observed, 2026-11-18 22:55 UTC)

The whole compiled unit suite (Set B) ran once as the realmlive account (uid 5002, gid 5002, no supplementary groups; the harness ran as root) on commit `62b85fe` (main after PR 203), with Node v24.18.0, kernel 6.8.0-149-generic and Yama `ptrace_scope` 1. The tree was rebuilt clean (stale `dist` removed) and copied under the account's home. The environment was scrubbed (`env -i` with HOME, PATH, TMPDIR and XDG_RUNTIME_DIR), and the command was `node --test --test-concurrency=2` over `dist/test/**/*.test.js`.

- 5542 tests, 5459 passed, 0 failed, 83 skipped. Skipped tests count as `not-run`, never as passes.
- A scan for the token and key shapes: 0 hits. Before and after snapshots equal: 0 containers, 0 sandboxes, an empty workspace, no daemons, the policy hash unchanged.
- Evidence kept outside the repository.

## Window history (kept, not smoothed)

The first Set B run, on commit `d80c79a`, ran from a build directory that still held compiled output of the deleted Anda tests (`dist/test/anda`, `dist/src/anda`, left from before Phase 28). It showed 42 failures.

- 41 were those stale compiled Anda tests: a stale-build artefact, not a product failure, removed by the clean rebuild.
- 1 was a real test defect: `test/runtime/exec-watchdog.test.ts`, "the group-kill denial of the sandbox is reproduced by the BASH_ENV used above". It failed only under a scrubbed environment: bash did not read BASH_ENV, so the denial function never loaded. PR 203 fixed it by exporting the denial as a bash function (`BASH_FUNC_kill`). The rerun on the clean rebuild of `62b85fe` had 0 failures; that rerun is the recorded row.

## Where it is recorded

- `docs/integration/capability-token-evidence.md`: a Set B row in the EVID-01 table, the window and findings paragraphs, the status-table cell of EVID-01, and the replaced Not shown bullet. The page's guard test rules (date and version on a recorded row, labels on every Not shown bullet) hold.
- `docs/integration/runtime-decision.md`: the DEBT-01 paragraph at the end of D42-1.

## Limits

One run, one machine, one Node version (24.18.0) and one day. Set C (the script tests) was not recorded in the window. The 83 skipped tests are inferred to be the gated live and integration tests (the scrubbed environment sets no gate variable); the grouping is in the evidence directory. CI covers Node 22.x as a regular user.

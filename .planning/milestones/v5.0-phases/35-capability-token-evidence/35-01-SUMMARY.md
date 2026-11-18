---
phase: 35-capability-token-evidence
plan: "01"
subsystem: capability-token-evidence-page
tags: [capability-token, evidence, non-root-run, set-a, set-b, ptrace-scope]
requires: []
provides:
  - "docs/integration/capability-token-evidence.md: the evidence page, with one section per requirement (EVID-01, EVID-02, EVID-03), the status vocabulary (not-run, recorded, partial, failed), the machine and run facts table with evidence labels, a Not shown section and the evidence-outside-the-repository note"
  - "test/docs/capability-token-evidence.test.ts: the page guard (headings once and in order, status vocabulary, a dated and versioned row for every result, no token shape, no 32-hex run, no host path, no raw angle token, no advisory wording next to the default, an evidence label on every result sentence once a row left not-run)"
  - "EVID-01 recorded for Set A: the capability test set (24 compiled test files) ran twice as a regular user (uid 5002, not root) with Yama ptrace_scope 1: 494 tests each time, 494 passed, 0 failed, 0 skipped"
affects: [docs/integration/capability-token-evidence.md, test/docs/capability-token-evidence.test.ts]
key-files:
  created:
    - docs/integration/capability-token-evidence.md
    - test/docs/capability-token-evidence.test.ts
  modified: []
decisions:
  - "Every cell of the page is the result of a dated run or the word not-run; a skipped test is not-run, never a pass"
  - "The page measures claims and gives no defence: a process of the same user that can read the key file or run the attach step is not stopped, whatever the memory result is"
  - "Set A is the capability test set; Set B (the whole unit suite) is recorded without gating EVID-01, which is about the token tests"
  - "The tests run as the realmlive account from a copy of the built tree owned by that account, with a scrubbed environment, a short temporary directory and no live gate variable; the harness runs as root only to make the copy"
requirements: [EVID-01]
metrics:
  tasks: 3
  completed: 2026-11-18
status: merged
---

# 35-01 summary: the evidence page and the non-root run

## What shipped

- The evidence page and its guard test (see `provides`). The page starts with every row `not-run` and each later plan fills its own section; the guard fires on any row that claims a result without a date, a version or an evidence label.
- The EVID-01 run. Set A, 24 compiled test files (the capability tests admit, gate, keyring, limiter and token; the daemon tests capability-wire, capability-e2e, channel, client and the memory probe test; the cli tests host-token and stdio-host; the omp extension test; the doctor capability-checks test; the audit tests redaction and principal; the tools principal test; the core policy schema test; the host tests recipes-bare, adapters-labelled and refusal-hint; the docs tests capability-token-doc and capability-token-evidence; the support test memory-probe), ran twice as uid 5002 on commit 7c44538 with Node v24.18.0 and `ptrace_scope` 1.

## Observed

- 2026-11-18: both final runs agreed, 494 tests, 494 passed, 0 failed, 0 skipped; the host was clean before and after (0 containers, 0 sandboxes, 0 daemons, an empty workspace, an unchanged policy hash).
- The old informational probe test of the capability token work no longer exists (removed in plan 35-02); the probe tests ran and were not skipped.

## Not verified here

- Set B, the whole unit suite as the same user, was not run in the window. The page says so in its Not shown section and the status of EVID-01 is `recorded` for Set A only.
- No separate first-run result of the plan 35-01 window is recorded, so that row of the page stays `not-run`; the two recorded runs are the final runs of plan 35-02's window.
- Node 22.x was not run (only Node 24 is installed on the machine); CI covers both as a regular user.

## Deviations from plan

- The first run before the probe test moved into its own file is not recorded separately; the two recorded runs both used the final file list.

---
phase: 28-remove-the-anda-bridge
plan: "02"
subsystem: degraded-state-removal
tags: [state-machine, status, degraded, breaking-change, session-store, daemon-client]
requires: ["28-01"]
provides:
  - "src/core/states.ts: STATES is the five states unbound, connecting, active, error, stopping; ALLOWED_TRANSITIONS is the nine edges (unbound to connecting; connecting to active, error and stopping; active to error and stopping; error to connecting and stopping; stopping to unbound); no edge names degraded"
  - "src/core/status.ts: displayStatus maps each of the five states to one of the two labels; DisplayStatus has no degraded member and the display has no degraded field"
  - "Every consumer (policy, dispatch, session state, controller, daemon sessions and client, CLI, stdio host, Omp plugin) treats active as the only in-service state"
  - "A stored session record whose state is degraded fails validation: SessionStore.load throws SCHEMA_INVALID, list still names it, and the startup reap deletes it as unreadable and removes its container as no-record (D-28-07, no migration)"
  - "A status or up reply naming the state degraded (a 0.3 daemon) is refused; a status reply with or without display.degraded is accepted and the key is not interpreted"
affects: [src/core/states.ts, src/core/status.ts, src/core/policy.ts, src/tools/dispatch.ts, src/lifecycle/session-state.ts, src/lifecycle/controller.ts, src/daemon/sessions.ts, src/daemon/client.ts, src/cli/main.ts, src/cli/stdio-host.ts, src/omp/plugin.ts, test/core/states.test.ts, test/core/state-machine.test.ts, test/session/reap.test.ts, test/session/store.test.ts, test/daemon/client.test.ts, test/cli/cli.test.ts, test/contract/session-record.schema.test.ts]
key-files:
  created: []
  modified:
    - src/core/states.ts
    - src/core/status.ts
    - test/core/states.test.ts
    - test/core/state-machine.test.ts
    - test/session/reap.test.ts
    - test/session/store.test.ts
    - test/daemon/client.test.ts
    - test/cli/cli.test.ts
    - test/contract/session-record.schema.test.ts
decisions:
  - "D-28-04: degraded is removed completely, including the display.degraded status field; STATUS_LABELS is unchanged"
  - "D-28-07: persisted degraded records are not migrated; they are refused as unreadable and the reap deletes them"
  - "No new state, label or code; no change to the mutation-gate decision for the states that remain"
requirements: [ANDAX-03, ANDAX-04]
metrics:
  tasks: 3
  completed: 2026-11-17
status: merged
---

# Phase 28 Plan 02: Remove the degraded state and display.degraded Summary

Merged to main in PR 138 (merge commit `b7fc985`). This plan is the commit `a56bc15` "feat(core)!: remove the degraded state and display.degraded (ANDAX-03, ANDAX-04)": 36 files changed, 229 insertions, 158 deletions. The plan's two commits (the state, then the field) were folded into one commit by the PR, and the gate-data task needed no separate commit of its own; the one gate-data commit of the PR (`54b6b41`) is recorded under plan 28-01.

## What was done

- Task 1: `degraded` is removed from `STATES` and the transition table (the four edges that named it are gone, leaving nine), and every consumer is reduced to `active` as the only in-service state: the mutation-gate and policy decisions, the dispatcher, the session state, the controller probe, the daemon health loop and sessions, `realm up`, the ACP boot check and the Omp status text (no `[degraded]` marker).
- Task 2: the `display.degraded` field is removed from `displayStatus`, `DisplayStatus` and the daemon client's validation of a status reply.
- Task 3: gate data; the module-size allowlist and the coverage claims were checked against the smaller files. [INFERENCE] The allowlist entries needed no further change beyond plan 28-01 (the closer read only the final state of the file, which holds one entry).

## Observed

- Read of `origin/main` on 2026-11-17: `src/core/states.ts` lists exactly the five states and the nine edges above; `src/core/status.ts` has five cases mapping to `STATUS_LABELS.active` or `STATUS_LABELS.disconnected`; the only remaining `degraded` text under `src` and `test` is in tests that assert the removal (`test/core/states.test.ts`, `test/core/state-machine.test.ts`, `test/session/reap.test.ts`, `test/session/store.test.ts`, `test/daemon/client.test.ts`, `test/cli/cli.test.ts`, `test/contract/session-record.schema.test.ts`) and one comment in `src/core/states.ts`.
- Test titles read: "the state set is exactly the five states, and degraded is not one of them"; "every edge naming degraded is rejected with REALM_INVALID_TRANSITION (Phase 28)"; the reap case "a stored record whose state is degraded is deleted as unreadable and its container is removed as no-record"; the store case that such a record fails `load` with `SCHEMA_INVALID` and is still listed; the client cases for a reply without `display.degraded`, a reply from a 0.3 daemon with `degraded: false`, and a refused reply whose snapshot state is `degraded`; the CLI case that `realm up` exits 1 with `REALM_NOT_ACTIVE` for such a reply.
- CI on PR 138 passed after the one gate fix (see plan 28-01): Verify on Node 22.x and 24.x, the docs site and the audit.

## Not verified here

- Stale stored `degraded` records are covered by the tests named above only. No record written by a real 0.3 daemon was loaded by a 0.4 build; no one ran the reap against a real Podman container.
- `npm test` and `npm run test:coverage` were not run locally; the claim rests on CI of PR 138.
- The behaviour of an old daemon that still serves `display.degraded` against a new client was exercised by the client test with a fake reply, not by a real 0.3 daemon.

## Deviations from plan

- Two commits planned, one made (see above). No behaviour deviation was found in the files read.

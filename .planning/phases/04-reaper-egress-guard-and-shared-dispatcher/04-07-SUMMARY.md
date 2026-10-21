# Phase 04 Plan 07: Gated Live Bodies, Taxonomy, and Decision Record — Summary

Phase 4 wave-4 closeout: gated live integration bodies for RT-05, RT-08, and
TOOL-03, the `tools` taxonomy category with Phase 4 ID coverage, and the
Phase 4 decision-note section with its test.

## Files changed

- `test/integration/podman-gate.test.ts` — migrated the sweep import from
  `src/runtime/session-execution.js` to `src/runtime/sweep.js` (split import;
  `selectOpenShellEnvironment`/`spawnOpenShellRunner` stay); `scopedSweep`
  unchanged in behavior (same `SweepClient` type, now from the moved module);
  fixed the `writePolicyDocument` call to pass the new 4-argument form
  `(stateDir, sessionId, egress, workloadBinary)` with an empty-argv guard;
  `createLiveContainer` takes an optional `egress` allowlist (default `[]`,
  deny-all); added five gated live bodies, each under the existing `liveGate`
  (skips with `PODMAN_UNSUPPORTED_VERSION` on 4.9.3): three RT-05 egress
  probes through the supervisor proxy path (allowlisted host:port reachable,
  non-allowlisted host unreachable, IPv6 unreachable), one RT-08 crash-reap
  via `reapStartup` with a null-container-id record, and one TOOL-03 exec
  through `ToolDispatcher` against the live sandbox.
- `test/quality/suite-taxonomy.test.ts` — added `"tools"` to `CATEGORY_DIRS`;
  added the `tools` category (`dispatch`, `queue-timeout`, `workspace`,
  `no-bypass`) to `CATEGORY_MAP`; added the six Phase 4 files to `D45_FILES`;
  added `PHASE_4_REQUIREMENT_IDS` (RT-05, RT-08, TOOL-03, TOOL-04) with a
  title-citation check mirroring the Phase 3 check. Phase 2 and Phase 3 lists
  untouched.
- `docs/integration/runtime-decision.md` — appended the Phase 4 section
  (D-100): OQ-P3-16 resolution with the v0.1.2 schema URL and 2026-10-21 read
  date (D-82); exec verb pin with `--help` evidence (D-93); IPv6 partial
  status (D-76); single-owner precondition with OQ-P4-06 residual risk (D-87);
  the D-90 two-lines-per-call audit note for the Phase 7 reader; and the
  OQ-P4-01 to OQ-P4-12 table with one default per item. No other doc changed;
  no new integration note file created.
- `test/runtime/decision-note.test.ts` — generalized the OQ row parser into
  `openQuestionRowsFor(text, prefix)` with `openQuestionRows`/`openQuestionRowsP4`
  delegates (existing Phase 3 assertions unchanged); added six Phase 4 tests
  asserting the section, the OQ-P3-16/exec/IPv6/precondition/audit entries,
  and the ordered 12-row OQ-P4 table with non-empty defaults.

## Deviations from the plan

None in scope. Two implementation choices the plan left open:

1. The TOOL-03 live body wires `ToolDispatcher` to a stub controller pinned
   to `active` (real `EventBus`, `LockTable`, default policy from
   `loadPolicyFile` on a nonexistent path, real runner). Only the
   dispatcher's schema, state, audit, and execution stages run; execution
   reaches the live sandbox through the pinned exec argv. Rationale: a full
   `LifecycleController` would couple the live body to workspace binding and
   bridge setup unrelated to TOOL-03.
2. The RT-05 probes use `/bin/sh -c` with a `/dev/tcp` connection attempt and
   read the probe host/port from `REALM_LIVE_EGRESS_HOST`/`PORT` (defaults
   `registry.example.com:443`). The `/bin/sh` assumption is recorded in the
   bodies as live-gated under OQ-P4-04; the `.invalid` host and `::1` probes
   deterministically fail by design.

## Findings

- `test/tools/dispatch.test.ts` and `test/tools/queue-timeout.test.ts` do not
  exist on disk yet (parallel 04-06 executor still working; not created or
  touched per instructions). Consequence: `test/quality/suite-taxonomy.test.ts`
  cannot pass until they land — the "every D-45 test file exists" check and
  the new Phase 4 check both require them (TOOL-04 is title-cited only by
  `queue-timeout.test.ts`). Explicit dependency for the orchestrator: run the
  taxonomy gate after 04-06 completes.
- No stub, placeholder, or mock-assertion patterns were introduced; new live
  bodies assert observable behavior (reachability booleans, exit codes,
  reap counts, record/container absence, dispatcher outcome/tool).

## Verification

No gates were run by this executor (no typecheck, lint, tests, build, or git
commands), per the run rules. The orchestrator runs `tsc` and the node:test
suites after all waves land. Self-check: all four target files were edited in
place; no file outside the task list was created or modified.

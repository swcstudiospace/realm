---
phase: 47-legacy-kimi-production-tier-and-env-forwarding
plan: "01"
subsystem: testing
tags: [wire-recorder, timeline, classification, attribution, ablation, evidence, kimi, mcp]
requires:
  - phase: 43-kimi-and-kimi-code-rehearsal
    provides: the wire recorder, the command drive of the production runner and the legacy kimi production failure GAP-43-03
provides:
  - the frozen rules of 47-CONTEXT D-47-03 to D-47-06 as code with a hermetic pin (wire-timeline.ts)
  - the timeline recorder (marks, error and meta flags, lifecycle lines, stderr copy) with the old readers unchanged
  - the evidence directory check and run folder writer, the reach observation, the variant switches and the two validator probes
  - the hermetic early-close and slow-reader characterization of realm mcp
affects: [47-02, 47-03, 47-04]
requirements-completed: [KIMV-01, KIMV-02, KIMV-03]
---

# Plan 47-01 summary: the instrument

Test support only. Nothing under src, package.json or package-lock.json changed, nothing was committed, and no live step ran (no kimi
CLI, no daemon, no container, no production stack, no gated test). Plan 47-02 runs the window.

## Files

Created:

- test/support/wire-timeline.ts, test/support/wire-timeline.test.ts, test/support/wire-timeline-run.ts
- test/support/host-live-evidence.ts, test/support/host-live-reach.ts
- test/integration/host-live-timeline-helpers.test.ts
- test/cli/stdio-close.test.ts

Modified:

- test/support/host-live-session.ts (recorder extension, stderrFile, hashNames of the fake server)
- test/support/host-live.ts (command drive: warm control, evidence, reach, cold snapshot)
- test/support/host-live-kimi.ts (switch parsing, labels, plan and drive builders, probe helpers)
- test/integration/host-live-kimi.test.ts (production switches, control C1 evidence, expansion probe, writer probe)
- test/integration/host-live-kimi-helpers.test.ts (pins of the new switches and modules)

## What was built

- wire-timeline.ts: the constants (REPRO_MIN_VALID 3, REPRO_MAX_ATTEMPTS 5, REPRO_FAIL_THRESHOLD 2, STALL_MS 10000,
  FIXED_TIMEOUT_SPREAD 0.10, REACH_WINDOW_MS 60000, REACH_POLL_MS 2000, ABLATION_RUNS_PER_NAME 2, the three names in the order of the
  ablation), readWireTimeline, classifyToolsList (five classes, valid flag, L, G, sixTools, error code, child exit), reproductionOutcome
  and nextStep, attributeCause (rules 1 to 6 in order), ablationVerdict with the shared reach predicate, and the run record parsers.
  Pure except readWireTimeline. No message text is a field of any result; every reason text is a fixed sentence.
- wire-timeline-run.ts: reads a directory of run folders (wire.log, run.json, reach.json) and prints one JSON object. Usage:
  node dist/test/support/wire-timeline-run.js EVIDENCE_DIR. Exit 2 with one line when the directory cannot be read.
- Recorder (host-live-session.ts): a millisecond mark t on every line, error and errorCode on a response, meta on a request, invalid on a
  host line that is not a JSON-RPC 2.0 object, lifecycle lines child-start, host-stdin-end, host-signal (logged before it is forwarded)
  and child-exit. Optional stderrFile copies the target stderr to a file of mode 0600 while still forwarding it. The forward path is
  untouched; readWireLog and wireSummary are unchanged and skip the new lines.
- Evidence (host-live-evidence.ts): checkEvidenceDir (five distinct refusals, real path, never creates), writeRunEvidence (wire.log,
  command-stdout.txt, command-stderr.txt, server-stderr.txt, run.json, reach.json; files 0600, folder 0700; numbered folder per run),
  catalogueCodesIn (names from the catalogue only).
- Reach (host-live-reach.ts): observeReach with injected seams; a throwing seam is recorded by name per poll and never aborts.
- Kimi switches (host-live-kimi.ts, host-live-kimi.test.ts, host-live.ts): see the table below.
- Characterization (stdio-close.test.ts): see the result below.

## New environment names (read by the kimi test files only; the tests never set a gate variable)

| Name | Effect |
| --- | --- |
| REALM_LIVE_KIMI_RESTORE | Unset or empty: restore all three names (the Phase 43 default). none: restore nothing. A comma list of the three names: restore that subset (table order). Anything else fails the test with a message that names the allowed words and never echoes the value. Any value other than all three makes the run a diagnostic variant. |
| REALM_LIVE_KIMI_WARM | 1: bring the project session up and wait for the active state before the host command (the control C3). A diagnostic variant. |
| REALM_LIVE_EVIDENCE_DIR | An existing directory of mode 0700 outside the checkout. Each run of the production test and the validator session test (control C1) keeps its run folder there, written before any assertion. A refused directory fails the test with a reason sentence that holds no path. |
| REALM_LIVE_KIMI_PROBES | 1, in addition to the validator gate: runs the expansion probe and the writer probe. |

The run label is derived from the switches and starts with the words diagnostic variant for any variant; it is in the test title and the
diagnostics.

## Default production tier is unchanged

With none of the new names set the production test calls runHostProduction with exactly the Phase 43 drive: a command drive with the
arguments mcp test realm and the three restored names, and no warm, evidence or label member. Proved by the helper test "with none of the
new environment names set the production drive is exactly the Phase 43 one" (kimiProductionPlan and kimiProductionDrive are the pure
builder). The existing pins of host-live-session-helpers.test.ts and host-live-helpers.test.ts pass unedited, including the pin that the
production body never brings a session up: the warm control lives in a helper (warmControl) outside that body.

## Early-close characterization result

All five cases of test/cli/stdio-close.test.ts are green (no case failed, so there is no finding that selects Branch A of D-47-05):

1. all three frames in one chunk, input ended in the same turn, attach held: the initialize and tools/list replies are written (six tools),
   the process settles with exit 0;
2. tools/list sent, input ended, and only then the held attach fails: the reply was already written, the exit code equals
   exitCodeAfterClose(false, a failed outcome) from src/cli/stdio-settle.ts, no unhandled rejection;
3. a reader that holds each write 1500 ms with a one-byte high water mark: both replies handed over before the settle, in order, and they
   all arrive;
4. a reader that is destroyed after the first reply: the process settles, exit 0, no unhandled rejection, fixed-text diagnostics only;
5. a late frame after the input ended: never answered, nothing written after the settle, no diagnostic, no throw.

What it does not show: the bytes go to an in-memory stream and the process never exits, so a real pipe and a real process exit are not
exercised. A loss at process exit stays a hypothesis for the window.

## Checks run

| Command | Result |
| --- | --- |
| npx tsc -p tsconfig.json (full project, run twice, the last after every edit) | clean |
| node --test on wire-timeline, host-live-timeline-helpers, host-live-session-helpers, host-live-helpers, host-live-kimi-helpers, stdio-close, mcp-attach and stdio-cold-attach (compiled, under env -i) | 144 tests, 144 pass, 0 fail, 0 skipped |
| node --test dist/test/integration/host-live-kimi.test.js (no gate variable) | 5 tests, 0 pass, 0 fail, 5 skipped (each skip names the gate variable) |
| node --test on host-live-kimi-code, host-live-codex, host-live-muse, capability-live-enforce (no gate variable) | 11 tests, 0 pass, 0 fail, 11 skipped |
| the new test files and the kimi helper test as the unprivileged nobody user under env -i | pass |
| npm run lint (whole repository) | clean |
| node scripts/check/host-paths.mjs | ok |
| npm run check:docs | host paths ok, agents sync ok, default-mode ok |
| npm run check:gates | gate closure, module size, export usage (0 failing, 0 stale) and lockfile integrity: no violations |

## Deviations and interpretations

- The test of Task 1 and the module were written in one pass; the module-absent failing state was not observed separately.
- run.json holds the run record (label, restore names, variant flags, cold flag, elapsed milliseconds, returned flag, exit code, catalogue
  codes, optional control, optional list of members that failed to write). The reach polls are in reach.json, not run.json, as Task 3 lists
  the files; the runner reads both. The control a run stands for is an optional member of run.json (C3 is set by the warm switch, C1 by the
  validator session test).
- The control C2 comes from the existing cold attach test, which writes no run folder. The runner accepts a folder whose run.json names C2
  (answered when it returned with exit 0, duration the elapsed time); plan 47-02 writes that record by hand from the C2 run.
- The cold flag of a run is the snapshot taken before the run creates anything: no control socket of the scenario state directory (the
  stand-in for no daemon of the account), 0 containers, 0 Realm sandboxes and an empty workspace root; a failing listing is not cold.
- Attribution without a C1 run is UNDETERMINED (control C1 missing); a reproduction that did not reproduce, including VOID, gives
  NOT-ESTABLISHED. Rule 5 treats a failing run as a stall when L exceeds STALL_MS, or the response never came and the child was still alive
  at the request mark plus STALL_MS; the STACK verdict needs a C2 run answered within STALL_MS and at least one C3 run, all answered with
  the six names.
- The fixed client timeout of rule 4 is the rounded mean of the largest cluster of G values that agree within 10 percent of the larger value
  (at least two).
- Ablation, SA not reached: the per-name verdict is UNDETERMINED and the fallback records the catalogue codes seen in that name's minus-N
  runs and in no SA run (no catalogue code names a variable by itself, so the plan's wording is read this way).
- A host line is flagged invalid when it is not parseable JSON, not an object, or its jsonrpc member is not 2.0; the not-valid-JSON-RPC
  rule of attribution uses that flag.
- Evidence and reach code never masks a run failure: the reach observation records a failing seam by name, the writer names a member it
  could not write in run.json, and the drive catches anything else and only writes a diagnostic.
- The brief names a rule that no test basename contains mcp or acp, but the plan names test/cli/stdio-close.test.ts and the existing
  test/cli/mcp-attach.test.ts has the same shape. The plan name was kept; renaming is a one-line move if the rule applies.

## Next

Plan 47-02 runs the window. Its first commands, as the plan says: npm run build in the checkout, then the steps with the new variables set
by a person. Nothing in this plan starts a live step.

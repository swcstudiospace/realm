# Plan 39-01 Summary: the live proof of EXEC-01

Date: 2026-11-18. Commit: `34b6dd2` (the BASELINE tree of the live window: the proof, no watchdog).

## What was built

- `test/support/process-tree-probe.ts`: a read-only `/proc` probe that runs inside the sandbox as `node -e SCRIPT marker secondsList pgidList`. It lists the exec's tree by four rules (the unique marker in an argv, the exact sleeper argvs, a process group seen in flight, descendants by parent id), skips itself, its ancestors and pid 1, and reports pid, ppid, pgid, state, start time (stat field 22) and argv. It also exports the parser (`parseTreeListing`, which fails and never returns zero members for a malformed listing), the verdict (`judgeTree`, a zombie is dead but visible, identity is pid plus start time), the positive control (`controlsHold`) and `recordedGroups`.
- `test/integration/exec-kill-proof-helpers.test.ts`: the default-suite proof of the probe against fixtures and a real local process tree (live tree listed, probe excluded, killed tree dead, left-alive tree not dead, orphans found through the group rule, descendants through the parent rule).
- `test/integration/live-closeout.test.ts`: scenario C rewritten as the kill proof (sleeper `sleep 300` plus a background `sleep 301`, negative and positive controls, `TOOL_TIMEOUT` in 25 to 40 s, tree dead within 15 s of the reply and still dead 3 s later, at least 200 s of the sleeper's life left, then a usable session); scenario C2 (a `setsid` escapee is recorded, not asserted); scenario D (egress identity through the dispatcher, 1.1.1.1 on 443 allowed and 8.8.8.8 refused). No file under `src` changed.

## Deviations from the plan as written

- `controlsHold(flight, marker, seconds, escaped)` takes the marker and an `escaped` list (C2 needs the `setsid` sleeper present but allowed in another group); `recordedGroups`, `describeMember`, `describeMembers`, `holdsMarker` and `isSleeperOf` are extra exports.
- D allows only 1.1.1.1 on 443 (production live 3 also allows a host name; not needed here).
- Scenario C still asserts that `/usr/bin/timeout --version` exits 0 (written when the first fix used `timeout`). The final fix does not use `timeout`; the check is stale and harmless (the image has coreutils 9.1). Residual R2 of `39-VERIFICATION.md`.

## Checks run by the worker

`tsc` clean; `eslint` on the three files clean; the helper test 10 of 10 as a regular user with the timeout scale unset and at 3; the live file lists A, B, C, C2 and D as skipped, none failed, without the production gate; `host-paths` and `module-size` pass.

## Live result of this tree (baseline, window 1)

Closeout C failed at the death assertion as predicted: the controls held (a negative control with no member, the tree seen in flight at 821 ms, `TOOL_TIMEOUT` after 28204 ms) and then 3 members (the shell, `sleep 301`, `sleep 300`) were still running on every poll up to 15297 ms after the reply. Closeout C2 failed the same way; D passed. That failure is the survival evidence that confirmed finding F-3.

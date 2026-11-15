---
phase: 18-per-project-sandboxes
plan: 08
subsystem: cli
tags: [cli, selection, doctor, mcp, acp, policy-denied]
requires: ["18-05", "18-06"]
provides:
  - "realm doctor sends the selection of --workspace, and no params without it"
  - "test/cli/cli.test.ts asserts the selection each project command sends, the missing-path refusal and the POLICY_DENIED reply"
  - "test/cli/mcp-attach.test.ts asserts realm mcp and realm acp attach by selection and refuse an up reply that names another session"
affects: [src/cli/main.ts, test/cli/cli.test.ts, test/cli/mcp-attach.test.ts]
key-files:
  created: []
  modified:
    - src/cli/main.ts
    - test/cli/cli.test.ts
    - test/cli/mcp-attach.test.ts
decisions:
  - "doctor without --workspace sends no params, so the daemon reports its agent-OS reading as unbound (C4); with --workspace it sends selectionOf(workspace)"
  - "A missing workspace path is refused by selectionOf before any send, as POLICY_DENIED; the command sends no request"
requirements: [MULTI-02, MULTI-03]
metrics:
  tasks: 2
  commits: 1
  completed: 2026-11-15
plan_head_before: NOT RECORDED
commits: ["b42cb35"]
status: complete_read_only
---

# Phase 18 Plan 08: CLI behaviour on the selection, and its tests (MULTI-02, MULTI-03) Summary

The doctor command now carries the selection of its `--workspace`, and the CLI tests assert the selection that status, down, metrics, up, doctor, mcp and acp send. The code and the test cases are on main; this summary records that they exist and what they assert. It does not record that they pass: no test was run.

## Tasks

| Task | Name | Commit | Files | Status |
| ---- | ---- | ------ | ----- | ------ |
| T1 | doctor selection and the command tests | b42cb35 (audit fact) | src/cli/main.ts, test/cli/cli.test.ts | code and tests present (read); run NOT VERIFIED |
| T2 | realm mcp and realm acp attach by selection | b42cb35 (audit fact) | test/cli/mcp-attach.test.ts | cases present (read); run NOT VERIFIED |

Plan 05 had already moved the other call sites (`runUp`, `runDown`, `runMetrics`, `runStatus`, `runMcp`, `runAcp`, `ensureSharedDaemon`) to `selectionOf`. This plan added only the doctor change and the tests.

## What was added

- `src/cli/main.ts:473-477` (`runDoctor`): with no `--workspace`, the request is `{ id: 1, method: "doctor" }`; with one, it is `{ id: 1, method: "doctor", params: { selection: selectionOf(workspace) } }`. The call sits inside the existing `try`, so a `POLICY_DENIED` from `selectionOf` reaches `failureFor`.
- `src/daemon/client.ts:138-146` (`selectionOf`, not changed here): realpaths the workspace root and maps it to `sessionIdOfWorkspace`; a path that does not resolve throws `POLICY_DENIED` before any socket is opened.
- `src/daemon/client.ts:193` (`up`, not changed here): an `up` reply whose `sessionId` differs from the selection throws `SCHEMA_INVALID`.
- `test/cli/cli.test.ts:1010-1032`: `down`, `status` and `metrics` each send one request carrying `selectionOf(WORKSPACE)`, with no other method (plan T1 b, a, d in part).
- `test/cli/cli.test.ts:1034-1071`: with `--workspace WORKSPACE` run from `OTHER_WORKSPACE`, `status`, `down` and `metrics` send that selection, and `up` sends `params` equal to `{ workspaceRoot: WORKSPACE }` with no selection (T1 a, b, c, d).
- `test/cli/cli.test.ts:1073-1092`: `doctor` sends no params; `doctor --workspace` sends the selection (T1 e).
- `test/cli/cli.test.ts:1094-1110`: `status --workspace` of a missing directory exits 1, prints `POLICY_DENIED`, and the fake send records zero calls (T1 f).
- `test/cli/cli.test.ts:1112-1130`: a `POLICY_DENIED` reply to `status`, `metrics` or `down` (run with `OTHER_WORKSPACE`) prints the code, exits 1, and sends exactly one request (T1 g).
- `test/cli/mcp-attach.test.ts:220-254` (`realm mcp --workspace`) and `:256-289` (`realm acp --workspace`): `connect` is called with the control socket path and `selectionOf(WORKSPACE)`, and `up` is called once with no argument (T2 a, b).
- `test/cli/mcp-attach.test.ts:291-317`: a fake `connect` whose `up` rejects with `SCHEMA_INVALID`; the command exits 1, stderr starts with `SCHEMA_INVALID: `, stdout and the output stream are empty (T2 c, as a fake).

## Verification

Read-only checks in this pass (code and test text read; nothing executed):

- `src/cli/main.ts:473-477`: the doctor selection exactly as T1 specifies. VERIFIED (read).
- `src/daemon/client.ts:138-146` and `:193`: the derivation and the `up` mismatch check. VERIFIED (read).
- `test/cli/cli.test.ts:1010-1130` and `test/cli/mcp-attach.test.ts:220-317`: each named case is present and asserts the value the plan names. VERIFIED (read).

NOT VERIFIED:

- `npm run build && node --test dist/test/cli/cli.test.js`: not run (contract: no tests). A pass is not claimed.
- `npm run build && node --test dist/test/cli/mcp-attach.test.js`: not run. A pass is not claimed.
- Commit `b42cb35` as the commit for this plan: taken from the audit facts; not checked with git.
- Test (g) against a real policy root: the test uses `OTHER_WORKSPACE` with a fake daemon reply. It proves the CLI prints and stops on `POLICY_DENIED`; it does not read the fixture to confirm that `OTHER_WORKSPACE` lies outside every policy root.
- The stop rule of the plan (halt at the first failing check): not exercised, because no check was run.

## Deviations from Plan

**1. [Test coverage] T2 (c) drives a fake client, not the real mismatch check**
- The plan asks that a `status` reply inside `up` naming another session be refused by the client. `test/cli/mcp-attach.test.ts:291-317` replaces the client with a fake whose `up` rejects with `SCHEMA_INVALID`. The real check is at `src/daemon/client.ts:193`, which the test does not exercise. The test covers the CLI's handling of that code.

**2. [Requirement tags] Test titles and plan table disagree**
- The plan maps the doctor and selection-per-method assertions to MULTI-02 (T1) and MULTI-03 (T1, T2). Every case in `test/cli/cli.test.ts` is titled `MULTI-03`. Coverage is the same; the tags differ.

**Total deviations:** 2, both on test coverage or labelling; no source deviation from the plan.

## Behaviour change to carry forward

Per the plan (C4 of `docs/integration/runtime-decision.md`): `realm status`, `realm metrics` and `realm down` run outside every policy root report `POLICY_DENIED`, and so does the `tool` call that `realm mcp` and `realm acp` make on their attached client. Previously these reported the daemon's state. Plan 12 must record this. This summary does not check plan 12.

## Issues Encountered

None in the read-only pass. The plan's own reconciliation section says the call-site work of plan 05 is already on main; the cited lines agree.

## Known Stubs

None in the files read.

## Threat Flags

None. The selection is derived from the realpath of the workspace in `selectionOf`; the daemon's re-derivation and refusal of a mismatch belong to plan 06 and are outside this plan's files.

## Next Phase Readiness

Plans 10 (Omp surface) and 11 (surface tests) follow by wave. Plan 11 depends on the selection behaviour recorded here. Before relying on it, run the two verify commands in the plan; they have not been run. Plan 12 must carry the `POLICY_DENIED` behaviour change described above.

---
*Phase: 18-per-project-sandboxes*
*Summary written: 2026-11-15 (read-only; no tests run)*

## Self-Check: NOT RUN

Self-check of the test suite was not performed. Code and test presence were checked by reading the cited lines.

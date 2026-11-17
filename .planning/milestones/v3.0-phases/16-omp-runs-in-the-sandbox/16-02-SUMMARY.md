---
phase: 16
plan: 02
subsystem: test
tags: [omp, test, scripted-provider, guard, fail-closed, captures]
requires: ["16-01"]
provides:
  - "scripted provider exposes each request's tool-role results keyed by tool_call_id, and the tool schemas it offered"
  - "hermetic tests for the tool-result helper, the provider recording and the capture redaction and bound"
  - "gated O2 case: advisory to fail-closed in one session; registered write then read; model bash denied with POLICY_DENIED"
  - "C4 native patch CREATE asserts the next request's tool result by tool_call_id, with no snapshot tag"
affects: [test/support/scripted-provider.ts, test/support/omp-rpc.ts, test/integration/omp-live-helpers.test.ts, test/integration/omp-guard.test.ts]
key-files:
  created: []
  modified:
    - test/support/scripted-provider.ts
    - test/support/omp-rpc.ts
    - test/integration/omp-live-helpers.test.ts
    - test/integration/omp-guard.test.ts
  not-modified:
    - test/support/omp-profile.ts
decisions:
  - "Bounded capture and credential stripping live in omp-rpc.ts (redactCredentials, boundedCapture), not omp-profile.ts; the plan's file list named both"
  - "The fail-closed change is a daemon restart over the same state directory, then /realm-retry through the existing attach path"
requirements: [OMPX-02, OMPX-03, OMPX-04]
commits: [2af03b6]
status: complete-with-gaps
---

# Phase 16 Plan 02: actual Omp consumer controls (OMPX-02, OMPX-03, OMPX-04) Summary

Test support and the Omp guard suite now record the tool results and offered schemas the provider receives, and one gated case moves a session from advisory to fail-closed. Commit `2af03b6` is an ancestor of `origin/main` at `191293b`. This summary was written by reading the code on `origin/main`. No build, test, lint or typecheck was run for this summary, and the gated Omp cases were not run.

## Tasks

| Task | Name | Commit | Files | Status on origin/main |
| ---- | ---- | ------ | ----- | --------------------- |
| T1 | scripted provider exposes the tool results of its next request | 2af03b6 | test/support/scripted-provider.ts | code present; verify command not run |
| T2 | hermetic tests for the new helpers | 2af03b6 | test/integration/omp-live-helpers.test.ts | code present; verify command not run |
| T3 | guard suite: callable tools across a mode change, and model bash denial | 2af03b6 | test/integration/omp-guard.test.ts, test/support/omp-rpc.ts | code present; gated, not run; one assertion gap (see Deviations) |
| T4 | C4 native CREATE assertions, unchanged setup | 2af03b6 | test/integration/omp-guard.test.ts | code present; gated, not run |
| T5 | bounded capture of offered schemas, with no credentials | 2af03b6 | test/support/omp-profile.ts, test/support/omp-rpc.ts | **partial**: omp-rpc.ts side present; omp-profile.ts not changed |

## What was added

- `test/support/scripted-provider.ts`
  - `ChatMessage.toolCallId` (line 44) and `ToolResultRecord` (lines 49-56: `toolCallId`, `text`, `textTruncated`, `digests`, `json`).
  - `RecordedRequest.toolResults` and `RecordedRequest.toolSchemas` (lines 91, 93).
  - `readMessages` keeps `tool_call_id` (lines 190-204); `readToolSchemas` (lines 222-228).
  - `toolResultsOf` and the exported `toolResultsOfRequest` (lines 263-295). Text is clipped at `TOOL_RESULT_TEXT_LIMIT_BYTES` = 256 KiB (line 264). Digests are matched as `sha256=<hex>` or `"sha256":"<hex>"`. A body that is not an object, or that has no tool message, yields `[]`.
  - Recording in `#complete` (lines 486-487). The change is additive. The chunk sequence and C1 to C4 handling are not altered.
- `test/support/omp-rpc.ts`
  - `CAPTURE_LIMIT_BYTES` = 64 KiB (line 293).
  - `redactCredentials` (line 314) removes `authorization`, `apikey`, `token` and `secret` fields and `[name, value]` header pairs at any depth. Names are compared case-insensitively with `-` and `_` ignored.
  - `boundedCapture` (line 332) redacts, serialises, and clips with a marker that gives the full size.
- `test/integration/omp-live-helpers.test.ts` (lines 644-760): tests for `toolResultsOfRequest` (644, 678, 686, 696), the provider recording (712), `redactCredentials` (733) and `boundedCapture` (752). These are hermetic and need no Omp.
- `test/integration/omp-guard.test.ts`
  - Gated case `O2 advisory to fail-closed in one session` (lines 383-525), gated by `skip` at line 385 (`ompSkipReason`, the first missing prerequisite, which is `REALM_LIVE_OMP=1 is not set` when unset; see `test/support/omp-live.ts:222`).
  - Scripted turns `t3Turn` (lines 341-359): advisory issues `write` with content, then `read` with `maxBytes: T3_READ_LIMIT` (4096, line 334), then text. Fail-closed issues `bash`, then text.
  - Offered-set check against `FAIL_CLOSED_OFFERED` (line 337, asserted at 511).
  - `bash` assertions at lines 513-517: `POLICY_DENIED` matched (515); `Tool bash not found` must not appear (516); the refused command did not run (517).
  - Digest and byte checks for the registered write (455-456) and read (461-465), and the next-request carry of each result by `toolCallId` (469-477, 520-522).
  - C4 (lines 292-311): notice at 298, bytes on host at 302, next request's result found by `toolCallId` at 307-309 (replacing the former `toolResultText` comparison). No snapshot tag or Realm read is used for CREATE; `PI_EDIT_VARIANT: "patch"` is set only for the `edit` tool (line 183) and for the O2 child (line 415).
  - Captures in O2 go through `boundedCapture` (lines 419-435).
  - `boundedCapture` is also used by the existing cases at lines 192 and 646.
- Product code the assertions depend on, present on `origin/main` from `2e5e6c5` (O1): `src/omp/tools.ts:156-164` (read schema, `required: ["path", "maxBytes"]`); `src/omp/host-tools.ts:46` and `:105` (`POLICY_DENIED`); `src/omp/plugin.ts:382` (`POLICY_DENIED` mapping). This plan changes none of them.

## Verification

Checked by reading `origin/main` at `191293b`. Nothing was run.

| Scope | Check | Result |
|---|---|---|
| Ancestry | `2af03b6` and `2e5e6c5` are ancestors of `origin/main` | verified |
| Stat | `2af03b6` changes 4 files: guard 216, helpers 128, omp-rpc 52, scripted-provider 86; omp-profile.ts not in the stat | verified |
| T1 | code at scripted-provider.ts lines above | verified by reading |
| T2 | hermetic tests at omp-live-helpers.test.ts 644-760 | verified by reading; `npm run build && env -u REALM_LIVE_OMP node --test dist/test/integration/omp-live-helpers.test.js` **not run** |
| T3 | O2 case and assertions at omp-guard.test.ts 383-525 | verified by reading; skip path `node --test dist/test/integration/omp-guard.test.js` **not run** |
| T3 | "a registered write then read with a required maxBytes" | **partial**: the read call supplies `maxBytes`; no assertion checks that the offered read schema lists `maxBytes` as required (the product schema does, `src/omp/tools.ts:161`) |
| T4 | C4 at omp-guard.test.ts 292-311, no snapshot tag | verified by reading; gated, not run |
| T5 | bounded capture and redaction in omp-rpc.ts 290-340; used at omp-guard.test.ts 192, 425-428, 646 | verified by reading for omp-rpc.ts |
| T5 | omp-profile.ts changes | **NOT VERIFIED**: file is not changed by `2af03b6` |
| Live | O2 and C1 to C4b | written; not run (needs `REALM_LIVE_OMP=1`, the Omp binary and a Linux host). Nothing in this summary is live evidence |

## Deviations

1. **`test/support/omp-profile.ts` not changed** (T5). The plan listed it. The bounded capture and redaction were added to `omp-rpc.ts` instead, as also recorded in `16-SUMMARY.md` deviation 3.
2. **Schema `required` for `read` not asserted** (T3). The case calls `read` with `maxBytes` and checks the result. It does not assert the offered schema lists `maxBytes` as required. A one-line assertion on `captured.schemas` would close it; it is not added here because this unit is read-only.
3. **C4 assertion changed** (T4). The former check compared `toolResultText` (the last tool message) with the native result. It now finds the result by `toolCallId` through `toolResults`. The commit does not record a separate reason.

## Open items

- Run the three verify commands from the plan (T1/T2 hermetic; T3/T4/T5 skip path). These were not run here.
- Live cases O2, C1, C1b, C2, C3, C4, C4b are written and skipped without `REALM_LIVE_OMP=1`. They have not been run on this tree.
- The `maxBytes` schema-required assertion (Deviation 2) is open.

## Known Stubs

None.

## Threat Flags

None. The captures written by this plan pass through `redactCredentials` and `boundedCapture` before they are stored as evidence.

---
*Phase: 16-omp-runs-in-the-sandbox*
*Unit: O2 (plan 16-02), commit 2af03b6*

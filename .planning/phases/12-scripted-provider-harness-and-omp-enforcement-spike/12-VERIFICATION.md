---
phase: 12-scripted-provider-harness-and-omp-enforcement-spike
verified: 2026-11-12T09:13:03Z
status: gaps_found
score: 3/11 must-haves verified (6 present but live-unverified, 1 uncertain pending live measurement, 1 failed)
covered_files:
  - ".planning/REQUIREMENTS.md"
  - ".planning/phases/12-scripted-provider-harness-and-omp-enforcement-spike/12-01-PLAN.md"
  - ".planning/phases/12-scripted-provider-harness-and-omp-enforcement-spike/12-01-SUMMARY.md"
  - ".planning/phases/12-scripted-provider-harness-and-omp-enforcement-spike/12-02-PLAN.md"
  - ".planning/phases/12-scripted-provider-harness-and-omp-enforcement-spike/12-02-SUMMARY.md"
  - ".planning/phases/12-scripted-provider-harness-and-omp-enforcement-spike/12-03-PLAN.md"
  - ".planning/phases/12-scripted-provider-harness-and-omp-enforcement-spike/12-03-SUMMARY.md"
  - "docs/integration/omp-lifecycle-runbook.md"
  - "docs/integration/omp.md"
  - "docs/policy-reference.md"
  - "src/omp/plugin.ts"
  - "test/integration/omp-guard.test.ts"
  - "test/omp/plugin.test.ts"
covered_digest: "v4:sha256:8b53c3072540ddec23d9a88264046c596cf3db860c469ea8a11eb034f013fe1f"
behavior_unverified: 6
behavior_unverified_items:
  - truth: "C1: advisory, realm inactive, daemon reachable. The Realm write is forwarded, the warning shows on every call, and exact bytes land on the host"
    test: "npm run build, then REALM_LIVE_OMP=1 node --test --test-concurrency=1 dist/test/integration/omp-guard.test.js (case C1), with REALM_OMP_BIN set to the Omp being recorded"
    expected: "Two advisory notices, two successful writes, exact bytes on disk"
    why_human: "Needs a live Omp and a real daemon; offline registered-write unit test passes but does not drive Omp's model-issued call"
  - truth: "C1b: advisory, daemon unreachable. The Realm write is refused with REALM_NOT_ACTIVE and no host file is created"
    test: "Case C1b of omp-guard.test.js, live"
    expected: "isError true, REALM_NOT_ACTIVE, no file, no notice"
    why_human: "Live case authored, not run on the current source"
  - truth: "C2: fail-closed, realm down. The write is blocked with REALM_NOT_ACTIVE, no file, the next provider request carries the error"
    test: "Case C2 of omp-guard.test.js, live"
    expected: "Refusal with REALM_NOT_ACTIVE, no file, carried error in the next request"
    why_human: "The only pass is a 2026-10-30 user-reported run that predates the current source; not re-run"
  - truth: "C3: realm active. The write proceeds and the exact bytes land in the workspace"
    test: "Case C3 of omp-guard.test.js, live"
    expected: "isError false, file content equals the case name"
    why_human: "Only historical evidence exists; not re-run on the current source"
  - truth: "C4 and C4b: advisory native patch-mode edit CREATE. C4 (daemon reachable, realm inactive) is permitted and its result is carried; C4b (daemon down) is refused with REALM_NOT_ACTIVE with no file and no notice"
    test: "Cases C4 and C4b of omp-guard.test.js, live (REALM_LIVE_OMP=1, one run of the file)"
    expected: "C4: warning shown, exact bytes at the absent path, successful tool result carried. C4b: refusal, no file, no notice"
    why_human: "The C4 replacement is authored and not run; the 2026-10-31 C4 failure was a native snapshot tag problem, and C4b has no live record"
  - truth: "HARN-01: one gated command runs the harness against the built extension and a local Omp, passes, and records the Omp version"
    test: "Same live command as C1; read the recorded Omp version from the run output"
    expected: "All live cases pass; the version is recorded in the run output"
    why_human: "No passing run of the current source is recorded in the repository; REQUIREMENTS calls HARN-01 implemented-unverified"
uncertain_items:
  - truth: "HARN-03: a warm profile on the current build makes no connection beyond the stub and ports 11434, 8080 and 1234, with zero external and zero DNS"
    status: uncertain
    evidence: "docs/integration/omp.md records the default-configuration warm run as FAILED: 38 external plus 6 DNS (44 offenders) on 18.14.2, and 2 EINPROGRESS connects to 127.0.0.1:9931 on 18.16.0. The only pass uses the LLAMA_CPP_BASE_URL lever on 18.16.0 in a scripted proxied configuration, which the record itself says is not the default configuration. The installed Omp was not re-observed in this pass."
    owner_decision_needed: "(a) Run the built-Realm warm trace on the current source against the installed Omp and record the raw summary. (b) Rule whether port 9931 joins the allowlist, or whether the LLAMA_CPP_BASE_URL lever counts as passing the zero-offender acceptance."
---

# Phase 12: Scripted-provider harness and Omp enforcement spike - Verification

**Phase Goal:** A live Omp, driven by a scripted model provider with no credentials, shows what the Realm extension does with a model-issued `write` in each mode, and the extension API's enforcement limits are known and recorded.
**Verified:** 2026-11-12T09:13:03Z
**Status:** gaps_found
**Re-verification:** Yes. The prior report (gaps_found, 2 of 11, dated 2026-11-12T08:03:19Z) is superseded. Gap closure plans 12-02 (merge aae0e96) and 12-03 (merge d4a5e50) are in HEAD d4a5e50.

## Method and limits

- Read the PLAN, SUMMARY, REQUIREMENTS, and the phase-12 documentation. The 12-02 and 12-03 summaries were not trusted: each claim was checked against `src/omp/plugin.ts`, `test/omp/plugin.test.ts`, and `test/integration/omp-guard.test.ts`.
- Ran `node --test dist/test/omp/plugin.test.js` (the built output): 102 pass, 0 fail, 0 skipped. Ran `node --test --test-name-pattern=HARN-02 dist/test/omp/plugin.test.js`: 5 pass, 0 fail.
- Did not run any live Omp suite. `REALM_LIVE_OMP` and `REALM_LIVE_PRODUCTION` were not set. Live cases C1, C1b, C2, C3, C4, C4b and the HARN-03 warm run are treated as human items, not passes.
- Did not run `npm run build`, typecheck, or lint in this pass. The unit run used the existing `dist/` output.
- Did not edit any source, test, or `.planning` file other than this report. `.planning/REQUIREMENTS.md` was read and not changed.
- Omp version: the 18.18.8 reading from the prior report was not re-observed in this pass. Recorded evidence names Omp 18.12.6 (spike, OMP-05), 18.16.0 (HARN-03 lever run), and 18.18.1 (Realm tool-list observation). No run exists for the version currently on PATH.

## Goal Achievement

### Observable Truths

| # | Truth (source) | Status | Evidence |
| - | -------------- | ------ | -------- |
| 1 | HARN-01: one gated command runs the harness, passes, and records the Omp version | PRESENT_BEHAVIOR_UNVERIFIED | `test/integration/omp-guard.test.ts` and `omp-spike.test.ts` skip unless `REALM_LIVE_OMP=1` (`ompSkipReason`). No passing run of the current source is recorded in the repository. |
| 2 | C1: advisory, realm inactive, daemon reachable. The write is forwarded with the warning on every call and exact bytes land | PRESENT_BEHAVIOR_UNVERIFIED | Code: `callDaemon` notifies on `outcome.value.warning` (`src/omp/plugin.ts:667-669`). Offline: `HARN-02 C1: registered advisory write warns on every inactive invocation and writes exact host bytes` passes against a real `ToolDispatcher` (`test/omp/plugin.test.ts:1292-1310`). Live case (`omp-guard.test.ts:231-246`) not run. |
| 3 | C1b: advisory, daemon unreachable. The write is refused with REALM_NOT_ACTIVE and no host file | PRESENT_BEHAVIOR_UNVERIFIED | Code: the status-failure branch refuses an advisory Realm write through `unreadableVerdict` (`plugin.ts:761-767`, `845-848`). Offline: `HARN-02: registered advisory write refuses an unreachable daemon without host fallback` passes. Live case (`omp-guard.test.ts:248-260`) not run. |
| 4 | C2: fail-closed, realm down. The write is blocked with REALM_NOT_ACTIVE and no file | PRESENT_BEHAVIOR_UNVERIFIED | Offline: `HARN-02 C2` passes (`plugin.test.ts:1312-1320`). Live case (`omp-guard.test.ts:262-276`) not run; the only live pass is a 2026-10-30 user-reported record that predates the current source. |
| 5 | C3: realm active. The write proceeds and the exact bytes land | PRESENT_BEHAVIOR_UNVERIFIED | Live case (`omp-guard.test.ts:278-290`) present and gated. Only historical evidence. Not re-run. |
| 6 | C4 and C4b: advisory native patch-mode `edit` CREATE. C4 (daemon reachable, realm inactive) is permitted; C4b (daemon down) is refused with REALM_NOT_ACTIVE, no file, no notice | PRESENT_BEHAVIOR_UNVERIFIED | Guard code: `edit` is a `GUARDED_HOST_TOOLS` entry refused by `unreadableVerdict` when the status is unreadable (`plugin.ts:765-767`); the reachable-inactive case reaches `stateVerdict`, which advisory allows with a notice (`plugin.ts:858-860`). Live cases (`omp-guard.test.ts:292-325`) are authored; `docs/integration/omp.md` (around line 398) states C1, C1b, C4 and C4b are not run on the current source. |
| 7 | CR-01 fix: advisory with an unreadable status refuses guarded calls (host `edit`, Realm `write`) with the read's code | VERIFIED | Source: `unreadableVerdict` returns `{ block: true, reason: code }` in every mode (`src/omp/plugin.ts:845-848`). The Realm write reaches the daemon only when the last published mode is not advisory (`plugin.ts:761-764`). Tests pin the refusal: `plugin.test.ts:888-896` (OMP-05 d), `:1237-1248` (B9 / T6), `:1380` (P16 b), `:1590` (P16 lifecycle c), `:2173` and `:2200`. `node --test dist/test/omp/plugin.test.js`: 102 pass, 0 fail. The prior gap's defect no longer exists in source. |
| 8 | HARN-02 registered-write tests exist and run over the real dispatcher, pinned filesystem, lock table and audit | VERIFIED | `test/omp/plugin.test.ts:1258-1363`: `makeRegisteredWorkspace` builds a real `ToolDispatcher` over `bindRoot`, `LockTable`, `gateMutation` and a temp state directory. Only the daemon transport is a double. The five HARN-02 cases pass by name (`--test-name-pattern=HARN-02`: 5 pass, 0 fail). Mutation evidence in 12-03-SUMMARY.md was not re-run. |
| 9 | HARN-03: a warm profile on the current build with the default configuration makes no connection beyond the stub and ports 11434, 8080 and 1234, with zero external and zero DNS | UNCERTAIN | `docs/integration/omp.md` records the default warm run as FAILED (44 offenders: 38 external, 6 DNS, on 18.14.2) and a failure on loopback 127.0.0.1:9931 on 18.16.0. The only pass uses the `LLAMA_CPP_BASE_URL` lever in a proxied, scripted configuration. Owner ruling needed on the lever and port 9931. No current-source measurement exists. |
| 10 | OMPX-01: enforcement limits are known and recorded with the Omp version (registerTool reach, setActiveTools removal and enforcement, registerFileWriteFallback behaviour, OQ-P5-01 closed, OQ-P5-02 restated) | VERIFIED | `docs/integration/omp.md` enforcement-spike table (rows S1 to S10, VERIFIED_BY_EXECUTION) records Omp 18.12.6. `test/integration/omp-spike.test.ts` is gated and version-pinned to 18.12.6 (line 8). Caveat: the spike is recorded on 18.12.6 only; the spike is not re-run on the installed Omp. |
| 11 | Closure: OMP-05 and HARN-04 (and HARN-02) are recorded complete on current evidence, as the phase's own success criterion requires (current answered C1 to C4 and HARN-03 passes) | FAILED (BLOCKER) | `.planning/REQUIREMENTS.md` marks HARN-02 (`[x]`), HARN-04 (`[x]`) and OMP-05 (`[x]`) complete on the 2026-10-30 run (Omp 18.12.6, 3 of 3). `docs/integration/omp.md` (around line 398) and the 12-03 summary state that those receipts predate the 2026-11-12 ruling on an unreadable status, that C1, C1b, C4 and C4b are not run on the current source, and that no current pass is recorded for them. HARN-03 has no current pass either. The checkboxes contradict the phase's own records. |

**Score:** 3/11 truths verified (truths 7, 8, 10). Six are present, wired, and live-unverified (truths 1 to 6). One is uncertain pending a live measurement (truth 9). One fails (truth 11).

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| `src/omp/plugin.ts` | Guard, forwarding and advisory semantics | VERIFIED (exists, substantive, wired) | Contains the CR-01 fix (`plugin.ts:761-767`, `845-848`). 876 lines. Warnings WR-02, WR-03 and WR-04 remain (see Anti-Patterns). |
| `test/omp/plugin.test.ts` | Pins the CR-01 refusal and the HARN-02 registered-write tests | VERIFIED | 2342 lines. 102 unit tests pass. The HARN-02 tests use the real dispatcher. |
| `test/integration/omp-guard.test.ts` | C1, C1b, C2, C3, C4, C4b live cases | PRESENT_BEHAVIOR_UNVERIFIED | Gated. Eight cases skip without `REALM_LIVE_OMP=1` (the 12-03 run recorded this). Live cases are not run on the current source. |
| `test/integration/omp-spike.test.ts`, `test/support/omp-spike-extension.ts` | OMPX-01 spike | VERIFIED (exists, version-gated) | Spike results recorded for Omp 18.12.6. |
| `docs/integration/omp.md` | Version-stamped enforcement answers and the HARN-03 record | VERIFIED for OMPX-01; the HARN-03 section records a failed default run | Sections are internally consistent with the spike table. |
| `docs/integration/omp-lifecycle-runbook.md`, `docs/policy-reference.md` | Operator text for advisory and the guard cases | VERIFIED (text) | Describes the owner's 2026-11-12 ruling. |
| `.planning/REQUIREMENTS.md` | Requirement status | FAILED for the closure record (truth 11) | Read only. Not edited. |

### Key Link Verification

| From | To | Via | Status | Details |
| ---- | -- | --- | ------ | ------- |
| `guardHostToolCall` | `unreadableVerdict` | status-read failure, for the Realm write under advisory and for `edit` | WIRED, correct | `plugin.ts:761-767` refuses in advisory. Fail-closed passes the Realm write to the daemon, which decides. |
| `callDaemon` | `ToolDispatcher` write path | `client.call` (registered-write tests substitute `fixture.daemon.call` with `dispatcher.call`) | WIRED | `plugin.test.ts:1288`. Live path not exercised. |
| `callDaemon` warning | UI notify | `outcome.value.warning` at `plugin.ts:667-669` | WIRED (guarded by `!== null`, see WR-02) | Notice shown on each advisory write, asserted by HARN-02 C1. |
| `test/integration/omp-guard.test.ts` C4/C4b | native `edit` CREATE in the Omp child | `PI_EDIT_VARIANT=patch` in the Omp child | WIRED in code; not run | Live record absent. |

### Requirements Coverage

| Requirement | Source | Description | Status | Evidence |
| ----------- | ------ | ----------- | ------ | -------- |
| HARN-01 | ROADMAP phase 12 | Gated harness command with recorded Omp version | PRESENT_BEHAVIOR_UNVERIFIED | Truth 1. The record calls it implemented-unverified. |
| HARN-02 | Phase 12 IDs | Advisory with the realm down (notice and file), fail-closed refusal, realm active proceeds | PARTIAL: code and unit tests VERIFIED (truths 7, 8). Live half PRESENT_BEHAVIOR_UNVERIFIED (truths 2 to 5). `REQUIREMENTS.md` `[x]` is not supported by current-source live evidence. | Truths 2 to 5, 7, 8, 11. |
| HARN-03 | ROADMAP phase 12 | Warm-profile network capture with zero offenders | UNCERTAIN | Truth 9. No current default-configuration pass. Recorded default run failed. |
| HARN-04 | Phase 12 IDs | OMP-05 recorded complete with a scripted basis | FAILED for closure | Truth 11. The literal basis text ("scripted provider drove Omp's own write; not LLM-driven") is present in `REQUIREMENTS.md`, but closure is not supported on current evidence. |
| OMP-05 | Phase 5 row, closed by HARN-04 | Disconnected: report and apply the policy; never fall back silently to unsandboxed mutation | PARTIAL: the code path now refuses under advisory with an unreachable status (truth 7). Closure is the same as HARN-04 (truth 11). | Truths 7, 11. |
| OMPX-01 | ROADMAP phase 12 | Enforcement spike recorded with version | SATISFIED (on 18.12.6) | Truth 10. |

Orphaned requirements: none. Every ID that ROADMAP.md assigns to phase 12 is listed above.

### Anti-Patterns and Review Findings

Status of the 12-REVIEW.md findings, re-checked against HEAD d4a5e50:

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |
| `src/omp/plugin.ts` | 845-848 (CR-01) | Advisory allow on an unreadable status | RESOLVED | Fixed by 12-02 (commit 38d5778). |
| `test/omp/plugin.test.ts` | (absent HARN-02 tests) (WR-01) | Registered-write tests missing | RESOLVED | Present at HEAD (`:1258-1363`) and passing (commit bff9168). |
| `src/omp/plugin.ts` | 667 | Notify on `warning !== null` with no wire-shape check (WR-02) | WARNING (open) | An undefined or malformed warning is forwarded to the UI. Not in the gap-closure scope. |
| `src/omp/plugin.ts` | 774-780 | `setHostMode` throw refuses the Realm write with POLICY_DENIED and no notice or daemon call (WR-03) | WARNING (open) | Fails closed, so it is not a bypass. Breaks the advisory forwarding contract on that edge. |
| `src/omp/plugin.ts` | 656-663 | `AUDIT_OUTCOME_UNKNOWN` only when `onLinkLost` is set (WR-04) | WARNING (open) | With the default configuration, a write that may have landed is reported as a plain refusal. |
| `test/integration/omp-guard.test.ts` | 84-120, 229-244 | C1 uses an inactive-daemon helper (INFO) | INFO | The 12-01 summary's claim that C1 uses `daemon.down()` is stale; C1b does. |

Debt-marker gate: no TBD, FIXME or XXX in the phase-touched source, test, or doc files. PASS (the prior report's result, not re-run in this pass).

Probe execution: no probes are declared for this phase. Behavioral spot-checks: the offline plugin suite was run (102 pass). The live suites were not run, by instruction.

### Human Verification Required

These are the live and measurement items. They are not counted in the score and remain open even after the blocker below is resolved.

### 1. Gated live harness on the current source and the installed Omp

**Test:** `npm run build`, then `REALM_LIVE_OMP=1 REALM_OMP_BIN=<omp-bin> node --test --test-concurrency=1 dist/test/integration/omp-guard.test.js`
**Expected:** C1, C1b, C2, C3, C4 and C4b pass on the current source. The Omp version is recorded from the run.
**Why human:** Live Omp, a real daemon, and roughly 20 minutes of wall time.

### 2. C1 reachable-inactive advisory warning and bytes

**Test:** Confirm C1 shows the advisory notice on both writes and that the exact bytes `c1` are on disk.
**Expected:** Two notices and the exact bytes.
**Why human:** Live model-issued call through Omp.

### 3. C4 native CREATE and C4b native refusal

**Test:** Confirm C4 creates the exact bytes at the absent path with the realm inactive and the daemon reachable, and that C4b refuses with REALM_NOT_ACTIVE with no file and no notice when the daemon is down.
**Expected:** C4: one warning, exact bytes, successful result carried to the next provider request. C4b: `isError` true, REALM_NOT_ACTIVE, no file, no notice.
**Why human:** The C4 replacement was authored and has no live record. The C4b code is inferred from the channel analysis.

### 4. Historical C2 and C3 passes

**Test:** Decide whether the 2026-10-30 "user-reported" C2 and C3 passes count for the current source. They predate the current plugin changes.
**Expected:** Either re-run them (item 1) or record an explicit owner acceptance.
**Why human:** The evidence is outside the repository and predates the current source.

### 5. HARN-03 warm trace on the current build

**Test:** Run the warm built-Realm trace on the installed Omp and record the raw summary and version.
**Expected:** Zero external, zero DNS and zero offenders, with only the stub and ports 11434, 8080 and 1234 allowed.
**Why human:** Needs a live Omp. The owner must rule on the `LLAMA_CPP_BASE_URL` lever and on port 9931 before the result can be accepted.

### 6. Owner ruling on the timeout over-refusal (12-02 residual risk T-12-04)

**Test:** Confirm whether a slow but live daemon whose status read exceeds the 5 s guard budget should be refused under advisory (current code) or allowed.
**Expected:** An explicit owner decision recorded in the docs.
**Why human:** A policy decision, not a code check.

## Gaps Summary

One BLOCKER remains. The two prior code-level blockers are closed.

1. **Closure recorded without current evidence (truth 11, BLOCKER).** `.planning/REQUIREMENTS.md` marks HARN-02, HARN-04 and OMP-05 complete on the 2026-10-30 run. The phase's own records say that run predates the 2026-11-12 ruling and that no current pass exists for C1, C1b, C4, C4b or HARN-03. The owner should reopen these rows through a GSD command, or record an explicit acceptance of the historical receipts. This report did not edit `.planning/`.

Closed since the prior report:

- Truth 6 (CR-01): the advisory unreachable-status path refuses guarded calls in source, and the tests pin the refusal (`src/omp/plugin.ts:761-767, 845-848`).
- Truth 7 (registered-write tests): present at HEAD and passing over the real dispatcher (`test/omp/plugin.test.ts:1258-1363`).

Not closed (human or live items, in the Human Verification section): the live cases C1, C1b, C2, C3, C4 and C4b on the current source (truths 2 to 6), HARN-01 (truth 1), HARN-03 (truth 9), and the timeout over-refusal ruling. WR-02, WR-03 and WR-04 remain open warnings.

The spike goal (OMPX-01, truth 10) is achieved on its recorded Omp version and is the one fully verified part of the phase.

## check:docs

`npm run check:docs` was run before this report was written (exit 1; the prior report's own host-path line was the second hit).

Run after this report was written (exit 1). The only hit is:

```
.planning/phases/12-scripted-provider-harness-and-omp-enforcement-spike/12-03-SUMMARY.md:138:115: <host path>
```

This file contributes no hit. The remaining failure is a committed file (12-03-SUMMARY.md, commit 86ee9b9) that this pass may not edit. Fixing it needs a GSD-owned edit to that summary. The host-path scan fails until that line is changed.

---

_Verified: 2026-11-12T09:13:03Z_
_Verifier: Claude (gsd-verifier)_

---
phase: 12-scripted-provider-harness-and-omp-enforcement-spike
verified: 2026-11-14
status: passed
score: 11/11 must-haves verified
behavior_unverified: 0
covered_files:
  - ".planning/REQUIREMENTS.md"
  - ".planning/ROADMAP.md"
  - ".planning/phases/12-scripted-provider-harness-and-omp-enforcement-spike/12-01-PLAN.md"
  - ".planning/phases/12-scripted-provider-harness-and-omp-enforcement-spike/12-01-SUMMARY.md"
  - ".planning/phases/12-scripted-provider-harness-and-omp-enforcement-spike/12-02-SUMMARY.md"
  - ".planning/phases/12-scripted-provider-harness-and-omp-enforcement-spike/12-03-SUMMARY.md"
  - "docs/integration/omp.md"
  - "docs/integration/omp-lifecycle-runbook.md"
  - "docs/policy-reference.md"
  - "src/omp/plugin.ts"
  - "test/integration/omp-guard.test.ts"
  - "test/integration/omp-spike.test.ts"
  - "test/omp/plugin.test.ts"
  - "test/support/net-trace.ts"
  - "test/support/omp-live.ts"
  - "test/support/omp-rpc.ts"
  - "test/support/omp-spike-extension.ts"
  - "test/support/scripted-provider.ts"
covered_digest: "v3:sha256:45210b186b55af271bd327d3625c50fbd7598b8ca6a95e9817aaff65acb23d50"
---

# Phase 12: Scripted-provider harness and Omp enforcement spike: Re-verification at 06a3e40

**Phase Goal:** A live Omp, driven by a scripted model provider with no credentials, shows what the Realm extension does with a model-issued `write` in each mode, and the extension API's enforcement limits are known and recorded.

**verdict: passed.** Every roadmap success criterion for Phase 12 and every requirement in scope (HARN-01..04, OMPX-01, OMP-05) has evidence on `origin/main` 06a3e40. The two live items are confirmed by the evidence files below. HARN-03 passes on the owner's 2026-11-14 ruling accepting loopback port 9931. The residuals are the three accepted known gaps and informational notes. None blocks the verdict.

**Method.** Worktree `<tmp>` at `origin/main` 06a3e40, branch `gsd/phase-12-complete`. Static reads and greps of code and docs. Live evidence read from `<home>/realm-evidence/phase12/` (read-only). The prior report in this file was used as the must-have list (truths 1 to 11). No tests, builds, lint, typecheck, formatters or `check:docs` were run. Nothing was committed. This file is the only file written.

**Evidence identity.** The live runs used the built extension at `<home>/realm/l12-main/dist/src/omp/extension.js`. That tree is not a git checkout. Its `src/omp/*.ts`, `test/omp/*.ts`, `test/integration/omp-*.ts`, `test/support/omp-*.ts`, `test/support/net-trace.ts` and `test/support/scripted-provider.ts` are byte-identical to the 06a3e40 worktree (`cmp`, no differences). The live runs therefore exercise the current source for every file they touch.

## Live evidence (counts confirmed)

| File | Counts | Cases |
| --- | --- | --- |
| `<home>/realm-evidence/phase12/12-omp-guard.txt` | tests 8, pass 7, fail 0, skipped 1 | ok 1 C1; ok 2 C1b; ok 3 C2; ok 4 C3; ok 5 C4; ok 6 C4b; ok 7 O2; skip 8 = built-Realm warm HARN-03 case, skipped because `REALM_OMP_NET_TRACE` is not set. Omp `omp/18.20.0`. |
| `<home>/realm-evidence/phase12/12-omp-harn03-warm.txt` | tests 3, pass 2, skipped 1 | Top-level pass. Cold subtest skipped with reason "startup catalog refresh is outside the measured warm network claim". Warm subtest pass. Omp `omp/18.20.0`. Warm diagnostic: `0 external, 0 DNS; loopback ports 1234,8080,9931,11434,39631`. |

Port 39631 is the scripted stub. It is not one of the four discovery ports, and the warm subtest asserts the stub port is present, so it is the stub. This is deduced from the passing assertions; the file does not print it.

## Goal Achievement

### Must-haves

| # | Must-have (source) | Status | Evidence |
| - | ------------------ | ------ | -------- |
| 1 | HARN-01 and ROADMAP SC1: one gated command runs the harness against the built extension and a local Omp over RPC pipes, with no credentials, and records the Omp version | VERIFIED (live) | Guard run header records `omp/18.20.0` (`12-omp-guard.txt`). Launch args: `--mode rpc-ui --no-extensions -e <extension> --model stub/scripted --no-session` (`test/support/omp-rpc.ts:182`). The scripted provider needs no key or token (`test/support/scripted-provider.ts:1-2`). Gate: `REALM_LIVE_OMP=1` (`test/integration/omp-guard.test.ts:29-31`). Seven cases pass in one run. |
| 2 | HARN-02 C1: advisory, realm inactive, daemon reachable. The write is forwarded, the warning shows on each call, exact bytes land | VERIFIED (live) | Guard `ok 1 - C1` ("lands with the warning on every call"). Notice path: `callDaemon` notifies on `outcome.value.warning` (`src/omp/plugin.ts:683-684`). |
| 3 | HARN-02 C1b: advisory, daemon unreachable. The Realm write is refused with `REALM_NOT_ACTIVE`, no host file | VERIFIED (live) | Guard `ok 2 - C1b` ("refuses the Realm write with REALM_NOT_ACTIVE and creates no file"). Code: advisory write refused via `unreadableVerdict` (`src/omp/plugin.ts:783`, `861-864`). |
| 4 | HARN-02 C2: fail-closed, realm down. Blocked with `REALM_NOT_ACTIVE`, no file, error carried to the next request | VERIFIED (live) | Guard `ok 3 - C2`. Fail-closed passes the Realm write to the daemon, which refuses it (`plugin.ts`, the `session.mode !== "advisory"` branch in `guardHostToolCall`). |
| 5 | HARN-02 C3: realm active. The write proceeds; exact bytes land; offered tool list is the Phase 16 baseline | VERIFIED (live) | Guard `ok 4 - C3`. Offered tools logged: `ask, bash, exec, glob, grep, list, read, status, todo, wait, write`. |
| 6 | HARN-02 C4 and C4b: advisory native patch-mode `edit` CREATE. C4 (daemon reachable, realm inactive) permitted with result carried; C4b (daemon down) refused with `REALM_NOT_ACTIVE`, no file, no notice | VERIFIED (live) | Guard `ok 5 - C4` (`edit result: [c4-created.txt]`, file content `c4`). Guard `ok 6 - C4b` (refused, no file). `edit` is in `GUARDED_HOST_TOOLS` (`src/omp/plugin.ts:164`). |
| 7 | CR-01: advisory with an unreadable status refuses guarded calls (host `edit`, Realm `write`) with the read's code | VERIFIED | Source: `return unreadableVerdict(error)` for the Realm write and `GUARDED_HOST_TOOLS` in advisory (`src/omp/plugin.ts:782-783`); `unreadableVerdict` returns the error code (`:861-864`). Exercised live by C1b and C4b. |
| 8 | HARN-02 registered-write behaviour is covered over the real dispatcher | VERIFIED | Tests present at `test/omp/plugin.test.ts:1298` (C1 warn and exact bytes), `:1318` (C2 refusal, no host file), `:1347` (validation, path and conditional-write failures). Their behaviour is also exercised by the live C1, C1b and C2 runs above. The unit tests were not executed in this pass (contract: no tests run). |
| 9 | HARN-03 and ROADMAP SC3: warm profile makes no connection outside the stub, no DNS, no offender; cold profile reported as skipped with its reason | VERIFIED on the owner ruling 2026-11-14 | Warm subtest passes in `12-omp-harn03-warm.txt`: 0 external, 0 DNS, 0 offenders (assertions at `test/integration/omp-guard.test.ts:706-710`). Cold subtest skipped with the catalog-refresh reason. Allowlist is `defaultAllow(port)` (`omp-guard.test.ts:694`) = stub plus `OMP_DISCOVERY_PORTS = [11434, 8080, 1234, 9931]` (`test/support/net-trace.ts:46-50`). Port 9931 is accepted by the owner's ruling of 2026-11-14, under the 2026-11-11 decision recorded in `docs/integration/omp-lifecycle-runbook.md:129`. The ruling is the basis for treating HARN-03 as passed. |
| 10 | OMPX-01 and ROADMAP SC4: the enforcement limits are recorded with the Omp version: registerTool reach, `setActiveTools` removal and enforcement, `registerFileWriteFallback` behaviour, OQ-P5-01 closed, OQ-P5-02 restated | VERIFIED (docs; spike gated and version-pinned) | `docs/integration/omp.md` "Enforcement spike (OMPX-01, 2026-10-29, Omp 18.12.6)" (lines 242-275): S1 an extension tool under a built-in name replaces it and runs; S2a after `setActiveTools` a removed tool is refused at execution with `Tool <name> not found`, and the offered list follows; S5 `registerFileWriteFallback` is not a removal and not a redirect; "What does not work" states removal is not containment. OQ-P5-01 closed for 18.12.6 (line 35); OQ-P5-02 settled by observation (line 96). Spike test `test/integration/omp-spike.test.ts` is gated (`:23`). The spike is recorded on 18.12.6; the live guard and warm runs are on 18.20.0. |
| 11 | OMP-05 and HARN-04 and ROADMAP SC5: the OMP-05 row reads complete, and its basis states the run is scripted through Omp's own `write` and is not LLM-driven | VERIFIED | `.planning/REQUIREMENTS.md:229`: "Complete (2026-10-30, HARN-04, owner decision D2): scripted provider drove Omp 18.12.6's own write through the Realm plugin; not LLM-driven." The prior report's blocker (closure without current evidence) is answered: the current live guard run (C1 to C4b, Omp 18.20.0) and the warm HARN-03 pass are current scripted-provider evidence for the same basis. |

Roadmap success criteria SC1 to SC5 map to truths 1, 2 to 6, 9, 10 and 11 respectively.

Score: 11 of 11 must-haves verified.

### Requirements Coverage

| Requirement | Status | Evidence |
| ----------- | ------ | -------- |
| HARN-01 | SATISFIED | Truth 1 |
| HARN-02 | SATISFIED (superseded semantics, as REQUIREMENTS records) | Truths 2 to 6, 8 |
| HARN-03 | SATISFIED on the owner ruling | Truth 9 |
| HARN-04 | SATISFIED | Truth 11 |
| OMPX-01 | SATISFIED (Omp 18.12.6) | Truth 10 |
| OMP-05 | SATISFIED | Truth 11 |

The HARN-02 text carries the Phase 16 supersession: a disconnected registered Realm write refuses in advisory mode and creates no host file. C1b and C4b test that behaviour.

### Accepted known gaps (owner, 2026-11-14; do not block `passed`)

1. **T-12-04: 5 s status-timeout over-refusal.** `GUARD_STATUS_BUDGET_MS = 5_000` (`src/omp/plugin.ts:149`). `readStatus` rejects with `TOOL_TIMEOUT` (`:836-840`). Under advisory, a slow but live daemon whose status read exceeds the budget is refused.
2. **WR-02: unchecked warning shape.** `src/omp/plugin.ts:683-684` notifies on `outcome.value.warning !== null` with no wire-shape check. An undefined or malformed warning reaches the UI.
3. **WR-03: `setHostMode` throw refuses the Realm write without notice.** `src/omp/plugin.ts:790-796` returns `POLICY_DENIED` and paints no notice when `setHostMode` throws. This fails closed, so it is not a bypass. It breaks the advisory forwarding contract on that edge.

### Other residuals (informational; not blocking)

- **WR-04 is closed on main.** The prior report left it open. The current source throws `AUDIT_OUTCOME_UNKNOWN` for any delivered write or exec whose reply is lost, not only when `onLinkLost` is set (`src/omp/plugin.ts:678-679`). This follows `95494ab`. Not re-tested in this pass.
- **Stale wording, allowlist.** The guard case title "only the stub and three discovery ports" (`test/integration/omp-guard.test.ts`, warm case) and `.planning/REQUIREMENTS.md:22` ("three loopback discovery probes", stub plus 11434, 8080, 1234) predate the 9931 ruling. The code (`OMP_DISCOVERY_PORTS`, four entries) and the runbook (`docs/integration/omp-lifecycle-runbook.md:129`) are current. The ruling accepts this, so the wording should be aligned in a later docs pass.
- **Scope of the live evidence.** Both runs use a fake-backed daemon and a scripted provider. They are not production containment or an LLM-driven run, and the evidence says so (`omp-guard.test.ts` diagnostic, warm file header). The HARN-03 probe on Omp 18.15.0 is `.planning/phases/12-.../HARN-03-probe-18.15.0.md`.
- **Checkboxes are for the orchestrator.** `.planning/REQUIREMENTS.md:19-22` (HARN-01..04) and `.planning/ROADMAP.md:186` still show `[ ]`. This pass did not edit `.planning/` outside this report.

## Anti-Patterns and open items

- Not re-scanned in this pass beyond the sites cited above; the verdict does not rely on an anti-pattern scan.

## Verdict

verdict: passed

All five roadmap success criteria and HARN-01..04, OMPX-01 and OMP-05 have evidence on `origin/main` 06a3e40. The live items are confirmed by `12-omp-guard.txt` (7 of 8 pass; the 8th is the warm case skipped without the trace opt-in) and `12-omp-harn03-warm.txt` (HARN-03 warm pass). The only residuals are the three accepted known gaps and the informational notes above.

---

_Verified: 2026-11-14_
_Verifier: Claude (gsd-verifier)_

# Phase 16: Omp runs in the sandbox - Context

**Gathered:** 2026-10-31, recovery task `Trealm31-gsd-records`, correlation `ut-mvvowl70-29165019`.
**Status:** Context recovered from accepted decisions and scout1; implementation is partial, not verified by this records task. Independent plan checking and parent verification remain required.

<domain>
## Phase Boundary

OMPX-02..05: register the five frozen Realm tools, enforce the proved host policy in fail-closed mode, preserve advisory native tools except same-name read/write replacements, and prove real Omp writes through the production sandbox and audit. Depends on phase12 harness/spike and phase15 default/roots. This is not permission to repair HARN-03 in the first wave.
</domain>

<decisions>
## Implementation Decisions

### Binding accepted decisions

- D3 permits proved removal OR blocking. Keep the tool_call guard; do not claim process containment or subagent coverage from an offered-tool list. A removed bash returning Omp's native “Tool bash not found” is not the required Realm catalogue error. Implement/prove a supported guard path with a catalogue code while keeping unsafe host execution denied.
- Registration is unconditional. Realm read/write replace native read/write by name in both modes; this is the accepted OMPX-04 exception. Disconnected registered write never falls back to host mutation, including advisory. Native edit remains a distinct advisory host path.
- Preserve the frozen one-key ToolCall map, validation/locks/audit/state gate in the shared dispatcher; five tools exec/read/write/list/status, no glob, retry remains realm-retry. Do not reinterpret host intent metadata as a new tool contract.
- Reconcile actual active/registered sets even in the same mode. Publish mode only after setter/readback success. A deferred setter can mutate shared host state after timeout/shutdown/new session, so recheck generation/ownership after await and serialize corrective reconciliation; an early predicate cannot cancel it.
- Restore only currently registered names the extension actually owns removing, without reactivating independently disabled user tools. Preserve fail-closed behavior when status cannot be read or transition fails.
- Consumer read proof covers UTF-8 text plus byte/hash/truncation metadata for Uint8Array and serialized Buffer. Realm truncation describes daemon read completeness; Omp's independent spill/truncation can still shorten model-visible text.

### Evidence boundary

Current C1–C3 pass and C4 unissued-tag failure are supplied ground truth. C4 repair uses explicit native patch CREATE, not invented snapshot tags or a Realm read masquerading as native read. Historical Omp18.12.6 results stay historical. HARN-03 warm44 failure/cold skipped49/proxy0 external0DNS7 refused remain exactly as the recovery ledger records; no acceptance relaxation, current repair NOT QUEUED.

### Implementation discretion

Use existing session/attempt fences, host setter queue, tool outcome renderer, bounded daemon client and event-driven harness. Choose internal helper layout only within a later signed assignment. No new dependency or host confinement mechanism is implied.
</decisions>

<canonical_refs>
## Canonical References

- `.planning/REQUIREMENTS.md` OMPX-02..05; `.planning/MILESTONE-CONTEXT.md` D2–D4.
- `.planning/phases/12-scripted-provider-harness-and-omp-enforcement-spike/12-CONTEXT.md` and `12-RESEARCH.md` sections 4–5; retain historical evidence labels and apply current recovery supersession.
- `.planning/phases/15-zero-config-onboarding-and-fail-closed-default/15-CONTEXT.md`.
- `.planning/phases/RECOVERY-2026-10-31.md` scout1 mapping, P12/P16 and first-wave boundaries.
- `docs/integration/omp.md`, `docs/integration/omp-lifecycle-runbook.md`; upstream scout1 report is source-reading evidence, not a fresh run.
</canonical_refs>

<code_context>
## Existing Code Insights

`src/omp/plugin.ts` already registers tools, queues host transitions and attaches to a daemon; `src/omp/tools.ts` already maps frozen calls/results and reads. Reuse rather than reimplement. Missing behaviors are lifetime correctness, successful-read tests and a genuine production Omp path. `test/support/realm-daemon-fixture.ts` uses FakeExecutionService/FakeBridge: its host-file assertion is not sandbox proof. Reuse production-live gating, account lock, sandboxExec and actual audit files for OMPX-05. Phase18 later migrates session selection on every call, not only up.
</code_context>

<specifics>
## Specific Evidence Required

Parent P16: same-mode drift, failed restore plus daemon loss, deferred setter timeout/retry/shutdown/new session, disappearance/manual deactivation, catalogue bash result; read wire/text/digest cases. Doubly gated actual Omp→daemon→driver→OpenShell→Podman write must have identical host-root and sandbox `/workspace` bytes, container identity and actual paired admission/result entries. Scripted-provider evidence is not LLM-driven. Neither fake production nor helper-only success closes OMPX-05.
</specifics>

<deferred>
## Deferred Ideas

No new product scope. UI-01 remains an owner-excluded limitation. Per-project binding is phase18, not an implicit addition to first-wave Omp ownership. HARN-03 follow-up needs supported signed handover/assignment before editing. Parent alone runs the tests; no SUMMARY or VERIFICATION pass is authored here.
</deferred>

## Decisions added 2026-11-01

Owner decisions in force: no live window is approved; no push, pull request, merge or release; draft PRs #46 and #47 are not touched. The owner's Phase 12 waiver (run record in STATE.md, 2026-11-01) applies: Phase 16 starts with its Phase 12 dependency waived. HARN-03 stays FAILED and is not repaired here.

### P16-D1 Placement: O4 is a unit of Phase 16, not a new phase

The bounded re-attach unit (O4) is a unit of Phase 16. Rationale: re-attach changes the Omp plugin's attach and retry lifecycle in `src/omp/plugin.ts`, the same module that O1 owns and that OMPX-02..05 already cover. A separate phase would need a ROADMAP entry and would split ownership of one file across two phases. The spec asks for existing state names, so no phase-level vocabulary is added.

### P16-D2 Sequencing: Phase 16 starts after Phase 15 PR A, PR B and PR C

The owner's instruction named PR A and PR B. O1's recovery entry condition (RECOVERY-2026-10-31, the O1 entry text) names Phase 15's init and doctor checks. Those are PR C units (ONB-01 and ONB-02), so the plan gates on PR C as well. This is a superset of the instruction. Removing the PR C gate is an owner call and is listed under open questions.

Reasons for the file-level order: PR A edits `src/omp/plugin.ts` comments and `test/omp/plugin.test.ts`; PR B edits `src/omp/extension.ts` and `test/support/production-live.ts`. Both sets are shared with Phase 16 units.

### P16-D3 Wave structure and file ownership

| Wave | Plan | Unit | Depends on | Owned files | Autonomous |
|---|---|---|---|---|---|
| 1 | 16-01 | O1 host-tool policy, lifetime, registered results | external gates PR A, PR B, PR C, wave1-quality | src/omp/plugin.ts, src/omp/tools.ts, test/omp/plugin.test.ts, test/omp/tools.test.ts | yes |
| 2 | 16-02 | O2 consumer controls | 16-01 | test/integration/omp-guard.test.ts, test/support/scripted-provider.ts, test/support/omp-rpc.ts, test/support/omp-profile.ts, test/integration/omp-live-helpers.test.ts | yes (live case gated, not run) |
| 2 | 16-04 | O4 bounded re-attach | 16-01 | src/omp/plugin.ts, test/omp/plugin.test.ts, src/omp/extension.ts, test/omp/extension.test.ts | yes |
| 3 | 16-03 | O3 production OMPX-05 acceptance | 16-02, external gates | test/integration/production-driver.test.ts, test/support/production-live.ts, test/integration/production-live-helpers.test.ts, test/integration/omp-guard.test.ts | NO, human-needed |

No two units in one wave share a file. Wave 2 is O2 plus O4, which are disjoint. O4 shares `src/omp/plugin.ts` with O1, so it runs in a later wave. O3 shares `test/integration/omp-guard.test.ts` with O2, so it runs in a later wave. The recovery DAG also serializes O3 with the other production-acceptance owners (Phases 15, 17, 18 and 19).

### P16-D4 O3 is human-needed and not executed

OMPX-05 needs a live window that the owner has not approved. Plan 16-03 keeps its offline helpers as executable tasks and records the live step as a checkpoint for the owner. No task of 16-03 sets a live opt-in.

### P16-D5 Fail-closed bash is guard-blocked, not removed

D3 requires a catalogue code for a model-issued `bash` call. Removal makes Omp refuse the call before the hook runs, which gives the native text "Tool bash not found". So the plan keeps `bash` active in fail-closed mode and lets the tool_call backstop refuse it with `POLICY_DENIED`. The other built-ins stay removed. This trades enforcement strength for the catalogue code. The hook does not cover every host path (OQ-P5-02), so status text and docs must describe fail-closed as a guard for `bash`, not as containment. Owner confirmation of this trade is listed under open questions.

### P16-D6 O4 defaults, mapping and configuration (design register, reversible under C3)

- Defaults: retry cap 8; equal jitter; base 1 s; cap 60 s; per-attempt attach budget is the existing startup budget; the status poll (5 s bound, 2 s interval) is the liveness check.
- Configuration key: environment variable `REALM_OMP_REATTACH`, read only at the extension edge. Unset or `0` keeps current behaviour. `1` enables. Any other value fails at load. The default stays off until the owner's live validation is recorded.
- Status mapping onto the existing six states: UNCONFIGURED to `unbound`; CONNECTING to `connecting`; CONNECTED to `active`; DEGRADED to `degraded`; RECONNECTING to `connecting` with a host-side sub-state (the frozen state table has no wait state, so none is added); FAILED to `error` with the catalogue code and an action notify; DISABLED is the flag-off behaviour. HANDSHAKING has no counterpart in the control protocol.
- In-flight Realm `write` or `exec` that loses the link reports `AUDIT_OUTCOME_UNKNOWN` and is not retried by the plugin (spec question q6). Read-only calls keep their codes.
- Host tool behaviour during a loss follows the mode last published (spec question q2): advisory warns and lets `edit` through; fail-closed blocks it.

### Open questions for the owner

1. PR C gate (P16-D2): keep it, or start Phase 16 on PR A and PR B alone as instructed?
2. Fail-closed `bash` (P16-D5): accept a guard-blocked `bash` in place of removal?
3. Handshake, protocol version and credential: the spec requires them, but the control protocol has none (`src/daemon/channel.ts`). Under the spec's rule this is a BLOCKER for the handshake portion. Confirm that the directory and file modes on the socket are the accepted authentication, or name the contract.
4. In-flight control requests cannot be aborted on shutdown, because `sendRequest` has no abort signal. Accept the `CONTROL_TIMEOUT_MS` bound, or allow a change to `src/daemon/channel.ts` in a later unit.
5. Re-attach attempt budget: O4 reuses the 200 s startup budget per attempt. Confirm, or request a shorter per-attempt bound.
6. O4 added ownership of `test/omp/extension.test.ts` because the edge changes. Confirm.
7. The Phase 16 `Plans:` line in ROADMAP.md still lists the unified 16-01 plan. Update it to the four plans; ROADMAP.md is not owned by this unit.
8. Live validation for the re-attach default (spec LIVE_VALIDATION) is pending in STATE.md and is not requested by this unit.

The earlier recovery text in 16-01-PLAN.md is superseded by the four plans. Its history is at commit 1fa69c1. The overlays it carried are superseded under owner decision 2.

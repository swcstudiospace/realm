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

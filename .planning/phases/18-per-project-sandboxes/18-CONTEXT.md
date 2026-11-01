# Phase 18: Per-project sandboxes - Context

**Gathered:** 2026-10-31, task `Trealm31-gsd-records`, correlation `ut-mvvowl70-29165019`.
**Status:** Accepted-context recovery; substantial runtime implementation missing. No new acceptance/approval is inferred. Plan checker and parent verification not run in this edit-only wave.

<domain>
## Phase Boundary

MULTI-01..06: one daemon owns a separate pinned session, sandbox, audit, lock table and status per canonical policy-contained project, transports that selection to the actual driver mount, preserves other sessions on local down and bounds aggregate CPU/memory. Phase17 precedes it; PRD-DRV-01 is handled only as this phase needs.
</domain>

<decisions>
## Implementation Decisions

### Already accepted, not questions to reopen

D5(i), recorded 2026-10-30 in `docs/integration/runtime-decision.md` and retained PR36 chronology, supersedes one session per daemon. Canonical workspace path determines deterministic id; sandbox `realm-<sessionId>`; per-session state and local down; single daemon owns stateDir. No new catalogue code. “Decision recorded” is not “runtime implemented.”

### Contract details to pin before dependent code

- Reuse bindWorkspaceUnderPolicy for eligibility, then exact dev/ino/realpath verification on every selected-project use. Do not weaken verifyPinnedAt to merely check descendants. Existing helper includes root equality as well as descendants; contract owner must state that interpretation explicitly, not silently change access.
- Gateway sandbox maximum is 19 characters; `realm-` leaves 13 for the session id. Choose/document canonical hash encoding and reject collisions against persisted canonical workspace. Never use an unchecked truncated id to reuse another project's container.
- Every stateless control connection carries explicit selection (up/status/tool/down/metrics and each client/surface). An up-only workspace and global implicit tool session are insufficient. Client.close detaches transport; session down removes only that project; daemon signal shutdown is distinct.
- Transport must authoritatively resolve the selected project through OpenShell/gateway workspace identity to compute-driver mount. A caller-controlled arbitrary host path is not a trusted mapping. No fallback container or relaxed global-root equality.
- Aggregate admission reserves before awaits; count in-flight and adopted sessions and containers whose removal is not yet proven; release only after proven removal. Existing 1GiB/2CPU per-container caps are not an aggregate budget. RuntimeConfig has no aggregate knob in scout3: contract owner must record a precise supported derivation using existing configuration, or a narrowly justified D5 contract change before code; no invented preexisting setting or new catalogue code.
- Preserve valid persisted records. Any unavoidable legacy daemon-id/record conversion requires a recorded, narrowly necessary migration decision, matching callers/tests/docs, not a shim or silent deletion.
- Maintenance audit attribution cannot keep a fabricated global daemon session once sessions are selected; record ownership/attribution and startup sequencing with phase19.

### Implementation discretion

Reuse per-id stores/audit paths, per-handle controllers/dispatchers/locks, current bounded transport and hardening verification. Final names/layout belong to a signed contract unit, not an ad hoc second registry. D5 decisions already authorize the behavior; unresolved transport/resource details require engineering evidence, not a repeated user approval question.
</decisions>

<canonical_refs>
## Canonical References

- `.planning/REQUIREMENTS.md` MULTI-01..06; `.planning/MILESTONE-CONTEXT.md` D5.
- `docs/integration/runtime-decision.md` “Per-project sessions” and “Startup reaper and scratch volume”; `docs/integration/openshell.md` supported transport.
- `.planning/phases/17-observability-and-tamper-evident-audit/17-CONTEXT.md` and `17-01-PLAN.md`.
- `.planning/phases/RECOVERY-2026-10-31.md` scout3, full 52-ID matrix, P18/P19 and allocation discrepancies.
</canonical_refs>

<code_context>
## Existing Code Insights

Scout3: daemon main fixes SESSION_ID to daemon; daemon owns one handle and down closes server. compose binds config.workspaceRoot before up. Store/audit already accept per-id paths and each handle already owns locks/controller/dispatcher. Driver currently validates gateway workspace token without resolving a project and always mounts config.workspaceRoot; global rootReserved is not aggregate admission. Reuse these seams, migrate all CLI/Omp/MCP/ACP/ensure/driver callers, and remove superseded fixed-global paths in a coordinated cutover.

Discovered actual driver files include `compute-driver.ts`, `server.ts`, `lifecycle.ts`, not proposed `service.ts`. Test is `test/runtime/driver/driver-service.test.ts`; `test/fs/root.test.ts` exists. The proposed `test/runtime/openshell.test.ts` does not exist: existing OpenShell tests are split into argv/create-poll/memory/policy/routing files. A01 corrects any future signed ownership mismatch before editing; this context is not such authority.
</code_context>

<specifics>
## Required Consumer Proof

P18: A/B have distinct inspected mount sources and same-name bytes, write in A is not visible in B, down A leaves B active and control socket usable. Unit proof includes canonical aliases, nested project, outside-root POLICY_DENIED before runtime I/O, exact-pin rename/swap refusal, deterministic collision refusal and per-session status/audit/locks. Concurrent creates and restart-adopted sessions must obey the same resource bound; failed removal never releases a live commitment.
</specifics>

<deferred>
## Deferred Ideas

No cloud/multitenant/cross-session leases or per-subagent redesign. Wider PRD-DRV-01 amendment remains owner-open. Adoption/scratch/checkpoints are phase19 but depend on these explicit identities. No product execution or live probe is performed in this records wave.
</deferred>

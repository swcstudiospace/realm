# Phase 19: Resume and checkpoint - Context

**Gathered:** 2026-10-31, task `Trealm31-gsd-records`, correlation `ut-mvvowl70-29165019`.
**Status:** Accepted decisions recovered; adoption, scratch and checkpoints remain missing implementation/live-gated. No parent verification or independent checker run in this edit-only assignment.

<domain>
## Phase Boundary

RES-01..05: re-adopt verified recorded survivors before serving, remove/prove all others gone, preserve session-owned persistent scratch across restart and remove it on down, and snapshot/restore a project byte-for-byte using a mechanism chosen from an actual filesystem spike. Depends on phase18 project identity and phase14 bounded maintenance/reconciliation. No fallback containers or “keep everything” adoption.
</domain>

<decisions>
## Implementation Decisions

### Already accepted D5(ii/iii), recorded before code

- `docs/integration/runtime-decision.md` dated2026-10-30 defines adopted = matching session record/id/container, running, full create-time hardening verification. Before serving every Realm container is adopted or proven removed; unknown removal aborts startup. Adopt-only start has no destructive-startup notice; adoptions/removals/causes and record deletions are logged.
- Startup adoption is inside reap before controller/dispatcher composition, followed by existing bounded orphan sweep/audit reconciliation/report/openGate semantics. Align older proposal phrasing with this later explicit decision, do not create a second ordering. Driver startup independently destroys containers/secrets today: both driver and daemon ownership paths must migrate coherently.
- Exact accepted scratch name `realm-scratch-<sessionId>`, rw `/scratch`, session-owned. Preserve the three existing workspace/state/channel binds and existing tmpfs hardening; verifier admits exactly those three binds plus this one volume. Add `/scratch` policy, actual mount and exact verifier together.
- Down removes sandbox before volume and proves listing absence. Startup removes unreferenced session scratch after record/container reconciliation, proves removal, logs cause; failed proof aborts start. Do not indiscriminately keep secrets or volumes.

### Contract alignment before code

Actual containers use `openshell.managed`/`openshell.ai/sandbox-name`, while the earlier decision text speaks io.realm labels. Phase18 contract alignment must retain complete discovery of existing containers and record/session matching. Reconstruct driver registry/supervisors and retain only validated channel/state/launch artifacts; preserving a SessionRecord alone cannot restore health or active status. Create and adopt use one verifier, including OCI/proc/kernel-capability evidence, not weaker inspect-only acceptance.

### Snapshot mechanism and consistency

No copy/reflink/filesystem-snapshot outcome has been established. Parent must perform a target-filesystem spike, capture supported behavior/failures and record the selected mechanism before dependent checkpoint implementation. Reflink or atomic whole-tree restore is NOT presumed. The contract includes byte/metadata coverage, extra/deleted files, bounded storage outside writable workspace, pin/ownership/symlink constraints, failure rollback and quiescence against in-container writers; dispatcher locks alone cannot freeze arbitrary workload writes. Do not pick a fake success or omit the live roundtrip because the spike is pending.

### Implementation discretion

Reuse shared hardening/create evidence, typed libpod APIs and route table, session stores/pins, controller fences and startup gate. Internal helper choices need no new catalogue/dependency. A narrowly necessary schema/migration change requires its D5 reason recorded before code and every caller/test updated, not a compatibility shim.
</decisions>

<canonical_refs>
## Canonical References

- `.planning/REQUIREMENTS.md` RES-01..05; `.planning/MILESTONE-CONTEXT.md` D5.
- `docs/integration/runtime-decision.md` “Startup reaper and scratch volume”, including OQ-P19-01..03, full mount/policy/lifetime/no-orphan rules.
- `.planning/phases/18-per-project-sandboxes/18-CONTEXT.md` and `18-01-PLAN.md` for selected identity, driver transport, resource accounting and additional signed allocations.
- `.planning/phases/14-crash-safety-pack/14-CONTEXT.md`, `14-01-PLAN.md`; phase17 chain/correlation decisions.
- `.planning/phases/RECOVERY-2026-10-31.md` scout3 matrix, P19 and historical-vs-current proof rules.
</canonical_refs>

<code_context>
## Existing Code Insights

Scout3: reapStartup sweeps/deletes every record, driver lifecycle separately deletes containers/secrets, controllers initialize unbound and compose before maintenance. Current libpod spec/routes have no volume API; hardening requires exactly three binds and policy lacks `/scratch`. No workspace checkpoint command/service exists. Reuse per-id storage, exact pins, full create-time verifier/evidence, proven-removal sweep, per-session AgentOS supervisors; do not reconstruct already implemented phase14/17 libraries.
</code_context>

<specifics>
## Required Production Evidence

Historical SIGKILL followed by replacement and tmp scratch loss is the old destructive behavior, not RES acceptance. P19 requires same container ids and workspace hashes/no duplicate after daemon restart, validated driver restart survival, rejected/no-record cleanup, exact scratch inspection/persistence/down removal and full snapshot/restore bytes including deletes/extras. Preserve live prerequisites and account-wide serialization. A source file, fake record hydration or created snapshot filename is not proof.
</specifics>

<deferred>
## Deferred Ideas

No filesystem mechanism selected without the spike; no cloud snapshots or cross-project copy; no arbitrary extra mount. FS-02 remains owner-excluded. No service mutation, snapshot test execution or production acceptance occurs in this first records wave.
</deferred>

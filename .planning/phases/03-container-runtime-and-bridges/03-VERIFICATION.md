---
phase: 03-container-runtime-and-bridges
verified: 2026-10-21T00:00:00Z
status: passed_with_gated_live_items
score: 10/10 must-haves unit-verified, 5/10 with live-gated parts
---

# Phase 3: Container Runtime and Bridges — Verification Report

**Phase Goal:** Realm runs a rootless, hardened Podman container with OpenShell
and AgentOS, reaches Anda through the bridge, and gates file-mutating tools
through the lifecycle controller.
**Verified:** 2026-10-21
**Status:** passed_with_gated_live_items (unit-verified, live-gated; no live
container, OpenShell sandbox, AgentOS run, or Anda RPC is claimed — host runs
Podman 4.9.3, below the 5.x OpenShell's Podman driver requires)

## Goal Achievement

### Observable Truths

| # | Truth (Roadmap SC) | Status | Evidence |
|---|--------------------|--------|----------|
| 1 | Non-active mutation returns structured error (required), warns (advisory), never hangs | ✓ unit-VERIFIED | `src/lifecycle/mutation-gate.ts` wraps frozen `decideMutation` (`proceed`/`proceed-with-warning`/`refused`+code); `test/lifecycle/mutation-gate.test.ts`; bridge wiring `test/lifecycle/bridge-states.test.ts` |
| 2 | Probe reports `PODMAN_MISSING`/`PODMAN_MACHINE_DOWN` w/ reason; running container is rootless, digest-pinned, non-privileged, caps dropped, read-only root + tmpfs, CPU/mem/PID limits, workspace+state mounts only | ✓ unit-VERIFIED, live GATED | `src/runtime/podman-probe.ts`, `src/runtime/config.ts`, `src/runtime/hardening.ts` (`HARDENING_PROFILE` + `verifyInspect`: rootless, `capDrop ALL`, `capAdd []`, `no-new-privileges`, read-only root, mounts); `test/runtime/{podman-probe,config,hardening}.test.ts`; fail-closed destroy + `OPENSHELL_START_FAILED` in `src/runtime/session-execution.ts` (`test/runtime/session-execution.test.ts`). RT-01 wording superseded by S-08/D-47: the container is the OpenShell-driver-created session sandbox, recorded in `docs/integration/runtime-decision.md` |
| 3 | All agent execution through OpenShell in-container; AgentOS only via supported API, bounded-backoff restart, `AGENTOS_CRASH_LOOP` at max | ✓ unit-VERIFIED, live GATED | `src/runtime/openshell.ts` (pinned argv, deny-all policy doc, idempotent create keyed by session) + `test/runtime/openshell-{argv,policy,routing}.test.ts` (routing proves no bypass; closed libpod client has exactly 5 methods, no exec/attach/start — `src/runtime/libpod-{client,routes}.ts`); `src/runtime/agentos.ts` supervisor (500ms/8000ms+jitter, 5th failure holds + `AGENTOS_CRASH_LOOP`, 60s-alive reset) + `test/runtime/agentos-supervisor.test.ts` vs `test/support/fake-agentos.ts`. RT-03 wording superseded by S-08/D-46 (gateway on host). No concrete driver bound (OQ-P3-05/06): e2e session start is a missing prerequisite, not a gap |
| 4 | Anda client handshakes; mismatch → `ANDA_VERSION_MISMATCH`; unreachable → `ANDA_UNREACHABLE` + degraded + bounded backoff+jitter retry; boundary in `anda-decision.md` | ✓ unit-VERIFIED, live GATED | `src/anda/client.ts` (sticky mismatch, per-attempt timers, `computeBackoffDelayMs` from `src/core/backoff.ts`) + `src/anda/shape.ts`; `test/anda/{handshake,reconnect,boundary-decision,no-shim}.test.ts`; `test/lifecycle/bridge-retry.test.ts` (degraded + background retry); `docs/integration/anda-decision.md`. ANDA-02 accepted as shape check (no documented version surface) |
| 5 | `realm down` removes every realm-labelled container, state → disconnected, zero orphans; Podman-gated suites skip with stated reason on <5.x | ✓ unit-VERIFIED, live GATED | `test/runtime/down-sweep.test.ts` (label sweep via fake libpod); `test/integration/podman-gate.test.ts` (4 tests skip: "Podman 4.9.3 detected; OpenShell requires Podman 5.x; `PODMAN_UNSUPPORTED_VERSION`"); `test/quality/suite-taxonomy.test.ts` enforces the skip-reason naming |

### Required Artifacts

All present, substantive, wired: `src/runtime/{podman-probe,podman-version,libpod-client,libpod-routes,openshell,agentos,hardening,config,session-execution}.ts`, `src/anda/{client,shape}.ts`, `src/core/{backoff,ports}.ts` (`BridgePort` beside frozen `ExecutionService`), `src/lifecycle/{controller,mutation-gate}.ts`, `src/doctor/checks.ts`, `docs/integration/{runtime-decision,anda-decision}.md`. No frozen Phase 1/2 file edited; TOOL-02 `child_process` allowlist extended to `session-execution.ts` + `doctor/checks.ts` only.

### Key Link Verification

| From | To | Via | Status |
|------|----|-----|--------|
| mutation callers | controller gate | `mutation-gate.ts` consulted before any mutating path; callers migrated (03-09) | WIRED |
| controller | Anda bridge | degraded on `ANDA_UNREACHABLE`, background retry (`bridge-retry`/`bridge-states` tests) | WIRED |
| session-execution | OpenShell runner | workload starts only via pinned argv; policy doc written before create | WIRED |
| session-execution | hardening verifier | inspect verified on create AND reuse; mismatch → destroy + `OPENSHELL_START_FAILED` | WIRED |
| stop-during-create | container reclaim | `test/lifecycle/create-interrupt.test.ts` | WIRED |
| doctor | runtime checks | `test/doctor/{checks,runtime-checks}.test.ts` | WIRED |

### Requirements Coverage

| Requirement | Evidence | Status |
|-------------|----------|--------|
| CORE-05 | `test/lifecycle/mutation-gate.test.ts` (`src/lifecycle/mutation-gate.ts`) | ✓ SATISFIED (unit; never-hangs via `withTimeout` boundaries) |
| RT-01 | `test/runtime/hardening.test.ts`, `session-execution.test.ts` | ✓ SATISFIED (unit; live conformance GATED) |
| RT-02 | `test/runtime/podman-probe.test.ts`, `podman-version.test.ts` | ✓ SATISFIED (unit; live probe output GATED) |
| RT-03 | `test/runtime/openshell-routing.test.ts`, `openshell-argv.test.ts` | ✓ SATISFIED (unit; live argv conformance GATED) |
| RT-04 | `test/runtime/agentos-supervisor.test.ts` | ✓ SATISFIED (unit; live AgentOS run GATED, driver unbound per OQ-P3-05/06) |
| RT-09 | `test/runtime/down-sweep.test.ts` | ✓ SATISFIED (unit; zero-orphan live sweep GATED) |
| ANDA-01 | `test/anda/boundary-decision.test.ts`, `docs/integration/anda-decision.md` | ✓ SATISFIED (unit) |
| ANDA-02 | `test/anda/handshake.test.ts` | ✓ SATISFIED as shape check (accepted; live RPC GATED) |
| ANDA-03 | `test/anda/reconnect.test.ts`, `test/core/backoff.test.ts`, `test/lifecycle/bridge-retry.test.ts` | ✓ SATISFIED (unit) |
| ANDA-04 | `test/anda/no-shim.test.ts` (no `src/anda/native/`) | ✓ SATISFIED (shim condition not met) |

### Gates (run by verifier)

- `npm run typecheck` (`tsc --noEmit`): clean
- `npm run lint` (ESLint): no issues
- `npm test`: 721 total — 717 pass, 0 fail, 4 skipped (the 4 Podman-gated live suites, each naming `PODMAN_UNSUPPORTED_VERSION`)
- `node --test dist/test/integration/*.test.js`: 4 skipped with stated reason (Podman 4.9.3 < 5.x)
- Host (read-only): `podman version 4.9.3`, `openshell 0.1.2`

### Live-gated items (NOT passed; Phase 4+ or Podman 5.x host required)

1. RT-01 live container conformance · 2. RT-03 live OpenShell argv conformance · 3. RT-04 live AgentOS run (also needs bound driver, OQ-P3-05/06) · 4. RT-09 live zero-orphan sweep · 5. ANDA-02/03 live RPC handshake/retry. Open questions OQ-P3-01/02/03/12/14/15 remain live-gated per `runtime-decision.md`; OQ-P3-11 Open, OQ-P3-16 Blocked-for-Phase-4 (egress mapping).

### Gaps

None. No debt markers introduced (phase files grep-clean for `TBD|FIXME|XXX` by convention of prior phases; implementation adds no stubs).

---
_Verified: 2026-10-21_
_Verifier: Claude (gsd-verifier)_

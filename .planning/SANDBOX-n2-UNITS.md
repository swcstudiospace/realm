# SANDBOX n2 — Phase 56 decomposition into file-disjoint units

Source of truth: n1b trio (`.planning/SANDBOX-n1b-MANIFEST.md`, `-ISOLATION.md`, `-LIFECYCLE.md`),
`.planning/STATE.md`, `.planning/ROADMAP.md`, `.planning/phases/56-f-51-1-cause/56-*.md`.
No src/test/docs edited in this slice.

## A. Phase fact (reused, not re-derived)

| Item | Value | Cite |
|---|---|---|
| Milestone | v9.0 "Doctor health and concurrent binding" | `STATE.md:3-4`; `MANIFEST.md:67` |
| Phases 55/59 | Verified COMPLETE (2026-11-22); read-only in this slice | `STATE.md:9,31-33` |
| Phase 56 | F-51-1 cause; STOP-05/STOP-06; status `gaps_found`, carried | `56-VERIFICATION.md:3`; `STATE.md:31-32`; `ROADMAP.md:1211-1219` |
| Phase 56 goal | Dirty variant-c stop cause established from captured failed-step cause code, recorded in `runtime-decision.md`, fixed/bounded with clean 20-iteration run | `ROADMAP.md:1213`; `56-CONTEXT.md:8` |
| Code landed (hermetic) | `StopSessionsResult.causeCode` + `daemon.stopped` emission; `stopCauseOf`/`classifyStop`/`stopRecordsOf`/`mergeTimeline` harness; commit `b37b94c` | `56-VERIFICATION.md:18-20`; `56-EVIDENCE.md:41-44` |
| Live window | NOT RUN — `realmlive` gate closed (podman.socket dead, openshell-gateway dead, no compute-driver unit); cause NOT established | `56-VERIFICATION.md:12,29`; `56-WINDOW.md:3-15` |
| v9.0 can-complete | Only when the realmlive stack is up (rootless Podman socket, openshell-gateway running, compute-driver unit with pinned image + driver config, gate variables fillable) AND the resume run below passes; otherwise Phase 56 stays carried | `56-VERIFICATION.md:33`; `56-WINDOW.md:30` |

### Gate-probe commands (exact, from `56-VERIFICATION.md:26-28`)

```bash
su - realmlive -c 'openshell status'   # → Status: No gateway configured.
printenv | grep REALM_DRIVER           # → (none); realmlive: REALM_LIVE_*/REALM_DRIVER_* absent
```

### Resume command (carried part, from `56-VERIFICATION.md:36`)

```bash
su - realmlive -c 'REALM_LIVE_PRODUCTION=1 REALM_LIVE_RAPID=1 REALM_RAPID_VARIANTS=c <window command>'
```

Held under `realm-evidence/live.lock`, serial vs Phases 57/58, from a fresh build, as `realmlive`
(`56-VERIFICATION.md:33,39`; `56-WINDOW.md:7,30`). Then: every dirty stop carries `causeCode`
readable by `stopCauseOf`; cause recorded in `docs/integration/runtime-decision.md` replacing the
inference (or re-carried with new evidence); fix/bound in owning module with bounded waits; ≥20
consecutive variant-c iterations with `failedTeardowns` 0 and zero residue (`56-VERIFICATION.md:39`;
`ROADMAP.md:1219`).

## B. Unit list U1–U5

Scope constraints (all units): no new runtime/architecture/dependency; no allowlist widening
(grey area — record only, never widen); no touching 55/59 dirs except read-only; every wait bounded,
fail-closed kept, teardown bounds and no-orphan guarantee never weakened (`56-CONTEXT.md:10,17`;
`ROADMAP.md:1219`; `56-PLAN.md:12`).

### U1 — Isolation

- **Responsibility:** deny unsandboxed/escaped/credentialed execution; default-deny policy, roots,
  canonicalization, runtime-config key set, exec gate. No failed-step/stop-cause logic.
- **File set (exclusive):** `src/core/policy.ts`, `src/core/policy.schema.json`, `src/fs/root.ts`,
  `src/fs/canonicalize.ts`, `src/fs/credentials.ts`, `src/runtime/config.ts`, `src/daemon/seams.ts`,
  `src/tools/dispatch.ts`, hermetic tests beside these (policy/fs/config).
- **DoD:** isolation denials proven hermetically — `PATH_ESCAPE`, `CREDENTIAL_PATH_DENIED`,
  `POLICY_DENIED`, `SHELL_NOT_ALLOWED`, `SCHEMA_INVALID` on the exact conditions in
  `ISOLATION.md:48-61`; `npm run build`, `npm run lint` on changed files, owning tests pass;
  error catalogue stays 29 codes, no new dependency (`56-PLAN.md:17`).
- **CC:** CC1 (live window must still be a sandbox the full path through these files).

### U2 — Lifecycle

- **Responsibility:** 5-state/9-edge machine, execution create/start/probe/stop ordering,
  workspace binding, daemon stop entry. Consumes U1 gates and U3 bounds read-only.
- **File set (exclusive):** `src/core/states.ts`, `src/core/state-machine.ts`,
  `src/runtime/session-execution.ts`, `src/session/workspace-binding.ts`, `src/daemon/main.ts`,
  hermetic tests beside these.
- **DoD:** disjoint `Timed-out` vs `Cleanup-failed` states distinct (no collapsing into one code);
  stop/destroy ordering settle→agentos→container→sandbox preserved (`LIFECYCLE.md:69-95`);
  no self-transitions, no `degraded` revival (`LIFECYCLE.md:36-39`); build+lint+owning tests.
- **CC:** CC3 (bounded waits, no-orphan, ≥20-iteration clean run).

### U3 — Resource limits

- **Responsibility:** every wall-clock bound and exhaustion shape; timeout races, teardown budgets,
  exec/watchdog timeouts. Does not own dispatch (U1) or stop loop (U4); consumes those read-only.
- **File set (exclusive):** `src/core/timeout.ts`, `src/runtime/teardown-stages.ts`, hermetic tests
  beside these.
- **DoD:** resource-exhaustion distinct shape (timeout vs failure distinguishable, e.g.
  `TOOL_TIMEOUT` vs raw error — `LIFECYCLE.md:99-105`); every wait bounded, bound constants never
  weakened; build+lint+owning tests.
- **CC:** CC3.

### U4 — Cleanup

- **Responsibility:** teardown aggregation, `causeCode` emission, orphan sweep/verify, no residue.
  Does not own logger (U5) or execution internals (U2); consumes those read-only.
- **File set (exclusive):** `src/daemon/teardown.ts`, `src/daemon/daemon.ts`, `src/session/reap.ts`,
  hermetic tests beside these (incl. `stop-bounds` contract, unedited).
- **DoD:** no orphans (zero residue after clean run); `daemon.stopped` contract tests unedited and
  passing; first failure code + `failedTeardowns` unchanged; live: ≥20 consecutive variant-c
  iterations, `failedTeardowns` 0 every row (`56-PLAN.md:12,18`; `56-VERIFICATION.md:39`).
- **CC:** CC3; supports CC1/CC2.

### U5 — Observability

- **Responsibility:** capture + record only. Structured secret-free logs, redaction, harness capture,
  `runtime-decision.md` record. No product behavior change.
- **File set (exclusive):** `src/observe/logger.ts`, `src/audit/redact.ts`,
  `test/support/rapid-stop-up.ts`, `test/support/daemon-stop-live.ts`,
  `test/support/production-live.ts`, `docs/integration/runtime-decision.md` (F-51-1 note),
  `.planning/phases/56-f-51-1-cause/56-EVIDENCE.md` (carry record).
- **DoD:** secret-free structured logs (key + value redaction, `LIFECYCLE.md:169-201`, `[REDACTED]`);
  every dirty stop captured or counted not-captured, never assumed (`56-PLAN.md:10`;
  `56-EVIDENCE.md:17`); cause recorded or re-carried with stated tested reason, never folded into
  F-41-1 (`ROADMAP.md:1218`); timeline kept outside repo (`56-CONTEXT.md:15`).
- **CC:** CC1, CC2.

## C. Mapping: unit → existing verdict → owner → gating

| Unit | Verdict | Evidence (n1b/56) | Owner | Gating |
|---|---|---|---|---|
| U1 Isolation | EXISTS (hermetic); PARTIAL live | Defaults fail-closed `ISOLATION.md:18`; credential patterns `:28-30`; denied keys `ISOLATION.md:23`; fail-closed table `:50-61`; egress enforcement body unverified `:69` | gsd-executor (executor) | Hermetic |
| U2 Lifecycle | EXISTS (hermetic); PARTIAL live | 5 states/9 edges `LIFECYCLE.md:9-27`; create/start/probe/stop `LIFECYCLE.md:47-95`; daemon budgets `:110-112`; distinct timeout codes `LIFECYCLE.md:99-105,113-123` | gsd-executor (executor) | Hermetic; clean-run check live-gated |
| U3 Resource limits | PARTIAL | Bounds exist: grace/deadlines `LIFECYCLE.md:81-87,106-109`; `withTimeout`/`dialWithin` `:99-105`. Exhaustion distinct shape + 20-run: no live evidence | gsd-executor (executor) | Hermetic; exhaustion proof live-gated |
| U4 Cleanup | EXISTS (hermetic emission); PARTIAL live | `causeCode` emission `56-VERIFICATION.md:18-19`; no-orphan sweeps `LIFECYCLE.md:130-157`; live 20-run absent `56-VERIFICATION.md:14,39` | gsd-executor (executor) | Hermetic; ≥20-run live-gated |
| U5 Observability | PARTIAL | Logger+redact EXISTS `LIFECYCLE.md:161-201`; `stopCauseOf` EXISTS `56-VERIFICATION.md:20`; failed-step *name* MISSING `56-VERIFICATION.md:20`; cause not established `56-VERIFICATION.md:3,13` | gsd-executor (executor); gsd-verifier (verifier) for STOP-05 record | Hermetic capture; CC1/CC2 record live-gated |

Overlapping file discovered: `src/runtime/session-execution.ts` spans isolation entry, lifecycle
ordering, bounds and cleanup (`ISOLATION.md:13-14`; `LIFECYCLE.md:43-95`); `src/daemon/daemon.ts`
spans cleanup emission and logging; `src/core/timeout.ts` spans lifecycle and limits. Resolved by
single-owner assignment above (U2 / U4 / U3 respectively); every other unit treats those files as
read-only. No unit merged and no file appears in two edit sets, so disjointness holds.

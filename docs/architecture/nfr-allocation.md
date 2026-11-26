# NFR allocation — v3.0 Containment by Default

**Task:** `Tc8fd-arch` · **Correlation:** `c8fd136c-b9a0-459e-bc27-e2c578d77a08` · **Inputs:** `docs/requirements/spec.md` §6, AC-1..AC-32.

Measured by `arch_nfr_allocation` (second call, all 5 NFRs bound): `nfr_count=5`, `coverage_pct=100`, `fully_allocated=true`, `unallocated=[]`, `unmeasurable=[]`. First call bound 4 of 5 (NFR-A1 unallocated, coverage 80) — the gap was closed by binding NFR-A1 to `API-RealmControl /status` label enum; no NFR was invented or silently dropped.

| NFR id | Kind | Target kind | Target ref | Limit | Unit | Clause in contract |
|---|---|---|---|---|---|---|
| NFR-P1 | quantitative | component_budget | ControlSocket /up startupBudgetMs | 200 | s | `API-RealmControl /up` |
| NFR-P1 | quantitative | component_budget | ControlSocket /status read budget | 10 | s | `API-RealmControl /status` |
| NFR-S1 | quantitative | clause | `/tools/write` fail-closed refusal | 0 | successes | `API-RealmControl /tools/write` |
| NFR-A1 | qualitative | clause | `/status` label enum | 1 | label | `API-RealmControl /status` + `StatusResponse.label` |
| NFR-I1 | quantitative | clause | `/tools/write` frozen catalogue codes | 0 | locale parses | `API-RealmControl /tools/write` |
| NFR-C1 | qualitative | clause | `AuditLine` redaction sentinel | 0 | telemetry calls | `API-RealmControl /audit/verify` |

**Assumptions:** None invented. Quantitative limits (200 s, 10 s, 0 successes) are taken verbatim from A02 spec §6 — no `assumed: true` defaults were needed. Qualitative bindings (NFR-A1 text-label distinguishability, NFR-C1 AGPL-3.0-only + private vulnerability reporting) are allocated to clauses but their pass/fail is verified by A08/A10 suites (plugin tests, redaction suite, `check:docs`), not by a numeric budget alone.

**Budgets vs measurements (honest reading):** `arch_nfr_budget` with budgets {startup_s max 200, control_read_s max 10} and no measurements reports `checked=0`, `within_budget=false`, `unmeasured=[startup_s, control_read_s]`. Measurements are pending live proof on the 5.7.1 realm account (Podman 5.x); the checkout host (4.9.3) cannot produce them. This is UNVERIFIED, not a pass — live-gated criteria remain provisional by design.

**NFRs that cannot be allocated:** None. Every NFR in spec §6 is bound above. No escalation to A02 is required.

## v9.0 addendum (Ta08e-arch)

**Inputs:** `docs/requirements/nfr.md` (NFR-P1, NFR-S1, NFR-S2, NFR-A1, NFR-A2, NFR-I1, NFR-C1) over `docs/requirements/spec.md` §11.

Measured by `arch_nfr_allocation`: `nfr_count=7`, `allocated=[NFR-P1, NFR-S1, NFR-S2, NFR-A1, NFR-A2, NFR-I1, NFR-C1]`, `unallocated=[]`, `unmeasurable=[]`, `coverage_pct=100`, `fully_allocated=true`.

| NFR id | Kind | Target kind | Target ref | Limit | Unit | Clause in contract |
|---|---|---|---|---|---|---|
| NFR-P1 | quantitative | component_budget | ControlSocket /up startupBudgetMs | 200 | s | `API-RealmControl /up` |
| NFR-S1 | quantitative | clause | `/tools/write` fail-closed refusal | 0 | successes | `API-RealmControl /tools/write` |
| NFR-S2 | quantitative | clause | Plugin toggle off: 0 tools, 0 paints | 0 | tools | `API-RealmOmpPlugin /plugin/toggle` |
| NFR-A1 | qualitative | clause | `/status` label enum + color-independent cue | 1 | label | `API-RealmControl /status` |
| NFR-A2 | quantitative | clause | Additional-UI paint, 0 under-bar | 0 | paints | `API-RealmOmpPlugin /plugin/status-paint` |
| NFR-I1 | quantitative | clause | Frozen catalogue codes | 0 | locale parses | `API-ToolResult` |
| NFR-C1 | qualitative | clause | Redaction sentinel, AGPL-3.0-only | 0 | telemetry | `API-RealmControl /audit/verify` |

**Budgets vs measurements:** `arch_nfr_budget` with budgets {startup_s max 200, control_read_s max 10, tools_when_off max 0} and no measurements returns `checked=0`, `within_budget=false`, `unmeasured=[startup_s, control_read_s, tools_when_off]`. Measurements are pending hermetic and live proof. UNVERIFIED, not a pass; live-gated criteria stay provisional.

## Ultrathink stale-verdict addendum (Tb559-arch)

**Inputs:** `docs/requirements/spec.md` §12.5 (NFR-P2, NFR-S3) over US-122..US-124, AC-65..AC-73.

Measured by `arch_nfr_allocation`: `nfr_count=2`, `allocated=[NFR-P2, NFR-S3]`, `unallocated=[]`, `unmeasurable=[]`, `coverage_pct=100`, `fully_allocated=true`.

| NFR id | Kind | Target kind | Target ref | Limit | Unit | Clause in contract |
|---|---|---|---|---|---|---|
| NFR-P2 | quantitative | component_budget | CompletionGate revalidate | 5 | s | `API-UltrathinkCompletionGate /gate/validate` |
| NFR-P2 | quantitative | component_budget | CompletionGate release | 10 | s | `API-UltrathinkCompletionGate /gate/release` |
| NFR-S3 | quantitative | clause | SessionStore answer record | 0 | secrets | `API-UltrathinkCompletionGate /session/answer` |

**Budgets vs measurements:** `arch_nfr_budget` with budgets {revalidation_s max 5, release_read_s max 10} and no measurements returns `checked=0`, `within_budget=false`, `unmeasured=[revalidation_s, release_read_s]`. Measurements are pending A08 on the planner host. UNVERIFIED, not a pass.

## Swarm task cffd9419 resume addendum (Tcffd1-arch)

**Inputs:** `docs/requirements/spec.md` §14.4 (0 new NFRs; NFR-P1/S1/A1/I1/C1/P2/S3 carried forward) over US-129..US-131, AC-86..AC-96.

Measured by `arch_nfr_allocation`: `nfr_count=7`, `allocated=[NFR-P1, NFR-S1, NFR-A1, NFR-I1, NFR-C1, NFR-P2, NFR-S3]`, `unallocated=[]`, `unmeasurable=[]`, `unknown_nfr_ids=[]`, `coverage_pct=100`, `fully_allocated=true`.

| NFR id | Kind | Target kind | Target ref | Limit | Unit | Clause in contract |
|---|---|---|---|---|---|---|
| NFR-P1 | quantitative | component_budget | ControlSocket `/up` startupBudgetMs | 200 | s | `API-RealmControl /up` |
| NFR-P1 | quantitative | component_budget | ControlSocket `/status` read budget | 10 | s | `API-RealmControl /status` |
| NFR-S1 | quantitative | clause | `/tools/write` fail-closed refusal | 0 | successes | `API-RealmControl /tools/write` |
| NFR-S1 | quantitative | clause | SecretScanner on `test/host/boot-report.test.ts` | 0 | secrets | Scanner report (ADR-0013) |
| NFR-A1 | qualitative | clause | `/status` label enum + color-independent cue | 1 | label | `API-RealmControl /status` |
| NFR-I1 | quantitative | clause | Frozen catalogue codes C + en_US | 0 | locale parses | `API-ToolResult` |
| NFR-C1 | qualitative | clause | Redaction sentinel, AGPL-3.0-only | 0 | telemetry | `API-RealmControl /audit/verify` |
| NFR-P2 | quantitative | component_budget | CompletionGate revalidate | 5 | s | `API-UltrathinkCompletionGate /gate/validate` |
| NFR-P2 | quantitative | component_budget | CompletionGate release | 10 | s | `API-UltrathinkCompletionGate /gate/release` |
| NFR-S3 | quantitative | clause | SessionStore answer record | 0 | secrets | `API-UltrathinkCompletionGate /session/answer` |

**Budgets vs measurements:** `arch_nfr_budget` with budgets {startup_s max 200, control_read_s max 10, revalidation_s max 5, release_read_s max 10} and 0 measurements returns `checked=0`, `within_budget=false`, `unmeasured=[startup_s, control_read_s, revalidation_s, release_read_s]`. Measurements are pending A08. UNVERIFIED, not a pass.

## T5471 quality upgrade addendum (T5471-arch)

**Inputs:** `docs/requirements/spec.md` §15.6 (NFR-P3, NFR-S4, NFR-A3) over US-132..US-135, AC-97..AC-108. NFR-P1/S1/A1/I1/C1/P2/S3/S2/A2 are carried forward unchanged.

Measured by `arch_nfr_allocation`: `nfr_count=3`, `allocated=[NFR-P3, NFR-S4, NFR-A3]`, `unallocated=[]`, `unmeasurable=[]`, `unknown_nfr_ids=[]`, `coverage_pct=100`, `fully_allocated=true`.

| NFR id | Kind | Target kind | Target ref | Limit | Unit | Clause in contract |
|---|---|---|---|---|---|---|
| NFR-P3 | quantitative | component_budget | 8-gate baseline run wall clock | 1800 | s | `8-gate baseline` |
| NFR-S4 | quantitative | clause | Secret scan over the change | 0 | secrets | `secret scan` |
| NFR-A3 | qualitative | clause | `/status` label enum carried from NFR-A1 | 1 | label | `status label` |

**Budgets vs measurements:** `arch_nfr_budget` with budgets {baseline_wall_s max 1800} and 0 measurements returns `checked=0`, `within_budget=false`, `unmeasured=[baseline_wall_s]`. Measurements are pending A08. UNVERIFIED, not a pass.

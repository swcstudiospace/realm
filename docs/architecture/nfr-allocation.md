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

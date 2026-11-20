# Review standards — Realm v3.0 (input for A09)

**Task:** `Tc8fd-arch` · **Correlation:** `c8fd136c-b9a0-459e-bc27-e2c578d77a08` · **Type:** `review.standards`
These rules restate decisions already taken in `blueprint.md` and `adr-index.md`; they introduce no new decisions. A09 reviews code against them verbatim.

## Rules

- **R1 — Layer direction.** `layer_order` outermost→innermost: `surface → orchestration → runtime → domain → platform`. A module may depend on its own layer or any later one. Upward edge = violation. Proof: `arch_layer_violations` with the §4 assignments/edges in `blueprint.md` returns `violation_count=0`; the worked fixture (one allowed edge + one upward edge `orders_repo (data) -> orders_service (service)`) returns `violation_count=1` naming the upward edge. Rationale: ADR-0002, blueprint §4.
- **R2 — Acyclicity.** The module graph is acyclic. Proof: `arch_cycle_check` returns `has_cycle=false`; the worked fixture (a two-module loop plus a leaf) returns `has_cycle=true` with the loop named. Rationale: blueprint §4.
- **R3 — Coupling budget.** C4 fan-out ≤ 8 distinct containers per container; 0 isolated containers unless intended and documented. Proof: `arch_c4_fanout` (15 containers, max fan-out 3). Rationale: blueprint §3.
- **R4 — Contract conformance.** Every cross-boundary interface has a versioned contract (`API-RealmControl` 1.0.0, `API-GsdLinear` 1.0.0); consumers pin to the contract digest; N-1 compatibility for the 30-day deprecation window. Breaking change → major bump + migration plan + consumer acks (A05/A06) → L3. Rationale: blueprint §12.
- **R5 — RealmError hygiene.** Only `src/core/errors.ts` defines codes/retryable values; 31 codes; every catalogue code surfaces to MCP/ACP; no raw runtime text in errors. Rationale: AGENTS.md, errors.ts header.
- **R6 — Timeout + fail-closed.** Every async boundary has `withTimeout`; disconnected host `edit`/Realm `write` refuse `REALM_NOT_ACTIVE` (fail-closed); advisory is explicit opt-in, never called the default. Rationale: ADR-0001.
- **R7 — Audit redaction + chain.** Redaction sentinel present; 0 PII fields; 0 off-machine telemetry; `seq`/`prev` chain with `realm audit verify`; 0700/0600 socket. Rationale: ADR-0005, NFR-C1/NFR-S1.
- **R8 — Supply chain.** No new dependency without justification + licence + maintenance checks; SBOM + SHA256SUMS + attestation on release; AGPL-3.0-only preserved. Rationale: blueprint §10.
- **R9 — Protected paths + release ownership.** PRs never edit `CHANGELOG.md` or version fields; human review required for `.github/workflows/**`, `release/**`, `scripts/release/**`, `LICENSE`, `NOTICE`. Rationale: blueprint §14.
- **R10 — No second convention.** Style (strict TS ESM, `node:test`, Conventional Commits, module ratchet, no suppression comments) is restated, not reinvented; a reviewer never invents a new gate for one PR.

## Fixtures (worked examples for reviewers)

- Layer fixture: `arch_layer_violations` with edges `[orders_api→orders_service, orders_service→orders_repo, orders_repo→orders_service]` returns the upward edge as the single violation.
- Cycle fixture: `arch_cycle_check` with `[orders→billing, billing→orders, orders→catalog]` returns `has_cycle=true`, cyclic component `billing, orders`.
- NFR fixture: `arch_nfr_allocation` with the 5 bindings in `nfr-allocation.md` returns `fully_allocated=true`.

## Unverified

Gate scripts (`typecheck`, `lint`, `test`, `build`, `check:docs`, `check:gates`, `check:pack`, `check:mcp`) and the contract check script were not run under this task (skip gates/formatters; edit only). A09 must obtain the parent's gate evidence after join before relying on these rules as pass/fail.

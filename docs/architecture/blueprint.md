# Blueprint — Realm v3.0 Containment by Default (Outstanding Phases)

**Branch:** `gsd/phase-15-complete` · **Correlation:** `c8fd136c-b9a0-459e-bc27-e2c578d77a08` · **Task:** `Tc8fd-arch` · **Capability:** `design.blueprint`
**Status:** IN_REVIEW (provisional for HARN-03, live-gated proof on Podman 5.x, and A10 co-sign; contract check skipped per brief — run by parent after join)
**Sources:** `docs/requirements/spec.md` (v1.0.0), `docs/requirements/stories.md` (v1.0.0), `docs/acceptance.md` (AC-1..AC-32), `.planning/ROADMAP.md`, `.planning/phases/RECOVERY-2026-10-31.md` (SUPERSEDED 2026-11-01) + `AGENTS.md`.
**Archive note:** RECOVERY-2026-10-31 is superseded by owner decision 2026-11-01 (start from phase 13, gsd-autonomous governs). Its P0..P20 recipes and 52-requirement matrix remain planning inputs; its edit-only/no-commit rules do not bind execution. HARN-03 grey-area (§8) survives the supersession unchanged.

This document is the single-writer `architecture.blueprint` for v3.0 phases 12, 13, 14, 16, 17, 18, 19, 20. Phase 15 (ONB-01..ONB-07, DEF-01..DEF-02) is complete 2026-11-14 and is not re-verified here. No product code is written or committed under this task.

## 1. Purpose and scope

Every file mutation by an agent either lands inside the realm under policy or fails closed; the operator can always see whether the realm is active or disconnected. Under the fail-closed default (D4), host `edit` or Realm `write` while disconnected refuses with `REALM_NOT_ACTIVE`; no silent unsandboxed mutation is permitted.

Out of scope: product source, schema DDL, UX tokens, release commands, IaC changes, `CHANGELOG.md`/`package.json` version edits (release job owns them), `docs/specs/realm-spec.xml` (owner-directed edits only), `LICENSE`/`NOTICE` except by owner instruction.

## 2. System context (C4 Level 1)

```mermaid
flowchart TB
  Operator([Operator]) --> CLI[realm CLI]
  Operator --> OmpHost[Omp host]
  OmpHost --> RealmDaemon[Realm daemon<br/>control socket 0700/0600]
  CLI --> RealmDaemon
  CLI --> MCP[MCP stdio]
  CLI --> ACP[ACP stdio]
  RealmDaemon --> Lifecycle[Lifecycle controller]
  Lifecycle --> Driver[Compute driver gRPC]
  Driver --> Sandbox[Sandbox container<br/>realm-<sessionId>]
  Sandbox --> Gateway[OpenShell gateway host]
  Sandbox --> AgentOS[AgentOS runner]
  RealmDaemon --> ToolDisp[Tool dispatcher]
  ToolDisp --> Policy[Policy engine]
  ToolDisp --> Audit[Audit log seq/prev chain]
  ToolDisp --> Sandbox
  GSD[GSD pipeline] --> CI[GitHub Actions ci.yml]
  CI --> Greptile[Greptile review]
  GSD --> Linear[Linear SPE-*]
```

Trust zones: **host operator** (Operator, CLI, Omp host) · **daemon surface** (RealmDaemon, ControlSocket) · **policy core** (PolicyEngine, AuditLog, FileSystemGuard) · **sandbox runtime** (ComputeDriver, SandboxContainer, OpenShellGateway, AgentOS) · **CI / tracking** (CIPipeline, Greptile, LinearTracker, GSDPipeline). Crossings are listed in §9 and `threat-model.md`.

## 3. Container model and coupling budget

15 containers, 17 distinct relations, max fan-out 3 (measured by `arch_c4_fanout`: `container_count=15`, `relation_count=17`, `max_fan_out=3`, `over_budget=[]`, `isolated=[]`). Fan-out budget: **8** distinct containers per container. Any future container exceeding 8 requires an ADR; no silent accept. Containers: Operator, OmpHost, RealmDaemon, ControlSocket, LifecycleController, ToolDispatcher, PolicyEngine, AuditLog, ComputeDriver, SandboxContainer, OpenShellGateway, AndaEngine, CIPipeline, GSDPipeline, LinearTracker.

Coupling rule: surfaces never talk to the sandbox directly; all tool calls pass ToolDispatcher → PolicyEngine → AuditLog admission → sandbox. Daemon owns lifecycle; driver owns container creation; gateway owns network egress.

## 4. Module layering

`layer_order` (outermost → innermost; a module may depend on its own layer or any later one):

```
surface (0) → orchestration (1) → runtime (2) → domain (3) → platform (4)
```

| Layer | Modules (single-writer zones) |
|---|---|
| surface | `omp-plugin`, `mcp-server`, `acp-agent`, `cli` — host adapters only, no tool logic |
| orchestration | `lifecycle-controller`, `tools-dispatcher`, `daemon`, `session-store` — state machine, queue, socket |
| runtime | `libpod-client`, `openshell-adapter`, `agentos-driver`, `anda-client`, `hardening-verifier` — Podman/OpenShell/AgentOS/Anda edges |
| domain | `policy-engine`, `fs-canonical`, `audit-chain`, `contract-validator` — pure policy/fs/audit logic |
| platform | `core-errors`, `core-timeout`, `core-events`, `observe-logger`, `observe-metrics` — RealmError catalogue, `withTimeout`, logger/metrics primitives |

Measured by `arch_layer_violations`: `violation_count=0`, `checked_edges=17`, `unassigned=[]`. Measured by `arch_cycle_check`: `has_cycle=false` (12 nodes in the sampled edge set). Any new edge must be added to the fitness set; an upward edge or a cycle blocks downstream CLAIMED tasks.

## 5. Phase DAG (v3.0 lanes)

Three lanes share no mutable state and may run in parallel; inside a lane order is strict. Live runs on the realm account execute under one live lock at a time (startup reap is account-wide).

```mermaid
flowchart LR
  P12[Phase 12<br/>HARN + spike] --> P16[Phase 16<br/>Omp in sandbox]
  P14[Phase 14<br/>Crash safety] --> P17[Phase 17<br/>Observability] --> P18[Phase 18<br/>Per-project] --> P19[Phase 19<br/>Resume]
  P13[Phase 13<br/>Quality ratchet] --> P20[Phase 20<br/>Release hardening]
  P15[Phase 15 COMPLETE<br/>Onboarding] -.-> P16
  P16 --> MILESTONE[Milestone audit → complete → cleanup]
  P19 --> MILESTONE
  P20 --> MILESTONE
```

| Lane | Sequence | Rationale |
|---|---|---|
| Omp lane | 12 → 16 (15 complete between) | Spike proves what Omp enforces; 16 implements only the proved mechanism. |
| Runtime lane | 14 → 17 → 18 → 19 | Reconciliation lines (14) must be covered by the chain (17); adoption is per-session (18 before 19). |
| Pipeline lane | 13 → 20 | 20 alters the release path every earlier ship uses; it runs last. |

Milestone join rules: audit records all 52 v3.0 IDs as satisfied/carried/superseded with 0 silent gaps; `gsd-tools milestone complete` runs only after a dry run that exits 0; cleanup removes scratch profiles and worktrees per inventory; release line is 0.3.x, first v3.0 release 0.3.0.

Intra-phase dependency contract (from RECOVERY matrix, carried forward): project contract → identity → selection; selection + startup-common-log → daemon; daemon + driver + omp-mode-state → all callers; resume-verifier → scratch-volume → scratch-runtime-wiring → checkpoint → checkpoint-cli; production-acceptance waits for checkpoint-cli + audit-checkpoint-cli + quality-release-repair; production-acceptance → release-removed-features → release-rollback-docs. `src/runtime/driver/service.ts` does not exist; the boundary is `compute-driver.ts`/`server.ts`. A01 must correct signed ownership for any path mismatch; workers never silently substitute paths.

## 6. Architecture invariants (non-negotiable)

Carried from AGENTS.md and `src/core/errors.ts` (31 codes, frozen catalogue):

1. **Strict TypeScript, ESM, single package.** `tsconfig.json` enables `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noUnusedLocals`. Tests use `node:test`; no source-text tests.
2. **RealmError + codes/retryable.** Every error is a `RealmError` with a catalogue `code` (`ERROR_CODES`, 31 codes incl. `OPENSHELL_GATEWAY_LOST`), a human-readable `reason`, and a `retryable` flag; optional `causeCode` is itself a catalogue code. Raw runtime text never enters an error. Only `src/core/errors.ts` defines retryable values.
3. **`withTimeout` on every async boundary** (`src/core/timeout.ts`; `TOOL_TIMEOUT`, `DAEMON_START_TIMEOUT`).
4. **Fail-closed default (D4).** Policy with no `mode` loads as fail-closed. Advisory (warn-and-allow) is explicit opt-in, never called the default; `scripts/check/default-mode.mjs` enforces prose.
5. **Audit redaction.** No secrets or env in audit/log; redaction sentinel present; JSONL lines carry level, fixed code field, correlation id. Hash chain `seq`/`prev` with `realm audit verify` (OBS-01).
6. **Atomic writes.** Interrupted write leaves the original intact (`WRITE_NOT_ATOMIC`); orphan temp sweep removes only 1 exact-name pattern, never follows symlinks, with audit lines (CRASH-01/05).
7. **Bounded queues.** Tool queue wait bounded by `toolQueueMs`; no unbounded buffer.
8. **Module-size ratchet.** `src/**/*.ts` > 1000 lines fails `check:gates` unless allowlisted with a ceiling; never raise a ceiling silently — split the file or raise in the same PR with the new count stated.
9. **`process.env` only at 4 entry edges:** `src/cli/main.ts`, `src/daemon/main.ts`, `src/omp/extension.ts`, `src/runtime/driver/main.ts`. Other modules take env as an argument.
10. **No suppression comments** (`@ts-ignore`, `@ts-expect-error`, `@ts-nocheck` banned); no silent catch beyond the 10 named QUAL-01 exceptions.
11. **No new dependency** without justification, licence and maintenance checks (CONTRIBUTING.md). Scripts use Node built-ins only except `export-usage*.mjs` (existing `typescript` devDependency).
12. **No host-local absolute paths** in committed files (no home-directory, temporary-directory, or Users-directory paths); `check:docs` enforces for published docs.
13. **Single tool contract.** Omp plugin, MCP and ACP expose the same `tools.dispatch`/`contract/tools.schema.json` shape; callable tools are exactly 5 (exec, read, write, list, status), `@boulies/sell`, retry stays a command, 0 glob tools.
14. **Sandbox hardening.** Rootless only, digest-pinned, non-privileged, capabilities dropped, read-only root + tmpfs scratch, CPU/memory/PID limits, 1 container per session (`realm-<sessionId>`), `/workspace` the only project bind plus session scratch `/scratch` (RES-03). Control socket dir 0700, socket 0600; 0 network listeners on the daemon; metrics over control socket only.
15. **Conventional Commit subjects** (`feat`, `fix`, `perf`, `refactor`, `docs`, `test`, `build`, `ci`, `chore`, `security`), changelog grouped by type.

## 7. NFR bindings

Every NFR from A02 spec §6 is bound to a measurable contract clause or component budget. Detail in `nfr-allocation.md`; measured by `arch_nfr_allocation`: `coverage_pct=100`, `fully_allocated=true` (5 NFRs, all allocated). Live measurements are pending Podman 5.x proof (§8) — `arch_nfr_budget` with no measurements reports `within_budget=false`, `unmeasured=[startup_s, control_read_s]`, which is the honest fail-closed reading, not a pass.

| NFR | Kind | Binding (contract clause / component budget) | Limit |
|---|---|---|---|
| NFR-P1 (perf) | quantitative | Component budget: `realm up` → active (startup budget) | 200 s on 5.7.1 stack |
| NFR-P1 (perf) | quantitative | Component budget: control-socket read | 10 s, 1 response |
| NFR-S1 (security) | quantitative | Clause: `API-RealmControl /tools/write` fail-closed refusal | 0 successes while disconnected |
| NFR-S1 (security) | qualitative | Component budget: socket 0700/0600, 0 privileged, 0 host sockets | 0 violations |
| NFR-A1 (a11y) | qualitative | Clause: `API-RealmControl /status` label enum (realm active / realm disconnected) + color-independent cue | 1 of 2 labels, distinguishable without color |
| NFR-I1 (i18n) | quantitative | Clause: `API-ToolResult` frozen catalogue codes in C + en_US, English operator text | 0 locale-format parses |
| NFR-C1 (compliance) | qualitative | Clause: `API-AuditLine` redaction sentinel + JSONL shape | 0 off-machine telemetry, 0 PII fields, AGPL-3.0-only |

## 8. HARN-03 grey-area, Podman 5.x, protected paths

**HARN-03 (owner-blocked, surfaced never faked).** Recorded default-configuration warm run FAILED (38 external + 6 DNS = 44 offenders on 18.14.2; `127.0.0.1:9931` EINPROGRESS on 18.16.0). The only pass uses the `LLAMA_CPP_BASE_URL` lever in a proxied scripted configuration, which the record states is not the default configuration. A refusing-proxy observation (0/0/7) is narrower evidence, not a clean warm pass. An owner ruling is required on (a) whether port 9931 joins the allowlist and (b) whether the lever counts as passing the zero-offender acceptance. Until that ruling, AC-3 stays provisional and the zero-offender criterion is not relaxed. See `adr-index.md` ADR-0006. Cold and missing-prerequisite outcomes are named skips, never passes.

**Podman 5.x.** Supported stack is rootless Podman 5.x (realm account 5.7.1, OpenShell 0.1.5 gateway, Realm compute driver). This checkout host reports Podman 4.9.3, so live-gated proof cannot run here; Realm never installs or upgrades Podman. Podman-gated suites skip with `PODMAN_UNSUPPORTED_VERSION` / `PODMAN_MISSING`. Live acceptance runs on the realm account.

**Protected paths (human review required).** `.github/workflows/**`, `release/**`, `scripts/release/**`, `LICENSE`, `NOTICE`. Each D6 pull request cites D6 in its body.

**Dirty-tree preservation.** Checkout is on `gsd/phase-15-complete` and may carry owner WIP (`src/audit/log.ts`, `src/runtime/config.ts`). Never hard-reset, never discard unowned changes, never edit files outside the assigned zone; use absolute paths in subagent handovers.

**Carried, not in v3.0:** FS-02 (approximation; QR-07 adds confidence only), ANDA-01..04 (engine licence), PRD-DRV-01 (except MULTI-04 scope), UI-01 (accepted limitation). Excluded: TD-06, TD-10 (owner-only repo settings).

## 9. Threat model summary

Full STRIDE grid in `threat-model.md` (A10 co-sign pending — `verification.status=partial` until then). Boundary crossings: Operator→Daemon (spoof/tamper of control socket), Daemon→Sandbox (container escape), Sandbox→Gateway (egress), ToolDispatcher→AuditLog (tamper/repudiation), CI→Release (provenance). High-risk crossings awaiting A10 co-sign: Daemon→Sandbox containment (guard vs containment per D3 — spike-proved `write` transport survived removal of built-in `write`, so claims follow what the spike proves), Sandbox→Gateway egress (default-deny + IPv6 disabled), AuditLog integrity (seq/prev chain). No threat is marked accepted by A03; residual-risk acceptance is A10-only.

Compliance mapping: PCI network segmentation → OpenShell egress allowlist + IPv6 disabled + host-networking config refusal; supply-chain → SBOM + attestation (`gh attestation verify`) + SHA256SUMS; AGPL-3.0-only preserved; vulnerability reports via private GitHub reporting (`SECURITY.md`).

## 10. Tech stack selection

| Concern | Choice (golden path) | Supply-chain evidence | Level |
|---|---|---|---|
| Runtime | Node.js 22.13.0+ (CI 22.x/24.x), strict TS ESM, single package | `package-lock.json` pinned; `npm audit --omit=dev --audit-level=high` in CI audit job | L2 |
| Tests | `node:test` + `--experimental-test-coverage` (floors for `src/fs`, `src/core`, `src/tools`) + `fast-check` (200 runs, fixed seed) | `fast-check` devDependency; mutation via `scripts/mutation/run.mjs` (non-blocking, covers `src/fs`, `src/core/policy.ts`, `src/audit/redact.ts`) — Stryker not installed (188-package tree, unproven fit) | L2 |
| Container runtime | Rootless Podman 5.x, digest-pinned image (`sandbox/expected-digests.json`), `runc` | Image digest pinned; built via `npm run build:image` (not in CI); Realm never installs/upgrades Podman | L2 |
| Sandbox supervisor | OpenShell 0.1.5 gateway, Realm compute driver (gRPC on user-only socket), AgentOS as `openshell sandbox exec` child | OpenShell verbs pinned and re-verified 2026-10-26 (`sandbox create`/`exec`/`status`); Ada/Anda via HTTP, no shim | L2 |
| IDL | Vendored protos in tarball with provenance (PRD-LIB-01); exact pins | Vendored protos + provenance recorded in tarball | L2 |
| Release | GitHub Actions build (contents:read) → publish (4 write grants, 0 npm install/build/pack), `gh attestation verify` | SBOM + SHA256SUMS + tarball attested; Dependabot `github-actions`+`npm` root+`site/`; `npm audit` gate | L2 |

No new first-party dependency is introduced by this blueprint. Any future pick outside this table is an ADR; a pick adding infrastructure or a first-party dependency is L3 → BLOCKED `human-approval: novel_infrastructure`. Licence matrix: AGPL-3.0-only (Realm) + Apache-2.0 material listed in `NOTICE`/`licenses/` — no new licence compatibility risk without an ADR.

## 11. GSD pipeline (discuss → plan → execute → audit → complete → cleanup)

Every outstanding phase follows `gsd-autonomous`:

```
discuss → plan → execute (+ STATE/ROADMAP update in same PR) → verify (parent after join)
  → milestone audit (all 52 IDs satisfied/carried/superseded, 0 silent gaps)
  → milestone complete (dry run exit 0 first) → cleanup (scratch profiles + worktrees per inventory)
```

Parent verifies after all owners land; no dependent dispatch before actual parent evidence. State machine for each phase issue: `brief drafted → discussed → planned → executed → verified → audited → completed → cleaned up`. A phase cannot enter CLAIMED/IMPLEMENTATION until its contract ( §12 ) is IN_REVIEW and the relevant ADR is accepted.

## 12. Contracts (consumed by A05/A06/A07/A08, pinned by digest)

| Contract | File | Version | Consumers | Key clauses |
|---|---|---|---|---|
| API-RealmControl | `contracts/api-realm-control.yaml` (OpenAPI 3.1) | 1.0.0 (7 ops) | A05, A06, A07, A08 | `/up` 200 s budget, `/status` label enum + gateway-loss code distinct from `AGENTOS_CRASH_LOOP`, `/tools/write` fail-closed refusal, `/audit/verify` seq/prev, `/control/metrics` socket-only, `/checkpoint/restore` byte-exact |
| API-GsdLinear | `contracts/api-gsd-linear.yaml` (OpenAPI 3.1) | 1.0.0 (5 ops) | A05, A07, A08 | Phase issue lifecycle, sub-issue per plan/requirement, dedup scan (`SPE-*` list → 0 duplicates), collapsible Agent notes, per-phase ship record |

Pin consumers to the contract digest (computed by parent after join — see §15). Keep N-1 compatibility for the 30-day deprecation window. Any breaking change requires a major bump + migration plan + consumer acks (A05/A06) → L3 → BLOCKED.

`arch_contract_ops` (RealmControl): `operations=7`. `arch_field_breaks` (sample response addition of `correlationId`): `breaking_change=false`, `additive=["added field correlationId"]`. `arch_semver_bump` 1.0.0 → 1.1.0 additive: `bump=minor`, `required_bump=minor`, `compliant=true`. The contract check script (`arch_contract_check.py`) was not run — skipped per brief instruction to skip gates; parent runs it after join with `--base` against the prior revision.

## 13. Linear programming model (A01 to execute)

Dedup scan first (read-only): `list_issues` for `SPE-*`, matching phase id + title keywords; reuse when a phase title already exists; never create a second issue for one phase. Create only when the scan returns 0 matches for that phase.

- **8 phase issues** (titles 1 short line, e.g. `Phase 12: scripted harness and spike`): phases 12, 13, 14, 16, 17, 18, 19, 20.
- **33 sub-issues** (1 per plan): Phase 12 → 3 (12-01..03), Phase 13 → 1 (13-01), Phase 14 → 1 (14-01), Phase 16 → 4 (16-01..04), Phase 17 → 5 (17-01..05), Phase 18 → 15 (18-01..14 + 18-04b), Phase 19 → 1 (19-01), Phase 20 → 3 (20-01..03). Total **33**.
- Each issue links exactly 1 phase id, 1+ plan ids, 1+ requirement ids; detail lives in 1 collapsible `+++ Agent notes` section per issue (linked phase/plan/requirement ids, acceptance counts).
- No close, no status change and no Tracking write is performed by the architecture task. A02 spec §7 parenthetical (per-requirement split for phases 13/14/19 when >4 ids) is a reviewer option; the normative count for handover is 33. If reviewers prefer the split, issue a superseding ADR with the revised count before creating issues.

## 14. PR / ship / Greptile / CI

Branch from `main`; every change lands through a pull request. `ci.yml` must be green (verify including typecheck, lint, unit, integration and script tests, docs, gate-closure, build, pack and MCP checks on Node 22.x and 24.x; site build; audit), Greptile must report 5 of 5 with 0 open comments, and the merge must run once through the ultrathink ship flow with squash set to match the pull request shape. A `gh pr merge` from a shell is forbidden.

Gates (all exit 0 before review): `typecheck`, `lint`, `test`, `build`, `check:docs`, `check:gates`, `check:pack`, `check:mcp`. Human review required for protected paths (§8); each D6 PR cites D6. PRs never edit `CHANGELOG.md` or version fields (`package.json`, `package-lock.json`, 4 adapter manifests) — the release job owns them. Never force-push `main`; never rewrite history without an explicit owner decision.

## 15. Fitness functions (CI)

Any CI violation on main blocks further downstream CLAIMED tasks.

| # | Function | Check | Budget / rule |
|---|---|---|---|
| F1 | Layer direction | `arch_layer_violations` on the edge set in §4 | 0 violations |
| F2 | Acyclicity | `arch_cycle_check` | `has_cycle=false` |
| F3 | Coupling | `arch_c4_fanout` | fan-out ≤ 8 per container; 0 isolated unless intended |
| F4 | NFR allocation | `arch_nfr_allocation` | `fully_allocated=true`, coverage 100% |
| F5 | NFR budget | `arch_nfr_budget` vs live measurements | within budget or named skip (skip ≠ pass) |
| F6 | Contract conformance | `arch_contract_check` + `arch_semver_bump` + `arch_field_breaks` | semver-compliant, no breaking without L3 |
| F7 | Module ratchet | `scripts/check/module-size.mjs` under `check:gates` | >1000 lines needs allowlist ceiling |
| F8 | Export hygiene | `scripts/check/export-usage-gate.mjs` | 0 self-only/test-only without allowlist reason |
| F9 | Gate closure | `scripts/check/gate-closure.mjs` | exec-gate closure reaches 0 forbidden modules, 0 `child_process` |
| F10 | Coverage floors | `scripts/check/coverage.mjs` vs `coverage-floors.json` | `src/fs`, `src/core`, `src/tools` floors ratchet; raised floor exits 1 with BELOW |

Current fitness state (read-only checks, this task): F1 pass (0 violations), F2 pass (acyclic), F3 pass (15 containers, max fan-out 3, 0 over budget, 0 isolated), F4 pass (100% allocated), F5 unverified (live measurements pending Podman 5.x — honest `within_budget=false`), F6 unverified (script skipped per brief; registry ops/semver/field checks pass), F7–F10 not run (parent owns gates after join).

## 16. What was decided, what is UNVERIFIED

Decided (L2, catalog patterns): three-lane DAG with 20 last; fail-closed default; scripted-provider oracle for OMPX-01..05; per-session `realm-<sessionId>` identity with re-adoption under the 14-check verifier; seq/prev audit chain; quality ratchet (audit, pack-smoke, coverage floors, fake-clock, fast-check, mutation); 33-sub-issue Linear model; fan-out budget 8; layer order in §4.

UNVERIFIED (never inferred from a skipped tool): contract check (`arch_contract_check` script not run — parent runs after join); live NFR measurements (Podman 5.x realm account only); HARN-03 zero-offender acceptance (awaiting owner ruling on 9931 + lever); OMPX-05 /workspace + host + audit pair triple (needs doubly-gated real-stack run); A10 threat co-sign; Greptile 5/5 and CI green per phase (per-PR evidence).

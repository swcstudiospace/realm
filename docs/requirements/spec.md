# Requirements Spec — v3.0 Containment by Default (Outstanding Phases)

**Branch:** `gsd/phase-15-complete` · **Correlation:** `c8fd136c-b9a0-459e-bc27-e2c578d77a08` · **Task:** `Tc8fd-req` · **Capability:** `req.spec`
**Status:** IN_REVIEW (provisional for HARN-03 and all live-gated proof; GWT/lint/verdict not run per brief instruction to skip gates and formatters, to be run by parent after join)
**Scope:** phases 12, 13, 14, 16, 17, 18, 19, 20 plus milestone audit/complete/cleanup and the PR/ship plus Linear tracking flow. Phase 15 (ONB-01..ONB-07, DEF-01..DEF-02) is complete 2026-11-14 and is not re-verified here.

## 1. Core Value

Every file mutation by an agent either lands inside the realm under policy or fails closed, and the operator can always see whether the realm is active or disconnected. Under the fail-closed default (D4), a host `edit` or Realm `write` while disconnected must refuse; no silent unsandboxed mutation is permitted.

## 2. Sources

`.planning/PROJECT.md`, `.planning/ROADMAP.md`, `.planning/REQUIREMENTS.md` (52 v3.0 IDs plus carried and standing sets), `.planning/MILESTONE-CONTEXT.md` (owner decisions D1–D6, 2026-10-29), `.planning/STATE.md`, `.planning/phases/RECOVERY-2026-10-31.md`, `AGENTS.md`, phase 12–20 CONTEXT/PLAN/VERIFICATION records. This spec changes no `.planning` file, no product spec, no code.

## 3. Lanes and Order

Three lanes share no mutable state and may run in parallel; inside a lane order is strict.

- **Omp lane:** 12 → 16 (15 complete between them; 15 precedes 16 in the lane record).
- **Runtime lane:** 14 → 17 → 18 → 19 (14 before 17 so reconciliation lines are covered by the chain; 18 before 19 because adoption is per session).
- **Pipeline lane:** 13 → 20 (20 last because it alters the release path every earlier ship uses).

Each phase follows `gsd-autonomous` discuss → plan → execute, with STATE/ROADMAP updates in the same pull request, then milestone audit → complete → cleanup once all eight phases are green.

Live runs on the realm account execute under one live lock at a time because the startup reap is account-wide.

## 4. Per-Phase Requirements

### 4.1 Phase 12 — Harness and spike (HARN-01..04, OMPX-01)

- One gated command starts an isolated Omp profile, a loopback OpenAI-compatible stub (1 `write` call, then a final message), and Omp over RPC pipes with no pseudo-terminal, credentials or tokens, and records 1 Omp version string (HARN-01).
- Three cases use the answered registered-write semantics: reachable-inactive advisory warns on every invocation and creates exact host bytes; inactive fail-closed refuses with `REALM_NOT_ACTIVE` and 0 host files; active succeeds. Unreachable-daemon refusal and native C4 CREATE are distinct controls (HARN-02).
- Warm capture permits only the stub and ports 11434/8080/1234 with 0 external, 0 DNS and 0 offenders. Cold and missing-prerequisite outcomes are named skips, never passes (HARN-03).
- The spike table in `docs/integration/omp.md` answers the 3 enforcement questions with the Omp version and closes or restates OQ-P5-01/OQ-P5-02 (OMPX-01).
- OMP-05 closure via HARN-04 states the scripted, not LLM-driven basis and requires current C1–C4 plus HARN-03 to pass; historical 2026-10-30 receipts remain history.

**HARN-03 grey-area — owner-blocked, surfaced never faked:** the recorded default-configuration warm run FAILED (38 external + 6 DNS = 44 offenders on 18.14.2; 127.0.0.1:9931 EINPROGRESS on 18.16.0). The only pass uses the `LLAMA_CPP_BASE_URL` lever in a proxied scripted configuration, which the record itself states is not the default configuration. A refusing-proxy observation (0/0/7) is narrower evidence, not a clean warm pass. An owner ruling is required on (a) whether port 9931 joins the allowlist and (b) whether the lever counts as passing the zero-offender acceptance. Until that ruling, HARN-03 stays provisional and the zero-offender criterion is not relaxed.

### 4.2 Phase 13 — Quality ratchet (QR-01..08)

- CI audit (`npm audit --omit=dev --audit-level=high`) and Dependabot for `github-actions` and `npm` at root and `site/` (QR-01..02, D6-cited).
- `pack-smoke` fails on 4 named damaged tarballs plus the hermes-agent snippet and prime-agent `MCP.md`; release reruns `check:pack` on the released tarball after version sync (QR-03).
- Coverage floors ratchet `src/fs`, `src/core`, `src/tools`; a raised-floor run exits 1 with BELOW for the raised directory (QR-04). Dead exports are removed per reference analysis; the frozen catalogue stays unchanged (QR-06).
- Fake-clock seams plus the shared scaled-timeout helper; the suite passes on a 1-CPU quota container with competing load (QR-05).
- `fast-check` properties for the canonicalizer and policy parser; a broken canonicalizer fails 1 or more; a scheduled non-blocking mutation run covers the 3 named scopes (QR-07..08).

### 4.3 Phase 14 — Crash safety (CRASH-01..07)

- 4 real-SIGKILL stages with the original intact, 1 orphan per stage, and a sweep that removes only 1 exact-name pattern with audit lines, never following symlinks (CRASH-01, CRASH-05).
- Reconciliation appends exactly 1 marked line per stranded admission and 0 on the second start (CRASH-02; D5 catalogue choice recorded).
- `SessionStore.delete` fsyncs the sessions directory; the reap logs container ids and `recordsDeleted`; the next attach shows 1 notice (CRASH-03..04).
- Same refusal cause code over MCP, ACP and in-process; retry from a stale container reaches active with 1 new container id, never `OPENSHELL_START_FAILED` (CRASH-06..07).

### 4.4 Phase 16 — Omp runs in the sandbox (OMPX-02..05)

- 5 Realm tools with the frozen shape; `retry` stays the realm-retry command; 0 `glob` tools (OMPX-02).
- Fail-closed removes or blocks built-in `write`/`edit`/`bash` by the spike-proved mechanism; `tool_call` stays a backstop; a model `bash` call refuses with 1 catalogue code; product claims follow what the spike proves (guard vs containment per D3) (OMPX-03).
- Advisory registers Realm tools; same-name `read`/`write` displace built-ins; other built-ins stay with the notice (OMPX-04).
- Production acceptance proves a registered write lands in `/workspace` and the host root with 1 admission plus 1 result audit line sharing 1 correlation id (OMPX-05; live-gated).

Handshake deviation is recorded (socket 0700/0600 as the auth boundary, no protocol version) and re-attach stays off behind `REALM_OMP_REATTACH` until live validation exists.

### 4.5 Phase 17 — Observability and audit (OBS-01..04)

- `seq`/`prev` chain verified for untouched, edited, removed and reordered copies; head recovery and Phase 14 reconciliation coverage included (OBS-01).
- One JSON object per line with level, fixed code field and correlation id matching audit lines; 0 new dependencies (OBS-02).
- Counters and timings over the control socket only; 0 network listeners (OBS-03).
- Gateway/driver-loss code is distinct from `AGENTOS_CRASH_LOOP` and appears in every catalogue-enumerating table, doc and test (OBS-04; D5 addition).

### 4.6 Phase 18 — Per-project sandboxes (MULTI-01..06)

- Runtime decision recorded before code (MULTI-01; D5-i). Two `up` calls yield 2 `realm-<sessionId>` sandboxes with distinct `/workspace` bytes, no cross-project write visibility, per-session audit/lock/status, and single-project `down` isolation (MULTI-02..05).
- Outside-root `up` refuses with `POLICY_DENIED`. Aggregate memory/CPU commitment is bounded and documented with existing config and 0 new codes (MULTI-06).

### 4.7 Phase 19 — Resume and checkpoint (RES-01..05)

- Reaper and scratch-mount decisions recorded before code (RES-01; D5-ii/iii).
- Same container id survives daemon kill/restart with `/workspace` intact and 0 second containers; verifier-failing or record-less containers are removed before serving with cause logs (RES-02, RES-05; live-gated).
- Session-owned scratch beyond `/workspace` survives restart and is gone after `down` (RES-03).
- Snapshot/restore returns the workspace byte-for-byte; the mechanism follows a recorded spike (RES-04).

### 4.8 Phase 20 — Release hardening (REL-01..04)

- Unprivileged build job plus privileged publish job; `gh attestation verify` accepts the tarball, `SHA256SUMS` and SBOM (REL-01..02; D6).
- Manual rollback marks a test release a prerelease and re-points docs to a validated known-good tag without touching tags, assets or main (REL-03).
- Changelog omits removed-feature commits via revert pairs or `Removes:` trailers, with earlier-release and revert-of-revert handling (REL-04).

### 4.9 Milestone close

- Audit records all 52 v3.0 IDs as satisfied, carried or superseded with 0 silent gaps; `gsd-tools milestone complete` runs only after a dry run that exits 0; cleanup removes scratch profiles and worktrees per inventory; the release line is 0.3.x and the first v3.0 release is 0.3.0.

### 4.10 PR and ship flow

- Branch from `main`; every change lands through a pull request. `ci.yml` must be green (verify including typecheck, lint, unit, integration and script tests, docs, gate-closure, build, pack and MCP checks on Node 22.x and 24.x; site build; audit), Greptile must report 5 of 5 with 0 open comments, and the merge must run once through the ultrathink ship flow with squash set to match the pull request shape. A `gh pr merge` from a shell is forbidden.
- Human review before merge is required for `.github/workflows/**`, `release/**`, `scripts/release/**`, `LICENSE` and `NOTICE`; each D6 pull request cites D6 in its body.
- Pull requests never edit `CHANGELOG.md` or any version field (`package.json`, `package-lock.json`, the 4 adapter manifests); the release job owns them. Never force-push `main`; never rewrite history without an explicit owner decision.

## 5. Standing Constraints

- **Quality bar (AGENTS.md):** strict TypeScript, ESM, single package; `node:test`; `RealmError` with catalogue codes and `retryable`; a timeout on every async boundary; no silent catch beyond the 10 named QUAL-01 exceptions; `process.env` only at the 4 entry edges; no suppression comments; module-size ratchet; no new dependency without justification, licence and maintenance checks; no host-local absolute paths in committed files; Conventional Commit subjects.
- **Gates (all exit 0 before review):** `typecheck`, `lint`, `test`, `build`, `check:docs`, `check:gates`, `check:pack`, `check:mcp`. Podman-gated suites skip with a named reason when Podman is absent or below 5.x; a skip is never a pass.
- **Podman 5.x:** the supported stack is rootless Podman 5.x (realm account 5.7.1, OpenShell 0.1.5 gateway, Realm compute driver). This checkout host reports Podman 4.9.3, so live-gated proof cannot run here; Realm never installs or upgrades Podman. Live acceptance runs on the realm account.
- **Dirty-tree preservation:** the checkout is on `gsd/phase-15-complete` and may carry owner WIP. Never hard-reset, never discard unowned changes, never edit files outside the assigned zone, and use absolute paths in subagent hands. Owner WIP observed in `src/audit/log.ts` and `src/runtime/config.ts` is left untouched unless explicitly routed.
- **Carried, not in v3.0:** FS-02 (approximation; QR-07 adds confidence only), ANDA-01..04 (engine licence), PRD-DRV-01 (amendment awaits owner except as MULTI-04 needs), UI-01 (accepted limitation). Excluded: TD-06, TD-10 repository settings (owner-only), any change to `docs/specs/realm-spec.xml`, `LICENSE`, `NOTICE`.
- **Standing binding:** QUAL-01 (amended, 10 named exceptions), QUAL-02, QUAL-03.

## 6. Non-Functional Requirements

- NFR-P1 (perf): on the 5.7.1 realm stack, `realm up` reaches active with the 200 s startup budget honored, and control-socket reads return 1 response within 10 s; verified by live production-driver suite (A08.live).
- NFR-S1 (security): under fail-closed, disconnected host `edit`/Realm `write` calls return 0 successes; control socket directory mode 0700 with socket mode 0600; 0 secrets in scanner output; 0 privileged containers; 0 host Docker/Podman sockets mounted; verified by `daemon/e2e`, `lifecycle/no-host-env` and the publish scanner (A08.security).
- NFR-A1 (a11y): the status shows exactly 1 of 2 text labels with a color-independent cue; both labels are distinguishable without color (text alone); verified by plugin tests (A08).
- NFR-I1 (i18n): every result code matches the frozen catalogue in `C` and `en_US` locales, and 0 code paths parse locale-formatted numbers; operator text is English; verified by contract suite (A08).
- NFR-C1 (compliance): 0 off-machine telemetry calls, 0 audit or log PII fields (redaction sentinel present), AGPL-3.0-only licensing preserved, and vulnerability reports route through private GitHub reporting; verified by redaction suite and `check:docs` (A08/A10).

## 7. Linear Programming (to be routed to A01, not executed here)

Duplicate scan first (read-only): `list_issues` for `SPE-*` in the workspace, matching on phase id plus title keywords; reuse the existing issue when a phase title already exists, never create a second issue for one phase. Create only when the scan returns 0 matches for that phase.

- **One issue per phase (8 issues):** titles are 1 short line naming the phase, e.g. `Phase 12: scripted harness and spike`. Detail lives in 1 collapsible `+++ Agent notes` section per issue and holds the linked phase id, plan ids, requirement ids and acceptance counts.
- **One sub-issue per plan, naming its requirement ids:** Phase 12 → 3, Phase 13 → 1 (8 QR ids in 1 sub-issue or 8 requirement sub-issues when reviewers prefer a single-plan split), Phase 14 → 1, Phase 16 → 4 (16-01..04), Phase 17 → 5 (17-01..05), Phase 18 → 15 (18-01..14 plus 18-04b), Phase 19 → 1, Phase 20 → 3. For single-plan phases, prefer 1 sub-issue per requirement when the plan carries more than 4 ids (Phase 13 → 8, Phase 14 → 7, Phase 19 → 5) so each sub-issue stays verifiable on 1 criterion.
- Each issue links exactly 1 phase id (`Phase 12` … `Phase 20`), 1 or more plan ids, and 1 or more requirement ids. No close, no status change and no Tracking write is performed by this spec task.

## 8. Traceability

Each story traces to requirement ids and to criteria in `docs/acceptance.md`. Stories: `docs/requirements/stories.md`; criteria: `docs/acceptance.md`. Every story carries 2 or more automated criteria; the manual-only share is 0/32.

| Story | Phase | Requirement IDs | Plan IDs | Criteria |
|---|---|---|---|---|
| US-101 | 12 | HARN-01..04, OMPX-01, OMP-05 | 12-01, 12-02, 12-03 | AC-1..AC-4 |
| US-102 | 13 | QR-01..08 | 13-01 | AC-5..AC-9 |
| US-103 | 14 | CRASH-01..07 | 14-01 | AC-10..AC-13 |
| US-104 | 16 | OMPX-02..05 | 16-01..04 | AC-14..AC-17 |
| US-105 | 17 | OBS-01..04 | 17-01..05 | AC-18..AC-21 |
| US-106 | 18 | MULTI-01..06 | 18-01..14, 18-04b | AC-22..AC-23 |
| US-107 | 19 | RES-01..05 | 19-01 | AC-24..AC-26 |
| US-108 | 20 | REL-01..04 | 20-01..03 | AC-27..AC-29 |
| US-109 | Milestone | all 52 v3.0 IDs | audit/complete/cleanup | AC-30 |
| US-110 | Ship + Linear | gates, Greptile, CI, protected paths, SPE-* dedup | per-phase ship steps | AC-31..AC-32 |

NFRs trace as follows: NFR-P1 → US-104/US-106 live proof; NFR-S1 → US-103/US-104/US-110 scanner; NFR-A1 → US-104/US-110 docs; NFR-I1 → US-102/US-110 contract suite; NFR-C1 → US-102/US-110 redaction suite.

## 9. Assumptions and Open Questions

1. **HARN-03 ruling:** port 9931 allowlisting and the lever question are undecided; the spec stays provisional for US-101 until the owner rules. Confidence per live-gated item is low until a current-source live run exists on the 5.7.1 realm account.
2. **Podman availability:** the 4.9.3 checkout host cannot produce live proof; all live-gated criteria remain unverified here by design.
3. **Live windows:** Phases 14 (scenario 5 after adoption), 15 follow-ups, 16 O3, 17 (scenarios 5, 6, 10, S17-b), 18 (two-project), 19 (adoption/scratch/snapshot) and 20 (release-run attestation/rollback) need serialized owner-approved windows; this spec schedules none.
4. **No verification performed:** GWT counts, lint, INVEST, ambiguity, testability, traceability and NFR-coverage tools were intentionally not run under the brief instruction to skip gates/formatters; parent verification after join owns those checks. No claim in this spec depends on a skipped tool result.
5. **Linear state unknown:** no `list_issues` call was made in this spec task; the dedup counts in Section 7 are a routing plan for A01, not an observed workspace state.

## 10. Out of Scope

Architecture, product code, schema changes, IaC, release commands, Linear issue creation, gate runs, formatting, and any edit outside `docs/requirements/spec.md`, `docs/requirements/stories.md` and `docs/acceptance.md`.

## 11. v9.0 Addendum — Quality, Toggle, UI Merge, Start Debug, Tracking, Ship (Ta08e-req, 2026-11-21)

**Scope.** This addendum adds US-111 through US-121 and the criteria in `docs/acceptance.md`. Stories US-101 through US-110 and criteria AC-1 through AC-32 are carried unchanged. The addendum covers branch `gsd/close-harn03-crash04-next` on the 0.9.x release line and the outline of v9.0 phases 55 through 59 per `.planning/ROADMAP.md`.

### 11.1 Core value

Realm starts cleanly in the configured workspace, the Omp plugin is fully under operator control, Realm status renders in the additional UI region with a truthful state, and every phase shows its state in 1 Notion page and 1 Linear issue before 1 green pull request merges to main.

### 11.2 Start-error debug (US-111)

- Fresh-build start reaches active with 1 container, 0 module-load errors, and 1 readable audit chain head. The historical `ERR_MODULE_NOT_FOUND` against `dist/src/audit/chain.js` is closed once 0 such errors occur on a fresh build.
- A stored config whose `workspaceRoot` points at 1 nonexistent directory exits 1 with `POLICY_DENIED` and names 1 missing directory; the operator then corrects the stored path. The start requirement is met when 0 start failures remain, or the remaining cause is named with 1 diagnostic naming 1 path and 1 remedy.

### 11.3 Optional plugin toggle (US-112)

- The toggle defaults on: 5 Realm tools register and 1 status paint occurs with no stored setting.
- With the toggle off, 0 Realm tools register, 0 paints occur, and 0 workspace mutations occur; the choice persists across 1 restart. The toggle is orthogonal to the earlier `reattach.enabled` flag, which stays unchanged.

### 11.4 UI merge (US-113)

- With the toggle on, 1 status paint lands in the additional UI region with 0 calls to the under-bar status surface. The paint target is the additional UI (rendered by the Omp host) rather than the `ctx.ui.setStatus(REALM_STATUS_KEY)` slot in `src/omp/plugin.ts`; `adapters/omp/index.js` stays the host shim and gains no realm logic.
- Painted text matches the daemon snapshot in 4 of 4 states (active, disconnected, error, connecting) with 1 label per paint, so the merged UI stays truthful.
- With the toggle off, 0 paints occur and the last truthful text is retained unchanged.

### 11.5 Quality bar (US-114)

- The 8 standard gates each exit 0 with 0 failures on the change branch. Continuous integration is green on 2 of 2 Node versions (22 and 24) with 0 failed jobs. The vulnerability audit exits 0 with 0 dependency drift from the baseline.
- Living quality-bar cases are also hermetic-first: the plugin toggle off-path, the UI paint target, and the doctor health check all run on injected fakes before any live window, so a live window only confirms what hermetic tests already prove.

### 11.6 v9.0 phase close-out (US-115 through US-119)

- **Phase 55 (HEALTH-01, HEALTH-02, US-115).** The doctor check reports pass with 1 installed version when the Omp plugin is healthy, and 1 named remedy per failing case in 3 of 3 cases (not installed, wrong version, not loaded) with 0 installs or removals. The runbook maps 3 outcomes to remedies with dated evidence and 0 foreign-process steps.
- **Phase 56 (STOP-05, STOP-06, US-116).** Every dirty stop carries 1 failed-step cause code across 20 consecutive iterations with `failedTeardowns` equal to 0, or the cause is carried with 1 tested reason and 0 folding into F-41-1. Every wait stays bounded by 1 timeout and the orphan count stays 0.
- **Phase 57 (HTIER-01, US-117).** A live Grok Build session writes 1 audit line attributed `grok-build` with 1 handshake and 6 tools, or GAP-40-01 stays accepted-residual with 1 missing host feature named and 1 verified workaround documented.
- **Phase 58 (KIMV-02, US-118).** The old recorder drops 1 response that the fixed recorder retains in 1 hermetic test; the live rerun keeps 1 wire log with full output and 1 version plus date, or KIMV-02 is carried with 1 tested reason and the GAP-43-03 label is unchanged.
- **Phase 59 (CBIND-01..03, US-119, provisional).** No implementation file lands before owner ratification of `53-DESIGN.md` cited by date. After ratification, implementation follows 53-DESIGN section 4 surfaces with 1 new module, 2 path helpers, 0 new catalogue codes and 0 shims, proven by 6 of 6 hermetic contention cases with stale takeover capped at 3. Until ratification, this section stays provisional and no code is written.

### 11.7 Tracking through Notion (US-120)

- 1 Notion page exists per phase for phases 55 through 59 (5 pages total), each linking 1 phase id and 1 status. Notion is the hub: each phase page links its 1 Linear issue, and each Linear issue links back to its 1 Notion page by id.
- The Linear workspace holds 5 issues with 0 duplicates, each linking 1 phase id, 1 or more plan ids and 1 or more requirement ids, plus 1 sub-issue per plan. Duplicate scans run before creation and reuse an existing issue when a phase title already exists.

### 11.8 Ship (US-121)

- The pull request to main carries 11 of 11 verification checkboxes at exit 0 with every template section completed (Summary, Requirements, Verification, Risk and rollback, Checklist). Greptile reports 5 of 5 reviews with 0 open comments and 1 reviewer approval before merge.
- The merge is 1 squash merge with 0 edited version fields and 0 CHANGELOG lines in the diff. Protected-path human review still applies to `.github/workflows/**`, `release/**`, `scripts/release/**`, `LICENSE` and `NOTICE`.

### 11.9 Non-functional requirements (additive)

NFR-P1, NFR-S1, NFR-A1, NFR-I1 and NFR-C1 are carried forward unchanged. Two additive NFRs apply to the toggle and UI merge and are measured in `docs/requirements/nfr.md`: NFR-S2 (0 tools and 0 paints when off, 5 tools when on) and NFR-A2 (1 additional-UI region, 0 under-bar paints, 4 of 4 truthful states). Regulatory regimes from the brief PII scan are none (`regimes_hint: []`), so no non-negotiable compliance NFR beyond NFR-C1 applies.

### 11.10 Assumptions and open questions

1. **Live windows are human-blocking.** Phases 56, 57 and 58 live criteria and Phase 59 ratification are not proven in this spec task; their criteria stay provisional until the owner runs the live windows. Hermetic criteria alone never pass a live gate.
2. **WSJF scatter is provisional.** Backlog order uses MOSCOW because stakeholder WSJF scores are unavailable. No score was guessed.
3. **Configuration repair is a runtime action.** Pointing `workspaceRoot` at an existing directory (or removing the stale config) is an operator action outside A02 scope; this spec only demands the clean-start outcome and the named diagnostic.

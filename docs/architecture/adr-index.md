# ADR index — Realm v3.0 Containment by Default

**Task:** `Tc8fd-arch` · **Correlation:** `c8fd136c-b9a0-459e-bc27-e2c578d77a08` · **Capability:** `design.adr`
**Recorded via:** `arch_adr_slug` (registry tool) for each title below — the file names an ADR script would generate are cited as `NNNN-<slug>.md`. Full MADR bodies live in `docs/adr/` when the parent records them via `scripts/arch_adr.py`; this index under `docs/architecture/` is the normative record for this task (assignments write to `docs/architecture/`, skip gates/formatters — script not run). Transition check `arch_adr_transition {proposed → accepted}`: `allowed=true` ("proposed -> accepted is allowed").

Status convention: **accepted** = A03 may record it (L2); **proposed** = awaiting owner/A10/A01 decision. No superseding ADR without `--supersedes` linkage (see `a03-architect--stale-design-review`).

## ADR-0001 — Fail-closed default with advisory opt-in

- **Status:** accepted (L2) · **Slug:** `fail-closed-default-with-advisory-opt-in` (`arch_adr_slug` SUCCESS)
- **Context:** v3.0 core value — a file mutation while disconnected must never silently run unsandboxed.
- **Decision:** Policy with no `mode` loads as fail-closed (D4). Disconnected host `edit` and Realm `write` refuse with `REALM_NOT_ACTIVE`, 0 host files. Advisory (warn-and-allow) is explicit opt-in only.
- **Consequences:** Omp guard refuses when inactive; `check:docs` (`default-mode.mjs`) fails any document calling advisory the default.
- **Alternatives:** Lax warn-and-allow default (rejected — silently unsandboxed mutation).

## ADR-0002 — Three-lane DAG for v3.0 phases

- **Status:** accepted (L2) · **Slug:** `three-lane-dag-for-v3-0-phases`
- **Context:** Phases 12,13,14,16,17,18,19,20 share no mutable state across lanes but have strict order inside a lane (ROADMAP).
- **Decision:** Lanes: Omp 12→16 (15 complete between), Runtime 14→17→18→19, Pipeline 13→20, then milestone audit → complete → cleanup. 20 runs last because it alters the release path every earlier ship uses.
- **Consequences:** Lanes may run in parallel; live runs on the realm account take one live lock at a time (account-wide startup reap).

## ADR-0003 — Scripted provider harness as Omp enforcement oracle

- **Status:** accepted (L2) · **Slug:** `scripted-provider-harness-as-omp-enforcement-oracle`
- **Context:** OMPX-01 asks what Omp's extension API can enforce; product claims must follow what the spike proves (guard vs containment per D3).
- **Decision:** One gated command drives a local Omp through a loopback OpenAI-compatible stub (1 `write` call, then a final message) over RPC pipes, no PTY/credentials/tokens. The spike table answers the 3 enforcement questions with the Omp version (registerTool reachability, setActiveTools removal, registerFileWriteFallback redirect) and closes or restates OQ-P5-01/OQ-P5-02.
- **Consequences:** Phase 16 implements only the proved mechanism (remove or block built-in `write`/`edit`/`bash`; `tool_call` stays a backstop). Recorded deviation: socket 0700/0600 as auth boundary, no protocol version; re-attach stays off behind `REALM_OMP_REATTACH` until live validation exists.

## ADR-0004 — Per-session sandbox identity with re-adoption

- **Status:** accepted (L2) · **Slug:** `per-session-sandbox-identity-with-re-adoption`
- **Context:** MULTI (per-project) and RES (resume) need stable identity across daemon restarts without leaking across projects.
- **Decision:** One sandbox per session (`realm-<sessionId>`), one audit file, one lock table, one status snapshot per session. Daemon restart re-adopts a healthy sandbox that passes the 14-check hardening verifier with the same container id; verifier-failing or record-less containers are removed before serving with cause logs. Session-owned scratch `/scratch` survives restart, gone after `down`. Snapshot/restore is byte-exact, mechanism follows a recorded spike (RES-04).
- **Consequences:** Two `up` calls yield 2 sandboxes with distinct `/workspace` bytes, no cross-project write visibility, `down` isolation. Outside-root `up` refuses `POLICY_DENIED` with 0 containers created.

## ADR-0005 — Hash-chained audit with seq prev links

- **Status:** accepted (L2) · **Slug:** `hash-chained-audit-with-seq-prev-links`
- **Context:** OBS-01 requires tamper-evidence (edit/delete/reorder detection) with head recovery.
- **Decision:** Every audit line carries `seq` + `prev` hash links; `realm audit verify` exits 0 untouched and exits 1 naming the first broken line for edited, removed, or reordered copies. Status shows `OPENSHELL_GATEWAY_LOST` distinct from `AGENTOS_CRASH_LOOP` in every catalogue-enumerating table, doc and test. Counters/timings over the control socket only; 0 network listeners.
- **Consequences:** Phase 14 reconciliation appends exactly 1 marked line per stranded admission, 0 on the second start.

## ADR-0006 — Quality ratchet with coverage and mutation gates

- **Status:** accepted (L2) · **Slug:** `quality-ratchet-with-coverage-and-mutation-gates`
- **Context:** QR-01..08 require CI-enforced audit, pack, coverage, timing and property gates.
- **Decision:** CI audit `npm audit --omit=dev --audit-level=high` (Node 24.x) + Dependabot (github-actions + npm, root + `site/`); `pack-smoke` fails on 4 named damaged tarballs; coverage floors ratchet `src/fs`/`src/core`/`src/tools` (raised floor exits 1 with BELOW); fake-clock seams + shared scaled-timeout helper (suite passes on 1-CPU quota container); `fast-check` properties for canonicalizer + policy parser; scheduled non-blocking mutation over the 3 named scopes.
- **Consequences:** Dead exports removed per reference analysis; frozen catalogue unchanged.

## ADR-0007 — HARN-03 warm zero-offender remains owner-blocked

- **Status:** proposed (L2, awaiting owner ruling) · **Slug:** `harn-03-warm-zero-offender-remains-owner-blocked`
- **Context:** Recorded default-configuration warm run FAILED (38 external + 6 DNS = 44 offenders). Only the `LLAMA_CPP_BASE_URL` lever in a proxied scripted configuration passes, and that configuration is not the default. Refusing-proxy (0/0/7) is narrower evidence.
- **Decision:** HARN-03 stays provisional; the zero-offender criterion is not relaxed. Owner ruling required on (a) whether port 9931 joins the allowlist and (b) whether the lever counts as passing.
- **Consequences:** AC-3 is unverified until the ruling + a current-source live run on the 5.7.1 realm account. This ADR proposes no new infrastructure, so it is L2, but its `decision` cannot be marked accepted by A03 alone — it needs the owner.

## v9.0 swarm series (Ta08e-arch)

The four v9.0 decisions are recorded as MADR files under `docs/adr/` by `scripts/arch_adr.py` with swarm-series ids ADR-0001..ADR-0004 (accepted, index verdict pass, `arch_adr_supersession` valid). These ids live in a different series from the Tc8fd-arch ADR-0001..ADR-0007 above and must be cited with their file path to avoid collision. Full bodies: `docs/adr/0001-optional-omp-plugin-toggle-defaults-on.md`, `docs/adr/0002-merge-realm-status-into-the-additional-ui-widget.md`, `docs/adr/0003-name-the-missing-workspaceroot-in-the-start-diagnostic.md`, `docs/adr/0004-publish-the-omp-plugin-contract-before-implementation-tasks.md`. A future series renumbering must supersede, never renumber, existing ids.

## Ultrathink stale-verdict swarm series (Tb559-arch)

Recorded via `scripts/arch_adr.py` with swarm-series ids ADR-0005..ADR-0008 (accepted, `arch_adr_supersession` `valid=true`, heads ADR-0005..ADR-0008). These ids live in the same `docs/adr/` series as the v9.0 ADR-0001..ADR-0004 above and are distinct from the Tc8fd-arch ADR-0001..ADR-0007 series; cite with file path.

- **ADR-0005** — `docs/adr/0005-revalidate-completion-gate-verdict-on-tracker-completion.md` — W1: `release()` revalidates staged artifacts against current tracker rows; stale `partial_failure` retires at 0 pending rows, 1 pending row keeps `not_ready` naming the count.
- **ADR-0006** — `docs/adr/0006-persist-proceed-answer-before-kickoff-and-restore-on-reload.md` — W2: ANSWER + `kickedOff=true` persist before kickoff step 1; reload restores 3 of 3 answers with 0 re-asks.
- **ADR-0007** — `docs/adr/0007-render-incomplete-plan-notice-as-advisory-and-continue.md` — W3: incomplete verdict renders `planAdvisoryNote` advisory and continues; 0 STOP/proceed/confirm strings, 0 manual proceed steps, 1 warning line stays visible.
- **ADR-0008** — `docs/adr/0008-publish-ultrathink-completion-gate-contract-before-implement.md` — contract-first: `API-UltrathinkCompletionGate` 1.0.0 (5 operations) before A05 claims.

## Tb559-be resume swarm series (Tb559r-arch)

Recorded via `scripts/arch_adr.py` with swarm-series ids ADR-0009..ADR-0012 (accepted, `arch_adr.py --list` PASS 12 ADRs 0 findings, `arch_adr_supersession` `valid=true` heads ADR-0005..ADR-0012). Same `docs/adr/` series as ADR-0001..ADR-0008; cite with file path.

- **ADR-0009** — `docs/adr/0009-record-signing-waiver-for-unsigned-be-and-fe-commits-without.md` — waiver for 90b18ce and 0d5032f with 0 keys provisioned (SIGN-01, AC-74).
- **ADR-0010** — `docs/adr/0010-preserve-think-commit-and-split-be-pull-request-to-one-commi.md` — preserve c53a15c on `swarm/Tb559-think`, PR 259 = 90b18ce only on 0d5032f, force-with-lease on swarm branches only (SPLIT-01..02, AC-75..AC-76).
- **ADR-0011** — `docs/adr/0011-extend-host-suite-to-119-and-convert-partial-plan-test-to-ad.md` — `src/host/omp.test.ts` as 6th target, line 454 test becomes W3 advisory, fatal silence unchanged, 119/119 (TEST-01, AC-77).
- **ADR-0012** — `docs/adr/0012-extend-w3-verification-matrix-in-ultrathink-completion-gate-.md` — additive `API-UltrathinkCompletionGate` 1.1.0: optional graphId/unblockingAction/renderCount/failure on `AdvisoryResponse` (UTR-05..06, AC-78..AC-81).

## Swarm task cffd9419 resume swarm series (Tcffd1-arch)

Recorded via `scripts/arch_adr.py` with swarm-series ids ADR-0013..ADR-0015 (accepted, `arch_adr.py --list` PASS 15 ADRs 0 findings). Same `docs/adr/` series as ADR-0001..ADR-0012; cite with file path. `arch_adr_transition {proposed → accepted}`: `allowed=true` ("proposed -> accepted is allowed").

- **ADR-0013** — `docs/adr/0013-split-fake-github-fixture-in-boot-report-test-into-two-conca.md` — split the fake GitHub fixture in `test/host/boot-report.test.ts` into 2 concatenated parts on `swarm/Tb559r-capt09`; 0 literal fixture strings, 0 allowlists, refusal assertions keep 0 echoes (SECSPLIT-01..02, AC-86..AC-88).
- **ADR-0014** — `docs/adr/0014-merge-pull-request-256-conditionally-on-local-and-ci-green-w.md` — merge PR 256 once via the ultrathink ship flow with squash from the 354f00a line after local + CI green; the PR body records 1 Greptile absence note with 0 fake 5-of-5 claims; Greptile absence is the user-accepted substitute (MERGE256-01..02, AC-89..AC-91).
- **ADR-0015** — `docs/adr/0015-run-round-3-gates-and-w3-matrix-on-merged-main-before-linear.md` — 7 r3/release plans on merged main + 9-of-9 W3 on the ultrathink stack `a519184 + 0d5032f`, read-only hash verification, and gate-then-close for `SPE-36512`, `SPE-36513`, `SPE-36515`, `SPE-36516` (R3-01, W3M-01, HASH-02, LIN-02, REP-01, AC-92..AC-96).

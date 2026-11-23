# UNITY n7 — Wave Plan (SPE-37109..37114)

Date: 2026-11-23. Branch: `swarm/Tb559r-fe`. Graph: `ut-aec293bb48` (SPE-37069).
Sole inputs: n1–n6 `.planning/UNITY-n1..n6-*.md`. Record-only: no code, no
Linear rows, no tests/gates, no git writes. Known gates: A1 (topology) +
A3 (Hosted-vs-Library) owner decisions pending (n4 §8, L137-141).

## 1. Defaults applied (n7.1)

The n4 settled/safe-default classifications below are plan axioms for every
wave; no wave re-opens them.

| Axiom | Default | Asserting section |
|-------|---------|-------------------|
| Trigger payload | Edits plus argv commands per `tools.schema.json`; wiring is deferred work, conflicts reject with `LOCK_CONFLICT` | n4 §2 (L34-40) |
| Credentials | Environment-only (`REALM_*` env at entry edges); no secrets in logs or artifacts (redacted via `src/audit/redact.ts`, n6 §3 L88-92) | n4 §3 (L42-52); n5 §6 (L164-165); n6 §4 (L137-139) |
| Persistence | Sandbox persists until down; disconnect+restart rebinds, teardown only at realm down; Realm compute driver owns the container | n4 §4 (L54-63) |
| Conflicting writes | Reject with `LOCK_CONFLICT`, file untouched | n4 §2 (L36-39); n2 (L23-27) |
| Distribution / language | In-repo, `private: true`; TypeScript on Node 22+ | n4 §7 (L92-100) |

## 2. Design contract (n7.2)

n5 (`.planning/UNITY-n5-DESIGN.md`) is the implementation contract. Gated
parts are marked exactly as n5 marks them; nothing below presents a pending
gate as decided.

**Repository identity (n5 §2, L47-61):** canonical identity = remote URL
(`https://github.com/swcstudiospace/realm.git`, n1 §1 L22) normalized
(strip `.git`/trailing slash, lowercase host, resolve `.`/`..`, drop
query/fragment); fallback = symlink-resolved absolute worktree root, flagged
`identity: local` in the manifest. Provisioning is create-once or
attach-on-repeat; repeat MUST NOT duplicate sandbox, mount, or manifest
entry (n5 §2, L63-67).

**Provisioning — two branches, selection `[PENDING A1]` (n5 §3, L69-97):**

- **Branch A — repo-keyed (n3 axis 2, recommended).** One sandbox per repo
  keyed by §2 identity; sessions attach via manifest entry. Create only when
  no live sandbox exists for the key. Teardown-explicit only (n5 §3, L77-83).
- **Branch B — name-based / 1-per-session (settled record).** One sandbox per
  named session run; only same-named runs reattach; cross-session attach
  forbidden. Cost: fresh container per session, re-hitting the blocked
  allocation gate (n5 §3, L85-94).
- **Branch selection itself is `[PENDING A1]`** (ledger P-A1-1); S4
  implementation start is gated on it (P-A1-2) (n5 §3, L96-97).

**Registry manifest (n5 §4, L99-130):** one entry per repo identity at root →
per-project root (sandbox handle, lifecycle state, worktree list) →
per-worktree subdirectory (binding record, journal pointer, scoped
checkout). Paths MUST be validated and non-traversable; out-of-worktree
edits rejected (never clamped); stale/conflicting registration REJECTED and
reported, never overwritten. Manifest MUST be locked/reconciled — CBIND-03
extended, not assumed (Note A13, L123-124); A2 discovery absorbed either way
(L125-130).

**8-state table (n5 §5, L132-154):**

| State | Evidence | Observable |
|-------|----------|------------|
| provisioning | driver create log line; no container id yet | `provisioning` + repo key; no session attachable |
| ready | container id present; gateway `Connected` | `ready`; attach allowed |
| connected | in-sandbox exec probe exit 0 | `connected`; triggers accepted |
| disconnected | control socket closed; container id still present | `disconnected`; state retained, rebind offered |
| reconnecting | reattach attempt + probe; bounded attempts | `reconnecting`; no new triggers queued as applied |
| degraded | ≥1 worktree/probe failing, others exit 0 | `degraded` + failing scope named |
| failed | timeout or terminal cause (socket/config/image absent) | `failed` + cause + remedy pointer |
| torn-down | explicit teardown record; container id absent | `torn-down`; manifest entry tombstoned, not deleted |

**Journaling (n5 §7, L175-188):** each trigger carries an idempotency key
derived from the manifest entry; journal written BEFORE execution (crash =
detectable partial state); outcomes per worktree (`degraded`, not global
failure). Retry bounded and transient-only: allocation/gate failures
retryable; validation/hygiene failures MUST NOT be retried. Journal
retention/GC unpriced (A12) and MUST be priced before journal implementation.

**Gate ledger — verbatim from n5 (L204-214):**

| # | Gated item | Tag | Unblock owner |
|---|---|---|---|
| 1 | Mode choice: Hosted-vs-Library closed (§1(b), §6) | `[PENDING A3]` | Owner (n4 §8, L117-125) |
| 2 | Live session-layer re-check verdict; n3 re-open trigger (§1, §7) | `[PENDING A3]` | Owner + live-window operator (n3 §8, L147-156) |
| 3 | AgentOS-host-unavailable remedy per chosen mode (§7) | `[PENDING A3]` | Owner, after item 1 |
| 4 | Topology branch A (repo-keyed) vs B (1-per-session) selected (§3) | `[PENDING A1]` | Owner (n4 §8, L106-113) |
| 5 | S4 provisioning implementation start (n2 L49) (§3) | `[PENDING A1]` | Owner decision + driver team |
| 6 | Manifest repo-key binding key under chosen branch (§4) | `[PENDING A1]` | Owner decision; derived by design team |
| 7 | Sandbox lifetime / teardown scope per branch (§5, §6) | `[PENDING A1]` | Owner decision |

## 3. Verification gate (n7.3)

n6 baseline (`.planning/UNITY-n6-QUALITY.md`) is the gate: measured
2026-11-23 on the dirty tree — typecheck exit 0, lint exit 0, build exit 0,
test 5867 pass / 1 fail / 97 skip, test:scripts 538 pass (n6 §1, L37-39;
n1 §2, L50-52). The 1 fail is CAPT-09, root-caused to host paths in
uncommitted docs; committed tree clean; a clean re-measure after S1 is the
precondition for any green claim (n6 §1, L40-47).

**10-row disposition summary (n6 §2, L69-84):** 9 IN-SCOPE-REMEDIATION,
1 SUB-ISSUE; zero unbounded rewrites authorized.

| Row | Criterion | Unit(s) |
|-----|-----------|---------|
| Q1 | Module-size ratchet (>1000 lines) | U4 |
| Q2 | Export hygiene | U4, U6 |
| Q3 | Conventional Commit / breaking `!` | U2, U12 |
| Q4 | Error catalogue only (29 codes, no raw text) | U4..U8 |
| Q5 | `node:test`, observable behaviour only | U5, U6, U8 |
| Q6 | Dependency hygiene, lockfile integrity | U12 |
| Q7 | `process.env` only at 4 entry edges | U4, U7 |
| Q8 | No suppressions / silent catch | all touched units |
| Q9 | No host paths in docs (CAPT-09 gate) | SUB-ISSUE-A9 (n4 L155) |
| Q10 | Coverage floors (`src/fs`, `src/core`, `src/tools`) | U5, U8 |

**Exact gate commands (n1 §2, L44-47):** `npm run typecheck`, `npm run lint`,
`npm run test`, `npm run check:gates`, `npm run check:docs`,
`npm run check:pack`, `npm run check:mcp` (plus `test:coverage`,
`test:integration`, `test:scripts`, `build` in CI order).

**What counts as green:** log shapes — leveled JSON lines, first keys
`ts, level, event` then `code`, secrets redacted (n6 §3, L88-92); e.g.
`{"level":"error","event":"daemon.start","code":"DAEMON_START_TIMEOUT"}`,
`grep '"code":"OPENSHELL_GATEWAY_LOST"' requests.log`,
`grep '"code":"PATH_ESCAPE"' requests.log` (n6 §3, L94-103). Rejection
codes (n6 §4, L125-135): `PATH_ESCAPE` (traversal, cross-project write,
cross-repo mount), `CREDENTIAL_PATH_DENIED`, `LOCK_CONFLICT` (double-bind/
double-write), `POLICY_DENIED` (missing token), `REDACTED` (secret-leak
grep = no `rcap1.…` hits), `shell:true` refused at lint + runtime.

## 4. Ordered waves (n7.4/n7.5)

GoT workbook waves mirrored, split into file-disjoint implementation waves
(each unit named by the n1 artifact it touches; within a wave, units touch
disjoint artifacts). n2 deps: `S1→S2→S3→S4→S5→S6; S4,S5→S7; S2,S7→S8;
S2→S9,S10` (n2, L57-64).

| Wave | Content (n2 units) | Touches (n1 §1, L16-22) | Depends on |
|------|-------------------|------------------------|------------|
| **Wave 1 — Discovery** | 3 parallel racers: **reconcile** · **reproduce/diagnose** · **quality audit** | records only (`.planning/UNITY-n1..n7`) | — |
| Wave 2 — Linear/decompose + env unblock | S1/U1 (realmlive up), S-unsblock hygiene; PN-55..59 drafted (filing = A14-gated, §5) | `scripts/`, `docs/`, `sandbox/` | Wave 1 |
| Wave 3 — Contract spine | S2/U2 (contract freeze), S10/U12 (in-repo pack) | `src/contract`, `src/mcp`, `src/cli`, `release/` | Wave 2 |
| Wave 4 — Runtime fix (allocation) | S3/U3 diagnosis + native allocation fix | `src/runtime`, `src/host/runtimes.ts:98-351`, `src/daemon` | Wave 2, Wave 3 |
| **GATE A1/A3** | Owner decisions (n4 §8). Wave 4's allocation fix proceeds regardless of A3 (n5 §1, L32-37); Waves 5–8 MUST NOT start until gate closes | — | — |
| Wave 5 — Provisioning | S4/U4 (selected branch only) | `src/core`, `src/lifecycle` (new provisioning module, Q1/Q2 ceilings) | GATE, Wave 4 |
| Wave 6 — FS + worktrees | S5/U5 (scoped edits), S6/U6 (multi-worktree) | `src/fs`, `src/session/workspace-binding.ts` | Wave 5 |
| Wave 7 — Lifecycle + persistence | S7/U7 (disconnect+restart) | `src/lifecycle`, `src/daemon`, `src/observe` | Wave 5, Wave 6 |
| Wave 8 — Trigger | S8/U8 (idempotency journal, transient-only retry) | `src/tools`, `src/audit`, `src/contract` | Wave 3, Wave 7 |
| Wave 9 — Adapters delta + audit | S9/U9 (pending trio, Grok Bot, GSD parity), U10 (carried reruns 56–58), U11 (close-out 55/59) | `adapters/`, `docs/integration/hosts.md`, `test/`, `scripts/` | Wave 3, Wave 2 |

**Wave 1 status: COMPLETE AUTONOMOUSLY.** Racers: reconcile =
`.planning/UNITY-n1-GROUND-TRUTH.md` + `.planning/UNITY-n2-DECOMPOSITION.md`;
reproduce/diagnose = n1 §6, n3 §8, n5 §1; quality audit =
`.planning/UNITY-n6-QUALITY.md`. Synthesized in n4 + n5 + this plan. A1/A3
remain pending and gate Waves 5–8 (n4 §8, L137-141).

## 5. Milestone audit (n7.6)

| Criterion | Verdict | Evidence (file:line) or blocker + owner |
|-----------|---------|------------------------------------------|
| LINEAR_COMPLETENESS | **FAILED** | `.planning/UNITY-n1-GROUND-TRUTH.md` §3 (L84-86): NOT MET — 52 rows cover GoT plan, not phases; blocker: A14 filing decision, owner (n4 §6, L80-90) |
| QUALITY_BASELINE | PASSED | n1 §2 (L50-60) + n6 §1 (L37-47): baseline measured; 1 fail root-caused (CAPT-09, dirty docs) |
| PLUGIN_STANDALONE | PASSED | n1 §1 (L10-14) + n4 §7 (L94-100): `private: true`, in-repo, TS/Node 22+ |
| SANDBOX_TOPOLOGY | PENDING — A1 | n5 §3 (L69-97) `[PENDING A1]`; owner decision (n4 §8, L104-113) |
| PERSISTENCE_AND_TRIGGER | PENDING — S7/S8 implementation | defaults settled (n4 §2, §4) but wiring unbuilt (n2 L52-53); owner of impl: Waves 7–8 |
| OPENSHELL_AGENTOS_VERIFIED | **PENDING — A3 + allocation gate** | n1 §6 (L131-139) partial; n3 §8 gate blocked by (b) (L140-146); owner (n4 §8, L115-125) |
| FAILURE_VISIBILITY | PASSED | n6 §3 (L88-108) + §6 (L193-205): 29-code catalogue, log shapes, exit codes 0/1/2 |

Counts: PASSED 3 / FAILED 1 / PENDING 3.

## 6. Verify line (audit-time sequence)

Run at audit time, in order (condensed from n6 §5, L147-189; preconditions
S1 — realmlive up, `openshell status` Connected — and chosen A1/A3 branch):

```sh
npm run lint
npm run typecheck
npm run test            # unit; + npm run check:mcp (contract)
# Persistence — V1 1-per-repo [PENDING A1] (n6 §5, L157-171):
realm init --image <name@sha256:digest> --workspace /repo-A --state-dir /state
realm up --workspace /repo-A
git -C /repo-A worktree add /repo-A-wt2 -b wt2   # register wt1+wt2 to sandbox keyed repo-A
# trigger edit + argv; assert journal key = manifest entry; disconnect (no down)
realm up --workspace /repo-A   # rebind, no recreate; assert edits present, sandbox id unchanged
# repeat up+trigger -> re-attach, zero duplicate sandbox/manifest entries (idempotency)
# Persistence — V2 1-per-session [PENDING A1] (n6 §5, L173-182):
realm init --image <name@sha256:digest> --workspace /repo-A --state-dir /state
realm up --workspace /repo-A   # sandbox realm-<sessionId>
realm up --workspace /repo-A   # second session -> distinct sandbox id; assert distinct ids
# trigger, disconnect (client close, no down), reconnect, verify persistence;
# idempotency: repeat up -> same sandbox id
```

Report format required: test counts (pass/fail/skip vs n6 §1 baseline
5867/1/97); log-shape greps from n6 §3/§6 (`DAEMON_START_TIMEOUT`,
`OPENSHELL_GATEWAY_LOST`, `PATH_ESCAPE`, `AUDIT_WRITE_FAILED`,
`AGENTOS_CRASH_LOOP`, `WRITE_NOT_ATOMIC`, `AGENTOS_NOT_CONFIGURED`); rejection
codes from n6 §4 present per attack row; persistence checks (edits present,
sandbox id unchanged after rebind); idempotency check (repeat = zero
duplicate sandbox/manifest entries). V1/V2/V3/V4 executed only as the
conditional sequence until A1/A3 close (n6 §5, L184-189).

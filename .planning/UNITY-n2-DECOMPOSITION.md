# UNITY n2 — Decomposition

Date: 2026-11-23. Branch: `swarm/Tb559r-fe`. Graph: `ut-aec293bb48`.
Sole input: `.planning/UNITY-n1-GROUND-TRUTH.md` (n1). No new facts derived.

## A. Mapping completeness (n2.1 / SPE-37077..37083)

**Phase-native gap, fixed.** n1 §3 table gives phases 55–59 NO ISSUE.
That verdict is superseded below: each outstanding phase gets a
phase-native Issue (code or close-out). The 52 GoT rows
(SPE-37063..37114) are **not phase-native**: they cover the GoT plan
n1..n7 and contain no mapping to HEALTH/STOP/HTIER/KIMV/CBIND phase
acceptance criteria (n1 §3 conclusion). They cannot close a phase.

| Phase | n1 outcome | n2 phase-native Issue | Milestone / phase / outcome / acceptance |
|-------|-----------|-----------------------|------------------------------------------|
| 55 HEALTH-01/02 | COMPLETE at main 7ae9afc | PN-55 close-out: re-verify at HEAD `4f379da` | M-close-out; phase 55; outcome COMPLETE-refresh; accept: 55-VERIFICATION re-run recorded at HEAD, zero new defects |
| 56 STOP-05/06 | CARRIED, live 20-iteration window NOT RUN (gate 2026-11-22) | PN-56 carried window: run window when realmlive up | M-carry; phase 56; outcome window-pass; accept: 20/20 iterations logged, `daemon.stopped` causeCode (b37b94c) observed live |
| 57 HTIER-01 | CARRIED (GAP-40-01/48-01 residual) | PN-57 carried rerun of HTIER live check | M-carry; phase 57; outcome rerun-pass; accept: instrument output matches criteria, GAPs closed or re-scoped |
| 58 KIMV-02 | CARRIED (GAP-43-03 narrowed) | PN-58 carried rerun of KIMV live check | M-carry; phase 58; outcome rerun-pass; accept: recorder + scratch results match criteria live |
| 59 CBIND-01..03 | COMPLETE (59-VERIFICATION 5/5, D-v9-6) | PN-59 close-out: confirm ratification still holds at HEAD | M-close-out; phase 59; outcome COMPLETE-confirm; accept: binding lock criteria re-checked, no regression vs b3fc8b8 |

**Settled defaults (assumptions, not open work).** (1) Trigger = edits
plus argv commands, `tools.schema.json`. (2) Persistence =
disconnect+restart; sandbox lives until realm down. (3) Conflicts
reject with `LOCK_CONFLICT`. (4) Distribution = in-repo,
`private: true` (n1 §1, §7).

**GoT P2 "one Sub Issue per agent" is ALREADY covered — do not
re-create.** The 22-host table (`src/host/runtimes.ts:98-351`, types
`src/host/types.ts:13-36`, n1 §4: 19 recipe, 3 owner-deferred
windsurf/trae/zcode per `docs/integration/hosts.md:49`) plus 5
adapters (`adapters/`, Grok sharing claude-plugin per
`hosts.md:10`) covers agents 19/22. Decomposition creates only delta
work: pending hosts, Grok Bot vs Build naming, and GSD-Core parity
(17 sections vs 22). The GoT trio (omp/claude-plugin/grok-build,
muse-code json-merge) is covered 3/3 (n1 §4).

**Sub Issues, in dependency order** (n1 blockers → contract → runtime
diagnosis → provisioning → fs → worktrees → lifecycle → adapters;
milestone sequence remains P1→P5 per n2 conclusion, and P2 adapters
may start once the P1 contract lands, without waiting for P4/P5):

| # | Sub Issue | Parent | Milestone / phase | Outcome | Acceptance criteria | Independence | Verifiability |
|---|-----------|--------|-------------------|---------|---------------------|--------------|---------------|
| S1 | n1 blockers: realmlive stack up, CAPT-09 hygiene, dirty tree excluded | PN-56/57/58 | M-root / 56-58 | stack live | realmlive socket present, `openshell status` Connected, CAPT-09 green on clean tree | blocks S3, PN-56/57/58 | gate rerun + test log |
| S2 | Plugin contract / CLI spine (P1) | PN-55 | P1 / contract | contract frozen | `tools.schema.json` trigger + host CLI entries accepted by check:mcp | after S1 | schema validation, check:mcp |
| S3 | Runtime diagnosis: layering (gateway-on-host, driver, in-sandbox exec) | PN-56 | P3 / runtime | root layer named | failure mapped to allocation vs protocol (n1 §6a/b); Hosted-vs-Library stays n4-gated | after S1 | decision-record walkthrough |
| S4 | Provisioning: repo-keyed sandbox (P3) | PN-56 | P3 / provisioning | provision spec | 1-per-repo vs 1-per-session decision (n4) recorded; provision path documented | after S3 | spec review |
| S5 | Filesystem scoped edits (P4) | PN-55 | P4 / fs | fs rules | edit scope confined to bound worktree, violations rejected in tests | after S4 | unit + integration tests |
| S6 | Worktrees: multi-in-one-sandbox (P4) | PN-59 | P4 / worktrees | worktree model | discovery answer from binding/53-DESIGN recorded; N worktrees per sandbox proven | after S5 | test with 2 worktrees |
| S7 | Lifecycle + persistence (P5) | PN-56 | P5 / lifecycle | reconnect proven | disconnect+restart test: sandbox survives, session rebinds, realm-down teardown | after S4,S5 | lifecycle test log |
| S8 | Trigger wiring (P5) | PN-55 | P5 / trigger | trigger live | edits + argv commands (tools.schema.json) fire triggers, `LOCK_CONFLICT` on conflict | after S2,S7 | trigger test suite |
| S9 | Adapters delta-only (P2): pending hosts, Grok Bot, GSD parity | PN-55 | P2 / adapters | delta closed | windsurf/trae/zcode dispositioned, Grok Bot existence answered, 17-vs-22 delta recorded | after S2 | hosts.md + runtimes.ts diff |
| S10 | Distribution in-repo (P1/P5) | PN-55 | P1 / release | pack verified | `private:true` pack passes check:pack, no external publish step | after S2 | check:pack log |

**Dependency graph (text edges, `A -> B`):**

```text
S1 -> S2 -> S3 -> S4 -> S5 -> S6
S4 -> S7; S5 -> S7; S2 -> S8; S7 -> S8; S2 -> S9; S2 -> S10
S1 -> PN-56; S1 -> PN-57; S1 -> PN-58; S2 -> PN-55; S2 -> PN-59
PN-56 -> S4; PN-59 -> S6
```

## B. Unit list

- **U1. Unblock live environment.** Goal: bring realmlive stack up so
  gates can open. Phase+milestone: 56–58 / M-root. Acceptance:
  REALM_DRIVER_SOCKET/CONFIG/IMAGE present, `openshell status`
  Connected. Coverage: PARTIAL (root stack healthy, realmlive DOWN,
  n1 §5). Answers: SPE-37077.
- **U2. Freeze plugin contract / CLI spine.** Goal: fix trigger +
  host CLI contract. Phase+milestone: contract / P1. Acceptance:
  `tools.schema.json` validates, check:mcp green. Coverage: PARTIAL
  (schema exists, `realm mcp --host grok-build` in 22-host table
  `src/host/runtimes.ts:98-351`, n1 §4). Answers: SPE-37078.
- **U3. Diagnose runtime layering.** Goal: name exact failing layer.
  Phase+milestone: runtime / P3. Acceptance: allocation-vs-protocol
  mapping recorded; Hosted-vs-Library routed to n4. Coverage: PARTIAL
  (`runtime-decision.md`, `openshell.md:442-446,451,160`,
  `agentos.md:21-30` UNRESOLVED, n1 §5). Answers: SPE-37079.
- **U4. Repo-keyed sandbox provisioning.** Goal: specify 1-per-repo
  provisioning against settled 1-per-session. Phase+milestone:
  provisioning / P3. Acceptance: topology decision (n4) recorded,
  provision path implemented or formally rejected. Coverage: MISSING
  (settled record contradicts; n1 §7 row 1). Answers: SPE-37080.
- **U5. Filesystem scoped edits.** Goal: confine edits to bound
  worktree. Phase+milestone: fs / P4. Acceptance: out-of-scope edit
  rejected in tests. Coverage: PARTIAL (`src/fs/`, `src/session/`
  layout n1 §1; scope rules not in n1). Answers: SPE-37081.
- **U6. Multi-worktree-in-one-sandbox.** Goal: prove N worktrees per
  sandbox. Phase+milestone: worktrees / P4. Acceptance: 2-worktree
  test passes under one sandbox. Coverage: PARTIAL (cross-process
  binding lock b3fc8b8 CBIND-03, `src/session/workspace-binding.ts`;
  multi-worktree not verified, n1 §7 row 2). Answers: SPE-37081.
- **U7. Lifecycle persistence.** Goal: prove disconnect+restart
  survival. Phase+milestone: lifecycle / P5. Acceptance: sandbox
  present after restart, teardown only at realm down. Coverage:
  PARTIAL (`src/lifecycle/` layout n1 §1; default n1 §7 row 6).
  Answers: SPE-37082.
- **U8. Trigger wiring.** Goal: wire edits+argv trigger with conflict
  reject. Phase+milestone: trigger / P5. Acceptance: trigger fires on
  edit and on argv command; concurrent conflict returns
  `LOCK_CONFLICT`. Coverage: PARTIAL (contract EXISTS in
  `tools.schema.json`, n1 §7 row 4; wiring not in n1). Answers: SPE-37083.
- **U9. Adapters delta.** Goal: close only uncovered agent gaps.
  Phase+milestone: adapters / P2. Acceptance: pending-host
  disposition, Grok Bot answered, GSD 17-vs-22 delta recorded;
  zero per-agent re-creation. Coverage: PARTIAL (22 hosts,
  `src/host/runtimes.ts:98-351`; 5 `adapters/`; 3 pending,
  `docs/integration/hosts.md:49`, n1 §4). Answers: SPE-37083.
- **U10. Carried live reruns (56–58).** Goal: run the blocked windows.
  Phase+milestone: 56/57/58 / M-carry. Acceptance: 20-iteration window
  + HTIER/KIMV reruns pass live. Coverage: MISSING (windows NOT RUN,
  n1 §3). Answers: SPE-37077.
- **U11. Close-out verification (55, 59).** Goal: confirm COMPLETE
  holdings at HEAD. Phase+milestone: 55,59 / M-close-out. Acceptance:
  re-verification records at `4f379da` with zero regressions.
  Coverage: PARTIAL (passed at 7ae9afc; HEAD is 7 commits ahead,
  n1 §1). Answers: SPE-37077.
- **U12. In-repo distribution + conflict reject.** Goal: ship via
  private pack with `LOCK_CONFLICT` semantics. Phase+milestone:
  release / P1. Acceptance: check:pack green, no external publish,
  conflict test green. Coverage: EXISTS (`private:true` + 17 scripts,
  n1 §1; defaults in §A above). Answers: SPE-37082.

**Ambiguities left for n4** (copy of n1 §7, no expansion):

| Question | Disposition | Why |
|----------|-------------|-----|
| Topology 1-sandbox-per-repo vs Realm settled 1-per-session | user-decision-required | Settled decision record cited contradicts; owner must arbitrate changing a ratified record. |
| Multi-worktree-in-one-sandbox | discovery-first | Answerable from binding / 53-DESIGN records; no owner input needed. |
| Hosted-vs-Library | user-decision-required | Unresolved at `agentos.md:30`; design fork only the owner can close. |
| Trigger payload | SETTLED (not open) | Edits plus argv commands, `tools.schema.json`. |
| Plugin distribution | safe-default | In-repo, `private: true` package; no external distribution needed. |
| Grok Bot vs Build naming | discovery-first | Check hosts/adapters for any distinct Bot surface before asking. |
| Persistence scope | safe-default | Matches sandbox-persists-until-down; no new decision needed. |

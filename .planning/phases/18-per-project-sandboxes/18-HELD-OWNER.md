# Phase 18 status: IN EXECUTION on gsd/v3-phase18 (plans 01 to 05, 04b and 07 committed; plans 06 and 08 to 14 pending); live items HELD

Recorded by lane B (`gsd/v3-lane-b`), 2026-11-02; updated after the owner's answers, after the plan-check verdict was recorded in `18-PLAN-CHECK.md`, and after the lane's commits. Correction: seven commits on `gsd/v3-phase18` (4bfca1a through e2baed6) were made before that verdict was recorded in this repository, so the precondition in D18-1 was not met when they were made. The owner decides whether those commits stand. None is merged into trunk.

Requirements held: MULTI-01 to MULTI-06 (`.planning/REQUIREMENTS.md`, lines 84 to 89). MULTI-01 has its decision recorded in `docs/integration/runtime-decision.md` (D5(i), 2026-10-30); the runtime is not implemented.

## Why it is held

1. **The execution set is chosen; it is not yet checked beyond structure.** The owner chose the 15-plan set at 96642c1 (18-01 to 18-14 with 18-04b). Its structural check passes. The plan-checker pass beyond structure and the Phase 17 precondition check are pending.
2. **The 18a/18b replan is not used.** It exists only as untracked files in the preserved WIP backup, outside the repository. The gsd-v3 worktree still shows the 14 plans deleted; that WIP is not part of this run's execution set.
3. **Owner answers on record.** The audit.head answer, "Per-session heads (the plan as written)", is recorded in STATE. D18-1 and D18-2 below are resolved by the owner's answers of the same day.

## Exact decisions needed

- **D18-1 (resolved by owner): the execution set is the 15-plan set at 96642c1** (18-01 to 18-14, with 18-04b). The plan-checker verdict is recorded in `18-PLAN-CHECK.md` (final check after round 9: execution-ready, no blockers). General subagents ran it, because the gsd-plan-checker agent was denied model access. The Phase 17 precondition plans (06, 09, 12, 13) are the Phase 18 plans whose external gates are Phase 17 plans: 02 for 06 and 09, 04 for 12, and 03 for 13. Their gate commits are all ancestors of `e2baed6`: 4eba167, 757a6b2 and 3a6decc (17-02); 9e6ed08 (17-04); 6ae7530 (17-03; its subject matches the 17-03 T2 scenario). The gate requires the merge only. The 17-03 scenario 6 and skip-path checks have not run (`17-VERIFICATION.md`, rows T2 and T3).
- **D18-2 (resolved by owner): C1 and C2 ratified as drafted; C7 set by the owner to 4 GiB aggregate memory, 4e9 aggregate nanoCpus, and 2 concurrent sessions.** The drafted values (4 GiB, 8e9 nanoCpus, 4 sessions) are superseded.
- **D18-3 (owner live window): the two-project scenario** (MULTI-05) is held with the other live items in the batched owner window.
- **Owner items (not decided here):** (a) the `TOOL_TIMEOUT` reason, 'A tool call did not finish within its queue timeout.', now also answers lock-wait expiry for `up` and `down`. Keep it or change the text; no new code is added without owner approval. (b) At HEAD, a policy `startupBudgetMs` above the client's `up` bound (about 230 s) lets the create outlive the client's bound (`src/daemon/channel.ts` lines 26 to 29 document this). Choose a schema maximum, or a client bound derived from the policy. (c) Acknowledge the seven pre-record commits before any merge toward trunk.

## What is not done

- Plans 01, 02, 03, 04, 04b, 05 and 07 are implemented and committed on `gsd/v3-phase18`. The lane's focused suites are lane-reported and were not re-run here. Plans 06 and 08 to 14 are not executed.
- No full gate set (typecheck, lint, test, build, test:integration, test:scripts, check:docs, check:gates, check:pack, check:mcp) has run on any Phase 18 head.
- Phase 19 depends on Phase 18 and is held with it (`19-HELD-OWNER.md`).

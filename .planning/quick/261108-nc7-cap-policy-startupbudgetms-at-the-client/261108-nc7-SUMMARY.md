---
phase: quick-261108-nc7
plan: 01
status: complete
commits: 1
plan_head_before: n/a
actuals:
  tasks: 3
  commits: 1
key-files:
  modified:
    - src/core/policy.schema.json
    - src/daemon/channel.ts
    - docs/policy-reference.md
    - test/core/policy.schema.test.ts
    - test/core/policy.test.ts
    - test/core/policy.property.test.ts
    - test/daemon/channel.test.ts
    - test/daemon/daemon.test.ts
---

# Quick 261108-nc7: cap policy startupBudgetMs at the client up wait

`startupBudgetMs` now has `maximum: 200000` in the policy schema, so a budget the client's `up` wait cannot cover fails policy load with `SCHEMA_INVALID` and the daemon does not start.

## Commit

- `a7b765c` feat(policy): cap startupBudgetMs at the client up wait in the schema

## Changes

- Schema: `maximum: 200000` added; default stays 200000.
- `src/daemon/channel.ts`: the comment that documented the old gap now states the guarantee. No constant changed.
- `docs/policy-reference.md`: states the range 1..200000, the `SCHEMA_INVALID` refusal at load, the 230 s `up` wait, and that the runtime guard in the daemon remains as defence in depth.
- Tests: schema accepts 1 and 200000; refuses 200001, 1.5, "1", null (0 test unchanged). The file loader refuses 200001 and loads 200000. The property generator for `startupBudgetMs` stays inside the schema maximum. The channel test pins schema maximum == schema default == `CONTROL_TIMEOUT_MS.up - 30000` and maximum + margin <= up bound. Daemon test "T1 (t)" now uses a budget of 200000 with the injected client bound of 1000 (it wrote 900000, which the maximum refuses); "T1 (q)" (runtime guard) untouched.
- Other test budgets above 200000 routed through the validator: none found.

## Deviations

None. No module-size ceiling was touched or raised (module size gate: no violations).

## Verification run

- `npm run typecheck`, `npm run lint`, `npm run build`: exit 0 (through the lock).
- `node --test` on policy.schema, policy, policy.property, channel (68 tests) and daemon.test (169-test aggregate run): 0 failures.
- `npm run check:gates`: exit 0 (gate closure 4 modules, module size 106 files, no violations).
- `npm run check:docs`: host paths ok, agents sync ok, default-mode ok.

## Known Stubs

None.

## Self-Check: PASSED

# QUICK-SB: policy `startupBudgetMs` gets a schema maximum below the client's `up` bound (Phase 18 owner item b)

Owner decision, 2026-11-08 (recorded in this file as the source): "Schema maximum below the client bound". A policy whose `startupBudgetMs` the client cannot wait for is rejected at policy load, so the failure is `SCHEMA_INVALID` at daemon start rather than an `up` that outlives the client's wait. The other options (derive the client bound from the policy; leave documented) were rejected by the owner.

## Facts (verified at lane HEAD; re-read the lines before editing, they can drift)

- `src/core/policy.schema.json:32-35`: `startupBudgetMs` is `{"type": "integer", "minimum": 1, "default": 200000}` with no maximum.
- `src/daemon/channel.ts:26-49`: the client `up` bound is `STARTUP_BUDGET_DEFAULT_MS` (200_000) plus `UP_REPLY_MARGIN_MS` (30_000), which is 230_000. The default is mirrored, not imported, because the module keeps a five-import allowlist (P6-D10). The channel test derives the default from the schema and asserts the up bound exceeds it. The comment at about lines 26-31 documents the old gap.
- `src/omp/plugin.ts:152-154`: `STARTUP_BUDGET_MS = 200_000` mirrors the schema default for the plugin's attach.
- `src/daemon/daemon.ts:446-455`: a runtime guard refuses `up` with `STARTUP_BUDGET_EXCEEDED` when `remaining < 2 * probeTimeoutMs + policy.startupBudgetMs`, where remaining is the client's up bound minus the elapsed time minus the reply allowance. Keep it as defence in depth. Do not delete a test that pins it unless a replacement proves the same behaviour.
- Live scenario 9 uses the minimum budget of 1, so lowering stays supported.
- `docs/policy-reference.md` documents each policy key.

## Required behaviour

1. `src/core/policy.schema.json` gives `startupBudgetMs` `"maximum": 200000`. The default stays 200000. A policy may lower the budget and never raise it above what the client waits for (the up bound minus its 30 s reply margin). A value above the maximum is `SCHEMA_INVALID` at policy load, through the existing validator and loader path.
2. One invariant, tested: the schema maximum equals the channel's mirrored default, and the maximum plus the reply margin is no more than the client's up bound. Extend the existing channel test that derives the default from the schema, so a future edit of either side fails a test.
3. The plugin's `STARTUP_BUDGET_MS` and its mirror comment stay consistent with the maximum. Change them only if a test shows drift.
4. Tests: policy load accepts 1 and 200000, and refuses 200001, 0 and a non-integer. The default-policy load is unchanged. Search for tests that build a policy through the validator with a budget above 200000 and update only what the maximum legitimately changes; a test that builds a policy object directly, bypassing the validator, is not affected.
5. Docs in the same change: `docs/policy-reference.md` states the key's range; the comment at `src/daemon/channel.ts` about the gap is replaced by the new guarantee.

## Out of scope

`CHANGELOG.md`, `package-lock.json`, `.github/**`, `release/**`, `docs/specs/realm-spec.xml`, the client bound constants themselves, and everything under `.planning/phases/` (the records task owns the Phase 18 held-owner record). Do not touch the live stack.

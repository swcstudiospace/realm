---
phase: 34-capability-tokens-enforce-by-default
plan: "02"
status: complete
requirements: [ENF-01, ENF-03, ENF-04]
merged: "PR 162 (merge commit 4ce8462), flip commit 2637d9a, 2026-11-18"
---

# 34-02 summary: the default of `capabilityTokens.mode` is `enforce`

## What changed

- `src/core/policy.schema.json`: the schema default of `capabilityTokens.mode` is `"enforce"`. A missing policy file, a policy file with no `capabilityTokens` key, and one whose `capabilityTokens` object has no `mode` all load as `enforce`; `"off"` is the opt-out. `src/contract/validate.ts` follows.
- `src/capability/admit.ts`: `DEFAULT_CAPABILITY_POLICY` (frozen: `enforce`, `ttlSeconds` 3600, empty `profiles`) is the one definition for code that does not go through the schema; `capabilityPolicyOf` returns it for a policy literal that omits the member. `src/doctor/capability-checks.ts` imports it and its private default is gone.
- `src/capability/gate.ts`: under `enforce` the gate ensures the keyring when it is built (the daemon start), once, and logs `capability.keyring_ready` (active kid only); a failure logs `capability.keyring_unavailable` at error level with no detail, the gate is still returned, and every attach and verify refuses `POLICY_DENIED` (fail closed). The verify path still never creates the file. `src/daemon/daemon.ts` is not edited (986 lines).
- `src/doctor/capability-checks.ts`: `enforce` with a valid keyring passes and carries the stale-or-unlabelled guidance; `enforce` with no keyring yet is a `warn` (the daemon creates it at start; `realm host token rotate` creates it by hand); the guard classes stay `fail`; an explicit `off` is a `warn`; an unloadable policy is a `warn`.
- `src/core/errors.ts`: the catalogue reason of `POLICY_DENIED` now names capability tokens and `realm doctor`. No new code (29 codes), no wire change, no change to `ToolOutcome` or any MCP or ACP reply shape.
- Documents in the same change: `docs/policy-reference.md`, the Q10 policy table and default statements in `docs/integration/mcp.md`, `AGENTS.md`, and decision D34-1 in `docs/integration/runtime-decision.md` (closes the open question of D32-1).
- Tests that pinned the old default were updated with the flip, with the four-shape load matrix, the `DEFAULT_CAPABILITY_POLICY` equality pin with `validate("policy", {})`, the eager-keyring rows, the doctor rows and the reason-text pin: `test/core/policy.schema.test.ts`, `policy.test.ts`, `errors.test.ts`, `test/capability/admit.test.ts`, `gate.test.ts`, `test/doctor/capability-checks.test.ts`, `test/cli/host-token.test.ts`, `test/daemon/capability-wire.test.ts`, `capability-e2e.test.ts`, `test/docs/capability-token-doc.test.ts`, `test/support/capability-harness.ts`.

## Deviations and notes

- `test/core/policy.property.test.ts`, `test/doctor/checks.test.ts` and `test/daemon/e2e.test.ts` were in the plan's list and are not in the merged change; the flip commit passed CI without them.
- The commit `df6ecec` (`fix(test): drop the redundant nullish fallback`) rides in the same pull request without a `!`; it is test-only.
- The flip commit's subject is the release note text: `feat(capability)!: enforce capability tokens by default; set capabilityTokens.mode to off to opt out`. It reached `CHANGELOG.md` (release 0.5.2, section Added) through the release tooling, which this phase did not edit.
- The pull request landed as a merge commit (`4ce8462`), so the marked commit is listed in the release notes.

## Checks

The change merged through PR 162 with its CI. This summary was written afterwards from the merged commit and the plan; it records no command output of its own.

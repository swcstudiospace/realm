---
phase: 32-capability-tokens-for-stdio-hosts
plan: "03"
subsystem: capability-token-operator-surface
tags: [capability-token, realm-host-token, doctor, recipes-bare, docs, decision-record, spike-cleanup]
requires: [32-01, 32-02]
provides:
  - "src/cli/host.ts: realm host token status and realm host token rotate [--revoke-previous], both without a daemon and without spawning a process; status prints one JSON line of mode, keyring presence, active kid, retired kids with ages and the key file mode, rotate prints key ids only"
  - "src/doctor/capability-checks.ts and src/doctor/checks.ts: the capability-tokens doctor item, appended last after host-plugins, with pass, warn and fail results that name the mode, key ids and counts and a fix command, never a key, a token, a policy value or a path"
  - "test/host/recipes-bare.test.ts: the guard that the 18 default mcp-config manifests and the 15 mcp-config install recipes stay bare (no env, cwd, token or key member)"
  - "docs/integration/mcp.md Q10, docs/integration/host-plugin-contract.md, docs/policy-reference.md and AGENTS.md: the delivery decision, the policy key, the limits and the new commands"
  - "docs/integration/runtime-decision.md D32-1 and docs/integration/capability-token-spike.md section 9: the record of the owner override and what was built"
  - "test/cli/host-token.test.ts, test/doctor/capability-checks.test.ts, test/docs/capability-token-doc.test.ts and the adjusted doctor and CLI tests"
affects: [src/cli/host.ts, src/cli/main.ts, src/doctor, docs/integration, docs/policy-reference.md, AGENTS.md, scripts/spike/capability-token, scripts/check/export-usage-allowlist.json]
key-files:
  created:
    - src/doctor/capability-checks.ts
    - test/cli/host-token.test.ts
    - test/doctor/capability-checks.test.ts
    - test/host/recipes-bare.test.ts
    - test/docs/capability-token-doc.test.ts
  modified:
    - src/cli/host.ts
    - src/cli/main.ts
    - src/doctor/checks.ts
    - docs/integration/mcp.md
    - docs/integration/host-plugin-contract.md
    - docs/integration/runtime-decision.md
    - docs/integration/capability-token-spike.md
    - docs/policy-reference.md
    - AGENTS.md
    - scripts/check/export-usage-allowlist.json
    - test/capability/token.test.ts
    - test/cli/cli.test.ts
    - test/daemon/e2e.test.ts
    - test/doctor/checks.test.ts
    - test/doctor/control-channel.test.ts
    - test/doctor/host-checks.test.ts
    - test/doctor/runtime-checks.test.ts
  removed:
    - scripts/spike/capability-token/token.mjs
    - scripts/spike/capability-token/gate.mjs
    - scripts/spike/capability-token/run.mjs
decisions:
  - "D32-1: the Phase 30 outcome by the frozen rule stands as measured (DROP: M1 not demonstrated, M2 not met); on 2026-11-17 the owner overrode it and directed a BUILD for the value that does not depend on M1, per-host least privilege and verified audit attribution; D30-1 and earlier entries are not rewritten"
  - "Delivery channel: the daemon mints at attach and the host process keeps the token in memory (D3); the other two channels (a token written into the host recipe at install time, an inherited environment variable) were rejected and the reasons are in Q10"
  - "Default stays off; an optional per-host enrollment secret that would authenticate the attach is deferred (OQ-32-04)"
  - "The operator commands need no daemon: a running daemon notices a rotated key file on its next request"
  - "The doctor item runs its own lstat guards before reading the keyring so it can name the failure class, since the keyring module reports every guard failure as one POLICY_DENIED with no detail; a keyring under the configured sandbox state root is a fail"
  - "The throwaway prototype is removed now that the production module has landed; its results stay inline in the spike note sections 5 to 7"
requirements: [CAPT-08, CAPT-09]
metrics:
  tasks: 3
  completed: 2026-11-18
status: merged
---

# Plan 32-03 Summary: the operator commands, the doctor item, the recipe guard, the docs and the decision record

Merged to main in PR 153 (squash `0910e14`). This plan adds no behavior to the gate. It gives the operator a way to see and rotate the keyring, makes misconfiguration visible, pins that no recipe carries a token, and writes down what the feature does and does not stop.

## What shipped

- `realm host token status`: one JSON line with `ok`, `mode` (off, enforce, or unknown when the policy cannot be loaded; the policy-file doctor item reports that failure, so status never makes it an exit reason), `keyring` (absent or present) and, for a present keyring, `active`, `retired` (key id and age in seconds) and `fileMode`.
- `realm host token rotate [--revoke-previous]`: adds a new active key and keeps the previous one verifying for its grace; with the flag it removes every non-active key at once. Creates `k1` on an absent keyring. Both verbs refuse a symlinked or loosely permissioned capability directory with a catalogue refusal and write nothing through it, and both exit 1 with a fixed reason when the runtime config cannot name a state directory.
- The `capability-tokens` doctor item: off is a pass; enforce with a healthy keyring is a pass that names the mode, the active key id, the retired count and the profile count; a retired key past its prune time is a warn; a missing keyring, a symlink, another owner, a wrong mode, a key file over 64 KiB, a malformed keyring and a keyring under the sandbox state root are each a fail with a fix that names a command or a mode; a policy that cannot be loaded is a warn that points to the policy-file item.
- `test/host/recipes-bare.test.ts`: the 18 default `mcp-config` manifests launch the bare value; the table holds exactly 15 `mcp-config` recipes, 3 recipe-pending `mcp-config` rows and one extension row (omp); each recipe registers the bare launcher for its own host id; no recipe text carries env, token, `rcap1`, secret, key or `REALM_` beyond the named exceptions.
- Docs: `docs/integration/mcp.md` Q10 (the same-user limit first, then what the token gives, the delivery decision, the policy key and its table, the capability mapping, the evidence limits), the contract page's command rows and capability section, the policy reference, AGENTS.md (the commands, the layout line and the one-line statement of the limit), D32-1, and section 9 of the spike note. `test/docs/capability-token-doc.test.ts` ties the Q10 tables to the schema and to `requiredCapability`, requires D32-1 and section 9, pins that sections 1 to 8 of the spike note are unchanged, and checks that none of the five files holds a host path.
- The prototype `scripts/spike/capability-token/` (three files) is removed.

## Observed

- Read of `origin/main` on 2026-11-18: the files above exist; `src/cli/host.ts` has `tokenStatus` and `runToken`; `src/doctor/checks.ts` appends `capabilityTokensCheck` last; `docs/integration/mcp.md` has `### Q10. Capability tokens`; `docs/integration/runtime-decision.md` has D32-1; the spike note has `## 9. Outcome after the owner override`; `scripts/spike/capability-token` is not in the tree.
- A running enforcing daemon noticing a CLI rotation with no restart is asserted in `test/cli/host-token.test.ts` (an old token verifies during the grace, a new attach carries the new kid).
- CI on PR 153 passed on Node 22.x and 24.x (regular user).

## Not verified here

- The statement in Q10 that a process that is not a descendant of the `realm mcp` process cannot read the token from `/proc/PID/mem` under `ptrace_scope` 1 is worded "expected, not proven here". The probe was skipped because the harness ran as root (OQ-32-05, INFERENCE).
- The measured figures quoted in Q10 (token sizes, mint and verify cost, the same-user reads E3 and E4) are the Phase 30 spike's, not re-measured here.
- The doctor item and the CLI verbs were exercised against test state directories only; they were not run against a production state directory.
- No enforce-mode run on the production stack.

## Deviations from plan

- The three spike prototype files were deleted as the plan intended; the spike note keeps mentions of the path in sections 1 to 8 as history, and section 9 says so.
- `scripts/check/export-usage-allowlist.json` changed by 14 lines (entries for exports that gained a caller removed or adjusted).

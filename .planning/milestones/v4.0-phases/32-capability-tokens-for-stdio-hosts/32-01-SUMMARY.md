---
phase: 32-capability-tokens-for-stdio-hosts
plan: "01"
subsystem: capability-token-core
tags: [capability-token, hmac, rcap1, keyring, rotation, policy, redaction, least-privilege]
requires: []
provides:
  - "src/capability/token.ts: the rcap1 token (rcap1.PAYLOAD.MAC, Node built-ins only), mintToken and verifyToken, a fixed verify order (format, kid, MAC, payload schema, version, time window, session, capability) with eight internal refusal classes that never reach the wire"
  - "src/capability/keyring.ts: the keyring at rest (state dir, capability/keys.json, mode 0700 and 0600, owner checked, no symlink, regular file of at most 64 KiB), ensureKeyring, readKeyring, rotateKeyring with a grace period (86400 plus 60 seconds) and an emergency revoke, atomic writes, a change detector"
  - "src/capability/admit.ts: requiredCapability (the tool-to-capability mapping over the raw tool object), capabilityPolicyOf and profileFor (the per-host profile; all six capabilities when a host has no entry, none when its entry is empty)"
  - "src/core/policy.schema.json and src/contract/validate.ts: the capabilityTokens policy key (mode off or enforce, ttlSeconds 60 to 86400 default 3600, per-host profiles), default off"
  - "src/audit/redact.ts: a linear redaction pattern for the rcap1 token shape, in every position"
  - "docs/policy-reference.md: the capabilityTokens reference"
  - "test/capability/token.test.ts, keyring.test.ts, admit.test.ts, test/core/policy.schema.test.ts, policy.property.test.ts, test/audit/redaction.test.ts: the seeded refusal matrix, the keyring guards and rotation, the mapping, the schema defaults and the redaction cases"
affects: [src/capability, src/core/policy.schema.json, src/contract/validate.ts, src/audit/redact.ts, docs/policy-reference.md, scripts/check/export-usage-allowlist.json]
key-files:
  created:
    - src/capability/token.ts
    - src/capability/keyring.ts
    - src/capability/admit.ts
    - test/capability/token.test.ts
    - test/capability/keyring.test.ts
    - test/capability/admit.test.ts
  modified:
    - src/core/policy.schema.json
    - src/contract/validate.ts
    - src/audit/redact.ts
    - docs/policy-reference.md
    - scripts/check/export-usage-allowlist.json
    - test/core/policy.schema.test.ts
    - test/core/policy.property.test.ts
    - test/core/policy.test.ts
    - test/audit/redaction.test.ts
decisions:
  - "The token is a signed label: payload keys v, kid, sid, host, caps, iat, exp in a fixed order, MAC is HMAC-SHA256 over a domain separator and the payload bytes; caps are one of the six mcp-config ceiling capabilities, read from the host layer so the token, the schema and the host layer cannot drift"
  - "Verification is deterministic and total: a defect of any kind is one of eight internal classes, and a later layer maps every class to POLICY_DENIED with no class on the wire"
  - "Time window: iat may lead the clock by 60 seconds, exp is exclusive and allows no skew, lifetime is 1 to 86400 seconds"
  - "The keyring is retired by key id, not overwritten: a retired key keeps verifying until retiredAt plus the longest token life plus the skew; revoke drops every non-active key at once"
  - "Every keyring guard failure and every malformed content is POLICY_DENIED with no detail, and no key text enters an error, a log or a snapshot's inspect, JSON or toString"
  - "The default is mode off: the policy key's absence, and the default policy, change nothing"
  - "src/contract/validate.ts stays free of host and capability imports: the type holds profiles as a record of string lists, and the schema enforces the host and capability names"
requirements: [CAPT-02, CAPT-03, CAPT-04, CAPT-05]
metrics:
  tasks: 3
  completed: 2026-11-17
status: merged
---

# Plan 32-01 Summary: the capability token core, the keyring, the policy key and the redaction

Merged to main in PR 145 (squash `c1d1b8f`). Pure core only: nothing in this plan is called by the daemon, the client or any CLI verb. After this plan the token can be minted and verified, the keyring can be created, read and rotated, the policy accepts the new key, and the audit and log redaction layers recognise the token shape. Behavior of every existing install is unchanged.

## What shipped

- `src/capability/token.ts`: `rcap1` tokens. `mintToken` sorts the capabilities and refuses (SCHEMA_INVALID) any claim set the schema stage would refuse, so a minted token is always schema-valid. `verifyToken` runs the eight stages in a fixed order and returns an internal refusal class plus, once the MAC and the payload schema have both passed, the authentic principal (host and kid). Nothing in the module logs, and no result carries a key, a token or a payload text.
- `src/capability/keyring.ts`: the keyring file `capability/keys.json` under the state directory. Directory 0700, file 0600, both owned by the current user, no symlink (opened with `O_NOFOLLOW`), regular file of at most 64 KiB. Creation is atomic and race-safe (two creators leave one key). `rotateKeyring` appends a new active key, keeps the previous key verifying for the grace window, prunes retired keys past their grace and, with `revokePrevious`, removes every non-active key at once. A concurrent rotation is `LOCK_CONFLICT` and the winner is whole.
- `src/capability/admit.ts`: `requiredCapability` reads the single own key of a plain raw tool object (and for exec only the own data member `shell`, no getter runs) and maps read, list, write, retry, status and exec (argv or shell) to a capability, `none` or `unmapped`. `profileFor` returns the sorted capabilities a host's token carries.
- The `capabilityTokens` policy key in `src/core/policy.schema.json` with its type in `src/contract/validate.ts` and the reference in `docs/policy-reference.md`.
- The redaction pattern `rcap1.` plus at least 8 base64url characters plus an optional MAC, linear because the prefix is a literal; a token with its MAC cut off still matches.

## Observed

- Read of `origin/main` on 2026-11-18: the three modules above exist with the exports named here; the schema has `capabilityTokens` with `mode` (enum off, enforce, default off), `ttlSeconds` (60 to 86400, default 3600) and `profiles` (host names and capability names as enums); `src/audit/redact.ts` carries the `rcap1` pattern; the test files exist with the case titles (token matrix, 19 keyring tests, 11 admit tests, redaction cases).
- CI on PR 145 passed on Node 22.x and 24.x after the fix rounds listed under Deviations (CI runs the tests as a regular user).

## Not verified here

- The implementer ran the tests as root locally; the file-mode and owner guards are asserted with an injected uid seam, so the root-only environment is not the evidence for them. The regular-user CI run is.
- The keyring has no live-production use in this plan; no daemon reads it until plan 32-02.
- The mint and verify cost and the token size (194, 209 and 264 bytes) are the spike's figures (Phase 30), not re-measured by this plan.

## Deviations from plan

CI on PR 145 failed before it went green; the fix rounds were in the same PR and changed no design decision:

- A type error.
- A lint finding.
- Test fixtures that only worked as root; they were made to work as a regular user, which is how CI runs them.
- The gate-closure check: `src/contract/validate.ts` must not import host or capability modules, so the policy type holds profiles as a plain record of strings and the schema, not the type, enforces the host and capability names.
- A stale entry in `scripts/check/export-usage-allowlist.json`, which also gained entries for exports the plan adds before their callers exist (later plans edited the file again as callers landed).

The finer detail of each fix round is in the PR history and is not reproduced here.

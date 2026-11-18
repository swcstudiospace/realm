---
phase: 32-capability-tokens-for-stdio-hosts
verified: 2026-11-18
verdict: passed
status: passed
score: "8/8 requirements covered (CAPT-02 to CAPT-09), all met by repository evidence and CI on Node 22.x and 24.x as a regular user; the verifier ran no test, build or live run; the claim is per-host least privilege and verified audit attribution, not isolation from a same-user reader; 8 items outside the evidence reach, listed as behavior_unverified"
ref: "origin/main 0910e14 (PR 153, after PR 145 c1d1b8f and PR 150 3fc89b9)"
behavior_unverified: 8
overrides_applied: 1
override: "Phase 30 criteria outcome (DROP: M1 not demonstrated, M2 not met) overridden by the owner on 2026-11-17 to BUILD, for per-host least privilege and verified audit attribution; recorded as D32-1 in docs/integration/runtime-decision.md and in section 9 of docs/integration/capability-token-spike.md"
covered_files:
  - ".planning/phases/32-capability-tokens-for-stdio-hosts/32-CONTEXT.md"
  - ".planning/phases/32-capability-tokens-for-stdio-hosts/32-01-PLAN.md"
  - ".planning/phases/32-capability-tokens-for-stdio-hosts/32-01-SUMMARY.md"
  - ".planning/phases/32-capability-tokens-for-stdio-hosts/32-02-PLAN.md"
  - ".planning/phases/32-capability-tokens-for-stdio-hosts/32-02-SUMMARY.md"
  - ".planning/phases/32-capability-tokens-for-stdio-hosts/32-03-PLAN.md"
  - ".planning/phases/32-capability-tokens-for-stdio-hosts/32-03-SUMMARY.md"
  - "src/capability/token.ts"
  - "src/capability/keyring.ts"
  - "src/capability/admit.ts"
  - "src/capability/gate.ts"
  - "src/capability/limiter.ts"
  - "src/core/policy.schema.json"
  - "src/contract/validate.ts"
  - "src/audit/redact.ts"
  - "src/audit/log.ts"
  - "src/tools/dispatch.ts"
  - "src/daemon/channel.ts"
  - "src/daemon/daemon.ts"
  - "src/daemon/client.ts"
  - "src/host/attach.ts"
  - "src/omp/extension.ts"
  - "src/cli/stdio-host.ts"
  - "src/cli/main.ts"
  - "src/cli/host.ts"
  - "src/doctor/capability-checks.ts"
  - "src/doctor/checks.ts"
  - "docs/integration/mcp.md"
  - "docs/integration/runtime-decision.md"
  - "docs/integration/capability-token-spike.md"
  - "docs/integration/host-plugin-contract.md"
  - "docs/policy-reference.md"
  - "AGENTS.md"
  - "test/capability/token.test.ts"
  - "test/capability/keyring.test.ts"
  - "test/capability/admit.test.ts"
  - "test/capability/gate.test.ts"
  - "test/capability/limiter.test.ts"
  - "test/core/policy.schema.test.ts"
  - "test/audit/redaction.test.ts"
  - "test/audit/principal.test.ts"
  - "test/tools/principal.test.ts"
  - "test/support/capability-harness.ts"
  - "test/daemon/capability-wire.test.ts"
  - "test/daemon/capability-e2e.test.ts"
  - "test/daemon/client.test.ts"
  - "test/daemon/channel.test.ts"
  - "test/cli/host-token.test.ts"
  - "test/cli/stdio-host.test.ts"
  - "test/omp/extension.test.ts"
  - "test/doctor/capability-checks.test.ts"
  - "test/host/recipes-bare.test.ts"
  - "test/docs/capability-token-doc.test.ts"
covered_digest: "v3:sha256:6147900ba706de08ac6e967789250ae3c21277f4812838c92fdc416a662b3a37"
---

# Phase 32 Verification: capability tokens for stdio hosts

Method: a read-only read of the files above on `origin/main` after `0910e14` (the squash of PR 153), against the requirement statements in `32-CONTEXT.md` ("Requirement IDs"), on 2026-11-18. The verifier read the source modules, the test titles and the docs; it did not run the tests, the build, the live stack or any host. "Met" below means the artifact exists with the content described and CI passed on the three PRs (Node 22.x and 24.x, a regular user); it says nothing about any real host under enforce mode.

What this phase is, stated once: with `capabilityTokens.mode` set to `enforce`, a per-session, per-host token minted by the daemon is carried in memory by the stdio host and checked before the dispatcher, together with policy, and the verified host and key id appear on the audit lines. What it is not: a defence against a process of the same user that can read the token, the process environment, process memory or the key file. The default is `off` and then nothing changes.

## Requirements coverage

| Req | Statement (32-CONTEXT) | Status | Evidence |
| --- | --- | --- | --- |
| CAPT-02 | A per-session, per-host HMAC token (`rcap1`, Node built-ins only), mint and verify in a fixed order with deterministic internal refusal classes, a tool-to-capability mapping and a per-host profile, proven by a seeded refusal matrix | MET | `src/capability/token.ts` (`mintToken`, `verifyToken`, eight stages, eight refusal classes, HMAC-SHA256 over a domain separator and the payload, `timingSafeEqual`); `src/capability/admit.ts` (`requiredCapability`, `profileFor`); `test/capability/token.test.ts` (the matrix with every class, the time-window edges, round trips for every host, and the exhaustive single-character substitution and deletion tests); `test/capability/admit.test.ts` (11 tests); the same matrix is exercised over a real socket in `test/daemon/capability-wire.test.ts` (24 rows) |
| CAPT-03 | A keyring at rest (mode and ownership checked, atomic, no symlink) with rotation by key id, a non-disruptive grace and an emergency revoke | MET | `src/capability/keyring.ts` (0700 directory, 0600 file, owner check, `O_NOFOLLOW`, 64 KiB bound, atomic write, grace of 86400 plus 60 seconds, `rotateKeyring` with `revokePrevious`, `LOCK_CONFLICT` on a concurrent rotation); `test/capability/keyring.test.ts` (19 tests, among them the guards, the race, the exact-second grace edge, rotation, revoke, byte-identical file after a refused rotation, no key text in any error or inspect output); `test/cli/host-token.test.ts` and `test/daemon/capability-wire.test.ts` (an old token verifies in the grace after a rotation, and is refused at once after a revoke) |
| CAPT-04 | The policy has a `capabilityTokens` key (mode off or enforce, `ttlSeconds`, per-host `profiles`) with schema, defaults, type and reference docs; the default leaves behavior unchanged | MET | `src/core/policy.schema.json` (mode default off, ttlSeconds 60 to 86400 default 3600, profiles keyed by the host ids with the six capability names); `src/contract/validate.ts` (`CapabilityTokenPolicy`); `docs/policy-reference.md`; `test/core/policy.schema.test.ts` (defaults, bounds, round trip, invalid rows, and that the schema's host ids and capabilities equal the host layer's); `test/daemon/capability-e2e.test.ts` (mode off: no keyring, no capability line, lines equal those of a client with no host). The type holds `capabilityTokens` as optional so hand-built policy literals still compile; `capabilityPolicyOf` applies the default |
| CAPT-05 | The token shape is redacted by the audit and log redaction layers in every position, linearly | MET | `src/audit/redact.ts` (the `rcap1` pattern, last in the table so existing order is unchanged); `test/audit/redaction.test.ts` (replacement by `redactString` and `redactValue` in every position, the minimum length, a token with its MAC cut off, a linearity test); `test/daemon/capability-e2e.test.ts` (the no-leak scan over every sink) |
| CAPT-06 | With enforcement on, the daemon mints at `capability-attach` and verifies the token in every `tool` request before dispatch, failing closed with `POLICY_DENIED` and no reason on the wire; token AND policy, never OR; the client keeps the token in memory only; MCP, ACP and Omp hosts attach | MET (for what the tests reach; see behavior_unverified 1, 2 and 3) | `src/capability/gate.ts` (`attach`, `check`, fail closed on an unusable keyring); `src/daemon/daemon.ts` (the gate runs before the correlation id and before any dispatcher stage; with no gate the old order is kept); `src/daemon/channel.ts` (`capability-attach` with exactly `selection` and `host`; optional `token` of at most 512 characters); `src/daemon/client.ts` (the token in the `held` closure only; renewal 120 s before expiry; mode off remembered 60 s; an older daemon's SCHEMA_INVALID read as off); `src/cli/stdio-host.ts`, `src/cli/main.ts`, `src/host/attach.ts` (`--host` id reaches the client; an unlabelled session attaches as none), `src/omp/extension.ts` (`host: "omp"`); `test/daemon/capability-wire.test.ts` (24 seeded rows, each exactly `{ id, error: { code: POLICY_DENIED } }`, no admission line, no workspace effect, one log line with the internal class and no token text; plus expiry, revoke, rotation grace, the oracle rows, extra-key rows, token AND policy with `SHELL_NOT_ALLOWED` still reached); `test/daemon/capability-e2e.test.ts` (real client as claude, read-only profile for cursor refusing write, both exec forms and retry, a client with no host refused on every call, revoke, the real stdio entry, the no-leak scan); `test/daemon/client.test.ts` (attach once, renewal, mode off memory, old daemon, no token property or inspect leak); `test/cli/stdio-host.test.ts` and `test/omp/extension.test.ts` (MCP and ACP attach as their `--host` id, Omp as `omp`) |
| CAPT-07 | The verified host and key id are on the audit lines of every tokened call; attaches and refusals are audited within a bound; the chain covers the fields | MET | `src/audit/log.ts` (optional `host` and `kid`, pattern-checked, written after `upId` only when present); `src/tools/dispatch.ts` (a principal of exactly host and kid, otherwise SCHEMA_INVALID); `src/capability/limiter.ts` (60 lines, one per second refill, exact integer arithmetic, no timers); `test/audit/log.test.ts` (the pre-token line shape is byte-identical apart from the timestamp and chain fields); `test/audit/principal.test.ts` (editing the host on a past line breaks the chain); `test/tools/principal.test.ts` (each of the six tools writes host and kid on both lines); `test/capability/gate.test.ts` and `test/daemon/capability-wire.test.ts` (the 61st attach is POLICY_DENIED, a refusal past the bound is answered with no line and a running dropped count, an attach whose audit line fails is AUDIT_WRITE_FAILED and returns no token, two hosts on one session each carry their own verified host) |
| CAPT-08 | `realm host token status` and `rotate` work without a daemon, and a doctor item `capability-tokens` reports mode, keyring and misconfiguration | MET | `src/cli/host.ts` (`tokenStatus`, `runToken`, `--revoke-previous`; prints key ids, ages, counts and the file mode only); `src/doctor/capability-checks.ts` and `src/doctor/checks.ts` (the item appended last, after host-plugins); `test/cli/host-token.test.ts` (status and rotate on an absent keyring, rotation and revoke, no key or token shape or slash-bearing value in any output, symlink and loose-mode refusals write nothing, a running enforcing daemon notices a CLI rotation with no restart); `test/doctor/capability-checks.test.ts` (off, healthy, retired key past its prune time, missing, symlink, owner, mode, malformed, too large, unreadable, under the sandbox state root, unloadable policy, ordering, no leak in any text) |
| CAPT-09 | The delivery decision, the limits (no defence against a same-uid reader) and the owner override are documented and tested; the 18 default manifests and 15 recipes are unchanged | MET | `docs/integration/mcp.md` Q10 (the same-user limit stated in the first paragraph, the three things the token gives, the delivery decision and the rejected channels, the policy table, the mapping table, the evidence limits); `docs/integration/runtime-decision.md` D32-1 (the override, its date and the accepted residuals); `docs/integration/capability-token-spike.md` section 9; `docs/integration/host-plugin-contract.md`, `docs/policy-reference.md`, `AGENTS.md`; `test/docs/capability-token-doc.test.ts` (Q10 after Q9 with the limit in its first paragraph, the Q10 tables equal to the schema and to `requiredCapability`, D32-1 and section 9 present, spike sections 1 to 8 unchanged, no host path); `test/host/recipes-bare.test.ts` (18 default manifests bare; exactly 15 mcp-config recipes, 3 recipe-pending rows and one extension row; no env, token, `rcap1` or key in any recipe). The prototype `scripts/spike/capability-token/` is gone from the tree |

"Met" does not mean enforce mode was run against the production stack, and does not mean a same-user attacker is stopped.

## Key facts checked

- The token module imports no audit code and the gate is the only daemon-side code that touches the keyring and the token module; `src/contract/validate.ts` imports neither the host nor the capability modules (a gate-closure rule the first PR had to be fixed to meet).
- Token and policy are layered: the gate sits in front of the unchanged dispatcher, so a full token cannot widen what policy refuses (tested: a full token under `shellEnabled` false still gets `SHELL_NOT_ALLOWED`).
- A refusal puts no class and no reason on the wire; the class appears only in the daemon log line `capability.refused`. With a gate the token is checked before the shape of the tool, so a caller with no valid token learns nothing from a schema error (the oracle rows pin this).
- The audit principal comes from a verified token only; no request member can set `host` or `kid` (tested with extra members, which are SCHEMA_INVALID from the channel).
- Under enforce an unlabelled `realm mcp` (no `--host`) has no host to attach as and is refused on every call; Omp attaches as host `omp` and is not exempt. Both are owner questions at their defaults (OQ-32-01, OQ-32-02).
- The attach is not authenticated: any process of the same user that can reach the daemon socket can attach as any host in the list and receives that host's profile. The token is a signed label, not an identity of the host. Q10 says so in its first paragraph.
- The 18 default manifests and 15 recipes are unchanged and carry no token; the recipes-bare test pins the counts so adding a recipe forces a decision.
- No new dependency, no new error code (the refusals are POLICY_DENIED, SCHEMA_INVALID, AUDIT_WRITE_FAILED, LOCK_CONFLICT, REALM_NOT_ACTIVE).
- CI: PR 145 needed fix rounds (a type error, lint, test fixtures that only worked as root, the gate-closure rule on `src/contract/validate.ts`, a stale allowlist entry) and went green on Node 22.x and 24.x; PRs 150 and 153 are merged on `main`. Implementers ran tests as root locally; CI ran them as a regular user.

## behavior_unverified

1. **Same-uid readers are not stopped, by design, and the memory-read claim is unmeasured.** The `/proc/PID/mem` probe in `test/daemon/capability-e2e.test.ts` runs only for a non-root Linux user with `ptrace_scope` of 1 or more; the implementers' harness ran as root, so it was skipped and recorded as not run (OQ-32-05). That a non-descendant same-user process cannot read the token from process memory is an INFERENCE, and Q10 words it as "expected, not proven here". The token at rest cannot be read from a file (it is in none), but the key file `keys.json` is readable by the same user, and a same-user reader of it can mint any token.
2. **No live-production run of enforce mode.** Every wire and end-to-end test uses a real daemon over a real socket but fake runtime seams; enforce was not run on the production stack with a real host (Claude Code, Codex, OpenCode) attaching, so what a real host does when its first call is refused or when its connect timeout interacts with an attach is not observed.
3. **The attach is unauthenticated.** A same-user process can attach as any host and obtain that host's profile; the only host-level narrowing that holds is against a caller that can speak only through the host's MCP tools. The optional enrollment secret that would raise this bar is not built (OQ-32-04, Deferred).
4. **The criteria outcome was overridden, not satisfied.** By the Phase 30 frozen rule the outcome is DROP (M1 not demonstrated, M2 not met); the owner directed a BUILD on 2026-11-17. This phase does not re-score either criterion, and the value claimed is per-host least privilege and verified audit attribution only (D32-1).
5. **Local runs were as root.** The implementers ran the tests as root, where file-mode and owner guards depend on an injected uid seam and `chmod` semantics differ; the regular-user result rests on CI (green on Node 22.x and 24.x).
6. **A stale daemon or an older `realm mcp` under enforce.** An older client that does not attach, or a client launched without `--host`, is refused on every call by design; the end-to-end test builds a client without a host, and a real stale binary was not tried. The default stays `off` for this reason (OQ-32-01).
7. **Measured costs are the spike's.** Token size (194, 209 and 264 bytes) and mint and verify cost (about 21 and 24 microseconds) come from the Phase 30 prototype and were not re-measured on the production module.
8. **Refusal auditing is bounded.** Past the bound of 60 lines (then one per second) refusals are still answered but write no line, and only a running dropped count appears in the log; an attacker who can fill the bucket suppresses refusal lines (OQ-32-03 default).

## Residuals (not verdict-blocking)

- **R1: planning bookkeeping.** This verification does not edit `ROADMAP.md`, `STATE.md` or `REQUIREMENTS.md`; registering CAPT-02 to CAPT-09 as satisfied is the orchestrator's step.
- **R2: Phase 30's note.** OQ-32-06 asked that Phase 30 record its outcome as "DROP by the frozen rule, overridden to BUILD by the owner". Section 9 of the spike note and D32-1 carry that wording; sections 1 to 8 are deliberately unchanged, and their mentions of the removed prototype path are history.
- **R3: owner questions at their defaults.** OQ-32-01 (the default stays `off`), OQ-32-02 (Omp attaches as host `omp`), OQ-32-03 (refusals are audited within a bound) and OQ-32-04 (no enrollment secret) stay open for the owner; none blocks this verdict.
- **R4: a non-root measurement is still owed.** Running `test/daemon/capability-e2e.test.ts` once as a regular user with `ptrace_scope` 1 would turn the memory-probe INFERENCE into a recorded result.

## Verdict

passed, with CAPT-02 to CAPT-09 met by repository evidence and CI on Node 22.x and 24.x as a regular user: the token core, the keyring with rotation and revoke, the policy key with its default off, the redaction, the gate before dispatch with POLICY_DENIED and no reason on the wire, the audit attribution under a bound, the client that keeps the token in memory, the stdio and Omp wiring, the 24-row refusal matrix over a real socket, `realm host token status` and `rotate`, the `capability-tokens` doctor item, the recipe guard and the documented limits all exist on `main`. Nothing in the phase is FAILED. The eight items above are not proven and must not be claimed beyond what is stated; in particular nothing here says a same-user process is stopped, that a token identifies a host, that the memory-read boundary was measured, or that enforce mode ran on the production stack. The build rests on an owner override of the Phase 30 criteria outcome, recorded as D32-1.

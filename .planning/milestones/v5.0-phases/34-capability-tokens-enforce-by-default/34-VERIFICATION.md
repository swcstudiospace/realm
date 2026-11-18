---
phase: 34-capability-tokens-enforce-by-default
verified: 2026-11-18
verdict: passed
status: passed
score: "4/4 requirements covered (ENF-01 to ENF-04): ENF-01, ENF-02 and ENF-03 met; ENF-04 met in its intent and partial in its letter (the 34-03 pull request was squashed with a title that has no breaking marker); met by repository evidence, CI on the merged commits, and one dated live window on 2026-11-18 on the production stack in which two real stale client binaries were refused POLICY_DENIED by a daemon on the new default and admitted under an explicit mode off; the claim is per-host least privilege and verified audit attribution, not isolation from a same-user reader; 7 items outside the evidence reach, listed as behavior_unverified"
ref: "origin/main 04ca807 (live window), after PR 159 e7b4d57, PR 162 4ce8462 (flip commit 2637d9a) and PR 168 e4f7bea, plus the recording change that carries this file"
behavior_unverified: 7
overrides_applied: 0
covered_files:
  - ".planning/phases/34-capability-tokens-enforce-by-default/34-CONTEXT.md"
  - ".planning/phases/34-capability-tokens-enforce-by-default/34-01-PLAN.md"
  - ".planning/phases/34-capability-tokens-enforce-by-default/34-01-SUMMARY.md"
  - ".planning/phases/34-capability-tokens-enforce-by-default/34-02-PLAN.md"
  - ".planning/phases/34-capability-tokens-enforce-by-default/34-02-SUMMARY.md"
  - ".planning/phases/34-capability-tokens-enforce-by-default/34-03-PLAN.md"
  - ".planning/phases/34-capability-tokens-enforce-by-default/34-03-SUMMARY.md"
  - "src/core/policy.schema.json"
  - "src/contract/validate.ts"
  - "src/capability/admit.ts"
  - "src/capability/gate.ts"
  - "src/doctor/capability-checks.ts"
  - "src/core/errors.ts"
  - "src/host/refusal-hint.ts"
  - "src/cli/stdio-host.ts"
  - "adapters/claude-plugin/.mcp.json"
  - "adapters/hermes-agent/mcp.json"
  - "adapters/hermes-agent/mcp.snippet.yaml"
  - "adapters/prime-agent/MCP.md"
  - "docs/integration/mcp.md"
  - "docs/integration/runtime-decision.md"
  - "docs/integration/host-plugin-gaps.md"
  - "docs/integration/host-plugin-contract.md"
  - "docs/policy-reference.md"
  - "docs/hosts/snippets/claude-code.md"
  - "docs/hosts/snippets/grok-build.md"
  - "docs/hosts/snippets/hermes-agent.md"
  - "docs/hosts/snippets/muse-code.md"
  - "docs/hosts/snippets/prime-agent.md"
  - "README.md"
  - "AGENTS.md"
  - "CHANGELOG.md"
  - "test/integration/enforce-default.test.ts"
  - "test/host/refusal-hint.test.ts"
  - "test/host/adapters-labelled.test.ts"
  - "test/cli/stdio-host.test.ts"
  - "test/capability/admit.test.ts"
  - "test/capability/gate.test.ts"
  - "test/doctor/capability-checks.test.ts"
  - "test/core/policy.schema.test.ts"
  - "test/core/policy.test.ts"
  - "test/core/errors.test.ts"
  - "test/docs/capability-token-doc.test.ts"
  - "test/docs/host-gaps.test.ts"
  - "test/support/realm-daemon-fixture.ts"
  - "test/support/stdio-world.ts"
  - "test/support/policy-document.ts"
covered_digest: "v3:sha256:106e33f0a53456f7f52569e2b995865d16b6eb73d2f6faf654043a8290cc0bab"
---

# Phase 34 Verification: capability tokens enforce by default

Method: a read of the files above on `origin/main` against the requirement statements in `.planning/REQUIREMENTS.md` (ENF-01 to ENF-04) and the plans' truths, on 2026-11-18, using the executor's report for plan 34-03 and the owner-run live window's results, which are kept outside the repository and were reported to the recording task. The verifier ran no live step. The recording task built the tree and ran the docs tests, `check:docs` and the typecheck for this change.

What this phase is, stated once: the default of `capabilityTokens.mode` is `enforce` instead of `off`. A missing policy file, a policy with no `capabilityTokens` key and one with no `mode` enforce; `off` is the documented opt-out. The daemon creates its keyring when it starts. Every client the repository ships attaches with a host id, an unlabelled or stale client is refused `POLICY_DENIED`, and the refusal is explained on every channel that can carry text without a new error code. It gives per-host least privilege and verified attribution; it does not stop a process of the same user that can read the token or the key file.

## Requirements coverage

| Req | Statement | Status | Evidence |
| --- | --- | --- | --- |
| ENF-01 | The default of `capabilityTokens.mode` is `enforce`; the schema, the defaults, `docs/policy-reference.md`, the README and the tests change together, and a policy file with no `capabilityTokens` key loads as enforce | MET | `src/core/policy.schema.json` (default `enforce`), `DEFAULT_CAPABILITY_POLICY` in `src/capability/admit.ts` (the one non-schema definition, shared with the doctor); the four-shape load matrix and the equality pin in `test/core/policy.schema.test.ts` and `test/capability/admit.test.ts`; `docs/policy-reference.md`, the Q10 table (pinned equal to the schema by `test/docs/capability-token-doc.test.ts`), `AGENTS.md`, decision D34-1 in `docs/integration/runtime-decision.md`, the README. The keyring is created at daemon start (`src/capability/gate.ts`; `capability.keyring_ready` seen once on the live stack). |
| ENF-02 | Every client shipped in the repository (the stdio hosts, Omp, ACP and `realm mcp`) attaches and works under enforce with no policy edit; a test per client class proves it | MET, with three named exceptions | `test/integration/enforce-default.test.ts` against a real daemon over a real socket and a policy file with no `capabilityTokens` key: the 18 `mcp-config` hosts (table-driven), an ACP host, Omp's attach as the extension builds it, the status-class CLI commands, an unlabelled client, the stale frame, the opt-out, a daemon with no policy file. `test/host/adapters-labelled.test.ts` guards every shipped launcher. The exceptions are Muse Code, Prime Agent and Grok Build, which have no host id: their shipped launchers stay unlabelled and are refused by the default, named in GAP-34-01 with the opt-out and the borrowed label; Grok Build has no launcher of its own and is attributed `claude` through the shared bundle. This is the owner-accepted reading (OQ-34-01), not a gap in the proof. |
| ENF-03 | The migration path is documented and visible: `"mode": "off"` opts out, `realm doctor` says what to do when a stale or unlabelled client is refused, and the refusal message names the cause and the fix | MET | The catalogue reason of `POLICY_DENIED` names capability tokens and `realm doctor` (`src/core/errors.ts`, pinned in `test/core/errors.test.ts`); the doctor item's detail carries the guidance and warns on `off` (`src/doctor/capability-checks.ts`, `test/doctor/capability-checks.test.ts`; seen live: `pass` with the guidance sentence); the one-time stderr line of `realm mcp` and `realm acp` (`src/host/refusal-hint.ts`, `src/cli/stdio-host.ts`, `test/host/refusal-hint.test.ts`, four wiring rows in `test/cli/stdio-host.test.ts`; seen live: once across two calls); the Q10 migration subsection (affected and unaffected clients, the opt-out value and object, the five steps in order, the stale-daemon note, the explanation channels, the three hosts with no id), the README subsection, the snippets, GAP-34-01, all pinned by `test/docs/capability-token-doc.test.ts`. |
| ENF-04 | The default flip is a recorded breaking change: its commits carry `!` in the subject so the release notes list them, and the release note text and the migration notes are in the docs | PARTIAL (intent met, letter not) | The flip commit `2637d9a` is `feat(capability)!: enforce capability tokens by default; set capabilityTokens.mode to off to opt out`, landed as a merge commit (PR 162, `4ce8462`), and is listed in `CHANGELOG.md` (release 0.5.2, Added). The release note text is the Release note paragraph of Q10, pinned to that sentence; the migration notes are in Q10. `CHANGELOG.md`, the version fields, `release/milestone.json` and `docs/specs/realm-spec.xml` were not edited by the phase. The letter of the plan was not met: PR 168 (plan 34-03) was squashed with the title `feat(capability): per-client enforce proofs, refusal hint, labelled launchers, migration docs (34-03) (#168)`, which has no marker, and `df6ecec` (test-only, in PR 162) has none. The breaking entry is not lost, but the 34-03 changes are not individually flagged as breaking. |

## Live window

2026-11-18, production stack, account `realmlive`, main commit 04ca807; evidence kept outside the repository (results, step files and the driver; counts, results and hashes only). Two real stale client binaries, built from clean checkouts of the tags v0.4.3 (29d2f2f) and v0.4.9 (cfafa90, the newest tag before `capability-attach`, first shipped in v0.4.10), run as `realm mcp --host claude` against a new daemon on a policy with no `capabilityTokens` key:

| Step | Result |
| --- | --- |
| New daemon, default policy | doctor `capability-tokens` pass (enforce, active key k1); keyring file mode 600 in a directory of mode 700; `capability.keyring_ready` logged once |
| Stale clients (v0.4.3, v0.4.9) | status call refused: outcome `refused`, code `POLICY_DENIED`, `retryable` false; the stale client's stderr was empty; one `capability.refused` log line of class `format` per call; no admission audit line, one refusal line each |
| New build, `--host claude` | status admitted, state `active`; one `capability.attach` line with host `claude` |
| New build, no `--host` | both calls refused `POLICY_DENIED`; the one-time stderr hint appeared exactly once across the two calls |
| Policy `capabilityTokens.mode` `off`, daemon restarted | both stale clients admitted; no capability line written; no keyring created by the attach |
| Close | `realm down` rc 0; no container or sandbox left; the host was clean afterwards |

Run history, stated plainly: the passing run was the sixth. Five earlier runs were invalid or partly invalid because of mistakes in the window script (a precheck that stopped the daemon so that a stale client spawned its own old daemon; a wrong daemon-identity check; a lock file descriptor leak), not because of the product. One run showed a daemon teardown that failed (`daemon.stopped` with code `REALM_STOPPING`, one failed teardown) after about 30 seconds, so the sandbox container was reaped by the restarted daemon. That is not capability behaviour and did not recur, but it was not investigated.

## Key facts checked

- The default is read in two places that cannot drift: the schema and `DEFAULT_CAPABILITY_POLICY`, pinned deep-equal to `validate("policy", {})`.
- No new error code (the catalogue stays at 29), no wire or reply-shape change, `src/daemon/daemon.ts` unchanged by the phase (986 lines).
- Every client class in the table has a passing row under the default; an old client against the new daemon is refused (hermetically by the stale frame row, live by two real binaries); an old daemon with a new client still works (the client reads `SCHEMA_INVALID` to `capability-attach` as off; Phase 32 evidence).
- The guard test fails on a new bare launcher with its file and line, and fails if a named file gains a label or a named host gains an id (proved once with a scratch edit by the executor).

## behavior_unverified

1. **A running old daemon keeps its policy until it restarts.** The daemon loads its policy once at start; after an upgrade a still-running old daemon keeps its old posture, and the default takes effect only when it next starts (documented in the Q10 steps). The stale-daemon note (a new client against an old daemon works) rests on the Phase 32 behaviour; the live window started a new daemon and did not run a new client against an old one.
2. **Muse Code, Prime Agent and Grok Build stay refused.** They have no host id (GAP-34-01, accepted). No real session of any of the three was run against the default; the refusal is proven for an unlabelled `realm mcp` in general, and the docs name the opt-out and the borrowed label.
3. **Two stale builds only.** v0.4.3 and v0.4.9, a status call each, on one machine and one account. No model turn ran, no other stale build and no real host's own stale plugin was run, and the stale client's own text was not captured because its stderr was empty and the wire carries no reason.
4. **No real host was run under the new default in this phase's window.** The 18 hosts are proven by the test rig (a real daemon and `runCli`, not the host binaries); the live host tiers carry a host label and were run in other phases' windows.
5. **The teardown flake is not understood.** One window run showed `daemon.stopped` with `REALM_STOPPING` and one failed teardown after about 30 seconds. It did not recur and is not attributed to capability tokens, but no cause was found.
6. **A daemon with no policy file admits no project.** The validated defaults name no workspace root, so a missing policy file enforces tokens but also refuses every project; a working session was shown only against a policy file with roots. This is existing behaviour, stated in Q10, and was not changed.
7. **The same-user limit is unchanged.** A process of the same uid that can read the token, the process environment, process memory or the key file, or that can attach as any host, is not stopped, and a model with a native shell in its host is such a process. Phase 35 measured the memory-read claim; nothing here upgrades the claim.

## Residuals (not verdict-blocking)

- **R1: the unmarked 34-03 squash.** See ENF-04. If the next release notes should list the launcher and docs changes as breaking, that needs an owner decision or a follow-up commit with a marked subject; the flip itself is listed.
- **R2: planning bookkeeping.** This verification does not edit `ROADMAP.md`, `STATE.md` or `REQUIREMENTS.md`; registering ENF-01 to ENF-04 as satisfied is the orchestrator's step.
- **R3: the final gate sweep of plan 34-03 Task 6** (the full test run, lint, coverage and the script tests as a regular user) is not recorded by this verification. The executor ran the touched test files as `nobody` (56 tests, 0 failures), `check:gates`, `check:docs` and `check:pack`; CI ran the rest on the merged commits.
- **R4: stale documents seen, not changed.** The host plugin contract's doctor sentence in the Capability tokens section still says `pass` for mode `off` and `fail` for a missing keyring, which plan 34-02 changed (`warn` for both); it is not pinned by a test.

## Verdict

passed. ENF-01, ENF-02 and ENF-03 are met: the default is `enforce` and defined once, every shipped client class attaches under it with a test per class (three hosts with no id are named, guarded and refused by design), and a refused client gets the reason text, a one-time stderr line, the doctor guidance and the migration section. ENF-04 is met in its intent and partial in its letter: the flip commit carries the marker and is in the release notes through a merge commit, the release note text and the migration notes are in Q10, and the 34-03 squash title lacks the marker. The live window showed two real stale binaries refused `POLICY_DENIED` by a daemon on the default and admitted under an explicit `off`. The seven unverified items above stay open.

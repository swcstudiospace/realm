---
phase: 35-capability-token-evidence
verified: 2026-11-18
verdict: passed
status: passed
score: "3/3 requirements met (EVID-01 for Set A twice as a regular user, EVID-02 settled, EVID-03 recorded with both drives); the Set B whole-suite run was not made; the claim is measured evidence for capability tokens, not a new defence, and a scripted provider is not a model; 6 items outside the evidence reach, listed as behavior_unverified"
ref: "origin/main cca02fd (v0.5.7 release after PR 178 995170a; live results from PR 175 8a67886 and the window of 2026-11-18)"
behavior_unverified: 6
overrides_applied: 0
covered_files:
  - ".planning/phases/35-capability-token-evidence/35-CONTEXT.md"
  - ".planning/phases/35-capability-token-evidence/35-01-PLAN.md"
  - ".planning/phases/35-capability-token-evidence/35-01-SUMMARY.md"
  - ".planning/phases/35-capability-token-evidence/35-02-PLAN.md"
  - ".planning/phases/35-capability-token-evidence/35-02-SUMMARY.md"
  - ".planning/phases/35-capability-token-evidence/35-03-PLAN.md"
  - ".planning/phases/35-capability-token-evidence/35-03-SUMMARY.md"
  - "docs/integration/capability-token-evidence.md"
  - "docs/integration/mcp.md"
  - "docs/integration/runtime-decision.md"
  - "docs/integration/capability-token-spike.md"
  - "docs/integration/hosts.md"
  - "test/support/memory-probe.ts"
  - "test/support/memory-probe-run.ts"
  - "test/support/memory-probe.test.ts"
  - "test/support/scripted-anthropic-provider.ts"
  - "test/support/scripted-anthropic-provider.test.ts"
  - "test/support/capability-live.ts"
  - "test/support/production-live.ts"
  - "test/daemon/capability-memory-probe.test.ts"
  - "test/integration/capability-live-helpers.test.ts"
  - "test/integration/capability-live-enforce.test.ts"
  - "test/integration/production-live-helpers.test.ts"
  - "test/docs/capability-token-evidence.test.ts"
  - "test/docs/capability-token-doc.test.ts"
---

# Phase 35 Verification: capability token evidence

Method: a read of the evidence page, the summaries and the files above on `origin/main` after PR 178, against the three requirement statements in `35-CONTEXT.md`, together with the live results of the window of 2026-11-18 as reported to the orchestrator and recorded on the evidence page. The documentation tests of this phase (the evidence page guard and the capability-token documentation pins) and `check:docs` were run when the records were written; no other test, build or live run was made for this document. Raw evidence (TAP output, audit-line copies, probe reports, snapshots, wire logs) is kept outside the repository.

What this phase is, stated once: it measures three claims about capability tokens and records each with its tier; it changes no source file and no policy default. It gives no defence: a process of the same user that can read the key file or run the attach step is not stopped, whatever the memory result is.

## Requirements coverage

| Req | Statement (35-CONTEXT) | Status | Evidence |
| --- | --- | --- | --- |
| EVID-01 | A non-root end-to-end run of the capability token tests on a `ptrace_scope` 1 host | MET (Set A) | The evidence page, section EVID-01: Set A, 24 compiled test files, ran twice as uid 5002 (not root) on commit 7c44538 with Node v24.18.0 and `ptrace_scope` 1: 494 tests each, 494 passed, 0 failed, 0 skipped; the host was clean before and after. Set B (the whole unit suite) was not run and the page says so; Set B is recorded without gating EVID-01. |
| EVID-02 | The `/proc/PID/mem` probe, a non-root non-descendant same-uid process, with the result recorded either way | MET, settled | Section EVID-02 and `test/support/memory-probe.ts`: arm N was denied at the open of the memory file (EACCES), 153 regions listed and 0 read, 0 token hits and 0 key hits; arm D (descendant control) found the synthetic needle; arm R (root control) found the real token and key; verdict settled by the frozen rule for Linux 6.8.0-149-generic, `ptrace_scope` 1 and Node v24.18.0. The live observation of plan 35-03 agrees: a non-descendant probe was denied at the memory open for the `realm mcp` process and for the daemon. Q10 of `docs/integration/mcp.md` carries the result in place of the earlier inference. |
| EVID-03 | A live enforce proof: claude through the daemon on the production stack, with the audit lines checked for host and kid | MET, with the scripted-provider limit | Section EVID-03 and `test/integration/capability-live-enforce.test.ts` (2 of 2 passed in the window): the effective mode was enforce with no policy edit; the launcher-driven drive of `realm mcp --host claude` went cold to active in 8088 ms, an unlabelled session was refused `POLICY_DENIED` with no tool work, the audit file held 1 attach line and host claude with kid k1 on every call line, `realm audit verify` passed and an edit of the host or the kid failed it; the host-driven drive had claude itself issue one tools/call against a scripted loopback provider (exit 0, wire methods server/discover, tools/list and tools/call, 2 provider messages, 0 rejected) and the audit file then held 2 attach lines and 4 admission and 4 result lines that passed the check; the leak scan found no token shape and no key text in 71 sinks; the cleanup left the host as it was found. |

"Met" does not mean a same-user attacker is stopped, does not mean a model used Realm, and does not mean any kernel other than the one read in the window.

## Key facts checked

- The tier of every EVID-03 row is named on the page, and the host-driven row says scripted provider, no credential, no real model. The page, Q10, D35-1 and the spike section 10 all say that what is shown is claude issuing the tool call, not a model deciding to use Realm; `test/docs/capability-token-evidence.test.ts` rejects a recorded host-driven row without its wire methods, provider counts and tier, and rejects any sentence that claims claude used Realm with a model.
- The audit check accepts the real lines of an enforce session and rejects each seeded defect (a missing kid, a wrong host, a call line before the attach line, an admission line without a host, a refusal that carries a host); the leak check finds a planted token shape and a planted key text and finds nothing in clean sinks (`test/integration/capability-live-helpers.test.ts`, against the real audit files of the Phase 32 rig).
- The shared-state cleanup includes the keyring directory: a keyring the run created is removed and one that existed is left byte for byte (`test/integration/production-live-helpers.test.ts`); in the window the keyring existed before the run and was left as it was.
- The documentation pins agree with the page: Q10 states the live proof with its date, its tier and the scripted-provider limit; D35-1 exists and leaves D32-1 and D34-1 unchanged; the spike note has section 10 and its sections 1 to 8 are byte-identical to what Phase 30 left; `hosts.md` links the evidence page.
- Run history: the self-check of the probe tests was flaky and was made deterministic in PR 176 (04ca807); the live results were recorded by PR 175 (8a67886); the live proof code landed in PR 178 (995170a).

## behavior_unverified

- Set B, the whole unit suite, was not run as a regular user.
- Other kernels, other `ptrace_scope` values, other Node versions and containers: the memory result holds for the configuration read in the window.
- `process_vm_readv` and `ptrace` attach were not exercised; the probe covers `/proc/PID/mem` and `/proc/PID/environ`.
- A real model turn: the host-driven drive used a scripted loopback provider; claude 2.1.322 needed `ENABLE_TOOL_SEARCH=false` for it.
- The interplay of enforce with the cold attach was observed once and is not the Phase 33 cold-attach proof; hosts other than claude (codex, opencode and the rest) were not part of this proof.
- A first-run row of the plan 35-01 window is not recorded separately; the two recorded runs of Set A are the final runs.

## Residuals (not verdict-blocking)

- **R1: planning bookkeeping.** This verification does not edit `ROADMAP.md`, `STATE.md` or `REQUIREMENTS.md`; registering EVID-01 to EVID-03 as satisfied is the orchestrator's step.
- **R2: the attach is unauthenticated** (a Phase 32 limit, D32-1): the audit lines attribute a call to the host label the client named, and a same-user reader of the key file can mint tokens. An enrollment secret stays deferred.
- **R3: Set B** may be run once as the same user to turn the unrun item above into a recorded result; it would not change EVID-01.

## Verdict

passed. EVID-01 is met for Set A (two runs as a regular user on a `ptrace_scope` 1 host, 494 of 494), EVID-02 is met and settled (a same-uid non-descendant process is denied at the open of the memory file on Linux 6.8 with `ptrace_scope` 1, with both controls found), and EVID-03 is met with its tier stated: on the production stack under the effective default the registered command attached cold, an unlabelled session was refused, the audit lines carried host claude and the active key id with a verifying chain, no token or key text leaked, and claude itself issued a tool call against a scripted provider. The limits above stand and are written on the evidence page.

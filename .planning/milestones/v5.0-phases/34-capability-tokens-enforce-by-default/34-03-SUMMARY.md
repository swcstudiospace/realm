---
phase: 34-capability-tokens-enforce-by-default
plan: "03"
status: complete
requirements: [ENF-02, ENF-03, ENF-04]
merged: "PR 168, commit e4f7bea (squash), 2026-11-18; live window 2026-11-18 on main 04ca807, recorded in this closure change"
---

# 34-03 summary: every shipped client proven under the default, the refusal explained, the migration path written

## What changed

- `src/host/refusal-hint.ts` (new) and `src/cli/stdio-host.ts`: one stderr line on the first `POLICY_DENIED` outcome of a `realm mcp` or `realm acp` process, never more. Two constant texts: an unlabelled session (no host id: add the host flag, or set `capabilityTokens.mode` to `off`, see Q10) and a labelled one (the host id; revoked or rotated key, expired token, a profile without the capability; run `realm doctor`). No token, key, path or policy value. `stdio-host.ts` wraps the one call function both transports hand to their server (symbol `driver.call`, after the Phase 33 serve-early change); a pending-boot `REALM_NOT_ACTIVE` refusal is another code and writes nothing; stdout is unchanged.
- `test/integration/enforce-default.test.ts` (new), against a real daemon over a real socket, policy file with no `capabilityTokens` key: E1 the 18 `mcp-config` hosts (table-driven from the runtime table), each with one `capability.attach` line and its id and a kid on every call line, chain verifies; E2 an ACP host; E3 Omp's attach built as `src/omp/extension.ts` builds it; E4 status, metrics, doctor and the host-less status probe work without a token, the keyring exists before any attach, the doctor item passes; E5 an unlabelled `realm mcp` is refused `POLICY_DENIED` three times with one diagnostic, no admission and no effect on the workspace; E6 the stale tokenless frame is answered with exactly an id and `POLICY_DENIED`; E7 a labelled session with an empty profile is refused and writes the labelled diagnostic once; E8 explicit `off` admits the frame and the unlabelled session, creates no keyring and writes no capability line; E9 no policy file. A comment states that no CLI command issues a tool call (the only senders are the boot driver and Omp's attach).
- `test/host/refusal-hint.test.ts` (new) and four wiring rows in `test/cli/stdio-host.test.ts` (mcp and acp, unlabelled and labelled, another code writes none, pending boot writes none).
- Labelled launchers: `adapters/claude-plugin/.mcp.json` (`--host claude`), `adapters/hermes-agent/mcp.json` and `mcp.snippet.yaml` (`--host hermes`). `test/host/adapters-labelled.test.ts` (new) reads every adapter launcher and every `realm mcp` command line and args array in the code fences of the snippets and the README: each carries a canonical `mcp-config` id or belongs to the named set (Muse Code, Prime Agent and Grok Build, which have no host id); it fails with file and line on a new bare launcher, and fails if a named file gains a label or a named host gains an id.
- Docs: the Q10 migration subsection and the Release note text paragraph (`docs/integration/mcp.md`), GAP-34-01 (`docs/integration/host-plugin-gaps.md`), a sentence in the host plugin contract, the README hosts list and subsection, the claude-code, grok-build, hermes-agent, muse-code and prime-agent snippets and `adapters/prime-agent/MCP.md`; doc pins in `test/docs/capability-token-doc.test.ts`.
- Test support: `test/support/realm-daemon-fixture.ts` gained the options `"no-policy-file"` and `{ profiles }` and `stop()`; `test/support/stdio-world.ts` gained `World.callCode`; `test/docs/host-gaps.test.ts` accepts gap ids up to phase 34.

## Live window (Task 5b, run by the owner, recorded here)

2026-11-18, production stack, account `realmlive`, main commit 04ca807; evidence kept outside the repository. Two real stale clients built from clean checkouts of the tags v0.4.3 (29d2f2f) and v0.4.9 (cfafa90, the newest tag before `capability-attach`, first shipped in v0.4.10), run as `realm mcp --host claude` against a new daemon on a policy with no `capabilityTokens` key:

- The doctor item passed (enforce, key k1); the keyring file was mode 600 in a directory of mode 700; `capability.keyring_ready` was logged once.
- Both stale clients: the status call was refused (outcome `refused`, code `POLICY_DENIED`, `retryable` false); their stderr was empty; the daemon logged one `capability.refused` line of class `format` per call; no admission audit line, one refusal line each.
- The new build labelled `claude`: status admitted, state `active`, one `capability.attach` line with host `claude`. The new build with no host flag: both calls refused, the one-time stderr line appeared exactly once across the two calls.
- With the policy set to `capabilityTokens.mode` `off` and the daemon restarted: both stale clients admitted, no capability line, no keyring created by the attach.
- Run history: the passing run is the sixth. Five earlier runs were invalid or partly invalid because of window-script mistakes (a precheck that stopped the daemon, so a stale client spawned its own old daemon; a wrong daemon-identity check; a lock file descriptor leak). One run showed a daemon teardown that failed (`daemon.stopped` with code `REALM_STOPPING`, one failed teardown) after about 30 seconds, so the restarted daemon reaped the sandbox; this is not capability behaviour and did not recur. The host was clean afterwards.
- The sentence is recorded in the Q10 Evidence limits paragraph; the doc pin accepts the observation date.

## Deviations and notes

- **The pull request was squashed, and its title has no `!`.** PR 168 landed as `feat(capability): per-client enforce proofs, refusal hint, labelled launchers, migration docs (34-03) (#168)`. Plan 34-03 required the marker on every commit of plans 34-02 and 34-03 and called a squash title without it a defect. The release-note entry for the breaking change is not lost: the flip commit `2637d9a` carries the marker and reached `CHANGELOG.md` through merge commit PR 162. The 34-03 changes (the hint, launchers, docs, tests) are listed in the release notes, if at all, only by their ordinary subject.
- E9 deviates from the plan: a daemon with no policy file names no workspace root, so it admits no project and a labelled `realm mcp` session cannot be served by it. E9 proves the posture instead (keyring at start, doctor item passes, the tokenless frame is refused); a working labelled session is proven on a policy file with roots and no `capabilityTokens` key (E1 to E4). The Q10 Evidence limits paragraph says so.
- Files edited outside the plan's list because they were required: `test/docs/host-gaps.test.ts` (it asserted a phase bound of 31), `test/support/stdio-world.ts`, and `stop()` in the fixture (a no-policy daemon cannot be released by `down`).
- Grok Build has no launcher of its own; it shares the Claude plugin bundle (labelled `claude`), so the named set accounts for it by a host-id check and a bundle check, and the bare launchers it covers are the Muse Code and Prime Agent files.
- No commit-range script was added (the plan adds none). The check is a command: `git log --no-merges --format=%s RANGE | grep -vE '^[a-z]+(\([^)]*\))?!: '`; over the phase it prints the 34-03 squash subject, `df6ecec` and the docs and test subjects of the other phases in the range.
- Task 6's final gate sweep and the non-root run of the whole suite are not recorded here. The executor ran the touched test files as `nobody` (56 tests, 0 failures) and `check:gates`, `check:docs` and `check:pack` before the merge; CI ran the rest.

## Checks

The code change merged through PR 168 with its CI. This summary was written afterwards from the merged commit, the executor's report and the live window's results; the live numbers are the owner's evidence, not a command run by the summary's author.

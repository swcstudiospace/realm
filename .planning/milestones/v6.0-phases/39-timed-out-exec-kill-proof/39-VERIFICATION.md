---
phase: 39-timed-out-exec-kill-proof
verified: 2026-11-22
verdict: passed
status: passed
score: "3/3 requirements covered (EXEC-01, EXEC-02, EXEC-03): all met. EXEC-01 met by one dated live run (closeout C: the tree dead 2988 ms after the reply with 269 s of the sleeper's life left, controls held) and, as its evidence, the failing baseline run; EXEC-02 met by the in-sandbox bash /proc-sweep watchdog after a first attempt (coreutils timeout) that failed the same live proof; EXEC-03 met: the reply, bounds, audit line and catalogue are unchanged and pinned, with named observable differences."
ref: "origin/main ed8b814 (the merge of the Phase 39 fix, PR 194, with Phase 41), plus the recording change that carries this file"
behavior_unverified: 6
overrides_applied: 0
covered_files:
  - ".planning/phases/39-timed-out-exec-kill-proof/39-CONTEXT.md"
  - ".planning/phases/39-timed-out-exec-kill-proof/39-01-PLAN.md"
  - ".planning/phases/39-timed-out-exec-kill-proof/39-01-SUMMARY.md"
  - ".planning/phases/39-timed-out-exec-kill-proof/39-02-PLAN.md"
  - ".planning/phases/39-timed-out-exec-kill-proof/39-02-SUMMARY.md"
  - ".planning/phases/39-timed-out-exec-kill-proof/39-03-PLAN.md"
  - ".planning/phases/39-timed-out-exec-kill-proof/39-03-SUMMARY.md"
  - "test/support/process-tree-probe.ts"
  - "test/integration/exec-kill-proof-helpers.test.ts"
  - "test/integration/live-closeout.test.ts"
  - "src/runtime/exec-watchdog.ts"
  - "src/runtime/session-execution.ts"
  - "src/tools/dispatch.ts"
  - "test/runtime/exec-watchdog.test.ts"
  - "test/runtime/session-execution.test.ts"
  - "test/runtime/openshell-routing.test.ts"
  - "test/tools/dispatch.test.ts"
  - "docs/integration/openshell.md"
  - "docs/integration/runtime-decision.md"
  - "docs/integration/omp.md"
  - "docs/policy-reference.md"
  - "AGENTS.md"
covered_digest: "v3:sha256:c49137ccca75c60f07e858f68e5760856bef25e2986fd1ec130b034d17a09f93"
---

# Phase 39 Verification: timed-out exec kill proof

Method: a read of the files above on the branch of PR 194 after the merge `ed8b814`, against EXEC-01 to EXEC-03 in `.planning/REQUIREMENTS.md` and the plans' truths, on 2026-11-18. The live results are copied from the owner-authorized window's evidence (production stack, rootless Podman 5.7.1, account `realmlive`, shared live lock), kept outside the repository and reported to the recording task. The verifier did not run a live step.

What this phase is: finding F-3 said the Phase 36 pass of `live closeout C` could not tell a kill from a sleeper that ended by itself. Plan 39-01 built a proof that does not depend on the sleeper's run time and rewrote closeout C on it, with C2 (an escapee) and D (egress). The baseline run of that proof failed: a timed-out exec's whole process tree kept running in the sandbox, so `TOOL_TIMEOUT` had only ever stopped the local `openshell sandbox exec` client. Plan 39-02 fixed the kill path; its first fix (coreutils `timeout`) was wrong and failed the same live proof, and the final fix is a bash wrapper that sweeps `/proc` and signals each process by pid. Plan 39-03 is the live window and the record.

## Requirements coverage

| Req | Statement | Status | Evidence |
| --- | --- | --- | --- |
| EXEC-01 | A live closeout test runs a sleeper that outlives the timeout window; after `TOOL_TIMEOUT` it is dead within a stated bound, shown by a process-state check inside the sandbox, independent of the sleeper's run time | MET | `live closeout C` (window 2026-11-18): negative control clean, tree in flight at 996 ms, `TOOL_TIMEOUT` after 28103 ms, 5 running at +1378 ms, 0 at +2988 ms, 269 s of the sleeper's 300 s left, 0 running 3000 ms later, then `echo ok` exit 0 and `realm status` active. The bound is 15 s tested and about 3 s observed. The probe itself is proved in the default suite on a real process tree (`exec-kill-proof-helpers.test.ts`, 10 tests). The same proof failed on the build with no watchdog (3 members running up to 15297 ms after the reply), so it can fail. |
| EXEC-02 | If the sleeper survives, the kill path is fixed so a timed-out exec's process tree is killed, the session stays usable, and a hermetic test pins it | MET, after a wrong first attempt | The sleeper survived (baseline). The coreutils `timeout` attempt failed live (the sandbox denies a signal to a process group: EPERM for every caller). The final wrapper passed closeout C and C2 live. Hermetic: `test/runtime/exec-watchdog.test.ts` runs the exact script on real process trees with the builtin `kill` refusing group targets as the sandbox does; its control (no wrapper, only the shell killed) leaves the tree running. The hermetic tests of the first attempt passed and did not catch the failure, because on the host `timeout` can signal a group; the group-kill refusal in the final test closes that gap. |
| EXEC-03 | The timeout contract is unchanged for callers (the retryable reply, the per-call bound, the audit line), and the docs and the finding record state what is proved | MET | Reply: `production live 7` passed; the closeout C reply is `{"outcome":"refused","tool":"exec","code":"TOOL_TIMEOUT","retryable":true}`. Bounds 28000 ms runner deadline and 30000 ms outer bound unchanged and pinned (`session-execution.test.ts`, `openshell-routing.test.ts`, `queue-timeout.test.ts`). Audit: the lines carry the caller's argv or the script's size and hash and no wrapper text (`dispatch.test.ts`). Catalogue unchanged at 29. Observable differences are named in the docs (a missing command still exits 127, with the stderr prefix `realm-exec-wd: line 59:` instead of `/bin/bash: line 1:`; a signal exit is 128 plus the signal; the stall fallback). F-3 is closed in `docs/integration/openshell.md` and the decision is recorded in `runtime-decision.md`; the archived ledger is not edited. |

"Met" for EXEC-01 and EXEC-02 means the process tree of the exec, as the in-sandbox sweep can reach it, is dead about 3 s after the reply on one image and one stack. It does not mean every process an exec could start is ended.

## Earlier records that need a correction

- `36-DISPOSITIONS.md` (OI-10, F-3), `36-VERIFICATION.md` (behavior_unverified 2) and the v5.0 audit already said the Phase 36 pass of `live closeout C` could not tell a kill from a sleeper ending by itself. Those statements stand; they are archived history and were not edited. What they left open is answered: the tree survived (baseline), so the pass was the sleeper's own run time, and the `TOOL_TIMEOUT` reply of every build before Phase 39 left the exec's processes running in the sandbox.
- The earlier title of the test, "leaves no process behind in the sandbox", was true of the assertion it made and not of the system. It is replaced by the Phase 39 title.
- `docs/integration/openshell.md` carried the Phase 36 sentence that the run "does not show that the timeout itself kills it"; it now points to the Phase 39 paragraph. No earlier document in `docs` claimed a kill proof.
- The first fix's records (the `timeout` argv, `/usr/bin/timeout` as an image requirement, a 1.5 s kill grace) existed in the Phase 39 plans only; they carry a revision note (39-CONTEXT D-39-13).

## behavior_unverified

1. **A fully detached process is not reached.** A process that is orphaned, clears its environment and closes both exec output pipes cannot be told from an unrelated process. The lab saw one such orphan survive; the hermetic test records the class as surviving; no live closeout scenario asserts it. The sandbox deletion ends it.
2. **One image, one stack, one run per scenario.** Closeout C, C2 and D each passed once on the final fix, on a loaded host (load 5 to 46). `production live 7` passed once. The window tree was built before the merge commit `ed8b814` and carries the same wrapper.
3. **A lost client.** The lab showed a client killed at about 28.1 s with the wrapper deadline at 28.5 s left no survivor by t=30; no repository test or closeout scenario covers it, and the stall fallback (the elapsed-time `TOOL_TIMEOUT`) is pinned only with a fake clock.
4. **Image dependencies.** The wrapper needs `/usr/bin/bash` 5.0 or newer, `sleep` and `cat`. The shipped image has bash 5.2.15 (lab) and coreutils 9.1 (closeout C); a custom image without them fails every dispatcher exec. No doctor check exists (the doctor cannot exec into the sandbox).
5. **Residual race risk.** The wrapper's poll was stress-tested hermetically (about 13000 quick runs) after two defects were found and fixed; the live runs are few. The wrapper's cost on a quick exec was measured in the lab only (about 50 ms).
6. **The coprocess tick.** The tick uses a bash coprocess (anonymous pipes). It ran in the live window under the sandbox's seccomp and Landlock and worked; no other sandbox configuration was tried.

## Residuals (not verdict-blocking)

- **R1: planning bookkeeping.** This verification does not edit `ROADMAP.md`, `STATE.md` or `REQUIREMENTS.md`; registering EXEC-01 to EXEC-03 as satisfied is the orchestrator's step.
- **R2: a stale step in closeout C.** Closeout C still asserts that `/usr/bin/timeout --version` exits 0 (a requirement of the first fix, which the final fix does not have). The check passes on the shipped image (coreutils 9.1) and should be removed or reworded in a later test change; the live result above does not depend on it.
- **R3: upstream.** Whether to file the measurements on NVIDIA/OpenShell issues 5042 and 4946 is the owner's call. A cgroup per exec or a kill call in OpenShell is the only way to reach a fully detached process.
- **R4: the sweep cost.** The sweep reads the fd table of every process it can see; that is cheap as the sandbox user and slow for a root caller on a busy host (the hermetic test drops to uid 65534 for that reason).

## Verdict

passed, with EXEC-01, EXEC-02 and EXEC-03 met: a timed-out exec's process tree is now ended inside the sandbox within about 3 s of the `TOOL_TIMEOUT` reply (shown by a process-state check with controls and a run-time-independent margin), after the baseline run showed it survived and a first attempt failed; the reply contract is unchanged. The limits are the six items above.


## Re-verification at main 7ae9afc (2026-11-22, autonomous)

Full local suite executed on main 7ae9afc: 5945 tests, 5849 pass, 0 fail, 96 skipped (Podman-gated). Prior verdict (passed) stands; covered files changed only by later merged phases.

_Re-verifier: Omp (main session)_

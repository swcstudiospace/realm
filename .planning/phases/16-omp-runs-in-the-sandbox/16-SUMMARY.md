# Phase 16 summary: Omp runs in the sandbox

Date: 2026-11-02. Tree: `gsd/v3-autonomous` at `4b9cebb`. Plans: `16-01` to `16-04`. Context: `16-CONTEXT.md`, section "Decisions added 2026-11-01". Verification status: **human_needed** (see `16-VERIFICATION.md`). No requirement is marked passed here, and this summary does not edit `REQUIREMENTS.md` or `STATE.md`.

## Units

| Plan | Unit | Commit | Files changed (commit stat) | Status |
|---|---|---|---|---|
| 16-01 | O1: host-tool policy, lifetime, registered results | `2e5e6c5` feat(omp): keep bash for the guard in fail-closed and bound host tool changes (phase 16, OMPX-02/03/04) | `src/omp/plugin.ts` (68 lines), `src/omp/tools.ts` (42), `test/omp/plugin.test.ts` (301), `test/omp/tools.test.ts` (156) | committed; fake-backed verification |
| 16-02 | O2: consumer controls and bounded guard evidence | `2af03b6` test(omp): add fake-backed consumer controls and bounded guard evidence (phase 16, OMPX-02/03/04) | `test/integration/omp-guard.test.ts` (216), `test/integration/omp-live-helpers.test.ts` (128), `test/support/omp-rpc.ts` (52), `test/support/scripted-provider.ts` (86) | committed; live cases gated on `REALM_LIVE_OMP`, not run |
| 16-03 | O3: production OMPX-05 acceptance | none | none (the four O3 files have no commit on this branch) | **not executed; human-needed** (live window not approved) |
| 16-04 | O4: bounded re-attach behind `REALM_OMP_REATTACH` | `984d758` feat(omp): re-attach the plugin after a dropped link, behind REALM_OMP_REATTACH (phase 16, O4) | `src/omp/extension.ts` (15), `src/omp/plugin.ts` (257), `test/omp/extension.test.ts` (114), `test/omp/plugin.test.ts` (387) | committed; default off; live validation pending |
| merge | PR #46 branch `integrate/omp-18142` (head `618a579`) into the run branch | `4b9cebb` Merge branch 'integrate/omp-18142' into gsd/v3-autonomous | 13 files, 670 insertions, 89 deletions (see Deviations) | merged |

Commit stat figures are from `git show --stat` on each commit.

### 16-01 (O1)
- Fail-closed keeps `bash` active so the `tool_call` guard refuses it with `POLICY_DENIED`. `edit`, `eval`, `ast_edit`, `lsp`, `debug`, `task` and `web_search` stay removed. The guard is a backstop, not process containment.
- Every host tool change goes through a bounded queue. The mode is published only after readback. Restore covers only names the extension owns and that are still registered.
- Registered reads carry a SHA-256 digest, byte count and truncation flag.

### 16-02 (O2)
- Scripted provider exposes the tool results of its next request, keyed by tool call id. Request handling and the C1 to C4 chunk sequence are unchanged.
- Gated cases in `omp-guard.test.ts` cover the advisory to fail-closed change, model `bash` denial (`POLICY_DENIED`, not "Tool bash not found"), a registered `write` then `read`, and the C4 native patch CREATE. They skip without `REALM_LIVE_OMP`.
- Captures are bounded and strip `authorization`, `api-key`, `token` and `secret` fields.

### 16-03 (O3)
- Not executed. No task of this plan sets `REALM_LIVE_OMP` or `REALM_LIVE_PRODUCTION`, and no container command was run. The offline helpers and the skipped scenario (T1, T2) have no commit on this branch.

### 16-04 (O4)
- Equal-jitter re-attach: base 1 s, cap 60 s, 8 attempts. `REALM_OMP_REATTACH` is read only at the extension edge. Unset or `0` is off, `1` is on, and any other value fails at load with `SCHEMA_INVALID`.
- A dropped link (`REALM_NOT_ACTIVE` or `TOOL_TIMEOUT`) moves the link sub-state to reconnecting. Exhaustion or a non-retryable outcome reaches FAILED with a catalogue code and a `/realm-retry` notice. Shutdown clears timers. Re-up is idempotent.
- An in-flight Realm `write` or `exec` that loses the link reports `AUDIT_OUTCOME_UNKNOWN` and is not dispatched again.

## Verification

Results are those reported for each commit and for the merged tree. This closeout did not rerun build, typecheck, lint or tests.

| Scope | Command or check | Result |
|---|---|---|
| O1 `2e5e6c5` | typecheck, lint, full suite | pass; full suite 2483 pass, as recorded in `STATE.md` |
| O2 `2af03b6` | typecheck, lint; `node --test dist/test/integration/omp-live-helpers.test.js` with `REALM_LIVE_OMP` unset | pass; 80 hermetic helper tests pass |
| O2 `2af03b6` | `dist/test/integration/omp-guard.test.js` with `REALM_LIVE_OMP` unset | seven gated cases skip (reason names `REALM_LIVE_OMP`) |
| O4 `984d758` | `node --test dist/test/omp/plugin.test.js dist/test/omp/extension.test.js` with `REALM_OMP_REATTACH` unset | pass; 85 tests pass |
| O3 | offline T1 and T2 commands | not run; no commit |
| Merged tree `4b9cebb` | full suite | 2521 tests, 2488 pass, 0 fail, 33 skipped |
| Merged tree `4b9cebb` | typecheck, lint | clean |
| This closeout | read-only `git log`, `git show --stat`, `git diff`, ancestry checks | commit subjects and file lists confirmed; all three unit commits are ancestors of `4b9cebb` |

## Deviations

1. **Fail-closed `bash` is guard-blocked, not removed** (P16-D5). OMPX-03 allows removal or blocking. Removal would give Omp's native "Tool bash not found" instead of a catalogue code, so `bash` stays active and the guard refuses it. The owner's confirmation of this trade is open (owner question 2).
2. **Handshake, protocol version and credential are not implemented.** The control protocol (`src/daemon/channel.ts`) has no version field and no handshake. The socket's 0700 directory and 0600 socket are the existing boundary. This is an accepted deviation from `SANDBOX_OMP_PLUGIN_CONNECTION` (owner decision, 2026-11-02): the socket modes are the authentication boundary, with no version handshake. Version negotiation and the credential remain unimplemented.
3. **`test/support/omp-profile.ts`** is listed in plan 16-02 but is not changed by `2af03b6`. Bounded capture was added in `omp-rpc.ts` and `scripted-provider.ts` instead.
4. **Plan 16-04 front matter** lists OMPX-02 and OMPX-04. The unit's content is the re-attach spec section, which has no requirement ID. O4 claims no requirement status.
5. **Merge `4b9cebb` carries PR #46 review fixes outside Phase 16 units.** The commits are `ea486f4` (fix(omp), refused attach kept only for the daemon's own root), `59804f5` (fix(audit)), `fcb3d56` (fix(doctor)), `df728fd` (test(omp)) and `618a579` (docs(omp)). The merge diff also touches `src/audit/chain.ts`, `src/cli/audit.ts`, `src/daemon/client.ts`, `src/daemon/daemon.ts`, `src/doctor/fix.ts` and `test/audit`, `test/cli`, `test/daemon`, `test/doctor`. Those belong to the audit and doctor work of other phases and are not assessed here.
6. **Phase 12 dependency waived** by the owner (2026-11-01). HARN-03 remains FAILED and is not repaired in Phase 16.
7. **Phase 15 PR C gate.** `16-01` lists the PR C gate as well as PR A and PR B, which is a superset of the owner's instruction (P16-D2). Keeping it is an open owner question (question 1).

## Open items

Owner decisions (none is approved by this record):
1. Keep the Phase 15 PR C gate (P16-D2), or start on PR A and PR B alone.
2. Accept a guard-blocked `bash` in place of removal (P16-D5).
3. Handshake, protocol version and credential: accepted deviation (owner decision, 2026-11-02). The socket modes are the authentication boundary, with no version handshake; the spec's version negotiation and credential remain unimplemented.
4. In-flight control requests cannot be aborted on shutdown (`sendRequest` has no abort signal). Accept the `CONTROL_TIMEOUT_MS` bound, or allow a `channel.ts` change later.
5. Re-attach per-attempt budget: the 200 s startup budget, or a shorter bound.
6. Confirm that `test/omp/extension.test.ts` is owned by O4.
7. Re-attach default: stays off until the live validation below is recorded.
8. `STATE.md` also lists two open questions: a refused attach with an unreadable status refuses host `bash`, and a retry while an attach is in flight is refused rather than raced.

Live and human steps not run:
- O3 T3 (OMPX-05 production acceptance). Needs an owner live window. Not approved as of 2026-11-02.
- O2 gated live cases (`REALM_LIVE_OMP`). Written and skipping; not run.
- O4 live validation: with `REALM_OMP_REATTACH=1`, stop the daemon while Omp is attached. Expect `realm disconnected · connecting`, then `realm active` within the first wait.
- The live OMPX-05 check that passed on 2026-11-01 under an earlier owner approval is historical. It is not Phase 16 evidence.

Other:
- `REQUIREMENTS.md` still shows OMPX-02 to OMPX-05 unchecked, and `STATE.md` is not edited here. The parent owns both.
- Draft PRs #46 and #47 were not touched. No push, pull request, merge or release was made in this unit.
- The Phase 16 `Plans` line in `ROADMAP.md` now lists the four plans (owner question 7 resolved by this record).

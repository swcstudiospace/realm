# Phase 16 verification: Omp runs in the sandbox

Date: 2026-11-02. Tree: `gsd/v3-autonomous` at `4b9cebb`. Implementation commits: `2e5e6c5` (O1, plan 16-01), `2af03b6` (O2, plan 16-02), `984d758` (O4, plan 16-04). O3 (plan 16-03) has no commit. Source of acceptance: `16-CONTEXT.md` (Phase 16 criteria 1 to 4 in ROADMAP, the requirement mapping in plans `16-01` to `16-04`, and section "Decisions added 2026-11-01").

**Status: human_needed.** Phase 16 is not passed. Three things block it:
1. O3 is not run. The live window is not approved, so OMPX-05 has no production proof.
2. OMPX-05's production proof is part of O3.
3. The handshake and credential portion of the connection spec is a recorded deviation, awaiting the owner's decision.

No requirement is checked in `REQUIREMENTS.md`. This record does not edit `STATE.md` or `REQUIREMENTS.md`.

## Requirements

| ID | Status | Evidence | Not yet shown |
|---|---|---|---|
| OMPX-02 | implemented and verified with fake-backed tests | O1 `2e5e6c5`: registered `read` returns decoded text with SHA-256, byte count and truncation for Uint8Array, serialized Buffer, empty, truncated and invalid UTF-8 inputs; five tool names and frozen schemas unchanged. O2 `2af03b6`: scripted provider exposes the next request's tool results; 80 hermetic helper tests pass. | Live Omp proof: the O2 gated case (`REALM_LIVE_OMP`) is written and skips. Not run. |
| OMPX-03 | implemented and verified with fake-backed tests; catalogue-code path is a guard, not containment | O1 `2e5e6c5`: fail-closed keeps `bash` active; the `tool_call` guard refuses a model-issued `bash` with `POLICY_DENIED`; `edit` and the other listed built-ins are removed; host tool changes go through a bounded queue. O2 `2af03b6`: gated `bash` denial case asserts `POLICY_DENIED` and fails on Omp's "Tool bash not found". | Live Omp proof: gated case not run. Owner has not confirmed the guard-blocked `bash` trade (owner question 2). |
| OMPX-04 | implemented and verified with fake-backed tests | O1 `2e5e6c5`: registered Realm `read` and `write` displace the built-ins by the accepted name-shadowing exception; restore covers only owned, still-registered names; manually disabled tools stay disabled; mode published only after readback. O2 `2af03b6`: advisory to fail-closed change and native C4 patch CREATE assertions written. | Live Omp proof: gated cases not run. |
| OMPX-05 | **pending O3; not verified** | None for Phase 16. The OMPX-05 production scenario is defined only in plan 16-03. No task of that plan has run. | Live production acceptance: the owner has not approved a live window. An earlier live OMPX-05 check passed on 2026-11-01 under an earlier approval; it is historical and is not Phase 16 evidence. |

## Acceptance criteria (ROADMAP Phase 16)

1. Registered tools `exec`, `read`, `write`, `list`, `status`; no `glob`; `retry` stays `realm-retry`: fake-backed evidence from O1, with the frozen schema tests unchanged. Live: not run.
2. Fail-closed built-ins removed or blocked, `tool_call` guard kept as backstop, model `bash` refused with a catalogue code: implemented as guard-blocked `bash` (P16-D5). Status text and docs must describe fail-closed as a guard, not containment; this wording is part of the open owner decision on `bash`.
3. Advisory: Realm tools registered, built-ins kept except same-name `read` and `write`: implemented; fake-backed evidence from O1.
4. Live write through the registered tool lands in `/workspace` and the host root, with paired audit lines: **not verified** (OMPX-05, O3).

## Unit O4: bounded re-attach (no requirement ID)

- Source: planner spec section `SANDBOX_OMP_PLUGIN_CONNECTION`, the design-register defaults, and plan `16-04`.
- Commit `984d758`; merged into the run branch by `4b9cebb`. Plugin and extension tests: 85 pass (reported).
- Behaviour as implemented: equal-jitter wait (base 1 s, cap 60 s, 8 attempts). FAILED with a catalogue code and a `/realm-retry` notice. Shutdown clears timers. Re-up is idempotent. An in-flight Realm `write` or `exec` that loses the link reports `AUDIT_OUTCOME_UNKNOWN` and is not retried by the plugin.
- Configuration: `REALM_OMP_REATTACH`. Unset or `0` is off, `1` is on, any other value fails at load with `SCHEMA_INVALID`.
- **Default: off.** It stays off until the owner records the live validation.
- **Live validation: pending, not run.** Steps: with `REALM_OMP_REATTACH=1`, stop the daemon while Omp is attached. The status item must read `realm disconnected · connecting`, then `realm active` within the first wait.
- Not covered by O4: the handshake and credential portion of the spec (see deviation below).

## Deviation: handshake and credential (open owner decision)

The spec requires a protocol version, a handshake and a credential. The control protocol (`src/daemon/channel.ts`) has no version field and no handshake. The existing boundary is the socket's 0700 directory and 0600 socket. O4 and the other Phase 16 units add no handshake.

Under the spec's rule this is a **BLOCKER for the handshake portion**. It is recorded as an open owner decision: accept the socket modes as the authentication boundary, or name the contract. It is not a passed item.

Related open item: in-flight control requests cannot be aborted on shutdown, because `sendRequest` has no abort signal. The bound is `CONTROL_TIMEOUT_MS`. Owner question 4.

## Automated evidence (reported, not rerun here)

Per the closeout rule, this record did not run build, typecheck, lint or tests. The results below are those reported for each commit and for the merged tree.

| Scope | Result |
|---|---|
| O1 `2e5e6c5`: typecheck, lint, full suite | pass; full suite 2483 pass (as recorded in `STATE.md`) |
| O2 `2af03b6`: typecheck, lint, hermetic helper tests | pass; 80 pass. Guard file's seven gated cases skip with `REALM_LIVE_OMP` unset |
| O4 `984d758`: plugin and extension tests | 85 pass |
| Merged tree `4b9cebb`: full suite | 2521 tests, 2488 pass, 0 fail, 33 skipped |
| Merged tree `4b9cebb`: typecheck, lint | clean |
| Read-only checks for this record | commit subjects and stats confirmed; the three unit commits are ancestors of `4b9cebb`; the four O3 files have no commit on this branch |

Hermetic gates do not close OMPX-05. Fake daemon, fake execution service and fake bridge results are not production proof. Scripted-provider results are not LLM-driven.

## Live and human steps (not run)

| Step | Purpose | Status | Approval |
|---|---|---|---|
| O3 T3 | OMPX-05: Omp, daemon, driver, OpenShell and rootless Podman write, with host-root and `/workspace` bytes identical and a paired admission and result in the audit log | not run | not approved; no live window granted |
| O2 gated cases | Live Omp consumer controls (`REALM_LIVE_OMP`) | not run | not approved |
| O4 live validation | Re-attach default decision | not run | pending owner; default stays off |

## Owner decisions open

1. Phase 15 PR C gate on Phase 16 (P16-D2).
2. Guard-blocked `bash` in place of removal (P16-D5).
3. Handshake, protocol version and credential (blocker for the handshake portion).
4. Abort of in-flight control requests on shutdown.
5. Re-attach per-attempt budget.
6. Ownership of `test/omp/extension.test.ts` by O4.
7. Re-attach default, pending live validation.

The `Plans` line in `ROADMAP.md` now lists the four plans. The owner's Phase 12 dependency waiver (2026-11-01) is in force. HARN-03 remains FAILED. Draft PRs #46 and #47 are not touched.

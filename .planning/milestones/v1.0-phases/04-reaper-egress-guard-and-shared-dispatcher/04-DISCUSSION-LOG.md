# Phase 4: Reaper, Egress Guard, and Shared Dispatcher - Discussion Log

**Mode:** `--auto` (single pass). Human reference only. Downstream agents do not read this file. The decisions are in `04-CONTEXT.md`.

## Prior context loaded

- PROJECT.md, REQUIREMENTS.md (RT-05, RT-08, TOOL-03, TOOL-04), STATE.md (stale: it still shows Phase 3 as current).
- CONTEXT.md from Phase 3 (D-46 to D-74), Phase 2 (D-19 to D-45, read in part), and Phase 1 (by reference).
- Phase 3 VERIFICATION.md (unit-verified, live-gated). Committed as `53fc919` and `ce364b8`.
- No `DECISIONS-INDEX.md`, no `.planning/codebase/`, no spike or sketch findings, no pending todos matched phase 4.
- Discuss pre-hooks: none active.

## Gray areas (all selected in auto mode)

1. **Egress mechanism.** Container networking versus OpenShell `network_policies`. Resolved from `openshell.md` Q4 and Q9 and the v0.1.2 policy schema. Decided in D-75 to D-83.
2. **Reaper scope and ordering.** Reuse of the Phase 3 sweep, record deletion order, and the single-owner precondition. Decided in D-84 to D-87.
3. **Dispatcher pipeline.** Stage order, audit admission versus result lines, queue wait, timeout constant. Decided in D-88 to D-98.
4. **Exec verb.** Phase 3 deferred it because the pinned set had no exec verb. Local 0.1.2 CLI shows one. Decided in D-92 to D-94.

## Auto-selected choices (recommended default for each)

- [auto] Egress — Q: "How is the allowlist enforced?" → Selected: OpenShell `network_policies` through the sandbox proxy (documented enforcement; Podman itself has no per-destination rule). (recommended default; settled S-20)
- [auto] Egress — Q: "Host networking and IPv6?" → Selected: refuse host networking at config load and refuse IPv6 hosts; report IPv6 partial. (recommended default; RT-05)
- [auto] Egress — Q: "Which binary does the rule name?" → Selected: the absolute workload executable, `workloadArgv[0]`. (recommended default; the schema matches parent processes)
- [auto] Reaper — Q: "What gets reaped at startup?" → Selected: every realm-labelled container, then every session record, in that order. (recommended default; settled S-19)
- [auto] Reaper — Q: "Who runs it?" → Selected: a startup function with an injected sweep; Phase 6 calls it. (recommended default; D-50 forbids session importing runtime)
- [auto] Dispatcher — Q: "Stage order?" → Selected: schema, state, lock, audit admission, execution, result audit. (recommended default; settled S-22)
- [auto] Dispatcher — Q: "Audit failure?" → Selected: admission failure refuses the call (fail closed, S-21); result-line failure returns `AUDIT_WRITE_FAILED` and does not roll back. (recommended default; OQ-P4-07)
- [auto] Dispatcher — Q: "Queue wait while connecting?" → Selected: wait up to `toolQueueMs` for exec and writes, then the mode gate decides for writes and `REALM_NOT_ACTIVE` for exec. (recommended default; OQ-P4-08)
- [auto] Dispatcher — Q: "Timeout value and where it lives?" → Selected: a constant `TOOL_CALL_TIMEOUT_MS = 30000` in `dispatch.ts`, not a policy key. (recommended default; OQ-P4-09)
- [auto] Exec — Q: "Is exec allowed outside active?" → Selected: no, in both modes. (recommended default; a command must not run in an unverified sandbox)
- [auto] Exec — Q: "Verb and flags?" → Selected: `openshell sandbox exec --name realm-<id> --workdir /workspace --no-tty --no-login-shell -- <argv>`. (recommended default; flags read from the local 0.1.2 help)

## Scope creep redirected to Deferred Ideas

- Wildcard egress hosts, `allowed_ips`, live egress updates, tool-timeout policy keys, a dedicated tool-timeout code, doctor items for the reaper and egress, and the startup caller (Phase 6). All recorded in `04-CONTEXT.md` `<deferred>`.

## Corrections made during write-up

- D-80: softened "can select host networking" to what the `sandbox create` help documents.
- D-86: added that OpenShell label application is live-gated (OQ-P3-01).

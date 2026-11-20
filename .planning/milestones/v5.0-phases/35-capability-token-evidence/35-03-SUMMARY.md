---
phase: 35-capability-token-evidence
plan: "03"
subsystem: capability-token-live-enforce-proof
tags: [capability-token, enforce, live-proof, scripted-provider, audit, leak-scan, claude]
requires: ["35-02"]
provides:
  - "test/support/scripted-anthropic-provider.ts: an Anthropic-format scripted loopback provider (loopback only, placeholder key, streamed and non-streamed Messages, the first request that offers the status tool answered with a tool call and the next with a text, count_tokens and models routes, proxy refusal, names-only recording)"
  - "test/support/capability-live.ts: checkCapabilityAudit, leakProblems with the key texts of the keyring, tamperedCopies, the doctor item reader, keyring facts, the status stub MCP server and the claude print-mode shape"
  - "test/support/production-live.ts: startMcpSession takes a host and a workspace and exposes the child's pid; the shared-state cleanup includes the capability keyring directory (a keyring the run created is removed, one that existed is left byte for byte)"
  - "test/integration/capability-live-enforce.test.ts: the validator-tier feasibility test and the gated production-stack proof (REALM_LIVE_CAPABILITY=1; the host-driven drive only with REALM_LIVE_CAPABILITY_HOST_TURN=1)"
  - "EVID-03 recorded on 2026-11-18: the launcher-driven drive and the host-driven drive both ran and every check passed; the host-driven turn used a scripted loopback provider with no credential and no real model"
  - "D35-1 in docs/integration/runtime-decision.md, section 10 of docs/integration/capability-token-spike.md, the Q10 evidence limits of docs/integration/mcp.md, a sentence in docs/integration/hosts.md, and the doc pins that depend on the results"
affects: [test/support, test/integration, test/docs, docs/integration]
key-files:
  created:
    - test/support/scripted-anthropic-provider.ts
    - test/support/scripted-anthropic-provider.test.ts
    - test/support/capability-live.ts
    - test/integration/capability-live-helpers.test.ts
    - test/integration/capability-live-enforce.test.ts
  modified:
    - test/support/production-live.ts
    - test/integration/production-live-helpers.test.ts
    - test/docs/capability-token-evidence.test.ts
    - test/docs/capability-token-doc.test.ts
    - docs/integration/capability-token-evidence.md
    - docs/integration/mcp.md
    - docs/integration/runtime-decision.md
    - docs/integration/capability-token-spike.md
    - docs/integration/hosts.md
decisions:
  - "D35-1: three claims were measured, each with its tier; D32-1 and D34-1 stand unchanged; no source file and no policy default changed"
  - "The scripted loopback turn (OQ-35-02) was run under option (a): it needs no credential, nothing leaves the machine, and the page says plainly that what is shown is claude issuing the tool call, not a model deciding to use Realm"
  - "claude needs ENABLE_TOOL_SEARCH=false for the scripted turn: by default it defers MCP tool schemas behind its tool search and offers the provider no MCP tool by name"
  - "The unlabelled session of the proof shares the audit file of the labelled session, so the audit check accepts refusal lines that carry no host and no kid and requires at least one"
requirements: [EVID-03, EVID-02]
metrics:
  tasks: 8
  completed: 2026-11-18
status: merged
---

# 35-03 summary: the live enforce proof

## What shipped

The scripted provider, the audit and leak helpers, the shared-state cleanup of the keyring, the gated live test (PR 178, 995170a) and, after the window, the records: the EVID-03 rows, the facts table (Podman 5.7.1), the Not shown section, D35-1, section 10 of the spike note, the Q10 evidence limits and a sentence in `hosts.md` linking the evidence page. The pins that depend on the results are in `test/docs/capability-token-doc.test.ts` and `test/docs/capability-token-evidence.test.ts`.

## Observed (window 2026-11-18, production stack, rootless Podman 5.7.1, account realmlive uid 5002, claude 2.1.322, main at the merge of PR 178)

`capability-live-enforce.test.js`: 2 of 2 passed with REALM_LIVE_CAPABILITY=1 and REALM_LIVE_CAPABILITY_HOST_TURN=1.

- Feasibility (validator tier, real recipe, stub realm): claude print mode against the scripted provider issued tools/call for status, exit 0 after 1888 ms, 2 provider messages, 6 MCP tools offered, 0 rejected; it needs `ENABLE_TOOL_SEARCH=false`.
- Effective mode enforce, keyring present before the first call, doctor item capability-tokens pass.
- Launcher-driven drive (`realm mcp --host claude`, cold): active after 8088 ms and 5 status calls (REALM_NOT_ACTIVE x4, then active); status and list then ran, 3 calls; after the attach: enforce, keyring present, active kid k1, file mode 600.
- An unlabelled session (no `--host`): status refused POLICY_DENIED with no tool work; the daemon logs hold 1 capability.refused line.
- Live memory probes (non-descendant, same uid, `ptrace_scope` 1): the realm mcp process, 109 regions listed, 0 read, mem open denied EACCES, 0 token candidates, environment with no token shape; the daemon, 158 regions, 0 read, denied EACCES, 0 candidates, key file readable.
- Audit after the launcher drive: 8 lines (1 attach, 3 admission, 3 result, 1 refusal); the check passed (host claude, kid k1, 3 calls, at least 1 refusal); the attach line has tool capability.attach, outcome ok, host claude, kid k1; the first call line is a status admission with host claude and kid k1; `realm audit verify` exit 0; copies: unedited exit 0, host-edited exit 1, kid-edited exit 1.
- Host-driven drive: claude itself issued the call against the scripted provider (no credential, no real model): exit 0 after 1670 ms; wire methods server/discover, tools/list (all six tools), tools/call x1; provider 2 messages, 0 rejected. Audit after: 11 lines (2 attach, 4 admission, 4 result, 1 refusal); the check passed with 4 calls; `realm audit verify` exit 0.
- Leak scan: 71 sinks, the token shape and 3 key texts, no hit.
- Cleanup: the keyring that existed before the run was left as it was, policy.json restored, receipt and presence entries as before, the real host file unchanged, 0 containers, 0 sandboxes, 0 daemons, an empty workspace. Evidence is kept outside the repository.

## Not verified here

- A real model turn: the host-driven drive used a scripted provider, so no model decided to use Realm.
- One claude version, one machine, one kernel, one day. The interplay of enforce with the cold attach was observed once and is not the Phase 33 proof.
- The attach step is unauthenticated: the lines attribute a call to the host label the client named. A same-user reader of the key file or the attach is not stopped.
- Codex and opencode are not part of this proof.

## Deviations from plan

- The feasibility attempts a to e of the plan (non-streamed reply, permission mode, model name, title request, telemetry variables) did not make claude offer the status tool; the working change, `ENABLE_TOOL_SEARCH=false`, is outside that closed list and is recorded as the observed requirement.
- `startMcpSession` had no host flag in the snapshot this plan started from; it gained an optional host and workspace, merged with main's `LIVE_MCP_HOST` default and `mcpArgvOf`.
- The cold drive composes `startMcpSession`, `initializeMcp` and its own status poll rather than `runColdAttachProbe`, which closes the child after its first success and so cannot leave the session open for the probe and the audit steps.

---
phase: 32-capability-tokens-for-stdio-hosts
plan: "02"
subsystem: capability-token-wiring
tags: [capability-token, capability-attach, gate, audit-attribution, limiter, stdio-host, omp, refusal-matrix]
requires: [32-01]
provides:
  - "src/capability/gate.ts: createCapabilityGate (built only when the policy mode is enforce), attach (mints a token for an admitted session and writes its audit line) and check (verifies the token of a tool request, never throws, fails closed on an absent or unsafe keyring)"
  - "src/capability/limiter.ts: the bound on capability audit lines, a bucket of 60 with a refill of one per second over an injected clock, no timers"
  - "src/daemon/channel.ts and src/daemon/daemon.ts: the capability-attach control request (exactly selection and host), the optional token member of a tool request (a string of at most 512 characters), and the gate running before the correlation id is minted and before any dispatcher stage; every refusal is exactly POLICY_DENIED with no reason on the wire"
  - "src/audit/log.ts and src/tools/dispatch.ts: optional host and kid on the audit lines of a tokened call (both lines of every tool), validated by pattern, covered by the hash chain, absent when no token was used so the line is the pre-token shape"
  - "src/daemon/client.ts: connectDaemon takes an optional host; the client attaches on its first call, renews 120 seconds before expiry, remembers a mode off answer for 60 seconds, reads an older daemon's SCHEMA_INVALID as off, and keeps the token in a closure variable only"
  - "src/cli/stdio-host.ts, src/cli/main.ts, src/host/attach.ts, src/omp/extension.ts: realm mcp and realm acp attach as their --host id, the Omp extension attaches as omp, an unlabelled session attaches as no host"
  - "test/support/capability-harness.ts, test/daemon/capability-wire.test.ts, capability-e2e.test.ts, test/capability/gate.test.ts, limiter.test.ts and the client, channel, audit, tools, host, omp and stdio-host tests"
affects: [src/capability/gate.ts, src/capability/limiter.ts, src/daemon, src/audit/log.ts, src/tools/dispatch.ts, src/host/attach.ts, src/omp/extension.ts, src/cli]
key-files:
  created:
    - src/capability/gate.ts
    - src/capability/limiter.ts
    - test/capability/gate.test.ts
    - test/capability/limiter.test.ts
    - test/daemon/capability-wire.test.ts
    - test/daemon/capability-e2e.test.ts
    - test/audit/principal.test.ts
    - test/tools/principal.test.ts
    - test/support/capability-harness.ts
  modified:
    - src/audit/log.ts
    - src/cli/main.ts
    - src/cli/stdio-host.ts
    - src/daemon/channel.ts
    - src/daemon/client.ts
    - src/daemon/daemon.ts
    - src/host/attach.ts
    - src/omp/extension.ts
    - src/tools/dispatch.ts
    - scripts/check/export-usage-allowlist.json
    - test/audit/log.test.ts
    - test/cli/stdio-host.test.ts
    - test/daemon/channel.test.ts
    - test/daemon/client.test.ts
    - test/host/attach.test.ts
    - test/omp/extension.test.ts
    - test/support/stdio-world.ts
decisions:
  - "Token AND policy, never OR: the gate is a stage in front of the unchanged dispatcher; a valid token never grants what policy refuses (a full token under shellEnabled false still gets SHELL_NOT_ALLOWED)"
  - "Fail closed: every token defect, a missing token, an unknown host label and an unusable keyring are POLICY_DENIED with no cause and no detail on the wire; the internal refusal class goes to one capability.refused log line that carries no token text"
  - "With a gate the token check runs before the shape of the tool is examined, so a caller with no valid token learns nothing about the schema; with no gate a malformed call is refused as it always was"
  - "Mode off keeps the 0.4.3 behavior: no gate is built, an incoming token member is ignored, capability-attach answers mode off, no keyring is created, no capability line is written"
  - "Audit attribution: host and kid come only from a verified token; attaches and refusals are audited within the bound of 60 lines then one per second; past the bound a refusal is still answered, writes no line and raises a running dropped count in the log; an attach at an empty bucket is POLICY_DENIED; an attach whose audit line cannot be written is AUDIT_WRITE_FAILED and returns no token"
  - "A refusal line names the host only when the MAC verified"
  - "The token lives only in the memory of the client closure, never in a property, an environment variable, an argument, a file, a log or an error"
  - "An unlabelled stdio session has no host to attach as, so under enforce it is refused on every call (OQ-32-01); Omp attaches as host omp rather than being exempt (OQ-32-02)"
requirements: [CAPT-06, CAPT-07]
metrics:
  tasks: 3
  completed: 2026-11-17
status: merged
---

# Plan 32-02 Summary: the attach frame, the gate before dispatch, the audit attribution and the host wiring

Merged to main in PR 150 (squash `3fc89b9`). After this plan, with `capabilityTokens.mode` set to `enforce`, the daemon mints a token when a host process attaches and verifies it on every `tool` request before the dispatcher runs, and the audit lines of a tokened call carry the verified host and key id. With the default (`off`) nothing changes.

## What shipped

- The control channel: `capability-attach` joined the control methods (5 s timeout, like status), carries exactly `selection` and `host` with a host label of 1 to 32 lowercase characters, and a `tool` request may carry a `token` string of at most 512 characters. Membership of the label in the host list is decided by the gate, not the channel.
- The daemon: the gate is built once from the policy; in a `tool` request it runs first and answers `{ id, error: { code: "POLICY_DENIED" } }` for any refusal, with a refused-call metric under the tool name (or `unknown`), and passes the verified principal to the dispatcher. `capability-attach` answers `{ mode: "off" }` without a gate, and `{ mode: "enforce", token, expiresAt }` with one.
- The dispatcher and the audit log take an optional principal (exactly host and kid, both checked against their patterns, otherwise SCHEMA_INVALID and nothing written); `host` and `kid` are written after `upId` only when present, and the hash chain covers them (editing the host on a past line breaks the chain at the next line).
- The client and the hosts: `realm mcp` and `realm acp` pass their `--host` id to the client that runs the tools, the Omp extension passes `omp`, and the status probe and the doctor pass none.
- The 24-row seeded wire matrix in `test/daemon/capability-wire.test.ts` (no token, empty, not a token, truncated or tampered MAC, tampered payload, wrong key under a known kid, unknown kid, version 2, payload schema defects, a host outside the list, expired, iat ahead, over-long lifetime, another session, and read-only profile tokens for write, both exec forms and retry, a token without a capability for a read), run over a real socket: each row is `POLICY_DENIED`, with no dispatcher admission, no effect on the workspace and one `capability.refused` line with no token text. Further wire tests cover expiry by clock, revoke, rotation grace, the oracle rows (a malformed call with no token is POLICY_DENIED, with a valid token it is SCHEMA_INVALID), token AND policy, two hosts on one session, and the 60-line bound.
- The end-to-end tests (`capability-e2e.test.ts`): a real client as claude (reads, lists, writes and status, lines carry host and kid, one attach line); a read-only profile (write, both exec forms and retry refused, workspace unchanged); a client built without a host (refused on every call); a revoke (the next call is POLICY_DENIED, a new client works); mode off (no keyring, no capability line, lines equal those of a client with no host); the real stdio entry; a no-leak scan (the token and the key appear in no sink, the key only in `keys.json`).

## Observed

- Read of `origin/main` on 2026-11-18: the files above exist; `CONTROL_METHODS` in `src/daemon/channel.ts` lists `capability-attach`; `src/daemon/daemon.ts` calls `capabilityGate?.check` before the dispatcher; `src/tools/dispatch.ts` accepts the principal; `src/daemon/client.ts` holds the token in the `held` closure variable; `src/omp/extension.ts` passes `host: "omp"`.
- CI on PR 150 passed on Node 22.x and 24.x (regular user).
- The wire matrix has 24 rows (counted in the test file).

## Not verified here

- The memory probe (`/proc/PID/mem` read by a non-descendant same-user process under Yama `ptrace_scope` 1) is written and runs only for a non-root Linux user with `ptrace_scope` of 1 or more. The implementers' harness ran as root, so it was skipped and recorded as not run (OQ-32-05). That a same-user, non-descendant process cannot read the token from process memory is an INFERENCE, not a measurement.
- No run of enforce mode against the production stack (real hosts, rootless Podman) was made. Every wire and end-to-end test uses a fake runtime seam.
- The implementers ran the tests as root locally; CI ran them as a regular user and passed.
- An old `realm mcp` or a stale detached daemon under enforce is refused on every call by design; this was tested for a client built without a host, not for a real stale binary.

## Deviations from plan

- `scripts/check/export-usage-allowlist.json` lost 60 lines: exports that 32-01 allowlisted because nothing used them yet are now used by the gate.
- No deviation in the design. CI fix rounds for this PR, if any, are in the PR history and are not reproduced here.

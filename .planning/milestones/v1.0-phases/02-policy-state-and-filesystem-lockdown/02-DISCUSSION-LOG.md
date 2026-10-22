# Phase 2: Policy, State, and Filesystem Lockdown - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-10-21
**Phase:** 02-policy-state-and-filesystem-lockdown
**Mode:** `--auto` (all gray areas selected; recommended option taken for each question)
**Areas discussed:** Settled inputs, Module layout, Policy file and engine, State machine and display, Timeouts, Filesystem lockdown, Locks and atomic writes, Session record and lifecycle, Tool input gate, Audit and secrets, Doctor core, Test taxonomy

---

## Settled inputs

[auto] Settled inputs — Q: "Policy default and host write tools?" → Selected: advisory default, fail-closed opt-in, host writes disabled only in required mode (user settled; not reopened).
[auto] Settled inputs — Q: "Container granularity, lock location, control channel, reaping, Podman version?" → Selected: one container per session; locks in daemon keyed by canonical path; user-only Unix socket; reaping keys off session record; Podman 4.9.3, gated; fake ExecutionService in Phase 2 (user settled).

## Module layout

| Option | Description | Selected |
|--------|-------------|----------|
| A | Lifecycle controller in `src/core/` | |
| B | Lifecycle controller in its own `src/lifecycle/` (amends n2) | ✓ |
| C | Lifecycle controller in `src/session/` | |

**User's choice:** B (auto)
**Notes:** Core must stay the dependency root; the controller needs session and the port, so placing it in core creates a cycle with session. Recorded as an explicit amendment to n2.

[auto] Module layout — Q: "Where does the in-memory fake live?" → Selected: `test/support/fake-execution.ts` (recommended; keeps FOUND-03 rule intact, no runtime code in `src/` before its docs gate).

## Policy file and engine

| Option | Description | Selected |
|--------|-------------|----------|
| A | Default location in user config dir | |
| B | Explicit caller-supplied path; missing file means defaults | ✓ |
| C | Policy stored inside the workspace | |

**User's choice:** B (auto)
**Notes:** Option C rejected outright: the agent can write inside a workspace root, so it could rewrite the policy that constrains it. Loader rejects a policy file inside its own roots with `POLICY_DENIED`.

[auto] Policy engine — Q: "Mode decision in Phase 2 or Phase 3?" → Selected: pure decision function in Phase 2 (`decideMutation`), wiring in Phase 3 (CORE-05). Recommended: n5 names the fail-closed test for Phase 2 scope.
[auto] Policy engine — Q: "Required mode gates reads too?" → Selected: writes only (spec n5 default q2).

## State machine and display

| Option | Description | Selected |
|--------|-------------|----------|
| A | Degraded shown as a third label | |
| B | Degraded shown as "realm active" plus a degraded flag | ✓ |

**User's choice:** B (auto)
**Notes:** CORE-02 allows exactly two labels; the spec's "degraded marker" becomes a flag.

[auto] State machine — Q: "How is `stopping` shown?" → Selected: "realm disconnected" with reason `stopping` (CORE-02 allows only two labels).
[auto] Event bus — Q: "Listener failure policy?" → Selected: deliver to all listeners, rethrow the first failure after delivery; nothing swallowed (QUAL-01).

## Timeouts

| Option | Description | Selected |
|--------|-------------|----------|
| A | Add a teardown-timeout error code to the catalogue | |
| B | Map teardown timeout to `REALM_STOPPING`; flag for Phase 3 | ✓ |

**User's choice:** B (auto)
**Notes:** Adding a code changes a frozen, costly contract. Carried as open question Q-1.

## Filesystem lockdown

| Option | Description | Selected |
|--------|-------------|----------|
| A | Reject every symlink | |
| B | Follow symlinks that stay inside the root; reject escapes; verify after open | ✓ |
| C | Open each component relative to a pinned directory descriptor | |

**User's choice:** B (auto)
**Notes:** Option C needs `openat`, which Node 22 does not expose. Option B uses resolve-then-verify with `O_NOFOLLOW` and `/proc/self/fd` identity checks. Residual rename-window risk recorded as Q-2 rather than hidden.

[auto] Filesystem — Q: "Non-Linux behavior?" → Selected: fail closed with `PATH_ESCAPE` (unverifiable is treated as escaping); macOS is V2-01.
[auto] Credentials — Q: "Pattern list?" → Selected: spec-named classes (SSH keys, cloud credential files, `.env`) with a documented constant list; `credentialAllow` overrides (recommended default).
[auto] Glob — Q: "Use `path.matchesGlob`?" → Selected: local matcher, because the built-in is experimental in Node 22 and no new dependency is added.

## Locks and atomic writes

| Option | Description | Selected |
|--------|-------------|----------|
| A | Locks persisted to disk | |
| B | In-memory lock table, hosted by the daemon in Phase 6 | ✓ |

**User's choice:** B (auto)
**Notes:** Matches S-03. Persistence would add a reaping problem Phase 2 does not need.

[auto] Atomic write — Q: "Hash mismatch at re-check?" → Selected: `LOCK_CONFLICT` (n5 names it); `ifMatchSha256` mismatch also `LOCK_CONFLICT`.
[auto] Atomic write — Q: "Failure after rename, before dir fsync?" → Selected: `WRITE_NOT_ATOMIC`, with the reason noted in the audit entry, because durability is unconfirmed.
[auto] Atomic write — Q: "Temp file left by a killed process?" → Selected: not cleaned in Phase 2; deferred to Phase 4 reaper (Q-3).

## Session record and lifecycle

| Option | Description | Selected |
|--------|-------------|----------|
| A | Record written after container create | |
| B | Record written before create, `containerId` null until created | ✓ |

**User's choice:** B (auto)
**Notes:** RT-07 and the frozen schema (D-14).

[auto] Session record — Q: "Session with no bound workspace?" → Selected: no record; in-memory `unbound` until first create (the schema requires a non-empty `workspaceRoot`).
[auto] Lifecycle — Q: "Retry after startup failure?" → Selected: `create` retries through `error` → `connecting` (existing table edge).
[auto] Lifecycle — Q: "Idempotency key for create?" → Selected: session id, so a crash between create and record update can be reattached (Phase 4 reaper depends on it).

## Tool input gate

[auto] Tool gate — Q: "Dispatcher in Phase 2?" → Selected: no; Phase 2 adds tests that the schema gate rejects the required classes; the dispatcher is Phase 4 (TOOL-03).

## Audit and secrets

| Option | Description | Selected |
|--------|-------------|----------|
| A | Log file content on write | |
| B | Log path, byte count, and hash only; exec argv redacted; shell script logged as length and hash | ✓ |

**User's choice:** B (auto)
**Notes:** File content may itself be a credential; the log must not carry it.

[auto] Audit — Q: "How is no-host-env proven?" → Selected: the port has no environment field, plus a sentinel test that the fake receives no env and no record or log line contains the sentinel.

## Doctor core

[auto] Doctor — Q: "Report Podman and other components in Phase 2?" → Selected: no. Phase 2 checks only policy file, state directory, and session store. Other components register in Phase 3 and 6, so nothing is reported as pass or fail that was not inspected.

## Test taxonomy (QUAL-02)

| Option | Description | Selected |
|--------|-------------|----------|
| A | Write MCP and ACP contract tests in Phase 2 against nothing | |
| B | Cover the transport-neutral schema contract in Phase 2; MCP and ACP tests move to Phase 5 | ✓ |

**User's choice:** B (auto)
**Notes:** No MCP or ACP surface exists until Phase 5. Flagged as Q-4 for the orchestrator to confirm.

---

## Claude's Discretion

- Helper names, internal file splits, and whether `atomic-write.ts` and `write.ts` stay separate.
- Test helper layout under `test/support/`.
- Plan count and wave grouping, subject to dependency order.
- Random-id source.
- Warning and reason text beyond the frozen catalogue reasons; display labels stay exact.

## Deferred Ideas

- Runtime adapters, gated integration tests, CORE-05 wiring, Anda bridge: Phase 3.
- Dispatcher, call timeouts, queue wait: Phase 4. Reaping, egress: Phase 4.
- Control socket, daemon, CLI: Phase 6.
- Host write-tool removal: Phase 5. MCP and ACP transports: Phase 5.
- Policy reference and security review: Phase 7.
- Open questions Q-1 to Q-4 are listed in CONTEXT.md `<deferred>`.

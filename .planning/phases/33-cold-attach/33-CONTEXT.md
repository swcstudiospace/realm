# Phase 33: Cold attach - Context

**Gathered:** 2026-11-18, from `.planning/MILESTONE-CONTEXT.md` (D-v5-2), the v5.0 section of `.planning/REQUIREMENTS.md` (COLD-01 to COLD-04), the Phase 33 block of `.planning/ROADMAP.md`, the v4.0 audit, and a fresh read of the branch `gsd/v5-plan`: `src/cli/stdio-host.ts`, `src/cli/main.ts` (the `runStdio` call site), `src/mcp/server.ts`, `src/mcp/protocol.ts`, `src/host/{boot-driver,attach,boot,boot-observer}.ts`, `src/daemon/{daemon,client}.ts`, `src/core/{errors,states,status}.ts`, `docs/integration/{mcp,acp,host-plugin-contract,host-plugin-gaps,wave1-boot-matrix}.md`, `test/support/{host-live,stdio-world,stdio-host-harness,capability-harness}.ts`, `test/cli/stdio-host.test.ts`, `scripts/check/mcp-smoke.mjs`.
**Status:** Planned (three plans, nothing executed). This phase does not edit ROADMAP, STATE or REQUIREMENTS. Requirement ids COLD-01 to COLD-04 are already registered.
**Format and depth:** the v4.0 phases 28, 29, 31 and 32 under `.planning/milestones/v4.0-phases/` (CONTEXT, three PLAN files, threat model per plan, blocking-human live window).

<domain>
## Phase Boundary

`realm mcp` (`src/cli/stdio-host.ts`) answers the MCP handshake (`initialize`, `server/discover`) and `tools/list` before `ensure` and `up` complete. Until the session is ready the realm is not active: every tool call is refused with the existing not-active refusal (`REALM_NOT_ACTIVE`, a catalogue code, retryable) and never reaches the daemon or the sandbox. When the session becomes ready, the same stdio connection serves tool calls with no reconnect. The warm path, the status vocabulary, the audit lines and the error catalogue do not change.

This closes `GAP-31-04` (a cold first attach outlasts a host's MCP connect timeout) and, with it, `GAP-23-02` (the same cause, up to 230 s measured as a bound, never measured live). The claude, opencode and codex production tiers are re-proved from a cold start on the live stack with the warm-up (`realm up --workspace` first) removed from `test/support/host-live.ts`, and the gap rows are closed with that evidence.

### The owner decision this phase carries out

D-v5-2 (2026-11-18, HITL): serve the MCP handshake before `ensure` and `up` complete, report the realm as not active with the existing vocabulary, refuse tool calls with the existing not-active refusal (fail closed), and re-prove claude, opencode and codex cold with the harness warm-up removed. The live window is authorized by the owner's statement of 2026-11-18 that live windows are authorized when a phase needs them, under the same rules as before (shared live lock, the `realmlive` account, residue checks, evidence kept outside the repository).

### Out of scope, stated so no task drifts into it

- `realm acp` (it keeps its ready-only start and its exit 1 on a boot failure), the Omp extension (`src/omp`, its own boot hook), the daemon, the control protocol, the error catalogue (29 codes, pinned by `test/core/errors.test.ts`), the status labels, the audit lines, the capability tokens (Phase 34 owns enforce by default).
- The presence marker schema (`attach` stays `attached` or `failed`; no pending value), the boot report schema and the metrics shape.
- A progress channel to the host (no `notifications/tools/list_changed`, no progress notifications, no new tool, no change to tool descriptors or annotations).
- Any change to the retryable flag a refusal carries after the first attempt has settled (see D-33-06).
- kimi and kimi-code (named gaps), UI-01, FS-02, TD-06, TD-10.
- `CHANGELOG.md`, version fields, `release/milestone.json`: the release job owns them.
</domain>

<decisions>
## Implementation Decisions

### Evidence (every fact below: source, read date 2026-11-18, tier)

Tiers: **Observed** = read in this worktree today; **Measured** = recorded by an earlier live run and cited from the gaps page; **[INFERENCE]** = reasoning from those, to be proven by a named task.

| ID | Fact | Source | Tier |
| --- | --- | --- | --- |
| E-33-01 | `runStdioHost` runs steps 2 to 5 (ensure, up, readback, settle) by awaiting `driver.start(selection.workspaceRoot)` (line 277) and only then creates the MCP server (line 295) or starts the ACP agent (line 317). The MCP exit table (lines 286 to 294): a `refused` outcome, or a `failed` outcome the daemon answered, writes the attach-failure text to diagnostics and serves; any other `failed` outcome exits 1 with the code text before any frame, unless re-attach is on and the code is retryable, in which case it serves. | `src/cli/stdio-host.ts` | Observed |
| E-33-02 | `createMcpServer` creates a readline interface on stdin at construction, so stdin is not read until it runs; `handleLine` is awaited per line, in order. `initialize`, `server/discover` and `tools/list` are answered from static data (`handshake`, `discoverResult`, `MCP_TOOL_DESCRIPTORS`) with no dispatcher call. The initialize result advertises `capabilities: { tools: {} }`, with no `listChanged`. `tools/call` calls `ctx.dispatcher.call` only, and a thrown `RealmError` is a tool error result, never a protocol error. | `src/mcp/server.ts` lines 264 to 306, 313 to 377; `src/mcp/protocol.ts` lines 91 to 100 | Observed |
| E-33-03 | The boot driver adopts a client only after the attach (ensure, connect, idempotent `up`) and one status readback verified this root and session (lines 290 to 335, `client = daemon` at line 333). Until then `client` is null. `guard` (lines 487 to 514) refuses a Realm tool with `block(lastCode ?? "REALM_NOT_ACTIVE")` while `client` is null, and `lastCode` is cleared to undefined by `show("connecting", undefined)` at the start of every attempt (line 282). So during the first attempt a tool call is refused locally with `REALM_NOT_ACTIVE` and no daemon request is made. | `src/host/boot-driver.ts` | Observed |
| E-33-04 | The refused outcome's `retryable` comes from `retryableNow()` = link is `reconnecting` or `attaching` (line 524). With re-attach off the link is always `off` (`go` line 171, `begin` line 467), so a call refused during the first attempt carries `retryable: false`, while the catalogue entry for `REALM_NOT_ACTIVE` says retryable true ("the request can run once the session reaches active"). | `src/host/boot-driver.ts` lines 171, 467, 516 to 524; `src/core/errors.ts` lines 69 to 72 | Observed |
| E-33-05 | `retry()` returns early only when the driver is not live, is shut, or has re-attach on and the link is `attaching` (line 477). With re-attach off, a `retry` tool call made while the first attempt is still in flight (client null, so `needsAttach()` is true, line 523) would run `cycle()` and `attempt()`, which bumps the epoch and kills the in-flight attempt (lines 271 to 281): the cold `up` the host is waiting for would be abandoned and restarted. | `src/host/boot-driver.ts` lines 271 to 281, 476 to 485, 536 to 538 | Observed; the consequence is **[INFERENCE]**, proven by Task 1 of plan 33-01 |
| E-33-06 | The `retry` tool passes the guard in every state (`toolName === "retry"` returns undefined, line 494), so it reaches `call` during the window. | `src/host/boot-driver.ts` line 494 | Observed |
| E-33-07 | The daemon does not abort an `up` when the client socket goes away: `case "up"` (lines 606 to 628) awaits `withSessionLock(... admitUp ...)` with no reference to the socket; a socket error is handled by dropping the socket and the comment says "the work the request started continues" (lines 861 to 868). No test pins a client that disconnects in the middle of `up`. | `src/daemon/daemon.ts` | Observed (code); the behaviour is **[INFERENCE]** until Task 2 of plan 33-01 pins it and the live window of plan 33-03 shows it |
| E-33-08 | The daemon's session status before `up` has created an entry is the `unbound` snapshot (`resolved.entry === null` gives `unboundSnapshot`, line 603); once `create` runs the controller reports `connecting`, then `active` (the state table: unbound to connecting, connecting to active or error). The user-visible status vocabulary is two labels, `realm active` and `realm disconnected`; `unbound` has reason `no workspace`, `connecting` has reason `connecting`. | `src/daemon/daemon.ts` 601 to 605; `src/core/states.ts`; `src/core/status.ts` | Observed |
| E-33-09 | The error catalogue has 29 codes and its size is pinned (`CATALOGUE_SIZE = 29`). `REALM_NOT_ACTIVE`, `STARTUP_BUDGET_EXCEEDED`, `DAEMON_START_TIMEOUT` and `TOOL_TIMEOUT` are retryable. The boot bounds: startup budget 200 s per attempt, guard status read 5 s, status poll 2 s, re-attach off by default. | `test/core/errors.test.ts` line 85; `src/core/errors.ts`; `src/host/boot.ts` lines 36 to 51 | Observed |
| E-33-10 | The presence marker and the `attached`, `refused` and `failed` boot reports are written by the observer on a settled attempt only; a `closed` event removes the marker and sends a `closed` report with a 1 s bound. The marker schema is six keys with `attach` of `attached` or `failed`. The marker is written after `client` is adopted, because the observer runs after `attempt` returns. | `src/host/boot-observer.ts` lines 106 to 136, 188 to 197; `src/host/boot-driver.ts` lines 387 to 408; `scripts/check/mcp-smoke.mjs` `describeMarker` | Observed |
| E-33-11 | Omp does not use the boot driver: `bootHookOf` returns null for an `extension` host and the Omp extension attaches through `createDaemonAttach` with the `verified` retention. ACP uses the driver but starts only on `ready` and exits 1 otherwise. | `src/host/boot-driver.ts` lines 590 to 594; `src/host/attach.ts` header; `src/cli/stdio-host.ts` lines 309 to 316 | Observed |
| E-33-12 | Tests pinned to the serve-after-boot order: `test/cli/stdio-host.test.ts` "MCP sequence: probe status, up, readback status, and only then the first stdin read" (line 112) and "MCP ensure failure exits 1 ..." (line 206); tests that write a `tools/call` right after start and expect it forwarded (lines 220 to 242, 321 to 351); `test/cli/stdio-host-matrix.test.ts` (6 call sites), `test/cli/cli.test.ts` (2), `test/daemon/capability-e2e.test.ts` `runStdio` (writes `tools/call` straight after the `tools/list` reply), `test/integration/host-boot-isolation.test.ts` (3); `scripts/check/mcp-smoke.mjs` (asserts the marker exists at the first reply and a fail-closed attach exits before serving). | the files named | Observed |
| E-33-12a | The scripted daemon `World` has `daemonUp`, `upResult` (`ok`, `hang`, or a code), `gateAfterUp` (holds the readback) and no way to hold `up` itself and release it later. `FakeExecutionService.holdNext("create")` holds a create and returns its release. `startRig` builds a real daemon on a real socket with a fake execution service that it does not expose. | `test/support/stdio-world.ts` lines 66 to 123; `test/support/fake-execution.ts` line 114; `test/support/capability-harness.ts` lines 43 to 138 | Observed |
| E-33-13 | The live harness warms the session before the host attach: `realm up --workspace` through the production helper (`host-live.ts` lines 1029 to 1042, `WARM_UP_TIMEOUT_MS` 240 s at line 838). The post-host assertions assume a warm session: `realm status` active within 90 s (line 1125), at least one `attached` boot report (lines 1077, 1129 to 1137), 60 s for an exited host (`EXIT_STATUS_TIMEOUT_MS`, line 842). | `test/support/host-live.ts` | Observed |
| E-33-14 | A cold sandbox creation took about 35 to 60 s (measured 2026-11-18). OpenCode gives up on an MCP server after 30 s; Claude's `mcp list` probe also gave up, leaving `realm status` unbound. The live hosts and versions: claude 2.1.322 (modern era, `server/discover` then `tools/list`, no `initialize`), opencode 1.19.5, codex-cli 0.154.0 (exits within seconds against the refusing provider). | `docs/integration/host-plugin-gaps.md` GAP-31-04; `docs/integration/wave1-boot-matrix.md`; `test/support/host-live.ts` | Measured 2026-11-18 |
| E-33-15 | A `down` on the last session stops the daemon (`downRequested` when the registry is empty and no reservation is held), so a production test that ends with `realm down` leaves no daemon; the next run starts cold at both levels, daemon and sandbox. | `src/daemon/daemon.ts` lines 504 to 508; `docs/integration/wave1-boot-matrix.md` | Observed (code); live behaviour is checked by the preflight of plan 33-03 |
| E-33-16 | `docs/integration/mcp.md` Q7 states "serves nothing before the last settles" and "a reply to `initialize` is the readiness signal", and that any other failure "exits 1 before any frame". `docs/integration/host-plugin-contract.md` "Boot integration" has the same readiness contract (line 105) and a six-row step table whose row 6 says "MCP creates its server and reads stdin". `docs/integration/acp.md` Q6 says the ACP agent starts "only after the boot settles, so the first protocol reply is the readiness signal". | the files named | Observed |

### D-33-01. Serve immediately; run ensure and up in the background behind the driver's not-active gate

Options considered (the owner's decision D-v5-2 names the first):

1. **Serve the stdio loop at once; ensure, up and readback run in the background; tool calls are refused until the driver adopts a verified client.** Chosen.
2. **Lazy up: serve at once, run `ensure` and `up` only when the first tool call arrives.** Rejected. (a) The first `tools/call` of a model turn would block for the whole cold sandbox creation, 35 to 60 s, inside one MCP request, which is the same timeout problem moved from connect time to call time, and a host's per-call timeout is not documented to be longer. (b) A host that only lists tools (`claude mcp list`, `opencode mcp list`) would never start the daemon or the session, so the realm would stay unbound; D-v5-2 wants `ensure` and `up` to run on attach. (c) It makes a tool call a side effect that starts the sandbox, which breaks the rule "a call before ready is refused and does not touch the sandbox" (COLD-02). (d) The first call would run unaudited work (the `up` is audited by its own events, but the call would wait on it), blurring the audit story.
3. **Wait a bounded grace period (for example 1 s) for the boot to settle, then serve early.** Rejected. It adds an arbitrary constant and a timer, gives a fast failure and a slow failure two different host-visible behaviours (exit 1 before a frame, or a served connection that refuses), and does not meet "answers before ensure and up complete" literally. Its one advantage, scripted warm pipes still work, is bought at the cost of a second code path; scripted clients are migrated instead (D-33-09).
4. **Answer `status` locally during the window with a real snapshot.** Rejected for COLD-02 ("every tool call is refused"): it would need a second daemon connection that has no session, and it would give the status tool a result shape that exists nowhere else.

Mechanism: for `transport === "mcp"`, `runStdioHost` starts `driver.start(selection.workspaceRoot)` without awaiting it and creates the MCP server in the same synchronous turn, so stdin is read at once and the driver already holds the `connecting` state when the first line arrives. The settle (outcome read, diagnostic text, exit rule) runs when `driver.start` resolves (D-33-05). The numbered boot steps do not change; step 6 (expose) now happens right after step 1 and the steps 2 to 5 complete behind it. ACP is untouched (D-33-08).

The gate already exists: while `client` is null the driver refuses every Realm tool call locally with `REALM_NOT_ACTIVE` and makes no daemon request (E-33-03). The sandbox is never touched in the window because the only code that talks to the daemon with a tool is `daemon.call` on an adopted client.

### D-33-02. The not-active vocabulary and the refusal: existing codes only

- **Refusal:** every tool call made before the driver adopts a client returns the existing refused outcome `{ outcome: "refused", tool, code: "REALM_NOT_ACTIVE", retryable: true }`, which the MCP result carries as `isError: true` with that object as `structuredContent` and as the text block. This includes `status` and `retry`. No code is added: the catalogue stays at 29 codes and `test/core/errors.test.ts` is untouched.
- **retryable is true in the window.** Today a call refused during the first attempt carries `retryable: false` (E-33-04), which contradicts the catalogue (`REALM_NOT_ACTIVE` is retryable) and would tell a model not to retry the one situation that resolves itself. The driver is changed so that an attempt in flight counts as retryable (D-33-06).
- **The status words.** The driver's own state line is `realm connecting mode: unknown` through the status sink (debug log level only, unchanged). The daemon's view, which `realm status` and the daemon `status` method show, is the existing vocabulary: label `realm disconnected` with reason `no workspace` until `create` begins, then `connecting`, then `realm active` (E-33-08). Nothing is added to `src/core/status.ts`.
- **Nothing is audited or counted for a window refusal.** The refusal is host-local: no daemon request, so no audit line, no daemon metric (E-33-03). This is how a refusal while reconnecting already behaves; the audit and status contracts do not change (COLD-03).

### D-33-03. What the host sees in `initialize`, `server/discover` and `tools/list` while not ready

The same bytes as when ready. The server's answers to these three methods are static (E-33-02): the six tools, their input schemas, descriptions and annotations, `ttlMs` 300000 and `cacheScope` `public` on `tools/list`, `ttlMs` 3600000 on `server/discover`, the server identity and `capabilities: { tools: {} }`. The tool list does not depend on readiness, so there is nothing to change when the session becomes ready: no `notifications/tools/list_changed` (the server does not advertise `listChanged`), no new field, no marker text in a description. A host that caches the list for its `ttlMs` caches a correct list. The descriptors and annotations stay pinned by `test/mcp/descriptors.test.ts` and the annotation pins.

### D-33-04. The transition: same connection, no reconnect, no queue

When the driver adopts a verified client (`client = daemon`, E-33-03) the next `tools/call` is forwarded; there is no event to the host and no process restart. A call that arrives before that point is refused and is never queued or retried by the server (fail closed: a queued call would run after the host gave up on it, and would make a call's side effect depend on boot timing). The host or the model learns readiness by a call succeeding, and the refusal text already says the request can run once the session is active. Because the server loop never restarts, the connection, the legacy-era handshake state and the stdout stream continue across the transition. The first forwarded call also carries the token the attach obtained, as today (Phase 32); Phase 34 changes nothing here.

### D-33-05. Failure of the background boot after the handshake: what the host sees

The host is already connected, so a failed boot can no longer be a failed connect. The rule: **the server keeps serving, every call is refused with the failure's catalogue code, the failure text is written to stderr once, and the process exits 1 at stdin end only if no client was ever adopted.** By outcome (the outcome is read when `driver.start` resolves):

| Outcome | Host sees | stderr | Exit at stdin end |
| --- | --- | --- | --- |
| `ready` | calls forwarded | nothing at the default level | 0 |
| `refused` (the daemon refused `up`, the readback confirms this root and session) | calls forwarded; the daemon answers each with its refusal | the attach-failure text, once, when the boot settles | 0 |
| `failed` and the daemon answered (readback did not confirm) | every call refused locally with the code, never forwarded | the attach-failure text, once | 0 |
| `failed`, no daemon answered, re-attach off or a terminal code (was: exit 1 before any frame) | every call refused locally with the failure code (for example `DAEMON_START_TIMEOUT`, `STARTUP_BUDGET_EXCEEDED`); the Realm `retry` tool performs exactly one more attach | the failure text with the daemon-log hint, once | 1 if still no client |
| `failed`, no daemon answered, re-attach on and the code retryable | as today: refused with the last code until a re-attach links; the wait is armed | nothing | 0 |

The three rows that already served keep their texts and exit codes; only the moment the text is written moves (when the boot settles, not before the server starts). The one row that changes class is the fourth: the host used to see a server that failed to connect, and now sees a connected server whose calls are refused with the real code. This is the honest consequence of answering early. It is better than exiting after the handshake because the model sees the code and the `retry` tool can recover, and because a host that never restarts a stdio server would otherwise be left with a dead one. Failures before the server exists are unchanged: the usage error (exit 2) and a workspace that does not resolve or a driver that cannot be built (exit 1 before any frame).

The exit code at stdin end is computed from the driver's outcome at that moment, so a `retry` that later links gives exit 0. A signal still ends the session with `128 + signal` through the same teardown.

### D-33-06. Two driver changes, and no others

1. `retryableNow()` also returns true while an attach attempt is in flight (`current !== null`): a call refused during the first attempt says `retryable: true`, as the catalogue entry does. Nothing else about `retryable` changes: with re-attach off and the attempt failed, the flag stays false as today (a failed attempt is not self-resolving; the `retry` tool is the explicit action).
2. `retry()` returns without doing anything while an attempt is in flight (`current !== null`), in addition to its existing guard. The call then falls through to the refusal path and answers `REALM_NOT_ACTIVE`, retryable true. Without this, a model that calls `retry` in the window would restart the cold `up` (E-33-05). A `retry` after a failed attempt still performs exactly one more attach (the existing test at `test/host/boot-driver.test.ts` line 213 stays unchanged).

### D-33-07. A host that leaves in the middle of the boot

Teardown (stdin end, a signal) runs `driver.shutdown()`, which ends the in-flight attempt and closes its client, then flushes the observer; no `down` is sent (unchanged rule). The daemon keeps running the `up` it was asked for (E-33-07, [INFERENCE] until proven), so a host that only health-checks and exits (`claude mcp list`, `opencode mcp list`, a `codex exec` that ends in seconds) leaves a session that becomes active on its own. Plan 33-01 pins this with a daemon test (a held create, a client that disconnects, the create released, the state reaches active), and plan 33-03 shows it live. Consequence recorded for the harness (D-33-10): a host that leaves before ready produces no `attached` report and no marker; its evidence is the wire, the host's own connected report, and `realm status` reaching active afterwards.

### D-33-08. The Omp and ACP paths are unaffected, and how that is shown

- `src/omp` is not edited and does not use the boot driver (E-33-11); its suites are unchanged.
- `src/acp` is not edited. In `runStdioHost` the ACP branch still awaits the settle, still exits 1 unless the outcome is `ready` and the state is `active`, and still starts the agent only then; `test/cli/stdio-host.test.ts` "ACP refused up ...", "--reattach on ACP still exits 1 on a boot failure" and the ACP rows of "stdout holds only protocol frames" stay as they are and must pass unchanged.
- The two driver changes of D-33-06 are reachable from ACP only through a call made while an attempt is in flight, which ACP never does with re-attach off (it serves only after `ready`) and which already counts as `attaching` with re-attach on.
- `git diff` of the phase touches no file under `src/omp`, `src/acp`, `src/daemon`, `src/core`, `src/contract`, `src/capability`, `src/tools` or `src/audit` (a verification step of plan 33-01).

### D-33-09. The tests (the not-active window, the transition and the refusal in between are the centre)

New test files (no basename contains `mcp` or `acp`; the taxonomy test forbids it):

- `test/cli/stdio-cold-attach.test.ts`, on the scripted world: the handshake and `tools/list` are answered while `up` is held; a call in the window is refused `REALM_NOT_ACTIVE` retryable with no daemon call and no `up` side effect; the held `up` released, the next call forwarded on the same output stream; `retry` in the window does not start a second attach; each row of the D-33-05 table; a signal and stdin end in the window; ACP unchanged.
- `test/cli/stdio-settle.test.ts`: the pure settle rule (the table of D-33-05) including the exit decision.
- `test/daemon/cold-attach-e2e.test.ts`: the real stdio entry over a real client and a real daemon on a real socket with a held create, under capability enforce with a profile, proving the window on the wire (the daemon's own status is `connecting`, the dispatcher saw nothing, `realm mcp` replied to the handshake), the transition on the same connection, and the audit lines of the first forwarded call carrying the host and the kid (the audit contract unchanged).
- `test/daemon/up-disconnect.test.ts`: the daemon completes an `up` whose client disconnected mid-request (E-33-07).
- `test/host/boot-driver.test.ts` additions: D-33-06 (both changes).

Harness seams, test support only: `World.gateUp` in `test/support/stdio-world.ts` (holds `up` and releases it later); `exec` exposed on `Rig` in `test/support/capability-harness.ts`; a helper `untilAttached` that waits for the presence marker of a labelled session, or for an `attached`, `refused` or `failed` report in `session.sent` for an unlabelled one. The marker and the report exist only after the client is adopted (E-33-10), so waiting for either is the exact "ready to forward" signal without sending a probe call (a probe call would add a forwarded tool call, an audit line and a `world.tools` entry to tests that assert none).

Migration of existing tests: every test that writes a `tools/call` and expects it forwarded now waits for `untilAttached` first (E-33-12). The two tests pinned to the old order are rewritten, not deleted: "MCP sequence" becomes "the handshake is answered while up is held and stdin is read from the start", and "MCP ensure failure exits 1 ..." becomes the fourth row of the D-33-05 table. A test that still fails after waiting for readiness is a regression in the code, not in the test.

### D-33-10. The smoke gate and the live harness

- `scripts/check/mcp-smoke.mjs` (the `check:mcp` gate) assumed serve-after-boot (a marker at the first reply, a fail-closed attach that exits before any frame). It is rewritten to the new contract: reply 1 arrives at once; the script then waits for the marker (`attached` or `failed`); on `attached` it runs the era checks as before; on `failed` it requires the catalogue code on stderr, a refused call with that code, `realm status` disconnected, and no marker left after the session ends. `scripts/check/mcp-smoke.test.mjs` and `test/mcp/annotations.test.ts` keep importing its exports.
- `test/support/host-live.ts`: the warm-up block, its timeout constant and its comment are removed (COLD-04). The three production tiers attach cold. The assertions are re-based on what a cold attach can show (D-33-07): the host's own connected report and its elapsed time (a bound below the 30 s OpenCode timeout), the wire (handshake and six tools), and `realm status` reaching active within a cold bound after the host left. The `attached` boot report is no longer required of a host that leaves before ready.
- A new live test, `test/integration/cold-attach-live.test.ts` with a support module `test/support/cold-attach-probe.ts`, drives `realm mcp --host claude` itself on a cold project: handshake answered in a few seconds while `realm status` is not active, a call refused `REALM_NOT_ACTIVE`, and the same process serving a call after the session is active, with the `attached` report counted. This is the only live proof of the transition on one connection, because the three hosts' health checks leave before ready.

### D-33-11. Docs and gap rows

Plan 33-02 writes the behaviour into `docs/integration/mcp.md` (Q7), `docs/integration/host-plugin-contract.md` (the six-row table, the readiness contract), `docs/integration/acp.md` (Q6: ACP keeps the ready-only start) and moves `GAP-31-04` and `GAP-23-02` to `narrowed` with the hermetic evidence and the live proof still to come. Plan 33-03, from the window's evidence only, closes `GAP-31-04` and `GAP-23-02`, narrows `GAP-31-03` (a cold stack now shown for the three hosts; other versions still not), and rewrites the rehearsal pages and registry notes that say "warm session". A gap row is closed only with a dated run and a repository path in the same edit (`test/docs/host-gaps.test.ts`).

### D-33-12. Hygiene constraints for every plan

- **Gate closure:** nothing reachable from the exec gate closure may reach `node:child_process`; `src/contract` may not import `src/host` or `src/capability`. The new module `src/cli/stdio-settle.ts` imports only `../core/errors.js`, `../host/boot.js` and `../host/boot-driver.js` types.
- **Module size 1000 lines:** `src/daemon/daemon.ts` (986) and `src/cli/main.ts` (922) are not grown; the settle rule lives in its own module and `stdio-host.ts` (336 lines) gains about 40. The only `main.ts` edit is the comment above `runStdio`, which describes the old order.
- **Export-usage gate:** `describeSettle` is used by `stdio-host.ts`; no export exists only for a test, so no allowlist entry is added (if one proves necessary the entry is added in the same task and checked by `npm run check:gates`).
- **Lint:** no unnecessary conditions after narrowing (closure writes are kept on an object, the way `attachSeen` is), `restrict-template-expressions`, `no-base-to-string`, `prefer-const`, `void test(...)` for every test.
- **Tests run as a regular user:** the executor runs the suites as a non-root user; no test depends on root, on `ptrace_scope` or on the real home.
- **Docs:** no host-local absolute path (the `host-paths` gate), the default-mode docs guard (`npm run check:docs`), the JSON-RPC and MCP era rules of `docs/integration/mcp.md` Q1 to Q6 are not touched, every claim carries an evidence label.
- **No shims:** the old exit-before-frame path for a failed MCP boot is removed, not kept behind a flag; there is no environment variable and no new flag.

### Threat model (summary; each plan carries its STRIDE rows)

| Surface | Threat | Mitigation |
| --- | --- | --- |
| A tool call in the window | The call reaches the daemon or the sandbox before the session is verified, or runs late after a queue | The driver refuses locally while `client` is null; no queue; the tests assert no daemon call, no `up` side effect and no forwarded tool in the window |
| The transition | A call is forwarded to a client that belongs to another project or session | Unchanged: the client is adopted only after the readback confirms this root and session id (E-33-03); the existing `readbackOther` test stays |
| `retry` in the window | A model restarts the cold `up` in a loop and exhausts the startup budget | D-33-06 item 2: a retry while an attempt is in flight does nothing |
| A failed boot after the handshake | A host believes the server is healthy because it connected | Every call is refused with the real catalogue code; the failure text goes to stderr; exit 1 at the end; the `retry` tool recovers |
| Early stdin read | Frames read before the observer, signals and teardown exist | The server is created after the signal handlers and the teardown are installed (they are installed before step 2 today), in the same synchronous turn as `driver.start` |
| Diagnostics from the background settle | Text written after teardown or interleaved on stdout | The settle writes to diagnostics only, and is skipped once the session is shutting down |
| Host disconnect mid-up | A half-created sandbox, or a leaked daemon request | No `down` is sent; the daemon completes or fails the `up` on its own, and the existing startup reap handles a failed create (E-33-07, pinned by test and shown live) |
| Evidence | A cold pass claimed from a warm run | The live window starts from a snapshot with no daemon and no session for the project; the harness has no warm-up; the evidence names the elapsed times |
| Docs | The pages keep saying "serves nothing before the boot settles" | Plan 33-02 rewrites the three pages and a grep step proves no stale statement remains |
</decisions>

<canonical_refs>
## Canonical References

- `.planning/MILESTONE-CONTEXT.md` (D-v5-2), `.planning/REQUIREMENTS.md` (COLD-01 to COLD-04), `.planning/ROADMAP.md` (Phase 33 block).
- `src/cli/stdio-host.ts`, `src/cli/main.ts` (`runStdio`), `src/mcp/server.ts`, `src/mcp/protocol.ts`, `src/host/boot-driver.ts`, `src/host/attach.ts`, `src/host/boot.ts`, `src/host/boot-observer.ts`, `src/daemon/daemon.ts`, `src/core/errors.ts`, `src/core/status.ts`.
- `docs/integration/mcp.md` (Q6 eras, Q7 boot sequence), `docs/integration/acp.md` (Q6), `docs/integration/host-plugin-contract.md` (Boot integration), `docs/integration/host-plugin-gaps.md` (GAP-23-02, GAP-31-03, GAP-31-04), `docs/integration/wave1-boot-matrix.md`, `docs/integration/host-support-matrix.md`, `docs/hosts/snippets/{claude-code,codex,opencode}.md`.
- `test/support/{host-live,stdio-world,stdio-host-harness,capability-harness,fake-execution,production-live,host-registry}.ts`, `test/cli/stdio-host.test.ts`, `test/host/boot-driver.test.ts`, `test/docs/{host-gaps,wave1-boot-matrix,host-docs}.test.ts`, `scripts/check/mcp-smoke.mjs`.
- v4.0 precedents: `.planning/milestones/v4.0-phases/31-production-stack-boot-rehearsals-for-wave-1-hosts/` (the live window protocol) and `32-capability-tokens-for-stdio-hosts/` (plan format, threat model, `untilReplyOn` and rig helpers).
</canonical_refs>

<code_context>
## Existing Code Insights

- The boot driver already models the state this phase needs: `client` null plus `link` `off` or `attaching` is "not active yet", and its `call` already refuses locally with a catalogue code. The phase moves when the server starts, and fixes the two places where the in-flight attempt was not treated as a pending state (the retryable flag, the `retry` tool).
- `--reattach` already exposes the server before a boot has linked, for retryable failures (test "--reattach: an MCP boot that fails DAEMON_START_TIMEOUT exposes the tools, refuses calls while unlinked and forwards after the re-attach"). Serve-early generalizes that path to every MCP boot and to the in-flight window.
- `createMcpServer` is already independent of the driver: it takes `{ call }`. Nothing in `src/mcp` changes.
- `runStdioHost` keeps its closure-object pattern (`attachSeen`) for values written inside callbacks and read after awaits; the new settle state follows it.
- The observer writes the marker and the `attached` report only after a client is adopted, so they double as the exact readiness signal for tests.
</code_context>

<specifics>
## Wave Structure

| Wave | Plan | Autonomous | What |
| --- | --- | --- | --- |
| 1 | 33-01 | yes | Code and hermetic tests: the two driver changes, the settle module, serve-early in `stdio-host.ts`, the daemon disconnect test, the real-daemon end-to-end, the migration of existing tests, the smoke gate rewrite |
| 2 | 33-02 | yes | Docs and gap rows: mcp.md Q7, the host plugin contract, acp.md Q6, GAP-31-04 and GAP-23-02 narrowed, the stale-statement sweep |
| 3 | 33-03 | no (blocking-human) | The cold harness and the direct probe, then the owner-authorized live window (claude, opencode, codex, cold, warm-up removed), then closing the gap rows and the rehearsal records from the evidence |

## Requirement coverage

| Requirement | Plans |
| --- | --- |
| COLD-01 (handshake before ensure and up complete) | 33-01 (Tasks 3, 4), 33-02, 33-03 |
| COLD-02 (not active until ready, refusal in between, same connection) | 33-01 (Tasks 1 to 4), 33-02, 33-03 (probe) |
| COLD-03 (warm path, status and audit contracts unchanged; tests for the window, the transition and the refusal) | 33-01 (Tasks 3 to 5), 33-02 |
| COLD-04 (three tiers cold, warm-up removed, GAP-31-04 closed with evidence) | 33-03 |

## Open Questions (none blocks plan 33-01 or 33-02)

- **OQ-33-01 (the OpenCode scratch install).** Plan 33-03 needs the pinned scratch install of OpenCode 1.19.5 outside the repository, off the default path, removed after the window, as in plan 31-02 option b. The owner's authorization of 2026-11-18 (live windows when a phase needs them, same rules) is read to cover it; if the person running the window does not hold that, OpenCode stays `not-run` with that reason and the matrix says so. Default taken: covered.
- **OQ-33-02 (daemon cold versus sandbox cold).** Both levels are cold at the start of each window test because the previous test's `realm down` stops the daemon (E-33-15). If the preflight shows a daemon running, the person stops it with `realm down` for each project first and records it; a run that started warm is not counted.
- **OQ-33-03 (host retry behaviour).** Whether a host that gets a `REALM_NOT_ACTIVE` result retries by itself is unknown and is not claimed; the window records what the three hosts do (the health checks make no tool call). The model-driven behaviour is outside this phase.

## Success Criteria (from the roadmap, made observable)

1. With `up` held, `realm mcp` answers `initialize`, `server/discover` and `tools/list` and stdin is read from the start; the daemon's own status is `connecting` (existing vocabulary); a `tools/call` returns the refused outcome `REALM_NOT_ACTIVE` with `retryable: true` and no daemon request. (Tests: scripted world and the real-daemon end-to-end.)
2. After the held `up` is released, the same connection forwards a call, with no reconnect. A refused-up, a failed boot and a signal in the window each behave as the D-33-05 table says.
3. The warm path, the status labels and the audit lines are unchanged: the existing contract, equivalence and smoke tests pass (with the readiness wait added where a test raced the boot), the error catalogue still has 29 codes, and the end-to-end audit lines carry the host and the kid.
4. The claude, opencode and codex production tiers pass from a cold start on the live stack with the warm-up removed, the direct probe shows the early handshake and the transition on one connection, and `GAP-31-04` and `GAP-23-02` are closed with that dated evidence.
</specifics>

<deferred>
## Deferred Ideas

- A progress or readiness signal to the host (a `notifications/message` log notice, or `listChanged` with a state-dependent list): not needed for the goal and it changes a pinned protocol surface.
- Serving a real `status` result in the window (option 4 of D-33-01): possible later if a host needs to show "starting" to a user.
- Making `retryable` true after a failed first attempt when the code is retryable and the `retry` tool exists (D-33-06): a contract change for a separate decision.
- Pre-warming the session at `realm host install` time or from a host hook: a different product feature.
- Measuring each host's real connect timeout (GAP-23-02's original ask): the live window records what the three hosts do cold, not their configured limits.
</deferred>

---
phase: 06-cli-daemon-and-host-packaging
verified: 2026-10-22T00:00:00Z
status: human_needed
score: 5/5 must-haves verified (unit evidence on disk; live-client checks remain)
---

# Phase 6: CLI, Daemon, and Host Packaging — Verification Report

**Phase Goal:** Developers run `realm up`, `down`, `status`, and `doctor` from a standalone CLI backed by a long-running local daemon, and each supported host has a config snippet.
**Verified:** 2026-10-22 (read-only; no tests, typecheck, lint, build, or git commands run per assignment constraints)
**Status:** human_needed (all unit-verifiable items met on disk; live Podman / OpenShell / Omp / MCP / ACP checks need a live host)
**Re-verification:** No — initial verification (no prior 06-VERIFICATION.md existed)

## Goal Achievement

### Observable Truths

| # | Truth (Roadmap SC) | Status | Evidence |
|---|--------------------|--------|----------|
| 1 | `realm up` → `realm status` reports realm active → `realm down` returns realm disconnected, all through the standalone CLI and its long-running daemon | ✓ VERIFIED (unit) | `src/cli/main.ts` `runUp`/`runDown`/`runStatus` + `src/daemon/daemon.ts` `startDaemon` dispatch (`status`/`up`/`down`/`doctor`) over `src/daemon/channel.ts`; `test/daemon/e2e.test.ts` "up then status-active then down-to-disconnected flows through the CLI against the fake-backed daemon (CLI-01, RT-06)" drives the real `runCli` against the real `startDaemon` over a real Unix socket with fake adapters, asserting `active`/`realm active` then `disconnected` with the socket file gone |
| 2 | With Podman missing, `realm up` reports disconnected with `PODMAN_MISSING` and exits without hanging | ✓ VERIFIED (unit) | `src/cli/main.ts` `runUp` probes first via `probePodman` and returns exit 1 with stdout `PODMAN_MISSING` before any spawn on any probe failure (T-06-10); `test/cli/cli.test.ts` "realm up with Podman missing reports PODMAN_MISSING and exits promptly with no spawn (CLI-02)" plus `test/daemon/e2e.test.ts` fast-path test with `ENOENT` `runCommand` fake, zero spawns/sends/dials, and a 2000 ms wall-clock bound |
| 3 | `realm doctor` lists Podman, Podman version, machine state, OpenShell, AgentOS, Anda bridge, policy file, and control channel, each with status and the fix for every failing item | ✓ VERIFIED (unit) | `src/doctor/checks.ts` `REGISTERED` order now `policy-file, state-dir, session-store, podman, podman-service, openshell, anda-bridge, control-channel, agentos` (9 items; `podman` names the version code, `podman-service` covers the machine/socket state, every non-pass carries a non-null fix); `test/doctor/control-channel.test.ts` (12 CLI-03 tests: pass/fail/warn + fix on every non-pass) and `test/doctor/checks.test.ts` "the nine checks are registered in report order" plus `test/doctor/runtime-checks.test.ts` Phase-6 order test |
| 4 | Control channel is a user-only Unix socket (dir 0700, socket 0600) under the state dir; neither it nor any Podman/Docker socket is visible inside the container | ✓ VERIFIED (unit) | `src/session/paths.ts` `controlSocketPath` = `<stateDir>/run/control.sock`; `src/daemon/channel.ts` `ensureSocketDir` (create-or-check 0700, wrong-mode/foreign-owner/non-directory refuses `SCHEMA_INVALID`) + `chmodSocket` (0600, failure refuses); `test/daemon/channel.test.ts` (11 RT-06 tests incl. live-socket round-trip, timeout, permission matrix, structural no-container-socket pin); `test/daemon/e2e.test.ts` stats the real temp run dir 0700 and socket 0600 and proves `buildCreateArgv` + policy document carry no `.sock`/`podman.sock`/`docker.sock`; `src/runtime/openshell.ts` contains no `.sock` string |
| 5 | Config snippets exist under `docs/hosts/snippets/` for Omp, Muse Code, Claude Code, Grok Build, and Hermes Agent, each matching its host note in `docs/integration/hosts.md` | ✓ VERIFIED (unit) | All five files present (`omp.md`, `muse-code.md`, `claude-code.md`, `grok-build.md`, `hermes-agent.md`), each pointing at the `realm mcp` stdio entry with explicit not-documented markers where pages are silent and no credential placeholders; `docs/integration/hosts.md` carries the Muse Code official URLs (`dev.meta.ai/docs/muse-code`, `/extending`, `/configuration`), the 2026-10-22 read date, and the `settings.json`/`schema_version`/`mcp_servers`/`streamable_http` facts; `test/docs/host-snippets.test.ts` (8 CLI-04 tests) asserts the exact cited strings plus a no-credential sweep |

**Score:** 5/5 truths verified at unit level (live-client behavior in Human Verification below)

### Required Artifacts

All present and substantive on disk: `src/daemon/channel.ts` (CONTROL_METHODS, NDJSON encode/decode, `SOCKET_TIMEOUT_MS` = 5000 via `withTimeout`, `ensureSocketDir`/`chmodSocket`/`describeRunDirRefusal`), `src/daemon/daemon.ts` (`buildDaemonHandle`, `startDaemon` with single-owner bind → `LOCK_CONFLICT`, `reapStartup` before serving, drain-on-`down` with socket removal), `src/cli/main.ts` (up/down/status/doctor/mcp argv parsing, exits 0/1/2, detached argv-form spawn with no shell, probe-first `up`, stdio `mcp` via the shared `buildDaemonHandle` + Phase 5 `createMcpServer`), `src/doctor/checks.ts` (control-channel + agentos items with fix constants, order preserved), `package.json` `bin: { realm: ./dist/src/cli/main.js }` (matches the compiled CLI entry and the `COMPILED_SUFFIX` direct-invocation guard; `dependencies` unchanged with only `ajv`), `docs/hosts/snippets/*.md` (5 files), `docs/integration/hosts.md` (Muse Code update), and the six test files (`test/daemon/channel.test.ts`, `test/daemon/daemon.test.ts` — 13 CLI-01/RT-06 tests incl. reap-before-serve and source-guard pins, `test/cli/cli.test.ts` — 11 tests, `test/doctor/control-channel.test.ts` — 12 tests, `test/daemon/e2e.test.ts` — 5 tests, `test/docs/host-snippets.test.ts` — 8 tests).

### Key Link Verification

| From | To | Via | Status |
|------|----|-----|--------|
| `src/daemon/channel.ts` | `src/session/paths.ts` | `controlSocketPath` sole path source | WIRED |
| `src/daemon/channel.ts` | `src/core/errors.ts` + `src/core/timeout.ts` | catalogue-only replies (22 codes, still 22 — no new code), `withTimeout` on every socket op | WIRED |
| `src/daemon/daemon.ts` | `src/daemon/channel.ts` | wire format + socket guards | WIRED |
| `src/daemon/daemon.ts` | `src/session/reap.ts` | `reapStartup` before `openGate()`; failed sweep aborts before serving | WIRED |
| `src/daemon/daemon.ts` | `src/realm/compose.ts` | `buildDaemonHandle` → shared `createRealmHandle` (P6-D12, reused by `realm mcp`) | WIRED |
| `src/cli/main.ts` | `src/daemon/channel.ts` | `sendRequest` socket client with `SOCKET_TIMEOUT_MS` | WIRED |
| `src/cli/main.ts` | `src/runtime/podman-probe.ts` | probe-first `up`; any probe failure blocks spawn | WIRED |
| `src/cli/main.ts` | `src/daemon/daemon.ts` + `src/mcp/server.ts` | static `buildDaemonHandle` import; `createMcpServer` stdio entry (no second wiring) | WIRED |
| `src/doctor/checks.ts` | `src/session/paths.ts` + `src/daemon/channel.ts` | `controlSocketPath` + `SOCKET_TIMEOUT_MS`-bounded dial | WIRED |
| `package.json` bin | `dist/src/cli/main.js` | compiled 06-04 CLI entry | WIRED |
| `docs/hosts/snippets/*.md` | `docs/integration/hosts.md` | every snippet field traces to a cited official URL + read date | WIRED |

### Data-Flow Trace (Level 4)

No rendered dynamic values terminate in static returns: channel replies carry the request id with catalogue-code errors only; daemon `status`/`up` answers come from `handle.controller.snapshot()`/`create()`; CLI stdout codes come from live probe results and socket replies (stderr reasons, never env values); doctor results come from the real `runChecks` runner with injected I/O probes; the e2e no-mounts proof inspects the real `buildCreateArgv`/`buildPolicyDocument` outputs. No hollow props.

### Behavioral Spot-Checks

SKIPPED (assignment forbids running anything). Static substitute performed instead: every behavior-dependent truth above names the exact test title and seam that exercises it (live socket pairs, recording sweep, scripted probes, wall-clock bound), so the behaviors are pinned but unexecuted in this verification. The orchestrator's gate run (`typecheck` PASS, `lint` PASS, full `node --test` suite 988 tests / 979 pass / 0 fail / 9 live-gated Podman skips at this HEAD) is recorded without re-running.

### Probe Execution

No `scripts/*/tests/probe-*.sh` probes are declared or implied by the 06 plans, summaries, or success criteria. None executed.

### Requirements Coverage

| Requirement | Source Plans | Status | Evidence |
|-------------|--------------|--------|----------|
| RT-06 | 06-01, 06-03, 06-06 | ✓ SATISFIED (unit) | channel tests + daemon socket tests + e2e permissions/no-mounts |
| CLI-01 | 06-03, 06-04, 06-06 | ✓ SATISFIED (unit) | daemon handle/ownership/reap/dispatch/shutdown + CLI argv/spawn/exit + e2e lifecycle |
| CLI-02 | 06-04, 06-06 | ✓ SATISFIED (unit) | CLI bounded `PODMAN_MISSING` test + e2e fast-path bound |
| CLI-03 | 06-05, 06-06 | ✓ SATISFIED (unit) | control-channel/agentos items + order + fix tests + e2e doctor report |
| CLI-04 | 06-02, 06-04 | ✓ SATISFIED (unit) | 5 snippets + evidentiary suite + `realm mcp` stdio entry |

No orphaned requirements: all five Phase 6 IDs are claimed across the six plans.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |
| (phase files) | — | `TODO`/`FIXME`/`XXX`/`PLACEHOLDER`/hardcoded-empty-data/`console.log` sweep | None found | Clean; the only `return null` hits are legitimate (`replyForMalformedLine` no-answer path, `UnreachableBridge.snapshot(): null` per `BridgePort`, daemon `down` no-reply) |
| `test/doctor/control-channel.test.ts` | title | Says "eight items" while `EXPECTED_IDS` lists nine | ℹ️ Info | Stale title only; assertions match the nine-item registry. Suggest renaming to "nine items" |
| `src/daemon/channel.ts` (per 06-01 SUMMARY) | — | Local `isRecord`/`isControlId`/`isErrorCode` guards; `as` casts removed except one intentional negative-test double assertion | ℹ️ Info | Deliberate (import allowlist forbids a shared guard module); not a stub |

The 06-05 SUMMARY's blocker note about two stale seven-item assertions is **resolved on disk**: `test/doctor/checks.test.ts` ("the nine checks are registered in report order") and `test/doctor/runtime-checks.test.ts` (Phase 6 items follow `anda-bridge`) both already expect the nine-item registry. Likewise the 06-06 SUMMARY's doctor-count concern is settled: the e2e doctor test pins nine ids, matching the registry.

### Gaps

None. No `gaps:` section: every requirement and success criterion is met in code with unit evidence; nothing failed or is missing.

### Deferred Items

None. No later milestone phase covers Phase 6 scope.

## Human Verification Required

Unit evidence is complete on disk but unexecuted here; the following need a live host (live Podman ≥ 5.x, and for the host items a real client). The host has Podman 4.9.3, so Podman-gated live bodies skip by design.

### 1. Live `realm up` → `status` → `down` cycle

**Test:** From a clean state dir on a host with Podman ≥ 5.x running, run `realm up` (with an absolute `--workspace` root), then `realm status`, then `realm down`, then `realm status` again.
**Expected:** `up` exits 0; `status` reports `realm active`; `down` exits 0 removing the socket at `<stateDir>/run/control.sock`; the final `status` reports `realm disconnected` and says the daemon is absent.
**Why human:** No live Podman, container, or daemon process may start in this verification; the e2e proof uses fakes (fake execution/bridge, scripted probes) over a temp socket.

### 2. Live `realm up` with Podman missing

**Test:** On a host with no Podman binary (or `PATH` scrubbed of it), run `realm up` with a wall clock handy.
**Expected:** Exits 1 promptly (well under the 2000 ms test bound) with stdout `PODMAN_MISSING` and a human reason on stderr; no daemon process spawns.
**Why human:** The repo proves this only with an `ENOENT` `runCommand` fake; a real missing-Podman host exercises the true `execFile` failure path.

### 3. Live `realm doctor` against a real host

**Test:** Run `realm doctor` on a developer machine (once with the daemon up, once with it down).
**Expected:** All nine items listed in registry order with pass/warn/fail; every non-pass carries its fix; daemon-down yields warn (not fail) on `control-channel`; Podman/machine rows reflect the real host.
**Why human:** Unit tests inject every I/O seam (`runCommand`, `connectSocket`, `agentosAlive`); only a live run exercises the real probes.

### 4. Live `realm mcp` from a real MCP host

**Test:** Point one snippet consumer (e.g. Claude Code `.mcp.json` `realm` entry running `realm mcp`) at a workspace and list tools / call one read-only tool.
**Expected:** Stdio serves the Phase 5 tool surface over the shared dispatcher; stdout carries only MCP messages; stdin close shuts down cleanly. Note: production `realm mcp` needs caller-supplied `runtimeInput` and the AgentOS driver seam has no in-repo implementation, so a live host must supply both.
**Why human:** Requires a live MCP client; the repo test uses injected `PassThrough` streams and an injected handle.

### 5. Snippet copy-paste against real host binaries

**Test:** Apply each `docs/hosts/snippets/*.md` entry verbatim in its real host (Omp manifest, Muse `~/.config/muse/settings.json` with `schema_version: 1`, `claude mcp add realm -- realm mcp`, Grok via the Claude Code route, Hermes `~/.hermes/config.yaml`) and confirm the host sees the `realm` server.
**Expected:** Each host connects over stdio with no invented keys and no credential prompts.
**Why human:** Visual/client-side confirmation in five external products; grep cannot perform it.

### 6. Socket-permission spot check on a live start

**Test:** After a live `realm up`, run `stat -c '%a %U' <stateDir>/run` and `<stateDir>/run/control.sock`.
**Expected:** `700` on the directory, `600` on the socket, both owned by the invoking user.
**Why human:** Unit tests assert this on temp dirs and via injected stat seams; only a live start proves the production path.

---
_Verified: 2026-10-22_
_Verifier: Claude (gsd-verifier)_

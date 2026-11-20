---
phase: 06-cli-daemon-and-host-packaging
verified: 2026-10-22T00:00:00Z
status: gaps_found
score: 5/5 must-haves verified (unit evidence on disk; live-client checks remain)
reverified: 2026-11-17
reverify_open: 4
---

# Phase 6: CLI, Daemon, and Host Packaging — Verification Report

**Phase Goal:** Developers run `realm up`, `down`, `status`, and `doctor` from a standalone CLI backed by a long-running local daemon, and each supported host has a config snippet.
**Verified:** 2026-10-22 (read-only; no tests, typecheck, lint, build, or git commands run per assignment constraints)
**Status:** gaps_found
**Re-verification:** No — initial verification (no prior 06-VERIFICATION.md existed)

## Goal Achievement

### Observable Truths

| # | Truth (Roadmap SC) | Status | Evidence |
|---|--------------------|--------|----------|
| 1 | `realm up` → `realm status` reports realm active → `realm down` returns realm disconnected, all through the standalone CLI and its long-running daemon | verified against fakes; production `realm up` ends in `AGENTOS_NOT_CONFIGURED` (CLI-01 open, audit G-02) | `src/cli/main.ts` `runUp`/`runDown`/`runStatus` + `src/daemon/daemon.ts` `startDaemon` dispatch (`status`/`up`/`down`/`doctor`) over `src/daemon/channel.ts`; `test/daemon/e2e.test.ts` "up then status-active then down-to-disconnected flows through the CLI against the fake-backed daemon (CLI-01, RT-06)" drives the real `runCli` against the real `startDaemon` over a real Unix socket with fake adapters, asserting `active`/`realm active` then `disconnected` with the socket file gone |
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
| CLI-01 | 06-03, 06-04, 06-06 | Open (unsatisfied; G-02 per v1.0 audit) | Evidence basis: fakes only (daemon handle/ownership/reap/dispatch/shutdown + CLI argv/spawn/exit + e2e lifecycle against fake adapters). No AgentOS driver is bound (`src/daemon/daemon.ts:529-534`), so production `realm up` ends in `AGENTOS_NOT_CONFIGURED`. |
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

- CLI-01 open, audit G-02. Production `realm up` has no AgentOS driver to run against: `src/daemon/daemon.ts:529-534` binds none, and `src/runtime/session-execution.ts:205-207` throws `AGENTOS_NOT_CONFIGURED`. The passing tests use fake adapters only.

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

## Re-verification 2026-11-17

Read-only re-check against evidence recorded after this report: v2.0 audit and requirements, the Phase 9.7 and Phase 14 to 26 verification files, `docs/integration/{openshell,mcp,omp,hosts}.md`, `README.md` and the host snippets. No tests, builds or git commands were run. The six Human Verification items and the one Gap above are broken into the rows below, one row per distinguishable claim. Unit-level truths 2 to 5 had no open item and are not repeated, except where a later decision changed them.

| # | Original item | Current evidence | Verdict |
|---|---------------|------------------|---------|
| 1 | Gap "CLI-01 open, audit G-02": no AgentOS driver bound, so production `realm up` ends in `AGENTOS_NOT_CONFIGURED` | `.planning/milestones/v2.0-INTEGRATION-CHECK.md` row F1: `src/daemon/main.ts:79-93` "always binds the AgentOS driver, libpod path and the three driver roots", and the `AGENTOS_NOT_CONFIGURED` path is "wired (test-only path)", production never reaches it. `.planning/milestones/v2.0-MILESTONE-AUDIT.md` and `v2.0-REQUIREMENTS.md` record CLI-01 as Complete (live 2026-10-28: up, down, status and doctor from the standalone CLI against the production stack, with the long-running daemon). | covered-by-later-evidence |
| 2 | Truth 1 and Human Verification 1: live `realm up` then `realm status` then `realm down` then `realm status` on Podman 5.x | `README.md` "Captured lifecycle transcript" (2026-11-13, Realm 0.3.29, rootless Podman 5.7.1): `up` gives `realm active`, `status` repeats it, `down` gives `realm disconnected`, each exit 0, zero containers before and after. `docs/integration/openshell.md` "Production stack evidence (2026-10-28)": `realm up` reaches `active`, `realm status` reports it, `realm down` leaves zero containers, sandboxes, supervisors and secret directories; the gated live suite passed 33 of 33 on 2026-10-30 (same file, "Result (2026-10-30)"), and 37 of 37 on 2026-11-15 per `.planning/phases/14-crash-safety-pack/14-VERIFICATION.md`. The sub-claim that the socket file is gone and `status` says the daemon is absent after `down` is not recorded live; it is row 12. | covered-by-later-evidence |
| 3 | Truth 2 and Human Verification 2: live `realm up` with Podman missing exits promptly with `PODMAN_MISSING`, no daemon spawned | `.planning/milestones/v2.0-phases/09.7-review-finding-remediation/09.7-VERIFICATION.md` (RT-02 live check): with no podman on PATH `realm up` exits 1 with `PODMAN_MISSING` and a human-readable reason with its fix, and neither a daemon nor a control socket was created. `.planning/milestones/v2.0-REQUIREMENTS.md` RT-02 row: Complete (live 2026-10-28). The 2026-10-29 note in the same 09.7 file (item 14) records a loaded-host timeout mapping to the same code, not reproduced. | covered-by-later-evidence |
| 4 | Truth 3: `realm doctor` registry is exactly nine items, "the nine checks are registered in report order" | Registry grew by later phases: `docs/integration/openshell.md` lines 260 to 263 record `host-binaries` and, with a loadable runtime config, fourteen items (`runtime-roots`, `driver-socket`, `gateway` added by Phase 15, ONB-02, verified in `.planning/phases/15-zero-config-onboarding-and-fail-closed-default/15-VERIFICATION.md` criterion 2); `.planning/phases/21-host-plugin-contract-and-installer/21-VERIFICATION.md` HOST-08 adds `host-plugins`. The nine-item order test is therefore historical; the CLI-03 requirement (each prerequisite listed with status and a fix per failing item) is carried by the larger registry. | superseded (Phase 15 and Phase 21 additions, cited above) |
| 5 | Human Verification 3: live `realm doctor` on a real host with the daemon up and down, real probes, Podman and machine rows true, fix on every non-pass | `docs/integration/openshell.md` line 264 (live, Podman 5.7.1, 2026-10-28, eleven items then): with no daemon, `realm doctor` ran its local checks and exited 0; with a daemon answering, every check passed except `anda-bridge` (warn, no engine URL, expected) and `host-binaries` (warn, supervisor path absent from the daemon's environment); with the path and pin set, `host-binaries` passed and printed the measured versions and digest prefixes including `podman 5.7.1`. `README.md` states `doctor` exits 0 whatever its checks report. | covered-by-later-evidence |
| 6 | Human Verification 3, sub-claim: daemon-down yields warn, not fail, on `control-channel` | The live record in row 5 says only that the daemon-down run exited 0; it does not name the per-row status of `control-channel`. Missing: one live `realm doctor` transcript, daemon down, showing the `control-channel` row as warn with its fix. | still-open |
| 7 | Human Verification 4: live `realm mcp` from a real MCP host (stdio, tool surface, stdout carries only MCP messages, stdin close exits cleanly); note that production `realm mcp` needed caller-supplied `runtimeInput` and had no AgentOS driver | `docs/integration/mcp.md` Q6 "Checks" (2026-10-29): Claude Code `claude mcp list` reports Connected and Grok Build `grok mcp doctor` reports handshake accepted (2025-11-25) and 6 tools discovered, against `realm mcp` attached to the realm account's stack; the same fact is in `docs/integration/hosts.md` (connection check, not a model-driven tool call). `docs/integration/mcp.md` boot section (Phase 23): "Stdout carries protocol frames only", stdin end exits 0, and `realm mcp` now boots resolve, ensure, up, readback, settle, expose through the real daemon, so the `runtimeInput` and no-driver note is superseded (row 1). Scenario 6 of the live suite handshakes as a legacy client then a modern request (`mcp.md`). Not run: a model-driven tool call through a host, which needs a model (stated in `mcp.md`); the original item allowed listing tools. | covered-by-later-evidence |
| 8 | Human Verification 5, Omp entry (the Omp manifest snippet) | The Omp route is now the extension install, not an MCP entry (`docs/hosts/snippets/omp.md`: "Realm reaches Omp through the extension above"). Live: `docs/hosts/snippets/omp.md` "Current install record (ONB-05)" (2026-11-13, isolated profile, Omp 18.20.0, daemon-up status frame `realm active`, per `15-VERIFICATION.md` criterion 5); `docs/integration/omp.md` live rehearsal 2026-11-17 on Omp 18.22.0 (`test/integration/omp-boot-install.test.ts`, one test, pass) and OMP-LIVE-01 (2026-10-28, status item `realm active`). | covered-by-later-evidence |
| 9 | Human Verification 5, Claude Code and Grok Build entries | `docs/integration/hosts.md` and `docs/integration/mcp.md` (2026-10-29): both real clients connect to `realm mcp` in isolated homes and discover the six tools. `docs/hosts/snippets/claude-code.md` T2 row: live 2026-11-17, Claude Code 2.1.322, 3 of 3 passed (`claude mcp get` and `claude mcp list` parse the recipe's entry and launch the registered argv). `hosts.md` tier-2 row: `grok plugin validate` passes. | covered-by-later-evidence |
| 10 | Human Verification 5, Muse Code `~/.config/muse/settings.json` entry | `docs/integration/hosts.md`: `muse plugins validate` passes for the adapter bundle (tier 2), but "Muse Code, Hermes Agent and Omp were not checked (no connectivity command, or no usable install on this machine)". Nothing records the `mcp_servers` entry in `docs/hosts/snippets/muse-code.md` being loaded by a real Muse Code. Missing: a Muse Code run with that entry applied showing the `realm` server in `/mcp`. | still-open |
| 11 | Human Verification 5, Hermes Agent `~/.hermes/config.yaml` entry | `docs/hosts/snippets/hermes-agent.md` "Evidence reached": T1 offline only; T2 (`hermes mcp list` and `hermes mcp test realm`) "gated, records no result yet", the `hermes` CLI "was broken on the verification machine"; `docs/integration/host-support-matrix.md` lists hermes live as "not run". Missing: a passing `REALM_LIVE_HERMES=1` run or a manual `hermes mcp test realm`. | still-open |
| 12 | Human Verification 6 and the tail of 1: `stat` on `STATE_DIR/run` (700) and `STATE_DIR/run/control.sock` (600) after a live `realm up`; socket removed after `down` | Code and doc only: `docs/integration/runtime-decision.md` "Directory modes" (run directory created at 0700, an existing one must be exactly 0700 and owned, else `SCHEMA_INVALID`). The `control.sock` mentions in `docs/integration/openshell.md` concern the runtime's own channel socket, not the daemon control socket. No live record found in any file read. Missing: a `stat -c` capture of the run directory and the control socket during a live run, and a post-`down` check that the socket is removed (`src/daemon/daemon.ts` arms the daemon stop when the last session is released, so the removal is expected but unrecorded). | still-open |

**Verdict counts:** covered-by-later-evidence 7 (rows 1, 2, 3, 5, 7, 8, 9), superseded 1 (row 4), still-open 4 (rows 6, 10, 11, 12).

**Result:** status stays `gaps_found`; `reverify_open: 4`. The four open items are live captures that no later run recorded: the doctor `control-channel` warn row with the daemon down, a real Muse Code load, a real Hermes Agent load, and the control socket and run directory modes (plus socket removal after `down`) on a live start.

_Re-verified: 2026-11-17_

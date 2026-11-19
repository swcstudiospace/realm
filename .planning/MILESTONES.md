# Milestones

## v6.0 Responsiveness, exec kill proof, host ids and evidence debt (Shipped: 2026-11-19)

**Phases completed:** 7 phases, 17 plans (plans 38-02 and 38-03 were superseded by Phase 44 and not executed)

**Requirements:** 19 audited (OMPR-01..06, EXEC-01..03, HOSTID-01..03, TEAR-01..02, DEBT-01..03, KIMI-01..02): 17 marked Complete (OMPR-02 not triggered, OMPR-03 as VOID, HOSTID-02 and DEBT-03 with recorded partials), OMPR-01 carried (not met) and OMPR-06 partial. Audit: `milestones/v6.0-MILESTONE-AUDIT.md` (passed_with_accepted_limitations).

**Key accomplishments:**
- The Omp cold attach could not be measured on a quiet host: Phase 38's window made six attempts and recorded one valid run (case `serving-stall`), so its frozen rule gave VOID and OMPR-01 stays not met with OI-11 `Carried (no quiet slot)`. The owner (2026-11-19) took that run and the loaded runs as sufficient to act, and Phase 44 corrected the harness (the verdict window starts at Omp's ready frame; control-relative and CPU-pressure secondary measures), split the daemon launch out of the CLI (the extension's value imports 98 to 43) and deferred the attach start one turn (hermetic proof, fail closed kept), then ran a paired loaded A/B window that ended VOID (three valid pairs of five, OMPR-06 partial). No effect of the change is claimed, and `src/omp/plugin.ts` is at the 1000-line ceiling.
- A real defect was closed (F-3, Phase 39): a timed-out exec left its process tree running in the sandbox, because the group kill is denied by the sandbox seccomp. An in-sandbox bash `/proc`-sweep watchdog now wraps every dispatcher exec; live closeout C showed the tree dead 2988 ms after the `TOOL_TIMEOUT` reply with 269 s of the sleeper's life left. The earlier Phase 24 closeout C and Phase 36 records were invalid for the kill claim and are corrected; the reply, bounds, audit line and error catalogue are unchanged.
- Muse Code, Prime Agent and Grok Build have host ids and recipes (22 host ids, pinned in docs and tests) and attach under the enforce default (GAP-34-01 closed); the evidence is the daemon proof and the hosts' own CLIs at the validator tier, with no production tier and no model-driven call, and a Grok Build session that loads the shared Claude files stays attributed `claude` (GAP-40-01).
- The slow daemon stop was explained and bounded (Phase 41): the stage bounds of one session end summed to more than the 30 s stop bound; the bound was derived and 10 live stops showed none near 30 s. Finding F-41-1 (a start failure after a rapid stop) is carried with its cause not established.
- The v5.0 evidence debt was paid (Phase 42): the whole unit suite as uid 5002 (5542 tests, 0 failures, after a stale-build artefact and one test fix), a breaking-change marker guard (`scripts/check/breaking-change-guard.mjs`, 46 tests) and its CI workflow (option A, merged on the owner's review of the exact head, green on a real pull request), the ENF-04 closure statement; the ship flow's own `--enforce` run is owner-side and unconfirmed (DEBT-03 partial).
- Kimi Code 2.6.3 passed the validator and production tiers cold, and the legacy kimi-cli 1.51.0 passed its validator tier and failed its production tier (cause not established; GAP-43-01 to GAP-43-03). Owner decisions of 2026-11-18/19: v6.0 scope A to F, release line 0.6.x, the latest release line is supported, CI option A, take the loaded evidence for Phase 44, complete v6.0; the v7.0 candidates are the Omp responsiveness repeat with a harness fix, F-41-1, the legacy kimi CLI and GAP-43-01, GAP-40-01 and production tiers for the new hosts, and the ship-flow enforce confirmation.

---

## v5.0 Cold attach, enforced capability tokens and evidence (Shipped: 2026-11-18)

**Phases completed:** 5 phases, 13 plans, 0 tasks

**Requirements:** 14 audited (COLD-01..04, ENF-01..04, EVID-01..03, V1LIVE-01..02, SPEC-01), all Complete (ENF-04 with a recorded partial). Audit: `milestones/v5.0-MILESTONE-AUDIT.md` (passed_with_accepted_limitations).

**Key accomplishments:**
- `realm mcp` answers the MCP handshake and `tools/list` at once and boots behind a not-active gate (calls refused `REALM_NOT_ACTIVE`, retryable, until ready; the same connection serves afterwards): the first answer came in 500 ms where it took 35 to 60 s, and claude 2.1.322, opencode 1.19.5 and codex-cli 0.154.0 connected cold within the bound with the warm-up removed (GAP-31-04 and GAP-23-02 closed). Release line 0.5.x.
- Capability tokens enforce by default, a breaking change with a documented opt-out (`"mode": "off"`): every shipped client attaches under enforce (a test per client class), a stale or unlabelled client is refused `POLICY_DENIED` with the cause and the fix on every text channel, and two real stale binaries were refused live. Muse Code, Prime Agent and Grok Build have no host id and stay refused (GAP-34-01); ENF-04 is partial (the 34-03 squash title lacks the `!` marker; the flip commit is in the changelog).
- The token claims were measured: Set A of the capability tests ran twice as a regular user on a `ptrace_scope` 1 host (494 of 494), a non-descendant same-uid process was denied at the memory open (descendant and root controls found the secrets), and a live enforce proof on the production stack showed claude cold to active with audit lines carrying host and kid, using a scripted loopback provider and no real model. Tokens give no defence against a same-uid reader.
- The v1.0 live items this host can run were re-verified or carried with a named reason, and all 14 open items have a final label; OI-13 closed by the owner (Q11), the Anda items dropped (D-27-01), and OI-11 (Omp responsiveness) recorded as a loaded-host run that failed its thresholds, carried with finding F-3 into a v5.1 candidate phase.
- `docs/specs/realm-spec.xml` no longer describes the Anda bridge, `andaUrl`, the `ANDA_` codes or the degraded state (five states), with history kept and marked retired, on the owner's instruction of 2026-11-18. Owner decisions of 2026-11-18: complete v5.0; OI-13 accepted; OI-11 accepted as a loaded-host run; F-3 and OI-11 planned for v5.1, not built.

---

## v4.0 Anda removal, MCP hardening and production boot proof (Shipped: 2026-11-18)

**Phases completed:** 6 phases, 14 plans, 0 tasks

**Requirements:** 18 audited (ANDAX-01..05, MCPA-01..02, CAPT-01..09, BOOTP-01..02), all Complete. Audit: `milestones/v4.0-MILESTONE-AUDIT.md` (passed_with_accepted_limitations).

**Key accomplishments:**
- Every open Anda item dispositioned by recorded owner decisions (D-27-01 to D-27-05), the v2.0 carry list reconciled, and the Anda bridge removed with a clean cutover: no `andaUrl` key (refused with a migration sentence), no `ANDA_` codes, no degraded state, no doctor check (release line 0.4.x, breaking change).
- `realm mcp` advertises tool annotations for all six tools in both protocol eras, pinned by an independent table, a mutation test and the smoke gate.
- A bounded capability-token spike recorded its criteria outcome (DROP) and the owner's override to BUILD; Phase 32 built per-session, per-host HMAC capability tokens for stdio hosts (keyring with rotation and revoke, gate before dispatch fail-closed with policy, audit attribution, `realm host token`, doctor item), default off, with the no-defence-against-a-same-uid-reader limit documented.
- Production-stack boot rehearsals on rootless Podman 5.7.1: claude 2.1.322 and codex-cli 0.154.0 (and opencode 1.19.5) booted through their own CLIs on 2026-11-18; kimi and kimi-code are named gaps.
- Owner decisions of 2026-11-18: complete v4.0; plan enforce-by-default capability tokens and a serve-early cold-attach phase as v5.0 candidates.

---

## v3.0 v3.0 (Shipped: 2026-11-17)

**Phases completed:** 15 phases, 68 plans, 0 tasks

**Key accomplishments:**
- Closes the code side of verification gap 1 (CR-01): under advisory, a host `edit` and a Realm `write` are refused when the realm status cannot be read. HARN-02 and OMP-05 are NOT closed by this plan; the live half stays with plan 12-03.
- Closes the code and test side of verification gap 2 (WR-01): the four HARN-02 registered-write tests now exist and run over the real dispatcher, pinned filesystem, lock table and audit log. The live guard cases are re-pointed to the owner's 2026-11-12 ruling, and the guard docs describe them. HARN-02's live half, HARN-03, HARN-04 and OMP-05 are NOT closed by this plan.
- Status: complete.

---

## v2.0 Host Adapters, Live Verification and Production Isolation (Shipped: 2026-10-29; releases 0.2.0 and 0.2.1)

**Phases completed:** 11 phases (8, 9, 9.1 to 9.7, 10 and 11), 12 plans (task count not recomputed in this archive)

**Requirements:** 90 audited; 76 satisfied, 6 superseded by recorded owner decisions, 8 carried (FS-02, ANDA-01 to ANDA-04, OMP-05 and PRD-DRV-01 open; UI-01 an accepted limitation). Audit: `milestones/v2.0-MILESTONE-AUDIT.md` (gaps_found, accepted as tech debt under the owner's delegation).

**Key accomplishments:**
- Adapter bundles for Claude Code, Grok Build, Muse Code, Hermes Agent, Prime Agent and Omp, each validated by its host in an isolated home, shipped in the package and asserted by the pack check.
- A live Omp verification: the status item, the retry command, and a daemon that outlives the host (OMP-LIVE-01 to OMP-LIVE-04).
- The production isolation build: a rootless Podman 5.7.1 runtime with delegated limits, a production TLS and JWT OpenShell gateway, the Realm compute driver over gRPC, a hardened container lifecycle with a 26-property create-time verifier and a vendored seccomp profile, mediated egress and DNS, and a host supervisor, driven by `realm up`, `down`, `status`, `doctor`, `mcp` and `acp`.
- A nine-scenario production live suite, 31 of 31 on the installed 0.2.0 and on the installed 0.2.1.
- Release engineering: releases cut by the release job with `SHA256SUMS` and a CycloneDX SBOM, workflows without a persisted credential and with per-job Pages permissions, and NOTICE attribution for the vendored Apache-2.0 material.
- A real-host audit of the released build that found and fixed five defects the records had marked complete: the MCP server could not be used from Claude Code, its results and an `exec` descriptor did not match the claimed revision and the Anthropic API, both agent surfaces advertised 0.0.0, and the Omp attach probe (pull request 7, release 0.2.1).

---

## v1.0 (Archived: 2026-10-22; provisional name for the 0.1.x release line)

**Phases completed:** 7 phases, 40 plans (task count not recomputed in this archive)

**Key accomplishments:**
- createRealmHandle wires RuntimeConfig plus real adapters into one LifecycleController and one ToolDispatcher sharing a single LockTable, with OMP-01/OMP-05 tests and structural pins
- MCP revision handling, ACP v1 plus realm/tool extension, and Omp API names verified against the official pages, all pinned by exact-string doc tests.
- Newline-delimited JSON-RPC 2.0 stdio server over the shared dispatcher: probe-plus-initialize handling, six-tool unchanged-map routing, and a client-shaped end-to-end drive, with no tool logic in the surface.
- ACP v1 stdio agent with the realm/tool Realm extension routing all six ToolCall maps unchanged to ToolDispatcher.call, covered by nine TOOL-05 cases over in-memory streams
- Same ToolCall through MCP and ACP returns outcome-equal payloads on one dispatcher, a static guard proves the three surfaces hold no tool logic, and the taxonomy cites all six Phase 5 IDs.
- NDJSON control-channel wire format with request ids and catalogue-code-only errors, plus 0700/0600 socket guards bounded by SOCKET_TIMEOUT_MS — no daemon logic.
- Single-owner daemon with reap-before-serve, four-method channel dispatch, and graceful down shutdown, sharing the composition-root wiring with realm mcp
- `realm` CLI with up/down/status/doctor/mcp, exits 0/1/2, detached argv-form spawn, probe-first up with bounded PODMAN_MISSING, and the Phase 5 MCP server over stdio
- Eight-item doctor report with control-channel and agentos checks carrying fix texts, plus the package.json bin entry at the compiled CLI

---

# Milestones

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

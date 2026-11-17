---
phase: 03-container-runtime-and-bridges
verified: 2026-10-21T00:00:00Z
status: gaps_found
reverified: 2026-11-17
reverify_open: 4
score: 10/10 must-haves unit-verified, 5/10 with live-gated parts
---

# Phase 3: Container Runtime and Bridges — Verification Report

**Phase Goal:** Realm runs a rootless, hardened Podman container with OpenShell
and AgentOS, reaches Anda through the bridge, and gates file-mutating tools
through the lifecycle controller.
**Verified:** 2026-10-21
**Status:** gaps_found (unit-verified, live-gated; no live
container, OpenShell sandbox, AgentOS run, or Anda RPC is claimed — host runs
Podman 4.9.3, below the 5.x OpenShell's Podman driver requires)

## Goal Achievement

### Observable Truths

| # | Truth (Roadmap SC) | Status | Evidence |
|---|--------------------|--------|----------|
| 1 | Non-active mutation returns structured error (required), warns (advisory), never hangs | ✓ unit-VERIFIED | `src/lifecycle/mutation-gate.ts` wraps frozen `decideMutation` (`proceed`/`proceed-with-warning`/`refused`+code); `test/lifecycle/mutation-gate.test.ts`; bridge wiring `test/lifecycle/bridge-states.test.ts` |
| 2 | Probe reports `PODMAN_MISSING`/`PODMAN_MACHINE_DOWN` w/ reason; running container is rootless, digest-pinned, non-privileged, caps dropped, read-only root + tmpfs, CPU/mem/PID limits, workspace+state mounts only | ✓ unit-VERIFIED, live GATED | `src/runtime/podman-probe.ts`, `src/runtime/config.ts`, `src/runtime/hardening.ts` (`HARDENING_PROFILE` + `verifyInspect`: rootless, `capDrop ALL`, `capAdd []`, `no-new-privileges`, read-only root, mounts); `test/runtime/{podman-probe,config,hardening}.test.ts`; fail-closed destroy + `OPENSHELL_START_FAILED` in `src/runtime/session-execution.ts` (`test/runtime/session-execution.test.ts`). RT-01 wording superseded by S-08/D-47: the container is the OpenShell-driver-created session sandbox, recorded in `docs/integration/runtime-decision.md` |
| 3 | All agent execution through OpenShell in-container; AgentOS only via supported API, bounded-backoff restart, `AGENTOS_CRASH_LOOP` at max | unit-verified against fakes; not satisfied in production (RT-04 open, audit G-01) | `src/runtime/openshell.ts` (pinned argv, deny-all policy doc, idempotent create keyed by session) + `test/runtime/openshell-{argv,policy,routing}.test.ts` (routing proves no bypass; closed libpod client has exactly 5 methods, no exec/attach/start — `src/runtime/libpod-{client,routes}.ts`); `src/runtime/agentos.ts` supervisor (500ms/8000ms+jitter, 5th failure holds + `AGENTOS_CRASH_LOOP`, 60s-alive reset) + `test/runtime/agentos-supervisor.test.ts` vs `test/support/fake-agentos.ts`. RT-03 wording superseded by S-08/D-46 (gateway on host). No concrete driver bound (OQ-P3-05/06): e2e session start is a missing prerequisite, not a gap |
| 4 | Anda client handshakes; mismatch → `ANDA_VERSION_MISMATCH`; unreachable → `ANDA_UNREACHABLE` + degraded + bounded backoff+jitter retry; boundary in `anda-decision.md` | ✓ unit-VERIFIED, live GATED | `src/anda/client.ts` (sticky mismatch, per-attempt timers, `computeBackoffDelayMs` from `src/core/backoff.ts`) + `src/anda/shape.ts`; `test/anda/{handshake,reconnect,boundary-decision,no-shim}.test.ts`; `test/lifecycle/bridge-retry.test.ts` (degraded + background retry); `docs/integration/anda-decision.md`. ANDA-02 accepted as shape check (no documented version surface) |
| 5 | `realm down` removes every realm-labelled container, state → disconnected, zero orphans; Podman-gated suites skip with stated reason on <5.x | ✓ unit-VERIFIED, live GATED | `test/runtime/down-sweep.test.ts` (label sweep via fake libpod); `test/integration/podman-gate.test.ts` (4 tests skip: "Podman 4.9.3 detected; OpenShell requires Podman 5.x; `PODMAN_UNSUPPORTED_VERSION`"); `test/quality/suite-taxonomy.test.ts` enforces the skip-reason naming |

### Required Artifacts

All present, substantive, wired: `src/runtime/{podman-probe,podman-version,libpod-client,libpod-routes,openshell,agentos,hardening,config,session-execution}.ts`, `src/anda/{client,shape}.ts`, `src/core/{backoff,ports}.ts` (`BridgePort` beside frozen `ExecutionService`), `src/lifecycle/{controller,mutation-gate}.ts`, `src/doctor/checks.ts`, `docs/integration/{runtime-decision,anda-decision}.md`. No frozen Phase 1/2 file edited; TOOL-02 `child_process` allowlist extended to `session-execution.ts` + `doctor/checks.ts` only.

### Key Link Verification

| From | To | Via | Status |
|------|----|-----|--------|
| mutation callers | controller gate | `mutation-gate.ts` consulted before any mutating path; callers migrated (03-09) | WIRED |
| controller | Anda bridge | degraded on `ANDA_UNREACHABLE`, background retry (`bridge-retry`/`bridge-states` tests) | WIRED |
| session-execution | OpenShell runner | workload starts only via pinned argv; policy doc written before create | WIRED |
| session-execution | hardening verifier | inspect verified on create AND reuse; mismatch → destroy + `OPENSHELL_START_FAILED` | WIRED |
| stop-during-create | container reclaim | `test/lifecycle/create-interrupt.test.ts` | WIRED |
| doctor | runtime checks | `test/doctor/{checks,runtime-checks}.test.ts` | WIRED |

### Requirements Coverage

| Requirement | Evidence | Status |
|-------------|----------|--------|
| CORE-05 | `test/lifecycle/mutation-gate.test.ts` (`src/lifecycle/mutation-gate.ts`) | ✓ SATISFIED (unit; never-hangs via `withTimeout` boundaries) |
| RT-01 | `test/runtime/hardening.test.ts`, `session-execution.test.ts` | ✓ SATISFIED (unit; live conformance GATED) |
| RT-02 | `test/runtime/podman-probe.test.ts`, `podman-version.test.ts` | ✓ SATISFIED (unit; live probe output GATED) |
| RT-03 | `test/runtime/openshell-routing.test.ts`, `openshell-argv.test.ts` | ✓ SATISFIED (unit; live argv conformance GATED) |
| RT-04 | `test/runtime/agentos-supervisor.test.ts`. Evidence basis: fakes only (`test/support/fake-agentos.ts`). | Open (unsatisfied; G-01 per v1.0 audit). No AgentOS driver is bound (`src/daemon/daemon.ts:529-534`); `docs/integration/agentos.md` "Spike result" recommends no-go. |
| RT-09 | `test/runtime/down-sweep.test.ts` | ✓ SATISFIED (unit; zero-orphan live sweep GATED) |
| ANDA-01 | `test/anda/boundary-decision.test.ts`, `docs/integration/anda-decision.md` | ✓ SATISFIED (unit) |
| ANDA-02 | `test/anda/handshake.test.ts` | ✓ SATISFIED as shape check (accepted; live RPC GATED) |
| ANDA-03 | `test/anda/reconnect.test.ts`, `test/core/backoff.test.ts`, `test/lifecycle/bridge-retry.test.ts` | ✓ SATISFIED (unit) |
| ANDA-04 | `test/anda/no-shim.test.ts` (no `src/anda/native/`) | ✓ SATISFIED (shim condition not met) |

### Gates (run by verifier)

- `npm run typecheck` (`tsc --noEmit`): clean
- `npm run lint` (ESLint): no issues
- `npm test`: 721 total — 717 pass, 0 fail, 4 skipped (the 4 Podman-gated live suites, each naming `PODMAN_UNSUPPORTED_VERSION`)
- `node --test dist/test/integration/*.test.js`: 4 skipped with stated reason (Podman 4.9.3 < 5.x)
- Host (read-only): `podman version 4.9.3`, `openshell 0.1.2`

### Live-gated items (NOT passed; Phase 4+ or Podman 5.x host required)

1. RT-01 live container conformance · 2. RT-03 live OpenShell argv conformance · 3. RT-04 live AgentOS run (also needs bound driver, OQ-P3-05/06) · 4. RT-09 live zero-orphan sweep · 5. ANDA-02/03 live RPC handshake/retry. Open questions OQ-P3-01/02/03/12/14/15 remain live-gated per `runtime-decision.md`; OQ-P3-11 Open, OQ-P3-16 Blocked-for-Phase-4 (egress mapping).

### Gaps

- RT-04 open, audit G-01. Production has no AgentOS driver: `src/daemon/daemon.ts:529-534` binds none, and `src/runtime/session-execution.ts:205-207` throws `AGENTOS_NOT_CONFIGURED`. `docs/integration/agentos.md` "Spike result" recommends no-go. The passing supervisor test runs against `test/support/fake-agentos.ts` only.

No debt markers introduced (phase files grep-clean for `TBD|FIXME|XXX` by convention of prior phases; implementation adds no stubs).

---
_Verified: 2026-10-21_
_Verifier: Claude (gsd-verifier)_

## Re-verification 2026-11-17

Method: read-only re-read of the files cited below; nothing was run. Later evidence comes from v2.0 (live production suite on rootless Podman 5.7.1, 2026-10-28 onward) and v3.0 (Phase 14 to 19 verification files). Verdicts: covered-by-later-evidence, superseded (design changed; decision cited), still-open (what is missing is stated).

Common sources, abbreviated below: **V20-REQ** = `.planning/milestones/v2.0-REQUIREMENTS.md` traceability table (RT-01 to RT-09 and ANDA-01 to ANDA-04 rows); **V20-AUDIT** = `.planning/milestones/v2.0-MILESTONE-AUDIT.md`; **OSH** = `docs/integration/openshell.md`; **RTD** = `docs/integration/runtime-decision.md`; **P96** = `.planning/milestones/v2.0-phases/09.6-integration-live-proof/09.6-VERIFICATION.md`; **P97** = `.planning/milestones/v2.0-phases/09.7-review-finding-remediation/09.7-VERIFICATION.md`; **P19** = `.planning/phases/19-resume-and-checkpoint/19-VERIFICATION.md`.

| # | Item (quoted from this report) | Current evidence (file, recorded result, date) | Verdict |
|---|--------------------------------|-----------------------------------------------|---------|
| 1 | Live-gated item 1: "RT-01 live container conformance" (SC2 "running container is rootless, digest-pinned, non-privileged, caps dropped, read-only root + tmpfs, CPU/mem/PID limits, workspace+state mounts only") | V20-REQ RT-01 row: "Complete (live 2026-10-28: the create-time verifier passes on every live create; CapEff 0 and CapBnd 0; rootless Podman 5.7.1; digest-pinned image; limits enforced)". P96 "Verified live": uid 1001, CapEff 0, CapBnd 0, NoNewPrivs 1, Seccomp 2, `/etc` and `/home` read-only, `/workspace` bound (2026-10-28, 28 of 28). OSH "Result (2026-10-28, rebuilt image)": 31 of 31 assertions against the 26-property create-time verifier; OSH "Result (2026-10-30)": 33 of 33. P19 live table: 40 of 40 on the Phase 19 build (`2ff6df9`, runs 2, full3-1 to 3 and settle-1, 2; run 1 had 39 pass and one failure in scenario 12, owner-accepted override, 2026-11-16). | covered-by-later-evidence |
| 2 | SC2 and live-gated detail: "Probe reports `PODMAN_MISSING`/`PODMAN_MACHINE_DOWN` w/ reason" (RT-02 "live probe output GATED") | P97 RT-02 bullet: with no podman on PATH `realm up` exits 1 with `PODMAN_MISSING` and a human-readable reason; with an empty `XDG_RUNTIME_DIR` it exits 1 with `PODMAN_MACHINE_DOWN`; no daemon and no control socket created (live 2026-10-28). V20-REQ RT-02 row repeats it. | covered-by-later-evidence |
| 3 | Live-gated item 2: "RT-03 live OpenShell argv conformance" (the pinned `sandbox create --label ... --no-keep --detach -- workloadArgv` form) | The argv itself was replaced: RTD OpenShell pin section marks the pinned argv "Superseded by `docs/integration/openshell.md` (one sandbox per session ... with no workload command)" and "Historical (superseded 2026-10-28): the 0.1.2 pin, the `--no-keep` and `--detach` argv ... no longer hold. The pin is 0.1.5". RTD also records that the realm compute driver replaced OpenShell's Podman driver (P96 "Open owner decisions" item 9). Nothing live remains to conform against the old argv. Replacement behaviour is live-proven (rows 4 and 12). | superseded |
| 4 | SC3: "All agent execution through OpenShell in-container" / RT-03 "no bypass" | V20-REQ RT-03 row: "Complete on the built-in path (live 2026-10-28: the runtime is PID 1 and the runner and every exec run through OpenShell exec via the gateway and supervisor; no container-runtime exec route exists; PD-15 decided; wording not amended)". RTD "Requirement-wording conflicts" (S-08, D-46, D-47) already superseded the "inside the container" wording. OSH scenario 1: `openshell sandbox exec -- sh -c 'exit 7'` exits 7 (2026-10-28, 2026-10-30). | covered-by-later-evidence |
| 5 | Live-gated item 3: "RT-04 live AgentOS run (also needs bound driver, OQ-P3-05/06)" and the Gap "RT-04 open, audit G-01. Production has no AgentOS driver: `src/daemon/daemon.ts:529-534` binds none ... `AGENTOS_NOT_CONFIGURED`" | Driver now bound: `src/daemon/main.ts` (`productionAgentOsDriver` at l.59, called at l.83); `.planning/milestones/v2.0-INTEGRATION-CHECK.md` F1: "`src/daemon/main.ts:79-93` always binds the AgentOS driver". `docs/integration/agentos.md` l.97, l.170, l.175 carry "Historical (superseded 2026-10-28)" notes: the driver is bound from the digest-pinned image and the runner runs as a managed `sandbox exec` child; the "recommendation pending" no-go status no longer holds. Live: OSH scenario 8 (runner killed inside the sandbox; `realm status` reports `error`, `AGENTOS_CRASH_LOOP`, label `realm disconnected` within 45 s; then `down` and a new `up` reach `active`), passing in the 31 of 31 (2026-10-28), 33 of 33 (2026-10-30) and Phase 19 40 of 40 runs (P19 l.127: "Scenario 8 ... is `ok` in every full-suite file"). P97 E-26: real Omp TUI moved `active` to `error` with `AGENTOS_CRASH_LOOP` 7.6 s after the runner was killed. V20-REQ RT-04 row: Complete. Residue (not a live gap): `docs/specs/realm-spec.xml` still describes restart with backoff; owner item 13 in V20-AUDIT section 6 and P97 l.96. | covered-by-later-evidence |
| 6 | SC3 / RT-04 mechanism: "bounded-backoff restart, `AGENTOS_CRASH_LOOP` at max" (supervisor 500ms/8000ms+jitter, 5th failure holds, 60s-alive reset) | Behaviour redefined by owner decisions. 2026-10-28: RT-04 amended to ruling N1, one failed probe is terminal, no automatic restart (V20-REQ RT-04 row "wording amended by owner decision 2026-10-28 to match ruling N1"; P97 l.80 and E-26). 2026-11-16: the supervisor still never restarts; the daemon health loop runs a bounded re-attach, up to three attempts after 10, 20 and 30 s (P19 rows "docs/integration/omp.md states the amended rule" l.125 and "Live evidence of the re-attach": `health.reattach` log lines at 2026-11-16T12:57:38Z, 13:10:12Z, 13:36:30Z; `docs/integration/omp.md` health-probe paragraph). Phase 17 added `OPENSHELL_GATEWAY_LOST` so gateway or driver loss is not reported as `AGENTOS_CRASH_LOOP` (`.planning/phases/17-observability-and-tamper-evident-audit/17-VERIFICATION.md` row 4, verified 2026-11-15). | superseded |
| 7 | Live-gated item 4: "RT-09 live zero-orphan sweep" (SC5 "`realm down` removes every realm-labelled container ... zero orphans") | V20-REQ RT-09 row: "Complete (live 2026-10-28: `realm down` leaves zero containers, sandboxes, supervisors, state and secret directories in every live scenario)". OSH "Cleanup" paragraph (each scenario runs `realm down`, then fails on any residue; polling up to 90 s) with results 31 of 31 (2026-10-28) and 33 of 33 (2026-10-30). P96: "Residue after the runs: no daemon, no containers, no sandboxes, no state or secret directories". `.planning/milestones/v2.0-phases/09.3-hardened-container-lifecycle/09.3-VERIFICATION.md` acceptance 4 and 5 (delete is idempotent; a realm-labelled orphan is removed by `startupSweep`; PASS live, Podman 5.7.1). `test/runtime/down-sweep.test.ts` still present. | covered-by-later-evidence |
| 8 | SC5: "Podman-gated suites skip with stated reason on &lt;5.x" | `test/integration/podman-gate.test.ts` and its `test/quality/suite-taxonomy.test.ts` entry (l.41) still exist. The live bodies moved to `test/integration/production-driver.test.ts` on 2026-10-28 (RTD Phase 4 section). The suites now run for real on Podman 5.7.1 (rows 1 and 7). Phase 13 `13-VERIFICATION.md` row 4 records skip attribution "38 of 40 skips named; 1 skip without reason text (Residual 4)", a minor residual in a passed phase. | covered-by-later-evidence |
| 9 | Live-gated item 5 (part): "ANDA-02 ... live RPC handshake" | No live Anda engine has ever been reached. OSH "Not in the suite": "The Anda engine is not in scope". `docs/integration/omp.md` live limits: "The Anda engine is not in scope". `docs/integration/hardening-plan.md` limits: "No Anda or ICP credentials were used". OSH 2026-10-28 doctor run: `anda-bridge` warns because no engine URL is configured. V20-REQ ANDA-02: "Partial (live-gated)"; V20-AUDIT section 2: "never run against a live engine ... No engine is configured on any host". `.planning/REQUIREMENTS.md` carries ANDA-01 to ANDA-04 as Partial (live-gated), "blocked by the Anda engine licence" (l.227, l.345 to l.348); `.planning/phases/RECOVERY-2026-10-31.md` l.140: "ANDA-01..04 stay licence-blocked/live-gated outside v3.0". Missing: a run of `src/anda/client.ts` handshake against a real Anda Engine `GET /.well-known/information`, and a version surface from Anda (the handshake remains a shape check, `docs/integration/anda-decision.md` section 3). | still-open |
| 10 | Live-gated item 5 (part): "ANDA-03 live RPC ... retry" (unreachable gives `ANDA_UNREACHABLE`, degraded, bounded backoff with jitter) | Same sources as row 9; no live Anda retry run is recorded anywhere (OSH, `docs/integration/omp.md`, V20-AUDIT). Only unit and fake-engine evidence exists (`test/anda/reconnect.test.ts`, `test/lifecycle/bridge-retry.test.ts`, unchanged). The no-engine-configured path is live-proven only as "`active` needs no Anda bridge when no `andaUrl` is configured" (OSH 2026-10-28 decisions), which is not a retry. Missing: a live run against a real engine that is stopped and restarted, showing degraded state and recovery. | still-open |
| 11 | SC4 and requirements ANDA-01 and ANDA-04 (reported "SATISFIED (unit)") | Code and tests unchanged and still present (`src/anda/client.ts`, `src/anda/shape.ts`, `test/anda/no-shim.test.ts`, `test/anda/boundary-decision.test.ts` listed under `test/anda`; `docs/integration/anda-decision.md` section 4, no shim). No later evidence adds a live connection. The project record still carries both as "Partial (live-gated)" (V20-REQ rows; V20-AUDIT section 2 and section 6 item 3; `.planning/REQUIREMENTS.md` l.345 to l.348). Missing: ANDA-01 "connects to Anda Engine components" has never been exercised live; the shim-free boundary (ANDA-04) has no defect, but its status follows the ANDA group until the owner closes the licence conflict (row 18) and a live engine is available. | still-open |
| 12 | OQ-P3-01 (live-gated): "Does the OpenShell Podman driver apply the `--label` values to the container it creates?" | Answered negatively and the design changed: RTD "D19-1 (2026-11-03). Sandbox ownership labels": "The realm no longer passes `--label` to `openshell sandbox create`, because OpenShell 0.1.5 does not apply those values"; ownership is the OpenShell label pair `openshell.managed=true` and `openshell.ai/sandbox-name`, owner ruling 2026-11-06. Live adoption by those labels: P19 criterion 3 (scenario 11 ok in all seven files). `09.3-VERIFICATION.md` acceptance 6 (label lookup finds the container, PASS live). | superseded |
| 13 | OQ-P3-02 (live-gated): "Can the driver bind-mount the workspace, and at what in-sandbox path?" | P96: "`/workspace` is the pinned host workspace (a file written in the sandbox appears on the host)". OSH 2026-10-28 evidence: "The pinned workspace is bound and receives no realm files"; `09.3-VERIFICATION.md` condition C1: `/workspace` mounted `noexec,nosuid,nodev,rbind` (PASS, live). | covered-by-later-evidence |
| 14 | OQ-P3-03 (live-gated): how is the digest-pinned image reference passed; verifier refuses a differing digest | `09.3-VERIFICATION.md` acceptance 7: inspect `ImageDigest` equals the pinned digest, zero socket-source mounts (PASS, live). P96 scenario 4: an image digest that does not exist fails closed with `OPENSHELL_START_FAILED` and leaves no container; OSH 2026-10-28: "A wrong image digest fails closed". P97 header: image pinned by digest, rebuilt via `npm run build:image`. | covered-by-later-evidence |
| 15 | OQ-P3-12 (live-gated): "OpenShell drift: docs 0.1.5, pinned verbs 0.1.2 ... `--no-keep` with `--detach`" | RTD marks it "Historical (superseded 2026-10-28): the pin is 0.1.5 and the create passes no `--no-keep`" (OQ table row and OpenShell pin section). P97 header and OSH record CLI, gateway and supervisor 0.1.5, with live runs on it. | superseded |
| 16 | OQ-P3-14 (live-gated): "Does the OpenShell driver apply the PID limit, read-only root, and capability drop?" (verifier passes on a created container) | OSH "Result (2026-10-28, rebuilt image)": 26-property create-time verifier, 31 of 31 (2026-10-28), 33 of 33 (2026-10-30). `09.3-VERIFICATION.md` acceptance 1: five kernel capability sets all zero, `verifyInspect` no failures (live). V20-REQ RT-01 row (verifier passes on every live create). The container is now created by the realm compute driver through libpod, so the verifier checks Realm's own create, not an OpenShell default. | covered-by-later-evidence |
| 17 | OQ-P3-15 (live-gated): "Does OpenShell accept the policy written as JSON (valid YAML 1.2)?" | `src/runtime/openshell.ts:392` still writes the policy as JSON text. Live: OSH l.396 (2026-10-28, rebuilt image, Podman 5.7.1, OpenShell 0.1.5): with the realm-rendered policy allowing `1.1.1.1:443` and `example.com:443`, allowed targets connect and others fail with `EACCES`; OSH 2026-10-28 evidence: the realm policy holds (`/tmp`, `/workspace` writable, `/etc` and `/home` read-only). [INFERENCE: acceptance of the JSON document is shown by its enforcement; no record states "JSON accepted" in those words.] | covered-by-later-evidence |
| 18 | OQ-P3-11 (Open): "Anda licence conflict (`anda.md` Q6)" | V20-AUDIT section 6 item 3: "The Anda engine licence conflict (OQ-P3-11) ... open, owner; ANDA-01 to ANDA-04 stay carried"; `.planning/REQUIREMENTS.md` l.227 and `.planning/PROJECT.md` l.37 repeat it. `docs/integration/hardening-plan.md` l.136 still lists the licence as inconsistent. No owner ruling is recorded in any file read. Missing: an owner decision resolving the MIT versus Apache-2.0 conflict before any Anda code is vendored. | still-open |
| 19 | OQ-P3-16 (Blocked for Phase 4): egress `network_policies` mapping | RTD "OQ-P3-16 resolution (D-82)": the schema page was read 2026-10-21 and the fields Realm writes are documented. Live: OSH scenario 3 and l.396: default-deny, allowlisted `host:port` connects, non-allowlisted IP and host and an IPv6 literal fail with `EACCES`, AAAA returns `ENODATA` (2026-10-28, rebuilt image); V20-REQ RT-05 row: Complete (live 2026-10-28, scenario 3). | covered-by-later-evidence |
| 20 | OQ-P3-05 and OQ-P3-06 (Blocked: "no documented channel between the host supervisor and the AgentOS library process", "`@rivet-dev/agentos-core` version, licence, and Node floor are not verified") | Channel question replaced by the built-in path: the runner runs as a managed `sandbox exec` child of the in-container runtime (PID 1), `docs/integration/agentos.md` l.97 "Historical (superseded 2026-10-28)"; P96 "Verified live"; V20-REQ RT-03 row. `package.json` l.81 now declares `@rivet-dev/agentos-core` `0.4.7` (read as a grep hit, not the surrounding section). [INFERENCE: this report did not read `npm view` or the licence record for that package; only the design change is cited.] | superseded |

### Tally

- covered-by-later-evidence: 11 (rows 1, 2, 4, 5, 7, 8, 13, 14, 16, 17, 19)
- superseded: 5 (rows 3, 6, 12, 15, 20)
- still-open: 4 (rows 9, 10, 11, 18)

Status stays `gaps_found`: the four open items all concern the Anda engine (ANDA-01 to ANDA-04 live behaviour and the OQ-P3-11 licence conflict). They need a reachable Anda Engine and an owner licence ruling, neither of which any file read records. Every non-Anda unresolved item from the original report (RT-01, RT-02, RT-03, RT-04 including gap G-01, RT-09, OQ-P3-01 to 03, 12, 14 to 16) is now covered or superseded with the evidence above. Frontmatter: `reverified: 2026-11-17`, `reverify_open: 4`.

# Phase 27: Anda disposition and v4.0 requirement closure - Context

**Gathered:** 2026-11-17, from the worktree at branch `gsd/v4-start` (tip: commit 3b19bee, "docs(milestone): start v4.0 (phases 27 to 31), release line 0.4.x, Anda replacement research"), `docs/integration/anda-replacement-research.md`, `docs/integration/{anda-decision,anda,runtime-decision,omp,hardening-plan}.md`, `.planning/{REQUIREMENTS,ROADMAP,PROJECT,STATE}.md` (v4.0 blocks and traceability), the archived v1.0, v2.0 and v3.0 milestone files (`.planning/milestones/`), and a repository search (word-bounded, case-sensitive) of `src`, `test`, `scripts`, `docs`, `AGENTS.md`, `README.md`, `.github`. Nothing was built, run or tested for this file.
**Status:** Planned (two plans, nothing executed). Requirement IDs ANDAX-01 and ANDAX-02 already exist in `.planning/REQUIREMENTS.md` (v4.0 section) and in its traceability table as "Planned". The orchestrator updates REQUIREMENTS, ROADMAP, STATE and PROJECT through GSD commands after the plans land; the plans never edit them (hand-off list in `27-02-PLAN.md`, Task 3).

<domain>
## Phase Boundary

Phase 27 is a **records and documentation phase. It changes no code and no test.** It does three things, in this order:

1. **Registers the owner decision** of 2026-11-17 in the two places the repository treats as binding (`AGENTS.md` "Settled runtime decisions" says a settled decision changes only through a new recorded decision in `docs/integration/runtime-decision.md`): the Anda bridge is removed as a breaking change with no shim; MCP over stdio stays the transport; a capability-token spike is included; the product stays local and single-user; the release line is 0.4.x (D-27-01 to D-27-05).
2. **Dispositions every open Anda item** (ANDAX-01): ANDA-01 to ANDA-04, OQ-P3-09, OQ-P3-10, OQ-P3-11, the four open items of the Phase 3 re-verification, and the Anda-adjacent PRD-DRV-01 carry notes. `docs/integration/anda-decision.md` gets a superseded banner and `docs/integration/anda-replacement-research.md` becomes the published rationale, with the owner's answers to its five questions recorded.
3. **Reconciles the v2.0 carry list** (ANDAX-02): FS-02, OMP-05, PRD-DRV-01 and UI-01 each get an evidence-cited disposition (complete, accepted limitation, or still open with a reason) in a durable record, `27-DISPOSITIONS.md`, that the orchestrator copies into REQUIREMENTS.md.

Out of scope (not claimed, not done here): removing any Anda code, the `andaUrl` key, the two error codes, the `degraded` state, the doctor check or the Anda tests (Phase 28); the unknown-`andaUrl` handling and the release note text (Phase 28, ANDAX-05); tool annotations (Phase 29); the capability-token spike (Phase 30); production boot rehearsals (Phase 31); any edit of `docs/specs/realm-spec.xml` (open question OQ-27-02); any edit of `CHANGELOG.md` or a version field (release-owned); any live run, build, test or gate run by the plan workers (the parent runs the gates once). `release/milestone.json` already reads milestone v4.0, minor 4 (commit 3b19bee), so the research skeleton's "bump `release/milestone.json`" item needs no work.
</domain>

<decisions>
## Implementation Decisions

### Evidence (every fact below: source, read date 2026-11-17, tier)

Tier letters: **O** observed by reading a repository file in this worktree; **R** a recorded owner statement or verification record in `.planning/` or `docs/`; **I** inference, not verified (also marked [INFERENCE]). Line numbers are those of this worktree and move; each plan re-reads before it edits.

| Id | Fact | Source | Tier |
| --- | --- | --- | --- |
| E-27-01 | The bridge is attached only when the runtime config names `andaUrl`; with none, a session goes `active` without one. | `src/runtime/config.ts` (`andaBridgeRequired`, line 132), `src/realm/compose.ts` line 71, `src/daemon/seams.ts` `defaultBridge` (line 199), `src/daemon/daemon.ts` line 191 | O |
| E-27-02 | The only request is one anonymous `GET /.well-known/information`; no `POST /{id}`, no credential; the "version handshake" is a shape check on three fields. | `src/anda/client.ts` lines 2 and 48, `src/anda/shape.ts` lines 1 to 10, `docs/integration/anda-decision.md` sections 1, 3 and 6 | O |
| E-27-03 | The bridge is the **only** producer of `degraded`: the single `transition("degraded", ...)` is in `onBridgeEvent`. The probe comment says the probe never produces it. | `src/lifecycle/controller.ts` lines 342 and 783 to 791 | O |
| E-27-04 | The bridge never connected to a real engine. Production live runs had no engine configured and the doctor `anda-bridge` check warned for that reason. The v2.0 audit records "No engine is configured on any host". | `.planning/milestones/v2.0-MILESTONE-AUDIT.md` line 59, `docs/integration/openshell.md` line 264 | R |
| E-27-05 | Owner decision of 2026-10-28: `active` does not depend on the bridge when no `andaUrl` is configured (found live, fixed in commit 40684e0). | `.planning/STATE.md` line 673 | R |
| E-27-06 | The Phase 3 re-verification (2026-11-17) keeps four items open, all Anda: row 9 (ANDA-02 live handshake), row 10 (ANDA-03 live retry), row 11 (ANDA-01 and ANDA-04 status follows the group), row 18 (OQ-P3-11 licence conflict). Frontmatter `reverify_open: 4`. | `.planning/milestones/v1.0-phases/03-container-runtime-and-bridges/03-VERIFICATION.md` lines 100 to 102, 109 and 119 | R |
| E-27-07 | The Anda licence conflict is still present: workspace manifest `MIT OR Apache-2.0`, READMEs say MIT only, the repository page shows Apache-2.0. Realm vendors nothing, so the conflict never blocked running code. No legal determination exists. | `docs/integration/anda-replacement-research.md` section 2.3, `docs/integration/anda.md` Q6, `docs/integration/anda-decision.md` section 5 | R |
| E-27-08 | The settled direction since 2026-10-22 (P5-D1) is that Anda consumes Realm as an MCP client over stdio; Realm needs no code that dials Anda. | `docs/integration/anda-decision.md` section 7, `.planning/milestones/v1.0-phases/05-omp-plugin-mcp-and-acp-surfaces/05-CONTEXT.md` lines 41 and 53 | R |
| E-27-09 | The product spec names Anda in the layering (lines 22, 23, 32), the bridge section `ANDA_ENGINE_BRIDGE` (lines 79 to 81), the `active` and `degraded` state definitions (lines 120, 121), the failure rule "Anda bridge unreachable: degraded" (line 139), the spike step (line 149) and the open-question lines 192 and 199. The spec is owner-controlled; it already carries one owner-directed amendment (D4, 2026-10-29, line 200). | `docs/specs/realm-spec.xml` | O |
| E-27-10 | `AGENTS.md` carries the settled bullet "Anda consumes Realm over MCP ... Realm reaches Anda over its HTTP API, with no shim" (line 112), plus the Project paragraph (line 9, "Anda Engine runs as a separate service, reached over HTTP") and the Layout bullet for `anda/` (line 73). | `AGENTS.md` | O |
| E-27-11 | `docs/integration/runtime-decision.md` holds the Anda layering line (line 27, S-08), the rows OQ-P3-09, OQ-P3-10, OQ-P3-11 (lines 85 to 87) and the log record `anda.listener_failed` (line 198). Its status line (line 3) says OQ-P3-11 is Open. | `docs/integration/runtime-decision.md` | O |
| E-27-12 | Archived Phase 3 decisions that the removal supersedes: S-12, D-52 (the `andaUrl` clause), D-61, D-62, D-64, D-65, D-66 and D-69 (the `anda-bridge` doctor item). | `.planning/milestones/v1.0-phases/03-container-runtime-and-bridges/03-CONTEXT.md` lines 43, 91, 134, 138, 148, 157, 159 and 181 | R |
| E-27-13 | FS-02 as of this tree: the walk is resolve-then-verify, "Node 22 has no openat"; `PinnedRoot` holds a real path plus device and inode, and `verifyPinnedAt` checks them at create time; every read, write and list re-resolves the path. Tests: `test/fs/toctou.test.ts` (lines 49, 69, 92), `test/fs/canonicalize.test.ts` (lines 219 to 260), `test/fs/root.test.ts` (lines 74 to 105), `test/fs/canonicalize.property.test.ts` (QR-07). | `src/fs/canonicalize.ts` lines 1 to 8, `src/fs/root.ts` lines 1 to 24, `src/fs/read.ts` line 42 | O |
| E-27-14 | FS-02 history: audit gap G-10 (v1.0), "accepted approximation, confirmed by the owner 2026-10-23" (v2.0 audit table, row FS-02: Node has no `openat2` with `RESOLVE_BENEATH`; closing it means a native component or another design); v3.0 kept it out of scope ("the owner's status call; the property tests of Phase 13 add confidence only"); the recovery record repeats it. | `.planning/milestones/v1.0-MILESTONE-AUDIT.md` line 210, `.planning/milestones/v2.0-MILESTONE-AUDIT.md` line 58, `.planning/MILESTONE-CONTEXT.md` line 51, `.planning/phases/RECOVERY-2026-10-31.md` line 140 | R |
| E-27-15 | OMP-05 is recorded Complete in the traceability table (2026-10-30, HARN-04, owner decision D2; scripted provider drove Omp 18.12.6's own `write` through the Realm plugin; not LLM-driven), and Phase 12 re-verification (verdict passed, truth 11 and the requirement row) re-grounds it on the current live guard run: 7 of 8 pass, 1 skipped, Omp 18.20.0, plus the warm HARN-03 pass. The carried-list checkbox is still `[ ]`. | `.planning/REQUIREMENTS.md` lines 24, 196 and 372, `.planning/milestones/v3.0-phases/12-scripted-provider-harness-and-omp-enforcement-spike/12-VERIFICATION.md` (live evidence table, truth 11) | R |
| E-27-16 | OMP-05 code and unit tests: the guard returns `REALM_NOT_ACTIVE` (`src/omp/plugin.ts` lines 444, 753 and 861); tests "OMP-05: advisory mode warns visibly and lets the guarded call through" and "OMP-05 (d)" (`test/omp/plugin.test.ts` lines 864 and 908); live cases C1 to C4b in `test/integration/omp-guard.test.ts` (gated). | repository files named | O |
| E-27-17 | `docs/integration/omp.md` still says "OMP-05 | Not proven live" (line 204), "OMP-05 ... stays unproven live" (line 243), "OMP-05 stays partial" (line 245) and that C1, C1b, C4 and C4b "are not run on the current source" (line 418). These sentences predate the Phase 12 re-verification and the HARN-04 closure. They contradict E-27-15. | `docs/integration/omp.md` | O |
| E-27-18 | UI-01: accepted limitation (owner decision 2026-10-23); re-measured 2026-10-28: keystrokes echoed within 0.2 to 1.2 s through a 24 s cold attach on a loaded host, "a measurement and not a proof". v3.0 changed nothing: Phase 16 context "UI-01 remains an owner-excluded limitation"; the recovery record "UI-01 stays accepted limitation, not a new nonblocking-UI claim". | `docs/integration/omp.md` lines 205 to 209, `.planning/milestones/v3.0-phases/16-omp-runs-in-the-sandbox/16-CONTEXT.md` line 58, `.planning/phases/RECOVERY-2026-10-31.md` line 140 | R |
| E-27-19 | PRD-DRV-01 as built: `AuthenticateSandbox` answers UNIMPLEMENTED and is not advertised (`src/runtime/driver/compute-driver.ts` lines 32 and 982; test "the driver does not offer AuthenticateSandbox: it is UNIMPLEMENTED", `test/runtime/driver/driver-service.test.ts` line 131); `DeleteWorkspace` refuses (`compute-driver.ts` line 625; tests at `compute-driver.test.ts` lines 1101 and 1122); socket directory 0700 and socket 0600 (`test/runtime/driver/socket-server.test.ts` line 64); the other RPCs work over the wire (`driver-service.test.ts` lines 141 and 153). | repository files named | O |
| E-27-20 | PRD-DRV-01 status record: "Open ... the amendment follows from the owner decisions of 2026-10-26 and 2026-10-27 and awaits confirmation"; the owner item is repeated in the Phase 9.6 verification ("confirm the amendment"), the v2.0 audit ("A product amendment, not a code change ... the owner ... carried") and `.planning/baseline/final-report.md` (listed beside the Anda licence conflict as a pending decision). Phase 18 explicitly did not amend it (`runtime-decision.md` line 470; `18-VERIFICATION.md` MULTI-04 row). | `.planning/REQUIREMENTS.md` line 373, `.planning/milestones/v2.0-phases/09.6-integration-live-proof/09.6-VERIFICATION.md` line 53, `.planning/milestones/v2.0-MILESTONE-AUDIT.md` lines 62 and 248 | R |
| E-27-21 | QUAL-01's amended exception list names two sites in `src/anda/client.ts` (a: `deliver`, 2 sites; b: `stamp`). Removing that file changes a standing requirement. | `.planning/REQUIREMENTS.md` lines 210 and 211 | O |
| E-27-22 | `src/runtime/config.ts` states a rule that no unknown key name is ever echoed in an error ("fixed text: no value and no unknown key name is ever included", line 88). The research default for ANDAX-05 ("fail with a clear error naming the key") must be reconciled with that rule in Phase 28. | `src/runtime/config.ts` | O |

### Findings that shape the plans

- **F1. The Anda disposition needs no new evidence, only a record.** The research (sections 2, 5, 7) is built from E-27-01 to E-27-08, all observed or recorded. Its search-only claims (A2A dates, SPIRE behaviour, Node peer-credential gap, Biscuit status) are not used by any decision below.
- **F2. Two contradictory records exist for OMP-05** (E-27-15 versus E-27-17) and one stale checkbox. The disposition is "Complete"; the plan adds dated supersession notes to `omp.md` and leaves the historical text intact.
- **F3. The Anda items and PRD-DRV-01 are paired in several "pending owner decisions" lists** (`.planning/baseline/final-report.md`, `09.7-CONTEXT.md`, `10-04-SUMMARY.md`, `PROJECT.md` line 37). ANDAX-01 closes the Anda half; PRD-DRV-01 is decided separately in ANDAX-02.
- **F4. A one-pull-request window exists between Phase 27 and Phase 28 in which the decision says "removed" while `src/anda/` still exists.** Wording in `AGENTS.md` and the banner must say "removal is scheduled in Phase 28; until it merges the code remains and is not guidance". The window is closed by Phase 28.
- **F5. Hand-offs Phase 28 must not miss** (recorded here because Phase 27 found them): the QUAL-01 exception list (E-27-21), the config message rule (E-27-22), the `degraded` readers (11 `src` files, 28 test files, 8 doc files, listed under Existing Code Insights), the 03-CONTEXT decisions it supersedes (E-27-12), `docs/integration/hardening-plan.md` line 136 (an Anda dTEE repository named `ic-tee`, a different repository from the Anda Engine and not the bridge; Phase 28 decides whether the row stays), and `.planning/PROJECT.md` lines 37 and 77.

### D-27-01. Owner decision: drop the Anda bridge entirely (breaking, no shim)

Recorded 2026-11-17 (owner). The Anda bridge is removed, not replaced. `andaUrl`, `ANDA_UNREACHABLE`, `ANDA_VERSION_MISMATCH` and the `degraded` state are removed; there is no compatibility shim, no deprecation period and no "reserved state". The removal is a breaking change visible in the 0.4.0 release notes. Rationale: `docs/integration/anda-replacement-research.md` sections 1, 2.2 and 7.1 (no identified capability need, no live evidence since Phase 3, the settled direction already has Anda consume Realm over MCP, the bridge is the sole producer of `degraded`, the licence question only matters if Anda code were vendored). The owner named no concrete Anda capability (research open question 1: answered no). Reversibility: cheap, because the documented HTTP surface lets a future client be added under a new decision (research 7.4); the revisit triggers are a named Anda capability need or a decision to vendor Anda code. Phase 28 executes it.

### D-27-02. Owner decision: MCP over stdio stays the transport

`realm mcp` over stdio, the control socket and the Omp plugin stay the connection mechanisms for agent hosts (research sections 5, 7.2). P5-D1 survives in its first half only: Anda may consume Realm as an MCP client over stdio; Realm never dials Anda. Streamable HTTP, OAuth 2.1, A2A, mTLS and SPIFFE stay out.

### D-27-03. Owner decision: include a capability-token spike

Phase 30 answers, with evidence, whether a per-session capability token is worth building, with a recorded build or drop decision and no production code unless the decision is build (research open question 4: answered yes, as a spike).

### D-27-04. Owner decision: local single-user only

No remote or multi-user Realm in v4.0 (research open question 3: answered no).

### D-27-05. Owner decision: release line 0.4.x, breaking-change signal

The milestone minor is 4 (`release/milestone.json`, already set). The removal carries a breaking-change commit subject (`refactor!` or `feat!`) so the 0.4.0 notes show it (research open question 5). `CHANGELOG.md` and version fields stay release-owned. The unknown-`andaUrl` behavior (refuse or ignore with a warning) is decided in Phase 28's context, within E-27-22.

### D-27-06. Where the decision is registered (this phase's engineering decision)

1. `docs/integration/runtime-decision.md`: a new tail section "Anda bridge removal (Phase 27, ANDAX-01)" holding D-27-01 to D-27-05 verbatim in substance, the supersession table (E-27-12 plus S-08's Anda line and the spec passages of E-27-09), what stays (the P5-D1 first half, `src/core/backoff.ts` and `src/core/timeout.ts` helpers that AgentOS uses), the catalogue statement (no code is added; `ANDA_UNREACHABLE` and `ANDA_VERSION_MISMATCH` are removed in Phase 28 by D-27-01) and the state-machine statement (`degraded` removed in Phase 28 by D-27-01). Inline "Superseded by D-27-01" markers on its status line, the S-08 Anda bullet and the rows OQ-P3-09 to OQ-P3-11. The `anda.listener_failed` log record (line 198) is left for Phase 28, which removes the code that writes it.
2. `AGENTS.md`: the settled bullet (line 112) is rewritten to the new decision, with the F4 wording. The Project paragraph and the Layout bullet are Phase 28's, in the same pull request as the code they describe.
3. `docs/integration/anda-decision.md`: a superseded banner and a disposition table above the unchanged historical sections, so no reader takes sections 1 to 8 as live guidance. Phase 28 reduces the file to a short tombstone and deletes `docs/integration/anda.md` (research 7.3); that is Phase 28's call, recorded here only as the hand-off.
4. `docs/integration/anda-replacement-research.md`: its status line changes from "decides nothing" to "adopted as the rationale of D-27-01", and a section 10 records the owner's answers to the five questions of section 9. No evidence text in it changes.
5. `.planning/phases/27-.../27-DISPOSITIONS.md`: the register of every ANDAX-01 and ANDAX-02 disposition (Part A, Part B) and the hand-off for the orchestrator (Part C).

### D-27-07. Status vocabulary for dispositions

Only these labels: **Dropped (owner decision D-27-01)** for ANDA-01 to ANDA-04 (neither satisfied nor carried; research 7.1 asks that they not stay "Partial"); **Closed: superseded by removal** for the three open questions; **Closed: moot, not resolved** for OQ-P3-11 (no legal determination is made); **Complete**, **Accepted limitation** and **Open (reason)** for the carry list. A label is never stronger than its evidence: a disposition that rests on a record and not on a run says so.

### D-27-08. Carry-list dispositions (ANDAX-02), each with its evidence and lift condition

| Item | Disposition | Basis | Lift or next step |
| --- | --- | --- | --- |
| FS-02 | **Accepted limitation** (requirement text unmet; unchecked) | E-27-13, E-27-14: owner-confirmed approximation of 2026-10-23, unchanged by v3.0; resolve-then-verify with `O_NOFOLLOW` and a `/proc/self/fd` check, not descriptor-relative opens; QR-07 property tests add confidence only | Needs a way to open relative to a pinned descriptor (a Node API for `openat` or `RESOLVE_BENEATH`, or a native helper): [INFERENCE] Node 22 and 24 offer none, the header comment states it only for 22. The owner may reword the requirement instead (OQ-27-03). |
| OMP-05 | **Complete** (the checkbox is stale) | E-27-15, E-27-16: Complete 2026-10-30 by HARN-04 (owner decision D2); basis scripted provider through Omp's own `write`, not LLM-driven; Phase 12 re-verification re-grounds it on Omp 18.20.0; paths that do not load the plugin are outside the claim | None. Tick the carried-list box and align the three stale `omp.md` sentences (E-27-17). |
| UI-01 | **Accepted limitation** | E-27-18: owner decision 2026-10-23, measurement 2026-10-28, no later change; "bounds the stall, does not prove non-blocking" | A repeat measurement is not planned; the status stays the owner's call. |
| PRD-DRV-01 | **Open (reason: the owner has not confirmed the amendment)** | E-27-19, E-27-20: code and tests match the amended wording; the open item is a product amendment, not a code change; the amendment is the owner's | Owner confirmation (OQ-27-01). On a yes, the orchestrator marks it Complete with E-27-19 as evidence. |

### D-27-09. Scope split with Phase 28 (no file edited by both for the same line)

Phase 27 edits `runtime-decision.md` only at its status line, the S-08 Anda bullet, the three OQ rows and the new tail section; Phase 28 owns every other Anda mention in it (the service line, the `anda.listener_failed` record, rows that remain). Phase 27 edits `omp.md` only for the OMP-05 sentences (E-27-17) and not for the sentence "The Anda engine is not in scope" in line 243, which Phase 28 removes. Phase 27 edits `AGENTS.md` only at the settled bullet. Phase 28 runs after Phase 27 merges, so there is no concurrent edit.

### Threat model: false closure, settled-decision bypass, doc drift (summary; each plan carries its STRIDE rows)

There is no workload, no runtime path and no new input in this phase; the assets are the integrity of the project record and of the published docs.

| Asset | Attack or failure | Hold |
| --- | --- | --- |
| Requirement status | A requirement is closed on a stale or contradictory record (OMP-05 in `omp.md`), or FS-02 is upgraded because property tests exist | Every disposition cites a file, a test or a verification row with a date and tier; FS-02 stays Accepted limitation; the verify step checks that each cited path exists |
| Settled decisions in `AGENTS.md` | The bullet is edited without the recorded decision | Task order: the `runtime-decision.md` section lands first in the same plan; the AGENTS bullet cites it by section name and D-27-01 |
| Reader acts on superseded guidance (the one-PR window, F4) | Someone treats `anda-decision.md` sections 1 to 8 or the AGENTS Project paragraph as current and builds on `andaUrl` | Banner at the top of the file, "scheduled in Phase 28" wording, disposition table naming each superseded item |
| Over-claiming the OQ-P3-11 licence | "Closed" read as "resolved" | Label "Closed: moot, not resolved"; text says no legal determination is made and names the reopening trigger |
| Hidden operator using `andaUrl` | A user outside the audit has an engine configured | Not knowable from the repository (OQ-27-05); mitigation is Phase 28's refusal message and breaking-change note; recorded as accepted residual R-27-01 |
| Spec drift | The product spec still says `degraded` and the Anda bridge | Recorded divergence: the supersession table lists the spec lines; no edit without the owner's instruction (OQ-27-02); accepted residual R-27-02 |
| Published docs | A host-local path or an unescaped angle token enters a doc | `npm run check:docs` (host-paths, agents-sync, default-mode) by the parent; this phase's text uses placeholders and no angle brackets |
| Planning records | A worker edits REQUIREMENTS, ROADMAP, STATE or PROJECT by hand | Plans list them under Non-goals; the hand-off is a list for the orchestrator's GSD commands |

### Verification posture

Docs only. Offline acceptance is `npm run check:docs` (host-paths, agents-sync, default-mode), `node --test scripts/check/host-paths.test.mjs scripts/check/agents-sync.test.mjs scripts/check/default-mode.test.mjs` (existing script tests, unchanged), a path-existence check over every path the new records cite, and a diff-scope check that no file under `src` or `test` changed. `npm run check:gates` is expected unchanged (no source change) and is run once by the parent for the record. Workers run none of these mid-flight. No live run is possible or needed.
</decisions>

<canonical_refs>
## Canonical References

- `.planning/ROADMAP.md` Phases 27 to 31 and the v4.0 milestone line; `.planning/REQUIREMENTS.md` section "v4.0 Anda removal, MCP hardening and production boot proof", "Carried from v2.0", the traceability rows for ANDAX-01..05, FS-02, ANDA-01..04, OMP-05, PRD-DRV-01, UI-01; `.planning/PROJECT.md` lines 37 and 77; `.planning/MILESTONE-CONTEXT.md` (v3.0 owner decisions, out-of-scope list).
- `docs/integration/anda-replacement-research.md` (sections 1, 2, 7 and 9 are the rationale and the five questions), `docs/integration/anda-decision.md`, `docs/integration/anda.md`, `docs/integration/runtime-decision.md` (lines 3, 20 to 41, 71 to 93, 198, 470), `docs/integration/omp.md` (lines 200 to 260, 405 to 420), `docs/integration/hardening-plan.md` (lines 72 and 136), `docs/specs/realm-spec.xml` (lines named in E-27-09).
- `.planning/milestones/v1.0-phases/03-container-runtime-and-bridges/{03-CONTEXT,03-VERIFICATION}.md`; `.planning/milestones/v1.0-phases/05-omp-plugin-mcp-and-acp-surfaces/05-CONTEXT.md`; `.planning/milestones/v1.0-MILESTONE-AUDIT.md`, `v2.0-MILESTONE-AUDIT.md`, `v3.0-MILESTONE-AUDIT.md`; `.planning/milestones/v2.0-phases/09.6-integration-live-proof/09.6-VERIFICATION.md`; `.planning/milestones/v3.0-phases/12-scripted-provider-harness-and-omp-enforcement-spike/12-VERIFICATION.md`; `.planning/milestones/v3.0-phases/{16-omp-runs-in-the-sandbox/16-CONTEXT,18-per-project-sandboxes/18-VERIFICATION}.md`; `.planning/phases/RECOVERY-2026-10-31.md`; `.planning/baseline/final-report.md`; `.planning/STATE.md` line 673.
- `AGENTS.md` (Conventions: settled runtime decisions; Documentation and site; Progressive updates; Planning artifacts), `CLAUDE.md`, `scripts/check/{host-paths,agents-sync,default-mode}.mjs`.
- Style models: `.planning/milestones/v3.0-phases/25-host-adapters-wave-2-remaining-gsd-core-runtimes/25-CONTEXT.md` and its plans.
</canonical_refs>

<code_context>
## Existing Code Insights

No file under `src` or `test` is edited by this phase. The inventory below is the word-bounded, case-sensitive search of 2026-11-17 (the pattern avoids "standard"); it is the starting list for Phase 28, which must re-run it. Counts are match counts, not line counts.

**Anda source (`src`):** `src/anda/client.ts` (25), `src/anda/shape.ts` (4), `src/core/errors.ts` (6; the two codes), `src/core/ports.ts` (1; `BridgePort`), `src/core/policy.ts` (1), `src/core/backoff.ts` (2) and `src/core/timeout.ts` (1) (comments only; the helpers stay, AgentOS uses them), `src/daemon/seams.ts` (8), `src/daemon/daemon.ts` (1), `src/doctor/checks.ts` (39), `src/lifecycle/controller.ts` (14), `src/lifecycle/mutation-gate.ts` (1), `src/realm/compose.ts` (5), `src/runtime/config.ts` (12), `src/runtime/driver/grpc-status.ts` (2).

**Anda tests (`test`):** `test/anda/{handshake (28), listener-diagnostic (12), no-shim (4), reconnect (64)}.test.ts`, `test/support/fake-anda.ts` (5), `test/lifecycle/{bridge-retry (9), bridge-states (38), controller-health (4), create-interrupt (2), mutation-gate (1)}.test.ts`, `test/core/{backoff (21), errors (4)}.test.ts`, `test/daemon/{daemon-health (9), daemon (13), e2e (5)}.test.ts`, `test/doctor/{checks (2), control-channel (1), runtime-checks (46)}.test.ts`, `test/omp/plugin.test.ts` (19), `test/quality/suite-taxonomy.test.ts` (6), `test/runtime/config.test.ts` (18).

**Anda docs and checks:** `AGENTS.md` (4), `README.md` (1), `docs/policy-reference.md` (6), `docs/integration/{anda-decision (27), anda (33), runtime-decision (8), hardening-plan (3), openshell (3), host-binaries (1), omp (1)}.md`, `docs/specs/realm-spec.xml` (60), `scripts/check/export-usage-allowlist.json` (3 entries: two for `src/anda/client.ts`, one `AndaReply`), `scripts/check/module-size-allowlist.json` (lists `src/lifecycle/controller.ts` at 1218; the file is 1208 lines now).

**`degraded` readers:** `src` (11 files): `cli/main.ts`, `cli/stdio-host.ts`, `core/policy.ts`, `core/states.ts`, `core/status.ts`, `daemon/client.ts`, `daemon/sessions.ts`, `lifecycle/controller.ts`, `lifecycle/session-state.ts`, `omp/plugin.ts`, `tools/dispatch.ts`. `test` (28 files, for example `core/{state-machine,states,status}`, `daemon/{client,daemon-health,daemon}`, `lifecycle/{bridge-states,controller-health,mutation-gate,adopt-hydrate}`, `omp/{plugin,extension}`, `tools/{dispatch,queue-timeout,workspace}`, `acp/agent`, `cli/{cli,checkpoint-stopped,mcp-attach}`, `host/boot-driver`, `surfaces/equivalence`, `support/{fake-tools,stdio-world}`). Docs (8 files with matches outside the research note): `README.md` (6), `docs/policy-reference.md` (4), `docs/checkpoint.md`, `docs/integration/{acp,host-plugin-contract,omp,runtime-decision}.md`, `docs/specs/realm-spec.xml` (6); plus `scripts/check/mcp-smoke.test.mjs` (1).

**Doc gates that bind this phase:** `scripts/check/host-paths.mjs` scans `README.md`, `CHANGELOG.md`, `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md`, `SECURITY.md`, `docs`, `.planning`, `.github` for host-local path prefixes; `scripts/check/agents-sync.mjs` needs the Commands, Versioning and release, and Merge and release flow headings exactly once in `AGENTS.md`, and `@AGENTS.md` in `CLAUDE.md`; `scripts/check/default-mode.mjs` checks the documented default mode. No test reads `anda-decision.md` or `runtime-decision.md` (searched `test` for both names: no match), so a banner or a new section cannot break a test.
</code_context>

<specifics>
## Wave Structure

| Wave | Plan | Requirements | Depends on |
| --- | --- | --- | --- |
| 1 | 27-01 Register the owner decision and close the Anda items | ANDAX-01 | none (Phase 26 is merged) |
| 2 | 27-02 Reconcile the v2.0 carry list and hand off | ANDAX-02 | 27-01 |

27-01 owns `docs/integration/runtime-decision.md`, `docs/integration/anda-decision.md`, `docs/integration/anda-replacement-research.md`, `AGENTS.md`, and creates `.planning/phases/27-anda-disposition-and-v4-0-requirement-closure/27-DISPOSITIONS.md` (Part A). 27-02 owns `docs/integration/omp.md` (OMP-05 sentences only) and appends Parts B and C to `27-DISPOSITIONS.md`. The plans are sequential because 27-02 cites the section and decision ids that 27-01 creates and extends the file it creates.

## Requirement IDs

| ID | Statement |
| --- | --- |
| ANDAX-01 | Every Anda requirement and open question (ANDA-01..04, OQ-P3-09..11, the Phase 3 re-verification's four open items, the PRD-DRV-01 carry notes) is dispositioned by the recorded owner decision of 2026-11-17 (D-27-01 to D-27-05), in `docs/integration/runtime-decision.md`, with `anda-decision.md` carrying a superseded banner, the research note adopted as the rationale and its five questions answered, `AGENTS.md` settled bullet rewritten, and every disposition listed with its evidence in `27-DISPOSITIONS.md` Part A. |
| ANDAX-02 | FS-02, OMP-05, PRD-DRV-01 and UI-01 each have an evidence-cited disposition (D-27-08) in `27-DISPOSITIONS.md` Part B, the stale OMP-05 sentences in `omp.md` carry dated supersession notes, and Part C lists the exact REQUIREMENTS, PROJECT, ROADMAP and STATE edits for the orchestrator. |

## Open Questions (owner decisions or unverified; none blocks planning)

- **OQ-27-01.** Does the owner confirm the PRD-DRV-01 amendment (`AuthenticateSandbox` not advertised and UNIMPLEMENTED, `DeleteWorkspace` refuses)? Default: Open until confirmed; code and tests already match (E-27-19). On a yes the orchestrator records Complete.
- **OQ-27-02.** Does the owner direct an edit of `docs/specs/realm-spec.xml` (the Anda layering, `ANDA_ENGINE_BRIDGE`, the `degraded` state, the failure rule, E-27-09)? Default: no edit; the divergence is recorded in the supersession table (R-27-02). The spec already carries an owner-directed amendment (D4), so an edit is allowed on instruction; the pull request must then record the instruction and the reason.
- **OQ-27-03.** Should FS-02's text be reworded to the accepted approximation instead of carried as an unmet requirement? Default: carried unchanged as Accepted limitation; the owner may reword.
- **OQ-27-04.** Do the owner's five answers match D-27-01 to D-27-05 exactly? The task statement gives drop, MCP stdio stays, include the spike, local single-user, release line 0.4.x, and "remove the degraded state"; the mapping of those to the research questions (1 no capability, 2 remove, 3 no, 4 yes as a spike, 5 breaking signal) is the planner's reading and is recorded as such in the research note's section 10.
- **OQ-27-05.** [INFERENCE] No operator outside the audited hosts has `andaUrl` set. The repository cannot show it. Mitigation is Phase 28's refusal and release note (R-27-01).
- **OQ-27-06.** Phases 27 and 28 as two pull requests (research 7.5) leave the F4 window. Default: separate pull requests with the transitional wording; the owner may ask to ship them together.
</specifics>

<deferred>
## Deferred Ideas

- Re-adding a scoped client for a named Anda capability (memory, a TEE-backed tool), under a new decision, if one is ever named (D-27-01 revisit trigger).
- Resolving the Anda licence conflict (needed only if Anda code is ever vendored).
- Closing FS-02 with a native helper or a future Node API (D-27-08).
- An owner-directed edit of the product spec (OQ-27-02).
- Remote or multi-user Realm, MCP Streamable HTTP, OAuth, A2A (D-27-04).
- Everything in Phases 28 to 31.
</deferred>

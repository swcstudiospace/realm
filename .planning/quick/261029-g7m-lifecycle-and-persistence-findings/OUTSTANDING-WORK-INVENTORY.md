# Outstanding work inventory

Repository state: main at 00e0003, release v0.2.2 (`package.json:3` version 0.2.2; tag v0.2.2 on HEAD; subject `chore(release): v0.2.2 [skip ci]`).

Evidence labels: VERIFIED_BY_CODE_READING (file read or grep of the tree), VERIFIED_BY_EXECUTION (a command run for this inventory, with its output observed), UNVERIFIED (with what would verify it). Paths are repo-relative. "The audit" is `.planning/milestones/v2.0-MILESTONE-AUDIT.md`. Dispositions use only: covered by phase N, quick in-scope fix, stale, deferred, needs user decision. No phase is created and nothing is deleted by this document.

## 1. Position

| Question | Answer | Evidence |
|---|---|---|
| ROADMAP phases complete / total | 18 / 18. The Progress table has 18 phase rows; 18 phase lines are `- [x]`; 0 phase lines are `- [ ]`. Phase 9.2 is counted complete but its status is "Superseded" (owner decision 2026-10-28). | `.planning/ROADMAP.md:352-369`, `:166`, `:362`; counted with `grep -nE '^\| [0-9]' ROADMAP.md` (18) and `grep -nE '^- \[x\] \*\*Phase'` (18), `grep -nE '^- \[ \] \*\*Phase'` (0). VERIFIED_BY_EXECUTION |
| Milestone status | v2.0 shipped as releases 0.2.0 and 0.2.1 on 2026-10-29 and archived; v1.0 (provisional name) archived 2026-10-22. No active milestone. | `.planning/ROADMAP.md:11-12`; `.planning/MILESTONES.md:3`, and the v1.0 heading in the same file. VERIFIED_BY_CODE_READING |
| STATE status | `status: Awaiting next milestone`; `stopped_at: Milestone v2.0 completed and archived (2026-10-29); the next step is /gsd-new-milestone`. | `.planning/STATE.md:5-6`. VERIFIED_BY_CODE_READING |
| Operator next step | "Start the next milestone with /gsd-new-milestone." | `.planning/STATE.md:173-176`; `.planning/PROJECT.md:19-21`. VERIFIED_BY_CODE_READING |
| state.json next | `command: /gsd-new-milestone`, `reason: Milestone v2.0 is complete and archived`. 18 phase entries, all `"status": "complete"`. | `.planning/state.json:97-101`; `grep -c '"number"'` = 18 and `grep -c '"status": "complete"'` = 18. VERIFIED_BY_EXECUTION |
| STATE.md "Next" line | Before this task the last run section of STATE.md still said "the milestone-close pull request (this change) ... and a release (0.2.2) for it". That step finished (tag v0.2.2 on HEAD), so quick task 261029-g7m rewrote the line as the outcome. | `.planning/STATE.md:633`; tag check above. VERIFIED_BY_EXECUTION |

What the gsd-autonomous workflow does in this state: the workflow file `autonomous.md` (GSD core `workflows/`) has a discovery branch "If no incomplete phases remain" that prints "All phases complete! Nothing left to do." and exits cleanly (`autonomous.md:201-209`). The audit, complete and cleanup lifecycle (`autonomous.md:628-653`) is described as running after phases complete within a run; the no-incomplete-phases branch exits before it. The workflow does not create a milestone: its missing-file errors point at `/gsd:new-milestone` (`autonomous.md:126-127`). The text was read; the workflow was not run (VERIFIED_BY_CODE_READING for the text; behaviour UNVERIFIED until run, and UNVERIFIED that this is the copy the orchestrator executes).

Process notes recorded for the owner, not work items: no signed gate records exist for the v2.0 run (`audit:281`); the ship flow's GSD gate was waived with `--ignore-gsd` for pull requests 6 and 7 (`.planning/STATE.md:632`).

## 2. Marker sweep

### 2.1 Commands and counts (all run from the repo root at 00e0003; VERIFIED_BY_EXECUTION)

| # | Command | Hits | Result |
|---|---|---|---|
| S1 | `git grep -nIw -e TODO -e FIXME -e HACK -e XXX -- src test scripts docs adapters .github release README.md AGENTS.md CONTRIBUTING.md SECURITY.md package.json eslint.config.js tsconfig.json` | 0 | exit status 1 (no match) |
| S2 | `git grep -nIE 'NotImplemented\|unimplemented!\|todo!\|not implemented'` (no pathspec, so `.planning` is included) | 9 | 5 outside `.planning`, 4 inside it; all 9 are classified in rows M1 to M5 below |
| S3 | `git grep -nIE '[.](skip\|only\|todo)[(]\|(^\|[^A-Za-z0-9_])(xit\|xdescribe\|fit\|fdescribe)[(]\|continue-on-error\|if: *false' -- test scripts .github` | 1 | `test/integration/production-driver.test.ts:384`; classified as a false positive in 2.3 (conditional environment gate). Zero `.only`, `.todo`, `xit`, `xdescribe`, `fit`, `fdescribe`, `continue-on-error` and `if: false` hits |
| S4 | `git grep -nIE '^[[:space:]]*[-*] \[ \]' -- '*.md' ':(exclude).planning'` | 14 | all 14 in `.github/PULL_REQUEST_TEMPLATE.md` (lines 11-20 and 28-31); false positives, see 2.3 |
| S5 (added) | `git grep -nIE '\{ skip: ' -- test` | 12 | option-style conditional skips, which S3 does not match; false positives, see 2.3 |
| S6 (added) | `git grep -nIiE 'recorded follow-up\|follow-up' -- src test scripts docs adapters .github release README.md AGENTS.md CONTRIBUTING.md SECURITY.md` | 5 | 2 real (row M8), 3 false positives, see 2.3 |
| S7 (added) | `grep -nE '^[[:space:]]*- \[ \]'` on the three live planning files | PROJECT.md 11, ROADMAP.md 17, REQUIREMENTS.md 8 | rows M9, M10 and M11 |

Reconciliation: S2's 9 hits are M1 (2: `compute-driver.ts:31`, `09.4-01-SUMMARY.md:178`), M2 (1), M3 (2: `openshell.md:441`, `09.6-VERIFICATION.md:57`), M4 (1), M5 (3: `runtime-decision.md:68`, `03-07-PLAN.md:78`, `03-CONTEXT.md:130`). 2+1+2+1+3 = 9.

### 2.2 Real markers

Kind values: stub (documented not-implemented), doc-task (open item recorded in prose), unchecked box, stale record.

| ID | Kind | Path:line | Text | Disposition | Tracking ref |
|---|---|---|---|---|---|
| M1 | stub | `src/runtime/driver/compute-driver.ts:31`; same fact in `.planning/milestones/v2.0-phases/09.4-compute-driver/09.4-01-SUMMARY.md:178` | "AuthenticateSandbox is not implemented: the driver does not advertise sandbox authentication." | needs user decision | PRD-DRV-01 (`.planning/REQUIREMENTS.md:132`, `:249`); owner decision 4 (`audit:248`); audit disposition row (`audit:62`) |
| M2 | doc-task | `docs/integration/anda-decision.md:69` | "The ICP envelope and the bearer CWT are not implemented ... Calls through `POST /{id}` need the RPC body layout and credential format first. That work belongs to the first phase that calls `POST /{id}`, which is Phase 4 or 5." | deferred | ANDA-01 to ANDA-04 (`.planning/REQUIREMENTS.md:49-52`); OQ-P3-10/11 (`audit:59`). The sentence naming "Phase 4 or 5" is out of date: both phases are complete and `git grep -nE "POST\|/\{id\}" -- src/anda` finds nothing (VERIFIED_BY_EXECUTION) |
| M3 | doc-task | `docs/integration/openshell.md:441`; same fact in `.planning/milestones/v2.0-phases/09.6-integration-live-proof/09.6-VERIFICATION.md:57` | "Refusing create when `ptrace_scope` is 0, the review's fix for F1, is not implemented. Phase 9.7 adds the `kernel-hardening` doctor warning instead." | needs user decision | owner decision 5, "the F1 residual" (`audit:249`). The doctor warning exists: `src/doctor/checks.ts:672`, `:693` |
| M4 | doc-task | `docs/integration/openshell.md:460` | F3 workspace planting: "Open by design; awaits owner acceptance ... The read-only mounts for `.git/hooks` and `.git/config` and the post-session diff the review suggested are not implemented." | needs user decision | owner decision 5, "A10 F2 and F3 acceptance" (`audit:249`) |
| M5 | stub | `docs/integration/runtime-decision.md:68`; archived copies `.planning/milestones/v1.0-phases/03-container-runtime-and-bridges/03-07-PLAN.md:78` and `03-CONTEXT.md:130` | "Hosted mode ... is secondary and gated ... not implemented in Phase 3 (D-60)." (the archived copies read "Hosted mode is not implemented (S-11)") | deferred | D-60 and S-11 in the v1.0 phase 3 context; no carried requirement or TD item names it (audit TD list read in full, `audit:262-273`). The archived v1.0 copies are historical and need no action |
| M6 | doc-task | `docs/integration/runtime-decision.md:175` | "The grace-period detach is deferred. It is recorded as a deviation from the spec." | deferred | none found: not in the audit disposition table (`audit:56-62`) nor in TD-01..TD-10 (`audit:264-273`). Owner decision 13 (`audit:257`) concerns the RT-04 restart wording, not this deviation (UNVERIFIED that they are unrelated; reading `docs/specs/realm-spec.xml` would settle it) |
| M7 | stale record | `docs/integration/omp.md:76`, `:88`, `:98`, `:102` | Q4 header "OPEN. Deferred to Phase 5 (OMP-05). Not answered by this note"; "Open for Phase 5"; "No file under `plugin/` is created"; "`plugin/` (Phase 5). Phase 5 must answer Q4 before any plugin code..." | stale | Phase 5 is complete (`.planning/ROADMAP.md:356`). The guard exists (`src/omp/plugin.ts:123`, `:344`) and the Q4 residue is carried as OMP-05 / OQ-P5-02 (`docs/integration/omp.md:90-94`, `:209`). Whether a doc test pins this text: UNVERIFIED (grep `test/` for the quoted strings would verify) |
| M8 | doc-task | `AGENTS.md:105`; `.github/workflows/ci.yml:401` | "The release carries no provenance attestation or signature yet ... that split is a recorded follow-up." / "A job split would remove the shared user altogether; it is a recorded follow-up." | deferred | TD-10 (`audit:273`); owner decision 6 (`audit:250`) |
| M9 | unchecked box | `.planning/PROJECT.md:61-71` (11 boxes) | the "Active" v1 summary checklist, all unchecked; line 68 itself says "Superseded 2026-10-29" | stale | the same scope is in "Validated" and in the archived v1.0 and v2.0 milestones (`.planning/PROJECT.md:29-55`; `.planning/MILESTONES.md`) |
| M10 | unchecked box | `.planning/ROADMAP.md:76-85` (Phase 3 plans 03-01..03-10) and `:102-114` (Phase 4 plans 04-01..04-07); 17 boxes | plan checkboxes inside the archived v1.0 detail block, unchecked | stale | the Progress table says 10/10 and 7/7 complete (`.planning/ROADMAP.md:354-355`) |
| M11 | unchecked box | `.planning/REQUIREMENTS.md:31` (FS-02), `:49-52` (ANDA-01..04), `:74` (OMP-05), `:122` (UI-01), `:132` (PRD-DRV-01); 8 boxes | the eight carried requirements | deferred (carried to the next milestone; per-row dispositions in section 3) | `.planning/PROJECT.md:21-25`; `audit:48` |
| M12 | stale record | `.planning/STATE.md:12-13` (frontmatter); the stale "Current focus" line at `:28` was corrected by quick task 261029-g7m | frontmatter `total_phases: 11` with `completed_phases: 16` (counts the tool derives across milestones); the old focus text said "Milestone v2.0 ... in progress on feat/realm-v2-0 ... Remaining items are approvals and live verification." | stale (focus line fixed; frontmatter counts left to the tool) | the frontmatter contradicts `.planning/STATE.md:5-6` and `.planning/state.json:97-101`; state.json lists 18 phases |

### 2.3 False positives (with reasons)

| Hit | Count | Reason |
|---|---|---|
| `.github/PULL_REQUEST_TEMPLATE.md:11-20`, `:28-31` | 14 (S4) | Contributor checklist of a pull request template. Checkboxes are meant to be unchecked. |
| `test/integration/production-driver.test.ts:384` `t.skip(...)` | 1 (S3) | Runtime skip with a stated reason when the host has no outbound connectivity (`:381-386`). It is an environment gate in the same style as `test/integration/podman-gate.test.ts:33-34` ("the skip is the gate, not a suppression"). It is not a disabled test. Live scenario 3 ran in the recorded 31-of-31 suite (`.planning/ROADMAP.md:367`; UNVERIFIED for this host today). |
| `{ skip: gate }`, `{ skip: syscallSkip }`, `{ skip: process.getuid?.() !== 0 }` | 12 (S5): `podman-gate.test.ts:35`; `production-driver.test.ts:241`, `:294`, `:359`, `:381`, `:454`, `:485`, `:644`, `:690`, `:733`, `:782`; `seccomp-delivery.test.ts:142` | Conditional gates on Podman 5.x, the production stack, a syscall list or root. The ROADMAP's "10 skipped" (`.planning/ROADMAP.md:367`) comes from these; the count was not re-run (no test execution is allowed in this task). |
| `docs/integration/runtime-decision.md:183` heading "Closure follow-ups (2026-10-22)" | 1 (S6) | Records closed items (startup output, reply cap, ensure timeout, request limits, directory modes), not open ones (`docs/integration/runtime-decision.md:185-193`). |
| `docs/integration/omp.md:185` | 1 (S6) | Historical owner decisions "superseded 2026-10-25". |
| `test/runtime/libpod-create.test.ts:403` | 1 (S6) | Test name: "sends no follow-up request". |
| `deferred<T>()` in `test/cli/mcp-attach.test.ts` | not matched by S1 to S4 | Promise helper; it matches none of the sweeps run here. |

## 3. Carried requirements and tech debt

"Reachable by engineering alone" means: finishable by code, tests and docs in this repository without owner input, credentials, a live model, an external service or a licence ruling. Status cells carry the one disposition.

| Item | Status | Blocker | Reachable by engineering alone | Evidence |
|---|---|---|---|---|
| FS-02 race-resistant paths | open, accepted approximation (owner, 2026-10-23). Disposition: needs user decision | Node has no `openat2` with `RESOLVE_BENEATH` (audit claim, UNVERIFIED by this inventory); closing it needs a native component or another design | no: the status is the owner's accepted approximation and any fix is a design change | `.planning/REQUIREMENTS.md:31`, `:199`; `audit:58` |
| ANDA-01..04 live Anda bridge | partial, live-gated. Disposition: deferred | no Anda engine on any host; licence conflict OQ-P3-11 blocks vendoring Anda code | no: needs a service, and a licence ruling | `.planning/REQUIREMENTS.md:49-52`, `:212-215`; `audit:59`; `docs/integration/anda-decision.md:69` |
| OMP-05 live write/edit guard | partial, unit-verified; now also observed live with a scripted provider (2026-10-29). Disposition: needs user decision (the requirement's status) | a model-driven (LLM) call was not made: the realm account's provider was out of quota on 2026-10-28 and a key is the owner's. A scripted local OpenAI-compatible provider needs no key | yes for evidence, done: a scripted provider drove Omp's own `write` tool in a real Omp 18.12.6 host; the guard was observed in advisory mode (notice, write allowed) and in fail-closed mode (write blocked with `REALM_NOT_ACTIVE`, no file) (`LIVE-VERIFICATION.md` L3, L4; VERIFIED_BY_EXECUTION). It proves only the `write` and `edit` guard: the guard covers only those two tools (`src/omp/plugin.ts:123`) and bash is outside it (`docs/integration/omp.md:209`). Whether this satisfies OMP-05 is the owner's decision | `.planning/REQUIREMENTS.md:74`, `:227`; `audit:60`; `docs/integration/omp.md:202-209` |
| PRD-DRV-01 driver amendment | open. Disposition: needs user decision | a product amendment (AuthenticateSandbox not advertised, DeleteWorkspace refuses) awaits the owner's confirmation | no | `.planning/REQUIREMENTS.md:132`, `:249`; `src/runtime/driver/compute-driver.ts:31`; `audit:62`, `:248` |
| UI-01 status item non-blocking | accepted limitation (owner, 2026-10-23). Disposition: needs user decision | non-blocking is not proven (24 s cold attach, keystrokes echoed within 0.2 to 1.2 s); the requirement's status is the owner's | no | `.planning/REQUIREMENTS.md:122`, `:242`; `audit:61` |
| TD-01 refusal cause code dropped over the daemon | open. Disposition: deferred | none stated. Caveat UNVERIFIED: if the fix changes the tool outcome schema or the control-channel reply shape, both are frozen contracts (`AGENTS.md:65`) and an owner decision would apply | yes, with that caveat. The dispatcher builds a refusal from the code alone (`src/tools/dispatch.ts:127`, `:257-259`); MCP maps a refusal to `isError` (`src/mcp/protocol.ts:92-110`); the daemon-path equivalence is proven live only (audit claim) | `audit:264` |
| TD-02 gateway renderer has no caller; gateway config, Podman unit and driver launcher live outside the repo | open. Disposition: deferred | the host artefacts are outside the repo | partly: `renderRealmGatewayConfig` and `realmGatewayPkiPaths` have no caller in `src` (definitions `src/runtime/gateway-config.ts:105`, `:124`; other hits are tests and docs); no `.service`, quadlet or launcher file is tracked (`git ls-files` filter, VERIFIED_BY_EXECUTION). Engineering can wire or document what it has; the host copies on the realm account are not in the repo (their readability is UNVERIFIED) | `audit:265`, `:234` |
| TD-03 doctor lacks driver-environment checks | open. Disposition: deferred | none | yes. The only `REALM_DRIVER_*` names in `src/doctor` are the supervisor binary and digest variables (`src/doctor/checks.ts:677`, `:679`); the three required variables are read in `src/runtime/session-execution.ts:95-99`, `src/daemon/main.ts:50-56` (orchestrator fact F4). A failing create reads `SCHEMA_INVALID` | `audit:266` |
| TD-04 retry from error reuses a gone container id | open. Disposition: deferred | none | yes. "A stored containerId means no second create" (`src/lifecycle/controller.ts:156`). The retry tests in `test/lifecycle` cover the bridge handshake (`test/lifecycle/bridge-retry.test.ts:120-156`); "no test covers a gone container" is the audit's claim and was not exhaustively searched (UNVERIFIED) | `audit:267` |
| TD-05 gateway or driver loss has no code of its own | open. Disposition: needs user decision | a new error-catalogue code. The catalogue is a frozen shared contract: `src/core/errors.ts` is listed under "frozen shared contracts" (`AGENTS.md:65`) and Conventions fix `ERROR_CODES` as the only source of codes (`AGENTS.md:81`). Codes are enumerated by tests and mapped per code (`test/core/errors.test.ts:36`, `:73`; `src/runtime/driver/grpc-status.ts:21`) | no: owner decision first. Today any failed probe, including an OpenShell failure, throws `AGENTOS_CRASH_LOOP` (`src/runtime/agentos.ts:14-18`; `src/doctor/checks.ts:649`) | `audit:268` |
| TD-06 `check:mcp` has no sandbox-free smoke mode | open. Disposition: deferred | none | yes. Without Podman 5.x the script takes the fail-closed branch and checks only that refusal (`scripts/check/mcp-smoke.mjs:191-193`); `check:mcp` is `package.json:60` and runs at `.github/workflows/ci.yml:101` | `audit:269` |
| TD-07 pack-smoke omits host snippets and prime-agent MCP.md/SKILL.md; release job does not rerun `check:pack` | open. Disposition: deferred | none | yes. `ADAPTER_MANIFESTS` lists six manifest paths only (`scripts/check/pack-smoke.mjs:22-29`); `git grep -nE 'SKILL.md\|MCP.md\|snippets' -- scripts/check/pack-smoke.mjs` finds 0 hits; `check:pack` runs only at `.github/workflows/ci.yml:96`, and the release job runs `npm pack` at `:350` without it. The workflow edit needs human review (`AGENTS.md:139`) | `audit:270` |
| TD-08 changelog lists commits of later-removed features | open. Disposition: deferred | none | yes. The generator reads `git log --no-merges` subjects (`scripts/release/changelog.mjs:88`) and filters only the scope set `{'planning'}` (`:25`, `:81`). Release-owned file rules apply (`AGENTS.md:97-106`) | `audit:271` |
| TD-09a about 60 test-only exports and 55 test-only types | open. Disposition: deferred | none | yes. The counts are the audit's and were not re-measured (UNVERIFIED; a script listing exports with no importer outside `test/` would verify). Low value, large diff | `audit:272` |
| TD-09b `EGRESS_DENIED` catalogued and mapped but never thrown | open. Disposition: needs user decision | removing or using it touches the frozen catalogue: `src/core/errors.ts:32`, `:157`; `src/runtime/driver/grpc-status.ts:32`; `test/core/errors.test.ts:36`, `:73`. `git grep -nE EGRESS_DENIED -- src test` finds only these | no: owner decision first (`AGENTS.md:65`, `:81`) | `audit:232`, `:272` |
| TD-10a repository settings (secret scanning, push protection, Dependabot alerts, `sha_pinning_required`, branch protection or rulesets, Actions approving pull requests, `omega-ci` runner group visibility) | open. Disposition: needs user decision | GitHub settings need repository admin rights | no | `audit:273` |
| TD-10b Dependabot configuration for pinned actions | open. Disposition: deferred | none | yes. `.github` tracks only `ISSUE_TEMPLATE`, `PULL_REQUEST_TEMPLATE.md` and two workflows (`git ls-files .github`, VERIFIED_BY_EXECUTION): no `dependabot.yml` | `audit:273` |
| TD-10c release job split into unprivileged build and privileged publish (precondition for provenance) | open. Disposition: deferred | a privileged-workflow change that needs human review (`AGENTS.md:139`) and a real release to exercise | partly: engineering can write it; the human review and a release run (UNVERIFIED how to rehearse without cutting one) are not engineering alone | `audit:273`; `AGENTS.md:105`; `.github/workflows/ci.yml:395-402` |
| TD-10d `license` field in the muse-code and hermes-agent manifests | open. Disposition: needs user decision | the value is a licence ruling for the host manifests. The package and two other manifests say `AGPL-3.0-only` (`package.json:5`; `adapters/claude-plugin/.claude-plugin/plugin.json:5`; `adapters/prime-agent/package.json:5`); `adapters/muse-code/.muse-plugin/plugin.json` and `adapters/hermes-agent/plugin.json` have no `license` (`grep -c license` = 0 each) | no (a likely value exists, but the ruling is the owner's) | `audit:273` |
| TD-10e product-spec amendment | open. Disposition: needs user decision | `docs/specs/realm-spec.xml` is read-only (`audit:257`) | no | `audit:257`, `:273` |
| TD-10f Podman probe classification | open. Disposition: needs user decision | a design choice: a timeout, a non-zero exit and a missing binary map to one code (`audit:258`) | no | `audit:258`, `:273` |

## 4. Owner decisions still open (audit section 6)

The audit lists 14 decisions (`audit:241-258`). Open ones:

| # | Decision | Evidence |
|---|---|---|
| 3 | Anda engine licence conflict (OQ-P3-11); ANDA-01..04 stay carried | `audit:247` |
| 4 | The PRD-DRV-01 amendment | `audit:248` |
| 5 | A10 F2 and F3 acceptance, the F1 residual, whether the supervisor pin becomes mandatory | `audit:249` |
| 6 | A18: trust channel and install sources of the CLI, gateway and Podman; holding the `openshell` package; the Debian 12 policy; signing and provenance (needs the TD-10c job split). NOTICE and the CycloneDX SBOM are done | `audit:250` |
| 7 | The policy file integrity rule (R6) | `audit:251` |
| 9 | OMP-05's live limit; the procedure is written | `audit:253`; `docs/integration/omp.md:202-209` |
| 12 | Removal of the rollback image, the Rust builder cache image and the scratch build contexts | `audit:256` |
| 13 | The product spec still describes AgentOS restart with backoff (RT-04 was amended to ruling N1); the spec is read-only | `audit:257` |
| 14 | The Podman probe maps a timeout, a non-zero exit and a missing binary to one code | `audit:258` |

Closed in the same table: 1 (five human-review files), 2 (`milestone complete v2.0 --confirm`), 8 (adapter-manifest version fields), 10 (Claude configuration backups; no action), 11 (Pages permission narrowing) (`audit:245`, `:246`, `:252`, `:254`, `:255`). Decisions arising from this inventory, not in the audit: TD-05 and TD-09b (frozen error catalogue), TD-10a, TD-10d, and the M6 grace-period deviation if it has no owner.

## 5. Reachable now

Only items that engineering alone can finish (no owner input, credentials, licence ruling, live model or external service). Each is a candidate for the next milestone; no phase is created here.

1. TD-01: carry the tool-refusal cause code across the daemon for MCP and ACP, with a daemon-path equivalence test. Condition: stop and ask the owner if it needs a change to a frozen schema.
2. TD-03: `realm doctor` checks for `REALM_DRIVER_STATE_ROOT`, `REALM_DRIVER_SECRET_ROOT`, `REALM_DRIVER_WORKSPACE_ROOT`, the driver socket and the gateway.
3. TD-04: define and test retry from the error state when the recorded container is gone.
4. TD-06: a sandbox-free smoke mode for `check:mcp`, so CI checks the protocol.
5. TD-07: add the host snippets and prime-agent `MCP.md` and `SKILL.md` to `pack-smoke`, and run `check:pack` on the release job's tarball (the workflow edit needs human review).
6. TD-08: filter commits of later-removed features out of the generated changelog.
7. TD-09a: trim test-only exports (low value; re-measure first).
8. TD-10b: add `.github/dependabot.yml` for the pinned actions.
9. TD-10c: write the release job split (human review required; rehearsal method UNVERIFIED).
10. TD-02, in-repo part only: document or wire the gateway renderer and the artefacts the repo can hold.
11. Record hygiene (docs and planning text, no behaviour): M7 (`docs/integration/omp.md` Q4 and "Phase 5" wording), M2 (the "Phase 4 or 5" sentence), M9 to M10 and M12 (stale checkboxes and STATE metadata). Check `test/` for exact-string doc tests before editing M7 (UNVERIFIED).

Not reachable by engineering alone: FS-02, ANDA-01..04, UI-01, PRD-DRV-01, TD-05, TD-09b, TD-10a, TD-10d, TD-10e, TD-10f, and open owner decisions 3, 4, 5, 6, 7, 12, 13, 14. OMP-05 has live evidence from a scripted provider (2026-10-29); changing its status is the owner's decision.

INVENTORY_COMPLETE: yes

# Operator Copy Table — exact strings per state

**Rule:** stdout carries the catalogue code/result; stderr carries the human reason, never env
values or tokens. Exit 0 success, 1 catalogue-coded failure, 2 usage error. Every status value
below keeps its text label under `NO_COLOR`/pipe. Source refs are to the current `src/cli` tree —
if a string changes there, this table changes in the same commit (it currently matches).
Copy states facts (what happened / what it means / what to do next); no fake urgency.

## Status / lifecycle (NFR-A1)

| Screen.state | stdout | stderr | Exit |
|---|---|---|---|
| SCR-RealmStatus.success | `disconnected` when no daemon; daemon reply otherwise (`label: realm active` / `realm disconnected`) | `realm status: daemon absent (REALM_NOT_ACTIVE); local report` (absent daemon) | 0 |
| SCR-RealmStatus.error.daemon-absent | `disconnected` | `realm status: daemon absent (REALM_NOT_ACTIVE); local report` | 0 |
| SCR-RealmLifecycle.success (down already down) | `disconnected` | `already down (REALM_NOT_ACTIVE)` | 0 |
| SCR-RealmMetrics.error.daemon-absent | `REALM_NOT_ACTIVE` | `realm metrics: daemon absent (REALM_NOT_ACTIVE)` | 1 |
| SCR-RealmDoctor.error.daemon-absent | JSON checks array | `realm doctor: daemon absent (REALM_NOT_ACTIVE); ran N local checks` | 0 |
| SCR-*/error.* (usage) | usage line | code line (e.g. `SCHEMA_INVALID`) | 2 |
| SCR-RealmStatus.loading | `status: probing daemon …` | — | — |
| SCR-RealmMetrics.loading | `metrics: reading…` | — | — |
| SCR-RealmDoctor.loading | `doctor: running N local checks…` | — | — |
| SCR-RealmLifecycle.loading (up) | `up: starting daemon (≤200s budget)…` + elapsed | — | — |
| SCR-RealmAudit.loading | `audit: checking <file>…` | — | — |
| SCR-RealmCheckpoint.loading | `checkpoint: writing…` | — | — |
| SCR-OmpGuard.loading | `omp: starting run…` | — | — |
| SCR-CiGates.loading | `gates: running` | — | — |
| SCR-ReleaseProvenance.loading | `release: building…` | — | — |
| SCR-LinearGsd.loading | `loading issue…` | — | — |

## Audit / checkpoint / metrics content

| Screen.state | Copy |
|---|---|
| SCR-RealmAudit.error.chain-break | `line N does not chain (prev-mismatch)` — names the first broken line; exit 1 |
| SCR-RealmAudit.empty.no-files | `realm audit verify: no audit file to verify`; exit 1, not pass |
| SCR-RealmAudit.success | `verified: K files, head <seq>:<sha256>`; exit 0 |
| SCR-RealmAudit.usage | `realm audit verify: usage: realm audit verify [--file <path> \| --session <id>] [--head <seq>:<sha256>] [--anchor <record.json>]`; exit 2 |
| SCR-RealmCheckpoint.empty.no-checkpoint | `no checkpoint <id>` (not a restore of nothing) |
| SCR-RealmCheckpoint.error.daemon-silent | `REALM_NOT_ACTIVE` before anything is written |
| SCR-RealmMetrics.success | counters table + `0 network listeners` line |
| SCR-RealmMetrics.empty.no-session | `no session for <ws>` |
| SCR-OmpGuard.error.refused | `<CODE>: <reason>` + next action; bash in fail-closed = 1 catalogue code (AC-15) |
| SCR-OmpGuard.empty.tool-list | mode with 0 tools is stated, e.g. `0 Realm tools in <mode>` (not blank) |
| SCR-OmpGuard.success | bytes landed in sandbox `/workspace` + host root; audit admission+result share 1 correlation id |
| SCR-CiGates.error.gate-fail | `<gate>: fail` + `BELOW <metric>` (coverage floor) or named missing file (pack-smoke) |
| SCR-CiGates.empty.no-run | `no gate run for this ref` |
| SCR-CiGates.success | `5 of 5` Greptile + squash merge record |
| SCR-OnboardingDocs.empty.no-results | `0 results` + suggested terms |
| SCR-OnboardingDocs.error.not-found | `page not found` + bounce links (never a dead end) |
| SCR-ReleaseProvenance.error.attestation | `gh attestation verify` failure named |
| SCR-ReleaseProvenance.empty.no-release | `no release for this ref` |
| SCR-LinearGsd.error.duplicate | `existing issue <id>; creation refused` (never a second issue per phase) |
| SCR-LinearGsd.empty.no-match | 0 matches → create once with the standard shape |

## Blocked notice (exact shape, SCR-LinearGsd)

```
BLOCKED — owner decision required: <question>. Decider: <owner>. Unblocks when: <ruling>.
Default until then: <fail-closed behavior>. Status: <counts> unverified.
```

Blocked is rendered with text + border, never green, never counted as pass. Dirty-tree variant
appends: `dirty tree preserved; no overwrite`.

## Anti-patterns (rejected copy)

Do not write: a third status label (e.g. treating `degraded` as a label rather than
`ACTIVE` + notice), colour-only pass/fail, `no audit file` phrased as pass, silent absence of a
notice (`neverSilent: true`), truncated paths that become ambiguous, env values or tokens on
either stream, loss-framed or urgency copy, progress bars without counts.

## cffd9419 boards — exact board copy (AC-86..AC-96)

Text verdicts only, never colour-only. `stdout` gate verdicts first, `stderr` reasons second.
The fixture value never appears here (sentinel `REDACTED` only); Greptile absence is plain text,
never a chip; Linear rows read `open` until gates pass.

| Screen.state | Board row text |
|---|---|
| SCR-SecSplitFixture.default.split-clean | `fixture assembled from 2 concatenated parts at 1 test location (boot-report, line 177); 0 literal fixture strings in repo`; `compiled boot-report run: 0 failures; refusal assertions: 0 echoes`; `secret scanner: 0 secrets; 0 literal fixture occurrences` |
| SCR-SecSplitFixture.loading.verifying | `split: verifying fixture and scanner…` |
| SCR-SecSplitFixture.error.literal-found | `scanner: 1 secret at <path>:<line>; remedy: split into 2 concatenated parts` (value `REDACTED`, never rendered) |
| SCR-SecSplitFixture.empty.no-run | `no scanner run for this ref`; exit 1, not pass |
| SCR-SecSplitFixture.success | `split clean — 0 literal strings, 0 failures, 0 echoes, 0 secrets` |
| SCR-Merge256Gate.default.gates-green | `check:docs pass · test:scripts pass · build pass · lint pass · compiled boot-report pass`; `Verify Node 22.x pass · Verify Node 24.x pass · docs site pass · breaking-change pass · audit pass` |
| SCR-Merge256Gate.loading.running | `merge gate: running local + CI checks…` |
| SCR-Merge256Gate.error.gate-fail | `<gate>: fail` + 1 remedy; other rows keep last verdicts, never erased |
| SCR-Merge256Gate.error.greptile-offline | `Greptile: offline — absence recorded as the user-accepted substitute; gate is local + CI green. 0 claims of 5 of 5 reviews are made.` |
| SCR-Merge256Gate.empty.no-run | `no local or CI run for this commit`; exit 1, not pass |
| SCR-Merge256Gate.success.merged | `PR #256 merged 1 time with squash through the ship flow; main holds 1 merge commit from the 354f00a line (5 docs files); PR body carries 1 Greptile absence note; 0 claims of 5 of 5`; `check:docs on merged main: pass exit 0` |
| SCR-R3W3Closeout.default.gates-running | `qa.r3 … · rev.r3 … · sec.r3 … · build … · rel … · obs … · docs …`; `W3 matrix: running 9 checks`; `STATE hash read-only (0 planning edits)` |
| SCR-R3W3Closeout.loading.running | `close-out: running round-3 gates + W3 matrix…`; Linear rows `open — awaiting gates` |
| SCR-R3W3Closeout.error.gate-fail | `<plan or W3 id>: fail` + count; Linear rows stay `open`; report row names `not yet listed` |
| SCR-R3W3Closeout.empty.no-run | `no round-3 or W3 run on merged main`; exit 1, not pass |
| SCR-R3W3Closeout.success | `7 of 7 plans exit 0; W3 9 of 9 green on stack a519184 + 0d5032f; STATE prefix 29bc314a and ROADMAP prefix 4b26403c with 0 planning files changed; 4 of 4 sub-issues n3 SPE-36512 · n4 SPE-36513 · n6 SPE-36515 · n7 SPE-36516 closed with 1 commit ref each; PR #255: <state> · PR #259: <state>` |

## T5471 boards — exact board copy (AC-97..AC-108)

Text verdicts only, never colour-only. No exit code, floor, count or verdict is invented; an
unmeasured row reads `unknown — not measured` and is never green. Blocked rows are never green.

| Screen.state | Board row text |
|---|---|
| SCR-QualityBaselineBoard.default.baseline | `typecheck exit 0 · lint exit 0 · test exit 0 · build exit 0 · check:docs exit 0 · check:gates exit 0 · check:pack exit 0 · check:mcp exit 0` (each row reads its recorded exit; unmeasured reads `unknown — not measured`); `src/fs <n> · src/core <n> · src/tools <n>`; `audit exit <n> · dependencies <n> · scanner 0 secrets` |
| SCR-QualityBaselineBoard.loading.running | `baseline: running 8 gates…` (board never reads recorded while any gate is running) |
| SCR-QualityBaselineBoard.error.gate-fail | `<gate> exit 1 — revert or carry with 1 tested reason`; other rows keep last truthful verdicts, never erased |
| SCR-QualityBaselineBoard.error.validation | usage line + code; unknown gate name or coverage directory reads `not run`, never pass |
| SCR-QualityBaselineBoard.empty.no-run | `no baseline recorded for this branch` (not pass); `suppression comments 0 · silent catches beyond the 10 named QUAL-01 exceptions 0 · new dependencies without justification 0`; `0 modules over the size ratchet, 1 size recorded per module` |
| SCR-QualityBaselineBoard.success.recorded | `8 of 8 gate exit codes recorded · 3 of 3 coverage floors measured · audit exit and dependency count recorded · ratchet counts 0 · 0 frozen catalogue codes changed · 0 shims added` |
| SCR-LinearContinuationBoard.default.listed | `<id> — done-with-evidence · <evidence ref>` or `<id> — blocked-with-named-cause`; `0 items lack a state`; `duplicate phase titles 0, 1 count recorded per phase`; match reads `reused existing <issue>`, nothing created |
| SCR-LinearContinuationBoard.loading.listing | `linear: listing open items…` (board never reads complete while listing) |
| SCR-LinearContinuationBoard.error.workspace-unreadable | `Linear workspace unreadable — <named cause>; 0 items marked` + 1 remedy; no item guessed done or blocked |
| SCR-LinearContinuationBoard.error.validation | usage line + code; unknown issue id reads `not listed`, never silently absent |
| SCR-LinearContinuationBoard.empty.no-open-items | `0 open items — all items done-with-evidence` (never blank) |
| SCR-LinearContinuationBoard.success.blocked-named | `BLOCKED — owner decision required` + exactly 1 cause + exactly 1 owner action + exactly 1 next step; carried blocker `phases 56-58 blocked on the realmlive stack, 0 live windows scheduled` |
| SCR-GateEnforcementBoard.default.verdicts | `review pass · quality pass · security pass · release pass` (text, never a colour-only chip); missing reads `not recorded — gate not run`, never pass |
| SCR-GateEnforcementBoard.loading.recording | `gates: recording verdicts…`; release readiness reads `held — verdicts incomplete`, never ready |
| SCR-GateEnforcementBoard.error.red-gate | `release readiness: held — <gate> red`; `0 releases land on a red verdict`; most-restrictive verdict wins on conflict; other verdicts keep recorded values |
| SCR-GateEnforcementBoard.error.validation | usage line + code; unknown gate name reads `not run`, never pass |
| SCR-GateEnforcementBoard.empty.no-verdicts | `0 verdicts recorded for this branch` (not pass; release held) |
| SCR-GateEnforcementBoard.success.ready | `4 of 4 verdicts present · most-restrictive wins · release ready`; `100 percent of 4 stories trace to 1 or more criteria, 0 uncovered requirements` (label `held`/`ready` + shape cue, NFR-A3) |

## T8580 — SCR-BootBindingDiag exact copy (AC-114..AC-116)

stdout carries the catalogue code/result; stderr carries the human reason. Exactly 1 code,
1 binding, 1 remedy per failure; later bindings read `not probed`, never `pass`. All text
survives `NO_COLOR`/pipe. Diagnostic text never carries file content, tokens, or secrets.

| Screen.state | Operator copy |
|---|---|
| SCR-BootBindingDiag.default | `[DISCONNECTED]` + `up: probing 4 bindings…` with elapsed; checklist `daemon: pass/fail/not probed · driver: … · image: … · config: …` in text |
| SCR-BootBindingDiag.loading | `up: starting daemon (≤200s budget, NFR-P1)…` with elapsed; never waits silently |
| SCR-BootBindingDiag.error.daemon | `REALM_NOT_ACTIVE — daemon socket absent (state-dir relative) after 1 start + 1 status wait` · `cause: daemon socket absent` · `remedy: fix daemon, then retry up` · `verify: up prints 1 container id and status reads ACTIVE` |
| SCR-BootBindingDiag.error.driver | `OPENSHELL_GATEWAY_LOST — gateway unanswered` or `OPENSHELL_START_FAILED — driver failed to start (failed step: <step>)` · `cause: driver socket absent/stale` · `remedy: fix driver, then retry up` · `verify: up prints 1 container id and status reads ACTIVE`; never rendered as `POLICY_DENIED` |
| SCR-BootBindingDiag.error.image-config | `POLICY_DENIED — image digest mismatch: <image ref>, expected digest <prefix>…` · `cause: pulled image digest ≠ configured digest; 0 containers created` · `remedy: point config at the pinned image digest, then retry up` — or `AGENTOS_NOT_CONFIGURED` / `POLICY_DENIED` naming the missing config or workspace root (path class only) |
| SCR-BootBindingDiag.empty.no-config | `no generated config selects matching daemon and driver — run realm init (writes templates without overwrite, private roots 0700)` |
| SCR-BootBindingDiag.success | `[ACTIVE]` + `container <id> · readback confirmed · 0 ERR_MODULE_NOT_FOUND` (1 container id + 1 valid readback; `up` alone never adopts) |

NoticeBanner (`neverSilent: true`): the diagnostic card above is the single notice line —
always rendered, `role="status"` `aria-live="polite"`, never in tab order. A disconnected
realm still refuses host `edit` / Realm `write` with `REALM_NOT_ACTIVE` (fail-closed, D4).

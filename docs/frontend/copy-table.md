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

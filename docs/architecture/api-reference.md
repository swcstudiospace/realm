# API reference

This reference is rendered from the OpenAPI contracts in
[contracts/](contracts/); the contract is the source of truth and wins on any
It covers every operation in the four contracts: Realm control, GSD pipeline and Linear tracking, Realm Omp plugin, and the Ultrathink completion gate.

## Realm control (`api-realm-control.yaml`, 1.0.0)

Server: `unix:///state/control.sock` (user-only socket; directory 0700,
socket 0600; no network listeners).

### GET /status

Realm status with color-independent text label (`realmStatus`). Returns
200 with `StatusResponse`: exactly 1 of 2 text labels (`realm active`,
`realm disconnected`), a code (`REALM_NOT_ACTIVE`,
`OPENSHELL_GATEWAY_LOST`, `AGENTOS_CRASH_LOOP`), and `correlationId`.

### POST /up

Bring the sandbox to active (`realmUp`). Returns 200 with `StatusResponse`
when the realm is active within the startup budget; 409 `POLICY_DENIED`
for an outside-root workspace (MULTI-06).

### POST /down

Tear down one session's sandbox (`realmDown`). Returns 200 with
`StatusResponse`: the realm is disconnected for this session while other
sessions remain active (MULTI-05).

### POST /audit/verify

Verify the seq/prev hash chain (`auditVerify`). Returns 200 with
`AuditVerifyResponse` (`valid`, `headSeq`, `correlationId`) when the chain
is valid and the head is recovered from the last line; 422 names the first
broken line (edit, removal, or reorder).

### GET /control/metrics

Counters and timings over the control socket (`realmMetrics`). Returns 200
with `MetricsResponse` (`counters`, `correlationId`): tool-call, transition,
and attach counts, with 0 network listeners on the daemon.

### POST /checkpoint/restore

Restore the workspace byte-for-byte from a snapshot
(`checkpointRestore`). Returns 200 with `StatusResponse` when every file
returns to its prior bytes (deletions restored, extras removed); 409
refuses unsafe paths.

### POST /tools/write

Registered write through the realm (`toolWrite`), one of the 5 Realm tools
(exec, read, write, list, status). Returns 200 with `ToolResult` when bytes
land in `/workspace` and the host root with audit admission and result
sharing 1 correlation id; 409 is the fail-closed refusal
(`REALM_NOT_ACTIVE`) with 0 host files.

## GSD pipeline and Linear tracking (`api-gsd-linear.yaml`, 1.0.0)

Server: `internal://gsd-linear`. Phase lifecycle and Linear linkage for
v3.0 phases 12, 13, 14, 16, 17, 18, 19, 20: 8 phase issues plus 33
sub-issues (1 per plan), deduplicated against SPE-* before creation.

### GET /gsd/phases

List phase lifecycle state (`listPhases`). Returns 200 with an array of
`Phase` (`phaseId` enum 12/13/14/16/17/18/19/20, `state` enum
brief drafted/discussed/planned/executed/verified/audited/completed/
cleaned up, `correlationId`): the phase DAG state (3 lanes, strict order
inside a lane).

### GET /linear/issues

Dedup scan for SPE-* issues (`dedupScan`). Returns 200 with `DedupReport`
(`duplicates`, `correlationId`): 0 duplicates per phase when run before
creation.

### POST /linear/issues/phase

Create 1 phase issue with 1 collapsible Agent notes section
(`createPhaseIssue`). Returns 201 with `LinearIssue` (`title`, `phaseId`,
`correlationId`): 1 phase issue created per phase (8 total).

### POST /linear/issues/sub

Create 1 sub-issue per plan, 33 total (`createSubIssue`). Returns 201 with
`LinearIssue`: the sub-issue is linked to 1 phase id, 1+ plan ids, and 1+
requirement ids.

### GET /ship/records

Per-phase ship record (`listShipRecords`). Returns 200 with an array of
`ShipRecord` (`phaseId`, `gatesExit0`, `greptile` enum 5/5,
`correlationId`): 8 gates exit 0, CI green, Greptile 5/5, squash merge,
0 version/CHANGELOG edits.

## Realm Omp plugin (`api-realm-omp-plugin.yaml`, 1.0.0)

Server: `internal://realm-omp-plugin`. The plugin toggle defaults on and is
orthogonal to the earlier `reattach.enabled` flag, which is unchanged.
Paints land in the additional UI region rendered by the Omp host, never on
the under-bar status surface.

### GET /plugin/toggle

Read the persisted plugin toggle (`getPluginToggle`). Returns 200 with
`ToggleResponse` (`enabled`, `correlationId`): the persisted value; defaults
on when no setting is stored.

### PUT /plugin/toggle

Set the persisted plugin toggle (`setPluginToggle`). Request:
`ToggleRequest` (`enabled`, `correlationId`). Returns 200 with
`ToggleResponse`: off registers 0 tools and paints 0 times.

### GET /plugin/status-paint

Render Realm status in the additional UI region
(`getPluginStatusPaint`). Returns 200 with `StatusPaintResponse`
(`target` enum additional-ui, `underBarPaints`, `states` enum
unbound/connecting/active/error, `correlationId`): the paint lands in the
additional UI region with 0 under-bar paints and truthful text in 4 of 4
states.

### GET /startup/diagnose

Diagnose startup with a missing workspaceRoot (`startDiagnose`). Returns
200 with `DiagnoseResponse` (`workspaceRootExists`, `code`, `correlationId`)
when the configured workspace exists and a clean start is possible; 409
`POLICY_DENIED` names the 1 missing directory (`missingPath`) with 1 remedy
(`remedy`). Operator-local diagnostics only, never audit or log content.

## Ultrathink completion gate (`api-ultrathink-completion-gate.yaml`, 1.1.0)

Server: `internal://ultrathink-completion-gate`. Tracker completion retires
a stale staged partial_failure verdict; a proceed answer persists before
kickoff and survives reload; the incomplete notice is advisory and
continues under gsd-autonomous autonomy with 0 manual proceed steps. The
notice contains 0 banned STOP, proceed, or confirm strings; the incomplete
metrics stay visible with 1 warning line.

### POST /gate/validate

Revalidate staged artifacts against the current tracker state
(`validateGateArtifacts`). Request: `ValidateRequest` (`text`,
`correlationId`). Returns 200 with `ValidateResponse` (`state` enum
ready/partial_failure/failed_or_cancelled, `pendingRows`, `problems`,
`staleVerdicts`, `correlationId`): fresh verdict computed from the current
tracker rows, with 0 stale verdicts after completion.

### GET /gate/release

Read release readiness from the current tracker status
(`getGateRelease`). Returns 200 with `ReleaseResponse` (`ok`, `reason` enum
ready/not_ready/already_released/failed, `pendingRows`, `detail`,
`correlationId`): ready after tracker completion, or not_ready naming the
pending row count.

### PUT /session/answer

Persist a proceed answer with the settled answers before kickoff
(`persistSessionAnswer`). Request: `AnswerRequest` (`answers` of
`SettledAnswer`, `kickedOff`, `correlationId`). Returns 200 with
`AnswerResponse` (`answers`, `kickedOff`, `persisted`, `reAsked`,
`correlationId`): persisted answer record with kickedOff true, recorded
before kickoff step 1 completes.

### GET /session/answer

Restore settled answers and the kickedOff flag after reload
(`getSessionAnswer`). Returns 200 with `AnswerResponse`: restored answers
with kickedOff true, 0 settled questions re-asked, 0 blocking prompts.

### GET /gate/advisory

Render the advisory incomplete-plan notice (`getGateAdvisory`). Returns 200
with `AdvisoryResponse` (`note`, `pendingRows`, `continues`,
`warningLines`, `correlationId`, `graphId`, `unblockingAction`,
`renderCount`, `failure`): 1 advisory note naming the graph id, pending
rows, and unblocking action, 0 banned strings, request continues; silent on
a complete plan; 1 named failure on malformed state.

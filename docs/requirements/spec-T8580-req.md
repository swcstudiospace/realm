# Requirements Spec — agent-realm boot repair (T8580-req)

**Branch:** `fix/stdio-host-shutdown-log` · **HEAD:** `e9da12b` · **Version:** 0.9.9 ·
**Correlation:** `8580afa9-9458-4765-bc6e-36ca297050c1` · **Task:** `T8580-req` ·
**Capability:** `req.spec` · **Status:** IN_REVIEW · **Risk:** medium
**Status note:** Gates, formatters, builds and tests are skipped per brief instruction
(`Skip gates/formatters; edit only`); the parent runs gates after join. Live-stack proof
runs on the realm account, where Podman 5.x and the OpenShell gateway live
(AGENTS.md Status, live evidence 2026-10-30/31); this checkout host holds no live receipt.

## 1. Symptom and core value

A user connected to Realm in Omp. No commands run inside the session. The boot surface
reports 2 errors: a Policy error and an AgentOS Error. No write command appears to work.

The symptom matches the fail-closed design in AGENTS.md (Core guarantee): while the realm
is not active, the Omp guard refuses host `edit` and Realm `write` calls, and the policy
mode defaults to `fail-closed` (decision D4). The stdio boot path in `src/cli/stdio-host.ts`
refuses tool calls with `REALM_NOT_ACTIVE` (retryable) until the boot driver adopts a
verified client, and `src/core/errors.ts` names the boot codes `REALM_NOT_ACTIVE`,
`POLICY_DENIED`, `AGENTOS_NOT_CONFIGURED`, `AGENTOS_STOP_FAILED`, `AGENTOS_CRASH_LOOP`,
`OPENSHELL_START_FAILED` and `OPENSHELL_GATEWAY_LOST`.

Core value: every file mutation either lands inside the realm under policy or fails closed
with 1 named catalogue code, and the operator sees 1 truthful active-or-disconnected state
for the session at all times.

## 2. Diagnosis requirements (what to build, not how)

The fix binds 4 separate things. Each binding names its own failure code and remedy.
A failure in 1 binding must stay visible as that binding, never as a generic boot error.

- **BOOTF-01 (daemon binding):** when the daemon socket under the configured state directory
  is absent, boot starts the daemon 1 time and waits for 1 status response within the
  startup bound; the diagnostic names the socket path class (state-dir relative) and the
  wait outcome.
- **BOOTF-02 (driver binding):** when the compute driver socket is absent or stale, boot
  names `OPENSHELL_GATEWAY_LOST` or `OPENSHELL_START_FAILED` with the failed step named;
  boot never reports the failure as a policy refusal.
- **BOOTF-03 (image binding):** when the configured sandbox image digest in
  `sandbox/expected-digests.json` does not match the pulled image, boot names the image
  ref and the expected digest prefix and refuses `up` with 1 catalogue code.
- **BOOTF-04 (config binding):** when no generated config selects matching daemon and
  driver, or the workspace root is missing, boot names `AGENTOS_NOT_CONFIGURED` or
  `POLICY_DENIED` with the missing item named; `realm init` writes templates without
  overwrite and creates the private roots at mode 0700.
- **BOOTF-05 (active proof):** a session counts as active only after `up` returns 1
  container id and 1 readback of the sandbox state confirms the container; the Omp guard
  lifts the host-write refusal in the same turn that readback confirms active.
- **BOOTF-06 (policy error path):** a `POLICY_DENIED` refusal in boot names the denied
  action, the policy file identity (path class, never file content) and the remedy;
  a capability-token refusal names `capabilityTokens` mode and the key id, never a token.
- **BOOTF-07 (AgentOS error path):** an AgentOS boot error names 1 catalogue code,
  the failed step (create, exec-child start, or stop) and the sandbox id; the daemon
  log and the audit line carry the same code for the same failure.
- **BOOTF-08 (shutdown hygiene on this branch):** on stdin end or signal, the stdio host
  closes its client, removes its presence marker and never sends `down`; the sandbox
  stays up for the next attach.

## 3. User stories

## US-137 — Diagnose the boot failure with 1 named cause

As an operator, I want each boot failure to name 1 catalogue code, the failed binding
and the remedy, so that I can fix the binding without reading source.

- Requirement IDs: BOOTF-01, BOOTF-02, BOOTF-03, BOOTF-04.
- Estimate: 5 points. Dependencies: none.
- Priority: Must.

## US-138 — Reach active so write commands work

As a model author, I want write commands to land inside the realm once boot reaches
active, so that no write appears to fail while the realm is active.

- Requirement IDs: BOOTF-05, BOOTF-06, BOOTF-07, BOOTF-08.
- Estimate: 8 points. Dependencies: none.
- Priority: Must.

## US-139 — Linear and Notion programming for phases 55 to 59

As a maintainer, I want 1 Linear issue and 1 Notion page per v9.0 phase (55, 56, 57, 58, 59)
with a sub-issue per plan, so that phase state and evidence live in 1 tracked place.

- Requirement IDs: TRACK-01, TRACK-02, TRACK-03 (phases 55 to 59 from `.planning/ROADMAP.md`).
- Estimate: 3 points. Dependencies: none.
- Priority: Must.

## US-140 — Quality pass at the production bar

As a maintainer, I want strict-typing, pattern and coverage checks to pass on the change,
so that the codebase keeps 0 silent catches and 0 suppression comments after the fix.

- Requirement IDs: QUALB-01, RATCHET-01 (carried IDs from `.planning/REQUIREMENTS.md`).
- Estimate: 8 points. Dependencies: none.
- Priority: Must.

## US-141 — Ship on green CI with Greptile skipped

As a maintainer, I want the change to merge to main through 1 pull request on 5 green CI
checks, so that main carries 0 unreviewed merges and 0 red checks.

- Requirement IDs: SHIP-01, SHIP-02, SHIP-03, DEVT-01 (deviation record below).
- Estimate: 3 points. Dependencies: none.
- Priority: Must.

## US-142 — Runbook for the boot failure

As an operator, I want a runbook section that maps each boot code to its remedy steps,
so that a recurrence resolves in 1 session without source reading.

- Requirement IDs: RUNB-01, RUNB-02 (extends HEALTH-01/02 runbook work of Phase 55).
- Estimate: 3 points. Dependencies: none.
- Priority: Should.

Prioritization: MoSCoW (6 stories, at or under 20, so WSJF gives way to MoSCoW per
policy). Order: US-137, US-138, US-139, US-140, US-141, US-142.

## 4. Acceptance criteria

## US-137 — Diagnose the boot failure with 1 named cause

AC-114 story: US-137
Given a configured workspace directory that exists
When `realm up` runs 1 time
Then it reaches active with 1 container id and 0 `ERR_MODULE_NOT_FOUND` errors
check: up exit code and container count
automated: true

AC-115 story: US-137
Given a generated config with 1 missing item (daemon config, driver config, image, or workspace root)
When `realm up` runs 1 time
Then it exits 1 with 1 catalogue code naming the missing item and 0 containers created
check: exit code and diagnostic text
automated: true

AC-116 story: US-137
Given a stale compute-driver socket
When `realm status` runs 1 time
Then the status names `OPENSHELL_GATEWAY_LOST` or `OPENSHELL_START_FAILED` with 1 failed step named and 0 `POLICY_DENIED` codes
check: status code and step name
automated: true

## US-138 — Reach active so write commands work

AC-117 story: US-138
Given an inactive realm in fail-closed mode
When 1 host `edit` call and 1 Realm `write` call run through the Omp guard
Then both refuse with 0 host files changed and 1 catalogue code each
check: refusal codes and host file count
automated: true

AC-118 story: US-138
Given all 4 bindings verified (daemon socket, driver socket, image digest, generated config)
When `realm up` runs 1 time
Then 1 container id exists, 1 readback confirms it, and the next Realm `write` lands 1 file with 1 admission line and 1 result line under 1 correlation id
check: container id, file bytes, audit pair identity
automated: true

AC-119 story: US-138
Given an active session
When stdin ends for the stdio host 1 time
Then the host closes its client, removes 1 presence marker, sends 0 `down` calls, and the sandbox stays active for the next attach
check: marker count, down call count, next status
automated: true

AC-120 story: US-138
Given 1 capability-token refusal in boot
When the refusal text is read 1 time
Then it names mode `enforce` and 1 key id with 0 token values and 0 secret values in the text
check: refusal text token count
automated: true

## US-139 — Linear and Notion programming for phases 55 to 59

AC-121 story: US-139
Given the Linear workspace issue list for SPE-* issues
When a duplicate scan runs 1 time before creation
Then 0 duplicate phase titles exist for phases 55 to 59 and each existing phase issue is reused
check: duplicate scan count
automated: true

AC-122 story: US-139
Given phases 55 to 59 with plan counts from `.planning/ROADMAP.md`
When issues are created 1 time
Then 5 issues exist (1 per phase), each links 1 phase id, 1 or more plan ids and 1 or more requirement ids, and each holds 1 collapsible Agent notes section
check: issue count and link field count
automated: true

AC-123 story: US-139
Given 5 Linear issues and 5 Notion pages (1 per phase)
When link fields are read 1 time
Then each issue links 1 Notion page and each page links 1 Linear issue, with 5 of 5 bidirectional pairs present
check: bidirectional link count
automated: true

## US-140 — Quality pass at the production bar

AC-124 story: US-140
Given the change on branch `fix/stdio-host-shutdown-log`
When the 8 standard gate commands run 1 time
Then 8 of 8 gates exit 0 (typecheck, lint, test, build, check:docs, check:gates, check:pack, check:mcp) with 1 exit code recorded per gate
check: gate exit codes
automated: true

AC-125 story: US-140
Given the change diff
When strict pattern checks run 1 time
Then suppression comments equal 0, silent catches beyond the 10 named QUAL-01 exceptions equal 0, and modules over the size ratchet equal 0
check: pattern check counts
automated: true

AC-126 story: US-140
Given coverage output for 3 directories (`src/fs`, `src/core`, `src/tools`)
When the coverage gate runs 1 time
Then each of 3 directories meets its committed floor with 1 measured value recorded per directory
check: coverage floor values
automated: true

## US-141 — Ship on green CI with Greptile skipped

AC-127 story: US-141
Given 1 pull request to main from `fix/stdio-host-shutdown-log`
When CI status is read 1 time
Then 5 check runs (verify on Node 22.x, verify on Node 24.x, site, audit, guard) report success with 0 failed runs
check: pull request check runs
automated: true

AC-128 story: US-141
Given 1 pull request with 5 green check runs
When merge is recorded 1 time
Then 1 squash merge lands on main through the ship flow, 0 direct merge commands run, and 0 version fields or CHANGELOG lines change in the pull request
check: merge record and diff file list
automated: true

AC-129 story: US-141
Given 1 pull request to main
When the pull request body is read 1 time
Then 1 line records the Greptile skip under DEVT-01 with 0 Greptile 5-of-5 claims and 0 fake review verdicts
check: pull request body waiver line
automated: true

## US-142 — Runbook for the boot failure

AC-130 story: US-142
Given the operator runbook
When it is read 1 time
Then it maps each of 4 boot codes (`REALM_NOT_ACTIVE`, `POLICY_DENIED`, `AGENTOS_NOT_CONFIGURED`, `OPENSHELL_GATEWAY_LOST`) to 1 remedy with 1 verification step each, totaling 4 remedies and 4 verification steps
check: runbook code-to-remedy count
automated: true

AC-131 story: US-142
Given 1 boot code remedy from the runbook
When an operator follows it 1 time
Then the failing binding passes its check within 1 run and the boot reaches active with 1 container id
check: binding check result and container count
automated: true

## 5. Non-functional requirements

- **NFR-P1** (perf): `realm up` reaches active within 200 s on the 5.7.1 realm stack;
  control-socket reads return within 10 s. verified_by: A08.live.
- **NFR-B1** (perf): boot diagnosis prints 1 named cause within 10 s of the failed step,
  and the active proof (1 container id plus 1 readback) completes within 200 s.
  verified_by: A08.live.
- **NFR-S1** (security): under fail-closed, disconnected host `edit` and Realm `write`
  calls return 0 successes; socket directory mode 0700 with socket mode 0600; scanner
  output holds 0 secrets. verified_by: A08.security.
- **NFR-S3** (security): refusal and diagnostic text holds 0 token values and 0 secret
  values; audit and log PII fields equal 0 with 1 redaction sentinel present.
  verified_by: A08/A10.
- **NFR-A1** (a11y): status shows exactly 1 of 2 text labels with a color-independent
  cue; both labels stay distinguishable without color. verified_by: A08.
- **NFR-I1** (i18n): every result code matches the frozen catalogue in C and en_US
  locales; 0 code paths parse locale-formatted numbers; operator text is English.
  verified_by: A08.
- **NFR-C1** (compliance): off-machine telemetry calls equal 0; AGPL-3.0-only licensing
  is preserved; vulnerability reports route through private GitHub reporting.
  verified_by: A08/A10.

## 6. Linear and Notion programming (routed to A01, not executed here)

Duplicate scan first (read-only): list SPE-* issues, match on phase id plus title
keywords for phases 55 to 59; reuse an existing issue when a phase title exists; never
create a 2nd issue for 1 phase.

- **1 issue per phase (5 issues):** phases 55 (HEALTH-01/02), 56 (STOP-05/06),
  57 (HTIER-01), 58 (KIMV-02), 59 (CBIND-01/02/03, code gated on owner ratification
  of `53-DESIGN.md`, D-v9-6). Title is 1 short line naming the phase; detail lives in
  1 collapsible `+++ Agent notes` section per issue holding phase id, plan ids,
  requirement ids and acceptance counts. 1 sub-issue per plan.
- **1 Notion page per phase (5 pages):** the page links the Linear issue and the
  GSD phase record; the issue links the page. No close and no status change happen
  without recorded evidence (gate exit codes or live receipt).
- Phases 56, 57, 58 each need 1 live window on the shared realm stack under the live
  lock, run 1 at a time; Phase 55 is hermetic-first and needs no live window for its core.

## 7. Deviation record (DEVT-01)

AGENTS.md (Merge and release flow, item 4) requires Greptile 5 of 5 with 0 open comments
before merge, and calls it a process rule that the ship flow enforces. The brief for this
task orders: ship with all green CIs, Greptile skipped. This spec records the skip as
deviation DEVT-01: the skip applies to this change only, the pull request records 1 waiver
line, and the merge still runs through the ship flow. A02 does not waive a standing gate;
the owner ratifies DEVT-01 at merge time, or Greptile runs before merge. All 5 CI checks
and the Breaking change guard stay required. This is the 1 known conflict between brief
and AGENTS.md in this spec; A01 routes the ratification to the owner.

## 8. Traceability

| Requirement | Criteria count | Artifact |
|---|---|---|
| US-137 | 3 | this file, section 4 |
| US-138 | 4 | this file, section 4 |
| US-139 | 3 | this file, section 4 |
| US-140 | 3 | this file, section 4 |
| US-141 | 3 | this file, section 4 |
| US-142 | 2 | this file, section 4 |
| NFR-P1, NFR-B1 | A08.live | this file, section 5 |
| NFR-S1, NFR-S3 | A08.security, A08/A10 | this file, section 5 |
| NFR-A1 | A08 | this file, section 5 |
| NFR-I1 | A08 | this file, section 5 |
| NFR-C1 | A08/A10 | this file, section 5 |

Rule: every requirement above carries at least 1 link, and every link names a real
artifact in the repo. No requirement stays uncovered. Requirement IDs stay stable across
revisions; no renumbering happens.

## 9. Assumptions and open questions

- **A1 (confidence: high):** the Policy error is the fail-closed refusal while the realm
  is inactive, and the AgentOS Error is 1 of the boot codes in section 1. Evidence:
  AGENTS.md Core guarantee and `src/core/errors.ts` catalogue. A live receipt confirms it.
- **A2 (confidence: medium):** the 4 bindings in section 2 cover the user failure; a live
  run names the actual failed binding with 1 code, and this assumption updates then.
- **Q1:** owner ratification of DEVT-01 (Greptile skip) at merge time, per section 7.
- **Q2:** Phase 59 code stays gated on owner ratification of `53-DESIGN.md` (D-v9-6);
  no requirement in this spec lifts that gate.
- **Q3:** live proof needs the realm account (Podman 5.7.1, OpenShell 0.1.5); this spec
  ships as IN_REVIEW and the parent records the live receipt or the named skip reason.
- No PII, PHI or secrets appear in this spec. No new npm dependency is required.
  No change to `docs/specs/realm-spec.xml` is required.

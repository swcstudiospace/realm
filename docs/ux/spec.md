# UX Spec — Realm Operator Surfaces (v3.0, tokens 1.0.0)

**Task:** `Tc8fd-ux` · **Correlation:** `c8fd136c-b9a0-459e-bc27-e2c578d77a08` · **Capability:** `ux.spec`
**Fidelity:** lofi (ASCII wireframes; no Figma tool available) · **Provisional:** true (no brand guide; system default theme only; no brand values invented)
**Scope:** CLI/daemon/Omp-extension operator surfaces, onboarding docs, Linear/GSD tracking UX. Realm is not a marketing site; every screen below is a text-first operator surface where color is never the sole cue.
**Tokens:** `docs/ux/tokens.json` v1.0.0 · **A11y sheet:** `docs/ux/a11y.md`

## Design principles (binding on all screens)

1. **Text first, color second.** Every status shows a text label. Color from `color.status.*` may reinforce a label but must never be the sole means of conveying it (NFR-A1). Monochrome/NO_COLOR/piped output preserves the label and its shape cue.
2. **Codes are the contract.** `realm <cmd>` exits 0 (success), 1 (catalogue-coded failure), 2 (usage error). stdout carries the catalogue code or result; stderr carries human reason, never env values or tokens (see A04 security: synthetic fixtures only).
3. **Fail closed visibly.** A disconnected/unreachable realm refuses with `REALM_NOT_ACTIVE` and 0 host files. The refusal is announced, never silent (AC-12, AC-15).
4. **Blocked is not failed.** Owner-blocked work (e.g. HARN-03) shows an explicit blocked block; it is never rendered green, pass, or a pass-adjacent tone. See `ds/BlockedNotice`.
5. **No dark patterns.** No fake urgency, hidden costs, or loss-framed copy. Copy states facts: what happened, what it means, what to do next.
6. **Locale-stable codes.** Result codes match the frozen catalogue in `C`/`en_US`; operator text is English; no code path parses locale-formatted numbers (NFR-I1). Long ids wrap; nothing truncates into ambiguity.

## Required state families (every screen)

Default, loading, error, empty, success — specified per screen below as dotted sub-states (`error.*`, `empty.*`). A screen without all five families is not publishable.

## AC trace (every screen cites acceptance ids; orphans unpublishable)

| Screen | AC refs |
|---|---|
| SCR-RealmStatus | AC-11, AC-12, AC-13, AC-15, AC-21, AC-23, AC-24 |
| SCR-RealmLifecycle | AC-14, AC-16, AC-17, AC-22, AC-25 |
| SCR-RealmDoctor | AC-19, AC-20 |
| SCR-RealmAudit | AC-10, AC-18, AC-30 |
| SCR-RealmCheckpoint | AC-24, AC-25, AC-26 |
| SCR-RealmMetrics | AC-20 |
| SCR-OmpGuard | AC-1, AC-2, AC-3, AC-4, AC-14, AC-15, AC-16, AC-17 |
| SCR-CiGates | AC-5, AC-6, AC-7, AC-8, AC-9, AC-31 |
| SCR-OnboardingDocs | AC-4, AC-21, AC-30 |
| SCR-ReleaseProvenance | AC-27, AC-28, AC-29 |
| SCR-LinearGsd | AC-30, AC-32 |

Coverage: AC-1..AC-32 all referenced at least once (overlaps are intentional where two surfaces show the same fact).

## SCR-RealmStatus — `realm status`

**Question answered:** is this project's sandbox active right now, and if not, why?
**Flows:** check-readiness, confirm-notice, diagnose-loss.
**Layout (ASCII, lofi):**

```
┌─ [ds/StatusReadout] ───────────────────────────┐
│ [ACTIVE]/[DISCONNECTED]  realm-<session>  <ws> │
│ lifecycle: active|degraded|maxMs  counters     │
│ notice: <one-line, never silent> (ds/Notice)   │
└────────────────────────────────────────────────┘
```

- `default`: label line + lifecycle line + notice line. Text label is one of exactly two: `ACTIVE` or `DISCONNECTED`. Co-located shape cue: `[ACTIVE]` vs `[DISCONNECTED]` brackets + leading glyph `●`/`○` (redundant with text; color optional, `color.status.success`).
- `loading`: `status: probing daemon …` (progress text; no spinner dependence).
- `error.daemon-absent`: `DISCONNECTED` + `daemon absent (REALM_NOT_ACTIVE); local report`; exit 1. Never green.
- `error.validation`: usage (exit 2) + code line; unknown lifecycle reads as `REALM_NOT_ACTIVE` (or `SCHEMA_INVALID` for malformed reply).
- `empty.no-sessions`: `DISCONNECTED` + `no live session for <ws>`; still a text label (empty is not blank).
- `success`: `ACTIVE` + `container realm-<sessionId>` + audit/lock file paths (per-session snapshot, AC-23).
- `degraded`: `ACTIVE` + `degraded: <cause>` notice (never a third label; gateway-or-driver-loss code, never `AGENTOS_CRASH_LOOP`, AC-21).

**Components:** `ds/StatusReadout@1.0`, `ds/NoticeBanner@1.0` (notice never silent; unread reconcile/reap notices shown: AC-11, AC-12).
**Focus order:** `workspace-selector`, `status-query`, `notice-area`.
**A11y:** target WCAG-2.2-AA; NFR-A1 color-independent cue; min_contrast 6.47.

```json
{ "screen_id": "SCR-RealmStatus", "flows": ["check-readiness", "confirm-notice", "diagnose-loss"], "states": ["default", "loading", "error.daemon-absent", "error.validation", "empty.no-sessions", "success"], "components": [{ "ref": "ds/StatusReadout@1.0", "props": { "labels": ["ACTIVE", "DISCONNECTED"] } }, { "ref": "ds/NoticeBanner@1.0", "props": { "neverSilent": true } }], "a11y": { "target": "WCAG-2.2-AA", "focus_order": ["workspace-selector", "status-query", "notice-area"], "min_contrast": 6.47 }, "tokens_version": "1.0.0", "fidelity": "lofi", "provisional": true, "acceptance_refs": ["AC-11", "AC-12", "AC-13", "AC-15", "AC-21", "AC-23", "AC-24"] }
```

## SCR-RealmLifecycle — `realm init|up|down`

**Question:** bring this workspace's sandbox up / down without leaking across projects?
**Flows:** start-sandbox, stop-sandbox, initialize.
**Layout:**

```
┌─ [ds/LifecycleSteps] ──┐  ┌─ [ds/StatusReadout] ─┐
│ init: image@sha256 …   │  │ [ACTIVE]/[DISCON]    │
│ up: session + ws bytes │  │ per-session files    │
│ down: other ws intact  │  └──────────────────────┘
└────────────────────────┘
```

- `default`: steps list, one line each (init image digest pinned; up names session; down names what stays).
- `loading`: `up: starting daemon (≤200s budget)…` with elapsed.
- `error.policy`: `POLICY_DENIED`, 0 containers created (outside configured roots, AC-23).
- `error.not-active`: `REALM_NOT_ACTIVE` on attach/mcp/acp before `up` (0 host files).
- `empty`: no workspace configured → usage + `select --workspace`.
- `success`: `ACTIVE` + `down` prints `disconnected` + `already down (REALM_NOT_ACTIVE)` only when already down (exit 0, no error framing).

Per-project isolation is visible: two sandboxes `realm-<sessionId>` named; a write in one is stated invisible in the other (AC-22). Advisory vs fail-closed: registered-write warning shown every invocation in advisory (AC-16); fail-closed refuses with catalogue code + guard backstop (AC-15).
**Focus order:** `workspace`, `image-digest`.
**A11y:** WCAG-2.2-AA, min_contrast 6.47.

```json
{ "screen_id": "SCR-RealmLifecycle", "flows": ["start-sandbox", "stop-sandbox", "initialize"], "states": ["default", "loading", "error.policy", "error.not-active", "empty.no-workspace", "success"], "components": [{ "ref": "ds/LifecycleSteps@1.0", "props": { "steps": ["init", "up", "down"] } }, { "ref": "ds/StatusReadout@1.0", "props": { "labels": ["ACTIVE", "DISCONNECTED"] } }], "a11y": { "target": "WCAG-2.2-AA", "focus_order": ["workspace", "image-digest"], "min_contrast": 6.47 }, "tokens_version": "1.0.0", "fidelity": "lofi", "provisional": true, "acceptance_refs": ["AC-14", "AC-16", "AC-17", "AC-22", "AC-25"] }
```

## SCR-RealmDoctor — `realm doctor [--fix [--dry-run]]`

**Question:** what is wrong with this machine/workspace, and what would a fix change?
**Flows:** run-checks, apply-fix, verify-fix.
**Layout:**

```
┌─ [ds/CheckList] ✓/✗ + id + remedy ┐
┌─ [ds/FixPreview] would-apply…      ┐
```

- `default`: check rows `pass|fail` in text (never color-only) + remedy line per failure.
- `loading`: `doctor: running N local checks…`.
- `error.daemon-absent`: JSON checks to stdout + `daemon absent (REALM_NOT_ACTIVE); ran N local checks` to stderr (machine + human lines).
- `empty`: no checks configured → `no checks` text (not blank).
- `success`: all pass; `--fix --dry-run` prints `would <kind> <path> to 0700` and changes nothing; `--fix` applies safe fixes only.
- Counters/timings readable over control socket (AC-20) are linked from doctor output (`metrics` pointer).

**Focus order:** `workspace`, `fix-mode`, `dry-run`.
**A11y:** WCAG-2.2-AA, min_contrast 6.47.

```json
{ "screen_id": "SCR-RealmDoctor", "flows": ["run-checks", "apply-fix", "verify-fix"], "states": ["default", "loading", "error.daemon-absent", "error.validation", "empty.no-checks", "success"], "components": [{ "ref": "ds/CheckList@1.0", "props": { "verdicts": ["pass", "fail"] } }, { "ref": "ds/FixPreview@1.0", "props": { "dryRunFirst": true } }], "a11y": { "target": "WCAG-2.2-AA", "focus_order": ["workspace", "fix-mode", "dry-run"], "min_contrast": 6.47 }, "tokens_version": "1.0.0", "fidelity": "lofi", "provisional": true, "acceptance_refs": ["AC-19", "AC-20"] }
```

## SCR-RealmAudit — `realm audit verify` + `realm anchor`

**Question:** can I prove no audit line was edited, deleted, or reordered?
**Flows:** verify-chain, pin-head, verify-anchor.
**Layout:**

```
┌─ [ds/AuditVerdict] exit 0|1 line <n> ───┐
│ files checked, head seq:sha, anchor root │
└───────────────────────────────────────────┘
```

- `default`: per-file result lines; head recovered from last line at startup.
- `loading`: `audit: checking <file>…`.
- `error.chain-break`: exit 1 naming the first broken line (`line N does not chain (prev-mismatch)`).
- `error.validation`: exit 2 usage (conflicting/malformed selector/pin).
- `empty.no-files`: `no audit file to verify` (exit 1, not pass).
- `success`: `verified: K files, head <seq>:<sha256>` (exit 0).
- Paths never printed; failures name session + line (or anchor line count). Crash-stage sweep orphans are listed by sweep audit lines (AC-10).
- Milestone audit (AC-30) renders one row per requirement: satisfied/carried/superseded, 0 silent gaps.

**Focus order:** `selector`, `head-pin`, `anchor-file`.
**A11y:** WCAG-2.2-AA, min_contrast 6.47.

```json
{ "screen_id": "SCR-RealmAudit", "flows": ["verify-chain", "pin-head", "verify-anchor"], "states": ["default", "loading", "error.chain-break", "error.validation", "empty.no-files", "success"], "components": [{ "ref": "ds/AuditVerdict@1.0", "props": { "exitCodes": [0, 1, 2] } }, { "ref": "ds/AuditRow@1.0", "props": { "dispositions": ["satisfied", "carried", "superseded"] } }], "a11y": { "target": "WCAG-2.2-AA", "focus_order": ["selector", "head-pin", "anchor-file"], "min_contrast": 6.47 }, "tokens_version": "1.0.0", "fidelity": "lofi", "provisional": true, "acceptance_refs": ["AC-10", "AC-18", "AC-30"] }
```

## SCR-RealmCheckpoint — `realm checkpoint create|restore`

**Question:** can I snapshot the workspace and get every byte back?
**Flows:** snapshot, restore, verify-bytes.
**Layout:**

```
┌─ [ds/CheckpointPanel] id + files + digests ─┐
```

- `default`: `checkpoint <id>: K files`; restore refuses unsafe paths with one error.
- `loading`: `checkpoint: writing…`.
- `error.daemon-silent`: `REALM_NOT_ACTIVE` before anything is written.
- `empty.no-checkpoint`: `no checkpoint <id>` (not a restore of nothing).
- `success`: byte-for-byte restore stated (deletion restored, extras removed).

**Focus order:** `workspace`, `checkpoint-id`, `mode`.
**A11y:** WCAG-2.2-AA, min_contrast 6.47.

```json
{ "screen_id": "SCR-RealmCheckpoint", "flows": ["snapshot", "restore", "verify-bytes"], "states": ["default", "loading", "error.daemon-silent", "error.validation", "empty.no-checkpoint", "success"], "components": [{ "ref": "ds/CheckpointPanel@1.0", "props": { "byteExact": true } }], "a11y": { "target": "WCAG-2.2-AA", "focus_order": ["workspace", "checkpoint-id", "mode"], "min_contrast": 6.47 }, "tokens_version": "1.0.0", "fidelity": "lofi", "provisional": true, "acceptance_refs": ["AC-24", "AC-25", "AC-26"] }
```

## SCR-RealmMetrics — `realm metrics`

**Question:** what are the counters and timings right now?
**Flows:** read-counters, check-timings.
**Layout:** table of `counter | value | window`; daemon-absent → `REALM_NOT_ACTIVE` line.

- `default`: tool-call / transition / attach counts over control socket (AC-20).
- `loading`: `metrics: reading…`.
- `error.daemon-absent`: `realm metrics: daemon absent (REALM_NOT_ACTIVE)`.
- `empty.no-session`: `no session for <ws>`.
- `success`: values + `0 network listeners` line (AC-20).

**Focus order:** `workspace`, `query`.
**A11y:** WCAG-2.2-AA, min_contrast 6.47.

```json
{ "screen_id": "SCR-RealmMetrics", "flows": ["read-counters", "check-timings"], "states": ["default", "loading", "error.daemon-absent", "error.validation", "empty.no-session", "success"], "components": [{ "ref": "ds/MetricTable@1.0", "props": { "unit": "count" } }], "a11y": { "target": "WCAG-2.2-AA", "focus_order": ["workspace", "query"], "min_contrast": 6.47 }, "tokens_version": "1.0.0", "fidelity": "lofi", "provisional": true, "acceptance_refs": ["AC-20"] }
```

## SCR-OmpGuard — Omp extension (Realm tools through Omp)

**Question:** what will the model be allowed to do, and what was refused?
**Flows:** issue-write, refuse-write, advisory-warning.
**Layout (Omp tool panel / transcript):**

```
┌─ [ds/ModeBanner] fail-closed|advisory ─┐
│ [ds/ToolList] exec read write list status│
│ [ds/RefusalCard] CODE + reason + next    │
└───────────────────────────────────────────┘
```

- `default`: tool list shows exactly 5 Realm tools (`exec`, `read`, `write`, `list`, `status`) with frozen `ToolCall` shape; `realm-retry` noted; 0 glob tools (AC-14).
- `loading`: `omp: starting run…`.
- `error.refused`: catalogue code + reason + next action; bash refused in fail-closed with 1 catalogue code (AC-15); unreachable-daemon control separate from native C4 CREATE (AC-2).
- `empty.tool-list`: mode with 0 tools is stated, not blank.
- `success`: bytes landed in sandbox `/workspace` + host root; audit admission+result share correlation id (AC-17).
- Advisory mode: every-invocation warning shown on reachable-inactive writes (AC-2); registered read/write displace built-ins by name (AC-16). Harness spike table (AC-4) answers the 3 enforcement questions with Omp version; warm-trace result (AC-3) lists 0 external / 0 DNS / 0 offenders; harness records 1 Omp version string (AC-1).

**Focus order:** `tool-name`, `mode-banner`, `refusal-message`.
**A11y:** WCAG-2.2-AA, min_contrast 6.47.

```json
{ "screen_id": "SCR-OmpGuard", "flows": ["issue-write", "refuse-write", "advisory-warning"], "states": ["default", "loading", "error.refused", "error.validation", "empty.tool-list", "success"], "components": [{ "ref": "ds/ModeBanner@1.0", "props": { "modes": ["fail-closed", "advisory"] } }, { "ref": "ds/ToolList@1.0", "props": { "tools": ["exec", "read", "write", "list", "status"] } }, { "ref": "ds/RefusalCard@1.0", "props": { "needsNextAction": true } }], "a11y": { "target": "WCAG-2.2-AA", "focus_order": ["tool-name", "mode-banner", "refusal-message"], "min_contrast": 6.47 }, "tokens_version": "1.0.0", "fidelity": "lofi", "provisional": true, "acceptance_refs": ["AC-1", "AC-2", "AC-3", "AC-4", "AC-14", "AC-15", "AC-16", "AC-17"] }
```

## SCR-CiGates — CI / gate board (docs view of gates)

**Question:** is this PR green on every gate, or exactly which gate is red?
**Flows:** view-gates, check-greptile, merge.
**Layout:**

```
┌─ [ds/GateBoard] 8 gates × pass|fail + Greptile x/5 ┐
```

- `default`: 8 gates `typecheck lint test build check:docs check:gates check:pack check:mcp` each pass/fail in text; CI Node 22.x/24.x shown separately.
- `loading`: `gates: running`.
- `error.gate-fail`: failing gate named + `BELOW` metric for coverage floor (AC-7) / named missing file for pack-smoke (AC-6).
- `empty.no-run`: `no gate run for this ref`.
- `success`: `5 of 5` Greptile + squash merge record; 0 version/CHANGELOG lines edited by PR (AC-31).
- Quality provenance: audit flags + dependabot coverage (AC-5); fake-clock seams + scaled waits (AC-8); property/mutation scope (AC-9).

**Focus order:** `gate-list`, `greptile-verdict`, `merge-record`.
**A11y:** WCAG-2.2-AA, min_contrast 6.47.

```json
{ "screen_id": "SCR-CiGates", "flows": ["view-gates", "check-greptile", "merge"], "states": ["default", "loading", "error.gate-fail", "error.validation", "empty.no-run", "success"], "components": [{ "ref": "ds/GateBoard@1.0", "props": { "gates": ["typecheck", "lint", "test", "build", "check-docs", "check-gates", "check-pack", "check-mcp"] } }], "a11y": { "target": "WCAG-2.2-AA", "focus_order": ["gate-list", "greptile-verdict", "merge-record"], "min_contrast": 6.47 }, "tokens_version": "1.0.0", "fidelity": "lofi", "provisional": true, "acceptance_refs": ["AC-5", "AC-6", "AC-7", "AC-8", "AC-9", "AC-31"] }
```

## SCR-OnboardingDocs — docs / README / site pages

**Question:** can a new operator go from clone to `realm up` unaided?
**Flows:** first-run, configure, operate.
**Layout (docs page):** nav → H1 → numbered steps → code blocks (terminal surface) → next.

- `default`: steps 1..N in order; every command in its own code block; code block uses `color.surface.terminal` + `color.surface.terminal-text`.
- `loading`: skeleton lines (`aria-busy`); code not yet present.
- `error.not-found`: `page not found` + bounce links (never a dead end).
- `empty.no-results`: search with 0 hits states `0 results` + suggested terms.
- `success`: complete install→up path on one page.
- Every catalogue-enumerating table/doc/test includes the gateway-or-driver-loss code (AC-21); enforcement table states 3 answers + Omp version (AC-4).

**Focus order:** `nav`, `heading`, `code-block`, `action-link`.
**A11y:** WCAG-2.2-AA; heading/structure per a11y sheet; min_contrast 6.47.

```json
{ "screen_id": "SCR-OnboardingDocs", "flows": ["first-run", "configure", "operate"], "states": ["default", "loading", "error.not-found", "error.validation", "empty.no-results", "success"], "components": [{ "ref": "ds/DocSteps@1.0", "props": { "numbered": true } }, { "ref": "ds/CodeBlock@1.0", "props": { "surface": "terminal" } }], "a11y": { "target": "WCAG-2.2-AA", "focus_order": ["nav", "heading", "code-block", "action-link"], "min_contrast": 6.47 }, "tokens_version": "1.0.0", "fidelity": "lofi", "provisional": true, "acceptance_refs": ["AC-4", "AC-21", "AC-30"] }
```

## SCR-ReleaseProvenance — release workflow view

**Question:** is this artifact attested, and how do I roll back?
**Flows:** publish, attest, rollback.
**Layout:** release tag → checksums → attestation → rollback target.

- `default`: tag + SHA256SUMS + SBOM + attestation status in text.
- `loading`: `release: building…`.
- `error.attestation`: `gh attestation verify` failure named.
- `empty.no-release`: `no release for this ref`.
- `success`: verified tarball; test release marked prerelease; docs rebuilt from known-good tag; 0 tag/asset/main changes (AC-28); changelog excludes removed-feature commits (AC-29); permissions: build contents-read-only, publish 4 write grants, 0 npm install/build/pack in publish (AC-27).

**Focus order:** `release-tag`, `attestation`, `rollback`.
**A11y:** WCAG-2.2-AA, min_contrast 6.47.

```json
{ "screen_id": "SCR-ReleaseProvenance", "flows": ["publish", "attest", "rollback"], "states": ["default", "loading", "error.attestation", "error.validation", "empty.no-release", "success"], "components": [{ "ref": "ds/ProvenanceList@1.0", "props": { "artifacts": ["tarball", "SHA256SUMS", "SBOM"] } }], "a11y": { "target": "WCAG-2.2-AA", "focus_order": ["release-tag", "attestation", "rollback"], "min_contrast": 6.47 }, "tokens_version": "1.0.0", "fidelity": "lofi", "provisional": true, "acceptance_refs": ["AC-27", "AC-28", "AC-29"] }
```

## SCR-LinearGsd — Linear / GSD tracking UX

**Question:** what phase is this, what is blocked, and who unblocks it?
**Flows:** create-issue, track-phase, audit-milestone.
**Layout (issue):**

```
┌─ [ds/IssueHeader] 1-line title, phase id ──┐
│ [ds/AgentNotes] +++ Agent notes … +++        │
│ [ds/SubIssueList] 1 per plan/requirement    │
│ [ds/BlockedNotice] owner decision, default   │
└──────────────────────────────────────────────┘
```

- `default`: title 1 short line naming phase (e.g. `Phase 12: scripted harness and spike`); detail in 1 collapsible `+++ Agent notes` section with phase id, plan ids, requirement ids, AC counts.
- `loading`: `loading issue…`.
- `error.duplicate`: duplicate-scan hit states existing issue id; creation refused (never a second issue per phase, AC-32).
- `empty.no-match`: 0 matches → create once, with issue shape above.
- `success`: 1 issue per phase (8 issues), 1 sub-issue per plan or per requirement when >4 ids; links verified.
- STATE/ROADMAP readability: phase order stated (Omp 12→16; runtime 14→17→18→19; pipeline 13→20); progress as counts, not bars alone.
- Verification visibility: audit row per requirement (satisfied/carried/superseded) with evidence links (AC-30).
- **Blocked-by-owner presentation:** `ds/BlockedNotice` block: `BLOCKED — owner decision required: <question>. Decider: <owner>. Unblocks when: <ruling>. Default until then: <fail-closed behavior>. Status: <counts> unverified.` Blocked is visually distinct (text + border, not green/red alone), never counted as pass. Dirty-tree note: `dirty tree preserved; no overwrite` where relevant.

**Focus order:** `issue-title`, `agent-notes`, `sub-issue-list`, `state-roadmap`.
**A11y:** WCAG-2.2-AA, min_contrast 6.47.

```json
{ "screen_id": "SCR-LinearGsd", "flows": ["create-issue", "track-phase", "audit-milestone"], "states": ["default", "loading", "error.duplicate", "error.validation", "empty.no-match", "success"], "components": [{ "ref": "ds/IssueHeader@1.0", "props": { "oneLineTitle": true } }, { "ref": "ds/AgentNotes@1.0", "props": { "collapsible": "+++ Agent notes" } }, { "ref": "ds/BlockedNotice@1.0", "props": { "neverGreen": true } }], "a11y": { "target": "WCAG-2.2-AA", "focus_order": ["issue-title", "agent-notes", "sub-issue-list", "state-roadmap"], "min_contrast": 6.47 }, "tokens_version": "1.0.0", "fidelity": "lofi", "provisional": true, "acceptance_refs": ["AC-30", "AC-32"] }
```

## Motion (docs/site only; CLI has no animation)

| Name | Duration | Reduced-motion variant |
|---|---|---|
| disclosure-expand | 200 ms | instant (no expansion animation) |
| link-hover-fade | 150 ms | no fade (hover underline only) |

Bound: 5000 ms (SC 2.2.2 convention recorded in decisions; no motion tokens in file).

## Touch / target minima (docs/site)

Nav links and buttons: 44 px targets. Dense table links: meet the WCAG 2.2 SC 2.5.8 minimum (24 px height) via padding, or 12 px centre-to-nearest-edge clearance — see spec remediation (initial check `base:dense-table-link` 16 px/6 px failing → revised to 24 px height minimum). Changing layout can break spacing-exception-only passes; keep 44 px minimums for primary actions.

## Brand / tokens note

No brand guide supplied → system default theme only, `provisional: true`. No new graphical components are introduced; `ds/*` refs name text-output blocks in existing Realm surfaces (spec L2). Breaking token changes or a brand change would be L3 and must stop for human approval.

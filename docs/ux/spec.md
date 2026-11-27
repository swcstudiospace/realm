# UX Spec — Realm Operator Surfaces (v3.0 + v9.0 addendum, tokens 1.1.0)

**Task:** `Ta08e-ux` · **Correlation:** `a08e7d90-26e9-4f01-b9be-b3421a4b41e0` · **Capability:** `ux.spec`
**Fidelity:** lofi (ASCII wireframes; no Figma tool available) · **Provisional:** true (no brand guide; system default theme only; no brand values invented)
**Scope:** CLI/daemon/Omp-extension operator surfaces, onboarding docs, Linear/GSD tracking UX, plus the v9.0 addendum surfaces: start-error diagnostics (US-111), the Omp plugin toggle (US-112), Realm status merged into the additional UI region (US-113), the release-line quality bar (US-114) and v9.0 phase evidence (US-115..US-121). Realm is not a marketing site; every screen below is a text-first operator surface where color is never the sole cue.
**Tokens:** `docs/ux/tokens.json` v1.1.0 · **A11y sheet:** `docs/ux/a11y.md`

## Design principles (binding on all screens)

1. **Text first, color second.** Every status shows a text label. Color from `color.status.*` may reinforce a label but must never be the sole means of conveying it (NFR-A1). Monochrome/NO_COLOR/piped output preserves the label and its shape cue.
2. **Codes are the contract.** `realm <cmd>` exits 0 (success), 1 (catalogue-coded failure), 2 (usage error). stdout carries the catalogue code or result; stderr carries human reason, never env values or tokens (see A04 security: synthetic fixtures only).
3. **Fail closed visibly.** A disconnected/unreachable realm refuses with `REALM_NOT_ACTIVE` and 0 host files. The refusal is announced, never silent (AC-12, AC-15).
4. **Blocked is not failed.** Owner-blocked work (e.g. HARN-03) shows an explicit blocked block; it is never rendered green, pass, or a pass-adjacent tone. See `ds/BlockedNotice`.
5. **No dark patterns.** No fake urgency, hidden costs, or loss-framed copy. Copy states facts: what happened, what it means, what to do next.
6. **Locale-stable codes.** Result codes match the frozen catalogue in `C`/`en_US`; operator text is English; no code path parses locale-formatted numbers (NFR-I1). Long ids wrap; nothing truncates into ambiguity.
7. **A control is a surface, not a color.** The Omp plugin toggle state is always a text line (`on`/`off` plus its effect: tool count and status visibility), never position or color alone. Turning the plugin off removes tools and paints entirely (0 tools, 0 paints) and never leaves behind stale truth.

## Required state families (every screen)

Default, loading, error, empty, success — specified per screen below as dotted sub-states (`error.*`, `empty.*`). A screen without all five families is not publishable.

## AC trace (every screen cites acceptance ids; orphans unpublishable)

| Screen | AC refs |
|---|---|
| SCR-RealmStatus | AC-11, AC-12, AC-13, AC-15, AC-21, AC-23, AC-24 |
| SCR-RealmLifecycle | AC-14, AC-16, AC-17, AC-22, AC-25 |
| SCR-RealmStartDiag | AC-33, AC-34, AC-35 |
| SCR-RealmDoctor | AC-19, AC-20, AC-45, AC-46, AC-47 |
| SCR-RealmAudit | AC-10, AC-18, AC-30 |
| SCR-RealmCheckpoint | AC-24, AC-25, AC-26 |
| SCR-RealmMetrics | AC-20 |
| SCR-OmpGuard | AC-1, AC-2, AC-3, AC-4, AC-14, AC-15, AC-16, AC-17 |
| SCR-OmpPluginToggle | AC-36, AC-37, AC-38 |
| SCR-OmpAdditionalUi | AC-39, AC-40, AC-41 |
| SCR-CiGates | AC-5, AC-6, AC-7, AC-8, AC-9, AC-31, AC-42, AC-43, AC-44, AC-62, AC-63, AC-64 |
| SCR-OnboardingDocs | AC-4, AC-21, AC-30 |
| SCR-ReleaseProvenance | AC-27, AC-28, AC-29 |
| SCR-LinearGsd | AC-30, AC-32, AC-59, AC-60, AC-61 |
| SCR-PhaseEvidence | AC-48, AC-49, AC-50, AC-51, AC-52, AC-53, AC-54, AC-55, AC-56, AC-57, AC-58 |
| SCR-UltrathinkPlanAdvisory | AC-65, AC-66, AC-67, AC-71, AC-72, AC-73 |
| SCR-UltrathinkReloadResume | AC-68, AC-69, AC-70 |
| SCR-Tb559ResumeVerify | AC-74, AC-75, AC-76, AC-77, AC-82, AC-83, AC-84, AC-85 |
| SCR-Tb559W3Matrix | AC-78, AC-79, AC-80, AC-81 |
| SCR-SecSplitFixture | AC-86, AC-87, AC-88 |
| SCR-Merge256Gate | AC-89, AC-90, AC-91 |
| SCR-R3W3Closeout | AC-92, AC-93, AC-94, AC-95, AC-96 |
| SCR-QualityBaselineBoard | AC-97, AC-98, AC-99, AC-100, AC-101, AC-102 |
| SCR-LinearContinuationBoard | AC-103, AC-104, AC-105 |
| SCR-GateEnforcementBoard | AC-106, AC-107, AC-108 |
| SCR-DocsShipBoard | AC-109, AC-110, AC-111, AC-112, AC-113 |

Coverage: AC-1..AC-113 all referenced at least once (overlaps are intentional where two surfaces show the same fact).

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
{ "screen_id": "SCR-RealmStatus", "flows": ["check-readiness", "confirm-notice", "diagnose-loss"], "states": ["default", "loading", "error.daemon-absent", "error.validation", "empty.no-sessions", "success"], "components": [{ "ref": "ds/StatusReadout@1.0", "props": { "labels": ["ACTIVE", "DISCONNECTED"] } }, { "ref": "ds/NoticeBanner@1.0", "props": { "neverSilent": true } }], "a11y": { "target": "WCAG-2.2-AA", "focus_order": ["workspace-selector", "status-query", "notice-area"], "min_contrast": 6.47 }, "tokens_version": "1.1.0", "fidelity": "lofi", "provisional": true, "acceptance_refs": ["AC-11", "AC-12", "AC-13", "AC-15", "AC-21", "AC-23", "AC-24"] }
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

Per-project isolation is visible: two sandboxes `realm-<sessionId>` named; a write in one is stated invisible in the other (AC-22). Advisory vs fail-closed: registered-write warning shown every invocation in advisory (AC-16); fail-closed refuses with catalogue code + guard backstop (AC-15). Start-failure diagnostics (stale `workspaceRoot`, missing build output) are specified on SCR-RealmStartDiag; this screen only links to them.
**Focus order:** `workspace`, `image-digest`.
**A11y:** WCAG-2.2-AA, min_contrast 6.47.

```json
{ "screen_id": "SCR-RealmLifecycle", "flows": ["start-sandbox", "stop-sandbox", "initialize"], "states": ["default", "loading", "error.policy", "error.not-active", "empty.no-workspace", "success"], "components": [{ "ref": "ds/LifecycleSteps@1.0", "props": { "steps": ["init", "up", "down"] } }, { "ref": "ds/StatusReadout@1.0", "props": { "labels": ["ACTIVE", "DISCONNECTED"] } }], "a11y": { "target": "WCAG-2.2-AA", "focus_order": ["workspace", "image-digest"], "min_contrast": 6.47 }, "tokens_version": "1.1.0", "fidelity": "lofi", "provisional": true, "acceptance_refs": ["AC-14", "AC-16", "AC-17", "AC-22", "AC-25"] }
```

## SCR-RealmStartDiag — start-error diagnostics (`realm up` failures, US-111)

**Question:** why did start fail, and what is the single remedy?
**Flows:** start-realm, diagnose-start-error, read-diagnostic.
**Layout (CLI):**

```
┌─ [ds/StatusReadout] DISCONNECTED ─────────────┐
│ [ds/NoticeBanner diagnostic]                     │
│ CODE — <what happened>                           │
│ cause: <one named cause; one path when path-bound> │
│ remedy: <one action>                             │
└──────────────────────────────────────────────────┘
```

- `default`: `DISCONNECTED` + diagnostic card naming exactly 1 catalogue code, 1 named cause (with exactly 1 path when the cause is a path) and 1 remedy.
- `loading`: `up: starting daemon (≤200s budget)…` with elapsed (START budget unchanged; this surface never waits silently).
- `error.policy-denied` (stale stored path): `POLICY_DENIED — workspace root does not exist: <path>` + remedy `point workspaceRoot at an existing directory, or start from an existing workspace (realm up --workspace <path>)` (AC-34). The path printed is the observed stored path, named so the operator can fix it; config contents, secrets and env values are never echoed.
- `error.module-not-found` (stale build): `ERR_MODULE_NOT_FOUND — <module> missing from the build` + remedy `npm run build, then retry` (AC-33, AC-35). A fresh-build start prints 0 such errors and a readable audit chain head (`empty.clean-start`, below); the historical `dist/src/audit/chain.js` case is therefore closed by absence, not by a special message.
- `empty.clean-start`: fresh build + an existing configured workspace → no diagnostic card at all; `ACTIVE` + container id + audit head stated (no module-load errors occurred).
- `success`: `ACTIVE` with 1 container and 0 `ERR_MODULE_NOT_FOUND` errors (AC-33).

Copy rules: the diagnostic always names exactly 1 path and 1 remedy when a start failure remains unrepaired (task acceptance (a)); it never prints a raw stack, a config dump or a daemon log path. The card is one `ds/NoticeBanner` — not a second competing banner — so exactly one label is shown.
**Components:** `ds/StatusReadout@1.0`, `ds/NoticeBanner@1.0` (diagnostic card: code + cause + remedy).
**Focus order:** `workspace-selector`, `start-action`, `diagnostic-area`.
**A11y:** target WCAG-2.2-AA; min_contrast 6.47.

```json
{ "screen_id": "SCR-RealmStartDiag", "flows": ["start-realm", "diagnose-start-error", "read-diagnostic"], "states": ["default", "loading", "error.policy-denied", "error.module-not-found", "empty.clean-start", "success"], "components": [{ "ref": "ds/StatusReadout@1.0", "props": { "labels": ["ACTIVE", "DISCONNECTED"] } }, { "ref": "ds/NoticeBanner@1.0", "props": { "neverSilent": true } }], "a11y": { "target": "WCAG-2.2-AA", "focus_order": ["workspace-selector", "start-action", "diagnostic-area"], "min_contrast": 6.47 }, "tokens_version": "1.1.0", "fidelity": "lofi", "provisional": true, "acceptance_refs": ["AC-33", "AC-34", "AC-35"] }
```

## SCR-RealmDoctor — `realm doctor [--fix [--dry-run]]`

**Question:** what is wrong with this machine/workspace, and what would a fix change?
**Flows:** run-checks, apply-fix, verify-fix.
**Layout:**

```
┌─ [ds/CheckList] ✓/✗ + id + remedy ┐
└─ [ds/FixPreview] would-apply…      ┘
```

- `default`: check rows `pass|fail` in text (never color-only) + remedy line per failure.
- `loading`: `doctor: running N local checks…`.
- `error.daemon-absent`: JSON checks to stdout + `daemon absent (REALM_NOT_ACTIVE); ran N local checks` to stderr (machine + human lines).
- `empty`: no checks configured → `no checks` text (not blank).
- `success`: all pass; `--fix --dry-run` prints `would <kind> <path> to 0700` and changes nothing; `--fix` applies safe fixes only.
- Counters/timings readable over control socket (AC-20) are linked from doctor output (`metrics` pointer).
- **Plugin health rows (US-115):** one row per failing case — `not installed`, `wrong version`, `not loaded` — each reading `fail` + exactly 1 named remedy, with 0 installs or removals performed (AC-46); the healthy case reads `pass` + 1 installed version (AC-45). The Omp lifecycle runbook maps the 3 outcomes to remedies with dated evidence and 0 foreign-process steps (AC-47; runbook table lives in `docs/integration/omp.md`, this screen links it).

**Focus order:** `workspace`, `fix-mode`, `dry-run`.
**A11y:** WCAG-2.2-AA, min_contrast 6.47.

```json
{ "screen_id": "SCR-RealmDoctor", "flows": ["run-checks", "apply-fix", "verify-fix"], "states": ["default", "loading", "error.daemon-absent", "error.validation", "empty.no-checks", "success"], "components": [{ "ref": "ds/CheckList@1.0", "props": { "verdicts": ["pass", "fail"] } }, { "ref": "ds/FixPreview@1.0", "props": { "dryRunFirst": true } }], "a11y": { "target": "WCAG-2.2-AA", "focus_order": ["workspace", "fix-mode", "dry-run"], "min_contrast": 6.47 }, "tokens_version": "1.1.0", "fidelity": "lofi", "provisional": true, "acceptance_refs": ["AC-19", "AC-20", "AC-45", "AC-46", "AC-47"] }
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
{ "screen_id": "SCR-RealmAudit", "flows": ["verify-chain", "pin-head", "verify-anchor"], "states": ["default", "loading", "error.chain-break", "error.validation", "empty.no-files", "success"], "components": [{ "ref": "ds/AuditVerdict@1.0", "props": { "exitCodes": [0, 1, 2] } }, { "ref": "ds/AuditRow@1.0", "props": { "dispositions": ["satisfied", "carried", "superseded"] } }], "a11y": { "target": "WCAG-2.2-AA", "focus_order": ["selector", "head-pin", "anchor-file"], "min_contrast": 6.47 }, "tokens_version": "1.1.0", "fidelity": "lofi", "provisional": true, "acceptance_refs": ["AC-10", "AC-18", "AC-30"] }
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
{ "screen_id": "SCR-RealmCheckpoint", "flows": ["snapshot", "restore", "verify-bytes"], "states": ["default", "loading", "error.daemon-silent", "error.validation", "empty.no-checkpoint", "success"], "components": [{ "ref": "ds/CheckpointPanel@1.0", "props": { "byteExact": true } }], "a11y": { "target": "WCAG-2.2-AA", "focus_order": ["workspace", "checkpoint-id", "mode"], "min_contrast": 6.47 }, "tokens_version": "1.1.0", "fidelity": "lofi", "provisional": true, "acceptance_refs": ["AC-24", "AC-25", "AC-26"] }
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
{ "screen_id": "SCR-RealmMetrics", "flows": ["read-counters", "check-timings"], "states": ["default", "loading", "error.daemon-absent", "error.validation", "empty.no-session", "success"], "components": [{ "ref": "ds/MetricTable@1.0", "props": { "unit": "count" } }], "a11y": { "target": "WCAG-2.2-AA", "focus_order": ["workspace", "query"], "min_contrast": 6.47 }, "tokens_version": "1.1.0", "fidelity": "lofi", "provisional": true, "acceptance_refs": ["AC-20"] }
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
- Plugin on/off counts here describe the plugin-on case; the off case (0 tools) is specified on SCR-OmpPluginToggle.

**Focus order:** `tool-name`, `mode-banner`, `refusal-message`.
**A11y:** WCAG-2.2-AA, min_contrast 6.47.

```json
{ "screen_id": "SCR-OmpGuard", "flows": ["issue-write", "refuse-write", "advisory-warning"], "states": ["default", "loading", "error.refused", "error.validation", "empty.tool-list", "success"], "components": [{ "ref": "ds/ModeBanner@1.0", "props": { "modes": ["fail-closed", "advisory"] } }, { "ref": "ds/ToolList@1.0", "props": { "tools": ["exec", "read", "write", "list", "status"] } }, { "ref": "ds/RefusalCard@1.0", "props": { "needsNextAction": true } }], "a11y": { "target": "WCAG-2.2-AA", "focus_order": ["tool-name", "mode-banner", "refusal-message"], "min_contrast": 6.47 }, "tokens_version": "1.1.0", "fidelity": "lofi", "provisional": true, "acceptance_refs": ["AC-1", "AC-2", "AC-3", "AC-4", "AC-14", "AC-15", "AC-16", "AC-17"] }
```

## SCR-OmpPluginToggle — optional Omp plugin toggle (US-112)

**Question:** is the Realm plugin on, and what does turning it off do?
**Flows:** view-toggle, turn-off, turn-on, restart-persistence.
**Layout (Omp plugin settings row; host-owned placement):**

```
┌─ [ds/ModeBanner] Realm plugin: on — 5 tools ─┐
│ [ds/ToolList] exec read write list status       │
│ plugin toggle: [ switch 48×28 ] default: on     │
└─────────────────────────────────────────────────┘
```

- `default`: toggle drawn on; text line `Realm plugin on — 5 tools registered` (AC-36). Switch track uses `color.toggle.track-on`, thumb `color.surface.terminal-text`; target 48×28 px with 24 px clearance to its nearest neighbor (SC 2.5.8; measured `compliant: true` — see a11y sheet). Focus ring uses `color.focus.ring` (≥3:1 on every surface this row can sit on).
- `loading`: `realm: loading plugin…` — the row itself never blocks the session.
- `error.invalid-setting`: a stored value outside `on`/`off` → `SCHEMA_INVALID — plugin toggle must be on or off` + remedy `set the plugin toggle to on`. Only two states exist; the surface never invents a third.
- `empty.no-setting`: no stored setting → treated as on (default-on, AC-36); the row still draws the on state and the 5-tool line.
- `success`: toggle off → `Realm plugin off — 0 tools registered, status hidden` with 0 paints and 0 workspace mutations (AC-37); the off choice persists across 1 restart (AC-38). Turning the plugin off never sends `up`/`down` and never touches the sandbox.

Copy rules (principle 7): state is always a text line, never position or color alone. The toggle is orthogonal to `reattach.enabled` (`REALM_OMP_REATTACH` copy on SCR-OmpGuard is unchanged); toggling the plugin does not flip re-attach. Off-path hermetic-first: the toggle-off row (`0 tools`, `0 paints`, `0 mutations`) must be provable on injected fakes before any live window (AC-37).
**Components:** `ds/ModeBanner@1.0` (toggle state + effect line), `ds/ToolList@1.0` (5 tools | 0 tools), `ds/NoticeBanner@1.0` (persistence note: survives restart).
**Focus order:** `plugin-toggle`, `toggle-status-note`, `default-restore`.
**A11y:** target WCAG-2.2-AA; min_contrast 6.19 (widget-surface pairs this run; see a11y sheet).

```json
{ "screen_id": "SCR-OmpPluginToggle", "flows": ["view-toggle", "turn-off", "turn-on", "restart-persistence"], "states": ["default", "loading", "error.invalid-setting", "empty.no-setting", "success"], "components": [{ "ref": "ds/ModeBanner@1.0", "props": { "states": ["on", "off"] } }, { "ref": "ds/ToolList@1.0", "props": { "tools": ["exec", "read", "write", "list", "status"] } }, { "ref": "ds/NoticeBanner@1.0", "props": { "persistence": "restart" } }], "a11y": { "target": "WCAG-2.2-AA", "focus_order": ["plugin-toggle", "toggle-status-note", "default-restore"], "min_contrast": 6.19 }, "tokens_version": "1.1.0", "fidelity": "lofi", "provisional": true, "acceptance_refs": ["AC-36", "AC-37", "AC-38"] }
```

## SCR-OmpAdditionalUi — Realm status merged into the additional UI region (US-113)

**Question:** what is the realm state right now, without the under-bar status slot?
**Flows:** read-status, follow-connecting, check-truth, retry.
**Layout (widget strip rendered by the Omp host above or below the editor; placement and region key are host-owned, content is Realm's):**

```
┌─ [ds/StatusReadout] realm widget region (role=status) ┐
│ ● realm active · container running · <time>            │
│ · applied mode: fail-closed (Omp host-tool guard; …)   │
└────────────────────────────────────────────────────────┘
```

- `default`: the region is painted with 1 text item and 1 label per paint (AC-39); 0 calls reach `ctx.ui.setStatus(REALM_STATUS_KEY)` — the under-bar slot is never used after the merge. `adapters/omp/index.js` gains no realm logic; it stays the host shim.
- `loading`: `○ realm disconnected · connecting · <time> · mode: unknown` — the connecting member of the 4 truthful daemon states (AC-40).
- `error.disconnected`: `○ realm disconnected · <reason> · <time> · last successfully applied mode: …` (unbound/stopping/error map to the disconnected label, exactly as today).
- `error.connecting`: the same connecting paint while an attach/re-attach is in flight, including the reconnect catalogue code when one is shown.
- `error.refused`: `○ realm disconnected · <CATALOGUE_CODE> · <time> · <mode disclosure>` — refused up etc. painted in the widget with the same rendering as the old status item (4-state truthfulness, AC-40).
- `empty.toggle-off`: plugin toggle off → 0 paints occur and the last truthful text remains on screen unchanged (AC-41). Off is not blank and not a fifth state.
- `success`: active paint: `● realm active · <reason> · <time> · applied mode: fail-closed (Omp host-tool guard; not host process containment)` (or `applied mode: advisory` in advisory) — the mode disclosure is retained verbatim (P5-D5 one-item rule; never two competing labels).

Truthfulness rules: text shape is byte-identical to today's under-bar text `<marker> <label> · <reason> · <time> · <mode disclosure>` (labels `realm active`/`realm disconnected` from `src/core/status.ts`); painted text matches the daemon snapshot in 4 of 4 states (AC-40). Identical status reads stay quiet (cache rule unchanged) and the 2 s poll cadence is unchanged — paint happens on change only. A11y: the region is `role="status"`, `aria-live="polite"`, non-interactive (never in tab order); keyboard flow is editor → `realm-retry`. Widget surface uses `color.surface.widget` with `color.border.default` border; text on it passes AA (min 6.19 this run).
**Components:** `ds/StatusReadout@1.0` (widget body), `ds/ModeBanner@1.0` (mode disclosure line within the text item).
**Focus order:** `editor-input`, `realm-retry`.
**A11y:** target WCAG-2.2-AA; min_contrast 6.19.

```json
{ "screen_id": "SCR-OmpAdditionalUi", "flows": ["read-status", "follow-connecting", "check-truth", "retry"], "states": ["default", "loading", "error.disconnected", "error.connecting", "error.refused", "empty.toggle-off", "success"], "components": [{ "ref": "ds/StatusReadout@1.0", "props": { "labels": ["realm active", "realm disconnected"] } }, { "ref": "ds/ModeBanner@1.0", "props": { "modes": ["applied mode", "last successfully applied mode", "mode: unknown"] } }], "a11y": { "target": "WCAG-2.2-AA", "focus_order": ["editor-input", "realm-retry"], "min_contrast": 6.19 }, "tokens_version": "1.1.0", "fidelity": "lofi", "provisional": true, "acceptance_refs": ["AC-39", "AC-40", "AC-41"] }
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
- **Release line (US-114):** the same board on the 0.9.x line shows the 8 standard gates each exiting 0 with 0 failures (AC-42), CI green on Node 22.x and 24.x with 0 failed jobs (AC-43), and the vulnerability audit exiting 0 with 0 dependency drift from the baseline (AC-44).
- **Ship (US-121):** 11 of 11 verification checkboxes exit 0 with every template section completed (Summary, Requirements, Verification, Risk and rollback, Checklist) (AC-62); Greptile reports 5 of 5 with 0 open comments and 1 reviewer approval before merge (AC-63); the merge reads as 1 squash merge with 0 edited version fields and 0 CHANGELOG lines in the diff (AC-64).

**Focus order:** `gate-list`, `greptile-verdict`, `merge-record`.
**A11y:** WCAG-2.2-AA, min_contrast 6.47.

```json
{ "screen_id": "SCR-CiGates", "flows": ["view-gates", "check-greptile", "merge"], "states": ["default", "loading", "error.gate-fail", "error.validation", "empty.no-run", "success"], "components": [{ "ref": "ds/GateBoard@1.0", "props": { "gates": ["typecheck", "lint", "test", "build", "check-docs", "check-gates", "check-pack", "check-mcp"] } }], "a11y": { "target": "WCAG-2.2-AA", "focus_order": ["gate-list", "greptile-verdict", "merge-record"], "min_contrast": 6.47 }, "tokens_version": "1.1.0", "fidelity": "lofi", "provisional": true, "acceptance_refs": ["AC-5", "AC-6", "AC-7", "AC-8", "AC-9", "AC-31", "AC-42", "AC-43", "AC-44", "AC-62", "AC-63", "AC-64"] }
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
- Start-error diagnostics (stale `workspaceRoot` → `POLICY_DENIED` + path + remedy) are documented in the runbook section on SCR-RealmStartDiag; this page links that section instead of repeating the copy.

**Focus order:** `nav`, `heading`, `code-block`, `action-link`.
**A11y:** WCAG-2.2-AA; heading/structure per a11y sheet; min_contrast 6.47.

```json
{ "screen_id": "SCR-OnboardingDocs", "flows": ["first-run", "configure", "operate"], "states": ["default", "loading", "error.not-found", "error.validation", "empty.no-results", "success"], "components": [{ "ref": "ds/DocSteps@1.0", "props": { "numbered": true } }, { "ref": "ds/CodeBlock@1.0", "props": { "surface": "terminal" } }], "a11y": { "target": "WCAG-2.2-AA", "focus_order": ["nav", "heading", "code-block", "action-link"], "min_contrast": 6.47 }, "tokens_version": "1.1.0", "fidelity": "lofi", "provisional": true, "acceptance_refs": ["AC-4", "AC-21", "AC-30"] }
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
{ "screen_id": "SCR-ReleaseProvenance", "flows": ["publish", "attest", "rollback"], "states": ["default", "loading", "error.attestation", "error.validation", "empty.no-release", "success"], "components": [{ "ref": "ds/ProvenanceList@1.0", "props": { "artifacts": ["tarball", "SHA256SUMS", "SBOM"] } }], "a11y": { "target": "WCAG-2.2-AA", "focus_order": ["release-tag", "attestation", "rollback"], "min_contrast": 6.47 }, "tokens_version": "1.1.0", "fidelity": "lofi", "provisional": true, "acceptance_refs": ["AC-27", "AC-28", "AC-29"] }
```

## SCR-LinearGsd — Linear / GSD tracking UX (incl. Notion hub, US-120)

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
- **Notion hub (US-120):** 1 Notion page per phase 55..59 (5 pages), each linking its phase id and status (AC-59); Notion is the hub — each phase page links its Linear issue and each Linear issue links back to its Notion page by id (AC-61). The Linear workspace holds 5 issues with 0 duplicates, each linking 1 phase id, ≥1 plan id and ≥1 requirement id, plus 1 sub-issue per plan (AC-60). Duplicate scans run before creation and reuse an existing issue when a phase title already exists.
- **Blocked-by-owner presentation:** `ds/BlockedNotice` block: `BLOCKED — owner decision required: <question>. Decider: <owner>. Unblocks when: <ruling>. Default until then: <fail-closed behavior>. Status: <counts> unverified.` Blocked is visually distinct (text + border, not green/red alone), never counted as pass. Dirty-tree note: `dirty tree preserved; no overwrite` where relevant.

**Focus order:** `issue-title`, `agent-notes`, `sub-issue-list`, `state-roadmap`.
**A11y:** WCAG-2.2-AA, min_contrast 6.47.

```json
{ "screen_id": "SCR-LinearGsd", "flows": ["create-issue", "track-phase", "audit-milestone"], "states": ["default", "loading", "error.duplicate", "error.validation", "empty.no-match", "success"], "components": [{ "ref": "ds/IssueHeader@1.0", "props": { "oneLineTitle": true } }, { "ref": "ds/AgentNotes@1.0", "props": { "collapsible": "+++ Agent notes" } }, { "ref": "ds/BlockedNotice@1.0", "props": { "neverGreen": true } }], "a11y": { "target": "WCAG-2.2-AA", "focus_order": ["issue-title", "agent-notes", "sub-issue-list", "state-roadmap"], "min_contrast": 6.47 }, "tokens_version": "1.1.0", "fidelity": "lofi", "provisional": true, "acceptance_refs": ["AC-30", "AC-32", "AC-59", "AC-60", "AC-61"] }
```

## SCR-PhaseEvidence — v9.0 phase close-out evidence (US-116..US-119, provisional)

**Question:** what has each v9.0 phase actually proven, and what is still human-blocking?
**Flows:** review-phase, check-cause, verify-ratification.
**Layout (evidence rows, one per phase; hermetic vs live proof kept apart):**

```
┌─ [ds/CheckList] Phase 56: cause codes 20/20, orphans 0 ─┐
│ [ds/AuditRow]   Phase 59: BLOCKED — ratification missing │
│                   0 implementation files landed           │
└───────────────────────────────────────────────────────────┘
```

- `default`: one row per phase (56/57/58/59) showing the phase's evidence headline plus its proof tier: hermetic vs live. Live rows never borrow a hermetic pass.
- `loading`: `loading phase evidence…`.
- `error.cause-unclear` (Phase 56): a dirty stop without a cause code renders `cause unclear` + the 1 tested carry reason, never folded into F-41-1 silently (AC-48, AC-49). Bounded waits (1 timeout each) and the orphan count are shown on the same row (AC-50).
- `error.ratification-missing` (Phase 59): `ds/BlockedNotice` reads `BLOCKED — 53-DESIGN not ratified; 0 implementation files land` (AC-56), visually distinct, never green.
- `empty.no-live-proof`: phases 56/57/58 read `live proof pending (human-blocking)` until the owner-run live window lands (AC-48, AC-51, AC-54); hermetic rows may read pass while the live row stays pending.
- `success`: closed rows with dated evidence — Phase 56: every dirty stop carries 1 failed-step cause code across 20 iterations, `failedTeardowns` 0; Phase 57: 1 audit line attributed `grok-build` with handshake and 6 tools (or GAP-40-01 accepted-residual naming 1 missing host feature + 1 verified workaround, AC-52); Phase 58: fixed recorder retains the 1 response the old code dropped, live rerun keeps 1 wire log + version/date (or KIMV-02 carried with 1 tested reason, GAP-43-03 label unchanged, AC-55); Phase 59 (only after dated ratification): 53-DESIGN section 4 surfaces with 1 new module, 2 path helpers, 0 new catalogue codes, 0 shims, 6 of 6 hermetic contention cases with stale takeover capped at 3 (AC-57, AC-58).

**Components:** `ds/CheckList@1.0`, `ds/AuditRow@1.0`, `ds/BlockedNotice@1.0`.
**Focus order:** `phase-selector`, `evidence-area`, `ratification-link`.
**A11y:** target WCAG-2.2-AA; min_contrast 6.47. Provisional: phase 59 implementation and live 56/57/58 proof are human-blocking; hermetic criteria alone never pass a live gate.

```json
{ "screen_id": "SCR-PhaseEvidence", "flows": ["review-phase", "check-cause", "verify-ratification"], "states": ["default", "loading", "error.cause-unclear", "error.ratification-missing", "empty.no-live-proof", "success"], "components": [{ "ref": "ds/CheckList@1.0", "props": { "proofTiers": ["hermetic", "live"] } }, { "ref": "ds/AuditRow@1.0", "props": { "dispositions": ["closed", "carried", "blocked"] } }, { "ref": "ds/BlockedNotice@1.0", "props": { "neverGreen": true } }], "a11y": { "target": "WCAG-2.2-AA", "focus_order": ["phase-selector", "evidence-area", "ratification-link"], "min_contrast": 6.47 }, "tokens_version": "1.1.0", "fidelity": "lofi", "provisional": true, "acceptance_refs": ["AC-48", "AC-49", "AC-50", "AC-51", "AC-52", "AC-53", "AC-54", "AC-55", "AC-56", "AC-57", "AC-58"] }
```

## Motion (docs/site only; CLI and Omp widget have no animation)

| Name | Duration | Reduced-motion variant |
|---|---|---|
| disclosure-expand | 200 ms | instant (no expansion animation) |
| link-hover-fade | 150 ms | no fade (hover underline only) |
| realm-widget-swap | 0 ms | instant text replace (no transition; paint happens on change only) |
| plugin-toggle-flip | 0 ms | instant state change (no slide) |

Bound: 5000 ms (SC 2.2.2 convention recorded in decisions; no motion tokens in file).

## Touch / target minima (docs/site and the Omp toggle row)

Nav links and buttons: 44 px targets. Dense table links: meet the WCAG 2.2 SC 2.5.8 minimum (24 px height) via padding, or 12 px centre-to-nearest-edge clearance — see spec remediation (initial check `base:dense-table-link` 16 px/6 px failing → revised to 24 px height minimum). Changing layout can break spacing-exception-only passes; keep 44 px minimums for primary actions. The Omp plugin toggle target is 48×28 px with ≥12 px clearance (measured `compliant: true` this run; a11y sheet row).

## Brand / tokens note

No brand guide supplied → system default theme only, `provisional: true`. Tokens `1.1.0` is a minor (additive) bump: `color.surface.widget` and `color.toggle.track-on` added; 0 removed; 0 deprecation aliases needed (A04 verified with `ux_token_semver_impact`). No new dedicated components are introduced — the toggle row and widget region compose existing `ds/*` text-output blocks (spec L2). A new component or a brand change would be L3 and must stop for human approval.
## SCR-UltrathinkPlanAdvisory — plan completeness notice, advisory path (US-122 W1 + US-124 W3)

**Question:** is the plan tracker done, and is work still moving on its own?
**Flows:** read-plan-status, continue-autonomously.
**Layout (Omp host notice region above the composer; host-owned placement, content is Ultrathink's):**

```
┌─ [ds/NoticeBanner advisory] ──────────────────────────┐
│ ⚠ Plan tracker: 32/48 rows set — 16 pending.           │
│ Warning: incomplete-verdict refresh pending.           │
│ Planning continues automatically under autonomous mode.│
│ [tracker-detail-link 24×24]  [composer-input]          │
└────────────────────────────────────────────────────────┘
```

- `default.pending-rows`: 1 advisory note naming the pending count (`Plan tracker: <done>/<total> rows set — <pending> pending.`), 1 warning line visible (`Warning: incomplete-verdict refresh pending.`), and 1 line stating autonomous continuation (`Planning continues automatically under autonomous mode.`). Request continues with 0 manual steps (AC-71, AC-72, AC-73, UTR-05/UTR-06). Surface `color.surface.advisory`, border `color.border.advisory`, text `color.text.primary`, warning glyph line `color.status.warning` (warning on advisory measured 6.36 this run).
- `loading.revalidating`: `Refreshing verdict from tracker…` with elapsed; the advisory stays visible beneath it; never blank.
- `error.pending-rows`: tracker at 1 pending row → release reads `not_ready` with 1 pending row named (AC-67); rendered as the same advisory (visible warning, continued request), never as a blocking gate.
- `empty.zero-pending`: tracker complete, spec rewritten with 0 pending → `Plan tracker: 0 pending — ready.` and the stale incomplete verdict is retired (AC-65, AC-66).
- `success.ready`: verdict recomputed to `ready`, 0 stale incomplete rows, pending count reads 0 (AC-65, AC-66).

**Banned-copy rule (design-doc only; never host render):** the host-rendered advisory must contain 0 of the 3 banned blocking strings named in AC-71, 0 blocking prompt, and 0 manual step. The render above avoids all 3 and never asks the operator for an answer. No dark pattern: the pending count is stated as a fact, never as urgency.
**Components:** `ds/NoticeBanner@1.0` (props: advisory true, neverSilent true), `ds/StatusReadout@1.0` (props: labels ["ready", "not_ready"]). Reuse only — no new component (L2).
**Focus order:** `tracker-detail-link`, `composer-input`. The advisory note itself is `role="status"` `aria-live="polite"`, non-interactive, never in tab order.
**A11y:** target WCAG-2.2-AA; min_contrast 6.36 (warning-on-advisory pair this run).

```json
{ "screen_id": "SCR-UltrathinkPlanAdvisory", "flows": ["read-plan-status", "continue-autonomously"], "states": ["default.pending-rows", "loading.revalidating", "error.pending-rows", "empty.zero-pending", "success.ready"], "components": [{ "ref": "ds/NoticeBanner@1.0", "props": { "advisory": true, "neverSilent": true } }, { "ref": "ds/StatusReadout@1.0", "props": { "labels": ["ready", "not_ready"] } }], "a11y": { "target": "WCAG-2.2-AA", "focus_order": ["tracker-detail-link", "composer-input"], "min_contrast": 6.36 }, "tokens_version": "1.2.0", "fidelity": "lofi", "provisional": true, "acceptance_refs": ["AC-65", "AC-66", "AC-67", "AC-71", "AC-72", "AC-73"] }
```

## SCR-UltrathinkReloadResume — reload resume, durable answered state (US-123 W2)

**Question:** after a reload, where does the session pick up, and what was already settled?
**Flows:** reload-resume, view-restored-answers.
**Layout (Omp host resume line at the top of the reloaded transcript):**

```
┌─ [ds/StatusReadout resumed] ───────────────────────────────┐
│ Session restored — 3 of 3 settled answers active.          │
│ Work resumes at recorded step 1 of 48.                     │
│ [tracker-detail-link 24×24]  [composer-input]              │
└────────────────────────────────────────────────────────────┘
```

- `default.resumed`: 1 resume line stating `Session restored — 3 of 3 settled answers active.` and the resume step (`Work resumes at recorded step 1 of 48.`); 0 settled questions re-asked, 0 blocking prompts rendered (AC-68, AC-70).
- `loading.restoring`: `Restoring settled answers…` with elapsed; the note never blocks the composer.
- `error.restore-failed`: persisted record unreadable → `Session restore incomplete — settled answers unavailable; planning starts from scratch.` + named remedy `re-answer from the settled-answers list at the tracker`. Never paints a false resumed state.
- `empty.fresh-plan`: no persisted record → `No settled answers on file — plan starts fresh.` (a fresh plan is stated, not blank).
- `success.kickoff-resumed`: `kickedOff` true with 3 of 3 settled answers restored; ANSWER persistence recorded before kickoff step 1 completes (AC-68, AC-69).

Copy rule: the resume line contains 0 of the 3 banned blocking strings from AC-71 and offers no answer request. No new component — reuse `ds/StatusReadout@1.0` and `ds/NoticeBanner@1.0` (L2).
**Focus order:** `tracker-detail-link`, `composer-input`. The resume line is `role="status"` `aria-live="polite"`, non-interactive, never in tab order.
**A11y:** target WCAG-2.2-AA; min_contrast 6.36.

```json
{ "screen_id": "SCR-UltrathinkReloadResume", "flows": ["reload-resume", "view-restored-answers"], "states": ["default.resumed", "loading.restoring", "error.restore-failed", "empty.fresh-plan", "success.kickoff-resumed"], "components": [{ "ref": "ds/StatusReadout@1.0", "props": { "labels": ["restored", "fresh"] } }, { "ref": "ds/NoticeBanner@1.0", "props": { "neverSilent": true } }], "a11y": { "target": "WCAG-2.2-AA", "focus_order": ["tracker-detail-link", "composer-input"], "min_contrast": 6.36 }, "tokens_version": "1.2.0", "fidelity": "lofi", "provisional": true, "acceptance_refs": ["AC-68", "AC-69", "AC-70"] }
```

## Ultrathink motion and targets

| Name | Duration | Reduced-motion variant |
|---|---|---|
| ultrathink-advisory-swap | 0 ms | instant text replace (no transition; paint happens on change only) |
| ultrathink-resume-swap | 0 ms | instant text replace (no transition) |

Target: `tracker-detail-link` 24×24 px with 24 px centre-to-nearest-edge clearance (SC 2.5.8; measured `compliant: true` this run). The advisory and resume notes are non-interactive and have no target.

## Tb559-be resume addendum (Tb559r-ux, 2026-11-22; tokens 1.2.0 unchanged)

**Scope.** US-125..US-128 (AC-74..AC-85) plus the W3 verification-matrix extension on US-124 (AC-78..AC-81). Human decisions are final: signing waiver with 0 keys provisioned, PR split with c53a15c preserved, host-suite extension to 119/119. Zero new components — both screens reuse `ds/GateBoard`, `ds/NoticeBanner`, `ds/StatusReadout`, `ds/CheckList` (L2). No brand change, no token bump (1.2.0 stays; verified with `ux_token_semver_impact` — 0 added, 0 removed). Fidelity: lofi (no Figma). Provisional: true (no brand guide; system default theme). CAPT-09 routing statement is a visible line on SCR-Tb559ResumeVerify, not a fix.

## SCR-Tb559ResumeVerify — waiver, split, suite, gates, tracking, hashes (US-125..US-128)

**Question:** can this resume land as drafted, or what is still missing?
**Flows:** verify-waiver, verify-split, verify-suite, verify-gates, verify-tracking.
**Layout (operator verification board, docs view):**

```
┌─ [ds/GateBoard] resume board ──────────────────────────┐
│ waiver 90b18ce: recorded · 0d5032f: recorded           │
│ split c53a15c on swarm/Tb559-think · PR259: 1 commit   │
│ suite src/host 119/119 · gates 10/10 pass              │
│ hashes STATE 29bc314a… ROADMAP 4b26403c… (read-only)  │
│ CAPT-09 at runtime-decision.md:753 (b37b94c): routed   │
│   to A08, 0 fixes here, 0 block on scoped DONE         │
│ [gate-row-link 24×24] [linear-fix-link 44×44]          │
└────────────────────────────────────────────────────────┘
```

- `default`: 10 gate plans `Tb559-data, Tb559-fe, Tb559-be, Tb559-qa, Tb559-rev, Tb559-sec, build, rel, obs, docs` each exit 0; waiver rows show 1 record per commit with 0 `commits_signed` failures from missing signatures (AC-74, AC-82); split rows show 1 branch holding c53a15c with 0 loss and PR #259 holding 1 commit 90b18ce with 0 forced pushes on main (AC-75, AC-76); suite row shows 119/119 with the partial-plan advisory assertion and fatal-path silence unchanged (AC-77); hash rows show STATE prefix `29bc314a` and ROADMAP prefix `4b26403c` with 0 planning edits (AC-84); Linear rows show SPE-36512, SPE-36513, SPE-36515, SPE-36516 each with 1 `Refs` commit ref and 1 `Fixes` PR-body ref (AC-83); CAPT-09 line states pre-existing/unrelated, routed to A08, 0 fixes in this scope, 0 block on scoped DONE (AC-85). Both PRs read `Draft` until gates green and merge only via ultrathink ship flow — never rendered green before gates pass.
- `loading`: `gates: running resume board…` with elapsed; board never appears green while running.
- `error.gate-fail`: the failing gate named with its check (`BELOW` for coverage floors, named missing file for pack-smoke, named commit for waiver gaps); other rows keep their last truthful verdicts, never erased.
- `error.validation`: usage line + code; unknown gate plan reads `not run`, never pass.
- `empty.no-run`: `no gate run for this ref` (exit 1, not pass). Empty is stated, never blank.
- `success`: 10/10 pass + 119/119 + hashes match + 4 Linear refs + CAPT-09 routing stated; PRs still `Draft` until the ship flow runs.

**Components:** `ds/GateBoard@1.0`, `ds/NoticeBanner@1.0` (CAPT-09 routing line, neverSilent true), `ds/CheckList@1.0` (waiver/split/suite rows, verdicts in text).
**Focus order:** `gate-row-link`, `pr-commit-link`, `linear-fix-link`.
**A11y:** target WCAG-2.2-AA; min_contrast 6.47 (error-on-white pair this run). Board links meet SC 2.5.8 (24 px minimum, measured `compliant: true`).

```json
{ "screen_id": "SCR-Tb559ResumeVerify", "flows": ["verify-waiver", "verify-split", "verify-suite", "verify-gates", "verify-tracking"], "states": ["default", "loading", "error.gate-fail", "error.validation", "empty.no-run", "success"], "components": [{ "ref": "ds/GateBoard@1.0", "props": { "gates": ["Tb559-data", "Tb559-fe", "Tb559-be", "Tb559-qa", "Tb559-rev", "Tb559-sec", "build", "rel", "obs", "docs"] } }, { "ref": "ds/NoticeBanner@1.0", "props": { "capt09": "routed-to-A08" } }, { "ref": "ds/CheckList@1.0", "props": { "rows": ["waiver", "split", "suite", "hashes", "linear"] } }], "a11y": { "target": "WCAG-2.2-AA", "focus_order": ["gate-row-link", "pr-commit-link", "linear-fix-link"], "min_contrast": 6.47 }, "tokens_version": "1.2.0", "fidelity": "lofi", "provisional": true, "acceptance_refs": ["AC-74", "AC-75", "AC-76", "AC-77", "AC-82", "AC-83", "AC-84", "AC-85"] }
```

## SCR-Tb559W3Matrix — herdr advisory verification matrix (US-124 extension)

**Question:** does the advisory render exactly once, name its context, and stay silent when done?
**Flows:** poll-plan-state, read-advisory, confirm-silence.
**Layout (Omp host notice region above the composer in herdr; host-owned placement):**

```
┌─ [ds/NoticeBanner advisory] herdr matrix ──────────────────────────┐
│ ⚠ Plan tracker (graph ut-...): 32/48 rows set — 16 pending.        │
│ Unblocking action: complete 16 rows at the tracker, then reload.   │
│ Planning continues automatically under autonomous mode.             │
│ [tracker-detail-link 24×24]  [composer-input]                       │
└────────────────────────────────────────────────────────────────────┘
```

- `default.incomplete-advisory`: exactly 1 advisory rendered 1 time naming graph id, row count, and 1 unblocking action, with 0 banned strings (AC-79). Copy: `Plan tracker (graph <id>): <done>/<total> rows set — <pending> pending.` + `Unblocking action: <one action>.` + `Planning continues automatically under autonomous mode.` Surface `color.surface.advisory`, border `color.border.advisory`, text `color.text.primary` (15.93 this run), warning line `color.status.warning` (6.36 this run).
- `loading.polling`: `Reading plan state…` with elapsed; a second poll over unchanged state adds 0 prompts (prompt count stays at 1 across 2 polls, AC-80). The advisory paint happens on change only, so an unchanged poll repaints nothing.
- `error.state-malformed`: `Plan state unreadable — <named cause>; planning continues from the last known good snapshot.` rendered as 1 named failure with 0 silent drops (AC-81). Cause names which read failed (missing file vs malformed JSON) and never dumps file contents.
- `empty.complete-silent`: complete plan → 0 advisories render in 2 of 2 renders, live plus after reload in herdr (AC-78). Silence is the absence of the advisory component, stated in the matrix log as `0 advisories in 2 renders`, never as a blank line.
- `success.verified`: matrix log reads `4 of 4 cases verified (complete/silent live+reload, incomplete/advisory-once, no-second-prompt, malformed/named-failure)`; advisory and notice lines remain `role="status"` `aria-live="polite"`, non-interactive, never in tab order.

**Banned-copy rule:** host render contains 0 of the 3 banned blocking strings from AC-71, 0 blocking prompts, 0 manual steps. No dark pattern: pending count stated as fact, never as urgency. Complete-plan silence is per-render verified (live and reload), so a reload cannot resurrect a stale advisory.
**Components:** `ds/NoticeBanner@1.0` (props: advisory true, neverSilent true, live polite), `ds/StatusReadout@1.0` (props: labels ["ready", "not_ready"]). Reuse only — no new component (L2).
**Focus order:** `tracker-detail-link`, `composer-input`. Advisory is non-interactive, never in tab order.
**A11y:** target WCAG-2.2-AA; min_contrast 6.36 (warning-on-advisory pair this run). Focus ring `#2563eb` on advisory surface 4.64, `meets: true` (SC 1.4.11 needs 3).

```json
{ "screen_id": "SCR-Tb559W3Matrix", "flows": ["poll-plan-state", "read-advisory", "confirm-silence"], "states": ["default.incomplete-advisory", "loading.polling", "error.state-malformed", "empty.complete-silent", "success.verified"], "components": [{ "ref": "ds/NoticeBanner@1.0", "props": { "advisory": true, "neverSilent": true } }, { "ref": "ds/StatusReadout@1.0", "props": { "labels": ["ready", "not_ready"] } }], "a11y": { "target": "WCAG-2.2-AA", "focus_order": ["tracker-detail-link", "composer-input"], "min_contrast": 6.36 }, "tokens_version": "1.2.0", "fidelity": "lofi", "provisional": true, "acceptance_refs": ["AC-78", "AC-79", "AC-80", "AC-81"] }
```

## Tb559 motion and targets

| Name | Duration | Reduced-motion variant |
|---|---|---|
| tb559-board-swap | 0 ms | instant text replace (no transition) |
| tb559-matrix-swap | 0 ms | instant text replace (no transition; paint happens on change only) |

Bound: 5000 ms (same convention as earlier screens; no motion tokens in file). Targets: `gate-row-link` 24x24, `pr-commit-link` 24x24, `linear-fix-link` 44x44 with 24-40 px centre-to-nearest-edge clearance (SC 2.5.8; measured `compliant: true` this run). Advisory and matrix notes are non-interactive and have no target.

## Swarm cffd9419 resume addendum (Tcffd1-ux, 2026-11-23; tokens 1.2.0 unchanged)

**Scope.** US-129..US-131 (AC-86..AC-96). Human decisions are final: SEC=split (fake fixture assembled in-test from 2 concatenated parts, 0 allowlists, literal value redacted in this spec and the task record), merge of PR #256 conditional on local + CI green with Greptile absence recorded as the user-accepted substitute (0 fake 5 of 5 claims). Zero new components — all three screens reuse `ds/GateBoard`, `ds/CheckList`, `ds/StatusReadout`, `ds/NoticeBanner` (L2). No brand change, no token bump (`ux_token_semver_impact` diff_empty true, l3_required false, next 1.2.1 if file touched). Fidelity: lofi (ASCII wireframes; no Figma). Provisional: true (no brand guide; system default theme). Engineering execution of the split commit, local/CI runs, merge and round-3/W3 runs is owned downstream and only specified here; this addendum states how each state must be displayed and what copy is forbidden.

## SCR-SecSplitFixture — boot-report fixture split and scanner evidence (US-129)

**Question:** is the fixture split clean, does the scanner stay silent, and do refusals stay echo-free?
**Flows:** verify-split, run-refusal-tests, read-scanner.
**Layout (operator evidence board, docs view):**

```
┌─ [ds/GateBoard] boot-report evidence ──────────────────────┐
│ fixture: 2 parts concatenated, value redacted (0 literal)   │
│ tests: compiled run 0 failures · refusals 0 echoes          │
│ scanner: 0 secrets · 0 literal occurrences                  │
│ [gate-row-link 24x24] [scanner-report-link 24x24]           │
└────────────────────────────────────────────────────────────┘
```

- `default.split-clean`: split row reads `fixture assembled from 2 concatenated parts at 1 test location (boot-report, line 177); 0 literal fixture strings in repo` (AC-86). The literal value never appears on this surface, in this spec, or in the task record; downstream verification reads the test file directly for the literal count. Test row reads `compiled boot-report run: 0 failures; refusal assertions: 0 echoes` (AC-87). Scanner row reads `secret scanner: 0 secrets; 0 literal fixture occurrences` (AC-88). All verdicts are text, never colour-only; `color.text.primary` on `color.background.primary` 17.73, `color.status.error` on white 6.47 (measured this run via `ux_contrast`).
- `loading`: `split: verifying fixture and scanner…` with elapsed; board never reads clean while loading.
- `error.literal-found`: scanner reports 1+ secrets → the literal count is named (`scanner: 1 secret at <path>:<line>; remedy: split into 2 concatenated parts`) and the commit is shown as not landed. The secret value itself is never rendered (redaction sentinel `REDACTED` only, NFR-C1).
- `error.validation`: usage line + code; unknown fixture state reads `not run`, never clean.
- `empty.no-run`: `no scanner run for this ref` (exit 1, not pass). Empty is stated, never blank.
- `success`: split row + 0-failure test row + 0-secret scanner row together read `split clean — 0 literal strings, 0 failures, 0 echoes, 0 secrets`, and the scanner report link is the only interactive element beyond the gate link.

**Copy bans (design rule):** never print the fixture literal, never print a secret, never print an allowlist entry (0 allowlists exist). Refusal output states the reason without echoing the fixture (0 echoes, AC-87). No dark pattern: the 0-secret claim is stated as a count, never as urgency or praise.
**Components:** `ds/GateBoard@1.0` (props: rows ["split", "tests", "scanner"]), `ds/CheckList@1.0` (props: rows ["split", "refusals", "scanner"]), `ds/NoticeBanner@1.0` (props: redacted true, neverSilent true, error row only).
**Focus order:** `gate-row-link`, `scanner-report-link`.
**A11y:** target WCAG-2.2-AA; min_contrast 6.47 (error-on-white this run). Links meet SC 2.5.8 (24x24, 24 px centre-to-edge clearance, `ux_target_size_check` compliant true).

```json
{ "screen_id": "SCR-SecSplitFixture", "flows": ["verify-split", "run-refusal-tests", "read-scanner"], "states": ["default.split-clean", "loading.verifying", "error.literal-found", "error.validation", "empty.no-run", "success"], "components": [{ "ref": "ds/GateBoard@1.0", "props": { "rows": ["split", "tests", "scanner"] } }, { "ref": "ds/CheckList@1.0", "props": { "rows": ["split", "refusals", "scanner"] } }], "a11y": { "target": "WCAG-2.2-AA", "focus_order": ["gate-row-link", "scanner-report-link"], "min_contrast": 6.47 }, "tokens_version": "1.2.0", "fidelity": "lofi", "provisional": true, "acceptance_refs": ["AC-86", "AC-87", "AC-88"] }
```

## SCR-Merge256Gate — conditional PR #256 merge board (US-130)

**Question:** may PR #256 merge under the conditional rule, and what proves the rule held?
**Flows:** view-local-gates, check-ci, read-absence-note, confirm-merge.
**Layout (PR evidence board, docs view):**

```
┌─ [ds/GateBoard] PR #256 merge gate ────────────────────────┐
│ local: check:docs · test:scripts · build · lint · boot     │
│ ci: Verify 22.x · 24.x · docs site · breaking · audit      │
│ Greptile: offline — absence recorded; no 5 of 5 claim      │
│ [gate-row-link 24x24] [pr-commit-link 24x24]               │
└────────────────────────────────────────────────────────────┘
```

- `default.gates-green`: local rows read pass in text (`check:docs pass · test:scripts pass · build pass · lint pass · compiled boot-report pass`) and CI rows read pass (`Verify Node 22.x pass · Verify Node 24.x pass · docs site pass · breaking-change pass · audit pass`), 0 failures (AC-89). The merge action stays disabled until every row is pass; a pending row reads `running…`, never green.
- `loading`: `merge gate: running local + CI checks…` with elapsed; the board never reads `ready to merge` while any row is loading.
- `error.gate-fail`: the failing gate named with its check (`check:docs` exit code, CI job name, breaking-change name) and 1 remedy; other rows keep last truthful verdicts, never erased. A red row never repaints as pass.
- `error.greptile-offline`: the absence state is the default when Greptile is offline, not an error that blocks the board: `Greptile: offline — absence recorded as the user-accepted substitute; gate is local + CI green. 0 claims of 5 of 5 reviews are made.` (AC-91). The surface never fabricates a `5 of 5` verdict and never shows a pass-adjacent Greptile chip.
- `empty.no-run`: `no local or CI run for this commit` (exit 1, not pass).
- `success.merged`: `PR #256 merged 1 time with squash through the ship flow; main holds 1 merge commit from the 354f00a line (5 docs files); PR body carries 1 Greptile absence note; 0 claims of 5 of 5` (AC-91), plus `check:docs on merged main: pass exit 0` (AC-90). The success line is reached only after the merge commit exists; before that the board reads `ready to merge — awaiting ship flow`, never `merged`.

**Copy bans (design rule):** 0 of the string bands `5 of 5`, `5/5`, `perfect review`, or any pass-adjacent Greptile verdict may appear unless Greptile actually reported it (it did not in the brief evidence). The absence note must name the offline signal so a reader cannot mistake silence for approval. No dark pattern: the conditional rule is stated as a fact (`merge once local + CI are green`), never as urgency.
**Components:** `ds/GateBoard@1.0` (props: gates ["check:docs", "test:scripts", "build", "lint", "boot-report", "Verify-22", "Verify-24", "docs-site", "breaking-change", "audit"]), `ds/StatusReadout@1.0` (props: labels ["ready to merge", "merged"]), `ds/NoticeBanner@1.0` (props: greptile "offline-absence-recorded", neverSilent true).
**Focus order:** `gate-row-link`, `pr-commit-link`.
**A11y:** target WCAG-2.2-AA; min_contrast 6.47 (error-on-white this run). Gate and commit links meet SC 2.5.8 (24x24 minimum, `ux_target_size_check` compliant true).

```json
{ "screen_id": "SCR-Merge256Gate", "flows": ["view-local-gates", "check-ci", "read-absence-note", "confirm-merge"], "states": ["default.gates-green", "loading.running", "error.gate-fail", "error.greptile-offline", "empty.no-run", "success.merged"], "components": [{ "ref": "ds/GateBoard@1.0", "props": { "gates": ["check:docs", "test:scripts", "build", "lint", "boot-report", "Verify-22", "Verify-24", "docs-site", "breaking-change", "audit"] } }, { "ref": "ds/StatusReadout@1.0", "props": { "labels": ["ready to merge", "merged"] } }], "a11y": { "target": "WCAG-2.2-AA", "focus_order": ["gate-row-link", "pr-commit-link"], "min_contrast": 6.47 }, "tokens_version": "1.2.0", "fidelity": "lofi", "provisional": true, "acceptance_refs": ["AC-89", "AC-90", "AC-91"] }
```

## SCR-R3W3Closeout — round-3 gates, W3 matrix, hashes and Linear close-out (US-131)

**Question:** are the resume gates and the W3 matrix green on merged main, and may the tracking close?
**Flows:** run-r3-gates, run-w3-matrix, verify-hashes, close-tracking, read-final-report.
**Layout (close-out board on merged main, docs view):**

```
┌─ [ds/GateBoard] close-out board ───────────────────────────┐
│ r3: qa.r3 · rev.r3 · sec.r3 · build · rel · obs · docs     │
│ w3: 9 of 9 green (stack a519184 + 0d5032f)                 │
│ hashes: STATE 29bc314a… · ROADMAP 4b26403c… (0 edits)     │
│ linear: n3 · n4 · n6 · n7 (closed only after gates pass)   │
│ report: PR #255: <state> · PR #259: <state>                │
│ [gate-row-link 24x24] [linear-fix-link 44x44]              │
└────────────────────────────────────────────────────────────┘
```

- `default.gates-running`: 7 plan rows each read `qa.r3 … · rev.r3 … · sec.r3 … · build … · rel … · obs … · docs …`; the W3 row reads `W3 matrix: running 9 checks` (AC-92, AC-93). Hash rows state the read-only promise before they verify: `STATE hash read-only (0 planning edits)`.
- `loading`: `close-out: running round-3 gates + W3 matrix…` with elapsed; Linear rows read `open — awaiting gates`, never closed early.
- `error.gate-fail`: the failing plan or W3 check named with its count (`qa.r3 exit 1` / `W3 check 4 of 9 failed: <id>`); Linear rows stay `open` and the final-report row names `not yet listed`, never a guessed PR state (AC-95, AC-96).
- `error.validation`: usage line + code; an unknown plan or PR id reads `not run`, never pass.
- `empty.no-run`: `no round-3 or W3 run on merged main` (exit 1, not pass).
- `success`: 7 of 7 plans exit 0, W3 9 of 9 green on stack `a519184 + 0d5032f`, STATE prefix `29bc314a` and ROADMAP prefix `4b26403c` with 0 planning files changed (AC-92..AC-94), 4 of 4 sub-issues `n3 SPE-36512 · n4 SPE-36513 · n6 SPE-36515 · n7 SPE-36516` closed with 1 commit ref each — 0 closed before gates pass (AC-95), and the final report row reads `PR #255: <state> · PR #259: <state>` with 2 of 2 states listed (AC-96). The advisory surface reuses `color.surface.advisory` with `color.text.primary` 15.93 and `color.status.warning` 6.36 (measured this run); it stays non-interactive (`role="status"` `aria-live="polite"`, never in tab order).

**Copy bans (design rule):** never mark Linear closed while any plan or W3 check is red or not run; never list a PR state that was not read. No dark pattern: the close-out is gated on counts, never narrated as urgency.
**Components:** `ds/GateBoard@1.0` (props: plans ["qa.r3", "rev.r3", "sec.r3", "build", "rel", "obs", "docs"], w3 checks 9), `ds/CheckList@1.0` (props: rows ["hashes", "linear", "final-report"]), `ds/NoticeBanner@1.0` (props: advisory true, neverSilent true, live polite, hash read-only).
**Focus order:** `gate-row-link`, `pr-commit-link`, `linear-fix-link`. The advisory note is non-interactive, never in tab order.
**A11y:** target WCAG-2.2-AA; min_contrast 6.36 (warning-on-advisory this run). Links meet SC 2.5.8 (24x24 / 44x44, `ux_target_size_check` compliant true). Focus ring `#2563eb` lowest 4.64 across white/advisory/widget/secondary, `ux_focus_contrast_check` meets true (SC 1.4.11 needs 3).

```json
{ "screen_id": "SCR-R3W3Closeout", "flows": ["run-r3-gates", "run-w3-matrix", "verify-hashes", "close-tracking", "read-final-report"], "states": ["default.gates-running", "loading.running", "error.gate-fail", "error.validation", "empty.no-run", "success"], "components": [{ "ref": "ds/GateBoard@1.0", "props": { "plans": ["qa.r3", "rev.r3", "sec.r3", "build", "rel", "obs", "docs"], "w3Checks": 9 } }, { "ref": "ds/CheckList@1.0", "props": { "rows": ["hashes", "linear", "final-report"] } }], "a11y": { "target": "WCAG-2.2-AA", "focus_order": ["gate-row-link", "pr-commit-link", "linear-fix-link"], "min_contrast": 6.36 }, "tokens_version": "1.2.0", "fidelity": "lofi", "provisional": true, "acceptance_refs": ["AC-92", "AC-93", "AC-94", "AC-95", "AC-96"] }
```

## cffd9419 motion and targets

| Name | Duration | Reduced-motion variant |
|---|---|---|
| secsplit-board-swap | 0 ms | instant text replace (no transition) |
| merge-board-swap | 0 ms | instant text replace (no transition) |
| r3-closeout-swap | 0 ms | instant text replace (no transition; paint happens on change only) |

Bound: 5000 ms (same convention as earlier screens; no motion tokens in file). Targets: `gate-row-link` 24x24, `pr-commit-link` 24x24, `scanner-report-link` 24x24, `linear-fix-link` 44x44 with 24-40 px centre-to-nearest-edge clearance (SC 2.5.8; measured `compliant: true` this run). Board and advisory notes are non-interactive and have no target.

## T5471 quality upgrade addendum (T5471-ux, 2026-11-26; tokens 1.2.0 unchanged)

**Scope.** US-132..US-135 (AC-97..AC-108) from `docs/requirements/spec.md` section 15: measured quality baseline, programming-pattern ratchet with zero gate regressions, Linear blocker continuation with zero silent gaps, and gate enforcement per risk class. Zero new components — all three screens reuse `ds/GateBoard`, `ds/CheckList`, `ds/StatusReadout`, `ds/NoticeBanner`, `ds/MetricTable` (L2). No brand change, no token bump (tokens 1.2.0 unchanged; `ux_token_semver_impact` requested with identical maps, L3 not triggered). Fidelity: lofi (ASCII wireframes; no Figma). Provisional: true (no brand guide; system default theme). This design records 0 gate outcomes as observed facts: every number on these boards is an A08-recorded observation; a missing number reads `unknown — not measured`, never a guess, never 0, never pass.

## SCR-QualityBaselineBoard — measured baseline + ratchet (US-132, US-133)

**Question:** what is the measured quality bar on this branch, and did the pattern ratchet hold it without regressions?
**Flows:** record-baseline, read-coverage, read-audit, verify-ratchet, compare-to-baseline.
**Layout (operator evidence board, docs view):**

```
┌─ [ds/GateBoard] quality baseline — fix/stdio-host-shutdown-log ┐
│ gates: typecheck · lint · test · build · check:docs ·         │
│   check:gates · check:pack · check:mcp (1 exit code each)     │
│ coverage: src/fs <n> · src/core <n> · src/tools <n>           │
│ audit: exit <n> · dependencies <n> · scanner 0 secrets        │
│ ratchet: suppression 0 · silent-catch 0/10 · deps 0 · modules 0│
│ [gate-row-link 24x24] [baseline-detail-link 24x24]             │
└────────────────────────────────────────────────────────────────┘
```

- `default.baseline`: 8 gate rows each read 1 recorded exit code (`typecheck exit 0` etc., AC-97); coverage rows each read 1 measured floor value for `src/fs`, `src/core`, `src/tools` (AC-98); audit row reads 1 exit code + 1 dependency count (AC-99). A row not yet measured reads `unknown — not measured` on the advisory surface (`color.surface.advisory`, `color.text.primary` 15.93 and `color.status.warning` 6.36 this run) and never reads pass.
- `loading`: `baseline: running 8 gates…` with elapsed and NFR-P3 budget note (1800 s wall); the board never reads recorded while any gate is running.
- `error.gate-fail`: the regressing gate named with its exit code and 1 remedy (`<gate> exit 1 — revert or carry with 1 tested reason`); other rows keep last truthful verdicts, never erased (AC-101).
- `error.validation`: usage line + code; an unknown gate name or coverage directory reads `not run`, never pass.
- `empty.no-run`: `no baseline recorded for this branch` (not pass). Pattern rows read `suppression comments 0 · silent catches beyond the 10 named QUAL-01 exceptions 0 · new dependencies without justification 0` (AC-100) and `0 modules over the size ratchet, 1 size recorded per module` (AC-102); an unmeasured pattern row reads `unknown — not measured`.
- `success.recorded`: 8 of 8 gate exit codes recorded + 3 of 3 coverage floors measured + audit exit and dependency count recorded + ratchet counts 0, with `0 frozen catalogue codes changed · 0 shims added` stated in text.

**Copy bans (design rule):** never invent an exit code, floor, or count; never call `unknown` green; never name a catalogue change without its code. No dark pattern: counts stated as facts, never as urgency or praise.
**Components:** `ds/GateBoard@1.0` (props: gates ["typecheck","lint","test","build","check:docs","check:gates","check:pack","check:mcp"]), `ds/MetricTable@1.0` (props: rows ["coverage","audit","ratchet"]), `ds/NoticeBanner@1.0` (props: advisory true, neverSilent true, live polite, unknown-only).
**Focus order:** `gate-row-link`, `baseline-detail-link`. Advisory note is non-interactive, never in tab order.
**A11y:** target WCAG-2.2-AA; min_contrast 6.47 (error-on-white this run). Links meet SC 2.5.8 (24x24, `ux_target_size_check` compliant true). Focus ring `#2563eb` lowest 4.64 across white/advisory/widget/secondary, `ux_focus_contrast_check` meets true (SC 1.4.11 needs 3).

```json
{ "screen_id": "SCR-QualityBaselineBoard", "flows": ["record-baseline", "read-coverage", "read-audit", "verify-ratchet", "compare-to-baseline"], "states": ["default.baseline", "loading.running", "error.gate-fail", "error.validation", "empty.no-run", "success.recorded"], "components": [{ "ref": "ds/GateBoard@1.0", "props": { "gates": ["typecheck", "lint", "test", "build", "check:docs", "check:gates", "check:pack", "check:mcp"] } }, { "ref": "ds/MetricTable@1.0", "props": { "rows": ["coverage", "audit", "ratchet"] } }, { "ref": "ds/NoticeBanner@1.0", "props": { "advisory": true, "neverSilent": true } }], "a11y": { "target": "WCAG-2.2-AA", "focus_order": ["gate-row-link", "baseline-detail-link"], "min_contrast": 6.47 }, "tokens_version": "1.2.0", "fidelity": "lofi", "provisional": true, "acceptance_refs": ["AC-97", "AC-98", "AC-99", "AC-100", "AC-101", "AC-102"] }
```

## SCR-LinearContinuationBoard — done-or-blocked tracker (US-134)

**Question:** does every open Linear item carry a recorded state, and does every blocker name its owner action?
**Flows:** list-open-items, read-item-state, check-duplicates, read-blocker, follow-owner-action.
**Layout (tracking board, docs view):**

```
┌─ [ds/CheckList] Linear continuation ─────────────────────────┐
│ item: <id> — done-with-evidence | blocked-with-named-cause   │
│ BLOCKED — owner decision required                            │
│ cause: <1> · owner action: <1> · next step: <1>              │
│ duplicates: 0 per phase (reuse existing title)               │
│ [linear-fix-link 44x44] [gate-row-link 24x24]                │
└──────────────────────────────────────────────────────────────┘
```

- `default.listed`: each listed open issue/sub-issue reads exactly 1 state, either `done-with-evidence` or `blocked-with-named-cause`, with `0 items lack a state` stated as a count (AC-103). Duplicate row reads `duplicate phase titles 0, 1 count recorded per phase` (AC-104); a scan that finds a match states `reused existing <issue>` and creates nothing.
- `loading`: `linear: listing open items…` with elapsed; the board never reads complete while listing.
- `error.workspace-unreadable`: `Linear workspace unreadable — <named cause>; 0 items marked` with 1 remedy; no item is guessed done or blocked.
- `error.validation`: usage line + code; an unknown issue id reads `not listed`, never silently absent.
- `empty.no-open-items`: `0 open items — all items done-with-evidence` stated, never blank.
- `success.blocked-named`: every blocked row reads `BLOCKED — owner decision required` + exactly 1 cause + exactly 1 owner action + exactly 1 next step (AC-105), including the carried live-phase blocker `phases 56-58 blocked on the realmlive stack, 0 live windows scheduled`. A done row reads `done-with-evidence` + its evidence ref, never a bare done.

**Copy bans (design rule):** never mark an item done without an evidence ref; never leave a blocker without cause + owner action + next step; never create a duplicate phase title. No dark pattern: blocked stated as fact with a named next step, never as urgency.
**Components:** `ds/CheckList@1.0` (props: states ["done-with-evidence","blocked-with-named-cause"]), `ds/NoticeBanner@1.0` (props: blocked true, neverSilent true), `ds/StatusReadout@1.0` (props: labels ["done-with-evidence","blocked-with-named-cause"]).
**Focus order:** `linear-fix-link`, `gate-row-link`. Blocked notice is `role="status"` `aria-live="polite"`, non-interactive, never in tab order.
**A11y:** target WCAG-2.2-AA; min_contrast 6.47 (error-on-white this run). Links meet SC 2.5.8 (44x44 / 24x24, `ux_target_size_check` compliant true).

```json
{ "screen_id": "SCR-LinearContinuationBoard", "flows": ["list-open-items", "read-item-state", "check-duplicates", "read-blocker", "follow-owner-action"], "states": ["default.listed", "loading.listing", "error.workspace-unreadable", "error.validation", "empty.no-open-items", "success.blocked-named"], "components": [{ "ref": "ds/CheckList@1.0", "props": { "states": ["done-with-evidence", "blocked-with-named-cause"] } }, { "ref": "ds/NoticeBanner@1.0", "props": { "blocked": true, "neverSilent": true } }, { "ref": "ds/StatusReadout@1.0", "props": { "labels": ["done-with-evidence", "blocked-with-named-cause"] } }], "a11y": { "target": "WCAG-2.2-AA", "focus_order": ["linear-fix-link", "gate-row-link"], "min_contrast": 6.47 }, "tokens_version": "1.2.0", "fidelity": "lofi", "provisional": true, "acceptance_refs": ["AC-103", "AC-104", "AC-105"] }
```

## SCR-GateEnforcementBoard — 4-gate release hold (US-135)

**Question:** are all 4 gate verdicts present, and does a red verdict hold the release?
**Flows:** read-verdicts, check-release-readiness, trace-stories, hold-release.
**Layout (release gate board, docs view):**

```
┌─ [ds/GateBoard] gate enforcement — fix/stdio-host-shutdown-log ┐
│ review: <verdict> · quality: <verdict> · security: <verdict>   │
│ release: <verdict> · most-restrictive wins on conflict         │
│ release readiness: held — <gate> red | ready — 4 of 4 green    │
│ traceability: 4 of 4 stories, 0 uncovered requirements         │
│ [gate-row-link 24x24] [release-readiness-link 24x24]           │
└────────────────────────────────────────────────────────────────┘
```

- `default.verdicts`: 4 rows each read 1 recorded verdict in text (`review pass · quality pass · security pass · release pass`), never a colour-only chip (AC-106). A missing verdict reads `not recorded — gate not run`, never pass.
- `loading`: `gates: recording verdicts…` with elapsed; release readiness reads `held — verdicts incomplete`, never ready.
- `error.red-gate`: the red gate named (`release readiness: held — <gate> red`) with the most-restrictive verdict winning on conflict; `0 releases land on a red verdict` stated as a count (AC-107). Other verdicts keep their recorded values, never repainted.
- `error.validation`: usage line + code; an unknown gate name reads `not run`, never pass.
- `empty.no-verdicts`: `0 verdicts recorded for this branch` (not pass; release held).
- `success.ready`: `4 of 4 verdicts present · most-restrictive wins · release ready` only when all 4 are pass, plus traceability row `100 percent of 4 stories trace to 1 or more criteria, 0 uncovered requirements` (AC-108). Status text uses the NFR-A3 colour-independent cue: exactly 1 of 2 text labels (`held` / `ready`) with a shape cue, distinguishable without colour.

**Copy bans (design rule):** never assert a verdict that was not recorded; never show `ready` while any verdict is missing or red; never land a release on red. No dark pattern: the hold is stated as a gate fact, never as urgency.
**Components:** `ds/GateBoard@1.0` (props: gates ["review","quality","security","release"]), `ds/StatusReadout@1.0` (props: labels ["held","ready"]), `ds/CheckList@1.0` (props: rows ["verdicts","readiness","traceability"]).
**Focus order:** `gate-row-link`, `release-readiness-link`.
**A11y:** target WCAG-2.2-AA; min_contrast 6.47 (error-on-white this run). Links meet SC 2.5.8 (24x24, `ux_target_size_check` compliant true). Focus ring `#2563eb` lowest 4.64, `ux_focus_contrast_check` meets true.

```json
{ "screen_id": "SCR-GateEnforcementBoard", "flows": ["read-verdicts", "check-release-readiness", "trace-stories", "hold-release"], "states": ["default.verdicts", "loading.recording", "error.red-gate", "error.validation", "empty.no-verdicts", "success.ready"], "components": [{ "ref": "ds/GateBoard@1.0", "props": { "gates": ["review", "quality", "security", "release"] } }, { "ref": "ds/StatusReadout@1.0", "props": { "labels": ["held", "ready"] } }, { "ref": "ds/CheckList@1.0", "props": { "rows": ["verdicts", "readiness", "traceability"] } }], "a11y": { "target": "WCAG-2.2-AA", "focus_order": ["gate-row-link", "release-readiness-link"], "min_contrast": 6.47 }, "tokens_version": "1.2.0", "fidelity": "lofi", "provisional": true, "acceptance_refs": ["AC-106", "AC-107", "AC-108"] }
```

## T5471 motion and targets

| Name | Duration | Reduced-motion variant |
|---|---|---|
| quality-board-swap | 0 ms | instant text replace (no transition) |
| linear-board-swap | 0 ms | instant text replace (no transition; paint happens on change only) |
| gate-board-swap | 0 ms | instant text replace (no transition) |

Bound: 5000 ms (same convention as earlier screens; no motion tokens in file). Targets: `gate-row-link` 24x24, `baseline-detail-link` 24x24, `linear-fix-link` 44x44, `release-readiness-link` 24x24 with 24-40 px centre-to-nearest-edge clearance (SC 2.5.8; measured `compliant: true` this run). Advisory, blocked and verdict notes are non-interactive and have no target.
## T8345 docs-only ship addendum (T8345-ux, 2026-11-27; tokens 1.2.0 unchanged)

**Scope.** US-136 (AC-109..AC-113) from `docs/requirements/spec.md`: docs-only ship of window addenda and GAP-43-03 closure — 7 files (3 WINDOW.md addenda, 3 VERIFICATION-UPDATE-20261127.md, 1 host-plugin-gaps.md) committed on `fix/stdio-host-shutdown-log`, 1 PR to main with 5 CI checks green, 1 squash merge, and 1 recorded Greptile billing-waiver line. Zero new components — the board reuses `ds/GateBoard`, `ds/CheckList`, `ds/StatusReadout`, `ds/NoticeBanner` (L2). No brand change, no token bump (tokens 1.2.0 unchanged; `ux_token_semver_impact` diff_empty true, l3_required false). Fidelity: lofi (ASCII wireframes; no Figma). Provisional: true (no brand guide; system default theme). Engineering execution (commit, PR, squash merge) is downstream; this design states display and forbidden copy only.

## SCR-DocsShipBoard — docs-only ship evidence board (US-136)

**Question:** are the 7 docs files committed with 0 product-code edits, is the PR green, and did the merge land honestly?
**Flows:** verify-files, view-pr, check-ci, read-waiver, confirm-merge.
**Layout (ship evidence board, docs view):**

```
┌─ [ds/GateBoard] docs-only ship — fix/stdio-host-shutdown-log ┐
│ files: 3 WINDOW addenda · 3 VERIFICATION-UPDATE · gaps 1     │
│ pr: 1 to main from branch · head = 7-file commit             │
│ ci: verify 22.x · verify 24.x · site · audit · guard         │
│ merge: squash 1 time · waiver: owner billing waiver          │
│ [gate-row-link 24x24] [pr-commit-link 24x24] [merge-record-link 24x24] │
└────────────────────────────────────────────────────────────────────────┘
```

- `default.files`: files row reads `7 files committed — 3 WINDOW.md addenda · 3 VERIFICATION-UPDATE-20261127.md · host-plugin-gaps.md GAP-43-03 closed; 0 files under src/ or test/ edited` (AC-109). PR row reads `1 open pull request targets main from fix/stdio-host-shutdown-log · head commit matches the 7-file commit` (AC-110). CI row reads `5 check runs (verify 22.x · verify 24.x · site · audit · guard) report success · 0 failed runs` (AC-111). Merge row reads `ready to merge — awaiting ship flow` before merge and `merged — 1 squash merge on main` after (AC-112). All verdicts are text, never colour-only; `color.text.primary` on `color.background.primary` 17.73, `color.status.error` on white 6.47 (measured this run via `ux_contrast`).
- `loading.checks`: `ship: running 5 CI checks…` with elapsed; the board never reads green while any check is running.
- `error.ci-fail`: the failing check named with its run (`audit exit 1`) and 1 remedy; other rows keep last truthful verdicts, never erased. A red CI row never repaints as pass.
- `error.validation`: usage line + code; an unknown branch, PR id, or file path reads `not run`, never pass.
- `empty.no-run`: `no commit or CI run for this branch` (not pass). Empty is stated, never blank.
- `success.merged`: `7 files on main · 1 squash merge · 5 of 5 CI green · waiver line present in PR body (owner billing waiver for Greptile 5/5 · 0 Greptile gate required)` with `0 files outside docs and planning changed` stated as a count (AC-112, AC-113). The waiver note reuses `color.surface.advisory` with `color.text.primary` 15.93 and `color.status.warning` 6.36 (measured this run); it is `ds/NoticeBanner` advisory, never a pass chip.

**Copy bans (design rule):** never claim Greptile `5 of 5` passes — the ship flow records 1 waiver line citing the owner billing waiver and requires 0 Greptile verdict (AC-113); never count a `src/` or `test/` edit as docs-only (AC-109, AC-113); never fabricate a merge commit before it exists. No dark pattern: ship state stated as counts and labels, never as urgency or praise.
**Components:** `ds/GateBoard@1.0` (props: gates ["verify-22", "verify-24", "site", "audit", "guard"]), `ds/CheckList@1.0` (props: rows ["files", "pr", "ci", "merge"]), `ds/StatusReadout@1.0` (props: labels ["ready to merge", "merged"]), `ds/NoticeBanner@1.0` (props: waiver "owner-billing-waiver", neverSilent true).
**Focus order:** `gate-row-link`, `pr-commit-link`, `merge-record-link`. Waiver note is `role="status"` `aria-live="polite"`, non-interactive, never in tab order.
**A11y:** target WCAG-2.2-AA; min_contrast 6.36 (warning-on-advisory this run). Links meet SC 2.5.8 (24x24, `ux_target_size_check` compliant true). Focus ring `#2563eb` lowest 4.64 across white/advisory/widget/secondary, `ux_focus_contrast_check` meets true (SC 1.4.11 needs 3).

```json
{ "screen_id": "SCR-DocsShipBoard", "flows": ["verify-files", "view-pr", "check-ci", "read-waiver", "confirm-merge"], "states": ["default.files", "loading.checks", "error.ci-fail", "error.validation", "empty.no-run", "success.merged"], "components": [{ "ref": "ds/GateBoard@1.0", "props": { "gates": ["verify-22", "verify-24", "site", "audit", "guard"] } }, { "ref": "ds/CheckList@1.0", "props": { "rows": ["files", "pr", "ci", "merge"] } }, { "ref": "ds/StatusReadout@1.0", "props": { "labels": ["ready to merge", "merged"] } }, { "ref": "ds/NoticeBanner@1.0", "props": { "waiver": "owner-billing-waiver", "neverSilent": true } }], "a11y": { "target": "WCAG-2.2-AA", "focus_order": ["gate-row-link", "pr-commit-link", "merge-record-link"], "min_contrast": 6.36 }, "tokens_version": "1.2.0", "fidelity": "lofi", "provisional": true, "acceptance_refs": ["AC-109", "AC-110", "AC-111", "AC-112", "AC-113"] }
```

## T8345 motion and targets

| Name | Duration | Reduced-motion variant |
|---|---|---|
| docs-ship-board-swap | 0 ms | instant text replace (no transition) |

Bound: 5000 ms (same convention as earlier screens; no motion tokens in file). Targets: `gate-row-link` 24x24, `pr-commit-link` 24x24, `merge-record-link` 24x24 with 24-40 px centre-to-nearest-edge clearance (SC 2.5.8; measured `compliant: true` this run). Waiver note is non-interactive and has no target.

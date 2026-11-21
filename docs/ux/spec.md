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

Coverage: AC-1..AC-64 all referenced at least once (overlaps are intentional where two surfaces show the same fact).

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

# Component Spec — Realm Operator Surfaces (skeleton, typed)

**Tokens:** `design.system.tokens@1.0.0` (`docs/ux/tokens.json`) · **Contract:**
Realm Control Socket 1.0.0 (`api-realm-control.yaml`) + `api-gsd-linear.yaml` for SCR-LinearGsd.
**Rule:** props are typed (no `any`/`unknown` in the component contract); a component is not done
without one Storybook story per state and Playwright component tests (see `test-notes.md`).
All screens: WCAG-2.2-AA, min contrast 6.47 (text) / 3.43 (focus ring on terminal surface).
`ds/*` refs are 1.0 text-output blocks. Focus order is the spec order; never add positive
tabindex — use DOM order.

Shared block contracts (referenced per screen):

```ts
// ds/StatusReadout — NFR-A1: exactly one of two labels, shape cue redundant with text.
type StatusLabel = "ACTIVE" | "DISCONNECTED";
interface StatusReadoutProps {
  label: StatusLabel;            // rendered as [ACTIVE] / [DISCONNECTED] + ● / ○
  sessionId: string;             // realm-<sessionId>
  workspace: string;             // absolute path, wraps, never truncates into ambiguity
  notice: string;                // one line; never empty when unread reconcile/reap exists
  colour: "success" | "none";    // colour.status.success reinforces ACTIVE only; "none" is NO_COLOR-safe
}
// ds/NoticeBanner — notice is never silent.
interface NoticeBannerProps {
  message: string;               // one line, factual: what happened / what it means / what next
  live?: boolean;                // aria-live polite when a new notice arrives
}
// ds/BlockedNotice — blocked is not failed; never green.
interface BlockedNoticeProps {
  question: string; decider: string; unblocksWhen: string; defaultBehaviour: string; unverifiedCount: number;
}
// ds/CodeBlock — terminal surface tokens only.
interface CodeBlockProps { code: string; }
// ds/CheckList — verdicts in text, never colour-only.
type CheckVerdict = "pass" | "fail";
interface CheckRow { id: string; verdict: CheckVerdict; remedy?: string; }
```

## SCR-RealmStatus — `realm status`
AC-11, AC-12, AC-13, AC-15, AC-21, AC-23, AC-24 · Contract `GET /status` → `StatusResponse`.
Props: `StatusReadoutProps` + `lifecycle: "active" | "degraded" | string` (unknown → `REALM_NOT_ACTIVE`).
States: `default`, `loading` ("status: probing daemon …"), `error.daemon-absent`, `error.validation`,
`empty.no-sessions`, `success`, `degraded` (sub-state of success: `ACTIVE` + `degraded: <cause>`, never a third label).
Focus: `workspace-selector`, `status-query`, `notice-area`.
Implementation note: `runStatus` (`src/cli/main.ts`) already returns exit 0 `disconnected` +
stderr `daemon absent (REALM_NOT_ACTIVE); local report` when no daemon answers — the spec
surface consumes that; do not change the string (see copy-table). Monochrome render keeps
`[DISCONNECTED]` + `○`.

## SCR-RealmLifecycle — `realm init|up|down`
AC-14, AC-16, AC-17, AC-22, AC-25 · Contract `POST /up`, `POST /down` → `StatusResponse`; 409 `POLICY_DENIED`.
Components: `ds/LifecycleSteps@1.0 { steps: ["init","up","down"] }`, `ds/StatusReadout@1.0`.
Props: `{ imageDigest: string; sessionId: string; workspace: string; mode: "fail-closed"|"advisory"; staysIntact: string[] }`.
States: `default`, `loading` ("up: starting daemon (≤200s budget)…" + elapsed), `error.policy`, `error.not-active`, `empty.no-workspace`, `success` (`down` prints `disconnected` / `already down (REALM_NOT_ACTIVE)` exit 0, no error framing).
Focus: `workspace`, `image-digest`. Isolation line (AC-22) names both sandboxes `realm-<sessionId>`
and states a write in one is invisible in the other. Advisory warning shown every invocation (AC-16).

## SCR-RealmDoctor — `realm doctor [--fix [--dry-run]]`
AC-19, AC-20. Components: `ds/CheckList@1.0 { verdicts: ["pass","fail"] }`, `ds/FixPreview@1.0 { dryRunFirst: true }`.
Props: `{ checks: CheckRow[]; fixMode: "none"|"fix"|"fix-dry-run"; metricsPointer?: string }`.
States: `default`, `loading` ("doctor: running N local checks…"), `error.daemon-absent`
(JSON to stdout + `daemon absent (REALM_NOT_ACTIVE); ran N local checks` to stderr), `error.validation`,
`empty.no-checks`, `success`. Success + `--fix --dry-run` prints `would <kind> <path> to 0700`,
changes nothing. Focus: `workspace`, `fix-mode`, `dry-run`.

## SCR-RealmAudit — `realm audit verify` + `realm anchor`
AC-10, AC-18, AC-30 · Contract `POST /audit/verify` → `AuditVerifyResponse`; `AuditLine` (seq/prev/code/correlationId, 0 PII).
Components: `ds/AuditVerdict@1.0 { exitCodes: [0,1,2] }`, `ds/AuditRow@1.0 { dispositions: ["satisfied","carried","superseded"] }`.
Props: `{ files: { session: string; result: "verified"|"chain-break"; line?: number }[]; head?: { seq: number; sha256: string }; anchorRoot?: string }`.
States: `default`, `loading` ("audit: checking <file>…"), `error.chain-break` (exit 1, first broken line),
`error.validation` (exit 2), `empty.no-files` (`no audit file to verify`, exit 1, not pass), `success` (`verified: K files, head <seq>:<sha256>`).
Paths are never printed; failures name session + line (or anchor line count). Crash-stage sweep orphans
listed by sweep audit lines (AC-10). Milestone audit: one row per requirement (AC-30). Focus: `selector`, `head-pin`, `anchor-file`.

## SCR-RealmCheckpoint — `realm checkpoint create|restore`
AC-24, AC-25, AC-26 · Contract `POST /checkpoint/restore` (409 unsafe paths).
Component: `ds/CheckpointPanel@1.0 { byteExact: true }`.
Props: `{ checkpointId: string; fileCount: number; workspace: string; mode: "create"|"restore" }`.
States: `default`, `loading` ("checkpoint: writing…"), `error.daemon-silent` (`REALM_NOT_ACTIVE` before anything is written), `error.validation`, `empty.no-checkpoint`, `success` (byte-for-byte: deletions restored, extras removed). Focus: `workspace`, `checkpoint-id`, `mode`.

## SCR-RealmMetrics — `realm metrics`
AC-20 · Contract `GET /control/metrics` → `MetricsResponse`.
Component: `ds/MetricTable@1.0 { unit: "count" }` — table `counter | value | window`.
Props: `{ counters: Record<string, number>; window: string; networkListeners: 0 }`.
States: `default`, `loading` ("metrics: reading…"), `error.daemon-absent` (`realm metrics: daemon absent (REALM_NOT_ACTIVE)`, exit 1), `error.validation`, `empty.no-session`, `success` (+ `0 network listeners` line). Focus: `workspace`, `query`.

## SCR-OmpGuard — Omp extension panel/transcript
AC-1, AC-2, AC-3, AC-4, AC-14, AC-15, AC-16, AC-17. Components: `ds/ModeBanner@1.0 { modes: ["fail-closed","advisory"] }`, `ds/ToolList@1.0 { tools: ["exec","read","write","list","status"] }`, `ds/RefusalCard@1.0 { needsNextAction: true }`.
Props: `{ mode: "fail-closed"|"advisory"; tools: readonly ["exec","read","write","list","status"]; refusal?: { code: string; reason: string; next: string }; warning?: string }`.
States: `default`, `loading` ("omp: starting run…"), `error.refused` (catalogue code + reason + next; bash refused in fail-closed with 1 code, AC-15), `error.validation`, `empty.tool-list` (stated, not blank), `success` (bytes in sandbox `/workspace` + host root; audit admission+result share correlation id, AC-17).
Advisory warning on every reachable-inactive write (AC-2/AC-16). Focus: `tool-name`, `mode-banner`, `refusal-message`.

## SCR-CiGates — CI / gate board (docs view)
AC-5, AC-6, AC-7, AC-8, AC-9, AC-31. Component: `ds/GateBoard@1.0`.
Props: `{ gates: { name: "typecheck"|"lint"|"test"|"build"|"check-docs"|"check-gates"|"check-pack"|"check-mcp"; verdict: "pass"|"fail" }[]; greptile: string; mergeRecord?: string; ciNodeVersions: string[] }`.
States: `default`, `loading` ("gates: running"), `error.gate-fail` (named gate + `BELOW` for coverage / missing file for pack-smoke), `error.validation`, `empty.no-run`, `success` (`5 of 5` Greptile + squash merge record). Dense table links: ≥24 px height (a11y.md remediation). Focus: `gate-list`, `greptile-verdict`, `merge-record`.

## SCR-OnboardingDocs — docs / README / site pages
AC-4, AC-21, AC-30. Components: `ds/DocSteps@1.0 { numbered: true }`, `ds/CodeBlock@1.0 { surface: "terminal" }`.
Props: `{ steps: { title: string; command: string }[]; nextHref: string }` — every command in its own code block.
States: `default`, `loading` (skeleton + `aria-busy`, code not yet present), `error.not-found` (bounce links), `error.validation`, `empty.no-results` (`0 results` + suggested terms), `success` (install→up on one page).
Heading order starts at H1, never skips a level descending. Focus: `nav`, `heading`, `code-block`, `action-link`.

## SCR-ReleaseProvenance — release workflow view
AC-27, AC-28, AC-29. Component: `ds/ProvenanceList@1.0 { artifacts: ["tarball","SHA256SUMS","SBOM"] }`.
Props: `{ tag: string; checksums: string; sbom: string; attestation: "verified"|"failed"|"pending"; rollbackTarget?: string }`.
States: `default`, `loading` ("release: building…"), `error.attestation` (`gh attestation verify` failure named), `error.validation`, `empty.no-release`, `success` (verified tarball; test release prerelease). Focus: `release-tag`, `attestation`, `rollback`.

## SCR-LinearGsd — Linear / GSD tracking UX
AC-30, AC-32. Components: `ds/IssueHeader@1.0 { oneLineTitle: true }`, `ds/AgentNotes@1.0 { collapsible: "+++ Agent notes" }`, `ds/SubIssueList@1.0`, `ds/BlockedNotice@1.0 { neverGreen: true }`.
Props: `{ phaseId: string; title: string; planIds: string[]; requirementIds: string[]; acCount: number; subIssues: { id: string; title: string }[]; blocked?: BlockedNoticeProps }`.
States: `default`, `loading` ("loading issue…"), `error.duplicate` (existing id stated; creation refused), `error.validation`, `empty.no-match`, `success` (1 issue per phase, 8 issues; sub-issue per plan/requirement when >4 ids).
`+++ Agent notes` is a labelled disclosure; phase order stated as counts (Omp 12→16; runtime 14→17→18→19; pipeline 13→20). Focus: `issue-title`, `agent-notes`, `sub-issue-list`, `state-roadmap`.

## Tcffd1 addendum — SEC split / Merge256 / R3W3 close-out (AC-86..AC-96, tokens 1.2.0)

**Bound:** `design.system.tokens@1.2.0` (`docs/ux/tokens.json`), `API-UltrathinkCompletionGate@1.1.0`
(`api-ultrathink-completion-gate.yaml`; advisory precedent — these three docs-view boards display text
evidence and make no new API call). Zero new components — reuse `ds/GateBoard@1.0`,
`ds/CheckList@1.0`, `ds/StatusReadout@1.0`, `ds/NoticeBanner@1.0`. Copy bans: never the fixture
literal (`REDACTED` only), never a fake Greptile verdict, never Linear closes before gates.
Engineering execution is downstream; this section states display and forbidden copy only.

## SCR-SecSplitFixture — boot-report fixture split and scanner evidence (docs view)
AC-86, AC-87, AC-88. Components: `ds/GateBoard@1.0 { rows: ["split", "tests", "scanner"] }`,
`ds/CheckList@1.0 { rows: ["split", "refusals", "scanner"] }`,
`ds/NoticeBanner@1.0 { redacted: true, neverSilent: true }`.
Props: `{ fixturePartCount: 2; literalCount: number; refusalEchoes: number; secretCount: number; phase: "split-clean" | "verifying" | "literal-found" | "validation" | "no-run" | "success" }`.
States: `default.split-clean`, `loading.verifying`, `error.literal-found`, `error.validation`,
`empty.no-run`, `success`. Fixture row counts literal strings (value redacted); test row counts
failures and echoes; scanner row counts secrets. Focus: `gate-row-link`, `scanner-report-link`.
Links 24x24 (SC 2.5.8); notes non-interactive `role="status"` `aria-live="polite"`.

## SCR-Merge256Gate — conditional PR #256 merge board (docs view)
AC-89, AC-90, AC-91. Components: `ds/GateBoard@1.0 { gates: ["check:docs", "test:scripts", "build", "lint", "boot-report", "Verify-22", "Verify-24", "docs-site", "breaking-change", "audit"] }`,
`ds/StatusReadout@1.0 { labels: ["ready to merge", "merged"] }`,
`ds/NoticeBanner@1.0 { greptile: "offline-absence-recorded", neverSilent: true }`.
Props: `{ localVerdicts: CheckVerdict[]; ciVerdicts: CheckVerdict[]; mergeLabel: "ready to merge" | "merged"; greptileState: "offline-absence-recorded" }`.
States: `default.gates-green`, `loading.running`, `error.gate-fail`, `error.greptile-offline`,
`empty.no-run`, `success.merged`. Local 5 + CI 5 rows in text; merge label stays ready until all
pass; the absence note is the default offline state. Focus: `gate-row-link`, `pr-commit-link`.
Links 24x24.

## SCR-R3W3Closeout — round-3 gates, W3 matrix and Linear close-out (docs view)
AC-92, AC-93, AC-94, AC-95, AC-96. Components: `ds/GateBoard@1.0 { plans: ["qa.r3", "rev.r3", "sec.r3", "build", "rel", "obs", "docs"], w3Checks: 9 }`,
`ds/CheckList@1.0 { rows: ["hashes", "linear", "final-report"] }`,
`ds/NoticeBanner@1.0 { advisory: true, neverSilent: true, live: "polite" }`.
Props: `{ planVerdicts: CheckVerdict[]; w3Passing: number; w3Total: number; stateHash: string; roadmapHash: string; linearClosed: number; reportStates: "listed" | "not yet listed"; phase: "gates-running" | "running" | "gate-fail" | "validation" | "no-run" | "success" }`.
States: `default.gates-running`, `loading.running`, `error.gate-fail`, `error.validation`,
`empty.no-run`, `success`. 7 plans + W3 9; hash read-only promise; Linear closed only after gates
pass; unread PR states read `not yet listed`. Focus: `gate-row-link`, `pr-commit-link`,
`linear-fix-link`. Links 24x24 / 44x44; advisory non-interactive.

## T5471 addendum — quality baseline / Linear continuation / gate enforcement (AC-97..AC-108, tokens 1.2.0)

**Bound:** `design.system.tokens@1.2.0` (`docs/ux/tokens.json`); quality bar measured by the 8 npm gates and CI (spec §15.1); no board UI in this task. Zero new components — reuse `ds/GateBoard@1.0`, `ds/CheckList@1.0`,
`ds/StatusReadout@1.0`, `ds/NoticeBanner@1.0`, `ds/MetricTable@1.0`. Copy bans: never invent an
exit code, floor, count or verdict; never call `unknown — not measured` green; never name a
catalogue change without its code; blocked is never green. Engineering execution (recording the
8 gates, coverage floors, verdicts, Linear states) is downstream (A05 / A08 / A01); this section
states display and forbidden copy only.

## SCR-QualityBaselineBoard — measured baseline + ratchet (docs view)
AC-97, AC-98, AC-99, AC-100, AC-101, AC-102. Components: `ds/GateBoard@1.0 { gates:
["typecheck","lint","test","build","check:docs","check:gates","check:pack","check:mcp"] }`,
`ds/MetricTable@1.0 { rows: ["coverage","audit","ratchet"] }`, `ds/NoticeBanner@1.0 { advisory:
true, neverSilent: true, live: "polite", unknownOnly: true }`.
Props: `{ gateExitCodes: Partial<Record<Gate, 0 | 1>>; coverageFloors: Partial<Record<"src/fs" |
"src/core" | "src/tools", number>>; auditExit?: number; dependencyCount?: number; ratchet:
{ suppressionComments: number; silentCatches: number; unjustifiedDeps: number; oversizedModules:
number }; branch: string }`. Deferred: no UI in this task; evidence is CI exit codes. Quality bar measured by the 8 npm gates and CI (spec §15.1); no board UI in this task. A row not yet measured reads
`unknown — not measured` on the advisory surface and never reads pass.
States: `default.baseline`, `loading.running`, `error.gate-fail`, `error.validation`,
`empty.no-run`, `success.recorded`. Focus: `gate-row-link`, `baseline-detail-link`; advisory note
non-interactive, never in tab order. Links 24x24 (SC 2.5.8).

## SCR-LinearContinuationBoard — done-or-blocked tracker (docs view)
AC-103, AC-104, AC-105. Components: `ds/CheckList@1.0 { states: ["done-with-evidence",
"blocked-with-named-cause"] }`, `ds/NoticeBanner@1.0 { blocked: true, neverSilent: true }`,
`ds/StatusReadout@1.0 { labels: ["done-with-evidence","blocked-with-named-cause"] }`.
Props: `{ items: { ref: string; state: "done-with-evidence" | "blocked-with-named-cause";
evidenceRef?: string; cause?: string; ownerAction?: string; nextStep?: string }[]; unstatedCount:
number; duplicatePhaseTitles: number }`. Quality bar measured by the 8 npm gates and CI (spec §15.1); no board UI in this task. Every listed item reads exactly 1 state; a blocked row reads
`BLOCKED — owner decision required` + exactly 1 cause + exactly 1 owner action + exactly 1 next
step; a done row reads its evidence ref, never a bare done.
States: `default.listed`, `loading.listing`, `error.workspace-unreadable`, `error.validation`,
`empty.no-open-items`, `success.blocked-named`. Focus: `linear-fix-link`, `gate-row-link`;
blocked notice `role="status"` `aria-live="polite"`, non-interactive, never in tab order.
Links 44x44 / 24x24 (SC 2.5.8).

## SCR-GateEnforcementBoard — 4-gate release hold (docs view)
AC-106, AC-107, AC-108. Components: `ds/GateBoard@1.0 { gates: ["review","quality","security",
"release"] }`, `ds/StatusReadout@1.0 { labels: ["held","ready"] }`, `ds/CheckList@1.0 { rows:
["verdicts","readiness","traceability"] }`.
Props: `{ verdicts: Partial<Record<"review" | "quality" | "security" | "release", "green" |
"red">>; releasesOnRed: number; coveredStories: number; totalStories: number;
uncoveredRequirements: number }`. Deferred: no UI in this task; evidence is CI exit codes. Quality bar measured by the 8 npm gates and CI (spec §15.1); no board UI in this task. A missing verdict reads
`not recorded — gate not run`, never pass. Release reads `held` or `ready` (NFR-A3 text label +
shape cue, exactly 1 of 2); `ready` only when all 4 verdicts are green; most-restrictive verdict
wins on conflict.
States: `default.verdicts`, `loading.recording`, `error.red-gate`, `error.validation`,
`empty.no-verdicts`, `success.ready`. Focus: `gate-row-link`, `release-readiness-link`.
Links 24x24 (SC 2.5.8).
